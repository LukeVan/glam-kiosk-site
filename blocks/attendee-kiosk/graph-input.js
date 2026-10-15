import { blobURL } from '../../scripts/kiosk-settings.js';

export const GRAPH_SOURCE_NODE = 'node_1791927487544_z177v9idx_35_qblmfu';
const ERRORS = [
  'cutout_missing', 'cutout_incomplete', 'cutout_invalid_metadata',
  'cutout_download_failed', 'cutout_invalid_image', 'cutout_upload_failed', 'cutout_signing_failed',
  'cutout_resolve_failed',
];
const SAS_KEYS = [
  'sv', 'st', 'se', 'sr', 'sp', 'sig', 'spr',
];

export function validateGraphInput(data, portraitId, settings, now = Date.now()) {
  if (!/^azure_[a-f0-9]{64}$/.test(portraitId) || !data || data.schemaVersion !== 1
    || data.portraitId !== portraitId || data.sourceNodeId !== GRAPH_SOURCE_NODE
    || !['ready', 'unavailable', 'failed'].includes(data.status)
    || ![null, ...ERRORS].includes(data.errorCode)) {
    throw new Error('Invalid Graph portrait manifest.');
  }
  if (data.status !== 'ready') {
    if (data.asset !== null) throw new Error('Unready Graph portrait contains an asset.');
    return { status: data.status, portraitId };
  }
  const blob = `${settings.eventId}/9-Graph-Input/${portraitId}/portrait.png`;
  const { asset } = data;
  if (!asset || asset.blob !== blob || asset.mimeType !== 'image/png'
    || data.errorCode !== null || typeof asset.url !== 'string'
    || typeof asset.expiresAt !== 'string'
    || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|\+00:00)$/.test(asset.expiresAt)) {
    throw new Error('Invalid Graph portrait asset.');
  }
  let url;
  try { url = new URL(asset.url); } catch {
    throw new Error('Invalid Graph portrait access URL.');
  }
  const expected = new URL(blobURL(settings.containerSAS, blob));
  const keys = [...url.searchParams.keys()];
  const expiry = Date.parse(asset.expiresAt);
  const start = url.searchParams.has('st') ? Date.parse(url.searchParams.get('st')) : now;
  if (url.protocol !== 'https:' || url.origin !== expected.origin
    || url.pathname !== expected.pathname || url.username || url.password || url.hash
    || new Set(keys).size !== keys.length || keys.some((key) => !SAS_KEYS.includes(key))
    || url.searchParams.get('sr') !== 'b' || url.searchParams.get('sp') !== 'r'
    || !url.searchParams.get('sig') || !url.searchParams.get('sv') || !url.searchParams.get('st')
    || url.searchParams.get('spr') !== 'https'
    || !Number.isFinite(expiry) || expiry !== Date.parse(url.searchParams.get('se'))
    || expiry <= now || expiry > now + 9 * 3600000
    || !Number.isFinite(start) || start > now) {
    throw new Error('Graph portrait requires unexpired image-only read access.');
  }
  return {
    status: 'ready', portraitId, url: url.href, expiresAt: new Date(expiry).toISOString(),
  };
}

export async function readGraphInput(portraitId, settings, signal, fetcher = fetch) {
  if (!/^azure_[a-f0-9]{64}$/.test(portraitId)) throw new Error('Invalid Graph portrait identity.');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = setTimeout(abort, 15000);
  try {
    const response = await fetcher(blobURL(
      settings.containerSAS,
      `${settings.eventId}/9-Graph-Input/${portraitId}/manifest.json`,
    ), {
      signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error',
    });
    if (response.status === 404) return { status: 'unavailable', portraitId };
    if (!response.ok) throw new Error(`Graph portrait unavailable (HTTP ${response.status}).`);
    return validateGraphInput(await response.json(), portraitId, settings);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
