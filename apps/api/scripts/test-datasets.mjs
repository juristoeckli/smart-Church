import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";

const { datasetArchive, installDatasetArchive, listDatasets, readDataset, readDatasetAsset, unpackDatasetArchive } = await import("../src/modules/presenter/datasets.ts");
const root = await mkdtemp(resolve(tmpdir(), "smart-church-datasets-"));
process.env.PRESENTER_DATASETS_DIR = root;
const manifest = {
  format: "smart-church-dataset", version: 1, id: "fixture-dataset", name: "Fixture songs", description: "A small package for tests.",
  songs: [
    { number: 1, sourceNumber: 1, name: "First song", slides: [{ type: "text", label: "1", text: "First verse" }] },
    { number: 2, sourceNumber: 2, name: "Second song", slides: [{ type: "image", asset: "pages/001-01.png", label: "01" }] },
  ],
};

try {
  const datasetPath = resolve(root, manifest.id);
  await mkdir(resolve(datasetPath, "pages"), { recursive: true });
  await writeFile(resolve(datasetPath, "manifest.json"), JSON.stringify(manifest));
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  await writeFile(resolve(datasetPath, "pages/001-01.png"), png);
  const listed = await listDatasets();
  assert.deepEqual(listed.map(({ id, songCount, slideCount }) => ({ id, songCount, slideCount })), [{ id: manifest.id, songCount: 2, slideCount: 2 }]);
  const archive = await datasetArchive(manifest.id);
  assert.ok(archive);
  const chunks = [];
  for await (const chunk of archive.stream) chunks.push(chunk);
  const packageBytes = Buffer.concat(chunks);
  assert.equal(unpackDatasetArchive(packageBytes).manifest.id, manifest.id);

  const destination = await mkdtemp(resolve(tmpdir(), "smart-church-import-"));
  try {
    process.env.PRESENTER_DATASETS_DIR = destination;
    assert.deepEqual(await installDatasetArchive(packageBytes), { id: manifest.id, name: manifest.name, songCount: 2 });
    assert.equal((await readDataset(manifest.id))?.songs.length, 2);
    assert.deepEqual(await readDatasetAsset(manifest.id, "pages/001-01.png"), png);
  } finally { await rm(destination, { recursive: true, force: true }); }

  const header = Buffer.alloc(512);
  Buffer.from("../outside.txt").copy(header);
  Buffer.from("0000644\0").copy(header, 100);
  Buffer.from("0000000\0").copy(header, 108);
  Buffer.from("0000000\0").copy(header, 116);
  Buffer.from("00000000000\0").copy(header, 124);
  Buffer.from("00000000000\0").copy(header, 136);
  header.fill(0x20, 148, 156);
  header[156] = 0x30;
  Buffer.from("ustar\0").copy(header, 257);
  Buffer.from("00").copy(header, 263);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  Buffer.from(`${checksum.toString(8).padStart(6, "0")}\0 `).copy(header, 148);
  const payload = gzipSync(Buffer.concat([header, Buffer.alloc(1024)]));
  assert.throws(() => unpackDatasetArchive(payload), /unexpected path/i);
  console.log("Dataset tests passed: independent package export/import and path traversal rejection.");
} finally { await rm(root, { recursive: true, force: true }); }
