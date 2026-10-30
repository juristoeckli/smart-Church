import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Music2, Plus, Search, Trash2, X } from "lucide-react";
import type { ServicePlanItem, ServicePlanTemplate, WorshipSong, WorshipSongArrangement } from "@smart-church/contracts";
import { getActiveLanguage, translate } from "./i18n";
import { translateModuleMessage } from "./modules/translations";

type Tab = "songs" | "plans";
type SongDraft = Omit<WorshipSong, "id" | "arrangements"> & { id?: string; arrangements: Array<Omit<WorshipSongArrangement, "id"> & { id?: string }> };
type PlanDraft = Omit<ServicePlanTemplate, "id"> & { id?: string };

const emptySong = (): SongDraft => ({ title: "", authors: "", defaultKey: "", notes: "", arrangements: [], active: true });
const emptyPlan = (): PlanDraft => ({ name: "", description: "", positions: [], items: [], active: true });
const localizedError = (message: string) => translateModuleMessage("core-events", getActiveLanguage(), message);

export function WorshipPlanning({ departmentId, canManage, onClose, onChanged, onNotice }: { departmentId: string; canManage: boolean; onClose: () => void; onChanged: () => void; onNotice: (message: string) => void }) {
  const [tab, setTab] = useState<Tab>("songs");
  const [songs, setSongs] = useState<WorshipSong[]>([]);
  const [plans, setPlans] = useState<ServicePlanTemplate[]>([]);
  const [songDraft, setSongDraft] = useState<SongDraft | null>(null);
  const [planDraft, setPlanDraft] = useState<PlanDraft | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load(signal?: AbortSignal) {
    setLoading(true); setError("");
    try {
      const headers = { "x-department-id": departmentId };
      const [songResponse, planResponse] = await Promise.all([
        fetch("/api/worship/songs", { headers, signal }),
        fetch("/api/service-plan-templates", { headers, signal }),
      ]);
      const [songData, planData] = await Promise.all([songResponse.json(), planResponse.json()]) as [WorshipSong[] | { error?: string }, ServicePlanTemplate[] | { error?: string }];
      if (!songResponse.ok || !Array.isArray(songData)) throw new Error(!Array.isArray(songData) ? songData.error ?? translate("events.worshipLoadFailed") : translate("events.worshipLoadFailed"));
      if (!planResponse.ok || !Array.isArray(planData)) throw new Error(!Array.isArray(planData) ? planData.error ?? translate("events.worshipLoadFailed") : translate("events.worshipLoadFailed"));
      setSongs(songData); setPlans(planData);
    } catch (cause) {
      if (!signal?.aborted) setError(localizedError(cause instanceof Error ? cause.message : "The worship library is unavailable."));
    } finally { if (!signal?.aborted) setLoading(false); }
  }

  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [departmentId]);

  const filteredSongs = useMemo(() => {
    const value = search.trim().toLocaleLowerCase();
    return songs.filter((song) => song.active && (!value || `${song.title} ${song.authors ?? ""}`.toLocaleLowerCase().includes(value)));
  }, [songs, search]);

  function updateArrangement(index: number, patch: Partial<WorshipSongArrangement>) {
    setSongDraft((current) => current ? { ...current, arrangements: current.arrangements.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) } : current);
  }

  async function saveSong(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!songDraft) return;
    setBusy(true);
    try {
      const { id, ...body } = songDraft;
      const response = await fetch(id ? `/api/worship/songs/${id}` : "/api/worship/songs", { method: id ? "PUT" : "POST", headers: { "content-type": "application/json", "x-department-id": departmentId }, body: JSON.stringify(body) });
      const result = await response.json() as WorshipSong | { error?: string };
      if (!response.ok || !("id" in result)) throw new Error("error" in result ? result.error ?? translate("events.worshipLoadFailed") : translate("events.worshipLoadFailed"));
      setSongs((current) => [...current.filter((item) => item.id !== result.id), result].sort((a, b) => a.title.localeCompare(b.title)));
      setSongDraft(null); onChanged(); onNotice(localizedError(id ? "Song updated." : "Song saved."));
    } catch (cause) { onNotice(localizedError(cause instanceof Error ? cause.message : "Could not save this song.")); }
    finally { setBusy(false); }
  }

  async function archiveSong(song: WorshipSong) {
    if (!window.confirm(`${translate("events.archiveSong")}: ${song.title}?`)) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/worship/songs/${song.id}`, { method: "DELETE", headers: { "x-department-id": departmentId } });
      const result = await response.json() as { archived?: true; error?: string };
      if (!response.ok || !result.archived) throw new Error(result.error ?? translate("events.worshipLoadFailed"));
      setSongs((current) => current.filter((item) => item.id !== song.id)); setSongDraft(null); onChanged(); onNotice(localizedError("Song archived."));
    } catch (cause) { onNotice(localizedError(cause instanceof Error ? cause.message : "The worship library is unavailable.")); }
    finally { setBusy(false); }
  }

  async function savePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!planDraft) return;
    setBusy(true);
    try {
      const { id, ...body } = planDraft;
      const response = await fetch(id ? `/api/service-plan-templates/${id}` : "/api/service-plan-templates", { method: id ? "PUT" : "POST", headers: { "content-type": "application/json", "x-department-id": departmentId }, body: JSON.stringify(body) });
      const result = await response.json() as ServicePlanTemplate | { error?: string };
      if (!response.ok || !("id" in result)) throw new Error("error" in result ? result.error ?? translate("events.worshipLoadFailed") : translate("events.worshipLoadFailed"));
      setPlans((current) => [...current.filter((item) => item.id !== result.id), result].sort((a, b) => a.name.localeCompare(b.name)));
      setPlanDraft(null); onChanged(); onNotice(localizedError(id ? "Service-plan template updated." : "Service-plan template saved."));
    } catch (cause) { onNotice(localizedError(cause instanceof Error ? cause.message : "Could not save this service plan.")); }
    finally { setBusy(false); }
  }

  async function archivePlan(plan: ServicePlanTemplate) {
    if (!window.confirm(`${translate("events.archiveTemplate")}: ${plan.name}?`)) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/service-plan-templates/${plan.id}`, { method: "DELETE", headers: { "x-department-id": departmentId } });
      const result = await response.json() as { archived?: true; error?: string };
      if (!response.ok || !result.archived) throw new Error(result.error ?? translate("events.worshipLoadFailed"));
      setPlans((current) => current.filter((item) => item.id !== plan.id)); setPlanDraft(null); onChanged(); onNotice(localizedError("Service-plan template archived."));
    } catch (cause) { onNotice(localizedError(cause instanceof Error ? cause.message : "Service-plan templates are unavailable.")); }
    finally { setBusy(false); }
  }

  function updatePlanItem(index: number, patch: Partial<ServicePlanItem>) {
    setPlanDraft((current) => current ? { ...current, items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) } : current);
  }

  return <div className="modal-backdrop worship-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="modal worship-modal" role="dialog" aria-modal="true" aria-labelledby="worship-title">
      <div className="modal-heading"><div><span className="eyebrow">{translate("events.worshipLibrary")}</span><h2 id="worship-title">{translate("events.worshipLibrary")}</h2><p>{translate("events.songCatalogHelp")}</p></div><button className="icon-button" type="button" aria-label={translate("events.close")} onClick={onClose}><X size={19} /></button></div>
      <div className="filter-tabs worship-tabs" role="tablist" aria-label={translate("events.worshipLibrary")}>
        <button className={tab === "songs" ? "filter-tab filter-tab-active" : "filter-tab"} type="button" role="tab" aria-selected={tab === "songs"} onClick={() => { setTab("songs"); setSongDraft(null); setPlanDraft(null); }}>{translate("events.songCatalog")} <span>{songs.length}</span></button>
        <button className={tab === "plans" ? "filter-tab filter-tab-active" : "filter-tab"} type="button" role="tab" aria-selected={tab === "plans"} onClick={() => { setTab("plans"); setSongDraft(null); setPlanDraft(null); }}>{translate("events.servicePlanTemplates")} <span>{plans.length}</span></button>
      </div>
      {error && <p className="user-access-feedback user-access-feedback-error" role="alert">{error}</p>}
      {loading ? <p className="community-empty">{translate("events.loadingWorship")}</p> : tab === "songs" ? <div className="worship-content">
        <div className="worship-toolbar"><label className="search-field"><Search size={16} /><input aria-label={translate("events.searchSongs")} placeholder={translate("events.searchSongs")} value={search} onChange={(event) => setSearch(event.target.value)} /></label>{canManage && <button className="button button-primary" type="button" onClick={() => setSongDraft(emptySong())}><Plus size={15} />{translate("events.addSong")}</button>}</div>
        {songDraft && canManage ? <form className="worship-editor" onSubmit={(event) => void saveSong(event)}>
          <div className="worship-editor-heading"><h3>{songDraft.id ? translate("events.songTitle") : translate("events.addSong")}</h3><button className="icon-button" type="button" aria-label={translate("events.close")} onClick={() => setSongDraft(null)}><X size={17} /></button></div>
          <div className="form-row"><label>{translate("events.songTitle")}<input required maxLength={200} value={songDraft.title} onChange={(event) => setSongDraft((current) => current ? { ...current, title: event.target.value } : current)} /></label><label>{translate("events.authors")}<input maxLength={500} value={songDraft.authors ?? ""} onChange={(event) => setSongDraft((current) => current ? { ...current, authors: event.target.value } : current)} /></label><label>{translate("events.defaultKey")}<input maxLength={16} value={songDraft.defaultKey ?? ""} onChange={(event) => setSongDraft((current) => current ? { ...current, defaultKey: event.target.value } : current)} /></label></div>
          <label>{translate("events.songNotes")}<textarea rows={2} maxLength={2000} value={songDraft.notes ?? ""} onChange={(event) => setSongDraft((current) => current ? { ...current, notes: event.target.value } : current)} /></label>
          <div className="worship-section-heading"><strong>{translate("events.arrangements")}</strong><button className="button button-secondary" type="button" onClick={() => setSongDraft((current) => current ? { ...current, arrangements: [...current.arrangements, { name: "", active: true }] } : current)}><Plus size={14} />{translate("events.addArrangement")}</button></div>
          {songDraft.arrangements.map((arrangement, index) => <div className="worship-arrangement" key={arrangement.id ?? index}><label>{translate("events.arrangementName")}<input required maxLength={160} value={arrangement.name} onChange={(event) => updateArrangement(index, { name: event.target.value })} /></label><label>{translate("events.defaultKey")}<input maxLength={16} value={arrangement.key ?? ""} onChange={(event) => updateArrangement(index, { key: event.target.value })} /></label><label>{translate("events.chartLink")}<input type="url" maxLength={2048} placeholder="https://" value={arrangement.chartUrl ?? ""} onChange={(event) => updateArrangement(index, { chartUrl: event.target.value })} /></label><label>{translate("events.audioLink")}<input type="url" maxLength={2048} placeholder="https://" value={arrangement.audioUrl ?? ""} onChange={(event) => updateArrangement(index, { audioUrl: event.target.value })} /></label><button className="community-row-action community-row-delete" type="button" aria-label={translate("events.archiveSong")} onClick={() => setSongDraft((current) => current ? { ...current, arrangements: current.arrangements.filter((_, itemIndex) => itemIndex !== index) } : current)}><Trash2 size={14} /></button></div>)}
          <p className="worship-license-notice">{translate("events.linkLicenseNotice")}</p><div className="form-actions">{songDraft.id && <button className="button button-danger" type="button" disabled={busy} onClick={() => { const current = songs.find((song) => song.id === songDraft.id); if (current) void archiveSong(current); }}><Trash2 size={14} />{translate("events.archiveSong")}</button>}<button className="button button-secondary" type="button" onClick={() => setSongDraft(null)}>{translate("events.cancel")}</button><button className="button button-primary" type="submit" disabled={busy}>{translate("events.saveSong")}</button></div>
        </form> : <div className="worship-list">{filteredSongs.map((song) => <article className="worship-list-item" key={song.id}><div className="worship-list-icon"><Music2 size={18} /></div><div className="worship-list-info"><strong>{song.title}</strong><small>{[song.authors, song.defaultKey].filter(Boolean).join(" · ") || translate("events.arrangements")}</small>{song.arrangements.filter((arrangement) => arrangement.active).map((arrangement) => <small key={arrangement.id}>{arrangement.name}{arrangement.key ? ` · ${arrangement.key}` : ""}{arrangement.chartUrl && <> · <a href={arrangement.chartUrl} target="_blank" rel="noreferrer">{translate("events.chartLink")}</a></>}{arrangement.audioUrl && <> · <a href={arrangement.audioUrl} target="_blank" rel="noreferrer">{translate("events.audioLink")}</a></>}</small>)}</div>{canManage && <button className="button button-secondary" type="button" onClick={() => setSongDraft({ ...song, arrangements: song.arrangements.filter((arrangement) => arrangement.active).map((arrangement) => ({ ...arrangement })) })}>{translate("events.editSong")}</button>}</article>)}{filteredSongs.length === 0 && <p className="community-empty">{translate("events.noSongs")}</p>}</div>}
      </div> : <div className="worship-content">
        {canManage && <div className="worship-toolbar"><span>{translate("events.planTemplatesHelp")}</span><button className="button button-primary" type="button" onClick={() => setPlanDraft(emptyPlan())}><Plus size={15} />{translate("events.addTemplate")}</button></div>}
        {planDraft && canManage ? <form className="worship-editor" onSubmit={(event) => void savePlan(event)}>
          <div className="worship-editor-heading"><h3>{planDraft.id ? planDraft.name : translate("events.addTemplate")}</h3><button className="icon-button" type="button" aria-label={translate("events.close")} onClick={() => setPlanDraft(null)}><X size={17} /></button></div>
          <label>{translate("events.templateName")}<input required maxLength={160} value={planDraft.name} onChange={(event) => setPlanDraft((current) => current ? { ...current, name: event.target.value } : current)} /></label>
          <label>{translate("events.templateDescription")}<textarea rows={2} maxLength={1000} value={planDraft.description ?? ""} onChange={(event) => setPlanDraft((current) => current ? { ...current, description: event.target.value } : current)} /></label>
          <div className="worship-section-heading"><strong>{translate("events.planPositions")}</strong><button className="button button-secondary" type="button" onClick={() => setPlanDraft((current) => current ? { ...current, positions: [...current.positions, { name: "" }] } : current)}><Plus size={14} />{translate("events.addPosition")}</button></div>
          {planDraft.positions.map((position, index) => <div className="worship-position" key={index}><input aria-label={translate("events.planPositions")} required maxLength={80} value={position.name} onChange={(event) => setPlanDraft((current) => current ? { ...current, positions: current.positions.map((item, itemIndex) => itemIndex === index ? { name: event.target.value } : item) } : current)} /><button className="community-row-action community-row-delete" type="button" aria-label={translate("events.remove")} onClick={() => setPlanDraft((current) => current ? { ...current, positions: current.positions.filter((_, itemIndex) => itemIndex !== index) } : current)}><Trash2 size={14} /></button></div>)}
          <div className="worship-section-heading"><strong>{translate("events.planItems")}</strong><button className="button button-secondary" type="button" onClick={() => setPlanDraft((current) => current ? { ...current, items: [...current.items, { title: "" }] } : current)}><Plus size={14} />{translate("events.addPlanItem")}</button></div>
          {planDraft.items.map((item, index) => {
            const selectedSong = songs.find((song) => song.id === item.songId);
            return <div className="worship-plan-item" key={index}><div className="worship-plan-item-heading"><strong>{translate("events.planItems")} {index + 1}</strong><div><button className="community-row-action" type="button" aria-label={`${translate("events.planItems")} ${translate("events.add")}`} disabled={index === 0} onClick={() => setPlanDraft((current) => { if (!current) return current; const items = [...current.items]; [items[index - 1], items[index]] = [items[index], items[index - 1]]; return { ...current, items }; })}><ArrowUp size={14} /></button><button className="community-row-action" type="button" aria-label={`${translate("events.planItems")} ${translate("events.add")}`} disabled={index === planDraft.items.length - 1} onClick={() => setPlanDraft((current) => { if (!current) return current; const items = [...current.items]; [items[index], items[index + 1]] = [items[index + 1], items[index]]; return { ...current, items }; })}><ArrowDown size={14} /></button><button className="community-row-action community-row-delete" type="button" aria-label={translate("events.remove")} onClick={() => setPlanDraft((current) => current ? { ...current, items: current.items.filter((_, itemIndex) => itemIndex !== index) } : current)}><Trash2 size={14} /></button></div></div>
              <div className="form-row"><label>{translate("events.chooseSong")}<select value={item.songId ?? ""} onChange={(event) => { const song = songs.find((candidate) => candidate.id === event.target.value); updatePlanItem(index, { songId: song?.id, arrangementId: undefined, title: song?.title ?? item.title }); }}><option value="">{translate("events.noSong")}</option>{songs.filter((song) => song.active).map((song) => <option key={song.id} value={song.id}>{song.title}</option>)}</select></label>{selectedSong && <label>{translate("events.arrangement")}<select value={item.arrangementId ?? ""} onChange={(event) => updatePlanItem(index, { arrangementId: event.target.value || undefined })}><option value="">{translate("events.noSong")}</option>{selectedSong.arrangements.filter((arrangement) => arrangement.active).map((arrangement) => <option key={arrangement.id} value={arrangement.id}>{arrangement.name}{arrangement.key ? ` · ${arrangement.key}` : ""}</option>)}</select></label>}</div>
              <div className="form-row"><label>{translate("events.planItems")}<input required maxLength={160} value={item.title} onChange={(event) => updatePlanItem(index, { title: event.target.value })} /></label><label>{translate("events.startTime")}<input type="time" value={item.startTime ?? ""} onChange={(event) => updatePlanItem(index, { startTime: event.target.value || undefined })} /></label><label>{translate("events.minutes")}<input type="number" min="1" max="1440" value={item.durationMinutes ?? ""} onChange={(event) => updatePlanItem(index, { durationMinutes: event.target.value ? Number(event.target.value) : undefined })} /></label></div>
              <label>{translate("events.itemNotes")}<input maxLength={500} value={item.notes ?? ""} onChange={(event) => updatePlanItem(index, { notes: event.target.value })} /></label>
            </div>;
          })}
          <div className="form-actions">{planDraft.id && <button className="button button-danger" type="button" disabled={busy} onClick={() => { const current = plans.find((plan) => plan.id === planDraft.id); if (current) void archivePlan(current); }}><Trash2 size={14} />{translate("events.archiveTemplate")}</button>}<button className="button button-secondary" type="button" onClick={() => setPlanDraft(null)}>{translate("events.cancel")}</button><button className="button button-primary" type="submit" disabled={busy}>{translate("events.saveTemplate")}</button></div>
        </form> : <div className="worship-list">{plans.map((plan) => <article className="worship-list-item" key={plan.id}><div className="worship-list-icon"><Music2 size={18} /></div><div className="worship-list-info"><strong>{plan.name}</strong>{plan.description && <small>{plan.description}</small>}<small>{plan.positions.map((position) => position.name).join(" · ")}</small><small>{plan.items.map((item) => item.title).join(" → ")}</small></div>{canManage && <button className="button button-secondary" type="button" onClick={() => setPlanDraft({ ...plan, positions: plan.positions.map((position) => ({ ...position })), items: plan.items.map((item) => ({ ...item })) })}>{translate("events.editTemplate")}</button>}</article>)}{plans.length === 0 && <p className="community-empty">{translate("events.noTemplates")}</p>}</div>}
      </div>}
      <div className="form-actions worship-footer"><button className="button button-secondary" type="button" onClick={onClose}>{translate("events.close")}</button></div>
    </section>
  </div>;
}

