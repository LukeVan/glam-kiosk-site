const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(path.join(path.dirname(fs.realpathSync(process.argv[2])), 'index.js'));

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.route('**/drafts/variations-loop-test.html', (route) => route.fulfill({
      contentType: 'text/html',
      body: `<html><head><link rel="stylesheet" href="/blocks/attendee-kiosk/attendee-kiosk.css"></head>
        <body style="margin:0"><div class="attendee-kiosk"><div class="kiosk-panel kiosk-panel-variations"></div></div>
        <script type="module">
          import render from '/blocks/attendee-kiosk/variations.js';
          import copy from '/blocks/attendee-kiosk/copy.js';
          window.operation = new AbortController();
          window.revealAnimations = [];
          const animate = Element.prototype.animate;
          Element.prototype.animate = function record(frames, options) {
            window.revealAnimations.push({className:this.className,delay:options.delay||0});
            return animate.call(this,frames,options);
          };
          const formats = [[1080,1080],[1200,628],[160,600],[1920,1080],[970,250],[1200,1500]];
          render({
            block: document.querySelector('.attendee-kiosk'),
            panel: document.querySelector('.kiosk-panel'),
            assets: Array.from({length:18}, (_,i) => ({
              id: 'asset_'+i, label: 'Ad '+i,
              url: '/mock-variation-'+i+'-'+formats[i%6].join('x')+'.svg',
            })),
            sample: false, text: copy.en, signal: window.operation.signal, animateEntrance: true,
          });
        </script></body></html>`,
    }));
    await page.route('**/mock-variation-*.svg', (route) => {
      const [, index, width, height] = route.request().url().match(/variation-(\d+)-(\d+)x(\d+)/);
      return route.fulfill({
        contentType: 'image/svg+xml',
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="hsl(${index * 20},50%,60%)"/><text x="10" y="40" font-size="30">${index}</text></svg>`,
      });
    });
    await page.goto('http://localhost:3017/drafts/variations-loop-test.html');
    await page.waitForFunction(() => document.querySelectorAll('.kiosk-variation').length === 18);
    await page.waitForFunction(() => [...document.querySelectorAll('.kiosk-variation img')]
      .every((image) => image.complete && image.naturalWidth > 0));
    const viewport = page.locator('.kiosk-variations-viewport');
    const tracks = page.locator('.kiosk-variations-track');
    assert.equal(await tracks.count(), 3);
    assert.deepEqual(await page.evaluate(() => window.revealAnimations
      .filter((animation) => animation.className === 'kiosk-variations-column')
      .map((animation) => animation.delay)), [250, 390, 530]);
    await page.waitForFunction(() => {
      const track = document.querySelector('.kiosk-variations-track');
      return new DOMMatrix(getComputedStyle(track).transform).m42 < -0.1
        && document.getAnimations().some((animation) => animation.playState === 'running');
    });
    await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState === 'finished'));
    assert.equal(await page.locator('.kiosk-variation-repeat:not([aria-hidden="true"])').count(), 0);
    assert.equal(await page.locator('.kiosk-variation img').nth(2).getAttribute('alt'), 'Ad 6');
    const portrait = page.locator('.kiosk-variation img[src*="160x600"]').first();
    const portraitBox = await portrait.boundingBox();
    const tileBox = await portrait.locator('..').boundingBox();
    assert(Math.abs(tileBox.width - portraitBox.width - 20) < 1);
    assert(Math.abs(portraitBox.width / portraitBox.height - 160 / 600) < 0.001);
    assert(portraitBox.height > 380);
    await page.waitForFunction(() => new DOMMatrix(getComputedStyle(
      document.querySelector('.kiosk-variations-track'),
    ).transform).m42 < -5);
    // Cross one column's seam manually; its repeated first tile meets the original exactly.
    await viewport.dispatchEvent('pointerdown');
    const seam = await tracks.first().evaluate((track) => {
      const first = track.children[0];
      const next = track.children[1];
      return {
        height: first.getBoundingClientRect().height,
        first: first.firstElementChild.getBoundingClientRect().top,
        next: next.firstElementChild.getBoundingClientRect().top,
        offset: -new DOMMatrix(getComputedStyle(track).transform).m42,
      };
    });
    assert(Math.abs(seam.next - seam.first - seam.height) < 0.01);
    await viewport.evaluate((node, top) => { node.scrollTop = top - 1; }, seam.height - seam.offset);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const before = await tracks.first().evaluate((node) => {
      const y = node.closest('.kiosk-variations-viewport').getBoundingClientRect().top;
      return [...node.querySelectorAll('figure')].map((tile) => tile.getBoundingClientRect().top)
        .sort((a, b) => Math.abs(a - y) - Math.abs(b - y))[0];
    });
    await viewport.evaluate((node) => { node.scrollTop += 2; });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const after = await tracks.first().evaluate((node) => {
      const y = node.closest('.kiosk-variations-viewport').getBoundingClientRect().top;
      return [...node.querySelectorAll('figure')].map((tile) => tile.getBoundingClientRect().top)
        .sort((a, b) => Math.abs(a - y) - Math.abs(b - y))[0];
    });
    assert(Math.abs(before - after - 2) < 1, JSON.stringify({ before, after, seam }));
    if (process.env.KIOSK_SCREENSHOT_DIR) {
      await page.screenshot({ path: path.join(process.env.KIOSK_SCREENSHOT_DIR, 'variations-infinite.png') });
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    assert.equal(await tracks.first().evaluate((node) => node.style.transform), '');
    assert.equal(await page.locator('.kiosk-variations-sequence[aria-hidden]').first().isVisible(), false);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.querySelectorAll('.kiosk-variations-track').length === 2);
    assert.equal(await page.locator('.kiosk-variation').count(), 18);
    await page.evaluate(() => window.operation.abort());
    console.log('Variations: reordered columns, seamless seam, uncropped portrait, reduced motion and responsive layout passed.');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
