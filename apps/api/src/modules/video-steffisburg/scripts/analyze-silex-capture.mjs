// Offline inspection only. Does not send traffic to the device.
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function missingUdpWord({ source, destination, sourcePort, destinationPort, length, checksum, payload }) {
  const bytes = Buffer.from(payload, 'hex');
  if (length - 8 - bytes.length !== 2 || bytes.length % 2 || !checksum) return null;
  const header = Buffer.alloc(20);
  Buffer.from(source.split('.').map(Number)).copy(header, 0);
  Buffer.from(destination.split('.').map(Number)).copy(header, 4);
  header[9] = 17;
  header.writeUInt16BE(length, 10);
  header.writeUInt16BE(sourcePort, 12);
  header.writeUInt16BE(destinationPort, 14);
  header.writeUInt16BE(length, 16);
  header.writeUInt16BE(checksum, 18);
  let sum = 0;
  const covered = Buffer.concat([header, bytes]);
  for (let i = 0; i < covered.length; i += 2) sum += covered.readUInt16BE(i);
  while (sum > 0xffff) sum = (sum & 0xffff) + (sum >>> 16);
  // Zero and ffff are indistinguishable under one's-complement addition.
  const word = 0xffff - sum;
  return word === 0 ? ['0000', 'ffff'] : [word.toString(16).padStart(4, '0')];
}

export function inspectCapture(file, tshark = process.env.TSHARK || 'tshark') {
  const fields = ['frame.number', 'frame.len', 'frame.cap_len', 'ip.src', 'ip.dst',
    'udp.srcport', 'udp.dstport', 'udp.length', 'udp.checksum', 'udp.payload',
    'tcp.stream', 'tcp.len', 'tcp.payload'];
  const result = spawnSync(tshark, ['-r', file, '-Y', 'ip && (udp.port==19540 || tcp.port==19540)',
    '-T', 'fields', ...fields.flatMap(field => ['-e', field])], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim());
  const packets = result.stdout.trim().split(/\r?\n/).filter(Boolean).map(line => {
    const [frame, wireLength, capturedLength, source, destination, sourcePort, destinationPort,
      length, checksum, payload, stream, tcpLength, tcpPayload] = line.split('\t');
    const common = { frame: +frame, source, destination, wireLength: +wireLength,
      capturedLength: +capturedLength, truncated: +capturedLength < +wireLength };
    if (length) {
      const udp = { source, destination, sourcePort: +sourcePort, destinationPort: +destinationPort,
        length: +length, checksum: Number(checksum), payload };
      return { ...common, protocol: 'UDP', sourcePort: +sourcePort, destinationPort: +destinationPort,
        payloadLength: +length - 8, capturedPayloadLength: payload.length / 2, payload,
        missingTailCandidates: missingUdpWord(udp) };
    }
    return { ...common, protocol: 'TCP', stream: +stream, payloadLength: +tcpLength, payload: tcpPayload || '' };
  });
  return { file, note: 'Checksum recovery assumes the recorded checksum is valid; a recovered word does not establish its meaning. TCP packets are not reassembled here.',
    packets: packets.filter(packet => packet.protocol === 'UDP' || packet.payloadLength > 0),
    emptyTcpPackets: packets.filter(packet => packet.protocol === 'TCP' && packet.payloadLength === 0).length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (!process.argv[2]) throw new Error('Usage: node apps/api/src/modules/video-steffisburg/scripts/analyze-silex-capture.mjs <capture.pcap> [tshark executable]');
    console.log(JSON.stringify(inspectCapture(process.argv[2], process.argv[3]), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
