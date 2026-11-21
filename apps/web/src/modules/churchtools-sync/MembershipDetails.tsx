import { useEffect, useState } from "react";

type Entry = {
  group: string;
  person: string;
  groupSourceId: string;
  details: {
    sourceId: string;
    roleId: string;
    role: string;
    roleKnown: boolean;
    sourceStatus: "active" | "requested" | "to_delete" | "waiting";
    joinedOn: string | null;
    plannedEndOn: string | null;
    comment: string | null;
    waitingListPosition: number | null;
    registeredBySourceId: string | null;
    roleChangedAt: string | null;
    statusChangedAt: string | null;
  };
};
type Page = { entries: Entry[]; nextOffset: number | null };
const statusLabels = { active: "Active", requested: "Awaiting confirmation", to_delete: "Pending removal", waiting: "Waiting list" };

export function MembershipDetails({ departmentId, revision, t }: { departmentId: string; revision: string; t: (message: string) => string }) {
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setPage(null);
    setError(false);
    const params = new URLSearchParams({ offset: String(offset), query });
    void (async () => {
      try {
        const response = await fetch(`/api/modules/sync/churchtools/membership-details?${params}`, {
          headers: { "x-department-id": departmentId }, signal: controller.signal,
        });
        if (!response.ok) throw new Error();
        setPage(await response.json() as Page);
      } catch {
        if (!controller.signal.aborted) setError(true);
      }
    })();
    return () => controller.abort();
  }, [departmentId, offset, query, revision]);

  return <section className="directory-card sync-settings-card">
    <div className="directory-heading"><div><h2>{t("ChurchTools membership details")}</h2><p>{t("Read-only source details for imported group memberships.")}</p></div></div>
    <form className="community-inline-actions" onSubmit={(event) => { event.preventDefault(); setOffset(0); setQuery(draft.trim()); }}>
      <label>{t("Group or person")}<input type="search" maxLength={120} value={draft} onChange={(event) => setDraft(event.target.value)} /></label>
      <button type="submit" className="button button-secondary">{t("Search")}</button>
    </form>
    {error && <p role="alert">{t("Could not load ChurchTools membership details.")}</p>}
    {!error && !page && <p role="status">{t("Loading membership details…")}</p>}
    {page?.entries.length === 0 && <p>{t("No matching membership details.")}</p>}
    {page?.entries.map(({ group, person, groupSourceId, details }) => <details className="sync-feedback" key={`${groupSourceId}|${details.sourceId}`}>
      <summary><strong>{person}</strong> · {group} · {t(statusLabels[details.sourceStatus])}</summary>
      <div>
        <p>{t("Role")} {details.roleKnown ? details.role : `#${details.roleId}`}</p>
        {details.joinedOn && <p>{t("Joined on")} {details.joinedOn}</p>}
        {details.plannedEndOn && <p>{t("Planned exit")} {details.plannedEndOn}</p>}
        {details.waitingListPosition !== null && <p>{t("Waiting list position")} {details.waitingListPosition}</p>}
        {details.roleChangedAt && <p>{t("Role changed")} {details.roleChangedAt}</p>}
        {details.statusChangedAt && <p>{t("Status changed")} {details.statusChangedAt}</p>}
        {details.registeredBySourceId && <p>{t("Registered by ChurchTools person")} #{details.registeredBySourceId}</p>}
        {details.comment && <p style={{ whiteSpace: "pre-wrap" }}>{details.comment}</p>}
      </div>
    </details>)}
    {page && (offset > 0 || page.nextOffset !== null) && <div className="community-inline-actions">
      <button type="button" className="button button-secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>{t("Previous")}</button>
      <button type="button" className="button button-secondary" disabled={page.nextOffset === null} onClick={() => setOffset(page.nextOffset ?? offset)}>{t("Next")}</button>
    </div>}
  </section>;
}
