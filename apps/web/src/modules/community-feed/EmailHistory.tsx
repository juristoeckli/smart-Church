import { useEffect, useState } from "react";
import { formatUserDate } from "../../date-format";

const statusLabels = {
  pending: "Queued",
  sent: "Accepted by provider",
  delayed: "Delayed",
  delivered: "Delivered",
  bounced: "Bounced",
  complained: "Complaint recorded",
  suppressed: "Suppressed",
  failed: "Failed",
  skipped: "Skipped",
} as const;

type EmailHistoryEntry = {
  id: string;
  kind: "digest" | "alert";
  status: keyof typeof statusLabels;
  queuedAt: string;
  updatedAt: string;
};

export function EmailHistory({ departmentId, t }: { departmentId: string; t: (message: string) => string }) {
  const [open, setOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [history, setHistory] = useState<EmailHistoryEntry[] | "loading" | "failed">("loading");

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setHistory("loading");
    void fetch("/api/modules/community-feed/email-history", { headers: { "x-department-id": departmentId }, signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load email history.");
        const result = await response.json() as EmailHistoryEntry[];
        if (!controller.signal.aborted) setHistory(result);
      })
      .catch(() => { if (!controller.signal.aborted) setHistory("failed"); });
    return () => controller.abort();
  }, [departmentId, open, revision]);

  return <details className="community-notification-preferences" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{t("Email delivery history")}</summary>
    {open && <div className="community-notification-preference-group">
      <button type="button" className="community-post-details" disabled={history === "loading"} onClick={() => setRevision((current) => current + 1)}>{t("Refresh email history")}</button>
      {history === "loading" ? <p role="status">{t("Loading email history…")}</p> : history === "failed" ? <p role="alert">{t("Could not load email history.")}</p> : history.length ? (
        <div className="community-post-table"><table>
          <caption className="sr-only">{t("Latest Community Feed email deliveries")}</caption>
          <thead><tr><th scope="col">{t("Email")}</th><th scope="col">{t("Status")}</th><th scope="col">{t("Queued at")}</th><th scope="col">{t("Last updated")}</th></tr></thead>
          <tbody>{history.map((entry) => <tr key={entry.id}>
            <td>{t(entry.kind === "digest" ? "Weekly post digest" : "Community Feed alert")}</td>
            <td>{t(statusLabels[entry.status])}</td>
            <td><time dateTime={entry.queuedAt}>{formatUserDate(entry.queuedAt, true)}</time></td>
            <td><time dateTime={entry.updatedAt}>{formatUserDate(entry.updatedAt, true)}</time></td>
          </tr>)}</tbody>
        </table></div>
      ) : <p>{t("There are no Community Feed email deliveries for you at this location.")}</p>}
    </div>}
  </details>;
}
