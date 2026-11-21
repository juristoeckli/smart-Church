import assert from "node:assert/strict";
import { financePdf } from "../src/modules/finance/pdf.ts";

const header = ["Period", "Account", "Name", "Debit", "Credit", "Net"];
const debit = "9007199254740993123";
const net = "-9007199254740993123";
const accountName = "A long account label used to exercise the narrower layout for the turnover report";

const pdf = financePdf("Period turnover", header, [
  ["2026-01", "4000", accountName, debit, "0", net],
], [3, 4, 5]).toString("ascii");

const lines = Array.from(pdf.matchAll(/^<([0-9a-f]+)> Tj T\*$/gm), ([, hex]) =>
  Buffer.from(hex, "hex").toString("latin1"),
);
const dataLine = lines.find((line) => line.includes("2026-01"));
assert.ok(dataLine, "The turnover row should appear in the PDF");
const cells = dataLine.split(" | ").map((cell) => cell.trim());
assert.equal(cells[3], debit);
assert.equal(cells[4], "0");
assert.equal(cells[5], net);
assert.ok(lines.some((line) => line.includes("Credit") && line.includes("Net")));
assert.ok(lines.some((line) => line.includes("Page 1 of 1")));

console.log("Finance PDF retains exact signed integer amounts in their cells.");
