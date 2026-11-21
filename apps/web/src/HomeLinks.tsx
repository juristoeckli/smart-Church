import { useEffect, useState, type FormEvent } from "react";
import { translate } from "./i18n";

type HomeLink = { label: string; url: string };
const maxLinks = 12;
const path = "/api/modules/notifications/home-welcome";

export function HomeLinks({ departmentId, csrfToken, canEdit }: {
  departmentId: string; csrfToken: string; canEdit: boolean;
}) {
  const [links, setLinks] = useState<HomeLink[]>();
  const [draft, setDraft] = useState<HomeLink[]>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch(path, { headers: { "x-department-id": departmentId }, signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const data = await response.json() as { links?: HomeLink[] };
        if (!controller.signal.aborted) setLinks(data.links ?? []);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(translate("overview.homeLinksUnavailable"));
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
      const response = await fetch(path, {
        method: "PUT", headers: { "x-department-id": departmentId, "x-csrf-token": csrfToken, "content-type": "application/json" },
        body: JSON.stringify({ links: draft }),
      });
      const data = await response.json() as { links: HomeLink[] } | { error: string };
      if (!response.ok || "error" in data) throw new Error("error" in data ? data.error : translate("overview.homeLinksUnavailable"));
      setLinks(data.links);
      setDraft(undefined);
      setNotice(translate("overview.homeLinksSaved"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : translate("overview.homeLinksUnavailable"));
    } finally {
      setSaving(false);
    }
  }

  if (!canEdit && !links?.length) return null;
  return <section className="directory-card">
    <div className="directory-heading">
      <h2>{translate("overview.homeLinks")}</h2>
      {canEdit && links && <button className="button button-secondary" type="button" disabled={saving} aria-expanded={Boolean(draft)}
        onClick={() => { setDraft(draft ? undefined : links); setError(""); setNotice(""); }}>{translate("overview.editHomeLinks")}</button>}
    </div>
    {links && (links.length ? <ul>{links.map(({ label, url }, index) =>
      <li key={index}><a href={url} target="_blank" rel="noopener noreferrer">{label}</a></li>)}</ul>
      : <p>{translate("overview.homeLinksEmpty")}</p>)}
    {canEdit && draft && <form className="home-welcome-form" aria-label={translate("overview.editHomeLinks")} onSubmit={(event) => void save(event)}>
      {draft.map((link, index) => <fieldset key={index} disabled={saving}>
        <legend>{translate("overview.homeLinkItem").replace("{number}", String(index + 1))}</legend>
        <label>{translate("overview.homeLinkLabel")}<input required maxLength={80} value={link.label} onChange={(event) =>
          setDraft(draft.map((entry, row) => row === index ? { ...entry, label: event.target.value } : entry))} /></label>
        <label>{translate("overview.homeLinkAddress")}<input type="url" required maxLength={2048} value={link.url} onChange={(event) =>
          setDraft(draft.map((entry, row) => row === index ? { ...entry, url: event.target.value } : entry))} /></label>
        <button className="button button-secondary" type="button" onClick={() => setDraft(draft.filter((_, row) => row !== index))}>
          {translate("events.remove")}
        </button>
      </fieldset>)}
      <div className="form-actions">
        <button className="button button-secondary" type="button" disabled={saving || draft.length >= maxLinks}
          onClick={() => setDraft([...draft, { label: "", url: "" }])}>{translate("overview.addHomeLink")}</button>
        <button className="button button-primary" disabled={saving}>{translate(saving ? "events.saving" : "events.saveChanges")}</button>
      </div>
    </form>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
