import { ScopedGroupDonors } from "./ScopedGroupDonors";
import { ScopedGroupFinance } from "./ScopedGroupFinance";
import { ScopedSimpleBooking, SimpleBookingGrantsPanel } from "./ScopedSimpleBooking";
import { BookingPurposesPanel, type BookingPurpose } from "./BookingPurposesPanel";
import { FinanceMasterDataImport } from "./FinanceMasterDataImport";
import { FinanceTransactionEvidence } from "./FinanceTransactionEvidence";
import { FinanceCostCenterTransfer } from "./FinanceCostCenterTransfer";
import { FinanceCostCenterDetail } from "./FinanceCostCenterDetail";
import { FinanceRecentGiving } from "./FinanceRecentGiving";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowDown, ArrowDownToLine, ArrowUp, BookOpenCheck, CircleDollarSign, FileText, Landmark, Plus, RefreshCw, Search, ShieldCheck, Users, WalletCards } from "lucide-react";
import type { ModuleContext } from "../../module-registry";
import { DraftPostingReview } from "./DraftPostingReview";
import { FinancePeriodTurnover } from "./FinancePeriodTurnover";
import { formatLedgerCents } from "./ledger-cents";
import { FinanceReportAccountFilter } from "./FinanceReportAccountFilter";
import "./finance.css";

type Account = { id: string; code: string; name: string; accountType: "asset" | "liability" | "equity" | "income" | "expense"; active: boolean };
type CostCenter = { id: string; code: string; name: string; active: boolean };
type TaxType = CostCenter & { rateBasisPoints: number | null };
type Donor = { id: string; donorType: "individual" | "joint"; displayName: string; email: string; active: boolean; totalGiftsCents?: number | string; latestGiftDate?: string | null };
type Budget = { id: string; accountingYear: number; accountId: string | null; accountCode: string | null; accountName: string | null; costCenterId: string | null; costCenterCode: string | null; costCenterName: string | null; amountCents: number | string; note: string };
type AccountingYear = { journalNumberingEnabled?: boolean; accountingYear: number; label: string; startDate: string; endDate: string; status: "open" | "closed" };
type AccountingYearSummary = { period: AccountingYear; currency: string; totals: { transactionCount: number; debitCents: number; creditCents: number; incomeCents: number; expenseCents: number }; unreconciledBank: { rowCount: number; amountCents: number }; yearEndTransfer: null | { sourceYear: number; targetYear: number; closingTransactionId: string | null; openingTransactionId: string | null; closingEquityAccountId: string; createdAt: string }; budgetVariance: Array<{ id: string; accountCode: string | null; accountName: string | null; accountType: string | null; costCenterCode: string | null; costCenterName: string | null; budgetCents: number; actualCents: number; varianceCents: number }> };
type Bootstrap = { currency: string; accounts: Account[]; costCenters: CostCenter[]; donors: Donor[]; years: number[]; accountingYears: AccountingYear[]; budgets: Budget[]; taxTypes?: TaxType[] };
type Transaction = { id: string; isCostCenterTransfer?: boolean; bookingDate: string; accountingYear: number; receiptNumber: string; bookingText: string; status: "posted" | "draft"; reversesTransactionId: string | null; createdAt: string; debitCents: number; creditCents: number; lineCount: number };
const transactionSortColumns = ["date", "receipt", "description", "debit", "credit", "status"] as const;
type TransactionSortColumn = typeof transactionSortColumns[number];
type TransactionSort = { sort: TransactionSortColumn; direction: "asc" | "desc" };

function readFinanceRecordId(key: "Donor" | "Account" | "CostCenter") {
  const value = readFinanceQuery(key);
  return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : "";
}

type FinancialReportAccount = { id: string; code: string; name: string; accountType: string; debitCents: number | string; creditCents: number | string; netCents: number | string };
const financialAccountTypeLabels: Record<string, string> = {
  asset: "Assets", equity: "Equity", expense: "Expenses", income: "Income", liability: "Liabilities",
};
function groupFinancialReportAccounts(accounts: FinancialReportAccount[]) {
  const groups = new Map<string, { accounts: FinancialReportAccount[]; debit: bigint; credit: bigint; net: bigint }>();
  for (const account of accounts) {
    const group = groups.get(account.accountType) ?? { accounts: [], debit: 0n, credit: 0n, net: 0n };
    group.accounts.push(account);
    group.debit += BigInt(account.debitCents);
    group.credit += BigInt(account.creditCents);
    group.net += BigInt(account.netCents);
    groups.set(account.accountType, group);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
}
type FinancialReportDates = { from: string; to: string };
const standardFinancialDates: FinancialReportDates = { from: "", to: "" };

type TransactionPage = { items: Transaction[]; total: number; page: number; pageSize: number };
type TransactionDetail = Transaction & { lines: Array<{ id: string; lineNumber: number; accountCode: string; accountName: string; accountType: string; costCenterName: string | null; donorName: string | null; debitCents: number; creditCents: number; text: string }>; audit: Array<{ action: string; details: Record<string, unknown>; actorName: string | null; createdAt: string }> };
type StatementLabel = { code: string; name: string };
type StatementLine = { id: string; lineId: string; bookingDate: string; receiptNumber: string; bookingText: string; lineText: string;
  debitCents: number | string; creditCents: number | string; runningBalanceCents: number | string;
  account: StatementLabel; costCenter: StatementLabel | null; counterAccounts: StatementLabel[]; };
type TransitLeg = "outgoing" | "incoming";
type TransitDraft = { leg: TransitLeg; bankAccount: string; clearingAccount: string; amount: string };
const initialTransit = (): TransitDraft => ({ leg: "outgoing", bankAccount: "", clearingAccount: "", amount: "" });
const transitTranslations: Record<string, Partial<Record<string, string>>> = {
  "Money in transit": { de: "Geldtransit", fr: "Fonds en transit", it: "Denaro in transito" },
  "Post money in transit": { de: "Geldtransit buchen", fr: "Comptabiliser un transfert", it: "Registra denaro in transito" },
  "Transfer leg": { de: "Transferschritt", fr: "Étape du transfert", it: "Fase del trasferimento" },
  "Direction": { de: "Richtung", fr: "Sens", it: "Direzione" },
  "Money sent": { de: "Betrag gesendet", fr: "Fonds envoyés", it: "Denaro inviato" },
  "Money received": { de: "Betrag erhalten", fr: "Fonds reçus", it: "Denaro ricevuto" },
  "Source bank or cash account": { de: "Bank- oder Kassenkonto der Abbuchung", fr: "Compte bancaire ou de caisse d'origine", it: "Conto bancario o di cassa di origine" },
  "Destination bank or cash account": { de: "Bank- oder Kassenkonto des Eingangs", fr: "Compte bancaire ou de caisse destinataire", it: "Conto bancario o di cassa di destinazione" },
  "Choose a bank or cash account": { de: "Bank- oder Kassenkonto auswählen", fr: "Sélectionner un compte bancaire ou de caisse", it: "Seleziona un conto bancario o di cassa" },
  "Transfer amount": { de: "Betrag", fr: "Montant", it: "Importo" },
  "Clearing account": { de: "Geldtransitkonto", fr: "Compte de transit", it: "Conto di transito" },
  "Choose an asset account": { de: "Aktivkonto auswählen", fr: "Sélectionner un compte d'actif", it: "Seleziona un conto dell'attivo" },
  "Debits clearing and credits the source. Post the incoming leg separately on the date the money arrives.": { de: "Bucht das Geldtransitkonto im Soll und das Quellkonto im Haben. Buche den Eingang separat am Tag der Gutschrift.", fr: "Débite le compte de transit et crédite le compte d'origine. Comptabilisez la réception séparément à la date d'arrivée des fonds.", it: "Addebita il conto di transito e accredita il conto di origine. Registra l'entrata separatamente alla data di ricezione." },
  "Debits the destination and credits clearing. Use the same clearing account and amount as the outgoing leg.": { de: "Bucht das Zielkonto im Soll und das Geldtransitkonto im Haben. Verwende dasselbe Geldtransitkonto und denselben Betrag wie bei der Abbuchung.", fr: "Débite le compte destinataire et crédite le compte de transit. Utilisez le même compte de transit et le même montant que pour l'envoi.", it: "Addebita il conto di destinazione e accredita il conto di transito. Usa lo stesso conto di transito e lo stesso importo dell'uscita." },
};

function postingAmountCents(amount: string): number {
  const parts = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount);
  if (!parts) return 0;
  const cents = Number(parts[1]) * 100 + Number((parts[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents <= 9000000000000000 ? cents : 0;
}

type JournalLine = { accountId: string; costCenterId: string; donorId: string; debit: string; credit: string; text: string };
type Tab = "transactions" | "accounts" | "donors" | "budgets" | "accounting-years" | "receipts" | "bank-statements" | "reports";
type ReceiptSettings = { organizationName: string; templateText: string; numberingPrefix: string };
type ReceiptPreview = { donorId: string; donorName: string; donorEmail: string; amountCents: number; donationCount: number };
type IssuedReceipt = { id: string; batchId: string; receiptNumber: string; donorName: string; amountCents: number; currency: string; periodStart: string; periodEnd: string; printUrl: string; batchPrintUrl: string; createdAt?: string };
type BankImportAccount = { id: string; code: string; name: string; statementCount: number; archivedCount: number; rowCount: number; matched: number };
type BankImport = { id: string; accountId: string; fileName: string; importedAt: string; rowCount: number; accountCode: string; accountName: string; matched: number; suggested: number; unmatched: number; ignored: number };
type PaypalBookingMode = "payment" | "transfer";
type BankRow = { paypal: { grossCents: number; feeCents: number; currency: string } | null; id: string; accountId: string; lineNumber: number; bookingDate: string; description: string; reference: string; amountCents: number; status: "unmatched" | "suggested" | "matched" | "ignored"; suggestedTransactionId: string | null; matchedTransactionId: string | null; transactionReceipt: string | null; transactionText: string | null };
type StatementCounterLine = { key: string; accountId: string; costCenterId: string; amount: string };
type BankPosting = { row: BankRow; lines: StatementCounterLine[]; paypalMode: PaypalBookingMode; feeAccountId: string; purposeId?: string };
type StatementReviewDraft = { posting: BankPosting; receiptNumber: string; bookingText: string; manualReceipt: boolean; submissionId: string | null };
const newCounterLine = (): StatementCounterLine => ({ key: crypto.randomUUID(), accountId: "", costCenterId: "", amount: "" });
type BankSuggestionRule = { id: string; accountId: string; accountCode: string; accountName: string; name: string; statementContains: string; transactionContains: string; priority: number; active: boolean };
type BankPreview = { format?: "mt940" | "camt053" | "paypal" | "zip"; profile?: "stuzza";
  archiveFormat?: "mt940" | "camt053" | "paypal"; accountingYear?: number; files?: { fileName: string; rowCount: number; alreadyImported: boolean; overlapCount?: number }[]; overlapCount?: number; ignoredCount?: number; accountEnding?: string; currency?: string; rememberedAccountId?: string | null; headers: string[]; rowCount: number; archivedDuplicate?: boolean; duplicate: boolean; sample: string[][] };

const money = (cents: number | string, currency: string) => new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(cents || 0) / 100);
const today = () => new Date().toISOString().slice(0, 10);

function monthInAccountingYear(month: string, start: string, end: string) {
  if (!/^[0-9]{4}-(?:0[1-9]|1[0-2])$/.test(month)) return null;
  const firstDay = month + "-01";
  const last = new Date(firstDay + "T00:00:00Z");
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  const lastDay = last.toISOString().slice(0, 10);
  const from = firstDay < start ? start : firstDay;
  const to = lastDay > end ? end : lastDay;
  return from <= to ? { from, to } : null;
}
const readFinanceQuery = (key: string) => new URLSearchParams(window.location.search).get(`finance${key}`) ?? "";
const validDateQuery = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const bankStatementFormatName = (format: BankPreview["format"], profile: BankPreview["profile"]) =>
  format === "mt940" ? "MT940" : profile === "stuzza" ? "STUZZA CAMT.053" : "CAMT.053";
const initialLine = (): JournalLine => ({ accountId: "", costCenterId: "", donorId: "", debit: "", credit: "", text: "" });

export function FinanceModule(context: ModuleContext) {
  const grants = context.department.modulePermissions?.finance ?? [];
  const full = context.canManageSite || context.department.role === "site_admin" || grants.includes("view") || grants.includes("manage");
  const canBook = grants.includes("simple-booking");
  const canRead = grants.includes("group-finance-view");
  const canViewDonors = grants.includes("group-donors-view");
  const [chosen, setChosen] = useState<"full" | "booking" | "read" | "donors">();
  const pages = [
    ...(full ? [{ value: "full" as const, label: "Finance overview" }] : []),
    ...(canRead ? [{ value: "read" as const, label: "Group finance" }] : []),
    ...(canViewDonors ? [{ value: "donors" as const, label: "Group donors" }] : []),
    ...(canBook ? [{ value: "booking" as const, label: "Simple group booking" }] : []),
  ];
  const page = pages.find(item => item.value === chosen)?.value ?? pages[0]?.value;
  return <>
    {pages.length > 1 && <nav className="finance-action-row" aria-label="Finance view">
      {pages.map(item => <button key={item.value} type="button" className="button button-secondary"
        onClick={() => setChosen(item.value)} aria-pressed={page === item.value}>{item.label}</button>)}
    </nav>}
    {page === "full" && <FullFinanceModule {...context} />}
    {page === "read" && <ScopedGroupFinance key={context.departmentId} departmentId={context.departmentId} />}
    {page === "donors" && <ScopedGroupDonors key={context.departmentId} departmentId={context.departmentId} />}
    {page === "booking" && <ScopedSimpleBooking key={context.departmentId} context={context} />}
  </>;
}

function FullFinanceModule({ department, departmentId, csrfToken, canManageSite, language }: ModuleContext) {
  const canManage = canManageSite || (department.modulePermissions?.finance ?? []).includes("manage");
  const [tab, setTab] = useState<Tab>("transactions");
  const [exportFormat, setExportFormat] = useState<"csv" | "xlsx" | "html" | "pdf">("csv");
  const [bootstrap, setBootstrap] = useState<Bootstrap>({ currency: "CHF", accounts: [], costCenters: [], donors: [], years: [], accountingYears: [], budgets: [] });
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [bookingPurposes, setBookingPurposes] = useState<BookingPurpose[]>([]);
  const [statement, setStatement] = useState<StatementLine[]>([]);
  const [statementFrom, setStatementFrom] = useState("");
  const [statementTo, setStatementTo] = useState("");
  const [transactionDetail, setTransactionDetail] = useState<TransactionDetail | null>(null);
  const [financialReport, setFinancialReport] = useState<{ key: string; accounts: FinancialReportAccount[] }>();
  const [financialReportError, setFinancialReportError] = useState("");
  const [financialReportDates, setFinancialReportDates] = useState<Record<string, FinancialReportDates>>({});
  const [costCenterReport, setCostCenterReport] = useState<Array<{ id: string; code: string; name: string; debitCents: number; creditCents: number; transactionCount: number }>>([]);
  const [reportType, setReportType] = useState<"trial-balance" | "balance-sheet" | "profit-loss">("trial-balance");
  const [groupReportAccounts, setGroupReportAccounts] = useState(false);
  const [hiddenReportAccounts, setHiddenReportAccounts] = useState<Partial<Record<typeof reportType, string[]>>>({});
  const [year, setYear] = useState(() => { const value = readFinanceQuery("Year"); return /^\d{4}$/.test(value) ? value : String(new Date().getFullYear()); });
  const [currencyDraft, setCurrencyDraft] = useState("CHF");
  const [statementAccount, setStatementAccount] = useState("");
  const [query, setQuery] = useState(() => readFinanceQuery("Q").slice(0, 100));
  const [transactionCostCenterId, setTransactionCostCenterId] = useState(() => readFinanceRecordId("CostCenter"));
  const [transactionPostedOnly, setTransactionPostedOnly] = useState(() => readFinanceQuery("PostedOnly") === "true");
  const [transactionAccountId, setTransactionAccountId] = useState(() => readFinanceRecordId("Account"));
  const [transactionDonorId, setTransactionDonorId] = useState(() => readFinanceRecordId("Donor"));
  const [transactionFrom, setTransactionFrom] = useState(() => { const value = readFinanceQuery("From"); return validDateQuery(value) ? value : ""; });
  const [transactionTo, setTransactionTo] = useState(() => { const value = readFinanceQuery("To"); return validDateQuery(value) ? value : ""; });
  const [transactionSort, setTransactionSort] = useState<TransactionSort>(() => ({
    sort: transactionSortColumns.find((column) => column === readFinanceQuery("Sort")) ?? "date",
    direction: readFinanceQuery("Direction") === "asc" ? "asc" : "desc",
  }));
  const [transactionPage, setTransactionPage] = useState(() => { const value = Number.parseInt(readFinanceQuery("Page"), 10); return Number.isSafeInteger(value) && value > 0 ? Math.min(value, 100_000) : 1; });
  const [transactionTotal, setTransactionTotal] = useState(0);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showPosting, setShowPosting] = useState(false);
  const [bankPosting, setBankPosting] = useState<BankPosting | null>(null);
  const statementReviewDrafts = useRef(new Map<string, StatementReviewDraft>());
  const [transitDraft, setTransitDraft] = useState<TransitDraft | null>(null);
  const [manualReceipt,setManualReceipt] = useState(false);
  const journalSubmissionId=useRef<string|null>(null);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showCostCenterTransfer,setShowCostCenterTransfer] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [showCostCenter, setShowCostCenter] = useState(false);
  const [showDonor, setShowDonor] = useState(false);
  const [showBudget, setShowBudget] = useState(false);
  const [bookingDate, setBookingDate] = useState(today());
  const [receiptNumber, setReceiptNumber] = useState("");
  const [bookingText, setBookingText] = useState("");
  const [lines, setLines] = useState<JournalLine[]>([initialLine(), initialLine()]);
  const [accountDraft, setAccountDraft] = useState({ code: "", name: "", accountType: "asset" as Account["accountType"] });
  const [costCenterDraft, setCostCenterDraft] = useState({ code: "", name: "" });
  const [taxTypeDraft, setTaxTypeDraft] = useState({ code: "", name: "", rate: "" });
  const [donorDraft, setDonorDraft] = useState({ donorType: "individual" as Donor["donorType"], displayName: "", email: "" });
  const [donorStatementFrom, setDonorStatementFrom] = useState("");
  const [donorStatementTo, setDonorStatementTo] = useState("");
  const [budgetDraft, setBudgetDraft] = useState({ accountingYear: String(new Date().getFullYear()), accountId: "", costCenterId: "", amount: "", note: "" });
  const [accountingYearDraft, setAccountingYearDraft] = useState({ accountingYear: String(new Date().getFullYear() + 1), label: String(new Date().getFullYear() + 1), startDate: `${new Date().getFullYear() + 1}-01-01`, endDate: `${new Date().getFullYear() + 1}-12-31` });
  const [accountingYearEdits, setAccountingYearEdits] = useState<Record<number, { label: string; startDate: string; endDate: string }>>({});
  const [accountingYearSummary, setAccountingYearSummary] = useState<AccountingYearSummary | null>(null);
  const [yearEndEquityAccountId, setYearEndEquityAccountId] = useState("");
  const [receiptSettings, setReceiptSettings] = useState<ReceiptSettings>({ organizationName: "", templateText: "Donation receipt for {{period}}\n\nReceived from: {{donorName}}\nAmount: {{currency}} {{amount}}\n\nThank you for your support.\n{{organization}}", numberingPrefix: "DR" });
  const [receiptPreview, setReceiptPreview] = useState<ReceiptPreview[]>([]);
  const [issuedReceipts, setIssuedReceipts] = useState<IssuedReceipt[]>([]);
  const [receiptDonorId, setReceiptDonorId] = useState("");
  const [receiptFrom, setReceiptFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [receiptTo, setReceiptTo] = useState(`${new Date().getFullYear()}-12-31`);
  const [receiptCollective, setReceiptCollective] = useState(true);
  const [bankImportAccounts, setBankImportAccounts] = useState<BankImportAccount[]>([]);
  const [bankBrowseAccountId, setBankBrowseAccountId] = useState("");
  const [showArchivedBankStatements, setShowArchivedBankStatements] = useState(false);
  const bankBrowseVersion = useRef(0);
  const bankRowsVersion = useRef(0);
  const [bankImports, setBankImports] = useState<BankImport[]>([]);
  const [bankRules, setBankRules] = useState<BankSuggestionRule[]>([]);
  const [bankRuleDraft, setBankRuleDraft] = useState({ name: "", accountId: "", statementContains: "", transactionContains: "", priority: "100" });
  const [bankRows, setBankRows] = useState<BankRow[]>([]);
  const [selectedBankImportId, setSelectedBankImportId] = useState("");
  const [bankText, setBankText] = useState("");
  const [bankFormat, setBankFormat] = useState<"csv" | "mt940" | "camt053" | "paypal" | "zip">("csv");
  const [paypalDateOrder, setPaypalDateOrder] = useState("");
  const [bankSourceConfirmed, setBankSourceConfirmed] = useState(false);
  const [bankRememberSource, setBankRememberSource] = useState(false);
  const bankFileRead = useRef(0);
  const bankAccountChange = useRef(0);
  const bankDepartment = useRef(departmentId);
  bankDepartment.current = departmentId;
  useEffect(() => {
    bankFileRead.current++;
    ++bankBrowseVersion.current;
    ++bankRowsVersion.current;
    setBankImports([]); setBankImportAccounts([]); setBankBrowseAccountId(""); setShowArchivedBankStatements(false);
    setSelectedBankImportId(""); setBankRows([]); setBankMatchChoice({}); setBankRules([]);
    statementReviewDrafts.current.clear();
    setBankPosting(null);
    setShowPosting(false);
    setBookingPurposes([]);
    setBankText(""); setBankFileName(""); setBankPreview(null); setBankSourceConfirmed(false); setBankRememberSource(false); setBankAccountId("");
  }, [departmentId]);
  const [bankFileName, setBankFileName] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [bankPreview, setBankPreview] = useState<BankPreview | null>(null);
  const [bankMapping, setBankMapping] = useState({ date: "", amount: "", description: "", reference: "" });
  const [bankMatchChoice, setBankMatchChoice] = useState<Record<string, string>>({});

  const t = useCallback((value: string) => {
    const transitTranslation = transitTranslations[value]?.[language];
    if (transitTranslation) return transitTranslation;
    if (language === "de") return ({ "Finance & Giving": "Finanzen & Spenden", "Transactions": "Buchungen", "Accounts": "Konten", "Donors": "Spender", "Budgets": "Budgets", "Reports": "Berichte", "New transaction": "Neue Buchung", "Post transaction": "Buchung erfassen", "Booking date": "Buchungsdatum", "Receipt number": "Belegnummer", "Booking text": "Buchungstext", "Account": "Konto", "Cost center": "Kostenstelle", "Donor": "Spender", "Debit": "Soll", "Credit": "Haben", "Add line": "Zeile hinzufügen", "Remove": "Entfernen", "Balanced": "Ausgeglichen", "Difference": "Differenz", "No transactions yet.": "Noch keine Buchungen.", "Account code": "Kontonummer", "Name": "Name", "Type": "Typ", "Save account": "Konto speichern", "New account": "Neues Konto", "New cost center": "Neue Kostenstelle", "Save cost center": "Kostenstelle speichern", "Save donor": "Spender speichern", "New donor": "Neuer Spender", "Individual": "Einzelperson", "Joint donor": "Gemeinsam", "Email": "E-Mail", "Budget year": "Budgetjahr", "Amount": "Betrag", "Save budget": "Budget speichern", "Trial balance": "Saldenliste", "Account statement": "Kontoblatt", "Search transactions": "Buchungen suchen", "Export CSV": "CSV exportieren", "Refresh": "Aktualisieren", "Reverse": "Stornieren", "Reason": "Begründung", "Choose account": "Konto auswählen", "Choose cost center": "Kostenstelle auswählen", "No accounts yet.": "Noch keine Konten.", "No donors yet.": "Noch keine Spender.", "No budgets yet.": "Noch keine Budgets.", "Create at least two active accounts before posting a transaction.": "Erfasse zuerst mindestens zwei aktive Konten.", "This ledger uses balanced double-entry postings. Posted entries cannot be edited; reverse them with an auditable counter-entry.": "Das Hauptbuch verwendet ausgeglichene doppelte Buchungen. Erfasste Buchungen sind unveränderlich und werden mit einer nachvollziehbaren Gegenbuchung storniert." } as Record<string, string>)[value] ?? value;
    return value;
  }, [language]);

  const send = useCallback(async <T,>(path: string, method = "GET", body?: unknown): Promise<T> => {
    const response = await fetch(path, { method, headers: { "x-department-id": departmentId, ...(method === "GET" ? {} : { "content-type": "application/json", "x-csrf-token": csrfToken }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (response.status === 204) return undefined as T;
    const result = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(result.error ?? "The request could not be completed.");
    return result;
  }, [departmentId, csrfToken]);

  const loadVersion = useRef(0);
  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ year, q: query, page: String(transactionPage), pageSize: "50", ...transactionSort });
      if (transactionFrom) params.set("from", transactionFrom);
      if (transactionDonorId) params.set("donorId", transactionDonorId);
      if (transactionAccountId) params.set("accountId", transactionAccountId);
      if (transactionCostCenterId) params.set("costCenterId", transactionCostCenterId);
      if (transactionTo) params.set("to", transactionTo);
      if (transactionPostedOnly) params.set("postedOnly", "true");
      const [next, result, purposes] = await Promise.all([
        send<Bootstrap>("/api/modules/finance/bootstrap"),
        send<TransactionPage>(`/api/modules/finance/transactions?${params}`),
        canManage ? send<BookingPurpose[]>("/api/modules/finance/booking-purposes") : Promise.resolve([]),
      ]);
      if (version !== loadVersion.current) return;
      setBookingPurposes(purposes);
      setBootstrap(next); setCurrencyDraft(next.currency); setTransactions(result.items); setTransactionTotal(result.total);
      if (next.accountingYears.length && !next.accountingYears.some((item) => item.accountingYear === Number(year))) {
        const todayYear = next.accountingYears.find((item) => item.startDate.slice(0, 10) <= today() && item.endDate.slice(0, 10) >= today());
        if (todayYear) setYear(String(todayYear.accountingYear));
      }
      if (!statementAccount && next.accounts.length) setStatementAccount(next.accounts[0]!.id);
      if (!bankAccountId && next.accounts.some((account) => account.accountType === "asset" && account.active)) setBankAccountId(next.accounts.find((account) => account.accountType === "asset" && account.active)!.id);
    } catch (reason) {
      if (version === loadVersion.current) setError(reason instanceof Error ? reason.message : "Could not load the finance ledger.");
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [send, canManage, year, query, statementAccount, bankAccountId, transactionFrom, transactionTo, transactionPage, transactionSort, transactionDonorId, transactionAccountId, transactionCostCenterId, transactionPostedOnly]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    for (const key of ["Year", "Q", "From", "To", "Page", "Sort", "Direction", "Donor", "Account", "CostCenter", "PostedOnly"]) params.delete(`finance${key}`);
    if (year !== String(new Date().getFullYear())) params.set("financeYear", year);
    if (query) params.set("financeQ", query);
    if (transactionFrom) params.set("financeFrom", transactionFrom);
    if (transactionTo) params.set("financeTo", transactionTo);
    if (transactionDonorId) params.set("financeDonor", transactionDonorId);
    if (transactionAccountId) params.set("financeAccount", transactionAccountId);
    if (transactionCostCenterId) params.set("financeCostCenter", transactionCostCenterId);
    if (transactionPostedOnly) params.set("financePostedOnly", "true");
    if (transactionPage > 1) params.set("financePage", String(transactionPage));
    if (transactionSort.sort !== "date") params.set("financeSort", transactionSort.sort);
    if (transactionSort.direction !== "desc") params.set("financeDirection", transactionSort.direction);
    const search = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`);
  }, [year, query, transactionFrom, transactionTo, transactionPage, transactionSort, transactionDonorId, transactionAccountId, transactionCostCenterId, transactionPostedOnly]);

  async function action(work: () => Promise<unknown>, success: string) {
    setSaving(true); setError(""); setFeedback("");
    try { await work(); setFeedback(success); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The request could not be completed."); }
    finally { setSaving(false); }
  }

  async function addTaxType(event: FormEvent) {
    event.preventDefault();
    if (!canManage || saving) return;
    await action(async () => {
      await send("/api/modules/finance/tax-types", "POST", {
        code: taxTypeDraft.code,
        name: taxTypeDraft.name,
        rateBasisPoints: taxTypeDraft.rate === "" ? null : Math.round(Number(taxTypeDraft.rate) * 100),
      });
      setTaxTypeDraft({ code: "", name: "", rate: "" });
    }, "Tax type saved.");
  }

  async function changeMasterDataStatus(collection: "accounts" | "cost-centers" | "tax-types", item: Account | CostCenter) {
    if (!canManage || saving) return;
    const active = !item.active;
    if (!active) {
      const detail = collection === "tax-types" ? "" : " Existing transactions and reports will keep their references.";
      if (!window.confirm(`Archive ${item.code} · ${item.name}?${detail}`)) return;
    }
    await action(
      () => send(`/api/modules/finance/${collection}/${item.id}`, "PATCH", { active }),
      active ? "Item restored." : "Item archived.",
    );
  }

  function masterDataStatusButton(collection: "accounts" | "cost-centers" | "tax-types", item: Account | CostCenter) {
    const label = item.active ? "Archive" : "Restore";
    return <button className="finance-text-button" type="button" disabled={saving} aria-label={`${label} ${item.code} ${item.name}`} onClick={() => void changeMasterDataStatus(collection, item)}>{label}</button>;
  }

  const transitAccounts = bootstrap.accounts.filter(account => account.active && account.accountType === "asset");
  const transitCents = postingAmountCents(transitDraft?.amount ?? "");
  const transitValid = Boolean(transitDraft && transitCents > 0
    && transitDraft.bankAccount !== transitDraft.clearingAccount
    && transitAccounts.some(account => account.id === transitDraft.bankAccount)
    && transitAccounts.some(account => account.id === transitDraft.clearingAccount));

  const dateUsesNumbering = bootstrap.accountingYears.some(period => period.status==="open" && period.journalNumberingEnabled
    && bookingDate>=period.startDate.slice(0,10) && bookingDate<=period.endDate.slice(0,10));
  const automaticReceipt = dateUsesNumbering && !manualReceipt;

  const bankAsset = bankPosting && transitAccounts.find(account => account.id === bankPosting.row.accountId);
  const bankAmount = Math.abs(bankPosting?.row.amountCents ?? 0);
  const statementReviewRows = bankPosting && bankAsset
    ? bankRows.filter(row => row.accountId === bankAsset.id && row.status === "unmatched" && row.amountCents !== 0)
    : [];
  const statementReviewIndex = statementReviewRows.findIndex(row => row.id === bankPosting?.row.id);
  const previousReviewRow = statementReviewIndex > 0 ? statementReviewRows[statementReviewIndex - 1] : undefined;
  const nextReviewRow = statementReviewIndex >= 0 ? statementReviewRows[statementReviewIndex + 1] : undefined;
  const isBankSplit = (bankPosting?.lines.length ?? 0) > 1;
  const counterAmounts = bankPosting?.lines.map(line => isBankSplit ? postingAmountCents(line.amount) : bankAmount) ?? [];
  const splitTotal = counterAmounts.reduce((sum, amount) => sum + amount, 0);
  const paypal = bankPosting?.row.paypal;
  const activeCounterAccounts = bootstrap.accounts.filter(account => account.active && account.id !== bankAsset?.id);
  const paypalCounterAccounts = activeCounterAccounts.filter(account =>
    bankPosting?.paypalMode === "transfer" ? account.accountType === "asset" : account.accountType !== "asset");
  const paypalPaymentCounter = bankPosting?.lines[0];
  const paypalFeeAccounts = activeCounterAccounts.filter(account => account.accountType === "expense");
  const paypalValid = Boolean(bankPosting && paypal && paypal.currency === bootstrap.currency
    && (paypal.grossCents === 0 ? bankPosting.paypalMode === "payment" : paypalCounterAccounts.some(account => account.id === bankPosting.lines[0]?.accountId))
    && (!paypalPaymentCounter?.costCenterId || bootstrap.costCenters.some(center => center.active && center.id === paypalPaymentCounter.costCenterId))
    && (paypal.feeCents === 0 || paypalFeeAccounts.some(account => account.id === bankPosting.feeAccountId)));
  const bankPostingValid = Boolean(bankPosting && bankAsset && Number.isSafeInteger(bankAmount) && bankAmount > 0
    && (paypal ? paypalValid : splitTotal === bankAmount && bankPosting.lines.every((line, index) => counterAmounts[index] > 0
      && bootstrap.accounts.some(account => account.active && account.id === line.accountId && account.id !== bankAsset.id)
      && (!line.costCenterId || bootstrap.costCenters.some(center => center.active && center.id === line.costCenterId)))));

  const purposeAmount = paypal?.grossCents ?? bankPosting?.row.amountCents ?? 0;
  const availablePurposes = bankPosting && bankPosting.lines.length === 1 && purposeAmount !== 0
    && (!paypal || bankPosting.paypalMode === "payment")
    ? bookingPurposes.filter(purpose => purpose.usable && purpose.bankAccountId === bankPosting.row.accountId
      && purpose.direction === (purposeAmount > 0 ? "income" : "expense")) : [];

  function applyBookingPurpose(id: string) {
    const choice = availablePurposes.find(purpose => purpose.id === id);
    setBankPosting(current => current && {
      ...current, purposeId: choice?.id,
      lines: choice ? [{ ...current.lines[0]!, accountId: choice.counterAccountId, costCenterId: choice.costCenterId }] : current.lines,
    });
  }

  function updateBankCounterLine(key: string, changes: Partial<Omit<StatementCounterLine, "key">>) {
    setBankPosting(current => current && { ...current, purposeId: undefined, lines: current.lines.map(line =>
      line.key === key ? { ...line, ...changes } : line) });
  }

  function loadBankPosting(row: BankRow) {
    const draft = statementReviewDrafts.current.get(row.id);
    journalSubmissionId.current = draft?.submissionId ?? null;
    setManualReceipt(draft?.manualReceipt ?? false);
    setReceiptNumber(draft?.receiptNumber ?? "");
    setBookingDate(row.bookingDate.slice(0, 10));
    setBookingText(draft?.bookingText ?? (row.description || row.reference || "Bank statement posting").slice(0, 500));
    setBankPosting(draft ? { ...draft.posting, row } : { row, lines: [newCounterLine()], paypalMode: "payment", feeAccountId: "" });
  }

  function openBankPosting(row: BankRow) {
    statementReviewDrafts.current.clear();
    loadBankPosting(row);
    setTransitDraft(null);
    setShowPosting(true);
  }

  function navigateBankPosting(row: BankRow | undefined) {
    if (saving || !row || !bankPosting) return;
    statementReviewDrafts.current.set(bankPosting.row.id, {
      posting: bankPosting, receiptNumber, bookingText, manualReceipt, submissionId: journalSubmissionId.current,
    });
    setError("");
    loadBankPosting(row);
  }

  function closePosting() {
    statementReviewDrafts.current.clear();
    setBankPosting(null);
    setShowPosting(false);
  }

  async function postTransaction(event: FormEvent) {
    event.preventDefault();
    if (saving || (transitDraft && !transitValid) || (bankPosting && !bankPostingValid)) return;
    const transitDebit = transitDraft?.leg === "outgoing" ? transitDraft.clearingAccount : transitDraft?.bankAccount;
    const transitCredit = transitDraft?.leg === "outgoing" ? transitDraft.bankAccount : transitDraft?.clearingAccount;
    const bankDebit = Math.max(0, bankPosting?.row.amountCents ?? 0);
    const bankCredit = Math.max(0, -(bankPosting?.row.amountCents ?? 0));
    const paypalCounter = (accountId: string, signedCents: number, costCenterId?: string) => ({
      accountId, costCenterId: costCenterId || null, debitCents: Math.max(0, signedCents), creditCents: Math.max(0, -signedCents),
    });
    const payload = bankPosting ? [
      { accountId: bankPosting.row.accountId, debitCents: bankDebit, creditCents: bankCredit },
      ...(paypal ? [
        ...(paypal.grossCents ? [paypalCounter(bankPosting.lines[0]!.accountId, -paypal.grossCents, bankPosting.lines[0]!.costCenterId)] : []),
        ...(paypal.feeCents ? [paypalCounter(bankPosting.feeAccountId, -paypal.feeCents)] : []),
      ] : bankPosting.lines.map((line, index) => ({ accountId: line.accountId, costCenterId: line.costCenterId || null,
        debitCents: bankCredit > 0 ? counterAmounts[index] : 0,
        creditCents: bankDebit > 0 ? counterAmounts[index] : 0 }))),
    ] : transitDebit && transitCredit ? [
      { accountId: transitDebit, debitCents: transitCents, creditCents: 0 },
      { accountId: transitCredit, debitCents: 0, creditCents: transitCents },
    ] : lines.map((line) => ({ accountId: line.accountId, costCenterId: line.costCenterId || null, donorId: line.donorId || null, debitCents: Math.round(Number(line.debit || 0) * 100), creditCents: Math.round(Number(line.credit || 0) * 100), text: line.text }));
    if (automaticReceipt) journalSubmissionId.current ??= crypto.randomUUID();
    await action(async () => { await send("/api/modules/finance/transactions", "POST", {
      bookingDate,bookingText,lines:payload,...(bankPosting ? { bankStatementRowId: bankPosting.row.id, ...(bankPosting.purposeId ? { bookingPurposeId: bankPosting.purposeId } : {}), ...(paypal ? { paypalBookingMode: bankPosting.paypalMode } : {}) } : {}),...(automaticReceipt ? {submissionId:journalSubmissionId.current} : {receiptNumber}),
    }); closePosting(); setReceiptNumber(""); setBookingText(""); setLines([initialLine(), initialLine()]);
      if (bankPosting) await openBankStatements();
    }, bankPosting ? "Transaction posted and matched to the statement row." : "Transaction posted and recorded in the audit trail.");
  }

  async function saveBookingPurpose(purpose: Omit<BookingPurpose, "id" | "usable">, id?: string) {
    let saved = false;
    await action(async () => {
      await send(`/api/modules/finance/booking-purposes${id ? `/${id}` : ""}`, id ? "PUT" : "POST", purpose);
      saved = true;
    }, id ? "Booking purpose updated." : "Booking purpose added.");
    return saved;
  }

  async function postTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const fromAccountId = String(values.get("fromAccount") ?? "");
    const toAccountId = String(values.get("toAccount") ?? "");
    const amountCents = Math.round(Number(values.get("amount")) * 100);
    const activeAssets = bootstrap.accounts.filter((account) => account.active && account.accountType === "asset");
    if (fromAccountId === toAccountId || ![fromAccountId, toAccountId].every((id) => activeAssets.some((account) => account.id === id))) {
      setError("Choose two distinct active asset accounts.");
      return;
    }
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
      setError("Enter a positive transfer amount.");
      return;
    }
    await action(async () => {
      await send("/api/modules/finance/transactions", "POST", {
        bookingDate: values.get("bookingDate"),
        receiptNumber: values.get("receiptNumber"),
        bookingText: values.get("bookingText"),
        lines: [
          { accountId: toAccountId, debitCents: amountCents, creditCents: 0 },
          { accountId: fromAccountId, debitCents: 0, creditCents: amountCents },
        ],
      });
      setShowTransfer(false);
    }, "Account transfer posted and recorded in the audit trail.");
  }

  async function addAccount(event: FormEvent) { event.preventDefault(); await action(async () => { await send("/api/modules/finance/accounts", "POST", accountDraft); setAccountDraft({ code: "", name: "", accountType: "asset" }); setShowAccount(false); }, "Account saved."); }
  async function addCostCenter(event: FormEvent) { event.preventDefault(); await action(async () => { await send("/api/modules/finance/cost-centers", "POST", costCenterDraft); setCostCenterDraft({ code: "", name: "" }); setShowCostCenter(false); }, "Cost center saved."); }
  async function addDonor(event: FormEvent) { event.preventDefault(); await action(async () => { await send("/api/modules/finance/donors", "POST", donorDraft); setDonorDraft({ donorType: "individual", displayName: "", email: "" }); setShowDonor(false); }, "Donor saved."); }
  async function addBudget(event: FormEvent) { event.preventDefault(); await action(async () => { await send("/api/modules/finance/budgets", "POST", { accountingYear: Number(budgetDraft.accountingYear), accountId: budgetDraft.accountId || null, costCenterId: budgetDraft.costCenterId || null, amountCents: Math.round(Number(budgetDraft.amount) * 100), note: budgetDraft.note }); setShowBudget(false); }, "Budget saved."); }
  async function addAccountingYear(event: FormEvent) { event.preventDefault(); await action(async () => { await send("/api/modules/finance/accounting-years", "POST", { ...accountingYearDraft, accountingYear: Number(accountingYearDraft.accountingYear) }); setAccountingYearDraft((current) => ({ ...current, accountingYear: String(Number(current.accountingYear) + 1), label: String(Number(current.accountingYear) + 1), startDate: `${Number(current.accountingYear) + 1}-01-01`, endDate: `${Number(current.accountingYear) + 1}-12-31` })); }, "Accounting year created."); }
  async function saveAccountingYear(item: AccountingYear) { const edit = accountingYearEdits[item.accountingYear] ?? item; await action(() => send(`/api/modules/finance/accounting-years/${item.accountingYear}`, "PATCH", { ...edit, status: item.status }), "Accounting year saved."); }
  async function setAccountingYearStatus(item: AccountingYear, status: AccountingYear["status"]) { const edit = accountingYearEdits[item.accountingYear] ?? item; await action(() => send(`/api/modules/finance/accounting-years/${item.accountingYear}`, "PATCH", { ...edit, status }), status === "closed" ? "Accounting year closed." : "Accounting year reopened."); }
  async function openAccountingYearSummary(accountingYear: number) { setError(""); setAccountingYearSummary(null); setYearEndEquityAccountId(bootstrap.accounts.find((account) => account.active && account.accountType === "equity")?.id ?? ""); try { setAccountingYearSummary(await send<AccountingYearSummary>(`/api/modules/finance/accounting-years/${accountingYear}/summary`)); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load the accounting-year summary."); } }
  async function closeAndCarryForward(event: FormEvent) {
    event.preventDefault(); if (!accountingYearSummary) return;
    const source = accountingYearSummary.period; const target = bootstrap.accountingYears.find((item) => item.accountingYear === source.accountingYear + 1);
    if (!target || !yearEndEquityAccountId) return;
    if (!window.confirm(`Post permanent closing entries for ${source.label}, carry balances into ${target.label}, and close ${source.label}? Corrections require audited reversals.`)) return;
    await action(async () => {
      await send(`/api/modules/finance/accounting-years/${source.accountingYear}/close-and-carry-forward`, "POST", { targetYear: target.accountingYear, closingEquityAccountId: yearEndEquityAccountId });
      setAccountingYearSummary(await send<AccountingYearSummary>(`/api/modules/finance/accounting-years/${source.accountingYear}/summary`));
    }, "Closing and carry-forward entries posted; the source year is closed.");
  }
  async function saveCurrency() { await action(() => send("/api/modules/finance/settings", "PUT", { currency: currencyDraft }), "Currency saved."); }

  async function refreshReceiptPreview() {
    if (!receiptCollective && !receiptDonorId) { setReceiptPreview([]); return; }
    const receiptYear = bootstrap.accountingYears.find((item) => item.startDate.slice(0, 10) <= receiptFrom && item.endDate.slice(0, 10) >= receiptFrom)?.accountingYear ?? Number(receiptFrom.slice(0, 4));
    const params = new URLSearchParams({ year: String(receiptYear), from: receiptFrom, to: receiptTo });
    if (receiptDonorId && !receiptCollective) params.set("donorId", receiptDonorId);
    setReceiptPreview(await send<{ donors: ReceiptPreview[] }>(`/api/modules/finance/receipts/preview?${params}`).then((result) => result.donors));
  }

  async function openReceipts() {
    setTab("receipts"); setError("");
    try {
      const [settings, issued] = await Promise.all([
        send<ReceiptSettings>("/api/modules/finance/receipts/settings"),
        send<IssuedReceipt[]>(`/api/modules/finance/receipts?year=${encodeURIComponent(bootstrap.accountingYears.find((item) => item.startDate.slice(0, 10) <= receiptFrom && item.endDate.slice(0, 10) >= receiptFrom)?.accountingYear ?? Number(receiptFrom.slice(0, 4)) )}`),
      ]);
      setReceiptSettings(settings); setIssuedReceipts(issued); await refreshReceiptPreview();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load donation receipts."); }
  }

  async function saveReceiptSettings(event: FormEvent) {
    event.preventDefault();
    await action(() => send("/api/modules/finance/receipts/settings", "PUT", receiptSettings), "Receipt settings saved.");
  }

  async function issueReceipts() {
    if (!receiptCollective && !receiptDonorId) { setError("Select a donor or choose a collective batch."); return; }
    await action(async () => {
      const receiptYear = bootstrap.accountingYears.find((item) => item.startDate.slice(0, 10) <= receiptFrom && item.endDate.slice(0, 10) >= receiptFrom)?.accountingYear ?? Number(receiptFrom.slice(0, 4));
      const issued = await send<{ receipts: Array<{ id: string; batchId: string; receiptNumber: string; donorName: string; amountCents: number; printUrl: string; batchPrintUrl: string }> }>("/api/modules/finance/receipts/issue", "POST", { year: receiptYear, from: receiptFrom, to: receiptTo, collective: receiptCollective, donorId: receiptCollective ? null : receiptDonorId });
      setIssuedReceipts((current) => [...issued.receipts.map((item) => ({ ...item, currency: bootstrap.currency, periodStart: receiptFrom, periodEnd: receiptTo })), ...current]);
      await refreshReceiptPreview();
    }, "Donation receipt(s) issued and recorded.");
  }

  async function openBankStatements(accountId = bankBrowseAccountId, archived = showArchivedBankStatements, preferredId = selectedBankImportId) {
    setTab("bank-statements"); setError(""); setFeedback("");
    const version = ++bankBrowseVersion.current;
    const params = new URLSearchParams({ archived: String(archived) });
    if (accountId) params.set("accountId", accountId);
    try {
      const [imports, rules, accounts] = await Promise.all([
        send<BankImport[]>(`/api/modules/finance/bank-statements?${params}`),
        send<BankSuggestionRule[]>("/api/modules/finance/bank-suggestion-rules"),
        send<BankImportAccount[]>("/api/modules/finance/bank-statements/accounts"),
      ]);
      if (version !== bankBrowseVersion.current || bankDepartment.current !== departmentId) return;
      setBankImports(imports);
      setBankRules(rules);
      setBankImportAccounts(accounts);
      setBankBrowseAccountId(accountId);
      setShowArchivedBankStatements(archived);
      const selected = imports.find(item => item.id === preferredId) ?? imports[0];
      if (selected) await openBankImport(selected.id);
      else { ++bankRowsVersion.current; setSelectedBankImportId(""); setBankRows([]); }
    } catch (reason) {
      if (version === bankBrowseVersion.current && bankDepartment.current === departmentId) {
        setError(reason instanceof Error ? reason.message : "Could not load bank statements.");
      }
    }
  }

  async function openBankImport(id: string) {
    const version = ++bankRowsVersion.current;
    setSelectedBankImportId(id);
    setBankRows([]);
    try {
      const rows = await send<BankRow[]>(`/api/modules/finance/bank-statements/${id}`);
      if (version !== bankRowsVersion.current || bankDepartment.current !== departmentId) return;
      setBankRows(rows);
      setBankMatchChoice(Object.fromEntries(rows.filter((row) => row.suggestedTransactionId || row.matchedTransactionId).map((row) => [row.id, row.matchedTransactionId ?? row.suggestedTransactionId ?? ""])));
    } catch (reason) {
      if (version === bankRowsVersion.current && bankDepartment.current === departmentId) {
        setError(reason instanceof Error ? reason.message : "Could not load statement rows.");
      }
    }
  }

  async function readBankStatement(file: File | undefined) {
    const read = ++bankFileRead.current;
    const accountChange = bankAccountChange.current;
    setBankText(""); setBankFileName(""); setBankPreview(null); setBankSourceConfirmed(false); setBankRememberSource(false); setPaypalDateOrder(""); setError("");
    if (!file) return;
    if (file.size > 2_000_000) { setError("Statement files must be 2 MB or smaller."); return; }
    try {
      const bytes = await file.arrayBuffer();
      const binary = new Uint8Array(bytes);
      const zipSignature = binary[0] === 0x50 && binary[1] === 0x4b
        && ((binary[2] === 0x03 && binary[3] === 0x04) || (binary[2] === 0x05 && binary[3] === 0x06));
      if (/\.zip$/i.test(file.name) || zipSignature) {
        if (read !== bankFileRead.current || bankDepartment.current !== departmentId) return;
        let encoded = "";
        for (let start = 0; start < binary.length; start += 32_768) {
          encoded += String.fromCharCode(...binary.subarray(start, start + 32_768));
        }
        setBankFormat("zip");
        setBankText(btoa(encoded));
        setBankFileName(file.name);
        return;
      }
      const utf8 = new TextDecoder("utf-8");
      let content = utf8.decode(bytes);
      const hasUtf16Bom = new Uint8Array(bytes).slice(0, 2);
      const utf16 = hasUtf16Bom[0] === 0xff && hasUtf16Bom[1] === 0xfe ? "utf-16le"
        : hasUtf16Bom[0] === 0xfe && hasUtf16Bom[1] === 0xff ? "utf-16be" : null;
      if (utf16) content = new TextDecoder(utf16, { fatal: true }).decode(bytes);
      const isCamt = /\.(?:xml|camt|053)$/i.test(file.name) || content.trimStart().startsWith("<");
      const isMt940 = /\.(mt940|sta|swi)$/i.test(file.name) || /(?:^|\r?\n):60[FM]:/.test(content);
      if (isCamt && !utf16) {
        const declared = /^\s*<\?xml\s+[^?]*\bencoding\s*=\s*["']([^"']+)/i.exec(content.slice(0, 200))?.[1]?.toLowerCase();
        const encoding = declared === "windows-1252" || declared === "iso-8859-1" ? declared : "utf-8";
        if (declared && declared !== "utf-8" && encoding === "utf-8") throw new Error("Use a UTF-8 or supported XML statement encoding.");
        content = new TextDecoder(encoding, { fatal: true }).decode(bytes);
      } else if (isMt940 && !isCamt) {
        try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
        catch { content = new TextDecoder("windows-1252").decode(bytes); }
      }
      if (read !== bankFileRead.current || bankDepartment.current !== departmentId) return;
      const header = content.split(/\r?\n/, 1)[0]?.toLowerCase() ?? "";
      const isPaypal = /(transaction id|transaktionscode|transaktions-id)/.test(header)
        && /(balance impact|auswirkung auf (das )?guthaben)/.test(header);
      const format = isCamt ? "camt053" : isMt940 ? "mt940" : isPaypal ? "paypal" : "csv";
      if (format === "camt053" || format === "mt940") {
        // A suggestion must not override an account chosen while this file was being read.
        const recognized = await send<{ accountId: string | null }>("/api/modules/finance/bank-statements/recognize", "POST",
          { [format]: content });
        if (read !== bankFileRead.current || bankDepartment.current !== departmentId) return;
        if (recognized.accountId && accountChange === bankAccountChange.current) setBankAccountId(recognized.accountId);
      }
      setBankFormat(format);
      setBankText(content);
      setBankFileName(file.name);
    } catch (reason) {
      if (read === bankFileRead.current && bankDepartment.current === departmentId) setError(reason instanceof Error ? reason.message : "Could not read this statement file.");
    }
  }

  async function previewBankStatement() {
    if (!bankText || !bankAccountId) return;
    setSaving(true); setError(""); setFeedback("");
    try {
      const preview = await send<BankPreview>(bankFormat === "zip" ? "/api/modules/finance/bank-statements/archive/preview" : "/api/modules/finance/bank-statements/preview", "POST", { accountId: bankAccountId, fileName: bankFileName, [bankFormat]: bankText, ...((bankFormat === "paypal" || bankFormat === "zip") && paypalDateOrder ? { paypalDateOrder } : {}) });
      if (bankDepartment.current !== departmentId) return; setBankPreview(preview); setBankSourceConfirmed(false); setBankRememberSource(false);
      const findColumn = (pattern: RegExp) => { const index = preview.headers.findIndex((header) => pattern.test(header)); return index < 0 ? "" : String(index); };
      setBankMapping({ date: findColumn(/date|datum/i), amount: findColumn(/amount|betrag|value|summe/i), description: findColumn(/description|text|booking|buchung|details/i), reference: findColumn(/reference|referenz|id|number|nummer/i) });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not preview this statement."); }
    finally { setSaving(false); }
  }

  async function importBankStatement() {
    if (!bankPreview || bankPreview.duplicate || (bankPreview.format === "paypal" && !bankPreview.rowCount) ||
      (bankPreview.format ? !bankSourceConfirmed : !bankMapping.date || !bankMapping.amount)) return;
    setSaving(true); setError(""); setFeedback("");
    try {
      const result = await send<{ id: string; rowCount: number; suggestedCount: number; fileCount?: number; overlapCount?: number; ignoredCount?: number }>(bankFormat === "zip" ? "/api/modules/finance/bank-statements/archive/import" : "/api/modules/finance/bank-statements/import", "POST", { accountId: bankAccountId, fileName: bankFileName, [bankFormat]: bankText, ...((bankFormat === "paypal" || bankFormat === "zip") && paypalDateOrder ? { paypalDateOrder } : {}), ...(bankFormat !== "csv"
          ? { confirmSourceAccount: bankSourceConfirmed, ...(bankRememberSource ? { rememberSource: { expectedAccountId: bankPreview.rememberedAccountId ?? null } } : {}) }
          : { mapping: { date: Number(bankMapping.date), amount: Number(bankMapping.amount),
            description: bankMapping.description === "" ? null : Number(bankMapping.description),
            reference: bankMapping.reference === "" ? null : Number(bankMapping.reference) } }) });
      setBankText(""); setBankFileName(""); setBankPreview(null); setBankSourceConfirmed(false); setBankRememberSource(false);
      await openBankStatements(bankAccountId, false, result.id);
      if (bankDepartment.current === departmentId) {
        setFeedback(`Imported ${result.rowCount} statement rows${result.fileCount ? ` from ${result.fileCount} ZIP members` : ""}. ${result.suggestedCount} possible ledger matches need review.`
          + (result.overlapCount ? ` Duplicate PayPal transactions skipped (${result.overlapCount}).` : ""));
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not import this statement."); }
    finally { setSaving(false); }
  }

  async function changeBankArchive(statement: BankImport, archived: boolean) {
    if (archived && !window.confirm(`Archive "${statement.fileName}"? Its imported rows will be kept and can be restored.`)) return;
    setSaving(true); setError(""); setFeedback("");
    try {
      await send(`/api/modules/finance/bank-statements/${statement.id}/archive`, "PUT", { archived });
      if (bankDepartment.current !== departmentId) return;
      await openBankStatements(bankBrowseAccountId, archived, statement.id);
      setFeedback(archived ? "Statement moved to Archived statements." : "Statement restored to Imported statements.");
    } catch (reason) {
      if (bankDepartment.current === departmentId) setError(reason instanceof Error ? reason.message : "Could not change the statement archive.");
    } finally { setSaving(false); }
  }

  async function recalculateBankSuggestions() {
    const statementId = selectedBankImportId;
    if (!statementId || saving) return;
    setSaving(true);
    setError("");
    setFeedback("");
    try {
      const result = await send<{ reviewedCount: number; updatedCount: number; suggestedCount: number }>(
        `/api/modules/finance/bank-statements/${statementId}/recalculate-suggestions`, "POST", {});
      if (bankDepartment.current !== departmentId) return;
      await openBankStatements();
      setFeedback(`Reviewed ${result.reviewedCount} rows. ${result.updatedCount} suggestions changed, and ${result.suggestedCount} rows have a suggested ledger match.`);
    } catch (reason) {
      if (bankDepartment.current === departmentId) setError(reason instanceof Error ? reason.message : "Could not recalculate suggestions.");
    } finally { setSaving(false); }
  }

  async function reconcileBankRow(row: BankRow, action: "match" | "ignore") {
    setSaving(true); setError(""); setFeedback("");
    try {
      await send(`/api/modules/finance/bank-statement-rows/${row.id}/reconcile`, "PUT", { action, ...(action === "match" ? { transactionId: bankMatchChoice[row.id] ?? row.suggestedTransactionId } : {}) });
      await openBankStatements();
      setFeedback(action === "match" ? "Statement row matched to the existing ledger posting." : "Statement row marked as ignored.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not reconcile this statement row."); }
    finally { setSaving(false); }
  }

  async function addBankRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await action(async () => {
      await send("/api/modules/finance/bank-suggestion-rules", "POST", { ...bankRuleDraft, priority: Number(bankRuleDraft.priority) });
      setBankRuleDraft({ name: "", accountId: "", statementContains: "", transactionContains: "", priority: "100" });
      await openBankStatements();
    }, "Bank suggestion rule saved.");
  }

  async function setBankRuleActive(rule: BankSuggestionRule, active: boolean) {
    await action(async () => { await send(`/api/modules/finance/bank-suggestion-rules/${rule.id}`, "PATCH", { active }); await openBankStatements(); }, active ? "Bank suggestion rule enabled." : "Bank suggestion rule disabled.");
  }

  async function deleteBankRule(rule: BankSuggestionRule) {
    if (!window.confirm(`Delete bank suggestion rule “${rule.name}”?`)) return;
    await action(async () => { await send(`/api/modules/finance/bank-suggestion-rules/${rule.id}`, "DELETE"); await openBankStatements(); }, "Bank suggestion rule deleted.");
  }

  const financialDatesKey = year + ":" + reportType;
  const financialDates = financialReportDates[financialDatesKey] ?? standardFinancialDates;
  const financialDateError = Boolean(financialDates.from && financialDates.to && financialDates.from > financialDates.to);
  const financialYear = bootstrap.accountingYears.find((item) => String(item.accountingYear) === year);
  const transactionYearStart = financialYear?.startDate.slice(0, 10) ?? year + "-01-01";
  const transactionYearEnd = financialYear?.endDate.slice(0, 10) ?? year + "-12-31";
  const transactionMonth = transactionFrom.slice(0, 7);
  const monthRange = monthInAccountingYear(transactionMonth, transactionYearStart, transactionYearEnd);
  const selectedTransactionMonth = monthRange && monthRange.from === transactionFrom && monthRange.to === transactionTo ? transactionMonth : "";

  function setTransactionDates(from: string, to: string) {
    setTransactionPage(1);
    setTransactionFrom(from);
    setTransactionTo(to);
  }

  function applyTransactionMonth(month: string) {
    if (!month) { setTransactionDates("", ""); return; }
    const range = monthInAccountingYear(month, transactionYearStart, transactionYearEnd);
    if (range) setTransactionDates(range.from, range.to);
  }
  const financialQuery = new URLSearchParams({ year, report: reportType,
    ...(financialDates.from ? { from: financialDates.from } : {}),
    ...(financialDates.to ? { to: financialDates.to } : {}),
  }).toString();
  const financialKey = departmentId + ":" + financialQuery;
  const currentFinancialReport = financialReport?.key === financialKey ? financialReport : undefined;
  const trialBalance = currentFinancialReport?.accounts ?? [];

  function changeFinancialDates(dates: FinancialReportDates) {
    setFinancialReportDates((current) => ({ ...current, [financialDatesKey]: dates }));
  }

  useEffect(() => {
    if (tab !== "reports" || financialDateError) return;
    const controller = new AbortController();
    setFinancialReportError("");
    setFinancialReport(undefined);
    void fetch("/api/modules/finance/reports/trial-balance?" + financialQuery, {
      headers: { "x-department-id": departmentId }, signal: controller.signal,
    }).then(async (response) => {
      const data = await response.json() as { accounts?: FinancialReportAccount[]; error?: string };
      if (!response.ok || !Array.isArray(data.accounts)) throw new Error(data.error ?? "Could not load the report.");
      if (!controller.signal.aborted) setFinancialReport({ key: financialKey, accounts: data.accounts });
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setFinancialReportError(failure instanceof Error ? failure.message : "Could not load the report.");
    });
    return () => controller.abort();
  }, [departmentId, financialQuery, financialKey, financialDateError, tab]);

  async function openReports() {
    setTab("reports"); setError("");
    try {
      const result = await send<{ costCenters: typeof costCenterReport }>("/api/modules/finance/reports/cost-center-statement?year=" + encodeURIComponent(year));
      setCostCenterReport(result.costCenters);
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load reports."); }
  }

  async function openStatement() {
    if (!statementAccount) return;
    const params = new URLSearchParams({ accountId: statementAccount });
    if (statementFrom) params.set("from", statementFrom);
    if (statementTo) params.set("to", statementTo);
    try { setStatement(await send<StatementLine[]>(`/api/modules/finance/reports/account-statement?${params}`)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load account statement."); }
  }

  async function reverseTransaction(transaction: Transaction) {
    const reason = window.prompt(`Reason for reversing receipt ${transaction.receiptNumber}:`);
    if (!reason?.trim()) return;
    await action(() => send(`/api/modules/finance/transactions/${transaction.id}/void`, "POST", { reason }), "Reversal posted. Original transaction retained in the audit trail.");
  }

  async function openTransaction(transaction: Pick<Transaction,"id">) {
    try { setTransactionDetail(await send<TransactionDetail>(`/api/modules/finance/transactions/${transaction.id}`)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not open transaction."); }
  }

  function clearTransactionFilters() {
    setQuery("");
    setTransactionFrom("");
    setTransactionTo("");
    setTransactionDonorId("");
    setTransactionAccountId("");
    setTransactionCostCenterId("");
    setTransactionPostedOnly(false);
    setTransactionPage(1);
  }

  function openCostCenterTransactions(costCenterId: string) {
    clearTransactionFilters();
    setTransactionCostCenterId(costCenterId);
    setTransactionPostedOnly(true);
    setTab("transactions");
  }

  function sortHeading(column: TransactionSortColumn, label: string) {
    const active = transactionSort.sort === column;
    const ascending = transactionSort.direction === "asc";
    return <th scope="col" aria-sort={active ? (ascending ? "ascending" : "descending") : undefined}>
      <button className="finance-text-button" type="button" onClick={() => {
        setTransactionPage(1);
        setTransactionSort({ sort: column, direction: active && ascending ? "desc" : "asc" });
      }}>{label}{active && (ascending ? <ArrowUp aria-hidden="true" size={12} /> : <ArrowDown aria-hidden="true" size={12} />)}</button>
    </th>;
  }

  async function exportCsv() {
    try {
      const params = new URLSearchParams({ year, q: query, ...transactionSort });
      if (transactionFrom) params.set("from", transactionFrom);
      if (transactionDonorId) params.set("donorId", transactionDonorId);
      if (transactionAccountId) params.set("accountId", transactionAccountId);
      if (transactionCostCenterId) params.set("costCenterId", transactionCostCenterId);
      if (transactionTo) params.set("to", transactionTo);
      const response = await fetch(`/api/modules/finance/transactions/export.${exportFormat}?${params}`, { headers: { "x-department-id": departmentId } });
      if (!response.ok) throw new Error("Could not export transactions.");
      const url = URL.createObjectURL(await response.blob()); const link = document.createElement("a"); link.href = url; link.download = `finance-transactions.${exportFormat}`; link.click(); URL.revokeObjectURL(url);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not export transactions."); }
  }

  async function exportStatementCsv() {
    if (!statementAccount) return;
    const params = new URLSearchParams({ accountId: statementAccount });
    if (statementFrom) params.set("from", statementFrom);
    if (statementTo) params.set("to", statementTo);
    await downloadReportCsv(`/api/modules/finance/reports/account-statement.csv?${params}`, "finance-account-statement.csv");
  }

  async function exportDonorStatement(donorId: string) {
    const params = new URLSearchParams();
    if (donorStatementFrom) params.set("from", donorStatementFrom);
    if (donorStatementTo) params.set("to", donorStatementTo);
    await downloadReportCsv(`/api/modules/finance/donors/${encodeURIComponent(donorId)}/statement.csv?${params}`, "finance-donor-statement.csv");
  }

  async function exportFinancialStatement() {
    if (financialDateError) return;
    const params = new URLSearchParams(financialQuery);
    if (activeExclusions.length) params.set("exclude", activeExclusions.join(","));
    if (groupReportAccounts) params.set("group", "account-type");
    const filename = "finance-" + reportType + "-" + year + (financialDates.from ? "-from-" + financialDates.from : "")
      + (financialDates.to ? (reportType === "profit-loss" ? "-through-" : "-as-of-") + financialDates.to : "")
      + (activeExclusions.length ? "-filtered" : "") + (groupReportAccounts ? "-by-account-type" : "") + ".csv";
    await downloadReportCsv("/api/modules/finance/reports/turnover.csv?" + params, filename);
  }

  async function downloadFinanceFile(path: string, filename: string) {
    try {
      const response = await fetch(path, { headers: { "x-department-id": departmentId } });
      if (!response.ok) {
        const result = await response.json() as { error?: string };
        throw new Error(result.error ?? "Could not export this file.");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not export this file.");
    }
  }

  function downloadReportCsv(path: string, filename: string) {
    return downloadFinanceFile(path.replace(/\.csv(?=\?|$)/, "." + exportFormat), filename.replace(/\.csv$/, "." + exportFormat));
  }

  const totals = useMemo(() => lines.reduce((sum, line) => ({ debit: sum.debit + Number(line.debit || 0), credit: sum.credit + Number(line.credit || 0) }), { debit: 0, credit: 0 }), [lines]);
  const reportAccounts = useMemo(() => reportType === "balance-sheet" ? trialBalance.filter((row) => ["asset", "liability", "equity"].includes(row.accountType)) : reportType === "profit-loss" ? trialBalance.filter((row) => ["income", "expense"].includes(row.accountType)) : trialBalance, [trialBalance, reportType]);
  const hiddenAccounts = hiddenReportAccounts[reportType] ?? [];
  const visibleReportAccounts = reportAccounts.filter((account) => !hiddenAccounts.includes(account.id));
  const financialAccountGroups = groupReportAccounts ? groupFinancialReportAccounts(visibleReportAccounts) : [];
  const activeExclusions = reportAccounts.filter((account) => hiddenAccounts.includes(account.id)).map((account) => account.id);
  const statementMoney = new Intl.NumberFormat(language, { style: "currency", currency: bootstrap.currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function renderFinancialAccount(item: FinancialReportAccount) {
    return <tr key={item.id}><td>{item.code}</td><td>{item.name}</td><td>{item.accountType}</td>
      <td>{formatLedgerCents(item.debitCents, statementMoney)}</td><td>{formatLedgerCents(item.creditCents, statementMoney)}</td><td>{formatLedgerCents(item.netCents, statementMoney)}</td></tr>;
  }

  const reportTitle = reportType === "balance-sheet" ? "Balance sheet" : reportType === "profit-loss" ? "Profit and loss" : t("Trial balance");
  const tabs: Array<{ id: Tab; label: string; icon: typeof BookOpenCheck }> = [{ id: "transactions", label: t("Transactions"), icon: BookOpenCheck }, { id: "accounts", label: t("Accounts"), icon: WalletCards }, { id: "donors", label: t("Donors"), icon: Users }, { id: "budgets", label: t("Budgets"), icon: CircleDollarSign }, ...(canManage ? [{ id: "accounting-years" as const, label: "Accounting years", icon: FileText }] : []), { id: "bank-statements", label: "Bank statements", icon: Landmark }, { id: "receipts", label: "Donation receipts", icon: FileText }, { id: "reports", label: t("Reports"), icon: FileText }];

  return <main className="finance-page">
    <header className="finance-heading"><div><div className="eyebrow">FINANCE</div><h1>{t("Finance & Giving")}</h1><p className="page-subtitle">{t("This ledger uses balanced double-entry postings. Posted entries cannot be edited; reverse them with an auditable counter-entry.")}</p></div><label>Export format<select value={exportFormat} onChange={(event) => setExportFormat(event.target.value === "xlsx" || event.target.value === "html" || event.target.value === "pdf" ? event.target.value : "csv")}><option value="csv">CSV</option><option value="xlsx">Excel (.xlsx)</option><option value="pdf">PDF</option><option value="html">Printable document (.html)</option></select></label><button className="button button-secondary" type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={15} />{t("Refresh")}</button></header>
    <nav className="finance-tabs" aria-label="Finance sections">{tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={tab === id ? "is-active" : ""} onClick={() => { setTab(id); if (id === "reports") void openReports(); if (id === "receipts") void openReceipts(); if (id === "bank-statements") void openBankStatements(); }}><Icon size={16} />{label}</button>)}</nav>
    {error && <p className="finance-alert" role="alert">{error}</p>}{feedback && <p className="finance-feedback" role="status">{feedback}</p>}
    {tab === "bank-statements" && canManage && <section className="finance-section"><div className="finance-section-heading"><div><h2>Bank suggestion rules</h2><p>Rules narrow candidate matches by statement and ledger text. A manager still confirms every reconciliation.</p></div></div>{bankRules.length ? <div className="finance-table-wrap"><table className="finance-table"><thead><tr><th>Name</th><th>Statement contains</th><th>Ledger text contains</th><th>Bank account</th><th>Priority</th><th>Status</th><th /></tr></thead><tbody>{bankRules.map((rule) => <tr key={rule.id}><td>{rule.name}</td><td>{rule.statementContains}</td><td>{rule.transactionContains}</td><td>{rule.accountCode} · {rule.accountName}</td><td>{rule.priority}</td><td>{rule.active ? "Active" : "Disabled"}</td><td><div className="finance-action-row"><button type="button" className="finance-text-button" disabled={saving} onClick={() => void setBankRuleActive(rule, !rule.active)}>{rule.active ? "Disable" : "Enable"}</button><button type="button" className="finance-text-button" disabled={saving} onClick={() => void deleteBankRule(rule)}>Delete</button></div></td></tr>)}</tbody></table></div> : <p className="finance-empty">No suggestion rules yet. Matching uses exact amount, dates within three days, and the selected bank account.</p>}<form className="finance-form-grid" onSubmit={(event) => void addBankRule(event)}><label>Name<input required maxLength={100} value={bankRuleDraft.name} onChange={(event) => setBankRuleDraft({ ...bankRuleDraft, name: event.target.value })} /></label><label>Bank asset account<select required value={bankRuleDraft.accountId} onChange={(event) => setBankRuleDraft({ ...bankRuleDraft, accountId: event.target.value })}><option value="">Choose an account</option>{bootstrap.accounts.filter((account) => account.active && account.accountType === "asset").map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select></label><label>Statement description/reference contains<input required maxLength={120} value={bankRuleDraft.statementContains} onChange={(event) => setBankRuleDraft({ ...bankRuleDraft, statementContains: event.target.value })} /></label><label>Ledger booking/receipt text contains<input required maxLength={120} value={bankRuleDraft.transactionContains} onChange={(event) => setBankRuleDraft({ ...bankRuleDraft, transactionContains: event.target.value })} /></label><label>Priority (higher first)<input type="number" min="0" max="1000" value={bankRuleDraft.priority} onChange={(event) => setBankRuleDraft({ ...bankRuleDraft, priority: event.target.value })} /></label><div className="finance-form-actions"><button className="button button-secondary" type="submit" disabled={saving || !bankRuleDraft.accountId}>Save suggestion rule</button></div></form></section>}
    <div className="finance-filter-row"><label>{t("Budget year")}<select value={year} onChange={(event) => { setTransactionPage(1); setYear(event.target.value); }}>{bootstrap.accountingYears.length ? bootstrap.accountingYears.map((item) => <option key={item.accountingYear} value={item.accountingYear}>{item.label} ({item.startDate.slice(0, 10)} – {item.endDate.slice(0, 10)})</option>) : [...new Set([new Date().getFullYear(), ...bootstrap.years])].sort((a, b) => b - a).map((item) => <option key={item} value={item}>{item}</option>)}</select></label><span className="finance-currency"><ShieldCheck size={16} />{bootstrap.currency} · {department.location}</span>{canManage && <label>Currency<select value={currencyDraft} onChange={(event) => setCurrencyDraft(event.target.value)}>{["CHF", "EUR", "USD", "GBP", "CAD", "AUD"].map((code) => <option key={code}>{code}</option>)}</select></label>}{canManage && <button className="button button-secondary" type="button" onClick={() => void saveCurrency()} disabled={saving || currencyDraft === bootstrap.currency}>Save currency</button>}</div>
    {tab === "transactions" && <section className="finance-section">
      <div className="finance-section-heading"><div><h2>{t("Transactions")}</h2><p>Posted ledger entries · accounting year {year}</p></div><div className="finance-action-row"><button className="button button-secondary" type="button" onClick={() => void exportCsv()}><ArrowDownToLine size={15} />{exportFormat === "pdf" ? "Download PDF" : exportFormat === "html" ? "Download printable document" : exportFormat === "xlsx" ? "Export XLSX" : t("Export CSV")}</button>{canManage && <button className="button button-secondary" type="button" disabled={bootstrap.accounts.filter((account) => account.active && account.accountType === "asset").length < 2} onClick={() => setShowTransfer(true)}>Transfer between accounts</button>}{canManage && <button type="button" className="button button-secondary"
        disabled={bootstrap.costCenters.filter(center => center.active).length<2
          || !bootstrap.accounts.some(account => account.active && ["asset","liability","equity"].includes(account.accountType))}
        onClick={() => setShowCostCenterTransfer(true)}>Transfer cost-center budget</button>}{canManage && transitAccounts.length >= 2 && <button className="button button-secondary" type="button" onClick={() => {
        journalSubmissionId.current = null;
        setManualReceipt(false);
        setReceiptNumber("");
        setBookingText("");
        setBankPosting(null);
        setTransitDraft(initialTransit());
        setShowPosting(true);
      }}>{t("Money in transit")}</button>}{canManage && <button className="button button-primary" type="button" onClick={() => { journalSubmissionId.current=null;setManualReceipt(false);setTransitDraft(null);setBankPosting(null);setShowPosting(true); }}><Plus size={15} />{t("New transaction")}</button>}</div></div>
      <div className="finance-filter-row finance-transaction-filters"><label>{t("Search transactions")}<input aria-label={t("Search transactions")} placeholder={t("Search transactions")} value={query} onChange={(event) => { setTransactionPage(1); setQuery(event.target.value); }} /></label><label>{t("Donors")}<select value={transactionDonorId} onChange={(event) => {
        setTransactionPage(1); setTransactionDonorId(event.target.value);
      }}>
        <option value="">All donors</option>
        {transactionDonorId && !bootstrap.donors.some((donor) => donor.id === transactionDonorId) && <option value={transactionDonorId}>Selected donor</option>}
        {bootstrap.donors.map((donor) => <option key={donor.id} value={donor.id}>{donor.displayName}{donor.active ? "" : " (inactive)"}</option>)}
      </select></label><label>{t("Account")}<select value={transactionAccountId} onChange={(event) => {
        setTransactionPage(1); setTransactionAccountId(event.target.value);
      }}>
        <option value="">All accounts</option>
        {transactionAccountId && !bootstrap.accounts.some((account) => account.id === transactionAccountId) && <option value={transactionAccountId}>Selected account</option>}
        {bootstrap.accounts.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}{account.active ? "" : " (inactive)"}</option>)}
      </select></label><label>{t("Cost center")}<select value={transactionCostCenterId} onChange={(event) => {
        setTransactionPage(1); setTransactionCostCenterId(event.target.value);
      }}>
        <option value="">All cost centers</option>
        {transactionCostCenterId && !bootstrap.costCenters.some((center) => center.id === transactionCostCenterId) && <option value={transactionCostCenterId}>Selected cost center</option>}
        {bootstrap.costCenters.map((center) => <option key={center.id} value={center.id}>{center.code} · {center.name}{center.active ? "" : " (inactive)"}</option>)}
      </select></label><label>Transaction month<input type="month" value={selectedTransactionMonth}
        min={transactionYearStart.slice(0, 7)} max={transactionYearEnd.slice(0, 7)}
        onChange={(event) => applyTransactionMonth(event.target.value)} /></label><label>From<input type="date" value={transactionFrom} onChange={(event) => { setTransactionPage(1); setTransactionFrom(event.target.value); }} /></label><label>To<input type="date" value={transactionTo} onChange={(event) => { setTransactionPage(1); setTransactionTo(event.target.value); }} /></label><label className="finance-posted-filter"><input type="checkbox" checked={transactionPostedOnly} onChange={(event) => {
        setTransactionPage(1); setTransactionPostedOnly(event.target.checked);
      }} />Posted only</label>
      {(transactionFrom || transactionTo) && <button className="finance-text-button" type="button" onClick={() => setTransactionDates("", "")}>Full accounting year</button>}
      {(query || transactionFrom || transactionTo || transactionDonorId || transactionAccountId || transactionCostCenterId || transactionPostedOnly) && <button className="finance-text-button" type="button" onClick={clearTransactionFilters}>Clear filters</button>}</div>
      <p className="finance-security-note" aria-live="polite">Showing {transactionTotal ? (transactionPage - 1) * 50 + 1 : 0}–{Math.min(transactionPage * 50, transactionTotal)} of {transactionTotal.toLocaleString()} transactions · year {year}{transactionFrom ? ` · from ${transactionFrom}` : ""}{transactionTo ? ` · through ${transactionTo}` : ""}{query ? ` · matching “${query}”` : ""}</p>
      {transactionFrom && transactionTo && transactionFrom > transactionTo && <p className="finance-error">Start date must be on or before end date.</p>}
      {loading ? <p>Loading transactions…</p> : transactions.length ? <><div className="finance-table-wrap"><table className="finance-table"><thead><tr>{sortHeading("date", t("Booking date"))}{sortHeading("receipt", t("Receipt number"))}{sortHeading("description", t("Booking text"))}{sortHeading("debit", t("Debit"))}{sortHeading("credit", t("Credit"))}{sortHeading("status", "Status")}<th>Details</th>{canManage && <th />}</tr></thead><tbody>{transactions.map((item) => <tr key={item.id}><td>{new Date(`${item.bookingDate}T00:00:00`).toLocaleDateString()}</td><td>{item.receiptNumber}{item.reversesTransactionId && <small>Reversal</small>}</td><td>{item.bookingText}</td><td>{money(item.debitCents, bootstrap.currency)}</td><td>{money(item.creditCents, bootstrap.currency)}</td><td>{item.status === "posted" ? t("Posted") : t("Draft")}{item.isCostCenterTransfer && <small> · Cost-center transfer</small>}</td><td><button className="finance-text-button" type="button" onClick={() => void openTransaction(item)}>Open</button></td>{canManage && <td>{item.status === "posted" && !item.reversesTransactionId && <button className="finance-text-button" type="button" onClick={() => void reverseTransaction(item)}>{t("Reverse")}</button>}</td>}</tr>)}</tbody></table></div><div className="finance-form-actions"><span>Page {transactionPage} of {Math.max(1, Math.ceil(transactionTotal / 50))}</span><button className="button button-secondary" type="button" disabled={loading || transactionPage <= 1} onClick={() => setTransactionPage((current) => current - 1)}>Previous</button><button className="button button-secondary" type="button" disabled={loading || transactionPage >= Math.ceil(transactionTotal / 50)} onClick={() => setTransactionPage((current) => current + 1)}>Next</button></div></> : <p className="finance-empty">{t("No transactions yet.")}</p>}
    </section>}
    {tab === "accounts" && <section className="finance-section"><div className="finance-section-heading"><div><h2>{t("Accounts")}</h2><p>Chart of accounts and cost centers for {year}.</p></div>{canManage && <div className="finance-action-row"><button className="button button-secondary" type="button" onClick={() => setShowCostCenter(true)}><Plus size={15} />{t("New cost center")}</button><button className="button button-primary" type="button" onClick={() => setShowAccount(true)}><Plus size={15} />{t("New account")}</button></div>}</div><div className="finance-section-heading"><h3>Chart of accounts</h3>
        <button type="button" className="finance-text-button"
          onClick={() => void downloadFinanceFile("/api/modules/finance/master-data/accounts/csv", "finance-chart-of-accounts.csv")}>Export chart of accounts CSV</button>
      </div>{canManage && <FinanceMasterDataImport key={"accounts-" + departmentId} dataset="accounts" send={send} refresh={load} />}{bootstrap.accounts.length ? <div className="finance-table-wrap"><table className="finance-table"><thead><tr><th>{t("Account code")}</th><th>{t("Name")}</th><th>{t("Type")}</th><th>Status</th>{canManage && <th>Actions</th>}</tr></thead><tbody>{bootstrap.accounts.map((item) => <tr key={item.id}><td>{item.code}</td><td>{item.name}</td><td>{item.accountType}</td><td>{item.active ? "Active" : "Archived"}</td>{canManage && <td>{masterDataStatusButton("accounts", item)}</td>}</tr>)}</tbody></table></div> : <p className="finance-empty">{t("No accounts yet.")}</p>}<div className="finance-section-heading"><h3>Cost centers</h3>
        <div className="finance-action-row">
          <button type="button" className="finance-text-button"
            onClick={() => void downloadFinanceFile("/api/modules/finance/master-data/cost-centers/csv", "finance-cost-centers.csv")}>Export cost centers CSV</button>
          <button type="button" className="finance-text-button"
            onClick={() => void downloadFinanceFile("/api/modules/finance/master-data/cost-centers/xlsx", "finance-cost-centers.xlsx")}>Export cost centers Excel</button>
        </div>
      </div>{canManage && <FinanceMasterDataImport key={"cost-centers-" + departmentId} dataset="cost-centers" send={send} refresh={load} accountingYears={bootstrap.accountingYears} currency={bootstrap.currency} />}{bootstrap.costCenters.length ? <div className="finance-table-wrap"><table className="finance-table"><thead><tr><th>Code</th><th>{t("Name")}</th><th>Status</th>{canManage && <th>Actions</th>}</tr></thead><tbody>{bootstrap.costCenters.map((item) => <tr key={item.id}><td>{item.code}</td><td>{item.name}</td><td>{item.active ? "Active" : "Archived"}</td>{canManage && <td>{masterDataStatusButton("cost-centers", item)}</td>}</tr>)}</tbody></table></div> : <p className="finance-empty">No cost centers yet.</p>}</section>}
    {tab === "donors" && <FinanceRecentGiving key={departmentId} departmentId={departmentId}
      openTransaction={(id) => void openTransaction({ id })} />}
    {tab === "donors" && <section className="finance-section"><div className="finance-section-heading"><div><h2>{t("Donors")}</h2><p>Donor master data and ledger-linked giving.</p></div>{canManage && <button className="button button-primary" type="button" onClick={() => setShowDonor(true)}><Plus size={15} />{t("New donor")}</button>}</div>{canManage && <div className="finance-filter-row"><label>Statement from<input type="date" value={donorStatementFrom} onChange={(event) => setDonorStatementFrom(event.target.value)} /></label><label>Through<input type="date" value={donorStatementTo} onChange={(event) => setDonorStatementTo(event.target.value)} /></label><span className="finance-security-note">Exports include posted donor-linked income lines.</span></div>}{donorStatementFrom && donorStatementTo && donorStatementFrom > donorStatementTo && <p className="finance-error">Start date must be on or before end date.</p>}{bootstrap.donors.length ? <div className="finance-table-wrap"><table className="finance-table"><thead><tr><th>{t("Name")}</th><th>Type</th><th>{t("Email")}</th><th>Giving total</th><th>Latest gift</th><th>Status</th>{canManage && <th>Statement</th>}</tr></thead><tbody>{bootstrap.donors.map((item) => <tr key={item.id}><td>{item.displayName}</td><td>{item.donorType === "joint" ? t("Joint donor") : t("Individual")}</td><td>{item.email}</td><td>{money(item.totalGiftsCents ?? 0, bootstrap.currency)}</td><td>{item.latestGiftDate ? new Date(`${item.latestGiftDate.slice(0, 10)}T00:00:00`).toLocaleDateString() : "—"}</td><td>{item.active ? "Active" : "Archived"}</td>{canManage && <td><button className="finance-text-button" type="button" disabled={Boolean(donorStatementFrom && donorStatementTo && donorStatementFrom > donorStatementTo)} onClick={() => void exportDonorStatement(item.id)}><ArrowDownToLine size={14} />CSV</button></td>}</tr>)}</tbody></table></div> : <p className="finance-empty">{t("No donors yet.")}</p>}</section>}
    {tab === "accounting-years" && canManage && <section className="finance-section">
      <div className="finance-section-heading"><div><h2>Accounting years</h2><p>Configure location-scoped booking periods. Closing a period blocks new postings, budgets, and receipts; existing records remain available.</p></div></div>
      <form className="finance-form-grid" onSubmit={(event) => void addAccountingYear(event)}><label>Year key<input type="number" required min="1900" max="2200" value={accountingYearDraft.accountingYear} onChange={(event) => setAccountingYearDraft({ ...accountingYearDraft, accountingYear: event.target.value })} /></label><label>Label<input required maxLength={120} value={accountingYearDraft.label} onChange={(event) => setAccountingYearDraft({ ...accountingYearDraft, label: event.target.value })} /></label><label>Start date<input type="date" required value={accountingYearDraft.startDate} onChange={(event) => setAccountingYearDraft({ ...accountingYearDraft, startDate: event.target.value })} /></label><label>End date<input type="date" required value={accountingYearDraft.endDate} onChange={(event) => setAccountingYearDraft({ ...accountingYearDraft, endDate: event.target.value })} /></label><div className="finance-form-actions"><button className="button button-primary" type="submit" disabled={saving}>Create open accounting year</button></div></form>
      {accountingYearSummary && <section className="finance-section" aria-label="Accounting-year close summary"><div className="finance-section-heading"><div><h3>{accountingYearSummary.period.label} close summary</h3><p>{accountingYearSummary.period.startDate} – {accountingYearSummary.period.endDate} · {accountingYearSummary.period.status}</p></div><button className="finance-text-button" type="button" onClick={() => setAccountingYearSummary(null)}>Close summary</button></div><div className="finance-chip-list"><span>{accountingYearSummary.totals.transactionCount} posted transactions</span><span>Income {money(accountingYearSummary.totals.incomeCents, accountingYearSummary.currency)}</span><span>Expenses {money(accountingYearSummary.totals.expenseCents, accountingYearSummary.currency)}</span><span>Debits {money(accountingYearSummary.totals.debitCents, accountingYearSummary.currency)}</span><span>Credits {money(accountingYearSummary.totals.creditCents, accountingYearSummary.currency)}</span><span>{accountingYearSummary.unreconciledBank.rowCount} unreconciled bank rows · {money(accountingYearSummary.unreconciledBank.amountCents, accountingYearSummary.currency)}</span></div><h4>Budget variance (budget − actual)</h4>{accountingYearSummary.budgetVariance.length ? <div className="finance-table-wrap"><table className="finance-table"><thead><tr><th>Account</th><th>Cost center</th><th>Budget</th><th>Actual</th><th>Variance</th></tr></thead><tbody>{accountingYearSummary.budgetVariance.map((item) => <tr key={item.id}><td>{item.accountCode ? `${item.accountCode} · ${item.accountName}` : "—"}</td><td>{item.costCenterCode ? `${item.costCenterCode} · ${item.costCenterName}` : "—"}</td><td>{money(item.budgetCents, accountingYearSummary.currency)}</td><td>{money(item.actualCents, accountingYearSummary.currency)}</td><td>{money(item.varianceCents, accountingYearSummary.currency)}</td></tr>)}</tbody></table></div> : <p className="finance-empty">No budgets are set for this accounting year.</p>}{accountingYearSummary.yearEndTransfer ? <div className="finance-security-note"><strong>Year-end transfer completed.</strong> Closed {accountingYearSummary.yearEndTransfer.sourceYear} into {accountingYearSummary.yearEndTransfer.targetYear}. Closing journal: {accountingYearSummary.yearEndTransfer.closingTransactionId ?? "no non-zero P&L balance"}; opening journal: {accountingYearSummary.yearEndTransfer.openingTransactionId ?? "no non-zero balance-sheet balance"}.</div> : <><p className="finance-security-note">Bank totals include unmatched and suggested statement rows. Closing posts permanent balanced journals, carries forward asset, liability, and equity balances, then closes the source year. Cost-center totals are preserved; donor detail is not carried into the equity close.</p>{accountingYearSummary.period.status === "open" && <form className="finance-form-grid" onSubmit={(event) => void closeAndCarryForward(event)}><label>Next accounting year<select required value={String(accountingYearSummary.period.accountingYear + 1)} disabled><option value={String(accountingYearSummary.period.accountingYear + 1)}>{bootstrap.accountingYears.find((item) => item.accountingYear === accountingYearSummary.period.accountingYear + 1)?.label ?? "Not configured"}</option></select></label><label>Closing equity account<select required value={yearEndEquityAccountId} onChange={(event) => setYearEndEquityAccountId(event.target.value)}><option value="">Choose an equity account</option>{bootstrap.accounts.filter((account) => account.active && account.accountType === "equity").map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select></label><div className="finance-form-actions"><button className="button button-primary" type="submit" disabled={saving || !yearEndEquityAccountId || !bootstrap.accountingYears.some((item) => item.accountingYear === accountingYearSummary.period.accountingYear + 1 && item.status === "open")}>Post closing and carry-forward entries</button></div><p className="finance-security-note">Both years must be configured and open. The operation is atomic and can run only once per source year. Corrections require audited reversals.</p></form>}</>}</section>}
      {bootstrap.accountingYears.length ? <div className="finance-table-wrap"><table className="finance-table"><thead><tr><th>Year key</th><th>Label</th><th>Start</th><th>End</th><th>Status</th><th>Actions</th></tr></thead><tbody>{bootstrap.accountingYears.map((item) => { const edit = accountingYearEdits[item.accountingYear] ?? item; return <tr key={item.accountingYear}><td>{item.accountingYear}</td><td><input aria-label={`Label for ${item.label}`} maxLength={120} value={edit.label} onChange={(event) => setAccountingYearEdits({ ...accountingYearEdits, [item.accountingYear]: { ...edit, label: event.target.value } })} /></td><td><input aria-label={`Start date for ${item.label}`} type="date" value={edit.startDate.slice(0, 10)} onChange={(event) => setAccountingYearEdits({ ...accountingYearEdits, [item.accountingYear]: { ...edit, startDate: event.target.value } })} /></td><td><input aria-label={`End date for ${item.label}`} type="date" value={edit.endDate.slice(0, 10)} onChange={(event) => setAccountingYearEdits({ ...accountingYearEdits, [item.accountingYear]: { ...edit, endDate: event.target.value } })} /></td><td>{item.status}</td><td><div className="finance-action-row"><button className="finance-text-button" type="button" disabled={saving} onClick={() => void openAccountingYearSummary(item.accountingYear)}>Summary</button><button className="finance-text-button" type="button" disabled={saving} onClick={() => void saveAccountingYear(item)}>Save</button>
      <label><input type="checkbox" checked={Boolean(item.journalNumberingEnabled)} disabled={saving || item.status!=="open"}
        onChange={event => { const enabled=event.target.checked;
          void action(() => send(`/api/modules/finance/accounting-years/${item.accountingYear}/journal-numbering`,"PUT",{enabled}),"Receipt numbering updated.");
        }} /> Automatic receipt numbers</label><button className="finance-text-button" type="button" disabled={saving} onClick={() => item.status === "open" ? void openAccountingYearSummary(item.accountingYear) : void setAccountingYearStatus(item, "open")}>{item.status === "open" ? "Close and carry forward" : "Reopen"}</button></div></td></tr>; })}</tbody></table></div> : <p className="finance-empty">No accounting years configured.</p>}
    </section>}
    {tab === "bank-statements" && <section className="finance-section"><div className="finance-section-heading"><div><h2>Bank statements</h2><p>Import a CSV, MT940, CAMT.053 (including STUZZA), PayPal Activity Report, or ZIP archive of statements, review matching suggestions, and link statement rows to existing ledger entries. Imports never create postings.</p></div><button className="button button-secondary" type="button" onClick={() => void openBankStatements()}><RefreshCw size={15} />Refresh</button></div>{canManage && <div className="finance-bank-import"><h3>Import a bank statement</h3><div className="finance-form-grid"><label>Bank asset account<select value={bankAccountId} disabled={saving} onChange={(event) => { bankAccountChange.current++; setBankAccountId(event.target.value); setBankPreview(null); setBankSourceConfirmed(false); setBankRememberSource(false); }}><option value="">Choose an account</option>{bootstrap.accounts.filter((account) => account.active && account.accountType === "asset").map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select></label><label>Statement or PayPal Activity Report file
      <input type="file" accept=".zip,application/zip,.csv,.mt940,.sta,.swi,.txt,.xml,.camt,.053,text/csv,text/plain,application/xml,text/xml" disabled={saving}
        onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void readBankStatement(file); }} />
    </label>{bankText && (bankFormat === "paypal" || bankFormat === "zip") && <label>PayPal dates with slashes
      <select value={paypalDateOrder} disabled={saving} onChange={event => { setPaypalDateOrder(event.target.value); setBankPreview(null); setBankSourceConfirmed(false); }}>
        <option value="">Report dates have no slashes</option><option value="day-first">Day / month / year</option><option value="month-first">Month / day / year</option>
      </select></label>}</div>{bankText && <div className="finance-action-row"><button className="button button-secondary" type="button" onClick={() => void previewBankStatement()} disabled={saving || !bankAccountId}>Preview file</button><span>{bankFileName}</span></div>}{bankPreview && <><p>{bankPreview.rowCount} statement rows found.{bankPreview.duplicate ? bankPreview.archivedDuplicate ? " This statement is archived. Restore it from Archived statements to review or post its rows." : bankPreview.format === "zip" ? " All statements are already imported for this account. Check Archived statements if you cannot find them." : " This exact file was already imported for this account." : ""}</p>{bankPreview.format === "paypal" && <p>PayPal Activity Report · {bankPreview.currency}. Skip duplicates ({bankPreview.overlapCount ?? 0}) and entries with no balance impact ({bankPreview.ignoredCount ?? 0}).</p>}{bankPreview.format === "zip" && <div><p>{bankPreview.archiveFormat === "paypal" ? "PayPal report archive" : `${bankStatementFormatName(bankPreview.archiveFormat, bankPreview.profile)} archive · Account ending in ${bankPreview.accountEnding}`} · {bankPreview.currency} · Accounting year {bankPreview.accountingYear}</p>
      {bankPreview.archiveFormat === "paypal" && <p>Skip duplicates ({bankPreview.overlapCount ?? 0}) and entries with no balance impact ({bankPreview.ignoredCount ?? 0}).</p>}
      <ul>{bankPreview.files?.map((member, index) => <li key={index}>{member.fileName} · {member.rowCount} {bankPreview.archiveFormat === "paypal" ? "new " : ""}{member.rowCount === 1 ? "row" : "rows"}{member.alreadyImported ? " · Already imported" : member.overlapCount ? ` · Duplicates skipped (${member.overlapCount})` : ""}</li>)}</ul>
    </div>}{bankPreview.format && bankPreview.format !== "paypal" && bankPreview.format !== "zip" && <p>{bankStatementFormatName(bankPreview.format, bankPreview.profile)} source account ending in {bankPreview.accountEnding} · {bankPreview.currency}</p>}
    {!bankPreview.format && bankPreview.headers.length > 0 && <div className="finance-form-grid"><label>Date column<select value={bankMapping.date} onChange={(event) => setBankMapping({ ...bankMapping, date: event.target.value })}><option value="">Choose date column</option>{bankPreview.headers.map((header, index) => <option key={index} value={index}>{index + 1}. {header}</option>)}</select></label><label>Amount column<select value={bankMapping.amount} onChange={(event) => setBankMapping({ ...bankMapping, amount: event.target.value })}><option value="">Choose amount column</option>{bankPreview.headers.map((header, index) => <option key={index} value={index}>{index + 1}. {header}</option>)}</select></label>{(["description", "reference"] as const).map((key) => <label key={key}>{key === "description" ? "Description" : "Reference"} column<select value={bankMapping[key]} onChange={(event) => setBankMapping({ ...bankMapping, [key]: event.target.value })}><option value="">No column</option>{bankPreview.headers.map((header, index) => <option key={index} value={index}>{index + 1}. {header}</option>)}</select></label>)}</div>}{bankPreview.sample.length > 0 && <div className="finance-table-wrap"><table className="finance-table">
      {bankPreview.format && <thead><tr>{bankPreview.headers.map(heading => <th key={heading} scope="col">{heading}</th>)}</tr></thead>}
      <tbody>{bankPreview.sample.map((row, index) => <tr key={index}>{row.map((value, cell) => <td key={cell}>{value}</td>)}</tr>)}</tbody></table></div>}{bankPreview.format && <label>
      <input type="checkbox" checked={bankSourceConfirmed} onChange={event => setBankSourceConfirmed(event.target.checked)} />
      I confirm the statement belongs to the selected ledger account.
    </label>}{bankPreview.format && bankPreview.format !== "paypal" && bankPreview.format !== "zip" && bankPreview.rememberedAccountId !== bankAccountId && <label>
      <input type="checkbox" checked={bankRememberSource} disabled={!bankSourceConfirmed || bankPreview.duplicate}
        onChange={event => setBankRememberSource(event.target.checked)} />
      {bankPreview.rememberedAccountId ? "Replace the remembered ledger account for this source after import" : "Remember this source account for future statements"}
    </label>}<div className="finance-action-row"><button className="button button-primary" type="button" onClick={() => void importBankStatement()} disabled={saving || bankPreview.duplicate || (bankPreview.format === "paypal" && !bankPreview.rowCount) || (bankPreview.format ? !bankSourceConfirmed : !bankMapping.date || !bankMapping.amount)}>Import and suggest matches</button></div></>}</div>}
      <div className="finance-section-heading"><h3>{showArchivedBankStatements ? "Archived statements" : "Imported statements"}</h3>
        <label>Statement account<select value={bankBrowseAccountId} disabled={saving}
          onChange={event => void openBankStatements(event.target.value, showArchivedBankStatements, "")}>
          <option value="">All statement accounts</option>
          {bankImportAccounts.map(account => <option key={account.id} value={account.id}>{account.code} · {account.name} ({account.matched}/{account.rowCount} matched, {account.statementCount} imported, {account.archivedCount} archived)</option>)}
        </select></label>
        <label><input type="checkbox" checked={showArchivedBankStatements} disabled={saving}
          onChange={event => void openBankStatements(bankBrowseAccountId, event.target.checked, "")} /> Show archived statements</label>
      </div>{bankImports.length ? <div className="finance-bank-import-list">{bankImports.map((item) => <button type="button" key={item.id} className={selectedBankImportId === item.id ? "is-selected" : ""} disabled={saving} onClick={() => void openBankImport(item.id)}><strong>{item.fileName}</strong><small>{item.accountCode} · {item.accountName} · {new Date(item.importedAt).toLocaleString()}</small><small>{item.rowCount} rows · {item.matched} matched · {item.suggested} suggested · {item.unmatched} unmatched · {item.ignored} ignored</small></button>)}</div> : <p className="finance-empty">{showArchivedBankStatements ? "No archived statements for this selection." : "No imported statements for this selection."}</p>}
      {selectedBankImportId && <><div className="finance-section-heading"><h3>Statement rows</h3>
        {canManage && <div className="finance-action-row">
          {!showArchivedBankStatements && <button type="button" className="button button-secondary" disabled={saving}
            onClick={() => void recalculateBankSuggestions()}><RefreshCw size={15} />Recalculate suggestions</button>}
          {bankImports.filter(item => item.id === selectedBankImportId && (showArchivedBankStatements || item.matched === 0)).map(item =>
            <button key={item.id} type="button" className="button button-secondary" disabled={saving}
              onClick={() => void changeBankArchive(item, !showArchivedBankStatements)}>
              {showArchivedBankStatements ? "Restore statement" : "Archive statement"}
            </button>)}
        </div>}
      </div>{bankRows.length ? <div className="finance-table-wrap"><table className="finance-table"><thead><tr><th>Date</th><th>Description / reference</th><th>Amount</th><th>Status</th><th>Ledger match</th>{canManage && !showArchivedBankStatements && <th>Action</th>}</tr></thead><tbody>{bankRows.map((row) => <tr key={row.id}><td>{new Date(`${row.bookingDate.slice(0, 10)}T00:00:00`).toLocaleDateString()}</td><td>{row.description}{row.reference && <small>{row.reference}</small>}</td><td>{money(row.amountCents, bootstrap.currency)}</td><td>{row.status}</td><td>{row.status === "matched" ? `${row.transactionReceipt ?? row.matchedTransactionId ?? "Matched"} · ${row.transactionText ?? ""}` : canManage && !showArchivedBankStatements && row.status !== "ignored" ? <select aria-label={`Ledger match for statement row ${row.lineNumber}`} value={bankMatchChoice[row.id] ?? ""} onChange={(event) => setBankMatchChoice({ ...bankMatchChoice, [row.id]: event.target.value })}><option value="">Choose a posting</option>{row.suggestedTransactionId && <option value={row.suggestedTransactionId}>Suggested: {row.transactionReceipt} · {row.transactionText}</option>}{transactions.map((transaction) => <option key={transaction.id} value={transaction.id}>{transaction.bookingDate} · {transaction.receiptNumber} · {transaction.bookingText}</option>)}</select> : row.status === "ignored" ? "Ignored" : row.transactionText ?? "No unique suggestion"}</td>{canManage && !showArchivedBankStatements && <td>{row.status !== "matched" && row.status !== "ignored" && <div className="finance-action-row"><button className="finance-text-button" type="button" disabled={saving || !(bankMatchChoice[row.id] ?? row.suggestedTransactionId)} onClick={() => void reconcileBankRow(row, "match")}>Match</button><button className="finance-text-button" type="button" disabled={saving} onClick={() => void reconcileBankRow(row, "ignore")}>Ignore</button>{row.status === "unmatched" && row.amountCents !== 0 &&
      transitAccounts.some(account => account.id === row.accountId) &&
      <button className="finance-text-button" type="button" disabled={saving} onClick={() => openBankPosting(row)}>Post and match</button>}</div>}</td>}</tr>)}</tbody></table></div> : <p className="finance-empty">No statement rows in this import.</p>}</>}
    </section>}
    {tab === "receipts" && <section className="finance-section"><div className="finance-section-heading"><div><h2>Donation receipts</h2><p>Preview posted donor gifts, then issue an individual receipt or a collective annual batch. Issued receipts are permanent and numbered.</p></div><button className="button button-secondary" type="button" onClick={() => void openReceipts()}><RefreshCw size={15} />Refresh</button></div><div className="finance-form-grid"><label>From<input type="date" value={receiptFrom} onChange={(event) => setReceiptFrom(event.target.value)} /></label><label>To<input type="date" value={receiptTo} onChange={(event) => setReceiptTo(event.target.value)} /></label><label className="finance-form-wide">Receipt mode<select value={receiptCollective ? "collective" : "individual"} onChange={(event) => { const collective = event.target.value === "collective"; setReceiptCollective(collective); if (collective) setReceiptDonorId(""); }}><option value="collective">Collective batch: one receipt per eligible donor</option><option value="individual">One donor</option></select></label>{!receiptCollective && <label className="finance-form-wide">Donor<select value={receiptDonorId} onChange={(event) => setReceiptDonorId(event.target.value)}><option value="">Choose donor</option>{bootstrap.donors.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>}</div><div className="finance-action-row"><button className="button button-secondary" type="button" onClick={() => void refreshReceiptPreview()} disabled={!receiptFrom || !receiptTo}>Preview eligible gifts</button>{canManage && <button className="button button-primary" type="button" onClick={() => void issueReceipts()} disabled={saving || !receiptPreview.length || (!receiptCollective && !receiptDonorId)}>Issue {receiptCollective ? "collective batch" : "individual receipt"}</button>}</div>{receiptPreview.length ? <div className="finance-table-wrap"><table className="finance-table"><thead><tr><th>Donor</th><th>Email</th><th>Donation transactions</th><th>Total</th></tr></thead><tbody>{receiptPreview.map((item) => <tr key={item.donorId}><td>{item.donorName}</td><td>{item.donorEmail || "—"}</td><td>{item.donationCount}</td><td>{money(item.amountCents, bootstrap.currency)}</td></tr>)}</tbody></table></div> : <p className="finance-empty">No preview yet or no eligible posted donations in this period.</p>}{canManage && <form className="finance-section" onSubmit={(event) => void saveReceiptSettings(event)}><h3>Receipt template and numbering</h3><p>Available fields: <code>{'{{donorName}}'}</code>, <code>{'{{period}}'}</code>, <code>{'{{amount}}'}</code>, <code>{'{{currency}}'}</code>, <code>{'{{organization}}'}</code>.</p><div className="finance-form-grid"><label>Organization<input maxLength={180} value={receiptSettings.organizationName} onChange={(event) => setReceiptSettings({ ...receiptSettings, organizationName: event.target.value })} /></label><label>Number prefix<input maxLength={24} pattern="[A-Za-z0-9-]+" value={receiptSettings.numberingPrefix} onChange={(event) => setReceiptSettings({ ...receiptSettings, numberingPrefix: event.target.value })} /></label><label className="finance-form-wide">Receipt text<textarea rows={8} maxLength={4000} value={receiptSettings.templateText} onChange={(event) => setReceiptSettings({ ...receiptSettings, templateText: event.target.value })} /></label></div><button className="button button-secondary" type="submit" disabled={saving}>Save receipt settings</button></form>}<h3>Issued receipts</h3>{issuedReceipts.length ? <div className="finance-table-wrap"><table className="finance-table"><thead><tr><th>Receipt number</th><th>Donor</th><th>Amount</th><th>Period</th><th>Print</th></tr></thead><tbody>{issuedReceipts.map((item, index) => <tr key={item.id}><td>{item.receiptNumber}</td><td>{item.donorName}</td><td>{money(item.amountCents, item.currency || bootstrap.currency)}</td><td>{item.periodStart} – {item.periodEnd}</td><td><a href={item.printUrl} target="_blank" rel="noreferrer">Open / print</a>{issuedReceipts.findIndex((receipt) => receipt.batchId === item.batchId) === index && <><br /><a href={item.batchPrintUrl} target="_blank" rel="noreferrer">Print batch</a></>}</td></tr>)}</tbody></table></div> : <p className="finance-empty">No receipts issued for this year.</p>}<p className="finance-security-note">Receipt text and totals are snapshots of posted donor-linked income at issue time. Review local legal and tax requirements before issuing official tax receipts; donor postal addresses, statutory clauses, signatures, and e-delivery are not covered here.</p></section>}
    {tab === "budgets" && <section className="finance-section"><div className="finance-section-heading"><div><h2>{t("Budgets")}</h2><p>Plan spending by account, cost center and year.</p></div>{canManage && <button className="button button-primary" type="button" disabled={!bootstrap.accountingYears.some((item) => item.status === "open")} onClick={() => { const openYear = bootstrap.accountingYears.find((item) => item.accountingYear === Number(year) && item.status === "open") ?? bootstrap.accountingYears.find((item) => item.status === "open"); if (openYear) setBudgetDraft({ ...budgetDraft, accountingYear: String(openYear.accountingYear) }); setShowBudget(true); }}><Plus size={15} />{t("Save budget")}</button>}</div>{bootstrap.budgets.filter((item) => item.accountingYear === Number(year)).length ? <div className="finance-table-wrap"><table className="finance-table"><thead><tr><th>Year</th><th>{t("Account")}</th><th>{t("Cost center")}</th><th>{t("Amount")}</th><th>Note</th></tr></thead><tbody>{bootstrap.budgets.filter((item) => item.accountingYear === Number(year)).map((item) => <tr key={item.id}><td>{item.accountingYear}</td><td>{item.accountCode ? `${item.accountCode} · ${item.accountName}` : "—"}</td><td>{item.costCenterCode ? `${item.costCenterCode} · ${item.costCenterName}` : "—"}</td><td>{money(item.amountCents, bootstrap.currency)}</td><td>{item.note}</td></tr>)}</tbody></table></div> : <p className="finance-empty">{t("No budgets yet.")}</p>}</section>}
    {tab === "reports" && <section className="finance-section"><div className="finance-section-heading"><div><h2>{t("Reports")}</h2><p>{reportTitle} · {year}</p></div><div className="finance-action-row"><select aria-label="Report type" value={reportType} onChange={(event) => setReportType(event.target.value as typeof reportType)}><option value="trial-balance">{t("Trial balance")}</option><option value="balance-sheet">Balance sheet</option><option value="profit-loss">Profit and loss</option></select><button className="button button-secondary" type="button" onClick={() => void openReports()}><RefreshCw size={15} />{t("Refresh")}</button>{canManage && <button className="button button-secondary" type="button" disabled={financialDateError || !currentFinancialReport} onClick={() => void exportFinancialStatement()}><ArrowDownToLine size={15} />{exportFormat === "pdf" ? "Download PDF" : exportFormat === "html" ? "Download printable document" : exportFormat === "xlsx" ? "Export XLSX" : "Export CSV"}</button>}</div></div><h3>{reportTitle}</h3>
      <div className="finance-filter-row">
        {reportType === "profit-loss" && <label>From<input type="date" value={financialDates.from}
          min={financialYear?.startDate.slice(0, 10)} max={financialYear?.endDate.slice(0, 10)}
          onChange={(event) => changeFinancialDates({ ...financialDates, from: event.target.value })} /></label>}
        <label>{reportType === "profit-loss" ? "Through" : "As of"}<input type="date" value={financialDates.to}
          min={financialYear?.startDate.slice(0, 10)} max={financialYear?.endDate.slice(0, 10)}
          onChange={(event) => changeFinancialDates({ ...financialDates, to: event.target.value })} /></label>
        <label><input type="checkbox" checked={groupReportAccounts} onChange={(event) => setGroupReportAccounts(event.target.checked)} />Group by account type</label>
        {(financialDates.from || financialDates.to) && <button className="button button-secondary" type="button"
          onClick={() => changeFinancialDates(standardFinancialDates)}>Use full accounting year</button>}
      </div>
      {financialDateError ? <p role="alert">The start date must be on or before the end date.</p>
        : financialReportError ? <p role="alert">{financialReportError}</p>
        : !currentFinancialReport && <p role="status">Loading report…</p>}
      {reportAccounts.length > 0 && <FinanceReportAccountFilter key={departmentId + ":" + reportType} accounts={reportAccounts}
      hiddenIds={activeExclusions} onChange={(ids) => setHiddenReportAccounts((current) => ({ ...current, [reportType]: ids }))} />}
      {visibleReportAccounts.length ? <div className="finance-table-wrap"><table className="finance-table"><thead><tr><th>{t("Account code")}</th><th>{t("Name")}</th><th>Class</th><th>{t("Debit")}</th><th>{t("Credit")}</th><th>Net (debit − credit)</th></tr></thead>{groupReportAccounts ? financialAccountGroups.map(([accountType, group]) => <tbody key={accountType}>
        <tr><th scope="rowgroup" colSpan={3}>{financialAccountTypeLabels[accountType] ?? accountType}</th>
          <td><strong>{formatLedgerCents(String(group.debit), statementMoney)}</strong></td>
          <td><strong>{formatLedgerCents(String(group.credit), statementMoney)}</strong></td>
          <td><strong>{formatLedgerCents(String(group.net), statementMoney)}</strong></td></tr>
        {group.accounts.map(renderFinancialAccount)}
      </tbody>) : <tbody>{visibleReportAccounts.map(renderFinancialAccount)}</tbody>}</table></div> : currentFinancialReport && <p className="finance-empty">{activeExclusions.length ? "All accounts are hidden." : "No accounts match this report."}</p>}<div className="finance-section-heading"><h3>Cost-center statement · {year}</h3>{canManage && <button className="button button-secondary" type="button" onClick={() => void downloadReportCsv("/api/modules/finance/reports/cost-center-statement.csv?year=" + encodeURIComponent(year), "finance-cost-centers-" + year + ".csv")}><ArrowDownToLine size={15} />{exportFormat === "pdf" ? "Download PDF" : exportFormat === "html" ? "Download printable document" : exportFormat === "xlsx" ? "Export XLSX" : "Export CSV"}</button>}</div>{costCenterReport.length > 0 && <div className="finance-table-wrap"><table className="finance-table"><thead><tr><th>Code</th><th>{t("Cost center")}</th><th>{t("Debit")}</th><th>{t("Credit")}</th><th>Transactions</th></tr></thead><tbody>{costCenterReport.map((item) => <tr key={item.id}><td>{item.code}</td><td>{item.name}</td><td>{money(item.debitCents, bootstrap.currency)}</td><td>{money(item.creditCents, bootstrap.currency)}</td><td>{item.transactionCount > 0 ? <button className="finance-text-button" type="button"
        onClick={() => openCostCenterTransactions(item.id)} aria-label={"Open transactions for " + item.name}>{item.transactionCount}</button> : 0}</td></tr>)}</tbody></table></div>}<div className="finance-statement-toolbar"><h3>{t("Account statement")}</h3><select aria-label={t("Choose account")} value={statementAccount} onChange={(event) => setStatementAccount(event.target.value)}><option value="">{t("Choose account")}</option>{bootstrap.accounts.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select><label>From<input type="date" value={statementFrom} onChange={(event) => { setStatementFrom(event.target.value); setStatement([]); }} /></label><label>To<input type="date" value={statementTo} onChange={(event) => { setStatementTo(event.target.value); setStatement([]); }} /></label><button className="button button-secondary" type="button" onClick={() => void openStatement()} disabled={!statementAccount || Boolean(statementFrom && statementTo && statementFrom > statementTo)}>{t("Account statement")}</button>{canManage && <button className="button button-secondary" type="button" onClick={() => void exportStatementCsv()} disabled={!statementAccount || Boolean(statementFrom && statementTo && statementFrom > statementTo)}><ArrowDownToLine size={15} />{exportFormat === "pdf" ? "Download PDF" : exportFormat === "html" ? "Download printable document" : exportFormat === "xlsx" ? "Export XLSX" : "Export CSV"}</button>}</div>{statement.length > 0 && <div className="finance-table-wrap"><table className="finance-table"><thead><tr><th>{t("Booking date")}</th><th>{t("Receipt number")}</th><th>{t("Booking text")}</th><th>Account</th><th>Cost center</th><th>Counteraccounts</th><th>{t("Debit")}</th><th>{t("Credit")}</th><th>{t("Running balance")}</th></tr></thead><tbody>
      {statement.map(line => <tr key={line.lineId}>
        <td>{new Date(`${line.bookingDate}T00:00:00`).toLocaleDateString()}</td>
        <td><button type="button" className="button button-secondary" onClick={() => void openTransaction({ id:line.id })}>{line.receiptNumber}</button></td>
        <td>{line.lineText || line.bookingText}</td><td>{line.account.code} · {line.account.name}</td>
        <td>{line.costCenter ? `${line.costCenter.code} · ${line.costCenter.name}` : "—"}</td>
        <td>{line.counterAccounts.map(account => `${account.code} · ${account.name}`).join("; ") || "—"}</td>
        <td>{formatLedgerCents(line.debitCents,statementMoney)}</td><td>{formatLedgerCents(line.creditCents,statementMoney)}</td>
        <td>{formatLedgerCents(line.runningBalanceCents,statementMoney)}</td>
      </tr>)}</tbody></table></div>}</section>}

    {tab === "reports" && <FinanceCostCenterDetail key={departmentId + ":" + year} departmentId={departmentId} year={year}
      centers={bootstrap.costCenters} canManage={canManage} exportFormat={exportFormat} onDownload={downloadReportCsv}
      openTransaction={(id) => void openTransaction({ id })} />}
    {tab === "reports" && <FinancePeriodTurnover key={departmentId + ":" + year} departmentId={departmentId}
      year={year} currency={bootstrap.currency} canManage={canManage} exportFormat={exportFormat} onDownload={downloadReportCsv} />}

    {showCostCenterTransfer && canManage && <FinanceCostCenterTransfer key={departmentId}
      accounts={bootstrap.accounts.filter(account => account.active && ["asset","liability","equity"].includes(account.accountType))}
      centers={bootstrap.costCenters} date={today()} currency={bootstrap.currency} cancel={() => setShowCostCenterTransfer(false)}
      post={async (draft) => {
        await send("/api/modules/finance/transactions/cost-center-transfer","POST",draft);
        setShowCostCenterTransfer(false);
        setFeedback("Cost-center transfer posted.");
        await load();
      }} />}

    {showTransfer && canManage && <div className="finance-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !saving && setShowTransfer(false)}>
      <section className="finance-dialog" role="dialog" aria-modal="true" aria-labelledby="finance-transfer-title">
        <header><h2 id="finance-transfer-title">Transfer between accounts</h2><button className="finance-close" type="button" disabled={saving} onClick={() => setShowTransfer(false)} aria-label="Close">×</button></header>
        <form onSubmit={(event) => void postTransfer(event)}>
          <div className="finance-form-grid">
            {(["fromAccount", "toAccount"] as const).map((name) => <label key={name}>{name === "fromAccount" ? "From account" : "To account"}
              <select name={name} required defaultValue="">
                <option value="">Choose an asset account</option>
                {bootstrap.accounts.filter((account) => account.active && account.accountType === "asset").map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}
              </select>
            </label>)}
            <label>Amount ({bootstrap.currency})<input name="amount" type="number" min="0.01" step="0.01" required /></label>
            <label>Booking date<input name="bookingDate" type="date" defaultValue={bookingDate} required /></label>
            <label>Receipt number<input name="receiptNumber" maxLength={80} required /></label>
            <label>Booking text<input name="bookingText" maxLength={500} required /></label>
          </div>
          {error && <p role="alert">{error}</p>}
          <div className="finance-form-actions">
            <button className="button button-secondary" type="button" disabled={saving} onClick={() => setShowTransfer(false)}>Cancel</button>
            <button className="button button-primary" type="submit" disabled={saving}>Post transfer</button>
          </div>
        </form>
      </section>
    </div>}
    {showPosting && <div className="finance-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closePosting()}><section className="finance-dialog" role="dialog" aria-modal="true" aria-labelledby="finance-post-title"><header><div><span className="eyebrow">DOUBLE-ENTRY JOURNAL</span><h2 id="finance-post-title">{bankPosting ? "Post and match statement row" : transitDraft ? t("Post money in transit") : t("Post transaction")}</h2></div><button className="finance-close" type="button" onClick={closePosting} aria-label="Close">×</button></header><form onSubmit={(event) => void postTransaction(event)}><div className="finance-form-grid"><label>{t("Booking date")}<input type="date" required readOnly={Boolean(bankPosting)} value={bookingDate} onChange={(event) => setBookingDate(event.target.value)} /></label>{dateUsesNumbering && <label><input type="checkbox" checked={manualReceipt} onChange={event => setManualReceipt(event.target.checked)} /> Use a manual receipt number</label>}
      <label>{t("Receipt number")}<input required={!automaticReceipt} maxLength={80} value={automaticReceipt ? "" : receiptNumber}
        placeholder={automaticReceipt ? "Assigned when posted" : undefined} disabled={automaticReceipt} onChange={event => setReceiptNumber(event.target.value)} /></label><label className="finance-form-wide">{t("Booking text")}<input required maxLength={500} value={bookingText} onChange={(event) => setBookingText(event.target.value)} /></label></div>
      {bankPosting ? <fieldset className="finance-form-grid" disabled={saving}>
        <legend>Statement details</legend>
        {statementReviewIndex >= 0 && statementReviewRows.length > 1 && <nav className="finance-form-wide finance-action-row" aria-label="Unmatched statement rows">
          <button className="button button-secondary" type="button" disabled={!previousReviewRow}
            onClick={() => navigateBankPosting(previousReviewRow)}>Previous unmatched row</button>
          <span aria-live="polite">{statementReviewIndex + 1} of {statementReviewRows.length} unmatched rows</span>
          <button className="button button-secondary" type="button" disabled={!nextReviewRow}
            onClick={() => navigateBankPosting(nextReviewRow)}>Next unmatched row</button>
        </nav>}
        <p className="finance-form-wide">{bankAsset?.code} · {bankAsset?.name} · {money(bankPosting.row.amountCents, bootstrap.currency)}
          {bankPosting.row.reference && <> · {bankPosting.row.reference}</>}</p>
        {availablePurposes.length > 0 && <label className="finance-form-wide">Booking purpose
          <select value={bankPosting.purposeId ?? ""} onChange={event => applyBookingPurpose(event.target.value)}>
            <option value="">Choose a purpose</option>
            {availablePurposes.map(purpose => <option key={purpose.id} value={purpose.id}>{purpose.name}</option>)}
          </select>
        </label>}
        {paypal ? <>
          <dl className="finance-form-wide">
            <dt>PayPal gross</dt><dd>{money(paypal.grossCents, paypal.currency)}</dd>
            <dt>PayPal fee</dt><dd>{money(paypal.feeCents, paypal.currency)}</dd>
            <dt>PayPal net</dt><dd>{money(bankPosting.row.amountCents, paypal.currency)}</dd>
          </dl>
          {paypal.currency !== bootstrap.currency && <p role="alert">This PayPal row uses a different currency from the ledger.</p>}
          <label>PayPal posting type
            <select value={bankPosting.paypalMode} onChange={event => {
              const paypalMode = event.target.value as PaypalBookingMode;
              setBankPosting({ ...bankPosting, paypalMode, purposeId: undefined, lines: [newCounterLine()] });
            }}>
              <option value="payment">Payment or refund</option>
              <option value="transfer" disabled={paypal.grossCents === 0}>{t("Money in transit")}</option>
            </select>
          </label>
          {paypal.grossCents !== 0 && <label>{bankPosting.paypalMode === "transfer" ? t("Clearing account") : "Payment counteraccount"}
            <select required value={bankPosting.lines[0]?.accountId ?? ""} onChange={event =>
              updateBankCounterLine(bankPosting.lines[0]!.key, { accountId: event.target.value })}>
              <option value="">Choose an account</option>
              {paypalCounterAccounts.map(account => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}
            </select>
          </label>}
          {paypal.grossCents !== 0 && bankPosting.paypalMode === "payment" && <label>{t("Cost center")}
            <select value={paypalPaymentCounter?.costCenterId ?? ""} onChange={event =>
              updateBankCounterLine(bankPosting.lines[0]!.key, { costCenterId: event.target.value })}>
              <option value="">{t("Choose cost center")}</option>
              {bootstrap.costCenters.filter(center => center.active).map(center => <option key={center.id} value={center.id}>{center.code} · {center.name}</option>)}
            </select>
          </label>}
          {paypal.feeCents !== 0 && <label>PayPal fee expense account
            <select required value={bankPosting.feeAccountId} onChange={event => setBankPosting({ ...bankPosting, feeAccountId: event.target.value })}>
              <option value="">Choose an expense account</option>
              {paypalFeeAccounts.map(account => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}
            </select>
          </label>}
          {bankPosting.paypalMode === "transfer" && <p className="finance-form-wide">Use the same clearing account on the other statement when the transfer settles.</p>}
        </> : <>
        {bankPosting.lines.map((line, index) => <div className="finance-form-grid finance-form-wide" key={line.key}>
          <label>{isBankSplit ? `Counteraccount ${index + 1}` : "Counteraccount"}
            <select required value={line.accountId} onChange={event => updateBankCounterLine(line.key, { accountId: event.target.value })}>
              <option value="">Choose an account</option>
              {bootstrap.accounts.filter(account => account.active && account.id !== bankPosting.row.accountId).map(account =>
                <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}
            </select>
          </label>
          <label>{isBankSplit ? `Cost center ${index + 1}` : t("Cost center")}
            <select value={line.costCenterId} onChange={event => updateBankCounterLine(line.key, { costCenterId: event.target.value })}>
              <option value="">{t("Choose cost center")}</option>
              {bootstrap.costCenters.filter(center => center.active).map(center =>
                <option key={center.id} value={center.id}>{center.code} · {center.name}</option>)}
            </select>
          </label>
          {isBankSplit && <>
            <label>{`Amount ${index + 1}`}
              <input type="number" inputMode="decimal" min="0.01" step="0.01" required value={line.amount}
                onChange={event => updateBankCounterLine(line.key, { amount: event.target.value })} />
            </label>
            <div className="finance-form-actions">
              <button type="button" className="finance-text-button" aria-label={`Remove split line ${index + 1}`}
                onClick={() => setBankPosting({ ...bankPosting, lines: bankPosting.lines.filter(item => item.key !== line.key) })}>{t("Remove")}</button>
            </div>
          </>}
        </div>)}
        <div className="finance-form-wide finance-action-row">
          <button type="button" className="finance-text-button" disabled={bankPosting.lines.length >= 99}
            onClick={() => setBankPosting({ ...bankPosting, purposeId: undefined, lines: [...bankPosting.lines, newCounterLine()] })}>Add split line</button>
          {isBankSplit && <span aria-live="polite">{Number.isSafeInteger(splitTotal)
            ? splitTotal > bankAmount ? `Over by ${money(splitTotal - bankAmount, bootstrap.currency)}`
              : `Remaining ${money(bankAmount - splitTotal, bootstrap.currency)}`
            : "Enter smaller split amounts."}</span>}
        </div>
        </>}
      </fieldset> : transitDraft ? <fieldset className="finance-form-grid" disabled={saving}>
        <legend>{t("Transfer leg")}</legend>
        <label>{t("Direction")}<select value={transitDraft.leg} onChange={event => {
          const leg = event.target.value as TransitLeg;
          setTransitDraft({ ...transitDraft, leg });
        }}><option value="outgoing">{t("Money sent")}</option><option value="incoming">{t("Money received")}</option></select></label>
        <label>{transitDraft.leg === "outgoing" ? t("Source bank or cash account") : t("Destination bank or cash account")}
          <select required value={transitDraft.bankAccount} onChange={event => setTransitDraft({ ...transitDraft, bankAccount: event.target.value })}>
            <option value="">{t("Choose a bank or cash account")}</option>
            {transitAccounts.map(account => <option key={account.id} value={account.id} disabled={account.id === transitDraft.clearingAccount}>{account.code} · {account.name}</option>)}
          </select>
        </label>
        <label>{t("Clearing account")}<select required value={transitDraft.clearingAccount} onChange={event => setTransitDraft({ ...transitDraft, clearingAccount: event.target.value })}>
          <option value="">{t("Choose an asset account")}</option>
          {transitAccounts.map(account => <option key={account.id} value={account.id} disabled={account.id === transitDraft.bankAccount}>{account.code} · {account.name}</option>)}
        </select></label>
        <label>{t("Transfer amount")}<input required inputMode="decimal" type="number" min="0.01" step="0.01" value={transitDraft.amount}
          onChange={event => setTransitDraft({ ...transitDraft, amount: event.target.value })} /></label>
        <p className="finance-form-wide">{transitDraft.leg === "outgoing"
          ? t("Debits clearing and credits the source. Post the incoming leg separately on the date the money arrives.")
          : t("Debits the destination and credits clearing. Use the same clearing account and amount as the outgoing leg.")}</p>
      </fieldset> : <><div className="finance-journal-lines"><div className="finance-journal-header"><strong>Journal lines</strong><button className="finance-text-button" type="button" onClick={() => setLines((current) => [...current, initialLine()])}><Plus size={14} />{t("Add line")}</button></div>{lines.map((line, index) => <div className="finance-journal-line" key={index}><select aria-label={`${t("Account")} ${index + 1}`} required value={line.accountId} onChange={(event) => setLines((current) => current.map((item, row) => row === index ? { ...item, accountId: event.target.value } : item))}><option value="">{t("Choose a bank or cash account")}</option>{bootstrap.accounts.filter((account) => account.active).map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select><select aria-label={`${t("Cost center")} ${index + 1}`} value={line.costCenterId} onChange={(event) => setLines((current) => current.map((item, row) => row === index ? { ...item, costCenterId: event.target.value } : item))}><option value="">{t("Choose cost center")}</option>{bootstrap.costCenters.filter((center) => center.active).map((center) => <option key={center.id} value={center.id}>{center.code} · {center.name}</option>)}</select><select aria-label={`${t("Donor")} ${index + 1}`} value={line.donorId} onChange={(event) => setLines((current) => current.map((item, row) => row === index ? { ...item, donorId: event.target.value } : item))}><option value="">{t("Donor")}</option>{bootstrap.donors.filter((donor) => donor.active).map((donor) => <option key={donor.id} value={donor.id}>{donor.displayName}</option>)}</select><input aria-label={t("Debit")} type="number" min="0" step="0.01" placeholder={t("Debit")} value={line.debit} onChange={(event) => setLines((current) => current.map((item, row) => row === index ? { ...item, debit: event.target.value, credit: event.target.value ? "" : item.credit } : item))} /><input aria-label={t("Credit")} type="number" min="0" step="0.01" placeholder={t("Credit")} value={line.credit} onChange={(event) => setLines((current) => current.map((item, row) => row === index ? { ...item, credit: event.target.value, debit: event.target.value ? "" : item.debit } : item))} /><input aria-label="Line memo" placeholder="Line memo" value={line.text} onChange={(event) => setLines((current) => current.map((item, row) => row === index ? { ...item, text: event.target.value } : item))} />{lines.length > 2 && <button className="finance-close" type="button" onClick={() => setLines((current) => current.filter((_, row) => row !== index))}>{t("Remove")}</button>}</div>)}</div><div className={Math.abs(totals.debit - totals.credit) < 0.005 && totals.debit > 0 ? "finance-balanced" : "finance-unbalanced"}>{Math.abs(totals.debit - totals.credit) < 0.005 && totals.debit > 0 ? t("Balanced") : `${t("Difference")}: ${money(Math.round((totals.debit - totals.credit) * 100), bootstrap.currency)}`} · {t("Debit")} {money(Math.round(totals.debit * 100), bootstrap.currency)} / {t("Credit")} {money(Math.round(totals.credit * 100), bootstrap.currency)}</div></>}<p className="finance-security-note">Posted entries are permanent. Corrections create an equal and opposite dated transaction.</p><div className="finance-form-actions"><button className="button button-secondary" type="button" onClick={closePosting}>Cancel</button><button className="button button-primary" type="submit" disabled={saving || (bankPosting ? !bankPostingValid : transitDraft ? !transitValid : bootstrap.accounts.filter(account => account.active).length < 2 || Math.abs(totals.debit - totals.credit) >= 0.005 || totals.debit === 0)}>{bankPosting ? "Post and match" : t("Post transaction")}</button></div></form></section></div>}
    {showAccount && <div className="finance-overlay"><section className="finance-dialog" role="dialog" aria-modal="true"><header><h2>{t("New account")}</h2><button className="finance-close" type="button" onClick={() => setShowAccount(false)}>×</button></header><form onSubmit={(event) => void addAccount(event)} className="finance-form-grid"><label>{t("Account code")}<input required maxLength={32} value={accountDraft.code} onChange={(event) => setAccountDraft({ ...accountDraft, code: event.target.value })} /></label><label>{t("Name")}<input required maxLength={160} value={accountDraft.name} onChange={(event) => setAccountDraft({ ...accountDraft, name: event.target.value })} /></label><label>{t("Type")}<select value={accountDraft.accountType} onChange={(event) => setAccountDraft({ ...accountDraft, accountType: event.target.value as Account["accountType"] })}>{["asset", "liability", "equity", "income", "expense"].map((type) => <option key={type}>{type}</option>)}</select></label><div className="finance-form-actions"><button className="button button-primary" type="submit" disabled={saving}>{t("Save account")}</button></div></form></section></div>}
    {tab === "accounts" && canManage && <BookingPurposesPanel key={departmentId} purposes={bookingPurposes}
      accounts={bootstrap.accounts} centers={bootstrap.costCenters} busy={saving} save={saveBookingPurpose} />}
    {tab === "accounts" && canManage && <SimpleBookingGrantsPanel key={departmentId} send={send} centers={bootstrap.costCenters} />}
    {tab === "accounts" && <section className="finance-section">
      <h3>Tax types</h3>
      <p>Reference rates for your location. These rates do not calculate taxes or post entries.</p>
      {canManage && <form className="finance-form-grid" onSubmit={(event) => void addTaxType(event)}>
        <label>Code<input required maxLength={32} value={taxTypeDraft.code} onChange={(event) => setTaxTypeDraft({ ...taxTypeDraft, code: event.target.value })} /></label>
        <label>Name<input required maxLength={160} value={taxTypeDraft.name} onChange={(event) => setTaxTypeDraft({ ...taxTypeDraft, name: event.target.value })} /></label>
        <label>Reference rate (%)<input type="number" min="0" max="100" step="0.01" value={taxTypeDraft.rate} onChange={(event) => setTaxTypeDraft({ ...taxTypeDraft, rate: event.target.value })} /></label>
        <div className="finance-form-actions"><button className="button button-secondary" type="submit" disabled={saving}>Add tax type</button></div>
      </form>}
      {bootstrap.taxTypes?.length ? <div className="finance-table-wrap"><table className="finance-table">
        <thead><tr><th>Code</th><th>Name</th><th>Reference rate</th><th>Status</th>{canManage && <th>Actions</th>}</tr></thead>
        <tbody>{bootstrap.taxTypes.map((item) => <tr key={item.id}>
          <td>{item.code}</td><td>{item.name}</td>
          <td>{item.rateBasisPoints === null ? "—" : new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 2 }).format(item.rateBasisPoints / 10000)}</td>
          <td>{item.active ? "Active" : "Archived"}</td>
          {canManage && <td>{masterDataStatusButton("tax-types", item)}</td>}
        </tr>)}</tbody>
      </table></div> : <p className="finance-empty">No tax types yet.</p>}
    </section>}
    {showCostCenter && <div className="finance-overlay"><section className="finance-dialog" role="dialog" aria-modal="true"><header><h2>{t("New cost center")}</h2><button className="finance-close" type="button" onClick={() => setShowCostCenter(false)}>×</button></header><form onSubmit={(event) => void addCostCenter(event)} className="finance-form-grid"><label>{t("Account code")}<input required maxLength={32} value={costCenterDraft.code} onChange={(event) => setCostCenterDraft({ ...costCenterDraft, code: event.target.value })} /></label><label>{t("Name")}<input required maxLength={160} value={costCenterDraft.name} onChange={(event) => setCostCenterDraft({ ...costCenterDraft, name: event.target.value })} /></label><div className="finance-form-actions"><button className="button button-primary" type="submit" disabled={saving}>{t("Save cost center")}</button></div></form></section></div>}
    {showDonor && <div className="finance-overlay"><section className="finance-dialog" role="dialog" aria-modal="true"><header><h2>{t("New donor")}</h2><button className="finance-close" type="button" onClick={() => setShowDonor(false)}>×</button></header><form onSubmit={(event) => void addDonor(event)} className="finance-form-grid"><label>{t("Name")}<input required maxLength={180} value={donorDraft.displayName} onChange={(event) => setDonorDraft({ ...donorDraft, displayName: event.target.value })} /></label><label>Type<select value={donorDraft.donorType} onChange={(event) => setDonorDraft({ ...donorDraft, donorType: event.target.value as Donor["donorType"] })}><option value="individual">{t("Individual")}</option><option value="joint">{t("Joint donor")}</option></select></label><label>{t("Email")}<input type="email" maxLength={254} value={donorDraft.email} onChange={(event) => setDonorDraft({ ...donorDraft, email: event.target.value })} /></label><div className="finance-form-actions"><button className="button button-primary" type="submit" disabled={saving}>{t("Save donor")}</button></div></form></section></div>}
    {showBudget && <div className="finance-overlay"><section className="finance-dialog" role="dialog" aria-modal="true"><header><h2>{t("Budgets")}</h2><button className="finance-close" type="button" onClick={() => setShowBudget(false)}>×</button></header><form onSubmit={(event) => void addBudget(event)} className="finance-form-grid"><label>{t("Budget year")}<select required value={budgetDraft.accountingYear} onChange={(event) => setBudgetDraft({ ...budgetDraft, accountingYear: event.target.value })}>{bootstrap.accountingYears.filter((item) => item.status === "open").map((item) => <option key={item.accountingYear} value={item.accountingYear}>{item.label}</option>)}</select></label><label>{t("Amount")} ({bootstrap.currency})<input required type="number" min="0" step="0.01" value={budgetDraft.amount} onChange={(event) => setBudgetDraft({ ...budgetDraft, amount: event.target.value })} /></label><label>{t("Account")}<select value={budgetDraft.accountId} onChange={(event) => setBudgetDraft({ ...budgetDraft, accountId: event.target.value })}><option value="">—</option>{bootstrap.accounts.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select></label><label>{t("Cost center")}<select value={budgetDraft.costCenterId} onChange={(event) => setBudgetDraft({ ...budgetDraft, costCenterId: event.target.value })}><option value="">—</option>{bootstrap.costCenters.map((center) => <option key={center.id} value={center.id}>{center.code} · {center.name}</option>)}</select></label><label className="finance-form-wide">Note<input maxLength={500} value={budgetDraft.note} onChange={(event) => setBudgetDraft({ ...budgetDraft, note: event.target.value })} /></label><div className="finance-form-actions"><button className="button button-primary" type="submit" disabled={saving || (!budgetDraft.accountId && !budgetDraft.costCenterId) || bootstrap.accountingYears.every((item) => item.status !== "open")}>{t("Save budget")}</button></div></form></section></div>}
    {transactionDetail && <div className="finance-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setTransactionDetail(null)}><section className="finance-dialog" role="dialog" aria-modal="true" aria-labelledby="finance-detail-title"><header><div><span className="eyebrow">{transactionDetail.bookingDate}</span><h2 id="finance-detail-title">{transactionDetail.receiptNumber} · {transactionDetail.bookingText}</h2><p>{transactionDetail.status} · accounting year {transactionDetail.accountingYear}{transactionDetail.isCostCenterTransfer && " · Cost-center transfer"}</p></div><button className="finance-close" type="button" onClick={() => setTransactionDetail(null)} aria-label="Close">×</button></header><div className="finance-table-wrap"><table className="finance-table"><thead><tr><th>{t("Account")}</th><th>{t("Cost center")}</th><th>{t("Donor")}</th><th>{t("Debit")}</th><th>{t("Credit")}</th><th>Line memo</th></tr></thead><tbody>{transactionDetail.lines.map((line) => <tr key={line.id}><td>{line.accountCode} · {line.accountName}</td><td>{line.costCenterName ?? "—"}</td><td>{line.donorName ?? "—"}</td><td>{money(line.debitCents, bootstrap.currency)}</td><td>{money(line.creditCents, bootstrap.currency)}</td><td>{line.text}</td></tr>)}</tbody></table></div>{transactionDetail.status === "posted" && <FinanceTransactionEvidence key={departmentId + ":" + transactionDetail.id}
      transactionId={transactionDetail.id} departmentId={departmentId} csrfToken={csrfToken} canManage={canManage} />}
      {canManage && transactionDetail.status === "draft" && transactionDetail.audit.some((item) => item.action === "churchtools-journal-draft-created" || item.action === "churchtools-journal-split-draft-created") && <DraftPostingReview key={transactionDetail.id} transactionId={transactionDetail.id} departmentId={departmentId} onPosted={async () => { await openTransaction(transactionDetail); await load(); setFeedback("Reviewed draft posted."); }} />}<h3>Audit history</h3><ol className="finance-audit-list">{transactionDetail.audit.map((item, index) => <li key={`${item.action}-${index}`}><strong>{item.action.replaceAll("_", " ")}</strong><span>{item.actorName ?? "System"} · {new Date(item.createdAt).toLocaleString()}</span>{typeof item.details.reason === "string" && <p>{item.details.reason}</p>}
      {typeof item.details.bookingPurposeName === "string" && <p>Booking purpose · {item.details.bookingPurposeName}</p>}</li>)}</ol></section></div>}
  </main>;
}
