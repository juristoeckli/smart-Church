import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ModuleServerContext } from "../module-sdk.js";

type JsonObject = Record<string, unknown>;
type PreviewRow = { sourceId: string; title: string; fingerprint: string; action: "import" | "already_linked" | "title_conflict" | "duplicate_source_title" | "changed" | "missing" };
function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}
function objectRows(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.filter((row): row is JsonObject => Boolean(row) && typeof row === "object" && !Array.isArray(row));
  if (value && typeof value === "object") return Object.values(value).filter((row): row is JsonObject => Boolean(row) && typeof row === "object" && !Array.isArray(row));
  return [];
}
function fingerprint(song: unknown, arrangements: unknown): string {
  return createHash("sha256").update(JSON.stringify({ song, arrangements })).digest("hex");
}
function normalizeTitle(value: string): string { return value.trim().normalize("NFKC").toLocaleLowerCase(); }
function mapKeys(arrangement: JsonObject) {
  const raw = arrangement.keys;
  const keys = Array.isArray(raw) ? raw.map((key, index) => typeof key === "string" ? { id: `key-${index + 1}`, name: key } : key as JsonObject)
    : objectRows(raw);
  return keys.length ? keys.map((key, index) => ({
    id: text(key.id) || text(key.key_id) || `key-${index + 1}`,
    name: text(key.name) || text(key.key) || text(key.value),
  })) : [{ id: "default", name: text(arrangement.musical_key) || text(arrangement.key) }];
}
function toArrangementName(name: string, key: string, keyCount: number): string {
  const suffix = keyCount > 1 && key ? ` (${key})` : "";
  return `${name.slice(0, Math.max(1, 160 - suffix.length))}${suffix}`;
}

export function registerElvantoSongLibraryRoutes(app: FastifyInstance, context: ModuleServerContext) {
  const { pool, isDatabaseReady, resolveDepartmentId, validateMutation } = context;
  app.register(async (routes) => {
    async function department(request: FastifyRequest, reply: FastifyReply) {
      if (!isDatabaseReady() || !pool) {
        reply.code(503).send({ error: "The song library import is unavailable because the database is not ready." });
        return null;
      }
      return resolveDepartmentId(request, reply, false, false, "events_manage");
    }

    async function checkDirection(departmentId: string, reply: FastifyReply) {
      const settings = await pool!.query<{ enabled: boolean; directions: Record<string, string> }>(
        "SELECT enabled,directions FROM elvanto_sync_settings WHERE department_id=$1", [departmentId],
      );
      const setting = settings.rows[0];
      if (!setting?.enabled) {
        reply.code(404).send({ error: "Connect and enable Elvanto Sync before importing songs into the library." });
        return false;
      }
      const direction = setting.directions?.songs;
      if (direction !== "elvanto_to_smart_church" && direction !== "bidirectional") {
        reply.code(400).send({ error: "Set Songs direction to Elvanto → Smart Church or bidirectional before importing to the library." });
        return false;
      }
      return true;
    }

    routes.post("/api/modules/sync/elvanto/songs-library-preview", async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      if (!validateMutation(request, reply)) return reply;
      if (!await checkDirection(departmentId, reply)) return reply;
      const [snapshots, linked, localSongs] = await Promise.all([
        pool!.query<{ source_id: string; title: string; song: JsonObject; arrangements: JsonObject[] }>(
          "SELECT source_id,title,song,arrangements FROM elvanto_songs_import WHERE department_id=$1 ORDER BY lower(title),source_id", [departmentId],
        ),
        pool!.query<{ source_song_id: string }>("SELECT source_song_id FROM elvanto_worship_song_links WHERE department_id=$1", [departmentId]),
        pool!.query<{ title: string }>("SELECT title FROM worship_songs WHERE department_id=$1 AND active=TRUE", [departmentId]),
      ]);
      const linkedIds = new Set(linked.rows.map((row) => row.source_song_id));
      const localTitles = new Set(localSongs.rows.map((row) => normalizeTitle(row.title)));
      const titleCounts = new Map<string, number>();
      for (const snapshot of snapshots.rows) {
        const title = text(snapshot.title);
        const key = normalizeTitle(title);
        if (key) titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1);
      }
      const previewRows: PreviewRow[] = snapshots.rows.map((snapshot) => {
        const sourceId = text(snapshot.source_id);
        const title = text(snapshot.title);
        const titleKey = normalizeTitle(title);
        const action: PreviewRow["action"] = linkedIds.has(sourceId) ? "already_linked"
          : (titleCounts.get(titleKey) ?? 0) > 1 ? "duplicate_source_title"
          : localTitles.has(titleKey) ? "title_conflict" : "import";
        return { sourceId, title, fingerprint: fingerprint(snapshot.song, snapshot.arrangements), action };
      });
      const encoded = JSON.stringify(previewRows);
      if (Buffer.byteLength(encoded) > 50 * 1024 * 1024) return reply.code(413).send({ error: "The song import preview exceeds 50 MiB. Import fewer Elvanto songs and create a new preview." });
      const previewId = randomUUID();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await pool!.query(
        `INSERT INTO elvanto_worship_song_import_previews(department_id,preview_id,rows,cursor,created_count,review_count,expires_at,updated_at)
         VALUES($1,$2,$3::jsonb,0,0,0,$4,now())
         ON CONFLICT(department_id) DO UPDATE SET preview_id=EXCLUDED.preview_id,rows=EXCLUDED.rows,cursor=0,created_count=0,review_count=0,expires_at=EXCLUDED.expires_at,updated_at=now()`,
        [departmentId, previewId, encoded, expiresAt],
      );
      const importCount = previewRows.filter((row) => row.action === "import").length;
      const alreadyLinkedCount = previewRows.filter((row) => row.action === "already_linked").length;
      const reviewCount = previewRows.length - importCount - alreadyLinkedCount;
      return { previewId, total: previewRows.length, importCount, alreadyLinkedCount, reviewCount, expiresAt, sample: previewRows.slice(0, 50).map(({ sourceId, title, action }) => ({ sourceId, title, action })) };
    });

    routes.post<{ Body: { previewId: string } }>("/api/modules/sync/elvanto/songs-library-import", {
      schema: { body: { type: "object", additionalProperties: false, required: ["previewId"], properties: { previewId: { type: "string", format: "uuid" } } } },
    }, async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      if (!validateMutation(request, reply)) return reply;
      if (!await checkDirection(departmentId, reply)) return reply;
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        const selected = await client.query<{ preview_id: string; rows: PreviewRow[]; cursor: number; created_count: number; review_count: number; expires_at: Date | string }>(
          "SELECT preview_id,rows,cursor,created_count,review_count,expires_at FROM elvanto_worship_song_import_previews WHERE department_id=$1 FOR UPDATE", [departmentId],
        );
        const preview = selected.rows[0];
        if (!preview || preview.preview_id !== request.body.previewId) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "Create a fresh song-library preview before importing." });
        }
        if (new Date(preview.expires_at).getTime() <= Date.now()) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "The song-library preview expired. Create a fresh preview before importing." });
        }
        const previewRows = Array.isArray(preview.rows) ? preview.rows : [];
        let cursor = Number(preview.cursor);
        let createdCount = Number(preview.created_count);
        let reviewCount = Number(preview.review_count);
        let processed = 0;
        const limit = Math.min(cursor + 5, previewRows.length);
        for (; cursor < limit; cursor += 1) {
          const row = previewRows[cursor];
          processed += 1;
          if (row.action === "already_linked") continue;
          if (row.action !== "import") { reviewCount += 1; continue; }
          const snapshotResult = await client.query<{ source_id: string; title: string; song: JsonObject; arrangements: JsonObject[] }>(
            "SELECT source_id,title,song,arrangements FROM elvanto_songs_import WHERE department_id=$1 AND source_id=$2 FOR SHARE", [departmentId, row.sourceId],
          );
          const snapshot = snapshotResult.rows[0];
          if (!snapshot || fingerprint(snapshot.song, snapshot.arrangements) !== row.fingerprint || text(snapshot.title) !== row.title) {
            row.action = snapshot ? "changed" : "missing";
            reviewCount += 1;
            continue;
          }
          const existingLink = await client.query("SELECT 1 FROM elvanto_worship_song_links WHERE department_id=$1 AND source_song_id=$2", [departmentId, row.sourceId]);
          if (existingLink.rowCount) { row.action = "already_linked"; continue; }
          const collision = await client.query("SELECT 1 FROM worship_songs WHERE department_id=$1 AND active=TRUE AND lower(title)=lower($2) LIMIT 1", [departmentId, row.title]);
          if (collision.rowCount) { row.action = "title_conflict"; reviewCount += 1; continue; }

          const songData = snapshot.song ?? {};
          const songId = randomUUID();
          const authors = text(songData.artist) || text(songData.author) || text(songData.authors);
          const notes = text(songData.notes).slice(0, 2000);
          const arrangementRows = objectRows(snapshot.arrangements);
          const firstArrangement = arrangementRows[0];
          const firstKey = firstArrangement ? mapKeys(firstArrangement)[0] : null;
          await client.query(
            "INSERT INTO worship_songs(id,department_id,title,authors,default_key,notes) VALUES($1,$2,$3,$4,$5,$6)",
            [songId, departmentId, row.title.slice(0, 200), authors.slice(0, 500), firstKey?.name.slice(0, 16) ?? "", notes],
          );
          await client.query(
            "INSERT INTO elvanto_worship_song_links(department_id,source_song_id,song_id,source_fingerprint) VALUES($1,$2,$3,$4)",
            [departmentId, row.sourceId, songId, row.fingerprint],
          );
          for (const sourceArrangement of arrangementRows) {
            const remoteArrangementId = text(sourceArrangement.id);
            if (!remoteArrangementId) continue;
            const name = text(sourceArrangement.name) || text(sourceArrangement.title) || "Arrangement";
            const keys = mapKeys(sourceArrangement);
            for (const key of keys) {
              const arrangementId = randomUUID();
              const arrangementName = toArrangementName(name, key.name, keys.length);
              const chartUrl = text(sourceArrangement.chart_url);
              const audioUrl = text(sourceArrangement.audio_url);
              await client.query(
                "INSERT INTO worship_song_arrangements(id,song_id,name,musical_key,chart_url,audio_url) VALUES($1,$2,$3,$4,$5,$6)",
                [arrangementId, songId, arrangementName, key.name.slice(0, 16), chartUrl.startsWith("https://") ? chartUrl.slice(0, 2048) : "", audioUrl.startsWith("https://") ? audioUrl.slice(0, 2048) : ""],
              );
              await client.query(
                "INSERT INTO elvanto_worship_arrangement_links(department_id,source_song_id,source_arrangement_id,source_key_id,arrangement_id) VALUES($1,$2,$3,$4,$5)",
                [departmentId, row.sourceId, remoteArrangementId, key.id, arrangementId],
              );
            }
          }
          createdCount += 1;
        }
        const complete = cursor >= previewRows.length;
        await client.query(
          "UPDATE elvanto_worship_song_import_previews SET rows=$2::jsonb,cursor=$3,created_count=$4,review_count=$5,updated_at=now() WHERE department_id=$1",
          [departmentId, JSON.stringify(previewRows), cursor, createdCount, reviewCount],
        );
        await client.query("COMMIT");
        return { import: { cursor, total: previewRows.length, created: createdCount, review: reviewCount, complete, processedThisBatch: processed } };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    });
  });
}
