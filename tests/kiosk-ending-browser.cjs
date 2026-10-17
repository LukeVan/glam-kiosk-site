const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(path.join(path.dirname(fs.realpathSync(process.argv[2])), 'index.js'));

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const request = {
      schemaVersion: 1,
      requestId: '00000000-0000-4000-8000-000000000001',
      portraitId: `azure_${'a'.repeat(64)}`,
      eventPrefix: 'TestEvent',
      attendeeName: 'Test Attendee',
      selectedBrand: 'lorealprofessionnel',
      printScope: 'selected',
      showFinalQR: true,
      lang: 'en',
      createdAt: new Date().toISOString(),
    };
    const expiresAt = new Date(Date.now() + 86400000).toISOString();
    const containerSAS = `https://ffservices24.blob.core.windows.net/mock-assets?sv=2023-11-03&sr=c&sp=rl&se=${encodeURIComponent(expiresAt)}&sig=MOCK_ONLY`;
    const sessionURL = `https://ffservices24.blob.core.windows.net/mock-assets/TestEvent/7-Share-Output/${request.requestId}/session.json?sr=b&sp=r&se=${encodeURIComponent(expiresAt)}&sig=MOCK_ONLY`;
    const templateBlob = `TestEvent/7-Share-Output/${request.requestId}/${request.selectedBrand}.jpg`;
    let ready = true;
    let completed = false;
    let imageFailed = false;
    const methods = [];
    await page.route('https://ffservices24.blob.core.windows.net/**', async (route) => {
      methods.push(route.request().method());
      const url = new URL(route.request().url());
      if (url.pathname.includes('/requests-status/')) {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            schemaVersion: 1,
            requestId: request.requestId,
            portraitId: request.portraitId,
            eventPrefix: request.eventPrefix,
            selectedBrand: request.selectedBrand,
            request,
            render: {
              status: completed ? 'ready' : ready ? 'partial' : 'pending',
              brands: completed ? Object.fromEntries(
                ['larocheposay', 'lorealprofessionnel', 'yslbeauty', 'lorealparis'].map((brand) => [
                  brand, { status: 'ready', blob: `TestEvent/7-Share-Output/${request.requestId}/${brand}.jpg` },
                ]),
              ) : {
                [request.selectedBrand]: {
                  status: ready ? 'ready' : 'pending',
                  blob: ready ? templateBlob : null,
                },
              },
            },
            fulfillment: {
              scope: 'selected',
              status: completed ? 'submitted' : 'pending',
              brands: completed ? {
                [request.selectedBrand]: {
                  status: 'submitted',
                  blob: `TestEvent/6-Print-Output/${request.requestId}__${request.selectedBrand}_print.jpg`,
                },
              } : {},
            },
            share: {
              expiresAt,
              downloadPageUrl: `https://main--glam-kiosk-site--lukevan.aem.live/max-download.html?session=${encodeURIComponent(sessionURL)}`,
              qrBlob: `TestEvent/7-Share-Output/${request.requestId}/qr.png`,
            },
          }),
        });
      } else if (url.pathname.endsWith(`/${request.selectedBrand}.jpg`) && !imageFailed) {
        await route.fulfill({
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="961" height="646.226"><rect width="961" height="646.226" fill="white"/><rect width="646.226" height="646.226" fill="#ded5ee"/><text x="40" y="70" font-size="28">Mock personalized print</text></svg>',
        });
      } else await route.fulfill({ status: 404 });
    });
    await page.goto('http://localhost:3017/drafts/attendee-kiosk.html');
    await page.evaluate(async ({ settings, printRequest }) => {
      const { saveSettings } = await import('/scripts/kiosk-settings.js');
      const { initialState } = await import('/blocks/attendee-kiosk/state.js');
      saveSettings(localStorage, settings);
      sessionStorage.setItem(`glam-attendee-v1:azure:${settings.eventId}`, JSON.stringify({
        ...initialState(),
        stage: 'ending',
        consent: true,
        portraitId: printRequest.portraitId,
        name: printRequest.attendeeName,
        sessionId: 'mock-session',
        selectedAdId: `${printRequest.portraitId}_2`,
        printRequest,
      }));
    }, {
      settings: { version: 1, containerSAS, eventId: 'TestEvent', activationProfile: 'max', formType: 'none' },
      printRequest: request,
    });
    await page.reload();
    const image = page.locator('.kiosk-print-preview');
    await image.waitFor();
    await page.waitForFunction(() => document.fonts.status === 'loaded'
      && document.querySelector('.kiosk-print-preview')?.naturalWidth > 0);
    await image.evaluate(async (node) => Promise.all(
      node.getAnimations().map((animation) => animation.finished),
    ));
    assert.equal(await page.locator('.kiosk-ending-media img').count(), 1);
    assert.equal(await page.locator('.kiosk-share-qr, .kiosk-qr-link').count(), 0);
    const imageBox = await image.boundingBox();
    assert(Math.abs(imageBox.x - 785) < 1, JSON.stringify(imageBox));
    assert(Math.abs(imageBox.y - 278.887) < 1, JSON.stringify(imageBox));
    assert(Math.abs(imageBox.width - 961) < 1, JSON.stringify(imageBox));
    assert(Math.abs(imageBox.height - 646.226) < 1, JSON.stringify(imageBox));
    assert.equal(await page.locator('.kiosk-ending-copy h2').innerText(), 'Thank you');
    assert.equal(await page.locator('.kiosk-ending-copy h2').evaluate((node) => getComputedStyle(node).fontSize), '96px');
    assert.equal(await page.locator('.kiosk-ending-actions').getByRole('button', { name: 'Exit the experience', exact: true }).count(), 0);
    const printURL = new URL(await image.getAttribute('src'));
    assert.equal(printURL.pathname, `/mock-assets/${templateBlob}`);
    assert.equal(await page.locator('.kiosk-print-status').innerText(), 'Your ad is ready to take home');
    await image.evaluate((node) => { window.originalPrint = node; });
    await page.waitForTimeout(5200);
    assert(await image.evaluate((node) => node === window.originalPrint));
    assert.equal(await image.evaluate((node) => node.getAnimations().length), 0);
    if (process.env.KIOSK_SCREENSHOT_DIR) {
      await page.screenshot({ path: path.join(process.env.KIOSK_SCREENSHOT_DIR, 'ending-single-print.png') });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const copyBox = await page.locator('.kiosk-ending-copy').boundingBox();
    const mobileImage = await image.boundingBox();
    assert(mobileImage.y > copyBox.y + copyBox.height);
    assert(mobileImage.width < 390);
    assert(Math.abs(mobileImage.width / mobileImage.height - 961 / 646.226) < 0.01);
    await page.setViewportSize({ width: 1920, height: 1080 });
    completed = true;
    await page.reload();
    const pickup = page.locator('.kiosk-ending-copy > p');
    await pickup.filter({ hasText: 'Please pick up your print at the counter as you leave.' }).waitFor();
    assert.equal(await pickup.innerText(), 'I hope your enjoyed this enterprise content supply chain journey.\n\nPlease pick up your print at the counter as you leave.');
    assert.equal(await pickup.evaluate((node) => getComputedStyle(node).whiteSpace), 'pre-line');
    if (process.env.KIOSK_SCREENSHOT_DIR) {
      await page.waitForFunction(() => document.querySelector('.kiosk-print-preview')?.naturalWidth > 0);
      await page.screenshot({ path: path.join(process.env.KIOSK_SCREENSHOT_DIR, 'ending-pickup-copy.png') });
    }
    completed = false;
    imageFailed = true;
    await page.reload();
    await page.getByRole('alert').filter({ hasText: 'Your print preview could not load.' }).waitFor();
    assert.equal(await image.isVisible(), false);
    imageFailed = false;
    ready = false;
    await page.reload();
    await page.locator('.kiosk-ending-copy h2').waitFor();
    assert.equal(await image.count(), 0);
    assert.equal(await page.locator('.kiosk-share-qr').count(), 0);
    assert.equal(await page.locator('.kiosk-print-status').innerText(), 'Preparing your take-home ad');
    ready = true;
    await image.waitFor({ timeout: 10000 });
    await page.waitForFunction(() => document.querySelector('.kiosk-print-preview')?.naturalWidth > 0);
    assert.equal(await page.locator('.kiosk-print-status').innerText(), 'Your ad is ready to take home');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    await image.waitFor();
    await page.waitForFunction(() => document.querySelector('.kiosk-print-preview')?.naturalWidth > 0);
    assert(await image.evaluate((node) => node.getAnimations().every(
      (animation) => animation.effect.getTiming().duration <= 180,
    )));
    await page.getByRole('button', { name: 'Start over', exact: true }).click();
    await page.locator('.kiosk-panel-welcome').waitFor();
    assert(methods.every((method) => method === 'GET'));
    console.log('Single-print ending: desktop/mobile geometry, current template, pending/error, reset and read-only checks passed.');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
