import { crc32 } from "node:zlib";
import { fromBufferPromise } from "yauzl";

const maximumArchiveFileBytes = 2_000_000;
export const maximumArchiveUploadLength = Math.ceil(maximumArchiveFileBytes / 3) * 4;
const maximumArchiveEntries = 80;
const maximumStatements = 16;
const maximumDecodedBytes = 8_000_000;

type ArchiveStatement = { filename: string; format: "camt053" | "mt940" | "paypal"; content: string };

function decodeStatement(bytes: Buffer, filename: string): Omit<ArchiveStatement, "filename"> | null {
  const bom = bytes.readUInt16BE(0);
  const utf16 = bom === 0xfffe ? "utf-16le" : bom === 0xfeff ? "utf-16be" : null;
  const sniff = new TextDecoder(utf16 ?? "utf-8").decode(bytes);
  if (sniff.trimStart().startsWith("<")) {
    const claimed = /^\s*<\?xml\s+[^?]*\bencoding\s*=\s*["']([^"']+)/i.exec(sniff.slice(0, 200))?.[1]?.toLowerCase();
    const encoding = utf16 ?? claimed ?? "utf-8";
    if (!["utf-8", "utf-16le", "utf-16be", "windows-1252", "iso-8859-1"].includes(encoding)) return null;
    return { format: "camt053", content: new TextDecoder(encoding, { fatal: true }).decode(bytes) };
  }
  if (/(?:^|\r?\n):60[FM]:/.test(sniff)) {
    let content = sniff;
    if (!utf16) {
      try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
      catch { content = new TextDecoder("windows-1252").decode(bytes); }
    }
    return { format: "mt940", content };
  }
  if (/\.csv$/i.test(filename)) return { format: "paypal", content: new TextDecoder(utf16 ?? "utf-8", { fatal: true }).decode(bytes) };
  return null;
}

export async function readStatementArchive(base64: string): Promise<ArchiveStatement[] | string> {
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length || bytes.length > maximumArchiveFileBytes || bytes.toString("base64") !== base64) {
    return "Choose a ZIP file of at most 2 MB.";
  }
  try {
    const zip = await fromBufferPromise(bytes, { validateEntrySizes: true });
    try {
      if (zip.entryCount > maximumArchiveEntries) return "The ZIP contains too many entries.";
      const statements: ArchiveStatement[] = [];
      let totalSize = 0;
      for await (const entry of zip.eachEntry()) {
        const filename = entry.fileName.split("/").at(-1)!;
        if (!filename || entry.fileName.startsWith("__MACOSX/") || filename === ".DS_Store") continue;
        const unixFileType = (entry.externalFileAttributes >>> 16) & 0xf000;
        if (unixFileType !== 0 && unixFileType !== 0x8000) return "The ZIP must contain regular statement files.";
        if (statements.length >= maximumStatements) return "Import at most 16 statements in one ZIP.";
        totalSize += entry.uncompressedSize;
        if (entry.uncompressedSize < 2 || entry.uncompressedSize > maximumArchiveFileBytes || totalSize > maximumDecodedBytes) {
          return "The uncompressed ZIP statements are outside the supported size limits.";
        }
        const stream = await zip.openReadStreamPromise(entry);
        const chunks: Buffer[] = [];
        let checksum = 0, size = 0;
        for await (const chunk of stream as AsyncIterable<Buffer>) {
          size += chunk.length;
          if (size > entry.uncompressedSize) return "A ZIP statement has an invalid size.";
          checksum = crc32(chunk, checksum);
          chunks.push(chunk);
        }
        if (size !== entry.uncompressedSize || checksum !== entry.crc32) return "A ZIP statement failed its integrity check.";
        const statement = decodeStatement(Buffer.concat(chunks, size), filename);
        if (!statement) return "A ZIP must contain only MT940, CAMT.053, or PayPal Activity Reports.";
        statements.push({ filename, ...statement });
      }
      return statements.length ? statements : "The ZIP has no statements.";
    } finally { zip.close(); }
  } catch {
    return "The ZIP archive or one of its statements could not be read.";
  }
}
