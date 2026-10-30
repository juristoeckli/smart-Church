import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import type { ModuleServerContext } from "../module-sdk.js";
import { registerChurchToolsSyncReplication } from "./replication.js";
import { parseChurchToolsEventDateTime } from "./event-time.js";

type JsonObject = Record<string, any>;
type Settings = { department_id: string; instance_url: string; encrypted_login_token: string; enabled: boolean };
const elvantoAreas = ["people", "peopleFlows", "groups", "services", "songs", "calendar", "financial"] as const;
type ElvantoArea = typeof elvantoAreas[number];
type ElvantoDirection = "off" | "bidirectional" | "elvanto_to_smart_church" | "smart_church_to_elvanto";
type ElvantoDirections = Record<ElvantoArea, ElvantoDirection>;
type ElvantoSettings = { department_id: string; encrypted_api_key: string; directions: ElvantoDirections; financial_enabled: boolean; enabled: boolean; last_connected_at: string | null; last_sync_at: string | null; last_sync_error: string | null; people_import_page: number; people_import_total: number | null; people_import_created_count: number; people_import_updated_count: number; people_import_skipped_count: number; people_import_complete: boolean; people_preview_at: string | null; people_preview_scanned_count: number; people_preview_total: number | null; people_preview_complete: boolean; people_importing: boolean; people_import_started_at: string | null; groups_import_page: number; groups_import_total: number | null; groups_import_created_count: number; groups_import_updated_count: number; groups_import_skipped_count: number; groups_import_complete: boolean; groups_preview_at: string | null; groups_preview_scanned_count: number; groups_preview_total: number | null; groups_preview_complete: boolean; groups_importing: boolean; groups_import_started_at: string | null; services_import_page: number; services_import_total: number | null; services_import_created_count: number; services_import_updated_count: number; services_import_skipped_count: number; services_import_complete: boolean; services_preview_at: string | null; services_preview_scanned_count: number; services_preview_total: number | null; services_preview_complete: boolean; services_importing: boolean; services_import_started_at: string | null; calendar_import_page: number; calendar_import_total: number | null; calendar_import_created_count: number; calendar_import_updated_count: number; calendar_import_skipped_count: number; calendar_import_complete: boolean; calendar_preview_at: string | null; calendar_preview_scanned_count: number; calendar_preview_total: number | null; calendar_preview_complete: boolean; calendar_preview_start_date: string | null; calendar_preview_end_date: string | null; calendar_import_start_date: string | null; calendar_import_end_date: string | null; calendar_importing: boolean; calendar_import_started_at: string | null; calendar_export_calendar_id: string | null; calendar_export_organizer_id: string | null; calendar_export_preview_at: string | null; calendar_export_preview_rows: JsonObject[]; calendar_export_page: number; calendar_export_created_count: number; calendar_export_updated_count: number; calendar_export_skipped_count: number; calendar_export_complete: boolean; songs_import_page: number; songs_import_total: number | null; songs_import_created_count: number; songs_import_updated_count: number; songs_import_skipped_count: number; songs_import_complete: boolean; songs_preview_at: string | null; songs_preview_ids: string[]; songs_preview_complete: boolean; songs_preview_count: number; songs_imported_count: number; songs_last_import_at: string | null; songs_importing: boolean; songs_import_started_at: string | null; people_flows_import_page: number; people_flows_import_total: number | null; people_flows_import_created_count: number; people_flows_import_updated_count: number; people_flows_import_skipped_count: number; people_flows_import_complete: boolean; people_flows_preview_at: string | null; people_flows_preview_ids: string[]; people_flows_preview_complete: boolean; people_flows_preview_count: number; people_flows_imported_count: number; people_flows_last_import_at: string | null; people_flows_importing: boolean; people_flows_import_started_at: string | null; updated_at: Date | string };
const running = new Set<string>();
const elvantoPeopleImportRunning = new Set<string>();
const elvantoPeopleExportRunning = new Set<string>();
const elvantoGroupsImportRunning = new Set<string>();
const elvantoServicesImportRunning = new Set<string>();
const elvantoCalendarImportRunning = new Set<string>();
const elvantoCalendarExportRunning = new Set<string>();
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
  const safeToRetry = !/\/(create|edit|remove|addPerson|removePerson)$/i.test(endpoint);
  let response: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      response = await fetch(`https://api.elvanto.com/v1/${endpoint}.json`, {
        method: "POST",
        headers: { Authorization: `Basic ${Buffer.from(`${apiKey}:x`).toString("base64")}`, Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
        redirect: "error",
      });
    } catch (error) {
      const retryable = error instanceof TypeError || error instanceof Error && error.name === "TimeoutError";
      if (!safeToRetry || !retryable || attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** attempt)));
      continue;
    }
    if (safeToRetry && (response.status === 429 || response.status >= 500) && attempt < 2) {
      const header = response.headers.get("retry-after");
      const seconds = header ? Number(header) : NaN;
      const dateDelay = header && !Number.isFinite(seconds) ? Date.parse(header) - Date.now() : NaN;
      const delay = Number.isFinite(seconds) ? seconds * 1000 : Number.isFinite(dateDelay) ? dateDelay : 250 * (2 ** attempt);
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.min(delay, 10_000))));
      continue;
    }
    break;
  }
  if (!response) throw new Error("Elvanto did not return a response. Try again later.");
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
async function fetchElvantoGroupInfo(apiKey: string, groupId: string) {
  const payload = await elvantoRequest(apiKey, "groups/getInfo", { id: groupId, fields: ["people"] });
  const value = payload.group;
  return Array.isArray(value) ? value[0] as JsonObject | undefined : value as JsonObject | undefined;
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
    const isAllDay = time.all_day === true || time.all_day === "yes" || time.all_day === "1";
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
      date: start.date, isAllDay, start: isAllDay ? "00:00" : start.time, end: isAllDay ? null : end?.date === start.date && end.time > start.time ? end.time : null,
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
    isAllDay: allDay,
    start: allDay ? "00:00" : start.time,
    end: !allDay && end?.date === start.date && end.time > start.time ? end.time : null,
    location: firstText(event.where, locations.join(", ")) || "Elvanto calendar",
    room: "",
    description: plainDescription(event.description).slice(0, 2000),
  };
}
function localEventTimeToUtc(date: string, time: string, timeZone: string) {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const clock = time.match(/^(\d{2}):(\d{2})$/);
  if (!match || !clock || Number(clock[1]) > 23 || Number(clock[2]) > 59) throw new Error("An event has an invalid local date or time.");
  const target = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(clock[1]), Number(clock[2]));
  const formatter = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const partsAt = (instant: number) => {
    const parts = formatter.formatToParts(new Date(instant));
    const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute") };
  };
  let candidate = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = partsAt(candidate);
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    const correction = target - represented;
    if (!correction) break;
    candidate += correction;
  }
  const resolved = partsAt(candidate);
  if (resolved.year !== Number(match[1]) || resolved.month !== Number(match[2]) || resolved.day !== Number(match[3]) || resolved.hour !== Number(clock[1]) || resolved.minute !== Number(clock[2])) {
    throw new Error(`The local event time ${date} ${time} does not exist in ${timeZone} because of a daylight-saving change.`);
  }
  const earlier = partsAt(candidate - 60 * 60 * 1000);
  if (earlier.year === resolved.year && earlier.month === resolved.month && earlier.day === resolved.day && earlier.hour === resolved.hour && earlier.minute === resolved.minute) {
    throw new Error(`The local event time ${date} ${time} occurs twice in ${timeZone} because of a daylight-saving change.`);
  }
  return new Date(candidate).toISOString().slice(0, 19).replace("T", " ");
}
function calendarEventFingerprint(event: JsonObject) {
  return createHash("sha256").update(JSON.stringify({ id: idOf(event), name: firstText(event.name, event.title), start: event.start_date ?? event.startDate ?? event.starts ?? event.start, end: event.end_date ?? event.endDate ?? event.ends ?? event.end, allDay: event.all_day ?? event.allDay, calendarId: event.calendar_id ?? event.calendar?.id, organizer: event.organizer?.id ?? event.organizer, where: event.where, description: event.description, status: event.status })).digest("hex");
}
function elvantoEventDateInTimeZone(event: JsonObject, timeZone: string) {
  const start = elvantoTime(event.start_date ?? event.startDate ?? event.starts);
  if (!start) return "";
  if (event.all_day === true || event.all_day === "yes" || event.all_day === "1" || event.allDay === true) return start.date;
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = formatter.formatToParts(new Date(`${start.date}T${start.time}:00Z`));
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}
function shiftDate(date: string, days: number) {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
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
const elvantoPeopleFields = ["preferred_name", "mobile", "gender", "birthday", "anniversary", "school_grade", "marital_status", "development_child", "special_needs_child", "mailing_address", "family_id", "family_relationship", "archived", "contact", "volunteer", "departments", "demographics", "service_types", "locations"];
async function fetchElvantoPeopleCustomFields(apiKey: string) {
  const result = await fetchElvantoPagedRows(apiKey, "people/customFields/getAll", "custom_fields", "custom_field");
  const fields = result.rows.map((field) => ({ id: idOf(field), name: firstText(field.name), type: firstText(field.type) })).filter((field) => field.id && field.name).sort((left, right) => left.id.localeCompare(right.id));
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
    if (person[source] !== undefined && person[source] !== null) profile[key] = person[source] === true || person[source] === 1 || ["1", "true", "yes"].includes(String(person[source]).trim().toLowerCase());
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
function elvantoPeopleExportHash(contact: { id: string; first_name: string; last_name: string; email: string | null; phone: string | null; elvanto_source_id: string | null; profile_data?: JsonObject }) {
  return createHash("sha256").update(JSON.stringify([contact.id, contact.first_name, contact.last_name, contact.email, contact.phone, contact.elvanto_source_id, contact.profile_data ?? {}])).digest("hex");
}
function elvantoRemotePersonHash(person: JsonObject) {
  const profileKeys = ["gender", "birthday", "anniversary", "school_grade", "marital_status", "development_child", "special_needs_child", "mailing_address", "family_id", "family_relationship", "archived", "volunteer", "departments", "service_types", "demographics", "locations"];
  const profile = profileKeys.map((key) => [key, person[key] ?? null]);
  const custom = Object.keys(person).filter((key) => /^custom_[A-Za-z0-9_-]+$/.test(key)).sort().map((key) => [key, person[key]]);
  return createHash("sha256").update(JSON.stringify([idOf(person), firstText(person.firstname), firstText(person.preferred_name), firstText(person.lastname), firstText(person.email), firstText(person.phone), firstText(person.mobile), person.contact === true || person.contact === 1 || person.contact === "1", profile, custom])).digest("hex");
}
function recordsHaveStaleFieldMap(rows: Array<{ profileFieldsHash?: string }>, currentHash: string) {
  return rows.some((row) => row.profileFieldsHash !== currentHash);
}
function elvantoPeopleProfileExport(profileValue: unknown, remotePerson?: JsonObject): JsonObject {
  const profile = profileValue && typeof profileValue === "object" && !Array.isArray(profileValue) ? profileValue as JsonObject : {};
  const body: JsonObject = {};
  const preferredName = firstText(profile.preferredName);
  const mobile = firstText(profile.mobile);
  const familyId = firstText(profile.familyId);
  const familyRelationship = firstText(profile.familyRelationship);
  if (preferredName) body.preferred_name = preferredName;
  if (mobile) body.mobile = mobile;
  const numericFamilyId = Number(familyId);
  if (/^[1-9][0-9]{0,14}$/.test(familyId) && Number.isSafeInteger(numericFamilyId)) {
    body.family_id = numericFamilyId;
    if (familyRelationship) body.family_relationship = familyRelationship;
  }
  for (const [local, remote] of [["elvantoContact", "contact"], ["elvantoVolunteer", "volunteer"], ["elvantoArchived", "archived"]]) {
    if (typeof profile[local] === "boolean") body[remote] = profile[local] ? "Yes" : "No";
  }
  const fields: JsonObject = {};
  for (const [local, remote] of [["birthday", "birthday"], ["gender", "gender"], ["anniversary", "anniversary"], ["schoolGrade", "school_grade"], ["maritalStatus", "marital_status"], ["mailingAddress", "mailing_address"]]) {
    const value = firstText(profile[local]);
    if (value) fields[remote] = value;
  }
  for (const [local, remote] of [["developmentChild", "development_child"], ["specialNeedsChild", "special_needs_child"]]) {
    if (typeof profile[local] === "boolean") fields[remote] = profile[local] ? "Yes" : "No";
  }
  for (const key of ["departments", "serviceTypes", "demographics", "locations"] as const) {
    const remoteKey = { departments: "departments", serviceTypes: "service_types", demographics: "demographics", locations: "locations" }[key];
    const values = Array.isArray(profile[key]) ? profile[key].filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.trim()) : [];
    const remoteValue = remotePerson?.[remoteKey];
    const existing = new Set((Array.isArray(remoteValue) ? remoteValue : remoteValue === undefined || remoteValue === null || remoteValue === "" ? [] : [remoteValue]).map((value) => typeof value === "string" ? value.trim().toLocaleLowerCase() : value && typeof value === "object" ? firstText((value as JsonObject).name, (value as JsonObject).title).toLocaleLowerCase() : ""));
    const additions = [...new Set(values)].filter((value) => !existing.has(value.toLocaleLowerCase()));
    if (additions.length) fields[remoteKey] = additions;
  }
  const customFields = Array.isArray(profile.customFields) ? profile.customFields : [];
  for (const custom of customFields) {
    if (!custom || typeof custom !== "object") continue;
    const field = custom as JsonObject;
    const id = firstText(field.id);
    const value = field.value;
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) continue;
    if (typeof value === "string" && value.trim()) fields[id] = value.trim();
    else if (Array.isArray(value)) {
      const options = value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim());
      if (options.length) fields[id] = [...new Set(options)];
    }
  }
  if (Object.keys(fields).length) body.fields = fields;
  return body;
}
function elvantoGroupExportHash(group: { id: string; name: string; elvanto_source_id: string | null }, members: Array<{ contact_id: string; person_source_id: string | null; role: string; status: string }>) {
  const memberSnapshot = members.map((member) => [member.contact_id, member.person_source_id, member.role, member.status]).sort((left, right) => String(left[0]).localeCompare(String(right[0])));
  return createHash("sha256").update(JSON.stringify([group.id, group.name, memberSnapshot])).digest("hex");
}
function elvantoRemoteGroupHash(group: JsonObject) {
  return createHash("sha256").update(JSON.stringify([idOf(group), firstText(group.name), elvantoGroupPeople(group).map((person) => idOf(person)).filter(Boolean).sort()])).digest("hex");
}
function plainDescription(value: unknown) {
  if (typeof value !== "string") return "";
  return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">") .replace(/\s+/g, " ").trim();
}
function personIdOf(row: JsonObject) {
  const value = row.personId ?? row.person?.id ?? row.person_id ?? row.memberId ?? row.person?.personId ?? row.id;
  return value === undefined || value === null ? "" : String(value);
}
function membershipDate(...values: unknown[]) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const date = value.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
    if (!date) continue;
    const parsed = new Date(date + "T00:00:00Z");
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date) return date;
  }
  return null;
}
function groupMembershipSnapshot(member: JsonObject): JsonObject | null {
  const sourcePersonId = personIdOf(member);
  if (!sourcePersonId) return null;
  const role = firstText(member.groupMemberRole?.name, member.group_member_role?.name, member.groupRole?.name, member.group_role?.name, member.role?.name, member.membership?.role?.name, member.membership?.role, member.groupMembership?.role?.name, member.group_membership?.role, member.roleName, member.role_name, member.groupRole, member.group_role, member.role, member.groupMemberRole, member.group_member_role).slice(0, 80) || "Member";
  const rawStatus = firstText(member.groupMemberStatus?.name, member.group_member_status?.name, member.membershipStatus?.name, member.membership_status?.name, member.status?.name, member.membership?.status?.name, member.membership?.status, member.groupMembership?.status?.name, member.group_membership?.status, member.statusName, member.status_name, member.groupMemberStatus, member.group_member_status, member.status);
  const statusText = rawStatus.toLocaleLowerCase();
  const status = /wait|warteliste/.test(statusText) ? "waitlist" : /pause|inactive|passiv|ruhend/.test(statusText) ? "paused" : "active";
  const joinedOn = membershipDate(member.joinedOn, member.joined_on, member.startDate, member.start_date, member.entryDate, member.entry_date, member.dateOfEntry, member.membership?.startDate, member.membership?.start_date, member.groupMembership?.startDate, member.group_membership?.start_date);
  return { sourcePersonId, role, status, ...(joinedOn ? { joinedOn } : {}) };
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
async function listComplete(base: string, token: string, endpoint: string) {
  const items: JsonObject[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const payload = await get(base, token, endpoint + (endpoint.includes("?") ? "&" : "?") + "limit=200&page=" + page);
    const entries = rows(payload); items.push(...entries);
    const meta = payload.meta?.pagination ?? payload.meta ?? payload.data?.meta?.pagination ?? {};
    const last = Number(meta.lastPage ?? meta.last_page ?? meta.totalPages ?? 0);
    if ((last && page >= last) || entries.length < 200) return { items, complete: true };
  }
  return { items, complete: false };
}
async function testLogin(base: string, token: string) {
  if (!token.trim()) throw new Error("Enter a ChurchTools login token.");
  await get(base, token.trim(), "whoami");
}
function mapEvents(events: JsonObject[], timeZone = "Europe/Zurich") {
  return events.flatMap((row) => {
    const sourceId = idOf(row);
    const start = parseChurchToolsEventDateTime(row.startDate ?? row.start ?? row.startDateTime ?? row.date, row.date, row.startTime, timeZone);
    if (!sourceId || !start) return [];
    const end = parseChurchToolsEventDateTime(row.endDate ?? row.end ?? row.endDateTime, start.date, row.endTime, timeZone);
    const assignments: JsonObject[] = Array.isArray(row.services) ? row.services : Array.isArray(row.eventServices) ? row.eventServices : [];
    const agenda: JsonObject[] = Array.isArray(row.agenda?.items) ? row.agenda.items : Array.isArray(row.agendaItems) ? row.agendaItems : [];
    return [{
      sourceId, title: firstText(row.name, row.title, row.subject) || "ChurchTools service",
      date: start.date, isAllDay: row.isAllDay === true || row.allDay === true || row.is_all_day === true, start: row.isAllDay === true || row.allDay === true || row.is_all_day === true ? "00:00" : start.time, end: row.isAllDay === true || row.allDay === true || row.is_all_day === true ? null : end?.date === start.date && end.time > start.time ? end.time : null,
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
  registerChurchToolsSyncReplication(deps);
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
      const result = await pool!.query<ElvantoSettings>("SELECT department_id,encrypted_api_key,directions,financial_enabled,enabled,last_connected_at,last_sync_at,last_sync_error,people_import_page,people_import_total,people_import_created_count,people_import_updated_count,people_import_skipped_count,people_import_complete,people_preview_at,people_preview_scanned_count,people_preview_total,people_preview_complete,people_importing,people_import_started_at,groups_import_page,groups_import_total,groups_import_created_count,groups_import_updated_count,groups_import_skipped_count,groups_import_complete,groups_preview_at,groups_preview_scanned_count,groups_preview_total,groups_preview_complete,groups_importing,groups_import_started_at,services_import_page,services_import_total,services_import_created_count,services_import_updated_count,services_import_skipped_count,services_import_complete,services_preview_at,services_preview_scanned_count,services_preview_total,services_preview_complete,services_importing,services_import_started_at,calendar_import_page,calendar_import_total,calendar_import_created_count,calendar_import_updated_count,calendar_import_skipped_count,calendar_import_complete,calendar_preview_at,calendar_preview_scanned_count,calendar_preview_total,calendar_preview_complete,calendar_preview_start_date::text,calendar_preview_end_date::text,calendar_import_start_date::text,calendar_import_end_date::text,calendar_importing,calendar_import_started_at,calendar_export_calendar_id,calendar_export_organizer_id,calendar_export_preview_at,calendar_export_preview_rows,calendar_export_page,calendar_export_created_count,calendar_export_updated_count,calendar_export_skipped_count,calendar_export_complete,songs_import_page,songs_import_total,songs_import_created_count,songs_import_updated_count,songs_import_skipped_count,songs_import_complete,songs_preview_at,songs_preview_ids,songs_preview_complete,songs_preview_count,songs_imported_count,songs_last_import_at,songs_importing,songs_import_started_at,people_flows_import_page,people_flows_import_total,people_flows_import_created_count,people_flows_import_updated_count,people_flows_import_skipped_count,people_flows_import_complete,people_flows_preview_at,people_flows_preview_ids,people_flows_preview_complete,people_flows_preview_count,people_flows_imported_count,people_flows_last_import_at,people_flows_importing,people_flows_import_started_at,updated_at FROM elvanto_sync_settings WHERE department_id=$1", [departmentId]);
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
        const departmentProfile = await pool!.query<{ time_zone: string }>("SELECT time_zone FROM departments WHERE id=$1", [departmentId]);
        const services = mapEvents(events, departmentProfile.rows[0]?.time_zone ?? "Europe/Zurich");
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
            const data = [departmentId, event.title.slice(0, 160), event.date, event.isAllDay ?? false, event.start, event.end, event.location.slice(0, 160), event.description, event.room.slice(0, 160), JSON.stringify(positions), JSON.stringify(event.timePlan), event.sourceId];
            if (found.rowCount) {
              await db.query("UPDATE service_events SET title=$3,kind='service',event_date=$4,is_all_day=$5,start_time=$6,end_time=$7,location=$8,description=$9,room=$10,positions=$11::jsonb,time_plan=$12::jsonb,updated_at=now() WHERE id=$1 AND department_id=$2", [found.rows[0].id, departmentId, ...data.slice(1, 11)]);
            } else {
              const matching = await db.query<{ id: string }>("SELECT id FROM service_events WHERE department_id=$1 AND source_system IS NULL AND lower(title)=lower($2) AND event_date=$3 AND start_time=$4 ORDER BY created_at LIMIT 1 FOR UPDATE", [departmentId, event.title.slice(0, 160), event.date, event.start]);
              if (matching.rowCount) await db.query("UPDATE service_events SET title=$3,kind='service',event_date=$4,is_all_day=$5,start_time=$6,end_time=$7,location=$8,description=$9,room=$10,positions=$11::jsonb,time_plan=$12::jsonb,source_system='churchtools',source_id=$13,updated_at=now() WHERE id=$1 AND department_id=$2", [matching.rows[0].id, departmentId, ...data.slice(1)]);
              else await db.query("INSERT INTO service_events (id,department_id,title,kind,event_date,is_all_day,start_time,end_time,location,description,room,positions,time_plan,source_system,source_id) VALUES (gen_random_uuid(),$1,$2,'service',$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,'churchtools',$12)", data);
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

    routes.post<{ Body: { startDate: string; endDate: string } }>("/api/modules/sync/churchtools/migration-preview", { schema: { body: { type: "object", additionalProperties: false, required: ["startDate", "endDate"], properties: { startDate: { type: "string", format: "date" }, endDate: { type: "string", format: "date" } } } } }, async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      if (running.has(dept)) return reply.code(409).send({ error: "Wait for the scheduled ChurchTools sync to finish before previewing a migration." });
      const config = await settings(dept); if (!config) return reply.code(404).send({ error: "Configure ChurchTools before preparing a migration." });
      if (request.body.startDate > request.body.endDate) return reply.code(400).send({ error: "The migration start date must be on or before its end date." });
      running.add(dept);
      try {
        const token = decrypt(config.encrypted_login_token);
        const [peopleResult, groupsResult, resourcesResult, eventsResult] = await Promise.all([
          listComplete(config.instance_url, token, "persons"), listComplete(config.instance_url, token, "groups"), listComplete(config.instance_url, token, "resources"),
          listComplete(config.instance_url, token, `events?from=${encodeURIComponent(request.body.startDate)}&to=${encodeURIComponent(request.body.endDate)}`),
        ]);
        if (![peopleResult, groupsResult, resourcesResult, eventsResult].every((result) => result.complete)) return reply.code(413).send({ error: "At least one ChurchTools list exceeds the complete preview limit of 20,000 records. Narrow the migration date range and preview again." });
        const memberResults = await mapConcurrent(groupsResult.items, 8, async (group) => {
          const sourceId = idOf(group); if (!sourceId) return { sourceId, members: [] as JsonObject[], complete: true };
          const embedded = Array.isArray(group.members) ? group.members : Array.isArray(group.persons) ? group.persons : null;
          if (embedded) return { sourceId, members: embedded as JsonObject[], complete: true };
          const result = await listComplete(config.instance_url, token, `groups/${encodeURIComponent(sourceId)}/members`);
          return { sourceId, members: result.items, complete: result.complete };
        });
        if (memberResults.some((result) => !result.complete)) return reply.code(413).send({ error: "At least one ChurchTools group has more than 20,000 members. No migration preview was saved." });
        const membersByGroup = new Map(memberResults.map((result) => [result.sourceId, result.members]));
        const departmentProfile = await pool!.query<{ time_zone: string }>("SELECT time_zone FROM departments WHERE id=$1", [dept]);
        const mappedEvents = mapEvents(eventsResult.items, departmentProfile.rows[0]?.time_zone ?? "Europe/Zurich");
        const resourceRows = resourcesResult.items.map((resource) => {
          const capacityValue = Number(resource.capacity ?? resource.maxPersons ?? resource.max_persons);
          const approvalValue = resource.requiresApproval ?? resource.requires_approval ?? resource.approvalRequired ?? resource.mustBeConfirmed;
          return { sourceId: idOf(resource), name: firstText(resource.name, resource.title, resource.resourceName).slice(0, 120), category: resourceCategory(resource), description: firstText(resource.description, resource.note, resource.information).slice(0, 1000), location: firstText(resource.location?.name, resource.location, resource.place?.name, resource.place).slice(0, 160), capacity: Number.isInteger(capacityValue) && capacityValue > 0 && capacityValue <= 10000 ? capacityValue : null, requiresApproval: approvalValue === true || approvalValue === 1 || approvalValue === "1", active: resource.active !== false && resource.archived !== true && resource.isArchived !== true };
        });
        const records: JsonObject[] = [
          ...peopleResult.items.map((person) => ({ area: "person", sourceId: idOf(person), firstName: firstText(person.firstName, person.first_name, person.firstname, person.givenName), lastName: firstText(person.lastName, person.last_name, person.lastname, person.familyName), email: firstText(person.email, person.emailAddress) || null, phone: firstText(person.mobile, person.phonePrivate, person.phoneWork, person.phone) || null, unmappedFields: Object.keys(person).filter((key) => !["id", "firstName", "first_name", "firstname", "givenName", "lastName", "last_name", "lastname", "familyName", "email", "emailAddress", "mobile", "phonePrivate", "phoneWork", "phone"].includes(key)) })),
          ...groupsResult.items.map((group) => {
            const memberDetails = (membersByGroup.get(idOf(group)) ?? []).map(groupMembershipSnapshot).filter((item): item is JsonObject => item !== null);
            return { area: "group", sourceId: idOf(group), name: firstText(group.name, group.title).slice(0, 120), description: firstText(group.description, group.information, group.note).slice(0, 1000), memberSourceIds: memberDetails.map((member) => member.sourcePersonId), memberDetails };
          }),
          ...mappedEvents.map((event) => ({ area: "event", ...event })),
          ...resourceRows.map((resource) => ({ area: "resource", ...resource })),
        ];
        const [localPeople, localGroups, localEvents, localResources, migrationLinks] = await Promise.all([
          pool!.query<{ source_id: string | null; source_system: string | null; email: string | null }>("SELECT source_id,source_system,email FROM contacts WHERE department_id=$1", [dept]),
          pool!.query<{ source_id: string | null; source_system: string | null; name: string }>("SELECT source_id,source_system,name FROM church_groups WHERE department_id=$1", [dept]),
          pool!.query<{ source_id: string | null; source_system: string | null; title: string; event_date: string; start_time: string }>("SELECT source_id,source_system,title,event_date::text,to_char(start_time,'HH24:MI') AS start_time FROM service_events WHERE department_id=$1", [dept]),
          pool!.query<{ source_id: string | null; source_system: string | null; name: string }>("SELECT source_id,source_system,name FROM bookable_resources WHERE department_id=$1", [dept]),
          pool!.query<{ area: string; source_id: string }>("SELECT area,source_id FROM churchtools_migration_links WHERE department_id=$1", [dept]),
        ]);
        const emailSet = new Set(localPeople.rows.filter((row) => row.email).map((row) => row.email!.toLocaleLowerCase()));
        const linkSet = (area: string, rowsWithSources: Array<{ source_id: string | null; source_system: string | null }>) => new Set([...migrationLinks.rows.filter((link) => link.area === area).map((link) => link.source_id), ...rowsWithSources.filter((row) => row.source_system === "churchtools" && row.source_id).map((row) => row.source_id!)]);
        const linkedPeople = linkSet("person", localPeople.rows);
        const groupsBySource = linkSet("group", localGroups.rows);
        const groupsByName = new Set(localGroups.rows.filter((row) => !row.source_system).map((row) => row.name.toLocaleLowerCase()));
        const eventsBySource = linkSet("event", localEvents.rows);
        const eventNames = new Set(localEvents.rows.map((row) => `${row.event_date}|${row.title.toLocaleLowerCase()}|${row.start_time.slice(0, 5)}`));
        const resourcesBySource = linkSet("resource", localResources.rows);
        const resourcesByName = new Set(localResources.rows.filter((row) => !row.source_system).map((row) => row.name.toLocaleLowerCase()));
        let create = 0; let update = 0; let review = 0; let invalid = 0; let unmappedFields = 0;
        for (const record of records) {
          unmappedFields += Array.isArray(record.unmappedFields) ? record.unmappedFields.length : 0;
          if (!record.sourceId
            || (record.area === "person" && ((!record.firstName && !record.lastName) || String(record.firstName ?? "ChurchTools").length > 80 || String(record.lastName ?? `Person ${record.sourceId}`).length > 80 || String(record.email ?? "").length > 254 || String(record.phone ?? "").length > 40))
            || (record.area === "group" && (!record.name || String(record.name).trim().length > 120 || String(record.description ?? "").length > 1000))
            || (record.area === "event" && (!record.title || !record.date || !record.start))
            || (record.area === "resource" && (!record.name || String(record.name).trim().length > 120))) { record.action = "invalid"; invalid += 1; continue; }
          if (record.area === "person") {
            if (linkedPeople.has(String(record.sourceId))) { record.action = "update"; update += 1; }
            else if (record.email && emailSet.has(String(record.email).toLocaleLowerCase())) { record.action = "review_email_conflict"; review += 1; }
            else { record.action = "create"; create += 1; }
          } else if (record.area === "group") {
            if (groupsBySource.has(String(record.sourceId))) { record.action = "update"; update += 1; }
            else if (groupsByName.has(String(record.name).toLocaleLowerCase())) { record.action = "review_name_conflict"; review += 1; }
            else { record.action = "create"; create += 1; }
          } else if (record.area === "event") {
            if (eventsBySource.has(String(record.sourceId))) { record.action = "update"; update += 1; }
            else if (eventNames.has(`${record.date}|${String(record.title).toLocaleLowerCase()}|${record.start}`)) { record.action = "review_event_conflict"; review += 1; }
            else { record.action = "create"; create += 1; }
          } else if (record.area === "resource") {
            if (resourcesBySource.has(String(record.sourceId))) { record.action = "update"; update += 1; }
            else if (resourcesByName.has(String(record.name).toLocaleLowerCase())) { record.action = "review_name_conflict"; review += 1; }
            else { record.action = "create"; create += 1; }
          }
        }
        const encryptedSnapshot = encrypt(JSON.stringify(records));
        await pool!.query(`INSERT INTO churchtools_migration_snapshots (department_id,encrypted_snapshot,start_date,end_date,preview_at,page,total,created_count,updated_count,skipped_count,complete,updated_at)
          VALUES ($1,$2,$3,$4,now(),0,$5,0,0,0,FALSE,now()) ON CONFLICT (department_id) DO UPDATE SET encrypted_snapshot=EXCLUDED.encrypted_snapshot,start_date=EXCLUDED.start_date,end_date=EXCLUDED.end_date,preview_at=now(),page=0,total=EXCLUDED.total,created_count=0,updated_count=0,skipped_count=0,failed_count=0,failed_records='[]'::jsonb,complete=FALSE,updated_at=now()`, [dept, encryptedSnapshot, request.body.startDate, request.body.endDate, records.length]);
        return { complete: true, total: records.length, create, update, review, invalid, unmappedFields, startDate: request.body.startDate, endDate: request.body.endDate, sample: records.slice(0, 40).map((record) => ({ area: record.area, name: record.area === "person" ? `${record.firstName} ${record.lastName}`.trim() : record.name ?? record.title, email: record.email, date: record.date, action: record.action })) };
      } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Could not prepare the ChurchTools migration preview." }); }
      finally { running.delete(dept); }
    });
    routes.post<{ Body?: { restart?: boolean } }>("/api/modules/sync/churchtools/migration", async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      if (running.has(dept)) return reply.code(409).send({ error: "Another ChurchTools operation is running for this location." });
      const snapshotResult = await pool!.query<{ encrypted_snapshot: string; preview_at: Date | string; page: number; total: number; created_count: number; updated_count: number; skipped_count: number; failed_count: number; failed_records: Array<{ area: string; sourceId: string }>; complete: boolean }>("SELECT encrypted_snapshot,preview_at,page,total,created_count,updated_count,skipped_count,failed_count,failed_records,complete FROM churchtools_migration_snapshots WHERE department_id=$1", [dept]);
      const saved = snapshotResult.rows[0]; if (!saved) return reply.code(409).send({ error: "Run a complete ChurchTools migration preview before importing." });
      const pageBefore = request.body?.restart ? 0 : saved.page;
      if (!request.body?.restart && pageBefore === 0 && Date.now() - new Date(saved.preview_at).getTime() > 60 * 60 * 1000) return reply.code(409).send({ error: "The migration preview expired. Create a fresh preview before importing." });
      let snapshot: JsonObject[];
      try { snapshot = JSON.parse(decrypt(saved.encrypted_snapshot)) as JsonObject[]; } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "The saved migration preview cannot be decrypted." }); }
      if (!Array.isArray(snapshot) || snapshot.length !== saved.total) return reply.code(409).send({ error: "The saved migration preview is incomplete. Create a new preview." });
      running.add(dept); let reserved = false;
      try {
        const reservation = await pool!.query(`UPDATE churchtools_migration_snapshots SET migration_running=TRUE,migration_started_at=now(),updated_at=now()
          WHERE department_id=$1 AND (migration_running=FALSE OR migration_started_at < now()-interval '15 minutes') RETURNING department_id`, [dept]);
        if (!reservation.rowCount) return reply.code(409).send({ error: "Another migration batch is already running for this location." });
        reserved = true;
        let page = pageBefore; let created = request.body?.restart ? 0 : saved.created_count; let updated = request.body?.restart ? 0 : saved.updated_count; let skipped = request.body?.restart ? 0 : saved.skipped_count; let failed = request.body?.restart ? 0 : saved.failed_count; const failures = request.body?.restart ? [] : saved.failed_records;
        if (request.body?.restart) await pool!.query("UPDATE churchtools_migration_snapshots SET page=0,created_count=0,updated_count=0,skipped_count=0,failed_count=0,failed_records='[]'::jsonb,complete=FALSE,updated_at=now() WHERE department_id=$1", [dept]);
        const batch = snapshot.slice(page, page + 50); let batchCreated = 0; let batchUpdated = 0; let batchSkipped = 0; let batchFailed = 0; const batchFailures: Array<{ area: string; sourceId: string }> = [];
        const db = await pool!.connect();
        try {
          await db.query("BEGIN");
          for (const record of batch) {
            const sourceId = String(record.sourceId ?? ""); const action = String(record.action ?? "invalid");
            const countersBefore = { created: batchCreated, updated: batchUpdated, skipped: batchSkipped };
            await db.query("SAVEPOINT migration_record");
            try {
            if (!sourceId || action.startsWith("review_") || action === "invalid") { batchSkipped += 1; page += 1; continue; }
            if (record.area === "person") {
              let linked = await db.query<{ id: string }>("SELECT link.local_record_id::text AS id FROM churchtools_migration_links link JOIN contacts local ON local.id=link.local_record_id AND local.department_id=link.department_id WHERE link.department_id=$1 AND link.area='person' AND link.source_id=$2", [dept, sourceId]);
              if (!linked.rowCount) linked = await db.query<{ id: string }>("SELECT id FROM contacts WHERE department_id=$1 AND source_system='churchtools' AND source_id=$2 FOR UPDATE", [dept, sourceId]);
              if (!linked.rowCount && record.email) {
                const collision = await db.query("SELECT 1 FROM contacts WHERE department_id=$1 AND lower(email)=lower($2) LIMIT 1", [dept, record.email]);
                if (collision.rowCount) { batchSkipped += 1; page += 1; continue; }
              }
              if (linked.rowCount) {
                await db.query("UPDATE contacts SET first_name=$3,last_name=$4,email=$5,phone=$6,status='member',updated_at=now() WHERE id=$1 AND department_id=$2", [linked.rows[0].id, dept, record.firstName || "ChurchTools", record.lastName || `Person ${sourceId}`, record.email, record.phone]);
                await db.query("INSERT INTO churchtools_migration_links (department_id,area,source_id,local_record_id) VALUES ($1,'person',$2,$3) ON CONFLICT (department_id,area,source_id) DO UPDATE SET local_record_id=EXCLUDED.local_record_id", [dept, sourceId, linked.rows[0].id]);
                batchUpdated += 1;
              } else {
                const inserted = await db.query<{ id: string }>("INSERT INTO contacts (id,department_id,first_name,last_name,email,phone,status) VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,'member') ON CONFLICT DO NOTHING RETURNING id", [dept, record.firstName || "ChurchTools", record.lastName || `Person ${sourceId}`, record.email, record.phone]);
                if (inserted.rowCount) { await db.query("INSERT INTO churchtools_migration_links (department_id,area,source_id,local_record_id) VALUES ($1,'person',$2,$3) ON CONFLICT (department_id,area,source_id) DO UPDATE SET local_record_id=EXCLUDED.local_record_id", [dept, sourceId, inserted.rows[0].id]); batchCreated += 1; } else batchSkipped += 1;
              }
            } else if (record.area === "group") {
              let linked = await db.query<{ id: string }>("SELECT link.local_record_id::text AS id FROM churchtools_migration_links link JOIN church_groups local ON local.id=link.local_record_id AND local.department_id=link.department_id WHERE link.department_id=$1 AND link.area='group' AND link.source_id=$2", [dept, sourceId]);
              if (!linked.rowCount) linked = await db.query<{ id: string }>("SELECT id FROM church_groups WHERE department_id=$1 AND source_system='churchtools' AND source_id=$2 FOR UPDATE", [dept, sourceId]);
              if (!linked.rowCount) {
                const collision = await db.query("SELECT 1 FROM church_groups WHERE department_id=$1 AND lower(name)=lower($2) LIMIT 1", [dept, record.name]);
                if (collision.rowCount) { batchSkipped += 1; page += 1; continue; }
                linked = await db.query<{ id: string }>("INSERT INTO church_groups (id,department_id,name,description) VALUES (gen_random_uuid(),$1,$2,$3) ON CONFLICT DO NOTHING RETURNING id", [dept, record.name, record.description ?? ""]);
                if (!linked.rowCount) { batchSkipped += 1; page += 1; continue; }
                await db.query("INSERT INTO churchtools_migration_links (department_id,area,source_id,local_record_id) VALUES ($1,'group',$2,$3) ON CONFLICT (department_id,area,source_id) DO UPDATE SET local_record_id=EXCLUDED.local_record_id", [dept, sourceId, linked.rows[0].id]); batchCreated += 1;
              } else {
                await db.query("UPDATE church_groups SET name=$3,description=$4,updated_at=now() WHERE id=$1 AND department_id=$2", [linked.rows[0].id, dept, record.name, record.description ?? ""]);
                await db.query("INSERT INTO churchtools_migration_links (department_id,area,source_id,local_record_id) VALUES ($1,'group',$2,$3) ON CONFLICT (department_id,area,source_id) DO UPDATE SET local_record_id=EXCLUDED.local_record_id", [dept, sourceId, linked.rows[0].id]); batchUpdated += 1;
              }
              const memberDetails = Array.isArray(record.memberDetails) ? record.memberDetails.filter((item: unknown): item is JsonObject => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
              if (memberDetails.length) {
                await db.query(`INSERT INTO group_members (group_id,contact_id,role,status,joined_on)
                  SELECT $1,COALESCE(link.local_record_id,c.id),left(COALESCE(NULLIF(trim(member.role),''),'Member'),80),
                    CASE WHEN member.status IN ('paused','waitlist') THEN member.status ELSE 'active' END,member."joinedOn"
                  FROM jsonb_to_recordset($3::jsonb) AS member("sourcePersonId" text,role text,status text,"joinedOn" date)
                  LEFT JOIN churchtools_migration_links link ON link.department_id=$2 AND link.area='person' AND link.source_id=member."sourcePersonId"
                  LEFT JOIN contacts c ON c.department_id=$2 AND c.source_system='churchtools' AND c.source_id=member."sourcePersonId"
                  WHERE member."sourcePersonId" IS NOT NULL AND member."sourcePersonId"<>'' AND COALESCE(link.local_record_id,c.id) IS NOT NULL
                  ON CONFLICT (group_id,contact_id) DO NOTHING`, [linked.rows[0].id, dept, JSON.stringify(memberDetails)]);
              } else {
                const memberSourceIds = Array.isArray(record.memberSourceIds) ? record.memberSourceIds.map(String).filter(Boolean) : [];
                if (memberSourceIds.length) await db.query(`INSERT INTO group_members (group_id,contact_id)
                  SELECT $1,COALESCE(link.local_record_id,c.id) FROM unnest($3::text[]) AS source(source_id)
                  LEFT JOIN churchtools_migration_links link ON link.department_id=$2 AND link.area='person' AND link.source_id=source.source_id
                  LEFT JOIN contacts c ON c.department_id=$2 AND c.source_system='churchtools' AND c.source_id=source.source_id
                  WHERE COALESCE(link.local_record_id,c.id) IS NOT NULL
                  ON CONFLICT (group_id,contact_id) DO NOTHING`, [linked.rows[0].id, dept, memberSourceIds]);
              }
            } else if (record.area === "event") {
              let linked = await db.query<{ id: string }>("SELECT link.local_record_id::text AS id FROM churchtools_migration_links link JOIN service_events local ON local.id=link.local_record_id AND local.department_id=link.department_id WHERE link.department_id=$1 AND link.area='event' AND link.source_id=$2", [dept, sourceId]);
              if (!linked.rowCount) linked = await db.query<{ id: string }>("SELECT id FROM service_events WHERE department_id=$1 AND source_system='churchtools' AND source_id=$2 FOR UPDATE", [dept, sourceId]);
              if (!linked.rowCount) {
                const collision = await db.query("SELECT 1 FROM service_events WHERE department_id=$1 AND lower(title)=lower($2) AND event_date=$3 AND start_time=$4 LIMIT 1", [dept, record.title, record.date, record.start]);
                if (collision.rowCount) { batchSkipped += 1; page += 1; continue; }
              }
              const sourcePositions = Array.isArray(record.positions) ? record.positions as JsonObject[] : [];
              const sourcePersonIds = [...new Set(sourcePositions.map((position) => String(position.personId ?? "")).filter(Boolean))];
              const linkedPositionContacts = sourcePersonIds.length ? await db.query<{ source_id: string; id: string }>(`SELECT source_id,local_record_id::text AS id FROM churchtools_migration_links WHERE department_id=$1 AND area='person' AND source_id=ANY($2::text[])
                UNION SELECT source_id,id::text FROM contacts WHERE department_id=$1 AND source_system='churchtools' AND source_id=ANY($2::text[])`, [dept, sourcePersonIds]) : { rows: [] as Array<{ source_id: string; id: string }> };
              const contactsBySource = new Map(linkedPositionContacts.rows.map((contact) => [contact.source_id, contact.id]));
              const positions = sourcePositions.map((position) => ({ name: position.name, ...(position.personId && contactsBySource.has(String(position.personId)) ? { contactId: contactsBySource.get(String(position.personId)) } : {}) }));
              const values = [dept, record.title, record.date, record.isAllDay === true, record.start, record.end, record.location || "ChurchTools", record.description ?? null, record.room ?? "", JSON.stringify(positions), JSON.stringify(record.timePlan ?? []), sourceId];
              if (linked.rowCount) {
                await db.query("UPDATE service_events SET title=$3,kind='service',event_date=$4,is_all_day=$5,start_time=$6,end_time=$7,location=$8,description=$9,room=$10,positions=$11::jsonb,time_plan=$12::jsonb,updated_at=now() WHERE id=$1 AND department_id=$2", [linked.rows[0].id, ...values.slice(1, 11)]);
                await db.query("INSERT INTO churchtools_migration_links (department_id,area,source_id,local_record_id) VALUES ($1,'event',$2,$3) ON CONFLICT (department_id,area,source_id) DO UPDATE SET local_record_id=EXCLUDED.local_record_id", [dept, sourceId, linked.rows[0].id]);
                batchUpdated += 1;
              } else {
                const inserted = await db.query<{ id: string }>("INSERT INTO service_events (id,department_id,title,kind,event_date,is_all_day,start_time,end_time,location,description,room,positions,time_plan) VALUES (gen_random_uuid(),$1,$2,'service',$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb) ON CONFLICT DO NOTHING RETURNING id", values.slice(0, 11));
                if (inserted.rowCount) { await db.query("INSERT INTO churchtools_migration_links (department_id,area,source_id,local_record_id) VALUES ($1,'event',$2,$3) ON CONFLICT (department_id,area,source_id) DO UPDATE SET local_record_id=EXCLUDED.local_record_id", [dept, sourceId, inserted.rows[0].id]); batchCreated += 1; } else batchSkipped += 1;
              }
            } else if (record.area === "resource") {
              let linked = await db.query<{ id: string }>("SELECT link.local_record_id::text AS id FROM churchtools_migration_links link JOIN bookable_resources local ON local.id=link.local_record_id AND local.department_id=link.department_id WHERE link.department_id=$1 AND link.area='resource' AND link.source_id=$2", [dept, sourceId]);
              if (!linked.rowCount) linked = await db.query<{ id: string }>("SELECT id FROM bookable_resources WHERE department_id=$1 AND source_system='churchtools' AND source_id=$2 FOR UPDATE", [dept, sourceId]);
              if (!linked.rowCount) {
                const collision = await db.query("SELECT 1 FROM bookable_resources WHERE department_id=$1 AND lower(name)=lower($2) LIMIT 1", [dept, record.name]);
                if (collision.rowCount) { batchSkipped += 1; page += 1; continue; }
              }
              const values = [dept, record.name, record.category, record.description, record.location, record.capacity, record.requiresApproval, record.active, sourceId];
              if (linked.rowCount) {
                await db.query("UPDATE bookable_resources SET name=$3,category=$4,description=$5,location=$6,capacity=$7,requires_approval=$8,active=$9,updated_at=now() WHERE id=$1 AND department_id=$2", [linked.rows[0].id, ...values.slice(1, 8)]);
                await db.query("INSERT INTO churchtools_migration_links (department_id,area,source_id,local_record_id) VALUES ($1,'resource',$2,$3) ON CONFLICT (department_id,area,source_id) DO UPDATE SET local_record_id=EXCLUDED.local_record_id", [dept, sourceId, linked.rows[0].id]); batchUpdated += 1;
              } else {
                const inserted = await db.query<{ id: string }>("INSERT INTO bookable_resources (id,department_id,name,category,description,location,capacity,requires_approval,active) VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING id", values.slice(0, 8));
                if (inserted.rowCount) { await db.query("INSERT INTO churchtools_migration_links (department_id,area,source_id,local_record_id) VALUES ($1,'resource',$2,$3) ON CONFLICT (department_id,area,source_id) DO UPDATE SET local_record_id=EXCLUDED.local_record_id", [dept, sourceId, inserted.rows[0].id]); batchCreated += 1; } else batchSkipped += 1;
              }
            } else batchSkipped += 1;
            page += 1;
            } catch {
              await db.query("ROLLBACK TO SAVEPOINT migration_record");
              batchCreated = countersBefore.created; batchUpdated = countersBefore.updated; batchSkipped = countersBefore.skipped;
              batchFailed += 1; page += 1;
              batchFailures.push({ area: String(record.area ?? "unknown"), sourceId: sourceId.slice(0, 120) });
            } finally { await db.query("RELEASE SAVEPOINT migration_record"); }
          }
          created += batchCreated; updated += batchUpdated; skipped += batchSkipped; failed += batchFailed;
          const complete = page >= snapshot.length;
          const combinedFailures = [...failures, ...batchFailures].slice(-200);
          await db.query("UPDATE churchtools_migration_snapshots SET page=$2,created_count=$3,updated_count=$4,skipped_count=$5,failed_count=$6,failed_records=$7::jsonb,complete=$8,updated_at=now() WHERE department_id=$1", [dept, page, created, updated, skipped, failed, JSON.stringify(combinedFailures), complete]);
          await db.query("COMMIT");
          return { migration: { page, total: snapshot.length, created, updated, skipped, failed, failedRecords: combinedFailures, complete, processedThisBatch: batch.length } };
        } catch (error) { await db.query("ROLLBACK"); throw error; } finally { db.release(); }
      } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "The ChurchTools migration batch failed." }); }
      finally { if (reserved) await pool!.query("UPDATE churchtools_migration_snapshots SET migration_running=FALSE,migration_started_at=NULL,updated_at=now() WHERE department_id=$1", [dept]).catch(() => {}); running.delete(dept); }
    });
    routes.get("/api/modules/sync/churchtools", async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      const result = await pool!.query("SELECT s.instance_url,s.enabled,s.last_sync_at,s.last_sync_error,(SELECT count(*)::int FROM contacts c WHERE c.department_id=s.department_id AND c.source_system='churchtools') AS people_count,(SELECT count(*)::int FROM church_groups g WHERE g.department_id=s.department_id AND g.source_system='churchtools') AS group_count,(SELECT count(*)::int FROM service_events e WHERE e.department_id=s.department_id AND e.source_system='churchtools') AS service_count,(SELECT count(*)::int FROM bookable_resources r WHERE r.department_id=s.department_id AND r.source_system='churchtools') AS resource_count FROM churchtools_sync_settings s WHERE s.department_id=$1", [dept]);
      const row = result.rows[0];
      const migrationResult = await pool!.query<{ page: number; total: number; created_count: number; updated_count: number; skipped_count: number; failed_count: number; failed_records: Array<{ area: string; sourceId: string }>; complete: boolean; preview_at: Date | string; start_date: string; end_date: string }>("SELECT page,total,created_count,updated_count,skipped_count,failed_count,failed_records,complete,preview_at,start_date::text,end_date::text FROM churchtools_migration_snapshots WHERE department_id=$1", [dept]);
      const migration = migrationResult.rows[0];
      return row ? { configured: true, instanceUrl: row.instance_url, enabled: row.enabled, lastSyncAt: row.last_sync_at, lastSyncError: row.last_sync_error, peopleCount: row.people_count, groupCount: row.group_count, serviceCount: row.service_count, resourceCount: row.resource_count, migration: migration ? { page: migration.page, total: migration.total, created: migration.created_count, updated: migration.updated_count, skipped: migration.skipped_count, failed: migration.failed_count, failedRecords: migration.failed_records, complete: migration.complete, previewAt: migration.preview_at, startDate: migration.start_date, endDate: migration.end_date } : null } : { configured: false, enabled: false, peopleCount: 0, groupCount: 0, serviceCount: 0, resourceCount: 0, migration: migration ? { page: migration.page, total: migration.total, created: migration.created_count, updated: migration.updated_count, skipped: migration.skipped_count, failed: migration.failed_count, failedRecords: migration.failed_records, complete: migration.complete, previewAt: migration.preview_at, startDate: migration.start_date, endDate: migration.end_date } : null };
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
      const peopleExportState = await pool!.query<{ page: number; total: number; created: number; updated: number; skipped: number; complete: boolean; preview_at: Date | string | null }>("SELECT people_export_page AS page,jsonb_array_length(people_export_preview_rows)::int AS total,people_export_created_count AS created,people_export_updated_count AS updated,people_export_skipped_count AS skipped,people_export_complete AS complete,people_export_preview_at AS preview_at FROM elvanto_sync_settings WHERE department_id=$1", [dept]);
      const groupsExportState = await pool!.query<{ page: number; total: number; created: number; updated: number; added: number; skipped: number; complete: boolean; preview_at: Date | string | null }>("SELECT groups_export_page AS page,jsonb_array_length(groups_export_preview_rows)::int AS total,groups_export_created_count AS created,groups_export_updated_count AS updated,groups_export_added_members_count AS added,groups_export_skipped_count AS skipped,groups_export_complete AS complete,groups_export_preview_at AS preview_at FROM elvanto_sync_settings WHERE department_id=$1", [dept]);
      const calendarExportState = await pool!.query<{ page: number; total: number; created: number; updated: number; skipped: number; complete: boolean; preview_at: Date | string | null; calendar_id: string | null; organizer_id: string | null }>("SELECT calendar_export_page AS page,jsonb_array_length(calendar_export_preview_rows)::int AS total,calendar_export_created_count AS created,calendar_export_updated_count AS updated,calendar_export_skipped_count AS skipped,calendar_export_complete AS complete,calendar_export_preview_at AS preview_at,calendar_export_calendar_id AS calendar_id,calendar_export_organizer_id AS organizer_id FROM elvanto_sync_settings WHERE department_id=$1", [dept]);
      return { configured: Boolean(row), directions, financialEnabled: row?.financial_enabled ?? false, enabled: row?.enabled ?? false, lastConnectedAt: row?.last_connected_at ?? null, lastSyncAt: row?.last_sync_at ?? null, lastSyncError: row?.last_sync_error ?? null, peopleImport: row ? { page: row.people_import_page, total: row.people_import_total, created: row.people_import_created_count, updated: row.people_import_updated_count, skipped: row.people_import_skipped_count, complete: row.people_import_complete } : null, peopleExport: peopleExportState.rows[0] ? { page: peopleExportState.rows[0].page, total: peopleExportState.rows[0].total, created: peopleExportState.rows[0].created, updated: peopleExportState.rows[0].updated, skipped: peopleExportState.rows[0].skipped, complete: peopleExportState.rows[0].complete, previewAt: peopleExportState.rows[0].preview_at } : null, groupsExport: groupsExportState.rows[0] ? { page: groupsExportState.rows[0].page, total: groupsExportState.rows[0].total, created: groupsExportState.rows[0].created, updated: groupsExportState.rows[0].updated, addedMembers: groupsExportState.rows[0].added, skipped: groupsExportState.rows[0].skipped, complete: groupsExportState.rows[0].complete, previewAt: groupsExportState.rows[0].preview_at } : null, groupsImport: row ? { page: row.groups_import_page, total: row.groups_import_total, created: row.groups_import_created_count, updated: row.groups_import_updated_count, skipped: row.groups_import_skipped_count, complete: row.groups_import_complete } : null, servicesImport: row ? { page: row.services_import_page, total: row.services_import_total, created: row.services_import_created_count, updated: row.services_import_updated_count, skipped: row.services_import_skipped_count, complete: row.services_import_complete } : null, calendarImport: row ? { page: row.calendar_import_page, total: row.calendar_import_total, created: row.calendar_import_created_count, updated: row.calendar_import_updated_count, skipped: row.calendar_import_skipped_count, complete: row.calendar_import_complete, startDate: row.calendar_import_start_date, endDate: row.calendar_import_end_date } : null, calendarExport: calendarExportState.rows[0] ? { page: calendarExportState.rows[0].page, total: calendarExportState.rows[0].total, created: calendarExportState.rows[0].created, updated: calendarExportState.rows[0].updated, skipped: calendarExportState.rows[0].skipped, complete: calendarExportState.rows[0].complete, previewAt: calendarExportState.rows[0].preview_at, calendarId: calendarExportState.rows[0].calendar_id, organizerId: calendarExportState.rows[0].organizer_id } : null, peopleFlowsImport: row ? { page: row.people_flows_import_page, total: row.people_flows_import_total ?? row.people_flows_preview_count, created: row.people_flows_import_created_count, updated: row.people_flows_import_updated_count, skipped: row.people_flows_import_skipped_count, complete: row.people_flows_import_complete, previewComplete: row.people_flows_preview_complete, previewCount: row.people_flows_preview_count, importedCount: row.people_flows_imported_count, lastImportAt: row.people_flows_last_import_at } : null, peopleFlows: importedFlows.rows.map((flow) => ({ sourceId: flow.source_id, name: flow.name, steps: Array.isArray(flow.definition.steps) ? flow.definition.steps.length : 0, members: Array.isArray(flow.members) ? flow.members.length : 0, importedAt: flow.imported_at })), songsImport: row ? { page: row.songs_import_page, total: row.songs_import_total ?? row.songs_preview_count, created: row.songs_import_created_count, updated: row.songs_import_updated_count, skipped: row.songs_import_skipped_count, complete: row.songs_import_complete, previewComplete: row.songs_preview_complete, previewCount: row.songs_preview_count, importedCount: row.songs_imported_count, lastImportAt: row.songs_last_import_at } : null, songs: importedSongs.rows.map((song) => ({ sourceId: song.source_id, title: song.title, arrangements: Array.isArray(song.arrangements) ? song.arrangements.length : 0, importedAt: song.imported_at })), songsTotal: songCount.rows[0]?.count ?? 0, financialImport: financialState.rows[0] ? { page: financialState.rows[0].page, total: financialState.rows[0].total, created: financialState.rows[0].created, updated: financialState.rows[0].updated, skipped: financialState.rows[0].skipped, complete: financialState.rows[0].complete, previewComplete: financialState.rows[0].preview_complete, previewCount: financialState.rows[0].preview_count, startDate: financialState.rows[0].start_date, endDate: financialState.rows[0].end_date } : null };
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
        WHERE department_id=$1 AND updated_at=$2 AND people_importing=FALSE AND groups_importing=FALSE AND services_importing=FALSE AND calendar_importing=FALSE AND people_flows_importing=FALSE AND (songs_importing=FALSE OR songs_import_started_at < now()-interval '15 minutes') AND (financial_importing=FALSE OR financial_import_started_at < now()-interval '15 minutes') AND (people_exporting=FALSE OR people_export_started_at < now()-interval '15 minutes') RETURNING department_id`, [dept, row.updated_at]);
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
        const lock = await pool!.query(`UPDATE elvanto_sync_settings SET financial_importing=TRUE,financial_import_started_at=now(),updated_at=now() WHERE department_id=$1 AND updated_at=$2 AND financial_preview_complete=TRUE AND financial_preview_at > now()-interval '1 hour' AND financial_enabled=TRUE AND people_importing=FALSE AND groups_importing=FALSE AND services_importing=FALSE AND calendar_importing=FALSE AND people_flows_importing=FALSE AND (songs_importing=FALSE OR songs_import_started_at < now()-interval '15 minutes') AND (financial_importing=FALSE OR financial_import_started_at < now()-interval '15 minutes') AND (people_exporting=FALSE OR people_export_started_at < now()-interval '15 minutes') RETURNING department_id`, [dept, row.updated_at]);
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
        "UPDATE elvanto_sync_settings SET people_importing=FALSE,people_import_started_at=NULL,people_preview_at=NULL,people_preview_complete=FALSE,people_preview_scanned_count=0,people_preview_total=NULL WHERE department_id=$1 AND (people_importing=FALSE OR people_import_started_at < now()-interval '15 minutes') AND groups_importing=FALSE AND services_importing=FALSE AND calendar_importing=FALSE AND people_flows_importing=FALSE AND (songs_importing=FALSE OR songs_import_started_at < now()-interval '15 minutes') AND (financial_importing=FALSE OR financial_import_started_at < now()-interval '15 minutes') AND (people_exporting=FALSE OR people_export_started_at < now()-interval '15 minutes') RETURNING department_id",
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
      const existing = await pool!.query<{ id: string; source_system: string | null; source_id: string | null; elvanto_source_id: string | null; email: string | null; first_name: string; last_name: string }>(
        "SELECT id,source_system,source_id,elvanto_source_id,email,first_name,last_name FROM contacts WHERE department_id=$1",
        [dept],
      );
      const bySourceId = new Map(existing.rows.map((contact) => [contact.source_system === "elvanto" ? contact.source_id : contact.elvanto_source_id, contact] as const).filter((entry): entry is [string, typeof existing.rows[number]] => Boolean(entry[0])));
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
        "UPDATE elvanto_sync_settings SET people_preview_at=CASE WHEN $2 THEN now() ELSE NULL END,people_preview_complete=$2,people_preview_scanned_count=$3,people_preview_total=$4,people_preview_custom_fields=$6::jsonb WHERE department_id=$1 AND updated_at=$5 AND people_importing=FALSE AND groups_importing=FALSE AND services_importing=FALSE AND calendar_importing=FALSE AND people_flows_importing=FALSE AND (songs_importing=FALSE OR songs_import_started_at < now()-interval '15 minutes') AND (financial_importing=FALSE OR financial_import_started_at < now()-interval '15 minutes') AND (people_exporting=FALSE OR people_export_started_at < now()-interval '15 minutes') RETURNING department_id",
        [dept, previewComplete, people.length, total, row.updated_at, JSON.stringify(customFieldSnapshot.fields)],
      );
      if (!savedPreview.rowCount) return reply.code(409).send({ error: "Elvanto settings changed during the preview. Save the connection again and run a new preview." });
      return { scannedCount: people.length, reportedTotal: total, complete: previewComplete, customFieldCount: customFieldSnapshot.fields.length, createCount, alreadyLinkedCount, emailMatchCount, ambiguousEmailCount, invalidCount, sample };
    });
    routes.post("/api/modules/sync/elvanto/people-export-preview", async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      const row = await elvantoSettings(dept);
      if (!row) return reply.code(404).send({ error: "Connect Elvanto before previewing People export." });
      if (row.directions.people !== "smart_church_to_elvanto" && row.directions.people !== "bidirectional") return reply.code(400).send({ error: "Set People direction to Smart Church → Elvanto or bidirectional before previewing an export." });
      let apiKey: string;
      try { apiKey = decryptElvantoKey(row.encrypted_api_key); } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Reconnect Elvanto." }); }
      try {
        const customFieldSnapshot = await fetchElvantoPeopleCustomFields(apiKey);
        if (!customFieldSnapshot.complete) return reply.code(409).send({ error: "Elvanto returned an incomplete custom-field list. No People export preview was saved." });
        const profileFieldsHash = createHash("sha256").update(JSON.stringify(customFieldSnapshot.fields)).digest("hex");
        const remote = await fetchElvantoPagedRows(apiKey, "people/getAll", "people", "person", { fields: [...elvantoPeopleFields, ...customFieldSnapshot.fields.map((field) => `custom_${field.id}`)] });
        if (!remote.complete || remote.rows.length > 200000) return reply.code(409).send({ error: "Could not read the complete Elvanto People list. No export preview was saved." });
        const remoteById = new Map(remote.rows.map((person) => [idOf(person), person]));
        const remoteByEmail = new Map<string, JsonObject[]>();
        for (const person of remote.rows) {
          const email = firstText(person.email).toLocaleLowerCase();
          if (email) remoteByEmail.set(email, [...(remoteByEmail.get(email) ?? []), person]);
        }
        const local = await pool!.query<{ id: string; first_name: string; last_name: string; email: string | null; phone: string | null; elvanto_source_id: string | null; profile_data: JsonObject }>("SELECT id,first_name,last_name,email,phone,elvanto_source_id,profile_data FROM contacts WHERE department_id=$1 AND source_system IS NULL ORDER BY id", [dept]);
        if (local.rows.length > 200000) return reply.code(409).send({ error: "This location has more than 200,000 local contacts. Narrow the export scope before retrying." });
        const localEmailCounts = new Map<string, number>();
        for (const person of local.rows) if (person.email?.trim()) {
          const email = person.email.trim().toLocaleLowerCase(); localEmailCounts.set(email, (localEmailCounts.get(email) ?? 0) + 1);
        }
        const seenLocalEmails = new Set<string>();
        const exportRows = local.rows.map((person) => {
          const email = person.email?.trim().toLocaleLowerCase() ?? "";
          const matches = email ? remoteByEmail.get(email) ?? [] : [];
          let action: "create" | "update" | "review_email_match" | "review_ambiguous_email" | "review_duplicate_local_email" | "missing_remote";
          if (person.elvanto_source_id) action = remoteById.has(person.elvanto_source_id) ? "update" : "missing_remote";
          else if (email && (localEmailCounts.get(email) ?? 0) > 1 && seenLocalEmails.has(email)) action = "review_duplicate_local_email";
          else if (email && (localEmailCounts.get(email) ?? 0) > 1) action = "review_duplicate_local_email";
          else if (matches.length > 1) action = "review_ambiguous_email";
          else if (matches.length === 1) action = "review_email_match";
          else action = "create";
          if (email) seenLocalEmails.add(email);
          const linkedRemote = person.elvanto_source_id ? remoteById.get(person.elvanto_source_id) : undefined;
          const requestedCustomIds = new Set(customFieldSnapshot.fields.map((field) => field.id));
          const profile = person.profile_data ?? {};
          const customFieldRows = Array.isArray(profile.customFields) ? profile.customFields : [];
          const hasUnknownCustomField = customFieldRows.some((field) => !field || typeof field !== "object" || !requestedCustomIds.has(firstText((field as JsonObject).id)));
          if (hasUnknownCustomField && (action === "create" || action === "update")) action = "review_custom_field";
          const mappedProfile = elvantoPeopleProfileExport(profile);
          const profileFieldCount = Object.keys(mappedProfile).filter((key) => key !== "fields").length + Object.keys((mappedProfile.fields as JsonObject | undefined) ?? {}).length;
          const statusUpdates = Object.fromEntries(["contact", "volunteer", "archived"].filter((key) => mappedProfile[key] === "Yes" || mappedProfile[key] === "No").map((key) => [key, mappedProfile[key]]));
          return { contactId: person.id, sourceId: person.elvanto_source_id, hash: elvantoPeopleExportHash(person), remoteHash: linkedRemote ? elvantoRemotePersonHash(linkedRemote) : null, profileFieldsHash, action, firstName: person.first_name, lastName: person.last_name, email: person.email, profileFieldCount, statusUpdates };
        });
        const counts = { create: 0, update: 0, review: 0 };
        for (const item of exportRows) {
          if (item.action === "create") counts.create += 1;
          else if (item.action === "update") counts.update += 1;
          else counts.review += 1;
        }
        const saved = await pool!.query("UPDATE elvanto_sync_settings SET people_export_preview_at=now(),people_export_preview_rows=$2::jsonb,people_export_page=0,people_export_created_count=0,people_export_updated_count=0,people_export_skipped_count=0,people_export_complete=FALSE,updated_at=now() WHERE department_id=$1 AND updated_at=$3 AND people_importing=FALSE AND (people_exporting=FALSE OR people_export_started_at < now()-interval '15 minutes') AND groups_importing=FALSE AND services_importing=FALSE AND calendar_importing=FALSE AND people_flows_importing=FALSE AND (songs_importing=FALSE OR songs_import_started_at < now()-interval '15 minutes') AND (financial_importing=FALSE OR financial_import_started_at < now()-interval '15 minutes') AND (people_exporting=FALSE OR people_export_started_at < now()-interval '15 minutes') RETURNING department_id", [dept, JSON.stringify(exportRows.map(({ contactId, sourceId, hash, remoteHash, profileFieldsHash, action }) => ({ contactId, sourceId, hash, remoteHash, profileFieldsHash, action }))), row.updated_at]);
        if (!saved.rowCount) return reply.code(409).send({ error: "Another Elvanto import is running or the connection changed. Try the preview again." });
        return { complete: true, total: exportRows.length, ...counts, profileFieldCount: exportRows.reduce((total, person) => total + person.profileFieldCount, 0), sample: exportRows.slice(0, 50).map(({ firstName, lastName, email, action, profileFieldCount, statusUpdates }) => ({ firstName, lastName, email, action, profileFieldCount, statusUpdates })) };
      } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "People export preview failed." }); }
    });
    routes.post("/api/modules/sync/elvanto/people-export", async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      if (elvantoPeopleExportRunning.has(dept)) return reply.code(409).send({ error: "A People export is already running for this location." });
      const row = await elvantoSettings(dept);
      if (!row) return reply.code(404).send({ error: "Connect Elvanto before exporting People." });
      if (row.directions.people !== "smart_church_to_elvanto" && row.directions.people !== "bidirectional") return reply.code(400).send({ error: "Set People direction to Smart Church → Elvanto or bidirectional before exporting." });
      const state = await pool!.query<{ preview_at: string | null; rows: Array<{ contactId: string; sourceId: string | null; hash: string; remoteHash: string | null; profileFieldsHash?: string; action: string }>; page: number; created: number; updated: number; skipped: number }>("SELECT people_export_preview_at AS preview_at,people_export_preview_rows AS rows,people_export_page AS page,people_export_created_count AS created,people_export_updated_count AS updated,people_export_skipped_count AS skipped FROM elvanto_sync_settings WHERE department_id=$1", [dept]);
      const saved = state.rows[0]; const previewTime = saved?.preview_at ? new Date(saved.preview_at).getTime() : 0;
      if (!saved || !previewTime || Date.now() - previewTime > 60 * 60 * 1000 || !Array.isArray(saved.rows)) return reply.code(409).send({ error: "Run a complete People export preview first. Previews expire after one hour and after connection settings change." });
      let apiKey: string;
      try { apiKey = decryptElvantoKey(row.encrypted_api_key); } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Reconnect Elvanto." }); }
      elvantoPeopleExportRunning.add(dept); let reserved = false; let writeAttempted = false;
      try {
        const lock = await pool!.query("UPDATE elvanto_sync_settings SET people_exporting=TRUE,people_export_started_at=now(),updated_at=now() WHERE department_id=$1 AND updated_at=$2 AND people_export_preview_at > now()-interval '1 hour' AND people_importing=FALSE AND (people_exporting=FALSE OR people_export_started_at < now()-interval '15 minutes') AND groups_importing=FALSE AND services_importing=FALSE AND calendar_importing=FALSE AND people_flows_importing=FALSE AND (songs_importing=FALSE OR songs_import_started_at < now()-interval '15 minutes') AND (financial_importing=FALSE OR financial_import_started_at < now()-interval '15 minutes') AND (people_exporting=FALSE OR people_export_started_at < now()-interval '15 minutes') RETURNING department_id", [dept, row.updated_at]);
        if (!lock.rowCount) return reply.code(409).send({ error: "The preview expired, settings changed, or another import is running. Run a new People export preview." });
        reserved = true;
        const customFieldSnapshot = await fetchElvantoPeopleCustomFields(apiKey);
        const profileFieldsHash = createHash("sha256").update(JSON.stringify(customFieldSnapshot.fields)).digest("hex");
        if (!customFieldSnapshot.complete || recordsHaveStaleFieldMap(saved.rows, profileFieldsHash)) {
          await pool!.query("UPDATE elvanto_sync_settings SET people_export_preview_at=NULL,people_export_complete=FALSE,people_export_preview_rows='[]'::jsonb,updated_at=now() WHERE department_id=$1", [dept]);
          return reply.code(409).send({ error: "Elvanto custom fields changed after preview. Run a fresh People export preview before writing." });
        }
        let index = saved.page; let created = saved.created; let updated = saved.updated; let skipped = saved.skipped; let writes = 0; let processed = 0;
        const records = saved.rows;
        while (index < records.length && writes < 5 && processed < 100) {
          const item = records[index];
          if (item.action !== "create" && item.action !== "update") {
            skipped += 1; index += 1;
            processed += 1;
            await pool!.query("UPDATE elvanto_sync_settings SET people_export_page=$2,people_export_skipped_count=$3,updated_at=now() WHERE department_id=$1", [dept, index, skipped]);
            continue;
          }
          const current = await pool!.query<{ id: string; first_name: string; last_name: string; email: string | null; phone: string | null; elvanto_source_id: string | null; profile_data: JsonObject }>("SELECT id,first_name,last_name,email,phone,elvanto_source_id,profile_data FROM contacts WHERE department_id=$1 AND id=$2 AND source_system IS NULL", [dept, item.contactId]);
          const contact = current.rows[0];
          if (!contact || elvantoPeopleExportHash(contact) !== item.hash || contact.elvanto_source_id !== item.sourceId) {
            await pool!.query("UPDATE elvanto_sync_settings SET people_export_preview_at=NULL,people_export_complete=FALSE,people_export_preview_rows='[]'::jsonb,updated_at=now() WHERE department_id=$1", [dept]);
            return reply.code(409).send({ error: "A local contact changed after preview. The export preview was invalidated; review a fresh preview before writing to Elvanto." });
          }
          let remotePerson: JsonObject | undefined;
          if (item.action === "update") {
            const remoteResult = await elvantoRequest(apiKey, "people/getInfo", { id: item.sourceId, fields: [...elvantoPeopleFields, ...customFieldSnapshot.fields.map((field) => `custom_${field.id}`)] });
            const remoteValue = remoteResult.person;
            remotePerson = Array.isArray(remoteValue) ? remoteValue[0] as JsonObject | undefined : remoteValue as JsonObject | undefined;
            if (!remotePerson || elvantoRemotePersonHash(remotePerson) !== item.remoteHash) {
              await pool!.query("UPDATE elvanto_sync_settings SET people_export_preview_at=NULL,people_export_complete=FALSE,people_export_preview_rows='[]'::jsonb,updated_at=now() WHERE department_id=$1", [dept]);
              return reply.code(409).send({ error: "The linked Elvanto contact changed after preview. The export preview was invalidated; review a fresh preview before writing." });
            }
          } else if (contact.email?.trim()) {
            const matches = await elvantoRequest(apiKey, "people/search", { search: { email: contact.email.trim() }, page: 1, page_size: 10 });
            if (elvantoCollection(matches, "people", "person").length) {
              await pool!.query("UPDATE elvanto_sync_settings SET people_export_preview_at=NULL,people_export_complete=FALSE,people_export_preview_rows='[]'::jsonb,updated_at=now() WHERE department_id=$1", [dept]);
              return reply.code(409).send({ error: "An Elvanto person now matches this email. The export preview was invalidated; review a fresh preview before writing." });
            }
          }
          const body: JsonObject = { firstname: contact.first_name, lastname: contact.last_name };
          if (item.action === "update") {
            body.email = contact.email ?? "";
            body.phone = contact.phone ?? "";
          } else {
            if (contact.email) body.email = contact.email;
            if (contact.phone) body.phone = contact.phone;
          }
          Object.assign(body, elvantoPeopleProfileExport(contact.profile_data, remotePerson));
          const fieldsSent = [
            ...Object.keys(body).filter((key) => key !== "fields"),
            ...Object.keys((body.fields as JsonObject | undefined) ?? {}).map((key) => `field:${key}`),
          ];
          let remoteId = item.sourceId;
          writeAttempted = true;
          const result = await elvantoRequest(apiKey, item.action === "create" ? "people/create" : "people/edit", { ...(item.action === "update" ? { id: item.sourceId } : {}), ...body });
          if (item.action === "create") remoteId = idOf((result.person ?? {}) as JsonObject);
          if (!remoteId) throw new Error("Elvanto accepted the request without returning a stable person ID. Run a new preview and review email matches before retrying.");
          const client = await pool!.connect();
          try {
            await client.query("BEGIN");
            if (item.action === "create") await client.query("UPDATE contacts SET elvanto_source_id=$3,updated_at=now() WHERE department_id=$1 AND id=$2 AND source_system IS NULL", [dept, item.contactId, remoteId]);
            await client.query(
              "INSERT INTO elvanto_people_export_audit (department_id,contact_id,source_person_id,operation,fields_sent,actor_user_id) VALUES ($1,$2,$3,$4,$5::jsonb,$6)",
              [dept, contact.id, remoteId, item.action, JSON.stringify(fieldsSent), request.authenticatedUser?.id ?? null],
            );
            index += 1; writes += 1; processed += 1;
            if (item.action === "create") created += 1; else updated += 1;
            const complete = index >= records.length;
            await client.query("UPDATE elvanto_sync_settings SET people_export_page=$2,people_export_created_count=$3,people_export_updated_count=$4,people_export_skipped_count=$5,people_export_complete=$6,last_sync_at=CASE WHEN $6 THEN now() ELSE last_sync_at END,last_sync_error=NULL,updated_at=now() WHERE department_id=$1", [dept, index, created, updated, skipped, complete]);
            await client.query("COMMIT");
            writeAttempted = false;
          } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
        }
        const complete = index >= records.length;
        await pool!.query("UPDATE elvanto_sync_settings SET people_export_complete=$2,updated_at=now() WHERE department_id=$1", [dept, complete]);
        return { peopleExport: { page: index, total: records.length, created, updated, skipped, complete } };
      } catch (error) {
        if (writeAttempted) await pool!.query("UPDATE elvanto_sync_settings SET people_export_preview_at=NULL,people_export_complete=FALSE,people_export_preview_rows='[]'::jsonb,updated_at=now() WHERE department_id=$1", [dept]).catch(() => {});
        await pool!.query("UPDATE elvanto_sync_settings SET last_sync_error=$2 WHERE department_id=$1", [dept, (error instanceof Error ? error.message : "People export failed.").slice(0, 1000)]).catch(() => {});
        return reply.code(400).send({ error: error instanceof Error ? error.message : "People export failed." });
      } finally {
        if (reserved) await pool!.query("UPDATE elvanto_sync_settings SET people_exporting=FALSE,people_export_started_at=NULL,updated_at=now() WHERE department_id=$1", [dept]).catch(() => {});
        elvantoPeopleExportRunning.delete(dept);
      }
    });
    routes.get("/api/modules/sync/elvanto/people-export-audit", async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      const result = await pool!.query<{ source_person_id: string; operation: string; fields_sent: string[]; actor_user_id: string | null; created_at: Date | string }>(
        "SELECT source_person_id,operation,fields_sent,actor_user_id,created_at FROM elvanto_people_export_audit WHERE department_id=$1 ORDER BY created_at DESC LIMIT 25",
        [dept],
      );
      return result.rows.map((row) => ({ sourcePersonId: row.source_person_id, operation: row.operation, fieldsSent: row.fields_sent, actorUserId: row.actor_user_id, createdAt: row.created_at }));
    });
    routes.post<{ Body?: { restart?: boolean } }>("/api/modules/sync/elvanto/people-import", async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      if (elvantoPeopleImportRunning.has(dept)) return reply.code(409).send({ error: "A People import is already running for this location." });
      const row = await elvantoSettings(dept);
      if (!row) return reply.code(404).send({ error: "Connect Elvanto before importing people." });
      if (row.directions.people === "off" || row.directions.people === "smart_church_to_elvanto") return reply.code(400).send({ error: "Set People direction to Elvanto → Smart Church or bidirectional before importing." });
      const previewTime = row.people_preview_at ? new Date(row.people_preview_at).getTime() : 0;
      if (!row.people_preview_complete || !previewTime || Date.now() - previewTime > 60 * 60 * 1000) return reply.code(409).send({ error: "Run a complete People import preview first. Previews expire after one hour and after connection settings change." });
      const savedFieldState = await pool!.query<{ fields: Array<{ id: string; name: string; type: string }> }>("SELECT people_preview_custom_fields AS fields FROM elvanto_sync_settings WHERE department_id=$1", [dept]);
      const previewCustomFields = Array.isArray(savedFieldState.rows[0]?.fields) ? savedFieldState.rows[0].fields : [];
      let apiKey: string;
      try { apiKey = decryptElvantoKey(row.encrypted_api_key); }
      catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Reconnect Elvanto." }); }
      elvantoPeopleImportRunning.add(dept);
      let reserved = false;
      try {
        const reservation = await pool!.query(
          "UPDATE elvanto_sync_settings SET people_importing=TRUE,people_import_started_at=now(),updated_at=now() WHERE department_id=$1 AND updated_at=$2 AND people_preview_complete=TRUE AND people_preview_at > now()-interval '1 hour' AND (people_importing=FALSE OR people_import_started_at < now()-interval '15 minutes') AND groups_importing=FALSE AND services_importing=FALSE AND calendar_importing=FALSE AND people_flows_importing=FALSE AND (songs_importing=FALSE OR songs_import_started_at < now()-interval '15 minutes') AND (financial_importing=FALSE OR financial_import_started_at < now()-interval '15 minutes') AND (people_exporting=FALSE OR people_export_started_at < now()-interval '15 minutes') RETURNING department_id",
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
        if (!customFieldSnapshot.complete || JSON.stringify(customFieldSnapshot.fields) !== JSON.stringify(previewCustomFields)) {
          await pool!.query("UPDATE elvanto_sync_settings SET people_preview_at=NULL,people_preview_complete=FALSE WHERE department_id=$1", [dept]);
          return reply.code(409).send({ error: "Elvanto custom-field definitions changed after preview. Run a fresh complete People preview." });
        }
        const requestedPeopleFields = [...elvantoPeopleFields, ...previewCustomFields.map((field) => `custom_${field.id}`)];
        for (let pageBatch = 0; pageBatch < 5 && !complete; pageBatch += 1) {
          const payload = await elvantoRequest(apiKey, "people/getAll", { page, page_size: 1000, fields: requestedPeopleFields });
          const people = elvantoCollection(payload, "people", "person");
          const reportedTotal = Number((payload.people as JsonObject | undefined)?.total);
          if (Number.isFinite(reportedTotal) && reportedTotal >= 0) total = reportedTotal;
          const contacts = await pool!.query<{ id: string; source_system: string | null; source_id: string | null; elvanto_source_id: string | null; email: string | null }>(
            "SELECT id,source_system,source_id,elvanto_source_id,email FROM contacts WHERE department_id=$1",
            [dept],
          );
          const linkedIds = new Set(contacts.rows.filter((contact) => contact.source_system === "elvanto" && contact.source_id).map((contact) => contact.source_id!));
          const outboundLinkedIds = new Set(contacts.rows.filter((contact) => contact.source_system === null && contact.elvanto_source_id).map((contact) => contact.elvanto_source_id!));
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
            const profile = mapElvantoPeopleProfile(person, previewCustomFields);
            if (outboundLinkedIds.has(sourceId)) { pageSkipped += 1; continue; }
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
    routes.post("/api/modules/sync/elvanto/groups-export-preview", async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      const row = await elvantoSettings(dept);
      if (!row) return reply.code(404).send({ error: "Connect Elvanto before previewing Groups export." });
      if (row.directions.groups !== "smart_church_to_elvanto" && row.directions.groups !== "bidirectional") return reply.code(400).send({ error: "Set Groups direction to Smart Church → Elvanto or bidirectional before previewing an export." });
      let apiKey: string;
      try { apiKey = decryptElvantoKey(row.encrypted_api_key); } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Reconnect Elvanto." }); }
      try {
        const remoteGroups: JsonObject[] = [];
        let reportedTotal: number | null = null;
        let complete = false;
        for (let page = 1; page <= 200; page += 1) {
          const payload = await elvantoRequest(apiKey, "groups/getAll", { page, page_size: 1000, fields: ["people"] });
          const batch = elvantoCollection(payload, "groups", "group");
          remoteGroups.push(...batch);
          const reported = Number((payload.groups as JsonObject | undefined)?.total);
          if (Number.isFinite(reported) && reported >= 0) reportedTotal = reported;
          if (reportedTotal !== null && remoteGroups.length >= reportedTotal || batch.length < 1000) { complete = true; break; }
        }
        if (!complete || remoteGroups.length > 200000) return reply.code(409).send({ error: "Could not read the complete Elvanto Groups list. No export preview was saved." });
        const localResult = await pool!.query<{ id: string; name: string; elvanto_source_id: string | null; contact_id: string | null; person_source_id: string | null; role: string | null; status: string | null }>(
          `SELECT g.id,g.name,g.elvanto_source_id,m.contact_id,COALESCE(c.elvanto_source_id,CASE WHEN c.source_system='elvanto' THEN c.source_id END) AS person_source_id,m.role,m.status
             FROM church_groups g LEFT JOIN group_members m ON m.group_id=g.id LEFT JOIN contacts c ON c.id=m.contact_id AND c.department_id=g.department_id
            WHERE g.department_id=$1 AND g.source_system IS NULL ORDER BY g.id,m.contact_id`, [dept]);
        const localGroups = new Map<string, { id: string; name: string; elvanto_source_id: string | null; members: Array<{ contact_id: string; person_source_id: string | null; role: string; status: string }> }>();
        for (const item of localResult.rows) {
          let group = localGroups.get(item.id);
          if (!group) { group = { id: item.id, name: item.name, elvanto_source_id: item.elvanto_source_id, members: [] }; localGroups.set(item.id, group); }
          if (item.contact_id) group.members.push({ contact_id: item.contact_id, person_source_id: item.person_source_id, role: item.role ?? "Member", status: item.status ?? "active" });
        }
        const remoteById = new Map(remoteGroups.map((group) => [idOf(group), group]));
        const remoteNames = new Map<string, JsonObject[]>();
        for (const group of remoteGroups) {
          const key = firstText(group.name).trim().toLocaleLowerCase();
          if (key) remoteNames.set(key, [...(remoteNames.get(key) ?? []), group]);
        }
        const operations: Array<{ kind: "group" | "member"; groupId: string; localHash: string; sourceId?: string | null; remoteHash?: string | null; action: string; name?: string; personId?: string; position?: string }> = [];
        const sample: Array<{ name: string; action: string; membersToAdd: number; missingPeople: number; remoteOnlyMembers: number }> = [];
        let createCount = 0; let updateCount = 0; let reviewCount = 0; let addMemberCount = 0; let missingPeopleCount = 0; let remoteOnlyMemberCount = 0;
        for (const group of localGroups.values()) {
          const linked = group.elvanto_source_id ? remoteById.get(group.elvanto_source_id) : undefined;
          const localHash = elvantoGroupExportHash(group, group.members);
          let action: "create" | "update" | "review_name_conflict" | "missing_remote";
          if (group.elvanto_source_id) action = linked ? "update" : "missing_remote";
          else if ((remoteNames.get(group.name.trim().toLocaleLowerCase()) ?? []).length) action = "review_name_conflict";
          else action = "create";
          if (action === "create") createCount += 1;
          else if (action === "update") updateCount += 1;
          else reviewCount += 1;
          const remoteMemberIds = new Set(linked ? elvantoGroupPeople(linked).map(idOf).filter(Boolean) : []);
          const desiredMembers = new Set<string>();
          let membersToAdd = 0; let missingPeople = 0;
          for (const member of group.members) {
            if (member.status !== "active") continue;
            if (!member.person_source_id) { missingPeople += 1; continue; }
            desiredMembers.add(member.person_source_id);
            if (action !== "create" && action !== "update") continue;
            if (remoteMemberIds.has(member.person_source_id)) continue;
            const position = /^leader$/i.test(member.role) ? "Leader" : /^assistant\s+leader$/i.test(member.role) ? "Assistant Leader" : undefined;
            operations.push({ kind: "member", groupId: group.id, localHash, action: "add", personId: member.person_source_id, ...(position ? { position } : {}) });
            remoteMemberIds.add(member.person_source_id);
            membersToAdd += 1; addMemberCount += 1;
          }
          const remoteOnly = [...remoteMemberIds].filter((personId) => !desiredMembers.has(personId)).length;
          remoteOnlyMemberCount += remoteOnly; missingPeopleCount += missingPeople;
          operations.unshift({ kind: "group", groupId: group.id, sourceId: group.elvanto_source_id, localHash, remoteHash: linked ? elvantoRemoteGroupHash(linked) : null, action, name: group.name });
          if (sample.length < 50) sample.push({ name: group.name, action, membersToAdd, missingPeople, remoteOnlyMembers: remoteOnly });
        }
        const saved = await pool!.query(
          `UPDATE elvanto_sync_settings SET groups_export_preview_at=now(),groups_export_preview_rows=$2::jsonb,groups_export_page=0,groups_export_created_count=0,groups_export_updated_count=0,groups_export_added_members_count=0,groups_export_skipped_count=0,groups_export_complete=($4=0),updated_at=now()
            WHERE department_id=$1 AND updated_at=$3 AND people_importing=FALSE AND groups_importing=FALSE AND services_importing=FALSE AND calendar_importing=FALSE AND people_flows_importing=FALSE AND (songs_importing=FALSE OR songs_import_started_at < now()-interval '15 minutes') AND (financial_importing=FALSE OR financial_import_started_at < now()-interval '15 minutes') AND (people_exporting=FALSE OR people_export_started_at < now()-interval '15 minutes') RETURNING department_id`,
          [dept, JSON.stringify(operations), row.updated_at, operations.length]);
        if (!saved.rowCount) return reply.code(409).send({ error: "Another Elvanto import is running or the connection changed. Try the preview again." });
        return { complete: true, groups: localGroups.size, total: operations.length, create: createCount, update: updateCount, addMembers: addMemberCount, review: reviewCount, missingPeople: missingPeopleCount, remoteOnlyMembers: remoteOnlyMemberCount, sample };
      } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Groups export preview failed." }); }
    });
    routes.post("/api/modules/sync/elvanto/groups-export", async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      if (elvantoGroupsImportRunning.has(dept)) return reply.code(409).send({ error: "A Groups sync is already running for this location." });
      const row = await elvantoSettings(dept);
      if (!row) return reply.code(404).send({ error: "Connect Elvanto before exporting Groups." });
      if (row.directions.groups !== "smart_church_to_elvanto" && row.directions.groups !== "bidirectional") return reply.code(400).send({ error: "Set Groups direction to Smart Church → Elvanto or bidirectional before exporting." });
      const saved = (await pool!.query<{ preview_at: Date | string | null; rows: Array<{ kind: string; groupId: string; localHash: string; sourceId?: string | null; remoteHash?: string | null; action: string; name?: string; personId?: string; position?: string }>; page: number; created: number; updated: number; added: number; skipped: number }>("SELECT groups_export_preview_at AS preview_at,groups_export_preview_rows AS rows,groups_export_page AS page,groups_export_created_count AS created,groups_export_updated_count AS updated,groups_export_added_members_count AS added,groups_export_skipped_count AS skipped FROM elvanto_sync_settings WHERE department_id=$1", [dept])).rows[0];
      const previewTime = saved?.preview_at ? new Date(saved.preview_at).getTime() : 0;
      if (!saved || !previewTime || Date.now() - previewTime > 60 * 60 * 1000 || !Array.isArray(saved.rows)) return reply.code(409).send({ error: "Run a complete Groups export preview first. Previews expire after one hour and after connection settings change." });
      let apiKey: string;
      try { apiKey = decryptElvantoKey(row.encrypted_api_key); } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Reconnect Elvanto." }); }
      elvantoGroupsImportRunning.add(dept); let reserved = false; let writeAttempted = false;
      try {
        const lock = await pool!.query("UPDATE elvanto_sync_settings SET groups_importing=TRUE,groups_import_started_at=now(),updated_at=now() WHERE department_id=$1 AND updated_at=$2 AND groups_export_preview_at > now()-interval '1 hour' AND people_importing=FALSE AND groups_importing=FALSE AND services_importing=FALSE AND calendar_importing=FALSE AND people_flows_importing=FALSE AND (songs_importing=FALSE OR songs_import_started_at < now()-interval '15 minutes') AND (financial_importing=FALSE OR financial_import_started_at < now()-interval '15 minutes') AND (people_exporting=FALSE OR people_export_started_at < now()-interval '15 minutes') RETURNING department_id", [dept, row.updated_at]);
        if (!lock.rowCount) return reply.code(409).send({ error: "The preview expired, settings changed, or another import is running. Run a new Groups export preview." });
        reserved = true;
        let index = saved.page; let created = saved.created; let updated = saved.updated; let added = saved.added; let skipped = saved.skipped; let writes = 0; let processed = 0;
        const operations = saved.rows;
        while (index < operations.length && writes < 5 && processed < 100) {
          const operation = operations[index];
          if (operation.action !== "create" && operation.action !== "update" && operation.action !== "add") { skipped += 1; index += 1; processed += 1; await pool!.query("UPDATE elvanto_sync_settings SET groups_export_page=$2,groups_export_skipped_count=$3,updated_at=now() WHERE department_id=$1", [dept, index, skipped]); continue; }
          const localRows = await pool!.query<{ id: string; name: string; elvanto_source_id: string | null; contact_id: string | null; person_source_id: string | null; role: string | null; status: string | null }>(`SELECT g.id,g.name,g.elvanto_source_id,m.contact_id,COALESCE(c.elvanto_source_id,CASE WHEN c.source_system='elvanto' THEN c.source_id END) AS person_source_id,m.role,m.status FROM church_groups g LEFT JOIN group_members m ON m.group_id=g.id LEFT JOIN contacts c ON c.id=m.contact_id AND c.department_id=g.department_id WHERE g.department_id=$1 AND g.id=$2 AND g.source_system IS NULL ORDER BY m.contact_id`, [dept, operation.groupId]);
          const group = localRows.rows[0];
          if (!group) { await pool!.query("UPDATE elvanto_sync_settings SET groups_export_preview_at=NULL,groups_export_preview_rows='[]'::jsonb,groups_export_complete=FALSE,updated_at=now() WHERE department_id=$1", [dept]); return reply.code(409).send({ error: "A local group changed after preview. Run a fresh Groups export preview." }); }
          const members = localRows.rows.filter((item) => item.contact_id).map((item) => ({ contact_id: item.contact_id!, person_source_id: item.person_source_id, role: item.role ?? "Member", status: item.status ?? "active" }));
          const localHash = elvantoGroupExportHash(group, members);
          if (localHash !== operation.localHash) { await pool!.query("UPDATE elvanto_sync_settings SET groups_export_preview_at=NULL,groups_export_preview_rows='[]'::jsonb,groups_export_complete=FALSE,updated_at=now() WHERE department_id=$1", [dept]); return reply.code(409).send({ error: "A local group or its membership changed after preview. Run a fresh Groups export preview." }); }
          let remoteGroupId = group.elvanto_source_id;
          if (operation.kind === "group") {
            if (group.elvanto_source_id !== (operation.action === "update" ? operation.sourceId : null)) { await pool!.query("UPDATE elvanto_sync_settings SET groups_export_preview_at=NULL,groups_export_preview_rows='[]'::jsonb,groups_export_complete=FALSE,updated_at=now() WHERE department_id=$1", [dept]); return reply.code(409).send({ error: "The local Elvanto group link changed after preview. Run a fresh Groups export preview." }); }
            if (operation.action === "update") {
              const remote = remoteGroupId ? await fetchElvantoGroupInfo(apiKey, remoteGroupId) : undefined;
              if (!remote || elvantoRemoteGroupHash(remote) !== operation.remoteHash) { await pool!.query("UPDATE elvanto_sync_settings SET groups_export_preview_at=NULL,groups_export_preview_rows='[]'::jsonb,groups_export_complete=FALSE,updated_at=now() WHERE department_id=$1", [dept]); return reply.code(409).send({ error: "The linked Elvanto group changed after preview. Run a fresh Groups export preview." }); }
            } else {
              const currentRemote = await fetchElvantoPagedRows(apiKey, "groups/getAll", "groups", "group");
              if (!currentRemote.complete || currentRemote.rows.some((item) => firstText(item.name).trim().toLocaleLowerCase() === group.name.trim().toLocaleLowerCase())) { await pool!.query("UPDATE elvanto_sync_settings SET groups_export_preview_at=NULL,groups_export_preview_rows='[]'::jsonb,groups_export_complete=FALSE,updated_at=now() WHERE department_id=$1", [dept]); return reply.code(409).send({ error: "A matching Elvanto group now exists or the complete list could not be checked. Run a fresh Groups export preview." }); }
            }
            writeAttempted = true;
            const result = await elvantoRequest(apiKey, operation.action === "create" ? "groups/create" : "groups/edit", { ...(operation.action === "update" ? { id: remoteGroupId } : {}), name: group.name });
            if (operation.action === "create") remoteGroupId = idOf((result.group ?? {}) as JsonObject);
            if (!remoteGroupId) throw new Error("Elvanto accepted the group request without returning a stable group ID. Run a new preview before retrying.");
            if (operation.action === "create") await pool!.query("UPDATE church_groups SET elvanto_source_id=$3,updated_at=now() WHERE department_id=$1 AND id=$2 AND source_system IS NULL", [dept, operation.groupId, remoteGroupId]);
            if (operation.action === "create") created += 1; else updated += 1;
            writes += 1;
          } else {
            if (!remoteGroupId) { await pool!.query("UPDATE elvanto_sync_settings SET groups_export_preview_at=NULL,groups_export_preview_rows='[]'::jsonb,groups_export_complete=FALSE,updated_at=now() WHERE department_id=$1", [dept]); return reply.code(409).send({ error: "The Elvanto group link is missing. Run a fresh Groups export preview." }); }
            const person = await pool!.query<{ source_id: string | null; elvanto_source_id: string | null }>("SELECT source_id,elvanto_source_id FROM contacts WHERE id=$1 AND department_id=$2", [members.find((member) => member.person_source_id === operation.personId)?.contact_id ?? "", dept]);
            const personId = person.rows[0]?.elvanto_source_id ?? person.rows[0]?.source_id;
            if (!personId || personId !== operation.personId) { skipped += 1; index += 1; processed += 1; await pool!.query("UPDATE elvanto_sync_settings SET groups_export_page=$2,groups_export_skipped_count=$3,updated_at=now() WHERE department_id=$1", [dept, index, skipped]); continue; }
            const remote = await fetchElvantoGroupInfo(apiKey, remoteGroupId);
            if (!remote) throw new Error("Could not re-read the Elvanto group before adding a member.");
            if (elvantoGroupPeople(remote).some((item) => idOf(item) === operation.personId)) { index += 1; processed += 1; await pool!.query("UPDATE elvanto_sync_settings SET groups_export_page=$2,updated_at=now() WHERE department_id=$1", [dept, index]); continue; }
            writeAttempted = true;
            await elvantoRequest(apiKey, "groups/addPerson", { id: remoteGroupId, person_id: operation.personId, ...(operation.position ? { position: operation.position } : {}) });
            added += 1; writes += 1;
          }
          writeAttempted = false; index += 1; processed += 1;
          const complete = index >= operations.length;
          await pool!.query("UPDATE elvanto_sync_settings SET groups_export_page=$2,groups_export_created_count=$3,groups_export_updated_count=$4,groups_export_added_members_count=$5,groups_export_skipped_count=$6,groups_export_complete=$7,last_sync_at=CASE WHEN $7 THEN now() ELSE last_sync_at END,last_sync_error=NULL,updated_at=now() WHERE department_id=$1", [dept, index, created, updated, added, skipped, complete]);
        }
        const complete = index >= operations.length;
        await pool!.query("UPDATE elvanto_sync_settings SET groups_export_complete=$2,updated_at=now() WHERE department_id=$1", [dept, complete]);
        return { groupsExport: { page: index, total: operations.length, created, updated, addedMembers: added, skipped, complete } };
      } catch (error) {
        if (writeAttempted) await pool!.query("UPDATE elvanto_sync_settings SET groups_export_preview_at=NULL,groups_export_preview_rows='[]'::jsonb,groups_export_complete=FALSE,updated_at=now() WHERE department_id=$1", [dept]).catch(() => {});
        await pool!.query("UPDATE elvanto_sync_settings SET last_sync_error=$2 WHERE department_id=$1", [dept, (error instanceof Error ? error.message : "Groups export failed.").slice(0, 1000)]).catch(() => {});
        return reply.code(400).send({ error: error instanceof Error ? error.message : "Groups export failed." });
      } finally {
        if (reserved) await pool!.query("UPDATE elvanto_sync_settings SET groups_importing=FALSE,groups_import_started_at=NULL,updated_at=now() WHERE department_id=$1", [dept]).catch(() => {});
        elvantoGroupsImportRunning.delete(dept);
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
        pool!.query<{ id: string; source_id: string | null; elvanto_source_id: string | null; source_system: string | null; name: string }>("SELECT id,source_id,elvanto_source_id,source_system,name FROM church_groups WHERE department_id=$1", [dept]),
        pool!.query<{ id: string; source_id: string | null; elvanto_source_id: string | null; source_system: string | null }>("SELECT id,source_id,elvanto_source_id,source_system FROM contacts WHERE department_id=$1 AND ((source_system='elvanto' AND source_id IS NOT NULL) OR (source_system IS NULL AND elvanto_source_id IS NOT NULL))", [dept]),
      ]);
      const bySourceId = new Map(existingGroups.rows.map((group) => [group.source_system === "elvanto" ? group.source_id : group.elvanto_source_id, group] as const).filter((entry): entry is [string, typeof existingGroups.rows[number]] => Boolean(entry[0])));
      const names = new Map<string, typeof existingGroups.rows>();
      for (const group of existingGroups.rows) names.set(group.name.trim().toLocaleLowerCase(), [...(names.get(group.name.trim().toLocaleLowerCase()) ?? []), group]);
      const contactIdBySource = new Map(linkedPeople.rows.map((person) => [person.source_system === "elvanto" ? person.source_id : person.elvanto_source_id, person.id] as const).filter((entry): entry is [string, string] => Boolean(entry[0])));
      const localMembershipRows = await pool!.query<{ group_id: string; contact_id: string; person_source_id: string | null }>(
        "SELECT g.id AS group_id,m.contact_id,COALESCE(c.elvanto_source_id,CASE WHEN c.source_system='elvanto' THEN c.source_id END) AS person_source_id FROM church_groups g JOIN group_members m ON m.group_id=g.id JOIN contacts c ON c.id=m.contact_id AND c.department_id=g.department_id WHERE g.department_id=$1 AND g.source_system='elvanto'",
        [dept],
      );
      const existingMembersByGroup = new Map<string, Set<string>>();
      for (const member of localMembershipRows.rows) existingMembersByGroup.set(member.group_id, new Set([...(existingMembersByGroup.get(member.group_id) ?? []), member.person_source_id ?? `local:${member.contact_id}`]));
      const seen = new Set<string>();
      const sample: Array<{ name: string; action: "create" | "already_linked" | "review_name_conflict" | "needs_review" | "duplicate_source_id"; members: number; linkedMembers: number }> = [];
      let createCount = 0; let alreadyLinkedCount = 0; let conflictCount = 0; let invalidCount = 0; let memberCount = 0; let linkedMemberCount = 0;
      let localOnlyMemberCount = 0;
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
        const targetMemberIds = new Set(members.map((person) => idOf(person)).map((personId) => contactIdBySource.get(personId)).filter((contactId): contactId is string => Boolean(contactId)));
        const linkedMembers = targetMemberIds.size;
        linkedMemberCount += linkedMembers;
        const existingGroup = bySourceId.get(sourceId);
        if (existingGroup?.source_system === "elvanto") {
          const existingMemberIds = existingMembersByGroup.get(existingGroup.id) ?? new Set<string>();
          localOnlyMemberCount += [...existingMemberIds].filter((memberId) => memberId.startsWith("local:") || !members.some((person) => idOf(person) === memberId)).length;
        }
        if (sample.length < 50) sample.push({ name, action, members: members.length, linkedMembers });
      }
      const savedPreview = await pool!.query(
        "UPDATE elvanto_sync_settings SET groups_preview_at=CASE WHEN $2 THEN now() ELSE NULL END,groups_preview_complete=$2,groups_preview_scanned_count=$3,groups_preview_total=$4 WHERE department_id=$1 AND updated_at=$5 AND people_importing=FALSE AND groups_importing=FALSE AND services_importing=FALSE AND calendar_importing=FALSE AND people_flows_importing=FALSE AND (songs_importing=FALSE OR songs_import_started_at < now()-interval '15 minutes') AND (financial_importing=FALSE OR financial_import_started_at < now()-interval '15 minutes') AND (people_exporting=FALSE OR people_export_started_at < now()-interval '15 minutes') RETURNING department_id",
        [dept, complete, groups.length, total, row.updated_at],
      );
      if (!savedPreview.rowCount) return reply.code(409).send({ error: "Elvanto settings changed during the preview. Save the connection again and run a new preview." });
      return { scannedCount: groups.length, reportedTotal: total, complete, createCount, alreadyLinkedCount, nameConflictCount: conflictCount, invalidCount, memberCount, linkedMemberCount, unmatchedMemberCount: memberCount - linkedMemberCount, localOnlyMemberCount, sample };
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
              AND (groups_importing=FALSE OR groups_import_started_at < now()-interval '15 minutes') AND services_importing=FALSE AND calendar_importing=FALSE AND people_flows_importing=FALSE AND (songs_importing=FALSE OR songs_import_started_at < now()-interval '15 minutes') AND (financial_importing=FALSE OR financial_import_started_at < now()-interval '15 minutes') AND (people_exporting=FALSE OR people_export_started_at < now()-interval '15 minutes') RETURNING department_id`,
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
          const contacts = await pool!.query<{ id: string; source_id: string | null; elvanto_source_id: string | null; source_system: string | null }>("SELECT id,source_id,elvanto_source_id,source_system FROM contacts WHERE department_id=$1 AND ((source_system='elvanto' AND source_id IS NOT NULL) OR (source_system IS NULL AND elvanto_source_id IS NOT NULL))", [dept]);
          const contactIdBySource = new Map(contacts.rows.map((contact) => [contact.source_system === "elvanto" ? contact.source_id : contact.elvanto_source_id, contact.id] as const).filter((entry): entry is [string, string] => Boolean(entry[0])));
          const existing = await pool!.query<{ id: string; source_id: string | null; elvanto_source_id: string | null; source_system: string | null; name: string }>("SELECT id,source_id,elvanto_source_id,source_system,name FROM church_groups WHERE department_id=$1", [dept]);
          const groupIdBySource = new Map(existing.rows.map((group) => [group.source_system === "elvanto" ? group.source_id : group.elvanto_source_id, group.id] as const).filter((entry): entry is [string, string] => Boolean(entry[0])));
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
              const conflictingOwner = (namesByKey.get(nameKey) ?? []).some((owner) => !((owner.source_system === "elvanto" && owner.source_id === sourceId) || owner.elvanto_source_id === sourceId));
              if (conflictingOwner || seenNames.has(nameKey)) { pageSkipped += 1; continue; }
              seenNames.add(nameKey);
              let groupId = existingId;
              if (existingId) {
                const linkedGroup = existing.rows.find((owner) => owner.id === existingId);
                if (linkedGroup?.elvanto_source_id === sourceId && linkedGroup.source_system === null) { pageSkipped += 1; continue; }
                const changed = await db.query("UPDATE church_groups SET name=$3,description=$4,updated_at=now() WHERE id=$1 AND department_id=$2 AND source_system='elvanto' RETURNING id", [existingId, dept, name, description]);
                if (!changed.rowCount) { pageSkipped += 1; continue; }
                pageUpdated += 1;
              } else {
                const inserted = await db.query<{ id: string }>("INSERT INTO church_groups (id,department_id,name,description,source_system,source_id) VALUES (gen_random_uuid(),$1,$2,$3,'elvanto',$4) ON CONFLICT (department_id,source_system,source_id) WHERE source_system IS NOT NULL DO NOTHING RETURNING id", [dept, name, description, sourceId]);
                if (!inserted.rowCount) { pageSkipped += 1; continue; }
                groupId = inserted.rows[0].id;
                pageCreated += 1;
                namesByKey.set(nameKey, [...(namesByKey.get(nameKey) ?? []), { id: groupId, source_id: sourceId, elvanto_source_id: null, source_system: "elvanto", name }]);
              }
              if (!groupId) { pageSkipped += 1; continue; }
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
      const saved = await pool!.query("UPDATE elvanto_sync_settings SET services_preview_at=CASE WHEN $2 THEN now() ELSE NULL END,services_preview_complete=$2,services_preview_scanned_count=$3,services_preview_total=$4 WHERE department_id=$1 AND updated_at=$5 AND people_importing=FALSE AND groups_importing=FALSE AND services_importing=FALSE AND calendar_importing=FALSE AND people_flows_importing=FALSE AND (songs_importing=FALSE OR songs_import_started_at < now()-interval '15 minutes') AND (financial_importing=FALSE OR financial_import_started_at < now()-interval '15 minutes') AND (people_exporting=FALSE OR people_export_started_at < now()-interval '15 minutes') RETURNING department_id", [dept, complete, events.length, total, row.updated_at]);
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
              const values = [dept, event.title, event.date, event.isAllDay ?? false, event.start, event.end, event.location, event.description, event.room, JSON.stringify(event.positions), JSON.stringify(event.timePlan), event.sourceId];
              if (linked) {
                const changed = await db.query("UPDATE service_events SET title=$3,kind='service',event_date=$4,is_all_day=$5,start_time=$6,end_time=$7,location=$8,description=$9,room=$10,positions=$11::jsonb,time_plan=$12::jsonb,source_system='elvanto',source_id=$13,updated_at=now() WHERE id=$1 AND department_id=$2 AND source_system='elvanto' RETURNING id", [linked.id, ...values]);
                if (!changed.rowCount) { pageSkipped += 1; continue; } pageUpdated += 1;
              } else {
                const inserted = await db.query("INSERT INTO service_events (id,department_id,title,kind,event_date,is_all_day,start_time,end_time,location,description,room,positions,time_plan,source_system,source_id) VALUES (gen_random_uuid(),$1,$2,'service',$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,'elvanto',$12) ON CONFLICT (department_id,source_system,source_id) WHERE source_system IS NOT NULL DO NOTHING RETURNING id", values);
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
        WHERE department_id=$1 AND updated_at=$2 AND people_importing=FALSE AND groups_importing=FALSE AND services_importing=FALSE AND calendar_importing=FALSE AND people_flows_importing=FALSE AND (songs_importing=FALSE OR songs_import_started_at < now()-interval '15 minutes') AND (financial_importing=FALSE OR financial_import_started_at < now()-interval '15 minutes') AND (people_exporting=FALSE OR people_export_started_at < now()-interval '15 minutes') RETURNING department_id`, [dept, row.updated_at]);
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
            AND (songs_importing=FALSE OR songs_import_started_at < now()-interval '15 minutes') AND (financial_importing=FALSE OR financial_import_started_at < now()-interval '15 minutes') AND (people_exporting=FALSE OR people_export_started_at < now()-interval '15 minutes') RETURNING department_id`, [dept, row.updated_at]);
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
        WHERE department_id=$1 AND updated_at=$2 AND people_flows_importing=FALSE AND people_importing=FALSE AND groups_importing=FALSE AND services_importing=FALSE AND calendar_importing=FALSE AND people_flows_importing=FALSE AND (songs_importing=FALSE OR songs_import_started_at < now()-interval '15 minutes') AND (financial_importing=FALSE OR financial_import_started_at < now()-interval '15 minutes') AND (people_exporting=FALSE OR people_export_started_at < now()-interval '15 minutes') RETURNING department_id`, [dept, row.updated_at]);
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
          WHERE department_id=$1 AND updated_at=$5 AND people_flows_importing=FALSE AND (songs_importing=FALSE OR songs_import_started_at < now()-interval '15 minutes') AND (financial_importing=FALSE OR financial_import_started_at < now()-interval '15 minutes') AND (people_exporting=FALSE OR people_export_started_at < now()-interval '15 minutes') RETURNING department_id`, [dept, complete, snapshot.reportedFlows, JSON.stringify(snapshot.flowIds), row.updated_at]);
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
            AND (people_flows_importing=FALSE OR people_flows_import_started_at < now()-interval '15 minutes') AND (songs_importing=FALSE OR songs_import_started_at < now()-interval '15 minutes') AND (financial_importing=FALSE OR financial_import_started_at < now()-interval '15 minutes') AND (people_exporting=FALSE OR people_export_started_at < now()-interval '15 minutes') RETURNING department_id`, [dept, row.updated_at]);
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
    routes.get<{ Querystring: { page?: number } }>("/api/modules/sync/elvanto/calendar-export-options", { schema: { querystring: { type: "object", additionalProperties: false, properties: { page: { type: "integer", minimum: 1, maximum: 200 } } } } }, async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      const row = await elvantoSettings(dept); if (!row) return reply.code(404).send({ error: "Connect Elvanto before exporting calendar events." });
      let apiKey: string;
      try { apiKey = decryptElvantoKey(row.encrypted_api_key); } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Reconnect Elvanto." }); }
      try {
        const [calendarPayload, peoplePayload] = await Promise.all([
          elvantoRequest(apiKey, "calendar/getAll"),
          elvantoRequest(apiKey, "people/getAll", { page: request.query.page ?? 1, page_size: 1000 }),
        ]);
        const calendars = elvantoCollection(calendarPayload, "calendars", "calendar").map((calendar) => ({ id: idOf(calendar), name: firstText(calendar.name), published: calendar.published !== "false" && calendar.published !== false })).filter((calendar) => calendar.id && calendar.name);
        const organizers = elvantoCollection(peoplePayload, "people", "person").map((person) => ({ id: idOf(person), name: firstText(person.preferred_name, person.firstname, person.first_name, person.lastname, person.last_name) + (firstText(person.lastname, person.last_name) && firstText(person.firstname, person.first_name, person.preferred_name) ? ` ${firstText(person.lastname, person.last_name)}` : "") })).filter((person) => person.id && person.name);
        return { calendars, organizers, organizersPage: request.query.page ?? 1, organizersTotal: Number((peoplePayload.people as JsonObject | undefined)?.total) || organizers.length };
      } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Could not load Elvanto calendars and organizers." }); }
    });
    routes.post<{ Body: { calendarId: string; organizerId: string; startDate: string; endDate: string } }>("/api/modules/sync/elvanto/calendar-export-preview", { schema: { body: { type: "object", additionalProperties: false, required: ["calendarId", "organizerId", "startDate", "endDate"], properties: { calendarId: { type: "string", minLength: 1, maxLength: 100 }, organizerId: { type: "string", minLength: 1, maxLength: 100 }, startDate: { type: "string", format: "date" }, endDate: { type: "string", format: "date" } } } } }, async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      const row = await elvantoSettings(dept);
      if (!row) return reply.code(404).send({ error: "Connect Elvanto before previewing calendar export." });
      if (row.directions.calendar === "off" || row.directions.calendar === "elvanto_to_smart_church") return reply.code(400).send({ error: "Set Calendar direction to Smart Church → Elvanto or bidirectional before previewing an export." });
      if (elvantoCalendarExportRunning.has(dept)) return reply.code(409).send({ error: "A Calendar export is already running for this location." });
      if (request.body.startDate > request.body.endDate) return reply.code(400).send({ error: "Calendar export start date must be on or before the end date." });
      let apiKey: string;
      try { apiKey = decryptElvantoKey(row.encrypted_api_key); } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Reconnect Elvanto." }); }
      try {
        const [calendarPayload, organizerPayload, profile] = await Promise.all([
          elvantoRequest(apiKey, "calendar/getAll"),
          elvantoRequest(apiKey, "people/getAll", { page: 1, page_size: 1000 }),
          pool!.query<{ time_zone: string }>("SELECT time_zone FROM departments WHERE id=$1", [dept]),
        ]);
        const calendar = elvantoCollection(calendarPayload, "calendars", "calendar").find((item) => idOf(item) === request.body.calendarId);
        let organizer = elvantoCollection(organizerPayload, "people", "person").find((item) => idOf(item) === request.body.organizerId);
        if (!calendar) return reply.code(400).send({ error: "Choose a valid Elvanto destination calendar." });
        const peopleTotal = Number((organizerPayload.people as JsonObject | undefined)?.total) || 0;
        for (let organizerPage = 2; !organizer && organizerPage <= Math.min(200, Math.ceil(peopleTotal / 1000)); organizerPage += 1) {
          const pagePayload = await elvantoRequest(apiKey, "people/getAll", { page: organizerPage, page_size: 1000 });
          organizer = elvantoCollection(pagePayload, "people", "person").find((item) => idOf(item) === request.body.organizerId);
        }
        if (!organizer) return reply.code(400).send({ error: "Choose a valid Elvanto event organizer." });
        const timeZone = profile.rows[0]?.time_zone;
        if (!timeZone) return reply.code(400).send({ error: "The location time zone is not configured." });
        const local = await pool!.query<{ id: string; title: string; event_date: string; is_all_day: boolean; start_time: string; end_time: string | null; location: string; description: string | null; source_id: string | null; source_system: string | null; updated_at: string }>(
          "SELECT id,title,event_date::text,is_all_day,start_time::text,end_time::text,location,description,source_id,source_system,updated_at::text FROM service_events WHERE department_id=$1 AND event_date BETWEEN $2::date AND $3::date AND (source_system IS NULL OR (source_system='elvanto' AND source_id LIKE 'calendar-export:%')) ORDER BY event_date,start_time,id LIMIT 20001", [dept, request.body.startDate, request.body.endDate],
        );
        if (local.rows.length > 20000) return reply.code(413).send({ error: "Calendar export previews support up to 20,000 local events at a time. Narrow the events included in the local schedule before creating a preview." });
        const minDate = local.rows[0]?.event_date ?? new Date().toISOString().slice(0, 10);
        const maxDate = local.rows[local.rows.length - 1]?.event_date ?? minDate;
        const remoteEvents: JsonObject[] = []; let reportedTotal: number | null = null; let readComplete = false;
        for (let page = 1; page <= 200; page += 1) {
          const payload = await elvantoRequest(apiKey, "calendar/events/getAll", { page, page_size: 1000, start: shiftDate(minDate, -1), end: shiftDate(maxDate, 1) });
          const items = elvantoCollection(payload, "events", "event"); remoteEvents.push(...items);
          const meta = payload.events as JsonObject | undefined; const total = Number(meta?.total); if (Number.isFinite(total) && total >= 0) reportedTotal = total;
          if (items.length === 0 || (reportedTotal !== null ? remoteEvents.length >= reportedTotal : items.length < 1000)) { readComplete = true; break; }
        }
        if (!readComplete) return reply.code(502).send({ error: "Could not read the complete Elvanto Calendar list. No export preview was saved." });
        const byRemoteId = new Map(remoteEvents.map((event) => [idOf(event), event]).filter(([id]) => Boolean(id)) as Array<[string, JsonObject]>);
        const remoteNames = new Set(remoteEvents.map((event) => {
          const date = elvantoEventDateInTimeZone(event, timeZone);
          return date ? `${date}|${firstText(event.name, event.title).trim().toLocaleLowerCase()}` : "";
        }).filter(Boolean));
        const rows = local.rows.map((event) => {
          const linkedRemoteId = event.source_system === "elvanto" && event.source_id?.startsWith("calendar-export:") ? event.source_id.slice("calendar-export:".length) : null;
          const remote = linkedRemoteId ? byRemoteId.get(linkedRemoteId) : undefined;
          let action = "create"; let start: string | null = null; let end: string | null = null;
          try {
            if (!event.title.trim() || (!event.is_all_day && !event.end_time)) throw new Error("An event needs a title, start time, and end time to export.");
            start = event.is_all_day ? `${event.event_date} 00:00:00` : localEventTimeToUtc(event.event_date, event.start_time.slice(0, 5), timeZone);
            end = event.is_all_day ? `${shiftDate(event.event_date, 1)} 00:00:00` : localEventTimeToUtc(event.event_date, event.end_time!.slice(0, 5), timeZone);
            if (end <= start) throw new Error("The event end time must be later than its start time.");
            if (linkedRemoteId && !remote) action = "review_missing_remote";
            else if (remote) action = "update";
            else if (remoteNames.has(`${event.event_date}|${event.title.trim().toLocaleLowerCase()}`)) action = "review_conflict";
          } catch { action = "invalid"; }
          return { eventId: event.id, updatedAt: event.updated_at, sourceId: linkedRemoteId, action, title: event.title, date: event.event_date, isAllDay: event.is_all_day, start, end, location: event.location, description: event.description ?? "", remoteHash: remote ? calendarEventFingerprint(remote) : null };
        });
        const changed = await pool!.query(`UPDATE elvanto_sync_settings SET calendar_export_calendar_id=$2,calendar_export_organizer_id=$3,calendar_export_preview_at=now(),calendar_export_preview_rows=$4::jsonb,calendar_export_page=0,calendar_export_created_count=0,calendar_export_updated_count=0,calendar_export_skipped_count=0,calendar_export_complete=FALSE,updated_at=now()
          WHERE department_id=$1 AND updated_at=$5 AND people_importing=FALSE AND groups_importing=FALSE AND services_importing=FALSE AND calendar_importing=FALSE AND people_flows_importing=FALSE AND (songs_importing=FALSE OR songs_import_started_at < now()-interval '15 minutes') AND (financial_importing=FALSE OR financial_import_started_at < now()-interval '15 minutes') AND (people_exporting=FALSE OR people_export_started_at < now()-interval '15 minutes') RETURNING department_id`, [dept, request.body.calendarId, request.body.organizerId, JSON.stringify(rows), row.updated_at]);
        if (!changed.rowCount) return reply.code(409).send({ error: "An Elvanto operation is running or connection settings changed. Try the preview again." });
        const completeCount = rows.filter((item) => item.action === "create" || item.action === "update").length;
        return { complete: true, total: rows.length, create: rows.filter((item) => item.action === "create").length, update: rows.filter((item) => item.action === "update").length, review: rows.filter((item) => item.action.startsWith("review_") || item.action === "invalid").length, startDate: request.body.startDate, endDate: request.body.endDate, sample: rows.slice(0, 50).map(({ eventId, updatedAt, remoteHash, ...item }) => item), calendar: { id: idOf(calendar), name: firstText(calendar.name) }, organizer: { id: idOf(organizer), name: `${firstText(organizer.preferred_name, organizer.firstname, organizer.first_name)} ${firstText(organizer.lastname, organizer.last_name)}`.trim() }, timeZone, eligibleCount: completeCount };
      } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Could not preview Elvanto Calendar export." }); }
    });
    routes.post<{ Body?: { restart?: boolean } }>("/api/modules/sync/elvanto/calendar-export", async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      if (elvantoCalendarExportRunning.has(dept)) return reply.code(409).send({ error: "A Calendar export is already running for this location." });
      const row = await elvantoSettings(dept);
      if (!row) return reply.code(404).send({ error: "Connect Elvanto before exporting calendar events." });
      if (row.directions.calendar === "off" || row.directions.calendar === "elvanto_to_smart_church") return reply.code(400).send({ error: "Set Calendar direction to Smart Church → Elvanto or bidirectional before exporting." });
      const previewTime = row.calendar_export_preview_at ? new Date(row.calendar_export_preview_at).getTime() : 0;
      if (!previewTime || Date.now() - previewTime > 60 * 60 * 1000 || !row.calendar_export_calendar_id || !row.calendar_export_organizer_id || !Array.isArray(row.calendar_export_preview_rows)) return reply.code(409).send({ error: "Run a complete Calendar export preview first. Previews expire after one hour and after connection settings change." });
      let apiKey: string;
      try { apiKey = decryptElvantoKey(row.encrypted_api_key); } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Reconnect Elvanto." }); }
      elvantoCalendarExportRunning.add(dept); let reserved = false;
      try {
        const reservation = await pool!.query(`UPDATE elvanto_sync_settings SET people_exporting=TRUE,people_export_started_at=now(),updated_at=now()
          WHERE department_id=$1 AND updated_at=$2 AND calendar_export_preview_at > now()-interval '1 hour' AND people_importing=FALSE AND groups_importing=FALSE AND services_importing=FALSE AND calendar_importing=FALSE AND people_flows_importing=FALSE AND (songs_importing=FALSE OR songs_import_started_at < now()-interval '15 minutes') AND (financial_importing=FALSE OR financial_import_started_at < now()-interval '15 minutes') AND (people_exporting=FALSE OR people_export_started_at < now()-interval '15 minutes') RETURNING department_id`, [dept, row.updated_at]);
        if (!reservation.rowCount) return reply.code(409).send({ error: "The preview expired, settings changed, or another Elvanto operation is running. Run a fresh complete Calendar export preview." });
        reserved = true;
        let page = request.body?.restart ? 0 : row.calendar_export_page;
        let created = request.body?.restart ? 0 : row.calendar_export_created_count;
        let updated = request.body?.restart ? 0 : row.calendar_export_updated_count;
        let skipped = request.body?.restart ? 0 : row.calendar_export_skipped_count;
        let complete = request.body?.restart ? false : row.calendar_export_complete;
        const previewRows = row.calendar_export_preview_rows;
        const profile = await pool!.query<{ time_zone: string }>("SELECT time_zone FROM departments WHERE id=$1", [dept]);
        const timeZone = profile.rows[0]?.time_zone;
        if (!timeZone) return reply.code(400).send({ error: "The location time zone is not configured." });
        if (request.body?.restart) await pool!.query("UPDATE elvanto_sync_settings SET calendar_export_page=0,calendar_export_created_count=0,calendar_export_updated_count=0,calendar_export_skipped_count=0,calendar_export_complete=FALSE,updated_at=now() WHERE department_id=$1", [dept]);
        const remoteEventList: JsonObject[] = []; let remoteTotal: number | null = null; let remoteComplete = false;
        const remoteStart = shiftDate(previewRows[0]?.date ?? new Date().toISOString().slice(0, 10), -1); const remoteEnd = shiftDate(previewRows.at(-1)?.date ?? new Date().toISOString().slice(0, 10), 1);
        for (let remotePage = 1; remotePage <= 200; remotePage += 1) {
          const remotePayload = await elvantoRequest(apiKey, "calendar/events/getAll", { page: remotePage, page_size: 1000, start: remoteStart, end: remoteEnd });
          const items = elvantoCollection(remotePayload, "events", "event"); remoteEventList.push(...items);
          const metadata = remotePayload.events as JsonObject | undefined; const reported = Number(metadata?.total); if (Number.isFinite(reported) && reported >= 0) remoteTotal = reported;
          if (!items.length || (remoteTotal !== null ? remoteEventList.length >= remoteTotal : items.length < 1000)) { remoteComplete = true; break; }
        }
        if (!remoteComplete) return reply.code(502).send({ error: "Could not verify the complete Elvanto Calendar list. No events were written." });
        const remoteById = new Map(remoteEventList.map((event) => [idOf(event), event]));
        const batch = previewRows.slice(page, page + 5);
        for (const item of batch) {
          if (item.action !== "create" && item.action !== "update") { skipped += 1; page += 1; continue; }
          const current = await pool!.query<{ updated_at: string }>("SELECT updated_at::text FROM service_events WHERE id=$1 AND department_id=$2 AND (source_system IS NULL OR (source_system='elvanto' AND source_id LIKE 'calendar-export:%'))", [item.eventId, dept]);
          if (!current.rowCount || current.rows[0].updated_at !== item.updatedAt) return reply.code(409).send({ error: "A local event changed after preview. Run a fresh Calendar export preview before writing." });
          const linkedRemoteId = item.sourceId as string | null;
          const remote = linkedRemoteId ? remoteById.get(linkedRemoteId) : undefined;
          if (linkedRemoteId && (!remote || calendarEventFingerprint(remote) !== item.remoteHash)) return reply.code(409).send({ error: "An Elvanto event changed or disappeared after preview. Run a fresh Calendar export preview." });
          if (!linkedRemoteId && remoteEventList.some((event) => elvantoEventDateInTimeZone(event, timeZone) === item.date && firstText(event.name, event.title).trim().toLocaleLowerCase() === String(item.title).trim().toLocaleLowerCase())) return reply.code(409).send({ error: "A matching Elvanto calendar event appeared after preview. Run a fresh Calendar export preview." });
          const body = { name: item.title, calendar_id: row.calendar_export_calendar_id, organizer: row.calendar_export_organizer_id, status: "private", start: item.start, end: item.end, all_day: item.isAllDay ? "yes" : "no", where: item.location, description: item.description };
          if (linkedRemoteId) {
            await elvantoRequest(apiKey, "calendar/events/edit", { id: linkedRemoteId, ...body });
            updated += 1;
          } else {
            const result = await elvantoRequest(apiKey, "calendar/events/create", body);
            const remoteId = idOf(result.event as JsonObject | undefined);
            if (!remoteId) throw new Error("Elvanto did not return the ID of the created calendar event.");
            await pool!.query("UPDATE service_events SET source_system='elvanto',source_id=$3,updated_at=now() WHERE id=$1 AND department_id=$2 AND source_system IS NULL", [item.eventId, dept, `calendar-export:${remoteId}`]);
            created += 1;
          }
          page += 1;
        }
        complete = page >= previewRows.length;
        await pool!.query("UPDATE elvanto_sync_settings SET calendar_export_page=$2,calendar_export_created_count=$3,calendar_export_updated_count=$4,calendar_export_skipped_count=$5,calendar_export_complete=$6,last_sync_at=CASE WHEN $6 THEN now() ELSE last_sync_at END,last_sync_error=NULL,updated_at=now() WHERE department_id=$1", [dept, page, created, updated, skipped, complete]);
        return { calendarExport: { page, total: previewRows.length, created, updated, skipped, complete } };
      } catch (error) {
        await pool!.query("UPDATE elvanto_sync_settings SET last_sync_error=$2 WHERE department_id=$1", [dept, (error instanceof Error ? error.message : "Calendar export failed.").slice(0, 1000)]).catch(() => {});
        return reply.code(400).send({ error: error instanceof Error ? error.message : "Calendar export failed." });
      } finally {
        if (reserved) await pool!.query("UPDATE elvanto_sync_settings SET people_exporting=FALSE,people_export_started_at=NULL,updated_at=now() WHERE department_id=$1", [dept]).catch(() => {});
        elvantoCalendarExportRunning.delete(dept);
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
        WHERE department_id=$1 AND updated_at=$7 AND people_importing=FALSE AND groups_importing=FALSE AND services_importing=FALSE AND calendar_importing=FALSE AND people_flows_importing=FALSE AND (songs_importing=FALSE OR songs_import_started_at < now()-interval '15 minutes') AND (financial_importing=FALSE OR financial_import_started_at < now()-interval '15 minutes') AND (people_exporting=FALSE OR people_export_started_at < now()-interval '15 minutes') RETURNING department_id`, [dept, complete, mapped.length, total, startDate, endDate, row.updated_at]);
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
          WHERE department_id=$1 AND updated_at=$2 AND people_importing=FALSE AND groups_importing=FALSE AND services_importing=FALSE AND calendar_preview_complete=TRUE AND calendar_preview_at > now()-interval '1 hour' AND people_flows_importing=FALSE AND (songs_importing=FALSE OR songs_import_started_at < now()-interval '15 minutes') AND (financial_importing=FALSE OR financial_import_started_at < now()-interval '15 minutes') AND (people_exporting=FALSE OR people_export_started_at < now()-interval '15 minutes')
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
              const values = [dept, event.title, event.date, event.isAllDay ?? false, event.start, event.end, event.location, event.description, event.room, JSON.stringify([]), JSON.stringify([]), event.sourceId];
              if (linked) {
                const changed = await db.query("UPDATE service_events SET title=$3,kind='other',event_date=$4,is_all_day=$5,start_time=$6,end_time=$7,location=$8,description=$9,room=$10,positions=$11::jsonb,time_plan=$12::jsonb,source_system='elvanto',source_id=$13,updated_at=now() WHERE id=$1 AND department_id=$2 AND source_system='elvanto' RETURNING id", [linked.id, ...values]);
                if (!changed.rowCount) { pageSkipped += 1; continue; } pageUpdated += 1;
              } else {
                const inserted = await db.query("INSERT INTO service_events (id,department_id,title,kind,event_date,is_all_day,start_time,end_time,location,description,room,positions,time_plan,source_system,source_id) VALUES (gen_random_uuid(),$1,$2,'other',$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,'elvanto',$12) ON CONFLICT (department_id,source_system,source_id) WHERE source_system IS NOT NULL DO NOTHING RETURNING id", values);
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
          people_export_preview_at=NULL,people_export_preview_rows='[]'::jsonb,people_export_page=0,people_export_created_count=0,people_export_updated_count=0,people_export_skipped_count=0,people_export_complete=FALSE,
          groups_export_preview_at=NULL,groups_export_preview_rows='[]'::jsonb,groups_export_page=0,groups_export_created_count=0,groups_export_updated_count=0,groups_export_added_members_count=0,groups_export_skipped_count=0,groups_export_complete=FALSE,
           calendar_export_preview_at=NULL,calendar_export_preview_rows='[]'::jsonb,calendar_export_page=0,calendar_export_created_count=0,calendar_export_updated_count=0,calendar_export_skipped_count=0,calendar_export_complete=FALSE,
          people_importing=FALSE,people_import_started_at=NULL,groups_importing=FALSE,groups_import_started_at=NULL,services_importing=FALSE,services_import_started_at=NULL,calendar_importing=FALSE,calendar_import_started_at=NULL,people_flows_importing=FALSE,people_flows_import_started_at=NULL,songs_importing=FALSE,songs_import_started_at=NULL,financial_importing=FALSE,financial_import_started_at=NULL,people_exporting=FALSE,people_export_started_at=NULL,updated_at=now()
         WHERE (elvanto_sync_settings.people_importing=FALSE OR elvanto_sync_settings.people_import_started_at < now()-interval '15 minutes')
           AND (elvanto_sync_settings.groups_importing=FALSE OR elvanto_sync_settings.groups_import_started_at < now()-interval '15 minutes')
           AND (elvanto_sync_settings.services_importing=FALSE OR elvanto_sync_settings.services_import_started_at < now()-interval '15 minutes')
           AND (elvanto_sync_settings.calendar_importing=FALSE OR elvanto_sync_settings.calendar_import_started_at < now()-interval '15 minutes')
           AND (elvanto_sync_settings.people_flows_importing=FALSE OR elvanto_sync_settings.people_flows_import_started_at < now()-interval '15 minutes')
           AND (elvanto_sync_settings.songs_importing=FALSE OR elvanto_sync_settings.songs_import_started_at < now()-interval '15 minutes') AND (elvanto_sync_settings.financial_importing=FALSE OR elvanto_sync_settings.financial_import_started_at < now()-interval '15 minutes') AND (elvanto_sync_settings.people_exporting=FALSE OR elvanto_sync_settings.people_export_started_at < now()-interval '15 minutes')
         RETURNING department_id`,
        [dept, encryptedKey, JSON.stringify(directions), request.body.financialEnabled, Boolean(request.body.apiKey?.trim())],
      );
      if (!result.rowCount) return reply.code(409).send({ error: "An Elvanto import is running. Wait for it to finish before changing settings." });
      return { saved: true, configured: true, directions, financialEnabled: request.body.financialEnabled };
    });
    routes.delete("/api/modules/sync/elvanto", async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      const result = await pool!.query("DELETE FROM elvanto_sync_settings WHERE department_id=$1 AND (people_importing=FALSE OR people_import_started_at < now()-interval '15 minutes') AND (groups_importing=FALSE OR groups_import_started_at < now()-interval '15 minutes') AND (services_importing=FALSE OR services_import_started_at < now()-interval '15 minutes') AND (calendar_importing=FALSE OR calendar_import_started_at < now()-interval '15 minutes') AND (people_flows_importing=FALSE OR people_flows_import_started_at < now()-interval '15 minutes') AND (songs_importing=FALSE OR songs_import_started_at < now()-interval '15 minutes') AND (financial_importing=FALSE OR financial_import_started_at < now()-interval '15 minutes') AND (people_exporting=FALSE OR people_export_started_at < now()-interval '15 minutes') RETURNING department_id", [dept]);
      if (!result.rowCount) {
        const existing = await elvantoSettings(dept);
        if (existing) return reply.code(409).send({ error: "An Elvanto import is running. Wait for it to finish before disconnecting Elvanto." });
      }
      return { disconnected: true };
    });
    const timer = setInterval(() => {
      if (!pool || !isDatabaseReady()) return;
      void pool.query("SELECT department_id FROM churchtools_sync_settings WHERE enabled=true").then(async (result) => {
        for (const row of result.rows) {
          if (!(await deps.isDepartmentWritable(row.department_id))) continue;
          try { await run(row.department_id); } catch { /* Errors are recorded for the sync status page. */ }
        }
      }).catch(() => {});
    }, syncIntervalMs);
    timer.unref();
    routes.addHook("onClose", async () => clearInterval(timer));
  });
}

