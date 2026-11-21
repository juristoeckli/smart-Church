import { useEffect, useRef, useState } from "react";
import type { AppointmentTemplate, AppointmentTemplateFields } from "./appointment-template-draft";

type DraftFields = AppointmentTemplateFields & { tags: string | string[] };

export function AppointmentTemplates({ departmentId, calendarId, csrfToken, draft, apply }: {
  departmentId: string; calendarId: string; csrfToken: string; draft: DraftFields; apply?: (template: AppointmentTemplate) => void;
}) {
  const saveOnly = !apply;
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<AppointmentTemplate[] | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [name, setName] = useState(() => saveOnly ? draft.title.slice(0, 120) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
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
    // Wait for the write to settle before reading the authoritative list.
    if (!open || busy || saveOnly) return;
    const controller = new AbortController();
    setLoadError("");
    async function load() {
      try {
        const response = await fetch(path, { signal: controller.signal, cache: "no-store", headers: { "x-department-id": departmentId } });
        if (!response.ok) throw new Error("Could not load appointment templates.");
        const rows = await response.json() as AppointmentTemplate[];
        if (!controller.signal.aborted) setTemplates(rows);
      } catch (cause) {
        if (!controller.signal.aborted) setLoadError(cause instanceof Error ? cause.message : "Could not load appointment templates.");
      }
    }
    void load();
    return () => controller.abort();
  }, [busy, departmentId, open, path, saveOnly]);

  async function change(action: "create" | "update" | "delete") {
    if (saveOnly && action !== "create") return;
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
          internalOnly, tags: (Array.isArray(tags) ? tags : tags.split(",")).map((tag) => tag.trim()).filter(Boolean) }) } : {}),
      });
      const payload = await response.json() as AppointmentTemplate & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not update appointment templates.");
      if (signal?.aborted) return;
      if (saveOnly) {
        setNotice("A new template was saved from this appointment.");
        return;
      }
      setTemplates((current) => action === "delete" ? (current ?? []).filter((template) => template.id !== id)
        : [...(current ?? []).filter((template) => template.id !== payload.id), payload].sort((a, b) => a.name.localeCompare(b.name)));
      if (action === "delete") { setSelectedId(""); setName(""); }
      else { setSelectedId(payload.id); setName(payload.name); }
      setNotice(action === "delete" ? "Appointment template deleted." : "Appointment template saved.");
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "Could not update appointment templates.");
    } finally { if (!signal?.aborted) setBusy(false); }
  }

  const visibleError = error || loadError;
  return <details className="church-calendar-extra-date wide" open={open} onToggle={(event) => {
    const next = event.currentTarget.open;
    if (next && !open && !busy && !saveOnly) setTemplates(null);
    setOpen(next);
  }}>
    <summary>{saveOnly ? "Save appointment as template" : "Appointment templates"}</summary>
    {open && <div className="church-calendar-form-grid">
      <p className="wide">{saveOnly
        ? "Copies the saved title and details from this occurrence into a new template in its calendar."
        : "A template fills the title and details on this draft. Dates, recurrence, and linked records stay as selected."}</p>
      {visibleError && <p className="wide" role="alert">{visibleError}</p>}
      {notice && <p className="wide" role="status">{notice}</p>}
      {!saveOnly && !templates && !visibleError && <p className="wide" role="status">Loading templates…</p>}
      {(saveOnly || templates) && <>
        {!saveOnly && templates && <>
          <label>Saved template<select value={selectedId} disabled={busy} onChange={(event) => {
            setSelectedId(event.target.value);
            setName(templates.find((template) => template.id === event.target.value)?.name ?? "");
          }}>
            <option value="">Choose a template</option>
            {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
          </select></label>
          <button className="button button-secondary" type="button" disabled={!selected || busy} onClick={() => {
            if (selected && apply) { apply(selected); setNotice("Template applied to the draft."); }
          }}>Apply to draft</button>
        </>}
        <label>Template name<input value={name} disabled={busy} maxLength={120} onChange={(event) => setName(event.target.value)} /></label>
        <div className="wide">
          <button className="button button-secondary" type="button" disabled={!name.trim() || !draft.title.trim() || busy} onClick={() => void change("create")}>Save as new template</button>
          {!saveOnly && selected && <>
            <button className="button button-secondary" type="button" disabled={!name.trim() || !draft.title.trim() || busy} onClick={() => void change("update")}>Update selected template</button>
            <button className="button button-quiet" type="button" disabled={busy} onClick={() => void change("delete")}>Delete template</button>
          </>}
        </div>
      </>}
    </div>}
  </details>;
}
