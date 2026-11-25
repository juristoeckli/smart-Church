import { useEffect, useState } from "react";

type Schedule = { leadDays: number; templateGroupId?: string | null };

export function CalendarSignupSchedule({ appointmentId, departmentId, csrfToken, templates }: {
  appointmentId: string; departmentId: string; csrfToken: string; templates: Array<{ id: string; name: string }>;
}) {
  const url = "/api/modules/church-calendar/appointments/" + appointmentId + "/signup-schedule";
  const [schedule, setSchedule] = useState<Schedule | null>();
  const [leadDays, setLeadDays] = useState("14");
  const [templateGroupId, setTemplateGroupId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch(url, { headers: { "x-department-id": departmentId }, cache: "no-store", signal: controller.signal }).then(async (response) => {
      const body = await response.json() as { schedule: Schedule | null; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not load registration scheduling.");
      if (controller.signal.aborted) return;
      setSchedule(body.schedule);
      setLeadDays(String(body.schedule?.leadDays ?? 14));
      setTemplateGroupId(body.schedule?.templateGroupId ?? "");
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load registration scheduling.");
    });
    return () => controller.abort();
  }, [url, departmentId]);

  async function save(next: Schedule | null) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(url, {
        method: "PUT", headers: { "content-type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken },
        body: JSON.stringify({ schedule: next }),
      });
      const body = await response.json() as { schedule: Schedule | null; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not save registration scheduling.");
      setSchedule(body.schedule);
      setMessage(next ? "Draft signup scheduling saved." : "Draft signup scheduling disabled.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save registration scheduling.");
    } finally { setBusy(false); }
  }

  const days = Number(leadDays);
  return <div className="church-calendar-extra-date wide">
    <strong>Scheduled draft registration groups</strong>
    <p>Create unpublished drafts as dates fall within the lead time. Disabling this schedule keeps existing groups.</p>
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {schedule !== undefined && <>
      <small>{schedule ? `Scheduled ${schedule.leadDays} days ahead` : "Scheduling is disabled"}</small>
      <label>Days before each appointment
        <input inputMode="numeric" value={leadDays} onChange={(event) => setLeadDays(event.target.value)} />
      </label>
      {(templates.length > 0 || templateGroupId) && <label>Scheduled signup form template
        <select value={templateGroupId} onChange={(event) => setTemplateGroupId(event.target.value)}>
          <option value="">Blank signup form</option>
          {templateGroupId && !templates.some(({ id }) => id === templateGroupId) && <option value={templateGroupId}>Saved template</option>}
          {templates.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
        </select>
      </label>}
      <button type="button" disabled={busy || !leadDays || !Number.isInteger(days) || days < 0 || days > 365}
        onClick={() => void save({ leadDays: days, ...(templateGroupId ? { templateGroupId } : {}) })}>Save draft schedule</button>
      {schedule && <button type="button" disabled={busy} onClick={() => void save(null)}>Disable draft schedule</button>}
    </>}
  </div>;
}
