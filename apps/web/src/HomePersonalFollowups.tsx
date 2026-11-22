import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { formatUserDate } from "./date-format";
import { translate } from "./i18n";

type Followup = { id: string; contactId: string; personName: string; title: string; dueOn: string };
type FollowupPage = { tasks: Followup[]; today: string };

export function HomePersonalFollowups({ departmentId, openProfile, openOverview }: {
  departmentId: string;
  openProfile: (id: string) => void;
  openOverview: () => void;
}) {
  const [page,setPage] = useState<FollowupPage | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/people-records/personal-followups?filter=open", {
      headers: { "x-department-id": departmentId }, cache:"no-store", signal:controller.signal,
    }).then(async response => {
      if (!response.ok) return;
      const data = await response.json() as FollowupPage;
      if (!controller.signal.aborted) setPage(data);
    }).catch(() => {});
    return () => controller.abort();
  },[departmentId]);

  if (!page?.tasks.length) return null;
  const title = translate("overview.personalFollowups");
  return <section className="directory-card community-upcoming-card" aria-label={title}>
    <div className="directory-heading">
      <h2>{title}</h2>
      <button className="button button-secondary" type="button" onClick={openOverview}>
        {translate("overview.openPersonalFollowups")} <ArrowRight size={14} />
      </button>
    </div>
    <ul className="community-upcoming-list">
      {page.tasks.slice(0,5).map(task => <li className="community-upcoming-item" key={task.id}>
        <div className="community-upcoming-date">
          <time dateTime={task.dueOn}>{formatUserDate(task.dueOn)}</time>
          {task.dueOn < page.today && <small>{translate("overview.followupOverdue")}</small>}
        </div>
        <div>
          <button type="button" className="button button-secondary" onClick={() => openProfile(task.contactId)}>{task.title}</button>
          <small>{task.personName}</small>
        </div>
      </li>)}
    </ul>
  </section>;
}
