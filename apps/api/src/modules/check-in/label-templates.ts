import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { checkInLabelTemplateKeys, defaultCheckInLabelTemplates, validCheckInLabelTemplate,
  type CheckInLabelTemplates, type CheckInLabelTemplateSettings } from "@smart-church/contracts";
import type { ModuleServerContext } from "../module-sdk.js";

const url = "/api/modules/check-in/label-templates";
type TemplateRow = CheckInLabelTemplates & { revision: number };
type Update = CheckInLabelTemplateSettings;

function response(row?: TemplateRow): CheckInLabelTemplateSettings {
  return row ? { revision: row.revision, templates: { individual: row.individual, child: row.child, parent: row.parent } }
    : { revision: 0, templates: defaultCheckInLabelTemplates };
}

export function registerCheckInLabelTemplates(app: FastifyInstance, context: ModuleServerContext) {
  const { pool, isDatabaseReady, resolveDepartmentId, validateMutation, realtime } = context;

  async function scope(request: FastifyRequest, reply: FastifyReply, write = false) {
    reply.header("Cache-Control", "private, no-store");
    if (!pool || !isDatabaseReady()) {
      reply.code(503).send({ error: "Check-in templates are unavailable while the database is offline." });
      return null;
    }
    const departmentId = await resolveDepartmentId(request, reply, write);
    if (!departmentId) return null;
    const grants = request.activeDepartmentModulePermissions?.["check-in"] ?? [];
    const permissions = request.activeDepartmentPermissions ?? [];
    const canRead = request.activeDepartmentRole === "site_admin" ||
      grants.some(grant => grant === "view" || grant === "manage") ||
      permissions.some(permission => permission === "events_manage" || permission === "groups_manage");
    if (!canRead) {
      reply.code(403).send({ error: "Check-in access is required." });
      return null;
    }
    if (write && !validateMutation(request, reply)) return null;
    return departmentId;
  }

  app.get(url, async (request, reply) => {
    const departmentId = await scope(request, reply);
    if (!departmentId) return reply;
    const { rows: [row] } = await pool!.query<TemplateRow>(
      "SELECT revision,individual,child,parent FROM check_in_label_templates WHERE department_id=$1", [departmentId],
    );
    return response(row);
  });

  const templateString = { type: "string", maxLength: 480 } as const;
  app.put<{ Body: Update }>(url, { schema: {
    body: { type: "object", additionalProperties: false, required: ["revision", "templates"], properties: {
      revision: { type: "integer", minimum: 0, maximum: 2147483646 },
      templates: {
        type: "object", additionalProperties: false, required: checkInLabelTemplateKeys,
        properties: { individual: templateString, child: templateString, parent: templateString },
      },
    } },
  } }, async (request, reply) => {
    const departmentId = await scope(request, reply, true);
    if (!departmentId) return reply;
    const { revision, templates } = request.body;
    if (checkInLabelTemplateKeys.some(key => !validCheckInLabelTemplate(templates[key]))) {
      return reply.code(400).send({ error: "Use the listed placeholders and up to six lines and 480 characters per template." });
    }
    const values = [departmentId, templates.individual.trim(), templates.child.trim(), templates.parent.trim()];
    const client = await pool!.connect();
    let row: TemplateRow | undefined;
    try {
      await client.query("BEGIN");
      if (!await context.lockDepartmentForWrite(client, departmentId)) {
        return reply.code(423).send({ error: "This location is read-only." });
      }
      const result = revision === 0
        ? await client.query<TemplateRow>(
          `INSERT INTO check_in_label_templates(department_id,revision,individual,child,parent)
            VALUES($1,1,$2,$3,$4) ON CONFLICT(department_id) DO NOTHING RETURNING revision,individual,child,parent`, values,
        )
        : await client.query<TemplateRow>(
          `UPDATE check_in_label_templates SET revision=revision+1,individual=$2,child=$3,parent=$4
            WHERE department_id=$1 AND revision=$5
            RETURNING revision,individual,child,parent`, [...values, revision],
        );
      if (!result.rows.length) return reply.code(409).send({ error: "These templates changed. Reload before saving again." });
      await client.query("COMMIT");
      row = result.rows[0];
    } finally {
      try { if (!row) await client.query("ROLLBACK"); }
      finally { client.release(); }
    }
    realtime.publish("module:check-in:label-templates-changed", departmentId, {});
    return response(row);
  });
}
