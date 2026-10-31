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
type ExportSample = { name: string; sourceStepId: string; state: string };
type ExportRun = { runId: string; status: string; total: number; queued: number; added: number; alreadyAssigned: number; unmatched: number; ambiguous: number; stale: number; uncertain: number; cursor: number; skipped: number; expiresAt?: string; sample?: ExportSample[] };
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
    "Export local assignments to Elvanto": "Lokale Zuweisungen nach Elvanto exportieren",
    "Only pending steps in active assignments with an existing Elvanto person ID are eligible. People are never created and remote assignments are never removed. Review the preview before exporting.": "Nur offene Schritte aktiver Zuweisungen mit einer vorhandenen Elvanto-Personen-ID sind geeignet. Personen werden nie erstellt und entfernte Zuweisungen nie gelöscht. Prüfe die Vorschau vor dem Export.",
    "Elvanto may notify step admins according to its flow settings. This export does not choose an Elvanto step admin.": "Elvanto kann die Schrittadministratoren gemäss den Flow-Einstellungen benachrichtigen. Dieser Export wählt keinen Elvanto-Schrittadministrator aus.",
    "Preview assignments": "Zuweisungen vorschauen",
    "Export assignments": "Zuweisungen exportieren",
    "Continue export": "Export fortsetzen",
    "New assignments": "Neue Zuweisungen",
    "Already assigned": "Bereits zugewiesen",
    "People without an Elvanto link": "Personen ohne Elvanto-Verknüpfung",
    "Assignments added": "Hinzugefügte Zuweisungen",
    "Skipped assignments": "Übersprungene Zuweisungen",
    "Export outcome uncertain": "Exportergebnis unklar",
    "Run a fresh preview to continue.": "Erstelle eine neue Vorschau, um fortzufahren.",
    "New assignment": "Neue Zuweisung",
    "No Elvanto person link": "Keine Elvanto-Personenverknüpfung",
    "Multiple local contacts share this Elvanto person ID": "Mehrere lokale Kontakte verwenden dieselbe Elvanto-Personen-ID",
    "Added": "Hinzugefügt",
    "Stale": "Veraltet",
    "Uncertain": "Unklar",
    "total": "gesamt",
    "queued": "offen",
    "added": "hinzugefügt",
    "already assigned": "bereits zugewiesen",
    "people without an Elvanto link": "Personen ohne Elvanto-Verknüpfung",
    "multiple local contacts share an Elvanto person ID": "Mehrere lokale Kontakte verwenden dieselbe Elvanto-Personen-ID",
    "stale": "veraltet",
    "skipped": "übersprungen",
    "Complete": "Abgeschlossen",
    "People Flow export progress": "People-Flow-Exportfortschritt",
    "Exporting…": "Wird exportiert …",
    "This location is read-only while it is configured as a redundancy standby.": "Dieser Standort ist schreibgeschützt, solange er als Redundanz-Standby konfiguriert ist.",
    "This location became read-only before the Elvanto write. No assignment was sent.": "Dieser Standort wurde vor dem Elvanto-Schreibvorgang schreibgeschützt. Es wurde keine Zuweisung gesendet.",
    "Reconnect Elvanto before exporting People Flow assignments.": "Verbinde Elvanto erneut, bevor du People-Flow-Zuweisungen exportierst.",
    "Elvanto key encryption is unavailable.": "Die Verschlüsselung des Elvanto-Schlüssels ist nicht verfügbar.",
    "Elvanto returned an oversized People Flow response.": "Elvanto hat eine zu grosse People-Flow-Antwort zurückgegeben.",
    "Elvanto returned an invalid JSON response.": "Elvanto hat eine ungültige JSON-Antwort zurückgegeben.",
    "Could not load assignment export status.": "Der Status des Zuweisungsexports konnte nicht geladen werden.",
    "Could not preview People Flow assignments.": "Die People-Flow-Zuweisungen konnten nicht in der Vorschau angezeigt werden.",
    "Could not export People Flow assignments.": "Die People-Flow-Zuweisungen konnten nicht exportiert werden.",
    "Connect Elvanto before exporting People Flow assignments.": "Verbinde Elvanto, bevor du People-Flow-Zuweisungen exportierst.",
    "Select Smart Church to Elvanto or bidirectional People Flows sync before exporting assignments.": "Wähle für People Flows Smart Church nach Elvanto oder bidirektionale Synchronisierung, bevor du Zuweisungen exportierst.",
    "Link this imported Elvanto flow to an active local workflow before exporting assignments.": "Verknüpfe diesen importierten Elvanto-Flow mit einem aktiven lokalen Workflow, bevor du Zuweisungen exportierst.",
    "Activate the linked local workflow before exporting assignments.": "Aktiviere den verknüpften lokalen Workflow, bevor du Zuweisungen exportierst.",
    "Refresh the imported Elvanto flow before exporting assignments.": "Aktualisiere den importierten Elvanto-Flow, bevor du Zuweisungen exportierst.",
    "Map at least one Elvanto step to a local step before exporting assignments.": "Ordne mindestens einen Elvanto-Schritt einem lokalen Schritt zu, bevor du Zuweisungen exportierst.",
    "A mapped Elvanto or local step changed. Refresh the imported flow and review its links before exporting.": "Ein verknüpfter Elvanto- oder lokaler Schritt wurde geändert. Aktualisiere den importierten Flow und prüfe die Verknüpfungen vor dem Export.",
    "This People Flow export preview expired. Run a fresh preview before writing.": "Diese Vorschau des People-Flow-Exports ist abgelaufen. Erstelle vor dem Schreiben eine neue Vorschau.",
    "A previous Elvanto write has an uncertain result. Run a fresh preview before continuing; the exporter will check remote assignments first.": "Das Ergebnis eines vorherigen Elvanto-Schreibvorgangs ist unklar. Erstelle eine neue Vorschau; der Export prüft zuerst die entfernten Zuweisungen.",
    "Elvanto did not confirm the write outcome. No automatic retry was made; run a fresh preview to check whether the assignment was added.": "Elvanto hat das Ergebnis des Schreibvorgangs nicht bestätigt. Es gab keinen automatischen Wiederholungsversuch. Erstelle eine neue Vorschau, um zu prüfen, ob die Zuweisung hinzugefügt wurde.",
    "Elvanto connection or sync direction changed after preview. Run a fresh preview before writing.": "Die Elvanto-Verbindung oder Synchronisierungsrichtung wurde nach der Vorschau geändert. Erstelle vor dem Schreiben eine neue Vorschau.",
    "This People Flow export is already running in another request.": "Dieser People-Flow-Export läuft bereits in einer anderen Anfrage.",
    "People Flow export preview not found.": "Die Vorschau des People-Flow-Exports wurde nicht gefunden.",
    "This export contains more than 20,000 assignments. Narrow the workflow scope before previewing.": "Dieser Export enthält mehr als 20.000 Zuweisungen. Begrenze den Workflow-Bereich vor der Vorschau.",
    "Elvanto returned a People Flow assignment without a stable person ID.": "Elvanto hat eine People-Flow-Zuweisung ohne stabile Personen-ID zurückgegeben.",
    "Elvanto returned an incomplete People Flow assignment list.": "Elvanto hat eine unvollständige Liste von People-Flow-Zuweisungen zurückgegeben.",
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
    "Export local assignments to Elvanto": "Exporter les attributions locales vers Elvanto",
    "Only pending steps in active assignments with an existing Elvanto person ID are eligible. People are never created and remote assignments are never removed. Review the preview before exporting.": "Seules les étapes en attente des attributions actives associées à un identifiant Elvanto existant sont admissibles. Aucune personne n’est créée et aucune attribution distante n’est supprimée. Vérifiez l’aperçu avant l’export.",
    "Elvanto may notify step admins according to its flow settings. This export does not choose an Elvanto step admin.": "Elvanto peut notifier les administrateurs d’étape selon les paramètres du flow. Cet export ne choisit pas d’administrateur d’étape Elvanto.",
    "Preview assignments": "Prévisualiser les attributions",
    "Export assignments": "Exporter les attributions",
    "Continue export": "Continuer l’export",
    "New assignments": "Nouvelles attributions",
    "Already assigned": "Déjà attribuées",
    "People without an Elvanto link": "Personnes sans lien Elvanto",
    "Assignments added": "Attributions ajoutées",
    "Skipped assignments": "Attributions ignorées",
    "Export outcome uncertain": "Résultat de l’export incertain",
    "Run a fresh preview to continue.": "Créez un nouvel aperçu pour continuer.",
    "New assignment": "Nouvelle attribution",
    "No Elvanto person link": "Aucun lien avec une personne Elvanto",
    "Multiple local contacts share this Elvanto person ID": "Plusieurs contacts locaux utilisent cet identifiant de personne Elvanto",
    "Added": "Ajoutée",
    "Stale": "Obsolète",
    "Uncertain": "Incertain",
    "total": "au total",
    "queued": "en attente",
    "added": "ajoutées",
    "already assigned": "déjà attribuées",
    "people without an Elvanto link": "personnes sans lien Elvanto",
    "multiple local contacts share an Elvanto person ID": "plusieurs contacts locaux utilisent le même identifiant Elvanto",
    "stale": "obsolètes",
    "skipped": "ignorées",
    "Complete": "Terminé",
    "People Flow export progress": "Progression de l’export People Flow",
    "Exporting…": "Exportation…",
    "This location is read-only while it is configured as a redundancy standby.": "Cet emplacement est en lecture seule lorsqu’il est configuré comme serveur de secours redondant.",
    "This location became read-only before the Elvanto write. No assignment was sent.": "Cet emplacement est passé en lecture seule avant l’écriture Elvanto. Aucune attribution n’a été envoyée.",
    "Reconnect Elvanto before exporting People Flow assignments.": "Reconnectez Elvanto avant d’exporter les attributions People Flow.",
    "Elvanto key encryption is unavailable.": "Le chiffrement de la clé Elvanto est indisponible.",
    "Elvanto returned an oversized People Flow response.": "Elvanto a renvoyé une réponse People Flow trop volumineuse.",
    "Elvanto returned an invalid JSON response.": "Elvanto a renvoyé une réponse JSON invalide.",
    "Could not load assignment export status.": "Impossible de charger l’état de l’export des attributions.",
    "Could not preview People Flow assignments.": "Impossible de prévisualiser les attributions People Flow.",
    "Could not export People Flow assignments.": "Impossible d’exporter les attributions People Flow.",
    "Connect Elvanto before exporting People Flow assignments.": "Connectez Elvanto avant d’exporter les attributions People Flow.",
    "Select Smart Church to Elvanto or bidirectional People Flows sync before exporting assignments.": "Sélectionnez la synchronisation People Flows Smart Church vers Elvanto ou bidirectionnelle avant l’export.",
    "Link this imported Elvanto flow to an active local workflow before exporting assignments.": "Liez ce flow Elvanto importé à un workflow local actif avant d’exporter les attributions.",
    "Activate the linked local workflow before exporting assignments.": "Activez le workflow local lié avant d’exporter les attributions.",
    "Refresh the imported Elvanto flow before exporting assignments.": "Actualisez le flow Elvanto importé avant d’exporter les attributions.",
    "Map at least one Elvanto step to a local step before exporting assignments.": "Associez au moins une étape Elvanto à une étape locale avant l’export.",
    "A mapped Elvanto or local step changed. Refresh the imported flow and review its links before exporting.": "Une étape Elvanto ou locale associée a changé. Actualisez le flow importé et vérifiez ses liens avant l’export.",
    "This People Flow export preview expired. Run a fresh preview before writing.": "L’aperçu de l’export People Flow a expiré. Créez un nouvel aperçu avant l’écriture.",
    "A previous Elvanto write has an uncertain result. Run a fresh preview before continuing; the exporter will check remote assignments first.": "Le résultat d’une écriture Elvanto précédente est incertain. Créez un nouvel aperçu ; l’export vérifiera d’abord les attributions distantes.",
    "Elvanto did not confirm the write outcome. No automatic retry was made; run a fresh preview to check whether the assignment was added.": "Elvanto n’a pas confirmé le résultat de l’écriture. Aucun nouvel essai automatique n’a été effectué ; créez un nouvel aperçu pour vérifier si l’attribution a été ajoutée.",
    "Elvanto connection or sync direction changed after preview. Run a fresh preview before writing.": "La connexion Elvanto ou le sens de synchronisation a changé après l’aperçu. Créez un nouvel aperçu avant l’écriture.",
    "This People Flow export is already running in another request.": "Cet export People Flow est déjà en cours dans une autre requête.",
    "People Flow export preview not found.": "Aperçu de l’export People Flow introuvable.",
    "This export contains more than 20,000 assignments. Narrow the workflow scope before previewing.": "Cet export contient plus de 20 000 attributions. Réduisez le périmètre du workflow avant l’aperçu.",
    "Elvanto returned a People Flow assignment without a stable person ID.": "Elvanto a renvoyé une attribution People Flow sans identifiant de personne stable.",
    "Elvanto returned an incomplete People Flow assignment list.": "Elvanto a renvoyé une liste incomplète d’attributions People Flow.",
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
    "Could not save People Flow links.": "Impossibile salvare i collegamenti dei People Flow.",
    "Export local assignments to Elvanto": "Esporta le assegnazioni locali in Elvanto",
    "Only pending steps in active assignments with an existing Elvanto person ID are eligible. People are never created and remote assignments are never removed. Review the preview before exporting.": "Sono idonei solo i passaggi in sospeso delle assegnazioni attive con un ID persona Elvanto esistente. Le persone non vengono mai create e le assegnazioni remote non vengono mai rimosse. Controlla l’anteprima prima dell’esportazione.",
    "Elvanto may notify step admins according to its flow settings. This export does not choose an Elvanto step admin.": "Elvanto può avvisare gli amministratori dei passaggi secondo le impostazioni del flow. Questa esportazione non seleziona un amministratore Elvanto.",
    "Preview assignments": "Anteprima assegnazioni",
    "Export assignments": "Esporta assegnazioni",
    "Continue export": "Continua esportazione",
    "New assignments": "Nuove assegnazioni",
    "Already assigned": "Già assegnate",
    "People without an Elvanto link": "Persone senza collegamento Elvanto",
    "Assignments added": "Assegnazioni aggiunte",
    "Skipped assignments": "Assegnazioni ignorate",
    "Export outcome uncertain": "Esito dell’esportazione incerto",
    "Run a fresh preview to continue.": "Crea una nuova anteprima per continuare.",
    "New assignment": "Nuova assegnazione",
    "No Elvanto person link": "Nessun collegamento a una persona Elvanto",
    "Multiple local contacts share this Elvanto person ID": "Più contatti locali usano questo ID persona Elvanto",
    "Added": "Aggiunta",
    "Stale": "Obsoleta",
    "Uncertain": "Incerto",
    "total": "totali",
    "queued": "in coda",
    "added": "aggiunte",
    "already assigned": "già assegnate",
    "people without an Elvanto link": "persone senza collegamento Elvanto",
    "multiple local contacts share an Elvanto person ID": "più contatti locali usano lo stesso ID persona Elvanto",
    "stale": "obsolete",
    "skipped": "ignorate",
    "Complete": "Completato",
    "People Flow export progress": "Avanzamento esportazione People Flow",
    "Exporting…": "Esportazione…",
    "This location is read-only while it is configured as a redundancy standby.": "Questa sede è in sola lettura quando è configurata come standby ridondante.",
    "This location became read-only before the Elvanto write. No assignment was sent.": "Questa sede è diventata di sola lettura prima della scrittura Elvanto. Non è stata inviata alcuna assegnazione.",
    "Reconnect Elvanto before exporting People Flow assignments.": "Ricollega Elvanto prima di esportare le assegnazioni People Flow.",
    "Elvanto key encryption is unavailable.": "La crittografia della chiave Elvanto non è disponibile.",
    "Elvanto returned an oversized People Flow response.": "Elvanto ha restituito una risposta People Flow troppo grande.",
    "Elvanto returned an invalid JSON response.": "Elvanto ha restituito una risposta JSON non valida.",
    "Could not load assignment export status.": "Impossibile caricare lo stato dell’esportazione delle assegnazioni.",
    "Could not preview People Flow assignments.": "Impossibile visualizzare l’anteprima delle assegnazioni People Flow.",
    "Could not export People Flow assignments.": "Impossibile esportare le assegnazioni People Flow.",
    "Connect Elvanto before exporting People Flow assignments.": "Collega Elvanto prima di esportare le assegnazioni People Flow.",
    "Select Smart Church to Elvanto or bidirectional People Flows sync before exporting assignments.": "Seleziona la sincronizzazione People Flows da Smart Church a Elvanto o bidirezionale prima di esportare le assegnazioni.",
    "Link this imported Elvanto flow to an active local workflow before exporting assignments.": "Collega questo flow Elvanto importato a un workflow locale attivo prima di esportare le assegnazioni.",
    "Activate the linked local workflow before exporting assignments.": "Attiva il workflow locale collegato prima di esportare le assegnazioni.",
    "Refresh the imported Elvanto flow before exporting assignments.": "Aggiorna il flow Elvanto importato prima di esportare le assegnazioni.",
    "Map at least one Elvanto step to a local step before exporting assignments.": "Associa almeno un passaggio Elvanto a un passaggio locale prima di esportare le assegnazioni.",
    "A mapped Elvanto or local step changed. Refresh the imported flow and review its links before exporting.": "Un passaggio Elvanto o locale collegato è cambiato. Aggiorna il flow importato e controlla i collegamenti prima di esportare.",
    "This People Flow export preview expired. Run a fresh preview before writing.": "L’anteprima dell’esportazione People Flow è scaduta. Crea una nuova anteprima prima di scrivere.",
    "A previous Elvanto write has an uncertain result. Run a fresh preview before continuing; the exporter will check remote assignments first.": "L’esito di una precedente scrittura Elvanto non è certo. Crea una nuova anteprima; l’esportazione controllerà prima le assegnazioni remote.",
    "Elvanto did not confirm the write outcome. No automatic retry was made; run a fresh preview to check whether the assignment was added.": "Elvanto non ha confermato l’esito della scrittura. Non è stato effettuato alcun nuovo tentativo automatico; crea una nuova anteprima per verificare se l’assegnazione è stata aggiunta.",
    "Elvanto connection or sync direction changed after preview. Run a fresh preview before writing.": "La connessione Elvanto o la direzione di sincronizzazione è cambiata dopo l’anteprima. Crea una nuova anteprima prima di scrivere.",
    "This People Flow export is already running in another request.": "Questa esportazione People Flow è già in corso in un'altra richiesta.",
    "People Flow export preview not found.": "Anteprima dell’esportazione People Flow non trovata.",
    "This export contains more than 20,000 assignments. Narrow the workflow scope before previewing.": "Questa esportazione contiene più di 20.000 assegnazioni. Restringi l’ambito del workflow prima dell’anteprima.",
    "Elvanto returned a People Flow assignment without a stable person ID.": "Elvanto ha restituito un’assegnazione People Flow senza un ID persona stabile.",
    "Elvanto returned an incomplete People Flow assignment list.": "Elvanto ha restituito un elenco incompleto di assegnazioni People Flow."
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
  const [exportRun, setExportRun] = useState<ExportRun | null>(null);

  const selected = data?.flows.find((flow) => flow.sourceFlowId === sourceFlowId) ?? null;
  const localFlows = data?.localFlows ?? [];
  const selectedLocal = localFlows.find((flow) => flow.id === localFlowId) ?? null;
  const savedMappings = (selected?.stepLinks ?? []).map((link) => `${link.sourceStepId}:${link.localStepId}`).sort().join("|");
  const currentMappings = Object.entries(stepSelection).filter(([, localStepId]) => Boolean(localStepId)).map(([sourceStepId, localStepId]) => `${sourceStepId}:${localStepId}`).sort().join("|");
  const exportMappingReady = Boolean(selected?.localFlowId && selected.localFlowId === localFlowId && selectedLocal?.status === "active" && savedMappings && savedMappings === currentMappings && !selected.sourceMissing && !selected.stepLinks.some((link) => !link.sourceStepPresent));

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
    setExportRun(null);
  }, [selected?.sourceFlowId, selected?.localFlowId, selected?.stepLinks]);

  useEffect(() => {
    if (!selected?.sourceFlowId) return;
    let canceled = false;
    void fetch(`/api/people-flows/elvanto-crosswalk/export-status?sourceFlowId=${encodeURIComponent(selected.sourceFlowId)}`, { headers: { "x-department-id": departmentId }, cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as { run?: ExportRun | null; error?: string };
        if (!response.ok) throw new Error(result.error ?? "Could not load assignment export status.");
        if (!canceled) setExportRun(result.run ?? null);
      })
      .catch((reason) => { if (!canceled) setError(reason instanceof Error ? reason.message : "Could not load assignment export status."); });
    return () => { canceled = true; };
  }, [selected?.sourceFlowId, departmentId]);

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

  async function previewAssignments() {
    if (!selected || !exportMappingReady) return;
    setBusy(true); setError(""); setExportRun(null);
    try {
      const response = await fetch("/api/people-flows/elvanto-crosswalk/export-preview", {
        method: "POST",
        headers: { "content-type": "application/json", "x-department-id": departmentId },
        body: JSON.stringify({ sourceFlowId: selected.sourceFlowId }),
      });
      const result = await response.json() as ExportRun & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not preview People Flow assignments.");
      setExportRun({ ...result, added: 0, stale: 0, uncertain: 0, cursor: 0, skipped: result.unmatched });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not preview People Flow assignments.");
    } finally { setBusy(false); }
  }

  async function continueExport() {
    if (!exportRun) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/people-flows/elvanto-crosswalk/export", {
        method: "POST",
        headers: { "content-type": "application/json", "x-department-id": departmentId },
        body: JSON.stringify({ runId: exportRun.runId }),
      });
      const result = await response.json() as ExportRun & { error?: string; complete?: boolean };
      if (!response.ok) throw new Error(result.error ?? "Could not export People Flow assignments.");
      setExportRun((current) => current ? { ...current, ...result } : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not export People Flow assignments.");
      const response = await fetch(`/api/people-flows/elvanto-crosswalk/export-status?sourceFlowId=${encodeURIComponent(selected?.sourceFlowId ?? "")}`, { headers: { "x-department-id": departmentId }, cache: "no-store" }).catch(() => null);
      if (response?.ok) { const result = await response.json() as { run?: ExportRun | null }; setExportRun(result.run ?? null); }
    } finally { setBusy(false); }
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
          <label>Select a local workflow<select value={localFlowId} disabled={busy} onChange={(event) => { setLocalFlowId(event.target.value); setStepSelection({}); }}>{selected.sourceMissing && selected.localFlowId && <option value={selected.localFlowId} disabled>{selected.localFlowName} · Source flow missing</option>}<option value="">{selected.sourceMissing ? "Remove stale link" : "Unlinked"}</option>{!selected.sourceMissing && localFlows.map((flow) => <option key={flow.id} value={flow.id}>{flow.name} · {flow.status}</option>)}</select></label>
          {selectedLocal && !selected.sourceMissing && <fieldset className="module-rights-fieldset"><legend>Map Elvanto steps to local steps</legend>{selected.remoteSteps.map((remoteStep) => <label className="module-right-option" key={remoteStep.id}><span><strong>{remoteStep.name}</strong>{!remoteStep.name && <small>{remoteStep.id}</small>}</span><select value={stepSelection[remoteStep.id] ?? ""} disabled={busy || selected.sourceMissing} onChange={(event) => setStepSelection((current) => ({ ...current, [remoteStep.id]: event.target.value }))}><option value="">No local step</option>{(selectedLocal?.steps ?? []).filter((step) => step.active).map((step) => <option key={step.id} value={step.id}>{step.title}</option>)}</select></label>)}</fieldset>}
          {selected?.stepLinks.some((link) => !link.sourceStepPresent) && <p className="sync-inline-error" role="alert">The Elvanto flow or step changed or disappeared. Refresh the imported snapshot before saving links.</p>}
          {notice && <p className="sync-feedback" role="status">{notice}</p>}
          <div className="community-inline-actions"><button className="button button-primary" type="button" disabled={busy || (!localFlowId && !selected.sourceMissing) || selected.stepLinks.some((link) => !link.sourceStepPresent)} onClick={() => void save()}>{busy ? "Saving…" : selected.sourceMissing && !localFlowId ? "Remove stale link" : "Save links"}</button></div>
          {exportMappingReady && <div className="sync-connection-form">
            <h4>Export local assignments to Elvanto</h4>
            <p className="sync-help">Only pending steps in active assignments with an existing Elvanto person ID are eligible. People are never created and remote assignments are never removed. Review the preview before exporting.</p>
            <p className="sync-help">Elvanto may notify step admins according to its flow settings. This export does not choose an Elvanto step admin.</p>
            {exportRun && <div className="sync-feedback" aria-live="polite">
              <strong>{exportRun.status === "uncertain" ? "Export outcome uncertain" : exportRun.status === "complete" ? "Complete" : "People Flow export progress"}</strong>
              <span>{exportRun.total} total</span> · <span>{exportRun.queued} queued</span> · <span>{exportRun.added} added</span> · <span>{exportRun.alreadyAssigned} already assigned</span> · <span>{exportRun.unmatched} people without an Elvanto link</span> · <span>{exportRun.ambiguous} multiple local contacts share an Elvanto person ID</span> · <span>{exportRun.stale} stale</span> · <span>{exportRun.skipped} skipped</span>
              {exportRun.status === "uncertain" && <span>Run a fresh preview to continue.</span>}
              {exportRun.sample?.map((row, index) => <span key={`${row.sourceStepId}:${index}`}>{row.name} · {selected.remoteSteps.find((step) => step.id === row.sourceStepId)?.name ?? row.sourceStepId} · {row.state === "queued" ? "New assignment" : row.state === "already_assigned" ? "Already assigned" : row.state === "unmatched" ? "No Elvanto person link" : row.state === "ambiguous" ? "Multiple local contacts share this Elvanto person ID" : row.state === "added" ? "Added" : row.state === "stale" ? "Stale" : row.state === "uncertain" ? "Uncertain" : row.state}</span>)}
            </div>}
            <div className="community-inline-actions">
              <button className="button button-secondary" type="button" disabled={busy} onClick={() => void previewAssignments()}>{busy ? "Loading…" : "Preview assignments"}</button>
              {exportRun && (exportRun.status === "preview" || exportRun.status === "running") && <button className="button button-primary" type="button" disabled={busy || exportRun.uncertain > 0} onClick={() => void continueExport()}>{busy ? "Exporting…" : exportRun.status === "running" || exportRun.cursor > 0 ? "Continue export" : "Export assignments"}</button>}
            </div>
          </div>}
        </>}
      </>}
    </section>
  </ModuleTranslationHost>;
}
