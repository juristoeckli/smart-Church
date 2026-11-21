import { useEffect, useState } from "react";

const subscriptionPath = "/api/modules/resource-scheduler/my-bookings/subscription";

export function ResourceCalendarSubscription({ departmentId, csrfToken }: { departmentId: string; csrfToken: string }) {
  const [subscription, setSubscription] = useState<{ active: boolean; canSubscribe: boolean }>();
  const [issuedLink, setIssuedLink] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(subscriptionPath, { headers: { "x-department-id": departmentId }, cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const data = await response.json() as { active: boolean; canSubscribe: boolean };
        if (!controller.signal.aborted) setSubscription(data);
      })
      .catch(() => { if (!controller.signal.aborted) setError("Could not check your booking subscription."); });
    return () => controller.abort();
  }, [departmentId, reload]);

  async function changeSubscription(method: "POST" | "DELETE") {
    if (busy || !subscription) return;
    setBusy(true); setError(""); setIssuedLink(""); setNotice("");
    try {
      const response = await fetch(subscriptionPath, { method, headers: { "x-department-id": departmentId, "x-csrf-token": csrfToken }, cache: "no-store" });
      const result = await response.json() as { url?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not update your booking subscription.");
      if (method === "POST") {
        if (!result.url) throw new Error("The booking subscription link was unavailable.");
        setIssuedLink(new URL(result.url, window.location.origin).href);
        setNotice(subscription.active ? "Subscription link replaced." : "Subscription link created.");
      } else {
        setNotice("Subscription revoked.");
      }
      setSubscription({ ...subscription, active: method === "POST" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update your booking subscription.");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(issuedLink);
      setNotice("Link copied.");
      setError("");
    } catch {
      setError("Select the link and copy it manually.");
    }
  }

  return <details className="resource-calendar-subscription" onToggle={(event) => {
    if (!event.currentTarget.open) setIssuedLink("");
  }}>
    <summary>Calendar subscription</summary>
    <p>Sync your upcoming confirmed and pending bookings to another calendar app.</p>
    <div className="resource-booking-actions">
      {subscription?.canSubscribe && <button type="button" disabled={busy} onClick={() => void changeSubscription("POST")}>{subscription.active ? "Replace link" : "Create link"}</button>}
      {subscription?.active && <button type="button" disabled={busy} onClick={() => void changeSubscription("DELETE")}>Revoke link</button>}
      {!subscription && error && <button type="button" onClick={() => { setError(""); setReload((value) => value + 1); }}>Retry</button>}
    </div>
    {subscription && !subscription.canSubscribe && <p>This account or location cannot create a booking subscription.</p>}
    {issuedLink && <div>
      <label>Private calendar link<input value={issuedLink} readOnly onFocus={(event) => event.currentTarget.select()} /></label>
      <small>Anyone with this link can read its bookings while the subscription is active.</small>
      <div className="resource-booking-actions">
        <a href={issuedLink.replace(/^https?:/, "webcal:")} referrerPolicy="no-referrer">Subscribe in calendar app</a>
        <button type="button" onClick={() => void copyLink()}>Copy link</button>
      </div>
    </div>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
  </details>;
}
