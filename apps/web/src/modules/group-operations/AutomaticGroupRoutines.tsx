import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import type { ModuleContext } from "../../module-registry";

type Status = "active" | "paused" | "waitlist";
type Step =
  | { kind: "wait"; minutes: number }
  | { kind: "followup"; subject: string; dueDays: number; assigneeId: string }
  | { kind: "membership"; role?: string; status?: Status }
  | { kind: "addToGroup"; targetGroupId: string; role: string; status: Status }
  | { kind: "removeMembership" };
type Routine = { id: string; name: string; role: string; status: Status; steps: Step[]; enabled: boolean };
type Run = { id: string; routineId: string; memberName: string; phase: "queued" | "waiting" | "completed" | "cancelled" | "failed"; nextStep: number; dueAt: string; outcome: string | null };
type Data = { active: boolean; canChangeMembership: boolean; roles: string[]; assignees: Array<{id: string; name: string}>; routines: Routine[]; runs: Run[]; targetGroups: Array<{id: string; name: string}> };
type Props = Pick<ModuleContext, "departmentId" | "csrfToken" | "realtime"> & { groupId: string };
const statuses: Record<Status, string> = { active: "Active", paused: "Paused", waitlist: "Waitlist" };
const phases: Record<Run["phase"], string> = { queued: "Queued", waiting: "Waiting", completed: "Completed", cancelled: "Cancelled", failed: "Failed" };
const emptyDraft = () => ({ name: "", role: "Member", status: "active" as Status, steps: [] as Step[] });

const terminal = (step?: Step) => step?.kind === "membership" || step?.kind === "removeMembership";
const membershipStep = (step: Step) => terminal(step) || step.kind === "addToGroup";
const stepTitles: Record<Step["kind"], string> = {
  wait: "Wait", followup: "Follow-up", membership: "Final membership change",
  addToGroup: "Add to another group", removeMembership: "End source membership",
};

function stepLabel(step: Step, groups: Data["targetGroups"] = []) {
  if (step.kind === "wait") return `Wait ${step.minutes} minutes`;
  if (step.kind === "followup") return `Create follow-up: ${step.subject}`;
  if (step.kind === "removeMembership") return "End membership in this group";
  if (step.kind === "addToGroup") return `Add to ${groups.find(({ id }) => id === step.targetGroupId)?.name ?? "another group"} as ${step.role} · ${statuses[step.status]}`;
  return `Change membership to ${[step.role, step.status && statuses[step.status]].filter(Boolean).join(" · ")}`;
}

export function AutomaticGroupRoutines({ departmentId, groupId, csrfToken, realtime }: Props) {
  const [data, setData] = useState<Data | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const roleList = useId();
  const endpoint = "/api/modules/group-operations/automatic-routines/" + groupId;
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void fetch(endpoint, { headers: { "x-department-id": departmentId }, cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as Data & { error?: string };
        if (!response.ok) throw new Error(body.error || "Could not load automatic routines.");
        if (!controller.signal.aborted) { setData(body); setError(""); }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) { setData(null); setError(reason instanceof Error ? reason.message : "Could not load automatic routines."); }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [departmentId, endpoint, revision]);

  useEffect(() => realtime?.subscribe("module:group-operations:changed", (payload) => {
    if (!payload || typeof payload !== "object" || !("groupId" in payload) || payload.groupId === groupId) refresh();
  }), [groupId, realtime, refresh]);

  async function mutate(method: "POST" | "PATCH", path: string, body: object, message: string) {
    if (busy) return false;
    setBusy(true); setError(""); setFeedback("");
    try {
      const result = await fetch(endpoint + path, {
        method, headers: { "content-type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken },
        body: JSON.stringify(body),
      });
      if (!result.ok) {
        const failure = await result.json().catch(() => null) as { error?: string } | null;
        throw new Error(failure?.error || "Could not update the routine.");
      }
      setFeedback(message);
      refresh();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update the routine.");
      return false;
    } finally { setBusy(false); }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const last = draft.steps.at(-1);
    if (last?.kind === "membership" && !last.role?.trim() && !last.status) {
      setError("Choose a new membership role or status."); return;
    }
    if (await mutate("POST", "", draft, "Automatic routine enabled.")) setDraft(emptyDraft());
  }

  function sendStep(index: number, step: Step) {
    setDraft((current) => ({ ...current, steps: current.steps.map((existing, position) => position === index ? step : existing) }));
  }

  const hasFinalStep = terminal(draft.steps.at(-1));
  function addStep(step: Step) {
    setDraft((current) => {
      const beforeFinal = terminal(current.steps.at(-1)) ? current.steps.length - 1 : current.steps.length;
      return { ...current, steps: [...current.steps.slice(0, beforeFinal), step, ...current.steps.slice(beforeFinal)] };
    });
  }

  return <div className="go-layout">
    <section className="go-panel">
      <h2>Automatic member routines</h2>
      {loading && !data && <p role="status">Loading routines…</p>}
      {error && <p className="go-error" role="alert">{error}</p>}
      {!!error && !data && <button type="button" className="button button-secondary" onClick={refresh}>Retry</button>}
      {feedback && <p role="status">{feedback}</p>}
      {data && (data.active ? <form className="go-form" onSubmit={(event) => void create(event)}>
        <p>Starts when a member receives this role and status. Existing matches stay out of the routine until their membership changes.</p>
        <label>Routine name<input required maxLength={120} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>Trigger role<input required maxLength={80} list={roleList} value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })} /></label>
        <datalist id={roleList}>{data.roles.map((role) => <option key={role} value={role} />)}</datalist>
        <label>Trigger status<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as Status })}>
          {Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        {draft.steps.map((step, index) => <fieldset key={index}>
          <legend>{index + 1}. {stepTitles[step.kind]}</legend>
          {step.kind === "wait" && <label>Wait minutes<input type="number" min={1} max={525600} required value={step.minutes}
            onChange={(event) => sendStep(index, { ...step, minutes: Number(event.target.value) })} /></label>}
          {step.kind === "followup" && <>
            <label>Follow-up subject<input required maxLength={160} value={step.subject} onChange={(event) => sendStep(index, { ...step, subject: event.target.value })} /></label>
            <label>Assigned member<select required value={step.assigneeId} onChange={(event) => sendStep(index, { ...step, assigneeId: event.target.value })}>
              <option value="">Choose a member</option>{data.assignees.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
            </select></label>
            <label>Due in days<input type="number" min={0} max={365} required value={step.dueDays} onChange={(event) => sendStep(index, { ...step, dueDays: Number(event.target.value) })} /></label>
          </>}
          {step.kind === "addToGroup" && <>
            <label>Destination group<select required value={step.targetGroupId} onChange={(event) => sendStep(index, { ...step, targetGroupId: event.target.value })}>
              <option value="">Choose a group</option>{data.targetGroups.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
            </select></label>
            <label>Destination role<input required maxLength={80} value={step.role} onChange={(event) => sendStep(index, { ...step, role: event.target.value })} /></label>
            <label>Destination status<select value={step.status} onChange={(event) => sendStep(index, { ...step, status: event.target.value as Status })}>
              {Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
            <small>An existing destination membership with a different role or status stops the routine.</small>
          </>}
          {step.kind === "removeMembership" && <p>Removes the membership in this group after all earlier steps have finished.</p>}
          {step.kind === "membership" && <>
            <label>New role<input list={roleList} maxLength={80} value={step.role ?? ""} placeholder="Keep current role"
              onChange={(event) => sendStep(index, { ...step, role: event.target.value || undefined })} /></label>
            <label>New status<select value={step.status ?? ""} onChange={(event) => sendStep(index, { ...step, status: (event.target.value || undefined) as Status | undefined })}>
              <option value="">Keep current status</option>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
          </>}
          <button className="button button-secondary" type="button" onClick={() => setDraft({ ...draft, steps: draft.steps.filter((_, position) => position !== index) })}>Remove step {index + 1}</button>
        </fieldset>)}
        <div className="form-actions">
          <button className="button button-secondary" type="button" disabled={draft.steps.length >= 12} onClick={() => addStep({ kind: "wait", minutes: 1440 })}>Add wait</button>
          <button className="button button-secondary" type="button" disabled={draft.steps.length >= 12 || !data.assignees.length}
            onClick={() => addStep({ kind: "followup", subject: "", assigneeId: "", dueDays: 1 })}>Add follow-up</button>
          {data.canChangeMembership && data.targetGroups.length > 0 && <button className="button button-secondary" type="button" disabled={draft.steps.length >= 12}
            onClick={() => addStep({ kind: "addToGroup", targetGroupId: "", role: "Member", status: "active" })}>Add to another group</button>}
          {data.canChangeMembership && <button className="button button-secondary" type="button" disabled={draft.steps.length >= 12 || hasFinalStep}
            onClick={() => addStep({ kind: "removeMembership" })}>End source membership</button>}
          {data.canChangeMembership && <button className="button button-secondary" type="button" disabled={draft.steps.length >= 12 || hasFinalStep}
            onClick={() => addStep({ kind: "membership" })}>Add membership change</button>}
        </div>
        <button className="button button-primary" disabled={busy || !draft.steps.length}>Enable routine</button>
      </form> : <p>Activate this group to create automatic routines.</p>)}
    </section>
    {data && <section className="go-panel">
      <h2>Definitions and progress</h2>
      <div className="go-list">{data.routines.map((routine) => <article key={routine.id}>
        <div><strong>{routine.name}</strong><small>{routine.role} · {statuses[routine.status]} · {routine.enabled ? "Enabled" : "Disabled"}</small>
          <ol>{routine.steps.map((step, index) => <li key={index}>{stepLabel(step, data.targetGroups)}</li>)}</ol></div>
        <button className="button button-secondary" type="button" disabled={busy || (!routine.enabled && (
          !data.active || !data.canChangeMembership && routine.steps.some(membershipStep)
        ))} onClick={() => {
          if (routine.enabled && !window.confirm("Disable this routine and cancel members’ queued or waiting steps?")) return;
          void mutate("PATCH", "/" + routine.id, { enabled: !routine.enabled }, routine.enabled ? "Routine disabled." : "Routine enabled.");
        }}>{routine.enabled ? "Disable" : "Enable"}</button>
      </article>)}</div>
      {!data.routines.length && <p className="go-empty">No automatic routines yet.</p>}
      <h3>Member progress</h3>
      <div className="go-list">{data.runs.map((run) => {
        const routine = data.routines.find((item) => item.id === run.routineId);
        return <article key={run.id}><div><strong>{run.memberName}</strong><small>{routine?.name} · {phases[run.phase]}</small>
          {run.phase === "waiting" && <small>Wait ends {new Date(run.dueAt).toLocaleString()}{routine && routine.steps[run.nextStep] ? ` · Next: ${stepLabel(routine.steps[run.nextStep], data.targetGroups)}` : ""}</small>}
          {run.outcome && <p>{run.outcome}</p>}</div>
          {run.phase === "waiting" && <button className="button button-secondary" type="button" disabled={busy}
            onClick={() => void mutate("POST", "/runs/" + run.id + "/skip-wait", {}, "Wait released.")}>Skip wait</button>}
        </article>;
      })}</div>
      {!data.runs.length && <p className="go-empty">No members have started a routine yet.</p>}
    </section>}
  </div>;
}
