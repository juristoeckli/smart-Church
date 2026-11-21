import { crc32 } from "node:zlib";

export const maxPortraitBytes = 2 * 1024 * 1024;
const signature = Buffer.from("89504e470d0a1a0a", "hex");
const portraitColorTypes = new Set([0, 2, 4, 6]);
const supportedMetadata = new Set(["bKGD", "cHRM", "gAMA", "pHYs", "sBIT", "sRGB", "tIME", "tRNS"]);

export function isPortraitPng(bytes: Buffer): boolean {
  if (bytes.length < 45 || bytes.length > maxPortraitBytes || !bytes.subarray(0, 8).equals(signature)
    || bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR") return false;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (!width || !height || width > 2048 || height > 2048 || width * height > 1_000_000
    || bytes[24] !== 8 || !portraitColorTypes.has(bytes[25]) || bytes[26] || bytes[27] || bytes[28]) return false;

  let foundData = false;
  let finishedData = false;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const end = offset + 12 + bytes.readUInt32BE(offset);
    if (end > bytes.length || crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) return false;
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) return false;
    if (type === "IDAT") {
      if (finishedData || end === offset + 12) return false;
      foundData = true;
    } else if (foundData) finishedData = true;
    if (type === "IEND") return end === bytes.length && end === offset + 12 && foundData;
    if (offset > 8 && type !== "IDAT" && !supportedMetadata.has(type)) return false;
    offset = end;
  }
  return false;
}
