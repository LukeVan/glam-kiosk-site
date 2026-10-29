import assert from 'node:assert/strict';
import { parseAccessFile, readAccessFile } from '../scripts/kiosk-access-import.js';

const expiresAt = new Date(Date.now() + 86400000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const sas = (container, permissions, expiry = expiresAt) => (
  `https://ffservices24.blob.core.windows.net/${container}?sv=2023-11-03&sr=c&sp=${permissions}&spr=https&se=${encodeURIComponent(expiry)}&sig=MOCK_ONLY`
);
const fixture = {
  schemaVersion: 1,
  type: 'glam-kiosk-access',
  eventPrefix: 'TestEvent',
  assetContainerSasUrl: sas('mock-assets', 'rl'),
  requestContainerSasUrl: sas('glam-kiosk-requests', 'c'),
  expiresAt,
};
const text = JSON.stringify(fixture);
assert.equal(parseAccessFile(text).eventId, 'TestEvent');
assert.equal(parseAccessFile(text).containerSAS, fixture.assetContainerSasUrl);
assert.equal(parseAccessFile(text).requestSAS, fixture.requestContainerSasUrl);
assert.equal((await readAccessFile(new File([text], 'access.txt'))).eventId, 'TestEvent');
for (const update of [
  { schemaVersion: 2 },
  { type: 'unknown' },
  { extra: 'unexpected' },
  { eventPrefix: '../event' },
  { eventPrefix: '..' },
  { eventPrefix: 'portraits' },
  { eventPrefix: '' },
  { eventPrefix: null },
  { assetContainerSasUrl: sas('mock-assets', 'racwdl') },
  { requestContainerSasUrl: sas('mock-assets', 'c') },
  { requestContainerSasUrl: sas('glam-kiosk-requests', 'rc') },
  { assetContainerSasUrl: fixture.assetContainerSasUrl.replace('https:', 'http:') },
  { assetContainerSasUrl: fixture.assetContainerSasUrl.replace('ffservices24', 'other') },
  { expiresAt: '2020-01-01T00:00:00Z' },
  { expiresAt: expiresAt.replace('Z', '') },
  { requestContainerSasUrl: sas('glam-kiosk-requests', 'c', '2020-01-01T00:00:00Z') },
  { requestContainerSasUrl: sas('glam-kiosk-requests', 'c', new Date(Date.now() + 172800000).toISOString()) },
]) {
  assert.throws(() => parseAccessFile(JSON.stringify({ ...fixture, ...update })));
}
for (const invalid of ['null', '[]', '{}', '"MOCK_ONLY"', '{ "secret": "MOCK_ONLY"']) {
  assert.throws(() => parseAccessFile(invalid), (error) => !error.message.includes('MOCK_ONLY'));
}
for (const file of [
  new File([text], 'access.json'),
  new File([], 'access.txt'),
  new File(['x'.repeat(16385)], 'access.txt'),
]) {
  await assert.rejects(() => readAccessFile(file));
}
await assert.rejects(
  () => readAccessFile({ name: 'access.txt', size: 20, text: async () => { throw new Error('MOCK_ONLY'); } }),
  (error) => !error.message.includes('MOCK_ONLY'),
);
console.log('Access importer: six-key contract, permissions, host, expiry, event, file limits and credential-free errors passed.');
