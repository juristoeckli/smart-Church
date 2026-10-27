import { useState } from "react";
import { Radio, RefreshCw, TriangleAlert, Volume2 } from "lucide-react";

type ProbeResult = {
  configured: boolean;
  host?: string;
  port?: number;
  deviceFound?: boolean;
  responseHex?: string;
  responseText?: string;
  error?: string;
};

type LevelResult = { configured?: boolean; level?: number; format?: string; applied?: boolean; error?: string };

export function BmdConverterSetup({ departmentId, csrfToken }: { departmentId: string; csrfToken: string }) {
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [level, setLevel] = useState<number | null>(null);
  const [levelInput, setLevelInput] = useState(0);
  const [levelMessage, setLevelMessage] = useState("");
  const [levelBusy, setLevelBusy] = useState(false);

  function levelHeaders() {
    return { "x-department-id": departmentId, "x-csrf-token": csrfToken, "content-type": "application/json" };
  }

  async function readLevel() {
    setLevelBusy(true);
    setLevelMessage("");
    try {
      const response = await fetch("/api/video/converter/aes-level", { headers: levelHeaders(), cache: "no-store" });
      const body = await response.json() as LevelResult;
      if (!response.ok || typeof body.level !== "number") throw new Error(body.error || "The AES/EBU input level could not be read.");
      setLevel(body.level);
      setLevelInput(body.level);
      setLevelMessage("Current level read from the converter.");
    } catch (error) {
      setLevelMessage(error instanceof Error ? error.message : "The AES/EBU input level could not be read.");
    } finally { setLevelBusy(false); }
  }

  async function applyLevel() {
    setLevelBusy(true);
    setLevelMessage("");
    try {
      const response = await fetch("/api/video/converter/aes-level", {
        method: "POST",
        headers: levelHeaders(),
        body: JSON.stringify({ level: levelInput }),
      });
      const body = await response.json() as LevelResult;
      if (!response.ok || typeof body.level !== "number") throw new Error(body.error || "The AES/EBU input level could not be applied.");
      setLevel(body.level);
      setLevelInput(body.level);
      setLevelMessage("Level applied and confirmed by the converter.");
    } catch (error) {
      setLevelMessage(error instanceof Error ? error.message : "The AES/EBU input level could not be applied.");
    } finally { setLevelBusy(false); }
  }

  async function discover() {
    setBusy(true);
    try {
      const response = await fetch("/api/video/converter/discover", { headers: { "x-department-id": departmentId } });
      const body = await response.json() as ProbeResult;
      if (!response.ok) throw new Error(body.error || "The DS-700 discovery request failed.");
      setResult(body);
    } catch (error) {
      setResult({ configured: true, error: error instanceof Error ? error.message : "The DS-700 discovery request failed." });
    } finally { setBusy(false); }
  }

  return <>
    <div className="video-heading"><div><h1>Converter Setup</h1><p>Discover the Audio to SDI converter through its Silex DS-700 USB server.</p></div></div>
    <section className="video-panel video-converter-panel">
      <div className="video-panel-heading"><div><h2>DS-700 discovery</h2><p>The dedicated converter worker checks server info, then requests the USB device list.</p></div><button className="video-small-button video-button-primary" type="button" disabled={busy} onClick={() => void discover()}><RefreshCw size={14} />{busy ? "Searching…" : "Discover converter"}</button></div>
      {!result ? <div className="video-converter-empty"><Radio size={22} /><p>Run discovery to check whether the Audio to SDI appears on the DS-700.</p></div> : result.error ? <div className="video-converter-warning" role="alert"><TriangleAlert size={18} /><div><strong>Discovery did not complete</strong><p>{result.error}</p></div></div> : !result.configured ? <div className="video-converter-warning"><TriangleAlert size={18} /><div><strong>DS-700 address is not configured</strong><p>Set <code>BMD_CONVERTER_DS700_HOST</code> to the DS-700 address and restart the API container.</p></div></div> : <div className="video-converter-result" role="status">
        <div className="video-converter-identity"><span className={`video-state ${result.deviceFound ? "video-state-good" : ""}`}>{result.deviceFound ? "Converter found" : "Device list received"}</span><strong>{result.host}:{result.port}</strong></div>
        {result.deviceFound && <p>Blackmagic Design Mini Converter Audio to SDI appears in the DS-700 USB device list.</p>}
        {!result.deviceFound && <p>The DS-700 replied, but the captured response did not include the Audio to SDI product name. Check the raw response below.</p>}
        {result.responseText && <details><summary>Device-list response</summary><pre>{result.responseText}</pre></details>}
        {result.responseHex && <details><summary>Response bytes</summary><pre>{result.responseHex}</pre></details>}
      </div>}
      <div className="video-converter-warning video-converter-experimental"><TriangleAlert size={18} /><div><strong>Experimental device control</strong><p>The AES/EBU level command was identified from the supplied capture. Control uses the separate Video worker and is limited to the captured device-code range until its dB scale is calibrated.</p></div></div>
    </section>
    <section className="video-panel video-converter-panel">
      <div className="video-panel-heading"><div><h2>AES/EBU input level</h2><p>Set the AES audio level through the isolated DS-700 worker.</p></div><Volume2 size={20} /></div>
      <div className="video-converter-level">
        <label htmlFor="bmd-aes-level">Raw device code <output>{levelInput}</output></label>
      <input id="bmd-aes-level" type="range" min="0" max="255" step="1" value={levelInput} disabled={levelBusy} onChange={(event) => setLevelInput(Number(event.target.value))} />
        <div className="video-converter-level-actions">
          <span>{level === null ? "Current level not read" : `Converter reports ${level}`}</span>
          <div><button className="video-small-button" type="button" disabled={levelBusy} onClick={() => void readLevel()}>{levelBusy ? "Working…" : "Read current"}</button><button className="video-small-button video-button-primary" type="button" disabled={levelBusy} onClick={() => void applyLevel()}>Apply level</button></div>
        </div>
        <p className="video-converter-level-note">The capture shows the control reaching 255 and reading back 255 after reopening. The dB conversion is not decoded yet, so this control uses the raw device code.</p>
        {levelMessage && <p role="status" className="video-converter-level-message">{levelMessage}</p>}
      </div>
    </section>
  </>;
}
