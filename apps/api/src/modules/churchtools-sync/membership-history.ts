type Raw = Record<string, unknown>;
const object = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Raw : null;
const id = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : null;
const supportedStates = new Set(["active", "requested", "waiting", "to_delete"]);
export const membershipHistoryPageSize = 20;

function day(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? value : undefined;
}

function state(raw: unknown) {
  const row = object(raw);
  if (!row) return null;
  const roleId = row.memberRoleId === null ? null : id(row.memberRoleId);
  if (roleId === null && row.memberRoleId !== null) return null;
  const { membershipStatus } = row;
  if (membershipStatus !== null && (typeof membershipStatus !== "string" || !supportedStates.has(membershipStatus))) return null;
  const startsOn = day(row.startDate);
  const endsOn = day(row.endDate);
  if (startsOn === undefined || endsOn === undefined) return null;
  return { roleId, status: membershipStatus, startsOn, endsOn };
}

export function personalChurchToolsId(payload: unknown) {
  return id(object(object(payload)?.data)?.id);
}

export function isVisibleChurchToolsHistoryPerson(payload: unknown, requested: string) {
  const person = object(object(payload)?.data);
  return id(person?.id) === requested && person?.visibility === "visible";
}

export function readChurchToolsMembershipHistoryPage(payload: unknown, groupId: string, offsetId?: string) {
  const response = object(payload);
  const data = response?.data;
  if (!Array.isArray(data) || data.length > membershipHistoryPageSize || object(response?.meta)?.count !== data.length) {
    throw new Error("ChurchTools returned an incomplete group-history batch.");
  }
  let boundary = offsetId ? Number(offsetId) : Number.POSITIVE_INFINITY;
  const rows = data.flatMap((value) => {
    const row = object(value);
    const sourceId = id(row?.id);
    const personId = id(row?.memberId);
    if (!row || !sourceId || !personId || id(row.groupId) !== groupId || Number(sourceId) >= boundary) {
      throw new Error("ChurchTools returned a mismatched or unsorted group-history batch.");
    }
    boundary = Number(sourceId);
    const previous = state(row.previous);
    const current = state(row.current);
    const created = object(row.meta)?.createdDate;
    if (!previous || !current || JSON.stringify(previous) === JSON.stringify(current)
      || typeof created !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(created)
    ) return [];
    const instant = Date.parse(created);
    const normalized = created.replace(/(?:\.(\d{1,3}))?Z$/, (_suffix, fraction: string | undefined) => `.${(fraction ?? "").padEnd(3, "0")}Z`);
    if (!Number.isFinite(instant) || new Date(instant).toISOString() !== normalized) return [];
    return [{ sourceId, personId, changedAt: normalized, previous, current }];
  });
  return { rows, nextOffset: data.length === membershipHistoryPageSize ? String(boundary) : null };
}

type CursorBinding = { departmentId: string; instanceUrl: string; groupId: string; ownerSourceId: string; actor: string };

export function membershipHistoryCursor(binding: CursorBinding, offsetId: string, now = Date.now()) {
  return { ...binding, offsetId, expiresAt: now + 15 * 60_000 };
}

export function readMembershipHistoryCursor(value: unknown, binding: CursorBinding, now = Date.now()) {
  const parsed = object(value);
  if (!parsed || !Object.entries(binding).every(([key, expected]) => parsed[key] === expected)
    || typeof parsed.expiresAt !== "number" || parsed.expiresAt <= now
    || typeof parsed.offsetId !== "string" || !/^[1-9][0-9]{0,15}$/.test(parsed.offsetId)
    || !Number.isSafeInteger(Number(parsed.offsetId))) return null;
  return parsed.offsetId;
}
