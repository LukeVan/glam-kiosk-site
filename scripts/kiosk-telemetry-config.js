import { parseContainerSAS } from './kiosk-settings.js';

export const TELEMETRY_PREFS_KEY = 'glam-kiosk-telemetry-prefs-v1';
export const TELEMETRY_FIELDS = ['telemetryUploadContainerSasUrl', 'telemetryReadContainerSasUrl'];

export function telemetryCredentials(value) {
  const [upload, read] = TELEMETRY_FIELDS.map((key) => value?.[key]);
  if (!upload && !read) return { status: 'unconfigured' };
  try {
    const uploadURL = parseContainerSAS(upload, Date.now(), 'telemetry-create');
    const readURL = parseContainerSAS(read);
    if (uploadURL.url.pathname !== '/meow-glam-telemetry'
      || readURL.url.pathname !== '/meow-glam-telemetry'
      || uploadURL.url.searchParams.get('spr') !== 'https'
      || readURL.url.searchParams.get('spr') !== 'https'
      || uploadURL.expiresAt !== readURL.expiresAt
      || (value.expiresAt && uploadURL.expiresAt !== value.expiresAt)) {
      return { status: 'invalid', error: 'Telemetry requires matching HTTPS-only meow-glam-telemetry create and read/list access.' };
    }
    return { status: 'ready', upload, read };
  } catch {
    return { status: 'invalid', error: 'Telemetry access is missing, invalid, inactive, or expired. Update it in booth settings; attendee access is unaffected.' };
  }
}

export function validateTelemetryPreferences(value) {
  if (!value || !/^MAX-(?:0[1-9]|[1-9][0-9])$/.test(value.stationId)
    || typeof value.timeZone !== 'string' || typeof value.isTest !== 'boolean') {
    throw new Error('Choose a station ID and event timezone for telemetry.');
  }
  try { new Intl.DateTimeFormat('en', { timeZone: value.timeZone }).format(); } catch {
    throw new Error('Enter a valid IANA event timezone, such as America/Los_Angeles.');
  }
  return { stationId: value.stationId, timeZone: value.timeZone, isTest: value.isTest };
}

export function telemetryPreferences(storage) {
  const raw = storage.getItem(TELEMETRY_PREFS_KEY);
  return raw ? validateTelemetryPreferences(JSON.parse(raw)) : null;
}

export function telemetryURL(sas, blob = '') {
  const url = new URL(sas);
  if (blob) url.pathname += `/${blob.split('/').map(encodeURIComponent).join('/')}`;
  return url.href;
}

export async function telemetryFetch(url, options = {}, fetcher = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const { maxBytes = 8192, ...request } = options;
    const response = await fetcher(url, {
      ...request,
      signal: controller.signal,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    const reader = response.body?.getReader();
    const chunks = [];
    let size = 0;
    if (reader) {
      let done = false;
      while (!done) {
        // Keep the timeout active through body consumption, not just response headers.
        // eslint-disable-next-line no-await-in-loop
        const part = await reader.read();
        done = part.done;
        if (part.value) {
          size += part.value.length;
          if (size > maxBytes) { controller.abort(); throw new Error('telemetry_response_too_large'); }
          chunks.push(part.value);
        }
      }
    }
    return new Response([204, 205, 304].includes(response.status) ? null : new Blob(chunks), {
      status: response.status, headers: response.headers,
    });
  } finally { clearTimeout(timer); }
}
