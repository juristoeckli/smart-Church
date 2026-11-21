import { useState } from "react";
import { FinanceSplitReview } from "./FinanceSplitReview";
import { FinanceSpecialJournalReview } from "./FinanceSpecialJournalReview";

type SourceLine = { accountId: string; debitMinor: string; creditMinor: string };
type TargetLine = SourceLine & { accountCode: string; costCenterId: string | null };
type PreviewRow = {
  sourceId: string; date: string; documentNumber: string | null; signedMinor: string | null;
  reasons: string[]; sourceLines: SourceLine[]; proposedTargetLines: TargetLine[]; matchedCostCenterCode: string | null;
};
type Review = { reviewHash: string; sourceCurrency: string; targetCurrency: string | null; targetYear: number | null; blockedBy: string[];
  scanned: number; candidates: number; candidateDebitMinor: string; candidateCreditMinor: string; rows: PreviewRow[] };
type DraftResult = { created: number; replayed: boolean };
const pageSize = 20;

export function FinanceJournalDryRun({ departmentId, periodId, startDate, endDate, t }: {
  departmentId: string; periodId: string; startDate: string; endDate: string; t: (message: string) => string;
}) {
  const [currency, setCurrency] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [saved, setSaved] = useState<DraftResult | null>(null);
  const reason = (code: string) => t(code.replaceAll("_", " "));

  async function run() {
    setBusy(true);
    setError("");
    setReview(null);
    setSelected([]);
    setSaved(null);
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

  async function createDrafts() {
    if (!review || !selected.length || review.blockedBy.length) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/modules/sync/churchtools/finance/journal-drafts", {
        method: "POST", headers: { "x-department-id": departmentId, "Content-Type": "application/json" },
        body: JSON.stringify({ periodId, startDate, endDate, sourceCurrency: review.sourceCurrency, reviewHash: review.reviewHash, sourceIds: selected }),
      });
      const result = await response.json() as DraftResult & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not create the reviewed journal drafts.");
      setSaved(result);
      setSelected([]);
      setReview(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not create the reviewed journal drafts.");
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
    <p className="sync-help">{t("Review balanced posting candidates for the selected dates. Confirm the currency from the ChurchTools books. You can save eligible rows as unposted drafts after review.")}</p>
    <form className="sync-connection-form" onSubmit={(event) => { event.preventDefault(); void run(); }}>
      <label>{t("Confirmed source currency")}<input value={currency} onChange={(event) => { setCurrency(event.target.value.toUpperCase()); setReview(null); setSaved(null); }} maxLength={3} pattern="[A-Z]{3}" placeholder="CHF" required disabled={busy} /></label>
      <button type="submit" className="button button-secondary" disabled={busy || !/^[A-Z]{3}$/.test(currency) || !startDate || !endDate || startDate > endDate}>{t("Run journal dry-run")}</button>
    </form>
    {busy && <p role="status">{t("Working…")}</p>}
    {error && <p role="alert">{t(error)}</p>}
    {saved && <p role="status">{saved.created} {t("unposted drafts in Finance")}{saved.replayed ? ` · ${t("Previously applied batch")}` : ""}</p>}
    {review && <section aria-live="polite">
      <p>{review.scanned} {t("rows reviewed")} · {review.candidates} {t("posting candidates")} · {review.sourceCurrency} / {review.targetCurrency ?? "—"}{review.targetYear ? ` · ${review.targetYear}` : ""}</p>
      {review.blockedBy.length > 0 && <p role="status">{review.blockedBy.map(reason).join(" · ")}</p>}
      <p>{t("Candidate debit and credit totals in minor units")} · {review.candidateDebitMinor} / {review.candidateCreditMinor}</p>
      <button type="button" className="button button-secondary" onClick={download}>{t("Download dry-run JSON")}</button>
      {review.rows.length > 0 && <div className="table-wrap"><table>
        <thead><tr><th scope="col">{t("Document")}</th><th scope="col">{t("Signed amount in minor units")}</th><th scope="col">{t("Source debit and credit")}</th><th scope="col">{t("Proposed target debit and credit")}</th><th scope="col">{t("Review needed")}</th>{review.candidates > 0 && <th scope="col">{t("Draft")}</th>}</tr></thead>
        <tbody>{review.rows.slice(offset, offset + pageSize).map((row) => <tr key={row.sourceId}>
          <th scope="row">{row.documentNumber ?? `#${row.sourceId}`} <small>{row.date}</small></th>
          <td>{row.signedMinor ?? "—"}</td><td>{row.sourceLines.map((line) => `#${line.accountId}`).join(" / ") || "—"}</td>
          <td>{row.proposedTargetLines.map((line) => line.accountCode).join(" / ") || "—"}{row.matchedCostCenterCode && <small>{row.matchedCostCenterCode}</small>}</td>
          <td>{row.reasons.map(reason).join(" · ") || (review.blockedBy.length ? t("Blocked by period or currency") : "—")}</td>
          {review.candidates > 0 && <td>{!row.reasons.length && row.proposedTargetLines.length === 2 && <input type="checkbox" checked={selected.includes(row.sourceId)}
            aria-label={`${t("Select for draft")} ${row.documentNumber ?? row.sourceId}`} disabled={busy || selected.length >= 50 && !selected.includes(row.sourceId)}
            onChange={(event) => { const checked = event.target.checked; setSelected((current) => checked ? [...current, row.sourceId] : current.filter((id) => id !== row.sourceId)); }} />}</td>}
        </tr>)}</tbody>
      </table></div>}
      {review.rows.length > pageSize && <div className="community-inline-actions">
        <button type="button" className="button button-secondary" disabled={!offset} onClick={() => setOffset(offset - pageSize)}>{t("Previous")}</button>
        <button type="button" className="button button-secondary" disabled={offset + pageSize >= review.rows.length} onClick={() => setOffset(offset + pageSize)}>{t("Next")}</button>
      </div>}
      {review.candidates > 0 && <button type="button" className="button button-primary" disabled={busy || !selected.length} onClick={() => void createDrafts()}>{t("Create selected unposted drafts")} ({selected.length})</button>}
    </section>}
    <FinanceSplitReview key={currency} departmentId={departmentId} periodId={periodId} startDate={startDate} endDate={endDate} currency={currency} t={t} />
    <FinanceSpecialJournalReview key={`special:${departmentId}:${periodId}:${startDate}:${endDate}:${currency}`}
      departmentId={departmentId} periodId={periodId} startDate={startDate} endDate={endDate} currency={currency} t={t} />
  </details>;
}
