import { createSocket } from "node:dgram";
import { networkInterfaces } from "node:os";
import { createConnection } from "node:net";

const host = process.env.BMD_CONVERTER_DS700_HOST?.trim();
const port = Number(process.env.BMD_CONVERTER_DS700_PORT || "19540");
let activeSession = null;
let activeSessionModel = null;
let nextSequence = 0;
let operationQueue = Promise.resolve();

const converterProductNames = {
  "mini-converter-audio-to-sdi": "Blackmagic Design Mini Converter Audio to SDI",
  "mini-converter-sdi-to-audio": "Blackmagic Design Mini Converter SDI to Audio",
};
const sdiToAudioRegisters = new Map([
  [0x0014, 0x0500], [0x0018, 0x0600], [0x001c, 0x0700], [0x0020, 0x0800], [0x0024, 0x0900],
]);

function isSdiToAudio(converterId) { return converterId === "mini-converter-sdi-to-audio"; }

function responseDetails(response, converterId) {
  const rawText = response.toString("latin1");
  const productName = converterProductNames[converterId];
  const converter = productName
    ? new RegExp(`((?:usb\\d+-\\d{3}:\\d))\\x00${productName}`, "i").exec(rawText)
    : null;
  const responseText = rawText.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  return {
    configured: true,
    host,
    port,
    deviceFound: Boolean(converter),
    deviceName: converter?.[1],
    responseText: responseText.slice(0, 4_000),
    responseHex: response.subarray(0, 2_000).toString("hex").match(/.{1,2}/g)?.join(" ") ?? "",
  };
}

function makeUdpRequest(command, sequence = 1) {
  const packet = Buffer.alloc(88);
  packet.writeUInt16BE(sequence, 0);
  packet.writeUInt16BE(1, 2);
  packet.write(command, 4, "ascii");
  // The gateway's 128-byte snaplen hid this final word. Recovered from
  // the UDP checksum in capture 1792993635333, frames 393 and 395.
  packet.writeUInt16BE(0x0200, 86);
  return packet;
}

function makeDeviceListRequest(sequence, offset) {
  const packet = makeUdpRequest("GET USB_DEVICE_LIST_III", sequence);
  packet.writeUInt16BE(offset, 84);
  return packet;
}

function makeDeviceListAck(offset) {
  const packet = makeUdpRequest("GET USB_DEVICE_LIST_III", 3);
  packet.writeUInt16BE(1, 2);
  packet.writeUInt16BE(offset, 84);
  return packet;
}

function makeServerInfoRequest() {
  const packet = Buffer.alloc(88);
  packet.writeUInt16BE(0x0004, 0);
  packet.writeUInt16BE(0x9506, 2);
  return packet;
}

function createUdpChannel() {
  const channelSocket = createSocket("udp4");
  let pending = null;
  let rejectReady;
  const ready = new Promise((resolve, reject) => {
    rejectReady = reject;
    channelSocket.once("listening", resolve);
  });
  channelSocket.on("message", (response, remote) => {
    if (!pending || remote.port !== port || (host && remote.address !== host)) return;
    const current = pending;
    pending = null;
    clearTimeout(current.timer);
    if (current.retryTimer) clearInterval(current.retryTimer);
    current.resolve(response);
  });
  channelSocket.on("error", (error) => {
    if (!pending) { rejectReady(error); return; }
    const current = pending;
    pending = null;
    clearTimeout(current.timer);
    if (current.retryTimer) clearInterval(current.retryTimer);
    current.reject(error);
  });
  channelSocket.bind(0);

  return {
    async exchange(packet, timeoutMs = 2_000, retryIntervalMs = 0, phase = "UDP request") {
      await ready;
      if (pending) throw new Error("A DS-700 request is already in progress on this UDP channel.");
      return new Promise((resolve, reject) => {
        const send = () => channelSocket.send(packet, port, host, (error) => {
          if (!error || !pending) return;
          const current = pending;
          pending = null;
          clearTimeout(current.timer);
          if (current.retryTimer) clearInterval(current.retryTimer);
          current.reject(error);
        });
        const timer = setTimeout(() => {
          if (pending?.retryTimer) clearInterval(pending.retryTimer);
          pending = null;
          reject(new Error(`Timed out waiting for the DS-700 ${phase} response from ${host}:${port}.`));
        }, timeoutMs);
        const retryTimer = retryIntervalMs > 0 ? setInterval(() => { if (pending) send(); }, retryIntervalMs) : null;
        pending = { resolve, reject, timer, retryTimer };
        send();
      });
    },
    close() {
      if (pending) {
        const current = pending;
        pending = null;
        clearTimeout(current.timer);
        if (current.retryTimer) clearInterval(current.retryTimer);
        current.reject(new Error("The DS-700 UDP channel closed."));
      }
      channelSocket.close();
    },
  };
}

async function discover(converterId) {
  if (!host) throw new Error("The DS-700 address is not configured.");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("BMD_CONVERTER_DS700_PORT must be a valid UDP port.");
  const discoveryChannel = createUdpChannel();
  const listPages = [];
  let offset = 0;
  let response;
  try {
    let complete = false;
    for (let page = 0; page < 64; page++) {
      response = await discoveryChannel.exchange(
        makeDeviceListRequest(page === 0 ? 1 : 2, offset),
        page === 0 ? 5_000 : 2_000,
        page === 0 ? 2_000 : 0,
        "USB device-list",
      );
      if (response.length < 8) throw new Error("The DS-700 returned a truncated USB device-list page.");
      const pageLength = response.readUInt16BE(6);
      const pageOffset = response.readUInt16BE(4);
      if (pageOffset !== offset || pageLength > response.length - 8) {
        throw new Error("The DS-700 returned an invalid USB device-list page.");
      }
      if (pageLength) listPages.push(response.subarray(8, 8 + pageLength));
      offset += pageLength;
      if (response.readUInt16BE(2) === 0) {
        complete = true;
        break;
      }
      if (!pageLength || offset > 0xffff) throw new Error("The DS-700 USB device list did not advance to its next page.");
    }
    if (!complete) throw new Error("The DS-700 USB device list exceeded the supported page count.");
    await discoveryChannel.exchange(makeDeviceListAck(offset), 2_000, 0, "USB device-list acknowledgement");
  } finally {
    discoveryChannel.close();
  }
  // USB device discovery is the prerequisite for converter access. Server-info
  // is useful metadata, but some DS-700 sessions answer the device-list
  // exchange while ignoring an independent server-info probe.
  let serverInfo = Buffer.alloc(0);
  const infoChannel = createUdpChannel();
  try { serverInfo = await infoChannel.exchange(makeServerInfoRequest(), 1_000, 0, "server-info"); } catch {}
  finally { infoChannel.close(); }
  const result = responseDetails(Buffer.concat(listPages), converterId);
  const serverInfoText = serverInfo.toString("latin1").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  return { ...result, serverInfo: serverInfoText.slice(0, 512) };
}

function ipv4Bytes(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    throw new Error("Could not determine the local IPv4 address for the DS-700 connection.");
  }
  return Buffer.from(parts);
}

async function localNetworkIdentity() {
  const localAddress = await new Promise((resolve, reject) => {
    const probe = createSocket("udp4");
    probe.once("error", (error) => { probe.close(); reject(error); });
    probe.bind(0, () => probe.connect(port, host, () => {
      const address = probe.address().address;
      probe.close();
      resolve(address);
    }));
  });
  const configuredMac = process.env.BMD_CONVERTER_CLIENT_MAC?.trim();
  if (configuredMac) {
    if (!/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(configuredMac) || configuredMac === "00:00:00:00:00:00") {
      throw new Error("BMD_CONVERTER_CLIENT_MAC must be a non-zero MAC address in colon-separated format.");
    }
    return { address: localAddress, mac: Buffer.from(configuredMac.split(":").map((part) => Number.parseInt(part, 16))) };
  }
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if ((entry.family !== "IPv4" && entry.family !== 4) || entry.address !== localAddress || !entry.mac || entry.mac === "00:00:00:00:00:00") continue;
      return { address: localAddress, mac: Buffer.from(entry.mac.split(":").map((part) => Number.parseInt(part, 16))) };
    }
  }
  throw new Error(`Could not find a network adapter for local address ${localAddress}.`);
}

function makeConnectInfoRequest(sequence, identity, deviceName, acknowledged = false) {
  // The gateway saved only the first 86 payload bytes. UDP length fields
  // show 510 bytes for attach and 88 for its ACK. The ACK's missing word
  // is 0x0200 (recoverable from its checksum). Zero extension of that
  // 88-byte request also matches the captured attach checksum; the full
  // attach tail has not been captured and remains an inference.
  const packet = Buffer.alloc(acknowledged ? 88 : 510);
  packet.writeUInt16BE(0x0200, 86);
  packet.writeUInt16BE(sequence, 0);
  packet.writeUInt16BE(1, 2);
  const command = Buffer.from("GET USBDS_CONNECTINFO:", "ascii");
  command.copy(packet, 4);
  let offset = 4 + command.length;
  packet[offset++] = 0x02;
  packet[offset++] = 0x06;
  identity.mac.copy(packet, offset, 0, 6);
  offset += 6;
  ipv4Bytes(identity.address).copy(packet, offset);
  offset += 4;
  offset += Buffer.from(deviceName, "ascii").copy(packet, offset);
  packet[offset++] = 0;
  packet[offset++] = 0x4c;
  packet[offset++] = 0x54;
  if (acknowledged) packet.writeUInt16BE(0x0403, 84);
  return packet;
}

function requestFrame(magic, sequence, setup, length, data = Buffer.alloc(0)) {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(magic, 0);
  header.writeUInt16BE(sequence, 2);
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(0x0200, 6);
  header.writeUInt16BE(0x0215, 8);
  header.writeUInt16BE(8, 10);
  const transferLength = Buffer.alloc(2);
  transferLength.writeUInt16BE(length, 0);
  return Buffer.concat([header, setup, transferLength, data]);
}

function setupPacket(requestType, request, value = 0, index = 0) {
  const setup = Buffer.alloc(8);
  setup[0] = requestType;
  setup[1] = request;
  setup.writeUInt16BE(value, 2);
  setup.writeUInt16BE(index, 4);
  return setup;
}

function queueReader(connection) {
  let buffer = Buffer.alloc(0);
  let ended = null;
  const waiters = [];
  function drain() {
    while (waiters.length && buffer.length >= waiters[0].length) {
      const waiter = waiters.shift();
      const result = buffer.subarray(0, waiter.length);
      buffer = buffer.subarray(waiter.length);
      clearTimeout(waiter.timer);
      waiter.resolve(result);
    }
    if (ended) {
      while (waiters.length) {
        const waiter = waiters.shift();
        clearTimeout(waiter.timer);
        waiter.reject(ended);
      }
    }
  }
  connection.on("data", (chunk) => { buffer = Buffer.concat([buffer, chunk]); drain(); });
  connection.on("error", (error) => { ended = error; drain(); });
  connection.on("close", () => { ended ??= new Error("The DS-700 USB tunnel closed."); drain(); });
  return (length, timeoutMs = 8_000) => new Promise((resolve, reject) => {
    const waiter = {
      length,
      resolve,
      reject,
      timer: setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index !== -1) waiters.splice(index, 1);
        reject(new Error("Timed out waiting for a DS-700 USB tunnel response."));
      }, timeoutMs),
    };
    waiters.push(waiter);
    drain();
  });
}

async function connectTcp() {
  const connection = createConnection({ host, port });
  await new Promise((resolve, reject) => {
    connection.once("connect", resolve);
    connection.once("error", reject);
    connection.setTimeout(10_000, () => connection.destroy(new Error("Timed out opening the DS-700 USB tunnel.")));
  });
  connection.setTimeout(0);
  return { connection, read: queueReader(connection) };
}

async function exchangeUsb(session, magic, sequence, setup, length, data = Buffer.alloc(0)) {
  const frame = requestFrame(magic, sequence, setup, length, data);
  session.connection.write(frame);
  const header = await session.read(10);
  if (header.readUInt16BE(0) !== magic) throw new Error("The DS-700 returned an unexpected USB response header.");
  const status = header.readUInt32BE(4);
  if (status !== 0) {
    const hex = (value) => `0x${value.toString(16).padStart(4, "0")}`;
    const error = new Error(`The DS-700 rejected USB control request type ${hex(setup[0])}, request ${hex(setup[1])}, value ${hex(setup.readUInt16BE(2))}, index ${hex(setup.readUInt16BE(4))} (status 0x${status.toString(16)}).`);
    Object.assign(error, { code: "USB_CONTROL_REJECTED", requestType: setup[0], request: setup[1], status });
    throw error;
  }
  const returnedSequence = header.readUInt16BE(2);
  if (returnedSequence !== sequence) throw new Error("The DS-700 USB response sequence did not match the request.");
  const responseLength = header.readUInt16BE(8);
  return responseLength ? session.read(responseLength) : Buffer.alloc(0);
}

async function openUsbSession(converterId) {
  const discovered = await discover(converterId);
  if (!discovered.deviceFound || !discovered.deviceName) throw new Error(`${converterProductNames[converterId] ?? "The selected converter"} was not found on the DS-700.`);
  const identity = await localNetworkIdentity();
  const deviceName = discovered.deviceName;
  const attachChannel = createUdpChannel();
  let connectReply;
  try {
    connectReply = await attachChannel.exchange(makeConnectInfoRequest(1, identity, deviceName), 2_000, 0, "USB attach");
    await attachChannel.exchange(makeConnectInfoRequest(3, identity, deviceName, true), 2_000, 0, "USB attach acknowledgement");
  } finally {
    attachChannel.close();
  }
  if (!connectReply.includes(Buffer.from("OK"))) throw new Error("The DS-700 did not accept the USB client attach request.");

  const session = await connectTcp();
  nextSequence = 0;
  try {
    const descriptorReads = [
      [1, 0, 0x0012], [2, 0, 0x0009], [2, 0, 0x0020],
      [3, 0, 0x00ff], [3, 1, 0x00ff], [3, 2, 0x00ff], [3, 3, 0x00ff],
    ];
    for (const [descriptorType, descriptorIndex, length] of descriptorReads) {
      const setup = setupPacket(0x80, 0x06, (descriptorType << 8) | descriptorIndex,
        descriptorType === 3 && descriptorIndex !== 0 ? 0x0409 : 0);
      await exchangeUsb(session, 0x0001, nextSequence++, setup, length);
    }
    if (isSdiToAudio(converterId)) {
      // SDI-to-Audio exposes bulk endpoint 0x02 and uses the D6/D7 vendor API.
      await exchangeUsb(session, 0x8001, nextSequence++, setupPacket(0x02, 0x01, 0, 0x0002), 0);
      await exchangeUsb(session, 0x0001, nextSequence++, setupPacket(0xc0, 0xe1), 1);
    } else {
      await exchangeUsb(session, 0x8001, nextSequence++, setupPacket(0x02, 0x01, 0, 0x0001), 0);
      await exchangeUsb(session, 0x8001, nextSequence++, setupPacket(0x02, 0x01, 0, 0x0082), 0);
    try {
      // This one-byte vendor GET is a capability probe; its result is unused.
      // Some converter/Silex combinations reject it even though level requests work.
      await exchangeUsb(session, 0x0001, nextSequence++, setupPacket(0xc1, 0x10), 1);
    } catch (error) {
      if (!(error && error.code === "USB_CONTROL_REJECTED" && error.requestType === 0xc1 && error.request === 0x10)) throw error;
    }
    await exchangeUsb(session, 0x8001, nextSequence++, setupPacket(0x41, 0x50), 0);
    await exchangeUsb(session, 0x0001, nextSequence++, setupPacket(0xc1, 0x53), 1);
    await exchangeUsb(session, 0x0001, nextSequence++, setupPacket(0xc1, 0x11), 8);
    await exchangeUsb(session, 0x0001, nextSequence++, setupPacket(0xc1, 0x53), 1);
    for (const value of [0x003c, 0x0014, 0x0018, 0x001c, 0x0020]) {
      await exchangeUsb(session, 0x0001, nextSequence++, setupPacket(0xc1, 0x53, value), 1);
    }
    }
    activeSession = session;
    activeSessionModel = converterId;
    return session;
  } catch (error) {
    session.connection.destroy();
    throw error;
  }
}

async function getUsbSession(converterId) {
  if (activeSession && activeSessionModel === converterId && !activeSession.connection.destroyed) return activeSession;
  if (activeSession && activeSessionModel !== converterId) {
    const previousConnection = activeSession.connection;
    activeSession = null;
    activeSessionModel = null;
    if (!previousConnection.destroyed) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 1_500);
        previousConnection.once("close", () => { clearTimeout(timer); resolve(); });
        previousConnection.destroy();
      });
      // Allow the DS-700 to release its exclusive USB attachment before the
      // next converter is attached, especially across the Seewinkel VPN path.
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  activeSession = null;
  activeSessionModel = null;
  return openUsbSession(converterId);
}

async function readAesLevel(converterId) {
  try {
    const session = await getUsbSession(converterId);
    const response = await readRawLevel(session, converterId, 0x0024);
    if (response.length !== 1) throw new Error("The DS-700 returned an unexpected AES/EBU level response.");
    return { configured: true, host, port, level: response[0], format: "raw-device-code" };
  } catch (error) {
    activeSession?.connection.destroy();
    activeSession = null;
    throw error;
  }
}

async function readAudioLevels(converterId) {
  try {
    const session = await getUsbSession(converterId);
    const registers = {};
    for (const value of [0x0014, 0x0018, 0x001c, 0x0020, 0x0024]) {
      const response = await readRawLevel(session, converterId, value);
      if (response.length !== 1) throw new Error(`The DS-700 returned an unexpected level response for register 0x${value.toString(16)}.`);
      registers[`0x${value.toString(16).padStart(4, "0")}`] = response[0];
    }
    return { configured: true, host, port, registers, format: "raw-device-code" };
  } catch (error) {
    activeSession?.connection.destroy();
    activeSession = null;
    throw error;
  }
}

async function readRawLevel(session, converterId, register) {
  const setup = isSdiToAudio(converterId)
    ? setupPacket(0xc0, 0xd6, 0, sdiToAudioRegisters.get(register))
    : setupPacket(0xc1, 0x53, register);
  const response = await exchangeUsb(session, 0x0001, nextSequence++, setup, 1);
  if (response.length !== 1) throw new Error(`The DS-700 returned an unexpected level response for register 0x${register.toString(16)}.`);
  return response;
}

async function writeRawLevel(session, converterId, register, level) {
  if (isSdiToAudio(converterId)) {
    const deviceIndex = sdiToAudioRegisters.get(register);
    if (deviceIndex === undefined) throw new Error(`No SDI-to-Audio register mapping exists for 0x${register.toString(16)}.`);
    // Captured SDI-to-Audio writes encode the raw level in wIndex and carry no data stage.
    return exchangeUsb(session, 0x8001, nextSequence++, setupPacket(0x40, 0xd7, 0, deviceIndex + level), 0);
  }
  const payload = Buffer.alloc(4);
  payload.writeUInt32LE(level, 0);
  return exchangeUsb(session, 0x8001, nextSequence++, setupPacket(0x41, 0x52, register), 4, payload);
}

async function setAesLevel(level, converterId) {
  if (!Number.isInteger(level) || level < 0x00 || level > 0xff) throw new Error("AES/EBU level must be an integer from 0 to 255, the range observed in the capture.");
  try {
    const session = await getUsbSession(converterId);
    await writeRawLevel(session, converterId, 0x0024, level);
    const verified = await readAesLevel(converterId);
    if (verified.level !== level) throw new Error(`The DS-700 acknowledged the write, but reports AES/EBU level ${verified.level} instead of ${level}.`);
    return { ...verified, applied: true };
  } catch (error) {
    activeSession?.connection.destroy();
    activeSession = null;
    throw error;
  }
}

async function setAnalogLevels(levels, converterId) {
  const channels = [
    { name: "ch1", register: 0x0014 },
    { name: "ch2", register: 0x0018 },
    { name: "ch3", register: 0x001c },
    { name: "ch4", register: 0x0020 },
  ];
  if (!Array.isArray(levels) || levels.length !== channels.length || levels.some((level) => !Number.isInteger(level) || level < 0 || level > 0xff)) {
    throw new Error("Four analog raw levels from 0 through 255 are required.");
  }
  try {
    const session = await getUsbSession(converterId);
    const result = {};
    for (const [index, channel] of channels.entries()) {
      const level = levels[index];
      await writeRawLevel(session, converterId, channel.register, level);
      const response = await readRawLevel(session, converterId, channel.register);
      if (response.length !== 1 || response[0] !== level) {
        throw new Error(`The DS-700 did not verify analog ${channel.name} level ${level}.`);
      }
      result[channel.name] = { raw: response[0], applied: true };
    }
    return { configured: true, host, port, channels: result, format: "raw-device-code" };
  } catch (error) {
    activeSession?.connection.destroy();
    activeSession = null;
    throw error;
  }
}

process.send?.({ type: "worker-ready" });
process.on("message", (message) => {
  if (!message || typeof message !== "object" || typeof message.id !== "string") return;
  const operation = message.operation;
  const converterId = message.converterId;
  if (!converterProductNames[converterId]) {
    process.send?.({ type: "response", id: message.id, error: "Unsupported BMD Mini Converter model." });
    return;
  }
  let action;
  if (operation === "discover") action = () => discover(converterId);
  else if (operation === "read-aes-level") action = () => readAesLevel(converterId);
  else if (operation === "read-audio-levels") action = () => readAudioLevels(converterId);
  else if (operation === "set-aes-level") action = () => setAesLevel(message.level, converterId);
  else if (operation === "set-analog-levels") action = () => setAnalogLevels(message.levels, converterId);
  else return;
  operationQueue = operationQueue.then(async () => {
    try {
      const result = await action();
      process.send?.({ type: "response", id: message.id, result });
    } catch (error) {
      process.send?.({ type: "response", id: message.id, error: error instanceof Error ? error.message : "DS-700 operation failed." });
    }
  });
});

process.on("disconnect", () => {
  activeSession?.connection.destroy();
  process.exit(0);
});
