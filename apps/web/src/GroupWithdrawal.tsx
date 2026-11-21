import { useState, type FormEvent } from "react";
import { publicLanguage, publicText } from "./public-translations";

export const withdrawalReceiptPattern = /^[a-zA-Z0-9_-]{43}$/;

export function GroupWithdrawal({ receipt }: { receipt: string }) {
  const language = publicLanguage();
  const [confirmed, setConfirmed] = useState(false);
  const [sending, setSending] = useState(false);
  const [withdrawn, setWithdrawn] = useState(false);
  const [error, setError] = useState("");
  const valid = withdrawalReceiptPattern.test(receipt);

  async function withdraw(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid || !confirmed || sending || withdrawn) return;
    setSending(true);
    setError("");
    try {
      const response = await fetch("/api/public/group-signups/withdraw", {
        method: "POST", headers: { "content-type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ receiptToken: receipt }),
      });
      if (!response.ok) {
        setError(publicText(language, response.status === 409 ? "groupWithdrawalReviewed" : "groupWithdrawalFailed"));
        return;
      }
      const result = await response.json() as { status?: string };
      if (result.status !== "withdrawn") throw new Error("Unexpected withdrawal status.");
      setWithdrawn(true);
    } catch { setError(publicText(language, "groupWithdrawalFailed")); }
    finally { setSending(false); }
  }

  return <main className="public-registration-page"><section className="public-registration-card">
    <span className="eyebrow">{publicText(language, "groupEyebrow")}</span>
    <h1>{publicText(language, withdrawn ? "groupWithdrawalCompleted" : "groupWithdrawRequest")}</h1>
    {!valid && <p role="alert">{publicText(language, "groupWithdrawalFailed")}</p>}
    {!withdrawn && valid && <form className="public-registration-form" onSubmit={withdraw}>
      <label><input type="checkbox" checked={confirmed} disabled={sending} onChange={event => setConfirmed(event.target.checked)}/>{publicText(language, "groupWithdrawalConfirm")}</label>
      {error && <p className="public-registration-error" role="alert">{error}</p>}
      <button className="button button-primary" type="submit" disabled={!confirmed || sending}>
        {publicText(language, sending ? "sending" : "groupWithdrawRequest")}
      </button>
    </form>}
    <footer>{publicText(language, "smartChurch")}</footer>
  </section></main>;
}
