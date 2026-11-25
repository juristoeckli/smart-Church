import { useEffect, useState, type FormEvent } from "react";
import { formatUserDate } from "../../date-format";
import type { ModuleContext } from "../../module-registry";

const categoryLabels = {
  profile: "Profile and fields",
  privacy: "Privacy and consent",
  relationships: "Relationships",
  household: "Mailing household",
  attachments: "Attachments",
  lifecycle: "Archive, merge and import",
  membership: "Group memberships",
} as const;

const actionLabels: Record<string, string> = {
  profile_updated: "Profile updated", field_updated: "Custom field updated", date_updated: "Date updated",
  consent_recorded: "Consent recorded", relationship_added: "Relationship added", relationship_removed: "Relationship removed",
  household_linked: "Joined mailing household", household_unlinked: "Left mailing household", household_updated: "Mailing household updated",
  attachment_added: "Attachment uploaded", attachment_removed: "Attachment deleted",
  person_created: "Person created", person_archived: "Person archived", person_restored: "Person restored", person_merged: "People merged", csv_import_created: "Person imported",
  membership_created: "Group membership added", membership_updated: "Group membership updated", membership_deleted: "Group membership removed",
};

type HistoryCategory = keyof typeof categoryLabels;
type HistoryEvent = {
  id: string;
  action: string;
  category: HistoryCategory;
  subject: string;
  groupId: string | null;
  actorName: string | null;
  createdAt: string;
  beforeValue: unknown;
  afterValue: unknown;
};
type HistoryFilters = { category: HistoryCategory | ""; from: string; through: string };
type HistoryCursor = { beforeTime: string; beforeKey: string };
type HistoryPage = { events: HistoryEvent[]; membershipHistoryAvailable: boolean | null; nextCursor: HistoryCursor | null };
const emptyFilters: HistoryFilters = { category: "", from: "", through: "" };

function historyValue(value: unknown) {
  if (value == null) return "—";
  return typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
}

const valueStyle = { whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: 0 } as const;

export function PersonHistoryTimeline({ contactId, departmentId, onNavigateEntity }: {
  contactId: string;
  departmentId: string;
  onNavigateEntity?: ModuleContext["onNavigateEntity"];
}) {
  const [draft, setDraft] = useState(emptyFilters);
  const [query, setQuery] = useState<{ filters: HistoryFilters; cursor?: HistoryCursor }>({ filters: emptyFilters });
  const [result, setResult] = useState<HistoryPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    if (!query.cursor) setResult(null);
    const params = new URLSearchParams(Object.entries({ ...query.filters, ...query.cursor }).filter(([, value]) => value));
    void fetch(`/api/people-records/${contactId}/history/timeline?${params}`, { headers: { "x-department-id": departmentId }, signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(payload?.error ?? "Could not load profile history.");
        }
        const page = await response.json() as HistoryPage;
        if (!controller.signal.aborted) setResult((current) => query.cursor && current ? { ...page, events: [...current.events, ...page.events] } : page);
      })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load profile history."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [contactId, departmentId, query]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuery({ filters: draft });
  }

  return <section aria-label="Profile history">
    <h3>Profile history</h3>
    <form className="module-toolbar" onSubmit={applyFilters}>
      <label>Category<select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as HistoryFilters["category"] })}>
        <option value="">All categories</option>
        {Object.entries(categoryLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
      </select></label>
      <label>From<input type="date" value={draft.from} max={draft.through || undefined} onChange={(event) => setDraft({ ...draft, from: event.target.value })} /></label>
      <label>Through<input type="date" value={draft.through} min={draft.from || undefined} onChange={(event) => setDraft({ ...draft, through: event.target.value })} /></label>
      <button type="submit">Apply history filters</button>
    </form>
    <small>Dates use the location’s time zone.</small>
    {error && <p role="alert">{error}</p>}
    {result?.membershipHistoryAvailable === false && <p>Group membership history is unavailable at this location.</p>}
    {result?.events.map((event) => <article className="people-record-detail" key={`${event.category}:${event.id}`}>
      <strong>{actionLabels[event.action] ?? categoryLabels[event.category]}</strong>
      <span>{categoryLabels[event.category]} · <time dateTime={event.createdAt}>{formatUserDate(event.createdAt, true)}</time>{event.actorName && ` · ${event.actorName}`}</span>
      {event.groupId && onNavigateEntity ? <button type="button" onClick={() => onNavigateEntity("group", event.groupId!)}>{event.subject}</button> : <span>{event.subject}</span>}
      {(event.beforeValue != null || event.afterValue != null) && <details><summary>Show change</summary><dl>
        <dt>Before</dt><dd><pre style={valueStyle}>{historyValue(event.beforeValue)}</pre></dd>
        <dt>After</dt><dd><pre style={valueStyle}>{historyValue(event.afterValue)}</pre></dd>
      </dl></details>}
    </article>)}
    {loading && <p role="status">Loading profile history…</p>}
    {!loading && result?.events.length === 0 && <p>No history entries match these filters.</p>}
    {result?.nextCursor && <button type="button" disabled={loading} onClick={() => {
      const cursor = result.nextCursor;
      if (cursor) setQuery({ filters: query.filters, cursor });
    }}>Load older entries</button>}
  </section>;
}
