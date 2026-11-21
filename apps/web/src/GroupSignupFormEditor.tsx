import { useEffect, useState, type FormEvent } from "react";

export type SignupQuestion = { id: string; label: string; type: "text" | "choice"; required: boolean; options?: string[] };
type SignupPolicy = { opensAt: string | null; closesAt: string | null; defaultRole: string; heading: string; timeZone: string; activeSeatLimit?: number | null; waitlistLimit?: number | null; countedRoles?: string[] };
type SignupForm = { revision: string | null; questions: SignupQuestion[]; policy: SignupPolicy };
const emptyPolicy: SignupPolicy = { opensAt: null, closesAt: null, defaultRole: "Member", heading: "", timeZone: "UTC" };
type QuestionDraft = Omit<SignupQuestion, "options"> & { optionText: string };

export function GroupSignupFormEditor({ departmentId, groupId, csrfToken }: { departmentId: string; groupId: string; csrfToken: string }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [revision, setRevision] = useState<string | null>(null);
  const [policy, setPolicy] = useState(emptyPolicy);
  const [countedRoleText, setCountedRoleText] = useState("");
  const [draft, setDraft] = useState<QuestionDraft[]>([]);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const path = "/api/groups/" + groupId + "/signup-form";

  function apply(result: SignupForm) {
    setRevision(result.revision);
    setPolicy(result.policy ?? emptyPolicy);
    setCountedRoleText(result.policy?.countedRoles?.join("\n") ?? "");
    setDraft(result.questions.map(({ options, ...question }) => ({ ...question, optionText: options?.join("\n") ?? "" })));
  }

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoaded(false);
    setError("");
    setNotice("");
    void fetch(path, { signal: controller.signal, headers: { "x-department-id": departmentId } })
      .then(async (response) => {
        const result = await response.json() as SignupForm & { error?: string };
        if (!response.ok || !Array.isArray(result.questions)) throw new Error(result.error ?? "Could not load signup questions.");
        if (!controller.signal.aborted) { apply(result); setLoaded(true); }
      }).catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load signup questions.");
      });
    return () => controller.abort();
  }, [departmentId, open, path, reload]);

  function update(id: string, patch: Partial<QuestionDraft>) {
    setDraft((current) => current.map((question) => question.id === id ? { ...question, ...patch } : question));
    setNotice("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { timeZone, ...policyDraft } = policy;
      const response = await fetch(path, {
        method: "PUT",
        headers: { "x-department-id": departmentId, "x-csrf-token": csrfToken, "content-type": "application/json" },
        body: JSON.stringify({
          expectedRevision: revision,
          policy: { ...policyDraft, countedRoles: countedRoleText.split("\n").map((role) => role.trim()).filter(Boolean) },
          questions: draft.map(({ label, type, required, optionText }) => ({
            label, type, required, ...(type === "choice" ? { options: optionText.split("\n").map((option) => option.trim()).filter(Boolean) } : {}),
          })),
        }),
      });
      const result = await response.json() as SignupForm & { error?: string };
      if (!response.ok || !Array.isArray(result.questions)) throw new Error(result.error ?? "Could not save signup questions.");
      apply(result);
      setNotice("Signup settings saved.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save signup questions."); }
    finally { setBusy(false); }
  }

  return <div className="group-attendance-section">
    <div className="community-members-heading">
      <h3>Signup settings</h3>
      <button className="button button-secondary" type="button" aria-expanded={open} disabled={busy} onClick={() => setOpen((value) => !value)}>{open ? "Close settings" : "Edit settings"}</button>
    </div>
    {open && <div className="group-join-request-list">
      {error && <p role="alert">{error} <button type="button" className="button button-secondary" disabled={busy} onClick={() => setReload((value) => value + 1)}>Reload questions</button></p>}
      {notice && <p role="status">{notice}</p>}
      {!loaded && !error && <p role="status">Loading signup questions…</p>}
      {loaded && <form onSubmit={(event) => void save(event)} className="community-group-form">
        <label>Public signup heading<input maxLength={120} value={policy.heading} onChange={(event) => setPolicy({ ...policy, heading: event.target.value })} /></label>
        <label>Open signup ({policy.timeZone})<input type="datetime-local" step={1} value={policy.opensAt ?? ""} onChange={(event) => setPolicy({ ...policy, opensAt: event.target.value || null })} /></label>
        <label>Close signup ({policy.timeZone})<input type="datetime-local" step={1} value={policy.closesAt ?? ""} onChange={(event) => setPolicy({ ...policy, closesAt: event.target.value || null })} /></label>
        <label>Default role for new admissions<input required maxLength={80} value={policy.defaultRole} onChange={(event) => setPolicy({ ...policy, defaultRole: event.target.value })} /></label>
        <label>Admission seats<input type="number" min={1} max={100000} step={1} value={policy.activeSeatLimit ?? ""} onChange={(event) => setPolicy({
          ...policy, activeSeatLimit: event.target.value ? Number(event.target.value) : null,
        })} /></label>
        <label>Roles counted against admission seats (one per line)<textarea rows={3} maxLength={3240} value={countedRoleText} onChange={(event) => setCountedRoleText(event.target.value)} /></label>
        <label>Admission waitlist limit<input type="number" min={0} max={100000} step={1} value={policy.waitlistLimit ?? ""} onChange={(event) => setPolicy({
          ...policy, waitlistLimit: event.target.value ? Number(event.target.value) : null,
        })} /></label>
        <p>Leave a limit blank for unlimited places. With no roles listed, all active members count. These limits apply to application decisions and waitlist promotions. Existing memberships stay in place if a limit is lowered.</p>
        <p>Signup must be enabled to use the schedule. Each application still needs review.</p>
        <h4>Signup questions</h4>
        <p>Applicants see these questions. Group managers can read the answers when reviewing the application.</p>
        {draft.map((question, index) => <fieldset key={question.id} disabled={busy}>
          <legend>Question {index + 1}</legend>
          <label>Label<input required maxLength={120} value={question.label} onChange={(event) => update(question.id, { label: event.target.value })} /></label>
          <label>Answer type<select value={question.type} onChange={(event) => update(question.id, { type: event.target.value as SignupQuestion["type"] })}>
            <option value="text">Short text</option><option value="choice">One choice</option>
          </select></label>
          {question.type === "choice" && <label>Choices (one per line)<textarea required maxLength={648} rows={3} value={question.optionText} onChange={(event) => update(question.id, { optionText: event.target.value })} /></label>}
          <label><input type="checkbox" checked={question.required} onChange={(event) => update(question.id, { required: event.target.checked })} /> Required</label>
          <button className="button button-secondary" type="button" onClick={() => setDraft((current) => current.filter(({ id }) => id !== question.id))}>Remove question</button>
        </fieldset>)}
        <div className="community-inline-actions">
          <button className="button button-secondary" type="button" disabled={busy || draft.length >= 8} onClick={() => setDraft((current) => [
            ...current, { id: crypto.randomUUID(), label: "", type: "text", required: false, optionText: "" },
          ])}>Add question</button>
          <button className="button button-primary" type="submit" disabled={busy}>Save signup settings</button>
        </div>
      </form>}
    </div>}
  </div>;
}
