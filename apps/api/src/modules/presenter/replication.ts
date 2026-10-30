import type { PoolClient } from "pg";
import type { ModuleServerContext, ReplicationRestoreContext } from "../module-sdk.js";
import { datasetArchive, listDatasets, replaceDatasetArchives } from "./datasets.js";
import { listPresenterMedia, readPresenterMedia, replacePresenterMedia, type PresenterMedia } from "./media.js";

type PresenterSession = { session_id: string; display_name: string; token_hash: string | null; previous_token_hash: string | null; output_token: string | null; state: Record<string, unknown>; updated_at: Date | string };
type DatasetFile = { id: string; archive: string };
type MediaFile = { item: PresenterMedia; data: string };
type Snapshot = { version: 1; sessions: PresenterSession[]; datasets: DatasetFile[]; media: MediaFile[] };
const maxBytes = 200 * 1024 * 1024;

async function streamBuffer(stream: AsyncIterable<Buffer | string>) {
  const parts: Buffer[] = [];
  for await (const part of stream) parts.push(Buffer.isBuffer(part) ? part : Buffer.from(part));
  return Buffer.concat(parts);
}

async function collect(client: Pick<PoolClient, "query">, departmentId: string): Promise<Snapshot> {
  const sessions = await client.query<PresenterSession>(`SELECT session_id,display_name,token_hash,previous_token_hash,output_token,state,updated_at
    FROM presenter_output_sessions WHERE department_id=$1 ORDER BY session_id`, [departmentId]);
  const datasets: DatasetFile[] = [];
  for (const dataset of await listDatasets()) {
    const archive = await datasetArchive(dataset.id);
    if (!archive) throw new Error(`Presenter dataset ${dataset.id} could not be archived.`);
    datasets.push({ id: dataset.id, archive: (await streamBuffer(archive.stream)).toString("base64") });
  }
  datasets.sort((left, right) => left.id.localeCompare(right.id));
  const media: MediaFile[] = [];
  for (const item of await listPresenterMedia(departmentId)) {
    const read = await readPresenterMedia(departmentId, item.id);
    if (!read) throw new Error(`Presenter media ${item.id} could not be read.`);
    media.push({ item: read.item, data: read.file.toString("base64") });
  }
  media.sort((left, right) => left.item.id.localeCompare(right.item.id));
  return { version: 1, sessions: sessions.rows, datasets, media };
}

export function registerPresenterReplication(context: ModuleServerContext) {
  const { pool, isDatabaseReady } = context;
  context.replication.register({
    schemaVersion: "1",
    inspect: async (departmentId) => {
      if (!pool || !isDatabaseReady()) return { ready: false, blockers: ["Presenter database is unavailable."], recordCount: 0 };
      try {
        const snapshot = await collect(pool, departmentId);
        const bytes = Buffer.byteLength(JSON.stringify(snapshot));
        const otherPresenterSites = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM departments department
          LEFT JOIN installation_modules module ON module.installation_id=department.installation_id AND module.module_id='presenter'
          WHERE department.id<>$1 AND ('presenter'=ANY(department.enabled_modules) OR module.enabled=TRUE AND (module.required=TRUE OR module.client_managed=FALSE))`, [departmentId]);
        const blockers = bytes > maxBytes ? ["Presenter datasets and media exceed the 200 MiB snapshot limit; split the media library or reduce its size before enabling redundancy."] : [];
        if (Number(otherPresenterSites.rows[0]?.count ?? 0) > 0) blockers.push("Presenter datasets are installation-wide and would replace data used by another Presenter location. Make Presenter datasets location-scoped before enabling redundancy for multiple locations.");
        return { ready: !blockers.length, blockers, recordCount: snapshot.sessions.length + snapshot.datasets.length + snapshot.media.length };
      } catch (error) { return { ready: false, blockers: [error instanceof Error ? error.message.slice(0, 240) : "Presenter recovery inventory could not be read."], recordCount: 0 }; }
    },
    exportSnapshot: (client, departmentId) => collect(client, departmentId),
    restoreSnapshot: async (client, departmentId, input, restoreContext: ReplicationRestoreContext) => {
      const snapshot = input as Snapshot;
      if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.sessions) || snapshot.sessions.length > 11 || !Array.isArray(snapshot.datasets) || snapshot.datasets.length > 500 || !Array.isArray(snapshot.media) || snapshot.media.length > 5000) throw new Error("The Presenter snapshot is invalid or exceeds supported limits.");
      const datasetRestore = await replaceDatasetArchives(snapshot.datasets.map((dataset) => ({ id: dataset.id, archive: Buffer.from(dataset.archive, "base64") })));
      let mediaRestore: Awaited<ReturnType<typeof replacePresenterMedia>>;
      try { mediaRestore = await replacePresenterMedia(departmentId, snapshot.media.map((file) => ({ item: file.item, data: Buffer.from(file.data, "base64") }))); }
      catch (error) { await datasetRestore.rollback(); throw error; }
      restoreContext.onRollback(async () => { await mediaRestore.rollback(); await datasetRestore.rollback(); });
      restoreContext.onCommit(async () => { await mediaRestore.commit(); await datasetRestore.commit(); });
      await client.query("DELETE FROM presenter_output_sessions WHERE department_id=$1", [departmentId]);
      for (const session of snapshot.sessions) await client.query(`INSERT INTO presenter_output_sessions
        (department_id,session_id,display_name,token_hash,previous_token_hash,output_token,last_seen_at,state,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,NULL,$7::jsonb,$8)`, [departmentId, session.session_id, session.display_name, session.token_hash, session.previous_token_hash, session.output_token, JSON.stringify(session.state), session.updated_at]);
      return { recordCount: snapshot.sessions.length + snapshot.datasets.length + snapshot.media.length };
    },
    verifySnapshot: async (client, departmentId, input) => {
      const expected = input as Snapshot;
      if (!expected || expected.version !== 1 || !Array.isArray(expected.sessions) || !Array.isArray(expected.datasets) || !Array.isArray(expected.media)) return { ready: false, blockers: ["No supported Presenter snapshot is available."] };
      const actual = await collect(client, departmentId);
      return JSON.stringify(actual) === JSON.stringify(expected)
        ? { ready: true, blockers: [] }
        : { ready: false, blockers: ["Presenter sessions, datasets, or media differ from the verified snapshot."] };
    },
  });
}
