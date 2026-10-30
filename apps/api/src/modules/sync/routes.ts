import { createHash, createPublicKey, randomBytes, randomUUID } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import type { ModuleReplicationAdapter, ModuleServerContext } from "../module-sdk.js";
import { canonicalRequest, canonicalResponse, fingerprintPublicKey, getIdentity, openFromPeer, protocolVersion, sealForPeer, signBytes, verifyBytes, type FederationIdentity } from "./federation-crypto.js";
import { FederationChannels } from "./federation-channel.js";

const adminPrefix = "/api/modules/sync/federation";
const prefix = `${adminPrefix}/v1`;
const maxClockSkewMs = 5 * 60_000;
const nonceLifetimeMs = 10 * 60_000;
const maxPeerBodyBytes = 1024 * 1024;
const redundancyChunkBytes = 512 * 1024;
const maxRedundancyBytes = 256 * 1024 * 1024;
const pairAttempts = new Map<string, { count: number; expiresAt: number }>();
let activeFederationChannels: FederationChannels | null = null;
let federationInternalRequestToken = "";

type IdentityPayload = FederationIdentity & { signature?: string };
type PeerRow = { installation_id: string; display_name: string; base_url: string | null; public_key_pem: string; fingerprint: string; trust_state: "pending" | "trusted" | "revoked"; direction: "incoming" | "outgoing"; created_at: Date | string; approved_at: Date | string | null; last_seen_at: Date | string | null; last_error: string | null };
type RemotePeerAddress = { base_url: string | null; installation_id: string; public_key_pem: string };
type SyncRecord = { scope: "people_names" | "services"; sourceId: string; sourceRevision: string; record: Record<string, unknown> };
const syncPageSize = 50;
const maxSnapshotRecords = 10_000;
type RedundancyModuleManifestEntry = { moduleId: string; schemaVersion: string; installedVersion: string };

function replicationDigest(snapshots: Record<string, unknown>) {
  const canonicalEntries = Object.entries(snapshots).sort(([left], [right]) => left.localeCompare(right));
  return createHash("sha256").update(JSON.stringify(canonicalEntries)).digest("hex");
}

function sourceSnapshotDigest(snapshots: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify(snapshots)).digest("hex");
}

async function adapterSchemaVersion(adapter: ModuleReplicationAdapter, departmentId: string) {
  return adapter.getSchemaVersion ? adapter.getSchemaVersion(departmentId) : adapter.schemaVersion;
}

async function formerStandbyAuthorization(pool: import("pg").Pool, departmentId: string, installationId: string | null, formerDepartmentId: string | null) {
  if (installationId) return { installationId, departmentId: formerDepartmentId };
  // Older promoted sites cleared their upstream columns before the explicit
  // rejoin identity was persisted. The most recent promotion audit still
  // identifies the former primary; its admin must choose the local site again.
  const previous = await pool.query<{ source_installation_id: string | null }>(
    "SELECT source_installation_id FROM sync_redundancy_audit WHERE department_id=$1 AND action='promoted' ORDER BY created_at DESC LIMIT 1", [departmentId],
  );
  return { installationId: previous.rows[0]?.source_installation_id ?? null, departmentId: null };
}

async function hasApprovedPullAuthorization(pool: import("pg").Pool, departmentId: string, installationId: string, targetDepartmentId: string) {
  const result = await pool.query("SELECT 1 FROM sync_redundancy_pull_authorizations pull_authorization JOIN sync_site_redundancy site ON site.department_id=pull_authorization.source_department_id AND site.site_epoch=pull_authorization.source_epoch WHERE pull_authorization.source_department_id=$1 AND pull_authorization.target_installation_id=$2 AND pull_authorization.target_department_id=$3 AND pull_authorization.state='approved'", [departmentId, installationId, targetDepartmentId]);
  return Boolean(result.rowCount);
}

function manifestKey(modules: RedundancyModuleManifestEntry[]) {
  // Installed versions and activation are server-local. Site snapshots only
  // require the same module-owned data schema on every participating server.
  return JSON.stringify([...modules].sort((left, right) => left.moduleId.localeCompare(right.moduleId)).map((module) => [module.moduleId, module.schemaVersion]));
}

function redundancySnapshotLockName(sourceDepartmentId: string, targetInstallationId: string, targetDepartmentId: string) {
  return `smart-church-redundancy-push:${sourceDepartmentId}:${targetInstallationId}:${targetDepartmentId}`;
}

async function nextSnapshotRevision(pool: import("pg").Pool, departmentId: string, expectedEpoch: string) {
  const result = await pool.query<{ site_epoch: string; snapshot_revision: string }>(
    `UPDATE sync_site_redundancy SET snapshot_revision=snapshot_revision+1,updated_at=now()
      WHERE department_id=$1 AND role='primary' AND site_epoch=$2
      RETURNING site_epoch::text,snapshot_revision::text`, [departmentId, expectedEpoch],
  );
  if (!result.rowCount) throw new Error("The source site stopped being primary or changed epoch before its snapshot revision was reserved.");
  return result.rows[0];
}

async function manifestSupportedByAdapters(manifest: RedundancyModuleManifestEntry[], adapters: Map<string, ModuleReplicationAdapter>, departmentId: string) {
  return (await Promise.all(manifest.map(async (module) => {
    const adapter = adapters.get(module.moduleId);
    return Boolean(adapter && await adapterSchemaVersion(adapter, departmentId) === module.schemaVersion);
  }))).every(Boolean);
}

async function allAdapterManifest(adapters: ModuleReplicationAdapter[], departmentId: string) {
  return Promise.all(adapters.filter((adapter) => adapter.moduleId !== "sync").map(async (adapter) => ({
    moduleId: adapter.moduleId,
    schemaVersion: await adapterSchemaVersion(adapter, departmentId),
    installedVersion: adapter.schemaVersion,
  })));
}

async function installSiteChangeTriggers(pool: import("pg").Pool) {
  const tables = await pool.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_type='BASE TABLE' AND left(table_name,5)<>'sync_'
      AND (table_name='departments' OR EXISTS (
        SELECT 1 FROM information_schema.columns column_row
         WHERE column_row.table_schema='public' AND column_row.table_name=information_schema.tables.table_name AND column_row.column_name='department_id'
      ))
    ORDER BY table_name`);
  for (const { table_name: name } of tables.rows) {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) continue;
    const relation = `"public"."${name}"`;
    await pool.query(`DROP TRIGGER IF EXISTS smart_church_sync_site_change ON ${relation}`);
    await pool.query(`CREATE TRIGGER smart_church_sync_site_change AFTER INSERT OR UPDATE OR DELETE ON ${relation} FOR EACH ROW EXECUTE FUNCTION smart_church_sync_notify_site_change()`);
  }
  for (const name of ["app_users", "user_phone_numbers", "user_relationships"]) {
    const present = await pool.query("SELECT to_regclass($1) IS NOT NULL AS present", [`public.${name}`]);
    if (!present.rows[0]?.present) continue;
    const relation = `"public"."${name}"`;
    await pool.query(`DROP TRIGGER IF EXISTS smart_church_sync_account_change ON ${relation}`);
    await pool.query(`CREATE TRIGGER smart_church_sync_account_change AFTER INSERT OR UPDATE OR DELETE ON ${relation} FOR EACH ROW EXECUTE FUNCTION smart_church_sync_notify_account_change()`);
  }
}

async function redundancyManifest(pool: import("pg").Pool, adapters: ModuleReplicationAdapter[], departmentId: string) {
  const installed = await pool.query<{ module_id: string; version: string | null }>(`SELECT module.module_id,module.version FROM installation_modules module
    JOIN installations installation ON installation.id=module.installation_id AND installation.is_current=TRUE
    JOIN departments department ON department.installation_id=installation.id AND department.id=$1
    WHERE (module.enabled=TRUE OR module.required=TRUE)
      AND (module.required=TRUE OR module.client_managed=FALSE OR module.module_id=ANY(department.enabled_modules))
    ORDER BY module.module_id`, [departmentId]);
  const adapterMap = new Map(adapters.map((adapter) => [adapter.moduleId, adapter]));
  const enabled = installed.rows.filter((item) => item.module_id !== "sync");
  const modules: RedundancyModuleManifestEntry[] = [];
  const blockers: string[] = [];
  for (const item of enabled) {
    const adapter = adapterMap.get(item.module_id);
    if (!adapter) { blockers.push(`${item.module_id} has no installed replication adapter.`); continue; }
    const status = await adapter.inspect(departmentId);
    if (!status.ready) blockers.push(...status.blockers.map((blocker) => `${adapter.moduleName}: ${blocker}`));
    modules.push({ moduleId: adapter.moduleId, schemaVersion: await adapterSchemaVersion(adapter, departmentId), installedVersion: item.version ?? "unknown" });
  }
  const core = adapterMap.get("core-site");
  if (!core) blockers.push("The core site-data adapter is missing.");
  else {
    const status = await core.inspect(departmentId);
    if (!status.ready) blockers.push(...status.blockers.map((blocker) => `${core.moduleName}: ${blocker}`));
    modules.unshift({ moduleId: core.moduleId, schemaVersion: await adapterSchemaVersion(core, departmentId), installedVersion: core.schemaVersion });
  }
  return { modules, blockers, adapters: adapterMap };
}

function authorized(request: FastifyRequest) {
  return request.authenticatedUser?.role === "server_admin" || request.authenticatedUser?.serverPermissions.includes("server_manage") === true;
}

function requireManager(request: FastifyRequest, reply: FastifyReply) {
  if (authorized(request)) return true;
  reply.code(403).send({ error: "Server management permission is required to manage Sync peers." });
  return false;
}

function json(reply: FastifyReply, status: number, value: unknown, identity: Awaited<ReturnType<typeof getIdentity>>, nonce = "") {
  const body = JSON.stringify(value);
  reply.code(status).header("content-type", "application/json; charset=utf-8").header("cache-control", "no-store")
    .header("x-sc-protocol", protocolVersion)
    .header("x-sc-response-signature", signBytes(identity.privateKeyPem, canonicalResponse(status, nonce, body)));
  return reply.send(body);
}

function normalizeBaseUrl(input: unknown) {
  if (typeof input !== "string" || input.length > 512) throw new Error("Enter a valid Smart-Church server URL.");
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("Enter a valid Smart-Church server URL."); }
  if (!new Set(["http:", "https:"]).has(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Use a server origin such as https://church.example.org, without a path, query, or credentials.");
  const isLoopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname.toLowerCase());
  if (process.env.NODE_ENV === "production" && (url.protocol !== "https:" || isLoopback)) throw new Error("Production peers must use HTTPS with a reachable server name or address.");
  return url.origin;
}

function advertisedPeerBaseUrl(request: FastifyRequest) {
  const configured = process.env.SMART_CHURCH_SYNC_PEER_BASE_URL?.trim() || "auto";
  if (configured.toLowerCase() === "outbound-only") return null;
  if (configured.toLowerCase() !== "auto") return normalizeBaseUrl(configured);
  if (process.env.NODE_ENV !== "production") return null;
  return normalizeBaseUrl(process.env.SMART_CHURCH_WEB_ORIGIN?.trim() || `${request.protocol}://${request.headers.host}`);
}

function peerIdentity(value: unknown): FederationIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The remote server returned an invalid identity.");
  const row = value as Record<string, unknown>;
  if (typeof row.installationId !== "string" || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(row.installationId)
    || typeof row.displayName !== "string" || row.displayName.length > 200
    || typeof row.publicKeyPem !== "string" || row.publicKeyPem.length > 4096
    || typeof row.fingerprint !== "string" || row.protocolVersion !== protocolVersion) throw new Error("The remote server returned an unsupported or malformed identity.");
  const fingerprint = fingerprintPublicKey(row.publicKeyPem);
  if (fingerprint !== row.fingerprint) throw new Error("The remote server's public key does not match its fingerprint.");
  let encryptionPublicKeyPem: string | undefined;
  if (row.encryptionPublicKeyPem !== undefined) {
    if (typeof row.encryptionPublicKeyPem !== "string" || row.encryptionPublicKeyPem.length > 4096) throw new Error("The remote server returned a malformed snapshot-encryption key.");
    const encryptionKey = createPublicKey(row.encryptionPublicKeyPem);
    if (encryptionKey.asymmetricKeyType !== "x25519") throw new Error("The remote server returned an unsupported snapshot-encryption key.");
    encryptionPublicKeyPem = row.encryptionPublicKeyPem;
  }
  return { installationId: row.installationId, displayName: row.displayName, publicKeyPem: row.publicKeyPem, fingerprint, protocolVersion, ...(encryptionPublicKeyPem ? { encryptionPublicKeyPem } : {}) };
}

async function readRemoteJson<T>(response: Response, publicKeyPem: string, nonce = "") {
  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > maxPeerBodyBytes) throw new Error("The remote server response exceeds the size limit.");
  const signature = response.headers.get("x-sc-response-signature");
  if (!response.ok && (!signature || response.headers.get("x-sc-protocol") !== protocolVersion)) {
    throw new Error(`The remote server returned HTTP ${response.status} without a valid signed response.`);
  }
  if (response.headers.get("x-sc-protocol") !== protocolVersion || !signature || !verifyBytes(publicKeyPem, canonicalResponse(response.status, nonce, body), signature)) {
    throw new Error("The remote server response signature could not be verified.");
  }
  let data: T;
  try { data = JSON.parse(body) as T; } catch { throw new Error("The remote server returned an invalid response."); }
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data && typeof (data as { error?: unknown }).error === "string" ? (data as { error: string }).error : "The remote server rejected the request.";
    throw new Error(message);
  }
  return data;
}

async function remoteIdentity(baseUrl: string, trustedPeer?: RemotePeerAddress, localIdentity?: Awaited<ReturnType<typeof getIdentity>>) {
  if (trustedPeer && localIdentity && activeFederationChannels) {
    const timestamp = String(Date.now());
    const nonce = randomBytes(24).toString("base64url");
    const headers: Record<string, string> = {
      accept: "application/json",
      "x-sc-protocol": protocolVersion,
      "x-sc-installation": localIdentity.installationId,
      "x-sc-timestamp": timestamp,
      "x-sc-nonce": nonce,
      "x-sc-signature": signBytes(localIdentity.privateKeyPem, canonicalRequest("GET", `${prefix}/identity`, timestamp, nonce, "")),
    };
    const tunneled = await activeFederationChannels.request(trustedPeer, "GET", `${prefix}/identity`, headers, "", 12_000);
    const response = new Response(tunneled.body, { status: tunneled.status, headers: tunneled.headers });
    const raw = await readRemoteJson<IdentityPayload>(response, trustedPeer.public_key_pem, nonce);
    const remote = peerIdentity(raw);
    if (remote.installationId !== trustedPeer.installation_id) throw new Error("The identity returned over the federation channel does not match this trusted peer.");
    return remote;
  }
  // Plain HTTPS is intentionally limited to discovering a key before this
  // installation is trusted. Every authenticated peer request uses WebSocket.
  const response = await fetch(`${baseUrl}${prefix}/identity`, { method: "GET", headers: { accept: "application/json" }, signal: AbortSignal.timeout(12_000), redirect: "error" });
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maxPeerBodyBytes) throw new Error("The remote identity response exceeds the size limit.");
  if (!response.ok) throw new Error(`The remote server identity endpoint returned HTTP ${response.status}.`);
  let raw: IdentityPayload;
  try { raw = JSON.parse(text) as IdentityPayload; } catch { throw new Error("The address did not return a Smart-Church Sync identity."); }
  const remote = peerIdentity(raw);
  const signature = response.headers.get("x-sc-response-signature");
  if (response.headers.get("x-sc-protocol") !== protocolVersion || !signature || !verifyBytes(remote.publicKeyPem, canonicalResponse(response.status, "", text), signature)) {
    throw new Error("The remote server identity signature could not be verified.");
  }
  return remote;
}

async function signedRemoteRequest<T>(peer: RemotePeerAddress, identity: Awaited<ReturnType<typeof getIdentity>>, method: string, path: string, body = "", timeoutMs = 12_000) {
  const timestamp = String(Date.now());
  const nonce = randomBytes(24).toString("base64url");
  const headers: Record<string, string> = {
    accept: "application/json",
    "x-sc-protocol": protocolVersion,
    "x-sc-installation": identity.installationId,
    "x-sc-timestamp": timestamp,
    "x-sc-nonce": nonce,
    "x-sc-signature": signBytes(identity.privateKeyPem, canonicalRequest(method, path, timestamp, nonce, body)),
  };
  if (body) headers["content-type"] = "application/json";
  if (!activeFederationChannels) throw new Error("The authenticated federation WebSocket service is not ready.");
  const tunneled = await activeFederationChannels.request(peer, method, path, headers, body, timeoutMs);
  const response = new Response(tunneled.body, { status: tunneled.status, headers: tunneled.headers });
  return readRemoteJson<T>(response, peer.public_key_pem, nonce);
}

async function bootstrapRemoteStatus(peer: RemotePeerAddress, identity: Awaited<ReturnType<typeof getIdentity>>, timeoutMs = 12_000) {
  if (!peer.base_url) throw new Error("This peer has no reachable HTTPS address for trust bootstrap.");
  // Pending trust cannot use the authenticated WebSocket RPC channel yet.
  const path = `${prefix}/status`;
  const timestamp = String(Date.now());
  const nonce = randomBytes(24).toString("base64url");
  const headers = {
    accept: "application/json",
    "x-sc-protocol": protocolVersion,
    "x-sc-installation": identity.installationId,
    "x-sc-timestamp": timestamp,
    "x-sc-nonce": nonce,
    "x-sc-signature": signBytes(identity.privateKeyPem, canonicalRequest("GET", path, timestamp, nonce, "")),
  };
  const response = await fetch(`${peer.base_url}${path}`, { method: "GET", headers, signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
  return readRemoteJson<{ installationId: string; peerInstallationId: string; peerTrustState: string; peerFingerprint: string; protocolVersion: string }>(response, peer.public_key_pem, nonce);
}

async function signedRemoteSnapshotRequest(peer: RemotePeerAddress, identity: Awaited<ReturnType<typeof getIdentity>>, path: string, body: string, timeoutMs = 300_000) {
  const method = "POST";
  const timestamp = String(Date.now());
  const nonce = randomBytes(24).toString("base64url");
  const requestHeaders = {
      accept: "application/vnd.smart-church.redundancy-snapshot, application/json",
      "content-type": "application/json",
      "x-sc-protocol": protocolVersion,
      "x-sc-installation": identity.installationId,
      "x-sc-timestamp": timestamp,
      "x-sc-nonce": nonce,
      "x-sc-signature": signBytes(identity.privateKeyPem, canonicalRequest(method, path, timestamp, nonce, body)),
    };
  if (!activeFederationChannels) throw new Error("The authenticated federation WebSocket service is not ready.");
  const response = await activeFederationChannels.requestBinary(peer, method, path, requestHeaders, body, timeoutMs);
  const bytes = response.bytes;
  if (bytes.length > maxRedundancyBytes || response.headers["x-sc-protocol"] !== protocolVersion) throw new Error("The remote redundancy snapshot response is invalid or exceeds the transfer limit.");
  const signature = response.headers["x-sc-response-signature"];
  if (!signature || !verifyBytes(peer.public_key_pem, canonicalResponse(response.status, nonce, bytes), signature)) throw new Error("The remote snapshot response signature could not be verified.");
  if (response.status < 200 || response.status >= 300) {
    try {
      const parsed = JSON.parse(bytes.toString("utf8")) as { error?: unknown };
      if (typeof parsed.error === "string") throw new Error(parsed.error);
    } catch (error) {
      if (error instanceof Error && error.message !== "Unexpected end of JSON input") throw error;
    }
    throw new Error("The remote server rejected the redundancy snapshot request.");
  }
  return { contentType: response.headers["content-type"]?.split(";", 1)[0] ?? "", bytes };
}

async function applyRedundancySnapshot(
  app: FastifyInstance,
  pool: import("pg").Pool,
  context: ModuleServerContext,
  identity: Awaited<ReturnType<typeof getIdentity>>,
  sourceInstallationId: string,
  snapshotId: string,
  sourceDepartmentId: string,
  targetDepartmentId: string,
  sourceEpoch: number,
  sourceSnapshotRevision: string,
  sourceDigest: string,
  modules: Record<string, unknown>,
  moduleManifest: RedundancyModuleManifestEntry[],
) {
  if (!Number.isSafeInteger(sourceEpoch) || sourceEpoch < 1 || !/^\d{1,19}$/.test(sourceSnapshotRevision) || BigInt(sourceSnapshotRevision) < 1n || !/^[0-9a-f]{64}$/.test(sourceDigest) || !Array.isArray(moduleManifest) || moduleManifest.length < 1 || moduleManifest.length > 100) throw new Error("The pulled snapshot metadata is invalid.");
  const client = await pool.connect();
  const commitCallbacks: Array<() => Promise<void>> = [];
  const rollbackCallbacks: Array<() => Promise<void>> = [];
  let transactionCommitted = false;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL smart_church.redundancy_restore='on'");
    await client.query("SET CONSTRAINTS ALL DEFERRED");
    const site = await client.query<{ role: string; upstream_installation_id: string | null; upstream_department_id: string | null; site_epoch: string; snapshot_revision: string }>("SELECT role,upstream_installation_id,upstream_department_id,site_epoch::text,snapshot_revision::text FROM sync_site_redundancy WHERE department_id=$1 FOR UPDATE", [targetDepartmentId]);
    const current = site.rows[0];
    if (current?.role !== "standby" || current.upstream_installation_id !== sourceInstallationId || current.upstream_department_id !== sourceDepartmentId || sourceEpoch < Number(current.site_epoch)
      || (sourceEpoch === Number(current.site_epoch) && BigInt(sourceSnapshotRevision) <= BigInt(current.snapshot_revision))) throw new Error("The standby relationship, source epoch, or snapshot revision changed during the restore; stale snapshots are rejected.");
    const adapters = new Map(context.replication.list().map((adapter) => [adapter.moduleId, adapter]));
    if (!moduleManifest.some((module) => module.moduleId === "core-site") || !await manifestSupportedByAdapters(moduleManifest, adapters, targetDepartmentId)) throw new Error("The standby does not have compatible data adapters for the source snapshot.");
    const entries = [...moduleManifest].sort((left, right) => left.moduleId === "core-site" ? -1 : right.moduleId === "core-site" ? 1 : left.moduleId.localeCompare(right.moduleId));
    if (entries.some((entry) => !(entry.moduleId in modules)) || Object.keys(modules).length !== entries.length) throw new Error("The snapshot does not contain exactly the modules in its signed manifest.");
    const restoreContext = {
      userIdMap: new Map<string, string>(),
      onCommit: (callback: () => Promise<void>) => commitCallbacks.push(callback),
      onRollback: (callback: () => Promise<void>) => rollbackCallbacks.push(callback),
    };
    const restoredSnapshots: Record<string, unknown> = {};
    for (const entry of entries) {
      const adapter = adapters.get(entry.moduleId);
      if (!adapter || await adapterSchemaVersion(adapter, targetDepartmentId) !== entry.schemaVersion) throw new Error(`The ${entry.moduleId} snapshot adapter is missing or incompatible.`);
      const moduleSnapshot = adapter.restoreSnapshotFromPeer
        ? await adapter.restoreSnapshotFromPeer(modules[entry.moduleId], (envelope) => openFromPeer(identity.encryptionPrivateKeyPem, String(envelope)))
        : modules[entry.moduleId];
      await adapter.restoreSnapshot(client, targetDepartmentId, moduleSnapshot, restoreContext);
      const verified = await adapter.verifySnapshot(client, targetDepartmentId, moduleSnapshot, restoreContext);
      if (!verified.ready) throw new Error(`${adapter.moduleName} restore verification failed: ${verified.blockers.join(" ")}`);
      restoredSnapshots[entry.moduleId] = await adapter.exportSnapshot(client, targetDepartmentId);
    }
    const digest = replicationDigest(restoredSnapshots);
    await client.query("UPDATE sync_site_redundancy SET primary_installation_id=$2,former_standby_installation_id=NULL,former_standby_department_id=NULL,site_epoch=$3,snapshot_revision=$4,last_snapshot_id=$5,last_replica_digest=$6,last_source_digest=$7,last_replica_manifest=$8::jsonb,last_snapshot_at=now(),last_verified_at=now(),last_error=NULL,updated_at=now() WHERE department_id=$1", [targetDepartmentId, sourceInstallationId, sourceEpoch, sourceSnapshotRevision, snapshotId, digest, sourceDigest, JSON.stringify(moduleManifest)]);
    await client.query("INSERT INTO sync_redundancy_audit(id,department_id,action,new_epoch,source_installation_id,note) VALUES($1,$2,'snapshot_applied',$3,$4,'Verified module-owned full-site snapshot applied.')", [randomUUID(), targetDepartmentId, sourceEpoch, sourceInstallationId]);
    await client.query("COMMIT");
    transactionCommitted = true;
    for (const callback of commitCallbacks) await callback().catch((error) => app.log.warn({ err: error, module: "sync" }, "A module cleanup after successful snapshot restore failed."));
    return { applied: true as const, snapshotId, siteEpoch: String(sourceEpoch), verifiedAt: new Date().toISOString() };
  } catch (error) {
    if (!transactionCommitted) {
      await client.query("ROLLBACK").catch(() => undefined);
      for (const callback of rollbackCallbacks.reverse()) await callback().catch((rollbackError) => app.log.error({ err: rollbackError, module: "sync" }, "A module file rollback after failed snapshot restore failed."));
    }
    throw error;
  } finally { client.release(); }
}

async function pullRedundancySnapshot(app: FastifyInstance, pool: import("pg").Pool, context: ModuleServerContext, siteName: string, departmentId: string, peer: PeerRow, sourceDepartmentId: string) {
  const stateResult = await pool.query<{ role: string; upstream_installation_id: string | null; upstream_department_id: string | null; site_epoch: string; snapshot_revision: string; last_source_digest: string | null; last_replica_digest: string | null; last_replica_manifest: RedundancyModuleManifestEntry[] | null }>(
    "SELECT role,upstream_installation_id,upstream_department_id,site_epoch::text,snapshot_revision::text,last_source_digest,last_replica_digest,last_replica_manifest FROM sync_site_redundancy WHERE department_id=$1", [departmentId],
  );
  const state = stateResult.rows[0];
  if (!state || state.role !== "standby" || state.upstream_installation_id !== peer.installation_id || state.upstream_department_id !== sourceDepartmentId) throw new Error("This site is no longer configured as a standby for that primary.");
  const identity = await getIdentity(pool, siteName);
  const acknowledge = async (snapshotId: string, siteEpoch: number, sourceSnapshotRevision: string, sourceDigest: string) => signedRemoteRequest<{ accepted: boolean }>(
    peer, identity, "POST", `${prefix}/redundancy/pull-ack`, JSON.stringify({ sourceDepartmentId, targetDepartmentId: departmentId, snapshotId, siteEpoch, sourceSnapshotRevision, sourceDigest }),
  );
  const sourceStatus = await signedRemoteRequest<{ installationId: string; departmentId: string; role: string; siteEpoch: string; formerStandbyInstallationId: string | null; formerStandbyDepartmentId: string | null; pullAuthorizedForTarget?: boolean }>(
    peer, identity, "GET", `${prefix}/redundancy/capabilities?departmentId=${encodeURIComponent(sourceDepartmentId)}&targetDepartmentId=${encodeURIComponent(departmentId)}`,
  );
  const formerStandby = sourceStatus.formerStandbyInstallationId === identity.installationId
    && (!sourceStatus.formerStandbyDepartmentId || sourceStatus.formerStandbyDepartmentId === departmentId);
  if (sourceStatus.role !== "primary" || sourceStatus.installationId !== peer.installation_id || sourceStatus.departmentId !== sourceDepartmentId
    || (!formerStandby && sourceStatus.pullAuthorizedForTarget !== true)) return { skipped: true as const };
  const requestPath = `${prefix}/redundancy/pull-snapshot`;
  const requestFor = (knownSourceDigest: string | null, knownManifest: RedundancyModuleManifestEntry[] | null) => JSON.stringify({ sourceDepartmentId, targetDepartmentId: departmentId, knownEpoch: Number(state.site_epoch), knownSourceDigest, knownManifest, encryptionPublicKeyPem: identity.encryptionPublicKeyPem });
  let response = await signedRemoteSnapshotRequest(peer, identity, requestPath, requestFor(state.last_source_digest, state.last_replica_manifest));
  if (response.contentType === "application/json") {
    const unchanged = JSON.parse(response.bytes.toString("utf8")) as { unchanged?: unknown; siteEpoch?: unknown; sourceSnapshotRevision?: unknown; sourceDigest?: unknown; snapshotId?: unknown; moduleManifest?: RedundancyModuleManifestEntry[] };
    if (unchanged.unchanged !== true || unchanged.siteEpoch !== state.site_epoch || typeof unchanged.sourceSnapshotRevision !== "string" || !/^\d{1,19}$/.test(unchanged.sourceSnapshotRevision) || BigInt(unchanged.sourceSnapshotRevision) <= BigInt(state.snapshot_revision) || typeof unchanged.sourceDigest !== "string" || !state.last_source_digest || unchanged.sourceDigest !== state.last_source_digest || typeof unchanged.snapshotId !== "string" || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(unchanged.snapshotId) || !state.last_replica_digest || !state.last_replica_manifest || !Array.isArray(unchanged.moduleManifest)
      || manifestKey(unchanged.moduleManifest) !== manifestKey(state.last_replica_manifest)) throw new Error("The primary reported an unchanged snapshot, but the standby has no matching verified snapshot metadata.");
    const adapters = new Map(context.replication.list().map((adapter) => [adapter.moduleId, adapter]));
    if (!await manifestSupportedByAdapters(state.last_replica_manifest, adapters, departmentId)) throw new Error("The standby no longer has compatible adapters for its verified snapshot.");
    const client = await pool.connect();
    let currentSnapshots: Record<string, unknown>;
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      currentSnapshots = {};
      for (const item of state.last_replica_manifest) {
        const adapter = adapters.get(item.moduleId);
        if (!adapter) throw new Error(`The ${item.moduleId} replication adapter is unavailable.`);
        currentSnapshots[item.moduleId] = await adapter.exportSnapshot(client, departmentId);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    if (replicationDigest(currentSnapshots) !== state.last_replica_digest) {
      response = await signedRemoteSnapshotRequest(peer, identity, requestPath, requestFor(null, null));
      if (response.contentType === "application/json") throw new Error("The standby data changed, and the primary did not provide a replacement snapshot.");
    } else {
      const revisionUpdated = await pool.query("UPDATE sync_site_redundancy SET snapshot_revision=$2,last_verified_at=now(),last_error=NULL,updated_at=now() WHERE department_id=$1 AND role='standby' AND site_epoch=$3 AND snapshot_revision<$2", [departmentId, unchanged.sourceSnapshotRevision, unchanged.siteEpoch]);
      if (!revisionUpdated.rowCount) return { skipped: true as const };
      await acknowledge(unchanged.snapshotId, Number(unchanged.siteEpoch), unchanged.sourceSnapshotRevision, unchanged.sourceDigest);
      return { skipped: false as const, unchanged: true as const, verifiedAt: new Date().toISOString() };
    }
  }
  if (response.contentType !== "application/vnd.smart-church.redundancy-snapshot") throw new Error("The primary returned an unsupported redundancy snapshot format.");
  const plain = gunzipSync(response.bytes, { maxOutputLength: 1024 * 1024 * 1024 });
  const payload = JSON.parse(plain.toString("utf8")) as { sourceDepartmentId?: unknown; targetDepartmentId?: unknown; siteEpoch?: unknown; sourceSnapshotRevision?: unknown; sourceDigest?: unknown; snapshotId?: unknown; modules?: unknown; moduleManifest?: unknown };
  if (!payload || payload.sourceDepartmentId !== sourceDepartmentId || payload.targetDepartmentId !== departmentId || !Number.isSafeInteger(payload.siteEpoch) || typeof payload.sourceSnapshotRevision !== "string" || !/^\d{1,19}$/.test(payload.sourceSnapshotRevision) || typeof payload.sourceDigest !== "string" || !/^[0-9a-f]{64}$/.test(payload.sourceDigest)
    || typeof payload.snapshotId !== "string" || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(payload.snapshotId)
    || !payload.modules || typeof payload.modules !== "object" || Array.isArray(payload.modules) || !Array.isArray(payload.moduleManifest)) throw new Error("The primary returned an invalid redundancy snapshot payload.");
  const result = await applyRedundancySnapshot(app, pool, context, identity, peer.installation_id, payload.snapshotId, sourceDepartmentId, departmentId, Number(payload.siteEpoch), payload.sourceSnapshotRevision, payload.sourceDigest, payload.modules as Record<string, unknown>, payload.moduleManifest as RedundancyModuleManifestEntry[]);
  await acknowledge(payload.snapshotId, Number(payload.siteEpoch), payload.sourceSnapshotRevision, payload.sourceDigest);
  return { skipped: false as const, unchanged: false as const, ...result };
}

async function pushRedundancySnapshot(pool: import("pg").Pool, context: ModuleServerContext, siteName: string, departmentId: string, peer: RemotePeerAddress & { fingerprint: string }, targetDepartmentId: string) {
  const lockClient = await pool.connect();
  const lockName = redundancySnapshotLockName(departmentId, peer.installation_id, targetDepartmentId);
  let locked = false;
  try {
    const lock = await lockClient.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked", [lockName]);
    locked = lock.rows[0]?.locked === true;
    if (!locked) return { skipped: true as const, reason: "A snapshot transfer for this standby is already running." };
    const localState = await pool.query<{ role: string; site_epoch: string }>("SELECT role,site_epoch::text FROM sync_site_redundancy WHERE department_id=$1", [departmentId]);
    if (localState.rows[0]?.role !== "primary") throw new Error("Only a writable primary can push a redundancy snapshot.");
    const revision = await nextSnapshotRevision(pool, departmentId, localState.rows[0].site_epoch);
    const identity = await getIdentity(pool, siteName);
    const local = await redundancyManifest(pool, context.replication.list(), departmentId);
    if (local.blockers.length) throw new Error(`The primary is not ready to create a complete site snapshot: ${local.blockers.join(" ")}`);
    const remoteIdentityRecord = await remoteIdentity(peer.base_url ?? "", peer, identity);
    if (remoteIdentityRecord.installationId !== peer.installation_id || remoteIdentityRecord.fingerprint !== peer.fingerprint) throw new Error("The standby server identity changed. Verify it out of band and pair it again before sending site data.");
    const remote = await signedRemoteRequest<{ installationId: string; departmentId: string; role: string; upstreamInstallationId: string | null; upstreamDepartmentId: string | null; siteEpoch: string; snapshotRevision: string; lastSnapshotId: string | null; lastSnapshotAt: string | null; lastVerifiedAt: string | null; lastSourceDigest: string | null; modules: RedundancyModuleManifestEntry[]; ready: boolean; blockers: string[] }>(peer, identity, "GET", `${prefix}/redundancy/capabilities?departmentId=${encodeURIComponent(targetDepartmentId)}`);
    if (remote.role !== "standby" || remote.upstreamInstallationId !== identity.installationId || remote.upstreamDepartmentId !== departmentId || remote.installationId !== peer.installation_id || remote.departmentId !== targetDepartmentId) throw new Error("The destination has not been configured as this site's standby.");
    const remoteAdapters = new Map(remote.modules.map((module) => [module.moduleId, { moduleId: module.moduleId, schemaVersion: module.schemaVersion } as ModuleReplicationAdapter]));
    if (!await manifestSupportedByAdapters(local.modules, remoteAdapters, targetDepartmentId)) throw new Error("The standby does not have compatible data adapters for every module enabled on the primary. Module activation can differ between servers; required module data schemas must be installed on both.");
    const client = await pool.connect();
    let snapshot: Record<string, unknown>;
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      snapshot = {};
      for (const module of local.modules) {
        const adapter = local.adapters.get(module.moduleId);
        if (!adapter) throw new Error(`The ${module.moduleId} replication adapter is unavailable.`);
        snapshot[module.moduleId] = await adapter.exportSnapshot(client, departmentId);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    const sourceDigest = sourceSnapshotDigest(snapshot);
    if (remote.siteEpoch === localState.rows[0].site_epoch && remote.lastSourceDigest === sourceDigest && remote.lastSnapshotId) {
      const verification = await signedRemoteRequest<{ verified: boolean; verifiedAt?: string }>(peer, identity, "POST", `${prefix}/redundancy/verify`, JSON.stringify({ departmentId: targetDepartmentId, sourceEpoch: Number(localState.rows[0].site_epoch), sourceSnapshotRevision: revision.snapshot_revision, sourceDigest }), 120_000);
      if (verification.verified && verification.verifiedAt) {
        await pool.query(`INSERT INTO sync_site_redundancy_replicas(department_id,peer_installation_id,peer_department_id,last_snapshot_id,source_snapshot_revision,source_digest,last_snapshot_at,last_verified_at,last_error,updated_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,NULL,now())
          ON CONFLICT(department_id,peer_installation_id,peer_department_id) DO UPDATE SET last_snapshot_id=EXCLUDED.last_snapshot_id,source_snapshot_revision=EXCLUDED.source_snapshot_revision,source_digest=EXCLUDED.source_digest,last_snapshot_at=EXCLUDED.last_snapshot_at,last_verified_at=EXCLUDED.last_verified_at,last_error=NULL,updated_at=now()`, [departmentId, peer.installation_id, targetDepartmentId, remote.lastSnapshotId, revision.snapshot_revision, sourceDigest, remote.lastSnapshotAt, verification.verifiedAt]);
        return { skipped: false as const, unchanged: true as const, snapshotId: remote.lastSnapshotId, moduleCount: local.modules.length, byteCount: 0, verifiedAt: verification.verifiedAt };
      }
    }
    const transferSnapshot: Record<string, unknown> = {};
    for (const module of local.modules) {
      const adapter = local.adapters.get(module.moduleId)!;
      const moduleSnapshot = snapshot[module.moduleId];
      transferSnapshot[module.moduleId] = adapter.prepareSnapshotForPeer
        ? await adapter.prepareSnapshotForPeer(moduleSnapshot, (plaintext) => {
          if (!remoteIdentityRecord.encryptionPublicKeyPem) throw new Error(`${adapter.moduleName} contains credentials, but the standby does not support encrypted credential transfer. Update both servers before syncing.`);
          return sealForPeer(remoteIdentityRecord.encryptionPublicKeyPem, plaintext);
        })
        : moduleSnapshot;
    }
    const payloadText = JSON.stringify({ sourceDepartmentId: departmentId, targetDepartmentId, siteEpoch: Number(localState.rows[0].site_epoch), sourceSnapshotRevision: revision.snapshot_revision, sourceDigest, modules: transferSnapshot });
    const plain = Buffer.from(payloadText, "utf8");
    if (plain.length > 1024 * 1024 * 1024) throw new Error("The uncompressed site snapshot exceeds the 1 GiB safety limit.");
    const compressed = gzipSync(plain, { level: 6 });
    if (compressed.length > maxRedundancyBytes) throw new Error("The compressed site snapshot exceeds the 256 MiB transfer limit.");
    const snapshotId = randomUUID();
    const chunkCount = Math.ceil(compressed.length / redundancyChunkBytes);
    const started = await signedRemoteRequest<{ accepted: boolean }>(peer, identity, "POST", `${prefix}/redundancy/imports`, JSON.stringify({ snapshotId, sourceDepartmentId: departmentId, targetDepartmentId, sourceEpoch: Number(localState.rows[0].site_epoch), sourceSnapshotRevision: revision.snapshot_revision, chunkCount, byteCount: compressed.length, sha256: createHash("sha256").update(compressed).digest("hex"), modules: local.modules }));
    if (!started.accepted) throw new Error("The standby did not accept the snapshot manifest.");
    for (let index = 0; index < chunkCount; index += 1) {
      const data = compressed.subarray(index * redundancyChunkBytes, Math.min(compressed.length, (index + 1) * redundancyChunkBytes)).toString("base64");
      await signedRemoteRequest(peer, identity, "POST", `${prefix}/redundancy/imports/${snapshotId}/chunks`, JSON.stringify({ index, data }));
    }
    const complete = await signedRemoteRequest<{ applied: boolean; verifiedAt: string }>(peer, identity, "POST", `${prefix}/redundancy/imports/${snapshotId}/complete`, "{}", 300_000);
    if (!complete.applied) throw new Error("The standby did not verify the full site snapshot.");
    await pool.query("UPDATE sync_site_redundancy SET last_snapshot_id=$2,last_snapshot_at=now(),last_error=NULL,updated_at=now() WHERE department_id=$1 AND role='primary'", [departmentId, snapshotId]);
    await pool.query(`INSERT INTO sync_site_redundancy_replicas(department_id,peer_installation_id,peer_department_id,last_snapshot_id,source_snapshot_revision,source_digest,last_snapshot_at,last_verified_at,last_error,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,now(),$7,NULL,now())
      ON CONFLICT(department_id,peer_installation_id,peer_department_id) DO UPDATE SET last_snapshot_id=EXCLUDED.last_snapshot_id,source_snapshot_revision=EXCLUDED.source_snapshot_revision,source_digest=EXCLUDED.source_digest,last_snapshot_at=EXCLUDED.last_snapshot_at,last_verified_at=EXCLUDED.last_verified_at,last_error=NULL,updated_at=now()`, [departmentId, peer.installation_id, targetDepartmentId, snapshotId, revision.snapshot_revision, sourceDigest, complete.verifiedAt]);
    return { skipped: false as const, unchanged: false as const, snapshotId, moduleCount: local.modules.length, byteCount: compressed.length, verifiedAt: complete.verifiedAt };
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 500) : "The redundancy snapshot could not be transferred.";
    await pool.query("UPDATE sync_site_redundancy SET last_error=$2,updated_at=now() WHERE department_id=$1", [departmentId, reason]).catch(() => undefined);
    await pool.query(`INSERT INTO sync_site_redundancy_replicas(department_id,peer_installation_id,peer_department_id,last_error,updated_at)
      VALUES($1,$2,$3,$4,now()) ON CONFLICT(department_id,peer_installation_id,peer_department_id) DO UPDATE SET last_error=EXCLUDED.last_error,updated_at=now()`, [departmentId, peer.installation_id, targetDepartmentId, reason]).catch(() => undefined);
    throw error;
  } finally {
    if (locked) await lockClient.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [lockName]).catch(() => undefined);
    lockClient.release();
  }
}

async function verifySignedPeer(request: FastifyRequest, client: PoolClient | import("pg").Pool, allowPending = false) {
  const channelAuthorized = typeof request.headers["x-sc-internal-federation-channel"] === "string"
    && request.headers["x-sc-internal-federation-channel"] === federationInternalRequestToken;
  if (!channelAuthorized && request.url !== `${prefix}/status`) return null;
  const installation = request.headers["x-sc-installation"];
  const timestamp = request.headers["x-sc-timestamp"];
  const nonce = request.headers["x-sc-nonce"];
  const signature = request.headers["x-sc-signature"];
  if (typeof installation !== "string" || typeof timestamp !== "string" || typeof nonce !== "string" || typeof signature !== "string"
    || request.headers["x-sc-protocol"] !== protocolVersion
    || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(installation)
    || !/^\d{13}$/.test(timestamp) || !/^[A-Za-z0-9_-]{32,128}$/.test(nonce) || !/^[A-Za-z0-9_-]{80,256}$/.test(signature)
    || Math.abs(Date.now() - Number(timestamp)) > maxClockSkewMs) return null;
  const result = await client.query<{ public_key_pem: string; trust_state: string }>("SELECT public_key_pem, trust_state FROM sync_peers WHERE installation_id=$1", [installation]);
  const peer = result.rows[0];
  if (!peer || peer.trust_state === "revoked" || (!allowPending && peer.trust_state !== "trusted")) return null;
  const method = request.method.toUpperCase();
  const path = request.url;
  const contentType = request.headers["content-type"];
  if (contentType && !contentType.toLowerCase().startsWith("application/json")) return null;
  const body = request.body === undefined ? "" : JSON.stringify(request.body);
  if (Buffer.byteLength(body, "utf8") > maxPeerBodyBytes || !verifyBytes(peer.public_key_pem, canonicalRequest(method, path, timestamp, nonce, body), signature)) return null;
  const inserted = await client.query(
    "INSERT INTO sync_request_nonces(installation_id,nonce,expires_at) VALUES($1,$2,to_timestamp($3/1000.0)+interval '10 minutes') ON CONFLICT DO NOTHING RETURNING nonce",
    [installation, nonce, Number(timestamp)],
  );
  if (!inserted.rowCount) return null;
  await client.query("UPDATE sync_peers SET last_seen_at=now(),last_error=NULL WHERE installation_id=$1", [installation]);
  return { installationId: installation, trustState: peer.trust_state };
}

function checkBodyString(value: unknown, maxLength: number, label: string) {
  if (typeof value !== "string" || value.length > maxLength) throw new Error(`Enter a valid ${label}.`);
  return value;
}

async function snapshotRecords(pool: import("pg").Pool, departmentId: string, scopes: string[]): Promise<SyncRecord[]> {
  const records: SyncRecord[] = [];
  for (const scope of scopes) {
    if (scope === "people_names") {
      const people = await pool.query<{ id: string; first_name: string; last_name: string; status: string; updated_at: Date | string }>(
        "SELECT id,first_name,last_name,status,updated_at FROM contacts WHERE department_id=$1 ORDER BY id LIMIT 10001", [departmentId],
      );
      records.push(...people.rows.map((person) => ({ scope: "people_names" as const, sourceId: person.id, sourceRevision: new Date(person.updated_at).toISOString(), record: { firstName: person.first_name, lastName: person.last_name, status: person.status } })));
    } else if (scope === "services") {
      const events = await pool.query<{ id: string; title: string; kind: string; event_date: string; start_time: string; end_time: string | null; location: string; description: string | null; updated_at: Date | string }>(
        "SELECT id,title,kind,event_date::text,start_time::text,end_time::text,location,description,updated_at FROM service_events WHERE department_id=$1 ORDER BY id LIMIT 10001", [departmentId],
      );
      records.push(...events.rows.map((event) => ({ scope: "services" as const, sourceId: event.id, sourceRevision: new Date(event.updated_at).toISOString(), record: { title: event.title, kind: event.kind, eventDate: event.event_date, startTime: event.start_time, endTime: event.end_time, location: event.location, description: event.description } })));
    }
  }
  if (records.length > maxSnapshotRecords) throw new Error(`The selected share exceeds the current ${maxSnapshotRecords.toLocaleString()}-record snapshot limit.`);
  return records;
}

function parseSyncRecords(value: unknown, allowedScopes: string[]): SyncRecord[] {
  if (!Array.isArray(value) || value.length > syncPageSize) throw new Error("The peer sent an invalid or oversized record page.");
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("The peer sent an invalid record.");
    const row = item as Record<string, unknown>;
    if ((row.scope !== "people_names" && row.scope !== "services") || !allowedScopes.includes(row.scope)
      || typeof row.sourceId !== "string" || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(row.sourceId)
      || typeof row.sourceRevision !== "string" || !Number.isFinite(Date.parse(row.sourceRevision))
      || !row.record || typeof row.record !== "object" || Array.isArray(row.record)) throw new Error("The peer sent a record outside the approved share scope.");
    const record = row.record as Record<string, unknown>;
    const keys = Object.keys(record).sort().join(",");
    if (row.scope === "people_names" && (keys !== "firstName,lastName,status" || typeof record.firstName !== "string" || record.firstName.length > 80 || typeof record.lastName !== "string" || record.lastName.length > 80 || !["member", "visitor"].includes(String(record.status)))) throw new Error("The peer sent invalid shared people fields.");
    if (row.scope === "services" && (!new Set(["description,endTime,eventDate,kind,location,startTime,title", "endTime,eventDate,kind,location,startTime,title"]).has(keys) || typeof record.title !== "string" || record.title.length > 160 || !["service", "meeting", "community", "other"].includes(String(record.kind)) || typeof record.eventDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(record.eventDate) || typeof record.startTime !== "string" || record.startTime.length > 16 || record.endTime !== null && record.endTime !== undefined && (typeof record.endTime !== "string" || record.endTime.length > 16) || typeof record.location !== "string" || record.location.length > 160 || record.description !== null && record.description !== undefined && (typeof record.description !== "string" || record.description.length > 2000))) throw new Error("The peer sent invalid shared service data.");
    return { scope: row.scope, sourceId: row.sourceId, sourceRevision: row.sourceRevision, record };
  });
}

async function storeStaging(pool: import("pg").Pool, runId: string, records: SyncRecord[]) {
  if (!records.length) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const record of records) await client.query(
      `INSERT INTO sync_replica_staging(run_id,scope,source_id,source_revision,record) VALUES($1,$2,$3,$4,$5::jsonb)
       ON CONFLICT(run_id,scope,source_id) DO UPDATE SET source_revision=EXCLUDED.source_revision,record=EXCLUDED.record`,
      [runId, record.scope, record.sourceId, record.sourceRevision, JSON.stringify(record.record)],
    );
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function finalizeReplica(pool: import("pg").Pool, subscriptionId: string, runId: string, sourceRevision: number, snapshotId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query("SELECT id FROM sync_subscriptions WHERE id=$1 AND current_run_id=$2 AND state='active' FOR UPDATE", [subscriptionId, runId]);
    if (!current.rowCount) throw new Error("The sync run is no longer active. Start a fresh sync.");
    await client.query("DELETE FROM sync_replica_records WHERE subscription_id=$1", [subscriptionId]);
    await client.query(
      `INSERT INTO sync_replica_records(subscription_id,scope,source_id,source_revision,record)
       SELECT $1,scope,source_id,source_revision,record FROM sync_replica_staging WHERE run_id=$2`, [subscriptionId, runId],
    );
    await client.query("DELETE FROM sync_replica_staging WHERE run_id=$1", [runId]);
    await client.query("UPDATE sync_subscriptions SET current_run_id=NULL,sync_started_at=NULL,last_synced_at=now(),last_error=NULL,source_revision=$2,last_snapshot_id=$3,updated_at=now() WHERE id=$1", [subscriptionId, sourceRevision, snapshotId]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export function registerModuleRoutes(app: FastifyInstance, context: ModuleServerContext) {
  if (!context.pool) return;
  const pool = context.pool;
  const siteName = process.env.SMART_CHURCH_DEPARTMENT_NAME?.trim() || "Smart-Church";
  federationInternalRequestToken = randomBytes(32).toString("base64url");
  const federationChannels = new FederationChannels(app, app.server, pool, () => getIdentity(pool, siteName), federationInternalRequestToken);
  activeFederationChannels = federationChannels;
  const unregisterFederationWorker = context.workers.register("federation-channel", () => ({
    status: federationChannels.connectedPeerCount() > 0 ? "ready" : "degraded",
    error: federationChannels.connectedPeerCount() > 0 ? null : "Waiting for an authenticated peer WebSocket channel.",
    uptimeSeconds: null,
    memory: null,
  }));
  app.addHook("onReady", async () => { await federationChannels.start(); });
  app.addHook("onClose", async () => {
    federationChannels.close();
    unregisterFederationWorker();
    if (activeFederationChannels === federationChannels) activeFederationChannels = null;
    if (federationInternalRequestToken) federationInternalRequestToken = "";
  });
  let automaticPushRunning = false;
  let automaticPushTimer: NodeJS.Timeout | null = null;
  let siteChangeListener: PoolClient | null = null;
  let siteChangeReconnectTimer: NodeJS.Timeout | null = null;
  let targetedPushTimer: NodeJS.Timeout | null = null;
  let automaticPushError: string | null = null;
  const queuedSitePushes = new Set<string>();
  context.workers.register("redundancy-push", () => ({
    status: automaticPushRunning ? "syncing" : automaticPushError ? "degraded" : "ready",
    error: automaticPushError,
    uptimeSeconds: null,
    memory: null,
  }));
  const runAutomaticPushes = async (onlyDepartmentId?: string) => {
    if (automaticPushRunning || !context.isDatabaseReady()) return;
    automaticPushRunning = true;
    automaticPushError = null;
    try {
      const primaries = await pool.query<{ department_id: string; site_epoch: string; primary_installation_id: string }>("SELECT department_id,site_epoch::text,primary_installation_id FROM sync_site_redundancy WHERE role='primary' AND ($1::uuid IS NULL OR department_id=$1) ORDER BY department_id", [onlyDepartmentId ?? null]);
      const peers = await pool.query<PeerRow>("SELECT * FROM sync_peers WHERE trust_state='trusted' ORDER BY installation_id");
      const identity = peers.rowCount ? await getIdentity(pool, siteName) : null;
      if (identity && primaries.rowCount) for (const peer of peers.rows) {
        let remoteSites: { installationId: string; sites: Array<{ id: string; role: string; primary_installation_id: string | null; upstream_installation_id: string | null; upstream_department_id: string | null; site_epoch: string }> };
        try { remoteSites = await signedRemoteRequest(peer, identity, "GET", `${prefix}/redundancy/sites`); }
        catch (error) {
          automaticPushError = error instanceof Error ? error.message.slice(0, 500) : "A trusted standby could not be reached.";
          await pool.query("UPDATE sync_site_redundancy_replicas SET last_error=$2,updated_at=now() WHERE peer_installation_id=$1", [peer.installation_id, automaticPushError]).catch(() => undefined);
          app.log.warn({ err: error, peer: peer.installation_id, module: "sync" }, "Automatic redundancy discovery failed.");
          continue;
        }
        if (remoteSites.installationId !== peer.installation_id) continue;
        for (const primary of primaries.rows) {
          const priorReplicas = await pool.query<{ peer_department_id: string }>("SELECT peer_department_id FROM sync_site_redundancy_replicas WHERE department_id=$1 AND peer_installation_id=$2", [primary.department_id, peer.installation_id]);
          const replicaSiteIds = new Set(priorReplicas.rows.map((replica) => replica.peer_department_id));
          const activeStandbyIds = new Set(remoteSites.sites.filter((site) => site.role === "standby" && site.upstream_installation_id === identity.installationId && site.upstream_department_id === primary.department_id).map((site) => site.id));
          for (const replica of priorReplicas.rows) if (!activeStandbyIds.has(replica.peer_department_id)) {
            await pool.query("UPDATE sync_site_redundancy_replicas SET last_error='The remote site is no longer configured as a standby for this primary.',updated_at=now() WHERE department_id=$1 AND peer_installation_id=$2 AND peer_department_id=$3", [primary.department_id, peer.installation_id, replica.peer_department_id]);
          }
          const counterpart = remoteSites.sites.find((site) => replicaSiteIds.has(site.id) && site.role === "primary");
          const hasValidRemoteEpoch = Boolean(counterpart && /^[1-9]\d{0,18}$/.test(counterpart.site_epoch));
          if (counterpart?.role === "primary" && counterpart.primary_installation_id === peer.installation_id && hasValidRemoteEpoch && BigInt(counterpart.site_epoch) > BigInt(primary.site_epoch)) {
            const client = await pool.connect();
            try {
              await client.query("BEGIN");
              const locked = await client.query<{ role: string; site_epoch: string }>("SELECT role,site_epoch::text FROM sync_site_redundancy WHERE department_id=$1 FOR UPDATE", [primary.department_id]);
              if (locked.rows[0]?.role === "primary" && BigInt(counterpart.site_epoch) > BigInt(locked.rows[0].site_epoch)) {
                await client.query("UPDATE sync_site_redundancy SET role='fenced',fenced_at=now(),last_error='Automatically fenced after a trusted peer reported a newer primary epoch.',updated_at=now() WHERE department_id=$1", [primary.department_id]);
                await client.query("INSERT INTO sync_redundancy_audit(id,department_id,action,old_epoch,new_epoch,source_installation_id,note) VALUES($1,$2,'fenced',$3,$4,$5,$6)", [randomUUID(), primary.department_id, locked.rows[0].site_epoch, counterpart.site_epoch, peer.installation_id, "Automatically fenced after an authenticated prior standby reported a newer primary epoch."]);
                await client.query("COMMIT");
              } else await client.query("ROLLBACK");
            } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
            finally { client.release(); }
            continue;
          }
          const standbys = remoteSites.sites.filter((site) => activeStandbyIds.has(site.id));
          for (const standby of standbys) {
            try { await pushRedundancySnapshot(pool, context, siteName, primary.department_id, peer, standby.id); }
            catch (error) {
              automaticPushError = error instanceof Error ? error.message.slice(0, 500) : "Automatic redundancy replication failed.";
              app.log.warn({ err: error, peer: peer.installation_id, departmentId: primary.department_id, module: "sync" }, "Automatic site redundancy push failed.");
            }
          }
        }
      }
      if (!onlyDepartmentId) {
      const standbyResult = await pool.query<{ department_id: string; upstream_installation_id: string; upstream_department_id: string; peer: PeerRow }>(
        `SELECT redundancy.department_id,redundancy.upstream_installation_id,redundancy.upstream_department_id,
                to_jsonb(peer) AS peer
           FROM sync_site_redundancy redundancy
           JOIN sync_peers peer ON peer.installation_id=redundancy.upstream_installation_id AND peer.trust_state='trusted'
          WHERE redundancy.role='standby' AND redundancy.upstream_department_id IS NOT NULL
          ORDER BY redundancy.department_id`,
      );
      for (const standby of standbyResult.rows) {
        const peer = standby.peer;
        const lockClient = await pool.connect();
        const lockName = `smart-church-redundancy-pull:${standby.department_id}:${peer.installation_id}:${standby.upstream_department_id}`;
        let locked = false;
        try {
          const lock = await lockClient.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked", [lockName]);
          locked = lock.rows[0]?.locked === true;
          if (!locked) continue;
          await pullRedundancySnapshot(app, pool, context, siteName, standby.department_id, peer, standby.upstream_department_id);
        } catch (error) {
          const reason = error instanceof Error ? error.message.slice(0, 500) : "Automatic standby rejoin failed.";
          automaticPushError = reason;
          await pool.query("UPDATE sync_site_redundancy SET last_error=$2,updated_at=now() WHERE department_id=$1 AND role='standby'", [standby.department_id, reason]).catch(() => undefined);
          app.log.warn({ err: error, peer: peer.installation_id, departmentId: standby.department_id, module: "sync" }, "Automatic standby snapshot pull failed.");
        } finally {
          if (locked) await lockClient.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [lockName]).catch(() => undefined);
          lockClient.release();
        }
      }
      }
    } catch (error) {
      automaticPushError = error instanceof Error ? error.message.slice(0, 500) : "Automatic redundancy replication failed.";
      app.log.error({ err: error, module: "sync" }, "Automatic site redundancy cycle failed.");
    } finally {
      automaticPushRunning = false;
      if (queuedSitePushes.size && !targetedPushTimer) targetedPushTimer = setTimeout(drainSitePushQueue, 100);
    }
  };

  function drainSitePushQueue() {
    targetedPushTimer = null;
    if (automaticPushRunning || !queuedSitePushes.size) return;
    const next = queuedSitePushes.values().next().value as string | undefined;
    if (!next) return;
    queuedSitePushes.delete(next);
    void runAutomaticPushes(next);
  }

  function enqueueSitePush(departmentId: string) {
    if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(departmentId)) return;
    queuedSitePushes.add(departmentId);
    if (!automaticPushRunning && !targetedPushTimer) targetedPushTimer = setTimeout(drainSitePushQueue, 250);
  }

  async function ensureSiteChangeListener() {
    if (siteChangeListener) return;
    const client = await pool.connect();
    try {
      await client.query("LISTEN smart_church_site_changed");
      client.on("notification", (notification) => {
        if (notification.channel === "smart_church_site_changed" && notification.payload) enqueueSitePush(notification.payload);
      });
      client.on("error", (error) => {
        if (siteChangeListener === client) siteChangeListener = null;
        client.release(error);
        app.log.warn({ err: error, module: "sync" }, "Site change notifications disconnected; periodic redundancy sync remains active.");
      });
      siteChangeListener = client;
    } catch (error) { client.release(); throw error; }
  }

  app.addHook("onReady", async () => {
    await installSiteChangeTriggers(pool);
    await ensureSiteChangeListener().catch((error) => app.log.warn({ err: error, module: "sync" }, "Site change notifications are unavailable; periodic redundancy sync remains active."));
    const configuredInterval = Number(process.env.SMART_CHURCH_REDUNDANCY_SYNC_INTERVAL_SECONDS ?? 60);
    const intervalMs = Number.isFinite(configuredInterval) ? Math.max(30, Math.min(240, configuredInterval)) * 1000 : 60_000;
    automaticPushTimer = setInterval(() => { void runAutomaticPushes(); }, intervalMs);
    automaticPushTimer.unref();
    siteChangeReconnectTimer = setInterval(() => { void ensureSiteChangeListener().catch(() => undefined); }, 10_000);
    siteChangeReconnectTimer.unref();
    void runAutomaticPushes();
  });
  app.addHook("onClose", async () => {
    if (automaticPushTimer) clearInterval(automaticPushTimer);
    if (siteChangeReconnectTimer) clearInterval(siteChangeReconnectTimer);
    if (targetedPushTimer) clearTimeout(targetedPushTimer);
    if (siteChangeListener) { await siteChangeListener.query("UNLISTEN smart_church_site_changed").catch(() => undefined); siteChangeListener.release(); siteChangeListener = null; }
  });

  app.get(`${prefix}/identity`, async (request, reply) => {
    try {
      const identity = await getIdentity(pool, siteName);
      const { privateKeyPem: _private, encryptionPrivateKeyPem: _encryptionPrivate, ...publicIdentity } = identity;
      if (request.headers["x-sc-installation"] !== undefined) {
        const sender = await verifySignedPeer(request, pool);
        if (!sender) return json(reply, 401, { error: "The signed peer request is invalid." }, identity, String(request.headers["x-sc-nonce"] ?? ""));
        return json(reply, 200, publicIdentity, identity, String(request.headers["x-sc-nonce"] ?? ""));
      }
      return json(reply, 200, publicIdentity, identity);
    } catch (error) { app.log.error({ err: error, module: "sync" }, "Could not load the local Sync identity."); return reply.code(503).send({ error: "The Sync identity is unavailable." }); }
  });

  app.post<{ Body: { pairingCode: string; identity: FederationIdentity; baseUrl?: string | null } }>(`${prefix}/pair`, {
    schema: { body: { type: "object", additionalProperties: false, required: ["pairingCode", "identity"], properties: { pairingCode: { type: "string", minLength: 32, maxLength: 128 }, identity: { type: "object" }, baseUrl: { anyOf: [{ type: "string", maxLength: 512 }, { type: "null" }] } } } },
  }, async (request, reply) => {
    const clientAddress = request.ip ?? "unknown";
    if (pairAttempts.size > 5000) for (const [key, value] of pairAttempts) if (value.expiresAt <= Date.now()) pairAttempts.delete(key);
    if (pairAttempts.size > 10000 && !pairAttempts.has(clientAddress)) return reply.code(503).send({ error: "The pairing service is busy. Try again later." });
    const attempt = pairAttempts.get(clientAddress);
    if (attempt && attempt.expiresAt > Date.now() && attempt.count >= 20) return reply.code(429).send({ error: "Too many pairing attempts. Try again later." });
    const next = attempt && attempt.expiresAt > Date.now() ? { count: attempt.count + 1, expiresAt: attempt.expiresAt } : { count: 1, expiresAt: Date.now() + 60 * 60_000 };
    pairAttempts.set(clientAddress, next);
    try {
      const requester = peerIdentity(request.body.identity);
      if (requester.installationId === (await getIdentity(pool, siteName)).installationId) return reply.code(400).send({ error: "An installation cannot pair with itself." });
      const advertisedBaseUrl = request.body.baseUrl?.trim();
      const baseUrl = advertisedBaseUrl ? normalizeBaseUrl(advertisedBaseUrl) : null;
      const code = checkBodyString(request.body.pairingCode, 128, "pairing code");
      const tokenHash = createHash("sha256").update(code, "utf8").digest("hex");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("DELETE FROM sync_pairing_invitations WHERE expires_at < now() OR used_at IS NOT NULL");
        const invite = await client.query<{ id: string }>("SELECT id FROM sync_pairing_invitations WHERE token_hash=$1 AND expires_at>now() AND used_at IS NULL FOR UPDATE", [tokenHash]);
        if (!invite.rowCount) { await client.query("ROLLBACK"); return reply.code(400).send({ error: "The invitation code is invalid, expired, or already used." }); }
        const existing = await client.query<{ public_key_pem: string; trust_state: string }>("SELECT public_key_pem,trust_state FROM sync_peers WHERE installation_id=$1 FOR UPDATE", [requester.installationId]);
        if (existing.rowCount && existing.rows[0].public_key_pem !== requester.publicKeyPem) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "This installation is already known with a different key. Verify a key rotation before pairing." }); }
        if (existing.rowCount && existing.rows[0].trust_state === "revoked") { await client.query("ROLLBACK"); return reply.code(409).send({ error: "This peer was revoked. A Server Administrator must review the existing trust record before pairing it again." }); }
        const acceptedInvite = await client.query("UPDATE sync_pairing_invitations SET used_at=now(),used_by=$2 WHERE id=$1 AND used_at IS NULL", [invite.rows[0].id, requester.installationId]);
        if (!acceptedInvite.rowCount) { await client.query("ROLLBACK"); return reply.code(400).send({ error: "The invitation code was already used." }); }
        await client.query(
          `INSERT INTO sync_peers(installation_id,display_name,base_url,public_key_pem,fingerprint,trust_state,direction)
           VALUES($1,$2,$3,$4,$5,'pending','incoming')
           ON CONFLICT(installation_id) DO UPDATE SET display_name=EXCLUDED.display_name,base_url=EXCLUDED.base_url,
             fingerprint=EXCLUDED.fingerprint,trust_state='pending',direction='incoming',requested_by=NULL,approved_by=NULL,
             created_at=now(),approved_at=NULL,revoked_at=NULL,last_error=NULL`,
          [requester.installationId, requester.displayName, baseUrl, requester.publicKeyPem, requester.fingerprint],
        );
        await client.query("INSERT INTO sync_peer_audit(id,peer_installation_id,action,fingerprint) VALUES($1,$2,'pair_requested',$3)", [randomUUID(), requester.installationId, requester.fingerprint]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
      const identity = await getIdentity(pool, siteName);
      return json(reply, 201, { paired: true, trustState: "pending", installationId: identity.installationId, fingerprint: identity.fingerprint }, identity);
    } catch (error) {
      if (error instanceof Error && /valid Smart-Church server URL|server origin/.test(error.message)) return reply.code(400).send({ error: error.message });
      app.log.warn({ module: "sync", error: error instanceof Error ? error.message : "pairing failed" }, "A peer pairing request was rejected.");
      return reply.code(400).send({ error: "The pairing request is invalid or could not be completed." });
    }
  });

  app.get(`${prefix}/status`, async (request, reply) => {
    let identity: Awaited<ReturnType<typeof getIdentity>>;
    try { identity = await getIdentity(pool, siteName); } catch { return reply.code(503).send({ error: "The Sync identity is unavailable." }); }
    await pool.query("DELETE FROM sync_request_nonces WHERE expires_at < now()");
    const peer = await verifySignedPeer(request, pool, true);
    if (!peer) return json(reply, 401, { error: "The signed peer request is invalid, stale, replayed, or not trusted." }, identity, request.headers["x-sc-nonce"] as string ?? "");
    const row = await pool.query<{ trust_state: string; fingerprint: string }>("SELECT trust_state,fingerprint FROM sync_peers WHERE installation_id=$1", [peer.installationId]);
    return json(reply, 200, { installationId: identity.installationId, peerInstallationId: peer.installationId, peerTrustState: row.rows[0].trust_state, peerFingerprint: row.rows[0].fingerprint, protocolVersion }, identity, request.headers["x-sc-nonce"] as string);
  });

  app.get(`${prefix}/grants`, async (request, reply) => {
    const identity = await getIdentity(pool, siteName);
    const sender = await verifySignedPeer(request, pool);
    if (!sender) return json(reply, 401, { error: "The signed peer request is invalid." }, identity, String(request.headers["x-sc-nonce"] ?? ""));
    const grants = await pool.query<{ id: string; department_name: string; scopes: string[]; delivery_mode: string; revision: string; created_at: Date | string }>(
      `SELECT grant.id,department.name AS department_name,grant.scopes,grant.delivery_mode,grant.revision::text,grant.created_at
         FROM sync_share_grants grant JOIN departments department ON department.id=grant.owner_department_id
        WHERE grant.recipient_installation_id=$1 AND grant.state='active' ORDER BY department.name,grant.created_at`, [sender.installationId],
    );
    return json(reply, 200, { grants: grants.rows.map((grant) => ({ id: grant.id, sourceDepartmentName: grant.department_name, scopes: grant.scopes, deliveryMode: grant.delivery_mode, revision: Number(grant.revision), createdAt: grant.created_at })) }, identity, request.headers["x-sc-nonce"] as string);
  });

  app.get(`${prefix}/redundancy/sites`, async (request, reply) => {
    const identity = await getIdentity(pool, siteName);
    const sender = await verifySignedPeer(request, pool);
    if (!sender) return json(reply, 401, { error: "The signed peer request is invalid." }, identity, String(request.headers["x-sc-nonce"] ?? ""));
    const sites = await pool.query<{ id: string; name: string; time_zone: string; role: string; primary_installation_id: string | null; upstream_installation_id: string | null; upstream_department_id: string | null; site_epoch: string }>(`SELECT department.id,department.name,department.time_zone,COALESCE(redundancy.role,'primary') AS role,redundancy.primary_installation_id,redundancy.upstream_installation_id,redundancy.upstream_department_id,COALESCE(redundancy.site_epoch,1)::text AS site_epoch
      FROM departments department LEFT JOIN sync_site_redundancy redundancy ON redundancy.department_id=department.id
      WHERE department.installation_id=$1 ORDER BY lower(department.name),department.id`, [identity.installationId]);
    return json(reply, 200, { installationId: identity.installationId, sites: sites.rows }, identity, String(request.headers["x-sc-nonce"] ?? ""));
  });

  app.post<{ Body: { sourceDepartmentId: string; targetDepartmentId: string; knownEpoch: number; knownSourceDigest: string | null; knownManifest: RedundancyModuleManifestEntry[] | null; encryptionPublicKeyPem: string } }>(`${prefix}/redundancy/pull-snapshot`, async (request, reply) => {
    const identity = await getIdentity(pool, siteName);
    const sender = await verifySignedPeer(request, pool);
    if (!sender) return json(reply, 401, { error: "The signed peer request is invalid." }, identity, String(request.headers["x-sc-nonce"] ?? ""));
    const body = request.body;
    const isUuid = (value: unknown) => typeof value === "string" && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);
    if (!body || !isUuid(body.sourceDepartmentId) || !isUuid(body.targetDepartmentId) || !Number.isSafeInteger(body.knownEpoch) || body.knownEpoch < 0
      || (body.knownSourceDigest !== null && (typeof body.knownSourceDigest !== "string" || !/^[0-9a-f]{64}$/.test(body.knownSourceDigest)))
      || (body.knownManifest !== null && (!Array.isArray(body.knownManifest) || body.knownManifest.some((module) => !module || typeof module.moduleId !== "string" || typeof module.schemaVersion !== "string" || typeof module.installedVersion !== "string")))
      || typeof body.encryptionPublicKeyPem !== "string" || body.encryptionPublicKeyPem.length > 4096) return json(reply, 400, { error: "The redundancy pull request is invalid." }, identity, String(request.headers["x-sc-nonce"] ?? ""));
    let recipientKey;
    try { recipientKey = createPublicKey(body.encryptionPublicKeyPem); }
    catch { return json(reply, 400, { error: "The standby snapshot-encryption key is invalid." }, identity, String(request.headers["x-sc-nonce"] ?? "")); }
    if (recipientKey.asymmetricKeyType !== "x25519") return json(reply, 400, { error: "The standby snapshot-encryption key is not an X25519 key." }, identity, String(request.headers["x-sc-nonce"] ?? ""));

    const stateResult = await pool.query<{ role: string; site_epoch: string; former_standby_installation_id: string | null; former_standby_department_id: string | null }>(
      "SELECT role,site_epoch::text,former_standby_installation_id,former_standby_department_id FROM sync_site_redundancy WHERE department_id=$1", [body.sourceDepartmentId],
    );
    const state = stateResult.rows[0];
    const former = state ? await formerStandbyAuthorization(pool, body.sourceDepartmentId, state.former_standby_installation_id, state.former_standby_department_id) : null;
    const pullAuthorized = state ? await hasApprovedPullAuthorization(pool, body.sourceDepartmentId, sender.installationId, body.targetDepartmentId) : false;
    const isFormerStandby = former?.installationId === sender.installationId && (!former.departmentId || former.departmentId === body.targetDepartmentId);
    if (!state || state.role !== "primary" || (!isFormerStandby && !pullAuthorized)) {
      return json(reply, 403, { error: "This trusted server is not approved as a standby for this site and cannot pull its snapshot." }, identity, String(request.headers["x-sc-nonce"] ?? ""));
    }
    const snapshotLockName = redundancySnapshotLockName(body.sourceDepartmentId, sender.installationId, body.targetDepartmentId);
    const snapshotLockClient = await pool.connect();
    let snapshotLocked = false;
    try {
      await snapshotLockClient.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [snapshotLockName]);
      snapshotLocked = true;
      const local = await redundancyManifest(pool, context.replication.list(), body.sourceDepartmentId);
      if (local.blockers.length) return json(reply, 409, { error: `The primary is not ready to export a complete site snapshot: ${local.blockers.join(" ")}` }, identity, String(request.headers["x-sc-nonce"] ?? ""));
      const revision = await nextSnapshotRevision(pool, body.sourceDepartmentId, String(state.site_epoch));
      const client = await pool.connect();
      let snapshots: Record<string, unknown>;
      try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const current = await client.query<{ role: string; site_epoch: string; former_standby_installation_id: string | null; former_standby_department_id: string | null }>(
          "SELECT role,site_epoch::text,former_standby_installation_id,former_standby_department_id FROM sync_site_redundancy WHERE department_id=$1", [body.sourceDepartmentId],
        );
        const locked = current.rows[0];
        const lockedFormer = locked ? await formerStandbyAuthorization(pool, body.sourceDepartmentId, locked.former_standby_installation_id, locked.former_standby_department_id) : null;
        const lockedPullAuthorized = locked ? Boolean((await client.query("SELECT 1 FROM sync_redundancy_pull_authorizations WHERE source_department_id=$1 AND target_installation_id=$2 AND target_department_id=$3 AND source_epoch=$4 AND state='approved'", [body.sourceDepartmentId, sender.installationId, body.targetDepartmentId, locked.site_epoch])).rowCount) : false;
        const lockedIsFormerStandby = lockedFormer?.installationId === sender.installationId && (!lockedFormer.departmentId || lockedFormer.departmentId === body.targetDepartmentId);
        if (!locked || locked.role !== "primary" || locked.site_epoch !== state.site_epoch || (!lockedIsFormerStandby && !lockedPullAuthorized)) throw new Error("The primary role or standby authorization changed during snapshot export.");
        snapshots = {};
        for (const module of local.modules) {
          const adapter = local.adapters.get(module.moduleId);
          if (!adapter) throw new Error(`The ${module.moduleId} replication adapter is unavailable.`);
          snapshots[module.moduleId] = await adapter.exportSnapshot(client, body.sourceDepartmentId);
        }
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }

      const confirmed = await redundancyManifest(pool, context.replication.list(), body.sourceDepartmentId);
      if (confirmed.blockers.length || manifestKey(confirmed.modules) !== manifestKey(local.modules)) throw new Error("The primary module inventory changed while the snapshot was being prepared; retry after its modules are stable.");
      const sourceDigest = sourceSnapshotDigest(snapshots);
      const snapshotId = randomUUID();
      await pool.query("DELETE FROM sync_redundancy_pull_offers WHERE expires_at<=now()");
      await pool.query("INSERT INTO sync_redundancy_pull_offers(snapshot_id,source_department_id,target_installation_id,target_department_id,source_epoch,source_snapshot_revision,source_digest,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '15 minutes')",
        [snapshotId, body.sourceDepartmentId, sender.installationId, body.targetDepartmentId, state.site_epoch, revision.snapshot_revision, sourceDigest]);
      if (body.knownEpoch === Number(state.site_epoch) && body.knownSourceDigest === sourceDigest && body.knownManifest && manifestKey(body.knownManifest) === manifestKey(local.modules)) {
        return json(reply, 200, { unchanged: true, snapshotId, siteEpoch: state.site_epoch, sourceSnapshotRevision: revision.snapshot_revision, sourceDigest, moduleManifest: local.modules }, identity, String(request.headers["x-sc-nonce"] ?? ""));
      }
      const transferSnapshots: Record<string, unknown> = {};
      for (const module of local.modules) {
        const adapter = local.adapters.get(module.moduleId)!;
        transferSnapshots[module.moduleId] = adapter.prepareSnapshotForPeer
          ? await adapter.prepareSnapshotForPeer(snapshots[module.moduleId], (plaintext) => sealForPeer(body.encryptionPublicKeyPem, plaintext))
          : snapshots[module.moduleId];
      }
      const payload = Buffer.from(JSON.stringify({ sourceDepartmentId: body.sourceDepartmentId, targetDepartmentId: body.targetDepartmentId, snapshotId, siteEpoch: Number(state.site_epoch), sourceSnapshotRevision: revision.snapshot_revision, sourceDigest, modules: transferSnapshots, moduleManifest: local.modules }), "utf8");
      if (payload.length > 1024 * 1024 * 1024) return json(reply, 413, { error: "The uncompressed site snapshot exceeds the 1 GiB safety limit." }, identity, String(request.headers["x-sc-nonce"] ?? ""));
      const compressed = gzipSync(payload, { level: 6 });
      if (compressed.length > maxRedundancyBytes) return json(reply, 413, { error: "The compressed site snapshot exceeds the 256 MiB transfer limit." }, identity, String(request.headers["x-sc-nonce"] ?? ""));
      const nonce = String(request.headers["x-sc-nonce"] ?? "");
      reply.code(200).header("content-type", "application/vnd.smart-church.redundancy-snapshot").header("cache-control", "no-store")
        .header("x-sc-protocol", protocolVersion)
        .header("x-sc-response-signature", signBytes(identity.privateKeyPem, canonicalResponse(200, nonce, compressed)));
      return reply.send(compressed);
    } catch (error) {
      app.log.error({ err: error, module: "sync", departmentId: body.sourceDepartmentId }, "A standby snapshot pull could not be prepared.");
      return json(reply, 409, { error: error instanceof Error ? error.message.slice(0, 500) : "The standby snapshot pull failed." }, identity, String(request.headers["x-sc-nonce"] ?? ""));
    } finally {
      if (snapshotLocked) await snapshotLockClient.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [snapshotLockName]).catch(() => undefined);
      snapshotLockClient.release();
    }
  });

  app.post<{ Body: { sourceDepartmentId: string; targetDepartmentId: string; snapshotId: string; siteEpoch: number; sourceSnapshotRevision: string; sourceDigest: string } }>(`${prefix}/redundancy/pull-ack`, async (request, reply) => {
    const identity = await getIdentity(pool, siteName);
    const sender = await verifySignedPeer(request, pool);
    if (!sender) return json(reply, 401, { error: "The signed peer request is invalid." }, identity, String(request.headers["x-sc-nonce"] ?? ""));
    const body = request.body;
    const isUuid = (value: unknown) => typeof value === "string" && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);
    if (!body || !isUuid(body.sourceDepartmentId) || !isUuid(body.targetDepartmentId) || !isUuid(body.snapshotId) || !Number.isSafeInteger(body.siteEpoch) || body.siteEpoch < 1 || typeof body.sourceSnapshotRevision !== "string" || !/^\d{1,19}$/.test(body.sourceSnapshotRevision) || BigInt(body.sourceSnapshotRevision) < 1n || typeof body.sourceDigest !== "string" || !/^[0-9a-f]{64}$/.test(body.sourceDigest)) return json(reply, 400, { error: "The standby verification acknowledgment is invalid." }, identity, String(request.headers["x-sc-nonce"] ?? ""));
    const source = await pool.query<{ site_epoch: string; role: string; former_standby_installation_id: string | null; former_standby_department_id: string | null }>(
      "SELECT site_epoch::text,role,former_standby_installation_id,former_standby_department_id FROM sync_site_redundancy WHERE department_id=$1", [body.sourceDepartmentId],
    );
    const row = source.rows[0];
    const former = row ? await formerStandbyAuthorization(pool, body.sourceDepartmentId, row.former_standby_installation_id, row.former_standby_department_id) : null;
    const pullAuthorized = row ? await hasApprovedPullAuthorization(pool, body.sourceDepartmentId, sender.installationId, body.targetDepartmentId) : false;
    const isFormerStandby = former?.installationId === sender.installationId && (!former.departmentId || former.departmentId === body.targetDepartmentId);
    if (!row || row.role !== "primary" || row.site_epoch !== String(body.siteEpoch) || (!isFormerStandby && !pullAuthorized)) return json(reply, 409, { error: "This server is no longer authorized to acknowledge snapshots for this primary." }, identity, String(request.headers["x-sc-nonce"] ?? ""));
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const previous = await client.query<{ last_snapshot_id: string | null; source_digest: string | null; source_snapshot_revision: string }>("SELECT last_snapshot_id,source_digest,source_snapshot_revision::text FROM sync_site_redundancy_replicas WHERE department_id=$1 AND peer_installation_id=$2 AND peer_department_id=$3 FOR UPDATE", [body.sourceDepartmentId, sender.installationId, body.targetDepartmentId]);
      if (previous.rows[0]?.last_snapshot_id === body.snapshotId && previous.rows[0]?.source_digest === body.sourceDigest && previous.rows[0]?.source_snapshot_revision === body.sourceSnapshotRevision) {
        await client.query("COMMIT");
        return json(reply, 200, { accepted: true }, identity, String(request.headers["x-sc-nonce"] ?? ""));
      }
      const offer = await client.query("SELECT 1 FROM sync_redundancy_pull_offers WHERE snapshot_id=$1 AND source_department_id=$2 AND target_installation_id=$3 AND target_department_id=$4 AND source_epoch=$5 AND source_snapshot_revision=$6 AND source_digest=$7 AND expires_at>now() FOR UPDATE", [body.snapshotId, body.sourceDepartmentId, sender.installationId, body.targetDepartmentId, body.siteEpoch, body.sourceSnapshotRevision, body.sourceDigest]);
      if (!offer.rowCount) { await client.query("ROLLBACK"); return json(reply, 409, { error: "The snapshot offer is missing, expired, or does not match this acknowledgment." }, identity, String(request.headers["x-sc-nonce"] ?? "")); }
      await client.query(`INSERT INTO sync_site_redundancy_replicas(department_id,peer_installation_id,peer_department_id,last_snapshot_id,source_snapshot_revision,source_digest,last_snapshot_at,last_verified_at,last_error,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,now(),now(),NULL,now())
        ON CONFLICT(department_id,peer_installation_id,peer_department_id) DO UPDATE SET last_snapshot_id=EXCLUDED.last_snapshot_id,source_snapshot_revision=EXCLUDED.source_snapshot_revision,source_digest=EXCLUDED.source_digest,last_snapshot_at=EXCLUDED.last_snapshot_at,last_verified_at=EXCLUDED.last_verified_at,last_error=NULL,updated_at=now()
        WHERE sync_site_redundancy_replicas.source_snapshot_revision < EXCLUDED.source_snapshot_revision`, [body.sourceDepartmentId, sender.installationId, body.targetDepartmentId, body.snapshotId, body.sourceSnapshotRevision, body.sourceDigest]);
      await client.query("DELETE FROM sync_redundancy_pull_offers WHERE snapshot_id=$1", [body.snapshotId]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    return json(reply, 200, { accepted: true }, identity, String(request.headers["x-sc-nonce"] ?? ""));
  });

  app.post<{ Body: { sourceDepartmentId: string; sourceDepartmentName: string; targetDepartmentId: string; sourceEpoch: number } }>(`${prefix}/redundancy/standby-requests`, async (request, reply) => {
    const identity = await getIdentity(pool, siteName);
    const sender = await verifySignedPeer(request, pool);
    if (!sender) return json(reply, 401, { error: "The signed peer request is invalid." }, identity, String(request.headers["x-sc-nonce"] ?? ""));
    const body = request.body;
    const isUuid = (value: unknown) => typeof value === "string" && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);
    if (!body || !isUuid(body.sourceDepartmentId) || !isUuid(body.targetDepartmentId) || typeof body.sourceDepartmentName !== "string" || !body.sourceDepartmentName.trim() || body.sourceDepartmentName.length > 200 || !Number.isSafeInteger(body.sourceEpoch) || body.sourceEpoch < 1) return json(reply, 400, { error: "The standby request is invalid." }, identity, String(request.headers["x-sc-nonce"] ?? ""));
    const source = await pool.query<{ role: string; site_epoch: string }>("SELECT role,site_epoch::text FROM sync_site_redundancy WHERE department_id=$1 AND primary_installation_id=$2", [body.sourceDepartmentId, sender.installationId]);
    if (!source.rowCount || source.rows[0].role !== "primary" || source.rows[0].site_epoch !== String(body.sourceEpoch)) return json(reply, 409, { error: "The signed source site is not an active primary at the requested epoch." }, identity, String(request.headers["x-sc-nonce"] ?? ""));
    const target = await pool.query<{ role: string; site_epoch: string; upstream_installation_id: string | null; upstream_department_id: string | null }>("SELECT role,site_epoch::text,upstream_installation_id,upstream_department_id FROM sync_site_redundancy WHERE department_id=$1", [body.targetDepartmentId]);
    if (!target.rowCount || !["primary", "fenced", "standby"].includes(target.rows[0].role)) return json(reply, 404, { error: "The requested destination site is not available for redundancy." }, identity, String(request.headers["x-sc-nonce"] ?? ""));
    if (target.rows[0].role === "standby" && (target.rows[0].upstream_installation_id !== sender.installationId || target.rows[0].upstream_department_id !== body.sourceDepartmentId)) return json(reply, 409, { error: "The destination site is already a standby for a different primary." }, identity, String(request.headers["x-sc-nonce"] ?? ""));
    if (BigInt(target.rows[0].site_epoch) > BigInt(body.sourceEpoch)) return json(reply, 409, { error: "The destination site's epoch is newer than the requesting primary. A stale primary cannot request that it replace newer data." }, identity, String(request.headers["x-sc-nonce"] ?? ""));
    await pool.query("UPDATE sync_redundancy_standby_requests SET state='expired' WHERE target_department_id=$1 AND state='pending' AND expires_at<=now()", [body.targetDepartmentId]);
    const requestId = randomUUID();
    await pool.query(`INSERT INTO sync_redundancy_standby_requests(id,source_installation_id,source_department_id,target_department_id,source_epoch,source_department_name,state,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,'pending',now()+interval '24 hours')
      ON CONFLICT(source_installation_id,source_department_id,target_department_id) WHERE state='pending' DO NOTHING`, [requestId, sender.installationId, body.sourceDepartmentId, body.targetDepartmentId, body.sourceEpoch, body.sourceDepartmentName.trim()]);
    const saved = await pool.query<{ id: string; state: string }>("SELECT id,state FROM sync_redundancy_standby_requests WHERE source_installation_id=$1 AND source_department_id=$2 AND target_department_id=$3 AND state='pending'", [sender.installationId, body.sourceDepartmentId, body.targetDepartmentId]);
    return json(reply, 201, { requestId: saved.rows[0]?.id ?? requestId, state: saved.rows[0]?.state ?? "pending" }, identity, String(request.headers["x-sc-nonce"] ?? ""));
  });

  app.post<{ Body: { sourceDepartmentId: string; sourceEpoch: number; targetDepartmentId: string; targetDepartmentName: string } }>(`${prefix}/redundancy/pull-standby-requests`, async (request, reply) => {
    const identity = await getIdentity(pool, siteName);
    const sender = await verifySignedPeer(request, pool);
    if (!sender) return json(reply, 401, { error: "The signed peer request is invalid." }, identity, String(request.headers["x-sc-nonce"] ?? ""));
    const body = request.body;
    const isUuid = (value: unknown) => typeof value === "string" && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);
    if (!body || !isUuid(body.sourceDepartmentId) || !isUuid(body.targetDepartmentId) || typeof body.targetDepartmentName !== "string" || !body.targetDepartmentName.trim() || body.targetDepartmentName.length > 200 || !Number.isSafeInteger(body.sourceEpoch) || body.sourceEpoch < 1) return json(reply, 400, { error: "The outbound standby request is invalid." }, identity, String(request.headers["x-sc-nonce"] ?? ""));
    const source = await pool.query<{ role: string; site_epoch: string }>("SELECT role,site_epoch::text FROM sync_site_redundancy WHERE department_id=$1", [body.sourceDepartmentId]);
    if (!source.rowCount || source.rows[0].role !== "primary" || source.rows[0].site_epoch !== String(body.sourceEpoch)) return json(reply, 409, { error: "The selected source site is not an active primary at the requested epoch." }, identity, String(request.headers["x-sc-nonce"] ?? ""));
    const pending = await pool.query<{ id: string; state: string }>(
      `INSERT INTO sync_redundancy_pull_authorizations(id,source_department_id,target_installation_id,target_department_id,target_department_name,source_epoch,state)
       VALUES($1,$2,$3,$4,$5,$6,'pending')
       ON CONFLICT DO NOTHING
       RETURNING id,state`,
      [randomUUID(), body.sourceDepartmentId, sender.installationId, body.targetDepartmentId, body.targetDepartmentName.trim(), body.sourceEpoch],
    );
    const saved = pending.rows[0] ?? (await pool.query<{ id: string; state: string }>("SELECT id,state FROM sync_redundancy_pull_authorizations WHERE source_department_id=$1 AND target_installation_id=$2 AND target_department_id=$3 AND state IN ('pending','approved') ORDER BY created_at DESC LIMIT 1", [body.sourceDepartmentId, sender.installationId, body.targetDepartmentId])).rows[0];
    if (!saved) return json(reply, 409, { error: "A standby authorization for this server and location could not be recorded." }, identity, String(request.headers["x-sc-nonce"] ?? ""));
    return json(reply, 201, { requestId: saved.id, state: saved.state }, identity, String(request.headers["x-sc-nonce"] ?? ""));
  });

  app.get<{ Querystring: { departmentId?: string; targetDepartmentId?: string } }>(`${prefix}/redundancy/capabilities`, async (request, reply) => {
    const identity = await getIdentity(pool, siteName);
    const sender = await verifySignedPeer(request, pool);
    if (!sender) return json(reply, 401, { error: "The signed peer request is invalid." }, identity, String(request.headers["x-sc-nonce"] ?? ""));
    const departmentId = request.query.departmentId;
    if (!departmentId || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(departmentId)) return json(reply, 400, { error: "Choose a valid site." }, identity, request.headers["x-sc-nonce"] as string);
    const stateResult = await pool.query<{ role: string; primary_installation_id: string; upstream_installation_id: string | null; upstream_department_id: string | null; former_standby_installation_id: string | null; former_standby_department_id: string | null; site_epoch: string; snapshot_revision: string; last_snapshot_id: string | null; last_snapshot_at: Date | null; last_verified_at: Date | null; last_source_digest: string | null }>("SELECT role,primary_installation_id,upstream_installation_id,upstream_department_id,former_standby_installation_id,former_standby_department_id,site_epoch::text,snapshot_revision::text,last_snapshot_id,last_snapshot_at,last_verified_at,last_source_digest FROM sync_site_redundancy WHERE department_id=$1", [departmentId]);
    if (!stateResult.rowCount) return json(reply, 404, { error: "That site is not configured for redundancy." }, identity, request.headers["x-sc-nonce"] as string);
    const state = stateResult.rows[0];
    if (state.role === "standby" && (state.upstream_installation_id !== sender.installationId || state.upstream_department_id === null)) return json(reply, 403, { error: "Only the configured primary can inspect this standby." }, identity, request.headers["x-sc-nonce"] as string);
    const modules = await allAdapterManifest(context.replication.list(), departmentId);
    const pullAuthorizedForTarget = state.role === "primary" && await hasApprovedPullAuthorization(pool, departmentId, sender.installationId, request.query.targetDepartmentId ?? "");
    const former = await formerStandbyAuthorization(pool, departmentId, state.former_standby_installation_id, state.former_standby_department_id);
    return json(reply, 200, { installationId: identity.installationId, departmentId, role: state.role, primaryInstallationId: state.primary_installation_id, upstreamInstallationId: state.upstream_installation_id, upstreamDepartmentId: state.upstream_department_id, formerStandbyInstallationId: former.installationId, formerStandbyDepartmentId: former.departmentId, pullAuthorizedForTarget, siteEpoch: state.site_epoch, snapshotRevision: state.snapshot_revision, lastSnapshotId: state.last_snapshot_id, lastSnapshotAt: state.last_snapshot_at, lastVerifiedAt: state.last_verified_at, lastSourceDigest: state.last_source_digest, modules, ready: true, blockers: [] }, identity, request.headers["x-sc-nonce"] as string);
  });

  app.post<{ Body: { departmentId: string; sourceEpoch: number; sourceSnapshotRevision: string; sourceDigest: string } }>(`${prefix}/redundancy/verify`, async (request, reply) => {
    const identity = await getIdentity(pool, siteName);
    const sender = await verifySignedPeer(request, pool);
    if (!sender) return json(reply, 401, { error: "The signed peer request is invalid." }, identity, String(request.headers["x-sc-nonce"] ?? ""));
    const body = request.body;
    if (!body || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(body.departmentId) || !Number.isSafeInteger(body.sourceEpoch) || body.sourceEpoch < 1 || typeof body.sourceSnapshotRevision !== "string" || !/^\d{1,19}$/.test(body.sourceSnapshotRevision) || BigInt(body.sourceSnapshotRevision) < 1n || typeof body.sourceDigest !== "string" || !/^[0-9a-f]{64}$/.test(body.sourceDigest)) return json(reply, 400, { error: "The redundancy verification request is invalid." }, identity, request.headers["x-sc-nonce"] as string);
    const client = await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      const stateResult = await client.query<{ role: string; upstream_installation_id: string | null; upstream_department_id: string | null; site_epoch: string; snapshot_revision: string; last_replica_digest: string | null; last_source_digest: string | null; last_replica_manifest: RedundancyModuleManifestEntry[] | null }>("SELECT role,upstream_installation_id,upstream_department_id,site_epoch::text,snapshot_revision::text,last_replica_digest,last_source_digest,last_replica_manifest FROM sync_site_redundancy WHERE department_id=$1 FOR SHARE", [body.departmentId]);
      const state = stateResult.rows[0];
      if (!state || state.role !== "standby" || state.upstream_installation_id !== sender.installationId || state.upstream_department_id === null || state.site_epoch !== String(body.sourceEpoch) || BigInt(body.sourceSnapshotRevision) <= BigInt(state.snapshot_revision) || state.last_source_digest !== body.sourceDigest || !state.last_replica_digest || !state.last_replica_manifest) {
        await client.query("ROLLBACK");
        return json(reply, 200, { verified: false }, identity, String(request.headers["x-sc-nonce"] ?? ""));
      }
      const adapters = new Map(context.replication.list().map((adapter) => [adapter.moduleId, adapter]));
      if (!await manifestSupportedByAdapters(state.last_replica_manifest, adapters, body.departmentId)) {
        await client.query("ROLLBACK");
        return json(reply, 200, { verified: false }, identity, String(request.headers["x-sc-nonce"] ?? ""));
      }
      const currentSnapshots: Record<string, unknown> = {};
      for (const item of state.last_replica_manifest) {
        const adapter = adapters.get(item.moduleId);
        if (!adapter) throw new Error(`The ${item.moduleId} replication adapter is unavailable.`);
        currentSnapshots[item.moduleId] = await adapter.exportSnapshot(client, body.departmentId);
      }
      if (replicationDigest(currentSnapshots) !== state.last_replica_digest) {
        await client.query("ROLLBACK");
        return json(reply, 200, { verified: false }, identity, String(request.headers["x-sc-nonce"] ?? ""));
      }
      await client.query("UPDATE sync_site_redundancy SET snapshot_revision=$2,last_verified_at=now(),updated_at=now() WHERE department_id=$1 AND role='standby'", [body.departmentId, body.sourceSnapshotRevision]);
      const verifiedAt = new Date().toISOString();
      await client.query("COMMIT");
      return json(reply, 200, { verified: true, verifiedAt }, identity, String(request.headers["x-sc-nonce"] ?? ""));
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      app.log.warn({ err: error, departmentId: body.departmentId, module: "sync" }, "A standby snapshot verification failed.");
      return json(reply, 200, { verified: false }, identity, String(request.headers["x-sc-nonce"] ?? ""));
    } finally { client.release(); }
  });

  app.post<{ Body: { snapshotId: string; sourceDepartmentId: string; targetDepartmentId: string; sourceEpoch: number; sourceSnapshotRevision: string; chunkCount: number; byteCount: number; sha256: string; modules: RedundancyModuleManifestEntry[] } }>(`${prefix}/redundancy/imports`, async (request, reply) => {
    const identity = await getIdentity(pool, siteName);
    const sender = await verifySignedPeer(request, pool);
    if (!sender) return json(reply, 401, { error: "The signed peer request is invalid." }, identity, String(request.headers["x-sc-nonce"] ?? ""));
    const body = request.body;
    if (!body || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(body.snapshotId) || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(body.sourceDepartmentId) || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(body.targetDepartmentId) || !Number.isSafeInteger(body.sourceEpoch) || body.sourceEpoch < 1 || typeof body.sourceSnapshotRevision !== "string" || !/^\d{1,19}$/.test(body.sourceSnapshotRevision) || BigInt(body.sourceSnapshotRevision) < 1n || !Number.isSafeInteger(body.chunkCount) || body.chunkCount < 1 || body.chunkCount > 10000 || !Number.isSafeInteger(body.byteCount) || body.byteCount < 1 || body.byteCount > maxRedundancyBytes || typeof body.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(body.sha256) || !Array.isArray(body.modules) || body.modules.length < 1 || body.modules.length > 100) return json(reply, 400, { error: "The redundancy snapshot manifest is invalid or exceeds the configured transfer limits." }, identity, request.headers["x-sc-nonce"] as string);
    const target = await pool.query<{ role: string; upstream_installation_id: string | null; upstream_department_id: string | null; site_epoch: string; snapshot_revision: string }>("SELECT role,upstream_installation_id,upstream_department_id,site_epoch::text,snapshot_revision::text FROM sync_site_redundancy WHERE department_id=$1", [body.targetDepartmentId]);
    if (!target.rowCount || target.rows[0].role !== "standby" || target.rows[0].upstream_installation_id !== sender.installationId || target.rows[0].upstream_department_id !== body.sourceDepartmentId) return json(reply, 403, { error: "This site is not configured as a standby for the signed source server and location." }, identity, request.headers["x-sc-nonce"] as string);
    if (body.sourceEpoch < Number(target.rows[0].site_epoch)) return json(reply, 409, { error: "This snapshot comes from a stale site epoch." }, identity, request.headers["x-sc-nonce"] as string);
    if (body.sourceEpoch === Number(target.rows[0].site_epoch) && BigInt(body.sourceSnapshotRevision) <= BigInt(target.rows[0].snapshot_revision)) return json(reply, 409, { error: "This snapshot revision is stale; the standby already has a newer snapshot." }, identity, request.headers["x-sc-nonce"] as string);
    const adapters = new Map(context.replication.list().map((adapter) => [adapter.moduleId, adapter]));
    const incoming = new Map<string, RedundancyModuleManifestEntry>();
    for (const module of body.modules) {
      if (!module || typeof module.moduleId !== "string" || typeof module.schemaVersion !== "string" || typeof module.installedVersion !== "string" || incoming.has(module.moduleId)) return json(reply, 400, { error: "The redundancy module manifest contains duplicate or invalid entries." }, identity, request.headers["x-sc-nonce"] as string);
      incoming.set(module.moduleId, module);
    }
    if (!incoming.has("core-site") || !await manifestSupportedByAdapters([...incoming.values()], adapters, body.targetDepartmentId)) return json(reply, 409, { error: "The standby is missing a compatible data adapter for one or more modules in the source snapshot. Module activation may differ, but snapshot adapter schemas must be supported." }, identity, request.headers["x-sc-nonce"] as string);
    // The FK cascades chunk data, including chunks left behind by applied or
    // rejected imports. Retain import metadata only until its normal expiry.
    await pool.query("DELETE FROM sync_redundancy_imports WHERE expires_at<now()");
    await pool.query(
      `INSERT INTO sync_redundancy_imports(snapshot_id,source_installation_id,source_department_id,target_department_id,source_epoch,source_snapshot_revision,chunk_count,byte_count,sha256,module_manifest,state,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,'receiving',now()+interval '30 minutes')
       ON CONFLICT(snapshot_id) DO NOTHING`,
      [body.snapshotId, sender.installationId, body.sourceDepartmentId, body.targetDepartmentId, body.sourceEpoch, body.sourceSnapshotRevision, body.chunkCount, body.byteCount, body.sha256, JSON.stringify(body.modules)],
    );
    const stored = await pool.query<{ source_installation_id: string; source_department_id: string; target_department_id: string; source_epoch: string; source_snapshot_revision: string; chunk_count: number; byte_count: string; sha256: string; state: string }>("SELECT source_installation_id,source_department_id,target_department_id,source_epoch::text,source_snapshot_revision::text,chunk_count,byte_count::text,sha256,state FROM sync_redundancy_imports WHERE snapshot_id=$1", [body.snapshotId]);
    const row = stored.rows[0];
    if (!row || row.source_installation_id !== sender.installationId || row.source_department_id !== body.sourceDepartmentId || row.target_department_id !== body.targetDepartmentId || row.source_epoch !== String(body.sourceEpoch) || row.source_snapshot_revision !== body.sourceSnapshotRevision || row.chunk_count !== body.chunkCount || row.byte_count !== String(body.byteCount) || row.sha256 !== body.sha256 || row.state !== "receiving") return json(reply, 409, { error: "This snapshot ID is already in use with different metadata." }, identity, request.headers["x-sc-nonce"] as string);
    return json(reply, 200, { accepted: true, snapshotId: body.snapshotId, receivedChunks: (await pool.query("SELECT 1 FROM sync_redundancy_chunks WHERE snapshot_id=$1", [body.snapshotId])).rowCount }, identity, request.headers["x-sc-nonce"] as string);
  });

  app.post<{ Params: { snapshotId: string }; Body: { index: number; data: string } }>(`${prefix}/redundancy/imports/:snapshotId/chunks`, async (request, reply) => {
    const identity = await getIdentity(pool, siteName);
    const sender = await verifySignedPeer(request, pool);
    if (!sender) return json(reply, 401, { error: "The signed peer request is invalid." }, identity, String(request.headers["x-sc-nonce"] ?? ""));
    const body = request.body;
    if (!body || !Number.isSafeInteger(body.index) || body.index < 0 || typeof body.data !== "string" || body.data.length > 700000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.data)) return json(reply, 400, { error: "The redundancy snapshot chunk is invalid." }, identity, request.headers["x-sc-nonce"] as string);
    const data = Buffer.from(body.data, "base64");
    if (!data.length || data.length > redundancyChunkBytes) return json(reply, 413, { error: "The redundancy snapshot chunk exceeds the transfer limit." }, identity, request.headers["x-sc-nonce"] as string);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const snapshot = await client.query<{ chunk_count: number; state: string; expires_at: Date | string; target_department_id: string; source_installation_id: string }>("SELECT chunk_count,state,expires_at,target_department_id,source_installation_id FROM sync_redundancy_imports WHERE snapshot_id=$1 FOR UPDATE", [request.params.snapshotId]);
      const row = snapshot.rows[0];
      const site = row ? await client.query("SELECT 1 FROM sync_site_redundancy WHERE department_id=$1 AND role='standby' AND upstream_installation_id=$2", [row.target_department_id, sender.installationId]) : { rowCount: 0 };
      if (!row || row.source_installation_id !== sender.installationId || row.state !== "receiving" || new Date(row.expires_at) <= new Date() || !site.rowCount || body.index >= row.chunk_count) { await client.query("ROLLBACK"); return json(reply, 410, { error: "The snapshot import is unavailable, expired, or no longer authorized." }, identity, request.headers["x-sc-nonce"] as string); }
      const inserted = await client.query("INSERT INTO sync_redundancy_chunks(snapshot_id,chunk_index,chunk_data) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING chunk_index", [request.params.snapshotId, body.index, data]);
      if (!inserted.rowCount) {
        const previous = await client.query<{ chunk_data: Buffer }>("SELECT chunk_data FROM sync_redundancy_chunks WHERE snapshot_id=$1 AND chunk_index=$2", [request.params.snapshotId, body.index]);
        if (!previous.rowCount || !previous.rows[0].chunk_data.equals(data)) { await client.query("ROLLBACK"); return json(reply, 409, { error: "A retry attempted to replace an already received snapshot chunk." }, identity, request.headers["x-sc-nonce"] as string); }
      } else await client.query("UPDATE sync_redundancy_imports SET received_chunks=received_chunks+1 WHERE snapshot_id=$1", [request.params.snapshotId]);
      const progress = await client.query<{ received_chunks: number; chunk_count: number }>("SELECT received_chunks,chunk_count FROM sync_redundancy_imports WHERE snapshot_id=$1", [request.params.snapshotId]);
      await client.query("COMMIT");
      return json(reply, 200, { accepted: true, receivedChunks: progress.rows[0].received_chunks, totalChunks: progress.rows[0].chunk_count }, identity, request.headers["x-sc-nonce"] as string);
    } catch (error) { await client.query("ROLLBACK"); app.log.error({ err: error, module: "sync" }, "A redundancy snapshot chunk failed to store."); return json(reply, 500, { error: "The redundancy snapshot chunk could not be stored." }, identity, request.headers["x-sc-nonce"] as string); }
    finally { client.release(); }
  });

  app.post<{ Params: { snapshotId: string } }>(`${prefix}/redundancy/imports/:snapshotId/complete`, async (request, reply) => {
    const identity = await getIdentity(pool, siteName);
    const sender = await verifySignedPeer(request, pool);
    if (!sender) return json(reply, 401, { error: "The signed peer request is invalid." }, identity, String(request.headers["x-sc-nonce"] ?? ""));
    const importResult = await pool.query<{ source_installation_id: string; source_department_id: string; target_department_id: string; source_epoch: string; source_snapshot_revision: string; chunk_count: number; byte_count: string; sha256: string; module_manifest: RedundancyModuleManifestEntry[]; received_chunks: number; state: string; last_snapshot_id: string | null }>(
      `SELECT imported.source_installation_id,imported.source_department_id,imported.target_department_id,imported.source_epoch::text,imported.source_snapshot_revision::text,imported.chunk_count,imported.byte_count::text,imported.sha256,imported.module_manifest,imported.received_chunks,imported.state,site.last_snapshot_id
         FROM sync_redundancy_imports imported LEFT JOIN sync_site_redundancy site ON site.department_id=imported.target_department_id
        WHERE imported.snapshot_id=$1`, [request.params.snapshotId],
    );
    const imported = importResult.rows[0];
    if (!imported || imported.source_installation_id !== sender.installationId || imported.state !== "receiving") return json(reply, 410, { error: "This snapshot import is not available." }, identity, request.headers["x-sc-nonce"] as string);
    const chunkResult = await pool.query<{ chunk_data: Buffer }>("SELECT chunk_data FROM sync_redundancy_chunks WHERE snapshot_id=$1 ORDER BY chunk_index", [request.params.snapshotId]);
    if (imported.received_chunks !== imported.chunk_count || chunkResult.rowCount !== imported.chunk_count) return json(reply, 409, { error: "The site snapshot is incomplete; no records were changed." }, identity, request.headers["x-sc-nonce"] as string);
    const compressed = Buffer.concat(chunkResult.rows.map((chunk) => chunk.chunk_data));
    if (compressed.length !== Number(imported.byte_count) || createHash("sha256").update(compressed).digest("hex") !== imported.sha256) return json(reply, 400, { error: "The snapshot bytes do not match the signed manifest." }, identity, request.headers["x-sc-nonce"] as string);
    let payload: { sourceDepartmentId: string; targetDepartmentId: string; siteEpoch: number; sourceSnapshotRevision: string; sourceDigest?: string; modules: Record<string, unknown> };
    try {
      const plain = gunzipSync(compressed, { maxOutputLength: 1024 * 1024 * 1024 });
      payload = JSON.parse(plain.toString("utf8")) as typeof payload;
      if (!payload || payload.sourceDepartmentId !== imported.source_department_id || payload.targetDepartmentId !== imported.target_department_id || payload.siteEpoch !== Number(imported.source_epoch) || payload.sourceSnapshotRevision !== imported.source_snapshot_revision || !/^\d{1,19}$/.test(payload.sourceSnapshotRevision) || (payload.sourceDigest !== undefined && (typeof payload.sourceDigest !== "string" || !/^[0-9a-f]{64}$/.test(payload.sourceDigest))) || !payload.modules || typeof payload.modules !== "object" || Array.isArray(payload.modules)) throw new Error("Snapshot payload metadata does not match the signed import record.");
    } catch (error) {
      await pool.query("UPDATE sync_redundancy_imports SET state='rejected' WHERE snapshot_id=$1", [request.params.snapshotId]);
      await pool.query("DELETE FROM sync_redundancy_chunks WHERE snapshot_id=$1", [request.params.snapshotId]);
      return json(reply, 400, { error: error instanceof Error ? error.message : "The site snapshot is not valid gzip JSON." }, identity, request.headers["x-sc-nonce"] as string);
    }
    const client = await pool.connect();
    const commitCallbacks: Array<() => Promise<void>> = [];
    const rollbackCallbacks: Array<() => Promise<void>> = [];
    let transactionCommitted = false;
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL smart_church.redundancy_restore='on'");
      await client.query("SET CONSTRAINTS ALL DEFERRED");
      const site = await client.query<{ role: string; upstream_installation_id: string | null; upstream_department_id: string | null; site_epoch: string; snapshot_revision: string }>("SELECT role,upstream_installation_id,upstream_department_id,site_epoch::text,snapshot_revision::text FROM sync_site_redundancy WHERE department_id=$1 FOR UPDATE", [imported.target_department_id]);
      if (site.rows[0]?.role !== "standby" || site.rows[0].upstream_installation_id !== sender.installationId || site.rows[0].upstream_department_id !== imported.source_department_id || Number(imported.source_epoch) < Number(site.rows[0].site_epoch) || (Number(imported.source_epoch) === Number(site.rows[0].site_epoch) && BigInt(imported.source_snapshot_revision) <= BigInt(site.rows[0].snapshot_revision))) throw new Error("The standby relationship, source epoch, or snapshot revision changed during the restore; stale snapshots are rejected.");
      const adapters = new Map(context.replication.list().map((adapter) => [adapter.moduleId, adapter]));
      if (!imported.module_manifest?.length || !imported.module_manifest.some((module) => module.moduleId === "core-site") || !await manifestSupportedByAdapters(imported.module_manifest, adapters, imported.target_department_id)) throw new Error("The standby no longer has compatible data adapters for the source snapshot.");
      const entries = [...imported.module_manifest].sort((left, right) => left.moduleId === "core-site" ? -1 : right.moduleId === "core-site" ? 1 : left.moduleId.localeCompare(right.moduleId));
      const restoreContext = {
        userIdMap: new Map<string, string>(),
        onCommit: (callback: () => Promise<void>) => commitCallbacks.push(callback),
        onRollback: (callback: () => Promise<void>) => rollbackCallbacks.push(callback),
      };
      const restoredSnapshots: Record<string, unknown> = {};
      for (const entry of entries) {
        const adapter = adapters.get(entry.moduleId);
        if (!adapter || await adapterSchemaVersion(adapter, imported.target_department_id) !== entry.schemaVersion || !(entry.moduleId in payload.modules)) throw new Error(`The ${entry.moduleId} snapshot adapter is missing or incompatible.`);
        const moduleSnapshot = adapter.restoreSnapshotFromPeer
          ? await adapter.restoreSnapshotFromPeer(payload.modules[entry.moduleId], (envelope) => openFromPeer(identity.encryptionPrivateKeyPem, envelope))
          : payload.modules[entry.moduleId];
        await adapter.restoreSnapshot(client, imported.target_department_id, moduleSnapshot, restoreContext);
        const verified = await adapter.verifySnapshot(client, imported.target_department_id, moduleSnapshot, restoreContext);
        if (!verified.ready) throw new Error(`${adapter.moduleName} restore verification failed: ${verified.blockers.join(" ")}`);
        restoredSnapshots[entry.moduleId] = await adapter.exportSnapshot(client, imported.target_department_id);
      }
      const digest = replicationDigest(restoredSnapshots);
      const sourceDigest = payload.sourceDigest ?? sourceSnapshotDigest(payload.modules);
      await client.query("UPDATE sync_site_redundancy SET primary_installation_id=$2,former_standby_installation_id=NULL,former_standby_department_id=NULL,site_epoch=$3,snapshot_revision=$4,last_snapshot_id=$5,last_replica_digest=$6,last_source_digest=$7,last_replica_manifest=$8::jsonb,last_snapshot_at=now(),last_verified_at=now(),last_error=NULL,updated_at=now() WHERE department_id=$1", [imported.target_department_id, sender.installationId, imported.source_epoch, imported.source_snapshot_revision, request.params.snapshotId, digest, sourceDigest, JSON.stringify(imported.module_manifest)]);
      await client.query("UPDATE sync_redundancy_imports SET state='applied' WHERE snapshot_id=$1", [request.params.snapshotId]);
      await client.query("DELETE FROM sync_redundancy_chunks WHERE snapshot_id=$1", [request.params.snapshotId]);
      await client.query("INSERT INTO sync_redundancy_audit(id,department_id,action,new_epoch,source_installation_id,note) VALUES($1,$2,'snapshot_applied',$3,$4,'Verified module-owned full-site snapshot applied.')", [randomUUID(), imported.target_department_id, imported.source_epoch, sender.installationId]);
      await client.query("COMMIT");
      transactionCommitted = true;
      for (const callback of commitCallbacks) await callback().catch((error) => app.log.warn({ err: error, module: "sync" }, "A module cleanup after successful snapshot restore failed."));
      return json(reply, 200, { applied: true, snapshotId: request.params.snapshotId, siteEpoch: imported.source_epoch, sourceSnapshotRevision: imported.source_snapshot_revision, verifiedAt: new Date().toISOString() }, identity, request.headers["x-sc-nonce"] as string);
    } catch (error) {
      if (!transactionCommitted) {
        await client.query("ROLLBACK");
        for (const callback of rollbackCallbacks.reverse()) await callback().catch((rollbackError) => app.log.error({ err: rollbackError, module: "sync" }, "A module file rollback after failed snapshot restore failed."));
      }
      const reason = error instanceof Error ? error.message.slice(0, 500) : "The site snapshot restore failed.";
      await pool.query("UPDATE sync_redundancy_imports SET state='rejected' WHERE snapshot_id=$1", [request.params.snapshotId]).catch(() => undefined);
      await pool.query("DELETE FROM sync_redundancy_chunks WHERE snapshot_id=$1", [request.params.snapshotId]).catch(() => undefined);
      await pool.query("UPDATE sync_site_redundancy SET last_error=$2,updated_at=now() WHERE department_id=$1", [imported.target_department_id, reason]);
      app.log.error({ err: error, module: "sync" }, "The redundancy snapshot restore failed and was rolled back.");
      return json(reply, 409, { error: reason }, identity, request.headers["x-sc-nonce"] as string);
    } finally { client.release(); }
  });

  app.post<{ Params: { grantId: string } }>(`${prefix}/grants/:grantId/snapshot`, async (request, reply) => {
    const identity = await getIdentity(pool, siteName);
    const sender = await verifySignedPeer(request, pool);
    if (!sender) return json(reply, 401, { error: "The signed peer request is invalid." }, identity, String(request.headers["x-sc-nonce"] ?? ""));
    const grantResult = await pool.query<{ owner_department_id: string; scopes: string[]; revision: string; state: string }>(
      "SELECT owner_department_id,scopes,revision::text,state FROM sync_share_grants WHERE id=$1 AND recipient_installation_id=$2", [request.params.grantId, sender.installationId],
    );
    const grant = grantResult.rows[0];
    if (!grant || grant.state !== "active") return json(reply, 410, { error: "This share is no longer available." }, identity, request.headers["x-sc-nonce"] as string);
    const records = await snapshotRecords(pool, grant.owner_department_id, grant.scopes);
    const snapshotId = randomUUID();
    await pool.query("DELETE FROM sync_export_snapshots WHERE expires_at<now()");
    await pool.query("INSERT INTO sync_export_snapshots(id,grant_id,recipient_installation_id,grant_revision,records,record_count,expires_at) VALUES($1,$2,$3,$4,$5::jsonb,$6,now()+interval '15 minutes')",
      [snapshotId, request.params.grantId, sender.installationId, Number(grant.revision), JSON.stringify(records), records.length]);
    return json(reply, 200, { snapshotId, grantId: request.params.grantId, grantRevision: Number(grant.revision), totalRecords: records.length, offset: 0, hasMore: records.length > syncPageSize, records: records.slice(0, syncPageSize) }, identity, request.headers["x-sc-nonce"] as string);
  });

  app.get<{ Params: { snapshotId: string }; Querystring: { offset?: string } }>(`${prefix}/snapshots/:snapshotId`, async (request, reply) => {
    const identity = await getIdentity(pool, siteName);
    const sender = await verifySignedPeer(request, pool);
    if (!sender) return json(reply, 401, { error: "The signed peer request is invalid." }, identity, String(request.headers["x-sc-nonce"] ?? ""));
    const offset = Number(request.query.offset ?? "0");
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > maxSnapshotRecords) return json(reply, 400, { error: "The snapshot cursor is invalid." }, identity, request.headers["x-sc-nonce"] as string);
    const result = await pool.query<{ grant_id: string; recipient_installation_id: string; grant_revision: string; records: SyncRecord[]; record_count: number; expires_at: Date | string; state: string; target_installation_id: string }>(
      `SELECT snapshot.grant_id,snapshot.recipient_installation_id,snapshot.grant_revision::text,snapshot.records,snapshot.record_count,snapshot.expires_at,
              grant.state,grant.recipient_installation_id AS target_installation_id
         FROM sync_export_snapshots snapshot JOIN sync_share_grants grant ON grant.id=snapshot.grant_id
        WHERE snapshot.id=$1`, [request.params.snapshotId],
    );
    const snapshot = result.rows[0];
    if (!snapshot || snapshot.expires_at < new Date() || snapshot.recipient_installation_id !== sender.installationId) return json(reply, 410, { error: "This snapshot expired. Start a fresh sync." }, identity, request.headers["x-sc-nonce"] as string);
    if (snapshot.state !== "active" || snapshot.target_installation_id !== sender.installationId) return json(reply, 410, { error: "This share was revoked during sync." }, identity, request.headers["x-sc-nonce"] as string);
    const all = Array.isArray(snapshot.records) ? snapshot.records : [];
    const records = all.slice(offset, offset + syncPageSize);
    return json(reply, 200, { snapshotId: request.params.snapshotId, grantId: snapshot.grant_id, grantRevision: Number(snapshot.grant_revision), totalRecords: snapshot.record_count, offset, hasMore: offset + records.length < snapshot.record_count, records }, identity, request.headers["x-sc-nonce"] as string);
  });

  app.get(`${prefix}/grant-subscriptions`, async (request, reply) => {
    const identity = await getIdentity(pool, siteName);
    const sender = await verifySignedPeer(request, pool);
    if (!sender) return json(reply, 401, { error: "The signed peer request is invalid." }, identity, String(request.headers["x-sc-nonce"] ?? ""));
    const query = request.query as { grantId?: unknown };
    if (typeof query.grantId !== "string") return json(reply, 400, { error: "Choose a share grant." }, identity, request.headers["x-sc-nonce"] as string);
    const grant = await pool.query("SELECT 1 FROM sync_share_grants WHERE id=$1 AND recipient_installation_id=$2 AND state='active'", [query.grantId, sender.installationId]);
    if (!grant.rowCount) return json(reply, 410, { error: "This share is no longer available." }, identity, request.headers["x-sc-nonce"] as string);
    const subscriptions = await pool.query<{ id: string; recipient_department_id: string; state: string }>("SELECT id,recipient_department_id,state FROM sync_subscriptions WHERE source_installation_id=$1 AND source_grant_id=$2 AND state='active'", [identity.installationId, query.grantId]);
    return json(reply, 200, { subscriptions: subscriptions.rows }, identity, request.headers["x-sc-nonce"] as string);
  });

  app.post<{ Body: { subscriptionId: string; grantId: string; snapshotId: string; grantRevision: number; totalRecords: number; offset: number; hasMore: boolean; records: unknown } }>(`${prefix}/replicas/import`, async (request, reply) => {
    const identity = await getIdentity(pool, siteName);
    const sender = await verifySignedPeer(request, pool);
    if (!sender) return json(reply, 401, { error: "The signed peer request is invalid." }, identity, String(request.headers["x-sc-nonce"] ?? ""));
    const body = request.body;
    if (!body || typeof body.subscriptionId !== "string" || typeof body.grantId !== "string" || typeof body.snapshotId !== "string" || !Number.isSafeInteger(body.grantRevision) || !Number.isSafeInteger(body.totalRecords) || body.totalRecords < 0 || body.totalRecords > maxSnapshotRecords || !Number.isSafeInteger(body.offset) || body.offset < 0 || typeof body.hasMore !== "boolean") return json(reply, 400, { error: "The pushed replica batch metadata is invalid." }, identity, request.headers["x-sc-nonce"] as string);
    const subscriptionResult = await pool.query<{ scopes: string[]; last_snapshot_id: string | null; current_run_id: string | null }>(
      "SELECT scopes,last_snapshot_id,current_run_id FROM sync_subscriptions WHERE id=$1 AND source_installation_id=$2 AND source_grant_id=$3 AND state='active'", [body.subscriptionId, sender.installationId, body.grantId],
    );
    const subscription = subscriptionResult.rows[0];
    if (!subscription) return json(reply, 410, { error: "The destination has not accepted this share, or the subscription was revoked." }, identity, request.headers["x-sc-nonce"] as string);
    if (subscription.last_snapshot_id === body.snapshotId && !subscription.current_run_id) return json(reply, 200, { accepted: true, alreadyApplied: true }, identity, request.headers["x-sc-nonce"] as string);
    const records = parseSyncRecords(body.records, subscription.scopes);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const eligible = await client.query<{ current_run_id: string | null; sync_started_at: Date | null }>(
        `SELECT subscription.current_run_id,subscription.sync_started_at
           FROM sync_subscriptions subscription
           JOIN sync_peers peer ON peer.installation_id=subscription.source_installation_id AND peer.trust_state='trusted'
          WHERE subscription.id=$1 AND subscription.source_installation_id=$2 AND subscription.source_grant_id=$3 AND subscription.state='active'
          FOR UPDATE OF subscription,peer`,
        [body.subscriptionId, sender.installationId, body.grantId],
      );
      if (!eligible.rowCount) { await client.query("ROLLBACK"); return json(reply, 410, { error: "The subscription or trusted peer was revoked." }, identity, request.headers["x-sc-nonce"] as string); }
      const activePull = eligible.rows[0].current_run_id && eligible.rows[0].sync_started_at && eligible.rows[0].sync_started_at > new Date(Date.now() - 15 * 60_000);
      if (activePull) { await client.query("ROLLBACK"); return json(reply, 409, { error: "A pull sync is already applying to this subscription." }, identity, request.headers["x-sc-nonce"] as string); }
      if (eligible.rows[0].current_run_id) {
        await client.query("UPDATE sync_subscriptions SET current_run_id=NULL,sync_started_at=NULL WHERE id=$1", [body.subscriptionId]);
        await client.query("DELETE FROM sync_replica_staging WHERE run_id=$1", [eligible.rows[0].current_run_id]);
      }
      const running = await client.query("SELECT snapshot_id,source_revision,total_records,next_offset FROM sync_replica_push_runs WHERE subscription_id=$1 AND snapshot_id=$2 FOR UPDATE", [body.subscriptionId, body.snapshotId]);
      if (!running.rowCount) {
        if (body.offset !== 0) { await client.query("ROLLBACK"); return json(reply, 409, { error: "A push must begin with its first page." }, identity, request.headers["x-sc-nonce"] as string); }
        const active = await client.query("SELECT snapshot_id FROM sync_replica_push_runs WHERE subscription_id=$1 AND created_at>now()-interval '15 minutes' FOR UPDATE", [body.subscriptionId]);
        if (active.rowCount) { await client.query("ROLLBACK"); return json(reply, 409, { error: "Another push is already being applied to this subscription." }, identity, request.headers["x-sc-nonce"] as string); }
        await client.query("DELETE FROM sync_replica_staging WHERE run_id IN (SELECT snapshot_id FROM sync_replica_push_runs WHERE subscription_id=$1)", [body.subscriptionId]);
        await client.query("DELETE FROM sync_replica_push_runs WHERE subscription_id=$1", [body.subscriptionId]);
        await client.query("INSERT INTO sync_replica_push_runs(subscription_id,snapshot_id,source_revision,total_records,next_offset) VALUES($1,$2,$3,$4,0)", [body.subscriptionId, body.snapshotId, body.grantRevision, body.totalRecords]);
      } else if (Number(running.rows[0].source_revision) !== body.grantRevision || running.rows[0].total_records !== body.totalRecords) {
        await client.query("ROLLBACK"); return json(reply, 409, { error: "The push snapshot metadata changed between pages." }, identity, request.headers["x-sc-nonce"] as string);
      }
      const progress = await client.query<{ next_offset: number }>("SELECT next_offset FROM sync_replica_push_runs WHERE subscription_id=$1 AND snapshot_id=$2 FOR UPDATE", [body.subscriptionId, body.snapshotId]);
      const nextOffset = progress.rows[0].next_offset;
      if (body.offset > nextOffset) { await client.query("ROLLBACK"); return json(reply, 409, { error: "The pushed pages arrived out of order." }, identity, request.headers["x-sc-nonce"] as string); }
      if (body.offset === nextOffset) {
        for (const record of records) await client.query(
          `INSERT INTO sync_replica_staging(run_id,scope,source_id,source_revision,record) VALUES($1,$2,$3,$4,$5::jsonb)
           ON CONFLICT(run_id,scope,source_id) DO UPDATE SET source_revision=EXCLUDED.source_revision,record=EXCLUDED.record`,
          [body.snapshotId, record.scope, record.sourceId, record.sourceRevision, JSON.stringify(record.record)],
        );
        const newOffset = nextOffset + records.length;
        if ((body.hasMore && newOffset >= body.totalRecords) || (!body.hasMore && newOffset !== body.totalRecords)) { await client.query("ROLLBACK"); return json(reply, 400, { error: "The pushed page sequence is incomplete." }, identity, request.headers["x-sc-nonce"] as string); }
        await client.query("UPDATE sync_replica_push_runs SET next_offset=$3 WHERE subscription_id=$1 AND snapshot_id=$2", [body.subscriptionId, body.snapshotId, newOffset]);
      } else if (body.offset + records.length > nextOffset) {
        await client.query("ROLLBACK"); return json(reply, 409, { error: "A retry overlaps an unconfirmed page boundary." }, identity, request.headers["x-sc-nonce"] as string);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); app.log.error({ err: error, module: "sync" }, "A peer replica batch could not be staged."); return json(reply, 500, { error: "The replica page could not be stored." }, identity, request.headers["x-sc-nonce"] as string); }
    finally { client.release(); }
    if (!body.hasMore) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const current = await client.query(
          `SELECT run.id FROM sync_replica_push_runs run
             JOIN sync_subscriptions subscription ON subscription.id=run.subscription_id AND subscription.state='active' AND subscription.source_installation_id=$4 AND subscription.source_grant_id=$5
             JOIN sync_peers peer ON peer.installation_id=$4 AND peer.trust_state='trusted'
            WHERE run.subscription_id=$1 AND run.snapshot_id=$2 AND run.next_offset=$3 FOR UPDATE OF run,subscription,peer`,
          [body.subscriptionId, body.snapshotId, body.totalRecords, sender.installationId, body.grantId],
        );
        if (!current.rowCount) { await client.query("ROLLBACK"); return json(reply, 409, { error: "The final push page is incomplete." }, identity, request.headers["x-sc-nonce"] as string); }
        await client.query("DELETE FROM sync_replica_records WHERE subscription_id=$1", [body.subscriptionId]);
        await client.query("INSERT INTO sync_replica_records(subscription_id,scope,source_id,source_revision,record) SELECT $1,scope,source_id,source_revision,record FROM sync_replica_staging WHERE run_id=$2", [body.subscriptionId, body.snapshotId]);
        await client.query("DELETE FROM sync_replica_staging WHERE run_id=$1", [body.snapshotId]);
        await client.query("UPDATE sync_subscriptions SET last_synced_at=now(),source_revision=$2,last_snapshot_id=$3,last_error=NULL,updated_at=now() WHERE id=$1", [body.subscriptionId, body.grantRevision, body.snapshotId]);
        await client.query("DELETE FROM sync_replica_push_runs WHERE subscription_id=$1 AND snapshot_id=$2", [body.subscriptionId, body.snapshotId]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); app.log.error({ err: error, module: "sync" }, "The pushed replica could not be activated."); return json(reply, 500, { error: "The replica could not be activated." }, identity, request.headers["x-sc-nonce"] as string); }
      finally { client.release(); }
    }
    return json(reply, 200, { accepted: true, nextOffset: body.offset + records.length }, identity, request.headers["x-sc-nonce"] as string);
  });

  app.get(adminPrefix, async (request, reply) => {
    if (!requireManager(request, reply)) return;
    try {
      const identity = await getIdentity(pool, siteName);
      const { privateKeyPem: _private, encryptionPrivateKeyPem: _encryptionPrivate, ...publicIdentity } = identity;
      const peers = await pool.query<PeerRow>("SELECT * FROM sync_peers ORDER BY CASE trust_state WHEN 'pending' THEN 0 WHEN 'trusted' THEN 1 ELSE 2 END,display_name");
      const invitations = await pool.query<{ id: string; expires_at: Date | string; created_at: Date | string }>("SELECT id,expires_at,created_at FROM sync_pairing_invitations WHERE used_at IS NULL AND expires_at>now() ORDER BY created_at DESC");
      return { identity: publicIdentity, peers: peers.rows.map((peer) => ({ ...peer, channels: activeFederationChannels?.status(peer.installation_id) ?? { outbound: false, inbound: false } })), invitations: invitations.rows };
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 240) : "Unknown error.";
      app.log.error({ err: error }, `Could not load Sync peer settings: ${reason}`);
      return reply.code(503).send({ error: "Sync settings are unavailable.", details: reason });
    }
  });

  app.get(`${adminPrefix}/channels`, async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const peers = await pool.query<{ installation_id: string }>("SELECT installation_id FROM sync_peers WHERE trust_state<>'revoked' ORDER BY installation_id");
    return {
      channels: peers.rows.map(({ installation_id }) => ({
        installationId: installation_id,
        ...(activeFederationChannels?.status(installation_id) ?? { inbound: false, outbound: false }),
      })),
    };
  });

  app.get(`${adminPrefix}/redundancy/readiness`, async (request, reply) => {
    const department = await context.resolveDepartmentId(request, reply, true);
    if (!department || !requireManager(request, reply)) return reply;
    const stateResult = await pool.query<{ role: "primary" | "standby" | "fenced"; primary_installation_id: string; upstream_installation_id: string | null; upstream_department_id: string | null; site_epoch: string; last_snapshot_id: string | null; last_snapshot_at: Date | null; last_verified_at: Date | null; last_error: string | null; last_replica_digest: string | null; last_replica_manifest: RedundancyModuleManifestEntry[] | null }>("SELECT role,primary_installation_id,upstream_installation_id,upstream_department_id,site_epoch::text,last_snapshot_id,last_snapshot_at,last_verified_at,last_error,last_replica_digest,last_replica_manifest FROM sync_site_redundancy WHERE department_id=$1", [department]);
    const siteState = stateResult.rows[0];
    const enabledResult = await pool.query<{ module_id: string; version: string | null }>(`SELECT module.module_id,module.version FROM installation_modules module
      JOIN installations installation ON installation.id=module.installation_id AND installation.is_current=TRUE
      JOIN departments department ON department.installation_id=installation.id AND department.id=$1
      WHERE (module.enabled=TRUE OR module.required=TRUE)
        AND (module.required=TRUE OR module.client_managed=FALSE OR module.module_id=ANY(department.enabled_modules))
      ORDER BY module.module_id`, [department]);
    const adapters = new Map(context.replication.list().map((adapter) => [adapter.moduleId, adapter]));
    const modules: Array<{ moduleId: string; moduleName: string; enabled: boolean; ready: boolean; schemaVersion: string | null; installedVersion: string | null; recordCount: number | null; blockers: string[] }> = [];
    const core = adapters.get("core-site");
    if (!core || !core.isEnabled()) modules.push({ moduleId: "core-site", moduleName: "Core site data", enabled: true, ready: false, schemaVersion: core?.schemaVersion ?? null, installedVersion: null, recordCount: null, blockers: ["The core site-data adapter is not registered."] });
    else {
      try {
        const status = await core.inspect(department);
        modules.push({ moduleId: core.moduleId, moduleName: core.moduleName, enabled: true, ready: status.ready, schemaVersion: core.schemaVersion, installedVersion: core.schemaVersion, recordCount: status.recordCount, blockers: status.blockers });
      } catch (error) {
        modules.push({ moduleId: core.moduleId, moduleName: core.moduleName, enabled: true, ready: false, schemaVersion: core.schemaVersion, installedVersion: core.schemaVersion, recordCount: null, blockers: [error instanceof Error ? error.message.slice(0, 240) : "The core site-data readiness check failed."] });
      }
    }
    for (const module of enabledResult.rows.filter((item) => item.module_id !== "sync")) {
      const adapter = adapters.get(module.module_id);
      if (!adapter || !adapter.isEnabled()) {
        modules.push({ moduleId: module.module_id, moduleName: adapter?.moduleName ?? module.module_id, enabled: true, ready: false, schemaVersion: adapter?.schemaVersion ?? null, installedVersion: module.version, recordCount: null, blockers: ["This enabled module has no active, module-owned replication adapter."] });
        continue;
      }
      try {
        const status = await adapter.inspect(department);
        modules.push({ moduleId: adapter.moduleId, moduleName: adapter.moduleName, enabled: true, ready: status.ready, schemaVersion: adapter.schemaVersion, installedVersion: module.version, recordCount: status.recordCount, blockers: status.blockers });
      } catch (error) {
        modules.push({ moduleId: adapter.moduleId, moduleName: adapter.moduleName, enabled: true, ready: false, schemaVersion: adapter.schemaVersion, installedVersion: module.version, recordCount: null, blockers: [error instanceof Error ? error.message.slice(0, 240) : "The module adapter readiness check failed."] });
      }
    }
    const standbyAdapters = new Map(context.replication.list().map((adapter) => [adapter.moduleId, adapter]));
    const standbyManifestSupported = Boolean(siteState?.last_replica_manifest?.some((module) => module.moduleId === "core-site")
      && await manifestSupportedByAdapters(siteState.last_replica_manifest ?? [], standbyAdapters, department));
    const modulesReady = siteState?.role === "standby" ? standbyManifestSupported : modules.length > 0 && modules.every((module) => module.ready);
    const snapshotIsVerifiedRecently = Boolean(siteState?.last_snapshot_at && siteState?.last_verified_at
      && siteState.last_verified_at.getTime() >= Date.now() - 5 * 60_000
      && siteState.last_replica_digest && siteState.last_replica_manifest);
    let snapshotVerified = false;
    if (siteState?.role === "standby" && modulesReady && snapshotIsVerifiedRecently) {
      if (standbyManifestSupported) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
          const currentSnapshots: Record<string, unknown> = {};
          for (const item of siteState.last_replica_manifest!) {
            const adapter = standbyAdapters.get(item.moduleId);
            if (!adapter) throw new Error(`The ${item.moduleId} replication adapter is unavailable.`);
            currentSnapshots[item.moduleId] = await adapter.exportSnapshot(client, department);
          }
          snapshotVerified = replicationDigest(currentSnapshots) === siteState.last_replica_digest;
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          app.log.warn({ err: error, departmentId: department }, "Could not verify the current standby replica digest.");
        } finally { client.release(); }
      }
    }
    const ready = modulesReady && snapshotVerified;
    const replicaResult = await pool.query<{ peer_installation_id: string; peer_department_id: string; peer_name: string | null; last_snapshot_id: string | null; last_snapshot_at: Date | null; last_verified_at: Date | null; last_error: string | null }>(
      `SELECT replica.peer_installation_id,replica.peer_department_id,peer.display_name AS peer_name,replica.last_snapshot_id,replica.last_snapshot_at,replica.last_verified_at,replica.last_error
         FROM sync_site_redundancy_replicas replica LEFT JOIN sync_peers peer ON peer.installation_id=replica.peer_installation_id
        WHERE replica.department_id=$1 ORDER BY COALESCE(peer.display_name,replica.peer_installation_id::text),replica.peer_department_id`, [department],
    );
    const standbyRequests = await pool.query<{ id: string; source_installation_id: string; source_department_id: string; source_department_name: string; source_epoch: string; source_server_name: string; created_at: Date }>(
      `SELECT request.id,request.source_installation_id,request.source_department_id,request.source_department_name,request.source_epoch::text,peer.display_name AS source_server_name,request.created_at
         FROM sync_redundancy_standby_requests request JOIN sync_peers peer ON peer.installation_id=request.source_installation_id AND peer.trust_state='trusted'
        WHERE request.target_department_id=$1 AND request.state='pending' AND request.expires_at>now()
        ORDER BY request.created_at DESC`, [department],
    );
    const pendingPullRequests = await pool.query<{ id: string; target_installation_id: string; target_department_id: string; target_department_name: string; source_epoch: string; target_server_name: string; created_at: Date }>(
      `SELECT pull_authorization.id,pull_authorization.target_installation_id,pull_authorization.target_department_id,pull_authorization.target_department_name,pull_authorization.source_epoch::text,peer.display_name AS target_server_name,pull_authorization.created_at
         FROM sync_redundancy_pull_authorizations pull_authorization JOIN sync_peers peer ON peer.installation_id=pull_authorization.target_installation_id AND peer.trust_state='trusted'
        WHERE pull_authorization.source_department_id=$1 AND pull_authorization.state='pending'
        ORDER BY pull_authorization.created_at DESC`, [department],
    );
    const reason = !modulesReady
      ? "Every enabled module and the core site-data adapter must pass local recovery checks before a snapshot can be promoted."
      : ready
        ? "All enabled modules are ready, and this standby still matches its last complete snapshot. Primary changes made after that snapshot may be missing."
        : siteState?.role === "standby"
          ? "A recent complete snapshot must be verified, and its data and module configuration must remain unchanged, before promotion is ready."
          : "Module checks pass. Promotion remains not ready until a standby receives and verifies a complete snapshot.";
    return { departmentId: department, role: siteState?.role ?? "unknown", primaryInstallationId: siteState?.primary_installation_id ?? null, upstreamInstallationId: siteState?.upstream_installation_id ?? null, upstreamDepartmentId: siteState?.upstream_department_id ?? null, siteEpoch: siteState?.site_epoch ?? null, lastSnapshotId: siteState?.last_snapshot_id ?? null, lastSnapshotAt: siteState?.last_snapshot_at ?? null, lastVerifiedAt: siteState?.last_verified_at ?? null, lastError: siteState?.last_error ?? null, replicas: replicaResult.rows, pendingStandbyRequests: standbyRequests.rows.map((item) => ({ id: item.id, sourceInstallationId: item.source_installation_id, sourceDepartmentId: item.source_department_id, sourceDepartmentName: item.source_department_name, sourceEpoch: item.source_epoch, sourceServerName: item.source_server_name, createdAt: item.created_at })), pendingPullRequests: pendingPullRequests.rows.map((item) => ({ id: item.id, targetInstallationId: item.target_installation_id, targetDepartmentId: item.target_department_id, targetDepartmentName: item.target_department_name, sourceEpoch: item.source_epoch, targetServerName: item.target_server_name, createdAt: item.created_at })), modulesReady, snapshotVerified, ready, reason, modules };
  });

  app.post<{ Body: { peerInstallationId: string; targetDepartmentId: string } }>(`${adminPrefix}/redundancy/request-standby`, async (request, reply) => {
    const department = await context.resolveDepartmentId(request, reply, true);
    if (!department || !requireManager(request, reply) || !context.validateMutation(request, reply)) return reply;
    const body = request.body;
    if (!body || typeof body.peerInstallationId !== "string" || typeof body.targetDepartmentId !== "string" || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(body.peerInstallationId) || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(body.targetDepartmentId)) return reply.code(400).send({ error: "Choose a trusted server and destination site." });
    const peerResult = await pool.query<PeerRow>("SELECT * FROM sync_peers WHERE installation_id=$1 AND trust_state='trusted'", [body.peerInstallationId]);
    const peer = peerResult.rows[0];
    if (!peer) return reply.code(409).send({ error: "Choose a trusted standby server." });
    const state = await pool.query<{ role: string; site_epoch: string }>("SELECT role,site_epoch::text FROM sync_site_redundancy WHERE department_id=$1", [department]);
    if (state.rows[0]?.role !== "primary") return reply.code(409).send({ error: "Only the writable primary can request standby configuration." });
    const sourceSite = await pool.query<{ name: string }>("SELECT name FROM departments WHERE id=$1", [department]);
    if (!sourceSite.rowCount) return reply.code(404).send({ error: "The current site is no longer available." });
    try {
      const identity = await getIdentity(pool, siteName);
      const remoteSites = await signedRemoteRequest<{ installationId: string; sites: Array<{ id: string; name: string }> }>(peer, identity, "GET", `${prefix}/redundancy/sites`);
      const target = remoteSites.sites.find((site) => site.id === body.targetDepartmentId);
      if (remoteSites.installationId !== peer.installation_id || !target) return reply.code(404).send({ error: "The selected destination site is not available on that server." });
      const result = await signedRemoteRequest<{ requestId: string; state: string }>(peer, identity, "POST", `${prefix}/redundancy/standby-requests`, JSON.stringify({ sourceDepartmentId: department, sourceDepartmentName: sourceSite.rows[0].name, targetDepartmentId: target.id, sourceEpoch: Number(state.rows[0].site_epoch) }));
      return { ...result, destination: target.name };
    } catch (error) { return reply.code(502).send({ error: error instanceof Error ? error.message : "Could not request standby approval from the destination." }); }
  });

  app.post<{ Body: { peerInstallationId: string; sourceDepartmentId: string; replaceExistingData: boolean } }>(`${adminPrefix}/redundancy/request-pull-standby`, async (request, reply) => {
    const department = await context.resolveDepartmentId(request, reply, true);
    if (!department || !requireManager(request, reply) || !context.validateMutation(request, reply)) return reply;
    const body = request.body;
    if (!body || typeof body.peerInstallationId !== "string" || typeof body.sourceDepartmentId !== "string" || body.replaceExistingData !== true
      || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(body.peerInstallationId) || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(body.sourceDepartmentId)) return reply.code(400).send({ error: "Choose a trusted primary and confirm that its snapshot will replace this site's data." });
    const peerResult = await pool.query<PeerRow>("SELECT * FROM sync_peers WHERE installation_id=$1 AND trust_state='trusted'", [body.peerInstallationId]);
    const peer = peerResult.rows[0];
    if (!peer) return reply.code(409).send({ error: "Choose a trusted primary server." });
    const current = await pool.query<{ role: string; site_epoch: string }>("SELECT role,site_epoch::text FROM sync_site_redundancy WHERE department_id=$1", [department]);
    if (!current.rowCount || !["primary", "standby", "fenced"].includes(current.rows[0].role)) return reply.code(409).send({ error: "This site cannot be configured as a standby from its current state." });
    try {
      const identity = await getIdentity(pool, siteName);
      const remote = await signedRemoteRequest<{ installationId: string; departmentId: string; role: string; siteEpoch: string }>(peer, identity, "GET", `${prefix}/redundancy/capabilities?departmentId=${encodeURIComponent(body.sourceDepartmentId)}`);
      if (remote.installationId !== peer.installation_id || remote.departmentId !== body.sourceDepartmentId || remote.role !== "primary") return reply.code(409).send({ error: "The selected remote location is not an active primary." });
      if (BigInt(remote.siteEpoch) < BigInt(current.rows[0].site_epoch)) return reply.code(409).send({ error: "The selected primary has an older epoch and cannot replace this site's newer data." });
      const site = await pool.query<{ name: string }>("SELECT name FROM departments WHERE id=$1", [department]);
      if (!site.rowCount) return reply.code(404).send({ error: "This site is no longer available." });
      const result = await signedRemoteRequest<{ requestId: string; state: string }>(peer, identity, "POST", `${prefix}/redundancy/pull-standby-requests`, JSON.stringify({ sourceDepartmentId: body.sourceDepartmentId, sourceEpoch: Number(remote.siteEpoch), targetDepartmentId: department, targetDepartmentName: site.rows[0].name }));
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const locked = await client.query<{ role: string; site_epoch: string }>("SELECT role,site_epoch::text FROM sync_site_redundancy WHERE department_id=$1 FOR UPDATE", [department]);
        if (!locked.rowCount || !["primary", "standby", "fenced"].includes(locked.rows[0].role) || BigInt(remote.siteEpoch) < BigInt(locked.rows[0].site_epoch)) throw new Error("This site's redundancy state changed while requesting the primary.");
        await client.query("UPDATE sync_site_redundancy SET role='standby',primary_installation_id=$2,former_standby_installation_id=NULL,former_standby_department_id=NULL,upstream_installation_id=$2,upstream_department_id=$3,site_epoch=$4,snapshot_revision=0,last_snapshot_id=NULL,last_replica_digest=NULL,last_source_digest=NULL,last_replica_manifest=NULL,replicated_user_ids='{}'::uuid[],last_snapshot_at=NULL,last_verified_at=NULL,last_error=NULL,promoted_at=NULL,fenced_at=NULL,updated_at=now() WHERE department_id=$1", [department, peer.installation_id, body.sourceDepartmentId, remote.siteEpoch]);
        await client.query("INSERT INTO sync_redundancy_audit(id,department_id,actor_user_id,action,old_epoch,new_epoch,source_installation_id,note) VALUES($1,$2,$3,'standby_configured',$4,$5,$6,$7)", [randomUUID(), department, request.authenticatedUser!.id, locked.rows[0].site_epoch, remote.siteEpoch, peer.installation_id, "Administrator requested that this site become a standby; the source site must approve before its snapshot can be pulled over the WebSocket channel."]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
      return { requestId: result.requestId, requestState: result.state, role: "standby", upstreamInstallationId: peer.installation_id, upstreamDepartmentId: body.sourceDepartmentId, siteEpoch: remote.siteEpoch };
    } catch (error) { return reply.code(502).send({ error: error instanceof Error ? error.message : "Could not request outbound standby authorization." }); }
  });

  app.post<{ Params: { id: string }; Body: { decision: "approve" | "reject"; confirmReplace?: boolean } }>(`${adminPrefix}/redundancy/standby-requests/:id/review`, async (request, reply) => {
    const department = await context.resolveDepartmentId(request, reply, true);
    if (!department || !requireManager(request, reply) || !context.validateMutation(request, reply)) return reply;
    const { decision, confirmReplace } = request.body ?? {};
    if (!new Set(["approve", "reject"]).has(decision)) return reply.code(400).send({ error: "Choose whether to approve or reject the standby request." });
    if (decision === "approve" && confirmReplace !== true) return reply.code(400).send({ error: "Confirm that this site's data may be replaced by the primary's next snapshot." });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const requested = await client.query<{ id: string; source_installation_id: string; source_department_id: string; source_department_name: string; source_epoch: string; state: string; expires_at: Date }>("SELECT id,source_installation_id,source_department_id,source_department_name,source_epoch::text,state,expires_at FROM sync_redundancy_standby_requests WHERE id=$1 AND target_department_id=$2 FOR UPDATE", [request.params.id, department]);
      const row = requested.rows[0];
      if (!row || row.state !== "pending" || row.expires_at <= new Date()) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "This standby request is unavailable or expired." }); }
      if (decision === "reject") {
        await client.query("UPDATE sync_redundancy_standby_requests SET state='rejected',reviewed_at=now(),reviewed_by=$2 WHERE id=$1", [row.id, request.authenticatedUser!.id]);
        await client.query("COMMIT");
        return { requestId: row.id, state: "rejected" };
      }
      const trusted = await client.query("SELECT 1 FROM sync_peers WHERE installation_id=$1 AND trust_state='trusted'", [row.source_installation_id]);
      if (!trusted.rowCount) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "The requesting server is no longer trusted." }); }
      const target = await client.query<{ role: string; site_epoch: string; upstream_installation_id: string | null; upstream_department_id: string | null }>("SELECT role,site_epoch::text,upstream_installation_id,upstream_department_id FROM sync_site_redundancy WHERE department_id=$1 FOR UPDATE", [department]);
      const current = target.rows[0];
      if (!current || (current.role === "standby" && (current.upstream_installation_id !== row.source_installation_id || current.upstream_department_id !== row.source_department_id))) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "This site has since been configured for a different primary." }); }
      if (BigInt(row.source_epoch) < BigInt(current.site_epoch)) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "The request comes from an older site epoch; it cannot replace newer data." }); }
      await client.query("UPDATE sync_site_redundancy SET role='standby',primary_installation_id=$2,former_standby_installation_id=NULL,former_standby_department_id=NULL,upstream_installation_id=$2,upstream_department_id=$3,site_epoch=$4,snapshot_revision=0,last_snapshot_id=NULL,last_replica_digest=NULL,last_source_digest=NULL,last_replica_manifest=NULL,replicated_user_ids='{}'::uuid[],last_snapshot_at=NULL,last_verified_at=NULL,last_error=NULL,promoted_at=NULL,fenced_at=NULL,updated_at=now() WHERE department_id=$1", [department, row.source_installation_id, row.source_department_id, row.source_epoch]);
      await client.query("INSERT INTO sync_redundancy_audit(id,department_id,actor_user_id,action,old_epoch,new_epoch,source_installation_id,note) VALUES($1,$2,$3,'standby_configured',$4,$5,$6,$7)", [randomUUID(), department, request.authenticatedUser!.id, current.site_epoch, row.source_epoch, row.source_installation_id, "Administrator approved an outbound standby request and acknowledged that the next primary snapshot replaces this site's replicated data."]);
      await client.query("UPDATE sync_redundancy_standby_requests SET state='approved',reviewed_at=now(),reviewed_by=$2 WHERE id=$1", [row.id, request.authenticatedUser!.id]);
      await client.query("COMMIT");
      return { requestId: row.id, state: "approved", role: "standby", upstreamInstallationId: row.source_installation_id, upstreamDepartmentId: row.source_department_id, siteEpoch: row.source_epoch };
    } catch (error) { await client.query("ROLLBACK"); return reply.code(409).send({ error: error instanceof Error ? error.message : "Could not review the standby request." }); }
    finally { client.release(); }
  });

  app.post<{ Params: { id: string }; Body: { decision: "approve" | "reject"; confirmReplace?: boolean } }>(`${adminPrefix}/redundancy/pull-standby-requests/:id/review`, async (request, reply) => {
    const department = await context.resolveDepartmentId(request, reply, true);
    if (!department || !requireManager(request, reply) || !context.validateMutation(request, reply)) return reply;
    const { decision, confirmReplace } = request.body ?? {};
    if (!new Set(["approve", "reject"]).has(decision)) return reply.code(400).send({ error: "Choose whether to approve or reject the outbound standby request." });
    if (decision === "approve" && confirmReplace !== true) return reply.code(400).send({ error: "Confirm that this primary may send its complete site snapshot to the approved standby." });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const requested = await client.query<{ id: string; target_installation_id: string; target_department_id: string; source_epoch: string; state: string }>("SELECT id,target_installation_id,target_department_id,source_epoch::text,state FROM sync_redundancy_pull_authorizations WHERE id=$1 AND source_department_id=$2 FOR UPDATE", [request.params.id, department]);
      const row = requested.rows[0];
      if (!row || row.state !== "pending") { await client.query("ROLLBACK"); return reply.code(409).send({ error: "This outbound standby request is no longer pending." }); }
      const source = await client.query<{ role: string; site_epoch: string }>("SELECT role,site_epoch::text FROM sync_site_redundancy WHERE department_id=$1 FOR UPDATE", [department]);
      const peer = await client.query("SELECT 1 FROM sync_peers WHERE installation_id=$1 AND trust_state='trusted'", [row.target_installation_id]);
      if (decision === "approve" && (source.rows[0]?.role !== "primary" || source.rows[0]?.site_epoch !== row.source_epoch || !peer.rowCount)) {
        await client.query("ROLLBACK"); return reply.code(409).send({ error: "The source site changed epoch or role, or the requesting server is no longer trusted." });
      }
      await client.query("UPDATE sync_redundancy_pull_authorizations SET state=$2,reviewed_at=now(),reviewed_by=$3 WHERE id=$1", [row.id, decision === "approve" ? "approved" : "rejected", request.authenticatedUser!.id]);
      await client.query("INSERT INTO sync_redundancy_audit(id,department_id,actor_user_id,action,old_epoch,new_epoch,source_installation_id,note) VALUES($1,$2,$3,$4,$5,$5,$6,$7)", [randomUUID(), department, request.authenticatedUser!.id, decision === "approve" ? "standby_pull_approved" : "standby_pull_rejected", row.source_epoch, row.target_installation_id, decision === "approve" ? "Site administrator approved complete snapshots to be pulled by this trusted standby." : "Site administrator rejected the outbound standby request."]);
      await client.query("COMMIT");
      return { requestId: row.id, state: decision === "approve" ? "approved" : "rejected" };
    } catch (error) { await client.query("ROLLBACK"); return reply.code(409).send({ error: error instanceof Error ? error.message : "Could not review the outbound standby request." }); }
    finally { client.release(); }
  });

  app.get<{ Querystring: { peerInstallationId?: string } }>(`${adminPrefix}/redundancy/peer-sites`, async (request, reply) => {
    if (!await context.resolveDepartmentId(request, reply, true) || !requireManager(request, reply)) return reply;
    const peerId = request.query.peerInstallationId ?? "";
    if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(peerId)) return reply.code(400).send({ error: "Choose a trusted server." });
    const peerResult = await pool.query<PeerRow>("SELECT * FROM sync_peers WHERE installation_id=$1 AND trust_state='trusted'", [peerId]);
    const peer = peerResult.rows[0];
    if (!peer) return reply.code(404).send({ error: "This trusted server was not found." });
    try {
      const identity = await getIdentity(pool, siteName);
      return await signedRemoteRequest<{ installationId: string; sites: Array<{ id: string; name: string; time_zone: string; role: string }> }>(peer, identity, "GET", `${prefix}/redundancy/sites`);
    } catch (error) { return reply.code(502).send({ error: error instanceof Error ? error.message : "Could not load the trusted server's locations." }); }
  });

  app.post<{ Body: { note: string } }>(`${adminPrefix}/redundancy/fence`, async (request, reply) => {
    const department = await context.resolveDepartmentId(request, reply, true);
    if (!department || !requireManager(request, reply) || !context.validateMutation(request, reply)) return reply;
    const note = request.body?.note?.trim();
    if (!note || note.length < 20) return reply.code(400).send({ error: "Describe the external action that prevents this server from serving the location before marking it fenced." });
    const identity = await getIdentity(pool, siteName);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const state = await client.query<{ role: string; site_epoch: string }>("SELECT role,site_epoch::text FROM sync_site_redundancy WHERE department_id=$1 FOR UPDATE", [department]);
      if (state.rows[0]?.role !== "primary") throw new Error("Only the current primary can be marked fenced.");
      await client.query("UPDATE sync_site_redundancy SET role='fenced',fenced_at=now(),updated_at=now() WHERE department_id=$1", [department]);
      await client.query("INSERT INTO sync_redundancy_audit(id,department_id,actor_user_id,action,old_epoch,new_epoch,source_installation_id,note) VALUES($1,$2,$3,'fenced',$4,$4,$5,$6)", [randomUUID(), department, request.authenticatedUser!.id, state.rows[0].site_epoch, identity.installationId, note.slice(0, 1000)]);
      await client.query("COMMIT");
      return { departmentId: department, role: "fenced", epoch: state.rows[0].site_epoch, fencedAt: new Date().toISOString() };
    } catch (error) {
      await client.query("ROLLBACK");
      return reply.code(409).send({ error: error instanceof Error ? error.message : "Could not fence this site." });
    } finally { client.release(); }
  });

  app.post<{ Body: { sourceInstallationId: string; sourceDepartmentId: string; replaceExistingData: boolean } }>(`${adminPrefix}/redundancy/standby`, async (request, reply) => {
    const department = await context.resolveDepartmentId(request, reply, true);
    if (!department || !requireManager(request, reply) || !context.validateMutation(request, reply)) return reply;
    const body = request.body;
    if (!body || typeof body.sourceInstallationId !== "string" || typeof body.sourceDepartmentId !== "string" || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(body.sourceInstallationId) || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(body.sourceDepartmentId) || body.replaceExistingData !== true) return reply.code(400).send({ error: "Select a trusted primary and confirm that its next snapshot replaces this site's data." });
    const peerResult = await pool.query<PeerRow>("SELECT * FROM sync_peers WHERE installation_id=$1 AND trust_state='trusted'", [body.sourceInstallationId]);
    const peer = peerResult.rows[0];
    if (!peer) return reply.code(400).send({ error: "The primary must be paired and trusted first." });
    try {
      const identity = await getIdentity(pool, siteName);
      const remote = await signedRemoteRequest<{ role: string; siteEpoch: string; departmentId: string }>(peer, identity, "GET", `${prefix}/redundancy/capabilities?departmentId=${encodeURIComponent(body.sourceDepartmentId)}`);
      if (remote.role !== "primary" || remote.departmentId !== body.sourceDepartmentId) return reply.code(409).send({ error: "The selected remote site is not an active primary." });
      const current = await pool.query<{ role: string; site_epoch: string }>("SELECT role,site_epoch::text FROM sync_site_redundancy WHERE department_id=$1", [department]);
      if (!current.rowCount || !["primary", "standby", "fenced"].includes(current.rows[0].role)) return reply.code(409).send({ error: "This site cannot be configured as a standby from its current state." });
      if (BigInt(remote.siteEpoch) < BigInt(current.rows[0].site_epoch)) return reply.code(409).send({ error: "The selected primary has an older epoch. A stale primary cannot replace this site's newer data." });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("UPDATE sync_site_redundancy SET role='standby',primary_installation_id=$2,former_standby_installation_id=NULL,former_standby_department_id=NULL,upstream_installation_id=$2,upstream_department_id=$3,site_epoch=$4,snapshot_revision=0,last_snapshot_id=NULL,last_replica_digest=NULL,last_source_digest=NULL,last_replica_manifest=NULL,replicated_user_ids='{}'::uuid[],last_snapshot_at=NULL,last_verified_at=NULL,last_error=NULL,promoted_at=NULL,fenced_at=NULL,updated_at=now() WHERE department_id=$1", [department, peer.installation_id, body.sourceDepartmentId, remote.siteEpoch]);
        await client.query("INSERT INTO sync_redundancy_audit(id,department_id,actor_user_id,action,old_epoch,new_epoch,source_installation_id,note) VALUES($1,$2,$3,'standby_configured',$4,$5,$6,$7)", [randomUUID(), department, request.authenticatedUser!.id, current.rows[0].site_epoch, remote.siteEpoch, peer.installation_id, "Administrator acknowledged that the primary snapshot will replace this site's records."]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
      return { departmentId: department, role: "standby", primaryInstallationId: peer.installation_id, upstreamDepartmentId: body.sourceDepartmentId, siteEpoch: remote.siteEpoch };
    } catch (error) { return reply.code(502).send({ error: error instanceof Error ? error.message : "The primary server could not be verified." }); }
  });

  app.post<{ Body: { fencingNote: string; fencedInstallationId: string; confirmSnapshotDataLoss: boolean } }>(`${adminPrefix}/redundancy/promote`, async (request, reply) => {
    const department = await context.resolveDepartmentId(request, reply, true);
    if (!department || !requireManager(request, reply) || !context.validateMutation(request, reply)) return reply;
    const body = request.body;
    if (!body || typeof body.fencingNote !== "string" || body.fencingNote.trim().length < 20 || body.confirmSnapshotDataLoss !== true || typeof body.fencedInstallationId !== "string" || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(body.fencedInstallationId)) return reply.code(400).send({ error: "Confirm the old primary is fenced, acknowledge that changes after the last snapshot may be missing, and describe the fencing action." });
    const stateResult = await pool.query<{ role: string; primary_installation_id: string; upstream_installation_id: string | null; site_epoch: string; last_snapshot_at: Date | null; last_verified_at: Date | null; last_replica_digest: string | null; last_replica_manifest: RedundancyModuleManifestEntry[] | null }>(
      "SELECT role,primary_installation_id,upstream_installation_id,site_epoch::text,last_snapshot_at,last_verified_at,last_replica_digest,last_replica_manifest FROM sync_site_redundancy WHERE department_id=$1 FOR UPDATE", [department],
    );
    const state = stateResult.rows[0];
    if (!state || state.role !== "standby" || !state.upstream_installation_id) return reply.code(409).send({ error: "This location is not configured as a standby." });
    if (body.fencedInstallationId !== state.upstream_installation_id) return reply.code(409).send({ error: "The installation you confirmed does not match this standby's configured primary." });
    if (!state.last_snapshot_at || !state.last_verified_at || !state.last_replica_digest || !state.last_replica_manifest || state.last_verified_at < new Date(Date.now() - 5 * 60_000)) return reply.code(409).send({ error: "A complete snapshot must have been end-to-end verified within the last five minutes before promotion." });
    const adapters = new Map(context.replication.list().map((adapter) => [adapter.moduleId, adapter]));
    if (!state.last_replica_manifest.some((module) => module.moduleId === "core-site") || !await manifestSupportedByAdapters(state.last_replica_manifest, adapters, department)) return reply.code(409).send({ error: "A snapshot adapter used by the verified site data is no longer installed or compatible. A fresh snapshot is required before promotion." });
    const identity = await getIdentity(pool, siteName);
    const oldEpoch = BigInt(state.site_epoch);
    const newEpoch = oldEpoch + 1n;
    const client = await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      const locked = await client.query("SELECT role,site_epoch::text FROM sync_site_redundancy WHERE department_id=$1 FOR UPDATE", [department]);
      if (locked.rows[0]?.role !== "standby" || locked.rows[0]?.site_epoch !== state.site_epoch) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "The standby state changed during promotion. Refresh and review it again." }); }
      if (!await manifestSupportedByAdapters(state.last_replica_manifest, adapters, department)) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "A snapshot adapter changed during promotion. Push a fresh snapshot and retry." });
      }
      const currentSnapshots: Record<string, unknown> = {};
      for (const module of state.last_replica_manifest) {
        const adapter = adapters.get(module.moduleId)!;
        currentSnapshots[module.moduleId] = await adapter.exportSnapshot(client, department);
      }
      if (replicationDigest(currentSnapshots) !== state.last_replica_digest) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "The standby data changed after its last verified snapshot. Push a fresh snapshot before promotion." });
      }
      await client.query("UPDATE sync_site_redundancy SET role='primary',primary_installation_id=$2,former_standby_installation_id=upstream_installation_id,former_standby_department_id=upstream_department_id,upstream_installation_id=NULL,upstream_department_id=NULL,site_epoch=$3,promoted_at=now(),fenced_at=NULL,updated_at=now(),last_error=NULL WHERE department_id=$1", [department, identity.installationId, newEpoch.toString()]);
      await client.query("INSERT INTO sync_redundancy_audit(id,department_id,actor_user_id,action,old_epoch,new_epoch,source_installation_id,note) VALUES($1,$2,$3,'promoted',$4,$5,$6,$7)", [randomUUID(), department, request.authenticatedUser!.id, oldEpoch.toString(), newEpoch.toString(), body.fencedInstallationId, `Snapshot data-loss risk acknowledged. External fencing: ${body.fencingNote.trim()}`.slice(0, 1000)]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    return { departmentId: department, role: "primary", epoch: newEpoch.toString(), promotedAt: new Date().toISOString() };
  });

  app.post(`${adminPrefix}/invitations`, async (request, reply) => {
    if (!requireManager(request, reply) || !context.validateMutation(request, reply)) return;
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
    const id = randomUUID();
    await pool.query("INSERT INTO sync_pairing_invitations(id,token_hash,expires_at,created_by) VALUES($1,$2,now()+interval '30 minutes',$3)", [id, tokenHash, request.authenticatedUser!.id]);
    const expires = await pool.query<{ expires_at: Date | string }>("SELECT expires_at FROM sync_pairing_invitations WHERE id=$1", [id]);
    return reply.code(201).send({ id, pairingCode: token, expiresAt: expires.rows[0].expires_at });
  });

  app.delete<{ Params: { id: string } }>(`${adminPrefix}/invitations/:id`, async (request, reply) => {
    if (!requireManager(request, reply) || !context.validateMutation(request, reply)) return;
    await pool.query("DELETE FROM sync_pairing_invitations WHERE id=$1 AND used_at IS NULL", [request.params.id]);
    return { deleted: true };
  });

  app.post<{ Body: { baseUrl: string } }>(`${adminPrefix}/discover`, async (request, reply) => {
    if (!requireManager(request, reply) || !context.validateMutation(request, reply)) return;
    try {
      const baseUrl = normalizeBaseUrl(request.body.baseUrl);
      const discovered = await remoteIdentity(baseUrl);
      const local = await getIdentity(pool, siteName);
      if (discovered.installationId === local.installationId) return reply.code(400).send({ error: "This is the current server. Choose a different Smart-Church installation." });
      const saved = await pool.query<{ fingerprint: string; trust_state: string }>("SELECT fingerprint,trust_state FROM sync_peers WHERE installation_id=$1", [discovered.installationId]);
      if (saved.rowCount && saved.rows[0].fingerprint !== discovered.fingerprint) return reply.code(409).send({ error: "This installation is already known with a different fingerprint. Follow the key rotation procedure." });
      return { baseUrl, identity: discovered, existingTrustState: saved.rows[0]?.trust_state ?? null };
    } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Could not verify the remote server." }); }
  });

  app.post<{ Body: { baseUrl: string; pairingCode: string; expectedFingerprint: string } }>(`${adminPrefix}/peers`, async (request, reply) => {
    if (!requireManager(request, reply) || !context.validateMutation(request, reply)) return;
    try {
      const baseUrl = normalizeBaseUrl(request.body.baseUrl);
      const discovered = await remoteIdentity(baseUrl);
      if (discovered.fingerprint !== request.body.expectedFingerprint) return reply.code(409).send({ error: "The remote fingerprint changed. Verify the new fingerprint before pairing." });
      const local = await getIdentity(pool, siteName);
      if (discovered.installationId === local.installationId) return reply.code(400).send({ error: "This is the current server. Choose a different Smart-Church installation." });
      const advertisedBaseUrl = advertisedPeerBaseUrl(request);
      const pairingBody = JSON.stringify({ pairingCode: checkBodyString(request.body.pairingCode, 128, "pairing code"), identity: { installationId: local.installationId, displayName: local.displayName, publicKeyPem: local.publicKeyPem, fingerprint: local.fingerprint, protocolVersion }, baseUrl: advertisedBaseUrl });
      // One-time pairing creates pending trust; all later peer data uses WebSocket.
      const response = await fetch(`${baseUrl}${prefix}/pair`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: pairingBody, signal: AbortSignal.timeout(12_000), redirect: "error" });
      const paired = await readRemoteJson<{ paired: boolean; trustState: string; installationId: string; fingerprint: string }>(response, discovered.publicKeyPem);
      if (!paired.paired || paired.installationId !== discovered.installationId || paired.fingerprint !== discovered.fingerprint || paired.trustState !== "pending") throw new Error("The remote server returned an inconsistent pairing confirmation.");
      await pool.query(
        `INSERT INTO sync_peers(installation_id,display_name,base_url,public_key_pem,fingerprint,trust_state,direction,requested_by)
         VALUES($1,$2,$3,$4,$5,'pending','outgoing',$6)
         ON CONFLICT(installation_id) DO UPDATE SET display_name=EXCLUDED.display_name,base_url=EXCLUDED.base_url
           WHERE sync_peers.public_key_pem=EXCLUDED.public_key_pem AND sync_peers.trust_state='pending'`,
        [discovered.installationId, discovered.displayName, baseUrl, discovered.publicKeyPem, discovered.fingerprint, request.authenticatedUser!.id],
      );
      const stored = await pool.query("SELECT 1 FROM sync_peers WHERE installation_id=$1 AND trust_state='pending' AND direction='outgoing'", [discovered.installationId]);
      if (!stored.rowCount) return reply.code(409).send({ error: "An existing peer record prevents this pairing. Review its trust state before retrying." });
      await pool.query("INSERT INTO sync_peer_audit(id,peer_installation_id,action,actor_user_id,fingerprint) VALUES($1,$2,'pair_requested',$3,$4)", [randomUUID(), discovered.installationId, request.authenticatedUser!.id, discovered.fingerprint]);
      return reply.code(201).send({ installationId: discovered.installationId, displayName: discovered.displayName, fingerprint: discovered.fingerprint, trustState: "pending" });
    } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Pairing failed." }); }
  });

  app.post<{ Params: { installationId: string } }>(`${adminPrefix}/peers/:installationId/check`, async (request, reply) => {
    if (!requireManager(request, reply) || !context.validateMutation(request, reply)) return;
    const result = await pool.query<PeerRow>("SELECT * FROM sync_peers WHERE installation_id=$1 AND trust_state<>'revoked'", [request.params.installationId]);
    const peer = result.rows[0];
    if (!peer) return reply.code(404).send({ error: "This peer is not available." });
    if (peer.trust_state !== "trusted" && !peer.base_url) return reply.code(409).send({ error: "This pending peer has no reachable HTTPS address for trust bootstrap." });
    try {
      const identity = await getIdentity(pool, siteName);
      const status = peer.trust_state === "trusted"
        ? await signedRemoteRequest<{ installationId: string; peerInstallationId: string; peerTrustState: string; peerFingerprint: string; protocolVersion: string }>(peer, identity, "GET", `${prefix}/status`)
        : await bootstrapRemoteStatus(peer, identity);
      if (status.installationId !== peer.installation_id || status.peerInstallationId !== identity.installationId || status.peerFingerprint !== identity.fingerprint || status.protocolVersion !== protocolVersion) throw new Error("The remote server returned a status for a different peer identity.");
      return { reachable: true, remoteTrustState: status.peerTrustState };
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 240) : "Connection failed.";
      await pool.query("UPDATE sync_peers SET last_error=$2 WHERE installation_id=$1", [peer.installation_id, message]);
      return reply.code(502).send({ error: message });
    }
  });

  app.put<{ Params: { installationId: string } }>(`${adminPrefix}/peers/:installationId/trust`, async (request, reply) => {
    if (!requireManager(request, reply) || !context.validateMutation(request, reply)) return;
    const current = await pool.query<PeerRow>("SELECT * FROM sync_peers WHERE installation_id=$1 AND trust_state='pending'", [request.params.installationId]);
    const peer = current.rows[0];
    if (!peer) return reply.code(404).send({ error: "Only a pending peer can be approved." });
    if (peer.direction === "outgoing") {
      if (!peer.base_url) return reply.code(409).send({ error: "This outgoing peer has no reachable address. Re-pair it with a valid HTTPS server URL." });
      try {
        const identity = await getIdentity(pool, siteName);
        const status = await bootstrapRemoteStatus(peer, identity);
        if (status.peerTrustState !== "trusted") return reply.code(409).send({ error: "The remote Server Administrator has not approved this installation yet." });
      } catch { return reply.code(502).send({ error: "Could not verify that the remote administrator approved this installation. Try again later." }); }
    }
    const updated = await pool.query("UPDATE sync_peers SET trust_state='trusted',approved_by=$2,approved_at=now(),last_error=NULL WHERE installation_id=$1 AND trust_state='pending' RETURNING fingerprint", [peer.installation_id, request.authenticatedUser!.id]);
    if (!updated.rowCount) return reply.code(409).send({ error: "The peer trust state changed. Refresh and try again." });
    await pool.query("INSERT INTO sync_peer_audit(id,peer_installation_id,action,actor_user_id,fingerprint) VALUES($1,$2,'trusted',$3,$4)", [randomUUID(), peer.installation_id, request.authenticatedUser!.id, updated.rows[0].fingerprint]);
    return { installationId: peer.installation_id, trustState: "trusted" };
  });

  app.delete<{ Params: { installationId: string } }>(`${adminPrefix}/peers/:installationId`, async (request, reply) => {
    if (!requireManager(request, reply) || !context.validateMutation(request, reply)) return;
    const result = await pool.query<{ fingerprint: string }>("UPDATE sync_peers SET trust_state='revoked',revoked_at=now(),last_error=NULL WHERE installation_id=$1 AND trust_state<>'revoked' RETURNING fingerprint", [request.params.installationId]);
    if (!result.rowCount) return reply.code(404).send({ error: "This active peer was not found." });
    await pool.query("INSERT INTO sync_peer_audit(id,peer_installation_id,action,actor_user_id,fingerprint) VALUES($1,$2,'revoked',$3,$4)", [randomUUID(), request.params.installationId, request.authenticatedUser!.id, result.rows[0].fingerprint]);
    await pool.query("UPDATE sync_share_grants SET state='revoked',revision=revision+1,revoked_at=now(),updated_at=now() WHERE recipient_installation_id=$1 AND state='active'", [request.params.installationId]);
    await pool.query("UPDATE sync_redundancy_pull_authorizations SET state='revoked',reviewed_at=now(),reviewed_by=$2 WHERE target_installation_id=$1 AND state IN ('pending','approved')", [request.params.installationId, request.authenticatedUser!.id]);
    const subscriptions = await pool.query<{ id: string; current_run_id: string | null }>("SELECT id,current_run_id FROM sync_subscriptions WHERE source_installation_id=$1 AND state='active'", [request.params.installationId]);
    await pool.query("UPDATE sync_subscriptions SET state='revoked',current_run_id=NULL,sync_started_at=NULL,last_error='Peer trust was revoked.',updated_at=now() WHERE source_installation_id=$1 AND state='active'", [request.params.installationId]);
    await pool.query("DELETE FROM sync_replica_records WHERE subscription_id=ANY($1::uuid[])", [subscriptions.rows.map((item) => item.id)]);
    await pool.query("DELETE FROM sync_replica_staging WHERE run_id=ANY($1::uuid[])", [subscriptions.rows.map((item) => item.current_run_id).filter(Boolean)]);
    await pool.query("DELETE FROM sync_replica_staging WHERE run_id IN (SELECT snapshot_id FROM sync_replica_push_runs WHERE subscription_id=ANY($1::uuid[]))", [subscriptions.rows.map((item) => item.id)]);
    await pool.query("DELETE FROM sync_replica_push_runs WHERE subscription_id=ANY($1::uuid[])", [subscriptions.rows.map((item) => item.id)]);
    return { installationId: request.params.installationId, trustState: "revoked" };
  });

  app.get(`${adminPrefix}/shares`, async (request, reply) => {
    const department = await context.resolveDepartmentId(request, reply, true);
    if (!department) return reply;
    const grants = await pool.query(
      `SELECT grant.id,grant.recipient_installation_id AS "recipientInstallationId",peer.display_name AS "peerName",
              grant.scopes,grant.delivery_mode AS "deliveryMode",grant.state,grant.revision::text AS revision,
              grant.created_at AS "createdAt",grant.last_pushed_at AS "lastPushedAt",grant.last_push_error AS "lastPushError"
         FROM sync_share_grants grant JOIN sync_peers peer ON peer.installation_id=grant.recipient_installation_id
        WHERE grant.owner_department_id=$1 ORDER BY grant.created_at DESC`, [department],
    );
    return { shares: grants.rows };
  });

  app.post<{ Body: { peerInstallationId: string; scopes: string[]; deliveryMode: "pull" | "push" } }>(`${adminPrefix}/shares`, async (request, reply) => {
    const department = await context.resolveDepartmentId(request, reply, true);
    if (!department || !context.validateMutation(request, reply)) return reply;
    const { peerInstallationId, scopes, deliveryMode } = request.body;
    if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(peerInstallationId) || !Array.isArray(scopes) || !scopes.length || scopes.some((scope) => !["people_names", "services"].includes(scope)) || new Set(scopes).size !== scopes.length || !["pull", "push"].includes(deliveryMode)) return reply.code(400).send({ error: "Choose a trusted peer, at least one valid data scope, and a sync direction." });
    const peer = await pool.query<{ base_url: string | null }>("SELECT base_url FROM sync_peers WHERE installation_id=$1 AND trust_state='trusted'", [peerInstallationId]);
    if (!peer.rowCount) return reply.code(400).send({ error: "Share data only with a mutually trusted server." });
    const id = randomUUID();
    await pool.query("INSERT INTO sync_share_grants(id,owner_department_id,recipient_installation_id,scopes,delivery_mode,state,created_by) VALUES($1,$2,$3,$4,$5,'active',$6)", [id, department, peerInstallationId, scopes, deliveryMode, request.authenticatedUser!.id]);
    return reply.code(201).send({ id, scopes, deliveryMode, state: "active" });
  });

  app.delete<{ Params: { id: string } }>(`${adminPrefix}/shares/:id`, async (request, reply) => {
    const department = await context.resolveDepartmentId(request, reply, true);
    if (!department || !context.validateMutation(request, reply)) return reply;
    const result = await pool.query("UPDATE sync_share_grants SET state='revoked',revision=revision+1,revoked_at=now(),updated_at=now() WHERE id=$1 AND owner_department_id=$2 AND state='active' RETURNING id", [request.params.id, department]);
    if (!result.rowCount) return reply.code(404).send({ error: "This active share was not found." });
    return { id: request.params.id, state: "revoked" };
  });

  app.post(`${adminPrefix}/discover-grants`, async (request, reply) => {
    const department = await context.resolveDepartmentId(request, reply, true);
    if (!department || !context.validateMutation(request, reply)) return reply;
    const identity = await getIdentity(pool, siteName);
    const peers = await pool.query<PeerRow>("SELECT * FROM sync_peers WHERE trust_state='trusted' ORDER BY display_name LIMIT 50");
    const available: Array<Record<string, unknown>> = [];
    for (const peer of peers.rows) {
      try {
        const result = await signedRemoteRequest<{ grants: Array<{ id: string; sourceDepartmentName: string; scopes: string[]; deliveryMode: string; revision: number; createdAt: string }> }>(peer, identity, "GET", `${prefix}/grants`);
        for (const grant of result.grants) available.push({ ...grant, sourceInstallationId: peer.installation_id, sourceServerName: peer.display_name, baseUrl: peer.base_url });
        const activeIds = new Set(result.grants.map((grant) => grant.id));
        const removed = await pool.query<{ id: string; source_grant_id: string; current_run_id: string | null }>("SELECT id,source_grant_id,current_run_id FROM sync_subscriptions WHERE source_installation_id=$1 AND state='active'", [peer.installation_id]);
        const revoked = removed.rows.filter((subscription) => !activeIds.has(subscription.source_grant_id));
        if (revoked.length) {
          await pool.query("UPDATE sync_subscriptions SET state='revoked',current_run_id=NULL,sync_started_at=NULL,last_error='The source revoked this share.',updated_at=now() WHERE id=ANY($1::uuid[])", [revoked.map((subscription) => subscription.id)]);
          await pool.query("DELETE FROM sync_replica_records WHERE subscription_id=ANY($1::uuid[])", [revoked.map((subscription) => subscription.id)]);
          await pool.query("DELETE FROM sync_replica_staging WHERE run_id=ANY($1::uuid[])", [revoked.map((subscription) => subscription.current_run_id).filter(Boolean)]);
          await pool.query("DELETE FROM sync_replica_staging WHERE run_id IN (SELECT snapshot_id FROM sync_replica_push_runs WHERE subscription_id=ANY($1::uuid[]))", [revoked.map((subscription) => subscription.id)]);
          await pool.query("DELETE FROM sync_replica_push_runs WHERE subscription_id=ANY($1::uuid[])", [revoked.map((subscription) => subscription.id)]);
        }
      } catch (error) { app.log.warn({ module: "sync", peer: peer.installation_id, reason: error instanceof Error ? error.message.slice(0, 120) : "request failed" }, "A shared-grant discovery request failed."); }
    }
    return { grants: available };
  });

  app.post<{ Body: { peerInstallationId: string; targetDepartmentId: string } }>(`${adminPrefix}/redundancy/push`, async (request, reply) => {
    const department = await context.resolveDepartmentId(request, reply, true);
    if (!department || !requireManager(request, reply) || !context.validateMutation(request, reply)) return reply;
    const body = request.body;
    if (!body || typeof body.peerInstallationId !== "string" || typeof body.targetDepartmentId !== "string" || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(body.peerInstallationId) || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(body.targetDepartmentId)) return reply.code(400).send({ error: "Choose a trusted peer and standby site." });
    const peerResult = await pool.query<PeerRow>("SELECT * FROM sync_peers WHERE installation_id=$1 AND trust_state='trusted'", [body.peerInstallationId]);
    const peer = peerResult.rows[0];
    if (!peer) return reply.code(400).send({ error: "Choose a paired and trusted standby server." });
    try {
      const result = await pushRedundancySnapshot(pool, context, siteName, department, peer, body.targetDepartmentId);
      if (result.skipped) return reply.code(409).send({ error: result.reason });
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 500) : "The redundancy snapshot could not be transferred.";
      return reply.code(502).send({ error: reason });
    }
  });

  app.get(`${adminPrefix}/subscriptions`, async (request, reply) => {
    const department = await context.resolveDepartmentId(request, reply, true);
    if (!department) return reply;
    const subscriptions = await pool.query(
      `SELECT subscription.id,subscription.source_installation_id AS "sourceInstallationId",peer.display_name AS "sourceServerName",
              peer.base_url AS "sourceBaseUrl",subscription.source_grant_id AS "sourceGrantId",subscription.scopes,subscription.delivery_mode AS "deliveryMode",
              subscription.state,subscription.last_synced_at AS "lastSyncedAt",subscription.last_error AS "lastError",
              subscription.source_revision::text AS "sourceRevision",
              (SELECT count(*)::int FROM sync_replica_records record WHERE record.subscription_id=subscription.id) AS "recordCount"
         FROM sync_subscriptions subscription JOIN sync_peers peer ON peer.installation_id=subscription.source_installation_id
        WHERE subscription.recipient_department_id=$1 ORDER BY peer.display_name,subscription.created_at DESC`, [department],
    );
    return { subscriptions: subscriptions.rows };
  });

  app.post<{ Body: { sourceInstallationId: string; sourceGrantId: string } }>(`${adminPrefix}/subscriptions`, async (request, reply) => {
    const department = await context.resolveDepartmentId(request, reply, true);
    if (!department || !context.validateMutation(request, reply)) return reply;
    const peerResult = await pool.query<PeerRow>("SELECT * FROM sync_peers WHERE installation_id=$1 AND trust_state='trusted'", [request.body.sourceInstallationId]);
    const peer = peerResult.rows[0];
    if (!peer) return reply.code(400).send({ error: "Choose a mutually trusted source server." });
    try {
      const identity = await getIdentity(pool, siteName);
      const remote = await signedRemoteRequest<{ grants: Array<{ id: string; scopes: string[]; deliveryMode: string }> }>(peer, identity, "GET", `${prefix}/grants`);
      const grant = remote.grants.find((item) => item.id === request.body.sourceGrantId);
      if (!grant || !grant.scopes.length) return reply.code(404).send({ error: "This share is no longer available." });
      const id = randomUUID();
      const inserted = await pool.query(
        `INSERT INTO sync_subscriptions(id,source_installation_id,source_grant_id,recipient_department_id,scopes,delivery_mode,state)
         VALUES($1,$2,$3,$4,$5,$6,'active') ON CONFLICT(source_installation_id,source_grant_id,recipient_department_id) DO NOTHING RETURNING id`,
        [id, peer.installation_id, request.body.sourceGrantId, department, grant.scopes, grant.deliveryMode === "push" ? "push" : "pull"],
      );
      let subscriptionId: string = id;
      if (!inserted.rowCount) {
        const existing = await pool.query<{ id: string; state: string }>("SELECT id,state FROM sync_subscriptions WHERE source_installation_id=$1 AND source_grant_id=$2 AND recipient_department_id=$3", [peer.installation_id, request.body.sourceGrantId, department]);
        if (!existing.rowCount) return reply.code(409).send({ error: "The subscription changed while accepting the share. Refresh and try again." });
        if (existing.rows[0].state === "rejected") return reply.code(409).send({ error: "This share was rejected before. Ask the owner to create a new grant." });
        subscriptionId = existing.rows[0].id;
      }
      return reply.code(201).send({ id: subscriptionId, state: "active", scopes: grant.scopes });
    } catch (error) { return reply.code(502).send({ error: error instanceof Error ? error.message : "The source server could not be verified." }); }
  });

  app.delete<{ Params: { id: string } }>(`${adminPrefix}/subscriptions/:id`, async (request, reply) => {
    const department = await context.resolveDepartmentId(request, reply, true);
    if (!department || !context.validateMutation(request, reply)) return reply;
    const previous = await pool.query<{ id: string; current_run_id: string | null }>("SELECT id,current_run_id FROM sync_subscriptions WHERE id=$1 AND recipient_department_id=$2 AND state IN ('active','pending')", [request.params.id, department]);
    const result = await pool.query("UPDATE sync_subscriptions SET state='rejected',current_run_id=NULL,sync_started_at=NULL,last_error=NULL,updated_at=now() WHERE id=$1 AND recipient_department_id=$2 AND state IN ('active','pending') RETURNING id", [request.params.id, department]);
    if (!result.rowCount) return reply.code(404).send({ error: "This active subscription was not found." });
    await pool.query("DELETE FROM sync_replica_records WHERE subscription_id=$1", [request.params.id]);
    if (previous.rows[0].current_run_id) await pool.query("DELETE FROM sync_replica_staging WHERE run_id=$1", [previous.rows[0].current_run_id]);
    await pool.query("DELETE FROM sync_replica_staging WHERE run_id IN (SELECT snapshot_id FROM sync_replica_push_runs WHERE subscription_id=$1)", [request.params.id]);
    await pool.query("DELETE FROM sync_replica_push_runs WHERE subscription_id=$1", [request.params.id]);
    return { id: request.params.id, state: "rejected" };
  });

  app.post<{ Params: { id: string } }>(`${adminPrefix}/subscriptions/:id/sync`, async (request, reply) => {
    const department = await context.resolveDepartmentId(request, reply, true);
    if (!department || !context.validateMutation(request, reply)) return reply;
    const runId = randomUUID();
    const result = await pool.query<{ source_installation_id: string; source_grant_id: string; scopes: string[]; base_url: string | null; public_key_pem: string; installation_id: string }>(
      `UPDATE sync_subscriptions subscription SET current_run_id=$3,sync_started_at=now(),last_error=NULL,updated_at=now()
         FROM sync_peers peer WHERE subscription.id=$1 AND subscription.recipient_department_id=$2 AND subscription.state='active'
          AND peer.installation_id=subscription.source_installation_id AND peer.trust_state='trusted'
          AND (subscription.current_run_id IS NULL OR subscription.sync_started_at<now()-interval '15 minutes')
          AND NOT EXISTS(SELECT 1 FROM sync_replica_push_runs push_run WHERE push_run.subscription_id=subscription.id AND push_run.created_at>now()-interval '15 minutes')
       RETURNING subscription.source_installation_id,subscription.source_grant_id,subscription.scopes,peer.base_url,peer.public_key_pem,peer.installation_id`,
      [request.params.id, department, runId],
    );
    const subscription = result.rows[0];
    if (!subscription) return reply.code(409).send({ error: "This subscription is unavailable, already syncing, or its source peer is not trusted." });
    const peer = { base_url: subscription.base_url, installation_id: subscription.installation_id, public_key_pem: subscription.public_key_pem };
    try {
      const identity = await getIdentity(pool, siteName);
      const snapshot = await signedRemoteRequest<{ snapshotId: string; grantId: string; grantRevision: number; totalRecords: number; offset: number; hasMore: boolean; records: unknown }>(peer, identity, "POST", `${prefix}/grants/${subscription.source_grant_id}/snapshot`, "{}");
      if (snapshot.grantId !== subscription.source_grant_id || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(snapshot.snapshotId) || !Number.isSafeInteger(snapshot.grantRevision) || !Number.isSafeInteger(snapshot.totalRecords) || snapshot.totalRecords < 0 || snapshot.totalRecords > maxSnapshotRecords) throw new Error("The source returned invalid snapshot metadata.");
      let offset = 0;
      let page = snapshot;
      while (true) {
        if (page.offset !== offset) throw new Error("The source returned pages out of order.");
        const records = parseSyncRecords(page.records, subscription.scopes);
        await storeStaging(pool, runId, records);
        offset += records.length;
        if (offset > snapshot.totalRecords) throw new Error("The source returned too many records.");
        if (!page.hasMore) break;
        page = await signedRemoteRequest<typeof snapshot>(peer, identity, "GET", `${prefix}/snapshots/${snapshot.snapshotId}?offset=${offset}`);
      }
      if (offset !== snapshot.totalRecords) throw new Error("The source snapshot was incomplete. No records were changed.");
      await finalizeReplica(pool, request.params.id, runId, snapshot.grantRevision, snapshot.snapshotId);
      return { id: request.params.id, state: "active", recordCount: snapshot.totalRecords, lastSyncedAt: new Date().toISOString() };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "The peer sync request failed.";
      if (/share is no longer available|share was revoked/.test(reason)) {
        await pool.query("UPDATE sync_subscriptions SET state='revoked',current_run_id=NULL,sync_started_at=NULL,last_error='The source revoked this share.',updated_at=now() WHERE id=$1", [request.params.id]);
        await pool.query("DELETE FROM sync_replica_records WHERE subscription_id=$1", [request.params.id]);
      } else {
        await pool.query("UPDATE sync_subscriptions SET current_run_id=NULL,sync_started_at=NULL,last_error=$2,updated_at=now() WHERE id=$1 AND current_run_id=$3", [request.params.id, reason.slice(0, 240), runId]);
      }
      await pool.query("DELETE FROM sync_replica_staging WHERE run_id=$1", [runId]);
      return reply.code(502).send({ error: reason });
    }
  });

  app.post<{ Params: { id: string } }>(`${adminPrefix}/shares/:id/push`, async (request, reply) => {
    const department = await context.resolveDepartmentId(request, reply, true);
    if (!department || !context.validateMutation(request, reply)) return reply;
    const grantResult = await pool.query<{ recipient_installation_id: string; owner_department_id: string; scopes: string[]; revision: string; state: string; delivery_mode: string; base_url: string | null; public_key_pem: string }>(
      `SELECT grant.recipient_installation_id,grant.owner_department_id,grant.scopes,grant.revision::text,grant.state,grant.delivery_mode,peer.base_url,peer.public_key_pem
         FROM sync_share_grants grant JOIN sync_peers peer ON peer.installation_id=grant.recipient_installation_id
        WHERE grant.id=$1 AND grant.owner_department_id=$2 AND peer.trust_state='trusted'`, [request.params.id, department],
    );
    const grant = grantResult.rows[0];
    if (!grant || grant.state !== "active") return reply.code(404).send({ error: "This active share was not found." });
    if (grant.delivery_mode !== "push") return reply.code(400).send({ error: "This share is configured for recipient-initiated pull sync." });
    const peer = { base_url: grant.base_url, installation_id: grant.recipient_installation_id, public_key_pem: grant.public_key_pem };
    try {
      const identity = await getIdentity(pool, siteName);
      const remote = await signedRemoteRequest<{ subscriptions: Array<{ id: string }> }>(peer, identity, "GET", `${prefix}/grant-subscriptions?grantId=${encodeURIComponent(request.params.id)}`);
      if (!remote.subscriptions.length) return reply.code(409).send({ error: "The receiving server has not accepted this share into a location yet." });
      const records = await snapshotRecords(pool, grant.owner_department_id, grant.scopes);
      const snapshotId = randomUUID();
      for (const subscription of remote.subscriptions) {
        for (let offset = 0; offset < records.length || offset === 0; offset += syncPageSize) {
          const stillActive = await pool.query(
            `SELECT 1 FROM sync_share_grants grant JOIN sync_peers peer ON peer.installation_id=grant.recipient_installation_id AND peer.trust_state='trusted'
              WHERE grant.id=$1 AND grant.owner_department_id=$2 AND grant.state='active' AND grant.revision=$3`,
            [request.params.id, department, grant.revision],
          );
          if (!stillActive.rowCount) throw new Error("This share was revoked or changed while the push was running.");
          const page = records.slice(offset, offset + syncPageSize);
          const body = JSON.stringify({ subscriptionId: subscription.id, grantId: request.params.id, snapshotId, grantRevision: Number(grant.revision), totalRecords: records.length, offset, hasMore: offset + page.length < records.length, records: page });
          await signedRemoteRequest(peer, identity, "POST", `${prefix}/replicas/import`, body);
          if (!records.length) break;
        }
      }
      await pool.query("UPDATE sync_share_grants SET last_pushed_at=now(),last_push_error=NULL WHERE id=$1", [request.params.id]);
      return { id: request.params.id, pushed: true, recordCount: records.length, destinationCount: remote.subscriptions.length };
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 240) : "The push could not be completed.";
      await pool.query("UPDATE sync_share_grants SET last_push_error=$2 WHERE id=$1", [request.params.id, reason]);
      return reply.code(502).send({ error: reason });
    }
  });

  app.get<{ Querystring: { subscriptionId?: string } }>(`${adminPrefix}/replicas`, async (request, reply) => {
    const department = await context.resolveDepartmentId(request, reply, true);
    if (!department) return reply;
    const subscriptionId = request.query.subscriptionId;
    if (subscriptionId) {
      const owned = await pool.query("SELECT id FROM sync_subscriptions WHERE id=$1 AND recipient_department_id=$2 AND state='active'", [subscriptionId, department]);
      if (!owned.rowCount) return reply.code(404).send({ error: "This replica is not available in this location." });
      const records = await pool.query("SELECT scope,source_id AS \"sourceId\",source_revision AS \"sourceRevision\",record FROM sync_replica_records WHERE subscription_id=$1 ORDER BY scope,record->>'eventDate',record->>'lastName',record->>'firstName',record->>'title' LIMIT 2000", [subscriptionId]);
      return { records: records.rows };
    }
    return { records: [] };
  });
}
