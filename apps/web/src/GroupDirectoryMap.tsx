import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent } from "react";
import type { ChurchGroup } from "@smart-church/contracts";
import { clusterMapPins, fitPins, mapMaxZoom, mapMinZoom, normalizeView, panMap, visibleTiles, worldPoint, type MapView } from "./group-map-geometry";
import "./group-directory-map.css";

type GroupPin = NonNullable<ChurchGroup["meetingPin"]>;

export function GroupDirectoryMap({ groups, onGroup }: { groups: ChurchGroup[]; onGroup: (group: ChurchGroup) => void }) {
  const pins = useMemo(() => groups.flatMap(group => group.meetingPin ? [{ item: group, point: worldPoint(group.meetingPin) }] : []), [groups]);
  const [basemap, setBasemap] = useState(false);
  const [tileError, setTileError] = useState(false);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [adjusted, setAdjusted] = useState<{ pinKey: string; view: MapView } | null>(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set<string>());
  const canvas = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; initial: MapView } | null>(null);
  const hasPins = pins.length > 0;

  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) =>
      setViewport({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasPins]);

  if (!hasPins) return <p className="community-empty">No meeting pins match these group filters.</p>;
  const { width, height } = viewport;
  const pinKey = pins.map(({ item, point }) => `${item.id}:${point.x}:${point.y}`).join(";");
  const view = adjusted?.pinKey === pinKey ? adjusted.view : fitPins(pins.map(pin => pin.point), width, height);
  const setManualView = (changed: MapView | null) => setAdjusted(changed ? { pinKey, view: changed } : null);
  const cluster = clusterMapPins(pins, view, width, height);
  const selected = pins.filter(pin => selectedIds.has(pin.item.id));
  const tiles = basemap && width && height ? visibleTiles(view, width, height) : [];
  const zoom = (difference: number) => setManualView(normalizeView(view.center, view.zoom + difference));
  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as Element).closest("button, a")) return;
    drag.current = { x: event.clientX, y: event.clientY, initial: view };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  return <section className="groups-map" aria-label="Group meeting map">
    <div className="community-inline-actions">
      <span aria-live="polite">{pins.length} {pins.length === 1 ? "pinned group" : "pinned groups"}</span>
      <button type="button" className="button button-secondary" onClick={() => { setTileError(false); setBasemap(!basemap); }}>
        {basemap ? "Hide basemap" : "Load OpenStreetMap basemap"}
      </button>
      <button type="button" className="button button-secondary" onClick={() => { setManualView(null); setSelectedIds(new Set()); }}>Fit pins</button>
    </div>
    {!basemap && <p className="community-empty">Loading the basemap shares the viewed map region with OpenStreetMap.</p>}
    <div ref={canvas} className="groups-map-canvas" tabIndex={0} role="region" aria-label="Interactive group map. Use arrow keys to pan, plus and minus to zoom."
      onPointerDown={startDrag} onLostPointerCapture={() => { drag.current = null; }} onPointerMove={event => {
        if (drag.current) setManualView(panMap(drag.current.initial, event.clientX - drag.current.x, event.clientY - drag.current.y));
      }} onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        const offsets: Record<string, [number, number]> = { ArrowLeft: [80, 0], ArrowRight: [-80, 0], ArrowUp: [0, 80], ArrowDown: [0, -80] };
        const offset = offsets[event.key];
        if (offset) { event.preventDefault(); setManualView(panMap(view, ...offset)); }
        if (event.key === "+" || event.key === "=" || event.key === "-") { event.preventDefault(); zoom(event.key === "-" ? -1 : 1); }
      }}>
      <div className="groups-map-tiles" aria-hidden="true">
        {tiles.map(tile => <img key={tile.key} alt="" src={tile.url} referrerPolicy="strict-origin" draggable={false} width={256} height={256}
          onError={() => setTileError(true)} style={{ left: tile.left, top: tile.top }} />)}
      </div>
      {cluster.map(marker => <button className="groups-map-marker" type="button" key={marker.key} style={{ left: marker.x, top: marker.y }}
        aria-label={marker.items.length === 1 ? marker.items[0].name : `${marker.items.length} groups in this cluster`}
        onClick={() => {
          if (marker.items.length === 1) onGroup(marker.items[0]);
          else setSelectedIds(new Set(marker.items.map(group => group.id)));
        }}>{marker.items.length === 1 ? <span aria-hidden="true">●</span> : marker.items.length}</button>)}
      <div className="groups-map-zoom">
        <button type="button" className="button button-secondary" onClick={() => zoom(1)} disabled={view.zoom >= mapMaxZoom} aria-label="Zoom in">+</button>
        <button type="button" className="button button-secondary" onClick={() => zoom(-1)} disabled={view.zoom <= mapMinZoom} aria-label="Zoom out">−</button>
      </div>
      {basemap && <div className="groups-map-attribution">
        © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors
      </div>}
    </div>
    {tileError && basemap && <p role="status">The basemap is temporarily unavailable. Meeting pins are still shown.</p>}
    {selected.length > 1 && <section className="groups-map-cluster" aria-label="Groups in selected cluster">
      <div className="community-inline-actions">
        <strong>{selected.length} groups near this point</strong>
        <button className="button button-secondary" type="button" onClick={() => {
          const focused = fitPins(selected.map(pin => pin.point), width, height);
          setManualView(normalizeView(focused.center, Math.max(focused.zoom, view.zoom + 1)));
        }} disabled={view.zoom >= mapMaxZoom}>Zoom to cluster</button>
      </div>
      <ul>{selected.map(({ item }) => <li key={item.id}>
        <button type="button" className="button button-secondary" onClick={() => onGroup(item)}>{item.name}</button>
      </li>)}</ul>
    </section>}
  </section>;
}

export function GroupMeetingPinEditor({ group, departmentId, csrfToken, onSaved }: {
  group: ChurchGroup; departmentId: string; csrfToken: string; onSaved: () => Promise<void>;
}) {
  const [latitude, setLatitude] = useState(String(group.meetingPin?.latitude ?? ""));
  const [longitude, setLongitude] = useState(String(group.meetingPin?.longitude ?? ""));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function save(pin: GroupPin | null) {
    setBusy(true);
    setStatus("");
    setError("");
    try {
      const response = await fetch(`/api/groups/${group.id}/meeting-pin`, {
        method: "PUT", headers: { "content-type": "application/json", "x-csrf-token": csrfToken, "x-department-id": departmentId },
        body: JSON.stringify({ pin }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error ?? "Could not save the meeting pin.");
      }
      if (!pin) { setLatitude(""); setLongitude(""); }
      setStatus(pin ? "Meeting pin saved." : "Meeting pin removed.");
      await onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the meeting pin.");
    } finally { setBusy(false); }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !latitude.trim() || !longitude.trim()) return;
    void save({ latitude: Number(latitude), longitude: Number(longitude) });
  }

  return <details className="groups-map-editor">
    <summary>Meeting map pin</summary>
    <p>The pin is visible in this site’s Groups directory. Enter decimal coordinates for a meeting place you want to share. <a href="https://www.openstreetmap.org/" rel="noreferrer" target="_blank">Find coordinates on OpenStreetMap</a>.</p>
    <form className="community-inline-actions" onSubmit={submit}>
      <label>Latitude<input type="number" required step="any" min="-85.05112878" max="85.05112878" value={latitude} disabled={busy}
        onChange={event => setLatitude(event.target.value)} /></label>
      <label>Longitude<input type="number" required step="any" min="-180" max="180" value={longitude} disabled={busy}
        onChange={event => setLongitude(event.target.value)} /></label>
      <button className="button button-primary" type="submit" disabled={busy}>Save meeting pin</button>
      {group.meetingPin && <button className="button button-secondary" type="button" disabled={busy} onClick={() => void save(null)}>Remove meeting pin</button>}
    </form>
    {status && <p role="status">{status}</p>}
    {error && <p role="alert">{error}</p>}
  </details>;
}
