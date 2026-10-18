const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(path.join(path.dirname(fs.realpathSync(process.argv[2])), 'index.js'));

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const theme of ['light', 'dark']) {
      for (const { reduced, width } of [
        { reduced: false, width: 1920 },
        { reduced: true, width: 1920 },
        { reduced: false, width: 390 },
      ]) {
        const context = await browser.newContext({
          viewport: { width, height: width === 390 ? 844 : 1080 },
          reducedMotion: reduced ? 'reduce' : 'no-preference',
        });
        const errors = [];
        const requests = [];
        await context.route('https://ffservices24.blob.core.windows.net/**', async (route) => {
          requests.push(route.request().method());
          assert.equal(route.request().method(), 'GET');
          if (new URL(route.request().url()).pathname.endsWith('/catalog.json')) {
            await route.fulfill({ status: 404 });
          } else {
            await route.fulfill({
              contentType: 'application/xml',
              body: '<EnumerationResults><Blobs></Blobs><NextMarker></NextMarker></EnumerationResults>',
            });
          }
        });
        const page = await context.newPage();
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto('http://localhost:3017/drafts/attendee-kiosk.html');
        await page.evaluate(async (appearance) => {
          const { saveSettings } = await import('/scripts/kiosk-settings.js');
          saveSettings(localStorage, {
            version: 1,
            containerSAS: `https://ffservices24.blob.core.windows.net/mock-assets?sv=2023-11-03&sr=c&sp=rl&se=${encodeURIComponent(new Date(Date.now() + 86400000).toISOString())}&sig=MOCK_ONLY`,
            eventId: 'TestEvent', activationProfile: 'max', formType: 'none', appearance,
          });
          sessionStorage.clear();
        }, theme);
        await page.reload();
        await page.locator('.kiosk-welcome-content').waitFor();
        assert.equal(await page.locator('.kiosk-welcome-content > p').innerText(), "See how Adobe helps L'Oréal Groupe bring more personal beauty stories to life, empowering creative freedom while simplifying production at scale.");
        assert.equal(await page.locator('.kiosk-language').isVisible(), false);
        assert.equal(await page.getByRole('button', { name: 'Switch to English', exact: true }).count(), 0);
        await page.locator('.kiosk-consent input').check();
        const logo = page.locator(theme === 'dark' ? '.kiosk-dark-lockup' : '.kiosk-header img');
        async function logoGeometry() {
          const box = await logo.boundingBox();
          const bounds = await page.locator('.attendee-kiosk').boundingBox();
          return { ...box, x: box.x - bounds.x, y: box.y - bounds.y };
        }
        const logoBefore = await logoGeometry();
        await page.locator('.kiosk-print').click();
        await page.waitForFunction(() => document.querySelector('.kiosk-opening-outgoing'));
        const animations = await page.locator('.kiosk-portrait-grid .kiosk-card').first()
          .evaluate((node) => node.getAnimations().map((animation) => animation.effect.getKeyframes()));
        assert.equal(animations.length, reduced ? 0 : 1);
        await page.locator('.kiosk-opening-outgoing').waitFor({ state: 'detached' });
        const card = page.locator('.kiosk-portrait-grid .kiosk-card').first();
        await card.click();
        const selectedId = await card.getAttribute('data-asset-id');
        const sourceURL = await card.locator('img').getAttribute('src');
        await page.locator('.kiosk-portrait-actions .kiosk-primary-action').click();
        await page.locator('.kiosk-name input').waitFor();
        if (!reduced) {
          const ghost = page.locator('.kiosk-opening-portrait');
          await ghost.waitFor();
          assert.equal(await ghost.getAttribute('src'), sourceURL);
          const destination = await page.locator('.kiosk-name-photo').boundingBox();
          const final = await ghost.evaluate((node) => node.getAnimations()[0].effect.getKeyframes().at(-1));
          const bounds = await page.locator('.attendee-kiosk').boundingBox();
          assert(Math.abs(Number.parseFloat(final.left) - (destination.x - bounds.x)) < 1);
          assert(Math.abs(Number.parseFloat(final.width) - destination.width) < 1);
        }
        await page.locator('.kiosk-opening-outgoing').waitFor({ state: 'detached' });
        await page.locator('.kiosk-opening-portrait').waitFor({ state: 'detached' });
        assert.equal(await page.locator('.kiosk-name-photo').getAttribute('src'), sourceURL);
        assert.equal(await page.locator('.kiosk-name input').evaluate((node) => node === document.activeElement), true);
        assert.deepEqual(await logoGeometry(), logoBefore);
        await page.locator('.kiosk-name input').fill('Motion Visitor');
        await page.locator('.kiosk-name .kiosk-primary-action').click();
        await page.locator('.kiosk-panel-story').waitFor();
        await page.waitForFunction(() => document.querySelector('.kiosk-frame-slot').getAnimations().length > 0);
        assert.deepEqual(await logoGeometry(), logoBefore);
        await page.locator('.kiosk-badge > button').click();
        await page.locator('.kiosk-opening-outgoing').waitFor({ state: 'detached' });
        await page.waitForFunction(() => document.querySelector('.kiosk-frame-slot').getAnimations().length === 0);
        const state = await page.evaluate(() => JSON.parse(sessionStorage.getItem('glam-attendee-v1:azure:TestEvent')));
        assert.equal(state.portraitId, selectedId);
        assert.equal(state.name, 'Motion Visitor');
        assert.equal(state.stage, 'story');
        assert.equal(await page.locator('.kiosk-opening-portrait').count(), 0);
        assert(requests.every((method) => method === 'GET'));
        assert.deepEqual(errors, []);
        await context.close();
      }
    }
    console.log('Opening journey: light/dark, staggered gallery, portrait continuity/geometry, focus, anchored logo, Coworker reveal, reduced motion, preserved identity and zero writes passed.');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
