import { useEffect, useState, type FormEvent } from "react";
import type { ModuleRealtime } from "../../module-registry";

type Request = <T>(path: string, options?: RequestInit) => Promise<T>;
type Step = { id: string; name: string };
type Mapping = { groupId?: string; groupType?: string; role: string; stepId: string | null };
type Visibility = "people_managers" | "private_people";
type Settings = { revision: number; visibility: Visibility; steps: Step[]; mappings: Mapping[] };
type Group = { id: string; name: string; type: string };
const path = "/api/people-records/growth-trajectory";
const suggestedSteps = ["Welcome", "Connect", "Grow", "Lead (Group)", "Lead (Division)", "Leadership (Board)"];

export function GrowthTrajectorySettings({ request }: { request: Request }) {
  const [settings, setSettings] = useState<(Settings & { groups: Group[] }) | null>(null);
  const [loadRevision, setLoadRevision] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setSettings(null);
    setError("");
    void request<Settings & { groups: Group[] }>(path, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setSettings(data); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load growth trajectory settings."); });
    return () => controller.abort();
  }, [request, loadRevision]);

  return <details className="module-card">
    <summary>Growth trajectory</summary>
    <button type="button" onClick={() => setLoadRevision(current => current + 1)}>Reload steps and groups</button>
    {error && <p role="alert">{error}</p>}
    {!settings && !error && <p role="status">Loading growth trajectory settings…</p>}
    {settings && <GrowthTrajectoryEditor key={settings.revision} settings={settings}
      save={async (draft) => {
        const saved = await request<Settings>(path, { method: "PUT", body: JSON.stringify(draft) });
        setSettings({ ...saved, groups: settings.groups });
      }} />}
  </details>;
}

function GrowthTrajectoryEditor({ settings, save }: { settings: Settings & { groups: Group[] }; save: (settings: Settings) => Promise<void> }) {
  const [steps, setSteps] = useState(settings.steps);
  const [visibility, setVisibility] = useState(settings.visibility);
  const [mappings, setMappings] = useState(settings.mappings);
  const [nextName, setNextName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const groupTypes = [...new Set(settings.groups.map(group => group.type).filter(Boolean))].sort((a,b) => a.localeCompare(b));
  const changed = visibility !== settings.visibility
    || JSON.stringify([steps,mappings]) !== JSON.stringify([settings.steps,settings.mappings]);
  const title = (mapping: Mapping) => mapping.groupId ? "Group" : "Group type";

  function move(index: number, direction: number) {
    const next = [...steps];
    const target = index + direction;
    [next[index], next[target]] = [next[target], next[index]];
    setSteps(next);
  }

  function updateMapping(index: number, mapping: Mapping) {
    setMappings(current => current.map((entry,indexOfEntry) => indexOfEntry === index ? mapping : entry));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!changed || busy) return;
    setBusy(true);
    setError("");
    try { await save({ revision: settings.revision, steps, mappings, visibility }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save the growth trajectory."); }
    finally { setBusy(false); }
  }

  return <form onSubmit={(event) => void submit(event)}>
    <fieldset disabled={busy}>
      <legend>Steps in order</legend>
      {steps.length === 0 && <button type="button" onClick={() =>
        setSteps(suggestedSteps.map(name => ({ id: crypto.randomUUID(), name })))
      }>Use suggested steps</button>}
      <ol>{steps.map((step, index) => <li key={step.id} className="module-toolbar">
        <label>Step name<input required value={step.name} maxLength={100}
          onChange={event => setSteps(steps.map(entry => entry.id === step.id ? { ...entry, name: event.target.value } : entry))} /></label>
        <button type="button" aria-label={`Move ${step.name} earlier`} disabled={index === 0} onClick={() => move(index,-1)}>Earlier</button>
        <button type="button" aria-label={`Move ${step.name} later`} disabled={index === steps.length-1} onClick={() => move(index,1)}>Later</button>
        <button type="button" aria-label={`Remove ${step.name}`} disabled={mappings.some(mapping => mapping.stepId === step.id)}
          onClick={() => setSteps(steps.filter(entry => entry.id !== step.id))}>Remove step</button>
      </li>)}</ol>
      <label>New step<input value={nextName} maxLength={100} onChange={event => setNextName(event.target.value)} /></label>
      <button type="button" disabled={!nextName.trim() || steps.length >= 30} onClick={() => {
        setSteps([...steps, { id: crypto.randomUUID(), name: nextName.trim() }]);
        setNextName("");
      }}>Add step</button>
    </fieldset>
    <fieldset disabled={busy}>
      <legend>Group role mappings</legend>
      <p>A group-specific mapping overrides the group type for the same role.</p>
      {mappings.map((mapping,index) => <fieldset key={index} className="module-toolbar">
        <legend>{title(mapping)} mapping {index + 1}</legend>
        <label>Applies to<select value={mapping.groupId ? "group" : "type"} onChange={event => {
          const { role, stepId } = mapping;
          updateMapping(index,event.target.value === "group" ? { groupId: settings.groups[0].id, role, stepId }
            : { groupType: groupTypes[0], role, stepId: stepId ?? steps[0]?.id ?? null });
        }}>
          <option value="type" disabled={!groupTypes.length}>Group type</option>
          <option value="group" disabled={!settings.groups.length}>Specific group</option>
        </select></label>
        {mapping.groupId ? <label>Group<select value={mapping.groupId} onChange={event => updateMapping(index,{ ...mapping,groupId:event.target.value })}>
          {!settings.groups.some(group => group.id === mapping.groupId) && <option value={mapping.groupId}>Unavailable group</option>}
          {settings.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
        </select></label> : <label>Group type<select value={mapping.groupType} onChange={event => updateMapping(index,{ ...mapping,groupType:event.target.value })}>
          {mapping.groupType && !groupTypes.includes(mapping.groupType) && <option value={mapping.groupType}>Unavailable group type</option>}
          {groupTypes.map(type => <option key={type} value={type}>{type}</option>)}
        </select></label>}
        <label>Membership role<input required maxLength={80} value={mapping.role}
          onChange={event => updateMapping(index,{ ...mapping, role:event.target.value })} /></label>
        <label>Step<select required={!mapping.groupId} value={mapping.stepId ?? ""}
          onChange={event => updateMapping(index,{ ...mapping, stepId:event.target.value || null })}>
          <option value="" disabled={!mapping.groupId}>{mapping.groupId ? "Suppress inherited step" : "Choose a step"}</option>
          {steps.map(step => <option key={step.id} value={step.id}>{step.name}</option>)}
        </select></label>
        <button type="button" onClick={() => setMappings(mappings.filter((_,position) => position !== index))}>Remove mapping</button>
      </fieldset>)}
      <button type="button" disabled={!settings.groups.length || !steps.length || mappings.length >= 1000} onClick={() => {
        const role = "";
        const stepId = steps[0].id;
        setMappings([...mappings,groupTypes.length ? { groupType:groupTypes[0],role,stepId } : { groupId:settings.groups[0].id,role,stepId }]);
      }}>Add role mapping</button>
    </fieldset>
    <fieldset disabled={busy}>
      <legend>Privacy</legend>
      <label>Who can see a person's growth trajectory<select value={visibility} onChange={(event) => setVisibility(event.target.value as Visibility)}>
        <option value="people_managers">People managers</option>
        <option value="private_people">Everyone with private People access</option>
      </select></label>
    </fieldset>
    <button type="submit" disabled={!changed || busy}>Save growth trajectory</button>
    {error && <p role="alert">{error}</p>}
  </form>;
}

type Progress = { current: Step | null; achieved: Step[] };
export function PersonGrowthTrajectory({ contactId, request, realtime, manager }: { contactId: string; request: Request; realtime?: ModuleRealtime; manager: boolean }) {
  const [progress,setProgress] = useState<Progress | null>(null);
  const [error,setError] = useState("");
  const [revision,setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => { setProgress(null); setRevision(current => current + 1); };
    const off = ["people-records:changed","core:groups:changed","realtime:connected"].map(topic => realtime?.subscribe(topic,refresh));
    return () => off.forEach(unsubscribe => unsubscribe?.());
  }, [realtime]);
  useEffect(() => {
    const controller = new AbortController();
    setProgress(null);
    setError("");
    void request<Progress | { visible: false }>(`/api/people-records/${contactId}/growth-trajectory`,{ signal:controller.signal })
      .then(data => { if (!controller.signal.aborted) setProgress("visible" in data ? null : data); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load the growth trajectory."); });
    return () => controller.abort();
  }, [contactId,request,revision]);
  if (!manager && !progress) return null;
  return <details>
    <summary>Growth trajectory</summary>
    <button type="button" onClick={() => setRevision(revision + 1)}>Refresh trajectory</button>
    {error && <p role="alert">{error}</p>}
    {!progress && !error && <p role="status">Loading growth trajectory…</p>}
    {progress?.current && <>
      <p>Current step <strong>{progress.current.name}</strong></p>
      <p>Steps reached through active memberships</p>
      <ul>{progress.achieved.map(step => <li key={step.id}>{step.name}</li>)}</ul>
    </>}
    {progress && !progress.current && <p>No active group roles map to a growth step.</p>}
  </details>;
}
