import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ModuleServerContext } from "../module-sdk.js";
import { canManagePeopleFields } from "./field-privacy.js";

type DepartmentResolver = (request: FastifyRequest, reply: FastifyReply, write?: boolean) => Promise<string | null>;
type Step = { id: string; name: string };
type Mapping = { groupId?: string; groupType?: string; role: string; stepId: string | null };
type Settings = { revision: number; steps: Step[]; mappings: Mapping[] };
const settingsPath = "/api/people-records/growth-trajectory";
const uuid = { type: "string", format: "uuid" } as const;
const emptySettings: Settings = { revision: 0, steps: [], mappings: [] };
const normalized = (value: string) => value.trim().toLowerCase();

function canConfigure(request: FastifyRequest) {
  return canManagePeopleFields(request)
    && (request.activeDepartmentRole === "site_admin" || (request.activeDepartmentPermissions ?? []).includes("groups_manage"));
}

function normalizeSettings(settings: Settings) {
  const steps = settings.steps.map(step => ({ id: step.id.toLowerCase(), name: step.name.trim() }));
  const ids = new Set(steps.map(step => step.id));
  if (ids.size !== steps.length || new Set(steps.map(step => normalized(step.name))).size !== steps.length
    || steps.some(step => !step.name)) return null;
  const mappings: Mapping[] = [];
  const seen = new Set<string>();
  for (const entry of settings.mappings) {
    const groupId = entry.groupId?.toLowerCase();
    const groupType = entry.groupType === undefined ? undefined : normalized(entry.groupType);
    const role = normalized(entry.role);
    const stepId = entry.stepId?.toLowerCase() ?? null;
    if (!role || Boolean(groupId) === Boolean(groupType) || groupType === ""
      || (stepId === null ? !groupId : !ids.has(stepId))) return null;
    const key = JSON.stringify([groupId ?? null, groupType ?? null, role]);
    if (seen.has(key)) return null;
    seen.add(key);
    mappings.push({ ...(groupId ? { groupId } : { groupType }), role, stepId });
  }
  return { revision: settings.revision, steps, mappings };
}

export function registerGrowthTrajectory(routes: FastifyInstance, context: ModuleServerContext, department: DepartmentResolver) {
  const { pool, lockDepartmentForWrite, validateMutation, realtime } = context;
  routes.get(settingsPath, async (request, reply) => {
    const id = await department(request, reply);
    if (!id) return reply;
    if (!canConfigure(request)) return reply.code(403).send({ error: "People and Groups management access is required." });
    const result = await pool!.query<Settings & { groups: { id: string; name: string; type: string }[] }>(
      `SELECT COALESCE(config.revision,0) AS revision,COALESCE(config.steps,'[]') AS steps,
              COALESCE(config.mappings,'[]') AS mappings,
              COALESCE((SELECT jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'type',
                lower(btrim(COALESCE(to_jsonb(g)->>'group_type','')))) ORDER BY lower(g.name),g.id)
                 FROM church_groups g WHERE g.department_id=location.id),'[]') AS groups
         FROM departments location LEFT JOIN people_growth_config config ON config.department_id=location.id
        WHERE location.id=$1`, [id],
    );
    return reply.header("Cache-Control", "private, no-store").send(result.rows[0] ?? { ...emptySettings, groups: [] });
  });

  routes.put<{ Body: Settings }>(settingsPath, { schema: { body: {
    type: "object", additionalProperties: false, required: ["revision", "steps", "mappings"], properties: {
      revision: { type: "integer", minimum: 0, maximum: 2147483646 },
      steps: { type: "array", maxItems: 30, items: {
        type: "object", additionalProperties: false, required: ["id", "name"],
        properties: { id: uuid, name: { type: "string", minLength: 1, maxLength: 100 } },
      } },
      mappings: { type: "array", maxItems: 1000, items: {
        type: "object", additionalProperties: false, required: ["role", "stepId"],
        properties: {
          groupId: uuid, groupType: { type: "string", minLength: 1, maxLength: 80 },
          role: { type: "string", minLength: 1, maxLength: 80 }, stepId: { anyOf: [uuid, { type: "null" }] },
        },
      } },
    },
  } } }, async (request, reply) => {
    const id = await department(request, reply, true);
    if (!id) return reply;
    if (!canConfigure(request)) return reply.code(403).send({ error: "People and Groups management access is required." });
    if (!validateMutation(request, reply)) return reply;
    const input = normalizeSettings(request.body);
    if (!input) return reply.code(400).send({ error: "Use unique named steps and a single mapping per group or type and role." });
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      if (!await lockDepartmentForWrite(client, id)) {
        await client.query("ROLLBACK");
        return reply.code(423).send({ error: "This location is read-only." });
      }
      const groups = await client.query<{ id: string; type: string }>(
        `SELECT g.id,lower(btrim(COALESCE(to_jsonb(g)->>'group_type',''))) AS type FROM church_groups g WHERE g.department_id=$1`, [id],
      );
      const ids = new Set(groups.rows.map(group => group.id));
      const types = new Set(groups.rows.map(group => group.type));
      if (input.mappings.some(mapping => mapping.groupId ? !ids.has(mapping.groupId) : !types.has(mapping.groupType!))) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "Remove unavailable group or group-type mappings before saving." });
      }
      const saved = await client.query<{ revision: number }>(input.revision === 0
        ? `INSERT INTO people_growth_config(department_id,revision,steps,mappings)
           SELECT $1,1,$2::jsonb,$3::jsonb WHERE $4::int=0
           ON CONFLICT (department_id) DO NOTHING RETURNING revision`
        : `UPDATE people_growth_config SET steps=$2::jsonb,mappings=$3::jsonb,revision=revision+1
           WHERE department_id=$1 AND revision=$4 RETURNING revision`,
        [id, JSON.stringify(input.steps), JSON.stringify(input.mappings), input.revision],
      );
      const revision = saved.rows[0]?.revision;
      if (!revision) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "Growth trajectory settings changed. Reload before saving." });
      }
      await client.query("COMMIT");
      realtime.publish("people-records:changed", id, {});
      return { ...input, revision };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  routes.get<{ Params: { contactId: string } }>("/api/people-records/:contactId/growth-trajectory", {
    schema: { params: { type: "object", required: ["contactId"], properties: { contactId: uuid } } },
  }, async (request, reply) => {
    const id = await department(request, reply);
    if (!id) return reply;
    if (!canManagePeopleFields(request)) return reply.code(403).send({ error: "People management access is required." });
    const { rows } = await pool!.query<{ steps: Step[]; memberships: { role: string; groupId: string; groupType: string }[]; mappings: Mapping[] }>(
      `SELECT COALESCE(config.steps,'[]') AS steps,COALESCE(config.mappings,'[]') AS mappings,
              COALESCE((SELECT jsonb_agg(jsonb_build_object('role',lower(btrim(m.role)),'groupId',g.id,
                'groupType',lower(btrim(COALESCE(to_jsonb(g)->>'group_type','')))))
                 FROM group_members m JOIN church_groups g ON g.id=m.group_id AND g.department_id=c.department_id
                WHERE m.contact_id=c.id AND m.status='active' AND COALESCE(to_jsonb(g)->>'status','active')='active'),'[]') AS memberships
         FROM contacts c LEFT JOIN people_growth_config config ON config.department_id=c.department_id
        WHERE c.department_id=$1 AND c.id=$2 AND c.archived_at IS NULL`, [id, request.params.contactId],
    );
    if (!rows[0]) return reply.code(404).send({ error: "Active person not found at this location." });
    const { steps, memberships, mappings } = rows[0];
    const byScope = new Map(mappings.map(mapping => [JSON.stringify([mapping.groupId ?? null, mapping.groupType ?? null, mapping.role]), mapping]));
    const achieved = new Set<string>();
    for (const member of memberships) {
      const override = byScope.get(JSON.stringify([member.groupId, null, member.role]));
      const mapping = override ?? byScope.get(JSON.stringify([null, member.groupType, member.role]));
      if (mapping?.stepId) achieved.add(mapping.stepId);
    }
    const achievedSteps = steps.filter(step => achieved.has(step.id));
    return reply.header("Cache-Control", "private, no-store").send({ current: achievedSteps.at(-1) ?? null, achieved: achievedSteps });
  });
}
