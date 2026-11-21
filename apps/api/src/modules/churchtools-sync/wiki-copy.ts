type Raw = Record<string, unknown>;
const object = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Raw : null;
const positive = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : null;

export function wikiGuid(value: unknown) {
  return typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value) ? value.toLowerCase() : null;
}

function title(value: unknown, limit: number) {
  if (typeof value !== "string" || /[\p{Cc}\p{Cf}<>]/u.test(value)) return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= limit ? trimmed : null;
}

function catalog(payload: unknown, bound: number) {
  const outer = object(payload);
  const data = outer?.data;
  if (!Array.isArray(data) || data.length > bound || object(outer?.meta)?.count !== data.length) {
    throw new Error("Incomplete ChurchTools Wiki catalog.");
  }
  return data;
}

export function guestWikiCategories(payload: unknown) {
  const ids = new Set<string>();
  return catalog(payload, 300).flatMap((value) => {
    const row = object(value);
    const id = positive(row?.id);
    const name = title(row?.name, 120);
    if (!id || !name) return [];
    if (ids.has(id)) throw new Error("Duplicate ChurchTools Wiki category.");
    ids.add(id);
    return [{ id, name }];
  });
}

export function guestWikiPages(payload: unknown, categoryId: string) {
  const ids = new Set<string>();
  return catalog(payload, 500).flatMap((value) => {
    const row = object(value);
    const guid = wikiGuid(row?.guid);
    const revision = positive(row?.version);
    const name = title(row?.title, 180);
    if (!guid || !revision || !name || positive(object(row?.wikiCategory)?.id) !== categoryId) return [];
    if (ids.has(guid)) throw new Error("Duplicate ChurchTools Wiki page.");
    ids.add(guid);
    if (row?.redirectTo !== null || row.isMarkdown !== true) return [];
    return [{ guid, revision, title: name }];
  });
}

export function guestWikiRevision(payload: unknown, categoryId: string, guid: string) {
  const row = object(object(payload)?.data);
  const revision = positive(row?.version);
  const name = title(row?.title, 180);
  const body = row?.text;
  if (!row || positive(object(row.wikiCategory)?.id) !== categoryId || wikiGuid(row.guid) !== guid || !revision || !name
    || row.redirectTo !== null || row.isMarkdown !== true || typeof body !== "string" || !body.trim() || body.length > 75_000
    || /[\[\]<>]|(?:https?|ftp|mailto|file|data|javascript):|(?:^|\s)\/\/|\bwww\.|\bchurch\.tools\b|\bchurchtools\.[a-z]+\b|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]|\p{Cf}/iu.test(body)) return null;
  const escaped = body.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[character]!));
  return { guid, revision, title: name, text: body, html: `<pre><code>${escaped}</code></pre>` };
}

export async function fetchGuestWiki(instance: string, path: string, signal: AbortSignal) {
  const root = new URL(instance);
  if (root.protocol !== "https:" || root.username || root.password || root.search || root.hash) {
    throw new Error("A configured HTTPS ChurchTools URL is required.");
  }
  const response = await fetch(root.href.replace(/\/+$/, "") + "/api/wiki/" + path, {
    credentials: "omit", redirect: "error", cache: "no-store", signal, headers: { Accept: "application/json" },
  });
  if ([401, 403, 404].includes(response.status)) return null;
  if (!response.ok || !response.body || !response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new Error("ChurchTools Wiki response could not be validated.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let body = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_200_000) throw new Error("ChurchTools Wiki response exceeded the size limit.");
      body += decoder.decode(value, { stream: true });
    }
    return JSON.parse(body + decoder.decode()) as unknown;
  } finally {
    await reader.cancel().catch(() => {});
  }
}
