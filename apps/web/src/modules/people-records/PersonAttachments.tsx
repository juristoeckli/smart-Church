import { useEffect, useState, type FormEvent } from "react";
import { formatUserDate } from "../../date-format";

type Attachment = { id: string; fileName: string; fileSize: number; isPortrait?: boolean; uploadedAt: string; uploadedBy: string | null };
const maxAttachmentBytes = 10 * 1024 * 1024;
const maxPortraitBytes = 2 * 1024 * 1024;

async function portraitFile(file: File) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Choose a JPEG, PNG or WebP image.");
  }
  const image = await createImageBitmap(file).catch(() => {
    throw new Error("The image could not be opened.");
  });
  try {
    const scale = Math.min(1, 600 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const drawing = canvas.getContext("2d");
    if (!drawing) throw new Error("The portrait could not be prepared.");
    drawing.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!png || png.size > maxPortraitBytes) throw new Error("The portrait could not be prepared.");
    const base = file.name.replace(/\.[^.]*$/, "").slice(0, 172);
    return new File([png], (base || "portrait") + ".png", { type: "image/png" });
  } finally {
    image.close();
  }
}

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
  const portraitPath = "/api/people-records/" + contactId + "/portrait";
  const canWrite = canManage && !archived;
  const [portrait, setPortrait] = useState<{ contactId: string; departmentId: string; url: string }>();
  const [portraitError, setPortraitError] = useState("");
  const visiblePortrait = portrait?.contactId === contactId && portrait.departmentId === departmentId ? portrait.url : "";
  const [open, setOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [attachments, setAttachments] = useState<Attachment[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let imageUrl: string | undefined;
    setPortrait(undefined);
    setPortraitError("");
    void fetch(portraitPath, { headers: { "x-department-id": departmentId }, signal: controller.signal }).then(async (response) => {
      if (response.status === 404) return;
      await expectSuccess(response, "Could not load the portrait.");
      const image = await response.blob();
      if (controller.signal.aborted) return;
      if (image.type !== "image/png") throw new Error("Could not load the portrait image.");
      imageUrl = URL.createObjectURL(image);
      setPortrait({ contactId, departmentId, url: imageUrl });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setPortraitError(error instanceof Error ? error.message : "Could not load the portrait.");
    });
    return () => {
      controller.abort();
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [contactId, departmentId, portraitPath, revision]);

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

  async function upload(event: FormEvent<HTMLFormElement>, useAsPortrait = false) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = new FormData(form).get("attachment");
    if (!(file instanceof File) || file.size < 1 || file.size > maxAttachmentBytes) {
      setActionError("Choose a non-empty file no larger than 10 MiB.");
      return;
    }
    await submitAttachmentAction(async () => {
      const content = useAsPortrait ? await portraitFile(file) : file;
      const query = new URLSearchParams({ filename: content.name });
      if (useAsPortrait) query.set("useAsPortrait", "true");
      const response = await fetch(`${path}?${query}`, { method: "POST", headers: {
        "content-type": "application/vnd.smart-church.person-attachment", "x-department-id": departmentId, "x-csrf-token": csrfToken,
      }, body: content });
      await expectSuccess(response, "Could not upload the attachment.");
      form.reset();
      setRevision((current) => current + 1);
      setNotice(useAsPortrait ? "Portrait uploaded." : "Attachment added.");
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

  async function setPortraitAttachment(attachmentId: string | null) {
    await submitAttachmentAction(async () => {
      const response = await fetch(portraitPath, { method: "PUT", headers: {
        "content-type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken,
      }, body: JSON.stringify({ attachmentId }) });
      await expectSuccess(response, "Could not change the portrait.");
      setRevision((current) => current + 1);
      setNotice(attachmentId ? "Portrait selected." : "Portrait removed.");
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

  return <>
    <section aria-label="Private portrait">
      <h3>Private portrait</h3>
      {visiblePortrait && !portraitError && <img src={visiblePortrait} alt="Profile portrait" width={120} height={120}
        style={{ objectFit: "cover" }} onError={() => setPortraitError("The selected PNG could not be displayed.")} />}
      {canWrite && visiblePortrait && <button type="button" disabled={busy} onClick={() => void setPortraitAttachment(null)}>Remove portrait</button>}
      {canWrite && <form className="module-toolbar" onSubmit={(event) => void upload(event, true)}>
        <label>Portrait image<input name="attachment" type="file" accept="image/jpeg,image/png,image/webp" required disabled={busy} /></label>
        <button type="submit" disabled={busy}>Upload portrait</button>
      </form>}
      {portraitError && <p role="alert">{portraitError}</p>}
      {notice && <p role="status">{notice}</p>}
      {actionError && <p role="alert">{actionError}</p>}
    </section>
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Private attachments</summary>
    {open && <div>
      {canWrite && <form className="module-toolbar" onSubmit={(event) => void upload(event)}>
        <label>Choose file, up to 10 MiB<input name="attachment" type="file" required disabled={busy} /></label>
        <button type="submit" disabled={busy}>Upload attachment</button>
      </form>}
      {archived && canManage && <p>Restore this person to upload or delete attachments.</p>}
      {loadError && <p role="alert">{loadError}</p>}
      {!attachments && !loadError && <p role="status">Loading attachments…</p>}
      {attachments?.length ? <ul>{attachments.map((attachment) => <li key={attachment.id}>
        <span>{attachment.fileName} · {formatUserDate(attachment.uploadedAt, true)}{attachment.uploadedBy ? ` · ${attachment.uploadedBy}` : ""}</span>{" "}
        {attachment.isPortrait && <span>Portrait · </span>}
        {canWrite && !attachment.isPortrait && attachment.fileSize <= maxPortraitBytes && /\.png$/i.test(attachment.fileName)
          && <button type="button" disabled={busy} onClick={() => void setPortraitAttachment(attachment.id)} aria-label={"Use " + attachment.fileName + " as portrait"}>Use as portrait</button>}
        <button type="button" disabled={busy} onClick={() => void download(attachment)} aria-label={`Download ${attachment.fileName}`}>Download</button>{" "}
        {canWrite && <button type="button" disabled={busy} onClick={() => void remove(attachment)} aria-label={`Delete ${attachment.fileName}`}>Delete</button>}
      </li>)}</ul> : attachments && <p>No attachments have been uploaded.</p>}
      <button type="button" disabled={busy || (!attachments && !loadError)} onClick={() => setRevision((current) => current + 1)}>Refresh attachments</button>
    </div>}
    </details>
  </>;
}
