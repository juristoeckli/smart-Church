import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { AuthStatus, AuthenticatedUser, Contact, CreateAdminAccount, CreateContact, CreateDepartment, CreateServiceEvent, CreateSiteUser, DepartmentProfile, LoginCredentials, ServiceEvent, SiteUser, UpdateDepartmentProfile, UserPhoneNumber, UserRelationshipInput, UserRelationshipKind } from "@smart-church/contracts";
import { closeDatabase, departmentId, initializeDatabase, pool } from "./database.js";
import { VideoWorkerSupervisor } from "./modules/video/worker-supervisor.js";

const app = Fastify({ logger: true, bodyLimit: 3 * 1024 * 1024 });
let databaseReady = false;
let firstRunSetupCode: string | null = null;
const sessionCookieName = "smart_church_session";
const sessionLifetimeSeconds = 24 * 60 * 60;
const failedLogins = new Map<string, { count: number; resetAt: number }>();
let videoWorker: VideoWorkerSupervisor | null = null;

declare module "fastify" {
  interface FastifyRequest {
    authenticatedUser: AuthenticatedUser | null;
    activeDepartmentRole: "site_admin" | "member" | null;
  }
}

app.decorateRequest("authenticatedUser", null);
app.decorateRequest("activeDepartmentRole", null);

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

function setSessionCookie(reply: { header: (name: string, value: string) => unknown }, token: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  reply.header("Set-Cookie", `${sessionCookieName}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${sessionLifetimeSeconds}${secure}`);
}

function clearSessionCookie(reply: { header: (name: string, value: string) => unknown }) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  reply.header("Set-Cookie", `${sessionCookieName}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0${secure}`);
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

async function activeDepartmentId(request: FastifyRequest, reply: FastifyReply, requireSiteAdmin = false) {
  if (!pool) return null;
  const header = request.headers["x-department-id"];
  const selectedId = typeof header === "string" ? header : departmentId;
  if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(selectedId)) {
    reply.code(400).send({ error: "Choose a valid location." });
    return null;
  }
  const result = await pool.query(
    `SELECT m.role
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
  if (requireSiteAdmin && request.activeDepartmentRole !== "site_admin") {
    reply.code(403).send({ error: "Site administrator access is required for this action." });
    return null;
  }
  return selectedId;
}

function requireServerAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (request.authenticatedUser?.role === "server_admin") return true;
  reply.code(403).send({ error: "Server administrator access is required." });
  return false;
}

async function createSession(userId: string, reply: { header: (name: string, value: string) => unknown }) {
  const token = randomBytes(32).toString("base64url");
  await pool!.query(
    `INSERT INTO auth_sessions (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + ($4 * interval '1 second'))`,
    [randomUUID(), userId, hashToken(token), sessionLifetimeSeconds],
  );
  setSessionCookie(reply, token);
}

function videoCsrfToken(sessionToken: string) {
  return createHmac("sha256", sessionToken).update("smart-church-video-csrf").digest("base64url");
}

function validVideoMutation(request: FastifyRequest, reply: FastifyReply) {
  const sessionToken = cookieValue(request.headers.cookie, sessionCookieName);
  const csrfHeader = request.headers["x-csrf-token"];
  const originHeader = request.headers.origin;
  if (!sessionToken || !csrfHeader || !originHeader || Array.isArray(csrfHeader)) {
    reply.code(403).send({ error: "The video request could not be verified. Refresh the page and try again." });
    return false;
  }
  let origin: URL;
  let requestHost: URL;
  try {
    origin = new URL(originHeader);
    requestHost = new URL(`http://${request.headers.host}`);
  } catch {
    reply.code(403).send({ error: "The video request origin is not valid." });
    return false;
  }
  const allowedOrigin = process.env.SMART_CHURCH_WEB_ORIGIN
    ? origin.origin === process.env.SMART_CHURCH_WEB_ORIGIN
    : origin.hostname === requestHost.hostname && origin.protocol === "http:" &&
      new Set([requestHost.port, "5173"]).has(origin.port);
  const expected = Buffer.from(videoCsrfToken(sessionToken));
  const actual = Buffer.from(csrfHeader);
  if (!allowedOrigin || request.headers["sec-fetch-site"] === "cross-site" || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    reply.code(403).send({ error: "The video request origin or session token is not valid." });
    return false;
  }
  return true;
}

app.addHook("preHandler", async (request, reply) => {
  if (request.url === "/api/health" || request.url.startsWith("/api/auth/")) return;
  if (!databaseReady) return;
  const user = await currentUser(cookieValue(request.headers.cookie, sessionCookieName));
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
};

const serviceEventProperties = {
  title: { type: "string", minLength: 1, maxLength: 160 },
  kind: { type: "string", enum: ["service", "meeting", "community", "other"] },
  eventDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
  startTime: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
  endTime: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
  location: { type: "string", minLength: 1, maxLength: 160 },
  description: { type: "string", maxLength: 2000 },
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
  return null;
}

app.get("/api/health", async () => ({ status: databaseReady ? "ok" : "database_unavailable" }));

app.get("/api/auth/status", async (request, reply): Promise<AuthStatus | { error: string }> => {
  reply.header("Cache-Control", "no-store");
  if (!databaseReady || !pool) return reply.code(503).send({ error: "The account database is unavailable." });
  const user = await currentUser(cookieValue(request.headers.cookie, sessionCookieName));
  const count = await pool.query("SELECT count(*)::int AS total FROM app_users");
  return {
    setupRequired: count.rows[0].total === 0,
    authenticated: user !== null,
    ...(user ? { csrfToken: videoCsrfToken(cookieValue(request.headers.cookie, sessionCookieName)!) } : {}),
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
        password: { type: "string", minLength: 6, maxLength: 128 },
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
      "UPDATE departments SET name = $2, updated_at = now() WHERE id = $1",
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
  await createSession(user.id, reply);
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
  const attempts = failedLogins.get(request.ip);
  if (attempts && attempts.resetAt > now && attempts.count >= 5) {
    return reply.code(429).send({ error: "Too many sign-in attempts. Wait 15 minutes and try again." });
  }
  const result = await pool.query(
    "SELECT id, email, username, display_name, password_hash, role FROM app_users WHERE lower(email) = $1 OR lower(username) = $1",
    [request.body.identifier.trim().toLocaleLowerCase("en-US")],
  );
  const row = result.rows[0];
  const passwordMatches = verifyPassword(request.body.password, row?.password_hash ?? dummyPasswordHash);
  if (!row || !passwordMatches) {
    const current = attempts && attempts.resetAt > now ? attempts : { count: 0, resetAt: now + 15 * 60_000 };
    failedLogins.set(request.ip, { count: current.count + 1, resetAt: current.resetAt });
    return reply.code(401).send({ error: "Username, email, or password is incorrect." });
  }
  failedLogins.delete(request.ip);
  const user: AuthenticatedUser = { id: row.id, ...(row.email ? { email: row.email } : {}), username: row.username, displayName: row.display_name, role: row.role, mustChangePassword: row.must_change_password };
  await createSession(user.id, reply);
  return { user };
});

app.post("/api/auth/logout", async (request, reply) => {
  reply.header("Cache-Control", "no-store");
  const token = cookieValue(request.headers.cookie, sessionCookieName);
  if (pool && token) await pool.query("DELETE FROM auth_sessions WHERE token_hash = $1", [hashToken(token)]);
  clearSessionCookie(reply);
  return { ok: true };
});

app.post<{ Body: { password: string } }>("/api/auth/change-password", {
  schema: {
    body: { type: "object", additionalProperties: false, required: ["password"], properties: { password: { type: "string", minLength: 6, maxLength: 128 } } },
  },
}, async (request, reply): Promise<{ user: AuthenticatedUser } | { error: string }> => {
  reply.header("Cache-Control", "no-store");
  if (!databaseReady || !pool) return reply.code(503).send({ error: "The account database is unavailable." });
  const user = await currentUser(cookieValue(request.headers.cookie, sessionCookieName));
  if (!user) return reply.code(401).send({ error: "Sign in to continue." });
  const result = await pool.query(
    "UPDATE app_users SET password_hash = $2, must_change_password = false WHERE id = $1 RETURNING id, email, username, display_name, role",
    [user.id, hashPassword(request.body.password)],
  );
  const row = result.rows[0];
  if (!row) return reply.code(401).send({ error: "This account could not be found." });
  return { user: { id: row.id, ...(row.email ? { email: row.email } : {}), username: row.username, displayName: row.display_name, role: row.role, mustChangePassword: false } };
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
         SELECT COALESCE(json_agg(json_build_object('departmentId', m.department_id, 'role', m.role)), '[]'::json) AS memberships
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
        password: { type: "string", minLength: 6, maxLength: 128 },
        accountRole: { type: "string", enum: ["server_admin", "user"] },
        memberships: {
          type: "array", maxItems: 100,
          items: { type: "object", additionalProperties: false, required: ["departmentId", "role"], properties: { departmentId: { type: "string", format: "uuid" }, role: { type: "string", enum: ["site_admin", "member"] } } },
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
      await client.query(
        "INSERT INTO department_memberships (user_id, department_id, role) VALUES ($1, $2, $3)",
        [id, membership.departmentId, membership.role],
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
    if ((error as { code?: string }).code === "23505") return reply.code(409).send({ error: "An account with this username or email already exists." });
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
        memberships: { type: "array", maxItems: 100, items: { type: "object", additionalProperties: false, required: ["departmentId", "role"], properties: { departmentId: { type: "string", format: "uuid" }, role: { type: "string", enum: ["site_admin", "member"] } } } },
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
    await client.query("DELETE FROM department_memberships WHERE user_id = $1", [request.params.id]);
    await client.query("DELETE FROM user_phone_numbers WHERE user_id = $1", [request.params.id]);
    await insertUserPhoneNumbers(client, request.params.id, phoneNumbers);
    const relationshipError = await replaceUserRelationships(client, request.params.id, relationships);
    if (relationshipError) {
      await client.query("ROLLBACK");
      return reply.code(400).send({ error: relationshipError });
    }
    for (const membership of memberships) {
      await client.query(
        "INSERT INTO department_memberships (user_id, department_id, role) VALUES ($1, $2, $3)",
        [request.params.id, membership.departmentId, membership.role],
      );
    }
    await client.query("COMMIT");
    const row = updated.rows[0];
    return { id: row.id, ...(row.email ? { email: row.email } : {}), username: row.username, displayName: row.display_name, ...(row.birthday ? { birthday: row.birthday } : {}), ...(row.street ? { street: row.street } : {}), ...(row.street_number ? { streetNumber: row.street_number } : {}), ...(row.postal_code ? { postalCode: row.postal_code } : {}), ...(row.city ? { city: row.city } : {}), phoneNumbers, relationships: await readUserRelationships(client, request.params.id), accountRole: row.role, memberships };
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") return reply.code(409).send({ error: "An account with this username or email already exists." });
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
    body: { type: "object", additionalProperties: false, required: ["password", "mustChangePassword"], properties: { password: { type: "string", minLength: 6, maxLength: 128 }, mustChangePassword: { type: "boolean" } } },
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
      `SELECT d.id, d.name, d.time_zone, m.role
         FROM departments d
         LEFT JOIN department_memberships m
           ON m.department_id = d.id AND m.user_id = $1
        ORDER BY d.name`,
      [request.authenticatedUser.id],
    );
    return result.rows.map((row) => ({ id: row.id, location: row.name, timeZone: row.time_zone, role: row.role ?? "unassigned" }));
  }
  const result = await pool.query(
    `SELECT d.id, d.name, d.time_zone, m.role
       FROM department_memberships m
       JOIN departments d ON d.id = m.department_id
      WHERE m.user_id = $1
      ORDER BY d.name`,
    [request.authenticatedUser?.id],
  );
  return result.rows.map((row) => ({ id: row.id, location: row.name, timeZone: row.time_zone, role: row.role }));
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
      "INSERT INTO departments (id, name, time_zone) VALUES ($1, $2, $3) RETURNING id, name, time_zone",
      [id, location, timeZone],
    );
    await client.query(
      "INSERT INTO department_memberships (user_id, department_id, role) VALUES ($1, $2, 'site_admin')",
      [request.authenticatedUser!.id, id],
    );
    await client.query("COMMIT");
    const row = result.rows[0];
    return reply.code(201).send({ id: row.id, location: row.name, timeZone: row.time_zone, role: "site_admin" });
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
    "SELECT id, name, time_zone FROM departments WHERE id = $1",
    [selectedDepartmentId],
  );
  const row = result.rows[0];
  if (!row) return reply.code(404).send({ error: "The configured department could not be found." });
  return { id: row.id, location: row.name, timeZone: row.time_zone, role: request.activeDepartmentRole! };
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
      WHERE id = $1 RETURNING id, name, time_zone`,
    [selectedDepartmentId, location, timeZone],
  );
  const row = result.rows[0];
  if (!row) return reply.code(404).send({ error: "The configured department could not be found." });
  return { id: row.id, location: row.name, timeZone: row.time_zone, role: "site_admin" };
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
    `SELECT id, first_name, last_name, email, phone, status
       FROM contacts
      WHERE department_id = $1
      ORDER BY created_at DESC, last_name, first_name`,
    [selectedDepartmentId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    ...(request.activeDepartmentRole === "site_admin" && row.email ? { email: row.email } : {}),
    ...(request.activeDepartmentRole === "site_admin" && row.phone ? { phone: row.phone } : {}),
    status: row.status,
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
  const selectedDepartmentId = await activeDepartmentId(request, reply, true);
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

app.get("/api/events", async (request, reply): Promise<ServiceEvent[] | { error: string }> => {
  if (!databaseReady || !pool) {
    return reply.code(503).send({ error: "Configure DATABASE_URL to enable saved services and events." });
  }
  const selectedDepartmentId = await activeDepartmentId(request, reply);
  if (!selectedDepartmentId) return reply;
  const result = await pool.query<ServiceEventRow>(
    `SELECT id, title, kind, event_date::text, to_char(start_time, 'HH24:MI') AS start_time,
            CASE WHEN end_time IS NULL THEN NULL ELSE to_char(end_time, 'HH24:MI') END AS end_time,
            location, description
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
  const selectedDepartmentId = await activeDepartmentId(request, reply, true);
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

  const result = await pool.query<ServiceEventRow>(
    `INSERT INTO service_events (id, department_id, title, kind, event_date, start_time, end_time, location, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, title, kind, event_date::text, to_char(start_time, 'HH24:MI') AS start_time,
               CASE WHEN end_time IS NULL THEN NULL ELSE to_char(end_time, 'HH24:MI') END AS end_time,
               location, description`,
    [randomUUID(), selectedDepartmentId, event.title, event.kind, event.eventDate, event.startTime, event.endTime ?? null, event.location, event.description ?? null],
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
  const selectedDepartmentId = await activeDepartmentId(request, reply, true);
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

  const result = await pool.query<ServiceEventRow>(
    `UPDATE service_events
        SET title = $3, kind = $4, event_date = $5, start_time = $6, end_time = $7,
            location = $8, description = $9, updated_at = now()
      WHERE id = $1 AND department_id = $2
      RETURNING id, title, kind, event_date::text, to_char(start_time, 'HH24:MI') AS start_time,
                CASE WHEN end_time IS NULL THEN NULL ELSE to_char(end_time, 'HH24:MI') END AS end_time,
                location, description`,
    [request.params.id, selectedDepartmentId, event.title, event.kind, event.eventDate, event.startTime, event.endTime ?? null, event.location, event.description ?? null],
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
  const selectedDepartmentId = await activeDepartmentId(request, reply, true);
  if (!selectedDepartmentId) return reply;
  const result = await pool.query("DELETE FROM service_events WHERE id = $1 AND department_id = $2 RETURNING id", [request.params.id, selectedDepartmentId]);
  if (!result.rowCount) return reply.code(404).send({ error: "This event could not be found." });
  return { id: result.rows[0].id };
});

const videoPostOperations = new Set(["command", "restart-site", "encoder-settings", "videohub-route", "videohub-presets"]);
const videoBodySchema = {
  type: "object",
  additionalProperties: true,
  maxProperties: 24,
};

app.get("/api/video/status", async (request, reply) => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "The account database is unavailable." });
  const selectedDepartmentId = await activeDepartmentId(request, reply, true);
  if (!selectedDepartmentId) return reply;
  const worker = videoWorker?.state ?? { state: "starting", error: null };
  if (!videoWorker || worker.state === "unconfigured") {
    return { available: false, worker, message: "Configure the private video settings file and map its sites to location IDs." };
  }
  try {
    const status = await videoWorker.request("status", {}, selectedDepartmentId, request.authenticatedUser!.username, 8_000);
    return { available: true, worker: videoWorker.state, status };
  } catch (error) {
    const failure = error as Error & { code?: string };
    if (failure.code === "UNAVAILABLE") return reply.code(503).send({ available: false, worker: videoWorker.state, error: failure.message });
    return reply.code(502).send({ available: false, worker: videoWorker.state, error: failure.message });
  }
});

app.get<{ Querystring: { device?: string } }>("/api/video/history", {
  schema: { querystring: { type: "object", additionalProperties: false, required: ["device"], properties: { device: { type: "string", minLength: 1, maxLength: 80 } } } },
}, async (request, reply) => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "The account database is unavailable." });
  const selectedDepartmentId = await activeDepartmentId(request, reply, true);
  if (!selectedDepartmentId) return reply;
  if (!videoWorker) return reply.code(503).send({ error: "The video worker is not configured." });
  try {
    const events = await videoWorker.request("videohub-history", { device: request.query.device }, selectedDepartmentId, request.authenticatedUser!.username, 8_000);
    return events;
  } catch (error) {
    const failure = error as Error & { code?: string };
    return reply.code(failure.code === "UNAVAILABLE" ? 503 : 502).send({ error: failure.message });
  }
});

app.post<{ Params: { operation: string }; Body: Record<string, unknown> }>("/api/video/:operation", {
  bodyLimit: 600_000,
  schema: {
    params: { type: "object", additionalProperties: false, required: ["operation"], properties: { operation: { type: "string", enum: [...videoPostOperations] } } },
    body: videoBodySchema,
  },
}, async (request, reply) => {
  if (!videoPostOperations.has(request.params.operation)) return reply.code(404).send({ error: "Video operation is unavailable." });
  if (!databaseReady || !pool) return reply.code(503).send({ error: "The account database is unavailable." });
  if (!validVideoMutation(request, reply)) return reply;
  const selectedDepartmentId = await activeDepartmentId(request, reply, true);
  if (!selectedDepartmentId) return reply;
  if (!videoWorker) return reply.code(503).send({ error: "The video worker is not configured." });
  const { site: _site, actor: _actor, department_id: _departmentId, ...data } = request.body;
  try {
    return await videoWorker.request(request.params.operation, data, selectedDepartmentId, request.authenticatedUser!.username, 35_000);
  } catch (error) {
    const failure = error as Error & { code?: string };
    const status = failure.code === "UNAVAILABLE" ? 503 : failure.code === "TIMEOUT" ? 504 : failure.code === "BUSY" ? 429 : 400;
    return reply.code(status).send({ error: failure.message });
  }
});

app.addHook("onClose", async () => {
  await videoWorker?.close();
  await closeDatabase();
});

const port = Number(process.env.PORT ?? 3001);

try {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Department memberships and permission checks are still in local development; production mode is disabled until they are complete.");
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
    app.log.error({ err: error }, "Database unavailable; department data will not be saved.");
  }
  if (!databaseReady) app.log.warn("Database is unavailable; department data will not be saved.");
  await app.listen({ host: "127.0.0.1", port });
  videoWorker = new VideoWorkerSupervisor(app.server, port, Boolean(process.env.STREAMING_CONFIG_FILE));
  videoWorker.start();
} catch (error) {
  app.log.error(error);
  await closeDatabase();
  process.exit(1);
}
