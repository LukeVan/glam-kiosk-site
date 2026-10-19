import { blobURL } from '../../scripts/kiosk-settings.js';
import { BANNER_BRANDS } from './banner-assets.js';

export const DEMO_CATALOG = 'assets/permanent-demos/catalog.json';
const SET_ID = /^[a-z0-9][a-z0-9_-]{0,119}$/;
const VERSION = /^[a-f0-9]{32}$/;
const MIME_EXTENSIONS = {
  'image/jpeg': /\.(jpg|jpeg)$/i,
  'image/png': /\.png$/i,
  'image/webp': /\.webp$/i,
};

function validateCatalog(data, settings, offline = false) {
  const invalid = () => { throw new Error('The permanent demo catalog is invalid. Ask booth staff to republish it.'); };
  if (!data || data.schemaVersion !== 1 || typeof data.revision !== 'string'
    || !VERSION.test(data.revision) || !data.experienceTemplateSets
    || typeof data.experienceTemplateSets !== 'object' || Array.isArray(data.experienceTemplateSets)
    || !Array.isArray(data.people) || data.people.length > 100
    || !['main', 'max'].every((key) => (
      typeof data.experienceTemplateSets[key] === 'string'
      && SET_ID.test(data.experienceTemplateSets[key])
    ))) invalid();
  const templateSetId = data.experienceTemplateSets[settings.activationProfile];
  if (!templateSetId) invalid();
  const ids = new Set();
  const people = data.people.map((person) => {
    if (!person || typeof person.id !== 'string' || !/^demo_[A-Za-z0-9_-]{1,115}$/.test(person.id)
      || ids.has(person.id) || typeof person.name !== 'string' || !person.name.trim()
      || person.name.length > 120 || typeof person.enabled !== 'boolean'
      || !Number.isSafeInteger(person.order) || person.order < 0
      || !person.profiles || Array.isArray(person.profiles)
      || typeof person.profiles !== 'object') invalid();
    ids.add(person.id);
    const profiles = new Map(Object.entries(person.profiles).map(([setId, profile]) => {
      if (!SET_ID.test(setId) || !profile || profile.demo !== true
        || typeof profile.version !== 'string' || !VERSION.test(profile.version)
        || typeof profile.templateFingerprint !== 'string'
        || !/^[a-f0-9]{64}$/.test(profile.templateFingerprint)) invalid();
      const namespace = offline ? 'offline-demos' : 'permanent-demos';
      const prefix = `assets/${namespace}/${person.id}/${setId}/${profile.version}/`;
      function asset(value, role, pngOnly = false) {
        if (!value || typeof value.blob !== 'string'
          || !value.blob.startsWith(prefix) || value.blob.length > 1024
          || !value.blob.slice(prefix.length).split('/').every((segment) => (
            /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(segment)
            && !segment.includes('..')
          ))
          || !Object.hasOwn(MIME_EXTENSIONS, value.mimeType)
          || !MIME_EXTENSIONS[value.mimeType].test(value.blob)
          || (pngOnly && value.mimeType !== 'image/png')) invalid();
        const path = value.blob.slice(prefix.length);
        if (role.endsWith('/')) {
          if (!path.startsWith(role)
            || !/^page_[1-9]\d*\.(jpg|jpeg|png|webp)$/i.test(path.slice(role.length))) invalid();
        } else if (path.replace(/\.(jpg|jpeg|png|webp)$/i, '') !== role) invalid();
        return {
          url: offline ? `/${value.blob}` : blobURL(settings.containerSAS, value.blob),
          mimeType: value.mimeType,
        };
      }
      function brands(values, parse) {
        if (!values || Object.keys(values).length !== 4
          || !BANNER_BRANDS.every((brand) => Object.hasOwn(values, brand))) invalid();
        return Object.fromEntries(BANNER_BRANDS.map((brand) => (
          [brand, parse(values[brand], brand)]
        )));
      }
      return [setId, {
        version: profile.version,
        portrait: asset(profile.portrait, 'portrait'),
        ads: brands(profile.ads, (value, brand) => asset(value, `ads/${brand}`)),
        cutouts: brands(profile.cutouts, (value, brand) => asset(value, `cutouts/${brand}`, true)),
        printPreviews: brands(profile.printPreviews, (value, brand) => (
          asset(value, `print-previews/${brand}`)
        )),
        variations: brands(profile.variations, (values, brand) => {
          if (!Array.isArray(values) || values.length > 100) invalid();
          const paths = new Set();
          return values.map((value, index) => {
            const result = asset(value, `variations/${brand}/`);
            if (typeof value.label !== 'string' || !value.label.trim()
              || value.label.length > 120 || paths.has(value.blob)) invalid();
            paths.add(value.blob);
            return {
              ...result, id: `demo_variation_${index + 1}`, label: value.label, status: 'ready',
            };
          });
        }),
      }];
    }));
    return {
      id: person.id,
      label: person.name,
      order: person.order,
      enabled: person.enabled,
      profile: profiles.get(templateSetId),
    };
  }).filter((person) => person.enabled && person.profile)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return { revision: data.revision, templateSetId, people };
}

export function validateDemoCatalog(data, settings) {
  return validateCatalog(data, settings);
}

export function validateOfflineDemoCatalog(data) {
  return validateCatalog(data, { activationProfile: 'max' }, true);
}

async function readCatalog(settings, signal, fetcher, offline = false) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = setTimeout(abort, 15000);
  try {
    const url = offline ? '/assets/offline-demos/catalog.json'
      : blobURL(settings.containerSAS, DEMO_CATALOG);
    const response = await fetcher(url, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    if (response.status === 404 && !offline) return null;
    if (!response.ok) throw new Error(`Permanent demo catalog unavailable (HTTP ${response.status}).`);
    const text = await response.text();
    if (text.length > 2000000) throw new Error('The permanent demo catalog is too large.');
    return offline ? validateOfflineDemoCatalog(JSON.parse(text))
      : validateDemoCatalog(JSON.parse(text), settings);
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) {
      throw new Error('Permanent demo catalog request timed out. Try again.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export function readDemoCatalog(settings, signal, fetcher = fetch) {
  return readCatalog(settings, signal, fetcher);
}

export function readOfflineDemoCatalog(signal, fetcher = fetch) {
  return readCatalog(null, signal, fetcher, true);
}
