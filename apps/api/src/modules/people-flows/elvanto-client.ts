import { createDecipheriv, scryptSync } from "node:crypto";

type JsonObject = Record<string, unknown>;

function decryptApiKey(value: string) {
  const [version, iv, tag, data] = value.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Reconnect Elvanto before exporting People Flow assignments.");
  const source = process.env.SMART_CHURCH_SYNC_ENCRYPTION_KEY || process.env.DATABASE_URL;
  if (!source) throw new Error("Elvanto key encryption is unavailable.");
  try {
    const key = scryptSync(source, "smart-church/elvanto-sync/v1", 32);
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Reconnect Elvanto before exporting People Flow assignments.");
  }
}

function collection(payload: JsonObject) {
  const container = payload.people_flow_step_members;
  if (!container || typeof container !== "object") return [];
  const value = (container as JsonObject).people_flow_step_member;
  if (Array.isArray(value)) return value.filter((row): row is JsonObject => Boolean(row) && typeof row === "object" && !Array.isArray(row));
  if (value && typeof value === "object" && !Array.isArray(value)) return [value as JsonObject];
  return [];
}

function personId(row: JsonObject) {
  const person = row.person && typeof row.person === "object" ? row.person as JsonObject : {};
  const value = row.person_id ?? row.personId ?? person.id ?? row.id;
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function noMembersMessage(payload: JsonObject) {
  const nestedError = payload.error && typeof payload.error === "object" ? payload.error as JsonObject : {};
  const message = [payload.message, typeof payload.error === "string" ? payload.error : "", nestedError.message, nestedError.description]
    .filter((value): value is string => typeof value === "string").join(" ");
  return /\bno (people|members?)\b.*\b(found|match|criteria)\b/i.test(message);
}

async function send(apiKey: string, endpoint: string, body: JsonObject, retryRead: boolean) {
  let response: Response | undefined;
  for (let attempt = 0; attempt < (retryRead ? 3 : 1); attempt += 1) {
    try {
      response = await fetch(`https://api.elvanto.com/v1/${endpoint}.json`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${apiKey}:x`).toString("base64")}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
        redirect: "error",
      });
    } catch (error) {
      const retryable = error instanceof TypeError || error instanceof Error && error.name === "TimeoutError";
      if (!retryRead || !retryable || attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** attempt)));
      continue;
    }
    if (retryRead && (response.status === 429 || response.status >= 500) && attempt < 2) {
      const header = response.headers.get("retry-after");
      const seconds = header ? Number(header) : NaN;
      const dateDelay = header && !Number.isFinite(seconds) ? Date.parse(header) - Date.now() : NaN;
      const delay = Number.isFinite(seconds) ? seconds * 1000 : Number.isFinite(dateDelay) ? dateDelay : 250 * (2 ** attempt);
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.min(delay, 10_000))));
      continue;
    }
    break;
  }
  if (!response) throw new Error("Elvanto did not return a response.");
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > 10 * 1024 * 1024) throw new Error("Elvanto returned an oversized People Flow response.");
  let payload: JsonObject;
  try { payload = JSON.parse(text) as JsonObject; } catch { throw new Error("Elvanto returned an invalid JSON response."); }
  if (retryRead && noMembersMessage(payload)) return payload;
  if (!response.ok) throw new Error(`Elvanto returned HTTP ${response.status} for ${endpoint}.`);
  if (payload.status !== "ok" && !(retryRead && noMembersMessage(payload))) {
    throw new Error(`Elvanto did not confirm the ${endpoint} request. Check the key and account permissions.`);
  }
  return payload;
}

export function createElvantoPeopleFlowClient(encryptedApiKey: string) {
  const apiKey = decryptApiKey(encryptedApiKey);
  return {
    async listStepPersonIds(stepId: string) {
      const payload = await send(apiKey, "peopleFlows/steps/people", { step_id: stepId }, true);
      if (payload.status !== "ok") return new Set<string>();
      const rows = collection(payload);
      const ids = rows.map(personId);
      if (ids.some((id) => !id)) throw new Error("Elvanto returned a People Flow assignment without a stable person ID.");
      const container = payload.people_flow_step_members;
      if (!container || typeof container !== "object") throw new Error("Elvanto returned an incomplete People Flow assignment list.");
      const metadata = container as JsonObject;
      const reportedTotal = Number(metadata.total ?? metadata.on_this_page);
      if (!Number.isFinite(reportedTotal) || reportedTotal !== rows.length) throw new Error("Elvanto returned an incomplete People Flow assignment list.");
      return new Set(ids);
    },
    async addPersonToStep(stepId: string, personIdValue: string) {
      // This write is deliberately sent once. A timeout can leave its outcome uncertain.
      return send(apiKey, "peopleFlows/steps/addPerson", { step_id: stepId, person_id: personIdValue }, false);
    },
  };
}
