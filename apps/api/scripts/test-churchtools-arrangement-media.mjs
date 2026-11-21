import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) {
    if (error.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".") && specifier.endsWith(".js")) return next(specifier.slice(0, -3) + ".ts", context);
    throw error;
  }
} });
const { approvedArrangementMediaUrl, readChurchToolsArrangementMedia, buildArrangementMediaReview } = await import("../src/modules/churchtools-sync/arrangement-media.ts");
hooks.deregister();

const youtube = "https://youtu.be/dQw4w9WgXcQ";
const chart = "https://docs.google.com/document/d/e/2PACX-examplePublicationIdentifier/pub";
assert.deepEqual(approvedArrangementMediaUrl(youtube), { slot: "audio", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
assert.deepEqual(approvedArrangementMediaUrl(chart), { slot: "chart", url: chart });
for (const url of [
  "http://youtube.com/watch?v=dQw4w9WgXcQ", "https://user:password@youtube.com/watch?v=dQw4w9WgXcQ",
  "https://youtube.com.evil.invalid/watch?v=dQw4w9WgXcQ", "https://youtube.com/watch?v=dQw4w9WgXcQ&token=secret",
  "https://vimeo.com/12345/private-hash", "https://docs.google.com/document/d/privateID/edit",
  "https://churchtools.invalid/?q=public/filedownload&id=1&filename=private-download-token", "javascript:alert(1)",
]) assert.equal(approvedArrangementMediaUrl(url), null, url);

const base = { domainType: "song_arrangement", domainId: "9", securityLevelId: null, showOnlyWhenEditable: false };
const file = (id, fileUrl, extra = {}) => ({ ...base, id, type: "link", fileUrl, name: `Attachment ${id}`, ...extra });
const files = [file(1, youtube), file(2, chart, { securityLevelId: 2 }), file(3, chart, { showOnlyWhenEditable: true }),
  file(4, "https://churchtools.invalid/?token=private-download-token", { type: "file", name: "Direct chart" }),
  file(5, youtube, { name: "https://example.invalid/?token=hidden-in-label" }),
  file(6, "https://vimeo.com/2345")];
const arrangement = { data: { id: 9, links: files.slice(0, 5) } };
const media = readChurchToolsArrangementMedia(arrangement, { data: files }, "9");
assert.deepEqual(media.map(({ status }) => status), ["eligible", "restricted", "restricted", "binary_attachment", "eligible", "restricted"]);
assert.doesNotMatch(JSON.stringify(media), /private-download-token|hidden-in-label|https:\/\/vimeo\.com\/2345/);
assert.throws(() => readChurchToolsArrangementMedia(arrangement, { data: [...files, files[0]] }, "9"), /duplicate/);
assert.throws(() => readChurchToolsArrangementMedia(arrangement, { data: [file(1, youtube, { domainId: "10" })] }, "9"), /mismatched/);
const state = { target: { id: "local", songTitle: "Song", name: "Arrangement", chart: "", audio: "https://local.invalid/private-existing-reference" }, receipts: [] };
const scope = { departmentId: "site", instanceUrl: "https://churchtools.invalid", songId: "8", arrangementId: "9" };
const review = buildArrangementMediaReview(scope, state, media);
assert.equal(review.target.audio, "occupied");
assert.doesNotMatch(JSON.stringify(review), /private-existing-reference/);
assert.notEqual(review.reviewHash, buildArrangementMediaReview(scope, { ...state, target: { ...state.target, audio: "" } }, media).reviewHash);
console.log("ChurchTools arrangement media validates source identity and preserves link visibility boundaries.");
