import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import type { ModuleServerContext } from "../module-sdk.js";

type JsonObject = Record<string, any>;
type Settings = { department_id: string; instance_url: string; encrypted_login_token: string; enabled: boolean };
const elvantoAreas = ["people", "peopleFlows", "groups", "services", "songs", "calendar", "financial"] as const;
type ElvantoArea = typeof elvantoAreas[number];
type ElvantoDirection = "off" | "bidirectional" | "elvanto_to_smart_church" | "smart_church_to_elvanto";
type ElvantoDirections = Record<ElvantoArea, ElvantoDirection>;
type ElvantoSettings = { department_id: string; encrypted_api_key: string; directions: ElvantoDirections; financial_enabled: boolean; enabled: boolean; last_connected_at: string | null; last_sync_at: string | null; last_sync_error: string | null; people_import_page: number; people_import_total: number | null; people_import_created_count: number; people_import_updated_count: number; people_import_skipped_count: number; people_import_complete: boolean; people_preview_at: string | null; people_preview_scanned_count: number; people_preview_total: number | null; people_preview_complete: boolean; people_importing: boolean; people_import_started_at: string | null; groups_import_page: number; groups_import_total: number | null; groups_import_created_count: number; groups_import_updated_count: number; groups_import_skipped_count: number; groups_import_complete: boolean; groups_preview_at: string | null; groups_preview_scanned_count: number; groups_preview_total: number | null; groups_preview_complete: boolean; groups_importing: boolean; groups_import_started_at: string | null; services_import_page: number; services_import_total: number | null; services_import_created_count: number; services_import_updated_count: number; services_import_skipped_count: number; services_import_complete: boolean; services_preview_at: string | null; services_preview_scanned_count: number; services_preview_total: number | null; services_preview_complete: boolean; services_importing: boolean; services_import_started_at: string | null; calendar_import_page: number; calendar_import_total: number | null; calendar_import_created_count: number; calendar_import_updated_count: number; calendar_import_skipped_count: number; calendar_import_complete: boolean; calendar_preview_at: string | null; calendar_preview_scanned_count: number; calendar_preview_total: number | null; calendar_preview_complete: boolean; calendar_preview_start_date: string | null; calendar_preview_end_date: string | null; calendar_import_start_date: string | null; calendar_import_end_date: string | null; calendar_importing: boolean; calendar_import_started_at: string | null; songs_import_page: number; songs_import_total: number | null; songs_import_created_count: number; songs_import_updated_count: number; songs_import_skipped_count: number; songs_import_complete: boolean; songs_preview_at: string | null; songs_preview_ids: string[]; songs_preview_complete: boolean; songs_preview_count: number; songs_imported_count: number; songs_last_import_at: string | null; songs_importing: boolean; songs_import_started_at: string | null; people_flows_import_page: number; people_flows_import_total: number | null; people_flows_import_created_count: number; people_flows_import_updated_count: number; people_flows_import_skipped_count: number; people_flows_import_complete: boolean; people_flows_preview_at: string | null; people_flows_preview_ids: string[]; people_flows_preview_complete: boolean; people_flows_preview_count: number; people_flows_imported_count: number; people_flows_last_import_at: string | null; people_flows_importing: boolean; people_flows_import_started_at: string | null; updated_at: Date | string };
const running = new Set<string>();
const elvantoPeopleImportRunning = new Set<string>();
const elvantoGroupsImportRunning = new Set<string>();
const elvantoServicesImportRunning = new Set<string>();
const elvantoCalendarImportRunning = new Set<string>();
const elvantoPeopleFlowsImportRunning = new Set<string>();
const elvantoSongsImportRunning = new Set<string>();
const elvantoFinancialImportRunning = new Set<string>();
const syncIntervalMs = 15 * 60 * 1000;

function cryptoKey() {
  const source = process.env.SMART_CHURCH_SYNC_ENCRYPTION_KEY || process.env.DATABASE_URL;
  if (!source) throw new Error("Set SMART_CHURCH_SYNC_ENCRYPTION_KEY to encrypt the ChurchTools token.");
  return scryptSync(source, "smart-church/churchtools-sync/v1", 32);
}
function encrypt(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", cryptoKey(), iv);
  const data = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}
function decrypt(value: string) {
  const [version, iv, tag, data] = value.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Re-enter the ChurchTools login token.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", cryptoKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch { throw new Error("Re-enter the ChurchTools login token."); }
}
function elvantoCryptoKey() {
  const source = process.env.SMART_CHURCH_SYNC_ENCRYPTION_KEY || process.env.DATABASE_URL;
  if (!source) throw new Error("Set SMART_CHURCH_SYNC_ENCRYPTION_KEY to encrypt the Elvanto API key.");
  return scryptSync(source, "smart-church/elvanto-sync/v1", 32);
}
function encryptElvantoKey(apiKey: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", elvantoCryptoKey(), iv);
  const data = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}
function decryptElvantoKey(value: string) {
  const [version, iv, tag, data] = value.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Reconnect Elvanto to replace its saved API key.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", elvantoCryptoKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch { throw new Error("Reconnect Elvanto to replace its saved API key."); }
}
function encryptElvantoFinancial(value: JsonObject) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", elvantoCryptoKey(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}
function decryptElvantoFinancial(value: string): JsonObject {
  const [version, iv, tag, data] = value.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Financial snapshot encryption is invalid.");
  const decipher = createDecipheriv("aes-256-gcm", elvantoCryptoKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8")) as JsonObject;
}
function normalizeElvantoDirections(value: unknown): ElvantoDirections {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Choose a sync direction for each Elvanto data area.");
  const input = value as Record<string, unknown>;
  const output = {} as ElvantoDirections;
  const directions = new Set<ElvantoDirection>(["off", "bidirectional", "elvanto_to_smart_church", "smart_church_to_elvanto"]);
  for (const area of elvantoAreas) {
    const direction = input[area];
    if (typeof direction !== "string" || !directions.has(direction as ElvantoDirection)) throw new Error(`Choose a valid sync direction for ${area}.`);
    output[area] = direction as ElvantoDirection;
  }
  return output;
}
async function testElvantoConnection(apiKey: string) {
  const payload = await elvantoRequest(apiKey, "people/getAll", { page: 1, page_size: 1 });
  if (payload.status !== "ok") throw new Error("Elvanto did not confirm the connection. Check the API key and People read permission.");
  return true;
}
async function elvantoRequest(apiKey: string, endpoint: string, body: JsonObject = {}) {
  const response = await fetch(`https://api.elvanto.com/v1/${endpoint}.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${apiKey}:x`).toString("base64")}`, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
    redirect: "error",
  });
  const payload = await response.json() as JsonObject;
  const nestedError = payload.error && typeof payload.error === "object" ? payload.error as JsonObject : {};
  const apiMessage = [payload.message, typeof payload.error === "string" ? payload.error : "", nestedError.message, nestedError.description].filter((value): value is string => typeof value === "string").join(" ");
  if (/\bno (people|groups?|services?|songs?|events?|transactions?|arrangements?|keys?)\b.*\b(found|match|criteria)\b/i.test(apiMessage)) return { status: "ok" };
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "Elvanto rejected the API key or does not allow this API read. Check the key and account permissions." : `Elvanto returned HTTP ${response.status} for ${endpoint}.`);
  if (payload.status !== "ok") throw new Error(`Elvanto did not confirm the ${endpoint} request. Check the key and account permissions.`);
  return payload;
}
function elvantoCollection(payload: JsonObject, key: string, singular: string) {
  const container = payload[key];
  if (!container || typeof container !== "object") return [] as JsonObject[];
  const items = (container as JsonObject)[singular];
  if (Array.isArray(items)) return items.filter((item): item is JsonObject => Boolean(item) && typeof item === "object");
  return items && typeof items === "object" ? [items as JsonObject] : [];
}
function elvantoGroupPeople(group: JsonObject) {
  const people = group.people;
  if (!people || typeof people !== "object") return [] as JsonObject[];
  const rows = (people as JsonObject).person;
  if (Array.isArray(rows)) return rows.filter((person): person is JsonObject => Boolean(person) && typeof person === "object");
  return rows && typeof rows === "object" ? [rows as JsonObject] : [];
}
function objectRows(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.filter((item): item is JsonObject => Boolean(item) && typeof item === "object");
  if (!value || typeof value !== "object") return [];
  const object = value as JsonObject;
  if (["id", "time_id", "service_time_id", "person_id", "position_id", "title", "name", "starts", "position_name", "person", "status"].some((key) => key in object)) return [object];
  return Object.values(object).filter((item): item is JsonObject => Boolean(item) && typeof item === "object");
}
function elvantoServiceTimes(service: JsonObject) {
  const value = service.service_times;
  if (!value || typeof value !== "object") return [] as JsonObject[];
  const rows = objectRows((value as JsonObject).service_time ?? value);
  return rows.map((time, index) => ({ ...time, id: time.id ?? time.time_id ?? time.service_time_id ?? String(index + 1) }));
}
function elvantoTime(value: unknown, fallbackDate?: string) {
  if (typeof value !== "string" || !value.trim()) return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  if (match) return { date: match[1], time: match[2] };
  const date = value.match(/^\d{4}-\d{2}-\d{2}$/)?.[0] ?? fallbackDate;
  const time = value.match(/(?:^|T| )(\d{2}:\d{2})(?::\d{2})?$/)?.[1];
  return date ? { date, time: time ?? "09:00" } : null;
}
function elvantoPlanForTime(service: JsonObject, timeId: string) {
  const plans = service.plans;
  if (!plans || typeof plans !== "object") return [] as JsonObject[];
  const planRows = objectRows((plans as JsonObject).plan ?? plans);
  const matching = planRows.find((plan) => String(plan.time_id ?? plan.service_time_id ?? plan.id ?? "") === timeId)
    ?? (plans as JsonObject)[timeId] as JsonObject | undefined;
  if (!matching || typeof matching !== "object") return [] as JsonObject[];
  return objectRows((matching as JsonObject).items ?? (matching as JsonObject).item ?? matching);
}
function elvantoDuration(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.round(value);
  if (typeof value !== "string") return undefined;
  const parts = value.split(":").map(Number);
  if (!parts.length || parts.length > 3 || parts.some((part) => !Number.isFinite(part) || part < 0)) return undefined;
  const minutes = parts.length === 3 ? parts[0] * 60 + parts[1] + (parts[2] >= 30 ? 1 : 0) : parts.length === 2 ? parts[0] + (parts[1] >= 30 ? 1 : 0) : parts[0];
  return minutes > 0 ? minutes : undefined;
}
function mapElvantoServices(service: JsonObject, contacts: Map<string, string>) {
  const serviceId = idOf(service);
  if (!serviceId) return [] as Array<JsonObject & { sourceId: string }>;
  const times = elvantoServiceTimes(service);
  const occurrences: JsonObject[] = times.length ? times : [{ id: "default", starts: service.date ?? service.starts ?? service.start, ends: service.ends ?? service.end }];
  const volunteerPlans = objectRows((service.volunteers as JsonObject | undefined)?.plan ?? service.volunteers);
  const baseDate = firstText(service.date).slice(0, 10);
  return occurrences.flatMap((time) => {
    const timeId = String(time.id ?? time.time_id ?? "default");
    const start = elvantoTime(time.starts ?? time.start ?? time.date, baseDate);
    if (!start) return [];
    const end = elvantoTime(time.ends ?? time.end, start.date);
    const plan = elvantoPlanForTime(service, timeId);
    const volunteerPlan = volunteerPlans.find((plan) => String(plan.time_id ?? plan.service_time_id ?? "") === timeId);
    const volunteerPositions = objectRows((volunteerPlan?.positions as JsonObject | undefined)?.position ?? volunteerPlan?.positions);
    const positions = volunteerPositions.flatMap((position) => {
      const role = firstText(position.position_name, position.name, position.title);
      if (!role) return [];
      const assigned = objectRows((position.volunteers as JsonObject | undefined)?.volunteer ?? position.volunteers);
      if (!assigned.length) return [{ name: role.slice(0, 80) }];
      return assigned.map((volunteer) => {
        const person = volunteer.person && typeof volunteer.person === "object" ? volunteer.person as JsonObject : {};
        const personId = person.id ?? volunteer.personId ?? volunteer.person_id ?? volunteer.memberId;
        const contactId = personId ? contacts.get(String(personId)) : undefined;
        const firstName = firstText(person.preferred_name, person.preferredName, person.firstname, person.first_name);
        const lastName = firstText(person.lastname, person.last_name);
        const personName = [firstName, lastName].filter(Boolean).join(" ");
        return { name: (contactId || !personName ? role : `${role} — ${personName}`).slice(0, 80), ...(contactId ? { contactId } : {}) };
      });
    });
    const timePlan = plan.flatMap((item) => {
      const song = item.song && typeof item.song === "object" ? item.song as JsonObject : {};
      const title = firstText(item.title, item.name, song.title, song.name);
      if (!title) return [];
      const durationMinutes = elvantoDuration(item.duration_minutes ?? item.duration);
      const notes = firstText(item.description, item.notes);
      return [{ title: title.slice(0, 140), ...(durationMinutes ? { durationMinutes } : {}), ...(notes ? { notes: plainDescription(notes).slice(0, 500) } : {}) }];
    });
    const serviceTitle = firstText(service.name, service.title) || "Elvanto service";
    const timeName = times.length > 1 ? firstText(time.name, time.title) : "";
    return [{
      sourceId: `${serviceId}:${timeId}`,
      title: `${serviceTitle}${timeName ? ` — ${timeName}` : ""}`.slice(0, 160),
      date: start.date, start: start.time, end: end?.date === start.date && end.time > start.time ? end.time : null,
      location: firstText(time.location?.name, time.location, service.location?.name, service.location, service.venue) || "Elvanto",
      room: firstText(time.room?.name, time.room, service.room?.name, service.room),
      description: plainDescription(firstText(service.description, service.notes)).slice(0, 2000), positions, timePlan,
    }];
  });
}
function mapElvantoCalendarEvent(event: JsonObject) {
  const id = idOf(event);
  const start = elvantoTime(event.start_date ?? event.startDate ?? event.starts);
  if (!id || !start) return null;
  const end = elvantoTime(event.end_date ?? event.endDate ?? event.ends, start.date);
  const allDay = event.all_day === 1 || event.all_day === "1" || event.all_day === true;
  const locations = objectRows((event.locations as JsonObject | undefined)?.location ?? event.locations).map((location) => firstText(location.name)).filter(Boolean);
  return {
    sourceId: `calendar:${id}`,
    title: firstText(event.name, event.title).slice(0, 160),
    date: start.date,
    start: allDay ? "00:00" : start.time,
    end: !allDay && end?.date === start.date && end.time > start.time ? end.time : null,
    location: firstText(event.where, locations.join(", ")) || "Elvanto calendar",
    room: "",
    description: plainDescription(event.description).slice(0, 2000),
  };
}
function flattenElvantoFlowSteps(value: unknown, parentStepId: string | null = null): JsonObject[] {
  return objectRows(value).flatMap((step) => {
    const id = idOf(step);
    const descendants = flattenElvantoFlowSteps(step.steps, id || parentStepId);
    return [{ ...step, parent_step_id: parentStepId }, ...descendants];
  });
}
async function fetchElvantoPeopleFlows(apiKey: string, flowOffset = 0, flowLimit = 500) {
  const flowPayload = await elvantoRequest(apiKey, "peopleFlows/getAll");
  const flowContainer = flowPayload.people_flows as JsonObject | undefined;
  const flows = elvantoCollection(flowPayload, "people_flows", "people_flow");
  const reportedFlows = Number(flowContainer?.total);
  if (Number.isFinite(reportedFlows) && reportedFlows > flows.length) throw new Error("Elvanto returned an incomplete People Flows list.");
  if (flows.length > 500) throw new Error("People Flows import is limited to 500 flows per preview.");
  const results: Array<{ sourceId: string; name: string; definition: JsonObject; members: JsonObject[] }> = [];
  let stepCount = 0;
  let memberCount = 0;
  for (const flow of flows.slice(flowOffset, flowOffset + flowLimit)) {
    const sourceId = idOf(flow);
    const name = firstText(flow.name).slice(0, 160);
    if (!sourceId || !name) throw new Error("Elvanto returned a People Flow without a stable ID or name.");
    const stepPayload = await elvantoRequest(apiKey, "peopleFlows/steps/getAll", { flow_id: sourceId });
    const rootSteps = elvantoCollection(stepPayload, "people_flow_steps", "people_flow_step");
    const steps = flattenElvantoFlowSteps(rootSteps);
    stepCount += steps.length;
    if (stepCount > 2000) throw new Error("People Flows import is limited to 2,000 steps per run.");
    const members: JsonObject[] = [];
    for (const step of steps) {
      const stepId = idOf(step);
      if (!stepId) continue;
      const memberPayload = await elvantoRequest(apiKey, "peopleFlows/steps/people", { step_id: stepId });
      const rows = elvantoCollection(memberPayload, "people_flow_step_members", "people_flow_step_member");
      memberCount += rows.length;
      if (memberCount > 20000) throw new Error("People Flows import is limited to 20,000 step assignments per run.");
      for (const member of rows) {
        const personId = idOf(member);
        const memberId = firstText(member.flow_step_member_id, `${stepId}:${personId}`);
        if (!personId) continue;
        members.push({
          flowId: sourceId,
          stepId,
          stepName: firstText(step.name).slice(0, 160),
          personId,
          membershipId: memberId,
          status: firstText(member.status).slice(0, 40),
          assignedAdminId: firstText(member.assigned_admin_id),
          dueDate: firstText(member.due_date),
          completedDate: firstText(member.completed_date),
          completedBy: firstText(member.completed_member),
          dateAdded: firstText(member.date_added),
        });
      }
    }
    results.push({
      sourceId,
      name,
      definition: {
        status: firstText(flow.status),
        access: firstText(flow.access),
        admins: (Array.isArray(flow.admins) ? flow.admins : objectRows(flow.admins)).map((item) => typeof item === "string" ? item : idOf(item)).filter(Boolean),
        locations: Array.isArray(flow.locations) ? flow.locations : objectRows(flow.locations),
        demographics: Array.isArray(flow.demographics) ? flow.demographics : objectRows(flow.demographics),
        steps: steps.map((step) => ({
          id: idOf(step),
          parentStepId: firstText(step.parent_step_id) || null,
          priority: firstText(step.priority),
          name: firstText(step.name).slice(0, 160),
          status: firstText(step.status),
          description: firstText(step.description).slice(0, 2000),
          instructions: firstText(step.instructions).slice(0, 4000),
          entryPoint: firstText(step.entry_point),
          notifications: firstText(step.notifications),
          due: step.step_due && typeof step.step_due === "object" ? step.step_due : {},
          admins: objectRows(step.admins).map((item) => ({ id: idOf(item) || firstText(item), role: firstText(item.role) })),
        })),
      },
      members,
    });
  }
  return { flows: results, stepCount, memberCount, flowIds: flows.map(idOf), reportedFlows: Number.isFinite(reportedFlows) ? reportedFlows : flows.length };
}
async function fetchElvantoPagedRows(apiKey: string, endpoint: string, container: string, singular: string, parameters: JsonObject = {}) {
  const rows: JsonObject[] = [];
  let reportedTotal: number | null = null;
  let complete = false;
  for (let page = 1; page <= 200; page += 1) {
    const payload = await elvantoRequest(apiKey, endpoint, { ...parameters, page, page_size: 1000 });
    const batch = elvantoCollection(payload, container, singular);
    rows.push(...batch);
    const reported = Number((payload[container] as JsonObject | undefined)?.total);
    if (Number.isFinite(reported) && reported >= 0) reportedTotal = reported;
    if (batch.length < 1000 || reportedTotal !== null && page * 1000 >= reportedTotal) { complete = true; break; }
  }
  return { rows, reportedTotal, complete };
}
const elvantoPeopleFields = ["gender", "birthday", "anniversary", "school_grade", "marital_status", "development_child", "special_needs_child", "mailing_address", "demographics", "service_types", "locations"];
async function fetchElvantoPeopleCustomFields(apiKey: string) {
  const result = await fetchElvantoPagedRows(apiKey, "people/customFields/getAll", "custom_fields", "custom_field");
  const fields = result.rows.map((field) => ({ id: idOf(field), name: firstText(field.name), type: firstText(field.type) })).filter((field) => field.id && field.name);
  return { fields, complete: result.complete };
}
function mapElvantoPeopleProfile(person: JsonObject, customFields: Array<{ id: string; name: string; type: string }>): JsonObject {
  const profile: JsonObject = {};
  const textFields: Record<string, string[]> = {
    preferredName: ["preferred_name", "preferredName"], middleName: ["middle_name", "middleName"],
    categoryId: ["category_id", "categoryId"], accountStatus: ["status"], country: ["country"], timezone: ["timezone"],
    familyId: ["family_id", "familyId"], familyRelationship: ["family_relationship", "familyRelationship"],
    birthday: ["birthday"], anniversary: ["anniversary"], gender: ["gender"], schoolGrade: ["school_grade"],
    maritalStatus: ["marital_status"], mailingAddress: ["mailing_address"],
  };
  for (const [key, sources] of Object.entries(textFields)) {
    const value = firstText(...sources.map((source) => person[source]));
    if (value) profile[key] = value;
  }
  for (const [key, source] of [["archived", "archived"], ["contact", "contact"], ["volunteer", "volunteer"]] as const) {
    if (person[source] !== undefined && person[source] !== null) profile[key] = person[source] === true || person[source] === 1 || person[source] === "1";
  }
  for (const [key, source] of [["developmentChild", "development_child"], ["specialNeedsChild", "special_needs_child"]] as const) {
    const value = firstText(person[source]);
    if (value) profile[key] = value;
  }
  for (const key of ["demographics", "service_types", "locations"] as const) {
    if (person[key] !== undefined && person[key] !== null) profile[key === "service_types" ? "serviceTypes" : key] = person[key];
  }
  const custom = customFields.flatMap((field) => {
    const value = person[`custom_${field.id}`];
    return value === undefined || value === null || value === "" ? [] : [{ id: field.id, name: field.name, type: field.type, value }];
  });
  if (custom.length) profile.customFields = custom;
  return profile;
}
async function fetchElvantoFinancialTransactions(apiKey: string, startDate: string, endDate: string, firstPage = 1, pageLimit = 200) {
  const transactions: JsonObject[] = [];
  let reportedTotal: number | null = null;
  let complete = false;
  let pagesFetched = 0;
  for (let page = firstPage; page < firstPage + pageLimit; page += 1) {
    const payload = await elvantoRequest(apiKey, "financial/transactions/getAll", { start: startDate, end: endDate, page, page_size: 1000 });
    const batch = elvantoCollection(payload, "transactions", "transaction");
    transactions.push(...batch); pagesFetched += 1;
    const reported = Number((payload.transactions as JsonObject | undefined)?.total);
    if (Number.isFinite(reported) && reported >= 0) reportedTotal = reported;
    if (batch.length < 1000 || reportedTotal !== null && page * 1000 >= reportedTotal) { complete = true; break; }
  }
  if (firstPage === 1 && transactions.length > 200000) throw new Error("Elvanto returned more than 200,000 financial transactions in this date range.");
  const ids = transactions.map(idOf);
  if (ids.some((id) => !id)) throw new Error("Elvanto returned a financial transaction without a stable ID.");
  return { transactions, ids, reportedTotal, complete, pagesFetched };
}
async function fetchElvantoSongs(apiKey: string, songOffset = 0, songLimit = 5, includeDetails = true) {
  const songPage = await fetchElvantoPagedRows(apiKey, "songs/getAll", "songs", "song", { files: false });
  if (songPage.rows.length > 200000) throw new Error("Elvanto returned more than 200,000 songs.");
  if (songPage.reportedTotal !== null && songPage.reportedTotal > songPage.rows.length) throw new Error("Elvanto returned an incomplete Songs list.");
  const songIds = songPage.rows.map(idOf);
  if (songIds.some((id) => !id)) throw new Error("Elvanto returned a song without a stable ID.");
  const songs: Array<{ sourceId: string; title: string; song: JsonObject; arrangements: JsonObject[] }> = [];
  let arrangementCount = 0;
  let keyCount = 0;
  for (const rawSong of songPage.rows.slice(songOffset, songOffset + songLimit)) {
    const sourceId = idOf(rawSong);
    const title = firstText(rawSong.title).slice(0, 200);
    if (!title) throw new Error("Elvanto returned a song without a title.");
    const arrangements: JsonObject[] = [];
    if (includeDetails) {
      const arrangementPage = await fetchElvantoPagedRows(apiKey, "songs/arrangements/getAll", "arrangements", "arrangement", { song_id: sourceId, files: false });
      if (!arrangementPage.complete) throw new Error(`Arrangements for “${title}” exceed the supported page limit.`);
      for (const arrangement of arrangementPage.rows) {
        const arrangementId = idOf(arrangement);
        if (!arrangementId) continue;
        const keysPage = await fetchElvantoPagedRows(apiKey, "songs/keys/getAll", "keys", "key", { arrangement_id: arrangementId, files: false });
        if (!keysPage.complete) throw new Error(`Keys for “${title}” exceed the supported page limit.`);
        arrangements.push({ ...arrangement, keys: keysPage.rows });
        keyCount += keysPage.rows.length;
      }
      arrangementCount += arrangements.length;
    }
    songs.push({
      sourceId,
      title,
      song: {
        status: rawSong.status,
        dateAdded: firstText(rawSong.date_added),
        dateModified: firstText(rawSong.date_modified),
        permalink: firstText(rawSong.permalink),
        number: firstText(rawSong.number),
        artist: firstText(rawSong.artist),
        album: firstText(rawSong.album),
        notes: firstText(rawSong.notes).slice(0, 4000),
        categories: Array.isArray(rawSong.categories) ? rawSong.categories : objectRows((rawSong.categories as JsonObject | undefined)?.category ?? rawSong.categories),
        locations: Array.isArray(rawSong.locations) ? rawSong.locations : objectRows((rawSong.locations as JsonObject | undefined)?.location ?? rawSong.locations),
      },
      arrangements,
    });
  }
  return { songs, songIds, songCount: songPage.rows.length, reportedSongs: songPage.reportedTotal ?? songPage.rows.length, complete: songPage.complete, arrangementCount, keyCount };
}
async function checkElvantoArea(apiKey: string, area: ElvantoArea): Promise<{ area: ElvantoArea; accessible: boolean; recordCount?: number; detail?: string }> {
  const today = new Date().toISOString().slice(0, 10);
  const recentStart = new Date(Date.now() - 5 * 365 * 86400000).toISOString().slice(0, 10);
  let payload: JsonObject;
  let collection: string;
  let singular: string;
  switch (area) {
    case "people": payload = await elvantoRequest(apiKey, "people/getAll", { page: 1, page_size: 1 }); collection = "people"; singular = "person"; break;
    case "peopleFlows": payload = await elvantoRequest(apiKey, "peopleFlows/getAll"); collection = "people_flows"; singular = "people_flow"; break;
    case "groups": payload = await elvantoRequest(apiKey, "groups/getAll", { page: 1, page_size: 1, fields: ["people"] }); collection = "groups"; singular = "group"; break;
    case "services": payload = await elvantoRequest(apiKey, "services/getAll", { page: 1, page_size: 1, all: "yes", fields: ["series_name", "service_times", "plans", "volunteers", "songs", "notes"] }); collection = "services"; singular = "service"; break;
    case "songs": {
      payload = await elvantoRequest(apiKey, "songs/getAll", { page: 1, page_size: 1 });
      collection = "songs"; singular = "song";
      const songs = elvantoCollection(payload, collection, singular);
      if (songs[0]?.id) {
        await elvantoRequest(apiKey, "songs/arrangements/getAll", { page: 1, page_size: 1, song_id: String(songs[0].id) });
        return { area, accessible: true, recordCount: Number((payload.songs as JsonObject | undefined)?.total ?? 0), detail: "Song and arrangement reads are available." };
      }
      return { area, accessible: true, recordCount: Number((payload.songs as JsonObject | undefined)?.total ?? 0), detail: "Song access is available; no song was returned to check arrangements." };
    }
    case "calendar": payload = await elvantoRequest(apiKey, "calendar/events/getAll", { page: 1, page_size: 1, start: recentStart, end: today }); collection = "events"; singular = "event"; break;
    case "financial": payload = await elvantoRequest(apiKey, "financial/transactions/getAll", { page: 1, page_size: 1, start: recentStart, end: today }); collection = "transactions"; singular = "transaction"; break;
  }
  const container = payload[collection] as JsonObject | undefined;
  const total = Number(container?.total ?? container?.on_this_page ?? elvantoCollection(payload, collection, singular).length);
  return { area, accessible: true, recordCount: Number.isFinite(total) ? total : 0 };
}
function normalizeUrl(value: string) {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("Enter a valid ChurchTools URL."); }
  if (url.protocol !== "https:" || (url.hostname !== "church.tools" && !url.hostname.endsWith(".church.tools"))) {
    throw new Error("Use a secure ChurchTools cloud URL, such as https://my-church.church.tools.");
  }
  url.pathname = url.pathname.replace(/\/+$/, ""); url.search = ""; url.hash = "";
  return url.toString().replace(/\/$/, "");
}
async function get(base: string, token: string, path: string): Promise<JsonObject> {
  const response = await fetch(base.replace(/\/+$/, "") + "/api/" + path.replace(/^\/+/, ""), {
    headers: { Authorization: "Login " + token, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000), redirect: "error",
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error("ChurchTools rejected the token or does not grant read access to " + path.split("?")[0] + ".");
    throw new Error("ChurchTools returned HTTP " + response.status + " for " + path.split("?")[0] + ".");
  }
  return await response.json() as JsonObject;
}
function rows(payload: JsonObject): JsonObject[] {
  const options = [payload.data, payload.data?.data, payload.persons, payload.groups, payload.events, payload.appointments, payload.resources, payload.members, payload.data?.persons, payload.data?.groups, payload.data?.events, payload.data?.resources, payload.data?.appointments, payload.data?.members, payload.items];
  return (options.find(Array.isArray) ?? []).filter((value: unknown) => value && typeof value === "object");
}
function idOf(row: JsonObject) {
  const value = row.id ?? row.personId ?? row.groupId ?? row.eventId ?? row.appointmentId ?? row.resourceId;
  return value === undefined || value === null ? "" : String(value);
}
function firstText(...values: any[]) {
  return (values.find((value) => typeof value === "string" && value.trim()) ?? "").trim();
}
function plainDescription(value: unknown) {
  if (typeof value !== "string") return "";
  return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">") .replace(/\s+/g, " ").trim();
}
function personIdOf(row: JsonObject) {
  const value = row.personId ?? row.person?.id ?? row.person_id ?? row.memberId ?? row.person?.personId ?? row.id;
  return value === undefined || value === null ? "" : String(value);
}
async function mapConcurrent<T, R>(items: T[], concurrency: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const result = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) { const index = next++; result[index] = await run(items[index]); }
  }));
  return result;
}
function resourceCategory(row: JsonObject): "room" | "vehicle" | "equipment" | "other" {
  const value = firstText(row.resourceType?.name, row.type?.name, row.type, row.category).toLocaleLowerCase();
  if (/room|space|meeting|raum|zimmer|saal/.test(value)) return "room";
  if (/vehicle|car|bus|auto|fahrzeug/.test(value)) return "vehicle";
  if (/equipment|device|technical|technik|equipment|gerät/.test(value)) return "equipment";
  return "other";
}
async function list(base: string, token: string, endpoint: string) {
  const result: JsonObject[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const payload = await get(base, token, endpoint + (endpoint.includes("?") ? "&" : "?") + "limit=200&page=" + page);
    const entries = rows(payload);
    result.push(...entries);
    const meta = payload.meta?.pagination ?? payload.meta ?? payload.data?.meta?.pagination ?? {};
    const last = Number(meta.lastPage ?? meta.last_page ?? meta.totalPages ?? 0);
    if ((last && page >= last) || entries.length < 200) break;
  }
  return result;
}
async function testLogin(base: string, token: string) {
  if (!token.trim()) throw new Error("Enter a ChurchTools login token.");
  await get(base, token.trim(), "whoami");
}
function dateTime(value: any, dateFallback?: string, timeFallback?: string) {
  if (typeof value === "string" && value) {
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) return { date: value.slice(0, 10), time: value.length >= 16 ? value.slice(11, 16) : timeFallback?.slice(0, 5) || "09:00" };
  }
  if (dateFallback && /^\d{4}-\d{2}-\d{2}$/.test(dateFallback)) return { date: dateFallback, time: timeFallback?.slice(0, 5) || "09:00" };
  return null;
}
function mapEvents(events: JsonObject[]) {
  return events.flatMap((row) => {
    const sourceId = idOf(row);
    const start = dateTime(row.startDate ?? row.start ?? row.startDateTime ?? row.date, row.date, row.startTime);
    if (!sourceId || !start) return [];
    const end = dateTime(row.endDate ?? row.end ?? row.endDateTime, start.date, row.endTime);
    const assignments: JsonObject[] = Array.isArray(row.services) ? row.services : Array.isArray(row.eventServices) ? row.eventServices : [];
    const agenda: JsonObject[] = Array.isArray(row.agenda?.items) ? row.agenda.items : Array.isArray(row.agendaItems) ? row.agendaItems : [];
    return [{
      sourceId, title: firstText(row.name, row.title, row.subject) || "ChurchTools service",
      date: start.date, start: start.time, end: end?.date === start.date && end.time > start.time ? end.time : null,
      location: firstText(row.location?.name, row.location, row.place, row.calendarName, row.calendar?.name) || "ChurchTools",
      room: firstText(row.room?.name, row.room), description: firstText(row.description, row.note).slice(0, 2000),
      positions: assignments.flatMap((item) => {
        const name = firstText(item.serviceName, item.service?.name, item.name, item.title);
        const personId = item.personId ?? item.person?.id;
        return name ? [{ name, ...(personId ? { personId: String(personId) } : {}) }] : [];
      }),
      timePlan: agenda.flatMap((item) => {
        const title = firstText(item.name, item.title, item.label);
        if (!title) return [];
        const when = dateTime(item.startDateTime ?? item.start ?? item.time, start.date, item.startTime);
        const duration = Number(item.durationMinutes ?? item.duration);
        return [{ title, ...(when ? { startTime: when.time } : {}), ...(duration > 0 ? { durationMinutes: duration } : {}), ...(firstText(item.description, item.note) ? { notes: firstText(item.description, item.note).slice(0, 500) } : {}) }];
      }),
    }];
  });
}

export function registerModuleRoutes(app: FastifyInstance, deps: ModuleServerContext) {
  const { pool, isDatabaseReady, resolveDepartmentId } = deps;
  app.register(async (routes) => {
    async function department(request: FastifyRequest, reply: FastifyReply, manage = false) {
      if (!pool || !isDatabaseReady()) { reply.code(503).send({ error: "The database is unavailable." }); return null; }
      return resolveDepartmentId(request, reply, manage);
    }
    async function settings(departmentId: string) {
      const result = await pool!.query<Settings>("SELECT department_id,instance_url,encrypted_login_token,enabled FROM churchtools_sync_settings WHERE department_id=$1", [departmentId]);
      return result.rows[0] ?? null;
    }
    async function elvantoSettings(departmentId: string) {
      const result = await pool!.query<ElvantoSettings>("SELECT department_id,encrypted_api_key,directions,financial_enabled,enabled,last_connected_at,last_sync_at,last_sync_error,people_import_page,people_import_total,people_import_created_count,people_import_updated_count,people_import_skipped_count,people_import_complete,people_preview_at,people_preview_scanned_count,people_preview_total,people_preview_complete,people_importing,people_import_started_at,groups_import_page,groups_import_total,groups_import_created_count,groups_import_updated_count,groups_import_skipped_count,groups_import_complete,groups_preview_at,groups_preview_scanned_count,groups_preview_total,groups_preview_complete,groups_importing,groups_import_started_at,services_import_page,services_import_total,services_import_created_count,services_import_updated_count,services_import_skipped_count,services_import_complete,services_preview_at,services_preview_scanned_count,services_preview_total,services_preview_complete,services_importing,services_import_started_at,calendar_import_page,calendar_import_total,calendar_import_created_count,calendar_import_updated_count,calendar_import_skipped_count,calendar_import_complete,calendar_preview_at,calendar_preview_scanned_count,calendar_preview_total,calendar_preview_complete,calendar_preview_start_date::text,calendar_preview_end_date::text,calendar_import_start_date::text,calendar_import_end_date::text,calendar_importing,calendar_import_started_at,songs_import_page,songs_import_total,songs_import_created_count,songs_import_updated_count,songs_import_skipped_count,songs_import_complete,songs_preview_at,songs_preview_ids,songs_preview_complete,songs_preview_count,songs_imported_count,songs_last_import_at,songs_importing,songs_import_started_at,people_flows_import_page,people_flows_import_total,people_flows_import_created_count,people_flows_import_updated_count,people_flows_import_skipped_count,people_flows_import_complete,people_flows_preview_at,people_flows_preview_ids,people_flows_preview_complete,people_flows_preview_count,people_flows_imported_count,people_flows_last_import_at,people_flows_importing,people_flows_import_started_at,updated_at FROM elvanto_sync_settings WHERE department_id=$1", [departmentId]);
      return result.rows[0] ?? null;
    }
    async function statusError(departmentId: string, message: string) {
      await pool!.query("UPDATE churchtools_sync_settings SET last_sync_error=$2,updated_at=now() WHERE department_id=$1", [departmentId, message.slice(0, 1000)]);
    }
    async function run(departmentId: string) {
      if (!pool || !isDatabaseReady()) throw new Error("The database is unavailable.");
      if (running.has(departmentId)) throw new Error("A ChurchTools sync is already running.");
      running.add(departmentId);
      try {
        const config = await settings(departmentId);
        if (!config) throw new Error("Configure the ChurchTools connection first.");
        if (!config.enabled) throw new Error("ChurchTools sync is disabled.");
        const token = decrypt(config.encrypted_login_token);
        const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
        const to = new Date(Date.now() + 400 * 86400000).toISOString().slice(0, 10);
        const [people, groups, events, resources] = await Promise.all([
          list(config.instance_url, token, "persons"), list(config.instance_url, token, "groups"),
          get(config.instance_url, token, "events?from=" + from + "&to=" + to).then(rows),
          list(config.instance_url, token, "resources"),
        ]);
        const groupMembers = await mapConcurrent(groups, 8, async (group) => {
          const sourceId = idOf(group);
          if (!sourceId) return null;
          const embedded = Array.isArray(group.members) ? group.members : Array.isArray(group.persons) ? group.persons : null;
          if (embedded) return embedded as JsonObject[];
          try { return await list(config.instance_url, token, `groups/${encodeURIComponent(sourceId)}/members`); }
          catch (error) {
            if (error instanceof Error && error.message.includes("HTTP 404")) throw new Error(`ChurchTools did not return a member list for group “${firstText(group.name, group.title) || sourceId}”. Check the API path and group read permissions.`);
            throw error;
          }
        });
        const services = mapEvents(events);
        const db = await pool.connect();
        try {
          await db.query("BEGIN");
          const personMap = new Map<string, string>();
          for (const person of people) {
            const sourceId = idOf(person);
            if (!sourceId) continue;
            const first = firstText(person.firstName, person.first_name, person.firstname, person.givenName) || "ChurchTools";
            const last = firstText(person.lastName, person.last_name, person.lastname, person.familyName) || ("Person " + sourceId);
            const email = firstText(person.email, person.emailAddress) || null;
            const phone = firstText(person.mobile, person.phonePrivate, person.phoneWork, person.phone) || null;
            const found = await db.query<{ id: string }>("SELECT id FROM contacts WHERE department_id=$1 AND ((source_system='churchtools' AND source_id=$2) OR (source_system IS NULL AND $3::text IS NOT NULL AND lower(email)=lower($3))) ORDER BY CASE WHEN source_system='churchtools' THEN 0 ELSE 1 END LIMIT 1 FOR UPDATE", [departmentId, sourceId, email]);
            let localId: string;
            if (found.rowCount) {
              localId = found.rows[0].id;
              await db.query("UPDATE contacts SET first_name=$3,last_name=$4,email=$5,phone=$6,status='member',source_system='churchtools',source_id=$7,updated_at=now() WHERE id=$1 AND department_id=$2", [localId, departmentId, first, last, email, phone, sourceId]);
            } else {
              const inserted = await db.query<{ id: string }>("INSERT INTO contacts (id,department_id,first_name,last_name,email,phone,status,source_system,source_id) VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,'member','churchtools',$6) RETURNING id", [departmentId, first, last, email, phone, sourceId]);
              localId = inserted.rows[0].id;
            }
            personMap.set(sourceId, localId);
          }
          if (people.length) await db.query("DELETE FROM contacts WHERE department_id=$1 AND source_system='churchtools' AND source_id<>ALL($2::text[])", [departmentId, people.map(idOf).filter(Boolean)]);
          for (const [groupIndex, group] of groups.entries()) {
            const sourceId = idOf(group); const name = firstText(group.name, group.title);
            if (!sourceId || !name) continue;
            const description = firstText(group.description, group.information, group.note).slice(0, 1000);
            const found = await db.query<{ id: string }>("SELECT id FROM church_groups WHERE department_id=$1 AND source_system='churchtools' AND source_id=$2 FOR UPDATE", [departmentId, sourceId]);
            let groupId: string;
            if (found.rowCount) {
              groupId = found.rows[0].id;
              await db.query("UPDATE church_groups SET name=$3,description=$4,updated_at=now() WHERE id=$1 AND department_id=$2", [groupId, departmentId, name.slice(0, 120), description]);
            } else {
              const matching = await db.query<{ id: string }>("SELECT id FROM church_groups WHERE department_id=$1 AND source_system IS NULL AND lower(name)=lower($2) ORDER BY created_at LIMIT 1 FOR UPDATE", [departmentId, name]);
              if (matching.rowCount) {
                groupId = matching.rows[0].id;
                await db.query("UPDATE church_groups SET name=$3,description=$4,source_system='churchtools',source_id=$5,updated_at=now() WHERE id=$1 AND department_id=$2", [groupId, departmentId, name.slice(0, 120), description, sourceId]);
              } else {
                const inserted = await db.query<{ id: string }>("INSERT INTO church_groups (id,department_id,name,description,source_system,source_id) VALUES (gen_random_uuid(),$1,$2,$3,'churchtools',$4) RETURNING id", [departmentId, name.slice(0, 120), description, sourceId]);
                groupId = inserted.rows[0].id;
              }
            }
            const importedMembers = groupMembers[groupIndex];
            if (importedMembers !== null) {
              await db.query("DELETE FROM group_members WHERE group_id=$1", [groupId]);
              for (const member of importedMembers) {
                const personId = personIdOf(member);
                const contactId = personMap.get(personId);
                if (!contactId) continue;
                await db.query("INSERT INTO group_members (group_id,contact_id) VALUES ($1,$2) ON CONFLICT (group_id,contact_id) DO NOTHING", [groupId, contactId]);
              }
            }
          }
          if (groups.length) await db.query("DELETE FROM church_groups WHERE department_id=$1 AND source_system='churchtools' AND source_id<>ALL($2::text[])", [departmentId, groups.map(idOf).filter(Boolean)]);
          for (const resource of resources) {
            const sourceId = idOf(resource);
            const name = firstText(resource.name, resource.title, resource.resourceName);
            if (!sourceId || !name) continue;
            const typeName = firstText(resource.resourceType?.name, resource.type?.name, resource.type, resource.category);
            const location = firstText(resource.location?.name, resource.location, resource.place?.name, resource.place).slice(0, 160);
            const description = firstText(resource.description, resource.note, resource.information).slice(0, 1000);
            const capacityValue = Number(resource.capacity ?? resource.maxPersons ?? resource.max_persons);
            const capacity = Number.isInteger(capacityValue) && capacityValue > 0 && capacityValue <= 10000 ? capacityValue : null;
            const requiresApproval = resource.requiresApproval ?? resource.requires_approval ?? resource.approvalRequired ?? resource.mustBeConfirmed;
            const active = resource.active !== false && resource.archived !== true && resource.isArchived !== true;
            const existing = await db.query<{ id: string }>("SELECT id FROM bookable_resources WHERE department_id=$1 AND source_system='churchtools' AND source_id=$2 FOR UPDATE", [departmentId, sourceId]);
            const matching = existing.rowCount ? existing : await db.query<{ id: string }>("SELECT id FROM bookable_resources WHERE department_id=$1 AND source_system IS NULL AND lower(name)=lower($2) ORDER BY created_at LIMIT 1 FOR UPDATE", [departmentId, name]);
            const values = [departmentId, name.slice(0, 120), resourceCategory({ ...resource, category: typeName }), description, location, capacity, requiresApproval === undefined ? true : Boolean(requiresApproval), active, sourceId];
            if (matching.rowCount) await db.query("UPDATE bookable_resources SET name=$3,category=$4,description=$5,location=$6,capacity=$7,requires_approval=$8,active=$9,source_system='churchtools',source_id=$10,updated_at=now() WHERE id=$1 AND department_id=$2", [matching.rows[0].id, departmentId, ...values.slice(1)]);
            else await db.query("INSERT INTO bookable_resources (id,department_id,name,category,description,location,capacity,requires_approval,active,source_system,source_id) VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,'churchtools',$9)", values);
          }
          if (resources.length) {
            await db.query("DELETE FROM resource_bookings WHERE department_id=$1 AND resource_id IN (SELECT id FROM bookable_resources WHERE department_id=$1 AND source_system='churchtools' AND source_id<>ALL($2::text[]))", [departmentId, resources.map(idOf).filter(Boolean)]);
            await db.query("DELETE FROM bookable_resources WHERE department_id=$1 AND source_system='churchtools' AND source_id<>ALL($2::text[])", [departmentId, resources.map(idOf).filter(Boolean)]);
          }
          for (const event of services) {
            const positions = event.positions.map((item: any) => ({ name: item.name, ...(item.personId && personMap.has(item.personId) ? { contactId: personMap.get(item.personId) } : {}) }));
            const found = await db.query<{ id: string }>("SELECT id FROM service_events WHERE department_id=$1 AND source_system='churchtools' AND source_id=$2 FOR UPDATE", [departmentId, event.sourceId]);
            const data = [departmentId, event.title.slice(0, 160), event.date, event.start, event.end, event.location.slice(0, 160), event.description, event.room.slice(0, 160), JSON.stringify(positions), JSON.stringify(event.timePlan), event.sourceId];
            if (found.rowCount) {
              await db.query("UPDATE service_events SET title=$3,kind='service',event_date=$4,start_time=$5,end_time=$6,location=$7,description=$8,room=$9,positions=$10::jsonb,time_plan=$11::jsonb,updated_at=now() WHERE id=$1 AND department_id=$2", [found.rows[0].id, departmentId, ...data.slice(1, 10)]);
            } else {
              const matching = await db.query<{ id: string }>("SELECT id FROM service_events WHERE department_id=$1 AND source_system IS NULL AND lower(title)=lower($2) AND event_date=$3 AND start_time=$4 ORDER BY created_at LIMIT 1 FOR UPDATE", [departmentId, event.title.slice(0, 160), event.date, event.start]);
              if (matching.rowCount) await db.query("UPDATE service_events SET title=$3,kind='service',event_date=$4,start_time=$5,end_time=$6,location=$7,description=$8,room=$9,positions=$10::jsonb,time_plan=$11::jsonb,source_system='churchtools',source_id=$12,updated_at=now() WHERE id=$1 AND department_id=$2", [matching.rows[0].id, departmentId, ...data.slice(1)]);
              else await db.query("INSERT INTO service_events (id,department_id,title,kind,event_date,start_time,end_time,location,description,room,positions,time_plan,source_system,source_id) VALUES (gen_random_uuid(),$1,$2,'service',$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,'churchtools',$11)", data);
            }
          }
          if (services.length) await db.query("DELETE FROM service_events WHERE department_id=$1 AND source_system='churchtools' AND source_id<>ALL($2::text[])", [departmentId, services.map((event: any) => event.sourceId)]);
          await db.query("COMMIT");
        } catch (error) { await db.query("ROLLBACK"); throw error; }
        finally { db.release(); }
        await pool.query("UPDATE churchtools_sync_settings SET last_sync_at=now(),last_sync_error=NULL,people_count=$2,group_count=$3,service_count=$4,updated_at=now() WHERE department_id=$1", [departmentId, people.length, groups.length, services.length]);
        return { people: people.length, groups: groups.length, services: services.length, resources: resources.length };
      } catch (error) {
        await statusError(departmentId, error instanceof Error ? error.message : "Sync failed.");
        throw error;
      } finally { running.delete(departmentId); }
    }

    routes.get("/api/modules/sync/churchtools", async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      const result = await pool!.query("SELECT s.instance_url,s.enabled,s.last_sync_at,s.last_sync_error,(SELECT count(*)::int FROM contacts c WHERE c.department_id=s.department_id AND c.source_system='churchtools') AS people_count,(SELECT count(*)::int FROM church_groups g WHERE g.department_id=s.department_id AND g.source_system='churchtools') AS group_count,(SELECT count(*)::int FROM service_events e WHERE e.department_id=s.department_id AND e.source_system='churchtools') AS service_count,(SELECT count(*)::int FROM bookable_resources r WHERE r.department_id=s.department_id AND r.source_system='churchtools') AS resource_count FROM churchtools_sync_settings s WHERE s.department_id=$1", [dept]);
      const row = result.rows[0];
      return row ? { configured: true, instanceUrl: row.instance_url, enabled: row.enabled, lastSyncAt: row.last_sync_at, lastSyncError: row.last_sync_error, peopleCount: row.people_count, groupCount: row.group_count, serviceCount: row.service_count, resourceCount: row.resource_count } : { configured: false, enabled: false, peopleCount: 0, groupCount: 0, serviceCount: 0, resourceCount: 0 };
    });
    routes.put<{ Body: { instanceUrl: string; loginToken?: string } }>("/api/modules/sync/churchtools", { schema: { body: { type: "object", additionalProperties: false, required: ["instanceUrl"], properties: { instanceUrl: { type: "string", minLength: 10, maxLength: 255 }, loginToken: { type: "string", maxLength: 2048 } } } } }, async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      let base: string; try { base = normalizeUrl(request.body.instanceUrl); } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Invalid URL." }); }
      const old = await settings(dept);
      let token = request.body.loginToken?.trim();
      if (!token && old) try { token = decrypt(old.encrypted_login_token); } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Re-enter the token." }); }
      try { await testLogin(base, token ?? ""); } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "ChurchTools connection failed." }); }
      let encrypted: string; try { encrypted = encrypt(token!); } catch (error) { return reply.code(503).send({ error: error instanceof Error ? error.message : "Token encryption is unavailable." }); }
      await pool!.query("INSERT INTO churchtools_sync_settings (department_id,instance_url,encrypted_login_token,enabled) VALUES ($1,$2,$3,true) ON CONFLICT (department_id) DO UPDATE SET instance_url=EXCLUDED.instance_url,encrypted_login_token=EXCLUDED.encrypted_login_token,enabled=true,last_sync_error=NULL,updated_at=now()", [dept, base, encrypted]);
      return { saved: true, instanceUrl: base };
    });
    routes.post("/api/modules/sync/churchtools/run", async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      try { return await run(dept); } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Sync failed." }); }
    });
    routes.patch<{ Body: { enabled: boolean } }>("/api/modules/sync/churchtools", { schema: { body: { type: "object", additionalProperties: false, required: ["enabled"], properties: { enabled: { type: "boolean" } } } } }, async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      const result = await pool!.query("UPDATE churchtools_sync_settings SET enabled=$2,updated_at=now() WHERE department_id=$1 RETURNING enabled", [dept, request.body.enabled]);
      if (!result.rowCount) return reply.code(404).send({ error: "Configure ChurchTools first." });
      return { enabled: result.rows[0].enabled };
    });
    routes.delete("/api/modules/sync/churchtools", async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      if (running.has(dept)) return reply.code(409).send({ error: "Wait for sync to finish before removing imported data." });
      const db = await pool!.connect();
      try {
        await db.query("BEGIN");
        await db.query("DELETE FROM service_events WHERE department_id=$1 AND source_system='churchtools'", [dept]);
        await db.query("DELETE FROM church_groups WHERE department_id=$1 AND source_system='churchtools'", [dept]);
        await db.query("DELETE FROM resource_bookings WHERE department_id=$1 AND resource_id IN (SELECT id FROM bookable_resources WHERE department_id=$1 AND source_system='churchtools')", [dept]);
        await db.query("DELETE FROM bookable_resources WHERE department_id=$1 AND source_system='churchtools'", [dept]);
        await db.query("DELETE FROM contacts WHERE department_id=$1 AND source_system='churchtools'", [dept]);
        await db.query("DELETE FROM churchtools_sync_settings WHERE department_id=$1", [dept]);
        await db.query("COMMIT");
        return { deleted: true };
      } catch (error) { await db.query("ROLLBACK"); throw error; }
      finally { db.release(); }
    });
    routes.get("/api/modules/sync/elvanto", async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      const row = await elvantoSettings(dept);
      const directions = row?.directions ?? Object.fromEntries(elvantoAreas.map((area) => [area, "off"])) as ElvantoDirections;
      const importedFlows = await pool!.query<{ source_id: string; name: string; definition: JsonObject; members: JsonObject[]; imported_at: Date | string }>("SELECT source_id,name,definition,members,imported_at FROM elvanto_people_flows_import WHERE department_id=$1 ORDER BY name LIMIT 500", [dept]);
      const importedSongs = await pool!.query<{ source_id: string; title: string; song: JsonObject; arrangements: JsonObject[]; imported_at: Date | string }>("SELECT source_id,title,song,arrangements,imported_at FROM elvanto_songs_import WHERE department_id=$1 ORDER BY title,source_id LIMIT 500", [dept]);
      const songCount = await pool!.query<{ count: number }>("SELECT count(*)::int AS count FROM elvanto_songs_import WHERE department_id=$1", [dept]);
      const financialState = await pool!.query<{ page: number; total: number | null; created: number; updated: number; skipped: number; complete: boolean; preview_complete: boolean; preview_count: number; start_date: string | null; end_date: string | null }>("SELECT financial_import_page AS page,COALESCE(financial_import_total,financial_preview_count) AS total,financial_import_created_count AS created,financial_import_updated_count AS updated,financial_import_skipped_count AS skipped,financial_import_complete AS complete,financial_preview_complete,financial_preview_count,COALESCE(financial_import_start_date,financial_preview_start_date)::text AS start_date,COALESCE(financial_import_end_date,financial_preview_end_date)::text AS end_date FROM elvanto_sync_settings WHERE department_id=$1", [dept]);
      return { configured: Boolean(row), directions, financialEnabled: row?.financial_enabled ?? false, enabled: row?.enabled ?? false, lastConnectedAt: row?.last_connected_at ?? null, lastSyncAt: row?.last_sync_at ?? null, lastSyncError: row?.last_sync_error ?? null, peopleImport: row ? { page: row.people_import_page, total: row.people_import_total, created: row.people_import_created_count, updated: row.people_import_updated_count, skipped: row.people_import_skipped_count, complete: row.people_import_complete } : null, groupsImport: row ? { page: row.groups_import_page, total: row.groups_import_total, created: row.groups_import_created_count, updated: row.groups_import_updated_count, skipped: row.groups_import_skipped_count, complete: row.groups_import_complete } : null, servicesImport: row ? { page: row.services_import_page, total: row.services_import_total, created: row.services_import_created_count, updated: row.services_import_updated_count, skipped: row.services_import_skipped_count, complete: row.services_import_complete } : null, calendarImport: row ? { page: row.calendar_import_page, total: row.calendar_import_total, created: row.calendar_import_created_count, updated: row.calendar_import_updated_count, skipped: row.calendar_import_skipped_count, complete: row.calendar_import_complete, startDate: row.calendar_import_start_date, endDate: row.calendar_import_end_date } : null, peopleFlowsImport: row ? { page: row.people_flows_import_page, total: row.people_flows_import_total ?? row.people_flows_preview_count, created: row.people_flows_import_created_count, updated: row.people_flows_import_updated_count, skipped: row.people_flows_import_skipped_count, complete: row.people_flows_import_complete, previewComplete: row.people_flows_preview_complete, previewCount: row.people_flows_preview_count, importedCount: row.people_flows_imported_count, lastImportAt: row.people_flows_last_import_at } : null, peopleFlows: importedFlows.rows.map((flow) => ({ sourceId: flow.source_id, name: flow.name, steps: Array.isArray(flow.definition.steps) ? flow.definition.steps.length : 0, members: Array.isArray(flow.members) ? flow.members.length : 0, importedAt: flow.imported_at })), songsImport: row ? { page: row.songs_import_page, total: row.songs_import_total ?? row.songs_preview_count, created: row.songs_import_created_count, updated: row.songs_import_updated_count, skipped: row.songs_import_skipped_count, complete: row.songs_import_complete, previewComplete: row.songs_preview_complete, previewCount: row.songs_preview_count, importedCount: row.songs_imported_count, lastImportAt: row.songs_last_import_at } : null, songs: importedSongs.rows.map((song) => ({ sourceId: song.source_id, title: song.title, arrangements: Array.isArray(song.arrangements) ? song.arrangements.length : 0, importedAt: song.imported_at })), songsTotal: songCount.rows[0]?.count ?? 0, financialImport: financialState.rows[0] ? { page: financialState.rows[0].page, total: financialState.rows[0].total, created: financialState.rows[0].created, updated: financialState.rows[0].updated, skipped: financialState.rows[0].skipped, complete: financialState.rows[0].complete, previewComplete: financialState.rows[0].preview_complete, previewCount: financialState.rows[0].preview_count, startDate: financialState.rows[0].start_date, endDate: financialState.rows[0].end_date } : null };
    });
    routes.get<{ Querystring: { offset?: number; limit?: number } }>("/api/modules/sync/elvanto/financial", { schema: { querystring: { type: "object", additionalProperties: false, properties: { offset: { type: "integer", minimum: 0, maximum: 200000 }, limit: { type: "integer", minimum: 1, maximum: 100 } } } } }, async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      const settings = await elvantoSettings(dept);
      if (!settings?.financial_enabled) return reply.code(403).send({ error: "Explicit financial data access is not enabled for this location." });
      const offset = request.query.offset ?? 0; const limit = request.query.limit ?? 50;
      const [items, total] = await Promise.all([
        pool!.query<{ source_id: string; transaction_date: string; encrypted_payload: string; imported_at: Date | string }>("SELECT source_id,transaction_date::text,encrypted_payload,imported_at FROM elvanto_financial_import WHERE department_id=$1 ORDER BY transaction_date DESC,source_id OFFSET $2 LIMIT $3", [dept, offset, limit]),
        pool!.query<{ count: number }>("SELECT count(*)::int AS count FROM elvanto_financial_import WHERE department_id=$1", [dept]),
      ]);
      return { transactions: items.rows.map((row) => ({ sourceId: row.source_id, date: row.transaction_date, total: decryptElvantoFinancial(row.encrypted_payload).transaction_total, importedAt: row.imported_at })), offset, total: total.rows[0]?.count ?? 0 };
    });
    routes.get<{ Params: { sourceId: string } }>("/api/modules/sync/elvanto/financial/:sourceId", { schema: { params: { type: "object", additionalProperties: false, required: ["sourceId"], properties: { sourceId: { type: "string", minLength: 1, maxLength: 100 } } } } }, async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      const settings = await elvantoSettings(dept);
      if (!settings?.financial_enabled) return reply.code(403).send({ error: "Explicit financial data access is not enabled for this location." });
      const result = await pool!.query<{ source_id: string; transaction_date: string; encrypted_payload: string; imported_at: Date | string }>("SELECT source_id,transaction_date::text,encrypted_payload,imported_at FROM elvanto_financial_import WHERE department_id=$1 AND source_id=$2", [dept, request.params.sourceId]);
      const record = result.rows[0];
      if (!record) return reply.code(404).send({ error: "Imported financial transaction was not found." });
      return { sourceId: record.source_id, date: record.transaction_date, transaction: decryptElvantoFinancial(record.encrypted_payload), importedAt: record.imported_at };
    });
    routes.post<{ Body: { startDate: string; endDate: string } }>("/api/modules/sync/elvanto/financial-preview", { schema: { body: { type: "object", additionalProperties: false, required: ["startDate", "endDate"], properties: { startDate: { type: "string", format: "date" }, endDate: { type: "string", format: "date" } } } } }, async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      const row = await elvantoSettings(dept);
      if (!row) return reply.code(404).send({ error: "Connect Elvanto before previewing financial records." });
      if (!row.financial_enabled) return reply.code(403).send({ error: "Explicit financial data access is not enabled for this location." });
      if (row.directions.financial === "off" || row.directions.financial === "smart_church_to_elvanto") return reply.code(400).send({ error: "Set the financial direction to Elvanto → Smart Church or bidirectional before importing." });
      if (request.body.startDate > request.body.endDate) return reply.code(400).send({ error: "The financial start date must be on or before the end date." });
      let apiKey: string;
      try { apiKey = decryptElvantoKey(row.encrypted_api_key); } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Reconnect Elvanto." }); }
      const lock = await pool!.query(`UPDATE elvanto_sync_settings SET financial_importing=TRUE,financial_import_started_at=now(),financial_preview_at=NULL,financial_preview_complete=FALSE,financial_preview_ids='[]'::jsonb,updated_at=now()
        WHERE department_id=$1 AND updated_at=$2 AND people_importing=FALSE AND groups_importing=FALSE AND services_importing=FALSE AND calendar_importing=FALSE AND people_flows_importing=FALSE AND (songs_importing=FALSE OR songs_import_started_at < now()-interval '15 minutes') AND (financial_importing=FALSE OR financial_import_started_at < now()-interval '15 minutes') RETURNING department_id`, [dept, row.updated_at]);
      if (!lock.rowCount) return reply.code(409).send({ error: "Another Elvanto import is running for this location." });
      try {
        const snapshot = await fetchElvantoFinancialTransactions(apiKey, request.body.startDate, request.body.endDate);
        const ids = [...new Set(snapshot.ids)];
        const existing = await pool!.query<{ source_id: string }>("SELECT source_id FROM elvanto_financial_import WHERE department_id=$1", [dept]);
        const linked = new Set(existing.rows.map((item) => item.source_id));
        const complete = snapshot.complete && ids.length === snapshot.transactions.length && (snapshot.reportedTotal === null || snapshot.reportedTotal === snapshot.transactions.length);
        const sample = snapshot.transactions.slice(0, 50).map((item) => ({ date: firstText(item.transaction_date), total: firstText(item.transaction_total), action: linked.has(idOf(item)) ? "update" : "create" }));
        const saved = await pool!.query(`UPDATE elvanto_sync_settings SET financial_preview_at=CASE WHEN $2 THEN now() ELSE NULL END,financial_preview_complete=$2,financial_preview_count=$3,financial_preview_ids=$4::jsonb,financial_preview_start_date=$5::date,financial_preview_end_date=$6::date,financial_import_page=1,financial_import_total=NULL,financial_import_created_count=0,financial_import_updated_count=0,financial_import_skipped_count=0,financial_import_complete=FALSE,financial_importing=FALSE,financial_import_started_at=NULL,updated_at=now() WHERE department_id=$1 AND financial_importing=TRUE RETURNING department_id`, [dept, complete, ids.length, JSON.stringify(ids), request.body.startDate, request.body.endDate]);
        if (!saved.rowCount) return reply.code(409).send({ error: "Elvanto settings changed during the financial preview. Run a new preview." });
        return { transactionCount: ids.length, reportedTotal: snapshot.reportedTotal, complete, createCount: ids.filter((id) => !linked.has(id)).length, updateCount: ids.filter((id) => linked.has(id)).length, sample };
      } catch (error) {
        await pool!.query("UPDATE elvanto_sync_settings SET financial_preview_at=NULL,financial_preview_complete=FALSE,financial_preview_ids='[]'::jsonb,financial_importing=FALSE,financial_import_started_at=NULL,updated_at=now() WHERE department_id=$1", [dept]).catch(() => {});
        return reply.code(400).send({ error: error instanceof Error ? error.message : "Financial preview failed." });
      }
    });
    routes.post<{ Body?: { restart?: boolean } }>("/api/modules/sync/elvanto/financial-import", { schema: { body: { type: "object", additionalProperties: false, properties: { restart: { type: "boolean" } } } } }, async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      if (elvantoFinancialImportRunning.has(dept)) return reply.code(409).send({ error: "A financial import is already running for this location." });
      const row = await elvantoSettings(dept);
      if (!row) return reply.code(404).send({ error: "Connect Elvanto before importing financial records." });
      if (!row.financial_enabled) return reply.code(403).send({ error: "Explicit financial data access is not enabled for this location." });
      if (row.directions.financial === "off" || row.directions.financial === "smart_church_to_elvanto") return reply.code(400).send({ error: "Set the financial direction to Elvanto → Smart Church or bidirectional before importing." });
      const state = await pool!.query<{ page: number; preview_at: string | null; ids: string[]; complete: boolean; start_date: string | null; end_date: string | null; created: number; updated: number; skipped: number }>("SELECT financial_import_page AS page,financial_preview_at AS preview_at,financial_preview_ids AS ids,financial_preview_complete AS complete,financial_preview_start_date::text AS start_date,financial_preview_end_date::text AS end_date,financial_import_created_count AS created,financial_import_updated_count AS updated,financial_import_skipped_count AS skipped FROM elvanto_sync_settings WHERE department_id=$1", [dept]);
      const savedState = state.rows[0];
      const previewTime = savedState?.preview_at ? new Date(savedState.preview_at).getTime() : 0;
      if (!savedState?.complete || !previewTime || Date.now() - previewTime > 60 * 60 * 1000 || !savedState.start_date || !savedState.end_date) return reply.code(409).send({ error: "Run a complete financial preview first. Previews expire after one hour and after connection settings change." });
      let apiKey: string;
      try { apiKey = decryptElvantoKey(row.encrypted_api_key); } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Reconnect Elvanto." }); }
      elvantoFinancialImportRunning.add(dept); let reserved = false;
      try {
        const lock = await pool!.query(`UPDATE elvanto_sync_settings SET financial_importing=TRUE,financial_import_started_at=now(),updated_at=now() WHERE department_id=$1 AND updated_at=$2 AND financial_preview_complete=TRUE AND financial_preview_at > now()-interval '1 hour' AND financial_enabled=TRUE AND people_importing=FALSE AND groups_importing=FALSE AND services_importing=FALSE AND calendar_importing=FALSE AND people_flows_importing=FALSE AND (songs_importing=FALSE OR songs_import_started_at < now()-interval '15 minutes') AND (financial_importing=FALSE OR financial_import_started_at < now()-interval '15 minutes') RETURNING department_id`, [dept, row.updated_at]);
        if (!lock.rowCount) return reply.code(409).send({ error: "The preview expired, settings changed, or another import is running. Run a new complete financial preview first." });
        reserved = true;
        const previewIds = Array.isArray(savedState.ids) ? savedState.ids : [];
        const restart = Boolean(request.body?.restart); let page = restart ? 1 : savedState.page;
        const snapshot = await fetchElvantoFinancialTransactions(apiKey, savedState.start_date, savedState.end_date, page, 5);
        const idOffset = (page - 1) * 1000;
        const expectedBatchSize = Math.min(5000, previewIds.length - idOffset);
        if (snapshot.ids.length !== expectedBatchSize || snapshot.ids.some((id, index) => id !== previewIds[idOffset + index])) { await pool!.query("UPDATE elvanto_sync_settings SET financial_preview_at=NULL,financial_preview_complete=FALSE WHERE department_id=$1", [dept]); return reply.code(409).send({ error: "Elvanto financial transactions changed after preview. Run a fresh financial preview." }); }
        let created = restart ? 0 : savedState.created; let updated = restart ? 0 : savedState.updated; let skipped = restart ? 0 : savedState.skipped;
        if (restart) await pool!.query("UPDATE elvanto_sync_settings SET financial_import_page=1,financial_import_complete=FALSE,financial_import_created_count=0,financial_import_updated_count=0,financial_import_skipped_count=0 WHERE department_id=$1", [dept]);
        const batch = snapshot.transactions;
        const db = await pool!.connect();
        try {
          await db.query("BEGIN");
          for (const transaction of batch) {
            const sourceId = idOf(transaction); const date = firstText(transaction.transaction_date);
            if (!sourceId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < savedState.start_date || date > savedState.end_date) { skipped += 1; continue; }
            const existing = await db.query("SELECT 1 FROM elvanto_financial_import WHERE department_id=$1 AND source_id=$2", [dept, sourceId]);
            await db.query(`INSERT INTO elvanto_financial_import (department_id,source_id,transaction_date,encrypted_payload,imported_at) VALUES ($1,$2,$3::date,$4,now()) ON CONFLICT (department_id,source_id) DO UPDATE SET transaction_date=EXCLUDED.transaction_date,encrypted_payload=EXCLUDED.encrypted_payload,imported_at=now()`, [dept, sourceId, date, encryptElvantoFinancial(transaction)]);
            if (existing.rowCount) updated += 1; else created += 1;
          }
          page += snapshot.pagesFetched; const complete = (page - 1) * 1000 >= previewIds.length || previewIds.length === 0;
          await db.query("UPDATE elvanto_sync_settings SET financial_import_page=$2,financial_import_total=$3,financial_import_created_count=$4,financial_import_updated_count=$5,financial_import_skipped_count=$6,financial_import_complete=$7,financial_import_start_date=$8::date,financial_import_end_date=$9::date,last_sync_at=CASE WHEN $7 THEN now() ELSE last_sync_at END,last_sync_error=NULL,updated_at=now() WHERE department_id=$1", [dept, page, previewIds.length, created, updated, skipped, complete, savedState.start_date, savedState.end_date]);
          await db.query("COMMIT");
          return { financialImport: { page, total: previewIds.length, created, updated, skipped, complete } };
        } catch (error) { await db.query("ROLLBACK"); throw error; } finally { db.release(); }
      } catch (error) {
        await pool!.query("UPDATE elvanto_sync_settings SET last_sync_error=$2 WHERE department_id=$1", [dept, (error instanceof Error ? error.message : "Financial import failed.").slice(0, 1000)]).catch(() => {});
        return reply.code(400).send({ error: error instanceof Error ? error.message : "Financial import failed." });
      } finally {
        if (reserved) await pool!.query("UPDATE elvanto_sync_settings SET financial_importing=FALSE,financial_import_started_at=NULL,updated_at=now() WHERE department_id=$1", [dept]).catch(() => {});
        elvantoFinancialImportRunning.delete(dept);
      }
    });
    routes.post("/api/modules/sync/elvanto/check-permissions", async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      const row = await elvantoSettings(dept);
      if (!row) return reply.code(404).send({ error: "Connect Elvanto before checking API permissions." });
      const selected = elvantoAreas.filter((area) => row.directions[area] !== "off" && (area !== "financial" || row.financial_enabled));
      if (!selected.length) return reply.code(400).send({ error: "Select at least one data area before checking permissions." });
      let apiKey: string;
      try { apiKey = decryptElvantoKey(row.encrypted_api_key); }
      catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Reconnect Elvanto." }); }
      const checks = await mapConcurrent(selected, 2, async (area) => {
        try { return await checkElvantoArea(apiKey, area); }
        catch (error) { return { area, accessible: false, detail: error instanceof Error ? error.message : "The API permission check failed." }; }
      });
      return { checks };
    });
    routes.post("/api/modules/sync/elvanto/people-preview", async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      const row = await elvantoSettings(dept);
      if (!row) return reply.code(404).send({ error: "Connect Elvanto before previewing people." });
      if (row.directions.people === "off" || row.directions.people === "smart_church_to_elvanto") return reply.code(400).send({ error: "Set People direction to Elvanto → Smart Church or bidirectional before previewing an import." });
      let apiKey: string;
      try { apiKey = decryptElvantoKey(row.encrypted_api_key); }
      catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Reconnect Elvanto." }); }

      const previewLock = await pool!.query(
        "UPDATE elvanto_sync_settings SET people_importing=FALSE,people_import_started_at=NULL,people_preview_at=NULL,people_preview_complete=FALSE,people_preview_scanned_count=0,people_preview_total=NULL WHERE department_id=$1 AND (people_importing=FALSE OR people_import_started_at < now()-interval '15 minutes') AND groups_importing=FALSE AND services_importing=FALSE AND calendar_importing=FALSE AND people_flows_importing=FALSE AND (songs_importing=FALSE OR songs_import_started_at < now()-interval '15 minutes') AND (financial_importing=FALSE OR financial_import_started_at < now()-interval '15 minutes') RETURNING department_id",
        [dept],
      );
      if (!previewLock.rowCount) return reply.code(409).send({ error: "A People import is running. Wait for it to finish before creating another preview." });
      // Build a read-only plan. The import step will use the same external IDs, but no contact is modified here.
      const customFieldSnapshot = await fetchElvantoPeopleCustomFields(apiKey);
      const requestedPeopleFields = [...elvantoPeopleFields, ...customFieldSnapshot.fields.map((field) => `custom_${field.id}`)];
      const people: JsonObject[] = [];
      const pageSize = 1000;
      const maxPages = 200;
      let total: number | null = null;
      let complete = false;
      for (let page = 1; page <= maxPages; page += 1) {
        const payload = await elvantoRequest(apiKey, "people/getAll", { page, page_size: pageSize, fields: requestedPeopleFields });
        const batch = elvantoCollection(payload, "people", "person");
        people.push(...batch);
        const container = payload.people as JsonObject | undefined;
        const reportedTotal = Number(container?.total);
        if (Number.isFinite(reportedTotal) && reportedTotal >= 0) total = reportedTotal;
        if (total !== null && people.length >= total) { complete = true; break; }
        if (batch.length < pageSize) { complete = true; break; }
      }
      const existing = await pool!.query<{ id: string; source_system: string | null; source_id: string | null; email: string | null; first_name: string; last_name: string }>(
        "SELECT id,source_system,source_id,email,first_name,last_name FROM contacts WHERE department_id=$1",
        [dept],
      );
      const bySourceId = new Map(existing.rows.filter((contact) => contact.source_system === "elvanto" && contact.source_id).map((contact) => [contact.source_id!, contact]));
      const byEmail = new Map<string, typeof existing.rows>();
      for (const contact of existing.rows) if (contact.email?.trim()) {
        const email = contact.email.trim().toLocaleLowerCase();
        byEmail.set(email, [...(byEmail.get(email) ?? []), contact]);
      }
      const seen = new Set<string>();
      let createCount = 0;
      let alreadyLinkedCount = 0;
      let emailMatchCount = 0;
      let ambiguousEmailCount = 0;
      let invalidCount = 0;
      const sample: Array<{ firstName: string; lastName: string; email: string | null; action: "create" | "already_linked" | "review_email_match" | "review_ambiguous_email" | "needs_review" | "duplicate_source_id" }> = [];
      const seenEmails = new Set<string>();
      for (const person of people) {
        const sourceId = idOf(person);
        const firstName = firstText(person.firstname, person.firstName, person.first_name, person.preferred_name);
        const lastName = firstText(person.lastname, person.lastName, person.last_name);
        const rawEmail = firstText(person.email);
        const rawPhone = firstText(person.mobile, person.phone);
        const email = rawEmail || null;
        let action: typeof sample[number]["action"];
        if (!sourceId || !firstName || !lastName || firstName.length > 80 || lastName.length > 80 || (rawEmail && (rawEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail))) || rawPhone.length > 40) { invalidCount += 1; action = "needs_review"; }
        else if (seen.has(sourceId)) { invalidCount += 1; action = "duplicate_source_id"; }
        else if (bySourceId.has(sourceId)) { alreadyLinkedCount += 1; action = "already_linked"; }
        else if (email && (byEmail.get(email.toLocaleLowerCase())?.length ?? 0) > 1) { ambiguousEmailCount += 1; action = "review_ambiguous_email"; }
        else if (email && (byEmail.get(email.toLocaleLowerCase())?.length ?? 0) === 1) { emailMatchCount += 1; action = "review_email_match"; }
        else if (email && seenEmails.has(email.toLocaleLowerCase())) { ambiguousEmailCount += 1; action = "review_ambiguous_email"; }
        else { createCount += 1; action = "create"; }
        if (sourceId) seen.add(sourceId);
        if (email) seenEmails.add(email.toLocaleLowerCase());
        if (sample.length < 50) sample.push({ firstName, lastName, email, action });
      }
      const previewComplete = complete && customFieldSnapshot.complete;
      const savedPreview = await pool!.query(
        "UPDATE elvanto_sync_settings SET people_preview_at=CASE WHEN $2 THEN now() ELSE NULL END,people_preview_complete=$2,people_preview_scanned_count=$3,people_preview_total=$4 WHERE department_id=$1 AND updated_at=$5 AND people_importing=FALSE AND groups_importing=FALSE AND services_importing=FALSE AND calendar_importing=FALSE AND people_flows_importing=FALSE AND (songs_importing=FALSE OR songs_import_started_at < now()-interval '15 minutes') AND (financial_importing=FALSE OR financial_import_started_at < now()-interval '15 minutes') RETURNING department_id",
        [dept, previewComplete, people.length, total, row.updated_at],
      );
      if (!savedPreview.rowCount) return reply.code(409).send({ error: "Elvanto settings changed during the preview. Save the connection again and run a new preview." });
      return { scannedCount: people.length, reportedTotal: total, complete: previewComplete, customFieldCount: customFieldSnapshot.fields.length, createCount, alreadyLinkedCount, emailMatchCount, ambiguousEmailCount, invalidCount, sample };
    });
    routes.post<{ Body?: { restart?: boolean } }>("/api/modules/sync/elvanto/people-import", async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      if (elvantoPeopleImportRunning.has(dept)) return reply.code(409).send({ error: "A People import is already running for this location." });
      const row = await elvantoSettings(dept);
      if (!row) return reply.code(404).send({ error: "Connect Elvanto before importing people." });
      if (row.directions.people === "off" || row.directions.people === "smart_church_to_elvanto") return reply.code(400).send({ error: "Set People direction to Elvanto → Smart Church or bidirectional before importing." });
      const previewTime = row.people_preview_at ? new Date(row.people_preview_at).getTime() : 0;
      if (!row.people_preview_complete || !previewTime || Date.now() - previewTime > 60 * 60 * 1000) return reply.code(409).send({ error: "Run a complete People import preview first. Previews expire after one hour and after connection settings change." });
      let apiKey: string;
      try { apiKey = decryptElvantoKey(row.encrypted_api_key); }
      catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Reconnect Elvanto." }); }
      elvantoPeopleImportRunning.add(dept);
      let reserved = false;
      try {
        const reservation = await pool!.query(
          "UPDATE elvanto_sync_settings SET people_importing=TRUE,people_import_started_at=now(),updated_at=now() WHERE department_id=$1 AND updated_at=$2 AND people_preview_complete=TRUE AND people_preview_at > now()-interval '1 hour' AND (people_importing=FALSE OR people_import_started_at < now()-interval '15 minutes') AND groups_importing=FALSE AND services_importing=FALSE AND calendar_importing=FALSE AND people_flows_importing=FALSE AND (songs_importing=FALSE OR songs_import_started_at < now()-interval '15 minutes') AND (financial_importing=FALSE OR financial_import_started_at < now()-interval '15 minutes') RETURNING department_id",
          [dept, row.updated_at],
        );
        if (!reservation.rowCount) return reply.code(409).send({ error: "The preview expired or settings changed. Run a fresh complete People preview before importing." });
        reserved = true;
        const restart = Boolean(request.body?.restart);
        let page = restart ? 1 : row.people_import_page;
        let total = restart ? null : row.people_import_total;
        let created = restart ? 0 : row.people_import_created_count;
        let updated = restart ? 0 : row.people_import_updated_count;
        let skipped = restart ? 0 : row.people_import_skipped_count;
        let complete = restart ? false : row.people_import_complete;
        if (restart) await pool!.query(
          "UPDATE elvanto_sync_settings SET people_import_page=1,people_import_total=NULL,people_import_created_count=0,people_import_updated_count=0,people_import_skipped_count=0,people_import_complete=FALSE,updated_at=now() WHERE department_id=$1",
          [dept],
        );
        const customFieldSnapshot = await fetchElvantoPeopleCustomFields(apiKey);
        if (!customFieldSnapshot.complete) return reply.code(409).send({ error: "Elvanto custom-field pagination was incomplete. Run a new People preview before importing." });
        const requestedPeopleFields = [...elvantoPeopleFields, ...customFieldSnapshot.fields.map((field) => `custom_${field.id}`)];
        for (let pageBatch = 0; pageBatch < 5 && !complete; pageBatch += 1) {
          const payload = await elvantoRequest(apiKey, "people/getAll", { page, page_size: 1000, fields: requestedPeopleFields });
          const people = elvantoCollection(payload, "people", "person");
          const reportedTotal = Number((payload.people as JsonObject | undefined)?.total);
          if (Number.isFinite(reportedTotal) && reportedTotal >= 0) total = reportedTotal;
          const contacts = await pool!.query<{ id: string; source_system: string | null; source_id: string | null; email: string | null }>(
            "SELECT id,source_system,source_id,email FROM contacts WHERE department_id=$1",
            [dept],
          );
          const linkedIds = new Set(contacts.rows.filter((contact) => contact.source_system === "elvanto" && contact.source_id).map((contact) => contact.source_id!));
          const emails = new Map<string, number>();
          for (const contact of contacts.rows) if (contact.email?.trim()) {
            const email = contact.email.trim().toLocaleLowerCase();
            emails.set(email, (emails.get(email) ?? 0) + 1);
          }
          const seenIds = new Set<string>();
          const records: Array<{ source_id: string; first_name: string; last_name: string; email: string | null; phone: string | null; profile: JsonObject }> = [];
          let pageCreated = 0;
          let pageUpdated = 0;
          let pageSkipped = 0;
          for (const person of people) {
            const sourceId = idOf(person);
            const firstName = firstText(person.firstname, person.firstName, person.first_name, person.preferred_name);
            const lastName = firstText(person.lastname, person.lastName, person.last_name);
            const rawEmail = firstText(person.email);
            const email = rawEmail || null;
            const rawPhone = firstText(person.mobile, person.phone);
            const phone = rawPhone || null;
            if (!sourceId || seenIds.has(sourceId) || !firstName || !lastName || firstName.length > 80 || lastName.length > 80 || (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) || (phone && phone.length > 40)) { pageSkipped += 1; continue; }
            seenIds.add(sourceId);
            const profile = mapElvantoPeopleProfile(person, customFieldSnapshot.fields);
            if (linkedIds.has(sourceId)) { records.push({ source_id: sourceId, first_name: firstName, last_name: lastName, email, phone, profile }); pageUpdated += 1; continue; }
            if (email && (emails.get(email.toLocaleLowerCase()) ?? 0) > 0) { pageSkipped += 1; continue; }
            if (email) emails.set(email.toLocaleLowerCase(), 1);
            records.push({ source_id: sourceId, first_name: firstName, last_name: lastName, email, phone, profile });
            pageCreated += 1;
          }
          const nextPage = page + 1;
          complete = people.length === 0 || (total !== null ? nextPage > Math.max(1, Math.ceil(total / 1000)) : people.length < 1000);
          const db = await pool!.connect();
          try {
            await db.query("BEGIN");
            if (records.length) {
              await db.query(
                `INSERT INTO contacts (id,department_id,first_name,last_name,email,phone,status,source_system,source_id,elvanto_profile)
                 SELECT gen_random_uuid(),$1,incoming.first_name,incoming.last_name,incoming.email,incoming.phone,'member','elvanto',incoming.source_id,incoming.profile
                   FROM jsonb_to_recordset($2::jsonb) AS incoming(source_id text,first_name text,last_name text,email text,phone text,profile jsonb)
                 ON CONFLICT (department_id,source_system,source_id) WHERE source_system IS NOT NULL
                 DO UPDATE SET first_name=EXCLUDED.first_name,last_name=EXCLUDED.last_name,email=EXCLUDED.email,phone=EXCLUDED.phone,status='member',elvanto_profile=EXCLUDED.elvanto_profile,updated_at=now()
                 WHERE contacts.source_system='elvanto'`,
                [dept, JSON.stringify(records)],
              );
            }
            created += pageCreated; updated += pageUpdated; skipped += pageSkipped;
            page = nextPage;
            await db.query(
              `UPDATE elvanto_sync_settings SET people_import_page=$2,people_import_total=$3,people_import_created_count=$4,
                people_import_updated_count=$5,people_import_skipped_count=$6,people_import_complete=$7,
                last_sync_at=CASE WHEN $7 THEN now() ELSE last_sync_at END,last_sync_error=NULL,updated_at=now() WHERE department_id=$1`,
              [dept, page, total, created, updated, skipped, complete],
            );
            await db.query("COMMIT");
          } catch (error) { await db.query("ROLLBACK"); throw error; }
          finally { db.release(); }
          if (!people.length) break;
        }
        return { peopleImport: { page, total, created, updated, skipped, complete }, pagesProcessed: Math.min(5, complete ? Math.max(0, page - row.people_import_page) : 5) };
      } catch (error) {
        return reply.code(400).send({ error: error instanceof Error ? error.message : "People import failed." });
      } finally {
        if (reserved) await pool!.query("UPDATE elvanto_sync_settings SET people_importing=FALSE,people_import_started_at=NULL,updated_at=now() WHERE department_id=$1", [dept]).catch(() => {});
        elvantoPeopleImportRunning.delete(dept);
      }
    });
    routes.post("/api/modules/sync/elvanto/groups-preview", async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      const row = await elvantoSettings(dept);
      if (!row) return reply.code(404).send({ error: "Connect Elvanto before previewing groups." });
      if (row.directions.groups === "off" || row.directions.groups === "smart_church_to_elvanto") return reply.code(400).send({ error: "Set Groups direction to Elvanto → Smart Church or bidirectional before previewing an import." });
      let apiKey: string;
      try { apiKey = decryptElvantoKey(row.encrypted_api_key); }
      catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Reconnect Elvanto." }); }
      const previewLock = await pool!.query(
        `UPDATE elvanto_sync_settings SET groups_importing=FALSE,groups_import_started_at=NULL,groups_preview_at=NULL,groups_preview_complete=FALSE,groups_preview_scanned_count=0,groups_preview_total=NULL
          WHERE department_id=$1 AND people_importing=FALSE AND services_importing=FALSE AND calendar_importing=FALSE AND people_flows_importing=FALSE AND (groups_importing=FALSE OR groups_import_started_at < now()-interval '15 minutes') RETURNING department_id`,
        [dept],
      );
      if (!previewLock.rowCount) return reply.code(409).send({ error: "An Elvanto import is running. Wait for it to finish before creating a Groups preview." });
      const groups: JsonObject[] = [];
      let total: number | null = null;
      let complete = false;
      for (let page = 1; page <= 200; page += 1) {
        const payload = await elvantoRequest(apiKey, "groups/getAll", { page, page_size: 1000, fields: ["people"] });
        const batch = elvantoCollection(payload, "groups", "group");
        groups.push(...batch);
        const reported = Number((payload.groups as JsonObject | undefined)?.total);
        if (Number.isFinite(reported) && reported >= 0) total = reported;
        if (total !== null && groups.length >= total) { complete = true; break; }
        if (batch.length < 1000) { complete = true; break; }
      }
      const [existingGroups, linkedPeople] = await Promise.all([
        pool!.query<{ source_id: string | null; source_system: string | null; name: string }>("SELECT source_id,source_system,name FROM church_groups WHERE department_id=$1", [dept]),
        pool!.query<{ source_id: string; id: string }>("SELECT source_id,id FROM contacts WHERE department_id=$1 AND source_system='elvanto' AND source_id IS NOT NULL", [dept]),
      ]);
      const bySourceId = new Map(existingGroups.rows.filter((group) => group.source_system === "elvanto" && group.source_id).map((group) => [group.source_id!, group]));
      const names = new Map<string, typeof existingGroups.rows>();
      for (const group of existingGroups.rows) names.set(group.name.trim().toLocaleLowerCase(), [...(names.get(group.name.trim().toLocaleLowerCase()) ?? []), group]);
      const linkedIds = new Set(linkedPeople.rows.map((person) => person.source_id));
      const seen = new Set<string>();
      const sample: Array<{ name: string; action: "create" | "already_linked" | "review_name_conflict" | "needs_review" | "duplicate_source_id"; members: number; linkedMembers: number }> = [];
      let createCount = 0; let alreadyLinkedCount = 0; let conflictCount = 0; let invalidCount = 0; let memberCount = 0; let linkedMemberCount = 0;
      for (const group of groups) {
        const sourceId = idOf(group);
        const name = firstText(group.name, group.title);
        const members = elvantoGroupPeople(group);
        const valid = Boolean(sourceId && name && name.length <= 120 && plainDescription(group.description).length <= 1000);
        let action: typeof sample[number]["action"];
        if (!valid) { invalidCount += 1; action = "needs_review"; }
        else if (seen.has(sourceId)) { invalidCount += 1; action = "duplicate_source_id"; }
        else if (bySourceId.has(sourceId)) { alreadyLinkedCount += 1; action = "already_linked"; }
        else if ((names.get(name.toLocaleLowerCase()) ?? []).length > 0) { conflictCount += 1; action = "review_name_conflict"; }
        else { createCount += 1; action = "create"; }
        if (sourceId) seen.add(sourceId);
        memberCount += members.length;
        const linkedMembers = members.filter((person) => linkedIds.has(idOf(person))).length;
        linkedMemberCount += linkedMembers;
        if (sample.length < 50) sample.push({ name, action, members: members.length, linkedMembers });
      }
      const savedPreview = await pool!.query(
        "UPDATE elvanto_sync_settings SET groups_preview_at=CASE WHEN $2 THEN now() ELSE NULL END,groups_preview_complete=$2,groups_preview_scanned_count=$3,groups_preview_total=$4 WHERE department_id=$1 AND updated_at=$5 AND people_importing=FALSE AND groups_importing=FALSE AND services_importing=FALSE AND calendar_importing=FALSE AND people_flows_importing=FALSE AND (songs_importing=FALSE OR songs_import_started_at < now()-interval '15 minutes') AND (financial_importing=FALSE OR financial_import_started_at < now()-interval '15 minutes') RETURNING department_id",
        [dept, complete, groups.length, total, row.updated_at],
      );
      if (!savedPreview.rowCount) return reply.code(409).send({ error: "Elvanto settings changed during the preview. Save the connection again and run a new preview." });
      return { scannedCount: groups.length, reportedTotal: total, complete, createCount, alreadyLinkedCount, nameConflictCount: conflictCount, invalidCount, memberCount, linkedMemberCount, unmatchedMemberCount: memberCount - linkedMemberCount, sample };
    });
    routes.post<{ Body?: { restart?: boolean } }>("/api/modules/sync/elvanto/groups-import", async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      if (elvantoGroupsImportRunning.has(dept)) return reply.code(409).send({ error: "A Groups import is already running for this location." });
      const row = await elvantoSettings(dept);
      if (!row) return reply.code(404).send({ error: "Connect Elvanto before importing groups." });
      if (row.directions.groups === "off" || row.directions.groups === "smart_church_to_elvanto") return reply.code(400).send({ error: "Set Groups direction to Elvanto → Smart Church or bidirectional before importing." });
      const previewTime = row.groups_preview_at ? new Date(row.groups_preview_at).getTime() : 0;
      if (!row.groups_preview_complete || !previewTime || Date.now() - previewTime > 60 * 60 * 1000) return reply.code(409).send({ error: "Run a complete Groups preview first. Previews expire after one hour and after connection settings change." });
      if (row.people_importing) return reply.code(409).send({ error: "Wait for the People import to finish before importing groups." });
      let apiKey: string;
      try { apiKey = decryptElvantoKey(row.encrypted_api_key); }
      catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Reconnect Elvanto." }); }
      elvantoGroupsImportRunning.add(dept);
      let reserved = false;
      try {
        const reservation = await pool!.query(
          `UPDATE elvanto_sync_settings SET groups_importing=TRUE,groups_import_started_at=now(),updated_at=now()
            WHERE department_id=$1 AND updated_at=$2 AND people_importing=FALSE AND groups_preview_complete=TRUE AND groups_preview_at > now()-interval '1 hour'
              AND (groups_importing=FALSE OR groups_import_started_at < now()-interval '15 minutes') AND services_importing=FALSE AND calendar_importing=FALSE AND people_flows_importing=FALSE AND (songs_importing=FALSE OR songs_import_started_at < now()-interval '15 minutes') AND (financial_importing=FALSE OR financial_import_started_at < now()-interval '15 minutes') RETURNING department_id`,
          [dept, row.updated_at],
        );
        if (!reservation.rowCount) return reply.code(409).send({ error: "The preview expired, settings changed, or another import is running. Run a fresh complete Groups preview before importing." });
        reserved = true;
        const restart = Boolean(request.body?.restart);
        let page = restart ? 1 : row.groups_import_page;
        let total = restart ? null : row.groups_import_total;
        let created = restart ? 0 : row.groups_import_created_count;
        let updated = restart ? 0 : row.groups_import_updated_count;
        let skipped = restart ? 0 : row.groups_import_skipped_count;
        let complete = restart ? false : row.groups_import_complete;
        if (restart) await pool!.query("UPDATE elvanto_sync_settings SET groups_import_page=1,groups_import_total=NULL,groups_import_created_count=0,groups_import_updated_count=0,groups_import_skipped_count=0,groups_import_complete=FALSE,updated_at=now() WHERE department_id=$1", [dept]);
        for (let pageBatch = 0; pageBatch < 5 && !complete; pageBatch += 1) {
          const payload = await elvantoRequest(apiKey, "groups/getAll", { page, page_size: 1000, fields: ["people"] });
          const groups = elvantoCollection(payload, "groups", "group");
          const reported = Number((payload.groups as JsonObject | undefined)?.total);
          if (Number.isFinite(reported) && reported >= 0) total = reported;
          const contacts = await pool!.query<{ id: string; source_id: string }>("SELECT id,source_id FROM contacts WHERE department_id=$1 AND source_system='elvanto' AND source_id IS NOT NULL", [dept]);
          const contactIdBySource = new Map(contacts.rows.map((contact) => [contact.source_id, contact.id]));
          const existing = await pool!.query<{ id: string; source_id: string | null; source_system: string | null; name: string }>("SELECT id,source_id,source_system,name FROM church_groups WHERE department_id=$1", [dept]);
          const groupIdBySource = new Map(existing.rows.filter((group) => group.source_system === "elvanto" && group.source_id).map((group) => [group.source_id!, group.id]));
          const namesByKey = new Map<string, typeof existing.rows>();
          for (const group of existing.rows) namesByKey.set(group.name.trim().toLocaleLowerCase(), [...(namesByKey.get(group.name.trim().toLocaleLowerCase()) ?? []), group]);
          const seen = new Set<string>();
          const seenNames = new Set<string>();
          let pageCreated = 0; let pageUpdated = 0; let pageSkipped = 0;
          const db = await pool!.connect();
          try {
            await db.query("BEGIN");
            for (const group of groups) {
              const sourceId = idOf(group);
              const name = firstText(group.name, group.title);
              const description = plainDescription(group.description);
              if (!sourceId || seen.has(sourceId) || !name || name.length > 120 || description.length > 1000) { pageSkipped += 1; continue; }
              seen.add(sourceId);
              const existingId = groupIdBySource.get(sourceId);
              const nameKey = name.toLocaleLowerCase();
              const conflictingOwner = (namesByKey.get(nameKey) ?? []).some((owner) => !(owner.source_system === "elvanto" && owner.source_id === sourceId));
              if (conflictingOwner || seenNames.has(nameKey)) { pageSkipped += 1; continue; }
              seenNames.add(nameKey);
              let groupId = existingId;
              if (existingId) {
                const changed = await db.query("UPDATE church_groups SET name=$3,description=$4,updated_at=now() WHERE id=$1 AND department_id=$2 AND source_system='elvanto' RETURNING id", [existingId, dept, name, description]);
                if (!changed.rowCount) { pageSkipped += 1; continue; }
                pageUpdated += 1;
              } else {
                const inserted = await db.query<{ id: string }>("INSERT INTO church_groups (id,department_id,name,description,source_system,source_id) VALUES (gen_random_uuid(),$1,$2,$3,'elvanto',$4) ON CONFLICT (department_id,source_system,source_id) WHERE source_system IS NOT NULL DO NOTHING RETURNING id", [dept, name, description, sourceId]);
                if (!inserted.rowCount) { pageSkipped += 1; continue; }
                groupId = inserted.rows[0].id;
                pageCreated += 1;
                namesByKey.set(nameKey, [...(namesByKey.get(nameKey) ?? []), { id: groupId, source_id: sourceId, source_system: "elvanto", name }]);
              }
              if (!groupId) { pageSkipped += 1; continue; }
              await db.query("DELETE FROM group_members WHERE group_id=$1", [groupId]);
              const memberIds = new Set<string>();
              for (const person of elvantoGroupPeople(group)) {
                const contactId = contactIdBySource.get(idOf(person));
                if (!contactId || memberIds.has(contactId)) continue;
                memberIds.add(contactId);
                const role = firstText(person.position) || "Member";
                await db.query("INSERT INTO group_members (group_id,contact_id,role,status) VALUES ($1,$2,$3,'active') ON CONFLICT (group_id,contact_id) DO UPDATE SET role=EXCLUDED.role,status='active'", [groupId, contactId, role.slice(0, 80)]);
              }
            }
            created += pageCreated; updated += pageUpdated; skipped += pageSkipped;
            page += 1;
            complete = groups.length === 0 || (total !== null ? page > Math.max(1, Math.ceil(total / 1000)) : groups.length < 1000);
            await db.query("UPDATE elvanto_sync_settings SET groups_import_page=$2,groups_import_total=$3,groups_import_created_count=$4,groups_import_updated_count=$5,groups_import_skipped_count=$6,groups_import_complete=$7,last_sync_at=CASE WHEN $7 THEN now() ELSE last_sync_at END,last_sync_error=NULL,updated_at=now() WHERE department_id=$1", [dept, page, total, created, updated, skipped, complete]);
            await db.query("COMMIT");
          } catch (error) { await db.query("ROLLBACK"); throw error; }
          finally { db.release(); }
          if (!groups.length) break;
        }
        return { groupsImport: { page, total, created, updated, skipped, complete } };
      } catch (error) {
        return reply.code(400).send({ error: error instanceof Error ? error.message : "Groups import failed." });
      } finally {
        if (reserved) await pool!.query("UPDATE elvanto_sync_settings SET groups_importing=FALSE,groups_import_started_at=NULL,updated_at=now() WHERE department_id=$1", [dept]).catch(() => {});
        elvantoGroupsImportRunning.delete(dept);
      }
    });
    routes.post("/api/modules/sync/elvanto/services-preview", async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      const row = await elvantoSettings(dept);
      if (!row) return reply.code(404).send({ error: "Connect Elvanto before previewing services." });
      if (row.directions.services === "off" || row.directions.services === "smart_church_to_elvanto") return reply.code(400).send({ error: "Set Services direction to Elvanto → Smart Church or bidirectional before previewing an import." });
      let apiKey: string;
      try { apiKey = decryptElvantoKey(row.encrypted_api_key); } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Reconnect Elvanto." }); }
      const lock = await pool!.query(
        `UPDATE elvanto_sync_settings SET services_importing=FALSE,services_import_started_at=NULL,services_preview_at=NULL,services_preview_complete=FALSE,services_preview_scanned_count=0,services_preview_total=NULL
         WHERE department_id=$1 AND people_importing=FALSE AND groups_importing=FALSE AND calendar_importing=FALSE AND people_flows_importing=FALSE AND (services_importing=FALSE OR services_import_started_at < now()-interval '15 minutes') RETURNING department_id`, [dept],
      );
      if (!lock.rowCount) return reply.code(409).send({ error: "An Elvanto import is running. Wait for it to finish before creating a Services preview." });
      const services: JsonObject[] = [];
      let total: number | null = null; let complete = false;
      for (let page = 1; page <= 200; page += 1) {
        const payload = await elvantoRequest(apiKey, "services/getAll", { page, page_size: 1000, all: "yes", fields: ["series_name", "service_times", "plans", "volunteers", "songs", "notes"] });
        const batch = elvantoCollection(payload, "services", "service"); services.push(...batch);
        const reported = Number((payload.services as JsonObject | undefined)?.total);
        if (Number.isFinite(reported) && reported >= 0) total = reported;
        if (batch.length < 1000 || total !== null && page * 1000 >= total) { complete = true; break; }
      }
      const [local, contacts] = await Promise.all([
        pool!.query<{ source_id: string | null; source_system: string | null; title: string; event_date: string }>("SELECT source_id,source_system,title,event_date::text FROM service_events WHERE department_id=$1", [dept]),
        pool!.query<{ source_id: string; id: string }>("SELECT source_id,id FROM contacts WHERE department_id=$1 AND source_system='elvanto' AND source_id IS NOT NULL", [dept]),
      ]);
      const events = services.flatMap((service) => mapElvantoServices(service, new Map(contacts.rows.map((person) => [person.source_id, person.id]))));
      const bySource = new Set(local.rows.filter((event) => event.source_system === "elvanto" && event.source_id).map((event) => event.source_id));
      const byTitleDate = new Set(local.rows.map((event) => `${event.event_date}|${event.title.trim().toLocaleLowerCase()}`));
      const seen = new Set<string>(); const sample: Array<{ title: string; date: string; action: string }> = [];
      let createCount = 0; let alreadyLinkedCount = 0; let conflictCount = 0; let invalidCount = 0;
      for (const event of events) {
        let action: string;
        if (!event.sourceId || !event.title || !/^\d{4}-\d{2}-\d{2}$/.test(event.date) || !/^\d{2}:\d{2}$/.test(event.start)) { invalidCount += 1; action = "needs_review"; }
        else if (seen.has(event.sourceId)) { invalidCount += 1; action = "duplicate_source_id"; }
        else if (bySource.has(event.sourceId)) { alreadyLinkedCount += 1; action = "already_linked"; }
        else if (byTitleDate.has(`${event.date}|${event.title.trim().toLocaleLowerCase()}`)) { conflictCount += 1; action = "review_event_conflict"; }
        else { createCount += 1; action = "create"; }
        seen.add(event.sourceId);
        if (sample.length < 50) sample.push({ title: event.title, date: event.date, action });
      }
      const saved = await pool!.query("UPDATE elvanto_sync_settings SET services_preview_at=CASE WHEN $2 THEN now() ELSE NULL END,services_preview_complete=$2,services_preview_scanned_count=$3,services_preview_total=$4 WHERE department_id=$1 AND updated_at=$5 AND people_importing=FALSE AND groups_importing=FALSE AND services_importing=FALSE AND calendar_importing=FALSE AND people_flows_importing=FALSE AND (songs_importing=FALSE OR songs_import_started_at < now()-interval '15 minutes') AND (financial_importing=FALSE OR financial_import_started_at < now()-interval '15 minutes') RETURNING department_id", [dept, complete, events.length, total, row.updated_at]);
      if (!saved.rowCount) return reply.code(409).send({ error: "Elvanto settings changed during the preview. Save the connection again and run a new preview." });
      return { scannedCount: events.length, reportedTotal: total, complete, createCount, alreadyLinkedCount, conflictCount, invalidCount, sample };
    });
    routes.post<{ Body?: { restart?: boolean } }>("/api/modules/sync/elvanto/services-import", async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      if (elvantoServicesImportRunning.has(dept)) return reply.code(409).send({ error: "A Services import is already running for this location." });
      const row = await elvantoSettings(dept);
      if (!row) return reply.code(404).send({ error: "Connect Elvanto before importing services." });
      if (row.directions.services === "off" || row.directions.services === "smart_church_to_elvanto") return reply.code(400).send({ error: "Set Services direction to Elvanto → Smart Church or bidirectional before importing." });
      const previewTime = row.services_preview_at ? new Date(row.services_preview_at).getTime() : 0;
      if (!row.services_preview_complete || !previewTime || Date.now() - previewTime > 60 * 60 * 1000) return reply.code(409).send({ error: "Run a complete Services preview first. Previews expire after one hour and after connection settings change." });
      let apiKey: string;
      try { apiKey = decryptElvantoKey(row.encrypted_api_key); } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Reconnect Elvanto." }); }
      elvantoServicesImportRunning.add(dept); let reserved = false;
      try {
        const reservation = await pool!.query(`UPDATE elvanto_sync_settings SET services_importing=TRUE,services_import_started_at=now(),updated_at=now()
          WHERE department_id=$1 AND updated_at=$2 AND people_importing=FALSE AND groups_importing=FALSE AND calendar_importing=FALSE AND people_flows_importing=FALSE AND services_preview_complete=TRUE AND services_preview_at > now()-interval '1 hour'
            AND (services_importing=FALSE OR services_import_started_at < now()-interval '15 minutes') RETURNING department_id`, [dept, row.updated_at]);
        if (!reservation.rowCount) return reply.code(409).send({ error: "The preview expired, settings changed, or another import is running. Run a fresh complete Services preview before importing." });
        reserved = true;
        const restart = Boolean(request.body?.restart);
        let page = restart ? 1 : row.services_import_page;
        let total = restart ? null : row.services_import_total;
        let created = restart ? 0 : row.services_import_created_count;
        let updated = restart ? 0 : row.services_import_updated_count;
        let skipped = restart ? 0 : row.services_import_skipped_count;
        let complete = restart ? false : row.services_import_complete;
        if (restart) await pool!.query("UPDATE elvanto_sync_settings SET services_import_page=1,services_import_total=NULL,services_import_created_count=0,services_import_updated_count=0,services_import_skipped_count=0,services_import_complete=FALSE,updated_at=now() WHERE department_id=$1", [dept]);
        for (let batchIndex = 0; batchIndex < 5 && !complete; batchIndex += 1) {
          const payload = await elvantoRequest(apiKey, "services/getAll", { page, page_size: 1000, all: "yes", fields: ["series_name", "service_times", "plans", "volunteers", "songs", "notes"] });
          const services = elvantoCollection(payload, "services", "service");
          const reported = Number((payload.services as JsonObject | undefined)?.total); if (Number.isFinite(reported) && reported >= 0) total = reported;
          const [contacts, existing] = await Promise.all([
            pool!.query<{ id: string; source_id: string }>("SELECT id,source_id FROM contacts WHERE department_id=$1 AND source_system='elvanto' AND source_id IS NOT NULL", [dept]),
            pool!.query<{ id: string; source_id: string | null; source_system: string | null; title: string; event_date: string }>("SELECT id,source_id,source_system,title,event_date::text FROM service_events WHERE department_id=$1", [dept]),
          ]);
          const contactBySource = new Map(contacts.rows.map((contact) => [contact.source_id, contact.id]));
          const eventBySource = new Map(existing.rows.filter((event) => event.source_system === "elvanto" && event.source_id).map((event) => [event.source_id!, event]));
          const ownedTitleDates = new Set(existing.rows.filter((event) => event.source_system !== "elvanto").map((event) => `${event.event_date}|${event.title.trim().toLocaleLowerCase()}`));
          const eventRows = services.flatMap((service) => mapElvantoServices(service, contactBySource));
          const seen = new Set<string>(); let pageCreated = 0; let pageUpdated = 0; let pageSkipped = 0;
          const db = await pool!.connect();
          try {
            await db.query("BEGIN");
            for (const event of eventRows) {
              if (!event.sourceId || seen.has(event.sourceId) || !event.title || !/^\d{4}-\d{2}-\d{2}$/.test(event.date) || !/^\d{2}:\d{2}$/.test(event.start)) { pageSkipped += 1; continue; }
              seen.add(event.sourceId);
              const linked = eventBySource.get(event.sourceId);
              if (!linked && ownedTitleDates.has(`${event.date}|${event.title.trim().toLocaleLowerCase()}`)) { pageSkipped += 1; continue; }
              const values = [dept, event.title, event.date, event.start, event.end, event.location, event.description, event.room, JSON.stringify(event.positions), JSON.stringify(event.timePlan), event.sourceId];
              if (linked) {
                const changed = await db.query("UPDATE service_events SET title=$3,kind='service',event_date=$4,start_time=$5,end_time=$6,location=$7,description=$8,room=$9,positions=$10::jsonb,time_plan=$11::jsonb,source_system='elvanto',source_id=$12,updated_at=now() WHERE id=$1 AND department_id=$2 AND source_system='elvanto' RETURNING id", [linked.id, ...values]);
                if (!changed.rowCount) { pageSkipped += 1; continue; } pageUpdated += 1;
              } else {
                const inserted = await db.query("INSERT INTO service_events (id,department_id,title,kind,event_date,start_time,end_time,location,description,room,positions,time_plan,source_system,source_id) VALUES (gen_random_uuid(),$1,$2,'service',$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,'elvanto',$11) ON CONFLICT (department_id,source_system,source_id) WHERE source_system IS NOT NULL DO NOTHING RETURNING id", values);
                if (!inserted.rowCount) { pageSkipped += 1; continue; } pageCreated += 1;
              }
            }
            created += pageCreated; updated += pageUpdated; skipped += pageSkipped; page += 1;
            complete = services.length === 0 || (total !== null ? page > Math.max(1, Math.ceil(total / 1000)) : services.length < 1000);
            await db.query("UPDATE elvanto_sync_settings SET services_import_page=$2,services_import_total=$3,services_import_created_count=$4,services_import_updated_count=$5,services_import_skipped_count=$6,services_import_complete=$7,last_sync_at=CASE WHEN $7 THEN now() ELSE last_sync_at END,last_sync_error=NULL,updated_at=now() WHERE department_id=$1", [dept, page, total, created, updated, skipped, complete]);
            await db.query("COMMIT");
          } catch (error) { await db.query("ROLLBACK"); throw error; } finally { db.release(); }
          if (!services.length) break;
        }
        return { servicesImport: { page, total, created, updated, skipped, complete } };
      } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Services import failed." }); }
      finally {
        if (reserved) await pool!.query("UPDATE elvanto_sync_settings SET services_importing=FALSE,services_import_started_at=NULL,updated_at=now() WHERE department_id=$1", [dept]).catch(() => {});
        elvantoServicesImportRunning.delete(dept);
      }
    });
    routes.get<{ Querystring: { offset?: number; limit?: number } }>("/api/modules/sync/elvanto/songs", { schema: { querystring: { type: "object", additionalProperties: false, properties: { offset: { type: "integer", minimum: 0, maximum: 200000 }, limit: { type: "integer", minimum: 1, maximum: 500 } } } } }, async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      const offset = request.query.offset ?? 0;
      const limit = request.query.limit ?? 100;
      const [items, total] = await Promise.all([
        pool!.query<{ source_id: string; title: string; arrangements: JsonObject[]; imported_at: Date | string }>("SELECT source_id,title,arrangements,imported_at FROM elvanto_songs_import WHERE department_id=$1 ORDER BY title,source_id OFFSET $2 LIMIT $3", [dept, offset, limit]),
        pool!.query<{ count: number }>("SELECT count(*)::int AS count FROM elvanto_songs_import WHERE department_id=$1", [dept]),
      ]);
      return { songs: items.rows.map((song) => ({ sourceId: song.source_id, title: song.title, arrangements: Array.isArray(song.arrangements) ? song.arrangements.length : 0, importedAt: song.imported_at })), offset, total: total.rows[0]?.count ?? 0 };
    });
    routes.get<{ Params: { sourceId: string } }>("/api/modules/sync/elvanto/songs/:sourceId", { schema: { params: { type: "object", additionalProperties: false, required: ["sourceId"], properties: { sourceId: { type: "string", minLength: 1, maxLength: 100 } } } } }, async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      const result = await pool!.query<{ source_id: string; title: string; song: JsonObject; arrangements: JsonObject[]; imported_at: Date | string }>("SELECT source_id,title,song,arrangements,imported_at FROM elvanto_songs_import WHERE department_id=$1 AND source_id=$2", [dept, request.params.sourceId]);
      const song = result.rows[0];
      if (!song) return reply.code(404).send({ error: "Imported Elvanto song was not found." });
      return { sourceId: song.source_id, title: song.title, song: song.song, arrangements: song.arrangements, importedAt: song.imported_at };
    });
    routes.post("/api/modules/sync/elvanto/songs-preview", async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      const row = await elvantoSettings(dept);
      if (!row) return reply.code(404).send({ error: "Connect Elvanto before previewing songs." });
      if (row.directions.songs === "off" || row.directions.songs === "smart_church_to_elvanto") return reply.code(400).send({ error: "Set Songs direction to Elvanto → Smart Church or bidirectional before previewing an import." });
      let apiKey: string;
      try { apiKey = decryptElvantoKey(row.encrypted_api_key); } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Reconnect Elvanto." }); }
      const reserved = await pool!.query(`UPDATE elvanto_sync_settings SET songs_preview_at=NULL,songs_preview_complete=FALSE,songs_preview_count=0,songs_preview_ids='[]'::jsonb,songs_importing=TRUE,songs_import_started_at=now(),updated_at=now()
        WHERE department_id=$1 AND updated_at=$2 AND people_importing=FALSE AND groups_importing=FALSE AND services_importing=FALSE AND calendar_importing=FALSE AND people_flows_importing=FALSE AND (songs_importing=FALSE OR songs_import_started_at < now()-interval '15 minutes') AND (financial_importing=FALSE OR financial_import_started_at < now()-interval '15 minutes') RETURNING department_id`, [dept, row.updated_at]);
      if (!reserved.rowCount) return reply.code(409).send({ error: "An Elvanto import is running. Wait for it to finish before creating a Songs preview." });
      try {
        const snapshot = await fetchElvantoSongs(apiKey, 0, 50, false);
        const uniqueIds = [...new Set(snapshot.songIds)];
        const existing = await pool!.query<{ source_id: string }>("SELECT source_id FROM elvanto_songs_import WHERE department_id=$1", [dept]);
        const linked = new Set(existing.rows.map((song) => song.source_id));
        const createCount = uniqueIds.filter((id) => !linked.has(id)).length;
        const updateCount = uniqueIds.length - createCount;
        const complete = snapshot.complete && uniqueIds.length === snapshot.songCount;
        const sample = snapshot.songs.map((song) => ({ title: song.title, arrangements: 0, action: linked.has(song.sourceId) ? "update" : "create" }));
        const saved = await pool!.query(`UPDATE elvanto_sync_settings SET songs_preview_at=CASE WHEN $2 THEN now() ELSE NULL END,songs_preview_complete=$2,songs_preview_count=$3,songs_preview_ids=$4::jsonb,
          songs_import_page=1,songs_import_total=NULL,songs_import_created_count=0,songs_import_updated_count=0,songs_import_skipped_count=0,songs_import_complete=FALSE
          WHERE department_id=$1 AND songs_importing=TRUE RETURNING department_id`, [dept, complete, uniqueIds.length, JSON.stringify(uniqueIds)]);
        if (!saved.rowCount) return reply.code(409).send({ error: "Elvanto settings changed during the preview. Run a new preview." });
        await pool!.query("UPDATE elvanto_sync_settings SET songs_importing=FALSE,songs_import_started_at=NULL,updated_at=now() WHERE department_id=$1", [dept]);
        return { songCount: uniqueIds.length, reportedSongCount: snapshot.reportedSongs, complete, createCount, updateCount, sample };
      } catch (error) {
        await pool!.query("UPDATE elvanto_sync_settings SET songs_preview_at=NULL,songs_preview_complete=FALSE,songs_preview_ids='[]'::jsonb,songs_importing=FALSE,songs_import_started_at=NULL,updated_at=now() WHERE department_id=$1", [dept]).catch(() => {});
        return reply.code(400).send({ error: error instanceof Error ? error.message : "Songs preview failed." });
      }
    });
    routes.post<{ Body?: { restart?: boolean } }>("/api/modules/sync/elvanto/songs-import", { schema: { body: { type: "object", additionalProperties: false, properties: { restart: { type: "boolean" } } } } }, async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      if (elvantoSongsImportRunning.has(dept)) return reply.code(409).send({ error: "A Songs import is already running for this location." });
      const row = await elvantoSettings(dept);
      if (!row) return reply.code(404).send({ error: "Connect Elvanto before importing songs." });
      if (row.directions.songs === "off" || row.directions.songs === "smart_church_to_elvanto") return reply.code(400).send({ error: "Set Songs direction to Elvanto → Smart Church or bidirectional before importing." });
      const previewTime = row.songs_preview_at ? new Date(row.songs_preview_at).getTime() : 0;
      if (!row.songs_preview_complete || !previewTime || Date.now() - previewTime > 60 * 60 * 1000) return reply.code(409).send({ error: "Run a complete Songs preview first. Previews expire after one hour and after connection settings change." });
      let apiKey: string;
      try { apiKey = decryptElvantoKey(row.encrypted_api_key); } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Reconnect Elvanto." }); }
      elvantoSongsImportRunning.add(dept);
      let reserved = false;
      try {
        const reservation = await pool!.query(`UPDATE elvanto_sync_settings SET songs_importing=TRUE,songs_import_started_at=now(),updated_at=now()
          WHERE department_id=$1 AND updated_at=$2 AND songs_preview_complete=TRUE AND songs_preview_at > now()-interval '1 hour'
            AND people_importing=FALSE AND groups_importing=FALSE AND services_importing=FALSE AND calendar_importing=FALSE AND people_flows_importing=FALSE
            AND (songs_importing=FALSE OR songs_import_started_at < now()-interval '15 minutes') AND (financial_importing=FALSE OR financial_import_started_at < now()-interval '15 minutes') RETURNING department_id`, [dept, row.updated_at]);
        if (!reservation.rowCount) return reply.code(409).send({ error: "The preview expired, settings changed, or another import is running. Run a fresh complete Songs preview before importing." });
        reserved = true;
        const previewIds = Array.isArray(row.songs_preview_ids) ? row.songs_preview_ids : [];
        const current = await fetchElvantoSongs(apiKey, 0, 0, false);
        if (!current.complete || current.songIds.length !== previewIds.length || current.songIds.some((id, index) => id !== previewIds[index])) return reply.code(409).send({ error: "Elvanto songs changed after the preview. Run a fresh Songs preview before importing." });
        const restart = Boolean(request.body?.restart);
        let page = restart ? 1 : row.songs_import_page;
        let created = restart ? 0 : row.songs_import_created_count;
        let updated = restart ? 0 : row.songs_import_updated_count;
        let skipped = restart ? 0 : row.songs_import_skipped_count;
        if (restart) await pool!.query("UPDATE elvanto_sync_settings SET songs_import_complete=FALSE,songs_import_page=1,songs_import_created_count=0,songs_import_updated_count=0,songs_import_skipped_count=0 WHERE department_id=$1", [dept]);
        const snapshot = await fetchElvantoSongs(apiKey, page - 1, 5, true);
        const db = await pool!.connect();
        try {
          await db.query("BEGIN");
          for (const song of snapshot.songs) {
            const existing = await db.query("SELECT 1 FROM elvanto_songs_import WHERE department_id=$1 AND source_id=$2", [dept, song.sourceId]);
            await db.query(`INSERT INTO elvanto_songs_import (department_id,source_id,title,song,arrangements,imported_at) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,now())
              ON CONFLICT (department_id,source_id) DO UPDATE SET title=EXCLUDED.title,song=EXCLUDED.song,arrangements=EXCLUDED.arrangements,imported_at=now()`, [dept, song.sourceId, song.title, JSON.stringify(song.song), JSON.stringify(song.arrangements)]);
            if (existing.rowCount) updated += 1; else created += 1;
          }
          page += snapshot.songs.length;
          const complete = page > previewIds.length;
          const counts = await db.query("SELECT count(*)::int AS count FROM elvanto_songs_import WHERE department_id=$1", [dept]);
          await db.query("UPDATE elvanto_sync_settings SET songs_import_page=$2,songs_import_total=$3,songs_import_created_count=$4,songs_import_updated_count=$5,songs_import_skipped_count=$6,songs_import_complete=$7,songs_imported_count=$8,songs_last_import_at=CASE WHEN $7 THEN now() ELSE songs_last_import_at END,last_sync_at=CASE WHEN $7 THEN now() ELSE last_sync_at END,last_sync_error=NULL,updated_at=now() WHERE department_id=$1", [dept, page, previewIds.length, created, updated, skipped, complete, counts.rows[0].count]);
          await db.query("COMMIT");
          return { songsImport: { page, total: previewIds.length, created, updated, skipped, complete, processedThisBatch: snapshot.songs.length } };
        } catch (error) { await db.query("ROLLBACK"); throw error; } finally { db.release(); }
      } catch (error) {
        await pool!.query("UPDATE elvanto_sync_settings SET last_sync_error=$2 WHERE department_id=$1", [dept, (error instanceof Error ? error.message : "Songs import failed.").slice(0, 1000)]).catch(() => {});
        return reply.code(400).send({ error: error instanceof Error ? error.message : "Songs import failed." });
      } finally {
        if (reserved) await pool!.query("UPDATE elvanto_sync_settings SET songs_importing=FALSE,songs_import_started_at=NULL,updated_at=now() WHERE department_id=$1", [dept]).catch(() => {});
        elvantoSongsImportRunning.delete(dept);
      }
    });
    routes.get<{ Params: { sourceId: string }; Querystring: { offset?: number; limit?: number } }>("/api/modules/sync/elvanto/people-flows/:sourceId", { schema: { params: { type: "object", additionalProperties: false, required: ["sourceId"], properties: { sourceId: { type: "string", minLength: 1, maxLength: 100 } } }, querystring: { type: "object", additionalProperties: false, properties: { offset: { type: "integer", minimum: 0, maximum: 20000 }, limit: { type: "integer", minimum: 1, maximum: 200 } } } } }, async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      const result = await pool!.query<{ source_id: string; name: string; definition: JsonObject; members: JsonObject[]; imported_at: Date | string }>("SELECT source_id,name,definition,members,imported_at FROM elvanto_people_flows_import WHERE department_id=$1 AND source_id=$2", [dept, request.params.sourceId]);
      const flow = result.rows[0];
      if (!flow) return reply.code(404).send({ error: "Imported People Flow was not found." });
      const members = Array.isArray(flow.members) ? flow.members : [];
      const offset = request.query.offset ?? 0;
      const limit = request.query.limit ?? 100;
      const page = members.slice(offset, offset + limit);
      const personIds = [...new Set(page.map((member) => firstText(member.personId)).filter(Boolean))];
      const contacts = personIds.length ? await pool!.query<{ source_id: string; first_name: string; last_name: string; id: string }>("SELECT source_id,first_name,last_name,id FROM contacts WHERE department_id=$1 AND source_system='elvanto' AND source_id=ANY($2::text[])", [dept, personIds]) : { rows: [] };
      const linkedContacts = new Map(contacts.rows.map((contact) => [contact.source_id, contact]));
      return { sourceId: flow.source_id, name: flow.name, definition: flow.definition, members: page.map((member) => { const contact = linkedContacts.get(firstText(member.personId)); return { ...member, contactId: contact?.id ?? null, contactName: contact ? `${contact.first_name} ${contact.last_name}`.trim() : null }; }), memberOffset: offset, memberTotal: members.length, importedAt: flow.imported_at };
    });
    routes.post("/api/modules/sync/elvanto/people-flows-preview", async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      const row = await elvantoSettings(dept);
      if (!row) return reply.code(404).send({ error: "Connect Elvanto before previewing People Flows." });
      if (row.directions.peopleFlows === "off" || row.directions.peopleFlows === "smart_church_to_elvanto") return reply.code(400).send({ error: "Set People Flows direction to Elvanto → Smart Church or bidirectional before previewing an import." });
      let apiKey: string;
      try { apiKey = decryptElvantoKey(row.encrypted_api_key); } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Reconnect Elvanto." }); }
      const reserved = await pool!.query(`UPDATE elvanto_sync_settings SET people_flows_preview_at=NULL,people_flows_preview_complete=FALSE,people_flows_preview_count=0
        WHERE department_id=$1 AND updated_at=$2 AND people_flows_importing=FALSE AND people_importing=FALSE AND groups_importing=FALSE AND services_importing=FALSE AND calendar_importing=FALSE AND people_flows_importing=FALSE AND (songs_importing=FALSE OR songs_import_started_at < now()-interval '15 minutes') AND (financial_importing=FALSE OR financial_import_started_at < now()-interval '15 minutes') RETURNING department_id`, [dept, row.updated_at]);
      if (!reserved.rowCount) return reply.code(409).send({ error: "An Elvanto import is running. Wait for it to finish before creating a People Flows preview." });
      try {
        const snapshot = await fetchElvantoPeopleFlows(apiKey);
        const existing = await pool!.query<{ source_id: string }>("SELECT source_id FROM elvanto_people_flows_import WHERE department_id=$1", [dept]);
        const linked = new Set(existing.rows.map((flow) => flow.source_id));
        const complete = snapshot.reportedFlows === snapshot.flows.length;
        const createCount = snapshot.flows.filter((flow) => !linked.has(flow.sourceId)).length;
        const updateCount = snapshot.flows.length - createCount;
        const sample = snapshot.flows.slice(0, 50).map((flow) => ({ name: flow.name, steps: flow.definition.steps.length, assignments: flow.members.length, action: linked.has(flow.sourceId) ? "update" : "create" }));
        const saved = await pool!.query(`UPDATE elvanto_sync_settings SET people_flows_preview_at=CASE WHEN $2 THEN now() ELSE NULL END,people_flows_preview_complete=$2,people_flows_preview_count=$3,people_flows_preview_ids=$4::jsonb,
          people_flows_import_page=1,people_flows_import_total=NULL,people_flows_import_created_count=0,people_flows_import_updated_count=0,people_flows_import_skipped_count=0,people_flows_import_complete=FALSE
          WHERE department_id=$1 AND updated_at=$5 AND people_flows_importing=FALSE AND (songs_importing=FALSE OR songs_import_started_at < now()-interval '15 minutes') AND (financial_importing=FALSE OR financial_import_started_at < now()-interval '15 minutes') RETURNING department_id`, [dept, complete, snapshot.reportedFlows, JSON.stringify(snapshot.flowIds), row.updated_at]);
        if (!saved.rowCount) return reply.code(409).send({ error: "Elvanto settings changed during the preview. Save the connection again and run a new preview." });
        return { flowCount: snapshot.flows.length, reportedFlowCount: snapshot.reportedFlows, stepCount: snapshot.stepCount, assignmentCount: snapshot.memberCount, complete, createCount, updateCount, sample };
      } catch (error) {
        return reply.code(400).send({ error: error instanceof Error ? error.message : "People Flows preview failed." });
      }
    });
    routes.post<{ Body?: { restart?: boolean } }>("/api/modules/sync/elvanto/people-flows-import", { schema: { body: { type: "object", additionalProperties: false, properties: { restart: { type: "boolean" } } } } }, async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      if (elvantoPeopleFlowsImportRunning.has(dept)) return reply.code(409).send({ error: "A People Flows import is already running for this location." });
      const row = await elvantoSettings(dept);
      if (!row) return reply.code(404).send({ error: "Connect Elvanto before importing People Flows." });
      if (row.directions.peopleFlows === "off" || row.directions.peopleFlows === "smart_church_to_elvanto") return reply.code(400).send({ error: "Set People Flows direction to Elvanto → Smart Church or bidirectional before importing." });
      const previewTime = row.people_flows_preview_at ? new Date(row.people_flows_preview_at).getTime() : 0;
      if (!row.people_flows_preview_complete || !previewTime || Date.now() - previewTime > 60 * 60 * 1000) return reply.code(409).send({ error: "Run a complete People Flows preview first. Previews expire after one hour and after connection settings change." });
      let apiKey: string;
      try { apiKey = decryptElvantoKey(row.encrypted_api_key); } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Reconnect Elvanto." }); }
      elvantoPeopleFlowsImportRunning.add(dept);
      let reserved = false;
      try {
        const reservation = await pool!.query(`UPDATE elvanto_sync_settings SET people_flows_importing=TRUE,people_flows_import_started_at=now(),updated_at=now()
          WHERE department_id=$1 AND updated_at=$2 AND people_flows_preview_complete=TRUE AND people_flows_preview_at > now()-interval '1 hour'
            AND people_importing=FALSE AND groups_importing=FALSE AND services_importing=FALSE AND calendar_importing=FALSE
            AND (people_flows_importing=FALSE OR people_flows_import_started_at < now()-interval '15 minutes') AND (songs_importing=FALSE OR songs_import_started_at < now()-interval '15 minutes') AND (financial_importing=FALSE OR financial_import_started_at < now()-interval '15 minutes') RETURNING department_id`, [dept, row.updated_at]);
        if (!reservation.rowCount) return reply.code(409).send({ error: "The preview expired, settings changed, or another import is running. Run a fresh complete People Flows preview before importing." });
        reserved = true;
        const restart = Boolean(request.body?.restart);
        let page = restart ? 1 : row.people_flows_import_page;
        let total = restart ? row.people_flows_preview_count : row.people_flows_import_total ?? row.people_flows_preview_count;
        let created = restart ? 0 : row.people_flows_import_created_count;
        let updated = restart ? 0 : row.people_flows_import_updated_count;
        let skipped = restart ? 0 : row.people_flows_import_skipped_count;
        let complete = restart ? false : row.people_flows_import_complete;
        if (restart) await pool!.query("UPDATE elvanto_sync_settings SET people_flows_import_page=1,people_flows_import_total=people_flows_preview_count,people_flows_import_created_count=0,people_flows_import_updated_count=0,people_flows_import_skipped_count=0,people_flows_import_complete=FALSE,updated_at=now() WHERE department_id=$1", [dept]);
        const snapshot = await fetchElvantoPeopleFlows(apiKey, (page - 1) * 5, 5);
        if (snapshot.reportedFlows !== total || !Array.isArray(row.people_flows_preview_ids) || snapshot.flowIds.length !== row.people_flows_preview_ids.length || snapshot.flowIds.some((id, index) => id !== row.people_flows_preview_ids[index])) return reply.code(409).send({ error: "Elvanto People Flows changed after the preview. Run a fresh preview before importing." });
        const db = await pool!.connect();
        try {
          await db.query("BEGIN");
          for (const flow of snapshot.flows) {
            const result = await db.query<{ inserted: boolean }>(`INSERT INTO elvanto_people_flows_import (department_id,source_id,name,definition,members,imported_at)
              VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,now())
              ON CONFLICT (department_id,source_id) DO UPDATE SET name=EXCLUDED.name,definition=EXCLUDED.definition,members=EXCLUDED.members,imported_at=now()
              RETURNING (xmax = 0) AS inserted`, [dept, flow.sourceId, flow.name, JSON.stringify(flow.definition), JSON.stringify(flow.members)]);
            if (result.rows[0]?.inserted) created += 1; else updated += 1;
          }
          page += 1;
          complete = (page - 1) * 5 >= total || snapshot.flows.length === 0;
          await db.query(`UPDATE elvanto_sync_settings SET people_flows_import_page=$2,people_flows_import_total=$3,people_flows_import_created_count=$4,people_flows_import_updated_count=$5,people_flows_import_skipped_count=$6,people_flows_import_complete=$7,
            people_flows_imported_count=CASE WHEN $7 THEN $4+$5 ELSE people_flows_imported_count END,people_flows_last_import_at=CASE WHEN $7 THEN now() ELSE people_flows_last_import_at END,
            last_sync_at=CASE WHEN $7 THEN now() ELSE last_sync_at END,last_sync_error=NULL,updated_at=now() WHERE department_id=$1`, [dept, page, total, created, updated, skipped, complete]);
          await db.query("COMMIT");
        } catch (error) { await db.query("ROLLBACK"); throw error; }
        finally { db.release(); }
        return { peopleFlowsImport: { page, total, created, updated, skipped, complete, processedThisBatch: snapshot.flows.length } };
      } catch (error) {
        await pool!.query("UPDATE elvanto_sync_settings SET last_sync_error=$2 WHERE department_id=$1", [dept, (error instanceof Error ? error.message : "People Flows import failed.").slice(0, 1000)]).catch(() => {});
        return reply.code(400).send({ error: error instanceof Error ? error.message : "People Flows import failed." });
      } finally {
        if (reserved) await pool!.query("UPDATE elvanto_sync_settings SET people_flows_importing=FALSE,people_flows_import_started_at=NULL,updated_at=now() WHERE department_id=$1", [dept]).catch(() => {});
        elvantoPeopleFlowsImportRunning.delete(dept);
      }
    });
    routes.post<{ Body: { startDate: string; endDate: string } }>("/api/modules/sync/elvanto/calendar-preview", { schema: { body: { type: "object", additionalProperties: false, required: ["startDate", "endDate"], properties: { startDate: { type: "string", format: "date" }, endDate: { type: "string", format: "date" } } } } }, async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      const row = await elvantoSettings(dept);
      if (!row) return reply.code(404).send({ error: "Connect Elvanto before previewing calendar events." });
      if (row.directions.calendar === "off" || row.directions.calendar === "smart_church_to_elvanto") return reply.code(400).send({ error: "Set Calendar direction to Elvanto → Smart Church or bidirectional before previewing an import." });
      const { startDate, endDate } = request.body;
      if (startDate > endDate) return reply.code(400).send({ error: "Calendar start date must be on or before the end date." });
      let apiKey: string;
      try { apiKey = decryptElvantoKey(row.encrypted_api_key); } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Reconnect Elvanto." }); }
      const lock = await pool!.query(`UPDATE elvanto_sync_settings SET calendar_importing=FALSE,calendar_import_started_at=NULL,calendar_preview_at=NULL,calendar_preview_complete=FALSE,calendar_preview_scanned_count=0,calendar_preview_total=NULL
        WHERE department_id=$1 AND people_importing=FALSE AND groups_importing=FALSE AND services_importing=FALSE AND people_flows_importing=FALSE AND (calendar_importing=FALSE OR calendar_import_started_at < now()-interval '15 minutes') RETURNING department_id`, [dept]);
      if (!lock.rowCount) return reply.code(409).send({ error: "An Elvanto import is running. Wait for it to finish before creating a Calendar preview." });
      const events: JsonObject[] = []; let total: number | null = null; let complete = false;
      for (let page = 1; page <= 200; page += 1) {
        const payload = await elvantoRequest(apiKey, "calendar/events/getAll", { page, page_size: 1000, start: startDate, end: endDate, fields: ["locations"] });
        const batch = elvantoCollection(payload, "events", "event"); events.push(...batch);
        const reported = Number((payload.events as JsonObject | undefined)?.total); if (Number.isFinite(reported) && reported >= 0) total = reported;
        if (batch.length < 1000 || total !== null && page * 1000 >= total) { complete = true; break; }
      }
      const local = await pool!.query<{ source_id: string | null; source_system: string | null; title: string; event_date: string }>("SELECT source_id,source_system,title,event_date::text FROM service_events WHERE department_id=$1", [dept]);
      const mapped = events.map(mapElvantoCalendarEvent).filter((event): event is NonNullable<typeof event> => Boolean(event));
      const bySource = new Set(local.rows.filter((event) => event.source_system === "elvanto" && event.source_id).map((event) => event.source_id));
      const byTitleDate = new Set(local.rows.map((event) => `${event.event_date}|${event.title.trim().toLocaleLowerCase()}`));
      const sample: Array<{ title: string; date: string; action: string }> = []; const seen = new Set<string>();
      let createCount = 0; let alreadyLinkedCount = 0; let conflictCount = 0; let invalidCount = 0;
      for (const event of mapped) {
        let action: string;
        if (!event.title || !/^\d{4}-\d{2}-\d{2}$/.test(event.date) || !/^\d{2}:\d{2}$/.test(event.start)) { invalidCount += 1; action = "needs_review"; }
        else if (seen.has(event.sourceId)) { invalidCount += 1; action = "duplicate_source_id"; }
        else if (bySource.has(event.sourceId)) { alreadyLinkedCount += 1; action = "already_linked"; }
        else if (byTitleDate.has(`${event.date}|${event.title.trim().toLocaleLowerCase()}`)) { conflictCount += 1; action = "review_event_conflict"; }
        else { createCount += 1; action = "create"; }
        seen.add(event.sourceId); if (sample.length < 50) sample.push({ title: event.title, date: event.date, action });
      }
      const saved = await pool!.query(`UPDATE elvanto_sync_settings SET calendar_preview_at=CASE WHEN $2 THEN now() ELSE NULL END,calendar_preview_complete=$2,calendar_preview_scanned_count=$3,calendar_preview_total=$4,calendar_preview_start_date=$5::date,calendar_preview_end_date=$6::date,
          calendar_import_page=1,calendar_import_total=NULL,calendar_import_created_count=0,calendar_import_updated_count=0,calendar_import_skipped_count=0,calendar_import_complete=FALSE,calendar_import_start_date=NULL,calendar_import_end_date=NULL
        WHERE department_id=$1 AND updated_at=$7 AND people_importing=FALSE AND groups_importing=FALSE AND services_importing=FALSE AND calendar_importing=FALSE AND people_flows_importing=FALSE AND (songs_importing=FALSE OR songs_import_started_at < now()-interval '15 minutes') AND (financial_importing=FALSE OR financial_import_started_at < now()-interval '15 minutes') RETURNING department_id`, [dept, complete, mapped.length, total, startDate, endDate, row.updated_at]);
      if (!saved.rowCount) return reply.code(409).send({ error: "Elvanto settings changed during the preview. Save the connection again and run a new preview." });
      return { scannedCount: mapped.length, reportedTotal: total, complete, startDate, endDate, createCount, alreadyLinkedCount, conflictCount, invalidCount, sample };
    });
    routes.post<{ Body?: { restart?: boolean } }>("/api/modules/sync/elvanto/calendar-import", async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      if (elvantoCalendarImportRunning.has(dept)) return reply.code(409).send({ error: "A Calendar import is already running for this location." });
      const row = await elvantoSettings(dept);
      if (!row) return reply.code(404).send({ error: "Connect Elvanto before importing calendar events." });
      if (row.directions.calendar === "off" || row.directions.calendar === "smart_church_to_elvanto") return reply.code(400).send({ error: "Set Calendar direction to Elvanto → Smart Church or bidirectional before importing." });
      const previewTime = row.calendar_preview_at ? new Date(row.calendar_preview_at).getTime() : 0;
      if (!row.calendar_preview_complete || !previewTime || Date.now() - previewTime > 60 * 60 * 1000 || !row.calendar_preview_start_date || !row.calendar_preview_end_date) return reply.code(409).send({ error: "Run a complete Calendar preview first. Previews expire after one hour and after connection settings change." });
      let apiKey: string;
      try { apiKey = decryptElvantoKey(row.encrypted_api_key); } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Reconnect Elvanto." }); }
      elvantoCalendarImportRunning.add(dept); let reserved = false;
      try {
        const reservation = await pool!.query(`UPDATE elvanto_sync_settings SET calendar_importing=TRUE,calendar_import_started_at=now(),calendar_import_start_date=calendar_preview_start_date,calendar_import_end_date=calendar_preview_end_date,updated_at=now()
          WHERE department_id=$1 AND updated_at=$2 AND people_importing=FALSE AND groups_importing=FALSE AND services_importing=FALSE AND calendar_preview_complete=TRUE AND calendar_preview_at > now()-interval '1 hour' AND people_flows_importing=FALSE AND (songs_importing=FALSE OR songs_import_started_at < now()-interval '15 minutes') AND (financial_importing=FALSE OR financial_import_started_at < now()-interval '15 minutes')
            AND (calendar_importing=FALSE OR calendar_import_started_at < now()-interval '15 minutes') RETURNING department_id`, [dept, row.updated_at]);
        if (!reservation.rowCount) return reply.code(409).send({ error: "The preview expired, settings changed, or another import is running. Run a fresh complete Calendar preview before importing." });
        reserved = true;
        const restart = Boolean(request.body?.restart); let page = restart ? 1 : row.calendar_import_page;
        let total = restart ? null : row.calendar_import_total; let created = restart ? 0 : row.calendar_import_created_count;
        let updated = restart ? 0 : row.calendar_import_updated_count; let skipped = restart ? 0 : row.calendar_import_skipped_count;
        let complete = restart ? false : row.calendar_import_complete;
        if (restart) await pool!.query("UPDATE elvanto_sync_settings SET calendar_import_page=1,calendar_import_total=NULL,calendar_import_created_count=0,calendar_import_updated_count=0,calendar_import_skipped_count=0,calendar_import_complete=FALSE,updated_at=now() WHERE department_id=$1", [dept]);
        const startDate = row.calendar_preview_start_date; const endDate = row.calendar_preview_end_date;
        for (let batchIndex = 0; batchIndex < 5 && !complete; batchIndex += 1) {
          const payload = await elvantoRequest(apiKey, "calendar/events/getAll", { page, page_size: 1000, start: startDate, end: endDate, fields: ["locations"] });
          const events = elvantoCollection(payload, "events", "event"); const reported = Number((payload.events as JsonObject | undefined)?.total); if (Number.isFinite(reported) && reported >= 0) total = reported;
          const local = await pool!.query<{ id: string; source_id: string | null; source_system: string | null; title: string; event_date: string }>("SELECT id,source_id,source_system,title,event_date::text FROM service_events WHERE department_id=$1", [dept]);
          const bySource = new Map(local.rows.filter((event) => event.source_system === "elvanto" && event.source_id).map((event) => [event.source_id!, event]));
          const occupied = new Set(local.rows.filter((event) => event.source_system !== "elvanto").map((event) => `${event.event_date}|${event.title.trim().toLocaleLowerCase()}`));
          const seen = new Set<string>(); let pageCreated = 0; let pageUpdated = 0; let pageSkipped = 0;
          const db = await pool!.connect();
          try {
            await db.query("BEGIN");
            for (const rawEvent of events) {
              const event = mapElvantoCalendarEvent(rawEvent);
              if (!event || !event.title || !/^\d{4}-\d{2}-\d{2}$/.test(event.date) || !/^\d{2}:\d{2}$/.test(event.start) || seen.has(event.sourceId)) { pageSkipped += 1; continue; }
              seen.add(event.sourceId); const linked = bySource.get(event.sourceId);
              if (!linked && occupied.has(`${event.date}|${event.title.trim().toLocaleLowerCase()}`)) { pageSkipped += 1; continue; }
              const values = [dept, event.title, event.date, event.start, event.end, event.location, event.description, event.room, JSON.stringify([]), JSON.stringify([]), event.sourceId];
              if (linked) {
                const changed = await db.query("UPDATE service_events SET title=$3,kind='other',event_date=$4,start_time=$5,end_time=$6,location=$7,description=$8,room=$9,positions=$10::jsonb,time_plan=$11::jsonb,source_system='elvanto',source_id=$12,updated_at=now() WHERE id=$1 AND department_id=$2 AND source_system='elvanto' RETURNING id", [linked.id, ...values]);
                if (!changed.rowCount) { pageSkipped += 1; continue; } pageUpdated += 1;
              } else {
                const inserted = await db.query("INSERT INTO service_events (id,department_id,title,kind,event_date,start_time,end_time,location,description,room,positions,time_plan,source_system,source_id) VALUES (gen_random_uuid(),$1,$2,'other',$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,'elvanto',$11) ON CONFLICT (department_id,source_system,source_id) WHERE source_system IS NOT NULL DO NOTHING RETURNING id", values);
                if (!inserted.rowCount) { pageSkipped += 1; continue; } pageCreated += 1;
              }
            }
            created += pageCreated; updated += pageUpdated; skipped += pageSkipped; page += 1;
            complete = events.length === 0 || (total !== null ? page > Math.max(1, Math.ceil(total / 1000)) : events.length < 1000);
            await db.query("UPDATE elvanto_sync_settings SET calendar_import_page=$2,calendar_import_total=$3,calendar_import_created_count=$4,calendar_import_updated_count=$5,calendar_import_skipped_count=$6,calendar_import_complete=$7,last_sync_at=CASE WHEN $7 THEN now() ELSE last_sync_at END,last_sync_error=NULL,updated_at=now() WHERE department_id=$1", [dept, page, total, created, updated, skipped, complete]);
            await db.query("COMMIT");
          } catch (error) { await db.query("ROLLBACK"); throw error; } finally { db.release(); }
          if (!events.length) break;
        }
        return { calendarImport: { page, total, created, updated, skipped, complete, startDate, endDate } };
      } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Calendar import failed." }); }
      finally {
        if (reserved) await pool!.query("UPDATE elvanto_sync_settings SET calendar_importing=FALSE,calendar_import_started_at=NULL,updated_at=now() WHERE department_id=$1", [dept]).catch(() => {});
        elvantoCalendarImportRunning.delete(dept);
      }
    });
    routes.put<{ Body: { apiKey?: string; directions: ElvantoDirections; financialEnabled: boolean } }>("/api/modules/sync/elvanto", {
      schema: { body: { type: "object", additionalProperties: false, required: ["directions", "financialEnabled"], properties: { apiKey: { type: "string", maxLength: 4096 }, directions: { type: "object", additionalProperties: false, required: [...elvantoAreas], properties: Object.fromEntries(elvantoAreas.map((area) => [area, { type: "string", enum: ["off", "bidirectional", "elvanto_to_smart_church", "smart_church_to_elvanto"] }])) }, financialEnabled: { type: "boolean" } } } },
    }, async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      let directions: ElvantoDirections;
      try { directions = normalizeElvantoDirections(request.body.directions); } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Choose valid sync directions." }); }
      if (!request.body.financialEnabled && directions.financial !== "off") return reply.code(400).send({ error: "Enable the explicit financial data permission before selecting a financial sync direction." });
      const existing = await elvantoSettings(dept);
      let apiKey = request.body.apiKey?.trim();
      if (!apiKey && existing) try { apiKey = decryptElvantoKey(existing.encrypted_api_key); } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Reconnect Elvanto." }); }
      if (!apiKey) return reply.code(400).send({ error: "Enter an Elvanto API key." });
      try { await testElvantoConnection(apiKey); } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Elvanto connection failed." }); }
      let encryptedKey = existing?.encrypted_api_key;
      if (request.body.apiKey?.trim()) try { encryptedKey = encryptElvantoKey(apiKey); } catch (error) { return reply.code(503).send({ error: error instanceof Error ? error.message : "API key encryption is unavailable." }); }
      if (!encryptedKey) return reply.code(503).send({ error: "API key encryption is unavailable." });
      const result = await pool!.query(
        `INSERT INTO elvanto_sync_settings (department_id,encrypted_api_key,directions,financial_enabled,enabled,last_connected_at)
         VALUES ($1,$2,$3::jsonb,$4,false,now())
         ON CONFLICT (department_id) DO UPDATE SET encrypted_api_key=EXCLUDED.encrypted_api_key,directions=EXCLUDED.directions,financial_enabled=EXCLUDED.financial_enabled,last_connected_at=now(),last_sync_error=NULL,
          people_import_page=CASE WHEN $5 THEN 1 ELSE elvanto_sync_settings.people_import_page END,
          people_import_total=CASE WHEN $5 THEN NULL ELSE elvanto_sync_settings.people_import_total END,
          people_import_created_count=CASE WHEN $5 THEN 0 ELSE elvanto_sync_settings.people_import_created_count END,
          people_import_updated_count=CASE WHEN $5 THEN 0 ELSE elvanto_sync_settings.people_import_updated_count END,
          people_import_skipped_count=CASE WHEN $5 THEN 0 ELSE elvanto_sync_settings.people_import_skipped_count END,
          people_import_complete=CASE WHEN $5 THEN FALSE ELSE elvanto_sync_settings.people_import_complete END,
          groups_import_page=CASE WHEN $5 THEN 1 ELSE elvanto_sync_settings.groups_import_page END,
          groups_import_total=CASE WHEN $5 THEN NULL ELSE elvanto_sync_settings.groups_import_total END,
          groups_import_created_count=CASE WHEN $5 THEN 0 ELSE elvanto_sync_settings.groups_import_created_count END,
          groups_import_updated_count=CASE WHEN $5 THEN 0 ELSE elvanto_sync_settings.groups_import_updated_count END,
          groups_import_skipped_count=CASE WHEN $5 THEN 0 ELSE elvanto_sync_settings.groups_import_skipped_count END,
          groups_import_complete=CASE WHEN $5 THEN FALSE ELSE elvanto_sync_settings.groups_import_complete END,
          people_preview_at=NULL,people_preview_scanned_count=0,people_preview_total=NULL,people_preview_complete=FALSE,
          groups_preview_at=NULL,groups_preview_scanned_count=0,groups_preview_total=NULL,groups_preview_complete=FALSE,
          services_import_page=CASE WHEN $5 THEN 1 ELSE elvanto_sync_settings.services_import_page END,
          services_import_total=CASE WHEN $5 THEN NULL ELSE elvanto_sync_settings.services_import_total END,
          services_import_created_count=CASE WHEN $5 THEN 0 ELSE elvanto_sync_settings.services_import_created_count END,
          services_import_updated_count=CASE WHEN $5 THEN 0 ELSE elvanto_sync_settings.services_import_updated_count END,
          services_import_skipped_count=CASE WHEN $5 THEN 0 ELSE elvanto_sync_settings.services_import_skipped_count END,
          services_import_complete=CASE WHEN $5 THEN FALSE ELSE elvanto_sync_settings.services_import_complete END,
          calendar_import_page=CASE WHEN $5 THEN 1 ELSE elvanto_sync_settings.calendar_import_page END,
          calendar_import_total=CASE WHEN $5 THEN NULL ELSE elvanto_sync_settings.calendar_import_total END,
          calendar_import_created_count=CASE WHEN $5 THEN 0 ELSE elvanto_sync_settings.calendar_import_created_count END,
          calendar_import_updated_count=CASE WHEN $5 THEN 0 ELSE elvanto_sync_settings.calendar_import_updated_count END,
          calendar_import_skipped_count=CASE WHEN $5 THEN 0 ELSE elvanto_sync_settings.calendar_import_skipped_count END,
          calendar_import_complete=CASE WHEN $5 THEN FALSE ELSE elvanto_sync_settings.calendar_import_complete END,
          people_flows_import_page=CASE WHEN $5 THEN 1 ELSE elvanto_sync_settings.people_flows_import_page END,
          people_flows_import_total=CASE WHEN $5 THEN NULL ELSE elvanto_sync_settings.people_flows_import_total END,
          people_flows_import_created_count=CASE WHEN $5 THEN 0 ELSE elvanto_sync_settings.people_flows_import_created_count END,
          people_flows_import_updated_count=CASE WHEN $5 THEN 0 ELSE elvanto_sync_settings.people_flows_import_updated_count END,
          people_flows_import_skipped_count=CASE WHEN $5 THEN 0 ELSE elvanto_sync_settings.people_flows_import_skipped_count END,
          people_flows_import_complete=CASE WHEN $5 THEN FALSE ELSE elvanto_sync_settings.people_flows_import_complete END,
          songs_import_page=CASE WHEN $5 THEN 1 ELSE elvanto_sync_settings.songs_import_page END,songs_import_total=CASE WHEN $5 THEN NULL ELSE elvanto_sync_settings.songs_import_total END,songs_import_created_count=CASE WHEN $5 THEN 0 ELSE elvanto_sync_settings.songs_import_created_count END,songs_import_updated_count=CASE WHEN $5 THEN 0 ELSE elvanto_sync_settings.songs_import_updated_count END,songs_import_skipped_count=CASE WHEN $5 THEN 0 ELSE elvanto_sync_settings.songs_import_skipped_count END,songs_import_complete=CASE WHEN $5 THEN FALSE ELSE elvanto_sync_settings.songs_import_complete END,
          financial_import_page=CASE WHEN $5 THEN 1 ELSE elvanto_sync_settings.financial_import_page END,financial_import_total=CASE WHEN $5 THEN NULL ELSE elvanto_sync_settings.financial_import_total END,financial_import_created_count=CASE WHEN $5 THEN 0 ELSE elvanto_sync_settings.financial_import_created_count END,financial_import_updated_count=CASE WHEN $5 THEN 0 ELSE elvanto_sync_settings.financial_import_updated_count END,financial_import_skipped_count=CASE WHEN $5 THEN 0 ELSE elvanto_sync_settings.financial_import_skipped_count END,financial_import_complete=CASE WHEN $5 THEN FALSE ELSE elvanto_sync_settings.financial_import_complete END,
          songs_preview_at=NULL,songs_preview_ids='[]'::jsonb,songs_preview_complete=FALSE,songs_preview_count=0,financial_preview_at=NULL,financial_preview_ids='[]'::jsonb,financial_preview_complete=FALSE,financial_preview_count=0,
          services_preview_at=NULL,services_preview_scanned_count=0,services_preview_total=NULL,services_preview_complete=FALSE,
          calendar_preview_at=NULL,calendar_preview_scanned_count=0,calendar_preview_total=NULL,calendar_preview_complete=FALSE,calendar_preview_start_date=NULL,calendar_preview_end_date=NULL,
          people_flows_preview_at=NULL,people_flows_preview_ids='[]'::jsonb,people_flows_preview_complete=FALSE,people_flows_preview_count=0,
          people_importing=FALSE,people_import_started_at=NULL,groups_importing=FALSE,groups_import_started_at=NULL,services_importing=FALSE,services_import_started_at=NULL,calendar_importing=FALSE,calendar_import_started_at=NULL,people_flows_importing=FALSE,people_flows_import_started_at=NULL,songs_importing=FALSE,songs_import_started_at=NULL,financial_importing=FALSE,financial_import_started_at=NULL,updated_at=now()
         WHERE (elvanto_sync_settings.people_importing=FALSE OR elvanto_sync_settings.people_import_started_at < now()-interval '15 minutes')
           AND (elvanto_sync_settings.groups_importing=FALSE OR elvanto_sync_settings.groups_import_started_at < now()-interval '15 minutes')
           AND (elvanto_sync_settings.services_importing=FALSE OR elvanto_sync_settings.services_import_started_at < now()-interval '15 minutes')
           AND (elvanto_sync_settings.calendar_importing=FALSE OR elvanto_sync_settings.calendar_import_started_at < now()-interval '15 minutes')
           AND (elvanto_sync_settings.people_flows_importing=FALSE OR elvanto_sync_settings.people_flows_import_started_at < now()-interval '15 minutes')
           AND (elvanto_sync_settings.songs_importing=FALSE OR elvanto_sync_settings.songs_import_started_at < now()-interval '15 minutes') AND (elvanto_sync_settings.financial_importing=FALSE OR elvanto_sync_settings.financial_import_started_at < now()-interval '15 minutes')
         RETURNING department_id`,
        [dept, encryptedKey, JSON.stringify(directions), request.body.financialEnabled, Boolean(request.body.apiKey?.trim())],
      );
      if (!result.rowCount) return reply.code(409).send({ error: "An Elvanto import is running. Wait for it to finish before changing settings." });
      return { saved: true, configured: true, directions, financialEnabled: request.body.financialEnabled };
    });
    routes.delete("/api/modules/sync/elvanto", async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      const result = await pool!.query("DELETE FROM elvanto_sync_settings WHERE department_id=$1 AND (people_importing=FALSE OR people_import_started_at < now()-interval '15 minutes') AND (groups_importing=FALSE OR groups_import_started_at < now()-interval '15 minutes') AND (services_importing=FALSE OR services_import_started_at < now()-interval '15 minutes') AND (calendar_importing=FALSE OR calendar_import_started_at < now()-interval '15 minutes') AND (people_flows_importing=FALSE OR people_flows_import_started_at < now()-interval '15 minutes') AND (songs_importing=FALSE OR songs_import_started_at < now()-interval '15 minutes') AND (financial_importing=FALSE OR financial_import_started_at < now()-interval '15 minutes') RETURNING department_id", [dept]);
      if (!result.rowCount) {
        const existing = await elvantoSettings(dept);
        if (existing) return reply.code(409).send({ error: "An Elvanto import is running. Wait for it to finish before disconnecting Elvanto." });
      }
      return { disconnected: true };
    });
    const timer = setInterval(() => {
      if (!pool || !isDatabaseReady()) return;
      void pool.query("SELECT department_id FROM churchtools_sync_settings WHERE enabled=true").then(async (result) => {
        for (const row of result.rows) try { await run(row.department_id); } catch { /* Errors are recorded for the sync status page. */ }
      }).catch(() => {});
    }, syncIntervalMs);
    timer.unref();
    routes.addHook("onClose", async () => clearInterval(timer));
  });
}
