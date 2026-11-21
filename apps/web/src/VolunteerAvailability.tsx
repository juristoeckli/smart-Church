import { useEffect, useState, type FormEvent } from "react";

type Range = { startsOn: string; endsOn: string };
type Row = Range & { id: string; startsAt?: string; endsAt?: string; startsAtUtc?: string; endsAtUtc?: string };
type Translate = (message: string) => string;
const endpoint = "/api/events/volunteer-absences";
const empty = { startsOn: "", endsOn: "" };

function ChurchToolsAbsenceConsent({ departmentId, csrfToken, t }: { departmentId: string; csrfToken: string; t: Translate }) {
  const consentEndpoint = `${endpoint}/churchtools-consent`;
  const [available, setAvailable] = useState(false);
  const [current, setCurrent] = useState<Range | null>(null);
  const [draft, setDraft] = useState<Range>(empty);
  const [allowTimed, setAllowTimed] = useState(false);
  const [grantedTimed, setGrantedTimed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch(consentEndpoint, { signal: controller.signal, headers: { "x-department-id": departmentId } }).then(async (response) => {
      const result = await response.json() as { available: boolean; range: Range | null; allowTimed: boolean; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not load ChurchTools import permission.");
      if (controller.signal.aborted) return;
      setAvailable(result.available);
      setCurrent(result.range);
      setDraft(result.range ?? empty);
      setAllowTimed(result.allowTimed);
      setGrantedTimed(result.allowTimed);
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Could not load ChurchTools import permission.");
    });
    return () => controller.abort();
  }, [consentEndpoint, departmentId]);

  async function update(grant: boolean) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(consentEndpoint, {
        method: grant ? "PUT" : "DELETE", headers: { "x-department-id": departmentId, "x-csrf-token": csrfToken,
          ...(grant ? { "Content-Type": "application/json" } : {}) },
        ...(grant ? { body: JSON.stringify({ ...draft, allowTimed }) } : {}),
      });
      const result = await response.json() as { range: Range | null; allowTimed: boolean; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not save ChurchTools import permission.");
      setCurrent(result.range);
      setDraft(result.range ?? empty);
      setAllowTimed(result.allowTimed);
      setGrantedTimed(result.allowTimed);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save ChurchTools import permission."); }
    finally { setBusy(false); }
  }
  if (!available) return error ? <p role="alert">{t(error)}</p> : null;
  return <section>
    <h3>{t("ChurchTools absence import permission")}</h3>
    <p>{t("Allow a site administrator to copy your all-day ChurchTools absences for these dates. You can also choose to share timed absences in this range.")}</p>
    {current && <p role="status">{t("Permission active")} · {current.startsOn} – {current.endsOn}{grantedTimed && ` · ${t("Includes timed absences")}`}</p>}
    <form onSubmit={(event) => { event.preventDefault(); void update(true); }}>
      <fieldset disabled={busy}>
        <div className="form-row">
          <label>{t("First allowed day")}<input type="date" required value={draft.startsOn} max={draft.endsOn || undefined}
            onChange={(event) => setDraft({ ...draft, startsOn: event.target.value })} /></label>
          <label>{t("Last allowed day")}<input type="date" required value={draft.endsOn} min={draft.startsOn || undefined}
            onChange={(event) => setDraft({ ...draft, endsOn: event.target.value })} /></label>
        </div>
        <label><input type="checkbox" checked={allowTimed} onChange={(event) => setAllowTimed(event.target.checked)} />
          {t("Include timed absences in this location’s time zone. The administrator can review the exact start and end times.")}</label>
        <button type="submit" className="button button-secondary">{t("Allow date import")}</button>
        {current && <button type="button" className="button button-secondary" onClick={() => void update(false)}>{t("Revoke permission")}</button>}
      </fieldset>
    </form>
    {error && <p role="alert">{t(error)}</p>}
  </section>;
}

export function VolunteerAvailability({ departmentId, csrfToken, t }: {
  departmentId: string; csrfToken: string; t: Translate;
}) {
  const [open, setOpen] = useState(false);
  const [linked, setLinked] = useState<boolean | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [draft, setDraft] = useState<Range>(empty);
  const [timeZone, setTimeZone] = useState<string | null>(null);
  const [timed, setTimed] = useState(false);
  const [clock, setClock] = useState({ startsAt: "", endsAt: "" });
  const [editing, setEditing] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void fetch(endpoint, { signal: controller.signal, headers: { "x-department-id": departmentId } }).then(async (response) => {
      const result = await response.json() as { linked: boolean; timeZone: string | null; rows: Row[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not load volunteer availability.");
      setLinked(result.linked);
      setTimeZone(result.timeZone);
      setRows(result.rows);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load volunteer availability.");
    });
    return () => controller.abort();
  }, [departmentId, open]);

  function stopEditing() { setEditing(""); setDraft(empty); setTimed(false); setClock({ startsAt: "", endsAt: "" }); }
  async function mutate(method: "POST" | "PUT" | "DELETE", id?: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(id ? `${endpoint}/${id}` : endpoint, {
        method, headers: { "x-department-id": departmentId, "x-csrf-token": csrfToken,
          ...(method === "DELETE" ? {} : { "Content-Type": "application/json" }) },
        ...(method === "DELETE" ? {} : { body: JSON.stringify(timed ? clock : draft) }),
      });
      const result = await response.json() as Row & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not save volunteer availability.");
      setRows((current) => method === "DELETE" ? current.filter((row) => row.id !== id)
        : [...current.filter((row) => row.id !== result.id), result].sort((a, b) => a.startsOn.localeCompare(b.startsOn)));
      stopEditing();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save volunteer availability."); }
    finally { setBusy(false); }
  }
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void mutate(editing ? "PUT" : "POST", editing || undefined);
  }
  return <details className="directory-card" onToggle={(event) => { setError(""); setOpen(event.currentTarget.open); }}>
    <summary>{t("My volunteer availability")}</summary>
    {open && <>
      <p>{t("Record all-day or timed absences. Event managers see an availability warning if you are already assigned to an overlapping event.")}</p>
      {linked === null && !error && <p role="status">{t("Loading availability…")}</p>}
      {linked === false && <p>{t("Link your account to a People record at this location to use volunteer availability.")}</p>}
      {linked && <>
        {rows.length ? <ul>{rows.map((row) => <li key={row.id}>
          <span title={row.startsAtUtc && row.endsAtUtc ? `${row.startsAtUtc} – ${row.endsAtUtc}` : undefined}>{row.startsAt && row.endsAt ? `${row.startsAt.replace("T", " ")} – ${row.endsAt.replace("T", " ")}`
            : row.startsOn + (row.endsOn !== row.startsOn ? ` – ${row.endsOn}` : "")}</span>{" "}
          <button type="button" className="button button-secondary" disabled={busy}
            onClick={() => {
              setEditing(row.id);
              setDraft({ startsOn: row.startsOn, endsOn: row.endsOn });
              setTimed(!!row.startsAt);
              setClock({ startsAt: row.startsAt ?? "", endsAt: row.endsAt ?? "" });
            }}>{t("Edit absence")}</button>{" "}
          <button type="button" className="button button-secondary" disabled={busy} onClick={() => void mutate("DELETE", row.id)}>{t("Remove absence")}</button>
        </li>)}</ul> : <p>{t("No absences recorded.")}</p>}
        <form onSubmit={save}>
          <fieldset disabled={busy}>
            <label>{t("Absence type")}<select value={timed ? "time" : "days"} onChange={(event) => setTimed(event.target.value === "time")}>
              <option value="days">{t("All day")}</option><option value="time" disabled={!timeZone}>{t("Timed")}</option>
            </select></label>
            {timed ? <>
              <p>{timeZone} · {t("New times in a repeated clock hour use the later occurrence.")}</p>
              <div className="form-row">
                <label>{t("Starts at")}<input type="datetime-local" step="1" required value={clock.startsAt}
                  onChange={(event) => setClock({ ...clock, startsAt: event.target.value })} /></label>
                <label>{t("Ends at")}<input type="datetime-local" step="1" required value={clock.endsAt}
                  onChange={(event) => setClock({ ...clock, endsAt: event.target.value })} /></label>
              </div>
            </> : <div className="form-row">
              <label>{t("First day")}<input type="date" required value={draft.startsOn} max={draft.endsOn || undefined}
                onChange={(event) => setDraft({ ...draft, startsOn: event.target.value })} /></label>
              <label>{t("Last day (inclusive)")}<input type="date" required value={draft.endsOn} min={draft.startsOn || undefined}
                onChange={(event) => setDraft({ ...draft, endsOn: event.target.value })} /></label>
            </div>}
            <button type="submit" className="button button-primary">{t(editing ? "Save absence" : "Add absence")}</button>
            {editing && <button type="button" className="button button-secondary" onClick={stopEditing}>{t("Cancel editing")}</button>}
          </fieldset>
        </form>
        <ChurchToolsAbsenceConsent departmentId={departmentId} csrfToken={csrfToken} t={t} />
      </>}
      {error && <p role="alert">{t(error)}</p>}
    </>}
  </details>;
}

export function EventVolunteerAvailabilityWarning({ departmentId, eventId, t }: { departmentId: string; eventId: string; t: Translate }) {
  const [conflicts, setConflicts] = useState<Array<{ positionIndex: number; name: string }>>([]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/events/${eventId}/volunteer-conflicts`, { signal: controller.signal, headers: { "x-department-id": departmentId } })
      .then(async (response) => {
        if (response.ok && !controller.signal.aborted) setConflicts((await response.json() as { conflicts: typeof conflicts }).conflicts);
      }).catch(() => {});
    return () => controller.abort();
  }, [departmentId, eventId]);
  return conflicts.length ? <section className="event-details-section">
    <h3>{t("Volunteer availability conflicts")}</h3>
    <ul>{conflicts.map(({ positionIndex, name }) => <li key={positionIndex}>{name} · {t("slot")} {positionIndex + 1}</li>)}</ul>
  </section> : null;
}
