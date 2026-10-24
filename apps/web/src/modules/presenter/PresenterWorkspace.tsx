import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AudioLines, ChevronDown, ChevronRight, Download, Eye, EyeOff, FileMusic, FileUp, ListMusic, Monitor, Music2, Plus, Search, SlidersHorizontal, Upload, WandSparkles } from "lucide-react";
import "./presenter.css";

type Dataset = { id: string; name: string; description: string; songCount: number; slideCount: number; builtIn: boolean };
type SongSummary = { number: number; sourceNumber: number; name: string; slideCount: number };
type Slide = { type: "text"; text: string; label?: string; section?: string; layout?: "lower-third" } | { type: "image"; asset: string; label: string; section?: string; imageUrl: string };
type Song = SongSummary & { slides: Slide[] };
const defaultLibraries = [
  { id: "singt-notation", name: "Singt with musical notes", icon: Music2 },
  { id: "singt-text", name: "Singt just text", icon: AudioLines },
  { id: "singt-lower-third", name: "Singt lower third", icon: FileMusic },
];

export function PresenterWorkspace({ departmentId, csrfToken, capabilities = { canEdit: true, canPresent: true, canManageLayouts: true } }: { departmentId: string; csrfToken: string; capabilities?: { canEdit: boolean; canPresent: boolean; canManageLayouts: boolean } }) {
  const [datasetId, setDatasetId] = useState(defaultLibraries[0].id);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [songs, setSongs] = useState<SongSummary[]>([]);
  const [selectedSong, setSelectedSong] = useState<Song | null>(null);
  const [datasetSearch, setDatasetSearch] = useState("");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [outputVisible, setOutputVisible] = useState(true);
  const [showOutput, setShowOutput] = useState(true);
  const [columns, setColumns] = useState(2);
  const [playlistOpen, setPlaylistOpen] = useState(true);
  const [librariesOpen, setLibrariesOpen] = useState(true);
  const importInput = useRef<HTMLInputElement>(null);

  const requestHeaders = useMemo(() => ({ "x-department-id": departmentId }), [departmentId]);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/presenter/datasets", { headers: requestHeaders, signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json()).error ?? "Could not load datasets.");
        return response.json() as Promise<Dataset[]>;
      })
      .then((items) => { setDatasets(items); if (items.length && !items.some((item) => item.id === datasetId)) setDatasetId(items[0].id); })
      .catch((error: unknown) => { if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : "Could not load datasets."); });
    return () => controller.abort();
  }, [requestHeaders, departmentId]);

  useEffect(() => {
    if (!datasetId) return;
    const controller = new AbortController();
    const query = new URLSearchParams();
    if (search.trim()) query.set("search", search.trim());
    setLoading(true);
    setSelectedSong(null);
    fetch(`/api/presenter/datasets/${encodeURIComponent(datasetId)}/songs?${query}`, { headers: requestHeaders, signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json()).error ?? "Could not load songs.");
        return response.json() as Promise<SongSummary[]>;
      })
      .then(setSongs)
      .catch((error: unknown) => { if (!controller.signal.aborted) { setSongs([]); setNotice(error instanceof Error ? error.message : "Could not load songs."); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [datasetId, search, requestHeaders]);

  const selectedDataset = datasets.find((item) => item.id === datasetId);
  const visibleDatasets = datasets.filter((dataset) => dataset.name.toLocaleLowerCase().includes(datasetSearch.trim().toLocaleLowerCase()));
  async function openSong(song: SongSummary) {
    setNotice("");
    try {
      const response = await fetch(`/api/presenter/datasets/${encodeURIComponent(datasetId)}/songs/${song.number}`, { headers: requestHeaders });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not open song.");
      setSelectedSong(result as Song);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not open song."); }
  }

  async function exportDataset() {
    setNotice("");
    try {
      const response = await fetch(`/api/presenter/datasets/${encodeURIComponent(datasetId)}/export`, { headers: requestHeaders });
      if (!response.ok) throw new Error((await response.json()).error ?? "Dataset export failed.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url; link.download = `${datasetId}.scdataset.tar.gz`; link.click(); URL.revokeObjectURL(url);
      setNotice(`${selectedDataset?.name ?? "Dataset"} exported as a standalone package.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Dataset export failed."); }
  }

  async function importDataset(file?: File) {
    if (!file) return;
    setNotice("");
    try {
      const response = await fetch("/api/presenter/datasets", { method: "POST", headers: { ...requestHeaders, "content-type": "application/gzip", "x-csrf-token": csrfToken }, body: file });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Dataset import failed.");
      const refreshed = await fetch("/api/presenter/datasets", { headers: requestHeaders }).then((item) => item.json() as Promise<Dataset[]>);
      setDatasets(refreshed); setDatasetId(result.id); setNotice(`Imported ${result.name} with ${result.songCount} songs.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Dataset import failed."); }
    finally { if (importInput.current) importInput.current.value = ""; }
  }

  return <section className={`video-presenter${outputVisible ? "" : " video-presenter-output-hidden"}`} aria-label="Presenter workspace">
    <header className="video-presenter-bar"><div><span className="video-presenter-live-dot" /><strong>Presenter</strong><span className="video-presenter-preview-label">DATASETS</span></div><span>{capabilities.canManageLayouts ? "Admin" : capabilities.canPresent ? "Operator" : capabilities.canEdit ? "Editor" : "Viewer"} · Session Main <i /> Live output not connected</span></header>
    <div className="video-presenter-layout">
      <aside className="video-presenter-sidebar">
        <section className="video-presenter-section">
          <button type="button" className="video-presenter-section-heading" aria-expanded={playlistOpen} onClick={() => setPlaylistOpen((open) => !open)}><strong>{playlistOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Playlists</strong><small>0</small></button>
          {playlistOpen && <><div className="video-presenter-create"><input aria-label="New playlist name" placeholder="New playlist name…" disabled={!capabilities.canEdit} /><button type="button" aria-label="Create playlist" disabled={!capabilities.canEdit}><Plus size={14} /></button></div><p className="video-presenter-empty-note">Create a playlist for a service rundown.</p></>}
        </section>
        <section className="video-presenter-section video-presenter-libraries">
          <button type="button" className="video-presenter-section-heading" aria-expanded={librariesOpen} onClick={() => setLibrariesOpen((open) => !open)}><strong>{librariesOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Datasets</strong><small>{datasets.length}</small></button>
          {librariesOpen && <>
            <label className="video-presenter-dataset-search"><Search size={13} /><input type="search" placeholder="Search datasets…" aria-label="Search datasets by name" value={datasetSearch} onChange={(event) => setDatasetSearch(event.target.value)} /></label>
            {defaultLibraries.map(({ id, icon: Icon }) => {
              const dataset = visibleDatasets.find((item) => item.id === id);
              return dataset ? <button type="button" key={id} className={`video-presenter-library${datasetId === id ? " is-selected" : ""}`} onClick={() => { setDatasetId(id); setSearch(""); }}><Icon size={14} /><span>{dataset.name}</span><small>{dataset.songCount}</small><ChevronRight size={12} /></button> : null;
            })}
            {visibleDatasets.filter((item) => !defaultLibraries.some((builtin) => builtin.id === item.id)).map((dataset) => <button type="button" key={dataset.id} className={`video-presenter-library${datasetId === dataset.id ? " is-selected" : ""}`} onClick={() => { setDatasetId(dataset.id); setSearch(""); }}><ListMusic size={14} /><span>{dataset.name}</span><small>{dataset.songCount}</small><ChevronRight size={12} /></button>)}
            {visibleDatasets.length === 0 && <p className="video-presenter-empty-note">No datasets match this name.</p>}
            {capabilities.canManageLayouts && <><input ref={importInput} type="file" accept=".gz,.scdataset.tar.gz,application/gzip" hidden onChange={(event) => void importDataset(event.target.files?.[0])} /><button type="button" className="video-presenter-import-dataset" onClick={() => importInput.current?.click()}><FileUp size={13} /> Import dataset package</button></>}
          </>}
        </section>
      </aside>

      <main className="video-presenter-editor">
        <div className="video-presenter-tools">
          <button type="button" onClick={() => setOutputVisible((visible) => !visible)}><SlidersHorizontal size={13} /> {outputVisible ? "Hide output panel" : "Show output panel"}</button>
          <button type="button" disabled={!capabilities.canEdit}><Upload size={13} /> Import slides…</button>
          <button type="button" disabled={!capabilities.canManageLayouts}><WandSparkles size={13} /> Layouts…</button>
          <label className="video-presenter-columns">Columns <input type="range" min="1" max="5" value={columns} onChange={(event) => setColumns(Number(event.target.value))} /><output>{columns}</output></label>
          <label className="video-presenter-show"><input type="checkbox" checked={showOutput} onChange={(event) => setShowOutput(event.target.checked)} /> Show output</label>
          <button className="video-presenter-add-playlist" type="button" disabled={!capabilities.canEdit}><Plus size={13} /> Add to playlist</button>
        </div>
        <div className="video-presenter-slide-content">
          <header className="video-presenter-song-heading"><div><span className="presenter-eyebrow">SONG DATASET · {selectedDataset?.songCount ?? 0} SONGS</span><h2>{selectedDataset?.name ?? "Presenter datasets"}</h2><p>{selectedDataset?.description ?? "The song datasets are not installed on this server yet."}</p></div><div className="video-presenter-dataset-actions"><label className="video-presenter-search"><Search size={14} /><input type="search" placeholder="Search songs…" aria-label="Search songs" value={search} onChange={(event) => setSearch(event.target.value)} /></label><button type="button" onClick={() => void exportDataset()} disabled={!selectedDataset}><Download size={13} /> Export dataset</button></div></header>
          {notice && <p className="video-presenter-dataset-notice" role="status">{notice}</p>}
          <div className="video-presenter-dataset-browser">
            <div className="video-presenter-song-list" aria-label="Dataset songs">{loading ? <p className="video-presenter-empty-note">Loading songs…</p> : songs.map((song) => <button type="button" key={song.number} className={selectedSong?.number === song.number ? "is-selected" : ""} onClick={() => void openSong(song)}><span className="video-presenter-song-number">{String(song.sourceNumber).padStart(3, "0")}</span><span>{song.name}</span><small>{song.slideCount}</small></button>)}{!loading && songs.length === 0 && <p className="video-presenter-empty-note">No songs match this search.</p>}</div>
            <div className="video-presenter-song-preview">{selectedSong ? <><header><div><span className="presenter-eyebrow">{selectedSong.sourceNumber} · {selectedSong.slides.length} SLIDES</span><h3>{selectedSong.name}</h3></div><span>Built-in · Read only</span></header><div className="video-presenter-slide-grid" style={{ "--presenter-columns": columns } as CSSProperties}>{selectedSong.slides.map((slide, index) => <article key={`${selectedSong.number}-${index}`} className={slide.type === "text" && slide.layout === "lower-third" ? "is-lower-third" : ""}>{slide.type === "image" ? <img src={slide.imageUrl} alt={`${selectedSong.name}, page ${slide.label}`} loading="lazy" /> : <div className="video-presenter-text-slide"><span>{slide.section || slide.label || "Slide"}</span><p>{slide.text}</p></div>}<small>{slide.label || `Slide ${index + 1}`}</small></article>)}</div></> : <div className="video-presenter-empty-state"><div className="video-presenter-empty-icon"><ListMusic size={24} /></div><h3>Choose a song</h3><p>Select a song to preview its notation or slides.</p></div>}</div>
          </div>
        </div>
        <div className="video-presenter-key-help">{capabilities.canPresent ? "Click a slide to present" : "Slide presentation requires Operator rights"} · <kbd>←</kbd> <kbd>→</kbd> move through slides · <kbd>Esc</kbd> clear output</div>
        <section className="video-presenter-rundown"><header><strong>Playlist</strong><span>PREVIEW ONLY</span></header><div><span><Plus size={15} /> Add songs to build a service rundown.</span></div></section>
      </main>

      {outputVisible && <aside className="video-presenter-inspector" aria-label="Session output preview">
        <header><strong><Monitor size={14} /> Session output</strong><span className="video-presenter-output-badge">BLANK</span></header>
        <div className={`video-presenter-monitor${showOutput ? "" : " is-hidden"}`}><div><Eye size={22} /><span>Nothing on output</span></div></div>
        <p className="video-presenter-output-caption">Local preview only · projector output is not connected.</p>
        <section className="video-presenter-output-settings"><h3>Outputs</h3><p>Projection links will be available when Presenter sessions are connected.</p><div><span>Web</span><small>Not connected</small></div><div><span>Full screen</span><small>Not connected</small></div><div><span>NDI</span><small>Not connected</small></div></section>
      </aside>}
    </div>
    <footer className="video-presenter-status"><span><Monitor size={13} /> Main seat</span><span><i /> Dataset library · read only</span><span><EyeOff size={13} /> No projector connected</span></footer>
  </section>;
}
