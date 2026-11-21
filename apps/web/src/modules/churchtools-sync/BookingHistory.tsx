import { useEffect, useState } from "react";

type Entry = {
  sourceId: string;
  windowStart: string;
  windowEnd: string;
  title: string | null;
  resourceName: string | null;
  resourceSourceId: string;
  statusId: number;
  occurrenceCount: number;
};
type Detail = {
  subtitle: string | null;
  description: string | null;
  appointmentSourceId: string | null;
  createdBySourceId: string | null;
  modifiedBySourceId: string | null;
  onBehalfOfSourceId: string | null;
  answeredBySourceId: string | null;
  answeredAt: string | null;
  allDay: boolean;
  quantity: number;
  recurrence: { pattern: number | null; interval: number | null; until: string | null; additionalDates: Array<{ date: string }>; excludedDates: Array<{ date: string }> };
  occurrences: Array<{ startDate: string; endDate: string }>;
};

const endpoint = "/api/modules/sync/churchtools/booking-history";
const statuses = ["", "Pending approval", "Approved", "Rejected"];
const recurrencePatterns: Record<number, string> = { 0: "Once", 1: "Daily", 7: "Weekly", 31: "Monthly by date", 32: "Monthly by weekday", 365: "Yearly", 999: "Selected dates" };

export function BookingHistory({ departmentId, revision, t }: { departmentId: string; revision: string; t: (message: string) => string }) {
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<{ entries: Entry[]; nextOffset: number | null } | null>(null);
  const [selected, setSelected] = useState<Entry | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [occurrenceOffset, setOccurrenceOffset] = useState(0);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setError("");
      setPage(null);
      try {
        const response = await fetch(`${endpoint}?offset=${offset}`, { headers: { "x-department-id": departmentId }, signal: controller.signal });
        if (!response.ok) throw new Error();
        setPage(await response.json());
      } catch {
        if (!controller.signal.aborted) setError("Could not load ChurchTools booking history.");
      }
    }
    void load();
    return () => controller.abort();
  }, [departmentId, offset, revision]);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    async function load(entry: Entry) {
      const query = new URLSearchParams({ sourceId: entry.sourceId, startDate: entry.windowStart, endDate: entry.windowEnd });
      try {
        const response = await fetch(`${endpoint}/detail?${query}`, { headers: { "x-department-id": departmentId }, signal: controller.signal });
        if (!response.ok) throw new Error();
        const data = await response.json() as { booking: Detail };
        setDetail(data.booking);
      } catch {
        if (!controller.signal.aborted) setDetailError(true);
      }
    }
    void load(selected);
    return () => controller.abort();
  }, [departmentId, selected, revision]);

  function open(entry: Entry) {
    if (selected === entry) return;
    setDetail(null);
    setDetailError(false);
    setOccurrenceOffset(0);
    setSelected(entry);
  }

  return <section className="directory-card sync-settings-card">
    <div className="directory-heading"><div><h2>{t("ChurchTools booking history")}</h2><p>{t("Read-only booking records from completed migration batches.")}</p></div></div>
    {error && <p role="alert">{t(error)}</p>}
    {!error && !page && <p role="status">{t("Loading booking history…")}</p>}
    {page && page.entries.length === 0 && <p>{t("No booking history has been imported.")}</p>}
    {page?.entries.map((entry) => <div className="sync-feedback" key={`${entry.windowStart}|${entry.windowEnd}|${entry.sourceId}`}>
      <div>
        <strong>{entry.title || t("Private booking")}</strong>
        <p>{entry.resourceName ?? `${t("Resource")} #${entry.resourceSourceId}`} · {t(statuses[entry.statusId])} · {entry.occurrenceCount} {t("occurrences")}</p>
        <small>{entry.windowStart} – {entry.windowEnd} · #{entry.sourceId}</small>
      </div>
      <button type="button" className="button button-secondary" onClick={() => open(entry)}>{t("View booking")}</button>
    </div>)}
    {page && (offset > 0 || page.nextOffset !== null) && <div className="community-inline-actions">
      <button type="button" className="button button-secondary" disabled={!offset} onClick={() => { setSelected(null); setOffset(Math.max(0, offset - 20)); }}>{t("Previous")}</button>
      <button type="button" className="button button-secondary" disabled={page.nextOffset === null} onClick={() => { setSelected(null); setOffset(page.nextOffset ?? offset); }}>{t("Next")}</button>
    </div>}
    {selected && <div className="sync-connection-form" aria-live="polite">
      <div className="community-inline-actions"><h3>{selected.title || t("Private booking")}</h3><button type="button" className="button button-secondary" onClick={() => setSelected(null)}>{t("Close")}</button></div>
      {detailError && <p role="alert">{t("Could not load the selected booking.")}</p>}
      {!detail && !detailError && <p>{t("Loading booking…")}</p>}
      {detail && <>
        {detail.subtitle && <p>{detail.subtitle}</p>}
        {detail.description && <p style={{ whiteSpace: "pre-wrap" }}>{detail.description}</p>}
        <p>{t("Quantity")} {detail.quantity}{detail.allDay ? ` · ${t("All day")}` : ""}{detail.appointmentSourceId ? ` · ${t("ChurchTools appointment")} #${detail.appointmentSourceId}` : ""}</p>
        {detail.answeredAt && <p>{t("Answered on")} {detail.answeredAt}{detail.answeredBySourceId ? ` · ${t("ChurchTools person")} #${detail.answeredBySourceId}` : ""}</p>}
        {detail.createdBySourceId && <p>{t("Created by ChurchTools person")} #{detail.createdBySourceId}</p>}
        {detail.modifiedBySourceId && <p>{t("Modified by ChurchTools person")} #{detail.modifiedBySourceId}</p>}
        {detail.onBehalfOfSourceId && <p>{t("Booked for ChurchTools person")} #{detail.onBehalfOfSourceId}</p>}
        {detail.recurrence.pattern !== null && recurrencePatterns[detail.recurrence.pattern] && <p>
          {t(recurrencePatterns[detail.recurrence.pattern])}
          {detail.recurrence.interval && detail.recurrence.interval > 1 ? ` · ${t("Repeat interval")} ${detail.recurrence.interval}` : ""}
          {detail.recurrence.until ? ` · ${t("Through")} ${detail.recurrence.until}` : ""}
        </p>}
        {detail.recurrence.additionalDates.length > 0 && <p>{t("Additional dates")} · {detail.recurrence.additionalDates.map((date) => date.date).join(", ")}</p>}
        {detail.recurrence.excludedDates.length > 0 && <p>{t("Excluded dates")} · {detail.recurrence.excludedDates.map((date) => date.date).join(", ")}</p>}
        <ul>{detail.occurrences.slice(occurrenceOffset, occurrenceOffset + 20).map((occurrence) =>
          <li key={occurrence.startDate}>{occurrence.startDate} – {occurrence.endDate}</li>)}</ul>
        {detail.occurrences.length > 20 && <div className="community-inline-actions">
          <button type="button" className="button button-secondary" disabled={occurrenceOffset === 0} onClick={() => setOccurrenceOffset(occurrenceOffset - 20)}>{t("Previous occurrences")}</button>
          <button type="button" className="button button-secondary" disabled={occurrenceOffset + 20 >= detail.occurrences.length} onClick={() => setOccurrenceOffset(occurrenceOffset + 20)}>{t("Next occurrences")}</button>
        </div>}
      </>}
    </div>}
  </section>;
}
