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
    const variationBrand = process.env.KIOSK_VARIATION_BRAND || '2-lorealprofessionnel';
    const selectedBrandIndex = ['1-larocheposay', '2-lorealprofessionnel', '3-YSLbeauty', '4-lorealparis']
      .indexOf(variationBrand);
    assert(selectedBrandIndex >= 0);
    let request;
    let preparation;
    let prepareWrites = 0;
    let failFirstPreparation = true;
    let sourceAdsReady = false;
    let writes = 0;
    let failFirstWrite = true;
    let completed = false;
    let statusPublished = false;
    let preparationOnly = true;
    let previewReady = false;
    let qrPublished = false;
    let bannerStatus = 'unpublished';
    let graphUnavailable = false;
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
      if (url.pathname.endsWith('/assets/permanent-demos/catalog.json')) {
        await route.fulfill({ status: 404 });
        return;
      }
      if (route.request().method() === 'PUT') {
        const body = route.request().postDataJSON();
        if (url.pathname.endsWith('/prepare.json')) {
          prepareWrites += 1;
          if (!preparation) preparation = body;
          else assert.deepEqual(body, preparation);
          assert.equal(body.type, 'prepare');
          assert.equal(body.selectedBrand, undefined);
          assert.equal(body.printScope, undefined);
          assert.equal(body.showFinalQR, undefined);
          assert.equal(url.pathname, `/glam-kiosk-requests/TestEvent/requests/${body.requestId}/prepare.json`);
          assert.equal(route.request().headers()['if-none-match'], '*');
          assert.equal(url.searchParams.get('sp'), 'c');
          if (failFirstPreparation) {
            failFirstPreparation = false;
            await route.abort('failed');
          } else await route.fulfill({ status: 412 });
          return;
        }
        writes += 1;
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
        if (graphUnavailable) {
          await route.fulfill({ status: 404 });
          return;
        }
        const portraitId = url.pathname.split('/').at(-2);
        const blob = `TestEvent/9-Graph-Input/${portraitId}/portrait.png`;
        const graphExpiry = new Date(Date.now() + 7 * 86400000).toISOString();
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
        const brandDirectory = variationBrand === '4-lorealparis' ? '' : `${variationBrand}/`;
        assert(url.pathname.endsWith(`/${request.portraitId}/${brandDirectory}manifest.json`));
        if (bannerStatus === 'unpublished') {
          await route.fulfill({ status: 404 });
          return;
        }
        const portraitId = request.portraitId;
        const prefix = `TestEvent/8-Banner-Output/${portraitId}/${brandDirectory}`;
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            schemaVersion: 1, portraitId, brand: variationBrand,
            status: bannerStatus === 'preview-unavailable' ? 'ready' : bannerStatus,
            assets: [
              { id: 'banner_pdf', label: 'Banner PDF', status: 'ready', mimeType: 'application/pdf', blob: `${prefix}banner.pdf` },
              ...(bannerStatus === 'preview-unavailable' ? [{
                id: 'preview', label: 'Preview', status: 'unavailable', mimeType: null, blob: null,
              }] : Array.from({ length: 23 }, (_, i) => ({
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
        if (preparationOnly) {
          await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
              schemaVersion: 1, preparation: true, requestId: preparation.requestId,
              portraitId: preparation.portraitId, eventPrefix: preparation.eventPrefix,
              request: preparation, selectedBrand: null, printScope: null, stage: 'prepared',
              render: { status: 'ready' }, fulfillment: { status: 'pending' },
            }),
          });
          return;
        }
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
        let names = [];
        if (prefix.endsWith('/portraits/pending/')) names = ['mock.jpg'];
        else if (sourceAdsReady) names = brands.map((brand, i) => `mock_${i + 1}-${brand}.jpg`);
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
    await page.locator('.kiosk-demo-card').first().waitFor();
    assert.equal(await page.locator('.kiosk-demo-card').count(), 3);
    assert.equal(await page.locator('.kiosk-demo-label').count(), 0);
    const portraitRefresh = await page.locator('.kiosk-refresh-assets').boundingBox();
    assert(portraitRefresh.x < 30 && portraitRefresh.y > 1030);
    const portraitRefreshStyle = await page.locator('.kiosk-refresh-assets').evaluate((node) => {
      const style = getComputedStyle(node);
      return [style.fontSize, style.fontWeight, style.color];
    });
    assert.deepEqual(portraitRefreshStyle, ['11px', '600', 'rgba(255, 255, 255, 0.42)']);
    await page.locator('.kiosk-refresh-assets').click();
    await page.locator('.kiosk-portrait-grid button').first().waitFor();
    if (process.env.KIOSK_SCREENSHOT_DIR) {
      await page.screenshot({ path: path.join(process.env.KIOSK_SCREENSHOT_DIR, 'portrait-picker.png') });
    }
    await page.locator('.kiosk-portrait-grid button').first().click();
    await page.keyboard.press('Enter');
    await page.locator('.kiosk-name input').fill('Mock Print');
    assert.equal(prepareWrites, 0);
    assert.equal(writes, 0);
    await page.locator('.kiosk-name .kiosk-primary-action').click();
    await page.getByRole('alert').waitFor();
    assert.equal(prepareWrites, 1);
    assert.equal(writes, 0);
    const savedPreparation = await page.evaluate(() => JSON.parse(
      sessionStorage.getItem('glam-attendee-v1:azure:TestEvent'),
    ));
    assert.deepEqual(savedPreparation.prepareRequest, preparation);
    assert.equal(savedPreparation.prepareSubmitted, false);
    await page.reload();
    await page.locator('.kiosk-coworker-copy .kiosk-graph-input-status').waitFor({ state: 'attached' });
    assert.equal(prepareWrites, 2);
    assert.equal(writes, 0);
    const confirmedPreparation = await page.evaluate(() => JSON.parse(
      sessionStorage.getItem('glam-attendee-v1:azure:TestEvent'),
    ));
    assert.equal(confirmedPreparation.prepareSubmitted, true);
    sourceAdsReady = true;
    assert.equal(await page.locator('.kiosk-coworker-copy h2').innerText(), 'CX Enterprise Coworker');
    assert.equal(await page.locator('.kiosk-story-subcopy').innerText(),
      'Find the work and information you need all in one place. No hunting through projects, folders, or tools.');
    assert.equal(await page.locator('.kiosk-story-subcopy').evaluate((node) => (
      getComputedStyle(node).whiteSpace
    )), 'pre-line');
    assert.equal(await page.locator('.kiosk-panel-coworker > .kiosk-graph-input-status').count(), 0);
    const shellCopyBox = await page.locator('.kiosk-coworker-copy').boundingBox();
    const shellFrameBox = await page.locator('.kiosk-frame-slot').boundingBox();
    assert(shellCopyBox.x + shellCopyBox.width < shellFrameBox.x);
    const jumpStyle = await page.getByRole('button', { name: 'Jump to Ads', exact: true }).evaluate((node) => {
      const style = getComputedStyle(node);
      return { size: style.fontSize, color: style.color, weight: style.fontWeight };
    });
    const settingsStyle = await page.locator('.kiosk-badge a').evaluate((node) => {
      const style = getComputedStyle(node);
      return { size: style.fontSize, color: style.color, weight: style.fontWeight };
    });
    assert.deepEqual(jumpStyle, settingsStyle);
    const jumpBox = await page.getByRole('button', { name: 'Jump to Ads', exact: true }).boundingBox();
    assert(jumpBox.x < 30 && jumpBox.y > 1030);
    assert.equal(await page.locator('.kiosk-graph-input-status').evaluate((node) => getComputedStyle(node).clipPath), 'inset(50%)');
    const storyFrame = page.frameLocator('.kiosk-frame-slot iframe');
    await storyFrame.locator('[contenteditable="true"]').waitFor();
    const emitBeat = (beat) => storyFrame.locator('body').evaluate((body, value) => {
      window.parent.postMessage({ type: 'KIOSK_STORY_BEAT', beat: value }, window.location.origin);
    }, beat);
    const currentHeading = page.locator('.kiosk-story-text:not([aria-hidden]) h2');
    const beats = [
      ['overview', 'Step back in', 'Pull up your active tasks to instantly understand campaign context, deadlines, and next actions.'],
      ['brief', 'Get up to speed', 'Bring the brief into focus to review creative direction, audience, and required assets.'],
      ['performance', 'Build on what worked', 'Compare past performance to see which creative choices connected without digging through reports.'],
      ['creative', 'Take creative control', 'Move into Firefly Graph to refine your hero assets and explore new visual treatments while keeping the original subject intact.'],
    ];
    await storyFrame.locator('[contenteditable="true"]').focus();
    const copyFrameBefore = await page.locator('.kiosk-frame-slot').boundingBox();
    for (const [beat, heading, sub] of beats) {
      await emitBeat(beat);
      await currentHeading.getByText(heading, { exact: true }).waitFor();
      assert.equal(await currentHeading.evaluate((node) => getComputedStyle(node).fontSize), '80px');
      assert.equal(await page.locator('.kiosk-story-text:not([aria-hidden]) p').innerText(), sub);
      assert.equal(await page.locator('.kiosk-story-copy').evaluate((node) => getComputedStyle(node).overflowY), 'clip');
      assert.equal(await page.locator('.kiosk-story-text:not([aria-hidden])').evaluate((node) => (
        node.getAnimations()[0]?.effect.getKeyframes()[0].transform
      )), 'translateY(100%)');
      await page.waitForFunction(() => document.querySelectorAll('.kiosk-story-text[aria-hidden]').length === 0);
      assert.equal(await page.locator('.kiosk-story-text').count(), 1);
      assert.deepEqual(await page.locator('.kiosk-frame-slot').boundingBox(), copyFrameBefore);
      assert.equal(await storyFrame.locator('[contenteditable="true"]').evaluate((node) => (
        node === document.activeElement
      )), true);
      if (process.env.KIOSK_SCREENSHOT_DIR) {
        await page.screenshot({ path: path.join(process.env.KIOSK_SCREENSHOT_DIR, `story-${beat}.png`) });
      }
    }
    await emitBeat('creative');
    assert.equal(await page.locator('.kiosk-story-text').count(), 1);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await emitBeat('brief');
    await currentHeading.getByText('Get up to speed', { exact: true }).waitFor();
    assert.equal(await page.locator('.kiosk-story-text').count(), 1);
    assert.equal(await page.locator('.kiosk-story-text').evaluate((node) => node.getAnimations().length), 0);
    await emitBeat('home');
    await currentHeading.getByText('CX Enterprise Coworker', { exact: true }).waitFor();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await storyFrame.getByRole('button', { name: 'Send', exact: true }).click();
    await currentHeading.getByText('Step back in', { exact: true }).waitFor();
    await storyFrame.getByRole('button', { name: 'Select L’Oréal Paris campaign brief', exact: true }).click();
    await currentHeading.getByText('Get up to speed', { exact: true }).waitFor();
    await storyFrame.getByRole('button', { name: 'Send', exact: true }).click();
    await currentHeading.getByText('Build on what worked', { exact: true }).waitFor();
    await storyFrame.getByRole('button', { name: 'Send', exact: true }).click();
    await currentHeading.getByText('Take creative control', { exact: true }).waitFor();
    await page.evaluate(() => {
      window.graphReturns = 0;
      window.addEventListener('message', (event) => {
        if (event.data?.type === 'KIOSK_NAV' && event.data.target === 'view-graph-return') window.graphReturns += 1;
      });
    });
    await storyFrame.locator('body').evaluate(() => {
      const original = window.open.bind(window);
      window.open = () => original('about:blank', '_blank');
    });
    const popupPromise = page.waitForEvent('popup');
    await storyFrame.getByRole('button', { name: 'Open Firefly Graph', exact: true }).click();
    const popup = await popupPromise;
    await popup.close();
    await page.locator('.kiosk-graph-video').waitFor();
    assert.equal(await page.locator('.kiosk-ad-intro-copy h2').innerText(), 'Scaling your heros.\nBuilding your ads');
    assert.equal(await page.locator('.kiosk-ad-intro-copy p').innerText(), 'Still your creative, just faster.');
    assert.equal(await page.locator('.kiosk-ad-grid').evaluate((node) => node.inert), true);
    const videoBox = await page.locator('.kiosk-graph-video').boundingBox();
    const hiddenAdsBox = await page.locator('.kiosk-ad-grid').boundingBox();
    assert(Math.abs(videoBox.width - videoBox.height) < 1);
    assert(Math.abs(videoBox.x - hiddenAdsBox.x) < 1 && Math.abs(videoBox.y - hiddenAdsBox.y) < 1);
    assert(Math.abs(videoBox.width - hiddenAdsBox.width) < 1 && Math.abs(videoBox.height - hiddenAdsBox.height) < 1);
    await storyFrame.locator('body').evaluate(() => {
      window.postMessage({ type: 'ADOBE_GRAPH_DONE' }, window.location.origin);
    });
    assert.equal(await page.evaluate(() => window.graphReturns), 1);
    if (process.env.KIOSK_SCREENSHOT_DIR) {
      await page.screenshot({ path: path.join(process.env.KIOSK_SCREENSHOT_DIR, 'graph-return-video.png') });
    }
    await page.locator('.kiosk-graph-video').waitFor({ state: 'detached', timeout: 20000 });
    assert.equal(await page.locator('.kiosk-ad-grid').evaluate((node) => node.inert), false);
    assert.equal(await page.evaluate(() => window.graphReturns), 1);
    assert.deepEqual(await page.locator('.kiosk-ad-grid').boundingBox(), hiddenAdsBox);
    assert.equal(writes, 0);
    await page.locator('.kiosk-composer-send').waitFor();
    assert.equal(await page.locator('.kiosk-ad-copy h2').evaluate((node) => (
      node === document.activeElement
    )), true);
    assert.equal(await page.locator('.kiosk-ad-copy h2').evaluate((node) => (
      getComputedStyle(node).outlineStyle
    )), 'none');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => (
      document.activeElement.matches('button:focus-visible')
        && getComputedStyle(document.activeElement).outlineStyle === 'solid'
    )), true);
    assert.equal(await page.locator('.kiosk-composer-send').isDisabled(), true);
    const sendBox = await page.locator('.kiosk-composer-send').boundingBox();
    const sendIconBox = await page.locator('.kiosk-composer-send-icon').boundingBox();
    assert(Math.abs(sendBox.x + sendBox.width / 2 - sendIconBox.x - sendIconBox.width / 2) < 0.5);
    assert(Math.abs(sendBox.y + sendBox.height / 2 - sendIconBox.y - sendIconBox.height / 2) < 0.5);
    assert.equal(await page.evaluate(() => localStorage.getItem('glam-kiosk-completed-v1:TestEvent')), null);
    await page.locator('.kiosk-ad-grid button').first().click();
    const favoriteHistory = await page.evaluate(() => localStorage.getItem('glam-kiosk-completed-v1:TestEvent'));
    assert.equal(JSON.parse(favoriteHistory).length, 1);
    assert.equal(writes, 0);
    await page.locator('.kiosk-ad-grid button').nth(3).click();
    assert.equal(await page.evaluate(() => localStorage.getItem('glam-kiosk-completed-v1:TestEvent')), favoriteHistory);
    assert.equal(await page.locator('.kiosk-composer.has-selection').count(), 1);
    assert((await page.locator('.kiosk-composer-thumbnail-image').getAttribute('src'))
      .includes('lorealparis'));
    const gridBox = await page.locator('.kiosk-ad-grid').boundingBox();
    const dockBox = await page.locator('.kiosk-composer').boundingBox();
    const adCopyBox = await page.locator('.kiosk-ad-copy').boundingBox();
    assert(dockBox.x + dockBox.width < gridBox.x);
    assert(dockBox.y >= adCopyBox.y + adCopyBox.height);
    assert.equal(Math.round(dockBox.width), 540);
    assert(gridBox.width > 800);
    await page.getByRole('button', { name: 'Remove selected ad', exact: true }).click();
    assert.equal(await page.locator('.kiosk-composer.has-selection').count(), 0);
    assert.equal(await page.locator('.kiosk-composer-send').isDisabled(), true);
    assert.equal(await page.locator('.kiosk-ad-grid [aria-pressed="true"]').count(), 0);
    await page.locator('.kiosk-ad-grid button').nth(selectedBrandIndex).click();
    if (process.env.KIOSK_SCREENSHOT_DIR) {
      await page.screenshot({ path: path.join(process.env.KIOSK_SCREENSHOT_DIR, 'engulf-ads.png') });
    }
    await page.locator('.kiosk-composer-send').click();
    await page.getByRole('alert').waitFor();
    assert.equal(writes, 1);
    assert.equal(await page.evaluate(() => localStorage.getItem('glam-kiosk-completed-v1:TestEvent')), favoriteHistory);
    assert.equal(await page.locator('.kiosk-engulf-ghost').count(), 0);
    await page.reload();
    const coworker = page.frameLocator('.kiosk-frame-slot iframe');
    await coworker.locator('body').waitFor({ state: 'attached' });
    await coworker.locator('button').first().waitFor({ state: 'attached' });
    const coworkerURL = new URL(await page.locator('.kiosk-frame-slot iframe').getAttribute('src'));
    assert.equal(coworkerURL.pathname, '/coworker/index.html');
    assert(coworkerURL.searchParams.has('kiosk-preview'));
    assert.equal(coworkerURL.hash, '#/loreal/home');
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
    ['requestId', 'eventPrefix', 'portraitId', 'attendeeName', 'lang', 'createdAt'].forEach((field) => {
      assert.equal(request[field], preparation[field]);
    });
    assert.equal(prepareWrites, 2);
    assert.equal(await page.evaluate(() => (
      [localStorage, sessionStorage].some((storage) => Object.keys(storage)
        .some((key) => storage.getItem(key).includes('MOCK_GRAPH_ONLY')))
    )), false);
    assert.equal(writes, 2);
    assert.equal(await page.locator('.kiosk-panel-continued h2').innerText(), 'Test your thinking');
    assert.equal(await page.locator('.kiosk-panel-continued h2').evaluate((node) => getComputedStyle(node).fontSize), '80px');
    assert.equal(await page.locator('.kiosk-panel-continued .kiosk-story-subcopy').innerText(),
      'Simulate audience reactions to your creative before you commit to production.');
    const continuedCopyFrame = await page.locator('.kiosk-frame-slot').boundingBox();
    if (process.env.KIOSK_SCREENSHOT_DIR) {
      await page.screenshot({ path: path.join(process.env.KIOSK_SCREENSHOT_DIR, 'story-simulate.png') });
    }
    assert.equal(await page.locator('.kiosk-panel-continued .kiosk-coworker-copy > button').count(), 0);
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
    await page.locator('.kiosk-story-text:not([aria-hidden]) h2').getByText('See what resonates', { exact: true }).waitFor();
    assert.equal(await page.locator('.kiosk-story-text:not([aria-hidden]) p').innerText(),
      'See where your creative connects and gain feedback on clarity, relevance, and appeal to help refine.');
    await page.waitForFunction(() => document.querySelectorAll('.kiosk-story-text[aria-hidden]').length === 0);
    assert.deepEqual(await page.locator('.kiosk-frame-slot').boundingBox(), continuedCopyFrame);
    if (process.env.KIOSK_SCREENSHOT_DIR) {
      await page.screenshot({ path: path.join(process.env.KIOSK_SCREENSHOT_DIR, 'story-results.png') });
    }
    const completionPrompt = "I'm done with my task of generating new hero assets";
    await coworker.locator('[contenteditable="true"]', { hasText: completionPrompt }).waitFor();
    await coworker.locator('[contenteditable="true"]').evaluate((node) => node.blur());
    await coworker.locator('body').evaluate(() => {
      window.graphOpened = [];
      window.open = (url) => {
        window.graphOpened.push(url);
        return { focus() {} };
      };
    });
    const graphButtons = coworker.getByRole('button', { name: 'Open Firefly Graph', exact: true });
    await graphButtons.first().waitFor();
    await coworker.locator('body').evaluate(() => { window.open = () => null; });
    await graphButtons.first().click();
    await coworker.getByRole('alert').filter({
      hasText: 'Firefly Graph could not open. Allow pop-ups for this kiosk site, then click Open Firefly Graph again.',
    }).waitFor();
    await coworker.locator('body').evaluate(() => {
      window.graphOpened = [];
      window.open = (url) => {
        window.graphOpened.push(url);
        return { focus() {} };
      };
    });
    await graphButtons.first().click();
    const graphLaunch = await coworker.locator('body').evaluate(() => window.graphOpened[0]);
    const launchedURL = new URL(graphLaunch);
    assert.equal(launchedURL.origin, 'https://firefly.adobe.com');
    assert(launchedURL.pathname.endsWith('08944592-9145-526f-8b43-75400178e5ee'));
    const cutoutURL = new URL(new URLSearchParams(launchedURL.hash.slice(1)).get('portraitUrl'));
    assert.equal(cutoutURL.searchParams.get('sig'), 'MOCK_GRAPH_ONLY');
    assert(cutoutURL.pathname.endsWith(`/9-Graph-Input/${request.portraitId}/portrait.png`));
    await coworker.getByRole('button', { name: 'Send', exact: true }).click();
    await coworker.getByText('Firefly Creative Production workflow', { exact: false }).first().waitFor();
    await page.evaluate(() => {
      window.handoffAnimations = [];
      const animate = Element.prototype.animate;
      Element.prototype.animate = function record(frames, options) {
        window.handoffAnimations.push({
          className: this.className, frames, duration: options.duration, delay: options.delay || 0,
        });
        return animate.call(this, frames, options);
      };
    });
    await coworker.getByRole('button', { name: 'Open Workflow Results', exact: true }).waitFor();
    await page.locator('.kiosk-story-text:not([aria-hidden]) h2')
      .getByText('Let Coworker make the variations', { exact: true }).waitFor();
    assert.equal(await page.locator('.kiosk-story-text:not([aria-hidden]) p').innerText(),
      'Take your design, and scale it to every size, language, and variation.');
    await coworker.getByRole('button', { name: 'Open Workflow Results', exact: true }).click();
    await page.locator('.kiosk-panel-variations').waitFor();
    assert.equal(await page.locator('.kiosk-variations-copy .kiosk-story-text p').innerText(),
      'Turn your approved hero ad into campaign-ready variations, without rebuilding each asset by hand');
    const reveal = await page.evaluate(() => window.handoffAnimations);
    assert(reveal.some((animation) => animation.className.includes('kiosk-frame-slot')
      && animation.duration === 1000));
    assert.equal(await page.locator('.kiosk-variation').count(), 0);
    assert.equal(await page.getByText('One idea. A whole world of content.', { exact: true }).count(), 0);
    assert.equal(await page.locator('.kiosk-variations-status').innerText(),
      'Variations for your selected brand are not available yet. Checking again automatically.');
    bannerStatus = 'ready';
    await page.waitForFunction(() => document.querySelectorAll('.kiosk-variation').length === 23,
      null, { timeout: 10000 });
    assert.equal(await page.locator('.kiosk-variation').count(), 23);
    assert.equal(await page.locator('.kiosk-variation img').evaluateAll((images) => (
      new Set(images.map((image) => image.src)).size
    )), 23);
    await page.locator('.kiosk-variation img').evaluateAll(async (images) => {
      await Promise.all(images.map((image) => new Promise((resolve, reject) => {
        const check = new Image();
        check.onload = resolve;
        check.onerror = reject;
        check.src = image.src;
      })));
    });
    assert.equal(await page.locator('.kiosk-variations-notice').count(), 0);
    assert.equal(await page.locator('.kiosk-variations-status').innerText(), '');
    assert.equal(await page.locator('.kiosk-banner-download').count(), 1);
    assert.equal(await page.locator('.kiosk-variation img[src*=".pdf"]').count(), 0);
    await page.waitForFunction(() => new DOMMatrix(getComputedStyle(
      document.querySelector('.kiosk-variations-track'),
    ).transform).m42 < -5);
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
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const pausedTransform = await page.locator('.kiosk-variations-track').first().evaluate((node) => node.style.transform);
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 750)));
    assert.equal(await page.locator('.kiosk-variations-viewport').evaluate((view) => view.scrollTop), pausedScroll);
    assert.equal(await page.locator('.kiosk-variations-track').first().evaluate((node) => node.style.transform), pausedTransform);
    await page.waitForFunction((transform) => (
      document.querySelector('.kiosk-variations-track').style.transform !== transform
    ), pausedTransform, { timeout: 2000 });
    const workflowRequests = [];
    assert.equal(await page.locator('.kiosk-variations-copy h2').innerText(), 'Beauty, amplified');
    assert.equal(await page.locator('.kiosk-variations-intro p').innerText(),
      'Turn your approved hero ad into campaign-ready variations, without rebuilding each asset by hand');
    const trackWorkflow = (request) => {
      if (/\/api\/|\/production-workflow\//.test(request.url())) workflowRequests.push(request.url());
    };
    page.on('request', trackWorkflow);
    await page.getByRole('button', { name: 'View production workflow', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    const workflowFrame = page.locator('.kiosk-workflow-dialog iframe');
    assert.equal(await workflowFrame.getAttribute('src'), 'http://localhost:3017/production-workflow/index.html?workflow=banners&preview=eds');
    assert.equal(await workflowFrame.getAttribute('sandbox'), 'allow-scripts allow-same-origin');
    const canvas = page.frameLocator('.kiosk-workflow-dialog iframe');
    await canvas.locator('.react-flow__node').first().waitFor({ timeout: 15000 });
    assert.equal(await canvas.locator('.react-flow__node').count(), 9);
    assert.equal(await canvas.locator('.react-flow__edge').count(), 10);
    assert.equal(await page.locator('.kiosk-workflow-bar h2').innerText(), 'Firefly Creative Production for Enterprise');
    assert.equal(await page.locator('.kiosk-workflow-dialog').evaluate((node) => getComputedStyle(node).backgroundColor), 'rgb(44, 44, 44)');
    assert.equal(await page.locator('.kiosk-workflow-bar h2').evaluate((node) => getComputedStyle(node).color), 'rgb(255, 255, 255)');
    assert.equal(await page.locator('.kiosk-workflow-close').evaluate((node) => getComputedStyle(node).color), 'rgb(255, 255, 255)');
    assert.equal(await page.locator('.kiosk-workflow-bar h2').evaluate((node) => getComputedStyle(node).fontFamily.includes('condensed')), false);
    await canvas.getByText('Loreal-ads-atscale-simple.csv', { exact: true }).waitFor();
    const attendeePreview = await page.locator('.kiosk-variation img').first().getAttribute('src');
    const workflowImages = [
      canvas.locator(`img[src*="/9-Graph-Input/${request.portraitId}/portrait.png"]`),
      canvas.locator(`img[src="${attendeePreview}"]`),
    ];
    for (const image of workflowImages) {
      await image.waitFor();
      await image.evaluate((node) => {
        if (node.complete) return;
        return new Promise((resolve, reject) => {
          node.addEventListener('load', resolve, { once: true });
          node.addEventListener('error', () => reject(new Error('Workflow image failed to load')), { once: true });
        });
      });
      assert.ok(await image.evaluate((node) => node.naturalWidth > 0));
    }
    assert.equal(await canvas.locator('img[src*="portrait-cutout-"], img[src*="banner-1080x1920-"]').count(), 0);
    const frameBox = await workflowFrame.boundingBox();
    assert.ok(frameBox.width > 400 && frameBox.height > 300);
    await page.waitForFunction(() => document.querySelector('.kiosk-workflow-dialog').getAnimations().every((a) => a.playState === 'finished'));
    if (process.env.KIOSK_SCREENSHOT_DIR) {
      await page.screenshot({ path: `${process.env.KIOSK_SCREENSHOT_DIR}/production-workflow-modal.png` });
    }
    const workflowNode = (id) => canvas.locator(`.react-flow__node[data-id="${id}"]`);
    const previewNode = workflowNode('node-1791265273787-sqjsvf0ys');
    const previewTransform = await previewNode.evaluate((node) => node.style.transform);
    const previewTitle = await previewNode.getByText('Preview', { exact: true }).first().boundingBox();
    await page.mouse.move(previewTitle.x + 5, previewTitle.y + 5);
    await page.mouse.down();
    await page.mouse.move(previewTitle.x - 40, previewTitle.y + 30, { steps: 8 });
    await page.mouse.up();
    assert.notEqual(await previewNode.evaluate((node) => node.style.transform), previewTransform);
    const renditionEdge = canvas.locator('.react-flow__edge[aria-label="Edge from node-1791265250852-8q4474svr to banner-validate-brand"]');
    await renditionEdge.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Delete');
    assert.equal(await canvas.locator('.react-flow__edge').count(), 9);
    const connectPorts = async (sourceId, sourcePort, targetId, targetPort) => {
      const source = await workflowNode(sourceId).locator(`.react-flow__handle.source[data-handleid="${sourcePort}"]`).boundingBox();
      const target = await workflowNode(targetId).locator(`.react-flow__handle.target[data-handleid="${targetPort}"]`).boundingBox();
      assert.ok(source && target);
      await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
      await page.mouse.down();
      await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 15 });
      await page.mouse.up();
    };
    await connectPorts('node-1791265250852-8q4474svr', 'output', 'banner-validate-brand', 'input-image');
    await renditionEdge.waitFor();
    assert.equal(await canvas.locator('.react-flow__edge').count(), 10);
    await connectPorts('node_1791265169277_gd94ntsb7_0_nkvua7', 'outputs', 'banner-validate-brand', 'input-image');
    await canvas.locator('.react-flow__edge[aria-label="Edge from node_1791265169277_gd94ntsb7_0_nkvua7 to banner-validate-brand"]').waitFor();
    assert.equal(await canvas.locator('.react-flow__edge').count(), 11);
    await connectPorts('node-1791265265414-jy1s43s8r', 'output', 'banner-validate-brand', 'input-image');
    assert.equal(await canvas.locator('.react-flow__edge').count(), 11);
    assert.equal(await canvas.locator('.react-flow__edge[aria-label="Edge from node-1791265265414-jy1s43s8r to banner-validate-brand"]').count(), 0);
    const quality = canvas.getByRole('button', { name: 'High Quality', exact: true });
    await quality.click();
    await canvas.getByRole('option', { name: 'Medium', exact: true }).click();
    await canvas.getByRole('button', { name: 'Medium Quality', exact: true }).waitFor();
    await workflowNode('node_1791555727515_npd3yw2qa_7_9a2dst').getByText('Push assets to Workfront', { exact: true }).click();
    await page.keyboard.press('Delete');
    assert.equal(await canvas.locator('.react-flow__node').count(), 8);
    await canvas.getByPlaceholder('Search and add nodes').click();
    await page.keyboard.type('Preview');
    await canvas.locator('.search-result-item.selected').waitFor();
    await page.keyboard.press('Enter');
    assert.equal(await canvas.locator('.react-flow__node').count(), 9);
    assert.ok(workflowRequests.some((url) => url.includes('/production-workflow/assets/')));
    const closeWorkflow = page.getByRole('button', { name: 'Close window', exact: true });
    assert.equal(await closeWorkflow.innerText(), '×');
    await closeWorkflow.click();
    await page.locator('.kiosk-workflow-closing').waitFor();
    await page.locator('.kiosk-workflow-dialog').waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal(await page.locator('.kiosk-variations-controls').getByRole('button', { name: 'Finish', exact: true }).isEnabled(), true);
    assert.equal(await page.getByRole('button', { name: 'View production workflow', exact: true }).evaluate((node) => node === document.activeElement), true);
    await page.getByRole('button', { name: 'View production workflow', exact: true }).click();
    await canvas.locator('.react-flow__node').first().waitFor({ timeout: 15000 });
    await workflowImages[0].waitFor();
    assert.equal(await workflowImages[1].count(), 1);
    assert.equal(await canvas.locator('.react-flow__node').count(), 9);
    assert.equal(await canvas.locator('.react-flow__edge').count(), 10);
    assert.equal(await canvas.locator('.react-flow__node[data-id="node_1791555727515_npd3yw2qa_7_9a2dst"]').count(), 1);
    await canvas.getByRole('button', { name: 'High Quality', exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('.kiosk-workflow-dialog').getAnimations().every((animation) => animation.playState === 'finished'));
    const dialogBounds = await page.getByRole('dialog').boundingBox();
    await page.mouse.click(dialogBounds.x + 8, dialogBounds.y + 8);
    assert.equal(await page.getByRole('dialog').count(), 1);
    await page.mouse.move(dialogBounds.x + 8, dialogBounds.y + 8);
    await page.mouse.down();
    await page.mouse.move(dialogBounds.x - 10, dialogBounds.y + 8);
    await page.mouse.up();
    assert.equal(await page.getByRole('dialog').count(), 1);
    await page.mouse.click(dialogBounds.x - 10, dialogBounds.y + 8);
    await page.waitForFunction(() => !document.querySelector('.kiosk-workflow-dialog'));
    assert.equal(await page.getByRole('button', { name: 'View production workflow', exact: true }).evaluate((node) => node === document.activeElement), true);
    await page.getByRole('button', { name: 'View production workflow', exact: true }).click();
    await canvas.locator('.react-flow__node').first().waitFor({ timeout: 15000 });
    await page.keyboard.press('Escape');
    await page.locator('.kiosk-workflow-dialog').waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('dialog').count(), 0);
    graphUnavailable = true;
    await page.getByRole('button', { name: 'View production workflow', exact: true }).click();
    await page.getByText('The attendee cutout is unavailable or expired. No sample portrait is substituted.', { exact: true }).waitFor();
    await canvas.locator('.react-flow__node').first().waitFor({ timeout: 15000 });
    assert.equal(await canvas.locator('img[src*="/9-Graph-Input/"], img[src*="portrait-cutout-"]').count(), 0);
    await workflowImages[1].waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.kiosk-workflow-dialog').waitFor({ state: 'detached' });
    graphUnavailable = false;
    page.off('request', trackWorkflow);
    assert.equal(workflowRequests.some((url) => url.includes('/api/')), false);
    await page.reload();
    await page.locator('.kiosk-panel-variations').waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.kiosk-variation').length === 23);
    assert.equal(await page.locator('.kiosk-variation').count(), 23);
    assert.equal(writes, 2);
    if (process.env.KIOSK_SCREENSHOT_DIR) {
      await page.waitForFunction(() => document.querySelector('.kiosk-variations-intro').getAnimations().every((animation) => animation.playState === 'finished'));
      await page.screenshot({ path: path.join(process.env.KIOSK_SCREENSHOT_DIR, 'variations.png') });
    }
    bannerStatus = 'preview-unavailable';
    await page.reload();
    await page.getByText('Image previews are unavailable. Open the PDF if available, or ask booth staff.', { exact: true }).waitFor();
    assert.equal(await page.locator('.kiosk-variation').count(), 0);
    assert.equal(await page.locator('.kiosk-banner-download').count(), 1);
    assert.equal(await page.locator('.kiosk-variations-copy > :is(.kiosk-variations-status, .kiosk-variations-controls)')
      .evaluateAll((nodes) => nodes.map((node) => node.className).join()), 'kiosk-variations-status,kiosk-variations-controls');
    await page.getByRole('button', { name: 'View production workflow', exact: true }).click();
    await workflowImages[0].waitFor();
    assert.equal(await canvas.locator('.react-flow__node[data-id="node-1791265273787-sqjsvf0ys"] img').count(), 0);
    const modalFinish = page.locator('.kiosk-workflow-actions').getByRole('button', { name: 'Finish', exact: true });
    const finishBounds = await modalFinish.boundingBox();
    const modalBounds = await page.locator('.kiosk-workflow-dialog').boundingBox();
    assert(finishBounds.x + finishBounds.width > modalBounds.x + modalBounds.width - 40);
    assert(finishBounds.y + finishBounds.height > modalBounds.y + modalBounds.height - 40);
    await modalFinish.click();
    await page.locator('.kiosk-panel-ending').waitFor();
    assert.equal(writes, 2);
    assert.equal(await page.locator('.kiosk-workflow-dialog').count(), 0);
    await page.locator('.kiosk-ending-outgoing').waitFor({ state: 'detached' });
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
    assert.equal(await page.locator('.kiosk-print-status').innerText(), 'Preparing your take-home ad');
    preparationOnly = false;
    qrPublished = true;
    await page.locator('.kiosk-panel-ending').getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.locator('.kiosk-ending-copy h2').waitFor();
    assert.equal(await page.locator('.kiosk-share-qr').count(), 0);
    assert.equal(await page.locator('.kiosk-print-preview').count(), 0);
    assert.equal(await page.locator('.kiosk-ending-copy h2').innerText(), 'Thank you');
    assert.equal(writes, 2);
    await page.reload();
    await page.locator('.kiosk-ending-copy h2').waitFor();
    assert.equal(await page.locator('.kiosk-share-qr').count(), 0);
    assert.equal(await page.locator('.kiosk-print-preview').count(), 0);
    assert.equal(writes, 2);
    previewReady = true;
    await page.locator('.kiosk-panel-ending').getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.locator('.kiosk-print-preview').waitFor();
    assert.equal(await page.locator('.kiosk-share-qr').count(), 0);
    completed = true;
    await page.locator('.kiosk-panel-ending').getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByText('I hope your enjoyed this enterprise content supply chain journey.', { exact: false }).waitFor();
    assert.equal(await page.locator('.kiosk-qr-link').count(), 0);
    assert.equal(await page.locator('.kiosk-ending-media img').count(), 1);
    assert.equal(await page.locator('.kiosk-ending-copy h2').innerText(), 'Thank you');
    assert((await page.locator('.kiosk-print-preview').getAttribute('src')).includes(`${request.selectedBrand}.jpg`));
    const copyBox = await page.locator('.kiosk-ending-copy').boundingBox();
    const mediaBox = await page.locator('.kiosk-ending-media').boundingBox();
    assert(mediaBox.x > copyBox.x + copyBox.width);
    assert(Math.abs(mediaBox.x - 785) < 1);
    assert(Math.abs(mediaBox.width - 961) < 1);
    assert(Math.abs(mediaBox.y - (1080 - 770.226) / 2) < 1);
    assert.equal(await page.locator('.kiosk-ending-actions').getByRole('button', { name: 'Start over', exact: true }).count(), 1);
    if (process.env.KIOSK_SCREENSHOT_DIR) {
      await page.screenshot({ path: path.join(process.env.KIOSK_SCREENSHOT_DIR, 'ending-single-print.png') });
    }
    const refreshBox = await page.getByRole('button', { name: 'Refresh', exact: true }).boundingBox();
    const startOverBox = await page.locator('.kiosk-ending-actions').getByRole('button', { name: 'Start over', exact: true }).boundingBox();
    assert.equal(await page.locator('.kiosk-ending-actions').getByRole('button', { name: 'Exit the experience', exact: true }).count(), 0);
    const endingBox = await page.locator('.kiosk-panel-ending').boundingBox();
    assert(Math.abs(refreshBox.x - endingBox.x - 20) < 1);
    assert(Math.abs(endingBox.y + endingBox.height - refreshBox.y - refreshBox.height - 14) < 1);
    assert(refreshBox.y > startOverBox.y + startOverBox.height);
    const refreshStyle = await page.locator('.kiosk-ending-refresh').evaluate((control) => {
      const style = getComputedStyle(control);
      return [style.fontSize, style.fontWeight, style.color, style.backgroundColor];
    });
    assert.deepEqual(refreshStyle, ['11px', '600', 'rgba(255, 255, 255, 0.42)', 'rgba(0, 0, 0, 0)']);
    assert((await page.locator('.kiosk-panel-ending').innerText()).includes('Please pick up your print at the counter as you leave.'));
    const imageSource = await page.locator('.kiosk-print-preview').getAttribute('src');
    assert.equal(new URL(imageSource).searchParams.get('sr'), 'c');
    assert.equal(new URL(new URL(downloadURL()).searchParams.get('session')).searchParams.get('sr'), 'b');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    const mobileCopy = await page.locator('.kiosk-ending-copy').boundingBox();
    const mobileMedia = await page.locator('.kiosk-ending-media').boundingBox();
    assert(mobileMedia.y >= mobileCopy.y + mobileCopy.height);
    const mobileRefresh = await page.getByRole('button', { name: 'Refresh', exact: true }).boundingBox();
    const mobileStartOver = await page.locator('.kiosk-ending-actions').getByRole('button', { name: 'Start over', exact: true }).boundingBox();
    const mobilePanel = await page.locator('.kiosk-panel-ending').boundingBox();
    assert(Math.abs(mobileRefresh.x - mobilePanel.x - mobilePanel.width * 0.04) < 1,
      JSON.stringify({ mobileRefresh, mobilePanel }));
    assert(Math.abs(mobilePanel.y + mobilePanel.height - mobileRefresh.y - mobileRefresh.height - 46) < 1);
    assert(mobileRefresh.y > mobileStartOver.y + mobileStartOver.height);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.locator('.kiosk-ending-actions').getByRole('button', { name: 'Start over', exact: true }).click();
    await page.locator('.kiosk-panel-welcome').waitFor();
    assert.equal(await page.evaluate(() => sessionStorage.getItem('glam-attendee-v1:azure:TestEvent')), null);
    assert.equal(prepareWrites, 2);
    await page.reload();
    await page.locator('.kiosk-consent input').check();
    await page.locator('.kiosk-print').click();
    await page.locator('.kiosk-portrait-grid').waitFor();
    assert.equal(await page.locator('.kiosk-portrait-grid .kiosk-card:not(.kiosk-demo-card)').count(), 0);
    assert.equal(await page.locator('.kiosk-portrait-grid .kiosk-demo-card').count(), 3);
    assert.equal(await page.locator('.kiosk-demo-label').count(), 0);
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
    assert.deepEqual(await download.locator('.max-download-gallery-btn').allTextContents(),
      ['Download', 'Download', 'Download', 'Download']);
    assert.equal(await download.locator('.max-download-gallery-btn img').count(), 0);
    assert.equal(await download.locator('.max-download-links a').count(), 3);
    assert.equal(await download.getByRole('link', { name: 'Work smarter with CX Enterprise Coworker', exact: true }).getAttribute('href'),
      'https://business.adobe.com/blog/enterprise-creatives-work-smarter-with-cx-enterprise-coworker');
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
    assert.equal(await page.locator('.kiosk-demo-label').count(), 0);
    assert.equal(await page.getByText('Generate a new SAS', { exact: false }).count(), 0);
    assert.equal(await page.getByText('Azure denied access', { exact: false }).count(), 0);
    failPortraitListing = false;
    await page.locator('.kiosk-demo-card').first().click();
    await page.locator('.kiosk-portrait-actions .kiosk-primary-action').click();
    await page.locator('.kiosk-name input').fill('Configured Demo');
    await page.locator('.kiosk-name .kiosk-primary-action').click();
    await page.getByRole('button', { name: 'Jump to Ads', exact: true }).click();
    await page.locator('.kiosk-ad-grid button').first().click();
    assert.equal(await page.evaluate(() => localStorage.getItem('glam-kiosk-completed-v1:TestEvent')), favoriteHistory);
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await page.getByText('Clear this attendee on this browser?', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await page.locator('.kiosk-panel-welcome').waitFor();
    await page.locator('.kiosk-consent input').check();
    await page.locator('.kiosk-print').click();
    await page.locator('.kiosk-demo-card').first().waitFor();
    assert.equal(await page.locator('.kiosk-demo-card').count(), 3);
    assert.equal(await page.locator('.kiosk-demo-label').count(), 0);
    assert.equal(writes, 2);
    const demo = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await demo.emulateMedia({ reducedMotion: 'reduce' });
    await demo.goto('http://localhost:3017/drafts/attendee-kiosk.html');
    await demo.locator('.kiosk-consent input').check();
    await demo.locator('.kiosk-print').click();
    await demo.locator('.kiosk-demo-card').first().waitFor();
    assert.equal(await demo.locator('.kiosk-demo-card').count(), 3);
    assert.equal(await demo.locator('.kiosk-demo-label').count(), 3);
    await demo.locator('.kiosk-portrait-grid button').first().click();
    await demo.keyboard.press('Enter');
    await demo.locator('.kiosk-name input').fill('Demo Animation');
    await demo.locator('.kiosk-name .kiosk-primary-action').click();
    const beatFrame = demo.frameLocator('.kiosk-frame-slot iframe');
    const liveHeading = demo.locator('.kiosk-story-text:not([aria-hidden]) h2');
    await beatFrame.getByRole('button', { name: 'Send', exact: true }).click();
    await liveHeading.getByText('Step back in', { exact: true }).waitFor();
    await beatFrame.getByRole('button', { name: 'Select L’Oréal Paris campaign brief', exact: true }).click();
    await liveHeading.getByText('Get up to speed', { exact: true }).waitFor();
    await beatFrame.getByRole('button', { name: 'Send', exact: true }).click();
    await liveHeading.getByText('Build on what worked', { exact: true }).waitFor();
    await beatFrame.getByRole('button', { name: 'Send', exact: true }).click();
    await liveHeading.getByText('Take creative control', { exact: true }).waitFor();
    await beatFrame.getByRole('button', { name: 'Open Firefly Graph', exact: true }).waitFor();
    if (process.env.KIOSK_SCREENSHOT_DIR) {
      await demo.screenshot({ path: path.join(process.env.KIOSK_SCREENSHOT_DIR, 'story-creative-integrated.png') });
    }
    await beatFrame.getByRole('button', { name: 'Home', exact: true }).click();
    await liveHeading.getByText('CX Enterprise Coworker', { exact: true }).waitFor();
    await beatFrame.locator('body').evaluate(() => {
      window.parent.postMessage({ type: 'KIOSK_NAV', target: 'view-graph-return' }, window.location.origin);
    });
    await demo.locator('.kiosk-graph-video').waitFor();
    await demo.addInitScript(() => {
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function playWithAutoplayBlock() {
        if (this.classList.contains('kiosk-graph-video') && !window.blockedGraphAutoplay) {
          window.blockedGraphAutoplay = true;
          return Promise.reject(new DOMException('Mock autoplay policy', 'NotAllowedError'));
        }
        return play.call(this);
      };
    });
    await demo.reload();
    await demo.locator('.kiosk-graph-video').waitFor();
    await demo.getByRole('button', { name: 'Play interstitial video', exact: true }).click();
    assert.equal(await demo.locator('.kiosk-ad-intro-copy h2').innerText(), 'Scaling your heros.\nBuilding your ads');
    await demo.setViewportSize({ width: 390, height: 844 });
    const mobileVideoBox = await demo.locator('.kiosk-graph-video').boundingBox();
    const mobileHiddenGrid = await demo.locator('.kiosk-ad-grid').boundingBox();
    assert(Math.abs(mobileVideoBox.width - mobileVideoBox.height) < 1);
    assert(Math.abs(mobileVideoBox.y - mobileHiddenGrid.y) < 1);
    await demo.locator('.kiosk-graph-video').evaluate((video) => {
      video.pause();
      video.dispatchEvent(new Event('error'));
    });
    await demo.getByText('The interstitial video could not play. Retry or continue to your ads.', { exact: true }).waitFor();
    await demo.getByRole('button', { name: 'Continue to ads', exact: true }).click();
    await demo.locator('.kiosk-graph-video').waitFor({ state: 'detached' });
    assert.equal(await demo.locator('.kiosk-ad-selection-copy h2').innerText(), 'Tell your unique story.');
    await demo.setViewportSize({ width: 1920, height: 1080 });
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
    assert.equal(await demo.locator('.kiosk-variation').count(), 9);
    assert.equal(await demo.locator('.kiosk-panel-variations').evaluate((panel) => (
      panel.scrollWidth <= panel.clientWidth
    )), true);
    await demo.getByRole('button', { name: 'Reset', exact: true }).click();
    await demo.getByText('Clear this attendee on this browser?', { exact: true }).waitFor();
    await demo.getByRole('button', { name: 'Reset', exact: true }).click();
    await demo.locator('.kiosk-panel-welcome').waitFor();
    assert.equal(await demo.locator('.kiosk-frame-slot iframe').count(), 0);
    await demo.setViewportSize({ width: 1920, height: 1080 });
    for (let index = 0; index < 3; index += 1) {
      await demo.locator('.kiosk-consent input').check();
      await demo.locator('.kiosk-print').click();
      await demo.locator('.kiosk-demo-card').first().waitFor();
      assert.equal(await demo.locator('.kiosk-demo-card').count(), 3);
      assert.equal(await demo.locator('.kiosk-demo-label').count(), 3);
      await demo.locator('.kiosk-demo-card').nth(index).click();
      await demo.locator('.kiosk-portrait-actions .kiosk-primary-action').click();
      await demo.locator('.kiosk-name input').fill('Demo Favorite');
      await demo.locator('.kiosk-name .kiosk-primary-action').click();
      await demo.getByRole('button', { name: 'Jump to Ads', exact: true }).click();
      await demo.locator('.kiosk-ad-grid button').first().click();
      assert.equal(await demo.evaluate(() => Object.keys(localStorage)
        .some((key) => key.startsWith('glam-kiosk-completed-v1:'))), false);
      await demo.getByRole('button', { name: 'Reset', exact: true }).click();
      await demo.getByText('Clear this attendee on this browser?', { exact: true }).waitFor();
      await demo.getByRole('button', { name: 'Reset', exact: true }).click();
      await demo.locator('.kiosk-panel-welcome').waitFor();
    }
    await demo.close();
    assert.equal(prepareWrites, 2);
    console.log('PASS mocked early all-four preparation, same-ID retry/reload/finalization, pending/ready ending, shares, legacy downloads, selected/all and reset.');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
