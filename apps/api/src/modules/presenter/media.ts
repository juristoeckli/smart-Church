import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegPath from "ffmpeg-static";

const maxMediaBytes = 1024 * 1024 * 1024;
const maxConvertedMediaBytes = 2 * 1024 * 1024 * 1024;
const idPattern = /^[0-9a-f-]{36}$/i;
const mediaTypes = {
  "image/png": { extension: ".png", kind: "image" },
  "image/jpeg": { extension: ".jpg", kind: "image" },
  "image/webp": { extension: ".webp", kind: "image" },
  "video/mp4": { extension: ".mp4", kind: "video" },
  "video/webm": { extension: ".webm", kind: "video" },
  "video/x-msvideo": { extension: ".avi", kind: "video" },
  "video/x-ms-wmv": { extension: ".wmv", kind: "video" },
} as const;

export type PresenterMedia = {
  id: string;
  name: string;
  mimeType: keyof typeof mediaTypes;
  kind: "image" | "video";
  size: number;
  createdAt: string;
};

function runFfmpeg(input: string, output: string) {
  if (!ffmpegPath) throw new Error("Automatic AVI/WMV conversion is unavailable on this server platform.");
  const binaryPath: string = ffmpegPath;
  return new Promise<void>((resolvePromise, reject) => {
    const child = spawn(binaryPath, [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", input,
      "-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast",
      "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
      "-movflags", "+faststart", output,
    ], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] as ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4000); });
    child.once("error", reject);
    child.once("close", (code: number | null) => {
      if (code === 0) resolvePromise();
      else reject(new Error(stderr.trim() || `FFmpeg exited with code ${code ?? "unknown"}.`));
    });
  });
}

async function convertToMp4(input: string, output: string) {
  await runFfmpeg(input, output);
  const outputStat = await stat(output);
  if (!outputStat.isFile() || outputStat.size < 1) throw new Error("FFmpeg did not produce a playable video.");
  if (outputStat.size > maxConvertedMediaBytes) throw new Error("The converted video exceeds Presenter’s 2 GiB storage limit.");
  return outputStat.size;
}

function mediaRoot() {
  return resolve(process.env.PRESENTER_MEDIA_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../../data/presenter-media"));
}

function departmentDirectory(departmentId: string) {
  if (!idPattern.test(departmentId)) throw new Error("Invalid Presenter location.");
  return resolve(mediaRoot(), departmentId);
}

function hasMp4VideoData(file: Buffer) {
  let offset = 0;
  let hasMovieIndex = false;
  let hasMediaData = false;
  while (offset + 8 <= file.length) {
    let boxSize = file.readUInt32BE(offset);
    const boxType = file.toString("ascii", offset + 4, offset + 8);
    let headerSize = 8;
    if (boxSize === 1) {
      if (offset + 16 > file.length) return false;
      const extendedSize = file.readBigUInt64BE(offset + 8);
      if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) return false;
      boxSize = Number(extendedSize);
      headerSize = 16;
    } else if (boxSize === 0) {
      boxSize = file.length - offset;
    }
    if (boxSize < headerSize || offset + boxSize > file.length) return false;
    if (boxType === "moov" || boxType === "moof") hasMovieIndex = true;
    if (boxType === "mdat" && boxSize > headerSize) hasMediaData = true;
    offset += boxSize;
  }
  return hasMovieIndex && hasMediaData;
}

function isSupportedMedia(mimeType: string, file: Buffer) {
  if (mimeType === "image/png") return file.length >= 8 && file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === "image/jpeg") return file.length >= 3 && file[0] === 0xff && file[1] === 0xd8 && file[2] === 0xff;
  if (mimeType === "image/webp") return file.length >= 12 && file.toString("ascii", 0, 4) === "RIFF" && file.toString("ascii", 8, 12) === "WEBP";
  if (mimeType === "video/mp4") return file.length >= 12 && file.toString("ascii", 4, 8) === "ftyp" && hasMp4VideoData(file);
  if (mimeType === "video/webm") return file.length >= 4 && file.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (mimeType === "video/x-msvideo") return file.length >= 12 && file.toString("ascii", 0, 4) === "RIFF" && file.toString("ascii", 8, 12) === "AVI ";
  if (mimeType === "video/x-ms-wmv") return file.length >= 16 && file.subarray(0, 16).equals(Buffer.from([0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9, 0x00, 0xaa, 0x00, 0x62, 0xce, 0x6c]));
  return false;
}

function detectMediaType(mimeType: string, file: Buffer): keyof typeof mediaTypes | null {
  if (mimeType in mediaTypes && isSupportedMedia(mimeType, file)) return mimeType as keyof typeof mediaTypes;
  for (const candidate of Object.keys(mediaTypes) as Array<keyof typeof mediaTypes>) {
    if (isSupportedMedia(candidate, file)) return candidate;
  }
  return null;
}

function parseMedia(value: unknown): PresenterMedia | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<PresenterMedia>;
  if (typeof item.id !== "string" || !idPattern.test(item.id) || typeof item.name !== "string" || !item.name || typeof item.mimeType !== "string" || !(item.mimeType in mediaTypes) || (item.kind !== "image" && item.kind !== "video") || !Number.isSafeInteger(item.size) || (item.size ?? 0) < 1 || typeof item.createdAt !== "string") return null;
  return item as PresenterMedia;
}

export async function installPresenterMedia(departmentId: string, filename: string, mimeType: string, file: Buffer) {
  if (!file.length) throw new Error("The uploaded file is empty.");
  if (file.length > maxMediaBytes) throw new Error("The media file is larger than the 1 GiB import limit.");
  const detectedMimeType = detectMediaType(mimeType, file);
  const mediaType = detectedMimeType ? mediaTypes[detectedMimeType] : null;
  if (!detectedMimeType || !mediaType) throw new Error("This file is incomplete or not a supported PNG, JPEG, WebP, MP4, WebM, AVI, or WMV media file.");
  let cleanName = basename(filename).replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").trim().slice(0, 160) || `Media${mediaType.extension}`;
  let storedMimeType: keyof typeof mediaTypes = detectedMimeType;
  let storedSize = file.length;
  const root = departmentDirectory(departmentId);
  await mkdir(root, { recursive: true });
  const id = randomUUID();
  const target = resolve(root, id);
  const temp = resolve(root, `.${id}.tmp`);
  await mkdir(temp);
  try {
    if (detectedMimeType === "video/x-msvideo" || detectedMimeType === "video/x-ms-wmv") {
      const source = resolve(temp, `source${mediaType.extension}`);
      await writeFile(source, file, { flag: "wx" });
      storedSize = await convertToMp4(source, resolve(temp, "media.mp4"));
      await rm(source, { force: true });
      storedMimeType = "video/mp4";
      cleanName = cleanName.replace(/\.[^.]*$/, "") + ".mp4";
    } else {
      await writeFile(resolve(temp, `media${mediaType.extension}`), file, { flag: "wx" });
    }
    const item: PresenterMedia = { id, name: cleanName, mimeType: storedMimeType, kind: mediaType.kind, size: storedSize, createdAt: new Date().toISOString() };
    await writeFile(resolve(temp, "metadata.json"), `${JSON.stringify(item, null, 2)}\n`, { flag: "wx" });
    await rename(temp, target);
    return item;
  } catch (error) {
    await rm(temp, { recursive: true, force: true });
    throw error;
  }
}

export async function listPresenterMedia(departmentId: string) {
  const root = departmentDirectory(departmentId);
  await mkdir(root, { recursive: true });
  const entries = await readdir(root, { withFileTypes: true });
  const items: PresenterMedia[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !idPattern.test(entry.name)) continue;
    try {
      const item = parseMedia(JSON.parse(await readFile(resolve(root, entry.name, "metadata.json"), "utf8")));
      if (!item || item.id !== entry.name) continue;
      const mediaType = mediaTypes[item.mimeType];
      const file = resolve(root, item.id, `media${mediaType.extension}`);
      if (!(await stat(file)).isFile()) continue;
      items.push(item);
    } catch { /* Ignore incomplete imports. */ }
  }
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function replacePresenterMedia(departmentId: string, files: Array<{ item: PresenterMedia; data: Buffer }>) {
  if (!idPattern.test(departmentId)) throw new Error("Invalid Presenter location.");
  const ids = new Set<string>();
  for (const { item, data } of files) {
    if (!item || !idPattern.test(item.id) || ids.has(item.id) || typeof item.name !== "string" || !item.name || !(item.mimeType in mediaTypes) || item.kind !== mediaTypes[item.mimeType].kind || !data.length || data.length > maxMediaBytes || detectMediaType(item.mimeType, data) !== item.mimeType) throw new Error("The Presenter media snapshot contains an invalid file or duplicate ID.");
    ids.add(item.id);
  }
  const base = mediaRoot();
  await mkdir(base, { recursive: true, mode: 0o700 });
  const target = departmentDirectory(departmentId);
  const stage = resolve(base, `.replica-${departmentId}-${randomUUID()}`);
  await mkdir(stage, { recursive: true, mode: 0o700 });
  try {
    for (const { item, data } of files) {
      const directory = resolve(stage, item.id);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(resolve(directory, `media${mediaTypes[item.mimeType].extension}`), data, { flag: "wx", mode: 0o600 });
      await writeFile(resolve(directory, "metadata.json"), `${JSON.stringify(item, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    }
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
  const backup = resolve(base, `.replica-backup-${departmentId}-${randomUUID()}`);
  let hadTarget = false;
  let replaced = false;
  const rollback = async () => {
    if (replaced) await rm(target, { recursive: true, force: true });
    if (hadTarget) await rename(backup, target).catch(() => undefined);
    await rm(stage, { recursive: true, force: true });
  };
  try {
    try { await stat(target); hadTarget = true; } catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
    if (hadTarget) await rename(target, backup);
    await rename(stage, target);
    replaced = true;
  } catch (error) {
    await rollback();
    throw error;
  }
  return {
    rollback,
    commit: async () => {
      if (hadTarget) await rm(backup, { recursive: true, force: true });
      await rm(stage, { recursive: true, force: true });
    },
  };
}

export async function deletePresenterMedia(departmentId: string, id: string) {
  if (!idPattern.test(id)) return false;
  const target = resolve(departmentDirectory(departmentId), id);
  try {
    await rm(target, { recursive: true, force: false });
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

export async function readPresenterMedia(departmentId: string, id: string) {
  if (!idPattern.test(id)) return null;
  const root = departmentDirectory(departmentId);
  let item: PresenterMedia | null;
  try {
    item = parseMedia(JSON.parse(await readFile(resolve(root, id, "metadata.json"), "utf8")));
  } catch { return null; }
  if (!item || item.id !== id) return null;
  const mediaType = mediaTypes[item.mimeType];
  const directory = resolve(root, id);
  if (item.mimeType === "video/x-msvideo" || item.mimeType === "video/x-ms-wmv") {
    const source = resolve(directory, `media${mediaType.extension}`);
    const convertedTemp = resolve(directory, ".media.mp4.tmp");
    const size = await convertToMp4(source, convertedTemp);
    const convertedItem: PresenterMedia = {
      ...item,
      name: item.name.replace(/\.[^.]*$/, "") + ".mp4",
      mimeType: "video/mp4",
      size,
    };
    await rename(convertedTemp, resolve(directory, "media.mp4"));
    const metadataTemp = resolve(directory, ".metadata.json.tmp");
    await writeFile(metadataTemp, `${JSON.stringify(convertedItem, null, 2)}\n`);
    await rename(metadataTemp, resolve(directory, "metadata.json"));
    await rm(source, { force: true });
    return { item: convertedItem, file: await readFile(resolve(directory, "media.mp4")) };
  }
  try {
    const file = await readFile(resolve(directory, `media${mediaType.extension}`));
    return { item, file };
  } catch { return null; }
}
