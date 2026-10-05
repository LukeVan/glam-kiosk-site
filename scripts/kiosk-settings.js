export const SETTINGS_KEY = 'glam-kiosk-booth-v1';
export const SYSTEM_PREFIXES = new Set([
  'assets', 'portraits', 'print', 'thumbnails', 'logs', 'dgr-production',
  'print-templates', 'product-crop-temp',
]);

export function parseContainerSAS(value, now = Date.now(), access = 'read') {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Paste a complete Azure Blob container SAS URL.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash
    || url.hostname !== 'ffservices24.blob.core.windows.net'
    || url.port || !/^\/[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(url.pathname)
    || url.pathname.includes('--')) {
    throw new Error('Use an HTTPS ffservices24 Azure Blob container URL, not a blob or account URL.');
  }
  const params = url.searchParams;
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length
    || keys.some((key) => ![
      'sv', 'st', 'se', 'sr', 'sp', 'sig', 'spr', 'sip',
      'skoid', 'sktid', 'skt', 'ske', 'sks', 'skv', 'saoid', 'suoid', 'scid',
    ].includes(key))) {
    throw new Error('The SAS contains duplicate or unsupported parameters.');
  }
  const permissions = access === 'create' ? ['c'] : ['rl', 'lr'];
  if (params.get('sr') !== 'c' || !permissions.includes(params.get('sp'))
    || !params.get('sig') || !params.get('sv')
    || (params.has('spr') && params.get('spr') !== 'https')) {
    throw new Error(access === 'create'
      ? 'Request access must be a container SAS with create only.'
      : 'Kiosk access must be a container SAS with read + list only.');
  }
  if (access === 'create' && url.pathname !== '/glam-kiosk-requests') {
    throw new Error('Request access must use the dedicated glam-kiosk-requests container.');
  }
  const expiresAt = Date.parse(params.get('se'));
  if (!Number.isFinite(expiresAt)) throw new Error('The SAS must have an explicit expiry.');
  if (expiresAt <= now) throw new Error('Kiosk access has expired. Generate a new SAS in Glam Creator.');
  if (params.has('st')) {
    const startsAt = Date.parse(params.get('st'));
    if (!Number.isFinite(startsAt)) throw new Error('The SAS start time is invalid.');
    if (startsAt > now) throw new Error('Kiosk access is not active yet. Check its start time.');
  }
  return { url, expiresAt: new Date(expiresAt).toISOString() };
}

export function validateSettings(value) {
  if (!value || value.version !== 1 || typeof value.containerSAS !== 'string'
    || typeof value.eventId !== 'string' || !value.eventId
    || value.eventId.length > 256 || /[/\\]/.test(value.eventId)
    || [...value.eventId].some((character) => character.charCodeAt(0) < 32)
    || SYSTEM_PREFIXES.has(value.eventId)
    || value.activationProfile !== 'max'
    || !['none', 'marketo'].includes(value.formType)
    || (value.printScope !== undefined && !['selected', 'all'].includes(value.printScope))
    || (value.showFinalQR !== undefined && typeof value.showFinalQR !== 'boolean')
    || (value.requestSAS !== undefined && typeof value.requestSAS !== 'string')) {
    throw new Error('Saved booth settings are invalid. Clear them and configure this kiosk again.');
  }
  const { expiresAt } = parseContainerSAS(value.containerSAS);
  if (value.requestSAS) parseContainerSAS(value.requestSAS, Date.now(), 'create');
  return {
    version: 1,
    containerSAS: value.containerSAS,
    eventId: value.eventId,
    activationProfile: 'max',
    formType: value.formType,
    introMode: value.formType === 'none' ? 'normal' : 'registration-form',
    requestSAS: value.requestSAS || '',
    printScope: value.printScope || 'selected',
    showFinalQR: value.showFinalQR ?? value.adEnding !== 'print',
    expiresAt,
  };
}

export function loadSettings(storage) {
  const raw = storage.getItem(SETTINGS_KEY);
  if (!raw) return null;
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Saved booth settings cannot be read. Clear them and configure this kiosk again.');
  }
  return validateSettings(value);
}

export function saveSettings(storage, value) {
  const validated = validateSettings(value);
  storage.setItem(SETTINGS_KEY, JSON.stringify(validated));
  return validated;
}

export function clearSettings(storage) {
  storage.removeItem(SETTINGS_KEY);
}

export async function listBlobs(containerSAS, {
  fetcher = fetch, signal, prefix,
  parseXML = (xml) => new DOMParser().parseFromString(xml, 'application/xml'),
} = {}) {
  const { url } = parseContainerSAS(containerSAS);
  const blobs = [];
  const markers = new Set();
  let marker = '';
  let pages = 0;
  do {
    pages += 1;
    if (pages > 1000) throw new Error('Container listing is too large. Ask booth staff to review its contents.');
    const requestURL = new URL(url);
    requestURL.searchParams.set('restype', 'container');
    requestURL.searchParams.set('comp', 'list');
    requestURL.searchParams.set('maxresults', '5000');
    if (prefix) requestURL.searchParams.set('prefix', prefix);
    if (marker) requestURL.searchParams.set('marker', marker);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timeout = setTimeout(abort, 15000);
    let response;
    let xml;
    try {
      // Each Azure page depends on the previous response's continuation marker.
      // eslint-disable-next-line no-await-in-loop
      response = await fetcher(requestURL.href, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        headers: { 'x-ms-version': '2023-11-03' },
        signal: controller.signal,
      });
      if (response.ok) {
        // eslint-disable-next-line no-await-in-loop
        xml = await response.text();
      }
    } catch {
      if (signal?.aborted) throw new Error('Connection test cancelled.');
      if (controller.signal.aborted) throw new Error('Azure connection timed out. Try again.');
      throw new Error('Cannot reach Azure Blob. Check the network and allowed CORS origin.');
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
    if (!response.ok) {
      if (response.status === 403) throw new Error('Azure denied access. Check SAS expiry, permissions, and storage policy.');
      throw new Error(`Azure connection failed (HTTP ${response.status}).`);
    }
    const doc = parseXML(xml);
    if (doc.querySelector('parsererror') || doc.documentElement.tagName !== 'EnumerationResults'
      || !doc.querySelector('Blobs') || !doc.querySelector('NextMarker')) {
      throw new Error('Azure returned an invalid container listing.');
    }
    doc.querySelectorAll('Blobs > Blob').forEach((blob) => {
      const name = blob.querySelector('Name')?.textContent;
      if (!name || (prefix && !name.startsWith(prefix))) {
        throw new Error('Azure returned a blob outside the requested scope.');
      }
      blobs.push({
        name,
        lastModified: blob.querySelector('Properties > Last-Modified')?.textContent,
      });
    });
    marker = doc.querySelector('NextMarker').textContent;
    if (marker && markers.has(marker)) throw new Error('Azure returned a repeated continuation marker.');
    if (marker) markers.add(marker);
  } while (marker);
  return blobs;
}

export async function listEvents(containerSAS, options) {
  const blobs = await listBlobs(containerSAS, options);
  const events = new Set();
  blobs.forEach(({ name }) => {
    if (!name.includes('/')) return;
    const prefix = name.split('/')[0];
    if (prefix && !SYSTEM_PREFIXES.has(prefix)) events.add(prefix);
  });
  return [...events].sort((a, b) => a.localeCompare(b));
}

export function blobURL(containerSAS, name) {
  const { url } = parseContainerSAS(containerSAS);
  if (typeof name !== 'string' || !name || name.split('/').some((part) => (
    !part || ['.', '..'].includes(part)
  ))) throw new Error('Invalid Azure blob path.');
  url.pathname = `${url.pathname}/${name.split('/').map(encodeURIComponent).join('/')}`;
  return url.href;
}
