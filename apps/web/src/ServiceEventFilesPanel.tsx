import { useEffect, useState } from "react";
import { Download, Paperclip, Plus, X } from "lucide-react";

type EventFile = { id: string; title: string; fileName: string };
type FileLists = { attached: EventFile[]; available: EventFile[] };

export function ServiceEventFilesPanel({ departmentId, csrfToken, eventId }: { departmentId: string; csrfToken: string; eventId: string }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<FileLists | null>(null);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const path = `/api/events/${eventId}/files`;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setData(null);
    setError("");
    const debounce = window.setTimeout(() => {
      void (async () => {
        try {
          const query = new URLSearchParams({ search: search.trim() });
          const response = await fetch(`${path}?${query}`, {
            headers: { "x-department-id": departmentId }, signal: controller.signal,
          });
          const result = await response.json() as FileLists & { error?: string };
          if (!response.ok) throw new Error(result.error ?? "Could not load event attachments.");
          if (!controller.signal.aborted) setData(result);
        } catch (cause) {
          if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load event attachments.");
        }
      })();
    }, search ? 200 : 0);
    return () => { window.clearTimeout(debounce); controller.abort(); };
  }, [departmentId, open, path, refresh, search]);

  async function change(file: EventFile, attach: boolean) {
    setBusyId(file.id);
    setError("");
    try {
      const response = await fetch(`${path}/${file.id}`, {
        method: attach ? "PUT" : "DELETE", headers: { "x-department-id": departmentId, "x-csrf-token": csrfToken },
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(detail.error ?? "Could not update the event attachment.");
      }
      setRefresh((version) => version + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update the event attachment."); }
    finally { setBusyId(""); }
  }

  async function download(file: EventFile) {
    setBusyId(file.id);
    setError("");
    try {
      const response = await fetch(`/api/files/${file.id}/download`, { headers: { "x-department-id": departmentId } });
      if (!response.ok) throw new Error("This file is no longer available.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = file.fileName;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not download the file."); }
    finally { setBusyId(""); }
  }

  return <section className="event-details-summary">
    <button className="button button-secondary" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <Paperclip size={15} /> Event attachments
    </button>
    {open && <div className="stack">
      {error && <p role="alert">{error}</p>}
      <h3>Attached files</h3>
      {!data && !error && <p role="status">Loading files…</p>}
      {data && (data.attached.length ? <ul>{data.attached.map((file) => <li key={file.id}>
        <span>{file.title} · {file.fileName}</span>
        <button className="button button-quiet" type="button" disabled={Boolean(busyId)} onClick={() => void download(file)}>
          <Download size={14} /> Download
        </button>
        <button className="button button-quiet" type="button" disabled={Boolean(busyId)} onClick={() => void change(file, false)}>
          <X size={14} /> Detach
        </button>
      </li>)}</ul> : <p>No accessible files are attached.</p>)}
      <label>Find a stored file<input type="search" maxLength={120} value={search} onChange={(event) => setSearch(event.target.value)}
        placeholder="Search by title or filename" /></label>
      {data?.available.length ? <ul>{data.available.map((file) => <li key={file.id}>
        <span>{file.title} · {file.fileName}</span>
        <button className="button button-quiet" type="button" disabled={Boolean(busyId)} onClick={() => void change(file, true)}>
          <Plus size={14} /> Attach
        </button>
      </li>)}</ul> : data && <p>No available files match.</p>}
    </div>}
  </section>;
}
