import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { wikiFileAudienceSchema } from "../../stored-file-wiki-access.js";

type SnapshotRow = Record<string, unknown>;
export function isSnapshotRow(value: unknown): value is SnapshotRow {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function isSnapshotUuid(value: unknown): value is string {
  return typeof value === "string" && uuid.test(value);
}

export function wikiAttachmentFingerprint(attachments: readonly SnapshotRow[], pages: readonly SnapshotRow[]) {
  if (attachments.length === 0) return "none";
  const pagesById = new Map(pages.map((page) => [page.id, page]));
  const keys = new Set<string>();
  const evidence = attachments.map((attachment) => {
    const page = pagesById.get(attachment.page_id);
    if (!isSnapshotUuid(attachment.file_id) || !isSnapshotUuid(attachment.page_id) ||
        typeof attachment.managers_only !== "boolean" || !page) throw new Error("A Wiki attachment has invalid access metadata.");
    const key = attachment.page_id + ":" + attachment.file_id;
    if (keys.has(key)) throw new Error("The Wiki snapshot contains a duplicate attachment.");
    keys.add(key);
    return JSON.stringify([attachment.page_id, attachment.file_id, attachment.managers_only, page.status, page.audience, page.audience_group_id]);
  }).sort();
  return "wiki-v1:" + createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
}

export async function storedWikiAttachmentFingerprint(db: Pick<PoolClient, "query">, departmentId: string) {
  const schema = await wikiFileAudienceSchema(db);
  if (schema === "absent") return "none";
  if (schema === "partial") throw new Error("Wiki attachment permissions cannot be verified. Complete the Wiki migrations before replicating File Storage.");
  const result = await db.query(`SELECT attachment.page_id,attachment.file_id,attachment.managers_only,
    page.status,page.audience,page.audience_group_id FROM wiki_page_files attachment
    LEFT JOIN wiki_pages page ON page.id=attachment.page_id AND page.department_id=attachment.department_id
    WHERE attachment.department_id=$1`, [departmentId]);
  return wikiAttachmentFingerprint(result.rows, result.rows.filter((row) => row.status !== null).map((row) => ({ ...row, id: row.page_id })));
}

export function validateStoredWikiAttachmentEvidence(fileStorage: unknown, wiki: unknown) {
  if (!isSnapshotRow(fileStorage) || !Array.isArray(fileStorage.files)) {
    throw new Error("The File Storage snapshot is invalid.");
  }
  if (wiki === undefined) {
    if (fileStorage.wikiAttachmentAccess === "none") return;
    if (fileStorage.wikiAttachmentAccess === undefined && !fileStorage.files.length
        && (fileStorage.versions === undefined || Array.isArray(fileStorage.versions) && !fileStorage.versions.length)) return;
    throw new Error("This File Storage snapshot does not verify Wiki attachment access. Create a fresh snapshot after upgrading the source installation.");
  }
  if (!isSnapshotRow(wiki) || wiki.version !== 1 || !Array.isArray(wiki.pages) ||
      !wiki.pages.every(isSnapshotRow) || !Array.isArray(wiki.attachments) || !wiki.attachments.every(isSnapshotRow)) {
    throw new Error("The Wiki snapshot has invalid attachment access information.");
  }
  const files = new Set(fileStorage.files.filter(isSnapshotRow).map((file) => file.id));
  if (wiki.attachments.some((attachment) => !files.has(attachment.file_id))) {
    throw new Error("A Wiki attachment is missing its file in the File Storage snapshot.");
  }
  const expected = wikiAttachmentFingerprint(wiki.attachments, wiki.pages);
  const actual = fileStorage.wikiAttachmentAccess ?? (fileStorage.files.length === 0 ? "none" : undefined);
  if (actual !== expected) throw new Error("Wiki and File Storage disagree on the attachment access rules.");
}
