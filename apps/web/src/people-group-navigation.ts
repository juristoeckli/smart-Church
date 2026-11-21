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
