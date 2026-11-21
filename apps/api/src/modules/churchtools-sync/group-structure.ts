type Row = Record<string, unknown>;
const object = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
export function groupSourceId(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : null;
}
export function groupSourceGuid(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : null;
}
function name(value: unknown, max: number) {
  if (typeof value !== "string" || /[\p{Cc}\p{Cf}]/u.test(value)) return null;
  const text = value.trim();
  return text.length && text.length <= max ? text : null;
}
export function readStructureGroup(payload: unknown, expected: string) {
  const row = object(object(payload)?.data);
  const guid = groupSourceGuid(row?.guid);
  const title = name(row?.name, 120);
  const fields = object(row?.information);
  if (!row || groupSourceId(row.id) !== expected || !guid || !title) return null;
  return { guid, title, public: object(row.settings)?.visibility === "public", typeId: groupSourceId(fields?.groupTypeId),
    categoryId: fields?.groupCategoryId === null ? null : groupSourceId(fields?.groupCategoryId) ?? undefined };
}

export function readStructureDefinition(payload: unknown, catalog: "groupTypes" | "groupCategories", id: string | null | undefined) {
  const rows = object(object(payload)?.data)?.[catalog];
  if (!id || !Array.isArray(rows)) return null;
  const matches = rows.map(object).filter((row) => groupSourceId(row?.id) === id);
  const label = name(matches[0]?.name, catalog === "groupTypes" ? 80 : 100);
  return matches.length === 1 && label ? { id, name: label } : null;
}

export function singleVisibleParent(payload: unknown) {
  const response = object(payload);
  const data = response?.data;
  if (!Array.isArray(data) || data.length !== 1 || object(response?.meta)?.count !== 1) return null;
  const parent = object(data[0]);
  const parentId = parent?.domainIdentifier;
  return parent?.domainType === "group" && typeof parentId === "string" && /^[1-9][0-9]{0,15}$/.test(parentId)
    && Number.isSafeInteger(Number(parentId)) ? parentId : null;
}

export function confirmsPublicStructureEdge(payload: unknown, childId: string, parentId: string) {
  const response = object(payload);
  const data = response?.data;
  if (!Array.isArray(data) || data.length !== 2 || object(response?.meta)?.count !== 2 || childId === parentId) return false;
  const rows = data.map(object);
  function visibleRow(id: string) {
    const row = rows.find((entry) => groupSourceId(entry?.groupId) === id);
    const group = object(row?.group);
    return group?.domainType === "group" && group.domainIdentifier === id && object(group.domainAttributes)?.visibility === "public" ? row : null;
  }
  const child = visibleRow(childId);
  const parent = visibleRow(parentId);
  const children = parent?.children;
  return Array.isArray(child?.parents) && child.parents.length === 1 && groupSourceId(child.parents[0]) === parentId
    && Array.isArray(children) && children.filter((id) => groupSourceId(id) === childId).length === 1;
}
