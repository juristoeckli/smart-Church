import type { ServicePlanItem } from "@smart-church/contracts";
import type { PoolClient } from "pg";
import { parseChurchToolsEventDateTime } from "./event-time.js";
import { churchToolsSongCrosswalkId } from "./song-catalog.js";

type SourceObject = Record<string, unknown>;
const object = (value: unknown): SourceObject | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as SourceObject : undefined;
export const churchToolsAgendaSourceId = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : null;
const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";

type AgendaItem = { plan: ServicePlanItem; sourceSongId: string | null; sourceArrangementId: string | null };
type AgendaSnapshot = { items: AgendaItem[]; hidden: number; unsupported: number; unmappedFields: string[] };

export function normalizeChurchToolsAgenda(payload: unknown, eventId: string, timeZone: string, positionNames: string[]): AgendaSnapshot {
  const data = object(object(payload)?.data);
  if (!data || !Array.isArray(data.items)) throw new Error("ChurchTools returned an invalid event agenda.");
  const items: AgendaItem[] = [];
  const unmappedFields = new Set<string>();
  let hidden = 0;
  let unsupported = 0;
  for (const value of data.items) {
    const item = object(value);
    if (!item || (item.type !== "header" && item.type !== "text" && item.type !== "song")) {
      unsupported += 1;
      continue;
    }
    const starts = object(item.startTimes);
    const hasEventTime = starts && Object.hasOwn(starts, eventId);
    const start = hasEventTime ? starts[eventId] : item.start;
    if (hasEventTime && start === null) {
      hidden += 1;
      continue;
    }
    const song = item.type === "song" ? object(item.song) : undefined;
    const title = text(item.title, 160) || text(song?.title, 160);
    if (!title) {
      unsupported += 1;
      continue;
    }
    const plan: ServicePlanItem = { title };
    const when = parseChurchToolsEventDateTime(start, undefined, undefined, timeZone);
    if (when && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(when.time)) plan.startTime = when.time;
    // Headers summarize the following items and consume no service time.
    if (item.type !== "header" && typeof item.duration === "number" && Number.isSafeInteger(item.duration) && item.duration > 0) {
      const minutes = Math.ceil(item.duration / 60);
      if (minutes <= 1440) plan.durationMinutes = minutes;
      else unmappedFields.add("agenda.duration");
    }
    const note = text(typeof item.note === "string" ? item.note.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ") : item.note, 500);
    if (note) plan.notes = note;
    if (Array.isArray(item.serviceGroupNotes) && item.serviceGroupNotes.length) unmappedFields.add("agenda.serviceGroupNotes");
    const responsibility = object(item.responsible);
    const services = Array.isArray(responsibility?.persons) ? responsibility.persons.map((person) => object(person)?.service) : [];
    const roles = new Set(services.map((service) => typeof service === "string" ? /^\[([^\[\]]+)\]$/.exec(service)?.[1].trim().toLocaleLowerCase() : undefined));
    const role = roles.size === 1 ? roles.values().next().value : undefined;
    const positions = role ? positionNames.filter((name) => name.toLocaleLowerCase() === role) : [];
    if (positions.length === 1) plan.position = positions[0];
    else if (services.length || text(responsibility?.text, 1)) unmappedFields.add("agenda.responsible");
    const sourceSongId = churchToolsAgendaSourceId(song?.songId);
    const sourceArrangementId = churchToolsAgendaSourceId(song?.arrangementId);
    items.push({ plan, sourceSongId, sourceArrangementId });
  }
  return { items, hidden, unsupported, unmappedFields: [...unmappedFields] };
}

export async function resolveChurchToolsAgendaSongs(db: Pick<PoolClient, "query">, departmentId: string, instanceUrl: string, items: AgendaItem[]): Promise<ServicePlanItem[]> {
  const songKeys = [...new Set(items.flatMap((item) => item.sourceSongId ? [churchToolsSongCrosswalkId(instanceUrl, item.sourceSongId)] : []))];
  const arrangementKeys = [...new Set(items.flatMap((item) => item.sourceSongId && item.sourceArrangementId
    ? [`${churchToolsSongCrosswalkId(instanceUrl, item.sourceSongId)}/${item.sourceArrangementId}`]
    : []))];
  const songs = new Map<string, string>();
  const arrangements = new Map<string, { id: string; song_id: string }>();
  if (songKeys.length) {
    const found = await db.query<{ source_id: string; id: string }>(`SELECT link.source_id, song.id FROM churchtools_migration_links link
      JOIN worship_songs song ON song.id=link.local_record_id AND song.department_id=link.department_id AND song.active
      WHERE link.department_id=$1 AND link.area='song' AND link.source_id=ANY($2::text[])`, [departmentId, songKeys]);
    for (const row of found.rows) songs.set(row.source_id, row.id);
  }
  if (arrangementKeys.length) {
    const found = await db.query<{ source_id: string; id: string; song_id: string }>(`SELECT link.source_id, arrangement.id, arrangement.song_id FROM churchtools_migration_links link
      JOIN worship_song_arrangements arrangement ON arrangement.id=link.local_record_id AND arrangement.active
      JOIN worship_songs song ON song.id=arrangement.song_id AND song.department_id=link.department_id AND song.active
      WHERE link.department_id=$1 AND link.area='song_arrangement' AND link.source_id=ANY($2::text[])`, [departmentId, arrangementKeys]);
    for (const row of found.rows) arrangements.set(row.source_id, row);
  }
  return items.map(({ plan, sourceSongId, sourceArrangementId }) => {
    const key = sourceSongId ? churchToolsSongCrosswalkId(instanceUrl, sourceSongId) : null;
    const songId = key ? songs.get(key) : undefined;
    if (!songId) return plan;
    const arrangement = sourceArrangementId ? arrangements.get(`${key}/${sourceArrangementId}`) : undefined;
    return { ...plan, songId, ...(arrangement?.song_id === songId ? { arrangementId: arrangement.id } : {}) };
  });
}
