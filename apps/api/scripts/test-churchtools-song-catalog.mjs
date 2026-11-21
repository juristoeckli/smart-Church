import assert from "node:assert/strict";
import { churchToolsSongCrosswalkId, normalizeChurchToolsSong, readChurchToolsSongCatalog } from "../src/modules/churchtools-sync/song-catalog.ts";

const song = {
  id: 17, name: " Morning Song ", author: "Alex ", ccli: "12345",
  arrangements: [
    { id: 9, name: "Evening band", key: "Bb", tempo: 82, beat: " 6/8 ", isDefault: true, files: [{ fileUrl: "https://private.example/file" }] },
    { id: 8, name: "Solo", keyOfArrangement: "C#m", bpm: "400", beat: "free", isDefault: false },
  ],
};
const normalized = normalizeChurchToolsSong(song);
assert.deepEqual({ title: normalized.title, authors: normalized.authors, bpm: normalized.bpm, timeSignature: normalized.timeSignature, key: normalized.defaultKey }, {
  title: "Morning Song", authors: "Alex", bpm: 82, timeSignature: "6/8", key: "Bb",
});
assert.equal(normalized.arrangements[1].key, "C#m");
assert.equal(normalized.arrangements[1].timeSignature, null);
assert.equal(normalized.arrangements[1].bpm, 400);
assert.doesNotMatch(JSON.stringify(normalized), /https|fileUrl|12345/);
assert.equal(normalizeChurchToolsSong({ ...song, arrangements: [] }).defaultKey, "");
assert.equal(normalizeChurchToolsSong({ ...song, arrangements: [song.arrangements[1]] }).defaultKey, "C#m");
assert.equal(normalizeChurchToolsSong({ ...song, arrangements: song.arrangements.map((row) => ({ ...row, isDefault: false })) }).defaultKey, "");
assert.throws(() => normalizeChurchToolsSong({ ...song, arrangements: [...song.arrangements, song.arrangements[0]] }), /duplicate/);
assert.throws(() => normalizeChurchToolsSong({ ...song, arrangements: null }), /arrangement list/);

const page = (data, current, lastPage, total) => ({ data, meta: { pagination: { current, lastPage, total } } });
const catalog = await readChurchToolsSongCatalog(async (current, limit) => {
  assert.equal(limit, 200);
  return current === 1 ? page([song], current, 2, 2) : page([{ ...song, id: 18 }], current, 2, 2);
});
assert.deepEqual(catalog.map((song) => song.sourceId), ["17", "18"]);
assert.deepEqual(await readChurchToolsSongCatalog(async () => page([], 1, 0, 0)), []);
await assert.rejects(readChurchToolsSongCatalog(async (current) => page([song], current, 2, 2)), /repeated/);
await assert.rejects(readChurchToolsSongCatalog(async () => page([song], 1, 101, 20_001)), /100 song catalog pages/);
await assert.rejects(readChurchToolsSongCatalog(async () => page([song], 1, 1, 2)), /incomplete/);
assert.notEqual(churchToolsSongCrosswalkId("https://one.church.tools", "17"), churchToolsSongCrosswalkId("https://two.church.tools", "17"));
console.log("ChurchTools song catalog mapping and pagination passed.");
