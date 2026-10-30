import { useEffect, useState } from "react";
import type { UserLanguage } from "@smart-church/contracts";
import { getActiveLanguage } from "../../i18n";
import { ModuleTranslationHost } from "../../module-registry";

type RemoteStep = { id: string; name: string };
type StepLink = { sourceStepId: string; sourceStepPresent: boolean; localStepId: string; localStepTitle: string };
type RemoteFlow = {
  sourceFlowId: string; name: string; snapshotUpdatedAt: string | null; sourceMissing: boolean;
  remoteSteps: RemoteStep[]; localFlowId: string | null; localFlowName: string | null; localFlowStatus: string | null;
  stepLinks: StepLink[]; assignmentCount: number; linkedAssignmentCount: number; unmatchedAssignmentCount: number;
};
type LocalFlow = { id: string; name: string; status: string; steps: Array<{ id: string; title: string; position: number; active: boolean }> };
type CrosswalkData = { flows: RemoteFlow[]; localFlows: LocalFlow[] };
type Locale = Record<string, string>;
const crosswalkTranslations: Partial<Record<UserLanguage, Locale>> = {
  de: {
    "Link Elvanto People Flows to local workflows": "Elvanto-People-Flows mit lokalen Workflows verknüpfen",
    "Links are explicit and use stable flow and step IDs. Imported snapshots remain read-only and never change native workflow data. People are matched only through existing Elvanto person IDs.": "Die Verknüpfungen werden ausdrücklich gesetzt und verwenden stabile Flow- und Schritt-IDs. Importierte Snapshots bleiben schreibgeschützt und ändern keine nativen Workflows. Personen werden nur über vorhandene Elvanto-Personen-IDs zugeordnet.",
    "Choose an Elvanto flow": "Elvanto-Flow auswählen",
    "Select a local workflow": "Lokalen Workflow auswählen",
    "Map Elvanto steps to local steps": "Elvanto-Schritte lokalen Schritten zuordnen",
    "No local step": "Kein lokaler Schritt",
    "Unlinked": "Nicht verknüpft",
    "Save links": "Verknüpfungen speichern",
    "No imported Elvanto People Flows are available. Import them from Elvanto first.": "Es sind keine importierten Elvanto-People-Flows vorhanden. Importiere sie zuerst aus Elvanto.",
    "people assignments": "Personenzuweisungen",
    "linked": "verknüpft",
    "unmatched": "nicht zugeordnet",
    "Source flow missing": "Quell-Flow fehlt",
    "This flow no longer appears in the latest Elvanto snapshot. Its link is retained for review; no remote or local workflow was changed.": "Dieser Flow ist im neuesten Elvanto-Snapshot nicht mehr vorhanden. Die Verknüpfung bleibt zur Prüfung erhalten; weder der entfernte noch der lokale Workflow wurde geändert.",
    "The Elvanto flow or step changed or disappeared. Refresh the imported snapshot before saving links.": "Der Elvanto-Flow oder -Schritt wurde geändert oder ist nicht mehr vorhanden. Aktualisiere den importierten Snapshot vor dem Speichern.",
    "Every linked local step must belong to the selected workflow.": "Jeder verknüpfte lokale Schritt muss zum ausgewählten Workflow gehören.",
    "This local workflow or step is already linked to another Elvanto record.": "Dieser lokale Workflow oder Schritt ist bereits mit einem anderen Elvanto-Eintrag verknüpft.",
    "Choose a local workflow before linking its steps.": "Wähle einen lokalen Workflow aus, bevor du seine Schritte verknüpfst.",
    "Import this Elvanto People Flow before linking it.": "Importiere diesen Elvanto-People-Flow, bevor du ihn verknüpfst.",
    "Each Elvanto and local step can be linked only once.": "Jeder Elvanto- und lokale Schritt kann nur einmal verknüpft werden.",
    "Choose an Elvanto flow and a local workflow.": "Wähle einen Elvanto-Flow und einen lokalen Workflow aus.",
    "Workflow links saved.": "Workflow-Verknüpfungen gespeichert.",
    "Could not load People Flow links.": "People-Flow-Verknüpfungen konnten nicht geladen werden.",
    "Could not save People Flow links.": "People-Flow-Verknüpfungen konnten nicht gespeichert werden.",
    "Loading…": "Wird geladen …",
    "Saving…": "Wird gespeichert …",
    "active": "aktiv",
    "archived": "archiviert",
    "Remove stale link": "Veraltete Verknüpfung entfernen",
    "· Source flow missing": "· Quell-Flow fehlt",
  },
  fr: {
    "Link Elvanto People Flows to local workflows": "Lier les People Flows Elvanto aux workflows locaux",
    "Links are explicit and use stable flow and step IDs. Imported snapshots remain read-only and never change native workflow data. People are matched only through existing Elvanto person IDs.": "Les liens sont définis explicitement et utilisent les identifiants stables des workflows et étapes. Les instantanés importés restent en lecture seule et ne modifient jamais les workflows locaux. Les personnes sont associées uniquement à l’aide de leurs identifiants Elvanto existants.",
    "Choose an Elvanto flow": "Choisir un flow Elvanto",
    "Select a local workflow": "Choisir un workflow local",
    "Map Elvanto steps to local steps": "Associer les étapes Elvanto aux étapes locales",
    "No local step": "Aucune étape locale",
    "Unlinked": "Non lié",
    "Save links": "Enregistrer les liens",
    "No imported Elvanto People Flows are available. Import them from Elvanto first.": "Aucun People Flow Elvanto importé n’est disponible. Importez-les d’abord depuis Elvanto.",
    "people assignments": "attributions de personnes",
    "linked": "liées",
    "unmatched": "sans correspondance",
    "Source flow missing": "Flow source manquant",
    "This flow no longer appears in the latest Elvanto snapshot. Its link is retained for review; no remote or local workflow was changed.": "Ce flow n’apparaît plus dans le dernier instantané Elvanto. Le lien est conservé pour examen ; aucun workflow local ou distant n’a été modifié.",
    "The Elvanto flow or step changed or disappeared. Refresh the imported snapshot before saving links.": "Le flow ou l’étape Elvanto a changé ou a disparu. Actualisez l’instantané importé avant d’enregistrer les liens.",
    "Every linked local step must belong to the selected workflow.": "Chaque étape locale liée doit appartenir au workflow sélectionné.",
    "This local workflow or step is already linked to another Elvanto record.": "Ce workflow ou cette étape locale est déjà lié à un autre enregistrement Elvanto.",
    "Choose a local workflow before linking its steps.": "Choisissez un workflow local avant d’en lier les étapes.",
    "Import this Elvanto People Flow before linking it.": "Importez ce People Flow Elvanto avant de le lier.",
    "Each Elvanto and local step can be linked only once.": "Chaque étape Elvanto et locale ne peut être liée qu’une seule fois.",
    "Choose an Elvanto flow and a local workflow.": "Choisissez un flow Elvanto et un workflow local.",
    "Workflow links saved.": "Liens des workflows enregistrés.",
    "Could not load People Flow links.": "Impossible de charger les liens des People Flows.",
    "Could not save People Flow links.": "Impossible d’enregistrer les liens des People Flows.",
    "Loading…": "Chargement…",
    "Saving…": "Enregistrement…",
    "active": "actif",
    "archived": "archivé",
    "Remove stale link": "Supprimer le lien obsolète",
    "· Source flow missing": "· Flow source manquant",
  },
  it: {
    "Link Elvanto People Flows to local workflows": "Collega i People Flow Elvanto ai workflow locali",
    "Links are explicit and use stable flow and step IDs. Imported snapshots remain read-only and never change native workflow data. People are matched only through existing Elvanto person IDs.": "I collegamenti sono espliciti e usano ID stabili per flow e passaggi. Le copie importate restano di sola lettura e non modificano i workflow locali. Le persone vengono associate solo tramite ID Elvanto già esistenti.",
    "Choose an Elvanto flow": "Scegli un flow Elvanto",
    "Select a local workflow": "Scegli un workflow locale",
    "Map Elvanto steps to local steps": "Associa i passaggi Elvanto a quelli locali",
    "No local step": "Nessun passaggio locale",
    "Unlinked": "Non collegato",
    "Save links": "Salva collegamenti",
    "No imported Elvanto People Flows are available. Import them from Elvanto first.": "Non sono disponibili People Flow Elvanto importati. Importali prima da Elvanto.",
    "people assignments": "assegnazioni di persone",
    "linked": "collegate",
    "unmatched": "senza corrispondenza",
    "Source flow missing": "Flow sorgente mancante",
    "This flow no longer appears in the latest Elvanto snapshot. Its link is retained for review; no remote or local workflow was changed.": "Questo flow non compare più nell’ultimo snapshot Elvanto. Il collegamento viene conservato per la verifica; nessun workflow locale o remoto è stato modificato.",
    "The Elvanto flow or step changed or disappeared. Refresh the imported snapshot before saving links.": "Il flow o il passaggio Elvanto è cambiato o non è più disponibile. Aggiorna lo snapshot importato prima di salvare i collegamenti.",
    "Every linked local step must belong to the selected workflow.": "Ogni passaggio locale collegato deve appartenere al workflow selezionato.",
    "This local workflow or step is already linked to another Elvanto record.": "Questo workflow o passaggio locale è già collegato a un altro record Elvanto.",
    "Choose a local workflow before linking its steps.": "Scegli un workflow locale prima di collegarne i passaggi.",
    "Import this Elvanto People Flow before linking it.": "Importa questo People Flow Elvanto prima di collegarlo.",
    "Each Elvanto and local step can be linked only once.": "Ogni passaggio Elvanto e locale può essere collegato una sola volta.",
    "Choose an Elvanto flow and a local workflow.": "Scegli un flow Elvanto e un workflow locale.",
    "Workflow links saved.": "Collegamenti dei workflow salvati.",
    "Could not load People Flow links.": "Impossibile caricare i collegamenti dei People Flow.",
    "Could not save People Flow links.": "Impossibile salvare i collegamenti dei People Flow."
  }
};

export function ElvantoPeopleFlowCrosswalk({ departmentId }: { departmentId: string }) {
  const language = getActiveLanguage();
  const [data, setData] = useState<CrosswalkData | null>(null);
  const [sourceFlowId, setSourceFlowId] = useState("");
  const [localFlowId, setLocalFlowId] = useState("");
  const [stepSelection, setStepSelection] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selected = data?.flows.find((flow) => flow.sourceFlowId === sourceFlowId) ?? null;
  const localFlows = data?.localFlows ?? [];
  const selectedLocal = localFlows.find((flow) => flow.id === localFlowId) ?? null;

  async function load() {
    setError("");
    try {
      const response = await fetch("/api/people-flows/elvanto-crosswalk", { headers: { "x-department-id": departmentId }, cache: "no-store" });
      const result = await response.json() as CrosswalkData | { error?: string };
      if (!response.ok || !("flows" in result)) throw new Error("error" in result ? result.error ?? "Could not load People Flow links." : "Could not load People Flow links.");
      setData(result);
      setSourceFlowId((current) => result.flows.some((flow) => flow.sourceFlowId === current) ? current : result.flows[0]?.sourceFlowId ?? "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load People Flow links.");
    }
  }

  useEffect(() => { void load(); }, [departmentId]);

  useEffect(() => {
    setLocalFlowId(selected?.localFlowId ?? "");
    setStepSelection(Object.fromEntries((selected?.stepLinks ?? []).map((link) => [link.sourceStepId, link.localStepId])));
    setNotice("");
  }, [selected?.sourceFlowId, selected?.localFlowId, selected?.stepLinks]);

  async function save() {
    if (!selected) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/people-flows/elvanto-crosswalk", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-department-id": departmentId },
        body: JSON.stringify({
          sourceFlowId: selected.sourceFlowId,
          localFlowId: localFlowId || null,
          stepLinks: Object.entries(stepSelection).filter(([, localStepId]) => Boolean(localStepId)).map(([sourceStepId, localStepId]) => ({ sourceStepId, localStepId })),
        }),
      });
      const result = await response.json() as { error?: string; saved?: boolean };
      if (!response.ok) throw new Error(result.error ?? "Could not save People Flow links.");
      setNotice("Workflow links saved.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save People Flow links.");
    } finally {
      setBusy(false);
    }
  }

  return <ModuleTranslationHost translations={crosswalkTranslations} language={language}>
    <section className="sync-connection-form" aria-live="polite">
      <h3>Link Elvanto People Flows to local workflows</h3>
      <p className="sync-help">Links are explicit and use stable flow and step IDs. Imported snapshots remain read-only and never change native workflow data. People are matched only through existing Elvanto person IDs.</p>
      {error && <p className="sync-inline-error" role="alert">{error}</p>}
      {!data ? <p className="sync-help">Loading…</p> : data.flows.length === 0 ? <p className="sync-help">No imported Elvanto People Flows are available. Import them from Elvanto first.</p> : <>
        <label>Choose an Elvanto flow<select value={sourceFlowId} onChange={(event) => setSourceFlowId(event.target.value)}>{data.flows.map((flow) => <option key={flow.sourceFlowId} value={flow.sourceFlowId}>{flow.name}{flow.sourceMissing ? " · missing" : ""}</option>)}</select></label>
        {selected && <>
          <p className="sync-help"><span>{selected.assignmentCount} people assignments</span> · <span>{selected.linkedAssignmentCount} linked</span> · <span>{selected.unmatchedAssignmentCount} unmatched</span></p>
          {selected.sourceMissing && <p className="sync-inline-error" role="alert">This flow no longer appears in the latest Elvanto snapshot. Its link is retained for review; no remote or local workflow was changed.</p>}
          <label>Select a local workflow<select value={localFlowId} disabled={busy} onChange={(event) => { setLocalFlowId(event.target.value); setStepSelection({}); }}><>{selected.sourceMissing && selected.localFlowId && <option value={selected.localFlowId} disabled>{selected.localFlowName} · Source flow missing</option>}<option value="">{selected.sourceMissing ? "Remove stale link" : "Unlinked"}</option>{!selected.sourceMissing && localFlows.map((flow) => <option key={flow.id} value={flow.id}>{flow.name} · {flow.status}</option>)}</>}</select></label>
          {selectedLocal && !selected.sourceMissing && <fieldset className="module-rights-fieldset"><legend>Map Elvanto steps to local steps</legend>{selected.remoteSteps.map((remoteStep) => <label className="module-right-option" key={remoteStep.id}><span><strong>{remoteStep.name}</strong>{!remoteStep.name && <small>{remoteStep.id}</small>}</span><select value={stepSelection[remoteStep.id] ?? ""} disabled={busy || selected.sourceMissing} onChange={(event) => setStepSelection((current) => ({ ...current, [remoteStep.id]: event.target.value }))}><option value="">No local step</option>{(selectedLocal?.steps ?? []).filter((step) => step.active).map((step) => <option key={step.id} value={step.id}>{step.title}</option>)}</select></label>)}</fieldset>}
          {selected?.stepLinks.some((link) => !link.sourceStepPresent) && <p className="sync-inline-error" role="alert">The Elvanto flow or step changed or disappeared. Refresh the imported snapshot before saving links.</p>}
          {notice && <p className="sync-feedback" role="status">{notice}</p>}
          <div className="community-inline-actions"><button className="button button-primary" type="button" disabled={busy || (!localFlowId && !selected.sourceMissing) || selected.stepLinks.some((link) => !link.sourceStepPresent)} onClick={() => void save()}>{busy ? "Saving…" : selected.sourceMissing && !localFlowId ? "Remove stale link" : "Save links"}</button></div>
        </>}
      </>}
    </section>
  </ModuleTranslationHost>;
}
