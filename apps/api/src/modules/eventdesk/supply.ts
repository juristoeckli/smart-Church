import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ModuleServerContext } from "../module-sdk.js";

const fileTypes = ["application/pdf", "image/jpeg", "image/png"] as const;
type FileType = typeof fileTypes[number];

export function registerEventDeskSupplyRoutes(app: FastifyInstance, context: ModuleServerContext) {
  const { pool, isDatabaseReady, resolveDepartmentId, validateMutation } = context;
  app.register(async (routes) => {
    async function department(request: FastifyRequest, reply: FastifyReply, permission: "view" | "inventory_manage" | "finance_manage" = "view") {
      if (!pool || !isDatabaseReady()) { reply.code(503).send({ error: "EventDesk is temporarily unavailable because its database is not ready." }); return null; }
      const id = await resolveDepartmentId(request, reply);
      if (!id) return null;
      const moduleState = await pool.query("SELECT enabled_modules FROM departments WHERE id=$1", [id]);
      if (!moduleState.rows[0]?.enabled_modules?.includes("eventdesk")) { reply.code(404).send({ error: "EventDesk is not enabled for this location." }); return null; }
      const grants = request.activeDepartmentModulePermissions?.eventdesk ?? [];
      const allowed = request.activeDepartmentRole === "site_admin" || grants.includes(permission)
        || (permission === "view" && grants.some((grant) => ["jobs_manage", "customers_manage", "inventory_manage", "crew_manage", "finance_manage", "partners_manage"].includes(grant)));
      if (!allowed) { reply.code(403).send({ error: "You do not have permission to manage EventDesk supply records." }); return null; }
      return id;
    }

    routes.get("/api/eventdesk/supply", async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const grants = request.activeDepartmentModulePermissions?.eventdesk ?? [];
      if (request.activeDepartmentRole !== "site_admin" && !grants.some((grant) => ["inventory_manage", "finance_manage"].includes(grant))) return reply.code(403).send({ error: "Supply costs require inventory or finance access." });
      const [orders, subrentals] = await Promise.all([
        pool!.query(`SELECT o.id,o.reference,o.supplier_id,s.name AS supplier_name,o.job_id,j.title AS job_title,o.status,o.expected_delivery_date,o.notes,o.created_at,o.approved_by,
            coalesce((SELECT jsonb_agg(jsonb_build_object('id',l.id,'assetId',l.asset_id,'description',l.description,'quantityOrdered',l.quantity_ordered,'quantityReceived',l.quantity_received,'quantityCancelled',l.quantity_cancelled,'unitCostCents',l.unit_cost_cents) ORDER BY l.created_at)
              FROM eventdesk_purchase_order_lines l WHERE l.purchase_order_id=o.id AND l.department_id=o.department_id),'[]'::jsonb) AS lines,
            coalesce((SELECT jsonb_agg(jsonb_build_object('id',d.id,'fileName',d.file_name,'mediaType',d.media_type,'createdAt',d.created_at) ORDER BY d.created_at DESC)
              FROM eventdesk_procurement_documents d WHERE d.purchase_order_id=o.id AND d.department_id=o.department_id),'[]'::jsonb) AS documents,
            coalesce((SELECT jsonb_agg(jsonb_build_object('fromStatus',h.from_status,'toStatus',h.to_status,'details',h.details,'changedBy',coalesce(u.display_name,''),'createdAt',h.created_at) ORDER BY h.created_at DESC)
              FROM eventdesk_supply_status_history h LEFT JOIN app_users u ON u.id=h.changed_by WHERE h.entity_kind='purchase_order' AND h.entity_id=o.id AND h.department_id=o.department_id),'[]'::jsonb) AS history
          FROM eventdesk_purchase_orders o JOIN eventdesk_partners s ON s.id=o.supplier_id AND s.department_id=o.department_id
          LEFT JOIN eventdesk_jobs j ON j.id=o.job_id AND j.department_id=o.department_id
          WHERE o.department_id=$1 ORDER BY o.created_at DESC`, [departmentId]),
        pool!.query(`SELECT r.id,r.job_id,j.title AS job_title,r.supplier_id,s.name AS supplier_name,r.asset_id,a.name AS asset_name,r.supplier_item,
            r.quantity,r.quantity_checked_out,r.quantity_returned,r.starts_at,r.ends_at,r.daily_cost_cents,r.supplier_charges_cents,r.status,r.return_notes,r.created_at,
            coalesce((SELECT jsonb_agg(jsonb_build_object('id',d.id,'fileName',d.file_name,'mediaType',d.media_type,'createdAt',d.created_at) ORDER BY d.created_at DESC)
              FROM eventdesk_procurement_documents d WHERE d.subrental_id=r.id AND d.department_id=r.department_id),'[]'::jsonb) AS documents,
            coalesce((SELECT jsonb_agg(jsonb_build_object('fromStatus',h.from_status,'toStatus',h.to_status,'details',h.details,'changedBy',coalesce(u.display_name,''),'createdAt',h.created_at) ORDER BY h.created_at DESC)
              FROM eventdesk_supply_status_history h LEFT JOIN app_users u ON u.id=h.changed_by WHERE h.entity_kind='subrental' AND h.entity_id=r.id AND h.department_id=r.department_id),'[]'::jsonb) AS history
          FROM eventdesk_subrentals r JOIN eventdesk_jobs j ON j.id=r.job_id AND j.department_id=r.department_id
          JOIN eventdesk_partners s ON s.id=r.supplier_id AND s.department_id=r.department_id
          JOIN eventdesk_assets a ON a.id=r.asset_id AND a.department_id=r.department_id
          WHERE r.department_id=$1 ORDER BY r.starts_at DESC,r.created_at DESC`, [departmentId]),
      ]);
      return {
        purchaseOrders: orders.rows.map((row) => ({ id: row.id, reference: row.reference, supplierId: row.supplier_id, supplierName: row.supplier_name, jobId: row.job_id, jobTitle: row.job_title, status: row.status, expectedDeliveryDate: row.expected_delivery_date, notes: row.notes, createdAt: row.created_at, approvedBy: row.approved_by, lines: row.lines, documents: row.documents, history: row.history })),
        subrentals: subrentals.rows.map((row) => ({ id: row.id, jobId: row.job_id, jobTitle: row.job_title, supplierId: row.supplier_id, supplierName: row.supplier_name, assetId: row.asset_id, assetName: row.asset_name, supplierItem: row.supplier_item, quantity: row.quantity, quantityCheckedOut: row.quantity_checked_out, quantityReturned: row.quantity_returned, startsAt: new Date(row.starts_at).toISOString(), endsAt: new Date(row.ends_at).toISOString(), dailyCostCents: row.daily_cost_cents, supplierChargesCents: row.supplier_charges_cents, status: row.status, returnNotes: row.return_notes, createdAt: row.created_at, documents: row.documents, history: row.history })),
      };
    });

    routes.post<{ Body: { supplierId: string; jobId?: string | null; expectedDeliveryDate?: string | null; notes?: string; lines: { assetId?: string | null; description: string; quantity: number; unitCostCents: number }[] } }>("/api/eventdesk/purchase-orders", {
      schema: { body: { type: "object", additionalProperties: false, required: ["supplierId", "lines"], properties: {
        supplierId: { type: "string", format: "uuid" }, jobId: { type: ["string", "null"], format: "uuid" }, expectedDeliveryDate: { type: ["string", "null"], format: "date" }, notes: { type: "string", maxLength: 2000 },
        lines: { type: "array", minItems: 1, maxItems: 100, items: { type: "object", additionalProperties: false, required: ["description", "quantity", "unitCostCents"], properties: { assetId: { type: ["string", "null"], format: "uuid" }, description: { type: "string", minLength: 1, maxLength: 240 }, quantity: { type: "integer", minimum: 1, maximum: 100000 }, unitCostCents: { type: "integer", minimum: 0, maximum: 1000000000 } } } },
      } } } }, async (request, reply) => {
        if (!validateMutation(request, reply)) return reply;
        const departmentId = await department(request, reply, "inventory_manage");
        if (!departmentId) return reply;
        const supplier = await pool!.query("SELECT id FROM eventdesk_partners WHERE id=$1 AND department_id=$2 AND kind='supplier' AND active=true", [request.body.supplierId, departmentId]);
        if (!supplier.rowCount) return reply.code(400).send({ error: "Choose an active supplier from this location." });
        if (request.body.jobId && !(await pool!.query("SELECT 1 FROM eventdesk_jobs WHERE id=$1 AND department_id=$2", [request.body.jobId, departmentId])).rowCount) return reply.code(400).send({ error: "Choose a job from this location." });
        const assetIds = [...new Set(request.body.lines.map((line) => line.assetId).filter((id): id is string => Boolean(id)))];
        if (assetIds.length && Number((await pool!.query("SELECT count(*)::int AS count FROM eventdesk_assets WHERE department_id=$1 AND id=ANY($2::uuid[])", [departmentId, assetIds])).rows[0].count) !== assetIds.length) return reply.code(400).send({ error: "Every catalog item must belong to this location." });
        const client = await pool!.connect();
        try {
          await client.query("BEGIN");
          const id = randomUUID();
          const reference = `PO-${id.slice(0, 8).toUpperCase()}`;
          await client.query("INSERT INTO eventdesk_purchase_orders (id,department_id,reference,supplier_id,job_id,expected_delivery_date,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [id, departmentId, reference, request.body.supplierId, request.body.jobId ?? null, request.body.expectedDeliveryDate ?? null, request.body.notes?.trim() ?? "", request.authenticatedUser?.id ?? null]);
          for (const line of request.body.lines) await client.query("INSERT INTO eventdesk_purchase_order_lines (id,department_id,purchase_order_id,asset_id,description,quantity_ordered,unit_cost_cents) VALUES ($1,$2,$3,$4,$5,$6,$7)", [randomUUID(), departmentId, id, line.assetId ?? null, line.description.trim(), line.quantity, line.unitCostCents]);
          await client.query("INSERT INTO eventdesk_supply_status_history (id,department_id,entity_kind,entity_id,to_status,details,changed_by) VALUES ($1,$2,'purchase_order',$3,'requested','Purchase request created.',$4)", [randomUUID(), departmentId, id, request.authenticatedUser?.id ?? null]);
          await client.query("COMMIT");
          return reply.code(201).send({ id, reference, status: "requested" });
        } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
      });

    routes.put<{ Params: { id: string }; Body: { status: "approved" | "ordered" | "cancelled"; details?: string } }>("/api/eventdesk/purchase-orders/:id/status", {
      schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } }, body: { type: "object", additionalProperties: false, required: ["status"], properties: { status: { type: "string", enum: ["approved", "ordered", "cancelled"] }, details: { type: "string", maxLength: 1000 } } } } }, async (request, reply) => {
        if (!validateMutation(request, reply)) return reply;
        const permission = request.body.status === "approved" ? "finance_manage" : "inventory_manage";
        const departmentId = await department(request, reply, permission);
        if (!departmentId) return reply;
        const client = await pool!.connect();
        try {
          await client.query("BEGIN");
          const order = await client.query("SELECT status FROM eventdesk_purchase_orders WHERE id=$1 AND department_id=$2 FOR UPDATE", [request.params.id, departmentId]);
          if (!order.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Purchase order not found." }); }
          const from = order.rows[0].status;
          const allowed = request.body.status === "approved" ? from === "requested" : request.body.status === "ordered" ? from === "approved" : !["received", "cancelled"].includes(from);
          if (!allowed) { await client.query("ROLLBACK"); return reply.code(409).send({ error: `A ${from} order cannot move to ${request.body.status}.` }); }
          if (request.body.status === "cancelled") await client.query("UPDATE eventdesk_purchase_order_lines SET quantity_cancelled=quantity_ordered-quantity_received WHERE purchase_order_id=$1 AND department_id=$2", [request.params.id, departmentId]);
          await client.query("UPDATE eventdesk_purchase_orders SET status=$3,approved_by=CASE WHEN $3='approved' THEN $4 ELSE approved_by END,updated_at=now() WHERE id=$1 AND department_id=$2", [request.params.id, departmentId, request.body.status, request.authenticatedUser?.id ?? null]);
          await client.query("INSERT INTO eventdesk_supply_status_history (id,department_id,entity_kind,entity_id,from_status,to_status,details,changed_by) VALUES ($1,$2,'purchase_order',$3,$4,$5,$6,$7)", [randomUUID(), departmentId, request.params.id, from, request.body.status, request.body.details?.trim() ?? "", request.authenticatedUser?.id ?? null]);
          await client.query("COMMIT");
          return { id: request.params.id, status: request.body.status };
        } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
      });

    routes.post<{ Params: { id: string; lineId: string }; Body: { quantity: number; notes?: string } }>("/api/eventdesk/purchase-orders/:id/lines/:lineId/receive", {
      schema: { params: { type: "object", required: ["id", "lineId"], properties: { id: { type: "string", format: "uuid" }, lineId: { type: "string", format: "uuid" } } }, body: { type: "object", additionalProperties: false, required: ["quantity"], properties: { quantity: { type: "integer", minimum: 1, maximum: 100000 }, notes: { type: "string", maxLength: 1000 } } } } }, async (request, reply) => {
        if (!validateMutation(request, reply)) return reply;
        const departmentId = await department(request, reply, "inventory_manage");
        if (!departmentId) return reply;
        const client = await pool!.connect();
        try {
          await client.query("BEGIN");
          const order = await client.query("SELECT status FROM eventdesk_purchase_orders WHERE id=$1 AND department_id=$2 FOR UPDATE", [request.params.id, departmentId]);
          if (!order.rowCount || !["ordered", "partially_received"].includes(order.rows[0].status)) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "Mark the approved purchase as ordered before receiving it." }); }
          const line = await client.query("SELECT asset_id,description,quantity_ordered,quantity_received,quantity_cancelled FROM eventdesk_purchase_order_lines WHERE id=$1 AND purchase_order_id=$2 AND department_id=$3 FOR UPDATE", [request.params.lineId, request.params.id, departmentId]);
          if (!line.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Purchase line not found." }); }
          const remaining = Number(line.rows[0].quantity_ordered) - Number(line.rows[0].quantity_received) - Number(line.rows[0].quantity_cancelled);
          if (request.body.quantity > remaining) { await client.query("ROLLBACK"); return reply.code(400).send({ error: `Only ${remaining} unit(s) remain outstanding.` }); }
          await client.query("UPDATE eventdesk_purchase_order_lines SET quantity_received=quantity_received+$3 WHERE id=$1 AND department_id=$2", [request.params.lineId, departmentId, request.body.quantity]);
          if (line.rows[0].asset_id) {
            await client.query("UPDATE eventdesk_assets SET quantity=quantity+$3,updated_at=now() WHERE id=$1 AND department_id=$2", [line.rows[0].asset_id, departmentId, request.body.quantity]);
            let warehouse = await client.query("SELECT id FROM eventdesk_warehouses WHERE department_id=$1 AND is_default=true ORDER BY created_at LIMIT 1 FOR UPDATE", [departmentId]);
            if (!warehouse.rowCount) {
              const id = randomUUID();
              warehouse = await client.query("INSERT INTO eventdesk_warehouses (id,department_id,name,is_default) VALUES ($1,$2,'Main warehouse',true) RETURNING id", [id, departmentId]);
            }
            await client.query(`INSERT INTO eventdesk_asset_warehouse_stock (id,department_id,asset_id,warehouse_id,quantity)
              VALUES ($1,$2,$3,$4,$5) ON CONFLICT (department_id,asset_id,warehouse_id) DO UPDATE SET quantity=eventdesk_asset_warehouse_stock.quantity+EXCLUDED.quantity,updated_at=now()`, [randomUUID(), departmentId, line.rows[0].asset_id, warehouse.rows[0].id, request.body.quantity]);
          }
          const lines = await client.query("SELECT bool_and(quantity_received+quantity_cancelled>=quantity_ordered) AS complete,bool_or(quantity_received>0) AS received FROM eventdesk_purchase_order_lines WHERE purchase_order_id=$1 AND department_id=$2", [request.params.id, departmentId]);
          const nextStatus = lines.rows[0].complete ? (lines.rows[0].received ? "received" : "cancelled") : lines.rows[0].received ? "partially_received" : order.rows[0].status;
          await client.query("UPDATE eventdesk_purchase_orders SET status=$3,updated_at=now() WHERE id=$1 AND department_id=$2", [request.params.id, departmentId, nextStatus]);
          await client.query("INSERT INTO eventdesk_supply_status_history (id,department_id,entity_kind,entity_id,from_status,to_status,details,changed_by) VALUES ($1,$2,'purchase_order',$3,$4,$5,$6,$7)", [randomUUID(), departmentId, request.params.id, order.rows[0].status, nextStatus, `Received ${request.body.quantity} × ${line.rows[0].description}${request.body.notes ? `: ${request.body.notes.trim()}` : ""}`, request.authenticatedUser?.id ?? null]);
          await client.query("COMMIT");
          return { id: request.params.lineId, received: Number(line.rows[0].quantity_received) + request.body.quantity, status: nextStatus };
        } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
      });

    routes.post<{ Body: { jobId: string; supplierId: string; assetId: string; supplierItem: string; quantity: number; startsAt: string; endsAt: string; dailyCostCents: number; notes?: string } }>("/api/eventdesk/subrentals", {
      schema: { body: { type: "object", additionalProperties: false, required: ["jobId", "supplierId", "assetId", "supplierItem", "quantity", "startsAt", "endsAt", "dailyCostCents"], properties: {
        jobId: { type: "string", format: "uuid" }, supplierId: { type: "string", format: "uuid" }, assetId: { type: "string", format: "uuid" }, supplierItem: { type: "string", minLength: 1, maxLength: 240 }, quantity: { type: "integer", minimum: 1, maximum: 100000 }, startsAt: { type: "string", format: "date-time" }, endsAt: { type: "string", format: "date-time" }, dailyCostCents: { type: "integer", minimum: 0, maximum: 1000000000 }, notes: { type: "string", maxLength: 2000 },
      } } } }, async (request, reply) => {
        if (!validateMutation(request, reply)) return reply;
        const departmentId = await department(request, reply, "inventory_manage");
        if (!departmentId) return reply;
        const client = await pool!.connect();
        try {
          await client.query("BEGIN");
          const job = await client.query("SELECT starts_at,ends_at,status FROM eventdesk_jobs WHERE id=$1 AND department_id=$2 FOR SHARE", [request.body.jobId, departmentId]);
          if (!job.rowCount || ["completed", "cancelled"].includes(job.rows[0].status)) { await client.query("ROLLBACK"); return reply.code(400).send({ error: "Choose an active job from this location." }); }
          if (new Date(request.body.startsAt) > new Date(job.rows[0].starts_at) || new Date(request.body.endsAt) < new Date(job.rows[0].ends_at) || new Date(request.body.endsAt) <= new Date(request.body.startsAt)) { await client.query("ROLLBACK"); return reply.code(400).send({ error: "Sub-rental dates must cover the full job schedule." }); }
          if (!(await client.query("SELECT 1 FROM eventdesk_partners WHERE id=$1 AND department_id=$2 AND kind='supplier' AND active=true", [request.body.supplierId, departmentId])).rowCount) { await client.query("ROLLBACK"); return reply.code(400).send({ error: "Choose an active supplier from this location." }); }
          if (!(await client.query("SELECT 1 FROM eventdesk_assets WHERE id=$1 AND department_id=$2 AND active=true", [request.body.assetId, departmentId])).rowCount) { await client.query("ROLLBACK"); return reply.code(400).send({ error: "Choose active catalog equipment from this location to cover." }); }
          const id = randomUUID();
          await client.query("INSERT INTO eventdesk_subrentals (id,department_id,job_id,supplier_id,asset_id,supplier_item,quantity,starts_at,ends_at,daily_cost_cents,return_notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)", [id, departmentId, request.body.jobId, request.body.supplierId, request.body.assetId, request.body.supplierItem.trim(), request.body.quantity, request.body.startsAt, request.body.endsAt, request.body.dailyCostCents, request.body.notes?.trim() ?? "", request.authenticatedUser?.id ?? null]);
          await client.query("INSERT INTO eventdesk_supply_status_history (id,department_id,entity_kind,entity_id,to_status,details,changed_by) VALUES ($1,$2,'subrental',$3,'reserved','External equipment reserved for a job.',$4)", [randomUUID(), departmentId, id, request.authenticatedUser?.id ?? null]);
          await client.query("COMMIT");
          return reply.code(201).send({ id, status: "reserved" });
        } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
      });

    routes.post<{ Params: { id: string }; Body: { quantity: number; notes?: string } }>("/api/eventdesk/subrentals/:id/dispatch", {
      schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } }, body: { type: "object", additionalProperties: false, required: ["quantity"], properties: { quantity: { type: "integer", minimum: 1, maximum: 100000 }, notes: { type: "string", maxLength: 1000 } } } } }, async (request, reply) => {
        if (!validateMutation(request, reply)) return reply;
        const departmentId = await department(request, reply, "inventory_manage");
        if (!departmentId) return reply;
        const client = await pool!.connect();
        try {
          await client.query("BEGIN");
          const rental = await client.query("SELECT status,quantity,quantity_checked_out,quantity_returned FROM eventdesk_subrentals WHERE id=$1 AND department_id=$2 FOR UPDATE", [request.params.id, departmentId]);
          if (!rental.rowCount || !["reserved", "checked_out", "partially_returned"].includes(rental.rows[0].status)) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "This sub-rental cannot be dispatched." }); }
          const remaining = Number(rental.rows[0].quantity) - Number(rental.rows[0].quantity_checked_out);
          if (request.body.quantity > remaining) { await client.query("ROLLBACK"); return reply.code(400).send({ error: `Only ${remaining} unit(s) are still reserved.` }); }
          const status = "checked_out";
          await client.query("UPDATE eventdesk_subrentals SET quantity_checked_out=quantity_checked_out+$3,status=$4,updated_at=now() WHERE id=$1 AND department_id=$2", [request.params.id, departmentId, request.body.quantity, status]);
          await client.query("INSERT INTO eventdesk_supply_status_history (id,department_id,entity_kind,entity_id,from_status,to_status,details,changed_by) VALUES ($1,$2,'subrental',$3,$4,$5,$6,$7)", [randomUUID(), departmentId, request.params.id, rental.rows[0].status, status, `Supplier dispatched ${request.body.quantity} unit(s).${request.body.notes ? ` ${request.body.notes.trim()}` : ""}`, request.authenticatedUser?.id ?? null]);
          await client.query("COMMIT");
          return { id: request.params.id, status, quantityCheckedOut: Number(rental.rows[0].quantity_checked_out) + request.body.quantity };
        } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
      });

    routes.post<{ Params: { id: string }; Body: { quantity: number; supplierChargesCents?: number; notes?: string } }>("/api/eventdesk/subrentals/:id/return", {
      schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } }, body: { type: "object", additionalProperties: false, required: ["quantity"], properties: { quantity: { type: "integer", minimum: 1, maximum: 100000 }, supplierChargesCents: { type: "integer", minimum: 0, maximum: 1000000000 }, notes: { type: "string", maxLength: 1000 } } } } }, async (request, reply) => {
        if (!validateMutation(request, reply)) return reply;
        const departmentId = await department(request, reply, "inventory_manage");
        if (!departmentId) return reply;
        const client = await pool!.connect();
        try {
          await client.query("BEGIN");
          const rental = await client.query("SELECT r.status,r.quantity,r.quantity_checked_out,r.quantity_returned,r.supplier_charges_cents,j.ends_at AS job_ends_at FROM eventdesk_subrentals r JOIN eventdesk_jobs j ON j.id=r.job_id AND j.department_id=r.department_id WHERE r.id=$1 AND r.department_id=$2 FOR UPDATE OF r", [request.params.id, departmentId]);
          if (!rental.rowCount || !["checked_out", "partially_returned"].includes(rental.rows[0].status)) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "No dispatched equipment is waiting to be returned." }); }
          const outstanding = Number(rental.rows[0].quantity_checked_out) - Number(rental.rows[0].quantity_returned);
          if (request.body.quantity > outstanding) { await client.query("ROLLBACK"); return reply.code(400).send({ error: `Only ${outstanding} dispatched unit(s) remain unreturned.` }); }
          const returned = Number(rental.rows[0].quantity_returned) + request.body.quantity;
          const allocated = await client.query(`SELECT coalesce(sum(a.quantity),0)::int AS quantity FROM eventdesk_subrental_allocations a
            JOIN eventdesk_job_assets b ON b.id=a.job_asset_id AND b.department_id=a.department_id AND b.status IN ('reserved','checked_out')
            WHERE a.department_id=$1 AND a.subrental_id=$2`, [departmentId, request.params.id]);
          if (new Date(rental.rows[0].job_ends_at) > new Date() && Number(rental.rows[0].quantity) - returned < Number(allocated.rows[0].quantity)) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "This equipment is still allocated to an active job booking and cannot be returned yet." }); }
          const status = returned >= Number(rental.rows[0].quantity) ? "returned" : returned >= Number(rental.rows[0].quantity_checked_out) ? "reserved" : "partially_returned";
          const charge = request.body.supplierChargesCents ?? 0;
          await client.query("UPDATE eventdesk_subrentals SET quantity_returned=$3,status=$4,supplier_charges_cents=supplier_charges_cents+$5,return_notes=concat_ws(E'\\n',nullif(return_notes,''),nullif($6,'')),updated_at=now() WHERE id=$1 AND department_id=$2", [request.params.id, departmentId, returned, status, charge, request.body.notes?.trim() ?? ""]);
          await client.query("INSERT INTO eventdesk_supply_status_history (id,department_id,entity_kind,entity_id,from_status,to_status,details,changed_by) VALUES ($1,$2,'subrental',$3,$4,$5,$6,$7)", [randomUUID(), departmentId, request.params.id, rental.rows[0].status, status, `Supplier return: ${request.body.quantity} unit(s), ${charge} cents in additional charges.${request.body.notes ? ` ${request.body.notes.trim()}` : ""}`, request.authenticatedUser?.id ?? null]);
          await client.query("COMMIT");
          return { id: request.params.id, status, quantityReturned: returned };
        } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
      });

    routes.put<{ Params: { id: string }; Body: { status: "cancelled" } }>("/api/eventdesk/subrentals/:id/status", {
      schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } }, body: { type: "object", additionalProperties: false, required: ["status"], properties: { status: { type: "string", enum: ["cancelled"] } } } } }, async (request, reply) => {
        if (!validateMutation(request, reply)) return reply;
        const departmentId = await department(request, reply, "inventory_manage");
        if (!departmentId) return reply;
        const client = await pool!.connect();
        try {
          await client.query("BEGIN");
          const rental = await client.query("SELECT status,quantity_checked_out FROM eventdesk_subrentals WHERE id=$1 AND department_id=$2 FOR UPDATE", [request.params.id, departmentId]);
          if (!rental.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Sub-rental not found." }); }
          if (rental.rows[0].status !== "reserved" || Number(rental.rows[0].quantity_checked_out) > 0) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "Only an undispatched reservation can be cancelled." }); }
          const allocated = await client.query("SELECT coalesce(sum(quantity),0)::int AS quantity FROM eventdesk_subrental_allocations WHERE department_id=$1 AND subrental_id=$2", [departmentId, request.params.id]);
          if (Number(allocated.rows[0].quantity) > 0) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "Cancel or update the associated job equipment booking before cancelling this allocated sub-rental." }); }
          await client.query("UPDATE eventdesk_subrentals SET status='cancelled',updated_at=now() WHERE id=$1 AND department_id=$2", [request.params.id, departmentId]);
          await client.query("INSERT INTO eventdesk_supply_status_history (id,department_id,entity_kind,entity_id,from_status,to_status,details,changed_by) VALUES ($1,$2,'subrental',$3,$4,'cancelled','Reservation cancelled.',$5)", [randomUUID(), departmentId, request.params.id, rental.rows[0].status, request.authenticatedUser?.id ?? null]);
          await client.query("COMMIT");
          return { id: request.params.id, status: "cancelled" };
        } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
      });

    routes.post<{ Body: { purchaseOrderId?: string; subrentalId?: string; fileName: string; mediaType: FileType; base64: string } }>("/api/eventdesk/supply-documents", {
      schema: { body: { type: "object", additionalProperties: false, required: ["fileName", "mediaType", "base64"], properties: { purchaseOrderId: { type: "string", format: "uuid" }, subrentalId: { type: "string", format: "uuid" }, fileName: { type: "string", minLength: 1, maxLength: 240 }, mediaType: { type: "string", enum: [...fileTypes] }, base64: { type: "string", minLength: 1, maxLength: 2800000 } } } } }, async (request, reply) => {
        if (!validateMutation(request, reply)) return reply;
        const departmentId = await department(request, reply, "inventory_manage");
        if (!departmentId) return reply;
        if (Boolean(request.body.purchaseOrderId) === Boolean(request.body.subrentalId)) return reply.code(400).send({ error: "Attach the document to exactly one purchase order or sub-rental." });
        const data = Buffer.from(request.body.base64, "base64");
        const validSignature = request.body.mediaType === "application/pdf" ? data.subarray(0, 5).toString("ascii") === "%PDF-" : request.body.mediaType === "image/jpeg" ? data[0] === 0xff && data[1] === 0xd8 : data.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
        if (data.length === 0 || data.length > 2 * 1024 * 1024 || !validSignature) return reply.code(400).send({ error: "Choose a valid PDF, JPEG, or PNG file no larger than 2 MiB." });
        if (request.body.purchaseOrderId && !(await pool!.query("SELECT 1 FROM eventdesk_purchase_orders WHERE id=$1 AND department_id=$2", [request.body.purchaseOrderId, departmentId])).rowCount) return reply.code(404).send({ error: "Purchase order not found." });
        if (request.body.subrentalId && !(await pool!.query("SELECT 1 FROM eventdesk_subrentals WHERE id=$1 AND department_id=$2", [request.body.subrentalId, departmentId])).rowCount) return reply.code(404).send({ error: "Sub-rental not found." });
        const id = randomUUID();
        await pool!.query("INSERT INTO eventdesk_procurement_documents (id,department_id,purchase_order_id,subrental_id,file_name,media_type,file_data,uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [id, departmentId, request.body.purchaseOrderId ?? null, request.body.subrentalId ?? null, request.body.fileName.trim(), request.body.mediaType, data, request.authenticatedUser?.id ?? null]);
        return reply.code(201).send({ id });
      });

    routes.get<{ Params: { id: string } }>("/api/eventdesk/supply-documents/:id", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } } }, async (request, reply) => {
      const departmentId = await department(request, reply, "inventory_manage");
      if (!departmentId) return reply;
      const document = await pool!.query("SELECT file_name,media_type,file_data FROM eventdesk_procurement_documents WHERE id=$1 AND department_id=$2", [request.params.id, departmentId]);
      if (!document.rowCount) return reply.code(404).send({ error: "Supply document not found." });
      return reply.type(document.rows[0].media_type).header("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(document.rows[0].file_name)}`).send(document.rows[0].file_data);
    });
  });
}

