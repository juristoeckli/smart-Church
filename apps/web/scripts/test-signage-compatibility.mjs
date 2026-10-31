import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

const source = await readFile(new URL('../public/signage-player.js', import.meta.url), 'utf8');
assert.ok(!source.includes('?.'), 'TV engine cannot parse optional chaining');
assert.ok(!source.includes('??'), 'TV engine cannot parse nullish coalescing');
const bytes = new TextEncoder().encode('test image');
const sha256 = Buffer.from(await webcrypto.subtle.digest('SHA-256', bytes)).toString('hex');
let fileReads = 0;
class LegacyBlob extends Blob { arrayBuffer = undefined; }
class LegacyFileReader {
  readAsArrayBuffer(blob) {
    fileReads++;
    Blob.prototype.arrayBuffer.call(blob).then(result => { this.result = result; this.onload(); });
  }
}
function element(tag = '') {
  return {tag, children: [], hidden: false, style: {}, textContent: '',
    get firstChild() { return this.children[0]; },
    removeChild(child) { this.children.splice(this.children.indexOf(child), 1); },
    appendChild(child) { this.children.push(child); }};
}
async function boot({paired = false, blockedStorage = false} = {}) {
  const nodes = new Map(), calls = [], timers = [];
  const connection = {displayId: 'display', departmentId: 'department', apiKey: 'sc_' + 'k'.repeat(43)};
  const pending = {code: 'ABCD-EFGH', pairingToken: 't'.repeat(43), apiKey: connection.apiKey, expiresAt: new Date(Date.now()+900000).toISOString()};
  const plan = {serverTime: new Date().toISOString(), validUntil: new Date(Date.now()+86400000).toISOString(),
    defaultShowId: 'show', schedules: [], media: [{id: 'image', size: bytes.length, sha256}],
    shows: [{id: 'show', revision: 1, slides: [{kind: 'image', mediaId: 'image'}]}]};
  const context = {performance, Map, Set, Blob: LegacyBlob, FileReader: LegacyFileReader,
    crypto: webcrypto, AbortController, Response, URL: {createObjectURL: () => 'blob:test', revokeObjectURL() {}},
    document: {getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); }, createElement: element, addEventListener() {}},
    localStorage: {getItem: key => paired && key.endsWith('connection') ? JSON.stringify(connection) : null,
      setItem() { if (blockedStorage) throw Error('storage blocked'); }, removeItem() {}},
    navigator: {userAgent: 'SMART-TV Tizen 6.0 Chrome/76'},
    indexedDB: {open() { throw Error('offline storage unavailable'); }},
    location: {pathname: '/signage-display.html'}, history: {replaceState(_a, _b, path) { context.location.pathname = path; }},
    setTimeout(fn, delay) { if (delay === 3000) timers.push(fn); return 1; }, clearTimeout() {}, setInterval() {},
    requestAnimationFrame() {}, addEventListener() {}, matchMedia: () => ({matches: false}),
    fetch: async path => {
      calls.push(path);
      if (path.endsWith('/media/image')) return {status: 200, statusText: 'OK', headers: {}, arrayBuffer: async () => bytes.buffer};
      return Response.json(path.endsWith('/start') ? pending : path.endsWith('/status') ? {status: 'connected', ...connection} : path.endsWith('/plan') ? plan : {});
    }};
  // Response.blob also returns the older Blob shape.
  context.Response = class extends Response { async blob() { return new LegacyBlob([await this.arrayBuffer()]); } };
  context.window = context;
  vm.runInNewContext(source, context);
  const settle = async () => { for (let i=0; i<30; i++) await new Promise(resolve => setImmediate(resolve)); };
  await settle();
  return {context, nodes, calls, timers, settle};
}
const connected = await boot({paired: true});
assert.equal(connected.nodes.get('screen').children[0].tag, 'img');
assert.ok(fileReads > 0, 'media verification uses FileReader when Blob.arrayBuffer is missing');
assert.ok(connected.calls.some(path => path.endsWith('/heartbeat')));
const unpaired = await boot({blockedStorage: true});
assert.equal(unpaired.nodes.get('pair-code').textContent, 'ABCD-EFGH');
assert.equal(unpaired.context.location.pathname, '/signage-display.html/ABCD-EFGH');
await unpaired.timers.at(-1)(); await unpaired.settle();
assert.equal(unpaired.nodes.get('setup').hidden, true, 'storage failure must not block approval');
assert.equal(unpaired.nodes.get('screen').children[0].tag, 'img');
console.log('PASS: TV pairing, playback, heartbeat, legacy DOM/Blob, unavailable storage');
