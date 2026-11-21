import { useState } from "react";

type ReportAccount = { id: string; code: string; name: string };
const maximumHiddenAccounts = 100;

export function FinanceReportAccountFilter({ accounts, hiddenIds, onChange }: {
  accounts: ReportAccount[]; hiddenIds: string[]; onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const term = query.trim().toLocaleLowerCase();
  const matches = accounts.filter((account) => (account.code + " " + account.name).toLocaleLowerCase().includes(term));
  const hidden = new Set(hiddenIds);

  return <details className="finance-report-account-filter">
    <summary>Hide accounts{hidden.size > 0 ? " (" + hidden.size + ")" : ""}</summary>
    <div className="finance-filter-row">
      <label>Search accounts<input type="search" value={query} maxLength={100} onChange={(event) => setQuery(event.target.value)} /></label>
      {hidden.size > 0 && <button className="button button-secondary" type="button" onClick={() => onChange([])}>Show all accounts</button>}
    </div>
    <div className="finance-report-account-options">
      {matches.map((account) => <label key={account.id}>
        <input type="checkbox" checked={hidden.has(account.id)}
          disabled={!hidden.has(account.id) && hidden.size >= maximumHiddenAccounts}
          onChange={(event) => onChange(event.target.checked ? [...hidden, account.id] : hiddenIds.filter((id) => id !== account.id))} />
        {account.code} · {account.name}
      </label>)}
    </div>
    {!matches.length && <p>No accounts match your search.</p>}
    {hidden.size >= maximumHiddenAccounts && <p>The report can hide up to {maximumHiddenAccounts} accounts.</p>}
    {hidden.size > 0 && <p role="status">Showing {accounts.length - hidden.size} of {accounts.length} accounts. Exports use this selection.</p>}
  </details>;
}
