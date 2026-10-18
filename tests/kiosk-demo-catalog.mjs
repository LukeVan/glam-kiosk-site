import assert from 'node:assert/strict';
import fixture from './kiosk-demo-fixture.cjs';
import { readDemoCatalog, validateDemoCatalog } from '../blocks/attendee-kiosk/demo-catalog.js';
import createAzureAPI from '../blocks/attendee-kiosk/azure.js';
import { createAPI } from '../blocks/attendee-kiosk/api.js';
import { SETTINGS_KEY } from '../scripts/kiosk-settings.js';

const settings = {
  version: 1,
  containerSAS: `https://ffservices24.blob.core.windows.net/mock-assets?sv=2023-11-03&sr=c&sp=rl&se=${encodeURIComponent(new Date(Date.now() + 86400000).toISOString())}&sig=MOCK_ONLY`,
  eventId: 'TestEvent',
  activationProfile: 'max',
  formType: 'none',
};
const valid = fixture();
const parsed = validateDemoCatalog(valid, settings);
assert.equal(parsed.templateSetId, 'custom_max');
assert.equal(parsed.people[0].profile.variations['2-lorealprofessionnel'].length, 23);
assert.equal(parsed.people[0].profile.variations['1-larocheposay'].length, 0);
assert.equal(parsed.people[0].id, 'demo_Person5');
assert.equal(validateDemoCatalog({ ...valid, people: [] }, settings).people.length, 0);
for (const mutate of [
  (data) => { data.people[0].enabled = false; },
  (data) => { data.experienceTemplateSets.max = 'another_set'; },
]) {
  const data = structuredClone(valid);
  mutate(data);
  assert.equal(validateDemoCatalog(data, settings).people.length, 0);
}
for (const mutate of [
  (data) => { data.revision = 'invalid'; },
  (data) => { delete data.experienceTemplateSets.max; },
  (data) => { data.people.push(data.people[0]); },
  (data) => { data.people[0].order = -1; },
  (data) => { data.people[0].profiles.custom_max.demo = false; },
  (data) => { delete data.people[0].profiles.custom_max.ads['3-YSLbeauty']; },
  (data) => { data.people[0].profiles.custom_max.ads['3-YSLbeauty'] = data.people[0].profiles.custom_max.ads['1-larocheposay']; },
  (data) => { data.people[0].profiles.custom_max.printPreviews['3-YSLbeauty'] = data.people[0].profiles.custom_max.ads['3-YSLbeauty']; },
  (data) => { data.people[0].profiles.custom_max.cutouts['3-YSLbeauty'].mimeType = 'image/jpeg'; },
  (data) => { data.people[0].profiles.custom_max.portrait.blob += '?sig=FORBIDDEN'; },
  (data) => { data.people[0].profiles.custom_max.portrait.blob = 'https://example.com/portrait.jpg'; },
  (data) => { data.people[0].profiles.custom_max.portrait.blob = data.people[0].profiles.custom_max.portrait.blob.replace('/demo_Person5/', '/demo_Person3/'); },
  (data) => { data.people[0].profiles.custom_max.portrait.blob = data.people[0].profiles.custom_max.portrait.blob.replace('/portrait.jpg', '/../portrait.jpg'); },
  (data) => { data.people[0].profiles.custom_max.variations['3-YSLbeauty'] = Array(101).fill({}); },
]) {
  const data = structuredClone(valid);
  mutate(data);
  assert.throws(() => validateDemoCatalog(data, settings));
}
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });
assert.equal(await readDemoCatalog(settings, undefined, async () => response(null, 404)), null);
await assert.rejects(readDemoCatalog(settings, undefined, async () => response(null, 403)));
await assert.rejects(readDemoCatalog(settings, undefined, async () => response('invalid')));
await assert.rejects(readDemoCatalog(settings, undefined, async () => { throw new Error('offline'); }));
let payload = valid;
let requests = 0;
const storage = { getItem: (key) => (key === SETTINGS_KEY ? JSON.stringify(settings) : null) };
const api = createAzureAPI(createAPI({ mode: 'demo' }), storage, async (url, options) => {
  assert.equal(options.method, 'GET');
  if (!new URL(url).pathname.endsWith('/catalog.json')) throw new Error('Mock event listing offline');
  assert.equal(options.credentials, 'omit');
  assert.equal(options.cache, 'no-store');
  requests += 1;
  return payload === null ? response(null, 404) : response(payload);
});
assert.equal((await api.portraits())[0].label, 'Permanent Demo Five');
const snapshot = await api.manifest('demo_Person5');
assert(snapshot.demoCatalog);
assert.equal(snapshot.ads.length, 4);
assert.equal((await api.bannerResults('demo_Person5', 'demo_Person5_2')).assets.length, 23);
assert.equal((await api.bannerResults('demo_Person5', 'demo_Person5_1')).assets.length, 0);
const assets = await api.demoAssets('demo_Person5', 'demo_Person5_3');
assert(new URL(assets.cutout.url).pathname.endsWith('/cutouts/3-YSLbeauty.png'));
assert(new URL(assets.printPreview.url).pathname.endsWith('/print-previews/3-YSLbeauty.jpg'));
assert.equal((await api.demoCutouts('demo_Person5')).length, 4);
await api.resume({ sessionId: 'test', portraitId: 'demo_Person5' });
await api.select({ sessionId: 'test', portraitId: 'demo_Person5', selectedAdId: 'demo_Person5_2' });
assert.equal(requests, 1);
payload = { ...valid, people: [] };
assert.deepEqual(await api.manifest('demo_Person5'), snapshot);
assert.equal((await api.portraits()).length, 0);
await assert.rejects(api.manifest('demo_Person5'));
payload = null;
assert.equal((await api.portraits()).length, 3);
assert.equal((await api.manifest('demo_Person5')).demoCatalog, undefined);
payload = { ...valid, schemaVersion: 99 };
await assert.rejects(api.portraits());
console.log('Permanent demos: schema/path/brand isolation, custom set, absence vs empty/error, snapshot, 23 outputs, zero writes passed.');
