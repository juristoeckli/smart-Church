import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Activity, AlertTriangle, Check, ChevronDown, Clock3, Cloud, Download, Play, Radio, RefreshCw, Route, Save, Settings2, Shield, Square, Video, WandSparkles } from "lucide-react";
import "./video.css";

type Encoder = { id: string; name: string; ip?: string; model?: string; control?: string; state?: Record<string, unknown>; error?: string; streaming_settings?: Record<string, unknown> };
type Device = { id: string; name: string; type?: string; ip?: string; port?: number; ping?: string; power?: string; error?: string };
type VideoSite = { id: string; name: string; router_ip?: string; router_model?: string; router_status?: string; encoders: Encoder[]; devices: Device[] };
type RouteState = { connected?: boolean; error?: string; model?: string; inputs?: string[]; outputs?: string[]; routes?: number[]; locks?: string[] };
type ApiSnapshot = { error?: string; message?: string; available?: boolean; worker?: { state: string; error?: string | null }; status?: { sites?: VideoSite[]; videohubs?: Record<string, RouteState>; vpn?: { state?: string; error?: string | null } } };
type Preset = { id: string; name: string; revision?: string; routes?: number[] };
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

  const sites = snapshot?.status?.sites ?? [];
  const encoders = useMemo(() => sites.flatMap((site) => site.encoders.map((encoder) => ({ ...encoder, site, key: `${site.id}|${encoder.id}` }))), [sites]);
  const hubs = useMemo(() => sites.flatMap((site) => site.devices.filter((device) => device.type === "videohub").map((device) => ({ ...device, site, key: `${site.id}|${device.id}` }))), [sites]);
  const hub = hubs.find((device) => device.key === selectedHub) ?? hubs[0];
  const matrix = snapshot?.status?.videohubs?.[hub?.key ?? ""];
  const xmlEncoder = encoders.find((encoder) => encoder.key === selectedEncoder) ?? encoders[0];
  const ready = snapshot?.available === true && snapshot.worker?.state === "ready";

  async function send(operation: string, data: Record<string, unknown>, successMessage?: string) {
    setBusy(true);
    try {
      const result = await api<unknown>(`/api/video/${operation}`, { method: "POST", body: JSON.stringify(data) });
      setNotice(successMessage ?? messageOf(result) ?? "Video operation completed.");
      await refresh();
      return result;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Video operation failed.");
      return null;
    } finally {
      setBusy(false);
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
    const result = await send("encoder-settings", { encoder: xmlEncoder.id, site_id: xmlEncoder.site.id, operation: "export", settings: { include_secrets: includeSecrets } });
    if (result && typeof result === "object" && "xml" in result && typeof result.xml === "string") {
      setXml(result.xml);
      setXmlPreview(null);
      setReviewedXml("");
    }
  }

  async function previewXml() {
    if (!xmlEncoder || !xml.trim()) return setNotice("Paste or load a streaming XML file first.");
    setBusy(true);
    try {
      const [preview, plan] = await Promise.all([
        api<{ services?: XmlService[] }>("/api/video/encoder-settings", { method: "POST", body: JSON.stringify({ encoder: xmlEncoder.id, site_id: xmlEncoder.site.id, operation: "xml-preview", settings: { xml } }) }),
        api<XmlPreflight>("/api/video/encoder-settings", { method: "POST", body: JSON.stringify({ encoder: xmlEncoder.id, site_id: xmlEncoder.site.id, operation: "xml-target", settings: { xml } }) }),
      ]);
      setXmlPreview(preview);
      setXmlPlan(plan);
      const service = preview.services?.[0];
      setXmlPlatform(service?.platform ?? "");
      setXmlServer(service?.servers[0]?.server ?? (service?.customizable_url ? "Custom" : ""));
      setXmlQuality(service?.profiles[0]?.profile ?? "");
      setXmlCustomUrl(service?.servers[0]?.url ?? "");
      setReviewedXml(xml);
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
          {canManage && origin && <div className="video-site-actions"><button type="button" className="video-small-button video-button-primary" disabled={busy || control !== "Connected"} onClick={() => void send("command", { site_id: site.id, encoder: encoder.id, action: "Start" }, `${encoder.name}: start accepted; waiting for device status.`)}><Play size={13} /> Start</button><button type="button" className="video-small-button" disabled={busy || control !== "Connected"} onClick={() => void send("command", { site_id: site.id, encoder: encoder.id, action: "Stop" }, `${encoder.name}: stop accepted; waiting for device status.`)}><Square size={12} /> Stop</button><button type="button" className="video-small-button" disabled={busy} onClick={() => { setSelectedEncoder(`${site.id}|${encoder.id}`); setTab("XML tools"); }}><Settings2 size={13} /> Settings</button></div>}
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

    {ready && tab === "XML tools" && <section className="video-panel"><div className="video-panel-heading"><div><h2>Blackmagic streaming XML</h2><p>Review and validate XML before applying it to an encoder.</p></div></div>{encoders.length ? <><label className="video-field">Encoder<select value={xmlEncoder?.key ?? ""} onChange={(event) => { setSelectedEncoder(event.target.value); setXmlPreview(null); setReviewedXml(""); }}><option value="">Select encoder</option>{encoders.map((encoder) => <option value={encoder.key} key={encoder.key}>{encoder.site.name} · {encoder.name}</option>)}</select></label>
      <label className="video-field">Streaming XML<textarea rows={18} maxLength={262144} spellCheck={false} value={xml} onChange={(event) => { setXml(event.target.value); setXmlPreview(null); setReviewedXml(""); }} placeholder="Load current encoder settings or paste a Blackmagic streaming XML document." /></label>
      <div className="video-routing-tools"><button type="button" className="video-small-button" disabled={busy || !xmlEncoder} onClick={() => void exportXml(false)}><Download size={14} /> Load current settings</button><button type="button" className="video-small-button" disabled={busy || !xmlEncoder} onClick={() => void exportXml(true)}><Download size={14} /> Include secrets</button><button type="button" className="video-small-button" disabled={busy || !xmlEncoder || !xml.trim()} onClick={() => void previewXml()}><WandSparkles size={14} /> Validate &amp; review</button></div>
      {xmlPreview && <div className="video-xml-preview"><strong><Check size={16} /> XML is valid · {xmlPlan?.filename}{xmlPlan?.replaces_existing ? " will be replaced" : " will be created"}</strong><div className="video-xml-fields"><label className="video-field">Service<select value={xmlPlatform} onChange={(event) => { const name = event.target.value; const service = xmlPreview.services?.find((item) => item.platform === name); setXmlPlatform(name); setXmlServer(service?.servers[0]?.server ?? (service?.customizable_url ? "Custom" : "")); setXmlQuality(service?.profiles[0]?.profile ?? ""); setXmlCustomUrl(service?.servers[0]?.url ?? ""); }}><option value="">Select service</option>{xmlPreview.services?.map((service) => <option value={service.platform} key={service.platform}>{service.platform}</option>)}</select></label><label className="video-field">Server<select value={xmlServer} onChange={(event) => { setXmlServer(event.target.value); const service = xmlPreview.services?.find((item) => item.platform === xmlPlatform); setXmlCustomUrl(service?.servers.find((server) => server.server === event.target.value)?.url ?? ""); }}><option value="">Select server</option>{xmlPreview.services?.find((service) => service.platform === xmlPlatform)?.servers.map((server) => <option value={server.server} key={server.server}>{server.server}</option>)}{xmlPreview.services?.find((service) => service.platform === xmlPlatform)?.customizable_url && <option value="Custom">Custom</option>}</select></label><label className="video-field">Quality profile<select value={xmlQuality} onChange={(event) => setXmlQuality(event.target.value)}><option value="">Select quality</option>{xmlPreview.services?.find((service) => service.platform === xmlPlatform)?.profiles.map((profile) => <option value={profile.profile} key={profile.profile}>{profile.profile}</option>)}</select></label></div>{xmlPreview.services?.find((service) => service.platform === xmlPlatform)?.customizable_url && <label className="video-field">Custom streaming URL<input value={xmlCustomUrl} onChange={(event) => setXmlCustomUrl(event.target.value)} placeholder="rtmp:// or srt://" /></label>}{canManage && <button type="button" className="video-small-button video-button-primary" disabled={busy || reviewedXml !== xml || !xmlPlatform || !xmlQuality || !xmlServer} onClick={() => void applyXml()}>Review and apply to encoder</button>}</div>}
      <p className="video-security-note"><Shield size={14} /> Stream keys and encoder credentials are omitted unless you explicitly load settings with secrets.</p>
    </> : <Empty text="No streaming encoders are configured for this location." />}</section>}

    <footer className="video-footer"><span><Shield size={13} /> Equipment access is scoped to the selected location</span><span>Last refresh: {snapshot?.status ? new Date().toLocaleTimeString() : "—"}</span></footer>
  </section>;
}

function Summary({ label, value, note, icon }: { label: string; value: number; note: string; icon: ReactNode }) {
  return <article className="video-summary-card"><span className="video-summary-icon">{icon}</span><div><small>{label}</small><strong>{value}</strong><span>{note}</span></div></article>;
}

function EncoderHardware({ encoder, status }: { encoder: Encoder; status: string }) {
  return <div className="video-encoder-photo" role="img" aria-label={`${encoder.model || "Blackmagic Web Presenter Ultra HD"} product photo; current status ${status}`}>
    <img src="/video/blackmagic-web-presenter-ultra-hd.png" alt="" />
  </div>;
}


function Empty({ text }: { text: string }) { return <div className="video-empty video-empty-small"><Video size={20} /><p>{text}</p></div>; }
function workerLabel(value: string) { return value === "ready" ? "Worker ready" : value === "unconfigured" ? "Not configured" : value === "failed" ? "Worker failed" : value === "backoff" ? "Worker restarting" : value === "starting" ? "Worker starting" : "Worker unavailable"; }
function messageOf(value: unknown) { return value && typeof value === "object" && "message" in value && typeof value.message === "string" ? value.message : null; }
function stringValue(value: unknown) { return typeof value === "string" ? value : ""; }
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
