const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(path.join(path.dirname(fs.realpathSync(process.argv[2])), 'index.js'));

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 402, height: 874 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const requestId = '12345678-1234-4234-8234-123456789abc';
    const expiresAt = new Date(Date.now() + 86400000).toISOString();
    const brands = ['larocheposay', 'lorealprofessionnel', 'yslbeauty', 'lorealparis'];
    const files = ['1-larocheposay', '2-lorealprofessionnel', '3-YSLbeauty', '4-lorealparis'];
    const signed = (filename) => `https://ffservices24.blob.core.windows.net/mock-assets/TestEvent/7-Share-Output/${requestId}/${filename}?sr=b&sp=r&sig=MOCK_ONLY&se=${encodeURIComponent(expiresAt)}`;
    const sessionURL = signed('session.json');
    let status = 'ready';
    let denied = false;
    await page.route('https://ffservices24.blob.core.windows.net/**', (route) => {
      assert.equal(route.request().method(), 'GET');
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('session.json')) {
        return route.fulfill(denied ? { status: 403 } : {
          json: {
            schemaVersion: 1, requestId, portraitId: `azure_${'a'.repeat(64)}`,
            name: 'Test Visitor', expiresAt, status,
            images: brands.map((brand, index) => {
              const ready = status === 'ready' || (status === 'partial' && index === 0);
              return {
                brand, filename: `${brand}.jpg`, status: ready ? 'ready' : 'pending',
                url: ready ? signed(`${brand}.jpg`) : null,
              };
            }),
          },
        });
      }
      const index = brands.findIndex((brand) => url.pathname.endsWith(`/${brand}.jpg`));
      assert(index >= 0);
      return route.fulfill({
        contentType: 'image/jpeg',
        body: fs.readFileSync(`assets/demo-print/tina/${files[index]}.jpg`),
      });
    });
    const address = `http://localhost:3017/max-download.html?session=${encodeURIComponent(sessionURL)}`;
    await page.goto(address);
    await page.waitForFunction(() => document.querySelectorAll('.max-download-gallery-item').length === 4);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.querySelectorAll('.max-download img')].map((image) => image.decode()));
    });
    assert.equal(await page.getByRole('link', { name: /^Download ad / }).count(), 4);
    const links = page.locator('.max-download-links a');
    assert.equal(await links.count(), 3);
    assert.deepEqual(await links.evaluateAll((items) => items.map((item) => item.hostname)),
      ['business.adobe.com', 'business.adobe.com', 'business.adobe.com']);
    assert.equal(await page.locator('.max-download-banner img').getAttribute('src'),
      '/blocks/max-download/assets/adobe-loreal.png');
    const geometry = await page.evaluate(() => {
      const rect = (selector) => {
        const { x, y, width, height, bottom } = document.querySelector(selector).getBoundingClientRect();
        return { x, y, width, height, bottom };
      };
      return {
        logo: rect('.max-download-banner img'),
        title: rect('.max-download-heading'),
        card: rect('.max-download-gallery-item'),
        button: rect('.max-download-gallery-btn'),
        footer: rect('.max-download-links'),
        thumb: rect('.max-download-links img'),
        background: getComputedStyle(document.querySelector('.max-download-wrap')).backgroundImage,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    assert.equal(geometry.overflow, false);
    assert.equal(geometry.logo.width, 269);
    assert.equal(geometry.logo.height, 32);
    assert.equal(geometry.logo.y, 62);
    assert.equal(geometry.title.y, 142);
    assert.equal(geometry.card.width, 303);
    assert.equal(geometry.card.y, 225);
    assert.equal(geometry.button.x, geometry.card.x + 4);
    assert.equal(geometry.button.y, geometry.card.y + 4);
    assert.equal(geometry.button.width, 32);
    assert.equal(geometry.footer.bottom, 874);
    assert.equal(geometry.footer.height, 196);
    assert.equal(geometry.thumb.width, 106);
    assert.equal(geometry.thumb.height, 78);
    assert(geometry.background.includes('/blocks/max-download/assets/max-background.png'));
    for (let index = 0; index < 4; index += 1) {
      const link = page.getByRole('link', { name: `Download ad ${index + 1}`, exact: true });
      assert.equal(await link.getAttribute('href'), signed(`${brands[index]}.jpg`));
      assert.equal(await link.getAttribute('download'), `${brands[index]}.jpg`);
      assert.equal(await link.getAttribute('referrerpolicy'), 'no-referrer');
    }
    if (process.env.KIOSK_SCREENSHOT_DIR) {
      await page.screenshot({ path: path.join(process.env.KIOSK_SCREENSHOT_DIR, 'qr-mobile.png') });
    }
    await page.evaluate(() => window.scrollTo(0, 300));
    const overlay = await page.evaluate(() => {
      const footer = document.querySelector('.max-download-links').getBoundingClientRect();
      const front = document.elementFromPoint(10, footer.y + 10);
      return {
        bottom: footer.bottom,
        onTop: Boolean(front.closest('.max-download-links')),
        cardY: document.querySelector('.max-download-gallery-item').getBoundingClientRect().y,
      };
    });
    assert.equal(overlay.bottom, 874);
    assert.equal(overlay.onTop, true);
    assert(overlay.cardY < geometry.card.y);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const last = await page.locator('.max-download-gallery-item').last().boundingBox();
    const footer = await page.locator('.max-download-links').boundingBox();
    assert(last.y + last.height <= footer.y, 'Last ad must scroll fully above the fixed links');
    await page.getByRole('link', { name: 'Download ad 4', exact: true }).focus();
    assert.equal(await page.getByRole('link', { name: 'Download ad 4', exact: true })
      .evaluate((link) => getComputedStyle(link).outlineStyle), 'solid');

    await page.setViewportSize({ width: 320, height: 568 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    const first = await page.locator('.max-download-gallery-item').nth(0).boundingBox();
    const second = await page.locator('.max-download-gallery-item').nth(1).boundingBox();
    assert.equal(first.y, second.y);
    assert(second.x > first.x);

    status = 'partial';
    await page.reload();
    await page.getByText('Some ads are ready.', { exact: false }).waitFor();
    assert.equal(await page.locator('.max-download-gallery-item').count(), 1);
    status = 'pending';
    await page.reload();
    await page.getByText('Your four personalized ads are being prepared.', { exact: false }).waitFor();
    assert.equal(await page.locator('.max-download-gallery-item').count(), 0);
    denied = true;
    await page.reload();
    await page.getByText('Access to your ads was denied or has expired.', { exact: true }).waitFor();
    assert.equal(await links.count(), 3);
    denied = false;
    status = 'ready';
    // The local legacy fixture lacks the header supplied by EDS.
    await page.route('**/download/?*', (route) => route.fulfill({
      contentType: 'text/html',
      body: fs.readFileSync('download/index.html', 'utf8').replace('<body>', '<body><header></header>'),
    }));
    await page.goto(`http://localhost:3017/download/?session=${encodeURIComponent(sessionURL)}`);
    await page.waitForFunction(() => document.querySelectorAll('.max-download-gallery-item').length === 4);
    assert.equal(await page.getByRole('link', { name: /^Download ad / }).count(), 4);
    assert.equal(await page.locator('.max-download-links').evaluate((nav) => getComputedStyle(nav).position), 'fixed');
    await page.goto('http://localhost:3017/max-download.html?demo=tina');
    await page.waitForFunction(() => document.querySelectorAll('.max-download-gallery-item').length === 4);
    assert.equal(await page.getByRole('link', { name: /^Download ad / }).count(), 4);
    await page.goto('http://localhost:3017/max-download.html');
    await page.getByText('This download link is invalid or has expired.', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log('MAX QR download: Figma mobile geometry/assets, fixed overlay, four download URLs, keyboard, small/desktop layout, partial/pending/denied/invalid and demo paths passed.');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
