import { useEffect, useState } from "react";

export type AnnouncementPerson = { id: string; displayName: string };

export function AnnouncementPeoplePicker({ departmentId, selected, onToggle, disabled }: {
  departmentId: string;
  selected: AnnouncementPerson[];
  onToggle: (person: AnnouncementPerson) => void;
  disabled: boolean;
}) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<{ people: AnnouncementPerson[]; hasMore: boolean }>();
  const [error, setError] = useState("");
  const q = search.trim();

  useEffect(() => {
    setResults(undefined);
    setError("");
    if (q.length < 2) return;
    const abort = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch(`/api/modules/notifications/announcements/people?q=${encodeURIComponent(q)}`, {
        headers: { "x-department-id": departmentId }, signal: abort.signal,
      }).then(async (response) => {
        const data = await response.json();
        if (!response.ok || !Array.isArray(data.people)) throw new Error(data.error ?? "Could not search this location.");
        if (!abort.signal.aborted) setResults(data);
      }).catch((reason: unknown) => {
        if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not search this location.");
      });
    }, 250);
    return () => { window.clearTimeout(timer); abort.abort(); };
  }, [q, departmentId]);

  return <fieldset className="announcement-group-picker" disabled={disabled}>
    <legend>Select people</legend>
    <label>Search names<input type="search" value={search} maxLength={80} onChange={(event) => setSearch(event.target.value)} /></label>
    {selected.length > 0 && <ul className="announcement-selected-people" aria-label="Selected recipients">
      {selected.map((person) => <li key={person.id}>
        <button type="button" className="button button-secondary" aria-label={`Remove ${person.displayName}`} onClick={() => onToggle(person)}>{person.displayName} ×</button>
      </li>)}
    </ul>}
    {error && <p role="alert">{error}</p>}
    {q.length >= 2 && !results && !error && <p role="status">Searching people…</p>}
    {results?.people.length === 0 && <p role="status">No active people match that search.</p>}
    {results?.people.map((person) => {
      const checked = selected.some((item) => item.id === person.id);
      return <label key={person.id}><input type="checkbox" checked={checked} disabled={!checked && selected.length >= 100} onChange={() => onToggle(person)} />{person.displayName}</label>;
    })}
    {results?.hasMore && <p>Refine your search to see more matches.</p>}
  </fieldset>;
}
