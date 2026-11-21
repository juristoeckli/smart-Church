import type { MailingRecipientSelection } from "./form-letters";

export type RecipientOptions = { contactIds: string[]; departmentId: string; combineHouseholds: boolean; skipIncomplete: boolean };

export async function loadRecipients(options: RecipientOptions, signal: AbortSignal) {
  const params = new URLSearchParams({ contactIds: options.contactIds.join(","), combineHouseholds: String(options.combineHouseholds), skipIncomplete: String(options.skipIncomplete) });
  const response = await fetch(`/api/people-records/mailing-recipients?${params}`, { headers: { "x-department-id": options.departmentId }, cache: "no-store", signal });
  if (!response.ok) {
    const failure = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(failure?.error ?? "Could not load the selected mailing recipients.");
  }
  return await response.json() as MailingRecipientSelection;
}

export function printMailingDocument(html: string, title: string, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("Printing was cancelled.", "AbortError")); return; }
    const frame = document.createElement("iframe");
    frame.title = title;
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
    timer = window.setTimeout(() => { cleanup(); reject(new Error("Could not prepare the print view.")); }, 10000);
    signal.addEventListener("abort", cancelled, { once: true });
    frame.onload = () => {
      if (signal.aborted) { cancelled(); return; }
      const printable = frame.contentWindow;
      if (!printable) { cleanup(); reject(new Error("Could not open the print view.")); return; }
      window.clearTimeout(timer);
      timer = window.setTimeout(cleanup, 300000);
      printable.addEventListener("afterprint", cleanup, { once: true });
      try { printable.focus(); printable.print(); resolve(); }
      catch { cleanup(); reject(new Error("Could not open printing.")); }
    };
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}
