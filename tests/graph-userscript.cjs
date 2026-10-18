const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const script = fs.readFileSync('tools/graph-auto-load.user.js', 'utf8');
const now = Date.now();
const day = 86400000;
const base = new URL(`https://ffservices24.blob.core.windows.net/meow-ffs-storage-corex/TestEvent/9-Graph-Input/azure_${'a'.repeat(64)}/portrait.png`);
base.search = new URLSearchParams({
  sv: '2023-11-03', sr: 'b', sp: 'r', spr: 'https',
  st: new Date(now - 60000).toISOString(),
  se: new Date(now + 7 * day).toISOString(), sig: 'MOCK_ONLY',
});
function execute(url, duplicate = false, metadata) {
  const logs = [];
  const downloads = [];
  const history = [];
  const params = new URLSearchParams({ keep: 'yes', portraitUrl: url });
  if (metadata) params.set('publicDemo', JSON.stringify(metadata));
  if (duplicate) params.append('portraitUrl', url);
  const context = {
    URL, URLSearchParams, Date: class extends Date { static now() { return now; } },
    location: { hash: `#${params}`, pathname: '/graph/mock', search: '?fixture=1' },
    history: { state: null, replaceState: (...args) => history.push(args[2]) },
    console: { log: (...args) => logs.push(args.join(' ')), error: (...args) => logs.push(args.join(' ')) },
    document: { body: null },
    window: { addEventListener() {} },
    unsafeWindow: {},
    MutationObserver: class { observe() {} },
    setTimeout() {},
    GM_xmlhttpRequest: (request) => downloads.push(request),
  };
  vm.runInNewContext(script, context);
  assert.deepEqual(history, ['/graph/mock?fixture=1#keep=yes']);
  assert(logs.every((message) => !message.includes('MOCK_ONLY') && !message.includes('https://')));
  return { logs, downloads };
}
function reject(change, reason) {
  const url = new URL(base);
  change(url);
  const result = execute(url.href);
  assert.equal(result.downloads.length, 0);
  assert(result.logs.some((message) => message.includes(`(${reason})`)), reason);
}
assert.equal(execute(base.href).downloads.length, 1);
for (const format of [
  (value) => value.replace('.000Z', 'Z'),
  (value) => value.replace('Z', '+00:00'),
  (value) => value.replace(/\.\d+Z$/, 'Z'),
]) {
  const url = new URL(base);
  for (const key of ['st', 'se']) url.searchParams.set(key, format(url.searchParams.get(key)));
  assert.equal(execute(url.href).downloads.length, 1);
}
reject((url) => url.searchParams.set('se', new Date(now + 7 * day + 1).toISOString()), 'expiry_too_long');
reject((url) => url.searchParams.set('se', new Date(now).toISOString()), 'expired');
reject((url) => url.searchParams.set('st', new Date(now + 1).toISOString()), 'not_active');
reject((url) => url.searchParams.set('st', '2026-10-18T12:00:00-04:00'), 'timestamp_invalid');
reject((url) => url.searchParams.set('se', 'invalid'), 'timestamp_invalid');
reject((url) => url.searchParams.set('sp', 'rl'), 'permissions_invalid');
reject((url) => url.searchParams.set('sr', 'c'), 'permissions_invalid');
reject((url) => url.searchParams.set('spr', 'http'), 'permissions_invalid');
reject((url) => url.searchParams.append('sig', 'SECOND'), 'parameters_invalid');
reject((url) => url.searchParams.set('unknown', '1'), 'parameters_invalid');
reject((url) => { url.hostname = 'example.invalid'; }, 'host_invalid');
reject((url) => { url.pathname = url.pathname.replace('portrait.png', 'other.png'); }, 'path_invalid');
reject((url) => { url.pathname = url.pathname.replace('9-Graph-Input', 'assets'); }, 'path_invalid');
assert.equal(execute(base.href, true).downloads.length, 0);
assert(execute('not a URL').logs.some((message) => message.includes('(url_invalid)')));
const publicDemo = {
  personId: 'demo_Test', templateSetId: 'max_square', version: 'a'.repeat(32),
  brand: '4-lorealparis', sha256: 'b'.repeat(64),
};
const publicURL = `https://kiosk-preview--glam-kiosk-site--lukevan.aem.page/assets/permanent-demo-cutouts/demo_Test/max_square/${publicDemo.version}/4-lorealparis.png`;
assert.equal(execute(publicURL, false, publicDemo).downloads.length, 1);
assert.equal(execute(publicURL).downloads.length, 0);
for (const update of [{ personId: 'azure_test' }, { brand: '3-yslbeauty' }, { version: 'bad' }, { sha256: '' }]) {
  assert.equal(execute(publicURL, false, { ...publicDemo, ...update }).downloads.length, 0);
}
for (const url of [
  `${publicURL}?sig=NO`, `${publicURL}#anything`,
  publicURL.replace('demo_Test/', 'demo_Other/'),
  publicURL.replace('https://kiosk-preview--glam-kiosk-site--lukevan.aem.page', 'http://localhost:3017'),
]) assert.equal(execute(url, false, publicDemo).downloads.length, 0);
console.log('Graph userscript: seven-day boundary, UTC formats, expired/inactive/unsafe access rejection, hash cleanup and credential-free diagnostics passed.');
