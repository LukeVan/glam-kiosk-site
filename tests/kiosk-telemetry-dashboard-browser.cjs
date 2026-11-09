const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(path.join(path.dirname(fs.realpathSync(process.argv[2])), 'index.js'));

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const fixture = (revision = 1, changes = {}) => ({
      schemaVersion: 1, eventId: 'Event', stationId: 'MAX-01',
      journeyId: '11111111-1111-4111-8111-111111111111', revision, selectedBrand: 'lorealprofessionnel',
      isTest: false, outcome: 'completed', startedAt: '2026-11-03T08:30:00.000Z',
      updatedAt: '2026-11-03T08:31:00.000Z', endedAt: '2026-11-03T08:31:00.000Z',
      milestones: {
        portraitSelected: '2026-11-03T08:30:00.000Z',
        finishClicked: '2026-11-03T08:30:40.000Z', postcardUsable: '2026-11-03T08:31:00.000Z',
      },
      elapsedMs: { portraitSelected: 0, finishClicked: 40000, postcardUsable: 60000 },
      graph: { interstitialCount: 1, interstitialMs: 20000, hiddenMs: null, returnCount: 0, returnMs: null, status: 'skipped' },
      timingQuality: 'monotonic', ...changes,
    });
    const items = [fixture(1), fixture(5, { selectedBrand: 'lorealparis' }),
      fixture(1, { stationId: 'MAX-02', isTest: true }),
      fixture(1, { stationId: 'MAX-03', outcome: 'reset' })];
    let reads = 0;
    let failNewest = false;
    await page.route('https://ffservices24.blob.core.windows.net/**', (route) => {
      reads += 1;
      assert.equal(route.request().method(), 'GET');
      const url = new URL(route.request().url());
      const name = (item) => `${item.eventId}/telemetry/${item.stationId}/${item.journeyId}/${item.revision}.json`;
      if (url.searchParams.get('comp') === 'list') {
        return route.fulfill({
          contentType: 'application/xml',
          body: `<EnumerationResults><Blobs>${items.map((item) => `<Blob><Name>${name(item)}</Name></Blob>`).join('')}</Blobs><NextMarker></NextMarker></EnumerationResults>`,
        });
      }
      const item = items.find((value) => url.pathname.endsWith(`/${name(value)}`));
      if (failNewest && item?.revision === 5) return route.fulfill({ status: 503 });
      return route.fulfill(item ? { json: item } : { status: 404 });
    });
    await page.goto('http://localhost:3017/telemetry.html');
    await page.getByRole('heading', { name: 'MAX staff journey telemetry', exact: true }).waitFor();
    await page.evaluate(() => {
      const expiry = new Date(Date.now() + 86400000).toISOString();
      const sas = (sp) => `https://ffservices24.blob.core.windows.net/meow-glam-telemetry?sv=2023-11-03&sr=c&sp=${sp}&spr=https&se=${encodeURIComponent(expiry)}&sig=MOCK_ONLY`;
      localStorage.setItem('glam-kiosk-booth-v1', JSON.stringify({
        eventId: 'Event', telemetryUploadContainerSasUrl: sas('c'), telemetryReadContainerSasUrl: sas('rl'),
      }));
    });
    assert.equal(reads, 0, 'Dashboard must not fetch before manual refresh');
    const refresh = page.getByRole('button', { name: 'Refresh report from Azure' });
    await refresh.click();
    await page.getByText('Complete fetched snapshot.', { exact: false }).waitFor();
    await page.locator('summary').filter({ hasText: 'Brand ranking data' }).click();
    const brands = page.locator('.telemetry-brands table');
    assert((await brands.innerText()).includes('L’Oréal Paris'));
    assert.equal(await brands.locator('tbody tr').first().innerText(), '1\tL’Oréal Paris\t1\t100.0%');
    assert.equal(reads, 4, 'Read only highest revision for each of three journeys');
    assert.equal(await page.locator('.telemetry-kpi').count(), 4);
    assert.equal(await page.locator('.telemetry-card').count(), 4);
    assert.equal(await page.locator('.telemetry-donut-total strong').innerText(), '1');
    assert.equal(await page.locator('.telemetry-brands .telemetry-bar-fill[data-brand="lorealparis"]').evaluate((el) => el.style.width), '100%');
    assert((await page.locator('.telemetry-scope').innerText()).includes('UTC'));
    assert.equal(await page.locator('.telemetry-status').getAttribute('data-state'), 'success');
    const before = reads;
    await page.getByLabel('Station ID (optional, e.g. MAX-01)').fill('MAX-02');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    assert((await page.locator('[role="status"]').innerText()).includes('0 journeys'));
    await page.getByLabel('Include setup/test journeys').check();
    await page.getByRole('button', { name: 'Apply filters' }).click();
    assert((await page.locator('[role="status"]').innerText()).includes('1 journeys'));
    assert.equal(reads, before, 'Filters operate on snapshot without network polling');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export filtered CSV' }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    let csv = '';
    for await (const chunk of stream) csv += chunk;
    assert(csv.includes('Report scope'));
    assert(csv.includes('MAX-02'));
    assert(!csv.includes('MOCK_ONLY'));
    failNewest = true;
    await refresh.click();
    await page.getByText('INCOMPLETE / CAPPED SNAPSHOT', { exact: false }).waitFor();
    assert.equal(await page.locator('.telemetry-status').getAttribute('data-state'), 'warning');
    assert(!(await page.locator('.kiosk-telemetry-results').innerText()).includes('MOCK_ONLY'));
    const capped = await page.evaluate(async (sample) => {
      const { readTelemetryReport } = await import('/scripts/kiosk-telemetry-report.js');
      const fixtures = Array.from({ length: 501 }, (_, index) => ({
        ...sample, journeyId: `${String(index).padStart(8, '0')}-1111-4111-8111-111111111111`,
      }));
      const name = (item) => `${item.eventId}/telemetry/${item.stationId}/${item.journeyId}/1.json`;
      let gets = 0;
      const result = await readTelemetryReport({ read: 'https://mock.invalid/meow-glam-telemetry' }, 'Event', {
        fetcher: async (url) => {
          if (new URL(url).searchParams.get('comp') === 'list') {
            return new Response(`<EnumerationResults><Blobs>${fixtures.map((item) => `<Blob><Name>${name(item)}</Name></Blob>`).join('')}</Blobs><NextMarker></NextMarker></EnumerationResults>`);
          }
          gets += 1;
          return new Response(JSON.stringify(fixtures.find((item) => new URL(url).pathname.endsWith(name(item)))));
        },
      });
      return { incomplete: result.incomplete, count: result.snapshots.length, gets };
    }, fixture());
    assert.deepEqual(capped, { incomplete: true, count: 500, gets: 500 });
    // Multiple stations, brands, event days, and absent observations share the same chart filters.
    failNewest = false;
    items.splice(0, items.length, ...Array.from({ length: 48 }, (_, index) => {
      const brandsByIndex = ['lorealparis', 'lorealprofessionnel', 'yslbeauty', 'larocheposay', null];
      return fixture(1, {
        journeyId: `${String(index).padStart(8, '0')}-1111-4111-8111-111111111111`,
        stationId: `MAX-${String((index % 12) + 1).padStart(2, '0')}`,
        selectedBrand: brandsByIndex[index % 5],
        startedAt: `2026-11-0${(index % 3) + 1}T08:30:00.000Z`,
        elapsedMs: { portraitSelected: 0, finishClicked: 40000 + index * 1000, postcardUsable: 60000 + index * 1000 },
      });
    }));
    await page.getByLabel('Station ID (optional, e.g. MAX-01)').fill('');
    await page.getByLabel('Include setup/test journeys').uncheck();
    await refresh.click();
    await page.getByText('Complete fetched snapshot.', { exact: false }).waitFor();
    assert.equal(await page.locator('.telemetry-donut-total strong').innerText(), '48');
    const brandBars = await page.locator('.telemetry-brands .telemetry-bar-fill').evaluateAll((els) => els.map((el) => parseFloat(el.style.width)));
    assert(Math.abs(brandBars.reduce((sum, n) => sum + n, 0) - 100) < 0.01);
    assert((await page.locator('.telemetry-card').nth(1).innerText()).includes('Not observed · n=0'));
    assert.equal(await page.locator('.telemetry-card').nth(2).locator('li').count(), 12);
    assert.equal(await page.locator('.telemetry-card').nth(3).locator('li').count(), 3);
    if (process.env.KIOSK_DASHBOARD_SCREENSHOT) {
      await page.screenshot({ path: `${process.env.KIOSK_DASHBOARD_SCREENSHOT}-desktop.png`, fullPage: true });
    }
    for (const width of [1440, 900, 600, 390]) {
      await page.setViewportSize({ width, height: 1100 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        `No page-level horizontal overflow at ${width}px`);
    }
    if (process.env.KIOSK_DASHBOARD_SCREENSHOT) {
      await page.screenshot({ path: `${process.env.KIOSK_DASHBOARD_SCREENSHOT}-mobile.png`, fullPage: true });
    }
    const beforeEmpty = reads;
    await page.getByLabel('Station ID (optional, e.g. MAX-01)').fill('MAX-99');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    assert.equal(await page.locator('.telemetry-donut-total strong').innerText(), '0');
    assert((await page.locator('.telemetry-kpi').nth(1).innerText()).includes('Not observed'));
    assert.equal(reads, beforeEmpty);
    await page.getByLabel('Display / event-day timezone (IANA)').fill('invalid/timezone');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    assert.equal(await page.locator('.telemetry-status').getAttribute('data-state'), 'error');
    assert.equal(await page.getByRole('button', { name: 'Export filtered CSV' }).isDisabled(), true);
    await page.getByLabel('Display / event-day timezone (IANA)').fill('UTC');
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('glam-kiosk-booth-v1'));
      saved.telemetryReadContainerSasUrl = 'expired';
      localStorage.setItem('glam-kiosk-booth-v1', JSON.stringify(saved));
    });
    const failedBefore = reads;
    await refresh.click();
    await page.getByText('Telemetry access is not configured, invalid or expired.', { exact: false }).waitFor();
    assert.equal(reads, failedBefore);
    assert.equal(await page.locator('.telemetry-kpi').count(), 0, 'Failed access cannot leave stale charts visible');
    assert.deepEqual(errors, []);
    console.log('Telemetry dashboard: manual-only reads, highest revisions, completed/test/station filters, brand ranking, CSV, failed-read labeling, bounded 500-journey cap and credential isolation passed.');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exit(1); });
