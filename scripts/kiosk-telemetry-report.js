import { validSnapshot, TELEMETRY_BRANDS } from './kiosk-telemetry.js';
import { telemetryFetch, telemetryURL } from './kiosk-telemetry-config.js';

export const MAX_REPORT_JOURNEYS = 500;
const MAX_LISTED_BLOBS = 10000;

export function latestJourneys(snapshots) {
  const latest = new Map();
  snapshots.filter(validSnapshot).forEach((item) => {
    const key = `${item.eventId}/${item.stationId}/${item.journeyId}`;
    if (!latest.has(key) || latest.get(key).revision < item.revision) latest.set(key, item);
  });
  return [...latest.values()];
}

export function stats(values) {
  const sorted = values.filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  const { length } = sorted;
  return {
    count: length,
    mean: length ? sorted.reduce((sum, value) => sum + value, 0) / length : null,
    median: length
      ? (sorted[Math.floor((length - 1) / 2)] + sorted[Math.ceil((length - 1) / 2)]) / 2 : null,
    p90: length ? sorted[Math.ceil(length * 0.9) - 1] : null,
  };
}

export function eventDay(timestamp, timeZone) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const part = (type) => parts.find((item) => item.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function filterJourneys(snapshots, {
  eventId, start = '', end = '', timeZone = 'UTC', day = '', station = '',
  includeTests = false, outcome = 'completed',
} = {}) {
  return latestJourneys(snapshots).filter((item) => (
    (!eventId || item.eventId === eventId)
    && (!start || Date.parse(item.startedAt) >= Date.parse(start))
    && (!end || Date.parse(item.startedAt) <= Date.parse(end))
    && (!day || eventDay(item.startedAt, timeZone) === day)
    && (!station || item.stationId === station)
    && (includeTests || !item.isTest) && (!outcome || item.outcome === outcome)
  ));
}

export function summarizeJourneys(items) {
  const difference = (item, first, last) => {
    if (item.timingQuality !== 'monotonic'
      || item.elapsedMs[first] === null || item.elapsedMs[last] === null) return null;
    return item.elapsedMs[last] - item.elapsedMs[first];
  };
  const metrics = {
    selectedToFinish: stats(items.map((item) => difference(item, 'portraitSelected', 'finishClicked'))),
    selectedToPostcard: stats(items.map((item) => difference(item, 'portraitSelected', 'postcardUsable'))),
    finalLoading: stats(items.map((item) => difference(item, 'finishClicked', 'postcardUsable'))),
    graphInterstitial: stats(items.map((item) => (item.timingQuality === 'monotonic' ? item.graph.interstitialMs : null))),
    graphReturn: stats(items.map((item) => (item.timingQuality === 'monotonic' ? item.graph.returnMs : null))),
    graphHidden: stats(items.map((item) => (item.timingQuality === 'monotonic' ? item.graph.hiddenMs : null))),
  };
  const brands = [...TELEMETRY_BRANDS, 'unknown'].map((brand) => {
    const count = items.filter((item) => (item.selectedBrand || 'unknown') === brand).length;
    return { brand, count, percent: items.length ? (count / items.length) * 100 : 0 };
  }).sort((a, b) => b.count - a.count);
  return { count: items.length, metrics, brands };
}

export function journeyCSV(items) {
  const headers = ['eventId', 'stationId', 'journeyId', 'revision', 'isTest', 'outcome', 'selectedBrand',
    'startedAt', 'finishClickedAt', 'postcardUsableAt', 'endedAt', 'timingQuality',
    'selectedToFinishMs', 'selectedToPostcardMs', 'finalLoadingMs',
    'graphStatus', 'graphReturnCount', 'graphInterstitialMs', 'graphReturnMs', 'graphHiddenMs'];
  const quote = (value) => `"${String(value ?? '').replace(/^[=+@-]/, "'$&").replaceAll('"', '""')}"`;
  const rows = items.map((item) => {
    const { metrics } = summarizeJourneys([item]);
    return [item.eventId, item.stationId, item.journeyId, item.revision, item.isTest,
      item.outcome, item.selectedBrand, item.startedAt, item.milestones.finishClicked,
      item.milestones.postcardUsable, item.endedAt, item.timingQuality,
      metrics.selectedToFinish.mean, metrics.selectedToPostcard.mean, metrics.finalLoading.mean,
      item.graph.status, item.graph.returnCount, metrics.graphInterstitial.mean,
      metrics.graphReturn.mean, metrics.graphHidden.mean];
  });
  return [headers, ...rows].map((row) => row.map(quote).join(',')).join('\r\n');
}

export async function readTelemetryReport(credentials, eventId, {
  fetcher = fetch, parseXML = (xml) => new DOMParser().parseFromString(xml, 'application/xml'),
} = {}) {
  if (!eventId || /[/\\]/.test(eventId) || ['.', '..'].includes(eventId)
    || [...eventId].some((character) => character.charCodeAt(0) < 32)) {
    throw new Error('Choose a valid event in booth settings.');
  }
  const prefix = `${eventId}/telemetry/`;
  const candidates = new Map();
  let marker = '';
  const markers = new Set();
  let listed = 0;
  let incomplete = false;
  const snapshots = [];
  let pages = 0;
  const acceptEntry = (entry) => {
    listed += 1;
    const name = entry.textContent;
    const suffix = name.startsWith(prefix) ? name.slice(prefix.length) : '';
    const match = /^(MAX-(?:0[1-9]|[1-9][0-9]))\/([a-f0-9-]{36})\/([1-9][0-9]{0,4})\.json$/.exec(suffix);
    if (!match) { incomplete = true; return; }
    const key = `${match[1]}/${match[2]}`;
    const revision = Number(match[3]);
    if (!candidates.has(key) || candidates.get(key).revision < revision) {
      candidates.set(key, {
        name, revision, stationId: match[1], journeyId: match[2],
      });
    }
  };
  const download = async (record) => {
    try {
      const url = telemetryURL(credentials.read, record.name);
      const response = await telemetryFetch(url, {}, fetcher);
      if (!response.ok) throw new Error('snapshot_failed');
      const snapshot = await response.json();
      if (!validSnapshot(snapshot) || snapshot.eventId !== eventId
        || snapshot.stationId !== record.stationId || snapshot.journeyId !== record.journeyId
        || snapshot.revision !== record.revision) throw new Error('snapshot_invalid');
      snapshots.push(snapshot);
    } catch { incomplete = true; }
  };
  try {
    do {
      pages += 1;
      const url = new URL(credentials.read);
      url.searchParams.set('restype', 'container');
      url.searchParams.set('comp', 'list');
      url.searchParams.set('prefix', prefix);
      url.searchParams.set('maxresults', '500');
      if (marker) url.searchParams.set('marker', marker);
      // Azure continuation markers require serial listing.
      // eslint-disable-next-line no-await-in-loop
      const response = await telemetryFetch(url.href, { maxBytes: 1048576 }, fetcher);
      if (!response.ok) throw new Error('listing_failed');
      // eslint-disable-next-line no-await-in-loop
      const doc = parseXML(await response.text());
      if (doc.documentElement.tagName !== 'EnumerationResults'
        || !doc.querySelector('Blobs') || !doc.querySelector('NextMarker')) throw new Error('listing_invalid');
      const entries = [...doc.querySelectorAll('Blobs > Blob > Name')];
      entries.forEach(acceptEntry);
      marker = doc.querySelector('NextMarker').textContent;
      if (marker && markers.has(marker)) throw new Error('listing_repeated');
      markers.add(marker);
      if ((listed >= MAX_LISTED_BLOBS || pages >= 20) && marker) { incomplete = true; break; }
    } while (marker);
  } catch { incomplete = true; }
  const records = [...candidates.values()].slice(0, MAX_REPORT_JOURNEYS);
  if (candidates.size > records.length) incomplete = true;
  for (let index = 0; index < records.length; index += 4) {
    // At most four bounded downloads at a time; the dashboard never polls automatically.
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(records.slice(index, index + 4).map(download));
  }
  return {
    snapshots, incomplete, listed, candidates: candidates.size,
  };
}
