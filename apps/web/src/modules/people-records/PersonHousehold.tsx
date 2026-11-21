import { useEffect, useState, type FormEvent } from "react";
import type { ModuleContext } from "../../module-registry";
import { postalAddressFields, type PostalAddress } from "./postal-address";

type PersonRequest = <T>(url: string, init?: RequestInit) => Promise<T>;
type HouseholdMember = { id: string; name: string; archived: boolean };
type HouseholdInput = { label: string; salutation: string; postalAddress: PostalAddress };
type Household = HouseholdInput & { id: string; members: HouseholdMember[] };
type HouseholdChoice = { id: string; label: string };

function HouseholdDetailsForm({ initial, submitLabel, disabled, onSave }: {
  initial: HouseholdInput; submitLabel: string; disabled: boolean; onSave: (input: HouseholdInput) => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const postalAddress = Object.fromEntries(postalAddressFields.map(({ key }) => [key, String(data.get(key) ?? "").trim()]));
    onSave({ label: String(data.get("label") ?? "").trim(), salutation: String(data.get("salutation") ?? "").trim(), postalAddress });
  }

  return <form onSubmit={submit}>
    <label>Household name or recipient label<input name="label" defaultValue={initial.label} required maxLength={120} disabled={disabled} /></label>
    <label>Mailing salutation<input name="salutation" defaultValue={initial.salutation} maxLength={160} disabled={disabled} /></label>
    <fieldset disabled={disabled}><legend>Shared mailing address</legend>{postalAddressFields.map(({ key, label, limit }) => (
      <label key={key}>{label}<input name={key} defaultValue={initial.postalAddress[key] ?? ""} maxLength={limit} /></label>
    ))}</fieldset>
    <button type="submit" disabled={disabled}>{submitLabel}</button>
  </form>;
}

function HouseholdChoicePicker({ kind, request, disabled, onChoose }: {
  kind: "households" | "people"; request: PersonRequest; disabled: boolean; onChoose: (choiceId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState("");
  const [choices, setChoices] = useState<HouseholdChoice[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const chooseHousehold = kind === "households";

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ kind, q: search });
    setLoading(true);
    setError("");
    const pending = window.setTimeout(() => {
      void request<HouseholdChoice[]>(`/api/people-records/households/options?${params}`, { signal: controller.signal }).then((result) => {
        if (!controller.signal.aborted) setChoices(result);
      }).catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not find choices.");
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 160);
    return () => { window.clearTimeout(pending); controller.abort(); };
  }, [kind, open, request, search]);

  return <details onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{chooseHousehold ? "Join an existing household" : "Add a household member"}</summary>
    {open && <form className="module-toolbar" onSubmit={(event) => { event.preventDefault(); if (selected) { onChoose(selected); setSelected(""); } }}>
      <label>{chooseHousehold ? "Find a household" : "Find a person"}<input type="search" maxLength={100} value={search} onChange={(event) => { setSearch(event.target.value); setSelected(""); }} /></label>
      <label>{chooseHousehold ? "Household" : "Person"}<select required value={selected} disabled={loading || disabled || Boolean(error)} onChange={(event) => setSelected(event.target.value)}>
        <option value="">{loading ? "Searching…" : "Choose"}</option>{choices.map(({ id, label }) => <option value={id} key={id}>{label}</option>)}
      </select></label>
      <button type="submit" disabled={!selected || loading || disabled || Boolean(error)}>{chooseHousehold ? "Join household" : "Add member"}</button>
      {error && <p role="alert">{error}</p>}
      {!loading && !error && choices.length === 0 && <p>No matches.</p>}
    </form>}
  </details>;
}

export function PersonHousehold({ contactId, personalAddress, archived, canManage, request, onNavigateEntity }: {
  contactId: string; personalAddress?: PostalAddress; archived: boolean; canManage: boolean; request: PersonRequest; onNavigateEntity?: ModuleContext["onNavigateEntity"];
}) {
  const [open, setOpen] = useState(false);
  const [household, setHousehold] = useState<Household | null | undefined>(undefined);
  const [revision, setRevision] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const canWrite = canManage && !archived;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoadError("");
    void request<{ household: Household | null }>(`/api/people-records/${contactId}/household`, { signal: controller.signal }).then((data) => {
      if (!controller.signal.aborted) setHousehold(data.household);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setLoadError(reason instanceof Error ? reason.message : "Could not load the household.");
    });
    return () => controller.abort();
  }, [contactId, open, request, revision]);

  async function mutate(personId: string, method: "POST" | "PUT" | "PATCH" | "DELETE", message: string, body?: HouseholdInput | { householdId: string }) {
    setBusy(true);
    setFeedback(null);
    try {
      await request(`/api/people-records/${personId}/household`, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
      setFeedback({ error: false, message });
      setRevision((current) => current + 1);
    } catch (reason) {
      setFeedback({ error: true, message: reason instanceof Error ? reason.message : "Could not update the household." });
    } finally { setBusy(false); }
  }

  function remove(member: HouseholdMember) {
    if (window.confirm(`Remove ${member.name} from this mailing household?`)) void mutate(member.id, "DELETE", "Household membership removed.");
  }

  return <details onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Mailing household</summary>
    {open && <div>
      {loadError && <p role="alert">{loadError}</p>}
      {feedback && <p role={feedback.error ? "alert" : "status"}>{feedback.message}</p>}
      {household === undefined && !loadError && <p role="status">Loading mailing household…</p>}
      {household === null && <p>This person does not belong to a mailing household.</p>}
      {household === null && canWrite && <>
        <details><summary>Create a mailing household</summary><HouseholdDetailsForm initial={{ label: "", salutation: "", postalAddress: personalAddress ?? {} }}
          submitLabel="Create household" disabled={busy} onSave={(input) => void mutate(contactId, "POST", "Mailing household created.", input)} /></details>
        <HouseholdChoicePicker request={request} kind="households" disabled={busy} onChoose={(householdId) => void mutate(contactId, "PUT", "Joined mailing household.", { householdId })} />
      </>}
      {household && <>
        <p><strong>{household.label}</strong>{household.salutation && <> · {household.salutation}</>}</p>
        <p>{postalAddressFields.map(({ key }) => household.postalAddress[key]).filter(Boolean).join(", ") || "No shared mailing address."}</p>
        <ul>{household.members.map((member) => <li key={member.id}>
          {member.id !== contactId && onNavigateEntity ? <button type="button" onClick={() => onNavigateEntity("person", member.id)}>{member.name}</button> : member.name}
          {member.archived && " (archived)"}{" "}
          {canWrite && !member.archived && <button type="button" disabled={busy} aria-label={`Remove ${member.name} from household`} onClick={() => remove(member)}>Remove</button>}
        </li>)}</ul>
        {canWrite && <>
          <details><summary>Edit household mailing details</summary><HouseholdDetailsForm key={`${household.id}:${revision}`} initial={household}
            submitLabel="Save household details" disabled={busy} onSave={(input) => void mutate(contactId, "PATCH", "Mailing household updated.", input)} /></details>
          <HouseholdChoicePicker key={revision} request={request} kind="people" disabled={busy}
            onChoose={(personId) => void mutate(personId, "PUT", "Person added to mailing household.", { householdId: household.id })} />
        </>}
      </>}
    </div>}
  </details>;
}

export function MailingRecipientsExport({ contactIds, departmentId }: { contactIds: string[]; departmentId: string }) {
  const [combine, setCombine] = useState(true);
  const [skipIncomplete, setSkipIncomplete] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);

  async function download(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      const params = new URLSearchParams({ contactIds: contactIds.join(","), combineHouseholds: String(combine), skipIncomplete: String(skipIncomplete) });
      const response = await fetch(`/api/people-records/mailing-recipients.csv?${params}`, { headers: { "x-department-id": departmentId }, cache: "no-store" });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(result?.error ?? "Could not export mailing recipients.");
      }
      const count = Number(response.headers.get("x-exported-recipients"));
      const skipped = Number(response.headers.get("x-skipped-recipients"));
      if (count > 0) {
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement("a");
        link.href = url;
        link.download = "mailing-recipients.csv";
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setFeedback({ error: false, message: `${count} exported${skipped ? `, ${skipped} skipped because of incomplete addresses` : ""}.` });
    } catch (reason) {
      setFeedback({ error: true, message: reason instanceof Error ? reason.message : "Could not export mailing recipients." });
    } finally { setBusy(false); }
  }

  return <details>
    <summary>Mailing recipients</summary>
    <form className="module-toolbar" onSubmit={(event) => void download(event)}>
      <label><input type="checkbox" checked={combine} onChange={(event) => setCombine(event.target.checked)} /> One recipient per household</label>
      <label><input type="checkbox" checked={skipIncomplete} onChange={(event) => setSkipIncomplete(event.target.checked)} /> Skip incomplete addresses</label>
      <button type="submit" disabled={busy || !contactIds.length}>Export recipients CSV</button>
      {feedback && <p role={feedback.error ? "alert" : "status"}>{feedback.message}</p>}
    </form>
  </details>;
}
