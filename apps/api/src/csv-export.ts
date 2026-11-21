export function csvCell(value: unknown) {
  const text = String(value ?? "");
  const formula = typeof value !== "number" && (/^[\t\r\n]/u.test(text) || /^[\s\u0000-\u001f]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]/u.test(text));
  return '"' + (formula ? "'" + text : text).replaceAll('"', '""') + '"';
}

export function csvDocument(headers: readonly string[], rows: readonly (readonly unknown[])[]) {
  return "\uFEFF" + [headers, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n");
}
