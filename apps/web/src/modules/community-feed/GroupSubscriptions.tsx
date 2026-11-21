import { useState } from "react";

export type FeedGroup = { id: string; name: string; isSubscribed: boolean };

function searchableName(value: string, language: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase(language);
}

export function GroupSubscriptions({ groups, busy, language, t, onToggle }: {
  groups: FeedGroup[];
  busy: boolean;
  language: string;
  t: (phrase: string) => string;
  onToggle: (group: FeedGroup) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [followingOnly, setFollowingOnly] = useState(false);
  const term = searchableName(query.trim(), language);
  const matches = open ? groups.filter((group) => (!followingOnly || group.isSubscribed) &&
    searchableName(group.name, language).includes(term)) : [];

  return <details className="directory-card" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{t("Group subscriptions")}</summary>
    {open && <>
      <div className="community-feed-filters">
        <label>{t("Search subscriptions")}<input type="search" maxLength={150} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <label><input type="checkbox" checked={followingOnly} onChange={(event) => setFollowingOnly(event.target.checked)} />{t("Show only groups I follow")}</label>
      </div>
      {matches.length ? <ul className="community-upcoming-list community-subscription-list" aria-busy={busy}>
        {matches.map((group) => {
          const action = t(group.isSubscribed ? "Unfollow group" : "Follow group");
          return <li key={group.id} className="community-upcoming-item community-subscription-item">
            <div><strong>{group.name}</strong></div>
            <button className="button button-secondary" type="button" disabled={busy}
              aria-label={action + " · " + group.name} onClick={() => onToggle(group)}>{action}</button>
          </li>;
        })}
      </ul> : <p className="community-feed-empty" role="status">{t("No groups match this subscription search.")}</p>}
    </>}
  </details>;
}
