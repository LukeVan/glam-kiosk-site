import { BANNER_BRANDS } from './banner-assets.js';

export const PUBLIC_DEMO_ORIGINS = [
  'https://kiosk-preview--glam-kiosk-site--lukevan.aem.page',
  'https://main--glam-kiosk-site--lukevan.aem.live',
];
export const PUBLIC_DEMO_INDEX = '/assets/permanent-demo-cutouts/index.json';

export function validatePublicDemo(value) {
  if (!value || !/^demo_[A-Za-z0-9_-]{1,115}$/.test(value.personId)
    || !/^[a-z0-9][a-z0-9_-]{0,119}$/.test(value.templateSetId)
    || !/^[a-f0-9]{32}$/.test(value.version)
    || !/^[a-f0-9]{64}$/.test(value.sha256)
    || !BANNER_BRANDS.includes(value.brand)) throw new Error('Invalid public demo provenance.');
  const path = `assets/permanent-demo-cutouts/${value.personId}/${value.templateSetId}/${value.version}/${value.brand}.png`;
  const url = new URL(value.url);
  if (!PUBLIC_DEMO_ORIGINS.includes(url.origin) || url.username || url.password
    || url.search || url.hash || value.url !== `${url.origin}/${path}`) {
    throw new Error('Invalid public demo cutout URL.');
  }
  return { ...value, url: url.href };
}

async function readIndex(origin, identity, signal, fetcher) {
  const localPreview = typeof window !== 'undefined'
    && ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const indexOrigin = localPreview ? window.location.origin : origin;
  const response = await fetcher(`${indexOrigin}${PUBLIC_DEMO_INDEX}`, {
    signal, credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Public demo index unavailable (HTTP ${response.status}).`);
  const text = await response.text();
  if (text.length > 2000000) throw new Error('Public demo index is too large.');
  const index = JSON.parse(text);
  if (index.schemaVersion !== 1 || !Array.isArray(index.cutouts) || index.cutouts.length > 10000) {
    throw new Error('Invalid public demo index.');
  }
  const entries = index.cutouts.filter((entry) => (
    entry.personId === identity.personId && entry.templateSetId === identity.templateSetId
    && entry.version === identity.version && entry.brand === identity.brand
  ));
  if (!entries.length) return null;
  if (entries.length !== 1) throw new Error('Duplicate public demo cutout.');
  const [entry] = entries;
  const value = validatePublicDemo({ ...entry, url: `${origin}/${entry.path}` });
  const expected = `assets/permanent-demo-cutouts/${identity.personId}/${identity.templateSetId}/${identity.version}/${identity.brand}.png`;
  if (entry.path !== expected) throw new Error('Public demo cutout path does not match catalog.');
  return value;
}

export async function readPublicDemo(origin, identity, signal, fetcher = fetch) {
  if (!origin) return null;
  if (!PUBLIC_DEMO_ORIGINS.includes(origin)) throw new Error('Invalid public demo origin.');
  const operation = new AbortController();
  const abort = () => operation.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = setTimeout(abort, 15000);
  try {
    return await readIndex(origin, identity, operation.signal, fetcher);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
