import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { translate } from "./i18n";

type Welcome = { heading: string; subtitle: string };
const emptyWelcome: Welcome = { heading: "", subtitle: "" };

export function HomeWelcome({ departmentId, csrfToken, canEdit, actions }: {
  departmentId: string;
  csrfToken: string;
  canEdit: boolean;
  actions: ReactNode;
}) {
  const [welcome, setWelcome] = useState<Welcome>();
  const [draft, setDraft] = useState<Welcome>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/modules/notifications/home-welcome", {
      headers: { "x-department-id": departmentId }, signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error(translate("overview.welcomeUnavailable"));
      const data = await response.json() as Welcome;
      if (!controller.signal.aborted) setWelcome(data);
    }).catch(() => {
      if (!controller.signal.aborted) setError(translate("overview.welcomeUnavailable"));
    });
    return () => controller.abort();
  }, [departmentId]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || !draft || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/modules/notifications/home-welcome", {
        method: "PUT",
        headers: { "x-department-id": departmentId, "x-csrf-token": csrfToken, "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await response.json() as Welcome | { error: string };
      if (!response.ok || "error" in data) throw new Error("error" in data ? data.error : translate("overview.welcomeSaveFailed"));
      setWelcome(data);
      setDraft(undefined);
      setNotice(translate("overview.welcomeSaved"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : translate("overview.welcomeSaveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return <>
    <section className="page-heading">
      <div className="home-welcome-copy">
        <div className="eyebrow">{translate("overview.eyebrow")}</div>
        <h1>{welcome?.heading || translate("overview.title")}</h1>
        <p className="page-subtitle">{welcome?.subtitle || translate("overview.subtitle")}</p>
      </div>
      <div className="home-welcome-actions">
        {canEdit && welcome && <button className="button button-secondary" type="button" disabled={saving} aria-expanded={Boolean(draft)}
          onClick={() => { setError(""); setNotice(""); setDraft(draft ? undefined : welcome); }}>
          {translate("overview.editWelcome")}
        </button>}
        {actions}
      </div>
    </section>
    {canEdit && draft && <form className="directory-card home-welcome-form" aria-label={translate("overview.editWelcome")} onSubmit={(event) => void save(event)}>
      <p>{translate("overview.welcomeHelp")}</p>
      <label>{translate("overview.welcomeHeading")}<input maxLength={100} value={draft.heading} disabled={saving}
        onChange={(event) => setDraft({ ...draft, heading: event.target.value })} /></label>
      <label>{translate("overview.welcomeSubtitle")}<input maxLength={300} value={draft.subtitle} disabled={saving}
        onChange={(event) => setDraft({ ...draft, subtitle: event.target.value })} /></label>
      <div className="form-actions">
        <button className="button button-secondary" type="button" disabled={saving} onClick={() => setDraft(emptyWelcome)}>{translate("overview.clearWelcome")}</button>
        <button className="button button-primary" disabled={saving}>{translate(saving ? "events.saving" : "events.saveChanges")}</button>
      </div>
    </form>}
    {canEdit && error && <p role="alert">{error}</p>}
    {canEdit && notice && <p role="status">{notice}</p>}
  </>;
}
