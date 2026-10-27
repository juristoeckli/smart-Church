import { useEffect, useRef, useState } from "react";
import { SlidersHorizontal, Volume2 } from "lucide-react";

type LevelReply = { level?: number; registers?: Record<string, number>; error?: string };
const analog = [
  { key: "0x0014", label: "Analog Ch 1" },
  { key: "0x0018", label: "Analog Ch 2" },
  { key: "0x001c", label: "Analog Ch 3" },
  { key: "0x0020", label: "Analog Ch 4" },
] as const;
const aes = { key: "0x0024", label: "AES/EBU" } as const;

export function BmdVolumeMenu({ departmentId, siteId, converterId, csrfToken, canControl }: { departmentId: string; siteId: string; converterId: string; csrfToken: string; canControl: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [values, setValues] = useState<Record<string, number>>({});
  const [saved, setSaved] = useState<Record<string, number>>({});
  const [message, setMessage] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const headers = { "x-department-id": departmentId, "x-csrf-token": csrfToken, "content-type": "application/json" };

  async function request<T extends LevelReply>(path: string, method = "GET", body?: unknown): Promise<T> {
    const separator = path.includes("?") ? "&" : "?";
    const response = await fetch(`${path}${separator}site_id=${encodeURIComponent(siteId)}&converter_id=${encodeURIComponent(converterId)}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify({ ...body as object, site_id: siteId, converter_id: converterId }) }),
      cache: "no-store",
    });
    const result = await response.json() as T;
    if (!response.ok) throw new Error(result.error || `Converter request failed (${response.status}).`);
    return result;
  }

  async function readLevels() {
    setBusy(true);
    setMessage("");
    try {
      const audio = await request<LevelReply>("/api/video/converter/audio-levels");
      const next = audio.registers ?? {};
      if (typeof next[aes.key] !== "number") throw new Error("The converter did not return its AES/EBU level.");
      setValues(next);
      setSaved(next);
      setMessage("Levels read from this location's converter.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not read converter levels."); }
    finally { setBusy(false); }
  }

  async function applyChanges() {
    setBusy(true);
    setMessage("");
    let analogApplied = false;
    try {
      if (analogChanged) {
        const levels = analog.map(({ key }) => values[key]);
        if (levels.some((level) => !Number.isInteger(level))) throw new Error("Read all four channel levels before applying changes.");
        await request<LevelReply>("/api/video/converter/analog-levels", "POST", { levels });
        analogApplied = true;
        setSaved((current) => ({ ...current, ...Object.fromEntries(analog.map(({ key }) => [key, values[key]])) }));
      }
      if (values[aes.key] !== saved[aes.key]) {
        const result = await request<LevelReply>("/api/video/converter/aes-level", "POST", { level: values[aes.key] });
        const value = result.level ?? values[aes.key];
        setValues((current) => ({ ...current, [aes.key]: value }));
        setSaved((current) => ({ ...current, [aes.key]: value }));
      }
      setMessage("Changes applied and verified.");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Could not apply converter levels.";
      setMessage(analogApplied ? `Analog channels applied; ${detail}` : detail);
    }
    finally { setBusy(false); }
  }

  useEffect(() => {
    if (!open) return;
    void readLevels();
    const onPointer = (event: PointerEvent) => { if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); window.removeEventListener("keydown", onKey); };
  }, [open]);

  const analogChanged = analog.some(({ key }) => values[key] !== saved[key]);
  const aesChanged = values[aes.key] !== undefined && values[aes.key] !== saved[aes.key];

  return <div className={`bmd-volume-anchor${open ? " bmd-volume-anchor-open" : ""}`} ref={menuRef}>
    <button type="button" className="video-small-button" aria-haspopup="dialog" aria-expanded={open} aria-label="Open Audio to SDI level controls" onClick={() => setOpen((current) => !current)}><SlidersHorizontal size={13} /> Audio controls</button>
    {open && <section className="bmd-volume-popup" role="dialog" aria-label="BMD Mini Converter audio controls">
      <header><div><strong><Volume2 size={15} /> Audio levels</strong><span>0–255 raw device values</span></div><button type="button" className="video-small-button" disabled={busy} onClick={() => void readLevels()}>Read</button></header>
      {[...analog, aes].map(({ key, label }) => <label className="bmd-volume-slider" key={key}><span>{label}<output>{values[key] ?? "—"}</output></span><input type="range" min="0" max="255" step="1" value={values[key] ?? 0} disabled={!canControl || busy || values[key] === undefined} onChange={(event) => setValues((current) => ({ ...current, [key]: Number(event.target.value) }))} /></label>)}
      <footer><button type="button" className="video-small-button video-button-primary" disabled={!canControl || busy || (!analogChanged && !aesChanged)} onClick={() => void applyChanges()}>Apply changes</button></footer>
      {!canControl && <p className="bmd-volume-note">Stream Admin permission is required to change levels.</p>}
      <p className="bmd-volume-note">Analog channels apply together. The dB curve between displayed values is still being mapped.</p>
      {message && <p role="status" className="bmd-volume-message">{message}</p>}
    </section>}
  </div>;
}
