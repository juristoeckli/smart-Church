import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import type { Contact, CreateContact, CreateServiceEvent, ServiceEvent } from "@smart-church/contracts";
import { closeDatabase, departmentId, initializeDatabase, pool } from "./database.js";

const app = Fastify({ logger: true, bodyLimit: 3 * 1024 * 1024 });
let databaseReady = false;

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
    throw new Error("Department data endpoints are still in local development mode; authentication is required before production use.");
  }
  try {
    databaseReady = await initializeDatabase();
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
