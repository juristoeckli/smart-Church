import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import type { ModuleServerContext, ReplicationRestoreContext } from "../module-sdk.js";
import { isPortraitPng } from "./portrait-png.js";

const tables = {
  fields: { name: "people_record_fields", key: "id", columns: "id label field_key field_type options required active position created_at updated_at visibility tag_color category text_max_length show_on_create" },
  relationshipTypes: { name: "people_record_relationship_types", key: "id", columns: "id label reverse_label active created_by updated_at visibility historical_actor_id historical_actor_name" },
  households: { name: "people_record_households", key: "id", columns: "id label salutation postal_address created_at updated_at" },
  values: { name: "people_record_values", key: "contact_id,field_id", columns: "contact_id field_id value updated_by updated_at historical_actor_id historical_actor_name" },
  relationships: { name: "people_record_relationships", key: "id", columns: "id person_id related_person_id relationship created_by created_at relationship_type_id historical_actor_id historical_actor_name" },
  consents: { name: "people_record_consents", key: "id", columns: "id contact_id purpose status captured_at expires_at notes actor_user_id created_at source historical_actor_id historical_actor_name" },
  history: { name: "people_record_history", key: "id", columns: "id contact_id actor_user_id action subject before_value after_value created_at managers_only historical_actor_id historical_actor_name" },
  imports: { name: "people_record_import_audits", key: "id", columns: "id actor_user_id selected_count created_count skipped_count outcomes created_at historical_actor_id historical_actor_name" },
  dates: { name: "people_record_person_dates", key: "contact_id,date_kind", columns: "contact_id date_kind date_value updated_by updated_at historical_actor_id historical_actor_name" },
  merges: { name: "people_record_merges", key: "id", columns: "id keeper_contact_id merged_contact_id actor_user_id source_snapshot profile_conflicts_confirmed created_at historical_actor_id historical_actor_name" },
  views: { name: "people_record_saved_views", key: "id", columns: "id user_id name criteria created_at updated_at" },
  attachments: { name: "people_record_attachments", key: "id", columns: "id contact_id file_name file_size file_data uploaded_by created_at is_portrait managers_only historical_actor_id historical_actor_name" },
  householdMembers: { name: "people_record_household_members", key: "contact_id", columns: "contact_id household_id added_at" },
  notes: { name: "people_record_private_notes", key: "id", columns: "id contact_id body revision created_at created_by edited_at edited_by archived_at archived_by created_actor_id created_actor_name edited_actor_id edited_actor_name archived_actor_id archived_actor_name" },
  growth: { name: "people_growth_config", key: "department_id", columns: "revision steps mappings visibility" },
  followups: { name: "people_personal_followups", key: "id", columns: "id contact_id owner_user_id title details due_on revision completed_at" },
} satisfies Record<string, { name: string; columns: string; key: string }>;
type Table = keyof typeof tables;
type Row = Record<string, unknown>;
type Snapshot = { version: 1 } & Record<Table, Row[]>;
const keys = Object.keys(tables) as Table[];
const dateColumns = new Set(["expires_at", "date_value", "due_on"]);
const jsonColumns = new Set(["options", "postal_address", "value", "before_value", "after_value", "outcomes", "source_snapshot", "criteria", "steps", "mappings"]);
const userColumns = new Set(["owner_user_id", "user_id", "created_by", "updated_by", "actor_user_id", "uploaded_by", "edited_by", "archived_by"]);
const maxSnapshotBytes = 64 * 1024 * 1024;
const maxAttachmentBytes = 10 * 1024 * 1024;
const maxRecords = 100_000;
const envelopeContext = Buffer.from("smart-church/people-records-standby/v1");
const inactiveOwner = "People Records has saved views or follow-ups belonging to accounts outside this location.";
const overLimit = "People Records exceed the standby snapshot size or record limit.";

function record(value: unknown): value is Row {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readSnapshot(input: unknown): Snapshot {
  if (!record(input) || input.version !== 1) throw new Error("The People Records snapshot is invalid.");
  for (const key of keys) {
    const columns = tables[key].columns.split(" ");
    const rows = input[key];
    if (!Array.isArray(rows) || !rows.every((row) => record(row) &&
      Object.keys(row).length === columns.length && columns.every((column) => Object.hasOwn(row, column)))) {
      throw new Error(`People Records snapshot rows for ${key} are invalid.`);
    }
  }
  if (keys.reduce((total, key) => total + (input[key] as Row[]).length, 0) > maxRecords) throw new Error(overLimit);
  return input as Snapshot;
}


async function readiness(client: Pick<PoolClient, "query">, departmentId: string) {
  const result = await client.query<{ count: string; bytes: string; orphan_owner: boolean }>(`WITH totals AS (
    ${keys.map((key) => `SELECT count(*) AS records,COALESCE(sum(${key === "attachments" ? "file_size * 2 + 512" : "octet_length(row_to_json(item)::text)"}),0) AS bytes
      FROM ${tables[key].name} item WHERE department_id=$1`).join(" UNION ALL ")}
  ) SELECT sum(records)::text AS count,sum(bytes)::text AS bytes,
    EXISTS(SELECT 1 FROM people_record_saved_views item WHERE item.department_id=$1
      AND NOT EXISTS(SELECT 1 FROM department_memberships member WHERE member.department_id=$1 AND member.user_id=item.user_id))
    OR EXISTS(SELECT 1 FROM people_personal_followups item WHERE item.department_id=$1
      AND NOT EXISTS(SELECT 1 FROM department_memberships member WHERE member.department_id=$1 AND member.user_id=item.owner_user_id)) AS orphan_owner
    FROM totals`, [departmentId]);
  const row = result.rows[0];
  const blockers: string[] = [];
  if (row.orphan_owner) blockers.push(inactiveOwner);
  if (Number(row.count) > maxRecords || Number(row.bytes) > maxSnapshotBytes) blockers.push(overLimit);
  return { blockers, recordCount: Number(row.count) };
}

function assertDependencies(snapshot: Snapshot, core: unknown) {
  if (!record(core) || !record(core.tables)) throw new Error("People Records standby requires a corresponding Core snapshot.");
  const ids = (name: string, key = "id") => {
    const rows = (core.tables as Row)[name];
    return new Set(Array.isArray(rows) ? rows.filter(record).map((row) => row[key]) : []);
  };
  const people = ids("contacts");
  const members = ids("department_memberships", "user_id");
  const fields = new Set(snapshot.fields.map((row) => row.id));
  const types = new Set(snapshot.relationshipTypes.map((row) => row.id));
  const households = new Set(snapshot.households.map((row) => row.id));
  const contactTables = ["values", "consents", "history", "dates", "attachments", "householdMembers", "notes", "followups"] as const;
  if (contactTables.some((key) => snapshot[key].some((row) => !people.has(row.contact_id))) ||
      snapshot.relationships.some((row) => !people.has(row.person_id) || !people.has(row.related_person_id)) ||
      snapshot.merges.some((row) => !people.has(row.keeper_contact_id))) {
    throw new Error("A People Records snapshot refers to a missing or out-of-location contact.");
  }
  if (snapshot.values.some((row) => !fields.has(row.field_id)) ||
      snapshot.relationships.some((row) => row.relationship_type_id !== null && !types.has(row.relationship_type_id)) ||
      snapshot.householdMembers.some((row) => !households.has(row.household_id))) {
    throw new Error("A People Records snapshot refers to a missing field, relationship type or household.");
  }
  if (snapshot.views.some((row) => !members.has(row.user_id)) || snapshot.followups.some((row) => !members.has(row.owner_user_id))) throw new Error(inactiveOwner);
  for (const file of snapshot.attachments) {
    if (typeof file.file_size !== "number" || !Number.isInteger(file.file_size) || file.file_size < 1 || file.file_size > maxAttachmentBytes ||
        typeof file.managers_only !== "boolean" || typeof file.is_portrait !== "boolean" ||
        typeof file.file_data !== "string" || file.file_data.length !== Math.ceil(file.file_size / 3) * 4) {
      throw new Error("A People Records attachment has invalid binary or access metadata.");
    }
    const bytes = Buffer.from(file.file_data, "base64");
    if (bytes.length !== file.file_size || bytes.toString("base64") !== file.file_data || (file.is_portrait && !isPortraitPng(bytes))) {
      throw new Error("A People Records attachment or portrait is damaged.");
    }
  }
}

async function collect(client: Pick<PoolClient, "query">, departmentId: string): Promise<Snapshot> {
  const snapshot = { version: 1 } as Snapshot;
  for (const key of keys) {
    const table = tables[key];
    const columns = table.columns.split(" ").map((column) => {
      if (dateColumns.has(column)) return `to_char(item.${column},'YYYY-MM-DD') AS ${column}`;
      if (column === "file_data") return "replace(encode(item.file_data,'base64'),chr(10),'') AS file_data";
      return `item.${column}`;
    }).join(",");
    const order = table.key.split(",").map((column) => `item.${column}`).join(",");
    snapshot[key] = (await client.query(`SELECT ${columns} FROM ${table.name} item WHERE item.department_id=$1 ORDER BY ${order}`, [departmentId])).rows;
  }
  return snapshot;
}

function mappedRow(row: Row, context: ReplicationRestoreContext) {
  return Object.fromEntries(Object.entries(row).map(([column, value]) => [
    column, userColumns.has(column) && value != null ? context.userIdMap.get(String(value)) ?? null : value,
  ]));
}

async function insert(client: PoolClient, departmentId: string, key: Table, rows: Row[], context: ReplicationRestoreContext) {
  const table = tables[key];
  const columns = table.columns.split(" ");
  columns.unshift("department_id");
  const sql = `INSERT INTO ${table.name}(${columns.join(",")}) VALUES(${columns.map((_, index) => "$" + (index + 1)).join(",")})`;
  for (const source of rows) {
    const row = { ...mappedRow(source, context), department_id: departmentId };
    const result = await client.query(sql, columns.map((column) => {
      const value = (row as Row)[column];
      if (column === "file_data") return Buffer.from(String(value), "base64");
      return jsonColumns.has(column) && value != null ? JSON.stringify(value) : value;
    }));
    if (result.rowCount !== 1) throw new Error("A People Records snapshot record could not be restored.");
  }
}

function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (record(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

export function registerPeopleRecordsReplication(context: ModuleServerContext) {
  const { pool, isDatabaseReady } = context;
  context.replication.register({
    schemaVersion: "8",
    async requiresSnapshot(departmentId) {
      if (!pool || !isDatabaseReady()) return false;
      return Boolean((await readiness(pool, departmentId)).recordCount);
    },
    async inspect(departmentId) {
      if (!pool || !isDatabaseReady()) return { ready: false, blockers: ["The People Records database is unavailable."], recordCount: 0 };
      const status = await readiness(pool, departmentId);
      return { ready: status.blockers.length === 0, ...status };
    },
    async exportSnapshot(client, departmentId) {
      const { blockers } = await readiness(client, departmentId);
      if (blockers.length) throw new Error(blockers.join(" "));
      const snapshot = await collect(client, departmentId);
      if (Buffer.byteLength(JSON.stringify(snapshot)) > maxSnapshotBytes) throw new Error(overLimit);
      return snapshot;
    },
    prepareSnapshotForPeer: async (input, seal) => {
      const plain = Buffer.from(JSON.stringify(readSnapshot(input)), "utf8");
      if (plain.length > maxSnapshotBytes) throw new Error(overLimit);
      const key = randomBytes(32), iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(envelopeContext);
      const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
      return { version: 1, sealedKey: seal(key.toString("base64")), iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"), ciphertext: encrypted.toString("base64") };
    },
    restoreSnapshotFromPeer: async (input, open) => {
      if (!record(input) || input.version !== 1 || typeof input.sealedKey !== "string" || input.sealedKey.length > 65536 ||
          typeof input.iv !== "string" || input.iv.length !== 16 || typeof input.tag !== "string" || input.tag.length !== 24 ||
          typeof input.ciphertext !== "string" || input.ciphertext.length > Math.ceil(maxSnapshotBytes / 3) * 4) {
        throw new Error("The People Records snapshot must be protected for this standby.");
      }
      const key = Buffer.from(open(input.sealedKey), "base64");
      if (key.length !== 32) throw new Error("The People Records snapshot key is invalid.");
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(input.iv, "base64"));
      decipher.setAAD(envelopeContext);
      decipher.setAuthTag(Buffer.from(input.tag, "base64"));
      const plain = Buffer.concat([decipher.update(Buffer.from(input.ciphertext, "base64")), decipher.final()]);
      if (plain.length > maxSnapshotBytes) throw new Error(overLimit);
      return readSnapshot(JSON.parse(plain.toString("utf8")));
    },
    restoreDependencies: {
      moduleIds: ["core-site"],
      validate(input, dependencies) { assertDependencies(readSnapshot(input), dependencies.get("core-site")); },
    },
    async validateRestoreTarget(client, departmentId, input) {
      if (input === undefined && (await readiness(client, departmentId)).recordCount) {
        throw new Error("The incoming standby snapshot omits existing People Records data.");
      }
    },
    async prepareRestore(client, departmentId, input) {
      if (input === undefined) return;
      // Delete children before the owning lookup tables and before Core contacts.
      for (const key of [...keys].reverse()) {
        await client.query(`DELETE FROM ${tables[key].name} WHERE department_id=$1`, [departmentId]);
      }
    },
    async restoreSnapshot(client, departmentId, input, restoreContext) {
      const snapshot = readSnapshot(input);
      const owners = [...new Set([...snapshot.views.map((row) => row.user_id), ...snapshot.followups.map((row) => row.owner_user_id)])];
      const mappedOwners = owners.map((id) => restoreContext.userIdMap.get(String(id)));
      if (mappedOwners.some((id) => !id) || new Set(mappedOwners).size !== owners.length) throw new Error(inactiveOwner);
      const memberships = await client.query("SELECT user_id FROM department_memberships WHERE department_id=$1 AND user_id=ANY($2::uuid[])", [departmentId, mappedOwners]);
      if (memberships.rows.length !== owners.length) throw new Error(inactiveOwner);
      for (const key of keys) await insert(client, departmentId, key, snapshot[key], restoreContext);
      return { recordCount: keys.reduce((sum, key) => sum + snapshot[key].length, 0) };
    },
    async verifySnapshot(client, departmentId, input, restoreContext) {
      const snapshot = readSnapshot(input);
      const actual = await collect(client, departmentId);
      for (const key of keys) {
        const rows = restoreContext ? snapshot[key].map((row) => mappedRow(row, restoreContext)) : snapshot[key];
        const signature = (items: Row[]) => items.map((row) => JSON.stringify(canonical(row))).sort();
        if (JSON.stringify(signature(rows)) !== JSON.stringify(signature(actual[key]))) {
          return { ready: false, blockers: [`People Records ${key} differs from the signed snapshot.`] };
        }
      }
      return { ready: true, blockers: [] };
    },
  });
}
