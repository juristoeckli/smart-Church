import type { PoolClient } from "pg";
import { isServerModuleEnabled } from "../module-sdk.js";
import { normalizeMembershipFieldValue, type MembershipFieldType, type MembershipFieldValue } from "../group-hierarchy/membership-field-value.js";

type Field = { id: string; label: string; type: MembershipFieldType; options: string[] };
type Query = Pick<PoolClient, "query">;

export async function routineMembershipFields(db: Query, departmentId: string, groupId: string, fieldId?: string, lock = false) {
  if (!isServerModuleEnabled("group-hierarchy")) return [];
  const enabled = await db.query("SELECT 1 FROM departments WHERE id=$1 AND 'group-hierarchy'=ANY(enabled_modules)", [departmentId]);
  if (!enabled.rowCount) return [];
  const { rows } = await db.query<Field>(
    `SELECT id,label,field_type AS type,options FROM group_member_field_definitions
      WHERE department_id=$1 AND group_id=$2 AND archived_at IS NULL AND ($3::uuid IS NULL OR id=$3)
      ORDER BY created_at,id ${lock ? "FOR SHARE" : ""}`, [departmentId, groupId, fieldId ?? null],
  );
  return rows;
}

export async function applyRoutineMembershipField(client: PoolClient, departmentId: string, groupId: string, contactId: string,
  actorId: string | null, step: { fieldId: string; value: MembershipFieldValue | null }) {
  const [field] = await routineMembershipFields(client, departmentId, groupId, step.fieldId, true);
  const value = field ? normalizeMembershipFieldValue(field, step.value) : undefined;
  if (!field || value === undefined) return null;
  const contact = await client.query("SELECT 1 FROM contacts WHERE department_id=$1 AND id=$2 AND archived_at IS NULL FOR SHARE", [departmentId, contactId]);
  if (!contact.rowCount) return null;
  const updated = await client.query(
    `INSERT INTO group_member_field_answers AS answer(department_id,group_id,contact_id,field_values,updated_by)
      SELECT $1,$2,$3,jsonb_strip_nulls($4::jsonb),$5
      WHERE $6::boolean OR EXISTS (SELECT 1 FROM group_member_field_answers previous
        WHERE previous.department_id=$1 AND previous.group_id=$2 AND previous.contact_id=$3)
      ON CONFLICT(department_id,group_id,contact_id) DO UPDATE
        SET field_values=jsonb_strip_nulls(answer.field_values || $4::jsonb),updated_by=EXCLUDED.updated_by,updated_at=now(),revision=answer.revision+1
      WHERE answer.field_values IS DISTINCT FROM jsonb_strip_nulls(answer.field_values || $4::jsonb)
      RETURNING revision`, [departmentId, groupId, contactId, JSON.stringify({ [field.id]: value }), actorId, value !== null],
  );
  return Boolean(updated.rowCount);
}
