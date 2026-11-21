import { Socket } from "node:net";

type TelnetSettings = { host: string; port: number; username: string; password: string };

const IAC = 255;
const WILL = 251;
const WONT = 252;
const DO = 253;
const DONT = 254;
const SB = 250;
const SE = 240;

class NetLinxTerminal {
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

  connect(host: string, port: number) {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { this.socket.destroy(); reject(new Error("Connecting to the NetLinx Telnet terminal timed out.")); }, 5000);
      const onError = (error: Error) => { clearTimeout(timer); this.socket.off("connect", onConnect); reject(new Error(`Could not reach the NetLinx Telnet terminal: ${error.message}`)); };
      const onConnect = () => { clearTimeout(timer); this.socket.off("error", onError); resolve(); };
      this.socket.once("error", onError);
      this.socket.once("connect", onConnect);
      this.socket.connect(port, host);
    });
  }

  waitFor(pattern: RegExp, timeoutMs = 5000) {
    const match = this.buffer.match(pattern);
    if (match) return Promise.resolve(this.takeThrough(match.index! + match[0].length));
    if (this.failure) return Promise.reject(this.failure);
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((waiter) => waiter.timer === timer);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error(`The NetLinx Telnet terminal did not return the expected prompt. Received: ${this.buffer.slice(-300).trim() || "no text"}`));
      }, timeoutMs);
      this.waiters.push({ pattern, resolve, reject, timer });
    });
  }

  sendLine(line: string) {
    return new Promise<void>((resolve, reject) => {
      this.socket.write(`${line}\r\n`, "ascii", (error) => error ? reject(error) : resolve());
    });
  }

  close() { this.socket.destroy(); }

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
        if (command === DO || command === WILL) {
          this.socket.write(Buffer.from([IAC, command === DO ? WONT : DONT, option]));
        }
      }
    }
    this.buffer += Buffer.from(plain).toString("latin1").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    this.resolveWaiters();
  }

  private resolveWaiters() {
    while (this.waiters.length) {
      const waiter = this.waiters[0]!;
      const match = this.buffer.match(waiter.pattern);
      if (!match) break;
      this.waiters.shift();
      clearTimeout(waiter.timer);
      waiter.resolve(this.takeThrough(match.index! + match[0].length));
    }
  }

  private fail(error: Error) {
    if (this.failure) return;
    this.failure = error;
    for (const waiter of this.waiters.splice(0)) { clearTimeout(waiter.timer); waiter.reject(error); }
  }
}

export async function pulseChannel(settings: TelnetSettings, address: { device: number; port: number; system: number }, channel: number) {
  if (!Number.isInteger(settings.port) || settings.port < 1 || settings.port > 65535
    || !Number.isInteger(address.device) || address.device < 1 || address.device > 65535
    || !Number.isInteger(address.port) || address.port < 1 || address.port > 65535
    || !Number.isInteger(address.system) || address.system < 0 || address.system > 65535
    || !Number.isInteger(channel) || channel < 1 || channel > 65535) {
    throw new Error("The requested NetLinx device address or channel is invalid.");
  }
  const connection = new NetLinxTerminal();
  try {
    await connection.connect(settings.host, settings.port);
    const loginPrompt = await connection.waitFor(/(?:login\s*:|password\s*:|(?:^|\n)\s*>\s*$)/i);
    let responseText = loginPrompt;
    if (/login\s*:/i.test(loginPrompt)) {
      if (!settings.username) throw new Error("The NetLinx Telnet terminal requires a username. Enter the existing controller login in AMX settings.");
      await connection.sendLine(settings.username);
      const passwordPrompt = await connection.waitFor(/(?:password\s*:|(?:^|\n)\s*>\s*$)/i);
      if (/password\s*:/i.test(passwordPrompt)) {
        if (!settings.password) throw new Error("The NetLinx Telnet terminal requires a password. Enter the existing controller login in AMX settings.");
        await connection.sendLine(settings.password);
        responseText = await connection.waitFor(/(?:^|\n)\s*>\s*$/i);
      }
    } else if (/password\s*:/i.test(loginPrompt)) {
      if (!settings.password) throw new Error("The NetLinx Telnet terminal requires a password. Enter the existing controller login in AMX settings.");
      await connection.sendLine(settings.password);
      responseText = await connection.waitFor(/(?:^|\n)\s*>\s*$/i);
    }
    if (/login|password|invalid|denied/i.test(responseText)) throw new Error("The NetLinx Telnet login was rejected. Check the existing controller credentials in AMX settings.");

    const command = `PULSE ${address.device}:${address.port}:${address.system},${channel}`;
    await connection.sendLine(command);
    const result = await connection.waitFor(/(?:^|\n)\s*>\s*$/i);
    if (!new RegExp(`Sending\\s+Pulse\\[${address.device}:${address.port}:${address.system},${channel}\\]`, "i").test(result)) {
      throw new Error(`The NetLinx terminal did not confirm the channel pulse. Received: ${result.trim().slice(-300) || "no response"}`);
    }
  } finally {
    connection.close();
  }
}
