import { useState } from "react";

type Kind = "event" | "agenda";
type Row = {
  sourceId: string; name: string; description: string; positions: Array<{ name: string }>;
  items: Array<{ title: string; durationMinutes?: number; notes?: string; songId?: string }>;
  status: string; omitted: string[]; blocked: string[];
};
type Review = { reviewHash: string; rows: Row[] };
const endpoint = "/api/modules/sync/churchtools/service-templates";
const labels: Record<string, string> = {
  create: "Ready to import", already_imported: "Already imported", source_changed: "Source changed since import",
  archived_local_copy: "Local copy is archived", unsupported: "Needs review", name_conflict: "Template name conflict",
  invalid_service_roles: "Invalid source role slots", unavailable_role_names: "Source role names were unavailable",
  too_many_volunteer_slots: "More than 40 volunteer slots", description_shortened: "Description shortened to 1,000 characters",
  default_event_title: "Default event title", default_calendar: "Default calendar", default_event_time_and_duration: "Default event time and duration",
  default_event_administrators: "Default event administrators", default_event_facts: "Default event facts",
  invalid_or_oversized_agenda: "Missing agenda items or more than 100 items", instance_agenda_has_occurrence_times: "Source agenda includes occurrence times",
  headings_become_plan_items: "Headings become regular plan items", unsupported_agenda_duration: "Durations outside whole minutes",
  agenda_text_shortened: "Some agenda titles or notes were shortened",
  unsupported_agenda_items: "Unsupported agenda items", before_event_anchor: "Before-event placement", source_series_label: "Source series label",
  nothing_importable: "No compatible content", invalid_template_name: "Missing name or name exceeds 160 characters",
  unlinked_songs_or_arrangements: "Songs or arrangements need a local catalog link",
  "agenda.responsible": "Agenda responsibilities", "agenda.serviceGroupNotes": "Role-category notes",
};

export function ServiceTemplateImport({ departmentId, csrfToken, t }: {
  departmentId: string; csrfToken: string; t: (message: string) => string;
}) {
  const [kind, setKind] = useState<Kind>("event");
  const [review, setReview] = useState<Review | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const label = (value: string) => t(labels[value] ?? value);
  function changeKind(kind: Kind) {
    setKind(kind);
    setReview(null);
    setSelected([]);
    setStatus("");
    setError("");
  }
  async function submit(apply = false) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken },
        body: JSON.stringify({ kind, ...(apply && review ? { reviewHash: review.reviewHash, sourceIds: selected } : {}) }),
      });
      const data = await response.json() as Review & { created?: number; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not review ChurchTools service templates.");
      if (apply) {
        setStatus(data.created ? "Reviewed templates imported into Worship Planning." : "The selected templates were already imported.");
        setReview(null);
      } else setReview(data);
      setSelected([]);
    } catch (failure) {
      setReview(null);
      setSelected([]);
      setError(failure instanceof Error ? failure.message : "Could not review ChurchTools service templates.");
    } finally { setBusy(false); }
  }
  return <section className="directory-card sync-controls-card">
    <div><h2>{t("ChurchTools service templates")}</h2>
      <p>{t("Review reusable event templates for volunteer slots or agenda templates for ordered plan items.")}</p></div>
    <div className="form-row">
      <label>{t("Template collection")}<select value={kind} disabled={busy} onChange={(event) => changeKind(event.target.value as Kind)}>
        <option value="event">{t("Event templates")}</option><option value="agenda">{t("Agenda templates")}</option>
      </select></label>
      <button type="button" className="button button-secondary" disabled={busy} onClick={() => void submit()}>{t("Review service templates")}</button>
    </div>
    {review && <>
      <p>{t("Imported templates are visible to people at this location.")}</p>
      <fieldset disabled={busy}>
        {!review.rows.length && <p>{t("ChurchTools returned zero visible templates.")}</p>}
        {review.rows.map((template) => <details key={template.sourceId}>
          <summary>{template.name || `#${template.sourceId}`} · {label(template.status)}</summary>
          {template.description && <p>{template.description}</p>}
          {!!template.positions.length && <p>{t("Volunteer slots")} · {template.positions.map(({ name }) => name).join(", ")}</p>}
          {!!template.items.length && <ol>{template.items.map((item, index) => <li key={index}>
            {item.title}{item.durationMinutes != null && ` · ${item.durationMinutes} ${t("minutes")}`}{item.songId && ` · ${t("Linked song")}`}
            {item.notes && <p>{item.notes}</p>}
          </li>)}</ol>}
          {!!template.omitted.length && <p>{t("Check these source fields")} · {template.omitted.map(label).join(", ")}</p>}
          {!!template.blocked.length && <p>{template.blocked.map(label).join(", ")}</p>}
          {template.status === "create" && <label><input type="checkbox" checked={selected.includes(template.sourceId)}
            disabled={!selected.includes(template.sourceId) && selected.length >= 25}
            onChange={(event) => setSelected((current) => event.target.checked ? [...current, template.sourceId] : current.filter((id) => id !== template.sourceId))} />
            {t("Select this template for import")}</label>}
        </details>)}
        {!!selected.length && <button type="button" className="button button-primary" onClick={() => void submit(true)}>
          {t("Import selected templates")} ({selected.length})
        </button>}
      </fieldset>
    </>}
    {busy && <p role="status">{t("Reading ChurchTools service templates…")}</p>}
    {status && <p role="status">{t(status)}</p>}
    {error && <p role="alert">{t(error)}</p>}
  </section>;
}
