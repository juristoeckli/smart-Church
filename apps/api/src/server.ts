import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";
import { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { AuthStatus, AuthenticatedUser, Contact, CreateAdminAccount, CreateContact, CreateDepartment, CreateServiceEvent, CreateSiteUser, DepartmentProfile, LocationPermission, LoginCredentials, ServiceEvent, SiteUser, UpdateDepartmentProfile, UserPhoneNumber, UserRelationshipInput, UserRelationshipKind } from "@smart-church/contracts";
import { closeDatabase, departmentId, departmentName, initializeDatabase, pool } from "./database.js";
import { VideoWorkerSupervisor } from "./modules/video-steffisburg/worker-supervisor.js";
import { registerServerModules } from "./modules/module-sdk.js";

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
const app = Fastify({
  logger: {
    redact: ["req.headers.cookie", "req.headers.authorization", "req.body.password", "req.body.setupCode", "req.body.loginToken"],
  },
  bodyLimit: 3 * 1024 * 1024,
  disableRequestLogging: true,
  trustProxy: trustedProxyAddresses.length ? trustedProxyAddresses : false,
});
let databaseReady = false;
let firstRunSetupCode: string | null = null;
const sessionCookieName = "smart_church_session";
function sessionCookieNameFor(request: FastifyRequest) {
  return allowHttpFallback && request.protocol === "http" ? `${sessionCookieName}_http` : sessionCookieName;
}
const sessionLifetimeSeconds = 24 * 60 * 60;
const failedLogins = new Map<string, { count: number; resetAt: number }>();
const maxFailedLoginBuckets = 10_000;
let videoWorker: VideoWorkerSupervisor | null = null;

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
    `SELECT u.id, u.email, u.username, u.display_name, u.role, u.must_change_password
       FROM auth_sessions s JOIN app_users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  const row = result.rows[0];
  return row ? { id: row.id, ...(row.email ? { email: row.email } : {}), username: row.username, displayName: row.display_name, role: row.role, mustChangePassword: row.must_change_password } : null;
}

function setupCodeMatches(candidate: string) {
  if (!firstRunSetupCode) return false;
  const expected = Buffer.from(firstRunSetupCode);
  const actual = Buffer.from(candidate);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
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

async function createSession(userId: string, request: FastifyRequest, reply: { header: (name: string, value: string) => unknown }, secure: boolean) {
  const token = randomBytes(32).toString("base64url");
  await pool!.query(
    `INSERT INTO auth_sessions (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + ($4 * interval '1 second'))`,
    [randomUUID(), userId, hashToken(token), sessionLifetimeSeconds],
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
  const allowedOrigin = isAllowedWebOrigin(request, origin.origin)
    || (!process.env.SMART_CHURCH_WEB_ORIGIN && origin.hostname === requestHost.hostname && origin.protocol === "http:" &&
      new Set([requestHost.port, "5173"]).has(origin.port));
  const expected = Buffer.from(moduleCsrfToken(sessionToken));
  const actual = Buffer.from(csrfHeader);
  if (!allowedOrigin || request.headers["sec-fetch-site"] === "cross-site" || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    reply.code(403).send({ error: "The module request origin or session token is not valid." });
    return false;
  }
  return true;
}

function isAllowedWebOrigin(request: FastifyRequest, origin: string) {
  const expectedOrigin = process.env.SMART_CHURCH_WEB_ORIGIN;
  if (!expectedOrigin) return false;
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

app.addHook("onRequest", async (request, reply) => {
  const httpFallbackRequest = allowHttpFallback && request.protocol === "http";
  if (process.env.NODE_ENV === "production" && !directHttpMode && !httpFallbackRequest && request.url !== "/api/health" && request.protocol !== "https") {
    return reply.code(400).send({ error: "Use HTTPS to access Smart-Church." });
  }
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
  if (request.url === "/api/health" || request.url.startsWith("/api/auth/")) return;
  if (request.url.startsWith("/api/modules/presenter/public/")) return;
  if (!databaseReady) return;
  const user = await currentUser(cookieValue(request.headers.cookie, sessionCookieNameFor(request)));
  if (!user) return reply.code(401).send({ error: "Sign in to continue." });
  request.authenticatedUser = user;
  reply.header("Cache-Control", "no-store");
  if (user.mustChangePassword) return reply.code(403).send({ error: "Change your password before continuing." });
});

type ServiceEventRow = {
  id: string;
  title: string;
  kind: ServiceEvent["kind"];
  event_date: string;
  start_time: string;
  end_time: string | null;
  location: string;
  description: string | null;
  room: string;
  asset_ids: string[];
  positions: CreateServiceEvent["positions"];
  time_plan: CreateServiceEvent["timePlan"];
  source_system?: string | null;
};

const serviceEventProperties = {
  title: { type: "string", minLength: 1, maxLength: 160 },
  kind: { type: "string", enum: ["service", "meeting", "community", "other"] },
  eventDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
  startTime: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
  endTime: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
  location: { type: "string", minLength: 1, maxLength: 160 },
  description: { type: "string", maxLength: 2000 },
  room: { type: "string", maxLength: 160 },
  assetIds: { type: "array", maxItems: 50, uniqueItems: true, items: { type: "string", format: "uuid" } },
  positions: { type: "array", maxItems: 40, items: { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string", minLength: 1, maxLength: 80 }, contactId: { type: "string", format: "uuid" } } } },
  timePlan: { type: "array", maxItems: 100, items: { type: "object", additionalProperties: false, required: ["title"], properties: { title: { type: "string", minLength: 1, maxLength: 160 }, startTime: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" }, durationMinutes: { type: "integer", minimum: 1, maximum: 1440 }, notes: { type: "string", maxLength: 500 } } } },
};
const serviceEventBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "kind", "eventDate", "startTime", "location"],
  properties: serviceEventProperties,
};

function mapServiceEvent(row: ServiceEventRow): ServiceEvent {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    eventDate: row.event_date,
    startTime: row.start_time.slice(0, 5),
    ...(row.end_time ? { endTime: row.end_time.slice(0, 5) } : {}),
    location: row.location,
    ...(row.description ? { description: row.description } : {}),
    room: row.room ?? "",
    assetIds: row.asset_ids ?? [],
    positions: row.positions ?? [],
    timePlan: row.time_plan ?? [],
    ...(row.source_system === "churchtools" ? { importedFrom: "churchtools" as const } : {}),
  };
}

function validateServiceEvent(event: CreateServiceEvent) {
  const [year, month, day] = event.eventDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return "Choose a valid event date.";
  }
  if (event.endTime && event.endTime <= event.startTime) return "The end time must be later than the start time.";
  if (!event.title.trim()) return "Enter an event title.";
  if (!event.location.trim()) return "Enter a location.";
  if ((event.positions ?? []).some((position) => !position.name.trim())) return "Each service position needs a name.";
  if ((event.timePlan ?? []).some((item) => !item.title.trim())) return "Each time plan item needs a title.";
  return null;
}

async function validateServiceAssignments(departmentId: string, event: CreateServiceEvent) {
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
  return null;
}

app.get("/api/health", async () => ({ status: databaseReady ? "ok" : "database_unavailable" }));

app.get("/api/auth/status", async (request, reply): Promise<AuthStatus | { error: string }> => {
  reply.header("Cache-Control", "no-store");
  if (!databaseReady || !pool) return reply.code(503).send({ error: "The account database is unavailable." });
  const user = await currentUser(cookieValue(request.headers.cookie, sessionCookieNameFor(request)));
  const count = await pool.query("SELECT count(*)::int AS total FROM app_users");
  return {
    setupRequired: count.rows[0].total === 0,
    authenticated: user !== null,
    ...(count.rows[0].total === 0 ? { setupLocation: departmentName } : {}),
    ...(user ? { csrfToken: moduleCsrfToken(cookieValue(request.headers.cookie, sessionCookieNameFor(request))!) } : {}),
    ...(user ? { user } : {}),
  };
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
      `INSERT INTO app_users (id, email, username, display_name, password_hash, role)
       VALUES ($1, $2, $3, $4, $5, 'server_admin') RETURNING id, email, username, display_name, role`,
      [randomUUID(), email, username, displayName, passwordHash],
    );
    const row = result.rows[0];
    user = { id: row.id, email: row.email, username: row.username, displayName: row.display_name, role: row.role, mustChangePassword: false };
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
    "SELECT id, email, username, display_name, password_hash, role FROM app_users WHERE lower(email) = $1 OR lower(username) = $1",
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
  const user: AuthenticatedUser = { id: row.id, ...(row.email ? { email: row.email } : {}), username: row.username, displayName: row.display_name, role: row.role, mustChangePassword: row.must_change_password };
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
    "UPDATE app_users SET password_hash = $2, must_change_password = false WHERE id = $1 RETURNING id, email, username, display_name, role",
    [user.id, hashPassword(request.body.password)],
  );
  const row = result.rows[0];
  if (!row) return reply.code(401).send({ error: "This account could not be found." });
  await pool.query("DELETE FROM auth_sessions WHERE user_id = $1", [user.id]);
  await createSession(user.id, request, reply, request.protocol === "https");
  return { user: { id: row.id, ...(row.email ? { email: row.email } : {}), username: row.username, displayName: row.display_name, role: row.role, mustChangePassword: false } };
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
  if (!requireServerAdmin(request, reply)) return reply;
  const result = await pool.query(
    `SELECT u.id, u.email, u.username, u.display_name, to_char(u.birthday, 'DD:MM:YYYY') AS birthday,
            u.street, u.street_number, u.postal_code, u.city, u.role AS account_role,
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
  return result.rows.map((row) => ({ id: row.id, ...(row.email ? { email: row.email } : {}), username: row.username, displayName: row.display_name, ...(row.birthday ? { birthday: row.birthday } : {}), ...(row.street ? { street: row.street } : {}), ...(row.street_number ? { streetNumber: row.street_number } : {}), ...(row.postal_code ? { postalCode: row.postal_code } : {}), ...(row.city ? { city: row.city } : {}), phoneNumbers: row.phone_numbers, relationships: row.relationships, accountRole: row.account_role, memberships: row.memberships }));
});

app.get("/api/people-options", async (request, reply) => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "The account database is unavailable." });
  if (!requireServerAdmin(request, reply)) return reply;
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
        memberships: {
          type: "array", maxItems: 100,
          items: { type: "object", additionalProperties: false, required: ["departmentId", "role"], properties: { departmentId: { type: "string", format: "uuid" }, role: { type: "string", enum: ["site_admin", "member"] }, contactId: { type: "string", format: "uuid" }, permissions: { type: "array", uniqueItems: true, items: { type: "string", enum: ["people_view_private", "people_manage", "events_manage", "groups_manage", "resources_manage"] } }, videoPermissions: { type: "array", uniqueItems: true, items: { type: "string", enum: ["video_basic", "streaming_operator", "stream_admin", "routing_user", "routing_admin"] } }, presenterPermissions: { type: "array", uniqueItems: true, items: { type: "string", enum: ["editor", "operator", "admin"] } }, modulePermissions: modulePermissionsSchema } },
        },
      },
    },
  },
}, async (request, reply): Promise<SiteUser | { error: string }> => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "The account database is unavailable." });
  if (!requireServerAdmin(request, reply)) return reply;
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
  const memberships = request.body.memberships;
  if (!displayName) return reply.code(400).send({ error: "Enter the user's name." });
  if (!validBirthday(birthday)) return reply.code(400).send({ error: "Enter a valid birthday as DD:MM:YYYY." });
  if (accountRole === "server_admin" && request.authenticatedUser?.role !== "server_admin") {
    return reply.code(403).send({ error: "Only a Server Administrator can grant Server Administrator access." });
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
    const user = await client.query(
      `INSERT INTO app_users (id, email, username, display_name, password_hash, role, birthday, street, street_number, postal_code, city)
       VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9, $10, $11)
       RETURNING id, email, username, display_name, to_char(birthday, 'DD:MM:YYYY') AS birthday, street, street_number, postal_code, city`,
      [id, email, username, displayName, hashPassword(request.body.password), accountRole, birthdayToIso(birthday), street, streetNumber, postalCode, city],
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
    return reply.code(201).send({ id: row.id, ...(row.email ? { email: row.email } : {}), username: row.username, displayName: row.display_name, ...(row.birthday ? { birthday: row.birthday } : {}), ...(row.street ? { street: row.street } : {}), ...(row.street_number ? { streetNumber: row.street_number } : {}), ...(row.postal_code ? { postalCode: row.postal_code } : {}), ...(row.city ? { city: row.city } : {}), phoneNumbers, relationships: await readUserRelationships(client, id), accountRole, memberships });
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") return reply.code(409).send({ error: "An account with this username or email already exists, or the selected person is already linked to another account." });
    if ((error as { code?: string }).code === "23503") return reply.code(400).send({ error: "One of the selected locations no longer exists." });
    throw error;
  } finally {
    client.release();
  }
});

app.put<{ Params: { id: string }; Body: Pick<CreateSiteUser, "email" | "username" | "displayName" | "birthday" | "street" | "streetNumber" | "postalCode" | "city" | "phoneNumbers" | "relationships" | "memberships"> }>("/api/users/:id", {
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
  if (!requireServerAdmin(request, reply)) return reply;
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
    const updated = await client.query(
      `UPDATE app_users SET email = $2, username = $3, display_name = $4, birthday = $5::date,
              street = $6, street_number = $7, postal_code = $8, city = $9
        WHERE id = $1
        RETURNING id, email, username, display_name, to_char(birthday, 'DD:MM:YYYY') AS birthday,
                  street, street_number, postal_code, city, role`,
      [request.params.id, email, username, displayName, birthdayToIso(birthday), street, streetNumber, postalCode, city],
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
    return { id: row.id, ...(row.email ? { email: row.email } : {}), username: row.username, displayName: row.display_name, ...(row.birthday ? { birthday: row.birthday } : {}), ...(row.street ? { street: row.street } : {}), ...(row.street_number ? { streetNumber: row.street_number } : {}), ...(row.postal_code ? { postalCode: row.postal_code } : {}), ...(row.city ? { city: row.city } : {}), phoneNumbers, relationships: await readUserRelationships(client, request.params.id), accountRole: row.role, memberships };
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
  if (!requireServerAdmin(request, reply)) return reply;
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

app.post<{ Params: { id: string }; Body: { password: string; mustChangePassword: boolean } }>("/api/users/:id/reset-password", {
  schema: {
    params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
    body: { type: "object", additionalProperties: false, required: ["password", "mustChangePassword"], properties: { password: { type: "string", minLength: 12, maxLength: 128 }, mustChangePassword: { type: "boolean" } } },
  },
}, async (request, reply): Promise<{ id: string; mustChangePassword: boolean } | { error: string }> => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "The account database is unavailable." });
  if (!requireServerAdmin(request, reply)) return reply;
  if (request.params.id === request.authenticatedUser?.id) return reply.code(400).send({ error: "Choose another user to reset their password." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const target = await client.query("SELECT id FROM app_users WHERE id = $1 FOR UPDATE", [request.params.id]);
    if (!target.rowCount) {
      await client.query("ROLLBACK");
      return reply.code(404).send({ error: "This local user could not be found." });
    }
    await client.query("UPDATE app_users SET password_hash = $2, must_change_password = $3 WHERE id = $1", [request.params.id, hashPassword(request.body.password), request.body.mustChangePassword]);
    await client.query("DELETE FROM auth_sessions WHERE user_id = $1", [request.params.id]);
    await client.query("COMMIT");
    return { id: request.params.id, mustChangePassword: request.body.mustChangePassword };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

app.get("/api/departments", async (request, reply): Promise<DepartmentProfile[] | { error: string }> => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "Configure DATABASE_URL to load locations." });
  if (request.authenticatedUser?.role === "server_admin") {
    const result = await pool.query(
      `SELECT d.id, d.name, d.time_zone, d.enabled_modules, m.role, COALESCE(m.permissions, '{}'::TEXT[]) AS permissions, COALESCE(m.video_permissions, '{}'::TEXT[]) AS video_permissions, COALESCE(m.presenter_permissions, '{}'::TEXT[]) AS presenter_permissions, COALESCE(m.module_permissions, '{}'::JSONB) AS module_permissions
         FROM departments d
         LEFT JOIN department_memberships m
           ON m.department_id = d.id AND m.user_id = $1
        ORDER BY d.name`,
      [request.authenticatedUser.id],
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
  if (!requireServerAdmin(request, reply)) return reply;
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
      "INSERT INTO departments (id, name, time_zone) VALUES ($1, $2, $3) RETURNING id, name, time_zone, enabled_modules",
      [id, location, timeZone],
    );
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
  const selectedDepartmentId = await activeDepartmentId(request, reply);
  if (!selectedDepartmentId) return reply;
  const result = await pool.query(
    `SELECT d.id, d.name, d.time_zone, d.enabled_modules, m.permissions, m.video_permissions, m.presenter_permissions, m.module_permissions
       FROM departments d
       JOIN department_memberships m ON m.department_id = d.id
      WHERE d.id = $1 AND m.user_id = $2`,
    [selectedDepartmentId, request.authenticatedUser?.id],
  );
  const row = result.rows[0];
  if (!row) return reply.code(404).send({ error: "The configured department could not be found." });
  return { id: row.id, location: row.name, timeZone: row.time_zone, role: request.activeDepartmentRole!, enabledModules: row.enabled_modules, permissions: row.permissions ?? [], videoPermissions: row.video_permissions, presenterPermissions: row.presenter_permissions, modulePermissions: row.module_permissions ?? {} };
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
  if (!requireServerAdmin(request, reply)) return reply;

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
    `SELECT id, first_name, last_name, email, phone, status, source_system
       FROM contacts
      WHERE department_id = $1
      ORDER BY created_at DESC, last_name, first_name`,
    [selectedDepartmentId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    ...((request.activeDepartmentRole === "site_admin" || (request.activeDepartmentPermissions ?? []).includes("people_view_private") || (request.activeDepartmentPermissions ?? []).includes("people_manage")) && row.email ? { email: row.email } : {}),
    ...((request.activeDepartmentRole === "site_admin" || (request.activeDepartmentPermissions ?? []).includes("people_view_private") || (request.activeDepartmentPermissions ?? []).includes("people_manage")) && row.phone ? { phone: row.phone } : {}),
    status: row.status,
    ...(row.source_system === "churchtools" ? { importedFrom: "churchtools" as const } : {}),
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
  if (existing.rows[0].source_system === "churchtools") return reply.code(403).send({ error: "This person is managed by ChurchTools. Edit them there and sync again." });
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
  if (existing.rows[0].source_system === "churchtools") return reply.code(403).send({ error: "This person is managed by ChurchTools. Remove them there and sync again." });
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
    `SELECT id, title, kind, event_date::text, to_char(start_time, 'HH24:MI') AS start_time,
            CASE WHEN end_time IS NULL THEN NULL ELSE to_char(end_time, 'HH24:MI') END AS end_time,
            location, description, room, asset_ids, positions, time_plan, source_system
       FROM service_events
      WHERE department_id = $1
      ORDER BY event_date, start_time, title`,
    [selectedDepartmentId],
  );
  return result.rows.map(mapServiceEvent);
});

app.post<{ Body: CreateServiceEvent }>("/api/events", {
  schema: { body: serviceEventBodySchema },
}, async (request, reply): Promise<ServiceEvent | { error: string }> => {
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

  const result = await pool.query<ServiceEventRow>(
    `INSERT INTO service_events (id, department_id, title, kind, event_date, start_time, end_time, location, description, room, asset_ids, positions, time_plan)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb)
     RETURNING id, title, kind, event_date::text, to_char(start_time, 'HH24:MI') AS start_time,
               CASE WHEN end_time IS NULL THEN NULL ELSE to_char(end_time, 'HH24:MI') END AS end_time,
               location, description, room, asset_ids, positions, time_plan`,
    [randomUUID(), selectedDepartmentId, event.title, event.kind, event.eventDate, event.startTime, event.endTime ?? null, event.location, event.description ?? null, event.room?.trim() ?? "", event.assetIds ?? [], JSON.stringify(event.positions ?? []), JSON.stringify(event.timePlan ?? [])],
  );
  return reply.code(201).send(mapServiceEvent(result.rows[0]));
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
  if (existing.rows[0].source_system === "churchtools") return reply.code(403).send({ error: "This service is managed by ChurchTools. Edit it there and sync again." });
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

  const result = await pool.query<ServiceEventRow>(
    `UPDATE service_events
        SET title = $3, kind = $4, event_date = $5, start_time = $6, end_time = $7,
            location = $8, description = $9, room = $10, asset_ids = $11, positions = $12::jsonb, time_plan = $13::jsonb, updated_at = now()
      WHERE id = $1 AND department_id = $2
      RETURNING id, title, kind, event_date::text, to_char(start_time, 'HH24:MI') AS start_time,
                CASE WHEN end_time IS NULL THEN NULL ELSE to_char(end_time, 'HH24:MI') END AS end_time,
                location, description, room, asset_ids, positions, time_plan, source_system`,
    [request.params.id, selectedDepartmentId, event.title, event.kind, event.eventDate, event.startTime, event.endTime ?? null, event.location, event.description ?? null, event.room?.trim() ?? "", event.assetIds ?? [], JSON.stringify(event.positions ?? []), JSON.stringify(event.timePlan ?? [])],
  );
  if (!result.rowCount) return reply.code(404).send({ error: "This event could not be found." });
  return mapServiceEvent(result.rows[0]);
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
  if (existing.rows[0].source_system === "churchtools") return reply.code(403).send({ error: "This service is managed by ChurchTools. Remove it there and sync again." });
  const result = await pool.query("DELETE FROM service_events WHERE id = $1 AND department_id = $2 RETURNING id", [request.params.id, selectedDepartmentId]);
  if (!result.rowCount) return reply.code(404).send({ error: "This event could not be found." });
  return { id: result.rows[0].id };
});

app.addHook("onClose", async () => {
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
  await registerServerModules(app, {
    pool: pool ?? null,
    isDatabaseReady: () => databaseReady,
    getDefaultDepartmentId: () => departmentId,
    resolveDepartmentId: activeDepartmentId,
    validateMutation: validModuleMutation,
    getVideoWorker: () => videoWorker,
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
  await app.listen({ host, port });
  const shutdown = () => { void app.close().catch((error) => { app.log.error({ err: error }, "Server shutdown failed."); process.exitCode = 1; }); };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  videoWorker = new VideoWorkerSupervisor(app.server, port, Boolean(process.env.STREAMING_CONFIG_FILE));
  videoWorker.start();
} catch (error) {
  app.log.error(error);
  await closeDatabase();
  process.exit(1);
}
