import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const sourceFlag = process.argv.indexOf("--source");
const source = sourceFlag >= 0 ? process.argv[sourceFlag + 1] : undefined;
if (!source) throw new Error("Usage: node apps/api/scripts/import-singt-datasets.mjs --source <old-tool-content-singt-directory>");
const sourceRoot = resolve(source);
const outputRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../data/presenter-datasets");
const raw = JSON.parse(await readFile(join(sourceRoot, "text-library.json"), "utf8"));
const sourceSongs = raw.songs.filter((song) => song.libraryId === "singt-text");
const definitions = [
  { id: "singt-notation", name: "Singt with musical notes", description: "The original notation pages from the Singt songbook.", libraryId: "singt-text" },
  { id: "singt-text", name: "Singt just text", description: "Native text slides from the Singt songbook.", libraryId: "singt-text" },
  { id: "singt-lower-third", name: "Singt lower third", description: "Singt lyrics prepared for lower-third presentation.", libraryId: "singt-lower-third" },
];
const pageFiles = [];
async function findPngs(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await findPngs(path);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".png")) pageFiles.push(path);
  }
}
await findPngs(join(sourceRoot, "Songs"));
const pagesBySong = new Map();
for (const file of pageFiles) {
  const match = /^(\d{3})-(\d{2})\.png$/i.exec(basename(file));
  if (!match) continue;
  const number = Number(match[1]);
  pagesBySong.set(number, [...(pagesBySong.get(number) ?? []), file]);
}
await mkdir(outputRoot, { recursive: true });
for (const definition of definitions) {
  const songs = sourceSongs.map((sourceSong) => {
    if (definition.id === "singt-notation") {
      const pages = (pagesBySong.get(sourceSong.sourceNumber) ?? []).sort((a, b) => basename(a).localeCompare(basename(b), "en", { numeric: true }));
      return {
        number: sourceSong.sourceNumber,
        sourceNumber: sourceSong.sourceNumber,
        name: sourceSong.name.replace(/ \(draft\)$/, "").trim() || `Singt song ${String(sourceSong.sourceNumber).padStart(3, "0")}`,
        slides: pages.map((file) => ({ type: "image", asset: `pages/${basename(file)}`, label: basename(file).replace(/^\d{3}-|\.png$/gi, "") })),
      };
    }
    const sourceVersion = raw.songs.find((song) => song.sourceNumber === sourceSong.sourceNumber && song.libraryId === definition.libraryId);
    if (!sourceVersion) throw new Error(`Missing ${definition.libraryId} version of song ${sourceSong.sourceNumber}`);
    return { number: sourceVersion.number, sourceNumber: sourceVersion.sourceNumber, name: sourceVersion.name, slides: sourceVersion.slides };
  }).filter((song) => song.slides.length > 0);
  const manifest = { format: "smart-church-dataset", version: 1, id: definition.id, name: definition.name, description: definition.description, songs };
  const directory = resolve(outputRoot, definition.id);
  await rm(directory, { recursive: true, force: true });
  await mkdir(resolve(directory, "pages"), { recursive: true });
  await writeFile(resolve(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  if (definition.id === "singt-notation") {
    for (const song of songs) for (const slide of song.slides) {
      const sourceFile = (pagesBySong.get(song.sourceNumber) ?? []).find((file) => basename(file) === basename(slide.asset));
      if (!sourceFile) throw new Error(`Missing notation page ${slide.asset}`);
      await copyFile(sourceFile, resolve(directory, slide.asset));
    }
  }
  console.log(`${definition.name}: ${songs.length} songs, ${songs.reduce((count, song) => count + song.slides.length, 0)} slides`);
}
console.log(`Installed source datasets under ${outputRoot}. They are runtime data and are excluded from Git.`);
