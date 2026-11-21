import { useState } from "react";

type SourceEvidence = {
  sourceId: string; date: string; documentNumber: string | null; signedMinor: string | null;
  debitAccountId: string | null; creditAccountId: string | null; taxRateId: string | null;
};
type Pair = { baseId: string; relatedId: string | null; link: string; base: SourceEvidence | null; related: SourceEvidence | null };
type LocalReview = { nativeReversalDate: string | null; blockers: string[]; localOriginal: null | {
  id: string; date: string; year: number; receipt: string; status: string; existingReversalId: string | null; existingReversalDate: string | null;
} };
type Report = {
  period: { fullPeriodAccess: boolean };
  scope: { sourceCurrency: string };
  observedRows: number;
  taxGroups: Array<Pair & { grossSignedMinor: string | null }>;
  cancellations: Array<Pair & { comparison: string; localReview: LocalReview }>;
};

const readinessMessages: Record<string, string> = {
  source_pair_not_verified: "The source pair needs additional review.",
  restricted_source_period: "ChurchTools permissions restrict the source period.",
  local_site_read_only: "This Smart-Church location is read-only.",
  local_finance_unavailable: "Finance is unavailable at this location.",
  local_original_not_linked: "The original has no matching ChurchTools link in Finance.",
  local_original_differs_from_source: "The original’s local audit, receipt, date, or ledger lines differ from the source.",
  local_original_not_posted: "The local original must be posted.",
  local_original_is_a_reversal: "The local original is itself a reversal.",
  local_original_already_reversed: "The local original already has a reversal.",
  source_cancellation_already_linked: "The source cancellation already has a local link.",
  local_currency_differs_from_source: "The local Finance currency differs from the source currency.",
  no_open_local_period_for_today: "The native reversal needs an open accounting period covering today.",
  native_reversal_uses_today: "The native reversal would use a different date.",
  native_reversal_uses_generated_receipt: "The native reversal would generate a different receipt number.",
  native_reversal_receipt_in_use: "The native reversal receipt number is already in use.",
};

export function FinanceSpecialJournalReview({ departmentId, periodId, startDate, endDate, currency, t }: {
  departmentId: string; periodId: string; startDate: string; endDate: string; currency: string; t: (message: string) => string;
}) {
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reason = (code: string) => t(code.replaceAll("_", " "));
  async function load() {
    setReport(null);
    setError("");
    setBusy(true);
    try {
      const query = new URLSearchParams({ periodId, startDate, endDate, sourceCurrency: currency });
      const response = await fetch(`/api/modules/sync/churchtools/finance/special-journal-review?${query}`,
        { headers: { "x-department-id": departmentId } });
      const data = await response.json() as Report & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not reconcile ChurchTools tax and cancellation transactions.");
      setReport(data);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not reconcile ChurchTools tax and cancellation transactions.");
    } finally { setBusy(false); }
  }
  function download() {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `churchtools-tax-cancellation-review-${periodId}-${startDate}-${endDate}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function evidence(row: SourceEvidence | null, id: string | null) {
    if (!id) return "—";
    return row ? `#${id} · ${row.date} · ${row.documentNumber ?? "—"}` : `#${id}`;
  }
  function renderLocalReview({ localOriginal, nativeReversalDate, blockers }: LocalReview) {
    const financeQuery = localOriginal ? new URLSearchParams({ financeYear: String(localOriginal.year),
      financeQ: localOriginal.receipt, financeFrom: localOriginal.date, financeTo: localOriginal.date }) : null;
    return <>
      <h5>{t("Smart-Church reversal readiness")}</h5>
      {localOriginal && financeQuery && <p>
        <a href={`?${financeQuery}#module-finance`} target="_blank" rel="noopener">{t("Find linked original in Finance")}</a>
        {" · "}{localOriginal.receipt}{" · "}{localOriginal.date}{" · "}{t(localOriginal.status)}
        {localOriginal.existingReversalDate && <>{" · "}{t("Existing local reversal")} {localOriginal.existingReversalDate}</>}
      </p>}
      {localOriginal && nativeReversalDate && <p>{t("Native reversal date")} {nativeReversalDate}</p>}
      {blockers.length ? <ul>{blockers.map((code) => <li key={code}>{t(readinessMessages[code] ?? code)}</li>)}</ul>
        : <p>{t("The amount, date, and receipt match the native reversal checks. Finance records a native reversal as a local transaction.")}</p>}
    </>;
  }
  function renderPair(pair: Pair, comparison?: string, gross?: string | null, localReview?: LocalReview) {
    const { baseId, relatedId, link, base, related } = pair;
    return <details key={`${baseId}:${relatedId ?? ""}`}>
      <summary>{evidence(base, baseId)} / {evidence(related, relatedId)} · {reason(link)}</summary>
      {comparison && <p>{reason(comparison)}</p>}
      {gross != null && <p>{t("Gross signed minor units")} {gross}</p>}
      <div className="table-wrap"><table>
        <thead><tr><th scope="col">{t("Source row")}</th><th scope="col">{t("Signed minor units")}</th>
          <th scope="col">{t("Source debit and credit")}</th><th scope="col">{t("Source tax rate ID")}</th></tr></thead>
        <tbody>{[base, related].filter((row): row is SourceEvidence => row !== null).map((row, index) =>
          <tr key={index}><th scope="row">#{row.sourceId}</th><td>{row.signedMinor ?? "—"}</td>
            <td>{row.debitAccountId ?? "—"} / {row.creditAccountId ?? "—"}</td><td>{row.taxRateId ?? "—"}</td></tr>)}</tbody>
      </table></div>
      {localReview && renderLocalReview(localReview)}
    </details>;
  }
  return <section>
    <h3>{t("Tax and cancellation reconciliation")}</h3>
    <p>{t("Review source transactions visible within the selected dates. Amounts are in minor units.")}</p>
    <button type="button" className="button button-secondary" disabled={busy || !/^[A-Z]{3}$/.test(currency) || !startDate || !endDate || startDate > endDate}
      onClick={() => void load()}>{t("Reconcile source transactions")}</button>
    {busy && <p role="status">{t("Reviewing tax and cancellation transactions…")}</p>}
    {error && <p role="alert">{t(error)}</p>}
    {report && <>
      <p>{report.observedRows} {t("visible source rows")} · {report.scope.sourceCurrency}</p>
      {!report.period.fullPeriodAccess && <p>{t("Source permissions restrict the rows available for this period.")}</p>}
      <button type="button" className="button button-secondary" onClick={download}>{t("Download reconciliation JSON")}</button>
      <h4>{t("Generated tax groups")} ({report.taxGroups.length})</h4>
      {report.taxGroups.map((pair) => renderPair(pair, undefined, pair.grossSignedMinor))}
      <h4>{t("Cancellation groups")} ({report.cancellations.length})</h4>
      {report.cancellations.map((pair) => renderPair(pair, pair.comparison, undefined, pair.localReview))}
    </>}
  </section>;
}
