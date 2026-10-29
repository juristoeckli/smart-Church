import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import type { ModuleServerContext } from "../module-sdk.js";

type JobStatus = "lead" | "quoted" | "confirmed" | "in_progress" | "completed" | "cancelled";
type BookingStatus = "reserved" | "checked_out" | "returned" | "cancelled";
type CrewStatus = "requested" | "assigned" | "confirmed" | "declined";
type Permission = "view" | "jobs_manage" | "customers_manage" | "inventory_manage" | "crew_manage" | "finance_manage" | "partners_manage";

const jobSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["title", "startsAt", "endsAt"],
    properties: {
      title: { type: "string", minLength: 1, maxLength: 160 }, customerName: { type: "string", maxLength: 160 }, customerId: { type: ["string", "null"], format: "uuid" },
      customerContactId: { type: ["string", "null"], format: "uuid" }, linkedEventId: { type: ["string", "null"], format: "uuid" }, venueId: { type: ["string", "null"], format: "uuid" },
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
const partnerSchema = { body: { type: "object", additionalProperties: false, required: ["kind", "name"], properties: {
  kind: { type: "string", enum: ["supplier", "venue"] }, name: { type: "string", minLength: 1, maxLength: 160 }, contactPerson: { type: "string", maxLength: 160 },
  email: { type: "string", maxLength: 254 }, phone: { type: "string", maxLength: 40 }, street: { type: "string", maxLength: 200 },
  postalCode: { type: "string", maxLength: 24 }, city: { type: "string", maxLength: 120 }, country: { type: "string", maxLength: 80 },
  notes: { type: "string", maxLength: 2000 }, active: { type: "boolean" },
} } };

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
        || (permission === "view" && grants.some((grant) => ["jobs_manage", "customers_manage", "inventory_manage", "crew_manage", "finance_manage", "partners_manage"].includes(grant)));
      if (!allowed) {
        reply.code(403).send({ error: "You do not have access to this EventDesk feature." });
        return null;
      }
      return id;
    }

    async function sameDepartmentRecord(table: "contacts" | "service_events" | "eventdesk_customers" | "eventdesk_partners", id: string | null | undefined, departmentId: string) {
      if (!id) return true;
      const result = await pool!.query(`SELECT 1 FROM ${table} WHERE id = $1 AND department_id = $2`, [id, departmentId]);
      return Boolean(result.rowCount);
    }

    async function rollback(client: PoolClient) { await client.query("ROLLBACK"); }

    routes.get("/api/eventdesk/bootstrap", async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const [jobs, assets, bookings, maintenance, crew, contacts, events, customers, partners, documents] = await Promise.all([
        pool!.query(`SELECT j.id, j.title, j.customer_name, j.customer_contact_id, j.linked_event_id,
                            j.customer_id, coalesce(c.name,j.customer_name) AS customer_display_name,
                            e.title AS linked_event_title, j.starts_at, j.ends_at, j.venue_id, coalesce(v.name,j.venue) AS venue, j.status, j.notes, j.created_at
                       FROM eventdesk_jobs j LEFT JOIN service_events e ON e.id=j.linked_event_id AND e.department_id=j.department_id
                       LEFT JOIN eventdesk_partners v ON v.id=j.venue_id AND v.department_id=j.department_id AND v.kind='venue'
                       LEFT JOIN eventdesk_customers c ON c.id=j.customer_id AND c.department_id=j.department_id
                      WHERE j.department_id=$1 ORDER BY j.starts_at, j.created_at DESC`, [departmentId]),
        pool!.query(`SELECT a.id, a.name, a.category, a.quantity, a.daily_rate_cents, a.active, a.notes, a.barcode, a.supplier_id, s.name AS supplier_name
                       FROM eventdesk_assets a LEFT JOIN eventdesk_partners s ON s.id=a.supplier_id AND s.department_id=a.department_id AND s.kind='supplier'
                      WHERE a.department_id=$1 ORDER BY a.active DESC, lower(a.category), lower(a.name)`, [departmentId]),
        pool!.query(`SELECT b.id, b.job_id, b.asset_id, a.name AS asset_name, a.barcode, b.quantity, b.checked_out_quantity, b.daily_rate_cents, b.status
                       FROM eventdesk_job_assets b JOIN eventdesk_assets a ON a.id=b.asset_id AND a.department_id=b.department_id
                      WHERE b.department_id=$1 ORDER BY a.name`, [departmentId]),
        pool!.query(`SELECT m.id,m.asset_id,m.starts_at,m.ends_at,m.quantity,m.status,m.notes,a.name AS asset_name
                       FROM eventdesk_asset_maintenance m JOIN eventdesk_assets a ON a.id=m.asset_id AND a.department_id=m.department_id
                      WHERE m.department_id=$1 ORDER BY m.starts_at DESC`, [departmentId]),
        pool!.query(`SELECT c.id, c.job_id, c.role, c.contact_id, trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')) AS contact_name,
                            c.hours, c.hourly_rate_cents, c.status, c.notes
                       FROM eventdesk_job_crew c LEFT JOIN contacts p ON p.id=c.contact_id AND p.department_id=c.department_id
                      WHERE c.department_id=$1 ORDER BY lower(c.role), c.created_at`, [departmentId]),
        pool!.query(`SELECT id, first_name, last_name FROM contacts WHERE department_id=$1 ORDER BY lower(last_name), lower(first_name)`, [departmentId]),
        pool!.query(`SELECT id, title, event_date, start_time FROM service_events WHERE department_id=$1 ORDER BY event_date DESC, start_time DESC LIMIT 250`, [departmentId]),
        pool!.query(`SELECT id, kind, name, contact_person, email, phone, street, postal_code, city, country, notes, active
                       FROM eventdesk_customers WHERE department_id=$1 ORDER BY active DESC, lower(name)`, [departmentId]),
        pool!.query(`SELECT id,kind,name,contact_person,email,phone,street,postal_code,city,country,notes,active
                       FROM eventdesk_partners WHERE department_id=$1 ORDER BY kind,active DESC,lower(name)`, [departmentId]),
        pool!.query(`SELECT d.id, d.job_id, j.title AS job_title, d.kind, d.document_number, d.status, d.issue_date, d.due_date,
                            d.customer_snapshot, d.lines, d.tax_rate_bps, d.subtotal_cents, d.tax_cents, d.total_cents,
                            coalesce(sum(p.amount_cents),0)::int AS paid_cents,
                            coalesce(jsonb_agg(jsonb_build_object('amountCents',p.amount_cents,'paidAt',p.paid_at,'note',p.note) ORDER BY p.paid_at)
                              FILTER (WHERE p.id IS NOT NULL),'[]'::jsonb) AS payments
                       FROM eventdesk_documents d JOIN eventdesk_jobs j ON j.id=d.job_id AND j.department_id=d.department_id
                       LEFT JOIN eventdesk_document_payments p
                         ON p.document_id=d.id AND p.department_id=d.department_id
                      WHERE d.department_id=$1 AND $2::boolean GROUP BY d.id,j.title ORDER BY d.issue_date DESC, d.created_at DESC`, [departmentId, request.activeDepartmentRole === "site_admin" || request.activeDepartmentModulePermissions?.eventdesk?.includes("finance_manage") === true]),
      ]);
      return {
        jobs: jobs.rows.map((row) => ({ id: row.id, title: row.title, customerName: row.customer_display_name, customerId: row.customer_id, customerContactId: row.customer_contact_id, linkedEventId: row.linked_event_id, linkedEventTitle: row.linked_event_title, startsAt: new Date(row.starts_at).toISOString(), endsAt: new Date(row.ends_at).toISOString(), venue: row.venue, venueId: row.venue_id, status: row.status, notes: row.notes, createdAt: new Date(row.created_at).toISOString() })),
        assets: assets.rows.map((row) => ({ id: row.id, name: row.name, category: row.category, quantity: row.quantity, dailyRateCents: row.daily_rate_cents, active: row.active, notes: row.notes, barcode: row.barcode, supplierId: row.supplier_id, supplierName: row.supplier_name })),
        bookings: bookings.rows.map((row) => ({ id: row.id, jobId: row.job_id, assetId: row.asset_id, assetName: row.asset_name, barcode: row.barcode, quantity: row.quantity, checkedOutQuantity: row.checked_out_quantity, dailyRateCents: row.daily_rate_cents, status: row.status })),
        maintenance: maintenance.rows.map((row) => ({ id: row.id, assetId: row.asset_id, assetName: row.asset_name, startsAt: new Date(row.starts_at).toISOString(), endsAt: new Date(row.ends_at).toISOString(), quantity: row.quantity, status: row.status, notes: row.notes })),
        crew: crew.rows.map((row) => ({ id: row.id, jobId: row.job_id, role: row.role, contactId: row.contact_id, contactName: row.contact_name?.trim() || null, hours: Number(row.hours), hourlyRateCents: row.hourly_rate_cents, status: row.status, notes: row.notes })),
        contacts: contacts.rows.map((row) => ({ id: row.id, name: `${row.first_name} ${row.last_name}`.trim() })),
        events: events.rows.map((row) => ({ id: row.id, title: row.title, eventDate: row.event_date, startTime: row.start_time })),
        customers: customers.rows.map((row) => ({ id: row.id, kind: row.kind, name: row.name, contactPerson: row.contact_person, email: row.email, phone: row.phone, street: row.street, postalCode: row.postal_code, city: row.city, country: row.country, notes: row.notes, active: row.active })),
        partners: partners.rows.map((row) => ({ id: row.id, kind: row.kind, name: row.name, contactPerson: row.contact_person, email: row.email, phone: row.phone, street: row.street, postalCode: row.postal_code, city: row.city, country: row.country, notes: row.notes, active: row.active })),
        documents: documents.rows.map((row) => ({ id: row.id, jobId: row.job_id, jobTitle: row.job_title, kind: row.kind, number: row.document_number, status: row.status, issueDate: row.issue_date, dueDate: row.due_date, customer: row.customer_snapshot, lines: row.lines, taxRateBps: row.tax_rate_bps, subtotalCents: row.subtotal_cents, taxCents: row.tax_cents, totalCents: row.total_cents, paidCents: row.paid_cents, payments: row.payments })),
        permissions: { jobs: request.activeDepartmentRole === "site_admin" || request.activeDepartmentModulePermissions?.eventdesk?.includes("jobs_manage") === true, customers: request.activeDepartmentRole === "site_admin" || request.activeDepartmentModulePermissions?.eventdesk?.includes("customers_manage") === true, inventory: request.activeDepartmentRole === "site_admin" || request.activeDepartmentModulePermissions?.eventdesk?.includes("inventory_manage") === true, crew: request.activeDepartmentRole === "site_admin" || request.activeDepartmentModulePermissions?.eventdesk?.includes("crew_manage") === true, finance: request.activeDepartmentRole === "site_admin" || request.activeDepartmentModulePermissions?.eventdesk?.includes("finance_manage") === true, partners: request.activeDepartmentRole === "site_admin" || request.activeDepartmentModulePermissions?.eventdesk?.includes("partners_manage") === true },
      };
    });

    routes.post<{ Params: { id: string }; Body: { kind: "quote" | "invoice" | "contract" | "delivery_note"; taxRateBps?: number; dueDate?: string } }>("/api/eventdesk/jobs/:id/documents", { schema: {
      params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["kind"], properties: { kind: { type: "string", enum: ["quote", "invoice", "contract", "delivery_note"] }, taxRateBps: { type: "integer", minimum: 0, maximum: 3000 }, dueDate: { type: "string", format: "date" } } },
    } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply, "finance_manage");
      if (!departmentId) return reply;
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        const jobResult = await client.query(`SELECT j.id,j.title,j.customer_name,j.customer_id,j.starts_at,j.ends_at,j.venue,j.notes,
            c.kind,c.name,c.contact_person,c.email,c.phone,c.street,c.postal_code,c.city,c.country
          FROM eventdesk_jobs j LEFT JOIN eventdesk_customers c ON c.id=j.customer_id AND c.department_id=j.department_id
         WHERE j.id=$1 AND j.department_id=$2 FOR UPDATE OF j`, [request.params.id, departmentId]);
        if (!jobResult.rowCount) { await rollback(client); return reply.code(404).send({ error: "Job not found." }); }
        const job = jobResult.rows[0];
        const [assetRows, crewRows] = await Promise.all([
          client.query(`SELECT a.name,b.quantity,b.daily_rate_cents FROM eventdesk_job_assets b JOIN eventdesk_assets a ON a.id=b.asset_id AND a.department_id=b.department_id WHERE b.job_id=$1 AND b.department_id=$2 AND b.status <> 'cancelled' ORDER BY a.name`, [job.id, departmentId]),
          client.query(`SELECT role,hours,hourly_rate_cents FROM eventdesk_job_crew WHERE job_id=$1 AND department_id=$2 AND status <> 'declined' ORDER BY role`, [job.id, departmentId]),
        ]);
        const days = Math.max(1, Math.ceil((new Date(job.ends_at).getTime() - new Date(job.starts_at).getTime()) / 86400000));
        const assetLines = assetRows.rows.map((line) => ({ description: line.name, quantity: Number(line.quantity), unitCents: request.body.kind === "delivery_note" ? 0 : Number(line.daily_rate_cents), unitLabel: `day${days === 1 ? "" : "s"}`, lineTotalCents: request.body.kind === "delivery_note" ? 0 : Number(line.quantity) * Number(line.daily_rate_cents) * days }));
        const crewLines = crewRows.rows.map((line) => ({ description: `${line.role} (crew)`, quantity: Number(line.hours), unitCents: Number(line.hourly_rate_cents), unitLabel: "hour", lineTotalCents: Math.round(Number(line.hours) * Number(line.hourly_rate_cents)) }));
        const lines = request.body.kind === "delivery_note" ? assetLines : [...assetLines, ...crewLines];
        if (!lines.length) { await rollback(client); return reply.code(400).send({ error: request.body.kind === "delivery_note" ? "Add equipment to the job before creating a delivery note." : "Add equipment or crew to the job before creating this document." }); }
        const subtotal = request.body.kind === "delivery_note" ? 0 : lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
        const taxRateBps = request.body.taxRateBps ?? 0;
        const tax = Math.round(subtotal * taxRateBps / 10000);
        const seq = await client.query(`INSERT INTO eventdesk_document_sequences (department_id,kind,last_number) VALUES ($1,$2,1)
          ON CONFLICT (department_id,kind) DO UPDATE SET last_number=eventdesk_document_sequences.last_number+1 RETURNING last_number`, [departmentId, request.body.kind]);
        const prefix = { quote: "Q", invoice: "I", contract: "C", delivery_note: "DN" }[request.body.kind];
        const number = `${prefix}-${new Date().getFullYear()}-${String(seq.rows[0].last_number).padStart(5, "0")}`;
        const customer = { name: job.name ?? job.customer_name, kind: job.kind ?? null, contactPerson: job.contact_person ?? "", email: job.email ?? "", phone: job.phone ?? "", street: job.street ?? "", postalCode: job.postal_code ?? "", city: job.city ?? "", country: job.country ?? "", jobTitle: job.title, venue: job.venue, startsAt: job.starts_at, endsAt: job.ends_at, jobNotes: job.notes };
        const inserted = await client.query(`INSERT INTO eventdesk_documents
          (id,department_id,job_id,kind,document_number,status,due_date,customer_snapshot,lines,tax_rate_bps,subtotal_cents,tax_cents,total_cents)
          VALUES ($1,$2,$3,$4,$5,'draft',$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12) RETURNING id`,
          [randomUUID(), departmentId, job.id, request.body.kind, number, request.body.dueDate ?? null, JSON.stringify(customer), JSON.stringify(lines), taxRateBps, subtotal, tax, subtotal + tax]);
        await client.query("COMMIT");
        return reply.code(201).send({ id: inserted.rows[0].id, number });
      } catch (error) { await rollback(client); throw error; } finally { client.release(); }
    });

    routes.put<{ Params: { id: string }; Body: { status: "sent" | "accepted" | "signed" | "rejected" | "cancelled" | "returned" } }>("/api/eventdesk/documents/:id/status", { schema: {
      params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["status"], properties: { status: { type: "string", enum: ["sent", "accepted", "signed", "rejected", "cancelled", "returned"] } } },
    } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply, "finance_manage");
      if (!departmentId) return reply;
      const result = await pool!.query(`UPDATE eventdesk_documents SET status=$3,updated_at=now()
        WHERE id=$1 AND department_id=$2 AND (
          (status='draft' AND $3='sent') OR
          (kind='quote' AND status='sent' AND $3 IN ('accepted','rejected')) OR
          (kind='contract' AND status='sent' AND $3 IN ('signed','rejected','cancelled')) OR
          (kind='delivery_note' AND status='sent' AND $3='returned') OR
          (kind='invoice' AND status IN ('draft','sent') AND $3='cancelled')
        ) RETURNING id,job_id,kind`, [request.params.id, departmentId, request.body.status]);
      if (!result.rowCount) return reply.code(409).send({ error: "That document cannot move to the requested status." });
      if ((result.rows[0].kind === "quote" && request.body.status === "accepted") || (result.rows[0].kind === "contract" && request.body.status === "signed")) {
        await pool!.query("UPDATE eventdesk_jobs SET status='confirmed',updated_at=now() WHERE id=$1 AND department_id=$2 AND status IN ('lead','quoted')", [result.rows[0].job_id, departmentId]);
      }
      return { id: request.params.id, status: request.body.status };
    });

    routes.post<{ Params: { id: string }; Body: { amountCents: number; paidAt?: string; note?: string } }>("/api/eventdesk/documents/:id/payments", { schema: {
      params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["amountCents"], properties: { amountCents: { type: "integer", minimum: 1, maximum: 1000000000 }, paidAt: { type: "string", format: "date" }, note: { type: "string", maxLength: 500 } } },
    } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply, "finance_manage");
      if (!departmentId) return reply;
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        const document = await client.query("SELECT total_cents,status FROM eventdesk_documents WHERE id=$1 AND department_id=$2 AND kind='invoice' FOR UPDATE", [request.params.id, departmentId]);
        if (!document.rowCount || !["sent", "partial"].includes(document.rows[0].status)) { await rollback(client); return reply.code(404).send({ error: "A sent, unpaid invoice was not found." }); }
        const paid = await client.query("SELECT coalesce(sum(amount_cents),0)::int AS amount FROM eventdesk_document_payments WHERE document_id=$1 AND department_id=$2", [request.params.id, departmentId]);
        const nextPaid = Number(paid.rows[0].amount) + request.body.amountCents;
        if (nextPaid > Number(document.rows[0].total_cents)) { await rollback(client); return reply.code(400).send({ error: "Payment exceeds the invoice balance." }); }
        await client.query("INSERT INTO eventdesk_document_payments (id,department_id,document_id,amount_cents,paid_at,note) VALUES ($1,$2,$3,$4,$5,$6)", [randomUUID(), departmentId, request.params.id, request.body.amountCents, request.body.paidAt ?? new Date().toISOString().slice(0, 10), request.body.note?.trim() ?? ""]);
        const status = nextPaid === Number(document.rows[0].total_cents) ? "paid" : "partial";
        await client.query("UPDATE eventdesk_documents SET status=$3,updated_at=now() WHERE id=$1 AND department_id=$2", [request.params.id, departmentId, status]);
        await client.query("COMMIT");
        return { id: request.params.id, paidCents: nextPaid, status };
      } catch (error) { await rollback(client); throw error; } finally { client.release(); }
    });

    routes.post<{ Body: { title: string; customerName?: string; customerId?: string | null; customerContactId?: string | null; linkedEventId?: string | null; venueId?: string | null; startsAt: string; endsAt: string; venue?: string; notes?: string } }>("/api/eventdesk/jobs", { schema: jobSchema }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply, "jobs_manage");
      if (!departmentId) return reply;
      const body = request.body;
      if (new Date(body.endsAt) <= new Date(body.startsAt)) return reply.code(400).send({ error: "The job end must be after its start." });
      if (!await sameDepartmentRecord("contacts", body.customerContactId, departmentId) || !await sameDepartmentRecord("service_events", body.linkedEventId, departmentId) || !await sameDepartmentRecord("eventdesk_partners", body.venueId, departmentId)) return reply.code(400).send({ error: "Choose a person, event, or venue from this location." });
      let venue = body.venue?.trim() ?? "";
      if (body.venueId) {
        const savedVenue = await pool!.query("SELECT name FROM eventdesk_partners WHERE id=$1 AND department_id=$2 AND kind='venue' AND active=true", [body.venueId, departmentId]);
        if (!savedVenue.rowCount) return reply.code(400).send({ error: "Choose an active venue from this location." });
        venue = savedVenue.rows[0].name;
      }
      let customerName = body.customerName?.trim() ?? "";
      if (body.customerId) {
        const customer = await pool!.query("SELECT name FROM eventdesk_customers WHERE id=$1 AND department_id=$2 AND active=true", [body.customerId, departmentId]);
        if (!customer.rowCount) return reply.code(400).send({ error: "Choose an active customer from this location." });
        customerName = customer.rows[0].name;
      }
      const result = await pool!.query(`INSERT INTO eventdesk_jobs (id,department_id,title,customer_name,customer_id,customer_contact_id,linked_event_id,venue_id,starts_at,ends_at,venue,notes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`, [randomUUID(), departmentId, body.title.trim(), customerName, body.customerId ?? null, body.customerContactId ?? null, body.linkedEventId ?? null, body.venueId ?? null, body.startsAt, body.endsAt, venue, body.notes?.trim() ?? ""]);
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

    routes.post<{ Body: { kind: "supplier" | "venue"; name: string; contactPerson?: string; email?: string; phone?: string; street?: string; postalCode?: string; city?: string; country?: string; notes?: string } }>("/api/eventdesk/partners", { schema: partnerSchema }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply, "partners_manage");
      if (!departmentId) return reply;
      const b = request.body;
      const result = await pool!.query(`INSERT INTO eventdesk_partners (id,department_id,kind,name,contact_person,email,phone,street,postal_code,city,country,notes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`, [randomUUID(), departmentId, b.kind, b.name.trim(), b.contactPerson?.trim() ?? "", b.email?.trim() ?? "", b.phone?.trim() ?? "", b.street?.trim() ?? "", b.postalCode?.trim() ?? "", b.city?.trim() ?? "", b.country?.trim() ?? "", b.notes?.trim() ?? ""]);
      return reply.code(201).send({ id: result.rows[0].id });
    });

    routes.put<{ Params: { id: string }; Body: { kind: "supplier" | "venue"; name: string; contactPerson?: string; email?: string; phone?: string; street?: string; postalCode?: string; city?: string; country?: string; notes?: string; active?: boolean } }>("/api/eventdesk/partners/:id", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } }, body: partnerSchema.body } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply, "partners_manage");
      if (!departmentId) return reply;
      const b = request.body;
      const result = await pool!.query(`UPDATE eventdesk_partners SET name=$4,contact_person=$5,email=$6,phone=$7,street=$8,postal_code=$9,city=$10,country=$11,notes=$12,active=coalesce($13,active),updated_at=now()
        WHERE id=$1 AND department_id=$2 AND kind=$3 RETURNING id`, [request.params.id, departmentId, b.kind, b.name.trim(), b.contactPerson?.trim() ?? "", b.email?.trim() ?? "", b.phone?.trim() ?? "", b.street?.trim() ?? "", b.postalCode?.trim() ?? "", b.city?.trim() ?? "", b.country?.trim() ?? "", b.notes?.trim() ?? "", b.active ?? null]);
      return result.rowCount ? { id: request.params.id } : reply.code(404).send({ error: "Supplier or venue not found, or its type does not match." });
    });

    routes.put<{ Params: { id: string }; Body: { status: JobStatus } }>("/api/eventdesk/jobs/:id/status", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } }, body: { type: "object", additionalProperties: false, required: ["status"], properties: { status: { type: "string", enum: jobStatuses } } } } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply, "jobs_manage");
      if (!departmentId) return reply;
      const result = await pool!.query("UPDATE eventdesk_jobs SET status=$3, updated_at=now() WHERE id=$1 AND department_id=$2 RETURNING id", [request.params.id, departmentId, request.body.status]);
      return result.rowCount ? { id: request.params.id, status: request.body.status } : reply.code(404).send({ error: "Job not found." });
    });

    routes.post<{ Body: { name: string; category?: string; quantity: number; dailyRateCents?: number; notes?: string; barcode?: string; supplierId?: string | null } }>("/api/eventdesk/assets", { schema: { body: { type: "object", additionalProperties: false, required: ["name", "quantity"], properties: { name: { type: "string", minLength: 1, maxLength: 160 }, category: { type: "string", maxLength: 80 }, quantity: { type: "integer", minimum: 1, maximum: 100000 }, dailyRateCents: { type: "integer", minimum: 0, maximum: 100000000 }, notes: { type: "string", maxLength: 1000 }, barcode: { type: "string", maxLength: 120 }, supplierId: { type: ["string", "null"], format: "uuid" } } } } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply, "inventory_manage");
      if (!departmentId) return reply;
      const body = request.body;
      if (!await sameDepartmentRecord("eventdesk_partners", body.supplierId, departmentId)) return reply.code(400).send({ error: "Choose a supplier from this location." });
      if (body.supplierId && !(await pool!.query("SELECT 1 FROM eventdesk_partners WHERE id=$1 AND department_id=$2 AND kind='supplier'", [body.supplierId, departmentId])).rowCount) return reply.code(400).send({ error: "Choose a supplier, not a venue." });
      const result = await pool!.query(`INSERT INTO eventdesk_assets (id,department_id,name,category,quantity,daily_rate_cents,notes,barcode,supplier_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [randomUUID(), departmentId, body.name.trim(), body.category?.trim() || "General", body.quantity, body.dailyRateCents ?? 0, body.notes?.trim() ?? "", body.barcode?.trim() ?? "", body.supplierId ?? null]);
      return reply.code(201).send({ id: result.rows[0].id });
    });

    routes.put<{ Params: { id: string }; Body: { name: string; category?: string; quantity: number; dailyRateCents?: number; notes?: string; active?: boolean; barcode?: string; supplierId?: string | null } }>("/api/eventdesk/assets/:id", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } }, body: { type: "object", additionalProperties: false, required: ["name", "quantity"], properties: { name: { type: "string", minLength: 1, maxLength: 160 }, category: { type: "string", maxLength: 80 }, quantity: { type: "integer", minimum: 1, maximum: 100000 }, dailyRateCents: { type: "integer", minimum: 0, maximum: 100000000 }, notes: { type: "string", maxLength: 1000 }, active: { type: "boolean" }, barcode: { type: "string", maxLength: 120 }, supplierId: { type: ["string", "null"], format: "uuid" } } } } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply, "inventory_manage");
      if (!departmentId) return reply;
      const b = request.body;
      if (!await sameDepartmentRecord("eventdesk_partners", b.supplierId, departmentId)) return reply.code(400).send({ error: "Choose a supplier from this location." });
      if (b.supplierId && !(await pool!.query("SELECT 1 FROM eventdesk_partners WHERE id=$1 AND department_id=$2 AND kind='supplier'", [b.supplierId, departmentId])).rowCount) return reply.code(400).send({ error: "Choose a supplier, not a venue." });
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
          UNION SELECT m.starts_at FROM eventdesk_asset_maintenance m WHERE m.department_id=$1 AND m.asset_id=$2 AND m.status IN ('scheduled','in_progress')
          UNION SELECT m.ends_at FROM eventdesk_asset_maintenance m WHERE m.department_id=$1 AND m.asset_id=$2 AND m.status IN ('scheduled','in_progress')
        ) SELECT coalesce(max((SELECT coalesce(sum(b.quantity),0) FROM eventdesk_job_assets b JOIN eventdesk_jobs j ON j.id=b.job_id AND j.department_id=b.department_id
          WHERE b.department_id=$1 AND b.asset_id=$2 AND b.status IN ('reserved','checked_out') AND j.status NOT IN ('cancelled','completed')
            AND j.starts_at <= p.moment AND j.ends_at > p.moment)+(SELECT coalesce(sum(m.quantity),0) FROM eventdesk_asset_maintenance m
            WHERE m.department_id=$1 AND m.asset_id=$2 AND m.status IN ('scheduled','in_progress') AND m.starts_at<=p.moment AND m.ends_at>p.moment)),0)::int AS quantity FROM points p`, [departmentId, request.params.id]);
        if (b.quantity < booked.rows[0].quantity) { await rollback(client); return reply.code(409).send({ error: `At least ${booked.rows[0].quantity} units are already booked at the busiest time.` }); }
        await client.query(`UPDATE eventdesk_assets SET name=$3,category=$4,quantity=$5,daily_rate_cents=$6,notes=$7,active=coalesce($8,active),barcode=$9,supplier_id=$10,updated_at=now() WHERE id=$1 AND department_id=$2`, [request.params.id, departmentId, b.name.trim(), b.category?.trim() || "General", b.quantity, b.dailyRateCents ?? 0, b.notes?.trim() ?? "", b.active ?? null, b.barcode?.trim() ?? "", b.supplierId ?? null]);
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
           WHERE b.department_id=$1 AND b.asset_id=$2 AND b.status IN ('reserved','checked_out') AND j.status NOT IN ('cancelled','completed') AND j.starts_at < $4 AND j.ends_at > $3
          UNION SELECT greatest(m.starts_at, $3::timestamptz) FROM eventdesk_asset_maintenance m
           WHERE m.department_id=$1 AND m.asset_id=$2 AND m.status IN ('scheduled','in_progress') AND m.starts_at < $4 AND m.ends_at > $3
        ) SELECT coalesce(max(
          (SELECT coalesce(sum(b.quantity),0) FROM eventdesk_job_assets b JOIN eventdesk_jobs j ON j.id=b.job_id AND j.department_id=b.department_id
            WHERE b.department_id=$1 AND b.asset_id=$2 AND b.status IN ('reserved','checked_out') AND j.status NOT IN ('cancelled','completed') AND j.starts_at <= p.moment AND j.ends_at > p.moment)
          +(SELECT coalesce(sum(m.quantity),0) FROM eventdesk_asset_maintenance m WHERE m.department_id=$1 AND m.asset_id=$2 AND m.status IN ('scheduled','in_progress') AND m.starts_at <= p.moment AND m.ends_at > p.moment)
        ),0)::int AS quantity FROM points p`, [departmentId, request.body.assetId, job.rows[0].starts_at, job.rows[0].ends_at]);
        const available = asset.rows[0].quantity - Number(reserved.rows[0].quantity);
        if (request.body.quantity > available) { await rollback(client); return reply.code(409).send({ error: `Only ${Math.max(0, available)} unit(s) are available for those dates.` }); }
        const result = await client.query(`INSERT INTO eventdesk_job_assets (id,department_id,job_id,asset_id,quantity,daily_rate_cents)
          VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [randomUUID(), departmentId, request.params.id, request.body.assetId, request.body.quantity, asset.rows[0].daily_rate_cents]);
        await client.query("COMMIT");
        return reply.code(201).send({ id: result.rows[0].id });
      } catch (error) { await rollback(client); throw error; } finally { client.release(); }
    });

    routes.post<{ Body: { assetId: string; startsAt: string; endsAt: string; quantity: number; notes?: string } }>("/api/eventdesk/maintenance", { schema: { body: {
      type: "object", additionalProperties: false, required: ["assetId", "startsAt", "endsAt", "quantity"], properties: {
        assetId: { type: "string", format: "uuid" }, startsAt: { type: "string", format: "date-time" }, endsAt: { type: "string", format: "date-time" },
        quantity: { type: "integer", minimum: 1, maximum: 100000 }, notes: { type: "string", maxLength: 1000 },
      },
    } } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply, "inventory_manage");
      if (!departmentId) return reply;
      if (new Date(request.body.endsAt) <= new Date(request.body.startsAt)) return reply.code(400).send({ error: "Maintenance end must be after its start." });
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        const asset = await client.query("SELECT quantity,active FROM eventdesk_assets WHERE id=$1 AND department_id=$2 FOR UPDATE", [request.body.assetId, departmentId]);
        if (!asset.rowCount || !asset.rows[0].active) { await rollback(client); return reply.code(404).send({ error: "Active equipment item not found." }); }
        if (request.body.quantity > Number(asset.rows[0].quantity)) { await rollback(client); return reply.code(400).send({ error: "Maintenance quantity cannot exceed the equipment stock." }); }
        const reserved = await client.query(`WITH points AS (
          SELECT $3::timestamptz AS moment
          UNION SELECT greatest(j.starts_at,$3::timestamptz) FROM eventdesk_job_assets b JOIN eventdesk_jobs j ON j.id=b.job_id AND j.department_id=b.department_id
           WHERE b.department_id=$1 AND b.asset_id=$2 AND b.status IN ('reserved','checked_out') AND j.status NOT IN ('cancelled','completed') AND j.starts_at<$4 AND j.ends_at>$3
          UNION SELECT greatest(m.starts_at,$3::timestamptz) FROM eventdesk_asset_maintenance m
           WHERE m.department_id=$1 AND m.asset_id=$2 AND m.status IN ('scheduled','in_progress') AND m.starts_at<$4 AND m.ends_at>$3
        ) SELECT coalesce(max(
          (SELECT coalesce(sum(b.quantity),0) FROM eventdesk_job_assets b JOIN eventdesk_jobs j ON j.id=b.job_id AND j.department_id=b.department_id
            WHERE b.department_id=$1 AND b.asset_id=$2 AND b.status IN ('reserved','checked_out') AND j.status NOT IN ('cancelled','completed') AND j.starts_at<=p.moment AND j.ends_at>p.moment)
          +(SELECT coalesce(sum(m.quantity),0) FROM eventdesk_asset_maintenance m WHERE m.department_id=$1 AND m.asset_id=$2 AND m.status IN ('scheduled','in_progress') AND m.starts_at<=p.moment AND m.ends_at>p.moment)
        ),0)::int AS quantity FROM points p`, [departmentId, request.body.assetId, request.body.startsAt, request.body.endsAt]);
        if (Number(reserved.rows[0].quantity) + request.body.quantity > Number(asset.rows[0].quantity)) { await rollback(client); return reply.code(409).send({ error: "That maintenance window overlaps jobs or other maintenance beyond the available stock." }); }
        const result = await client.query(`INSERT INTO eventdesk_asset_maintenance (id,department_id,asset_id,starts_at,ends_at,quantity,notes)
          VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [randomUUID(), departmentId, request.body.assetId, request.body.startsAt, request.body.endsAt, request.body.quantity, request.body.notes?.trim() ?? ""]);
        await client.query("COMMIT");
        return reply.code(201).send({ id: result.rows[0].id });
      } catch (error) { await rollback(client); throw error; } finally { client.release(); }
    });

    routes.put<{ Params: { id: string }; Body: { status: "in_progress" | "completed" | "cancelled" } }>("/api/eventdesk/maintenance/:id/status", { schema: {
      params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["status"], properties: { status: { type: "string", enum: ["in_progress", "completed", "cancelled"] } } },
    } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply, "inventory_manage");
      if (!departmentId) return reply;
      const result = await pool!.query("UPDATE eventdesk_asset_maintenance SET status=$3,updated_at=now() WHERE id=$1 AND department_id=$2 AND status IN ('scheduled','in_progress') RETURNING id", [request.params.id, departmentId, request.body.status]);
      return result.rowCount ? { id: request.params.id, status: request.body.status } : reply.code(404).send({ error: "Open maintenance task not found." });
    });

    routes.put<{ Params: { id: string }; Body: { status: BookingStatus } }>("/api/eventdesk/bookings/:id/status", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } }, body: { type: "object", additionalProperties: false, required: ["status"], properties: { status: { type: "string", enum: bookingStatuses } } } } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply, "inventory_manage");
      if (!departmentId) return reply;
      const result = await pool!.query(`UPDATE eventdesk_job_assets SET status=$3,
        checked_out_quantity=CASE WHEN $3='checked_out' THEN quantity WHEN $3 IN ('returned','cancelled','reserved') THEN 0 ELSE checked_out_quantity END
        WHERE id=$1 AND department_id=$2 AND NOT ($3='cancelled' AND checked_out_quantity>0) RETURNING id`, [request.params.id, departmentId, request.body.status]);
      return result.rowCount ? { id: request.params.id, status: request.body.status } : reply.code(409).send({ error: "Equipment booking not found or checked-out units must be checked in first." });
    });

    routes.post<{ Body: { jobId: string; barcode: string; action: "out" | "in" } }>("/api/eventdesk/warehouse/scan", { schema: { body: {
      type: "object", additionalProperties: false, required: ["jobId", "barcode", "action"], properties: {
        jobId: { type: "string", format: "uuid" }, barcode: { type: "string", minLength: 1, maxLength: 120 }, action: { type: "string", enum: ["out", "in"] },
      },
    } } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply, "inventory_manage");
      if (!departmentId) return reply;
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        const job = await client.query("SELECT status FROM eventdesk_jobs WHERE id=$1 AND department_id=$2 FOR SHARE", [request.body.jobId, departmentId]);
        if (!job.rowCount || ["cancelled", "completed"].includes(job.rows[0].status)) { await rollback(client); return reply.code(404).send({ error: "An active job is required for warehouse scanning." }); }
        const current = await client.query(`SELECT b.id,b.quantity,b.checked_out_quantity,b.status,a.name AS asset_name
          FROM eventdesk_job_assets b JOIN eventdesk_assets a ON a.id=b.asset_id AND a.department_id=b.department_id
         WHERE b.job_id=$1 AND b.department_id=$2 AND lower(a.barcode)=lower($3)
           AND (($4='out' AND b.status IN ('reserved','checked_out') AND b.checked_out_quantity < b.quantity)
             OR ($4='in' AND b.status='checked_out' AND b.checked_out_quantity > 0))
         ORDER BY b.created_at LIMIT 1 FOR UPDATE OF b`, [request.body.jobId, departmentId, request.body.barcode.trim(), request.body.action]);
        if (!current.rowCount) { await rollback(client); return reply.code(404).send({ error: "No matching item is due for that scan on this job." }); }
        const line = current.rows[0];
        const checkedOut = Number(line.checked_out_quantity) + (request.body.action === "out" ? 1 : -1);
        const status = checkedOut > 0 ? "checked_out" : request.body.action === "in" ? "returned" : "reserved";
        await client.query("UPDATE eventdesk_job_assets SET checked_out_quantity=$3,status=$4 WHERE id=$1 AND department_id=$2", [line.id, departmentId, checkedOut, status]);
        await client.query("COMMIT");
        return { id: line.id, assetName: line.asset_name, checkedOutQuantity: checkedOut, quantity: Number(line.quantity), status };
      } catch (error) { await rollback(client); throw error; } finally { client.release(); }
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
