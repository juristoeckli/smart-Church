import { useState } from "react";
import { AudioLines, ChevronDown, ChevronRight, Eye, EyeOff, FileMusic, ListMusic, Monitor, Music2, Plus, Search, SlidersHorizontal, Upload, WandSparkles } from "lucide-react";

const libraries = [
  { name: "Singt Notation", description: "Original pages with notation", icon: Music2 },
  { name: "Singt Text", description: "Lyrics without notation", icon: AudioLines },
  { name: "Singt Lower Third", description: "Lower-third lyrics", icon: FileMusic },
];

export function PresenterWorkspace({ capabilities = { canEdit: true, canPresent: true, canManageLayouts: true } }: { capabilities?: { canEdit: boolean; canPresent: boolean; canManageLayouts: boolean } }) {
  const [library, setLibrary] = useState(libraries[0].name);
  const [outputVisible, setOutputVisible] = useState(true);
  const [showOutput, setShowOutput] = useState(true);
  const [columns, setColumns] = useState(2);
  const [playlistOpen, setPlaylistOpen] = useState(true);
  const [librariesOpen, setLibrariesOpen] = useState(true);

  return <section className={`video-presenter${outputVisible ? "" : " video-presenter-output-hidden"}`} aria-label="Presenter workspace preview">
    <header className="video-presenter-bar"><div><span className="video-presenter-live-dot" /><strong>Presenter</strong><span className="video-presenter-preview-label">VISUAL PREVIEW</span></div><span>{capabilities.canManageLayouts ? "Admin" : capabilities.canPresent ? "Operator" : capabilities.canEdit ? "Editor" : "Viewer"} · Session Main <i /> Live output not connected</span></header>
    <div className="video-presenter-layout">
      <aside className="video-presenter-sidebar">
        <section className="video-presenter-section">
          <button type="button" className="video-presenter-section-heading" aria-expanded={playlistOpen} onClick={() => setPlaylistOpen((open) => !open)}><strong>{playlistOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Playlists</strong><small>0</small></button>
          {playlistOpen && <><div className="video-presenter-create"><input aria-label="New playlist name" placeholder="New playlist name…" disabled={!capabilities.canEdit} /><button type="button" aria-label="Create playlist" disabled={!capabilities.canEdit}><Plus size={14} /></button></div><p className="video-presenter-empty-note">Create a playlist for a service rundown.</p></>}
        </section>
        <section className="video-presenter-section video-presenter-libraries">
          <button type="button" className="video-presenter-section-heading" aria-expanded={librariesOpen} onClick={() => setLibrariesOpen((open) => !open)}><strong>{librariesOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Libraries</strong><small>3</small></button>
          {librariesOpen && <><div className="video-presenter-create"><input aria-label="New library name" placeholder="New library…" disabled /><button type="button" aria-label="Create library" disabled><Plus size={14} /></button></div>{libraries.map(({ name, icon: Icon }) => <button type="button" key={name} className={`video-presenter-library${library === name ? " is-selected" : ""}`} onClick={() => setLibrary(name)}><Icon size={14} /><span>{name}</span><small>—</small><ChevronRight size={12} /></button>)}</>}
          <div className="video-presenter-library-note"><Monitor size={14} /><span>Library connection will be added in a later step.</span></div>
        </section>
      </aside>

      <main className="video-presenter-editor">
        <div className="video-presenter-tools">
          <button type="button" onClick={() => setOutputVisible((visible) => !visible)}><SlidersHorizontal size={13} /> {outputVisible ? "Hide output panel" : "Show output panel"}</button>
          <button type="button" disabled={!capabilities.canEdit}><Upload size={13} /> Import…</button>
          <button type="button" disabled={!capabilities.canManageLayouts}><WandSparkles size={13} /> Layouts…</button>
          <label className="video-presenter-columns">Columns <input type="range" min="1" max="5" value={columns} onChange={(event) => setColumns(Number(event.target.value))} /><output>{columns}</output></label>
          <label className="video-presenter-show"><input type="checkbox" checked={showOutput} onChange={(event) => setShowOutput(event.target.checked)} /> Show output</label>
          <button className="video-presenter-add-playlist" type="button" disabled={!capabilities.canEdit}><Plus size={13} /> Add to playlist</button>
        </div>
        <div className="video-presenter-slide-content">
          <header className="video-presenter-song-heading"><div><span className="video-eyebrow">LIBRARY PREVIEW</span><h2>{library}</h2><p>{libraries.find((item) => item.name === library)?.description}</p></div><label className="video-presenter-search"><Search size={14} /><input type="search" placeholder="Search songs…" aria-label="Search songs" disabled /></label></header>
          <div className="video-presenter-empty-state"><div className="video-presenter-empty-icon"><ListMusic size={24} /></div><h3>Choose a song</h3><p>Connect a presentation library to browse songs and preview slides here.</p></div>
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
    <footer className="video-presenter-status"><span><Monitor size={13} /> Main seat</span><span><i /> Visual preview · no live output</span><span><EyeOff size={13} /> No projector connected</span></footer>
  </section>;
}
