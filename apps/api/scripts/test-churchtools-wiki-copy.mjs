import assert from "node:assert/strict";
import { fetchGuestWiki, guestWikiCategories, guestWikiPages, guestWikiRevision } from "../src/modules/churchtools-sync/wiki-copy.ts";
import { registerHooks } from "node:module";
const hook = registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) {
    if (error.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith("./") && specifier.endsWith(".js")) {
      return next(specifier.slice(0,-3) + ".ts", context);
    }
    throw error;
  }
} });
const { formatGuestWikiMarkdown } = await import("../src/modules/churchtools-sync/wiki-copy-format.ts");
hook.deregister();

const guid = "681f54e3-2eb7-40a4-84f0-eff8e8f05727";
const row = { guid: guid.toUpperCase(), version: 12, title: "Help & reference", isMarkdown: true, redirectTo: null, wikiCategory: { id: 8 } };
const list = (data) => ({ data, meta: { count: data.length } });
assert.deepEqual(guestWikiCategories(list([{ id: 0, name: "System" }, { id: 8, name: "Public & private" }])), [{ id: "8", name: "Public & private" }]);
assert.throws(() => guestWikiCategories(list([{ id: 8, name: "First" }, { id: 8, name: "Second" }])), /Duplicate/);
assert.throws(() => guestWikiPages({ ...list([row]), meta: { count: 2 } }, "8"), /Incomplete/);
assert.deepEqual(guestWikiPages(list([row]), "8"), [{ guid, revision: "12", title: "Help & reference" }]);
assert.deepEqual(guestWikiPages(list([{ ...row, redirectTo: "Other page" }]), "8"), []);
assert.deepEqual(guestWikiPages(list([row]), "9"), []);

const page = (text, props = {}) => ({ data: { ...row, text, ...props } });
assert.deepEqual(guestWikiRevision(page("Raw body"), "8", guid), {
  guid, revision: "12", title: row.title, text: "Raw body",
});
for (const text of ["", "abc\0", "a\u202e"]) assert.equal(guestWikiRevision(page(text), "8", guid), null);
const input = [
  "# Our team's notes", "", "1. Read & discuss \"today\"", "2. Bring **paper** and *pen*.", "",
  "> Remember `notes`", "", "[Read this](https://server.invalid/download?secret=abc)", "![image](relative.png)", "", "[[Other]]",
].join("\n");
const format = formatGuestWikiMarkdown(input, new Map([["Other", guid]]));
assert.deepEqual(format.titles, ["Other"]);
assert.equal(format.matched, 1);
assert.equal(format.omitted, 2);
assert.match(format.html, /<h1>Our team&#39;s notes<\/h1>/);
assert.match(format.html, /<ol><li>Read &amp; discuss &quot;today&quot;<\/li><li>Bring <strong>paper<\/strong> and <em>pen<\/em>.<\/li><\/ol>/);
assert.match(format.html, /<blockquote>Remember <code>notes<\/code><\/blockquote>/);
assert.match(format.html, /<a href="#" data-entity-type="wiki" data-entity-id="681f54e3-2eb7-40a4-84f0-eff8e8f05727">Other<\/a>/);
assert.doesNotMatch(format.html, /server\.invalid|secret|relative\.png|<img/);
assert.doesNotMatch(formatGuestWikiMarkdown(input, new Map([["Other", guid]]), true).html, /href|data-entity-id/);
assert.equal(formatGuestWikiMarkdown("[[Other]]", new Map([["Other", "invalid"]])).html, "<p>Other</p>");
assert.equal(formatGuestWikiMarkdown("[[Other]]").omitted, 1);
assert.match(formatGuestWikiMarkdown("```txt\nplain & simple\n```").html, /<pre><code>plain &amp; simple<\/code><\/pre>/);
for (const text of ["<b>Legacy HTML</b>", "https://server.invalid/download", "Adjacent www.example.invalid", "data:payload", "[bad](nested(path))", "[style](javascript:(x))", "[missing][reference]", "\\[[Other]]", "`[[Other]]`", "``[[Other]]``", "```\nunfinished"]) {
  assert.equal(formatGuestWikiMarkdown(text), null);
}
assert.equal(guestWikiRevision(page("Good", { redirectTo: "Target" }), "8", guid), null);
assert.equal(guestWikiRevision(page("Good", { isMarkdown: false }), "8", guid), null);
assert.equal(guestWikiRevision(page("Good", { version: 0 }), "8", guid), null);
assert.equal(guestWikiRevision(page("Good"), "9", guid), null);
assert.equal(guestWikiRevision(page("Good"), "8", "different"), null);
assert.equal(guestWikiRevision(page("x".repeat(75001)), "8", guid), null);

const original = globalThis.fetch;
try {
  const answer = (response) => async (url, options) => {
    assert.equal(url, "https://guest.invalid/api/wiki/categories");
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    assert.deepEqual(options.headers, { Accept: "application/json" });
    return response;
  };
  const read = (url = "https://guest.invalid") => fetchGuestWiki(url, "categories", AbortSignal.timeout(1_000));
  globalThis.fetch = answer(Response.json(list([])));
  assert.deepEqual(await read(), list([]));
  globalThis.fetch = answer(new Response(null, { status: 403 }));
  assert.equal(await read(), null);
  globalThis.fetch = answer(new Response("<html>Login</html>", { headers: { "content-type": "text/html" } }));
  await assert.rejects(() => read(), /validated/);
  await assert.rejects(() => read("http://guest.invalid"), /HTTPS/);
  await assert.rejects(() => read("https://user:password@guest.invalid"), /HTTPS/);
  globalThis.fetch = answer(Response.json({ big: "a".repeat(1_200_000) }));
  await assert.rejects(() => read(), /size limit/);
} finally { globalThis.fetch = original; }
console.log("ChurchTools Wiki credential-free fetch, exact source identity and inert-content tests passed.");
