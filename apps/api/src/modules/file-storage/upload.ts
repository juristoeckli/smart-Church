import { basename } from "node:path";

export const storedFileUploadLimit = 25 * 1024 * 1024;

export function storedFileUploadMetadata(query: { filename?: string; title?: string }, requestedType: string | string[] | undefined) {
  const fileName = basename(query.filename || "resource").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim().slice(0, 255) || "resource";
  const title = (query.title?.trim() || fileName).slice(0, 160);
  const contentType = typeof requestedType === "string" && /^[\w.+-]+\/[\w.+-]+$/.test(requestedType) ? requestedType.slice(0, 120) : "application/octet-stream";
  return { fileName, title, contentType };
}
