const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(path.join(path.dirname(fs.realpathSync(process.argv[2])), 'index.js'));

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const errors = [];
    const methods = [];
    context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.stack)));
    await context.route('https://ffservices24.blob.core.windows.net/**', async (route) => {
      methods.push(route.request().method());
      assert.equal(route.request().method(), 'GET');
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/catalog.json')) await route.fulfill({ status: 404 });
      else if (url.searchParams.get('comp') === 'list') {
        await route.fulfill({
          contentType: 'application/xml',
          body: '<EnumerationResults><Blobs><Blob><Name>TestEvent/example.jpg</Name></Blob></Blobs><NextMarker></NextMarker></EnumerationResults>',
        });
      } else await route.abort();
    });
    const page = await context.newPage();
    await page.goto('http://localhost:3017/drafts/attendee-kiosk.html');
    await page.evaluate(async () => {
      const { saveSettings } = await import('/scripts/kiosk-settings.js');
      const { initialState } = await import('/blocks/attendee-kiosk/state.js');
      saveSettings(localStorage, {
        version: 1,
        containerSAS: `https://ffservices24.blob.core.windows.net/mock-assets?sv=2023-11-03&sr=c&sp=rl&se=${encodeURIComponent(new Date(Date.now() + 86400000).toISOString())}&sig=MOCK_ONLY`,
        eventId: 'TestEvent', activationProfile: 'max', formType: 'none',
      });
      sessionStorage.setItem('glam-attendee-v1:azure:TestEvent', JSON.stringify({
        ...initialState(), consent: true, stage: 'name', portraitId: 'demo_Person5',
      }));
    });
    await page.reload();
    const activation = page.locator('.attendee-kiosk');
    await activation.locator('.kiosk-name input').waitFor();
    assert.equal(await activation.getAttribute('data-appearance'), 'light');
    const lightCopy = await page.locator('.kiosk-name-copy').innerText();
    await page.locator('.kiosk-name input').fill('Shared Visitor');
    const settings = await context.newPage();
    // The static settings draft omits EDS header/footer placeholders.
    await settings.route('**/drafts/kiosk-settings.html', (route) => route.fulfill({
      contentType: 'text/html',
      body: fs.readFileSync('drafts/kiosk-settings.html', 'utf8')
        .replace('<body>', '<body><header></header>')
        .replace('</body>', '<footer></footer></body>'),
    }));
    await settings.goto('http://localhost:3017/drafts/kiosk-settings.html');
    const appearance = settings.getByLabel('Activation appearance', { exact: true });
    assert.equal(await appearance.inputValue(), 'light');
    assert.deepEqual(await appearance.locator('option').allTextContents(), ['Light', 'Dark']);
    const saveSettingsButton = settings.getByRole('button', { name: 'Save booth settings', exact: true });
    assert.equal(await saveSettingsButton.isEnabled(), true);
    assert.equal(await settings.getByLabel('Event', { exact: true }).inputValue(), 'TestEvent');
    const requestsBeforeAppearanceSave = methods.length;
    async function choose(theme) {
      await appearance.selectOption(theme);
      await settings.getByRole('button', { name: 'Save booth settings', exact: true }).click();
      await page.waitForFunction((theme) => document.querySelector('.attendee-kiosk').dataset.appearance === theme, theme);
    }
    await choose('dark');
    assert.equal(methods.length, requestsBeforeAppearanceSave, 'Appearance-only save must not test Azure');
    assert.equal(await page.locator('.kiosk-name input').inputValue(), 'Shared Visitor');
    assert.equal(await page.locator('.kiosk-name-copy').innerText(), lightCopy);
    assert.equal(await page.locator('.kiosk-panel-name h2').evaluate((node) => getComputedStyle(node).color), 'rgb(255, 255, 255)');
    for (const selector of ['.kiosk-name-photo']) {
      await page.locator(selector).evaluate((image) => image.decode());
    }
    const geometry = {};
    for (const selector of ['.kiosk-dark-lockup', '.kiosk-name-artwork', '.kiosk-name-photo']) {
      geometry[selector] = await page.locator(selector).boundingBox();
    }
    assert.equal(geometry['.kiosk-dark-lockup'].x, 76);
    assert.equal(geometry['.kiosk-dark-lockup'].y, 112);
    assert.equal(geometry['.kiosk-dark-lockup'].width, 420);
    assert(Math.abs(geometry['.kiosk-dark-lockup'].height - (420 * 64 / 538)) < 1);
    assert.deepEqual(geometry['.kiosk-name-artwork'], { x: 978, y: 107, width: 862, height: 867 });
    assert(Math.abs(geometry['.kiosk-name-photo'].x - 1086) < 1);
    assert(Math.abs(geometry['.kiosk-name-photo'].y - 218) < 1);
    const background = await activation.evaluate((node) => getComputedStyle(node, '::before').backgroundImage);
    assert(background.includes('/dark-background.png'));
    async function screenshot(name) {
      await page.locator('.kiosk-header img').evaluate((image) => image.decode());
      await page.locator('.kiosk-dark-lockup > span, .kiosk-lens-piece > span').evaluateAll(async (parts) => {
        await Promise.all(parts.map(async (part) => {
          const url = getComputedStyle(part).backgroundImage.match(/url\("([^"]+)"\)/)?.[1];
          if (!url) throw new Error('Missing source Figma artwork asset');
          const image = new Image();
          image.src = url;
          await image.decode();
        }));
      });
      if (process.env.KIOSK_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.KIOSK_SCREENSHOT_DIR, `${name}.png`) });
    }
    await screenshot('dark-name');
    await choose('light');
    assert.equal(await page.locator('.kiosk-name input').inputValue(), 'Shared Visitor');
    assert.equal(await page.locator('.kiosk-name-lens').isVisible(), false);
    assert((await page.locator('.kiosk-header img').getAttribute('src')).endsWith('/lockup.png'));
    await screenshot('light-name');
    await choose('dark');
    await page.reload();
    await page.locator('.kiosk-name input').waitFor();
    assert.equal(await activation.getAttribute('data-appearance'), 'dark');
    await page.locator('.kiosk-name input').fill('Shared Visitor');
    await page.locator('.kiosk-name .kiosk-primary-action').click();
    const coworker = page.frameLocator('.kiosk-frame-slot iframe');
    await coworker.locator('html[data-color-scheme="dark"]').waitFor();
    async function assertLogoClearsCoworker(selector) {
      const logo = await page.locator(selector).boundingBox();
      const frame = await page.locator('.kiosk-frame-slot').boundingBox();
      const subhead = await page.locator('.kiosk-story-text:not(.kiosk-story-exit) p').first().boundingBox();
      assert(Math.abs(logo.x - subhead.x) < 1, 'Logo and subhead must align on the left');
      assert(Math.abs(logo.width - subhead.width) < 1, 'Logo must match the subhead column width');
      assert(logo.x + logo.width + 24 <= frame.x, 'Complete logo must clear Coworker by at least 24px');
    }
    await assertLogoClearsCoworker('.kiosk-dark-lockup');
    const stateBefore = await page.evaluate(() => sessionStorage.getItem('glam-attendee-v1:azure:TestEvent'));
    await choose('light');
    await coworker.locator('html[data-color-scheme="light"]').waitFor();
    await assertLogoClearsCoworker('.kiosk-header img');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('glam-attendee-v1:azure:TestEvent')), stateBefore);
    await choose('dark');
    await coworker.locator('html[data-color-scheme="dark"]').waitFor();
    await page.locator('.kiosk-coworker-jump').click();
    await page.locator('.kiosk-ad-grid button').nth(1).click();
    const selected = page.locator('.kiosk-ad-grid [aria-pressed="true"]');
    assert.match(await selected.evaluate((node) => getComputedStyle(node).backgroundImage), /linear-gradient/);
    assert.equal(await selected.evaluate((node) => getComputedStyle(node, '::before').display), 'none');
    await screenshot('dark-ad-selection');
    const darkWords = await page.locator('.kiosk-ad-copy').innerText();
    await choose('light');
    assert.equal(await page.locator('.kiosk-ad-copy').innerText(), darkWords);
    assert.equal(await selected.evaluate((node) => getComputedStyle(node).backgroundImage), 'none');
    await screenshot('light-ad-selection');
    await choose('dark');
    await page.locator('.kiosk-composer-send').click();
    await coworker.locator('html[data-color-scheme="dark"]').waitFor();
    for (const theme of ['light', 'dark']) {
      await choose(theme);
      await page.evaluate(() => {
        const key = 'glam-attendee-v1:azure:TestEvent';
        const state = JSON.parse(sessionStorage.getItem(key));
        sessionStorage.setItem(key, JSON.stringify({ ...state, stage: 'pacing' }));
      });
      await page.reload();
      const intro = page.locator('.kiosk-ad-intro-copy h2');
      await intro.waitFor();
      await page.evaluate(() => document.fonts.ready);
      const lines = await intro.evaluate((heading) => {
        const range = document.createRange();
        range.selectNodeContents(heading);
        return new Set([...range.getClientRects()].filter((rect) => rect.width > 0)
          .map((rect) => Math.round(rect.y))).size;
      });
      assert.equal(lines, 2, `${theme} interstitial heading must occupy exactly two lines`);
    }
    await page.evaluate(async () => {
      const { initialState } = await import('/blocks/attendee-kiosk/state.js');
      sessionStorage.setItem('glam-attendee-v1:azure:TestEvent', JSON.stringify({
        ...initialState(), language: 'fr', consent: true, stage: 'name', portraitId: 'demo_Person5',
      }));
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.locator('.kiosk-name-photo').evaluate((image) => image.decode());
    assert.equal(await page.locator('.kiosk-panel-name h2').innerText(), 'À votre image.');
    const mobileLens = await page.locator('.kiosk-name-artwork').boundingBox();
    const mobilePhoto = await page.locator('.kiosk-name-photo').boundingBox();
    assert(mobileLens.width <= 390);
    assert(mobileLens.y >= 90);
    assert(mobilePhoto.x > mobileLens.x && mobilePhoto.y > mobileLens.y);
    assert(mobilePhoto.x + mobilePhoto.width < mobileLens.x + mobileLens.width);
    await screenshot('dark-name-mobile-fr');
    await settings.reload();
    assert.equal(await saveSettingsButton.isEnabled(), true);
    assert.equal(await appearance.inputValue(), 'dark');
    const sasInput = settings.getByLabel('Container SAS URL', { exact: true });
    await sasInput.fill(`${await sasInput.inputValue()} `);
    assert.equal(await saveSettingsButton.isDisabled(), true);
    assert.equal(await settings.getByLabel('Event', { exact: true }).isDisabled(), true);
    await settings.getByRole('button', { name: 'Test connection', exact: true }).click();
    await settings.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled);
    assert.equal(await settings.getByLabel('Event', { exact: true }).inputValue(), 'TestEvent');
    assert(methods.every((method) => method === 'GET'));
    assert.deepEqual(errors, []);
    console.log('Appearance: settings persistence/live switching, shared copy/state, exact Figma asset geometry, gradient selection, Coworker dark/light/continued, mobile French and zero writes passed.');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
