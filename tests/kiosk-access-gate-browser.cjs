const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(path.join(path.dirname(fs.realpathSync(process.argv[2])), 'index.js'));

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route('https://ffservices24.blob.core.windows.net/**', (route) => {
      assert.equal(route.request().method(), 'GET');
      return route.fulfill({
        contentType: 'application/xml',
        body: '<EnumerationResults><Blobs></Blobs><NextMarker></NextMarker></EnumerationResults>',
      });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const url = 'http://localhost:3017/max2026.html';
    await page.goto(url);
    const form = page.locator('.kiosk-access-gate');
    await form.getByLabel('Password').fill('wrong');
    await form.getByRole('button', { name: 'Continue' }).click();
    await form.getByText('Incorrect password. Please try again.').waitFor();
    assert.equal(await page.locator('.kiosk-consent').count(), 0);

    // Replace only the test input's digest; no real password is stored in this test.
    await page.evaluate(async () => {
      const { ACCESS_VERIFIER } = await import('/blocks/attendee-kiosk/access-gate.js');
      const digest = crypto.subtle.digest.bind(crypto.subtle);
      crypto.subtle.digest = (algorithm, bytes) => {
        if (new TextDecoder().decode(bytes) !== 'synthetic-test-password') return digest(algorithm, bytes);
        return Promise.resolve(Uint8Array.from(ACCESS_VERIFIER.match(/../g), (pair) => parseInt(pair, 16)).buffer);
      };
    });
    await form.getByLabel('Password').fill('synthetic-test-password');
    await form.getByRole('button', { name: 'Continue' }).click();
    await page.locator('.kiosk-consent input').waitFor();
    await page.reload();
    await page.locator('.kiosk-consent input').waitFor();
    assert.equal(await form.count(), 0);

    const freshTab = await context.newPage();
    await freshTab.goto(url);
    await freshTab.locator('.kiosk-access-gate').waitFor();
    const future = new Date(Date.now() + 86400000).toISOString();
    const past = new Date(Date.now() - 60000).toISOString();
    const settings = (expiry) => ({
      version: 1, eventId: 'TestEvent', activationProfile: 'max', formType: 'none',
      containerSAS: `https://ffservices24.blob.core.windows.net/mock-assets?sv=2023-11-03&sr=c&sp=rl&se=${encodeURIComponent(expiry)}&sig=MOCK_ONLY`,
    });
    await freshTab.evaluate((value) => localStorage.setItem('glam-kiosk-booth-v1', JSON.stringify(value)), settings(past));
    await freshTab.reload();
    await freshTab.getByText('Saved booth access is unavailable:', { exact: false }).waitFor();
    assert.equal(await freshTab.locator('.kiosk-access-gate').count(), 1);
    assert(!(await freshTab.locator('.kiosk-access-gate').innerText()).includes('MOCK_ONLY'));
    await page.evaluate((value) => localStorage.setItem('glam-kiosk-booth-v1', JSON.stringify(value)), settings(future));
    await freshTab.locator('.kiosk-consent input').waitFor();
    assert.equal(await freshTab.locator('.kiosk-access-gate').count(), 0);
    const validTab = await context.newPage();
    await validTab.goto(url);
    await validTab.locator('.kiosk-consent input').waitFor();
    assert.equal(await validTab.locator('.kiosk-access-gate').count(), 0);
    assert.deepEqual(errors, []);
    console.log('Kiosk access: wrong password, session reload, new tab, expired and active SAS, and cross-tab setup passed.');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
