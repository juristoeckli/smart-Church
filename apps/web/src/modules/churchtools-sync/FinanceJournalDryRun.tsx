import { useState } from "react";

type SourceLine = { accountId: string; debitMinor: string; creditMinor: string };
type TargetLine = SourceLine & { accountCode: string; costCenterId: string | null };
type PreviewRow = {
  sourceId: string; date: string; documentNumber: string | null; signedMinor: string | null;
  reasons: string[]; sourceLines: SourceLine[]; proposedTargetLines: TargetLine[]; matchedCostCenterCode: string | null;
};
type Review = { sourceCurrency: string; targetCurrency: string | null; targetYear: number | null; blockedBy: string[];
  scanned: number; candidates: number; candidateDebitMinor: string; candidateCreditMinor: string; rows: PreviewRow[] };
const pageSize = 20;

export function FinanceJournalDryRun({ departmentId, periodId, startDate, endDate, t }: {
  departmentId: string; periodId: string; startDate: string; endDate: string; t: (message: string) => string;
}) {
  const [currency, setCurrency] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reason = (code: string) => t(code.replaceAll("_", " "));

  async function run() {
    setBusy(true);
    setError("");
    setReview(null);
    setOffset(0);
    try {
      const query = new URLSearchParams({ periodId, startDate, endDate, sourceCurrency: currency });
      const response = await fetch(`/api/modules/sync/churchtools/finance/journal-dry-run?${query}`, { headers: { "x-department-id": departmentId } });
      const result = await response.json() as Review & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "The journal dry-run failed.");
      setReview(result);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The journal dry-run failed.");
    } finally { setBusy(false); }
  }

  function download() {
    if (!review) return;
    const file = URL.createObjectURL(new Blob([JSON.stringify(review, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = file;
    link.download = `churchtools-journal-dry-run-${periodId}-${startDate}-${endDate}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(file), 1000);
  }

  return <details>
    <summary><strong>{t("Journal import dry-run")}</strong></summary>
    <p className="sync-help">{t("Review balanced posting candidates for the selected dates. Confirm the currency from the ChurchTools books. The dry-run does not post or save entries.")}</p>
    <form className="sync-connection-form" onSubmit={(event) => { event.preventDefault(); void run(); }}>
      <label>{t("Confirmed source currency")}<input value={currency} onChange={(event) => { setCurrency(event.target.value.toUpperCase()); setReview(null); }} maxLength={3} pattern="[A-Z]{3}" placeholder="CHF" required disabled={busy} /></label>
      <button type="submit" className="button button-secondary" disabled={busy || !/^[A-Z]{3}$/.test(currency) || !startDate || !endDate || startDate > endDate}>{t("Run journal dry-run")}</button>
    </form>
    {busy && <p role="status">{t("Reviewing journal rows…")}</p>}
    {error && <p role="alert">{t(error)}</p>}
    {review && <section aria-live="polite">
      <p>{review.scanned} {t("rows reviewed")} · {review.candidates} {t("posting candidates")} · {review.sourceCurrency} / {review.targetCurrency ?? "—"}{review.targetYear ? ` · ${review.targetYear}` : ""}</p>
      {review.blockedBy.length > 0 && <p role="status">{review.blockedBy.map(reason).join(" · ")}</p>}
      <p>{t("Candidate debit and credit totals in minor units")} · {review.candidateDebitMinor} / {review.candidateCreditMinor}</p>
      <button type="button" className="button button-secondary" onClick={download}>{t("Download dry-run JSON")}</button>
      {review.rows.length > 0 && <div className="table-wrap"><table>
        <thead><tr><th scope="col">{t("Document")}</th><th scope="col">{t("Signed amount in minor units")}</th><th scope="col">{t("Source debit and credit")}</th><th scope="col">{t("Proposed target debit and credit")}</th><th scope="col">{t("Review needed")}</th></tr></thead>
        <tbody>{review.rows.slice(offset, offset + pageSize).map((row) => <tr key={row.sourceId}>
          <th scope="row">{row.documentNumber ?? `#${row.sourceId}`} <small>{row.date}</small></th>
          <td>{row.signedMinor ?? "—"}</td><td>{row.sourceLines.map((line) => `#${line.accountId}`).join(" / ") || "—"}</td>
          <td>{row.proposedTargetLines.map((line) => line.accountCode).join(" / ") || "—"}{row.matchedCostCenterCode && <small>{row.matchedCostCenterCode}</small>}</td>
          <td>{row.reasons.map(reason).join(" · ") || (review.blockedBy.length ? t("Blocked by period or currency") : "—")}</td>
        </tr>)}</tbody>
      </table></div>}
      {review.rows.length > pageSize && <div className="community-inline-actions">
        <button type="button" className="button button-secondary" disabled={!offset} onClick={() => setOffset(offset - pageSize)}>{t("Previous")}</button>
        <button type="button" className="button button-secondary" disabled={offset + pageSize >= review.rows.length} onClick={() => setOffset(offset + pageSize)}>{t("Next")}</button>
      </div>}
    </section>}
  </details>;
}
