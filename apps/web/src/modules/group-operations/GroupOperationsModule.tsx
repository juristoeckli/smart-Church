import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Award, Check, ClipboardCheck, Play, Plus, RotateCcw } from "lucide-react";
import type { ModuleContext } from "../../module-registry";
import "./group-operations.css";

type Group = { id: string; name: string; description: string };
type Routine = { id: string; groupId: string; groupName: string; name: string; description: string; cadence: string; active: boolean };
type Run = { id: string; routineId: string; routineName: string; runDate: string; status: "open" | "completed"; notes: string; assignedContactId: string | null; assignedName: string | null };
type Certificate = { id: string; groupId: string; groupName: string; name: string; description: string; active: boolean };
type Issue = { id: string; certificateId: string; groupId: string; contactId: string; certificateName: string; groupName: string; personName: string; issuedAt: string; validUntil: string | null; notes: string; revokedAt: string | null; revokeReason: string };
type Member = { id: string; firstName: string; lastName: string; email: string | null; role: string };
type Rule = { id: string; groupId: string; groupName: string; name: string; contactStatus: "member" | "visitor"; enabled: boolean };
type Preview = { rule: Rule; matches: Array<{ id: string; firstName: string; lastName: string; email: string | null }>; capped: boolean; applyEnabled: boolean };
type FollowUp = { id: string; groupId: string; groupName: string; contactId: string; personName: string; assignedContactId: string | null; assignedName: string | null; subject: string; note: string; dueDate: string; status: "open" | "completed"; completedAt: string | null };
type FeedbackMeeting = { id: string; date: string; title: string };
type FeedbackQuestion = { id: string; prompt: string };
type FeedbackTemplate = { id: string; title: string; questions: FeedbackQuestion[]; updatedAt: string };
type Section = "routines" | "followups" | "certificates" | "membership" | "feedback";

export function GroupOperationsModule({ departmentId, csrfToken }: ModuleContext) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [feedbackMeetings, setFeedbackMeetings] = useState<FeedbackMeeting[]>([]);
  const [feedbackMeetingId, setFeedbackMeetingId] = useState("");
  const [feedbackTemplate, setFeedbackTemplate] = useState<FeedbackTemplate | null>(null);
  const [feedbackTitle, setFeedbackTitle] = useState("Meeting feedback");
  const [feedbackQuestionDraft, setFeedbackQuestionDraft] = useState("");
  const [feedbackAnswers, setFeedbackAnswers] = useState<Record<string, string>>({});
  const [feedbackUpdatedBy, setFeedbackUpdatedBy] = useState("");
  const [section, setSection] = useState<Section>("routines");
  const [groupId, setGroupId] = useState("");
  const [canManage, setCanManage] = useState(false);
  const [followUpStatus, setFollowUpStatus] = useState<"all" | "open" | "completed">("open");
  const [followUpAssignee, setFollowUpAssignee] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [routineDraft, setRoutineDraft] = useState({ name: "", description: "", cadence: "manual" });
  const [runDraft, setRunDraft] = useState({ routineId: "", runDate: new Date().toISOString().slice(0, 10), assignedContactId: "", notes: "" });
  const [certDraft, setCertDraft] = useState({ name: "", description: "" });
  const [issueDraft, setIssueDraft] = useState({ certificateId: "", contactId: "", issuedAt: new Date().toISOString().slice(0, 10), validUntil: "", notes: "" });
  const [ruleDraft, setRuleDraft] = useState({ name: "", contactStatus: "member" as "member" | "visitor" });
  const [followUpDraft, setFollowUpDraft] = useState({ contactId: "", assignedContactId: "", subject: "", note: "", dueDate: new Date().toISOString().slice(0, 10) });
  const headers = useMemo(() => ({ "x-department-id": departmentId }), [departmentId]);

  const request = useCallback(async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetch(path, { ...init, headers: { ...headers, ...(init.body ? { "content-type": "application/json", "x-csrf-token": csrfToken } : {}), ...init.headers }, cache: "no-store" });
    const data = await response.json() as T | { error?: string };
    if (!response.ok) throw new Error((data as { error?: string }).error ?? "The request could not be completed.");
    return data as T;
  }, [headers, csrfToken]);

  const load = useCallback(async () => {
    setError("");
    try {
      const bootstrap = await request<{ groups: Group[]; canManage: boolean }>("/api/modules/group-operations/bootstrap");
      const [nextRoutines, nextRuns, nextCertificates, nextRules, nextFollowUps] = await Promise.all([
        request<Routine[]>("/api/modules/group-operations/routines"),
        request<Run[]>("/api/modules/group-operations/routine-runs"),
        request<{ definitions: Certificate[]; issues: Issue[] }>("/api/modules/group-operations/certificates"),
        request<Rule[]>("/api/modules/group-operations/membership-rules"),
        bootstrap.canManage ? request<FollowUp[]>("/api/modules/group-operations/follow-ups") : Promise.resolve([] as FollowUp[]),
      ]);
      setGroups(bootstrap.groups); setCanManage(bootstrap.canManage); setRoutines(nextRoutines); setRuns(nextRuns); setCertificates(nextCertificates.definitions); setIssues(nextCertificates.issues); setRules(nextRules); setFollowUps(nextFollowUps);
      setGroupId((current) => bootstrap.groups.some((group) => group.id === current) ? current : bootstrap.groups[0]?.id ?? "");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load group operations."); }
  }, [request]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!groupId) { setMembers([]); return; } void request<Member[]>(`/api/modules/group-operations/members?groupId=${encodeURIComponent(groupId)}`).then(setMembers).catch(() => setMembers([])); }, [request, groupId]);
  const isGroupLeader = canManage || members.some((member) => ["leader", "coleader", "groupowner", "groupmanager"].includes(member.role.toLowerCase().replace(/[^a-z]/g, "")));
  useEffect(() => {
    if (section !== "feedback" || !groupId) return;
    void request<{ meetings: FeedbackMeeting[]; template: FeedbackTemplate | null; response: { answers: Record<string, string>; updatedBy: string } | null }>(`/api/modules/group-operations/meeting-feedback?groupId=${encodeURIComponent(groupId)}${feedbackMeetingId ? `&meetingId=${encodeURIComponent(feedbackMeetingId)}` : ""}`)
      .then((result) => {
        setFeedbackMeetings(result.meetings);
        setFeedbackTemplate(result.template);
        setFeedbackTitle(result.template?.title ?? "Meeting feedback");
        setFeedbackQuestionDraft(result.template?.questions.map((question) => question.prompt).join("\n") ?? "");
        if (!feedbackMeetingId && result.meetings.length) setFeedbackMeetingId(result.meetings[0].id);
        setFeedbackAnswers(result.response?.answers ?? {});
        setFeedbackUpdatedBy(result.response?.updatedBy ?? "");
      }).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load meeting feedback."));
  }, [request, groupId, section, feedbackMeetingId]);

  async function mutate(path: string, method: string, body: object, done: string) {
    setBusy(true); setError(""); setMessage("");
    try { await request(path, { method, body: JSON.stringify(body) }); setMessage(done); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The action could not be completed."); }
    finally { setBusy(false); }
  }
  async function createRoutine(event: FormEvent) { event.preventDefault(); if (!groupId) return; await mutate("/api/modules/group-operations/routines", "POST", { groupId, ...routineDraft }, "Routine created."); setRoutineDraft({ name: "", description: "", cadence: "manual" }); }
  async function createRun(event: FormEvent) { event.preventDefault(); await mutate("/api/modules/group-operations/routine-runs", "POST", { ...runDraft, assignedContactId: runDraft.assignedContactId || null }, "Routine run scheduled."); setRunDraft((value) => ({ ...value, notes: "" })); }
  async function createCertificate(event: FormEvent) { event.preventDefault(); if (!groupId) return; await mutate("/api/modules/group-operations/certificates", "POST", { groupId, ...certDraft }, "Certificate definition created."); setCertDraft({ name: "", description: "" }); }
  async function issueCertificate(event: FormEvent) { event.preventDefault(); const cert = certificates.find((item) => item.id === issueDraft.certificateId); if (!cert) return; if (cert.groupId !== groupId) { setError("Choose a certificate for the selected group."); return; } await mutate("/api/modules/group-operations/certificates/issue", "POST", { ...issueDraft, validUntil: issueDraft.validUntil || null }, "Certificate issued."); }
  async function createRule(event: FormEvent) { event.preventDefault(); if (!groupId) return; await mutate("/api/modules/group-operations/membership-rules", "POST", { groupId, ...ruleDraft }, "Membership rule saved. Preview it before applying."); setRuleDraft({ name: "", contactStatus: "member" }); setPreview(null); }
  async function createFollowUp(event: FormEvent) { event.preventDefault(); if (!groupId) return; await mutate("/api/modules/group-operations/follow-ups", "POST", { groupId, ...followUpDraft, assignedContactId: followUpDraft.assignedContactId || null }, "Follow-up task created."); setFollowUpDraft((current) => ({ ...current, contactId: "", assignedContactId: "", subject: "", note: "" })); }
  async function loadPreview(rule: Rule) { setError(""); setPreview(null); try { setPreview(await request<Preview>(`/api/modules/group-operations/membership-rules/${rule.id}/preview`)); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not preview the rule."); } }
  async function applyRule(rule: Rule) { if (!preview?.applyEnabled || preview.rule.id !== rule.id) return; if (!window.confirm(`Add up to 500 matching people to ${rule.groupName}? This only adds members; it never removes anyone.`)) return; await mutate(`/api/modules/group-operations/membership-rules/${rule.id}/apply`, "POST", {}, "Membership rule applied. No existing memberships were removed."); setPreview(null); }
  async function updateRun(run: Run) { await mutate(`/api/modules/group-operations/routine-runs/${run.id}`, "PATCH", { status: run.status === "open" ? "completed" : "open", notes: run.notes }, run.status === "open" ? "Routine marked complete." : "Routine reopened."); }
  async function revoke(issue: Issue) { const reason = window.prompt("Reason for revoking this certificate?"); if (!reason?.trim()) return; await mutate(`/api/modules/group-operations/certificates/${issue.id}/revoke`, "POST", { reason: reason.trim() }, "Certificate revoked."); }
  async function updateFollowUp(task: FollowUp) { await mutate(`/api/modules/group-operations/follow-ups/${task.id}`, "PATCH", { status: task.status === "open" ? "completed" : "open", note: task.note }, task.status === "open" ? "Follow-up completed." : "Follow-up reopened."); }
  async function saveFeedbackTemplate(event: FormEvent) {
    event.preventDefault();
    const questions = feedbackQuestionDraft.split("\n").map((item) => item.trim()).filter(Boolean);
    if (!groupId || questions.length < 1 || questions.length > 10) { setError("Enter between one and ten feedback prompts."); return; }
    setBusy(true); setError("");
    try {
      const result = await request<FeedbackTemplate>("/api/modules/group-operations/meeting-feedback/template", { method: "PUT", body: JSON.stringify({ groupId, title: feedbackTitle, questions }) });
      setFeedbackTemplate(result); setFeedbackQuestionDraft(result.questions.map((question) => question.prompt).join("\n")); setMessage("Meeting feedback template saved.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save the feedback template."); }
    finally { setBusy(false); }
  }
  async function saveMeetingFeedback(event: FormEvent) {
    event.preventDefault();
    if (!groupId || !feedbackMeetingId || !feedbackTemplate) return;
    setBusy(true); setError("");
    try {
      await request("/api/modules/group-operations/meeting-feedback/responses", { method: "PUT", body: JSON.stringify({ groupId, meetingId: feedbackMeetingId, answers: feedbackAnswers }) });
      setMessage("Meeting feedback saved.");
      const result = await request<{ meetings: FeedbackMeeting[]; template: FeedbackTemplate | null; response: { answers: Record<string, string>; updatedBy: string } | null }>(`/api/modules/group-operations/meeting-feedback?groupId=${encodeURIComponent(groupId)}&meetingId=${encodeURIComponent(feedbackMeetingId)}`);
      setFeedbackUpdatedBy(result.response?.updatedBy ?? "");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save meeting feedback."); }
    finally { setBusy(false); }
  }

  const visibleRoutines = routines.filter((routine) => !groupId || routine.groupId === groupId);
  const visibleRuns = runs.filter((run) => visibleRoutines.some((routine) => routine.id === run.routineId));
  const visibleCertificates = certificates.filter((cert) => !groupId || cert.groupId === groupId);
  const visibleIssues = issues.filter((issue) => !groupId || issue.groupId === groupId);
  const visibleRules = rules.filter((rule) => !groupId || rule.groupId === groupId);
  const visibleFollowUps = followUps.filter((task) => (!groupId || task.groupId === groupId) && (followUpStatus === "all" || task.status === followUpStatus) && (!followUpAssignee || task.assignedContactId === followUpAssignee));

  return <main className="group-operations">
    <header className="go-heading"><div><span className="eyebrow">GROUP MANAGEMENT</span><h1>Group operations</h1><p>Track routines, member follow-ups, certificates, and reviewed membership rules.</p></div><label>Group<select value={groupId} onChange={(event) => { setGroupId(event.target.value); setPreview(null); setFeedbackMeetingId(""); }}><option value="">All groups</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label></header>
    {error && <p className="go-alert" role="alert">{error}</p>}{message && <p className="go-success" role="status">{message}</p>}
    <nav className="go-tabs" aria-label="Group operations">{(["routines", ...(canManage ? ["followups"] as const : []), "certificates", "membership", ...(isGroupLeader ? ["feedback"] as const : [])] as const).map((item) => <button key={item} className={section === item ? "active" : ""} onClick={() => setSection(item)}>{item === "routines" ? <><ClipboardCheck size={16}/> Routines</> : item === "followups" ? <>Follow-ups</> : item === "certificates" ? <><Award size={16}/> Certificates</> : item === "feedback" ? <>Meeting feedback</> : <>Membership rules</>}</button>)}</nav>
    {section === "routines" && <div className="go-layout"><section className="go-panel"><h2>Routine definitions</h2><form onSubmit={(event) => void createRoutine(event)} className="go-form"><label>Name<input required maxLength={120} value={routineDraft.name} onChange={(event) => setRoutineDraft({ ...routineDraft, name: event.target.value })}/></label><label>Description<input maxLength={1000} value={routineDraft.description} onChange={(event) => setRoutineDraft({ ...routineDraft, description: event.target.value })}/></label><label>Cadence<select value={routineDraft.cadence} onChange={(event) => setRoutineDraft({ ...routineDraft, cadence: event.target.value })}><option value="manual">Manual</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annually">Annually</option></select></label><button className="button button-primary" disabled={busy || !groupId}><Plus size={15}/> Add routine</button></form><div className="go-list">{visibleRoutines.map((routine) => <article key={routine.id}><div><strong>{routine.name}</strong><small>{routine.groupName} · {routine.cadence} · {routine.active ? "Active" : "Archived"}</small>{routine.description && <p>{routine.description}</p>}</div><button className="button button-secondary" disabled={busy || !routine.active} onClick={() => { setGroupId(routine.groupId); setRunDraft({ ...runDraft, routineId: routine.id }); }}>Schedule run</button></article>)}</div></section>
      <section className="go-panel"><h2>Schedule a routine run</h2><form onSubmit={(event) => void createRun(event)} className="go-form"><label>Routine<select required value={runDraft.routineId} onChange={(event) => setRunDraft({ ...runDraft, routineId: event.target.value })}><option value="">Choose routine</option>{visibleRoutines.filter((routine) => routine.active).map((routine) => <option key={routine.id} value={routine.id}>{routine.name}</option>)}</select></label><label>Date<input type="date" required value={runDraft.runDate} onChange={(event) => setRunDraft({ ...runDraft, runDate: event.target.value })}/></label><label>Assignee (optional)<select value={runDraft.assignedContactId} onChange={(event) => setRunDraft({ ...runDraft, assignedContactId: event.target.value })}><option value="">Unassigned</option>{members.map((member) => <option key={member.id} value={member.id}>{member.firstName} {member.lastName}</option>)}</select></label><label>Notes<input maxLength={2000} value={runDraft.notes} onChange={(event) => setRunDraft({ ...runDraft, notes: event.target.value })}/></label><button className="button button-primary" disabled={busy || !runDraft.routineId}><Plus size={15}/> Create run</button></form><h3>Recent runs</h3><div className="go-list">{visibleRuns.map((run) => <article key={run.id}><div><strong>{run.routineName}</strong><small>{run.runDate}{run.assignedName ? ` · ${run.assignedName}` : " · Unassigned"} · {run.status}</small>{run.notes && <p>{run.notes}</p>}</div><button className="button button-secondary" disabled={busy} onClick={() => void updateRun(run)}>{run.status === "open" ? <><Check size={14}/> Complete</> : <><RotateCcw size={14}/> Reopen</>}</button></article>)}{!visibleRuns.length && <p className="go-empty">No routine runs yet.</p>}</div></section></div>}
    {section === "followups" && canManage && <div className="go-layout"><section className="go-panel"><h2>Assign a member follow-up</h2><form onSubmit={(event) => void createFollowUp(event)} className="go-form"><label>Member<select required value={followUpDraft.contactId} onChange={(event) => setFollowUpDraft({ ...followUpDraft, contactId: event.target.value })}><option value="">Choose member</option>{members.map((member) => <option key={member.id} value={member.id}>{member.firstName} {member.lastName} · {member.role}</option>)}</select></label><label>Assigned to (optional)<select value={followUpDraft.assignedContactId} onChange={(event) => setFollowUpDraft({ ...followUpDraft, assignedContactId: event.target.value })}><option value="">Unassigned</option>{members.map((member) => <option key={member.id} value={member.id}>{member.firstName} {member.lastName}</option>)}</select></label><label>Subject<input required maxLength={160} value={followUpDraft.subject} onChange={(event) => setFollowUpDraft({ ...followUpDraft, subject: event.target.value })}/></label><label>Due date<input type="date" required value={followUpDraft.dueDate} onChange={(event) => setFollowUpDraft({ ...followUpDraft, dueDate: event.target.value })}/></label><label>Note<input maxLength={2000} value={followUpDraft.note} onChange={(event) => setFollowUpDraft({ ...followUpDraft, note: event.target.value })}/></label><button className="button button-primary" disabled={busy || !groupId || !followUpDraft.contactId || !followUpDraft.subject.trim()}><Plus size={15}/> Create follow-up</button></form></section><section className="go-panel"><div className="go-section-heading"><h2>Member follow-ups</h2><div className="go-followup-filters"><label>Assigned to<select value={followUpAssignee} onChange={(event) => setFollowUpAssignee(event.target.value)}><option value="">Everyone</option>{members.map((member) => <option key={member.id} value={member.id}>{member.firstName} {member.lastName}</option>)}</select></label><label>Status<select value={followUpStatus} onChange={(event) => setFollowUpStatus(event.target.value as typeof followUpStatus)}><option value="open">Open</option><option value="completed">Completed</option><option value="all">All</option></select></label></div></div><div className="go-list">{visibleFollowUps.map((task) => <article key={task.id}><div><strong>{task.subject} · {task.personName}</strong><small>{task.groupName} · Due {task.dueDate}{task.assignedName ? ` · Assigned to ${task.assignedName}` : " · Unassigned"} · {task.status}</small>{task.note && <p>{task.note}</p>}</div><button className="button button-secondary" disabled={busy} onClick={() => void updateFollowUp(task)}>{task.status === "open" ? <><Check size={14}/> Complete</> : <><RotateCcw size={14}/> Reopen</>}</button></article>)}{!visibleFollowUps.length && <p className="go-empty">No follow-ups match this filter.</p>}</div></section></div>}
    {section === "certificates" && <div className="go-layout"><section className="go-panel"><h2>Certificate definitions</h2><form onSubmit={(event) => void createCertificate(event)} className="go-form"><label>Name<input required maxLength={120} value={certDraft.name} onChange={(event) => setCertDraft({ ...certDraft, name: event.target.value })}/></label><label>Description<input maxLength={1000} value={certDraft.description} onChange={(event) => setCertDraft({ ...certDraft, description: event.target.value })}/></label><button className="button button-primary" disabled={busy || !groupId}><Plus size={15}/> Add certificate</button></form><div className="go-list">{visibleCertificates.map((cert) => <article key={cert.id}><div><strong>{cert.name}</strong><small>{cert.groupName} · {cert.active ? "Active" : "Archived"}</small>{cert.description && <p>{cert.description}</p>}</div></article>)}</div></section><section className="go-panel"><h2>Issue to active group member</h2><form onSubmit={(event) => void issueCertificate(event)} className="go-form"><label>Certificate<select required value={issueDraft.certificateId} onChange={(event) => { const id = event.target.value; const cert = certificates.find((item) => item.id === id); setIssueDraft({ ...issueDraft, certificateId: id }); if (cert) setGroupId(cert.groupId); }}><option value="">Choose certificate</option>{visibleCertificates.filter((cert) => cert.active).map((cert) => <option key={cert.id} value={cert.id}>{cert.name}</option>)}</select></label><label>Member<select required value={issueDraft.contactId} onChange={(event) => setIssueDraft({ ...issueDraft, contactId: event.target.value })}><option value="">Choose member</option>{members.map((member) => <option key={member.id} value={member.id}>{member.firstName} {member.lastName}</option>)}</select></label><label>Issue date<input type="date" value={issueDraft.issuedAt} onChange={(event) => setIssueDraft({ ...issueDraft, issuedAt: event.target.value })}/></label><label>Valid until (optional)<input type="date" value={issueDraft.validUntil} onChange={(event) => setIssueDraft({ ...issueDraft, validUntil: event.target.value })}/></label><label>Notes<input maxLength={1000} value={issueDraft.notes} onChange={(event) => setIssueDraft({ ...issueDraft, notes: event.target.value })}/></label><button className="button button-primary" disabled={busy || !issueDraft.certificateId || !issueDraft.contactId}><Award size={15}/> Issue certificate</button></form><h3>Issued records</h3><div className="go-list">{visibleIssues.map((issue) => <article key={issue.id}><div><strong>{issue.certificateName} · {issue.personName}</strong><small>{issue.issuedAt}{issue.validUntil ? ` through ${issue.validUntil}` : " · No expiry"}{issue.revokedAt ? " · Revoked" : ""}</small>{issue.revokeReason && <p>{issue.revokeReason}</p>}</div>{!issue.revokedAt && <button className="button button-secondary" disabled={busy} onClick={() => void revoke(issue)}>Revoke</button>}</article>)}{!visibleIssues.length && <p className="go-empty">No certificates issued yet.</p>}</div></section></div>}
    {section === "membership" && <section className="go-panel"><h2>Reviewed membership rules</h2><p className="go-note">Rules only run when a manager previews and applies them. They add active memberships and never remove existing members. External-sync groups are blocked.</p><form onSubmit={(event) => void createRule(event)} className="go-form go-rule-form"><label>Rule name<input required maxLength={120} value={ruleDraft.name} onChange={(event) => setRuleDraft({ ...ruleDraft, name: event.target.value })}/></label><label>Match people with status<select value={ruleDraft.contactStatus} onChange={(event) => setRuleDraft({ ...ruleDraft, contactStatus: event.target.value as "member" | "visitor" })}><option value="member">Member</option><option value="visitor">Visitor</option></select></label><button className="button button-primary" disabled={busy || !groupId}><Plus size={15}/> Save rule</button></form><div className="go-list">{visibleRules.map((rule) => <article key={rule.id}><div><strong>{rule.name}</strong><small>{rule.groupName} · Contact status: {rule.contactStatus} · {rule.enabled ? "Enabled" : "Disabled"}</small></div><div className="go-actions"><button className="button button-secondary" disabled={busy} onClick={() => void loadPreview(rule)}>Preview matches</button><button className="button button-secondary" disabled={busy} onClick={() => void mutate(`/api/modules/group-operations/membership-rules/${rule.id}`, "PATCH", { enabled: !rule.enabled }, rule.enabled ? "Rule disabled." : "Rule enabled.")}>{rule.enabled ? "Disable" : "Enable"}</button></div></article>)}</div>
      {preview && <aside className="go-preview"><h3>Preview: {preview.rule.name}</h3><p>{preview.matches.length} people matched{preview.capped ? " · list capped at 500" : ""}. This preview did not change any membership.</p><ul>{preview.matches.map((person) => <li key={person.id}>{person.firstName} {person.lastName}{person.email ? ` · ${person.email}` : ""}</li>)}</ul><button className="button button-primary" disabled={busy || !preview.applyEnabled || preview.matches.length === 0} onClick={() => void applyRule(preview.rule)}><Play size={14}/> Apply rule (add only)</button></aside>}</section>}
    {section === "feedback" && isGroupLeader && <div className="go-layout"><section className="go-panel"><h2>Meeting feedback template</h2><p className="go-note">Create prompts that group leaders can answer after each meeting. Existing responses are saved separately for each meeting.</p><form className="go-form" onSubmit={(event) => void saveFeedbackTemplate(event)}><label>Template title<input required maxLength={120} value={feedbackTitle} onChange={(event) => setFeedbackTitle(event.target.value)}/></label><label>Questions (one per line)<textarea required rows={7} maxLength={3000} value={feedbackQuestionDraft} onChange={(event) => setFeedbackQuestionDraft(event.target.value)} placeholder="What went well?&#10;What should we follow up on?"/></label><small>Use one to ten prompts. Each prompt may contain up to 300 characters.</small><button className="button button-primary" disabled={busy || !groupId}><Check size={15}/> Save template</button></form></section><section className="go-panel"><h2>Record meeting feedback</h2><label>Meeting<select value={feedbackMeetingId} onChange={(event) => setFeedbackMeetingId(event.target.value)}><option value="">Choose meeting</option>{feedbackMeetings.map((meeting) => <option key={meeting.id} value={meeting.id}>{meeting.date}{meeting.title ? ` · ${meeting.title}` : ""}</option>)}</select></label>{!feedbackMeetings.length && <p className="go-empty">Create a group meeting before recording feedback.</p>}{feedbackTemplate && feedbackMeetingId && <form className="go-form" onSubmit={(event) => void saveMeetingFeedback(event)}><h3>{feedbackTemplate.title}</h3>{feedbackTemplate.questions.map((question) => <label key={question.id}>{question.prompt}<textarea rows={3} maxLength={2000} value={feedbackAnswers[question.id] ?? ""} onChange={(event) => setFeedbackAnswers((current) => ({ ...current, [question.id]: event.target.value }))}/></label>)}{feedbackUpdatedBy && <small>Last saved by {feedbackUpdatedBy}.</small>}<button className="button button-primary" disabled={busy}><Check size={15}/> Save meeting feedback</button></form>}{!feedbackTemplate && groupId && <p className="go-empty">Save a template before recording feedback for meetings.</p>}</section></div>}
  </main>;
}
