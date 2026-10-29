import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import type { ModuleServerContext } from "../module-sdk.js";

type JobStatus = "lead" | "quoted" | "confirmed" | "in_progress" | "completed" | "cancelled";
type BookingStatus = "reserved" | "checked_out" | "returned" | "cancelled";
type CrewStatus = "requested" | "assigned" | "confirmed" | "declined";
type Permission = "view" | "jobs_manage" | "customers_manage" | "inventory_manage" | "crew_manage";

const jobSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["title", "startsAt", "endsAt"],
    properties: {
      title: { type: "string", minLength: 1, maxLength: 160 }, customerName: { type: "string", maxLength: 160 }, customerId: { type: ["string", "null"], format: "uuid" },
      customerContactId: { type: ["string", "null"], format: "uuid" }, linkedEventId: { type: ["string", "null"], format: "uuid" },
      startsAt: { type: "string", format: "date-time" }, endsAt: { type: "string", format: "date-time" },
      venue: { type: "string", maxLength: 240 }, notes: { type: "string", maxLength: 4000 },
    },
  },
};

const jobStatuses = ["lead", "quoted", "confirmed", "in_progress", "completed", "cancelled"] as const;
const bookingStatuses = ["reserved", "checked_out", "returned", "cancelled"] as const;
const crewStatuses = ["requested", "assigned", "confirmed", "declined"] as const;
const customerSchema = {
  body: { type: "object", additionalProperties: false, required: ["kind", "name"], properties: {
    kind: { type: "string", enum: ["company", "person"] }, name: { type: "string", minLength: 1, maxLength: 160 },
    contactPerson: { type: "string", maxLength: 160 }, email: { type: "string", maxLength: 254 }, phone: { type: "string", maxLength: 40 },
    street: { type: "string", maxLength: 200 }, postalCode: { type: "string", maxLength: 24 }, city: { type: "string", maxLength: 120 },
    country: { type: "string", maxLength: 80 }, notes: { type: "string", maxLength: 2000 }, active: { type: "boolean" },
  } },
};

export function registerModuleRoutes(app: FastifyInstance, context: ModuleServerContext) {
  const { pool, isDatabaseReady, resolveDepartmentId, validateMutation } = context;

  app.register(async (routes) => {
    async function department(request: FastifyRequest, reply: FastifyReply, permission: Permission = "view") {
      if (!pool || !isDatabaseReady()) {
        reply.code(503).send({ error: "EventDesk is temporarily unavailable because its database is not ready." });
        return null;
      }
      const id = await resolveDepartmentId(request, reply);
      if (!id) return null;
      const moduleState = await pool!.query("SELECT enabled_modules FROM departments WHERE id=$1", [id]);
      if (!moduleState.rows[0]?.enabled_modules?.includes("eventdesk")) {
        reply.code(404).send({ error: "EventDesk is not enabled for this location." });
        return null;
      }
      const grants = request.activeDepartmentModulePermissions?.eventdesk ?? [];
      const allowed = request.activeDepartmentRole === "site_admin" || grants.includes(permission)
        || (permission === "view" && grants.some((grant) => ["jobs_manage", "customers_manage", "inventory_manage", "crew_manage"].includes(grant)));
      if (!allowed) {
        reply.code(403).send({ error: "You do not have access to this EventDesk feature." });
        return null;
      }
      return id;
    }

    async function sameDepartmentRecord(table: "contacts" | "service_events" | "eventdesk_customers", id: string | null | undefined, departmentId: string) {
      if (!id) return true;
      const result = await pool!.query(`SELECT 1 FROM ${table} WHERE id = $1 AND department_id = $2`, [id, departmentId]);
      return Boolean(result.rowCount);
    }

    async function rollback(client: PoolClient) { await client.query("ROLLBACK"); }

    routes.get("/api/eventdesk/bootstrap", async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const [jobs, assets, bookings, crew, contacts, events, customers] = await Promise.all([
        pool!.query(`SELECT j.id, j.title, j.customer_name, j.customer_contact_id, j.linked_event_id,
                            j.customer_id, coalesce(c.name,j.customer_name) AS customer_display_name,
                            e.title AS linked_event_title, j.starts_at, j.ends_at, j.venue, j.status, j.notes, j.created_at
                       FROM eventdesk_jobs j LEFT JOIN service_events e ON e.id=j.linked_event_id AND e.department_id=j.department_id
                       LEFT JOIN eventdesk_customers c ON c.id=j.customer_id AND c.department_id=j.department_id
                      WHERE j.department_id=$1 ORDER BY j.starts_at, j.created_at DESC`, [departmentId]),
        pool!.query(`SELECT id, name, category, quantity, daily_rate_cents, active, notes
                       FROM eventdesk_assets WHERE department_id=$1 ORDER BY active DESC, lower(category), lower(name)`, [departmentId]),
        pool!.query(`SELECT b.id, b.job_id, b.asset_id, a.name AS asset_name, b.quantity, b.daily_rate_cents, b.status
                       FROM eventdesk_job_assets b JOIN eventdesk_assets a ON a.id=b.asset_id AND a.department_id=b.department_id
                      WHERE b.department_id=$1 ORDER BY a.name`, [departmentId]),
        pool!.query(`SELECT c.id, c.job_id, c.role, c.contact_id, trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')) AS contact_name,
                            c.hours, c.hourly_rate_cents, c.status, c.notes
                       FROM eventdesk_job_crew c LEFT JOIN contacts p ON p.id=c.contact_id AND p.department_id=c.department_id
                      WHERE c.department_id=$1 ORDER BY lower(c.role), c.created_at`, [departmentId]),
        pool!.query(`SELECT id, first_name, last_name FROM contacts WHERE department_id=$1 ORDER BY lower(last_name), lower(first_name)`, [departmentId]),
        pool!.query(`SELECT id, title, event_date, start_time FROM service_events WHERE department_id=$1 ORDER BY event_date DESC, start_time DESC LIMIT 250`, [departmentId]),
        pool!.query(`SELECT id, kind, name, contact_person, email, phone, street, postal_code, city, country, notes, active
                       FROM eventdesk_customers WHERE department_id=$1 ORDER BY active DESC, lower(name)`, [departmentId]),
      ]);
      return {
        jobs: jobs.rows.map((row) => ({ id: row.id, title: row.title, customerName: row.customer_display_name, customerId: row.customer_id, customerContactId: row.customer_contact_id, linkedEventId: row.linked_event_id, linkedEventTitle: row.linked_event_title, startsAt: new Date(row.starts_at).toISOString(), endsAt: new Date(row.ends_at).toISOString(), venue: row.venue, status: row.status, notes: row.notes, createdAt: new Date(row.created_at).toISOString() })),
        assets: assets.rows.map((row) => ({ id: row.id, name: row.name, category: row.category, quantity: row.quantity, dailyRateCents: row.daily_rate_cents, active: row.active, notes: row.notes })),
        bookings: bookings.rows.map((row) => ({ id: row.id, jobId: row.job_id, assetId: row.asset_id, assetName: row.asset_name, quantity: row.quantity, dailyRateCents: row.daily_rate_cents, status: row.status })),
        crew: crew.rows.map((row) => ({ id: row.id, jobId: row.job_id, role: row.role, contactId: row.contact_id, contactName: row.contact_name?.trim() || null, hours: Number(row.hours), hourlyRateCents: row.hourly_rate_cents, status: row.status, notes: row.notes })),
        contacts: contacts.rows.map((row) => ({ id: row.id, name: `${row.first_name} ${row.last_name}`.trim() })),
        events: events.rows.map((row) => ({ id: row.id, title: row.title, eventDate: row.event_date, startTime: row.start_time })),
        customers: customers.rows.map((row) => ({ id: row.id, kind: row.kind, name: row.name, contactPerson: row.contact_person, email: row.email, phone: row.phone, street: row.street, postalCode: row.postal_code, city: row.city, country: row.country, notes: row.notes, active: row.active })),
        permissions: { jobs: request.activeDepartmentRole === "site_admin" || request.activeDepartmentModulePermissions?.eventdesk?.includes("jobs_manage") === true, customers: request.activeDepartmentRole === "site_admin" || request.activeDepartmentModulePermissions?.eventdesk?.includes("customers_manage") === true, inventory: request.activeDepartmentRole === "site_admin" || request.activeDepartmentModulePermissions?.eventdesk?.includes("inventory_manage") === true, crew: request.activeDepartmentRole === "site_admin" || request.activeDepartmentModulePermissions?.eventdesk?.includes("crew_manage") === true },
      };
    });

    routes.post<{ Body: { title: string; customerName?: string; customerId?: string | null; customerContactId?: string | null; linkedEventId?: string | null; startsAt: string; endsAt: string; venue?: string; notes?: string } }>("/api/eventdesk/jobs", { schema: jobSchema }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply, "jobs_manage");
      if (!departmentId) return reply;
      const body = request.body;
      if (new Date(body.endsAt) <= new Date(body.startsAt)) return reply.code(400).send({ error: "The job end must be after its start." });
      if (!await sameDepartmentRecord("contacts", body.customerContactId, departmentId) || !await sameDepartmentRecord("service_events", body.linkedEventId, departmentId)) return reply.code(400).send({ error: "Choose a person or event from this location." });
      let customerName = body.customerName?.trim() ?? "";
      if (body.customerId) {
        const customer = await pool!.query("SELECT name FROM eventdesk_customers WHERE id=$1 AND department_id=$2 AND active=true", [body.customerId, departmentId]);
        if (!customer.rowCount) return reply.code(400).send({ error: "Choose an active customer from this location." });
        customerName = customer.rows[0].name;
      }
      const result = await pool!.query(`INSERT INTO eventdesk_jobs (id,department_id,title,customer_name,customer_id,customer_contact_id,linked_event_id,starts_at,ends_at,venue,notes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`, [randomUUID(), departmentId, body.title.trim(), customerName, body.customerId ?? null, body.customerContactId ?? null, body.linkedEventId ?? null, body.startsAt, body.endsAt, body.venue?.trim() ?? "", body.notes?.trim() ?? ""]);
      return reply.code(201).send({ id: result.rows[0].id });
    });

    routes.post<{ Body: { kind: "company" | "person"; name: string; contactPerson?: string; email?: string; phone?: string; street?: string; postalCode?: string; city?: string; country?: string; notes?: string } }>("/api/eventdesk/customers", { schema: customerSchema }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply, "customers_manage");
      if (!departmentId) return reply;
      const b = request.body;
      const result = await pool!.query(`INSERT INTO eventdesk_customers (id,department_id,kind,name,contact_person,email,phone,street,postal_code,city,country,notes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`, [randomUUID(), departmentId, b.kind, b.name.trim(), b.contactPerson?.trim() ?? "", b.email?.trim() ?? "", b.phone?.trim() ?? "", b.street?.trim() ?? "", b.postalCode?.trim() ?? "", b.city?.trim() ?? "", b.country?.trim() ?? "", b.notes?.trim() ?? ""]);
      return reply.code(201).send({ id: result.rows[0].id });
    });

    routes.put<{ Params: { id: string }; Body: { kind: "company" | "person"; name: string; contactPerson?: string; email?: string; phone?: string; street?: string; postalCode?: string; city?: string; country?: string; notes?: string; active?: boolean } }>("/api/eventdesk/customers/:id", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } }, body: customerSchema.body } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply, "customers_manage");
      if (!departmentId) return reply;
      const b = request.body;
      const result = await pool!.query(`UPDATE eventdesk_customers SET kind=$3,name=$4,contact_person=$5,email=$6,phone=$7,street=$8,postal_code=$9,city=$10,country=$11,notes=$12,active=coalesce($13,active),updated_at=now()
        WHERE id=$1 AND department_id=$2 RETURNING id`, [request.params.id, departmentId, b.kind, b.name.trim(), b.contactPerson?.trim() ?? "", b.email?.trim() ?? "", b.phone?.trim() ?? "", b.street?.trim() ?? "", b.postalCode?.trim() ?? "", b.city?.trim() ?? "", b.country?.trim() ?? "", b.notes?.trim() ?? "", b.active ?? null]);
      return result.rowCount ? { id: request.params.id } : reply.code(404).send({ error: "Customer not found." });
    });

    routes.put<{ Params: { id: string }; Body: { status: JobStatus } }>("/api/eventdesk/jobs/:id/status", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } }, body: { type: "object", additionalProperties: false, required: ["status"], properties: { status: { type: "string", enum: jobStatuses } } } } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply, "jobs_manage");
      if (!departmentId) return reply;
      const result = await pool!.query("UPDATE eventdesk_jobs SET status=$3, updated_at=now() WHERE id=$1 AND department_id=$2 RETURNING id", [request.params.id, departmentId, request.body.status]);
      return result.rowCount ? { id: request.params.id, status: request.body.status } : reply.code(404).send({ error: "Job not found." });
    });

    routes.post<{ Body: { name: string; category?: string; quantity: number; dailyRateCents?: number; notes?: string } }>("/api/eventdesk/assets", { schema: { body: { type: "object", additionalProperties: false, required: ["name", "quantity"], properties: { name: { type: "string", minLength: 1, maxLength: 160 }, category: { type: "string", maxLength: 80 }, quantity: { type: "integer", minimum: 1, maximum: 100000 }, dailyRateCents: { type: "integer", minimum: 0, maximum: 100000000 }, notes: { type: "string", maxLength: 1000 } } } } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply, "inventory_manage");
      if (!departmentId) return reply;
      const body = request.body;
      const result = await pool!.query(`INSERT INTO eventdesk_assets (id,department_id,name,category,quantity,daily_rate_cents,notes)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [randomUUID(), departmentId, body.name.trim(), body.category?.trim() || "General", body.quantity, body.dailyRateCents ?? 0, body.notes?.trim() ?? ""]);
      return reply.code(201).send({ id: result.rows[0].id });
    });

    routes.put<{ Params: { id: string }; Body: { name: string; category?: string; quantity: number; dailyRateCents?: number; notes?: string; active?: boolean } }>("/api/eventdesk/assets/:id", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } }, body: { type: "object", additionalProperties: false, required: ["name", "quantity"], properties: { name: { type: "string", minLength: 1, maxLength: 160 }, category: { type: "string", maxLength: 80 }, quantity: { type: "integer", minimum: 1, maximum: 100000 }, dailyRateCents: { type: "integer", minimum: 0, maximum: 100000000 }, notes: { type: "string", maxLength: 1000 }, active: { type: "boolean" } } } } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply, "inventory_manage");
      if (!departmentId) return reply;
      const b = request.body;
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        const current = await client.query("SELECT id FROM eventdesk_assets WHERE id=$1 AND department_id=$2 FOR UPDATE", [request.params.id, departmentId]);
        if (!current.rowCount) { await rollback(client); return reply.code(404).send({ error: "Equipment item not found." }); }
        const booked = await client.query(`WITH points AS (
          SELECT j.starts_at AS moment FROM eventdesk_job_assets b JOIN eventdesk_jobs j ON j.id=b.job_id AND j.department_id=b.department_id
           WHERE b.department_id=$1 AND b.asset_id=$2 AND b.status IN ('reserved','checked_out') AND j.status NOT IN ('cancelled','completed')
          UNION SELECT j.ends_at FROM eventdesk_job_assets b JOIN eventdesk_jobs j ON j.id=b.job_id AND j.department_id=b.department_id
           WHERE b.department_id=$1 AND b.asset_id=$2 AND b.status IN ('reserved','checked_out') AND j.status NOT IN ('cancelled','completed')
        ) SELECT coalesce(max((SELECT coalesce(sum(b.quantity),0) FROM eventdesk_job_assets b JOIN eventdesk_jobs j ON j.id=b.job_id AND j.department_id=b.department_id
          WHERE b.department_id=$1 AND b.asset_id=$2 AND b.status IN ('reserved','checked_out') AND j.status NOT IN ('cancelled','completed')
            AND j.starts_at <= p.moment AND j.ends_at > p.moment)),0)::int AS quantity FROM points p`, [departmentId, request.params.id]);
        if (b.quantity < booked.rows[0].quantity) { await rollback(client); return reply.code(409).send({ error: `At least ${booked.rows[0].quantity} units are already booked at the busiest time.` }); }
        await client.query(`UPDATE eventdesk_assets SET name=$3,category=$4,quantity=$5,daily_rate_cents=$6,notes=$7,active=coalesce($8,active),updated_at=now() WHERE id=$1 AND department_id=$2`, [request.params.id, departmentId, b.name.trim(), b.category?.trim() || "General", b.quantity, b.dailyRateCents ?? 0, b.notes?.trim() ?? "", b.active ?? null]);
        await client.query("COMMIT");
        return { id: request.params.id };
      } catch (error) { await rollback(client); throw error; } finally { client.release(); }
    });

    routes.post<{ Params: { id: string }; Body: { assetId: string; quantity: number } }>("/api/eventdesk/jobs/:id/assets", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } }, body: { type: "object", additionalProperties: false, required: ["assetId", "quantity"], properties: { assetId: { type: "string", format: "uuid" }, quantity: { type: "integer", minimum: 1, maximum: 100000 } } } } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply, "inventory_manage");
      if (!departmentId) return reply;
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        const job = await client.query("SELECT starts_at,ends_at,status FROM eventdesk_jobs WHERE id=$1 AND department_id=$2 FOR SHARE", [request.params.id, departmentId]);
        if (!job.rowCount || ["cancelled", "completed"].includes(job.rows[0].status)) { await rollback(client); return reply.code(404).send({ error: "An active job is required for an equipment booking." }); }
        const asset = await client.query("SELECT name,quantity,daily_rate_cents,active FROM eventdesk_assets WHERE id=$1 AND department_id=$2 FOR UPDATE", [request.body.assetId, departmentId]);
        if (!asset.rowCount || !asset.rows[0].active) { await rollback(client); return reply.code(404).send({ error: "Active equipment item not found." }); }
        const reserved = await client.query(`WITH points AS (
          SELECT $3::timestamptz AS moment
          UNION SELECT greatest(j.starts_at, $3::timestamptz) FROM eventdesk_job_assets b JOIN eventdesk_jobs j ON j.id=b.job_id AND j.department_id=b.department_id
           WHERE b.department_id=$1 AND b.asset_id=$2 AND b.status IN ('reserved','checked_out') AND j.status NOT IN ('cancelled','completed')
             AND j.starts_at < $4 AND j.ends_at > $3
        ) SELECT coalesce(max((SELECT coalesce(sum(b.quantity),0) FROM eventdesk_job_assets b JOIN eventdesk_jobs j ON j.id=b.job_id AND j.department_id=b.department_id
          WHERE b.department_id=$1 AND b.asset_id=$2 AND b.status IN ('reserved','checked_out') AND j.status NOT IN ('cancelled','completed')
            AND j.starts_at <= p.moment AND j.ends_at > p.moment)),0)::int AS quantity FROM points p`, [departmentId, request.body.assetId, job.rows[0].starts_at, job.rows[0].ends_at]);
        const available = asset.rows[0].quantity - Number(reserved.rows[0].quantity);
        if (request.body.quantity > available) { await rollback(client); return reply.code(409).send({ error: `Only ${Math.max(0, available)} unit(s) are available for those dates.` }); }
        const result = await client.query(`INSERT INTO eventdesk_job_assets (id,department_id,job_id,asset_id,quantity,daily_rate_cents)
          VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [randomUUID(), departmentId, request.params.id, request.body.assetId, request.body.quantity, asset.rows[0].daily_rate_cents]);
        await client.query("COMMIT");
        return reply.code(201).send({ id: result.rows[0].id });
      } catch (error) { await rollback(client); throw error; } finally { client.release(); }
    });

    routes.put<{ Params: { id: string }; Body: { status: BookingStatus } }>("/api/eventdesk/bookings/:id/status", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } }, body: { type: "object", additionalProperties: false, required: ["status"], properties: { status: { type: "string", enum: bookingStatuses } } } } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply, "inventory_manage");
      if (!departmentId) return reply;
      const result = await pool!.query("UPDATE eventdesk_job_assets SET status=$3 WHERE id=$1 AND department_id=$2 RETURNING id", [request.params.id, departmentId, request.body.status]);
      return result.rowCount ? { id: request.params.id, status: request.body.status } : reply.code(404).send({ error: "Equipment booking not found." });
    });

    routes.post<{ Params: { id: string }; Body: { role: string; contactId?: string | null; hours?: number; hourlyRateCents?: number; notes?: string } }>("/api/eventdesk/jobs/:id/crew", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } }, body: { type: "object", additionalProperties: false, required: ["role"], properties: { role: { type: "string", minLength: 1, maxLength: 100 }, contactId: { type: ["string", "null"], format: "uuid" }, hours: { type: "number", minimum: 0, maximum: 1000 }, hourlyRateCents: { type: "integer", minimum: 0, maximum: 100000000 }, notes: { type: "string", maxLength: 500 } } } } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply, "crew_manage");
      if (!departmentId) return reply;
      if (!await sameDepartmentRecord("contacts", request.body.contactId, departmentId)) return reply.code(400).send({ error: "Choose a person from this location." });
      const job = await pool!.query("SELECT starts_at,ends_at,status FROM eventdesk_jobs WHERE id=$1 AND department_id=$2", [request.params.id, departmentId]);
      if (!job.rowCount || ["cancelled", "completed"].includes(job.rows[0].status)) return reply.code(404).send({ error: "An active job is required for a crew request." });
      if (request.body.contactId) {
        const conflict = await pool!.query(`SELECT 1 FROM eventdesk_job_crew c JOIN eventdesk_jobs j ON j.id=c.job_id AND j.department_id=c.department_id
          WHERE c.department_id=$1 AND c.contact_id=$2 AND c.status IN ('assigned','confirmed') AND j.status NOT IN ('cancelled','completed')
            AND j.starts_at < $4 AND j.ends_at > $3 LIMIT 1`, [departmentId, request.body.contactId, job.rows[0].starts_at, job.rows[0].ends_at]);
        if (conflict.rowCount) return reply.code(409).send({ error: "This person is already assigned to an overlapping job." });
      }
      const status = request.body.contactId ? "assigned" : "requested";
      const result = await pool!.query(`INSERT INTO eventdesk_job_crew (id,department_id,job_id,role,contact_id,hours,hourly_rate_cents,status,notes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [randomUUID(), departmentId, request.params.id, request.body.role.trim(), request.body.contactId ?? null, request.body.hours ?? 0, request.body.hourlyRateCents ?? 0, status, request.body.notes?.trim() ?? ""]);
      return reply.code(201).send({ id: result.rows[0].id, status });
    });

    routes.put<{ Params: { id: string }; Body: { contactId?: string | null; hours?: number; hourlyRateCents?: number; status?: CrewStatus; notes?: string } }>("/api/eventdesk/crew/:id", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } }, body: { type: "object", additionalProperties: false, properties: { contactId: { type: ["string", "null"], format: "uuid" }, hours: { type: "number", minimum: 0, maximum: 1000 }, hourlyRateCents: { type: "integer", minimum: 0, maximum: 100000000 }, status: { type: "string", enum: crewStatuses }, notes: { type: "string", maxLength: 500 } } } } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply, "crew_manage");
      if (!departmentId) return reply;
      const existing = await pool!.query(`SELECT c.contact_id,c.hours,c.hourly_rate_cents,c.status,c.notes,j.starts_at,j.ends_at,j.status AS job_status
        FROM eventdesk_job_crew c JOIN eventdesk_jobs j ON j.id=c.job_id AND j.department_id=c.department_id WHERE c.id=$1 AND c.department_id=$2`, [request.params.id, departmentId]);
      if (!existing.rowCount) return reply.code(404).send({ error: "Crew request not found." });
      const contactId = request.body.contactId === undefined ? existing.rows[0].contact_id : request.body.contactId;
      if (!await sameDepartmentRecord("contacts", contactId, departmentId)) return reply.code(400).send({ error: "Choose a person from this location." });
      const status = request.body.status ?? (contactId ? "assigned" : "requested");
      if (contactId && ["assigned", "confirmed"].includes(status)) {
        const conflict = await pool!.query(`SELECT 1 FROM eventdesk_job_crew c JOIN eventdesk_jobs j ON j.id=c.job_id AND j.department_id=c.department_id
          WHERE c.department_id=$1 AND c.contact_id=$2 AND c.id<>$3 AND c.status IN ('assigned','confirmed') AND j.status NOT IN ('cancelled','completed')
            AND j.starts_at < $5 AND j.ends_at > $4 LIMIT 1`, [departmentId, contactId, request.params.id, existing.rows[0].starts_at, existing.rows[0].ends_at]);
        if (conflict.rowCount) return reply.code(409).send({ error: "This person is already assigned to an overlapping job." });
      }
      const b = request.body;
      await pool!.query(`UPDATE eventdesk_job_crew SET contact_id=$3,hours=$4,hourly_rate_cents=$5,status=$6,notes=$7,updated_at=now() WHERE id=$1 AND department_id=$2`, [request.params.id, departmentId, contactId ?? null, b.hours ?? existing.rows[0].hours, b.hourlyRateCents ?? existing.rows[0].hourly_rate_cents, status, b.notes ?? existing.rows[0].notes]);
      return { id: request.params.id, contactId: contactId ?? null, status };
    });
  });
}
