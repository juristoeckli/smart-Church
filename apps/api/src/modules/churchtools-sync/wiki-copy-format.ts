import { wikiGuid } from "./wiki-copy.js";

const unsafeText = /[\[\]<>]|(?:https?|ftp|mailto|file|data|javascript):|(?:^|\s)\/\/|\bwww\.|\bchurch\.tools\b|\bchurchtools\.[a-z]+\b|(?:^|\s)\/(?:api|files?|images?)\//iu;
const linkSyntax = /\[\[([^\[\]\r\n]{1,180})\]\]|(!?)\[([^\[\]\r\n]{0,180})\]\(([^()\[\]\r\n]{1,2000})\)/g;
const formatSyntax = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|__([^_\n]+)__|\*([^*\n]+)\*|~~([^~\n]+)~~/g;

function escape(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  }[character]!));
}

function safeInline(value: string, format = true) {
  if (unsafeText.test(value)) return null;
  if (!format) return escape(value);
  let html = "";
  let offset = 0;
  for (const match of value.matchAll(formatSyntax)) {
    html += escape(value.slice(offset, match.index));
    const [, code, bold, alternateBold, italic, deleted] = match;
    if (code) html += `<code>${escape(code)}</code>`;
    else if (bold || alternateBold) html += `<strong>${escape(bold ?? alternateBold)}</strong>`;
    else if (italic) html += `<em>${escape(italic)}</em>`;
    else if (deleted) html += `<del>${escape(deleted)}</del>`;
    offset = match.index + match[0].length;
  }
  return html + escape(value.slice(offset));
}

export function formatGuestWikiMarkdown(text: string, localLinks: ReadonlyMap<string, string> = new Map(), preview = false) {
  const titles = new Set<string>();
  let omitted = 0;
  let matched = 0;

  function inline(line: string) {
    let html = "";
    let offset = 0;
    for (const match of line.matchAll(linkSyntax)) {
      const prefixText = line.slice(offset, match.index);
      const escaped = (prefixText.match(/\\+$/)?.[0].length ?? 0) % 2 === 1;
      let codeFence = 0;
      for (const fence of prefixText.matchAll(/`+/g)) {
        if (!codeFence) codeFence = fence[0].length;
        else if (codeFence === fence[0].length) codeFence = 0;
      }
      if (escaped || codeFence) return null;
      const prefix = safeInline(prefixText);
      if (prefix === null) return null;
      html += prefix;
      const [, legacyTitle, image, label] = match;
      if (image) {
        html += "<em>[Image omitted]</em>";
        omitted += 1;
      } else if (legacyTitle) {
        const safeLabel = safeInline(legacyTitle, false);
        if (safeLabel === null) return null;
        titles.add(legacyTitle);
        if (titles.size > 15) return null;
        const pageId = wikiGuid(localLinks.get(legacyTitle));
        if (pageId) {
          html += preview
            ? `<span>${safeLabel}</span>`
            : `<a href="#" data-entity-type="wiki" data-entity-id="${pageId}">${safeLabel}</a>`;
          matched += 1;
        } else {
          html += safeLabel;
          omitted += 1;
        }
      } else {
        const safeLabel = safeInline(label, false);
        if (safeLabel === null) return null;
        html += safeLabel || "<em>[Link omitted]</em>";
        omitted += 1;
      }
      offset = match.index + match[0].length;
    }
    const tail = safeInline(line.slice(offset));
    return tail === null ? null : html + tail;
  }

  const blocks: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | undefined;
  let paragraph: string[] = [];
  let code: string[] | undefined;
  function closeBlocks() {
    if (list) blocks.push(`<${list.tag}>${list.items.join("")}</${list.tag}>`);
    if (paragraph.length) blocks.push(`<p>${paragraph.join(" ")}</p>`);
    list = undefined;
    paragraph = [];
  }
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^```(?:[\w+-]+)?\s*$/.test(line)) {
      if (code) {
        blocks.push(`<pre><code>${code.join("\n")}</code></pre>`);
        code = undefined;
      } else {
        closeBlocks();
        code = [];
      }
      continue;
    }
    if (code) {
      const body = safeInline(line, false);
      if (body === null) return null;
      code.push(body);
      continue;
    }
    if (!line.trim()) { closeBlocks(); continue; }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    const bullet = /^([-+*]|[1-9]\d{0,8}[.)])\s+(.+)$/.exec(line);
    const quoted = /^>\s+(.+)$/.exec(line);
    if (heading) {
      closeBlocks();
      const content = inline(heading[2]);
      if (content === null) return null;
      blocks.push(`<h${heading[1].length}>${content}</h${heading[1].length}>`);
    } else if (bullet) {
      const tag = /^\d/.test(bullet[1]) ? "ol" : "ul";
      if (list?.tag !== tag) {
        closeBlocks();
        list = { tag, items: [] };
      }
      const content = inline(bullet[2]);
      if (content === null) return null;
      list!.items.push(`<li>${content}</li>`);
    } else if (quoted) {
      closeBlocks();
      const content = inline(quoted[1]);
      if (content === null) return null;
      blocks.push(`<blockquote>${content}</blockquote>`);
    } else if (/^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      closeBlocks();
      blocks.push("<hr>");
    } else {
      if (list) closeBlocks();
      const content = inline(line);
      if (content === null) return null;
      paragraph.push(content);
    }
  }
  if (code) return null;
  closeBlocks();
  const html = blocks.join("\n");
  return html && html.length <= 500_000 ? { html, titles: [...titles], omitted, matched } : null;
}
