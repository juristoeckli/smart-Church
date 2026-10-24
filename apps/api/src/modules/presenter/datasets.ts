import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createGzip, gunzipSync } from "node:zlib";
import { Readable } from "node:stream";
import { dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

export type DatasetSlide = { type: "text"; text: string; label?: string; section?: string; layout?: "lower-third" } | { type: "image"; asset: string; label: string; section?: string };
export interface DatasetSong { number: number; sourceNumber: number; name: string; slides: DatasetSlide[] }
export interface PresenterDataset { format: "smart-church-dataset"; version: 1; id: string; name: string; description: string; songs: DatasetSong[] }
export interface DatasetSummary { id: string; name: string; description: string; songCount: number; slideCount: number; builtIn: boolean }

const format = "smart-church-dataset";
const maxPackageBytes = 256 * 1024 * 1024;
const idPattern = /^[a-z0-9][a-z0-9-]{1,63}$/;
const builtInIds = new Set(["singt-notation", "singt-text", "singt-lower-third"]);

export function datasetDirectory() {
  return resolve(process.env.PRESENTER_DATASETS_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../../data/presenter-datasets"));
}

function text(value: unknown, max: number) { return typeof value === "string" && value.length <= max; }
function safeAsset(value: unknown): value is string { return typeof value === "string" && /^pages\/[A-Za-z0-9._-]+\.png$/.test(value); }

export function validateDataset(input: unknown): input is PresenterDataset {
  if (!input || typeof input !== "object") return false;
  const data = input as Partial<PresenterDataset>;
  if (data.format !== format || data.version !== 1 || !data.id || !idPattern.test(data.id) || typeof data.name !== "string" || !text(data.name, 120) || !data.name.trim() || !text(data.description, 500) || !Array.isArray(data.songs) || data.songs.length < 1 || data.songs.length > 1000) return false;
  const numbers = new Set<number>();
  return data.songs.every((song) => {
    if (!song || !Number.isSafeInteger(song.number) || song.number < 1 || !Number.isSafeInteger(song.sourceNumber) || song.sourceNumber < 1 || !text(song.name, 300) || !song.name.trim() || !Array.isArray(song.slides) || song.slides.length < 1 || song.slides.length > 200 || numbers.has(song.number)) return false;
    numbers.add(song.number);
    return song.slides.every((slide) => {
      if (!slide || !text(slide.label ?? "", 80) || !text(slide.section ?? "", 80)) return false;
      if (slide.type === "text") return text(slide.text, 20_000) && slide.text.trim().length > 0 && (slide.layout === undefined || slide.layout === "lower-third");
      return slide.type === "image" && safeAsset(slide.asset);
    });
  });
}

function parseManifest(buffer: Buffer) {
  const value: unknown = JSON.parse(buffer.toString("utf8"));
  if (!validateDataset(value)) throw new Error("The dataset manifest is invalid or unsupported.");
  return value;
}

export async function listDatasets(): Promise<DatasetSummary[]> {
  await mkdir(datasetDirectory(), { recursive: true });
  const folders = await readdir(datasetDirectory(), { withFileTypes: true });
  const results: DatasetSummary[] = [];
  for (const folder of folders) {
    if (!folder.isDirectory() || !idPattern.test(folder.name)) continue;
    try {
      const manifest = parseManifest(await readFile(resolve(datasetDirectory(), folder.name, "manifest.json")));
      if (manifest.id !== folder.name) continue;
      results.push({ id: manifest.id, name: manifest.name, description: manifest.description, songCount: manifest.songs.length, slideCount: manifest.songs.reduce((sum, song) => sum + song.slides.length, 0), builtIn: builtInIds.has(manifest.id) });
    } catch { /* Incomplete or invalid packages are not exposed. */ }
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readDataset(id: string): Promise<PresenterDataset | null> {
  if (!idPattern.test(id)) return null;
  try {
    const manifest = parseManifest(await readFile(resolve(datasetDirectory(), id, "manifest.json")));
    return manifest.id === id ? manifest : null;
  } catch { return null; }
}

function octal(value: number, length: number) { return `${value.toString(8).padStart(length - 1, "0")}\0`; }
function tarHeader(path: string, size: number) {
  const name = Buffer.from(path);
  if (name.length > 100) throw new Error("Dataset file name is too long.");
  const header = Buffer.alloc(512);
  name.copy(header, 0);
  Buffer.from(octal(0o644, 8)).copy(header, 100);
  Buffer.from(octal(0, 8)).copy(header, 108);
  Buffer.from(octal(0, 8)).copy(header, 116);
  Buffer.from(octal(size, 12)).copy(header, 124);
  Buffer.from(octal(Math.floor(Date.now() / 1000), 12)).copy(header, 136);
  header.fill(0x20, 148, 156);
  header[156] = 0x30;
  Buffer.from("ustar\0").copy(header, 257);
  Buffer.from("00").copy(header, 263);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  Buffer.from(`${checksum.toString(8).padStart(6, "0")}\0 `).copy(header, 148);
  return header;
}

async function* tarEntries(manifest: PresenterDataset, root: string) {
  const json = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  for (const [path, content] of [["manifest.json", json] as const]) {
    yield tarHeader(path, content.length); yield content;
    const padding = (512 - content.length % 512) % 512;
    if (padding) yield Buffer.alloc(padding);
  }
  const assets = new Set(manifest.songs.flatMap((song) => song.slides.filter((slide) => slide.type === "image").map((slide) => slide.asset)));
  for (const asset of [...assets].sort()) {
    if (!safeAsset(asset)) throw new Error("The dataset references an unsafe asset path.");
    const path = resolve(root, asset);
    const info = await stat(path);
    if (!info.isFile() || info.size > maxPackageBytes) throw new Error("A dataset asset is missing or too large.");
    yield tarHeader(asset, info.size);
    for await (const chunk of createReadStream(path)) yield chunk as Buffer;
    const padding = (512 - info.size % 512) % 512;
    if (padding) yield Buffer.alloc(padding);
  }
  yield Buffer.alloc(1024);
}

export async function datasetArchive(id: string) {
  const manifest = await readDataset(id);
  if (!manifest) return null;
  const stream = Readable.from(tarEntries(manifest, resolve(datasetDirectory(), id))).pipe(createGzip({ level: 6 }));
  return { filename: `${id}.scdataset.tar.gz`, stream };
}

function tarString(buffer: Buffer, offset: number, length: number) { return buffer.subarray(offset, offset + length).toString("utf8").replace(/\0.*$/s, ""); }
function tarNumber(buffer: Buffer, offset: number, length: number) {
  const raw = tarString(buffer, offset, length).trim();
  if (!/^[0-7]*$/.test(raw)) throw new Error("The dataset archive has an invalid file size.");
  return Number.parseInt(raw || "0", 8);
}

export function unpackDatasetArchive(gzipped: Buffer) {
  if (gzipped.length > maxPackageBytes) throw new Error("Dataset package exceeds the 256 MiB compressed size limit.");
  const tar = gunzipSync(gzipped, { maxOutputLength: maxPackageBytes });
  const files = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = tarString(header, 0, 100);
    const prefix = tarString(header, 345, 155);
    const path = prefix ? `${prefix}/${name}` : name;
    const expectedChecksum = tarNumber(header, 148, 8);
    const checksumHeader = Buffer.from(header);
    checksumHeader.fill(0x20, 148, 156);
    if (checksumHeader.reduce((sum, byte) => sum + byte, 0) !== expectedChecksum) throw new Error("The dataset archive contains a corrupted file header.");
    const size = tarNumber(header, 124, 12);
    const type = header[156];
    if (type !== 0 && type !== 0x30) throw new Error("Only regular files are allowed in a dataset package.");
    if (path !== "manifest.json" && !safeAsset(path)) throw new Error("The dataset package contains an unexpected path.");
    if (size > maxPackageBytes || offset + 512 + size > tar.length) throw new Error("The dataset archive is truncated or too large.");
    if (files.has(path)) throw new Error("The dataset archive contains duplicate files.");
    files.set(path, Buffer.from(tar.subarray(offset + 512, offset + 512 + size)));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  const manifestBytes = files.get("manifest.json");
  if (!manifestBytes) throw new Error("This package is missing manifest.json.");
  const manifest = parseManifest(manifestBytes);
  for (const song of manifest.songs) for (const slide of song.slides) {
    if (slide.type === "image" && !files.has(slide.asset)) throw new Error(`Missing dataset image: ${basename(slide.asset)}`);
  }
  for (const [path, content] of files) {
    if (path === "manifest.json") continue;
    if (!manifest.songs.some((song) => song.slides.some((slide) => slide.type === "image" && slide.asset === path))) throw new Error("The package contains an unreferenced asset.");
    if (content.length < 8 || !content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error(`Dataset asset ${basename(path)} is not a PNG image.`);
  }
  return { manifest, files };
}

export async function installDatasetArchive(gzipped: Buffer) {
  const { manifest, files } = unpackDatasetArchive(gzipped);
  const root = datasetDirectory();
  await mkdir(root, { recursive: true });
  const target = resolve(root, manifest.id);
  const temp = resolve(root, `.${manifest.id}-${process.pid}-${Date.now()}.tmp`);
  await mkdir(resolve(temp, "pages"), { recursive: true });
  try {
    for (const [path, content] of files) {
      const output = path === "manifest.json" ? resolve(temp, path) : resolve(temp, path);
      await writeFile(output, content, { flag: "wx" });
    }
    const existing = await readDataset(manifest.id);
    if (existing && builtInIds.has(manifest.id)) throw new Error("Built-in Singt datasets are read-only and cannot be replaced.");
    if (existing) throw new Error("A dataset with this ID is already installed. Import it into a server where it is not installed yet.");
    await rename(temp, target);
    return { id: manifest.id, name: manifest.name, songCount: manifest.songs.length };
  } catch (error) {
    await rm(temp, { recursive: true, force: true });
    throw error;
  }
}

export async function readDatasetAsset(id: string, asset: string) {
  if (!safeAsset(asset)) return null;
  const manifest = await readDataset(id);
  if (!manifest || !manifest.songs.some((song) => song.slides.some((slide) => slide.type === "image" && slide.asset === asset))) return null;
  try { return await readFile(resolve(datasetDirectory(), id, asset)); } catch { return null; }
}
