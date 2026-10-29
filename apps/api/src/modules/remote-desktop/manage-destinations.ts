import { createCipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";

const [action, departmentId] = process.argv.slice(2);
if (!new Set(["list", "save", "delete"]).has(action ?? "") || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(departmentId ?? "")) {
  throw new Error("Usage: manage-destinations.ts list|save|delete <department-uuid>");
}
const secret = process.env.SYSTEM_LAPTOP_JSON_SECRET_KEY ?? "";
if (!/^[\da-f]{32}$/i.test(secret)) throw new Error("The remote desktop credential key is not configured.");
const key = createHash("sha256").update(Buffer.from(secret, "hex")).digest();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const decode = (value: string) => Buffer.from(value, "base64").toString("utf8");
const encode = (value: unknown) => Buffer.from(String(value ?? ""), "utf8").toString("base64");

try {
  await migrateLegacySettings();
  if (action === "list") {
    const result = await pool.query("SELECT id, name, host, port, protocol, username, autologin FROM remote_desktop_destinations WHERE department_id=$1 ORDER BY name", [departmentId]);
    for (const row of result.rows) console.log([row.id, encode(row.name), encode(row.host), row.port, row.protocol, encode(row.username), row.autologin ? "1" : "0"].join("\t"));
  } else if (action === "delete") {
    const [id = ""] = (await stdin()).trim().split("\t");
    const result = await pool.query("DELETE FROM remote_desktop_destinations WHERE id=$1 AND department_id=$2 RETURNING id", [id, departmentId]);
    if (!result.rowCount) throw new Error("Destination not found.");
    await markManaged();
    console.log("Destination removed.");
  } else {
    const [id = "", encodedName = "", encodedHost = "", portText = "", protocol = "", encodedUsername = "", encodedPassword = "", autologinText = "1", passwordMode = "set"] = (await stdin()).trimEnd().split("\t");
    const name = decode(encodedName).trim();
    const host = decode(encodedHost).trim();
    const username = decode(encodedUsername).trim();
    const password = decode(encodedPassword);
    const port = Number(portText);
    if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error("Enter a destination name up to 100 characters.");
    if (!host || host.length > 253 || !/^[A-Za-z0-9.:-]+$/.test(host)) throw new Error("Enter an IP address or DNS hostname.");
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Enter a port from 1 to 65535.");
    if (!new Set(["rdp", "vnc", "spice"]).has(protocol)) throw new Error("Choose RDP, VNC, or SPICE.");
    let encrypted: string[];
    if (id && passwordMode === "keep") {
      const existing = await pool.query("SELECT password_ciphertext, password_iv, password_tag FROM remote_desktop_destinations WHERE id=$1 AND department_id=$2", [id, departmentId]);
      if (!existing.rowCount) throw new Error("Destination not found.");
      encrypted = [existing.rows[0].password_ciphertext, existing.rows[0].password_iv, existing.rows[0].password_tag];
    } else {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const ciphertext = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
      encrypted = [ciphertext.toString("base64"), iv.toString("base64"), cipher.getAuthTag().toString("base64")];
    }
    if (id) {
      await pool.query(
        `UPDATE remote_desktop_destinations SET name=$3, host=$4, port=$5, protocol=$6, username=$7,
                password_ciphertext=$8, password_iv=$9, password_tag=$10, autologin=$11, updated_at=now()
          WHERE id=$1 AND department_id=$2`,
        [id, departmentId, name, host, port, protocol, username, ...encrypted, autologinText === "1"],
      );
    } else {
      await pool.query(
        `INSERT INTO remote_desktop_destinations (id, department_id, name, host, port, protocol, username, password_ciphertext, password_iv, password_tag, autologin)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [randomUUID(), departmentId, name, host, port, protocol, username, ...encrypted, autologinText === "1"],
      );
    }
    await markManaged();
    console.log("Destination saved.");
  }
} finally { await pool.end(); }

async function markManaged() {
  await pool.query("INSERT INTO remote_desktop_site_settings (department_id, managed) VALUES ($1,true) ON CONFLICT (department_id) DO UPDATE SET managed=true, updated_at=now()", [departmentId]);
}

async function migrateLegacySettings() {
  const marker = await pool.query("SELECT managed FROM remote_desktop_site_settings WHERE department_id=$1", [departmentId]);
  const host = process.env.SYSTEM_LAPTOP_RDP_HOST?.trim() ?? "";
  if (marker.rows[0]?.managed !== false || process.env.SMART_CHURCH_DEPARTMENT_ID !== departmentId || !host || !/^[A-Za-z0-9.:-]+$/.test(host)) return;
  const portText = process.env.SYSTEM_LAPTOP_RDP_PORT?.trim() || "3389";
  const port = /^\d{1,5}$/.test(portText) && Number(portText) >= 1 && Number(portText) <= 65535 ? Number(portText) : 3389;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(process.env.SYSTEM_LAPTOP_RDP_PASSWORD ?? "", "utf8"), cipher.final()]);
  const password = [ciphertext.toString("base64"), iv.toString("base64"), cipher.getAuthTag().toString("base64")];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query("SELECT managed FROM remote_desktop_site_settings WHERE department_id=$1 FOR UPDATE", [departmentId]);
    if (current.rows[0]?.managed === false) {
      await client.query(
        `INSERT INTO remote_desktop_destinations (id, department_id, name, host, port, protocol, username, password_ciphertext, password_iv, password_tag, autologin)
         VALUES ($1,$2,'Remote desktop',$3,$4,'rdp',$5,$6,$7,$8,true) ON CONFLICT (department_id,name) DO NOTHING`,
        [randomUUID(), departmentId, host, port, process.env.SYSTEM_LAPTOP_RDP_USERNAME ?? "", ...password],
      );
      await client.query("UPDATE remote_desktop_site_settings SET managed=true, updated_at=now() WHERE department_id=$1", [departmentId]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

function stdin() {
  return new Promise<string>((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => resolve(input));
    process.stdin.on("error", reject);
  });
}
