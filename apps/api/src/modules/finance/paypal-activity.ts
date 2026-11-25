import { createHash } from "node:crypto";
import type { ImportedBankStatementEntry } from "./mt940.js";

export type PaypalDateOrder = "day-first" | "month-first";
export type PaypalEntry = ImportedBankStatementEntry & { fingerprint: string; gross: number; fee: number };
const aliases = {
  date: ["date", "datum"],
  description: ["description", "beschreibung"],
  gross: ["gross", "brutto"],
  fee: ["fee", "gebühr", "entgelt"],
  net: ["net", "netto"],
  currency: ["currency", "währung"],
  balance: ["balance", "guthaben"],
  transaction: ["transaction id", "transaktionscode", "transaktions-id"],
  impact: ["balance impact", "auswirkung auf guthaben", "auswirkung auf das guthaben"],
  status: ["status"],
  type: ["type", "typ"],
} as const;

const normalizeHeader = (value: string) => value.replace(/^\uFEFF/, "").trim().toLowerCase();

export function isPaypalActivityHeader(values: string[]) {
  const headers = values.map(normalizeHeader);
  return aliases.transaction.some(label => headers.includes(label)) && aliases.impact.some(label => headers.includes(label));
}

function money(value: string, german: boolean) {
  const cleaned = value.trim();
  const pattern = german
    ? /^([+-]?)(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/
    : /^([+-]?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;
  const match = pattern.exec(cleaned);
  if (!match) return null;
  const cents = (BigInt(match[2]!.replace(/[,.]/g, "")) * 100n + BigInt((match[3] ?? "").padEnd(2, "0")))
    * (match[1] === "-" ? -1n : 1n);
  const converted = Number(cents);
  return Number.isSafeInteger(converted) ? converted : null;
}

export function parsePaypalActivity(
  rows: string[][],
  dateOrder: PaypalDateOrder | undefined,
  statementDate: (value: string) => string | null,
  cleanText: (value: string) => string,
) {
  const headers = rows[0]!.map(normalizeHeader);
  const german = headers.includes("datum");
  const columns = new Map<keyof typeof aliases, number>();
  for (const [column, labels] of Object.entries(aliases)) {
    const matches = headers.flatMap((header, index) => (labels as readonly string[]).includes(header) ? [index] : []);
    if (matches.length > 1 || (matches.length !== 1 && column !== "description" && column !== "type")) {
      return "Include one Date, Gross, Fee, Net, Currency, Balance, Transaction ID, Balance Impact and Status column in the PayPal Activity Report.";
    }
    if (matches.length) columns.set(column as keyof typeof aliases, matches[0]!);
  }
  const currencies = new Set<string>();
  const fingerprints = new Map<string, PaypalEntry>();
  let ignoredCount = 0, duplicateCount = 0;
  for (const [index, row] of rows.slice(1).entries()) {
    const get = (column: keyof typeof aliases) => (row[columns.get(column) ?? -1] ?? "").trim();
    const impact = get("impact").toLowerCase();
    if (["memo", "none", "keine", "notiz"].includes(impact)) { ignoredCount++; continue; }
    const positive = ["credit", "gutschrift", "haben"].includes(impact);
    const negative = ["debit", "belastung", "lastschrift", "soll"].includes(impact);
    if (!positive && !negative) return `PayPal row ${index + 2}: unsupported balance impact.`;
    if (!["completed", "processed", "cleared", "refunded", "reversed", "partially refunded", "abgeschlossen", "verarbeitet", "gebucht", "zurückgezahlt", "teilweise zurückgezahlt", "storniert"].includes(get("status").toLowerCase())) {
      return `PayPal row ${index + 2}: a balance-changing transaction is not settled.`;
    }
    const rawDate = get("date");
    const slashDate = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(rawDate);
    if (slashDate && !dateOrder) return "Choose the date order used by your PayPal report.";
    const date = statementDate(slashDate && dateOrder === "month-first" ? `${slashDate[2]}.${slashDate[1]}.${slashDate[3]}` : rawDate);
    const currency = get("currency").toUpperCase();
    const gross = money(get("gross"), german);
    const fee = money(get("fee") || "0", german);
    const amount = money(get("net"), german);
    const balance = money(get("balance"), german);
    const transactionId = get("transaction");
    if (!date || !/^[A-Z]{3}$/.test(currency) || gross === null || fee === null || amount === null || balance === null ||
        !Number.isSafeInteger(gross + fee) || gross + fee !== amount || (positive ? amount <= 0 : amount >= 0) ||
        !/^[A-Za-z0-9_-]{6,100}$/.test(transactionId)) {
      return `PayPal row ${index + 2}: check the date, currency, transaction ID and signed gross, fee, net and balance amounts.`;
    }
    currencies.add(currency);
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(["smart-church.paypal-activity.v1", transactionId]))
      .digest("hex");
    const previous = fingerprints.get(fingerprint);
    if (previous) {
      if (previous.date !== date || previous.gross !== gross || previous.fee !== fee || previous.amount !== amount || currencies.size > 1) {
        return `PayPal row ${index + 2}: a repeated transaction has inconsistent booking data.`;
      }
      duplicateCount++; continue;
    }
    fingerprints.set(fingerprint, { fingerprint, line: index + 2, date, amount, gross, fee,
      description: cleanText(get("description") || get("type")).slice(0, 500), reference: "" });
  }
  if (!fingerprints.size) return "The PayPal Activity Report has no settled balance-changing rows.";
  if (currencies.size !== 1) return "Import a PayPal Activity Report for one ledger currency.";
  return { entries: [...fingerprints.values()], currency: [...currencies][0]!, ignoredCount, duplicateCount };
}
