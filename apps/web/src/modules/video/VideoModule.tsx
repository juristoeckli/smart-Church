import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Activity, AlertTriangle, Check, ChevronDown, Clock3, Cloud, Download, Play, Radio, RefreshCw, Route, Save, Settings2, Shield, Square, Video, WandSparkles } from "lucide-react";
import "./video.css";

type Encoder = { id: string; name: string; ip?: string; model?: string; control?: string; state?: Record<string, unknown>; error?: string; streaming_settings?: Record<string, unknown> };
type Device = { id: string; name: string; type?: string; ip?: string; port?: number; ping?: string; power?: string; error?: string };
type VideoSite = { id: string; name: string; router_ip?: string; router_model?: string; router_status?: string; encoders: Encoder[]; devices: Device[] };
type RouteState = { connected?: boolean; error?: string; model?: string; inputs?: string[]; outputs?: string[]; routes?: number[]; locks?: string[] };
type ApiSnapshot = { error?: string; message?: string; available?: boolean; worker?: { state: string; error?: string | null }; status?: { sites?: VideoSite[]; videohubs?: Record<string, RouteState>; vpn?: { state?: string; error?: string | null } } };
type Preset = { id: string; name: string; revision?: string; routes?: number[] };
type EncoderProfile = { profile: string; configs?: { bitrate?: number }[] };
type EncoderSettings = { platform: string; server?: string; quality: string; url: string; protocol: string; has_key: boolean; profiles: EncoderProfile[]; status: string; presets: unknown; customizable_url: boolean };
type EncoderPresetDetails = { platform: string; servers: { server: string; url: string }[]; profiles: EncoderProfile[]; default_quality?: string; has_key: boolean; deletion?: { allowed?: boolean; reason?: string; filename?: string; services?: string[] } };
type EncoderSettingsForm = { preset: string; server: string; quality: string; protocol: string; url: string; key: string; passphrase: string };
type XmlService = { platform: string; customizable_url: boolean; servers: { server: string; url: string }[]; profiles: { profile: string }[] };
type XmlPreflight = { filename?: string; services?: string[]; replaces_existing?: boolean };

const tabs = ["Overview", "Routing", "Streaming", "XML tools"] as const;
type Tab = typeof tabs[number];

export function VideoModule({ departmentId, csrfToken, canManage }: { departmentId: string; csrfToken: string; canManage: boolean }) {
  const [tab, setTab] = useState<Tab>("Overview");
  const [snapshot, setSnapshot] = useState<ApiSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [selectedHub, setSelectedHub] = useState("");
  const [output, setOutput] = useState(0);
  const [input, setInput] = useState(0);
  const [history, setHistory] = useState<Record<string, unknown>[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [selectedEncoder, setSelectedEncoder] = useState("");
  const [xml, setXml] = useState("");
  const [xmlPreview, setXmlPreview] = useState<{ services?: XmlService[] } | null>(null);
  const [xmlPlan, setXmlPlan] = useState<XmlPreflight | null>(null);
  const [xmlPlatform, setXmlPlatform] = useState("");
  const [xmlServer, setXmlServer] = useState("");
  const [xmlQuality, setXmlQuality] = useState("");
  const [xmlCustomUrl, setXmlCustomUrl] = useState("");
  const [reviewedXml, setReviewedXml] = useState("");
  const [encoderSettings, setEncoderSettings] = useState<EncoderSettings | null>(null);
  const [presetDetails, setPresetDetails] = useState<EncoderPresetDetails | null>(null);
  const [settingsForm, setSettingsForm] = useState<EncoderSettingsForm>({ preset: "", server: "", quality: "", protocol: "srt", url: "", key: "", passphrase: "" });
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const xmlFileInput = useRef<HTMLInputElement>(null);

  const api = useCallback(async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
    const headers = new Headers(options.headers);
    headers.set("x-department-id", departmentId);
    if (options.method && options.method !== "GET") {
      headers.set("content-type", "application/json");
      headers.set("x-csrf-token", csrfToken);
    }
    const response = await fetch(path, { ...options, headers, cache: "no-store" });
    const result = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(result.error || `Video request failed (${response.status}).`);
    return result;
  }, [csrfToken, departmentId]);

  const refresh = useCallback(async () => {
    try {
      const result = await api<ApiSnapshot>("/api/video/status");
      setSnapshot(result);
      const sites = result.status?.sites ?? [];
      if (!selectedHub) {
        const first = sites.flatMap((site) => site.devices.filter((device) => device.type === "videohub").map((device) => `${site.id}|${device.id}`))[0];
        if (first) setSelectedHub(first);
      }
      const encoders = sites.flatMap((site) => site.encoders.map((encoder) => ({ ...encoder, key: `${site.id}|${encoder.id}` })));
      if (!selectedEncoder && encoders[0]) setSelectedEncoder(encoders[0].key);
      setNotice("");
    } catch (error) {
      setSnapshot({ available: false, worker: { state: "unavailable", error: error instanceof Error ? error.message : "Video service unavailable." } });
    } finally {
      setLoading(false);
    }
  }, [api, selectedEncoder, selectedHub]);

  useEffect(() => {
    setLoading(true);
    setSnapshot(null);
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

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

  const sites = snapshot?.status?.sites ?? [];
  const encoders = useMemo(() => sites.flatMap((site) => site.encoders.map((encoder) => ({ ...encoder, site, key: `${site.id}|${encoder.id}` }))), [sites]);
  const hubs = useMemo(() => sites.flatMap((site) => site.devices.filter((device) => device.type === "videohub").map((device) => ({ ...device, site, key: `${site.id}|${device.id}` }))), [sites]);
  const hub = hubs.find((device) => device.key === selectedHub) ?? hubs[0];
  const matrix = snapshot?.status?.videohubs?.[hub?.key ?? ""];
  const xmlEncoder = encoders.find((encoder) => encoder.key === selectedEncoder) ?? encoders[0];
  const encoderPresetNames = [...new Set([...presetNames(encoderSettings?.presets), ...(encoderSettings?.platform ? [encoderSettings.platform] : [])])];
  const selectedProfile = presetDetails?.profiles.find((profile) => profile.profile === settingsForm.quality);
  const bitrateMbit = selectedProfile?.configs?.[0]?.bitrate ? (selectedProfile.configs[0].bitrate / 1_000_000).toString() : "";
  const canApplySettings = Boolean(canManage && !busy && encoderSettings?.status === "Idle" && encoderSettings.platform === settingsForm.preset && encoderSettings.server === settingsForm.server);
  const ready = snapshot?.available === true && snapshot.worker?.state === "ready";

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
    try {
      const result = await api<unknown>(`/api/video/history?device=${encodeURIComponent(deviceId)}&site_id=${encodeURIComponent(siteId)}`);
      if (Array.isArray(result)) setHistory(result as Record<string, unknown>[]);
      else if (result && typeof result === "object" && "events" in result && Array.isArray((result as { events: unknown }).events)) setHistory((result as { events: Record<string, unknown>[] }).events);
      else setHistory([]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load routing history.");
    }
  }

  async function loadPresets(deviceId: string, siteId: string) {
    const result = await send("videohub-presets", { operation: "list", device: deviceId, site_id: siteId });
    if (Array.isArray(result)) setPresets(result as Preset[]);
    else if (result && typeof result === "object" && "presets" in result && Array.isArray((result as { presets: unknown }).presets)) setPresets((result as { presets: Preset[] }).presets);
  }

  async function changeRoute(selectedOutput = output, selectedInput = input) {
    if (!hub || !matrix?.routes) return;
    const oldInput = matrix.routes[selectedOutput];
    if (!Number.isInteger(oldInput)) return setNotice("Refresh the routing matrix before changing a route.");
    await send("videohub-route", { device: hub.id, site_id: hub.site.id, output: selectedOutput, input: selectedInput, expected_input: oldInput }, "Route changed and verified by the Videohub.");
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

  function renderSite(site: VideoSite, origin: boolean) {
    const gatewayStatus = site.router_status ?? "Status pending";
    return <section className={`video-site-card${origin ? " video-site-origin" : ""}`} key={site.id}>
      <header className="video-site-heading"><div><h2>{site.name}</h2><p>{origin ? "Streaming source" : "Remote location"} · {site.encoders.length + site.devices.length} connected assets</p></div><span className={`video-state ${gatewayStatus === "Reachable" ? "video-state-good" : ""}`}>{gatewayStatus}</span></header>
      <article className="video-gateway"><div className="video-equipment-icon"><Activity size={20} /></div><div className="video-equipment-copy"><strong>{site.router_model || "Network gateway"}</strong><small>{site.router_ip || "Gateway address not configured"}</small></div><span className={`video-state ${gatewayStatus === "Reachable" ? "video-state-good" : ""}`}>{gatewayStatus === "Reachable" ? "Reachable" : gatewayStatus}</span></article>
      {site.encoders.map((encoder) => {
        const settings = encoder.streaming_settings ?? {};
        const control = encoder.control ?? "Unknown";
        const encoderState = streamState(encoder);
        return <article className="video-encoder-card" key={`${site.id}|${encoder.id}`}>
          <EncoderHardware encoder={encoder} status={encoderState.label} />
          <div className="video-encoder-details">
            <div className="video-encoder-info"><strong>{encoder.name}</strong><code>{encoder.ip || "Address not configured"}</code><span className={`video-state ${control === "Connected" ? "video-state-good" : ""}`}>{control === "Connected" ? "Reachable" : control}</span><span className={`video-state ${encoderState.ready ? "video-state-ready" : ""}`}>{encoderState.label}</span><small>Target: {stringValue(settings.server_name) || stringValue(settings.platform) || "Not reported"}</small><small>{stateMetric(encoder.state, "Duration")} · {stateBitrate(encoder.state)} · Buffer {stateMetric(encoder.state, "Cache Used")}</small><small>Control: {control}</small></div>
            <div className="video-encoder-info"><strong>Streaming profile</strong><small>Profile: {stringValue(settings.platform) || "Not reported"}</small><small>Server name: {stringValue(settings.server_name) || "Not reported"}</small><code>Server address: {stringValue(settings.server) || "Not reported"}</code><small>Key: {stringValue(settings.key_masked) || "Not reported"}</small><small>Quality: {stringValue(settings.quality) || "Not reported"}</small></div>
          </div>
          {!origin && <div className="video-remote-restriction"><Shield size={14} /> Nur für Übertragungen zwischen den Pflegeheimen</div>}
          {canManage && origin && <div className="video-site-actions"><button type="button" className="video-small-button video-button-primary" disabled={busy || control !== "Connected"} onClick={() => void send("command", { site_id: site.id, encoder: encoder.id, action: "Start" }, `${encoder.name}: start accepted; waiting for device status.`)}><Play size={13} /> Start</button><button type="button" className="video-small-button" disabled={busy || control !== "Connected"} onClick={() => void send("command", { site_id: site.id, encoder: encoder.id, action: "Stop" }, `${encoder.name}: stop accepted; waiting for device status.`)}><Square size={12} /> Stop</button><button type="button" className="video-small-button" disabled={busy} onClick={() => { const key = `${site.id}|${encoder.id}`; const target = { ...encoder, site, key }; setSelectedEncoder(key); setSettingsOpen(true); void loadEncoderSettings(target); }}><Settings2 size={13} /> Settings</button></div>}
          {encoder.error && <small className="video-error-text">{encoder.error}</small>}
        </article>;
      })}
      {site.devices.map((device) => <article className="video-device-card" key={`${site.id}|${device.id}`}><div className="video-equipment-icon"><Settings2 size={19} /></div><div className="video-equipment-copy"><strong>{device.name}</strong><small>{device.type || "Equipment"} · {device.ip || "Address not configured"}</small>{device.power && <small>Power: {String(device.power)}</small>}</div><span className={`video-state ${device.ping === "Reachable" ? "video-state-good" : ""}`}>{device.ping ?? "Status pending"}</span>{device.error && <small className="video-error-text">{device.error}</small>}</article>)}
    </section>;
  }

  return <section className="video-module">
    <div className="video-heading">
      <div><span className="video-eyebrow">TECHNIK · VIDEO</span><h1>Video &amp; streaming</h1><p>Monitor encoders, inspect routing, and manage streaming equipment for this location.</p></div>
      <div className={`video-worker video-worker-${ready ? "ready" : "off"}`}><span />{workerLabel(workerState)}<button type="button" title="Refresh video status" onClick={() => { setLoading(true); void refresh(); }}><RefreshCw size={15} /></button></div>
    </div>

    {snapshot?.message && <div className="video-not-configured"><Shield size={20} /><div><strong>Video equipment is not configured</strong><p>{snapshot.message} The private configuration stays on the API server and is never sent to the browser. Add this location ID to the matching site in the private config: <code>{departmentId}</code></p></div></div>}
    {snapshot?.error && <div className="video-not-configured video-not-configured-error"><AlertTriangle size={20} /><div><strong>Video service unavailable</strong><p>{snapshot.error}</p></div></div>}
    {notice && <div className="video-notice" role="status">{notice}<button type="button" onClick={() => setNotice("")}>Dismiss</button></div>}

    <div className="video-tabs" role="tablist" aria-label="Video module">
      {tabs.map((name) => <button type="button" role="tab" aria-selected={tab === name} className={tab === name ? "video-tab video-tab-active" : "video-tab"} key={name} onClick={() => setTab(name)}>{name === "Overview" ? <Activity size={16} /> : name === "Routing" ? <Route size={16} /> : name === "Streaming" ? <Radio size={16} /> : <Settings2 size={16} />}{name}</button>)}
    </div>

    {!ready && !snapshot?.message && <div className="video-empty"><Video size={28} /><strong>{loading ? "Connecting to the video worker…" : "Video worker is unavailable"}</strong><p>{snapshot?.worker?.error ?? "The Core API starts this module in its own worker process."}</p></div>}

    {ready && tab === "Overview" && <>
      <div className="video-summary-grid"><Summary label="Encoders" value={encoders.length} note="Across assigned sites" icon={<Radio size={17} />} /><Summary label="Locations" value={sites.length} note="Equipment groups" icon={<Route size={17} />} /><Summary label="Connected" value={encoders.filter((encoder) => encoder.control === "Connected").length} note={`of ${encoders.length} encoder controls`} icon={<Activity size={17} />} /></div>
      <section className="video-panel"><div className="video-panel-heading"><div><h2>Equipment overview</h2><p>The equipment map, network links and streaming controls are on the Streaming tab.</p></div><button className="video-small-button video-button-primary" type="button" onClick={() => setTab("Streaming")}><Radio size={14} /> Open Streaming</button></div></section>
    </>}

    {ready && tab === "Streaming" && <>
      <div className="video-overview-banner"><div><span className="video-eyebrow">LIVE EQUIPMENT MAP</span><h2>Streaming locations</h2><p>Encoder and network status across the sites assigned to this location.</p></div><div className="video-overview-count"><strong>{encoders.filter((encoder) => encoder.control === "Connected").length}</strong><span>of {encoders.length} encoders connected</span></div></div>
      {sites.length ? <div className="video-network-board"><div className="video-board-origin">{primarySite && renderSite(primarySite, true)}</div><div className="video-board-internet"><span className="video-network-line" /><div className="video-internet-node"><Cloud size={40} strokeWidth={1.5} /><strong>Internet</strong><small>Network connection</small><span>Availability not monitored</span></div><span className="video-network-line" /></div><div className="video-board-remote">{remoteSites.map((site) => renderSite(site, false))}</div></div> : <Empty text="No equipment is configured for this location." />}
      <section className="video-panel"><div className="video-panel-heading"><div><h2>Streaming status</h2><p>Live encoder telemetry for assigned locations</p></div></div>{encoders.length ? <div className="video-stream-grid">{encoders.map((encoder) => { const settings = encoder.streaming_settings ?? {}; return <article className="video-stream-card" key={encoder.key}><div className="video-device-icon"><Radio size={18} /></div><h3>{encoder.name}</h3><p>{encoder.site.name} · {encoder.model ?? "Blackmagic Web Presenter"}</p><dl><div><dt>Stream</dt><dd>{readState(encoder.state)}</dd></div><div><dt>Control</dt><dd>{encoder.control ?? "Unknown"}</dd></div><div><dt>Platform</dt><dd>{stringValue(settings.platform) || "—"}</dd></div><div><dt>Quality</dt><dd>{stringValue(settings.quality) || "—"}</dd></div><div><dt>Last checked</dt><dd>{formatTimestamp(settings.checked_at)}</dd></div></dl>{typeof settings.error === "string" && <p className="video-error-text">{settings.error}</p>}</article>; })}</div> : <Empty text="No streaming encoders are configured." />}</section>
    </>}

    {ready && tab === "Routing" && <div className="video-routing-layout"><section className="video-panel"><div className="video-panel-heading"><div><h2>Videohub routing</h2><p>Change a route only when the current source still matches the displayed matrix.</p></div><button className="video-small-button" type="button" disabled={!hub || busy} onClick={() => hub && void refresh()}><RefreshCw size={14} /> Refresh</button></div>
      {hubs.length ? <><label className="video-field">Videohub<select value={hub?.key ?? ""} onChange={(event) => { setSelectedHub(event.target.value); setHistory([]); setPresets([]); }}><option value="">Select device</option>{hubs.map((device) => <option value={device.key} key={device.key}>{device.site.name} · {device.name}</option>)}</select></label>
        {matrix?.connected && matrix.inputs && matrix.outputs && matrix.routes ? <div className="video-matrix-wrap"><table className="video-matrix"><thead><tr><th>Output</th><th>Current input</th><th>Locked</th><th>Change to input</th><th></th></tr></thead><tbody>{matrix.outputs.map((label, index) => <tr key={index}><td><strong>{label}</strong><small>Output {index + 1}</small></td><td>{matrix.inputs?.[matrix.routes?.[index] ?? -1] ?? "Unknown"}</td><td>{matrix.locks?.[index] === "U" ? "Unlocked" : "Locked"}</td><td><select aria-label={`New input for ${label}`} value={index === output ? input : matrix.routes?.[index] ?? 0} onChange={(event) => { setOutput(index); setInput(Number(event.target.value)); }} disabled={matrix.locks?.[index] !== "U"}><option value={matrix.routes?.[index] ?? -1}>Keep current</option>{matrix.inputs?.map((name, i) => <option value={i} key={i}>{name}</option>)}</select></td><td><button type="button" className="video-small-button" disabled={busy || matrix.locks?.[index] !== "U" || (index === output && input === matrix.routes?.[index])} onClick={() => { const nextInput = index === output ? input : (matrix.routes?.[index] ?? 0); setOutput(index); setInput(nextInput); void changeRoute(index, nextInput); }}>Apply</button></td></tr>)}</tbody></table></div> : <Empty text={matrix?.error ?? "Waiting for a Videohub connection."} />}
        {hub && <div className="video-routing-tools"><button className="video-small-button" type="button" disabled={busy} onClick={() => void loadPresets(hub.id, hub.site.id)}><ChevronDown size={14} /> Load presets</button><button className="video-small-button" type="button" disabled={busy || !matrix?.connected} onClick={() => { const name = window.prompt("Name this routing preset"); if (name?.trim() && hub) void send("videohub-presets", { operation: "save", device: hub.id, site_id: hub.site.id, name: name.trim() }, "Routing preset saved."); }}><Save size={14} /> Save current</button><button className="video-small-button" type="button" disabled={!hub} onClick={() => hub && void loadHistory(hub.id, hub.site.id)}><Clock3 size={14} /> History</button></div>}
        {presets.map((preset) => <div className="video-preset-row" key={preset.id}><span><strong>{preset.name}</strong><small>Saved routing preset</small></span><button type="button" className="video-small-button" disabled={busy || !hub || !matrix?.routes} onClick={() => { if (!hub || !matrix?.routes || !window.confirm(`Recall “${preset.name}” on ${hub.name}? The Videohub will change routes.`)) return; if (!window.confirm(`Confirm recall of “${preset.name}” using the current routes?`)) return; void send("videohub-presets", { operation: "recall", device: hub.id, site_id: hub.site.id, id: preset.id, revision: preset.revision, expected_routes: matrix.routes, confirmed: true }, "Routing preset recalled and verified."); }}>Recall</button></div>)}
      </> : <Empty text="No Videohub is configured for this location." />}</section>
      <section className="video-panel video-history-panel"><div className="video-panel-heading"><div><h2>Routing history</h2><p>Observed route changes and verified actions</p></div></div>{history.length ? history.slice(0, 40).map((entry, index) => { const changeCount = Array.isArray(entry.changes) ? entry.changes.length : 0; return <div className="video-history-row" key={String(entry.id ?? index)}><Clock3 size={14} /><span><strong>{String(entry.kind ?? "Routing event")} · {changeCount} route changes</strong><small>{formatTimestamp(entry.time)} · {String(entry.user ?? "Observed")}</small></span></div>; }) : <Empty text="Load history to view changes observed by the worker." />}</section></div>}

    {ready && tab === "XML tools" && <section className="video-panel video-settings-panel">
      <div className="video-panel-heading"><div><h2>Streaming profile XML tools</h2><p>Create, validate, import, export and distribute encoder profiles.</p></div><button type="button" className="video-small-button" disabled={busy || !xmlEncoder || !canManage} onClick={() => void exportXml(includeSecrets)}><Download size={14} /> Export active XML</button></div>
      {!xmlEncoder ? <Empty text="No streaming encoder is configured for this location." /> : <>
        <label className="video-field">Encoder<select value={xmlEncoder.key} onChange={(event) => { setSelectedEncoder(event.target.value); setXmlPreview(null); setXmlPlan(null); setReviewedXml(""); }}><option value="">Select encoder</option>{encoders.map((encoder) => <option value={encoder.key} key={encoder.key}>{encoder.site.name} · {encoder.name} · {encoder.ip || "No address"}</option>)}</select></label>
        <div className="video-settings-identity"><strong>{xmlEncoder.site.name} · {xmlEncoder.name}</strong><code>{xmlEncoder.ip || "Address not configured"}</code></div>
        <fieldset className="video-settings-box"><legend>Import / Export</legend>
          <input ref={xmlFileInput} className="video-hidden-file" type="file" accept=".xml,text/xml,application/xml" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (!file) return; if (file.size > 262144) return setNotice("Choose an XML file smaller than 256 KB."); void file.text().then((source) => void previewXml(source)).catch(() => setNotice("Could not read that XML file.")); }} />
          <div className="video-settings-toolbar"><button type="button" className="video-small-button" disabled={busy || !canManage} onClick={() => xmlFileInput.current?.click()}>Import XML…</button><button type="button" className="video-small-button" disabled={busy || !canManage} onClick={() => void exportXml(includeSecrets)}>Export XML…</button></div>
          <label className="video-settings-check"><input type="checkbox" checked={includeSecrets} onChange={(event) => setIncludeSecrets(event.target.checked)} /> Include stream key and access credentials in export</label>
          <p className="video-settings-help">Edit or create an XML profile below, or import an existing file. Validate it, choose a service/server/quality and upload it to the selected encoder. SRT passphrases are never exported.</p>
          <label className="video-field video-xml-editor-label">Streaming profiles XML<textarea className="video-xml-editor" value={xml} onChange={(event) => { setXml(event.target.value); setXmlPreview(null); setXmlPlan(null); setReviewedXml(""); }} placeholder="Paste or create a Blackmagic Streaming XML profile…" spellCheck={false} /></label>
          <div className="video-settings-toolbar"><button type="button" className="video-small-button video-button-primary" disabled={busy || !canManage || !xml.trim()} onClick={() => void previewXml()}>Validate and review XML</button><button type="button" className="video-small-button" disabled={!xml} onClick={() => { setXml(""); setXmlPreview(null); setXmlPlan(null); setReviewedXml(""); }}>Clear editor</button></div>
          {xmlPreview && <div className="video-settings-xml-review"><strong><Check size={15} /> XML valid · {xmlPlan?.filename}{xmlPlan?.replaces_existing ? " will be replaced" : " will be created"}</strong>
            <div className="video-settings-fields video-settings-xml-fields">
              <label className="video-field">Service<select value={xmlPlatform} onChange={(event) => { const name = event.target.value; const service = xmlPreview.services?.find((item) => item.platform === name); setXmlPlatform(name); setXmlServer(service?.servers[0]?.server ?? (service?.customizable_url ? "Custom" : "")); setXmlQuality(service?.profiles[0]?.profile ?? ""); setXmlCustomUrl(service?.servers[0]?.url ?? ""); }}><option value="">Select service</option>{xmlPreview.services?.map((service) => <option value={service.platform} key={service.platform}>{service.platform}</option>)}</select></label>
              <label className="video-field">Server<select value={xmlServer} onChange={(event) => { setXmlServer(event.target.value); const service = xmlPreview.services?.find((item) => item.platform === xmlPlatform); setXmlCustomUrl(service?.servers.find((item) => item.server === event.target.value)?.url ?? ""); }}><option value="">Select server</option>{xmlPreview.services?.find((service) => service.platform === xmlPlatform)?.servers.map((server) => <option value={server.server} key={server.server}>{server.server}</option>)}{xmlPreview.services?.find((service) => service.platform === xmlPlatform)?.customizable_url && <option value="Custom">Custom</option>}</select></label>
              <label className="video-field">Quality profile<select value={xmlQuality} onChange={(event) => setXmlQuality(event.target.value)}><option value="">Select quality</option>{xmlPreview.services?.find((service) => service.platform === xmlPlatform)?.profiles.map((profile) => <option value={profile.profile} key={profile.profile}>{profile.profile}</option>)}</select></label>
            </div>
            {xmlPreview.services?.find((service) => service.platform === xmlPlatform)?.customizable_url && <label className="video-field">Custom streaming URL<input value={xmlCustomUrl} onChange={(event) => setXmlCustomUrl(event.target.value)} placeholder="rtmp:// or srt://" /></label>}
            {canManage && <button type="button" className="video-small-button video-button-primary" disabled={busy || reviewedXml !== xml || !xmlPlatform || !xmlQuality || !xmlServer} onClick={() => void applyXml()}>Review and apply XML</button>}
          </div>}
        </fieldset>
      </>}
    </section>}

    {settingsOpen && <div className="video-settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { setSettingsForm((current) => ({ ...current, key: "", passphrase: "" })); setSettingsOpen(false); } }}>
      <section className="video-settings-modal" role="dialog" aria-modal="true" aria-labelledby="video-settings-title">
        <header className="video-settings-modal-heading"><div><span className="video-eyebrow">ENCODER STREAMING</span><h2 id="video-settings-title">Encoder settings</h2><p>{xmlEncoder ? `${xmlEncoder.site.name} · ${xmlEncoder.name} · ${xmlEncoder.ip || "Address not configured"}` : "Loading encoder…"}</p></div><button type="button" className="video-settings-close" aria-label="Close settings" onClick={() => { setSettingsForm((current) => ({ ...current, key: "", passphrase: "" })); setSettingsOpen(false); }}>×</button></header>
        {notice && <p className="video-settings-modal-notice" role="status">{notice}</p>}
        {settingsLoading && !encoderSettings ? <Empty text="Loading presets and settings from the encoder…" /> : !encoderSettings ? <Empty text="Could not load settings from this encoder." /> : <div className="video-settings-panel">
          <div className="video-settings-identity"><span className={`video-state ${encoderSettings.status === "Idle" ? "video-state-good" : ""}`}>Stream: {encoderSettings.status}</span></div>
          <fieldset className="video-settings-box"><legend>Encoder presets</legend>
            <label className="video-field">Preset<select value={settingsForm.preset} disabled={settingsLoading} onChange={(event) => { const value = event.target.value; setSettingsForm((current) => ({ ...current, preset: value })); void loadEncoderPreset(value); }}><option value="">Select a preset…</option>{encoderPresetNames.map((name) => <option value={name} key={name}>{name}</option>)}</select></label>
            <label className="video-field">Server<select value={settingsForm.server} disabled={settingsLoading || (!presetDetails?.servers.length && settingsForm.server !== "Custom")} onChange={(event) => { const server = presetDetails?.servers.find((item) => item.server === event.target.value); setSettingsForm((current) => ({ ...current, server: event.target.value, url: server?.url ?? current.url, protocol: schemeOf(server?.url) || current.protocol })); }}><option value="">Select server…</option>{presetDetails?.servers.map((server) => <option value={server.server} key={server.server}>{server.server}</option>)}{encoderSettings.customizable_url && settingsForm.server === "Custom" && <option value="Custom">Custom server URL</option>}</select></label>
            <label className="video-field">Preset quality<select value={settingsForm.quality} disabled={settingsLoading || !presetDetails?.profiles.length} onChange={(event) => setSettingsForm((current) => ({ ...current, quality: event.target.value }))}><option value="">Select quality…</option>{presetDetails?.profiles.map((profile) => <option value={profile.profile} key={profile.profile}>{profile.profile}</option>)}</select></label>
            {presetDetails?.deletion?.reason && <p className="video-settings-help">{presetDetails.deletion.reason}</p>}
            <div className="video-settings-toolbar"><button type="button" className="video-small-button video-button-primary" disabled={!canManage || busy || settingsLoading || encoderSettings.status !== "Idle" || !settingsForm.preset || !settingsForm.server || settingsForm.server === "Custom" || !settingsForm.quality} onClick={() => void applyEncoderPreset()}>Apply preset</button><button type="button" className="video-small-button video-button-danger" disabled={!canManage || busy || settingsLoading || encoderSettings.status !== "Idle" || !presetDetails?.deletion?.allowed} onClick={() => void deleteEncoderPreset()}>Delete preset…</button></div>
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
          {!canManage && <p className="video-settings-help">You have view access only. Ask a site administrator to change encoder settings.</p>}
          <div className="video-settings-actions"><button type="button" className="video-small-button" onClick={() => { setSettingsForm((current) => ({ ...current, key: "", passphrase: "" })); setSettingsOpen(false); }}>Cancel</button><button type="button" className="video-small-button video-button-primary" disabled={!canApplySettings || !settingsForm.quality} onClick={() => void applyEncoderSettings()}>Apply settings</button></div>
        </div>}
      </section>
    </div>}

    <footer className="video-footer"><span><Shield size={13} /> Equipment access is scoped to the selected location</span><span>Last refresh: {snapshot?.status ? new Date().toLocaleTimeString() : "—"}</span></footer>
  </section>;
}

function Summary({ label, value, note, icon }: { label: string; value: number; note: string; icon: ReactNode }) {
  return <article className="video-summary-card"><span className="video-summary-icon">{icon}</span><div><small>{label}</small><strong>{value}</strong><span>{note}</span></div></article>;
}

function EncoderHardware({ encoder, status }: { encoder: Encoder; status: string }) {
  const connected = encoder.control === "Connected";
  const ready = status === "BEREIT";
  const live = status === "LIVE";
  const reportedStatus = stateValue(encoder.state, "Status");
  const stateHasProblem = Object.entries(encoder.state ?? {}).some(([key, value]) => /error|fault|warning|problem/i.test(key) && value != null && !/^(?:\s*|none|false|0|ok|no)$/i.test(String(value).trim()));
  const streamProblem = live && (Boolean(encoder.error) || stateHasProblem || /error|fail|warn|problem|lost|drop/i.test(reportedStatus));
  const onAirFlash = streamProblem ? "video-onair-flash" : undefined;
  const onAirTextClass = live ? `video-onair-lit${streamProblem ? " video-onair-flash" : ""}` : undefined;
  const statusColor = live ? "#f51d34" : ready ? "#edf1f4" : "#f0b64c";
  const telemetryLed = !connected ? "#e9a536" : live ? "#f51d34" : "#64db86";
  return <svg className="video-encoder-hardware" viewBox="0 0 1500 500" role="img" aria-label={`${encoder.model || "Blackmagic Web Presenter Ultra HD"} illustrated front panel, ${status}`}>
    <rect x="3" y="5" width="1494" height="490" rx="20" fill="#111214" stroke="#08090a" strokeWidth="5" />
    <rect x="8" y="10" width="1484" height="480" rx="16" fill="#1c1e21" stroke="#45484d" strokeWidth="3" />
    <path d="M20 24h1460M20 476h1460" stroke="#292c30" strokeWidth="2" opacity=".8" />
    <text x="37" y="107" fill="#f4f4f5" fontFamily="Arial, sans-serif" fontSize="38" fontStyle="italic" fontWeight="700">ULTRA</text>
    <text x="163" y="107" fill="#ff9e14" fontFamily="Arial, sans-serif" fontSize="38" fontStyle="italic" fontWeight="700">HD</text>
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
    <text x="948" y="387" fill="#7693a2" fontFamily="Arial, sans-serif" fontSize="17" textAnchor="middle">{stringValue(encoder.ip) || "STATUS MONITOR"}</text>
    <text x="1237" y="105" fill="#e0e2e5" fontFamily="Arial, sans-serif" fontSize="23" fontWeight="700" letterSpacing="-.6">Blackmagic<tspan fill="#c5c8cc" fontWeight="400">design</tspan></text>
    <circle cx="1379" cy="272" r="99" fill="#0b0c0e" stroke="#181a1c" strokeWidth="7" />
    <circle cx="1379" cy="272" r="80" fill="#2d3034" stroke="#55585d" strokeWidth="5" />
    <circle cx="1379" cy="272" r="69" fill="#303337" stroke="#3b3e42" strokeWidth="2" />
    <text x="1378" y="408" fill="#999da2" fontFamily="Arial, sans-serif" fontSize="13" textAnchor="middle">STREAMING ENCODER</text>
  </svg>;
}


function Empty({ text }: { text: string }) { return <div className="video-empty video-empty-small"><Video size={20} /><p>{text}</p></div>; }
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
  if (/stream|live|on.?air/i.test(status)) return { label: "LIVE", ready: false };
  if (!status || /idle|stop|ready/i.test(status)) return { label: "BEREIT", ready: true };
  return { label: status.toLocaleUpperCase(), ready: false };
}
function readState(state: Record<string, unknown> | undefined) {
  if (!state) return "Unknown";
  return Object.entries(state).map(([key, value]) => `${key}: ${String(value)}`).join(" · ") || "Unknown";
}
function formatTimestamp(value: unknown) {
  if (typeof value === "number") return new Date(value > 1e12 ? value : value * 1000).toLocaleString();
  if (typeof value === "string" && value) return new Date(value).toLocaleString();
  return "Time unavailable";
}
