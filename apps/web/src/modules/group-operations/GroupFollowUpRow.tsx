import { useState, type FormEvent } from "react";
import { Check, RotateCcw } from "lucide-react";

export type FollowUp = {
  id: string; groupId: string; groupName: string; contactId: string; personName: string;
  assignedContactId: string | null; assignedName: string | null; subject: string; note: string;
  dueDate: string; dueState: "upcoming" | "due" | "overdue" | "completed"; status: "open" | "completed"; completedAt: string | null;
};
const dueLabels = { upcoming: "Upcoming", due: "Due today", overdue: "Overdue", completed: "Completed" } as const;

export function FollowUpRow({ task, busy, onStatus, onReschedule }: {
  task: FollowUp;
  busy: boolean;
  onStatus: (task: FollowUp) => Promise<void>;
  onReschedule: (task: FollowUp, date: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState("");
  const [original, setOriginal] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (date && date !== original && await onReschedule({ ...task, dueDate: original }, date)) setEditing(false);
  }

  return <article>
    <div>
      <strong>{task.subject} · {task.personName}</strong>
      <small>{task.groupName} · Due {task.dueDate} · {dueLabels[task.dueState]}{task.assignedName ? " · Assigned to " + task.assignedName : ""}</small>
      {task.note && <p>{task.note}</p>}
      {editing && task.status === "open" && <form className="go-form" onSubmit={(event) => void save(event)}>
        <label>New due date<input type="date" required value={date} disabled={busy} onChange={(event) => setDate(event.target.value)} /></label>
        <div className="go-actions">
          <button className="button button-secondary" type="button" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
          <button className="button button-primary" type="submit" disabled={busy || !date || date === original}>Save due date</button>
        </div>
      </form>}
    </div>
    {!editing && <div className="go-actions">
      {task.status === "open" && <button className="button button-secondary" type="button" disabled={busy} onClick={() => { setDate(task.dueDate); setOriginal(task.dueDate); setEditing(true); }}>Reschedule</button>}
      <button className="button button-secondary" type="button" disabled={busy} onClick={() => void onStatus(task)}>
        {task.status === "open" ? <><Check size={14}/> Complete</> : <><RotateCcw size={14}/> Reopen</>}
      </button>
    </div>}
  </article>;
}
