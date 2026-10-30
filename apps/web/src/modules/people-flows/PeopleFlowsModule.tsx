import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Archive, Check, CircleAlert, Plus, RefreshCw, Users } from "lucide-react";
import type { ModuleContext } from "../../module-registry";
import "./people-flows.css";

type Flow = { id: string; name: string; description: string; status: "active" | "archived"; stepCount: number; activeEnrollmentCount: number; createdAt: string; updatedAt: string };
type Step = { id: string; title: string; instructions: string; position: number; dueAfterDays: number | null; required: boolean; active: boolean };
type ProgressStep = { stepId: string; title: string; position: number; required: boolean; active: boolean; status: "pending" | "completed" | "skipped"; dueOn: string | null; completedAt: string | null };
type Assignment = { id: string; flowId: string; contactId: string; contactName: string; status: "active" | "completed" | "cancelled"; dueOn: string | null; startedAt: string; completedAt: string | null; steps: ProgressStep[] };
type Contact = { id: string; firstName: string; lastName: string; email?: string; status: "member" | "visitor"; importedFrom?: string };
type Audit = { id: string; actorUserId: string | null; action: string; flowId: string | null; enrollmentId: string | null; stepId: string | null; metadata: Record<string, unknown>; createdAt: string };
function dueLabel(language: ModuleContext["language"], date: string) {
  const label: Record<ModuleContext["language"], string> = {
    en: `Due ${date}`, de: `Fällig am ${date}`, fr: `Échéance : ${date}`, it: `Scadenza: ${date}`,
  };
  return label[language];
}
function assignmentSummary(language: ModuleContext["language"], created: number, skipped: number) {
  const label: Record<ModuleContext["language"], (created: number, skipped: number) => string> = {
    en: (created, skipped) => `People assigned: ${created}; already active: ${skipped}.`,
    de: (created, skipped) => `Zugewiesene Personen: ${created}; bereits aktiv: ${skipped}.`,
    fr: (created, skipped) => `Personnes attribuées : ${created} ; déjà actives : ${skipped}.`,
    it: (created, skipped) => `Persone assegnate: ${created}; già attive: ${skipped}.`,
  };
  return label[language](created, skipped);
}


function statusLabel(value: string) { return value.charAt(0).toUpperCase() + value.slice(1); }
function auditLabel(action: string) {
  const labels: Record<string, string> = {
    flow_created: "flow created", flow_updated: "flow updated", flow_archived: "flow archived", flow_activated: "flow activated",
    step_created: "step created", step_updated: "step updated", people_assigned: "people assigned",
    assignment_completed: "assignment completed", assignment_cancelled: "assignment cancelled", assignment_active: "assignment active",
    step_status_changed: "step status changed",
  };
  return labels[action] ?? action.replaceAll("_", " ");
}

export function PeopleFlowsModule({ departmentId, csrfToken, language }: ModuleContext) {
  const [flows, setFlows] = useState<Flow[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedFlowId, setSelectedFlowId] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [stepTitle, setStepTitle] = useState("");
  const [stepInstructions, setStepInstructions] = useState("");
  const [stepDueDays, setStepDueDays] = useState("");
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [assignmentDueOn, setAssignmentDueOn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");

  const selectedFlow = flows.find((flow) => flow.id === selectedFlowId) ?? null;
  const writableContacts = useMemo(() => contacts.slice().sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName)), [contacts]);

  async function api(path: string, method = "GET", body?: unknown) {
    const response = await fetch(path, {
      method,
      headers: { "x-department-id": departmentId, ...(method !== "GET" ? { "x-csrf-token": csrfToken } : {}), ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json().catch(() => null) as unknown;
    if (!response.ok) {
      const message = result && typeof result === "object" && "error" in result && typeof result.error === "string" ? result.error : "The request could not be completed.";
      throw new Error(message);
    }
    return result;
  }

  async function loadFlowData(flowId: string) {
    if (!flowId) { setSteps([]); setAssignments([]); return; }
    const [flow, flowAssignments] = await Promise.all([
      api(`/api/people-flows/${encodeURIComponent(flowId)}`) as Promise<Flow & { steps: Step[] }>,
      api(`/api/people-flows/${encodeURIComponent(flowId)}/assignments`) as Promise<Assignment[]>,
    ]);
    setSteps(flow.steps);
    setAssignments(flowAssignments);
    setEditName(flow.name);
    setEditDescription(flow.description);
  }

  async function refresh(flowId = selectedFlowId) {
    setError("");
    try {
      const [nextFlows, people, auditRows] = await Promise.all([
        api("/api/people-flows") as Promise<Flow[]>,
        api("/api/contacts") as Promise<Contact[]>,
        api("/api/people-flows/audit") as Promise<Audit[]>,
      ]);
      setFlows(nextFlows);
      setContacts(people);
      setAudit(auditRows);
      const nextId = nextFlows.some((flow) => flow.id === flowId) ? flowId : nextFlows[0]?.id ?? "";
      setSelectedFlowId(nextId);
      await loadFlowData(nextId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load People Flows.");
    }
  }

  useEffect(() => { void refresh(""); }, [departmentId]);

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true); setError(""); setFeedback("");
    try { await action(); await refresh(selectedFlowId); setFeedback(success); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The request could not be completed."); }
    finally { setBusy(false); }
  }

  async function createFlow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const flow = await api("/api/people-flows", "POST", { name: newName, description: newDescription }) as Flow;
      setNewName(""); setNewDescription(""); setSelectedFlowId(flow.id);
    }, "Workflow created.");
  }

  async function saveFlow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFlow) return;
    await run(async () => {
      await api(`/api/people-flows/${selectedFlow.id}`, "PUT", { name: editName, description: editDescription });
    }, "Workflow saved.");
  }

  async function addStep(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFlow) return;
    await run(async () => {
      await api(`/api/people-flows/${selectedFlow.id}/steps`, "POST", { title: stepTitle, instructions: stepInstructions, dueAfterDays: stepDueDays ? Number(stepDueDays) : null });
      setStepTitle(""); setStepInstructions(""); setStepDueDays("");
    }, "Step added.");
  }

  async function saveStep(event: FormEvent<HTMLFormElement>, step: Step) {
    event.preventDefault();
    await run(async () => {
      await api(`/api/people-flow-steps/${step.id}`, "PUT", { title: step.title, instructions: step.instructions, dueAfterDays: step.dueAfterDays, required: step.required, active: step.active });
    }, "Step saved.");
  }

  async function assignPeople(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFlow || selectedContacts.length === 0) return;
    await run(async () => {
      const result = await api(`/api/people-flows/${selectedFlow.id}/assignments`, "POST", { contactIds: selectedContacts, dueOn: assignmentDueOn || null }) as { created: number; skipped: number };
      setSelectedContacts([]); setAssignmentDueOn("");
      setFeedback(assignmentSummary(language, result.created, result.skipped));
    }, "Assignments updated.");
  }

  async function setStepStatus(assignment: Assignment, step: ProgressStep, status: ProgressStep["status"]) {
    await run(async () => {
      await api(`/api/people-flow-assignments/${assignment.id}/steps/${step.stepId}`, "PUT", { status });
    }, "Step updated.");
  }

  async function setAssignmentStatus(assignment: Assignment, status: Assignment["status"]) {
    await run(async () => {
      await api(`/api/people-flow-assignments/${assignment.id}/status`, "PUT", { status });
    }, "Assignment updated.");
  }

  async function setFlowStatus(status: Flow["status"]) {
    if (!selectedFlow) return;
    await run(async () => {
      await api(`/api/people-flows/${selectedFlow.id}/status`, "PUT", { status });
    }, status === "archived" ? "Workflow archived." : "Workflow activated.");
  }

  return <section className="people-flows-page">
    <header className="people-flows-heading">
      <div><span className="eyebrow">PEOPLE WORKFLOWS</span><h1>People Flows</h1><p>Create follow-up workflows, assign them to people, and track each next step.</p></div>
      <button className="button button-secondary" type="button" onClick={() => void refresh()} disabled={busy}><RefreshCw size={16} />Refresh</button>
    </header>
    {error && <p className="people-flows-alert" role="alert"><CircleAlert size={16} />{error}</p>}
    {feedback && <p className="people-flows-feedback" role="status">{feedback}</p>}
    <div className="people-flows-layout">
      <aside className="people-flows-list">
        <h2>Workflows</h2>
        {flows.length === 0 ? <p className="people-flows-empty">No workflows yet.</p> : flows.map((flow) => <button key={flow.id} className={`people-flows-list-item ${selectedFlowId === flow.id ? "is-selected" : ""}`} type="button" onClick={() => { setSelectedFlowId(flow.id); void loadFlowData(flow.id).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load workflow.")); }}>
          <strong>{flow.name}</strong><span>{flow.stepCount} steps · {flow.activeEnrollmentCount} active</span><small>{flow.status === "archived" ? "Archived" : "Active"}</small>
        </button>)}
        <form className="people-flows-form" onSubmit={(event) => void createFlow(event)}>
          <h3>New workflow</h3>
          <label>Name<input value={newName} onChange={(event) => setNewName(event.target.value)} maxLength={120} required /></label>
          <label>Description<textarea value={newDescription} onChange={(event) => setNewDescription(event.target.value)} maxLength={2000} rows={3} /></label>
          <button className="button button-primary" type="submit" disabled={busy || !newName.trim()}><Plus size={15} />Create workflow</button>
        </form>
      </aside>

      <div className="people-flows-content">
        {!selectedFlow ? <div className="people-flows-empty-state"><Users size={28} /><h2>Start with a workflow</h2><p>Create a workflow to guide follow-up, onboarding, or pastoral next steps.</p></div> : <>
          <form className="people-flows-form people-flows-edit" onSubmit={(event) => void saveFlow(event)}>
            <div className="people-flows-section-heading"><div><h2>Workflow details</h2><p>{selectedFlow.activeEnrollmentCount} people currently assigned</p></div><button className="button button-secondary" type="button" onClick={() => void setFlowStatus(selectedFlow.status === "active" ? "archived" : "active")} disabled={busy}><Archive size={15} />{selectedFlow.status === "active" ? "Archive" : "Reactivate"}</button></div>
            <label>Name<input value={editName} onChange={(event) => setEditName(event.target.value)} maxLength={120} required /></label>
            <label>Description<textarea value={editDescription} onChange={(event) => setEditDescription(event.target.value)} maxLength={2000} rows={3} /></label>
            <button className="button button-primary" type="submit" disabled={busy}><Check size={15} />Save workflow</button>
          </form>

          <section className="people-flows-section">
            <div className="people-flows-section-heading"><div><h2>Steps</h2><p>New assignments receive the currently active steps.</p></div></div>
            {steps.length === 0 ? <p className="people-flows-empty">Add steps to define the workflow.</p> : <div className="people-flows-steps">{steps.map((step) => <form key={step.id} className={`people-flows-step ${step.active ? "" : "is-inactive"}`} onSubmit={(event) => void saveStep(event, step)}>
              <div className="people-flows-step-title"><strong>Step {step.position + 1}</strong><label className="people-flows-toggle"><input type="checkbox" checked={step.active} onChange={(event) => setSteps((current) => current.map((item) => item.id === step.id ? { ...item, active: event.target.checked } : item))} />Active</label></div>
              <label>Title<input value={step.title} onChange={(event) => setSteps((current) => current.map((item) => item.id === step.id ? { ...item, title: event.target.value } : item))} maxLength={160} required /></label>
              <label>Instructions<textarea value={step.instructions} onChange={(event) => setSteps((current) => current.map((item) => item.id === step.id ? { ...item, instructions: event.target.value } : item))} maxLength={4000} rows={2} /></label>
              <div className="people-flows-step-options"><label>Due after days<input type="number" min={0} max={3650} value={step.dueAfterDays ?? ""} onChange={(event) => setSteps((current) => current.map((item) => item.id === step.id ? { ...item, dueAfterDays: event.target.value ? Number(event.target.value) : null } : item))} /></label><label className="people-flows-toggle"><input type="checkbox" checked={step.required} onChange={(event) => setSteps((current) => current.map((item) => item.id === step.id ? { ...item, required: event.target.checked } : item))} />Required to complete</label></div>
              <button className="button button-secondary" type="submit" disabled={busy}>Save step</button>
            </form>)}</div>}
            <form className="people-flows-form people-flows-add-step" onSubmit={(event) => void addStep(event)}>
              <h3>Add a step</h3><label>Title<input value={stepTitle} onChange={(event) => setStepTitle(event.target.value)} maxLength={160} required /></label>
              <label>Instructions<textarea value={stepInstructions} onChange={(event) => setStepInstructions(event.target.value)} maxLength={4000} rows={2} /></label>
              <label>Due after days<input type="number" min={0} max={3650} value={stepDueDays} onChange={(event) => setStepDueDays(event.target.value)} /></label>
              <button className="button button-secondary" type="submit" disabled={busy || !stepTitle.trim()}><Plus size={15} />Add step</button>
            </form>
          </section>

          <section className="people-flows-section">
            <div className="people-flows-section-heading"><div><h2>Assignments</h2><p>Assign a workflow to people at this location.</p></div></div>
            {selectedFlow.status === "active" && <form className="people-flows-form people-flows-assign" onSubmit={(event) => void assignPeople(event)}>
              <label>People<select multiple size={Math.min(Math.max(writableContacts.length, 3), 8)} value={selectedContacts} onChange={(event) => setSelectedContacts(Array.from(event.target.selectedOptions, (option) => option.value))}>{writableContacts.map((person) => <option key={person.id} value={person.id}>{person.firstName} {person.lastName}{person.importedFrom ? ` · ${person.importedFrom}` : ""}</option>)}</select></label>
              <label>Overall due date<input type="date" value={assignmentDueOn} onChange={(event) => setAssignmentDueOn(event.target.value)} /></label>
              <button className="button button-primary" type="submit" disabled={busy || selectedContacts.length === 0}><Users size={15} />Assign selected</button>
            </form>}
            {assignments.length === 0 ? <p className="people-flows-empty">No assignments yet.</p> : <div className="people-flows-assignments">{assignments.map((assignment) => <article className="people-flows-assignment" key={assignment.id}>
              <div className="people-flows-section-heading"><div><h3>{assignment.contactName}</h3><p>{statusLabel(assignment.status)} · {assignment.dueOn ? dueLabel(language, assignment.dueOn) : "No overall due date"}</p></div>
                {assignment.status === "active" ? <button className="button button-secondary" type="button" onClick={() => void setAssignmentStatus(assignment, "completed")} disabled={busy}>Complete workflow</button> : <button className="button button-secondary" type="button" onClick={() => void setAssignmentStatus(assignment, "active")} disabled={busy}>Reopen</button>}
                {assignment.status === "active" && <button className="button button-secondary" type="button" onClick={() => void setAssignmentStatus(assignment, "cancelled")} disabled={busy}>Cancel</button>}
              </div>
              <div className="people-flows-progress">{assignment.steps.map((step) => <div className="people-flows-progress-step" key={step.stepId}><label><input type="checkbox" checked={step.status === "completed"} disabled={busy || assignment.status !== "active"} onChange={(event) => void setStepStatus(assignment, step, event.target.checked ? "completed" : "pending")} /><span><strong>{step.title}</strong><small>{!step.active ? "Archived step" : step.required ? "Required" : "Optional"} · {step.dueOn ? dueLabel(language, step.dueOn) : "No due date"}{step.status === "skipped" ? " · Skipped" : ""}</small></span></label></div>)}</div>
            </article>)}</div>}
          </section>

          <section className="people-flows-section">
            <div className="people-flows-section-heading"><div><h2>Recent activity</h2><p>Audit history records workflow actions, not private notes.</p></div></div>
            {audit.filter((entry) => entry.flowId === selectedFlow.id).slice(0, 20).map((entry) => <div className="people-flows-audit" key={entry.id}><strong>{auditLabel(entry.action)}</strong><span>{new Date(entry.createdAt).toLocaleString(language)}</span></div>)}
            {audit.every((entry) => entry.flowId !== selectedFlow.id) && <p className="people-flows-empty">No workflow activity yet.</p>}
          </section>
        </>}
      </div>
    </div>
  </section>;
}
