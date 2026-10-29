import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { resolveMx } from "node:dns/promises";
import net, { type Socket } from "node:net";
import tls from "node:tls";
import type { Pool } from "pg";
import type { EmailConnector, EmailMessage } from "../module-sdk.js";

export type EmailMode = "direct" | "smtp";
export type SmtpSecurity = "none" | "starttls" | "tls";
export type EmailSettingsDraft = {
  mode: EmailMode; enabled: boolean; fromName: string; fromEmail: string;
  smtpHost: string; smtpPort: number; smtpSecurity: SmtpSecurity; smtpUsername: string;
  smtpPassword: string; clearPassword: boolean;
};
type StoredSettings = Omit<EmailSettingsDraft, "smtpPassword" | "clearPassword"> & { encryptedSmtpPassword: string | null; passwordConfigured: boolean };
type DbSettings = { mode: EmailMode; enabled: boolean; from_name: string; from_email: string; smtp_host: string; smtp_port: number; smtp_security: SmtpSecurity; smtp_username: string; encrypted_smtp_password: string | null };

function encryptionKey() {
  const keySource = process.env.SMART_CHURCH_EMAIL_ENCRYPTION_KEY?.trim() || process.env.DATABASE_URL;
  if (!keySource) throw new Error("Set SMART_CHURCH_EMAIL_ENCRYPTION_KEY or DATABASE_URL before configuring SMTP credentials.");
  return createHash("sha256").update(`smart-church/email-worker/v1:${keySource}`).digest();
}
function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}
function decrypt(value: string) {
  const [iv, tag, ciphertext] = value.split(".");
  if (!iv || !tag || !ciphertext) throw new Error("Stored SMTP credentials are invalid. Re-enter the password.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

function validEmail(value: string) {
  return value.length <= 254 && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value);
}

type SmtpMessage = { subject: string; text: string; html?: string; replyTo?: string; to: string[] };

function ready(settings: DbSettings) {
  return settings.enabled && validEmail(settings.from_email) && (settings.mode === "direct" || Boolean(settings.smtp_host.trim()));
}

class SmtpChannel {
  private buffer = "";
  private lines: string[] = [];
  private waiter: ((line: string) => void) | undefined;
  private ended = false;
  private readonly onData = (chunk: Buffer) => {
    this.buffer += chunk.toString("utf8");
    while (this.buffer.includes("\n")) {
      const index = this.buffer.indexOf("\n");
      const line = this.buffer.slice(0, index).replace(/\r$/, "");
      this.buffer = this.buffer.slice(index + 1);
      if (this.waiter) { const next = this.waiter; this.waiter = undefined; next(line); } else this.lines.push(line);
    }
  };
  constructor(private socket: Socket) {
    socket.setTimeout(20_000, () => socket.destroy(new Error("SMTP server timed out.")));
    socket.on("data", this.onData);
    socket.on("close", () => { this.ended = true; this.waiter?.(""); this.waiter = undefined; });
    socket.on("error", () => { this.ended = true; this.waiter?.(""); this.waiter = undefined; });
  }
  write(line: string) { this.socket.write(`${line}\r\n`); }
  writeData(data: string) { this.socket.write(data); }
  async response() {
    const first = await this.readLine();
    if (!/^\d{3}[ -]/.test(first)) throw new Error(first ? `Unexpected SMTP response: ${first.slice(0, 200)}` : "SMTP connection closed unexpectedly.");
    const code = first.slice(0, 3);
    const lines = [first];
    let current = first;
    while (current.startsWith(`${code}-`)) { current = await this.readLine(); lines.push(current); }
    return { code: Number(code), lines };
  }
  async expect(...codes: number[]) {
    const result = await this.response();
    if (!codes.includes(result.code)) throw new Error(`SMTP server replied ${result.code}: ${result.lines.at(-1)?.slice(4, 300) ?? "request rejected"}`);
    return result;
  }
  async upgradeTls(host: string) {
    this.socket.off("data", this.onData);
    const secure = tls.connect({ socket: this.socket, servername: host, rejectUnauthorized: true });
    await new Promise<void>((resolve, reject) => { secure.once("secureConnect", resolve); secure.once("error", reject); });
    this.socket = secure;
    this.buffer = "";
    this.lines = [];
    secure.on("data", this.onData);
  }
  close() { this.socket.end(); }
  private readLine() {
    const line = this.lines.shift();
    if (line !== undefined) return Promise.resolve(line);
    if (this.ended) return Promise.resolve("");
    return new Promise<string>((resolve) => { this.waiter = resolve; });
  }
}

async function smtpConnect(host: string, port: number, secure: boolean) {
  const socket = secure
    ? tls.connect({ host, port, servername: host, rejectUnauthorized: true })
    : net.createConnection({ host, port });
  await new Promise<void>((resolve, reject) => {
    const connected = secure ? "secureConnect" : "connect";
    socket.once(connected, resolve);
    socket.once("error", reject);
    socket.setTimeout(20_000, () => socket.destroy(new Error("SMTP connection timed out.")));
  });
  return new SmtpChannel(socket);
}

function cleanHeader(value: string) { return value.replace(/[\r\n]+/g, " ").trim(); }
function encodedHeader(value: string) { return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`; }
function formatAddress(name: string, email: string) { return name.trim() ? `"${cleanHeader(name).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}" <${email}>` : email; }
function mimeMessage(fromName: string, fromEmail: string, message: SmtpMessage) {
  const boundary = `smart-church-${randomBytes(16).toString("hex")}`;
  const to = message.to.map((address) => address.trim());
  const headers = [
    `From: ${formatAddress(fromName, fromEmail)}`, `To: ${to.join(", ")}`,
    `Subject: ${encodedHeader(cleanHeader(message.subject))}`, `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${fromEmail.split("@").at(-1)}>`, "MIME-Version: 1.0",
    ...(message.replyTo ? [`Reply-To: ${cleanHeader(message.replyTo)}`] : []),
  ];
  if (message.html) return `${headers.join("\r\n")}\r\nContent-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(message.text).toString("base64").replace(/.{1,76}/g, "$&\r\n")}\r\n--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(message.html).toString("base64").replace(/.{1,76}/g, "$&\r\n")}\r\n--${boundary}--\r\n`;
  return `${headers.join("\r\n")}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(message.text).toString("base64").replace(/.{1,76}/g, "$&\r\n")}\r\n`;
}

async function deliver(host: string, port: number, security: SmtpSecurity, opportunisticTls: boolean, username: string, password: string, fromName: string, fromEmail: string, message: SmtpMessage) {
  const senderDomain = fromEmail.split("@").at(-1)!;
  const channel = await smtpConnect(host, port, security === "tls");
  try {
    await channel.expect(220);
    channel.write(`EHLO ${senderDomain}`);
    let hello = await channel.expect(250);
    if (security === "starttls" || (opportunisticTls && hello.lines.some((line) => /\bSTARTTLS\b/i.test(line)))) {
      if (!hello.lines.some((line) => /\bSTARTTLS\b/i.test(line))) throw new Error("The SMTP server does not offer STARTTLS.");
      channel.write("STARTTLS"); await channel.expect(220); await channel.upgradeTls(host);
      channel.write(`EHLO ${senderDomain}`); hello = await channel.expect(250);
    }
    if (username || password) {
      const authLine = hello.lines.find((line) => /\bAUTH\b/i.test(line));
      if (!authLine) throw new Error("The SMTP server does not offer authentication.");
      if (/\bPLAIN\b/i.test(authLine)) {
        channel.write("AUTH PLAIN " + Buffer.from(`\0${username}\0${password}`).toString("base64"));
        await channel.expect(235);
      } else if (/\bLOGIN\b/i.test(authLine)) {
        channel.write("AUTH LOGIN"); await channel.expect(334);
        channel.write(Buffer.from(username).toString("base64")); await channel.expect(334);
        channel.write(Buffer.from(password).toString("base64")); await channel.expect(235);
      } else throw new Error("The SMTP server does not offer a supported authentication method (PLAIN or LOGIN).");
    }
    channel.write(`MAIL FROM:<${fromEmail}>`); await channel.expect(250);
    for (const recipient of message.to) { channel.write(`RCPT TO:<${recipient}>`); await channel.expect(250, 251); }
    channel.write("DATA"); await channel.expect(354);
    const raw = mimeMessage(fromName, fromEmail, message);
    channel.writeData(raw.replace(/\r?\n/g, "\r\n").replace(/\r\n\./g, "\r\n..").replace(/\.$/g, "..") + "\r\n.\r\n");
    await channel.expect(250);
    channel.write("QUIT"); await channel.expect(221);
  } finally { channel.close(); }
}

export function createEmailConnector(pool: Pool | null, isDatabaseReady: () => boolean): EmailConnector {
  async function settings(): Promise<DbSettings | null> {
    if (!pool || !isDatabaseReady()) return null;
    const result = await pool.query<DbSettings>(
      `SELECT mode,enabled,from_name,from_email,smtp_host,smtp_port,smtp_security,smtp_username,encrypted_smtp_password
         FROM installation_email_settings settings JOIN installations installation ON installation.id=settings.installation_id
        WHERE installation.is_current=true`,
    );
    return result.rows[0] ?? null;
  }
  return {
    isConfigured: async () => { const current = await settings(); return current ? ready(current) : false; },
    send: async (message) => {
      const current = await settings();
      if (!current || !ready(current)) throw new Error("Email delivery is not configured by the server administrator.");
      if (!pool || !isDatabaseReady()) throw new Error("User email addresses are unavailable because the database is offline.");
      const recipientEmail = "recipientUserId" in message
        ? (await pool.query<{ email: string | null }>("SELECT email FROM app_users WHERE id=$1", [message.recipientUserId])).rows[0]?.email?.trim()
        : message.recipientEmail.trim();
      if (!recipientEmail || !validEmail(recipientEmail)) throw new Error("The selected recipient has no valid email address.");
      const recipientList = [recipientEmail];
      if (!recipientList.length || recipientList.some((address) => !validEmail(address.trim()))) throw new Error("Enter valid recipient email addresses.");
      if (pool && isDatabaseReady()) {
        const suppressed = await pool.query("SELECT 1 FROM module_notification_email_suppressions WHERE email=ANY($1::text[])", [recipientList.map((address) => address.trim().toLowerCase())]);
        if (suppressed.rowCount) throw new Error("Email delivery is unavailable for this recipient.");
      }
      if (!message.subject.trim() || message.subject.length > 998 || message.text.length > 1_000_000 || (message.html?.length ?? 0) > 1_000_000) throw new Error("The email content is empty or too large.");
      if (message.replyTo && !validEmail(message.replyTo.trim())) throw new Error("The reply-to email address is invalid.");
      const password = current.encrypted_smtp_password ? decrypt(current.encrypted_smtp_password) : "";
      const messageId = `<${randomUUID()}@${current.from_email.split("@").at(-1)}>`;
      for (const recipientEmail of recipientList) {
        const recipientDomain = recipientEmail.split("@").at(-1)!;
        const hosts = current.mode === "smtp"
          ? [{ exchange: current.smtp_host, priority: 0 }]
          : await resolveMx(recipientDomain).then((mx) => mx.sort((a, b) => a.priority - b.priority)).catch(() => [{ exchange: recipientDomain, priority: 0 }]);
        let lastError: unknown;
        for (const mx of hosts) {
          try {
            await deliver(mx.exchange, current.mode === "smtp" ? current.smtp_port : 25, current.mode === "smtp" ? current.smtp_security : "none", current.mode === "direct", current.mode === "smtp" ? current.smtp_username : "", current.mode === "smtp" ? password : "", current.from_name, current.from_email, { ...message, to: [recipientEmail] });
            lastError = null;
            break;
          } catch (error) { lastError = error; }
        }
        if (lastError) throw lastError instanceof Error ? lastError : new Error("Email could not be delivered.");
      }
      return { messageId };
    },
  };
}

export async function readEmailSettings(pool: Pool, installationId: string): Promise<StoredSettings> {
  const result = await pool.query<DbSettings>("SELECT * FROM installation_email_settings WHERE installation_id=$1", [installationId]);
  const row = result.rows[0];
  return row ? {
    mode: row.mode, enabled: row.enabled, fromName: row.from_name, fromEmail: row.from_email,
    smtpHost: row.smtp_host, smtpPort: row.smtp_port, smtpSecurity: row.smtp_security,
    smtpUsername: row.smtp_username, encryptedSmtpPassword: row.encrypted_smtp_password,
    passwordConfigured: Boolean(row.encrypted_smtp_password),
  } : {
    mode: "direct", enabled: false, fromName: "Smart Church", fromEmail: "",
    smtpHost: "", smtpPort: 587, smtpSecurity: "starttls", smtpUsername: "",
    encryptedSmtpPassword: null, passwordConfigured: false,
  };
}

export async function saveEmailSettings(pool: Pool, installationId: string, draft: EmailSettingsDraft) {
  const old = await readEmailSettings(pool, installationId);
  const encryptedPassword = draft.clearPassword ? null : draft.smtpPassword ? encrypt(draft.smtpPassword) : old.encryptedSmtpPassword;
  await pool.query(
    `INSERT INTO installation_email_settings (installation_id,mode,enabled,from_name,from_email,smtp_host,smtp_port,smtp_security,smtp_username,encrypted_smtp_password,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
     ON CONFLICT (installation_id) DO UPDATE SET mode=EXCLUDED.mode,enabled=EXCLUDED.enabled,from_name=EXCLUDED.from_name,from_email=EXCLUDED.from_email,smtp_host=EXCLUDED.smtp_host,smtp_port=EXCLUDED.smtp_port,smtp_security=EXCLUDED.smtp_security,smtp_username=EXCLUDED.smtp_username,encrypted_smtp_password=EXCLUDED.encrypted_smtp_password,updated_at=now()`,
    [installationId,draft.mode,draft.enabled,draft.fromName.trim(),draft.fromEmail.trim(),draft.smtpHost.trim(),draft.smtpPort,draft.smtpSecurity,draft.smtpUsername.trim(),encryptedPassword],
  );
}
