import { useCallback, useEffect, useState, type FormEvent, type ChangeEvent } from "react";

const fieldTypes = { text: "Text", number: "Number", boolean: "Yes / no", date: "Date", select: "Single choice" } as const;
type FieldType = keyof typeof fieldTypes;
type Field = { id: string; label: string; type: FieldType; options: string[]; revision: number; archivedAt: string | null };
type Value = string | number | boolean;
type Answers = { values: Record<string, Value>; revision: number };

export function GroupMembershipFields({ groupId, contactId, departmentId, csrfToken }: {
  groupId: string; contactId?: string; departmentId: string; csrfToken: string;
}) {
  const base = "/api/modules/group-hierarchy/groups/" + groupId + "/member-fields";
  const [fields, setFields] = useState<Field[] | null>(null);
  const [answers, setAnswers] = useState<Answers | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [newLabel, setNewLabel] = useState("");
  const [newType, setNewType] = useState<FieldType>("text");
  const [options, setOptions] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const [rename, setRename] = useState<{ field: Field; label: string } | null>(null);
  const activeFields = fields?.filter(field => !field.archivedAt) ?? [];
  const archivedFields = fields?.filter(field => field.archivedAt) ?? [];
  const request = useCallback(async <T,>(url: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetch(url, {
      ...init, cache: "no-store",
      headers: {
        "x-department-id": departmentId,
        ...(init.body ? { "content-type": "application/json", "x-csrf-token": csrfToken } : {}),
      },
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Could not load membership fields.");
    return result as T;
  }, [departmentId, csrfToken]);

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    Promise.all([
      request<Field[]>(base, { signal: controller.signal }),
      contactId ? request<Answers>(base + "/" + contactId, { signal: controller.signal }) : Promise.resolve(null),
    ]).then(([definitions, currentAnswers]) => {
      if (controller.signal.aborted) return;
      setFields(definitions);
      setAnswers(currentAnswers);
      setDraft({});
      setRename(null);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [base, contactId, reload, request]);

  async function addField(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !newLabel.trim()) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const field = await request<Field>(base, { method: "POST", body: JSON.stringify({
        label: newLabel,
        type: newType,
        ...(newType === "select" ? { options: options.split(/\r?\n/).map(option => option.trim()).filter(Boolean) } : {}),
      }) });
      setFields(current => [...(current ?? []), field]);
      setNewLabel("");
      setOptions("");
      setMessage("Membership field added.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not add the membership field."); }
    finally { setSaving(false); }
  }

  async function changeField(field: Field, change: { label: string } | { archived: boolean }) {
    if (saving) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const updated = await request<Field>(base + "/definitions/" + field.id, {
        method: "PATCH", body: JSON.stringify({ ...change, revision: field.revision }),
      });
      setFields(current => current?.map(item => item.id === updated.id ? updated : item) ?? null);
      setRename(null);
      setMessage("label" in change ? "Membership field renamed." : change.archived ? "Membership field archived." : "Membership field restored.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update the membership field."); }
    finally { setSaving(false); }
  }

  async function saveAnswers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !answers || !fields) return;
    const values: Record<string, Value | null> = {};
    for (const field of activeFields) {
      const input = draft[field.id];
      if (input === undefined) continue;
      values[field.id] = input === "" ? null : field.type === "number" ? Number(input) : field.type === "boolean" ? input === "true" : input;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await request(base + "/" + contactId, { method: "PUT", body: JSON.stringify({ values, revision: answers.revision }) });
      setReload(current => current + 1);
      setMessage("Membership fields saved.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save membership fields."); }
    finally { setSaving(false); }
  }

  return <section aria-label={contactId ? "Member fields" : "Membership field settings"}>
    <h3>{contactId ? "Member fields" : "Membership field settings"}</h3>
    {error && <p role="alert">{error} <button type="button" onClick={() => setReload(current => current + 1)}>Reload fields</button></p>}
    {message && <p role="status">{message}</p>}
    {!fields && !error && <p>Loading membership fields…</p>}
    {fields && activeFields.length === 0 && <p>No active typed fields configured for this group.</p>}
    {fields && !contactId && <>
      {activeFields.length > 0 && <ul>{activeFields.map(field => <li key={field.id}>
        {rename?.field.id === field.id ? <form onSubmit={event => { event.preventDefault(); void changeField(rename.field, { label: rename.label }); }}>
          <label>Field label<input required maxLength={80} disabled={saving} value={rename.label} onChange={event => setRename({ field: rename.field, label: event.target.value })}/></label>
          <button disabled={saving || !rename.label.trim()}>Save field name</button>
          <button type="button" disabled={saving} onClick={() => setRename(null)}>Cancel</button>
        </form> : <>
          <span>{field.label} · {fieldTypes[field.type]}</span>
          <button type="button" disabled={saving} onClick={() => setRename({ field, label: field.label })}>Rename</button>
          <button type="button" disabled={saving} onClick={() => void changeField(field, { archived: true })}>Archive</button>
        </>}
      </li>)}</ul>}
      {archivedFields.length > 0 && <details>
        <summary>Archived fields ({archivedFields.length})</summary>
        <p>Archived fields keep saved values and are hidden from the member editor.</p>
        <ul>{archivedFields.map(field => <li key={field.id}>
          <span>{field.label} · {fieldTypes[field.type]}</span>
          <button type="button" disabled={saving} onClick={() => void changeField(field, { archived: false })}>Restore</button>
        </li>)}</ul>
      </details>}
      {fields.length < 40 && <form onSubmit={addField}>
        <label>Field label<input value={newLabel} required maxLength={80} onChange={event => setNewLabel(event.target.value)}/></label>
        <label>Field type<select value={newType} onChange={event => setNewType(event.target.value as FieldType)}>{Object.entries(fieldTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {newType === "select" && <label>Choices (one per line)<textarea value={options} required maxLength={2450} onChange={event => setOptions(event.target.value)}/></label>}
        <button disabled={saving || !newLabel.trim()}>Add member field</button>
      </form>}
    </>}
    {contactId && answers && activeFields.length > 0 && <form onSubmit={saveAnswers}>
      {activeFields.map(field => {
        const value = draft[field.id] ?? (answers.values[field.id] === undefined ? "" : String(answers.values[field.id]));
        const inputProps = { value, disabled: saving, onChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setDraft(current => ({ ...current, [field.id]: event.target.value })) };
        return <label key={field.id}>{field.label}
          {field.type === "boolean" || field.type === "select" ? <select {...inputProps}>
            <option value="">Not set</option>
            {field.type === "boolean" ? <><option value="true">Yes</option><option value="false">No</option></> : field.options.map(option => <option key={option}>{option}</option>)}
          </select> : <input type={field.type} {...inputProps} step={field.type === "number" ? "any" : undefined} maxLength={field.type === "text" ? 500 : undefined}/>}
        </label>;
      })}
      <button disabled={saving || !Object.keys(draft).length}>Save member fields</button>
    </form>}
  </section>;
}
