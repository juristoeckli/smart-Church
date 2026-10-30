import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createGzip, gunzipSync } from "node:zlib";
import { randomBytes, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { dirname, resolve, basename, sep } from "node:path";
import { fileURLToPath } from "node:url";

export type DatasetSlide = { type: "text"; text: string; label?: string; section?: string; layout?: "lower-third" } | { type: "image"; asset: string; label: string; section?: string } | { type: "html"; asset: string; label: string; section?: string };
export interface DatasetSong { number: number; sourceNumber: number; name: string; slides: DatasetSlide[] }
export interface PresenterDataset { format: "smart-church-dataset"; version: 1; id: string; name: string; description: string; songs: DatasetSong[] }
export interface DatasetSummary { id: string; name: string; description: string; songCount: number; slideCount: number; builtIn: boolean }

const format = "smart-church-dataset";
const maxPackageBytes = 256 * 1024 * 1024;
const idPattern = /^[a-z0-9][a-z0-9-]{1,63}$/;
const builtInIds = new Set(["aktuell", "singt-notation", "singt-text", "singt-lower-third"]);

export function datasetDirectory() {
  return resolve(process.env.PRESENTER_DATASETS_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../../data/presenter-datasets"));
}

async function ensureAktuellDataset() {
  const directory = resolve(datasetDirectory(), "aktuell");
  await mkdir(directory, { recursive: true });
  const manifestPath = resolve(directory, "manifest.json");
  try {
    await readFile(manifestPath);
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
    const starter: PresenterDataset = { format, version: 1, id: "aktuell", name: "Aktuell", description: "Upcoming events and services.", songs: [{ number: 1, sourceNumber: 1, name: "Aktuell", slides: [{ type: "html", asset: "pages/slide-1.html", label: "Upcoming events" }] }] };
    try { await writeFile(manifestPath, `${JSON.stringify(starter, null, 2)}\n`, { flag: "wx" }); }
    catch (writeError) { if (!writeError || typeof writeError !== "object" || !("code" in writeError) || writeError.code !== "EEXIST") throw writeError; }
  }
  let manifest: PresenterDataset | null = null;
  try { manifest = parseManifest(await readFile(manifestPath)); } catch { /* Invalid local data is left untouched for diagnosis. */ }
  if (manifest?.id === "aktuell" && manifest.songs.length === 0) {
    const starter: PresenterDataset = { format, version: 1, id: "aktuell", name: "Aktuell", description: "Upcoming events and services.", songs: [{ number: 1, sourceNumber: 1, name: "Aktuell", slides: [{ type: "html", asset: "pages/slide-1.html", label: "Upcoming events" }] }] };
    await writeFile(manifestPath, `${JSON.stringify(starter, null, 2)}\n`);
  }
  const pagesDirectory = resolve(directory, "pages");
  await mkdir(pagesDirectory, { recursive: true });
  try { await writeFile(resolve(pagesDirectory, "slide-1.html"), "<!doctype html><html><body>Upcoming events are rendered by Presenter.</body></html>", { flag: "wx" }); }
  catch (error) { if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST") throw error; }
}

function text(value: unknown, max: number) { return typeof value === "string" && value.length <= max; }
function safeAsset(value: unknown): value is string { return typeof value === "string" && /^pages\/[A-Za-z0-9._-]+\.png$/.test(value); }
function safeHtmlAsset(value: unknown): value is string { return typeof value === "string" && /^pages\/slide-[0-9]{1,3}\.html$/.test(value); }

export function validateDataset(input: unknown): input is PresenterDataset {
  if (!input || typeof input !== "object") return false;
  const data = input as Partial<PresenterDataset>;
  if (data.format !== format || data.version !== 1 || !data.id || !idPattern.test(data.id) || typeof data.name !== "string" || !text(data.name, 120) || !data.name.trim() || !text(data.description, 500) || !Array.isArray(data.songs) || (!builtInIds.has(data.id) && data.songs.length < 1) || data.songs.length > 1000) return false;
  const numbers = new Set<number>();
  return data.songs.every((song) => {
    if (!song || !Number.isSafeInteger(song.number) || song.number < 1 || !Number.isSafeInteger(song.sourceNumber) || song.sourceNumber < 1 || !text(song.name, 300) || !song.name.trim() || !Array.isArray(song.slides) || song.slides.length < 1 || song.slides.length > 200 || numbers.has(song.number)) return false;
    numbers.add(song.number);
    return song.slides.every((slide) => {
      if (!slide || !text(slide.label ?? "", 80) || !text(slide.section ?? "", 80)) return false;
      if (slide.type === "text") return text(slide.text, 20_000) && slide.text.trim().length > 0 && (slide.layout === undefined || slide.layout === "lower-third");
      return (slide.type === "image" && safeAsset(slide.asset)) || (slide.type === "html" && safeHtmlAsset(slide.asset));
    });
  });
}

function parseManifest(buffer: Buffer) {
  const value: unknown = JSON.parse(buffer.toString("utf8"));
  if (!validateDataset(value)) throw new Error("The dataset manifest is invalid or unsupported.");
  return value;
}

export async function listDatasets(): Promise<DatasetSummary[]> {
  const root = datasetDirectory();
  await mkdir(root, { recursive: true });
  await ensureAktuellDataset();
  const folders = await readdir(root, { withFileTypes: true });
  const results: DatasetSummary[] = [];
  for (const folder of folders) {
    if (!folder.isDirectory() || !idPattern.test(folder.name)) continue;
    try {
      const manifest = parseManifest(await readFile(resolve(root, folder.name, "manifest.json")));
      if (manifest.id !== folder.name) continue;
      results.push({ id: manifest.id, name: manifest.name, description: manifest.description, songCount: manifest.songs.length, slideCount: manifest.songs.reduce((sum, song) => sum + song.slides.length, 0), builtIn: builtInIds.has(manifest.id) });
    } catch { /* Incomplete or invalid packages are not exposed. */ }
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readDataset(id: string): Promise<PresenterDataset | null> {
  if (!idPattern.test(id)) return null;
  try {
    if (id === "aktuell") await ensureAktuellDataset();
    const manifest = parseManifest(await readFile(resolve(datasetDirectory(), id, "manifest.json")));
    return manifest.id === id ? manifest : null;
  } catch { return null; }
}

export async function deleteDataset(id: string) {
  if (!idPattern.test(id)) return { deleted: false as const, reason: "not-found" as const };
  if (builtInIds.has(id)) return { deleted: false as const, reason: "built-in" as const };
  const root = datasetDirectory();
  const target = resolve(root, id);
  const manifest = await readDataset(id);
  if (!manifest) return { deleted: false as const, reason: "not-found" as const };
  await rm(target, { recursive: true, force: false });
  return { deleted: true as const };
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
  Buffer.from(octal(0, 12)).copy(header, 136);
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
  const assets = new Set(manifest.songs.flatMap((song) => song.slides.filter((slide) => slide.type === "image" || slide.type === "html").map((slide) => slide.asset)));
  for (const asset of [...assets].sort()) {
    if (!safeAsset(asset) && !safeHtmlAsset(asset)) throw new Error("The dataset references an unsafe asset path.");
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
    if (path !== "manifest.json" && !safeAsset(path) && !safeHtmlAsset(path)) throw new Error("The dataset package contains an unexpected path.");
    if (size > maxPackageBytes || offset + 512 + size > tar.length) throw new Error("The dataset archive is truncated or too large.");
    if (files.has(path)) throw new Error("The dataset archive contains duplicate files.");
    files.set(path, Buffer.from(tar.subarray(offset + 512, offset + 512 + size)));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  const manifestBytes = files.get("manifest.json");
  if (!manifestBytes) throw new Error("This package is missing manifest.json.");
  const manifest = parseManifest(manifestBytes);
  for (const song of manifest.songs) for (const slide of song.slides) {
    if ((slide.type === "image" || slide.type === "html") && !files.has(slide.asset)) throw new Error(`Missing dataset asset: ${basename(slide.asset)}`);
  }
  for (const [path, content] of files) {
    if (path === "manifest.json") continue;
    if (!manifest.songs.some((song) => song.slides.some((slide) => (slide.type === "image" || slide.type === "html") && slide.asset === path))) throw new Error("The package contains an unreferenced asset.");
    if (safeAsset(path) && (content.length < 8 || !content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))) throw new Error(`Dataset asset ${basename(path)} is not a PNG image.`);
    if (safeHtmlAsset(path) && !content.subarray(0, 256).toString("utf8").toLowerCase().includes("<!doctype html>")) throw new Error(`Dataset asset ${basename(path)} is not an HTML document.`);
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
      await writeFile(resolve(temp, path), content, { flag: "wx" });
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

export async function replaceDatasetArchives(archives: Array<{ id: string; archive: Buffer }>) {
  const root = datasetDirectory();
  await mkdir(root, { recursive: true });
  const current = await listDatasets();
  const currentById = new Map(current.map((item) => [item.id, item]));
  const incoming = new Map<string, { files: Map<string, Buffer>; builtIn: boolean }>();
  for (const item of archives) {
    if (!idPattern.test(item.id) || incoming.has(item.id)) throw new Error("Presenter dataset inventory is invalid or contains duplicate IDs.");
    const unpacked = unpackDatasetArchive(item.archive);
    if (unpacked.manifest.id !== item.id) throw new Error("A Presenter dataset archive ID does not match its manifest.");
    const existing = currentById.get(item.id);
    const builtIn = existing?.builtIn ?? false;
    if (builtIn) {
      const existingArchive = await datasetArchive(item.id);
      if (!existingArchive) throw new Error(`Built-in Presenter dataset ${item.id} is missing on the standby.`);
      const chunks: Buffer[] = [];
      for await (const chunk of existingArchive.stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      if (!Buffer.concat(chunks).equals(item.archive)) throw new Error(`Built-in Presenter dataset ${item.id} differs between servers.`);
    }
    incoming.set(item.id, { files: unpacked.files, builtIn });
  }
  const customIds = current.filter((item) => !item.builtIn).map((item) => item.id);
  const staged = new Map<string, string>();
  try {
    for (const [id, item] of incoming) {
      if (item.builtIn) continue;
      const stage = resolve(root, `.replica-${id}-${randomUUID()}`);
      await mkdir(stage, { recursive: true });
      for (const [relative, content] of item.files) {
        const target = resolve(stage, relative);
        if (!target.startsWith(`${stage}${sep}`)) throw new Error("A Presenter dataset contains an unsafe file path.");
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content, { flag: "wx" });
      }
      staged.set(id, stage);
    }
  } catch (error) {
    await Promise.all([...staged.values()].map((path) => rm(path, { recursive: true, force: true })));
    throw error;
  }
  const backups = new Map<string, string>();
  const replaced = new Set<string>();
  const backupPath = (id: string) => resolve(root, `.replica-backup-${id}-${randomUUID()}`);
  const rollback = async () => {
    for (const id of [...replaced].reverse()) await rm(resolve(root, id), { recursive: true, force: true });
    for (const [id, backup] of backups) await rename(backup, resolve(root, id)).catch(() => undefined);
    await Promise.all([...staged.values()].map((path) => rm(path, { recursive: true, force: true })));
  };
  try {
    for (const id of customIds) {
      if (incoming.has(id)) continue;
      const backup = backupPath(id);
      await rename(resolve(root, id), backup);
      backups.set(id, backup);
      replaced.add(id);
    }
    for (const [id, stage] of staged) {
      const target = resolve(root, id);
      if (currentById.has(id)) {
        const backup = backupPath(id);
        await rename(target, backup);
        backups.set(id, backup);
      }
      await rename(stage, target);
      replaced.add(id);
    }
  } catch (error) {
    await rollback();
    throw error;
  }
  return {
    rollback,
    commit: async () => {
      await Promise.all([...backups.values()].map((path) => rm(path, { recursive: true, force: true })));
      await Promise.all([...staged.values()].map((path) => rm(path, { recursive: true, force: true })));
    },
  };
}

export async function installPresentationDataset(filename: string, importedSlides: { label: string; html: string }[]) {
  if (!importedSlides.length || importedSlides.length > 200) throw new Error("The presentation must contain between 1 and 200 slides.");
  const totalHtmlBytes = importedSlides.reduce((sum, slide) => sum + Buffer.byteLength(slide.html, "utf8"), 0);
  const oversizedSlide = importedSlides.findIndex((slide) => Buffer.byteLength(slide.html, "utf8") > 30 * 1024 * 1024);
  if (oversizedSlide >= 0 || totalHtmlBytes > 220 * 1024 * 1024) throw new Error("The rendered presentation exceeds Presenter’s slide size limit.");
  const name = basename(filename).replace(/\.pptx$/i, "").replace(/[<>:"\/\\|?*\u0000-\u001f]/g, " ").trim().slice(0, 100) || "Imported presentation";
  const slug = name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 38) || "presentation";
  const id = `presentation-${slug}-${randomBytes(4).toString("hex")}`;
  const manifest: PresenterDataset = {
    format,
    version: 1,
    id,
    name,
    description: `Imported from a PowerPoint Open XML file. ${importedSlides.length} slides.`,
    songs: [{
      number: 1,
      sourceNumber: 1,
      name,
      slides: importedSlides.map((slide, index) => ({ type: "html", asset: `pages/slide-${index + 1}.html`, label: slide.label || `Slide ${index + 1}` })),
    }],
  };
  if (!validateDataset(manifest)) throw new Error("The imported presentation exceeds Presenter slide limits.");

  const root = datasetDirectory();
  await mkdir(root, { recursive: true });
  const target = resolve(root, id);
  const temp = resolve(root, `.${id}-${process.pid}-${Date.now()}.tmp`);
  await mkdir(resolve(temp, "pages"), { recursive: true });
  try {
    for (const [index, slide] of importedSlides.entries()) await writeFile(resolve(temp, `pages/slide-${index + 1}.html`), slide.html, { flag: "wx" });
    await writeFile(resolve(temp, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
    await rename(temp, target);
    return { id, name, songCount: 1, slideCount: importedSlides.length };
  } catch (error) {
    await rm(temp, { recursive: true, force: true });
    throw error;
  }
}

export async function installLibraryPicture(filename: string, image: Buffer) {
  if (!image.length || image.length > 20 * 1024 * 1024 || !image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error("Upload a valid PNG picture no larger than 20 MiB.");
  }
  const name = basename(filename).replace(/\.png$/i, "").replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").trim().slice(0, 100) || "Picture";
  const slug = name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 38) || "picture";
  const id = `presentation-${slug}-${randomBytes(4).toString("hex")}`;
  const manifest: PresenterDataset = {
    format,
    version: 1,
    id,
    name,
    description: "Imported PNG picture.",
    songs: [{ number: 1, sourceNumber: 1, name, slides: [{ type: "image", asset: "pages/page-1.png", label: name }] }],
  };
  const root = datasetDirectory();
  await mkdir(root, { recursive: true });
  const target = resolve(root, id);
  const temp = resolve(root, `.${id}-${process.pid}-${Date.now()}.tmp`);
  await mkdir(resolve(temp, "pages"), { recursive: true });
  try {
    await writeFile(resolve(temp, "pages/page-1.png"), image, { flag: "wx" });
    await writeFile(resolve(temp, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
    await rename(temp, target);
    return { id, name, songCount: 1, slideCount: 1 };
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

export async function readDatasetHtmlAsset(id: string, asset: string) {
  if (!safeHtmlAsset(asset)) return null;
  const manifest = await readDataset(id);
  if (!manifest || !manifest.songs.some((song) => song.slides.some((slide) => slide.type === "html" && slide.asset === asset))) return null;
  try { return await readFile(resolve(datasetDirectory(), id, asset)); } catch { return null; }
}
