const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(path.join(path.dirname(fs.realpathSync(process.argv[2])), 'index.js'));
const grantTestAccess = require('./kiosk-test-access.cjs');

const catalog = JSON.parse(fs.readFileSync('assets/offline-demos/catalog.json', 'utf8'));
const baseURL = process.env.KIOSK_BASE_URL || 'http://localhost:3017';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    context.setDefaultTimeout(15000);
    const azureRequests = [];
    const pageErrors = [];
    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.hostname.endsWith('.blob.core.windows.net')) azureRequests.push(url.hostname);
      if (url.pathname.startsWith('/.rum/')) await route.fulfill({ status: 204 });
      else if (['localhost', '127.0.0.1'].includes(url.hostname)) {
        assert.equal(request.method(), 'GET');
        await route.continue();
      } else await route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(error.message));
    async function checkGalleryWidth() {
      const bounds = await page.locator('.kiosk-variations-grid').evaluate((grid) => {
        const viewport = grid.closest('.kiosk-variations-viewport');
        const gallery = grid.getBoundingClientRect();
        return {
          width: gallery.width,
          available: viewport.clientWidth,
          offset: gallery.left - viewport.getBoundingClientRect().left - viewport.clientLeft,
        };
      });
      assert(Math.abs(bounds.width - bounds.available * 0.8) < 1);
      assert(Math.abs(bounds.offset - (bounds.available - bounds.width) / 2) < 1);
    }
    await page.goto(`${baseURL}/drafts/attendee-kiosk.html`);
    await grantTestAccess(page);
    assert.equal(await page.evaluate(() => localStorage.getItem('glam-kiosk-booth-v1')), null);
    let checked = 0;
    for (const person of catalog.people) {
      const profile = person.profiles.max_square;
      for (const [index, brand] of Object.keys(profile.variations).entries()) {
        await page.evaluate(async ({ id, index }) => {
          const { initialState } = await import('/blocks/attendee-kiosk/state.js');
          sessionStorage.setItem('glam-attendee-v1:offline-demo', JSON.stringify({
            ...initialState(),
            stage: 'variations',
            consent: true,
            portraitId: id,
            name: 'Demo Visitor',
            sessionId: 'offline-demo-check',
            selectedAdId: `${id}_${index + 1}`,
          }));
        }, { id: person.id, index });
        await page.reload();
        await page.locator('.kiosk-variations-single .kiosk-variation img').waitFor();
        const images = page.locator('.kiosk-variation img');
        assert.equal(await images.count(), 1);
        assert.equal(await page.locator('.kiosk-variations-column').count(), 1);
        const image = images.first();
        await image.evaluate((node) => node.decode());
        const expected = `/${profile.variations[brand][0].blob}`;
        assert.equal(await image.getAttribute('src'), expected);
        const dimensions = await image.evaluate((node) => ({
          width: node.naturalWidth,
          height: node.naturalHeight,
          displayedWidth: node.getBoundingClientRect().width,
          displayedHeight: node.getBoundingClientRect().height,
        }));
        assert.equal(dimensions.width, 2000);
        assert(dimensions.height > dimensions.width);
        assert(Math.abs(dimensions.displayedWidth / dimensions.displayedHeight
          - dimensions.width / dimensions.height) < 0.001);
        await checkGalleryWidth();
        if (person.name === 'Tina' && brand === '3-YSLbeauty') {
          if (process.env.KIOSK_SCREENSHOT_DIR) {
            await page.screenshot({
              path: path.join(process.env.KIOSK_SCREENSHOT_DIR, 'demo-single-page-desktop.png'),
              animations: 'disabled',
            });
          }
          await page.setViewportSize({ width: 390, height: 844 });
          await page.waitForFunction(() => document.querySelectorAll('.kiosk-variations-column').length === 1);
          await image.evaluate((node) => node.decode());
          const viewport = await page.locator('.kiosk-variations-viewport').boundingBox();
          assert(viewport.height >= 400 && viewport.height < 844);
          await checkGalleryWidth();
          if (process.env.KIOSK_SCREENSHOT_DIR) {
            await page.screenshot({
              path: path.join(process.env.KIOSK_SCREENSHOT_DIR, 'demo-single-page-mobile.png'),
              animations: 'disabled',
            });
          }
          await page.setViewportSize({ width: 1920, height: 1080 });
        }
        checked += 1;
      }
    }
    assert.equal(checked, 12);
    for (const person of catalog.people) {
      const slug = person.name.toLowerCase();
      const previews = await page.evaluate(async ({ slug, brands }) => {
        const detector = new BarcodeDetector({ formats: ['qr_code'] });
        return Promise.all(brands.map(async (brand) => {
          const image = new Image();
          image.src = `/assets/demo-print/${slug}/${brand}.jpg`;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = 260;
          canvas.height = 260;
          canvas.getContext('2d').drawImage(image, 1240, 920, 260, 260, 0, 0, 260, 260);
          return (await detector.detect(canvas)).map((code) => code.rawValue);
        }));
      }, { slug, brands: Object.keys(person.profiles.max_square.variations) });
      assert.deepEqual(previews, Array.from({ length: 4 }, () => [
        `https://kiosk-preview--glam-kiosk-site--lukevan.aem.page/max-download.html?demo=${slug}`,
      ]));
    }
    assert.deepEqual(azureRequests, []);
    assert.deepEqual(pageErrors, []);
    assert.equal(await page.evaluate(() => localStorage.getItem('glam-kiosk-booth-v1')), null);
    console.log('Credential-free browser: 12 single-page renders, centered 80% gallery on desktop/mobile, 12 public print QRs, zero Azure requests or page errors passed.');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
