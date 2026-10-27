import assert from 'node:assert/strict';
import { missingUdpWord } from './analyze-silex-capture.mjs';

// Capture 1792993635333 frames 393, 395, 516 and 3876.
const list = '00010001474554205553425f4445564943455f4c4953545f494949' + '00'.repeat(59);
const ack = '0003' + list.slice(4, -4) + '00bc';
const base = { source: '192.168.2.4', destination: '10.6.70.90', sourcePort: 60728,
  destinationPort: 19540, length: 96 };
assert.equal(list.length / 2, 86);
assert.deepEqual(missingUdpWord({ ...base, checksum: 0x105e, payload: list }), ['0200']);
assert.deepEqual(missingUdpWord({ ...base, checksum: 0x0fa0, payload: ack }), ['0200']);
assert.deepEqual(missingUdpWord({ ...base, sourcePort: 60722, checksum: 0x1d90,
  payload: '00049506' + '00'.repeat(82) }), ['0000', 'ffff']);
assert.equal(missingUdpWord({ ...base, sourcePort: 53346, length: 94, checksum: 0x2f38, payload: list }), null);
assert.equal(missingUdpWord({ ...base, checksum: 0, payload: list }), null);
assert.equal(missingUdpWord({ ...base, length: 518, checksum: 0x1234, payload: list }), null);
console.log('Silex capture checksum regression checks passed.');
