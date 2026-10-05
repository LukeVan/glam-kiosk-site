import assert from 'node:assert/strict';
import {
  createPrintRequest, submitPrintRequest, readPrintStatus, validatePrintStatus, PRINT_BRANDS,
} from '../blocks/attendee-kiosk/fulfillment.js';
import { validateSettings } from '../scripts/kiosk-settings.js';
import { initialState, validState } from '../blocks/attendee-kiosk/state.js';

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
    downloadPageUrl: `https://main--glam-kiosk-site--lukevan.aem.live/download?session=${encodeURIComponent(`https://ffservices24.blob.core.windows.net/mock-assets/mock-event/7-Share-Output/${request.requestId}/session.json?sr=b&sp=r&se=${encodeURIComponent(expiry)}&sig=mock`)}`,
  },
};
assert.equal(validatePrintStatus(result, request), result);
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
