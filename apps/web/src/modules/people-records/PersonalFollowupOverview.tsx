import { useEffect, useState } from "react";

type Filter = "open" | "overdue" | "today" | "upcoming" | "completed";
type Row = { id: string; contactId: string; personName: string; title: string; dueOn: string; revision: number };
type Page = { tasks: Row[]; hasMore: boolean; today: string };
type Request = <T>(url: string, init?: RequestInit) => Promise<T>;
const path = "/api/people-records/personal-followups";
const filters: { value: Filter; label: string }[] = [
  { value:"open",label:"All open" },{ value:"overdue",label:"Overdue" },{ value:"today",label:"Due today" },
  { value:"upcoming",label:"Upcoming" },{ value:"completed",label:"Completed" },
];

export function PersonalFollowupOverview({ request, openPerson }: { request: Request; openPerson: (id: string) => void }) {
  const [filter,setFilter] = useState<Filter>("open");
  const [page,setPage] = useState(1);
  const [refresh,setRefresh] = useState(0);
  const [busy,setBusy] = useState(false);
  const [loaded,setLoaded] = useState<{ key: string; data: Page } | null>(null);
  const [error,setError] = useState("");
  const [message,setMessage] = useState("");
  const key = JSON.stringify([filter,page,refresh]);
  const data = loaded?.key === key ? loaded.data : null;

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void request<Page>(`${path}?${new URLSearchParams({ filter,page:String(page) })}`,{ signal:controller.signal })
      .then(result => { if (!controller.signal.aborted) setLoaded({key,data:result}); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load your follow-ups."); });
    return () => controller.abort();
  },[request,filter,page,key]);

  async function changeStatus(task: Row) {
    if (busy) return;
    const reopen = filter === "completed";
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await request(`/api/people-records/${task.contactId}/personal-followups/${task.id}`,{
        method:"PATCH",body:JSON.stringify({ revision:task.revision,action:reopen ? "reopen" : "complete" }),
      });
      if (page > 1 && data?.tasks.length === 1 && !data.hasMore) setPage(page-1);
      setRefresh(current => current + 1);
      setMessage(reopen ? "Follow-up reopened." : "Follow-up completed.");
    } catch(reason) {
      setError(reason instanceof Error ? reason.message : "Could not update the follow-up.");
    } finally { setBusy(false); }
  }

  return <section className="module-card">
    <h2>My follow-ups</h2>
    <div className="module-toolbar">
      <label>Show<select value={filter} disabled={busy} onChange={(event) => {
        setFilter(event.target.value as Filter);
        setPage(1);
        setMessage("");
      }}>{filters.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <button type="button" disabled={busy} onClick={() => setRefresh(current => current + 1)}>Refresh follow-ups</button>
    </div>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
    {!data && !error && <p role="status">Loading follow-ups…</p>}
    {data?.tasks.length === 0 && <p>No follow-ups match this filter.</p>}
    {data && data.tasks.length > 0 && <table>
      <thead><tr><th scope="col">Follow-up</th><th scope="col">Person</th><th scope="col">Due date</th><th scope="col">Action</th></tr></thead>
      <tbody>{data.tasks.map(task => {
        const [year,month,day] = task.dueOn.split("-").map(Number);
        const display = new Date(year,month-1,day).toLocaleDateString(undefined,{dateStyle:"medium"});
        return <tr key={task.id}>
          <td>{task.title}</td>
          <td><button type="button" onClick={() => openPerson(task.contactId)}>{task.personName}</button></td>
          <td><time dateTime={task.dueOn}>{display}</time>{filter !== "completed" && task.dueOn < data.today && " · Overdue"}</td>
          <td><button type="button" disabled={busy} onClick={() => void changeStatus(task)}
            aria-label={`${filter === "completed" ? "Reopen" : "Complete"} ${task.title}`}>{filter === "completed" ? "Reopen" : "Complete"}</button></td>
        </tr>;
      })}</tbody>
    </table>}
    {data && (page > 1 || data.hasMore) && <nav className="module-toolbar" aria-label="Follow-up pages">
      <button type="button" disabled={busy || page <= 1} onClick={() => setPage(page - 1)}>Previous page</button>
      <button type="button" disabled={busy || !data.hasMore || page >= 10000} onClick={() => setPage(page + 1)}>Next page</button>
    </nav>}
  </section>;
}
