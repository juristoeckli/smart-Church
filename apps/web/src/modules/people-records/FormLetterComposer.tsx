import { useEffect, useRef, useState, type FormEvent } from "react";
import { createFormLetterHtml, letterLimits, letterPlaceholders, prepareFormLetter, validateLetterDraft, type LetterDraft, type MailingRecipientSelection } from "./form-letters";

const emptyDraft: LetterDraft = { subject: "", body: "" };
type RecipientOptions = { contactIds: string[]; departmentId: string; combineHouseholds: boolean; skipIncomplete: boolean };

async function loadRecipients(options: RecipientOptions, signal: AbortSignal) {
  const params = new URLSearchParams({ contactIds: options.contactIds.join(","), combineHouseholds: String(options.combineHouseholds), skipIncomplete: String(options.skipIncomplete) });
  const response = await fetch(`/api/people-records/mailing-recipients?${params}`, { headers: { "x-department-id": options.departmentId }, cache: "no-store", signal });
  if (!response.ok) {
    const failure = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(failure?.error ?? "Could not load the selected mailing recipients.");
  }
  return await response.json() as MailingRecipientSelection;
}

function downloadHtml(html: string) {
  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "form-letters.html";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function printHtml(html: string, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.title = "Printable form letters";
    frame.tabIndex = -1;
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("sandbox", "allow-same-origin allow-modals");
    frame.style.cssText = "position:fixed;left:-10000px;top:0;width:800px;height:1100px;border:0";
    let timer: number;
    function cleanup() {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", cancelled);
      frame.remove();
    }
    function cancelled() { cleanup(); reject(new DOMException("Printing was cancelled.", "AbortError")); }
    timer = window.setTimeout(() => { cleanup(); reject(new Error("Could not prepare the print view. Download HTML to print it separately.")); }, 10000);
    signal.addEventListener("abort", cancelled, { once: true });
    frame.onload = () => {
      if (signal.aborted) { cancelled(); return; }
      const printable = frame.contentWindow;
      if (!printable) { cleanup(); reject(new Error("Could not open the print view.")); return; }
      window.clearTimeout(timer);
      timer = window.setTimeout(cleanup, 300000);
      printable.addEventListener("afterprint", cleanup, { once: true });
      try { printable.focus(); printable.print(); resolve(); }
      catch { cleanup(); reject(new Error("Could not open printing. Download HTML to print it separately.")); }
    };
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}

export function FormLetterComposer(options: RecipientOptions) {
  const [draft, setDraft] = useState(emptyDraft);
  const [placeholder, setPlaceholder] = useState<(typeof letterPlaceholders)[number]["key"]>("name");
  const [preview, setPreview] = useState<{ key: string; selection: MailingRecipientSelection } | null>(null);
  const [recipientIndex, setRecipientIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const active = useRef<AbortController | null>(null);
  const key = JSON.stringify([options.departmentId, options.contactIds, options.combineHouseholds, options.skipIncomplete, draft]);
  const selection = preview?.key === key ? preview.selection : null;
  const recipient = selection?.recipients[recipientIndex];
  const letter = recipient ? prepareFormLetter(draft, recipient) : null;

  useEffect(() => () => active.current?.abort(), [key]);

  async function act(run: (selection: MailingRecipientSelection, signal: AbortSignal) => void | Promise<void>) {
    const error = validateLetterDraft(draft);
    if (error) { setFeedback({ error: true, message: error }); return; }
    const controller = new AbortController();
    active.current?.abort();
    active.current = controller;
    setBusy(true);
    setFeedback(null);
    let recipientsChecked = false;
    try {
      const recipients = await loadRecipients(options, controller.signal);
      recipientsChecked = true;
      if (!controller.signal.aborted) await run(recipients, controller.signal);
    } catch (reason) {
      if (!controller.signal.aborted) {
        if (!recipientsChecked) setPreview(null);
        setFeedback({ error: true, message: reason instanceof Error ? reason.message : "Could not prepare the letters." });
      }
    } finally {
      if (active.current === controller) { active.current = null; setBusy(false); }
    }
  }

  function previewLetters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void act((recipients) => {
      setPreview({ key, selection: recipients });
      setRecipientIndex(0);
    });
  }

  function exportLetters(format: "print" | "html") {
    if (!selection?.recipients.length) return;
    void act(async (recipients, signal) => {
      if (JSON.stringify(recipients) !== JSON.stringify(selection)) {
        setPreview({ key, selection: recipients });
        setRecipientIndex(0);
        setFeedback({ error: false, message: "The selected recipients changed. Review the refreshed preview before printing or downloading." });
        return;
      }
      const html = createFormLetterHtml(draft, recipients.recipients);
      if (format === "html") downloadHtml(html);
      else await printHtml(html, signal);
    });
  }

  function insertPlaceholder() {
    const textarea = input.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const token = `{{recipient.${placeholder}}}`;
    const body = draft.body.slice(0, start) + token + draft.body.slice(textarea.selectionEnd);
    if (body.length > letterLimits.body) return;
    setDraft({ ...draft, body });
    window.requestAnimationFrame(() => { textarea.focus(); textarea.setSelectionRange(start + token.length, start + token.length); });
  }

  return <section aria-label="Form letters">
    <h3>Form letters</h3>
    <p>Compose letters for the selected people using the mailing options above.</p>
    <form onSubmit={previewLetters}>
      <label>Subject<input value={draft.subject} maxLength={letterLimits.subject} disabled={busy} onChange={(event) => setDraft({ ...draft, subject: event.target.value })} /></label>
      <label>Letter text<textarea ref={input} required rows={8} maxLength={letterLimits.body} value={draft.body} disabled={busy} onChange={(event) => setDraft({ ...draft, body: event.target.value })} /></label>
      <div className="module-toolbar">
        <label>Recipient placeholder<select value={placeholder} disabled={busy} onChange={(event) => setPlaceholder(event.target.value as typeof placeholder)}>
          {letterPlaceholders.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        <button type="button" disabled={busy} onClick={insertPlaceholder}>Insert into letter</button>
        <button type="submit" disabled={busy || !options.contactIds.length}>Preview form letters</button>
      </div>
    </form>
    {busy && <p role="status">Preparing form letters…</p>}
    {feedback && <p role={feedback.error ? "alert" : "status"}>{feedback.message}</p>}
    {selection && <section aria-label="Letter preview">
      <p>{selection.recipients.length} letters{selection.skipped ? `, ${selection.skipped} recipients skipped because of incomplete addresses` : ""}.</p>
      {!selection.recipients.length && <p>Choose recipients or include incomplete addresses to preview a letter.</p>}
      {letter && <>
        {selection.recipients.length > 1 && <label>Preview recipient<select value={recipientIndex} onChange={(event) => setRecipientIndex(Number(event.target.value))}>
          {selection.recipients.map(({ name }, index) => <option value={index} key={index}>{index + 1}. {name}</option>)}
        </select></label>}
        {recipient?.complete === false && <p>This recipient has an incomplete mailing address.</p>}
        <article className="module-card">
          <address>{letter.address.map((line, index) => <div key={index}>{line}</div>)}</address>
          {letter.subject && <h4>{letter.subject}</h4>}
          <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{letter.body}</p>
        </article>
        <div className="module-toolbar">
          <button type="button" disabled={busy} onClick={() => exportLetters("print")}>Print letters</button>
          <button type="button" disabled={busy} onClick={() => exportLetters("html")}>Download printable HTML</button>
        </div>
      </>}
    </section>}
  </section>;
}
