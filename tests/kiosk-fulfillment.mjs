import assert from 'node:assert/strict';
import {
  createPrintRequest, submitPrintRequest, readPrintStatus, validatePrintStatus, PRINT_BRANDS,
} from '../blocks/attendee-kiosk/fulfillment.js';
import { validateSettings } from '../scripts/kiosk-settings.js';
import { initialState, validState } from '../blocks/attendee-kiosk/state.js';
import { completedPortraits, markCompleted } from '../blocks/attendee-kiosk/completed.js';
import { navigation } from '../blocks/attendee-kiosk/integrations.js';
import { sampleVariations } from '../blocks/attendee-kiosk/variations.js';
import { validateBannerManifest, readBannerManifest } from '../blocks/attendee-kiosk/banner-assets.js';
import { validateGraphInput, readGraphInput, GRAPH_SOURCE_NODE } from '../blocks/attendee-kiosk/graph-input.js';

const expiry = new Date(Date.now() + 86400000).toISOString();
const sas = (container, permissions) => `https://ffservices24.blob.core.windows.net/${container}?sv=2023-11-03&sr=c&sp=${permissions}&se=${encodeURIComponent(expiry)}&sig=mock`;
const settings = validateSettings({
  version: 1,
  containerSAS: sas('mock-assets', 'rl'),
  requestSAS: sas('glam-kiosk-requests', 'c'),
  eventId: 'mock-event',
  activationProfile: 'max',
  formType: 'none',
  printScope: 'selected',
  showFinalQR: true,
});
const portraitId = `azure_${'a'.repeat(64)}`;
const graphExpiry = new Date(Date.now() + 3600000).toISOString();
const graphBlob = `${settings.eventId}/9-Graph-Input/${portraitId}/portrait.png`;
const graphStart = new Date(Date.now() - 300000).toISOString();
const graphURL = `https://ffservices24.blob.core.windows.net/mock-assets/${graphBlob}?sv=2023-11-03&sr=b&sp=r&spr=https&st=${encodeURIComponent(graphStart)}&se=${encodeURIComponent(graphExpiry)}&sig=MOCK_ONLY`;
const graphManifest = {
  schemaVersion: 1, portraitId, sourceNodeId: GRAPH_SOURCE_NODE, status: 'ready',
  errorCode: null,
  asset: { blob: graphBlob, mimeType: 'image/png', url: graphURL, expiresAt: graphExpiry },
};
assert.equal(validateGraphInput(graphManifest, portraitId, settings).url, graphURL);
for (const url of [
  graphURL.replace('sr=b', 'sr=c'), graphURL.replace('sp=r', 'sp=rl'),
  graphURL.replace('spr=https', 'spr=http'), graphURL.replace('/portrait.png', '/other.png'),
  graphURL.replace('ffservices24', 'other'), `${graphURL}&sp=r`, `${graphURL}#secret`,
  `${graphURL}&unknown=1`, graphURL.replace('https:', 'http:'),
]) {
  assert.throws(() => validateGraphInput({
    ...graphManifest, asset: { ...graphManifest.asset, url },
  }, portraitId, settings));
}
assert.throws(() => validateGraphInput(graphManifest, portraitId, settings, Date.parse(graphExpiry)));
assert.throws(() => validateGraphInput(graphManifest, portraitId, settings,
  Date.parse(graphExpiry) - 8 * 24 * 3600000));
const sevenDayNow = Date.now();
const sevenDayExpiry = new Date(sevenDayNow + 7 * 24 * 3600000).toISOString();
const sevenDayURL = new URL(graphURL);
sevenDayURL.searchParams.set('se', sevenDayExpiry);
assert.equal(validateGraphInput({
  ...graphManifest,
  asset: { ...graphManifest.asset, url: sevenDayURL.href, expiresAt: sevenDayExpiry },
}, portraitId, settings, sevenDayNow).status, 'ready');
assert.throws(() => validateGraphInput({
  ...graphManifest,
  asset: { ...graphManifest.asset, url: sevenDayURL.href, expiresAt: sevenDayExpiry },
}, portraitId, settings, sevenDayNow - 1));
assert.throws(() => validateGraphInput({ ...graphManifest, sourceNodeId: 'other' }, portraitId, settings));
assert.throws(() => validateGraphInput(graphManifest, `azure_${'b'.repeat(64)}`, settings));
assert.equal(validateGraphInput({
  ...graphManifest, status: 'failed', asset: null, errorCode: 'cutout_signing_failed',
}, portraitId, settings).status, 'failed');
assert.equal(validateGraphInput({
  ...graphManifest, status: 'failed', asset: null, errorCode: 'cutout_resolve_failed',
}, portraitId, settings).status, 'failed');
assert.deepEqual(await readGraphInput(portraitId, settings, null,
  async () => ({ status: 404 })), { status: 'unavailable', portraitId });
await assert.rejects(readGraphInput(portraitId, settings, null,
  async () => ({ status: 403, ok: false })), /HTTP 403/);
const bannerManifest = {
  schemaVersion: 1, portraitId, brand: '4-lorealparis', status: 'ready',
  assets: [
    {
      id: 'banner_pdf', label: 'Banner PDF', status: 'ready', mimeType: 'application/pdf',
      blob: `${settings.eventId}/8-Banner-Output/${portraitId}/banner_output.pdf`,
    },
    {
      id: 'page_1', label: 'Page 1', status: 'ready', mimeType: 'image/png',
      blob: `${settings.eventId}/8-Banner-Output/${portraitId}/page_1.png`,
    },
  ],
};
assert.equal(validateBannerManifest(bannerManifest, portraitId, settings).assets.length, 2);
for (const status of ['pending', 'running', 'partial', 'failed']) {
  assert.equal(validateBannerManifest({ ...bannerManifest, status, assets: [] },
    portraitId, settings).status, status);
}
assert.throws(() => validateBannerManifest({ ...bannerManifest, portraitId: 'other' }, portraitId, settings));
assert.throws(() => validateBannerManifest({ ...bannerManifest, assets: [] }, portraitId, settings));
assert.throws(() => validateBannerManifest({
  ...bannerManifest, assets: [bannerManifest.assets[0], bannerManifest.assets[0]],
}, portraitId, settings));
for (const blob of ['other/page.png', `${settings.eventId}/8-Banner-Output/${portraitId}/../page.png`,
  `${settings.eventId}/8-Banner-Output/${portraitId}/page.png?secret`,
  `${settings.eventId}/8-Banner-Output/${portraitId}/page.pdf`]) {
  assert.throws(() => validateBannerManifest({
    ...bannerManifest, assets: [{ ...bannerManifest.assets[1], blob }],
  }, portraitId, settings));
}
assert.equal(validateBannerManifest({
  ...bannerManifest,
  assets: [bannerManifest.assets[0], {
    id: 'preview', label: 'Preview', status: 'unavailable', mimeType: null, blob: null,
  }],
}, portraitId, settings).assets[1].status, 'unavailable');
assert.deepEqual(await readBannerManifest(portraitId, settings, null,
  async () => ({ status: 404 })), { status: 'unavailable', assets: [] });
await assert.rejects(readBannerManifest(portraitId, settings, null,
  async () => ({ status: 403, ok: false })), /HTTP 403/);
const history = new Map();
const storage = {
  getItem: (key) => history.get(key) ?? null,
  setItem: (key, value) => history.set(key, value),
};
assert.deepEqual(completedPortraits(storage, 'event-one'), []);
markCompleted(storage, 'event-one', portraitId);
markCompleted(storage, 'event-one', portraitId);
assert.deepEqual(completedPortraits(storage, 'event-one'), [portraitId]);
assert.deepEqual(completedPortraits(storage, 'event-two'), []);
assert.deepEqual(completedPortraits({ getItem: () => null }, 'event-one'), []);
assert.throws(() => markCompleted(storage, 'event-one', 'demo_1'));
assert.throws(() => completedPortraits({ getItem: () => '{bad' }, 'event-one'));
assert.throws(() => completedPortraits({ getItem: () => '["invalid"]' }, 'event-one'));
assert.throws(() => markCompleted({
  getItem: () => null, setItem: () => { throw new Error('Storage unavailable'); },
}, 'event-one', portraitId), /Storage unavailable/);
assert.equal(settings.showCompletedPortraits, false);
assert.equal(validateSettings({ ...settings, showCompletedPortraits: true }).showCompletedPortraits, true);
assert.throws(() => validateSettings({ ...settings, showCompletedPortraits: 'true' }));
const source = {};
const integration = { enabled: true, origin: 'https://kiosk.example' };
const variationsEvent = {
  source, origin: integration.origin,
  data: { type: 'KIOSK_NAV', target: 'view-variations-max' },
};
assert.equal(navigation(variationsEvent, source, integration, 'continued'), 'variations');
assert.equal(navigation({
  ...variationsEvent, data: { type: 'KIOSK_NAV', target: 'view-processing-max' },
}, source, integration, 'continued'), 'variations');
assert.equal(navigation(variationsEvent, source, integration, 'story'), null);
assert.equal(navigation({ ...variationsEvent, source: {} }, source, integration, 'continued'), null);
assert.equal(navigation({ ...variationsEvent, origin: 'https://wrong.example' }, source, integration, 'continued'), null);
assert.equal(sampleVariations().length, 18);
assert.equal(new Set(sampleVariations().map((item) => item.id)).size, 18);
const state = {
  ...initialState(),
  stage: 'ads',
  consent: true,
  portraitId,
  name: 'Mock Attendee',
  sessionId: 'mock-session',
  selectedAdId: `${portraitId}_2`,
};
const request = createPrintRequest(state, settings);
assert.equal(request.selectedBrand, 'lorealprofessionnel');
assert(validState({ ...state, printRequest: request }));
assert(!validState({ ...state, name: 'Another attendee', printRequest: request }));
assert(!validState({ ...state, selectedAdId: `${portraitId}_1`, printRequest: request }));
assert.equal(validateSettings({ ...settings, requestSAS: '', printScope: undefined }).printScope, 'selected');
assert.throws(() => validateSettings({ ...settings, requestSAS: sas('mock-assets', 'c') }));
assert.throws(() => validateSettings({ ...settings, requestSAS: sas('glam-kiosk-requests', 'cw') }));
const writes = [];
for (const status of [201, 409, 412]) {
  // eslint-disable-next-line no-await-in-loop
  await submitPrintRequest(request, settings, undefined, async (url, options) => {
    writes.push({ url, options });
    return new Response('', { status });
  });
}
assert(writes.every(({ url, options }) => (
  new URL(url).pathname === `/glam-kiosk-requests/mock-event/requests/${request.requestId}.json`
  && options.headers['If-None-Match'] === '*'
  && options.headers['x-ms-blob-type'] === 'BlockBlob'
  && options.referrerPolicy === 'no-referrer'
  && options.body === JSON.stringify(request)
)));
await assert.rejects(submitPrintRequest(request, settings, undefined, async () => (
  new Response('', { status: 403 })
)), /HTTP 403/);
await assert.rejects(submitPrintRequest(request, settings, undefined, async () => {
  throw new Error('Credential must not leak');
}), (error) => !error.message.includes('Credential'));
assert.equal(await readPrintStatus(request, settings, undefined, async () => (
  new Response('', { status: 404 })
)), null);
const result = {
  schemaVersion: 1,
  requestId: request.requestId,
  portraitId,
  eventPrefix: request.eventPrefix,
  selectedBrand: request.selectedBrand,
  request,
  render: {
    status: 'ready',
    brands: Object.fromEntries(PRINT_BRANDS.map((brand) => [brand, {
      status: 'ready', blob: `mock-event/7-Share-Output/${request.requestId}/${brand}.jpg`,
    }])),
  },
  fulfillment: {
    scope: 'selected',
    status: 'submitted',
    brands: {
      lorealprofessionnel: {
        status: 'submitted',
        blob: `mock-event/6-Print-Output/${request.requestId}__lorealprofessionnel_print.jpg`,
      },
    },
  },
  share: {
    expiresAt: expiry,
    qrBlob: `mock-event/7-Share-Output/${request.requestId}/qr.png`,
    downloadPageUrl: `https://main--glam-kiosk-site--lukevan.aem.live/max-download.html?session=${encodeURIComponent(`https://ffservices24.blob.core.windows.net/mock-assets/mock-event/7-Share-Output/${request.requestId}/session.json?sr=b&sp=r&se=${encodeURIComponent(expiry)}&sig=mock`)}`,
  },
};
assert.equal(validatePrintStatus(result, request), result);
assert.equal(validatePrintStatus({
  ...result,
  share: {
    ...result.share,
    downloadPageUrl: result.share.downloadPageUrl.replace('/max-download.html?', '/download?'),
  },
}, request).render.status, 'ready');
assert.throws(() => validatePrintStatus({
  ...result,
  share: {
    ...result.share,
    downloadPageUrl: result.share.downloadPageUrl.replace('/max-download.html?', '/unrelated?'),
  },
}, request));
const pendingWithoutQR = {
  ...result,
  render: { status: 'rendering', brands: {} },
  fulfillment: { scope: 'selected', status: 'pending', brands: {} },
  share: { ...result.share, qrBlob: null },
};
assert.equal(validatePrintStatus(pendingWithoutQR, request), pendingWithoutQR);
assert.throws(() => validatePrintStatus({
  ...pendingWithoutQR, share: { ...result.share, qrBlob: 'another-request/qr.png' },
}, request));
assert.throws(() => validatePrintStatus({
  ...result, share: { ...result.share, qrBlob: null },
}, request));
for (const status of ['pending', 'rendering', 'partial', 'error', 'failed']) {
  assert.equal(validatePrintStatus({
    ...result,
    render: { ...result.render, status },
    fulfillment: { ...result.fulfillment, status: 'partial' },
  }, request).render.status, status);
}
assert.throws(() => validatePrintStatus({ ...result, request: { ...request, attendeeName: 'Other' } }, request));
assert.throws(() => validatePrintStatus({ ...result, portraitId: `azure_${'b'.repeat(64)}` }, request));
assert.throws(() => validatePrintStatus({ ...result, render: { status: 'ready', brands: {} } }, request));
assert.throws(() => validatePrintStatus({ ...result, share: undefined }, request));
assert.throws(() => validatePrintStatus({ ...result, fulfillment: { status: 'submitted', scope: 'selected', brands: {} } }, request));
const allRequest = { ...request, printScope: 'all' };
assert.throws(() => validatePrintStatus({
  ...result, request: allRequest, fulfillment: { ...result.fulfillment, scope: 'all' },
}, allRequest));
assert.equal(validatePrintStatus({
  ...result,
  request: allRequest,
  fulfillment: {
    scope: 'all',
    status: 'submitted',
    brands: Object.fromEntries(PRINT_BRANDS.map((brand) => [brand, {
      status: 'submitted',
      blob: `mock-event/6-Print-Output/${request.requestId}__${brand}_print.jpg`,
    }])),
  },
}, allRequest).fulfillment.scope, 'all');
const oldSettings = { ...settings };
delete oldSettings.printScope;
delete oldSettings.showFinalQR;
assert.equal(validateSettings({ ...oldSettings, adEnding: 'print' }).showFinalQR, false);
assert.equal(validateSettings({ ...oldSettings, adEnding: 'qr-print' }).showFinalQR, true);
assert.equal(validateSettings(oldSettings).showFinalQR, true);
console.log('Kiosk request/settings/state/status mock checks passed.');
