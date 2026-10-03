export const COWORKER_ORIGIN = 'https://meow-max2026-lor-coworker-demo-a2137.entapp.adproto.com';

export function httpsURL(value) {
  if (typeof value !== 'string') throw new Error('A secure URL is required.');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Only HTTPS URLs without embedded credentials are supported.');
  }
  return url;
}

function integration(value, expectedOrigin) {
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') {
    throw new Error('Integration enable flags must be booleans.');
  }
  if (!value.enabled || !value.url) return { enabled: false };
  const url = httpsURL(value.url);
  if (expectedOrigin && url.origin !== expectedOrigin) {
    throw new Error('Coworker URL does not match its approved origin.');
  }
  return { enabled: true, url: url.href, origin: url.origin };
}

function coworkerIntegration(value, pageOrigin) {
  if (value.packaged !== undefined && typeof value.packaged !== 'boolean') {
    throw new Error('Coworker packaged flag must be a boolean.');
  }
  if (!value.packaged) return integration(value, COWORKER_ORIGIN);
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') {
    throw new Error('Integration enable flags must be booleans.');
  }
  if (!value.enabled) return { enabled: false };
  const origin = new URL(pageOrigin);
  if (origin.protocol !== 'https:'
    && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname))) {
    throw new Error('Packaged Coworker requires HTTPS or a local developer origin.');
  }
  return {
    enabled: true,
    packaged: true,
    origin: origin.origin,
    url: new URL('/coworker/index.html#/loreal/home', origin).href,
  };
}

export function readConfig(authoredMode, runtime = {}, pageOrigin = (
  typeof window === 'undefined' ? undefined : window.location.origin
)) {
  const mode = runtime.mode ?? authoredMode ?? 'live';
  if (!['demo', 'live'].includes(mode)) throw new Error('Mode must be demo or live.');
  const apiBase = runtime.apiBase || '';
  if (apiBase && (!/^\/api\/[a-z0-9/_-]+$/i.test(apiBase) || apiBase.endsWith('/'))) {
    throw new Error('API base must be a same-origin /api/ path without a trailing slash.');
  }
  const mediaOrigins = runtime.mediaOrigins || [];
  if (!Array.isArray(mediaOrigins) || mediaOrigins.some((origin) => (
    httpsURL(origin).origin !== origin
  ))) throw new Error('Media origins must be exact HTTPS origins.');
  const pacingMs = runtime.pacingMs ?? 2000;
  if (!Number.isInteger(pacingMs) || pacingMs < 0 || pacingMs > 10000) {
    throw new Error('Pacing must be between 0 and 10000 milliseconds.');
  }
  if (runtime.intake?.enabled !== undefined && typeof runtime.intake.enabled !== 'boolean') {
    throw new Error('Intake enable flag must be a boolean.');
  }
  if (runtime.coworker?.allowInDemo !== undefined
    && typeof runtime.coworker.allowInDemo !== 'boolean') {
    throw new Error('Coworker demo opt-in must be a boolean.');
  }
  const legal = runtime.legal || {};
  if (mode === 'live' && (!legal.en || !legal.fr
    || typeof legal.en !== 'string' || typeof legal.fr !== 'string')) {
    throw new Error('Live mode requires owner-approved English and French consent copy.');
  }
  return {
    mode,
    apiBase,
    mediaOrigins,
    pacingMs,
    legal,
    intakeEnabled: runtime.intake?.enabled === true,
    coworker: mode === 'demo' && !runtime.coworker?.allowInDemo
      ? { enabled: false } : coworkerIntegration(runtime.coworker || {}, pageOrigin),
    graph: mode === 'demo' ? { enabled: false } : integration(runtime.graph || {}),
  };
}
