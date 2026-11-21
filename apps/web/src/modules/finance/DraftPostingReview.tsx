import { useState } from "react";

type Review = {
  reviewHash: string; currency: string; bookingDate: string; accountingYear: number; receiptNumber: string; bookingText: string;
  source: { instanceUrl: string; periodId: string; sourceId: string };
  lines: Array<{ accountCode: string; accountName: string; accountType: string; debitMinor: string; creditMinor: string; text: string }>;
};

function minor(value: string, currency: string) {
  const digits = value.padStart(3, "0");
  return `${digits.slice(0, -2)}.${digits.slice(-2)} ${currency}`;
}

export function DraftPostingReview({ transactionId, departmentId, onPosted }: {
  transactionId: string; departmentId: string; onPosted: () => Promise<void>;
}) {
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const base = `/api/modules/finance/transactions/${transactionId}`;

  async function request<T>(path: string, body?: object) {
    const response = await fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: { "x-department-id": departmentId, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(result.error ?? "The draft review failed.");
    return result;
  }
  async function load() {
    setBusy(true);
    setError("");
    setReview(null);
    try { setReview(await request<Review>("/draft-review")); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Could not review the draft."); }
    finally { setBusy(false); }
  }
  async function post() {
    if (!review) return;
    setBusy(true);
    setError("");
    try {
      await request("/post-draft", { reviewHash: review.reviewHash });
      setReview(null);
      await onPosted();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not post the reviewed draft."); }
    finally { setBusy(false); }
  }

  return <section className="finance-section" aria-label="ChurchTools posting review">
    <button className="button button-secondary" type="button" disabled={busy} onClick={() => void load()}>{review ? "Refresh posting review" : "Review ChurchTools draft for posting"}</button>
    {busy && <p role="status">Working…</p>}
    {error && <p role="alert">{error}</p>}
    {review && <>
      <h3>{review.receiptNumber} · {review.bookingDate}</h3>
      <p>{review.bookingText}</p>
      <p>ChurchTools {review.source.instanceUrl} · period #{review.source.periodId} · journal #{review.source.sourceId}</p>
      <p>Accounting year {review.accountingYear}</p>
      <div className="finance-table-wrap"><table className="finance-table">
        <thead><tr><th scope="col">Account</th><th scope="col">Debit</th><th scope="col">Credit</th></tr></thead>
        <tbody>{review.lines.map((line) => <tr key={line.accountCode}><th scope="row">{line.accountCode} · {line.accountName}<small>{line.accountType}</small>{line.text && <small>{line.text}</small>}</th><td>{minor(line.debitMinor, review.currency)}</td><td>{minor(line.creditMinor, review.currency)}</td></tr>)}</tbody>
      </table></div>
      <p>Posting adds these lines to the ledger. Corrections require an audited reversal.</p>
      <button className="button button-primary" type="button" disabled={busy} onClick={() => void post()}>Post reviewed draft</button>
    </>}
  </section>;
}
