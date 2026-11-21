import { useEffect, useState, type FormEvent } from "react";
import { formatUserDate } from "../../date-format";

type Attachment = { id: string; fileName: string; fileSize: number; uploadedAt: string; uploadedBy: string | null };
const maxAttachmentBytes = 10 * 1024 * 1024;

async function expectSuccess(response: Response, fallback: string) {
  if (response.ok) return;
  const result = await response.json().catch(() => null) as { error?: string; message?: string } | null;
  throw new Error(result?.message ?? result?.error ?? fallback);
}

export function PersonAttachments({ contactId, departmentId, csrfToken, canManage, archived }: {
  contactId: string;
  departmentId: string;
  csrfToken: string;
  canManage: boolean;
  archived: boolean;
}) {
  const path = `/api/people-records/${contactId}/attachments`;
  const canWrite = canManage && !archived;
  const [open, setOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [attachments, setAttachments] = useState<Attachment[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoadError("");
    setAttachments(null);
    void fetch(path, { headers: { "x-department-id": departmentId }, signal: controller.signal }).then(async (response) => {
      await expectSuccess(response, "Could not load attachments.");
      const result = await response.json() as Attachment[];
      if (!controller.signal.aborted) setAttachments(result);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "Could not load attachments.");
    });
    return () => controller.abort();
  }, [departmentId, open, path, revision]);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = new FormData(form).get("attachment");
    if (!(file instanceof File) || file.size < 1 || file.size > maxAttachmentBytes) {
      setActionError("Choose a non-empty file no larger than 10 MiB.");
      return;
    }
    await submitAttachmentAction(async () => {
      const query = new URLSearchParams({ filename: file.name });
      const response = await fetch(`${path}?${query}`, { method: "POST", headers: {
        "content-type": "application/vnd.smart-church.person-attachment", "x-department-id": departmentId, "x-csrf-token": csrfToken,
      }, body: file });
      await expectSuccess(response, "Could not upload the attachment.");
      form.reset();
      setRevision((current) => current + 1);
      setNotice("Attachment added.");
    });
  }

  async function download(attachment: Attachment) {
    await submitAttachmentAction(async () => {
      const response = await fetch(`${path}/${attachment.id}`, { headers: { "x-department-id": departmentId } });
      await expectSuccess(response, "Could not download the attachment.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = attachment.fileName;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  async function remove(attachment: Attachment) {
    if (!window.confirm(`Permanently delete “${attachment.fileName}” from this profile?`)) return;
    await submitAttachmentAction(async () => {
      const response = await fetch(`${path}/${attachment.id}`, { method: "DELETE", headers: { "x-department-id": departmentId, "x-csrf-token": csrfToken } });
      await expectSuccess(response, "Could not delete the attachment.");
      setRevision((current) => current + 1);
      setNotice("Attachment deleted.");
    });
  }

  async function submitAttachmentAction(action: () => Promise<void>) {
    setBusy(true);
    setActionError("");
    setNotice("");
    try { await action(); }
    catch (error) { setActionError(error instanceof Error ? error.message : "Could not open the attachment."); }
    finally { setBusy(false); }
  }

  return <details onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Private attachments</summary>
    {open && <div>
      {canWrite && <form className="module-toolbar" onSubmit={(event) => void upload(event)}>
        <label>Choose file, up to 10 MiB<input name="attachment" type="file" required disabled={busy} /></label>
        <button type="submit" disabled={busy}>Upload attachment</button>
      </form>}
      {archived && canManage && <p>Restore this person to upload or delete attachments.</p>}
      {notice && <p role="status">{notice}</p>}
      {actionError && <p role="alert">{actionError}</p>}
      {loadError && <p role="alert">{loadError}</p>}
      {!attachments && !loadError && <p role="status">Loading attachments…</p>}
      {attachments?.length ? <ul>{attachments.map((attachment) => <li key={attachment.id}>
        <span>{attachment.fileName} · {formatUserDate(attachment.uploadedAt, true)}{attachment.uploadedBy ? ` · ${attachment.uploadedBy}` : ""}</span>{" "}
        <button type="button" disabled={busy} onClick={() => void download(attachment)} aria-label={`Download ${attachment.fileName}`}>Download</button>{" "}
        {canWrite && <button type="button" disabled={busy} onClick={() => void remove(attachment)} aria-label={`Delete ${attachment.fileName}`}>Delete</button>}
      </li>)}</ul> : attachments && <p>No attachments have been uploaded.</p>}
      <button type="button" disabled={busy || (!attachments && !loadError)} onClick={() => setRevision((current) => current + 1)}>Refresh attachments</button>
    </div>}
  </details>;
}
