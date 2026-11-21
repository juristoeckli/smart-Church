import { useEffect, useState } from "react";

type Value = string | number | boolean;
export type RosterMember = { contactId: string; firstName: string; lastName: string };
type Field = { id: string; label: string; revision: number };
type Row = { contactId: string; values: Record<string, Value | null> };
type Request = <T>(url: string, init?: RequestInit) => Promise<T>;
export const rosterExportFormats = [{ format: "csv", label: "CSV" }, { format: "xlsx", label: "Excel" }] as const;
export type RosterExportFormat = typeof rosterExportFormats[number]["format"];
const pageSize = 25;
const maxFields = 8;

export function TypedRosterColumns({ base, fields, members, revision, request, exporting, onExport }: {
  base: string; fields: Field[]; members: RosterMember[]; revision: number; request: Request;
  exporting: boolean; onExport: (format: RosterExportFormat, fieldIds: string[]) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ scope: string; rows: Row[] } | null>(null);
  const [failure, setFailure] = useState<{ scope: string; message: string } | null>(null);
  const selected = fields.filter(field => selectedIds.includes(field.id));
  const pageCount = Math.max(1, Math.ceil(members.length / pageSize));
  const effectivePage = Math.min(page, pageCount - 1);
  const visible = members.slice(effectivePage * pageSize, (effectivePage + 1) * pageSize);
  const params = new URLSearchParams();
  for (const field of selected) params.append("fieldId", field.id);
  for (const member of visible) params.append("contactId", member.contactId);
  const query = open && selected.length && visible.length ? "?" + params : "";
  const scope = JSON.stringify([base, query, selected.map(field => field.revision), revision, retry]);
  const rows = result?.scope === scope ? result.rows : null;
  const error = failure?.scope === scope ? failure.message : "";
  const rowById = new Map(rows?.map(row => [row.contactId, row]));

  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    request<{ members: Row[] }>(base + "/roster-values" + query, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setResult({ scope, rows: data.members }); })
      .catch(reason => { if (!controller.signal.aborted) setFailure({ scope, message: reason.message }); });
    return () => controller.abort();
  }, [base, query, request, scope]);

  return <details className="gh-roster-columns" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Compare membership fields</summary>
    <fieldset>
      <legend>Roster columns (up to {maxFields})</legend>
      {fields.map(field => <label key={field.id}>
        <input type="checkbox" checked={selectedIds.includes(field.id)} disabled={selected.length >= maxFields && !selectedIds.includes(field.id)}
          onChange={event => {
            setSelectedIds(current => event.target.checked ? [...current.filter(id => fields.some(item => item.id === id)), field.id] : current.filter(id => id !== field.id));
            setPage(0);
          }}/>
        {field.label}
      </label>)}
    </fieldset>
    {selected.length > 0 && rosterExportFormats.map(({ format, label }) =>
      <button key={format} type="button" disabled={exporting} onClick={() => void onExport(format, selected.map(field => field.id))}>
        Export whole group with these columns ({label})
      </button>)}
    {error && <p role="alert">{error} <button type="button" onClick={() => setRetry(value => value + 1)}>Retry</button></p>}
    {query && !rows && !error && <p role="status">Loading roster values…</p>}
    {selected.length > 0 && !visible.length && <p>No members match the roster filters.</p>}
    {rows && <div className="gh-roster-table">
      <table>
        <thead><tr><th scope="col">Member</th>{selected.map(field => <th scope="col" key={field.id}>{field.label}</th>)}</tr></thead>
        <tbody>{visible.filter(member => rowById.has(member.contactId)).map(member => <tr key={member.contactId}>
          <th scope="row">{member.firstName} {member.lastName}</th>
          {selected.map(field => {
            const value = rowById.get(member.contactId)?.values[field.id];
            return <td key={field.id}>{typeof value === "boolean" ? (value ? "Yes" : "No") : value ?? "—"}</td>;
          })}
        </tr>)}</tbody>
      </table>
      {rows.length === 0 && <p>No current roster members appear on this page.</p>}
    </div>}
    {selected.length > 0 && pageCount > 1 && <nav aria-label="Roster comparison pages" className="gh-actions">
      <button type="button" disabled={effectivePage === 0} onClick={() => setPage(effectivePage - 1)}>Previous</button>
      <span>Page {effectivePage + 1} of {pageCount}</span>
      <button type="button" disabled={effectivePage + 1 >= pageCount} onClick={() => setPage(effectivePage + 1)}>Next</button>
    </nav>}
  </details>;
}
