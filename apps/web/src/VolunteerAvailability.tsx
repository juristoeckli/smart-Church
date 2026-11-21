import { useEffect, useState, type FormEvent } from "react";

type Range = { startsOn: string; endsOn: string };
type Row = Range & { id: string };
type Translate = (message: string) => string;
const endpoint = "/api/events/volunteer-absences";
const empty = { startsOn: "", endsOn: "" };

export function VolunteerAvailability({ departmentId, csrfToken, t }: {
  departmentId: string; csrfToken: string; t: Translate;
}) {
  const [open, setOpen] = useState(false);
  const [linked, setLinked] = useState<boolean | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [draft, setDraft] = useState<Range>(empty);
  const [editing, setEditing] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void fetch(endpoint, { signal: controller.signal, headers: { "x-department-id": departmentId } }).then(async (response) => {
      const result = await response.json() as { linked: boolean; rows: Row[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not load volunteer availability.");
      setLinked(result.linked);
      setRows(result.rows);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load volunteer availability.");
    });
    return () => controller.abort();
  }, [departmentId, open]);

  function stopEditing() { setEditing(""); setDraft(empty); }
  async function mutate(method: "POST" | "PUT" | "DELETE", id?: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(id ? `${endpoint}/${id}` : endpoint, {
        method, headers: { "x-department-id": departmentId, "x-csrf-token": csrfToken,
          ...(method === "DELETE" ? {} : { "Content-Type": "application/json" }) },
        ...(method === "DELETE" ? {} : { body: JSON.stringify(draft) }),
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
      <p>{t("Record all-day absences. Event managers see an availability warning if you are already assigned to an overlapping event.")}</p>
      {linked === null && !error && <p role="status">{t("Loading availability…")}</p>}
      {linked === false && <p>{t("Link your account to a People record at this location to use volunteer availability.")}</p>}
      {linked && <>
        {rows.length ? <ul>{rows.map((row) => <li key={row.id}>
          <span>{row.startsOn}{row.endsOn !== row.startsOn ? ` – ${row.endsOn}` : ""}</span>{" "}
          <button type="button" className="button button-secondary" disabled={busy}
            onClick={() => { setEditing(row.id); setDraft({ startsOn: row.startsOn, endsOn: row.endsOn }); }}>{t("Edit dates")}</button>{" "}
          <button type="button" className="button button-secondary" disabled={busy} onClick={() => void mutate("DELETE", row.id)}>{t("Remove absence")}</button>
        </li>)}</ul> : <p>{t("No absences recorded.")}</p>}
        <form onSubmit={save}>
          <fieldset disabled={busy}>
            <div className="form-row">
              <label>{t("First day")}<input type="date" required value={draft.startsOn} max={draft.endsOn || undefined}
                onChange={(event) => setDraft({ ...draft, startsOn: event.target.value })} /></label>
              <label>{t("Last day (inclusive)")}<input type="date" required value={draft.endsOn} min={draft.startsOn || undefined}
                onChange={(event) => setDraft({ ...draft, endsOn: event.target.value })} /></label>
            </div>
            <button type="submit" className="button button-primary">{t(editing ? "Save absence" : "Add absence")}</button>
            {editing && <button type="button" className="button button-secondary" onClick={stopEditing}>{t("Cancel editing")}</button>}
          </fieldset>
        </form>
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
