import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Award, Check, Download, ClipboardCheck, Play, Plus, RotateCcw } from "lucide-react";
import type { ModuleContext } from "../../module-registry";
import "./group-operations.css";
import { FollowUpRow, type FollowUp } from "./GroupFollowUpRow";

type Group = { id: string; name: string; description: string };
type Routine = { id: string; groupId: string; groupName: string; name: string; description: string; cadence: string; active: boolean };
type Run = { id: string; routineId: string; routineName: string; runDate: string; status: "open" | "completed"; notes: string; assignedContactId: string | null; assignedName: string | null };
type Certificate = { id: string; groupId: string; groupName: string; name: string; description: string; active: boolean };
type Issue = { id: string; certificateId: string; groupId: string; contactId: string; certificateName: string; groupName: string; personName: string; issuedAt: string; validUntil: string | null; notes: string; revokedAt: string | null; revokeReason: string };
type Member = { id: string; firstName: string; lastName: string; email: string | null; role: string };
type Rule = { id: string; groupId: string; groupName: string; name: string; contactStatus: "member" | "visitor"; enabled: boolean };
type Preview = { rule: Rule; matches: Array<{ id: string; firstName: string; lastName: string; email: string | null }>; capped: boolean; applyEnabled: boolean };
type FeedbackMeeting = { id: string; date: string; title: string; guestCount: number | null; completedAt: string | null };
type LeaderFeedback = { answers: Record<string, string>; updatedBy: string; comment: string; guestCount: number | null };
type FeedbackQuestion = { id: string; prompt: string; required?: boolean };
type FeedbackTemplate = { id: string; title: string; questions: FeedbackQuestion[]; anonymousAttendeeResponses: boolean; updatedAt: string };
type AttendeeFeedback = { meetingDate: string; feedbackOpen: boolean; template: FeedbackTemplate; myResponse: { answers: Record<string, string>; updatedAt: string } | null; responses: Array<{ respondentLabel: string; answers: Record<string, string>; updatedAt: string | null }>; canViewResponses: boolean; canSubmit: boolean };
type Section = "routines" | "followups" | "certificates" | "membership" | "feedback";

function getAnonymousResponseToken(groupId: string, meetingId: string) {
  const key = `smart-church:anonymous-feedback:${groupId}:${meetingId}`;
  let token = sessionStorage.getItem(key);
  if (!token) { token = crypto.randomUUID(); sessionStorage.setItem(key, token); }
  return token;
}

export function GroupOperationsModule(context: ModuleContext) {
  return <GroupOperationsWorkspace key={context.departmentId} {...context} />;
}

function GroupOperationsWorkspace({ departmentId, csrfToken }: ModuleContext) {
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
  const [feedbackRequiredDraft, setFeedbackRequiredDraft] = useState<boolean[]>([]);
  const [anonymousAttendeeResponses, setAnonymousAttendeeResponses] = useState(false);
  const [feedbackAnswers, setFeedbackAnswers] = useState<Record<string, string>>({});
  const [feedbackUpdatedBy, setFeedbackUpdatedBy] = useState("");
  const [meetingComment, setMeetingComment] = useState("");
  const [guestCount, setGuestCount] = useState("");
  const [loadedLeaderScope, setLoadedLeaderScope] = useState("");
  const [reportedCanSubmitFeedback, setCanSubmitFeedback] = useState(false);
  const [canManageFeedback, setCanManageFeedback] = useState(false);
  const [loadedFeedbackGroup, setLoadedFeedbackGroup] = useState("");
  const [attendeeAnswers, setAttendeeAnswers] = useState<Record<string, string>>({});
  const [attendeeResponses, setAttendeeResponses] = useState<AttendeeFeedback["responses"]>([]);
  const [canViewAttendeeResponses, setCanViewAttendeeResponses] = useState(false);
  const [loadedAttendeeScope, setLoadedAttendeeScope] = useState("");
  const [attendeeMeetingDate, setAttendeeMeetingDate] = useState("");
  const [attendeeFeedbackOpen, setAttendeeFeedbackOpen] = useState(false);
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
  const [certDraft, setCertDraft] = useState({ name: "", description: "", documentText: "" });
  const [issueDraft, setIssueDraft] = useState({ certificateId: "", contactId: "", issuedAt: new Date().toISOString().slice(0, 10), validUntil: "", notes: "" });
  const [ruleDraft, setRuleDraft] = useState({ name: "", contactStatus: "member" as "member" | "visitor" });
  const [followUpDraft, setFollowUpDraft] = useState({ contactId: "", assignedContactId: "", subject: "", note: "", dueDate: new Date().toISOString().slice(0, 10) });
  const feedbackGroupScope = departmentId + ":" + groupId;
  const leaderScope = feedbackGroupScope + ":" + feedbackMeetingId;
  const currentLeaderScope = useRef(leaderScope);
  currentLeaderScope.current = leaderScope;
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
        request<FollowUp[]>("/api/modules/group-operations/follow-ups"),
      ]);
      setGroups(bootstrap.groups); setCanManage(bootstrap.canManage); setRoutines(nextRoutines); setRuns(nextRuns); setCertificates(nextCertificates.definitions); setIssues(nextCertificates.issues); setRules(nextRules); setFollowUps(nextFollowUps);
      setGroupId((current) => bootstrap.groups.some((group) => group.id === current) ? current : bootstrap.groups[0]?.id ?? "");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load group operations."); }
  }, [request]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!groupId) { setMembers([]); return; } void request<Member[]>(`/api/modules/group-operations/members?groupId=${encodeURIComponent(groupId)}`).then(setMembers).catch(() => setMembers([])); }, [request, groupId]);
  useEffect(() => {
    setCanSubmitFeedback(false);
    setCanManageFeedback(false);
    setLoadedFeedbackGroup("");
    setFeedbackMeetingId("");
    setFeedbackMeetings([]);
    setFeedbackTemplate(null);
    setLoadedLeaderScope("");
    if (!groupId) return;
    const controller = new AbortController();
    void request<{ canSubmitFeedback: boolean; canManageFeedback: boolean }>(
      `/api/modules/group-operations/meeting-feedback/eligibility?groupId=${encodeURIComponent(groupId)}`, { signal: controller.signal },
    ).then((result) => {
      if (controller.signal.aborted) return;
      setCanSubmitFeedback(result.canSubmitFeedback);
      setCanManageFeedback(result.canManageFeedback);
      setLoadedFeedbackGroup(feedbackGroupScope);
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not check meeting feedback access.");
    });
    return () => controller.abort();
  }, [request, groupId, feedbackGroupScope]);
  const feedbackAccessReady = loadedFeedbackGroup === feedbackGroupScope;
  const isGroupLeader = feedbackAccessReady && canManageFeedback;
  const canSubmitFeedback = feedbackAccessReady && reportedCanSubmitFeedback;
  useEffect(() => {
    if (section !== "feedback" || !groupId || !feedbackAccessReady || (!canManageFeedback && !canSubmitFeedback)) return;
    const controller = new AbortController();
    void request<{ meetings: FeedbackMeeting[]; template: FeedbackTemplate | null; response: LeaderFeedback | null; canSubmitFeedback: boolean }>(
      `/api/modules/group-operations/meeting-feedback?groupId=${encodeURIComponent(groupId)}${feedbackMeetingId ? `&meetingId=${encodeURIComponent(feedbackMeetingId)}` : ""}`,
      { signal: controller.signal },
    ).then((result) => {
      if (controller.signal.aborted) return;
      setFeedbackMeetings(result.meetings);
      setFeedbackTemplate(result.template);
      setCanSubmitFeedback(result.canSubmitFeedback);
      setFeedbackTitle(result.template?.title ?? "Meeting feedback");
      setFeedbackQuestionDraft(result.template?.questions.map((question) => question.prompt).join("\n") ?? "");
      setFeedbackRequiredDraft(result.template?.questions.map((question) => Boolean(question.required)) ?? []);
      setAnonymousAttendeeResponses(result.template?.anonymousAttendeeResponses ?? false);
      if (!feedbackMeetingId && result.meetings.length) setFeedbackMeetingId(result.meetings[0].id);
      const activeQuestionIds = new Set(result.template?.questions.map((question) => question.id) ?? []);
      setFeedbackAnswers(Object.fromEntries(Object.entries(result.response?.answers ?? {}).filter(([questionId]) => activeQuestionIds.has(questionId))));
      setFeedbackUpdatedBy(result.response?.updatedBy ?? "");
      setMeetingComment(result.response?.comment ?? "");
      setGuestCount(result.response?.guestCount == null ? "" : String(result.response.guestCount));
      setLoadedLeaderScope(leaderScope);
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load meeting feedback.");
    });
    return () => controller.abort();
  }, [request, groupId, section, feedbackMeetingId, feedbackAccessReady, canManageFeedback, canSubmitFeedback, leaderScope]);
  useEffect(() => {
    if (section !== "feedback" || !groupId || !feedbackMeetingId || !feedbackTemplate || !feedbackAccessReady || (!canSubmitFeedback && !isGroupLeader)) { setAttendeeAnswers({}); setAttendeeResponses([]); setCanViewAttendeeResponses(false); setAttendeeMeetingDate(""); setAttendeeFeedbackOpen(false); return; }
    const controller = new AbortController();
    setLoadedAttendeeScope("");
    setAttendeeAnswers({}); setCanViewAttendeeResponses(false);
    const responseHeaders = feedbackTemplate?.anonymousAttendeeResponses ? { "x-feedback-response-token": getAnonymousResponseToken(groupId, feedbackMeetingId) } : undefined;
    void request<AttendeeFeedback>(`/api/modules/group-operations/meeting-feedback/attendees?groupId=${encodeURIComponent(groupId)}&meetingId=${encodeURIComponent(feedbackMeetingId)}`, { headers: responseHeaders, signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        const questionIds = new Set(result.template.questions.map((question) => question.id));
        const currentAnswers = Object.fromEntries(Object.entries(result.myResponse?.answers ?? {}).filter(([questionId]) => questionIds.has(questionId)));
        setAttendeeAnswers(currentAnswers); setAttendeeResponses(result.responses); setCanViewAttendeeResponses(result.canViewResponses); setAttendeeMeetingDate(result.meetingDate); setAttendeeFeedbackOpen(result.feedbackOpen);
        setLoadedAttendeeScope(leaderScope);
      })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load attendee feedback."); });
    return () => controller.abort();
  }, [request, groupId, section, feedbackMeetingId, feedbackAccessReady, canSubmitFeedback, isGroupLeader, feedbackTemplate?.id, feedbackTemplate?.anonymousAttendeeResponses, leaderScope]);

  async function mutate(path: string, method: string, body: object, done: string) {
    setBusy(true); setError(""); setMessage("");
    try { await request(path, { method, body: JSON.stringify(body) }); setMessage(done); await load(); return true; }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The action could not be completed."); }
    finally { setBusy(false); }
  }
  async function createRoutine(event: FormEvent) { event.preventDefault(); if (!groupId) return; await mutate("/api/modules/group-operations/routines", "POST", { groupId, ...routineDraft }, "Routine created."); setRoutineDraft({ name: "", description: "", cadence: "manual" }); }
  async function createRun(event: FormEvent) { event.preventDefault(); await mutate("/api/modules/group-operations/routine-runs", "POST", { ...runDraft, assignedContactId: runDraft.assignedContactId || null }, "Routine run scheduled."); setRunDraft((value) => ({ ...value, notes: "" })); }
  async function createCertificate(event: FormEvent) { event.preventDefault(); if (!groupId) return; if (await mutate("/api/modules/group-operations/certificates", "POST", { groupId, ...certDraft }, "Certificate definition created.")) setCertDraft({ name: "", description: "", documentText: "" }); }
  async function issueCertificate(event: FormEvent) { event.preventDefault(); const cert = certificates.find((item) => item.id === issueDraft.certificateId); if (!cert) return; if (cert.groupId !== groupId) { setError("Choose a certificate for the selected group."); return; } await mutate("/api/modules/group-operations/certificates/issue", "POST", { ...issueDraft, validUntil: issueDraft.validUntil || null }, "Certificate issued."); }
  async function createRule(event: FormEvent) { event.preventDefault(); if (!groupId) return; await mutate("/api/modules/group-operations/membership-rules", "POST", { groupId, ...ruleDraft }, "Membership rule saved. Preview it before applying."); setRuleDraft({ name: "", contactStatus: "member" }); setPreview(null); }
  async function createFollowUp(event: FormEvent) { event.preventDefault(); if (!groupId) return; await mutate("/api/modules/group-operations/follow-ups", "POST", { groupId, ...followUpDraft, assignedContactId: followUpDraft.assignedContactId || null }, "Follow-up task created."); setFollowUpDraft((current) => ({ ...current, contactId: "", assignedContactId: "", subject: "", note: "" })); }
  async function loadPreview(rule: Rule) { setError(""); setPreview(null); try { setPreview(await request<Preview>(`/api/modules/group-operations/membership-rules/${rule.id}/preview`)); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not preview the rule."); } }
  async function applyRule(rule: Rule) { if (!preview?.applyEnabled || preview.rule.id !== rule.id) return; if (!window.confirm(`Add up to 500 matching people to ${rule.groupName}? This only adds members; it never removes anyone.`)) return; await mutate(`/api/modules/group-operations/membership-rules/${rule.id}/apply`, "POST", {}, "Membership rule applied. No existing memberships were removed."); setPreview(null); }
  async function updateRun(run: Run) { await mutate(`/api/modules/group-operations/routine-runs/${run.id}`, "PATCH", { status: run.status === "open" ? "completed" : "open", notes: run.notes }, run.status === "open" ? "Routine marked complete." : "Routine reopened."); }
  async function importCertificateTemplate(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      if (file.size > 16 * 1024) throw new Error("The certificate JSON must be 16 KiB or smaller.");
      let parsed: unknown;
      try { parsed = JSON.parse(await file.text()); }
      catch { throw new Error("The certificate template is not valid JSON."); }
      const template = await request<typeof certDraft>("/api/modules/group-operations/certificates/templates/preview",
        { method: "POST", body: JSON.stringify(parsed) });
      setCertDraft(template);
      setMessage("Template loaded into the editor. Review it and save it to the selected group.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not read the certificate template."); }
    finally { setBusy(false); }
  }

  async function exportCertificateTemplate(certificateId: string) {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const template = await request<unknown>(`/api/modules/group-operations/certificates/${certificateId}/template`);
      const data = new Blob([JSON.stringify(template, null, 2) + "\n"], { type: "application/json" });
      const url = URL.createObjectURL(data);
      const link = document.createElement("a");
      try { link.href = url; link.download = "group-certificate-template.json"; link.click(); }
      finally { URL.revokeObjectURL(url); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not export the certificate template."); }
    finally { setBusy(false); }
  }

  async function downloadCertificate(issue: Issue, format: "pdf" | "print") {
    if (busy || issue.revokedAt) return;
    const preview = format === "print" ? window.open("about:blank", "_blank") : null;
    if (format === "print" && !preview) { setError("Allow the certificate print view to open in a new tab."); return; }
    if (preview) preview.opener = null;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/modules/group-operations/certificates/issues/${encodeURIComponent(issue.id)}/document?format=${format}`, { headers, cache: "no-store" });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(result?.error ?? "Could not open the certificate.");
      }
      const objectUrl = URL.createObjectURL(await response.blob());
      if (preview) {
        preview.location.replace(objectUrl);
      } else {
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = "group-certificate-" + issue.id + ".pdf";
        link.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    } catch (reason) {
      preview?.close();
      setError(reason instanceof Error ? reason.message : "Could not open the certificate.");
    } finally { setBusy(false); }
  }

  async function revoke(issue: Issue) { const reason = window.prompt("Reason for revoking this certificate?"); if (!reason?.trim()) return; await mutate(`/api/modules/group-operations/certificates/${issue.id}/revoke`, "POST", { reason: reason.trim() }, "Certificate revoked."); }
  async function updateFollowUp(task: FollowUp) {
    await mutate(`/api/modules/group-operations/follow-ups/${task.id}`, "PATCH", { status: task.status === "open" ? "completed" : "open" },
      task.status === "open" ? "Follow-up completed." : "Follow-up reopened.");
  }

  async function refreshFollowUps() {
    if (busy) return;
    setBusy(true);
    setError("");
    try { setFollowUps(await request<FollowUp[]>("/api/modules/group-operations/follow-ups")); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not refresh follow-ups."); }
    finally { setBusy(false); }
  }

  async function rescheduleFollowUp(task: FollowUp, dueDate: string) {
    if (busy) return false;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await request(`/api/modules/group-operations/follow-ups/${task.id}`, {
        method: "PATCH", body: JSON.stringify({ dueDate, expectedDueDate: task.dueDate }),
      });
      setMessage("Follow-up rescheduled.");
      setFollowUps(await request<FollowUp[]>("/api/modules/group-operations/follow-ups"));
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not reschedule this follow-up.");
      return false;
    } finally { setBusy(false); }
  }
  async function saveFeedbackTemplate(event: FormEvent) {
    event.preventDefault();
    const questions = feedbackQuestionDraft.split("\n").map((prompt, index) => ({ prompt: prompt.trim(), required: feedbackRequiredDraft[index] ?? false })).filter((question) => question.prompt);
    if (!groupId || questions.length < 1 || questions.length > 10) { setError("Enter between one and ten feedback prompts."); return; }
    setBusy(true); setError("");
    try {
      const result = await request<FeedbackTemplate>("/api/modules/group-operations/meeting-feedback/template", { method: "PUT", body: JSON.stringify({ groupId, title: feedbackTitle, questions, anonymousAttendeeResponses }) });
      const questionIds = new Set(result.questions.map((question) => question.id));
      setFeedbackAnswers((current) => Object.fromEntries(Object.entries(current).filter(([questionId]) => questionIds.has(questionId))));
      setAttendeeAnswers((current) => Object.fromEntries(Object.entries(current).filter(([questionId]) => questionIds.has(questionId))));
      setFeedbackTemplate(result); setFeedbackQuestionDraft(result.questions.map((question) => question.prompt).join("\n")); setFeedbackRequiredDraft(result.questions.map((question) => Boolean(question.required))); setMessage("Meeting feedback template saved.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save the feedback template."); }
    finally { setBusy(false); }
  }
  const feedbackCompleted = Boolean(feedbackMeetings.find((meeting) => meeting.id === feedbackMeetingId)?.completedAt);
  async function saveMeetingFeedback(event: FormEvent) {
    event.preventDefault();
    if (!groupId || !feedbackMeetingId || !isGroupLeader || loadedLeaderScope !== leaderScope || feedbackCompleted || busy) return;
    setBusy(true); setError("");
    try {
      await request("/api/modules/group-operations/meeting-feedback/responses", { method: "PUT", body: JSON.stringify({ groupId, meetingId: feedbackMeetingId, answers: feedbackAnswers, comment: meetingComment, guestCount: guestCount === "" ? null : Number(guestCount) }) });
      const result = await request<{ meetings: FeedbackMeeting[]; template: FeedbackTemplate | null; response: LeaderFeedback | null }>(`/api/modules/group-operations/meeting-feedback?groupId=${encodeURIComponent(groupId)}&meetingId=${encodeURIComponent(feedbackMeetingId)}`);
      if (currentLeaderScope.current !== leaderScope) return;
      setMessage("Meeting feedback saved.");
      setFeedbackMeetings(result.meetings);
      setFeedbackUpdatedBy(result.response?.updatedBy ?? "");
    } catch (reason) {
      if (currentLeaderScope.current === leaderScope) setError(reason instanceof Error ? reason.message : "Could not save meeting feedback.");
    }
    finally { setBusy(false); }
  }
  async function exportMeetingFeedback() {
    if (!groupId) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/modules/group-operations/meeting-feedback/export?groupId=${encodeURIComponent(groupId)}`, { headers, cache: "no-store" });
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(data?.error ?? "Could not export meeting feedback.");
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `group-meeting-feedback-${groupId}.csv`; anchor.click(); URL.revokeObjectURL(url);
      setMessage("Meeting feedback exported.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not export meeting feedback."); }
    finally { setBusy(false); }
  }
  async function saveAttendeeFeedback(event: FormEvent) {
    event.preventDefault();
    if (!groupId || !feedbackMeetingId) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const responseToken = feedbackTemplate?.anonymousAttendeeResponses ? getAnonymousResponseToken(groupId, feedbackMeetingId) : undefined;
      await request("/api/modules/group-operations/meeting-feedback/attendees", { method: "PUT", body: JSON.stringify({ groupId, meetingId: feedbackMeetingId, answers: attendeeAnswers, ...(responseToken ? { responseToken } : {}) }) });
      const responseHeaders = feedbackTemplate?.anonymousAttendeeResponses && responseToken ? { "x-feedback-response-token": responseToken } : undefined;
      const result = await request<AttendeeFeedback>(`/api/modules/group-operations/meeting-feedback/attendees?groupId=${encodeURIComponent(groupId)}&meetingId=${encodeURIComponent(feedbackMeetingId)}`, { headers: responseHeaders });
      const questionIds = new Set(result.template.questions.map((question) => question.id));
      setAttendeeAnswers(Object.fromEntries(Object.entries(result.myResponse?.answers ?? {}).filter(([questionId]) => questionIds.has(questionId))));
      setAttendeeResponses(result.responses); setCanViewAttendeeResponses(result.canViewResponses); setAttendeeMeetingDate(result.meetingDate); setAttendeeFeedbackOpen(result.feedbackOpen);
      setMessage("Your meeting feedback was saved.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save your meeting feedback."); }
    finally { setBusy(false); }
  }

  const visibleRoutines = routines.filter((routine) => !groupId || routine.groupId === groupId);
  const visibleRuns = runs.filter((run) => visibleRoutines.some((routine) => routine.id === run.routineId));
  const visibleCertificates = certificates.filter((cert) => !groupId || cert.groupId === groupId);
  const visibleIssues = canManage ? issues.filter((issue) => !groupId || issue.groupId === groupId) : issues;
  const visibleRules = rules.filter((rule) => !groupId || rule.groupId === groupId);
  const scopedFollowUps = followUps.filter((task) => !canManage || ((!groupId || task.groupId === groupId) && (!followUpAssignee || task.assignedContactId === followUpAssignee)));
  const visibleFollowUps = scopedFollowUps.filter((task) => followUpStatus === "all" || task.status === followUpStatus);
  const dueFollowUps = scopedFollowUps.filter((task) => task.dueState === "due").length;
  const overdueFollowUps = scopedFollowUps.filter((task) => task.dueState === "overdue").length;

  return <main className="group-operations">
    <header className="go-heading"><div><span className="eyebrow">GROUP MANAGEMENT</span><h1>Group operations</h1><p>Track routines, member follow-ups, certificates, and reviewed membership rules.</p></div><label>Group<select value={groupId} onChange={(event) => { setGroupId(event.target.value); setPreview(null); setFeedbackMeetingId(""); }}><option value="">All groups</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label></header>
    {error && <p className="go-alert" role="alert">{error}</p>}{message && <p className="go-success" role="status">{message}</p>}
    <nav className="go-tabs" aria-label="Group operations">{(["routines", "followups", "certificates", "membership", ...(groupId && (isGroupLeader || canSubmitFeedback) ? ["feedback"] as const : [])] as const).map((item) => <button key={item} className={section === item ? "active" : ""} onClick={() => setSection(item)}>{item === "routines" ? <><ClipboardCheck size={16}/> Routines</> : item === "followups" ? <>{canManage ? "Follow-ups" : "My follow-ups"}</> : item === "certificates" ? <><Award size={16}/> Certificates</> : item === "feedback" ? <>Meeting feedback</> : <>Membership rules</>}</button>)}</nav>
    {section === "routines" && <div className="go-layout"><section className="go-panel"><h2>Routine definitions</h2><form onSubmit={(event) => void createRoutine(event)} className="go-form"><label>Name<input required maxLength={120} value={routineDraft.name} onChange={(event) => setRoutineDraft({ ...routineDraft, name: event.target.value })}/></label><label>Description<input maxLength={1000} value={routineDraft.description} onChange={(event) => setRoutineDraft({ ...routineDraft, description: event.target.value })}/></label><label>Cadence<select value={routineDraft.cadence} onChange={(event) => setRoutineDraft({ ...routineDraft, cadence: event.target.value })}><option value="manual">Manual</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annually">Annually</option></select></label><button className="button button-primary" disabled={busy || !groupId}><Plus size={15}/> Add routine</button></form><div className="go-list">{visibleRoutines.map((routine) => <article key={routine.id}><div><strong>{routine.name}</strong><small>{routine.groupName} · {routine.cadence} · {routine.active ? "Active" : "Archived"}</small>{routine.description && <p>{routine.description}</p>}</div><button className="button button-secondary" disabled={busy || !routine.active} onClick={() => { setGroupId(routine.groupId); setRunDraft({ ...runDraft, routineId: routine.id }); }}>Schedule run</button></article>)}</div></section>
      <section className="go-panel"><h2>Schedule a routine run</h2><form onSubmit={(event) => void createRun(event)} className="go-form"><label>Routine<select required value={runDraft.routineId} onChange={(event) => setRunDraft({ ...runDraft, routineId: event.target.value })}><option value="">Choose routine</option>{visibleRoutines.filter((routine) => routine.active).map((routine) => <option key={routine.id} value={routine.id}>{routine.name}</option>)}</select></label><label>Date<input type="date" required value={runDraft.runDate} onChange={(event) => setRunDraft({ ...runDraft, runDate: event.target.value })}/></label><label>Assignee (optional)<select value={runDraft.assignedContactId} onChange={(event) => setRunDraft({ ...runDraft, assignedContactId: event.target.value })}><option value="">Unassigned</option>{members.map((member) => <option key={member.id} value={member.id}>{member.firstName} {member.lastName}</option>)}</select></label><label>Notes<input maxLength={2000} value={runDraft.notes} onChange={(event) => setRunDraft({ ...runDraft, notes: event.target.value })}/></label><button className="button button-primary" disabled={busy || !runDraft.routineId}><Plus size={15}/> Create run</button></form><h3>Recent runs</h3><div className="go-list">{visibleRuns.map((run) => <article key={run.id}><div><strong>{run.routineName}</strong><small>{run.runDate}{run.assignedName ? ` · ${run.assignedName}` : " · Unassigned"} · {run.status}</small>{run.notes && <p>{run.notes}</p>}</div><button className="button button-secondary" disabled={busy} onClick={() => void updateRun(run)}>{run.status === "open" ? <><Check size={14}/> Complete</> : <><RotateCcw size={14}/> Reopen</>}</button></article>)}{!visibleRuns.length && <p className="go-empty">No routine runs yet.</p>}</div></section></div>}
    {section === "followups" && <div className="go-layout">{canManage && <section className="go-panel"><h2>Assign a member follow-up</h2><form onSubmit={(event) => void createFollowUp(event)} className="go-form"><label>Member<select required value={followUpDraft.contactId} onChange={(event) => setFollowUpDraft({ ...followUpDraft, contactId: event.target.value })}><option value="">Choose member</option>{members.map((member) => <option key={member.id} value={member.id}>{member.firstName} {member.lastName} · {member.role}</option>)}</select></label><label>Assigned to (optional)<select value={followUpDraft.assignedContactId} onChange={(event) => setFollowUpDraft({ ...followUpDraft, assignedContactId: event.target.value })}><option value="">Unassigned</option>{members.map((member) => <option key={member.id} value={member.id}>{member.firstName} {member.lastName}</option>)}</select></label><label>Subject<input required maxLength={160} value={followUpDraft.subject} onChange={(event) => setFollowUpDraft({ ...followUpDraft, subject: event.target.value })}/></label><label>Due date<input type="date" required value={followUpDraft.dueDate} onChange={(event) => setFollowUpDraft({ ...followUpDraft, dueDate: event.target.value })}/></label><label>Private manager note<input maxLength={2000} value={followUpDraft.note} onChange={(event) => setFollowUpDraft({ ...followUpDraft, note: event.target.value })}/></label><button className="button button-primary" disabled={busy || !groupId || !followUpDraft.contactId || !followUpDraft.subject.trim()}><Plus size={15}/> Create follow-up</button></form></section>}<section className="go-panel"><div className="go-section-heading"><h2>{canManage ? "Member follow-ups" : "My follow-ups"}</h2><div className="go-followup-filters">{canManage && <label>Assigned to<select value={followUpAssignee} onChange={(event) => setFollowUpAssignee(event.target.value)}><option value="">Everyone</option>{members.map((member) => <option key={member.id} value={member.id}>{member.firstName} {member.lastName}</option>)}</select></label>}<label>Status<select value={followUpStatus} onChange={(event) => setFollowUpStatus(event.target.value as typeof followUpStatus)}><option value="open">Open</option><option value="completed">Completed</option><option value="all">All</option></select></label></div></div><div className="go-section-heading"><p role="status">{dueFollowUps} due today · {overdueFollowUps} overdue</p>
        <button className="button button-secondary" type="button" disabled={busy} onClick={() => void refreshFollowUps()}>Refresh</button>
      </div>
      <div className="go-list">{visibleFollowUps.map((task) => <FollowUpRow key={task.id + ":" + task.dueDate + ":" + task.status}
        task={task} busy={busy} onStatus={updateFollowUp} onReschedule={rescheduleFollowUp} />)}{!visibleFollowUps.length && <p className="go-empty">No follow-ups match this filter.</p>}</div></section></div>}
    {section === "certificates" && <div className="go-layout">
      {canManage && <section className="go-panel">
        <h2>Certificate definitions</h2>
        <label>Load a Smart-Church certificate template
          <input type="file" accept=".json,application/json" disabled={busy || !groupId} onChange={event => void importCertificateTemplate(event)} />
        </label>
        <form onSubmit={(event) => void createCertificate(event)} className="go-form">
          <label>Name<input required maxLength={120} value={certDraft.name} onChange={(event) => setCertDraft({ ...certDraft, name: event.target.value })} /></label>
          <label>Internal description<input maxLength={1000} value={certDraft.description} onChange={(event) => setCertDraft({ ...certDraft, description: event.target.value })} /></label>
          <label>Document text<textarea rows={3} maxLength={1000} value={certDraft.documentText} onChange={(event) => setCertDraft({ ...certDraft, documentText: event.target.value })} /></label>
          <small>Available placeholders: {"{{recipient}}, {{certificate}}, {{group}}, {{location}}, {{issuedOn}}, {{validUntil}}"}</small>
          <button className="button button-primary" disabled={busy || !groupId || !certDraft.name.trim()}><Plus size={15}/> Add certificate</button>
        </form>
        <div className="go-list">{visibleCertificates.map((cert) => <article key={cert.id}><div>
          <strong>{cert.name}</strong><small>{cert.groupName} · {cert.active ? "Active" : "Archived"}</small>{cert.description && <p>{cert.description}</p>}
        </div><button type="button" className="button button-secondary" disabled={busy}
          onClick={() => void exportCertificateTemplate(cert.id)} aria-label={`Export template for ${cert.name}`}>Export JSON</button></article>)}</div>
      </section>}
      <section className="go-panel">
        {canManage && <>
          <h2>Issue to active group member</h2>
          <form onSubmit={(event) => void issueCertificate(event)} className="go-form">
            <label>Certificate<select required value={issueDraft.certificateId} onChange={(event) => setIssueDraft({ ...issueDraft, certificateId: event.target.value })}>
              <option value="">Choose certificate</option>{visibleCertificates.filter((cert) => cert.active).map((cert) => <option key={cert.id} value={cert.id}>{cert.name}</option>)}
            </select></label>
            <label>Member<select required value={issueDraft.contactId} onChange={(event) => setIssueDraft({ ...issueDraft, contactId: event.target.value })}>
              <option value="">Choose member</option>{members.map((member) => <option key={member.id} value={member.id}>{member.firstName} {member.lastName}</option>)}
            </select></label>
            <label>Issue date<input type="date" value={issueDraft.issuedAt} onChange={(event) => setIssueDraft({ ...issueDraft, issuedAt: event.target.value })} /></label>
            <label>Valid until (optional)<input type="date" min={issueDraft.issuedAt || undefined} value={issueDraft.validUntil} onChange={(event) => setIssueDraft({ ...issueDraft, validUntil: event.target.value })} /></label>
            <label>Private issue notes<input maxLength={1000} value={issueDraft.notes} onChange={(event) => setIssueDraft({ ...issueDraft, notes: event.target.value })} /></label>
            <button className="button button-primary" disabled={busy || !issueDraft.certificateId || !issueDraft.contactId}><Award size={15}/> Issue certificate</button>
          </form>
        </>}
        <h2>{canManage ? "Issued certificates" : "My certificates"}</h2>
        <div className="go-list">{visibleIssues.map((issue) => <article key={issue.id}>
          <div>
            <strong>{issue.certificateName} · {issue.personName}</strong>
            <small>{issue.groupName} · {issue.issuedAt}{issue.validUntil ? ` through ${issue.validUntil}` : " · No expiry"}{issue.revokedAt ? " · Revoked" : ""}</small>
            {issue.revokeReason && <p>{issue.revokeReason}</p>}
          </div>
          {!issue.revokedAt && <div className="go-actions">
            <button type="button" className="button button-secondary" disabled={busy} onClick={() => void downloadCertificate(issue, "pdf")}><Download size={14}/> Download PDF</button>
            <button type="button" className="button button-secondary" disabled={busy} onClick={() => void downloadCertificate(issue, "print")}>Print view</button>
            {canManage && <button type="button" className="button button-secondary" disabled={busy} onClick={() => void revoke(issue)}>Revoke</button>}
          </div>}
        </article>)}{!visibleIssues.length && <p className="go-empty">No certificates issued yet.</p>}</div>
      </section>
    </div>}
    {section === "membership" && <section className="go-panel"><h2>Reviewed membership rules</h2><p className="go-note">Rules only run when a manager previews and applies them. They add active memberships and never remove existing members. External-sync groups are blocked.</p><form onSubmit={(event) => void createRule(event)} className="go-form go-rule-form"><label>Rule name<input required maxLength={120} value={ruleDraft.name} onChange={(event) => setRuleDraft({ ...ruleDraft, name: event.target.value })}/></label><label>Match people with status<select value={ruleDraft.contactStatus} onChange={(event) => setRuleDraft({ ...ruleDraft, contactStatus: event.target.value as "member" | "visitor" })}><option value="member">Member</option><option value="visitor">Visitor</option></select></label><button className="button button-primary" disabled={busy || !groupId}><Plus size={15}/> Save rule</button></form><div className="go-list">{visibleRules.map((rule) => <article key={rule.id}><div><strong>{rule.name}</strong><small>{rule.groupName} · Contact status: {rule.contactStatus} · {rule.enabled ? "Enabled" : "Disabled"}</small></div><div className="go-actions"><button className="button button-secondary" disabled={busy} onClick={() => void loadPreview(rule)}>Preview matches</button><button className="button button-secondary" disabled={busy} onClick={() => void mutate(`/api/modules/group-operations/membership-rules/${rule.id}`, "PATCH", { enabled: !rule.enabled }, rule.enabled ? "Rule disabled." : "Rule enabled.")}>{rule.enabled ? "Disable" : "Enable"}</button></div></article>)}</div>
      {preview && <aside className="go-preview"><h3>Preview: {preview.rule.name}</h3><p>{preview.matches.length} people matched{preview.capped ? " · list capped at 500" : ""}. This preview did not change any membership.</p><ul>{preview.matches.map((person) => <li key={person.id}>{person.firstName} {person.lastName}{person.email ? ` · ${person.email}` : ""}</li>)}</ul><button className="button button-primary" disabled={busy || !preview.applyEnabled || preview.matches.length === 0} onClick={() => void applyRule(preview.rule)}><Play size={14}/> Apply rule (add only)</button></aside>}</section>}
    {section === "feedback" && (isGroupLeader || canSubmitFeedback) && <div className="go-feedback-workspace">
      {isGroupLeader && <div className="go-layout">
        <section className="go-panel">
          <h2>Meeting feedback template</h2>
          <p className="go-note">Create prompts that leaders and attendees can answer after each meeting. Attendee feedback is identified by default; anonymous answers omit member and account IDs from stored responses and exports.</p>
          <form className="go-form" onSubmit={(event) => void saveFeedbackTemplate(event)}>
            <label>Template title<input required maxLength={120} value={feedbackTitle} onChange={(event) => setFeedbackTitle(event.target.value)} /></label>
            <label>Questions (one per line)<textarea required rows={7} maxLength={3000} value={feedbackQuestionDraft} onChange={(event) => setFeedbackQuestionDraft(event.target.value)} placeholder="What went well?&#10;What should we follow up on?" /></label>
            {feedbackQuestionDraft.split("\n").map((prompt, index) => prompt.trim() ? <label className="go-checkbox-label" key={`required-${index}`}><input type="checkbox" checked={feedbackRequiredDraft[index] ?? false} onChange={(event) => setFeedbackRequiredDraft((current) => { const next = [...current]; next[index] = event.target.checked; return next; })} /> Require answer to question {index + 1}</label> : null)}
            <label className="go-checkbox-label"><input type="checkbox" checked={anonymousAttendeeResponses} onChange={(event) => setAnonymousAttendeeResponses(event.target.checked)} /> Make attendee responses anonymous</label>
            {anonymousAttendeeResponses && <small>Anonymous mode stores answers without a member or account ID. A random key kept in this browser lets a respondent edit their answer; clear browser session data and the response can no longer be edited. Privacy mode locks after the first attendee response.</small>}
            <small>Use one to ten prompts. Each prompt may contain up to 300 characters.</small>
            <button className="button button-primary" disabled={busy || !groupId}><Check size={15} /> Save template</button>
          </form>
        </section>
        <section className="go-panel">
          <div className="go-heading"><h2>Leader feedback</h2><button type="button" disabled={busy || !feedbackMeetings.length} onClick={() => void exportMeetingFeedback()}>Export responses CSV</button></div>
          <label>Meeting<select value={feedbackMeetingId} onChange={(event) => setFeedbackMeetingId(event.target.value)}><option value="">Choose meeting</option>{feedbackMeetings.map((meeting) => <option key={meeting.id} value={meeting.id}>{meeting.date}{meeting.title ? " · " + meeting.title : ""}{meeting.guestCount == null ? "" : " · Guests " + meeting.guestCount}</option>)}</select></label>
          {!feedbackMeetings.length && <p className="go-empty">Create a group meeting before recording feedback.</p>}
          {feedbackMeetingId && loadedLeaderScope === leaderScope && <form className="go-form" onSubmit={(event) => void saveMeetingFeedback(event)}>
            {feedbackCompleted && <p role="status">Reopen attendance in Groups or Check-in to edit leader feedback.</p>}
            <label>Guest count<input disabled={feedbackCompleted || busy} type="number" min={0} max={100000} step={1} value={guestCount} onChange={(event) => setGuestCount(event.target.value)} /></label>
            <label>Meeting comment<textarea disabled={feedbackCompleted || busy} rows={3} maxLength={2000} value={meetingComment} onChange={(event) => setMeetingComment(event.target.value)} /></label>
            {feedbackTemplate && <h3>{feedbackTemplate.title}</h3>}
            {feedbackTemplate?.questions.map((question) => <label key={question.id}>{question.prompt}<textarea rows={3} maxLength={2000} disabled={feedbackCompleted || busy} value={feedbackAnswers[question.id] ?? ""} onChange={(event) => setFeedbackAnswers((current) => ({ ...current, [question.id]: event.target.value }))} /></label>)}
            {feedbackUpdatedBy && <small>Last saved by {feedbackUpdatedBy}.</small>}
            <button className="button button-primary" disabled={busy || feedbackCompleted}><Check size={15} /> Save leader feedback</button>
          </form>}
          {feedbackMeetingId && loadedLeaderScope !== leaderScope && <p className="go-empty" role="status">Loading meeting feedback…</p>}
        </section>
      </div>}
      {(canSubmitFeedback || isGroupLeader) && groupId && <section className="go-panel go-attendee-feedback">
        <h2>Attendee feedback</h2>
        {!isGroupLeader && <label>Meeting<select value={feedbackMeetingId} onChange={(event) => setFeedbackMeetingId(event.target.value)}><option value="">Choose meeting</option>{feedbackMeetings.map((meeting) => <option key={meeting.id} value={meeting.id}>{meeting.date}{meeting.title ? " · " + meeting.title : ""}</option>)}</select></label>}
        {!feedbackTemplate && <p className="go-empty">Group leaders have not created a feedback template for this group yet.</p>}
        {feedbackMeetingId && loadedAttendeeScope === leaderScope && attendeeMeetingDate && !attendeeFeedbackOpen && <p className="go-empty">Attendee feedback opens on the meeting date ({attendeeMeetingDate}).</p>}
        {canSubmitFeedback && loadedAttendeeScope === leaderScope && attendeeFeedbackOpen && feedbackTemplate && feedbackMeetingId && <form className="go-form" onSubmit={(event) => void saveAttendeeFeedback(event)}>
          <p className="go-note">{feedbackTemplate?.anonymousAttendeeResponses ? "Your answers are stored without your member or account ID. This browser keeps a random edit key so you can return to your response during this session." : "Your response is linked to your group membership. Group leaders can read it."}</p>
          <h3>{feedbackTemplate.title}</h3>
          {feedbackTemplate.questions.map((question) => <label key={question.id}>{question.prompt}{question.required && <span className="optional-label">Required</span>}<textarea required={Boolean(question.required)} rows={3} maxLength={2000} value={attendeeAnswers[question.id] ?? ""} onChange={(event) => setAttendeeAnswers((current) => ({ ...current, [question.id]: event.target.value }))} /></label>)}
          <button className="button button-primary" disabled={busy}><Check size={15} /> Save my feedback</button>
        </form>}
        {isGroupLeader && loadedAttendeeScope === leaderScope && canViewAttendeeResponses && <div className="go-list">
          <h3>Attendee responses ({attendeeResponses.length})</h3>
          {attendeeResponses.length ? attendeeResponses.map((response, index) => <article key={`${response.respondentLabel}-${index}`}>
            <div><strong>{response.respondentLabel}</strong>{response.updatedAt && <small>Updated {new Date(response.updatedAt).toLocaleString()}</small>}
              {feedbackTemplate?.questions.map((question) => <p key={question.id}><b>{question.prompt}</b><br />{response.answers[question.id] || "No response"}</p>)}
            </div>
          </article>) : <p className="go-empty">No attendee responses have been submitted for this meeting.</p>}
        </div>}
      </section>}
    </div>}
  </main>;
}
