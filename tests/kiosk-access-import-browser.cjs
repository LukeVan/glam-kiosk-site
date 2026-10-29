const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(path.join(path.dirname(fs.realpathSync(process.argv[2])), 'index.js'));

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const expiresAt = new Date(Date.now() + 86400000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const sas = (container, permissions) => `https://ffservices24.blob.core.windows.net/${container}?sv=2023-11-03&sr=c&sp=${permissions}&spr=https&se=${encodeURIComponent(expiresAt)}&sig=MOCK_ONLY`;
    const fixture = {
      schemaVersion: 1, type: 'glam-kiosk-access', eventPrefix: 'TestEvent',
      assetContainerSasUrl: sas('mock-assets', 'rl'),
      requestContainerSasUrl: sas('glam-kiosk-requests', 'c'), expiresAt,
    };
    let calls = 0;
    let failConnection = false;
    let events = ['TestEvent'];
    await page.route('https://ffservices24.blob.core.windows.net/**', async (route) => {
      calls += 1;
      assert.equal(route.request().method(), 'GET');
      if (failConnection) {
        await route.fulfill({ status: 403 });
        return;
      }
      await route.fulfill({
        contentType: 'application/xml',
        body: `<EnumerationResults><Blobs>${events.map((event) => `<Blob><Name>${event}/example.jpg</Name></Blob>`).join('')}</Blobs><NextMarker></NextMarker></EnumerationResults>`,
      });
    });
    await page.route('**/drafts/kiosk-settings.html', (route) => route.fulfill({
      contentType: 'text/html',
      body: fs.readFileSync('drafts/kiosk-settings.html', 'utf8')
        .replace('<body>', '<body><header></header>')
        .replace('</body>', '<footer></footer></body>'),
    }));
    await page.goto('http://localhost:3017/drafts/kiosk-settings.html');
    const file = page.getByLabel('Import kiosk access file', { exact: true });
    const asset = page.getByLabel('Container SAS URL', { exact: true });
    const request = page.getByLabel('Request container SAS URL (create only)', { exact: true });
    const event = page.getByLabel('Event', { exact: true });
    const save = page.getByRole('button', { name: 'Save booth settings', exact: true });
    const test = page.getByRole('button', { name: 'Test connection', exact: true });
    const status = page.locator('.kiosk-settings-status');
    const upload = (data, name = 'access.txt') => file.setInputFiles({
      name, mimeType: 'text/plain', buffer: Buffer.from(JSON.stringify(data)),
    });
    const values = () => page.evaluate(() => ({
      asset: document.querySelector('input[autocomplete="off"]').value,
      saved: localStorage.getItem('glam-kiosk-booth-v1'),
    }));
    await upload(fixture);
    await status.filter({ hasText: 'Nothing saved yet' }).waitFor();
    assert.equal(await asset.inputValue(), fixture.assetContainerSasUrl);
    assert.equal(await request.inputValue(), fixture.requestContainerSasUrl);
    assert.equal(await event.inputValue(), 'TestEvent');
    assert.equal(await event.isDisabled(), true);
    assert.equal(await save.isDisabled(), true);
    assert.equal((await values()).saved, null);
    assert.equal(calls, 0, 'Import must not contact Azure');

    await test.click();
    await status.filter({ hasText: 'Connected.' }).waitFor();
    assert.equal(await event.inputValue(), 'TestEvent');
    await save.click();
    await status.filter({ hasText: 'Booth settings saved' }).waitFor();
    const saved = (await values()).saved;
    assert.equal(JSON.parse(saved).requestSAS, fixture.requestContainerSasUrl);

    for (const invalid of [
      { ...fixture, requestContainerSasUrl: sas('mock-assets', 'c') },
      { ...fixture, eventPrefix: '../bad' },
      { ...fixture, schemaVersion: 2 },
    ]) {
      await upload(invalid);
      await page.getByRole('alert').waitFor();
      assert.equal(await asset.inputValue(), fixture.assetContainerSasUrl);
      assert.equal(await request.inputValue(), fixture.requestContainerSasUrl);
      assert.equal(await event.inputValue(), 'TestEvent');
      assert.equal((await values()).saved, saved, 'Invalid import must not alter saved settings');
      assert.equal(await save.isDisabled(), false, 'Invalid import must not invalidate prior connection');
      assert(!(await status.innerText()).includes('MOCK_ONLY'));
    }
    await file.setInputFiles({ name: 'access.txt', mimeType: 'text/plain', buffer: Buffer.from('{"secret":"MOCK_ONLY"') });
    await status.filter({ hasText: 'not valid JSON' }).waitFor();
    assert(!(await status.innerText()).includes('MOCK_ONLY'));

    const imported = { ...fixture, eventPrefix: 'AirDropEvent' };
    await page.locator('.kiosk-settings-import').evaluate((zone, contents) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([contents], 'airdrop.txt', { type: 'text/plain' }));
      zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }, JSON.stringify(imported));
    await status.filter({ hasText: 'Nothing saved yet' }).waitFor();
    assert.equal(await event.inputValue(), 'AirDropEvent');
    assert.equal((await values()).saved, saved);
    assert.equal(await save.isDisabled(), true);
    await test.click();
    await status.filter({ hasText: 'Connected.' }).waitFor();
    assert.equal(await event.inputValue(), '', 'Unlisted imported event must not be trusted');
    assert.equal(await save.isDisabled(), true);
    events = ['AirDropEvent'];
    await test.click();
    await status.filter({ hasText: 'Connected.' }).waitFor();
    assert.equal(await event.inputValue(), 'AirDropEvent');
    await save.click();
    await status.filter({ hasText: 'Booth settings saved' }).waitFor();
    assert.equal(JSON.parse((await values()).saved).eventId, 'AirDropEvent');
    failConnection = true;
    await upload(fixture);
    await status.filter({ hasText: 'Nothing saved yet' }).waitFor();
    await test.click();
    await page.getByRole('alert').waitFor();
    assert.equal(await save.isDisabled(), true);

    // A user edit made while a file is being read must win over the late import.
    await page.evaluate(() => {
      const original = File.prototype.text;
      File.prototype.text = async function text() {
        const result = await original.call(this);
        await new Promise((resolve) => setTimeout(resolve, 300));
        return result;
      };
    });
    await upload(imported);
    await status.filter({ hasText: 'Reading access file' }).waitFor();
    await asset.fill('manual edit');
    await status.filter({ hasText: 'SAS changed' }).waitFor();
    await page.waitForTimeout(500);
    assert.equal(await asset.inputValue(), 'manual edit');
    assert.deepEqual(errors, []);
    console.log('Access importer browser: picker/drop, atomic rejection, no import writes/network, explicit test/save, event verification, connection failure and stale-read guard passed.');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
