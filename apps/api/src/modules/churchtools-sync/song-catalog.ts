import type { PoolClient } from "pg";

type SourceObject = Record<string, unknown>;
const object = (value: unknown): SourceObject | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as SourceObject : undefined;
const string = (value: unknown, limit: number) => typeof value === "string" ? value.trim().slice(0, limit) : "";
const positiveId = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : null;
const musicalKey = (value: unknown) => typeof value === "string" && /^[A-G][#b]?m?$/.test(value) ? value : "";

export function normalizeChurchToolsSong(value: unknown) {
  const row = object(value);
  const sourceId = positiveId(row?.id);
  const title = string(row?.name, 200);
  if (!row || !sourceId || !title || !Array.isArray(row.arrangements)) {
    throw new Error("ChurchTools returned a song with a missing ID, title, or arrangement list.");
  }
  const seen = new Set<string>();
  const arrangements = row.arrangements.map((value) => {
    const arrangement = object(value);
    const sourceId = positiveId(arrangement?.id);
    const name = string(arrangement?.name, 160);
    if (!arrangement || !sourceId || !name || seen.has(sourceId)) throw new Error("ChurchTools returned an invalid or duplicate song arrangement.");
    seen.add(sourceId);
    const bpm = arrangement.tempo ?? arrangement.bpm;
    const parsedBpm = typeof bpm === "string" && /^\d{1,3}$/.test(bpm) ? Number(bpm) : bpm;
    const beat = string(arrangement.beat, 20);
    return {
      sourceId, name,
      key: musicalKey(arrangement.key ?? arrangement.keyOfArrangement),
      isDefault: arrangement.isDefault === true,
      bpm: typeof parsedBpm === "number" && Number.isInteger(parsedBpm) && parsedBpm >= 1 && parsedBpm <= 400 ? parsedBpm : null,
      timeSignature: /^([1-9]|[1-5][0-9]|6[0-4])\/(1|2|4|8|16|32|64)$/.test(beat) ? beat : null,
    };
  });
  const preferences = arrangements.filter((item) => item.isDefault);
  const defaultArrangement = preferences.length === 1 ? preferences[0] : arrangements.length === 1 ? arrangements[0] : undefined;
  return {
    sourceId, title, authors: string(row.author, 500), arrangements,
    defaultKey: defaultArrangement?.key ?? "", bpm: defaultArrangement?.bpm ?? null,
    timeSignature: defaultArrangement?.timeSignature ?? null,
  };
}

export type ChurchToolsSong = ReturnType<typeof normalizeChurchToolsSong>;

export async function readChurchToolsSongCatalog(readPage: (page: number, limit: number) => Promise<unknown>) {
  const limit = 200;
  const songs = new Map<string, ChurchToolsSong>();
  let expectedLastPage: number | undefined;
  let expectedTotal: number | undefined;
  let arrangementCount = 0;
  for (let page = 1; page <= 100; page += 1) {
    const result = object(await readPage(page, limit));
    const pagination = object(object(result?.meta)?.pagination);
    const lastPage = pagination?.lastPage;
    const total = pagination?.total;
    if (!Array.isArray(result?.data) || pagination?.current !== page || typeof lastPage !== "number" || !Number.isInteger(lastPage)
      || lastPage < 0 || (lastPage < page && !(lastPage === 0 && page === 1 && result.data.length === 0))
      || (expectedLastPage !== undefined && lastPage !== expectedLastPage)
      || (total !== undefined && (typeof total !== "number" || !Number.isSafeInteger(total) || total < 0))
      || (expectedTotal !== undefined && total !== expectedTotal)
      || result.data.length > limit || (result.data.length === 0 && page < lastPage)) {
      throw new Error("ChurchTools returned inconsistent song catalog pagination. Run a fresh migration preview.");
    }
    if (lastPage > 100) throw new Error("ChurchTools returned more than 100 song catalog pages.");
    expectedLastPage = lastPage;
    expectedTotal = typeof total === "number" ? total : undefined;
    for (const row of result.data) {
      const song = normalizeChurchToolsSong(row);
      if (songs.has(song.sourceId)) throw new Error("ChurchTools repeated a song across catalog pages. Run a fresh migration preview.");
      songs.set(song.sourceId, song);
      arrangementCount += song.arrangements.length;
      if (arrangementCount > 20_000) throw new Error("ChurchTools returned more than 20,000 song arrangements.");
    }
    if (page >= lastPage) {
      if (expectedTotal !== undefined && expectedTotal !== songs.size) throw new Error("ChurchTools returned an incomplete song catalog.");
      return [...songs.values()];
    }
  }
  throw new Error("ChurchTools returned an incomplete song catalog.");
}

export const churchToolsSongCrosswalkId = (instanceUrl: string, sourceId: string) => `${instanceUrl}#${sourceId}`;

export async function importChurchToolsSong(db: Pick<PoolClient, "query">, departmentId: string, instanceUrl: string, song: ChurchToolsSong) {
  const configured = await db.query("SELECT 1 FROM churchtools_sync_settings WHERE department_id=$1 AND instance_url=$2 FOR SHARE", [departmentId, instanceUrl]);
  if (!configured.rowCount) throw new Error("ChurchTools connection changed after preview.");
  const crosswalk = churchToolsSongCrosswalkId(instanceUrl, song.sourceId);
  const existing = await db.query<{ id: string }>(`SELECT local.id FROM churchtools_migration_links link
    JOIN worship_songs local ON local.id=link.local_record_id AND local.department_id=link.department_id
    WHERE link.department_id=$1 AND link.area='song' AND link.source_id=$2 FOR UPDATE OF local`, [departmentId, crosswalk]);
  const match = existing.rows[0];
  let songId = match?.id;
  const fields = [song.title, song.authors, song.defaultKey, song.bpm, song.timeSignature];
  if (songId) {
    await db.query("UPDATE worship_songs SET title=$2,authors=$3,default_key=$4,bpm=$5,time_signature=$6,updated_at=now() WHERE id=$1", [songId, ...fields]);
  } else {
    const collision = await db.query(`SELECT 1 FROM worship_songs local
      WHERE local.department_id=$1 AND lower(local.title)=lower($2) AND lower(local.authors)=lower($3)
        AND NOT EXISTS (SELECT 1 FROM churchtools_migration_links link WHERE link.department_id=$1 AND link.area='song' AND link.local_record_id=local.id AND starts_with(link.source_id,$4))
      LIMIT 1`, [departmentId, song.title, song.authors, `${instanceUrl}#`]);
    if (collision.rowCount) return "skipped";
    const inserted = await db.query<{ id: string }>("INSERT INTO worship_songs (id,department_id,title,authors,default_key,bpm,time_signature) VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6) RETURNING id", [departmentId, ...fields]);
    songId = inserted.rows[0].id;
    await db.query(`INSERT INTO churchtools_migration_links (department_id,area,source_id,local_record_id) VALUES ($1,'song',$2,$3)
      ON CONFLICT (department_id,area,source_id) DO UPDATE SET local_record_id=EXCLUDED.local_record_id`, [departmentId, crosswalk, songId]);
  }
  const arrangements = await db.query<{ id: string; name: string; source_id: string | null }>(`SELECT local.id,local.name,link.source_id FROM worship_song_arrangements local
    LEFT JOIN churchtools_migration_links link ON link.department_id=$1 AND link.area='song_arrangement' AND link.local_record_id=local.id
    WHERE local.song_id=$2 FOR UPDATE OF local`, [departmentId, songId]);
  const linked = new Map(arrangements.rows.filter((row) => row.source_id).map((row) => [row.source_id, row.id]));
  const localNames = new Set(arrangements.rows.filter((row) => !row.source_id).map((row) => row.name.toLocaleLowerCase()));
  for (const arrangement of song.arrangements) {
    const arrangementCrosswalk = `${crosswalk}/${arrangement.sourceId}`;
    const arrangementId = linked.get(arrangementCrosswalk);
    if (arrangementId) {
      await db.query("UPDATE worship_song_arrangements SET name=$2,musical_key=$3,updated_at=now() WHERE id=$1", [arrangementId, arrangement.name, arrangement.key]);
    } else if (!localNames.has(arrangement.name.toLocaleLowerCase())) {
      const inserted = await db.query<{ id: string }>("INSERT INTO worship_song_arrangements (id,song_id,name,musical_key) VALUES (gen_random_uuid(),$1,$2,$3) RETURNING id", [songId, arrangement.name, arrangement.key]);
      await db.query(`INSERT INTO churchtools_migration_links (department_id,area,source_id,local_record_id) VALUES ($1,'song_arrangement',$2,$3)
        ON CONFLICT (department_id,area,source_id) DO UPDATE SET local_record_id=EXCLUDED.local_record_id`, [departmentId, arrangementCrosswalk, inserted.rows[0].id]);
    }
  }
  return match ? "updated" : "created";
}
