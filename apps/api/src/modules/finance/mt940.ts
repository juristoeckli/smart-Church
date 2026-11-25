export type ImportedBankStatementEntry = { line: number; date: string; amount: number; description: string; reference: string };
type Mt940Statement = { entries: ImportedBankStatementEntry[]; currency: string; accountEnding: string };
const maxCents = 9_000_000_000_000_000n;

function isoDate(year: number, monthAndDay: string) {
  const date = `${year}-${monthAndDay.slice(0, 2)}-${monthAndDay.slice(2)}`;
  const time = Date.parse(date + "T00:00:00Z");
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date ? date : null;
}

function mt940Date(value: string, entryDate = "") {
  const year = 2000 + Number(value.slice(0, 2));
  const date = isoDate(year, value.slice(2));
  if (!date || !entryDate) return date;
  const day = Date.parse(date);
  const choices = [year, year - 1, year + 1].flatMap(candidate => isoDate(candidate, entryDate) ?? []);
  return choices.sort((left, right) => Math.abs(Date.parse(left) - day) - Math.abs(Date.parse(right) - day))[0] ?? null;
}

function amountCents(value: string) {
  const match = /^(\d{1,16}),(\d{0,2})$/.exec(value);
  if (!match) return null;
  const cents = BigInt(match[1]) * 100n + BigInt(match[2].padEnd(2, "0"));
  return cents <= maxCents ? cents : null;
}

function cleanField(value: string, limit: number) {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}

function readBalance(value: string) {
  const match = /^([CD])(\d{6})([A-Z]{3})([\d,]+)$/.exec(value);
  if (!match || !mt940Date(match[2])) return null;
  const cents = amountCents(match[4]);
  if (cents === null) return null;
  return { year: match[2].slice(0, 2), currency: match[3], signedCents: match[1] === "D" ? -cents : cents };
}

function readEntry(value: string, line: number, currency: string): ImportedBankStatementEntry | null {
  const match = /^(\d{6})(\d{4})?(RC|RD|D|C)([A-Z])?(\d{1,16},\d{0,2})([NSF][A-Z0-9]{3})(.*)$/.exec(value);
  if (!match || (match[4] && match[4] !== currency.at(-1))) return null;
  const date = mt940Date(match[1], match[2]);
  const cents = amountCents(match[5]);
  if (!date || cents === null || cents === 0n) return null;
  const [ownerReference, bankReference] = match[7].split("//", 2);
  const reference = cleanField(bankReference || ownerReference, 180);
  return { line, date, amount: Number(match[3] === "D" || match[3] === "RC" ? -cents : cents),
    description: "", reference: reference === "NONREF" ? "" : reference };
}

export function parseMt940(input: string): Mt940Statement | string {
  const entries: ImportedBankStatementEntry[] = [];
  let expectedAccount = "";
  let expectedCurrency = "";
  let previousClosing: bigint | null = null;
  const statementKeys = new Set<string>();
  let message: { account: string; sequence: string; balance: bigint | null; closed: boolean } | null = null;
  let entry: ImportedBankStatementEntry | null = null;
  const lines = input.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = index + 1;
    let text = lines[index].trim();
    if (text.startsWith("{1:") && text.includes("{4:")) {
      const messageType = /\{2:[IO](\d{3})/.exec(text);
      if (messageType && messageType[1] !== "940") return "The SWIFT message type must be MT940.";
      text = text.slice(text.indexOf("{4:") + 3).trim();
    }
    if (!text || text === "{4:" || /^-(?:\}\{5:.*|\})?$/.test(text)) continue;
    const field = /^:(\d{2}[A-Z]?):(.*)$/.exec(text);
    if (!field) {
      if (entry) entry.description = cleanField(entry.description + " " + text, 500);
      else return `MT940 line ${line}: expected a statement field.`;
      continue;
    }
    const [, tag, value] = field;
    if (tag === "20") {
      if (message && !message.closed) return `MT940 line ${line}: the previous statement has no closing balance.`;
      message = { account: "", sequence: "", balance: null, closed: false };
      entry = null;
      continue;
    }
    if (!message) return `MT940 line ${line}: expected a statement reference (:20:).`;
    if (tag === "86") {
      if (entry) entry.description = cleanField(entry.description + " " + value, 500);
      continue;
    }
    entry = null;
    if (tag === "25") {
      const account = value.replace(/\s/g, "").toUpperCase();
      if (message.account || message.balance !== null || !account || account.length > 120 || (expectedAccount && account !== expectedAccount)) {
        return `MT940 line ${line}: the file must use one source account.`;
      }
      message.account = expectedAccount = account;
    } else if (tag === "28C" || tag === "28") {
      if (message.sequence || !/^\d{1,5}(?:\/\d{1,5})?$/.test(value)) return `MT940 line ${line}: invalid statement number.`;
      message.sequence = value.split("/").map(part => String(Number(part))).join("/");
    } else if (tag === "60F" || tag === "60M") {
      const opening = readBalance(value);
      if (!message.account || message.balance !== null || !opening || (expectedCurrency && opening.currency !== expectedCurrency)) {
        return `MT940 line ${line}: invalid opening balance or mixed currencies.`;
      }
      if (previousClosing !== null && (opening.signedCents !== previousClosing || !message.sequence)) {
        return `MT940 line ${line}: statements in one file must be numbered and have consecutive balances.`;
      }
      message.balance = opening.signedCents;
      expectedCurrency = opening.currency;
    } else if (tag === "61") {
      const parsed = readEntry(value, line, expectedCurrency);
      if (!parsed || message.balance === null || message.closed) return `MT940 line ${line}: unsupported or invalid booked entry.`;
      if (entries.length >= 20_000) return "An MT940 file can contain at most 20,000 booked entries.";
      entries.push(parsed);
      entry = parsed;
      message.balance += BigInt(parsed.amount);
    } else if (tag === "62F" || tag === "62M") {
      const closing = readBalance(value);
      if (!closing || closing.currency !== expectedCurrency || message.closed || closing.signedCents !== message.balance) {
        return `MT940 line ${line}: the closing balance does not match the opening balance plus the booked entries.`;
      }
      const key = `${closing.year}:${message.sequence}`;
      if (statementKeys.has(key)) return `MT940 line ${line}: duplicate statement number.`;
      statementKeys.add(key);
      previousClosing = closing.signedCents;
      message.closed = true;
    } else if (!["21", "64", "65", "90C", "90D"].includes(tag)) {
      return `MT940 line ${line}: unsupported statement field :${tag}:.`;
    }
  }
  if (!message?.closed) return "An MT940 statement must have a final or intermediate closing balance.";
  if (!entries.length) return "The MT940 statement contains no booked entries.";
  return { entries, currency: expectedCurrency, accountEnding: expectedAccount.slice(-4) };
}

export function statementPreviewAmount(cents: number) {
  const absolute = BigInt(Math.abs(cents));
  return `${cents < 0 ? "-" : ""}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}
