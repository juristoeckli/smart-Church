import type { PoolClient } from "pg";
import type { ModuleServerContext, ReplicationRestoreContext } from "../module-sdk.js";
import { isSnapshotRow, isSnapshotUuid, validateStoredWikiAttachmentEvidence } from "./replication-access.js";

const tables = {
  categories: { name: "wiki_categories", columns: "id name parent_id position archived_at created_by updated_by created_at updated_at created_actor_id created_actor_name updated_actor_id updated_actor_name" },
  pages: { name: "wiki_pages", columns: "id category_id title content_html status redirect_url redirect_page_id is_homepage audience audience_group_id created_by updated_by created_at updated_at created_actor_id created_actor_name updated_actor_id updated_actor_name" },
  versions: { name: "wiki_page_versions", columns: "id page_id title content_html editor_user_id created_at audience_change category_change redirect_change editor_actor_id editor_actor_name" },
  links: { name: "wiki_page_links", columns: "id page_id title url created_by created_at managers_only creator_actor_id creator_actor_name" },
  attachments: { name: "wiki_page_files", columns: "page_id file_id added_by created_at display_title managers_only uploader_actor_id uploader_actor_name" },
} as const;
type Table = keyof typeof tables;
type Row = Record<string, unknown>;
type Snapshot = { version: 1 } & Record<Table, Row[]>;
const tableKeys = Object.keys(tables) as Table[];
const accountColumns = new Set(["created_by", "updated_by", "editor_user_id", "added_by"]);
const jsonColumns = new Set(["audience_change", "category_change", "redirect_change"]);

function readWikiSnapshot(input: unknown): Snapshot {
  if (!isSnapshotRow(input) || input.version !== 1) throw new Error("The Wiki snapshot is invalid.");
  for (const table of tableKeys) {
    const rows = input[table];
    if (!Array.isArray(rows) || !rows.every((row) => isSnapshotRow(row)
      && tables[table].columns.split(" ").every((column) => Object.hasOwn(row, column)))) {
      throw new Error("The Wiki snapshot has invalid " + table + ".");
    }
  }
  return input as Snapshot;
}

function validateRelationships(snapshot: Snapshot, groupIds: Set<unknown>) {
  const mapById = (rows: Row[]) => {
    const map = new Map<string, Row>();
    for (const row of rows) {
      if (!isSnapshotUuid(row.id) || map.has(row.id)) throw new Error("The Wiki snapshot has an invalid or duplicate record ID.");
      map.set(row.id, row);
    }
    return map;
  };
  const categories = mapById(snapshot.categories), pages = mapById(snapshot.pages);
  mapById(snapshot.versions);
  mapById(snapshot.links);
  function validateChain(rows: Map<string, Row>, field: string) {
    const checked = new Set<string>();
    for (const root of rows.keys()) {
      const visited = new Set<string>();
      let current: unknown = root;
      while (current !== null) {
        if (!isSnapshotUuid(current) || visited.has(current) || !rows.has(current)) {
          throw new Error("A Wiki category or redirect chain has a cycle or points outside the snapshot.");
        }
        if (checked.has(current)) break;
        visited.add(current);
        current = rows.get(current)![field];
      }
      for (const id of visited) checked.add(id);
    }
  }
  validateChain(categories, "parent_id");
  validateChain(pages, "redirect_page_id");
  for (const page of snapshot.pages) {
    if (!isSnapshotUuid(page.category_id) || !categories.has(page.category_id) ||
        (page.audience === "group" && !groupIds.has(page.audience_group_id))) {
      throw new Error("A Wiki page references a missing category or core-site audience group.");
    }
  }
  for (const row of [...snapshot.versions, ...snapshot.links, ...snapshot.attachments]) {
    if (!isSnapshotUuid(row.page_id) || !pages.has(row.page_id)) throw new Error("A Wiki child record references a missing page.");
  }
}

async function exportWiki(client: PoolClient, departmentId: string): Promise<Snapshot> {
  const snapshot: Snapshot = { version: 1, categories: [], pages: [], versions: [], links: [], attachments: [] };
  for (const key of tableKeys) {
    const { name, columns } = tables[key];
    const order = key === "attachments" ? "page_id,file_id" : "id";
    snapshot[key] = (await client.query(`SELECT ${columns.split(" ").join(",")} FROM ${name} WHERE department_id=$1 ORDER BY ${order}`, [departmentId])).rows;
  }
  return snapshot;
}

function remapRow(row: Row, context: ReplicationRestoreContext | undefined) {
  return Object.fromEntries(Object.entries(row).map(([column, value]) => [
    column, accountColumns.has(column) && isSnapshotUuid(value) ? context?.userIdMap.get(value) ?? null : value,
  ]));
}

function normalizedWiki(snapshot: Snapshot, context?: ReplicationRestoreContext) {
  function normalize(value: unknown): unknown {
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(normalize);
    if (isSnapshotRow(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]));
    return value;
  }
  return JSON.stringify(tableKeys.map((key) =>
    snapshot[key].map((row) => JSON.stringify(normalize(context ? remapRow(row, context) : row))).sort()));
}

export function registerWikiReplication(context: ModuleServerContext) {
  const { pool, isDatabaseReady } = context;
  context.replication.register({
    schemaVersion: "1",
    async requiresSnapshot(departmentId) {
      if (!pool || !isDatabaseReady()) return false;
      const rows = await pool.query("SELECT 1 FROM wiki_categories WHERE department_id=$1 LIMIT 1", [departmentId]);
      return Boolean(rows.rowCount);
    },
    async inspect(departmentId) {
      if (!pool || !isDatabaseReady()) return { ready: false, blockers: ["The Wiki database is unavailable."], recordCount: 0 };
      const counts = await pool.query<{ count: number }>(`SELECT sum(rows)::int AS count FROM (
        ${tableKeys.map((key) => `SELECT count(*) AS rows FROM ${tables[key].name} WHERE department_id=$1`).join(" UNION ALL ")}
      ) counts`, [departmentId]);
      return { ready: true, blockers: [], recordCount: counts.rows[0].count };
    },
    exportSnapshot: exportWiki,
    restoreDependencies: {
      moduleIds: ["core-site", "file-storage"],
      validate(input, dependencies) {
        const snapshot = readWikiSnapshot(input);
        const core = dependencies.get("core-site");
        const groups = isSnapshotRow(core) && isSnapshotRow(core.tables) && Array.isArray(core.tables.church_groups)
          ? core.tables.church_groups : [];
        validateRelationships(snapshot, new Set(groups.filter(isSnapshotRow).map((group) => group.id)));
        validateStoredWikiAttachmentEvidence(dependencies.get("file-storage"), snapshot);
      },
    },
    async prepareRestore(client, departmentId, input) {
      if (input === undefined) {
        const local = await client.query("SELECT 1 FROM wiki_pages WHERE department_id=$1 AND audience_group_id IS NOT NULL LIMIT 1", [departmentId]);
        if (local.rowCount) throw new Error("The incoming snapshot omits Wiki, but the standby has Wiki pages with group access rules.");
        return;
      }
      const foreignChild = await client.query(`SELECT 1 FROM wiki_categories parent JOIN wiki_categories child ON child.parent_id=parent.id
        WHERE parent.department_id=$1 AND child.department_id<>$1 LIMIT 1`, [departmentId]);
      if (foreignChild.rowCount) throw new Error("A Wiki category from another location references this location's category.");
      await client.query("UPDATE wiki_pages SET redirect_page_id=NULL WHERE department_id=$1 AND redirect_page_id IS NOT NULL", [departmentId]);
      await client.query("DELETE FROM wiki_pages WHERE department_id=$1", [departmentId]);
      await client.query("DELETE FROM wiki_categories WHERE department_id=$1", [departmentId]);
    },
    async restoreSnapshot(client, departmentId, input, restoreContext) {
      const snapshot = readWikiSnapshot(input);
      for (const key of tableKeys) {
        const { name } = tables[key];
        const columns = tables[key].columns.split(" ");
        const related = key === "categories" ? "parent_id" : key === "pages" ? "redirect_page_id" : null;
        for (const source of snapshot[key]) {
          const row = remapRow(source, restoreContext);
          const values = columns.map((column) => {
            if (column === related) return null;
            return jsonColumns.has(column) && row[column] != null ? JSON.stringify(row[column]) : row[column];
          });
          const inserted = await client.query(`INSERT INTO ${name}(department_id,${columns.join(",")})
            VALUES($1,${columns.map((_, index) => "$" + (index + 2)).join(",")})`, [departmentId, ...values]);
          if (inserted.rowCount !== 1) throw new Error("A Wiki snapshot record could not be restored.");
        }
        if (related) {
          for (const source of snapshot[key]) if (source[related] != null) {
            await client.query(`UPDATE ${name} SET ${related}=$3 WHERE id=$1 AND department_id=$2`, [source.id, departmentId, source[related]]);
          }
        }
      }
      return { recordCount: tableKeys.reduce((count, key) => count + snapshot[key].length, 0) };
    },
    async verifySnapshot(client, departmentId, input, restoreContext) {
      const expected = readWikiSnapshot(input);
      const actual = await exportWiki(client, departmentId);
      const ready = normalizedWiki(actual) === normalizedWiki(expected, restoreContext);
      return { ready, blockers: ready ? [] : ["Restored Wiki records or historical attribution differ from the signed snapshot."] };
    },
  });
}
