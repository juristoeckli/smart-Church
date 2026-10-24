import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AudioLines, ChevronDown, ChevronRight, Copy, Download, ExternalLink, Eye, EyeOff, FileMusic, FileUp, ListMusic, Monitor, Music2, Plus, Search, Settings2, SlidersHorizontal, Upload, WandSparkles, X } from "lucide-react";
import "./presenter.css";

type Dataset = { id: string; name: string; description: string; songCount: number; slideCount: number; builtIn: boolean };
type SongSummary = { number: number; sourceNumber: number; name: string; slideCount: number };
type Slide = { type: "text"; text: string; label?: string; section?: string; layout?: "lower-third" } | { type: "image"; asset: string; label: string; section?: string; imageUrl: string };
type Song = SongSummary & { slides: Slide[] };
type PresenterSession = { id: string; name: string; connected: boolean; visible: boolean; songName: string | null };
type PresenterLinks = { output?: string; kiosk?: string };
const defaultLibraries = [
  { id: "singt-notation", name: "Singt with musical notes", icon: Music2 },
  { id: "singt-text", name: "Singt just text", icon: AudioLines },
  { id: "singt-lower-third", name: "Singt lower third", icon: FileMusic },
];

export function PresenterWorkspace({ departmentId, csrfToken, capabilities = { canEdit: true, canPresent: true, canManageLayouts: true } }: { departmentId: string; csrfToken: string; capabilities?: { canEdit: boolean; canPresent: boolean; canManageLayouts: boolean } }) {
  const [datasetId, setDatasetId] = useState(defaultLibraries[0].id);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [sessions, setSessions] = useState<PresenterSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("main");
  const [outputTokens, setOutputTokens] = useState<Record<string, string>>({});
  const [outputLinks, setOutputLinks] = useState<Record<string, PresenterLinks>>({});
  const [outputBackground, setOutputBackground] = useState("black");
  const [preloadKiosk, setPreloadKiosk] = useState(false);
  const [legacyBrowser, setLegacyBrowser] = useState(false);
  const [outputSettingsOpen, setOutputSettingsOpen] = useState(false);
  const [sessionNameDraft, setSessionNameDraft] = useState("");
  const [showOutput, setShowOutput] = useState(false);
  const [outputBusy, setOutputBusy] = useState(false);
  const [presentedSlideIndex, setPresentedSlideIndex] = useState<number | null>(null);
  const [songs, setSongs] = useState<SongSummary[]>([]);
  const [selectedSong, setSelectedSong] = useState<Song | null>(null);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [outputVisible, setOutputVisible] = useState(true);
  const [columns, setColumns] = useState(2);
  const [playlistOpen, setPlaylistOpen] = useState(true);
  const [librariesOpen, setLibrariesOpen] = useState(true);
  const importInput = useRef<HTMLInputElement>(null);
  const outputSettingsRef = useRef<HTMLDivElement>(null);

  const requestHeaders = useMemo(() => ({ "x-department-id": departmentId }), [departmentId]);
  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const activeOutputLinks = outputLinks[activeSessionId] ?? {};

  useEffect(() => {
    if (!outputSettingsOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !outputSettingsRef.current?.contains(event.target)) setOutputSettingsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOutputSettingsOpen(false); };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [outputSettingsOpen]);

  useEffect(() => {
    const controller = new AbortController();
    const refreshSessions = async () => {
      try {
        const response = await fetch("/api/presenter/sessions", { headers: requestHeaders, signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error((await response.json()).error ?? "Could not load Presenter sessions.");
        setSessions(await response.json() as PresenterSession[]);
      } catch (error) { if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : "Could not load Presenter sessions."); }
    };
    void refreshSessions();
    const timer = window.setInterval(() => void refreshSessions(), 2000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [requestHeaders]);

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

  useEffect(() => {
    setShowOutput(activeSession?.visible ?? false);
    setSessionNameDraft(activeSession?.name ?? "");
  }, [activeSessionId, activeSession?.name, activeSession?.visible]);

  async function generateOutputLink(mode: "output" | "kiosk") {
    setOutputBusy(true);
    setNotice("");
    try {
      let token = outputTokens[activeSessionId];
      if (!token) {
        const response = await fetch(`/api/presenter/sessions/${encodeURIComponent(activeSessionId)}/connect`, { method: "POST", headers: { ...requestHeaders, "x-csrf-token": csrfToken } });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Could not generate Presenter links.");
        token = result.token as string;
        setOutputTokens((current) => ({ ...current, [activeSessionId]: token! }));
        setSessions((current) => current.map((session) => session.id === activeSessionId ? { ...session, connected: false, visible: false, songName: null } : session));
        setShowOutput(false);
        setPresentedSlideIndex(null);
      }
      const link = new URL("/presenter-output.html", window.location.origin);
      link.searchParams.set("token", token);
      link.searchParams.set("mode", mode);
      link.searchParams.set("background", outputBackground);
      link.searchParams.set("preload", mode === "kiosk" && preloadKiosk ? "1" : "0");
      link.searchParams.set("legacy", legacyBrowser ? "1" : "0");
      setOutputLinks((current) => ({ ...current, [activeSessionId]: { ...current[activeSessionId], [mode]: link.toString() } }));
      setNotice(`${mode === "kiosk" ? "Kiosk" : "Output"} link generated for ${activeSession?.name ?? "Main"}.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not generate Presenter link."); }
    finally { setOutputBusy(false); }
  }

  async function sendOutputState(body: { visible: boolean; clear?: boolean; datasetId?: string; songNumber?: number; slideIndex?: number }) {
    if (!activeSession?.connected) { setNotice("Connect this session to a display first."); return false; }
    setOutputBusy(true);
    try {
      const response = await fetch(`/api/presenter/sessions/${encodeURIComponent(activeSessionId)}/output`, { method: "POST", headers: { ...requestHeaders, "content-type": "application/json", "x-csrf-token": csrfToken }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not update Presenter output.");
      setSessions((current) => current.map((session) => session.id === activeSessionId ? { ...session, visible: result.visible, songName: body.clear ? null : body.songNumber !== undefined ? selectedSong?.name ?? null : session.songName } : session));
      setShowOutput(result.visible);
      setNotice("");
      return true;
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not update Presenter output."); return false; }
    finally { setOutputBusy(false); }
  }

  async function presentSlide(index: number) {
    if (!capabilities.canPresent || !selectedSong) return;
    const sent = await sendOutputState({ visible: true, datasetId, songNumber: selectedSong.number, slideIndex: index });
    if (sent) setPresentedSlideIndex(index);
  }

  async function saveSessionName() {
    if (activeSessionId === "main" || !sessionNameDraft.trim()) return;
    setOutputBusy(true);
    try {
      const response = await fetch(`/api/presenter/sessions/${encodeURIComponent(activeSessionId)}`, { method: "PATCH", headers: { ...requestHeaders, "content-type": "application/json", "x-csrf-token": csrfToken }, body: JSON.stringify({ name: sessionNameDraft.trim() }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not rename this session.");
      setSessions((current) => current.map((session) => session.id === activeSessionId ? { ...session, name: result.name } : session));
      setNotice("Session name saved.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not rename this session."); }
    finally { setOutputBusy(false); }
  }

  async function copyOutputLink(link: string) {
    try { await navigator.clipboard.writeText(link); setNotice("Presenter link copied."); }
    catch { setNotice("Could not copy the link. Open it and copy it from the browser address bar."); }
  }

  async function openSong(song: SongSummary) {
    setNotice("");
    setPresentedSlideIndex(null);
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
    <header className="video-presenter-bar"><div><span className="video-presenter-live-dot" /><strong>Presenter</strong><span className="video-presenter-preview-label">DATASETS</span></div><span>{capabilities.canManageLayouts ? "Admin" : capabilities.canPresent ? "Operator" : capabilities.canEdit ? "Editor" : "Viewer"} · {activeSession?.name ?? "Main"} <i /> {activeSession?.connected ? "Display connected" : "Display not connected"}</span></header>
    <div className="video-presenter-layout">
      <aside className="video-presenter-sidebar">
        <section className="video-presenter-section">
          <button type="button" className="video-presenter-section-heading" aria-expanded={playlistOpen} onClick={() => setPlaylistOpen((open) => !open)}><strong>{playlistOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Playlists</strong><small>0</small></button>
          {playlistOpen && <><div className="video-presenter-create"><input aria-label="New playlist name" placeholder="New playlist name…" disabled={!capabilities.canEdit} /><button type="button" aria-label="Create playlist" disabled={!capabilities.canEdit}><Plus size={14} /></button></div><p className="video-presenter-empty-note">Create a playlist for a service rundown.</p></>}
        </section>
        <section className="video-presenter-section video-presenter-libraries">
          <button type="button" className="video-presenter-section-heading" aria-expanded={librariesOpen} onClick={() => setLibrariesOpen((open) => !open)}><strong>{librariesOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Datasets</strong><small>{datasets.length}</small></button>
          {librariesOpen && <>
            {defaultLibraries.map(({ id, icon: Icon }) => {
              const dataset = datasets.find((item) => item.id === id);
              return dataset ? <div className="video-presenter-tree-node" key={id}><button type="button" className={`video-presenter-library${datasetId === id ? " is-selected" : ""}`} aria-expanded={datasetId === id} onClick={() => { setDatasetId(id); setSearch(""); }}><Icon size={14} /><span>{dataset.name}</span><small>{dataset.songCount}</small>{datasetId === id ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</button>{datasetId === id && <div className="video-presenter-dataset-children" role="group" aria-label={`${dataset.name} songs`}><label className="video-presenter-search video-presenter-tree-search"><Search size={12} /><input type="search" placeholder="Search songs…" aria-label="Search songs by name" value={search} onChange={(event) => setSearch(event.target.value)} /></label><div className="video-presenter-song-list" aria-label="Songs in this dataset">{loading ? <p className="video-presenter-empty-note">Loading songs…</p> : songs.map((song) => <button type="button" key={song.number} className={selectedSong?.number === song.number ? "is-selected" : ""} onClick={() => void openSong(song)}><FileMusic size={12} /><span className="video-presenter-song-number">{String(song.sourceNumber).padStart(3, "0")}</span><span>{song.name}</span></button>)}{!loading && songs.length === 0 && <p className="video-presenter-empty-note">No songs match this name.</p>}</div></div>}</div> : null;
            })}
            {datasets.filter((item) => !defaultLibraries.some((builtin) => builtin.id === item.id)).map((dataset) => <div className="video-presenter-tree-node" key={dataset.id}><button type="button" className={`video-presenter-library${datasetId === dataset.id ? " is-selected" : ""}`} aria-expanded={datasetId === dataset.id} onClick={() => { setDatasetId(dataset.id); setSearch(""); }}><ListMusic size={14} /><span>{dataset.name}</span><small>{dataset.songCount}</small>{datasetId === dataset.id ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</button>{datasetId === dataset.id && <div className="video-presenter-dataset-children" role="group" aria-label={`${dataset.name} songs`}><label className="video-presenter-search video-presenter-tree-search"><Search size={12} /><input type="search" placeholder="Search songs…" aria-label="Search songs by name" value={search} onChange={(event) => setSearch(event.target.value)} /></label><div className="video-presenter-song-list" aria-label="Songs in this dataset">{loading ? <p className="video-presenter-empty-note">Loading songs…</p> : songs.map((song) => <button type="button" key={song.number} className={selectedSong?.number === song.number ? "is-selected" : ""} onClick={() => void openSong(song)}><FileMusic size={12} /><span className="video-presenter-song-number">{String(song.sourceNumber).padStart(3, "0")}</span><span>{song.name}</span></button>)}{!loading && songs.length === 0 && <p className="video-presenter-empty-note">No songs match this name.</p>}</div></div>}</div>)}
            {capabilities.canManageLayouts && <><input ref={importInput} type="file" accept=".gz,.scdataset.tar.gz,application/gzip" hidden onChange={(event) => void importDataset(event.target.files?.[0])} /><button type="button" className="video-presenter-import-dataset" onClick={() => importInput.current?.click()}><FileUp size={13} /> Import dataset package</button></>}
          </>}
        </section>
      </aside>

      <main className="video-presenter-editor">
        <div className="video-presenter-tools">
          <button type="button" onClick={() => setOutputVisible((visible) => !visible)}><SlidersHorizontal size={13} /> {outputVisible ? "Hide output panel" : "Show output panel"}</button>
          <label className="video-presenter-session-picker">Session <select aria-label="Presenter output session" value={activeSessionId} onChange={(event) => { setActiveSessionId(event.target.value); setPresentedSlideIndex(null); }}>{sessions.map((session) => <option key={session.id} value={session.id}>{session.name}</option>)}</select></label>
          <div className="video-presenter-output-menu" ref={outputSettingsRef}>
            <button type="button" aria-expanded={outputSettingsOpen} aria-controls="presenter-output-settings-menu" onClick={() => setOutputSettingsOpen((open) => !open)}><Settings2 size={13} /> Output settings</button>
            {outputSettingsOpen && <section id="presenter-output-settings-menu" className="video-presenter-output-menu-panel" aria-label="Output link settings">
              <h3>Output link settings · {activeSession?.name ?? "Main"}</h3>
              <label className="presenter-output-option">Background<select value={outputBackground} onChange={(event) => setOutputBackground(event.target.value)}><option value="black">Black</option><option value="white">White</option><option value="transparent">Transparent</option></select></label>
              <label className="presenter-output-check"><input type="checkbox" checked={preloadKiosk} onChange={(event) => setPreloadKiosk(event.target.checked)} /> Preload all slides for Kiosk</label>
              <p className="presenter-output-help">Preloads the current song’s slides, then refreshes when the song changes.</p>
              <label className="presenter-output-check"><input type="checkbox" checked={legacyBrowser} onChange={(event) => setLegacyBrowser(event.target.checked)} /> Legacy browser compatibility (Chromium 62)</label>
              <button type="button" className="presenter-output-action" onClick={() => void generateOutputLink("output")} disabled={!capabilities.canPresent || outputBusy}><ExternalLink size={14} />{outputBusy ? "Generating…" : "Generate Output link"}</button>
              {activeOutputLinks.output && <div className="presenter-output-link-row"><a href={activeOutputLinks.output} target="_blank" rel="noreferrer">Open Output</a><button type="button" onClick={() => void copyOutputLink(activeOutputLinks.output!)}><Copy size={13} /> Copy</button></div>}
              <button type="button" className="presenter-output-action" onClick={() => void generateOutputLink("kiosk")} disabled={!capabilities.canPresent || outputBusy}><Monitor size={14} />{outputBusy ? "Generating…" : "Generate Kiosk link"}</button>
              {activeOutputLinks.kiosk && <div className="presenter-output-link-row"><a href={activeOutputLinks.kiosk} target="_blank" rel="noreferrer">Open Kiosk</a><button type="button" onClick={() => void copyOutputLink(activeOutputLinks.kiosk!)}><Copy size={13} /> Copy</button></div>}
            </section>}
          </div>
          <button type="button" disabled={!capabilities.canEdit}><Upload size={13} /> Import slides…</button>
          <button type="button" disabled={!capabilities.canManageLayouts}><WandSparkles size={13} /> Layouts…</button>
          <label className="video-presenter-columns">Columns <input type="range" min="1" max="5" value={columns} onChange={(event) => setColumns(Number(event.target.value))} /><output>{columns}</output></label>
          <label className="video-presenter-show"><input type="checkbox" checked={showOutput} disabled={!capabilities.canPresent || !activeSession?.connected || !activeSession.songName || outputBusy} onChange={(event) => void sendOutputState({ visible: event.target.checked })} /> Show output</label>
          <button className="video-presenter-add-playlist" type="button" disabled={!capabilities.canEdit}><Plus size={13} /> Add to playlist</button>
        </div>
        <div className="video-presenter-slide-content">
          <header className="video-presenter-song-heading"><div><span className="presenter-eyebrow">SONG DATASET · {selectedDataset?.songCount ?? 0} SONGS</span><h2>{selectedDataset?.name ?? "Presenter datasets"}</h2><p>{selectedDataset?.description ?? "The song datasets are not installed on this server yet."}</p></div><div className="video-presenter-dataset-actions"><button type="button" onClick={() => void exportDataset()} disabled={!selectedDataset}><Download size={13} /> Export dataset</button></div></header>
          {notice && <p className="video-presenter-dataset-notice" role="status">{notice}</p>}
          <div className="video-presenter-dataset-browser">
            <div className="video-presenter-song-preview">{selectedSong ? <><header><div><span className="presenter-eyebrow">{selectedSong.sourceNumber} · {selectedSong.slides.length} SLIDES</span><h3>{selectedSong.name}</h3></div><span>{capabilities.canPresent ? `Click a slide to send to ${activeSession?.name ?? "Main"}` : "Built-in · Read only"}</span></header><div className="video-presenter-slide-grid" style={{ "--presenter-columns": columns } as CSSProperties}>{selectedSong.slides.map((slide, index) => <article key={`${selectedSong.number}-${index}`} className={`${slide.type === "text" && slide.layout === "lower-third" ? "is-lower-third " : ""}${presentedSlideIndex === index && activeSession?.songName === selectedSong.name ? "is-on-output" : ""}${capabilities.canPresent ? " is-presentable" : ""}`} role={capabilities.canPresent ? "button" : undefined} tabIndex={capabilities.canPresent ? 0 : undefined} onClick={() => void presentSlide(index)} onKeyDown={(event) => { if (capabilities.canPresent && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); void presentSlide(index); } }}>{slide.type === "image" ? <img src={slide.imageUrl} alt={`${selectedSong.name}, page ${slide.label}`} loading="lazy" /> : <div className="video-presenter-text-slide"><span>{slide.section || slide.label || "Slide"}</span><p>{slide.text}</p></div>}<small>{slide.label || `Slide ${index + 1}`}</small></article>)}</div></> : <div className="video-presenter-empty-state"><div className="video-presenter-empty-icon"><ListMusic size={24} /></div><h3>Choose a song</h3><p>Select a song to preview its notation or slides.</p></div>}</div>
          </div>
        </div>
        <div className="video-presenter-key-help">{capabilities.canPresent ? "Click a slide to present" : "Slide presentation requires Operator rights"} · <kbd>←</kbd> <kbd>→</kbd> move through slides · <kbd>Esc</kbd> clear output</div>
        <section className="video-presenter-rundown"><header><strong>Playlist</strong><span>PREVIEW ONLY</span></header><div><span><Plus size={15} /> Add songs to build a service rundown.</span></div></section>
      </main>

      {outputVisible && <aside className="video-presenter-inspector" aria-label="Presenter session output">
        <header><strong><Monitor size={14} /> {activeSession?.name ?? "Main"} output</strong><span className="video-presenter-output-badge">{activeSession?.connected ? showOutput ? "LIVE" : "BLANK" : "OFFLINE"}</span></header>
        <div className={`video-presenter-monitor${showOutput ? "" : " is-hidden"}`}>{showOutput && activeSession?.songName ? <div><Eye size={22} /><span>{activeSession.songName}</span></div> : <div><EyeOff size={22} /><span>{activeSession?.connected ? "Output is blank" : "Display not connected"}</span></div>}</div>
        <p className="video-presenter-output-caption">{activeSession?.connected ? showOutput ? `Showing on ${activeSession.name}` : `${activeSession.name} is connected and blank` : "Connect a browser on the display or projector."}</p>
        {activeSession?.connected && <section className="video-presenter-output-settings"><button type="button" className="presenter-output-action presenter-output-clear" onClick={() => { setPresentedSlideIndex(null); void sendOutputState({ visible: false, clear: true }); }} disabled={!capabilities.canPresent || outputBusy}><X size={14} /> Clear output</button></section>}
        {activeSession?.id !== "main" && capabilities.canManageLayouts && <section className="video-presenter-output-settings"><h3>Aux display name</h3><div className="presenter-session-name"><input aria-label="Aux session name" maxLength={32} value={sessionNameDraft} onChange={(event) => setSessionNameDraft(event.target.value)} /><button type="button" className="presenter-output-action" onClick={() => void saveSessionName()} disabled={outputBusy || !sessionNameDraft.trim()}>Save</button></div></section>}
      </aside>}
    </div>
    <footer className="video-presenter-status"><span><Monitor size={13} /> {activeSession?.name ?? "Main"}</span><span><i /> {activeSession?.connected ? "Display connected" : "No display connected"}</span><span><EyeOff size={13} /> Browser output</span></footer>
  </section>;
}
