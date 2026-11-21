import { useEffect, useState } from "react";
import { getActiveLanguage } from "../../i18n";
import { formatLedgerCents } from "./ledger-cents";

type Interval = "month" | "quarter";
type TurnoverRow = { periodStart: string; accountId: string; code: string; name: string; accountType: string; debitCents: string; creditCents: string; netCents: string };
type TurnoverPage = { page: number; hasNext: boolean; rows: TurnoverRow[] };
const path = "/api/modules/finance/reports/period-turnover";
const accountTypes = ["asset", "liability", "equity", "income", "expense"] as const;

export function FinancePeriodTurnover({ departmentId, year, currency, canManage, exportFormat, onDownload }: {
  departmentId: string; year: string; currency: string; canManage: boolean; exportFormat: string;
  onDownload: (path: string, filename: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [interval, setInterval] = useState<Interval>("month");
  const [accountType, setAccountType] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<TurnoverPage>();
  const [error, setError] = useState("");
  const query = new URLSearchParams({ year, interval, ...(accountType ? { accountType } : {}) }).toString();

  useEffect(() => {
    if (!open || !departmentId) return;
    const controller = new AbortController();
    setResult(undefined);
    setError("");
    void fetch(path + "?" + query + "&page=" + page, {
      headers: { "x-department-id": departmentId }, signal: controller.signal,
    }).then(async (response) => {
      const data = await response.json() as TurnoverPage | { error?: string };
      if (!response.ok || !("rows" in data)) throw new Error("error" in data ? data.error ?? "Could not load turnover." : "Could not load turnover.");
      if (!controller.signal.aborted) setResult(data);
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Could not load turnover.");
    });
    return () => controller.abort();
  }, [departmentId, open, page, query]);

  const language = getActiveLanguage();
  const money = new Intl.NumberFormat(language, { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const month = new Intl.DateTimeFormat(language, { month: "short", year: "numeric", timeZone: "UTC" });

  return <details className="finance-section" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Turnover by period</summary>
    {open && <>
      <div className="finance-filter-row">
        <label>Interval<select value={interval} onChange={(event) => { setPage(1); setInterval(event.target.value === "quarter" ? "quarter" : "month"); }}>
          <option value="month">Monthly</option><option value="quarter">Quarterly</option>
        </select></label>
        <label>Account type<select value={accountType} onChange={(event) => { setPage(1); setAccountType(event.target.value); }}>
          <option value="">All account types</option>
          {accountTypes.map((type) => <option key={type} value={type}>{type}</option>)}
        </select></label>
        {canManage && <button className="button button-secondary" type="button" disabled={!result?.rows.length}
          onClick={() => void onDownload(path + "/export." + exportFormat + "?" + query, "finance-period-turnover-" + year + "-" + interval + "." + exportFormat)}>
          Export turnover
        </button>}
      </div>
      {error && <p role="alert">{error}</p>}
      {!result && !error && <p role="status">Loading turnover…</p>}
      {result && (result.rows.length ? <div className="finance-table-wrap"><table className="finance-table">
        <caption>Posted transactions in accounting year {year}</caption>
        <thead><tr><th scope="col">Period</th><th scope="col">Account</th><th scope="col">Type</th><th scope="col">Debit</th><th scope="col">Credit</th><th scope="col">Net debit</th></tr></thead>
        <tbody>{result.rows.map((row) => <tr key={row.periodStart + ":" + row.accountId}>
          <td>{interval === "month" ? month.format(new Date(row.periodStart + "T00:00:00Z"))
            : "Q" + Math.ceil(Number(row.periodStart.slice(5, 7)) / 3) + " " + row.periodStart.slice(0, 4)}</td>
          <td>{row.code} · {row.name}</td><td>{row.accountType}</td>
          <td>{formatLedgerCents(row.debitCents, money)}</td><td>{formatLedgerCents(row.creditCents, money)}</td><td>{formatLedgerCents(row.netCents, money)}</td>
        </tr>)}</tbody>
      </table></div> : <p>No posted activity matches this report.</p>)}
      {result && (result.page > 1 || result.hasNext) && <nav className="finance-form-actions" aria-label="Turnover pages">
        <button className="button button-secondary" type="button" disabled={result.page <= 1} onClick={() => setPage(result.page - 1)}>Previous</button>
        <span>Page {result.page}</span>
        <button className="button button-secondary" type="button" disabled={!result.hasNext} onClick={() => setPage(result.page + 1)}>Next</button>
      </nav>}
    </>}
  </details>;
}
