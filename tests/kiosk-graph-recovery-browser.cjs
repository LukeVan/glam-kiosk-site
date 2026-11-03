const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { chromium } = require(path.join(path.dirname(fs.realpathSync(process.argv[2])), 'index.js'));

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const id = `azure_${crypto.createHash('sha256').update('TestEvent/portraits/pending/mock.jpg').digest('hex')}`;
    const expiry = new Date(Date.now() + 3600000).toISOString();
    const start = new Date(Date.now() - 300000).toISOString();
    const sas = (container, permissions) => `https://ffservices24.blob.core.windows.net/${container}?sv=2023-11-03&sr=c&sp=${permissions}&se=${encodeURIComponent(expiry)}&sig=MOCK_ONLY`;
    const blob = `TestEvent/9-Graph-Input/${id}/portrait.png`;
    let ready = false;
    let readFailed = false;
    let reads = 0;
    const methods = [];
    await page.route('https://ffservices24.blob.core.windows.net/**', async (route) => {
      methods.push(route.request().method());
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/manifest.json')) {
        reads += 1;
        if (readFailed) {
          await route.fulfill({ status: 503 });
          return;
        }
        await route.fulfill(ready ? {
          json: {
            schemaVersion: 1, portraitId: id,
            sourceNodeId: 'node_1791927487544_z177v9idx_35_qblmfu',
            status: 'ready', errorCode: null,
            asset: {
              blob, mimeType: 'image/png', expiresAt: expiry,
              url: `https://ffservices24.blob.core.windows.net/mock-assets/${blob}?sv=2023-11-03&sr=b&sp=r&spr=https&st=${encodeURIComponent(start)}&se=${encodeURIComponent(expiry)}&sig=MOCK_ONLY`,
            },
          },
        } : { status: 404 });
      } else if (url.pathname.endsWith('/catalog.json')) {
        await route.fulfill({ status: 404 });
      } else if (url.searchParams.get('comp') === 'list') {
        const prefix = url.searchParams.get('prefix');
        const names = prefix.endsWith('/portraits/pending/') ? ['mock.jpg']
          : ['mock_1-larocheposay.jpg', 'mock_2-lorealprofessionnel.jpg', 'mock_3-YSLbeauty.jpg', 'mock_4-lorealparis.jpg'];
        await route.fulfill({
          contentType: 'application/xml',
          body: `<EnumerationResults><Blobs>${names.map((name) => `<Blob><Name>${prefix}${name}</Name><Properties><Last-Modified>Mon, 05 Oct 2026 10:00:00 GMT</Last-Modified></Properties></Blob>`).join('')}</Blobs><NextMarker></NextMarker></EnumerationResults>`,
        });
      } else {
        await route.fulfill({ contentType: 'image/jpeg', body: fs.readFileSync('blocks/attendee-kiosk/assets/Person5.jpg') });
      }
    });
    await page.goto('http://localhost:3017/drafts/attendee-kiosk.html');
    await page.evaluate(async ({ assetSAS, portraitId }) => {
      const { saveSettings } = await import('/scripts/kiosk-settings.js');
      const { initialState } = await import('/blocks/attendee-kiosk/state.js');
      saveSettings(localStorage, {
        version: 1, containerSAS: assetSAS, eventId: 'TestEvent',
        activationProfile: 'max', formType: 'none',
      });
      sessionStorage.setItem('glam-attendee-v1:azure:TestEvent', JSON.stringify({
        ...initialState(), stage: 'story', consent: true, portraitId,
        name: 'Test', sessionId: 'fixture',
      }));
    }, { assetSAS: sas('mock-assets', 'rl'), portraitId: id });
    await page.reload();
    const recovery = page.locator('.kiosk-graph-recovery');
    await recovery.waitFor();
    await page.locator('.attendee-kiosk').evaluate((block) => block.classList.add('kiosk-graph-hold'));
    for (const width of [1920, 768]) {
      await page.setViewportSize({ width, height: 1080 });
      for (const control of await recovery.getByRole('button').all()) {
        await control.click({ trial: true });
      }
    }
    await page.setViewportSize({ width: 1920, height: 1080 });
    assert.equal(await recovery.getByRole('button', { name: 'Refresh', exact: true }).count(), 1);
    ready = true;
    await recovery.getByRole('button', { name: 'Refresh', exact: true }).click();
    await recovery.waitFor({ state: 'hidden' });
    assert(reads >= 2, 'Manual refresh must reread the manifest');
    assert.equal(await page.locator('.kiosk-panel-story').count(), 1);
    readFailed = true;
    await page.reload();
    await recovery.waitFor();
    assert.equal(await page.locator('.kiosk-graph-input-status').getAttribute('data-graph-input-reason'), 'manifest_http_503');
    readFailed = false;
    await recovery.getByRole('button', { name: 'Refresh', exact: true }).click();
    await recovery.waitFor({ state: 'hidden' });
    ready = false;
    await page.reload();
    await recovery.waitFor();
    await recovery.getByRole('button', { name: 'Continue to ads', exact: true }).click();
    await page.locator('.kiosk-ad-grid button').first().waitFor();
    assert.deepEqual(await page.locator('.kiosk-ad-grid .kiosk-card').evaluateAll((cards) => (
      cards.map((card) => card.dataset.assetId)
    )), [2, 4, 3, 1].map((number) => `${id}_${number}`));
    assert.equal(await recovery.count(), 0);
    await page.evaluate(() => {
      const key = 'glam-attendee-v1:azure:TestEvent';
      const state = JSON.parse(sessionStorage.getItem(key));
      state.stage = 'story';
      sessionStorage.setItem(key, JSON.stringify(state));
    });
    await page.reload();
    await recovery.waitFor();
    await recovery.getByRole('button', { name: 'Reset', exact: true }).click();
    const badge = page.locator('.kiosk-badge');
    await badge.getByRole('button', { name: 'Reset', exact: true }).click();
    await page.locator('.kiosk-consent input').waitFor();
    assert(methods.every((method) => method === 'GET'));
    for (const number of [2, 4, 3, 1]) {
      await page.evaluate(async () => {
        const { initialState } = await import('/blocks/attendee-kiosk/state.js');
        localStorage.removeItem('glam-kiosk-booth-v1');
        sessionStorage.setItem('glam-attendee-v1:offline-demo', JSON.stringify({
          ...initialState(), stage: 'ads', consent: true,
          portraitId: 'demo_dd5af9bb1ce34c41bcc1a45723d6c343',
          name: 'Test', sessionId: 'fixture',
        }));
      });
      await page.reload();
      const demoID = 'demo_dd5af9bb1ce34c41bcc1a45723d6c343';
      const cards = page.locator('.kiosk-ad-grid button');
      await cards.first().waitFor();
      assert.deepEqual(await cards.evaluateAll((items) => items.map((item) => item.dataset.assetId)),
        [2, 4, 3, 1].map((index) => `${demoID}_${index}`));
      await page.locator(`[data-asset-id="${demoID}_${number}"]`).click();
      await page.waitForFunction((selectedId) => {
        const state = JSON.parse(sessionStorage.getItem('glam-attendee-v1:offline-demo'));
        return state.stage === 'continued' && state.selectedAdId === selectedId;
      }, `${demoID}_${number}`);
    }
    console.log('Missing Graph: 404/503 recovery, hold-screen controls, responsive access, ordered ads, confirmed reset and no backend mutations passed.');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
