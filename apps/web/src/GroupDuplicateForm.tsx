import { useState, type FormEvent } from "react";

export function GroupDuplicateForm({ groupId, groupName, departmentId, csrfToken, onCreated }: {
  groupId: string; groupName: string; departmentId: string; csrfToken: string;
  onCreated: (id: string) => Promise<void>;
}) {
  const [name, setName] = useState(() => Array.from(groupName).slice(0, 115).join("") + " copy");
  const [copyFields, setCopyFields] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function duplicate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/groups/" + groupId + "/duplicate", {
        method: "POST",
        headers: { "content-type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken },
        body: JSON.stringify({ name: name.trim(), copyFields }),
      });
      const result = await response.json() as { id?: string; error?: string };
      if (!response.ok || !result.id) throw new Error(result.error ?? "Could not duplicate the group.");
      await onCreated(result.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not duplicate the group."); }
    finally { setSaving(false); }
  }

  return <details>
    <summary>Duplicate group</summary>
    <form className="community-group-form" onSubmit={duplicate}>
      <p>The new draft starts with the source description and type, an empty roster and closed public signup.</p>
      <label>New group name<input required maxLength={120} value={name} disabled={saving} onChange={event => setName(event.target.value)}/></label>
      <label><input type="checkbox" checked={copyFields} disabled={saving} onChange={event => setCopyFields(event.target.checked)}/> Copy active membership field settings</label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" className="button button-secondary" disabled={!name.trim() || saving}>{saving ? "Creating…" : "Create draft copy"}</button>
    </form>
  </details>;
}
