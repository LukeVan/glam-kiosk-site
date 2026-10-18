import assert from 'node:assert/strict';
import { readPublicDemo, validatePublicDemo, PUBLIC_DEMO_ORIGINS } from '../blocks/attendee-kiosk/public-demo.js';
import { readConfig } from '../blocks/attendee-kiosk/config.js';

const origin = PUBLIC_DEMO_ORIGINS[0];
const identity = {
  personId: 'demo_Test', templateSetId: 'custom_max', version: 'a'.repeat(32), brand: '4-lorealparis',
};
const path = `assets/permanent-demo-cutouts/${identity.personId}/${identity.templateSetId}/${identity.version}/${identity.brand}.png`;
const entry = { ...identity, path, sha256: 'b'.repeat(64) };
let requested;
const fetcher = async (url) => {
  requested = url;
  return new Response(JSON.stringify({ schemaVersion: 1, cutouts: [entry] }));
};
const result = await readPublicDemo(origin, identity, null, fetcher);
assert.equal(requested, `${origin}/assets/permanent-demo-cutouts/index.json`);
assert.equal(result.url, `${origin}/${path}`);
assert.equal(await readPublicDemo('', identity, null, fetcher), null);
assert.equal(await readPublicDemo(origin, { ...identity, version: 'c'.repeat(32) }, null, fetcher), null);
assert.equal(await readPublicDemo(origin, identity, null, async () => new Response('', { status: 404 })), null);
await assert.rejects(readPublicDemo(origin, identity, null, async () => new Response('', { status: 403 })));
await assert.rejects(readPublicDemo('http://localhost:3017', identity, null, fetcher));
await assert.rejects(readPublicDemo(origin, identity, null, async () => new Response(JSON.stringify({
  schemaVersion: 1, cutouts: [entry, entry],
}))));
for (const update of [
  { personId: 'azure_test' }, { version: '../x' }, { sha256: 'invalid' },
  { brand: '3-yslbeauty' }, { url: `${origin}/${path}?sig=NO` },
  { url: `http://localhost:3017/${path}` }, { url: `${origin}/${path}#test` },
  { url: `${origin}/${path.replace('demo_Test', 'demo_Other')}` },
]) assert.throws(() => validatePublicDemo({ ...result, ...update }));
assert.equal(readConfig('demo', {}, origin).publicDemoOrigin, origin);
assert.equal(readConfig('demo', {}, 'http://localhost:3017').publicDemoOrigin, '');
assert.throws(() => readConfig('demo', { publicDemoOrigin: 'https://example.invalid' }, origin));
console.log('Public demo: hosted-origin index discovery, exact catalog version/brand/path binding, absence/error and strict provenance checks passed.');
