import { useState } from "react";

type PreviewRow = { rowNumber: number; code: string; name: string; accountType: string; active: boolean; budgetCents: number | null; budgetStatus: "create" | "skip" | null; status: "create" | "skip" | "invalid"; error?: string };
type Preview = { rows: PreviewRow[]; creates: number; skips: number; errors: number; budgetCreates: number; budgetSkips: number; review: string };
type Props = {
  dataset: "accounts" | "cost-centers";
  send: <T>(path: string, method: string, body: unknown) => Promise<T>;
  refresh: () => Promise<void>;
  accountingYears?: Array<{ accountingYear: number; label: string; status: string }>;
  currency?: string;
};

export function FinanceMasterDataImport({ dataset, send, refresh, accountingYears = [], currency = "CHF" }: Props) {
  const isChart = dataset === "accounts";
  const name = isChart ? "chart of accounts" : "cost centers";
  const item = isChart ? "account" : "cost center";
  const itemPlural = isChart ? "accounts" : "cost centers";
  const path = `/api/modules/finance/${dataset}/import/`;
  const template = isChart ? "Code,Name,Type,Active\r\n" : "Code,Name,Active,Budget\r\n";
  const [budgetYear, setBudgetYear] = useState("");
  const yearInput = budgetYear ? { accountingYear: Number(budgetYear) } : {};
  const [file, setFile] = useState<File | null>(null);
  const [reviewed, setReviewed] = useState<{ csv: string; preview: Preview } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");

  async function preview() {
    if (!file || busy) return;
    setError("");
    setResult("");
    setReviewed(null);
    if (file.size > 256_000) { setError("Choose a CSV file of 256 KB or less."); return; }
    setBusy(true);
    try {
      const csv = await file.text();
      setReviewed({ csv, preview: await send<Preview>(path + "preview", "POST", { csv, ...yearInput }) });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The CSV could not be reviewed.");
    } finally { setBusy(false); }
  }

  async function importRows() {
    if (!reviewed || busy || (!reviewed.preview.creates && !reviewed.preview.budgetCreates) || reviewed.preview.errors) return;
    setError("");
    setBusy(true);
    try {
      const { imported, skipped, budgetImported, budgetSkipped } = await send<{ imported: number; skipped: number; budgetImported?: number; budgetSkipped?: number }>(path + "apply", "POST",
        { csv: reviewed.csv, review: reviewed.preview.review, ...yearInput });
      setReviewed(null);
      setResult(`Imported ${imported}. Skipped ${skipped} existing ${itemPlural}.${budgetImported === undefined ? "" : ` Added ${budgetImported} budgets, skipped ${budgetSkipped} existing budgets.`}`);
      await refresh();
    } catch (reason) {
      setReviewed(null);
      setError(reason instanceof Error ? reason.message : "The CSV could not be imported.");
    } finally { setBusy(false); }
  }

  return <details className="finance-section">
    <summary>Import {name}</summary>
    <p>{isChart
      ? "Use Code, Name, Type, and Active columns. Use asset, liability, equity, income, or expense for Type."
      : "Use Code, Name, and Active columns."} Use true or false for Active. Existing {item} codes are skipped.</p>
    {!isChart && <p>Budget is optional. Enter amounts in {currency} and choose an open accounting year. Existing budgets are skipped.</p>}
    <div className="finance-action-row">
      {!isChart && <label>Budget accounting year
        <select value={budgetYear} disabled={busy} onChange={event => {
          setBudgetYear(event.target.value);
          setReviewed(null);
          setError("");
          setResult("");
        }}>
          <option value="">Choose a year for budgets</option>
          {accountingYears.filter(year => year.status === "open").map(year =>
            <option key={year.accountingYear} value={year.accountingYear}>{year.label}</option>)}
        </select>
      </label>}
      <a download={`finance-${dataset}-template.csv`}
        href={`data:text/csv;charset=utf-8,${encodeURIComponent(template)}`}>Download empty template</a>
      <label>{isChart ? "Chart of accounts CSV" : "Cost centers CSV"}<input type="file" accept=".csv,text/csv" disabled={busy} onChange={event => {
        setFile(event.target.files?.[0] ?? null);
        setReviewed(null);
        setError("");
        setResult("");
      }} /></label>
      <button type="button" className="button button-secondary" disabled={!file || busy} onClick={() => void preview()}>Review CSV</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {result && <p role="status">{result}</p>}
    {reviewed && <>
      <p role="status">{reviewed.preview.creates} new · {reviewed.preview.skips} existing · {reviewed.preview.errors} invalid{!isChart && ` · ${reviewed.preview.budgetCreates} new budgets · ${reviewed.preview.budgetSkips} existing budgets`}</p>
      <div className="finance-table-wrap">
        <table className="finance-table">
          <thead><tr><th>Row</th><th>Code</th><th>Name</th>{isChart && <th>Type</th>}<th>Active</th>{!isChart && <th>Budget</th>}<th>Review result</th></tr></thead>
          <tbody>{reviewed.preview.rows.map(row => <tr key={row.rowNumber}>
            <td>{row.rowNumber}</td><td>{row.code}</td><td>{row.name}</td>{isChart && <td>{row.accountType}</td>}
            <td>{row.active ? "Yes" : "No"}</td>
            {!isChart && <td>{row.budgetCents === null ? "—" : new Intl.NumberFormat(undefined, { style: "currency", currency }).format(row.budgetCents / 100)}
              {row.budgetStatus === "skip" && " · Existing"}{row.budgetStatus === "create" && " · Add"}</td>}<td>{row.error ?? (row.status === "skip" ? `Existing ${item}` : "Create")}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <button type="button" className="button button-primary"
        disabled={busy || reviewed.preview.errors > 0 || (!reviewed.preview.creates && !reviewed.preview.budgetCreates)}
        onClick={() => void importRows()}>{isChart ? "Import new accounts" : "Import cost centers and budgets"}</button>
    </>}
  </details>;
}
