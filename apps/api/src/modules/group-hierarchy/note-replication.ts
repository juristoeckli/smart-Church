import type { PoolClient } from "pg";
import type { ModuleServerContext } from "../module-sdk.js";

type Note = {
  id: string;
  department_id: string;
  group_id: string;
  title: string;
  body: string;
  audience: "group_leaders" | "group_managers";
  created_by: string | null;
  archived_by: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

const columns = "id,department_id,group_id,title,body,audience,created_by,archived_by,created_at,updated_at,archived_at";
const fields = columns.split(",");
const maxRows = 50_000;
const maxBytes = 35 * 1024 * 1024;

function checkedNotes(input: unknown): Note[] {
  const snapshot = input as { version?: number; notes?: Note[] } | null;
  if (snapshot?.version !== 1 || !Array.isArray(snapshot.notes) || snapshot.notes.length > maxRows
    || snapshot.notes.some((row) => !row || !fields.every((field) => Object.hasOwn(row, field))
      || Object.keys(row).length !== fields.length || !["group_leaders", "group_managers"].includes(row.audience))
    || Buffer.byteLength(JSON.stringify(snapshot)) > maxBytes) {
    throw new Error("The group note snapshot is invalid or exceeds the supported size.");
  }
  return snapshot.notes;
}

async function readNotes(client: Pick<PoolClient, "query">, departmentId: string) {
  const result = await client.query<{ note: Note }>(`
    SELECT to_jsonb(records) AS note FROM (
      SELECT id,department_id,group_id,title,body,audience,created_by,archived_by,
             to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
             to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at,
             to_char(archived_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS archived_at
        FROM group_notes WHERE department_id=$1 ORDER BY id LIMIT $2
    ) records`, [departmentId, maxRows + 1]);
  return result.rows.map(({ note }) => note);
}

function remap(note: Note, departmentId: string, users: Map<string, string>): Note {
  return {
    ...note,
    department_id: departmentId,
    created_by: note.created_by ? users.get(note.created_by) ?? null : null,
    archived_by: note.archived_by ? users.get(note.archived_by) ?? null : null,
  };
}

export function registerGroupNotesReplication({ pool, isDatabaseReady, replication }: ModuleServerContext) {
  replication.register({
    schemaVersion: "1",
    async inspect(departmentId) {
      if (!pool || !isDatabaseReady()) return { ready: false, blockers: ["Group note storage is unavailable."], recordCount: 0 };
      try {
        const { rows: [size] } = await pool.query<{ count: number; bytes: string }>(
          "SELECT count(*)::int AS count,COALESCE(sum(octet_length(to_jsonb(note)::text)),0)::text AS bytes FROM group_notes note WHERE department_id=$1",
          [departmentId],
        );
        const ready = size.count <= maxRows && Number(size.bytes) <= maxBytes;
        return { ready, blockers: ready ? [] : ["Group notes exceed the replication snapshot limit."], recordCount: size.count };
      } catch {
        return { ready: false, blockers: ["Group note storage is unavailable."], recordCount: 0 };
      }
    },
    async exportSnapshot(client, departmentId) {
      const snapshot = { version: 1, notes: await readNotes(client, departmentId) };
      checkedNotes(snapshot);
      return snapshot;
    },
    async prepareRestore(client, departmentId, input) {
      if (input !== undefined) {
        checkedNotes(input);
        await client.query("DELETE FROM group_notes WHERE department_id=$1", [departmentId]);
        return;
      }
      const existing = await client.query("SELECT 1 FROM group_notes WHERE department_id=$1 LIMIT 1", [departmentId]);
      if (existing.rowCount) throw new Error("The source snapshot omits group notes already present at the standby location.");
    },
    async restoreSnapshot(client, departmentId, input, { userIdMap }) {
      const notes = checkedNotes(input);
      for (let first = 0; first < notes.length; first += 250) {
        const batch = notes.slice(first, first + 250).map((note) => remap(note, departmentId, userIdMap));
        const inserted = await client.query(`
          INSERT INTO group_notes (${columns})
          SELECT ${fields.map((field) => `note.${field}`).join(",")}
            FROM jsonb_populate_recordset(NULL::group_notes,$1::jsonb) note
            JOIN church_groups parent ON parent.id=note.group_id AND parent.department_id=$2
        `, [JSON.stringify(batch), departmentId]);
        if (inserted.rowCount !== batch.length) throw new Error("A group note refers to a group outside the restored location.");
      }
      return { recordCount: notes.length };
    },
    async verifySnapshot(client, departmentId, input, context) {
      const expected = checkedNotes(input)
        .map((note) => remap(note, departmentId, context?.userIdMap ?? new Map()))
        .sort((left, right) => left.id.localeCompare(right.id));
      const actual = await readNotes(client, departmentId);
      const ready = expected.length === actual.length && expected.every((note, index) =>
        fields.every((field) => note[field as keyof Note] === actual[index][field as keyof Note]));
      return { ready, blockers: ready ? [] : ["Group notes differ from the source snapshot after restore."] };
    },
  });
}
