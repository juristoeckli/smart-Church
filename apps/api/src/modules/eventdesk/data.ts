import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import type { ModuleServerContext } from "../module-sdk.js";

type Entity = "customers" | "equipment" | "suppliers" | "venues" | "freelancers" | "jobs";
type Row = Record<string, string>;
const entities: Entity[] = ["customers", "equipment", "suppliers", "venues", "freelancers", "jobs"];
const permissions: Record<Entity, string> = { customers: "customers_manage", equipment: "inventory_manage", suppliers: "partners_manage", venues: "partners_manage", freelancers: "crew_manage", jobs: "jobs_manage" };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isTrue = (value: string | undefined) => value === undefined || value === "" || ["true", "1", "yes", "active"].includes(value.trim().toLowerCase());
const cents = (value: string | undefined) => Math.round(Number(value || 0));
const quoteCsv = (value: unknown) => { const text = String(value ?? ""); return `"${(/^[\s]*[=+\-@\t\r]/.test(text) ? `'${text}` : text).replaceAll('"', '""')}"`; };
const csv = (headers: string[], rows: unknown[][]) => `\uFEFF${[headers, ...rows].map((row) => row.map(quoteCsv).join(",")).join("\r\n")}`;
function safeUuid(value: string | undefined) { return value?.trim() && uuidPattern.test(value.trim()) ? value.trim() : null; }

export function registerEventDeskDataRoutes(app: FastifyInstance, context: ModuleServerContext) {
  const { pool, isDatabaseReady, resolveDepartmentId, validateMutation } = context;
  app.register(async (routes) => {
    async function department(request: FastifyRequest, reply: FastifyReply, permission?: string) {
      if (!pool || !isDatabaseReady()) { reply.code(503).send({ error: "EventDesk is unavailable because its database is not ready." }); return null; }
      const id = await resolveDepartmentId(request, reply);
      if (!id) return null;
      const enabled = await pool.query("SELECT enabled_modules FROM departments WHERE id=$1", [id]);
      if (!enabled.rows[0]?.enabled_modules?.includes("eventdesk")) { reply.code(404).send({ error: "EventDesk is not enabled for this location." }); return null; }
      const grants = request.activeDepartmentModulePermissions?.eventdesk ?? [];
      if (request.activeDepartmentRole !== "site_admin" && permission && !grants.includes(permission)) { reply.code(403).send({ error: "You do not have access to this EventDesk feature." }); return null; }
      return id;
    }

    async function checkRows(client: PoolClient, departmentId: string, entity: Entity, rows: Row[]) {
      const seen = new Set<string>();
      const results: { row: number; data: Row; errors: string[]; duplicate: string | null }[] = [];
      for (const [index, row] of rows.entries()) {
        const data = Object.fromEntries(Object.entries(row).map(([key, value]) => [key.trim().toLowerCase().replace(/[\s-]+/g, "_"), String(value ?? "").trim()]));
        const errors: string[] = [];
        const lengths: Record<string, number> = entity === "customers" ? { name: 160, contact_person: 160, email: 254, phone: 40, street: 200, postal_code: 24, city: 120, country: 80, notes: 2000 }
          : entity === "equipment" ? { name: 160, category: 80, notes: 1000, barcode: 120 }
          : entity === "suppliers" || entity === "venues" ? { name: 160, contact_person: 160, email: 254, phone: 40, street: 200, postal_code: 24, city: 120, country: 80, notes: 2000 }
          : entity === "freelancers" ? { name: 160, email: 254, phone: 40, notes: 2000 }
          : { title: 160, customer_name: 160, venue: 240, notes: 4000 };
        for (const [key, maximum] of Object.entries(lengths)) if ((data[key] ?? "").length > maximum) errors.push(`${key.replaceAll("_", " ")} must be ${maximum} characters or fewer.`);
        const required = (key: string, label = key.replaceAll("_", " ")) => { if (!data[key]) errors.push(`${label} is required.`); };
        const number = (key: string, label: string, min: number, max: number, integer = false) => {
          if (!data[key]) return;
          const value = Number(data[key]);
          if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) errors.push(`${label} must be ${integer ? "a whole number " : "a number "}from ${min} to ${max}.`);
        };
        const id = data.id ? safeUuid(data.id) : null;
        if (data.id && !id) errors.push("ID must be a UUID.");
        if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.push("Email must be a valid address.");
        const tableByEntity: Record<Entity, string> = { customers: "eventdesk_customers", equipment: "eventdesk_assets", suppliers: "eventdesk_partners", venues: "eventdesk_partners", freelancers: "eventdesk_freelancers", jobs: "eventdesk_jobs" };
        let duplicate: string | null = id && (await client.query(`SELECT 1 FROM ${tableByEntity[entity]} WHERE id=$1 LIMIT 1`, [id])).rowCount ? "Stable ID already exists." : null;
        if (entity === "customers") {
          required("name"); if (data.kind && !["company", "person"].includes(data.kind)) errors.push("Kind must be company or person.");
          const match = await client.query("SELECT id FROM eventdesk_customers WHERE department_id=$1 AND (($2::uuid IS NOT NULL AND id=$2) OR lower(name)=lower($3) OR ($4<>'' AND lower(email)=lower($4))) LIMIT 1", [departmentId, id, data.name ?? "", data.email ?? ""]);
          if (match.rowCount && !duplicate) duplicate = `Customer already exists (${match.rows[0].id}).`;
        } else if (entity === "equipment") {
          required("name"); required("category"); required("quantity", "Quantity"); number("quantity", "Quantity", 1, 100000, true); number("daily_rate_cents", "Daily rate in cents", 0, 100000000, true);
          const match = await client.query("SELECT id FROM eventdesk_assets WHERE department_id=$1 AND (($2::uuid IS NOT NULL AND id=$2) OR ($3<>'' AND lower(barcode)=lower($3)) OR lower(name)=lower($4)) LIMIT 1", [departmentId, id, data.barcode ?? "", data.name ?? ""]);
          if (match.rowCount && !duplicate) duplicate = `Equipment already exists (${match.rows[0].id}).`;
          if (data.supplier_ref && !safeUuid(data.supplier_ref)) errors.push("Supplier reference must be a UUID.");
          else if (data.supplier_ref && !(await client.query("SELECT 1 FROM eventdesk_partners WHERE id=$1 AND department_id=$2 AND kind='supplier'", [data.supplier_ref, departmentId])).rowCount) errors.push("Supplier reference was not found in this location.");
        } else if (entity === "suppliers" || entity === "venues") {
          required("name");
          const kind = entity === "suppliers" ? "supplier" : "venue";
          const match = await client.query("SELECT id FROM eventdesk_partners WHERE department_id=$1 AND kind=$2 AND (($3::uuid IS NOT NULL AND id=$3) OR lower(name)=lower($4)) LIMIT 1", [departmentId, kind, id, data.name ?? ""]);
          if (match.rowCount && !duplicate) duplicate = `${kind === "supplier" ? "Supplier" : "Venue"} already exists (${match.rows[0].id}).`;
        } else if (entity === "freelancers") {
          required("name");
          const match = await client.query("SELECT id FROM eventdesk_freelancers WHERE department_id=$1 AND (($2::uuid IS NOT NULL AND id=$2) OR ($3<>'' AND lower(email)=lower($3))) LIMIT 1", [departmentId, id, data.email ?? ""]);
          if (match.rowCount && !duplicate) duplicate = `Freelancer already exists (${match.rows[0].id}).`;
          number("hourly_rate_cents", "Hourly rate in cents", 0, 100000000, true);
          const roles = (data.roles ?? "").split(/[;,]/).map((role) => role.trim()).filter(Boolean);
          if (roles.length > 30 || roles.some((role) => role.length > 80)) errors.push("Roles must contain at most 30 entries of 80 characters each.");
        } else {
          required("title"); required("starts_at"); required("ends_at");
          const start = Date.parse(data.starts_at ?? ""); const end = Date.parse(data.ends_at ?? "");
          if (Number.isNaN(start) || Number.isNaN(end) || end <= start) errors.push("Start and end must be valid dates, with end after start.");
          if (data.status && !["lead", "quoted", "confirmed", "in_progress", "completed", "cancelled"].includes(data.status)) errors.push("Job status is invalid.");
          const match = await client.query("SELECT id FROM eventdesk_jobs WHERE department_id=$1 AND (($2::uuid IS NOT NULL AND id=$2) OR (lower(title)=lower($3) AND starts_at=$4::timestamptz)) LIMIT 1", [departmentId, id, data.title ?? "", Number.isNaN(start) ? null : new Date(start).toISOString()]);
          if (match.rowCount && !duplicate) duplicate = `Job already exists (${match.rows[0].id}).`;
          if (data.customer_ref) {
            const ref = safeUuid(data.customer_ref);
            if (!ref) errors.push("Customer reference must be a UUID from a customer export.");
            else if (!(await client.query("SELECT 1 FROM eventdesk_customers WHERE id=$1 AND department_id=$2", [ref, departmentId])).rowCount) errors.push("Customer reference was not found in this location.");
          }
          if (data.venue_ref) {
            const ref = safeUuid(data.venue_ref);
            if (!ref) errors.push("Venue reference must be a UUID from a venue export.");
            else if (!(await client.query("SELECT 1 FROM eventdesk_partners WHERE id=$1 AND department_id=$2 AND kind='venue'", [ref, departmentId])).rowCount) errors.push("Venue reference was not found in this location.");
          }
        }
        if (data.active && !["true","false","1","0","yes","no","active","inactive"].includes(data.active.toLowerCase())) errors.push("Active must be true or false.");
        const duplicateKey = entity === "jobs" ? `${data.title?.toLowerCase()}|${data.starts_at}` : `${data.name?.toLowerCase()}|${data.email?.toLowerCase() ?? ""}|${data.barcode?.toLowerCase() ?? ""}`;
        if (seen.has(duplicateKey)) duplicate = "This record is repeated in the CSV file.";
        seen.add(duplicateKey);
        results.push({ row: index + 2, data, errors, duplicate });
      }
      return results;
    }

    routes.post<{ Body: { entity: Entity; rows: Row[] } }>("/api/eventdesk/data/import/preview", { schema: { body: { type: "object", additionalProperties: false, required: ["entity", "rows"], properties: { entity: { type: "string", enum: entities }, rows: { type: "array", minItems: 1, maxItems: 1000, items: { type: "object", additionalProperties: { type: "string", maxLength: 10000 }, maxProperties: 60 } } } } } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply, permissions[request.body.entity]); if (!departmentId) return reply;
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        const checked = await checkRows(client, departmentId, request.body.entity, request.body.rows);
        const id = randomUUID();
        await client.query("INSERT INTO eventdesk_import_previews (id,department_id,entity,rows_json,created_by) VALUES ($1,$2,$3,$4::jsonb,$5)", [id, departmentId, request.body.entity, JSON.stringify(checked), request.authenticatedUser?.id ?? null]);
        await client.query("COMMIT");
        return reply.code(201).send({ previewId: id, entity: request.body.entity, rows: checked, validCount: checked.filter((row) => !row.errors.length && !row.duplicate).length, errorCount: checked.filter((row) => row.errors.length > 0).length, duplicateCount: checked.filter((row) => Boolean(row.duplicate)).length, expiresInMinutes: 30 });
      } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
    });

    routes.post<{ Params: { id: string } }>("/api/eventdesk/data/import/:id/commit", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      if (!pool || !isDatabaseReady()) return reply.code(503).send({ error: "EventDesk database is not ready." });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const preview = await client.query("SELECT department_id,entity,rows_json,expires_at,committed_at FROM eventdesk_import_previews WHERE id=$1 FOR UPDATE", [request.params.id]);
        if (!preview.rowCount || preview.rows[0].committed_at || new Date(preview.rows[0].expires_at) < new Date()) { await client.query("ROLLBACK"); return reply.code(410).send({ error: "This import preview has expired or was already committed. Preview the CSV again." }); }
        const departmentId = preview.rows[0].department_id as string; const entity = preview.rows[0].entity as Entity;
        const allowed = await department(request, reply, permissions[entity]);
        if (!allowed || allowed !== departmentId) { await client.query("ROLLBACK"); return allowed ? reply.code(403).send({ error: "The preview belongs to another location." }) : reply; }
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [departmentId,entity]);
        const checked = await checkRows(client, departmentId, entity, preview.rows[0].rows_json.map((row: { data: Row }) => row.data));
        const problems = checked.filter((row) => row.errors.length || row.duplicate);
        if (problems.length) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "The source data changed after preview. No records were imported.", rows: problems }); }
        const inserted: string[] = [];
        for (const { data } of checked) {
          const id = safeUuid(data.id) ?? randomUUID();
          if (entity === "customers") await client.query(`INSERT INTO eventdesk_customers (id,department_id,kind,name,contact_person,email,phone,street,postal_code,city,country,notes,active)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [id,departmentId,data.kind || "company",data.name,data.contact_person ?? "",data.email ?? "",data.phone ?? "",data.street ?? "",data.postal_code ?? "",data.city ?? "",data.country ?? "",data.notes ?? "",isTrue(data.active)]);
          else if (entity === "equipment") {
            await client.query(`INSERT INTO eventdesk_assets (id,department_id,name,category,quantity,daily_rate_cents,active,notes,barcode,supplier_id)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [id,departmentId,data.name,data.category,Number(data.quantity),cents(data.daily_rate_cents),isTrue(data.active),data.notes ?? "",data.barcode ?? "",safeUuid(data.supplier_ref)]);
            let warehouse = await client.query("SELECT id FROM eventdesk_warehouses WHERE department_id=$1 AND is_default=true AND active=true LIMIT 1", [departmentId]);
            if (!warehouse.rowCount) {
              await client.query("UPDATE eventdesk_warehouses SET is_default=false WHERE department_id=$1 AND is_default AND NOT active", [departmentId]);
              const activeWarehouse = await client.query("SELECT id FROM eventdesk_warehouses WHERE department_id=$1 AND active=true ORDER BY name LIMIT 1", [departmentId]);
              if (activeWarehouse.rowCount) await client.query("UPDATE eventdesk_warehouses SET is_default=true,updated_at=now() WHERE department_id=$1 AND id=$2", [departmentId,activeWarehouse.rows[0].id]);
              else {
                const inactiveDefault = await client.query("UPDATE eventdesk_warehouses SET active=true,is_default=true,updated_at=now() WHERE department_id=$1 AND name='Main warehouse' RETURNING id", [departmentId]);
                if (!inactiveDefault.rowCount) await client.query("INSERT INTO eventdesk_warehouses (id,department_id,name,is_default) VALUES ($1,$2,'Main warehouse',true) ON CONFLICT (department_id,name) DO UPDATE SET active=true,is_default=true,updated_at=now()", [randomUUID(),departmentId]);
              }
              warehouse = await client.query("SELECT id FROM eventdesk_warehouses WHERE department_id=$1 AND is_default=true AND active=true LIMIT 1", [departmentId]);
            }
            if (!warehouse.rowCount) throw new Error("Create an active warehouse before importing equipment.");
            const defaultWarehouse = warehouse.rows[0].id;
            await client.query("INSERT INTO eventdesk_asset_warehouse_stock (department_id,asset_id,warehouse_id,quantity) VALUES ($1,$2,$3,$4)", [departmentId,id,defaultWarehouse,Number(data.quantity)]);
          } else if (entity === "suppliers" || entity === "venues") await client.query(`INSERT INTO eventdesk_partners (id,department_id,kind,name,contact_person,email,phone,street,postal_code,city,country,notes,active)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [id,departmentId,entity === "suppliers" ? "supplier" : "venue",data.name,data.contact_person ?? "",data.email ?? "",data.phone ?? "",data.street ?? "",data.postal_code ?? "",data.city ?? "",data.country ?? "",data.notes ?? "",isTrue(data.active)]);
          else if (entity === "freelancers") await client.query(`INSERT INTO eventdesk_freelancers (id,department_id,name,email,phone,roles,hourly_rate_cents,notes,active)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [id,departmentId,data.name,data.email ?? "",data.phone ?? "",(data.roles ?? "").split(/[;,]/).map((role) => role.trim()).filter(Boolean),cents(data.hourly_rate_cents),data.notes ?? "",isTrue(data.active)]);
          else {
            const customer = data.customer_ref ? await client.query("SELECT id,name FROM eventdesk_customers WHERE id=$1 AND department_id=$2", [data.customer_ref,departmentId]) : { rowCount: 0, rows: [] as any[] };
            const venue = data.venue_ref ? await client.query("SELECT id,name FROM eventdesk_partners WHERE id=$1 AND department_id=$2 AND kind='venue'", [data.venue_ref,departmentId]) : { rowCount: 0, rows: [] as any[] };
            await client.query(`INSERT INTO eventdesk_jobs (id,department_id,title,customer_name,customer_id,starts_at,ends_at,venue,venue_id,status,notes)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [id,departmentId,data.title,customer.rows[0]?.name ?? data.customer_name ?? "",customer.rows[0]?.id ?? null,new Date(data.starts_at).toISOString(),new Date(data.ends_at).toISOString(),venue.rows[0]?.name ?? data.venue ?? "",venue.rows[0]?.id ?? null,data.status || "lead",data.notes ?? ""]);
          }
          inserted.push(id);
        }
        await client.query("UPDATE eventdesk_import_previews SET committed_at=now() WHERE id=$1", [request.params.id]);
        await client.query("COMMIT");
        return reply.code(201).send({ entity, imported: inserted.length, ids: inserted });
      } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
    });

    routes.get<{ Querystring: { entity?: Entity } }>("/api/eventdesk/data/export", { schema: { querystring: { type: "object", additionalProperties: false, required: ["entity"], properties: { entity: { type: "string", enum: entities } } } } }, async (request, reply) => {
      const entity = request.query.entity!; const departmentId = await department(request, reply, permissions[entity]); if (!departmentId) return reply;
      let headers: string[]; let rows: unknown[][];
      if (entity === "customers") { headers = ["id","kind","name","contact_person","email","phone","street","postal_code","city","country","notes","active"]; rows = (await pool!.query("SELECT id,kind,name,contact_person,email,phone,street,postal_code,city,country,notes,active FROM eventdesk_customers WHERE department_id=$1 ORDER BY lower(name)",[departmentId])).rows.map((r) => headers.map((key) => r[key])); }
      else if (entity === "equipment") { headers = ["id","name","category","quantity","daily_rate_cents","active","notes","barcode","supplier_ref"]; rows = (await pool!.query("SELECT a.id,a.name,a.category,a.quantity,a.daily_rate_cents,a.active,a.notes,a.barcode,a.supplier_id AS supplier_ref FROM eventdesk_assets a WHERE a.department_id=$1 ORDER BY lower(a.name)",[departmentId])).rows.map((r) => headers.map((key) => r[key])); }
      else if (entity === "suppliers" || entity === "venues") { headers = ["id","name","contact_person","email","phone","street","postal_code","city","country","notes","active"]; rows = (await pool!.query("SELECT id,name,contact_person,email,phone,street,postal_code,city,country,notes,active FROM eventdesk_partners WHERE department_id=$1 AND kind=$2 ORDER BY lower(name)",[departmentId,entity === "suppliers" ? "supplier" : "venue"])).rows.map((r) => headers.map((key) => r[key])); }
      else if (entity === "freelancers") { headers = ["id","name","email","phone","roles","hourly_rate_cents","notes","active"]; rows = (await pool!.query("SELECT id,name,email,phone,array_to_string(roles,';') AS roles,hourly_rate_cents,notes,active FROM eventdesk_freelancers WHERE department_id=$1 ORDER BY lower(name)",[departmentId])).rows.map((r) => headers.map((key) => r[key])); }
      else { headers = ["id","title","customer_name","customer_ref","starts_at","ends_at","venue","venue_ref","status","notes"]; rows = (await pool!.query("SELECT j.id,j.title,j.customer_name,j.customer_id AS customer_ref,j.starts_at,j.ends_at,j.venue,j.venue_id AS venue_ref,j.status,j.notes FROM eventdesk_jobs j WHERE j.department_id=$1 ORDER BY j.starts_at",[departmentId])).rows.map((r) => headers.map((key) => r[key])); }
      return reply.type("text/csv; charset=utf-8").header("Content-Disposition", `attachment; filename=eventdesk-${entity}.csv`).send(csv(headers, rows));
    });

    routes.get<{ Querystring: { report?: string; from?: string; to?: string; status?: string; customerId?: string; assetId?: string } }>("/api/eventdesk/reports", { schema: { querystring: { type: "object", additionalProperties: false, required: ["report"], properties: { report: { type: "string", enum: ["utilisation","job_costs","availability","overdue_returns","maintenance","crew"] }, from: { type: "string", format: "date" }, to: { type: "string", format: "date" }, status: { type: "string", maxLength: 40 }, customerId: { type: "string", format: "uuid" }, assetId: { type: "string", format: "uuid" } } } } }, async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const grants = request.activeDepartmentModulePermissions?.eventdesk ?? [];
      const reportPermission: Record<string, string> = { utilisation: "inventory_manage", job_costs: "finance_manage", availability: "inventory_manage", overdue_returns: "inventory_manage", maintenance: "inventory_manage", crew: "crew_manage" };
      if (request.activeDepartmentRole !== "site_admin" && !grants.includes(reportPermission[request.query.report!])) return reply.code(403).send({ error: "Your EventDesk access level does not include this report." });
      const today = new Date().toISOString().slice(0, 10);
      const from = request.query.from || `${new Date().getUTCFullYear()}-01-01`; const to = request.query.to || today;
      if (from > to) return reply.code(400).send({ error: "The report start date must be before its end date." });
      const status = request.query.status || ""; const customerId = request.query.customerId || null; const assetId = request.query.assetId || null;
      let rows;
      switch (request.query.report) {
        case "utilisation": rows = (await pool!.query(`WITH date_window AS (SELECT $2::date AS starts_on,$3::date+1 AS ends_on),stock AS (
            SELECT s.department_id,s.asset_id,sum(s.quantity)::int AS quantity FROM eventdesk_asset_warehouse_stock s JOIN eventdesk_warehouses w ON w.id=s.warehouse_id AND w.department_id=s.department_id AND w.active WHERE s.department_id=$1 GROUP BY s.department_id,s.asset_id
          ),owned_bookings AS (SELECT b.department_id,b.asset_id,b.job_id,b.status,greatest(0,b.quantity-coalesce(x.quantity,0))::int AS quantity FROM eventdesk_job_assets b
            LEFT JOIN (SELECT department_id,job_asset_id,sum(quantity)::int AS quantity FROM eventdesk_subrental_allocations GROUP BY department_id,job_asset_id) x ON x.department_id=b.department_id AND x.job_asset_id=b.id)
          SELECT a.id AS asset_id,a.name AS equipment,a.category,coalesce(s.quantity,0)::int AS owned_quantity,
            coalesce(sum(b.quantity * greatest(0,extract(epoch FROM (least(j.ends_at,w.ends_on::timestamptz)-greatest(j.starts_at,w.starts_on::timestamptz)))/86400)),0)::numeric(14,2) AS booked_unit_days,
            CASE WHEN coalesce(s.quantity,0)=0 THEN 0 ELSE round(100*coalesce(sum(b.quantity * greatest(0,extract(epoch FROM (least(j.ends_at,w.ends_on::timestamptz)-greatest(j.starts_at,w.starts_on::timestamptz)))/86400)),0)/(s.quantity*(w.ends_on-w.starts_on)),1) END AS utilisation_percent
            FROM eventdesk_assets a CROSS JOIN date_window w LEFT JOIN stock s ON s.department_id=a.department_id AND s.asset_id=a.id
            LEFT JOIN owned_bookings b ON b.department_id=a.department_id AND b.asset_id=a.id AND b.status IN ('reserved','checked_out')
            LEFT JOIN eventdesk_jobs j ON j.id=b.job_id AND j.department_id=b.department_id AND j.status<> 'cancelled' AND j.starts_at<w.ends_on::timestamptz AND j.ends_at>w.starts_on::timestamptz
            WHERE a.department_id=$1 AND ($6::uuid IS NULL OR a.id=$6) AND ($4='' OR j.status=$4) AND ($5::uuid IS NULL OR j.customer_id=$5)
            GROUP BY a.id,a.name,a.category,s.quantity,w.starts_on,w.ends_on ORDER BY lower(a.name)`,[departmentId,from,to,status,customerId,assetId])).rows;
          break;
        case "job_costs": rows = (await pool!.query(`WITH bookings AS (SELECT b.department_id,b.job_id,sum(b.quantity*b.daily_rate_cents*greatest(1,ceil(extract(epoch FROM (j.ends_at-j.starts_at))/86400)))::bigint AS cents FROM eventdesk_job_assets b JOIN eventdesk_jobs j ON j.id=b.job_id AND j.department_id=b.department_id WHERE b.status<>'cancelled' GROUP BY b.department_id,b.job_id),
            crew AS (SELECT department_id,job_id,sum(hours*hourly_rate_cents)::bigint AS cents FROM eventdesk_job_crew WHERE status<>'declined' GROUP BY department_id,job_id),
            rentals AS (SELECT department_id,job_id,sum(quantity*daily_cost_cents*greatest(1,ceil(extract(epoch FROM (ends_at-starts_at))/86400))+supplier_charges_cents)::bigint AS cents FROM eventdesk_subrentals WHERE status<>'cancelled' GROUP BY department_id,job_id),
            purchases AS (SELECT o.department_id,o.job_id,sum((l.quantity_ordered-l.quantity_cancelled)*l.unit_cost_cents)::bigint AS cents FROM eventdesk_purchase_orders o JOIN eventdesk_purchase_order_lines l ON l.purchase_order_id=o.id AND l.department_id=o.department_id WHERE o.status NOT IN ('requested','cancelled') GROUP BY o.department_id,o.job_id),
            revenue AS (SELECT department_id,job_id,sum(CASE WHEN kind='credit_note' THEN -total_cents ELSE total_cents END)::bigint AS cents FROM eventdesk_documents WHERE kind IN ('invoice','deposit_invoice','credit_note') AND status NOT IN ('draft','cancelled') GROUP BY department_id,job_id)
            SELECT j.id AS job_id,j.title,j.customer_name,j.status,coalesce(r.cents,0)::bigint AS recognized_document_cents,
              (coalesce(b.cents,0)+coalesce(c.cents,0)+coalesce(sr.cents,0)+coalesce(p.cents,0))::bigint AS projected_cost_cents,
              (coalesce(r.cents,0)-coalesce(b.cents,0)-coalesce(c.cents,0)-coalesce(sr.cents,0)-coalesce(p.cents,0))::bigint AS projected_margin_cents
            FROM eventdesk_jobs j LEFT JOIN bookings b ON b.department_id=j.department_id AND b.job_id=j.id LEFT JOIN crew c ON c.department_id=j.department_id AND c.job_id=j.id
            LEFT JOIN rentals sr ON sr.department_id=j.department_id AND sr.job_id=j.id LEFT JOIN purchases p ON p.department_id=j.department_id AND p.job_id=j.id LEFT JOIN revenue r ON r.department_id=j.department_id AND r.job_id=j.id
            WHERE j.department_id=$1 AND j.starts_at<$3::date+interval '1 day' AND j.ends_at>=$2::date AND ($4='' OR j.status=$4) AND ($5::uuid IS NULL OR j.customer_id=$5)
              AND ($6::uuid IS NULL OR EXISTS (SELECT 1 FROM eventdesk_job_assets x WHERE x.department_id=j.department_id AND x.job_id=j.id AND x.asset_id=$6))
            ORDER BY j.starts_at`,[departmentId,from,to,status,customerId,assetId])).rows;
          break;
        case "availability": rows = (await pool!.query(`WITH net_bookings AS (SELECT b.department_id,b.asset_id,b.warehouse_id,b.job_id,b.status,greatest(0,b.quantity-coalesce(x.quantity,0))::int AS quantity FROM eventdesk_job_assets b
            LEFT JOIN (SELECT department_id,job_asset_id,sum(quantity)::int AS quantity FROM eventdesk_subrental_allocations GROUP BY department_id,job_asset_id) x ON x.department_id=b.department_id AND x.job_asset_id=b.id),
            reservations AS (SELECT b.department_id,b.asset_id,b.warehouse_id,sum(b.quantity)::int AS quantity FROM net_bookings b JOIN eventdesk_jobs j ON j.id=b.job_id AND j.department_id=b.department_id
            WHERE b.status IN ('reserved','checked_out') AND j.status NOT IN ('cancelled','completed') AND j.starts_at<$3::date+interval '1 day' AND j.ends_at>=$2::date AND ($4='' OR j.status=$4) AND ($5::uuid IS NULL OR j.customer_id=$5) GROUP BY b.department_id,b.asset_id,b.warehouse_id),
            maintenance AS (SELECT department_id,asset_id,sum(quantity)::int AS quantity FROM eventdesk_asset_maintenance WHERE status IN ('scheduled','in_progress') AND starts_at<$3::date+interval '1 day' AND ends_at>=$2::date GROUP BY department_id,asset_id),
            external AS (SELECT a.department_id,b.asset_id,b.warehouse_id,sum(a.quantity)::int AS quantity FROM eventdesk_subrental_allocations a JOIN eventdesk_job_assets b ON b.id=a.job_asset_id AND b.department_id=a.department_id AND b.status IN ('reserved','checked_out') JOIN eventdesk_jobs j ON j.id=b.job_id AND j.department_id=b.department_id
              WHERE a.department_id=$1 AND j.starts_at<$3::date+interval '1 day' AND j.ends_at>=$2::date AND j.status NOT IN ('cancelled','completed') AND ($4='' OR j.status=$4) AND ($5::uuid IS NULL OR j.customer_id=$5) GROUP BY a.department_id,b.asset_id,b.warehouse_id)
            SELECT a.id AS asset_id,a.name AS equipment,a.category,w.id AS warehouse_id,w.name AS warehouse,s.quantity AS stock_quantity,coalesce(r.quantity,0)::int AS reserved_quantity,
              CASE WHEN w.is_default THEN coalesce(m.quantity,0) ELSE 0 END AS maintenance_hold_quantity,CASE WHEN w.is_default THEN coalesce(e.quantity,0) ELSE 0 END AS external_reserved_quantity,
              greatest(0,s.quantity-coalesce(r.quantity,0)-CASE WHEN w.is_default THEN coalesce(m.quantity,0) ELSE 0 END)::int AS available_quantity
            FROM eventdesk_asset_warehouse_stock s JOIN eventdesk_assets a ON a.id=s.asset_id AND a.department_id=s.department_id JOIN eventdesk_warehouses w ON w.id=s.warehouse_id AND w.department_id=s.department_id
            LEFT JOIN reservations r ON r.department_id=s.department_id AND r.asset_id=s.asset_id AND r.warehouse_id=s.warehouse_id LEFT JOIN maintenance m ON m.department_id=s.department_id AND m.asset_id=s.asset_id LEFT JOIN external e ON e.department_id=s.department_id AND e.asset_id=s.asset_id AND e.warehouse_id=s.warehouse_id
            WHERE s.department_id=$1 AND w.active AND ($6::uuid IS NULL OR a.id=$6) ORDER BY lower(a.name),lower(w.name)`,[departmentId,from,to,status,customerId,assetId])).rows;
          break;
        case "overdue_returns": rows = (await pool!.query(`SELECT r.id,r.job_id,j.title AS job,r.supplier_id,s.name AS supplier,r.asset_id,a.name AS equipment,r.supplier_item,r.quantity,r.quantity_checked_out,r.quantity_returned,
            r.ends_at AS return_due_at,greatest(0,r.quantity_checked_out-r.quantity_returned)::int AS outstanding_quantity,r.supplier_charges_cents,r.status
            FROM eventdesk_subrentals r JOIN eventdesk_jobs j ON j.id=r.job_id AND j.department_id=r.department_id JOIN eventdesk_partners s ON s.id=r.supplier_id AND s.department_id=r.department_id JOIN eventdesk_assets a ON a.id=r.asset_id AND a.department_id=r.department_id
            WHERE r.department_id=$1 AND r.ends_at<now() AND r.ends_at<$3::date+interval '1 day' AND r.ends_at>=$2::date AND r.quantity_checked_out>r.quantity_returned AND r.status<>'cancelled' AND ($4='' OR r.status=$4) AND ($5::uuid IS NULL OR j.customer_id=$5) AND ($6::uuid IS NULL OR r.asset_id=$6) ORDER BY r.ends_at`,[departmentId,from,to,status,customerId,assetId])).rows;
          break;
        case "maintenance": rows = (await pool!.query(`SELECT m.id::text AS record_id,m.asset_id,a.name AS equipment,m.status,m.starts_at,m.ends_at,m.quantity,m.notes AS details,'maintenance' AS record_kind
            FROM eventdesk_asset_maintenance m JOIN eventdesk_assets a ON a.id=m.asset_id AND a.department_id=m.department_id
            WHERE m.department_id=$1 AND m.starts_at<$3::date+interval '1 day' AND m.ends_at>=$2::date AND ($4='' OR m.status=$4) AND ($6::uuid IS NULL OR m.asset_id=$6)
              AND ($5::uuid IS NULL OR EXISTS (SELECT 1 FROM eventdesk_job_assets b JOIN eventdesk_jobs j ON j.id=b.job_id AND j.department_id=b.department_id WHERE b.department_id=m.department_id AND b.asset_id=m.asset_id AND j.customer_id=$5 AND j.status NOT IN ('cancelled','completed') AND j.starts_at<m.ends_at AND j.ends_at>m.starts_at))
            UNION ALL
            SELECT t.id::text AS record_id,t.asset_id,a.name AS equipment,t.status,coalesce(t.due_date::timestamptz,t.opened_at) AS starts_at,coalesce(t.completed_at,t.updated_at) AS ends_at,
              CASE WHEN t.unit_id IS NULL THEN a.quantity ELSE 1 END AS quantity,concat_ws(' · ',t.title,nullif(t.fault,'')) AS details,t.kind AS record_kind
            FROM eventdesk_service_tickets t JOIN eventdesk_assets a ON a.id=t.asset_id AND a.department_id=t.department_id
            WHERE t.department_id=$1 AND t.opened_at<$3::date+interval '1 day' AND coalesce(t.completed_at,t.updated_at)>=$2::date AND ($4='' OR t.status=$4) AND ($6::uuid IS NULL OR t.asset_id=$6)
              AND ($5::uuid IS NULL OR EXISTS (SELECT 1 FROM eventdesk_job_assets b JOIN eventdesk_jobs j ON j.id=b.job_id AND j.department_id=b.department_id WHERE b.department_id=t.department_id AND b.asset_id=t.asset_id AND j.customer_id=$5 AND j.status NOT IN ('cancelled','completed') AND j.starts_at<coalesce(t.completed_at,t.updated_at) AND j.ends_at>coalesce(t.due_date::timestamptz,t.opened_at)))
            ORDER BY starts_at`,[departmentId,from,to,status,customerId,assetId])).rows;
          break;
        default: rows = (await pool!.query(`SELECT c.id AS crew_id,c.job_id,j.title AS job,c.role,c.status,c.freelancer_id,coalesce(f.name,trim(coalesce(p.first_name,'')||' '||coalesce(p.last_name,''))) AS person,j.starts_at,j.ends_at,j.customer_id
            FROM eventdesk_job_crew c JOIN eventdesk_jobs j ON j.id=c.job_id AND j.department_id=c.department_id LEFT JOIN eventdesk_freelancers f ON f.id=c.freelancer_id AND f.department_id=c.department_id LEFT JOIN contacts p ON p.id=c.contact_id AND p.department_id=c.department_id
            WHERE c.department_id=$1 AND j.status<>'cancelled' AND j.starts_at<$3::date+interval '1 day' AND j.ends_at>=$2::date AND ($4='' OR c.status=$4) AND ($5::uuid IS NULL OR j.customer_id=$5) AND ($6::uuid IS NULL OR EXISTS (SELECT 1 FROM eventdesk_job_assets x WHERE x.department_id=j.department_id AND x.job_id=j.id AND x.asset_id=$6)) ORDER BY j.starts_at,c.role`,[departmentId,from,to,status,customerId,assetId])).rows;
      }
      return { report: request.query.report, filters: { from, to, status, customerId, assetId }, rows };
    });
  });
}
