import { useRef, useState, type FormEvent } from "react";

type Item = { id: string; code: string; name: string; active: boolean };
type Draft = { submissionId: string; bookingDate: string; receiptNumber: string; bookingText: string; accountId: string;
  fromCostCenterId: string; toCostCenterId: string; amountCents: number };

export function FinanceCostCenterTransfer({ accounts, centers, date, currency, cancel, post }: {
  accounts: Item[]; centers: Item[]; date: string; currency: string; cancel: () => void; post: (draft: Draft) => Promise<void>;
}) {
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const submissionId = useRef<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const values = new FormData(event.currentTarget);
    const text = (key: string) => String(values.get(key) ?? "").trim();
    const numeric = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(text("amount"));
    const cents = numeric ? BigInt(numeric[1])*100n + BigInt((numeric[2] ?? "").padEnd(2,"0")) : 0n;
    const fromCostCenterId = text("fromCostCenterId"),toCostCenterId = text("toCostCenterId");
    if (cents<=0n || cents>9000000000000000n || fromCostCenterId===toCostCenterId) {
      setError("Choose different cost centers and enter a positive amount with up to two decimal places.");
      return;
    }
    submissionId.current ??= crypto.randomUUID();
    setBusy(true);
    setError("");
    try { await post({
      submissionId:submissionId.current,bookingDate:text("bookingDate"),receiptNumber:text("receiptNumber"),
      bookingText:text("bookingText"),accountId:text("accountId"),fromCostCenterId,toCostCenterId,amountCents:Number(cents),
    }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not post the cost-center transfer."); }
    finally { setBusy(false); }
  }

  function centerOptions() {
    return centers.filter(center => center.active).map(center => <option key={center.id} value={center.id}>{center.code} · {center.name}</option>);
  }

  return <div className="finance-overlay" role="presentation" onMouseDown={event => { if (event.target===event.currentTarget && !busy) cancel(); }}>
    <section className="finance-dialog" role="dialog" aria-modal="true" aria-labelledby="cost-center-transfer-title">
      <header><h2 id="cost-center-transfer-title">Transfer budget between cost centers</h2>
        <button className="finance-close" type="button" disabled={busy} onClick={cancel} aria-label="Close">×</button></header>
      <p>The source center uses budget capacity and the destination gains it. Both lines use the clearing account.</p>
      <form onSubmit={event => void submit(event)}>
        <fieldset disabled={busy} className="finance-form-grid">
          <label>Source cost center<select name="fromCostCenterId" required defaultValue=""><option value="">Choose the source</option>{centerOptions()}</select></label>
          <label>Destination cost center<select name="toCostCenterId" required defaultValue=""><option value="">Choose the destination</option>{centerOptions()}</select></label>
          <label>Clearing account<select name="accountId" required defaultValue=""><option value="">Choose a clearing account</option>
            {accounts.map(account => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}
          </select></label>
          <label>Amount ({currency})<input name="amount" inputMode="decimal" maxLength={20} required /></label>
          <label>Booking date<input name="bookingDate" type="date" defaultValue={date} required /></label>
          <label>Receipt number<input name="receiptNumber" maxLength={80} required /></label>
          <label>Booking text<input name="bookingText" maxLength={500} required /></label>
        </fieldset>
        {error && <p role="alert">{error}</p>}
        <button className="button button-primary" type="submit" disabled={busy}>{busy ? "Posting…" : "Post budget transfer"}</button>
      </form>
    </section>
  </div>;
}
