import { Fragment, useRef, useState, type ReactNode } from "react";

export type PostBodyFormat = "plain" | "formatted";

function safeLink(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function inlineText(value: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const markers = /`([^`\n]+)`|\[([^\]\n]+)\]\(([^\s()]+)\)|\*\*([^*\n]+)\*\*|~~([^~\n]+)~~|\*([^*\n]+)\*/g;
  let offset = 0;
  for (const match of value.matchAll(markers)) {
    const [source, code, label, address, strong, strike, emphasis] = match;
    const index = match.index;
    parts.push(value.slice(offset, index));
    if (code) parts.push(<code key={index}>{code}</code>);
    else if (label) {
      const href = safeLink(address);
      parts.push(href ? <a key={index} href={href} target="_blank" rel="noopener noreferrer">{label}</a> : source);
    } else if (strong) parts.push(<strong key={index}>{strong}</strong>);
    else if (strike) parts.push(<del key={index}>{strike}</del>);
    else parts.push(<em key={index}>{emphasis}</em>);
    offset = index + source.length;
  }
  parts.push(value.slice(offset));
  return parts;
}

function tableCells(line: string | undefined): string[] {
  const text = line?.trim();
  return text?.startsWith("|") && text.endsWith("|") ? text.slice(1, -1).split("|").map((cell) => cell.trim()) : [];
}

export function PostBody({ value, format, className = "community-post-body" }: { value: string; format?: PostBodyFormat; className?: string }) {
  if (format !== "formatted") return <p className={className}>{value}</p>;
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  for (let row = 0; row < lines.length; row += 1) {
    const line = lines[row];
    if (line.trim() === "---") {
      blocks.push(<hr key={row} />);
      continue;
    }
    const header = tableCells(line);
    const separator = tableCells(lines[row + 1]);
    if (header.length > 1 && header.length === separator.length && separator.every((cell) => /^-{3,}$/.test(cell))) {
      const tableRow = row;
      const entries: string[][] = [];
      row += 1;
      for (let cells = tableCells(lines[row + 1]); cells.length === header.length; cells = tableCells(lines[row + 1])) {
        entries.push(cells);
        row += 1;
      }
      blocks.push(<div className="community-post-table" key={tableRow}><table>
        <thead><tr>{header.map((cell, index) => <th key={index} scope="col">{inlineText(cell)}</th>)}</tr></thead>
        <tbody>{entries.map((cells, index) => <tr key={index}>{cells.map((cell, column) => <td key={column}>{inlineText(cell)}</td>)}</tr>)}</tbody>
      </table></div>);
      continue;
    }
    blocks.push(<Fragment key={row}>{inlineText(line)}{row < lines.length - 1 && <br />}</Fragment>);
  }
  return <div className={`${className} community-post-body-formatted`}>{blocks}</div>;
}

export function PostBodyEditor({ value, onChange, format, onFormatChange, label, placeholder, t }: {
  value: string;
  onChange: (value: string) => void;
  format: PostBodyFormat;
  onFormatChange: (format: PostBodyFormat) => void;
  label: string;
  placeholder?: string;
  t: (message: string) => string;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [formatFeedback, setFormatFeedback] = useState("");

  function insert(before: string, after: string, example: string, block = false) {
    const input = textarea.current;
    if (!input) return;
    const start = input.selectionStart;
    const end = block ? start : input.selectionEnd;
    const selected = block ? example : value.slice(start, end) || example;
    const next = value.slice(0, start) + before + selected + after + value.slice(end);
    if (next.length > input.maxLength) {
      setFormatFeedback(t("This formatting would exceed the 4,000 character limit."));
      return;
    }
    setFormatFeedback("");
    onChange(next);
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  }

  function insertLink() {
    const address = window.prompt(t("Enter an HTTPS link"), "https://");
    if (address === null) return;
    const href = safeLink(address.trim());
    if (!href) {
      setFormatFeedback(t("Enter a valid HTTPS address."));
      return;
    }
    insert("[", `](${href.replaceAll("(", "%28").replaceAll(")", "%29")})`, t("Link text"));
  }

  return <div className="community-post-body-editor">
    <label><input type="checkbox" checked={format === "formatted"} onChange={(event) => onFormatChange(event.target.checked ? "formatted" : "plain")} />{t("Use text formatting")}</label>
    {format === "formatted" && <div className="community-post-format-actions" role="group" aria-label={t("Text formatting")}>
      <button type="button" onClick={() => insert("**", "**", t("Bold"))}>{t("Bold")}</button>
      <button type="button" onClick={() => insert("*", "*", t("Italic"))}>{t("Italic")}</button>
      <button type="button" onClick={() => insert("~~", "~~", t("Strikethrough"))}>{t("Strikethrough")}</button>
      <button type="button" onClick={() => insert("`", "`", t("Code"))}>{t("Code")}</button>
      <button type="button" onClick={insertLink}>{t("HTTPS link")}</button>
      <button type="button" onClick={() => insert("\n", "\n", "---", true)}>{t("Divider")}</button>
      <button type="button" onClick={() => insert("\n", "\n", `| ${t("Column 1")} | ${t("Column 2")} |\n| --- | --- |\n|  |  |`, true)}>{t("Table")}</button>
    </div>}
    {format === "formatted" && formatFeedback && <small role="status">{formatFeedback}</small>}
    <textarea ref={textarea} aria-label={label} maxLength={4000} required rows={4} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />
    {format === "formatted" && value.trim() && <div className="community-post-format-preview" role="region" aria-label={t("Formatting preview")}><small>{t("Formatting preview")}</small><PostBody value={value} format={format} /></div>}
  </div>;
}
