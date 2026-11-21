import { createHash } from "node:crypto";

export function hashFeedToken(value: string) { return createHash("sha256").update(value).digest("hex"); }

export function icsEscape(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

export function foldIcsLine(value: string) {
  const fragments: string[] = [];
  let line = "";
  let bytes = 0;
  for (const character of value) {
    const width = Buffer.byteLength(character);
    if (bytes + width > 75) {
      fragments.push(line);
      line = " ";
      bytes = 1;
    }
    line += character;
    bytes += width;
  }
  return [...fragments, line].join("\r\n");
}
