import { useState, type FormEvent } from "react";

type PurposeValues = {
  name: string; direction: "income" | "expense"; bankAccountId: string;
  counterAccountId: string; costCenterId: string; sortOrder: number; active: boolean;
};
export type BookingPurpose = PurposeValues & { id: string; usable: boolean };
type MasterData = { id: string; code: string; name: string; active: boolean };
type Props = {
  purposes: BookingPurpose[];
  accounts: (MasterData & { accountType: string })[];
  centers: MasterData[];
  busy: boolean;
  save: (purpose: PurposeValues, id?: string) => Promise<boolean>;
};

const initialPurpose: PurposeValues = {
  name: "", direction: "income", bankAccountId: "", counterAccountId: "", costCenterId: "", sortOrder: 0, active: true,
};
const label = (item: MasterData) => `${item.code} · ${item.name}`;

export function BookingPurposesPanel({ purposes, accounts, centers, busy, save }: Props) {
  const [draft, setDraft] = useState<PurposeValues>(initialPurpose);
  const [editing, setEditing] = useState<string>();
  const bankAccounts = accounts.filter(item => item.accountType === "asset" && (item.active || item.id === draft.bankAccountId));
  const counterAccounts = accounts.filter(item => item.accountType === draft.direction && (item.active || item.id === draft.counterAccountId));
  const availableCenters = centers.filter(item => item.active || item.id === draft.costCenterId);

  function reset() {
    setEditing(undefined);
    setDraft(initialPurpose);
  }

  function edit(purpose: BookingPurpose) {
    const { id, usable: _, ...fields } = purpose;
    setDraft(fields);
    setEditing(id);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await save(draft, editing)) reset();
  }

  return <section className="finance-section">
    <h3>Booking purposes</h3>
    {purposes.length > 0 && <div className="finance-table-wrap"><table className="finance-table">
      <thead><tr><th>Name</th><th>Direction</th><th>Bank account</th><th>Counteraccount</th><th>Cost center</th><th>Order</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>{purposes.map(purpose => <tr key={purpose.id}>
        <td>{purpose.name}</td><td>{purpose.direction === "income" ? "Income" : "Expense"}</td>
        <td>{accounts.find(item => item.id === purpose.bankAccountId)?.name ?? "—"}</td>
        <td>{accounts.find(item => item.id === purpose.counterAccountId)?.name ?? "—"}</td>
        <td>{centers.find(item => item.id === purpose.costCenterId)?.name ?? "—"}</td><td>{purpose.sortOrder}</td>
        <td>{purpose.active ? purpose.usable ? "Active" : "Unavailable" : "Archived"}</td>
        <td><button type="button" className="finance-text-button" disabled={busy} aria-label={`Edit ${purpose.name}`} onClick={() => edit(purpose)}>Edit</button></td>
      </tr>)}</tbody>
    </table></div>}
    <form className="finance-form-grid" onSubmit={event => void submit(event)}>
      <label>Purpose name<input required maxLength={120} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
      <label>Direction<select value={draft.direction} onChange={event =>
        setDraft({ ...draft, direction: event.target.value as PurposeValues["direction"], counterAccountId: "" })}>
        <option value="income">Income</option><option value="expense">Expense</option>
      </select></label>
      <label>Bank account<select required value={draft.bankAccountId} onChange={event => setDraft({ ...draft, bankAccountId: event.target.value })}>
        <option value="">Choose a bank account</option>{bankAccounts.map(item => <option key={item.id} value={item.id}>{label(item)}</option>)}
      </select></label>
      <label>Counteraccount<select required value={draft.counterAccountId} onChange={event => setDraft({ ...draft, counterAccountId: event.target.value })}>
        <option value="">Choose a counteraccount</option>{counterAccounts.map(item => <option key={item.id} value={item.id}>{label(item)}</option>)}
      </select></label>
      <label>Cost center<select required value={draft.costCenterId} onChange={event => setDraft({ ...draft, costCenterId: event.target.value })}>
        <option value="">Choose a cost center</option>{availableCenters.map(item => <option key={item.id} value={item.id}>{label(item)}</option>)}
      </select></label>
      <label>Sort order<input type="number" required min="0" max="10000" step="1" value={Number.isNaN(draft.sortOrder) ? "" : draft.sortOrder}
        onChange={event => setDraft({ ...draft, sortOrder: event.target.valueAsNumber })} /></label>
      {editing && <label><input type="checkbox" checked={draft.active} onChange={event => setDraft({ ...draft, active: event.target.checked })} />Active</label>}
      <div className="finance-form-actions">
        {editing && <button className="button button-secondary" disabled={busy} type="button" onClick={reset}>Cancel</button>}
        <button className="button button-secondary" disabled={busy} type="submit">{editing ? "Save purpose" : "Add purpose"}</button>
      </div>
    </form>
  </section>;
}
