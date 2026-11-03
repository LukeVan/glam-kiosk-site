const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(path.join(path.dirname(fs.realpathSync(process.argv[2])), 'index.js'));

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.goto('http://localhost:3017/max2026.html');
    await page.evaluate(async () => {
      const { initialState } = await import('/blocks/attendee-kiosk/state.js');
      localStorage.removeItem('glam-kiosk-booth-v1');
      sessionStorage.setItem('glam-attendee-v1:offline-demo', JSON.stringify({
        ...initialState(), stage: 'pacing', consent: true,
        portraitId: 'demo_dd5af9bb1ce34c41bcc1a45723d6c343',
        name: 'Test', sessionId: 'fixture',
      }));
    });
    for (const width of [1920, 768]) {
      await page.setViewportSize({ width, height: 1080 });
      for (const appearance of ['dark', 'light']) {
        await page.evaluate((value) => {
          localStorage.setItem('glam-kiosk-appearance-v1', value);
          const key = 'glam-attendee-v1:offline-demo';
          const state = JSON.parse(sessionStorage.getItem(key));
          state.stage = 'pacing';
          sessionStorage.setItem(key, JSON.stringify(state));
        }, appearance);
        await page.reload();
        const video = page.locator('.kiosk-graph-video');
        await video.waitFor();
        await video.evaluate((element) => element.pause());
        await page.waitForFunction(() => {
          const images = [...document.querySelectorAll('.kiosk-ad-grid img')];
          return images.length === 4 && images.every((image) => image.complete && image.naturalWidth);
        });
        await page.waitForFunction(() => {
          const videoBounds = document.querySelector('.kiosk-graph-video').getBoundingClientRect();
          const first = document.querySelector('.kiosk-ad-grid img').getBoundingClientRect();
          return Math.abs(videoBounds.left + videoBounds.width * 0.046 - first.left) < 1;
        });
        const bounds = await page.evaluate(() => {
          const frame = document.querySelector('.kiosk-graph-video').getBoundingClientRect();
          const images = [...document.querySelectorAll('.kiosk-ad-grid img')]
            .map((image) => image.getBoundingClientRect());
          return {
            video: {
              left: frame.left + frame.width * 0.046,
              top: frame.top + frame.height * 0.046,
              right: frame.left + frame.width * 0.954,
              bottom: frame.top + frame.height * 0.954,
            },
            grid: {
              left: images[0].left, top: images[0].top,
              right: images[3].right, bottom: images[3].bottom,
            },
          };
        });
        for (const edge of ['left', 'top', 'right', 'bottom']) {
          assert(Math.abs(bounds.video[edge] - bounds.grid[edge]) < 1,
            `${appearance} ${width}px ${edge}: ${JSON.stringify(bounds)}`);
        }
        await video.evaluate(async (element) => {
          if (element.readyState < 1) {
            await new Promise((resolve) => element.addEventListener('loadedmetadata', resolve, { once: true }));
          }
          await new Promise((resolve) => {
            element.addEventListener('seeked', resolve, { once: true });
            element.currentTime = element.duration - 0.05;
          });
        });
        await video.evaluate((element) => element.dispatchEvent(new Event('ended')));
        await page.waitForFunction(() => document.querySelector('.kiosk-graph-video-slot').getAnimations().length > 0);
        const coverage = await page.evaluate(() => {
          const grid = document.querySelector('.kiosk-ad-grid');
          const media = document.querySelector('.kiosk-graph-video-slot');
          for (const animation of media.getAnimations()) {
            animation.pause();
            animation.currentTime = 500;
          }
          return {
            opacity: getComputedStyle(grid).opacity,
            animations: grid.getAnimations().length,
            duration: media.getAnimations()[0].effect.getTiming().duration,
          };
        });
        assert.equal(coverage.opacity, '1', 'Ads must stay opaque under the fading video');
        assert.equal(coverage.animations, 0, 'Simultaneous opacity fades expose the black background');
        assert.equal(coverage.duration, 1000);
        if (process.argv[3] && width === 1920 && appearance === 'dark') {
          await page.locator('.kiosk-graph-media').screenshot({ path: process.argv[3] });
        }
        await page.evaluate(() => {
          document.querySelector('.kiosk-graph-video-slot').getAnimations().forEach((animation) => animation.finish());
        });
        await page.locator('.kiosk-graph-video-slot').waitFor({ state: 'detached' });
        assert.equal(await page.locator('.kiosk-ad-grid').getAttribute('inert'), null);
      }
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => {
      const key = 'glam-attendee-v1:offline-demo';
      const state = JSON.parse(sessionStorage.getItem(key));
      state.stage = 'pacing';
      sessionStorage.setItem(key, JSON.stringify(state));
    });
    await page.reload();
    await page.locator('.kiosk-graph-video').evaluate((video) => {
      video.pause();
      video.dispatchEvent(new Event('ended'));
    });
    await page.locator('.kiosk-graph-video-slot').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.kiosk-ad-grid').getAttribute('inert'), null);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.evaluate(() => {
      localStorage.setItem('glam-kiosk-appearance-v1', 'dark');
      const key = 'glam-attendee-v1:offline-demo';
      const state = JSON.parse(sessionStorage.getItem(key));
      state.stage = 'pacing';
      sessionStorage.setItem(key, JSON.stringify(state));
    });
    await page.reload();
    await page.locator('.kiosk-graph-video').waitFor();
    await page.locator('.kiosk-graph-video-slot').waitFor({ state: 'detached', timeout: 30000 });
    assert.equal(await page.locator('.kiosk-ad-grid').getAttribute('inert'), null);
    console.log('Video transition: aligned desktop/mobile dark/light bounds, opaque-grid fade, reduced motion and real end-to-end video playback passed.');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
