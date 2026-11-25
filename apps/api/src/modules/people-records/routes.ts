import { applyChoiceRename, inspectChoiceRename, lockChoiceDefinitionWrite, lockChoiceRenameContacts, withChoiceDefinitionWrite } from "./choice-rename.js";
import { registerPersonalFollowups } from "./personal-followups.js";
import { registerGrowthTrajectory } from "./growth-trajectory.js";
import { personTagMatch } from "./tag-search.js";
import { registerGroupMembershipImport } from "./group-membership-import.js";
import { presentMeetingFilter, registerPeopleMeetingFilter } from "./directory-meeting-filter.js";
import { registerPeopleRecordsReplication } from "./replication.js";
import { registerPrivatePersonNotes } from "./private-person-notes.js";
import { registerPersonServiceWorkload } from "./person-service-workload.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import type { ModuleServerContext } from "../module-sdk.js";
import { maxPersonAttachments, registerPersonAttachments } from "./attachments.js";
import { canManagePeopleFields, customFieldVisibilities, type CustomFieldVisibility } from "./field-privacy.js";
import { accessiblePeopleGroups, canManageMembershipHistory, registerPeopleHistoryTimeline, visibleProfileHistory } from "./profile-history.js";
import { normalizePostalAddress, postalAddressLimits, postalAddressSchema, type PostalAddress } from "./postal-address.js";
import { registerPeopleHouseholds } from "./households.js";

const uuid = { type: "string", format: "uuid" } as const;
const membershipJoinDate = { type: "string", format: "date", pattern: "^(?!0000-)" } as const;
type MembershipJoinRange = { groupJoinedFrom?: string | null; groupJoinedThrough?: string | null };
function membershipJoinRangeError({ groupJoinedFrom, groupJoinedThrough }: MembershipJoinRange) {
  return groupJoinedFrom && groupJoinedThrough && groupJoinedFrom > groupJoinedThrough
    ? "Choose a group join end date on or after the start date." : null;
}
type FieldFilterInput={field:string;value:string;operator?:string};
type RelationshipFilterInput={relationshipTypeId?:string;legacyRelationship?:string;exclude:boolean};
const postalAddressColumns = Object.keys(postalAddressLimits).map((key) => "address:" + key);
const directorySorts = ["lastName", "firstName", "nameDescending", "status"] as const;
type DirectorySort = typeof directorySorts[number];
const directorySortSchema = {type:"string",enum:directorySorts};
function directoryOrder(sort: DirectorySort | undefined) {
  switch (sort) {
    case "firstName": return "c.first_name,c.last_name,c.id";
    case "nameDescending": return "c.last_name DESC,c.first_name DESC,c.id";
    case "status": return "c.status,c.last_name,c.first_name,c.id";
    default: return "c.last_name,c.first_name,c.id";
  }
}
const coreDirectoryColumns=["id","firstName","lastName","email","phone","status"];
const directoryTextMatch = `(CASE WHEN left(lower(btrim($2)),4)='tag:'
  THEN ${personTagMatch("btrim(substring(btrim($2) FROM 5))", "$10")}
  ELSE ($2='' OR concat_ws(' ',c.first_name,c.last_name,c.email,c.phone) ILIKE '%'||$2||'%'
  OR (btrim($2)<>'' AND EXISTS (
    SELECT 1 FROM people_record_fields nickname JOIN people_record_values saved
      ON saved.department_id=nickname.department_id AND saved.field_id=nickname.id AND saved.contact_id=c.id
     WHERE nickname.department_id=c.department_id AND nickname.field_key='nickname' AND nickname.field_type='text'
       AND nickname.active AND ($10::boolean OR nickname.visibility='private_people')
       AND jsonb_typeof(saved.value)='string' AND lower(btrim(saved.value #>> '{}'))=lower(btrim($2))
  ))) END)`;
function parseRelationshipFilters(raw:string|undefined):RelationshipFilterInput[]{
  if(raw===undefined)return [];
  let parsed:unknown;try{parsed=JSON.parse(raw)}catch{throw new Error("Relationship filters must be a valid list.")}
  if(!Array.isArray(parsed)||parsed.length>10)throw new Error("Choose up to 10 relationship filters.");
  const filters=parsed.map(item=>{if(!item||typeof item!=="object"||Array.isArray(item))throw new Error("Each relationship filter must include a type or legacy label and a direction.");const value=item as Record<string,unknown>;const hasType=typeof value.relationshipTypeId==="string",hasLegacy=typeof value.legacyRelationship==="string";if(Object.keys(value).some(key=>key!=="relationshipTypeId"&&key!=="legacyRelationship"&&key!=="exclude")||hasType===hasLegacy||typeof value.exclude!=="boolean")throw new Error("Choose a valid relationship filter.");if(hasType&&!/^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(value.relationshipTypeId as string))throw new Error("Choose a valid relationship type filter.");if(hasLegacy&&(!(value.legacyRelationship as string).trim()||(value.legacyRelationship as string).trim().length>60))throw new Error("Choose a valid legacy relationship label.");return hasType?{relationshipTypeId:value.relationshipTypeId as string,exclude:value.exclude}:{legacyRelationship:(value.legacyRelationship as string).trim(),exclude:value.exclude}});
  const keys=filters.map(item=>item.relationshipTypeId?`type:${item.relationshipTypeId.toLowerCase()}`:`legacy:${item.legacyRelationship!.toLowerCase()}`);
  if(new Set(keys).size!==filters.length)throw new Error("Use each relationship filter only once in a filter list.");
  return filters;
}
function parseFieldFilters(raw:string|undefined,field?:string,value?:string):FieldFilterInput[]{
  if(raw!==undefined&&(field!==undefined||value!==undefined))throw new Error("Use either filters or the legacy field/value pair, not both.");
  if(raw!==undefined){let parsed:unknown;try{parsed=JSON.parse(raw)}catch{throw new Error("Custom field filters must be a valid filter list.")}
    if(!Array.isArray(parsed)||parsed.length>10)throw new Error("Choose up to 10 custom field filters.");
    return parsed.map(item=>{if(!item||typeof item!=="object"||Array.isArray(item))throw new Error("Each custom field filter must include a field and value.");const record=item as Record<string,unknown>;if(Object.keys(record).some(key=>key!=="field"&&key!=="value"&&key!=="operator")||typeof record.field!=="string"||typeof record.value!=="string"||(record.operator!==undefined&&typeof record.operator!=="string"))throw new Error("Each custom field filter must include a field, operator, and value.");return{field:record.field,value:record.value,...(record.operator===undefined?{}:{operator:record.operator as string})}});
  }
  if((field===undefined)!==(value===undefined))throw new Error("Select both a custom field and value, or clear both filters.");
  return field===undefined?[]:[{field,value:value!}];
}
function normalizeFieldFilter(fieldType: string, options: unknown, value: string, requestedOperator?:string): {operator:string;value:unknown}|null {
  if (fieldType === "text") {
    const operator=requestedOperator??"equals";
    return value.length > 0 && value.length <= 200 && ["equals","contains"].includes(operator) ? {operator,value} : null;
  }
  if (fieldType === "date") {
    const operator=requestedOperator??"on";
    const relativeOperators=["last_7_days","last_30_days","last_90_days","next_7_days","next_30_days","next_90_days"];
    if(relativeOperators.includes(operator))return value===""?{operator,value}:null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === value && ["on","before","after"].includes(operator) ? {operator,value} : null;
  }
  if (fieldType === "boolean") return (requestedOperator===undefined||requestedOperator==="equals")&&(value === "true" || value === "false") ? {operator:"equals",value:value==="true"} : null;
  if (fieldType === "select") return (requestedOperator===undefined||requestedOperator==="equals")&&Array.isArray(options)&&options.some(option=>option===value) ? {operator:"equals",value} : null;
  return null;
}
export function registerModuleRoutes(app: FastifyInstance, context: ModuleServerContext) {
  const { pool, isDatabaseReady, resolveDepartmentId, validateMutation, realtime } = context;
  registerPeopleRecordsReplication(context);
  app.register(async (routes) => {
    async function department(request: FastifyRequest, reply: FastifyReply, write = false) {
      if (!isDatabaseReady() || !pool) { reply.code(503).send({ error: "People Records are unavailable because the database is not ready." }); return null; }
      const departmentId = await resolveDepartmentId(request, reply, false, false, write ? "people_manage" : undefined);
      if (!departmentId) return null;
      if (!write) {
        const permissions = request.activeDepartmentPermissions ?? [];
        if (request.activeDepartmentRole !== "site_admin" && !permissions.includes("people_view_private") && !permissions.includes("people_manage")) { reply.code(403).send({ error: "You need private People access to view records." }); return null; }
      }
      return departmentId;
    }
    registerPersonAttachments(routes, context, department);
    registerPrivatePersonNotes(routes, context, department);
    const canFilterAttendedMeeting = registerPeopleMeetingFilter(routes, context, department);
    registerPeopleHistoryTimeline(routes, context, department);
    registerPeopleHouseholds(routes, context, department);
    registerPersonServiceWorkload(routes, context, department);
    registerGrowthTrajectory(routes, context, department);
    registerPersonalFollowups(routes, context, department);
    async function validateFieldFilters(departmentId:string,filters:FieldFilterInput[],canManage:boolean,transaction?:PoolClient):Promise<Array<{field:string;operator:string;value:unknown}>>{
      if(filters.length>10)throw new Error("Choose up to 10 custom field filters.");
      if(new Set(filters.map(item=>item.field)).size!==filters.length)throw new Error("Use each custom field only once in a filter list.");
      const normalized:Array<{field:string;operator:string;value:unknown}>=[];
      for(const item of filters){
        if(!/^[a-z][a-z0-9_]{0,39}$/.test(item.field))throw new Error("Choose a valid custom field.");
        const record=await (transaction ?? pool!).query<{field_type:string;options:unknown}>("SELECT field_type,options FROM people_record_fields WHERE department_id=$1 AND field_key=$2 AND active=true AND ($3::boolean OR visibility='private_people')" + (transaction ? " FOR SHARE" : ""),[departmentId,item.field,canManage]);
        const filter=record.rowCount?normalizeFieldFilter(record.rows[0].field_type,record.rows[0].options,item.value,item.operator):null;
        if(filter===null)throw new Error("Choose an active custom field at this location, a supported operator, and a value valid for its type.");
        normalized.push({field:item.field,...filter});
      }
      return normalized;
    }
    async function validateRelationshipFilters(departmentId:string,filters:RelationshipFilterInput[],canManage:boolean):Promise<RelationshipFilterInput[]>{
      const ids=filters.flatMap(item=>item.relationshipTypeId?[item.relationshipTypeId]:[]);
      if(ids.length){const found=await pool!.query<{id:string}>("SELECT id FROM people_record_relationship_types WHERE department_id=$1 AND id=ANY($2::uuid[]) AND ($3::boolean OR visibility='private_people')",[departmentId,ids,canManage]);if(found.rowCount!==ids.length)throw new Error("Choose relationship types you can view at this location.")}
      return filters;
    }
    async function validateDirectoryColumns(departmentId:string,columns:string[]|undefined,canManage:boolean):Promise<string[]>{
      if(columns===undefined)return [...coreDirectoryColumns];
      if(columns.length<1||columns.length>20||new Set(columns).size!==columns.length)throw new Error("Choose between 1 and 20 distinct directory columns.");
      const fieldKeys=columns.filter(column=>column.startsWith("custom:")).map(column=>column.slice(7));
      if(columns.some(column=>!coreDirectoryColumns.includes(column)&&!postalAddressColumns.includes(column)&&!column.startsWith("custom:")))throw new Error("Choose an available directory column.");
      if(fieldKeys.some(key=>!/^[a-z][a-z0-9_]{0,39}$/.test(key)))throw new Error("Choose a valid custom field column.");
      if(fieldKeys.length){const found=await pool!.query<{field_key:string}>("SELECT field_key FROM people_record_fields WHERE department_id=$1 AND field_key=ANY($2::text[]) AND active=true AND ($3::boolean OR visibility='private_people')",[departmentId,fieldKeys,canManage]);if(found.rowCount!==fieldKeys.length)throw new Error("Custom field columns must be active fields you can view at this location.")}
      return columns;
    }
    async function history(departmentId: string, contactId: string, request: FastifyRequest, action: string, subject: string, before?: unknown, after?: unknown, db: PoolClient | NonNullable<typeof pool> = pool!) {
      await db.query("INSERT INTO people_record_history(id,department_id,contact_id,actor_user_id,action,subject,before_value,after_value) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)", [randomUUID(), departmentId, contactId, request.authenticatedUser?.id ?? null, action, subject, before === undefined ? null : JSON.stringify(before), after === undefined ? null : JSON.stringify(after)]);
    }
    const changed = (departmentId: string, contactId?: string) => realtime.publish("people-records:changed", departmentId, { contactId });
    async function inspectMerge(departmentId: string, keeperId: string, sourceId: string, db: PoolClient | NonNullable<typeof pool> = pool!, canManage = true) {
      const found = await db.query<{ id: string; first_name: string; last_name: string; email: string | null; phone: string | null; status: string; sourceSystem:string|null; sourceId:string|null; elvantoSourceId:string|null; postalAddress:PostalAddress }>(
        `SELECT id,first_name,last_name,email,phone,status,to_jsonb(contact)->>'source_system' AS "sourceSystem",to_jsonb(contact)->>'source_id' AS "sourceId",to_jsonb(contact)->>'elvanto_source_id' AS "elvantoSourceId",postal_address AS "postalAddress" FROM contacts contact WHERE department_id=$1 AND id=ANY($2::uuid[]) ORDER BY id`, [departmentId, [keeperId, sourceId]],
      );
      if (found.rowCount !== 2) return null;
      const keeper = found.rows.find((person) => person.id === keeperId)!; const source = found.rows.find((person) => person.id === sourceId)!;
      const profileConflicts = [["first name","first_name"],["last name","last_name"],["email","email"],["phone","phone"],["status","status"]].flatMap(([label,field]) => {
        const keepValue = keeper[field as keyof typeof keeper]; const sourceValue = source[field as keyof typeof source];
        return keepValue && sourceValue && keepValue !== sourceValue ? [{ field:label, keepValue:String(keepValue), sourceValue:String(sourceValue) }] : [];
      });
      const addressKeys = Object.keys(postalAddressLimits) as Array<keyof PostalAddress>;
      const formatAddress = (address: PostalAddress) => addressKeys.map((key) => address[key]).filter(Boolean).join(", ");
      if (Object.keys(keeper.postalAddress).length && Object.keys(source.postalAddress).length
        && addressKeys.some((key) => keeper.postalAddress[key] !== source.postalAddress[key])) {
        profileConflicts.push({ field: "Postal address", keepValue: formatAddress(keeper.postalAddress), sourceValue: formatAddress(source.postalAddress) });
      }
      const customFieldConflicts = (await db.query<{ field: string; keeperValue: unknown; sourceValue: unknown }>(
        `SELECT field.label AS field,keeper.value AS "keeperValue",source.value AS "sourceValue"
           FROM people_record_values source JOIN people_record_values keeper
             ON keeper.department_id=source.department_id AND keeper.field_id=source.field_id AND keeper.contact_id=$2
           JOIN people_record_fields field ON field.id=source.field_id AND field.department_id=source.department_id
          WHERE source.department_id=$1 AND source.contact_id=$3 AND source.value IS DISTINCT FROM keeper.value
            AND ($4::boolean OR field.visibility='private_people')`, [departmentId, keeperId, sourceId, canManage],
      )).rows;
      const dateConflicts = (await db.query<{ kind: string; keeperValue: string; sourceValue: string }>(
        `SELECT source.date_kind AS kind,keeper.date_value::text AS "keeperValue",source.date_value::text AS "sourceValue"
           FROM people_record_person_dates source JOIN people_record_person_dates keeper
             ON keeper.department_id=source.department_id AND keeper.date_kind=source.date_kind AND keeper.contact_id=$2
          WHERE source.department_id=$1 AND source.contact_id=$3 AND source.date_value IS DISTINCT FROM keeper.date_value`, [departmentId, keeperId, sourceId],
      )).rows;
      const installed = await db.query<{ groups: boolean; groupAutoManaged: boolean; groupCustom: boolean; groupAttendance: boolean; eventCheckins: boolean; positionResponses: boolean; peopleFlows: boolean; memberships: boolean; serviceEvents: boolean; teamMembers: boolean }>(
        `SELECT to_regclass('public.group_members') IS NOT NULL AS groups,
                EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='group_members' AND column_name='auto_managed') AS "groupAutoManaged",
                to_regclass('public.group_membership_custom_fields') IS NOT NULL AS "groupCustom",
                to_regclass('public.group_meeting_attendance') IS NOT NULL AS "groupAttendance",
                to_regclass('public.event_attendance_checkins') IS NOT NULL AS "eventCheckins",
                to_regclass('public.event_position_responses') IS NOT NULL AS "positionResponses",
                to_regclass('public.people_flow_enrollments') IS NOT NULL AS "peopleFlows",
                to_regclass('public.department_memberships') IS NOT NULL AS memberships,
                to_regclass('public.service_events') IS NOT NULL AS "serviceEvents",
                to_regclass('public.team_members') IS NOT NULL AS "teamMembers"`,
      );
      const blockers: string[] = [];
      const attachmentCount = await db.query<{ count: number }>("SELECT count(*)::int AS count FROM people_record_attachments WHERE department_id=$1 AND contact_id=ANY($2::uuid[])", [departmentId, [keeperId, sourceId]]);
      if (attachmentCount.rows[0].count > maxPersonAttachments) blockers.push(`The combined profile would have more than ${maxPersonAttachments} attachments.`);
      const households = await db.query<{ count: number }>("SELECT count(DISTINCT household_id)::int AS count FROM people_record_household_members WHERE department_id=$1 AND contact_id=ANY($2::uuid[])", [departmentId, [keeperId, sourceId]]);
      if (households.rows[0].count > 1) blockers.push("These people belong to different households. Resolve the household memberships before merging.");
      if(source.sourceSystem||source.sourceId||source.elvantoSourceId)blockers.push("The source person is linked to a ChurchTools or Elvanto sync identity. Disconnect or reconcile that external identity before merging so the sync does not recreate the source record.");
      if (installed.rows[0]?.groups) {
        const automaticStatusDifference=installed.rows[0]?.groupAutoManaged?",CASE WHEN source.auto_managed IS DISTINCT FROM keeper.auto_managed THEN 'automatic status' END":"";
        const overlaps = await db.query<{ name: string; differences: string[] }>(
          `SELECT group_row.name,
                  array_remove(ARRAY[
                    CASE WHEN source.role IS DISTINCT FROM keeper.role THEN 'role' END,
                    CASE WHEN source.status IS DISTINCT FROM keeper.status THEN 'status' END,
                    CASE WHEN source.joined_on IS DISTINCT FROM keeper.joined_on THEN 'join date' END${automaticStatusDifference}
                  ],NULL) AS differences
             FROM group_members source JOIN group_members keeper ON keeper.group_id=source.group_id AND keeper.contact_id=$2
             JOIN church_groups group_row ON group_row.id=source.group_id AND group_row.department_id=$1
            WHERE source.contact_id=$3 ORDER BY group_row.name`, [departmentId, keeperId, sourceId],
        );
        for (const overlap of overlaps.rows) if (overlap.differences.length) blockers.push(`Both people belong to “${overlap.name}” with different ${overlap.differences.join(", ")}. Resolve this membership before merging.`);
      }
      if (installed.rows[0]?.teamMembers) {
        const overlap = await db.query<{ name: string }>(`SELECT team.name FROM team_members source JOIN team_members keeper ON keeper.team_id=source.team_id AND keeper.contact_id=$1 JOIN church_teams team ON team.id=source.team_id WHERE source.contact_id=$2 LIMIT 30`,[keeperId,sourceId]);
        for(const row of overlap.rows)blockers.push(`Both people belong to team “${row.name}”. Resolve the duplicate team membership before merging.`);
      }
      if (installed.rows[0]?.groupCustom) {
        const overlap = await db.query<{ name: string }>(
          `SELECT group_row.name FROM group_membership_custom_fields source JOIN group_membership_custom_fields keeper
             ON keeper.group_id=source.group_id AND keeper.contact_id=$2 AND keeper.department_id=source.department_id
           JOIN church_groups group_row ON group_row.id=source.group_id
          WHERE source.department_id=$1 AND source.contact_id=$3 AND source.custom_fields IS DISTINCT FROM keeper.custom_fields LIMIT 30`, [departmentId, keeperId, sourceId],
        );
        for (const row of overlap.rows) blockers.push(`Both people have different membership custom fields in “${row.name}”. Resolve these values before merging.`);
      }
      if (installed.rows[0]?.groupAttendance) {
        const overlap = await db.query<{ count: number }>("SELECT count(*)::int AS count FROM group_meeting_attendance source JOIN group_meeting_attendance keeper ON keeper.meeting_id=source.meeting_id AND keeper.contact_id=$2 WHERE source.contact_id=$3", [keeperId, sourceId]);
        if (overlap.rows[0].count) blockers.push("Both people have attendance records for the same group meeting. Resolve those duplicate attendance entries before merging.");
      }
      if (installed.rows[0]?.eventCheckins) {
        const overlap = await db.query<{ count: number }>("SELECT count(*)::int AS count FROM event_attendance_checkins source JOIN event_attendance_checkins keeper ON keeper.event_id=source.event_id AND keeper.contact_id=$2 WHERE source.contact_id=$3", [keeperId, sourceId]);
        if (overlap.rows[0].count) blockers.push("Both people have check-in records for the same event. Resolve those duplicate check-ins before merging.");
      }
      if (installed.rows[0]?.positionResponses) {
        const overlap = await db.query<{ count: number }>("SELECT count(*)::int AS count FROM event_position_responses source JOIN event_position_responses keeper ON keeper.event_id=source.event_id AND keeper.position_index=source.position_index AND keeper.contact_id=$2 WHERE source.contact_id=$3", [keeperId, sourceId]);
        if (overlap.rows[0].count) blockers.push("Both people responded to the same service role. Resolve the duplicate role responses before merging.");
      }
      if (installed.rows[0]?.serviceEvents) {
        const overlap = await db.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM service_events event
            WHERE event.department_id=$1 AND (
              SELECT count(*) FROM jsonb_array_elements(COALESCE(event.positions,'[]'::jsonb)) position(value)
               WHERE position.value->>'contactId'=ANY($2::text[])
            )>1`, [departmentId, [keeperId, sourceId]],
        );
        if (overlap.rows[0].count) blockers.push("Both people are assigned to multiple positions on the same service. Resolve those duplicate assignments before merging.");
      }
      if (installed.rows[0]?.peopleFlows) {
        const overlap = await db.query<{ count: number }>("SELECT count(*)::int AS count FROM people_flow_enrollments source JOIN people_flow_enrollments keeper ON keeper.department_id=source.department_id AND keeper.flow_id=source.flow_id AND keeper.contact_id=$2 AND keeper.status='active' WHERE source.department_id=$1 AND source.contact_id=$3 AND source.status='active'", [departmentId, keeperId, sourceId]);
        if (overlap.rows[0].count) blockers.push("Both people are actively enrolled in the same follow-up workflow. Resolve the duplicate enrollment before merging.");
      }
      if (installed.rows[0]?.memberships) {
        const overlap = await db.query<{ count: number }>("SELECT count(*)::int AS count FROM department_memberships source JOIN department_memberships keeper ON keeper.department_id=source.department_id AND keeper.user_id<>source.user_id AND keeper.contact_id=$2 WHERE source.department_id=$1 AND source.contact_id=$3", [departmentId, keeperId, sourceId]);
        if (overlap.rows[0].count) blockers.push("Both people are linked to different user accounts at this location. Resolve the account links before merging.");
      }
      return {
        keeper: { id: keeper.id, firstName: keeper.first_name, lastName: keeper.last_name, email: keeper.email, phone: keeper.phone, status: keeper.status },
        source: { id: source.id, firstName: source.first_name, lastName: source.last_name, email: source.email, phone: source.phone, status: source.status },
        profileConflicts, customFieldConflicts, dateConflicts, blockers,
      };
    }
    const defaultFieldTextMaxLength = 2000;
    const fieldTextMaxLengthError = "Enter a whole-number text limit from 1 to 2000.";
    function validFieldTextMaxLength(limit: unknown) {
      return limit === undefined || limit === null ||
        typeof limit === "number" && Number.isInteger(limit) && limit >= 1 && limit <= defaultFieldTextMaxLength;
    }

    function validFieldCategory(category: unknown) {
      return category === undefined || category === null ||
        typeof category === "string" && category.trim().length <= 60 && !/[\x00-\x1f\x7f]/u.test(category);
    }

    routes.post<{ Body: { fieldId: string; neighborId: string; direction: "up" | "down" } }>("/api/people-records/fields/reorder", {
      schema: { body: { type: "object", additionalProperties: false, required: ["fieldId", "neighborId", "direction"],
        properties: { fieldId: uuid, neighborId: uuid, direction: { type: "string", enum: ["up", "down"] } } } },
    }, async (request, reply) => {
      const departmentId = await department(request, reply, true);
      if (!departmentId) return reply;
      if (!validateMutation(request, reply)) return reply;
      const { fieldId, neighborId, direction } = request.body;
      const client = await pool!.connect();
      let committed = false;
      try {
        await client.query("BEGIN");
        if (!await context.lockDepartmentForWrite(client, departmentId)) {
          return reply.code(409).send({ error: "This location is currently read-only." });
        }
        // Lock definitions by immutable ID, then read their latest ordering after any wait.
        await client.query("SELECT id FROM people_record_fields WHERE department_id=$1 ORDER BY id FOR UPDATE", [departmentId]);
        const { rows } = await client.query<{ id: string; category: string | null }>(
          "SELECT id,category,position FROM people_record_fields WHERE department_id=$1 ORDER BY position,label,id",
          [departmentId],
        );
        const fieldIndex = rows.findIndex((row) => row.id === fieldId);
        const neighborIndex = rows.findIndex((row) => row.id === neighborId);
        if (fieldIndex < 0 || neighborIndex < 0) return reply.code(404).send({ error: "Custom field not found." });
        const category = rows[fieldIndex].category;
        const categoryRows = rows.filter((row) => row.category === category);
        const categoryIndex = categoryRows.findIndex((row) => row.id === fieldId);
        if (categoryRows[categoryIndex + (direction === "up" ? -1 : 1)]?.id !== neighborId) {
          return reply.code(409).send({ error: "The field order changed. Refresh the fields and try again." });
        }
        [rows[fieldIndex], rows[neighborIndex]] = [rows[neighborIndex], rows[fieldIndex]];
        await client.query(
          "UPDATE people_record_fields field SET position=ordered.position-1,updated_at=now() FROM unnest($2::uuid[]) WITH ORDINALITY AS ordered(id,position) WHERE field.department_id=$1 AND field.id=ordered.id AND field.position<>ordered.position-1",
          [departmentId, rows.map((row) => row.id)],
        );
        await client.query("COMMIT");
        committed = true;
      } finally {
        try { if (!committed) await client.query("ROLLBACK"); }
        finally { client.release(); }
      }
      changed(departmentId);
      return { ok: true };
    });
    routes.get("/api/people-records/fields", async (request, reply) => {
      const d = await department(request, reply); if (!d) return reply;
      const result = await pool!.query("SELECT id,label,field_key AS \"fieldKey\",field_type AS type,options,required,active,position,visibility,category,text_max_length AS \"textMaxLength\",tag_color AS \"tagColor\" FROM people_record_fields WHERE department_id=$1 AND ($2::boolean OR visibility='private_people') ORDER BY position,label,id", [d,canManagePeopleFields(request)]); return result.rows;
    });
    routes.post<{ Body: { label: string; fieldKey: string; type: "text"|"date"|"boolean"|"select"; options?: string[]; required?: boolean; visibility?: CustomFieldVisibility; category?: string | null; textMaxLength?: number | null } }>("/api/people-records/fields", async (request, reply) => {
      const d = await department(request, reply, true); if (!d) return reply; if (!validateMutation(request, reply)) return reply;
      const b = request.body; if (!b.label?.trim() || !/^[a-z][a-z0-9_]{0,39}$/.test(b.fieldKey) || !["text","date","boolean","select"].includes(b.type) || (b.type === "select" && (!Array.isArray(b.options) || b.options.length > 100))) return reply.code(400).send({ error: "Provide a valid field label, key, type, and options." });
      if (b.visibility !== undefined && !customFieldVisibilities.includes(b.visibility)) return reply.code(400).send({ error: "Choose a supported field visibility." });
      if (!validFieldCategory(b.category)) return reply.code(400).send({ error: "Enter a field category of up to 60 characters." });
      if (!validFieldTextMaxLength(b.textMaxLength)) return reply.code(400).send({ error: fieldTextMaxLengthError });
      if (b.textMaxLength != null && b.type !== "text") return reply.code(400).send({ error: "Only text fields accept a length limit." });
      const id = randomUUID(); try { await pool!.query("INSERT INTO people_record_fields(id,department_id,label,field_key,field_type,options,required,position,visibility,category,text_max_length) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,COALESCE((SELECT max(position)+1 FROM people_record_fields WHERE department_id=$2),0),$8,$9,$10)", [id,d,b.label.trim(),b.fieldKey,b.type,JSON.stringify(b.options ?? []),b.required ?? false,b.visibility ?? "private_people",b.category?.trim() || null,b.textMaxLength??null]); } catch { return reply.code(409).send({ error: "That field key is already in use at this location." }); }
      changed(d); return reply.code(201).send({ id });
    });
    type ChoiceOptionChange = { add: string } | { from: number; direction: "up" | "down" } | { from: number; rename: string };
    const optionChangeSchema = {
      type: "object", additionalProperties: false,
      properties: {
        add: { type: "string", minLength: 1, maxLength: 120 },
        rename: { type: "string", minLength: 1, maxLength: 120 },
        from: { type: "integer", minimum: 0, maximum: 99 },
        direction: { type: "string", enum: ["up", "down"] },
      },
      oneOf: [
        { required: ["add"], not: { anyOf: [{ required: ["from"] }, { required: ["direction"] }, { required: ["rename"] }] } },
        { required: ["from", "direction"], not: { anyOf: [{ required: ["add"] }, { required: ["rename"] }] } },
        { required: ["from", "rename"], not: { anyOf: [{ required: ["add"] }, { required: ["direction"] }] } },
      ],
    } as const;
    routes.patch<{ Params: { id: string }; Body: { expected: string[]; change: ChoiceOptionChange } }>("/api/people-records/fields/:id/options", {
      schema: {
        params: { type: "object", required: ["id"], properties: { id: uuid } },
        body: { type: "object", additionalProperties: false, required: ["expected", "change"],
          properties: { expected: { type: "array", maxItems: 100, items: { type: "string" } }, change: optionChangeSchema } },
      },
    }, async (request, reply) => {
      const departmentId = await department(request, reply, true);
      if (!departmentId || !validateMutation(request, reply)) return reply;
      const { expected, change } = request.body;
      const fieldId = request.params.id;
      const client = await pool!.connect();
      let committed = false;
      try {
        await client.query("BEGIN");
        await lockChoiceDefinitionWrite(client, departmentId);
        if (!await context.lockDepartmentForWrite(client, departmentId)) {
          return reply.code(409).send({ error: "This location cannot be changed on this installation." });
        }
        const { rows: [field] } = await client.query<{ options: unknown; field_key: string }>(
          "SELECT options,field_key FROM people_record_fields WHERE department_id=$1 AND id=$2 AND field_type='select' FOR UPDATE",
          [departmentId, fieldId],
        );
        if (!field) return reply.code(404).send({ error: "Choice field not found at this location." });
        if (!Array.isArray(field.options) || field.options.length !== expected.length ||
            field.options.some((option, index) => option !== expected[index])) {
          return reply.code(409).send({ error: "These options changed. Refresh before editing them again." });
        }
        const next = [...expected];
        if ("add" in change) {
          const option = change.add.trim();
          if (!option || next.includes(option) || next.length >= 100) {
            return reply.code(400).send({ error: "Enter a new non-empty option. A field can have up to 100 choices." });
          }
          next.push(option);
        } else if ("rename" in change) {
          const current = next[change.from];
          const option = change.rename.trim();
          if (current === undefined || !option || next.includes(option)) {
            return reply.code(400).send({ error: "Enter a new non-empty name for this choice." });
          }
          const plan = await inspectChoiceRename(client, {
            departmentId, fieldId, fieldKey: field.field_key, oldName: current, newName: option, options: expected,
          });
          if ("error" in plan) return reply.code(409).send({ error: plan.error });
          if (plan.profiles.length || plan.views.length) {
            return reply.code(409).send({ error: "This name is referenced by existing People records or saved views. Use the reviewed rename." });
          }
          next[change.from] = option;
        } else {
          const to = change.from + (change.direction === "up" ? -1 : 1);
          if (change.from >= next.length || to < 0 || to >= next.length) {
            return reply.code(400).send({ error: "That option cannot move in this direction." });
          }
          [next[change.from], next[to]] = [next[to], next[change.from]];
        }
        await client.query("UPDATE people_record_fields SET options=$3::jsonb,updated_at=now() WHERE department_id=$1 AND id=$2",
          [departmentId, fieldId, JSON.stringify(next)]);
        await client.query("COMMIT");
        committed = true;
        changed(departmentId);
        return { options: next };
      } finally {
        try { if (!committed) await client.query("ROLLBACK"); }
        finally { client.release(); }
      }
    });
    routes.post<{ Params: { id: string }; Body: { expected: string[]; from: number; rename: string; reviewToken?: string } }>(
      "/api/people-records/fields/:id/options/rename",
      { schema: {
        params: { type: "object", required: ["id"], properties: { id: uuid } },
        body: { type: "object", additionalProperties: false, required: ["expected", "from", "rename"], properties: {
          expected: { type: "array", minItems: 1, maxItems: 100, items: { type: "string" } },
          from: { type: "integer", minimum: 0, maximum: 99 },
          rename: { type: "string", minLength: 1, maxLength: 120 },
          reviewToken: { type: "string", pattern: "^[a-f0-9]{64}$" },
        } },
      } },
      async (request, reply) => {
        const departmentId = await department(request, reply, true);
        if (!departmentId || !validateMutation(request, reply)) return reply;
        const { expected, from, reviewToken } = request.body;
        const oldName = expected[from];
        const newName = request.body.rename.trim();
        if (oldName === undefined || !newName || expected.includes(newName) || expected.indexOf(oldName) !== expected.lastIndexOf(oldName)) {
          return reply.code(400).send({ error: "Choose a distinct option and enter a new non-empty name." });
        }
        const fieldId = request.params.id;
        let applied = false;
        const result = await withChoiceDefinitionWrite(pool!, departmentId, async (client) => {
          if (!await context.lockDepartmentForWrite(client, departmentId)) {
            return reply.code(409).send({ error: "This location cannot be changed on this installation." });
          }
          // Profile updates lock a contact before sharing the field definition.
          const contacts = reviewToken ? await lockChoiceRenameContacts(client, departmentId, fieldId, oldName) : null;
          const { rows: [field] } = await client.query<{ options: unknown; field_key: string }>(
            "SELECT options,field_key FROM people_record_fields WHERE department_id=$1 AND id=$2 AND field_type='select' FOR UPDATE",
            [departmentId, fieldId],
          );
          if (!field) return reply.code(404).send({ error: "Choice field not found at this location." });
          if (!Array.isArray(field.options) || field.options.length !== expected.length || field.options.some((option, index) => option !== expected[index])) {
            return reply.code(409).send({ error: "These options changed. Refresh before editing them again." });
          }
          const rename = { departmentId, fieldId, fieldKey: field.field_key, oldName, newName, options: expected };
          const plan = await inspectChoiceRename(client, rename, !!reviewToken);
          if ("error" in plan) return reply.code(409).send({ error: plan.error });
          const counts = {
            profiles: plan.profiles.length,
            archivedProfiles: plan.profiles.filter((person) => person.archived).length,
            savedViews: plan.views.length,
          };
          if (!reviewToken) return { ...counts, reviewToken: plan.reviewToken };
          if (plan.reviewToken !== reviewToken || plan.profiles.some((person) => !contacts?.has(person.id))) {
            return reply.code(409).send({ error: "The choice usage changed. Review the rename again before applying it." });
          }
          const options = [...expected];
          options[from] = newName;
          await applyChoiceRename(client, rename, plan, request.authenticatedUser?.id ?? null, options);
          applied = true;
          return { ...counts, options };
        });
        if (applied) changed(departmentId);
        return result;
      },
    );
    const tagColorSchema = { anyOf: [{ type: "string", pattern: "^#[0-9a-f]{6}$" }, { type: "null" }] } as const;
    const tagLabelSchema = { type: "string", minLength: 1, maxLength: 100 } as const;
    const tagPresentationSchema = { type: "object", additionalProperties: false, required: ["label", "color"], properties: {
      label: tagLabelSchema, color: tagColorSchema,
    } } as const;
    type TagPresentation = { label: string; color: string | null };
    routes.patch<{ Params: { fieldId: string }; Body: TagPresentation & { expected: TagPresentation } }>(
      "/api/people-records/tags/:fieldId",
      { schema: {
        params: { type: "object", required: ["fieldId"], properties: { fieldId: uuid } },
        body: { ...tagPresentationSchema, required: ["label", "color", "expected"],
          properties: { ...tagPresentationSchema.properties, expected: tagPresentationSchema } },
      } },
      async (request, reply) => {
        const d = await department(request, reply, true);
        if (!d || !validateMutation(request, reply)) return reply;
        const { color, expected } = request.body;
        const label = request.body.label.trim();
        if (!label) return reply.code(400).send({ error: "Enter a tag name." });
        const client = await pool!.connect();
        try {
          await client.query("BEGIN");
          if (!await context.lockDepartmentForWrite(client, d)) {
            await client.query("ROLLBACK");
            return reply.code(409).send({ error: "This location cannot be changed on this installation." });
          }
          const scope = "department_id=$1 AND id=$2 AND active AND field_type='boolean' AND NOT required AND field_key ~ '^tag_[a-z0-9_]+$'";
          const locked = await client.query<TagPresentation>(
            `SELECT label,tag_color AS color FROM people_record_fields WHERE ${scope} FOR UPDATE`, [d, request.params.fieldId],
          );
          const current = locked.rows[0];
          if (!current) {
            await client.query("ROLLBACK");
            return reply.code(404).send({ error: "Active person tag not found at this location." });
          }
          if (current.label !== expected.label || current.color !== expected.color) {
            await client.query("ROLLBACK");
            return reply.code(409).send({ error: "The tag changed. Refresh before editing it again." });
          }
          if (current.label !== label || current.color !== color) {
            await client.query(
              "UPDATE people_record_fields SET label=$3,tag_color=$4,updated_at=now() WHERE department_id=$1 AND id=$2",
              [d, request.params.fieldId, label, color],
            );
          }
          await client.query("COMMIT");
          if (current.label !== label || current.color !== color) changed(d);
          return { label, color };
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      },
    );
    const profileFieldPresets = {
      nickname: { label: "Nickname", type: "text", options: [] },
      first_contact_date: { label: "First contact date", type: "date", options: [] },
      nationality: { label: "Nationality", type: "text", options: [] },
      marital_status: { label: "Marital status", type: "select", options: ["Single", "Married", "Registered partnership", "Separated", "Divorced", "Widowed", "Other"] },
    } as const;
    routes.post<{ Body: { key: keyof typeof profileFieldPresets } }>("/api/people-records/fields/preset", {
      schema: { body: { type: "object", additionalProperties: false, required: ["key"], properties: {
        key: { type: "string", enum: Object.keys(profileFieldPresets) },
      } } },
    }, async (request, reply) => {
      const d = await department(request, reply, true); if (!d) return reply;
      if (!validateMutation(request, reply)) return reply;
      const { key } = request.body;
      const preset = profileFieldPresets[key];
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        if (!await context.lockDepartmentForWrite(client, d)) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "This location cannot be changed on this installation." });
        }
        const created = await client.query<{ id: string }>(
          `INSERT INTO people_record_fields(id,department_id,label,field_key,field_type,options,position)
           VALUES($1,$2,$3,$4,$5,$6::jsonb,COALESCE((SELECT max(position)+1 FROM people_record_fields WHERE department_id=$2),0))
           ON CONFLICT(department_id,field_key) DO NOTHING RETURNING id`,
          [randomUUID(), d, preset.label, key, preset.type, JSON.stringify(preset.options)],
        );
        await client.query("COMMIT");
        if (!created.rows[0]) return reply.code(409).send({ error: "That field key is already in use at this location." });
        changed(d);
        return reply.code(201).send(created.rows[0]);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    });
    routes.patch<{ Params: { id: string }; Body: { label?: string; options?: string[]; required?: boolean; active?: boolean; visibility?: CustomFieldVisibility; category?: string | null; textMaxLength?: number | null } }>("/api/people-records/fields/:id", { schema: { params: { type:"object", required:["id"], properties:{id:uuid} } } }, async (request, reply) => {
      const d=await department(request,reply,true); if(!d)return reply; if(!validateMutation(request,reply))return reply;
      if (request.body.visibility !== undefined && !customFieldVisibilities.includes(request.body.visibility)) return reply.code(400).send({ error: "Choose a supported field visibility." });
      if (!validFieldCategory(request.body.category)) return reply.code(400).send({ error: "Enter a field category of up to 60 characters." });
      if (!validFieldTextMaxLength(request.body.textMaxLength)) return reply.code(400).send({ error: fieldTextMaxLengthError });
      if (request.body.textMaxLength != null) {
        const field = await pool!.query<{ field_type: string }>("SELECT field_type FROM people_record_fields WHERE department_id=$1 AND id=$2", [d, request.params.id]);
        if (!field.rowCount) return reply.code(404).send({ error: "Custom field not found." });
        if (field.rows[0].field_type !== "text") return reply.code(400).send({ error: "Only text fields accept a length limit." });
      }
      const r=await pool!.query("UPDATE people_record_fields SET label=COALESCE($3,label),options=COALESCE($4::jsonb,options),required=COALESCE($5,required),active=COALESCE($6,active),visibility=COALESCE($7,visibility),category=CASE WHEN $8::boolean THEN $9::text ELSE category END,text_max_length=CASE WHEN $10::boolean THEN $11::integer ELSE text_max_length END,updated_at=now() WHERE department_id=$1 AND id=$2 RETURNING id",[d,request.params.id,request.body.label?.trim()||null,request.body.options===undefined?null:JSON.stringify(request.body.options),request.body.required??null,request.body.active??null,request.body.visibility??null,request.body.category!==undefined,request.body.category?.trim()||null,request.body.textMaxLength!==undefined,request.body.textMaxLength??null]); if(!r.rowCount)return reply.code(404).send({error:"Custom field not found."}); changed(d); return {ok:true};
    });
    // Group lifecycle is supplied by the optional Community module. Older groups are active by default.
    const activeDirectoryGroup = "COALESCE(to_jsonb(g)->>'status','active')='active'";
    const activeGroupMembershipFilter = `(($6::uuid IS NULL AND $7::text IS NULL AND $8::text IS NULL AND $11::date IS NULL AND $12::date IS NULL) OR EXISTS (
      SELECT 1 FROM group_members membership JOIN church_groups g ON g.id=membership.group_id
      WHERE membership.contact_id=c.id AND membership.status='active'
        AND ($6::uuid IS NULL OR g.id=$6) AND ($7::text IS NULL OR (to_jsonb(g)->>'group_type')=$7)
        AND ($8::text IS NULL OR lower(btrim(membership.role))=lower(btrim($8)))
        AND ($11::date IS NULL OR membership.joined_on >= $11) AND ($12::date IS NULL OR membership.joined_on <= $12)
        AND g.department_id=c.department_id AND ${activeDirectoryGroup}
    ))`;

    const formerGroupMembership = (filter: string | null) => filter ? `(
      c.id IN (
        SELECT h.entity_id FROM group_hierarchy_history h
        WHERE h.department_id=$1 AND h.group_id=$13::uuid AND h.entity_kind='membership'
          AND h.action='deleted' AND h.before_data->>'status'='active'
      ) AND NOT EXISTS (
        SELECT 1 FROM group_members current_member WHERE current_member.group_id=$13::uuid AND current_member.contact_id=c.id
      )
    )` : "$13::uuid IS NULL";

    async function groupHistoryAvailable() {
      const result = await pool!.query<{ installed: boolean }>("SELECT to_regclass('public.group_hierarchy_history') IS NOT NULL AS installed");
      return result.rows[0]?.installed === true;
    }

    async function canFilterFormerGroup(request: FastifyRequest, reply: FastifyReply, departmentId: string, groupId?: string | null) {
      if (!groupId) return true;
      if (!await groupHistoryAvailable()) {
        reply.code(409).send({ error: "Group membership history is unavailable at this location." }); return false;
      }
      const allowed = await pool!.query(
        `SELECT 1 FROM (${accessiblePeopleGroups(2, 3)}) groups WHERE id=$4`,
        [departmentId, canManageMembershipHistory(request), request.authenticatedUser!.id, groupId],
      );
      if (!allowed.rowCount) {
        reply.code(403).send({ error: "You do not have access to this group's membership history." }); return false;
      }
      return true;
    }

    routes.get("/api/people-records/directory-history-groups", async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      reply.header("Cache-Control", "private, no-store");
      if (!await groupHistoryAvailable()) return { groups: [] };
      const groups = await pool!.query(
        `SELECT id,name,status FROM (${accessiblePeopleGroups(2, 3)}) allowed ORDER BY lower(name),id`,
        [departmentId, canManageMembershipHistory(request), request.authenticatedUser!.id],
      );
      return { groups: groups.rows };
    });

    routes.get("/api/people-records/directory-groups", async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const groups = await pool!.query<{id:string;name:string;groupType:string|null;isLocal:boolean}>(
        `SELECT g.id,g.name,(to_jsonb(g)->>'group_type') AS "groupType",
                COALESCE(to_jsonb(g)->>'source_system','') NOT IN ('churchtools','elvanto') AS "isLocal"
             FROM church_groups g WHERE g.department_id=$1 AND ${activeDirectoryGroup} ORDER BY lower(g.name),g.id`, [departmentId],
      );
      return groups.rows;
    });
    registerGroupMembershipImport(routes, context, department, activeDirectoryGroup);
    type MembershipStatus = "active" | "paused" | "waitlist";
    routes.post<{ Body: { groupId: string; contactIds: string[]; role: string; status: MembershipStatus; operation?: "add" | "update" } }>("/api/people-records/bulk-group-membership", {
      schema: { body: { type: "object", additionalProperties: false, required: ["groupId", "contactIds", "role", "status"], properties: {
        operation: { type: "string", enum: ["add", "update"] },
        groupId: uuid,
        contactIds: { type: "array", minItems: 1, maxItems: 100, uniqueItems: true, items: uuid },
        role: { type: "string", minLength: 1, maxLength: 80 },
        status: { type: "string", enum: ["active", "paused", "waitlist"] },
      } } },
    }, async (request, reply) => {
      const departmentId = await department(request, reply, true);
      if (!departmentId || !validateMutation(request, reply)) return reply;
      if (request.activeDepartmentRole !== "site_admin" && !(request.activeDepartmentPermissions ?? []).includes("groups_manage")) {
        return reply.code(403).send({ error: "You need group management permission to change memberships." });
      }
      const { groupId, status, operation = "add" } = request.body;
      const role = request.body.role.trim();
      const contactIds = [...new Set(request.body.contactIds.map(id => id.toLowerCase()))].sort();
      if (!role) return reply.code(400).send({ error: "Enter a group role." });
      const client = await pool!.connect();
      let changedCount = 0;
      try {
        await client.query("BEGIN");
        if (!await context.lockDepartmentForWrite(client, departmentId)) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "This location is not available for writing." });
        }
        const group = await client.query<{ sourceSystem: string | null }>(
          `SELECT to_jsonb(g)->>'source_system' AS "sourceSystem" FROM church_groups g
            WHERE g.id=$1 AND g.department_id=$2 AND ${activeDirectoryGroup} FOR UPDATE`, [groupId, departmentId],
        );
        if (!group.rowCount || ["churchtools", "elvanto"].includes(group.rows[0].sourceSystem ?? "")) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "Choose an active local group." });
        }
        const people = await client.query(
          "SELECT id FROM contacts WHERE department_id=$1 AND archived_at IS NULL AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE",
          [departmentId, contactIds],
        );
        if (people.rowCount !== contactIds.length) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "Some selected people are no longer active in this location. Refresh the directory and try again." });
        }
        await client.query("SELECT set_config('smart_church.actor_id',$1,true),set_config('smart_church.department_id',$2,true)", [request.authenticatedUser!.id, departmentId]);
        const result = operation === "update" ? await client.query(
          "UPDATE group_members SET role=$3,status=$4 WHERE group_id=$1 AND contact_id=ANY($2::uuid[]) AND (role IS DISTINCT FROM $3 OR status IS DISTINCT FROM $4)",
          [groupId, contactIds, role, status],
        ) : await client.query(
          `INSERT INTO group_members(group_id,contact_id,role,status,joined_on)
           SELECT $1,person_id,$3,$4,CURRENT_DATE FROM unnest($2::uuid[]) AS selected(person_id)
           ON CONFLICT (group_id,contact_id) DO NOTHING`,
          [groupId, contactIds, role, status],
        );
        changedCount = result.rowCount ?? 0;
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      if (changedCount) {
        changed(departmentId);
        realtime.publish("core:groups:changed", departmentId, { groupId, action: operation === "update" ? "membership-bulk-updated" : "membership-bulk-assigned" });
      }
      return operation === "update"
        ? { updated: changedCount, unchanged: contactIds.length - changedCount }
        : { added: changedCount, unchanged: contactIds.length - changedCount };
    });
    routes.get<{ Querystring: { q?: string; status?: string; field?: string; value?: string; filters?:string;relationshipFilters?:string;groupRole?:string;groupType?:string;groupId?:string;groupJoinedFrom?:string;groupJoinedThrough?:string;formerGroupId?:string;attendedMeetingId?:string;sort?:DirectorySort;archived?:boolean;includeStatistics?:boolean;page?:number;pageSize?:number } }>("/api/people-records/directory",{schema:{querystring:{type:"object",additionalProperties:false,properties:{q:{type:"string",maxLength:120},status:{type:"string",enum:["member","visitor"]},field:{type:"string",pattern:"^[a-z][a-z0-9_]{0,39}$"},value:{type:"string",maxLength:200},filters:{type:"string",maxLength:3000},relationshipFilters:{type:"string",maxLength:2000},groupRole:{type:"string",minLength:1,maxLength:80},groupType:{type:"string",minLength:1,maxLength:120},groupId:uuid,groupJoinedFrom:membershipJoinDate,groupJoinedThrough:membershipJoinDate,formerGroupId:uuid,attendedMeetingId:uuid,sort:directorySortSchema,archived:{type:"boolean"},includeStatistics:{type:"boolean"},page:{type:"integer",minimum:1,maximum:2147483647},pageSize:{type:"integer",minimum:1,maximum:500}}}}}, async (request, reply) => {
      const d=await department(request,reply); if(!d)return reply; if(!await canFilterFormerGroup(request,reply,d,request.query.formerGroupId))return reply; if(!await canFilterAttendedMeeting(request,reply,d,request.query.attendedMeetingId))return reply; const joinError=membershipJoinRangeError(request.query); if(joinError)return reply.code(400).send({error:joinError}); const {q="",status}=request.query;
      let fieldJson:string|null=null;
      try{const filters=parseFieldFilters(request.query.filters,request.query.field,request.query.value);if(filters.length)fieldJson=JSON.stringify(await validateFieldFilters(d,filters,canManagePeopleFields(request)))}catch(error){return reply.code(400).send({error:error instanceof Error?error.message:"Choose valid custom field filters."})} let relationshipJson:string|null=null;try{const filters=await validateRelationshipFilters(d,parseRelationshipFilters(request.query.relationshipFilters),canManagePeopleFields(request));if(filters.length)relationshipJson=JSON.stringify(filters)}catch(error){return reply.code(400).send({error:error instanceof Error?error.message:"Choose valid relationship filters."})}
      const match = `c.department_id=$1 AND (c.archived_at IS NOT NULL)=$9::boolean AND ${directoryTextMatch} AND ($3::text IS NULL OR c.status=$3)
        AND ($4::jsonb IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements($4::jsonb) requested WHERE NOT EXISTS(SELECT 1 FROM people_record_values v JOIN people_record_fields f ON f.id=v.field_id AND f.department_id=v.department_id WHERE v.department_id=c.department_id AND v.contact_id=c.id AND f.field_key=requested->>'field' AND f.active=true AND ($10::boolean OR f.visibility='private_people') AND CASE WHEN f.field_type='text' AND requested->>'operator'='contains' THEN (v.value #>> '{}') ILIKE '%'||(requested->>'value')||'%' WHEN f.field_type='date' AND requested->>'operator'='before' THEN (v.value #>> '{}') < (requested->>'value') WHEN f.field_type='date' AND requested->>'operator'='after' THEN (v.value #>> '{}') > (requested->>'value') WHEN f.field_type='date' AND requested->>'operator'='on' THEN (v.value #>> '{}') = (requested->>'value') WHEN f.field_type='date' AND requested->>'operator'='last_7_days' THEN (v.value #>> '{}') >= to_char(CURRENT_DATE-6,'YYYY-MM-DD') AND (v.value #>> '{}') <= to_char(CURRENT_DATE,'YYYY-MM-DD') WHEN f.field_type='date' AND requested->>'operator'='last_30_days' THEN (v.value #>> '{}') >= to_char(CURRENT_DATE-29,'YYYY-MM-DD') AND (v.value #>> '{}') <= to_char(CURRENT_DATE,'YYYY-MM-DD') WHEN f.field_type='date' AND requested->>'operator'='last_90_days' THEN (v.value #>> '{}') >= to_char(CURRENT_DATE-89,'YYYY-MM-DD') AND (v.value #>> '{}') <= to_char(CURRENT_DATE,'YYYY-MM-DD') WHEN f.field_type='date' AND requested->>'operator'='next_7_days' THEN (v.value #>> '{}') > to_char(CURRENT_DATE,'YYYY-MM-DD') AND (v.value #>> '{}') <= to_char(CURRENT_DATE+7,'YYYY-MM-DD') WHEN f.field_type='date' AND requested->>'operator'='next_30_days' THEN (v.value #>> '{}') > to_char(CURRENT_DATE,'YYYY-MM-DD') AND (v.value #>> '{}') <= to_char(CURRENT_DATE+30,'YYYY-MM-DD') WHEN f.field_type='date' AND requested->>'operator'='next_90_days' THEN (v.value #>> '{}') > to_char(CURRENT_DATE,'YYYY-MM-DD') AND (v.value #>> '{}') <= to_char(CURRENT_DATE+90,'YYYY-MM-DD') ELSE v.value=requested->'value' END))) AND ($5::jsonb IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements($5::jsonb) requested WHERE (requested->>'exclude')::boolean=EXISTS(SELECT 1 FROM people_record_relationships relation WHERE relation.department_id=c.department_id AND (relation.person_id=c.id OR relation.related_person_id=c.id) AND ((requested ? 'relationshipTypeId' AND relation.relationship_type_id=(requested->>'relationshipTypeId')::uuid
          AND ($10::boolean OR EXISTS (SELECT 1 FROM people_record_relationship_types kind WHERE kind.department_id=relation.department_id
            AND kind.id=relation.relationship_type_id AND kind.visibility='private_people'))) OR (requested ? 'legacyRelationship' AND relation.relationship_type_id IS NULL AND lower(btrim(relation.relationship))=lower(btrim(requested->>'legacyRelationship'))))))) AND ${activeGroupMembershipFilter} AND ${formerGroupMembership(request.query.formerGroupId??null)} AND ${presentMeetingFilter(request.query.attendedMeetingId)}`;
      const values = [d,q,status??null,fieldJson,relationshipJson,request.query.groupId??null,request.query.groupType??null,request.query.groupRole?.trim()||null,request.query.archived??false,canManagePeopleFields(request),request.query.groupJoinedFrom??null,request.query.groupJoinedThrough??null,request.query.formerGroupId??null,request.query.attendedMeetingId??null];
      const selection = `SELECT c.id,c.first_name AS "firstName",c.last_name AS "lastName",c.email,c.phone,c.status,c.postal_address AS "postalAddress",c.archived_at AS "archivedAt",
        COALESCE((SELECT jsonb_object_agg(f.field_key,v.value) FROM people_record_values v JOIN people_record_fields f ON f.id=v.field_id AND f.department_id=v.department_id WHERE v.department_id=c.department_id AND v.contact_id=c.id AND f.active AND ($10::boolean OR f.visibility='private_people')), '{}'::jsonb) AS fields`;
      const order = directoryOrder(request.query.sort);
      const page = request.query.page ?? 1;
      const pageSize = request.query.pageSize ?? 500;
      const pageValues = [...values, pageSize, (page - 1) * pageSize];
      if (request.query.includeStatistics) {
        // The aggregate and page use the same filtered contacts in a single snapshot.
        const outputOrder = order.replaceAll("c.first_name", 'people."firstName"').replaceAll("c.last_name", 'people."lastName"').replaceAll("c.", "people.");
        const result = await pool!.query(`WITH matched AS (SELECT c.* FROM contacts c WHERE ${match})
          SELECT (SELECT COALESCE(jsonb_agg(to_jsonb(people) ORDER BY ${outputOrder}), '[]'::jsonb)
                  FROM (${selection} FROM matched c ORDER BY ${order} LIMIT $15 OFFSET $16) people) AS people,
                 (SELECT jsonb_build_object('total',count(*),
                    'members',count(*) FILTER (WHERE status='member'),
                    'visitors',count(*) FILTER (WHERE status='visitor'),
                    'withEmail',count(*) FILTER (WHERE NULLIF(btrim(email),'') IS NOT NULL),
                    'withPhone',count(*) FILTER (WHERE NULLIF(btrim(phone),'') IS NOT NULL))
                  FROM matched) AS statistics`, pageValues);
        return result.rows[0];
      }
      const result = await pool!.query(`${selection} FROM contacts c WHERE ${match} ORDER BY ${order} LIMIT $15 OFFSET $16`, pageValues);
      return result.rows;
    });
    async function updateArchiveState(departmentId: string, contactIds: string[], archived: boolean, actorId: string | null) {
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        if (!await context.lockDepartmentForWrite(client, departmentId)) {
          await client.query("ROLLBACK");
          return { kind: "readonly" } as const;
        }
        const current = await client.query<{ id: string }>(
          "SELECT id FROM contacts WHERE department_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE",
          [departmentId, contactIds],
        );
        if (current.rows.length !== contactIds.length) {
          await client.query("ROLLBACK");
          return { kind: "missing" } as const;
        }
        const updated = await client.query<{ id: string }>(
          `UPDATE contacts SET archived_at=CASE WHEN $3::boolean THEN now() ELSE NULL END
            WHERE department_id=$1 AND id=ANY($2::uuid[]) AND (archived_at IS NOT NULL) <> $3::boolean RETURNING id`,
          [departmentId, contactIds, archived],
        );
        for (const { id } of updated.rows) {
          await client.query(
            "INSERT INTO people_record_history(id,department_id,contact_id,actor_user_id,action,subject,before_value,after_value) VALUES($1,$2,$3,$4,$5,'archive',$6::jsonb,$7::jsonb)",
            [randomUUID(), departmentId, id, actorId, archived ? "person_archived" : "person_restored", JSON.stringify(!archived), JSON.stringify(archived)],
          );
        }
        await client.query("COMMIT");
        return { kind: "updated", count: updated.rows.length } as const;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    routes.put<{ Params: { contactId: string }; Body: { archived: boolean } }>("/api/people-records/:contactId/archive", {
      schema: {
        params: { type: "object", required: ["contactId"], properties: { contactId: uuid } },
        body: { type: "object", additionalProperties: false, required: ["archived"], properties: { archived: { type: "boolean" } } },
      },
    }, async (request, reply) => {
      const departmentId = await department(request, reply, true);
      if (!departmentId || !validateMutation(request, reply)) return reply;
      const { contactId } = request.params;
      const { archived } = request.body;
      const result = await updateArchiveState(departmentId, [contactId], archived, request.authenticatedUser?.id ?? null);
      if (result.kind === "readonly") return reply.code(409).send({ error: "This location is read-only." });
      if (result.kind === "missing") return reply.code(404).send({ error: "Person not found at this location." });
      if (result.count) {
        changed(departmentId, contactId);
        realtime.publish("core:contacts:changed", departmentId, { contactId });
      }
      return { archived };
    });

    routes.post<{ Body: { contactIds: string[]; archived: boolean } }>("/api/people-records/bulk-archive", {
      schema: {
        body: { type: "object", additionalProperties: false, required: ["contactIds", "archived"], properties: {
          contactIds: { type: "array", minItems: 1, maxItems: 500, uniqueItems: true, items: uuid },
          archived: { type: "boolean" },
        } },
      },
    }, async (request, reply) => {
      const departmentId = await department(request, reply, true);
      if (!departmentId || !validateMutation(request, reply)) return reply;
      const { contactIds, archived } = request.body;
      if (new Set(contactIds.map(id => id.toLowerCase())).size !== contactIds.length) {
        return reply.code(400).send({ error: "Select each person only once." });
      }
      const result = await updateArchiveState(departmentId, contactIds, archived, request.authenticatedUser?.id ?? null);
      if (result.kind === "readonly") return reply.code(409).send({ error: "This location is read-only." });
      if (result.kind === "missing") return reply.code(404).send({ error: "One or more selected people were not found at this location." });
      if (result.count) {
        changed(departmentId);
        realtime.publish("core:contacts:changed", departmentId, {});
      }
      return { archived, updated: result.count };
    });
    routes.get<{ Params: { contactId: string } }>("/api/people-records/:contactId", { schema: { params: { type: "object", additionalProperties: false, required: ["contactId"], properties: { contactId: uuid } } } }, async (request, reply) => {
      const d = await department(request, reply); if (!d) return reply;
      const result = await pool!.query(`SELECT c.id,c.first_name AS "firstName",c.last_name AS "lastName",c.email,c.phone,c.status,c.postal_address AS "postalAddress",c.archived_at AS "archivedAt",
        COALESCE((SELECT jsonb_object_agg(f.field_key,v.value) FROM people_record_values v JOIN people_record_fields f ON f.id=v.field_id AND f.department_id=v.department_id WHERE v.department_id=c.department_id AND v.contact_id=c.id AND f.active AND ($3::boolean OR f.visibility='private_people')), '{}'::jsonb) AS fields
        FROM contacts c WHERE c.department_id=$1 AND c.id=$2`, [d, request.params.contactId, canManagePeopleFields(request)]);
      if (!result.rowCount) return reply.code(404).send({ error: "Person not found at this location." });
      return result.rows[0];
    });
    const savedViewAllowed = (manageParameter: "$3" | "$6") => `(${manageParameter}::boolean OR NOT EXISTS (
      SELECT 1 FROM people_record_fields field
       WHERE field.department_id=people_record_saved_views.department_id AND field.visibility='people_managers'
         AND (field.field_key=criteria->>'field' OR (criteria->'columns') ? ('custom:'||field.field_key)
           OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(criteria->'filters')='array' THEN criteria->'filters' ELSE '[]'::jsonb END) filter
                       WHERE filter->>'field'=field.field_key))
    )) AND (${manageParameter}::boolean OR NOT EXISTS (
      SELECT 1 FROM people_record_relationship_types kind
       WHERE kind.department_id=people_record_saved_views.department_id AND kind.visibility='people_managers'
         AND EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(criteria->'relationshipFilters')='array'
                       THEN criteria->'relationshipFilters' ELSE '[]'::jsonb END) filter
                     WHERE lower(filter->>'relationshipTypeId')=kind.id::text)
    ))`;
    routes.get("/api/people-records/saved-views", async (request, reply) => {
      const d=await department(request,reply); if(!d)return reply;
      const rows=await pool!.query(`SELECT id,name,criteria->>'q' AS q,criteria->>'status' AS status,criteria->>'field' AS field,criteria->>'value' AS value,criteria->'filters' AS filters,criteria->'relationshipFilters' AS "relationshipFilters",criteria->>'groupId' AS "groupId",criteria->>'groupType' AS "groupType",criteria->>'groupRole' AS "groupRole",criteria->>'groupJoinedFrom' AS "groupJoinedFrom",criteria->>'groupJoinedThrough' AS "groupJoinedThrough",criteria->>'formerGroupId' AS "formerGroupId",criteria->>'attendedMeetingId' AS "attendedMeetingId",criteria->>'sort' AS sort,COALESCE(criteria->>'layout','cards') AS layout,COALESCE(criteria->'pageSize','100'::jsonb) AS "pageSize",criteria->'columns' AS columns,created_at AS "createdAt",updated_at AS "updatedAt"
        FROM people_record_saved_views WHERE department_id=$1 AND user_id=$2 AND ${savedViewAllowed("$3")} ORDER BY lower(name),id`,[d,request.authenticatedUser!.id,canManagePeopleFields(request)]);
      return rows.rows;
    });
    type SavedViewBody={name:string;q?:string;status?:"member"|"visitor"|"";field?:string;value?:string;filters?:FieldFilterInput[];relationshipFilters?:RelationshipFilterInput[];groupRole?:string|null;groupType?:string|null;groupId?:string|null;formerGroupId?:string|null;attendedMeetingId?:string|null;sort?:DirectorySort;layout?:"table"|"cards";pageSize?:10|25|50|100|200|"all";columns?:string[]}&MembershipJoinRange;
    const savedViewSchema={body:{type:"object",additionalProperties:false,required:["name"],properties:{name:{type:"string",minLength:1,maxLength:80},q:{type:"string",maxLength:120},status:{type:"string",enum:["","member","visitor"]},field:{type:"string",pattern:"^[a-z][a-z0-9_]{0,39}$"},value:{type:"string",maxLength:200},filters:{type:"array",maxItems:10,items:{type:"object",additionalProperties:false,required:["field","value"],properties:{field:{type:"string",pattern:"^[a-z][a-z0-9_]{0,39}$"},value:{type:"string",maxLength:200},operator:{type:"string",enum:["equals","contains","before","after","on","last_7_days","last_30_days","last_90_days","next_7_days","next_30_days","next_90_days"]}}}},relationshipFilters:{type:"array",maxItems:10,items:{type:"object",additionalProperties:false,required:["exclude"],properties:{relationshipTypeId:uuid,legacyRelationship:{type:"string",minLength:1,maxLength:60},exclude:{type:"boolean"}},anyOf:[{required:["relationshipTypeId"]},{required:["legacyRelationship"]}]}},groupRole:{anyOf:[{type:"string",minLength:1,maxLength:80},{type:"null"}]},groupType:{anyOf:[{type:"string",minLength:1,maxLength:120},{type:"null"}]},groupId:{anyOf:[uuid,{type:"null"}]},groupJoinedFrom:{anyOf:[membershipJoinDate,{type:"null"}]},groupJoinedThrough:{anyOf:[membershipJoinDate,{type:"null"}]},formerGroupId:{anyOf:[uuid,{type:"null"}]},attendedMeetingId:{anyOf:[uuid,{type:"null"}]},sort:directorySortSchema,layout:{type:"string",enum:["table","cards"]},pageSize:{anyOf:[{type:"integer",enum:[10,25,50,100,200]},{type:"string",enum:["all"]}]},columns:{type:"array",minItems:1,maxItems:20,uniqueItems:true,items:{type:"string",maxLength:48}}}}};
    async function writeSavedView(request:FastifyRequest<{Body:SavedViewBody}>,reply:FastifyReply,id?:string){
      const d=await department(request,reply); if(!d)return reply;
      if(!validateMutation(request,reply))return reply;
      const name=request.body.name.trim(); if(!name)return reply.code(400).send({error:"Enter a name for this saved view."});
      return withChoiceDefinitionWrite(pool!, d, async (client) => {
        const updating=id!==undefined;
        const renameOnly=updating&&Object.keys(request.body).length===1;
        let criteria:string|null=null;
        if(!renameOnly){
          const body=request.body;
          if(!await canFilterFormerGroup(request,reply,d,body.formerGroupId))return reply;
          if(!await canFilterAttendedMeeting(request,reply,d,body.attendedMeetingId))return reply;
          const joinError=membershipJoinRangeError(body);
          if(joinError)return reply.code(400).send({error:joinError});
          try{
            let filters=parseFieldFilters(body.filters===undefined?undefined:JSON.stringify(body.filters),body.field,body.value);
            const normalized=await validateFieldFilters(d,filters,canManagePeopleFields(request),client);
            filters=filters.map((item,index)=>({...item,operator:normalized[index].operator}));
            const relationshipFilters=await validateRelationshipFilters(d,body.relationshipFilters??[],canManagePeopleFields(request));
            const columns=await validateDirectoryColumns(d,body.columns,canManagePeopleFields(request));
            if(body.groupId){
              const group=await pool!.query("SELECT id FROM church_groups g WHERE g.department_id=$1 AND g.id=$2 AND "+activeDirectoryGroup,[d,body.groupId]);
              if(!group.rowCount)throw new Error("Choose an active group at this location.");
            }
            criteria=JSON.stringify({
              q:body.q?.trim()??"",status:body.status??"",
              field:filters.length===1?filters[0].field:"",value:filters.length===1?filters[0].value:"",
              filters,relationshipFilters,groupId:body.groupId??null,groupType:body.groupType??null,
              groupRole:body.groupRole?.trim()||null,groupJoinedFrom:body.groupJoinedFrom??null,
              groupJoinedThrough:body.groupJoinedThrough??null,formerGroupId:body.formerGroupId??null,attendedMeetingId:body.attendedMeetingId??null,sort:body.sort??"lastName",layout:body.layout??"cards",pageSize:body.pageSize??100,columns,
            });
          }catch(error){
            return reply.code(400).send({error:error instanceof Error?error.message:"Choose valid saved view options."});
          }
        }
        try{
          const values=[id??randomUUID(),d,request.authenticatedUser!.id,name,criteria];
          const statement=updating
            ? `UPDATE people_record_saved_views SET name=$4,criteria=COALESCE($5::jsonb,criteria),updated_at=now()
                WHERE id=$1 AND department_id=$2 AND user_id=$3 AND ($5::jsonb IS NOT NULL OR ${savedViewAllowed("$6")})`
            : "INSERT INTO people_record_saved_views(id,department_id,user_id,name,criteria) VALUES($1,$2,$3,$4,$5::jsonb)";
          const result=await client.query(`${statement} RETURNING id,name,criteria->>'q' AS q,criteria->>'status' AS status,criteria->>'field' AS field,criteria->>'value' AS value,criteria->'filters' AS filters,criteria->'relationshipFilters' AS "relationshipFilters",criteria->>'groupId' AS "groupId",criteria->>'groupType' AS "groupType",criteria->>'groupRole' AS "groupRole",criteria->>'groupJoinedFrom' AS "groupJoinedFrom",criteria->>'groupJoinedThrough' AS "groupJoinedThrough",criteria->>'formerGroupId' AS "formerGroupId",criteria->>'attendedMeetingId' AS "attendedMeetingId",criteria->>'sort' AS sort,COALESCE(criteria->>'layout','cards') AS layout,COALESCE(criteria->'pageSize','100'::jsonb) AS "pageSize",criteria->'columns' AS columns,created_at AS "createdAt",updated_at AS "updatedAt"`,updating?[...values,canManagePeopleFields(request)]:values);
          if(!result.rowCount)return reply.code(404).send({error:"Saved view not found."});
          reply.code(updating?200:201); return result.rows[0];
        } catch(error) {
          if((error as {code?:string}).code==="23505")return reply.code(409).send({error:"A saved view with that name already exists."});
          throw error;
        }
      });
    }
    routes.post<{Body:SavedViewBody}>("/api/people-records/saved-views",{schema:savedViewSchema},(request,reply)=>writeSavedView(request,reply));
    routes.patch<{Params:{id:string};Body:SavedViewBody}>("/api/people-records/saved-views/:id",{
      schema:{...savedViewSchema,params:{type:"object",additionalProperties:false,required:["id"],properties:{id:uuid}}},
    },(request,reply)=>writeSavedView(request,reply,request.params.id));
    routes.delete<{Params:{id:string}}>("/api/people-records/saved-views/:id",{schema:{params:{type:"object",additionalProperties:false,required:["id"],properties:{id:uuid}}}},async(request,reply)=>{
      const d=await department(request,reply); if(!d)return reply;
      if(!validateMutation(request,reply))return reply;
      const result=await pool!.query("DELETE FROM people_record_saved_views WHERE id=$1 AND department_id=$2 AND user_id=$3 RETURNING id",[request.params.id,d,request.authenticatedUser!.id]);
      if(!result.rowCount)return reply.code(404).send({error:"Saved view not found."});
      return {deleted:true};
    });
    routes.put<{ Params: { contactId: string }; Body: { firstName: string; lastName: string; email: string | null; phone: string | null; status: "member" | "visitor"; postalAddress?: PostalAddress } }>("/api/people-records/:contactId/profile", {
      schema: {
        params: { type: "object", additionalProperties: false, required: ["contactId"], properties: { contactId: uuid } },
        body: { type: "object", additionalProperties: false, required: ["firstName", "lastName", "email", "phone", "status"], properties: {
          firstName: { type: "string", minLength: 1, maxLength: 100 }, lastName: { type: "string", minLength: 1, maxLength: 100 },
          email: { anyOf: [{ type: "string", maxLength: 254, format: "email" }, { type: "null" }] },
          phone: { anyOf: [{ type: "string", maxLength: 60 }, { type: "null" }] }, status: { type: "string", enum: ["member", "visitor"] },
          postalAddress: postalAddressSchema,
        } },
      },
    }, async (request, reply) => {
      const d = await department(request, reply, true); if (!d) return reply;
      if (!validateMutation(request, reply)) return reply;
      const firstName = request.body.firstName.trim(); const lastName = request.body.lastName.trim();
      const email = request.body.email?.trim() || null; const phone = request.body.phone?.trim() || null;
      if (!firstName || !lastName) return reply.code(400).send({ error: "Enter both a first and last name." });
      const postalAddress = request.body.postalAddress === undefined
        ? null
        : JSON.stringify(normalizePostalAddress(request.body.postalAddress));
      const before = await pool!.query<{ first_name: string; last_name: string; email: string | null; phone: string | null; status: string; postal_address: PostalAddress }>(
        "SELECT first_name,last_name,email,phone,status,postal_address FROM contacts WHERE department_id=$1 AND id=$2", [d, request.params.contactId],
      );
      if (!before.rowCount) return reply.code(404).send({ error: "Person not found at this location." });
      const after = await pool!.query<{ id: string; first_name: string; last_name: string; email: string | null; phone: string | null; status: string; postal_address: PostalAddress }>(
        "UPDATE contacts SET first_name=$3,last_name=$4,email=$5,phone=$6,status=$7,postal_address=COALESCE($8::jsonb,postal_address) WHERE department_id=$1 AND id=$2 RETURNING id,first_name,last_name,email,phone,status,postal_address",
        [d, request.params.contactId, firstName, lastName, email, phone, request.body.status, postalAddress],
      );
      await history(d, request.params.contactId, request, "profile_updated", "contact_profile", before.rows[0], after.rows[0]);
      changed(d, request.params.contactId);
      return { id: after.rows[0].id, firstName: after.rows[0].first_name, lastName: after.rows[0].last_name, email: after.rows[0].email, phone: after.rows[0].phone, status: after.rows[0].status, postalAddress: after.rows[0].postal_address };
    });
    routes.get<{ Params: { contactId: string } }>("/api/people-records/:contactId/vcard", { schema: { params: { type: "object", additionalProperties: false, required: ["contactId"], properties: { contactId: uuid } } } }, async (request, reply) => {
      const d = await department(request, reply); if (!d) return reply;
      const result = await pool!.query<{ first_name: string; last_name: string; email: string | null; phone: string | null; postal_address: PostalAddress }>(
        "SELECT first_name,last_name,email,phone,postal_address FROM contacts WHERE department_id=$1 AND id=$2", [d, request.params.contactId],
      );
      if (!result.rowCount) return reply.code(404).send({ error: "Person not found at this location." });
      const person = result.rows[0];
      const escape = (value: string) => value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([,;])/g, "\\$1");
      const fold = (line: string) => {
        const chunks: string[] = []; let current = ""; let bytes = 0;
        for (const character of Array.from(line)) {
          const size = Buffer.byteLength(character, "utf8");
          if (bytes + size > 75) { chunks.push(current); current = ` ${character}`; bytes = size + 1; }
          else { current += character; bytes += size; }
        }
        chunks.push(current); return chunks.join("\r\n");
      };
      const name = `${person.first_name} ${person.last_name}`.trim();
      const lines = ["BEGIN:VCARD", "VERSION:4.0", `N:${escape(person.last_name)};${escape(person.first_name)};;;`, `FN:${escape(name)}`];
      if (person.email) lines.push(`EMAIL;TYPE=work:${escape(person.email)}`);
      if (person.phone) lines.push(`TEL;TYPE=work:${escape(person.phone)}`);
      const address = person.postal_address;
      if (Object.keys(address).length) {
        const parts = ["", address.additionalLine, address.street, address.city, address.region, address.postalCode, address.country];
        lines.push("ADR:" + parts.map((part) => escape(part ?? "")).join(";"));
      }
      lines.push("END:VCARD");
      const filename = name.replace(/[^\p{L}\p{N}._ -]/gu, "").trim().replace(/\s+/g, "-").slice(0, 100) || "contact";
      return reply.header("content-type", "text/vcard; charset=utf-8").header("content-disposition", `attachment; filename="${filename}.vcf"`).send(lines.map(fold).join("\r\n") + "\r\n");
    });
    routes.post<{ Body: { contactIds: string[]; status: "member" | "visitor" } }>("/api/people-records/bulk-status", { schema: { body: { type: "object", additionalProperties: false, required: ["contactIds", "status"], properties: { contactIds: { type: "array", minItems: 1, maxItems: 500, uniqueItems: true, items: uuid }, status: { type: "string", enum: ["member", "visitor"] } } } } }, async (request, reply) => {
      const d = await department(request, reply, true); if (!d) return reply;
      if (!validateMutation(request, reply)) return reply;
      const client = await pool!.connect();
      const changedContacts: string[] = [];
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('smart_church.actor_id',$1,true)", [request.authenticatedUser?.id ?? ""]);
        const selected = await client.query<{ id: string; first_name: string; last_name: string; email: string | null; phone: string | null; status: string }>(
          "SELECT id,first_name,last_name,email,phone,status FROM contacts WHERE department_id=$1 AND id=ANY($2::uuid[]) FOR UPDATE", [d, request.body.contactIds],
        );
        if (selected.rowCount !== request.body.contactIds.length) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "One or more people were not found at this location." }); }
        for (const person of selected.rows) {
          if (person.status === request.body.status) continue;
          const result = await client.query("UPDATE contacts SET status=$3 WHERE department_id=$1 AND id=$2", [d, person.id, request.body.status]);
          if (result.rowCount) {
            await client.query("INSERT INTO people_record_history(id,department_id,contact_id,actor_user_id,action,subject,before_value,after_value) VALUES($1,$2,$3,$4,'profile_updated','bulk_status',$5::jsonb,$6::jsonb)", [randomUUID(), d, person.id, request.authenticatedUser?.id ?? null, JSON.stringify({ status: person.status }), JSON.stringify({ status: request.body.status })]);
            changedContacts.push(person.id);
          }
        }
        await client.query("COMMIT");
        for (const contactId of changedContacts) changed(d, contactId);
        return { updated: changedContacts.length, unchanged: selected.rowCount - changedContacts.length };
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    });
    routes.post<{ Body: { contactIds: string[]; fieldId: string; value: unknown } }>("/api/people-records/bulk-field", { schema: { body: { type: "object", additionalProperties: false, required: ["contactIds", "fieldId", "value"], properties: { contactIds: { type: "array", minItems: 1, maxItems: 500, uniqueItems: true, items: uuid }, fieldId: uuid, value: {} } } } }, async (request, reply) => {
      const d = await department(request, reply, true); if (!d) return reply;
      if (!validateMutation(request, reply)) return reply;
      const client = await pool!.connect();
      const changedContacts: string[] = [];
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('smart_church.actor_id',$1,true)", [request.authenticatedUser?.id ?? ""]);
        const selected = await client.query<{ id: string }>("SELECT id FROM contacts WHERE department_id=$1 AND id=ANY($2::uuid[]) FOR UPDATE", [d, request.body.contactIds]);
        if (selected.rowCount !== request.body.contactIds.length) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "One or more people were not found at this location." }); }
        const fields = await client.query<{ field_key: string; field_type: string; options: unknown; required: boolean; text_max_length: number | null }>("SELECT field_key,field_type,options,required,text_max_length FROM people_record_fields WHERE department_id=$1 AND id=$2 AND active=true FOR UPDATE", [d, request.body.fieldId]);
        if (!fields.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Active custom field not found at this location." }); }
        const field = fields.rows[0];
        const value = request.body.value;
        const textMaxLength = field.text_max_length ?? defaultFieldTextMaxLength;
        if (field.required && (value === null || value === "")) { await client.query("ROLLBACK"); return reply.code(400).send({ error: "This custom field is required and cannot be cleared." }); }
        if (value !== null) {
          if (field.field_type === "select" && !((field.options as unknown[] | null) ?? []).includes(value)) { await client.query("ROLLBACK"); return reply.code(400).send({ error: "Choose one of the configured field options." }); }
          if (field.field_type === "boolean" && typeof value !== "boolean") { await client.query("ROLLBACK"); return reply.code(400).send({ error: "Enter a true or false value." }); }
          if (field.field_type === "text" && (typeof value !== "string" || value.length > textMaxLength)) { await client.query("ROLLBACK"); return reply.code(400).send({ error: `Enter text up to ${textMaxLength} characters.` }); }
          if (field.field_type === "date" && (typeof value !== "string" || !/^\\d{4}-\\d{2}-\\d{2}$/.test(value) || Number.isNaN(Date.parse(value)))) { await client.query("ROLLBACK"); return reply.code(400).send({ error: "Enter a valid date." }); }
        }
        const existing = await client.query<{ contact_id: string; value: unknown }>("SELECT contact_id,value FROM people_record_values WHERE department_id=$1 AND field_id=$2 AND contact_id=ANY($3::uuid[])", [d, request.body.fieldId, request.body.contactIds]);
        const beforeByContact = new Map(existing.rows.map(row => [row.contact_id, row.value]));
        const nextJson = value === null ? null : JSON.stringify(value);
        for (const person of selected.rows) {
          const before = beforeByContact.get(person.id);
          if (before === undefined && value === null) continue;
          if (before !== undefined && JSON.stringify(before) === nextJson) continue;
          if (value === null) await client.query("DELETE FROM people_record_values WHERE department_id=$1 AND contact_id=$2 AND field_id=$3", [d, person.id, request.body.fieldId]);
          else await client.query("INSERT INTO people_record_values(department_id,contact_id,field_id,value,updated_by) VALUES($1,$2,$3,$4::jsonb,$5) ON CONFLICT(department_id,contact_id,field_id) DO UPDATE SET value=excluded.value,updated_by=excluded.updated_by,updated_at=now()", [d, person.id, request.body.fieldId, nextJson, request.authenticatedUser?.id ?? null]);
          await client.query("INSERT INTO people_record_history(id,department_id,contact_id,actor_user_id,action,subject,before_value,after_value) VALUES($1,$2,$3,$4,'field_updated',$5,$6::jsonb,$7::jsonb)", [randomUUID(), d, person.id, request.authenticatedUser?.id ?? null, `bulk:${field.field_key}`, before === undefined ? null : JSON.stringify(before), nextJson]);
          changedContacts.push(person.id);
        }
        await client.query("COMMIT");
        for (const contactId of changedContacts) changed(d, contactId);
        return { updated: changedContacts.length, unchanged: selected.rowCount - changedContacts.length };
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    });
    routes.get<{ Querystring: { q?: string; status?: string; field?: string; value?: string;filters?:string;relationshipFilters?:string;groupRole?:string;groupType?:string;groupId?:string;groupJoinedFrom?:string;groupJoinedThrough?:string;formerGroupId?:string;attendedMeetingId?:string;sort?:DirectorySort;archived?:boolean;columns?:string } }>("/api/people-records/export.csv",{schema:{querystring:{type:"object",additionalProperties:false,properties:{q:{type:"string",maxLength:120},status:{type:"string",enum:["member","visitor"]},field:{type:"string",pattern:"^[a-z][a-z0-9_]{0,39}$"},value:{type:"string",maxLength:200},filters:{type:"string",maxLength:3000},columns:{type:"string",maxLength:1200},relationshipFilters:{type:"string",maxLength:2000},groupRole:{type:"string",minLength:1,maxLength:80},groupType:{type:"string",minLength:1,maxLength:120},groupId:uuid,groupJoinedFrom:membershipJoinDate,groupJoinedThrough:membershipJoinDate,formerGroupId:uuid,attendedMeetingId:uuid,sort:directorySortSchema,archived:{type:"boolean"}}}}}, async (request, reply) => {
      const d=await department(request,reply); if(!d)return reply; if(!await canFilterFormerGroup(request,reply,d,request.query.formerGroupId))return reply; if(!await canFilterAttendedMeeting(request,reply,d,request.query.attendedMeetingId))return reply; const joinError=membershipJoinRangeError(request.query); if(joinError)return reply.code(400).send({error:joinError}); const {q="",status,field,value}=request.query;
      let fieldJson:string|null=null;
      try{const filters=parseFieldFilters(request.query.filters,field,value);if(filters.length)fieldJson=JSON.stringify(await validateFieldFilters(d,filters,canManagePeopleFields(request)))}catch(error){return reply.code(400).send({error:error instanceof Error?error.message:"Choose valid custom field filters."})} let relationshipJson:string|null=null;try{const filters=await validateRelationshipFilters(d,parseRelationshipFilters(request.query.relationshipFilters),canManagePeopleFields(request));if(filters.length)relationshipJson=JSON.stringify(filters)}catch(error){return reply.code(400).send({error:error instanceof Error?error.message:"Choose valid relationship filters."})}
      let columns:string[];
      try{
        if(request.query.columns===undefined){const active=await pool!.query<{field_key:string}>("SELECT field_key FROM people_record_fields WHERE department_id=$1 AND active=true AND ($2::boolean OR visibility='private_people') ORDER BY position,label,id",[d,canManagePeopleFields(request)]);columns=[...coreDirectoryColumns,...active.rows.map(row=>`custom:${row.field_key}`)]}
        else{const parsed=JSON.parse(request.query.columns) as unknown;if(!Array.isArray(parsed)||parsed.some(column=>typeof column!=="string"))throw new Error("Choose a valid list of export columns.");columns=await validateDirectoryColumns(d,parsed,canManagePeopleFields(request))}
      }catch(error){return reply.code(400).send({error:error instanceof Error?error.message:"Choose valid export columns."})}
      const r=await pool!.query(`SELECT c.id,c.first_name,c.last_name,c.email,c.phone,c.status,c.postal_address,COALESCE((SELECT jsonb_object_agg(f.field_key,v.value) FROM people_record_values v JOIN people_record_fields f ON f.id=v.field_id AND f.department_id=v.department_id WHERE v.department_id=c.department_id AND v.contact_id=c.id AND f.active AND ($10::boolean OR f.visibility='private_people')),'{}'::jsonb) fields FROM contacts c WHERE c.department_id=$1 AND (c.archived_at IS NOT NULL)=$9::boolean AND ${directoryTextMatch} AND ($3::text IS NULL OR c.status=$3) AND ($4::jsonb IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements($4::jsonb) requested WHERE NOT EXISTS(SELECT 1 FROM people_record_values v JOIN people_record_fields f ON f.id=v.field_id AND f.department_id=v.department_id WHERE v.department_id=c.department_id AND v.contact_id=c.id AND f.field_key=requested->>'field' AND f.active=true AND ($10::boolean OR f.visibility='private_people') AND CASE WHEN f.field_type='text' AND requested->>'operator'='contains' THEN (v.value #>> '{}') ILIKE '%'||(requested->>'value')||'%' WHEN f.field_type='date' AND requested->>'operator'='before' THEN (v.value #>> '{}') < (requested->>'value') WHEN f.field_type='date' AND requested->>'operator'='after' THEN (v.value #>> '{}') > (requested->>'value') WHEN f.field_type='date' AND requested->>'operator'='on' THEN (v.value #>> '{}') = (requested->>'value') WHEN f.field_type='date' AND requested->>'operator'='last_7_days' THEN (v.value #>> '{}') >= to_char(CURRENT_DATE-6,'YYYY-MM-DD') AND (v.value #>> '{}') <= to_char(CURRENT_DATE,'YYYY-MM-DD') WHEN f.field_type='date' AND requested->>'operator'='last_30_days' THEN (v.value #>> '{}') >= to_char(CURRENT_DATE-29,'YYYY-MM-DD') AND (v.value #>> '{}') <= to_char(CURRENT_DATE,'YYYY-MM-DD') WHEN f.field_type='date' AND requested->>'operator'='last_90_days' THEN (v.value #>> '{}') >= to_char(CURRENT_DATE-89,'YYYY-MM-DD') AND (v.value #>> '{}') <= to_char(CURRENT_DATE,'YYYY-MM-DD') WHEN f.field_type='date' AND requested->>'operator'='next_7_days' THEN (v.value #>> '{}') > to_char(CURRENT_DATE,'YYYY-MM-DD') AND (v.value #>> '{}') <= to_char(CURRENT_DATE+7,'YYYY-MM-DD') WHEN f.field_type='date' AND requested->>'operator'='next_30_days' THEN (v.value #>> '{}') > to_char(CURRENT_DATE,'YYYY-MM-DD') AND (v.value #>> '{}') <= to_char(CURRENT_DATE+30,'YYYY-MM-DD') WHEN f.field_type='date' AND requested->>'operator'='next_90_days' THEN (v.value #>> '{}') > to_char(CURRENT_DATE,'YYYY-MM-DD') AND (v.value #>> '{}') <= to_char(CURRENT_DATE+90,'YYYY-MM-DD') ELSE v.value=requested->'value' END))) AND ($5::jsonb IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements($5::jsonb) requested WHERE (requested->>'exclude')::boolean=EXISTS(SELECT 1 FROM people_record_relationships relation WHERE relation.department_id=c.department_id AND (relation.person_id=c.id OR relation.related_person_id=c.id) AND ((requested ? 'relationshipTypeId' AND relation.relationship_type_id=(requested->>'relationshipTypeId')::uuid
          AND ($10::boolean OR EXISTS (SELECT 1 FROM people_record_relationship_types kind WHERE kind.department_id=relation.department_id
            AND kind.id=relation.relationship_type_id AND kind.visibility='private_people'))) OR (requested ? 'legacyRelationship' AND relation.relationship_type_id IS NULL AND lower(btrim(relation.relationship))=lower(btrim(requested->>'legacyRelationship'))))))) AND ${activeGroupMembershipFilter} AND ${formerGroupMembership(request.query.formerGroupId??null)} AND ${presentMeetingFilter(request.query.attendedMeetingId)} ORDER BY ${directoryOrder(request.query.sort)} LIMIT 5000`,[d,q,status??null,fieldJson,relationshipJson,request.query.groupId??null,request.query.groupType??null,request.query.groupRole?.trim()||null,request.query.archived??false,canManagePeopleFields(request),request.query.groupJoinedFrom??null,request.query.groupJoinedThrough??null,request.query.formerGroupId??null,request.query.attendedMeetingId??null]);
      const customKeys=columns.filter(column=>column.startsWith("custom:")).map(column=>column.slice(7));
      const customLabels=customKeys.length?await pool!.query<{field_key:string;label:string}>("SELECT field_key,label FROM people_record_fields WHERE department_id=$1 AND field_key=ANY($2::text[]) AND active=true AND ($3::boolean OR visibility='private_people')",[d,customKeys,canManagePeopleFields(request)]):{rows:[] as Array<{field_key:string;label:string}>};
      const labels=new Map(customLabels.rows.map(row=>[`custom:${row.field_key}`,row.label]));
      const headers=columns.map(column=>labels.get(column)??({id:"id",firstName:"first_name",lastName:"last_name",email:"email",phone:"phone",status:"status"} as Record<string,string>)[column]??column);
      const valueFor=(row:any,column:string)=>column.startsWith("custom:")?row.fields?.[column.slice(7)]:column.startsWith("address:")?row.postal_address?.[column.slice(8)]:row[({firstName:"first_name",lastName:"last_name"} as Record<string,string>)[column]??column];
      const cell=(v:unknown)=>{let s=String(typeof v==="object"&&v!==null?JSON.stringify(v):v??"");if(/^[=+\-@\t\r]/.test(s))s="'"+s;return `"${s.replaceAll('"','""')}"`}; const csv=[headers.map(cell).join(","),...r.rows.map(row=>columns.map(column=>cell(valueFor(row,column))).join(","))].join("\r\n"); return reply.header("content-type","text/csv; charset=utf-8").header("content-disposition","attachment; filename=people-directory.csv").send("\uFEFF"+csv);
    });
    routes.put<{ Params:{contactId:string;fieldId:string}; Body:{value:unknown} }>("/api/people-records/:contactId/fields/:fieldId",{schema:{params:{type:"object",required:["contactId","fieldId"],properties:{contactId:uuid,fieldId:uuid}},body:{type:"object",required:["value"],properties:{value:{}}}}},async(request,reply)=>{
      const d = await department(request, reply, true);
      if (!d) return reply;
      if (!validateMutation(request, reply)) return reply;
      const { fieldId, contactId } = request.params;
      const value = request.body.value;
      const client = await pool!.connect();
      let committed = false;
      try {
        await client.query("BEGIN");
        const contact = await client.query("SELECT id FROM contacts WHERE department_id=$1 AND id=$2 FOR UPDATE", [d, contactId]);
        const fields = await client.query<{ field_type: string; options: unknown[]; required: boolean; text_max_length: number | null }>(
          "SELECT field_type,options,required,text_max_length FROM people_record_fields WHERE department_id=$1 AND id=$2 AND active FOR SHARE", [d, fieldId],
        );
        if (!contact.rowCount || !fields.rowCount) return reply.code(404).send({ error: "Person or active field not found." });
        const field = fields.rows[0];
        const before = (await client.query("SELECT value FROM people_record_values WHERE department_id=$1 AND contact_id=$2 AND field_id=$3", [d, contactId, fieldId])).rows[0]?.value;
        const textMaxLength = field.text_max_length ?? defaultFieldTextMaxLength;
        if (field.required && (value === null || value === "")) return reply.code(400).send({ error: "This custom field is required." });
        if (field.field_type === "select" && !field.options.includes(value)) return reply.code(400).send({ error: "Choose one of the configured field options." });
        if (field.field_type === "boolean" && typeof value !== "boolean") return reply.code(400).send({ error: "Enter a true or false value." });
        if (field.field_type === "text" && (typeof value !== "string" || value.length > textMaxLength)) {
          if (typeof value === "string" && before === value) return { ok: true };
          return reply.code(400).send({ error: "Enter text up to " + textMaxLength + " characters." });
        }
        if (field.field_type === "date" && (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)))) {
          return reply.code(400).send({ error: "Enter a valid date." });
        }
        await client.query(
          "INSERT INTO people_record_values(department_id,contact_id,field_id,value,updated_by) VALUES($1,$2,$3,$4::jsonb,$5) ON CONFLICT(department_id,contact_id,field_id) DO UPDATE SET value=excluded.value,updated_by=excluded.updated_by,updated_at=now()",
          [d, contactId, fieldId, JSON.stringify(value), request.authenticatedUser?.id ?? null],
        );
        await history(d, contactId, request, "field_updated", fieldId, before, value, client);
        await client.query("COMMIT");
        committed = true;
      } finally {
        try { if (!committed) await client.query("ROLLBACK"); }
        finally { client.release(); }
      }
      changed(d, contactId);
      return { ok: true };
    });
    routes.get("/api/people-records/relationship-types",async(request,reply)=>{
      const d=await department(request,reply);if(!d)return reply;
      const result=await pool!.query(`SELECT id,label,"reverse_label" AS "reverseLabel",active,visibility FROM people_record_relationship_types
        WHERE department_id=$1 AND ($2::boolean OR visibility='private_people') ORDER BY lower(label),id`,[d,canManagePeopleFields(request)]);
      return result.rows;
    });
    routes.get("/api/people-records/relationship-labels",async(request,reply)=>{
      const d=await department(request,reply);if(!d)return reply;
      const result=await pool!.query<{label:string}>(`SELECT min(trim(relationship)) AS label FROM people_record_relationships WHERE department_id=$1 AND relationship_type_id IS NULL AND length(trim(relationship))>0 GROUP BY lower(trim(relationship)) ORDER BY lower(trim(relationship))`,[d]);
      return result.rows.map(row=>row.label);
    });
    routes.post<{Body:{label:string;reverseLabel:string;visibility?:"private_people"|"people_managers"}}>("/api/people-records/relationship-types",{schema:{body:{type:"object",additionalProperties:false,required:["label","reverseLabel"],properties:{label:{type:"string",minLength:1,maxLength:60},reverseLabel:{type:"string",minLength:1,maxLength:60},visibility:{type:"string",enum:["private_people","people_managers"]}}}}},async(request,reply)=>{
      const d=await department(request,reply,true);if(!d)return reply;if(!validateMutation(request,reply))return reply;
      const label=request.body.label.trim(),reverseLabel=request.body.reverseLabel.trim();if(!label||!reverseLabel)return reply.code(400).send({error:"Enter forward and reverse relationship labels."});
      try{const result=await pool!.query(`INSERT INTO people_record_relationship_types(id,department_id,label,reverse_label,created_by,visibility) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,label,reverse_label AS "reverseLabel",active,visibility`,[randomUUID(),d,label,reverseLabel,request.authenticatedUser?.id??null,request.body.visibility??"private_people"]);return reply.code(201).send(result.rows[0])}
      catch{return reply.code(409).send({error:"A relationship type with that forward label already exists at this location."})}
    });
    routes.patch<{Params:{id:string};Body:{label?:string;reverseLabel?:string;active?:boolean;visibility?:"private_people"|"people_managers"}}>("/api/people-records/relationship-types/:id",{schema:{params:{type:"object",additionalProperties:false,required:["id"],properties:{id:uuid}},body:{type:"object",additionalProperties:false,properties:{label:{type:"string",minLength:1,maxLength:60},reverseLabel:{type:"string",minLength:1,maxLength:60},active:{type:"boolean"},visibility:{type:"string",enum:["private_people","people_managers"]}}}}},async(request,reply)=>{
      const d=await department(request,reply,true);if(!d)return reply;if(!validateMutation(request,reply))return reply;
      const label=request.body.label?.trim(),reverseLabel=request.body.reverseLabel?.trim();if(request.body.label!==undefined&&!label||request.body.reverseLabel!==undefined&&!reverseLabel)return reply.code(400).send({error:"Relationship labels cannot be empty."});
      try{const result=await pool!.query(`UPDATE people_record_relationship_types SET label=COALESCE($3,label),reverse_label=COALESCE($4,reverse_label),active=COALESCE($5,active),visibility=COALESCE($6,visibility),updated_at=now() WHERE department_id=$1 AND id=$2 RETURNING id,label,reverse_label AS "reverseLabel",active,visibility`,[d,request.params.id,label??null,reverseLabel??null,request.body.active??null,request.body.visibility??null]);if(!result.rowCount)return reply.code(404).send({error:"Relationship type not found."});return result.rows[0]}
      catch{return reply.code(409).send({error:"A relationship type with that forward label already exists at this location."})}
    });
    routes.get<{Params:{contactId:string}}>("/api/people-records/:contactId/relationships",{schema:{params:{type:"object",required:["contactId"],properties:{contactId:uuid}}}},async(request,reply)=>{
      const d=await department(request,reply);if(!d)return reply;
      const result=await pool!.query(`WITH visible_relationships AS (
        SELECT relation.id,relation.related_person_id AS related_person_id,COALESCE(kind.label,relation.relationship) AS relationship,kind.id AS "relationshipTypeId",FALSE AS "isReciprocal"
          FROM people_record_relationships relation LEFT JOIN people_record_relationship_types kind ON kind.id=relation.relationship_type_id AND kind.department_id=relation.department_id
         WHERE relation.department_id=$1 AND relation.person_id=$2 AND ($3::boolean OR relation.relationship_type_id IS NULL OR kind.visibility='private_people')
        UNION ALL
        SELECT relation.id,relation.person_id,kind.reverse_label,kind.id,TRUE
          FROM people_record_relationships relation JOIN people_record_relationship_types kind ON kind.id=relation.relationship_type_id AND kind.department_id=relation.department_id
         WHERE relation.department_id=$1 AND relation.related_person_id=$2 AND ($3::boolean OR kind.visibility='private_people')
      ) SELECT visible.id,visible.relationship,visible."relationshipTypeId",visible."isReciprocal",contact.id AS "relatedPersonId",contact.first_name AS "firstName",contact.last_name AS "lastName"
          FROM visible_relationships visible JOIN contacts contact ON contact.id=visible.related_person_id AND contact.department_id=$1
         ORDER BY contact.last_name,contact.first_name,visible.relationship`,[d,request.params.contactId,canManagePeopleFields(request)]);
      return result.rows;
    });
    routes.post<{Params:{contactId:string};Body:{relatedPersonId:string;relationship?:string;relationshipTypeId?:string}}>("/api/people-records/:contactId/relationships",{schema:{params:{type:"object",required:["contactId"],properties:{contactId:uuid}},body:{type:"object",additionalProperties:false,required:["relatedPersonId"],properties:{relatedPersonId:uuid,relationship:{type:"string",minLength:1,maxLength:60},relationshipTypeId:uuid}}}},async(request,reply)=>{
      const d=await department(request,reply,true);if(!d)return reply;if(!validateMutation(request,reply))return reply;
      const usingType=Boolean(request.body.relationshipTypeId),hasLegacyLabel=request.body.relationship!==undefined,legacyLabel=request.body.relationship?.trim();if(usingType===hasLegacyLabel)return reply.code(400).send({error:"Choose one relationship type."});if(hasLegacyLabel&&!legacyLabel)return reply.code(400).send({error:"Enter a relationship label."});
      const both=await pool!.query("SELECT count(*)::int n FROM contacts WHERE department_id=$1 AND id=ANY($2::uuid[])",[d,[request.params.contactId,request.body.relatedPersonId]]);if(both.rows[0].n!==2||request.params.contactId===request.body.relatedPersonId)return reply.code(400).send({error:"Select two different people from this location."});
      let relationship=legacyLabel??"",relationshipTypeId:string|null=null;
      if(usingType){const type=await pool!.query<{id:string;label:string}>("SELECT id,label FROM people_record_relationship_types WHERE department_id=$1 AND id=$2 AND active=true",[d,request.body.relationshipTypeId]);if(!type.rowCount)return reply.code(400).send({error:"Choose an active relationship type from this location."});relationship=type.rows[0].label;relationshipTypeId=type.rows[0].id}
      try{const id=randomUUID();await pool!.query("INSERT INTO people_record_relationships(id,department_id,person_id,related_person_id,relationship,created_by,relationship_type_id) VALUES($1,$2,$3,$4,$5,$6,$7)",[id,d,request.params.contactId,request.body.relatedPersonId,relationship,request.authenticatedUser?.id??null,relationshipTypeId]);await history(d,request.params.contactId,request,"relationship_added",relationship,null,{relatedPersonId:request.body.relatedPersonId,relationshipTypeId});changed(d,request.params.contactId);return reply.code(201).send({id})}
      catch{return reply.code(409).send({error:"That relationship between these people already exists."})}
    });
    routes.delete<{Params:{contactId:string;id:string}}>("/api/people-records/:contactId/relationships/:id",{schema:{params:{type:"object",required:["contactId","id"],properties:{contactId:uuid,id:uuid}}}},async(request,reply)=>{
      const d=await department(request,reply,true);if(!d)return reply;if(!validateMutation(request,reply))return reply;
      const result=await pool!.query("DELETE FROM people_record_relationships WHERE department_id=$1 AND id=$3 AND (person_id=$2 OR related_person_id=$2) RETURNING relationship,person_id,related_person_id,relationship_type_id",[d,request.params.contactId,request.params.id]);if(!result.rowCount)return reply.code(404).send({error:"Relationship not found."});
      await history(d,request.params.contactId,request,"relationship_removed",result.rows[0].relationship,result.rows[0],null);changed(d,request.params.contactId);return{ok:true};
    });
    routes.get<{ Params: { contactId: string } }>("/api/people-records/:contactId/consents", {
      schema: { params: { type: "object", required: ["contactId"], properties: { contactId: uuid } } },
    }, async (request, reply) => {
      const d = await department(request, reply);
      if (!d) return reply;
      const result = await pool!.query(
        'SELECT consent.id, consent.purpose, consent.status, consent.captured_at AS "capturedAt", consent.expires_at AS "expiresAt", consent.notes, consent.source, COALESCE(consent.historical_actor_name,actor.display_name) AS "actorName" FROM people_record_consents consent LEFT JOIN app_users actor ON actor.id=consent.actor_user_id WHERE consent.department_id=$1 AND consent.contact_id=$2 ORDER BY consent.captured_at DESC, consent.id',
        [d, request.params.contactId],
      );
      reply.header("cache-control", "private, no-store");
      return result.rows;
    });

    routes.post<{ Params: { contactId: string }; Body: { purpose: string; status: "granted" | "withdrawn" | "pending"; expiresAt?: string | null; notes?: string; source?: string } }>("/api/people-records/:contactId/consents", {
      schema: {
        params: { type: "object", required: ["contactId"], properties: { contactId: uuid } },
        body: { type: "object", required: ["purpose", "status"], properties: {
          purpose: { type: "string", minLength: 1, maxLength: 100 },
          status: { type: "string", enum: ["granted", "withdrawn", "pending"] },
          expiresAt: { type: ["string", "null"], format: "date" },
          notes: { type: "string", maxLength: 1000 },
          source: { type: "string", maxLength: 120 },
        } },
      },
    }, async (request, reply) => {
      const d = await department(request, reply, true);
      if (!d || !validateMutation(request, reply)) return reply;
      const purpose = request.body.purpose.trim();
      if (!purpose) return reply.code(400).send({ error: "Enter a consent purpose." });
      const { contactId } = request.params;
      const { status, expiresAt = null } = request.body;
      const source = request.body.source?.trim() ?? "";
      const actorId = request.authenticatedUser?.id ?? null;
      const id = randomUUID();
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        if (!await context.lockDepartmentForWrite(client, d)) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "This location is not writable." });
        }
        const person = await client.query("SELECT id FROM contacts WHERE department_id=$1 AND id=$2 FOR KEY SHARE", [d, contactId]);
        if (!person.rowCount) {
          await client.query("ROLLBACK");
          return reply.code(404).send({ error: "Person not found at this location." });
        }
        await client.query("INSERT INTO people_record_consents(id,department_id,contact_id,purpose,status,expires_at,notes,actor_user_id,source) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", [id,d,contactId,purpose,status,expiresAt,request.body.notes?.trim() ?? "",actorId,source]);
        await client.query("INSERT INTO people_record_history(id,department_id,contact_id,actor_user_id,action,subject,after_value) VALUES($1,$2,$3,$4,'consent_recorded',$5,$6::jsonb)", [randomUUID(),d,contactId,actorId,purpose,JSON.stringify({ status, expiresAt, source })]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      changed(d, contactId);
      return reply.code(201).send({ id });
    });
    routes.get<{ Params: { contactId: string } }>("/api/people-records/:contactId/group-memberships", {
      schema: { params: { type: "object", required: ["contactId"], properties: { contactId: uuid } } },
    }, async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      reply.header("cache-control", "private, no-store");
      const contact = await pool!.query("SELECT 1 FROM contacts WHERE department_id=$1 AND id=$2", [departmentId, request.params.contactId]);
      if (!contact.rowCount) return reply.code(404).send({ error: "Person not found at this location." });

      const accessibleGroups = accessiblePeopleGroups(3, 4);
      const params = [departmentId, request.params.contactId, canManageMembershipHistory(request), request.authenticatedUser!.id];
      const current = await pool!.query(
        `WITH accessible_groups AS (${accessibleGroups})
         SELECT g.id AS "groupId",g.name AS "groupName",g.status AS "groupStatus",
                member.role,member.status,member.joined_on::text AS "joinedOn"
           FROM accessible_groups g JOIN group_members member ON member.group_id=g.id
          WHERE member.contact_id=$2 ORDER BY lower(g.name),g.id`,
        params,
      );
      const table = await pool!.query<{ present: boolean }>("SELECT to_regclass('group_hierarchy_history') IS NOT NULL AS present");
      if (!table.rows[0]?.present) return { current: current.rows, history: [], historyAvailable: false };
      const history = await pool!.query(
        `WITH accessible_groups AS (${accessibleGroups}), changes AS (
           SELECT g.id AS "groupId",g.name AS "groupName",h.action,h.created_at AS "createdAt",
                  h.before_data->>'role' AS "previousRole",h.after_data->>'role' AS role,
                  h.before_data->>'status' AS "previousStatus",h.after_data->>'status' AS status,
                  COALESCE(h.before_data->>'joinedOn',h.before_data->>'joined_on') AS "previousJoinedOn",
                  COALESCE(h.after_data->>'joinedOn',h.after_data->>'joined_on') AS "joinedOn"
             FROM group_hierarchy_history h JOIN accessible_groups g ON g.id=h.group_id
            WHERE h.department_id=$1 AND h.entity_kind='membership' AND h.entity_id=$2
         )
         SELECT DISTINCT "groupId","groupName",action,"createdAt","previousRole",role,"previousStatus",status,"previousJoinedOn","joinedOn"
           FROM changes WHERE action <> 'updated' OR ("previousRole","previousStatus","previousJoinedOn") IS DISTINCT FROM (role,status,"joinedOn")
          ORDER BY "createdAt" DESC,"groupId",action LIMIT 301`,
        params,
      );
      return { current: current.rows, history: history.rows.slice(0, 300), historyAvailable: true, historyTruncated: history.rows.length > 300 };
    });
    routes.get<{ Params: { contactId: string } }>("/api/people-records/:contactId/history", {
      schema: { params: { type: "object", required: ["contactId"], properties: { contactId: uuid } } },
    }, async (request, reply) => {
      const d = await department(request, reply); if (!d) return reply;
      const result = await pool!.query(
        `SELECT h.id,h.action,h.subject,h.before_value AS "beforeValue",h.after_value AS "afterValue",h.created_at AS "createdAt"
           FROM people_record_history h WHERE h.department_id=$1 AND h.contact_id=$2
            AND ${visibleProfileHistory} ORDER BY h.created_at DESC LIMIT 300`,
        [d, request.params.contactId, canManagePeopleFields(request)],
      );
      return result.rows;
    });
    routes.post<{Body:{rows:Array<{firstName:string;lastName:string;email?:string;phone?:string;postalAddress?:PostalAddress;fields?:Record<string,string>}>}}>("/api/people-records/import-preview",{schema:{body:{type:"object",required:["rows"],properties:{rows:{type:"array",maxItems:500,items:{type:"object",additionalProperties:false,required:["firstName","lastName"],properties:{firstName:{type:"string",maxLength:100},lastName:{type:"string",maxLength:100},email:{type:"string",maxLength:254},phone:{type:"string",maxLength:60},postalAddress:postalAddressSchema,fields:{type:"object",maxProperties:100,additionalProperties:{type:"string",maxLength:2000}}}}}}}}},async(request,reply)=>{const d=await department(request,reply,true);if(!d)return reply;if(!validateMutation(request,reply))return reply;const [existing,definitions]=await Promise.all([pool!.query("SELECT id,first_name,last_name,email,phone FROM contacts WHERE department_id=$1",[d]),pool!.query<{field_key:string;field_type:string;options:unknown;required:boolean;text_max_length:number|null}>("SELECT field_key,field_type,options,required,text_max_length FROM people_record_fields WHERE department_id=$1 AND active=true",[d])]);const available=new Map(definitions.rows.map(field=>[field.field_key,field]));const normalize=(v?:string)=>v?.trim().toLocaleLowerCase()??"";const rows=request.body.rows.map((row,index)=>{let validationError:string|undefined;const firstName=row.firstName.trim(),lastName=row.lastName.trim();if(!firstName||!lastName)validationError="First and last name are required.";else if(firstName.length>80||lastName.length>80)validationError="Names must be 80 characters or fewer.";else if(row.email&&(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email.trim())||row.email.trim().length>254))validationError="Enter a valid email address.";else if(row.phone&&row.phone.trim().length>40)validationError="Phone numbers must be 40 characters or fewer.";const custom:Record<string,unknown>={};for(const field of definitions.rows){if(field.required&&!row.fields?.[field.field_key]?.trim())validationError??=`${field.field_key} is required.`}for(const [key,raw] of Object.entries(row.fields??{})){const field=available.get(key);if(!field){validationError??=`Custom field “${key}” is not active at this location.`;continue}const value=raw.trim();if(!value){if(field.required)validationError??=`${key} is required.`;continue}if(field.field_type==="text"){const limit=field.text_max_length??defaultFieldTextMaxLength;if(value.length>limit)validationError??=`${key} must be at most ${limit} characters.`;else custom[key]=value}else if(field.field_type==="date"){const parsed=new Date(`${value}T00:00:00.000Z`);if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)validationError??=`${key} must be a valid date.`;else custom[key]=value}else if(field.field_type==="boolean"){if(!["true","false","yes","no","1","0"].includes(value.toLowerCase()))validationError??=`${key} must be yes or no.`;else custom[key]=["true","yes","1"].includes(value.toLowerCase())}else if(field.field_type==="select"){if(!Array.isArray(field.options)||!field.options.includes(value))validationError??=`${key} must match a configured choice.`;else custom[key]=value}else validationError??=`${key} has an unsupported field type.`}const postalAddress=normalizePostalAddress(row.postalAddress);const person={firstName,lastName,...(Object.keys(postalAddress).length?{postalAddress}:{}),...(row.email?.trim()?{email:row.email.trim()}:{}),...(row.phone?.trim()?{phone:row.phone.trim()}:{}),...(Object.keys(custom).length?{fields:custom}:{})};const exact=existing.rows.find(c=>(normalize(person.email)&&normalize(c.email)===normalize(person.email))||(normalize(c.first_name)===normalize(firstName)&&normalize(c.last_name)===normalize(lastName)&&normalize(c.phone)===normalize(person.phone)));return{row:index+1,person,match:exact?{id:exact.id,firstName:exact.first_name,lastName:exact.last_name,email:exact.email}:null,decision:validationError?"invalid":exact?"review":"new",...(validationError?{validationError}:{})};});return{rows,counts:{new:rows.filter(x=>x.decision==="new").length,review:rows.filter(x=>x.decision==="review").length,invalid:rows.filter(x=>x.decision==="invalid").length,imported:0},message:"Preview only. No person records were changed."};});
    routes.post<{Body:{rows:Array<{row:number;firstName:string;lastName:string;email?:string;phone?:string;postalAddress?:PostalAddress;fields?:Record<string,string>;status?:"member"|"visitor"}>}}>("/api/people-records/import-apply",{schema:{body:{type:"object",required:["rows"],properties:{rows:{type:"array",minItems:1,maxItems:500,items:{type:"object",additionalProperties:false,required:["row","firstName","lastName"],properties:{row:{type:"integer",minimum:1},firstName:{type:"string",maxLength:100},lastName:{type:"string",maxLength:100},email:{type:"string",maxLength:254},phone:{type:"string",maxLength:60},postalAddress:postalAddressSchema,fields:{type:"object",maxProperties:100,additionalProperties:{type:"string",maxLength:2000}},status:{type:"string",enum:["member","visitor"]}}}}}}}},async(request,reply)=>{
      const d=await department(request,reply,true);if(!d)return reply;if(!validateMutation(request,reply))return reply;
      const chosen=request.body.rows;if(new Set(chosen.map(r=>r.row)).size!==chosen.length)return reply.code(400).send({error:"Each selected CSV row must be unique."});
      const client=await pool!.connect();const outcomes:Array<{row:number;outcome:string;contactId?:string;duplicateContactId?:string}>=[];let created=0;const auditId=randomUUID();
      try{
        await client.query("BEGIN");
        // Serialize contact writes during duplicate recheck and insertion so another importer cannot pass the same check concurrently.
        await client.query("LOCK TABLE contacts IN SHARE ROW EXCLUSIVE MODE");
        for(const item of chosen){
          const firstName=item.firstName.trim(),lastName=item.lastName.trim(),email=item.email?.trim()||null,phone=item.phone?.trim()||null,status=item.status??"visitor";
          if(!firstName||!lastName||firstName.length>80||lastName.length>80||(email!==null&&(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))||(phone!==null&&phone.length>40)||!['member','visitor'].includes(status)){outcomes.push({row:item.row,outcome:"invalid"});continue;}
          const fieldDefs=await client.query<{id:string;field_key:string;field_type:string;options:unknown;required:boolean;text_max_length:number|null}>("SELECT id,field_key,field_type,options,required,text_max_length FROM people_record_fields WHERE department_id=$1 AND active=true FOR SHARE",[d]);const requestedFields=Object.keys(item.fields??{});const fieldMap=new Map(fieldDefs.rows.map(field=>[field.field_key,field]));if(requestedFields.some(key=>!fieldMap.has(key))||fieldDefs.rows.some(field=>field.required&&!item.fields?.[field.field_key]?.trim())){outcomes.push({row:item.row,outcome:"invalid_fields"});continue;}const normalizedFields:Array<{id:string;key:string;value:unknown}>=[];let invalidField=false;for(const field of fieldDefs.rows.filter(field=>requestedFields.includes(field.field_key))){const raw=(item.fields??{})[field.field_key];const value=raw?.trim()??"";let normalized:unknown=value;if(!value){if(field.required)invalidField=true;else continue}else if(field.field_type==="text"){if(value.length>(field.text_max_length??defaultFieldTextMaxLength))invalidField=true}else if(field.field_type==="date"){const parsed=new Date(`${value}T00:00:00.000Z`);if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)invalidField=true}else if(field.field_type==="boolean"){if(!["true","false","yes","no","1","0"].includes(value.toLowerCase()))invalidField=true;else normalized=["true","yes","1"].includes(value.toLowerCase())}else if(field.field_type==="select"){if(!Array.isArray(field.options)||!field.options.includes(value))invalidField=true}else invalidField=true;normalizedFields.push({id:field.id,key:field.field_key,value:normalized})}if(invalidField){outcomes.push({row:item.row,outcome:"invalid_fields"});continue;}
          const duplicate=await client.query<{id:string}>("SELECT id FROM contacts WHERE department_id=$1 AND ((email IS NOT NULL AND $2::text IS NOT NULL AND lower(trim(email))=lower(trim($2))) OR (lower(trim(first_name))=lower(trim($3)) AND lower(trim(last_name))=lower(trim($4)) AND (($5::text IS NULL AND phone IS NULL) OR ($5::text IS NOT NULL AND phone IS NOT NULL AND lower(trim(phone))=lower(trim($5)))))) ORDER BY id LIMIT 1",[d,email,firstName,lastName,phone]);
          if(duplicate.rowCount){outcomes.push({row:item.row,outcome:"duplicate_review",duplicateContactId:duplicate.rows[0].id});continue;}
          const contactId=randomUUID();await client.query("INSERT INTO contacts(id,department_id,first_name,last_name,email,phone,status,postal_address) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",[contactId,d,firstName,lastName,email,phone,status,JSON.stringify(normalizePostalAddress(item.postalAddress))]);for(const field of normalizedFields){await client.query("INSERT INTO people_record_values(department_id,contact_id,field_id,value,updated_by) VALUES($1,$2,$3,$4::jsonb,$5)",[d,contactId,field.id,JSON.stringify(field.value),request.authenticatedUser?.id??null]);await client.query("INSERT INTO people_record_history(id,department_id,contact_id,actor_user_id,action,subject,after_value) VALUES($1,$2,$3,$4,'field_updated',$5,$6::jsonb)",[randomUUID(),d,contactId,request.authenticatedUser?.id??null,field.key,JSON.stringify(field.value)])}await client.query("INSERT INTO people_record_history(id,department_id,contact_id,actor_user_id,action,subject,after_value) VALUES($1,$2,$3,$4,'csv_import_created','CSV import',$5::jsonb)",[randomUUID(),d,contactId,request.authenticatedUser?.id??null,JSON.stringify({batchRow:item.row,postalAddressFields:Object.keys(normalizePostalAddress(item.postalAddress)),customFields:normalizedFields.map(field=>field.key)})]);outcomes.push({row:item.row,outcome:"created",contactId});created++;
        }
        await client.query("INSERT INTO people_record_import_audits(id,department_id,actor_user_id,selected_count,created_count,skipped_count,outcomes) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)",[auditId,d,request.authenticatedUser?.id??null,chosen.length,created,chosen.length-created,JSON.stringify(outcomes)]);
        await client.query("COMMIT");
      }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
      changed(d);return{auditId,selected:chosen.length,created,skipped:chosen.length-created,outcomes,message:"Selected rows were rechecked. Matches and invalid rows were skipped for review."};
    });
    routes.get<{Params:{contactId:string}}>("/api/people-records/:contactId/dates",{schema:{params:{type:"object",required:["contactId"],properties:{contactId:uuid}}}},async(request,reply)=>{const d=await department(request,reply);if(!d)return reply;const r=await pool!.query("SELECT date_kind AS kind,date_value::text AS value FROM people_record_person_dates WHERE department_id=$1 AND contact_id=$2",[d,request.params.contactId]);return{birthDate:r.rows.find(x=>x.kind==="birth_date")?.value??null,weddingAnniversary:r.rows.find(x=>x.kind==="wedding_anniversary")?.value??null};});
    routes.put<{Params:{contactId:string};Body:{birthDate?:string|null;weddingAnniversary?:string|null}}>("/api/people-records/:contactId/dates",{schema:{params:{type:"object",required:["contactId"],properties:{contactId:uuid}},body:{type:"object",additionalProperties:false,properties:{birthDate:{type:["string","null"],format:"date"},weddingAnniversary:{type:["string","null"],format:"date"}}}}},async(request,reply)=>{const d=await department(request,reply,true);if(!d)return reply;if(!validateMutation(request,reply))return reply;const exists=await pool!.query("SELECT id FROM contacts WHERE department_id=$1 AND id=$2",[d,request.params.contactId]);if(!exists.rowCount)return reply.code(404).send({error:"Person not found at this location."});for(const [key,value] of Object.entries(request.body)){if(value!==undefined){const kind=key==="birthDate"?"birth_date":"wedding_anniversary",before=await pool!.query("SELECT date_value::text value FROM people_record_person_dates WHERE department_id=$1 AND contact_id=$2 AND date_kind=$3",[d,request.params.contactId,kind]);if(value===null)await pool!.query("DELETE FROM people_record_person_dates WHERE department_id=$1 AND contact_id=$2 AND date_kind=$3",[d,request.params.contactId,kind]);else await pool!.query("INSERT INTO people_record_person_dates(department_id,contact_id,date_kind,date_value,updated_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(department_id,contact_id,date_kind) DO UPDATE SET date_value=excluded.date_value,updated_by=excluded.updated_by,updated_at=now()",[d,request.params.contactId,kind,value,request.authenticatedUser?.id??null]);await history(d,request.params.contactId,request,"date_updated",kind,before.rows[0]?.value,value);}}changed(d,request.params.contactId);return{ok:true};});
    routes.get("/api/people-records/duplicates",async(request,reply)=>{const d=await department(request,reply);if(!d)return reply;const r=await pool!.query(`SELECT a.id AS "personId",a.first_name AS "firstName",a.last_name AS "lastName",a.email,b.id AS "matchId",b.first_name AS "matchFirstName",b.last_name AS "matchLastName",b.email AS "matchEmail",CASE WHEN a.email IS NOT NULL AND lower(a.email)=lower(b.email) THEN 'email' ELSE 'name' END AS reason FROM contacts a JOIN contacts b ON b.department_id=a.department_id AND b.id>a.id AND ((a.email IS NOT NULL AND lower(a.email)=lower(b.email)) OR (lower(a.first_name)=lower(b.first_name) AND lower(a.last_name)=lower(b.last_name))) WHERE a.department_id=$1 ORDER BY reason,a.last_name LIMIT 500`,[d]);return{candidates:r.rows};});
    routes.post<{Body:{keeperId:string;sourceId:string}}>("/api/people-records/merge-preview",{schema:{body:{type:"object",additionalProperties:false,required:["keeperId","sourceId"],properties:{keeperId:uuid,sourceId:uuid}}}},async(request,reply)=>{const d=await department(request,reply);if(!d)return reply;const {keeperId,sourceId}=request.body;if(keeperId===sourceId)return reply.code(400).send({error:"Choose two different people."});const preview=await inspectMerge(d,keeperId,sourceId,pool!,canManagePeopleFields(request));if(!preview)return reply.code(404).send({error:"Both people must exist at the active location."});return preview;});
    routes.post<{Body:{keeperId:string;sourceId:string;confirmProfileConflicts:boolean}}>("/api/people-records/merge",{schema:{body:{type:"object",additionalProperties:false,required:["keeperId","sourceId","confirmProfileConflicts"],properties:{keeperId:uuid,sourceId:uuid,confirmProfileConflicts:{type:"boolean"}}}}},async(request,reply)=>{
      const d=await department(request,reply,true);if(!d)return reply;if(!validateMutation(request,reply))return reply;
      const {keeperId,sourceId,confirmProfileConflicts}=request.body;if(keeperId===sourceId)return reply.code(400).send({error:"Choose two different people."});
      const client=await pool!.connect();let committed=false;
      try{
        await client.query("BEGIN");
        const locked=await client.query<Record<string,unknown>>("SELECT * FROM contacts WHERE department_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE",[d,[keeperId,sourceId]]);
        if(locked.rowCount!==2){await client.query("ROLLBACK");return reply.code(404).send({error:"Both people must exist at the active location."});}
        const preview=await inspectMerge(d,keeperId,sourceId,client);if(!preview){await client.query("ROLLBACK");return reply.code(404).send({error:"Both people must exist at the active location."});}
        if(preview.blockers.length){await client.query("ROLLBACK");return reply.code(409).send({error:"Resolve the listed conflicting linked records before merging.",preview});}
        if(preview.customFieldConflicts.length||preview.dateConflicts.length){await client.query("ROLLBACK");return reply.code(409).send({error:"Custom field and date conflicts must be resolved before merging.",preview});}
        if(preview.profileConflicts.length&&!confirmProfileConflicts){await client.query("ROLLBACK");return reply.code(409).send({error:"Confirm that the keeper's values will be retained for conflicting profile fields.",preview});}
        const keeper=locked.rows.find((row)=>row.id===keeperId)!;const source=locked.rows.find((row)=>row.id===sourceId)!;
        // Preserve every keeper value. Fill blank email, phone and postal address from the source.
        await client.query("UPDATE contacts SET email=COALESCE(NULLIF(trim(email),''),NULLIF(trim($3::text),'')), phone=COALESCE(NULLIF(trim(phone),''),NULLIF(trim($4::text),'')), postal_address=CASE WHEN postal_address='{}'::jsonb THEN (SELECT postal_address FROM contacts WHERE department_id=$1 AND id=$5) ELSE postal_address END WHERE department_id=$1 AND id=$2",[d,keeperId,source.email,source.phone,sourceId]);
        // Values and dates have a natural-key uniqueness constraint; retain the keeper row when values match.
        await client.query("DELETE FROM people_record_values s USING people_record_values k WHERE s.department_id=$1 AND s.contact_id=$2 AND k.department_id=s.department_id AND k.contact_id=$3 AND k.field_id=s.field_id AND k.value=s.value",[d,sourceId,keeperId]);
        await client.query("DELETE FROM people_record_person_dates s USING people_record_person_dates k WHERE s.department_id=$1 AND s.contact_id=$2 AND k.department_id=s.department_id AND k.contact_id=$3 AND k.date_kind=s.date_kind AND k.date_value=s.date_value",[d,sourceId,keeperId]);
        await client.query(`DELETE FROM people_record_household_members source USING people_record_household_members keeper
          WHERE source.department_id=$1 AND source.contact_id=$2 AND keeper.department_id=source.department_id
            AND keeper.contact_id=$3 AND keeper.household_id=source.household_id`, [d, sourceId, keeperId]);
        const hasGroupMembers=await client.query<{installed:boolean}>("SELECT to_regclass('public.group_members') IS NOT NULL AS installed");
        if(hasGroupMembers.rows[0]?.installed){const hasAutoManaged=await client.query<{installed:boolean}>("SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='group_members' AND column_name='auto_managed') AS installed");await client.query(`DELETE FROM group_members s USING group_members k WHERE s.contact_id=$1 AND k.contact_id=$2 AND k.group_id=s.group_id AND s.role IS NOT DISTINCT FROM k.role AND s.status IS NOT DISTINCT FROM k.status AND s.joined_on IS NOT DISTINCT FROM k.joined_on${hasAutoManaged.rows[0]?.installed?" AND s.auto_managed IS NOT DISTINCT FROM k.auto_managed":""}`,[sourceId,keeperId]);}
        const hasGroupCustom=await client.query<{installed:boolean}>("SELECT to_regclass('public.group_membership_custom_fields') IS NOT NULL AS installed");
        if(hasGroupCustom.rows[0]?.installed)await client.query("DELETE FROM group_membership_custom_fields s USING group_membership_custom_fields k WHERE s.department_id=$1 AND s.contact_id=$2 AND k.department_id=s.department_id AND k.contact_id=$3 AND k.group_id=s.group_id AND s.custom_fields=k.custom_fields",[d,sourceId,keeperId]);
        // Remove self-edges before moving both ends, then deduplicate equivalent edges after reparenting.
        await client.query("DELETE FROM people_record_relationships WHERE department_id=$1 AND ((person_id=$2 AND related_person_id=$3) OR (person_id=$3 AND related_person_id=$2))",[d,keeperId,sourceId]);
        // Rewrite embedded service position references (these have no relational FK).
        const hasServiceEvents=await client.query<{installed:boolean}>("SELECT to_regclass('public.service_events') IS NOT NULL AS installed");
        if(hasServiceEvents.rows[0]?.installed)await client.query(`UPDATE service_events event SET positions=(SELECT COALESCE(jsonb_agg(CASE WHEN item.value->>'contactId'=$3::text THEN jsonb_set(item.value,'{contactId}',to_jsonb($2::text),true) ELSE item.value END ORDER BY item.ordinality),'[]'::jsonb) FROM jsonb_array_elements(COALESCE(event.positions,'[]'::jsonb)) WITH ORDINALITY item(value,ordinality)) WHERE event.department_id=$1 AND event.positions::text LIKE '%'||$3::text||'%'`,[d,keeperId,sourceId]);
        // Discover every FK column targeting contacts.id, including optional module tables.
        const refs=await client.query<{schema_name:string;table_name:string;column_name:string;has_department_id:boolean}>(`SELECT ns.nspname AS schema_name,rel.relname AS table_name,att.attname AS column_name,
                EXISTS(SELECT 1 FROM pg_attribute department_column WHERE department_column.attrelid=rel.oid AND department_column.attname='department_id' AND NOT department_column.attisdropped) AS has_department_id
           FROM pg_constraint con JOIN pg_class rel ON rel.oid=con.conrelid JOIN pg_namespace ns ON ns.oid=rel.relnamespace
           JOIN LATERAL unnest(con.conkey,con.confkey) pair(local_att,remote_att) ON true
           JOIN pg_attribute att ON att.attrelid=rel.oid AND att.attnum=pair.local_att
           JOIN pg_attribute remote ON remote.attrelid=con.confrelid AND remote.attnum=pair.remote_att
          WHERE con.contype='f' AND con.confrelid='public.contacts'::regclass AND remote.attname='id' AND ns.nspname='public'
            AND NOT (rel.relname='contacts' AND att.attname='id') ORDER BY rel.relname,att.attname`);
        // Keep the keeper's portrait when both profiles selected one.
        await client.query("UPDATE people_record_attachments source SET is_portrait=false WHERE source.department_id=$1 AND source.contact_id=$2 AND source.is_portrait AND EXISTS (SELECT 1 FROM people_record_attachments keeper WHERE keeper.department_id=$1 AND keeper.contact_id=$3 AND keeper.is_portrait)", [d,sourceId,keeperId]);
        const qi=(value:string)=>'"'+value.replaceAll('"','""')+'"';
        for(const ref of refs.rows){
          const table=`${qi(ref.schema_name)}.${qi(ref.table_name)}`,column=qi(ref.column_name);
          if(ref.has_department_id){await client.query(`UPDATE ${table} SET ${column}=$1 WHERE ${column}=$2 AND department_id=$3`,[keeperId,sourceId,d]);continue;}
          // Core tables without department_id derive their location through the owning group/event.
          const ownerScope:Record<string,string>={
            group_members:`EXISTS(SELECT 1 FROM church_groups owner WHERE owner.id=target.group_id AND owner.department_id=$3)`,
            team_members:`EXISTS(SELECT 1 FROM church_teams owner WHERE owner.id=target.team_id AND owner.department_id=$3)`,
            group_meeting_attendance:`EXISTS(SELECT 1 FROM group_meetings owner WHERE owner.id=target.meeting_id AND owner.department_id=$3)`,
            event_position_responses:`EXISTS(SELECT 1 FROM service_events owner WHERE owner.id=target.event_id AND owner.department_id=$3)`,
            event_attendance_checkins:`EXISTS(SELECT 1 FROM service_events owner WHERE owner.id=target.event_id AND owner.department_id=$3)`,
          };
          const scope=ownerScope[ref.table_name];
          if(scope)await client.query(`UPDATE ${table} AS target SET ${column}=$1 WHERE target.${column}=$2 AND ${scope}`,[keeperId,sourceId,d]);
        }
        // A remaining reference belongs to another location or to a table whose
        // ownership cannot be proven. Stop before DELETE so an FK cascade can
        // never remove records outside the active location.
        for(const ref of refs.rows){
          const table=`${qi(ref.schema_name)}.${qi(ref.table_name)}`,column=qi(ref.column_name);
          const remaining=await client.query(`SELECT 1 FROM ${table} WHERE ${column}=$1 LIMIT 1`,[sourceId]);
          if(remaining.rowCount){await client.query("ROLLBACK");return reply.code(409).send({error:`A linked record in ${ref.table_name} could not be safely scoped to this location. Resolve that link before merging; no records were changed.`});}
        }
        await client.query("DELETE FROM people_record_relationships a USING people_record_relationships b WHERE a.department_id=$1 AND b.department_id=a.department_id AND a.id>b.id AND a.person_id=b.person_id AND a.related_person_id=b.related_person_id AND a.relationship=b.relationship",[d]);
        await client.query("DELETE FROM contacts WHERE department_id=$1 AND id=$2",[d,sourceId]);
        const auditId=randomUUID();await client.query("INSERT INTO people_record_merges(id,department_id,keeper_contact_id,merged_contact_id,actor_user_id,source_snapshot,profile_conflicts_confirmed) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)",[auditId,d,keeperId,sourceId,request.authenticatedUser?.id??null,JSON.stringify(source),confirmProfileConflicts]);
        await client.query("INSERT INTO people_record_history(id,department_id,contact_id,actor_user_id,action,subject,before_value,after_value) VALUES($1,$2,$3,$4,'person_merged',$5,$6::jsonb,$7::jsonb)",[randomUUID(),d,keeperId,request.authenticatedUser?.id??null,`${source.first_name} ${source.last_name}`,JSON.stringify({mergedContactId:sourceId,source}),JSON.stringify({keeperContactId:keeperId,profileConflictsConfirmed:confirmProfileConflicts})]);
        await client.query("COMMIT");committed=true;
      }catch(error){await client.query("ROLLBACK");if((error as {code?:string}).code?.startsWith("23"))return reply.code(409).send({error:"A linked record conflicts with the keeper and prevented the merge. No records were changed; resolve duplicate memberships or linked records and retry."});throw error;}finally{client.release();}
      if(committed){changed(d,keeperId);changed(d,sourceId);}return{ok:true,keeperId,mergedContactId:sourceId,message:"Source person merged into the selected keeper."};
    });
  });
}
