const groupIdPattern = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;

export function peopleGroupNavigationState(groupId: string, requestId: number) {
  return groupIdPattern.test(groupId) && Number.isSafeInteger(requestId) && requestId > 0
    ? "group-members:" + groupId.toLowerCase() + ":" + requestId
    : null;
}

export function groupFromPeopleNavigation(state: string) {
  const [kind, id, requestId, ...extra] = state.split(":");
  return kind === "group-members" && id && requestId && extra.length === 0 && /^[1-9]\d*$/.test(requestId)
    && peopleGroupNavigationState(id, Number(requestId)) === "group-members:" + id.toLowerCase() + ":" + requestId
    ? id.toLowerCase()
    : null;
}

export function isPeopleTagLookup(query: string) {
  return /^tag:/i.test(query.trim());
}

export function peopleTagNavigationState(query: string, requestId: number) {
  const term = query.trim();
  return isPeopleTagLookup(term) && term.slice(4).trim() && term.length <= 100
    && !/[\u0000-\u001f\u007f]/.test(term) && Number.isSafeInteger(requestId) && requestId > 0
    ? `people-tag:${requestId}:${term}`
    : null;
}

export function tagFromPeopleNavigation(state: string) {
  const match = /^people-tag:([1-9]\d*):(.+)$/.exec(state);
  return match && peopleTagNavigationState(match[2], Number(match[1])) === state ? match[2] : null;
}
