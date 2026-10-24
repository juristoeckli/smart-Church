import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const migrationDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations");

const connectionString = process.env.DATABASE_URL;
export const departmentId = process.env.SMART_CHURCH_DEPARTMENT_ID ?? "00000000-0000-4000-8000-000000000001";
export const departmentName = process.env.SMART_CHURCH_DEPARTMENT_NAME ?? "Grace Community";
export const pool = connectionString
  ? new Pool({ connectionString, connectionTimeoutMillis: 5_000, max: 10 })
  : undefined;

export async function initializeDatabase() {
  if (!pool) return false;

  const migration = await readFile(resolve(migrationDirectory, "001_departments_and_contacts.sql"), "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
    const applied = await client.query("SELECT version FROM schema_migrations WHERE version = $1", ["001_departments_and_contacts"]);
    if (applied.rowCount === 0) {
      await client.query(migration);
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", ["001_departments_and_contacts"]);
    }
    await client.query(
      `INSERT INTO departments (id, name) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
      [departmentId, departmentName],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return true;
}

export async function closeDatabase() {
  await pool?.end();
}
