import { TypedRosterColumns, type RosterMember } from "./TypedRosterColumns";
import { useCallback, useEffect, useState, type FormEvent, type ChangeEvent } from "react";

const fieldTypes = { text: "Text", number: "Number", boolean: "Yes / no", date: "Date", select: "Single choice" } as const;
type FieldType = keyof typeof fieldTypes;
type Field = { id: string; label: string; type: FieldType; options: string[]; revision: number; archivedAt: string | null; defaultValue: Value | null };
type Value = string | number | boolean;
type Answers = { values: Record<string, Value>; defaultedFieldIds: string[]; revision: number };

type FieldRequest = <T>(url: string, init?: RequestInit) => Promise<T>;
type BulkPreview = {
  fieldId: string; fieldRevision: number; value: Value | null;
  members: { contactId: string; revision: number }[]; changedCount: number;
};

function fieldValue(field: Field, input: string): Value {
  if (field.type === "number") return Number(input);
  if (field.type === "boolean") return input === "true";
  return input;
}

function valueLabel(value: Value) {
  return typeof value === "boolean" ? value ? "Yes" : "No" : String(value);
}

function MemberFieldInput({ field, label = field.label, value, disabled, onValue }: {
  field: Field; label?: string; value: string; disabled: boolean; onValue: (value: string) => void;
}) {
  const inputProps = { value, disabled, onChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onValue(event.target.value) };
  return <label>{label}
    {field.type === "boolean" || field.type === "select" ? <select {...inputProps}>
      <option value="">Not set</option>
      {field.type === "boolean" ? <><option value="true">Yes</option><option value="false">No</option></> : field.options.map(option => <option key={option}>{option}</option>)}
    </select> : <input type={field.type} {...inputProps} step={field.type === "number" ? "any" : undefined} maxLength={field.type === "text" ? 500 : undefined}/>}
  </label>;
}

function BulkMemberFieldChange({ base, fields, selectedContactIds, request, onValuesChange }: {
  base: string; fields: Field[]; selectedContactIds: string[]; request: FieldRequest; onValuesChange?: () => void;
}) {
  const [fieldId, setFieldId] = useState("");
  const [operation, setOperation] = useState<"set" | "clear">("set");
  const [input, setInput] = useState("");
  const [prepared, setPrepared] = useState<{ key: string; preview: BulkPreview } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const field = fields.find(item => item.id === fieldId);
  const contactIds = [...selectedContactIds].sort();
  const changeKey = JSON.stringify([field?.id, field?.revision, operation, input, contactIds]);
  const preview = prepared?.key === changeKey ? prepared.preview : null;

  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!field || busy || !contactIds.length || (operation === "set" && !input.trim())) return;
    setBusy(true);
    setError("");
    setMessage("");
    setPrepared(null);
    try {
      const value = operation === "clear" ? null : fieldValue(field, input);
      if (field.type === "number" && value !== null && !Number.isFinite(value)) throw new Error("Enter a finite number.");
      const result = await request<BulkPreview>(base + "/bulk-preview", {
        method: "POST", body: JSON.stringify({ fieldId: field.id, fieldRevision: field.revision, value, contactIds }),
      });
      setPrepared({ key: changeKey, preview: result });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not preview the field update."); }
    finally { setBusy(false); }
  }

  async function apply() {
    if (!preview || !preview.changedCount || busy) return;
    const { fieldId, fieldRevision, value, members } = preview;
    setBusy(true);
    setError("");
    try {
      const result = await request<{ updated: number }>(base + "/bulk-changes", {
        method: "PUT", body: JSON.stringify({ fieldId, fieldRevision, value, members }),
      });
      onValuesChange?.();
      setMessage(result.updated + (result.updated === 1 ? " membership updated." : " memberships updated."));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update the selected memberships."); }
    finally { setPrepared(null); setBusy(false); }
  }

  return <section aria-label="Bulk membership field editing">
    <h3>Bulk membership field editing</h3>
    <p>{contactIds.length} selected. Select members in the roster below.</p>
    <form onSubmit={prepare}>
      <label>Field<select value={fieldId} disabled={busy} onChange={event => { setFieldId(event.target.value); setInput(""); setPrepared(null); }}>
        <option value="">Choose a field</option>
        {fields.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select></label>
      <label>Action<select value={operation} disabled={busy} onChange={event => { setOperation(event.target.value === "clear" ? "clear" : "set"); setPrepared(null); }}>
        <option value="set">Set value</option><option value="clear">Clear stored value</option>
      </select></label>
      {field && operation === "set" && <MemberFieldInput field={field} value={input} disabled={busy} onValue={value => { setInput(value); setPrepared(null); }}/>}
      <button disabled={busy || !field || !contactIds.length || (operation === "set" && !input.trim())}>Preview field update</button>
    </form>
    {field?.defaultValue != null && operation === "clear" && <p>Members without a stored value will use the group default.</p>}
    {preview && <div>
      <p>{preview.changedCount} of {preview.members.length} selected memberships will change.</p>
      <button type="button" disabled={busy || preview.changedCount === 0} onClick={() => void apply()}>Apply field update</button>
    </div>}
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}

export function GroupMembershipFields({ groupId, contactId, departmentId, csrfToken, selectedContactIds, rosterMembers, rosterRevision, onValuesChange }: {
  groupId: string; contactId?: string; departmentId: string; csrfToken: string; selectedContactIds?: string[];
  rosterMembers?: RosterMember[]; rosterRevision?: number; onValuesChange?: () => void;
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
  const [exporting, setExporting] = useState(false);
  const [labelDraft, setLabelDraft] = useState<{ field: Field; label: string; mode: "rename" | "duplicate" } | null>(null);
  const [defaultDraft, setDefaultDraft] = useState<{ field: Field; input: string } | null>(null);
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
      setLabelDraft(null);
      setDefaultDraft(null);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [base, contactId, reload, request]);

  async function exportFields(fieldIds?: string[]) {
    if (exporting) return;
    setExporting(true);
    setError("");
    try {
      const params = new URLSearchParams();
      for (const id of fieldIds ?? []) params.append("fieldId", id);
      const response = await fetch(base + "/export.csv" + (fieldIds?.length ? "?" + params : ""), {
        headers: { "x-department-id": departmentId }, cache: "no-store",
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error ?? "Could not export membership fields.");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "group-membership-fields.csv";
      link.click();
      URL.revokeObjectURL(url);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not export membership fields."); }
    finally { setExporting(false); }
  }

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

  async function changeField(field: Field, change: { label: string } | { archived: boolean } | { defaultValue: Value | null } | { duplicateLabel: string }) {
    if (saving) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const path = base + "/definitions/" + field.id;
      const updated = "duplicateLabel" in change
        ? await request<Field>(path + "/duplicate", { method: "POST", body: JSON.stringify({ label: change.duplicateLabel, revision: field.revision }) })
        : await request<Field>(path, { method: "PATCH", body: JSON.stringify({ ...change, revision: field.revision }) });
      setFields(current => "duplicateLabel" in change
        ? [...(current ?? []), updated]
        : current?.map(item => item.id === updated.id ? updated : item) ?? null);
      setLabelDraft(null);
      setDefaultDraft(null);
      setMessage("duplicateLabel" in change ? "Membership field duplicated." : "label" in change ? "Membership field renamed." : "defaultValue" in change
        ? "Membership field default saved." : change.archived ? "Membership field archived." : "Membership field restored.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update the membership field."); }
    finally { setSaving(false); }
  }

  function saveDefault() {
    if (!defaultDraft) return;
    const { field, input } = defaultDraft;
    const defaultValue = input === "" ? null : fieldValue(field, input);
    if (field.type === "number" && defaultValue !== null && !Number.isFinite(defaultValue)) {
      setError("Enter a finite number."); return;
    }
    void changeField(field, { defaultValue });
  }

  async function saveAnswers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !answers || !fields) return;
    const values: Record<string, Value | null> = {};
    for (const field of activeFields) {
      const input = draft[field.id];
      if (input === undefined) continue;
      values[field.id] = input === "" ? null : fieldValue(field, input);
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await request(base + "/" + contactId, { method: "PUT", body: JSON.stringify({ values, revision: answers.revision }) });
      setReload(current => current + 1);
      onValuesChange?.();
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
      {activeFields.length > 0 && <button type="button" disabled={exporting} onClick={() => void exportFields()}>Export member fields (CSV)</button>}
      {activeFields.length > 0 && <ul>{activeFields.map(field => <li key={field.id}>
        {labelDraft?.field.id === field.id ? <form onSubmit={event => {
          event.preventDefault();
          void changeField(labelDraft.field, labelDraft.mode === "duplicate" ? { duplicateLabel: labelDraft.label } : { label: labelDraft.label });
        }}>
          <label>Field label<input required maxLength={80} disabled={saving} value={labelDraft.label} onChange={event => setLabelDraft({ ...labelDraft, label: event.target.value })}/></label>
          <button disabled={saving || !labelDraft.label.trim()}>{labelDraft.mode === "duplicate" ? "Create copy" : "Save field name"}</button>
          <button type="button" disabled={saving} onClick={() => setLabelDraft(null)}>Cancel</button>
        </form> : defaultDraft?.field.id === field.id ? <form onSubmit={event => { event.preventDefault(); saveDefault(); }}>
          <MemberFieldInput field={field} label="Default value" value={defaultDraft.input} disabled={saving}
            onValue={input => setDefaultDraft({ field: defaultDraft.field, input })}/>
          <button disabled={saving}>Save default</button>
          <button type="button" disabled={saving} onClick={() => setDefaultDraft(null)}>Cancel</button>
        </form> : <>
          <span>{field.label} · {fieldTypes[field.type]}{field.defaultValue !== null ? " · Default: " + valueLabel(field.defaultValue) : ""}</span>
          <button type="button" disabled={saving} onClick={() => { setDefaultDraft(null); setLabelDraft({ field, label: field.label, mode: "rename" }); }}>Rename</button>
          <button type="button" disabled={saving || fields.length >= 40} onClick={() => {
            setDefaultDraft(null);
            setLabelDraft({ field, label: Array.from(field.label).slice(0, 75).join("") + " copy", mode: "duplicate" });
          }}>Duplicate field</button>
          <button type="button" disabled={saving} onClick={() => {
            setLabelDraft(null);
            setDefaultDraft({ field, input: field.defaultValue === null ? "" : String(field.defaultValue) });
          }}>{field.defaultValue === null ? "Set default" : "Edit default"}</button>
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
    {!contactId && selectedContactIds && activeFields.length > 0 && <BulkMemberFieldChange base={base} fields={activeFields} selectedContactIds={selectedContactIds} request={request} onValuesChange={onValuesChange}/>}
    {!contactId && rosterMembers && activeFields.length > 0 && <TypedRosterColumns base={base} fields={activeFields} members={rosterMembers} revision={rosterRevision ?? 0} request={request} exporting={exporting} onExport={exportFields}/>}
    {contactId && answers && activeFields.length > 0 && <form onSubmit={saveAnswers}>
      {activeFields.map(field => {
        const value = draft[field.id] ?? (answers.values[field.id] === undefined ? "" : String(answers.values[field.id]));
        return <div key={field.id}>
          <MemberFieldInput field={field} value={value} disabled={saving}
            onValue={value => setDraft(current => ({ ...current, [field.id]: value }))}/>
          {draft[field.id] === undefined && answers.defaultedFieldIds.includes(field.id) && <small>Using group default</small>}
          {field.defaultValue !== null && (draft[field.id] !== undefined || !answers.defaultedFieldIds.includes(field.id))
            && <button type="button" disabled={saving} onClick={() => setDraft(current => ({ ...current, [field.id]: "" }))}>Use group default</button>}
        </div>;
      })}
      <button disabled={saving || !Object.keys(draft).length}>Save member fields</button>
    </form>}
  </section>;
}
