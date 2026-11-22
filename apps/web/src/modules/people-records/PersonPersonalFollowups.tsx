import { useEffect, useState, type FormEvent } from "react";

type Draft = { title: string; details: string; dueOn: string };
type Task = Draft & { id: string; revision: number; completedAt: string | null };
type Page = { tasks: Task[]; hasMore: boolean };
type Request = <T>(url: string, init?: RequestInit) => Promise<T>;
const empty: Draft = { title: "", details: "", dueOn: "" };

function FollowupDraft({ draft, change }: { draft: Draft; change: (draft: Draft) => void }) {
  return <>
    <label>Task<input maxLength={160} required value={draft.title} onChange={(event) => change({ ...draft,title:event.target.value })} /></label>
    <label>Due date<input type="date" min="1000-01-01" max="9999-12-31" required value={draft.dueOn} onChange={(event) => change({ ...draft,dueOn:event.target.value })} /></label>
    <label>Details<textarea maxLength={4000} value={draft.details} onChange={(event) => change({ ...draft,details:event.target.value })} /></label>
  </>;
}

function displayDay(day: string) {
  const [year,month,date] = day.split("-").map(Number);
  return new Date(year,month - 1,date).toLocaleDateString(undefined,{ dateStyle:"medium" });
}

export function PersonPersonalFollowups({ contactId, request }: { contactId: string; request: Request }) {
  const url = `/api/people-records/${contactId}/personal-followups`;
  const [completed,setCompleted] = useState(false);
  const [page,setPage] = useState(1);
  const [revision,setRevision] = useState(0);
  const [loaded,setLoaded] = useState<{ key: string; result: Page } | null>(null);
  const [draft,setDraft] = useState(empty);
  const [editing,setEditing] = useState<{ task: Task; draft: Draft } | null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [message,setMessage] = useState("");
  const key = JSON.stringify([url,completed,page,revision]);
  const result = loaded?.key === key ? loaded.result : null;

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ completed: String(completed), page: String(page) });
    setError("");
    void request<Page>(`${url}?${params}`,{ signal:controller.signal })
      .then(data => { if (!controller.signal.aborted) setLoaded({ key,result:data }); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load follow-ups."); });
    return () => controller.abort();
  },[request,url,completed,page,key]);

  async function apply(task: Task | null, body: unknown, confirmation: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await request<Task>(task ? `${url}/${task.id}` : url,{ method:task ? "PATCH" : "POST",body:JSON.stringify(body) });
      setEditing(null);
      if (!task) {
        setDraft(empty);
        setCompleted(false);
        setPage(1);
      }
      setMessage(confirmation);
      setRevision(current => current + 1);
    } catch(reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the follow-up.");
    } finally {
      setBusy(false);
    }
  }

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !draft.title.trim()) return;
    void apply(null,draft,"Follow-up added.");
  }

  function edit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !editing || !editing.draft.title.trim()) return;
    void apply(editing.task,{ action:"edit",revision:editing.task.revision,draft:editing.draft },"Follow-up updated.");
  }

  return <details>
    <summary>My follow-ups for this person</summary>
    <p>Only you can see the tasks you create here.</p>
    <form onSubmit={create}>
      <fieldset disabled={busy}>
        <legend>New follow-up</legend>
        <FollowupDraft draft={draft} change={setDraft} />
        <button type="submit" disabled={!draft.title.trim()}>Add follow-up</button>
      </fieldset>
    </form>
    <div className="module-toolbar">
      <label>Follow-ups<select value={completed ? "completed" : "open"} disabled={busy} onChange={(event) => {
        setCompleted(event.target.value === "completed");
        setPage(1);
        setEditing(null);
      }}>
        <option value="open">Open tasks</option><option value="completed">Completed tasks</option>
      </select></label>
      <button type="button" disabled={busy} onClick={() => { setEditing(null);setRevision(current => current + 1); }}>Refresh follow-ups</button>
    </div>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
    {!result && !error && <p role="status">Loading follow-ups…</p>}
    {result?.tasks.length === 0 && <p>{completed ? "No completed follow-ups on this page." : "No open follow-ups on this page."}</p>}
    {result?.tasks.map(task => <article className="module-card" key={task.id}>
      <h4>{task.title}</h4>
      <p>Due <time dateTime={task.dueOn}>{displayDay(task.dueOn)}</time></p>
      {task.details && <p style={{whiteSpace:"pre-wrap"}}>{task.details}</p>}
      {editing?.task.id === task.id ? <form onSubmit={edit}><fieldset disabled={busy}>
        <legend>Edit follow-up</legend>
        <FollowupDraft draft={editing.draft} change={value => setEditing({ task:editing.task,draft:value })} />
        <button type="submit">Save follow-up</button>
        <button type="button" onClick={() => setEditing(null)}>Cancel</button>
      </fieldset></form> : <>
        {!task.completedAt && <button type="button" disabled={busy} onClick={() => setEditing({task,draft:{ title:task.title,details:task.details,dueOn:task.dueOn }})}>Edit or reschedule</button>}
        <button type="button" disabled={busy} onClick={() => void apply(task,{
          action:task.completedAt ? "reopen" : "complete",revision:task.revision,
        },task.completedAt ? "Follow-up reopened." : "Follow-up completed.")}>
          {task.completedAt ? "Reopen follow-up" : "Complete follow-up"}
        </button>
      </>}
    </article>)}
    {result && (page > 1 || result.hasMore) && <nav aria-label="Follow-up pages" className="module-toolbar">
      <button type="button" disabled={busy || page <= 1} onClick={() => { setEditing(null);setPage(page-1); }}>Previous page</button>
      <button type="button" disabled={busy || !result.hasMore || page >= 10000} onClick={() => { setEditing(null);setPage(page+1); }}>Next page</button>
    </nav>}
  </details>;
}
