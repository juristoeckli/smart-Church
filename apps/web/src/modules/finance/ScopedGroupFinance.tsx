import { useCallback, useEffect, useState } from "react";

type Center = { id: string; code: string; name: string; canViewJournal: boolean };
type Period = { year: number; label: string };
type Budget = { id: string; accountCode: string | null; accountName: string | null; budgetCents: string; actualCents: string; remainingCents: string };
type Entry = {
  date: string; lineText: string; bookingText: string | null; receiptNumber: string | null; accountCode: string;
  accountName: string; debitCents: string; creditCents: string; isCostCenterTransfer: boolean;
};
type Report = {
  center: Center; period: { currency: string }; budgets: Budget[]; hasMoreBudgets: boolean;
  journal?: { page: number; entries: Entry[]; hasMore: boolean };
};

const path = "/api/modules/finance/group-finance";
function money(cents: string, currency: string) {
  const value = BigInt(cents);
  const magnitude = value < 0n ? -value : value;
  return `${currency} ${value < 0n ? "-" : ""}${(magnitude / 100n).toLocaleString()}.${String(magnitude % 100n).padStart(2, "0")}`;
}

export function ScopedGroupFinance({ departmentId }: { departmentId: string }) {
  const [catalog, setCatalog] = useState<{ centers: Center[]; periods: Period[] }>();
  const [report, setReport] = useState<Report>();
  const [centerId, setCenterId] = useState("");
  const [year, setYear] = useState("");
  const [page, setPage] = useState(1);
  const [transfers, setTransfers] = useState(false);
  const [error, setError] = useState("");
  const center = catalog?.centers.find(item => item.id === centerId);

  const get = useCallback(async <T,>(relative = "") => {
    const response = await fetch(path + relative, { headers: { "x-department-id": departmentId } });
    const data = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "Could not load group finance.");
    return data;
  }, [departmentId]);

  useEffect(() => {
    let current = true;
    void get<{ centers: Center[]; periods: Period[] }>().then(data => {
      if (!current) return;
      setCatalog(data);
      setCenterId(data.centers[0]?.id ?? "");
      setYear(String(data.periods[0]?.year ?? ""));
    }).catch(reason => { if (current) setError(reason instanceof Error ? reason.message : "Could not load group finance."); });
    return () => { current = false; };
  }, [get]);

  useEffect(() => {
    setReport(undefined);
    if (!centerId || !year) return;
    const params = new URLSearchParams({ year, page: String(page), includeTransfers: String(transfers) });
    let current = true;
    setError("");
    void get<Report>(`/centers/${centerId}?${params}`).then(data => { if (current) setReport(data); })
      .catch(reason => { if (current) setError(reason instanceof Error ? reason.message : "Could not load cost-center finance."); });
    return () => { current = false; };
  }, [get, centerId, year, page, transfers]);

  const currency = report?.period.currency ?? "CHF";
  return <main className="finance-page">
    <section className="finance-section">
      <h2>Group finance</h2>
      {error && <p role="alert">{error}</p>}
      {catalog && (!catalog.centers.length ? <p>No cost centers are available for your group roles.</p> :
        <div className="finance-form-grid">
          <label>Cost center<select value={centerId} onChange={event => { setCenterId(event.target.value); setPage(1); setTransfers(false); }}>
            {catalog.centers.map(item => <option value={item.id} key={item.id}>{item.code} · {item.name}</option>)}
          </select></label>
          <label>Accounting year<select value={year} onChange={event => { setYear(event.target.value); setPage(1); }}>
            {catalog.periods.map(item => <option key={item.year} value={item.year}>{item.label}</option>)}
          </select></label>
          {center?.canViewJournal && <label><span><input type="checkbox" checked={transfers} onChange={event => { setTransfers(event.target.checked); setPage(1); }} /> Include cost-center transfers</span></label>}
        </div>)}
      {catalog?.centers.length && !catalog.periods.length ? <p>No accounting years are configured.</p> : null}
      {report && <>
        <h3>Budgets</h3>
        {report.budgets.length ? <div className="finance-table-wrap"><table className="finance-table">
          <thead><tr><th>Account</th><th>Budget</th><th>Actual</th><th>Remaining</th></tr></thead>
          <tbody>{report.budgets.map(item => <tr key={item.id}>
            <td>{item.accountCode ? `${item.accountCode} · ${item.accountName ?? ""}` : "All accounts"}</td>
            <td>{money(item.budgetCents,currency)}</td><td>{money(item.actualCents,currency)}</td><td>{money(item.remainingCents,currency)}</td>
          </tr>)}</tbody>
        </table></div> : <p>No budgets are configured for this cost center and year.</p>}
        {report.hasMoreBudgets && <p>Showing the first 1,000 budgets.</p>}
        {report.journal && <>
          <h3>Journal entries</h3>
          {report.journal.entries.length ? <div className="finance-table-wrap"><table className="finance-table">
            <thead><tr><th>Date</th><th>Receipt</th><th>Booking text</th><th>Account</th><th>Debit</th><th>Credit</th></tr></thead>
            <tbody>{report.journal.entries.map((entry,index) => <tr key={index}>
              <td>{entry.date}</td><td>{entry.receiptNumber ?? "—"}</td><td>{entry.lineText || entry.bookingText || (entry.isCostCenterTransfer ? "Cost-center transfer" : "Shared posting")}</td>
              <td>{entry.accountCode} · {entry.accountName}</td><td>{money(entry.debitCents,currency)}</td><td>{money(entry.creditCents,currency)}</td>
            </tr>)}</tbody>
          </table></div> : <p>No posted journal entries for this cost center and year.</p>}
          {(page > 1 || report.journal.hasMore) && <div className="finance-form-actions">
            <button type="button" className="button button-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
            <span>Page {page}</span>
            <button type="button" className="button button-secondary" disabled={!report.journal.hasMore} onClick={() => setPage(page + 1)}>Next</button>
          </div>}
        </>}
      </>}
    </section>
  </main>;
}
