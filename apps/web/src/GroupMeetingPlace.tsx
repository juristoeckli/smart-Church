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

export function GroupMeetingPlaceDetails({ place, heading = "Meeting place" }: { place: Omit<GroupMeetingPlace, "visibility">; heading?: string }) {
  return <section aria-label={heading}>
    <h3>{heading}</h3>
    <p>{[place.name, place.street, [place.postalCode, place.locality].filter(Boolean).join(" "), place.country].filter(Boolean)
      .map((line, index) => <span key={index}>{line}<br /></span>)}</p>
  </section>;
}

export function GroupMeetingPlaceEditor({ initial, groupId, departmentId, csrfToken, onSaved, signupToken, isPublic }: {
  initial?: GroupMeetingPlace; groupId: string; departmentId: string; csrfToken: string; onSaved: () => Promise<void>; signupToken?: string; isPublic: boolean;
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
  async function changePublication(enabled: boolean) {
    if (busy || !initial || (enabled && !signupToken)) return;
    setBusy(true);
    setStatus("");
    setError("");
    try {
      const response = await fetch(`/api/groups/${groupId}/meeting-place/publication`, {
        method: "PUT", headers: { "content-type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken },
        body: JSON.stringify({ enabled, ...(enabled ? { expectedSignupToken: signupToken, expectedPlace: initial } : {}) }),
      });
      if (!response.ok) {
        const result = await response.json() as { error?: string };
        throw new Error(result.error ?? "Could not change meeting-place publication.");
      }
      setStatus(enabled ? "Meeting place published on the signup page." : "Meeting place hidden from the signup page.");
      await onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not change meeting-place publication.");
    } finally { setBusy(false); }
  }
  const hasUnsavedEdits = initial && (initial.visibility !== place.visibility || fields.some(({ key }) => initial[key] !== place[key]));

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
    {initial && signupToken && <section aria-label="Public signup page">
      <p>{isPublic ? "Anyone with the current signup link can see the saved meeting place."
        : "Publishing makes the saved venue and address visible to anyone with the current signup link."} Saving changes hides it until you publish again.</p>
      <button type="button" className={isPublic ? "button button-secondary" : "button button-primary"}
        disabled={busy || (!isPublic && Boolean(hasUnsavedEdits))} onClick={() => void changePublication(!isPublic)}>
        {isPublic ? "Hide meeting place from signup page" : "Publish meeting place on signup page"}
      </button>
    </section>}
    {status && <p role="status">{status}</p>}
    {error && <p role="alert">{error}</p>}
  </details>;
}
