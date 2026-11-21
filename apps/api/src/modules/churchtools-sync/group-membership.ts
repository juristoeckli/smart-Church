import type { PoolClient } from "pg";

type SourceObject = Record<string, unknown>;
const object = (value: unknown): SourceObject | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as SourceObject : undefined;
const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
const positiveInt = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
const positiveId = (value: unknown) => {
  if (positiveInt(value)) return String(value);
  return typeof value === "string" && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? value : null;
};
function day(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}
function timestamp(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) && day(value.slice(0, 10))
    && Number.isFinite(Date.parse(value)) ? value : null;
}

export function readChurchToolsGroupRoles(payload: unknown) {
  const page = object(payload);
  if (!Array.isArray(page?.data) || object(page.meta)?.count !== page.data.length) throw new Error("ChurchTools returned an incomplete group role list.");
  const roles = new Map<string, string>();
  for (const value of page.data) {
    const role = object(value);
    const id = positiveId(role?.id);
    const name = text(role?.name, 80) || text(role?.nameTranslated, 80);
    if (!id || !name || roles.has(id)) throw new Error("ChurchTools returned an invalid or duplicate group role.");
    roles.set(id, name);
  }
  return roles;
}

const membershipStatuses = { active: "active", waiting: "waitlist", requested: "paused", to_delete: "paused" } as const;

export function normalizeChurchToolsGroupMembership(value: unknown, roles: ReadonlyMap<string, string>) {
  const row = object(value);
  const person = object(row?.person);
  if (person?.icon === "user-shield") return null;
  const sourceId = positiveId(row?.id);
  const sourcePersonId = positiveId(person?.domainIdentifier ?? row?.personId);
  const roleId = positiveId(row?.groupTypeRoleId);
  const status = row?.groupMemberStatus;
  if (!row || !sourceId || !sourcePersonId || !roleId || typeof status !== "string" || !Object.hasOwn(membershipStatuses, status)) {
    throw new Error("ChurchTools returned a group membership with an invalid ID, role, or status.");
  }
  const sourceStatus = status as keyof typeof membershipStatuses;
  const knownRole = roles.get(roleId);
  return {
    sourceId, sourcePersonId, roleId, role: knownRole ?? "Member", roleKnown: Boolean(knownRole),
    sourceStatus, status: membershipStatuses[sourceStatus], joinedOn: day(row.memberStartDate),
    plannedEndOn: day(row.memberEndDate), comment: text(row.comment, 4000) || null,
    waitingListPosition: positiveInt(row.waitinglistPosition),
    registeredBySourceId: positiveId(row.registeredBy),
    roleChangedAt: timestamp(row.roleChangedDate), statusChangedAt: timestamp(row.statusChangedDate),
    customFieldCount: Array.isArray(row.fields) ? row.fields.length : 0,
  };
}

export type ChurchToolsGroupMembership = NonNullable<ReturnType<typeof normalizeChurchToolsGroupMembership>>;

export async function readChurchToolsGroupMemberships(readPage: (page: number, limit: number) => Promise<unknown>, roles: ReadonlyMap<string, string>) {
  const members: ChurchToolsGroupMembership[] = [];
  const sourceIds = new Set<string>();
  const personIds = new Set<string>();
  let expectedTotal: number | null = null;
  let expectedLastPage: number | null = null;
  let visibleRows = 0;
  let concealed = 0;
  for (let page = 1; page <= 100; page += 1) {
    const payload = object(await readPage(page, 200));
    const meta = object(payload?.meta);
    const pagination = object(meta?.pagination);
    const total = pagination?.total;
    const lastPage = pagination?.lastPage;
    if (!Array.isArray(payload?.data) || meta?.count !== payload.data.length || payload.data.length > 200
      || pagination?.current !== page || typeof total !== "number" || !Number.isSafeInteger(total) || total < 0
      || typeof lastPage !== "number" || !Number.isSafeInteger(lastPage) || lastPage < 0
      || (lastPage < page && !(page === 1 && lastPage === 0 && total === 0))
      || (expectedTotal !== null && total !== expectedTotal) || (expectedLastPage !== null && lastPage !== expectedLastPage)) {
      throw new Error("ChurchTools returned inconsistent group membership pagination. Run a new migration preview.");
    }
    if (lastPage > 100 || total > 20_000) throw new Error("ChurchTools returned more than 20,000 memberships for one group.");
    expectedTotal = total;
    expectedLastPage = lastPage;
    visibleRows += payload.data.length;
    for (const raw of payload.data) {
      const detail = normalizeChurchToolsGroupMembership(raw, roles);
      if (!detail) { concealed += 1; continue; }
      if (sourceIds.has(detail.sourceId) || personIds.has(detail.sourcePersonId)) throw new Error("ChurchTools repeated a group membership. Run a new migration preview.");
      sourceIds.add(detail.sourceId);
      personIds.add(detail.sourcePersonId);
      members.push(detail);
    }
    if (page >= lastPage) {
      if (visibleRows !== total) throw new Error("ChurchTools returned an incomplete group membership list.");
      return { members, concealed };
    }
  }
  throw new Error("ChurchTools returned an incomplete group membership list.");
}

export async function importChurchToolsMemberships(
  db: Pick<PoolClient, "query">, departmentId: string, instanceUrl: string, groupId: string, groupSourceId: string,
  members: ChurchToolsGroupMembership[], encryptArchive: (value: string) => string,
) {
  const configured = await db.query("SELECT 1 FROM churchtools_sync_settings WHERE department_id=$1 AND instance_url=$2 FOR SHARE", [departmentId, instanceUrl]);
  if (!configured.rowCount) throw new Error("ChurchTools connection changed after preview.");
  if (!members.length) return;
  const payload = members.map((member) => ({
    source_id: member.sourceId, source_person_id: member.sourcePersonId, role: member.role, status: member.status,
    joined_on: member.joinedOn, encrypted_snapshot: encryptArchive(JSON.stringify(member)),
  }));
  await db.query(`WITH incoming AS (
    SELECT member.*,COALESCE(linked.id,source.id) AS contact_id
    FROM jsonb_to_recordset($5::jsonb) AS member(source_id text,source_person_id text,role text,status text,joined_on date,encrypted_snapshot text)
    LEFT JOIN churchtools_migration_links link ON link.department_id=$1 AND link.area='person' AND link.source_id=member.source_person_id
    LEFT JOIN contacts linked ON linked.department_id=$1 AND linked.id=link.local_record_id
    LEFT JOIN contacts source ON source.department_id=$1 AND source.source_system='churchtools' AND source.source_id=member.source_person_id
  ), candidates AS (
    SELECT incoming.*,count(*) OVER (PARTITION BY incoming.contact_id) AS contact_matches,
      archive.source_id AS prior_source_id,archive.group_id AS prior_group_id,archive.contact_id AS prior_contact_id,
      archive.last_role,archive.last_status,archive.last_joined_on
    FROM incoming LEFT JOIN churchtools_migration_membership_details archive
      ON archive.department_id=$1 AND archive.instance_url=$2 AND archive.source_group_id=$3 AND archive.source_id=incoming.source_id
    WHERE incoming.contact_id IS NOT NULL
  ), inserted AS (
    INSERT INTO group_members(group_id,contact_id,role,status,joined_on)
    SELECT $4,contact_id,role,status,joined_on FROM candidates WHERE prior_source_id IS NULL AND contact_matches=1
    ON CONFLICT (group_id,contact_id) DO NOTHING RETURNING contact_id
  ), refreshed AS (
    UPDATE group_members native SET role=c.role,status=c.status,joined_on=c.joined_on
    FROM candidates c
    WHERE native.group_id=$4 AND native.contact_id=c.contact_id AND c.prior_group_id=$4 AND c.prior_contact_id=c.contact_id
      AND c.contact_matches=1 AND native.role=c.last_role AND native.status=c.last_status AND native.joined_on IS NOT DISTINCT FROM c.last_joined_on
    RETURNING native.contact_id
  ), managed AS (
    SELECT contact_id FROM inserted UNION ALL SELECT contact_id FROM refreshed
  )
  INSERT INTO churchtools_migration_membership_details
    (department_id,instance_url,source_group_id,source_id,group_id,contact_id,encrypted_snapshot,last_role,last_status,last_joined_on)
  SELECT $1,$2,$3,c.source_id,$4,c.contact_id,c.encrypted_snapshot,
    CASE WHEN m.contact_id IS NOT NULL THEN c.role END,
    CASE WHEN m.contact_id IS NOT NULL THEN c.status END,
    CASE WHEN m.contact_id IS NOT NULL THEN c.joined_on END
  FROM candidates c LEFT JOIN managed m ON m.contact_id=c.contact_id
  ON CONFLICT (department_id,instance_url,source_group_id,source_id) DO UPDATE
    SET group_id=EXCLUDED.group_id,contact_id=EXCLUDED.contact_id,encrypted_snapshot=EXCLUDED.encrypted_snapshot,
      last_role=EXCLUDED.last_role,last_status=EXCLUDED.last_status,last_joined_on=EXCLUDED.last_joined_on,imported_at=now()`,
  [departmentId, instanceUrl, groupSourceId, groupId, JSON.stringify(payload)]);
}
