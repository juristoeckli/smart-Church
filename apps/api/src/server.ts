import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import type { Contact, CreateContact } from "@smart-church/contracts";
import { closeDatabase, departmentId, initializeDatabase, pool } from "./database.js";

const app = Fastify({ logger: true });
let databaseReady = false;

app.get("/api/health", async () => ({ status: databaseReady ? "ok" : "database_unavailable" }));

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
