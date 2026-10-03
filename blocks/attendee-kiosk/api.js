import { httpsURL } from './config.js';
import { ID_PATTERN } from './state.js';

const STATUSES = ['pending', 'partial', 'ready', 'failed'];
const ROOT = '/blocks/attendee-kiosk/assets/';
const PEOPLE = [
  { name: 'Person5', createdAt: '2026-10-02T18:02:00.000Z' },
  { name: 'Person3', createdAt: '2026-10-02T18:01:00.000Z' },
  { name: 'Person2', createdAt: '2026-10-02T18:00:00.000Z' },
];
const BRANDS = ['larocheposay', 'lorealprofessionnel', 'YSLbeauty', 'lorealparis'];

function identity(value) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new Error('Invalid asset identity.');
  return value;
}

function assetURL(value, config) {
  if (config.mode === 'demo' && typeof value === 'string'
    && /^\/blocks\/attendee-kiosk\/assets\/[a-zA-Z0-9_-]+\.jpg$/.test(value)) return value;
  const url = httpsURL(value);
  if (!config.mediaOrigins.includes(url.origin)) throw new Error('Asset origin is not authorized.');
  return url.href;
}

function unique(items) {
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    throw new Error('Duplicate asset identities.');
  }
  return items;
}

export function validatePortraits(data, config) {
  if (!data || !Array.isArray(data.portraits) || data.portraits.length > 100) {
    throw new Error('Invalid portrait response.');
  }
  return unique(data.portraits.map((item) => {
    if (!item || typeof item.label !== 'string' || !item.label || item.label.length > 120) {
      throw new Error('Invalid portrait label.');
    }
    const createdAt = Date.parse(item.createdAt);
    if (typeof item.createdAt !== 'string' || !Number.isFinite(createdAt)) {
      throw new Error('Portrait creation timestamp is missing or invalid.');
    }
    return {
      id: identity(item.id),
      label: item.label,
      thumbnailUrl: assetURL(item.thumbnailUrl, config),
      createdAt: new Date(createdAt).toISOString(),
    };
  }));
}

export function validateManifest(data, portraitId, config) {
  if (!data || data.portraitId !== portraitId || !STATUSES.includes(data.status)
    || !Array.isArray(data.ads) || data.ads.length > 4
    || !Array.isArray(data.banners) || data.banners.length > 20) {
    throw new Error('Invalid or mismatched portrait manifest.');
  }
  const assets = (items) => unique(items.map((item) => {
    if (!item || typeof item.label !== 'string' || !item.label || item.label.length > 120) {
      throw new Error('Invalid asset label.');
    }
    return { id: identity(item.id), url: assetURL(item.url, config), label: item.label };
  }));
  const ads = assets(data.ads);
  if (data.status === 'ready' && ads.length !== 4) {
    throw new Error('Ready manifest must contain four ads.');
  }
  return {
    portraitId, status: data.status, ads, banners: assets(data.banners),
  };
}

export function createAPI(config, fetcher = fetch) {
  async function request(path, signal, body) {
    if (!config.apiBase) throw new Error('Protected attendee API is not configured.');
    const requestController = new AbortController();
    const abort = () => requestController.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) requestController.abort();
    const timeout = setTimeout(abort, 15000);
    try {
      const response = await fetcher(`${config.apiBase}${path}`, {
        method: body ? 'PUT' : 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal: requestController.signal,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) throw new Error(`Attendee API unavailable (HTTP ${response.status}).`);
      return await response.json();
    } catch (error) {
      if (requestController.signal.aborted && !signal?.aborted) {
        throw new Error('Attendee API request timed out.');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  }
  return {
    async portraits(signal) {
      const data = config.mode === 'demo' ? {
        portraits: PEOPLE.map((person) => ({
          id: `demo_${person.name}`,
          label: `Demo ${person.name}`,
          thumbnailUrl: `${ROOT}${person.name}.jpg`,
          createdAt: person.createdAt,
        })),
      } : await request('/portraits', signal);
      return validatePortraits(data, config);
    },
    async manifest(portraitId, signal) {
      identity(portraitId);
      const person = portraitId.replace('demo_', '');
      if (config.mode === 'demo' && !PEOPLE.some((item) => item.name === person)) {
        throw new Error('Unknown demo portrait.');
      }
      const ads = BRANDS.map((brand, index) => ({
        id: `${portraitId}_${index + 1}`,
        label: ['La Roche-Posay', 'L’Oréal Professionnel', 'YSL Beauty', 'L’Oréal Paris'][index],
        url: `${ROOT}demo_${person}_${index + 1}-${brand}.jpg`,
      }));
      const data = config.mode === 'demo' ? {
        portraitId, status: 'ready', ads, banners: [],
      } : await request(`/portraits/${portraitId}/manifest`, signal);
      return validateManifest(data, portraitId, config);
    },
    async resume(state, signal) {
      identity(state.sessionId);
      identity(state.portraitId);
      if (config.mode === 'demo') return;
      const data = await request(`/sessions/${state.sessionId}`, signal, {
        portraitId: state.portraitId, name: state.name, consent: state.consent,
      });
      if (data?.sessionId !== state.sessionId || data.portraitId !== state.portraitId) {
        throw new Error('Session response does not match this attendee.');
      }
    },
    async select(state, signal) {
      identity(state.sessionId);
      identity(state.portraitId);
      identity(state.selectedAdId);
      if (config.mode === 'demo') return;
      const data = await request(`/sessions/${state.sessionId}/selection`, signal, {
        portraitId: state.portraitId, adId: state.selectedAdId,
      });
      if (data?.sessionId !== state.sessionId || data.portraitId !== state.portraitId
        || data.adId !== state.selectedAdId) throw new Error('Selection was not acknowledged.');
    },
  };
}
