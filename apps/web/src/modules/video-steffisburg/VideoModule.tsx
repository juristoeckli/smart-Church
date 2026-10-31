import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Activity, AlertTriangle, Check, ChevronDown, Clock3, Cloud, Download, LockKeyhole, Monitor, Play, Plus, Radio, RefreshCw, Route, Save, Settings2, Shield, Square, Trash2, Video } from "lucide-react";
import type { ModuleRealtime } from "../../module-registry";
import { formatUserDate } from "../../date-format";
import { BmdVolumeMenu } from "./BmdVolumeMenu";
import { IpAddress } from "./IpAddress";
import "./video.css";

type Encoder = { id: string; name: string; ip?: string; model?: string; control?: string; state?: Record<string, unknown>; error?: string; streaming_settings?: Record<string, unknown> };
type Device = { id: string; name: string; type?: string; ip?: string; port?: number; status_port?: number; ping?: string; receiver_status?: string; receiver_checked_at?: number; stream_state?: Record<string, string>; stream_checked_at?: number; power?: string; power_error?: string; error?: string };
function bridgeStreamStatus(device: Device): "Live" | "Idle" | "Unavailable" {
  const state = device.stream_state ?? {};
  if (!Object.keys(state).length) return "Unavailable";
  const status = state.Status?.trim().toLowerCase();
  const streaming = state.Streaming?.trim().toLowerCase();
  return status === "streaming" || status === "live" || status === "receiving"
    || ["true", "yes", "1", "streaming", "live", "receiving"].includes(streaming ?? "")
    ? "Live" : "Idle";
}
type VideoSite = { id: string; name: string; router_ip?: string; router_model?: string; router_status?: string; encoders: Encoder[]; devices: Device[] };
type RouteState = { connected?: boolean; error?: string; model?: string; inputs?: string[]; outputs?: string[]; routes?: number[]; locks?: string[] };
type RouteHistoryChange = { output: number; before?: number | null; after?: number; user?: string; time?: number };
type RouteHistoryDetail = { field: string; index: number; before?: unknown; after?: unknown; user?: string; time?: number };
type RouteHistoryEvent = { id?: string; time?: number; started_at?: number; user?: string; kind?: string; changes?: RouteHistoryChange[]; details?: RouteHistoryDetail[]; state?: RouteState };
type ApiSnapshot = { error?: string; message?: string; available?: boolean; worker?: { state: string; error?: string | null }; status?: { sites?: VideoSite[]; videohubs?: Record<string, RouteState>; vpn?: { state?: string; error?: string | null } } };
type Preset = { id: string; name: string; revision?: string; routes?: number[] };
type EncoderProfile = { profile: string; configs?: { bitrate?: number }[] };
type EncoderSettings = { platform: string; server?: string; quality: string; url: string; protocol: string; has_key: boolean; profiles: EncoderProfile[]; status: string; presets: unknown; customizable_url: boolean };
type EncoderPresetDetails = { platform: string; servers: { server: string; url: string }[]; profiles: EncoderProfile[]; default_quality?: string; has_key: boolean; deletion?: { allowed?: boolean; reason?: string; filename?: string; services?: string[] } };
type EncoderSettingsForm = { preset: string; server: string; quality: string; protocol: string; url: string; key: string; passphrase: string };
type XmlService = { platform: string; customizable_url: boolean; servers: { server: string; url: string }[]; profiles: { profile: string }[] };
type XmlPreflight = { filename?: string; services?: string[]; replaces_existing?: boolean };
type PlannedEvent = { id: string; title: string; eventDate: string; startTime: string; endTime?: string; speaker: string; theme: string; source: string; startsAt: string; isCurrent: boolean; relation?: "previous" | "following" | "anchor" | "current" };
type YoutubePlaylist = { id: string; title: string };
type PlannedStream = { id: string; eventId?: string | null; title: string; description: string; speaker: string; theme: string; startsAt: string; privacyStatus: "private" | "unlisted" | "public"; youtubeBroadcastId?: string | null; youtubeStatus: "local" | "scheduled" | "error" | "recorded_unlisted"; youtubeError?: string | null; youtubePlaylistId?: string | null; youtubePlaylistTitle?: string | null; studioUrl: string };
type PlannedStreamsState = { nextEvent: PlannedEvent | null; adjacentEvents: PlannedEvent[]; streams: PlannedStream[]; playlists: YoutubePlaylist[]; youtube: { configured: boolean; connected: boolean; channelTitle?: string } };
type YoutubeStudioBroadcast = { id: string; title: string; startsAt: string | null; status: string; privacyStatus: "private" | "unlisted" | "public"; previewUrl: string | null; studioUrl: string };
type YoutubeStudioSelection = YoutubeStudioBroadcast & {
  broadcastId: string;
  streamStatus: string;
  streamQuality: { status: string | null; issues: Array<{ type: string; severity: string; reason: string; description: string }> };
  concurrentViewers: number | null;
  likeCount: number | null;
};
type YoutubePastStream = { id: string; title: string; startsAt: string | null; endedAt: string | null; thumbnailUrl: string | null; privacyStatus: "private" | "unlisted" | "public"; viewCount: number | null; likeCount: number | null; watchUrl: string; studioUrl: string };
type StreamWizard = { step: "choose" | "settings"; service: PlannedEvent; streamId: string | null; title: string; speaker: string; theme: string; startsAt: string; privacyStatus: "private" | "unlisted" | "public"; playlistId: string };
function eventSourceLabel(source: string) {
  if (!source || source.toLowerCase() === "local") return "Local";
  if (source.toLowerCase() === "churchtools") return "ChurchTools";
  return source;
}
function youtubeBroadcastStatusLabel(status?: string) {
  switch (status) {
    case "live": return "Live";
    case "liveStarting": return "Starting live";
    case "testing": return "Preview";
    case "testStarting": return "Starting preview";
    case "ready": return "Scheduled";
    case "complete": return "Ended";
    case "revoked": return "Revoked";
    default: return status ?? "Loading…";
  }
}
function youtubeQualityLabel(status?: string | null) {
  switch (status) {
    case "good": return "Good";
    case "ok": return "Warnings";
    case "bad": return "Poor";
    case "noData": return "No data";
    default: return "Unavailable";
  }
}

export const videoTabs = ["Overview", "Routing", "Names & locks", "Streaming", "XML tools"] as const;
export type VideoTab = typeof videoTabs[number];
const starterXml = `<?xml version="1.0" encoding="UTF-8"?>\n<streaming>\n  <service customizable-url="false">\n    <name>Service 1</name>\n    <servers>\n      <server>\n        <name>Primary</name>\n        <url>rtmp://example.com/live</url>\n      </server>\n    </servers>\n    <profiles default="Streaming High">\n      <profile>\n        <name>Streaming High</name>\n        <config resolution="1080p" fps="30" codec="H264">\n          <bitrate>6000000</bitrate>\n          <audio-bitrate>128000</audio-bitrate>\n        </config>\n      </profile>\n    </profiles>\n  </service>\n</streaming>`;
export function VideoModule({ departmentId, csrfToken, realtime, capabilities, tab, onTabChange }: { departmentId: string; csrfToken: string; realtime?: ModuleRealtime; capabilities: { canOperateStreaming: boolean; canManageEncoders: boolean; canManageRouting: boolean; canAdminRouting: boolean }; tab: VideoTab; onTabChange: (tab: VideoTab) => void }) {
  const [snapshot, setSnapshot] = useState<ApiSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [history, setHistory] = useState<RouteHistoryEvent[]>([]);
  const [historyLive, setHistoryLive] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [labelDrafts, setLabelDrafts] = useState<Record<string, string>>({});
  const [presets, setPresets] = useState<Preset[]>([]);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [presetNameOpen, setPresetNameOpen] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [pendingPresetAction, setPendingPresetAction] = useState<{ kind: "recall" | "delete"; preset: Preset } | null>(null);
  const presetsMenuRef = useRef<HTMLDivElement>(null);
  const [hoveredCrosspoint, setHoveredCrosspoint] = useState<{ output: number; input: number } | null>(null);
  const [selectedEncoder, setSelectedEncoder] = useState("");
  const [xml, setXml] = useState(starterXml);
  const [xmlPreview, setXmlPreview] = useState<{ services?: XmlService[] } | null>(null);
  const [xmlPlan, setXmlPlan] = useState<XmlPreflight | null>(null);
  const [xmlPlatform, setXmlPlatform] = useState("");
  const [xmlServer, setXmlServer] = useState("");
  const [xmlQuality, setXmlQuality] = useState("");
  const [xmlCustomUrl, setXmlCustomUrl] = useState("");
  const [reviewedXml, setReviewedXml] = useState("");
  const [xmlServiceIndex, setXmlServiceIndex] = useState(0);
  const [xmlServerIndex, setXmlServerIndex] = useState(0);
  const [xmlProfileIndex, setXmlProfileIndex] = useState(0);
  const [xmlModeIndex, setXmlModeIndex] = useState(0);
  const [encoderSettings, setEncoderSettings] = useState<EncoderSettings | null>(null);
  const [presetDetails, setPresetDetails] = useState<EncoderPresetDetails | null>(null);
  const [settingsForm, setSettingsForm] = useState<EncoderSettingsForm>({ preset: "", server: "", quality: "", protocol: "srt", url: "", key: "", passphrase: "" });
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [plannedStreamsState, setPlannedStreamsState] = useState<PlannedStreamsState | null>(null);
  const [plannedStreamsLoading, setPlannedStreamsLoading] = useState(false);
  const [plannedStreamsError, setPlannedStreamsError] = useState("");
  const [nextServiceCollapsed, setNextServiceCollapsed] = useState(false);
  const [remoteSitePowerCollapsed, setRemoteSitePowerCollapsed] = useState(true);
  const [highlightedStreamId, setHighlightedStreamId] = useState("");
  const [planningStream, setPlanningStream] = useState(false);
  const [streamWizard, setStreamWizard] = useState<StreamWizard | null>(null);
  const [streamWizardError, setStreamWizardError] = useState("");
  const [connectingYoutube, setConnectingYoutube] = useState(false);
  const [youtubeStudioBroadcasts, setYoutubeStudioBroadcasts] = useState<YoutubeStudioBroadcast[]>([]);
  const [youtubeStudioActiveBroadcasts, setYoutubeStudioActiveBroadcasts] = useState<YoutubeStudioBroadcast[]>([]);
  const [youtubeStudioBroadcastId, setYoutubeStudioBroadcastId] = useState("");
  const [youtubeStudioSelection, setYoutubeStudioSelection] = useState<YoutubeStudioSelection | null>(null);
  const [youtubeStudioLoading, setYoutubeStudioLoading] = useState(false);
  const [youtubeStudioActionBusy, setYoutubeStudioActionBusy] = useState(false);
  const [youtubeStudioError, setYoutubeStudioError] = useState("");
  const [youtubeStudioNotice, setYoutubeStudioNotice] = useState("");
  const [youtubePastStreams, setYoutubePastStreams] = useState<YoutubePastStream[]>([]);
  const [youtubePastStreamsLoading, setYoutubePastStreamsLoading] = useState(false);
  const [youtubePastStreamsError, setYoutubePastStreamsError] = useState("");
  const xmlFileInput = useRef<HTMLInputElement>(null);

  const api = useCallback(async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
    const headers = new Headers(options.headers);
    headers.set("x-department-id", departmentId);
    if (options.method && options.method !== "GET") {
      if (options.body !== undefined) headers.set("content-type", "application/json");
      headers.set("x-csrf-token", csrfToken);
    }
    const response = await fetch(path, { ...options, headers, cache: "no-store" });
    const result = await response.json() as T & { error?: string; message?: string };
    if (!response.ok) {
      const validationMessage = result.error === "Bad Request" ? result.message : undefined;
      throw new Error(validationMessage || result.error || result.message || `Video request failed (${response.status}).`);
    }
    return result;
  }, [csrfToken, departmentId]);

  const refresh = useCallback(async () => {
    try {
      const result = await api<ApiSnapshot>("/api/video/status");
      setSnapshot(result);
      const sites = result.status?.sites ?? [];
      const encoders = sites.flatMap((site) => site.encoders.map((encoder) => ({ ...encoder, key: `${site.id}|${encoder.id}` })));
      if (!selectedEncoder && encoders[0]) setSelectedEncoder(encoders[0].key);
      setNotice("");
    } catch (error) {
      setSnapshot({ available: false, worker: { state: "unavailable", error: error instanceof Error ? error.message : "Video service unavailable." } });
    } finally {
      setLoading(false);
    }
  }, [api, selectedEncoder]);

  useEffect(() => {
    setLoading(true);
    setSnapshot(null);
    void refresh();
    const unsubscribeStatus = realtime?.subscribe("module:video-steffisburg:status", () => { void refresh(); });
    const unsubscribeChanged = realtime?.subscribe("module:video-steffisburg:changed", () => { void refresh(); });
    const unsubscribeConnected = realtime?.subscribe("realtime:connected", () => { void refresh(); });
    const statusRefresh = window.setInterval(() => { void refresh(); }, 15_000);
    return () => { window.clearInterval(statusRefresh); unsubscribeStatus?.(); unsubscribeChanged?.(); unsubscribeConnected?.(); };
  }, [realtime, refresh]);

  const refreshPlannedStreams = useCallback(async () => {
    setPlannedStreamsLoading(true);
    try {
      setPlannedStreamsState(await api<PlannedStreamsState>("/api/video/planned-streams"));
      setPlannedStreamsError("");
    } catch (error) {
      setPlannedStreamsState((current) => current ? { ...current, streams: [], playlists: [] } : current);
      setPlannedStreamsError(error instanceof Error ? error.message : "Could not load planned streams.");
    } finally {
      setPlannedStreamsLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (tab !== "Overview") return;
    void refreshPlannedStreams();
    const timer = window.setInterval(() => { void refreshPlannedStreams(); }, 60_000);
    return () => window.clearInterval(timer);
  }, [tab, refreshPlannedStreams]);

  const refreshYoutubeStudioBroadcasts = useCallback(async () => {
    if (tab !== "Overview" || !plannedStreamsState?.youtube.connected) {
      setYoutubeStudioBroadcasts([]);
      setYoutubeStudioActiveBroadcasts([]);
      setYoutubeStudioBroadcastId("");
      setYoutubeStudioSelection(null);
      return;
    }
    try {
      const result = await api<{ broadcasts: YoutubeStudioBroadcast[]; activeBroadcasts: YoutubeStudioBroadcast[] }>("/api/video/youtube/studio-control");
      setYoutubeStudioBroadcasts(result.broadcasts);
      setYoutubeStudioActiveBroadcasts(result.activeBroadcasts);
      setYoutubeStudioError("");
      setYoutubeStudioBroadcastId((current) => {
        if (result.activeBroadcasts.some((broadcast) => broadcast.id === current)) return current;
        if (result.broadcasts.some((broadcast) => broadcast.id === current)) return current;
        if (result.activeBroadcasts.length) return result.activeBroadcasts[0].id;
        return result.broadcasts[0]?.id ?? "";
      });
    } catch (error) {
      setYoutubeStudioBroadcasts([]);
      setYoutubeStudioActiveBroadcasts([]);
      setYoutubeStudioBroadcastId("");
      setYoutubeStudioSelection(null);
      setYoutubeStudioError(error instanceof Error ? error.message : "Could not load YouTube Studio broadcasts.");
    }
  }, [api, plannedStreamsState?.youtube.connected, tab, youtubeStudioSelection?.status]);

  useEffect(() => {
    void refreshYoutubeStudioBroadcasts();
    if (tab !== "Overview" || !plannedStreamsState?.youtube.connected) return;
    const timer = window.setInterval(() => { void refreshYoutubeStudioBroadcasts(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [refreshYoutubeStudioBroadcasts, tab, plannedStreamsState?.youtube.connected]);

  const refreshYoutubePastStreams = useCallback(async () => {
    if (tab !== "Overview" || !plannedStreamsState?.youtube.connected) {
      setYoutubePastStreams([]);
      setYoutubePastStreamsError("");
      return;
    }
    setYoutubePastStreamsLoading(true);
    try {
      const result = await api<{ streams: YoutubePastStream[] }>("/api/video/youtube/past-streams");
      setYoutubePastStreams(result.streams);
      setYoutubePastStreamsError("");
    } catch (error) {
      setYoutubePastStreamsError(error instanceof Error ? error.message : "Could not load past YouTube livestreams.");
    } finally {
      setYoutubePastStreamsLoading(false);
    }
  }, [api, plannedStreamsState?.youtube.connected, tab]);

  useEffect(() => {
    void refreshYoutubePastStreams();
    if (tab !== "Overview" || !plannedStreamsState?.youtube.connected) return;
    const timer = window.setInterval(() => { void refreshYoutubePastStreams(); }, 5 * 60_000);
    return () => window.clearInterval(timer);
  }, [plannedStreamsState?.youtube.connected, refreshYoutubePastStreams, tab]);

  useEffect(() => {
    if (tab !== "Overview" || !plannedStreamsState?.youtube.connected || !youtubeStudioBroadcastId) {
      setYoutubeStudioSelection(null);
      setYoutubeStudioLoading(false);
      return;
    }
    let active = true;
    let firstLoad = true;
    setYoutubeStudioLoading(true);
    const refreshSelectedBroadcast = async () => {
      try {
        const result = await api<YoutubeStudioSelection>(`/api/video/youtube/studio-control?broadcastId=${encodeURIComponent(youtubeStudioBroadcastId)}`);
        if (active) {
          setYoutubeStudioSelection(result);
          setYoutubeStudioError("");
        }
      } catch (error) {
        if (active) setYoutubeStudioError(error instanceof Error ? error.message : "Could not load the YouTube stream preview.");
      } finally {
        if (active && firstLoad) {
          firstLoad = false;
          setYoutubeStudioLoading(false);
        }
      }
    };
    void refreshSelectedBroadcast();
    const timer = window.setInterval(() => { void refreshSelectedBroadcast(); }, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [api, plannedStreamsState?.youtube.connected, tab, youtubeStudioBroadcastId]);

  async function transitionYoutubeStream(target: "testing" | "live" | "complete") {
    if (!youtubeStudioBroadcastId) return;
    setYoutubeStudioActionBusy(true);
    setYoutubeStudioError("");
    setYoutubeStudioNotice("");
    try {
      const result = await api<{ status: string }>(`/api/video/youtube/studio-control/${encodeURIComponent(youtubeStudioBroadcastId)}/transition`, {
        method: "POST", body: JSON.stringify({ target }),
      });
      setYoutubeStudioNotice(target === "testing" ? "YouTube is starting the private preview." : target === "live" ? "YouTube is starting the live broadcast." : "YouTube is ending the live broadcast.");
      setYoutubeStudioSelection((current) => current ? { ...current, status: result.status } : current);
      if (target === "complete") {
        setYoutubeStudioBroadcastId("");
        setYoutubeStudioSelection(null);
        await refreshYoutubeStudioBroadcasts();
      }
      await refreshPlannedStreams();
    } catch (error) {
      setYoutubeStudioError(error instanceof Error ? error.message : "YouTube could not change the broadcast status.");
    } finally {
      setYoutubeStudioActionBusy(false);
    }
  }

  useEffect(() => {
    if (!settingsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSettingsForm((current) => ({ ...current, key: "", passphrase: "" }));
        setSettingsOpen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [settingsOpen]);

  useEffect(() => {
    if (!presetsOpen) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !presetsMenuRef.current?.contains(event.target)) {
        setPresetsOpen(false);
        setPresetNameOpen(false);
        setPresetName("");
        setPendingPresetAction(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPresetsOpen(false);
        setPresetNameOpen(false);
        setPresetName("");
        setPendingPresetAction(null);
      }
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [presetsOpen]);

  const sites = snapshot?.status?.sites ?? [];
  const encoders = useMemo(() => sites.flatMap((site) => site.encoders.map((encoder) => ({ ...encoder, site, key: `${site.id}|${encoder.id}` }))), [sites]);
  const hubs = useMemo(() => sites.flatMap((site) => site.devices.filter((device) => device.type === "videohub").map((device) => ({ ...device, site, key: `${site.id}|${device.id}` }))), [sites]);
  const hub = hubs[0];
  const matrix = snapshot?.status?.videohubs?.[hub?.key ?? ""];
  const xmlEncoder = encoders.find((encoder) => encoder.key === selectedEncoder) ?? encoders[0];
  const visualDocument = useMemo(() => parseStreamingXml(xml), [xml]);
  const visualServices = visualDocument ? xmlChildren(visualDocument.documentElement, "service") : [];
  const visualService = visualServices[xmlServiceIndex] ?? visualServices[0];
  const visualServers = visualService ? xmlChildren(xmlChild(visualService, "servers"), "server") : [];
  const visualServer = visualServers[xmlServerIndex];
  const visualProfilesNode = visualService ? xmlChild(visualService, "profiles") : null;
  const visualProfiles = visualProfilesNode ? xmlChildren(visualProfilesNode, "profile") : [];
  const visualProfile = visualProfiles[xmlProfileIndex];
  const visualModes = visualProfile ? xmlChildren(visualProfile, "config") : [];
  const visualMode = visualModes[xmlModeIndex];
  const encoderPresetNames = [...new Set([...presetNames(encoderSettings?.presets), ...(encoderSettings?.platform ? [encoderSettings.platform] : [])])];
  const selectedProfile = presetDetails?.profiles.find((profile) => profile.profile === settingsForm.quality);
  const bitrateMbit = selectedProfile?.configs?.[0]?.bitrate ? (selectedProfile.configs[0].bitrate / 1_000_000).toString() : "";
  const canApplySettings = Boolean(capabilities.canManageEncoders && !busy && encoderSettings?.status === "Idle" && encoderSettings.platform === settingsForm.preset && encoderSettings.server === settingsForm.server);
  const ready = snapshot?.available === true && snapshot.worker?.state === "ready";

  useEffect(() => {
    if (tab !== "Routing" || !hub) return;
    void loadHistory(hub.id, hub.site.id);
    if (!historyLive) return;
    const refreshHistory = () => { void loadHistory(hub.id, hub.site.id); };
    const unsubscribeStatus = realtime?.subscribe("module:video-steffisburg:status", refreshHistory);
    const unsubscribeChanged = realtime?.subscribe("module:video-steffisburg:changed", refreshHistory);
    return () => { unsubscribeStatus?.(); unsubscribeChanged?.(); };
  }, [tab, hub?.key, historyLive, realtime]);

  async function send(operation: string, data: Record<string, unknown>, successMessage?: string) {
    setBusy(true);
    try {
      const result = await api<unknown>(`/api/video/${operation}`, { method: "POST", body: JSON.stringify(data) });
      await refresh();
      setNotice(successMessage ?? messageOf(result) ?? "Video operation completed.");
      return result;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Video operation failed.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  function openStreamWizard(service: PlannedEvent) {
    setNextServiceCollapsed(false);
    setStreamWizardError("");
    setStreamWizard({ step: "choose", service, streamId: null, title: "", speaker: "", theme: "", startsAt: "", privacyStatus: "unlisted", playlistId: "" });
  }

  function createStreamFromService() {
    if (!streamWizard) return;
    const service = streamWizard.service;
    const dateTime = new Date(service.startsAt);
    const eventDateTime = Number.isNaN(dateTime.getTime()) ? "" : formatTimestamp(dateTime.toISOString());
    const titleParts = service.speaker.trim()
      ? [service.title, service.speaker.trim(), eventDateTime]
      : [service.title, eventDateTime];
    setStreamWizard({
      step: "settings", service, streamId: null,
      title: titleParts.filter(Boolean).join(" | ").slice(0, 100),
      speaker: service.speaker, theme: service.theme,
      startsAt: toDateTimeLocal(service.startsAt), privacyStatus: "unlisted",
      playlistId: plannedStreamsState?.playlists.find((playlist) => playlist.title === "GfC Steffisburg Livestream")?.id ?? "",
    });
    setStreamWizardError("");
  }

  function selectExistingStream(stream: PlannedStream) {
    if (!streamWizard) return;
    const linkedService = [plannedStreamsState?.nextEvent, ...(plannedStreamsState?.adjacentEvents ?? [])].find((event) => event?.id === stream.eventId) ?? streamWizard.service;
    setStreamWizard({
      step: "settings", service: linkedService, streamId: stream.id,
      title: stream.title, speaker: stream.speaker, theme: stream.theme,
      startsAt: toDateTimeLocal(stream.startsAt), privacyStatus: stream.privacyStatus,
      playlistId: stream.youtubePlaylistId ?? plannedStreamsState?.playlists.find((playlist) => playlist.title === "GfC Steffisburg Livestream")?.id ?? "",
    });
    setStreamWizardError("");
  }

  async function saveStreamWizard(event: FormEvent) {
    event.preventDefault();
    if (!streamWizard) return;
    const startsAt = new Date(streamWizard.startsAt);
    if (!streamWizard.title.trim() || Number.isNaN(startsAt.getTime())) {
      setStreamWizardError("Enter a stream title and a valid start time.");
      return;
    }
    setPlanningStream(true);
    setStreamWizardError("");
    const body = JSON.stringify({
      title: streamWizard.title.trim(), speaker: streamWizard.speaker.trim(), theme: streamWizard.theme.trim(),
      scheduledStartAt: startsAt.toISOString(), privacyStatus: streamWizard.privacyStatus,
      playlistId: streamWizard.playlistId || null,
      ...(!streamWizard.streamId ? { eventId: streamWizard.service.id } : {}),
    });
    try {
      const saved = await api<{ id?: string; youtube_status?: string; youtube_error?: string }>(streamWizard.streamId ? `/api/video/planned-streams/${encodeURIComponent(streamWizard.streamId)}` : "/api/video/planned-streams", {
        method: streamWizard.streamId ? "PUT" : "POST", body,
      });
      await refreshPlannedStreams();
      const wasExisting = Boolean(streamWizard.streamId);
      setStreamWizard(null);
      setNextServiceCollapsed(true);
      setHighlightedStreamId(saved.id ?? streamWizard.streamId ?? "");
      setNotice(saved.youtube_status === "error" ? `The stream was saved locally, but YouTube scheduling failed: ${saved.youtube_error || "try again from the planned streams list."}` : wasExisting ? "The planned stream settings were saved." : plannedStreamsState?.youtube.connected ? "The stream was created and scheduled on YouTube." : "The stream was saved locally. Connect YouTube to schedule it on the channel.");
    } catch (error) {
      setStreamWizardError(error instanceof Error ? error.message : "Could not save the planned stream.");
    } finally {
      setPlanningStream(false);
    }
  }

  async function connectYoutube() {
    // Open synchronously from the button click so browsers do not block the
    // OAuth tab after the API request completes.
    const authorizationTab = window.open("about:blank", "_blank");
    if (!authorizationTab) {
      setPlannedStreamsError("Your browser blocked the YouTube sign-in tab. Allow pop-ups for this site and try again.");
      return;
    }
    setConnectingYoutube(true);
    setPlannedStreamsError("");
    try {
      const result = await api<{ authorizationUrl: string }>("/api/modules/video-steffisburg/youtube/connect", { method: "POST", body: "{}" });
      authorizationTab.location.href = result.authorizationUrl;
    } catch (error) {
      authorizationTab.close();
      setPlannedStreamsError(error instanceof Error ? error.message : "Could not start YouTube connection.");
    } finally {
      setConnectingYoutube(false);
    }
  }

  async function syncYoutube() {
    setPlanningStream(true);
    setPlannedStreamsError("");
    try {
      const result = await api<{ total: number; created: number; updated: number }>("/api/video/planned-streams/sync-youtube", { method: "POST", body: "{}" });
      await refreshPlannedStreams();
      setNotice(result.total ? `YouTube sync complete: ${result.created} added, ${result.updated} updated.` : "YouTube sync complete. No upcoming broadcasts were found.");
    } catch (error) {
      setPlannedStreamsError(error instanceof Error ? error.message : "Could not sync planned streams from YouTube.");
    } finally {
      setPlanningStream(false);
    }
  }

  async function deletePlannedStream(stream: PlannedStream) {
    const target = stream.youtubeBroadcastId ? "the planned stream and its YouTube broadcast" : "the planned stream";
    if (!window.confirm(`Delete ${target}: ${stream.title}?`)) return;
    setPlanningStream(true);
    try {
      await api(`/api/video/planned-streams/${encodeURIComponent(stream.youtubeBroadcastId || stream.id)}`, { method: "DELETE" });
      await refreshPlannedStreams();
    } catch (error) {
      setPlannedStreamsError(error instanceof Error ? error.message : "Could not delete this planned stream.");
    } finally {
      setPlanningStream(false);
    }
  }

  async function encoderSettingsRequest<T,>(encoder: typeof xmlEncoder, operation: string, settings: Record<string, unknown> = {}) {
    if (!encoder) throw new Error("Select an encoder first.");
    return api<T>("/api/video/encoder-settings", { method: "POST", body: JSON.stringify({ encoder: encoder.id, site_id: encoder.site.id, operation, settings }) });
  }

  async function loadEncoderSettings(encoder = xmlEncoder) {
    if (!encoder) return;
    setSettingsLoading(true);
    setNotice("");
    setEncoderSettings(null);
    setPresetDetails(null);
    setSettingsForm((current) => ({ ...current, key: "", passphrase: "" }));
    try {
      const current = await encoderSettingsRequest<EncoderSettings>(encoder, "read");
      const details = await encoderSettingsRequest<EncoderPresetDetails>(encoder, "read-preset", { platform: current.platform });
      setEncoderSettings(current);
      setPresetDetails(details);
      const activeServer = current.server === "Custom" ? { server: "Custom", url: current.url } : details.servers.find((item) => item.server === current.server) ?? details.servers[0];
      setSettingsForm({ preset: current.platform, server: activeServer?.server ?? "", quality: current.quality, protocol: current.protocol || "srt", url: current.url, key: "", passphrase: "" });
    } catch (error) {
      setEncoderSettings(null);
      setPresetDetails(null);
      setNotice(error instanceof Error ? error.message : "Could not load encoder settings.");
    } finally {
      setSettingsLoading(false);
    }
  }

  async function loadEncoderPreset(platform: string) {
    if (!xmlEncoder || !platform) return;
    setSettingsLoading(true);
    setPresetDetails(null);
    try {
      const details = await encoderSettingsRequest<EncoderPresetDetails>(xmlEncoder, "read-preset", { platform });
      const selectedServer = details.servers[0];
      const isActive = encoderSettings?.platform === platform;
      setPresetDetails(details);
      setSettingsForm((current) => ({
        ...current,
        preset: platform,
        server: isActive ? encoderSettings?.server ?? selectedServer?.server ?? "" : selectedServer?.server ?? "",
        quality: isActive ? encoderSettings?.quality ?? details.default_quality ?? "" : details.default_quality ?? details.profiles[0]?.profile ?? "",
        url: isActive ? encoderSettings?.url ?? selectedServer?.url ?? "" : selectedServer?.url ?? "",
        protocol: (isActive ? encoderSettings?.protocol : undefined) || schemeOf(selectedServer?.url) || current.protocol,
      }));
      setNotice("");
    } catch (error) {
      setPresetDetails(null);
      setNotice(error instanceof Error ? error.message : "Could not load the selected preset.");
    } finally {
      setSettingsLoading(false);
    }
  }

  async function applyEncoderPreset() {
    if (!xmlEncoder || !settingsForm.preset || !settingsForm.server || !settingsForm.quality) return;
    if (!window.confirm(`Apply ${settingsForm.preset} · ${settingsForm.server} · ${settingsForm.quality} to ${xmlEncoder.name}? The stream must be stopped.`)) return;
    const result = await send("encoder-settings", { encoder: xmlEncoder.id, site_id: xmlEncoder.site.id, operation: "apply-preset", settings: { platform: settingsForm.preset, server: settingsForm.server, quality: settingsForm.quality } }, "Encoder preset applied. The stream remains stopped.");
    if (result) await loadEncoderSettings(xmlEncoder);
  }

  async function deleteEncoderPreset() {
    if (!xmlEncoder || !presetDetails?.deletion?.allowed || !presetDetails.deletion.filename) return;
    if (!window.confirm(`Delete the custom preset file ${presetDetails.deletion.filename}? This removes every preset stored in that file.`)) return;
    const result = await send("encoder-settings", { encoder: xmlEncoder.id, site_id: xmlEncoder.site.id, operation: "delete-preset", settings: { platform: settingsForm.preset, filename: presetDetails.deletion.filename, expected_services: presetDetails.deletion.services, confirmed: true } }, "Custom preset file deleted.");
    if (result) await loadEncoderSettings(xmlEncoder);
  }

  async function applyEncoderSettings() {
    if (!xmlEncoder || !encoderSettings) return;
    if (encoderSettings.status !== "Idle") return setNotice("Stop the stream before changing encoder settings.");
    if (!window.confirm(`Apply streaming settings to ${xmlEncoder.site.name} · ${xmlEncoder.name}? The stream must be stopped.`)) return;
    const values = { protocol: settingsForm.protocol, url: settingsForm.url, quality: settingsForm.quality, key: settingsForm.key, passphrase: settingsForm.passphrase };
    const result = await send("encoder-settings", { encoder: xmlEncoder.id, site_id: xmlEncoder.site.id, operation: "apply", settings: values }, "Encoder settings saved and verified. The stream remains stopped.");
    if (result) {
      setSettingsForm((current) => ({ ...current, key: "", passphrase: "" }));
      await loadEncoderSettings(xmlEncoder);
    }
  }

  async function loadHistory(deviceId: string, siteId: string) {
    setHistoryLoading(true);
    try {
      const result = await api<{ events?: RouteHistoryEvent[] }>(`/api/video/history?device=${encodeURIComponent(deviceId)}&site_id=${encodeURIComponent(siteId)}`);
      setHistory([...(result.events ?? [])].reverse());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load routing history.");
    } finally {
      setHistoryLoading(false);
    }
  }

  async function loadPresets(deviceId: string, siteId: string) {
    const result = await send("videohub-presets", { operation: "list", device: deviceId, site_id: siteId });
    if (Array.isArray(result)) setPresets(result as Preset[]);
    else if (result && typeof result === "object" && "presets" in result && Array.isArray((result as { presets: unknown }).presets)) setPresets((result as { presets: Preset[] }).presets);
  }

  async function saveRoutingPreset(name: string) {
    if (!hub) return false;
    const result = await send("videohub-presets", { operation: "save", device: hub.id, site_id: hub.site.id, name }, "Routing preset saved.");
    if (result && typeof result === "object" && "presets" in result && Array.isArray((result as { presets: unknown }).presets)) setPresets((result as { presets: Preset[] }).presets);
    return Boolean(result);
  }

  async function submitRoutingPreset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = presetName.trim();
    if (!name) return;
    if (await saveRoutingPreset(name)) {
      setPresetName("");
      setPresetNameOpen(false);
    }
  }

  async function deleteRoutingPreset(preset: Preset) {
    if (!hub) return;
    const result = await send("videohub-presets", { operation: "delete", device: hub.id, site_id: hub.site.id, id: preset.id, revision: preset.revision, confirmed: true }, "Routing preset deleted.");
    if (result && typeof result === "object" && "presets" in result && Array.isArray((result as { presets: unknown }).presets)) setPresets((result as { presets: Preset[] }).presets);
    if (result) setPendingPresetAction(null);
  }

  async function recallRoutingPreset(preset: Preset) {
    if (!hub || !matrix?.routes) return;
    const result = await send("videohub-presets", { operation: "recall", device: hub.id, site_id: hub.site.id, id: preset.id, revision: preset.revision, expected_routes: matrix.routes, confirmed: true }, "Routing preset recalled and verified.");
    if (result) {
      setPresetsOpen(false);
      setPresetNameOpen(false);
      setPresetName("");
      setPendingPresetAction(null);
    }
  }

  async function changeRoute(selectedOutput: number, selectedInput: number) {
    if (!hub || !matrix?.routes) return;
    const oldInput = matrix.routes[selectedOutput];
    if (!Number.isInteger(oldInput)) return setNotice("Refresh the routing matrix before changing a route.");
    await send("videohub-route", { device: hub.id, site_id: hub.site.id, output: selectedOutput, input: selectedInput, expected_input: oldInput }, "Route changed and verified by the Videohub.");
  }

  async function renameRouterLabel(kind: "input" | "output", index: number, currentName: string) {
    if (!hub || !capabilities.canAdminRouting) return;
    const key = `${kind}:${index}`;
    const name = (labelDrafts[key] ?? currentName).trim();
    if (!name || name === currentName) return;
    const result = await send("videohub-presets", { operation: "rename", device: hub.id, site_id: hub.site.id, kind, index, name, expected_name: currentName }, `${kind === "input" ? "Input" : "Output"} name updated.`);
    if (result) setLabelDrafts((current) => { const next = { ...current }; delete next[key]; return next; });
  }

  async function toggleRouterOutputLock(output: number, lockState: string) {
    if (!hub || !capabilities.canAdminRouting) return;
    const locked = lockState === "U";
    await send("videohub-presets", { operation: "lock", device: hub.id, site_id: hub.site.id, output, locked, expected_lock: lockState }, locked ? "Output locked." : "Output unlocked.");
  }

  async function exportXml(includeSecrets = false) {
    if (!xmlEncoder) return;
    const result = await send("encoder-settings", { encoder: xmlEncoder.id, site_id: xmlEncoder.site.id, operation: "export", settings: { include_secrets: includeSecrets } }, includeSecrets ? "XML exported with credentials." : "XML exported without credentials.");
    if (result && typeof result === "object" && "xml" in result && typeof result.xml === "string") {
      setXml(result.xml);
      setXmlPreview(null);
      setReviewedXml("");
      const file = new Blob([result.xml], { type: "application/xml;charset=utf-8" });
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${xmlEncoder.name.replace(/[^a-z0-9_-]+/gi, "-")}-streaming.xml`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  async function previewXml(source = xml) {
    if (!xmlEncoder || !source.trim()) return setNotice("Choose a streaming XML file first.");
    setXml(source);
    setBusy(true);
    try {
      const [preview, plan] = await Promise.all([
        api<{ services?: XmlService[] }>("/api/video/encoder-settings", { method: "POST", body: JSON.stringify({ encoder: xmlEncoder.id, site_id: xmlEncoder.site.id, operation: "xml-preview", settings: { xml: source } }) }),
        api<XmlPreflight>("/api/video/encoder-settings", { method: "POST", body: JSON.stringify({ encoder: xmlEncoder.id, site_id: xmlEncoder.site.id, operation: "xml-target", settings: { xml: source } }) }),
      ]);
      setXmlPreview(preview);
      setXmlPlan(plan);
      const service = preview.services?.[0];
      setXmlPlatform(service?.platform ?? "");
      setXmlServer(service?.servers[0]?.server ?? (service?.customizable_url ? "Custom" : ""));
      setXmlQuality(service?.profiles[0]?.profile ?? "");
      setXmlCustomUrl(service?.servers[0]?.url ?? "");
      setXmlServiceIndex(0);
      setXmlServerIndex(0);
      setXmlProfileIndex(0);
      setXmlModeIndex(0);
      setReviewedXml(source);
      setNotice("XML validated. Review the service, server and quality before applying.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not validate this XML.");
      setXmlPreview(null);
      setXmlPlan(null);
    } finally {
      setBusy(false);
    }
  }

  function updateVisualXml(change: (document: Document) => void) {
    const document = parseStreamingXml(xml);
    if (!document) return setNotice("The XML must be valid and use a <streaming> root before the visual editor can change it.");
    change(document);
    setXml(formatStreamingXml(document));
    setXmlPreview(null);
    setXmlPlan(null);
    setReviewedXml("");
    setNotice("Visual changes updated the XML. Validate it before applying it to an encoder.");
  }

  function newXmlFile() {
    setXml(starterXml.replace("Service 1", "New Service"));
    setXmlPreview(null);
    setXmlPlan(null);
    setReviewedXml("");
    setXmlServiceIndex(0);
    setXmlServerIndex(0);
    setXmlProfileIndex(0);
    setXmlModeIndex(0);
  }

  function editXmlText(target: "service" | "server" | "profile" | "mode" | "credentials", tag: string, value: string) {
    updateVisualXml((document) => {
      const service = xmlChildren(document.documentElement, "service")[xmlServiceIndex];
      const element = target === "service" ? service
        : target === "server" ? xmlChildren(xmlChild(service, "servers"), "server")[xmlServerIndex]
        : target === "profile" ? xmlChildren(xmlChild(service, "profiles"), "profile")[xmlProfileIndex]
        : target === "credentials" ? ensureXmlChild(document, service, "credentials")
        : xmlChildren(xmlChildren(xmlChild(service, "profiles"), "profile")[xmlProfileIndex], "config")[xmlModeIndex];
      if (element) {
        const oldName = target === "profile" && tag === "name" ? xmlChild(element, "name")?.textContent : null;
        const profiles = target === "profile" ? xmlChild(service, "profiles") : null;
        const isDefault = Boolean(oldName && profiles?.getAttribute("default") === oldName);
        setXmlChildText(document, element, tag, value);
        if (isDefault && profiles) profiles.setAttribute("default", value);
      }
    });
  }

  function editXmlAttribute(target: "service" | "profiles" | "mode", name: string, value: string) {
    updateVisualXml((document) => {
      const service = xmlChildren(document.documentElement, "service")[xmlServiceIndex];
      const element = target === "service" ? service
        : target === "profiles" ? xmlChild(service, "profiles")
        : xmlChildren(xmlChildren(xmlChild(service, "profiles"), "profile")[xmlProfileIndex], "config")[xmlModeIndex];
      if (element) value ? element.setAttribute(name, value) : element.removeAttribute(name);
    });
  }

  function removeXmlNode(target: "service" | "server" | "profile" | "mode") {
    updateVisualXml((document) => {
      const service = xmlChildren(document.documentElement, "service")[xmlServiceIndex];
      const element = target === "service" ? service
        : target === "server" ? xmlChildren(xmlChild(service, "servers"), "server")[xmlServerIndex]
        : target === "profile" ? xmlChildren(xmlChild(service, "profiles"), "profile")[xmlProfileIndex]
        : xmlChildren(xmlChildren(xmlChild(service, "profiles"), "profile")[xmlProfileIndex], "config")[xmlModeIndex];
      if (!element || !element.parentElement) return;
      if ((target === "service" && xmlChildren(document.documentElement, "service").length < 2)
        || (target === "server" && xmlChildren(element.parentElement, "server").length < 2)
        || (target === "profile" && xmlChildren(element.parentElement, "profile").length < 2)
        || (target === "mode" && xmlChildren(element.parentElement, "config").length < 2)) return;
      const removedName = target === "profile" ? xmlChild(element, "name")?.textContent : null;
      const profiles = target === "profile" ? element.parentElement : null;
      const defaultProfile = profiles?.getAttribute("default");
      element.parentElement.removeChild(element);
      if (target === "profile" && removedName && defaultProfile === removedName && profiles) {
        const remaining = xmlChildren(profiles, "profile");
        profiles.setAttribute("default", xmlChild(remaining[0], "name")?.textContent ?? "");
      }
    });
    if (target === "service") setXmlServiceIndex(0);
    if (target === "server") setXmlServerIndex(0);
    if (target === "profile") setXmlProfileIndex(0);
    if (target === "mode") setXmlModeIndex(0);
  }

  function addXmlServer() {
    if (!visualService) return;
    updateVisualXml((document) => {
      const service = xmlChildren(document.documentElement, "service")[xmlServiceIndex];
      const servers = ensureXmlChild(document, service, "servers");
      const server = document.createElement("server");
      appendXmlText(document, server, "name", `Server ${xmlChildren(servers, "server").length + 1}`);
      appendXmlText(document, server, "url", "rtmp://example.com/live");
      servers.append(server);
    });
    setXmlServerIndex(visualServers.length);
  }

  function addXmlProfile() {
    if (!visualService) return;
    updateVisualXml((document) => {
      const service = xmlChildren(document.documentElement, "service")[xmlServiceIndex];
      const profiles = ensureXmlChild(document, service, "profiles");
      const profile = document.createElement("profile");
      const name = `Profile ${xmlChildren(profiles, "profile").length + 1}`;
      appendXmlText(document, profile, "name", name);
      const config = document.createElement("config");
      config.setAttribute("resolution", "1080p");
      config.setAttribute("fps", "30");
      config.setAttribute("codec", "H264");
      appendXmlText(document, config, "bitrate", "6000000");
      appendXmlText(document, config, "audio-bitrate", "128000");
      profile.append(config);
      profiles.append(profile);
      if (!profiles.getAttribute("default")) profiles.setAttribute("default", name);
    });
    setXmlProfileIndex(visualProfiles.length);
    setXmlModeIndex(0);
  }

  function addXmlMode() {
    if (!visualProfile) return;
    updateVisualXml((document) => {
      const service = xmlChildren(document.documentElement, "service")[xmlServiceIndex];
      const profile = xmlChildren(xmlChild(service, "profiles"), "profile")[xmlProfileIndex];
      const config = document.createElement("config");
      config.setAttribute("resolution", "1080p");
      config.setAttribute("fps", "30");
      config.setAttribute("codec", "H264");
      appendXmlText(document, config, "bitrate", "6000000");
      appendXmlText(document, config, "audio-bitrate", "128000");
      profile.append(config);
    });
    setXmlModeIndex(visualModes.length);
  }

  function addXmlService() {
    updateVisualXml((document) => {
      const service = document.createElement("service");
      service.setAttribute("customizable-url", "false");
      appendXmlText(document, service, "name", `Service ${xmlChildren(document.documentElement, "service").length + 1}`);
      const servers = document.createElement("servers");
      const server = document.createElement("server");
      appendXmlText(document, server, "name", "Primary");
      appendXmlText(document, server, "url", "rtmp://example.com/live");
      servers.append(server);
      service.append(servers);
      const profiles = document.createElement("profiles");
      profiles.setAttribute("default", "Streaming High");
      const profile = document.createElement("profile");
      appendXmlText(document, profile, "name", "Streaming High");
      const config = document.createElement("config");
      config.setAttribute("resolution", "1080p");
      config.setAttribute("fps", "30");
      config.setAttribute("codec", "H264");
      appendXmlText(document, config, "bitrate", "6000000");
      appendXmlText(document, config, "audio-bitrate", "128000");
      profile.append(config);
      profiles.append(profile);
      service.append(profiles);
      document.documentElement.append(service);
    });
    setXmlServiceIndex(visualServices.length);
    setXmlServerIndex(0);
    setXmlProfileIndex(0);
    setXmlModeIndex(0);
  }

  async function applyXml() {
    if (!xmlEncoder || !xmlPreview || reviewedXml !== xml) return setNotice("Review the current XML before sending it to an encoder.");
    if (!window.confirm(`Upload these streaming settings to ${xmlEncoder.site.name} · ${xmlEncoder.name}? This changes encoder configuration.`)) return;
    if (!xmlPlatform || !xmlQuality || !xmlServer || !xmlPlan?.filename) return setNotice("Select a service, streaming server and quality profile first.");
    if (!window.confirm(`Upload ${xmlPlan.filename}${xmlPlan.replaces_existing ? " (replacing an existing file)" : ""} to ${xmlEncoder.site.name} · ${xmlEncoder.name}, then activate ${xmlPlatform} · ${xmlServer} · ${xmlQuality}? The stream must remain stopped.`)) return;
    const result = await send("encoder-settings", { encoder: xmlEncoder.id, site_id: xmlEncoder.site.id, operation: "apply-xml", settings: { xml, filename: xmlPlan.filename, platform: xmlPlatform, server: xmlServer, quality: xmlQuality, ...(xmlCustomUrl ? { url: xmlCustomUrl } : {}) } }, "Streaming XML uploaded and selected. Check encoder status before starting a stream.");
    if (!result) return;
    setXmlPreview(null);
    setXmlPlan(null);
    setReviewedXml("");
  }

  const workerState = snapshot?.worker?.state ?? (loading ? "starting" : "unavailable");
  const primarySite = sites.find((site) => site.id === "gfc-steffisburg") ?? sites[0];
  const remoteSites = sites.filter((site) => site.id !== primarySite?.id);
  const steffisburgSite = sites.find((site) => site.id === "gfc-steffisburg");
  const activeRemoteEncoders = sites.filter((site) => ["main", "sonnenhof"].includes(site.id)).flatMap((site) => site.encoders.filter((encoder) => streamState(encoder).label === "LIVE").map((encoder) => ({ ...encoder, site })));
  const remoteShellys = ["main", "sonnenhof"].flatMap((siteId) => {
    const site = sites.find((candidate) => candidate.id === siteId);
    const shelly = site?.devices.find((device) => device.id === "shelly");
    return site && shelly ? [{ site, device: shelly }] : [];
  });

  function renderSite(site: VideoSite, origin: boolean) {
    const gatewayStatus = site.router_status ?? "Status pending";
    const supportsBmdControls = ["main", "sonnenhof"].includes(site.id);
    const converterModels = [
      { id: "mini-converter-sdi-to-audio", name: "BMD SDI to Audio", pattern: /sdi\s*(?:to|→)\s*audio/i },
      { id: "mini-converter-audio-to-sdi", name: "BMD Audio to SDI", pattern: /audio\s*(?:to|→)\s*sdi/i },
    ];
    const configuredConverterIds = new Set(site.devices.flatMap((device) => {
      const model = converterModels.find((candidate) => candidate.id === device.id || (device.type === "converter" && candidate.pattern.test(device.name)));
      return model ? [model.id] : [];
    }));
    const devices: (Device & { converterControlsId?: string })[] = [
      ...site.devices.map((device) => ({
        ...device,
        converterControlsId: supportsBmdControls
          ? converterModels.find((candidate) => candidate.id === device.id || (device.type === "converter" && candidate.pattern.test(device.name)))?.id
          : undefined,
      })),
      ...(supportsBmdControls ? converterModels.filter((model) => !configuredConverterIds.has(model.id)).map((model) => ({ id: model.id, name: model.name, type: "converter", converterControlsId: model.id })) : []),
    ];
    const audioToSdiIndex = devices.findIndex((device) => device.converterControlsId === "mini-converter-audio-to-sdi");
    const sdiToAudioIndex = devices.findIndex((device) => device.converterControlsId === "mini-converter-sdi-to-audio");
    if (audioToSdiIndex >= 0 && sdiToAudioIndex >= 0 && audioToSdiIndex > sdiToAudioIndex) {
      [devices[audioToSdiIndex], devices[sdiToAudioIndex]] = [devices[sdiToAudioIndex], devices[audioToSdiIndex]];
    }
    return <section className={`video-site-card${origin ? " video-site-origin" : ""}`} key={site.id}>
      <header className="video-site-heading"><div><h2>{site.name}</h2><p>{origin ? "Streaming source" : "Remote location"} · {site.encoders.length + devices.length} connected assets</p></div><span className={`video-state ${gatewayStatus === "Reachable" ? "video-state-good" : ""}`}>{gatewayStatus}</span></header>
      <article className="video-gateway"><div className="video-equipment-icon"><Activity size={20} /></div><div className="video-equipment-copy"><strong>{site.router_model || "Network gateway"}</strong><small><IpAddress value={site.router_ip} fallback="Gateway address not configured" /></small></div><span className={`video-state ${gatewayStatus === "Reachable" ? "video-state-good" : ""}`}>{gatewayStatus === "Reachable" ? "Reachable" : gatewayStatus}</span></article>
      {site.encoders.map((encoder) => {
        const settings = encoder.streaming_settings ?? {};
        const control = encoder.control ?? "Unknown";
        const encoderState = streamState(encoder);
        return <article className="video-encoder-card" key={`${site.id}|${encoder.id}`}>
          <EncoderHardware encoder={encoder} status={encoderState.label} />
          <div className="video-encoder-details">
            <div className="video-encoder-info"><strong>{encoder.name}</strong><IpAddress value={encoder.ip} /><span className={`video-state ${control === "Connected" ? "video-state-good" : ""}`}>{control === "Connected" ? "Reachable" : control}</span><span className={`video-state ${encoderState.ready ? "video-state-ready" : ""}`}>{encoderState.label}</span><small>Target: {stringValue(settings.server_name) || stringValue(settings.platform) || "Not reported"}</small><small>{stateMetric(encoder.state, "Duration")} · {stateBitrate(encoder.state)} · Buffer {stateMetric(encoder.state, "Cache Used")}</small><small>Control: {control}</small></div>
            <div className="video-encoder-info"><strong>Streaming profile</strong><small>Profile: {stringValue(settings.platform) || "Not reported"}</small><small>Server name: {stringValue(settings.server_name) || "Not reported"}</small><code>Server address: {stringValue(settings.server) || "Not reported"}</code><small>Key: {stringValue(settings.key_masked) || "Not reported"}</small><small>Quality: {stringValue(settings.quality) || "Not reported"}</small></div>
          </div>
          {!origin && <div className="video-remote-restriction"><Shield size={14} /> Only for streams between the nursing homes</div>}
          {(capabilities.canOperateStreaming || capabilities.canManageEncoders) && <div className="video-site-actions">{capabilities.canOperateStreaming && <><button type="button" className="video-small-button video-button-primary" disabled={busy || control !== "Connected"} onClick={() => void send("command", { site_id: site.id, encoder: encoder.id, action: "Start" }, `${encoder.name}: start accepted; waiting for device status.`)}><Play size={13} /> Start</button><button type="button" className="video-small-button" disabled={busy || control !== "Connected"} onClick={() => void send("command", { site_id: site.id, encoder: encoder.id, action: "Stop" }, `${encoder.name}: stop accepted; waiting for device status.`)}><Square size={12} /> Stop</button></>}{capabilities.canManageEncoders && <button type="button" className="video-small-button" disabled={busy} onClick={() => { const key = `${site.id}|${encoder.id}`; const target = { ...encoder, site, key }; setSelectedEncoder(key); setSettingsOpen(true); void loadEncoderSettings(target); }}><Settings2 size={13} /> Settings</button>}</div>}
          {encoder.error && <small className="video-error-text">{encoder.error}</small>}
        </article>;
      })}
      {devices.map((device) => <article className="video-device-card" key={`${site.id}|${device.id}`}>
        <div className="video-equipment-icon"><Settings2 size={19} /></div>
        <div className="video-equipment-copy">
          <strong>{device.name}</strong>
          <small>{device.type === "converter" ? "USB over Silex" : <>{device.type || "Equipment"} · <IpAddress value={device.ip} /></>}</small>
          {device.power && <small>Power: {String(device.power)}</small>}
          {device.type === "streamingbridge" && <>
            <small>Video: {device.stream_state?.["Video Mode"] ?? "—"} · {device.stream_state?.["Video Bitrate"] ?? "—"} · Audio: {device.stream_state?.["Audio Bitrate"] ?? "—"}</small>
          </>}
        </div>
        {device.type === "streamingbridge" ? <>
          <span className={`video-state video-state-bridge ${device.ping === "Reachable" ? "video-state-good" : ""}`}>Network: {device.ping ?? "Status pending"}</span>
          <span className={`video-state video-state-bridge ${bridgeStreamStatus(device) === "Live" ? "video-state-live" : ""}`}>Stream Status: {bridgeStreamStatus(device)}</span>
        </> : <span className={`video-state ${device.ping === "Reachable" ? "video-state-good" : ""}`}>{device.type === "converter" ? "Silex USB" : device.ping ?? "Status pending"}</span>}
        {device.converterControlsId && <BmdVolumeMenu departmentId={departmentId} siteId={site.id} converterId={device.converterControlsId} csrfToken={csrfToken} canControl={capabilities.canManageEncoders} />}
        <div className="video-device-actions">
          {capabilities.canOperateStreaming && (device.id === "shelly" || device.type === "shelly") && <button type="button" className="video-small-button" disabled={busy || device.ping !== "Reachable"} onClick={() => { if (window.confirm(`Power-cycle equipment at ${site.name}? Streaming may be interrupted.`)) void send("restart-site", { site_id: site.id, confirmed: true }, `Power cycle requested for ${site.name}.`); }}><RefreshCw size={13} /> Cycle site power</button>}
        </div>
        {device.error && <small className="video-error-text">{device.error}</small>}
      </article>)}
    </section>;
  }

  return <section className="video-module">
    {presetsOpen && createPortal(<div className="video-popup-backdrop" aria-hidden="true" />, document.body)}
    <div className="video-heading">
      <div><h1>Video &amp; streaming</h1><p>Monitor encoders, inspect routing, and manage streaming equipment for this location.</p></div>
      <div className={`video-worker video-worker-${ready ? "ready" : "off"}`}><span />{workerLabel(workerState)}<small className="video-worker-refresh">Last refresh: {snapshot?.status ? new Date().toLocaleTimeString() : "—"}</small><button type="button" title="Refresh video status" onClick={() => { setLoading(true); void refresh(); }}><RefreshCw size={15} /></button></div>
    </div>

    {snapshot?.message && <div className="video-not-configured"><Shield size={20} /><div><strong>Video equipment is not configured</strong><p>{snapshot.message} The private configuration stays on the API server and is never sent to the browser. Add this location ID to the matching site in the private config: <code>{departmentId}</code></p></div></div>}
    {snapshot?.error && <div className="video-not-configured video-not-configured-error"><AlertTriangle size={20} /><div><strong>Video service unavailable</strong><p>{snapshot.error}</p></div></div>}
    {notice && <div className="video-notice" role="status">{notice}<button type="button" onClick={() => setNotice("")}>Dismiss</button></div>}

    {!ready && !snapshot?.message && <div className="video-empty"><Video size={28} /><strong>{loading ? "Connecting to the video worker…" : "Video worker is unavailable"}</strong><p>{snapshot?.worker?.error ?? "The Core API starts this module in its own worker process."}</p></div>}

    {ready && tab === "Overview" && <>
      {activeRemoteEncoders.length > 0 && <div className="video-remote-live-warning" role="alert"><AlertTriangle size={19} /><div><strong>Remote encoder active</strong><p>{activeRemoteEncoders.map((encoder) => `${encoder.site.name} · ${encoder.name}`).join(" · ")} is currently streaming. Check the remote stream before starting an encoder in Steffisburg.</p></div></div>}
      <section className="video-panel video-overview-encoders"><div className="video-panel-heading"><div><h2>Steffisburg encoders</h2><p>Live status and quick start/stop controls.</p></div><button className="video-small-button" type="button" onClick={() => onTabChange("Streaming")}><Radio size={14} /> Full streaming view</button></div>
        {steffisburgSite?.encoders.length ? <div className="video-overview-encoder-grid">{steffisburgSite.encoders.map((encoder) => {
          const status = streamState(encoder);
          const connected = encoder.control === "Connected";
          return <article className="video-overview-encoder" key={encoder.id}><EncoderHardware encoder={encoder} status={status.label} /><div className="video-overview-encoder-top"><div><h3>{encoder.name}</h3><IpAddress value={encoder.ip} /></div><span className={`video-state ${status.label === "LIVE" ? "video-state-live" : status.ready ? "video-state-ready" : ""}`}>{status.label}</span></div><p>{connected ? "Control connection available" : encoder.control ?? "Status pending"}</p><div className="video-overview-actions"><button type="button" className="video-small-button video-button-primary" disabled={!capabilities.canOperateStreaming || busy || !connected || status.label === "LIVE"} onClick={() => void send("command", { site_id: steffisburgSite.id, encoder: encoder.id, action: "Start" }, `${encoder.name}: start requested.`)}><Play size={13} /> Start</button><button type="button" className="video-small-button" disabled={!capabilities.canOperateStreaming || busy || !connected || status.label !== "LIVE"} onClick={() => void send("command", { site_id: steffisburgSite.id, encoder: encoder.id, action: "Stop" }, `${encoder.name}: stop requested.`)}><Square size={12} /> Stop</button></div>{encoder.error && <small className="video-error-text">{encoder.error}</small>}</article>;
        })}</div> : <Empty text="The three Steffisburg encoders are not available in the current equipment configuration." />}
      </section>
      <section className="video-panel video-overview-shelly video-next-service-panel">
        <div className="video-panel-heading"><button type="button" className="video-collapse-toggle" aria-expanded={!remoteSitePowerCollapsed} aria-controls="video-remote-site-power-content" onClick={() => setRemoteSitePowerCollapsed((collapsed) => !collapsed)}><span><h2>Remote site power</h2><p>Shelly Pro 1 relay status and site power-cycle controls.</p></span><ChevronDown className={remoteSitePowerCollapsed ? "video-collapse-icon video-collapse-icon-closed" : "video-collapse-icon"} size={16} /></button></div>
        {!remoteSitePowerCollapsed && <div id="video-remote-site-power-content">{remoteShellys.length ? <div className="video-overview-shelly-grid">{remoteShellys.map(({ site, device }) => <article className="video-overview-shelly-card" key={site.id}><ShellyProHardware power={device.power} reachable={device.ping === "Reachable"} /><div className="video-overview-shelly-copy"><h3>{site.name}</h3><IpAddress value={device.ip} /><p>Shelly Pro 1 · Power {device.power ?? "unknown"}{device.power_error ? ` · ${device.power_error}` : ""}</p><button type="button" className="video-small-button video-button-danger" disabled={!capabilities.canOperateStreaming || busy || device.ping !== "Reachable"} onClick={() => { if (window.confirm(`Power-cycle the ${site.name} site? This can interrupt streaming equipment.`)) void send("restart-site", { site_id: site.id, confirmed: true }, `Power-cycle requested for ${site.name}.`); }}><RefreshCw size={13} /> Power-cycle site</button></div></article>)}</div> : <Empty text="Seewinkel and Sonnenhof Shelly relays are not available in the current equipment configuration." />}</div>}
      </section>
      <section className="video-panel video-next-service-panel"><div className="video-panel-heading"><button type="button" className="video-collapse-toggle" aria-expanded={!nextServiceCollapsed} aria-controls="video-next-service-content" onClick={() => setNextServiceCollapsed((collapsed) => !collapsed)}><span><h2>Next Service</h2><p>Event details currently loaded from local service data.</p></span><ChevronDown className={nextServiceCollapsed ? "video-collapse-icon video-collapse-icon-closed" : "video-collapse-icon"} size={16} /></button><span className="video-youtube-connection">Local Data</span></div>
        {!nextServiceCollapsed && <div id="video-next-service-content">{plannedStreamsState?.nextEvent ? <div className="video-next-service-list">{[
          ...plannedStreamsState.adjacentEvents.filter((event) => event.relation === "previous"),
          { ...plannedStreamsState.nextEvent, relation: plannedStreamsState.nextEvent.isCurrent ? "current" as const : "anchor" as const },
          ...plannedStreamsState.adjacentEvents.filter((event) => event.relation === "following"),
        ].map((event) => {
          const relationLabel = event.relation === "previous" ? "PREVIOUS SERVICE" : event.relation === "following" ? (plannedStreamsState.nextEvent?.isCurrent ? "NEXT SERVICE" : "FOLLOWING SERVICE") : event.relation === "current" ? "CURRENT SERVICE" : "NEXT SERVICE";
          return <article className="video-next-service" key={event.id}><div className="video-next-service-top"><span className="video-eyebrow">{relationLabel}</span><span className="video-source-label">{eventSourceLabel(event.source)}</span></div><h3>{event.title}</h3><p>{formatTimestamp(event.startsAt)}{event.endTime ? ` · ends ${event.endTime}` : ""}</p><dl><div><dt>Service name</dt><dd>{event.title}</dd></div><div><dt>Preacher</dt><dd>{event.speaker || "Not assigned"}</dd></div><div><dt>Service title / theme</dt><dd>{event.theme || "Not listed"}</dd></div><div><dt>Data source</dt><dd>{eventSourceLabel(event.source)}</dd></div></dl><button type="button" className="video-small-button video-button-primary video-create-stream-button" disabled={!capabilities.canManageEncoders || planningStream} onClick={() => openStreamWizard(event)}><Plus size={13} /> Create Stream</button></article>;
        })}</div> : <div className="video-next-service video-next-service-empty">{plannedStreamsLoading ? "Looking for the current or next service…" : "No current or upcoming service is scheduled."}</div>}</div>}
      </section>
      <section className="video-panel video-planned-streams"><div className="video-panel-heading"><div><h2>YouTube streaming</h2><p>Plan broadcasts and view upcoming streams directly from YouTube Studio.</p></div><span className={`video-youtube-connection ${plannedStreamsState?.youtube.connected ? "video-youtube-connected" : ""}`}>{plannedStreamsState?.youtube.connected ? `Connected · ${plannedStreamsState.youtube.channelTitle}` : "YouTube not connected"}</span></div>
        {plannedStreamsError && <p className="video-youtube-error" role="alert">{plannedStreamsError}</p>}
        <div className="video-planned-create-row"><div className="video-planned-create-controls">{plannedStreamsState?.nextEvent && <button type="button" className="video-small-button video-button-primary" disabled={!capabilities.canManageEncoders || planningStream} onClick={() => openStreamWizard(plannedStreamsState.nextEvent!)}><Plus size={14} /> Create Stream</button>}{plannedStreamsState?.youtube.connected ? <><button type="button" className="video-small-button" disabled={!capabilities.canManageEncoders || planningStream} onClick={() => void syncYoutube()}><RefreshCw size={13} /> {planningStream ? "Syncing…" : "Sync YouTube"}</button><button type="button" className="video-small-button" onClick={() => window.open("https://studio.youtube.com/", "_blank", "noopener,noreferrer")}>Open YouTube Studio</button></> : plannedStreamsState?.youtube.configured ? <button type="button" className="video-small-button" disabled={!capabilities.canManageEncoders || connectingYoutube} onClick={() => void connectYoutube()}>{connectingYoutube ? "Connecting…" : "Connect YouTube"}</button> : <small>Live scheduling needs YouTube OAuth credentials in this module’s environment.</small>}</div>
        </div>
        <div className="video-planned-list-heading"><h3>Planned YouTube streams</h3>{plannedStreamsLoading && <small>Refreshing…</small>}</div>
        {plannedStreamsState?.streams.length ? <div className="video-planned-list">{plannedStreamsState.streams.map((stream) => <article className={`video-planned-row${stream.id === highlightedStreamId ? " video-planned-row-highlighted" : ""}`} key={stream.id}><div className="video-planned-main"><div><h4>{stream.title}</h4><p>{formatTimestamp(stream.startsAt)} · {stream.privacyStatus}</p></div><span className="video-state video-state-good">Planned in YouTube Studio</span>{stream.youtubeError && <small className="video-youtube-error">{stream.youtubeError}</small>}</div><div className="video-planned-actions"><a className="video-small-button" href={stream.studioUrl} target="_blank" rel="noreferrer">Control in Studio</a>{capabilities.canManageEncoders && <button type="button" className="video-small-button video-button-danger" disabled={planningStream} onClick={() => void deletePlannedStream(stream)}><Trash2 size={13} /> Delete</button>}</div></article>)}</div> : !plannedStreamsLoading && <Empty text={plannedStreamsState?.youtube.connected ? "No planned streams in YouTube Studio." : "Connect YouTube to view planned streams from Studio."} />}
        {!capabilities.canManageEncoders && <p className="video-settings-help">Stream planning requires stream administrator access.</p>}
      </section>
      <section className="video-panel video-youtube-studio" aria-labelledby="video-youtube-studio-title">
        <div className="video-panel-heading"><div><h2 id="video-youtube-studio-title">YouTube Studio</h2><p>Monitor active broadcasts or select a planned stream to preview and control it.</p></div><a className="video-small-button" href={youtubeStudioSelection?.studioUrl ?? "https://studio.youtube.com/"} target="_blank" rel="noreferrer">Open in Studio</a></div>
        {youtubeStudioError && <p className="video-youtube-error" role="alert">{youtubeStudioError}</p>}
        {!plannedStreamsState?.youtube.connected ? <Empty text="Connect YouTube to preview and control broadcasts." /> : youtubeStudioBroadcasts.length === 0 && youtubeStudioActiveBroadcasts.length === 0 && !youtubeStudioLoading && !youtubeStudioSelection ? <Empty text="No planned or active YouTube streams are available." /> : <>
          <div className="video-youtube-studio-toolbar">
            <label htmlFor="video-youtube-broadcast">Broadcast</label>
            <select id="video-youtube-broadcast" value={youtubeStudioBroadcasts.some((broadcast) => broadcast.id === youtubeStudioBroadcastId) ? youtubeStudioBroadcastId : ""} onChange={(event) => { setYoutubeStudioBroadcastId(event.target.value); setYoutubeStudioSelection(null); setYoutubeStudioNotice(""); }} disabled={youtubeStudioLoading || youtubeStudioBroadcasts.length === 0}>
              {!youtubeStudioBroadcasts.some((broadcast) => broadcast.id === youtubeStudioBroadcastId) && <option value="">{youtubeStudioActiveBroadcasts.some((broadcast) => broadcast.id === youtubeStudioBroadcastId) ? `Monitoring active stream: ${youtubeStudioSelection?.title ?? youtubeStudioActiveBroadcasts.find((broadcast) => broadcast.id === youtubeStudioBroadcastId)?.title ?? "Live stream"}` : "Select a planned stream"}</option>}
              {youtubeStudioBroadcasts.map((broadcast) => <option key={broadcast.id} value={broadcast.id}>{broadcast.title} · {broadcast.status}{broadcast.startsAt ? ` · ${formatTimestamp(broadcast.startsAt)}` : ""}</option>)}
            </select>
            <span className={`video-state${youtubeStudioSelection?.status === "live" ? " video-state-live" : ""}`}>{youtubeBroadcastStatusLabel(youtubeStudioSelection?.status ?? (youtubeStudioLoading ? "Loading…" : undefined))}</span>
          </div>
          <div className="video-youtube-metrics" aria-label="YouTube streaming status">
            <article className={`video-youtube-metric video-youtube-quality-${youtubeStudioSelection?.streamQuality.status ?? "unknown"}`}><span>Stream quality</span><strong>{youtubeQualityLabel(youtubeStudioSelection?.streamQuality.status)}</strong><small>{youtubeStudioSelection?.streamQuality.issues.length ? youtubeStudioSelection.streamQuality.issues[0].reason : youtubeStudioSelection?.streamQuality.status === "good" ? "No quality issues reported" : "YouTube quality data"}</small></article>
            <article className="video-youtube-metric"><span>Current viewers</span><strong>{youtubeStudioSelection?.concurrentViewers == null ? "—" : new Intl.NumberFormat().format(youtubeStudioSelection.concurrentViewers)}</strong><small>{youtubeStudioSelection?.status === "live" ? "Live audience" : "Reported while the broadcast is live"}</small></article>
            <article className="video-youtube-metric"><span>Likes</span><strong>{youtubeStudioSelection?.likeCount == null ? "—" : new Intl.NumberFormat().format(youtubeStudioSelection.likeCount)}</strong><small>YouTube video likes</small></article>
          </div>
          {youtubeStudioSelection?.streamQuality.issues.length ? <ul className="video-youtube-quality-issues">{youtubeStudioSelection.streamQuality.issues.slice(0, 3).map((issue, index) => <li className={`video-youtube-quality-issue video-youtube-quality-issue-${issue.severity}`} key={`${issue.type}-${index}`} title={issue.description || issue.reason}>{issue.reason}{issue.description ? ` · ${issue.description}` : ""}</li>)}</ul> : null}
          <div className="video-youtube-studio-layout">
            <div className="video-youtube-preview" aria-label="YouTube stream preview">
              {youtubeStudioSelection?.previewUrl && youtubeStudioSelection.streamStatus === "active" && ["testing", "testStarting", "live", "liveStarting"].includes(youtubeStudioSelection.status) ? <iframe src={youtubeStudioSelection.previewUrl} title={`YouTube preview: ${youtubeStudioSelection.title}`} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" /> : <div className="video-youtube-preview-placeholder"><Video size={30} /><strong>{youtubeStudioLoading ? "Loading stream preview…" : "Preview unavailable"}</strong><p>{youtubeStudioSelection?.streamStatus !== "active" ? "Start the encoder and wait for YouTube to receive its signal." : youtubeStudioSelection?.status === "ready" ? "The encoder signal is active. Start the private preview before going live." : "YouTube's monitor preview is not available for this broadcast yet."}</p>{youtubeStudioSelection && <a className="video-small-button video-button-primary" href={youtubeStudioSelection.studioUrl} target="_blank" rel="noreferrer"><Video size={13} /> Preview in YouTube Studio</a>}</div>}
            </div>
            <div className="video-youtube-studio-controls">
              <div><strong>{youtubeStudioSelection?.title ?? "Select a YouTube broadcast"}</strong><span>{youtubeStudioSelection?.startsAt ? formatTimestamp(youtubeStudioSelection.startsAt) : ""}</span><span>{youtubeStudioSelection ? `Encoder signal: ${youtubeStudioSelection.streamStatus}` : ""}</span><small>Starting or ending the YouTube broadcast does not start or stop the encoder.</small></div>
              <div className="video-overview-actions">
                {youtubeStudioSelection?.status === "ready" && <button type="button" className="video-small-button" disabled={!capabilities.canOperateStreaming || youtubeStudioActionBusy || youtubeStudioSelection.streamStatus !== "active"} onClick={() => void transitionYoutubeStream("testing")}><Video size={13} /> {youtubeStudioActionBusy ? "Working…" : "Start preview"}</button>}
                <button type="button" className="video-small-button video-button-primary" disabled={!capabilities.canOperateStreaming || youtubeStudioActionBusy || !youtubeStudioSelection || !["testing"].includes(youtubeStudioSelection.status) || youtubeStudioSelection.streamStatus !== "active"} onClick={() => void transitionYoutubeStream("live")}><Play size={13} /> {youtubeStudioActionBusy ? "Working…" : "Go live"}</button>
                <button type="button" className="video-small-button video-button-danger" disabled={!capabilities.canOperateStreaming || youtubeStudioActionBusy || !youtubeStudioSelection || !["live", "liveStarting", "testing", "testStarting"].includes(youtubeStudioSelection.status)} onClick={() => void transitionYoutubeStream("complete")}><Square size={12} /> End stream</button>
              </div>
              {!capabilities.canOperateStreaming && <small className="video-settings-help">You need streaming operator access to control a broadcast.</small>}
            </div>
          </div>
        </>}
        {youtubeStudioNotice && <p className="video-youtube-notice" role="status">{youtubeStudioNotice}</p>}
      </section>
      <section className="video-panel video-youtube-past-streams" aria-labelledby="video-youtube-past-title">
        <div className="video-panel-heading"><div><h2 id="video-youtube-past-title">Last 6 past livestreams</h2><p>Recently completed broadcasts from the connected YouTube channel.</p></div><button type="button" className="video-small-button" disabled={!plannedStreamsState?.youtube.connected || youtubePastStreamsLoading} onClick={() => void refreshYoutubePastStreams()}><RefreshCw size={13} className={youtubePastStreamsLoading ? "video-refresh-spinning" : ""} /> Refresh</button></div>
        {youtubePastStreamsError && <p className="video-youtube-error" role="alert">{youtubePastStreamsError}</p>}
        {youtubePastStreams.length ? <div className="video-youtube-past-list">{youtubePastStreams.map((stream) => <article className="video-youtube-past-row" key={stream.id}>{stream.thumbnailUrl ? <a className="video-youtube-past-thumbnail" href={stream.watchUrl} target="_blank" rel="noreferrer" aria-label={`Watch ${stream.title}`}><img src={stream.thumbnailUrl} alt="" loading="lazy" /></a> : <div className="video-youtube-past-thumbnail video-youtube-past-thumbnail-empty"><Video size={24} /></div>}<div className="video-youtube-past-content"><div className="video-youtube-past-main"><h3>{stream.title}</h3><p>{stream.endedAt ? `Ended ${formatTimestamp(stream.endedAt)}` : stream.startsAt ? formatTimestamp(stream.startsAt) : "Completed livestream"} · {stream.privacyStatus}</p><div className="video-youtube-past-stats"><span>{stream.viewCount == null ? "Views unavailable" : `${new Intl.NumberFormat().format(stream.viewCount)} views`}</span><span>{stream.likeCount == null ? "Likes unavailable" : `${new Intl.NumberFormat().format(stream.likeCount)} likes`}</span></div></div><div className="video-planned-actions"><a className="video-small-button" href={stream.watchUrl} target="_blank" rel="noreferrer">Watch</a><a className="video-small-button" href={stream.studioUrl} target="_blank" rel="noreferrer">Open in Studio</a></div></div></article>)}</div> : !youtubePastStreamsLoading && <Empty text={plannedStreamsState?.youtube.connected ? "No completed livestreams were found on this channel." : "Connect YouTube to view past livestreams."} />}
      </section>
    </>}

    {ready && tab === "Streaming" && <>
      <div className="video-overview-banner"><div><span className="video-eyebrow">LIVE EQUIPMENT MAP</span><h2>Streaming locations</h2><p>Encoder and network status across the sites assigned to this location.</p></div><div className="video-overview-count"><strong>{encoders.filter((encoder) => encoder.control === "Connected").length}</strong><span>of {encoders.length} encoders connected</span></div></div>
      {sites.length ? <div className="video-network-board"><div className="video-board-origin">{primarySite && renderSite(primarySite, true)}</div><div className="video-board-internet"><span className="video-network-line" /><div className="video-internet-node"><Cloud size={40} strokeWidth={1.5} /><strong>Internet</strong><small>Network connection</small><span>Availability not monitored</span></div><span className="video-network-line" /></div><div className="video-board-remote">{remoteSites.map((site) => renderSite(site, false))}</div></div> : <Empty text="No equipment is configured for this location." />}
      <section className="video-panel"><div className="video-panel-heading"><div><h2>Streaming status</h2><p>Live encoder telemetry for assigned locations</p></div></div>{encoders.length ? <div className="video-stream-grid">{encoders.map((encoder) => { const settings = encoder.streaming_settings ?? {}; return <article className="video-stream-card" key={encoder.key}><div className="video-device-icon"><Radio size={18} /></div><h3>{encoder.name}</h3><p>{encoder.site.name} · {encoder.model ?? "Blackmagic Web Presenter"}</p><dl><div><dt>Stream</dt><dd>{readState(encoder.state)}</dd></div><div><dt>Control</dt><dd>{encoder.control ?? "Unknown"}</dd></div><div><dt>Platform</dt><dd>{stringValue(settings.platform) || "—"}</dd></div><div><dt>Quality</dt><dd>{stringValue(settings.quality) || "—"}</dd></div><div><dt>Last checked</dt><dd>{formatTimestamp(settings.checked_at)}</dd></div></dl>{typeof settings.error === "string" && <p className="video-error-text">{settings.error}</p>}</article>; })}</div> : <Empty text="No streaming encoders are configured." />}</section>
    </>}

    {ready && tab === "Routing" && <div className="video-routing-layout video-routing-page"><section className="video-panel video-routing-matrix-panel">
        {hubs.length ? <><div className="video-routing-device-row">{hub && <><div className="video-routing-device-info"><strong>{hub.site.name} · {hub.name}</strong><IpAddress value={hub.ip} /><span className={`video-state ${matrix?.connected ? "video-state-good" : ""}`}>{matrix?.connected ? "Connected" : "Disconnected"}</span>{matrix?.inputs && matrix.outputs && <small>{matrix.inputs.length} inputs · {matrix.outputs.length} outputs</small>}</div><div className={`video-preset-menu-anchor${presetsOpen ? " video-preset-menu-anchor-open" : ""}`} ref={presetsMenuRef}>
          <button className="video-small-button" type="button" aria-haspopup="dialog" aria-expanded={presetsOpen} aria-controls="video-routing-presets" disabled={busy} onClick={() => { const opening = !presetsOpen; setPresetsOpen(opening); if (opening) void loadPresets(hub.id, hub.site.id); else { setPresetNameOpen(false); setPresetName(""); setPendingPresetAction(null); } }}><ChevronDown size={14} /> Presets</button>
          {presetsOpen && <div className="video-preset-menu" id="video-routing-presets" role="dialog" aria-label="Routing presets">
            <div className="video-preset-menu-heading"><strong>Routing presets</strong>{!presetNameOpen && !pendingPresetAction && <button className="video-small-button" type="button" disabled={busy || !matrix?.connected || !capabilities.canManageRouting} onClick={() => { setPresetName(""); setPresetNameOpen(true); }}><Save size={12} /> Save current</button>}</div>
            {presetNameOpen && <form className="video-preset-name-form" onSubmit={(event) => void submitRoutingPreset(event)}><label htmlFor="video-preset-name">Preset name</label><div><input id="video-preset-name" autoFocus value={presetName} onChange={(event) => setPresetName(event.target.value)} maxLength={80} placeholder="e.g. Sunday service" required /><button className="video-small-button" type="submit" disabled={busy || !matrix?.connected || !capabilities.canManageRouting || !presetName.trim()}><Save size={12} /> Save</button><button className="video-small-button" type="button" disabled={busy} onClick={() => { setPresetNameOpen(false); setPresetName(""); }}>Cancel</button></div></form>}
            {pendingPresetAction ? <div className="video-preset-confirm" role="alertdialog" aria-labelledby="video-preset-confirm-title"><strong id="video-preset-confirm-title">{pendingPresetAction.kind === "recall" ? "Recall this preset?" : "Delete this preset?"}</strong><p>{pendingPresetAction.kind === "recall" ? <>This will change the current router outputs to <b>{pendingPresetAction.preset.name}</b>.</> : <>This will remove <b>{pendingPresetAction.preset.name}</b>. Current routing will stay unchanged.</>}</p><div><button className="video-small-button" type="button" disabled={busy} onClick={() => setPendingPresetAction(null)}>Cancel</button><button className={`video-small-button ${pendingPresetAction.kind === "delete" ? "video-preset-delete" : ""}`} type="button" autoFocus disabled={busy} onClick={() => void (pendingPresetAction.kind === "recall" ? recallRoutingPreset(pendingPresetAction.preset) : deleteRoutingPreset(pendingPresetAction.preset))}>{pendingPresetAction.kind === "recall" ? <><Play size={12} /> Recall</> : <><Trash2 size={12} /> Delete</>}</button></div></div> : busy && presets.length === 0 ? <p className="video-preset-menu-empty">Loading presets…</p> : presets.length ? presets.map((preset) => <div className="video-preset-row" key={preset.id}><div className="video-preset-actions"><button type="button" className="video-small-button" disabled={busy || !hub || !matrix?.routes || !capabilities.canManageRouting} onClick={() => setPendingPresetAction({ kind: "recall", preset })}><Play size={12} /> Recall</button><button type="button" className="video-small-button video-preset-delete" disabled={busy || !capabilities.canAdminRouting} onClick={() => setPendingPresetAction({ kind: "delete", preset })} aria-label={`Delete preset ${preset.name}`} title={`Delete ${preset.name}`}><Trash2 size={12} /> Delete</button></div><span><strong>{preset.name}</strong><small>Saved routing preset</small></span></div>) : <p className="video-preset-menu-empty">No saved routing presets.</p>}
          </div>}
        </div></>}</div>
        {matrix?.connected && matrix.inputs && matrix.outputs && matrix.routes ? <div className="video-matrix-wrap" role="region" aria-label="Videohub crosspoint routing matrix" tabIndex={0}><table className="video-matrix"><thead><tr><th className="video-matrix-corner"><span>Inputs →</span><span>Outputs ↓</span></th>{matrix.inputs.map((label, inputIndex) => <th className={hoveredCrosspoint?.input === inputIndex ? "video-matrix-input video-matrix-axis-highlight" : "video-matrix-input"} scope="col" key={`${inputIndex}-${label}`}><div title={label}><span>{label}</span></div><small>{inputIndex + 1}</small></th>)}</tr></thead><tbody>{matrix.outputs.map((label, outputIndex) => { const locked = matrix.locks?.[outputIndex] !== "U"; return <tr key={`${outputIndex}-${label}`}><th className={hoveredCrosspoint?.output === outputIndex ? "video-matrix-output video-matrix-axis-highlight" : "video-matrix-output"} scope="row"><small>{outputIndex + 1}</small><span title={label}>{label}</span>{locked && <LockKeyhole className="video-matrix-lock" size={11} aria-label="Output locked" />}</th>{matrix.inputs?.map((inputLabel, inputIndex) => { const active = matrix.routes?.[outputIndex] === inputIndex; const highlighted = hoveredCrosspoint?.output === outputIndex || hoveredCrosspoint?.input === inputIndex; return <td className={`video-matrix-crosspoint${active ? " video-matrix-crosspoint-active" : ""}${hoveredCrosspoint?.output === outputIndex ? " video-matrix-hover-row" : ""}${hoveredCrosspoint?.input === inputIndex ? " video-matrix-hover-column" : ""}`} key={`${outputIndex}-${inputIndex}`}><button type="button" className={`${active ? "video-crosspoint video-crosspoint-active" : "video-crosspoint"}${highlighted ? " video-crosspoint-highlighted" : ""}`} aria-label={`Route output ${outputIndex + 1}, ${label}, to input ${inputIndex + 1}, ${inputLabel}${active ? "; current route" : ""}${locked ? "; locked" : ""}`} aria-pressed={active} title={`${label} ← ${inputLabel}${active ? " · current route" : ""}${locked ? " · locked" : ""}`} disabled={busy || locked || active || !capabilities.canManageRouting} onMouseEnter={() => setHoveredCrosspoint({ output: outputIndex, input: inputIndex })} onMouseLeave={() => setHoveredCrosspoint(null)} onFocus={() => setHoveredCrosspoint({ output: outputIndex, input: inputIndex })} onBlur={() => setHoveredCrosspoint(null)} onClick={() => void changeRoute(outputIndex, inputIndex)}><span /></button></td>; })}</tr>; })}</tbody></table></div> : <Empty text={matrix?.error ?? "Waiting for a Videohub connection."} />}
      </> : <Empty text="No Videohub is configured for this location." />}</section>
      <section className="video-panel video-history-panel" aria-label="Routing timeline">
        <div className="video-panel-heading video-timeline-heading">
          <div><h2>Timeline</h2><p>{history.length} events · {Intl.DateTimeFormat().resolvedOptions().timeZone || "Local time"}</p></div>
          <div className="video-timeline-controls">
            <button className={historyLive ? "video-timeline-live video-timeline-live-active" : "video-timeline-live"} type="button" aria-pressed={historyLive} onClick={() => setHistoryLive((live) => !live)}><span />{historyLive ? "LIVE" : "PAUSED"}</button>
            <button className="video-small-button" type="button" disabled={!hub || historyLoading} title="Refresh timeline" aria-label="Refresh timeline" onClick={() => hub && void loadHistory(hub.id, hub.site.id)}><RefreshCw size={13} className={historyLoading ? "video-refresh-spinning" : ""} />{historyLoading ? "Updating" : "Update"}</button>
          </div>
        </div>
        {history.length ? <div className="video-timeline-list">
          {history.slice(0, 40).map((entry, index) => {
            const changes = entry.changes ?? [];
            const details = entry.details ?? [];
            const sourceName = (source: number | null | undefined) => source == null ? "No input" : entry.state?.inputs?.[source] ?? `Input ${source + 1}`;
            const eventTitle = entry.kind === "change" && changes.length
              ? `Routing changes · ${changes.length}`
              : entry.kind === "change" && details.length && details.every((detail) => detail.field === "locks")
                ? `Output lock changes · ${details.length}`
                : entry.kind === "change" && details.length
                  ? `Router updates · ${details.length}`
                  : entry.kind === "baseline" ? "Routing baseline" : String(entry.kind ?? "Routing event");
            const detailLabel = (detail: RouteHistoryDetail) => detail.field === "locks"
              ? `${entry.state?.outputs?.[detail.index] ?? `Output ${detail.index + 1}`} lock`
              : `${detail.field === "inputs" ? "Input" : detail.field === "outputs" ? "Output" : detail.field} ${detail.index + 1}`;
            const detailValue = (detail: RouteHistoryDetail, value: unknown) => detail.field === "locks"
              ? value === "L" ? "Locked" : value === "U" ? "Unlocked" : String(value ?? "—")
              : String(value ?? "—");
            const timelineTime = (value: unknown) => typeof value === "number"
              ? formatUserDate(new Date(value * 1000), true)
              : formatTimestamp(value);
            return <article className="video-timeline-event" key={String(entry.id ?? index)}>
              <span className={`video-timeline-marker ${entry.kind === "change" ? "video-timeline-marker-change" : ""}`} aria-hidden="true" />
              <time className="video-timeline-time" dateTime={entry.time ? new Date(entry.time * 1000).toISOString() : undefined}>{timelineTime(entry.started_at ?? entry.time)}{entry.started_at && entry.time && entry.started_at !== entry.time ? ` – ${timelineTime(entry.time)}` : ""}</time>
              <h3>{eventTitle}</h3>
              {changes.length ? <ul className="video-timeline-changes">{changes.slice(0, 3).map((change, changeIndex) => {
                const outputName = entry.state?.outputs?.[change.output] ?? `Output ${change.output + 1}`;
                return <li key={`${change.output}-${changeIndex}`}><strong>{outputName}</strong><span>{sourceName(change.before)} <span aria-hidden="true">→</span> {sourceName(change.after)}</span></li>;
              })}{changes.length > 3 && <li className="video-timeline-more">+ {changes.length - 3} more route changes</li>}</ul> : details.length ? <ul className="video-timeline-changes">{details.slice(0, 3).map((detail, detailIndex) => <li key={`${detail.field}-${detail.index}-${detailIndex}`}><strong>{detailLabel(detail)}</strong><span>{detailValue(detail, detail.before)} <span aria-hidden="true">→</span> {detailValue(detail, detail.after)}</span></li>)}{details.length > 3 && <li className="video-timeline-more">+ {details.length - 3} more updates</li>}</ul> : <p className="video-timeline-summary">Initial router snapshot</p>}
              <p className="video-timeline-actor">{String(changes[0]?.user ?? details[0]?.user ?? entry.user ?? "External change")}</p>
            </article>;
          })}
          {history.length > 40 && <p className="video-timeline-more-count">Showing the latest 40 of {history.length} events.</p>}
        </div> : <div className="video-timeline-empty"><Clock3 size={17} /><span>{historyLoading ? "Loading routing history…" : hub ? "No routing events recorded yet." : "Select a Videohub to view its timeline."}</span></div>}
      </section></div>}

    {ready && tab === "Names & locks" && capabilities.canAdminRouting && <div className="video-router-admin-page">
      <section className="video-panel video-label-panel"><div className="video-panel-heading"><div><h2>Input names</h2><p>Rename the sources shown in the routing matrix.</p></div></div>
        {matrix?.connected && matrix.inputs ? <div className="video-label-list">{matrix.inputs.map((name, index) => { const draftKey = `input:${index}`; const draft = labelDrafts[draftKey] ?? name; return <form className="video-label-row" key={`${index}-${name}`} onSubmit={(event) => { event.preventDefault(); void renameRouterLabel("input", index, name); }}><span className="video-label-index">{index + 1}</span><input aria-label={`Input ${index + 1} name`} value={draft} maxLength={64} onChange={(event) => setLabelDrafts((current) => ({ ...current, [draftKey]: event.target.value }))} /><button className="video-small-button" type="submit" disabled={busy || !draft.trim() || draft.trim() === name}><Save size={12} /> Save</button></form>; })}</div> : <Empty text={matrix?.error ?? "Waiting for a Videohub connection."} />}
      </section>
      <section className="video-panel video-label-panel"><div className="video-panel-heading"><div><h2>Output names and locks</h2><p>Rename destinations and control their lock state.</p></div></div>
        {matrix?.connected && matrix.outputs ? <div className="video-label-list">{matrix.outputs.map((name, index) => { const draftKey = `output:${index}`; const draft = labelDrafts[draftKey] ?? name; const lockState = matrix.locks?.[index] ?? "U"; const locked = lockState !== "U"; return <div className="video-label-row video-label-row-output" key={`${index}-${name}`}><span className="video-label-index">{index + 1}</span><form className="video-label-edit" onSubmit={(event) => { event.preventDefault(); void renameRouterLabel("output", index, name); }}><input aria-label={`Output ${index + 1} name`} value={draft} maxLength={64} onChange={(event) => setLabelDrafts((current) => ({ ...current, [draftKey]: event.target.value }))} /><button className="video-small-button" type="submit" disabled={busy || !draft.trim() || draft.trim() === name} aria-label={`Save output ${index + 1} name`} title="Save name"><Save size={12} /></button></form><button className={`video-small-button video-lock-toggle${locked ? " video-lock-toggle-locked" : ""}`} type="button" disabled={busy} aria-pressed={locked} onClick={() => void toggleRouterOutputLock(index, lockState)}><LockKeyhole size={13} />{locked ? "Unlock" : "Lock"}</button></div>; })}</div> : <Empty text={matrix?.error ?? "Waiting for a Videohub connection."} />}
      </section>
    </div>}

    {ready && tab === "XML tools" && <section className="video-panel video-settings-panel">
      <div className="video-panel-heading"><div><h2>Streaming profile XML tools</h2><p>Create, validate, import, export and distribute encoder profiles.</p></div><button type="button" className="video-small-button" disabled={busy || !xmlEncoder || !capabilities.canManageEncoders} onClick={() => void exportXml(includeSecrets)}><Download size={14} /> Export active XML</button></div>
      {!xmlEncoder ? <Empty text="No streaming encoder is configured for this location." /> : <>
        <label className="video-field">Encoder<select value={xmlEncoder.key} onChange={(event) => { setSelectedEncoder(event.target.value); setXmlPreview(null); setXmlPlan(null); setReviewedXml(""); }}><option value="">Select encoder</option>{encoders.map((encoder) => <option value={encoder.key} key={encoder.key}>{encoder.site.name} · {encoder.name}</option>)}</select></label>
        <div className="video-settings-identity"><strong>{xmlEncoder.site.name} · {xmlEncoder.name}</strong><IpAddress value={xmlEncoder.ip} /><button type="button" className="video-small-button" disabled={!capabilities.canManageEncoders} onClick={newXmlFile}><Plus size={13} /> New XML</button></div>
        <fieldset className="video-settings-box"><legend>Import / Export</legend>
          <input ref={xmlFileInput} className="video-hidden-file" type="file" accept=".xml,text/xml,application/xml" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (!file) return; if (file.size > 262144) return setNotice("Choose an XML file smaller than 256 KB."); void file.text().then((source) => void previewXml(source)).catch(() => setNotice("Could not read that XML file.")); }} />
          <div className="video-settings-toolbar"><button type="button" className="video-small-button" disabled={busy || !capabilities.canManageEncoders} onClick={() => xmlFileInput.current?.click()}>Import XML…</button><button type="button" className="video-small-button" disabled={busy || !capabilities.canManageEncoders} onClick={() => void exportXml(includeSecrets)}>Export XML…</button></div>
          <label className="video-settings-check"><input type="checkbox" checked={includeSecrets} onChange={(event) => setIncludeSecrets(event.target.checked)} /> Include stream key and access credentials in export</label>
          <p className="video-settings-help">Edit the XML directly or use the visual editor. Changes sync between both sides. Validate before applying a profile to the selected encoder. SRT passphrases are never exported.</p>
          <div className="video-xml-workspace">
            <section className="video-xml-pane" aria-label="Plain XML editor"><header><div><h3>Plain XML</h3><p>Raw Blackmagic Streaming XML</p></div><button type="button" className="video-small-button" disabled={!xml.trim()} onClick={() => { const document = parseStreamingXml(xml); if (!document) return setNotice("Fix XML syntax before formatting."); setXml(formatStreamingXml(document)); setXmlPreview(null); setReviewedXml(""); }}>Format</button></header><textarea className="video-xml-editor" aria-label="Streaming XML source" value={xml} onChange={(event) => { setXml(event.target.value); setXmlPreview(null); setXmlPlan(null); setReviewedXml(""); }} spellCheck={false} /></section>
            <section className="video-xml-pane video-xml-visual" aria-label="Visual XML editor"><header><div><h3>Visual editor</h3><p>{visualDocument ? `${visualServices.length} service${visualServices.length === 1 ? "" : "s"}` : "Valid <streaming> XML is required"}</p></div><button type="button" className="video-small-button" disabled={!capabilities.canManageEncoders || !visualDocument} onClick={addXmlService}><Plus size={13} /> Add service</button></header>
              {!visualDocument ? <Empty text="The XML is malformed or does not use a <streaming> root. Fix it in the left editor to continue." /> : !visualService ? <Empty text="Add a service to begin building a streaming profile." /> : <div className="video-xml-form">
                <div className="video-xml-form-toolbar"><label className="video-field">Service<select value={Math.max(0, visualServices.indexOf(visualService))} onChange={(event) => { setXmlServiceIndex(Number(event.target.value)); setXmlServerIndex(0); setXmlProfileIndex(0); setXmlModeIndex(0); }} aria-label="Select service">{visualServices.map((service, index) => <option key={index} value={index}>{xmlChild(service, "name")?.textContent || `Service ${index + 1}`}</option>)}</select></label><button type="button" className="video-small-button video-button-danger" disabled={!capabilities.canManageEncoders || visualServices.length < 2} aria-label="Delete selected service" onClick={() => removeXmlNode("service")}><Trash2 size={13} /> Remove</button></div>
                <label className="video-field">Service name<input value={xmlChild(visualService, "name")?.textContent ?? ""} onChange={(event) => editXmlText("service", "name", event.target.value)} /></label>
                <label className="video-field">Stream key (optional)<input type="password" autoComplete="new-password" value={xmlChild(visualService, "key")?.textContent ?? ""} onChange={(event) => editXmlText("service", "key", event.target.value)} placeholder="Only include when required" /></label>
                <label className="video-settings-check"><input type="checkbox" checked={visualService.getAttribute("customizable-url") === "true"} onChange={(event) => editXmlAttribute("service", "customizable-url", String(event.target.checked))} /> Allow a custom streaming URL</label>

                <section className="video-xml-group"><header><h4>Servers</h4><button type="button" className="video-small-button" disabled={!capabilities.canManageEncoders} onClick={addXmlServer}><Plus size={13} /> Add server</button></header>
                  {visualServers.length > 0 && visualServer && <><div className="video-xml-form-toolbar"><label className="video-field">Server<select value={Math.max(0, visualServers.indexOf(visualServer))} onChange={(event) => setXmlServerIndex(Number(event.target.value))}>{visualServers.map((server, index) => <option key={index} value={index}>{xmlChild(server, "name")?.textContent || `Server ${index + 1}`}</option>)}</select></label><button type="button" className="video-small-button video-button-danger" disabled={!capabilities.canManageEncoders || visualServers.length < 2} aria-label="Delete selected server" onClick={() => removeXmlNode("server")}><Trash2 size={13} /> Remove</button></div>
                    <label className="video-field">Server name<input value={xmlChild(visualServer, "name")?.textContent ?? ""} onChange={(event) => editXmlText("server", "name", event.target.value)} /></label>
                    <label className="video-field">Protocol<select value={schemeOf(xmlChild(visualServer, "url")?.textContent || "rtmp") || "rtmp"} onChange={(event) => { const previous = xmlChild(visualServer, "url")?.textContent ?? ""; const rest = previous.replace(/^[a-z][a-z\d+.-]*:\/\//i, ""); editXmlText("server", "url", `${event.target.value}://${rest}`); }}><option value="rtmp">RTMP</option><option value="rtmps">RTMPS</option><option value="srt">SRT</option></select></label>
                    <label className="video-field">URL<input value={xmlChild(visualServer, "url")?.textContent ?? ""} onChange={(event) => editXmlText("server", "url", event.target.value)} placeholder="rtmp://host/live" /></label>
                    <label className="video-field">Group (optional)<input value={xmlChild(visualServer, "group")?.textContent ?? ""} onChange={(event) => editXmlText("server", "group", event.target.value)} /></label></>}
                </section>

                <section className="video-xml-group"><header><h4>Streaming profiles</h4><button type="button" className="video-small-button" disabled={!capabilities.canManageEncoders} onClick={addXmlProfile}><Plus size={13} /> Add profile</button></header>
                  {visualProfilesNode && visualProfiles.length > 0 && visualProfile && <><label className="video-field">Default profile<select value={xmlChild(visualProfiles.find((profile) => xmlChild(profile, "name")?.textContent === visualProfilesNode.getAttribute("default")) ?? visualProfile, "name")?.textContent ?? ""} onChange={(event) => editXmlAttribute("profiles", "default", event.target.value)}>{visualProfiles.map((profile, index) => <option key={index}>{xmlChild(profile, "name")?.textContent || `Profile ${index + 1}`}</option>)}</select></label>
                    <div className="video-xml-form-toolbar"><label className="video-field">Profile<select value={Math.max(0, visualProfiles.indexOf(visualProfile))} onChange={(event) => { setXmlProfileIndex(Number(event.target.value)); setXmlModeIndex(0); }}>{visualProfiles.map((profile, index) => <option key={index} value={index}>{xmlChild(profile, "name")?.textContent || `Profile ${index + 1}`}</option>)}</select></label><button type="button" className="video-small-button video-button-danger" disabled={!capabilities.canManageEncoders || visualProfiles.length < 2} onClick={() => removeXmlNode("profile")}><Trash2 size={13} /> Remove</button></div>
                    <label className="video-field">Profile name<input value={xmlChild(visualProfile, "name")?.textContent ?? ""} onChange={(event) => editXmlText("profile", "name", event.target.value)} /></label>
                    <div className="video-xml-form-toolbar"><label className="video-field">Video mode<select value={Math.max(0, visualModes.indexOf(visualMode))} onChange={(event) => setXmlModeIndex(Number(event.target.value))}>{visualModes.map((mode, index) => <option value={index} key={index}>{mode.getAttribute("resolution") || "1080p"} / {mode.getAttribute("fps") || "30"} fps</option>)}</select></label><button type="button" className="video-small-button" disabled={!capabilities.canManageEncoders} onClick={addXmlMode}><Plus size={13} /> Add mode</button>{visualModes.length > 1 && <button type="button" className="video-small-button video-button-danger" disabled={!capabilities.canManageEncoders} onClick={() => removeXmlNode("mode")}><Trash2 size={13} /> Remove mode</button>}</div>
                    {visualMode && <div className="video-xml-mode-grid"><label className="video-field">Resolution<input value={visualMode.getAttribute("resolution") ?? ""} onChange={(event) => editXmlAttribute("mode", "resolution", event.target.value)} placeholder="1080p" /></label><label className="video-field">Frame rate<input type="number" min="1" max="240" value={visualMode.getAttribute("fps") ?? "30"} onChange={(event) => editXmlAttribute("mode", "fps", event.target.value)} /></label><label className="video-field">Codec<select value={visualMode.getAttribute("codec") ?? "H264"} onChange={(event) => editXmlAttribute("mode", "codec", event.target.value)}><option value="H264">H.264</option><option value="H265">H.265</option></select></label><label className="video-field">Video bitrate (bit/s)<input type="number" min="1" value={xmlChild(visualMode, "bitrate")?.textContent ?? "6000000"} onChange={(event) => editXmlText("mode", "bitrate", event.target.value)} /></label><label className="video-field">Audio bitrate (bit/s)<input type="number" min="1" value={xmlChild(visualMode, "audio-bitrate")?.textContent ?? "128000"} onChange={(event) => editXmlText("mode", "audio-bitrate", event.target.value)} /></label></div>}
                  </>}
                </section>

                <section className="video-xml-group"><header><h4>Credentials (optional)</h4></header><label className="video-field">Username<input autoComplete="off" value={xmlChild(xmlChild(visualService, "credentials"), "username")?.textContent ?? ""} onChange={(event) => editXmlText("credentials", "username", event.target.value)} /></label><label className="video-field">Password<input type="password" autoComplete="new-password" value={xmlChild(xmlChild(visualService, "credentials"), "password")?.textContent ?? ""} onChange={(event) => editXmlText("credentials", "password", event.target.value)} /></label></section>
              </div>}
            </section>
          </div>
          <div className="video-settings-toolbar"><button type="button" className="video-small-button video-button-primary" disabled={busy || !capabilities.canManageEncoders || !xml.trim()} onClick={() => void previewXml()}><Check size={14} /> Validate and review XML</button><button type="button" className="video-small-button" disabled={!xml} onClick={() => { setXml(""); setXmlPreview(null); setXmlPlan(null); setReviewedXml(""); }}>Clear editor</button></div>
          {xmlPreview && <div className="video-settings-xml-review"><strong><Check size={15} /> XML valid · {xmlPlan?.filename}{xmlPlan?.replaces_existing ? " will be replaced" : " will be created"}</strong>
            <div className="video-settings-fields video-settings-xml-fields">
              <label className="video-field">Service<select value={xmlPlatform} onChange={(event) => { const name = event.target.value; const service = xmlPreview.services?.find((item) => item.platform === name); setXmlPlatform(name); setXmlServer(service?.servers[0]?.server ?? (service?.customizable_url ? "Custom" : "")); setXmlQuality(service?.profiles[0]?.profile ?? ""); setXmlCustomUrl(service?.servers[0]?.url ?? ""); }}><option value="">Select service</option>{xmlPreview.services?.map((service) => <option value={service.platform} key={service.platform}>{service.platform}</option>)}</select></label>
              <label className="video-field">Server<select value={xmlServer} onChange={(event) => { setXmlServer(event.target.value); const service = xmlPreview.services?.find((item) => item.platform === xmlPlatform); setXmlCustomUrl(service?.servers.find((item) => item.server === event.target.value)?.url ?? ""); }}><option value="">Select server</option>{xmlPreview.services?.find((service) => service.platform === xmlPlatform)?.servers.map((server) => <option value={server.server} key={server.server}>{server.server}</option>)}{xmlPreview.services?.find((service) => service.platform === xmlPlatform)?.customizable_url && <option value="Custom">Custom</option>}</select></label>
              <label className="video-field">Quality profile<select value={xmlQuality} onChange={(event) => setXmlQuality(event.target.value)}><option value="">Select quality</option>{xmlPreview.services?.find((service) => service.platform === xmlPlatform)?.profiles.map((profile) => <option value={profile.profile} key={profile.profile}>{profile.profile}</option>)}</select></label>
            </div>
            {xmlPreview.services?.find((service) => service.platform === xmlPlatform)?.customizable_url && <label className="video-field">Custom streaming URL<input value={xmlCustomUrl} onChange={(event) => setXmlCustomUrl(event.target.value)} placeholder="rtmp:// or srt://" /></label>}
            {capabilities.canManageEncoders && <button type="button" className="video-small-button video-button-primary" disabled={busy || reviewedXml !== xml || !xmlPlatform || !xmlQuality || !xmlServer} onClick={() => void applyXml()}>Review and apply XML</button>}
          </div>}
        </fieldset>
      </>}
    </section>}

    {settingsOpen && <div className="video-settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { setSettingsForm((current) => ({ ...current, key: "", passphrase: "" })); setSettingsOpen(false); } }}>
      <section className="video-settings-modal" role="dialog" aria-modal="true" aria-labelledby="video-settings-title">
        <header className="video-settings-modal-heading"><div><span className="video-eyebrow">ENCODER STREAMING</span><h2 id="video-settings-title">Encoder settings</h2><p>{xmlEncoder ? `${xmlEncoder.site.name} · ${xmlEncoder.name}` : "Loading encoder…"}</p>{xmlEncoder && <IpAddress value={xmlEncoder.ip} />}</div><button type="button" className="video-settings-close" aria-label="Close settings" onClick={() => { setSettingsForm((current) => ({ ...current, key: "", passphrase: "" })); setSettingsOpen(false); }}>×</button></header>
        {notice && <p className="video-settings-modal-notice" role="status">{notice}</p>}
        {settingsLoading && !encoderSettings ? <Empty text="Loading presets and settings from the encoder…" /> : !encoderSettings ? <Empty text="Could not load settings from this encoder." /> : <div className="video-settings-panel">
          <div className="video-settings-identity"><span className={`video-state ${encoderSettings.status === "Idle" ? "video-state-good" : ""}`}>Stream: {encoderSettings.status}</span></div>
          <fieldset className="video-settings-box"><legend>Encoder presets</legend>
            <label className="video-field">Preset<select value={settingsForm.preset} disabled={settingsLoading} onChange={(event) => { const value = event.target.value; setSettingsForm((current) => ({ ...current, preset: value })); void loadEncoderPreset(value); }}><option value="">Select a preset…</option>{encoderPresetNames.map((name) => <option value={name} key={name}>{name}</option>)}</select></label>
            <label className="video-field">Server<select value={settingsForm.server} disabled={settingsLoading || (!presetDetails?.servers.length && settingsForm.server !== "Custom")} onChange={(event) => { const server = presetDetails?.servers.find((item) => item.server === event.target.value); setSettingsForm((current) => ({ ...current, server: event.target.value, url: server?.url ?? current.url, protocol: schemeOf(server?.url) || current.protocol })); }}><option value="">Select server…</option>{presetDetails?.servers.map((server) => <option value={server.server} key={server.server}>{server.server}</option>)}{encoderSettings.customizable_url && settingsForm.server === "Custom" && <option value="Custom">Custom server URL</option>}</select></label>
            <label className="video-field">Preset quality<select value={settingsForm.quality} disabled={settingsLoading || !presetDetails?.profiles.length} onChange={(event) => setSettingsForm((current) => ({ ...current, quality: event.target.value }))}><option value="">Select quality…</option>{presetDetails?.profiles.map((profile) => <option value={profile.profile} key={profile.profile}>{profile.profile}</option>)}</select></label>
            {presetDetails?.deletion?.reason && <p className="video-settings-help">{presetDetails.deletion.reason}</p>}
            <div className="video-settings-toolbar"><button type="button" className="video-small-button video-button-primary" disabled={!capabilities.canManageEncoders || busy || settingsLoading || encoderSettings.status !== "Idle" || !settingsForm.preset || !settingsForm.server || settingsForm.server === "Custom" || !settingsForm.quality} onClick={() => void applyEncoderPreset()}>Apply preset</button><button type="button" className="video-small-button video-button-danger" disabled={!capabilities.canManageEncoders || busy || settingsLoading || encoderSettings.status !== "Idle" || !presetDetails?.deletion?.allowed} onClick={() => void deleteEncoderPreset()}>Delete preset…</button></div>
            <p className="video-settings-help">A selected preset can be applied while the stream is stopped.</p>
          </fieldset>
          <div className="video-settings-fields">
            <label className="video-field">Protocol<select value={settingsForm.protocol.toLowerCase()} disabled={!encoderSettings.customizable_url} onChange={(event) => setSettingsForm((current) => ({ ...current, protocol: event.target.value }))}><option value="srt">SRT</option><option value="rtmp">RTMP</option><option value="rtmps">RTMPS</option></select></label>
            <label className="video-field">Destination URL<input value={settingsForm.url} readOnly={!encoderSettings.customizable_url} onChange={(event) => setSettingsForm((current) => ({ ...current, url: event.target.value }))} placeholder="srt://host:port/live" /></label>
            <label className="video-field">Stream key<input type="password" autoComplete="new-password" value={settingsForm.key} onChange={(event) => setSettingsForm((current) => ({ ...current, key: event.target.value }))} placeholder={encoderSettings.has_key ? "Leave blank to keep the current key" : "No stream key configured"} /></label>
            <label className="video-field">SRT passphrase<input type="password" autoComplete="new-password" value={settingsForm.passphrase} onChange={(event) => setSettingsForm((current) => ({ ...current, passphrase: event.target.value }))} placeholder="Leave blank to keep the current passphrase" /></label>
            <label className="video-field">Quality profile<select value={settingsForm.quality} onChange={(event) => setSettingsForm((current) => ({ ...current, quality: event.target.value }))}><option value="">Select quality…</option>{presetDetails?.profiles.map((profile) => <option value={profile.profile} key={profile.profile}>{profile.profile}</option>)}</select></label>
            <label className="video-field">Video bitrate (Mbit/s)<input type="number" value={bitrateMbit} readOnly placeholder="Defined by the selected quality profile" /></label>
          </div>
          <p className="video-settings-help">Profile bitrates are edited in XML tools. The stream must be stopped before applying settings.</p>
          {!capabilities.canManageEncoders && <p className="video-settings-help">You have view access only. Ask a site administrator to change encoder settings.</p>}
          <div className="video-settings-actions"><button type="button" className="video-small-button" onClick={() => { setSettingsForm((current) => ({ ...current, key: "", passphrase: "" })); setSettingsOpen(false); }}>Cancel</button><button type="button" className="video-small-button video-button-primary" disabled={!canApplySettings || !settingsForm.quality} onClick={() => void applyEncoderSettings()}>Apply settings</button></div>
        </div>}
      </section>
    </div>}

    {streamWizard && <div className="video-settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !planningStream) { setStreamWizard(null); setStreamWizardError(""); } }}>
      <section className="video-settings-modal video-stream-wizard" role="dialog" aria-modal="true" aria-labelledby="video-stream-wizard-title">
        <header className="video-settings-modal-heading"><div><span className="video-eyebrow">YOUTUBE STREAMING</span><h2 id="video-stream-wizard-title">{streamWizard.step === "choose" ? "Create Stream" : "Stream settings"}</h2><p>{streamWizard.service.title} · {formatTimestamp(streamWizard.service.startsAt)}</p></div><button type="button" className="video-settings-close" aria-label="Close stream wizard" disabled={planningStream} onClick={() => { setStreamWizard(null); setStreamWizardError(""); }}>×</button></header>
        {streamWizardError && <p className="video-settings-modal-notice video-stream-wizard-error" role="alert">{streamWizardError}</p>}
        {streamWizard.step === "choose" ? <div className="video-stream-choice">
          <div><h3>Planned YouTube events</h3><p>Select an existing YouTube event to edit its settings, or create a new event from this service.</p></div>
          {plannedStreamsState?.streams.some((stream) => Boolean(stream.youtubeBroadcastId)) ? <div className="video-stream-choice-list">{plannedStreamsState.streams.filter((stream) => Boolean(stream.youtubeBroadcastId)).map((stream) => <button type="button" className="video-stream-choice-item" key={stream.id} onClick={() => selectExistingStream(stream)}><span><strong>{stream.title}</strong><small>{formatTimestamp(stream.startsAt)} · {stream.privacyStatus === "unlisted" ? "Unlisted" : stream.privacyStatus === "private" ? "Private" : "Public"}</small></span>{stream.youtubeStatus === "error" && <span className="video-state">Needs attention</span>}</button>)}</div> : <p className="video-stream-choice-empty">There are no planned events on YouTube yet.</p>}
          <div className="video-settings-actions"><button type="button" className="video-small-button" disabled={planningStream} onClick={() => setStreamWizard(null)}>Cancel</button><button type="button" className="video-small-button video-button-primary" onClick={createStreamFromService}><Plus size={14} /> NEW EVENT</button></div>
        </div> : <form className="video-stream-settings" onSubmit={(event) => void saveStreamWizard(event)}>
          <div className="video-stream-settings-summary"><strong>{streamWizard.streamId ? "Editing an existing planned event" : "New stream from service data"}</strong><span>{streamWizard.service.title}{streamWizard.service.speaker ? ` · ${streamWizard.service.speaker}` : ""}</span></div>
          <label className="video-field">Stream title<input required maxLength={100} value={streamWizard.title} onChange={(event) => setStreamWizard((current) => current ? { ...current, title: event.target.value } : current)} /></label>
          <div className="video-stream-settings-grid"><label className="video-field">Start time<input required type="datetime-local" value={streamWizard.startsAt} onChange={(event) => setStreamWizard((current) => current ? { ...current, startsAt: event.target.value } : current)} /></label><label className="video-field">Visibility<select value={streamWizard.privacyStatus} onChange={(event) => setStreamWizard((current) => current ? { ...current, privacyStatus: event.target.value as StreamWizard["privacyStatus"] } : current)}><option value="unlisted">Unlisted</option><option value="private">Private</option><option value="public">Public</option></select></label></div>
          <div className="video-stream-settings-details"><span><small>Speaker</small><strong>{streamWizard.speaker || "Not assigned"}</strong></span><span><small>Service title / theme</small><strong>{streamWizard.theme || "Not listed"}</strong></span></div>
          <label className="video-field">Add recording to playlist<select value={streamWizard.playlistId} onChange={(event) => setStreamWizard((current) => current ? { ...current, playlistId: event.target.value } : current)}><option value="">Do not add to a playlist</option>{plannedStreamsState?.playlists.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.title}{playlist.title === "GfC Steffisburg Livestream" ? " (default)" : ""}</option>)}</select></label>
          <p className="video-settings-help">The recording is added after YouTube finishes processing the stream.{!plannedStreamsState?.playlists.some((playlist) => playlist.title === "GfC Steffisburg Livestream") && plannedStreamsState?.youtube.connected ? " Create a playlist named GfC Steffisburg Livestream in YouTube first to use the default." : ""}</p>
          <p className="video-settings-help">{!plannedStreamsState?.youtube.connected ? "This stream will be saved locally. Connect YouTube to schedule it on the channel." : !streamWizard.streamId ? "Saving this new event will schedule it on YouTube." : plannedStreamsState.streams.find((stream) => stream.id === streamWizard.streamId)?.youtubeBroadcastId ? "Saving will update this event’s YouTube broadcast." : "This planned event will be updated locally. You can schedule it on YouTube afterward."}</p>
          <div className="video-settings-actions"><button type="button" className="video-small-button" disabled={planningStream} onClick={() => { setStreamWizard((current) => current ? { ...current, step: "choose" } : current); setStreamWizardError(""); }}>Back</button><button type="submit" className="video-small-button video-button-primary" disabled={planningStream || !streamWizard.title.trim() || !streamWizard.startsAt}>{planningStream ? "Saving…" : streamWizard.streamId ? "Save stream" : "Create stream"}</button></div>
        </form>}
      </section>
    </div>}

  </section>;
}

function Summary({ label, value, note, icon }: { label: string; value: number; note: string; icon: ReactNode }) {
  return <article className="video-summary-card"><span className="video-summary-icon">{icon}</span><div><small>{label}</small><strong>{value}</strong><span>{note}</span></div></article>;
}

function EncoderHardware({ encoder, status }: { encoder: Encoder; status: string }) {
  const connected = encoder.control === "Connected";
  const showUltraHdBranding = encoder.id === "encoder-3";
  const ready = status === "BEREIT";
  const live = status === "LIVE";
  const reportedStatus = stateValue(encoder.state, "Status");
  const stateHasProblem = Object.entries(encoder.state ?? {}).some(([key, value]) => /error|fault|warning|problem/i.test(key) && value != null && !/^(?:\s*|none|false|0|ok|no)$/i.test(String(value).trim()));
  const streamProblem = live && (Boolean(encoder.error) || stateHasProblem || /error|fail|warn|problem|lost|drop/i.test(reportedStatus));
  const onAirFlash = streamProblem ? "video-onair-flash" : undefined;
  const onAirTextClass = live ? `video-onair-lit${streamProblem ? " video-onair-flash" : ""}` : undefined;
  const statusColor = live ? "#f51d34" : ready ? "#edf1f4" : "#f0b64c";
  const telemetryLed = !connected ? "#e9a536" : live ? "#f51d34" : "#64db86";
  return <svg className="video-encoder-hardware" viewBox="0 0 1500 500" role="img" aria-label={`${encoder.model || `Blackmagic Web Presenter${showUltraHdBranding ? " Ultra HD" : ""}`} illustrated front panel, ${status}`}>
    <rect x="3" y="5" width="1494" height="490" rx="20" fill="#111214" stroke="#08090a" strokeWidth="5" />
    <rect x="8" y="10" width="1484" height="480" rx="16" fill="#1c1e21" stroke="#45484d" strokeWidth="3" />
    <path d="M20 24h1460M20 476h1460" stroke="#292c30" strokeWidth="2" opacity=".8" />
    {showUltraHdBranding && <>
      <text x="37" y="107" fill="#f4f4f5" fontFamily="Arial, sans-serif" fontSize="38" fontStyle="italic" fontWeight="700">ULTRA</text>
      <text x="163" y="107" fill="#ff9e14" fontFamily="Arial, sans-serif" fontSize="38" fontStyle="italic" fontWeight="700">HD</text>
    </>}
    <path d="M40 220h190a18 18 0 0 1 18 18v187a18 18 0 0 1-18 18H40a18 18 0 0 1-18-18V238a18 18 0 0 1 18-18Z" fill="#17191b" stroke="#0c0d0e" strokeWidth="5" />
    <path d="M72 317h130m-100-29-29 29 29 29m70-58 29 29-29 29m-70-39h54l21 20" fill="none" stroke="#090b0d" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M72 317h130m-100-29-29 29 29 29m70-58 29 29-29 29m-70-39h54l21 20" fill="none" stroke="#24272a" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    <g fontFamily="Arial, sans-serif" fontWeight="700" textAnchor="middle" fill="#f3f4f5">
      {[{ x: 291, y: 55, text: "ON AIR", active: live }, { x: 456, y: 55, text: "MENU" }, { x: 291, y: 185, text: "OFF" }, { x: 456, y: 185, text: "SET" }, { x: 291, y: 315, text: "CALL" }, { x: 456, y: 315, text: "LOCK" }].map((button) => <g key={button.text}>
        <rect x={button.x - 2} y={button.y - 4} width="144" height="108" rx="17" fill="#090a0b" stroke="#050607" strokeWidth="5" />
        <rect x={button.x + 5} y={button.y + 3} width="130" height="94" rx="13" fill={button.active ? "#202124" : "#25272a"} stroke="#45474a" strokeWidth="3" />
        <text className={button.text === "ON AIR" ? onAirTextClass : undefined} x={button.x + 70} y={button.y + 59} fill={button.active ? "#ff1d35" : "#f2f3f4"} fontSize={button.text.length > 4 ? 28 : 30}>{button.text}</text>
      </g>)}
    </g>
    <rect x="693" y="45" width="510" height="386" rx="17" fill="#090b0e" stroke="#0b0c0d" strokeWidth="8" />
    <rect x="706" y="57" width="484" height="361" rx="9" fill="#08131e" stroke="#30363c" strokeWidth="3" />
    <path d="M707 117h482M707 203h482" stroke="#26313d" strokeWidth="4" />
    <text x="728" y="96" fill="#eff3f6" fontFamily="Arial, sans-serif" fontSize="24">{stateBitrate(encoder.state)}</text>
    <text x="858" y="96" fill="#eff3f6" fontFamily="Arial, sans-serif" fontSize="24">{stateMetric(encoder.state, "Duration")}</text>
    <circle cx="1115" cy="84" r="9" fill={telemetryLed} />
    <text x="1134" y="93" fill="#d8dee3" fontFamily="Arial, sans-serif" fontSize="20">{stateMetric(encoder.state, "Cache Used")}</text>
    <text className={onAirFlash} x="948" y="184" fill={statusColor} fontFamily="Arial, sans-serif" fontSize="72" fontWeight="700" textAnchor="middle">{live ? "ON AIR" : status}</text>
    <rect x="707" y="205" width="482" height="212" fill="#142533" />
    <path d="M725 223h25m-25 0v24m447-24h-25m25 0v24m-447 170h25m-25 0v-24m447 24h-25m25 0v-24" fill="none" stroke="#315269" strokeWidth="3" />
    <circle cx="948" cy="297" r="31" fill="#1e3e50" stroke="#426a80" strokeWidth="3" />
    <path d="M937 280v34l27-17z" fill="#8ab8ce" />
    <text x="948" y="358" fill="#a8c5d4" fontFamily="Arial, sans-serif" fontSize="24" textAnchor="middle">{live ? "STREAMING" : ready ? "VIDEO PREVIEW" : "ENCODER STATUS"}</text>
    <text x="948" y="387" fill="#7693a2" fontFamily="Arial, sans-serif" fontSize="17" textAnchor="middle">STATUS MONITOR</text>
    <text x="1237" y="105" fill="#e0e2e5" fontFamily="Arial, sans-serif" fontSize="23" fontWeight="700" letterSpacing="-.6">Blackmagic<tspan fill="#c5c8cc" fontWeight="400">design</tspan></text>
    <circle cx="1379" cy="272" r="99" fill="#0b0c0e" stroke="#181a1c" strokeWidth="7" />
    <circle cx="1379" cy="272" r="80" fill="#2d3034" stroke="#55585d" strokeWidth="5" />
    <circle cx="1379" cy="272" r="69" fill="#303337" stroke="#3b3e42" strokeWidth="2" />
    <text x="1378" y="408" fill="#999da2" fontFamily="Arial, sans-serif" fontSize="13" textAnchor="middle">STREAMING ENCODER</text>
  </svg>;
}


function ShellyProHardware({ power, reachable }: { power?: string; reachable: boolean }) {
  const isOn = /^(?:on|true|1)$/i.test(power?.trim() ?? "");
  const known = Boolean(power && !/^(?:unknown|unavailable)$/i.test(power));
  const led = (label: string) => label === "Out" && known ? (isOn ? "#49e680" : "#778899") : reachable ? "#6ba4d8" : "#f2b548";
  return <svg className="video-shelly-hardware" viewBox="0 0 590 180" role="img" aria-label={`Blue Shelly 1 Pro DIN-rail relay, output ${known ? isOn ? "on" : "off" : "status unknown"}`}>
    <g transform="translate(0 180) rotate(-90)">
    <ellipse cx="90" cy="574" rx="54" ry="9" fill="#05080b" opacity=".42" />
    <path d="M39 23h102l7 24v500l-8 28H40l-8-28V47z" fill="#0758d2" stroke="#0646a9" strokeWidth="3" />
    <path d="M39 28h102v42H39z" fill="#39b944" stroke="#178626" strokeWidth="2" />
    <path d="M30 71h120v48H30z" fill="#0b4cb3" stroke="#073e99" strokeWidth="2" />
    {[51, 90, 129].map((x) => <g key={x}><circle cx={x} cy="52" r="14" fill="#aeb6bc" stroke="#747c85" strokeWidth="3"/><path d={`M${x - 9} 58l18-12`} stroke="#555d66" strokeWidth="3" strokeLinecap="round"/><circle cx={x} cy="52" r="3" fill="#d4d8dc"/></g>)}
    <path d="M29 118h122v25H29z" fill="#d6dbe0" stroke="#9da5ad" strokeWidth="2" />
    <path d="M28 143h124v73H28z" fill="#0860df" stroke="#034cac" strokeWidth="2" />
    <path d="M19 216h142v300H19z" fill="#0860df" stroke="#0349a7" strokeWidth="3" />
    <rect x="25" y="224" width="130" height="280" rx="8" fill="#0861df" stroke="#064aa9" strokeWidth="2" />
    {(["Power", "Wi-Fi", "LAN", "Out"] as const).map((label, index) => {
      const y = 258 + index * 38;
      return <g key={label}><text x="44" y={y + 8} fill="#e7f0ff" fontFamily="Arial,sans-serif" fontSize="17" fontWeight="700">{label}</text><circle cx="127" cy={y} r="6" fill="#082d65" stroke="#07428e" strokeWidth="2"/><circle cx="127" cy={y} r="3" fill={led(label)} /></g>;
    })}
    <text x="90" y="459" fill="#deebff" fontFamily="Arial,sans-serif" fontSize="21" fontStyle="italic" fontWeight="700" textAnchor="middle">Shelly</text>
    <circle cx="90" cy="493" r="29" fill="#0755c6" stroke="#0649ab" strokeWidth="3" />
    <circle cx="90" cy="493" r="22" fill="#0860d8" stroke="#126de4" strokeWidth="2" />
    <text x="90" y="535" fill="#dce9ff" fontFamily="Arial,sans-serif" fontSize="13" fontWeight="700" textAnchor="middle">Reset</text>
    <path d="M34 542h112v42H34z" fill="#0572d8" stroke="#034ba6" strokeWidth="2" />
    {[52, 90, 128].map((x) => <g key={`bottom-${x}`}><circle cx={x} cy="554" r="9" fill="#b7bdc3" stroke="#6e7780" strokeWidth="2"/><path d={`M${x - 6} 558l12-9`} stroke="#4c555e" strokeWidth="2.5" strokeLinecap="round"/><circle cx={x} cy="575" r="8" fill="#aeb6be" stroke="#626d77" strokeWidth="2"/><path d={`M${x - 5} 579l10-8`} stroke="#4c555e" strokeWidth="2" strokeLinecap="round"/></g>)}
    </g>
  </svg>;
}

function Empty({ text }: { text: string }) { return <div className="video-empty video-empty-small"><Video size={20} /><p>{text}</p></div>; }
function parseStreamingXml(source: string): Document | null {
  if (!source.trim() || typeof DOMParser === "undefined") return null;
  const document = new DOMParser().parseFromString(source, "application/xml");
  return document.getElementsByTagName("parsererror").length || document.documentElement?.tagName !== "streaming" ? null : document;
}
function xmlChildren(parent: ParentNode | null, name: string): Element[] {
  return parent ? Array.from(parent.childNodes).filter((node): node is Element => node.nodeType === 1 && (node as Element).tagName === name) : [];
}
function xmlChild(parent: ParentNode | null, name: string): Element | null { return xmlChildren(parent, name)[0] ?? null; }
function ensureXmlChild(document: Document, parent: Element, name: string): Element {
  return xmlChild(parent, name) ?? parent.appendChild(document.createElement(name));
}
function appendXmlText(document: Document, parent: Element, name: string, value: string) {
  const element = document.createElement(name);
  element.textContent = value;
  parent.append(element);
}
function setXmlChildText(document: Document, parent: Element, name: string, value: string) { ensureXmlChild(document, parent, name).textContent = value; }
function escapeXml(value: string) { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;"); }
function formatStreamingXml(document: Document): string {
  const render = (node: Node, depth: number): string => {
    const indent = "  ".repeat(depth);
    if (node.nodeType === 1) {
      const element = node as Element;
      const attrs = Array.from(element.attributes).map((attr) => ` ${attr.name}="${escapeXml(attr.value)}"`).join("");
      const children = Array.from(element.childNodes).filter((child) => !(child.nodeType === 3 && !child.textContent?.trim()));
      if (!children.length) return `${indent}<${element.tagName}${attrs}/>`;
      if (children.every((child) => child.nodeType === 3 || child.nodeType === 4)) return `${indent}<${element.tagName}${attrs}>${children.map((child) => escapeXml(child.textContent ?? "")).join("")}</${element.tagName}>`;
      return `${indent}<${element.tagName}${attrs}>\n${children.map((child) => render(child, depth + 1)).join("\n")}\n${indent}</${element.tagName}>`;
    }
    if (node.nodeType === 8) return `${indent}<!--${node.textContent ?? ""}-->`;
    if (node.nodeType === 4) return `${indent}<![CDATA[${node.textContent ?? ""}]]>`;
    if (node.nodeType === 7) return `${indent}<?${node.nodeName} ${node.nodeValue ?? ""}?>`;
    return `${indent}${escapeXml(node.textContent ?? "")}`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?>\n${render(document.documentElement, 0)}\n`;
}
function workerLabel(value: string) { return value === "ready" ? "Worker ready" : value === "unconfigured" ? "Not configured" : value === "failed" ? "Worker failed" : value === "backoff" ? "Worker restarting" : value === "starting" ? "Worker starting" : "Worker unavailable"; }
function messageOf(value: unknown) { return value && typeof value === "object" && "message" in value && typeof value.message === "string" ? value.message : null; }
function stringValue(value: unknown) { return typeof value === "string" ? value : ""; }
function schemeOf(value?: string) { return value?.match(/^([a-z][a-z\d+.-]*):/i)?.[1].toLowerCase() ?? ""; }
function presetNames(value: unknown) {
  const candidates = Array.isArray(value) ? value : value && typeof value === "object" ? Object.values(value).find(Array.isArray) as unknown[] | undefined ?? [] : [];
  return candidates.map((item) => typeof item === "string" ? item : item && typeof item === "object" ? stringValue("platform" in item ? item.platform : "name" in item ? item.name : "") : "").filter(Boolean);
}
function stateValue(state: Record<string, unknown> | undefined, key: string) {
  const entry = Object.entries(state ?? {}).find(([name]) => name.toLowerCase() === key.toLowerCase());
  return entry ? stringValue(entry[1]) : "";
}
function stateMetric(state: Record<string, unknown> | undefined, key: string) { return stateValue(state, key) || "—"; }
function stateBitrate(state: Record<string, unknown> | undefined) {
  const value = stateValue(state, "Bitrate");
  const numeric = Number(value.replace(/[,_\s]/g, ""));
  if (!value) return "—";
  if (!Number.isFinite(numeric)) return value;
  return `${numeric >= 1000 ? (numeric / 1_000_000).toFixed(2) : numeric.toFixed(2)} Mb/s`;
}
function streamState(encoder: Encoder) {
  const status = stateValue(encoder.state, "Status");
  if (encoder.control !== "Connected") return { label: "OFFLINE", ready: false };
  if (encoderIsLive(encoder)) return { label: "LIVE", ready: false };
  if (!status || /idle|stop|ready/i.test(status)) return { label: "BEREIT", ready: true };
  return { label: status.toLocaleUpperCase(), ready: false };
}
function encoderIsLive(encoder: Encoder) {
  const streaming = stateValue(encoder.state, "Streaming").trim().toLowerCase();
  if (["true", "yes", "1", "active", "live", "streaming"].includes(streaming)) return true;
  if (["false", "no", "0", "inactive", "idle", "stopped"].includes(streaming)) return false;
  const status = stateValue(encoder.state, "Status").trim().toLowerCase();
  if (/\b(?:not|no)\s+(?:currently\s+)?(?:streaming|live)\b|\b(?:stopped|idle|ready|inactive|standby|offline)\b/.test(status)) return false;
  return /\b(?:streaming|live|on[ -]?air|broadcasting)\b/.test(status);
}
function readState(state: Record<string, unknown> | undefined) {
  if (!state) return "Unknown";
  return Object.entries(state).map(([key, value]) => `${key}: ${String(value)}`).join(" · ") || "Unknown";
}
function formatTimestamp(value: unknown) {
  const date = typeof value === "number" ? new Date(value > 1e12 ? value : value * 1000) : typeof value === "string" && value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "Time unavailable";
  return formatUserDate(date, true);
}
function toDateTimeLocal(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
