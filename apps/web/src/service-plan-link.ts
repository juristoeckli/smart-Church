const uuid = "[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}";
const planHash = new RegExp("^#services-events/(" + uuid + ")/(" + uuid + ")$", "i");

export function servicePlanLinkFromHash(hash: string) {
  const match = planHash.exec(hash);
  return match ? { departmentId: match[1].toLowerCase(), eventId: match[2].toLowerCase() } : null;
}

export function servicePlanLinkUrl(currentUrl: string, departmentId: string, eventId: string): string {
  const url = new URL(currentUrl);
  url.search = "";
  url.hash = "#services-events/" + departmentId + "/" + eventId;
  return url.href;
}
