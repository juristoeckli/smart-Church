import { useState, type FormEvent } from "react";
import { X } from "lucide-react";

export type CalendarTagDefinition = { key: string; name: string; color: string | null; description: string };
type Draft = { key?: string; name: string; color: string | null; description: string };

export function CalendarTagManager({ tags, visibleCounts, departmentId, csrfToken, onClose, onChange }: {
  tags: CalendarTagDefinition[]; visibleCounts: Map<string, Set<string>>;
  departmentId: string; csrfToken: string; onClose(): void; onChange(): void;
}) {
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const query = search.trim().toLowerCase();
  const visible = tags.filter(({ name, description }) => `${name} ${description}`.toLowerCase().includes(query));

  async function mutate(method: "POST" | "PUT" | "DELETE", entry: Draft) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/modules/church-calendar/tag-definitions" + (entry.key ? "/" + encodeURIComponent(entry.key) : ""), {
        method,
        headers: { "content-type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken },
        ...(method !== "DELETE" ? { body: JSON.stringify({ name: entry.name, description: entry.description, color: entry.color }) } : {}),
      });
      if (!response.ok) {
        const body = await response.json() as { error?: string };
        throw new Error(body.error ?? "Could not save the tag definition.");
      }
      setDraft(null);
      onChange();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the tag definition.");
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (draft) void mutate(draft.key ? "PUT" : "POST", draft);
  }

  return <div className="church-calendar-modal-backdrop" role="presentation">
    <section className="church-calendar-modal" role="dialog" aria-modal="true" aria-labelledby="calendar-tag-manager-heading">
      <header><h2 id="calendar-tag-manager-heading">Manage appointment tags</h2><button type="button" aria-label="Close" className="icon-button" onClick={onClose}><X size={18} /></button></header>
      {error && <p role="alert">{error}</p>}
      {draft ? <form onSubmit={submit}>
        <label>Name<input value={draft.name} maxLength={40} required onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>Description<textarea value={draft.description} maxLength={500} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
        <label>Color<input type="color" value={draft.color ?? "#3b82f6"} onChange={(event) => setDraft({ ...draft, color: event.target.value })} /></label>
        {draft.color && <button type="button" className="button button-secondary" onClick={() => setDraft({ ...draft, color: null })}>Clear color</button>}
        <footer><button type="button" className="button button-secondary" disabled={busy} onClick={() => setDraft(null)}>Back to tags</button>
          <button type="submit" className="button button-primary" disabled={busy || !draft.name.trim()}>Save tag</button></footer>
      </form> : <>
        <label>Search tags<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <button type="button" className="button button-primary" disabled={busy} onClick={() => setDraft({ name: "", description: "", color: null })}>Create tag</button>
        {visible.length ? <ul>{visible.map((tag) => <li key={tag.key}>
          <strong>{tag.name}</strong> · {(visibleCounts.get(tag.key)?.size ?? 0)} in current view
          {tag.description && <div>{tag.description}</div>}
          <button type="button" className="church-calendar-feed-button" disabled={busy} onClick={() => setDraft(tag)}>Edit {tag.name}</button>
          <button type="button" className="church-calendar-feed-button" disabled={busy} onClick={() => {
            if (window.confirm(`Remove the definition for “${tag.name}”? Existing appointments keep their tag.`)) void mutate("DELETE", tag);
          }}>Remove definition</button>
        </li>)}</ul> : <p>No matching definitions.</p>}
      </>}
    </section>
  </div>;
}
