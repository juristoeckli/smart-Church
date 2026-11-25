import { useState, type FormEvent } from "react";
import type { GroupMeetingPlace } from "@smart-church/contracts";

const emptyPlace: GroupMeetingPlace = { name: "", street: "", postalCode: "", locality: "", country: "", visibility: "managers" };
const fields = [
  { key: "name", label: "Meeting place name", length: 160 },
  { key: "street", label: "Street address", length: 200 },
  { key: "postalCode", label: "Postal code", length: 24 },
  { key: "locality", label: "Town or city", length: 120 },
  { key: "country", label: "Country", length: 80 },
] as const;

export function GroupMeetingPlaceDetails({ place }: { place: GroupMeetingPlace }) {
  return <section aria-label="Meeting place">
    <h3>Meeting place</h3>
    <p>{[place.name, place.street, [place.postalCode, place.locality].filter(Boolean).join(" "), place.country].filter(Boolean)
      .map((line, index) => <span key={index}>{line}<br /></span>)}</p>
  </section>;
}

export function GroupMeetingPlaceEditor({ initial, groupId, departmentId, csrfToken, onSaved }: {
  initial?: GroupMeetingPlace; groupId: string; departmentId: string; csrfToken: string; onSaved: () => Promise<void>;
}) {
  const [place, setPlace] = useState(initial ?? emptyPlace);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function save(next: GroupMeetingPlace | null) {
    setBusy(true);
    setStatus("");
    setError("");
    try {
      const response = await fetch(`/api/groups/${groupId}/meeting-place`, {
        method: "PUT", headers: { "content-type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken },
        body: JSON.stringify({ place: next }),
      });
      const result = await response.json() as { error?: string; place?: GroupMeetingPlace | null };
      if (!response.ok) throw new Error(result.error ?? "Could not save the meeting place.");
      setPlace(result.place ?? emptyPlace);
      setStatus(next ? "Meeting place saved." : "Meeting place removed.");
      await onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the meeting place.");
    } finally { setBusy(false); }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!busy) void save(place);
  }

  return <details className="groups-map-editor">
    <summary>Meeting place details</summary>
    <p>Site group managers can see these details. You can also allow active members of this group.</p>
    <form className="community-inline-actions" onSubmit={submit}>
      {fields.map(({ key, label, length }) => <label key={key}>{label}
        <input value={place[key]} maxLength={length} disabled={busy} onChange={event => setPlace({ ...place, [key]: event.target.value })} />
      </label>)}
      <label>Who can see the meeting place?
        <select value={place.visibility} disabled={busy} onChange={event =>
          setPlace({ ...place, visibility: event.target.value === "members" ? "members" : "managers" })}>
          <option value="managers">Site group managers</option>
          <option value="members">Site group managers and active group members</option>
        </select>
      </label>
      <button type="submit" className="button button-primary" disabled={busy || !fields.some(({ key }) => place[key].trim())}>Save meeting place</button>
      {initial && <button type="button" className="button button-secondary" disabled={busy} onClick={() => void save(null)}>Remove meeting place</button>}
    </form>
    {status && <p role="status">{status}</p>}
    {error && <p role="alert">{error}</p>}
  </details>;
}
