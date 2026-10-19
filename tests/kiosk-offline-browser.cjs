const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(path.join(path.dirname(fs.realpathSync(process.argv[2])), 'index.js'));
const catalog = JSON.parse(fs.readFileSync('assets/offline-demos/catalog.json', 'utf8'));

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const requests = [];
    const external = [];
    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (['localhost', '127.0.0.1'].includes(url.hostname)) {
        requests.push({ path: url.pathname, method: request.method() });
        await route.continue();
      } else {
        external.push(url.hostname);
        await route.abort();
      }
    });
    const page = await context.newPage();
    await page.goto('http://localhost:3017/drafts/attendee-kiosk.html');
    assert.equal(await page.evaluate(() => localStorage.getItem('glam-kiosk-booth-v1')), null);
    async function stage(value, person, brandIndex = 0) {
      await page.evaluate(async ({ value, id, brandIndex }) => {
        const { initialState } = await import('/blocks/attendee-kiosk/state.js');
        sessionStorage.setItem('glam-attendee-v1:offline-demo', JSON.stringify({
          ...initialState(), stage: value, consent: true, portraitId: id,
          name: 'Offline Visitor', sessionId: 'offline-session',
          selectedAdId: `${id}_${brandIndex + 1}`,
        }));
      }, { value, id: person.id, brandIndex });
      await page.reload();
    }
    await stage('portraits', catalog.people[0]);
    await page.locator('.kiosk-demo-card').first().waitFor();
    assert.equal(await page.locator('.kiosk-demo-card').count(), 3);
    assert.deepEqual((await page.locator('.kiosk-demo-card').evaluateAll(
      (cards) => cards.map((card) => card.getAttribute('aria-label')),
    )).sort(), ['Greg', 'Sarah', 'Tina']);
    for (const [index, person] of catalog.people.entries()) {
      await stage('name', person);
      await page.locator('.kiosk-name .kiosk-primary-action').click();
      await page.frameLocator('.kiosk-frame-slot iframe').getByRole('button', { name: 'Send', exact: true }).waitFor();
      assert.equal(await page.locator('.kiosk-demo-cutouts').count(), 0);
      await stage('ads', person);
      await page.locator('.kiosk-ad-grid img').first().waitFor();
      assert.equal(await page.locator('.kiosk-ad-grid img').count(), 4);
      await stage('variations', person, index);
      await page.locator('.kiosk-variation img').first().waitFor();
      const count = index === 1 ? 23 : 9;
      assert.equal(await page.locator('.kiosk-variation img').evaluateAll(
        (images) => new Set(images.map((image) => image.src)).size,
      ), count);
      await page.getByRole('button', { name: 'View production workflow', exact: true }).click();
      const workflow = page.frameLocator('.kiosk-workflow-dialog iframe');
      await workflow.locator('img[src*="/assets/offline-demos/"][src*="/cutouts/"]').waitFor();
      await workflow.locator('img[src*="/assets/offline-demos/"][src*="/variations/"]').first().waitFor();
      await page.locator('.kiosk-workflow-finish').click();
      await page.locator('.kiosk-demo-print img').waitFor();
      await page.getByRole('button', { name: 'Start over', exact: true }).click();
      await page.locator('.kiosk-panel-welcome').waitFor();
      assert.equal(await page.evaluate(() => {
        const state = JSON.parse(sessionStorage.getItem('glam-attendee-v1:offline-demo'));
        return state?.portraitId ?? null;
      }), null);
      await stage('variations', person, index);
      await page.locator('.kiosk-variations-controls')
        .getByRole('button', { name: 'Finish', exact: true }).click();
      await page.locator('.kiosk-demo-print img').waitFor();
      await stage('ending', person, index);
      const preview = page.locator('.kiosk-demo-print img');
      await preview.waitFor();
      await preview.evaluate((image) => image.decode());
      assert((await preview.getAttribute('src')).startsWith(`/assets/demo-print/${person.name.toLowerCase()}/`));
      const download = page.getByRole('link', { name: 'Download demo ads', exact: true });
      const url = new URL(await download.getAttribute('href'));
      assert.equal(url.searchParams.get('demo'), person.name.toLowerCase());
      await page.locator('.kiosk-demo-download-qr').evaluate((image) => image.decode());
      const decoded = await page.evaluate(async ({ slug }) => {
        const detector = new BarcodeDetector({ formats: ['qr_code'] });
        const results = [];
        for (const brand of ['1-larocheposay', '2-lorealprofessionnel', '3-YSLbeauty', '4-lorealparis']) {
          const image = new Image();
          image.src = `/assets/demo-print/${slug}/${brand}.jpg`;
          // Each decode depends on loading its corresponding template.
          // eslint-disable-next-line no-await-in-loop
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = 260;
          canvas.height = 260;
          canvas.getContext('2d').drawImage(image, 1240, 920, 260, 260, 0, 0, 260, 260);
          // eslint-disable-next-line no-await-in-loop
          results.push((await detector.detect(canvas)).map((code) => code.rawValue));
        }
        return results;
      }, { slug: person.name.toLowerCase() });
      assert.deepEqual(decoded, Array.from({ length: 4 }, () => [url.href]));
      const downloads = await context.newPage();
      await downloads.goto(`http://localhost:3017${url.pathname}${url.search}`);
      await downloads.locator('.max-download-gallery-item').first().waitFor();
      assert.equal(await downloads.locator('.max-download-gallery-item').count(), 4);
      assert.equal(await downloads.locator('.max-download-heading').innerText(), `${person.name}’s ads`);
      for (const image of await downloads.locator('.max-download-gallery-item img').all()) {
        await image.evaluate((node) => node.decode());
      }
      await downloads.close();
    }
    assert(requests.every((request) => request.method === 'GET'));
    assert(!external.some((host) => host.endsWith('.blob.core.windows.net')));
    const images = requests.filter((request) => request.path.startsWith('/assets/offline-demos/'));
    assert(images.length > 50);
    console.log('Offline browser: Tina/Sarah/Greg, Finish → print preview → Start over, 12 embedded QRs decoded to public demo downloads, no Azure or writes passed.');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exit(1); });
