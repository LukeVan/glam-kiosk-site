import { blobURL } from '../../scripts/kiosk-settings.js';

const STATUSES = ['pending', 'running', 'partial', 'ready', 'failed'];
const ASSET_STATUSES = ['pending', 'ready', 'failed', 'unavailable'];
export const BANNER_BRANDS = [
  '1-larocheposay', '2-lorealprofessionnel', '3-YSLbeauty', '4-lorealparis',
];

export function bannerPrefix(portraitId, settings, brand) {
  if (!/^azure_[a-f0-9]{64}$/.test(portraitId) || !BANNER_BRANDS.includes(brand)) {
    throw new Error('Invalid banner portrait or brand identity.');
  }
  const root = `${settings.eventId}/8-Banner-Output/${portraitId}/`;
  return brand === '4-lorealparis' ? root : `${root}${brand}/`;
}

export function validateBannerManifest(data, portraitId, settings, brand = '4-lorealparis') {
  const prefix = bannerPrefix(portraitId, settings, brand);
  if (!data || data.schemaVersion !== 1 || data.portraitId !== portraitId
    || data.brand !== brand || !STATUSES.includes(data.status)
    || !Array.isArray(data.assets) || data.assets.length > 100) {
    throw new Error('Invalid or mismatched banner manifest.');
  }
  const ids = new Set();
  const assets = data.assets.map((asset) => {
    if (!asset || typeof asset.id !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(asset.id)
      || ids.has(asset.id) || typeof asset.label !== 'string'
      || !asset.label || asset.label.length > 120 || !ASSET_STATUSES.includes(asset.status)
      || ![null, 'application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(asset.mimeType)) {
      throw new Error('Invalid banner asset.');
    }
    ids.add(asset.id);
    let url = null;
    if (asset.status === 'ready') {
      if (!asset.mimeType || typeof asset.blob !== 'string' || !asset.blob.startsWith(prefix)
        || /[\\?#%]/.test(asset.blob)) throw new Error('Invalid banner asset path.');
      if (brand === '4-lorealparis' && BANNER_BRANDS.some((item) => (
        asset.blob.slice(prefix.length).startsWith(`${item}/`)
      ))) throw new Error('Banner asset belongs to another brand.');
      const extension = {
        'application/pdf': /\.pdf$/i,
        'image/png': /\.png$/i,
        'image/jpeg': /\.jpe?g$/i,
        'image/webp': /\.webp$/i,
      }[asset.mimeType];
      if (!extension.test(asset.blob)) throw new Error('Banner asset type does not match its path.');
      url = blobURL(settings.containerSAS, asset.blob);
    } else if (asset.blob != null) throw new Error('Unready banner asset has a blob path.');
    return {
      id: asset.id, label: asset.label, status: asset.status, mimeType: asset.mimeType, url,
    };
  });
  if (data.status === 'ready' && !assets.some((asset) => asset.status === 'ready')) {
    throw new Error('Ready banner manifest has no output.');
  }
  return { status: data.status, assets };
}

export async function readBannerManifest(portraitId, settings, signal, fetcher = fetch, brand = '4-lorealparis') {
  const prefix = bannerPrefix(portraitId, settings, brand);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = setTimeout(abort, 15000);
  try {
    const url = blobURL(
      settings.containerSAS,
      `${prefix}manifest.json`,
    );
    const response = await fetcher(url, {
      signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error',
    });
    if (response.status === 404) return { status: 'unavailable', assets: [] };
    if (!response.ok) throw new Error(`Banner results unavailable (HTTP ${response.status}).`);
    return validateBannerManifest(await response.json(), portraitId, settings, brand);
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) throw new Error('Banner results request timed out.');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
