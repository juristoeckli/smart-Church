import { useEffect, useRef, useState, type FormEvent } from "react";
import { postalAddressFields, type PostalAddress } from "./postal-address";

export type CreationField = { id: string; label: string; type: "text" | "date" | "boolean" | "select" | "number" | "multiline" | "datetime" | "multiselect"; required: boolean; options: string[]; textMaxLength?: number | null };
export type CreatePersonInput = {
  firstName: string; lastName: string; email?: string; phone?: string; status: "member" | "visitor";
  postalAddress: PostalAddress; fields: Record<string, string | boolean | number | string[]>;
};

export function PeopleCreateForm({ fields, timeZone, onCreate, onClose }: {
  fields: CreationField[];
  timeZone: string;
  onCreate: (person: CreatePersonInput, signal: AbortSignal) => Promise<void>;
  onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const data = new FormData(event.currentTarget);
    const string = (name: string) => String(data.get(name) ?? "");
    const values: Record<string, string | boolean | number | string[]> = {};
    for (const field of fields) {
      const name = "field:" + field.id;
      if (field.type === "multiselect") {
        const choices = data.getAll(name).map(String);
        if (choices.length) values[field.id] = choices;
        continue;
      }
      const raw = string(name);
      if (raw === "") continue;
      if (field.type === "number") values[field.id] = Number(raw);
      else values[field.id] = field.type === "boolean" ? raw === "true" : raw;
    }
    const postalAddress = Object.fromEntries(postalAddressFields.flatMap(({ key }) => {
      const value = string("address:" + key).trim();
      return value ? [[key, value]] : [];
    }));
    const controller = new AbortController();
    pending.current = controller;
    setError("");
    setSaving(true);
    try {
      await onCreate({
        firstName: string("firstName").trim(), lastName: string("lastName").trim(),
        email: string("email").trim() || undefined, phone: string("phone").trim() || undefined,
        status: string("status") === "visitor" ? "visitor" : "member", postalAddress, fields: values,
      }, controller.signal);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not create the person.");
    } finally {
      pending.current = null;
      if (!controller.signal.aborted) setSaving(false);
    }
  }

  return <section className="module-card" aria-label="Create person">
    <h2>Create person</h2>
    <form onSubmit={(event) => void submit(event)}>
      <fieldset disabled={saving}>
        <legend>Contact details</legend>
        <label>First name<input name="firstName" autoComplete="given-name" required maxLength={80} /></label>
        <label>Last name<input name="lastName" autoComplete="family-name" required maxLength={80} /></label>
        <label>Email<input name="email" type="email" autoComplete="email" maxLength={254} /></label>
        <label>Phone<input name="phone" type="tel" autoComplete="tel" maxLength={40} /></label>
        <label>Status<select name="status"><option value="member">Member</option><option value="visitor">Visitor</option></select></label>
        <details><summary>Postal address</summary>
          {postalAddressFields.map(({ key, label, limit, autoComplete }) => (
            <label key={key}>{label}<input name={"address:" + key} maxLength={limit} autoComplete={autoComplete} /></label>
          ))}
        </details>
      </fieldset>
      {fields.length > 0 && <fieldset disabled={saving}>
        <legend>Custom fields</legend>
        {fields.map((field) => <label key={field.id}>{field.label}{field.type === "datetime" && ` (${timeZone})`}
          {field.type === "multiselect" ?
            <select name={"field:" + field.id} multiple required={field.required} size={Math.max(2, Math.min(field.options.length, 6))}>
              {field.options.map((option) => <option key={option}>{option}</option>)}
            </select> : field.type === "select" || field.type === "boolean" ?
            <select name={"field:" + field.id} required={field.required}>
              <option value="">Choose a value</option>
              {field.type === "boolean" ? <><option value="true">Yes</option><option value="false">No</option></> :
                field.options.map((option, index) => <option key={index} value={option}>{option}</option>)}
            </select> : field.type === "multiline" ?
            <textarea name={"field:" + field.id} required={field.required} maxLength={field.textMaxLength ?? 2000} rows={4} /> :
            <input name={"field:" + field.id} type={field.type === "datetime" ? "datetime-local" : field.type} step={field.type === "datetime" ? 1 : field.type === "number" ? "any" : undefined} required={field.required}
              maxLength={field.type === "text" ? field.textMaxLength ?? 2000 : undefined} />}
        </label>)}
      </fieldset>}
      {error && <p role="alert">{error}</p>}
      <div className="module-toolbar">
        <button type="submit" disabled={saving}>{saving ? "Creating person…" : "Create person"}</button>
        <button type="button" disabled={saving} onClick={onClose}>Cancel</button>
      </div>
    </form>
  </section>;
}
