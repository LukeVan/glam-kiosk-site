const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(path.join(path.dirname(fs.realpathSync(process.argv[2])), 'index.js'));

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/telemetry-test', (route) => route.fulfill({
      contentType: 'text/html', body: '<!doctype html><button id="navigate">Go</button>',
    }));
    await page.goto('http://localhost:3017/telemetry-test');
    const results = await page.evaluate(async () => {
      const { saveSettings } = await import('/scripts/kiosk-settings.js');
      const { TELEMETRY_PREFS_KEY, telemetryFetch } = await import('/scripts/kiosk-telemetry-config.js');
      const { default: createTelemetry, telemetryDiagnostics } = await import('/scripts/kiosk-telemetry.js');
      const { enqueueSnapshot, pendingSnapshots, pendingCount } = await import('/scripts/kiosk-telemetry-store.js');
      const expiry = new Date(Date.now() + 86400000).toISOString();
      const sas = (container, sp) => `https://ffservices24.blob.core.windows.net/${container}?sv=2023-11-03&sr=c&sp=${sp}&spr=https&se=${encodeURIComponent(expiry)}&sig=MOCK_ONLY`;
      saveSettings(localStorage, {
        version: 1, eventId: 'Event', activationProfile: 'max', formType: 'none',
        containerSAS: sas('mock-assets', 'rl'),
        telemetryUploadContainerSasUrl: sas('meow-glam-telemetry', 'c'),
        telemetryReadContainerSasUrl: sas('meow-glam-telemetry', 'rl'),
      });
      localStorage.setItem(TELEMETRY_PREFS_KEY, JSON.stringify({
        stationId: 'MAX-01', timeZone: 'UTC', isTest: true,
      }));
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
      const telemetry = createTelemetry({ eventId: 'Event' });
      telemetry.selected();
      telemetry.graphExit();
      telemetry.reset();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const original = JSON.parse((await pendingSnapshots())[0].body);
      const capacity = await (async () => {
        for (let index = 1; index < 500; index += 1) {
          await enqueueSnapshot({
            ...original, journeyId: `${String(index).padStart(8, '0')}-1111-4111-8111-111111111111`,
          });
        }
        return {
          pending: await pendingCount(),
          accepted: await enqueueSnapshot({ ...original, journeyId: '99999999-1111-4111-8111-111111111111' }),
        };
      })();
      telemetry.selected();
      telemetry.finish();
      telemetry.usable();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const drops = (await telemetryDiagnostics()).dropped;
      const previousWrite = Storage.prototype.setItem;
      Storage.prototype.setItem = function blocked(key, value) {
        if (key.startsWith('glam-kiosk-telemetry-journey')) throw new DOMException('quota', 'QuotaExceededError');
        return previousWrite.call(this, key, value);
      };
      telemetry.selected();
      telemetry.reset();
      Storage.prototype.setItem = previousWrite;
      const previousUUID = crypto.randomUUID;
      crypto.randomUUID = () => { throw new Error('random UUID unavailable'); };
      telemetry.selected();
      crypto.randomUUID = previousUUID;
      const badClock = createTelemetry({ eventId: 'Event' });
      badClock.selected();
      const previousNow = Date.now;
      Date.now = () => previousNow() + 120000;
      badClock.finish();
      const clockSnapshot = JSON.parse(sessionStorage.getItem('glam-kiosk-telemetry-journey-v1')).snapshot;
      badClock.usable();
      Date.now = previousNow;
      // Body consumption as well as headers must be bounded by the request timeout.
      const started = performance.now();
      let timeout = false;
      try {
        await telemetryFetch('https://mock.invalid', {}, async (url, options) => {
          await new Promise((resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
          });
        });
      } catch { timeout = true; }
      let bodyTimeout = false;
      try {
        await telemetryFetch('https://mock.invalid', {}, async (url, options) => new Response(new ReadableStream({
          start(controller) {
            options.signal.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true });
          },
        })));
      } catch { bodyTimeout = true; }
      return {
        capacity, drops, timeout, bodyTimeout, elapsed: performance.now() - started,
        diagnostics: await telemetryDiagnostics(),
        skipped: original.graph, clockSnapshot,
      };
    });
    assert.deepEqual(results.capacity, { pending: 500, accepted: false });
    assert(results.drops > 0);
    assert(results.diagnostics.persistenceFailures > 0);
    assert(results.timeout && results.bodyTimeout);
    assert(results.elapsed >= 9900 && results.elapsed < 12000);
    assert.equal(results.skipped.status, 'skipped');
    assert.equal(results.skipped.returnMs, null);
    assert.equal(results.clockSnapshot.timingQuality, 'clock_anomaly');
    assert.equal(results.clockSnapshot.elapsedMs.finishClicked, null);
    assert.deepEqual(errors, []);

    // A module that never loads must not delay the actual kiosk's consent navigation.
    const kiosk = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    kiosk.on('pageerror', (error) => errors.push(error.message));
    await kiosk.route('**/scripts/kiosk-telemetry.js', () => {});
    await kiosk.route('https://ffservices24.blob.core.windows.net/**', (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/catalog.json')) return route.fulfill({ status: 404 });
      return route.fulfill({
        contentType: 'application/xml',
        body: '<EnumerationResults><Blobs></Blobs><NextMarker></NextMarker></EnumerationResults>',
      });
    });
    await kiosk.goto('http://localhost:3017/max2026.html');
    await kiosk.evaluate(async () => {
      const { saveSettings } = await import('/scripts/kiosk-settings.js');
      const expiry = new Date(Date.now() + 86400000).toISOString();
      saveSettings(localStorage, {
        version: 1, eventId: 'Event', activationProfile: 'max', formType: 'none',
        containerSAS: `https://ffservices24.blob.core.windows.net/mock-assets?sv=2023-11-03&sr=c&sp=rl&se=${encodeURIComponent(expiry)}&sig=MOCK_ONLY`,
      });
    });
    await kiosk.reload({ waitUntil: 'domcontentloaded' });
    await kiosk.locator('.kiosk-consent input').check();
    await kiosk.locator('.kiosk-print').click();
    await kiosk.locator('.kiosk-portrait-grid button').first().waitFor();
    assert.equal(await kiosk.locator('.kiosk-startup-error, [role="alert"]').count(), 0);
    assert.deepEqual(errors, []);
    console.log('Telemetry failures: 500-journey outbox cap, explicit dropped counts, quota/crypto containment, network/body timeouts, offline collection and real kiosk navigation with hung telemetry module passed.');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exit(1); });
