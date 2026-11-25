import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { ModuleContext } from "../../module-registry";

type Choice = { id: string; name: string; direction: "income" | "expense" };
type BookingContext = { currency: string; purposes: Choice[] };
type Send = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
type Center = { id: string; name: string; code: string; active: boolean };
type Group = { id: string; name: string; roles: string[] };
type Capabilities = { canPost: boolean; canViewBudget: boolean; canViewJournal: boolean; canViewDonors: boolean };
type Grant = Capabilities & { id: string; groupId: string; groupName: string | null; costCenterId: string; role: string; active: boolean };
const path = "/api/modules/finance/simple-booking";
const maxReceiptBytes = 10 * 1024 * 1024;
const maxReceiptFiles = 10;

async function encodeReceipt(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32_768) binary += String.fromCharCode(...bytes.subarray(i, i + 32_768));
  return { filename:file.name, base64:btoa(binary) };
}
const emptyForm = { purposeId: "", bookingDate: "", amount: "", bookingText: "", receiptNumber: "" };
const rights = {
  none: { label: "No booking or budget access", canPost: false, canViewBudget: false, canViewJournal: false },
  booking: { label: "Post bookings", canPost: true, canViewBudget: false, canViewJournal: false },
  budget: { label: "View budgets", canPost: false, canViewBudget: true, canViewJournal: false },
  journal: { label: "View journal and budgets", canPost: false, canViewBudget: true, canViewJournal: true },
  bookingBudget: { label: "Post bookings and view budgets", canPost: true, canViewBudget: true, canViewJournal: false },
  bookingJournal: { label: "Post bookings and view journal and budgets", canPost: true, canViewBudget: true, canViewJournal: true },
} as const;
type Right = keyof typeof rights;
const capabilityKey = (grant: Capabilities): Right =>
  grant.canPost ? grant.canViewJournal ? "bookingJournal" : grant.canViewBudget ? "bookingBudget" : "booking"
    : grant.canViewJournal ? "journal" : grant.canViewBudget ? "budget" : "none";
const capabilities = (key: Right, canViewDonors: boolean): Capabilities => {
  const { label: _, ...fields } = rights[key];
  return { ...fields, canViewDonors };
};
const emptyScope = { groupId: "", role: "", costCenterId: "", access: "booking" as Right, canViewDonors: false };

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
  const [receipts, setReceipts] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const submission = useRef<{ key: string; id: string; receipts: File[] } | undefined>(undefined);
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
    if (!receiptNumber && (submission.current?.key !== key || submission.current?.receipts !== receipts)) {
      submission.current = { key, id: crypto.randomUUID(), receipts };
    }
    setBusy(true);
    setError("");
    setFeedback("");
    try {
      const attachments = await Promise.all(receipts.map(encodeReceipt));
      const posted = await send<{ receiptNumber: string; receiptCount?: number }>("POST", {
        ...payload, ...(attachments.length ? { receipts:attachments } : {}), ...(receiptNumber ? { receiptNumber } : { submissionId: submission.current!.id }),
      });
      submission.current = undefined;
      setFeedback(`Booking posted with receipt ${posted.receiptNumber}.`
        + (posted.receiptCount ? ` Supporting files saved (${posted.receiptCount}).` : ""));
      setReceipts([]);
      setDraft({ ...emptyForm, bookingDate });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not post the booking.");
      try { setData(await send<BookingContext>("GET")); } catch { setData(undefined); }
    } finally { setBusy(false); }
  }

  function addReceipts(files: File[]) {
    if (!files.length) return;
    const next = [...receipts,...files];
    if (next.length > maxReceiptFiles || next.some(file => file.size === 0) || next.reduce((total,file) => total + file.size,0) > maxReceiptBytes) {
      setError("Choose up to 10 non-empty receipts, totaling no more than 10 MiB.");
      return;
    }
    setError("");
    setReceipts(next);
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
        <label className="finance-form-wide">Supporting receipts
          <input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" disabled={busy}
            onChange={event => { addReceipts([...event.currentTarget.files ?? []]); event.currentTarget.value = ""; }} />
        </label>
        {receipts.length > 0 && <ul className="finance-form-wide">
          {receipts.map((file,index) => <li key={index}>{file.name}{" "}
            <button type="button" className="finance-text-button" disabled={busy} aria-label={`Remove ${file.name}`}
              onClick={() => setReceipts(current => current.filter((_,position) => position !== index))}>Remove</button>
          </li>)}
        </ul>}
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

  async function save(grant?: Grant, changes?: Partial<Capabilities>) {
    setBusy(true);
    setError("");
    try {
      await send(path + "/grants" + (grant ? `/${grant.id}` : ""), grant ? "PATCH" : "POST", grant ? changes ?? { active: !grant.active }
        : { groupId: draft.groupId, role: draft.role, costCenterId: draft.costCenterId, ...capabilities(draft.access, draft.canViewDonors) });
      if (!grant) setDraft(emptyScope);
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update simple booking access."); }
    finally { setBusy(false); }
  }

  return <section className="finance-section">
    <h3>Group finance access</h3>
    <p>Assign cost-center access to group roles. Each person also needs the corresponding location permission.</p>
    {error && <p role="alert">{error}</p>}
    {grants.length > 0 && <div className="finance-table-wrap"><table className="finance-table">
      <thead><tr><th>Group</th><th>Role</th><th>Cost center</th><th>Access</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>{grants.map(grant => <tr key={grant.id}>
        <td>{grant.groupName ?? "Removed group"}</td><td>{grant.role}</td>
        <td>{centers.find(center => center.id === grant.costCenterId)?.name ?? "—"}</td>
        <td><select aria-label={`Access for ${grant.groupName ?? "removed group"} ${grant.role}`} value={capabilityKey(grant)} disabled={busy}
          onChange={event => void save(grant, capabilities(event.target.value as Right, grant.canViewDonors))}>
          {Object.entries(rights).map(([key, item]) => <option key={key} value={key} disabled={key === "none" && !grant.canViewDonors}>{item.label}</option>)}
        </select>
        <label><input type="checkbox" checked={grant.canViewDonors} disabled={busy || (capabilityKey(grant) === "none" && grant.canViewDonors)}
          onChange={event => void save(grant, { canViewDonors: event.target.checked })} />View donors</label></td>
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
      <label>Access<select value={draft.access} disabled={busy} onChange={event => setDraft({ ...draft, access: event.target.value as Right })}>
        {Object.entries(rights).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}
      </select></label>
      <label><input type="checkbox" checked={draft.canViewDonors} disabled={busy}
        onChange={event => setDraft({ ...draft, canViewDonors: event.target.checked })} />View donors</label>
      <div className="finance-form-actions"><button className="button button-secondary" type="submit" disabled={busy || (draft.access === "none" && !draft.canViewDonors)}>Grant group finance access</button></div>
    </form>
  </section>;
}
