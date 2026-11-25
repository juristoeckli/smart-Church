import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { checkInLabelTemplateKeys, defaultCheckInLabelTemplates, validCheckInLabelTemplate,
  type CheckInLabelTemplates, type CheckInLabelTemplateSettings } from "@smart-church/contracts";
import type { PoolClient } from "pg";
import type { ModuleServerContext } from "../module-sdk.js";

const url = "/api/modules/check-in/label-templates";
type TemplateRow = CheckInLabelTemplates & { revision: number; pickup_tag_ids: string[] };
type Database = Pick<PoolClient, "query">;

const eligibleTags = "tag.department_id=$1 AND tag.active AND tag.field_type='boolean' AND NOT tag.required AND tag.field_key ~ '^tag_[a-z0-9_]+$' AND tag.visibility='private_people'";

async function tagsInstalled(database: Database, departmentId: string) {
  return (await database.query<{ present: boolean }>(
    "SELECT to_regclass('public.people_record_fields') IS NOT NULL AND to_regclass('public.people_record_values') IS NOT NULL AND EXISTS(SELECT 1 FROM departments WHERE id=$1 AND 'people-records'=ANY(enabled_modules)) AS present", [departmentId],
  )).rows[0]?.present;
}

export async function pickupPrintCoverage(database: Database, departmentId: string, contactIds: string[], canReadPeople: boolean) {
  const { rows: [settings] } = await database.query<{ pickup_tag_ids: string[] }>(
    "SELECT pickup_tag_ids FROM check_in_label_templates WHERE department_id=$1", [departmentId],
  );
  if (!settings?.pickup_tag_ids.length) return null;
  if (!canReadPeople || !await tagsInstalled(database, departmentId)) return new Set<string>();
  const { rows } = await database.query<{ contact_id: string }>(
    `SELECT DISTINCT value.contact_id FROM people_record_fields tag
      JOIN people_record_values value ON value.field_id=tag.id AND value.department_id=tag.department_id
      JOIN contacts p ON p.id=value.contact_id AND p.department_id=tag.department_id AND p.archived_at IS NULL
      WHERE ${eligibleTags} AND tag.id=ANY($2::uuid[]) AND value.contact_id=ANY($3::uuid[]) AND value.value='true'::jsonb`,
    [departmentId, settings.pickup_tag_ids, contactIds],
  );
  return new Set(rows.map(row => row.contact_id));
}

async function tagChoices(database: Database, departmentId: string) {
  if (!await tagsInstalled(database, departmentId)) return [];
  return (await database.query<{ id: string; label: string }>(
    `SELECT tag.id,tag.label FROM people_record_fields tag WHERE ${eligibleTags} ORDER BY lower(tag.label),tag.id`, [departmentId],
  )).rows;
}
type Update = Omit<CheckInLabelTemplateSettings, "availablePickupTags">;

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
      "SELECT revision,individual,child,parent,pickup_tag_ids FROM check_in_label_templates WHERE department_id=$1", [departmentId],
    );
    const result = response(row);
    if (request.activeDepartmentRole === "site_admin") {
      result.pickupTagIds = row?.pickup_tag_ids ?? [];
      result.availablePickupTags = await tagChoices(pool!, departmentId);
    }
    return result;
  });

  const templateString = { type: "string", maxLength: 480 } as const;
  app.put<{ Body: Update }>(url, { schema: {
    body: { type: "object", additionalProperties: false, required: ["revision", "templates"], properties: {
      revision: { type: "integer", minimum: 0, maximum: 2147483646 },
      pickupTagIds: { type: "array", maxItems: 50, uniqueItems: true, items: { type: "string", format: "uuid" } },
      templates: {
        type: "object", additionalProperties: false, required: checkInLabelTemplateKeys,
        properties: { individual: templateString, child: templateString, parent: templateString },
      },
    } },
  } }, async (request, reply) => {
    const departmentId = await scope(request, reply, true);
    if (!departmentId) return reply;
    const { revision, templates } = request.body;
    const selectedTags = request.body.pickupTagIds?.map(id => id.toLowerCase());
    if (selectedTags && new Set(selectedTags).size !== selectedTags.length) return reply.code(400).send({ error: "Select each eligible People tag once." });
    if (checkInLabelTemplateKeys.some(key => !validCheckInLabelTemplate(templates[key]))) {
      return reply.code(400).send({ error: "Use the listed placeholders and up to six lines and 480 characters per template." });
    }
    const values = [departmentId, templates.individual.trim(), templates.child.trim(), templates.parent.trim()];
    const client = await pool!.connect();
    let row: TemplateRow | undefined;
    let availablePickupTags: CheckInLabelTemplateSettings["availablePickupTags"];
    try {
      await client.query("BEGIN");
      if (!await context.lockDepartmentForWrite(client, departmentId)) {
        return reply.code(423).send({ error: "This location is read-only." });
      }
      if (selectedTags?.length) {
        const found = await tagsInstalled(client, departmentId) ? await client.query(
          `SELECT tag.id FROM people_record_fields tag WHERE ${eligibleTags} AND tag.id=ANY($2::uuid[]) FOR SHARE`,
          [departmentId, selectedTags],
        ) : null;
        if (found?.rows.length !== selectedTags.length) return reply.code(400).send({ error: "Select active People tags from this location." });
      }
      const result = revision === 0
        ? await client.query<TemplateRow>(
          `INSERT INTO check_in_label_templates(department_id,revision,individual,child,parent,pickup_tag_ids)
            VALUES($1,1,$2,$3,$4,$5) ON CONFLICT(department_id) DO NOTHING RETURNING revision,individual,child,parent,pickup_tag_ids`, [...values, selectedTags ?? []],
        )
        : await client.query<TemplateRow>(
          `UPDATE check_in_label_templates SET revision=revision+1,individual=$2,child=$3,parent=$4,pickup_tag_ids=COALESCE($6::uuid[],pickup_tag_ids)
            WHERE department_id=$1 AND revision=$5
            RETURNING revision,individual,child,parent,pickup_tag_ids`, [...values, revision, selectedTags ?? null],
        );
      if (!result.rows.length) return reply.code(409).send({ error: "These templates changed. Reload before saving again." });
      availablePickupTags = await tagChoices(client, departmentId);
      await client.query("COMMIT");
      row = result.rows[0];
    } finally {
      try { if (!row) await client.query("ROLLBACK"); }
      finally { client.release(); }
    }
    realtime.publish("module:check-in:label-templates-changed", departmentId, {});
    return { ...response(row), pickupTagIds: row.pickup_tag_ids, availablePickupTags };
  });
}
