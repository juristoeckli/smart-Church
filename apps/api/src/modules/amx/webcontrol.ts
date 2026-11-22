import type { DeviceAddress, TelnetSettings } from "./telnet.js";

type EmulatedButtonAction = "channelPush" | "channelRelease";

/**
 * AMX WebConsole's documented Control/Emulate path creates a real NetLinx
 * PUSH/RELEASE event. Telnet ON/PULSE only changes channel state and does not
 * generate the BUTTON_EVENT this project expects.
 */
export class NetLinxWebControlSession {
  private cookieHeader = "";
  private readonly origin: string;

  constructor(settings: Pick<TelnetSettings, "host">) {
    const host = settings.host.includes(":") && !settings.host.startsWith("[") ? `[${settings.host}]` : settings.host;
    this.origin = `http://${host}`;
  }

  async connect(settings: Pick<TelnetSettings, "username" | "password">) {
    if (Boolean(settings.username) !== Boolean(settings.password)) {
      throw new Error("Enter both the existing NetLinx WebConsole username and password, or leave both blank if the controller requires no login.");
    }
    if (!settings.username) return;

    const response = await fetch(`${this.origin}/web/root/login.xml`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ action: "login", path: "/web/http/default.html", userName: settings.username, password: settings.password ?? "" }),
      signal: AbortSignal.timeout(8000),
    });
    const body = await response.text();
    const setCookies = response.headers.getSetCookie?.() ?? [];
    this.cookieHeader = setCookies.map((cookie) => cookie.split(";", 1)[0]).filter(Boolean).join("; ");
    // Older NetLinx WebConsoles redirect after a successful login. Fetch is
    // configured not to follow that redirect so we can keep the session cookie;
    // treat it as success only when the controller also supplied that cookie.
    const redirected = response.status >= 300 && response.status < 400;
    if ((!response.ok && !redirected) || /<failed>\s*1\s*<\/failed>|invalid username|incorrect password/i.test(body) || !this.cookieHeader) {
      throw new Error("NetLinx WebConsole did not establish a session with the saved login.");
    }
  }

  async emulateButton(address: DeviceAddress, channel: number, action: EmulatedButtonAction) {
    if (!Number.isInteger(address.device) || address.device < 1 || address.device > 65535
      || !Number.isInteger(address.port) || address.port < 1 || address.port > 65535
      || !Number.isInteger(address.system) || address.system < 0 || address.system > 65535
      || !Number.isInteger(channel) || channel < 1 || channel > 65535) {
      throw new Error("Invalid NetLinx emulated device address or channel.");
    }
    const url = new URL("/web/devices/control.xml", this.origin);
    url.search = new URLSearchParams({
      systemNumber: String(address.system), deviceNumber: String(address.device), portNumber: String(address.port),
      method: "emulate", channel: String(channel), action,
    }).toString();
    const response = await fetch(url, {
      headers: this.cookieHeader ? { cookie: this.cookieHeader } : {},
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    });
    const body = await response.text();
    if (!response.ok || !/<control(?:\s|>)/i.test(body) || /<failed>\s*1\s*<\/failed>|<login\b/i.test(body)) {
      throw new Error(`NetLinx WebConsole did not confirm the ${action === "channelPush" ? "button press" : "button release"} on channel ${channel}.`);
    }
  }

  close() { this.cookieHeader = ""; }
}

export async function openNetLinxWebControlSession(settings: TelnetSettings) {
  const session = new NetLinxWebControlSession(settings);
  try {
    await session.connect(settings);
    return session;
  } catch (error) {
    session.close();
    throw error;
  }
}

