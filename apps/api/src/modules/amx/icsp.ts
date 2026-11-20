import { Socket } from "node:net";

type DeviceAddress = { device: number; port: number; system: number };
type IcspFrame = {
  flags: number;
  destination: DeviceAddress;
  source: DeviceAddress;
  messageId: number;
  command: number;
  data: Buffer;
};

const PROTOCOL = 0x02;
const FLAG_RESPONSE = 0x01;
const FLAG_NEWBEE = 0x20;
const COMMAND_ACK = 0x0001;
const COMMAND_NAK = 0x0002;
const COMMAND_DEVICE_INFO = 0x0097;
const COMMAND_DYNAMIC_DEVICE_ADDRESS = 0x0503;
const COMMAND_REQUEST_DYNAMIC_DEVICE = 0x0583;
const COMMAND_INPUT_CHANNEL_ON = 0x0084;
const COMMAND_INPUT_CHANNEL_OFF = 0x0085;
const HOP_COUNT = 0x0f;
const MASTER_ADDRESS: DeviceAddress = { device: 0, port: 0, system: 0 };

function addressBytes(address: DeviceAddress) {
  const bytes = Buffer.alloc(6);
  bytes.writeUInt16BE(address.system, 0);
  bytes.writeUInt16BE(address.device, 2);
  bytes.writeUInt16BE(address.port, 4);
  return bytes;
}

function describeAddress(address: DeviceAddress) {
  return `${address.device}:${address.port}:${address.system}`;
}

function describeFrame(frame: IcspFrame) {
  return `command 0x${frame.command.toString(16).padStart(4, "0")}, message ${frame.messageId}, source ${describeAddress(frame.source)}, destination ${describeAddress(frame.destination)}`;
}

function frameBytes(frame: IcspFrame) {
  const payload = Buffer.alloc(19 + frame.data.length);
  payload[0] = PROTOCOL;
  payload[1] = frame.flags;
  addressBytes(frame.destination).copy(payload, 2);
  addressBytes(frame.source).copy(payload, 8);
  payload[14] = HOP_COUNT;
  payload.writeUInt16BE(frame.messageId, 15);
  payload.writeUInt16BE(frame.command, 17);
  frame.data.copy(payload, 19);

  const packet = Buffer.alloc(payload.length + 4);
  packet[0] = PROTOCOL;
  packet.writeUInt16BE(payload.length, 1);
  payload.copy(packet, 3);
  let checksum = 0;
  for (let index = 0; index < packet.length - 1; index += 1) checksum = (checksum + packet[index]) & 0xff;
  packet[packet.length - 1] = checksum;
  return packet;
}

function decodeFrame(packet: Buffer): IcspFrame {
  const length = packet.readUInt16BE(1);
  if (packet[0] !== PROTOCOL || packet.length !== length + 4 || packet[3] !== PROTOCOL) {
    throw new Error("The AMX master returned an invalid ICSP frame.");
  }
  let checksum = 0;
  for (let index = 0; index < packet.length - 1; index += 1) checksum = (checksum + packet[index]) & 0xff;
  if (checksum !== packet[packet.length - 1]) throw new Error("The AMX master returned an ICSP frame with an invalid checksum.");

  const payload = packet.subarray(3, packet.length - 1);
  if (payload.length < 19) throw new Error("The AMX master returned a truncated ICSP frame.");
  const readAddress = (offset: number): DeviceAddress => ({
    system: payload.readUInt16BE(offset),
    device: payload.readUInt16BE(offset + 2),
    port: payload.readUInt16BE(offset + 4),
  });
  return {
    flags: payload[1],
    destination: readAddress(2),
    source: readAddress(8),
    messageId: payload.readUInt16BE(15),
    command: payload.readUInt16BE(17),
    data: payload.subarray(19),
  };
}

class IcspConnection {
  private buffer = Buffer.alloc(0);
  private readonly frames: IcspFrame[] = [];
  private readonly waiters: Array<{ resolve: (frame: IcspFrame) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }> = [];
  private failure?: Error;
  readonly socket = new Socket();

  constructor() {
    this.socket.on("data", (chunk) => this.consume(chunk));
    this.socket.on("error", (error) => this.fail(new Error(`Could not reach the AMX master over ICSP: ${error.message}`)));
    this.socket.on("close", () => this.fail(new Error("The AMX master closed the ICSP connection.")));
  }

  connect(host: string, port: number) {
    return new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => { this.socket.off("connect", onConnect); reject(new Error(`Could not reach the AMX master over ICSP: ${error.message}`)); };
      const onConnect = () => { this.socket.off("error", onError); resolve(); };
      this.socket.once("error", onError);
      this.socket.once("connect", onConnect);
      this.socket.connect(port, host);
    });
  }

  send(frame: IcspFrame) {
    return new Promise<void>((resolve, reject) => {
      this.socket.write(frameBytes(frame), (error) => error ? reject(error) : resolve());
    });
  }

  nextFrame(timeoutMs: number) {
    if (this.frames.length) return Promise.resolve(this.frames.shift()!);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise<IcspFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((waiter) => waiter.timer === timer);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error("ICSP receive timed out."));
      }, timeoutMs);
      this.waiters.push({ resolve, reject, timer });
    });
  }

  close() { this.socket.destroy(); }

  private consume(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      if (this.buffer[0] !== PROTOCOL) return this.fail(new Error("The AMX master sent data outside the ICSP frame format."));
      const length = this.buffer.readUInt16BE(1);
      if (length < 19 || length > 4096) return this.fail(new Error("The AMX master sent an unsupported ICSP frame length."));
      const packetLength = length + 4;
      if (this.buffer.length < packetLength) return;
      const packet = this.buffer.subarray(0, packetLength);
      this.buffer = this.buffer.subarray(packetLength);
      let frame: IcspFrame;
      try { frame = decodeFrame(packet); }
      catch (error) { return this.fail(error instanceof Error ? error : new Error("Could not decode the AMX ICSP response.")); }
      const waiter = this.waiters.shift();
      if (waiter) { clearTimeout(waiter.timer); waiter.resolve(frame); }
      else this.frames.push(frame);
    }
  }

  private fail(error: Error) {
    if (this.failure) return;
    this.failure = error;
    for (const waiter of this.waiters.splice(0)) { clearTimeout(waiter.timer); waiter.reject(error); }
  }
}

async function ackIncoming(connection: IcspConnection, frame: IcspFrame, source: DeviceAddress) {
  await connection.send({
    flags: FLAG_RESPONSE,
    destination: frame.source,
    source,
    messageId: frame.messageId,
    command: COMMAND_ACK,
    data: Buffer.alloc(0),
  });
}

async function waitForReply(
  connection: IcspConnection,
  expected: { messageId?: number; commands: number[]; description?: string },
  timeoutMs: number,
  deviceInfoSource: DeviceAddress,
) {
  const deadline = Date.now() + timeoutMs;
  const observed: string[] = [];
  while (Date.now() < deadline) {
    let frame: IcspFrame;
    try { frame = await connection.nextFrame(deadline - Date.now()); }
    catch (error) {
      if (error instanceof Error && error.message !== "ICSP receive timed out.") throw error;
      const details = observed.length ? ` Received: ${observed.slice(0, 5).join("; ")}.` : " No ICSP frames were received.";
      throw new Error(`The AMX master did not reply to ${expected.description ?? `ICSP message ${expected.messageId}`}.${details}`);
    }

    observed.push(describeFrame(frame));

    // Device information can arrive asynchronously while a request is pending;
    // acknowledge it without mistaking it for the requested reply.
    if (frame.command === COMMAND_DEVICE_INFO) {
      await ackIncoming(connection, frame, deviceInfoSource);
      continue;
    }
    // Dynamic-address replies are tied to the only 0x0583 request on this new
    // socket. Some NetLinx firmware versions do not echo the request message
    // ID, so identify that reply by command instead of rejecting the lease.
    const messageIdMatches = expected.messageId === undefined || frame.messageId === expected.messageId;
    if (!messageIdMatches) {
      if (expected.commands.includes(frame.command)) {
        throw new Error(`The AMX master replied with ${describeFrame(frame)}, but ICSP message ${expected.messageId} was expected.`);
      }
      continue;
    }
    if (frame.command === COMMAND_NAK) {
      throw new Error(`The AMX master rejected ICSP message ${expected.messageId}.`);
    }
    if (expected.commands.includes(frame.command)) return frame;
  }
  const details = observed.length ? ` Received: ${observed.slice(0, 5).join("; ")}.` : " No ICSP frames were received.";
  throw new Error(`The AMX master did not reply to ${expected.description ?? `ICSP message ${expected.messageId}`}.${details}`);
}

async function registerDynamicDevice(connection: IcspConnection, host: string) {
  const localAddress = connection.socket.localAddress?.replace(/^::ffff:/, "");
  if (!localAddress) throw new Error("The local IP address for the AMX ICSP connection is unavailable.");
  const localIp = localAddress.split(".").map(Number);
  if (localIp.length !== 4 || localIp.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    throw new Error("ICSP dynamic registration requires an IPv4 connection.");
  }
  const ipData = Buffer.from(localIp);
  const requestData = Buffer.alloc(8);
  requestData.writeUInt16BE(0, 0); // Ask the master for the next available temporary device number.
  requestData[2] = 0x02; // Extended address type: IPv4.
  requestData[3] = 4;
  ipData.copy(requestData, 4);
  await connection.send({
    flags: FLAG_NEWBEE,
    destination: { device: 0, port: 0, system: 0 },
    source: { device: 0, port: 1, system: 0 },
    messageId: 1,
    command: COMMAND_REQUEST_DYNAMIC_DEVICE,
    data: requestData,
  });

  const frame = await waitForReply(connection, {
    commands: [COMMAND_DYNAMIC_DEVICE_ADDRESS],
    description: "a temporary ICSP device address",
  }, 5000, { device: 0, port: 1, system: 0 });
  if (frame.data.length < 4) throw new Error("The AMX master returned a truncated dynamic ICSP address.");
  const device = frame.data.readUInt16BE(0);
  const system = frame.data.readUInt16BE(2);
  // AMX reserves 32001–32767 for temporary device numbers. Reject malformed
  // leases rather than sending channel pushes under an invalid identity.
  if (device < 32001 || device > 32767 || system === 0) {
    throw new Error(`The AMX master returned an invalid temporary ICSP address (${device}:1:${system}).`);
  }
  const address = { device, system, port: frame.destination.port || 1 };
  await ackIncoming(connection, frame, address);
  return address;
}

export async function pulseChannel(host: string, port: number, address: DeviceAddress, channel: number) {
  if (!Number.isInteger(address.device) || address.device < 0 || address.device > 65535
    || !Number.isInteger(address.port) || address.port < 0 || address.port > 65535
    || !Number.isInteger(address.system) || address.system < 0 || address.system > 65535
    || !Number.isInteger(channel) || channel < 1 || channel > 65535) {
    throw new Error("The requested AMX device address or channel is invalid.");
  }
  const connection = new IcspConnection();
  try {
    await connection.connect(host, port);
    const initialAddress: DeviceAddress = { device: 0, port: 1, system: 0 };
    const startupDeadline = Date.now() + 1200;
    let receivedStartupFrame = false;
    while (Date.now() < startupDeadline) {
      let frame: IcspFrame;
      try { frame = await connection.nextFrame(receivedStartupFrame ? 150 : startupDeadline - Date.now()); }
      catch { break; }
      receivedStartupFrame = true;
      if (frame.command === COMMAND_DEVICE_INFO) await ackIncoming(connection, frame, initialAddress);
    }

    const dynamicAddress = await registerDynamicDevice(connection, host);
    const channelData = Buffer.alloc(8);
    channelData.writeUInt16BE(address.device, 0);
    channelData.writeUInt16BE(address.port, 2);
    channelData.writeUInt16BE(address.system, 4);
    channelData.writeUInt16BE(channel, 6);
    const master = { device: MASTER_ADDRESS.device, port: MASTER_ADDRESS.port, system: dynamicAddress.system };
    const messageId = 2;
    await connection.send({ flags: 0, destination: master, source: dynamicAddress, messageId, command: COMMAND_INPUT_CHANNEL_ON, data: channelData });
    let onError: unknown;
    try {
      await waitForReply(connection, { messageId, commands: [COMMAND_ACK] }, 2500, dynamicAddress);
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (error) {
      onError = error;
    }
    // Always send RELEASE after PUSH, even if its ACK was lost. That prevents
    // an uncertain network response from leaving the NetLinx input held ON.
    await connection.send({ flags: 0, destination: master, source: dynamicAddress, messageId: messageId + 1, command: COMMAND_INPUT_CHANNEL_OFF, data: channelData });
    await waitForReply(connection, { messageId: messageId + 1, commands: [COMMAND_ACK] }, 2500, dynamicAddress);
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (onError) throw onError;
  } finally {
    connection.close();
  }
}
