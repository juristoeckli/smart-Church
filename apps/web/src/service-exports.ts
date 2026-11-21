export function csvCell(value: string | number) {
  const cell = String(value);
  const safeCell = typeof value === "string" && /^[\s\u0000-\u001f]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]|^[\t\r\n]/u.test(cell) ? "'" + cell : cell;
  return `"${safeCell.replace(/"/g, '""')}"`;
}

export function printHtml(value: string | number) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}
