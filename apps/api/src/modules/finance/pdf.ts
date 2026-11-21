const columnLimit = 118;
const pageLineLimit = 49;

// PDF's built-in Courier font supports WinAnsi. Keep Western European accents
// and escape operands as hex bytes so ledger text cannot become PDF commands.
const winAnsiExtra = "€\u0000‚ƒ„…†‡ˆ‰Š‹Œ\u0000Ž\u0000\u0000‘’“”•–—˜™š›œ\u0000žŸ";
function printable(value: unknown) {
  return Array.from(String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim(), (character) => {
    const code = character.charCodeAt(0);
    if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255)) return character;
    const extra = winAnsiExtra.indexOf(character);
    return extra >= 0 && character !== "\u0000" ? String.fromCharCode(128 + extra) : "?";
  }).join("");
}

function wrap(value: string, width: number) {
  const lines: string[] = [];
  while (value.length > width) {
    const space = value.lastIndexOf(" ", width);
    const split = space > width / 2 ? space : width;
    lines.push(value.slice(0, split));
    value = value.slice(split).trimStart();
  }
  lines.push(value);
  return lines;
}

export function financePdf(title: string, header: string[], rows: unknown[][]) {
  const available = columnLimit - (header.length - 1) * 3;
  const widths = header.map((label) => Math.min(24, printable(label).length));
  const cells = rows.map((row) => header.map((_, index) => {
    const value = printable(row[index]);
    widths[index] = Math.max(widths[index], Math.min(24, value.length));
    return value;
  }));
  while (widths.reduce((sum, width) => sum + width, 0) > available) {
    const index = widths.indexOf(Math.max(...widths));
    widths[index]--;
  }
  const tableLines = (row: string[]) => {
    const columns = row.map((value, index) => wrap(value, widths[index]));
    return Array.from({ length: Math.max(...columns.map((column) => column.length)) }, (_, line) =>
      columns.map((column, index) => (column[line] ?? "").padEnd(widths[index])).join(" | "));
  };
  const separator = widths.map((width) => "-".repeat(width)).join("-+-");
  const heading = [...wrap(printable(title), columnLimit), "", ...tableLines(header.map(printable)), separator];
  const pages = [[...heading]];
  for (const row of cells) {
    const lines = [...tableLines(row), separator];
    let page = pages[pages.length - 1];
    if (page.length > heading.length && page.length + lines.length > pageLineLimit) {
      page = [...heading];
      pages.push(page);
    }
    for (const line of lines) {
      if (page.length >= pageLineLimit) {
        page = [...heading];
        pages.push(page);
      }
      page.push(line);
    }
  }
  if (!rows.length) pages[0].push("No matching entries.");

  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>"];
  const pageRefs: number[] = [];
  for (const [index, page] of pages.entries()) {
    const pageObject = objects.length + 1;
    pageRefs.push(pageObject);
    const lines = [...page, "", `Page ${index + 1} of ${pages.length}`];
    const commands = ["BT", "/F1 10 Tf", "48 562 Td", "10 TL",
      ...lines.map((line) => `<${Buffer.from(line, "latin1").toString("hex")}> Tj T*`), "ET"].join("\n");
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageObject + 1} 0 R >>`);
    objects.push(`<< /Length ${commands.length} >>\nstream\n${commands}\nendstream`);
  }
  objects[1] = `<< /Type /Pages /Kids [${pageRefs.map((page) => `${page} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  const parts = ["%PDF-1.4\n"];
  let offset = parts[0].length;
  const offsets = objects.map((object, index) => {
    const start = offset;
    const part = `${index + 1} 0 obj\n${object}\nendobj\n`;
    parts.push(part);
    offset += part.length;
    return `${String(start).padStart(10, "0")} 00000 n \n`;
  });
  parts.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`);
  return Buffer.from(parts.join(""), "ascii");
}
