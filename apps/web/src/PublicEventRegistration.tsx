import { useEffect, useState, type FormEvent } from "react";
import { CalendarDays, Check, Clock3, MapPin } from "lucide-react";
import type { PublicRegistrationEvent } from "@smart-church/contracts";
import { publicErrorText, publicLanguage, publicText } from "./public-translations";

export function PublicEventRegistration({ token }: { token: string }) {
  const language = publicLanguage();
  const [event, setEvent] = useState<PublicRegistrationEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [submitted, setSubmitted] = useState<"registered" | "waitlisted" | null>(null);

  useEffect(() => {
    document.documentElement.lang = language;
    let active = true;
    fetch(`/api/public/event-registrations/${encodeURIComponent(token)}`)
      .then(async (response) => {
        const result = await response.json() as PublicRegistrationEvent | { error?: string };
        if (!response.ok || !("title" in result)) throw new Error(publicErrorText(language, "error" in result ? result.error ?? "This registration link is unavailable." : "This registration link is unavailable."));
        if (active) setEvent(result);
      })
      .catch((reason) => { if (active) setError(publicErrorText(language, reason instanceof Error ? reason.message : "Could not load this event.")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token, language]);

  async function register(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setSending(true);
    setError("");
    const values = new FormData(formEvent.currentTarget);
    try {
      const response = await fetch(`/api/public/event-registrations/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ firstName: String(values.get("firstName")).trim(), lastName: String(values.get("lastName")).trim(), email: String(values.get("email")).trim() }),
      });
      const result = await response.json() as { status?: "registered" | "waitlisted"; error?: string };
      if (!response.ok || !result.status) throw new Error(publicErrorText(language, result.error ?? "Could not submit your registration."));
      setSubmitted(result.status);
    } catch (reason) { setError(publicErrorText(language, reason instanceof Error ? reason.message : "Could not submit your registration.")); }
    finally { setSending(false); }
  }

  const date = event ? new Intl.DateTimeFormat(language, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${event.eventDate}T12:00:00Z`)) : "";
  return <main className="public-registration-page"><section className="public-registration-card">
    <span className="eyebrow">{publicText(language, "eventEyebrow")}</span>
    {loading ? <p className="public-registration-message">{publicText(language, "eventLoading")}</p> : error && !event ? <><h1>{publicText(language, "eventUnavailable")}</h1><p className="public-registration-message">{error}</p></> : event && <>
      <h1>{event.title}</h1>
      <div className="public-registration-details"><span><CalendarDays size={17} />{date}</span><span><Clock3 size={17} />{event.isAllDay ? publicText(language, "allDay") : `${event.startTime}${event.endTime ? ` – ${event.endTime}` : ""}`}</span><span><MapPin size={17} />{event.location}</span></div>
      {event.description && <p className="public-registration-description">{event.description}</p>}
      {submitted ? <div className="public-registration-success"><span className="public-registration-check"><Check size={20} /></span><div><h2>{publicText(language, submitted === "registered" ? "registered" : "waitlisted")}</h2><p>{publicText(language, submitted === "registered" ? "registeredHelp" : "waitlistedHelp")}</p></div></div>
        : !event.registrationOpen ? <p className="public-registration-message">{publicText(language, "registrationClosed")}</p>
          : <>
            <p className="public-registration-capacity">{event.capacity ? publicText(language, "placesRemaining", { count: Math.max(event.capacity - event.registeredCount, 0) }) : publicText(language, "registrationOpen")}{event.waitlistCount ? publicText(language, "waitlistCount", { count: event.waitlistCount }) : ""}</p>
            <form className="public-registration-form" onSubmit={(submitEvent) => void register(submitEvent)}>
              <div className="form-row"><label>{publicText(language, "firstName")}<input name="firstName" autoComplete="given-name" maxLength={80} required /></label><label>{publicText(language, "lastName")}<input name="lastName" autoComplete="family-name" maxLength={80} required /></label></div>
              <label>{publicText(language, "email")}<input type="email" name="email" autoComplete="email" maxLength={254} required /></label>
              <p className="public-registration-privacy">{publicText(language, "eventPrivacy")}</p>
              {error && <p className="public-registration-error" role="alert">{error}</p>}
              <button className="button button-primary" type="submit" disabled={sending}>{sending ? publicText(language, "submitting") : publicText(language, "register")}</button>
            </form>
          </>}
    </>}
    <footer>{publicText(language, "smartChurch")}</footer>
  </section></main>;
}
