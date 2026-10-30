import { lazy } from "react";
import { RefreshCw } from "lucide-react";
import type { ModuleRegistration, ModuleSettingsContext } from "../../module-registry";
import { translationsForModule } from "../translations";
import { SyncModule } from "./SyncModule";

function SyncSettings({ departmentId, csrfToken }: ModuleSettingsContext) {
  return <SyncModule departmentId={departmentId} csrfToken={csrfToken} settingsPanel />;
}

const syncExportErrorTranslations: NonNullable<ModuleRegistration["translations"]> = {
  de: {
    "Connect Elvanto before previewing a song export.": "Verbinde Elvanto, bevor du einen Songexport in der Vorschau anzeigst.",
    "Set Songs direction to Smart Church → Elvanto or bidirectional before previewing an export.": "Setze die Songrichtung vor der Exportvorschau auf Smart Church → Elvanto oder bidirektional.",
    "Could not read the complete Elvanto Songs list. No export preview was saved.": "Die vollständige Elvanto-Songliste konnte nicht gelesen werden. Es wurde keine Exportvorschau gespeichert.",
    "This location has more than 200,000 songs. Narrow the export scope before retrying.": "Dieser Standort hat mehr als 200.000 Songs. Grenze den Exportumfang ein und versuche es erneut.",
    "A Songs export is already running for this location.": "An diesem Standort läuft bereits ein Songexport.",
    "Connect Elvanto before exporting songs.": "Verbinde Elvanto, bevor du Songs exportierst.",
    "Set Songs direction to Smart Church → Elvanto or bidirectional before exporting.": "Setze die Songrichtung vor dem Export auf Smart Church → Elvanto oder bidirektional.",
    "Run a complete Songs export preview first. Previews expire after one hour.": "Erstelle zuerst eine vollständige Songexport-Vorschau. Vorschauen laufen nach einer Stunde ab.",
    "Another Elvanto sync is running for this location.": "An diesem Standort läuft bereits eine andere Elvanto-Synchronisierung.",
    "The preview expired or another Songs export is running. Run a new preview.": "Die Vorschau ist abgelaufen oder ein anderer Songexport läuft. Erstelle eine neue Vorschau.",
    "A local song or arrangement changed after preview. Review a fresh Songs export preview before writing.": "Ein lokaler Song oder ein Arrangement wurde nach der Vorschau geändert. Prüfe vor dem Schreiben eine neue Songexport-Vorschau.",
    "The linked Elvanto song changed after preview. Review a fresh Songs export preview before writing.": "Der verknüpfte Elvanto-Song wurde nach der Vorschau geändert. Prüfe vor dem Schreiben eine neue Songexport-Vorschau.",
    "An Elvanto song now matches this title. The preview was invalidated; review a fresh preview before creating a duplicate.": "Ein Elvanto-Song hat jetzt denselben Titel. Die Vorschau wurde ungültig; prüfe vor dem Erstellen eines Duplikats eine neue Vorschau.",
    "Connect Elvanto before exporting calendar events.": "Verbinde Elvanto, bevor du Kalendertermine exportierst.",
    "Connect Elvanto before previewing calendar export.": "Verbinde Elvanto, bevor du den Kalenderexport in der Vorschau anzeigst.",
    "Set Calendar direction to Smart Church → Elvanto or bidirectional before previewing an export.": "Setze die Kalenderrichtung vor der Exportvorschau auf Smart Church → Elvanto oder bidirektional.",
    "A Calendar export is already running for this location.": "An diesem Standort läuft bereits ein Kalenderexport.",
    "Calendar export start date must be on or before the end date.": "Das Startdatum des Kalenderexports muss am oder vor dem Enddatum liegen.",
    "Choose a valid Elvanto destination calendar.": "Wähle einen gültigen Elvanto-Zielkalender.",
    "Choose a valid Elvanto event organizer.": "Wähle einen gültigen Elvanto-Veranstalter.",
    "The location time zone is not configured.": "Die Zeitzone des Standorts ist nicht konfiguriert.",
    "Calendar export previews support up to 20,000 local events at a time. Narrow the events included in the local schedule before creating a preview.": "Kalenderexport-Vorschauen unterstützen höchstens 20.000 lokale Termine. Grenze die Termine im lokalen Zeitplan ein, bevor du eine Vorschau erstellst.",
    "Could not read the complete Elvanto Calendar list. No export preview was saved.": "Die vollständige Elvanto-Kalenderliste konnte nicht gelesen werden. Es wurde keine Exportvorschau gespeichert.",
    "An Elvanto operation is running or connection settings changed. Try the preview again.": "Ein Elvanto-Vorgang läuft oder die Verbindungseinstellungen wurden geändert. Erstelle die Vorschau erneut.",
    "Set Calendar direction to Smart Church → Elvanto or bidirectional before exporting.": "Setze die Kalenderrichtung vor dem Export auf Smart Church → Elvanto oder bidirektional.",
    "Run a complete Calendar export preview first. Previews expire after one hour and after connection settings change.": "Erstelle zuerst eine vollständige Kalenderexport-Vorschau. Sie läuft nach einer Stunde oder nach Änderungen der Verbindungseinstellungen ab.",
    "The preview expired, settings changed, or another Elvanto operation is running. Run a fresh complete Calendar export preview.": "Die Vorschau ist abgelaufen, die Einstellungen wurden geändert oder ein anderer Elvanto-Vorgang läuft. Erstelle eine neue vollständige Kalenderexport-Vorschau.",
    "Could not verify the complete Elvanto Calendar list. No events were written.": "Die vollständige Elvanto-Kalenderliste konnte nicht überprüft werden. Es wurden keine Termine geschrieben.",
    "A local event changed after preview. Run a fresh Calendar export preview before writing.": "Ein lokaler Termin wurde nach der Vorschau geändert. Erstelle vor dem Schreiben eine neue Kalenderexport-Vorschau.",
    "An Elvanto event changed or disappeared after preview. Run a fresh Calendar export preview.": "Ein Elvanto-Termin wurde nach der Vorschau geändert oder ist verschwunden. Erstelle eine neue Kalenderexport-Vorschau.",
    "A matching Elvanto calendar event appeared after preview. Run a fresh Calendar export preview.": "Nach der Vorschau ist ein passender Elvanto-Kalendertermin erschienen. Erstelle eine neue Kalenderexport-Vorschau."
  },
  fr: {
    "Connect Elvanto before previewing a song export.": "Connectez Elvanto avant de prévisualiser l’export des chants.",
    "Set Songs direction to Smart Church → Elvanto or bidirectional before previewing an export.": "Réglez le sens des chants sur Smart Church → Elvanto ou bidirectionnel avant de prévisualiser l’export.",
    "Could not read the complete Elvanto Songs list. No export preview was saved.": "Impossible de lire la liste complète des chants Elvanto. Aucun aperçu d’export n’a été enregistré.",
    "This location has more than 200,000 songs. Narrow the export scope before retrying.": "Ce site contient plus de 200 000 chants. Réduisez le périmètre de l’export avant de réessayer.",
    "A Songs export is already running for this location.": "Un export de chants est déjà en cours pour ce site.",
    "Connect Elvanto before exporting songs.": "Connectez Elvanto avant d’exporter les chants.",
    "Set Songs direction to Smart Church → Elvanto or bidirectional before exporting.": "Réglez le sens des chants sur Smart Church → Elvanto ou bidirectionnel avant l’export.",
    "Run a complete Songs export preview first. Previews expire after one hour.": "Créez d’abord un aperçu complet de l’export des chants. Les aperçus expirent après une heure.",
    "Another Elvanto sync is running for this location.": "Une autre synchronisation Elvanto est en cours pour ce site.",
    "The preview expired or another Songs export is running. Run a new preview.": "L’aperçu a expiré ou un autre export de chants est en cours. Créez un nouvel aperçu.",
    "A local song or arrangement changed after preview. Review a fresh Songs export preview before writing.": "Un chant ou un arrangement local a changé depuis l’aperçu. Vérifiez un nouvel aperçu de l’export avant toute écriture.",
    "The linked Elvanto song changed after preview. Review a fresh Songs export preview before writing.": "Le chant Elvanto lié a changé depuis l’aperçu. Vérifiez un nouvel aperçu de l’export avant toute écriture.",
    "An Elvanto song now matches this title. The preview was invalidated; review a fresh preview before creating a duplicate.": "Un chant Elvanto porte maintenant ce titre. L’aperçu a été invalidé ; vérifiez-en un nouveau avant de créer un doublon.",
    "Connect Elvanto before exporting calendar events.": "Connectez Elvanto avant d’exporter les événements du calendrier.",
    "Connect Elvanto before previewing calendar export.": "Connectez Elvanto avant de prévisualiser l’export du calendrier.",
    "Set Calendar direction to Smart Church → Elvanto or bidirectional before previewing an export.": "Réglez le sens du calendrier sur Smart Church → Elvanto ou bidirectionnel avant de prévisualiser l’export.",
    "A Calendar export is already running for this location.": "Un export du calendrier est déjà en cours pour ce site.",
    "Calendar export start date must be on or before the end date.": "La date de début de l’export du calendrier doit précéder ou être égale à la date de fin.",
    "Choose a valid Elvanto destination calendar.": "Choisissez un calendrier Elvanto de destination valide.",
    "Choose a valid Elvanto event organizer.": "Choisissez un organisateur d’événement Elvanto valide.",
    "The location time zone is not configured.": "Le fuseau horaire du site n’est pas configuré.",
    "Calendar export previews support up to 20,000 local events at a time. Narrow the events included in the local schedule before creating a preview.": "Les aperçus d’export du calendrier prennent en charge jusqu’à 20 000 événements locaux. Réduisez leur nombre avant de créer un aperçu.",
    "Could not read the complete Elvanto Calendar list. No export preview was saved.": "Impossible de lire la liste complète du calendrier Elvanto. Aucun aperçu d’export n’a été enregistré.",
    "An Elvanto operation is running or connection settings changed. Try the preview again.": "Une opération Elvanto est en cours ou les paramètres de connexion ont changé. Réessayez l’aperçu.",
    "Set Calendar direction to Smart Church → Elvanto or bidirectional before exporting.": "Réglez le sens du calendrier sur Smart Church → Elvanto ou bidirectionnel avant l’export.",
    "Run a complete Calendar export preview first. Previews expire after one hour and after connection settings change.": "Créez d’abord un aperçu complet de l’export du calendrier. Il expire après une heure ou après une modification des paramètres de connexion.",
    "The preview expired, settings changed, or another Elvanto operation is running. Run a fresh complete Calendar export preview.": "L’aperçu a expiré, les paramètres ont changé ou une autre opération Elvanto est en cours. Créez un nouvel aperçu complet de l’export du calendrier.",
    "Could not verify the complete Elvanto Calendar list. No events were written.": "Impossible de vérifier la liste complète du calendrier Elvanto. Aucun événement n’a été écrit.",
    "A local event changed after preview. Run a fresh Calendar export preview before writing.": "Un événement local a changé depuis l’aperçu. Créez un nouvel aperçu de l’export avant toute écriture.",
    "An Elvanto event changed or disappeared after preview. Run a fresh Calendar export preview.": "Un événement Elvanto a changé ou disparu depuis l’aperçu. Créez un nouvel aperçu complet de l’export du calendrier.",
    "A matching Elvanto calendar event appeared after preview. Run a fresh Calendar export preview.": "Un événement Elvanto correspondant est apparu depuis l’aperçu. Créez un nouvel aperçu de l’export du calendrier."
  },
  it: {
    "Connect Elvanto before previewing a song export.": "Collega Elvanto prima di visualizzare l’anteprima dell’esportazione dei brani.",
    "Set Songs direction to Smart Church → Elvanto or bidirectional before previewing an export.": "Imposta la direzione dei brani su Smart Church → Elvanto o bidirezionale prima di visualizzare l’anteprima.",
    "Could not read the complete Elvanto Songs list. No export preview was saved.": "Impossibile leggere l’elenco completo dei brani Elvanto. Non è stata salvata alcuna anteprima.",
    "This location has more than 200,000 songs. Narrow the export scope before retrying.": "Questa sede contiene più di 200.000 brani. Riduci l’ambito dell’esportazione e riprova.",
    "A Songs export is already running for this location.": "È già in corso un’esportazione dei brani per questa sede.",
    "Connect Elvanto before exporting songs.": "Collega Elvanto prima di esportare i brani.",
    "Set Songs direction to Smart Church → Elvanto or bidirectional before exporting.": "Imposta la direzione dei brani su Smart Church → Elvanto o bidirezionale prima di esportare.",
    "Run a complete Songs export preview first. Previews expire after one hour.": "Crea prima un’anteprima completa dell’esportazione dei brani. Le anteprime scadono dopo un’ora.",
    "Another Elvanto sync is running for this location.": "È già in corso un’altra sincronizzazione Elvanto per questa sede.",
    "The preview expired or another Songs export is running. Run a new preview.": "L’anteprima è scaduta o è in corso un’altra esportazione dei brani. Crea una nuova anteprima.",
    "A local song or arrangement changed after preview. Review a fresh Songs export preview before writing.": "Un brano o un arrangiamento locale è cambiato dopo l’anteprima. Controlla una nuova anteprima prima di scrivere.",
    "The linked Elvanto song changed after preview. Review a fresh Songs export preview before writing.": "Il brano Elvanto collegato è cambiato dopo l’anteprima. Controlla una nuova anteprima prima di scrivere.",
    "An Elvanto song now matches this title. The preview was invalidated; review a fresh preview before creating a duplicate.": "Ora esiste un brano Elvanto con questo titolo. L’anteprima non è più valida; controllane una nuova prima di creare un duplicato.",
    "Connect Elvanto before exporting calendar events.": "Collega Elvanto prima di esportare gli eventi del calendario.",
    "Connect Elvanto before previewing calendar export.": "Collega Elvanto prima di visualizzare l’anteprima dell’esportazione del calendario.",
    "Set Calendar direction to Smart Church → Elvanto or bidirectional before previewing an export.": "Imposta la direzione del calendario su Smart Church → Elvanto o bidirezionale prima di visualizzare l’anteprima.",
    "A Calendar export is already running for this location.": "È già in corso un’esportazione del calendario per questa sede.",
    "Calendar export start date must be on or before the end date.": "La data iniziale dell’esportazione deve precedere o coincidere con quella finale.",
    "Choose a valid Elvanto destination calendar.": "Scegli un calendario Elvanto di destinazione valido.",
    "Choose a valid Elvanto event organizer.": "Scegli un organizzatore Elvanto valido per l’evento.",
    "The location time zone is not configured.": "Il fuso orario della sede non è configurato.",
    "Calendar export previews support up to 20,000 local events at a time. Narrow the events included in the local schedule before creating a preview.": "Le anteprime dell’esportazione supportano fino a 20.000 eventi locali. Riduci il numero di eventi nel programma prima di creare l’anteprima.",
    "Could not read the complete Elvanto Calendar list. No export preview was saved.": "Impossibile leggere l’elenco completo del calendario Elvanto. Non è stata salvata alcuna anteprima.",
    "An Elvanto operation is running or connection settings changed. Try the preview again.": "È in corso un’operazione Elvanto oppure le impostazioni di connessione sono cambiate. Riprova l’anteprima.",
    "Set Calendar direction to Smart Church → Elvanto or bidirectional before exporting.": "Imposta la direzione del calendario su Smart Church → Elvanto o bidirezionale prima di esportare.",
    "Run a complete Calendar export preview first. Previews expire after one hour and after connection settings change.": "Crea prima un’anteprima completa dell’esportazione del calendario. Scade dopo un’ora o dopo le modifiche alla connessione.",
    "The preview expired, settings changed, or another Elvanto operation is running. Run a fresh complete Calendar export preview.": "L’anteprima è scaduta, le impostazioni sono cambiate oppure è in corso un’altra operazione Elvanto. Crea una nuova anteprima completa.",
    "Could not verify the complete Elvanto Calendar list. No events were written.": "Impossibile verificare l’elenco completo del calendario Elvanto. Non è stato scritto alcun evento.",
    "A local event changed after preview. Run a fresh Calendar export preview before writing.": "Un evento locale è cambiato dopo l’anteprima. Crea una nuova anteprima prima di scrivere.",
    "An Elvanto event changed or disappeared after preview. Run a fresh Calendar export preview.": "Un evento Elvanto è cambiato o è scomparso dopo l’anteprima. Crea una nuova anteprima.",
    "A matching Elvanto calendar event appeared after preview. Run a fresh Calendar export preview.": "Dopo l’anteprima è apparso un evento corrispondente nel calendario Elvanto. Crea una nuova anteprima."
  }
};

const translations = translationsForModule("sync");
for (const language of ["de", "fr", "it"] as const) {
  translations[language] = { ...translations[language], ...syncExportErrorTranslations[language] };
}

export const moduleRegistration: ModuleRegistration = {
  id: "sync",
  name: "Sync",
  translations,
  icon: RefreshCw,
  adminOnly: true,
  enabledByDefault: true,
  hiddenFromNavigation: true,
  component: lazy(() => import("./SyncModule").then(({ SyncModule }) => ({ default: SyncModule }))),
  settings: SyncSettings,
};
