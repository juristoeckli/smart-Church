type SourceObject = Record<string, unknown>;

export function bookingSourceId(value: unknown): string | null {
  const id = typeof value === "number" || typeof value === "string" ? String(value) : "";
  return /^[1-9]\d{0,15}$/.test(id) && Number.isSafeInteger(Number(id)) ? id : null;
}

const object = (value: unknown): SourceObject | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as SourceObject : undefined;
const string = (value: unknown, limit: number) => typeof value === "string" ? value.slice(0, limit) : null;
const integer = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) ? value : null;

function date(value: unknown) {
  if (typeof value !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value) || !Number.isFinite(Date.parse(value))) return null;
  const calendarDate = value.slice(0, 10);
  if (new Date(calendarDate).toISOString().slice(0, 10) !== calendarDate) return null;
  return value;
}

function dates(value: unknown, anonymized: boolean) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = object(item);
    const localDate = date(row?.date);
    const meta = object(row?.meta);
    return localDate ? [{
      date: localDate,
      sourceId: bookingSourceId(row?.id),
      isRepeated: row?.isRepeated === true,
      modifiedAt: date(meta?.modifiedDate),
      modifiedBySourceId: anonymized ? null : bookingSourceId(meta?.modifiedPid ?? object(meta?.modifiedPerson)?.id),
    }] : [];
  });
}

export function normalizeChurchToolsBookingHistory(payloads: readonly unknown[], resourceIds: ReadonlySet<string>) {
  const series = new Map<string, ReturnType<typeof bookingSeries>>();
  let occurrenceCount = 0;
  for (const payload of payloads) {
    const result = object(payload);
    if (!Array.isArray(result?.data) || object(result.meta)?.count !== result.data.length) throw new Error("ChurchTools returned an incomplete booking occurrence list.");
    occurrenceCount += result.data.length;
    if (occurrenceCount > 20_000) throw new Error("ChurchTools returned more than 20,000 booking occurrences. Narrow the migration date range.");
    for (const item of result.data) {
      const booking = object(object(item)?.booking);
      const base = object(booking?.base);
      const occurrence = object(booking?.calculated);
      const sourceId = bookingSourceId(base?.id);
      const resourceSourceId = bookingSourceId(base?.resourceId);
      const startDate = date(occurrence?.startDate);
      const endDate = date(occurrence?.endDate);
      if (!base || !sourceId || !resourceSourceId || !resourceIds.has(resourceSourceId) || !startDate || !endDate
        || Date.parse(endDate) < Date.parse(startDate) || (!base.allDay && Date.parse(endDate) === Date.parse(startDate))) {
        throw new Error("ChurchTools returned a booking occurrence with missing or invalid IDs or dates.");
      }
      const next = bookingSeries(base, sourceId, resourceSourceId);
      const record = series.get(sourceId);
      if (record && record.fingerprint !== next.fingerprint) throw new Error("ChurchTools changed a booking during preview. Run a fresh migration preview.");
      const current = record ?? next;
      const localDate = /^\d{4}-\d{2}-\d{2}$/.test(startDate);
      const occurrenceKey = localDate ? startDate : new Date(startDate).toISOString();
      const prior = current.occurrences.get(occurrenceKey);
      if (prior && Date.parse(prior.endDate) !== Date.parse(endDate)) throw new Error("ChurchTools returned conflicting dates for one booking occurrence.");
      if (!prior) current.occurrences.set(occurrenceKey, { startDate, endDate });
      series.set(sourceId, current);
    }
  }
  return [...series.values()].map(({ snapshot, occurrences }) => ({
    ...snapshot,
    occurrences: [...occurrences.values()].sort((first, second) => Date.parse(first.startDate) - Date.parse(second.startDate)),
  }));
}

function bookingSeries(base: SourceObject, sourceId: string, resourceSourceId: string) {
  const statusId = integer(base.statusId);
  const quantity = integer(base.quantity);
  if (!statusId || ![1, 2, 3].includes(statusId) || !quantity || quantity < 1 || typeof base.allDay !== "boolean" || typeof base.isAnonymized !== "boolean") {
    throw new Error("ChurchTools returned a booking with an invalid visibility, approval, or quantity.");
  }
  const anonymized = base.isAnonymized;
  const appointment = object(base.appointment);
  const meta = object(base.meta);
  const snapshot = {
    sourceId, resourceSourceId, anonymized, statusId, quantity,
    title: anonymized ? null : string(base.title, 255),
    subtitle: anonymized ? null : string(base.subtitle, 255),
    description: anonymized ? null : string(base.description, 4096),
    appointmentSourceId: anonymized ? null : bookingSourceId(appointment?.id ?? base.appointmentId),
    calendarSourceId: anonymized ? null : bookingSourceId(appointment?.calendarId),
    createdBySourceId: anonymized ? null : bookingSourceId(object(meta?.createdPerson)?.id),
    modifiedBySourceId: anonymized ? null : bookingSourceId(object(meta?.modifiedPerson)?.id),
    onBehalfOfSourceId: anonymized ? null : bookingSourceId(base.onBehalfOfPid),
    answeredBySourceId: anonymized ? null : bookingSourceId(base.answeredPid),
    answeredAt: date(base.answeredDate),
    createdAt: date(meta?.createdDate),
    modifiedAt: date(meta?.modifiedDate),
    allDay: base.allDay,
    startDate: date(base.startDate),
    endDate: date(base.endDate),
    showInCalendar: base.showInCal === true,
    version: integer(base.version),
    recurrence: { pattern: integer(base.repeatId), interval: integer(base.repeatFrequency), option: integer(base.repeatOption), until: date(base.repeatUntil), additionalDates: dates(base.additionals, anonymized), excludedDates: dates(base.exceptions, anonymized) },
  };
  return { snapshot, fingerprint: JSON.stringify(snapshot), occurrences: new Map<string, { startDate: string; endDate: string }>() };
}

export type ChurchToolsBookingHistory = ReturnType<typeof normalizeChurchToolsBookingHistory>[number];
