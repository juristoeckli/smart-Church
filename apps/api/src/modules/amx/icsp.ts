import { Socket } from "node:net";

const VERSION = 2;
const ICSP_PORT = 1319;
const COMMAND_REGISTER = 0x0583;
const COMMAND_REGISTER_ACK = 0x0503;
const COMMAND_ACK = 0x0001;
const COMMAND_NAK = 0x0002;
const COMMAND_CHANNEL_PUSH = 0x0084;
const COMMAND_CHANNEL_RELEASE = 0x0085;
const COMMAND_DEVICE_STATUS = 0x0104;
const COMMAND_DEVICE_STATUS_END = 0x010a;
const COMMAND_LEVEL_VALUE = 0x000a;

type Address = { device: number; port: number; system: number };
type Frame = { flags: number; destination: Buffer; source: Buffer; messageId: number; command: number; data: Buffer };
type IcspSession = {
  socket: Socket;
  clientAddress: Buffer;
  masterAddress: Buffer;
  sendCommand: (command: number, data?: Buffer) => Promise<number>;
  nextFrame: (timeoutMs: number) => Promise<Frame>;
};

function addressBytes(address: Address) {
  for (const value of [address.device, address.port, address.system]) {
    if (!Number.isInteger(value) || value < 0 || value > 65535) throw new Error("Invalid ICSP device address.");
  }
  const result = Buffer.alloc(6);
  result.writeUInt16BE(address.system, 0);
  result.writeUInt16BE(address.device, 2);
  result.writeUInt16BE(address.port, 4);
  return result;
}

function frameBytes(flags: number, destination: Buffer, source: Buffer, messageId: number, command: number, data: Buffer = Buffer.alloc(0)) {
  const payload = Buffer.concat([
    Buffer.from([VERSION, flags]), destination, source, Buffer.from([15]),
    Buffer.from([messageId >> 8, messageId & 0xff, command >> 8, command & 0xff]), data,
  ]);
  const packet = Buffer.alloc(payload.length + 4);
  packet[0] = VERSION;
  packet.writeUInt16BE(payload.length, 1);
  payload.copy(packet, 3);
  packet[packet.length - 1] = packet.subarray(0, packet.length - 1).reduce((sum, byte) => (sum + byte) & 0xff, 0);
  return packet;
}

function decodeFrame(packet: Buffer): Frame {
  if (packet.length < 23 || packet[0] !== VERSION || packet[packet.length - 1] !== (packet.subarray(0, -1).reduce((sum, byte) => (sum + byte) & 0xff, 0))) {
    throw new Error("The NetLinx master returned an invalid ICSP frame.");
  }
  return {
    flags: packet[4]!, destination: packet.subarray(5, 11), source: packet.subarray(11, 17),
    messageId: packet.readUInt16BE(18), command: packet.readUInt16BE(20), data: packet.subarray(22, packet.length - 1),
  };
}

async function openIcspSession(host: string): Promise<IcspSession> {
  const socket = new Socket();
  socket.setTimeout(12000);
  let buffer = Buffer.alloc(0);
  const queued: Frame[] = [];
  const waiters: Array<{ resolve: (frame: Frame) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }> = [];
  let closedError: Error | undefined;

  const rejectWaiters = (error: Error) => {
    closedError = error;
    for (const waiter of waiters.splice(0)) { clearTimeout(waiter.timer); waiter.reject(error); }
  };
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 3) {
      if (buffer[0] !== VERSION) { rejectWaiters(new Error("The NetLinx master sent an invalid ICSP protocol header.")); socket.destroy(); return; }
      const length = buffer.readUInt16BE(1);
      if (length < 19 || length > 65535) { rejectWaiters(new Error("The NetLinx master sent an invalid ICSP frame length.")); socket.destroy(); return; }
      const total = length + 4;
      if (buffer.length < total) break;
      const raw = buffer.subarray(0, total);
      buffer = buffer.subarray(total);
      try {
        const frame = decodeFrame(raw);
        const waiter = waiters.shift();
        if (waiter) { clearTimeout(waiter.timer); waiter.resolve(frame); }
        else queued.push(frame);
      } catch (error) { rejectWaiters(error instanceof Error ? error : new Error("Invalid ICSP response.")); socket.destroy(); return; }
    }
  });
  socket.on("error", (error) => rejectWaiters(new Error(`Could not connect to NetLinx ICSP: ${error.message}`)));
  socket.on("close", () => { if (!closedError) rejectWaiters(new Error("The NetLinx master closed the ICSP connection.")); });
  socket.on("timeout", () => { rejectWaiters(new Error("The NetLinx ICSP request timed out.")); socket.destroy(); });

  const nextFrame = (timeoutMs: number) => {
    const next = queued.shift();
    if (next) return Promise.resolve(next);
    if (closedError) return Promise.reject(closedError);
    return new Promise<Frame>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = waiters.findIndex((waiter) => waiter.timer === timer);
        if (index >= 0) waiters.splice(index, 1);
        reject(new Error("The NetLinx master did not complete the ICSP request."));
      }, timeoutMs);
      waiters.push({ resolve, reject, timer });
    });
  };
  const send = (data: Buffer) => new Promise<void>((resolve, reject) => socket.write(data, (error) => error ? reject(error) : resolve()));

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { socket.destroy(); reject(new Error("Connecting to NetLinx ICSP timed out.")); }, 5000);
      socket.once("connect", () => { clearTimeout(timer); resolve(); });
      socket.once("error", (error) => { clearTimeout(timer); reject(new Error(`Could not connect to NetLinx ICSP: ${error.message}`)); });
      socket.connect({ port: ICSP_PORT, host, family: 4 });
    });

    const localAddress = socket.localAddress;
    if (!localAddress || localAddress.includes(":")) throw new Error("ICSP client registration requires an IPv4 network connection.");
    const ip = Buffer.from(localAddress.split(".").map((part) => Number(part)));
    const registration = Buffer.concat([Buffer.from([0, 0, 2, 4]), ip]);
    await send(frameBytes(0x20, addressBytes({ device: 0, port: 0, system: 0 }), addressBytes({ device: 1, port: 1, system: 0 }), 1, COMMAND_REGISTER, registration));

    let lease: Frame | undefined;
    for (let count = 0; count < 8; count += 1) {
      const candidate = await nextFrame(5000);
      if (candidate.command === COMMAND_REGISTER_ACK) { lease = candidate; break; }
    }
    if (!lease || lease.data.length < 4) throw new Error("NetLinx did not assign a temporary ICSP client address.");
    await send(frameBytes(0x01, lease.source, lease.destination, lease.messageId, COMMAND_ACK));
    const device = lease.data.readUInt16BE(0);
    const system = lease.data.readUInt16BE(2);
    const clientAddress = addressBytes({ device, port: 1, system });
    let messageId = 1;
    return {
      socket, clientAddress, masterAddress: lease.source, nextFrame,
      sendCommand: async (command, data: Buffer = Buffer.alloc(0)) => {
        messageId = (messageId + 1) & 0xffff;
        const id = messageId || 1;
        await send(frameBytes(0, lease!.source, clientAddress, id, command, data));
        return id;
      },
    };
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

function channelData(address: Address, channel: number) {
  if (!Number.isInteger(channel) || channel < 1 || channel > 65535) throw new Error("The requested ICSP channel is invalid.");
  const data = Buffer.alloc(8);
  data.writeUInt16BE(address.device, 0);
  data.writeUInt16BE(address.port, 2);
  data.writeUInt16BE(address.system, 4);
  data.writeUInt16BE(channel, 6);
  return data;
}

/** Sends an ICSP input-channel PUSH followed by RELEASE without changing NetLinx settings. */
export async function pulseIcspChannel(host: string, address: Address, channel: number) {
  const data = channelData(address, channel);
  const session = await openIcspSession(host);
  let pushed = false;
  try {
    await session.sendCommand(COMMAND_CHANNEL_PUSH, data);
    pushed = true;
    await new Promise((resolve) => setTimeout(resolve, 150));
  } finally {
    try {
      if (pushed && !session.socket.destroyed) await session.sendCommand(COMMAND_CHANNEL_RELEASE, data);
    } finally {
      session.socket.destroy();
    }
  }
}

function readNumericValue(type: number, value: Buffer): number | null {
  if (type === 0x10 && value.length >= 1) return value.readUInt8(0);
  if (type === 0x11 && value.length >= 2) return value.readInt16BE(0);
  if (type === 0x20 && value.length >= 2) return value.readUInt16BE(0);
  if (type === 0x21 && value.length >= 4) return value.readInt32BE(0);
  if (type === 0x40 && value.length >= 4) return value.readFloatBE(0);
  if (type === 0x41 && value.length >= 8) return value.readDoubleBE(0);
  if (type === 0x4f && value.length >= 4) return value.readUInt32BE(0);
  if (type === 0x8f && value.length >= 8) return Number(value.readBigInt64BE(0));
  return null;
}

/** Read level values from an existing NetLinx device via ICSP. */
export async function readIcspDeviceLevels(host: string, target: Address, requestedLevels: number[]) {
  if (!requestedLevels.length || requestedLevels.some((level) => !Number.isInteger(level) || level < 1 || level > 65535)) {
    throw new Error("The requested ICSP levels are invalid.");
  }
  const session = await openIcspSession(host);
  try {
    const targetData = Buffer.alloc(6);
    targetData.writeUInt16BE(target.device, 0);
    targetData.writeUInt16BE(target.port, 2);
    targetData.writeUInt16BE(target.system, 4);
    await session.sendCommand(COMMAND_DEVICE_STATUS, targetData);

    const levels: Record<number, number> = {};
    const deadline = Date.now() + 11000;
    while (Date.now() < deadline) {
      const frame = await session.nextFrame(Math.min(3000, Math.max(1, deadline - Date.now())));
      if (frame.command === COMMAND_LEVEL_VALUE && frame.data.length >= 10) {
        const deviceId = frame.data.readUInt16BE(0);
        const port = frame.data.readUInt16BE(2);
        const systemId = frame.data.readUInt16BE(4);
        const level = frame.data.readUInt16BE(6);
        const value = readNumericValue(frame.data[8]!, frame.data.subarray(9));
        if (deviceId === target.device && port === target.port && systemId === target.system && requestedLevels.includes(level) && value !== null && Number.isFinite(value)) {
          levels[level] = value;
        }
      }
      if (frame.command === COMMAND_DEVICE_STATUS_END || frame.command === COMMAND_NAK) break;
    }
    const missing = requestedLevels.filter((level) => levels[level] === undefined);
    if (missing.length) throw new Error(`ICSP status did not include level${missing.length === 1 ? "" : "s"} ${missing.join(", ")}.`);
    return levels;
  } finally {
    session.socket.destroy();
  }
}
