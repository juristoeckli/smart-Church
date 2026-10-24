import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import type { Contact, CreateContact } from "@smart-church/contracts";
import { closeDatabase, departmentId, initializeDatabase, pool } from "./database.js";

const app = Fastify({ logger: true, bodyLimit: 3 * 1024 * 1024 });
let databaseReady = false;

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

app.addHook("onClose", closeDatabase);

const port = Number(process.env.PORT ?? 3001);

try {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Contact endpoints are still in local development mode; authentication is required before production use.");
  }
  try {
    databaseReady = await initializeDatabase();
  } catch (error) {
    app.log.error({ err: error }, "Database unavailable; contacts will not be saved.");
  }
  if (!databaseReady) app.log.warn("Database is unavailable; contacts will not be saved.");
  await app.listen({ host: "127.0.0.1", port });
} catch (error) {
  app.log.error(error);
  await closeDatabase();
  process.exit(1);
}
