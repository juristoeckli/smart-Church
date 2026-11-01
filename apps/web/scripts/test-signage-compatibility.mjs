import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

const source = await readFile(new URL('../public/signage-player.js', import.meta.url), 'utf8');
assert.ok(!source.includes('?.'), 'TV engine cannot parse optional chaining');
assert.ok(!source.includes('??'), 'TV engine cannot parse nullish coalescing');
assert.ok(!/catch\s*\{/.test(source), 'Chrome 63 requires a catch parameter');
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
async function boot({paired = false, blockedStorage = false, legacyTransport = false, timeout = false, timing = false, reloadVersion = 0, control = false, blank = false} = {}) {
  const nodes = new Map(), calls = [], timers = [];
  const intervals = [], reports = [], saved = new Map(); let reloads = 0;
  const sockets=[];let fullscreenRequests=0;
  const connection = {displayId: 'display', departmentId: 'department', apiKey: 'sc_' + 'k'.repeat(43)};
  const pending = {code: 'ABCD-EFGH', pairingToken: 't'.repeat(43), apiKey: connection.apiKey, expiresAt: new Date(Date.now()+900000).toISOString()};
  const plan = {serverTime: new Date().toISOString(), validUntil: new Date(Date.now()+86400000).toISOString(),
    defaultShowId: 'show', schedules: [], media: [{id: 'image', size: bytes.length, sha256}],
    shows: [{id: 'show', revision: 1, slides: [{kind: 'image', mediaId: 'image'}]}]};
  if(timing) {plan.serverTime=new Date(1060000).toISOString();plan.validUntil=new Date(2060000).toISOString();plan.media=[];plan.shows[0].slides=[{heading:'Early',duration:12},{heading:'Late',duration:12}];}
  if(blank){plan.shows=[];plan.media=[];plan.defaultShowId=null;}
  const context = {performance, Map, Set, Blob: LegacyBlob, FileReader: LegacyFileReader,
    crypto: webcrypto, AbortController, Response, URL: class extends URL {static createObjectURL(){return 'blob:test';} static revokeObjectURL(){}},
    document: {body:{classList:{toggle(){}}},documentElement:element(),getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); }, createElement: element, addEventListener() {}},
    localStorage: {getItem: key => saved.get(key) || (paired && key.endsWith('connection') ? JSON.stringify(connection) : null),
      setItem(key,value) { if (blockedStorage) throw Error('storage blocked'); saved.set(key,value); }, removeItem(key) {saved.delete(key);}},
    navigator: {userAgent: 'SMART-TV Tizen 6.0 Chrome/76'},
    indexedDB: {open() { throw Error('offline storage unavailable'); }},
    location: {href:'https://test/signage-display.html',pathname: '/signage-display.html',reload(){reloads++;}}, history: {replaceState(_a, _b, path) { context.location.pathname = path; }},
    setTimeout(fn, delay) { if (delay === 3000) timers.push(fn); return 1; }, clearTimeout() {}, setInterval(fn,delay) {intervals.push({fn,delay});},
    requestAnimationFrame() {}, addEventListener() {}, matchMedia: () => ({matches: false}),
    fetch: async (path,options) => {
      calls.push(path);
      if(path.endsWith('/control-ticket')) return Response.json({ticket:'single-use-ticket'});
      if(path.endsWith('/heartbeat')) {reports.push(JSON.parse(options.body));return Response.json({serverTime:timing?new Date(1060000).toISOString():new Date().toISOString(),reloadVersion});}
      if (path.endsWith('/media/image')) return {status: 200, statusText: 'OK', headers: {}, arrayBuffer: async () => bytes.buffer};
      return Response.json(path.endsWith('/start') ? pending : path.endsWith('/status') ? {status: 'connected', ...connection} : path.endsWith('/plan') ? plan : {});
    }};
  if(timing) context.Date=class extends Date { static now(){return 1000000;} };
  if(control){context.WebSocket=class {constructor(url){this.url=url;sockets.push(this);}close(){if(this.onclose)this.onclose();}};context.document.documentElement.requestFullscreen=()=>{fullscreenRequests++;context.document.fullscreenElement=context.document.documentElement;};}
  // Response.blob also returns the older Blob shape.
  context.Response = class extends Response { async blob() { return new LegacyBlob([await this.arrayBuffer()]); } };
  if (legacyTransport) {
    const fetch = context.fetch;
    context.AbortController = undefined;
    context.Headers = Headers;
    context.fetch = undefined;
    context.XMLHttpRequest = class {
      headers = {};
      open(method, url) { this.method = method; this.url = url; }
      setRequestHeader(name, value) { this.headers[name] = value; }
      getAllResponseHeaders() { return 'content-type: application/json\r\n'; }
      abort() { this.onabort(); }
      async send(body) {
        assert.ok(this.timeout > 0, 'legacy requests must time out');
        if (timeout) { this.ontimeout(); return; }
        if (this.url.includes('/device/')) {
          assert.equal(this.headers.Authorization, 'Bearer ' + connection.apiKey);
          assert.equal(this.headers['x-department-id'], connection.departmentId);
        }
        if (this.url.endsWith('/status')) assert.equal(JSON.parse(body).pairingToken, pending.pairingToken);
        const response = await fetch(this.url,{body});
        this.status = response.status;
        this.statusText = response.statusText;
        this.response = await response.arrayBuffer();
        this.onload();
      }
    };
  }
  context.window = context;
  vm.runInNewContext(source, context);
  const settle = async () => { for (let i=0; i<30; i++) await new Promise(resolve => setImmediate(resolve)); };
  await settle();
  return {context, nodes, calls, timers, settle, intervals, reports, reloads:()=>reloads,sockets,fullscreenRequests:()=>fullscreenRequests};
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
const chrome63 = await boot({legacyTransport: true});
assert.equal(chrome63.nodes.get('pair-code').textContent, 'ABCD-EFGH');
await chrome63.timers.at(-1)(); await chrome63.settle();
assert.equal(chrome63.nodes.get('setup').hidden, true);
assert.equal(chrome63.nodes.get('screen').children[0].tag, 'img');
assert.ok(chrome63.calls.some(path => path.endsWith('/heartbeat')));
const timedOut = await boot({legacyTransport: true, timeout: true});
assert.match(timedOut.nodes.get('pair-error').textContent, /timed out/);
assert.ok(timedOut.timers.length, 'pairing retries after an XHR timeout');
const timed=await boot({paired:true,timing:true,reloadVersion:1});
assert.equal(timed.nodes.get('screen').children[0].textContent,'Early','slide uses corrected server time');
assert.equal(timed.reloads(),1);
timed.intervals.find(item=>item.delay===30000&&item.fn.toString().includes('heartbeat')).fn();await timed.settle();
assert.equal(timed.reloads(),1,'reload command is remembered before reloading');
assert.ok(Math.abs(timed.reports.at(-1).clockOffsetMs-60000)<1000);
assert.ok(timed.reports.at(-1).clockRoundTripMs>=0);
assert.equal(timed.nodes.get('fullscreen').hidden,true,'controls hidden while connected');
const controlled=await boot({paired:true,control:true});
assert.equal(controlled.sockets.length,1);
const websocket=controlled.sockets[0];assert.match(websocket.url,/wss:/);assert.match(websocket.url,/ticket=single-use-ticket/);assert.ok(!websocket.url.includes('sc_'));
const send=(topic,payload)=>websocket.onmessage({data:JSON.stringify({topic,departmentId:'department',payload})});
send('signage:reload',{displayId:'other-display',reloadVersion:1});assert.equal(controlled.reloads(),0);
send('signage:reload',{displayId:'display',reloadVersion:1});assert.equal(controlled.reloads(),1);
send('signage:reload',{displayId:'display',reloadVersion:1});assert.equal(controlled.reloads(),1);
controlled.context.document.fullscreenElement=null;const before=controlled.fullscreenRequests();
send('signage:fullscreen',{displayId:'display',fullscreenVersion:1});assert.equal(controlled.fullscreenRequests(),before+1);
const black=await boot({paired:true,blank:true});assert.equal(black.nodes.get('screen').className,'blank');assert.equal(black.nodes.get('screen').children.length,0);
console.log('PASS: TV pairing, playback, heartbeat, legacy DOM/Blob, unavailable storage');
