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

export function createWikiPdf(title: string, html: string) {
  const text = plainText(html);
  const safeTitle = plainText(title).replace(/\s+/g, " ").trim() || "Wiki page";
  const allLines = [safeTitle, "=".repeat(Math.min(safeTitle.length, 72)), "", ...text.split("\n").flatMap((line) => wrap(line))];
  const pageLines = Array.from({ length: Math.max(1, Math.ceil(allLines.length / 52)) }, (_, index) => allLines.slice(index * 52, (index + 1) * 52));
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"];
  const pageRefs: number[] = [];
  for (const lines of pageLines) {
    const pageObject = objects.length + 1;
    const contentObject = pageObject + 1;
    pageRefs.push(pageObject);
    const commands = ["BT", "/F1 10 Tf", "50 790 Td", "14 TL", ...lines.map((line) => `(${escapePdf(line)}) Tj T*`), "ET"].join("\n");
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObject} 0 R >>`);
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
