import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";

export async function lockChoiceDefinitionWrite(client: PoolClient, departmentId: string) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["people-choice-definitions:" + departmentId]);
}

export async function withChoiceDefinitionWrite<T>(pool: Pool, departmentId: string, apply: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockChoiceDefinitionWrite(client, departmentId);
    const result = await apply(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function lockChoiceRenameContacts(client: PoolClient, departmentId: string, fieldId: string, oldName: string) {
  const result = await client.query<{ id: string }>(
    `SELECT person.id FROM contacts person
       JOIN people_record_values value ON value.department_id=person.department_id AND value.contact_id=person.id
      WHERE person.department_id=$1 AND value.field_id=$2 AND (value.value=to_jsonb($3::text) OR value.value @> jsonb_build_array($3::text))
      ORDER BY person.id FOR UPDATE OF person`,
    [departmentId, fieldId, oldName],
  );
  return new Set(result.rows.map((row) => row.id));
}

type SavedView = { id: string; criteria: Record<string, unknown> };
type RenameProfile = { id: string; archived: boolean; replacement: boolean; value: string | string[] };
type ChoiceRename = { departmentId: string; fieldId: string; fieldKey: string; multiple: boolean; oldName: string; newName: string; options: string[] };
type RenamePlan = {
  reviewToken: string;
  profiles: RenameProfile[];
  views: (SavedView & { replacementCriteria: SavedView["criteria"] })[];
};
type Blocked = { error: string };

function updateSavedView(view: SavedView, fieldKey: string, oldName: string, newName: string, multiple: boolean): { criteria: SavedView["criteria"] } | Blocked {
  const criteria = view.criteria;
  const next = { ...criteria };
  if (criteria.field === fieldKey) {
    if (criteria.value === newName) return { error: "A saved People view already uses the proposed name. Change that view before renaming this choice." };
    if (criteria.value === oldName) next.value = newName;
  }
  if (Array.isArray(criteria.filters)) {
    const filters = [];
    for (const raw of criteria.filters) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.field !== fieldKey) {
        filters.push(raw);
        continue;
      }
      if (raw.value === newName || (raw.value === oldName && raw.operator !== undefined && raw.operator !== (multiple ? "includes" : "equals"))) {
        return { error: "A saved People view uses a filter that cannot be safely migrated. Change that view before renaming this choice." };
      }
      filters.push(raw.value === oldName ? { ...raw, value: newName } : raw);
    }
    next.filters = filters;
  }
  return { criteria: next };
}

async function hasDesignerChoiceFilter(client: PoolClient, departmentId: string, fieldId: string) {
  const tables = await client.query<{ installed: boolean }>("SELECT to_regclass('public.saved_designer_reports') IS NOT NULL AS installed");
  if (tables.rows[0]?.installed) {
    const filter = await client.query(
      `SELECT 1 FROM saved_designer_reports report WHERE report.department_id=$1 AND report.definition->>'dataset'='people'
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(report.definition->'filters')='array'
         THEN report.definition->'filters' ELSE '[]'::jsonb END) item WHERE item->>'field'=$2) LIMIT 1`,
      [departmentId, "custom_" + fieldId.replace(/-/g, "")],
    );
    return Boolean(filter.rowCount);
  }
  return false;
}

function readChoiceViews(client: PoolClient, departmentId: string, fieldKey: string, names: string[], { lockViews = false, limit = null }: { lockViews?: boolean; limit?: number | null } = {}) {
  return client.query<SavedView>(
    `SELECT v.id,v.criteria FROM people_record_saved_views v WHERE v.department_id=$1 AND (
       (v.criteria->>'field'=$2 AND v.criteria->>'value'=ANY($3::text[])) OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v.criteria->'filters')='array'
           THEN v.criteria->'filters' ELSE '[]'::jsonb END) item
         WHERE item->>'field'=$2 AND item->>'value'=ANY($3::text[])
       )
     ) ORDER BY v.id LIMIT $4 ${lockViews ? "FOR UPDATE OF v" : ""}`,
    [departmentId, fieldKey, names, limit],
  );
}

export async function choiceRemovalBlocker(client: PoolClient, departmentId: string, fieldId: string, fieldKey: string, name: string) {
  const usage = await client.query(
    "SELECT 1 FROM people_record_values WHERE department_id=$1 AND field_id=$2 AND (value=to_jsonb($3::text) OR value @> jsonb_build_array($3::text)) LIMIT 1",
    [departmentId, fieldId, name],
  );
  if (usage.rowCount) return "This choice is used by a People profile, including archived profiles.";
  const views = await readChoiceViews(client, departmentId, fieldKey, [name], { limit: 1 });
  if (views.rowCount) return "This choice is used by a saved People view.";
  if (await hasDesignerChoiceFilter(client, departmentId, fieldId)) {
    return "A saved Designer report filters this choice field. Review that report filter before deleting a choice.";
  }
  return null;
}

export async function inspectChoiceRename(client: PoolClient, rename: ChoiceRename, lockViews = false): Promise<RenamePlan | Blocked> {
  const { departmentId, fieldId, fieldKey, oldName, newName, options, multiple } = rename;
  if (await hasDesignerChoiceFilter(client, departmentId, fieldId)) {
    return { error: "A saved Designer report filters this choice field. Remove or update that report filter before renaming to avoid changing the report’s results." };
  }
  const { rows: profiles } = await client.query<RenameProfile>(
    `SELECT person.id,person.archived_at IS NOT NULL AS archived,(value.value=to_jsonb($4::text) OR value.value @> jsonb_build_array($4::text)) AS replacement,value.value
       FROM contacts person JOIN people_record_values value ON value.department_id=person.department_id AND value.contact_id=person.id
      WHERE person.department_id=$1 AND value.field_id=$2 AND (value.value IN(to_jsonb($3::text),to_jsonb($4::text))
        OR value.value @> jsonb_build_array($3::text) OR value.value @> jsonb_build_array($4::text)) ORDER BY person.id`,
    [departmentId, fieldId, oldName, newName],
  );
  if (profiles.some((row) => row.replacement)) {
    return { error: "Existing profiles already use the proposed name. Choose another name to avoid merging distinct values." };
  }
  const { rows: views } = await readChoiceViews(client, departmentId, fieldKey, [oldName, newName], { lockViews });
  const replacements = [];
  for (const view of views) {
    const next = updateSavedView(view, fieldKey, oldName, newName, multiple);
    if ("error" in next) return next;
    replacements.push({ ...view, replacementCriteria: next.criteria });
  }
  const reviewToken = createHash("sha256").update(JSON.stringify([departmentId, fieldId, fieldKey, oldName, newName, options, profiles, views])).digest("hex");
  return { reviewToken, profiles, views: replacements };
}

export async function applyChoiceRename(client: PoolClient, rename: ChoiceRename, plan: RenamePlan, actorId: string | null, nextOptions: string[]) {
  const { departmentId, fieldId, oldName, newName } = rename;
  const history = await client.query(
    `WITH updated AS (
      UPDATE people_record_values current SET value=reviewed.after_value,updated_by=$5,updated_at=now()
       FROM unnest($3::uuid[],$4::jsonb[],$6::jsonb[]) AS reviewed(contact_id,before_value,after_value)
       WHERE current.department_id=$1 AND current.field_id=$2 AND current.contact_id=reviewed.contact_id
         AND current.value=reviewed.before_value
       RETURNING current.contact_id,reviewed.before_value,reviewed.after_value
    )
    INSERT INTO people_record_history (id,department_id,contact_id,actor_user_id,action,subject,before_value,after_value)
    SELECT gen_random_uuid(),$1,contact_id,$5,'field_updated',$2::uuid::text,before_value,after_value FROM updated`,
    [departmentId, fieldId, plan.profiles.map((person) => person.id),
      plan.profiles.map((person) => JSON.stringify(person.value)), actorId,
      plan.profiles.map(({ value }) => JSON.stringify(Array.isArray(value)
        ? value.map((choice) => choice === oldName ? newName : choice) : newName))],
  );
  if (history.rowCount !== plan.profiles.length) throw new Error("The reviewed People records changed while renaming this choice.");
  if (plan.views.length) {
    const written = await client.query(
      `UPDATE people_record_saved_views v SET criteria=updates.criteria,updated_at=now()
       FROM unnest($2::uuid[],$3::jsonb[]) AS updates(id,criteria)
       WHERE v.department_id=$1 AND v.id=updates.id`,
      [departmentId, plan.views.map((view) => view.id), plan.views.map((view) => JSON.stringify(view.replacementCriteria))],
    );
    if (written.rowCount !== plan.views.length) throw new Error("The reviewed saved People views changed while renaming this choice.");
  }
  await client.query("UPDATE people_record_fields SET options=$3::jsonb,updated_at=now() WHERE department_id=$1 AND id=$2",
    [departmentId, fieldId, JSON.stringify(nextOptions)]);
}
