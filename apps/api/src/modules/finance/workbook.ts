import { crc32, deflateRawSync } from "node:zlib";

const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const packageNs = "http://schemas.openxmlformats.org/package/2006";
const officeNs = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const sheetNs = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

function textCell(value: unknown) {
  return String(value ?? "")
    .replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, "")
    .replace(/_x[0-9a-f]{4}_/gi, (match) => "_x005F_" + match.slice(1))
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function zipFiles(files: Record<string, string>) {
  const local: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const [name, xmlText] of Object.entries(files)) {
    const filename = Buffer.from(name);
    const source = Buffer.from(xmlText);
    const data = deflateRawSync(source);
    const checksum = crc32(source);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(0x21, 12);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(source.length, 22);
    header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, data);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50);
    entry.writeUInt16LE(20, 4);
    header.copy(entry, 6, 4, 30);
    entry.writeUInt32LE(offset, 42);
    directory.push(entry, filename);
    offset += header.length + filename.length + data.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(directory.length / 2, 8);
  end.writeUInt16LE(directory.length / 2, 10);
  end.writeUInt32LE(directory.reduce((size, entry) => size + entry.length, 0), 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...directory, end]);
}

export function financeWorkbook(header: string[], rows: unknown[][]) {
  const numericColumns = header.map((column) => column.endsWith("_cents") || column === "transaction_count");
  return createWorkbook("Finance", header, rows, (value, column) => {
    const content = String(value ?? "");
    // Excel retains only 15 significant decimal digits. Keep longer values as exact text.
    return numericColumns[column] && /^-?\d{1,15}$/.test(content) ? "<c><v>" + content + "</v></c>" : null;
  });
}

export function createWorkbook(
  sheetName: "Finance" | "Report",
  header: string[],
  rows: unknown[][],
  typedCell = (value: unknown, _column: number): string | null => {
    if (typeof value === "boolean") return '<c t="b"><v>' + Number(value) + '</v></c>';
    if (typeof value === "number" && Number.isFinite(value) && Math.abs(value) < 1e15) return '<c><v>' + value + '</v></c>';
    if (value == null) return "<c/>";
    return null;
  },
) {
  const table = [header, ...rows].map((row, index) => {
    const cells = row.map((value, column) => {
      const typed = index ? typedCell(value, column) : null;
      if (typed !== null) return typed;
      return '<c t="inlineStr"><is><t xml:space="preserve">' + textCell(value) + "</t></is></c>";
    }).join("");
    return "<row>" + cells + "</row>";
  }).join("");

  return zipFiles({
    "[Content_Types].xml": xml + '<Types xmlns="' + packageNs + '/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    "_rels/.rels": xml + '<Relationships xmlns="' + packageNs + '/relationships"><Relationship Id="rId1" Type="' + officeNs + '/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml": xml + '<workbook xmlns="' + sheetNs + '" xmlns:r="' + officeNs + '"><sheets><sheet name="' + sheetName + '" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": xml + '<Relationships xmlns="' + packageNs + '/relationships"><Relationship Id="rId1" Type="' + officeNs + '/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml": xml + '<worksheet xmlns="' + sheetNs + '"><sheetData>' + table + '</sheetData></worksheet>',
  });
}
