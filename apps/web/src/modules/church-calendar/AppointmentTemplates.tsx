import { useEffect, useRef, useState } from "react";
import type { AppointmentTemplate, AppointmentTemplateFields } from "./appointment-template-draft";

type DraftFields = AppointmentTemplateFields & { tags: string };

export function AppointmentTemplates({ departmentId, calendarId, csrfToken, draft, apply }: {
  departmentId: string; calendarId: string; csrfToken: string; draft: DraftFields; apply: (template: AppointmentTemplate) => void;
}) {
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<AppointmentTemplate[] | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const lifetime = useRef<AbortController | null>(null);
  const path = `/api/modules/church-calendar/calendars/${calendarId}/appointment-templates`;
  const selected = templates?.find((template) => template.id === selectedId);

  useEffect(() => {
    const active = new AbortController();
    lifetime.current = active;
    return () => active.abort();
  }, []);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setTemplates(null);
    setError("");
    async function load() {
      try {
        const response = await fetch(path, { signal: controller.signal, headers: { "x-department-id": departmentId } });
        if (!response.ok) throw new Error("Could not load appointment templates.");
        const rows = await response.json() as AppointmentTemplate[];
        if (!controller.signal.aborted) setTemplates(rows);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load appointment templates.");
      }
    }
    void load();
    return () => controller.abort();
  }, [departmentId, open, path]);

  async function change(action: "create" | "update" | "delete") {
    const id = action === "create" ? "" : selected?.id;
    if (id === undefined || (action === "delete" && !window.confirm(`Delete template “${selected?.name}”?`))) return;
    const signal = lifetime.current?.signal;
    setBusy(true); setError(""); setNotice("");
    try {
      const { title, subtitle, description, place, url, internalOnly, tags } = draft;
      const response = await fetch(id ? `${path}/${id}` : path, {
        method: action === "create" ? "POST" : action === "update" ? "PUT" : "DELETE", signal,
        headers: { "x-department-id": departmentId, "x-csrf-token": csrfToken,
          ...(action !== "delete" ? { "content-type": "application/json" } : {}) },
        ...(action !== "delete" ? { body: JSON.stringify({ name: name.trim(), title, subtitle, description, place, url,
          internalOnly, tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean) }) } : {}),
      });
      const payload = await response.json() as AppointmentTemplate & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not update appointment templates.");
      if (signal?.aborted) return;
      setTemplates((current) => action === "delete" ? (current ?? []).filter((template) => template.id !== id)
        : [...(current ?? []).filter((template) => template.id !== payload.id), payload].sort((a, b) => a.name.localeCompare(b.name)));
      if (action === "delete") { setSelectedId(""); setName(""); }
      else { setSelectedId(payload.id); setName(payload.name); }
      setNotice(action === "delete" ? "Appointment template deleted." : "Appointment template saved.");
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "Could not update appointment templates.");
    } finally { if (!signal?.aborted) setBusy(false); }
  }

  return <details className="church-calendar-extra-date wide" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Appointment templates</summary>
    {open && <div className="church-calendar-form-grid">
      <p className="wide">A template fills the title and details on this draft. Dates, recurrence, and linked records stay as selected.</p>
      {error && <p className="wide" role="alert">{error}</p>}
      {notice && <p className="wide" role="status">{notice}</p>}
      {!templates && !error && <p className="wide" role="status">Loading templates…</p>}
      {templates && <>
        <label>Saved template<select value={selectedId} disabled={busy} onChange={(event) => {
          setSelectedId(event.target.value);
          setName(templates.find((template) => template.id === event.target.value)?.name ?? "");
        }}>
          <option value="">Choose a template</option>
          {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
        </select></label>
        <button className="button button-secondary" type="button" disabled={!selected || busy} onClick={() => {
          if (selected) { apply(selected); setNotice("Template applied to the draft."); }
        }}>Apply to draft</button>
        <label>Template name<input value={name} disabled={busy} maxLength={120} onChange={(event) => setName(event.target.value)} /></label>
        <div className="wide">
          <button className="button button-secondary" type="button" disabled={!name.trim() || !draft.title.trim() || busy} onClick={() => void change("create")}>Save as new template</button>
          {selected && <>
            <button className="button button-secondary" type="button" disabled={!name.trim() || !draft.title.trim() || busy} onClick={() => void change("update")}>Update selected template</button>
            <button className="button button-quiet" type="button" disabled={busy} onClick={() => void change("delete")}>Delete template</button>
          </>}
        </div>
      </>}
    </div>}
  </details>;
}
