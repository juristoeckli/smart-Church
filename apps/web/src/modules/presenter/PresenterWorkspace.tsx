import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { AudioLines, ChevronDown, ChevronRight, Copy, Download, ExternalLink, Eye, EyeOff, FileMusic, FileUp, Folder, FolderPlus, GripVertical, ListMusic, Monitor, Music2, Pause, Play, Plus, Search, Settings2, SlidersHorizontal, Trash2, Upload, WandSparkles, X } from "lucide-react";
import type { UserLanguage } from "@smart-church/contracts";
import { translateModuleText, type ModuleRealtime } from "../../module-registry";
import { mergeModuleTranslationOverrides } from "../ui-translation-overrides";
import { translationsForModule } from "../translations";
import "./presenter.css";

type Dataset = { id: string; name: string; description: string; songCount: number; slideCount: number; builtIn: boolean };
type SongSummary = { number: number; sourceNumber: number; name: string; slideCount: number };
type AktuellEvent = { id: string; title: string; kind: string; event_date: string; start_time: string; end_time: string | null; location: string; room: string | null; description: string | null };
type Slide = { type: "text"; text: string; label?: string; section?: string; layout?: "lower-third" } | { type: "image"; asset: string; label: string; section?: string; imageUrl: string } | { type: "html"; asset: string; label: string; htmlUrl: string };
type MediaOutputSlide = { type: "media"; mediaId: string; kind: "image" | "video"; label: string; mediaUrl: string };
type OutputSlide = Slide | MediaOutputSlide;
type MediaPlayback = { action: "play" | "pause" | "seek"; currentTime: number; revision: number } | null;
type Song = SongSummary & { slides: Slide[] };
type PresenterSession = { id: string; name: string; connected: boolean; visible: boolean; songName: string | null; datasetId?: string | null; setNumber?: number | null; songNumber?: number | null; slideIndex?: number | null; slide?: OutputSlide | null; mediaPlayback?: MediaPlayback };
type PlaylistItem = { id: string; datasetId: string; songNumber: number; sourceNumber?: number; name: string };
type PresenterPlaylist = { id: string; name: string; items: PlaylistItem[] };
type PresentationLibrary = { id: string; name: string; presentationIds: string[] };
type PresenterMedia = { id: string; name: string; mimeType: string; kind: "image" | "video"; size: number; createdAt: string; url: string };
const playlistDragType = "application/x-smart-church-presenter-item";
const libraryDragType = "application/x-smart-church-library-entry";
const playlistOrderDragType = "application/x-smart-church-playlist-entry";

function readPresenterStorage<T>(key: string, fallback: T): T {
  try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback; }
  catch { return fallback; }
}

function moveItem<T>(items: T[], from: number, to: number) {
  if (from < 0 || to < 0 || from >= items.length || to >= items.length || from === to) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function createLocalId() { return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function formatMediaTime(time: number) { const seconds = Math.max(0, Math.floor(Number.isFinite(time) ? time : 0)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }
function defaultPresentationLibraries(): PresentationLibrary[] { return [{ id: "default-library", name: "My Library", presentationIds: [] }]; }
function fitRenderedSlide(frame: HTMLIFrameElement) {
  const deck = frame.contentDocument?.querySelector<HTMLElement>(".pp-deck");
  const width = Number(deck?.dataset.width);
  const height = Number(deck?.dataset.height);
  if (!deck || !width || !height || !frame.clientWidth || !frame.clientHeight) return;
  const scale = Math.min(frame.clientWidth / width, frame.clientHeight / height);
  deck.style.transformOrigin = "center center";
  deck.style.transform = `scale(${scale})`;
}
const defaultLibraries = [
  { id: "aktuell", name: "Aktuell", icon: ListMusic },
  { id: "singt-notation", name: "Singt with musical notes", icon: Music2 },
  { id: "singt-text", name: "Singt just text", icon: AudioLines },
  { id: "singt-lower-third", name: "Singt lower third", icon: FileMusic },
];
const presenterTranslations = mergeModuleTranslationOverrides("presenter", translationsForModule("presenter"));

export function PresenterWorkspace({ departmentId, csrfToken, realtime, language = "en", capabilities = { canEdit: true, canPresent: true, canManageLayouts: true } }: { departmentId: string; csrfToken: string; realtime?: ModuleRealtime; language?: UserLanguage; capabilities?: { canEdit: boolean; canPresent: boolean; canManageLayouts: boolean } }) {
  const confirmPresenterAction = (message: string) => window.confirm(translateModuleText(message, presenterTranslations, language));
  const [datasetId, setDatasetId] = useState(defaultLibraries[0].id);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [sessions, setSessions] = useState<PresenterSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("main");
  const [outputTokens, setOutputTokens] = useState<Record<string, string>>({});
  const [outputLinks, setOutputLinks] = useState<Record<string, string>>({});
  const [outputBackground, setOutputBackground] = useState("black");
  const [preloadOutput, setPreloadOutput] = useState(true);
  const [legacyBrowser, setLegacyBrowser] = useState(false);
  const [outputNotice, setOutputNotice] = useState("");
  const [outputSettingsOpen, setOutputSettingsOpen] = useState(false);
  const [sessionNameDraft, setSessionNameDraft] = useState("");
  const [showOutput, setShowOutput] = useState(false);
  const [outputBusy, setOutputBusy] = useState(false);
  const [presentedSlideIndex, setPresentedSlideIndex] = useState<number | null>(null);
  const [songs, setSongs] = useState<SongSummary[]>([]);
  const [aktuellEvents, setAktuellEvents] = useState<AktuellEvent[]>([]);
  const [aktuellEventsLoading, setAktuellEventsLoading] = useState(false);
  const [selectedSong, setSelectedSong] = useState<Song | null>(null);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [outputVisible, setOutputVisible] = useState(true);
  const [columns, setColumns] = useState(2);
  const [datasetsOpen, setDatasetsOpen] = useState(true);
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [playlistOpen, setPlaylistOpen] = useState(true);
  const [mediaOpen, setMediaOpen] = useState(true);
  const [libraryOrder, setLibraryOrder] = useState<string[]>(() => readPresenterStorage(`presenter-library-order:${departmentId}`, []));
  const [presentationLibraries, setPresentationLibraries] = useState<PresentationLibrary[]>(() => readPresenterStorage(`presenter-libraries:${departmentId}`, defaultPresentationLibraries()));
  const [activePresentationLibraryId, setActivePresentationLibraryId] = useState("default-library");
  const [playlists, setPlaylists] = useState<PresenterPlaylist[]>(() => readPresenterStorage(`presenter-playlists:${departmentId}`, []));
  const [playlistNameDraft, setPlaylistNameDraft] = useState("");
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null);
  const [importingPresentation, setImportingPresentation] = useState(false);
  const [importingMedia, setImportingMedia] = useState(false);
  const [mediaItems, setMediaItems] = useState<PresenterMedia[]>([]);
  const [mediaTimelineTime, setMediaTimelineTime] = useState(0);
  const [mediaTimelineDuration, setMediaTimelineDuration] = useState(0);
  const [mediaIsPlaying, setMediaIsPlaying] = useState(true);
  const importInput = useRef<HTMLInputElement>(null);
  const presentationInput = useRef<HTMLInputElement>(null);
  const pictureInput = useRef<HTMLInputElement>(null);
  const mediaInput = useRef<HTMLInputElement>(null);
  const outputSettingsRef = useRef<HTMLDivElement>(null);
  const outputVideoRef = useRef<HTMLVideoElement>(null);
  const mediaSeekTimer = useRef<number | null>(null);
  const preloadedOutputKey = useRef("");
  const latencySamples = useRef<number[]>([]);
  const latencyReportAt = useRef(0);

  const requestHeaders = useMemo(() => ({ "x-department-id": departmentId }), [departmentId]);
  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const outputPreview = activeSession?.slide ?? null;
  const outputVideoMediaId = outputPreview?.type === "media" && outputPreview.kind === "video" ? outputPreview.mediaId : null;
  const outputMediaIdRef = useRef<string | null>(null);
  outputMediaIdRef.current = showOutput ? outputVideoMediaId : null;
  const activeOutputLink = outputLinks[activeSessionId] ?? "";
  const presentations = datasets.filter((item) => item.id.startsWith("presentation-"));
  const activePresentationLibrary = presentationLibraries.find((library) => library.id === activePresentationLibraryId) ?? presentationLibraries[0];
  const folderPresentations = (library: PresentationLibrary) => [...presentations.filter((item) => library.presentationIds.includes(item.id)), ...presentations.filter((item) => !presentationLibraries.some((folder) => folder.presentationIds.includes(item.id)) && library.id === presentationLibraries[0]?.id)].sort((a, b) => {
    const aIndex = libraryOrder.indexOf(a.id); const bIndex = libraryOrder.indexOf(b.id);
    return (aIndex < 0 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex < 0 ? Number.MAX_SAFE_INTEGER : bIndex) || a.name.localeCompare(b.name);
  });
  const orderedPresentations = [...presentations].sort((a, b) => {
    const aIndex = libraryOrder.indexOf(a.id); const bIndex = libraryOrder.indexOf(b.id);
    return (aIndex < 0 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex < 0 ? Number.MAX_SAFE_INTEGER : bIndex) || a.name.localeCompare(b.name);
  });
  const activePlaylist = playlists.find((playlist) => playlist.id === activePlaylistId) ?? null;

  useEffect(() => {
    setLibraryOrder(readPresenterStorage(`presenter-library-order:${departmentId}`, []));
    setPresentationLibraries(readPresenterStorage(`presenter-libraries:${departmentId}`, defaultPresentationLibraries()));
    setActivePresentationLibraryId("default-library");
    setPlaylists(readPresenterStorage(`presenter-playlists:${departmentId}`, []));
    setActivePlaylistId(null);
  }, [departmentId]);

  useEffect(() => { try { localStorage.setItem(`presenter-library-order:${departmentId}`, JSON.stringify(libraryOrder)); } catch { /* Storage can be disabled by the browser. */ } }, [departmentId, libraryOrder]);
  useEffect(() => { try { localStorage.setItem(`presenter-libraries:${departmentId}`, JSON.stringify(presentationLibraries)); } catch { /* Storage can be disabled by the browser. */ } }, [departmentId, presentationLibraries]);
  useEffect(() => { try { localStorage.setItem(`presenter-playlists:${departmentId}`, JSON.stringify(playlists)); } catch { /* Storage can be disabled by the browser. */ } }, [departmentId, playlists]);

  useEffect(() => {
    const datasetIds = [...new Set(playlists.flatMap((playlist) => playlist.items.filter((item) => item.sourceNumber === undefined).map((item) => item.datasetId)))];
    if (!datasetIds.length) return;
    let cancelled = false;
    void Promise.all(datasetIds.map(async (id) => {
      try {
        const response = await fetch(`/api/presenter/datasets/${encodeURIComponent(id)}/songs`, { headers: requestHeaders });
        if (!response.ok) return [id, []] as const;
        return [id, await response.json() as SongSummary[]] as const;
      } catch { return [id, []] as const; }
    })).then((datasetsWithSongs) => {
      if (cancelled) return;
      const numberByDataset = new Map(datasetsWithSongs.map(([id, items]) => [id, new Map(items.map((song) => [song.number, song.sourceNumber]))]));
      setPlaylists((current) => {
        let changed = false;
        const next = current.map((playlist) => ({ ...playlist, items: playlist.items.map((item) => {
          const sourceNumber = item.sourceNumber ?? numberByDataset.get(item.datasetId)?.get(item.songNumber);
          if (sourceNumber === undefined || sourceNumber === item.sourceNumber) return item;
          changed = true;
          return { ...item, sourceNumber };
        }) }));
        return changed ? next : current;
      });
    });
    return () => { cancelled = true; };
  }, [playlists, requestHeaders]);

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
      const startedAt = performance.now();
      try {
        const response = await fetch("/api/presenter/sessions", { headers: requestHeaders, signal: controller.signal, cache: "no-store" });
        const result = await response.json();
        const finishedAt = performance.now();
        latencySamples.current.push(finishedAt - startedAt);
        if (!latencyReportAt.current || finishedAt - latencyReportAt.current >= 5000) {
          const samples = latencySamples.current;
          const average = Math.round(samples.reduce((total, sample) => total + sample, 0) / samples.length);
          console.info(`[Presenter operator] API round-trip: ${average} ms average over ${samples.length} request${samples.length === 1 ? "" : "s"}; latest ${Math.round(samples[samples.length - 1])} ms`);
          latencySamples.current = [];
          latencyReportAt.current = finishedAt;
        }
        if (!response.ok) throw new Error(result.error ?? "Could not load Presenter sessions.");
        setSessions(result as PresenterSession[]);
      } catch (error) { if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : "Could not load Presenter sessions."); }
    };
    void refreshSessions();
    const unsubscribeChanged = realtime?.subscribe("module:presenter:changed", () => { void refreshSessions(); });
    const unsubscribeConnected = realtime?.subscribe("realtime:connected", () => { void refreshSessions(); });
    return () => { controller.abort(); unsubscribeChanged?.(); unsubscribeConnected?.(); };
  }, [requestHeaders, realtime]);

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
    const controller = new AbortController();
    fetch("/api/presenter/media", { headers: requestHeaders, signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json()).error ?? "Could not load media.");
        return response.json() as Promise<PresenterMedia[]>;
      })
      .then(setMediaItems)
      .catch((error: unknown) => { if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : "Could not load media."); });
    return () => controller.abort();
  }, [requestHeaders]);

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

  useEffect(() => {
    if (datasetId !== "aktuell") { setAktuellEvents([]); return; }
    const controller = new AbortController();
    const query = new URLSearchParams();
    if (search.trim()) query.set("search", search.trim());
    setAktuellEventsLoading(true);
    fetch(`/api/presenter/datasets/aktuell/events?${query}`, { headers: requestHeaders, signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json()).error ?? "Could not search events.");
        return response.json() as Promise<{ events: AktuellEvent[] }>;
      })
      .then((result) => setAktuellEvents(result.events))
      .catch((error: unknown) => { if (!controller.signal.aborted) { setAktuellEvents([]); setNotice(error instanceof Error ? error.message : "Could not search events."); } })
      .finally(() => { if (!controller.signal.aborted) setAktuellEventsLoading(false); });
    return () => controller.abort();
  }, [datasetId, search, requestHeaders]);

  const selectedDataset = datasets.find((item) => item.id === datasetId);

  useEffect(() => {
    setShowOutput(activeSession?.visible ?? false);
    setSessionNameDraft(activeSession?.name ?? "");
  }, [activeSessionId, activeSession?.name, activeSession?.visible]);

  useEffect(() => {
    setMediaTimelineTime(0);
    setMediaTimelineDuration(0);
    setMediaIsPlaying(activeSession?.mediaPlayback?.action !== "pause");
  }, [activeSessionId, outputVideoMediaId]);

  useEffect(() => {
    if (!activeSession?.mediaPlayback) return;
    setMediaTimelineTime(activeSession.mediaPlayback.currentTime);
    setMediaIsPlaying(activeSession.mediaPlayback.action !== "pause");
  }, [activeSession?.mediaPlayback?.revision]);

  useEffect(() => () => {
    if (mediaSeekTimer.current !== null) window.clearTimeout(mediaSeekTimer.current);
  }, []);

  useEffect(() => {
    if (activeSession?.connected) setNotice("");
  }, [activeSession?.connected]);

  const requestOutputPreload = useCallback((targetDatasetId: string, setNumber: number) => {
    if (!preloadOutput || !capabilities.canPresent) return;
    const key = `${activeSessionId}:${targetDatasetId}:${setNumber}`;
    if (preloadedOutputKey.current === key) return;
    preloadedOutputKey.current = key;
    console.info(`[Presenter] Requesting output prerender for ${targetDatasetId}, set number ${setNumber}.`);
    void fetch(`/api/presenter/sessions/${encodeURIComponent(activeSessionId)}/preload`, {
      method: "POST",
      headers: { ...requestHeaders, "content-type": "application/json", "x-csrf-token": csrfToken },
      body: JSON.stringify({ datasetId: targetDatasetId, setNumber }),
    }).then(async (response) => {
      if (!response.ok) throw new Error((await response.json()).error ?? "Could not preload this song on the output.");
    }).catch((error: unknown) => {
      if (preloadedOutputKey.current === key) preloadedOutputKey.current = "";
      const message = error instanceof Error ? error.message : "Could not preload this song on the output.";
      console.warn(`[Presenter] Output prerender request failed: ${message}`);
      setOutputNotice(message);
    });
  }, [activeSessionId, capabilities.canPresent, csrfToken, preloadOutput, requestHeaders]);

  useEffect(() => {
    if (!selectedSong) return;
    requestOutputPreload(datasetId, selectedSong.sourceNumber);
  }, [datasetId, requestOutputPreload, selectedSong]);

  async function generateOutputLink() {
    setOutputBusy(true);
    setOutputNotice("");
    setNotice("");
    try {
      let token = outputTokens[activeSessionId];
      if (!token) {
        const response = await fetch(`/api/presenter/sessions/${encodeURIComponent(activeSessionId)}/connect`, { method: "POST", headers: { ...requestHeaders, "x-csrf-token": csrfToken } });
        const result = await response.json().catch(() => ({})) as { error?: string; token?: string };
        if (!response.ok) throw new Error(result.error ?? `Could not generate the Output link (server returned ${response.status}).`);
        if (!result.token) throw new Error("The server did not return an Output link token.");
        token = result.token;
        setOutputTokens((current) => ({ ...current, [activeSessionId]: token! }));
      }
      const link = new URL("/presenter-output.html", window.location.origin);
      link.searchParams.set("token", token);
      link.searchParams.set("background", outputBackground);
      link.searchParams.set("legacy", legacyBrowser ? "1" : "0");
      setOutputLinks((current) => ({ ...current, [activeSessionId]: link.toString() }));
      setOutputNotice(`Output link generated for ${activeSession?.name ?? "Main"}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not generate Presenter link.";
      setOutputNotice(message);
      setNotice(message);
    }
    finally { setOutputBusy(false); }
  }

  async function sendOutputState(body: { visible: boolean; clear?: boolean; datasetId?: string; setNumber?: number; songNumber?: number; slideIndex?: number; mediaId?: string; mediaAction?: "play" | "pause" | "seek"; currentTime?: number }) {
    setOutputBusy(true);
    try {
      const startedAt = performance.now();
      const response = await fetch(`/api/presenter/sessions/${encodeURIComponent(activeSessionId)}/output`, { method: "POST", headers: { ...requestHeaders, "content-type": "application/json", "x-csrf-token": csrfToken }, body: JSON.stringify(body) });
      const result = await response.json();
      console.info(`[Presenter operator] output command API round-trip: ${Math.round(performance.now() - startedAt)} ms`);
      if (!response.ok) throw new Error(result.error ?? "Could not update Presenter output.");
      const media = body.mediaId ? mediaItems.find((item) => item.id === body.mediaId) : undefined;
      setSessions((current) => current.map((session) => session.id === activeSessionId ? {
        ...session,
        visible: result.visible,
        songName: body.clear ? null : media?.name ?? (body.setNumber !== undefined || body.songNumber !== undefined ? selectedSong?.name ?? null : session.songName),
        datasetId: body.clear || media ? null : body.datasetId ?? session.datasetId ?? null,
        setNumber: body.clear || media ? null : body.setNumber ?? session.setNumber ?? null,
        songNumber: body.clear || media ? null : body.songNumber ?? session.songNumber ?? null,
        slideIndex: body.clear ? null : media ? 0 : body.slideIndex ?? session.slideIndex ?? null,
        slide: body.clear ? null : media ? { type: "media", mediaId: media.id, kind: media.kind, label: media.name, mediaUrl: media.url } : body.slideIndex !== undefined ? selectedSong?.slides[body.slideIndex] ?? session.slide ?? null : session.slide ?? null,
        mediaPlayback: body.clear || media || body.slideIndex !== undefined ? result.mediaPlayback ?? null : body.mediaAction ? result.mediaPlayback ?? session.mediaPlayback : session.mediaPlayback,
      } : session));
      setShowOutput(result.visible);
      setNotice("");
      return true;
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not update Presenter output."); return false; }
    finally { setOutputBusy(false); }
  }

  async function presentSlide(index: number) {
    if (!capabilities.canPresent || !selectedSong) return;
    const sent = await sendOutputState({ visible: true, datasetId, setNumber: selectedSong.sourceNumber, slideIndex: index });
    if (sent) setPresentedSlideIndex(index);
  }

  async function presentMedia(item: PresenterMedia) {
    if (!capabilities.canPresent) return;
    const sent = await sendOutputState({ visible: true, mediaId: item.id });
    if (sent) setPresentedSlideIndex(null);
  }

  async function controlOutputMedia(mediaId: string, action: "play" | "pause" | "seek", currentTime?: number) {
    if (!capabilities.canPresent || !showOutput || outputMediaIdRef.current !== mediaId) return;
    await sendOutputState({ visible: true, mediaAction: action, ...(currentTime !== undefined ? { currentTime } : {}) });
  }

  function updateMediaTimeline(time: number, sendUpdate = false) {
    setMediaTimelineTime(time);
    if (outputVideoRef.current && outputVideoRef.current.readyState >= 1) outputVideoRef.current.currentTime = time;
    if (!outputVideoMediaId) return;
    if (mediaSeekTimer.current !== null) window.clearTimeout(mediaSeekTimer.current);
    if (sendUpdate) {
      mediaSeekTimer.current = null;
      void controlOutputMedia(outputVideoMediaId, "seek", time);
    } else {
      mediaSeekTimer.current = window.setTimeout(() => {
        mediaSeekTimer.current = null;
        void controlOutputMedia(outputVideoMediaId, "seek", time);
      }, 120);
    }
  }

  useEffect(() => {
    const handlePresenterKeys = (event: KeyboardEvent) => {
      if (!capabilities.canPresent || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;

      if (event.key === "Delete") {
        event.preventDefault();
        setPresentedSlideIndex(null);
        void sendOutputState({ visible: false, clear: true });
        return;
      }

      if ((event.key !== "ArrowLeft" && event.key !== "ArrowRight") || !selectedSong) return;
      const isCurrentSong = activeSession?.songName === selectedSong.name;
      const currentIndex = isCurrentSong ? presentedSlideIndex : null;
      if (event.key === "ArrowLeft" && currentIndex === null) return;
      const nextIndex = Math.max(0, Math.min(selectedSong.slides.length - 1, (currentIndex ?? -1) + (event.key === "ArrowRight" ? 1 : -1)));
      if (nextIndex === currentIndex) return;
      event.preventDefault();
      void presentSlide(nextIndex);
    };
    window.addEventListener("keydown", handlePresenterKeys);
    return () => window.removeEventListener("keydown", handlePresenterKeys);
  }, [activeSession?.songName, capabilities.canPresent, presentedSlideIndex, selectedSong, sendOutputState, presentSlide]);

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
    try {
      if (!navigator.clipboard?.writeText || !window.isSecureContext) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(link);
      setNotice("Presenter link copied.");
      return;
    } catch {
      const input = document.createElement("textarea");
      input.value = link;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.append(input);
      input.select();
      let copied = false;
      try { copied = document.execCommand("copy"); } catch { /* Clipboard access may be blocked on HTTP. */ }
      input.remove();
      if (copied) {
        setNotice("Presenter link copied.");
        return;
      }
      window.prompt(translateModuleText("Copy Presenter output link:", presenterTranslations, language), link);
      setNotice("Clipboard access is blocked here. Copy the link from the dialog.");
    }
  }

  async function openSong(song: SongSummary) {
    setNotice("");
    setPresentedSlideIndex(null);
    const songDatasetId = datasetId;
    try {
      const response = await fetch(`/api/presenter/datasets/${encodeURIComponent(songDatasetId)}/songs/${song.number}`, { headers: requestHeaders });
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

  async function importPresentation(file?: File) {
    if (!file) return;
    setNotice("");
    setImportingPresentation(true);
    try {
      if (!file.name.toLowerCase().endsWith(".pptx")) throw new Error("Import a .pptx PowerPoint Open XML file.");
      const query = new URLSearchParams({ filename: file.name });
      const response = await fetch(`/api/presenter/library/presentations?${query}`, {
        method: "POST",
        headers: { ...requestHeaders, "content-type": "application/vnd.openxmlformats-officedocument.presentationml.presentation", "x-csrf-token": csrfToken },
        body: file,
      });
      const result = await response.json() as { id?: string; name?: string; slideCount?: number; error?: string };
      if (!response.ok || !result.id) throw new Error(result.error ?? "The presentation could not be imported.");
      const refreshed = await fetch("/api/presenter/datasets", { headers: requestHeaders }).then((item) => item.json() as Promise<Dataset[]>);
      setDatasets(refreshed);
      setLibraryOrder((current) => [...current.filter((id) => id !== result.id), result.id!]);
      setPresentationLibraries((current) => current.map((library) => library.id === activePresentationLibrary?.id ? { ...library, presentationIds: [...library.presentationIds.filter((id) => id !== result.id), result.id!] } : library));
      setLibraryOpen(true);
      setNotice(`Imported ${result.name ?? file.name} into ${activePresentationLibrary?.name ?? "My Library"} with ${result.slideCount ?? 0} slides. Text is available; slide visuals and formatting are not imported.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "The presentation could not be imported."); }
    finally {
      setImportingPresentation(false);
      if (presentationInput.current) presentationInput.current.value = "";
    }
  }

  async function importLibraryPicture(file?: File) {
    if (!file) return;
    setNotice("");
    setImportingPresentation(true);
    try {
      if (file.type !== "image/png" || file.size > 20 * 1024 * 1024) throw new Error("Choose a PNG picture no larger than 20 MiB.");
      const query = new URLSearchParams({ filename: file.name });
      const response = await fetch(`/api/presenter/library/pictures?${query}`, {
        method: "POST",
        headers: { ...requestHeaders, "content-type": "image/png", "x-csrf-token": csrfToken },
        body: file,
      });
      const result = await response.json() as { id?: string; name?: string; error?: string };
      if (!response.ok || !result.id) throw new Error(result.error ?? "The picture could not be imported.");
      const refreshed = await fetch("/api/presenter/datasets", { headers: requestHeaders }).then((item) => item.json() as Promise<Dataset[]>);
      setDatasets(refreshed);
      setLibraryOrder((current) => [...current.filter((id) => id !== result.id), result.id!]);
      setPresentationLibraries((current) => current.map((library) => library.id === activePresentationLibrary?.id ? { ...library, presentationIds: [...library.presentationIds.filter((id) => id !== result.id), result.id!] } : library));
      setNotice(`Added picture “${result.name ?? file.name}” to ${activePresentationLibrary?.name ?? "My Library"}.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "The picture could not be imported."); }
    finally { setImportingPresentation(false); if (pictureInput.current) pictureInput.current.value = ""; }
  }

  async function importMedia(file?: File) {
    if (!file) return;
    setNotice("");
    setImportingMedia(true);
    try {
      const supportedTypes = ["image/png", "image/jpeg", "image/webp", "video/mp4", "video/webm", "video/x-msvideo", "video/x-ms-wmv"];
      if (file.size === 0) throw new Error(`“${file.name}” is empty (0 bytes). Choose a non-empty media file.`);
      if (file.size > 1024 * 1024 * 1024) throw new Error(`“${file.name}” is larger than the 1 GiB import limit.`);
      const extension = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
      const typeByExtension: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/mp4", ".webm": "video/webm", ".avi": "video/x-msvideo", ".wmv": "video/x-ms-wmv" };
      const mimeType = supportedTypes.includes(file.type) ? file.type : typeByExtension[extension];
      if (!mimeType || !supportedTypes.includes(mimeType)) throw new Error(`“${file.name}” (${file.type || "unknown file type"}) is not supported. Use a PNG, JPEG, or WebP image, or an MP4, WebM, AVI, or WMV video.`);
      const query = new URLSearchParams({ filename: file.name });
      const response = await fetch(`/api/presenter/media?${query}`, {
        method: "POST",
        headers: { ...requestHeaders, "content-type": mimeType, "x-csrf-token": csrfToken },
        body: file,
      });
      let result: (PresenterMedia & { error?: string }) | { error?: string } = {};
      try { result = await response.json() as PresenterMedia & { error?: string }; } catch { /* The server may return a plain-text upload error. */ }
      if (!response.ok) {
        const message = result.error ?? (response.status === 413
          ? "The server rejected this video because it is larger than the 1 GiB import limit."
          : `The server could not import this file (HTTP ${response.status}).`);
        throw new Error(message);
      }
      if (!("id" in result) || !result.id) throw new Error(result.error ?? "The server accepted the upload but did not return a media item.");
      setMediaItems((current) => [result, ...current.filter((item) => item.id !== result.id)]);
      setNotice(`Imported “${result.name}” to Media.`);
    } catch (error) {
      console.error("[Presenter] Media import failed", JSON.stringify({ fileName: file.name, fileSize: file.size, fileType: file.type, error: error instanceof Error ? error.message : String(error) }));
      setNotice(error instanceof Error ? error.message : "The media file could not be imported.");
    }
    finally { setImportingMedia(false); if (mediaInput.current) mediaInput.current.value = ""; }
  }

  async function deleteMedia(item: PresenterMedia) {
    if (!capabilities.canManageLayouts || !confirmPresenterAction(`Delete media “${item.name}”? This cannot be undone.`)) return;
    try {
      const response = await fetch(`/api/presenter/media/${encodeURIComponent(item.id)}`, {
        method: "DELETE",
        headers: { ...requestHeaders, "x-csrf-token": csrfToken },
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not delete media.");
      setMediaItems((current) => current.filter((media) => media.id !== item.id));
      setSessions((current) => current.map((session) => session.slide?.type === "media" && session.slide.mediaId === item.id
        ? { ...session, visible: false, songName: null, datasetId: null, songNumber: null, slideIndex: null, slide: null, mediaPlayback: null }
        : session));
      if (activeSession?.slide?.type === "media" && activeSession.slide.mediaId === item.id) {
        setShowOutput(false);
        setPresentedSlideIndex(null);
      }
      setNotice(`Deleted “${item.name}”.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not delete media."); }
  }

  async function openLibraryPresentation(presentation: Dataset) {
    setDatasetId(presentation.id);
    setSelectedSong(null);
    setSongs([]);
    preloadedOutputKey.current = "";
    setSearch("");
    setLoading(true);
    setPresentedSlideIndex(null);
    try {
      const response = await fetch(`/api/presenter/datasets/${encodeURIComponent(presentation.id)}/songs`, { headers: requestHeaders });
      const result = await response.json() as SongSummary[] & { error?: string };
      if (!response.ok) throw new Error((result as unknown as { error?: string }).error ?? "Could not open this presentation.");
      setSongs(result);
      const first = result[0];
      if (!first) { setSelectedSong(null); return; }
      requestOutputPreload(presentation.id, first.sourceNumber);
      const detailResponse = await fetch(`/api/presenter/datasets/${encodeURIComponent(presentation.id)}/songs/${first.number}`, { headers: requestHeaders });
      const detail = await detailResponse.json() as Song & { error?: string };
      if (!detailResponse.ok) throw new Error(detail.error ?? "Could not load presentation slides.");
      setSelectedSong(detail);
    } catch (error) { setSelectedSong(null); setNotice(error instanceof Error ? error.message : "Could not open this presentation."); }
    finally { setLoading(false); }
  }

  async function removeDataset(id: string) {
    const response = await fetch(`/api/presenter/datasets/${encodeURIComponent(id)}`, { method: "DELETE", headers: { ...requestHeaders, "x-csrf-token": csrfToken } });
    const result = await response.json() as { error?: string };
    if (!response.ok) throw new Error(result.error ?? "Could not delete this item.");
    setDatasets((current) => current.filter((item) => item.id !== id));
    setLibraryOrder((current) => current.filter((item) => item !== id));
    setPresentationLibraries((current) => current.map((library) => ({ ...library, presentationIds: library.presentationIds.filter((item) => item !== id) })));
    setPlaylists((current) => current.map((playlist) => ({ ...playlist, items: playlist.items.filter((item) => item.datasetId !== id) })));
    if (datasetId === id) { setSelectedSong(null); setSongs([]); setDatasetId(defaultLibraries[0].id); }
  }

  function createPresentationLibrary() {
    const name = window.prompt(translateModuleText("Name this library", presenterTranslations, language));
    const trimmed = name?.trim();
    if (!trimmed || !capabilities.canManageLayouts) return;
    const library = { id: createLocalId(), name: trimmed.slice(0, 80), presentationIds: [] } satisfies PresentationLibrary;
    setPresentationLibraries((current) => [...current, library]);
    setActivePresentationLibraryId(library.id);
  }

  async function deletePresentationLibrary(library: PresentationLibrary) {
    const items = folderPresentations(library);
    const confirmation = items.length === 1
      ? `Delete library “${library.name}” and its ${items.length} presentation? This cannot be undone.`
      : items.length > 1
        ? `Delete library “${library.name}” and its ${items.length} presentations? This cannot be undone.`
        : `Delete library “${library.name}”? This cannot be undone.`;
    if (!confirmPresenterAction(confirmation)) return;
    const failed: string[] = [];
    for (const item of items) {
      try { await removeDataset(item.id); }
      catch (error) { failed.push(error instanceof Error ? `${item.name}: ${error.message}` : item.name); }
    }
    if (failed.length) {
      setNotice(`Some library contents could not be deleted: ${failed.join("; ")}`);
      return;
    }
    setPresentationLibraries((current) => current.filter((item) => item.id !== library.id));
    if (activePresentationLibraryId === library.id) setActivePresentationLibraryId(presentationLibraries.find((item) => item.id !== library.id)?.id ?? "");
    setNotice(`Deleted library “${library.name}”.`);
  }

  async function deletePresentation(presentation: Dataset) {
    if (!confirmPresenterAction(`Delete “${presentation.name}”? This cannot be undone.`)) return;
    try { await removeDataset(presentation.id); setNotice(`Deleted “${presentation.name}”.`); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Could not delete the presentation."); }
  }

  async function deleteCustomDataset(dataset: Dataset) {
    if (!confirmPresenterAction(`Delete library “${dataset.name}” and all of its songs? This cannot be undone.`)) return;
    try { await removeDataset(dataset.id); setNotice(`Deleted library “${dataset.name}”.`); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Could not delete the library."); }
  }

  function deletePlaylist(playlist: PresenterPlaylist) {
    if (!confirmPresenterAction(`Delete playlist “${playlist.name}”?`)) return;
    setPlaylists((current) => current.filter((item) => item.id !== playlist.id));
    if (activePlaylistId === playlist.id) setActivePlaylistId(null);
  }

  function createPlaylist() {
    const name = playlistNameDraft.trim();
    if (!name || !capabilities.canEdit) return;
    const playlist = { id: createLocalId(), name: name.slice(0, 80), items: [] } satisfies PresenterPlaylist;
    setPlaylists((current) => [...current, playlist]);
    setActivePlaylistId(playlist.id);
    setPlaylistNameDraft("");
  }

  function dragSong(event: DragEvent, dataset: Pick<Dataset, "id">, song: Pick<SongSummary, "number" | "sourceNumber" | "name">) {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(playlistDragType, JSON.stringify({ datasetId: dataset.id, songNumber: song.number, sourceNumber: song.sourceNumber, name: song.name }));
  }

  function handlePlaylistDrop(playlistId: string, event: DragEvent, targetItemId?: string) {
    event.preventDefault();
    event.stopPropagation();
    const rawItem = event.dataTransfer.getData(playlistDragType);
    if (!rawItem) return;
    let dragged: PlaylistItem & { sourcePlaylistId?: string };
    try { dragged = JSON.parse(rawItem) as PlaylistItem & { sourcePlaylistId?: string }; } catch { return; }
    if (!dragged.datasetId || !Number.isSafeInteger(dragged.songNumber) || dragged.songNumber < 1 || !dragged.name) return;
    setPlaylists((current) => current.map((playlist) => {
      if (playlist.id !== playlistId) return playlist;
      if (dragged.sourcePlaylistId === playlistId && dragged.id) {
        const from = playlist.items.findIndex((item) => item.id === dragged.id);
        const to = targetItemId ? playlist.items.findIndex((item) => item.id === targetItemId) : playlist.items.length - 1;
        return { ...playlist, items: moveItem(playlist.items, from, to) };
      }
      const item: PlaylistItem = { id: createLocalId(), datasetId: dragged.datasetId, songNumber: dragged.songNumber, sourceNumber: dragged.sourceNumber ?? dragged.songNumber, name: dragged.name };
      const targetIndex = targetItemId ? playlist.items.findIndex((existing) => existing.id === targetItemId) : -1;
      const items = [...playlist.items];
      items.splice(targetIndex < 0 ? items.length : targetIndex, 0, item);
      return { ...playlist, items };
    }));
  }

  function handleLibraryDrop(event: DragEvent, targetId: string) {
    event.preventDefault();
    const draggedId = event.dataTransfer.getData(libraryDragType);
    if (!draggedId || draggedId === targetId) return;
    const currentIds = orderedPresentations.map((presentation) => presentation.id);
    const nextIds = moveItem(currentIds, currentIds.indexOf(draggedId), currentIds.indexOf(targetId));
    setLibraryOrder(nextIds);
  }

  function handlePresentationFolderDrop(event: DragEvent, folderId: string) {
    event.preventDefault();
    const presentationId = event.dataTransfer.getData(libraryDragType);
    if (!presentationId || !presentations.some((item) => item.id === presentationId)) return;
    setPresentationLibraries((current) => current.map((library) => ({
      ...library,
      presentationIds: library.id === folderId
        ? [...library.presentationIds.filter((id) => id !== presentationId), presentationId]
        : library.presentationIds.filter((id) => id !== presentationId),
    })));
    setActivePresentationLibraryId(folderId);
  }

  function handlePlaylistOrderDrop(event: DragEvent, targetId: string) {
    event.preventDefault();
    const draggedId = event.dataTransfer.getData(playlistOrderDragType);
    if (!draggedId || draggedId === targetId) return;
    setPlaylists((current) => moveItem(current, current.findIndex((playlist) => playlist.id === draggedId), current.findIndex((playlist) => playlist.id === targetId)));
  }

  function addSelectedSongToPlaylist() {
    if (!selectedSong || !activePlaylistId || !capabilities.canEdit) return;
    const item: PlaylistItem = { id: createLocalId(), datasetId, songNumber: selectedSong.number, sourceNumber: selectedSong.sourceNumber, name: selectedSong.name };
    setPlaylists((current) => current.map((playlist) => playlist.id === activePlaylistId ? { ...playlist, items: [...playlist.items, item] } : playlist));
  }

  async function openPlaylistItem(item: PlaylistItem) {
    setDatasetId(item.datasetId);
    setSearch("");
    setPresentedSlideIndex(null);
    try {
      const response = await fetch(`/api/presenter/datasets/${encodeURIComponent(item.datasetId)}/songs/${item.songNumber}`, { headers: requestHeaders });
      const result = await response.json() as Song & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not open this playlist item.");
      setSelectedSong(result);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not open this playlist item."); }
  }

  return <section className={`video-presenter${outputVisible ? "" : " video-presenter-output-hidden"}`} aria-label="Presenter workspace">
    <header className="video-presenter-bar"><div><span className="video-presenter-live-dot" /><strong>Presenter</strong><span className="video-presenter-preview-label">DATASETS</span></div><span>{capabilities.canManageLayouts ? "Admin" : capabilities.canPresent ? "Operator" : capabilities.canEdit ? "Editor" : "Viewer"} · {activeSession?.name ?? "Main"} <i /> {activeSession?.connected ? "Display connected" : "Display not connected"}</span></header>
    {capabilities.canManageLayouts && <><input ref={presentationInput} type="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" hidden onChange={(event) => void importPresentation(event.currentTarget.files?.[0])} /><input ref={pictureInput} type="file" accept=".png,image/png" hidden onChange={(event) => void importLibraryPicture(event.currentTarget.files?.[0])} /><input ref={mediaInput} type="file" accept=".png,.jpg,.jpeg,.webp,.mp4,.m4v,.mov,.webm,.avi,.wmv,image/png,image/jpeg,image/webp,video/mp4,video/webm,video/x-msvideo,video/x-ms-wmv" hidden onChange={(event) => void importMedia(event.currentTarget.files?.[0])} /></>}
    <div className="video-presenter-layout">
      <aside className="video-presenter-sidebar">
        <section className="video-presenter-section video-presenter-datasets">
          <button type="button" className="video-presenter-section-heading" aria-expanded={datasetsOpen} aria-controls="presenter-datasets-content" onClick={() => setDatasetsOpen((open) => !open)}><strong>{datasetsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Datasets</strong><small>{datasets.filter((item) => !item.id.startsWith("presentation-")).length}</small></button>
          {datasetsOpen && <div id="presenter-datasets-content">
            {defaultLibraries.map(({ id, icon: Icon }) => {
              const dataset = datasets.find((item) => item.id === id);
              return dataset ? <div className="video-presenter-tree-node" key={id}><button type="button" className={`video-presenter-library${datasetId === id ? " is-selected" : ""}`} aria-expanded={datasetId === id} onClick={() => { setDatasetId(id); setSearch(""); }}><Icon size={14} /><span>{dataset.name}</span><small>{dataset.songCount}</small>{datasetId === id ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</button>{datasetId === id && <div className="video-presenter-dataset-children" role="group" aria-label={`${dataset.name} songs`}><label className="video-presenter-search video-presenter-tree-search"><Search size={12} /><input type="search" placeholder={id === "aktuell" ? "Search events…" : "Search songs…"} aria-label={id === "aktuell" ? "Search upcoming events" : "Search songs by name"} aria-busy={id === "aktuell" ? aktuellEventsLoading : undefined} aria-description={id === "aktuell" ? `${aktuellEvents.length} matching upcoming events` : undefined} value={search} onChange={(event) => setSearch(event.target.value)} /></label><div className="video-presenter-song-list" aria-label="Songs in this dataset">{loading ? <p className="video-presenter-empty-note">Loading songs…</p> : songs.map((song) => <button type="button" key={song.number} draggable={capabilities.canEdit} onDragStart={(event) => dragSong(event, dataset, song)} className={selectedSong?.number === song.number ? "is-selected" : ""} onClick={() => void openSong(song)}><FileMusic size={12} /><span className="video-presenter-song-number">{String(song.sourceNumber).padStart(3, "0")}</span><span>{song.name}</span></button>)}{!loading && songs.length === 0 && <p className="video-presenter-empty-note">{dataset.songCount === 0 ? "This dataset is empty." : "No songs match this name."}</p>}</div></div>}</div> : null;
            })}
            {datasets.filter((item) => !item.id.startsWith("presentation-") && !defaultLibraries.some((builtin) => builtin.id === item.id)).map((dataset) => <div className="video-presenter-tree-node" key={dataset.id}><div className="video-presenter-library-row"><button type="button" className={`video-presenter-library${datasetId === dataset.id ? " is-selected" : ""}`} aria-expanded={datasetId === dataset.id} onClick={() => { setDatasetId(dataset.id); setSearch(""); }}><ListMusic size={14} /><span>{dataset.name}</span><small>{dataset.songCount}</small>{datasetId === dataset.id ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</button>{capabilities.canManageLayouts && <button type="button" className="video-presenter-delete" aria-label={`Delete library ${dataset.name}`} title={`Delete library ${dataset.name}`} onClick={() => void deleteCustomDataset(dataset)}><Trash2 size={13} /></button>}</div>{datasetId === dataset.id && <div className="video-presenter-dataset-children" role="group" aria-label={`${dataset.name} songs`}><label className="video-presenter-search video-presenter-tree-search"><Search size={12} /><input type="search" placeholder="Search songs…" aria-label="Search songs by name" value={search} onChange={(event) => setSearch(event.target.value)} /></label><div className="video-presenter-song-list" aria-label="Songs in this dataset">{loading ? <p className="video-presenter-empty-note">Loading songs…</p> : songs.map((song) => <button type="button" key={song.number} draggable={capabilities.canEdit} onDragStart={(event) => dragSong(event, dataset, song)} className={selectedSong?.number === song.number ? "is-selected" : ""} onClick={() => void openSong(song)}><FileMusic size={12} /><span className="video-presenter-song-number">{String(song.sourceNumber).padStart(3, "0")}</span><span>{song.name}</span></button>)}{!loading && songs.length === 0 && <p className="video-presenter-empty-note">{dataset.songCount === 0 ? "This dataset is empty." : "No songs match this name."}</p>}</div></div>}</div>)}
            {capabilities.canManageLayouts && <><input ref={importInput} type="file" accept=".gz,.scdataset.tar.gz,application/gzip" hidden onChange={(event) => void importDataset(event.target.files?.[0])} /><button type="button" className="video-presenter-import-dataset" onClick={() => importInput.current?.click()}><FileUp size={13} /> Import dataset package</button></>}
          </div>}
        </section>
        <section className="video-presenter-section">
          <button type="button" className="video-presenter-section-heading" aria-expanded={libraryOpen} aria-controls="presenter-library-content" onClick={() => setLibraryOpen((open) => !open)}><strong>{libraryOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Library</strong><small>{presentations.length}</small></button>
          {libraryOpen && <div id="presenter-library-content">
            {capabilities.canManageLayouts && <><button type="button" className="video-presenter-import-dataset" onClick={createPresentationLibrary}><FolderPlus size={13} /> New library</button><button type="button" className="video-presenter-import-dataset" disabled={importingPresentation || !activePresentationLibrary} onClick={() => presentationInput.current?.click()}><FileUp size={13} /> {importingPresentation ? "Importing…" : "Import presentation"}{activePresentationLibrary ? ` to ${activePresentationLibrary.name}` : ""}</button><button type="button" className="video-presenter-import-dataset" disabled={importingPresentation || !activePresentationLibrary} onClick={() => pictureInput.current?.click()}><FileUp size={13} /> Import PNG picture</button></>}
            {presentationLibraries.map((library) => <div className="video-presenter-library-row" key={library.id} onDragOver={(event) => event.preventDefault()} onDrop={(event) => handlePresentationFolderDrop(event, library.id)}><button type="button" className={`video-presenter-library${activePresentationLibraryId === library.id ? " is-selected" : ""}`} onClick={() => setActivePresentationLibraryId(library.id)}><Folder size={14} /><span>{library.name}</span><small>{folderPresentations(library).length}</small></button>{capabilities.canManageLayouts && <button type="button" className="video-presenter-delete" aria-label={`Delete library ${library.name}`} title={`Delete library ${library.name}`} onClick={() => void deletePresentationLibrary(library)}><Trash2 size={13} /></button>}</div>)}
            {activePresentationLibrary && folderPresentations(activePresentationLibrary).map((presentation) => <div className="video-presenter-tree-node video-presenter-library-entry" key={presentation.id} draggable={capabilities.canEdit} onDragStart={(event) => { dragSong(event, presentation, { number: 1, sourceNumber: 1, name: presentation.name }); event.dataTransfer.effectAllowed = "copyMove"; event.dataTransfer.setData(libraryDragType, presentation.id); }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => handleLibraryDrop(event, presentation.id)}><div className="video-presenter-library-row"><button type="button" className={`video-presenter-library${datasetId === presentation.id ? " is-selected" : ""}`} onClick={() => void openLibraryPresentation(presentation)}><GripVertical size={13} /><FileMusic size={14} /><span>{presentation.name}</span><small>{presentation.slideCount}</small></button>{capabilities.canManageLayouts && <button type="button" className="video-presenter-delete" aria-label={`Delete presentation ${presentation.name}`} title={`Delete presentation ${presentation.name}`} onClick={() => void deletePresentation(presentation)}><Trash2 size={13} /></button>}</div></div>)}
            {presentations.length === 0 && <p className="video-presenter-empty-note">Create a library, then import a presentation into it.</p>}
          </div>}
        </section>
        <section className="video-presenter-section">
          <button type="button" className="video-presenter-section-heading" aria-expanded={playlistOpen} aria-controls="presenter-playlists-content" onClick={() => setPlaylistOpen((open) => !open)}><strong>{playlistOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Playlists</strong><small>{playlists.length}</small></button>
          {playlistOpen && <div id="presenter-playlists-content">
            <form className="video-presenter-create" onSubmit={(event) => { event.preventDefault(); createPlaylist(); }}><input aria-label="New playlist name" placeholder="New playlist name…" value={playlistNameDraft} onChange={(event) => setPlaylistNameDraft(event.target.value)} disabled={!capabilities.canEdit} /><button type="submit" aria-label="Create playlist" disabled={!capabilities.canEdit || !playlistNameDraft.trim()}><Plus size={14} /></button></form>
            <div className="video-presenter-playlist-list">{playlists.map((playlist) => <div className="video-presenter-library-row" key={playlist.id} draggable={capabilities.canEdit} onDragStart={(event) => event.dataTransfer.setData(playlistOrderDragType, playlist.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => handlePlaylistOrderDrop(event, playlist.id)}><button type="button" className={`video-presenter-library${playlist.id === activePlaylistId ? " is-selected" : ""}`} onClick={() => setActivePlaylistId(playlist.id)}><GripVertical size={13} /><ListMusic size={14} /><span>{playlist.name}</span><small>{playlist.items.length}</small></button>{capabilities.canEdit && <button type="button" className="video-presenter-delete" aria-label={`Delete playlist ${playlist.name}`} title={`Delete playlist ${playlist.name}`} onClick={() => deletePlaylist(playlist)}><Trash2 size={13} /></button>}</div>)}</div>
            {activePlaylist ? <div className="video-presenter-playlist-items" aria-label={`${activePlaylist.name} items`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => handlePlaylistDrop(activePlaylist.id, event)}>{activePlaylist.items.map((item) => <button type="button" key={item.id} draggable={capabilities.canEdit} onClick={() => void openPlaylistItem(item)} onDragStart={(event) => { event.dataTransfer.effectAllowed = "copyMove"; event.dataTransfer.setData(playlistDragType, JSON.stringify({ ...item, sourcePlaylistId: activePlaylist.id })); }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => handlePlaylistDrop(activePlaylist.id, event, item.id)} className="video-presenter-playlist-item"><GripVertical size={12} /><span>{String(item.sourceNumber ?? item.songNumber).padStart(3, "0")}. {item.name}</span></button>)}<p className="video-presenter-empty-note">Drag songs or presentations here; drag items to reorder.</p></div> : <p className="video-presenter-empty-note">Create or select a playlist. Drag songs or presentations from Datasets or Library into it.</p>}
          </div>}
        </section>
        <section className="video-presenter-section">
          <button type="button" className="video-presenter-section-heading" aria-expanded={mediaOpen} aria-controls="presenter-media-content" onClick={() => setMediaOpen((open) => !open)}><strong>{mediaOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Media</strong><small>{mediaItems.length}</small></button>
          {mediaOpen && <div id="presenter-media-content">
            {capabilities.canManageLayouts && <button type="button" className="video-presenter-import-dataset" disabled={importingMedia} onClick={() => mediaInput.current?.click()}><Upload size={13} /> {importingMedia ? "Importing media…" : "Import media"}</button>}
            {mediaItems.length ? <div className="video-presenter-media-list" aria-label="Imported media">{mediaItems.map((item) => <article className="video-presenter-media-item" key={item.id}>{item.kind === "image" ? <img src={item.url} alt="" loading="lazy" /> : <video src={item.url} muted playsInline preload="metadata" controls aria-label={item.name} />}<span title={item.name}>{item.name}</span><button type="button" className="video-presenter-media-send" disabled={!capabilities.canPresent || outputBusy} onClick={() => void presentMedia(item)}><Monitor size={11} /> Send to output</button>{capabilities.canManageLayouts && <button type="button" className="video-presenter-media-delete" onClick={() => void deleteMedia(item)}><Trash2 size={11} /> Delete media</button>}</article>)}</div> : <p className="video-presenter-empty-note">Import images or videos to keep them in Media.</p>}
          </div>}
        </section>
      </aside>

      <main className="video-presenter-editor">
        <div className="video-presenter-tools">
          <button type="button" onClick={() => setOutputVisible((visible) => !visible)}><SlidersHorizontal size={13} /> {outputVisible ? "Hide output panel" : "Show output panel"}</button>
          <div className="video-presenter-output-menu" ref={outputSettingsRef}>
            <button type="button" aria-expanded={outputSettingsOpen} aria-controls="presenter-output-settings-menu" onClick={() => setOutputSettingsOpen((open) => !open)}><Settings2 size={13} /> Output settings</button>
            {outputSettingsOpen && <section id="presenter-output-settings-menu" className="video-presenter-output-menu-panel" aria-label="Output link settings">
              <h3>Output link settings · {activeSession?.name ?? "Main"}</h3>
              <label className="video-presenter-session-picker">Control session<select aria-label="Presenter output session" value={activeSessionId} onChange={(event) => { setActiveSessionId(event.target.value); setPresentedSlideIndex(null); setOutputNotice(""); }}>
                <option value="main">Main</option>{Array.from({ length: 10 }, (_, index) => { const id = `aux${index + 1}`; const session = sessions.find((item) => item.id === id); return <option key={id} value={id}>{session?.name ?? `Aux ${index + 1}`}</option>; })}
              </select></label>
              {activeSessionId !== "main" && <div className="presenter-session-name presenter-output-session-name"><label htmlFor="presenter-aux-name">Aux session name</label><div><input id="presenter-aux-name" aria-label="Aux session name" maxLength={32} value={sessionNameDraft} onChange={(event) => setSessionNameDraft(event.target.value)} /><button type="button" className="presenter-output-action" onClick={() => void saveSessionName()} disabled={!capabilities.canPresent || outputBusy || !sessionNameDraft.trim()}>Save</button></div></div>}
              <label className="presenter-output-option">Background<select value={outputBackground} onChange={(event) => setOutputBackground(event.target.value)}><option value="black">Black</option><option value="white">White</option><option value="transparent">Transparent</option></select></label>
              <label className="presenter-output-check"><input type="checkbox" checked={preloadOutput} onChange={(event) => setPreloadOutput(event.target.checked)} /> Preload and prerender slides when opened</label>
              <p className="presenter-output-help">Slides prepare as soon as you open them. A connected display receives changes live.</p>
              <label className="presenter-output-check"><input type="checkbox" checked={legacyBrowser} onChange={(event) => setLegacyBrowser(event.target.checked)} /> Legacy browser compatibility (Chromium 62)</label>
              <button type="button" className="presenter-output-action" onClick={() => void generateOutputLink()} disabled={!capabilities.canPresent || outputBusy}><ExternalLink size={14} />{outputBusy ? "Generating…" : "Generate Output link"}</button>
              {activeOutputLink && <div className="presenter-output-link-row"><a href={activeOutputLink} target="_blank" rel="noreferrer">Open Output</a><button type="button" onClick={() => void copyOutputLink(activeOutputLink)}><Copy size={13} /> Copy</button></div>}
              {outputNotice && <p className="presenter-output-notice" role="status">{outputNotice}</p>}
            </section>}
          </div>
          <button type="button" disabled={!capabilities.canManageLayouts || importingPresentation} onClick={() => presentationInput.current?.click()}><Upload size={13} /> Import presentation…</button>
          <button type="button" disabled={!capabilities.canManageLayouts}><WandSparkles size={13} /> Layouts…</button>
          <label className="video-presenter-columns">Columns <input type="range" min="1" max="5" value={columns} onChange={(event) => setColumns(Number(event.target.value))} /><output>{columns}</output></label>
          <label className="video-presenter-show"><input type="checkbox" checked={showOutput} disabled={!capabilities.canPresent || !activeSession?.songName || outputBusy} onChange={(event) => void sendOutputState({ visible: event.target.checked })} /> Show output</label>
          <button className="video-presenter-add-playlist" type="button" disabled={!capabilities.canEdit || !selectedSong || !activePlaylist} onClick={addSelectedSongToPlaylist}><Plus size={13} /> Add to playlist</button>
        </div>
        <div className="video-presenter-slide-content">
          <header className="video-presenter-song-heading"><div><span className="presenter-eyebrow">{selectedDataset?.id.startsWith("presentation-") ? `PRESENTATION · ${selectedDataset.slideCount} SLIDES` : `SONG DATASET · ${selectedDataset?.songCount ?? 0} SONGS`}</span><h2>{selectedDataset?.name ?? "Presenter datasets"}</h2><p>{selectedDataset?.description ?? "The song datasets are not installed on this server yet."}</p></div><div className="video-presenter-dataset-actions"><button type="button" onClick={() => void exportDataset()} disabled={!selectedDataset}><Download size={13} /> Export dataset</button></div></header>
          {notice && <p className="video-presenter-dataset-notice" role="status">{notice}</p>}
          <div className="video-presenter-dataset-browser">
            <div className="video-presenter-song-preview">{selectedSong ? <><header><div><span className="presenter-eyebrow">{selectedSong.sourceNumber} · {selectedSong.slides.length} SLIDES</span><h3>{selectedSong.name}</h3></div><span>{capabilities.canPresent ? `Click a slide to send to ${activeSession?.name ?? "Main"}` : "Built-in · Read only"}</span></header><div className="video-presenter-slide-grid" style={{ "--presenter-columns": columns } as CSSProperties}>{selectedSong.slides.map((slide, index) => <article key={`${selectedSong.number}-${index}`} className={`${slide.type === "text" && slide.layout === "lower-third" ? "is-lower-third " : ""}${presentedSlideIndex === index && activeSession?.songName === selectedSong.name ? "is-on-output" : ""}${capabilities.canPresent ? " is-presentable" : ""}`} role={capabilities.canPresent ? "button" : undefined} tabIndex={capabilities.canPresent ? 0 : undefined} onClick={() => void presentSlide(index)} onKeyDown={(event) => { if (capabilities.canPresent && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); void presentSlide(index); } }}>{slide.type === "image" ? <img src={slide.imageUrl} alt={`${selectedSong.name}, page ${slide.label}`} loading="lazy" /> : slide.type === "html" ? <iframe sandbox="allow-same-origin" title={slide.label} src={slide.htmlUrl} loading="lazy" tabIndex={-1} onLoad={(event) => fitRenderedSlide(event.currentTarget)} /> : <div className="video-presenter-text-slide"><span>{slide.section || slide.label || "Slide"}</span><p>{slide.text}</p></div>}<small>{slide.label || `Slide ${index + 1}`}</small></article>)}</div></> : <div className="video-presenter-empty-state"><div className="video-presenter-empty-icon"><ListMusic size={24} /></div><h3>Choose a song or presentation</h3><p>Select a song or an imported presentation to preview its slides.</p></div>}</div>
          </div>
        </div>
        <div className="video-presenter-key-help">{capabilities.canPresent ? "Click a slide to present" : "Slide presentation requires Operator rights"} · <kbd>←</kbd> <kbd>→</kbd> move through slides · <kbd>Del</kbd> clear output</div>
        <section className="video-presenter-rundown"><header><strong>{activePlaylist?.name ?? "Playlist"}</strong><span>{activePlaylist ? `${activePlaylist.items.length} ITEMS` : "DRAG TO ADD"}</span></header><div className="video-presenter-rundown-items" onDragOver={(event) => event.preventDefault()} onDrop={(event) => activePlaylist && handlePlaylistDrop(activePlaylist.id, event)}>{activePlaylist?.items.length ? activePlaylist.items.map((item) => <button type="button" key={item.id} draggable={capabilities.canEdit} onClick={() => void openPlaylistItem(item)} onDragStart={(event) => event.dataTransfer.setData(playlistDragType, JSON.stringify({ ...item, sourcePlaylistId: activePlaylist.id }))} onDragOver={(event) => event.preventDefault()} onDrop={(event) => handlePlaylistDrop(activePlaylist.id, event, item.id)}><GripVertical size={13} /><span>{String(item.sourceNumber ?? item.songNumber).padStart(3, "0")}. {item.name}</span></button>) : <span><Plus size={15} /> {activePlaylist ? "Drag songs or presentations here to add them." : "Create or select a playlist, then drag songs here."}</span>}</div></section>
      </main>

      {outputVisible && <aside className="video-presenter-inspector" aria-label="Presenter session output">
        <header><strong><Monitor size={14} /> {activeSession?.name ?? "Main"} output</strong><span className="video-presenter-output-badge">{activeSession?.connected ? showOutput ? "LIVE" : "BLANK" : showOutput ? "PREPARED" : "OFFLINE"}</span></header>
        <div className={`video-presenter-monitor${showOutput ? "" : " is-hidden"}`}>{showOutput && outputPreview ? outputPreview.type === "media" ? outputPreview.kind === "image" ? <img src={outputPreview.mediaUrl} alt={outputPreview.label} /> : <div className="video-presenter-video-output"><video ref={outputVideoRef} src={outputPreview.mediaUrl} autoPlay={activeSession?.mediaPlayback?.action !== "pause"} muted playsInline onLoadedMetadata={(event) => { const video = event.currentTarget; const targetTime = activeSession?.mediaPlayback?.currentTime ?? 0; if (Math.abs(video.currentTime - targetTime) > 0.35) video.currentTime = targetTime; setMediaTimelineDuration(Number.isFinite(video.duration) ? video.duration : 0); setMediaTimelineTime(video.currentTime); setMediaIsPlaying(!video.paused); }} onDurationChange={(event) => setMediaTimelineDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)} onTimeUpdate={(event) => setMediaTimelineTime(event.currentTarget.currentTime)} onPlay={(event) => { setMediaIsPlaying(true); void controlOutputMedia(outputPreview.mediaId, "play", event.currentTarget.currentTime); }} onPause={(event) => { setMediaIsPlaying(false); if (!event.currentTarget.ended) void controlOutputMedia(outputPreview.mediaId, "pause", event.currentTarget.currentTime); }} /><div className="video-presenter-playback"><button type="button" aria-label={mediaIsPlaying ? "Pause output media" : "Play output media"} title={mediaIsPlaying ? "Pause" : "Play"} disabled={!capabilities.canPresent} onClick={() => { const video = outputVideoRef.current; if (!video) return; if (video.paused) void video.play().catch(() => {}); else video.pause(); }}>{mediaIsPlaying ? <Pause size={13} /> : <Play size={13} />}</button><input type="range" min="0" max={mediaTimelineDuration || 0} step="0.05" value={Math.min(mediaTimelineTime, mediaTimelineDuration || mediaTimelineTime)} aria-label={`Seek ${outputPreview.label}`} disabled={!capabilities.canPresent || !mediaTimelineDuration} onChange={(event) => updateMediaTimeline(Number(event.currentTarget.value))} onPointerUp={(event) => updateMediaTimeline(Number(event.currentTarget.value), true)} onKeyUp={(event) => updateMediaTimeline(Number(event.currentTarget.value), true)} /><span>{formatMediaTime(mediaTimelineTime)} / {formatMediaTime(mediaTimelineDuration)}</span></div></div> : outputPreview.type === "image" ? <img src={outputPreview.imageUrl} alt={outputPreview.label || activeSession?.songName || "Current output slide"} /> : outputPreview.type === "html" ? <iframe sandbox="allow-same-origin" title={outputPreview.label} src={outputPreview.htmlUrl} onLoad={(event) => fitRenderedSlide(event.currentTarget)} /> : <div className={`video-presenter-monitor-slide${outputPreview.layout === "lower-third" ? " is-lower-third" : ""}`}><p>{outputPreview.text}</p></div> : showOutput && activeSession?.songName ? <div><Eye size={22} /><span>{activeSession.songName}</span></div> : <div><EyeOff size={22} /><span>{activeSession?.connected ? "Output is blank" : "Display not connected"}</span></div>}</div>
        <p className="video-presenter-output-caption">{activeSession?.connected ? showOutput ? `Showing on ${activeSession.name}` : `${activeSession.name} is connected and blank` : showOutput ? "Output is prepared; the display will update when it connects." : "Connect a browser on the display or projector."}</p>
        <section className="video-presenter-output-settings"><button type="button" className="presenter-output-action presenter-output-clear" onClick={() => { setPresentedSlideIndex(null); void sendOutputState({ visible: false, clear: true }); }} disabled={!capabilities.canPresent || outputBusy}><X size={14} /> Clear output</button></section>
      </aside>}
    </div>
    <footer className="video-presenter-status"><span><Monitor size={13} /> {activeSession?.name ?? "Main"}</span><span><i /> {activeSession?.connected ? "Display connected" : "No display connected"}</span><span><EyeOff size={13} /> Browser output</span></footer>
  </section>;
}
