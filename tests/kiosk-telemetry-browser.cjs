const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(path.join(path.dirname(fs.realpathSync(process.argv[2])), 'index.js'));

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await context.route('**/telemetry-test', (route) => route.fulfill({
      contentType: 'text/html', body: '<!doctype html><button id="navigate">Navigation still works</button>',
    }));
    let uploadMode = 'offline';
    const uploaded = new Map();
    let puts = 0;
    await context.route('https://ffservices24.blob.core.windows.net/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      assert.equal(url.pathname.split('/')[1], 'meow-glam-telemetry');
      if (request.method() === 'PUT') {
        puts += 1;
        if (uploadMode === 'offline') { await route.fulfill({ status: 503 }); return; }
        const body = request.postData();
        assert(!/MOCK_ONLY|portraitId|attendeeName|thumbnail|blob.core|sessionId/.test(body));
        if (uploaded.has(url.pathname)) { await route.fulfill({ status: 412 }); return; }
        uploaded.set(url.pathname, body);
        await route.fulfill({ status: 201 });
      } else {
        await route.fulfill({ body: uploaded.get(url.pathname) || '', status: uploaded.has(url.pathname) ? 200 : 404 });
      }
    });
    await page.goto('http://localhost:3017/telemetry-test');
    await page.evaluate(async () => {
      const { saveSettings } = await import('/scripts/kiosk-settings.js');
      const { TELEMETRY_PREFS_KEY } = await import('/scripts/kiosk-telemetry-config.js');
      const expiry = new Date(Date.now() + 86400000).toISOString();
      const sas = (container, sp) => `https://ffservices24.blob.core.windows.net/${container}?sv=2023-11-03&sr=c&sp=${sp}&spr=https&se=${encodeURIComponent(expiry)}&sig=MOCK_ONLY`;
      saveSettings(localStorage, {
        version: 1, eventId: 'Event', activationProfile: 'max', formType: 'none',
        containerSAS: sas('mock-assets', 'rl'), requestSAS: sas('glam-kiosk-requests', 'c'),
        telemetryUploadContainerSasUrl: sas('meow-glam-telemetry', 'c'),
        telemetryReadContainerSasUrl: sas('meow-glam-telemetry', 'rl'),
      });
      localStorage.setItem(TELEMETRY_PREFS_KEY, JSON.stringify({
        stationId: 'MAX-01', timeZone: 'America/Los_Angeles', isTest: false,
      }));
      window.tick = 0;
      window.jump = 0;
      const now = Date.now();
      Date.now = () => now + window.tick + window.jump;
      performance.now = () => window.tick;
      const { default: createTelemetry } = await import('/scripts/kiosk-telemetry.js');
      window.telemetry = createTelemetry({ eventId: 'Event' });
      window.telemetry.selected();
      window.tick = 100;
      window.telemetry.graphEnter();
      window.tick = 300;
      window.telemetry.graphOpen();
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.hidden });
      window.hidden = true;
      window.tick = 400;
      document.dispatchEvent(new Event('visibilitychange'));
      window.hidden = false;
      window.tick = 1400;
      document.dispatchEvent(new Event('visibilitychange'));
      window.tick = 1700;
      window.telemetry.graphOpen();
      window.hidden = true;
      window.tick = 1800;
      document.dispatchEvent(new Event('visibilitychange'));
      window.hidden = false;
      window.tick = 2400;
      document.dispatchEvent(new Event('visibilitychange'));
      window.tick = 3000;
      window.telemetry.graphExit();
      window.telemetry.brand('larocheposay');
      window.telemetry.brand('lorealparis');
      window.tick = 5000;
      window.telemetry.finish();
      window.tick = 6000;
      window.telemetry.finish();
    });
    const latest = async () => page.evaluate(async () => {
      const { pendingSnapshots } = await import('/scripts/kiosk-telemetry-store.js');
      return (await pendingSnapshots(500)).map((item) => JSON.parse(item.body));
    });
    await page.evaluate(async () => {
      const { pendingSnapshots } = await import('/scripts/kiosk-telemetry-store.js');
      const saved = JSON.parse(sessionStorage.getItem('glam-kiosk-telemetry-journey-v1')).snapshot;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if ((await pendingSnapshots()).some((item) => JSON.parse(item.body).revision === saved.revision)) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error('latest revision did not persist');
    });
    let snapshots = await latest();
    assert.equal(snapshots.length, 1, 'Outbox compacts older revisions of the same journey');
    assert.equal(snapshots[0].outcome, 'active', 'Finish alone is not completion');
    assert.equal(snapshots[0].selectedBrand, 'lorealparis', JSON.stringify({
      snapshots,
      saved: await page.evaluate(() => ({
        session: JSON.parse(sessionStorage.getItem('glam-kiosk-telemetry-journey-v1')),
        diagnostics: localStorage.getItem('glam-kiosk-telemetry-diagnostics-v1'),
      })),
    }));
    assert.equal(snapshots[0].elapsedMs.finishClicked, 5000);
    assert.deepEqual(snapshots[0].graph, {
      interstitialCount: 1, interstitialMs: 2900, hiddenMs: 1600,
      returnCount: 2, returnMs: 1800, status: 'observed',
    });
    await page.evaluate(() => {
      window.tick = 7000;
      window.telemetry.usable();
      window.telemetry.usable();
    });
    await page.waitForFunction(async () => {
      const { pendingSnapshots } = await import('/scripts/kiosk-telemetry-store.js');
      return (await pendingSnapshots()).some((item) => JSON.parse(item.body).outcome === 'completed');
    });
    snapshots = await latest();
    assert.equal(snapshots[0].elapsedMs.postcardUsable, 7000);
    const completed = snapshots[0];
    await page.waitForFunction(() => {
      const stats = JSON.parse(localStorage.getItem('glam-kiosk-telemetry-diagnostics-v1') || '{}');
      return stats.uploadFailures > 0;
    });
    assert(puts > 0);
    uploadMode = 'success';
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForFunction(async () => {
      const { pendingCount } = await import('/scripts/kiosk-telemetry-store.js');
      return await pendingCount() === 0;
    });
    assert([...uploaded.values()].some((body) => JSON.parse(body).outcome === 'completed'));
    // Requeue an already acknowledged immutable revision; reconciliation must read it before removal.
    await page.evaluate(async (snapshot) => {
      const { enqueueSnapshot } = await import('/scripts/kiosk-telemetry-store.js');
      await enqueueSnapshot(snapshot);
      window.dispatchEvent(new Event('online'));
    }, completed);
    await page.waitForFunction(async () => {
      const { pendingCount } = await import('/scripts/kiosk-telemetry-store.js');
      return await pendingCount() === 0;
    });

    uploadMode = 'offline';
    await page.evaluate(() => { window.telemetry.selected(); window.telemetry.finish(); });
    await page.waitForFunction(() => sessionStorage.getItem('glam-kiosk-telemetry-journey-v1'));
    await page.reload();
    await page.evaluate(async () => {
      const { default: createTelemetry } = await import('/scripts/kiosk-telemetry.js');
      window.telemetry = createTelemetry({ eventId: 'Event' });
    });
    await page.waitForFunction(async () => {
      const { pendingSnapshots } = await import('/scripts/kiosk-telemetry-store.js');
      return (await pendingSnapshots()).some((item) => JSON.parse(item.body).timingQuality === 'resumed');
    });
    snapshots = await latest();
    const resumed = snapshots.find((item) => item.timingQuality === 'resumed');
    assert.equal(resumed.outcome, 'active', 'Reload must not falsely complete an unfinished postcard');
    await page.evaluate(() => window.telemetry.reset());
    await page.waitForFunction(async () => {
      const { pendingSnapshots } = await import('/scripts/kiosk-telemetry-store.js');
      return (await pendingSnapshots()).some((item) => JSON.parse(item.body).outcome === 'reset');
    });
    // Lower late revisions cannot overwrite the reset snapshot.
    await page.evaluate(async (snapshot) => {
      const { enqueueSnapshot } = await import('/scripts/kiosk-telemetry-store.js');
      await enqueueSnapshot({ ...snapshot, revision: 1 });
    }, resumed);
    snapshots = await latest();
    assert.equal(snapshots.find((item) => item.journeyId === resumed.journeyId).outcome, 'reset');
    await page.evaluate(async () => {
      const { default: createTelemetry } = await import('/scripts/kiosk-telemetry.js');
      const original = IDBFactory.prototype.open;
      IDBFactory.prototype.open = () => { throw new Error('simulated unavailable IDB'); };
      const failing = createTelemetry({ eventId: 'Event' });
      failing.selected();
      failing.finish();
      failing.usable();
      await new Promise((resolve) => setTimeout(resolve, 50));
      IDBFactory.prototype.open = original;
      const button = document.querySelector('#navigate');
      button.onclick = () => { window.navigationWorked = true; };
      button.click();
    });
    assert.equal(await page.evaluate(() => window.navigationWorked), true);
    const diagnostics = await page.evaluate(() => JSON.parse(localStorage.getItem('glam-kiosk-telemetry-diagnostics-v1')));
    assert(diagnostics.persistenceFailures > 0);
    assert.deepEqual(errors, []);
    console.log('Telemetry browser: cumulative Graph proxy, milestone timing, changed final brand, Finish idempotency, offline outbox/retry, duplicate readback, reload/resume, lower-revision protection and IDB failure isolation passed.');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exit(1); });
