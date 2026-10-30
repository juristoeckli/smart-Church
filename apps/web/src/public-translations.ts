import type { UserLanguage } from "@smart-church/contracts";
import { browserDefaultLanguage } from "./i18n";

const english = {
  eventEyebrow: "SMART CHURCH · EVENT REGISTRATION",
  groupEyebrow: "SMART CHURCH · GROUP SIGN-UP",
  eventLoading: "Loading event…",
  allDay: "All day",
  groupLoading: "Loading group…",
  eventUnavailable: "Registration unavailable",
  groupUnavailable: "Group sign-up unavailable",
  registered: "You’re registered",
  waitlisted: "You’re on the waitlist",
  registeredHelp: "Your place is confirmed. We look forward to seeing you.",
  waitlistedHelp: "The event is full, but you’re on the waitlist. The organizers will contact you if a place opens.",
  registrationClosed: "Registration for this event is closed.",
  placesRemaining: "{count} places remaining",
  registrationOpen: "Registration is open",
  waitlistCount: " · {count} on waitlist",
  firstName: "First name",
  lastName: "Last name",
  email: "Email address",
  eventPrivacy: "Your details are shared with the event organizers to manage registration and check-in.",
  submitting: "Submitting…",
  register: "Register",
  groupRequestSent: "Request sent",
  groupRequestHelp: "A group leader will review your request and follow up with you.",
  groupRequestIntro: "Send a request to join. Your membership starts after a group leader approves it.",
  groupPrivacy: "Your name and email will be shared with this group’s leaders to review your request.",
  sending: "Sending…",
  requestToJoin: "Request to join",
  smartChurch: "Smart Church",
} as const;

type PublicTranslationKey = keyof typeof english;

const dictionaries: Record<UserLanguage, Record<PublicTranslationKey, string>> = {
  en: english,
  de: {
    eventEyebrow: "SMART CHURCH · VERANSTALTUNGSANMELDUNG", groupEyebrow: "SMART CHURCH · GRUPPENANMELDUNG",
    eventLoading: "Veranstaltung wird geladen …", allDay: "Ganztägig", groupLoading: "Gruppe wird geladen …", eventUnavailable: "Anmeldung nicht verfügbar", groupUnavailable: "Gruppenanmeldung nicht verfügbar",
    registered: "Du bist angemeldet", waitlisted: "Du stehst auf der Warteliste", registeredHelp: "Dein Platz ist bestätigt. Wir freuen uns auf dich.", waitlistedHelp: "Die Veranstaltung ist ausgebucht. Du stehst auf der Warteliste. Die Veranstaltenden melden sich, falls ein Platz frei wird.",
    registrationClosed: "Die Anmeldung für diese Veranstaltung ist geschlossen.", placesRemaining: "Noch {count} Plätze frei", registrationOpen: "Die Anmeldung ist geöffnet", waitlistCount: " · {count} auf der Warteliste",
    firstName: "Vorname", lastName: "Nachname", email: "E-Mail-Adresse", eventPrivacy: "Deine Angaben werden mit den Veranstaltenden geteilt, damit sie Anmeldung und Check-in verwalten können.", submitting: "Wird gesendet …", register: "Anmelden",
    groupRequestSent: "Anfrage gesendet", groupRequestHelp: "Die Gruppenleitung prüft deine Anfrage und meldet sich bei dir.", groupRequestIntro: "Sende eine Beitrittsanfrage. Deine Mitgliedschaft beginnt, sobald die Gruppenleitung zustimmt.", groupPrivacy: "Dein Name und deine E-Mail-Adresse werden mit der Gruppenleitung geteilt, damit sie deine Anfrage prüfen kann.", sending: "Wird gesendet …", requestToJoin: "Beitritt anfragen", smartChurch: "Smart Church",
  },
  fr: {
    eventEyebrow: "SMART CHURCH · INSCRIPTION À L’ÉVÉNEMENT", groupEyebrow: "SMART CHURCH · INSCRIPTION AU GROUPE",
    eventLoading: "Chargement de l’événement…", allDay: "Toute la journée", groupLoading: "Chargement du groupe…", eventUnavailable: "Inscription indisponible", groupUnavailable: "Inscription au groupe indisponible",
    registered: "Votre inscription est confirmée", waitlisted: "Vous êtes sur la liste d’attente", registeredHelp: "Votre place est confirmée. Nous nous réjouissons de vous accueillir.", waitlistedHelp: "L’événement est complet, mais vous êtes sur la liste d’attente. Les organisateurs vous contacteront si une place se libère.",
    registrationClosed: "Les inscriptions à cet événement sont closes.", placesRemaining: "{count} places restantes", registrationOpen: "Les inscriptions sont ouvertes", waitlistCount: " · {count} sur la liste d’attente",
    firstName: "Prénom", lastName: "Nom", email: "Adresse e-mail", eventPrivacy: "Vos coordonnées sont partagées avec les organisateurs pour gérer l’inscription et l’accueil.", submitting: "Envoi en cours…", register: "S’inscrire",
    groupRequestSent: "Demande envoyée", groupRequestHelp: "Un responsable du groupe examinera votre demande et vous recontactera.", groupRequestIntro: "Envoyez une demande pour rejoindre le groupe. Votre adhésion commencera après l’approbation d’un responsable.", groupPrivacy: "Votre nom et votre adresse e-mail seront transmis aux responsables du groupe afin qu’ils examinent votre demande.", sending: "Envoi en cours…", requestToJoin: "Demander à rejoindre", smartChurch: "Smart Church",
  },
  it: {
    eventEyebrow: "SMART CHURCH · ISCRIZIONE ALL’EVENTO", groupEyebrow: "SMART CHURCH · ISCRIZIONE AL GRUPPO",
    eventLoading: "Caricamento dell’evento…", allDay: "Tutto il giorno", groupLoading: "Caricamento del gruppo…", eventUnavailable: "Iscrizione non disponibile", groupUnavailable: "Iscrizione al gruppo non disponibile",
    registered: "Iscrizione confermata", waitlisted: "Sei in lista d’attesa", registeredHelp: "Il tuo posto è confermato. Non vediamo l’ora di incontrarti.", waitlistedHelp: "L’evento è al completo, ma sei in lista d’attesa. Gli organizzatori ti contatteranno se si libera un posto.",
    registrationClosed: "Le iscrizioni a questo evento sono chiuse.", placesRemaining: "Ancora {count} posti disponibili", registrationOpen: "Le iscrizioni sono aperte", waitlistCount: " · {count} in lista d’attesa",
    firstName: "Nome", lastName: "Cognome", email: "Indirizzo e-mail", eventPrivacy: "I tuoi dati saranno condivisi con gli organizzatori per gestire l’iscrizione e l’accoglienza.", submitting: "Invio in corso…", register: "Iscriviti",
    groupRequestSent: "Richiesta inviata", groupRequestHelp: "Un responsabile del gruppo esaminerà la richiesta e ti ricontatterà.", groupRequestIntro: "Invia una richiesta per entrare nel gruppo. L’adesione inizierà dopo l’approvazione di un responsabile.", groupPrivacy: "Il tuo nome e indirizzo e-mail saranno condivisi con i responsabili del gruppo per valutare la richiesta.", sending: "Invio in corso…", requestToJoin: "Richiedi di entrare", smartChurch: "Smart Church",
  },
};

export function publicLanguage(): UserLanguage {
  return browserDefaultLanguage();
}

export function publicText(language: UserLanguage, key: PublicTranslationKey, values?: Record<string, string | number>): string {
  let value = dictionaries[language][key] ?? english[key];
  for (const [name, replacement] of Object.entries(values ?? {})) value = value.replaceAll(`{${name}}`, String(replacement));
  return value;
}
