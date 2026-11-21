import { useState, type FormEvent } from "react";

type MembershipState = { roleId: string | null; status: string | null; startsOn: string | null; endsOn: string | null };
type Entry = { sourceId: string; personId: string; changedAt: string; previous: MembershipState; current: MembershipState };
type Page = { sourceInstance: string; sourceGroupId: string; entries: Entry[]; nextCursor: string | null };
const endpoint = "/api/modules/sync/churchtools/membership-history";

export function MembershipHistoryReview({ departmentId, csrfToken, t }: {
  departmentId: string; csrfToken: string; t: (message: string) => string;
}) {
  const [groupId, setGroupId] = useState("");
  const [loginToken, setLoginToken] = useState("");
  const [shown, setShown] = useState<Page | null>(null);
  const [shownCursor, setShownCursor] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");

  function reset() {
    setShown(null);
    setShownCursor(undefined);
    setFeedback("");
    setError("");
  }
  async function load(cursor?: string, download = false) {
    setBusy(true);
    setFeedback("");
    setError("");
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken },
        body: JSON.stringify({ groupId, loginToken: loginToken.trim(), ...(cursor ? { cursor } : {}) }),
      });
      const page = await response.json() as Page & { error?: string };
      if (!response.ok) throw new Error(page.error ?? "Could not review ChurchTools membership history.");
      setShown(page);
      setShownCursor(cursor);
      if (download) {
        if (!shown || page.sourceInstance !== shown.sourceInstance || page.sourceGroupId !== shown.sourceGroupId
          || JSON.stringify(page.entries) !== JSON.stringify(shown.entries)) {
          setFeedback("The visible history changed. Review this page before exporting it.");
          return;
        }
        const data = { formatVersion: 1, sourceInstance: page.sourceInstance, sourceGroupId: page.sourceGroupId, entries: page.entries };
        const objectUrl = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = `churchtools-membership-history-${page.sourceGroupId}-${page.entries[0]?.sourceId ?? "empty"}.json`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      }
    } catch (cause) {
      setShown(null);
      setShownCursor(undefined);
      setError(cause instanceof Error ? cause.message : "Could not review ChurchTools membership history.");
    } finally { setBusy(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load();
  }
  function memberState(state: MembershipState) {
    return <dl>
      <div><dt>{t("Role ID")}</dt><dd>{state.roleId ?? "—"}</dd></div>
      <div><dt>{t("Membership status")}</dt><dd>{state.status ? t(state.status) : "—"}</dd></div>
      <div><dt>{t("Start date")}</dt><dd>{state.startsOn ?? "—"}</dd></div>
      <div><dt>{t("End date")}</dt><dd>{state.endsOn ?? "—"}</dd></div>
    </dl>;
  }

  return <section className="directory-card sync-controls-card">
    <div><h2>{t("ChurchTools membership history")}</h2>
      <p>{t("Review and export visible changes to roles, statuses, and dates. Use the personal ChurchTools token for your own verified People record.")}</p></div>
    <form onSubmit={submit} autoComplete="off">
      <fieldset disabled={busy}>
        <div className="form-row">
          <label>{t("Source group ID")}<input value={groupId} required inputMode="numeric" pattern="[1-9][0-9]{0,15}"
            onChange={(event) => { setGroupId(event.target.value); reset(); }} /></label>
          <label>{t("Personal ChurchTools login token")}<input type="password" autoComplete="off" required minLength={8} maxLength={512}
            value={loginToken} onChange={(event) => { setLoginToken(event.target.value); reset(); }} /></label>
        </div>
        <button type="submit" className="button button-secondary">{t("Review latest changes")}</button>
      </fieldset>
    </form>
    {shown && <>
      {shown.entries.length ? <div className="table-wrap"><table>
        <thead><tr><th scope="col">{t("History entry")}</th><th scope="col">{t("Source person ID")}</th><th scope="col">{t("Changed at (UTC)")}</th>
          <th scope="col">{t("Previous membership")}</th><th scope="col">{t("Current membership")}</th></tr></thead>
        <tbody>{shown.entries.map((entry) => <tr key={entry.sourceId}><td>#{entry.sourceId}</td><td>#{entry.personId}</td>
          <td><time dateTime={entry.changedAt}>{entry.changedAt}</time></td><td>{memberState(entry.previous)}</td><td>{memberState(entry.current)}</td></tr>)}</tbody>
      </table></div> : <p>{t("No visible role, status, or date changes on this page.")}</p>}
      <div className="community-inline-actions">
        {!!shown.entries.length && <button type="button" className="button button-primary" disabled={busy}
          onClick={() => void load(shownCursor, true)}>{t("Verify and download this page")}</button>}
        {shown.nextCursor && <button type="button" className="button button-secondary" disabled={busy}
          onClick={() => void load(shown.nextCursor ?? undefined)}>{t("Review older changes")}</button>}
      </div>
    </>}
    {busy && <p role="status">{t("Checking current ChurchTools access…")}</p>}
    {feedback && <p role="status">{t(feedback)}</p>}
    {error && <p role="alert">{t(error)}</p>}
  </section>;
}
