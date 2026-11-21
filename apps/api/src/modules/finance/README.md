# Finance & Giving module

This optional location-scoped module provides the initial general-ledger workflow.

## Included

- Chart of accounts with asset, liability, equity, income and expense classes.
- Cost-center and donor master records. Donors can be individuals or joint donors; a donor can be linked to journal lines.
- Explicit currency and location-scoped accounting-year master data with editable labels/date ranges and open/closed status. Existing years are backfilled as open calendar years, preserving current ledger behavior; currency can be changed only before the first posting.
- Finance managers can open a location-scoped accounting-year close summary with posted transaction/debit/credit totals, income and expense totals, unmatched/suggested bank-statement row counts and amounts, and account/cost-center budget-versus-actual variance.
- Double-entry journal posts with integer minor-unit amounts. Each posted entry must have at least two lines and equal positive debits/credits. The API and deferred database constraint both enforce balance.
- Split postings use additional journal lines within the same transaction. Each line can select its own active account, cost center, donor, debit or credit amount, and memo; all lines must balance as a single posting.
- Posted transactions and their lines are immutable. Corrections require a dated opposite-entry reversal with reason and append-only audit entries.
- Transaction lists can be scoped to an accounting year, inclusive booking-date range, and receipt/booking-text search; filters persist in the page URL, results show the matching count and use stable, bounded server-side pagination, while CSV exports apply the same year/date/search filters across all matching entries.
- Budgets by configured open accounting year, account and/or cost center. Transactions and receipt date ranges must map to one open configured year; closed or uncovered periods reject new postings, budget changes and receipt issuance.
- Trial balance, balance-sheet and profit-and-loss views, account statement, cost-center statement, donor lifetime giving totals, and CSV exports for turnover, cost-center and account-statement reports. Report exports are finance-manager-only, location-scoped, use the displayed accounting year/account filters, and protect spreadsheet cells from formula execution.
- Account statements can be filtered by an inclusive booking-date range in the on-screen report and manager-only CSV export; the running balance includes activity before the selected start date.
- Donation receipt settings with a plain-text template, validated placeholders, organization name, and a sequential per-location receipt number.
- Date-range preview of net posted income gifts attributed to active donors; an individual receipt or one-per-donor collective batch can be issued and printed from a sanitized HTML snapshot.
- Finance managers can download donor-specific CSV giving statements with optional inclusive dates. They contain posted income lines only (including reversals as negative amounts) and are location-scoped and formula-injection-safe.
- Issued receipts keep donor name/email, amount, currency, period, transaction IDs and rendered wording as immutable snapshots. Exact donor-period duplicates are blocked, and a collective batch can be issued only once for its period.
- Bank statement CSV import supports user-selected date/amount/description/reference columns, bounded file/row counts, European and ISO dates, signed amounts, exact-file duplicate detection, and suggested matches to postings on a selected active asset account.
- Imported statement rows are stored separately from the ledger. A finance manager must explicitly match a row to a posted transaction with the same account and signed amount, or mark it ignored; an import never creates or changes a ledger posting. Import and reconciliation actions are audited.
- Bank statement suggestion rules are location-scoped, tied to an active asset account, and match case-insensitive text fragments in the statement description/reference and ledger booking text/receipt number. Priority decides which matching rule is applied first. A rule only narrows possible matches; exact signed amount and nearby booking date still have to match, and a manager must confirm every reconciliation. Rule create/enable/disable/delete actions and import rule usage are audited.
- Imported amounts are interpreted in the Finance module's configured currency; the importer does not perform currency conversion or validate a statement currency column.
- Location isolation, module-grant checks, CSRF checks for mutation routes and safe deactivation of master records.

## Not implemented in this module yet

- Automatic bank feeds, bank-specific format profiles, payment provider connections, and cash/bank transfer workflows. CSV matches are suggestions only and require human review.
- Rules use plain substring matching rather than regular expressions, and do not create postings or automatically reconcile rows.
- Automated year-end close entries and balance carry-forward remain unimplemented. The close summary is a live read-only report, not a finalized snapshot; its budget variance uses currently posted ledger activity in each budget's account/cost-center scope (income is credit minus debit; other classes are debit minus credit), and its unreconciled bank totals use statement-row booking dates. Tax handling, VAT, account classes/groups and funds/purposes are also unimplemented.
- Statement export to PDF/Excel/DATEV/SAGE, balance sheet/P&L close entries, donor address/contact cross-links, and receipt delivery by email.
- Integration with payment providers or Finance-Sync/Sync.

Donation receipts are operational documents, not jurisdiction-certified tax forms. The module does not collect postal addresses, statutory declarations or signatures; it does not email receipts or generate a legally certified PDF. Configure the wording and numbering with the organization’s accountant before issuing official documents.

Finance is financial data. Configure module permissions deliberately, use production backups, and reconcile the books with the organization’s accountant before relying on generated figures. This module has not been verified against a live financial institution or tax jurisdiction.

Finance exports support CSV, Excel (.xlsx), printable HTML, and paginated PDF for transactions, donor statements, account statements, cost-center statements, and the trial balance, balance sheet, and profit/loss reports. All formats use the same filters and location permissions. PDF repeats column headings and preserves Western European text with its built-in font; unsupported characters are shown as question marks. Excel includes numeric amount cells when they fit its 15-digit precision, keeps longer amounts as exact text, and writes labels and notes as text cells.
