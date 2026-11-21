import { useState } from "react";
import { FinanceMappingReview } from "./FinanceMappingReview";
import { FinanceJournalDryRun } from "./FinanceJournalDryRun";

type Period = {
  periodId: string; clientId: string; clientName: string | null; startDate: string; endDate: string;
  closed: boolean; fullPeriodAccess: boolean;
};
type CodeMatch = { activeMatches: number; inactiveMatches: number; unmatched: number; ambiguous: number; unsupported: number };
type Preview = {
  period: Period; startDate: string; endDate: string;
  source: { accounts: number; costCenters: number };
  journal: { visible: number; splitChildren: number; splitParents: number; taxLinked: number; cancellationLinked: number; immutable: number;
    costCenterTransfers: number; waivers: number; unsupportedAmounts: number; unresolvedAccountRows: number; unresolvedCostCenterRows: number };
  target: { accounts: CodeMatch; costCenters: CodeMatch; periodMatch: string; matchingYear: number | null; matchingStatus: string | null } | null;
};
const endpoint = "/api/modules/sync/churchtools/finance";

export function FinancePreview({ departmentId, t }: { departmentId: string; t: (message: string) => string }) {
  const [periods, setPeriods] = useState<Period[] | null>(null);
  const [period, setPeriod] = useState<Period | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);

  function select(next: Period | null) {
    setPeriod(next);
    setStartDate(next?.startDate ?? "");
    setEndDate(next?.endDate ?? "");
    setPreview(null);
  }

  async function get<T>(path: string): Promise<T> {
    const response = await fetch(endpoint + path, { headers: { "x-department-id": departmentId } });
    const result = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(result.error ?? "Could not read ChurchTools finance data.");
    return result;
  }

  async function loadPeriods() {
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      const result = await get<{ periods: Period[] }>("/periods");
      setPeriods(result.periods);
      select(result.periods[0] ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load accounting periods.");
    } finally {
      setBusy(false);
    }
  }

  async function review() {
    if (!period) return;
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      const query = new URLSearchParams({ periodId: period.periodId, startDate, endDate });
      setPreview(await get<Preview>(`/preview?${query}`));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not preview ChurchTools finance data.");
    } finally {
      setBusy(false);
    }
  }

  async function downloadMapping() {
    if (!period) return;
    setBusy(true);
    setError("");
    try {
      const query = new URLSearchParams({ periodId: period.periodId });
      const response = await fetch(`${endpoint}/mapping?${query}`, { headers: { "x-department-id": departmentId } });
      if (!response.ok) {
        const result = await response.json() as { error?: string };
        throw new Error(result.error ?? "Could not download ChurchTools finance mapping.");
      }
      const file = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = file;
      link.download = `churchtools-finance-mapping-period-${period.periodId}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(file), 1000);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not download ChurchTools finance mapping.");
    } finally {
      setBusy(false);
    }
  }

  return <details className="directory-card sync-settings-card">
    <summary><strong>{t("ChurchTools finance migration preview")}</strong></summary>
    <p className="sync-help">{t("Review visible journal counts and how source account codes, cost centers, and accounting dates fit this location. The preview is read-only.")}</p>
    <button type="button" className="button button-secondary" disabled={busy} onClick={() => void loadPeriods()}>{t(periods ? "Refresh accounting periods" : "Load accounting periods")}</button>
    {periods?.length === 0 && <p>{t("The ChurchTools token cannot see any accounting periods.")}</p>}
    {periods && period && <form className="sync-connection-form" onSubmit={(event) => { event.preventDefault(); void review(); }}>
      <label>{t("ChurchTools accounting period")}
        <select value={period.periodId} disabled={busy} onChange={(event) => select(periods.find((item) => item.periodId === event.target.value) ?? null)}>
          {periods.map((item) => <option key={item.periodId} value={item.periodId}>{item.clientName ?? `${t("Client")} #${item.clientId}`} · {item.startDate} – {item.endDate} · {t(item.closed ? "Closed" : "Open")}</option>)}
        </select>
      </label>
      <div className="form-row">
        <label>{t("From")}<input type="date" required disabled={busy} min={period.startDate} max={endDate || period.endDate} value={startDate} onChange={(event) => { setStartDate(event.target.value); setPreview(null); }} /></label>
        <label>{t("Through")}<input type="date" required disabled={busy} min={startDate || period.startDate} max={period.endDate} value={endDate} onChange={(event) => { setEndDate(event.target.value); setPreview(null); }} /></label>
      </div>
      <div className="community-inline-actions">
        <button type="submit" className="button button-secondary" disabled={busy || !startDate || !endDate || startDate > endDate}>{t("Preview finance mapping")}</button>
        <button type="button" className="button button-secondary" disabled={busy} onClick={() => void downloadMapping()}>{t("Download account and cost-center mapping")}</button>
      </div>
    </form>}
    {period && <FinanceMappingReview key={period.periodId} departmentId={departmentId} periodId={period.periodId} t={t} />}
    {period && <FinanceJournalDryRun key={`${period.periodId}|${startDate}|${endDate}`} departmentId={departmentId} periodId={period.periodId} startDate={startDate} endDate={endDate} t={t} />}
    {busy && <p role="status">{t("Reading ChurchTools finance data…")}</p>}
    {error && <p role="alert">{t(error)}</p>}
    {preview && <section aria-live="polite">
      <h3>{t("Visible source data")}</h3>
      <p>{preview.startDate} – {preview.endDate} · {t(preview.period.fullPeriodAccess ? "The token has period-wide access." : "The token has restricted period access. The preview includes only records it can see.")}</p>
      <dl>
        <div><dt>{t("Accounts")}</dt><dd>{preview.source.accounts}</dd></div>
        <div><dt>{t("Cost centers")}</dt><dd>{preview.source.costCenters}</dd></div>
        <div><dt>{t("Journal rows")}</dt><dd>{preview.journal.visible}</dd></div>
        <div><dt>{t("Split children and referenced split parents")}</dt><dd>{preview.journal.splitChildren} / {preview.journal.splitParents}</dd></div>
        <div><dt>{t("Tax-linked rows")}</dt><dd>{preview.journal.taxLinked}</dd></div>
        <div><dt>{t("Cancellation-linked rows")}</dt><dd>{preview.journal.cancellationLinked}</dd></div>
        <div><dt>{t("Immutable rows")}</dt><dd>{preview.journal.immutable}</dd></div>
        <div><dt>{t("Cost center transfers")}</dt><dd>{preview.journal.costCenterTransfers}</dd></div>
        <div><dt>{t("Expense reimbursement waivers")}</dt><dd>{preview.journal.waivers}</dd></div>
        <div><dt>{t("Rows with unsupported amounts")}</dt><dd>{preview.journal.unsupportedAmounts}</dd></div>
        <div><dt>{t("Rows with unresolved source account or cost center references")}</dt><dd>{preview.journal.unresolvedAccountRows} / {preview.journal.unresolvedCostCenterRows}</dd></div>
      </dl>
      <p className="sync-help">{t("A journal row can be counted in more than one category.")}</p>
      <h3>{t("Smart-Church mapping")}</h3>
      {!preview.target && <p>{t("The local Finance tables are unavailable for comparison.")}</p>}
      {preview.target && <>
        <p>{preview.target.periodMatch === "exact"
          ? `${t("Matching local accounting period")} ${preview.target.matchingYear} · ${t(preview.target.matchingStatus === "closed" ? "Closed" : "Open")}`
          : t(preview.target.periodMatch === "overlap" ? "The source period overlaps at least one local period and needs date review." : "No local accounting period overlaps the source period.")}</p>
        <div className="table-wrap"><table>
          <thead><tr><th scope="col">{t("Codes")}</th><th scope="col">{t("Active matches")}</th><th scope="col">{t("Inactive matches")}</th><th scope="col">{t("Unmatched")}</th><th scope="col">{t("Ambiguous")}</th><th scope="col">{t("Unsupported")}</th></tr></thead>
          <tbody>{([["Accounts", preview.target.accounts], ["Cost centers", preview.target.costCenters]] as const).map(([label, numbers]) =>
            <tr key={label}><th scope="row">{t(label)}</th><td>{numbers.activeMatches}</td><td>{numbers.inactiveMatches}</td><td>{numbers.unmatched}</td><td>{numbers.ambiguous}</td><td>{numbers.unsupported}</td></tr>)}</tbody>
        </table></div>
      </>}
    </section>}
  </details>;
}
