import { SETTINGS_KEY } from './kiosk-settings.js';
import {
  telemetryCredentials, telemetryPreferences, telemetryURL, telemetryFetch,
} from './kiosk-telemetry-config.js';
import {
  enqueueSnapshot, pendingSnapshots, pendingCount, removeSnapshot,
} from './kiosk-telemetry-store.js';

const SESSION_KEY = 'glam-kiosk-telemetry-journey-v1';
const DIAGNOSTICS_KEY = 'glam-kiosk-telemetry-diagnostics-v1';
const LIMIT_MS = 24 * 3600000;
const MILESTONES = ['portraitSelected', 'finishClicked', 'postcardUsable'];
const OUTCOMES = ['active', 'completed', 'reset', 'interrupted'];
const QUALITIES = ['monotonic', 'resumed', 'clock_anomaly'];
export const TELEMETRY_BRANDS = ['lorealprofessionnel', 'lorealparis', 'yslbeauty', 'larocheposay'];
const iso = (value) => typeof value === 'string' && value.length <= 30
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const duration = (value) => value === null
  || (Number.isFinite(value) && value >= 0 && value <= LIMIT_MS);
const exact = (object, keys) => object && typeof object === 'object'
  && Object.keys(object).length === keys.length && keys.every((key) => Object.hasOwn(object, key));

export function validSnapshot(value) {
  return exact(value, ['schemaVersion', 'eventId', 'stationId', 'journeyId', 'revision',
    'isTest', 'outcome', 'startedAt', 'updatedAt', 'endedAt', 'milestones', 'elapsedMs',
    'graph', 'timingQuality', 'selectedBrand'])
    && value.schemaVersion === 1 && typeof value.eventId === 'string'
    && value.eventId.length > 0 && value.eventId.length <= 256 && !/[/\\]/.test(value.eventId)
    && ![...value.eventId].some((character) => character.charCodeAt(0) < 32)
    && !['.', '..'].includes(value.eventId)
    && /^MAX-(?:0[1-9]|[1-9][0-9])$/.test(value.stationId)
    && /^[a-f0-9-]{36}$/.test(value.journeyId)
    && Number.isSafeInteger(value.revision) && value.revision > 0 && value.revision <= 10000
    && typeof value.isTest === 'boolean' && OUTCOMES.includes(value.outcome)
    && (value.selectedBrand === null || TELEMETRY_BRANDS.includes(value.selectedBrand))
    && QUALITIES.includes(value.timingQuality)
    && iso(value.startedAt) && iso(value.updatedAt)
    && (value.endedAt === null || iso(value.endedAt))
    && exact(value.milestones, MILESTONES) && MILESTONES.every((key) => (
    value.milestones[key] === null || iso(value.milestones[key])
  ))
    && exact(value.elapsedMs, MILESTONES) && Object.values(value.elapsedMs).every(duration)
    && exact(value.graph, ['interstitialCount', 'interstitialMs', 'hiddenMs',
      'returnCount', 'returnMs', 'status'])
    && ['interstitialCount', 'returnCount'].every((key) => Number.isSafeInteger(value.graph[key])
      && value.graph[key] >= 0 && value.graph[key] <= 1000)
    && ['interstitialMs', 'hiddenMs', 'returnMs'].every((key) => duration(value.graph[key]))
    && ['not_observed', 'skipped', 'observed'].includes(value.graph.status)
    && (value.outcome !== 'completed' || MILESTONES.every((key) => value.milestones[key] !== null));
}

function diagnose(code) {
  try {
    const saved = JSON.parse(localStorage.getItem(DIAGNOSTICS_KEY) || '{}');
    const counters = {};
    ['persistenceFailures', 'uploadFailures', 'dropped'].forEach((key) => {
      counters[key] = Math.min(1000000, (Number.isSafeInteger(saved[key]) ? saved[key] : 0)
        + Number(key === code));
    });
    localStorage.setItem(DIAGNOSTICS_KEY, JSON.stringify({ ...counters, lastCode: code }));
  } catch {
    // Telemetry diagnostics must also tolerate unavailable browser storage.
  }
}

export async function telemetryDiagnostics() {
  const result = JSON.parse(localStorage.getItem(DIAGNOSTICS_KEY) || '{}');
  try { result.pending = await pendingCount(); } catch { result.pending = null; }
  return result;
}

export async function uploadSnapshot(record, credentials, fetcher = fetch) {
  const response = await telemetryFetch(telemetryURL(credentials.upload, record.blob), {
    method: 'PUT',
    headers: {
      'x-ms-blob-type': 'BlockBlob',
      'x-ms-version': '2023-11-03',
      'Content-Type': 'application/json',
      'If-None-Match': '*',
    },
    body: record.body,
  }, fetcher);
  if (response.ok) return;
  if ([409, 412].includes(response.status)) {
    const existing = await telemetryFetch(telemetryURL(credentials.read, record.blob), {}, fetcher);
    if (existing.ok && existing.headers.get('content-length') <= 8192
      && await existing.text() === record.body) return;
  }
  throw new Error('upload_failed');
}

// This facade deliberately contains every telemetry failure, including browser API failures.
export default function createTelemetry({ eventId, isDemo = false } = {}) {
  const noop = {
    selected() {},
    brand() {},
    finish() {},
    usable() {},
    reset() {},
    graphEnter() {},
    graphOpen() {},
    graphExit() {},
  };
  try {
    if (typeof eventId !== 'string' || !eventId || eventId === 'invalid-settings') return noop;
    let journey;
    let anchor = performance.now();
    let base = 0;
    let wallAnchor = Date.now();
    let graphStart = null;
    let hiddenStart = null;
    let tripStart = null;
    let busy = false;
    let chain = Promise.resolve();
    let queued = 0;
    const safe = (action) => (...args) => {
      try { action(...args); } catch { diagnose('persistenceFailures'); }
    };
    const elapsed = () => {
      const delta = performance.now() - anchor;
      if (!Number.isFinite(delta) || delta < 0 || delta > LIMIT_MS
        || Math.abs(Date.now() - wallAnchor - delta) > 60000) {
        journey.timingQuality = 'clock_anomaly';
        return null;
      }
      return Math.min(LIMIT_MS, base + delta);
    };
    const persist = () => {
      if (!journey) return;
      journey.revision += 1;
      journey.updatedAt = new Date().toISOString();
      const currentElapsed = elapsed();
      if (!validSnapshot(journey)) { diagnose('dropped'); return; }
      const snapshot = JSON.parse(JSON.stringify(journey));
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ snapshot, currentElapsed }));
      } catch { diagnose('persistenceFailures'); }
      if (queued >= 32) { diagnose('dropped'); return; }
      queued += 1;
      chain = chain.then(() => enqueueSnapshot(snapshot)).then((saved) => {
        if (!saved) diagnose('dropped');
      }).catch(() => diagnose('persistenceFailures')).finally(() => { queued -= 1; });
    };
    const configuration = () => {
      const settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
      const credentials = telemetryCredentials(settings);
      if (settings?.eventId !== eventId || credentials.status !== 'ready') return null;
      const prefs = telemetryPreferences(localStorage);
      return prefs ? { ...credentials, ...prefs } : null;
    };
    const flush = async () => {
      if (busy || navigator.onLine === false) return;
      busy = true;
      try {
        const credentials = configuration();
        if (!credentials) return;
        const records = await pendingSnapshots(4, `${eventId}/telemetry/`);
        for (let index = 0; index < records.length; index += 1) {
          const record = records[index];
          const snapshot = JSON.parse(record.body);
          const expected = `${eventId}/telemetry/${snapshot.stationId}/${snapshot.journeyId}/${snapshot.revision}.json`;
          if (!validSnapshot(snapshot) || snapshot.eventId !== eventId
            || record.blob !== expected) {
            diagnose('dropped');
            // eslint-disable-next-line no-await-in-loop
            await removeSnapshot(record.blob);
          } else {
            // Serial, capped uploads avoid competing with attendee asset downloads.
            // eslint-disable-next-line no-await-in-loop
            await uploadSnapshot(record, credentials);
            // eslint-disable-next-line no-await-in-loop
            await removeSnapshot(record.blob);
          }
        }
      } catch { diagnose('uploadFailures'); } finally { busy = false; }
    };
    const scheduleFlush = () => { flush().catch(() => diagnose('uploadFailures')); };
    const finishOutcome = (outcome) => {
      if (!journey || !['active', 'interrupted'].includes(journey.outcome)) return;
      journey.outcome = outcome;
      journey.endedAt = new Date().toISOString();
      persist();
      if (outcome !== 'interrupted') {
        sessionStorage.removeItem(SESSION_KEY);
        journey = null;
      }
      if (outcome !== 'interrupted') {
        chain.then(scheduleFlush).catch(() => diagnose('uploadFailures'));
      }
    };
    const mark = (key) => {
      if (!journey || journey.milestones[key] || journey.outcome !== 'active') return;
      journey.milestones[key] = new Date().toISOString();
      journey.elapsedMs[key] = elapsed();
      persist();
    };
    const restore = sessionStorage.getItem(SESSION_KEY);
    if (restore) {
      const saved = JSON.parse(restore);
      if (validSnapshot(saved.snapshot) && saved.snapshot.eventId === eventId
        && ['active', 'interrupted'].includes(saved.snapshot.outcome)) {
        journey = saved.snapshot;
        base = duration(saved.currentElapsed) && saved.currentElapsed !== null
          ? saved.currentElapsed : 0;
        journey.timingQuality = Date.now() < Date.parse(journey.updatedAt)
          ? 'clock_anomaly' : 'resumed';
        journey.outcome = 'active';
        journey.endedAt = null;
        persist();
      }
    }
    const graphExit = safe(() => {
      if (!journey) return;
      const time = elapsed();
      if (graphStart !== null && time !== null) {
        journey.graph.interstitialMs = (journey.graph.interstitialMs || 0) + time - graphStart;
      }
      graphStart = null;
      hiddenStart = null;
      tripStart = null;
      if (journey.graph.status === 'not_observed') journey.graph.status = 'skipped';
      persist();
    });
    document.addEventListener('visibilitychange', safe(() => {
      if (!journey || graphStart === null) return;
      const time = elapsed();
      if (document.hidden && hiddenStart === null) {
        hiddenStart = time;
      } else if (!document.hidden && hiddenStart !== null && time !== null) {
        journey.graph.hiddenMs = (journey.graph.hiddenMs || 0) + time - hiddenStart;
        if (tripStart !== null) {
          journey.graph.returnMs = (journey.graph.returnMs || 0) + time - tripStart;
          journey.graph.returnCount += 1;
          journey.graph.status = 'observed';
        }
        hiddenStart = null;
        tripStart = null;
        persist();
      }
    }));
    window.addEventListener('pagehide', safe(() => {
      finishOutcome('interrupted');
      if (journey) base = elapsed() ?? base;
    }));
    window.addEventListener('pageshow', safe((event) => {
      if (event.persisted && journey?.outcome === 'interrupted') {
        anchor = performance.now();
        wallAnchor = Date.now();
        journey.timingQuality = 'resumed';
        journey.outcome = 'active';
        journey.endedAt = null;
        persist();
      }
    }));
    window.addEventListener('online', scheduleFlush);
    setInterval(scheduleFlush, 30000);
    setTimeout(scheduleFlush, 1500);
    return {
      selected: safe((demo = false) => {
        const config = configuration();
        if (!config) return;
        finishOutcome('reset');
        anchor = performance.now();
        wallAnchor = Date.now();
        base = 0;
        graphStart = null;
        journey = {
          schemaVersion: 1,
          eventId,
          stationId: config.stationId,
          journeyId: crypto.randomUUID(),
          revision: 0,
          selectedBrand: null,
          isTest: config.isTest || isDemo || demo === true,
          outcome: 'active',
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          endedAt: null,
          milestones: {
            portraitSelected: new Date().toISOString(),
            finishClicked: null,
            postcardUsable: null,
          },
          elapsedMs: { portraitSelected: 0, finishClicked: null, postcardUsable: null },
          graph: {
            interstitialCount: 0, interstitialMs: null, hiddenMs: null, returnCount: 0, returnMs: null, status: 'not_observed',
          },
          timingQuality: 'monotonic',
        };
        persist();
      }),
      finish: safe(() => mark('finishClicked')),
      brand: safe((brand) => {
        if (journey && TELEMETRY_BRANDS.includes(brand) && journey.selectedBrand !== brand) {
          journey.selectedBrand = brand;
          persist();
        }
      }),
      usable: safe(() => {
        if (!journey?.milestones.finishClicked) return;
        mark('postcardUsable');
        finishOutcome('completed');
      }),
      reset: safe(() => finishOutcome('reset')),
      graphEnter: safe(() => {
        if (!journey || graphStart !== null) return;
        graphStart = elapsed();
        journey.graph.interstitialCount += 1;
        persist();
      }),
      graphOpen: safe(() => {
        if (journey && graphStart !== null) tripStart = elapsed();
      }),
      graphExit,
    };
  } catch {
    diagnose('persistenceFailures');
    return noop;
  }
}
