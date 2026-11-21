import { useState } from "react";

type SplitGroup = {
  parentId: string; state: string; review: null | {
    date: string; documentNumber: string | null; parentSignedMinor: string; childSignedTotalMinor: string | null; sharedSide: string | null; reasons: string[];
    children: Array<{ sourceId: string; signedMinor: string | null; sourceDebitAccountId: string | null; sourceCreditAccountId: string | null;
      generatedTaxBaseId: string | null; debit: { code: string } | null; credit: { code: string } | null; warnings: string[] }>;
    proposedTargetLines: Array<{ accountId: string; accountCode: string; debitMinor: string; creditMinor: string }>;
  };
};
type Review = { reviewHash: string; sourceCurrency: string; targetCurrency: string | null; blockedBy: string[]; groups: SplitGroup[] };

export function FinanceSplitReview({ departmentId, periodId, startDate, endDate, currency, t }: {
  departmentId: string; periodId: string; startDate: string; endDate: string; currency: string; t: (message: string) => string;
}) {
  const [report, setReport] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [saved, setSaved] = useState<{ created: number; replayed: boolean } | null>(null);
  const reason = (code: string) => t(code.replaceAll("_", " "));
  async function load() {
    setReport(null);
    setError("");
    setBusy(true);
    setSelected([]);
    setSaved(null);
    try {
      const query = new URLSearchParams({ periodId, startDate, endDate, sourceCurrency: currency });
      const response = await fetch(`/api/modules/sync/churchtools/finance/split-review?${query}`, { headers: { "x-department-id": departmentId } });
      const data = await response.json() as Review & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not review ChurchTools split transactions.");
      setReport(data);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not review ChurchTools split transactions.");
    } finally { setBusy(false); }
  }
  async function saveDrafts() {
    if (!report || report.blockedBy.length || !selected.length) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/modules/sync/churchtools/finance/split-drafts", {
        method: "POST", headers: { "x-department-id": departmentId, "Content-Type": "application/json" },
        body: JSON.stringify({ periodId, startDate, endDate, sourceCurrency: report.sourceCurrency, reviewHash: report.reviewHash, parentIds: selected }),
      });
      const result = await response.json() as { created: number; replayed: boolean; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not create the reviewed split drafts.");
      setSaved(result);
      setSelected([]);
      setReport(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not create the reviewed split drafts.");
    } finally { setBusy(false); }
  }
  function download() {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `churchtools-split-review-${periodId}-${startDate}-${endDate}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section>
    <h3>{t("Split transaction review")}</h3>
    <button type="button" className="button button-secondary" disabled={busy || !/^[A-Z]{3}$/.test(currency) || !startDate || !endDate || startDate > endDate}
      onClick={() => void load()}>{t("Review split groups")}</button>
    {busy && <p role="status">{t("Reviewing split groups…")}</p>}
    {error && <p role="alert">{t(error)}</p>}
    {saved && <p role="status">{saved.created} {t("unposted split drafts in Finance")}{saved.replayed ? ` · ${t("Previously applied batch")}` : ""}</p>}
    {report && <>
      <p>{report.groups.length} {t("split groups")} · {report.sourceCurrency}</p>
      {report.blockedBy.length > 0 && <p>{report.blockedBy.map(reason).join(" · ")}</p>}
      <button type="button" className="button button-secondary" onClick={download}>{t("Download split review JSON")}</button>
      {report.groups.map(({ parentId, state, review }) => <details key={parentId}>
        <summary>{t("Split group")} #{parentId}{review?.documentNumber ? ` · ${review.documentNumber}` : ""} · {review ? `${review.children.length} ${t("children")}` : reason(state)}</summary>
        {review && <>
          <p>{review.date} · {t("Parent and child totals in minor units")} {review.parentSignedMinor} / {review.childSignedTotalMinor ?? "—"}</p>
          {review.reasons.length > 0 && <p>{review.reasons.map(reason).join(" · ")}</p>}
          <div className="table-wrap"><table>
            <thead><tr><th scope="col">{t("Source child")}</th><th scope="col">{t("Signed minor units")}</th><th scope="col">{t("Source debit and credit")}</th><th scope="col">{t("Linked debit and credit")}</th><th scope="col">{t("Review needed")}</th></tr></thead>
            <tbody>{review.children.map((child) => <tr key={child.sourceId}>
              <th scope="row">#{child.sourceId}{child.generatedTaxBaseId && <small>{t("Generated tax for")} #{child.generatedTaxBaseId}</small>}</th>
              <td>{child.signedMinor ?? "—"}</td><td>{child.sourceDebitAccountId ?? "—"} / {child.sourceCreditAccountId ?? "—"}</td>
              <td>{child.debit?.code ?? "—"} / {child.credit?.code ?? "—"}</td><td>{child.warnings.map(reason).join(" · ") || "—"}</td>
            </tr>)}</tbody>
          </table></div>
          {review.proposedTargetLines.length > 0 && <>
            <h4>{t("Proposed balanced local lines")}</h4>
            <ul>{review.proposedTargetLines.map((line) => <li key={line.accountId}>{line.accountCode} · {t("Debit")} {line.debitMinor} · {t("Credit")} {line.creditMinor}</li>)}</ul>
            {!report.blockedBy.length && !review.reasons.length && <label><input type="checkbox" checked={selected.includes(parentId)} disabled={busy}
              onChange={(event) => { const checked = event.target.checked; setSelected((current) => checked ? [...current, parentId] : current.filter((id) => id !== parentId)); }} /> {t("Select this group for an unposted draft")}</label>}
          </>}
        </>}
      </details>)}
      {!report.blockedBy.length && report.groups.some(({ review }) => Boolean(review?.proposedTargetLines.length)) && <>
        <p>{t("Split draft promotion requires a separate workflow.")}</p>
        <button type="button" className="button button-primary" disabled={busy || !selected.length} onClick={() => void saveDrafts()}>{t("Create selected unposted split drafts")} ({selected.length})</button>
      </>}
    </>}
  </section>;
}
