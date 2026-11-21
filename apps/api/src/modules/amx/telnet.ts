import { Socket } from "node:net";

export type TelnetSettings = { host: string; port: number; username?: string; password?: string };
export type DeviceAddress = { device: number; port: number; system: number };

const IAC = 255;
const WILL = 251;
const WONT = 252;
const DO = 253;
const DONT = 254;
const SB = 250;
const SE = 240;

export class NetLinxTerminal {
  private buffer = "";
  private waiters: Array<{ pattern: RegExp; resolve: (text: string) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }> = [];
  private failure?: Error;
  private subnegotiation = false;
  readonly socket = new Socket();

  constructor() {
    this.socket.on("data", (chunk) => this.consume(chunk));
    this.socket.on("error", (error) => this.fail(new Error(`Could not reach the NetLinx Telnet terminal: ${error.message}`)));
    this.socket.on("close", () => this.fail(new Error("The NetLinx master closed the Telnet session.")));
  }

  async connect(settings: TelnetSettings) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { this.socket.destroy(); reject(new Error("Connecting to the NetLinx Telnet terminal timed out.")); }, 5000);
      const onError = (error: Error) => { clearTimeout(timer); this.socket.off("connect", onConnect); reject(new Error(`Could not reach the NetLinx Telnet terminal: ${error.message}`)); };
      const onConnect = () => { clearTimeout(timer); this.socket.off("error", onError); resolve(); };
      this.socket.once("error", onError);
      this.socket.once("connect", onConnect);
      this.socket.connect(settings.port, settings.host);
    });

    const prompt = /(?:login\s*:|password\s*:|(?:^|\n)\s*>\s*$)/i;
    let response = await this.waitFor(prompt, 5000);
    if (/(?:^|\n)\s*>\s*$/i.test(response) && (settings.username || settings.password)) {
      await this.sendLine("login");
      response = await this.waitFor(/(?:login\s*:|password\s*:|(?:^|\n)\s*>\s*$)/i, 5000);
    }
    if (/login\s*:/i.test(response)) {
      if (!settings.username) throw new Error("NetLinx Telnet requires a username. Enter the existing controller login in AMX settings.");
      await this.sendLine(settings.username);
      response = await this.waitFor(/(?:password\s*:|(?:^|\n)\s*>\s*$)/i, 5000);
    }
    if (/password\s*:/i.test(response)) {
      if (!settings.password) throw new Error("NetLinx Telnet requires a password. Enter the existing controller login in AMX settings.");
      await this.sendLine(settings.password);
      response = await this.waitFor(/(?:^|\n)\s*>\s*$/i, 5000);
    }
    if (/login not authorized|invalid|denied/i.test(response)) throw new Error("NetLinx Telnet rejected the saved login. Check the existing controller credentials in AMX settings.");
    if (!/(?:^|\n)\s*>\s*$/i.test(response)) throw new Error("NetLinx Telnet did not show a command prompt.");
  }

  async command(command: string) {
    if (!/^[A-Z0-9][A-Z0-9 /:[\],_-]{0,120}$/i.test(command)) throw new Error("Invalid NetLinx terminal command.");
    await this.sendLine(command);
    return this.waitFor(/(?:^|\n)\s*>\s*$/i, 6000);
  }

  close() { this.socket.destroy(); }

  private waitFor(pattern: RegExp, timeoutMs: number) {
    const match = this.buffer.match(pattern);
    if (match) return Promise.resolve(this.takeThrough(match.index! + match[0].length));
    if (this.failure) return Promise.reject(this.failure);
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((waiter) => waiter.timer === timer);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error(`NetLinx Telnet did not return a prompt. Received: ${this.buffer.slice(-240).trim() || "no text"}`));
      }, timeoutMs);
      this.waiters.push({ pattern, resolve, reject, timer });
    });
  }

  private sendLine(line: string) {
    return new Promise<void>((resolve, reject) => this.socket.write(`${line}\r\n`, "ascii", (error) => error ? reject(error) : resolve()));
  }

  private takeThrough(index: number) {
    const text = this.buffer.slice(0, index);
    this.buffer = this.buffer.slice(index);
    return text;
  }

  private consume(chunk: Buffer) {
    const plain: number[] = [];
    for (let index = 0; index < chunk.length; index += 1) {
      const byte = chunk[index]!;
      if (this.subnegotiation) {
        if (byte === IAC && chunk[index + 1] === SE) { this.subnegotiation = false; index += 1; }
        continue;
      }
      if (byte !== IAC) { plain.push(byte); continue; }
      const command = chunk[++index];
      if (command === undefined) break;
      if (command === SB) { this.subnegotiation = true; continue; }
      if (command === IAC) { plain.push(IAC); continue; }
      if (command === WILL || command === WONT || command === DO || command === DONT) {
        const option = chunk[++index];
        if (option === undefined) break;
        if (command === DO || command === WILL) this.socket.write(Buffer.from([IAC, command === DO ? WONT : DONT, option]));
      }
    }
    this.buffer += Buffer.from(plain).toString("latin1").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    while (this.waiters.length) {
      const waiter = this.waiters[0]!;
      const match = this.buffer.match(waiter.pattern);
      if (!match) break;
      this.waiters.shift(); clearTimeout(waiter.timer);
      waiter.resolve(this.takeThrough(match.index! + match[0].length));
    }
  }

  private fail(error: Error) {
    if (this.failure) return;
    this.failure = error;
    for (const waiter of this.waiters.splice(0)) { clearTimeout(waiter.timer); waiter.reject(error); }
  }
}

export function channelCommand(address: DeviceAddress, channel: number, state: "on" | "off" | "pulse") {
  if (!Number.isInteger(address.device) || address.device < 1 || address.device > 65535
    || !Number.isInteger(address.port) || address.port < 1 || address.port > 65535
    || !Number.isInteger(address.system) || address.system < 0 || address.system > 65535
    || !Number.isInteger(channel) || channel < 1 || channel > 65535) throw new Error("Invalid NetLinx device address or channel.");
  const command = state === "on" ? "ON" : state === "off" ? "OFF" : "PULSE";
  return `${command}[${address.device}:${address.port}:${address.system},${channel}]`;
}

export async function assertNetLinxDevicePresent(terminal: NetLinxTerminal, address: DeviceAddress) {
  const response = await terminal.command(`SHOW DEVICE [${address.device}:${address.port}:${address.system}]`);
  const body = response.replace(/^.*?SHOW DEVICE[^\n]*\n/i, "");
  if (!new RegExp(`\\b0*${address.device}\\b`).test(body)) {
    throw new Error(`NetLinx does not list control device ${address.device}:${address.port}:${address.system}. The controller program must declare and handle that client device before Smart-Church can send controls.`);
  }
}

export async function sendTelnetChannel(settings: TelnetSettings, address: DeviceAddress, channel: number, state: "on" | "off" | "pulse") {
  const terminal = new NetLinxTerminal();
  try {
    await terminal.connect(settings);
    await assertNetLinxDevicePresent(terminal, address);
    const response = await terminal.command(channelCommand(address, channel, state));
    const expected = state === "on" ? "On" : state === "off" ? "Off" : "Pulse";
    if (!new RegExp(`Sending\\s+${expected}\\[${address.device}:${address.port}:${address.system},${channel}\\]`, "i").test(response)) {
      throw new Error(`NetLinx did not confirm the ${state} event for channel ${channel}.`);
    }
  } finally { terminal.close(); }
}

function parseDeviceStatus(body: string, address: DeviceAddress) {
  if (/unknown device|device not found|not connected|invalid device/i.test(body)) {
    throw new Error(`NetLinx did not return status for ${address.device}:${address.port}:${address.system}.`);
  }
  const channels = new Set<number>();
  let sawChannelStatus = false;
  for (const line of body.split("\n")) {
    const onList = line.match(/(?:input|output)?\s*channels?\s+(?:are\s+)?on\s*:\s*(.*)$/i);
    if (onList) {
      sawChannelStatus = true;
      if (!/^(?:none|off|0)\b/i.test(onList[1]!.trim())) {
        for (const match of onList[1]!.matchAll(/\b(\d{1,5})\b/g)) channels.add(Number(match[1]));
      }
      continue;
    }
    const activeList = line.match(/^\s*(?:active\s+)?channels?\s*[:=]\s*(.*)$/i);
    if (activeList) {
      sawChannelStatus = true;
      if (!/^(?:none|off|0)\b/i.test(activeList[1]!.trim())) {
        for (const match of activeList[1]!.matchAll(/\b(\d{1,5})\b/g)) channels.add(Number(match[1]));
      }
    }
  }
  const levels: Record<number, number> = {};
  for (const line of body.split("\n")) {
    const match = line.match(/^\s*Level\s+(\d+)\s*=\s*(-?\d+(?:\.\d+)?)/i);
    if (match) levels[Number(match[1])] = Number(match[2]);
  }
  if (!sawChannelStatus && !Object.keys(levels).length) {
    throw new Error("NetLinx returned device status in an unrecognized format; no channel or level state was assumed.");
  }
  return { channels: [...channels].filter((channel) => channel > 0).sort((a, b) => a - b), levels };
}

/** Read channel and level state using the master's read-only Telnet status command. */
export async function readTelnetDeviceStatus(settings: TelnetSettings, address: DeviceAddress) {
  const terminal = new NetLinxTerminal();
  try {
    await terminal.connect(settings);
    const response = await terminal.command(`DEVICE STATUS [${address.device}:${address.port}:${address.system}]`);
    const body = response.replace(/^.*?DEVICE STATUS[^\n]*\n/i, "").replace(/(?:^|\n)\s*>\s*$/i, "");
    return parseDeviceStatus(body, address);
  } finally { terminal.close(); }
}

export async function readTelnetDeviceChannels(settings: TelnetSettings, address: DeviceAddress) {
  return (await readTelnetDeviceStatus(settings, address)).channels;
}
