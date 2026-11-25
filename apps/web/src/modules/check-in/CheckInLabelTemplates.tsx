import { useCallback, useEffect, useState, type FormEvent } from "react";
import { checkInLabelTemplateKeys, checkInLabelTemplateTokens, validCheckInLabelTemplate,
  type CheckInLabelTemplateSettings } from "@smart-church/contracts";
import type { ModuleRealtime } from "../../module-registry";

const path = "/api/modules/check-in/label-templates";
const names = { individual: "Individual name label", child: "Child label", parent: "Parent pickup slip" };

export function useCheckInLabelTemplates(departmentId: string, realtime?: ModuleRealtime) {
  const [loaded, setLoaded] = useState<{ departmentId: string; data: CheckInLabelTemplateSettings }>();
  const [error, setError] = useState<{ departmentId: string; message: string }>();
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision(value => value + 1), []);
  const accept = useCallback((data: CheckInLabelTemplateSettings) => {
    setLoaded(current => current?.departmentId === departmentId && current.data.revision > data.revision ? current : { departmentId, data });
    setError(undefined);
  }, [departmentId]);

  useEffect(() => {
    if (!departmentId) return;
    const controller = new AbortController();
    void fetch(path, { cache: "no-store", signal: controller.signal, headers: { "x-department-id": departmentId } })
      .then(async (result) => {
        if (!result.ok) throw new Error("Could not load the location’s label templates.");
        const data = await result.json() as CheckInLabelTemplateSettings;
        if (!controller.signal.aborted) accept(data);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError({ departmentId, message: reason instanceof Error ? reason.message : "Could not load label templates." });
      });
    return () => controller.abort();
  }, [departmentId, revision, accept]);

  useEffect(() => realtime?.subscribe("module:check-in:label-templates-changed", event => {
    if (event.departmentId === departmentId) reload();
  }), [departmentId, realtime, reload]);

  return { data: loaded?.departmentId === departmentId ? loaded.data : undefined,
    error: error?.departmentId === departmentId ? error.message : undefined, reload, accept };
}

export function CheckInLabelTemplateEditor({ departmentId, csrfToken, current }: {
  departmentId: string;
  csrfToken: string;
  current: ReturnType<typeof useCheckInLabelTemplates>;
}) {
  const [draft, setDraft] = useState<CheckInLabelTemplateSettings>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const settings = draft ?? current.data;
  const stale = Boolean(draft && current.data && draft.revision !== current.data.revision);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || stale || saving) return;
    if (checkInLabelTemplateKeys.some(key => !validCheckInLabelTemplate(draft.templates[key]))) {
      setError("Use the listed placeholders and up to six lines per template.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(path, { method: "PUT", cache: "no-store",
        headers: { "content-type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken },
        body: JSON.stringify(draft),
      });
      const result = await response.json() as CheckInLabelTemplateSettings & { error?: string };
      if (!response.ok) {
        if (response.status === 409) current.reload();
        throw new Error(result.error ?? "Could not save the label templates.");
      }
      current.accept(result);
      setDraft(undefined);
      setNotice("Location label templates saved.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the label templates.");
    } finally { setSaving(false); }
  }

  return <fieldset>
    <legend>Location label templates</legend>
    <p>Leave a template blank for the standard label. Templates use up to six lines of plain text. The first line prints in bold.</p>
    <p>Available placeholders: {checkInLabelTemplateTokens.map(token => <code key={token}>{"{{{" + token + "}}} "}</code>)}</p>
    <p>Pickup labels use surname initials and keep the desk reference. Staff still verifies pickup identity.</p>
    {!settings && !current.error && <p role="status">Loading location label templates…</p>}
    {current.error && <p role="alert">{current.error} <button className="checkin-print" type="button" onClick={current.reload}>Retry</button></p>}
    {settings && <form className="group-meeting-form" onSubmit={save}>
      {checkInLabelTemplateKeys.map(key => <label key={key}>{names[key]}
        <textarea rows={4} maxLength={480} disabled={saving} value={settings.templates[key]}
          onChange={(event) => {
            setDraft({ ...settings, templates: { ...settings.templates, [key]: event.target.value } });
            setError(""); setNotice("");
          }} />
      </label>)}
      <button className="checkin-print" type="submit" disabled={saving || !draft || stale}>Save location templates</button>
      {draft && <button className="checkin-print" type="button" disabled={saving} onClick={() => {
        setDraft(undefined); setError(""); setNotice("");
      }}>Use saved templates</button>}
    </form>}
    {stale && <p role="alert">Another desk changed the templates. Review the saved templates before saving again.</p>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
  </fieldset>;
}
