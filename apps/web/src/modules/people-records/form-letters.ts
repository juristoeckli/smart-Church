import type { PostalAddress } from "./postal-address";

export type MailingRecipient = { name: string; salutation: string; postalAddress: PostalAddress; complete: boolean };
export type MailingRecipientSelection = { recipients: MailingRecipient[]; skipped: number };
export type LetterDraft = { subject: string; body: string };

export const letterLimits = { subject: 120, body: 12000 } as const;
export const letterPlaceholders = [
  { key: "name", label: "Recipient name" }, { key: "salutation", label: "Mailing salutation" },
  { key: "street", label: "Street" }, { key: "additionalLine", label: "Additional address line" },
  { key: "city", label: "City" }, { key: "region", label: "State or region" },
  { key: "postalCode", label: "Postal code" }, { key: "country", label: "Country" },
] as const;
const fields = new Set<string>(letterPlaceholders.map(({ key }) => `recipient.${key}`));
const placeholderPattern = /\{\{([^{}\r\n]*)\}\}/g;

export function validateLetterDraft(draft: LetterDraft) {
  if (!draft.body.trim()) return "Write the letter before previewing.";
  if (draft.subject.length > letterLimits.subject || draft.body.length > letterLimits.body) return "The letter exceeds the supported length.";
  for (const text of [draft.subject, draft.body]) {
    if (/\{\{\{|\}\}\}/.test(text)) return "Complete each placeholder with double braces.";
    const unmatched = text.replace(placeholderPattern, "");
    if (unmatched.includes("{{") || unmatched.includes("}}")) return "Complete each placeholder with double braces.";
    for (const match of text.matchAll(placeholderPattern)) {
      if (!fields.has(match[1].trim())) return "Use one of the listed recipient placeholders.";
    }
  }
  return null;
}

function personalize(text: string, recipient: MailingRecipient) {
  const values: Record<string, string | undefined> = { ...recipient.postalAddress, name: recipient.name, salutation: recipient.salutation };
  return text.replace(placeholderPattern, (_token, field: string) => values[field.trim().slice("recipient.".length)] ?? "");
}

function mailingAddressLines(recipient: MailingRecipient) {
  const address = recipient.postalAddress;
  return [recipient.name, address.street, address.additionalLine, [address.postalCode, address.city].filter(Boolean).join(" "), address.region, address.country].filter((line): line is string => Boolean(line));
}

export function prepareFormLetter(draft: LetterDraft, recipient: MailingRecipient) {
  return {
    address: mailingAddressLines(recipient),
    subject: personalize(draft.subject.trim(), recipient),
    body: personalize(draft.body.trim(), recipient),
  };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

export function createFormLetterHtml(draft: LetterDraft, recipients: MailingRecipient[]) {
  const error = validateLetterDraft(draft);
  if (error) throw new Error(error);
  if (!recipients.length) throw new Error("There are no recipients to include.");
  const letters = recipients.map((recipient) => {
    const { address, subject, body } = prepareFormLetter(draft, recipient);
    return `<article class="letter"><address>${address.map(escapeHtml).join("<br>")}</address>${subject ? `<h1>${escapeHtml(subject)}</h1>` : ""}<div class="body">${escapeHtml(body)}</div></article>`;
  }).join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Form letters</title><style>
@page{size:A4;margin:20mm}html{color:#111;background:#fff;font:11pt/1.55 system-ui,sans-serif}body{margin:0}
.letter{margin:0 auto;max-width:170mm;overflow-wrap:anywhere}.letter address{font-style:normal;margin:0 0 10mm;line-height:1.35}
.letter h1{font-size:13pt;margin:0 0 5mm}.letter .body{white-space:pre-wrap}
@media print{.letter+.letter{break-before:page}}
@media screen{html{background:#efefef}.letter{box-sizing:border-box;background:#fff;margin:1rem auto;padding:clamp(1rem,4vw,20mm);max-width:210mm;min-height:min(297mm,85vh)}}
</style></head><body>${letters}</body></html>`;
}

export function createAddressLabelHtml(recipients: MailingRecipient[], firstPosition: number) {
  const labelsPerSheet = 12;
  if (!recipients.length) throw new Error("There are no recipients to print.");
  if (!Number.isInteger(firstPosition) || firstPosition < 1 || firstPosition > labelsPerSheet) {
    throw new Error("Choose a starting label position between 1 and 12.");
  }
  const labels = [
    ...Array<string>(firstPosition - 1).fill('<div aria-hidden="true"></div>'),
    ...recipients.map((recipient) => `<address>${mailingAddressLines(recipient).map(escapeHtml).join("<br>")}</address>`),
  ];
  const sheets: string[] = [];
  for (let start = 0; start < labels.length; start += labelsPerSheet) {
    sheets.push(`<section class="sheet">${labels.slice(start, start + labelsPerSheet).join("")}</section>`);
  }
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Mailing address labels</title><style>
@page{size:A4;margin:10mm}html{color:#111;background:#fff;font:9pt/1.25 system-ui,sans-serif}body{margin:0}
.sheet{display:grid;grid-template-columns:repeat(2,94mm);grid-auto-rows:minmax(44mm,auto);gap:2mm;align-items:stretch}
.sheet address{box-sizing:border-box;padding:3mm 4mm;font-style:normal;overflow-wrap:anywhere;break-inside:avoid}
@media print{.sheet+.sheet{break-before:page}}
</style></head><body>${sheets.join("\n")}</body></html>`;
}
