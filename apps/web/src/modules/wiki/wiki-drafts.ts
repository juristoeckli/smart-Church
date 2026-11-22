export type WikiDraftContent = {
  title: string;
  categoryId: string;
  audience: "location" | "group" | "managers";
  audienceGroupId: string;
  redirectPageId: string;
  contentHtml: string;
};
export type WikiDraft = { baseRevision: string; savedAt: number; content: WikiDraftContent };
const maximumAge = 7 * 24 * 60 * 60 * 1000;

export function wikiDraftKey(accountId: string | undefined, departmentId: string, pageId: string | undefined) {
  return accountId && pageId ? "wiki-page-draft:" + JSON.stringify([accountId, departmentId, pageId]) : "";
}

export function readWikiDraft(key: string): WikiDraft | undefined {
  if (!key) return;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw || raw.length > 1_100_000) return;
    const draft = JSON.parse(raw) as WikiDraft;
    if (!draft || !Number.isFinite(draft.savedAt) || Date.now() - draft.savedAt > maximumAge
      || draft.savedAt > Date.now() + 60_000 || !/^[0-9]{1,10}$/.test(draft.baseRevision)) return;
    const content = draft.content;
    if (!content || !["location", "group", "managers"].includes(content.audience)
      || typeof content.title !== "string" || typeof content.contentHtml !== "string"
      || typeof content.categoryId !== "string" || typeof content.audienceGroupId !== "string"
      || typeof content.redirectPageId !== "string" || content.contentHtml.length > 500_000) return;
    return draft;
  } catch {
    return;
  }
}

export function writeWikiDraft(key: string, draft: WikiDraft) {
  if (!key || draft.content.contentHtml.length > 500_000) return false;
  try {
    const raw = JSON.stringify(draft);
    if (raw.length > 1_100_000) return false;
    sessionStorage.setItem(key, raw);
    return true;
  } catch {
    return false;
  }
}

export function discardWikiDraft(key: string) {
  if (!key) return false;
  try {
    sessionStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
