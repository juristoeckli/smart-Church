import { createHash } from "node:crypto";
import QRCode from "qrcode";

type PdfLine = { description: string; quantity: number; unitCents: number; unitLabel: string; lineTotalCents: number };
type PdfDocument = {
  id: string; number: string; kind: string; issueDate: string; dueDate: string | null; jobTitle: string; relatedDocumentNumber?: string | null;
  customer: { name?: string; email?: string; street?: string; postalCode?: string; city?: string; country?: string; venue?: string; startsAt?: string; endsAt?: string; jobNotes?: string };
  lines: PdfLine[]; taxRateBps: number; subtotalCents: number; taxCents: number; totalCents: number; balanceCents?: number;
};
export type SwissQrBillSettings = { enabled: boolean; iban: string; referenceType: "NON" | "SCOR" | "QRR"; street: string; buildingNumber: string; countryCode: string };
type PdfBranding = { businessName: string; street: string; postalCode: string; city: string; country: string; email: string; phone: string; taxIdentifier: string; paymentTerms: string; footer: string; legalText?: string; taxProfileName?: string; logoJpeg?: Buffer | null; template?: { title?: string; intro?: string; footer?: string }; swissQrBill?: SwissQrBillSettings };

const plain = (value: unknown) => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "?");
const escapePdf = (value: string) => plain(value).replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
const htmlEntities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (character) => htmlEntities[character]);
const money = (cents: number) => `CHF ${(cents / 100).toFixed(2)}`;

const cleanIban = (value: string) => value.replace(/\s+/g, "").toUpperCase();

function ibanMod97(iban: string): number {
  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
  let remainder = 0;
  for (const character of rearranged) {
    const expanded = /[A-Z]/.test(character) ? String(character.charCodeAt(0) - 55) : character;
    for (const digit of expanded) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder;
}

export function validateSwissQrBillSettings(settings: SwissQrBillSettings, creditor: { name: string; postalCode: string; city: string }): string | null {
  if (!settings.enabled) return null;
  const iban = cleanIban(settings.iban);
  if (!/^(CH|LI)\d{19}$/.test(iban) || ibanMod97(iban) !== 1) return "Enter a valid Swiss or Liechtenstein IBAN.";
  if (settings.referenceType === "QRR") {
    const qrIid = Number(iban.slice(4, 9));
    if (qrIid < 30000 || qrIid > 31999) return "QR reference requires a QR-IBAN with a QR-IID from 30000 to 31999.";
  } else if (Number(iban.slice(4, 9)) >= 30000 && Number(iban.slice(4, 9)) <= 31999) {
    return "A QR-IBAN must use the QR reference option.";
  }
  if (!creditor.name.trim() || creditor.name.trim().length > 70) return "Enter the account holder name (up to 70 characters).";
  if (!settings.street.trim() || settings.street.trim().length > 70) return "Enter the creditor street name (up to 70 characters).";
  if (settings.buildingNumber.length > 16) return "The building number must be 16 characters or fewer.";
  if (!creditor.postalCode.trim() || creditor.postalCode.trim().length > 16) return "Enter a postal code (up to 16 characters).";
  if (!creditor.city.trim() || creditor.city.trim().length > 35) return "Enter a town (up to 35 characters).";
  if (!/^[A-Z]{2}$/.test(settings.countryCode)) return "Enter the two-letter ISO country code, for example CH.";
  return null;
}

const modulo10Weights = [0, 9, 4, 6, 8, 2, 7, 1, 3, 5];

function createQrReference(documentId: string): string {
  const source = BigInt(`0x${createHash("sha256").update(documentId).digest("hex")}`) % (10n ** 26n);
  const base = source.toString().padStart(26, "0");
  let carry = 0;
  for (const character of base) carry = modulo10Weights[(carry + Number(character)) % 10];
  return `${base}${(10 - carry) % 10}`;
}

function createCreditorReference(documentId: string): string {
  const body = (BigInt(`0x${createHash("sha256").update(documentId).digest("hex")}`) % (10n ** 21n)).toString().padStart(21, "0");
  const mod97 = (value: string) => {
    let remainder = 0;
    for (const character of value) {
      const expanded = /[A-Z]/.test(character) ? String(character.charCodeAt(0) - 55) : character;
      for (const digit of expanded) remainder = (remainder * 10 + Number(digit)) % 97;
    }
    return remainder;
  };
  const checkDigits = String(98 - mod97(`${body}RF00`)).padStart(2, "0");
  return `RF${checkDigits}${body}`;
}

function createSwissQrPayload(document: PdfDocument, branding: PdfBranding, amountCents: number): { payload: string; reference: string } | null {
  const payment = branding.swissQrBill;
  if (!payment?.enabled || !["invoice", "deposit_invoice"].includes(document.kind) || amountCents <= 0) return null;
  const reference = payment.referenceType === "QRR" ? createQrReference(document.id) : payment.referenceType === "SCOR" ? createCreditorReference(document.id) : "";
  const iban = cleanIban(payment.iban);
  const payload = [
    "SPC", "0200", "1", iban,
    "S", branding.businessName.trim(), payment.street.trim(), payment.buildingNumber.trim(),
    branding.postalCode.trim(), branding.city.trim(), payment.countryCode,
    "", "", "", "", "", "", "",
    (amountCents / 100).toFixed(2), "CHF",
    "", "", "", "", "", "", "",
    payment.referenceType, reference, `Invoice ${document.number}`.slice(0, 140), "EPD",
  ].join("\n");
  return { payload, reference };
}

function drawSwissQrPaymentPart(document: PdfDocument, branding: PdfBranding, payload: string, reference: string, amountCents: number): string[] {
  const matrix = QRCode.create(payload, { errorCorrectionLevel: "M" }).modules;
  const commands = ["q", "0.6 w", "0 0 0 RG", "0 0 0 rg", "0 35 612 300 re S", "176 35 m 176 335 l S"];
  const text = (value: unknown, x: number, y: number, size = 7, maxChars = 32, bold = false) => {
    const safe = wrap(value, maxChars).slice(0, 3);
    safe.forEach((line, index) => commands.push(`BT /F1 ${bold ? size + 1 : size} Tf ${x} ${y - index * (size + 2)} Td (${escapePdf(line)}) Tj ET`));
  };
  const creditorAddress = [branding.businessName, [branding.swissQrBill?.street, branding.swissQrBill?.buildingNumber].filter(Boolean).join(" "), [branding.postalCode, branding.city].filter(Boolean).join(" "), branding.swissQrBill?.countryCode].filter(Boolean).join("\n");
  const paymentAddress = creditorAddress.split("\n");
  text("Empfangsschein / Receipt", 10, 317, 8, 30, true);
  text("Konto / Zahlbar an / Account / Payable to", 10, 299, 6.5, 34, true);
  text(cleanIban(branding.swissQrBill?.iban ?? ""), 10, 287, 7, 28, true);
  paymentAddress.forEach((line, index) => text(line, 10, 274 - index * 10, 7, 30));
  if (reference) {
    text("Referenz / Reference", 10, 226, 6.5, 30, true);
    text(reference, 10, 214, 7, 27);
  }
  text("Währung / Currency", 10, 193, 6.5, 28, true);
  text("CHF", 10, 181, 8, 8);
  text("Betrag / Amount", 90, 193, 6.5, 24, true);
  text(money(amountCents), 90, 181, 8, 16, true);
  text("Zahlbar durch / Payable by", 10, 151, 6.5, 30, true);
  text(document.customer.name ?? "", 10, 139, 7, 28);
  text([document.customer.postalCode, document.customer.city].filter(Boolean).join(" "), 10, 127, 7, 28);
  text("Annahmestelle / Acceptance point", 10, 48, 6, 30);

  text("Zahlteil / Payment part", 188, 317, 8, 28, true);
  const qrSize = 46 * 72 / 25.4;
  const qrX = 190;
  const qrY = 48;
  const unit = qrSize / matrix.size;
  const qrPath: string[] = [];
  for (let row = 0; row < matrix.size; row++) {
    for (let column = 0; column < matrix.size; column++) {
      if (matrix.data[row * matrix.size + column]) qrPath.push(`${(qrX + column * unit).toFixed(3)} ${(qrY + (matrix.size - row - 1) * unit).toFixed(3)} ${unit.toFixed(3)} ${unit.toFixed(3)} re`);
    }
  }
  commands.push(...qrPath, "f");
  const logoSize = 7 * 72 / 25.4;
  const logoX = qrX + (qrSize - logoSize) / 2;
  const logoY = qrY + (qrSize - logoSize) / 2;
  const frame = 0.8 * 72 / 25.4;
  const crossWidth = 1.35 * 72 / 25.4;
  const crossArm = 4.6 * 72 / 25.4;
  const middleX = qrX + qrSize / 2;
  const middleY = qrY + qrSize / 2;
  commands.push("1 1 1 rg", `${(logoX - frame).toFixed(3)} ${(logoY - frame).toFixed(3)} ${(logoSize + 2 * frame).toFixed(3)} ${(logoSize + 2 * frame).toFixed(3)} re f`, "0 0 0 rg", `${logoX.toFixed(3)} ${logoY.toFixed(3)} ${logoSize.toFixed(3)} ${logoSize.toFixed(3)} re f`, "1 1 1 rg", `${(middleX - crossWidth / 2).toFixed(3)} ${(middleY - crossArm / 2).toFixed(3)} ${crossWidth.toFixed(3)} ${crossArm.toFixed(3)} re f`, `${(middleX - crossArm / 2).toFixed(3)} ${(middleY - crossWidth / 2).toFixed(3)} ${crossArm.toFixed(3)} ${crossWidth.toFixed(3)} re f`, "0 0 0 rg");

  const infoX = 340;
  text("Konto / Zahlbar an / Account / Payable to", infoX, 307, 7, 38, true);
  text(cleanIban(branding.swissQrBill?.iban ?? ""), infoX, 293, 8, 34, true);
  paymentAddress.forEach((line, index) => text(line, infoX, 280 - index * 10, 8, 34));
  if (reference) {
    text("Referenz / Reference", infoX, 228, 7, 34, true);
    text(reference, infoX, 214, 8, 34);
  }
  text("Zusätzliche Informationen / Additional information", infoX, 191, 7, 38, true);
  text(`Invoice ${document.number}`, infoX, 177, 8, 34);
  text("Währung / Currency", infoX, 143, 7, 20, true);
  text("CHF", infoX, 129, 8, 12);
  text("Betrag / Amount", infoX + 82, 143, 7, 18, true);
  text(money(amountCents), infoX + 82, 129, 8, 16, true);
  text("Zahlbar durch / Payable by", infoX, 100, 7, 28, true);
  text(document.customer.name ?? "", infoX, 86, 8, 34);
  text([document.customer.postalCode, document.customer.city].filter(Boolean).join(" "), infoX, 73, 8, 34);
  commands.push("Q");
  return commands;
}

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

  const qrPayment = createSwissQrPayload(document, branding, document.balanceCents ?? document.totalCents);
  const pageLines: string[][] = [];
  const linesPerPage = qrPayment ? 29 : 48;
  for (let i = 0; i < lines.length; i += linesPerPage) pageLines.push(lines.slice(i, i + linesPerPage));
  const objects: string[] = ["<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const hasLogo = Boolean(branding.logoJpeg?.length);
  if (branding.logoJpeg) {
    const hex = branding.logoJpeg.toString("hex").toUpperCase();
    const dimensions = jpegDimensions(branding.logoJpeg) ?? { width: 640, height: 320 };
    objects.push(`<< /Type /XObject /Subtype /Image /Width ${dimensions.width} /Height ${dimensions.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /DCTDecode] /Length ${hex.length + 1} >>\nstream\n${hex}>\nendstream`);
  }
  const pageRefs: number[] = [];
  for (const [pageIndex, pageLinesPart] of pageLines.entries()) {
    const pageObject = objects.length + 1;
    const contentObject = pageObject + 1;
    pageRefs.push(pageObject);
    const pageCommands = ["q", "96 0 0 48 466 776 cm", ...(hasLogo ? ["/Logo Do"] : []), "Q", "BT", "/F1 10 Tf", "50 755 Td", "14 TL", ...pageLinesPart.map((line) => `(${escapePdf(line)}) Tj T*`), "ET"];
    if (qrPayment && pageIndex === pageLines.length - 1) pageCommands.push(...drawSwissQrPaymentPart(document, branding, qrPayment.payload, qrPayment.reference, document.balanceCents ?? document.totalCents));
    const commands = pageCommands.join("\n");
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
