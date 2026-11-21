import assert from "node:assert/strict";
import { financePdf } from "../src/modules/finance/pdf.ts";

const header = ["accounting_year", "interval", "period_start", "account_code", "account_name", "account_type", "debit_cents", "credit_cents", "net_cents"];
const debit = "9007199254740993123";
const net = "-9007199254740993123";
const accountName = "A long account label used to exercise the narrower layout for the turnover report";

const pdf = financePdf("Period turnover", header, [
  ["2026", "month", "2026-01-01", "4000", accountName, "income", debit, "0", net],
], [6, 7, 8]).toString("ascii");

const lines = Array.from(pdf.matchAll(/^<([0-9a-f]+)> Tj T\*$/gm), ([, hex]) =>
  Buffer.from(hex, "hex").toString("latin1"),
);
const dataLine = lines.find((line) => line.includes("2026-01"));
assert.ok(dataLine, "The turnover row should appear in the PDF");
const cells = dataLine.split(" | ").map((cell) => cell.trim());
assert.equal(cells[6], debit);
assert.equal(cells[7], "0");
assert.equal(cells[8], net);
assert.ok(lines.some((line) => line.includes("credit_cents") && line.includes("net_cents")));
assert.ok(lines.some((line) => line.includes("Page 1 of 1")));

console.log("Finance PDF retains exact signed integer amounts in their cells.");
