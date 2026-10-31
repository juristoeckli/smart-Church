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

const publicErrors: Record<UserLanguage, Record<string, string>> = {
  en: {},
  de: {
    "Event registration is temporarily unavailable.": "Die Veranstaltungsanmeldung ist vorübergehend nicht verfügbar.",
    "This registration link is unavailable.": "Dieser Anmeldelink ist nicht verfügbar.",
    "Enter your name and email address.": "Gib deinen Namen und deine E-Mail-Adresse ein.",
    "Registration is closed for this event.": "Die Anmeldung für diese Veranstaltung ist geschlossen.",
    "This event's location is read-only while it is a redundancy standby or fenced site.": "Der Standort dieser Veranstaltung ist im Redundanz-Standby oder isolierten Zustand schreibgeschützt.",
    "This email address is already registered for the event.": "Diese E-Mail-Adresse ist bereits für die Veranstaltung angemeldet.",
    "Could not load this event.": "Die Veranstaltung konnte nicht geladen werden.",
    "Could not submit your registration.": "Deine Anmeldung konnte nicht gesendet werden.",
    "Group registration is temporarily unavailable.": "Die Gruppenanmeldung ist vorübergehend nicht verfügbar.",
    "This group registration link is unavailable.": "Dieser Gruppenanmeldelink ist nicht verfügbar.",
    "This group link is unavailable.": "Dieser Gruppenlink ist nicht verfügbar.",
    "Registration is closed for this group.": "Die Anmeldung für diese Gruppe ist geschlossen.",
    "This group's location is read-only while it is a redundancy standby or fenced site.": "Der Standort dieser Gruppe ist im Redundanz-Standby oder isolierten Zustand schreibgeschützt.",
    "A request from this email is already waiting for review.": "Eine Anfrage von dieser E-Mail-Adresse wartet bereits auf Prüfung.",
    "This email is already connected to an active group member.": "Diese E-Mail-Adresse gehört bereits zu einem aktiven Gruppenmitglied.",
    "Could not load this group.": "Die Gruppe konnte nicht geladen werden.",
    "Could not send your request.": "Deine Anfrage konnte nicht gesendet werden.",
  },
  fr: {
    "Event registration is temporarily unavailable.": "L’inscription à l’événement est temporairement indisponible.",
    "This registration link is unavailable.": "Ce lien d’inscription est indisponible.",
    "Enter your name and email address.": "Saisissez votre nom et votre adresse e-mail.",
    "Registration is closed for this event.": "Les inscriptions à cet événement sont closes.",
    "This event's location is read-only while it is a redundancy standby or fenced site.": "Le site de cet événement est en lecture seule lorsqu’il est en secours/redondance ou isolé.",
    "This email address is already registered for the event.": "Cette adresse e-mail est déjà inscrite à l’événement.",
    "Could not load this event.": "Impossible de charger cet événement.",
    "Could not submit your registration.": "Impossible d’envoyer votre inscription.",
    "Group registration is temporarily unavailable.": "L’inscription au groupe est temporairement indisponible.",
    "This group registration link is unavailable.": "Ce lien d’inscription au groupe est indisponible.",
    "This group link is unavailable.": "Ce lien de groupe est indisponible.",
    "Registration is closed for this group.": "Les inscriptions à ce groupe sont closes.",
    "This group's location is read-only while it is a redundancy standby or fenced site.": "Le site de ce groupe est en lecture seule lorsqu’il est en secours/redondance ou isolé.",
    "A request from this email is already waiting for review.": "Une demande provenant de cette adresse e-mail est déjà en attente d’examen.",
    "This email is already connected to an active group member.": "Cette adresse e-mail est déjà associée à un membre actif du groupe.",
    "Could not load this group.": "Impossible de charger ce groupe.",
    "Could not send your request.": "Impossible d’envoyer votre demande.",
  },
  it: {
    "Event registration is temporarily unavailable.": "L’iscrizione all’evento non è temporaneamente disponibile.",
    "This registration link is unavailable.": "Questo link di iscrizione non è disponibile.",
    "Enter your name and email address.": "Inserisci nome e indirizzo e-mail.",
    "Registration is closed for this event.": "Le iscrizioni a questo evento sono chiuse.",
    "This event's location is read-only while it is a redundancy standby or fenced site.": "La sede di questo evento è di sola lettura in modalità standby di ridondanza o quando è isolata.",
    "This email address is already registered for the event.": "Questo indirizzo e-mail è già iscritto all’evento.",
    "Could not load this event.": "Impossibile caricare l’evento.",
    "Could not submit your registration.": "Impossibile inviare l’iscrizione.",
    "Group registration is temporarily unavailable.": "L’iscrizione al gruppo non è temporaneamente disponibile.",
    "This group registration link is unavailable.": "Questo link di iscrizione al gruppo non è disponibile.",
    "This group link is unavailable.": "Questo link del gruppo non è disponibile.",
    "Registration is closed for this group.": "Le iscrizioni a questo gruppo sono chiuse.",
    "This group's location is read-only while it is a redundancy standby or fenced site.": "La sede di questo gruppo è di sola lettura in modalità standby di ridondanza o quando è isolata.",
    "A request from this email is already waiting for review.": "Una richiesta da questo indirizzo e-mail è già in attesa di revisione.",
    "This email is already connected to an active group member.": "Questo indirizzo e-mail è già associato a un membro attivo del gruppo.",
    "Could not load this group.": "Impossibile caricare il gruppo.",
    "Could not send your request.": "Impossibile inviare la richiesta.",
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

export function publicErrorText(language: UserLanguage, message: string): string {
  return publicErrors[language][message] ?? message;
}
