import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const migrationDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations");

const connectionString = process.env.DATABASE_URL;
export const departmentId = process.env.SMART_CHURCH_DEPARTMENT_ID ?? "00000000-0000-4000-8000-000000000001";
export const departmentName = process.env.SMART_CHURCH_DEPARTMENT_NAME ?? "Location not configured";
export let installationId: string | undefined;
export const pool = connectionString
  ? new Pool({ connectionString, connectionTimeoutMillis: 5_000, max: 10 })
  : undefined;

export async function initializeDatabase() {
  if (!pool) return false;

  const migrations = (await readdir(migrationDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const client = await pool.connect();
  try {
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
    for (const file of migrations) {
      const version = file.replace(/\.sql$/, "");
      const applied = await client.query("SELECT version FROM schema_migrations WHERE version = $1", [version]);
      if (applied.rowCount !== 0) continue;

      const migration = await readFile(resolve(migrationDirectory, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(migration);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    const installation = await client.query<{ id: string }>("SELECT id FROM installations WHERE is_current = TRUE");
    if (!installation.rows[0]) throw new Error("The installation identity could not be loaded.");
    installationId = installation.rows[0].id;
    await client.query(
      `INSERT INTO departments (id, installation_id, name, enabled_modules)
       VALUES ($1, $2, $3, ARRAY['file-storage', 'notifications']::TEXT[] || CASE WHEN lower($3) = 'steffisburg' THEN ARRAY['video-steffisburg']::TEXT[] ELSE '{}'::TEXT[] END)
       ON CONFLICT (id) DO NOTHING`,
      [departmentId, installationId, departmentName],
    );
  } finally {
    client.release();
  }
  return true;
}

export async function closeDatabase() {
  await pool?.end();
}
