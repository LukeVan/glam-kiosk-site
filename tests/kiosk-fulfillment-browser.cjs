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
    let statusPublished = false;
    let previewReady = false;
    let qrPublished = false;
    let bannerStatus = 'unpublished';
    let failPortraitListing = false;
    const outputURL = (suffix) => sas(`mock-assets/TestEvent/7-Share-Output/${request.requestId}/${suffix}`, 'r', 'b');
    const downloadURL = () => `https://main--glam-kiosk-site--lukevan.aem.live/max-download.html?session=${encodeURIComponent(outputURL('session.json'))}`;
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
      if (url.pathname.includes('/9-Graph-Input/') && url.pathname.endsWith('/manifest.json')) {
        const portraitId = url.pathname.split('/').at(-2);
        const blob = `TestEvent/9-Graph-Input/${portraitId}/portrait.png`;
        const graphExpiry = new Date(Date.now() + 3600000).toISOString();
        const image = new URL(`https://ffservices24.blob.core.windows.net/mock-assets/${blob}`);
        image.search = new URLSearchParams({
          sv: '2023-11-03', sr: 'b', sp: 'r', spr: 'https',
          st: new Date(Date.now() - 300000).toISOString(), se: graphExpiry, sig: 'MOCK_GRAPH_ONLY',
        }).toString();
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            schemaVersion: 1, portraitId, sourceNodeId: 'node_1791927487544_z177v9idx_35_qblmfu',
            status: 'ready', errorCode: null,
            asset: { blob, mimeType: 'image/png', url: image.href, expiresAt: graphExpiry },
          }),
        });
        return;
      }
      if (url.pathname.includes('/8-Banner-Output/') && url.pathname.endsWith('/manifest.json')) {
        if (bannerStatus === 'unpublished') {
          await route.fulfill({ status: 404 });
          return;
        }
        const portraitId = url.pathname.split('/').at(-2);
        const prefix = `TestEvent/8-Banner-Output/${portraitId}/`;
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            schemaVersion: 1, portraitId, brand: '4-lorealparis',
            status: bannerStatus === 'preview-unavailable' ? 'ready' : bannerStatus,
            assets: [
              { id: 'banner_pdf', label: 'Banner PDF', status: 'ready', mimeType: 'application/pdf', blob: `${prefix}banner.pdf` },
              ...(bannerStatus === 'preview-unavailable' ? [{
                id: 'preview', label: 'Preview', status: 'unavailable', mimeType: null, blob: null,
              }] : Array.from({ length: 18 }, (_, i) => ({
                id: `page_${i + 1}`, label: `Page ${i + 1}`, status: 'ready',
                mimeType: 'image/png', blob: `${prefix}page_${i + 1}.png`,
              }))),
            ],
          }),
        });
        return;
      }
      if (url.pathname.endsWith('/session.json')) {
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(share()) });
        return;
      }
      if (url.pathname.includes('/requests-status/')) {
        if (!statusPublished) { await route.fulfill({ status: 404 }); return; }
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            schemaVersion: 1, requestId: request.requestId, portraitId: request.portraitId,
            eventPrefix: request.eventPrefix, selectedBrand: request.selectedBrand, request,
            render: {
              status: completed ? 'ready' : previewReady ? 'partial' : 'rendering',
              brands: Object.fromEntries(brands.map((brand) => [brand, {
                status: completed || (previewReady && brand === request.selectedBrand) ? 'ready' : 'pending',
                blob: completed || (previewReady && brand === request.selectedBrand)
                  ? `TestEvent/7-Share-Output/${request.requestId}/${brand}.jpg` : null,
              }])),
            },
            fulfillment: {
              scope: 'selected', status: completed ? 'submitted' : 'pending',
              brands: { [request.selectedBrand]: {
                status: completed ? 'submitted' : 'pending',
                blob: completed
                  ? `TestEvent/6-Print-Output/${request.requestId}__${request.selectedBrand}_print.jpg` : null,
              } },
            },
            share: {
              expiresAt, downloadPageUrl: downloadURL(),
              qrBlob: qrPublished ? `TestEvent/7-Share-Output/${request.requestId}/qr.png` : null,
            },
          }),
        });
        return;
      }
      if (url.searchParams.get('comp') === 'list') {
        const prefix = url.searchParams.get('prefix') || 'TestEvent/portraits/pending/';
        if (failPortraitListing && prefix.endsWith('/portraits/pending/')) {
          await route.fulfill({ status: 403 });
          return;
        }
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
    await page.locator('.kiosk-coworker-copy .kiosk-graph-input-status').waitFor({ state: 'attached' });
    assert.equal(await page.locator('.kiosk-coworker-copy h2').innerText(), 'Ask CX\nCoworker.');
    assert.equal(await page.locator('.kiosk-coworker-copy > p').first().innerText(),
      "Don't hunt through endless project data that isn't relevant — to you. Get straight to the point.");
    assert.equal(await page.locator('.kiosk-panel-coworker > .kiosk-graph-input-status').count(), 0);
    const shellCopyBox = await page.locator('.kiosk-coworker-copy').boundingBox();
    const shellFrameBox = await page.locator('.kiosk-frame-slot').boundingBox();
    assert(shellCopyBox.x + shellCopyBox.width < shellFrameBox.x);
    await page.getByRole('button', { name: 'Jump to Ads', exact: true }).click();
    await page.locator('.kiosk-composer-send').waitFor();
    assert.equal(await page.locator('.kiosk-composer-send').isDisabled(), true);
    await page.locator('.kiosk-ad-grid button').nth(3).click();
    assert.equal(await page.locator('.kiosk-composer.has-selection').count(), 1);
    assert((await page.locator('.kiosk-composer-attachment img').getAttribute('src'))
      .includes('lorealparis'));
    const gridBox = await page.locator('.kiosk-ad-grid').boundingBox();
    const dockBox = await page.locator('.kiosk-composer').boundingBox();
    assert(dockBox.y >= gridBox.y + gridBox.height);
    assert.equal(Math.round(dockBox.x + dockBox.width), Math.round(gridBox.x + gridBox.width));
    if (process.env.KIOSK_SCREENSHOT_DIR) {
      await page.screenshot({ path: path.join(process.env.KIOSK_SCREENSHOT_DIR, 'engulf-ads.png') });
    }
    await page.locator('.kiosk-composer-send').click();
    await page.getByRole('alert').waitFor();
    assert.equal(writes, 1);
    assert.equal(await page.locator('.kiosk-engulf-ghost').count(), 0);
    await page.reload();
    const coworker = page.frameLocator('.kiosk-frame-slot iframe');
    await coworker.locator('body').waitFor({ state: 'attached' });
    await coworker.locator('button').first().waitFor({ state: 'attached' });
    await page.evaluate(() => {
      window.simulationMessages = [];
      window.graphMessages = [];
      const child = document.querySelector('.kiosk-frame-slot iframe').contentWindow;
      const post = child.postMessage.bind(child);
      child.postMessage = (message, ...args) => {
        if (message.type === 'KIOSK_SIMULATE') window.simulationMessages.push(message);
        if (message.type === 'KIOSK_SET_GRAPH_PORTRAIT') window.graphMessages.push(message);
        post(message, ...args);
      };
    });
    await page.locator('.kiosk-composer-send').focus();
    await page.keyboard.press('Enter');
    await page.locator('.kiosk-engulf-ghost').waitFor();
    assert.equal(await page.locator('.kiosk-engulf-overlay').getAttribute('aria-hidden'), 'true');
    await page.waitForFunction(() => document.querySelector('.kiosk-engulf-settle'));
    const ghostTarget = await page.locator('.kiosk-engulf-ghost').evaluate((ghost) => ({
      left: parseFloat(ghost.style.left), top: parseFloat(ghost.style.top),
      width: parseFloat(ghost.style.width),
    }));
    assert.equal(ghostTarget.width, 200);
    const exiting = await page.locator('.kiosk-engulf-tile-exit').evaluateAll((tiles) => (
      tiles.map((tile) => tile.style.transitionDelay)
    ));
    assert.deepEqual(exiting, ['0ms', '91ms', '182ms']);
    await page.locator('.kiosk-engulf-ghost').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.kiosk-engulf-overlay').count(), 0);
    await page.waitForFunction(() => window.simulationMessages.length === 1);
    assert.equal((await page.evaluate(() => window.simulationMessages)).length, 1);
    await page.waitForFunction(() => window.graphMessages.some((message) => message.url));
    const graph = await page.evaluate(() => window.graphMessages.find((message) => message.url));
    assert.equal(new URL(graph.url).searchParams.get('sr'), 'b');
    assert.equal(new URL(graph.url).searchParams.get('sp'), 'r');
    assert.equal(graph.portraitId, request.portraitId);
    assert.equal(await page.evaluate(() => (
      [localStorage, sessionStorage].some((storage) => Object.keys(storage)
        .some((key) => storage.getItem(key).includes('MOCK_GRAPH_ONLY')))
    )), false);
    assert.equal(writes, 2);
    await coworker.locator('[contenteditable="true"]').waitFor();
    await coworker.getByRole('button', { name: 'Send', exact: true }).waitFor();
    await page.waitForFunction(() => {
      const child = document.querySelector('.kiosk-frame-slot iframe').contentDocument;
      return child.activeElement?.getAttribute('contenteditable') === 'true';
    });
    assert.equal(await page.evaluate(() => window.scrollY), 0);
    if (process.env.KIOSK_SCREENSHOT_DIR) {
      await page.screenshot({ path: path.join(process.env.KIOSK_SCREENSHOT_DIR, 'engulf-continued.png') });
    }
    await page.keyboard.press('Enter');
    await coworker.getByRole('button', { name: 'Open full results', exact: true }).waitFor();
    await coworker.locator('body').evaluate(() => {
      window.graphOpened = [];
      window.open = (url) => {
        window.graphOpened.push(url);
        return { focus() {} };
      };
    });
    await coworker.getByRole('button', { name: 'Open in Adobe Graph', exact: true }).click();
    const graphLaunch = await coworker.locator('body').evaluate(() => window.graphOpened[0]);
    const launchedURL = new URL(graphLaunch);
    assert.equal(launchedURL.origin, 'https://firefly.adobe.com');
    assert(launchedURL.pathname.endsWith('08944592-9145-526f-8b43-75400178e5ee'));
    const cutoutURL = new URL(new URLSearchParams(launchedURL.hash.slice(1)).get('portraitUrl'));
    assert.equal(cutoutURL.searchParams.get('sig'), 'MOCK_GRAPH_ONLY');
    assert(cutoutURL.pathname.endsWith(`/9-Graph-Input/${request.portraitId}/portrait.png`));
    await coworker.getByRole('button', { name: 'Send', exact: true }).click();
    await coworker.getByRole('button', { name: 'See variation results', exact: true }).click();
    await page.locator('.kiosk-panel-variations').waitFor();
    assert.equal(await page.locator('.kiosk-variation').count(), 0);
    assert.equal(await page.getByText('One idea. A whole world of content.', { exact: true }).count(), 0);
    assert.equal(await page.locator('.kiosk-variations-status').innerText(), '');
    bannerStatus = 'ready';
    await page.waitForFunction(() => document.querySelectorAll('.kiosk-variation').length === 18,
      null, { timeout: 10000 });
    assert.equal(await page.locator('.kiosk-variation').count(), 18);
    await page.locator('.kiosk-variation img').evaluateAll(async (images) => {
      await Promise.all(images.map((image) => new Promise((resolve, reject) => {
        const check = new Image();
        check.onload = resolve;
        check.onerror = reject;
        check.src = image.src;
      })));
    });
    assert((await page.locator('.kiosk-variations-notice').innerText()).includes('personalized variations'));
    assert.equal(await page.locator('.kiosk-banner-download').count(), 1);
    assert.equal(await page.locator('.kiosk-variation img[src*=".pdf"]').count(), 0);
    await page.waitForFunction(() => document.querySelector('.kiosk-variations-viewport').scrollTop > 5);
    assert.equal(await page.getByRole('button', { name: 'Pause showcase', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Back to Coworker', exact: true }).count(), 0);
    const workflowBox = await page.locator('.kiosk-variations-workflow').boundingBox();
    const galleryBox = await page.locator('.kiosk-variations-viewport').boundingBox();
    assert(workflowBox.x > galleryBox.x + galleryBox.width / 2);
    assert(workflowBox.y > galleryBox.y + galleryBox.height / 2);
    await page.locator('.kiosk-variations-viewport').evaluate((view) => {
      view.scrollTop += 100;
      view.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }));
    });
    const pausedScroll = await page.locator('.kiosk-variations-viewport').evaluate((view) => view.scrollTop);
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 750)));
    assert.equal(await page.locator('.kiosk-variations-viewport').evaluate((view) => view.scrollTop), pausedScroll);
    await page.waitForFunction((top) => (
      document.querySelector('.kiosk-variations-viewport').scrollTop > top + 2
    ), pausedScroll, { timeout: 2000 });
    await page.getByRole('button', { name: 'View production workflow', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    const closeWorkflow = page.getByRole('button', { name: 'Close window', exact: true });
    assert.equal(await closeWorkflow.innerText(), '×');
    await closeWorkflow.click();
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'View production workflow', exact: true }).evaluate((node) => node === document.activeElement), true);
    await page.reload();
    await page.locator('.kiosk-panel-variations').waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.kiosk-variation').length === 18);
    assert.equal(await page.locator('.kiosk-variation').count(), 18);
    assert.equal(writes, 2);
    if (process.env.KIOSK_SCREENSHOT_DIR) {
      await page.screenshot({ path: path.join(process.env.KIOSK_SCREENSHOT_DIR, 'variations.png') });
    }
    bannerStatus = 'preview-unavailable';
    await page.reload();
    await page.getByText('Image previews are unavailable. Open the PDF if available, or ask booth staff.', { exact: true }).waitFor();
    assert.equal(await page.locator('.kiosk-variation').count(), 0);
    assert.equal(await page.locator('.kiosk-banner-download').count(), 1);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    assert.equal(writes, 2);
    await page.locator('.kiosk-panel-ending').waitFor();
    assert.equal(await page.locator('.kiosk-share-qr').count(), 0);
    await page.reload();
    await page.locator('.kiosk-panel-ending').waitFor();
    assert.equal(writes, 2);
    statusPublished = true;
    await page.locator('.kiosk-panel-ending').getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.locator('.kiosk-ending-copy h2').waitFor();
    assert.equal(await page.locator('.kiosk-ending-copy h2').innerText(), 'Thank you');
    assert.equal(await page.locator('.kiosk-share-qr').count(), 0);
    assert.equal(await page.locator('.kiosk-print-preview').count(), 0);
    qrPublished = true;
    await page.locator('.kiosk-panel-ending').getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.locator('.kiosk-share-qr').waitFor();
    assert.equal(await page.locator('.kiosk-print-preview').count(), 0);
    assert.equal(await page.locator('.kiosk-ending-copy h2').innerText(), 'Thank you');
    assert.equal(writes, 2);
    await page.reload();
    await page.locator('.kiosk-share-qr').waitFor();
    assert.equal(await page.locator('.kiosk-print-preview').count(), 0);
    assert.equal(writes, 2);
    previewReady = true;
    await page.locator('.kiosk-panel-ending').getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.locator('.kiosk-print-preview').waitFor();
    assert.equal(await page.locator('.kiosk-share-qr').count(), 1);
    completed = true;
    await page.locator('.kiosk-panel-ending').getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByText('Your files have been sent to print fulfillment.', { exact: false }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Scan to download all four personalized ads' }).getAttribute('href'), downloadURL());
    assert.equal(await page.locator('.kiosk-qr-link').innerText(), '');
    assert.equal(await page.locator('.kiosk-qr-link').getAttribute('target'), '_blank');
    assert.equal(await page.locator('.kiosk-qr-link').getAttribute('rel'), 'noopener noreferrer');
    const qrStyle = await page.locator('.kiosk-qr-link').evaluate((link) => {
      const style = getComputedStyle(link);
      return [style.backgroundColor, style.padding, style.borderRadius];
    });
    assert.deepEqual(qrStyle, ['rgba(0, 0, 0, 0)', '0px', '0px']);
    assert.equal(await page.locator('.kiosk-ending-copy h2').innerText(), 'Thank you');
    assert((await page.locator('.kiosk-print-preview').getAttribute('src')).includes(`${request.selectedBrand}.jpg`));
    const copyBox = await page.locator('.kiosk-ending-copy').boundingBox();
    const mediaBox = await page.locator('.kiosk-ending-media').boundingBox();
    assert(mediaBox.x > copyBox.x + copyBox.width);
    const refreshBox = await page.getByRole('button', { name: 'Refresh', exact: true }).boundingBox();
    const exitBox = await page.locator('.kiosk-ending-actions').getByRole('button', { name: 'Exit the experience', exact: true }).boundingBox();
    assert.equal(refreshBox.y, exitBox.y);
    assert((await page.locator('.kiosk-panel-ending').innerText()).includes('sent to print fulfillment'));
    const imageSource = await page.locator('.kiosk-share-qr').getAttribute('src');
    assert.equal(new URL(imageSource).searchParams.get('sr'), 'c');
    assert.equal(new URL(new URL(downloadURL()).searchParams.get('session')).searchParams.get('sr'), 'b');
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileCopy = await page.locator('.kiosk-ending-copy').boundingBox();
    const mobileMedia = await page.locator('.kiosk-ending-media').boundingBox();
    assert(mobileMedia.y >= mobileCopy.y + mobileCopy.height);
    const mobileRefresh = await page.getByRole('button', { name: 'Refresh', exact: true }).boundingBox();
    const mobileExit = await page.locator('.kiosk-ending-actions').getByRole('button', { name: 'Exit the experience', exact: true }).boundingBox();
    assert.equal(mobileRefresh.y, mobileExit.y);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.locator('.kiosk-ending-actions').getByRole('button', { name: 'Exit the experience', exact: true }).click();
    await page.locator('.kiosk-panel-welcome').waitFor();
    await page.reload();
    await page.locator('.kiosk-consent input').check();
    await page.locator('.kiosk-print').click();
    await page.locator('.kiosk-portrait-grid').waitFor();
    assert.equal(await page.locator('.kiosk-portrait-grid .kiosk-card:not(.kiosk-demo-card)').count(), 0);
    assert.equal(await page.locator('.kiosk-portrait-grid .kiosk-demo-card').count(), 3);
    const download = await browser.newPage();
    await download.addInitScript(() => {
      const originalFetch = window.fetch;
      window.fetch = (url, options) => {
        if (String(url).includes('/legacy/session.json')) {
          window.legacyFetchPolicy = {
            redirect: options?.redirect || 'follow',
            credentials: options?.credentials || 'same-origin',
            referrerPolicy: options?.referrerPolicy || 'default',
          };
        }
        return originalFetch(url, options);
      };
    });
    await download.route('https://ffservices24.blob.core.windows.net/**', async (route) => {
      if (route.request().url().includes('session.json')) {
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(shareOverride || share()) });
      } else await route.fulfill({ contentType: 'image/jpeg', body: fs.readFileSync('blocks/attendee-kiosk/assets/Person5.jpg') });
    });
    await download.route('**/drafts/mock-max-download.html*', (route) => route.fulfill({
      contentType: 'text/html',
      body: '<html><body><div class="max-download"></div><script type="module">import decorate from "/blocks/max-download/max-download.js"; decorate(document.querySelector(".max-download"));</script></body></html>',
    }));
    const localDownload = `http://localhost:3017/drafts/mock-max-download.html?session=${encodeURIComponent(outputURL('session.json'))}`;
    await download.goto(localDownload);
    await download.getByText('Your four personalized ads are being prepared.', { exact: false }).waitFor();
    assert.equal(await download.locator('.max-download-gallery img').count(), 0);
    shareStatus = 'partial';
    await download.reload();
    await download.locator('.max-download-gallery-item').waitFor();
    assert.equal(await download.locator('.max-download-gallery-item').count(), 1);
    shareStatus = 'ready';
    await download.reload();
    await download.waitForFunction(() => document.querySelectorAll('.max-download-gallery-item').length === 4);
    assert.equal(await download.locator('.max-download-gallery img').first().getAttribute('referrerpolicy'), 'no-referrer');
    shareOverride = { ...share(), expiresAt: new Date(Date.now() - 1000).toISOString() };
    await download.reload();
    await download.getByText('Your download link has expired.', { exact: true }).waitFor();
    assert.equal(await download.locator('.max-download-gallery-item').count(), 0);
    await download.route('**/drafts/mock-download.html*', (route) => route.fulfill({
      contentType: 'text/html',
      body: '<html><body><div class="download"></div><script type="module">import decorate from "/blocks/download/download.js"; decorate(document.querySelector(".download"));</script></body></html>',
    }));
    // Already-issued MAX /download URLs dispatch to the dedicated renderer.
    shareOverride = undefined;
    await download.goto(`http://localhost:3017/drafts/mock-download.html?session=${encodeURIComponent(outputURL('session.json'))}`);
    await download.locator('.max-download-gallery-item').first().waitFor();
    assert.equal(await download.locator('.max-download-gallery-item').count(), 4);
    assert.equal(await download.locator('link[href="/blocks/max-download/max-download.css"]').count(), 1);
    shareOverride = {
      schemaVersion: 1, name: 'Legacy Mock',
      images: [{ url: '/blocks/attendee-kiosk/assets/Person5.jpg', filename: 'legacy.jpg' }],
    };
    const legacyManifest = sas('mock-assets/legacy/session.json', 'r', 'b');
    await download.goto(`http://localhost:3017/drafts/mock-download.html?session=${encodeURIComponent(legacyManifest)}`);
    await download.locator('.download-gallery-item').waitFor();
    assert.equal(await download.locator('.download-gallery-item').count(), 1);
    assert.equal(await download.locator('.max-download-gallery-item').count(), 0);
    assert.equal(await download.locator('.download-gallery img').first().getAttribute('referrerpolicy'), null);
    assert.deepEqual(await download.evaluate(() => window.legacyFetchPolicy), {
      redirect: 'follow', credentials: 'same-origin', referrerPolicy: 'default',
    });
    delete shareOverride.schemaVersion;
    await download.reload();
    await download.locator('.download-gallery-item').waitFor();
    assert.equal(await download.locator('.download-gallery-item').count(), 1);
    await download.goto(`http://localhost:3017/drafts/mock-download.html?img=${encodeURIComponent('/blocks/attendee-kiosk/assets/Person5.jpg')}`);
    await download.locator('.download-preview img').waitFor();
    assert.equal(await download.locator('.download-preview img').getAttribute('referrerpolicy'), null);
    shareOverride = undefined;
    await download.goto(`http://localhost:3017/max-download.html?session=${encodeURIComponent(outputURL('session.json'))}`);
    await download.locator('.max-download[data-block-status="loaded"]').waitFor();
    await download.locator('.max-download-gallery-item').first().waitFor();
    assert.equal(await download.locator('.max-download-gallery-item').count(), 4);
    await page.goto('http://localhost:3017/drafts/kiosk-settings.html');
    await page.getByLabel('Request container SAS URL (create only)').waitFor();
    await page.getByLabel('Print files').selectOption('all');
    await page.getByLabel('Final screen').selectOption('pickup');
    await page.getByLabel('Show completed portraits').selectOption('show');
    await page.getByRole('button', { name: 'Test connection', exact: true }).click();
    await page.getByRole('button', { name: 'Save booth settings', exact: true }).click();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('glam-kiosk-booth-v1')));
    assert.equal(saved.printScope, 'all');
    assert.equal(saved.showFinalQR, false);
    assert.equal(saved.showCompletedPortraits, true);
    assert.equal(new URL(saved.requestSAS).searchParams.get('sp'), 'c');
    await page.goto('http://localhost:3017/drafts/attendee-kiosk.html');
    await page.locator('.kiosk-portrait-grid .kiosk-card:not(.kiosk-demo-card)').waitFor();
    assert.equal(await page.locator('.kiosk-portrait-grid .kiosk-card:not(.kiosk-demo-card)').count(), 1);
    assert.equal(await page.getByText('Event photos appear first.', { exact: false }).count(), 0);
    failPortraitListing = true;
    await page.reload();
    await page.getByRole('alert').filter({ hasText: 'Event photos are temporarily unavailable. Please ask booth staff.' }).waitFor();
    assert.equal(await page.locator('.kiosk-demo-card').count(), 3);
    assert.equal(await page.getByText('Generate a new SAS', { exact: false }).count(), 0);
    assert.equal(await page.getByText('Azure denied access', { exact: false }).count(), 0);
    failPortraitListing = false;
    assert.equal(writes, 2);
    const demo = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await demo.emulateMedia({ reducedMotion: 'reduce' });
    await demo.goto('http://localhost:3017/drafts/attendee-kiosk.html');
    await demo.locator('.kiosk-consent input').check();
    await demo.locator('.kiosk-print').click();
    await demo.locator('.kiosk-portrait-grid button').first().click();
    await demo.keyboard.press('Enter');
    await demo.locator('.kiosk-name input').fill('Demo Animation');
    await demo.locator('.kiosk-name .kiosk-primary-action').click();
    await demo.getByRole('button', { name: 'Jump to Ads', exact: true }).click();
    await demo.locator('.kiosk-ad-grid button').first().click();
    await demo.setViewportSize({ width: 390, height: 844 });
    const mobileGrid = await demo.locator('.kiosk-ad-grid').boundingBox();
    const mobileDock = await demo.locator('.kiosk-composer').boundingBox();
    assert(mobileDock.y >= mobileGrid.y + mobileGrid.height);
    await demo.setViewportSize({ width: 1920, height: 1080 });
    await demo.locator('.kiosk-composer-send').click();
    await demo.locator('.kiosk-panel-continued').waitFor();
    assert.equal(await demo.locator('.kiosk-engulf-ghost').count(), 0);
    assert.equal(await demo.locator('.kiosk-engulf-overlay').count(), 0);
    await demo.frameLocator('.kiosk-frame-slot iframe').locator('body').evaluate(() => {
      window.parent.postMessage({ type: 'KIOSK_NAV', target: 'view-variations-max' }, window.location.origin);
    });
    await demo.locator('.kiosk-panel-variations').waitFor();
    assert.equal(await demo.getByRole('button', { name: 'Resume showcase', exact: true }).count(), 0);
    assert.equal(await demo.locator('.kiosk-variations-viewport').evaluate((view) => view.scrollTop), 0);
    await demo.setViewportSize({ width: 390, height: 844 });
    assert.equal(await demo.locator('.kiosk-variation').count(), 18);
    assert.equal(await demo.locator('.kiosk-panel-variations').evaluate((panel) => (
      panel.scrollWidth <= panel.clientWidth
    )), true);
    await demo.getByRole('button', { name: 'Reset', exact: true }).click();
    await demo.getByText('Clear this attendee on this browser?', { exact: true }).waitFor();
    await demo.getByRole('button', { name: 'Reset', exact: true }).click();
    await demo.locator('.kiosk-panel-welcome').waitFor();
    assert.equal(await demo.locator('.kiosk-frame-slot iframe').count(), 0);
    await demo.close();
    console.log('PASS mocked immutable retry/reload, pending/ready ending, partial/ready/expired shares, legacy downloads, selected/all and QR/pickup settings.');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
