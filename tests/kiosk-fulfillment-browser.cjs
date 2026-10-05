const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(path.join(path.dirname(fs.realpathSync(process.argv[2])), 'index.js'));

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
    const sas = (container, permissions, resource = 'c') => `https://ffservices24.blob.core.windows.net/${container}?sv=2023-11-03&sr=${resource}&sp=${permissions}&se=${encodeURIComponent(expiresAt)}&sig=MOCK_ONLY`;
    const brands = ['larocheposay', 'lorealprofessionnel', 'yslbeauty', 'lorealparis'];
    let request;
    let writes = 0;
    let failFirstWrite = true;
    let completed = false;
    const outputURL = (suffix) => sas(`mock-assets/TestEvent/7-Share-Output/${request.requestId}/${suffix}`, 'r', 'b');
    const downloadURL = () => `https://main--glam-kiosk-site--lukevan.aem.live/download?session=${encodeURIComponent(outputURL('session.json'))}`;
    let shareStatus = 'pending';
    let shareOverride;
    function share() {
      return {
        schemaVersion: 1, requestId: request.requestId, portraitId: request.portraitId,
        name: request.attendeeName, createdAt: request.createdAt, expiresAt,
        status: shareStatus,
        images: brands.map((brand, i) => ({
          brand, filename: `${brand}.jpg`,
          status: shareStatus === 'ready' || (shareStatus === 'partial' && i === 0) ? 'ready' : 'pending',
          url: shareStatus === 'ready' || (shareStatus === 'partial' && i === 0) ? outputURL(`${brand}.jpg`) : null,
        })),
      };
    }
    await page.route('https://ffservices24.blob.core.windows.net/**', async (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() === 'PUT') {
        writes += 1;
        const body = route.request().postDataJSON();
        if (!request) request = body;
        else assert.deepEqual(body, request);
        assert.equal(url.pathname, `/glam-kiosk-requests/TestEvent/requests/${request.requestId}.json`);
        assert.equal(route.request().headers()['if-none-match'], '*');
        if (failFirstWrite) {
          failFirstWrite = false;
          await route.abort('failed');
        } else await route.fulfill({ status: 412 });
        return;
      }
      if (url.pathname.endsWith('/session.json')) {
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(share()) });
        return;
      }
      if (url.pathname.includes('/requests-status/')) {
        if (!completed) { await route.fulfill({ status: 404 }); return; }
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            schemaVersion: 1, requestId: request.requestId, portraitId: request.portraitId,
            eventPrefix: request.eventPrefix, selectedBrand: request.selectedBrand, request,
            render: {
              status: 'ready',
              brands: Object.fromEntries(brands.map((brand) => [brand, {
                status: 'ready', blob: `TestEvent/7-Share-Output/${request.requestId}/${brand}.jpg`,
              }])),
            },
            fulfillment: {
              scope: 'selected', status: 'submitted',
              brands: { [request.selectedBrand]: {
                status: 'submitted',
                blob: `TestEvent/6-Print-Output/${request.requestId}__${request.selectedBrand}_print.jpg`,
              } },
            },
            share: {
              expiresAt, downloadPageUrl: downloadURL(),
              qrBlob: `TestEvent/7-Share-Output/${request.requestId}/qr.png`,
            },
          }),
        });
        return;
      }
      if (url.searchParams.get('comp') === 'list') {
        const prefix = url.searchParams.get('prefix') || 'TestEvent/portraits/pending/';
        const names = prefix.endsWith('/portraits/pending/') ? ['mock.jpg']
          : brands.map((brand, i) => `mock_${i + 1}-${brand}.jpg`);
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
    await page.reload();
    await page.locator('.kiosk-consent input').check();
    await page.locator('.kiosk-print').click();
    await page.locator('.kiosk-portrait-grid button').first().click();
    await page.keyboard.press('Enter');
    await page.locator('.kiosk-name input').fill('Mock Print');
    await page.locator('.kiosk-name .kiosk-primary-action').click();
    await page.getByRole('button', { name: 'Jump to Ads', exact: true }).click();
    await page.locator('.kiosk-ad-grid button').nth(1).click();
    await page.locator('.kiosk-ad-copy .kiosk-primary-action').click();
    await page.getByRole('alert').waitFor();
    assert.equal(writes, 1);
    await page.reload();
    await page.locator('.kiosk-ad-copy .kiosk-primary-action').click();
    await page.getByRole('button', { name: 'Your personalized ads', exact: true }).click();
    assert.equal(writes, 2);
    await page.locator('.kiosk-panel-ending').waitFor();
    assert.equal(await page.locator('.kiosk-share-qr').count(), 0);
    await page.reload();
    await page.locator('.kiosk-panel-ending').waitFor();
    assert.equal(writes, 2);
    completed = true;
    await page.locator('.kiosk-panel-ending').getByRole('button', { name: 'Refresh assets', exact: true }).click();
    await page.locator('.kiosk-share-qr').waitFor();
    assert.equal(await page.getByRole('link', { name: 'Download your four ads' }).getAttribute('href'), downloadURL());
    assert((await page.locator('.kiosk-panel-ending').innerText()).includes('sent to print fulfillment'));
    const imageSource = await page.locator('.kiosk-share-qr').getAttribute('src');
    assert.equal(new URL(imageSource).searchParams.get('sr'), 'c');
    assert.equal(new URL(new URL(downloadURL()).searchParams.get('session')).searchParams.get('sr'), 'b');
    const download = await browser.newPage();
    await download.route('https://ffservices24.blob.core.windows.net/**', async (route) => {
      if (route.request().url().includes('session.json')) {
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(shareOverride || share()) });
      } else await route.fulfill({ contentType: 'image/jpeg', body: fs.readFileSync('blocks/attendee-kiosk/assets/Person5.jpg') });
    });
    await download.route('**/drafts/mock-download.html*', (route) => route.fulfill({
      contentType: 'text/html',
      body: '<html><body><div class="download"></div><script type="module">import decorate from "/blocks/download/download.js"; decorate(document.querySelector(".download"));</script></body></html>',
    }));
    const localDownload = `http://localhost:3017/drafts/mock-download.html?session=${encodeURIComponent(outputURL('session.json'))}`;
    await download.goto(localDownload);
    await download.getByText('Your four personalized ads are being prepared.', { exact: false }).waitFor();
    assert.equal(await download.locator('.download-gallery img').count(), 0);
    shareStatus = 'partial';
    await download.reload();
    await download.locator('.download-gallery-item').waitFor();
    assert.equal(await download.locator('.download-gallery-item').count(), 1);
    shareStatus = 'ready';
    await download.reload();
    await download.waitForFunction(() => document.querySelectorAll('.download-gallery-item').length === 4);
    assert.equal(await download.locator('.download-gallery img').first().getAttribute('referrerpolicy'), 'no-referrer');
    shareOverride = { ...share(), expiresAt: new Date(Date.now() - 1000).toISOString() };
    await download.reload();
    await download.getByText('Could not load your ads', { exact: false }).waitFor();
    assert.equal(await download.locator('.download-gallery-item').count(), 0);
    shareOverride = { name: 'Legacy Mock', images: [{ url: '/blocks/attendee-kiosk/assets/Person5.jpg', filename: 'legacy.jpg' }] };
    await download.reload();
    await download.locator('.download-gallery-item').waitFor();
    assert.equal(await download.locator('.download-gallery-item').count(), 1);
    await download.goto(`http://localhost:3017/drafts/mock-download.html?img=${encodeURIComponent('/blocks/attendee-kiosk/assets/Person5.jpg')}`);
    await download.locator('.download-preview img').waitFor();
    await page.goto('http://localhost:3017/drafts/kiosk-settings.html');
    await page.getByLabel('Request container SAS URL (create only)').waitFor();
    await page.getByLabel('Print files').selectOption('all');
    await page.getByLabel('Final screen').selectOption('pickup');
    await page.getByRole('button', { name: 'Test connection', exact: true }).click();
    await page.getByRole('button', { name: 'Save booth settings', exact: true }).click();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('glam-kiosk-booth-v1')));
    assert.equal(saved.printScope, 'all');
    assert.equal(saved.showFinalQR, false);
    assert.equal(new URL(saved.requestSAS).searchParams.get('sp'), 'c');
    console.log('PASS mocked immutable retry/reload, pending/ready ending, partial/ready/expired shares, legacy downloads, selected/all and QR/pickup settings.');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
