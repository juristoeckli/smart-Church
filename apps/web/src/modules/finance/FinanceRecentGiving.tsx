import { useEffect, useState } from "react";
import { formatUserDate } from "../../date-format";
import { getActiveLanguage } from "../../i18n";
import { formatLedgerCents } from "./ledger-cents";

type Gift = {
  transactionId: string; donorId: string; donorName: string; date: string; receiptNumber: string;
  amountCents: string; isReversal: boolean; wasReversed: boolean;
};
type Giving = { from: string; through: string; currency: string; creditCents: string; reductionCents: string; netCents: string; recent: Gift[]; largest: Gift[] };

export function FinanceRecentGiving({ departmentId, openTransaction }: {
  departmentId: string;
  openTransaction: (transactionId: string) => void;
}) {
  const [open,setOpen] = useState(false);
  const [refresh,setRefresh] = useState(0);
  const [snapshot,setSnapshot] = useState<{ departmentId: string; report: Giving } | null>(null);
  const [error,setError] = useState("");
  const data = snapshot?.departmentId === departmentId ? snapshot.report : null;
  useEffect(() => {
    if (!open || !departmentId) return;
    const controller = new AbortController();
    setSnapshot(null);
    setError("");
    void fetch("/api/modules/finance/donors/recent-giving",{
      headers:{"x-department-id":departmentId},cache:"no-store",signal:controller.signal,
    }).then(async response => {
      if (!response.ok) throw new Error("Could not load recent giving.");
      const report = await response.json() as Giving;
      if (!controller.signal.aborted) setSnapshot({ departmentId,report });
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load recent giving.");
    });
    return () => controller.abort();
  },[departmentId,open,refresh]);

  const currency = data?.currency ?? "CHF";
  const money = new Intl.NumberFormat(getActiveLanguage(),{style:"currency",currency,minimumFractionDigits:2,maximumFractionDigits:2});
  const format = (amount: string) => formatLedgerCents(amount,money);
  function entries(title: string, gifts: Gift[]) {
    return <section>
      <h3>{title}</h3>
      {gifts.length === 0 ? <p>No giving entries in this period.</p> : <div className="finance-table-wrap"><table className="finance-table">
        <thead><tr><th scope="col">Booking date</th><th scope="col">Donor</th><th scope="col">Receipt number</th><th scope="col">Amount</th></tr></thead>
        <tbody>{gifts.map(gift => <tr key={gift.transactionId + ":" + gift.donorId}>
          <td><time dateTime={gift.date}>{formatUserDate(gift.date)}</time></td>
          <td>{gift.donorName}</td>
          <td><button className="button button-secondary" type="button" onClick={() => openTransaction(gift.transactionId)}>{gift.receiptNumber}</button>
            {gift.isReversal && <small> Reversal</small>}{gift.wasReversed && <small> Reversed</small>}</td>
          <td>{format(gift.amountCents)}</td>
        </tr>)}</tbody>
      </table></div>}
    </section>;
  }

  return <details className="finance-section" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Recent giving</summary>
    {open && <div>
      <button className="button button-secondary" type="button" onClick={() => setRefresh(current => current + 1)}>Refresh giving</button>
      {error && <p role="alert">{error}</p>}
      {!data && !error && <p role="status">Loading giving…</p>}
      {data && <>
        <p>{formatUserDate(data.from)} – {formatUserDate(data.through)}</p>
        <dl>
          <dt>Giving credits</dt><dd>{format(data.creditCents)}</dd>
          <dt>Giving reductions</dt><dd>{format(data.reductionCents)}</dd>
          <dt>Net giving</dt><dd>{format(data.netCents)}</dd>
        </dl>
        {entries("Recent posted giving",data.recent)}
        {entries("Largest unreversed gifts",data.largest)}
      </>}
    </div>}
  </details>;
}
