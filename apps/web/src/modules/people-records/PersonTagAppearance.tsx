import { useState, type FormEvent } from "react";

type Appearance = { label: string; color: string | null };

export function PersonTagLabel({ label, color }: { label: string; color?: string | null }) {
  return <span>{color && <span aria-hidden="true" style={{
    display: "inline-block", width: "0.75em", height: "0.75em", marginInlineEnd: "0.4em",
    borderRadius: "50%", border: "1px solid currentColor", backgroundColor: color,
  }} />}{label}</span>;
}

export function PersonTagAppearance({ label, color, save }: Appearance & { save: (appearance: Appearance) => Promise<void> }) {
  const [nextLabel, setNextLabel] = useState(label);
  const [nextColor, setNextColor] = useState(color);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !nextLabel.trim() || (nextLabel.trim() === label && nextColor === color)) return;
    setBusy(true);
    setError("");
    try {
      await save({ label: nextLabel.trim(), color: nextColor });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update the tag.");
    } finally {
      setBusy(false);
    }
  }

  return <form className="module-toolbar" onSubmit={(event) => void submit(event)}>
    <fieldset disabled={busy}>
      <legend><PersonTagLabel label={label} color={color} /></legend>
      <label>Tag name<input value={nextLabel} onChange={(event) => setNextLabel(event.target.value)} required maxLength={100} /></label>
      <label>Tag color<input type="color" value={nextColor ?? "#5b6573"} onChange={(event) => setNextColor(event.target.value)} /></label>
      {nextColor === null
        ? <button type="button" onClick={() => setNextColor("#5b6573")}>Use color</button>
        : <button type="button" onClick={() => setNextColor(null)}>Remove color</button>}
      <button type="submit" disabled={!nextLabel.trim() || (nextLabel.trim() === label && nextColor === color)}>Save tag</button>
      {error && <p role="alert">{error}</p>}
    </fieldset>
  </form>;
}
