const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const fixture = require('./kiosk-demo-fixture.cjs');
const { chromium } = require(path.join(path.dirname(fs.realpathSync(process.argv[2])), 'index.js'));

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let catalog = fixture();
    const publicFixture = Boolean(process.env.PUBLIC_DEMO_FIXTURE);
    const publicOrigin = 'https://kiosk-preview--glam-kiosk-site--lukevan.aem.page';
    const requests = [];
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') await route.continue();
      else await route.abort();
    });
    if (publicFixture) {
      await page.route('**/drafts/attendee-kiosk.html', (route) => route.fulfill({
        contentType: 'text/html',
        body: fs.readFileSync('drafts/attendee-kiosk.html', 'utf8')
          .replace('window.GLAM_KIOSK_CONFIG = {', `window.GLAM_KIOSK_CONFIG = { publicDemoOrigin: '${publicOrigin}',`),
      }));
      await page.route(`${publicOrigin}/assets/permanent-demo-cutouts/index.json`, (route) => {
        const person = catalog.people[0];
        const setId = catalog.experienceTemplateSets.max;
        const profile = person.profiles[setId];
        return route.fulfill({
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({
            schemaVersion: 1,
            cutouts: ['1-larocheposay', '2-lorealprofessionnel', '3-YSLbeauty', '4-lorealparis'].map((brand) => ({
              personId: person.id, templateSetId: setId, version: profile.version, brand,
              path: `assets/permanent-demo-cutouts/${person.id}/${setId}/${profile.version}/${brand}.png`,
              sha256: 'b'.repeat(64),
            })),
          }),
        });
      });
    }
    await page.route('https://ffservices24.blob.core.windows.net/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      requests.push({ method: request.method(), path: url.pathname });
      assert.equal(request.method(), 'GET');
      if (url.pathname.endsWith('/catalog.json')) {
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(catalog) });
      } else if (url.searchParams.get('comp') === 'list') {
        await route.fulfill({
          contentType: 'application/xml',
          body: '<EnumerationResults><Blobs></Blobs><NextMarker></NextMarker></EnumerationResults>',
        });
      } else if (url.pathname.includes('/assets/permanent-demos/')) {
        await route.fulfill({
          contentType: 'image/jpeg',
          body: fs.readFileSync('blocks/attendee-kiosk/assets/Person5.jpg'),
        });
      } else throw new Error(`Unexpected demo request: ${url.pathname}`);
    });
    await page.goto('http://localhost:3017/drafts/attendee-kiosk.html');
    await page.evaluate(async () => {
      const { saveSettings } = await import('/scripts/kiosk-settings.js');
      saveSettings(localStorage, {
        version: 1,
        containerSAS: `https://ffservices24.blob.core.windows.net/mock-assets?sv=2023-11-03&sr=c&sp=rl&se=${encodeURIComponent(new Date(Date.now() + 86400000).toISOString())}&sig=MOCK_ONLY`,
        eventId: 'TestEvent', activationProfile: 'max', formType: 'none',
        appearance: 'dark',
      });
    });
    async function stage(value, selectedAd = 'demo_Person5_2', language = 'en') {
      await page.evaluate(async ({ value, selectedAd, language }) => {
        const { initialState } = await import('/blocks/attendee-kiosk/state.js');
        sessionStorage.setItem('glam-attendee-v1:azure:TestEvent', JSON.stringify({
          ...initialState(),
          stage: value, language, consent: true, portraitId: 'demo_Person5',
          name: 'Demo Visitor', sessionId: 'mock-demo-session', selectedAdId: selectedAd,
        }));
      }, { value, selectedAd, language });
      await page.reload();
    }
    await stage('portraits');
    await page.locator('.kiosk-demo-card').waitFor();
    assert.equal(await page.locator('.kiosk-demo-card').count(), 1);
    assert.match(await page.locator('.kiosk-demo-card').getAttribute('aria-label'), /Permanent Demo Five/);
    await stage('name');
    await page.locator('.kiosk-name .kiosk-primary-action').click();
    const coworker = page.frameLocator('.kiosk-frame-slot iframe');
    await coworker.getByRole('button', { name: 'Send', exact: true }).click();
    assert.equal(await page.locator('.kiosk-demo-cutouts').count(), 0);
    await coworker.getByRole('button', { name: 'Select L’Oréal Paris campaign brief', exact: true }).click();
    assert.equal(await page.locator('.kiosk-demo-cutouts').count(), 0);
    await coworker.getByRole('button', { name: 'Send', exact: true }).click();
    await page.locator('.kiosk-story-text:not([aria-hidden]) h2').getByText('Build on what worked', { exact: true }).waitFor();
    await coworker.getByRole('button', { name: 'Send', exact: true }).click();
    await page.locator('.kiosk-story-text:not([aria-hidden]) h2').getByText('Take creative control', { exact: true }).waitFor();
    assert.equal(await page.locator('.kiosk-demo-cutouts').count(), 0);
    await coworker.locator('body').evaluate(() => {
      window.graphOpened = [];
      window.open = (url) => {
        window.graphOpened.push(url);
        return { closed: false, focus() {} };
      };
    });
    await coworker.getByRole('button', { name: 'Open Firefly Graph', exact: true }).click();
    const graphLaunches = await coworker.locator('body').evaluate(() => window.graphOpened);
    assert.equal(graphLaunches.length, 1);
    assert.equal(new URL(graphLaunches[0]).origin, 'https://firefly.adobe.com');
    if (publicFixture) {
      const parameters = new URLSearchParams(new URL(graphLaunches[0]).hash.slice(1));
      const metadata = JSON.parse(parameters.get('publicDemo'));
      assert.equal(metadata.personId, 'demo_Person5');
      assert.equal(metadata.brand, '4-lorealparis');
      assert.equal(metadata.templateSetId, catalog.experienceTemplateSets.max);
      assert.equal(metadata.version, catalog.people[0].profiles[metadata.templateSetId].version);
      assert.equal(metadata.sha256, 'b'.repeat(64));
      assert.equal(parameters.get('portraitUrl'), `${publicOrigin}/assets/permanent-demo-cutouts/${metadata.personId}/${metadata.templateSetId}/${metadata.version}/4-lorealparis.png`);
    } else assert.equal(new URL(graphLaunches[0]).hash, '');
    assert.equal(graphLaunches[0].includes('MOCK_ONLY'), false);
    assert.equal(await coworker.getByRole('alert').filter({ hasText: 'Graph portrait unavailable' }).count(), 0);
    if (publicFixture) await page.locator('.kiosk-coworker-jump').click();
    else await coworker.getByRole('button', { name: 'Continue to ads', exact: true }).click();
    await page.locator('.kiosk-ad-grid .kiosk-card').first().waitFor();
    assert.equal(await page.locator('.kiosk-ad-grid .kiosk-card').count(), 4);
    const adURLs = await page.locator('.kiosk-ad-grid img').evaluateAll((images) => images.map((image) => image.src));
    assert(adURLs.every((url) => new URL(url).pathname.includes('/custom_max/')));
    assert(adURLs.some((url) => new URL(url).pathname.endsWith('/ads/3-YSLbeauty.jpg')));
    await page.locator('.kiosk-ad-grid button').nth(1).click();
    await page.locator('.kiosk-composer-send').click();
    await page.locator('.kiosk-panel-continued').waitFor();
    await stage('variations');
    await page.locator('.kiosk-variation img').first().waitFor();
    const variations = await page.locator('.kiosk-variation img').evaluateAll((images) => (
      [...new Set(images.map((image) => new URL(image.src).pathname))]
    ));
    assert.equal(variations.length, 23);
    assert(variations.every((url) => url.includes('/variations/2-lorealprofessionnel/')));
    assert.match(await page.locator('.kiosk-variations-notice').innerText(), /DEMO/);
    await page.getByRole('button', { name: 'View production workflow', exact: true }).click();
    assert.equal(await page.locator('.kiosk-workflow-dialog').evaluate((node) => getComputedStyle(node).backgroundColor), 'rgb(44, 44, 44)');
    assert.equal(await page.locator('.kiosk-workflow-bar h2').evaluate((node) => getComputedStyle(node).color), 'rgb(255, 255, 255)');
    const workflow = page.frameLocator('.kiosk-workflow-dialog iframe');
    await workflow.locator('img[src*="/cutouts/2-lorealprofessionnel.png"]').waitFor();
    await workflow.locator('img[src*="/variations/2-lorealprofessionnel/page_1.jpg"]').waitFor();
    await page.locator('.kiosk-workflow-finish').click();
    await page.locator('.kiosk-panel-welcome').waitFor();
    assert.equal(await page.locator('.kiosk-workflow-dialog').count(), 0);
    const resetState = await page.evaluate(() => (
      JSON.parse(sessionStorage.getItem('glam-attendee-v1:azure:TestEvent'))
    ));
    assert.equal(resetState?.portraitId ?? null, null);
    assert.equal(resetState?.selectedAdId ?? null, null);
    assert.equal(resetState?.name ?? '', '');
    await stage('variations');
    await page.locator('.kiosk-variation img').first().waitFor();
    await page.locator('.kiosk-variations-controls').getByRole('button', { name: 'Finish', exact: true }).click();
    await page.locator('.kiosk-panel-welcome').waitFor();
    await stage('variations', 'demo_Person5_1');
    await page.getByRole('status').filter({ hasText: 'Image previews are unavailable' }).waitFor();
    assert.equal(await page.locator('.kiosk-variation').count(), 0);
    assert.equal(await page.locator('img[src*="Loreal-ads-atscale-simple"]').count(), 0);
    for (const [index, brand] of ['1-larocheposay', '2-lorealprofessionnel', '3-YSLbeauty', '4-lorealparis'].entries()) {
      await stage('ending', `demo_Person5_${index + 1}`, index === 3 ? 'fr' : 'en');
      const preview = page.locator('.kiosk-demo-print img');
      await preview.waitFor();
      assert(new URL(await preview.getAttribute('src')).pathname.endsWith(`/print-previews/${brand}.jpg`));
      assert.match(await page.locator('.kiosk-ending-copy p').innerText(), index === 3 ? /DÉMONSTRATION/ : /DEMO PRINT PREVIEW ONLY/);
      assert.equal(await page.locator('a[href*="max-download"], .kiosk-qr').count(), 0);
      const state = await page.evaluate(() => JSON.parse(sessionStorage.getItem('glam-attendee-v1:azure:TestEvent')));
      assert.equal(state.printRequest, null);
      assert.equal(state.prepareRequest, null);
    }
    catalog = { ...catalog, people: [] };
    await stage('portraits');
    await page.locator('.kiosk-portrait-grid').waitFor();
    assert.equal(await page.locator('.kiosk-demo-card').count(), 0);
    catalog = { ...fixture(), revision: 'invalid' };
    await stage('portraits');
    await page.getByRole('alert').filter({ hasText: 'permanent demo catalog is invalid' }).waitFor();
    assert.equal(await page.locator('.kiosk-demo-card').count(), 0);
    assert(requests.every(({ method, path: requestPath }) => method === 'GET'
      && !requestPath.includes('/requests/') && !requestPath.includes('/9-Graph-Input/')));
    assert.deepEqual(errors, []);
    console.log('Permanent demos browser: catalog picker/name/ads, no manual upload controls, 23 brand variations, Finish resets both surfaces, no empty fallback, four static endings EN/FR, zero writes/Graph autoload passed.');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
