import { useEffect, useState } from "react";

type Cadence = "daily" | "weekly";
type CalendarSetting = { calendarId: string; calendarName: string | null; cadence: Cadence | null; eligible: boolean };

export function CalendarEmailUpdates({ departmentId, csrfToken }: { departmentId: string; csrfToken: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<CalendarSetting[]>();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<string>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setRows(undefined);
    setError("");
    void fetch("/api/modules/church-calendar/email-subscriptions", {
      headers: { "x-department-id": departmentId }, signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error("Calendar email updates could not be loaded.");
      const settings = await response.json() as CalendarSetting[];
      if (!controller.signal.aborted) setRows(settings);
    }).catch(() => {
      if (!controller.signal.aborted) setError("Calendar email updates could not be loaded.");
    });
    return () => controller.abort();
  }, [departmentId, open, revision]);

  async function save(calendarId: string, cadence: Cadence | null) {
    if (saving) return;
    setSaving(calendarId);
    setError("");
    try {
      const response = await fetch("/api/modules/church-calendar/calendars/" + calendarId + "/email-subscription", {
        method: "PUT", headers: { "x-department-id": departmentId, "x-csrf-token": csrfToken, "content-type": "application/json" },
        body: JSON.stringify({ cadence }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Calendar email updates could not be saved.");
      }
      setRows((current) => current?.flatMap((row) => row.calendarId !== calendarId ? [row]
        : !row.eligible && !cadence ? [] : [{ ...row, cadence }]));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Calendar email updates could not be saved.");
    } finally { setSaving(undefined); }
  }

  return <section className="church-calendar-public-feed-settings">
    <button className="button button-secondary" type="button" aria-expanded={open} disabled={!!saving}
      onClick={() => setOpen((value) => !value)}>Calendar email updates</button>
    {open && <>
      <p>Get a daily or weekly email when a followed calendar has new appointments. Email must be enabled in Notifications.</p>
      {error && <p role="alert">{error}</p>}
      {error && !rows && <button type="button" className="church-calendar-feed-button" onClick={() => setRevision((value) => value + 1)}>Retry</button>}
      {!rows && !error && <p role="status">Loading calendar email updates…</p>}
      {rows?.length === 0 && <p>No calendars are available for email updates.</p>}
      {rows?.map(({ calendarId, calendarName, cadence, eligible }) => (
        <div key={calendarId}>
          <label>{calendarName ?? "Calendar no longer available"}
            <select value={cadence ?? ""} disabled={!!saving} onChange={(event) => {
              const value = event.target.value;
              void save(calendarId, value === "daily" || value === "weekly" ? value : null);
            }}>
              <option value="">Off</option>
              <option value="daily" disabled={!eligible}>Daily</option>
              <option value="weekly" disabled={!eligible}>Weekly</option>
            </select>
          </label>
          {saving === calendarId && <small role="status">Saving…</small>}
        </div>
      ))}
    </>}
  </section>;
}
