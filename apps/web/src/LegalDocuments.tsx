import { ArrowLeft, ExternalLink, ShieldCheck } from "lucide-react";
import "./legal-documents.css";

type LegalPage = "privacy" | "terms";

const company = {
  name: "S‑VT GmbH",
  address: "Burg 11, 3631 Höfen, Schweiz",
  email: "info@s-vt.ch",
};

export function LegalDocuments({ page }: { page: LegalPage }) {
  const privacy = page === "privacy";
  const title = privacy ? "Datenschutzerklärung" : "Nutzungsbedingungen";

  return <main className="legal-page">
    <article className="legal-document">
      <header className="legal-header">
        <a className="legal-brand" href="/" aria-label="Zur Smart‑Church Anmeldung"><ShieldCheck size={21} /> Smart‑Church</a>
        <nav aria-label="Rechtliche Informationen">
          <a aria-current={privacy ? "page" : undefined} href="/privacy-policy">Datenschutzerklärung</a>
          <a aria-current={!privacy ? "page" : undefined} href="/terms-of-service">Nutzungsbedingungen</a>
        </nav>
      </header>

      <div className="legal-content">
        <a className="legal-back" href="/"><ArrowLeft size={15} /> Zur Anmeldung</a>
        <p className="legal-eyebrow">Smart‑Church · S‑VT GmbH</p>
        <h1>{title}</h1>
        <p className="legal-updated">Stand: 27. November 2026</p>

        {privacy ? <>
          <p>Diese Datenschutzerklärung beschreibt, wie S‑VT GmbH personenbezogene Daten verarbeitet, wenn Sie Smart‑Church verwenden. Smart‑Church unterstützt teilnehmende Gemeinden bei der Verwaltung von Personen, Gruppen, Gottesdiensten, Veranstaltungen und Livestreams.</p>
          <section><h2>1. Verantwortliche Stelle und Kontakt</h2><address>{company.name}<br />{company.address}<br /><a href={`mailto:${company.email}`}>{company.email}</a></address></section>
          <section><h2>2. Welche Daten verarbeitet werden</h2><p>Je nach aktivierten Funktionen verarbeitet Smart‑Church insbesondere Konto- und Anmeldedaten, Personen- und Kontaktdaten, Gruppenmitgliedschaften, Gottesdienst- und Veranstaltungsdaten, Aufgaben- und Anwesenheitsangaben, Inhalte und Dateien, technische Geräte- und Konfigurationsdaten sowie Sicherheits- und Zugriffsprotokolle. Welche Gemeindedaten in der Installation verwaltet werden, legt die jeweilige Gemeinde fest.</p></section>
          <section><h2>3. Zwecke und Rechtsgrundlagen</h2><p>Die Daten werden verarbeitet, um Smart‑Church bereitzustellen und abzusichern, Gemeindearbeit und Veranstaltungen zu organisieren, angeforderte Funktionen auszuführen und Support zu ermöglichen. Die Verarbeitung stützt sich je nach Situation auf die Bereitstellung des angeforderten Dienstes, berechtigte Interessen an einem sicheren und funktionsfähigen Betrieb, eine Einwilligung oder gesetzliche Pflichten. Die Gemeinde, die Smart‑Church einsetzt, bestimmt ihre Zwecke für die von ihr verwalteten Gemeindedaten.</p></section>
          <section><h2>4. YouTube API Services</h2><p>Wenn eine berechtigte Person den YouTube-Kanal mit Smart‑Church verbindet, nutzt die Anwendung YouTube API Services. Mit der erteilten Berechtigung kann Smart‑Church Kanalinformationen, Wiedergabelisten und geplante, laufende oder abgeschlossene Übertragungen abrufen und Livestreams planen oder verwalten. Dabei können insbesondere Kanal- und Video-IDs, Titel, Beschreibungen, geplante Zeiten, Sichtbarkeit, Übertragungsstatus und verfügbare Statistiken verarbeitet werden.</p><p>Smart‑Church speichert das für die Verbindung nötige OAuth-Aktualisierungstoken verschlüsselt auf dem Anwendungsserver. Zugriffstoken werden zum Aufruf der YouTube API verwendet. Angaben zu geplanten Streams wie Titel, Beschreibung, zugeordnete Person oder Thema, Zeitpunkt und YouTube-Broadcast-ID können zusätzlich in der Smart‑Church-Datenbank gespeichert werden, damit die Gemeinde ihre Planung verwalten kann. Die YouTube-Verbindung wird nicht für Werbung oder den Verkauf personenbezogener Daten verwendet.</p><p>Sie können die Google-Berechtigung in Ihrem <a href="https://myaccount.google.com/connections" target="_blank" rel="noreferrer">Google-Konto widerrufen</a>. Danach kann die YouTube-Integration nicht weiter auf den Kanal zugreifen. Weitere Informationen finden Sie in der <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Google-Datenschutzerklärung</a> und der <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">Google API Services User Data Policy</a>.</p></section>
          <section><h2>5. Empfänger und Übermittlungen</h2><p>Personenbezogene Daten sind für die jeweils berechtigten Nutzerinnen und Nutzer der betreffenden Gemeinde sichtbar. Für Hosting, Betrieb und Support können technische Dienstleister eingesetzt werden. Wenn Sie YouTube verbinden, werden die für die angeforderten Funktionen erforderlichen Daten an Google übermittelt und von Google gemäß dessen Bedingungen verarbeitet. Eine Verarbeitung ausserhalb der Schweiz kann nicht ausgeschlossen werden; in diesem Fall werden die anwendbaren gesetzlichen Anforderungen an eine solche Übermittlung berücksichtigt.</p></section>
          <section><h2>6. Aufbewahrung und Sicherheit</h2><p>Daten werden so lange gespeichert, wie sie für die genannten Zwecke benötigt werden, die Gemeinde die betreffende Funktion nutzt oder gesetzliche Aufbewahrungspflichten bestehen. Die konkrete Aufbewahrung von Gemeindedaten wird durch die jeweilige Installation und deren Verantwortliche bestimmt. S‑VT GmbH setzt angemessene technische und organisatorische Massnahmen ein, um Daten vor unbefugtem Zugriff, Verlust und Veränderung zu schützen.</p></section>
          <section><h2>7. Ihre Rechte und Anfragen</h2><p>Sie können sich mit Fragen zu Ihren Daten, Auskunfts- oder Löschungsanfragen sowie Anliegen zur YouTube-Verbindung an die für Ihre Gemeinde zuständige Stelle oder an <a href={`mailto:${company.email}`}>{company.email}</a> wenden. Es gelten die Rechte nach dem jeweils anwendbaren Datenschutzrecht. Für Daten, welche eine Gemeinde in Smart‑Church verwaltet, kann diese Gemeinde die zuständige Anlaufstelle sein.</p></section>
          <section><h2>8. Änderungen und externe Bedingungen</h2><p>Diese Erklärung kann angepasst werden, wenn sich Smart‑Church, die Datenverarbeitung oder rechtliche Anforderungen ändern. Für YouTube-Funktionen gelten zusätzlich die <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">YouTube-Nutzungsbedingungen</a>.</p></section>
        </> : <>
          <p>Diese Nutzungsbedingungen gelten für den Zugriff auf Smart‑Church und dessen Verwendung. Smart‑Church ist eine Anwendung für teilnehmende Gemeinden zur Verwaltung von Personen, Gruppen, Gottesdiensten, Veranstaltungen und Livestreams.</p>
          <section><h2>1. Anbieter und Kontakt</h2><address>{company.name}<br />{company.address}<br /><a href={`mailto:${company.email}`}>{company.email}</a></address></section>
          <section><h2>2. Konten und Berechtigungen</h2><p>Der Zugang ist für Personen vorgesehen, denen eine teilnehmende Gemeinde ein Konto oder eine Einladung erteilt hat. Sie müssen Ihre Zugangsdaten vertraulich behandeln, dürfen Ihr Konto nicht weitergeben und sollen einen vermuteten unbefugten Zugriff unverzüglich der zuständigen Gemeinde melden. Innerhalb der Anwendung dürfen Sie nur auf Funktionen und Daten zugreifen, für die Sie berechtigt sind.</p></section>
          <section><h2>3. Zulässige Nutzung und Inhalte</h2><p>Sie dürfen Smart‑Church nur rechtmässig und entsprechend diesen Bedingungen verwenden. Sie sind dafür verantwortlich, dass Sie die erforderlichen Rechte und Berechtigungen besitzen, um Inhalte oder personenbezogene Daten einzutragen und zu verwalten. Untersagt sind insbesondere unbefugter Zugriff, Störung des Dienstes, Umgehung von Sicherheitsmassnahmen und die Nutzung für rechtswidrige Zwecke.</p></section>
          <section><h2>4. YouTube-Verbindung</h2><p>Die YouTube-Integration ist optional. Wenn Sie sie verbinden, autorisieren Sie Smart‑Church, die für die ausgewählten Funktionen erforderlichen YouTube API Services zu nutzen. Dazu können das Anzeigen von Kanal- und Übertragungsdaten sowie das Planen und Verwalten von Livestreams gehören. Ihre Nutzung von YouTube bleibt zusätzlich den <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">YouTube-Nutzungsbedingungen</a> unterstellt. Sie können den Zugriff jederzeit in Ihrem <a href="https://myaccount.google.com/connections" target="_blank" rel="noreferrer">Google-Konto widerrufen</a>. Die Verfügbarkeit der YouTube-Funktionen hängt auch von Google und der YouTube API ab.</p></section>
          <section><h2>5. Verfügbarkeit und Änderungen</h2><p>S‑VT GmbH bemüht sich um einen verlässlichen Betrieb, kann eine ununterbrochene oder jederzeit fehlerfreie Verfügbarkeit jedoch nicht zusichern. Funktionen können aus Sicherheits-, Wartungs- oder technischen Gründen angepasst oder vorübergehend eingeschränkt werden. Zwingende gesetzliche Ansprüche bleiben vorbehalten.</p></section>
          <section><h2>6. Datenschutz</h2><p>Informationen zur Verarbeitung personenbezogener Daten finden Sie in der <a href="/privacy-policy">Datenschutzerklärung</a>.</p></section>
          <section><h2>7. Änderungen und Kontakt</h2><p>Aktualisierte Bedingungen werden an dieser Stelle veröffentlicht. Bei Fragen wenden Sie sich an <a href={`mailto:${company.email}`}>{company.email}</a>.</p></section>
        </>}

        <footer className="legal-footer"><span>© {new Date().getFullYear()} {company.name}</span><a href="/terms-of-service">Nutzungsbedingungen</a><a href="/privacy-policy">Datenschutzerklärung</a></footer>
      </div>
    </article>
  </main>;
}
