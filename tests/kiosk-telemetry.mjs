import assert from 'node:assert/strict';
import { validateSettings } from '../scripts/kiosk-settings.js';
import { parseAccessFile } from '../scripts/kiosk-access-import.js';
import { telemetryCredentials, telemetryFetch } from '../scripts/kiosk-telemetry-config.js';
import { validSnapshot, uploadSnapshot } from '../scripts/kiosk-telemetry.js';
import {
  latestJourneys, stats, filterJourneys, summarizeJourneys, journeyCSV, eventDay,
} from '../scripts/kiosk-telemetry-report.js';

const expiry = new Date(Date.now() + 86400000).toISOString();
const sas = (container, permissions, expires = expiry) => `https://ffservices24.blob.core.windows.net/${container}?sv=2023-11-03&sr=c&sp=${permissions}&spr=https&se=${encodeURIComponent(expires)}&sig=MOCK_ONLY`;
const core = {
  version: 1, containerSAS: sas('mock-assets', 'rl'), requestSAS: sas('glam-kiosk-requests', 'c'),
  eventId: 'Event', activationProfile: 'max', formType: 'none',
};
const pair = {
  telemetryUploadContainerSasUrl: sas('meow-glam-telemetry', 'c'),
  telemetryReadContainerSasUrl: sas('meow-glam-telemetry', 'rl'),
};
assert.equal(telemetryCredentials(pair).status, 'ready');
assert.equal(telemetryCredentials({}).status, 'unconfigured');
for (const invalid of [
  { telemetryUploadContainerSasUrl: pair.telemetryUploadContainerSasUrl },
  { ...pair, telemetryUploadContainerSasUrl: sas('meow-glam-telemetry', 'cw') },
  { ...pair, telemetryReadContainerSasUrl: sas('mock-assets', 'rl') },
  { telemetryUploadContainerSasUrl: sas('glam-telemetry', 'c'), telemetryReadContainerSasUrl: sas('glam-telemetry', 'rl') },
  { ...pair, telemetryReadContainerSasUrl: sas('meow-glam-telemetry', 'rl', '2020-01-01T00:00:00Z') },
  { ...pair, telemetryUploadContainerSasUrl: {} },
  { ...pair, expiresAt: '2020-01-01T00:00:00Z' },
]) {
  assert.equal(telemetryCredentials(invalid).status, 'invalid');
  assert.equal(validateSettings({ ...core, ...invalid }).eventId, 'Event');
}
const file = {
  schemaVersion: 1, type: 'glam-kiosk-access', eventPrefix: core.eventId,
  assetContainerSasUrl: core.containerSAS, requestContainerSasUrl: core.requestSAS, expiresAt: expiry,
};
assert.equal(parseAccessFile(JSON.stringify(file)).eventId, 'Event');
assert.equal(parseAccessFile(JSON.stringify({ ...file, ...pair })).telemetryUploadContainerSasUrl, pair.telemetryUploadContainerSasUrl);
assert.equal(parseAccessFile(JSON.stringify({ ...file, telemetryUploadContainerSasUrl: 'expired' })).eventId, 'Event');
assert.throws(() => parseAccessFile(JSON.stringify({ ...file, assetContainerSasUrl: 'invalid' })));

const snapshot = (revision = 1, changes = {}) => ({
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
assert(validSnapshot(snapshot()));
assert(!validSnapshot(snapshot(1, { attendeeName: 'must-not-be-allowed' })));
assert(!validSnapshot(snapshot(1, { selectedBrand: 'free text' })));
assert(!validSnapshot(snapshot(1, { portraitId: 'must-not-be-allowed' })));
assert.deepEqual(stats([10, 20, 30, 40, null]), { count: 4, mean: 25, median: 25, p90: 40 });
assert.deepEqual(stats([null]), { count: 0, mean: null, median: null, p90: null });
const latest = snapshot(5, { selectedBrand: 'lorealparis' });
assert.equal(latestJourneys([latest, snapshot(2), latest]).length, 1);
assert.equal(latestJourneys([latest, snapshot(2)])[0].selectedBrand, 'lorealparis');
assert.equal(eventDay('2026-11-03T01:00:00.000Z', 'America/Los_Angeles'), '2026-11-02');
const samples = [snapshot(), latest, snapshot(1, { stationId: 'MAX-02', isTest: true }),
  snapshot(1, { stationId: 'MAX-03', outcome: 'reset' })];
assert.equal(filterJourneys(samples).length, 1);
assert.equal(filterJourneys(samples, { includeTests: true }).length, 2);
assert.equal(filterJourneys(samples, { outcome: 'reset' }).length, 1);
assert.equal(filterJourneys(samples, { start: '2026-11-03T09:00:00Z' }).length, 0);
const summary = summarizeJourneys(filterJourneys(samples));
assert.equal(summary.metrics.finalLoading.mean, 20000);
assert.equal(summary.metrics.graphReturn.count, 0, 'Unobserved Graph is not a zero-second return');
assert.equal(summary.brands[0].brand, 'lorealparis');
assert.equal(summary.brands[0].count, 1);
assert.equal(summary.brands[0].percent, 100);
assert.equal(summarizeJourneys([snapshot(1, { selectedBrand: null })]).brands[0].brand, 'unknown');
assert.equal(summarizeJourneys([snapshot(1, { timingQuality: 'resumed' })]).metrics.finalLoading.count, 0);
assert.equal(summarizeJourneys([snapshot(1, { timingQuality: 'clock_anomaly' })]).metrics.finalLoading.count, 0);
assert(journeyCSV([latest]).includes('lorealparis'));
assert(!journeyCSV([latest]).includes('MOCK_ONLY'));
assert(journeyCSV([snapshot(1, { eventId: '=FORMULA' })]).includes("'=FORMULA"));
const record = { blob: 'Event/telemetry/MAX-01/fixture/1.json', body: JSON.stringify(latest) };
let calls = 0;
const credentials = telemetryCredentials(pair);
await uploadSnapshot(record, credentials, async (url, options) => {
  calls += 1;
  assert(url.includes('meow-glam-telemetry'));
  if (options.method === 'PUT') {
    assert.equal(options.headers['If-None-Match'], '*');
    return new Response('', { status: 412 });
  }
  return new Response(record.body);
});
assert.equal(calls, 2);
await assert.rejects(() => uploadSnapshot(record, credentials, async (url, options) => (
  options.method === 'PUT' ? new Response('', { status: 409 }) : new Response('different')
)));
await assert.rejects(() => telemetryFetch('https://mock.invalid', {}, async () => new Response('x'.repeat(8193))));
console.log('Telemetry unit: optional credential failure isolation, privacy schema, stats/nulls, filters/timezone, brand latest-revision dedup, CSV, immutable duplicate reconciliation and response limits passed.');
