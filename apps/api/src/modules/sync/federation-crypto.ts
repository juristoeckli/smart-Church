import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, sign, verify } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

export const protocolVersion = "smart-church-federation/2";
const keyPath = () => process.env.SMART_CHURCH_SYNC_IDENTITY_KEY_FILE?.trim()
  || (process.env.NODE_ENV === "production"
    ? "/var/lib/smart-church/sync/identity-ed25519.pem"
    : resolve(dirname(fileURLToPath(import.meta.url)), "../../../data/sync/identity-ed25519.pem"));
const encryptionKeyPath = () => `${keyPath()}.x25519.pem`;

export type FederationIdentity = {
  installationId: string;
  displayName: string;
  publicKeyPem: string;
  fingerprint: string;
  protocolVersion: string;
  encryptionPublicKeyPem?: string;
};

export type LocalIdentity = FederationIdentity & { privateKeyPem: string; encryptionPrivateKeyPem: string };

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

  const encryptionPath = encryptionKeyPath();
  let encryptionPrivateKeyPem: string;
  try {
    encryptionPrivateKeyPem = await readFile(encryptionPath, "utf8");
    await chmod(encryptionPath, 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const pair = generateKeyPairSync("x25519", { publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
    encryptionPrivateKeyPem = pair.privateKey;
    try { await writeFile(encryptionPath, encryptionPrivateKeyPem, { encoding: "utf8", mode: 0o600, flag: "wx" }); }
    catch (writeError) {
      if ((writeError as NodeJS.ErrnoException).code !== "EEXIST") throw writeError;
      encryptionPrivateKeyPem = await readFile(encryptionPath, "utf8");
    }
  }

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
  const encryptionPrivateKey = createPrivateKey(encryptionPrivateKeyPem);
  if (encryptionPrivateKey.asymmetricKeyType !== "x25519") throw new Error("The Sync snapshot-encryption key is not an X25519 key.");
  const encryptionPublicKeyPem = createPublicKey(encryptionPrivateKey).export({ type: "spki", format: "pem" }).toString();
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
  return { installationId, displayName, publicKeyPem, privateKeyPem, encryptionPublicKeyPem, encryptionPrivateKeyPem, fingerprint, protocolVersion };
}

export function sealForPeer(encryptionPublicKeyPem: string, plaintext: string) {
  const recipientPublicKey = createPublicKey(encryptionPublicKeyPem);
  if (recipientPublicKey.asymmetricKeyType !== "x25519") throw new Error("The standby does not advertise a supported snapshot-encryption key.");
  const ephemeral = generateKeyPairSync("x25519");
  const salt = randomBytes(32);
  const iv = randomBytes(12);
  const key = Buffer.from(hkdfSync("sha256", diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipientPublicKey }), salt, Buffer.from("smart-church-site-snapshot-v1"), 32));
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return JSON.stringify({
    version: 1,
    ephemeralPublicKeyPem: ephemeral.publicKey.export({ type: "spki", format: "pem" }).toString(),
    salt: salt.toString("base64url"),
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  });
}

export function openFromPeer(encryptionPrivateKeyPem: string, envelope: string) {
  const value = JSON.parse(envelope) as Record<string, unknown>;
  if (value.version !== 1 || typeof value.ephemeralPublicKeyPem !== "string" || typeof value.salt !== "string" || typeof value.iv !== "string" || typeof value.tag !== "string" || typeof value.ciphertext !== "string") throw new Error("A replicated credential envelope is invalid.");
  if (envelope.length > 64 * 1024) throw new Error("A replicated credential envelope exceeds the size limit.");
  const privateKey = createPrivateKey(encryptionPrivateKeyPem);
  const ephemeralPublicKey = createPublicKey(value.ephemeralPublicKeyPem);
  if (privateKey.asymmetricKeyType !== "x25519" || ephemeralPublicKey.asymmetricKeyType !== "x25519") throw new Error("A replicated credential uses an unsupported encryption key.");
  const salt = Buffer.from(value.salt, "base64url");
  const iv = Buffer.from(value.iv, "base64url");
  const tag = Buffer.from(value.tag, "base64url");
  const ciphertext = Buffer.from(value.ciphertext, "base64url");
  if (salt.length !== 32 || iv.length !== 12 || tag.length !== 16 || ciphertext.length > 32 * 1024) throw new Error("A replicated credential envelope is malformed or too large.");
  const key = Buffer.from(hkdfSync("sha256", diffieHellman({ privateKey, publicKey: ephemeralPublicKey }), salt, Buffer.from("smart-church-site-snapshot-v1"), 32));
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
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
