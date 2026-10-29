import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import type { ModuleServerContext } from "../module-sdk.js";
import { createDocumentEmailHtml, createDocumentPdf, jpegDimensions } from "./documents.js";

type JobStatus = "lead" | "quoted" | "confirmed" | "in_progress" | "completed" | "cancelled";
type BookingStatus = "reserved" | "checked_out" | "returned" | "cancelled";
type CrewStatus = "requested" | "assigned" | "invited" | "confirmed" | "declined";
type Permission = "view" | "jobs_manage" | "customers_manage" | "inventory_manage" | "crew_manage" | "finance_manage" | "partners_manage";

const jobSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["title", "startsAt", "endsAt"],
    properties: {
      title: { type: "string", minLength: 1, maxLength: 160 }, customerName: { type: "string", maxLength: 160 }, customerId: { type: ["string", "null"], format: "uuid" },
      customerContactId: { type: ["string", "null"], format: "uuid" }, linkedEventId: { type: ["string", "null"], format: "uuid" }, venueId: { type: ["string", "null"], format: "uuid" },
      supplierRateCardId: { type: ["string", "null"], format: "uuid" },
      startsAt: { type: "string", format: "date-time" }, endsAt: { type: "string", format: "date-time" },
      venue: { type: "string", maxLength: 240 }, notes: { type: "string", maxLength: 4000 },
    },
  },
};

const jobStatuses = ["lead", "quoted", "confirmed", "in_progress", "completed", "cancelled"] as const;
const bookingStatuses = ["reserved", "checked_out", "returned", "cancelled"] as const;
const crewStatuses = ["requested", "assigned", "invited", "confirmed", "declined"] as const;
const customerSchema = {
  body: { type: "object", additionalProperties: false, required: ["kind", "name"], properties: {
    kind: { type: "string", enum: ["company", "person"] }, name: { type: "string", minLength: 1, maxLength: 160 },
    contactPerson: { type: "string", maxLength: 160 }, email: { type: "string", maxLength: 254 }, phone: { type: "string", maxLength: 40 },
    street: { type: "string", maxLength: 200 }, postalCode: { type: "string", maxLength: 24 }, city: { type: "string", maxLength: 120 },
    country: { type: "string", maxLength: 80 }, notes: { type: "string", maxLength: 2000 }, active: { type: "boolean" }, defaultDiscountBps: { type: "integer", minimum: 0, maximum: 10000 },
  } },
};
const partnerSchema = { body: { type: "object", additionalProperties: false, required: ["kind", "name"], properties: {
  kind: { type: "string", enum: ["supplier", "venue"] }, name: { type: "string", minLength: 1, maxLength: 160 }, contactPerson: { type: "string", maxLength: 160 },
  email: { type: "string", maxLength: 254 }, phone: { type: "string", maxLength: 40 }, street: { type: "string", maxLength: 200 },
  postalCode: { type: "string", maxLength: 24 }, city: { type: "string", maxLength: 120 }, country: { type: "string", maxLength: 80 },
  notes: { type: "string", maxLength: 2000 }, active: { type: "boolean" },
} } };
const packageSchema = { body: { type: "object", additionalProperties: false, required: ["name", "items"], properties: {
  name: { type: "string", minLength: 1, maxLength: 160 }, description: { type: "string", maxLength: 1000 },
  discountBps: { type: "integer", minimum: 0, maximum: 10000 },
  items: { type: "array", minItems: 1, maxItems: 40, items: { type: "object", additionalProperties: false, required: ["assetId", "quantity"], properties: { assetId: { type: "string", format: "uuid" }, quantity: { type: "integer", minimum: 1, maximum: 100000 } } } },
} } };
const supplierRateCardSchema = { body: { type: "object", additionalProperties: false, required: ["supplierId", "name", "validFrom", "lines"], properties: {
  supplierId: { type: "string", format: "uuid" }, name: { type: "string", minLength: 1, maxLength: 160 }, validFrom: { type: "string", format: "date" }, validTo: { type: ["string", "null"], format: "date" },
  lines: { type: "array", minItems: 1, maxItems: 500, items: { type: "object", additionalProperties: false, required: ["dailyRateCents"], properties: { assetId: { type: "string", format: "uuid" }, category: { type: "string", minLength: 1, maxLength: 80 }, dailyRateCents: { type: "integer", minimum: 0, maximum: 100000000 } } } },
} } };
const documentSettingsSchema = { body: { type: "object", additionalProperties: false, required: ["businessName", "street", "postalCode", "city", "country", "email", "phone", "taxIdentifier", "paymentTerms", "footer"], properties: {
  businessName: { type: "string", maxLength: 160 }, street: { type: "string", maxLength: 200 }, postalCode: { type: "string", maxLength: 24 }, city: { type: "string", maxLength: 120 },
  country: { type: "string", maxLength: 80 }, email: { type: "string", maxLength: 254 }, phone: { type: "string", maxLength: 40 }, taxIdentifier: { type: "string", maxLength: 80 },
  paymentTerms: { type: "string", maxLength: 1000 }, footer: { type: "string", maxLength: 1000 },
  logoJpegBase64: { type: ["string", "null"], maxLength: 350000 },
  templates: { type: "object", additionalProperties: false, properties: Object.fromEntries(["quote", "contract", "delivery_note", "invoice", "deposit_invoice", "credit_note"].map((kind) => [kind, { type: "object", additionalProperties: false, properties: { title: { type: "string", maxLength: 120 }, intro: { type: "string", maxLength: 1000 }, footer: { type: "string", maxLength: 1000 } } }])) },
  taxProfiles: { type: "array", maxItems: 20, items: { type: "object", additionalProperties: false, required: ["id", "name", "rateBps", "legalText"], properties: { id: { type: "string", minLength: 1, maxLength: 80 }, name: { type: "string", minLength: 1, maxLength: 80 }, rateBps: { type: "integer", minimum: 0, maximum: 3000 }, legalText: { type: "string", maxLength: 1000 } } } },
} } };

export function registerModuleRoutes(app: FastifyInstance, context: ModuleServerContext) {
  const { pool, isDatabaseReady, resolveDepartmentId, validateMutation } = context;
  const resendApiKey = () => process.env.SMART_CHURCH_RESEND_API_KEY?.trim() || process.env.RESEND_API_KEY?.trim() || "";
  const emailFrom = () => process.env.SMART_CHURCH_EMAIL_FROM?.trim() || process.env.EVENTDESK_EMAIL_FROM?.trim() || "";

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

    async function sameDepartmentRecord(table: "contacts" | "service_events" | "eventdesk_customers" | "eventdesk_partners" | "eventdesk_freelancers", id: string | null | undefined, departmentId: string) {
      if (!id) return true;
      const result = await pool!.query(`SELECT 1 FROM ${table} WHERE id = $1 AND department_id = $2`, [id, departmentId]);
      return Boolean(result.rowCount);
    }

    async function rollback(client: PoolClient) { await client.query("ROLLBACK"); }

    async function rentalRate(client: PoolClient, departmentId: string, rateCardId: string | null, startsAt: Date | string, asset: { id: string; category: string; daily_rate_cents: number; supplier_id: string | null }) {
      if (!rateCardId) return Number(asset.daily_rate_cents);
      const result = await client.query(`SELECT l.daily_rate_cents
        FROM eventdesk_supplier_rate_cards c JOIN eventdesk_supplier_rate_lines l ON l.rate_card_id=c.id AND l.department_id=c.department_id
        WHERE c.id=$1 AND c.department_id=$2 AND c.supplier_id=$6 AND c.active=true AND c.valid_from<=$3::date AND (c.valid_to IS NULL OR c.valid_to>=$3::date)
          AND (l.asset_id=$4 OR (l.asset_id IS NULL AND lower(l.category)=lower($5)))
        ORDER BY (l.asset_id IS NOT NULL) DESC LIMIT 1`, [rateCardId, departmentId, startsAt, asset.id, asset.category, asset.supplier_id]);
      return result.rowCount ? Number(result.rows[0].daily_rate_cents) : Number(asset.daily_rate_cents);
    }

    async function refreshInvoiceSettlement(client: PoolClient, departmentId: string, invoiceId: string) {
      const result = await client.query(`SELECT d.total_cents,d.status,
          coalesce((SELECT sum(p.amount_cents) FROM eventdesk_document_payments p WHERE p.document_id=d.id AND p.department_id=d.department_id),0)::int AS paid_cents,
          coalesce((SELECT sum(c.total_cents) FROM eventdesk_documents c WHERE c.related_document_id=d.id AND c.department_id=d.department_id AND c.kind='credit_note' AND c.status='sent'),0)::int AS credited_cents
        FROM eventdesk_documents d WHERE d.id=$1 AND d.department_id=$2 AND d.kind IN ('invoice','deposit_invoice') FOR UPDATE`, [invoiceId, departmentId]);
      if (!result.rowCount || ["draft", "cancelled"].includes(result.rows[0].status)) return;
      const paid = Number(result.rows[0].paid_cents);
      const credited = Number(result.rows[0].credited_cents);
      const total = Number(result.rows[0].total_cents);
      const status = paid >= total ? "paid" : paid + credited >= total ? "settled" : paid > 0 ? "partial" : "sent";
      await client.query("UPDATE eventdesk_documents SET status=$3,updated_at=now() WHERE id=$1 AND department_id=$2", [invoiceId, departmentId, status]);
    }

    routes.get("/api/eventdesk/bootstrap", async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const canFinance = request.activeDepartmentRole === "site_admin" || request.activeDepartmentModulePermissions?.eventdesk?.includes("finance_manage") === true;
      const [jobs, assets, bookings, maintenance, crew, contacts, freelancers, unavailability, events, customers, partners, packages, rateCards, documents, docSettings, deliveries] = await Promise.all([
        pool!.query(`SELECT j.id, j.title, j.customer_name, j.customer_contact_id, j.linked_event_id, j.discount_bps,j.supplier_rate_card_id,
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
        pool!.query(`SELECT c.id, c.job_id, c.role, c.contact_id, c.freelancer_id, trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')) AS contact_name,
                            f.name AS freelancer_name,f.email AS freelancer_email,c.hours,c.hourly_rate_cents,c.status,c.notes,
                            (SELECT max(sent_at) FROM eventdesk_crew_deliveries x WHERE x.crew_id=c.id AND x.department_id=c.department_id AND x.status='sent') AS invite_sent_at,
                            (SELECT x.status FROM eventdesk_crew_deliveries x WHERE x.crew_id=c.id AND x.department_id=c.department_id ORDER BY x.created_at DESC LIMIT 1) AS invite_status,
                            (SELECT x.error_summary FROM eventdesk_crew_deliveries x WHERE x.crew_id=c.id AND x.department_id=c.department_id ORDER BY x.created_at DESC LIMIT 1) AS invite_error
                       FROM eventdesk_job_crew c LEFT JOIN contacts p ON p.id=c.contact_id AND p.department_id=c.department_id
                       LEFT JOIN eventdesk_freelancers f ON f.id=c.freelancer_id AND f.department_id=c.department_id
                      WHERE c.department_id=$1 ORDER BY lower(c.role), c.created_at`, [departmentId]),
        pool!.query(`SELECT id, first_name, last_name FROM contacts WHERE department_id=$1 ORDER BY lower(last_name), lower(first_name)`, [departmentId]),
        pool!.query(`SELECT id,name,email,phone,roles,hourly_rate_cents,notes,active FROM eventdesk_freelancers WHERE department_id=$1 ORDER BY active DESC,lower(name)`, [departmentId]),
        pool!.query(`SELECT id,freelancer_id,starts_at,ends_at,reason FROM eventdesk_freelancer_unavailability WHERE department_id=$1 AND ends_at>now() ORDER BY starts_at`, [departmentId]),
        pool!.query(`SELECT id, title, event_date, start_time FROM service_events WHERE department_id=$1 ORDER BY event_date DESC, start_time DESC LIMIT 250`, [departmentId]),
        pool!.query(`SELECT id, kind, name, contact_person, email, phone, street, postal_code, city, country, notes, active, default_discount_bps
                       FROM eventdesk_customers WHERE department_id=$1 ORDER BY active DESC, lower(name)`, [departmentId]),
        pool!.query(`SELECT id,kind,name,contact_person,email,phone,street,postal_code,city,country,notes,active
                       FROM eventdesk_partners WHERE department_id=$1 ORDER BY kind,active DESC,lower(name)`, [departmentId]),
        pool!.query(`SELECT p.id,p.name,p.description,p.discount_bps,
                            coalesce(jsonb_agg(jsonb_build_object('assetId',a.id,'assetName',a.name,'quantity',i.quantity) ORDER BY lower(a.name))
                              FILTER (WHERE i.asset_id IS NOT NULL),'[]'::jsonb) AS items
                       FROM eventdesk_packages p LEFT JOIN eventdesk_package_items i ON i.package_id=p.id AND i.department_id=p.department_id
                       LEFT JOIN eventdesk_assets a ON a.id=i.asset_id AND a.department_id=i.department_id
                      WHERE p.department_id=$1 GROUP BY p.id ORDER BY lower(p.name)`, [departmentId]),
        pool!.query(`SELECT c.id,c.supplier_id,s.name AS supplier_name,c.name,c.valid_from,c.valid_to,c.active,
                            coalesce(jsonb_agg(jsonb_build_object('assetId',l.asset_id,'category',l.category,'dailyRateCents',l.daily_rate_cents) ORDER BY coalesce(l.category,a.category),a.name)
                              FILTER (WHERE l.id IS NOT NULL),'[]'::jsonb) AS lines
                       FROM eventdesk_supplier_rate_cards c JOIN eventdesk_partners s ON s.id=c.supplier_id AND s.department_id=c.department_id
                       LEFT JOIN eventdesk_supplier_rate_lines l ON l.rate_card_id=c.id AND l.department_id=c.department_id
                       LEFT JOIN eventdesk_assets a ON a.id=l.asset_id AND a.department_id=l.department_id
                      WHERE c.department_id=$1 GROUP BY c.id,s.name ORDER BY c.active DESC,c.valid_from DESC,lower(c.name)`, [departmentId]),
        pool!.query(`SELECT d.id, d.job_id, j.title AS job_title, d.kind, d.document_number, d.related_document_id, original.document_number AS related_document_number, d.status, d.issue_date, d.due_date,
                            d.customer_snapshot, d.lines, d.tax_rate_bps, d.subtotal_cents, d.tax_cents, d.total_cents,
                            coalesce(sum(p.amount_cents),0)::int AS paid_cents,
                            coalesce((SELECT sum(c.total_cents)::int FROM eventdesk_documents c WHERE c.related_document_id=d.id AND c.department_id=d.department_id AND c.kind='credit_note' AND c.status='sent'),0)::int AS credited_cents,
                            coalesce((SELECT sum(c.total_cents)::int FROM eventdesk_documents c WHERE c.related_document_id=d.id AND c.department_id=d.department_id AND c.kind='credit_note' AND c.status='draft'),0)::int AS pending_credit_cents,
                            coalesce(jsonb_agg(jsonb_build_object('amountCents',p.amount_cents,'paidAt',p.paid_at,'note',p.note) ORDER BY p.paid_at)
                              FILTER (WHERE p.id IS NOT NULL),'[]'::jsonb) AS payments
                       FROM eventdesk_documents d JOIN eventdesk_jobs j ON j.id=d.job_id AND j.department_id=d.department_id
                       LEFT JOIN eventdesk_documents original ON original.id=d.related_document_id AND original.department_id=d.department_id
                       LEFT JOIN eventdesk_document_payments p
                         ON p.document_id=d.id AND p.department_id=d.department_id
                      WHERE d.department_id=$1 AND $2::boolean GROUP BY d.id,j.title,original.document_number ORDER BY d.issue_date DESC, d.created_at DESC`, [departmentId, request.activeDepartmentRole === "site_admin" || request.activeDepartmentModulePermissions?.eventdesk?.includes("finance_manage") === true]),
        pool!.query(`SELECT business_name,street,postal_code,city,country,email,phone,tax_identifier,payment_terms,footer,logo_jpeg,document_templates,tax_profiles
                       FROM eventdesk_document_settings WHERE department_id=$1 AND $2::boolean`, [departmentId, canFinance]),
        pool!.query(`SELECT x.id,x.document_id,x.recipient_email,x.subject,x.status,x.provider_message_id,x.error_summary,x.sent_at,x.created_at
                       FROM eventdesk_document_deliveries x JOIN eventdesk_documents d ON d.id=x.document_id AND d.department_id=x.department_id
                      WHERE x.department_id=$1 AND $2::boolean ORDER BY x.created_at DESC`, [departmentId, canFinance]),
      ]);
      return {
        jobs: jobs.rows.map((row) => ({ id: row.id, title: row.title, customerName: row.customer_display_name, customerId: row.customer_id, customerContactId: row.customer_contact_id, linkedEventId: row.linked_event_id, linkedEventTitle: row.linked_event_title, startsAt: new Date(row.starts_at).toISOString(), endsAt: new Date(row.ends_at).toISOString(), venue: row.venue, venueId: row.venue_id, supplierRateCardId: row.supplier_rate_card_id, status: row.status, notes: row.notes, discountBps: row.discount_bps, createdAt: new Date(row.created_at).toISOString() })),
        assets: assets.rows.map((row) => ({ id: row.id, name: row.name, category: row.category, quantity: row.quantity, dailyRateCents: row.daily_rate_cents, active: row.active, notes: row.notes, barcode: row.barcode, supplierId: row.supplier_id, supplierName: row.supplier_name })),
        bookings: bookings.rows.map((row) => ({ id: row.id, jobId: row.job_id, assetId: row.asset_id, assetName: row.asset_name, barcode: row.barcode, quantity: row.quantity, checkedOutQuantity: row.checked_out_quantity, dailyRateCents: row.daily_rate_cents, status: row.status })),
        maintenance: maintenance.rows.map((row) => ({ id: row.id, assetId: row.asset_id, assetName: row.asset_name, startsAt: new Date(row.starts_at).toISOString(), endsAt: new Date(row.ends_at).toISOString(), quantity: row.quantity, status: row.status, notes: row.notes })),
        crew: crew.rows.map((row) => ({ id: row.id, jobId: row.job_id, role: row.role, contactId: row.contact_id, contactName: row.contact_name?.trim() || null, freelancerId: row.freelancer_id, freelancerName: row.freelancer_name, freelancerEmail: row.freelancer_email, inviteSentAt: row.invite_sent_at, inviteStatus: row.invite_status, inviteError: row.invite_error, hours: Number(row.hours), hourlyRateCents: row.hourly_rate_cents, status: row.status, notes: row.notes })),
        contacts: contacts.rows.map((row) => ({ id: row.id, name: `${row.first_name} ${row.last_name}`.trim() })),
        freelancers: freelancers.rows.map((row) => ({ id: row.id, name: row.name, email: row.email, phone: row.phone, roles: row.roles, hourlyRateCents: row.hourly_rate_cents, notes: row.notes, active: row.active })),
        freelancerUnavailability: unavailability.rows.map((row) => ({ id: row.id, freelancerId: row.freelancer_id, startsAt: new Date(row.starts_at).toISOString(), endsAt: new Date(row.ends_at).toISOString(), reason: row.reason })),
        events: events.rows.map((row) => ({ id: row.id, title: row.title, eventDate: row.event_date, startTime: row.start_time })),
        customers: customers.rows.map((row) => ({ id: row.id, kind: row.kind, name: row.name, contactPerson: row.contact_person, email: row.email, phone: row.phone, street: row.street, postalCode: row.postal_code, city: row.city, country: row.country, notes: row.notes, active: row.active, defaultDiscountBps: row.default_discount_bps })),
        partners: partners.rows.map((row) => ({ id: row.id, kind: row.kind, name: row.name, contactPerson: row.contact_person, email: row.email, phone: row.phone, street: row.street, postalCode: row.postal_code, city: row.city, country: row.country, notes: row.notes, active: row.active })),
        packages: packages.rows.map((row) => ({ id: row.id, name: row.name, description: row.description, discountBps: row.discount_bps, items: row.items })),
        rateCards: rateCards.rows.map((row) => ({ id: row.id, supplierId: row.supplier_id, supplierName: row.supplier_name, name: row.name, validFrom: row.valid_from, validTo: row.valid_to, active: row.active, lines: row.lines })),
        documents: documents.rows.map((row) => ({ id: row.id, jobId: row.job_id, jobTitle: row.job_title, kind: row.kind, number: row.document_number, relatedDocumentId: row.related_document_id, relatedDocumentNumber: row.related_document_number, status: row.status, issueDate: row.issue_date, dueDate: row.due_date, customer: row.customer_snapshot, lines: row.lines, taxRateBps: row.tax_rate_bps, subtotalCents: row.subtotal_cents, taxCents: row.tax_cents, totalCents: row.total_cents, paidCents: row.paid_cents, creditedCents: row.credited_cents, pendingCreditCents: row.pending_credit_cents, payments: row.payments })),
        documentDeliveries: deliveries.rows.map((row) => ({ id: row.id, documentId: row.document_id, recipientEmail: row.recipient_email, subject: row.subject, status: row.status, providerMessageId: row.provider_message_id, errorSummary: row.error_summary, sentAt: row.sent_at, createdAt: row.created_at })),
        emailDelivery: { configured: Boolean(resendApiKey() && emailFrom()), from: emailFrom() },
        documentSettings: docSettings.rows[0] ? { businessName: docSettings.rows[0].business_name, street: docSettings.rows[0].street, postalCode: docSettings.rows[0].postal_code, city: docSettings.rows[0].city, country: docSettings.rows[0].country, email: docSettings.rows[0].email, phone: docSettings.rows[0].phone, taxIdentifier: docSettings.rows[0].tax_identifier, paymentTerms: docSettings.rows[0].payment_terms, footer: docSettings.rows[0].footer, logoJpegBase64: docSettings.rows[0].logo_jpeg ? Buffer.from(docSettings.rows[0].logo_jpeg).toString("base64") : null, templates: docSettings.rows[0].document_templates ?? {}, taxProfiles: docSettings.rows[0].tax_profiles ?? [] } : { businessName: "", street: "", postalCode: "", city: "", country: "", email: "", phone: "", taxIdentifier: "", paymentTerms: "", footer: "", logoJpegBase64: null, templates: {}, taxProfiles: [] },
        permissions: { jobs: request.activeDepartmentRole === "site_admin" || request.activeDepartmentModulePermissions?.eventdesk?.includes("jobs_manage") === true, customers: request.activeDepartmentRole === "site_admin" || request.activeDepartmentModulePermissions?.eventdesk?.includes("customers_manage") === true, inventory: request.activeDepartmentRole === "site_admin" || request.activeDepartmentModulePermissions?.eventdesk?.includes("inventory_manage") === true, crew: request.activeDepartmentRole === "site_admin" || request.activeDepartmentModulePermissions?.eventdesk?.includes("crew_manage") === true, finance: request.activeDepartmentRole === "site_admin" || request.activeDepartmentModulePermissions?.eventdesk?.includes("finance_manage") === true, partners: request.activeDepartmentRole === "site_admin" || request.activeDepartmentModulePermissions?.eventdesk?.includes("partners_manage") === true },
      };
    });

    routes.post<{ Params: { id: string }; Body: { kind: "quote" | "invoice" | "deposit_invoice" | "contract" | "delivery_note"; taxRateBps?: number; taxProfileId?: string; dueDate?: string; depositAmountCents?: number } }>("/api/eventdesk/jobs/:id/documents", { schema: {
      params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["kind"], properties: { kind: { type: "string", enum: ["quote", "invoice", "deposit_invoice", "contract", "delivery_note"] }, taxRateBps: { type: "integer", minimum: 0, maximum: 3000 }, taxProfileId: { type: "string", minLength: 1, maxLength: 80 }, dueDate: { type: "string", format: "date" }, depositAmountCents: { type: "integer", minimum: 1, maximum: 1000000000 } } },
    } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply, "finance_manage");
      if (!departmentId) return reply;
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        const jobResult = await client.query(`SELECT j.id,j.title,j.customer_name,j.customer_id,j.starts_at,j.ends_at,j.venue,j.notes,j.discount_bps,
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
        if (request.body.kind === "deposit_invoice" && (!request.body.depositAmountCents || !request.body.dueDate)) { await rollback(client); return reply.code(400).send({ error: "Enter a deposit amount and due date." }); }
        const assetLines = assetRows.rows.map((line) => ({ description: line.name, quantity: Number(line.quantity), unitCents: request.body.kind === "delivery_note" ? 0 : Number(line.daily_rate_cents), unitLabel: `day${days === 1 ? "" : "s"}`, lineTotalCents: request.body.kind === "delivery_note" ? 0 : Number(line.quantity) * Number(line.daily_rate_cents) * days }));
        const crewLines = crewRows.rows.map((line) => ({ description: `${line.role} (crew)`, quantity: Number(line.hours), unitCents: Number(line.hourly_rate_cents), unitLabel: "hour", lineTotalCents: Math.round(Number(line.hours) * Number(line.hourly_rate_cents)) }));
        let lines = request.body.kind === "deposit_invoice"
          ? request.body.depositAmountCents ? [{ description: `Deposit for ${job.title}`, quantity: 1, unitCents: request.body.depositAmountCents, unitLabel: "deposit", lineTotalCents: request.body.depositAmountCents }] : []
          : request.body.kind === "delivery_note" ? assetLines : [...assetLines, ...crewLines];
        if (!lines.length) { await rollback(client); return reply.code(400).send({ error: request.body.kind === "delivery_note" ? "Add equipment to the job before creating a delivery note." : "Add equipment or crew to the job before creating this document." }); }
        const eligibleForDiscount = ["quote", "invoice", "contract"].includes(request.body.kind);
        const discountBps = eligibleForDiscount ? Number(job.discount_bps ?? 0) : 0;
        const preDiscountSubtotal = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
        const discountCents = Math.round(preDiscountSubtotal * discountBps / 10000);
        if (discountCents > 0) lines = [...lines, { description: `Customer discount (${(discountBps / 100).toFixed(2)}%)`, quantity: 1, unitCents: -discountCents, unitLabel: "discount", lineTotalCents: -discountCents }];
        const subtotal = request.body.kind === "delivery_note" ? 0 : lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
        const settingsResult = await client.query(`SELECT business_name,street,postal_code,city,country,email,phone,tax_identifier,payment_terms,footer,logo_jpeg,document_templates,tax_profiles FROM eventdesk_document_settings WHERE department_id=$1`, [departmentId]);
        const settings = settingsResult.rows[0] ?? {};
        const taxProfiles = settings.tax_profiles ?? [];
        const taxProfile = request.body.taxProfileId ? taxProfiles.find((profile: { id: string }) => profile.id === request.body.taxProfileId) : null;
        if (request.body.taxProfileId && !taxProfile) { await rollback(client); return reply.code(400).send({ error: "Choose a saved tax profile for this location." }); }
        const taxRateBps = request.body.kind === "delivery_note" ? 0 : Number(taxProfile?.rateBps ?? request.body.taxRateBps ?? 0);
        const tax = Math.round(subtotal * taxRateBps / 10000);
        const seq = await client.query(`INSERT INTO eventdesk_document_sequences (department_id,kind,last_number) VALUES ($1,$2,1)
          ON CONFLICT (department_id,kind) DO UPDATE SET last_number=eventdesk_document_sequences.last_number+1 RETURNING last_number`, [departmentId, request.body.kind]);
        const prefix = { quote: "Q", invoice: "I", deposit_invoice: "D", contract: "C", delivery_note: "DN" }[request.body.kind];
        const number = `${prefix}-${new Date().getFullYear()}-${String(seq.rows[0].last_number).padStart(5, "0")}`;
        const customer = { name: job.name ?? job.customer_name, kind: job.kind ?? null, contactPerson: job.contact_person ?? "", email: job.email ?? "", phone: job.phone ?? "", street: job.street ?? "", postalCode: job.postal_code ?? "", city: job.city ?? "", country: job.country ?? "", jobTitle: job.title, venue: job.venue, startsAt: job.starts_at, endsAt: job.ends_at, jobNotes: job.notes };
        const template = settings.document_templates?.[request.body.kind] ?? {};
        const brandingSnapshot = { businessName: settings.business_name ?? "", street: settings.street ?? "", postalCode: settings.postal_code ?? "", city: settings.city ?? "", country: settings.country ?? "", email: settings.email ?? "", phone: settings.phone ?? "", taxIdentifier: settings.tax_identifier ?? "", paymentTerms: settings.payment_terms ?? "", footer: settings.footer ?? "", template, taxProfileName: taxProfile?.name ?? "", legalText: taxProfile?.legalText ?? "" };
        const inserted = await client.query(`INSERT INTO eventdesk_documents
          (id,department_id,job_id,kind,document_number,status,due_date,customer_snapshot,lines,tax_rate_bps,subtotal_cents,tax_cents,total_cents,branding_snapshot,logo_snapshot)
          VALUES ($1,$2,$3,$4,$5,'draft',$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13::jsonb,$14) RETURNING id`,
          [randomUUID(), departmentId, job.id, request.body.kind, number, request.body.dueDate ?? null, JSON.stringify(customer), JSON.stringify(lines), taxRateBps, subtotal, tax, subtotal + tax, JSON.stringify(brandingSnapshot), settings.logo_jpeg ?? null]);
        await client.query("COMMIT");
        return reply.code(201).send({ id: inserted.rows[0].id, number });
      } catch (error) { await rollback(client); throw error; } finally { client.release(); }
    });

    routes.post<{ Params: { id: string }; Body: { amountCents: number; reason: string } }>("/api/eventdesk/documents/:id/credit-notes", { schema: {
      params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["amountCents", "reason"], properties: { amountCents: { type: "integer", minimum: 1, maximum: 1000000000 }, reason: { type: "string", minLength: 1, maxLength: 160 } } },
    } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply, "finance_manage");
      if (!departmentId) return reply;
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        const invoice = await client.query(`SELECT id,job_id,document_number,kind,status,customer_snapshot,tax_rate_bps,total_cents,branding_snapshot,logo_snapshot
          FROM eventdesk_documents WHERE id=$1 AND department_id=$2 AND kind IN ('invoice','deposit_invoice') FOR UPDATE`, [request.params.id, departmentId]);
        if (!invoice.rowCount || !["sent", "partial"].includes(invoice.rows[0].status)) { await rollback(client); return reply.code(409).send({ error: "Credit notes can only be created for sent, unpaid invoices." }); }
        const balances = await client.query(`SELECT
            coalesce((SELECT sum(amount_cents) FROM eventdesk_document_payments WHERE document_id=$1 AND department_id=$2),0)::int AS paid_cents,
            coalesce((SELECT sum(total_cents) FROM eventdesk_documents WHERE related_document_id=$1 AND department_id=$2 AND kind='credit_note' AND status IN ('draft','sent')),0)::int AS credited_cents`, [request.params.id, departmentId]);
        const available = Number(invoice.rows[0].total_cents) - Number(balances.rows[0].paid_cents) - Number(balances.rows[0].credited_cents);
        if (request.body.amountCents > available) { await rollback(client); return reply.code(400).send({ error: `The credit exceeds the remaining unpaid balance of CHF ${(Math.max(0, available) / 100).toFixed(2)}.` }); }
        const taxRateBps = Number(invoice.rows[0].tax_rate_bps);
        const subtotal = Math.round(request.body.amountCents * 10000 / (10000 + taxRateBps));
        const tax = request.body.amountCents - subtotal;
        const sequence = await client.query(`INSERT INTO eventdesk_document_sequences (department_id,kind,last_number) VALUES ($1,'credit_note',1)
          ON CONFLICT (department_id,kind) DO UPDATE SET last_number=eventdesk_document_sequences.last_number+1 RETURNING last_number`, [departmentId]);
        const number = `CN-${new Date().getFullYear()}-${String(sequence.rows[0].last_number).padStart(5, "0")}`;
        const line = [{ description: request.body.reason.trim(), quantity: 1, unitCents: subtotal, unitLabel: "credit", lineTotalCents: subtotal }];
        const result = await client.query(`INSERT INTO eventdesk_documents
          (id,department_id,job_id,kind,document_number,status,customer_snapshot,lines,tax_rate_bps,subtotal_cents,tax_cents,total_cents,related_document_id,branding_snapshot,logo_snapshot)
          VALUES ($1,$2,$3,'credit_note',$4,'draft',$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12::jsonb,$13) RETURNING id`,
          [randomUUID(), departmentId, invoice.rows[0].job_id, number, JSON.stringify(invoice.rows[0].customer_snapshot), JSON.stringify(line), taxRateBps, subtotal, tax, request.body.amountCents, request.params.id, JSON.stringify(invoice.rows[0].branding_snapshot ?? {}), invoice.rows[0].logo_snapshot ?? null]);
        await client.query("COMMIT");
        return reply.code(201).send({ id: result.rows[0].id, number, relatedDocumentNumber: invoice.rows[0].document_number });
      } catch (error) { await rollback(client); throw error; } finally { client.release(); }
    });

    routes.put<{ Params: { id: string }; Body: { lines: { description: string; quantity: number; unitCents: number; unitLabel: string }[]; taxRateBps?: number; dueDate?: string | null } }>("/api/eventdesk/documents/:id", { schema: {
      params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["lines"], properties: {
        lines: { type: "array", minItems: 1, maxItems: 100, items: { type: "object", additionalProperties: false, required: ["description", "quantity", "unitCents", "unitLabel"], properties: {
          description: { type: "string", minLength: 1, maxLength: 160 }, quantity: { type: "number", exclusiveMinimum: 0, maximum: 100000 }, unitCents: { type: "integer", minimum: 0, maximum: 100000000 }, unitLabel: { type: "string", maxLength: 24 },
        } } }, taxRateBps: { type: "integer", minimum: 0, maximum: 3000 }, dueDate: { type: ["string", "null"], format: "date" },
      } },
    } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply, "finance_manage");
      if (!departmentId) return reply;
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        const document = await client.query("SELECT kind,related_document_id FROM eventdesk_documents WHERE id=$1 AND department_id=$2 AND status='draft' FOR UPDATE", [request.params.id, departmentId]);
        if (!document.rowCount) { await rollback(client); return reply.code(409).send({ error: "Only draft documents can be edited." }); }
        const isDeliveryNote = document.rows[0].kind === "delivery_note";
        const lines = request.body.lines.map((line) => ({ ...line, unitCents: isDeliveryNote ? 0 : line.unitCents, unitLabel: isDeliveryNote ? "unit" : line.unitLabel, lineTotalCents: isDeliveryNote ? 0 : Math.round(line.quantity * line.unitCents) }));
        const subtotal = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
        const taxRateBps = isDeliveryNote ? 0 : request.body.taxRateBps ?? 0;
        const tax = Math.round(subtotal * taxRateBps / 10000);
        if (document.rows[0].kind === "credit_note" && document.rows[0].related_document_id) {
          const balances = await client.query(`SELECT d.total_cents,
              coalesce((SELECT sum(p.amount_cents) FROM eventdesk_document_payments p WHERE p.document_id=d.id AND p.department_id=d.department_id),0)::int AS paid_cents,
              coalesce((SELECT sum(c.total_cents) FROM eventdesk_documents c WHERE c.related_document_id=d.id AND c.department_id=d.department_id AND c.kind='credit_note' AND c.status IN ('draft','sent') AND c.id<>$3),0)::int AS reserved_credits_cents
            FROM eventdesk_documents d WHERE d.id=$1 AND d.department_id=$2 FOR UPDATE`, [document.rows[0].related_document_id, departmentId, request.params.id]);
          const available = Number(balances.rows[0]?.total_cents ?? 0) - Number(balances.rows[0]?.paid_cents ?? 0) - Number(balances.rows[0]?.reserved_credits_cents ?? 0);
          if (subtotal + tax > available) { await rollback(client); return reply.code(400).send({ error: `The credit exceeds the remaining unpaid balance of CHF ${(Math.max(0, available) / 100).toFixed(2)}.` }); }
        }
        await client.query(`UPDATE eventdesk_documents SET lines=$3::jsonb,tax_rate_bps=$4,subtotal_cents=$5,tax_cents=$6,total_cents=$7,
          due_date=CASE WHEN kind IN ('invoice','deposit_invoice') THEN $8::date ELSE due_date END,updated_at=now() WHERE id=$1 AND department_id=$2`,
          [request.params.id, departmentId, JSON.stringify(lines), taxRateBps, subtotal, tax, subtotal + tax, request.body.dueDate ?? null]);
        await client.query("COMMIT");
        return { id: request.params.id, subtotalCents: subtotal, taxCents: tax, totalCents: subtotal + tax };
      } catch (error) { await rollback(client); throw error; } finally { client.release(); }
    });

    routes.put("/api/eventdesk/document-settings", { schema: documentSettingsSchema }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply, "finance_manage");
      if (!departmentId) return reply;
      const b = request.body as { businessName: string; street: string; postalCode: string; city: string; country: string; email: string; phone: string; taxIdentifier: string; paymentTerms: string; footer: string; logoJpegBase64?: string | null; templates?: Record<string, { title?: string; intro?: string; footer?: string }>; taxProfiles?: Array<{ id: string; name: string; rateBps: number; legalText: string }> };
      let logo: Buffer | null = null;
      if (b.logoJpegBase64) {
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b.logoJpegBase64)) return reply.code(400).send({ error: "The logo must be a valid JPEG image." });
        logo = Buffer.from(b.logoJpegBase64, "base64");
        const dimensions = jpegDimensions(logo);
        if (logo.length < 4 || logo.length > 256 * 1024 || logo[0] !== 0xff || logo[1] !== 0xd8 || logo[2] !== 0xff || logo.at(-2) !== 0xff || logo.at(-1) !== 0xd9 || !dimensions || dimensions.width > 4096 || dimensions.height > 4096) return reply.code(400).send({ error: "The logo must be a valid JPEG with dimensions up to 4096 × 4096 and a file size no larger than 256 KiB." });
      }
      const profiles = b.taxProfiles ?? [];
      if (new Set(profiles.map((profile) => profile.id)).size !== profiles.length) return reply.code(400).send({ error: "Tax profile IDs must be unique." });
      await pool!.query(`INSERT INTO eventdesk_document_settings (department_id,business_name,street,postal_code,city,country,email,phone,tax_identifier,payment_terms,footer,logo_jpeg,document_templates,tax_profiles)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb) ON CONFLICT (department_id) DO UPDATE SET
          business_name=excluded.business_name,street=excluded.street,postal_code=excluded.postal_code,city=excluded.city,country=excluded.country,email=excluded.email,phone=excluded.phone,tax_identifier=excluded.tax_identifier,payment_terms=excluded.payment_terms,footer=excluded.footer,logo_jpeg=excluded.logo_jpeg,document_templates=excluded.document_templates,tax_profiles=excluded.tax_profiles,updated_at=now()`,
        [departmentId, b.businessName.trim(), b.street.trim(), b.postalCode.trim(), b.city.trim(), b.country.trim(), b.email.trim(), b.phone.trim(), b.taxIdentifier.trim(), b.paymentTerms.trim(), b.footer.trim(), logo, JSON.stringify(b.templates ?? {}), JSON.stringify(profiles)]);
      return { ok: true };
    });

    routes.get<{ Querystring: { from?: string; to?: string } }>("/api/eventdesk/finance/export", { schema: {
      querystring: { type: "object", additionalProperties: false, properties: { from: { type: "string", format: "date" }, to: { type: "string", format: "date" } } },
    } }, async (request, reply) => {
      const departmentId = await department(request, reply, "finance_manage");
      if (!departmentId) return reply;
      const { from, to } = request.query;
      if (from && to && from > to) return reply.code(400).send({ error: "The start date must be on or before the end date." });
      const rows = await pool!.query(`
        SELECT * FROM (
          SELECT d.issue_date::text AS transaction_date, 'document'::text AS record_type, d.kind AS document_type,
                 d.document_number AS reference, coalesce(original.document_number,'') AS related_reference,
                 coalesce(d.customer_snapshot->>'name','') AS customer, j.title AS job,
                 CASE WHEN d.kind='credit_note' THEN -d.subtotal_cents ELSE d.subtotal_cents END AS net_cents,
                 CASE WHEN d.kind='credit_note' THEN -d.tax_cents ELSE d.tax_cents END AS tax_cents,
                 CASE WHEN d.kind='credit_note' THEN -d.total_cents ELSE d.total_cents END AS gross_cents,
                 0::int AS payment_cents, d.status, coalesce(d.due_date::text,'') AS due_date, ''::text AS note
            FROM eventdesk_documents d JOIN eventdesk_jobs j ON j.id=d.job_id AND j.department_id=d.department_id
            LEFT JOIN eventdesk_documents original ON original.id=d.related_document_id AND original.department_id=d.department_id
           WHERE d.department_id=$1 AND ((d.kind IN ('invoice','deposit_invoice') AND d.status IN ('sent','partial','paid','settled')) OR (d.kind='credit_note' AND d.status='sent'))
             AND ($2::date IS NULL OR d.issue_date >= $2::date) AND ($3::date IS NULL OR d.issue_date <= $3::date)
          UNION ALL
          SELECT p.paid_at::text, 'payment', d.kind, d.document_number, '', coalesce(d.customer_snapshot->>'name',''), j.title,
                 0, 0, 0, p.amount_cents, d.status, coalesce(d.due_date::text,''), coalesce(p.note,'')
            FROM eventdesk_document_payments p JOIN eventdesk_documents d ON d.id=p.document_id AND d.department_id=p.department_id
            JOIN eventdesk_jobs j ON j.id=d.job_id AND j.department_id=d.department_id
           WHERE p.department_id=$1 AND d.kind IN ('invoice','deposit_invoice')
             AND ($2::date IS NULL OR p.paid_at >= $2::date) AND ($3::date IS NULL OR p.paid_at <= $3::date)
        ) export_rows ORDER BY transaction_date, record_type, reference`, [departmentId, from ?? null, to ?? null]);
      const columns = ["date", "record_type", "document_type", "reference", "related_reference", "customer", "job", "net_chf", "tax_chf", "gross_chf", "payment_chf", "status", "due_date", "note"];
      const csvCell = (value: unknown, protectFormula = true) => {
        let text = value == null ? "" : String(value);
        if (protectFormula && /^[=+@\-\t\r]/.test(text)) text = `'${text}`;
        return `"${text.replaceAll('"', '""')}"`;
      };
      const csv = [columns, ...rows.rows.map((row) => [row.transaction_date, row.record_type, row.document_type, row.reference, row.related_reference, row.customer, row.job,
        (Number(row.net_cents) / 100).toFixed(2), (Number(row.tax_cents) / 100).toFixed(2), (Number(row.gross_cents) / 100).toFixed(2), (Number(row.payment_cents) / 100).toFixed(2), row.status, row.due_date, row.note])]
        .map((row) => row.map((value, index) => csvCell(value, ![7, 8, 9, 10].includes(index))).join(",")).join("\r\n");
      const suffix = from || to ? `-${from ?? "start"}-${to ?? "today"}` : "";
      return reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="eventdesk-accounting${suffix}.csv"`).send(`\uFEFF${csv}`);
    });

    routes.get<{ Params: { id: string } }>("/api/eventdesk/documents/:id/pdf", { schema: {
      params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
    } }, async (request, reply) => {
      const departmentId = await department(request, reply, "finance_manage");
      if (!departmentId) return reply;
      const result = await pool!.query(`SELECT d.document_number,d.kind,d.issue_date,d.due_date,d.customer_snapshot,d.lines,d.tax_rate_bps,d.subtotal_cents,d.tax_cents,d.total_cents,d.branding_snapshot,d.logo_snapshot,j.title AS job_title,original.document_number AS related_document_number,
          coalesce(s.business_name,'') AS business_name,coalesce(s.street,'') AS street,coalesce(s.postal_code,'') AS postal_code,coalesce(s.city,'') AS city,coalesce(s.country,'') AS country,
          coalesce(s.email,'') AS email,coalesce(s.phone,'') AS phone,coalesce(s.tax_identifier,'') AS tax_identifier,coalesce(s.payment_terms,'') AS payment_terms,coalesce(s.footer,'') AS footer
        FROM eventdesk_documents d JOIN eventdesk_jobs j ON j.id=d.job_id AND j.department_id=d.department_id
        LEFT JOIN eventdesk_document_settings s ON s.department_id=d.department_id
        LEFT JOIN eventdesk_documents original ON original.id=d.related_document_id AND original.department_id=d.department_id
        WHERE d.id=$1 AND d.department_id=$2`, [request.params.id, departmentId]);
      if (!result.rowCount) return reply.code(404).send({ error: "Document not found." });
      const row = result.rows[0];
      const savedBranding = row.branding_snapshot ?? {};
      const pdf = createDocumentPdf({ number: row.document_number, kind: row.kind, issueDate: row.issue_date, dueDate: row.due_date, relatedDocumentNumber: row.related_document_number, customer: row.customer_snapshot, jobTitle: row.job_title, lines: row.lines, taxRateBps: row.tax_rate_bps, subtotalCents: row.subtotal_cents, taxCents: row.tax_cents, totalCents: row.total_cents }, { businessName: savedBranding.businessName ?? row.business_name, street: savedBranding.street ?? row.street, postalCode: savedBranding.postalCode ?? row.postal_code, city: savedBranding.city ?? row.city, country: savedBranding.country ?? row.country, email: savedBranding.email ?? row.email, phone: savedBranding.phone ?? row.phone, taxIdentifier: savedBranding.taxIdentifier ?? row.tax_identifier, paymentTerms: savedBranding.paymentTerms ?? row.payment_terms, footer: savedBranding.footer ?? row.footer, template: savedBranding.template, taxProfileName: savedBranding.taxProfileName, legalText: savedBranding.legalText, logoJpeg: row.logo_snapshot ? Buffer.from(row.logo_snapshot) : null });
      return reply.header("content-type", "application/pdf").header("content-disposition", `attachment; filename="${row.document_number}.pdf"`).send(pdf);
    });

    routes.post<{ Params: { id: string }; Body: { recipientEmail: string; subject: string; message?: string; purpose?: "document" | "payment_reminder" } }>("/api/eventdesk/documents/:id/send", { schema: {
      params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["recipientEmail", "subject"], properties: {
        recipientEmail: { type: "string", minLength: 3, maxLength: 254, pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$" }, subject: { type: "string", minLength: 1, maxLength: 240 }, message: { type: "string", maxLength: 3000 }, purpose: { type: "string", enum: ["document", "payment_reminder"] },
      } },
    } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply, "finance_manage");
      if (!departmentId) return reply;
      const apiKey = resendApiKey();
      const from = emailFrom();
      if (!apiKey || !from) return reply.code(503).send({ error: "Email delivery is not configured. Set SMART_CHURCH_RESEND_API_KEY and SMART_CHURCH_EMAIL_FROM on the Smart-Church server." });
      const recipientEmail = request.body.recipientEmail.trim().toLocaleLowerCase("en-US");
      const subject = request.body.subject.trim();
      if (!subject) return reply.code(400).send({ error: "Enter an email subject." });
      const result = await pool!.query(`SELECT d.id,d.department_id,d.document_number,d.kind,d.status,d.issue_date,d.due_date,d.customer_snapshot,d.lines,d.tax_rate_bps,d.subtotal_cents,d.tax_cents,d.total_cents,d.branding_snapshot,d.logo_snapshot,j.title AS job_title,original.document_number AS related_document_number,
          coalesce(s.business_name,'') AS business_name,coalesce(s.street,'') AS street,coalesce(s.postal_code,'') AS postal_code,coalesce(s.city,'') AS city,coalesce(s.country,'') AS country,
          coalesce(s.email,'') AS email,coalesce(s.phone,'') AS phone,coalesce(s.tax_identifier,'') AS tax_identifier,coalesce(s.payment_terms,'') AS payment_terms,coalesce(s.footer,'') AS footer
        FROM eventdesk_documents d JOIN eventdesk_jobs j ON j.id=d.job_id AND j.department_id=d.department_id
        LEFT JOIN eventdesk_document_settings s ON s.department_id=d.department_id
        LEFT JOIN eventdesk_documents original ON original.id=d.related_document_id AND original.department_id=d.department_id
        WHERE d.id=$1 AND d.department_id=$2`, [request.params.id, departmentId]);
      if (!result.rowCount) return reply.code(404).send({ error: "Document not found." });
      const row = result.rows[0];
      if (row.status === "cancelled") return reply.code(409).send({ error: "Cancelled documents cannot be sent." });
      const isPaymentReminder = request.body.purpose === "payment_reminder";
      let balanceCents: number | undefined;
      if (isPaymentReminder) {
        if (!(["invoice", "deposit_invoice"] as string[]).includes(row.kind)) return reply.code(400).send({ error: "Payment reminders are only available for invoices." });
        const reminder = await pool!.query(`SELECT d.status,d.due_date < CURRENT_DATE AS overdue,
            d.total_cents
              -coalesce((SELECT sum(p.amount_cents) FROM eventdesk_document_payments p WHERE p.document_id=d.id AND p.department_id=d.department_id),0)::int
              -coalesce((SELECT sum(c.total_cents) FROM eventdesk_documents c WHERE c.related_document_id=d.id AND c.department_id=d.department_id AND c.kind='credit_note' AND c.status IN ('draft','sent')),0)::int AS balance_cents
          FROM eventdesk_documents d WHERE d.id=$1 AND d.department_id=$2`, [request.params.id, departmentId]);
        if (!reminder.rowCount || !["sent", "partial"].includes(reminder.rows[0].status) || !reminder.rows[0].overdue || Number(reminder.rows[0].balance_cents) <= 0) return reply.code(409).send({ error: "This invoice is not overdue with an outstanding balance." });
        balanceCents = Number(reminder.rows[0].balance_cents);
      }
      const document = { number: row.document_number, kind: row.kind, issueDate: row.issue_date, dueDate: row.due_date, relatedDocumentNumber: row.related_document_number, customer: row.customer_snapshot, jobTitle: row.job_title, lines: row.lines, taxRateBps: row.tax_rate_bps, subtotalCents: row.subtotal_cents, taxCents: row.tax_cents, totalCents: row.total_cents, ...(balanceCents === undefined ? {} : { balanceCents }) };
      const savedBranding = row.branding_snapshot ?? {};
      const branding = { businessName: savedBranding.businessName ?? row.business_name, street: savedBranding.street ?? row.street, postalCode: savedBranding.postalCode ?? row.postal_code, city: savedBranding.city ?? row.city, country: savedBranding.country ?? row.country, email: savedBranding.email ?? row.email, phone: savedBranding.phone ?? row.phone, taxIdentifier: savedBranding.taxIdentifier ?? row.tax_identifier, paymentTerms: savedBranding.paymentTerms ?? row.payment_terms, footer: savedBranding.footer ?? row.footer, template: savedBranding.template, taxProfileName: savedBranding.taxProfileName, legalText: savedBranding.legalText, logoJpeg: row.logo_snapshot ? Buffer.from(row.logo_snapshot) : null };
      const pdf = createDocumentPdf(document, branding);
      const providerResponse = await fetch("https://api.resend.com/emails", {
        method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to: [recipientEmail], subject, html: createDocumentEmailHtml(document, branding, request.body.message?.trim() ?? "", isPaymentReminder ? { balanceCents: balanceCents! } : undefined), attachments: [{ filename: `${row.document_number}.pdf`, content: pdf.toString("base64") }] }),
        signal: AbortSignal.timeout(20_000),
      }).catch(() => null);
      let providerId = "";
      let errorSummary = "";
      if (!providerResponse) errorSummary = "The email provider did not respond before the request timed out.";
      else if (!providerResponse.ok) {
        const responseBody = await providerResponse.json().catch(() => ({})) as { message?: string; error?: string };
        errorSummary = (responseBody.message ?? responseBody.error ?? `Email provider returned HTTP ${providerResponse.status}.`).slice(0, 500);
      } else {
        const responseBody = await providerResponse.json().catch(() => ({})) as { id?: string };
        providerId = responseBody.id ?? "";
      }
      if (errorSummary) {
        await pool!.query(`INSERT INTO eventdesk_document_deliveries (id,department_id,document_id,recipient_email,subject,status,error_summary)
          VALUES ($1,$2,$3,$4,$5,'failed',$6)`, [randomUUID(), departmentId, request.params.id, recipientEmail, subject, errorSummary]);
        return reply.code(502).send({ error: `Email delivery failed: ${errorSummary}` });
      }
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        const current = await client.query("SELECT status,kind,related_document_id FROM eventdesk_documents WHERE id=$1 AND department_id=$2 FOR UPDATE", [request.params.id, departmentId]);
        if (!current.rowCount) { await rollback(client); return reply.code(404).send({ error: "The document was removed while the email was being sent." }); }
        if (current.rows[0].status === "draft") await client.query("UPDATE eventdesk_documents SET status='sent',updated_at=now() WHERE id=$1 AND department_id=$2", [request.params.id, departmentId]);
        if (current.rows[0].kind === "credit_note" && current.rows[0].related_document_id) await refreshInvoiceSettlement(client, departmentId, current.rows[0].related_document_id);
        await client.query(`INSERT INTO eventdesk_document_deliveries (id,department_id,document_id,recipient_email,subject,status,provider_message_id,sent_at)
          VALUES ($1,$2,$3,$4,$5,'sent',$6,now())`, [randomUUID(), departmentId, request.params.id, recipientEmail, subject, providerId]);
        await client.query("COMMIT");
      } catch (error) { await rollback(client); throw error; } finally { client.release(); }
      return { id: request.params.id, status: "sent", recipientEmail, providerMessageId: providerId };
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
          (kind IN ('invoice','deposit_invoice') AND status IN ('draft','sent') AND $3='cancelled') OR
          (kind='credit_note' AND status='sent' AND $3='cancelled')
        ) RETURNING id,job_id,kind,related_document_id`, [request.params.id, departmentId, request.body.status]);
      if (!result.rowCount) return reply.code(409).send({ error: "That document cannot move to the requested status." });
      if (result.rows[0].kind === "credit_note" && result.rows[0].related_document_id && ["sent", "cancelled"].includes(request.body.status)) {
        const client = await pool!.connect();
        try { await client.query("BEGIN"); await refreshInvoiceSettlement(client, departmentId, result.rows[0].related_document_id); await client.query("COMMIT"); }
        catch (error) { await rollback(client); throw error; } finally { client.release(); }
      }
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
        const document = await client.query("SELECT total_cents,status FROM eventdesk_documents WHERE id=$1 AND department_id=$2 AND kind IN ('invoice','deposit_invoice') FOR UPDATE", [request.params.id, departmentId]);
        if (!document.rowCount || !["sent", "partial"].includes(document.rows[0].status)) { await rollback(client); return reply.code(404).send({ error: "A sent, unpaid invoice was not found." }); }
        const balances = await client.query(`SELECT
            coalesce((SELECT sum(amount_cents) FROM eventdesk_document_payments WHERE document_id=$1 AND department_id=$2),0)::int AS paid_cents,
            coalesce((SELECT sum(total_cents) FROM eventdesk_documents WHERE related_document_id=$1 AND department_id=$2 AND kind='credit_note' AND status IN ('draft','sent')),0)::int AS reserved_credits_cents,
            coalesce((SELECT sum(total_cents) FROM eventdesk_documents WHERE related_document_id=$1 AND department_id=$2 AND kind='credit_note' AND status='sent'),0)::int AS credited_cents`, [request.params.id, departmentId]);
        const nextPaid = Number(balances.rows[0].paid_cents) + request.body.amountCents;
        if (nextPaid > Number(document.rows[0].total_cents) - Number(balances.rows[0].reserved_credits_cents)) { await rollback(client); return reply.code(400).send({ error: "Payment exceeds the invoice balance after draft and issued credit notes." }); }
        await client.query("INSERT INTO eventdesk_document_payments (id,department_id,document_id,amount_cents,paid_at,note) VALUES ($1,$2,$3,$4,$5,$6)", [randomUUID(), departmentId, request.params.id, request.body.amountCents, request.body.paidAt ?? new Date().toISOString().slice(0, 10), request.body.note?.trim() ?? ""]);
        const status = nextPaid >= Number(document.rows[0].total_cents) ? "paid" : nextPaid + Number(balances.rows[0].credited_cents) >= Number(document.rows[0].total_cents) ? "settled" : "partial";
        await client.query("UPDATE eventdesk_documents SET status=$3,updated_at=now() WHERE id=$1 AND department_id=$2", [request.params.id, departmentId, status]);
        await client.query("COMMIT");
        return { id: request.params.id, paidCents: nextPaid, status };
      } catch (error) { await rollback(client); throw error; } finally { client.release(); }
    });

    routes.post<{ Body: { title: string; customerName?: string; customerId?: string | null; customerContactId?: string | null; linkedEventId?: string | null; venueId?: string | null; supplierRateCardId?: string | null; startsAt: string; endsAt: string; venue?: string; notes?: string } }>("/api/eventdesk/jobs", { schema: jobSchema }, async (request, reply) => {
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
      let discountBps = 0;
      if (body.customerId) {
        const customer = await pool!.query("SELECT name,default_discount_bps FROM eventdesk_customers WHERE id=$1 AND department_id=$2 AND active=true", [body.customerId, departmentId]);
        if (!customer.rowCount) return reply.code(400).send({ error: "Choose an active customer from this location." });
        customerName = customer.rows[0].name;
        discountBps = Number(customer.rows[0].default_discount_bps);
      }
      if (body.supplierRateCardId && !(await pool!.query(`SELECT 1 FROM eventdesk_supplier_rate_cards WHERE id=$1 AND department_id=$2 AND active=true AND valid_from<=$3::date AND (valid_to IS NULL OR valid_to>=$3::date)`, [body.supplierRateCardId, departmentId, body.startsAt])).rowCount) return reply.code(400).send({ error: "Choose an active supplier rate card that is valid on the job start date." });
      const result = await pool!.query(`INSERT INTO eventdesk_jobs (id,department_id,title,customer_name,customer_id,customer_contact_id,linked_event_id,venue_id,starts_at,ends_at,venue,notes,discount_bps,supplier_rate_card_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`, [randomUUID(), departmentId, body.title.trim(), customerName, body.customerId ?? null, body.customerContactId ?? null, body.linkedEventId ?? null, body.venueId ?? null, body.startsAt, body.endsAt, venue, body.notes?.trim() ?? "", discountBps, body.supplierRateCardId ?? null]);
      return reply.code(201).send({ id: result.rows[0].id });
    });

    routes.post<{ Body: { kind: "company" | "person"; name: string; contactPerson?: string; email?: string; phone?: string; street?: string; postalCode?: string; city?: string; country?: string; notes?: string; defaultDiscountBps?: number } }>("/api/eventdesk/customers", { schema: customerSchema }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply, "customers_manage");
      if (!departmentId) return reply;
      const b = request.body;
      const result = await pool!.query(`INSERT INTO eventdesk_customers (id,department_id,kind,name,contact_person,email,phone,street,postal_code,city,country,notes,default_discount_bps)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`, [randomUUID(), departmentId, b.kind, b.name.trim(), b.contactPerson?.trim() ?? "", b.email?.trim() ?? "", b.phone?.trim() ?? "", b.street?.trim() ?? "", b.postalCode?.trim() ?? "", b.city?.trim() ?? "", b.country?.trim() ?? "", b.notes?.trim() ?? "", b.defaultDiscountBps ?? 0]);
      return reply.code(201).send({ id: result.rows[0].id });
    });

    routes.put<{ Params: { id: string }; Body: { kind: "company" | "person"; name: string; contactPerson?: string; email?: string; phone?: string; street?: string; postalCode?: string; city?: string; country?: string; notes?: string; active?: boolean; defaultDiscountBps?: number } }>("/api/eventdesk/customers/:id", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } }, body: customerSchema.body } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply, "customers_manage");
      if (!departmentId) return reply;
      const b = request.body;
      const result = await pool!.query(`UPDATE eventdesk_customers SET kind=$3,name=$4,contact_person=$5,email=$6,phone=$7,street=$8,postal_code=$9,city=$10,country=$11,notes=$12,active=coalesce($13,active),default_discount_bps=$14,updated_at=now()
        WHERE id=$1 AND department_id=$2 RETURNING id`, [request.params.id, departmentId, b.kind, b.name.trim(), b.contactPerson?.trim() ?? "", b.email?.trim() ?? "", b.phone?.trim() ?? "", b.street?.trim() ?? "", b.postalCode?.trim() ?? "", b.city?.trim() ?? "", b.country?.trim() ?? "", b.notes?.trim() ?? "", b.active ?? null, b.defaultDiscountBps ?? 0]);
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

    routes.post<{ Body: { supplierId: string; name: string; validFrom: string; validTo?: string | null; lines: { assetId?: string; category?: string; dailyRateCents: number }[] } }>("/api/eventdesk/rate-cards", { schema: supplierRateCardSchema }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply, "partners_manage");
      if (!departmentId) return reply;
      const body = request.body;
      if (body.validTo && body.validTo < body.validFrom) return reply.code(400).send({ error: "The rate card end date must be on or after its start date." });
      if (body.lines.some((line) => Boolean(line.assetId) === Boolean(line.category?.trim()))) return reply.code(400).send({ error: "Each rate line must target either one equipment item or one category." });
      const targets = body.lines.map((line) => line.assetId ? `asset:${line.assetId}` : `category:${line.category!.trim().toLocaleLowerCase()}`);
      if (new Set(targets).size !== targets.length) return reply.code(400).send({ error: "A rate card cannot repeat an equipment item or category." });
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        const supplier = await client.query("SELECT id FROM eventdesk_partners WHERE id=$1 AND department_id=$2 AND kind='supplier' AND active=true FOR SHARE", [body.supplierId, departmentId]);
        if (!supplier.rowCount) { await rollback(client); return reply.code(400).send({ error: "Choose an active supplier from this location." }); }
        const assetIds = body.lines.flatMap((line) => line.assetId ? [line.assetId] : []);
        if (assetIds.length) {
          const validAssets = await client.query("SELECT id FROM eventdesk_assets WHERE department_id=$1 AND supplier_id=$2 AND id=ANY($3::uuid[])", [departmentId, body.supplierId, assetIds]);
          if (validAssets.rowCount !== assetIds.length) { await rollback(client); return reply.code(400).send({ error: "Equipment-specific rates must target items linked to the selected supplier." }); }
        }
        const id = randomUUID();
        await client.query("INSERT INTO eventdesk_supplier_rate_cards (id,department_id,supplier_id,name,valid_from,valid_to) VALUES ($1,$2,$3,$4,$5,$6)", [id, departmentId, body.supplierId, body.name.trim(), body.validFrom, body.validTo ?? null]);
        for (const line of body.lines) await client.query("INSERT INTO eventdesk_supplier_rate_lines (id,department_id,rate_card_id,asset_id,category,daily_rate_cents) VALUES ($1,$2,$3,$4,$5,$6)", [randomUUID(), departmentId, id, line.assetId ?? null, line.category?.trim() || null, line.dailyRateCents]);
        await client.query("COMMIT");
        return reply.code(201).send({ id });
      } catch (error) { await rollback(client); if ((error as { code?: string }).code === "23505") return reply.code(409).send({ error: "A rate card already contains that item or category." }); throw error; } finally { client.release(); }
    });

    routes.put<{ Params: { id: string }; Body: { active: boolean } }>("/api/eventdesk/rate-cards/:id/status", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } }, body: { type: "object", additionalProperties: false, required: ["active"], properties: { active: { type: "boolean" } } } } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply, "partners_manage");
      if (!departmentId) return reply;
      const result = await pool!.query("UPDATE eventdesk_supplier_rate_cards SET active=$3,updated_at=now() WHERE id=$1 AND department_id=$2 RETURNING id", [request.params.id, departmentId, request.body.active]);
      return result.rowCount ? { id: request.params.id, active: request.body.active } : reply.code(404).send({ error: "Rate card not found." });
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

    routes.post<{ Body: { name: string; description?: string; discountBps?: number; items: { assetId: string; quantity: number }[] } }>("/api/eventdesk/packages", { schema: packageSchema }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply, "inventory_manage");
      if (!departmentId) return reply;
      const name = request.body.name.trim();
      const itemIds = request.body.items.map((item) => item.assetId);
      if (!name) return reply.code(400).send({ error: "Enter a package name." });
      if (new Set(itemIds).size !== itemIds.length) return reply.code(400).send({ error: "Each equipment item can only appear once in a package." });
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        const assets = await client.query("SELECT id FROM eventdesk_assets WHERE department_id=$1 AND active=true AND id=ANY($2::uuid[])", [departmentId, itemIds]);
        if (assets.rowCount !== itemIds.length) { await rollback(client); return reply.code(400).send({ error: "Choose active equipment from this location for every package item." }); }
        const created = await client.query("INSERT INTO eventdesk_packages (id,department_id,name,description,discount_bps) VALUES ($1,$2,$3,$4,$5) RETURNING id", [randomUUID(), departmentId, name, request.body.description?.trim() ?? "", request.body.discountBps ?? 0]);
        for (const item of request.body.items) await client.query("INSERT INTO eventdesk_package_items (department_id,package_id,asset_id,quantity) VALUES ($1,$2,$3,$4)", [departmentId, created.rows[0].id, item.assetId, item.quantity]);
        await client.query("COMMIT");
        return reply.code(201).send({ id: created.rows[0].id });
      } catch (error) { await rollback(client); if ((error as { code?: string }).code === "23505") return reply.code(409).send({ error: "A package with that name already exists." }); throw error; } finally { client.release(); }
    });

    routes.put<{ Params: { id: string }; Body: { name: string; description?: string; discountBps?: number; items: { assetId: string; quantity: number }[] } }>("/api/eventdesk/packages/:id", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } }, body: packageSchema.body } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply, "inventory_manage");
      if (!departmentId) return reply;
      const name = request.body.name.trim();
      const itemIds = request.body.items.map((item) => item.assetId);
      if (!name) return reply.code(400).send({ error: "Enter a package name." });
      if (new Set(itemIds).size !== itemIds.length) return reply.code(400).send({ error: "Each equipment item can only appear once in a package." });
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        const current = await client.query("SELECT id FROM eventdesk_packages WHERE id=$1 AND department_id=$2 FOR UPDATE", [request.params.id, departmentId]);
        if (!current.rowCount) { await rollback(client); return reply.code(404).send({ error: "Package not found." }); }
        const assets = await client.query("SELECT id FROM eventdesk_assets WHERE department_id=$1 AND active=true AND id=ANY($2::uuid[])", [departmentId, itemIds]);
        if (assets.rowCount !== itemIds.length) { await rollback(client); return reply.code(400).send({ error: "Choose active equipment from this location for every package item." }); }
        await client.query("UPDATE eventdesk_packages SET name=$3,description=$4,discount_bps=$5,updated_at=now() WHERE id=$1 AND department_id=$2", [request.params.id, departmentId, name, request.body.description?.trim() ?? "", request.body.discountBps ?? 0]);
        await client.query("DELETE FROM eventdesk_package_items WHERE package_id=$1 AND department_id=$2", [request.params.id, departmentId]);
        for (const item of request.body.items) await client.query("INSERT INTO eventdesk_package_items (department_id,package_id,asset_id,quantity) VALUES ($1,$2,$3,$4)", [departmentId, request.params.id, item.assetId, item.quantity]);
        await client.query("COMMIT");
        return { id: request.params.id };
      } catch (error) { await rollback(client); if ((error as { code?: string }).code === "23505") return reply.code(409).send({ error: "A package with that name already exists." }); throw error; } finally { client.release(); }
    });

    routes.post<{ Params: { id: string }; Body: { packageId: string; quantity: number } }>("/api/eventdesk/jobs/:id/packages", { schema: {
      params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["packageId", "quantity"], properties: { packageId: { type: "string", format: "uuid" }, quantity: { type: "integer", minimum: 1, maximum: 100000 } } },
    } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply, "inventory_manage");
      if (!departmentId) return reply;
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        const job = await client.query("SELECT starts_at,ends_at,status,supplier_rate_card_id FROM eventdesk_jobs WHERE id=$1 AND department_id=$2 FOR SHARE", [request.params.id, departmentId]);
        if (!job.rowCount || ["cancelled", "completed"].includes(job.rows[0].status)) { await rollback(client); return reply.code(404).send({ error: "An active job is required for an equipment booking." }); }
        const packageResult = await client.query("SELECT id,name,discount_bps FROM eventdesk_packages WHERE id=$1 AND department_id=$2 FOR SHARE", [request.body.packageId, departmentId]);
        if (!packageResult.rowCount) { await rollback(client); return reply.code(404).send({ error: "Package not found." }); }
        const items = await client.query(`SELECT i.asset_id,i.quantity
          FROM eventdesk_package_items i JOIN eventdesk_assets a ON a.id=i.asset_id AND a.department_id=i.department_id
          WHERE i.package_id=$1 AND i.department_id=$2 ORDER BY i.asset_id`, [request.body.packageId, departmentId]);
        if (!items.rowCount) { await rollback(client); return reply.code(409).send({ error: "This package has no equipment items." }); }
        const assetIds = items.rows.map((item) => item.asset_id);
        const lockedAssets = await client.query("SELECT id,active,quantity,daily_rate_cents,name,category,supplier_id FROM eventdesk_assets WHERE department_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE", [departmentId, assetIds]);
        if (lockedAssets.rowCount !== items.rowCount) { await rollback(client); return reply.code(409).send({ error: "A package item is no longer available in this location." }); }
        const lockedById = new Map(lockedAssets.rows.map((asset) => [asset.id, asset]));
        for (const item of items.rows) {
          const asset = lockedById.get(item.asset_id)!;
          const required = Number(item.quantity) * request.body.quantity;
          if (!asset.active) { await rollback(client); return reply.code(409).send({ error: `${asset.name} is inactive. Edit the package before using it.` }); }
          if (required > Number(asset.quantity) || required > 100000) { await rollback(client); return reply.code(409).send({ error: `${asset.name} requires ${required} units, which exceeds its available stock limit.` }); }
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
          ),0)::int AS quantity FROM points p`, [departmentId, item.asset_id, job.rows[0].starts_at, job.rows[0].ends_at]);
          const available = Number(item.stock_quantity) - Number(reserved.rows[0].quantity);
          if (required > available) { await rollback(client); return reply.code(409).send({ error: `${asset.name}: only ${Math.max(0, available)} unit(s) are available for those dates; package requires ${required}.` }); }
        }
        for (const item of items.rows) {
          const asset = lockedById.get(item.asset_id)!;
          const baseRate = await rentalRate(client, departmentId, job.rows[0].supplier_rate_card_id, job.rows[0].starts_at, asset);
          const packageRate = Math.round(baseRate * (10000 - Number(packageResult.rows[0].discount_bps)) / 10000);
          await client.query(`INSERT INTO eventdesk_job_assets (id,department_id,job_id,asset_id,quantity,daily_rate_cents)
            VALUES ($1,$2,$3,$4,$5,$6)`, [randomUUID(), departmentId, request.params.id, item.asset_id, Number(item.quantity) * request.body.quantity, packageRate]);
        }
        await client.query("COMMIT");
        return reply.code(201).send({ packageName: packageResult.rows[0].name, itemCount: items.rowCount });
      } catch (error) { await rollback(client); throw error; } finally { client.release(); }
    });

    routes.post<{ Params: { id: string }; Body: { assetId: string; quantity: number } }>("/api/eventdesk/jobs/:id/assets", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } }, body: { type: "object", additionalProperties: false, required: ["assetId", "quantity"], properties: { assetId: { type: "string", format: "uuid" }, quantity: { type: "integer", minimum: 1, maximum: 100000 } } } } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply, "inventory_manage");
      if (!departmentId) return reply;
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        const job = await client.query("SELECT starts_at,ends_at,status,supplier_rate_card_id FROM eventdesk_jobs WHERE id=$1 AND department_id=$2 FOR SHARE", [request.params.id, departmentId]);
        if (!job.rowCount || ["cancelled", "completed"].includes(job.rows[0].status)) { await rollback(client); return reply.code(404).send({ error: "An active job is required for an equipment booking." }); }
        const asset = await client.query("SELECT id,name,category,quantity,daily_rate_cents,active,supplier_id FROM eventdesk_assets WHERE id=$1 AND department_id=$2 FOR UPDATE", [request.body.assetId, departmentId]);
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
        const dailyRate = await rentalRate(client, departmentId, job.rows[0].supplier_rate_card_id, job.rows[0].starts_at, asset.rows[0]);
        const result = await client.query(`INSERT INTO eventdesk_job_assets (id,department_id,job_id,asset_id,quantity,daily_rate_cents)
          VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [randomUUID(), departmentId, request.params.id, request.body.assetId, request.body.quantity, dailyRate]);
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

    routes.post<{ Body: { name: string; email?: string; phone?: string; roles?: string[]; hourlyRateCents?: number; notes?: string } }>("/api/eventdesk/freelancers", { schema: { body: { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string", minLength: 1, maxLength: 160 }, email: { type: "string", maxLength: 254, pattern: "^$|^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$" }, phone: { type: "string", maxLength: 40 }, roles: { type: "array", maxItems: 30, items: { type: "string", minLength: 1, maxLength: 80 } }, hourlyRateCents: { type: "integer", minimum: 0, maximum: 100000000 }, notes: { type: "string", maxLength: 2000 } } } } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply, "crew_manage");
      if (!departmentId) return reply;
      const b = request.body;
      const created = await pool!.query(`INSERT INTO eventdesk_freelancers (id,department_id,name,email,phone,roles,hourly_rate_cents,notes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [randomUUID(), departmentId, b.name.trim(), b.email?.trim().toLocaleLowerCase("en-US") ?? "", b.phone?.trim() ?? "", (b.roles ?? []).map((role) => role.trim()).filter(Boolean), b.hourlyRateCents ?? 0, b.notes?.trim() ?? ""]);
      return reply.code(201).send({ id: created.rows[0].id });
    });

    routes.put<{ Params: { id: string }; Body: { name?: string; email?: string; phone?: string; roles?: string[]; hourlyRateCents?: number; notes?: string; active?: boolean } }>("/api/eventdesk/freelancers/:id", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } }, body: { type: "object", additionalProperties: false, properties: { name: { type: "string", minLength: 1, maxLength: 160 }, email: { type: "string", maxLength: 254, pattern: "^$|^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$" }, phone: { type: "string", maxLength: 40 }, roles: { type: "array", maxItems: 30, items: { type: "string", minLength: 1, maxLength: 80 } }, hourlyRateCents: { type: "integer", minimum: 0, maximum: 100000000 }, notes: { type: "string", maxLength: 2000 }, active: { type: "boolean" } } } } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply, "crew_manage");
      if (!departmentId) return reply;
      const b = request.body;
      const updated = await pool!.query(`UPDATE eventdesk_freelancers SET
          name=coalesce($3,name),email=coalesce($4,email),phone=coalesce($5,phone),roles=coalesce($6,roles),hourly_rate_cents=coalesce($7,hourly_rate_cents),notes=coalesce($8,notes),active=coalesce($9,active),updated_at=now()
        WHERE id=$1 AND department_id=$2 RETURNING id`, [request.params.id, departmentId, b.name?.trim(), b.email?.trim().toLocaleLowerCase("en-US"), b.phone?.trim(), b.roles?.map((role) => role.trim()).filter(Boolean), b.hourlyRateCents, b.notes?.trim(), b.active]);
      if (!updated.rowCount) return reply.code(404).send({ error: "Freelancer not found." });
      return { id: updated.rows[0].id };
    });

    routes.post<{ Params: { id: string }; Body: { startsAt: string; endsAt: string; reason?: string } }>("/api/eventdesk/freelancers/:id/unavailability", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } }, body: { type: "object", additionalProperties: false, required: ["startsAt", "endsAt"], properties: { startsAt: { type: "string", format: "date-time" }, endsAt: { type: "string", format: "date-time" }, reason: { type: "string", maxLength: 240 } } } } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply, "crew_manage");
      if (!departmentId) return reply;
      if (new Date(request.body.endsAt) <= new Date(request.body.startsAt)) return reply.code(400).send({ error: "The end must be after the start." });
      const freelancer = await pool!.query("SELECT 1 FROM eventdesk_freelancers WHERE id=$1 AND department_id=$2 AND active=true", [request.params.id, departmentId]);
      if (!freelancer.rowCount) return reply.code(404).send({ error: "An active freelancer was not found." });
      const conflict = await pool!.query(`SELECT 1 FROM eventdesk_job_crew c JOIN eventdesk_jobs j ON j.id=c.job_id AND j.department_id=c.department_id
        WHERE c.department_id=$1 AND c.freelancer_id=$2 AND c.status IN ('assigned','invited','confirmed') AND j.status NOT IN ('cancelled','completed')
          AND j.starts_at < $4 AND j.ends_at > $3 LIMIT 1`, [departmentId, request.params.id, request.body.startsAt, request.body.endsAt]);
      if (conflict.rowCount) return reply.code(409).send({ error: "This time overlaps an assigned or confirmed job for the freelancer." });
      const result = await pool!.query(`INSERT INTO eventdesk_freelancer_unavailability (id,department_id,freelancer_id,starts_at,ends_at,reason)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [randomUUID(), departmentId, request.params.id, request.body.startsAt, request.body.endsAt, request.body.reason?.trim() ?? ""]);
      return reply.code(201).send({ id: result.rows[0].id });
    });

    routes.delete<{ Params: { id: string } }>("/api/eventdesk/freelancer-unavailability/:id", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply, "crew_manage");
      if (!departmentId) return reply;
      const removed = await pool!.query("DELETE FROM eventdesk_freelancer_unavailability WHERE id=$1 AND department_id=$2 RETURNING id", [request.params.id, departmentId]);
      if (!removed.rowCount) return reply.code(404).send({ error: "Availability block not found." });
      return { id: removed.rows[0].id };
    });

    routes.post<{ Params: { id: string }; Body: { role: string; contactId?: string | null; freelancerId?: string | null; hours?: number; hourlyRateCents?: number; notes?: string } }>("/api/eventdesk/jobs/:id/crew", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } }, body: { type: "object", additionalProperties: false, required: ["role"], properties: { role: { type: "string", minLength: 1, maxLength: 100 }, contactId: { type: ["string", "null"], format: "uuid" }, freelancerId: { type: ["string", "null"], format: "uuid" }, hours: { type: "number", minimum: 0, maximum: 1000 }, hourlyRateCents: { type: "integer", minimum: 0, maximum: 100000000 }, notes: { type: "string", maxLength: 500 } } } } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply, "crew_manage");
      if (!departmentId) return reply;
      if (request.body.contactId && request.body.freelancerId) return reply.code(400).send({ error: "Choose either a Smart-Church contact or a freelancer." });
      if (!await sameDepartmentRecord("contacts", request.body.contactId, departmentId) || !await sameDepartmentRecord("eventdesk_freelancers", request.body.freelancerId, departmentId)) return reply.code(400).send({ error: "Choose a person from this location." });
      if (request.body.freelancerId) {
        const activeFreelancer = await pool!.query("SELECT 1 FROM eventdesk_freelancers WHERE id=$1 AND department_id=$2 AND active=true", [request.body.freelancerId, departmentId]);
        if (!activeFreelancer.rowCount) return reply.code(400).send({ error: "Choose an active freelancer." });
      }
      const job = await pool!.query("SELECT starts_at,ends_at,status FROM eventdesk_jobs WHERE id=$1 AND department_id=$2", [request.params.id, departmentId]);
      if (!job.rowCount || ["cancelled", "completed"].includes(job.rows[0].status)) return reply.code(404).send({ error: "An active job is required for a crew request." });
      if (request.body.contactId || request.body.freelancerId) {
        const conflict = await pool!.query(`SELECT 1 FROM eventdesk_job_crew c JOIN eventdesk_jobs j ON j.id=c.job_id AND j.department_id=c.department_id
          WHERE c.department_id=$1 AND (($2::uuid IS NOT NULL AND c.contact_id=$2) OR ($3::uuid IS NOT NULL AND c.freelancer_id=$3)) AND c.status IN ('assigned','invited','confirmed') AND j.status NOT IN ('cancelled','completed')
            AND j.starts_at < $5 AND j.ends_at > $4 LIMIT 1`, [departmentId, request.body.contactId ?? null, request.body.freelancerId ?? null, job.rows[0].starts_at, job.rows[0].ends_at]);
        if (conflict.rowCount) return reply.code(409).send({ error: "This person is already assigned to an overlapping job." });
      }
      if (request.body.freelancerId) {
        const unavailable = await pool!.query("SELECT 1 FROM eventdesk_freelancer_unavailability WHERE department_id=$1 AND freelancer_id=$2 AND starts_at<$4 AND ends_at>$3 LIMIT 1", [departmentId, request.body.freelancerId, job.rows[0].starts_at, job.rows[0].ends_at]);
        if (unavailable.rowCount) return reply.code(409).send({ error: "This freelancer is marked unavailable during the job." });
      }
      const assigned = Boolean(request.body.contactId || request.body.freelancerId);
      const status = assigned ? "assigned" : "requested";
      const result = await pool!.query(`INSERT INTO eventdesk_job_crew (id,department_id,job_id,role,contact_id,freelancer_id,hours,hourly_rate_cents,status,notes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, [randomUUID(), departmentId, request.params.id, request.body.role.trim(), request.body.contactId ?? null, request.body.freelancerId ?? null, request.body.hours ?? 0, request.body.hourlyRateCents ?? 0, status, request.body.notes?.trim() ?? ""]);
      return reply.code(201).send({ id: result.rows[0].id, status });
    });

    routes.put<{ Params: { id: string }; Body: { contactId?: string | null; freelancerId?: string | null; hours?: number; hourlyRateCents?: number; status?: CrewStatus; notes?: string } }>("/api/eventdesk/crew/:id", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } }, body: { type: "object", additionalProperties: false, properties: { contactId: { type: ["string", "null"], format: "uuid" }, freelancerId: { type: ["string", "null"], format: "uuid" }, hours: { type: "number", minimum: 0, maximum: 1000 }, hourlyRateCents: { type: "integer", minimum: 0, maximum: 100000000 }, status: { type: "string", enum: crewStatuses }, notes: { type: "string", maxLength: 500 } } } } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply, "crew_manage");
      if (!departmentId) return reply;
      const existing = await pool!.query(`SELECT c.contact_id,c.freelancer_id,c.hours,c.hourly_rate_cents,c.status,c.notes,j.starts_at,j.ends_at,j.status AS job_status
        FROM eventdesk_job_crew c JOIN eventdesk_jobs j ON j.id=c.job_id AND j.department_id=c.department_id WHERE c.id=$1 AND c.department_id=$2`, [request.params.id, departmentId]);
      if (!existing.rowCount) return reply.code(404).send({ error: "Crew request not found." });
      const b = request.body;
      if (b.contactId && b.freelancerId) return reply.code(400).send({ error: "Choose either a Smart-Church contact or a freelancer." });
      let contactId = b.contactId === undefined ? existing.rows[0].contact_id : b.contactId;
      let freelancerId = b.freelancerId === undefined ? existing.rows[0].freelancer_id : b.freelancerId;
      if (b.contactId && b.freelancerId === undefined) freelancerId = null;
      if (b.freelancerId && b.contactId === undefined) contactId = null;
      if (!await sameDepartmentRecord("contacts", contactId, departmentId) || !await sameDepartmentRecord("eventdesk_freelancers", freelancerId, departmentId)) return reply.code(400).send({ error: "Choose a person from this location." });
      if (freelancerId) {
        const active = await pool!.query("SELECT 1 FROM eventdesk_freelancers WHERE id=$1 AND department_id=$2 AND active=true", [freelancerId, departmentId]);
        if (!active.rowCount) return reply.code(400).send({ error: "Choose an active freelancer." });
        const unavailable = await pool!.query("SELECT 1 FROM eventdesk_freelancer_unavailability WHERE department_id=$1 AND freelancer_id=$2 AND starts_at<$4 AND ends_at>$3 LIMIT 1", [departmentId, freelancerId, existing.rows[0].starts_at, existing.rows[0].ends_at]);
        if (unavailable.rowCount) return reply.code(409).send({ error: "This freelancer is marked unavailable during the job." });
      }
      const status = b.status ?? (contactId || freelancerId ? "assigned" : "requested");
      if (["assigned", "invited", "confirmed"].includes(status) && !contactId && !freelancerId) return reply.code(400).send({ error: "Assign a person before changing this request to that status." });
      if ((contactId || freelancerId) && ["assigned", "invited", "confirmed"].includes(status)) {
        const conflict = await pool!.query(`SELECT 1 FROM eventdesk_job_crew c JOIN eventdesk_jobs j ON j.id=c.job_id AND j.department_id=c.department_id
          WHERE c.department_id=$1 AND c.id<>$2 AND (($3::uuid IS NOT NULL AND c.contact_id=$3) OR ($4::uuid IS NOT NULL AND c.freelancer_id=$4))
            AND c.status IN ('assigned','invited','confirmed') AND j.status NOT IN ('cancelled','completed') AND j.starts_at<$6 AND j.ends_at>$5 LIMIT 1`,
          [departmentId, request.params.id, contactId ?? null, freelancerId ?? null, existing.rows[0].starts_at, existing.rows[0].ends_at]);
        if (conflict.rowCount) return reply.code(409).send({ error: "This person is already assigned to an overlapping job." });
      }
      await pool!.query(`UPDATE eventdesk_job_crew SET contact_id=$3,freelancer_id=$4,hours=$5,hourly_rate_cents=$6,status=$7,notes=$8,updated_at=now() WHERE id=$1 AND department_id=$2`,
        [request.params.id, departmentId, contactId ?? null, freelancerId ?? null, b.hours ?? existing.rows[0].hours, b.hourlyRateCents ?? existing.rows[0].hourly_rate_cents, status, b.notes ?? existing.rows[0].notes]);
      return { id: request.params.id, contactId: contactId ?? null, freelancerId: freelancerId ?? null, status };
    });

    routes.post<{ Params: { id: string }; Body: { message?: string } }>("/api/eventdesk/crew/:id/send-request", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } }, body: { type: "object", additionalProperties: false, properties: { message: { type: "string", maxLength: 2000 } } } } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply, "crew_manage");
      if (!departmentId) return reply;
      const apiKey = resendApiKey();
      const from = emailFrom();
      if (!apiKey || !from) return reply.code(503).send({ error: "Email delivery is not configured. Set SMART_CHURCH_RESEND_API_KEY and SMART_CHURCH_EMAIL_FROM on the Smart-Church server." });
      const data = await pool!.query(`SELECT c.id,c.status,c.freelancer_id,f.name,f.email,f.active,j.title,j.starts_at,j.ends_at,j.venue,j.status AS job_status
        FROM eventdesk_job_crew c JOIN eventdesk_freelancers f ON f.id=c.freelancer_id AND f.department_id=c.department_id
        JOIN eventdesk_jobs j ON j.id=c.job_id AND j.department_id=c.department_id
        WHERE c.id=$1 AND c.department_id=$2`, [request.params.id, departmentId]);
      if (!data.rowCount) return reply.code(404).send({ error: "A crew request assigned to a freelancer was not found." });
      const crew = data.rows[0];
      if (["cancelled", "completed"].includes(crew.job_status)) return reply.code(409).send({ error: "Crew requests cannot be sent for a completed or cancelled job." });
      if (!crew.active || !crew.email) return reply.code(409).send({ error: "Add an email address to an active freelancer before sending a request." });
      if (!["assigned", "invited"].includes(crew.status)) return reply.code(409).send({ error: "Assign this crew position before sending or resending its request." });
      const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
      const schedule = `${new Date(crew.starts_at).toLocaleString("en-CH")}  -  ${new Date(crew.ends_at).toLocaleString("en-CH")}`;
      const subject = `Crew request: ${crew.title}`;
      const html = `<div style="font-family:Arial,sans-serif;color:#202b28;max-width:640px;margin:auto"><h2>Crew request</h2><p>Hello ${escapeHtml(crew.name)},</p><p>Would you be available to work on <strong>${escapeHtml(crew.title)}</strong>?</p><p>${escapeHtml(schedule)}${crew.venue ? `<br>${escapeHtml(crew.venue)}` : ""}</p>${request.body.message ? `<p>${escapeHtml(request.body.message).replaceAll("\n", "<br>")}</p>` : ""}<p>Please reply to this email to confirm or decline. The church will update the request status when you reply.</p></div>`;
      const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ from, to: [crew.email], subject, html }), signal: AbortSignal.timeout(20_000) }).catch(() => null);
      let providerId = "";
      let errorSummary = "";
      if (!response) errorSummary = "The email provider did not respond before the request timed out.";
      else if (!response.ok) {
        const providerError = await response.json().catch(() => ({})) as { message?: string; error?: string };
        errorSummary = (providerError.message ?? providerError.error ?? `Email provider returned HTTP ${response.status}.`).slice(0, 500);
      } else {
        const result = await response.json().catch(() => ({})) as { id?: string };
        providerId = result.id ?? "";
      }
      await pool!.query(`INSERT INTO eventdesk_crew_deliveries (id,department_id,crew_id,freelancer_id,recipient_email,status,provider_message_id,error_summary,sent_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $6='sent' THEN now() ELSE NULL END)`, [randomUUID(), departmentId, crew.id, crew.freelancer_id, crew.email, errorSummary ? "failed" : "sent", providerId, errorSummary]);
      if (errorSummary) return reply.code(502).send({ error: `Crew request email failed: ${errorSummary}` });
      await pool!.query("UPDATE eventdesk_job_crew SET status='invited',updated_at=now() WHERE id=$1 AND department_id=$2 AND status IN ('assigned','invited')", [crew.id, departmentId]);
      return { id: crew.id, status: "invited", recipientEmail: crew.email, providerMessageId: providerId };
    });
  });
}
