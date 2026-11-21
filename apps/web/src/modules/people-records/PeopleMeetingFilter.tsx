import { useEffect, useState } from "react";

type Meeting = { id: string; title: string; date: string; groupName: string };
const endpoint = "/api/people-records/directory-attendance-meetings";

export function PeopleMeetingFilter({ value, onChange, request }: {
  value: string;
  onChange: (value: string) => void;
  request: <T>(url: string, init?: RequestInit) => Promise<T>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<Meeting[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open && !value) return;
    const controller = new AbortController();
    setError("");
    setOptions(null);
    const params = new URLSearchParams({ q: query });
    if (value) params.set("id", value);
    const pending = window.setTimeout(() => {
      void request<{ available: boolean; meetings: Meeting[] }>(endpoint + "?" + params, { signal: controller.signal })
        .then(data => {
          if (controller.signal.aborted) return;
          setOptions(data.meetings);
          if (!data.available) setError("Group meeting attendance is unavailable in this location.");
        })
        .catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    }, query ? 180 : 0);
    return () => { window.clearTimeout(pending); controller.abort(); };
  }, [open, query, request, value]);

  return <details onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Group meeting attendance{value ? " · filter active" : ""}</summary>
    <label>Find a group meeting<input type="search" value={query} maxLength={100} onChange={event => setQuery(event.target.value)}/></label>
    <label>Attended group meeting<select value={value} onChange={event => onChange(event.target.value)}>
      <option value="">No attendance filter</option>
      {value && !options?.some(option => option.id === value) && <option value={value}>Selected meeting</option>}
      {options?.map(meeting => <option key={meeting.id} value={meeting.id}>
        {meeting.groupName} · {meeting.date}{meeting.title ? " · " + meeting.title : ""}
      </option>)}
    </select></label>
    {error && <p role="status">{error}</p>}
    {open && !options && !error && <p role="status">Loading meetings…</p>}
    {options?.length === 0 && !error && <p>No accessible meetings match.</p>}
  </details>;
}
