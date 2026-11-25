import { useState } from "react";

type PreviewRow = { rowNumber: number; code: string; name: string; accountType: string; active: boolean; status: "create" | "skip" | "invalid"; error?: string };
type Preview = { rows: PreviewRow[]; creates: number; skips: number; errors: number; review: string };
type Props = {
  send: <T>(path: string, method: string, body: unknown) => Promise<T>;
  refresh: () => Promise<void>;
};

const path = "/api/modules/finance/accounts/import/";

export function FinanceChartImport({ send, refresh }: Props) {
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
      setReviewed({ csv, preview: await send<Preview>(path + "preview", "POST", { csv }) });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The CSV could not be reviewed.");
    } finally { setBusy(false); }
  }

  async function importChart() {
    if (!reviewed || busy || !reviewed.preview.creates || reviewed.preview.errors) return;
    setError("");
    setBusy(true);
    try {
      const { imported, skipped } = await send<{ imported: number; skipped: number }>(path + "apply", "POST",
        { csv: reviewed.csv, review: reviewed.preview.review });
      setReviewed(null);
      setResult(`Imported ${imported}. Skipped ${skipped} existing accounts.`);
      await refresh();
    } catch (reason) {
      setReviewed(null);
      setError(reason instanceof Error ? reason.message : "The CSV could not be imported.");
    } finally { setBusy(false); }
  }

  return <details className="finance-section">
    <summary>Import chart of accounts</summary>
    <p>Use a CSV with Code, Name, Type, and Active columns. Use asset, liability, equity, income, or expense for Type, and true or false for Active. Existing account codes are skipped.</p>
    <div className="finance-action-row">
      <a download="finance-chart-template.csv"
        href="data:text/csv;charset=utf-8,Code%2CName%2CType%2CActive%0D%0A">Download empty template</a>
      <label>Chart of accounts CSV<input type="file" accept=".csv,text/csv" disabled={busy} onChange={event => {
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
      <p role="status">{reviewed.preview.creates} new · {reviewed.preview.skips} existing · {reviewed.preview.errors} invalid</p>
      <div className="finance-table-wrap">
        <table className="finance-table">
          <thead><tr><th>Row</th><th>Code</th><th>Name</th><th>Type</th><th>Active</th><th>Review result</th></tr></thead>
          <tbody>{reviewed.preview.rows.map(row => <tr key={row.rowNumber}>
            <td>{row.rowNumber}</td><td>{row.code}</td><td>{row.name}</td><td>{row.accountType}</td>
            <td>{row.active ? "Yes" : "No"}</td><td>{row.error ?? (row.status === "skip" ? "Existing account" : "Create")}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <button type="button" className="button button-primary"
        disabled={busy || reviewed.preview.errors > 0 || reviewed.preview.creates === 0}
        onClick={() => void importChart()}>Import new accounts</button>
    </>}
  </details>;
}
