import { useState } from "react";

type Preview = {
  previewId: string;
  total: number;
  importCount: number;
  updateCount: number;
  alreadyLinkedCount: number;
  reviewCount: number;
  expiresAt: string;
  sample: Array<{ sourceId: string; title: string; action: string }>;
};
type Progress = { cursor: number; total: number; created: number; updated: number; review: number; complete: boolean; processedThisBatch: number };

export function ElvantoSongLibraryImport({ departmentId }: { departmentId: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function request(path: string, body?: unknown) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "x-department-id": departmentId, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) throw new Error(result?.error ?? "The song-library import could not be completed.");
    return result;
  }

  async function createPreview() {
    setBusy(true); setError(""); setProgress(null); setPreview(null);
    try {
      setPreview(await request("/api/modules/sync/elvanto/songs-library-preview") as Preview);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not preview songs for the library."); }
    finally { setBusy(false); }
  }

  async function importBatch() {
    if (!preview) return;
    setBusy(true); setError("");
    try {
      const result = await request("/api/modules/sync/elvanto/songs-library-import", { previewId: preview.previewId }) as { import: Progress };
      setProgress(result.import);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not import songs into the library."); }
    finally { setBusy(false); }
  }

  function actionLabel(action: string) {
    if (action === "import") return "Ready to import";
    if (action === "already_linked") return "Already linked";
    if (action === "update") return "Update linked song";
    if (action === "local_changed") return "Local song changed; review manually";
    if (action === "baseline_missing") return "Previous import has no local baseline; review before updating";
    if (action === "title_conflict") return "Same-title song needs review";
    if (action === "duplicate_source_title") return "Duplicate Elvanto title needs review";
    if (action === "changed") return "Snapshot changed; preview again";
    if (action === "missing") return "Snapshot missing; preview again";
    return action;
  }

  return <section className="sync-connection-form" aria-live="polite">
    <h3>Copy imported songs to the Worship library</h3>
    <p className="sync-help">Copy title, artist, notes, arrangements, and keys from imported Elvanto snapshots into the searchable local library. Linked songs update only when the local song still matches the last imported version. Local edits are kept for review, and arrangements missing from Elvanto are never removed. Same-title songs stay for manual review; licensed files are not copied.</p>
    <div className="community-inline-actions">
      <button className="button button-secondary" type="button" onClick={() => void createPreview()} disabled={busy}>Preview library import</button>
      {preview && preview.importCount + preview.updateCount > 0 && !progress?.complete && <button className="button button-primary" type="button" onClick={() => void importBatch()} disabled={busy}>{busy ? "Importing…" : progress ? "Continue import" : "Import to library"}</button>}
    </div>
    {error && <p className="sync-inline-error" role="alert">{error}</p>}
    {preview && <div className="sync-feedback">
      <strong>Library import preview</strong>
      <span>{preview.total} snapshots · {preview.importCount} new · {preview.updateCount} updates · {preview.alreadyLinkedCount} already linked · {preview.reviewCount} need review</span>
      <small>Preview expires {new Date(preview.expiresAt).toLocaleString()}.</small>
    </div>}
    {progress && <div className="sync-feedback" role="status">
      <strong>{progress.complete ? "Library import complete" : "Library import progress"}</strong>
      <span>{progress.created} created · {progress.updated} updated · {progress.review} need review · {progress.cursor} of {progress.total} snapshots reviewed</span>
    </div>}
    {preview?.sample.map((song) => <div className="sync-feedback" key={song.sourceId}>
      <strong>{song.title}</strong><span>{actionLabel(song.action)}</span>
    </div>)}
  </section>;
}
