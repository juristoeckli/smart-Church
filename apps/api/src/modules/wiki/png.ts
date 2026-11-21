import { crc32, deflateSync, inflateSync } from "node:zlib";

const signature = Buffer.from("89504e470d0a1a0a", "hex");

export function pngForPdf(data: Buffer) {
  if (data.length < 33 || !data.subarray(0, 8).equals(signature)
      || data.readUInt32BE(8) !== 13 || data.toString("ascii", 12, 16) !== "IHDR"
      || crc32(data.subarray(12, 29)) !== data.readUInt32BE(29)) return null;
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  const depth = data[24];
  const colorType = data[25];
  const indexed = colorType === 3;
  const channels = [1, 0, 3, 1, 2, 0, 4][colorType] ?? 0;
  const validDepths = colorType === 0 ? [1, 2, 4, 8, 16] : indexed ? [1, 2, 4, 8] : [8, 16];
  if (!width || !height || width * height > 4_000_000 || !channels
      || !validDepths.includes(depth)
      || data[26] || data[27] || data[28]) return null;
  const alpha = colorType === 4 || colorType === 6;
  const maxSample = 2 ** depth - 1;
  const compressed: Buffer[] = [];
  let palette: Buffer | undefined;
  let transparency: Buffer | undefined;
  let imageDataClosed = false;
  let ended = false;
  for (let offset = 33; offset + 12 <= data.length;) {
    const length = data.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > data.length || crc32(data.subarray(offset + 4, end - 4)) !== data.readUInt32BE(end - 4)) return null;
    const chunk = data.toString("ascii", offset + 4, offset + 8);
    if (chunk === "PLTE") {
      if (colorType === 0 || colorType === 4 || palette || transparency || compressed.length || length < 3 || length > 768 || length % 3
          || (indexed && length / 3 > 2 ** depth)) return null;
      palette = data.subarray(offset + 8, end - 4);
    }
    if (chunk === "tRNS") {
      if (alpha || transparency || compressed.length || !length) return null;
      if (indexed ? !palette || length > palette.length / 3 : length !== channels * 2) return null;
      transparency = data.subarray(offset + 8, end - 4);
      if (!indexed) for (let c = 0; c < channels; c++) {
        if (transparency.readUInt16BE(c * 2) > maxSample) return null;
      }
    }
    if (chunk === "IDAT") {
      if (imageDataClosed || (indexed && !palette)) return null;
      compressed.push(data.subarray(offset + 8, end - 4));
    } else if (compressed.length) {
      imageDataClosed = true;
    }
    if (chunk === "IEND") { ended = length === 0 && end === data.length; break; }
    if ((data[offset + 4] & 32) === 0 && chunk !== "IDAT" && chunk !== "PLTE") return null;
    offset = end;
  }
  if (!ended || !compressed.length) return null;
  const stride = Math.ceil(width * channels * depth / 8);
  const filterBytes = Math.ceil(channels * depth / 8);
  const expectedLength = (stride + 1) * height;
  let rows: Buffer;
  try {
    rows = inflateSync(Buffer.concat(compressed), { maxOutputLength: expectedLength });
  } catch {
    return null;
  }
  if (rows.length !== expectedLength) return null;

  const colors = indexed ? 3 : alpha ? channels - 1 : channels;
  const transparentColor = transparency && !indexed
    ? Array.from({ length: channels }, (_, c) => transparency.readUInt16BE(c * 2))
    : undefined;
  const pixels = Buffer.alloc(width * height * colors);
  let position = 0;
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1) + 1;
    const filter = rows[start - 1];
    if (filter > 4) return null;
    for (let x = 0; x < stride; x++) {
      const left = x >= filterBytes ? rows[start + x - filterBytes] : 0;
      const up = y ? rows[start + x - stride - 1] : 0;
      const diagonal = y && x >= filterBytes ? rows[start + x - stride - 1 - filterBytes] : 0;
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
    if (indexed && palette) {
      for (let x = 0; x < width; x++) {
        const bit = x * depth;
        const index = (rows[start + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
        const entry = index * 3;
        if (entry >= palette.length) return null;
        const opacity = (transparency?.[index] ?? 255) / 255;
        for (let c = 0; c < 3; c++) {
          pixels[position++] = Math.round(palette[entry + c] * opacity + 255 * (1 - opacity));
        }
      }
      continue;
    }
    const sampleAt = (sample: number) => {
      if (depth === 16) return rows.readUInt16BE(start + sample * 2);
      if (depth === 8) return rows[start + sample];
      const bit = sample * depth;
      return (rows[start + (bit >> 3)] >> (8 - depth - (bit & 7))) & maxSample;
    };
    for (let x = 0; x < width; x++) {
      const sample = x * channels;
      const opacity = alpha ? sampleAt(sample + colors) / maxSample
        : transparentColor?.every((value, c) => sampleAt(sample + c) === value) ? 0 : 1;
      for (let c = 0; c < colors; c++) {
        pixels[position++] = Math.round(255 * (sampleAt(sample + c) / maxSample * opacity + 1 - opacity));
      }
    }
  }
  return { width, height, colorSpace: colors === 1 ? "DeviceGray" : "DeviceRGB", data: deflateSync(pixels) };
}
