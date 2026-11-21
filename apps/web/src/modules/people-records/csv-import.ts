export function readCsvRows(source: string, rejectUnclosedQuote = false) {
  const parsed: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (character === '"' && quoted && source[index + 1] === '"') {
      cell += '"'; index++;
    } else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) {
      row.push(cell); cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index++;
      row.push(cell);
      if (row.some(value => value.trim())) parsed.push(row);
      row = []; cell = "";
    } else cell += character;
  }
  if (quoted && rejectUnclosedQuote) throw new Error("The CSV has an unclosed quotation mark.");
  row.push(cell);
  if (row.some(value => value.trim())) parsed.push(row);
  return parsed;
}

export function membershipCsvRows(source: string) {
  const [header, ...rows] = readCsvRows(source, true);
  const names = (header ?? []).map(value => value.trim().toLowerCase().replace(/[^a-z0-9]/g, ""));
  const first = names.indexOf("firstname");
  const last = names.indexOf("lastname");
  const emailColumns = names.flatMap((name, index) => name === "email" || name === "emailaddress" ? [index] : []);
  if (first !== names.lastIndexOf("firstname") || last !== names.lastIndexOf("lastname") || emailColumns.length > 1) {
    throw new Error("Use only one column each for First name, Last name, and Email.");
  }
  const email = emailColumns[0] ?? -1;
  if (first < 0 || last < 0) throw new Error("Use a CSV with First name and Last name columns, plus Email when available.");
  if (rows.length < 1 || rows.length > 100) throw new Error("Use a CSV with one to 100 data rows.");
  return rows.map(row => ({ firstName: (row[first] ?? "").trim(), lastName: (row[last] ?? "").trim(), email: (row[email] ?? "").trim() }));
}
