import { SaxesParser } from "saxes";
import type { ImportedBankStatementEntry } from "./mt940.js";

type Element = {
  name: string;
  text: string;
  currency?: string;
  children: Element[];
};
type Statement = { entries: ImportedBankStatementEntry[]; accountEnding: string; currency: string; sourceAccount: string; sourceAccountIsIban: boolean; profile?: "stuzza" };

const camtNamespace = /^urn:iso:std:iso:20022:tech:xsd:camt\.053\.001\.\d{2}$/;
// PSA Austrian rulebook versions for the legacy CAMT.053.001.02 envelope.
const stuzzaNamespaces = new Set([
  "ISO:camt.053.001.02:APC:STUZZA:payments:003",
  "ISO:camt.053.001.02:APC:STUZZA:payments:004",
]);
const maxCents = 9_000_000_000_000_000n;

function readXml(input: string) {
  const stack: Element[] = [];
  const parser = new SaxesParser({ xmlns: true });
  let namespace = "";
  let root: Element | undefined;
  let elementCount = 0;
  parser.on("doctype", () => { throw new Error("Document type declarations are not allowed in CAMT.053 files."); });
  parser.on("opentag", tag => {
    if (!stack.length) {
      if (tag.local !== "Document" || (!camtNamespace.test(tag.uri) && !stuzzaNamespaces.has(tag.uri))) {
        throw new Error("Choose a CAMT.053 bank statement. Intraday and notification files cannot be imported.");
      }
      namespace = tag.uri;
    }
    if (stack.length >= 64 || ++elementCount > 200_000) throw new Error("The CAMT.053 file is too complex.");
    const parent = stack.at(-1);
    // Keep extension content disconnected so it cannot supply statement fields.
    const name = tag.uri === namespace && parent?.name !== "" ? tag.local : "";
    const currency = tag.attributes.Ccy;
    const node: Element = { name, text: "", children: [], currency: currency?.uri === "" ? currency.value : undefined };
    if (parent) parent.children.push(node);
    else root = node;
    stack.push(node);
  });
  const appendText = (part: string) => {
    const node = stack.at(-1);
    if (node) node.text += part;
  };
  parser.on("text", appendText);
  parser.on("cdata", appendText);
  parser.on("closetag", () => { stack.pop(); });
  parser.on("error", () => { throw new Error("The CAMT.053 file is not well-formed XML."); });
  parser.write(input).close();
  if (!root) throw new Error("The CAMT.053 file is empty.");
  return { root, stuzza: stuzzaNamespaces.has(namespace) };
}

const children = (node: Element | undefined, name: string) => node?.children.filter(child => child.name === name) ?? [];

function child(node: Element | undefined, name: string) {
  const matches = children(node, name);
  if (matches.length > 1) throw new Error("A CAMT.053 field is repeated where only one value is allowed.");
  return matches[0];
}

const text = (node: Element | undefined) => node?.text.trim() ?? "";
const value = (node: Element | undefined, name: string) => text(child(node, name));
const clean = (input: string, length: number) => input.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, length);

function direction(node: Element) {
  const indicator = value(node, "CdtDbtInd");
  if (indicator === "CRDT") return 1n;
  if (indicator === "DBIT") return -1n;
  throw new Error("A CAMT.053 entry has an invalid credit or debit indicator.");
}

function readAmount(node: Element, currency: string) {
  const amount = child(node, "Amt");
  const match = /^(\d{1,16})(?:\.(\d{1,18}))?$/.exec(text(amount));
  if (!amount || amount.currency !== currency || !match || /[1-9]/.test(match[2]?.slice(2) ?? "")) {
    throw new Error("A CAMT.053 amount has a different currency or cannot be represented in exact cents.");
  }
  const cents = BigInt(match[1]!) * 100n + BigInt((match[2] ?? "").slice(0, 2).padEnd(2, "0"));
  if (cents > maxCents) throw new Error("A CAMT.053 amount is too large.");
  return cents * direction(node);
}

function entryDate(entry: Element) {
  const booking = child(entry, "BookgDt");
  const day = value(booking, "Dt");
  const timestamp = value(booking, "DtTm");
  if (day && timestamp) return "";
  const date = day || timestamp.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith("0000")) return "";
  if (!day && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(timestamp) || !Number.isFinite(Date.parse(timestamp)))) return "";
  const parsed = new Date(date + "T00:00:00Z");
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date ? date : "";
}

function entryMemo(entry: Element) {
  const transaction = children(entry, "NtryDtls").flatMap(detail => children(detail, "TxDtls"));
  const details = transaction.flatMap(detail => children(child(detail, "RmtInf"), "Ustrd").map(text));
  const transactionReference = transaction.length === 1 ? child(transaction[0], "Refs") : undefined;
  const reference = [
    value(entry, "AcctSvcrRef"), value(entry, "NtryRef"),
    value(transactionReference, "AcctSvcrRef"), value(transactionReference, "EndToEndId"),
  ].find(candidate => candidate && candidate !== "NOTPROVIDED");
  return {
    description: clean(value(entry, "AddtlNtryInf") || details.join(" "), 500),
    reference: clean(reference ?? "", 180),
  };
}

function balance(statement: Element, code: string, currency: string) {
  const matches = children(statement, "Bal").filter(item => value(child(child(item, "Tp"), "CdOrPrtry"), "Cd") === code);
  if (matches.length > 1) throw new Error("A CAMT.053 statement contains duplicate booked balances.");
  return matches[0] ? readAmount(matches[0], currency) : undefined;
}

export function parseCamt053(input: string): Statement | string {
  try {
    const { root, stuzza } = readXml(input);
    const statements = children(child(root, "BkToCstmrStmt"), "Stmt");
    if (!statements.length) return "The CAMT.053 file contains no statements.";
    const entries: ImportedBankStatementEntry[] = [];
    const ids = new Set<string>();
    let account = "";
    let isIban = false;
    let currency = "";
    let previousClosing: bigint | undefined;
    for (const statement of statements) {
      const id = value(statement, "Id");
      if (!id || ids.has(id)) return "Each CAMT.053 statement must have a distinct statement ID.";
      ids.add(id);
      const accountNode = child(statement, "Acct");
      const accountId = child(accountNode, "Id");
      const iban = value(accountId, "IBAN").replace(/\s/g, "").toUpperCase();
      const other = value(child(accountId, "Othr"), "Id");
      const identifier = iban || other;
      if (!identifier || identifier.length > 100 || (iban && other) || (account && (account !== identifier || isIban !== Boolean(iban)))) {
        return "The CAMT.053 file must identify one source account.";
      }
      account = identifier;
      isIban = Boolean(iban);
      const statementCurrency = value(accountNode, "Ccy")
        || children(statement, "Bal").find(item => child(item, "Amt")?.currency)?.children.find(item => item.name === "Amt")?.currency
        || child(children(statement, "Ntry")[0], "Amt")?.currency || "";
      if (!/^[A-Z]{3}$/.test(statementCurrency) || (currency && currency !== statementCurrency)) {
        return "The CAMT.053 file must use one account currency.";
      }
      currency = statementCurrency;
      const openingBooked = balance(statement, "OPBD", currency);
      // Austrian RB 7–9 reports the preceding closing balance as the new opening balance.
      const previouslyClosed = balance(statement, "PRCD", currency);
      if (openingBooked !== undefined && previouslyClosed !== undefined && openingBooked !== previouslyClosed) {
        return "The CAMT.053 opening and previous closing balances disagree.";
      }
      const opening = openingBooked ?? previouslyClosed;
      const closing = balance(statement, "CLBD", currency);
      if ((opening === undefined) !== (closing === undefined)
        || (previousClosing !== undefined && opening !== undefined && previousClosing !== opening)) {
        return "The CAMT.053 statements must have consistent booked balances.";
      }
      let statementTotal = 0n;
      for (const entry of children(statement, "Ntry")) {
        const status = child(entry, "Sts");
        const date = entryDate(entry);
        if ((value(status, "Cd") || text(status)) !== "BOOK" || !date) {
          return "Each CAMT.053 entry must be booked and provide a valid booking date.";
        }
        const amount = readAmount(entry, currency);
        if (amount === 0n) return "A CAMT.053 booked entry has a zero amount.";
        if (entries.length >= 20_000) return "A CAMT.053 file can contain at most 20,000 booked entries.";
        statementTotal += amount;
        entries.push({ line: entries.length + 2, date, amount: Number(amount), ...entryMemo(entry) });
      }
      if (opening !== undefined && closing !== opening + statementTotal) {
        return "The CAMT.053 closing balance does not match its booked entries.";
      }
      previousClosing = closing;
    }
    if (!entries.length) return "The CAMT.053 file contains no booked entries.";
    return { entries, currency, accountEnding: account.length > 4 ? account.slice(-4) : "••••", sourceAccount: account, sourceAccountIsIban: isIban, ...(stuzza ? { profile: "stuzza" as const } : {}) };
  } catch (error) {
    return error instanceof Error ? error.message : "The CAMT.053 file could not be read.";
  }
}
