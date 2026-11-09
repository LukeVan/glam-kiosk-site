const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(path.join(path.dirname(fs.realpathSync(process.argv[2])), 'index.js'));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kiosk-telemetry-restart-'));
  let context;
  const errors = [];
  const launch = async () => {
    context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/telemetry-restart', (route) => route.fulfill({
      contentType: 'text/html', body: '<!doctype html><p>Restart fixture</p>',
    }));
    await page.route('https://ffservices24.blob.core.windows.net/**', (route) => route.fulfill({ status: 503 }));
    await page.goto('http://localhost:3017/telemetry-restart');
    return page;
  };
  try {
    let page = await launch();
    const journeyId = await page.evaluate(async () => {
      const { saveSettings } = await import('/scripts/kiosk-settings.js');
      const expiry = new Date(Date.now() + 86400000).toISOString();
      const sas = (container, sp) => `https://ffservices24.blob.core.windows.net/${container}?sv=2023-11-03&sr=c&sp=${sp}&spr=https&se=${encodeURIComponent(expiry)}&sig=MOCK_ONLY`;
      saveSettings(localStorage, {
        version: 1, eventId: 'Event', activationProfile: 'max', formType: 'none',
        containerSAS: sas('mock-assets', 'rl'),
        telemetryUploadContainerSasUrl: sas('meow-glam-telemetry', 'c'),
        telemetryReadContainerSasUrl: sas('meow-glam-telemetry', 'rl'),
      });
      localStorage.setItem('glam-kiosk-telemetry-prefs-v1', JSON.stringify({
        stationId: 'MAX-02', timeZone: 'UTC', isTest: true,
      }));
      const { default: createTelemetry } = await import('/scripts/kiosk-telemetry.js');
      const telemetry = createTelemetry({ eventId: 'Event' });
      telemetry.selected();
      telemetry.finish();
      window.dispatchEvent(new PageTransitionEvent('pagehide'));
      const { pendingSnapshots } = await import('/scripts/kiosk-telemetry-store.js');
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const snapshots = (await pendingSnapshots()).map((record) => JSON.parse(record.body));
        if (snapshots.some((item) => item.outcome === 'interrupted')) return snapshots[0].journeyId;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error('Interrupted snapshot did not persist');
    });
    await context.close();
    page = await launch();
    const snapshot = await page.evaluate(async () => {
      const { default: createTelemetry } = await import('/scripts/kiosk-telemetry.js');
      const { pendingSnapshots } = await import('/scripts/kiosk-telemetry-store.js');
      const telemetry = createTelemetry({ eventId: 'Event' });
      telemetry.usable();
      return JSON.parse((await pendingSnapshots())[0].body);
    });
    assert.equal(snapshot.journeyId, journeyId);
    assert.equal(snapshot.outcome, 'interrupted');
    assert.equal(snapshot.milestones.postcardUsable, null);
    assert.equal(snapshot.stationId, 'MAX-02');
    assert.deepEqual(errors, []);
    console.log('Telemetry restart: durable outbox and station survive a real browser restart; unfinished postcard remains interrupted, never falsely completed.');
  } finally {
    if (context) await context.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exit(1); });
