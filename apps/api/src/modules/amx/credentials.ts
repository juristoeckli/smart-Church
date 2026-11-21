import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function encryptionKey() {
  const source = process.env.SMART_CHURCH_AMX_ENCRYPTION_KEY?.trim()
    || process.env.SMART_CHURCH_SYNC_ENCRYPTION_KEY?.trim()
    || process.env.DATABASE_URL?.trim();
  if (!source) throw new Error("Set SMART_CHURCH_AMX_ENCRYPTION_KEY or DATABASE_URL before saving the AMX Telnet password.");
  return createHash("sha256").update(`smart-church/amx/v1:${source}`).digest();
}

export function encryptTelnetPassword(password: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptTelnetPassword(value: string) {
  const [iv, tag, ciphertext] = value.split(".");
  if (!iv || !tag || !ciphertext) throw new Error("The saved AMX Telnet password cannot be decrypted. Re-enter the existing controller password.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("The saved AMX Telnet password cannot be decrypted. Re-enter the existing controller password.");
  }
}
