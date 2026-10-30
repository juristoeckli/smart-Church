import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { createReadStream } from "node:fs";
import { readFile, stat, statfs } from "node:fs/promises";
import { cpus, freemem, totalmem } from "node:os";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";
import { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { AuthStatus, AuthenticatedUser, Contact, CreateAdminAccount, CreateContact, CreateDepartment, CreateServiceEvent, CreateSiteUser, DepartmentProfile, EventRegistration, HttpAccessMode, LocationPermission, LoginCredentials, PublicRegistrationEvent, ServerPermission, ServiceEvent, ServiceEventCheckIn, ServicePlanTemplate, SiteUser, UpdateDepartmentProfile, UserPhoneNumber, UserRelationshipInput, UserRelationshipKind, VisitorFollowUp, WorshipSong } from "@smart-church/contracts";
import { closeDatabase, departmentId, departmentName, initializeDatabase, installationId, pool } from "./database.js";
import { VideoWorkerSupervisor } from "./modules/video-steffisburg/worker-supervisor.js";
import { getRequiredModuleDependencies, getRequiredServerModuleIds, installSiteWriteFenceTriggers, isServerModuleEnabled, onServerModuleActivationChange, registerServerModules, setServerModuleEnabled } from "./modules/module-sdk.js";
import { registerCoreReplicationAdapter } from "./core-replication.js";
import { RealtimeHub, websocketRequestProtocol } from "./realtime.js";
import { recentRuntimeLogs, recordRuntimeLog, registerRuntimeWorker, restartRuntimeWorker, runtimeWorkerDiagnostics, type RuntimeLogLevel } from "./runtime-diagnostics.js";
import { createEmailConnector } from "./modules/email-worker/service.js";
import { allServerPermissions, hasServerPermission as userHasServerPermission, serverPermissionsForUser } from "./server-permissions.js";

if (process.env.SMART_CHURCH_VIDEO_STEFFISBURG_ENABLED === "0") {
  delete process.env.STREAMING_CONFIG_FILE;
} else if (!process.env.STREAMING_CONFIG_FILE && departmentName.trim().toLowerCase() === "steffisburg") {
  process.env.STREAMING_CONFIG_FILE = resolve(fileURLToPath(new URL("./modules/video-steffisburg/streaming.steffisburg.json", import.meta.url)));
}

const trustedProxyAddresses = process.env.SMART_CHURCH_TRUST_PROXY?.split(",").map((entry) => entry.trim()).filter(Boolean) ?? [];
const directHttpMode = process.env.SMART_CHURCH_DIRECT_HTTP === "1";
const allowHttpFallback = process.env.SMART_CHURCH_ALLOW_HTTP_FALLBACK === "1";
const directHttpPort = Number(process.env.SMART_CHURCH_DIRECT_HTTP_PORT ?? 81);
const caddyHttpPort = Number(process.env.SMART_CHURCH_HTTP_PORT ?? 80);
const directHttpOriginHosts = new Set(process.env.SMART_CHURCH_DIRECT_HTTP_HOSTS?.split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean) ?? []);
const webRoot = resolve(fileURLToPath(new URL("../web-dist/", import.meta.url)));
const webContentTypes = new Map([
  [".css", "text/css; charset=utf-8"], [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"], [".jpeg", "image/jpeg"], [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"], [".json", "application/json; charset=utf-8"],
  [".png", "image/png"], [".svg", "image/svg+xml"], [".webp", "image/webp"],
  [".woff", "font/woff"], [".woff2", "font/woff2"],
]);
const runtimeLogStream = {
  write(line: string) {
    process.stdout.write(line);
    try {
      const entry = JSON.parse(line) as { level?: number; time?: number; msg?: unknown; module?: unknown };
      const levels: Record<number, RuntimeLogLevel> = { 10: "trace", 20: "debug", 30: "info", 40: "warn", 50: "error", 60: "fatal" };
      const source = typeof entry.module === "string" ? `api/${entry.module}` : "api";
      if (typeof entry.msg === "string") recordRuntimeLog(source, levels[entry.level ?? 30] ?? "info", entry.msg, entry.time ?? Date.now());
    } catch { /* Keep normal stdout logs even if a future logger format changes. */ }
  },
};
const app = Fastify({
  logger: {
    redact: ["req.headers.cookie", "req.headers.authorization", "req.body.password", "req.body.setupCode", "req.body.loginToken", "req.body.apiKey"],
    stream: runtimeLogStream,
  },
  bodyLimit: 3 * 1024 * 1024,
  disableRequestLogging: true,
  trustProxy: trustedProxyAddresses.length ? trustedProxyAddresses : false,
});
let databaseReady = false;
let firstRunSetupCode: string | null = null;
let httpAccessMode: HttpAccessMode = "none";
const sessionCookieName = "smart_church_session";
function configuredHttpsOrigin() {
  try {
    const origin = new URL(process.env.SMART_CHURCH_WEB_ORIGIN ?? "");
    return origin.protocol === "https:" ? origin.origin : null;
  } catch {
    return null;
  }
}
function sessionCookieNameFor(request: FastifyRequest) {
  return allowHttpFallback && request.protocol === "http" ? `${sessionCookieName}_http` : sessionCookieName;
}
const sessionLifetimeSeconds = 24 * 60 * 60;
const failedLogins = new Map<string, { count: number; resetAt: number }>();
const maxFailedLoginBuckets = 10_000;
let videoWorker: VideoWorkerSupervisor | null = null;
let removeVideoActivationListener: (() => void) | null = null;

declare module "fastify" {
  interface FastifyRequest {
    authenticatedUser: AuthenticatedUser | null;
    activeDepartmentRole: "site_admin" | "member" | null;
    activeDepartmentPermissions: LocationPermission[] | null;
    activeDepartmentModulePermissions: Record<string, string[]> | null;
  }
}

app.decorateRequest("authenticatedUser", null);
app.decorateRequest("activeDepartmentRole", null);
app.decorateRequest("activeDepartmentPermissions", null);
app.decorateRequest("activeDepartmentModulePermissions", null);

function cookieValue(cookieHeader: string | undefined, name: string) {
  return cookieHeader?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

function validBirthday(value: string | undefined) {
  if (!value) return true;
  const match = /^(\d{2}):(\d{2}):(\d{4})$/.exec(value);
  if (!match) return false;
  const [, dayText, monthText, yearText] = match;
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function birthdayToIso(value: string | undefined) {
  if (!value) return null;
  const [day, month, year] = value.split(":");
  return `${year}-${month}-${day}`;
}

const dummyPasswordHash = hashPassword(randomBytes(32).toString("hex"));

function verifyPassword(password: string, encoded: string) {
  const [algorithm, saltHex, hashHex] = encoded.split("$");
  if (algorithm !== "scrypt" || !saltHex || !hashHex || !/^[\da-f]+$/i.test(saltHex) || !/^[\da-f]+$/i.test(hashHex)) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function setSessionCookie(reply: { header: (name: string, value: string) => unknown }, token: string, secure: boolean, name: string) {
  const secureAttribute = secure ? "; Secure" : "";
  reply.header("Set-Cookie", `${name}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${sessionLifetimeSeconds}${secureAttribute}`);
}

function clearSessionCookie(reply: { header: (name: string, value: string) => unknown }, secure: boolean, name: string) {
  const secureAttribute = secure ? "; Secure" : "";
  reply.header("Set-Cookie", `${name}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0${secureAttribute}`);
}

async function currentUser(token: string | undefined): Promise<AuthenticatedUser | null> {
  if (!pool || !token || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const result = await pool.query(
    `WITH active_session AS (
       UPDATE auth_sessions SET last_seen_at = now()
        WHERE token_hash = $1 AND expires_at > now()
        RETURNING user_id
     )
     SELECT u.id, u.email, u.username, u.display_name, u.role, u.server_permissions, u.must_change_password, u.date_time_format, u.language, u.language_is_custom
       FROM active_session s JOIN app_users u ON u.id = s.user_id`,
    [hashToken(token)],
  );
  const row = result.rows[0];
  return row ? { id: row.id, ...(row.email ? { email: row.email } : {}), username: row.username, displayName: row.display_name, role: row.role, mustChangePassword: row.must_change_password, dateTimeFormat: row.date_time_format, language: row.language, languageIsCustom: row.language_is_custom, serverPermissions: serverPermissionsForUser(row.role, row.server_permissions) } : null;
}

function setupCodeMatches(candidate: string) {
  if (!firstRunSetupCode) return false;
  const expected = Buffer.from(firstRunSetupCode);
  const actual = Buffer.from(candidate);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function isDepartmentWritable(selectedDepartmentId: string) {
  if (!pool || !databaseReady) return false;
  try {
    const table = await pool.query<{ table_name: string | null }>("SELECT to_regclass('public.sync_site_redundancy')::text AS table_name");
    if (!table.rows[0]?.table_name) return true;
    const state = await pool.query<{ role: string }>("SELECT role FROM sync_site_redundancy WHERE department_id=$1", [selectedDepartmentId]);
    return state.rows[0]?.role === "primary";
  } catch (error) {
    app.log.error({ err: error, departmentId: selectedDepartmentId }, "Could not check the site's write-fence state.");
    return false;
  }
}

async function lockDepartmentForWrite(client: PoolClient, selectedDepartmentId: string) {
  const table = await client.query<{ table_name: string | null }>("SELECT to_regclass('public.sync_site_redundancy')::text AS table_name");
  if (!table.rows[0]?.table_name) return true;
  const state = await client.query<{ role: string }>("SELECT role FROM sync_site_redundancy WHERE department_id=$1 FOR SHARE", [selectedDepartmentId]);
  return state.rows[0]?.role === "primary";
}

function isRedundancyTransitionMutation(request: FastifyRequest) {
  if (request.method.toUpperCase() !== "POST") return false;
  const path = request.url.split("?", 1)[0];
  return path === "/api/modules/sync/federation/redundancy/standby"
    || path === "/api/modules/sync/federation/redundancy/promote"
    || path === "/api/modules/sync/federation/redundancy/fence";
}

async function activeDepartmentId(request: FastifyRequest, reply: FastifyReply, requireSiteAdmin = false, allowQueryLocation = false, requiredPermission?: LocationPermission) {
  if (!pool) return null;
  const header = request.headers["x-department-id"];
  const queryLocation = allowQueryLocation && request.query && typeof request.query === "object"
    ? (request.query as { departmentId?: unknown }).departmentId
    : undefined;
  const selectedId = typeof header === "string" ? header : typeof queryLocation === "string" ? queryLocation : departmentId;
  if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(selectedId)) {
    reply.code(400).send({ error: "Choose a valid location." });
    return null;
  }
  if (new Set(["POST", "PUT", "PATCH", "DELETE"]).has(request.method.toUpperCase()) && !isRedundancyTransitionMutation(request) && !await isDepartmentWritable(selectedId)) {
    reply.code(423).send({ error: "This location is read-only while it is a redundancy standby or fenced site." });
    return null;
  }
  const result = await pool.query(
    `SELECT m.role, m.permissions, m.module_permissions
       FROM department_memberships m
       JOIN departments d ON d.id = m.department_id
      WHERE m.department_id = $1 AND m.user_id = $2`,
    [selectedId, request.authenticatedUser?.id],
  );
  if (!result.rowCount) {
    reply.code(403).send({ error: "You do not have access to this location." });
    return null;
  }
  request.activeDepartmentRole = result.rows[0].role;
  request.activeDepartmentPermissions = result.rows[0].permissions ?? [];
  request.activeDepartmentModulePermissions = result.rows[0].module_permissions ?? {};
  if (requireSiteAdmin && request.activeDepartmentRole !== "site_admin") {
    reply.code(403).send({ error: "Site administrator access is required for this action." });
    return null;
  }
  if (requiredPermission && request.activeDepartmentRole !== "site_admin" && !(request.activeDepartmentPermissions ?? []).includes(requiredPermission)) {
    reply.code(403).send({ error: "You do not have permission to manage this area." });
    return null;
  }
  return selectedId;
}

function requireServerAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (request.authenticatedUser?.role === "server_admin") return true;
  reply.code(403).send({ error: "Server administrator access is required." });
  return false;
}

function hasServerPermission(request: FastifyRequest, permission: ServerPermission) {
  return userHasServerPermission(request.authenticatedUser?.role, request.authenticatedUser?.serverPermissions, permission);
}

function requireServerPermission(request: FastifyRequest, reply: FastifyReply, permission: ServerPermission) {
  if (hasServerPermission(request, permission)) return true;
  reply.code(403).send({ error: `Server ${permission.replace("server_", "")} access is required.` });
  return false;
}

async function createSession(userId: string, request: FastifyRequest, reply: { header: (name: string, value: string) => unknown }, secure: boolean) {
  const token = randomBytes(32).toString("base64url");
  const userAgent = typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"].slice(0, 512) : "Unknown browser";
  await pool!.query(
    `INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, user_agent, last_seen_at)
     VALUES ($1, $2, $3, now() + ($4 * interval '1 second'), $5, now())`,
    [randomUUID(), userId, hashToken(token), sessionLifetimeSeconds, userAgent],
  );
  setSessionCookie(reply, token, secure, sessionCookieNameFor(request));
}

function moduleCsrfToken(sessionToken: string) {
  return createHmac("sha256", sessionToken).update("smart-church-module-csrf").digest("base64url");
}

function validModuleMutation(request: FastifyRequest, reply: FastifyReply) {
  const sessionToken = cookieValue(request.headers.cookie, sessionCookieNameFor(request));
  const csrfHeader = request.headers["x-csrf-token"];
  const originHeader = request.headers.origin;
  if (!sessionToken || !csrfHeader || !originHeader || Array.isArray(csrfHeader)) {
    reply.code(403).send({ error: "The module request could not be verified. Refresh the page and try again." });
    return false;
  }
  let origin: URL;
  let requestHost: URL;
  try {
    origin = new URL(originHeader);
    requestHost = new URL(`http://${request.headers.host}`);
  } catch {
    reply.code(403).send({ error: "The module request origin is not valid." });
    return false;
  }
  const localDevPort = Number(origin.port);
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  const normalizeHost = (hostname: string) => hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const originHost = normalizeHost(origin.hostname);
  const apiHost = normalizeHost(requestHost.hostname);
  const sameLocalMachine = originHost === apiHost || (loopbackHosts.has(originHost) && loopbackHosts.has(apiHost));
  const allowedOrigin = isAllowedWebOrigin(request, origin.origin)
    || (process.env.NODE_ENV !== "production" && !process.env.SMART_CHURCH_WEB_ORIGIN &&
      sameLocalMachine && origin.protocol === "http:" &&
      (origin.port === requestHost.port || (localDevPort >= 5173 && localDevPort <= 5199)));
  if (!allowedOrigin || request.headers["sec-fetch-site"] === "cross-site") {
    reply.code(403).send({ error: "The module request origin is not allowed. Open Smart-Church from its configured web address." });
    return false;
  }
  const expected = Buffer.from(moduleCsrfToken(sessionToken));
  const actual = Buffer.from(csrfHeader);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    reply.code(403).send({ error: "The module session token is out of date. Refresh the page and try again." });
    return false;
  }
  return true;
}

function isAllowedWebOrigin(request: FastifyRequest, origin: string) {
  const expectedOrigin = process.env.SMART_CHURCH_WEB_ORIGIN;
  if (!expectedOrigin) return false;
  if (process.env.NODE_ENV !== "production" && origin === expectedOrigin) return true;
  if (directHttpMode || request.protocol === "https") return origin === expectedOrigin;
  if (!allowHttpFallback || request.protocol !== "http") return false;
  try {
    const httpsOrigin = new URL(expectedOrigin);
    const requestOrigin = new URL(origin);
    const allowedHttpPorts = new Set([String(caddyHttpPort), String(directHttpPort)]);
    if (requestOrigin.protocol !== "http:") return false;
    const isConfiguredHostname = requestOrigin.hostname === httpsOrigin.hostname &&
      ((requestOrigin.port === "" && caddyHttpPort === 80) || allowedHttpPorts.has(requestOrigin.port));
    const isDirectHttpAlias = directHttpOriginHosts.has(requestOrigin.hostname) && requestOrigin.port === String(directHttpPort);
    return isConfiguredHostname || isDirectHttpAlias;
  } catch {
    return false;
  }
}

const realtime = new RealtimeHub(
  app.server,
  async (request) => {
    const protocol = websocketRequestProtocol(request);
    const cookieName = allowHttpFallback && protocol === "http" ? `${sessionCookieName}_http` : sessionCookieName;
    const user = await currentUser(cookieValue(request.headers.cookie, cookieName));
    return user && !user.mustChangePassword ? { id: user.id, role: user.role } : null;
  },
  async (identity, selectedDepartmentId) => {
    if (!pool || !databaseReady) return false;
    const result = await pool.query("SELECT 1 FROM department_memberships WHERE department_id = $1 AND user_id = $2", [selectedDepartmentId, identity.id]);
    return (result.rowCount ?? 0) > 0;
  },
  (request, origin) => Boolean(origin && isAllowedWebOrigin({ protocol: websocketRequestProtocol(request) } as FastifyRequest, origin)),
);

app.addHook("onRequest", async (request, reply) => {
  const federationRequest = request.url.startsWith("/api/modules/sync/federation/v1/");
  const httpFallbackRequest = allowHttpFallback && request.protocol === "http";
  if (process.env.NODE_ENV === "production" && federationRequest && request.protocol !== "https") {
    return reply.code(400).send({ error: "Federation requests require HTTPS." });
  }
  if (process.env.NODE_ENV === "production" && !directHttpMode && !httpFallbackRequest && request.url !== "/api/health" && request.url !== "/api/public/http-access" && request.protocol !== "https") {
    return reply.code(400).send({ error: "Use HTTPS to access Smart-Church." });
  }
  // Federation requests authenticate with the Sync module's Ed25519 protocol,
  // not browser Origin headers. Module management routes still require the
  // normal session and CSRF checks in their own handlers.
  if (federationRequest) return;
  if (request.url === "/api/webhooks/resend") return;
  const method = request.method.toUpperCase();
  if (!new Set(["POST", "PUT", "PATCH", "DELETE"]).has(method)) return;
  if (process.env.NODE_ENV === "production") {
    const expectedOrigin = process.env.SMART_CHURCH_WEB_ORIGIN;
    const requestOrigin = request.headers.origin;
    if (!expectedOrigin || !requestOrigin || !isAllowedWebOrigin(request, requestOrigin)) {
      return reply.code(403).send({ error: "This request origin is not allowed." });
    }
  }
});

app.addHook("onSend", async (request, reply, payload) => {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("X-Frame-Options", "DENY");
  reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
  reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (process.env.NODE_ENV === "production" && !directHttpMode && !allowHttpFallback && request.protocol === "https") reply.header("Strict-Transport-Security", "max-age=31536000");
  return payload;
});

app.addHook("preHandler", async (request, reply) => {
  // The API container also serves the built web app for direct HTTP access
  // on port 81. Keep static page and asset requests public so the login UI can
  // load; protect application data and actions under /api/ below.
  if (request.url !== "/api" && !request.url.startsWith("/api/")) return;
  // The signed federation endpoints verify peer identity, request freshness,
  // and replay protection in the Sync module.
  if (request.url.startsWith("/api/modules/sync/federation/v1/")) return;
  if (new Set(["POST", "PUT", "PATCH", "DELETE"]).has(request.method.toUpperCase()) && pool && databaseReady) {
    const path = new URL(request.url, "http://localhost").pathname;
    const localServerSettings = path.startsWith("/api/installation/") || path.startsWith("/api/settings/") || path.startsWith("/api/auth/");
    const replicatedAccountWrite = path === "/api/auth/change-password" || path === "/api/auth/preferences";
    const redundancyControl = path.startsWith("/api/modules/sync/federation/redundancy/");
    const externalWebhook = path === "/api/webhooks/resend";
    if ((!localServerSettings || replicatedAccountWrite) && !redundancyControl && !externalWebhook && !path.startsWith("/api/modules/sync/federation/")) {
      const requestedDepartment = request.headers["x-department-id"];
      const queryDepartment = new URL(request.url, "http://localhost").searchParams.get("departmentId");
      const writeDepartment = typeof requestedDepartment === "string" && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(requestedDepartment)
        ? requestedDepartment
        : queryDepartment && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(queryDepartment) ? queryDepartment : departmentId;
      if (!await isDepartmentWritable(writeDepartment)) return reply.code(423).send({ error: "This location is a read-only redundancy standby or its write-fence state could not be verified." });
    }
  }
  if (request.url === "/api/health" || request.url === "/api/webhooks/resend" || request.url.startsWith("/api/auth/") || request.url === "/api/public/http-access" || request.url.startsWith("/api/public/eventdesk/") || request.url.startsWith("/api/public/event-registrations/") || request.url.startsWith("/api/public/group-signups/") || request.url.startsWith("/api/public/self-signup/")) return;
  if (request.url.startsWith("/api/modules/presenter/public/")) return;
  if (!databaseReady) return;
  const user = await currentUser(cookieValue(request.headers.cookie, sessionCookieNameFor(request)));
  if (!user) return reply.code(401).send({ error: "Sign in to continue." });
  request.authenticatedUser = user;
  reply.header("Cache-Control", "no-store");
  if (user.mustChangePassword) return reply.code(403).send({ error: "Change your password before continuing." });
});

function realtimeTopicForPath(pathname: string) {
  if (pathname.startsWith("/api/files")) return "module:file-storage:changed";
  if (pathname.startsWith("/api/modules/")) {
    const moduleId = pathname.split("/")[3];
    if (moduleId === "chat") {
      if (pathname.includes("/presence")) return "module:chat:presence";
      if (pathname.includes("/typing")) return "module:chat:typing";
      return "module:chat:changed";
    }
    return moduleId ? `module:${moduleId}:changed` : "core:data:changed";
  }
  if (pathname.startsWith("/api/presenter/")) return "module:presenter:changed";
  if (pathname.startsWith("/api/video/")) return "module:video-steffisburg:changed";
  if (pathname.startsWith("/api/contacts")) return "core:contacts:changed";
  if (pathname.startsWith("/api/groups")) return "core:groups:changed";
  if (pathname.startsWith("/api/services")) return "core:services:changed";
  if (pathname.startsWith("/api/resources")) return "core:resources:changed";
  return "core:data:changed";
}

app.addHook("onResponse", async (request, reply) => {
  if (!request.authenticatedUser || reply.statusCode >= 400 || !new Set(["POST", "PUT", "PATCH", "DELETE"]).has(request.method.toUpperCase())) return;
  let pathname: string;
  try { pathname = new URL(request.url, "http://localhost").pathname; }
  catch { return; }
  if (pathname.startsWith("/api/auth/") || pathname === "/api/health") return;
  const departmentHeader = request.headers["x-department-id"];
  const selectedDepartmentId = typeof departmentHeader === "string" ? departmentHeader : departmentId;
  realtime.publish(realtimeTopicForPath(pathname), selectedDepartmentId, { path: pathname, method: request.method.toUpperCase() });
});

app.addHook("onClose", async () => { realtime.close(); });

type ServiceEventRow = {
  id: string;
  title: string;
  kind: ServiceEvent["kind"];
  event_date: string;
  is_all_day: boolean;
  start_time: string;
  end_time: string | null;
  location: string;
  description: string | null;
  room: string;
  asset_ids: string[];
  positions: CreateServiceEvent["positions"];
  time_plan: CreateServiceEvent["timePlan"];
  attendance_adults?: number;
  attendance_children?: number;
  attendance_recorded_at?: string | null;
  registration_enabled?: boolean;
  registration_capacity?: number | null;
  registration_token?: string | null;
  registration_count?: number;
  recurrence_id?: string | null;
  source_system?: string | null;
};

const serviceEventProperties = {
  title: { type: "string", minLength: 1, maxLength: 160 },
  kind: { type: "string", enum: ["service", "meeting", "community", "other"] },
  eventDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
  isAllDay: { type: "boolean" },
  startTime: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
  endTime: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
  location: { type: "string", minLength: 1, maxLength: 160 },
  description: { type: "string", maxLength: 2000 },
  room: { type: "string", maxLength: 160 },
  assetIds: { type: "array", maxItems: 50, uniqueItems: true, items: { type: "string", format: "uuid" } },
  positions: { type: "array", maxItems: 40, items: { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string", minLength: 1, maxLength: 80 }, contactId: { type: "string", format: "uuid" } } } },
  timePlan: { type: "array", maxItems: 100, items: { type: "object", additionalProperties: false, required: ["title"], properties: { title: { type: "string", minLength: 1, maxLength: 160 }, startTime: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" }, durationMinutes: { type: "integer", minimum: 1, maximum: 1440 }, notes: { type: "string", maxLength: 500 }, songId: { type: "string", format: "uuid" }, arrangementId: { type: "string", format: "uuid" }, position: { type: "string", maxLength: 80 } } } },
  registrationEnabled: { type: "boolean" },
  registrationCapacity: { type: ["integer", "null"], minimum: 1, maximum: 100000 },
  recurrence: { type: "object", additionalProperties: false, required: ["interval", "endDate"], properties: { interval: { type: "string", enum: ["weekly", "biweekly", "monthly"] }, endDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } } },
};

const songArrangementSchema = { type: "object", additionalProperties: false, required: ["name"], properties: { id: { type: "string", format: "uuid" }, name: { type: "string", minLength: 1, maxLength: 160 }, key: { type: "string", maxLength: 16 }, chartUrl: { type: "string", maxLength: 2048 }, audioUrl: { type: "string", maxLength: 2048 }, active: { type: "boolean" } } };
const worshipSongBodySchema = { type: "object", additionalProperties: false, required: ["title"], properties: { title: { type: "string", minLength: 1, maxLength: 200 }, authors: { type: "string", maxLength: 500 }, defaultKey: { type: "string", maxLength: 16 }, notes: { type: "string", maxLength: 2000 }, active: { type: "boolean" }, arrangements: { type: "array", maxItems: 40, items: songArrangementSchema } } };
const servicePlanTemplateBodySchema = { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string", minLength: 1, maxLength: 160 }, description: { type: "string", maxLength: 1000 }, active: { type: "boolean" }, positions: { type: "array", maxItems: 40, items: { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string", minLength: 1, maxLength: 80 } } } }, items: { type: "array", maxItems: 100, items: serviceEventProperties.timePlan.items } } };
const serviceEventBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "kind", "eventDate", "startTime", "location"],
  properties: serviceEventProperties,
};

type WorshipSongInput = { title: string; authors?: string; defaultKey?: string; notes?: string; arrangements?: Array<{ id?: string; name: string; key?: string; chartUrl?: string; audioUrl?: string }> };
type ServicePlanTemplateInput = { name: string; description?: string; positions?: Array<{ name: string }>; items?: NonNullable<CreateServiceEvent["timePlan"]> };

function validHttpsLink(value: string | undefined) {
  if (!value?.trim()) return true;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && !url.username && !url.password;
  } catch { return false; }
}

function validateWorshipSongInput(input: WorshipSongInput) {
  if (!input.title.trim()) return "Enter a song title.";
  if ((input.arrangements ?? []).some((arrangement) => !arrangement.name.trim())) return "Enter a name for each arrangement.";
  const arrangementIds = (input.arrangements ?? []).flatMap((arrangement) => arrangement.id ? [arrangement.id] : []);
  if (new Set(arrangementIds).size !== arrangementIds.length) return "Each arrangement can only appear once.";
  if (!(input.arrangements ?? []).every((arrangement) => validHttpsLink(arrangement.chartUrl) && validHttpsLink(arrangement.audioUrl))) {
    return "Chart and audio links must use HTTPS.";
  }
  return null;
}

function validateServicePlanTemplateInput(input: ServicePlanTemplateInput) {
  if (!input.name.trim()) return "Enter a service-plan template name.";
  if ((input.positions ?? []).some((position) => !position.name.trim())) return "Enter a name for each volunteer position.";
  if ((input.items ?? []).some((item) => !item.title.trim())) return "Enter a title for each service-plan item.";
  const positions = new Set((input.positions ?? []).map((position) => position.name.trim().toLocaleLowerCase()));
  if ((input.items ?? []).some((item) => item.position && !positions.has(item.position.trim().toLocaleLowerCase()))) return "Each plan item must use a position listed for this service.";
  return null;
}

function mapServiceEvent(row: ServiceEventRow): ServiceEvent {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    eventDate: row.event_date,
    isAllDay: row.is_all_day ?? false,
    startTime: row.start_time.slice(0, 5),
    ...(row.end_time ? { endTime: row.end_time.slice(0, 5) } : {}),
    location: row.location,
    ...(row.description ? { description: row.description } : {}),
    room: row.room ?? "",
    assetIds: row.asset_ids ?? [],
    positions: row.positions ?? [],
    timePlan: row.time_plan ?? [],
    attendanceAdults: row.attendance_adults ?? 0,
    attendanceChildren: row.attendance_children ?? 0,
    registrationEnabled: row.registration_enabled ?? false,
    ...(row.registration_capacity ? { registrationCapacity: row.registration_capacity } : {}),
    ...(row.registration_enabled && row.registration_token ? { registrationToken: row.registration_token } : {}),
    registrationCount: row.registration_count ?? 0,
    ...(row.attendance_recorded_at ? { attendanceRecordedAt: row.attendance_recorded_at } : {}),
    ...(row.recurrence_id ? { seriesId: row.recurrence_id } : {}),
    ...(row.source_system === "churchtools" ? { importedFrom: "churchtools" as const } : row.source_system === "elvanto" ? { importedFrom: "elvanto" as const } : {}),
  };
}

function validateServiceEvent(event: CreateServiceEvent) {
  const [year, month, day] = event.eventDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return "Choose a valid event date.";
  }
  if (!event.isAllDay && event.endTime && event.endTime <= event.startTime) return "The end time must be later than the start time.";
  if (!event.title.trim()) return "Enter an event title.";
  if (!event.location.trim()) return "Enter a location.";
  if (event.registrationCapacity !== undefined && event.registrationCapacity !== null && (!Number.isInteger(event.registrationCapacity) || event.registrationCapacity < 1 || event.registrationCapacity > 100000)) return "Registration capacity must be a positive whole number.";
  if ((event.positions ?? []).some((position) => !position.name.trim())) return "Each service position needs a name.";
  if ((event.timePlan ?? []).some((item) => !item.title.trim())) return "Each time plan item needs a title.";
  if (event.recurrence) {
    const [endYear, endMonth, endDay] = event.recurrence.endDate.split("-").map(Number);
    const end = new Date(Date.UTC(endYear, endMonth - 1, endDay));
    const start = new Date(`${event.eventDate}T00:00:00Z`);
    if (!Number.isFinite(end.getTime()) || end.toISOString().slice(0, 10) !== event.recurrence.endDate || end <= start) return "Choose a valid recurrence end date after the first gathering.";
    if (end.getTime() - start.getTime() > 366 * 86400000) return "Recurring gatherings can be scheduled for up to one year at a time.";
  }
  return null;
}

function recurrenceDates(startDate: string, endDate: string, interval: "weekly" | "biweekly" | "monthly") {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const dates = [startDate];
  while (dates.length < 54) {
    const previous = new Date(`${dates[dates.length - 1]}T00:00:00Z`);
    if (interval === "weekly" || interval === "biweekly") previous.setUTCDate(previous.getUTCDate() + (interval === "weekly" ? 7 : 14));
    else {
      const originalDay = start.getUTCDate();
      const year = previous.getUTCFullYear();
      const month = previous.getUTCMonth() + 1;
      const targetLastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      previous.setUTCDate(1);
      previous.setUTCMonth(month);
      previous.setUTCDate(Math.min(originalDay, targetLastDay));
    }
    if (previous > end) break;
    dates.push(previous.toISOString().slice(0, 10));
  }
  return dates;
}

async function validateServicePlanSongs(departmentId: string, items: NonNullable<CreateServiceEvent["timePlan"]>) {
  if (items.some((item) => item.arrangementId && !item.songId)) return "Choose a song for each selected arrangement.";
  const songIds = [...new Set(items.flatMap((item) => item.songId ? [item.songId] : []))];
  if (songIds.length) {
    const songs = await pool!.query("SELECT id FROM worship_songs WHERE department_id=$1 AND id=ANY($2::uuid[])", [departmentId, songIds]);
    if (songs.rowCount !== songIds.length) return "One or more selected songs do not belong to this site.";
  }
  const arrangementRows = items.flatMap((item) => item.songId && item.arrangementId ? [{ songId: item.songId, arrangementId: item.arrangementId }] : []);
  if (arrangementRows.length) {
    const arrangements = await pool!.query(
      `SELECT selected."arrangementId"
         FROM jsonb_to_recordset($2::jsonb) AS selected("songId" uuid,"arrangementId" uuid)
         JOIN worship_songs song ON song.id=selected."songId" AND song.department_id=$1
         JOIN worship_song_arrangements arrangement ON arrangement.id=selected."arrangementId" AND arrangement.song_id=song.id`,
      [departmentId, JSON.stringify(arrangementRows)],
    );
    if (arrangements.rowCount !== arrangementRows.length) return "One or more selected arrangements do not belong to the selected song.";
  }
  return null;
}

async function validateServiceAssignments(departmentId: string, event: CreateServiceEvent) {
  const positionNames = new Set((event.positions ?? []).map((position) => position.name.trim().toLocaleLowerCase()));
  if ((event.timePlan ?? []).some((item) => item.position && !positionNames.has(item.position.trim().toLocaleLowerCase()))) return "Each plan item must use a position listed for this service.";
  const assets = [...new Set(event.assetIds ?? [])];
  if (assets.length) {
    const available = await pool!.query("SELECT id FROM bookable_resources WHERE department_id=$1 AND active=true AND id=ANY($2::uuid[])", [departmentId, assets]);
    if (available.rowCount !== assets.length) return "One or more selected resources are unavailable for this site.";
  }
  const contacts = [...new Set((event.positions ?? []).flatMap((position) => position.contactId ? [position.contactId] : []))];
  if (contacts.length) {
    const people = await pool!.query("SELECT id FROM contacts WHERE department_id=$1 AND id=ANY($2::uuid[])", [departmentId, contacts]);
    if (people.rowCount !== contacts.length) return "One or more assigned people do not belong to this site.";
  }
  return validateServicePlanSongs(departmentId, event.timePlan ?? []);
}

async function syncEventPositionResponses(
  client: PoolClient,
  eventId: string,
  positions: CreateServiceEvent["positions"],
  previousPositions: CreateServiceEvent["positions"] = [],
) {
  const currentPositions = positions ?? [];
  const oldPositions = previousPositions ?? [];
  const existing = await client.query<{ position_index: number; contact_id: string; status: "pending" | "accepted" | "declined"; responded_at: Date | null; updated_at: Date }>(
    "SELECT position_index,contact_id,status,responded_at,updated_at FROM event_position_responses WHERE event_id=$1 ORDER BY position_index",
    [eventId],
  );
  const retained = new Map<number, typeof existing.rows[number]>();
  const usedPositions = new Set<number>();
  for (const response of existing.rows) {
    const previous = oldPositions[response.position_index];
    if (!previous?.contactId || previous.contactId !== response.contact_id) continue;
    const oldName = previous.name.trim().toLocaleLowerCase();
    const nextIndex = currentPositions.findIndex((position, index) =>
      !usedPositions.has(index)
      && position.contactId === response.contact_id
      && position.name.trim().toLocaleLowerCase() === oldName,
    );
    if (nextIndex < 0) continue;
    retained.set(nextIndex, response);
    usedPositions.add(nextIndex);
  }

  await client.query("DELETE FROM event_position_responses WHERE event_id=$1", [eventId]);
  for (let index = 0; index < currentPositions.length; index += 1) {
    const contactId = currentPositions[index].contactId;
    if (!contactId) continue;
    const previousResponse = retained.get(index);
    await client.query(
      `INSERT INTO event_position_responses (event_id,position_index,contact_id,status,responded_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [eventId, index, contactId, previousResponse?.status ?? "pending", previousResponse?.responded_at ?? null, previousResponse?.updated_at ?? new Date()],
    );
  }
}

async function listWorshipSongs(departmentId: string, includeArchived = false): Promise<WorshipSong[]> {
  const result = await pool!.query<{ id: string; title: string; authors: string; default_key: string; notes: string; active: boolean; arrangements: WorshipSong["arrangements"] }>(
    `SELECT song.id,song.title,song.authors,song.default_key,song.notes,song.active,
            COALESCE(json_agg(json_build_object('id',arrangement.id,'name',arrangement.name,'key',arrangement.musical_key,'chartUrl',arrangement.chart_url,'audioUrl',arrangement.audio_url,'active',arrangement.active) ORDER BY lower(arrangement.name)) FILTER (WHERE arrangement.id IS NOT NULL),'[]'::json) AS arrangements
       FROM worship_songs song
       LEFT JOIN worship_song_arrangements arrangement ON arrangement.song_id=song.id
      WHERE song.department_id=$1 AND ($2::boolean OR song.active=true)
      GROUP BY song.id
      ORDER BY lower(song.title),song.id`,
    [departmentId, includeArchived],
  );
  return result.rows.map((row) => ({ id: row.id, title: row.title, ...(row.authors ? { authors: row.authors } : {}), ...(row.default_key ? { defaultKey: row.default_key } : {}), ...(row.notes ? { notes: row.notes } : {}), arrangements: row.arrangements.filter((arrangement) => includeArchived || arrangement.active), active: row.active }));
}

async function persistWorshipSong(departmentId: string, id: string, input: WorshipSongInput) {
  const clean = {
    title: input.title.trim(), authors: input.authors?.trim() ?? "", defaultKey: input.defaultKey?.trim() ?? "", notes: input.notes?.trim() ?? "",
    arrangements: input.arrangements ?? [],
  };
  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    if (id) {
      const updated = await client.query("UPDATE worship_songs SET title=$3,authors=$4,default_key=$5,notes=$6,active=true,updated_at=now() WHERE id=$1 AND department_id=$2 RETURNING id", [id, departmentId, clean.title, clean.authors, clean.defaultKey, clean.notes]);
      if (!updated.rowCount) { await client.query("ROLLBACK"); return false; }
    } else {
      const created = await client.query<{ id: string }>("INSERT INTO worship_songs (id,department_id,title,authors,default_key,notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id", [randomUUID(), departmentId, clean.title, clean.authors, clean.defaultKey, clean.notes]);
      id = created.rows[0].id;
    }
    const retainedIds: string[] = [];
    for (const arrangement of clean.arrangements) {
      const name = arrangement.name.trim();
      if (arrangement.id) {
        const updated = await client.query("UPDATE worship_song_arrangements SET name=$3,musical_key=$4,chart_url=$5,audio_url=$6,active=true,updated_at=now() WHERE id=$1 AND song_id=$2 RETURNING id", [arrangement.id, id, name, arrangement.key?.trim() ?? "", arrangement.chartUrl?.trim() ?? "", arrangement.audioUrl?.trim() ?? ""]);
        if (!updated.rowCount) throw new Error("An arrangement does not belong to this song.");
        retainedIds.push(arrangement.id);
      } else {
        const created = await client.query<{ id: string }>("INSERT INTO worship_song_arrangements (id,song_id,name,musical_key,chart_url,audio_url) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id", [randomUUID(), id, name, arrangement.key?.trim() ?? "", arrangement.chartUrl?.trim() ?? "", arrangement.audioUrl?.trim() ?? ""]);
        retainedIds.push(created.rows[0].id);
      }
    }
    await client.query("UPDATE worship_song_arrangements SET active=false,updated_at=now() WHERE song_id=$1 AND NOT (id=ANY($2::uuid[])) AND active=true", [id, retainedIds]);
    await client.query("COMMIT");
    return id;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function listServicePlanTemplates(departmentId: string): Promise<ServicePlanTemplate[]> {
  const result = await pool!.query<{ id: string; name: string; description: string; positions: ServicePlanTemplate["positions"]; items: ServicePlanTemplate["items"]; active: boolean }>(
    "SELECT id,name,description,positions,items,active FROM service_plan_templates WHERE department_id=$1 AND active=true ORDER BY lower(name),id", [departmentId],
  );
  return result.rows.map((row) => ({ ...row, ...(row.description ? {} : { description: undefined }) }));
}

async function persistServicePlanTemplate(departmentId: string, id: string, input: ServicePlanTemplateInput) {
  const inputError = validateServicePlanTemplateInput(input);
  if (inputError) return { error: inputError };
  const validationError = await validateServicePlanSongs(departmentId, input.items ?? []);
  if (validationError) return { error: validationError };
  if (id) {
    const result = await pool!.query(
      "UPDATE service_plan_templates SET name=$3,description=$4,positions=$5::jsonb,items=$6::jsonb,active=true,updated_at=now() WHERE id=$1 AND department_id=$2 RETURNING id",
      [id, departmentId, input.name.trim(), input.description?.trim() ?? "", JSON.stringify(input.positions ?? []), JSON.stringify(input.items ?? [])],
    );
    return result.rowCount ? { id } : null;
  }
  id = randomUUID();
  await pool!.query(
    "INSERT INTO service_plan_templates (id,department_id,name,description,positions,items) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)",
    [id, departmentId, input.name.trim(), input.description?.trim() ?? "", JSON.stringify(input.positions ?? []), JSON.stringify(input.items ?? [])],
  );
  return { id };
}

app.get("/api/worship/songs", async (request, reply): Promise<WorshipSong[] | { error: string }> => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "The worship library is unavailable." });
  const selectedDepartmentId = await activeDepartmentId(request, reply);
  if (!selectedDepartmentId) return reply;
  return listWorshipSongs(selectedDepartmentId);
});

app.post<{ Body: WorshipSongInput }>("/api/worship/songs", { schema: { body: worshipSongBodySchema } }, async (request, reply): Promise<WorshipSong | { error: string }> => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "The worship library is unavailable." });
  const selectedDepartmentId = await activeDepartmentId(request, reply, false, false, "events_manage");
  if (!selectedDepartmentId) return reply;
  const invalid = validateWorshipSongInput(request.body);
  if (invalid) return reply.code(400).send({ error: invalid });
  try {
    const id = await persistWorshipSong(selectedDepartmentId, "", request.body);
    const song = (await listWorshipSongs(selectedDepartmentId, true)).find((item) => item.id === id);
    return reply.code(201).send(song!);
  } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Could not save this song." }); }
});

app.put<{ Params: { id: string }; Body: WorshipSongInput }>("/api/worship/songs/:id", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } }, body: worshipSongBodySchema } }, async (request, reply): Promise<WorshipSong | { error: string }> => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "The worship library is unavailable." });
  const selectedDepartmentId = await activeDepartmentId(request, reply, false, false, "events_manage");
  if (!selectedDepartmentId) return reply;
  const invalid = validateWorshipSongInput(request.body);
  if (invalid) return reply.code(400).send({ error: invalid });
  try {
    const savedId = await persistWorshipSong(selectedDepartmentId, request.params.id, request.body);
    if (!savedId) return reply.code(404).send({ error: "Song not found." });
    return (await listWorshipSongs(selectedDepartmentId, true)).find((item) => item.id === savedId)!;
  } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Could not save this song." }); }
});

app.delete<{ Params: { id: string } }>("/api/worship/songs/:id", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } }, async (request, reply): Promise<{ archived: true } | { error: string }> => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "The worship library is unavailable." });
  const selectedDepartmentId = await activeDepartmentId(request, reply, false, false, "events_manage");
  if (!selectedDepartmentId) return reply;
  const result = await pool.query("UPDATE worship_songs SET active=false,updated_at=now() WHERE id=$1 AND department_id=$2 RETURNING id", [request.params.id, selectedDepartmentId]);
  if (!result.rowCount) return reply.code(404).send({ error: "Song not found." });
  return { archived: true };
});

app.get("/api/service-plan-templates", async (request, reply): Promise<ServicePlanTemplate[] | { error: string }> => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "Service-plan templates are unavailable." });
  const selectedDepartmentId = await activeDepartmentId(request, reply);
  if (!selectedDepartmentId) return reply;
  return listServicePlanTemplates(selectedDepartmentId);
});

app.post<{ Body: ServicePlanTemplateInput }>("/api/service-plan-templates", { schema: { body: servicePlanTemplateBodySchema } }, async (request, reply): Promise<ServicePlanTemplate | { error: string }> => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "Service-plan templates are unavailable." });
  const selectedDepartmentId = await activeDepartmentId(request, reply, false, false, "events_manage");
  if (!selectedDepartmentId) return reply;
  const saved = await persistServicePlanTemplate(selectedDepartmentId, "", request.body);
  if (!saved) return reply.code(400).send({ error: "Could not save this service plan." });
  if ("error" in saved) return reply.code(400).send(saved);
  const result = (await listServicePlanTemplates(selectedDepartmentId)).find((item) => item.id === saved.id);
  return reply.code(201).send(result!);
});

app.put<{ Params: { id: string }; Body: ServicePlanTemplateInput }>("/api/service-plan-templates/:id", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } }, body: servicePlanTemplateBodySchema } }, async (request, reply): Promise<ServicePlanTemplate | { error: string }> => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "Service-plan templates are unavailable." });
  const selectedDepartmentId = await activeDepartmentId(request, reply, false, false, "events_manage");
  if (!selectedDepartmentId) return reply;
  const saved = await persistServicePlanTemplate(selectedDepartmentId, request.params.id, request.body);
  if (!saved) return reply.code(404).send({ error: "Service-plan template not found." });
  if ("error" in saved) return reply.code(400).send(saved);
  const result = (await listServicePlanTemplates(selectedDepartmentId)).find((item) => item.id === saved.id);
  return result ?? reply.code(404).send({ error: "Service-plan template not found." });
});

app.delete<{ Params: { id: string } }>("/api/service-plan-templates/:id", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } }, async (request, reply): Promise<{ archived: true } | { error: string }> => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "Service-plan templates are unavailable." });
  const selectedDepartmentId = await activeDepartmentId(request, reply, false, false, "events_manage");
  if (!selectedDepartmentId) return reply;
  const result = await pool.query("UPDATE service_plan_templates SET active=false,updated_at=now() WHERE id=$1 AND department_id=$2 RETURNING id", [request.params.id, selectedDepartmentId]);
  if (!result.rowCount) return reply.code(404).send({ error: "Service-plan template not found." });
  return { archived: true };
});

app.get("/api/health", async () => ({
  status: databaseReady ? "ok" : "database_unavailable",
  services: { api: "ok", database: databaseReady ? "ok" : "unavailable" },
}));

app.get("/api/public/http-access", async (_request, reply) => {
  reply.header("Cache-Control", "no-store");
  return { mode: httpAccessMode, httpsOrigin: configuredHttpsOrigin() };
});

async function readContainerMemory() {
  try {
    const [usage, limit] = await Promise.all([
      readFile("/sys/fs/cgroup/memory.current", "utf8"),
      readFile("/sys/fs/cgroup/memory.max", "utf8"),
    ]);
    return { usageBytes: Number(usage.trim()), limitBytes: limit.trim() === "max" ? null : Number(limit.trim()) };
  } catch {
    try {
      const [usage, limit] = await Promise.all([
        readFile("/sys/fs/cgroup/memory/memory.usage_in_bytes", "utf8"),
        readFile("/sys/fs/cgroup/memory/memory.limit_in_bytes", "utf8"),
      ]);
      return { usageBytes: Number(usage.trim()), limitBytes: Number(limit.trim()) };
    } catch { return null; }
  }
}

async function readApplicationDisk() {
  const dataPath = process.env.SMART_CHURCH_DATA_DIR || "/var/lib/smart-church";
  for (const path of [dataPath, process.cwd()]) {
    try {
      const filesystem = await statfs(path);
      const blockSize = Number(filesystem.bsize);
      const totalBytes = Number(filesystem.blocks) * blockSize;
      const availableBytes = Number(filesystem.bavail) * blockSize;
      return { path, totalBytes, usedBytes: Math.max(0, totalBytes - Number(filesystem.bfree) * blockSize), availableBytes };
    } catch { /* Try the application directory when the persistent data volume is not mounted. */ }
  }
  return null;
}

let previousSystemCpuSample: { idle: number; total: number } | null = null;
function readSystemCpuPercent() {
  const current = cpus().reduce((totals, cpu) => {
    const times = cpu.times;
    totals.idle += times.idle;
    totals.total += times.user + times.nice + times.sys + times.idle + times.irq;
    return totals;
  }, { idle: 0, total: 0 });
  const previous = previousSystemCpuSample;
  previousSystemCpuSample = current;
  if (!previous) return null;
  const elapsedTotal = current.total - previous.total;
  if (elapsedTotal <= 0) return null;
  const idleDelta = current.idle - previous.idle;
  return Math.max(0, Math.min(100, Math.round((elapsedTotal - idleDelta) / elapsedTotal * 100)));
}

app.get("/api/admin/diagnostics", async (request, reply) => {
  const canView = hasServerPermission(request, "server_view");
  const canTroubleshoot = hasServerPermission(request, "server_troubleshoot");
  if (!canView && !canTroubleshoot) {
    return reply.code(403).send({ error: "Server diagnostics permission required." });
  }
  const memory = process.memoryUsage();
  const containerMemory = await readContainerMemory();
  const applicationDisk = await readApplicationDisk();
  const systemMemoryTotalBytes = totalmem();
  const systemMemoryAvailableBytes = freemem();
  return {
    capturedAt: new Date().toISOString(),
    runtime: {
      uptimeSeconds: Math.floor(process.uptime()),
      memory: { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed, heapTotalBytes: memory.heapTotal, externalBytes: memory.external },
      containerMemory,
      systemMemory: { totalBytes: systemMemoryTotalBytes, availableBytes: systemMemoryAvailableBytes, usedBytes: Math.max(0, systemMemoryTotalBytes - systemMemoryAvailableBytes) },
      cpuPercent: readSystemCpuPercent(),
      applicationDisk,
    },
    workers: runtimeWorkerDiagnostics(),
    logs: recentRuntimeLogs(),
  };
});

app.post<{ Params: { id: string } }>("/api/admin/workers/:id/restart", { schema: {
  params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", minLength: 1, maxLength: 120 } } },
} }, async (request, reply) => {
  if (!requireServerPermission(request, reply, "server_troubleshoot")) return reply;
  if (!validModuleMutation(request, reply)) return reply;
  try {
    if (!await restartRuntimeWorker(request.params.id)) return reply.code(404).send({ error: "This worker does not support restart controls." });
    return reply.code(202).send({ accepted: true });
  } catch (error) {
    return reply.code(409).send({ error: error instanceof Error ? error.message : "The worker could not be restarted." });
  }
});

app.get("/api/auth/status", async (request, reply): Promise<AuthStatus | { error: string }> => {
  reply.header("Cache-Control", "no-store");
  if (!databaseReady || !pool) return reply.code(503).send({ error: "The account database is unavailable." });
  const user = await currentUser(cookieValue(request.headers.cookie, sessionCookieNameFor(request)));
  const count = await pool.query("SELECT count(*)::int AS total FROM app_users");
  const signup = await pool.query<{ enabled: boolean }>("SELECT settings.enabled FROM installation_self_signup_settings settings JOIN installations installation ON installation.id=settings.installation_id WHERE installation.is_current=true");
  return {
    setupRequired: count.rows[0].total === 0,
    authenticated: user !== null,
    selfSignupEnabled: signup.rows[0]?.enabled ?? false,
    httpAccessMode,
    httpsOrigin: configuredHttpsOrigin(),
    ...(count.rows[0].total === 0 ? { setupLocation: departmentName } : {}),
    ...(user ? { csrfToken: moduleCsrfToken(cookieValue(request.headers.cookie, sessionCookieNameFor(request))!) } : {}),
    ...(user ? { user } : {}),
  };
});

app.put<{ Body: { mode: HttpAccessMode } }>("/api/admin/web-settings/http-access", {
  schema: {
    body: {
      type: "object", additionalProperties: false, required: ["mode"],
      properties: { mode: { type: "string", enum: ["none", "warning", "redirect"] } },
    },
  },
}, async (request, reply) => {
  if (!databaseReady || !pool || !installationId) return reply.code(503).send({ error: "The account database is unavailable." });
  if (!requireServerPermission(request, reply, "server_manage") || !validModuleMutation(request, reply)) return reply;
  const httpsOrigin = configuredHttpsOrigin();
  if (request.body.mode === "redirect" && !httpsOrigin) return reply.code(400).send({ error: "Configure the public HTTPS origin before enabling HTTPS redirects." });
  await pool.query(
    `INSERT INTO installation_http_settings (installation_id, access_mode, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (installation_id) DO UPDATE SET access_mode = EXCLUDED.access_mode, updated_at = now()`,
    [installationId, request.body.mode],
  );
  httpAccessMode = request.body.mode;
  return { mode: httpAccessMode, httpsOrigin };
});

app.post<{ Body: CreateAdminAccount }>("/api/auth/setup", {
  schema: {
    body: {
      type: "object",
      additionalProperties: false,
      required: ["setupCode", "location", "email", "username", "displayName", "password"],
      properties: {
        setupCode: { type: "string", minLength: 8, maxLength: 80 },
        location: { type: "string", minLength: 1, maxLength: 120 },
        email: { type: "string", minLength: 3, maxLength: 254, pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$" },
        username: { type: "string", minLength: 3, maxLength: 32, pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$" },
        displayName: { type: "string", minLength: 1, maxLength: 100 },
        password: { type: "string", minLength: 12, maxLength: 128 },
      },
    },
  },
}, async (request, reply): Promise<{ user: AuthenticatedUser } | { error: string }> => {
  reply.header("Cache-Control", "no-store");
  if (!databaseReady || !pool) return reply.code(503).send({ error: "The account database is unavailable." });
  if (!setupCodeMatches(request.body.setupCode)) return reply.code(403).send({ error: "The one-time setup code is not valid. Check the local Core API terminal." });

  const email = request.body.email.trim().toLocaleLowerCase("en-US");
  const username = request.body.username.trim().toLocaleLowerCase("en-US");
  const location = request.body.location.trim();
  const displayName = request.body.displayName.trim();
  if (!location) return reply.code(400).send({ error: "Enter the church location." });
  if (!displayName) return reply.code(400).send({ error: "Enter your name." });
  const passwordHash = hashPassword(request.body.password);
  const client = await pool.connect();
  let user: AuthenticatedUser;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(1196571730, 1)");
    const existing = await client.query("SELECT id FROM app_users LIMIT 1");
    if (existing.rowCount) {
      await client.query("ROLLBACK");
      firstRunSetupCode = null;
      return reply.code(409).send({ error: "The initial server administrator has already been created." });
    }
    const department = await client.query(
      `UPDATE departments
          SET name = $2,
              enabled_modules = CASE
                WHEN lower(trim($2)) = 'steffisburg' THEN
                  CASE WHEN 'video-steffisburg' = ANY(enabled_modules)
                    THEN array_remove(enabled_modules, 'video')
                    ELSE array_append(array_remove(enabled_modules, 'video'), 'video-steffisburg')
                  END
                ELSE array_remove(array_remove(enabled_modules, 'video'), 'video-steffisburg')
              END,
              updated_at = now()
        WHERE id = $1`,
      [departmentId, location],
    );
    if (!department.rowCount) throw new Error("The configured department could not be found.");
    const result = await client.query(
      `INSERT INTO app_users (id, email, username, display_name, password_hash, role, must_change_password)
       VALUES ($1, $2, $3, $4, $5, 'server_admin', false) RETURNING id, email, username, display_name, role, date_time_format, language, language_is_custom`,
      [randomUUID(), email, username, displayName, passwordHash],
    );
    const row = result.rows[0];
    user = { id: row.id, email: row.email, username: row.username, displayName: row.display_name, role: row.role, mustChangePassword: false, dateTimeFormat: row.date_time_format, language: row.language, languageIsCustom: row.language_is_custom, serverPermissions: allServerPermissions };
    await client.query(
      "INSERT INTO department_memberships (user_id, department_id, role) VALUES ($1, $2, 'site_admin')",
      [user.id, departmentId],
    );
    await client.query("COMMIT");
    firstRunSetupCode = null;
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") return reply.code(409).send({ error: "An account with this username or email already exists." });
    throw error;
  } finally {
    client.release();
  }
  await createSession(user.id, request, reply, request.protocol === "https");
  return reply.code(201).send({ user });
});

app.post<{ Body: LoginCredentials }>("/api/auth/login", {
  schema: {
    body: {
      type: "object",
      additionalProperties: false,
      required: ["identifier", "password"],
      properties: {
        identifier: { type: "string", minLength: 3, maxLength: 254 },
        password: { type: "string", minLength: 1, maxLength: 128 },
      },
    },
  },
}, async (request, reply): Promise<{ user: AuthenticatedUser } | { error: string }> => {
  reply.header("Cache-Control", "no-store");
  if (!databaseReady || !pool) return reply.code(503).send({ error: "The account database is unavailable." });
  const now = Date.now();
  const identifier = request.body.identifier.trim().toLocaleLowerCase("en-US");
  const buckets = [request.ip, `${request.ip}:${createHash("sha256").update(identifier).digest("hex")}`];
  const attempts = buckets.map((key) => failedLogins.get(key));
  if (attempts.some((entry) => entry && entry.resetAt > now && entry.count >= 5)) {
    return reply.code(429).send({ error: "Too many sign-in attempts. Wait 15 minutes and try again." });
  }
  const result = await pool.query(
    "SELECT id, email, username, password_hash, display_name, role, server_permissions, must_change_password, date_time_format, language, language_is_custom FROM app_users WHERE lower(email) = $1 OR lower(username) = $1",
    [identifier],
  );
  const row = result.rows[0];
  const passwordMatches = verifyPassword(request.body.password, row?.password_hash ?? dummyPasswordHash);
  if (!row || !passwordMatches) {
    for (let index = 0; index < buckets.length; index += 1) {
      const key = buckets[index]!;
      const current = attempts[index] && attempts[index]!.resetAt > now ? attempts[index]! : { count: 0, resetAt: now + 15 * 60_000 };
      failedLogins.set(key, { count: current.count + 1, resetAt: current.resetAt });
    }
    if (failedLogins.size > maxFailedLoginBuckets) {
      for (const [key, entry] of failedLogins) {
        if (entry.resetAt <= now || failedLogins.size > maxFailedLoginBuckets) failedLogins.delete(key);
      }
    }
    return reply.code(401).send({ error: "Username, email, or password is incorrect." });
  }
  for (const key of buckets) failedLogins.delete(key);
  const user: AuthenticatedUser = { id: row.id, ...(row.email ? { email: row.email } : {}), username: row.username, displayName: row.display_name, role: row.role, mustChangePassword: row.must_change_password, dateTimeFormat: row.date_time_format, language: row.language, languageIsCustom: row.language_is_custom, serverPermissions: serverPermissionsForUser(row.role, row.server_permissions) };
  await createSession(user.id, request, reply, request.protocol === "https");
  return { user };
});

app.post("/api/auth/logout", async (request, reply) => {
  reply.header("Cache-Control", "no-store");
  const token = cookieValue(request.headers.cookie, sessionCookieNameFor(request));
  if (pool && token) await pool.query("DELETE FROM auth_sessions WHERE token_hash = $1", [hashToken(token)]);
  clearSessionCookie(reply, request.protocol === "https", sessionCookieNameFor(request));
  return { ok: true };
});

app.post<{ Body: { password: string } }>("/api/auth/change-password", {
  schema: {
    body: { type: "object", additionalProperties: false, required: ["password"], properties: { password: { type: "string", minLength: 12, maxLength: 128 } } },
  },
}, async (request, reply): Promise<{ user: AuthenticatedUser } | { error: string }> => {
  reply.header("Cache-Control", "no-store");
  if (!databaseReady || !pool) return reply.code(503).send({ error: "The account database is unavailable." });
  const user = await currentUser(cookieValue(request.headers.cookie, sessionCookieNameFor(request)));
  if (!user) return reply.code(401).send({ error: "Sign in to continue." });
  const result = await pool.query(
    "UPDATE app_users SET password_hash = $2, must_change_password = false WHERE id = $1 RETURNING id, email, username, display_name, role, server_permissions, date_time_format, language, language_is_custom",
    [user.id, hashPassword(request.body.password)],
  );
  const row = result.rows[0];
  if (!row) return reply.code(401).send({ error: "This account could not be found." });
  await pool.query("DELETE FROM auth_sessions WHERE user_id = $1", [user.id]);
  await createSession(user.id, request, reply, request.protocol === "https");
  return { user: { id: row.id, ...(row.email ? { email: row.email } : {}), username: row.username, displayName: row.display_name, role: row.role, mustChangePassword: false, dateTimeFormat: row.date_time_format, language: row.language, languageIsCustom: row.language_is_custom, serverPermissions: serverPermissionsForUser(row.role, row.server_permissions) } };
});

app.put<{ Body: { dateTimeFormat?: import("@smart-church/contracts").DateTimeFormat; language?: import("@smart-church/contracts").UserLanguage | null } }>("/api/auth/preferences", {
  schema: {
    body: {
      type: "object", additionalProperties: false, minProperties: 1,
      properties: {
        dateTimeFormat: { type: "string", enum: ["DD.MM.YYYY HH:MM", "DD/MM/YYYY HH:MM", "MM/DD/YYYY h:mm AM/PM", "YYYY-MM-DD HH:MM"] },
        language: { anyOf: [{ type: "string", enum: ["en", "de", "fr", "it"] }, { type: "null" }] },
      },
    },
  },
}, async (request, reply) => {
  reply.header("Cache-Control", "no-store");
  if (!databaseReady || !pool) return reply.code(503).send({ error: "The account database is unavailable." });
  const user = await currentUser(cookieValue(request.headers.cookie, sessionCookieNameFor(request)));
  if (!user) return reply.code(401).send({ error: "Sign in to continue." });
  if (!validModuleMutation(request, reply)) return;
  await pool.query(
    `UPDATE app_users
        SET date_time_format = COALESCE($2, date_time_format),
            language = CASE WHEN $3 THEN COALESCE($4, language) ELSE language END,
            language_is_custom = CASE WHEN $3 THEN $4 IS NOT NULL ELSE language_is_custom END
      WHERE id = $1`,
    [user.id, request.body.dateTimeFormat ?? null, Object.hasOwn(request.body, "language"), request.body.language ?? null],
  );
  return { dateTimeFormat: request.body.dateTimeFormat ?? user.dateTimeFormat, language: request.body.language ?? user.language, languageIsCustom: request.body.language === undefined ? user.languageIsCustom : request.body.language !== null };
});

app.get("/api/auth/sessions", async (request, reply) => {
  reply.header("Cache-Control", "no-store");
  if (!databaseReady || !pool) return reply.code(503).send({ error: "The account database is unavailable." });
  const token = cookieValue(request.headers.cookie, sessionCookieNameFor(request));
  const user = await currentUser(token);
  if (!user || !token) return reply.code(401).send({ error: "Sign in to continue." });
  const result = await pool.query(
    `SELECT id, user_agent, created_at, last_seen_at, expires_at, token_hash
       FROM auth_sessions WHERE user_id = $1 AND expires_at > now()
       ORDER BY last_seen_at DESC LIMIT 100`,
    [user.id],
  );
  const currentHash = hashToken(token);
  return { sessions: result.rows.map((row) => ({
    id: row.id,
    userAgent: row.user_agent,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    current: row.token_hash === currentHash,
  })) };
});

app.delete<{ Params: { id: string } }>("/api/auth/sessions/:id", {
  schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } },
}, async (request, reply) => {
  reply.header("Cache-Control", "no-store");
  if (!databaseReady || !pool) return reply.code(503).send({ error: "The account database is unavailable." });
  const token = cookieValue(request.headers.cookie, sessionCookieNameFor(request));
  const user = await currentUser(token);
  if (!user || !token) return reply.code(401).send({ error: "Sign in to continue." });
  const revoked = await pool.query(
    "DELETE FROM auth_sessions WHERE id = $1 AND user_id = $2 RETURNING token_hash",
    [request.params.id, user.id],
  );
  if (!revoked.rowCount) return reply.code(404).send({ error: "This sign-in session could not be found." });
  const current = revoked.rows[0].token_hash === hashToken(token);
  if (current) clearSessionCookie(reply, request.protocol === "https", sessionCookieNameFor(request));
  return { revoked: true, current };
});

const modulePermissionsSchema = { type: "object", maxProperties: 100, propertyNames: { pattern: "^[a-z0-9][a-z0-9-]{0,63}$" }, additionalProperties: { type: "array", maxItems: 100, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 80 } } };

const locationAccessBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["role", "permissions", "modulePermissions"],
  properties: {
    role: { type: "string", enum: ["site_admin", "member"] },
    permissions: { type: "array", uniqueItems: true, items: { type: "string", enum: ["people_view_private", "people_manage", "events_manage", "groups_manage", "resources_manage"] } },
    modulePermissions: modulePermissionsSchema,
  },
};

app.get("/api/location-access", async (request, reply) => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "The account database is unavailable." });
  const selectedDepartmentId = await activeDepartmentId(request, reply, true);
  if (!selectedDepartmentId) return reply;
  const [location, members, availableUsers] = await Promise.all([
    pool.query("SELECT name FROM departments WHERE id = $1", [selectedDepartmentId]),
    pool.query(
      `SELECT u.id, u.display_name, u.username, m.role, m.permissions, m.video_permissions, m.presenter_permissions, m.module_permissions
         FROM department_memberships m JOIN app_users u ON u.id = m.user_id
        WHERE m.department_id = $1 ORDER BY lower(u.display_name), lower(u.username)`,
      [selectedDepartmentId],
    ),
    pool.query(
      `SELECT u.id, u.display_name, u.username FROM app_users u
        WHERE NOT EXISTS (SELECT 1 FROM department_memberships m WHERE m.department_id = $1 AND m.user_id = u.id)
        ORDER BY lower(u.display_name), lower(u.username)`,
      [selectedDepartmentId],
    ),
  ]);
  return {
    location: location.rows[0]?.name ?? "Location",
    currentUserId: request.authenticatedUser!.id,
    members: members.rows.map((row) => ({ id: row.id, displayName: row.display_name, username: row.username, role: row.role, permissions: row.permissions ?? [], modulePermissions: { ...(row.module_permissions ?? {}), "video-steffisburg": row.module_permissions?.["video-steffisburg"] ?? row.module_permissions?.video ?? row.video_permissions ?? [], presenter: row.module_permissions?.presenter ?? row.presenter_permissions ?? [] } })),
    availableUsers: availableUsers.rows.map((row) => ({ id: row.id, displayName: row.display_name, username: row.username })),
  };
});

app.put<{ Params: { userId: string }; Body: { role: "site_admin" | "member"; permissions: LocationPermission[]; modulePermissions: Record<string, string[]> } }>("/api/location-access/:userId", {
  schema: {
    params: { type: "object", required: ["userId"], properties: { userId: { type: "string", format: "uuid" } } },
    body: locationAccessBodySchema,
  },
}, async (request, reply) => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "The account database is unavailable." });
  if (!validModuleMutation(request, reply)) return reply;
  const selectedDepartmentId = await activeDepartmentId(request, reply, true);
  if (!selectedDepartmentId) return reply;
  if (request.params.userId === request.authenticatedUser!.id && request.body.role !== "site_admin") {
    return reply.code(400).send({ error: "You cannot remove your own site administrator access." });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(1196571730, 4)");
    await client.query("SELECT id FROM departments WHERE id = $1 FOR UPDATE", [selectedDepartmentId]);
    const target = await client.query("SELECT id FROM app_users WHERE id = $1", [request.params.userId]);
    if (!target.rowCount) {
      await client.query("ROLLBACK");
      return reply.code(404).send({ error: "This account could not be found on this server." });
    }
    const current = await client.query("SELECT role FROM department_memberships WHERE department_id = $1 AND user_id = $2 FOR UPDATE", [selectedDepartmentId, request.params.userId]);
    if (current.rows[0]?.role === "site_admin" && request.body.role !== "site_admin") {
      const administrators = await client.query("SELECT count(*)::int AS total FROM department_memberships WHERE department_id = $1 AND role = 'site_admin'", [selectedDepartmentId]);
      if (administrators.rows[0].total <= 1) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "Keep at least one site administrator for this location." });
      }
    }
    const permissions = request.body.role === "site_admin" ? [] : request.body.permissions;
    const modulePermissions = request.body.role === "site_admin" ? {} : request.body.modulePermissions;
    const videoPermissions = modulePermissions["video-steffisburg"] ?? modulePermissions.video ?? [];
    const presenterPermissions = modulePermissions.presenter ?? [];
    await client.query(
      `INSERT INTO department_memberships (user_id, department_id, role, permissions, video_permissions, presenter_permissions, module_permissions)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, department_id) DO UPDATE
         SET role = EXCLUDED.role, permissions = EXCLUDED.permissions,
             video_permissions = EXCLUDED.video_permissions, presenter_permissions = EXCLUDED.presenter_permissions,
             module_permissions = EXCLUDED.module_permissions`,
      [request.params.userId, selectedDepartmentId, request.body.role, permissions, videoPermissions, presenterPermissions, JSON.stringify(modulePermissions)],
    );
    await client.query("COMMIT");
    const user = await pool.query("SELECT id, display_name, username FROM app_users WHERE id = $1", [request.params.userId]);
    if (!user.rows[0]) return reply.code(404).send({ error: "This account could not be found on this server." });
    return { member: { id: user.rows[0].id, displayName: user.rows[0].display_name, username: user.rows[0].username, role: request.body.role, permissions, modulePermissions } };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
});

app.delete<{ Params: { userId: string } }>("/api/location-access/:userId", {
  schema: { params: { type: "object", required: ["userId"], properties: { userId: { type: "string", format: "uuid" } } } },
}, async (request, reply) => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "The account database is unavailable." });
  if (!validModuleMutation(request, reply)) return reply;
  const selectedDepartmentId = await activeDepartmentId(request, reply, true);
  if (!selectedDepartmentId) return reply;
  if (request.params.userId === request.authenticatedUser!.id) return reply.code(400).send({ error: "Ask another site administrator to remove your location access." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(1196571730, 4)");
    await client.query("SELECT id FROM departments WHERE id = $1 FOR UPDATE", [selectedDepartmentId]);
    const member = await client.query("SELECT role FROM department_memberships WHERE department_id = $1 AND user_id = $2 FOR UPDATE", [selectedDepartmentId, request.params.userId]);
    if (!member.rowCount) {
      await client.query("ROLLBACK");
      return reply.code(404).send({ error: "This user does not have access to this location." });
    }
    if (member.rows[0].role === "site_admin") {
      const administrators = await client.query("SELECT count(*)::int AS total FROM department_memberships WHERE department_id = $1 AND role = 'site_admin'", [selectedDepartmentId]);
      if (administrators.rows[0].total <= 1) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "Keep at least one site administrator for this location." });
      }
    }
    await client.query("DELETE FROM department_memberships WHERE department_id = $1 AND user_id = $2", [selectedDepartmentId, request.params.userId]);
    await client.query("COMMIT");
    return { id: request.params.userId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
});

app.get("/api/users", async (request, reply): Promise<SiteUser[] | { error: string }> => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "The account database is unavailable." });
  if (!requireServerPermission(request, reply, "server_manage")) return reply;
  const result = await pool.query(
    `SELECT u.id, u.email, u.username, u.display_name, to_char(u.birthday, 'DD:MM:YYYY') AS birthday,
            u.street, u.street_number, u.postal_code, u.city, u.role AS account_role, u.server_permissions,
            memberships.memberships,
            phones.phone_numbers, relations.relationships
       FROM app_users u
       LEFT JOIN LATERAL (
         SELECT COALESCE(json_agg(json_build_object('departmentId', m.department_id, 'role', m.role, 'contactId', m.contact_id, 'permissions', m.permissions, 'videoPermissions', m.video_permissions, 'presenterPermissions', m.presenter_permissions, 'modulePermissions', m.module_permissions)), '[]'::json) AS memberships
           FROM department_memberships m WHERE m.user_id = u.id
       ) memberships ON true
       LEFT JOIN LATERAL (
         SELECT COALESCE(json_agg(json_build_object('label', p.label, 'number', p.number) ORDER BY p.position), '[]'::json) AS phone_numbers
           FROM user_phone_numbers p WHERE p.user_id = u.id
       ) phones ON true
       LEFT JOIN LATERAL (
         SELECT COALESCE(json_agg(json_build_object('relatedUserId', r.related_user_id, 'relatedUserName', related.display_name, 'relationship', r.relationship) ORDER BY related.display_name), '[]'::json) AS relationships
           FROM user_relationships r JOIN app_users related ON related.id = r.related_user_id
          WHERE r.user_id = u.id
       ) relations ON true
      ORDER BY u.display_name, u.email`,
  );
  return result.rows.map((row) => ({ id: row.id, ...(row.email ? { email: row.email } : {}), username: row.username, displayName: row.display_name, ...(row.birthday ? { birthday: row.birthday } : {}), ...(row.street ? { street: row.street } : {}), ...(row.street_number ? { streetNumber: row.street_number } : {}), ...(row.postal_code ? { postalCode: row.postal_code } : {}), ...(row.city ? { city: row.city } : {}), phoneNumbers: row.phone_numbers, relationships: row.relationships, accountRole: row.account_role, serverPermissions: row.server_permissions ?? [], memberships: row.memberships }));
});

app.get("/api/people-options", async (request, reply) => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "The account database is unavailable." });
  if (!requireServerPermission(request, reply, "server_manage")) return reply;
  const result = await pool.query(
    `SELECT id, department_id, first_name, last_name, email, source_system
       FROM contacts ORDER BY department_id, lower(last_name), lower(first_name)`,
  );
  return result.rows.map((row) => ({
    id: row.id, departmentId: row.department_id, firstName: row.first_name, lastName: row.last_name,
    ...(row.email ? { email: row.email } : {}), ...(row.source_system === "churchtools" ? { importedFrom: "churchtools" as const } : {}),
  }));
});

const phoneNumbersSchema = {
  type: "array",
  maxItems: 10,
  items: {
    type: "object",
    additionalProperties: false,
    required: ["label", "number"],
    properties: {
      label: { type: "string", enum: ["home", "mobile", "work", "work_mobile"] },
      number: { type: "string", minLength: 1, maxLength: 32 },
    },
  },
};

const relationshipsSchema = {
  type: "array",
  maxItems: 100,
  items: {
    type: "object",
    additionalProperties: false,
    required: ["relatedUserId", "relationship"],
    properties: {
      relatedUserId: { type: "string", format: "uuid" },
      relationship: { type: "string", enum: ["spouse", "parent", "child", "sibling", "guardian", "ward", "other"] },
    },
  },
};

function cleanPhoneNumbers(numbers: UserPhoneNumber[] | undefined) {
  return (numbers ?? []).map((phone) => ({ label: phone.label, number: phone.number.trim() }));
}

async function insertUserPhoneNumbers(client: { query: (text: string, values?: unknown[]) => Promise<unknown> }, userId: string, numbers: UserPhoneNumber[]) {
  for (const [position, phone] of numbers.entries()) {
    if (!phone.number) continue;
    await client.query(
      "INSERT INTO user_phone_numbers (user_id, position, label, number) VALUES ($1, $2, $3, $4)",
      [userId, position, phone.label, phone.number],
    );
  }
}

const inverseRelationship: Record<UserRelationshipKind, UserRelationshipKind> = {
  spouse: "spouse",
  parent: "child",
  child: "parent",
  sibling: "sibling",
  guardian: "ward",
  ward: "guardian",
  other: "other",
};

async function replaceUserRelationships(client: PoolClient, userId: string, relationships: UserRelationshipInput[]) {
  await client.query("SELECT pg_advisory_xact_lock(1196571730, 3)");
  const relatedIds = relationships.map((relationship) => relationship.relatedUserId);
  if (new Set(relatedIds).size !== relatedIds.length || relatedIds.includes(userId)) return "Choose each related user once and do not select this account.";
  if (relatedIds.length) {
    const found = await client.query("SELECT id FROM app_users WHERE id = ANY($1::uuid[])", [relatedIds]);
    if (found.rowCount !== relatedIds.length) return "One of the selected users could not be found.";
  }
  await client.query("DELETE FROM user_relationships WHERE user_id = $1 OR related_user_id = $1", [userId]);
  for (const relationship of relationships) {
    await client.query(
      "INSERT INTO user_relationships (user_id, related_user_id, relationship) VALUES ($1, $2, $3), ($2, $1, $4)",
      [userId, relationship.relatedUserId, relationship.relationship, inverseRelationship[relationship.relationship]],
    );
  }
  return null;
}

async function readUserRelationships(client: PoolClient, userId: string) {
  const result = await client.query(
    `SELECT r.related_user_id, u.display_name, r.relationship
       FROM user_relationships r JOIN app_users u ON u.id = r.related_user_id
      WHERE r.user_id = $1 ORDER BY u.display_name`,
    [userId],
  );
  return result.rows.map((row) => ({ relatedUserId: row.related_user_id, relatedUserName: row.display_name, relationship: row.relationship as UserRelationshipKind }));
}

app.post<{ Body: CreateSiteUser }>("/api/users", {
  schema: {
    body: {
      type: "object",
      additionalProperties: false,
      required: ["username", "displayName", "password", "accountRole", "memberships"],
      properties: {
        email: { type: "string", minLength: 3, maxLength: 254, pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$" },
        username: { type: "string", minLength: 3, maxLength: 32, pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$" },
        displayName: { type: "string", minLength: 1, maxLength: 100 },
        birthday: { type: "string", pattern: "^\\d{2}:\\d{2}:\\d{4}$" },
        street: { type: "string", maxLength: 160 },
        streetNumber: { type: "string", maxLength: 24 },
        postalCode: { type: "string", maxLength: 20 },
        city: { type: "string", maxLength: 100 },
        phoneNumbers: phoneNumbersSchema,
        relationships: relationshipsSchema,
        password: { type: "string", minLength: 12, maxLength: 128 },
        accountRole: { type: "string", enum: ["server_admin", "user"] },
        serverPermissions: { type: "array", uniqueItems: true, items: { type: "string", enum: ["server_view", "server_troubleshoot", "server_manage"] } },
        memberships: {
          type: "array", maxItems: 100,
          items: { type: "object", additionalProperties: false, required: ["departmentId", "role"], properties: { departmentId: { type: "string", format: "uuid" }, role: { type: "string", enum: ["site_admin", "member"] }, contactId: { type: "string", format: "uuid" }, permissions: { type: "array", uniqueItems: true, items: { type: "string", enum: ["people_view_private", "people_manage", "events_manage", "groups_manage", "resources_manage"] } }, videoPermissions: { type: "array", uniqueItems: true, items: { type: "string", enum: ["video_basic", "streaming_operator", "stream_admin", "routing_user", "routing_admin"] } }, presenterPermissions: { type: "array", uniqueItems: true, items: { type: "string", enum: ["editor", "operator", "admin"] } }, modulePermissions: modulePermissionsSchema } },
        },
      },
    },
  },
}, async (request, reply): Promise<SiteUser | { error: string }> => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "The account database is unavailable." });
  if (!requireServerPermission(request, reply, "server_manage")) return reply;
  const email = request.body.email?.trim().toLocaleLowerCase("en-US") || null;
  const username = request.body.username.trim().toLocaleLowerCase("en-US");
  const displayName = request.body.displayName.trim();
  const birthday = request.body.birthday?.trim() || undefined;
  const street = request.body.street?.trim() || null;
  const streetNumber = request.body.streetNumber?.trim() || null;
  const postalCode = request.body.postalCode?.trim() || null;
  const city = request.body.city?.trim() || null;
  const phoneNumbers = cleanPhoneNumbers(request.body.phoneNumbers);
  const relationships = request.body.relationships ?? [];
  const accountRole = request.body.accountRole;
  const serverPermissions = accountRole === "user" ? request.body.serverPermissions ?? [] : [];
  const memberships = request.body.memberships;
  if (!displayName) return reply.code(400).send({ error: "Enter the user's name." });
  if (!validBirthday(birthday)) return reply.code(400).send({ error: "Enter a valid birthday as DD:MM:YYYY." });
  if (accountRole === "server_admin" && request.authenticatedUser?.role !== "server_admin") {
    return reply.code(403).send({ error: "Only a Server Administrator can grant Server Administrator access." });
  }
  if (serverPermissions.length && request.authenticatedUser?.role !== "server_admin") {
    return reply.code(403).send({ error: "Only a Server Administrator can assign installation permissions." });
  }
  if (accountRole === "user" && memberships.length === 0) {
    return reply.code(400).send({ error: "Assign a local user to at least one site." });
  }
  if (new Set(memberships.map((membership) => membership.departmentId)).size !== memberships.length) {
    return reply.code(400).send({ error: "Choose each location only once." });
  }
  const id = randomUUID();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (accountRole === "server_admin") await client.query("SELECT pg_advisory_xact_lock(1196571730, 2)");
    const user = await client.query(
      `INSERT INTO app_users (id, email, username, display_name, password_hash, role, birthday, street, street_number, postal_code, city, must_change_password, server_permissions)
       VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9, $10, $11, true, $12)
       RETURNING id, email, username, display_name, to_char(birthday, 'DD:MM:YYYY') AS birthday, street, street_number, postal_code, city, server_permissions`,
      [id, email, username, displayName, hashPassword(request.body.password), accountRole, birthdayToIso(birthday), street, streetNumber, postalCode, city, serverPermissions],
    );
    for (const membership of memberships) {
      if (membership.contactId) {
        const person = await client.query("SELECT id FROM contacts WHERE id=$1 AND department_id=$2", [membership.contactId, membership.departmentId]);
        if (!person.rowCount) { await client.query("ROLLBACK"); return reply.code(400).send({ error: "The linked person must belong to the selected site." }); }
      }
      const modulePermissions = membership.role === "site_admin" ? {} : {
        ...(membership.modulePermissions ?? {}),
        "video-steffisburg": membership.videoPermissions ?? membership.modulePermissions?.["video-steffisburg"] ?? membership.modulePermissions?.video ?? [],
        presenter: membership.presenterPermissions ?? membership.modulePermissions?.presenter ?? [],
      };
      await client.query(
        "INSERT INTO department_memberships (user_id, department_id, role, contact_id, permissions, video_permissions, presenter_permissions, module_permissions) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        [id, membership.departmentId, membership.role, membership.contactId ?? null, membership.permissions ?? [], membership.videoPermissions ?? [], membership.presenterPermissions ?? [], JSON.stringify(modulePermissions)],
      );
    }
    await insertUserPhoneNumbers(client, id, phoneNumbers);
    const relationshipError = await replaceUserRelationships(client, id, relationships);
    if (relationshipError) {
      await client.query("ROLLBACK");
      return reply.code(400).send({ error: relationshipError });
    }
    await client.query("COMMIT");
    const row = user.rows[0];
    return reply.code(201).send({ id: row.id, ...(row.email ? { email: row.email } : {}), username: row.username, displayName: row.display_name, ...(row.birthday ? { birthday: row.birthday } : {}), ...(row.street ? { street: row.street } : {}), ...(row.street_number ? { streetNumber: row.street_number } : {}), ...(row.postal_code ? { postalCode: row.postal_code } : {}), ...(row.city ? { city: row.city } : {}), phoneNumbers, relationships: await readUserRelationships(client, id), accountRole, serverPermissions: row.server_permissions ?? [], memberships });
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") return reply.code(409).send({ error: "An account with this username or email already exists, or the selected person is already linked to another account." });
    if ((error as { code?: string }).code === "23503") return reply.code(400).send({ error: "One of the selected locations no longer exists." });
    throw error;
  } finally {
    client.release();
  }
});

app.put<{ Params: { id: string }; Body: Pick<CreateSiteUser, "email" | "username" | "displayName" | "birthday" | "street" | "streetNumber" | "postalCode" | "city" | "phoneNumbers" | "relationships" | "memberships"> & { accountRole?: CreateSiteUser["accountRole"]; serverPermissions?: CreateSiteUser["serverPermissions"] } }>("/api/users/:id", {
  schema: {
    params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
    body: {
      type: "object", additionalProperties: false, required: ["username", "displayName", "memberships"],
      properties: {
        email: { type: "string", minLength: 3, maxLength: 254, pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$" },
        username: { type: "string", minLength: 3, maxLength: 32, pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$" },
        displayName: { type: "string", minLength: 1, maxLength: 100 },
        birthday: { type: "string", pattern: "^\\d{2}:\\d{2}:\\d{4}$" },
        street: { type: "string", maxLength: 160 },
        streetNumber: { type: "string", maxLength: 24 },
        postalCode: { type: "string", maxLength: 20 },
        city: { type: "string", maxLength: 100 },
        accountRole: { type: "string", enum: ["server_admin", "user"] },
        serverPermissions: { type: "array", uniqueItems: true, items: { type: "string", enum: ["server_view", "server_troubleshoot", "server_manage"] } },
        phoneNumbers: phoneNumbersSchema,
        relationships: relationshipsSchema,
        memberships: {
          type: "array", maxItems: 100,
          items: {
            type: "object", additionalProperties: false, required: ["departmentId", "role"],
            properties: {
              departmentId: { type: "string", format: "uuid" },
              role: { type: "string", enum: ["site_admin", "member"] },
              contactId: { type: "string", format: "uuid" },
              permissions: { type: "array", uniqueItems: true, items: { type: "string", enum: ["people_view_private", "people_manage", "events_manage", "groups_manage", "resources_manage"] } },
              videoPermissions: { type: "array", uniqueItems: true, items: { type: "string", enum: ["video_basic", "streaming_operator", "stream_admin", "routing_user", "routing_admin"] } },
              presenterPermissions: { type: "array", uniqueItems: true, items: { type: "string", enum: ["editor", "operator", "admin"] } },
              modulePermissions: modulePermissionsSchema,
            },
          },
        },
      },
    },
  },
}, async (request, reply): Promise<SiteUser | { error: string }> => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "The account database is unavailable." });
  if (!requireServerPermission(request, reply, "server_manage")) return reply;
  const email = request.body.email?.trim().toLocaleLowerCase("en-US") || null;
  const username = request.body.username.trim().toLocaleLowerCase("en-US");
  const displayName = request.body.displayName.trim();
  const birthday = request.body.birthday?.trim() || undefined;
  const street = request.body.street?.trim() || null;
  const streetNumber = request.body.streetNumber?.trim() || null;
  const postalCode = request.body.postalCode?.trim() || null;
  const city = request.body.city?.trim() || null;
  const phoneNumbers = cleanPhoneNumbers(request.body.phoneNumbers);
  const relationships = request.body.relationships ?? [];
  const memberships = request.body.memberships;
  if (!displayName) return reply.code(400).send({ error: "Enter the user's name." });
  if (!validBirthday(birthday)) return reply.code(400).send({ error: "Enter a valid birthday as DD:MM:YYYY." });
  if (request.params.id === request.authenticatedUser?.id && memberships.length === 0) {
    return reply.code(400).send({ error: "Keep at least one site membership on your own account." });
  }
  if (new Set(memberships.map((membership) => membership.departmentId)).size !== memberships.length) {
    return reply.code(400).send({ error: "Choose each location only once." });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(1196571730, 2)");
    const current = await client.query("SELECT role FROM app_users WHERE id = $1 FOR UPDATE", [request.params.id]);
    if (!current.rowCount) {
      await client.query("ROLLBACK");
      return reply.code(404).send({ error: "This local user could not be found." });
    }
    const accountRole = request.body.accountRole ?? current.rows[0].role;
    if (accountRole !== current.rows[0].role && request.authenticatedUser?.role !== "server_admin") {
      await client.query("ROLLBACK");
      return reply.code(403).send({ error: "Only a Server Administrator can change an account's installation role." });
    }
    if (request.body.serverPermissions?.length && request.authenticatedUser?.role !== "server_admin") {
      await client.query("ROLLBACK");
      return reply.code(403).send({ error: "Only a Server Administrator can assign installation permissions." });
    }
    if (current.rows[0].role === "server_admin" && accountRole !== "server_admin") {
      const admins = await client.query("SELECT count(*)::int AS total FROM app_users WHERE role = 'server_admin'");
      if (admins.rows[0].total <= 1) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "The last Server Administrator account cannot be removed." });
      }
    }
    const updated = await client.query(
      `UPDATE app_users SET email = $2, username = $3, display_name = $4, birthday = $5::date,
              street = $6, street_number = $7, postal_code = $8, city = $9, role = $10,
              server_permissions = CASE WHEN $11 THEN $12::TEXT[] ELSE server_permissions END
        WHERE id = $1
        RETURNING id, email, username, display_name, to_char(birthday, 'DD:MM:YYYY') AS birthday,
                  street, street_number, postal_code, city, role, server_permissions`,
      [request.params.id, email, username, displayName, birthdayToIso(birthday), street, streetNumber, postalCode, city, accountRole, request.authenticatedUser?.role === "server_admin", accountRole === "user" ? request.body.serverPermissions ?? [] : []],
    );
    if (!updated.rowCount) {
      await client.query("ROLLBACK");
      return reply.code(404).send({ error: "This local user could not be found." });
    }
    const previousModulePermissions = await client.query("SELECT department_id, module_permissions FROM department_memberships WHERE user_id = $1", [request.params.id]);
    const modulePermissionsByDepartment = new Map(previousModulePermissions.rows.map((membership) => [membership.department_id, membership.module_permissions ?? {}]));
    await client.query("DELETE FROM department_memberships WHERE user_id = $1", [request.params.id]);
    await client.query("DELETE FROM user_phone_numbers WHERE user_id = $1", [request.params.id]);
    await insertUserPhoneNumbers(client, request.params.id, phoneNumbers);
    const relationshipError = await replaceUserRelationships(client, request.params.id, relationships);
    if (relationshipError) {
      await client.query("ROLLBACK");
      return reply.code(400).send({ error: relationshipError });
    }
    for (const membership of memberships) {
      if (membership.contactId) {
        const person = await client.query("SELECT id FROM contacts WHERE id=$1 AND department_id=$2", [membership.contactId, membership.departmentId]);
        if (!person.rowCount) { await client.query("ROLLBACK"); return reply.code(400).send({ error: "The linked person must belong to the selected site." }); }
      }
      const preservedModulePermissions = membership.modulePermissions ?? modulePermissionsByDepartment.get(membership.departmentId) ?? {};
      const modulePermissions = membership.role === "site_admin" ? {} : {
        ...preservedModulePermissions,
        "video-steffisburg": membership.videoPermissions ?? preservedModulePermissions["video-steffisburg"] ?? preservedModulePermissions.video ?? [],
        presenter: membership.presenterPermissions ?? preservedModulePermissions.presenter ?? [],
      };
      await client.query(
        "INSERT INTO department_memberships (user_id, department_id, role, contact_id, permissions, video_permissions, presenter_permissions, module_permissions) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        [request.params.id, membership.departmentId, membership.role, membership.contactId ?? null, membership.permissions ?? [], membership.videoPermissions ?? [], membership.presenterPermissions ?? [], JSON.stringify(modulePermissions)],
      );
    }
    await client.query("COMMIT");
    const row = updated.rows[0];
    return { id: row.id, ...(row.email ? { email: row.email } : {}), username: row.username, displayName: row.display_name, ...(row.birthday ? { birthday: row.birthday } : {}), ...(row.street ? { street: row.street } : {}), ...(row.street_number ? { streetNumber: row.street_number } : {}), ...(row.postal_code ? { postalCode: row.postal_code } : {}), ...(row.city ? { city: row.city } : {}), phoneNumbers, relationships: await readUserRelationships(client, request.params.id), accountRole: row.role, serverPermissions: row.server_permissions ?? [], memberships };
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") return reply.code(409).send({ error: "An account with this username or email already exists, or the selected person is already linked to another account." });
    if ((error as { code?: string }).code === "23503") return reply.code(400).send({ error: "One of the selected locations no longer exists." });
    throw error;
  } finally {
    client.release();
  }
});

app.delete<{ Params: { id: string } }>("/api/users/:id", {
  schema: {
    params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
  },
}, async (request, reply): Promise<{ id: string } | { error: string }> => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "The account database is unavailable." });
  if (!requireServerPermission(request, reply, "server_manage")) return reply;
  if (request.params.id === request.authenticatedUser?.id) {
    return reply.code(400).send({ error: "You cannot delete your own account." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(1196571730, 2)");
    const target = await client.query("SELECT id, role FROM app_users WHERE id = $1 FOR UPDATE", [request.params.id]);
    if (!target.rowCount) {
      await client.query("ROLLBACK");
      return reply.code(404).send({ error: "This local user could not be found." });
    }
    if (target.rows[0].role === "server_admin" && request.authenticatedUser?.role !== "server_admin") {
      await client.query("ROLLBACK");
      return reply.code(403).send({ error: "Only a Server Administrator can delete an installation administrator." });
    }
    if (target.rows[0].role === "server_admin") {
      const admins = await client.query("SELECT count(*)::int AS total FROM app_users WHERE role = 'server_admin'");
      if (admins.rows[0].total <= 1) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "The last Server Administrator account cannot be deleted." });
      }
    }
    await client.query("DELETE FROM app_users WHERE id = $1", [request.params.id]);
    await client.query("COMMIT");
    return { id: request.params.id };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

app.post<{ Params: { id: string }; Body: { password: string; mustChangePassword?: boolean } }>("/api/users/:id/reset-password", {
  schema: {
    params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
    body: { type: "object", additionalProperties: false, required: ["password"], properties: { password: { type: "string", minLength: 12, maxLength: 128 }, mustChangePassword: { type: "boolean" } } },
  },
}, async (request, reply): Promise<{ id: string; mustChangePassword: boolean } | { error: string }> => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "The account database is unavailable." });
  if (!requireServerPermission(request, reply, "server_manage")) return reply;
  if (request.params.id === request.authenticatedUser?.id) return reply.code(400).send({ error: "Choose another user to reset their password." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const target = await client.query("SELECT id,role FROM app_users WHERE id = $1 FOR UPDATE", [request.params.id]);
    if (!target.rowCount) {
      await client.query("ROLLBACK");
      return reply.code(404).send({ error: "This local user could not be found." });
    }
    if (target.rows[0].role === "server_admin" && request.authenticatedUser?.role !== "server_admin") {
      await client.query("ROLLBACK");
      return reply.code(403).send({ error: "Only a Server Administrator can reset an installation administrator password." });
    }
    await client.query("UPDATE app_users SET password_hash = $2, must_change_password = true WHERE id = $1", [request.params.id, hashPassword(request.body.password)]);
    await client.query("DELETE FROM auth_sessions WHERE user_id = $1", [request.params.id]);
    await client.query("COMMIT");
    return { id: request.params.id, mustChangePassword: true };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

app.get("/api/departments", async (request, reply): Promise<DepartmentProfile[] | { error: string }> => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "Configure DATABASE_URL to load locations." });
  if (hasServerPermission(request, "server_manage")) {
    const result = await pool.query(
      `SELECT d.id, d.name, d.time_zone, d.enabled_modules, m.role, COALESCE(m.permissions, '{}'::TEXT[]) AS permissions, COALESCE(m.video_permissions, '{}'::TEXT[]) AS video_permissions, COALESCE(m.presenter_permissions, '{}'::TEXT[]) AS presenter_permissions, COALESCE(m.module_permissions, '{}'::JSONB) AS module_permissions
         FROM departments d
         LEFT JOIN department_memberships m
           ON m.department_id = d.id AND m.user_id = $1
        ORDER BY d.name`,
      [request.authenticatedUser?.id],
    );
    return result.rows.map((row) => ({ id: row.id, location: row.name, timeZone: row.time_zone, role: row.role ?? "unassigned", enabledModules: row.enabled_modules, permissions: row.permissions, videoPermissions: row.video_permissions, presenterPermissions: row.presenter_permissions, modulePermissions: row.module_permissions }));
  }
  const result = await pool.query(
    `SELECT d.id, d.name, d.time_zone, d.enabled_modules, m.role, m.permissions, m.video_permissions, m.presenter_permissions, m.module_permissions
       FROM department_memberships m
       JOIN departments d ON d.id = m.department_id
      WHERE m.user_id = $1
      ORDER BY d.name`,
    [request.authenticatedUser?.id],
  );
  return result.rows.map((row) => ({ id: row.id, location: row.name, timeZone: row.time_zone, role: row.role, enabledModules: row.enabled_modules, permissions: row.permissions ?? [], videoPermissions: row.video_permissions, presenterPermissions: row.presenter_permissions, modulePermissions: row.module_permissions ?? {} }));
});

app.put<{ Body: { moduleIds: string[] } }>("/api/installation/modules", {
  schema: {
    body: {
      type: "object", additionalProperties: false, required: ["moduleIds"],
      properties: { moduleIds: { type: "array", maxItems: 100, uniqueItems: true, items: { type: "string", pattern: "^[a-z0-9][a-z0-9-]*$", maxLength: 80 } } },
    },
  },
}, async (request, reply): Promise<{ enabledModules: string[] } | { error: string }> => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "The account database is unavailable." });
  if (!requireServerPermission(request, reply, "server_manage")) return reply;
  if (!installationId) return reply.code(503).send({ error: "The installation identity is unavailable." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM installations WHERE id=$1 FOR UPDATE", [installationId]);
    const catalogResult = await client.query<{ module_id: string; required: boolean; client_managed: boolean; enabled: boolean }>(
      "SELECT module_id,required,client_managed,enabled FROM installation_modules WHERE installation_id=$1",
      [installationId],
    );
    const clientCatalog = new Map(catalogResult.rows.filter((module) => module.client_managed).map((module) => [module.module_id, module]));
    const unknown = request.body.moduleIds.filter((id) => !clientCatalog.has(id));
    if (unknown.length) {
      await client.query("ROLLBACK");
      return reply.code(400).send({ error: `These modules are not installed for the client: ${unknown.join(", ")}.` });
    }
    const requiredIds = new Set([
      ...getRequiredServerModuleIds().filter((id) => clientCatalog.has(id)),
      ...catalogResult.rows.filter((module) => module.required && module.client_managed).map((module) => module.module_id),
    ]);
    const disabledRequired = [...requiredIds].filter((id) => !request.body.moduleIds.includes(id));
    if (disabledRequired.length) {
      await client.query("ROLLBACK");
      return reply.code(400).send({ error: `Required modules cannot be disabled: ${disabledRequired.join(", ")}.` });
    }
    const requiredDependencies = getRequiredModuleDependencies();
    const missingDependencies = request.body.moduleIds.flatMap((id) => (requiredDependencies[id] ?? [])
      .filter((dependencyId) => {
        const dependency = catalogResult.rows.find((module) => module.module_id === dependencyId);
        return dependency?.client_managed ? !request.body.moduleIds.includes(dependencyId) : !dependency?.enabled;
      })
      .map((dependencyId) => `${id} requires ${dependencyId}`));
    if (missingDependencies.length) {
      await client.query("ROLLBACK");
      return reply.code(400).send({ error: `Enable required module dependencies first: ${missingDependencies.join("; ")}.` });
    }
    await client.query(
      `UPDATE installation_modules
          SET enabled=(module_id=ANY($2::TEXT[])),updated_at=now()
        WHERE installation_id=$1 AND client_managed=TRUE AND required=FALSE`,
      [installationId, request.body.moduleIds],
    );
    await client.query(
      `UPDATE departments AS department
          SET enabled_modules=COALESCE((
                SELECT array_agg(module.module_id ORDER BY module.module_id)
                  FROM installation_modules AS module
                 WHERE module.installation_id=department.installation_id
                   AND module.client_managed=TRUE AND module.enabled=TRUE
              ), ARRAY['file-storage','notifications']::TEXT[]),
              updated_at=now()
        WHERE department.installation_id=$1`,
      [installationId],
    );
    const result = await client.query<{ module_id: string }>(
      "SELECT module_id FROM installation_modules WHERE installation_id=$1 AND client_managed=TRUE AND enabled=TRUE ORDER BY module_id",
      [installationId],
    );
    await client.query("COMMIT");
    for (const module of catalogResult.rows.filter((item) => item.client_managed)) {
      setServerModuleEnabled(module.module_id, module.required || request.body.moduleIds.includes(module.module_id));
    }
    return { enabledModules: result.rows.map((row) => row.module_id) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

app.post<{ Body: CreateDepartment }>("/api/departments", {
  schema: {
    body: {
      type: "object",
      additionalProperties: false,
      required: ["location", "timeZone"],
      properties: {
        location: { type: "string", minLength: 1, maxLength: 120 },
        timeZone: { type: "string", minLength: 1, maxLength: 80 },
      },
    },
  },
}, async (request, reply): Promise<DepartmentProfile | { error: string }> => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "Configure DATABASE_URL to create locations." });
  if (!requireServerPermission(request, reply, "server_manage")) return reply;
  if (!installationId) return reply.code(503).send({ error: "The installation identity is unavailable." });
  const location = request.body.location.trim();
  const timeZone = request.body.timeZone.trim();
  if (!location || !timeZone) return reply.code(400).send({ error: "Location and time zone are required." });
  try {
    new Intl.DateTimeFormat("en", { timeZone });
  } catch {
    return reply.code(400).send({ error: "Choose a valid time zone, such as Europe/Zurich." });
  }
  const id = randomUUID();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO departments (id, installation_id, name, time_zone, enabled_modules)
       SELECT $1,installation.id,$3,$4,COALESCE(array_agg(module.module_id ORDER BY module.module_id) FILTER (WHERE module.module_id IS NOT NULL), ARRAY['file-storage','notifications']::TEXT[])
         FROM installations AS installation
         LEFT JOIN installation_modules AS module
           ON module.installation_id=installation.id AND module.client_managed=TRUE AND module.enabled=TRUE
        WHERE installation.id=$2
        GROUP BY installation.id
       RETURNING id,name,time_zone,enabled_modules`,
      [id, installationId, location, timeZone],
    );
    const redundancyTable = await client.query<{ table_name: string | null }>("SELECT to_regclass('public.sync_site_redundancy')::text AS table_name");
    if (redundancyTable.rows[0]?.table_name) {
      await client.query(
        `INSERT INTO sync_site_redundancy(department_id,role,primary_installation_id)
         SELECT id,'primary',installation_id FROM departments WHERE id=$1
         ON CONFLICT(department_id) DO NOTHING`,
        [id],
      );
    }
    await client.query(
      "INSERT INTO department_memberships (user_id, department_id, role) VALUES ($1, $2, 'site_admin')",
      [request.authenticatedUser!.id, id],
    );
    await client.query("COMMIT");
    const row = result.rows[0];
    return reply.code(201).send({ id: row.id, location: row.name, timeZone: row.time_zone, role: "site_admin", enabledModules: row.enabled_modules, videoPermissions: [] });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

app.get("/api/department", async (request, reply): Promise<DepartmentProfile | { error: string }> => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "Configure DATABASE_URL to load department settings." });
  let selectedDepartmentId: string | null;
  if (hasServerPermission(request, "server_manage")) {
    const header = request.headers["x-department-id"];
    selectedDepartmentId = typeof header === "string" ? header : departmentId;
    if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(selectedDepartmentId)) {
      return reply.code(400).send({ error: "Choose a valid location." });
    }
  } else {
    selectedDepartmentId = await activeDepartmentId(request, reply);
    if (!selectedDepartmentId) return reply;
  }
  const result = await pool.query(
    `SELECT d.id, d.name, d.time_zone, d.enabled_modules, m.role,
            m.permissions, m.video_permissions, m.presenter_permissions, m.module_permissions
       FROM departments d
       LEFT JOIN department_memberships m ON m.department_id = d.id AND m.user_id = $2
      WHERE d.id = $1 AND ($3::boolean OR m.user_id IS NOT NULL)`,
    [selectedDepartmentId, request.authenticatedUser?.id, hasServerPermission(request, "server_manage")],
  );
  const row = result.rows[0];
  if (!row) return reply.code(404).send({ error: "The configured department could not be found." });
  return { id: row.id, location: row.name, timeZone: row.time_zone, role: row.role ?? "unassigned", enabledModules: row.enabled_modules, permissions: row.permissions ?? [], videoPermissions: row.video_permissions, presenterPermissions: row.presenter_permissions, modulePermissions: row.module_permissions ?? {} };
});

app.put<{ Body: UpdateDepartmentProfile }>("/api/department", {
  schema: {
    body: {
      type: "object",
      additionalProperties: false,
      required: ["location", "timeZone"],
      properties: {
        location: { type: "string", minLength: 1, maxLength: 120 },
        timeZone: { type: "string", minLength: 1, maxLength: 80 },
      },
    },
  },
}, async (request, reply): Promise<DepartmentProfile | { error: string }> => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "Configure DATABASE_URL to save department settings." });
  const selectedDepartmentId = await activeDepartmentId(request, reply, true);
  if (!selectedDepartmentId) return reply;
  const location = request.body.location.trim();
  const timeZone = request.body.timeZone.trim();
  if (!location || !timeZone) return reply.code(400).send({ error: "Location and time zone are required." });
  try {
    new Intl.DateTimeFormat("en", { timeZone });
  } catch {
    return reply.code(400).send({ error: "Choose a valid time zone, such as Europe/Zurich." });
  }
  const result = await pool.query(
    `UPDATE departments SET name = $2, time_zone = $3, updated_at = now()
      WHERE id = $1 RETURNING id, name, time_zone, enabled_modules`,
    [selectedDepartmentId, location, timeZone],
  );
  const row = result.rows[0];
  if (!row) return reply.code(404).send({ error: "The configured department could not be found." });
  return { id: row.id, location: row.name, timeZone: row.time_zone, role: "site_admin", enabledModules: row.enabled_modules };
});

app.get("/api/branding", async (_request, reply): Promise<{ logoDataUrl: string | null } | { error: string }> => {
  if (!databaseReady || !pool) {
    return reply.code(503).send({ error: "Configure DATABASE_URL to save site branding." });
  }

  const result = await pool.query("SELECT logo_mime_type, logo_data FROM installation_branding WHERE id = 1");
  const row = result.rows[0];
  return {
    logoDataUrl: row?.logo_data && row.logo_mime_type
      ? `data:${row.logo_mime_type};base64,${Buffer.from(row.logo_data).toString("base64")}`
      : null,
  };
});

app.put<{ Body: { logoDataUrl: string | null } }>("/api/branding", {
  schema: {
    body: {
      type: "object",
      additionalProperties: false,
      required: ["logoDataUrl"],
      properties: { logoDataUrl: { type: "string", nullable: true, maxLength: 2_800_000 } },
    },
  },
}, async (request, reply): Promise<{ logoDataUrl: string | null } | { error: string }> => {
  if (!databaseReady || !pool) {
    return reply.code(503).send({ error: "Configure DATABASE_URL to save site branding." });
  }
  if (!requireServerPermission(request, reply, "server_manage")) return reply;

  let mimeType: "image/png" | "image/jpeg" | "image/webp" | null = null;
  let imageData: Buffer | null = null;
  const useDefaultLogo = request.body.logoDataUrl === null
    || request.body.logoDataUrl === "null";
  if (typeof request.body.logoDataUrl === "string" && !useDefaultLogo) {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(request.body.logoDataUrl);
    if (!match) return reply.code(400).send({ error: "Use a PNG, JPEG, or WebP logo image." });

    mimeType = match[1] as "image/png" | "image/jpeg" | "image/webp";
    imageData = Buffer.from(match[2], "base64");
    const validImage = mimeType === "image/png"
      ? imageData.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : mimeType === "image/jpeg"
        ? imageData.length >= 3 && imageData[0] === 0xff && imageData[1] === 0xd8 && imageData[2] === 0xff
        : imageData.length >= 12 && imageData.toString("ascii", 0, 4) === "RIFF" && imageData.toString("ascii", 8, 12) === "WEBP";
    if (!validImage || imageData.length === 0 || imageData.length > 2 * 1024 * 1024) {
      return reply.code(400).send({ error: "The logo must be a valid PNG, JPEG, or WebP image under 2 MB." });
    }
  }

  await pool.query(
    `INSERT INTO installation_branding (id, logo_mime_type, logo_data)
     VALUES (1, $1, $2)
     ON CONFLICT (id) DO UPDATE
       SET logo_mime_type = EXCLUDED.logo_mime_type, logo_data = EXCLUDED.logo_data, updated_at = now()`,
    [mimeType, imageData],
  );
  return { logoDataUrl: useDefaultLogo ? null : request.body.logoDataUrl };
});

app.get("/api/contacts", async (request, reply): Promise<Contact[] | { error: string }> => {
  if (!databaseReady || !pool) {
    return reply.code(503).send({ error: "Configure DATABASE_URL to enable saved contacts." });
  }
  const selectedDepartmentId = await activeDepartmentId(request, reply);
  if (!selectedDepartmentId) return reply;

  const result = await pool.query(
    `SELECT id, first_name, last_name, email, phone, status, source_system, elvanto_profile
       FROM contacts
      WHERE department_id = $1
      ORDER BY created_at DESC, last_name, first_name`,
    [selectedDepartmentId],
  );
  const canViewPrivatePeople = request.activeDepartmentRole === "site_admin" || (request.activeDepartmentPermissions ?? []).includes("people_view_private") || (request.activeDepartmentPermissions ?? []).includes("people_manage");
  return result.rows.map((row) => ({
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    ...(canViewPrivatePeople && row.email ? { email: row.email } : {}),
    ...(canViewPrivatePeople && row.phone ? { phone: row.phone } : {}),
    status: row.status,
    ...(row.source_system === "churchtools" ? { importedFrom: "churchtools" as const } : row.source_system === "elvanto" ? { importedFrom: "elvanto" as const } : {}),
    ...(canViewPrivatePeople && row.source_system === "elvanto" && row.elvanto_profile && Object.keys(row.elvanto_profile).length ? { elvantoProfile: row.elvanto_profile as Record<string, unknown> } : {}),
  }));
});

app.post<{ Body: CreateContact }>("/api/contacts", {
  schema: {
    body: {
      type: "object",
      additionalProperties: false,
      required: ["firstName", "lastName", "status"],
      properties: {
        firstName: { type: "string", minLength: 1, maxLength: 80 },
        lastName: { type: "string", minLength: 1, maxLength: 80 },
        email: { type: "string", maxLength: 254, pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$" },
        phone: { type: "string", maxLength: 40 },
        status: { type: "string", enum: ["member", "visitor"] },
      },
    },
  },
}, async (request, reply): Promise<Contact | { error: string }> => {
  if (!databaseReady || !pool) {
    return reply.code(503).send({ error: "Configure DATABASE_URL to enable saved contacts." });
  }
  const selectedDepartmentId = await activeDepartmentId(request, reply, false, false, "people_manage");
  if (!selectedDepartmentId) return reply;

  const firstName = request.body.firstName.trim();
  const lastName = request.body.lastName.trim();
  const email = request.body.email?.trim() || null;
  const phone = request.body.phone?.trim() || null;
  if (!firstName || !lastName) return reply.code(400).send({ error: "First and last name are required." });

  const result = await pool.query(
    `INSERT INTO contacts (id, department_id, first_name, last_name, email, phone, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, first_name, last_name, email, phone, status`,
    [randomUUID(), selectedDepartmentId, firstName, lastName, email, phone, request.body.status],
  );
  const row = result.rows[0];
  return reply.code(201).send({
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    ...(row.email ? { email: row.email } : {}),
    ...(row.phone ? { phone: row.phone } : {}),
    status: row.status,
  });
});

app.post<{ Body: { contacts: CreateContact[] } }>("/api/contacts/import", {
  schema: {
    body: {
      type: "object", additionalProperties: false, required: ["contacts"],
      properties: {
        contacts: {
          type: "array", minItems: 1, maxItems: 1000,
          items: {
            type: "object", additionalProperties: false, required: ["firstName", "lastName", "status"],
            properties: {
              firstName: { type: "string", minLength: 1, maxLength: 80 }, lastName: { type: "string", minLength: 1, maxLength: 80 },
              email: { type: "string", maxLength: 254, pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$" }, phone: { type: "string", maxLength: 40 },
              status: { type: "string", enum: ["member", "visitor"] },
            },
          },
        },
      },
    },
  },
}, async (request, reply): Promise<Contact[] | { error: string }> => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "Configure DATABASE_URL to enable saved contacts." });
  const selectedDepartmentId = await activeDepartmentId(request, reply, false, false, "people_manage");
  if (!selectedDepartmentId) return reply;
  const client = await pool.connect();
  const contacts: Contact[] = [];
  try {
    await client.query("BEGIN");
    for (const item of request.body.contacts) {
      const firstName = item.firstName.trim();
      const lastName = item.lastName.trim();
      if (!firstName || !lastName) throw new Error("Each imported person needs a first and last name.");
      const result = await client.query(
        `INSERT INTO contacts (id, department_id, first_name, last_name, email, phone, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, first_name, last_name, email, phone, status`,
        [randomUUID(), selectedDepartmentId, firstName, lastName, item.email?.trim() || null, item.phone?.trim() || null, item.status],
      );
      const row = result.rows[0];
      contacts.push({ id: row.id, firstName: row.first_name, lastName: row.last_name, ...(row.email ? { email: row.email } : {}), ...(row.phone ? { phone: row.phone } : {}), status: row.status });
    }
    await client.query("COMMIT");
    return reply.code(201).send(contacts);
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof Error && error.message === "Each imported person needs a first and last name.") return reply.code(400).send({ error: error.message });
    throw error;
  } finally { client.release(); }
});

app.put<{ Params: { id: string }; Body: CreateContact }>("/api/contacts/:id", {
  schema: {
    params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
    body: {
      type: "object", additionalProperties: false, required: ["firstName", "lastName", "status"],
      properties: {
        firstName: { type: "string", minLength: 1, maxLength: 80 }, lastName: { type: "string", minLength: 1, maxLength: 80 },
        email: { type: "string", maxLength: 254, pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$" }, phone: { type: "string", maxLength: 40 },
        status: { type: "string", enum: ["member", "visitor"] },
      },
    },
  },
}, async (request, reply): Promise<Contact | { error: string }> => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "Configure DATABASE_URL to enable saved contacts." });
  const selectedDepartmentId = await activeDepartmentId(request, reply, false, false, "people_manage");
  if (!selectedDepartmentId) return reply;

  const existing = await pool.query("SELECT source_system FROM contacts WHERE id=$1 AND department_id=$2", [request.params.id, selectedDepartmentId]);
  if (!existing.rowCount) return reply.code(404).send({ error: "Person not found." });
  if (existing.rows[0].source_system === "churchtools" || existing.rows[0].source_system === "elvanto") return reply.code(403).send({ error: `This person is managed by ${existing.rows[0].source_system === "churchtools" ? "ChurchTools" : "Elvanto"}. Edit them there and sync again.` });
  const firstName = request.body.firstName.trim();
  const lastName = request.body.lastName.trim();
  if (!firstName || !lastName) return reply.code(400).send({ error: "First and last name are required." });
  const result = await pool.query(
    `UPDATE contacts SET first_name = $3, last_name = $4, email = $5, phone = $6, status = $7, updated_at = now()
      WHERE id = $1 AND department_id = $2 RETURNING id, first_name, last_name, email, phone, status`,
    [request.params.id, selectedDepartmentId, firstName, lastName, request.body.email?.trim() || null, request.body.phone?.trim() || null, request.body.status],
  );
  const row = result.rows[0];
  if (!row) return reply.code(404).send({ error: "This person could not be found." });
  return { id: row.id, firstName: row.first_name, lastName: row.last_name, ...(row.email ? { email: row.email } : {}), ...(row.phone ? { phone: row.phone } : {}), status: row.status };
});

app.delete<{ Params: { id: string } }>("/api/contacts/:id", {
  schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } },
}, async (request, reply): Promise<{ deleted: true } | { error: string }> => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "Configure DATABASE_URL to enable saved contacts." });
  const selectedDepartmentId = await activeDepartmentId(request, reply, false, false, "people_manage");
  if (!selectedDepartmentId) return reply;

  const existing = await pool.query("SELECT source_system FROM contacts WHERE id=$1 AND department_id=$2", [request.params.id, selectedDepartmentId]);
  if (!existing.rowCount) return reply.code(404).send({ error: "Person not found." });
  if (existing.rows[0].source_system === "churchtools" || existing.rows[0].source_system === "elvanto") return reply.code(403).send({ error: `This person is managed by ${existing.rows[0].source_system === "churchtools" ? "ChurchTools" : "Elvanto"}. Remove them there and sync again.` });
  const result = await pool.query("DELETE FROM contacts WHERE id = $1 AND department_id = $2 RETURNING id", [request.params.id, selectedDepartmentId]);
  if (!result.rowCount) return reply.code(404).send({ error: "This person could not be found." });
  return { deleted: true };
});

app.get("/api/events", async (request, reply): Promise<ServiceEvent[] | { error: string }> => {
  if (!databaseReady || !pool) {
    return reply.code(503).send({ error: "Configure DATABASE_URL to enable saved services and events." });
  }
  const selectedDepartmentId = await activeDepartmentId(request, reply);
  if (!selectedDepartmentId) return reply;
  const result = await pool.query<ServiceEventRow>(
    `SELECT id, title, kind, event_date::text, is_all_day, to_char(start_time, 'HH24:MI') AS start_time,
            CASE WHEN end_time IS NULL THEN NULL ELSE to_char(end_time, 'HH24:MI') END AS end_time,
            location, description, room, asset_ids, positions, time_plan, attendance_adults, attendance_children, attendance_recorded_at, recurrence_id, source_system,
            registration_enabled, registration_capacity, registration_token,
            (SELECT count(*)::int FROM event_registrations registration WHERE registration.event_id=service_events.id AND registration.status='registered') AS registration_count
       FROM service_events
      WHERE department_id = $1
      ORDER BY event_date, start_time, title`,
    [selectedDepartmentId],
  );
  const responseRows = result.rows.length ? await pool.query<{ event_id: string; position_index: number; contact_id: string; status: "pending" | "accepted" | "declined" }>(
    "SELECT event_id,position_index,contact_id,status FROM event_position_responses WHERE event_id=ANY($1::uuid[])", [result.rows.map((row) => row.id)],
  ) : { rows: [] };
  const linkedContact = await pool.query<{ contact_id: string | null }>("SELECT contact_id FROM department_memberships WHERE user_id=$1 AND department_id=$2", [request.authenticatedUser?.id, selectedDepartmentId]);
  const currentContactId = linkedContact.rows[0]?.contact_id ?? null;
  const responsesByPosition = new Map(responseRows.rows.map((row) => [`${row.event_id}:${row.position_index}`, row]));
  return result.rows.map((row) => {
    const event = mapServiceEvent(row);
    const canManageRegistrations = request.activeDepartmentRole === "site_admin" || (request.activeDepartmentPermissions ?? []).includes("events_manage");
    const visibleEvent = canManageRegistrations ? event : (({ registrationToken: _registrationToken, ...safeEvent }) => safeEvent)(event);
    return {
      ...visibleEvent,
      positions: (visibleEvent.positions ?? []).map((position, index) => {
        const response = responsesByPosition.get(`${event.id}:${index}`);
        const assignedToCurrentUser = Boolean(currentContactId && position.contactId === currentContactId);
        return { ...position, responseStatus: response?.status ?? (position.contactId ? "pending" : undefined), canRespond: assignedToCurrentUser };
      }),
    };
  });
});

app.post<{ Body: CreateServiceEvent }>("/api/events", {
  schema: { body: serviceEventBodySchema },
}, async (request, reply): Promise<ServiceEvent | { seriesId: string; events: ServiceEvent[] } | { error: string }> => {
  if (!databaseReady || !pool) {
    return reply.code(503).send({ error: "Configure DATABASE_URL to enable saved services and events." });
  }
  const selectedDepartmentId = await activeDepartmentId(request, reply, false, false, "events_manage");
  if (!selectedDepartmentId) return reply;
  const event = {
    ...request.body,
    title: request.body.title.trim(),
    location: request.body.location.trim(),
    endTime: request.body.endTime?.trim() || undefined,
    description: request.body.description?.trim() || undefined,
  };
  const validationError = validateServiceEvent(event);
  if (validationError) return reply.code(400).send({ error: validationError });
  const assignmentError = await validateServiceAssignments(selectedDepartmentId, event);
  if (assignmentError) return reply.code(400).send({ error: assignmentError });

  const dates = event.recurrence ? recurrenceDates(event.eventDate, event.recurrence.endDate, event.recurrence.interval) : [event.eventDate];
  const seriesId = event.recurrence ? randomUUID() : null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const rows: ServiceEventRow[] = [];
    for (const date of dates) {
      const result = await client.query<ServiceEventRow>(
        `INSERT INTO service_events (id, department_id, title, kind, event_date, is_all_day, start_time, end_time, location, description, room, asset_ids, positions, time_plan, recurrence_id, registration_enabled, registration_capacity, registration_token)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15, $16, $17, $18)
         RETURNING id, title, kind, event_date::text, is_all_day, to_char(start_time, 'HH24:MI') AS start_time,
                   CASE WHEN end_time IS NULL THEN NULL ELSE to_char(end_time, 'HH24:MI') END AS end_time,
                   location, description, room, asset_ids, positions, time_plan, attendance_adults, attendance_children, attendance_recorded_at, recurrence_id,
                   registration_enabled, registration_capacity, registration_token, 0::int AS registration_count`,
        [randomUUID(), selectedDepartmentId, event.title, event.kind, date, event.isAllDay ?? false, event.isAllDay ? "00:00" : event.startTime, event.isAllDay ? null : event.endTime ?? null, event.location, event.description ?? null, event.room?.trim() ?? "", event.assetIds ?? [], JSON.stringify(event.positions ?? []), JSON.stringify(event.timePlan ?? []), seriesId, event.registrationEnabled ?? false, event.registrationCapacity ?? null, event.registrationEnabled ? randomUUID() : null],
      );
      rows.push(result.rows[0]);
      await syncEventPositionResponses(client, result.rows[0].id, event.positions);
    }
    await client.query("COMMIT");
    if (seriesId) return reply.code(201).send({ seriesId, events: rows.map(mapServiceEvent) });
    return reply.code(201).send(mapServiceEvent(rows[0]));
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
});

app.put<{ Params: { id: string }; Body: CreateServiceEvent }>("/api/events/:id", {
  schema: {
    params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
    body: serviceEventBodySchema,
  },
}, async (request, reply): Promise<ServiceEvent | { error: string }> => {
  if (!databaseReady || !pool) {
    return reply.code(503).send({ error: "Configure DATABASE_URL to enable saved services and events." });
  }
  const selectedDepartmentId = await activeDepartmentId(request, reply, false, false, "events_manage");
  if (!selectedDepartmentId) return reply;
  const existing = await pool.query("SELECT source_system FROM service_events WHERE id=$1 AND department_id=$2", [request.params.id, selectedDepartmentId]);
  if (!existing.rowCount) return reply.code(404).send({ error: "This event could not be found." });
  if (existing.rows[0].source_system === "churchtools" || existing.rows[0].source_system === "elvanto") return reply.code(403).send({ error: `This service is managed by ${existing.rows[0].source_system === "churchtools" ? "ChurchTools" : "Elvanto"}. Edit it there and sync again.` });
  const event = {
    ...request.body,
    title: request.body.title.trim(),
    location: request.body.location.trim(),
    endTime: request.body.endTime?.trim() || undefined,
    description: request.body.description?.trim() || undefined,
  };
  const validationError = validateServiceEvent(event);
  if (validationError) return reply.code(400).send({ error: validationError });
  const assignmentError = await validateServiceAssignments(selectedDepartmentId, event);
  if (assignmentError) return reply.code(400).send({ error: assignmentError });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const previousPositionsResult = await client.query<{ positions: ServiceEvent["positions"] }>(
      "SELECT positions FROM service_events WHERE id=$1 AND department_id=$2 FOR UPDATE",
      [request.params.id, selectedDepartmentId],
    );
    if (!previousPositionsResult.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "This event could not be found." }); }
    const result = await client.query<ServiceEventRow>(
    `UPDATE service_events
        SET title = $3, kind = $4, event_date = $5, is_all_day = $6, start_time = $7, end_time = $8,
            location = $9, description = $10, room = $11, asset_ids = $12, positions = $13::jsonb, time_plan = $14::jsonb,
            registration_enabled = $15, registration_capacity = $16,
            registration_token = CASE WHEN $15 THEN COALESCE(registration_token, $17::uuid) ELSE NULL END, updated_at = now()
      WHERE id = $1 AND department_id = $2
      RETURNING id, title, kind, event_date::text, is_all_day, to_char(start_time, 'HH24:MI') AS start_time,
                CASE WHEN end_time IS NULL THEN NULL ELSE to_char(end_time, 'HH24:MI') END AS end_time,
                location, description, room, asset_ids, positions, time_plan, attendance_adults, attendance_children, attendance_recorded_at, recurrence_id, source_system,
                registration_enabled, registration_capacity, registration_token,
                (SELECT count(*)::int FROM event_registrations registration WHERE registration.event_id=service_events.id AND registration.status='registered') AS registration_count`,
    [request.params.id, selectedDepartmentId, event.title, event.kind, event.eventDate, event.isAllDay ?? false, event.isAllDay ? "00:00" : event.startTime, event.isAllDay ? null : event.endTime ?? null, event.location, event.description ?? null, event.room?.trim() ?? "", event.assetIds ?? [], JSON.stringify(event.positions ?? []), JSON.stringify(event.timePlan ?? []), event.registrationEnabled ?? false, event.registrationCapacity ?? null, event.registrationEnabled ? randomUUID() : null],
  );
    if (!result.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "This event could not be found." }); }
    await syncEventPositionResponses(client, request.params.id, event.positions, previousPositionsResult.rows[0].positions);
    await client.query("COMMIT");
    return mapServiceEvent(result.rows[0]);
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
});

app.put<{ Params: { id: string }; Body: CreateServiceEvent }>("/api/events/:id/series", {
  schema: {
    params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
    body: { ...serviceEventBodySchema, properties: Object.fromEntries(Object.entries(serviceEventProperties).filter(([key]) => key !== "recurrence")) },
  },
}, async (request, reply): Promise<ServiceEvent[] | { error: string }> => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "Configure DATABASE_URL to enable saved services and events." });
  const selectedDepartmentId = await activeDepartmentId(request, reply, false, false, "events_manage");
  if (!selectedDepartmentId) return reply;
  const source = await pool.query<{ recurrence_id: string | null; source_system: string | null; event_date: string }>("SELECT recurrence_id,source_system,event_date::text FROM service_events WHERE id=$1 AND department_id=$2", [request.params.id, selectedDepartmentId]);
  if (!source.rowCount) return reply.code(404).send({ error: "This event could not be found." });
  if (source.rows[0].source_system === "churchtools" || source.rows[0].source_system === "elvanto") return reply.code(403).send({ error: `This service is managed by ${source.rows[0].source_system === "churchtools" ? "ChurchTools" : "Elvanto"}. Edit it there and sync again.` });
  if (!source.rows[0].recurrence_id) return reply.code(400).send({ error: "This gathering is not part of a recurring series." });
  const event = { ...request.body, title: request.body.title.trim(), location: request.body.location.trim(), endTime: request.body.endTime?.trim() || undefined, description: request.body.description?.trim() || undefined };
  const validationError = validateServiceEvent({ ...event, recurrence: undefined });
  if (validationError) return reply.code(400).send({ error: validationError });
  const assignmentError = await validateServiceAssignments(selectedDepartmentId, event);
  if (assignmentError) return reply.code(400).send({ error: assignmentError });
  const dayDelta = Math.round((Date.parse(`${event.eventDate}T00:00:00Z`) - Date.parse(`${source.rows[0].event_date}T00:00:00Z`)) / 86400000);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const previousSeries = await client.query<{ id: string; positions: ServiceEvent["positions"] }>(
      "SELECT id,positions FROM service_events WHERE department_id=$1 AND recurrence_id=$2 FOR UPDATE",
      [selectedDepartmentId, source.rows[0].recurrence_id],
    );
    const result = await client.query<ServiceEventRow>(
    `UPDATE service_events SET event_date=event_date + $3::integer, title=$4, kind=$5, is_all_day=$6, start_time=$7, end_time=$8,
       location=$9, description=$10, room=$11, asset_ids=$12, positions=$13::jsonb, time_plan=$14::jsonb,
       registration_enabled=$15, registration_capacity=$16,
       registration_token=CASE WHEN $15 THEN COALESCE(registration_token, gen_random_uuid()) ELSE NULL END, updated_at=now()
     WHERE department_id=$1 AND recurrence_id=$2
     RETURNING id,title,kind,event_date::text,is_all_day,to_char(start_time,'HH24:MI') AS start_time,
       CASE WHEN end_time IS NULL THEN NULL ELSE to_char(end_time,'HH24:MI') END AS end_time,
       location,description,room,asset_ids,positions,time_plan,attendance_adults,attendance_children,attendance_recorded_at,recurrence_id,source_system,
       registration_enabled,registration_capacity,registration_token,
       (SELECT count(*)::int FROM event_registrations registration WHERE registration.event_id=service_events.id AND registration.status='registered') AS registration_count`,
    [selectedDepartmentId, source.rows[0].recurrence_id, dayDelta, event.title, event.kind, event.isAllDay ?? false, event.isAllDay ? "00:00" : event.startTime, event.isAllDay ? null : event.endTime ?? null, event.location, event.description ?? null, event.room?.trim() ?? "", event.assetIds ?? [], JSON.stringify(event.positions ?? []), JSON.stringify(event.timePlan ?? []), event.registrationEnabled ?? false, event.registrationCapacity ?? null],
  );
    const previousPositionsByEvent = new Map(previousSeries.rows.map((row) => [row.id, row.positions]));
    for (const row of result.rows) await syncEventPositionResponses(client, row.id, event.positions, previousPositionsByEvent.get(row.id));
    await client.query("COMMIT");
    return result.rows.map(mapServiceEvent);
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
});

app.delete<{ Params: { id: string } }>("/api/events/:id/series", {
  schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } },
}, async (request, reply): Promise<{ deleted: number } | { error: string }> => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "Configure DATABASE_URL to enable saved services and events." });
  const selectedDepartmentId = await activeDepartmentId(request, reply, false, false, "events_manage");
  if (!selectedDepartmentId) return reply;
  const existing = await pool.query<{ recurrence_id: string | null; source_system: string | null }>("SELECT recurrence_id,source_system FROM service_events WHERE id=$1 AND department_id=$2", [request.params.id, selectedDepartmentId]);
  if (!existing.rowCount) return reply.code(404).send({ error: "This event could not be found." });
  if (existing.rows[0].source_system === "churchtools" || existing.rows[0].source_system === "elvanto") return reply.code(403).send({ error: `This service is managed by ${existing.rows[0].source_system === "churchtools" ? "ChurchTools" : "Elvanto"}. Remove it there and sync again.` });
  if (!existing.rows[0].recurrence_id) return reply.code(400).send({ error: "This gathering is not part of a recurring series." });
  const result = await pool.query("DELETE FROM service_events WHERE department_id=$1 AND recurrence_id=$2 RETURNING id", [selectedDepartmentId, existing.rows[0].recurrence_id]);
  return { deleted: result.rowCount ?? 0 };
});

app.put<{ Params: { id: string; positionIndex: string }; Body: { status: "pending" | "accepted" | "declined" } }>("/api/events/:id/positions/:positionIndex/response", {
  schema: {
    params: { type: "object", required: ["id", "positionIndex"], properties: { id: { type: "string", format: "uuid" }, positionIndex: { type: "string", pattern: "^(0|[1-9]\\d*)$" } } },
    body: { type: "object", additionalProperties: false, required: ["status"], properties: { status: { type: "string", enum: ["pending", "accepted", "declined"] } } },
  },
}, async (request, reply): Promise<{ status: string } | { error: string }> => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "The schedule database is unavailable." });
  const selectedDepartmentId = await activeDepartmentId(request, reply);
  if (!selectedDepartmentId) return reply;
  const linkedContact = await pool.query<{ contact_id: string | null }>("SELECT contact_id FROM department_memberships WHERE user_id=$1 AND department_id=$2", [request.authenticatedUser?.id, selectedDepartmentId]);
  const contactId = linkedContact.rows[0]?.contact_id;
  if (!contactId) return reply.code(409).send({ error: "Link your location membership to your person record before responding to service requests." });
  const positionIndex = Number(request.params.positionIndex);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const eventResult = await client.query<{ positions: ServiceEvent["positions"]; source_system: string | null }>("SELECT positions,source_system FROM service_events WHERE id=$1 AND department_id=$2 FOR UPDATE", [request.params.id, selectedDepartmentId]);
    if (!eventResult.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "This gathering could not be found." }); }
    if (eventResult.rows[0].source_system === "churchtools" || eventResult.rows[0].source_system === "elvanto") { await client.query("ROLLBACK"); return reply.code(403).send({ error: "Imported service assignments are read-only." }); }
    const position = eventResult.rows[0].positions?.[positionIndex];
    if (!position || position.contactId !== contactId) { await client.query("ROLLBACK"); return reply.code(403).send({ error: "You are not assigned to this service position." }); }
    const result = await client.query<{ status: string }>(
      `INSERT INTO event_position_responses (event_id,position_index,contact_id,status,responded_at)
       VALUES ($1,$2,$3,$4,CASE WHEN $4='pending' THEN NULL ELSE now() END)
       ON CONFLICT (event_id,position_index) DO UPDATE SET status=EXCLUDED.status,responded_at=EXCLUDED.responded_at,updated_at=now()
       WHERE event_position_responses.contact_id=EXCLUDED.contact_id
       RETURNING status`,
      [request.params.id, positionIndex, contactId, request.body.status],
    );
    if (!result.rowCount) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "This position assignment has changed. Refresh the schedule and try again." }); }
    await client.query("COMMIT");
    return { status: result.rows[0].status };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
});

app.put<{ Params: { id: string }; Body: { adults: number; children: number } }>("/api/events/:id/attendance", {
  schema: {
    params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
    body: { type: "object", additionalProperties: false, required: ["adults", "children"], properties: { adults: { type: "integer", minimum: 0, maximum: 100000 }, children: { type: "integer", minimum: 0, maximum: 100000 } } },
  },
}, async (request, reply): Promise<{ attendanceAdults: number; attendanceChildren: number; attendanceRecordedAt: string } | { error: string }> => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "The schedule database is unavailable." });
  const selectedDepartmentId = await activeDepartmentId(request, reply, false, false, "events_manage");
  if (!selectedDepartmentId) return reply;
  const result = await pool.query<{ attendance_adults: number; attendance_children: number; attendance_recorded_at: string }>(
    `UPDATE service_events SET attendance_adults=$3, attendance_children=$4, attendance_recorded_at=now(), updated_at=now()
      WHERE id=$1 AND department_id=$2 AND (source_system IS NULL OR source_system NOT IN ('churchtools','elvanto'))
      RETURNING attendance_adults, attendance_children, attendance_recorded_at`,
    [request.params.id, selectedDepartmentId, request.body.adults, request.body.children],
  );
  if (!result.rowCount) return reply.code(404).send({ error: "This gathering could not be found or is managed by an external service." });
  return { attendanceAdults: result.rows[0].attendance_adults, attendanceChildren: result.rows[0].attendance_children, attendanceRecordedAt: result.rows[0].attendance_recorded_at };
});

app.get<{ Params: { id: string } }>("/api/events/:id/check-ins", {
  schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } },
}, async (request, reply): Promise<ServiceEventCheckIn[] | { error: string }> => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "The schedule database is unavailable." });
  const selectedDepartmentId = await activeDepartmentId(request, reply, false, false, "events_manage");
  if (!selectedDepartmentId) return reply;
  const event = await pool.query("SELECT id FROM service_events WHERE id=$1 AND department_id=$2 AND (source_system IS NULL OR source_system NOT IN ('churchtools','elvanto'))", [request.params.id, selectedDepartmentId]);
  if (!event.rowCount) return reply.code(404).send({ error: "This locally managed gathering could not be found." });
  const result = await pool.query<ServiceEventCheckIn>(
    `SELECT checkin.contact_id AS "contactId", checkin.first_time_visitor AS "firstTimeVisitor", checkin.follow_up_status AS "followUpStatus", checkin.checked_in_at AS "checkedInAt"
       FROM event_attendance_checkins checkin
       JOIN contacts person ON person.id=checkin.contact_id
       JOIN service_events gathering ON gathering.id=checkin.event_id
      WHERE checkin.event_id=$1 AND person.department_id=$2 AND gathering.department_id=$2
      ORDER BY checked_in_at, contact_id`,
    [request.params.id, selectedDepartmentId],
  );
  return result.rows;
});

app.put<{ Params: { id: string }; Body: { contactId: string; firstTimeVisitor?: boolean; followUpStatus?: "not_needed" | "needed" | "done" } }>("/api/events/:id/check-ins", {
  schema: {
    params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
    body: { type: "object", additionalProperties: false, required: ["contactId"], properties: { contactId: { type: "string", format: "uuid" }, firstTimeVisitor: { type: "boolean" }, followUpStatus: { type: "string", enum: ["not_needed", "needed", "done"] } } },
  },
}, async (request, reply): Promise<ServiceEventCheckIn | { error: string }> => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "The schedule database is unavailable." });
  const selectedDepartmentId = await activeDepartmentId(request, reply, false, false, "events_manage");
  if (!selectedDepartmentId) return reply;
  const result = await pool.query<ServiceEventCheckIn>(
    `INSERT INTO event_attendance_checkins (event_id,contact_id,first_time_visitor,follow_up_status)
     SELECT gathering.id,person.id,$4,COALESCE($5,CASE WHEN $4 THEN 'needed' ELSE 'not_needed' END)
       FROM service_events gathering JOIN contacts person ON person.id=$2 AND person.department_id=gathering.department_id
      WHERE gathering.id=$1 AND gathering.department_id=$3 AND (gathering.source_system IS NULL OR gathering.source_system NOT IN ('churchtools','elvanto'))
     ON CONFLICT (event_id,contact_id) DO UPDATE SET first_time_visitor=EXCLUDED.first_time_visitor,follow_up_status=EXCLUDED.follow_up_status,updated_at=now()
     RETURNING contact_id AS "contactId",first_time_visitor AS "firstTimeVisitor",follow_up_status AS "followUpStatus",checked_in_at AS "checkedInAt"`,
    [request.params.id, request.body.contactId, selectedDepartmentId, request.body.firstTimeVisitor ?? false, request.body.followUpStatus ?? null],
  );
  if (!result.rowCount) return reply.code(404).send({ error: "The gathering or person could not be found in this location." });
  return result.rows[0];
});

app.delete<{ Params: { id: string; contactId: string } }>("/api/events/:id/check-ins/:contactId", {
  schema: { params: { type: "object", required: ["id", "contactId"], properties: { id: { type: "string", format: "uuid" }, contactId: { type: "string", format: "uuid" } } } },
}, async (request, reply): Promise<{ checkedIn: false } | { error: string }> => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "The schedule database is unavailable." });
  const selectedDepartmentId = await activeDepartmentId(request, reply, false, false, "events_manage");
  if (!selectedDepartmentId) return reply;
  const result = await pool.query(
    `DELETE FROM event_attendance_checkins checkin USING service_events gathering, contacts person
      WHERE checkin.event_id=gathering.id AND checkin.contact_id=person.id AND gathering.id=$1 AND person.id=$2
        AND gathering.department_id=$3 AND person.department_id=$3 AND (gathering.source_system IS NULL OR gathering.source_system NOT IN ('churchtools','elvanto'))`,
    [request.params.id, request.params.contactId, selectedDepartmentId],
  );
  if (!result.rowCount) return reply.code(404).send({ error: "This check-in could not be found in the selected location." });
  return { checkedIn: false };
});

app.get<{ Params: { token: string } }>("/api/public/event-registrations/:token", {
  schema: { params: { type: "object", required: ["token"], properties: { token: { type: "string", format: "uuid" } } } },
}, async (request, reply): Promise<PublicRegistrationEvent | { error: string }> => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "Event registration is temporarily unavailable." });
  const result = await pool.query<{
    title: string; event_date: string; is_all_day: boolean; start_time: string; end_time: string | null; location: string;
    description: string | null; registration_capacity: number | null; registered_count: number; waitlist_count: number; registration_open: boolean;
  }>(
    `SELECT title,event_date::text,is_all_day,to_char(start_time,'HH24:MI') AS start_time,
            CASE WHEN end_time IS NULL THEN NULL ELSE to_char(end_time,'HH24:MI') END AS end_time,
            location,description,registration_capacity,event_date>=CURRENT_DATE AS registration_open,
            (SELECT count(*)::int FROM event_registrations WHERE event_id=service_events.id AND status='registered') AS registered_count,
            (SELECT count(*)::int FROM event_registrations WHERE event_id=service_events.id AND status='waitlisted') AS waitlist_count
       FROM service_events WHERE registration_token=$1 AND registration_enabled=true`,
    [request.params.token],
  );
  if (!result.rowCount) return reply.code(404).send({ error: "This registration link is unavailable." });
  const row = result.rows[0];
  return {
    title: row.title, eventDate: row.event_date, isAllDay: row.is_all_day, startTime: row.start_time,
    ...(row.end_time ? { endTime: row.end_time } : {}), location: row.location,
    ...(row.description ? { description: row.description } : {}),
    ...(row.registration_capacity ? { capacity: row.registration_capacity } : {}),
    registeredCount: row.registered_count, waitlistCount: row.waitlist_count,
    registrationOpen: row.registration_open,
  };
});

app.post<{ Params: { token: string }; Body: { firstName: string; lastName: string; email: string } }>("/api/public/event-registrations/:token", {
  schema: {
    params: { type: "object", required: ["token"], properties: { token: { type: "string", format: "uuid" } } },
    body: { type: "object", additionalProperties: false, required: ["firstName", "lastName", "email"], properties: {
      firstName: { type: "string", minLength: 1, maxLength: 80 }, lastName: { type: "string", minLength: 1, maxLength: 80 }, email: { type: "string", minLength: 3, maxLength: 254, format: "email" },
    } },
  },
}, async (request, reply): Promise<{ status: "registered" | "waitlisted" } | { error: string }> => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "Event registration is temporarily unavailable." });
  const firstName = request.body.firstName.trim();
  const lastName = request.body.lastName.trim();
  const email = request.body.email.trim().toLocaleLowerCase();
  if (!firstName || !lastName || !email) return reply.code(400).send({ error: "Enter your name and email address." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const event = await client.query<{ id: string; department_id: string; registration_capacity: number | null }>(
      "SELECT id,department_id,registration_capacity FROM service_events WHERE registration_token=$1 AND registration_enabled=true AND event_date>=CURRENT_DATE FOR UPDATE", [request.params.token],
    );
    if (!event.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Registration is closed for this event." }); }
    if (!await lockDepartmentForWrite(client, event.rows[0].department_id)) { await client.query("ROLLBACK"); return reply.code(423).send({ error: "This event's location is read-only while it is a redundancy standby or fenced site." }); }
    const duplicate = await client.query("SELECT 1 FROM event_registrations WHERE event_id=$1 AND lower(email)=lower($2)", [event.rows[0].id, email]);
    if (duplicate.rowCount) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "This email address is already registered for the event." }); }
    const registered = await client.query<{ count: number }>("SELECT count(*)::int AS count FROM event_registrations WHERE event_id=$1 AND status='registered'", [event.rows[0].id]);
    const status = event.rows[0].registration_capacity !== null && registered.rows[0].count >= event.rows[0].registration_capacity ? "waitlisted" : "registered";
    await client.query(
      "INSERT INTO event_registrations (id,event_id,first_name,last_name,email,status) VALUES ($1,$2,$3,$4,$5,$6)",
      [randomUUID(), event.rows[0].id, firstName, lastName, email, status],
    );
    await client.query("COMMIT");
    return reply.code(201).send({ status });
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
});

app.get<{ Params: { id: string } }>("/api/events/:id/registrations", {
  schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } },
}, async (request, reply): Promise<EventRegistration[] | { error: string }> => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "The schedule database is unavailable." });
  const selectedDepartmentId = await activeDepartmentId(request, reply, false, false, "events_manage");
  if (!selectedDepartmentId) return reply;
  const result = await pool.query<EventRegistration>(
    `SELECT registration.id,registration.first_name AS "firstName",registration.last_name AS "lastName",registration.email,
            registration.status,registration.registered_at AS "registeredAt",registration.checked_in_at AS "checkedInAt"
       FROM event_registrations registration JOIN service_events gathering ON gathering.id=registration.event_id
      WHERE registration.event_id=$1 AND gathering.department_id=$2 ORDER BY registration.status,registration.registered_at,registration.last_name`,
    [request.params.id, selectedDepartmentId],
  );
  return result.rows;
});

app.put<{ Params: { id: string; registrationId: string }; Body: { checkedIn: boolean } }>("/api/events/:id/registrations/:registrationId/check-in", {
  schema: {
    params: { type: "object", required: ["id", "registrationId"], properties: { id: { type: "string", format: "uuid" }, registrationId: { type: "string", format: "uuid" } } },
    body: { type: "object", additionalProperties: false, required: ["checkedIn"], properties: { checkedIn: { type: "boolean" } } },
  },
}, async (request, reply): Promise<EventRegistration | { error: string }> => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "The schedule database is unavailable." });
  const selectedDepartmentId = await activeDepartmentId(request, reply, false, false, "events_manage");
  if (!selectedDepartmentId) return reply;
  const result = await pool.query<EventRegistration>(
    `UPDATE event_registrations registration SET checked_in_at=CASE WHEN $4 THEN COALESCE(checked_in_at,now()) ELSE NULL END
      FROM service_events gathering WHERE registration.id=$2 AND registration.event_id=$1 AND registration.status='registered' AND gathering.id=registration.event_id AND gathering.department_id=$3
      RETURNING registration.id,registration.first_name AS "firstName",registration.last_name AS "lastName",registration.email,
                registration.status,registration.registered_at AS "registeredAt",registration.checked_in_at AS "checkedInAt"`,
    [request.params.id, request.params.registrationId, selectedDepartmentId, request.body.checkedIn],
  );
  if (!result.rowCount) return reply.code(404).send({ error: "This registration could not be found." });
  return result.rows[0];
});

app.get("/api/visitor-follow-ups", async (request, reply): Promise<VisitorFollowUp[] | { error: string }> => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "The schedule database is unavailable." });
  const selectedDepartmentId = await activeDepartmentId(request, reply, false, false, "events_manage");
  if (!selectedDepartmentId) return reply;
  const result = await pool.query<VisitorFollowUp>(
    `SELECT checkin.event_id AS "eventId", visitor.id AS "contactId", visitor.first_name AS "firstName", visitor.last_name AS "lastName",
            gathering.title AS "eventTitle", gathering.event_date::text AS "eventDate", checkin.follow_up_status AS status,
            checkin.assigned_contact_id AS "assignedContactId", assigned.first_name AS "assignedFirstName", assigned.last_name AS "assignedLastName",
            checkin.follow_up_due_date::text AS "dueDate", checkin.follow_up_note AS note, checkin.checked_in_at AS "checkedInAt"
       FROM event_attendance_checkins checkin
       JOIN service_events gathering ON gathering.id=checkin.event_id
       JOIN contacts visitor ON visitor.id=checkin.contact_id
       LEFT JOIN contacts assigned ON assigned.id=checkin.assigned_contact_id AND assigned.department_id=$1
      WHERE gathering.department_id=$1 AND visitor.department_id=$1
        AND checkin.first_time_visitor=true AND checkin.follow_up_status IN ('needed','done')
      ORDER BY CASE WHEN checkin.follow_up_status='needed' THEN 0 ELSE 1 END,
               checkin.follow_up_due_date NULLS LAST, gathering.event_date DESC, visitor.last_name, visitor.first_name`,
    [selectedDepartmentId],
  );
  return result.rows;
});

app.put<{ Params: { id: string; contactId: string }; Body: { status: "needed" | "done" | "not_needed"; assignedContactId?: string | null; dueDate?: string | null; note: string } }>("/api/events/:id/check-ins/:contactId/follow-up", {
  schema: {
    params: { type: "object", required: ["id", "contactId"], properties: { id: { type: "string", format: "uuid" }, contactId: { type: "string", format: "uuid" } } },
    body: { type: "object", additionalProperties: false, required: ["status", "note"], properties: { status: { type: "string", enum: ["needed", "done", "not_needed"] }, assignedContactId: { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] }, dueDate: { anyOf: [{ type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }, { type: "null" }] }, note: { type: "string", maxLength: 1000 } } },
  },
}, async (request, reply): Promise<{ saved: true } | { error: string }> => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "The schedule database is unavailable." });
  const selectedDepartmentId = await activeDepartmentId(request, reply, false, false, "events_manage");
  if (!selectedDepartmentId) return reply;
  if (request.body.dueDate) {
    const [year, month, day] = request.body.dueDate.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.toISOString().slice(0, 10) !== request.body.dueDate) return reply.code(400).send({ error: "Choose a valid follow-up due date." });
  }
  if (request.body.assignedContactId) {
    const assignee = await pool.query("SELECT id FROM contacts WHERE id=$1 AND department_id=$2", [request.body.assignedContactId, selectedDepartmentId]);
    if (!assignee.rowCount) return reply.code(400).send({ error: "Choose a person from this location for the follow-up." });
  }
  const result = await pool.query(
    `UPDATE event_attendance_checkins checkin
        SET follow_up_status=$4, assigned_contact_id=$5, follow_up_due_date=$6, follow_up_note=$7, updated_at=now()
       FROM service_events gathering, contacts visitor
      WHERE checkin.event_id=gathering.id AND checkin.contact_id=visitor.id
        AND gathering.id=$1 AND visitor.id=$2 AND gathering.department_id=$3 AND visitor.department_id=$3
        AND checkin.first_time_visitor=true`,
    [request.params.id, request.params.contactId, selectedDepartmentId, request.body.status, request.body.assignedContactId ?? null, request.body.dueDate ?? null, request.body.note.trim()],
  );
  if (!result.rowCount) return reply.code(404).send({ error: "This visitor follow-up could not be found in the selected location." });
  return { saved: true };
});

app.delete<{ Params: { id: string } }>("/api/events/:id", {
  schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } },
}, async (request, reply): Promise<{ id: string } | { error: string }> => {
  if (!databaseReady || !pool) {
    return reply.code(503).send({ error: "Configure DATABASE_URL to enable saved services and events." });
  }
  const selectedDepartmentId = await activeDepartmentId(request, reply, false, false, "events_manage");
  if (!selectedDepartmentId) return reply;
  const existing = await pool.query("SELECT source_system FROM service_events WHERE id=$1 AND department_id=$2", [request.params.id, selectedDepartmentId]);
  if (!existing.rowCount) return reply.code(404).send({ error: "This event could not be found." });
  if (existing.rows[0].source_system === "churchtools" || existing.rows[0].source_system === "elvanto") return reply.code(403).send({ error: `This service is managed by ${existing.rows[0].source_system === "churchtools" ? "ChurchTools" : "Elvanto"}. Remove it there and sync again.` });
  const result = await pool.query("DELETE FROM service_events WHERE id = $1 AND department_id = $2 RETURNING id", [request.params.id, selectedDepartmentId]);
  if (!result.rowCount) return reply.code(404).send({ error: "This event could not be found." });
  return { id: result.rows[0].id };
});

app.addHook("onClose", async () => {
  removeVideoActivationListener?.();
  removeVideoActivationListener = null;
  await videoWorker?.close();
  await closeDatabase();
});

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "127.0.0.1";

try {
  if (process.env.NODE_ENV === "production") {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be set in production.");
    let publicOrigin: URL;
    try { publicOrigin = new URL(process.env.SMART_CHURCH_WEB_ORIGIN ?? ""); }
    catch { throw new Error("Set SMART_CHURCH_WEB_ORIGIN to the public Smart-Church origin."); }
    const expectedProtocol = directHttpMode ? "http:" : "https:";
    const originPort = publicOrigin.port || (publicOrigin.protocol === "http:" ? "80" : "443");
    const validDirectPort = !directHttpMode || originPort === String(directHttpPort);
    if (publicOrigin.protocol !== expectedProtocol || !validDirectPort || publicOrigin.origin !== process.env.SMART_CHURCH_WEB_ORIGIN || publicOrigin.pathname !== "/") {
      throw new Error(directHttpMode
        ? `Set SMART_CHURCH_WEB_ORIGIN to the direct HTTP origin, including port ${directHttpPort} (for example, http://church.example.org:${directHttpPort}).`
        : "Set SMART_CHURCH_WEB_ORIGIN to the public HTTPS origin (for example, https://church.example.org).");
    }
    if (!directHttpMode && !trustedProxyAddresses.length) {
      throw new Error("Set SMART_CHURCH_TRUST_PROXY to the address or CIDR of the trusted reverse proxy.");
    }
    if (host === "127.0.0.1" || host === "localhost") {
      throw new Error("Set HOST to the private container-network interface (usually 0.0.0.0) in production.");
    }
  }
  try {
    databaseReady = await initializeDatabase();
    if (databaseReady && pool) {
      const accessSettings = await pool.query<{ access_mode: HttpAccessMode }>(
        `SELECT settings.access_mode
           FROM installation_http_settings settings
           JOIN installations installation ON installation.id = settings.installation_id
          WHERE installation.is_current = TRUE`,
      );
      httpAccessMode = accessSettings.rows[0]?.access_mode ?? "none";
      await pool.query("DELETE FROM auth_sessions WHERE expires_at <= now()");
      const accounts = await pool.query("SELECT count(*)::int AS total FROM app_users");
      if (accounts.rows[0].total === 0) {
        firstRunSetupCode = randomBytes(18).toString("base64url");
        app.log.warn({ setupCode: firstRunSetupCode }, "Use this one-time code to create the first server administrator account.");
      }
    }
  } catch (error) {
    if (process.env.NODE_ENV === "production") throw error;
    app.log.error({ err: error }, "Database unavailable; department data will not be saved.");
  }
  if (!databaseReady) app.log.warn("Database is unavailable; department data will not be saved.");
  if (pool && databaseReady) registerCoreReplicationAdapter(pool);
  await registerServerModules(app, {
    realtime: {
      publish: (topic, selectedDepartmentId, payload) => realtime.publish(topic, selectedDepartmentId, payload),
      onMessage: (topic, handler) => realtime.onMessage(topic, handler),
    },
    workers: { register: (id, name, getDiagnostics) => registerRuntimeWorker(id, name, getDiagnostics) },
    pool: pool ?? null,
    isDatabaseReady: () => databaseReady,
    isDepartmentWritable,
    lockDepartmentForWrite,
    getDefaultDepartmentId: () => departmentId,
    resolveDepartmentId: activeDepartmentId,
    validateMutation: validModuleMutation,
    getVideoWorker: () => videoWorker,
    email: createEmailConnector(pool ?? null, () => databaseReady),
  });
  app.setNotFoundHandler(async (request, reply) => {
    if ((request.method !== "GET" && request.method !== "HEAD") || request.url === "/api" || request.url.startsWith("/api/")) {
      return reply.code(404).send({ error: "Not found." });
    }
    let pathname: string;
    try { pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname); }
    catch { return reply.code(400).send({ error: "Invalid path." }); }
    const requested = resolve(webRoot, `.${pathname}`);
    if (!requested.startsWith(`${webRoot}${sep}`) && requested !== webRoot) return reply.code(404).send({ error: "Not found." });
    let target = requested;
    try {
      const details = await stat(target);
      if (details.isDirectory()) target = resolve(target, "index.html");
      await stat(target);
    } catch {
      if (extname(pathname)) return reply.code(404).send({ error: "Not found." });
      target = resolve(webRoot, "index.html");
    }
    reply.type(webContentTypes.get(extname(target).toLowerCase()) ?? "application/octet-stream");
    reply.header("Cache-Control", target.includes(`${sep}assets${sep}`) ? "public, max-age=31536000, immutable" : "no-cache");
    if (request.method === "HEAD") return reply.code(200).send();
    return reply.send(createReadStream(target));
  });
  // Let module onReady hooks create their tables, then install the database
  // fence before binding the HTTP listener so no request can race startup.
  await app.ready();
  if (pool && databaseReady) await installSiteWriteFenceTriggers(pool);
  await app.listen({ host, port });
  const shutdown = () => { void app.close().catch((error) => { app.log.error({ err: error }, "Server shutdown failed."); process.exitCode = 1; }); };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  videoWorker = new VideoWorkerSupervisor(app.server, port, Boolean(process.env.STREAMING_CONFIG_FILE), (message) => recordRuntimeLog("api/video-steffisburg", "error", message));
  registerRuntimeWorker("video-steffisburg:worker", "Video Steffisburg", () => videoWorker?.diagnostics ?? { status: "starting", error: null, uptimeSeconds: null, memory: null }, () => videoWorker?.restart());
  removeVideoActivationListener = onServerModuleActivationChange("video-steffisburg", (enabled) => {
    if (enabled) videoWorker?.start();
    else videoWorker?.stop();
  });
  if (isServerModuleEnabled("video-steffisburg")) videoWorker.start();
  else videoWorker.stop();
} catch (error) {
  app.log.error(error);
  await closeDatabase();
  process.exit(1);
}
