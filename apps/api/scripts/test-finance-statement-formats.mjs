import assert from "node:assert/strict";
import { parseCamt053 } from "../src/modules/finance/camt053.ts";
import { parseMt940 } from "../src/modules/finance/mt940.ts";
import { parsePaypalActivity } from "../src/modules/finance/paypal-activity.ts";

const mt940 = [
  ":20:STATEMENT-FIXTURE",
  ":25:CH9000000000000123456",
  ":28C:31/1",
  ":60F:C251231CHF100,00",
  ":61:2601011231C10,05NTRFREF//BANK1",
  ":86:Supplies credit",
  ":61:260102D2,50NTRFREF//BANK2",
  ":61:260102RD1,45NTRFNONREF",
  ":61:260102RC1,00NTRFREF//BANK3",
  ":62F:C260102CHF108,00",
].join("\r\n");

const swift = parseMt940(mt940);
assert.equal(typeof swift, "object");
assert.equal(swift.currency, "CHF");
assert.equal(swift.accountEnding, "3456");
assert.deepEqual(swift.entries.map(({ date, amount }) => [date, amount]), [
  ["2025-12-31", 1005],
  ["2026-01-02", -250],
  ["2026-01-02", 145],
  ["2026-01-02", -100],
]);
assert.match(parseMt940(mt940.replace("CHF108,00", "CHF108,01")), /closing balance/);
assert.match(parseMt940(mt940.replace("CHF108,00", "EUR108,00")), /closing balance/);

const camt = `
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
  <BkToCstmrStmt><Stmt>
    <Id>STATEMENT-FIXTURE</Id>
    <Acct><Id><IBAN>CH9000000000000123456</IBAN></Id><Ccy>CHF</Ccy></Acct>
    <Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="CHF">100.00</Amt><CdtDbtInd>CRDT</CdtDbtInd></Bal>
    <Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="CHF">108.05</Amt><CdtDbtInd>CRDT</CdtDbtInd></Bal>
    <Ntry>
      <Amt Ccy="CHF">10.05</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts>
      <BookgDt><DtTm>2026-01-01T23:15:20-02:00</DtTm></BookgDt><AcctSvcrRef>ENTRY-1</AcctSvcrRef>
      <NtryDtls><TxDtls><RmtInf><Ustrd>Crédit &amp; fournitures</Ustrd></RmtInf></TxDtls></NtryDtls>
    </Ntry>
    <Ntry>
      <Amt Ccy="CHF">2.000</Amt><CdtDbtInd>DBIT</CdtDbtInd><RvslInd>true</RvslInd><Sts><Cd>BOOK</Cd></Sts>
      <BookgDt><Dt>2026-01-02</Dt></BookgDt>
    </Ntry>
  </Stmt></BkToCstmrStmt>
</Document>`;

const iso = parseCamt053(camt);
assert.equal(typeof iso, "object");
assert.equal(iso.currency, "CHF");
assert.equal(iso.accountEnding, "3456");
assert.deepEqual(iso.entries.map(({ date, amount }) => [date, amount]), [
  ["2026-01-01", 1005],
  ["2026-01-02", -200],
]);
assert.equal(iso.entries[0].description, "Crédit & fournitures");
assert.equal(iso.entries[0].reference, "ENTRY-1");
assert.match(parseCamt053(camt.replace("108.05", "108.01")), /closing balance/);
assert.match(parseCamt053(camt.replace("10.05", "10.051")), /exact cents/);
assert.match(parseCamt053(camt.replace("<Cd>BOOK</Cd>", "<Cd>PDNG</Cd>")), /booked/i);
assert.equal(typeof parseCamt053(camt.replace("camt.053", "camt.052")), "string");

const paypalHeader = [
  "Date", "Gross", "Fee", "Net", "Currency", "Balance", "Transaction ID", "Balance Impact", "Status", "Description",
];
const paypalRow = ["2026-01-02", "105.00", "-2.00", "103.00", "CHF", "203.00", "FIX-ENTRY-100", "Credit", "Completed", "Synthetic receipt"];
const paypalMemo = ["2026-01-02", "", "", "", "", "", "", "Memo", "", "Synthetic note"];
const parsePaypal = (rows, order) => parsePaypalActivity(
  rows,
  order,
  value => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null,
  value => value.trim(),
);
const paypal = parsePaypal([paypalHeader, paypalRow, paypalMemo, paypalRow]);
assert.equal(typeof paypal, "object");
assert.equal(paypal.currency, "CHF");
assert.equal(paypal.duplicateCount, 1);
assert.equal(paypal.ignoredCount, 1);
assert.equal(paypal.entries.length, 1);
assert.deepEqual([paypal.entries[0].gross, paypal.entries[0].fee, paypal.entries[0].amount], [10500, -200, 10300]);
assert.match(paypal.entries[0].fingerprint, /^[a-f0-9]{64}$/);
assert.ok(!JSON.stringify(paypal).includes(paypalRow[6]));
assert.match(parsePaypal([paypalHeader, ["01/02/2026", ...paypalRow.slice(1)]]), /date order/);
assert.match(parsePaypal([paypalHeader, paypalRow.map((value, index) => index === 3 ? "104.00" : value)]), /gross, fee, net/);
assert.match(parsePaypal([paypalHeader, paypalRow.map((value, index) => index === 8 ? "Pending" : value)]), /not settled/);
assert.match(parsePaypal([paypalHeader, paypalRow, ["2026-01-03", ...paypalRow.slice(1)]]), /inconsistent booking data/);

console.log("Finance statement format regressions passed.");
