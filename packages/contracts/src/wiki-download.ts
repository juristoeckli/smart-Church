const uuid = "[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}";
const downloadPath = new RegExp(`^/api/modules/wiki/pages/${uuid}/files/${uuid}/download(?:\\?departmentId=${uuid})?$`, "i");

export function isWikiAttachmentDownloadPath(path: string): boolean {
  return downloadPath.test(path);
}

export function wikiAttachmentDownloadPath(pageId: string, fileId: string, departmentId: string) {
  return `/api/modules/wiki/pages/${encodeURIComponent(pageId)}/files/${encodeURIComponent(fileId)}/download?${new URLSearchParams({ departmentId })}`;
}

export function wikiAttachmentSignInLocation(method: string, path: string, fetchMode: string | string[] | undefined, accept?: string) {
  const navigation = fetchMode === "navigate" || (fetchMode === undefined && accept?.includes("text/html"));
  if (method !== "GET" || !navigation || !isWikiAttachmentDownloadPath(path)) return null;
  return "/?" + new URLSearchParams({ wikiDownload: path });
}
