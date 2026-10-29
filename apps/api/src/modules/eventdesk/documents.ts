type PdfLine = { description: string; quantity: number; unitCents: number; unitLabel: string; lineTotalCents: number };
type PdfDocument = {
  number: string; kind: string; issueDate: string; dueDate: string | null; jobTitle: string; relatedDocumentNumber?: string | null;
  customer: { name?: string; email?: string; street?: string; postalCode?: string; city?: string; country?: string; venue?: string; startsAt?: string; endsAt?: string; jobNotes?: string };
  lines: PdfLine[]; taxRateBps: number; subtotalCents: number; taxCents: number; totalCents: number; balanceCents?: number;
};
type PdfBranding = { businessName: string; street: string; postalCode: string; city: string; country: string; email: string; phone: string; taxIdentifier: string; paymentTerms: string; footer: string; legalText?: string; taxProfileName?: string; logoJpeg?: Buffer | null; template?: { title?: string; intro?: string; footer?: string } };

const plain = (value: unknown) => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "?");
const escapePdf = (value: string) => plain(value).replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
const htmlEntities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (character) => htmlEntities[character]);
const money = (cents: number) => `CHF ${(cents / 100).toFixed(2)}`;

function wrap(value: unknown, width = 88): string[] {
  const words = plain(value).split(/\s+/).filter(Boolean);
  const result: string[] = [];
  let line = "";
  for (const word of words) {
    const pieces = word.match(new RegExp(`.{1,${width}}`, "g")) ?? [word];
    for (const piece of pieces) {
      if (line && `${line} ${piece}`.length > width) { result.push(line); line = piece; }
      else line = line ? `${line} ${piece}` : piece;
    }
  }
  if (line) result.push(line);
  return result.length ? result : [""];
}

export function createDocumentPdf(document: PdfDocument, branding: PdfBranding): Buffer {
  const lines: string[] = [];
  const add = (value = "") => lines.push(...wrap(value));
  add(branding.businessName || "Your organization");
  add([branding.street, [branding.postalCode, branding.city].filter(Boolean).join(" "), branding.country].filter(Boolean).join(" · "));
  add([branding.email, branding.phone, branding.taxIdentifier].filter(Boolean).join(" · "));
  add("------------------------------------------------------------");
  const title = branding.template?.title?.trim() || document.kind.replaceAll("_", " ").toUpperCase();
  add(`${title}   ${document.number}`);
  if (branding.template?.intro) { add(branding.template.intro); add(""); }
  if (document.relatedDocumentNumber) add(`Credit for invoice: ${document.relatedDocumentNumber}`);
  add(`Date: ${document.issueDate}${document.dueDate ? `   Due: ${document.dueDate}` : ""}`);
  add(`Job: ${document.jobTitle}`);
  add(`Customer: ${document.customer.name || "Customer not specified"}`);
  add([document.customer.street, [document.customer.postalCode, document.customer.city].filter(Boolean).join(" "), document.customer.country, document.customer.email].filter(Boolean).join(" · "));
  if (document.customer.startsAt) add(`Event: ${document.customer.startsAt} – ${document.customer.endsAt ?? ""}`);
  if (document.customer.venue) add(`Venue: ${document.customer.venue}`);
  if (document.kind === "contract" && document.customer.jobNotes) { add("Notes:"); add(document.customer.jobNotes); }
  add("");
  if (document.kind === "delivery_note") {
    add("DESCRIPTION                                                        QUANTITY");
    for (const line of document.lines) add(`${line.description}                                                        ${line.quantity}`);
  } else {
    add("DESCRIPTION                         QTY × RATE                              TOTAL");
    const sign = document.kind === "credit_note" ? -1 : 1;
    for (const line of document.lines) {
      add(`${line.description}  ${line.quantity} × ${money(sign * line.unitCents)} / ${line.unitLabel}  ${money(sign * line.lineTotalCents)}`);
    }
    add(""); add(`Subtotal: ${money(sign * document.subtotalCents)}`);
    add(`Tax${branding.taxProfileName ? ` · ${branding.taxProfileName}` : ""} (${(document.taxRateBps / 100).toFixed(2)}%): ${money(sign * document.taxCents)}`);
    add(`Total: ${money(sign * document.totalCents)}`);
    if (document.balanceCents !== undefined) add(`Balance due: ${money(document.balanceCents)}`);
    if (branding.paymentTerms) { add(""); add("Payment terms:"); add(branding.paymentTerms); }
  }
  if (branding.legalText) { add(""); add(branding.legalText); }
  const footer = branding.template?.footer?.trim() || branding.footer;
  if (footer) { add(""); add(footer); }

  const pageLines: string[][] = [];
  for (let i = 0; i < lines.length; i += 48) pageLines.push(lines.slice(i, i + 48));
  const objects: string[] = ["<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const hasLogo = Boolean(branding.logoJpeg?.length);
  if (branding.logoJpeg) {
    const hex = branding.logoJpeg.toString("hex").toUpperCase();
    const dimensions = jpegDimensions(branding.logoJpeg) ?? { width: 640, height: 320 };
    objects.push(`<< /Type /XObject /Subtype /Image /Width ${dimensions.width} /Height ${dimensions.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /DCTDecode] /Length ${hex.length + 1} >>\nstream\n${hex}>\nendstream`);
  }
  const pageRefs: number[] = [];
  for (const pageLinesPart of pageLines) {
    const pageObject = objects.length + 1;
    const contentObject = pageObject + 1;
    pageRefs.push(pageObject);
    const commands = ["q", "96 0 0 48 466 776 cm", ...(hasLogo ? ["/Logo Do"] : []), "Q", "BT", "/F1 10 Tf", "50 755 Td", "14 TL", ...pageLinesPart.map((line) => `(${escapePdf(line)}) Tj T*`), "ET"].join("\n");
    const imageResources = hasLogo ? " /XObject << /Logo 4 0 R >>" : "";
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 3 0 R >>${imageResources} >> /Contents ${contentObject} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(commands, "ascii")} >>\nstream\n${commands}\nendstream`);
  }
  objects[1] = `<< /Type /Pages /Kids [${pageRefs.map((reference) => `${reference} 0 R`).join(" ")}] /Count ${pageRefs.length} >>`;
  let output = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(output, "ascii")); output += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xrefOffset = Buffer.byteLength(output, "ascii");
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) output += `${String(offset).padStart(10, "0")} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(output, "ascii");
}

export function createDocumentEmailHtml(document: PdfDocument, branding: PdfBranding, message: string, paymentReminder?: { balanceCents: number }): string {
  const sign = document.kind === "credit_note" ? -1 : 1;
  const rows = document.lines.map((line) => `<tr><td>${escapeHtml(line.description)}</td><td>${escapeHtml(line.quantity)} ${escapeHtml(line.unitLabel)}</td><td>${escapeHtml(money(sign * line.lineTotalCents))}</td></tr>`).join("");
  const reminder = paymentReminder ? `<p style="padding:12px;background:#fff4d6">This invoice is overdue. Our records show <strong>${escapeHtml(money(paymentReminder.balanceCents))}</strong> still outstanding. If you have already paid, please disregard this reminder or contact us.</p>` : "";
  const title = branding.template?.title?.trim() || document.kind.replaceAll("_", " ");
  const footer = branding.template?.footer?.trim() || branding.footer;
  const logo = branding.logoJpeg?.length ? `<img alt="${escapeHtml(branding.businessName)}" width="140" src="data:image/jpeg;base64,${branding.logoJpeg.toString("base64")}">` : "";
  return `<div style="font-family:Arial,sans-serif;color:#202b28;max-width:680px;margin:auto">${logo}<h2>${escapeHtml(branding.businessName || "Your organization")}</h2><p>${escapeHtml([branding.street, [branding.postalCode, branding.city].filter(Boolean).join(" "), branding.country].filter(Boolean).join(", "))}</p><hr><h1>${escapeHtml(title)} ${escapeHtml(document.number)}</h1>${branding.template?.intro ? `<p>${escapeHtml(branding.template.intro).replaceAll("\n", "<br>")}</p>` : ""}${document.relatedDocumentNumber ? `<p>Credit for invoice ${escapeHtml(document.relatedDocumentNumber)}</p>` : ""}<p>For ${escapeHtml(document.customer.name || "Customer")} · ${escapeHtml(document.jobTitle)}</p>${reminder}${message ? `<p>${escapeHtml(message).replaceAll("\n", "<br>")}</p>` : ""}<table style="width:100%;border-collapse:collapse"><thead><tr><th align="left">Description</th><th align="left">Quantity</th><th align="right">Total</th></tr></thead><tbody>${rows}</tbody></table>${document.kind === "delivery_note" ? "" : `<p style="text-align:right">Subtotal ${escapeHtml(money(sign * document.subtotalCents))}<br>Tax${branding.taxProfileName ? ` · ${escapeHtml(branding.taxProfileName)}` : ""} ${escapeHtml(money(sign * document.taxCents))}<br><strong>Total ${escapeHtml(money(sign * document.totalCents))}</strong>${paymentReminder ? `<br>Balance due ${escapeHtml(money(paymentReminder.balanceCents))}` : ""}</p>`}${branding.legalText ? `<p>${escapeHtml(branding.legalText).replaceAll("\n", "<br>")}</p>` : ""}<p>The branded document is attached as a PDF.</p>${footer ? `<hr><p>${escapeHtml(footer)}</p>` : ""}</div>`;
}

export function jpegDimensions(jpeg: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 9 < jpeg.length) {
    if (jpeg[offset] !== 0xff) { offset++; continue; }
    const marker = jpeg[offset + 1];
    const length = jpeg.readUInt16BE(offset + 2);
    if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) return { height: jpeg.readUInt16BE(offset + 5), width: jpeg.readUInt16BE(offset + 7) };
    offset += 2 + length;
  }
  return null;
}
