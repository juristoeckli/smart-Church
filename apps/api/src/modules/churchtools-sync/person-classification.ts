type Row = Record<string, unknown>;
const object = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Row : null;

function sourceId(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : null;
}

function safeName(value: unknown, maxLength: number) {
  if (typeof value !== "string" || /[\p{Cc}\p{Cf}]/u.test(value)) return null;
  const name = value.trim();
  return name.length > 0 && name.length <= maxLength ? name : null;
}

export function churchToolsPersonStatus(person: unknown, masterdata: unknown) {
  const data = object(object(person)?.data);
  const id = sourceId(data?.statusId);
  const statuses = object(object(masterdata)?.data)?.statuses;
  if (!id || !Array.isArray(statuses)) return null;
  const definitions = statuses.map(object).filter((row) => sourceId(row?.id) === id);
  if (definitions.length !== 1) return null;
  const definition = definitions[0];
  const name = safeName(definition?.name, 50);
  if (!name || typeof definition?.isMember !== "boolean") return null;
  const proposed: "member" | "visitor" | null = data?.isArchived === false && data.isDead === false
    ? definition.isMember ? "member" : "visitor"
    : null;
  return { sourceId: id, name, isMember: definition.isMember, proposed };
}

export function churchToolsPersonTags(payload: unknown) {
  const data = object(payload);
  const tags = data?.data;
  if (!Array.isArray(tags) || tags.length > 500 || object(data?.meta)?.count !== tags.length) return null;
  const seen = new Set<string>();
  const valid = [];
  for (const tag of tags) {
    const row = object(tag);
    const id = sourceId(row?.id);
    const name = safeName(row?.name, 100);
    if (!id || !name || seen.has(id)) return null;
    seen.add(id);
    valid.push({ sourceId: id, name });
  }
  return valid;
}
