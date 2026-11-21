import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";

const widgets = ["stats", "events", "birthdays", "anniversaries", "groupAppointments", "currentBookings", "resourceApprovals", "recentEventFacts", "dutyRequests"] as const;
type Widget = typeof widgets[number];
type Layout = { order: Widget[]; visible: Widget[] };
type StoredLayout = { widget_order: unknown; visible_widgets: unknown };
const builtIn: Layout = { order: [...widgets], visible: [...widgets] };
const schema = { body: { type: "object", additionalProperties: false, required: ["order", "visible"], properties: {
  order: { type: "array", minItems: widgets.length, maxItems: widgets.length, uniqueItems: true, items: { type: "string", enum: widgets } },
  visible: { type: "array", maxItems: widgets.length, uniqueItems: true, items: { type: "string", enum: widgets } },
} } } as const;

function knownWidgets(input: unknown): Widget[] {
  return Array.isArray(input) ? input.filter((entry): entry is Widget => widgets.includes(entry)) : [];
}

function normalizeLayout(row: StoredLayout | null, fallback: Layout): Layout {
  if (!row) return fallback;
  const order = knownWidgets(row.widget_order);
  const visible = knownWidgets(row.visible_widgets);
  const missing = fallback.order.filter((widget) => !order.includes(widget));
  return {
    order: [...new Set([...order, ...missing])],
    visible: [...new Set([...visible, ...missing.filter((widget) => fallback.visible.includes(widget))])],
  };
}

async function readLayout(client: Pick<PoolClient, "query">, departmentId: string, userId: string) {
  const { rows: [row] } = await client.query<{ personal: StoredLayout | null; location: StoredLayout | null }>(
    `SELECT (SELECT jsonb_build_object('widget_order',widget_order,'visible_widgets',visible_widgets)
               FROM overview_widget_preferences WHERE department_id=$1 AND user_id=$2) AS personal,
            (SELECT jsonb_build_object('widget_order',widget_order,'visible_widgets',visible_widgets)
               FROM overview_location_layouts WHERE department_id=$1) AS location`,
    [departmentId, userId],
  );
  const locationDefault = normalizeLayout(row.location, builtIn);
  return { ...normalizeLayout(row.personal, locationDefault), source: row.personal ? "personal" : "location", locationDefault };
}

export function registerHomeLayout(app: FastifyInstance, dependencies: {
  getPool: () => Pool;
  department: (request: FastifyRequest, reply: FastifyReply) => Promise<string | null>;
  validateMutation: (request: FastifyRequest, reply: FastifyReply) => boolean;
  lockDepartmentForWrite: (client: PoolClient, departmentId: string) => Promise<boolean>;
}) {
  const path = "/api/modules/notifications/home-widgets";
  app.get(path, async (request, reply) => {
    const departmentId = await dependencies.department(request, reply);
    if (!departmentId) return reply;
    const layout = await readLayout(dependencies.getPool(), departmentId, request.authenticatedUser!.id);
    return reply.header("Cache-Control", "private, no-store").send(layout);
  });

  async function update(request: FastifyRequest, reply: FastifyReply, siteDefault: boolean, layout: Layout | null) {
    if (!dependencies.validateMutation(request, reply)) return reply;
    const departmentId = await dependencies.department(request, reply);
    if (!departmentId) return reply;
    const userId = request.authenticatedUser!.id;
    if (siteDefault && (request.activeDepartmentRole !== "site_admin" || request.headers.authorization)) {
      return reply.code(403).send({ error: "A site administrator browser session is required to edit the default layout." });
    }
    const client = await dependencies.getPool().connect();
    try {
      await client.query("BEGIN");
      if (!await dependencies.lockDepartmentForWrite(client, departmentId)) {
        await client.query("ROLLBACK");
        return reply.code(423).send({ error: "This location is read-only." });
      }
      const membership = await client.query(
        `SELECT m.user_id FROM department_memberships m JOIN app_users account ON account.id=m.user_id
          WHERE m.department_id=$1 AND m.user_id=$2 AND (NOT $3::boolean OR m.role='site_admin')
            AND account.is_enabled AND NOT account.is_service_user AND NOT (account.must_change_password AND account.can_change_password)
          FOR SHARE OF m,account`,
        [departmentId, userId, siteDefault],
      );
      if (!membership.rowCount) {
        await client.query("ROLLBACK");
        return reply.code(403).send({ error: "Your access to edit this layout has changed." });
      }
      if (siteDefault) {
        if (layout) await client.query(
          `INSERT INTO overview_location_layouts(department_id,widget_order,visible_widgets) VALUES($1,$2::jsonb,$3::jsonb)
           ON CONFLICT(department_id) DO UPDATE SET widget_order=EXCLUDED.widget_order,visible_widgets=EXCLUDED.visible_widgets`,
          [departmentId, JSON.stringify(layout.order), JSON.stringify(layout.visible)],
        );
        else await client.query("DELETE FROM overview_location_layouts WHERE department_id=$1", [departmentId]);
      } else if (layout) await client.query(
        `INSERT INTO overview_widget_preferences(department_id,user_id,widget_order,visible_widgets)
         VALUES($1,$2,$3::jsonb,$4::jsonb)
         ON CONFLICT(department_id,user_id) DO UPDATE SET widget_order=EXCLUDED.widget_order,visible_widgets=EXCLUDED.visible_widgets,updated_at=now()`,
        [departmentId, userId, JSON.stringify(layout.order), JSON.stringify(layout.visible)],
      );
      else await client.query("DELETE FROM overview_widget_preferences WHERE department_id=$1 AND user_id=$2", [departmentId, userId]);

      const result = await readLayout(client, departmentId, userId);
      await client.query("COMMIT");
      return reply.header("Cache-Control", "private, no-store").send(result);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  app.put<{ Body: Layout }>(path, { schema }, (request, reply) => update(request, reply, false, request.body));
  app.delete(path, (request, reply) => update(request, reply, false, null));
  app.put<{ Body: Layout }>(`${path}/defaults`, { schema }, (request, reply) => update(request, reply, true, request.body));
  app.delete(`${path}/defaults`, (request, reply) => update(request, reply, true, null));
}
