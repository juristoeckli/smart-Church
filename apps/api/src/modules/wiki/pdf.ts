import { pngForPdf } from "./png.js";

function escapePdf(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function plainText(value: string) {
  return value
    .replace(/<li\b[^>]*>/gi, "\n  * ")
    .replace(/<\/(?:p|div|blockquote|pre|h[1-6]|tr|ul|ol|table)\s*>/gi, "\n")
    .replace(/<br\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_entity, code: string) => {
      const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
      if (code[0] !== "#") return named[code.toLowerCase()] ?? "";
      const numeric = code[1]?.toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      try { return Number.isFinite(numeric) && numeric > 0 && numeric <= 0x10ffff ? String.fromCodePoint(numeric) : ""; } catch { return ""; }
    })
    .replace(/[\t\r\f\v ]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u00df]/g, "ss")
    .replace(/[\u00e6\u00c6]/g, "ae")
    .replace(/[\u00f8\u00d8]/g, "o")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\x20-\x7e\n]/g, "?");
}

function tableText(table: string) {
  const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)].map((match) =>
    [...(match[1] ?? "").matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)\s*>/gi)].map((cell) =>
      plainText(cell[1] ?? "").replace(/\s+/g, " ").trim(),
    ),
  ).filter((row) => row.length > 0);
  if (!rows.length) return "";
  const columnCount = Math.max(...rows.map((row) => row.length));
  const columnWidth = Math.max(1, Math.min(24, Math.floor((88 - (columnCount + 1) * 3) / columnCount)));
  const widths = Array.from({ length: columnCount }, (_, column) =>
    Math.min(columnWidth, Math.max(1, ...rows.map((row) => Math.min(columnWidth, (row[column] ?? "").length)))),
  );
  const border = `+${widths.map((width) => "-".repeat(width + 2)).join("+")}+`;
  const lines = [border];
  for (const row of rows) {
    const wrapped = row.map((cell, index) => wrap(cell, widths[index]));
    const rowHeight = Math.max(1, ...wrapped.map((cellLines) => cellLines.length));
    for (let line = 0; line < rowHeight; line++) {
      lines.push(`|${widths.map((width, index) => ` ${(wrapped[index]?.[line] ?? "").padEnd(width)} `).join("|")} |`);
    }
    lines.push(border);
  }
  return lines.join("\n");
}

function pdfTextLines(html: string) {
  const withTables = html.replace(/<table\b[^>]*>[\s\S]*?<\/table\s*>/gi, (table) => `\n${tableText(table)}\n`);
  return plainText(withTables);
}

export type WikiPdfImage = { title: string; fileName: string; data: Buffer };

function jpegDimensions(data: Buffer): { width: number; height: number; colorSpace: "DeviceRGB" | "DeviceGray" } | null {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 < data.length) {
    if (data[offset] !== 0xff) { offset++; continue; }
    const marker = data[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
    if (offset + 2 > data.length) return null;
    const length = data.readUInt16BE(offset);
    if (length < 2 || offset + length > data.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 8) return null;
      const height = data.readUInt16BE(offset + 3);
      const width = data.readUInt16BE(offset + 5);
      const components = data[offset + 7];
      if (!width || !height || (components !== 1 && components !== 3)) return null;
      return { width, height, colorSpace: components === 1 ? "DeviceGray" : "DeviceRGB" };
    }
    offset += length;
  }
  return null;
}

function wrap(line: string, width = 92) {
  const words = line.trim().split(/\s+/).filter(Boolean);
  const result: string[] = [];
  let current = "";
  for (const word of words) {
    const parts = word.match(new RegExp(`.{1,${width}}`, "g")) ?? [word];
    for (const part of parts) {
      if (current && `${current} ${part}`.length > width) { result.push(current); current = part; }
      else current = current ? `${current} ${part}` : part;
    }
  }
  result.push(current);
  return result;
}

export function createWikiPdf(title: string, html: string, images: WikiPdfImage[] = []) {
  const text = pdfTextLines(html);
  const safeTitle = plainText(title).replace(/\s+/g, " ").trim() || "Wiki page";
  const allLines = [safeTitle, "=".repeat(Math.min(safeTitle.length, 72)), "", ...text.split("\n").flatMap((line) => wrap(line))];
  const pageLines = Array.from({ length: Math.max(1, Math.ceil(allLines.length / 52)) }, (_, index) => allLines.slice(index * 52, (index + 1) * 52));
  const objects: Buffer[] = [Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "ascii"), Buffer.alloc(0), Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>", "ascii")];
  const pageRefs: number[] = [];
  for (const lines of pageLines) {
    const pageObject = objects.length + 1;
    const contentObject = pageObject + 1;
    pageRefs.push(pageObject);
    const commands = ["BT", "/F1 10 Tf", "50 790 Td", "14 TL", ...lines.map((line) => `(${escapePdf(line)}) Tj T*`), "ET"].join("\n");
    objects.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObject} 0 R >>`, "ascii"));
    objects.push(Buffer.from(`<< /Length ${Buffer.byteLength(commands, "ascii")} >>\nstream\n${commands}\nendstream`, "ascii"));
  }

  for (const image of images.slice(0, 5)) {
    if (image.data.length > 2_000_000) continue;
    const jpeg = jpegDimensions(image.data);
    const png = jpeg ? null : pngForPdf(image.data);
    const dimensions = jpeg ?? png;
    if (!dimensions) continue;
    const imageData = png?.data ?? image.data;
    const imageFilter = png ? "FlateDecode" : "DCTDecode";
    const imageObject = objects.length + 1;
    const pageObject = imageObject + 1;
    const contentObject = imageObject + 2;
    const scale = Math.min(500 / dimensions.width, 620 / dimensions.height, 1);
    const width = Math.round(dimensions.width * scale);
    const height = Math.round(dimensions.height * scale);
    const x = Math.round((612 - width) / 2);
    const y = 110;
    const caption = plainText(image.title || image.fileName).replace(/\s+/g, " ").trim().slice(0, 90);
    const fileLabel = plainText(image.fileName).replace(/\s+/g, " ").trim().slice(0, 120);
    const commands = [
      "BT", "/F1 14 Tf", "50 800 Td", `(${escapePdf(caption || "Attached image")}) Tj`,
      "0 -18 Td", "/F1 9 Tf", `(${escapePdf(fileLabel)}) Tj`, "ET",
      "q", `${width} 0 0 ${height} ${x} ${y} cm`, "/Im1 Do", "Q",
    ].join("\n");
    objects.push(Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${dimensions.width} /Height ${dimensions.height} /ColorSpace /${dimensions.colorSpace} /BitsPerComponent 8 /Filter /${imageFilter} /Length ${imageData.length} >>\nstream\n`, "ascii"),
      imageData,
      Buffer.from("\nendstream", "ascii"),
    ]));
    objects.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 3 0 R >> /XObject << /Im1 ${imageObject} 0 R >> >> /Contents ${contentObject} 0 R >>`, "ascii"));
    objects.push(Buffer.from(`<< /Length ${Buffer.byteLength(commands, "ascii")} >>\nstream\n${commands}\nendstream`, "ascii"));
    pageRefs.push(pageObject);
  }
  objects[1] = Buffer.from(`<< /Type /Pages /Kids [${pageRefs.map((reference) => `${reference} 0 R`).join(" ")}] /Count ${pageRefs.length} >>`, "ascii");
  const outputParts: Buffer[] = [Buffer.from("%PDF-1.4\n", "ascii")];
  let outputLength = outputParts[0].length;
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(outputLength);
    const prefix = Buffer.from(`${index + 1} 0 obj\n`, "ascii");
    const suffix = Buffer.from("\nendobj\n", "ascii");
    outputParts.push(prefix, object, suffix);
    outputLength += prefix.length + object.length + suffix.length;
  });
  const xrefOffset = outputLength;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  outputParts.push(Buffer.from(xref, "ascii"));
  return Buffer.concat(outputParts);
}
