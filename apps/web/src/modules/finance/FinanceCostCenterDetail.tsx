import { useEffect, useState } from "react";
import { getActiveLanguage } from "../../i18n";
import { formatLedgerCents } from "./ledger-cents";
import { formatUserDate } from "../../date-format";

type Center = { id: string; code: string; name: string };
type Entry = {
  id: string; transactionId: string; date: string; receiptNumber: string; bookingText: string; lineText: string;
  accountCode: string; accountName: string; debitCents: string; creditCents: string;
};
type Budget = {
  id: string; accountCode: string | null; accountName: string | null; budgetCents: string; actualCents: string; remainingCents: string;
};
type Result = { from: string; through: string; fiscalStart: string; currency: string; entries: Entry[]; budgets: Budget[]; hasMore: boolean };
const path = "/api/modules/finance/reports/cost-center-detail";

export function FinanceCostCenterDetail({ departmentId, year, centers, canManage, exportFormat, onDownload, openTransaction }: {
  departmentId: string; year: string; centers: Center[]; canManage: boolean; exportFormat: string;
  onDownload: (path: string, filename: string) => Promise<void>; openTransaction: (id: string) => void;
}) {
  const [open,setOpen] = useState(false);
  const [center,setCenter] = useState("");
  const [from,setFrom] = useState("");
  const [to,setTo] = useState("");
  const [page,setPage] = useState(1);
  const [failure,setFailure] = useState("");
  const [snapshot,setSnapshot] = useState<{ key: string; result: Result } | null>(null);
  const valid = !from || !to || from <= to;
  const params = new URLSearchParams({ year, centerId:center, ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString();
  const key = JSON.stringify([departmentId,params,page]);
  const data = snapshot?.key === key ? snapshot.result : null;
  useEffect(() => {
    if (!open || !center || !valid) return;
    const controller = new AbortController();
    setFailure("");
    void fetch(`${path}?${params}&page=${page}`,{ headers:{"x-department-id":departmentId},cache:"no-store",signal:controller.signal })
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Could not load the cost-center statement.");
        if (!controller.signal.aborted) setSnapshot({ key,result });
      })
      .catch(reason => { if (!controller.signal.aborted) setFailure(reason instanceof Error ? reason.message : "Could not load the cost-center statement."); });
    return () => controller.abort();
  },[departmentId,open,center,valid,params,page,key]);

  const formatter = new Intl.NumberFormat(getActiveLanguage(),{style:"currency",currency:data?.currency ?? "CHF",minimumFractionDigits:2,maximumFractionDigits:2});
  const amount = (value: string) => formatLedgerCents(value,formatter);
  const exportPart = (part: "entries" | "budget") => void onDownload(
    `${path}/export.${exportFormat}?${params}&part=${part}`,`finance-cost-center-${part}-${year}.${exportFormat}`,
  );

  return <details className="finance-section" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Detailed cost-center statement</summary>
    {open && <>
      <div className="finance-filter-row">
        <label>Cost center<select value={center} onChange={event => { setCenter(event.target.value);setPage(1); }}>
          <option value="">Choose a cost center</option>
          {centers.map(option => <option value={option.id} key={option.id}>{option.code} · {option.name}</option>)}
        </select></label>
        <label>From<input type="date" value={from} max={to || undefined} onChange={event => { setFrom(event.target.value);setPage(1); }}/></label>
        <label>Through<input type="date" value={to} min={from || undefined} onChange={event => { setTo(event.target.value);setPage(1); }}/></label>
        {canManage && <>
          <button className="button button-secondary" type="button" disabled={!data?.entries.length} onClick={() => exportPart("entries")}>Export postings</button>
          <button className="button button-secondary" type="button" disabled={!data?.budgets.length} onClick={() => exportPart("budget")}>Export budget</button>
        </>}
      </div>
      {!valid && <p role="alert">The end date must be on or after the start date.</p>}
      {center && valid && failure && <p role="alert">{failure}</p>}
      {center && valid && !data && !failure && <p role="status">Loading statement…</p>}
      {data && <>
        <h3>Annual budget progress through {formatUserDate(data.through)}</h3>
        <p>Actuals include posted activity from {formatUserDate(data.fiscalStart)}. Whole-center and account budgets are independent scopes.</p>
        {data.budgets.length ? <div className="finance-table-wrap"><table className="finance-table">
          <thead><tr><th scope="col">Budget scope</th><th scope="col">Budget</th><th scope="col">Actual</th><th scope="col">Remaining</th></tr></thead>
          <tbody>{data.budgets.map(budget => <tr key={budget.id}>
            <td>{budget.accountCode ? `${budget.accountCode} · ${budget.accountName}` : "Whole cost center"}</td>
            <td>{amount(budget.budgetCents)}</td><td>{amount(budget.actualCents)}</td><td>{amount(budget.remainingCents)}</td>
          </tr>)}</tbody>
        </table></div> : <p>No budgets are configured for this cost center.</p>}
        <h3>Posted entries from {formatUserDate(data.from)} through {formatUserDate(data.through)}</h3>
        {data.entries.length ? <div className="finance-table-wrap"><table className="finance-table">
          <thead><tr><th scope="col">Booking date</th><th scope="col">Receipt</th><th scope="col">Account</th><th scope="col">Booking text</th><th scope="col">Line text</th><th scope="col">Debit</th><th scope="col">Credit</th></tr></thead>
          <tbody>{data.entries.map(entry => <tr key={entry.id}>
            <td><time dateTime={entry.date}>{formatUserDate(entry.date)}</time></td>
            <td><button type="button" className="button button-secondary" onClick={() => openTransaction(entry.transactionId)}>{entry.receiptNumber}</button></td>
            <td>{entry.accountCode} · {entry.accountName}</td><td>{entry.bookingText}</td><td>{entry.lineText}</td>
            <td>{amount(entry.debitCents)}</td><td>{amount(entry.creditCents)}</td>
          </tr>)}</tbody>
        </table></div> : <p>No posted entries in this range.</p>}
        {(page > 1 || data.hasMore) && <nav aria-label="Cost-center statement pages" className="finance-form-actions">
          <button type="button" disabled={page===1} onClick={() => setPage(page-1)}>Previous page</button>
          <span>Page {page}</span>
          <button type="button" disabled={!data.hasMore || page>=250} onClick={() => setPage(page+1)}>Next page</button>
        </nav>}
      </>}
    </>}
  </details>;
}
