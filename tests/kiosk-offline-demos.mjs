import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { validateOfflineDemoCatalog } from '../blocks/attendee-kiosk/demo-catalog.js';
import createOfflineDemoAPI from '../blocks/attendee-kiosk/offline-demos.js';
import { BANNER_BRANDS } from '../blocks/attendee-kiosk/banner-assets.js';

const data = JSON.parse(await readFile('assets/offline-demos/catalog.json', 'utf8'));
const catalog = validateOfflineDemoCatalog(data);
assert.deepEqual(catalog.people.map((person) => person.label).sort(), ['Greg', 'Sarah', 'Tina']);
const requests = [];
const api = createOfflineDemoAPI(async (url, options) => {
  requests.push(url);
  assert.equal(url, '/assets/offline-demos/catalog.json');
  assert.equal(options.method, 'GET');
  return { ok: true, text: async () => JSON.stringify(data) };
});
const portraits = await api.portraits();
assert.equal(portraits.length, 3);
const urls = new Set();
for (const person of portraits) {
  urls.add(person.thumbnailUrl);
  assert(person.demo && person.demoCatalog);
  assert.equal((await api.selectedPortrait(person.id)).id, person.id);
  const manifest = await api.manifest(person.id);
  assert.equal(manifest.ads.length, 4);
  manifest.ads.forEach((ad) => urls.add(ad.url));
  await api.resume({ portraitId: person.id });
  for (const [index] of BANNER_BRANDS.entries()) {
    const ad = `${person.id}_${index + 1}`;
    await api.select({ portraitId: person.id, selectedAdId: ad });
    const assets = await api.demoAssets(person.id, ad);
    const results = await api.bannerResults(person.id, ad);
    urls.add(assets.cutout.url);
    urls.add(assets.printPreview.url);
    assert.equal(results.status, 'ready');
    assert.equal(results.assets.length, index === 1 ? 23 : 9);
    results.assets.forEach((asset) => urls.add(asset.url));
  }
  await assert.rejects(api.demoAssets(person.id, 'wrong_ad'));
}
assert.equal(urls.size, 189);
let bytes = 0;
for (const url of urls) {
  assert(url.startsWith('/assets/offline-demos/'));
  assert(!url.includes('?') && !url.includes('://'));
  const file = url.slice(1);
  bytes += (await stat(file)).size;
  const content = await readFile(file);
  if (file.endsWith('.png')) assert.equal(content.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  else assert.equal(content.subarray(0, 3).toString('hex'), 'ffd8ff');
}
assert.equal(bytes, 48055625);
assert.equal(requests.length, 1);
for (const badPath of [
  'https://example.com/portrait.jpg',
  data.people[0].profiles.max_square.portrait.blob.replace('offline-demos', 'permanent-demos'),
  `${data.people[0].profiles.max_square.portrait.blob}?sig=not_allowed`,
]) {
  const invalid = structuredClone(data);
  invalid.people[0].profiles.max_square.portrait.blob = badPath;
  assert.throws(() => validateOfflineDemoCatalog(invalid));
}
await assert.rejects(createOfflineDemoAPI(async () => ({ ok: false, status: 404 })).portraits(), /404/);
await assert.rejects(api.manifest('demo_unknown'), /no longer available/);
console.log('Offline demos: Sarah/Tina/Greg, 189 real local media, all brands/50 variations, strict namespace, no writes or Azure requests passed.');
