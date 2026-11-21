import { useEffect, useState, type FormEvent } from "react";

type Note = {
  id: string;
  body: string;
  revision: number;
  createdAt: string;
  createdBy: string | null;
  editedAt: string | null;
  editedBy: string | null;
  archivedAt: string | null;
  archivedBy: string | null;
};
type NotesPage = { notes: Note[]; hasMore: boolean };

export function PersonPrivateNotes({ contactId, archived, request }: {
  contactId: string;
  archived: boolean;
  request: <T>(url: string, init?: RequestInit) => Promise<T>;
}) {
  const path = "/api/people-records/" + contactId + "/private-notes";
  const [showArchived, setShowArchived] = useState(false);
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<NotesPage | null>(null);
  const [loadError, setLoadError] = useState("");
  const [writeError, setWriteError] = useState("");
  const [edit, setEdit] = useState<Note | null>(null);
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setLoadError("");
    request<NotesPage>(path + "?archived=" + showArchived + "&offset=" + page * 20, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(error => { if (!controller.signal.aborted) setLoadError(error.message); });
    return () => controller.abort();
  }, [path, request, page, refresh, showArchived]);

  function clearEditor() {
    setEdit(null);
    setBody("");
  }

  async function mutate(url: string, method: "POST" | "PUT", value: object, options?: { restartPage?: boolean; notice?: string }) {
    setSaving(true);
    setWriteError("");
    setNotice("");
    try {
      await request(url, { method, body: JSON.stringify(value) });
      clearEditor();
      if (options?.restartPage) setPage(0);
      setNotice(options?.notice ?? "");
      setRefresh(current => current + 1);
    } catch (error) {
      setWriteError(error instanceof Error ? error.message : "Could not save changes to the note.");
      setRefresh(current => current + 1);
    } finally {
      setSaving(false);
    }
  }

  function setNoteArchived(note: Note, archive: boolean) {
    return mutate(path + "/" + note.id + (archive ? "/archive" : "/restore"), "POST", { revision: note.revision },
      { notice: archive ? "Note archived." : "Note restored to active notes." });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !body.trim()) return;
    if (edit) void mutate(path + "/" + edit.id, "PUT", { body, revision: edit.revision });
    else void mutate(path, "POST", { body }, { restartPage: true });
  }

  return <section aria-label="Private profile notes">
    <h3>Private profile notes</h3>
    <p>Only People managers at this location can read or change these notes.</p>
    <div className="module-toolbar">
      <button type="button" disabled={saving} onClick={() => {
        setShowArchived(!showArchived);
        setPage(0);
        clearEditor();
        setWriteError("");
        setNotice("");
      }}>{showArchived ? "Show active notes" : "Show archived notes"}</button>
    </div>
    {loadError && <p role="alert">{loadError} <button type="button" onClick={() => setRefresh(current => current + 1)}>Retry</button></p>}
    {writeError && <p role="alert">{writeError}</p>}
    {notice && <p role="status">{notice}</p>}
    {!data && !loadError && <p>Loading notes…</p>}
    {data?.notes.length === 0 && <p>No {showArchived ? "archived" : "active"} notes on this page.</p>}
    {data?.notes.map(note => <article className="people-record-detail" key={note.id}>
      <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{note.body}</p>
      <small>Added by {note.createdBy ?? "Unknown"} on {new Date(note.createdAt).toLocaleString()}</small>
      {note.editedAt && <small>Edited by {note.editedBy ?? "Unknown"} on {new Date(note.editedAt).toLocaleString()}</small>}
      {note.archivedAt && <small>Archived by {note.archivedBy ?? "Unknown"} on {new Date(note.archivedAt).toLocaleString()}</small>}
      {!archived && <div className="module-toolbar">
        {note.archivedAt
          ? <button type="button" disabled={saving} onClick={() => void setNoteArchived(note, false)}>Restore note</button>
          : <>
            <button type="button" disabled={saving} onClick={() => { setEdit(note); setBody(note.body); setWriteError(""); setNotice(""); }}>Edit note</button>
            <button type="button" disabled={saving || Boolean(edit)} onClick={() => void setNoteArchived(note, true)}>Archive note</button>
          </>}
      </div>}
    </article>)}
    {(page > 0 || data?.hasMore) && <nav aria-label="Private notes pages" className="module-toolbar">
      <button type="button" disabled={page === 0 || saving} onClick={() => setPage(page - 1)}>Previous notes</button>
      <span>Page {page + 1}</span>
      <button type="button" disabled={!data?.hasMore || saving} onClick={() => setPage(page + 1)}>Next notes</button>
    </nav>}
    {!archived && !showArchived && <form onSubmit={submit}>
      <label>{edit ? "Edit note text" : "New private note"}<textarea required maxLength={4000} value={body} disabled={saving} onChange={event => setBody(event.target.value)}/></label>
      <button disabled={saving || !body.trim()}>{edit ? "Save note changes" : "Add private note"}</button>
      {edit && <button type="button" disabled={saving} onClick={clearEditor}>Cancel edit</button>}
    </form>}
  </section>;
}
