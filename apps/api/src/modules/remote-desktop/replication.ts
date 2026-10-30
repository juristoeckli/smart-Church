import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import type { ModuleServerContext } from "../module-sdk.js";

type StoredDestination = Record<string, unknown> & { password_ciphertext: string; password_iv: string; password_tag: string };
type Snapshot = { version: 1; settings: Array<Record<string, unknown>>; destinations: StoredDestination[] };
const maxBytes = 50 * 1024 * 1024;

function encryptionKey() {
  const value = process.env.SYSTEM_LAPTOP_JSON_SECRET_KEY?.trim() ?? "";
  if (!/^[\da-f]{32}$/i.test(value)) return null;
  return createHash("sha256").update(Buffer.from(value, "hex")).digest();
}

function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Buffer.isBuffer(value)) return JSON.stringify(value.toString("base64"));
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value as Record<string, unknown>).sort().map((key) => JSON.stringify(key) + ":" + canonical((value as Record<string, unknown>)[key])).join(",") + "}";
  return JSON.stringify(value);
}

function decryptPassword(destination: StoredDestination, key: Buffer) {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(destination.password_iv, "base64"));
  decipher.setAuthTag(Buffer.from(destination.password_tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(destination.password_ciphertext, "base64")), decipher.final()]).toString("utf8");
}

function encryptPassword(password: string, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  return { password_ciphertext: ciphertext.toString("base64"), password_iv: iv.toString("base64"), password_tag: cipher.getAuthTag().toString("base64") };
}

async function collect(client: Pick<PoolClient, "query">, departmentId: string): Promise<Snapshot> {
  const settings = await client.query("SELECT managed,updated_at FROM remote_desktop_site_settings WHERE department_id=$1", [departmentId]);
  const destinations = await client.query("SELECT id,name,host,port,protocol,username,password_ciphertext,password_iv,password_tag,autologin,created_at,updated_at FROM remote_desktop_destinations WHERE department_id=$1 ORDER BY id", [departmentId]);
  return { version: 1, settings: settings.rows as Array<Record<string, unknown>>, destinations: destinations.rows as StoredDestination[] };
}

export function registerRemoteDesktopReplication(context: ModuleServerContext) {
  const { pool, isDatabaseReady } = context;
  context.replication.register({
    schemaVersion: "2",
    getSchemaVersion: async () => "2",
    inspect: async (departmentId) => {
      if (!pool || !isDatabaseReady()) return { ready: false, blockers: ["Remote Desktop database is unavailable."], recordCount: 0 };
      try {
        const snapshot = await collect(pool, departmentId);
        const bytes = Buffer.byteLength(JSON.stringify(snapshot));
        const blockers: string[] = [];
        if (bytes > maxBytes) blockers.push("Remote Desktop settings and destinations exceed the 50 MiB snapshot limit.");
        const apiUrl = process.env.SYSTEM_LAPTOP_GUACAMOLE_API_URL?.trim() ?? "";
        try {
          const url = new URL(apiUrl);
          if (!new Set(["http:", "https:"]).has(url.protocol) || url.username || url.password) throw new Error("invalid gateway URL");
        } catch { blockers.push("Configure the local Guacamole API URL on this server before enabling Remote Desktop failover."); }
        if (apiUrl) {
          try {
            const probe = await fetch(`${apiUrl.replace(/\/$/, "")}/guacamole-common-js/all.min.js`, { signal: AbortSignal.timeout(2_500) });
            await probe.body?.cancel();
            if (!probe.ok) blockers.push(`The local Guacamole gateway returned HTTP ${probe.status}; Remote Desktop will not be available after failover.`);
          } catch { blockers.push("The local Guacamole gateway cannot be reached; Remote Desktop will not be available after failover."); }
        }
        const key = encryptionKey();
        if (!key) blockers.push("Set SYSTEM_LAPTOP_JSON_SECRET_KEY on this server before using or replicating Remote Desktop credentials.");
        else for (const destination of snapshot.destinations) {
          try { decryptPassword(destination, key); }
          catch { blockers.push(`The saved password for ${String(destination.name ?? destination.id)} cannot be decrypted with SYSTEM_LAPTOP_JSON_SECRET_KEY.`); break; }
        }
        return { ready: !blockers.length, blockers, recordCount: snapshot.destinations.length + snapshot.settings.length };
      } catch (error) { return { ready: false, blockers: [error instanceof Error ? error.message.slice(0, 240) : "Remote Desktop readiness could not be checked."], recordCount: 0 }; }
    },
    exportSnapshot: (client, departmentId) => collect(client, departmentId),
    prepareSnapshotForPeer: async (input, sealForPeer) => {
      const snapshot = structuredClone(input) as Snapshot & { credentialTransferVersion?: number };
      const key = encryptionKey();
      for (const destination of snapshot.destinations) {
        if (!key) throw new Error("Configure SYSTEM_LAPTOP_JSON_SECRET_KEY locally before sending Remote Desktop credentials.");
        const plaintext = decryptPassword(destination, key);
        const record = destination as Record<string, unknown>;
        record.password_ciphertext = { sealedCredential: sealForPeer(plaintext) };
        record.password_iv = null;
        record.password_tag = null;
      }
      snapshot.credentialTransferVersion = 1;
      return snapshot;
    },
    restoreSnapshotFromPeer: async (input, openForLocal) => {
      const snapshot = input as Snapshot & { credentialTransferVersion?: number };
      if (snapshot.credentialTransferVersion !== 1) return input;
      const restored = structuredClone(snapshot) as Snapshot & { credentialTransferVersion?: number };
      const key = encryptionKey();
      for (const destination of restored.destinations) {
        const record = destination as Record<string, unknown>;
        const value = record.password_ciphertext;
        if (value && typeof value === "object" && "sealedCredential" in value && typeof value.sealedCredential === "string") {
          if (!key) throw new Error("Set SYSTEM_LAPTOP_JSON_SECRET_KEY on the standby before restoring Remote Desktop credentials.");
          Object.assign(record, encryptPassword(openForLocal(value.sealedCredential), key));
        } else throw new Error("A Remote Desktop password was not protected for this standby server.");
      }
      return restored;
    },
    restoreSnapshot: async (client, departmentId, input) => {
      const snapshot = input as Snapshot;
      if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.settings) || snapshot.settings.length > 1 || !Array.isArray(snapshot.destinations) || snapshot.destinations.length > 2000) throw new Error("The Remote Desktop snapshot is invalid or exceeds the supported limits.");
      if (snapshot.destinations.length && !encryptionKey()) throw new Error("Set SYSTEM_LAPTOP_JSON_SECRET_KEY locally before restoring Remote Desktop credentials.");
      await client.query("DELETE FROM remote_desktop_destinations WHERE department_id=$1", [departmentId]);
      await client.query("DELETE FROM remote_desktop_site_settings WHERE department_id=$1", [departmentId]);
      for (const row of snapshot.settings) await client.query("INSERT INTO remote_desktop_site_settings(department_id,managed,updated_at) VALUES($1,$2,$3)", [departmentId, row.managed, row.updated_at]);
      for (const row of snapshot.destinations) await client.query(`INSERT INTO remote_desktop_destinations
        (id,department_id,name,host,port,protocol,username,password_ciphertext,password_iv,password_tag,autologin,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [row.id, departmentId, row.name, row.host, row.port, row.protocol, row.username, row.password_ciphertext, row.password_iv, row.password_tag, row.autologin, row.created_at, row.updated_at]);
      return { recordCount: snapshot.settings.length + snapshot.destinations.length };
    },
    verifySnapshot: async (client, departmentId, input) => {
      const expected = input as Snapshot;
      if (!expected || expected.version !== 1 || !Array.isArray(expected.settings) || !Array.isArray(expected.destinations)) return { ready: false, blockers: ["No supported Remote Desktop snapshot is available."] };
      const actual = await collect(client, departmentId);
      return canonical(actual) === canonical({ ...expected, settings: expected.settings.map((row) => ({ ...row })) })
        ? { ready: true, blockers: [] }
        : { ready: false, blockers: ["Remote Desktop settings or destinations do not match the verified snapshot."] };
    },
  });
}
