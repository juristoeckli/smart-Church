import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { ModuleContext } from "../../module-registry";

type Choice = { id: string; name: string; direction: "income" | "expense" };
type BookingContext = { currency: string; purposes: Choice[] };
type Send = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
type Center = { id: string; name: string; code: string; active: boolean };
type Group = { id: string; name: string; roles: string[] };
type Grant = { id: string; groupId: string; groupName: string | null; costCenterId: string; role: string; active: boolean };
const path = "/api/modules/finance/simple-booking";
const emptyForm = { purposeId: "", bookingDate: "", amount: "", bookingText: "", receiptNumber: "" };
const emptyScope = { groupId: "", role: "", costCenterId: "" };

function amountCents(amount: string) {
  const valid = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount);
  if (!valid) return 0;
  const cents = Number(valid[1]) * 100 + Number((valid[2] ?? "").padEnd(2,"0"));
  return Number.isSafeInteger(cents) && cents <= 9_000_000_000_000_000 ? cents : 0;
}

export function ScopedSimpleBooking({ context }: { context: ModuleContext }) {
  const { departmentId, csrfToken } = context;
  const [data, setData] = useState<BookingContext>();
  const [draft, setDraft] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const submission = useRef<{ key: string; id: string } | undefined>(undefined);
  const send = useCallback(async <T,>(method: string, body?: unknown) => {
    const response = await fetch(path, {
      method, headers: { "x-department-id": departmentId, ...(body ? { "content-type": "application/json", "x-csrf-token": csrfToken } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(result.error ?? "The booking request failed.");
    return result;
  }, [departmentId, csrfToken]);

  useEffect(() => {
    let current = true;
    send<BookingContext>("GET").then(data => { if (current) setData(data); })
      .catch(reason => { if (current) setError(reason instanceof Error ? reason.message : "Could not load group booking purposes."); });
    return () => { current = false; };
  }, [send]);

  async function post(event: FormEvent) {
    event.preventDefault();
    if (!data || busy || !draft.purposeId || !amountCents(draft.amount)) return;
    const { purposeId, bookingDate, bookingText } = draft;
    const receiptNumber = draft.receiptNumber.trim();
    const payload = { purposeId, bookingDate, bookingText, amountCents: amountCents(draft.amount), currency: data.currency };
    const key = JSON.stringify(payload);
    if (!receiptNumber && submission.current?.key !== key) submission.current = { key, id: crypto.randomUUID() };
    setBusy(true);
    setError("");
    setFeedback("");
    try {
      const posted = await send<{ receiptNumber: string }>("POST", {
        ...payload, ...(receiptNumber ? { receiptNumber } : { submissionId: submission.current!.id }),
      });
      submission.current = undefined;
      setFeedback(`Booking posted with receipt ${posted.receiptNumber}.`);
      setDraft({ ...emptyForm, bookingDate });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not post the booking.");
      try { setData(await send<BookingContext>("GET")); } catch { setData(undefined); }
    } finally { setBusy(false); }
  }

  return <main className="finance-page">
    <section className="finance-section">
      <h2>Simple group booking</h2>
      {error && <p role="alert">{error}</p>}
      {feedback && <p role="status">{feedback}</p>}
      {data && (data.purposes.length ? <form className="finance-form-grid" onSubmit={event => void post(event)}>
        <label>Booking purpose<select required disabled={busy} value={draft.purposeId} onChange={event => setDraft({ ...draft, purposeId: event.target.value })}>
          <option value="">Choose a purpose</option>
          {data.purposes.map(item => <option key={item.id} value={item.id}>{item.name} · {item.direction === "income" ? "Income" : "Expense"}</option>)}
        </select></label>
        <label>Booking date<input type="date" required disabled={busy} value={draft.bookingDate} onChange={event => setDraft({ ...draft, bookingDate: event.target.value })} /></label>
        <label>Amount ({data.currency})<input type="number" min="0.01" step="0.01" required disabled={busy} value={draft.amount} onChange={event => setDraft({ ...draft, amount: event.target.value })} /></label>
        <label>Receipt number<input maxLength={80} disabled={busy} value={draft.receiptNumber} onChange={event => setDraft({ ...draft, receiptNumber: event.target.value })} />
          <small>Leave blank if automatic receipts are enabled for the booking date.</small>
        </label>
        <label className="finance-form-wide">Booking text<input maxLength={500} required disabled={busy} value={draft.bookingText} onChange={event => setDraft({ ...draft, bookingText: event.target.value })} /></label>
        <div className="finance-form-actions"><button className="button button-primary" type="submit" disabled={busy || !draft.purposeId || !amountCents(draft.amount)}>Post booking</button></div>
      </form> : <p>There are no active booking purposes for your group roles.</p>)}
    </section>
  </main>;
}

export function SimpleBookingGrantsPanel({ send, centers }: { send: Send; centers: Center[] }) {
  const roleList = useId();
  const [draft, setDraft] = useState(emptyScope);
  const [groups, setGroups] = useState<Group[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    const response = await send<{ groups: Group[]; grants: Grant[] }>(path + "/grants");
    setGroups(response.groups);
    setGrants(response.grants);
  }, [send]);
  useEffect(() => { void refresh().catch(reason => setError(reason instanceof Error ? reason.message : "Could not load simple booking access.")); }, [refresh]);

  async function save(grant?: Grant) {
    setBusy(true);
    setError("");
    try {
      await send(path + "/grants" + (grant ? `/${grant.id}` : ""), grant ? "PATCH" : "POST", grant ? { active: !grant.active } : draft);
      if (!grant) setDraft(emptyScope);
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update simple booking access."); }
    finally { setBusy(false); }
  }

  return <section className="finance-section">
    <h3>Simple booking access</h3>
    <p>Assign a cost center to a group role. People using these purposes also need the Simple group booking location permission.</p>
    {error && <p role="alert">{error}</p>}
    {grants.length > 0 && <div className="finance-table-wrap"><table className="finance-table">
      <thead><tr><th>Group</th><th>Role</th><th>Cost center</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>{grants.map(grant => <tr key={grant.id}>
        <td>{grant.groupName ?? "Removed group"}</td><td>{grant.role}</td>
        <td>{centers.find(center => center.id === grant.costCenterId)?.name ?? "—"}</td>
        <td>{grant.active ? "Active" : "Revoked"}</td>
        <td><button className="finance-text-button" type="button" disabled={busy} onClick={() => void save(grant)}>{grant.active ? "Revoke" : "Restore"}</button></td>
      </tr>)}</tbody>
    </table></div>}
    <form className="finance-form-grid" onSubmit={event => { event.preventDefault(); void save(); }}>
      <label>Group<select required disabled={busy} value={draft.groupId} onChange={event => setDraft({ ...draft, groupId: event.target.value, role: "" })}>
        <option value="">Choose a group</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
      </select></label>
      <label>Group role<input required maxLength={80} list={roleList} disabled={busy || !draft.groupId} value={draft.role}
        onChange={event => setDraft({ ...draft, role: event.target.value })} />
        <datalist id={roleList}>{groups.find(group => group.id === draft.groupId)?.roles.map(role => <option key={role} value={role} />)}</datalist>
      </label>
      <label>Cost center<select required disabled={busy} value={draft.costCenterId} onChange={event => setDraft({ ...draft, costCenterId: event.target.value })}>
        <option value="">Choose a cost center</option>{centers.filter(center => center.active).map(center =>
          <option key={center.id} value={center.id}>{center.code} · {center.name}</option>)}
      </select></label>
      <div className="finance-form-actions"><button className="button button-secondary" type="submit" disabled={busy}>Grant simple booking</button></div>
    </form>
  </section>;
}
