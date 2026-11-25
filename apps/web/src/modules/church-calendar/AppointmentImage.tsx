import { useEffect, useRef, useState } from "react";

export type AppointmentImageMetadata = {
  altText: string; credit: string; sourceUrl: string; focalX: number; focalY: number; aiGenerated: boolean;
};
export const emptyAppointmentImageMetadata: AppointmentImageMetadata = {
  altText: "", credit: "", sourceUrl: "", focalX: 50, focalY: 50, aiGenerated: false,
};
type StoredImageMetadata = { metadata: AppointmentImageMetadata; revision: string };

function useImagePreview(file?: Blob) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!file) { setUrl(undefined); return; }
    const url = URL.createObjectURL(file);
    setUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return url;
}

function ImagePreviews({ url, metadata }: { url: string; metadata: AppointmentImageMetadata }) {
  const objectPosition = metadata.focalX + "% " + metadata.focalY + "%";
  return <div className="calendar-image-crop-previews">
    <div><span>Landscape preview</span><img src={url} alt={metadata.altText} style={{ objectPosition }} /></div>
    <div><span>Square preview</span><img src={url} alt="" style={{ objectPosition }} /></div>
  </div>;
}

function ImageMetadataFields({ metadata, onChange, disabled, validateSource }: {
  metadata: AppointmentImageMetadata; onChange: (metadata: AppointmentImageMetadata) => void; disabled?: boolean; validateSource?: boolean;
}) {
  return <fieldset className="calendar-image-metadata-fields" disabled={disabled}>
    <legend>Image information</legend>
    <label>Alternative text<input maxLength={300} value={metadata.altText}
      onChange={(event) => onChange({ ...metadata, altText: event.target.value })} /></label>
    <small>Describe the image for screen reader users. Leave blank if the image is decorative.</small>
    <label>Image credit<input maxLength={120} value={metadata.credit}
      onChange={(event) => onChange({ ...metadata, credit: event.target.value })} /></label>
    <label>Image source link<input type={validateSource ? "url" : "text"} inputMode="url" maxLength={1000} value={metadata.sourceUrl}
      onChange={(event) => onChange({ ...metadata, sourceUrl: event.target.value })} placeholder="https://" /></label>
    <label className="church-calendar-check"><input type="checkbox" checked={metadata.aiGenerated}
      onChange={(event) => onChange({ ...metadata, aiGenerated: event.target.checked })} /> AI-generated image</label>
    <div className="calendar-image-focus">
      <label>Horizontal focus ({metadata.focalX}%)<input type="range" min={0} max={100} value={metadata.focalX}
        onChange={(event) => onChange({ ...metadata, focalX: Number(event.target.value) })} /></label>
      <label>Vertical focus ({metadata.focalY}%)<input type="range" min={0} max={100} value={metadata.focalY}
        onChange={(event) => onChange({ ...metadata, focalY: Number(event.target.value) })} /></label>
    </div>
  </fieldset>;
}

export function NewAppointmentImage({ file, metadata, onChange, disabled }: {
  file: File; metadata: AppointmentImageMetadata; onChange: (metadata: AppointmentImageMetadata) => void; disabled?: boolean;
}) {
  const url = useImagePreview(file);
  return <section className="calendar-image-settings wide" aria-label="New appointment image">
    <strong>{file.name}</strong>
    {url && <ImagePreviews url={url} metadata={metadata} />}
    <ImageMetadataFields metadata={metadata} onChange={onChange} disabled={disabled} validateSource />
  </section>;
}

export function SavedAppointmentImage({ imageUrl, departmentId, csrfToken, editable, busy, isRecurring, onRemove }: {
  imageUrl: string; departmentId: string; csrfToken: string; editable: boolean; busy: boolean; isRecurring: boolean; onRemove: () => void;
}) {
  const [stored, setStored] = useState<StoredImageMetadata>();
  const [draft, setDraft] = useState<AppointmentImageMetadata>();
  const [file, setFile] = useState<Blob>();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const lifetime = useRef<AbortController>(undefined);
  const url = useImagePreview(file);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    setStored(undefined);
    setDraft(undefined);
    setFile(undefined);
    setError("");
    const options = { headers: { "x-department-id": departmentId }, signal: controller.signal };
    void Promise.all([
      fetch(imageUrl + "/metadata", options).then(async (response) => {
        if (!response.ok) throw new Error("This appointment image is unavailable.");
        return response.json() as Promise<StoredImageMetadata>;
      }),
      fetch(imageUrl, options).then(async (response) => {
        if (!response.ok) throw new Error("This appointment image is unavailable.");
        return { blob: await response.blob(), revision: response.headers.get("X-Calendar-Image-Revision") };
      }),
    ]).then(([metadata, image]) => {
      if (controller.signal.aborted) return;
      if (metadata.revision !== image.revision) throw new Error("This appointment image changed while loading.");
      setStored(metadata);
      setFile(image.blob);
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Appointment image could not be loaded.");
    });
    return () => controller.abort();
  }, [departmentId, imageUrl, revision]);

  async function save() {
    if (!stored || !draft || saving) return;
    const signal = lifetime.current?.signal;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(imageUrl + "/metadata", {
        method: "PATCH", headers: { "x-department-id": departmentId, "x-csrf-token": csrfToken, "content-type": "application/json" },
        body: JSON.stringify({ revision: stored.revision, metadata: draft }), signal,
      });
      const body = await response.json().catch(() => ({})) as StoredImageMetadata & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Image information could not be saved.");
      if (signal?.aborted) return;
      setStored(body);
      setDraft(undefined);
    } catch (reason) {
      if (!signal?.aborted) setError(reason instanceof Error ? reason.message : "Image information could not be saved.");
    } finally {
      if (!signal?.aborted) setSaving(false);
    }
  }

  const metadata = draft ?? stored?.metadata;
  return <section className="calendar-image-settings wide" aria-label="Appointment image">
    {error && <p role="alert">{error}</p>}
    {!stored && !error && <p role="status">Loading the appointment image…</p>}
    {metadata && url && (draft ? <ImagePreviews url={url} metadata={metadata} /> : <figure className="calendar-image-display">
      <img src={url} alt={metadata.altText} style={{ objectPosition: metadata.focalX + "% " + metadata.focalY + "%" }} />
      {(metadata.credit || metadata.sourceUrl || metadata.aiGenerated) && <figcaption>
        {metadata.aiGenerated && <span>AI-generated image</span>}
        {metadata.sourceUrl ? <a target="_blank" rel="noreferrer" href={metadata.sourceUrl}>{metadata.credit || "Image source"}</a> : metadata.credit && <span>{metadata.credit}</span>}
      </figcaption>}
    </figure>)}
    {editable && stored && draft && <>
      {isRecurring && <small>Image information applies to the whole appointment series.</small>}
      <ImageMetadataFields metadata={draft} onChange={setDraft} disabled={busy || saving} />
      <div className="calendar-image-actions">
        <button type="button" className="button button-primary" onClick={() => void save()} disabled={busy || saving}>{saving ? "Saving…" : "Save image information"}</button>
        <button type="button" className="button button-secondary" disabled={busy || saving} onClick={() => { setDraft(undefined); setError(""); }}>Cancel image edit</button>
        {error && <button type="button" className="button button-secondary" disabled={busy || saving}
          onClick={() => setRevision((value) => value + 1)}>Reload image information</button>}
      </div>
    </>}
    {editable && stored && !draft && <div className="calendar-image-actions">
      <button type="button" className="button button-secondary" onClick={() => setDraft(stored.metadata)} disabled={busy}>Edit image information</button>
      <button type="button" className="button button-secondary" onClick={onRemove} disabled={busy}>Remove image</button>
    </div>}
    {!stored && error && <button type="button" className="button button-secondary" onClick={() => setRevision((value) => value + 1)}>Reload image</button>}
  </section>;
}
