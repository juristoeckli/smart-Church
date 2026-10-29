import { useEffect, useMemo, useState } from "react";
import { Check, RotateCcw } from "lucide-react";
import type { ModuleSettingsContext } from "../../module-registry";
import { copyIpText } from "./IpAddress";
import "./video-settings.css";

type Address = { siteId: string; siteName: string; targetType: "router" | "encoder" | "device"; targetId: string; targetName: string; ip: string };
type SettingsResponse = { defaults: Address[]; addresses: Address[]; error?: string };
type YoutubeClientResponse = { clientId?: string; clientSecretConfigured?: boolean; tokenKeyConfigured?: boolean; error?: string };

function key(address: Pick<Address, "siteId" | "targetType" | "targetId">) {
  return `${address.siteId}\u0000${address.targetType}\u0000${address.targetId}`;
}

async function readResponse(response: Response): Promise<SettingsResponse> {
  const body = await response.json() as SettingsResponse;
  if (!response.ok) throw new Error(body.error ?? "Could not load Video device settings.");
  return body;
}

async function readYoutubeClientResponse(response: Response): Promise<YoutubeClientResponse> {
  const body = await response.json() as YoutubeClientResponse;
  if (!response.ok) throw new Error(body.error ?? "Could not load the YouTube client setting.");
  return body;
}

export function VideoSettings({ departmentId, csrfToken, departments }: ModuleSettingsContext) {
  const [defaults, setDefaults] = useState<Address[]>([]);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [savedAddresses, setSavedAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [feedbackError, setFeedbackError] = useState(false);
  const [youtubeClientId, setYoutubeClientId] = useState("");
  const [savedYoutubeClientId, setSavedYoutubeClientId] = useState("");
  const [youtubeClientSecret, setYoutubeClientSecret] = useState("");
  const [youtubeClientSecretConfigured, setYoutubeClientSecretConfigured] = useState(false);
  const [youtubeTokenKeyConfigured, setYoutubeTokenKeyConfigured] = useState(false);
  const [youtubeClientLoading, setYoutubeClientLoading] = useState(false);
  const [youtubeClientSaving, setYoutubeClientSaving] = useState(false);
  const [youtubeClientFeedback, setYoutubeClientFeedback] = useState("");
  const [youtubeClientFeedbackError, setYoutubeClientFeedbackError] = useState(false);
  const location = departments.find((department) => department.id === departmentId)?.location ?? "this location";
  const changed = useMemo(() => JSON.stringify(addresses) !== JSON.stringify(savedAddresses), [addresses, savedAddresses]);
  const differsFromDefaults = useMemo(() => addresses.some((item) => item.ip !== defaults.find((address) => key(address) === key(item))?.ip), [addresses, defaults]);

  useEffect(() => {
    if (!departmentId) { setDefaults([]); setAddresses([]); return; }
    const controller = new AbortController();
    setLoading(true);
    setYoutubeClientLoading(true);
    setFeedback("");
    setYoutubeClientFeedback("");
    void fetch("/api/video/settings/device-addresses", { headers: { "x-department-id": departmentId }, signal: controller.signal })
      .then(readResponse)
      .then((result) => { setDefaults(result.defaults); setAddresses(result.addresses); setSavedAddresses(result.addresses); })
      .catch((error: unknown) => { if (!controller.signal.aborted) { setFeedback(error instanceof Error ? error.message : "Could not load Video device settings."); setFeedbackError(true); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    void fetch("/api/video/settings/youtube-client", { headers: { "x-department-id": departmentId }, signal: controller.signal })
      .then(readYoutubeClientResponse)
      .then((result) => { const value = result.clientId ?? ""; setYoutubeClientId(value); setSavedYoutubeClientId(value); setYoutubeClientSecretConfigured(Boolean(result.clientSecretConfigured)); setYoutubeTokenKeyConfigured(Boolean(result.tokenKeyConfigured)); })
      .catch((error: unknown) => { if (!controller.signal.aborted) { setYoutubeClientFeedback(error instanceof Error ? error.message : "Could not load the YouTube client setting."); setYoutubeClientFeedbackError(true); } })
      .finally(() => { if (!controller.signal.aborted) setYoutubeClientLoading(false); });
    return () => controller.abort();
  }, [departmentId]);

  function edit(address: Address, ip: string) {
    setAddresses((current) => current.map((item) => key(item) === key(address) ? { ...item, ip } : item));
    setFeedback("");
  }

  function resetDefaults() {
    setAddresses(defaults.map((item) => ({ ...item })));
    setFeedback("");
  }

  async function save() {
    setSaving(true);
    setFeedback("");
    try {
      const response = await fetch("/api/video/settings/device-addresses", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken },
        body: JSON.stringify({ addresses: addresses.map(({ siteId, targetType, targetId, ip }) => ({ siteId, targetType, targetId, ip: ip.trim() })) }),
      });
      const result = await readResponse(response);
      setDefaults(result.defaults);
      setAddresses(result.addresses);
      setSavedAddresses(result.addresses);
      setFeedback("Video device addresses saved.");
      setFeedbackError(false);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not save Video device addresses.");
      setFeedbackError(true);
    } finally { setSaving(false); }
  }

  async function saveYoutubeClient() {
    setYoutubeClientSaving(true);
    setYoutubeClientFeedback("");
    try {
      const response = await fetch("/api/video/settings/youtube-client", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken },
        body: JSON.stringify({ clientId: youtubeClientId.trim(), clientSecret: youtubeClientSecret }),
      });
      const result = await readYoutubeClientResponse(response);
      const value = result.clientId ?? "";
      setYoutubeClientId(value);
      setSavedYoutubeClientId(value);
      setYoutubeClientSecret("");
      setYoutubeClientSecretConfigured(Boolean(result.clientSecretConfigured));
      setYoutubeClientFeedback("YouTube OAuth client settings saved.");
      setYoutubeClientFeedbackError(false);
    } catch (error) {
      setYoutubeClientFeedback(error instanceof Error ? error.message : "Could not save the YouTube client ID.");
      setYoutubeClientFeedbackError(true);
    } finally { setYoutubeClientSaving(false); }
  }

  const siteOrder = ["GfC Steffisburg", "Provivatis Seewinkel", "Provivatis Sonnenhof"];
  const sites = [...new Set(addresses.map((address) => address.siteId))].sort((left, right) => {
    const leftName = addresses.find((address) => address.siteId === left)?.siteName ?? left;
    const rightName = addresses.find((address) => address.siteId === right)?.siteName ?? right;
    const leftIndex = siteOrder.indexOf(leftName);
    const rightIndex = siteOrder.indexOf(rightName);
    return (leftIndex < 0 ? siteOrder.length : leftIndex) - (rightIndex < 0 ? siteOrder.length : rightIndex) || leftName.localeCompare(rightName);
  });
  const youtubeClientSettingsChanged = youtubeClientId.trim() !== savedYoutubeClientId || Boolean(youtubeClientSecret.trim());
  return <section className="video-settings" aria-labelledby="video-device-settings-title">
    <div className="server-admin-panel-heading"><h3 id="video-device-settings-title">Video device addresses</h3><p>Configure the router, encoders, and devices used by Video &amp; streaming for {location}. Existing addresses are loaded as the defaults.</p></div>
    {loading ? <p className="video-settings-message">Loading device addresses…</p> : addresses.length === 0 ? <p className="video-settings-message">No Video devices are configured for this location.</p> : <>
      <div className="video-settings-sites">{sites.map((siteId) => {
        const siteAddresses = addresses.filter((address) => address.siteId === siteId);
        return <section className="video-settings-site" key={siteId}><h4>{siteAddresses[0]?.siteName ?? siteId}</h4><div className="video-settings-address-grid">{siteAddresses.map((address) => <label key={key(address)}>{address.targetName}<span>{address.targetType === "router" ? "Router" : address.targetType === "encoder" ? "Encoder" : "Device"}</span><input aria-label={`${siteAddresses[0]?.siteName ?? siteId} ${address.targetName} IP address`} title="Double-click to copy this IP address" value={address.ip} onDoubleClick={(event) => { event.preventDefault(); void copyIpText(address.ip).then((copied) => setFeedback(copied ? "IP address copied." : "Could not copy IP address.")); }} onChange={(event) => edit(address, event.target.value)} maxLength={45} placeholder="Leave blank if not configured" /></label>)}</div></section>;
      })}</div>
      <p className="video-settings-note">USB converters use the IP address of their Silex DS-700 server and do not need a separate address.</p>
      <div className="video-settings-actions"><button className="button button-secondary" type="button" onClick={resetDefaults} disabled={!differsFromDefaults || saving}><RotateCcw size={15} />Reset to defaults</button><button className="button button-primary" type="button" onClick={() => void save()} disabled={saving || loading || !changed}><Check size={15} />{saving ? "Saving…" : "Save addresses"}</button></div>
    </>}
    {feedback && <p className={`video-settings-feedback${feedbackError ? " is-error" : ""}`} role="status">{feedback}</p>}
    <section className="video-settings-site video-settings-youtube-client" aria-labelledby="video-youtube-client-title">
      <h4 id="video-youtube-client-title">YouTube OAuth client</h4>
      <p>Set the OAuth Client ID and Client Secret from Google Cloud. The secret is encrypted before it is stored. The module’s token encryption key stays in the protected API environment.</p>
      {youtubeClientLoading ? <p className="video-settings-message">Loading YouTube client settings…</p> : <>
        <label>OAuth Client ID<input aria-label="YouTube OAuth Client ID" value={youtubeClientId} onChange={(event) => { setYoutubeClientId(event.target.value); setYoutubeClientFeedback(""); }} autoComplete="off" spellCheck={false} placeholder="1234567890-…apps.googleusercontent.com" maxLength={512} /></label>
        <label>OAuth Client Secret<input aria-label="YouTube OAuth Client Secret" type="password" value={youtubeClientSecret} onChange={(event) => { setYoutubeClientSecret(event.target.value); setYoutubeClientFeedback(""); }} autoComplete="new-password" spellCheck={false} placeholder={youtubeClientSecretConfigured ? "Saved encrypted · enter a new value to replace" : "Paste the Client Secret from Google Cloud"} maxLength={512} disabled={!youtubeTokenKeyConfigured} /></label>
        {!youtubeTokenKeyConfigured && <p className="video-settings-feedback is-error">Set the module token encryption key in the API environment before saving a client secret.</p>}
        {youtubeClientSecretConfigured && <p className="video-settings-message">A client secret is saved encrypted. Leave the field blank to keep it.</p>}
      </>}
      <div className="video-settings-actions"><button className="button button-primary" type="button" onClick={() => void saveYoutubeClient()} disabled={youtubeClientLoading || youtubeClientSaving || !youtubeClientSettingsChanged || (Boolean(youtubeClientSecret.trim()) && !youtubeTokenKeyConfigured)}>{youtubeClientSaving ? "Saving…" : "Save OAuth settings"}</button></div>
      {youtubeClientFeedback && <p className={`video-settings-feedback${youtubeClientFeedbackError ? " is-error" : ""}`} role="status">{youtubeClientFeedback}</p>}
    </section>
  </section>;
}
