import { useEffect, useState } from "react";
import { formatUserDate } from "../../date-format";

const deliveryStatuses = [
  ["pending", "Queued"], ["sent", "Accepted by provider"], ["delayed", "Delayed"],
  ["delivered", "Delivered"], ["bounced", "Bounced"], ["complained", "Complaints"],
  ["suppressed", "Suppressed"], ["failed", "Failed"], ["skipped", "Skipped"],
] as const;

type Audience = "" | "location" | "groups" | "people";
type Batch = {
  id: string;
  sentAt: string;
  senderName: string;
  title: string;
  audience: Exclude<Audience, "">;
  groupNames: string[];
  recipientCount: number;
  emailQueuedCount: number;
  emailStatuses: Record<string, number>;
};
type HistoryPage = { page: number; hasNext: boolean; batches: Batch[] };

export function AnnouncementHistory({ departmentId, refresh }: { departmentId: string; refresh: number }) {
  const [audience, setAudience] = useState<Audience>("");
  const [mine, setMine] = useState(false);
  const [disposition, setDisposition] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<HistoryPage>();
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ page: String(page) });
    if (audience) query.set("audience", audience);
    if (mine) query.set("mine", "true");
    if (disposition) query.set("disposition", disposition);
    if (search) query.set("q", search);
    setResult(undefined);
    setError("");
    void fetch(`/api/modules/notifications/announcements/history?${query}`, {
      headers: { "x-department-id": departmentId }, signal: controller.signal,
    }).then(async (response) => {
      const data = await response.json() as HistoryPage | { error?: string };
      if (!response.ok || !("batches" in data)) {
        throw new Error("error" in data ? data.error ?? "Could not load announcement history." : "Could not load announcement history.");
      }
      if (!controller.signal.aborted) setResult(data);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load announcement history.");
    });
    return () => controller.abort();
  }, [departmentId, audience, disposition, mine, page, reload, refresh, search]);

  return <section className="directory-card notification-compose-card" aria-label="Announcement history">
    <div className="directory-heading"><div><h2>Announcement history</h2><p>Review announcements and email delivery counts at this location.</p></div></div>
    <div className="announcement-history">
      <form className="module-toolbar" onSubmit={(event) => {
        event.preventDefault(); setPage(1); setSearch(searchDraft.trim());
      }}>
        <label>Search subject or sender<input type="search" maxLength={120} value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} /></label>
        <button className="button button-secondary" type="submit">Search history</button>
        {search && <button className="button button-secondary" type="button" onClick={() => {
          setSearchDraft(""); setSearch(""); setPage(1);
        }}>Clear search</button>}
      </form>
      <div className="module-toolbar">
        <label>Sender<select value={mine ? "mine" : "all"} onChange={(event) => { setPage(1); setMine(event.target.value === "mine"); }}>
          <option value="all">All announcements</option><option value="mine">My announcements</option>
        </select></label>
        <label>Audience<select value={audience} onChange={(event) => { setPage(1); setAudience(event.target.value as Audience); }}>
          <option value="">All audiences</option><option value="location">Entire location</option><option value="groups">Selected groups</option><option value="people">Selected people · email</option>
        </select></label>
        <label>Email delivery<select value={disposition} onChange={(event) => { setPage(1); setDisposition(event.target.value); }}>
          <option value="">All delivery states</option>
          <option value="failed">Failed to send · includes bounces and complaints</option>
          {deliveryStatuses.filter(([value]) => value !== "failed" && value !== "bounced" && value !== "complained").map(([value, label]) =>
            <option key={value} value={value}>{label}</option>)}
        </select></label>
        <button className="button button-secondary" type="button" onClick={() => setReload((value) => value + 1)}>Refresh history</button>
      </div>
      {mine && <p>Older announcements without an attributed account remain in All announcements.</p>}
      {error && <p role="alert">{error}</p>}
      {!result && !error && <p role="status">Loading announcement history…</p>}
      {result?.batches.length === 0 && <p role="status">No recorded announcements match these filters.</p>}
      {result && result.batches.length > 0 && <ul className="announcement-history-items">
        {result.batches.map((batch) => {
          const untracked = Math.max(0, batch.emailQueuedCount - Object.values(batch.emailStatuses).reduce((sum, count) => sum + count, 0));
          return <li className="announcement-preview" key={batch.id}>
            <h3>{batch.title}</h3>
            <p>{formatUserDate(batch.sentAt, true)} · {batch.senderName}</p>
            <p>{batch.audience === "location" ? "Entire location" : batch.audience === "people" ? "Selected people · email" : batch.groupNames.join(", ") || "Selected groups"}</p>
            <dl>
              {batch.audience !== "people" && <div><dt>In-app recipients</dt><dd>{batch.recipientCount}</dd></div>}
              <div><dt>Emails originally queued</dt><dd>{batch.emailQueuedCount}</dd></div>
              {deliveryStatuses.map(([status, label]) => batch.emailStatuses[status] > 0
                ? <div key={status}><dt>{label}</dt><dd>{batch.emailStatuses[status]}</dd></div> : null)}
              {untracked > 0 && <div><dt>Delivery records unavailable</dt><dd>{untracked}</dd></div>}
            </dl>
          </li>;
        })}
      </ul>}
      {result && (result.hasNext || result.page > 1) && <nav className="module-toolbar" aria-label="Announcement history pages">
        <button className="button button-secondary" type="button" disabled={result.page === 1} onClick={() => setPage(result.page - 1)}>Previous page</button>
        <span>Page {result.page}</span>
        <button className="button button-secondary" type="button" disabled={!result.hasNext} onClick={() => setPage(result.page + 1)}>Next page</button>
      </nav>}
    </div>
  </section>;
}
