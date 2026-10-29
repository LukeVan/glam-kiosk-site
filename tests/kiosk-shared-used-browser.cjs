const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { chromium } = require(path.join(path.dirname(fs.realpathSync(process.argv[2])), 'index.js'));

const id = (name) => `azure_${crypto.createHash('sha256').update(`TestEvent/portraits/pending/${name}`).digest('hex')}`;

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
    const sas = (container, permissions) => `https://ffservices24.blob.core.windows.net/${container}?sv=2023-11-03&sr=c&sp=${permissions}&se=${encodeURIComponent(expiresAt)}&sig=MOCK_ONLY`;
    let used = [];
    let failUsed = false;
    await page.route('https://ffservices24.blob.core.windows.net/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('.json')) { await route.fulfill({ status: 404 }); return; }
      if (url.searchParams.get('comp') === 'list') {
        const prefix = url.searchParams.get('prefix');
        let names = [];
        if (prefix === 'TestEvent/portraits/pending/') names = ['a.jpg', 'b.jpg', 'c.jpg'];
        if (prefix === 'TestEvent/portraits/used/') {
          if (failUsed) { await route.fulfill({ status: 403 }); return; }
          names = [...used, 'not-a-portrait-id'];
        }
        const body = `<EnumerationResults><Blobs>${names.map((name) => `<Blob><Name>${prefix}${name}</Name><Properties><Last-Modified>Mon, 05 Oct 2026 10:00:00 GMT</Last-Modified></Properties></Blob>`).join('')}</Blobs><NextMarker></NextMarker></EnumerationResults>`;
        await route.fulfill({ contentType: 'application/xml', body });
        return;
      }
      await route.fulfill({ contentType: 'image/jpeg', body: fs.readFileSync('blocks/attendee-kiosk/assets/Person5.jpg') });
    });
    await page.goto('http://localhost:3017/drafts/attendee-kiosk.html');
    await page.evaluate(async (settings) => {
      const { saveSettings } = await import('/scripts/kiosk-settings.js');
      saveSettings(localStorage, settings);
    }, {
      version: 1, containerSAS: sas('mock-assets', 'rl'),
      requestSAS: sas('glam-kiosk-requests', 'c'),
      eventId: 'TestEvent', activationProfile: 'max', formType: 'none',
      printScope: 'selected', showFinalQR: true,
    });
    const eventCards = async () => {
      await page.evaluate(() => sessionStorage.clear());
      await page.reload();
      await page.locator('.kiosk-consent input').check();
      await page.locator('.kiosk-print').click();
      await page.locator('.kiosk-portrait-grid button, [role=alert]').first().waitFor();
      await page.waitForTimeout(500);
      return page.locator('.kiosk-portrait-grid .kiosk-card:not(.kiosk-demo-card)').count();
    };
    assert.equal(await eventCards(), 3);
    used = [id('b.jpg')];
    assert.equal(await eventCards(), 2, 'portrait used on another kiosk is hidden');
    await page.evaluate((portrait) => {
      localStorage.setItem('glam-kiosk-completed-v1:TestEvent', JSON.stringify([portrait]));
    }, id('a.jpg'));
    assert.equal(await eventCards(), 1, 'local and shared used portraits are both hidden');
    failUsed = true;
    assert.equal(await eventCards(), 0, 'used-marker failure does not reveal used portraits');
    await page.getByRole('alert').filter({ hasText: 'Event photos are temporarily unavailable' }).waitFor();
    console.log('Shared used-portrait markers: cross-kiosk hide, local merge, invalid names ignored, fail-closed listing passed.');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
