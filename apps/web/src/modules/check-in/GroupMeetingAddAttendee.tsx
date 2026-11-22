import { useEffect, useState, type FormEvent } from "react";
import { UserPlus } from "lucide-react";
import { groupAttendanceUrl } from "../../group-attendance";

type Person = { id: string; firstName: string; lastName: string };
type SearchReply = { people?: Person[]; error?: string };

export function GroupMeetingAddAttendee({ meetingId, departmentId, csrfToken, disabled, onChanged }: {
  meetingId: string; departmentId: string; csrfToken: string; disabled: boolean; onChanged: (joinedGroup: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<Person[]>();
  const [selectedId, setSelectedId] = useState("");
  const [joinGroup, setJoinGroup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const term = query.trim();
  const path = groupAttendanceUrl(meetingId) + "/people";

  useEffect(() => {
    if (!open || term.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(path + "?" + new URLSearchParams({ search: term }), {
          headers: { "x-department-id": departmentId }, signal: controller.signal,
        });
        const data = await response.json() as SearchReply;
        if (!response.ok || !data.people) throw new Error(data.error ?? "Could not look up attendees.");
        if (!controller.signal.aborted) setPeople(data.people);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not look up attendees.");
      }
    }, 200);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [departmentId, open, path, term]);

  function close() {
    setOpen(false);
    setQuery("");
    setSelectedId("");
    setPeople(undefined);
    setJoinGroup(false);
    setError("");
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || busy || !people?.some((person) => person.id === selectedId)) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(path, {
        method: "POST", headers: { "content-type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken },
        body: JSON.stringify({ contactId: selectedId, joinGroup }),
      });
      const result = await response.json() as { added?: boolean; joinedGroup?: boolean; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not add this attendee.");
      if (!result.added) {
        setPeople((current) => current?.filter((person) => person.id !== selectedId));
        setSelectedId("");
        throw new Error("This person is already listed for the meeting. Reload attendance to check their status.");
      }
      close();
      onChanged(Boolean(result.joinedGroup));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add this attendee.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="checkin-toolbar">
    <button className="checkin-print" type="button" aria-expanded={open} disabled={disabled || busy} onClick={() => open ? close() : setOpen(true)}>
      <UserPlus size={15} /> Add existing attendee
    </button>
    {open && <form className="group-meeting-form" onSubmit={(event) => void add(event)}>
      <label>Search names<input type="search" minLength={2} maxLength={80} disabled={disabled || busy}
        value={query} onChange={(event) => {
          if (event.target.value.trim() !== term) {
            setPeople(undefined);
            setSelectedId("");
            setError("");
          }
          setQuery(event.target.value);
        }} /></label>
      {people?.length ? <label>Person<select required value={selectedId} disabled={disabled || busy}
        onChange={(event) => setSelectedId(event.target.value)}>
        <option value="">Choose a person…</option>
        {people.map((person) => <option key={person.id} value={person.id}>{person.firstName} {person.lastName}</option>)}
      </select></label> : null}
      {term.length >= 2 && !error && !people && <p role="status">Searching…</p>}
      {people?.length === 0 && !error && <p role="status">No eligible people match.</p>}
      <label><input type="checkbox" disabled={disabled || busy} checked={joinGroup}
        onChange={(event) => setJoinGroup(event.target.checked)} /> Also add to the group</label>
      <button type="submit" className="checkin-print" disabled={disabled || busy || !selectedId}>
        {busy ? "Adding…" : "Add and mark present"}
      </button>
      {error && <p role="alert" className="checkin-error">{error}</p>}
    </form>}
  </section>;
}
