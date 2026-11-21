import { useState, type FormEvent } from "react";
import { membershipCsvRows } from "./csv-import";

type Group = { id: string; name: string; isLocal: boolean };
type Status = "active" | "paused" | "waitlist";
type PreviewRow = {
  row: number; decision: "invalid" | "missing" | "ambiguous" | "existing" | "duplicate" | "ready"; contactId?: string;
};
const decisions: Record<PreviewRow["decision"], string> = {
  invalid: "Invalid name or email", missing: "No matching active person", ambiguous: "Several people match",
  existing: "Already in group", duplicate: "Duplicate in file", ready: "Ready to add",
};
const maxFileSize = 128 * 1024;

export function GroupMembershipImport({ groups, request, onAdded }: {
  groups: Group[];
  request: <T>(url: string, init?: RequestInit) => Promise<T>;
  onAdded: () => void;
}) {
  const [groupId, setGroupId] = useState("");
  const [role, setRole] = useState("Member");
  const [status, setStatus] = useState<Status>("active");
  const [rows, setRows] = useState<ReturnType<typeof membershipCsvRows>>([]);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [chosen, setChosen] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const group = groups.find(group => group.id === groupId && group.isLocal);
  const resetPreview = () => { setPreview(null); setChosen([]); setMessage(""); setError(""); };

  async function read(file?: File) {
    resetPreview();
    setRows([]);
    if (!file) return;
    setBusy(true);
    try {
      if (file.size > maxFileSize) throw new Error("Use a CSV file of 128 KB or less.");
      setRows(membershipCsvRows(await file.text()));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not read the CSV file."); }
    finally { setBusy(false); }
  }

  async function previewImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !group || !rows.length) return;
    resetPreview();
    setBusy(true);
    try {
      const result = await request<{ rows: PreviewRow[] }>("/api/people-records/group-membership-import-preview", {
        method: "POST", body: JSON.stringify({ groupId, rows }),
      });
      setPreview(result.rows);
      setChosen(result.rows.filter(row => row.decision === "ready").map(row => row.row));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not match CSV rows."); }
    finally { setBusy(false); }
  }

  async function apply() {
    if (busy || !group || !role.trim() || !preview?.length) return;
    const contactIds = preview.flatMap(row => row.contactId && chosen.includes(row.row) ? [row.contactId] : []);
    if (!contactIds.length) return;
    setBusy(true);
    setError("");
    try {
      const result = await request<{ added: number; unchanged: number }>("/api/people-records/bulk-group-membership", {
        method: "POST", body: JSON.stringify({ groupId, contactIds, role: role.trim(), status }),
      });
      resetPreview();
      setMessage(result.added + " added to " + group.name + ". " + result.unchanged + " already in the group.");
      onAdded();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not add the selected people."); }
    finally { setBusy(false); }
  }

  return <section className="module-card" aria-labelledby="group-membership-import-title">
    <h2 id="group-membership-import-title">Import group memberships</h2>
    <p>Use a CSV with First name, Last name, and optional Email columns to match up to 100 existing people.</p>
    <form onSubmit={previewImport}>
      <label>Group<select value={groupId} required disabled={busy} onChange={event => { setGroupId(event.target.value); resetPreview(); }}>
        <option value="">Choose an active group</option>
        {groups.filter(group => group.isLocal).map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
      </select></label>
      <label>Membership CSV<input type="file" accept=".csv,text/csv" disabled={busy} onChange={event => void read(event.target.files?.[0])}/></label>
      <button disabled={busy || !group || !rows.length}>Preview membership import</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {preview && <>
      <div className="people-record-detail">{preview.map(row => {
        const source = rows[row.row - 1];
        return <label key={row.row}>
          {row.decision === "ready" && <input type="checkbox" checked={chosen.includes(row.row)} disabled={busy}
            onChange={event => setChosen(current => event.target.checked ? [...current,row.row] : current.filter(index => index !== row.row))}/>}
          Row {row.row} · {source.firstName} {source.lastName}{source.email && " · " + source.email} · {decisions[row.decision]}
        </label>;
      })}</div>
      <label>Group role<input value={role} maxLength={80} disabled={busy} onChange={event => setRole(event.target.value)}/></label>
      <label>Membership status<select value={status} disabled={busy} onChange={event => setStatus(event.target.value as Status)}>
        <option value="active">Active</option><option value="paused">Paused</option><option value="waitlist">Waitlist</option>
      </select></label>
      <button type="button" disabled={busy || !chosen.length || !role.trim()} onClick={() => void apply()}>Add selected people ({chosen.length})</button>
    </>}
  </section>;
}
