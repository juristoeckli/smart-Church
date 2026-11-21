import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { churchToolsSongCrosswalkId } from "./song-catalog.js";

type Slot = "chart" | "audio";
type Db = Pick<PoolClient, "query">;
type Scope = { departmentId: string; instanceUrl: string; songId: string; arrangementId: string };
type Selection = { chart?: string; audio?: string };
const object = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const id = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : null;

export function approvedArrangementMediaUrl(value: unknown): { slot: Slot; url: string } | null {
  if (typeof value !== "string" || value.length > 1000 || /[\s\\\u0000-\u001f\u007f]/u.test(value)) return null;
  let parsed: URL;
  try { parsed = new URL(value); } catch { return null; }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.hash) return null;
  const { hostname, pathname, search } = parsed;
  if (hostname === "www.youtube.com" || hostname === "youtube.com" || hostname === "youtu.be") {
    const video = hostname === "youtu.be" && !search ? pathname.slice(1)
      : hostname !== "youtu.be" && pathname === "/watch" && parsed.searchParams.size === 1 ? parsed.searchParams.get("v") : null;
    return video && /^[a-zA-Z0-9_-]{11}$/.test(video)
      ? { slot: "audio", url: `https://www.youtube.com/watch?v=${video}` } : null;
  }
  if (search) return null;
  if (hostname === "vimeo.com" && /^\/[1-9][0-9]{0,14}$/.test(pathname)) {
    return { slot: "audio", url: `https://vimeo.com${pathname}` };
  }
  if (hostname === "open.spotify.com" && /^\/track\/[A-Za-z0-9]{22}$/.test(pathname)) {
    return { slot: "audio", url: `https://open.spotify.com${pathname}` };
  }
  if (hostname === "docs.google.com" && /^\/document\/d\/e\/2PACX-[A-Za-z0-9_-]{20,250}\/pub$/.test(pathname)) {
    return { slot: "chart", url: `https://docs.google.com${pathname}` };
  }
  return null;
}

export function readChurchToolsArrangementMedia(arrangement: unknown, files: unknown, arrangementId: string) {
  const source = object(object(arrangement)?.data);
  if (!source || id(source.id) !== arrangementId || !Array.isArray(source.links)) {
    throw new Error("ChurchTools returned a mismatched arrangement or incomplete attachment links.");
  }
  const visibleLinks = new Set(source.links.flatMap((value) => {
    const link = object(value);
    return link?.domainType === "song_arrangement" && link.domainId === arrangementId && typeof link.fileUrl === "string"
      ? [link.fileUrl] : [];
  }));
  const rows = object(files)?.data;
  if (!Array.isArray(rows) || rows.length > 100) throw new Error("ChurchTools must return a complete list of at most 100 arrangement attachments.");
  const seen = new Set<string>();
  return rows.map((value) => {
    const file = object(value);
    const sourceId = id(file?.id);
    if (!file || !sourceId || seen.has(sourceId) || file.domainType !== "song_arrangement" || file.domainId !== arrangementId
      || (file.type !== "file" && file.type !== "link")) throw new Error("ChurchTools returned a mismatched or duplicate arrangement attachment.");
    seen.add(sourceId);
    const label = typeof file.name === "string" && !/https?:|www\.|[?&#=]/i.test(file.name)
      ? file.name.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 160) : "";
    const bytes = typeof file.size === "number" && Number.isSafeInteger(file.size) && file.size >= 0 ? file.size : null;
    const restricted = file.showOnlyWhenEditable !== false || file.securityLevelId !== null
      || (file.type === "link" && !visibleLinks.has(String(file.fileUrl ?? "")));
    const media = !restricted && file.type === "link" ? approvedArrangementMediaUrl(file.fileUrl) : null;
    const status = restricted ? "restricted"
      : file.type === "file" ? "binary_attachment"
      : media ? "eligible" : "unsupported_url";
    return { sourceId, label, bytes, type: file.type, status, media };
  }).sort((a, b) => a.sourceId.localeCompare(b.sourceId));
}

type Entry = ReturnType<typeof readChurchToolsArrangementMedia>[number];
type Target = { id: string; name: string; songTitle: string; chart: string; audio: string };
type Receipt = { source_file_id: string; slot: Slot; approved_url: string };

export async function loadArrangementMediaTarget(db: Db, scope: Scope, lock = false) {
  const crosswalk = churchToolsSongCrosswalkId(scope.instanceUrl, scope.songId);
  const { rows: [target] } = await db.query<Target>(`SELECT a.id,a.name,s.title AS "songTitle",a.chart_url AS chart,a.audio_url AS audio
    FROM churchtools_migration_links songLink JOIN worship_songs s ON s.id=songLink.local_record_id AND s.department_id=songLink.department_id AND s.active
    JOIN churchtools_migration_links arrangementLink ON arrangementLink.department_id=songLink.department_id AND arrangementLink.area='song_arrangement'
      AND arrangementLink.source_id=$3
    JOIN worship_song_arrangements a ON a.id=arrangementLink.local_record_id AND a.song_id=s.id AND a.active
    WHERE songLink.department_id=$1 AND songLink.area='song' AND songLink.source_id=$2
    ${lock ? "FOR UPDATE OF a FOR SHARE OF s,songLink,arrangementLink" : ""}`, [scope.departmentId, crosswalk, `${crosswalk}/${scope.arrangementId}`]);
  if (!target) return null;
  const { rows: receipts } = await db.query<Receipt>(`SELECT source_file_id,slot,approved_url FROM churchtools_migration_arrangement_media
    WHERE department_id=$1 AND instance_url=$2 AND source_song_id=$3 AND source_arrangement_id=$4 AND arrangement_id=$5 ORDER BY slot`,
  [scope.departmentId, scope.instanceUrl, scope.songId, scope.arrangementId, target.id]);
  return { target, receipts };
}

type TargetState = NonNullable<Awaited<ReturnType<typeof loadArrangementMediaTarget>>>;

export function buildArrangementMediaReview(scope: Scope, state: TargetState, entries: Entry[]) {
  const { target, receipts } = state;
  const slotStatus = (slot: Slot) => target[slot].trim() ? "occupied" : receipts.some((receipt) => receipt.slot === slot) ? "previously_linked" : "empty";
  const reviewHash = createHash("sha256").update(JSON.stringify([scope, target, receipts, entries])).digest("hex");
  return {
    reviewHash,
    target: { name: target.name, songTitle: target.songTitle, chart: slotStatus("chart"), audio: slotStatus("audio") },
    attachments: entries,
  };
}

export class ArrangementMediaReviewError extends Error {}

export async function applyArrangementMedia(db: Db, scope: Scope, state: TargetState, entries: Entry[], selected: Selection,
  actor: string, reviewHash: string,
) {
  const chosen = (["chart", "audio"] as const).flatMap((slot) => selected[slot] ? [{ slot, sourceId: selected[slot] }] : []);
  if (!chosen.length) throw new ArrangementMediaReviewError("Select at least one reviewed attachment.");
  const requested = chosen.map(({ slot, sourceId }) => {
    const entry = entries.find((candidate) => candidate.sourceId === sourceId && candidate.media?.slot === slot);
    if (!entry?.media) throw new ArrangementMediaReviewError("An attachment is no longer eligible for this destination.");
    return { slot, sourceId, url: entry.media.url };
  });
  const { target, receipts } = state;
  const matchesExisting = ({ slot, sourceId, url }: (typeof requested)[number]) => target[slot] === url
    && receipts.some((receipt) => receipt.slot === slot && receipt.source_file_id === sourceId && receipt.approved_url === url);
  const pending = requested.filter((item) => !matchesExisting(item));
  if (!pending.length) return { linked: 0, replayed: true };
  if (reviewHash !== buildArrangementMediaReview(scope, state, entries).reviewHash) {
    throw new ArrangementMediaReviewError("The arrangement or attachment list changed. Review it again.");
  }
  for (const { slot, sourceId } of pending) {
    if (target[slot].trim() || receipts.some((receipt) => receipt.slot === slot || receipt.source_file_id === sourceId)) {
      throw new ArrangementMediaReviewError("An arrangement slot already contains a local or previously reviewed link.");
    }
  }
  for (const { slot, sourceId, url } of pending) {
    const changed = slot === "chart"
      ? await db.query(`UPDATE worship_song_arrangements SET chart_url=$2,updated_at=now() WHERE id=$1 AND btrim(chart_url)=''`, [target.id, url])
      : await db.query(`UPDATE worship_song_arrangements SET audio_url=$2,updated_at=now() WHERE id=$1 AND btrim(audio_url)=''`, [target.id, url]);
    if (!changed.rowCount) throw new ArrangementMediaReviewError("An arrangement slot changed while applying links.");
    const receipt = await db.query(`INSERT INTO churchtools_migration_arrangement_media
      (department_id,instance_url,source_song_id,source_arrangement_id,source_file_id,arrangement_id,slot,approved_url,actor_user_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
    [scope.departmentId, scope.instanceUrl, scope.songId, scope.arrangementId, sourceId, target.id, slot, url, actor]);
    if (!receipt.rowCount) throw new ArrangementMediaReviewError("An attachment already has a reviewed link.");
  }
  return { linked: pending.length, replayed: false };
}
