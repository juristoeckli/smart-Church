import { crc32, deflateSync, inflateSync } from "node:zlib";

const signature = Buffer.from("89504e470d0a1a0a", "hex");

export function pngForPdf(data: Buffer) {
  if (data.length < 33 || !data.subarray(0, 8).equals(signature)
      || data.readUInt32BE(8) !== 13 || data.toString("ascii", 12, 16) !== "IHDR"
      || crc32(data.subarray(12, 29)) !== data.readUInt32BE(29)) return null;
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  const colorType = data[25];
  const channels = [1, 0, 3, 0, 2, 0, 4][colorType] ?? 0;
  if (!width || !height || width * height > 4_000_000 || !channels || data[24] !== 8
      || data[26] || data[27] || data[28]) return null;
  const compressed: Buffer[] = [];
  let ended = false;
  for (let offset = 33; offset + 12 <= data.length;) {
    const length = data.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > data.length || crc32(data.subarray(offset + 4, end - 4)) !== data.readUInt32BE(end - 4)) return null;
    const chunk = data.toString("ascii", offset + 4, offset + 8);
    if (chunk === "IDAT") compressed.push(data.subarray(offset + 8, end - 4));
    if (chunk === "tRNS") return null;
    if (chunk === "IEND") { ended = length === 0; break; }
    if ((data[offset + 4] & 32) === 0 && chunk !== "IDAT" && chunk !== "PLTE") return null;
    offset = end;
  }
  if (!ended || !compressed.length) return null;
  const stride = width * channels;
  const expectedLength = (stride + 1) * height;
  let rows: Buffer;
  try {
    rows = inflateSync(Buffer.concat(compressed), { maxOutputLength: expectedLength });
  } catch {
    return null;
  }
  if (rows.length !== expectedLength) return null;

  const alpha = colorType === 4 || colorType === 6;
  const colors = alpha ? channels - 1 : channels;
  const pixels = Buffer.alloc(width * height * colors);
  let position = 0;
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1) + 1;
    const filter = rows[start - 1];
    if (filter > 4) return null;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? rows[start + x - channels] : 0;
      const up = y ? rows[start + x - stride - 1] : 0;
      const diagonal = y && x >= channels ? rows[start + x - stride - 1 - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      if (filter === 2) predictor = up;
      if (filter === 3) predictor = Math.floor((left + up) / 2);
      if (filter === 4) {
        const estimate = left + up - diagonal;
        const a = Math.abs(estimate - left);
        const b = Math.abs(estimate - up);
        const c = Math.abs(estimate - diagonal);
        predictor = a <= b && a <= c ? left : b <= c ? up : diagonal;
      }
      rows[start + x] = (rows[start + x] + predictor) & 255;
    }
    for (let x = 0; x < stride; x += channels) {
      const opacity = alpha ? rows[start + x + colors] / 255 : 1;
      for (let c = 0; c < colors; c++) {
        pixels[position++] = Math.round(rows[start + x + c] * opacity + 255 * (1 - opacity));
      }
    }
  }
  return { width, height, colorSpace: colors === 1 ? "DeviceGray" : "DeviceRGB", data: deflateSync(pixels) };
}
