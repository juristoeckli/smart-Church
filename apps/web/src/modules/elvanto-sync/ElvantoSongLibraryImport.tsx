import { useEffect, useState } from "react";
import { getActiveLanguage } from "../../i18n";
import { translateModuleMessage } from "../translations";

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
type SongReviewRow = { sourceId: string; title: string; action: string; linked: boolean; resolution: "use_elvanto" | "keep_local" | "skip" | null };
type Progress = { cursor: number; total: number; created: number; updated: number; skipped: number; review: number; complete: boolean; processedThisBatch: number };

export function ElvantoSongLibraryImport({ departmentId }: { departmentId: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [rows, setRows] = useState<SongReviewRow[]>([]);
  const [offset, setOffset] = useState(0);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const tr = (message: string) => translateModuleMessage("sync", getActiveLanguage(), message);

  async function request(path: string, body?: unknown, method = "POST") {
    const response = await fetch(path, {
      method,
      headers: { "x-department-id": departmentId, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) throw new Error(result?.error ?? "The song-library import could not be completed.");
    return result;
  }

  async function loadRows(targetPreview: Preview, nextOffset: number) {
    const response = await fetch(`/api/modules/sync/elvanto/songs-library-preview/${targetPreview.previewId}?offset=${nextOffset}&limit=50`, { headers: { "x-department-id": departmentId } });
    const result = await response.json().catch(() => null) as { rows?: SongReviewRow[]; error?: string } | null;
    if (!response.ok || !Array.isArray(result?.rows)) throw new Error(tr(result?.error ?? "Could not load song-library review rows."));
    setRows(result.rows);
    setOffset(nextOffset);
  }

  async function createPreview() {
    setBusy(true); setError(""); setProgress(null); setPreview(null); setRows([]); setOffset(0);
    try {
      const result = await request("/api/modules/sync/elvanto/songs-library-preview") as Preview;
      setPreview(result);
      await loadRows(result, 0);
    } catch (reason) { setError(reason instanceof Error ? reason.message : tr("Could not preview songs for the library.")); }
    finally { setBusy(false); }
  }

  async function importBatch() {
    if (!preview) return;
    setBusy(true); setError("");
    try {
      const result = await request("/api/modules/sync/elvanto/songs-library-import", { previewId: preview.previewId }) as { import: Progress };
      setProgress(result.import);
    } catch (reason) { setError(reason instanceof Error ? reason.message : tr("Could not import songs into the library.")); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    let cancelled = false;
    async function resumeSavedPreview() {
      try {
        const response = await fetch("/api/modules/sync/elvanto/songs-library-preview", { headers: { "x-department-id": departmentId } });
        if (!response.ok) return;
        const result = await response.json() as { preview?: Preview | null; progress?: Progress };
        if (!result.preview || cancelled) return;
        setPreview(result.preview);
        if (result.progress && result.progress.cursor > 0) setProgress(result.progress);
        await loadRows(result.preview, 0);
      } catch {
        if (!cancelled) setError(tr("Could not resume the song-library preview."));
      }
    }
    void resumeSavedPreview();
    return () => { cancelled = true; };
  }, [departmentId]);

  async function resolveRow(row: SongReviewRow, resolution: "use_elvanto" | "keep_local" | "skip") {
    if (!preview) return;
    setBusy(true); setError("");
    try {
      await request("/api/modules/sync/elvanto/songs-library-resolution", { previewId: preview.previewId, sourceId: row.sourceId, resolution }, "PUT");
      await loadRows(preview, offset);
    } catch (reason) { setError(reason instanceof Error ? reason.message : tr("Could not save the song review decision.")); }
    finally { setBusy(false); }
  }

  function actionLabel(action: string) {
    if (action === "import") return tr("Ready to import");
    if (action === "already_linked") return tr("Already linked");
    if (action === "update") return tr("Update linked song");
    if (action === "local_changed") return tr("Local song changed; review manually");
    if (action === "baseline_missing") return tr("Previous import has no local baseline; review before updating");
    if (action === "title_conflict") return tr("Same-title song needs review");
    if (action === "duplicate_source_title") return tr("Duplicate Elvanto title needs review");
    if (action === "changed") return tr("Snapshot changed; preview again");
    if (action === "missing") return tr("Snapshot missing; preview again");
    return action;
  }

  return <section className="sync-connection-form" aria-live="polite">
    <h3>{tr("Copy imported songs to the Worship library")}</h3>
    <p className="sync-help">{tr("Copy title, artist, notes, arrangements, and keys from the imported Elvanto snapshots into the searchable local library. Linked songs update only when the local song still matches the last imported version. Local edits stay for review, and arrangements missing from Elvanto are never removed. Same-title songs stay for manual review; licensed files are not copied.")}</p>
    <div className="community-inline-actions">
      <button className="button button-secondary" type="button" onClick={() => void createPreview()} disabled={busy}>{tr("Preview library import")}</button>
      {preview && preview.importCount + preview.updateCount > 0 && !progress?.complete && <button className="button button-primary" type="button" onClick={() => void importBatch()} disabled={busy}>{busy ? tr("Importing…") : progress ? tr("Continue import") : tr("Import to library")}</button>}
    </div>
    {error && <p className="sync-inline-error" role="alert">{error}</p>}
    {preview && <div className="sync-feedback">
      <strong>{tr("Library import preview")}</strong>
      <span>{preview.total} {tr("snapshots")} · {preview.importCount} {tr("new")} · {preview.updateCount} {tr("updates")} · {preview.alreadyLinkedCount} {tr("already linked")} · {preview.reviewCount} {tr("need review")}</span>
      <small>{tr("Preview expires")} {new Date(preview.expiresAt).toLocaleString()}.</small>
    </div>}
    {progress && <div className="sync-feedback" role="status">
      <strong>{progress.complete ? tr("Library import complete") : tr("Library import progress")}</strong>
      <span>{progress.created} {tr("created")} · {progress.updated} {tr("updated")} · {progress.skipped} {tr("skipped")} · {progress.review} {tr("need review")} · {progress.cursor} {tr("of")} {progress.total} {tr("snapshots reviewed")}</span>
    </div>}
    {preview && rows.map((song) => <div className="sync-feedback" key={song.sourceId}>
      <strong>{song.title}</strong><span>{actionLabel(song.action)}</span>
      {song.resolution && <small>{tr("Decision")}: {tr(song.resolution === "use_elvanto" ? "Use Elvanto values" : song.resolution === "keep_local" ? "Keep local values" : "Skip this song")}</small>}
      {["local_changed", "baseline_missing", "title_conflict", "duplicate_source_title"].includes(song.action) && <label>{tr("Review decision")}<select value={song.resolution ?? ""} disabled={busy} onChange={(event) => event.target.value && void resolveRow(song, event.target.value as "use_elvanto" | "keep_local" | "skip")}>
        <option value="">{tr("Choose a decision")}</option>
        {song.linked && ["local_changed", "baseline_missing"].includes(song.action) && <option value="use_elvanto">{tr("Use Elvanto values")}</option>}
        {song.linked && <option value="keep_local">{tr("Keep local values")}</option>}
        <option value="skip">{tr("Skip this song")}</option>
      </select></label>}
    </div>)}
    {preview && preview.total > 50 && <div className="community-inline-actions"><button className="button button-secondary" type="button" disabled={busy || offset <= 0} onClick={() => void loadRows(preview, Math.max(0, offset - 50))}>{tr("Previous")}</button><span className="sync-help">{offset + 1}–{Math.min(offset + rows.length, preview.total)} {tr("of")} {preview.total}</span><button className="button button-secondary" type="button" disabled={busy || offset + 50 >= preview.total} onClick={() => void loadRows(preview, offset + 50)}>{tr("Next")}</button></div>}
  </section>;
}
