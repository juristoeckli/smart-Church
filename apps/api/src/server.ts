import Fastify from "fastify";
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { AuthStatus, AuthenticatedUser, Contact, CreateAdminAccount, CreateContact, CreateServiceEvent, DepartmentProfile, LoginCredentials, ServiceEvent, UpdateDepartmentProfile } from "@smart-church/contracts";
import { closeDatabase, departmentId, initializeDatabase, pool } from "./database.js";

const app = Fastify({ logger: true, bodyLimit: 3 * 1024 * 1024 });
let databaseReady = false;
let firstRunSetupCode: string | null = null;
const sessionCookieName = "smart_church_session";
const sessionLifetimeSeconds = 24 * 60 * 60;
const failedLogins = new Map<string, { count: number; resetAt: number }>();

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
    `SELECT u.id, u.email, u.display_name, u.role
       FROM auth_sessions s JOIN app_users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  const row = result.rows[0];
  return row ? { id: row.id, email: row.email, displayName: row.display_name, role: row.role } : null;
}

function setupCodeMatches(candidate: string) {
  if (!firstRunSetupCode) return false;
  const expected = Buffer.from(firstRunSetupCode);
  const actual = Buffer.from(candidate);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
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

app.addHook("preHandler", async (request, reply) => {
  if (request.url === "/api/health" || request.url.startsWith("/api/auth/")) return;
  if (!databaseReady) return;
  const user = await currentUser(cookieValue(request.headers.cookie, sessionCookieName));
  if (!user) return reply.code(401).send({ error: "Sign in to continue." });
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
    ...(user ? { user } : {}),
  };
});

app.post<{ Body: CreateAdminAccount }>("/api/auth/setup", {
  schema: {
    body: {
      type: "object",
      additionalProperties: false,
      required: ["setupCode", "location", "email", "displayName", "password"],
      properties: {
        setupCode: { type: "string", minLength: 8, maxLength: 80 },
        location: { type: "string", minLength: 1, maxLength: 120 },
        email: { type: "string", minLength: 3, maxLength: 254, pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$" },
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
      return reply.code(409).send({ error: "The initial administrator has already been created." });
    }
    const department = await client.query(
      "UPDATE departments SET name = $2, updated_at = now() WHERE id = $1",
      [departmentId, location],
    );
    if (!department.rowCount) throw new Error("The configured department could not be found.");
    const result = await client.query(
      `INSERT INTO app_users (id, email, display_name, password_hash, role)
       VALUES ($1, $2, $3, $4, 'admin') RETURNING id, email, display_name, role`,
      [randomUUID(), email, displayName, passwordHash],
    );
    const row = result.rows[0];
    user = { id: row.id, email: row.email, displayName: row.display_name, role: row.role };
    await client.query("COMMIT");
    firstRunSetupCode = null;
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") return reply.code(409).send({ error: "An account with this email already exists." });
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
      required: ["email", "password"],
      properties: {
        email: { type: "string", minLength: 3, maxLength: 254, pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$" },
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
    "SELECT id, email, display_name, password_hash, role FROM app_users WHERE lower(email) = $1",
    [request.body.email.trim().toLocaleLowerCase("en-US")],
  );
  const row = result.rows[0];
  const passwordMatches = verifyPassword(request.body.password, row?.password_hash ?? dummyPasswordHash);
  if (!row || !passwordMatches) {
    const current = attempts && attempts.resetAt > now ? attempts : { count: 0, resetAt: now + 15 * 60_000 };
    failedLogins.set(request.ip, { count: current.count + 1, resetAt: current.resetAt });
    return reply.code(401).send({ error: "Email or password is incorrect." });
  }
  failedLogins.delete(request.ip);
  const user: AuthenticatedUser = { id: row.id, email: row.email, displayName: row.display_name, role: row.role };
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

app.get("/api/department", async (_request, reply): Promise<DepartmentProfile | { error: string }> => {
  if (!databaseReady || !pool) return reply.code(503).send({ error: "Configure DATABASE_URL to load department settings." });
  const result = await pool.query(
    "SELECT id, name, time_zone FROM departments WHERE id = $1",
    [departmentId],
  );
  const row = result.rows[0];
  if (!row) return reply.code(404).send({ error: "The configured department could not be found." });
  return { id: row.id, location: row.name, timeZone: row.time_zone };
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
    [departmentId, location, timeZone],
  );
  const row = result.rows[0];
  if (!row) return reply.code(404).send({ error: "The configured department could not be found." });
  return { id: row.id, location: row.name, timeZone: row.time_zone };
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

app.get("/api/contacts", async (_request, reply): Promise<Contact[] | { error: string }> => {
  if (!databaseReady || !pool) {
    return reply.code(503).send({ error: "Configure DATABASE_URL to enable saved contacts." });
  }

  const result = await pool.query(
    `SELECT id, first_name, last_name, email, phone, status
       FROM contacts
      WHERE department_id = $1
      ORDER BY created_at DESC, last_name, first_name`,
    [departmentId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    ...(row.email ? { email: row.email } : {}),
    ...(row.phone ? { phone: row.phone } : {}),
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

  const firstName = request.body.firstName.trim();
  const lastName = request.body.lastName.trim();
  const email = request.body.email?.trim() || null;
  const phone = request.body.phone?.trim() || null;
  if (!firstName || !lastName) return reply.code(400).send({ error: "First and last name are required." });

  const result = await pool.query(
    `INSERT INTO contacts (id, department_id, first_name, last_name, email, phone, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, first_name, last_name, email, phone, status`,
    [randomUUID(), departmentId, firstName, lastName, email, phone, request.body.status],
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

app.get("/api/events", async (_request, reply): Promise<ServiceEvent[] | { error: string }> => {
  if (!databaseReady || !pool) {
    return reply.code(503).send({ error: "Configure DATABASE_URL to enable saved services and events." });
  }
  const result = await pool.query<ServiceEventRow>(
    `SELECT id, title, kind, event_date::text, to_char(start_time, 'HH24:MI') AS start_time,
            CASE WHEN end_time IS NULL THEN NULL ELSE to_char(end_time, 'HH24:MI') END AS end_time,
            location, description
       FROM service_events
      WHERE department_id = $1
      ORDER BY event_date, start_time, title`,
    [departmentId],
  );
  return result.rows.map(mapServiceEvent);
});

app.post<{ Body: CreateServiceEvent }>("/api/events", {
  schema: { body: serviceEventBodySchema },
}, async (request, reply): Promise<ServiceEvent | { error: string }> => {
  if (!databaseReady || !pool) {
    return reply.code(503).send({ error: "Configure DATABASE_URL to enable saved services and events." });
  }
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
    [randomUUID(), departmentId, event.title, event.kind, event.eventDate, event.startTime, event.endTime ?? null, event.location, event.description ?? null],
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
    [request.params.id, departmentId, event.title, event.kind, event.eventDate, event.startTime, event.endTime ?? null, event.location, event.description ?? null],
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
  const result = await pool.query("DELETE FROM service_events WHERE id = $1 AND department_id = $2 RETURNING id", [request.params.id, departmentId]);
  if (!result.rowCount) return reply.code(404).send({ error: "This event could not be found." });
  return { id: result.rows[0].id };
});

app.addHook("onClose", closeDatabase);

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
        app.log.warn({ setupCode: firstRunSetupCode }, "Use this one-time code to create the first administrator account.");
      }
    }
  } catch (error) {
    app.log.error({ err: error }, "Database unavailable; department data will not be saved.");
  }
  if (!databaseReady) app.log.warn("Database is unavailable; department data will not be saved.");
  await app.listen({ host: "127.0.0.1", port });
} catch (error) {
  app.log.error(error);
  await closeDatabase();
  process.exit(1);
}
