import { useEffect, useState } from "react";

export type BookingBeneficiary = { id: string; name: string };

export function ResourceBookingBeneficiary({ departmentId, selected, onChange }: {
  departmentId: string;
  selected: BookingBeneficiary | null;
  onChange: (person: BookingBeneficiary | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [choices, setChoices] = useState<BookingBeneficiary[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: text });
        const response = await fetch(`/api/modules/resource-scheduler/booking-beneficiaries?${params}`, {
          headers: { "x-department-id": departmentId }, signal: controller.signal,
        });
        if (!response.ok) throw new Error("Could not search People.");
        const people = await response.json() as BookingBeneficiary[];
        if (!controller.signal.aborted) setChoices(people);
      } catch {
        if (!controller.signal.aborted) setError("Could not search People.");
      }
    }, 180);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [departmentId, query]);

  const options = selected && !choices.some(({ id }) => id === selected.id) ? [selected, ...choices] : choices;
  return <fieldset>
    <legend>On behalf of</legend>
    <label>Search People<input type="search" maxLength={80} value={query} onChange={(event) => {
      setChoices([]); setError(""); setQuery(event.target.value);
    }} /></label>
    <label>Person<select value={selected?.id ?? ""} onChange={(event) => onChange(options.find(({ id }) => id === event.target.value) ?? null)}>
      <option value="">No person selected</option>
      {options.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
    </select></label>
    {error && <p role="alert">{error}</p>}
    <small>You remain responsible for this booking request.</small>
  </fieldset>;
}
