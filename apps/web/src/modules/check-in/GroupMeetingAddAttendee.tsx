import { useEffect, useState, type FormEvent } from "react";
import { UserPlus } from "lucide-react";
import { groupAttendanceUrl } from "../../group-attendance";

type Person = { id: string; firstName: string; lastName: string };
type SearchReply = { people?: Person[]; error?: string };

export function GroupMeetingAddAttendee({ meetingId, departmentId, csrfToken, canCreate, disabled, onChanged }: {
  meetingId: string; departmentId: string; csrfToken: string; canCreate: boolean; disabled: boolean; onChanged: (joinedGroup: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<Person[]>();
  const [selectedId, setSelectedId] = useState("");
  const [createMode, setCreateMode] = useState(false);
  const [visitor, setVisitor] = useState({ firstName: "", lastName: "", email: "" });
  const [joinGroup, setJoinGroup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const term = query.trim();
  const path = groupAttendanceUrl(meetingId) + "/people";

  useEffect(() => {
    if (!open || createMode || term.length < 2) return;
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
  }, [createMode, departmentId, open, path, term]);

  function close() {
    setOpen(false);
    setQuery("");
    setSelectedId("");
    setPeople(undefined);
    setCreateMode(false);
    setVisitor({ firstName: "", lastName: "", email: "" });
    setJoinGroup(false);
    setError("");
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const createVisitor = createMode && canCreate;
    const firstName = visitor.firstName.trim();
    const lastName = visitor.lastName.trim();
    if (disabled || busy || (createVisitor ? !firstName || !lastName : !people?.some((person) => person.id === selectedId))) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(path, {
        method: "POST", headers: { "content-type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken },
        body: JSON.stringify(createVisitor ? { joinGroup, newVisitor: {
          firstName, lastName, ...(visitor.email.trim() ? { email: visitor.email.trim() } : {}),
        } } : { contactId: selectedId, joinGroup }),
      });
      const result = await response.json() as SearchReply & { added?: boolean; joinedGroup?: boolean };
      if (!response.ok) {
        if (createVisitor && response.status === 409 && result.people) {
          setCreateMode(false);
          setQuery("");
          setSelectedId("");
          setPeople(result.people);
        }
        throw new Error(result.error ?? "Could not add this attendee.");
      }
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
      <UserPlus size={15} /> {canCreate ? "Add attendee" : "Add existing attendee"}
    </button>
    {open && <form className="group-meeting-form" onSubmit={(event) => void add(event)}>
      {canCreate && <button type="button" className="checkin-print" disabled={disabled || busy} onClick={() => {
        setCreateMode(!createMode);
        setSelectedId("");
        setPeople(undefined);
        setError("");
        setQuery(createMode ? [visitor.firstName.trim(), visitor.lastName.trim()].filter(Boolean).join(" ") : "");
      }}>{createMode ? "Search existing people" : "Create a visitor"}</button>}
      {createMode && canCreate ? <>
        <label>First name<input required maxLength={80} value={visitor.firstName} disabled={disabled || busy}
          onChange={(event) => setVisitor({ ...visitor, firstName: event.target.value })} /></label>
        <label>Last name<input required maxLength={80} value={visitor.lastName} disabled={disabled || busy}
          onChange={(event) => setVisitor({ ...visitor, lastName: event.target.value })} /></label>
        <label>Email (optional)<input type="email" maxLength={254} value={visitor.email} disabled={disabled || busy}
          onChange={(event) => setVisitor({ ...visitor, email: event.target.value })} /></label>
      </> : <>
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
      </>}
      <label><input type="checkbox" disabled={disabled || busy} checked={joinGroup}
        onChange={(event) => setJoinGroup(event.target.checked)} /> Also add to the group</label>
      <button type="submit" className="checkin-print" disabled={disabled || busy
        || (createMode && canCreate ? !visitor.firstName.trim() || !visitor.lastName.trim() : !selectedId)}>
        {busy ? "Adding…" : createMode && canCreate ? "Create visitor and mark present" : "Add and mark present"}
      </button>
      {error && <p role="alert" className="checkin-error">{error}</p>}
    </form>}
  </section>;
}
