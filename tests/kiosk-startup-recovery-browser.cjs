const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(path.join(path.dirname(fs.realpathSync(process.argv[2])), 'index.js'));

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const future = new Date(Date.now() + 86400000).toISOString();
    const past = new Date(Date.now() - 60000).toISOString();
    const sas = (container, permissions, expiry) => `https://ffservices24.blob.core.windows.net/${container}?sv=2023-11-03&sr=c&sp=${permissions}&spr=https&se=${encodeURIComponent(expiry)}&sig=MOCK_ONLY`;
    const valid = {
      version: 1, eventId: 'TestEvent', activationProfile: 'max', formType: 'none',
      containerSAS: sas('mock-assets', 'rl', future),
      requestSAS: sas('glam-kiosk-requests', 'c', future), appearance: 'light',
    };
    const access = {
      schemaVersion: 1, type: 'glam-kiosk-access', eventPrefix: valid.eventId,
      assetContainerSasUrl: valid.containerSAS,
      requestContainerSasUrl: valid.requestSAS, expiresAt: future,
    };
    let azureCalls = 0;
    await context.route('https://ffservices24.blob.core.windows.net/**', (route) => {
      azureCalls += 1;
      assert.equal(route.request().method(), 'GET');
      return route.fulfill({
        contentType: 'application/xml',
        body: '<EnumerationResults><Blobs><Blob><Name>TestEvent/example.jpg</Name></Blob></Blobs><NextMarker></NextMarker></EnumerationResults>',
      });
    });
    await context.route('**/drafts/kiosk-settings.html', (route) => route.fulfill({
      contentType: 'text/html',
      body: fs.readFileSync('drafts/kiosk-settings.html', 'utf8')
        .replace('<body>', '<body><header></header>')
        .replace('</body>', '<footer></footer></body>'),
    }));
    await page.goto('http://localhost:3017/max2026.html');
    const seed = async (settings) => {
      await page.evaluate(async (value) => {
        const { initialState } = await import('/blocks/attendee-kiosk/state.js');
        localStorage.setItem('glam-kiosk-booth-v1', JSON.stringify(value));
        localStorage.setItem('glam-kiosk-appearance-v1', 'light');
        localStorage.setItem('glam-kiosk-graph-view-v1', 'editor');
        localStorage.setItem('unrelated-preference', 'keep');
        sessionStorage.setItem('unrelated-session', 'keep');
        sessionStorage.setItem('glam-attendee-v1:azure:TestEvent', JSON.stringify({
          ...initialState(), name: 'Session fixture',
        }));
      }, settings);
      await page.reload();
    };
    const preferences = () => page.evaluate(() => ({
      appearance: localStorage.getItem('glam-kiosk-appearance-v1'),
      graph: localStorage.getItem('glam-kiosk-graph-view-v1'),
      unrelated: localStorage.getItem('unrelated-preference'),
      session: sessionStorage.getItem('unrelated-session'),
      attendeeName: JSON.parse(sessionStorage.getItem('glam-attendee-v1:azure:TestEvent')).name,
    }));
    const expectedPreferences = {
      appearance: 'light', graph: 'editor', unrelated: 'keep', session: 'keep', attendeeName: 'Session fixture',
    };
    // Forged derived metadata cannot extend the actual SAS expiry.
    const expired = { ...valid, containerSAS: sas('mock-assets', 'rl', past), expiresAt: future };
    await seed(expired);
    await page.getByText('Kiosk access has expired.', { exact: false }).waitFor();
    await page.reload();
    await page.getByText('Kiosk access has expired.', { exact: false }).waitFor();
    assert.equal(azureCalls, 0, 'Expired startup must not contact Azure');
    assert.equal(await page.locator('.kiosk-consent').count(), 0, 'Invalid saved setup must not fall back to demos');
    const setup = page.getByRole('link', { name: 'Update credentials', exact: true });
    const remove = page.getByRole('button', { name: 'Remove credentials and use demo', exact: true });
    for (const width of [1920, 768, 390]) {
      await page.setViewportSize({ width, height: 1080 });
      await setup.click({ trial: true });
      await remove.click({ trial: true });
    }
    await page.setViewportSize({ width: 1920, height: 1080 });
    assert(!(await page.locator('.attendee-kiosk').innerText()).includes('MOCK_ONLY'));
    await remove.click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByText('Kiosk access has expired.', { exact: false }).waitFor();
    assert.equal(azureCalls, 0);
    assert.deepEqual(await preferences(), expectedPreferences);

    // Existing settings UI can replace an expired saved record without clearing it first.
    await setup.click();
    await page.getByRole('heading', { name: 'Kiosk booth settings' }).waitFor();
    await page.getByLabel('Import kiosk access file', { exact: true }).setInputFiles({
      name: 'access.txt', mimeType: 'text/plain', buffer: Buffer.from(JSON.stringify(access)),
    });
    await page.locator('.kiosk-settings-status').filter({ hasText: 'Nothing saved yet' }).waitFor();
    assert.equal(azureCalls, 0);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('glam-kiosk-booth-v1'))), expired);
    await page.getByRole('button', { name: 'Test connection', exact: true }).click();
    await page.locator('.kiosk-settings-status').filter({ hasText: 'Connected.' }).waitFor();
    await page.getByRole('button', { name: 'Save booth settings', exact: true }).click();
    await page.locator('.kiosk-settings-status').filter({ hasText: 'Booth settings saved' }).waitFor();
    await page.getByRole('link', { name: 'Open kiosk', exact: true }).click();
    await page.locator('.kiosk-consent input').waitFor();
    assert.equal(await page.locator('.attendee-kiosk').getAttribute('data-appearance'), 'light');
    assert.deepEqual(await preferences(), expectedPreferences);

    // Valid read access must not silently bypass an expired create-only credential.
    await seed({ ...valid, requestSAS: sas('glam-kiosk-requests', 'c', past) });
    await page.getByText('Kiosk access has expired.', { exact: false }).waitFor();
    const other = await context.newPage();
    await other.goto('http://localhost:3017/drafts/kiosk-settings.html');
    await other.getByRole('heading', { name: 'Kiosk booth settings' }).waitFor();
    await other.getByLabel('Import kiosk access file', { exact: true }).setInputFiles({
      name: 'access.txt', mimeType: 'text/plain', buffer: Buffer.from(JSON.stringify(access)),
    });
    await other.locator('.kiosk-settings-status').filter({ hasText: 'Nothing saved yet' }).waitFor();
    assert.equal(await page.locator('.kiosk-consent').count(), 0, 'Import alone must not unblock another tab');
    await other.getByRole('button', { name: 'Test connection', exact: true }).click();
    await other.locator('.kiosk-settings-status').filter({ hasText: 'Connected.' }).waitFor();
    await other.getByRole('button', { name: 'Save booth settings', exact: true }).click();
    await page.locator('.kiosk-consent input').waitFor();
    assert.deepEqual(await preferences(), expectedPreferences);
    await other.close();
    await seed(expired);
    await remove.click();
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('glam-kiosk-booth-v1'))), expired);
    await page.getByRole('button', { name: 'Confirm and load demo', exact: true }).click();
    await page.locator('.kiosk-consent input').waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('glam-kiosk-booth-v1')), null);
    assert.deepEqual(await preferences(), expectedPreferences);
    await page.reload();
    await page.locator('.kiosk-consent input').waitFor();
    assert.equal(await page.locator('.kiosk-startup-error').count(), 0);
    assert.deepEqual(errors, []);
    console.log('Startup recovery: strict expiry, responsive controls, same/other-tab credential update, confirmed demo opt-in, cancel, reload and preserved preferences passed.');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
