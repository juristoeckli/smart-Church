import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

export async function registrationFormTemplatesInstalled(db: Pick<PoolClient, "query">) {
  const result = await db.query<{ installed: boolean }>(
    `SELECT count(*)=3 AS installed FROM pg_attribute
         WHERE attrelid=to_regclass('public.group_signup_forms') AND NOT attisdropped
           AND attname IN ('active_seat_limit','waitlist_limit','counted_roles')`,
  );
  return Boolean(result.rows[0]?.installed);
}

export async function lockRegistrationTemplate(client: PoolClient, departmentId: string, templateGroupId: string) {
  if (!await registrationFormTemplatesInstalled(client)) {
    return { status: 409, error: "Registration form templates are unavailable at this site." } as const;
  }
  const template = await client.query(
    `SELECT form.group_id FROM church_groups groups
       JOIN group_signup_forms form ON form.group_id=groups.id AND form.department_id=groups.department_id
      WHERE groups.id=$1 AND groups.department_id=$2 AND groups.status IN ('active','draft')
        AND groups.source_system IS NULL FOR SHARE OF groups,form`,
    [templateGroupId, departmentId],
  );
  return template.rowCount ? null : { status: 404, error: "Signup form template not found in this location." } as const;
}

export async function copyRegistrationForm(client: PoolClient, departmentId: string, templateGroupId: string, groupIds: string[]) {
  // Copy form settings only. Draft groups start empty with public signup disabled.
  await client.query(
    `INSERT INTO group_signup_forms(group_id,department_id,revision,questions,default_role,heading,active_seat_limit,waitlist_limit,counted_roles)
     SELECT generated.group_id,template.department_id,gen_random_uuid(),template.questions,template.default_role,template.heading,
            template.active_seat_limit,template.waitlist_limit,template.counted_roles
       FROM group_signup_forms template CROSS JOIN unnest($3::uuid[]) generated(group_id)
      WHERE template.group_id=$1 AND template.department_id=$2`,
    [templateGroupId, departmentId, groupIds],
  );
}

export async function createDraftRegistrationGroup(client: PoolClient, departmentId: string, appointmentId: string, title: string, start: string, original = start) {
  const groupId = randomUUID();
  const date = start.slice(0, 10);
  const time = original.slice(11, 19).replace(/:/g, "");
  const name = `Reg ${original.slice(0, 10)}-${time} ${title.slice(0, 70)} ${appointmentId.slice(0, 8)}`;
  await client.query(
    `INSERT INTO church_groups(id,department_id,name,description,status,starts_on,ends_on,public_signup_enabled)
     VALUES($1,$2,$3,'Registration group for a Calendar appointment.','draft',$4,$4,false)`,
    [groupId, departmentId, name, date],
  );
  return groupId;
}
