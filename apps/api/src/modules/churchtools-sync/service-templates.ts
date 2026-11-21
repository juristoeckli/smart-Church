import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { churchToolsAgendaSourceId, normalizeChurchToolsAgenda, resolveChurchToolsAgendaSongs } from "./event-agenda.js";

export type ChurchToolsTemplateKind = "event" | "agenda";
type Db = Pick<PoolClient, "query">;
type Scope = { departmentId: string; instanceUrl: string; kind: ChurchToolsTemplateKind };
type Raw = Record<string, unknown>;
type Template = { sourceId: string; name: string; description: string; positions: Array<{ name: string }>;
  sourceItems: ReturnType<typeof normalizeChurchToolsAgenda>["items"]; omitted: string[]; blocked: string[] };
const object = (value: unknown): Raw | null => value && typeof value === "object" && !Array.isArray(value) ? value as Raw : null;
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const plain = (value: unknown) => text(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const nameKey = (value: string) => value.toLowerCase();

function readItems(payload: unknown, limit: number, label: string) {
  const data = object(payload);
  const rows = data?.data;
  if (!Array.isArray(rows) || rows.length > limit || object(data?.meta)?.count !== rows.length) {
    throw new Error(`ChurchTools did not return a complete list of up to ${limit} ${label}.`);
  }
  const seen = new Set<string>();
  return rows.map((raw) => {
    const row = object(raw);
    const id = churchToolsAgendaSourceId(row?.id);
    if (!row || !id || seen.has(id)) throw new Error(`ChurchTools returned an invalid or duplicate ID for ${label}.`);
    seen.add(id);
    return { id, row };
  });
}

function eventDefaults(row: Raw, roles: Map<string, string>, template: Template) {
  const roleRows = row.services;
  let count = 0;
  const seen = new Set<string>();
  if (!Array.isArray(roleRows)) template.blocked.push("invalid_service_roles");
  else {
    for (const value of roleRows) {
      const role = object(value);
      const serviceId = churchToolsAgendaSourceId(role?.serviceId);
      const slots = role?.count;
      if (!serviceId || seen.has(serviceId) || typeof slots !== "number" || !Number.isSafeInteger(slots) || slots < 0) {
        template.blocked.push("invalid_service_roles");
        break;
      }
      seen.add(serviceId);
      count += slots;
      const name = roles.get(serviceId);
      if (slots && (!name || name.length > 80)) template.omitted.push("unavailable_role_names");
      else if (name && count <= 40) template.positions.push(...Array.from({ length: slots }, () => ({ name })));
    }
  }
  if (count > 40) template.blocked.push("too_many_volunteer_slots");
  template.description = plain(row.description);
  if (template.description.length > 1000) {
    template.description = template.description.slice(0, 1000);
    template.omitted.push("description_shortened");
  }
  if (row.eventName != null) template.omitted.push("default_event_title");
  if (row.calendarId != null) template.omitted.push("default_calendar");
  if (row.hour != null || row.minute != null || Number(row.durationInSeconds) > 0) template.omitted.push("default_event_time_and_duration");
  if (Array.isArray(row.adminIds) && row.adminIds.length) template.omitted.push("default_event_administrators");
  if (row.facts && typeof row.facts === "object" && Object.keys(row.facts).length) template.omitted.push("default_event_facts");
}

function agendaDefaults(row: Raw, template: Template) {
  if (!Array.isArray(row.items) || row.items.length > 100) {
    template.blocked.push("invalid_or_oversized_agenda");
    return;
  }
  if (row.items.some((value) => {
    const item = object(value);
    const times = item?.startTimes;
    return item?.start != null || (times != null && (typeof times !== "object" || Object.keys(times).length > 0));
  })) {
    template.blocked.push("instance_agenda_has_occurrence_times");
    return;
  }
  const items = row.items.map((value) => {
    const item = object(value);
    if (!item) return value;
    if (item.type === "header") template.omitted.push("headings_become_plan_items");
    if (text(item.title).length > 160 || plain(item.note).length > 500) template.omitted.push("agenda_text_shortened");
    if (item.type !== "header" && item.duration != null && (!Number.isSafeInteger(item.duration)
      || Number(item.duration) < 0 || Number(item.duration) > 86_400 || Number(item.duration) % 60 !== 0)) {
      template.omitted.push("unsupported_agenda_duration");
      return { ...item, duration: null };
    }
    return item;
  });
  const agenda = normalizeChurchToolsAgenda({ data: { items } }, "", "UTC", []);
  template.sourceItems = agenda.items;
  if (agenda.unsupported) template.omitted.push("unsupported_agenda_items");
  template.omitted.push(...agenda.unmappedFields);
  if (Number(row.eventStartPosition) > 0) template.omitted.push("before_event_anchor");
  if (row.calendarId != null) template.omitted.push("default_calendar");
  if (text(row.series)) template.omitted.push("source_series_label");
}

export function readChurchToolsServiceTemplates(kind: ChurchToolsTemplateKind, payload: unknown, rolesPayload?: unknown) {
  const roles = new Map(kind === "event"
    ? readItems(rolesPayload, 1000, "service roles").map(({ id, row }) => [id, text(row.name)])
    : []);
  return readItems(payload, 100, "templates").map(({ id, row }) => {
    const name = text(kind === "event" ? row.templateName : row.name);
    const template: Template = { sourceId: id, name: name.slice(0, 160), description: "", positions: [], sourceItems: [], omitted: [], blocked: [] };
    if (!name || name.length > 160) template.blocked.push("invalid_template_name");
    if (kind === "event") eventDefaults(row, roles, template);
    else agendaDefaults(row, template);
    if (!template.positions.length && !template.sourceItems.length && !template.description) template.blocked.push("nothing_importable");
    return { ...template, omitted: [...new Set(template.omitted)], blocked: [...new Set(template.blocked)] };
  });
}

export async function reviewChurchToolsServiceTemplates(db: Db, scope: Scope, templates: Template[], lock = false) {
  const [local, links] = await Promise.all([
    db.query<{ id: string; name: string }>("SELECT id,name FROM service_plan_templates WHERE department_id=$1", [scope.departmentId]),
    db.query<{ source_id: string; source_hash: string; template_id: string; active: boolean }>(`SELECT receipt.source_id,receipt.source_hash,receipt.template_id,target.active
      FROM churchtools_migration_service_templates receipt JOIN service_plan_templates target ON target.id=receipt.template_id AND target.department_id=receipt.department_id
      WHERE receipt.department_id=$1 AND receipt.instance_url=$2 AND receipt.kind=$3`, [scope.departmentId, scope.instanceUrl, scope.kind]),
  ]);
  const localNames = new Set(local.rows.map(({ name }) => nameKey(name)));
  const mapped = new Map(links.rows.map((link) => [link.source_id, link]));
  const names = new Map<string, number>();
  for (const template of templates) names.set(nameKey(template.name), (names.get(nameKey(template.name)) ?? 0) + 1);
  if (lock && templates.some(({ sourceItems }) => sourceItems.length)) {
    await db.query("LOCK TABLE worship_songs,worship_song_arrangements,churchtools_migration_links IN SHARE MODE");
  }
  const resolved = await resolveChurchToolsAgendaSongs(db, scope.departmentId, scope.instanceUrl, templates.flatMap(({ sourceItems }) => sourceItems));
  let offset = 0;
  const rows = templates.map(({ sourceItems, ...template }) => {
    const items = resolved.slice(offset, offset + sourceItems.length);
    offset += sourceItems.length;
    const omitted = [...template.omitted];
    if (sourceItems.some(({ sourceSongId, sourceArrangementId }, index) =>
      (sourceSongId && !items[index].songId) || (sourceArrangementId && !items[index].arrangementId))) omitted.push("unlinked_songs_or_arrangements");
    const sourceHash = hash([template, sourceItems, items]);
    const prior = mapped.get(template.sourceId);
    const status = prior ? !prior.active ? "archived_local_copy" : prior.source_hash === sourceHash ? "already_imported" : "source_changed"
      : template.blocked.length ? "unsupported"
      : localNames.has(nameKey(template.name)) || (names.get(nameKey(template.name)) ?? 0) > 1 ? "name_conflict" : "create";
    return { ...template, items, omitted, sourceHash, status };
  });
  return { rows, reviewHash: hash([scope, rows]) };
}

type Review = Awaited<ReturnType<typeof reviewChurchToolsServiceTemplates>>;
export class ServiceTemplateReviewError extends Error {}
export async function applyChurchToolsServiceTemplates(db: Db, scope: Scope, review: Review, reviewHash: string, sourceIds: string[]) {
  const byId = new Map(review.rows.map((row) => [row.sourceId, row]));
  const selected = sourceIds.map((id) => byId.get(id));
  if (selected.some((row) => !row || (row.status !== "create" && row.status !== "already_imported"))) {
    throw new ServiceTemplateReviewError("A selected template changed or requires a separate review.");
  }
  const pending = selected.filter((row): row is Review["rows"][number] => row?.status === "create");
  if (!pending.length) return { created: 0, replayed: true };
  if (reviewHash !== review.reviewHash) throw new ServiceTemplateReviewError("Source templates or local copies changed. Open a fresh review.");
  for (const row of pending) {
    const templateId = randomUUID();
    await db.query(`INSERT INTO service_plan_templates(id,department_id,name,description,positions,items)
      VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)`, [templateId, scope.departmentId, row.name, row.description,
      JSON.stringify(row.positions), JSON.stringify(row.items)]);
    const result = await db.query(`INSERT INTO churchtools_migration_service_templates(department_id,instance_url,kind,source_id,source_hash,template_id)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [scope.departmentId, scope.instanceUrl, scope.kind, row.sourceId, row.sourceHash, templateId]);
    if (!result.rowCount) throw new ServiceTemplateReviewError("A selected template already has a local copy.");
  }
  return { created: pending.length, replayed: false };
}
