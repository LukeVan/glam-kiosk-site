import { blobURL, parseContainerSAS } from '../../scripts/kiosk-settings.js';

export const PRINT_BRANDS = ['larocheposay', 'lorealprofessionnel', 'yslbeauty', 'lorealparis'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RENDER_STATUSES = ['pending', 'running', 'rendering', 'ready', 'partial', 'failed', 'error'];
const PRINT_STATUSES = ['pending', 'partial', 'submitted', 'failed'];

export function validRequest(request) {
  return request?.schemaVersion === 1 && UUID.test(request.requestId)
    && /^azure_[0-9a-f]{64}$/.test(request.portraitId)
    && typeof request.eventPrefix === 'string' && request.eventPrefix.length > 0
    && request.eventPrefix.length <= 256 && !/[/\\]/.test(request.eventPrefix)
    && ![...request.eventPrefix].some((character) => character.charCodeAt(0) < 32)
    && !['.', '..'].includes(request.eventPrefix)
    && typeof request.attendeeName === 'string' && request.attendeeName.trim().length > 0
    && request.attendeeName.length <= 80
    && PRINT_BRANDS.includes(request.selectedBrand)
    && ['selected', 'all'].includes(request.printScope)
    && typeof request.showFinalQR === 'boolean' && ['en', 'fr'].includes(request.lang)
    && Number.isFinite(Date.parse(request.createdAt));
}

export function createPrintRequest(state, settings) {
  const selectedBrand = PRINT_BRANDS[Number(state.selectedAdId?.slice(-1)) - 1];
  const request = {
    schemaVersion: 1,
    requestId: crypto.randomUUID(),
    eventPrefix: settings.eventId,
    portraitId: state.portraitId,
    attendeeName: state.name,
    selectedBrand,
    printScope: settings.printScope,
    showFinalQR: settings.showFinalQR,
    lang: state.language,
    createdAt: new Date().toISOString(),
  };
  if (!validRequest(request)
    || state.selectedAdId !== `${state.portraitId}_${PRINT_BRANDS.indexOf(selectedBrand) + 1}`) {
    throw new Error('Cannot submit an invalid portrait or ad selection.');
  }
  return request;
}

async function fetchAzure(url, options, fetcher, signal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = setTimeout(abort, 15000);
  try {
    return await fetcher(url, {
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      ...options,
      signal: controller.signal,
    });
  } catch {
    throw new Error(controller.signal.aborted
      ? 'Azure request cancelled or timed out. Retry with the same request.'
      : 'Cannot reach Azure. Check the connection and CORS configuration.');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export async function submitPrintRequest(request, settings, signal, fetcher = fetch) {
  if (!validRequest(request) || request.eventPrefix !== settings.eventId) {
    throw new Error('Print request does not match this event.');
  }
  if (!settings.requestSAS) throw new Error('Print request access is not configured. Ask booth staff.');
  const { url } = parseContainerSAS(settings.requestSAS, Date.now(), 'create');
  url.pathname += `/${[request.eventPrefix, 'requests', `${request.requestId}.json`].map(encodeURIComponent).join('/')}`;
  const response = await fetchAzure(url.href, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'x-ms-blob-type': 'BlockBlob',
      'x-ms-version': '2023-11-03',
      'If-None-Match': '*',
    },
    body: JSON.stringify(request),
  }, fetcher, signal);
  // An existing immutable ID is not proof of matching contents. Status must bind it.
  if (![201, 409, 412].includes(response.status)) {
    throw new Error(`Azure did not accept the print request (HTTP ${response.status}).`);
  }
}

export function validatePrintStatus(data, request) {
  if (data?.schemaVersion !== 1 || data.requestId !== request.requestId
    || data.portraitId !== request.portraitId || data.eventPrefix !== request.eventPrefix
    || data.selectedBrand !== request.selectedBrand
    || !RENDER_STATUSES.includes(data.render?.status)
    || !PRINT_STATUSES.includes(data.fulfillment?.status)
    || data.fulfillment.scope !== request.printScope
    || !data.request || Object.keys(request).some((key) => data.request[key] !== request[key])) {
    throw new Error('Print status is invalid or belongs to another request.');
  }
  const brands = request.printScope === 'all' ? PRINT_BRANDS : [request.selectedBrand];
  PRINT_BRANDS.forEach((brand) => {
    const item = data.render.brands?.[brand];
    if (item?.status === 'ready'
      && item.blob !== `${request.eventPrefix}/7-Share-Output/${request.requestId}/${brand}.jpg`) {
      throw new Error('The personalized template belongs to another request.');
    }
  });
  if (data.render.status === 'ready' && PRINT_BRANDS.some((brand) => (
    data.render.brands?.[brand]?.status !== 'ready'
    || data.render.brands[brand].blob !== `${request.eventPrefix}/7-Share-Output/${request.requestId}/${brand}.jpg`
  ))) throw new Error('Print status is missing completed templates.');
  if (data.fulfillment.status === 'submitted' && brands.some((brand) => (
    data.fulfillment.brands?.[brand]?.status !== 'submitted'
    || data.fulfillment.brands[brand].blob !== `${request.eventPrefix}/6-Print-Output/${request.requestId}__${brand}_print.jpg`
  ))) throw new Error('Print status is missing fulfillment files.');
  if (data.render.status === 'ready' && !data.share?.downloadPageUrl) {
    throw new Error('Completed templates are missing their attendee share link.');
  }
  if (data.share?.downloadPageUrl) {
    const download = new URL(data.share.downloadPageUrl);
    const session = new URL(download.searchParams.get('session'));
    if (download.protocol !== 'https:' || download.pathname !== '/download'
      || download.username || download.password || download.port || download.hash
      || !['main--glam-kiosk-site--lukevan.aem.live', 'kiosk-preview--glam-kiosk-site--lukevan.aem.page'].includes(download.hostname)
      || session.protocol !== 'https:' || session.hostname !== 'ffservices24.blob.core.windows.net'
      || session.username || session.password || session.port || session.hash
      || !session.pathname.endsWith(`/${encodeURIComponent(request.eventPrefix)}/7-Share-Output/${request.requestId}/session.json`)
      || session.searchParams.get('sr') !== 'b' || session.searchParams.get('sp') !== 'r'
      || !session.searchParams.get('sig') || !Number.isFinite(Date.parse(data.share.expiresAt))
      || Date.parse(session.searchParams.get('se')) !== Date.parse(data.share.expiresAt)
      || Date.parse(data.share.expiresAt) <= Date.now()
      || data.share.qrBlob !== `${request.eventPrefix}/7-Share-Output/${request.requestId}/qr.png`) {
      throw new Error('The attendee share link is invalid or expired.');
    }
  }
  return data;
}

export async function readPrintStatus(request, settings, signal, fetcher = fetch) {
  const url = blobURL(settings.containerSAS, `${request.eventPrefix}/requests-status/${request.requestId}.json`);
  const response = await fetchAzure(url, {
    method: 'GET', headers: { 'x-ms-version': '2023-11-03' },
  }, fetcher, signal);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Cannot read print status (HTTP ${response.status}).`);
  let data;
  try { data = await response.json(); } catch { throw new Error('Print status is not valid JSON.'); }
  return validatePrintStatus(data, request);
}
