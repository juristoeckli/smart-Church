import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { PoolClient } from "pg";
import type { ModuleServerContext } from "../module-sdk.js";
import { decryptYoutubeToken } from "./youtube.js";

type Snapshot = {
  version: 1;
  deviceAddresses: Array<Record<string, unknown>>;
  plannedStreams: Array<Record<string, unknown>>;
  youtubeConnections: Array<Record<string, unknown>>;
  moduleSettings: Array<Record<string, unknown>>;
};
const maxSnapshotBytes = 50 * 1024 * 1024;

function encryptionKeyFingerprint() {
  const key = process.env.SMART_CHURCH_VIDEO_STEFFISBURG_YOUTUBE_TOKEN_KEY?.trim() ?? "";
  return key ? createHash("sha256").update(key).digest("hex") : "missing-key";
}

async function workerConfiguration() {
  const configPath = process.env.STREAMING_CONFIG_FILE?.trim();
  if (!configPath) throw new Error("Set STREAMING_CONFIG_FILE and configure this location in the Video module's worker settings.");
  const raw = await readFile(configPath, "utf8");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("The Video module worker configuration is not valid JSON."); }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { sites?: unknown }).sites)) throw new Error("The Video module worker configuration must contain a sites array.");
  const runtimeSettings = [
    process.env.BMD_CONVERTER_DS700_HOST?.trim() ?? "",
    process.env.BMD_CONVERTER_DS700_PORT?.trim() ?? "19540",
    process.env.BMD_CONVERTER_CLIENT_MAC?.trim() ?? "",
  ];
  return createHash("sha256").update(JSON.stringify([parsed, runtimeSettings])).digest("hex");
}

function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Buffer.isBuffer(value)) return JSON.stringify(value.toString("base64"));
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value as Record<string, unknown>).sort().map((key) => JSON.stringify(key) + ":" + canonical((value as Record<string, unknown>)[key])).join(",") + "}";
  return JSON.stringify(value);
}

async function collect(client: Pick<PoolClient, "query">, departmentId: string): Promise<Snapshot> {
  const [deviceAddresses, plannedStreams, youtubeConnections, moduleSettings] = await Promise.all([
    client.query("SELECT default_addresses,addresses,updated_at FROM video_device_address_settings WHERE department_id=$1", [departmentId]),
    client.query("SELECT id,event_id,title,description,speaker,theme,scheduled_start_at,privacy_status,youtube_broadcast_id,youtube_status,youtube_error,created_by,created_at,updated_at,youtube_playlist_id,youtube_playlist_title,youtube_playlist_added_at FROM video_planned_streams WHERE department_id=$1 ORDER BY id", [departmentId]),
    client.query("SELECT encrypted_refresh_token,channel_id,channel_title,connected_by,connected_at,updated_at,oauth_client_id FROM video_youtube_connections WHERE department_id=$1", [departmentId]),
    client.query("SELECT youtube_client_id,youtube_client_secret_encrypted,youtube_redirect_uri,updated_by,updated_at FROM video_module_department_settings WHERE department_id=$1", [departmentId]),
  ]);
  return {
    version: 1,
    deviceAddresses: deviceAddresses.rows as Array<Record<string, unknown>>,
    plannedStreams: plannedStreams.rows as Array<Record<string, unknown>>,
    youtubeConnections: youtubeConnections.rows as Array<Record<string, unknown>>,
    moduleSettings: moduleSettings.rows as Array<Record<string, unknown>>,
  };
}

export function registerVideoSteffisburgReplication(context: ModuleServerContext) {
  const { pool, isDatabaseReady } = context;
  context.replication.register({
    schemaVersion: "2",
    getSchemaVersion: async () => `2:${encryptionKeyFingerprint()}:${await workerConfiguration().catch(() => "missing-or-invalid-worker-config")}`,
    inspect: async (departmentId) => {
      if (!pool || !isDatabaseReady()) return { ready: false, blockers: ["Video Steffisburg database is unavailable."], recordCount: 0 };
      try {
        const snapshot = await collect(pool, departmentId);
        const blockers: string[] = [];
        try { await workerConfiguration(); }
        catch (error) { blockers.push(error instanceof Error ? error.message : "The Video module worker configuration is unavailable on this server."); }
        const worker = context.getVideoWorker();
        if (!worker || worker.state.state !== "ready") blockers.push(`The local Video worker is ${worker?.state.state ?? "unavailable"}${worker?.state.error ? `: ${worker.state.error}` : "."}`);
        if (Buffer.byteLength(JSON.stringify(snapshot)) > maxSnapshotBytes) blockers.push("Video Steffisburg settings and planned streams exceed the 50 MiB snapshot limit.");
        const encryptedValues = [
          ...snapshot.youtubeConnections.map((row) => row.encrypted_refresh_token),
          ...snapshot.moduleSettings.map((row) => row.youtube_client_secret_encrypted),
        ].filter((value): value is string => typeof value === "string" && value.length > 0);
        if (encryptedValues.length && encryptionKeyFingerprint() === "missing-key") blockers.push("The YouTube token encryption key is missing on this server.");
        else for (const value of encryptedValues) {
          try { decryptYoutubeToken(value); }
          catch { blockers.push("A YouTube credential cannot be decrypted with this server's token encryption key."); break; }
        }
        return { ready: !blockers.length, blockers, recordCount: snapshot.deviceAddresses.length + snapshot.plannedStreams.length + snapshot.youtubeConnections.length + snapshot.moduleSettings.length };
      } catch (error) { return { ready: false, blockers: [error instanceof Error ? error.message.slice(0, 240) : "Video module readiness could not be checked."], recordCount: 0 }; }
    },
    exportSnapshot: (client, departmentId) => collect(client, departmentId),
    restoreSnapshot: async (client, departmentId, input) => {
      const snapshot = input as Snapshot;
      if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.deviceAddresses) || snapshot.deviceAddresses.length > 1 || !Array.isArray(snapshot.plannedStreams) || snapshot.plannedStreams.length > 5000 || !Array.isArray(snapshot.youtubeConnections) || snapshot.youtubeConnections.length > 1 || !Array.isArray(snapshot.moduleSettings) || snapshot.moduleSettings.length > 1) throw new Error("The Video Steffisburg snapshot is invalid or exceeds the supported limits.");
      const encryptedValues = [...snapshot.youtubeConnections.map((row) => row.encrypted_refresh_token), ...snapshot.moduleSettings.map((row) => row.youtube_client_secret_encrypted)].filter((value): value is string => typeof value === "string" && value.length > 0);
      if (encryptedValues.length && encryptionKeyFingerprint() === "missing-key") throw new Error("Configure the same YouTube token encryption key on both servers before restoring Video Steffisburg credentials.");
      for (const value of encryptedValues) decryptYoutubeToken(value);
      await client.query("DELETE FROM video_planned_streams WHERE department_id=$1", [departmentId]);
      await client.query("DELETE FROM video_youtube_connections WHERE department_id=$1", [departmentId]);
      await client.query("DELETE FROM video_device_address_settings WHERE department_id=$1", [departmentId]);
      await client.query("DELETE FROM video_module_department_settings WHERE department_id=$1", [departmentId]);
      for (const row of snapshot.deviceAddresses) await client.query("INSERT INTO video_device_address_settings(department_id,default_addresses,addresses,updated_at) VALUES($1,$2::jsonb,$3::jsonb,$4)", [departmentId, JSON.stringify(row.default_addresses), JSON.stringify(row.addresses), row.updated_at]);
      const streamColumns = ["id", "event_id", "title", "description", "speaker", "theme", "scheduled_start_at", "privacy_status", "youtube_broadcast_id", "youtube_status", "youtube_error", "created_by", "created_at", "updated_at", "youtube_playlist_id", "youtube_playlist_title", "youtube_playlist_added_at"];
      for (const row of snapshot.plannedStreams) await client.query(`INSERT INTO video_planned_streams(id,department_id,${streamColumns.join(",")}) VALUES($1,${streamColumns.map((_, index) => "$" + (index + 2)).join(",")})`, [row.id, departmentId, ...streamColumns.map((column) => row[column] ?? null)]);
      for (const row of snapshot.youtubeConnections) await client.query(`INSERT INTO video_youtube_connections(department_id,encrypted_refresh_token,channel_id,channel_title,connected_by,connected_at,updated_at,oauth_client_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [departmentId, row.encrypted_refresh_token, row.channel_id, row.channel_title, row.connected_by, row.connected_at, row.updated_at, row.oauth_client_id]);
      for (const row of snapshot.moduleSettings) await client.query(`INSERT INTO video_module_department_settings(department_id,youtube_client_id,youtube_client_secret_encrypted,youtube_redirect_uri,updated_by,updated_at)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(department_id) DO UPDATE SET youtube_client_id=EXCLUDED.youtube_client_id,youtube_client_secret_encrypted=EXCLUDED.youtube_client_secret_encrypted,youtube_redirect_uri=EXCLUDED.youtube_redirect_uri,updated_by=EXCLUDED.updated_by,updated_at=EXCLUDED.updated_at`, [departmentId, row.youtube_client_id, row.youtube_client_secret_encrypted, row.youtube_redirect_uri, row.updated_by, row.updated_at]);
      return { recordCount: snapshot.deviceAddresses.length + snapshot.plannedStreams.length + snapshot.youtubeConnections.length + snapshot.moduleSettings.length };
    },
    verifySnapshot: async (client, departmentId, input) => {
      const expected = input as Snapshot;
      if (!expected || expected.version !== 1 || !Array.isArray(expected.deviceAddresses) || !Array.isArray(expected.plannedStreams) || !Array.isArray(expected.youtubeConnections) || !Array.isArray(expected.moduleSettings)) return { ready: false, blockers: ["No supported Video Steffisburg snapshot is available."] };
      const actual = await collect(client, departmentId);
      return canonical(actual) === canonical(expected)
        ? { ready: true, blockers: [] }
        : { ready: false, blockers: ["Video Steffisburg settings, YouTube credentials, or planned streams do not match the verified snapshot."] };
    },
  });
}
