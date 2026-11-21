import assert from "node:assert/strict";
import { fetchGuestWiki, guestWikiCategories, guestWikiPages, guestWikiRevision } from "../src/modules/churchtools-sync/wiki-copy.ts";

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
assert.deepEqual(guestWikiRevision(page("\n# Our team's notes\n\n1. Read & discuss \"today\"\n"), "8", guid), {
  guid, revision: "12", title: row.title, text: "\n# Our team's notes\n\n1. Read & discuss \"today\"\n",
  html: "<pre><code>\n# Our team&#39;s notes\n\n1. Read &amp; discuss &quot;today&quot;\n</code></pre>",
});
for (const text of ["", "<b>Legacy HTML</b>", "[Link](Wiki)", "![](relative.png)", "https://server.invalid/download?secret=abc", "Adjacent www.example.invalid", "data:payload", "abc\0", "a\u202e"]) {
  assert.equal(guestWikiRevision(page(text), "8", guid), null);
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
