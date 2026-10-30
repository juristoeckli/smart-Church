import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import type { PoolClient } from "pg";
import type { ModuleServerContext } from "../module-sdk.js";

type Column = { table_name: string; column_name: string; data_type: string; ordinal_position: number };
type Table = { name: string; columns: Column[]; binaryColumns: string[] };
type SnapshotTable = { name: string; columns: string[]; binaryColumns: string[]; rows: Array<Record<string, unknown>> };
type Snapshot = { version: 1; tables: SnapshotTable[] };
const maxSnapshotBytes = 200 * 1024 * 1024;

function q(identifier: string) {
  if (!/^[a-z][a-z0-9_]*$/.test(identifier)) throw new Error("The sync module returned an unsafe SQL identifier.");
  return `"${identifier}"`;
}

function cryptoKey(purpose: "churchtools" | "elvanto") {
  const source = process.env.SMART_CHURCH_SYNC_ENCRYPTION_KEY?.trim() || process.env.DATABASE_URL?.trim() || "";
  return source ? scryptSync(source, `smart-church/${purpose === "churchtools" ? "churchtools-sync" : "elvanto-sync"}/v1`, 32) : null;
}

function decrypt(value: string, purpose: "churchtools" | "elvanto"): string {
  const key = cryptoKey(purpose);
  if (!key) throw new Error("The local integration credential encryption key is unavailable.");
  const [version, iv, tag, data] = value.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("A saved integration credential has an unsupported encryption format.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

function encrypt(value: string, purpose: "churchtools" | "elvanto") {
  const key = cryptoKey(purpose);
  if (!key) throw new Error("Configure the local integration credential encryption key before restoring credentials.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

function credentialPurpose(column: string): "churchtools" | "elvanto" | null {
  if (column === "encrypted_login_token" || column === "encrypted_snapshot") return "churchtools";
  if (column === "encrypted_api_key" || column === "encrypted_payload") return "elvanto";
  return null;
}

function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Buffer.isBuffer(value)) return JSON.stringify(value.toString("base64"));
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value as Record<string, unknown>).sort().map((key) => JSON.stringify(key) + ":" + canonical((value as Record<string, unknown>)[key])).join(",") + "}";
  return JSON.stringify(value);
}

async function discoverTables(client: Pick<PoolClient, "query">): Promise<Table[]> {
  const result = await client.query<Column>(`SELECT table_name,column_name,data_type,ordinal_position FROM information_schema.columns
    WHERE table_schema='public' AND (table_name='churchtools_sync_settings' OR left(table_name,8)='elvanto_' OR left(table_name,22)='churchtools_migration_')
    ORDER BY table_name,ordinal_position`);
  const byName = new Map<string, Column[]>();
  for (const column of result.rows) byName.set(column.table_name, [...(byName.get(column.table_name) ?? []), column]);
  return [...byName].map(([name, columns]) => ({ name, columns, binaryColumns: columns.filter((column) => column.data_type === "bytea").map((column) => column.column_name) }));
}

async function orderedTables(client: Pick<PoolClient, "query">, tables: Table[]) {
  const names = new Set(tables.map((table) => table.name));
  const refs = await client.query<{ child: string; parent: string }>(`SELECT child.relname AS child,parent.relname AS parent FROM pg_constraint fk
    JOIN pg_class child ON child.oid=fk.conrelid JOIN pg_namespace ns ON ns.oid=child.relnamespace
    JOIN pg_class parent ON parent.oid=fk.confrelid WHERE fk.contype='f' AND ns.nspname='public'`);
  const dependencies = new Map([...names].map((name) => [name, new Set<string>()]));
  for (const ref of refs.rows) if (names.has(ref.child) && names.has(ref.parent) && ref.child !== ref.parent) dependencies.get(ref.child)!.add(ref.parent);
  const order: string[] = [];
  const pending = new Set(names);
  while (pending.size) {
    const ready = [...pending].filter((name) => [...dependencies.get(name)!].every((parent) => !pending.has(parent))).sort();
    if (!ready.length) throw new Error("The integration tables have cyclic foreign keys; safe replication is unavailable.");
    for (const name of ready) { order.push(name); pending.delete(name); }
  }
  return order;
}

async function collect(client: PoolClient, departmentId: string): Promise<Snapshot> {
  const tables = await discoverTables(client);
  const snapshots: SnapshotTable[] = [];
  for (const name of await orderedTables(client, tables)) {
    const table = tables.find((item) => item.name === name)!;
    const columns = table.columns.map((column) => column.column_name);
    const selection = columns.map((column) => table.binaryColumns.includes(column) ? `encode(${q(column)},'base64') AS ${q(column)}` : q(column));
    const result = await client.query(`SELECT ${selection.join(",")} FROM ${q(name)} WHERE department_id=$1`, [departmentId]);
    const rows = result.rows as Array<Record<string, unknown>>;
    rows.sort((left, right) => canonical(left).localeCompare(canonical(right)));
    snapshots.push({ name, columns, binaryColumns: table.binaryColumns, rows });
  }
  return { version: 1, tables: snapshots };
}

async function inspect(client: PoolClient, departmentId: string) {
  const tables = await discoverTables(client);
  const blockers: string[] = [];
  if (!tables.some((table) => table.name === "churchtools_sync_settings") || !tables.some((table) => table.name === "elvanto_sync_settings")) blockers.push("ChurchTools and Elvanto settings storage has not been initialized.");
  const unscoped = tables.filter((table) => !table.columns.some((column) => column.column_name === "department_id"));
  if (unscoped.length) blockers.push("Integration tables are not location-scoped: " + unscoped.map((table) => table.name).join(", ") + ".");
  let records = 0;
  let bytes = 0;
  for (const table of tables) {
    if (!table.columns.some((column) => column.column_name === "department_id")) continue;
    const result = await client.query<{ count: string; bytes: string }>(`SELECT count(*)::text AS count,COALESCE(sum(pg_column_size(row_data)),0)::text AS bytes FROM (SELECT row_data FROM (SELECT t AS row_data FROM ${q(table.name)} t WHERE department_id=$1) scoped) sized`, [departmentId]);
    records += Number(result.rows[0].count);
    bytes += Number(result.rows[0].bytes);
  }
  if (bytes > maxSnapshotBytes) blockers.push("Integration settings and imported records exceed the 200 MiB snapshot limit.");
  for (const table of tables) {
    for (const column of table.columns.filter((item) => credentialPurpose(item.column_name))) {
      const rows = await client.query<{ value: string }>(`SELECT ${q(column.column_name)} AS value FROM ${q(table.name)} WHERE department_id=$1 AND ${q(column.column_name)} IS NOT NULL AND ${q(column.column_name)}<>''`, [departmentId]);
      const purpose = credentialPurpose(column.column_name)!;
      if (rows.rowCount && !cryptoKey(purpose)) {
        blockers.push("The local integration credential encryption key is unavailable; configure it before replicating saved credentials.");
        continue;
      }
      for (const row of rows.rows) {
        try { decrypt(row.value, purpose); }
        catch (error) { blockers.push(error instanceof Error ? error.message : "A saved integration credential cannot be decrypted."); break; }
      }
    }
  }
  return { tables, blockers, records, bytes };
}

export function registerChurchToolsSyncReplication(context: ModuleServerContext) {
  const { pool, isDatabaseReady } = context;
  context.replication.register({
    schemaVersion: "2",
    getSchemaVersion: async () => {
      if (!pool || !isDatabaseReady()) return "2:unavailable";
      const tables = await discoverTables(pool);
      const shape = tables.map((table) => [table.name, table.columns.map((column) => [column.column_name, column.data_type])]);
      return `2:${createHash("sha256").update(JSON.stringify(shape)).digest("hex")}`;
    },
    inspect: async (departmentId) => {
      if (!pool || !isDatabaseReady()) return { ready: false, blockers: ["Sync integration database is unavailable."], recordCount: 0 };
      try {
        const client = await pool.connect();
        try {
          await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
          const result = await inspect(client, departmentId);
          await client.query("COMMIT");
          return { ready: !result.blockers.length, blockers: result.blockers, recordCount: result.records };
        } catch (error) { await client.query("ROLLBACK"); throw error; }
        finally { client.release(); }
      } catch (error) { return { ready: false, blockers: [error instanceof Error ? error.message.slice(0, 240) : "Integration readiness could not be checked."], recordCount: 0 }; }
    },
    exportSnapshot: (client, departmentId) => collect(client, departmentId),
    prepareSnapshotForPeer: async (input, sealForPeer) => {
      const snapshot = structuredClone(input) as Snapshot & { credentialTransferVersion?: number };
      for (const table of snapshot.tables) for (const row of table.rows) for (const column of Object.keys(row)) {
        const purpose = credentialPurpose(column);
        const value = row[column];
        if (!purpose || typeof value !== "string" || !value) continue;
        row[column] = { sealedCredential: sealForPeer(decrypt(value, purpose)) };
      }
      snapshot.credentialTransferVersion = 1;
      return snapshot;
    },
    restoreSnapshotFromPeer: async (input, openForLocal) => {
      const snapshot = input as Snapshot & { credentialTransferVersion?: number };
      if (snapshot.credentialTransferVersion !== 1) return input;
      const restored = structuredClone(snapshot) as Snapshot & { credentialTransferVersion?: number };
      for (const table of restored.tables) for (const row of table.rows) for (const column of Object.keys(row)) {
        const purpose = credentialPurpose(column);
        const value = row[column];
        if (!purpose) continue;
        if (value && typeof value === "object" && "sealedCredential" in value && typeof value.sealedCredential === "string") row[column] = encrypt(openForLocal(value.sealedCredential), purpose);
        else if (typeof value === "string" && value) throw new Error("A ChurchTools or Elvanto credential was not protected for this standby server.");
      }
      return restored;
    },
    restoreSnapshot: async (client, departmentId, input) => {
      const snapshot = input as Snapshot;
      if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.tables) || snapshot.tables.length > 300) throw new Error("The integration snapshot is invalid or exceeds the supported limits.");
      const localTables = await discoverTables(client);
      const localByName = new Map(localTables.map((table) => [table.name, table]));
      if (new Set(snapshot.tables.map((table) => table.name)).size !== snapshot.tables.length || snapshot.tables.length !== localTables.length) throw new Error("ChurchTools or Elvanto table inventory differs between servers.");
      for (const incoming of snapshot.tables) {
        const local = localByName.get(incoming.name);
        if (!local || JSON.stringify(incoming.columns) !== JSON.stringify(local.columns.map((column) => column.column_name)) || JSON.stringify(incoming.binaryColumns) !== JSON.stringify(local.binaryColumns)) throw new Error(`The integration schema differs for ${incoming.name}.`);
      }
      const order = await orderedTables(client, localTables);
      for (const name of [...order].reverse()) await client.query(`DELETE FROM ${q(name)} WHERE department_id=$1`, [departmentId]);
      let records = 0;
      for (const name of order) {
        const table = snapshot.tables.find((item) => item.name === name)!;
        for (const row of table.rows) {
          for (const column of ["encrypted_login_token", "encrypted_api_key", "encrypted_payload", "encrypted_snapshot"]) {
            const value = row[column];
            if (typeof value === "string" && value) {
              const purpose = credentialPurpose(column)!;
              decrypt(value, purpose);
            }
          }
          const values: Record<string, unknown> = { ...row, department_id: departmentId };
          for (const column of table.binaryColumns) if (typeof values[column] === "string") values[column] = Buffer.from(values[column] as string, "base64");
          await client.query(`INSERT INTO ${q(name)}(${table.columns.map(q).join(",")}) VALUES(${table.columns.map((_, index) => "$" + (index + 1)).join(",")})`, table.columns.map((column) => values[column]));
          records += 1;
        }
      }
      return { recordCount: records };
    },
    verifySnapshot: async (client, departmentId, input) => {
      const expected = input as Snapshot;
      if (!expected || expected.version !== 1 || !Array.isArray(expected.tables)) return { ready: false, blockers: ["No supported sync integration snapshot is available."] };
      const actual = await collect(client, departmentId);
      if (actual.tables.length !== expected.tables.length) return { ready: false, blockers: ["ChurchTools or Elvanto table inventory changed during restore."] };
      for (let index = 0; index < actual.tables.length; index += 1) {
        const actualTable = actual.tables[index];
        const expectedTable = expected.tables.find((table) => table.name === actualTable.name);
        if (!expectedTable || canonical(actualTable) !== canonical({ ...expectedTable, rows: [...expectedTable.rows].sort((left, right) => canonical(left).localeCompare(canonical(right))) })) return { ready: false, blockers: [`Integration data verification failed for ${actualTable.name}.`] };
      }
      return { ready: true, blockers: [] };
    },
  });
}
