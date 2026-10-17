import assert from 'node:assert/strict';
import {
  createPrintRequest, submitPrintRequest, readPrintStatus, validatePrintStatus, PRINT_BRANDS,
  createPreparation, validPreparation, submitPreparation,
} from '../blocks/attendee-kiosk/fulfillment.js';
import { validateSettings } from '../scripts/kiosk-settings.js';
import { initialState, validState } from '../blocks/attendee-kiosk/state.js';
import { completedPortraits, markCompleted } from '../blocks/attendee-kiosk/completed.js';
import { navigation, storyBeat } from '../blocks/attendee-kiosk/integrations.js';
import { sampleVariations } from '../blocks/attendee-kiosk/variations.js';
import {
  validateBannerManifest, readBannerManifest, BANNER_BRANDS, bannerPrefix,
} from '../blocks/attendee-kiosk/banner-assets.js';
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
assert.deepEqual(validateGraphInput({
  ...graphManifest, status: 'failed', asset: null, errorCode: 'cutout_resolve_failed',
}, portraitId, settings), { status: 'failed', portraitId, errorCode: 'cutout_resolve_failed' });
assert.throws(() => validateGraphInput({
  ...graphManifest, sourceNodeId: 'other',
}, portraitId, settings), { graphInputCode: 'manifest_invalid' });
assert.throws(() => validateGraphInput({
  ...graphManifest,
  asset: { ...graphManifest.asset, expiresAt: new Date(Date.parse(graphExpiry) + 1000).toISOString() },
}, portraitId, settings), { graphInputCode: 'asset_expiry_mismatch' });
assert.throws(() => validateGraphInput(graphManifest, portraitId, settings, Date.parse(graphExpiry)),
  { graphInputCode: 'asset_expiry_invalid' });
assert.deepEqual(await readGraphInput(portraitId, settings, null,
  async () => ({ status: 404 })), { status: 'unavailable', portraitId, errorCode: 'manifest_missing' });
await assert.rejects(readGraphInput(portraitId, settings, null,
  async () => ({ status: 403, ok: false })), { graphInputCode: 'manifest_http_403' });
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
for (const brand of BANNER_BRANDS) {
  const prefix = bannerPrefix(portraitId, settings, brand);
  const branded = {
    ...bannerManifest, brand,
    assets: [{ ...bannerManifest.assets[1], blob: `${prefix}page_1.png` }],
  };
  assert.equal(validateBannerManifest(branded, portraitId, settings, brand).assets.length, 1);
  const otherBrand = BANNER_BRANDS.find((item) => item !== brand);
  assert.throws(() => validateBannerManifest(branded, portraitId, settings, otherBrand));
  assert.throws(() => validateBannerManifest({
    ...branded,
    assets: [{ ...branded.assets[0], blob: `${bannerPrefix(portraitId, settings, otherBrand)}page_1.png` }],
  }, portraitId, settings, brand));
  const reads = [];
  // eslint-disable-next-line no-await-in-loop
  assert.equal((await readBannerManifest(portraitId, settings, null, async (url) => {
    reads.push(new URL(url).pathname);
    return new Response(JSON.stringify(branded));
  }, brand)).status, 'ready');
  assert.deepEqual(reads, [`/mock-assets/${prefix}manifest.json`]);
  // eslint-disable-next-line no-await-in-loop
  assert.deepEqual(await readBannerManifest(portraitId, settings, null,
    async () => ({ status: 404 }), brand), { status: 'unavailable', assets: [] });
}
assert.throws(() => bannerPrefix(portraitId, settings, 'unknown'));
assert.equal(bannerPrefix(portraitId, settings, '3-YSLbeauty'),
  `mock-event/8-Banner-Output/${portraitId}/3-YSLbeauty/`);
assert.throws(() => bannerPrefix(portraitId, settings, '3-yslbeauty'));
const professionalPrefix = bannerPrefix(portraitId, settings, '2-lorealprofessionnel');
const professionalManifest = {
  ...bannerManifest,
  brand: '2-lorealprofessionnel',
  assets: [
    { ...bannerManifest.assets[0], blob: `${professionalPrefix}variations.pdf` },
    ...Array.from({ length: 23 }, (_, index) => ({
      id: `page_${index + 1}`, label: `Variation ${index + 1}`, status: 'ready',
      mimeType: 'image/png', blob: `${professionalPrefix}page_${index + 1}.png`,
    })),
  ],
};
const professionalAssets = validateBannerManifest(
  professionalManifest, portraitId, settings, '2-lorealprofessionnel',
).assets;
assert.equal(professionalAssets.length, 24);
assert.equal(professionalAssets.filter((asset) => asset.mimeType === 'image/png').length, 23);
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
const beatEvent = {
  source, origin: integration.origin,
  data: { type: 'KIOSK_STORY_BEAT', beat: 'overview' },
};
for (const beat of ['home', 'overview', 'brief', 'performance', 'creative']) {
  assert.equal(storyBeat({ ...beatEvent, data: { ...beatEvent.data, beat } }, source, integration, 'story'), beat);
  assert.equal(storyBeat({ ...beatEvent, data: { ...beatEvent.data, beat } }, source, integration, 'continued'), null);
}
for (const beat of ['simulate', 'results']) {
  const event = { ...beatEvent, data: { ...beatEvent.data, beat } };
  assert.equal(storyBeat(event, source, integration, 'continued'), beat);
  assert.equal(storyBeat(event, source, integration, 'story'), null);
  assert.equal(storyBeat({ ...event, source: {} }, source, integration, 'continued'), null);
  assert.equal(storyBeat({ ...event, origin: 'https://wrong.example' }, source, integration, 'continued'), null);
}
for (const stage of ['welcome', 'portraits', 'name', 'graph', 'ads', 'continued', 'variations', 'ending']) {
  assert.equal(storyBeat(beatEvent, source, integration, stage), null);
}
assert.equal(storyBeat({ ...beatEvent, source: {} }, source, integration, 'story'), null);
assert.equal(storyBeat({ ...beatEvent, origin: 'https://wrong.example' }, source, integration, 'story'), null);
assert.equal(storyBeat(beatEvent, source, { ...integration, enabled: false }, 'story'), null);
for (const data of [null, [], { type: 'KIOSK_STORY_BEAT', beat: 'unknown' }, { type: 'other', beat: 'overview' }]) {
  assert.equal(storyBeat({ ...beatEvent, data }, source, integration, 'story'), null);
}
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
const selectEvent = {
  ...variationsEvent, data: { type: 'KIOSK_NAV', target: 'view-select' },
};
for (const stage of ['story', 'continued']) {
  assert.equal(navigation(selectEvent, source, integration, stage), 'ads');
  assert.equal(navigation({ ...selectEvent, source: {} }, source, integration, stage), null);
  assert.equal(navigation({ ...selectEvent, origin: 'https://wrong.example' }, source, integration, stage), null);
  assert.equal(navigation(selectEvent, source, { ...integration, enabled: false }, stage), null);
  const graphEvent = { ...selectEvent, data: { type: 'KIOSK_NAV', target: 'view-graph-return' } };
  assert.equal(navigation(graphEvent, source, integration, stage), 'pacing');
  assert.equal(navigation({ ...graphEvent, source: {} }, source, integration, stage), null);
  assert.equal(navigation({ ...graphEvent, origin: 'https://wrong.example' }, source, integration, stage), null);
}
for (const stage of ['intake', 'portraits', 'name', 'graph', 'pacing', 'ads', 'banners', 'variations', 'ending']) {
  assert.equal(navigation(selectEvent, source, integration, stage), null);
  assert.equal(navigation({
    ...selectEvent, data: { type: 'KIOSK_NAV', target: 'view-graph-return' },
  }, source, integration, stage), null);
}
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
const preparation = createPreparation({ ...state, selectedAdId: null }, settings);
assert(validPreparation(preparation));
assert.equal(preparation.selectedBrand, undefined);
assert.equal(preparation.printScope, undefined);
assert.equal(preparation.showFinalQR, undefined);
assert(!validPreparation({ ...preparation, selectedBrand: 'yslbeauty' }));
const preparedState = {
  ...state, prepareRequest: preparation, prepareSubmitted: true,
};
const preparedFinal = createPrintRequest(preparedState, settings);
assert.equal(preparedFinal.requestId, preparation.requestId);
assert.equal(preparedFinal.createdAt, preparation.createdAt);
assert.equal(preparedFinal.type, undefined);
assert(validState({ ...preparedState, printRequest: preparedFinal }));
assert(!validState({ ...preparedState, language: 'fr' }));
assert(!validState({ ...preparedState, name: 'Another attendee' }));
assert(!validState({ ...preparedState, printRequest: request }));
assert(!validState({ ...state, prepareSubmitted: true }));
assert.throws(() => createPrintRequest({ ...preparedState, name: 'Another attendee' }, settings));
const preparationWrites = [];
for (const status of [201, 409, 412]) {
  // eslint-disable-next-line no-await-in-loop
  await submitPreparation(preparation, settings, undefined, async (url, options) => {
    preparationWrites.push({ url, options });
    return new Response('', { status });
  });
}
assert(preparationWrites.every(({ url, options }) => (
  new URL(url).pathname === `/glam-kiosk-requests/mock-event/requests/${preparation.requestId}/prepare.json`
  && options.method === 'PUT' && options.headers['If-None-Match'] === '*'
  && new URL(url).searchParams.get('sp') === 'c' && options.body === JSON.stringify(preparation)
)));
await assert.rejects(submitPreparation(preparation, { ...settings, requestSAS: '' }), /not configured/);
await assert.rejects(submitPreparation(preparation, { ...settings, eventId: 'other' }), /match this event/);
await assert.rejects(submitPreparation(preparation, settings, undefined, async () => (
  new Response('', { status: 403 })
)), /HTTP 403/);
const preparationStatus = {
  preparation: true, schemaVersion: 1, requestId: preparation.requestId,
  portraitId, eventPrefix: settings.eventId, request: preparation,
};
assert.equal(await readPrintStatus(preparedFinal, settings, undefined, async () => (
  new Response(JSON.stringify(preparationStatus))
)), null);
await assert.rejects(readPrintStatus(preparedFinal, settings, undefined, async () => (
  new Response(JSON.stringify({
    ...preparationStatus, request: { ...preparation, attendeeName: 'Other' },
  }))
)), /another request/);
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
