import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

export const protocolVersion = "smart-church-federation/1";
const keyPath = () => process.env.SMART_CHURCH_SYNC_IDENTITY_KEY_FILE?.trim()
  || (process.env.NODE_ENV === "production"
    ? "/var/lib/smart-church/sync/identity-ed25519.pem"
    : resolve(dirname(fileURLToPath(import.meta.url)), "../../../data/sync/identity-ed25519.pem"));

export type FederationIdentity = {
  installationId: string;
  displayName: string;
  publicKeyPem: string;
  fingerprint: string;
  protocolVersion: string;
};

export type LocalIdentity = FederationIdentity & { privateKeyPem: string };

const fingerprintOf = (publicKeyPem: string) => {
  const publicKey = createPublicKey(publicKeyPem);
  if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("The federation identity must use an Ed25519 public key.");
  return createHash("sha256").update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex").toUpperCase().match(/.{1,2}/g)!.join(":");
};

let identityPromise: Promise<LocalIdentity> | null = null;

export function resetIdentityCacheForTests() { identityPromise = null; }

export function getIdentity(pool: Pool, displayName: string): Promise<LocalIdentity> {
  identityPromise ??= createIdentity(pool, displayName).catch((error) => { identityPromise = null; throw error; });
  return identityPromise;
}

async function createIdentity(pool: Pool, displayName: string): Promise<LocalIdentity> {
  const current = await pool.query<{ id: string }>("SELECT id FROM installations WHERE is_current = TRUE");
  const installationId = current.rows[0]?.id;
  if (!installationId) throw new Error("The current Smart-Church installation identity is unavailable.");
  const path = keyPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700);

  let privateKeyPem: string;
  try {
    privateKeyPem = await readFile(path, "utf8");
    await chmod(path, 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const savedIdentity = await pool.query("SELECT 1 FROM sync_installation_identity WHERE singleton = TRUE");
    if (savedIdentity.rowCount) throw new Error("The saved Sync identity key is missing. Restore the protected application data backup; a new key will not be generated automatically.");
    const pair = generateKeyPairSync("ed25519", { publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
    privateKeyPem = pair.privateKey;
    try { await writeFile(path, privateKeyPem, { encoding: "utf8", mode: 0o600, flag: "wx" }); }
    catch (writeError) {
      if ((writeError as NodeJS.ErrnoException).code !== "EEXIST") throw writeError;
      privateKeyPem = await readFile(path, "utf8");
    }
  }

  const privateKey = createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("The saved Sync identity key is not an Ed25519 key.");
  const publicKeyPem = createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
  const fingerprint = fingerprintOf(publicKeyPem);
  const saved = await pool.query<{ installation_id: string; public_key_pem: string; fingerprint: string }>(
    "SELECT installation_id, public_key_pem, fingerprint FROM sync_installation_identity WHERE singleton = TRUE",
  );
  if (saved.rowCount) {
    const row = saved.rows[0];
    if (row.installation_id !== installationId || row.public_key_pem !== publicKeyPem || row.fingerprint !== fingerprint) {
      throw new Error("The Sync identity key does not match the registered installation identity. Restore the matching protected backup or revoke and re-pair peers after an administrator-led recovery.");
    }
  } else {
    await pool.query(
      "INSERT INTO sync_installation_identity (singleton, installation_id, public_key_pem, fingerprint) VALUES (TRUE, $1, $2, $3)",
      [installationId, publicKeyPem, fingerprint],
    );
  }
  return { installationId, displayName, publicKeyPem, privateKeyPem, fingerprint, protocolVersion };
}

export function signBytes(privateKeyPem: string, message: string | Buffer) {
  return sign(null, Buffer.isBuffer(message) ? message : Buffer.from(message, "utf8"), createPrivateKey(privateKeyPem)).toString("base64url");
}

export function verifyBytes(publicKeyPem: string, message: string | Buffer, signature: string) {
  try { return verify(null, Buffer.isBuffer(message) ? message : Buffer.from(message, "utf8"), createPublicKey(publicKeyPem), Buffer.from(signature, "base64url")); }
  catch { return false; }
}

export function fingerprintPublicKey(publicKeyPem: string) { return fingerprintOf(publicKeyPem); }

export function bodyDigest(body: string | Buffer) { return createHash("sha256").update(body).digest("hex"); }

export function canonicalRequest(method: string, pathAndQuery: string, timestamp: string, nonce: string, body: string | Buffer) {
  return `SC-FEDERATION-V1\n${method.toUpperCase()}\n${pathAndQuery}\n${timestamp}\n${nonce}\n${bodyDigest(body)}`;
}

export function canonicalResponse(status: number, nonce: string, body: string | Buffer) {
  return `SC-FEDERATION-RESPONSE-V1\n${status}\n${nonce}\n${bodyDigest(body)}`;
}
