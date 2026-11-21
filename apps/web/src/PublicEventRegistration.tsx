import { useEffect, useState, type FormEvent } from "react";
import { CalendarDays, Check, Clock3, MapPin } from "lucide-react";
import type { AuthStatus, PublicRegistrationEvent, PublicRegistrationReceiptStatus, RegistrationQuestion } from "@smart-church/contracts";
import { publicErrorText, publicLanguage, publicText } from "./public-translations";

function RegistrationAnswers({ questions, prefix }: { questions: RegistrationQuestion[]; prefix: string }) {
  return <>{questions.map((question) => <label key={question.id}>
    {question.label}
    {question.type === "choice" ? <select name={prefix + question.id} required={question.required}>
      <option value="">—</option>
      {question.options?.map((option) => <option key={option} value={option}>{option}</option>)}
    </select> : <input name={prefix + question.id} maxLength={160} required={question.required} />}
  </label>)}</>;
}

export function PublicEventRegistration({ token }: { token: string }) {
  const language = publicLanguage();
  const [receiptToken] = useState(() => /^#receipt=([0-9a-f]{64})$/.exec(window.location.hash)?.[1] ?? "");
  const [receipt, setReceipt] = useState<PublicRegistrationReceiptStatus | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(true);
  const [receiptRefresh, setReceiptRefresh] = useState(0);
  const [event, setEvent] = useState<PublicRegistrationEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [submitted, setSubmitted] = useState<"registered" | "waitlisted" | null>(null);
  const [cancellationToken, setCancellationToken] = useState("");
  const [guests, setGuests] = useState<Array<{ key: number; firstName: string; lastName: string }>>([]);
  const [nextGuestKey, setNextGuestKey] = useState(1);
  const [attendees, setAttendees] = useState<Array<{ firstName: string; lastName: string; cancellationToken: string }>>([]);
  const [waitlistToken] = useState(() => /^#waitlist=([0-9a-f]{64})$/.exec(window.location.hash)?.[1] ?? "");
  const [waitlistCsrf, setWaitlistCsrf] = useState<string | null>(null);
  const [waitlistUpdated, setWaitlistUpdated] = useState<boolean | null>(null);
  const [linkToken] = useState(() => /^#cancel=([0-9a-f]{64})$/.exec(window.location.hash)?.[1] ?? "");
  const [cancelled, setCancelled] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    document.documentElement.lang = language;
    if (linkToken || waitlistToken || receiptToken) return;
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
  }, [token, language, linkToken, waitlistToken, receiptToken]);

  useEffect(() => {
    if (!receiptToken) return;
    const controller = new AbortController();
    setReceiptLoading(true);
    setError("");
    fetch("/api/public/event-registrations/receipt", {
      method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
      cache: "no-store", body: JSON.stringify({ receiptToken }),
    }).then(async (response) => {
      if (!response.ok) throw new Error();
      const body = await response.json() as PublicRegistrationReceiptStatus;
      if (!controller.signal.aborted) setReceipt(body);
    }).catch(() => {
      if (!controller.signal.aborted) {
        setReceipt(null);
        setError(publicText(language, "receiptUnavailable"));
      }
    }).finally(() => { if (!controller.signal.aborted) setReceiptLoading(false); });
    return () => controller.abort();
  }, [language, receiptToken, receiptRefresh]);

  useEffect(() => {
    if (!waitlistToken) return;
    const controller = new AbortController();
    fetch("/api/auth/status", { cache: "no-store", signal: controller.signal })
      .then((response) => response.json() as Promise<AuthStatus>)
      .then((status) => { if (!controller.signal.aborted) setWaitlistCsrf(status.authenticated ? status.csrfToken ?? "" : ""); })
      .catch(() => { if (!controller.signal.aborted) setWaitlistCsrf(""); });
    return () => controller.abort();
  }, [waitlistToken]);

  async function updateWaitlistNotice(enabled: boolean) {
    if (!waitlistCsrf || sending) return;
    setSending(true);
    setError("");
    try {
      const response = await fetch("/api/events/registration-waitlist-notices", {
        method: "PUT", headers: { "content-type": "application/json", "x-csrf-token": waitlistCsrf },
        body: JSON.stringify({ receiptToken: waitlistToken, enabled }),
      });
      if (!response.ok) throw new Error();
      setWaitlistUpdated(enabled);
    } catch { setError(publicText(language, "waitlistNoticeFailed")); }
    finally { setSending(false); }
  }

  async function register(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setSending(true);
    setError("");
    const values = new FormData(formEvent.currentTarget);
    const answers = (prefix: string) => Object.fromEntries((event?.questions ?? []).map((question) => [question.id, String(values.get(prefix + question.id) ?? "")]));
    const guestSeats = guests.map(({ key, firstName, lastName }) => ({
      firstName, lastName, ...(event?.formRevision ? { answers: answers("guest-" + key + "-") } : {}),
    }));
    try {
      const response = await fetch(`/api/public/event-registrations/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ firstName: String(values.get("firstName")).trim(), lastName: String(values.get("lastName")).trim(), email: String(values.get("email")).trim(), ...(guestSeats.length ? { guests: guestSeats } : {}), ...(event?.formRevision ? { formRevision: event.formRevision, answers: answers("primary-") } : {}) }),
      });
      const result = await response.json() as { status?: "registered" | "waitlisted"; cancellationToken?: string; attendees?: typeof attendees; error?: string };
      if (!response.ok || !result.status) throw new Error(publicErrorText(language, result.error ?? "Could not submit your registration."));
      setSubmitted(result.status);
      setCancellationToken(result.cancellationToken ?? "");
      setAttendees(result.attendees ?? []);
    } catch (reason) { setError(publicErrorText(language, reason instanceof Error ? reason.message : "Could not submit your registration.")); }
    finally { setSending(false); }
  }

  async function cancelRegistration() {
    setSending(true);
    setError("");
    try {
      const response = await fetch("/api/public/event-registrations/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cancellationToken: linkToken }),
      });
      if (!response.ok) throw new Error();
      setCancelled(true);
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    } catch {
      setError(publicText(language, "cancelFailed"));
    } finally {
      setSending(false);
    }
  }

  if (receiptToken) {
    const date = receipt ? new Intl.DateTimeFormat(language, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${receipt.eventDate}T12:00:00Z`)) : "";
    return <main className="public-registration-page"><section className="public-registration-card">
      <span className="eyebrow">{publicText(language, "eventEyebrow")}</span>
      <h1>{publicText(language, "registrationReceipt")}</h1>
      {receiptLoading ? <p role="status">{publicText(language, "eventLoading")}</p> : receipt ? <>
        <h2>{receipt.title}</h2>
        <div className="public-registration-details">
          <span><CalendarDays size={17} />{date}</span>
          <span><Clock3 size={17} />{receipt.isAllDay ? publicText(language, "allDay") : `${receipt.startTime}${receipt.endTime ? ` – ${receipt.endTime}` : ""}`}</span>
          {receipt.location && <span><MapPin size={17} />{receipt.location}</span>}
        </div>
        <p className="public-registration-message">{publicText(language, receipt.eventCancelled ? "receiptEventCancelled"
          : receipt.status === "cancelled" ? "cancelledRegistration" : receipt.status)}</p>
        {!receipt.eventCancelled && receipt.status === "waitlisted" && <p>
          <a href={window.location.pathname + "#waitlist=" + receiptToken} target="_blank" rel="noreferrer">{publicText(language, "waitlistNotices")}</a>
        </p>}
        {receipt.canCancel && <p><a href={window.location.pathname + "#cancel=" + receiptToken} target="_blank" rel="noreferrer">{publicText(language, "cancelRegistration")}</a></p>}
        <p className="public-registration-privacy">{publicText(language, "receiptPrivacy")}</p>
      </> : <p role="alert" className="public-registration-error">{error}</p>}
      <button className="button button-secondary" type="button" disabled={receiptLoading} onClick={() => setReceiptRefresh((current) => current + 1)}>{publicText(language, "refreshReceipt")}</button>
      <footer>{publicText(language, "smartChurch")}</footer>
    </section></main>;
  }

  if (waitlistToken) return <main className="public-registration-page"><section className="public-registration-card">
    <span className="eyebrow">{publicText(language, "eventEyebrow")}</span>
    <h1>{publicText(language, "waitlistNotices")}</h1>
    <p>{publicText(language, "waitlistNoticeHelp")}</p>
    {waitlistCsrf === null ? <p>{publicText(language, "eventLoading")}</p> : waitlistCsrf
      ? <div className="public-registration-form">
        <button className="button button-primary" type="button" disabled={sending} onClick={() => void updateWaitlistNotice(true)}>{publicText(language, "enableWaitlistNotice")}</button>
        <button className="button button-secondary" type="button" disabled={sending} onClick={() => void updateWaitlistNotice(false)}>{publicText(language, "disableWaitlistNotice")}</button>
      </div>
      : <p><a href="/" target="_blank" rel="noreferrer">{publicText(language, "signInForWaitlist")}</a> {publicText(language, "waitlistRefresh")}</p>}
    {waitlistUpdated !== null && <p role="status">{publicText(language, waitlistUpdated ? "waitlistEnabled" : "waitlistDisabled")}</p>}
    {error && <p className="public-registration-error" role="alert">{error}</p>}
    <footer>{publicText(language, "smartChurch")}</footer>
  </section></main>;

  if (linkToken) return <main className="public-registration-page"><section className="public-registration-card">
    <span className="eyebrow">{publicText(language, "eventEyebrow")}</span>
    <h1>{publicText(language, cancelled ? "cancelledRegistration" : "cancelRegistration")}</h1>
    {!cancelled && <form className="public-registration-form" onSubmit={(submission) => { submission.preventDefault(); if (confirmed && !sending) void cancelRegistration(); }}>
      <label><input type="checkbox" checked={confirmed} onChange={(change) => setConfirmed(change.target.checked)} /> {publicText(language, "confirmCancel")}</label>
      {error && <p className="public-registration-error" role="alert">{error}</p>}
      <button className="button button-danger" disabled={!confirmed || sending}>{publicText(language, "cancelRegistration")}</button>
    </form>}
    <footer>{publicText(language, "smartChurch")}</footer>
  </section></main>;

  const date = event ? new Intl.DateTimeFormat(language, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${event.eventDate}T12:00:00Z`)) : "";
  return <main className="public-registration-page"><section className="public-registration-card">
    <span className="eyebrow">{publicText(language, "eventEyebrow")}</span>
    {loading ? <p className="public-registration-message">{publicText(language, "eventLoading")}</p> : error && !event ? <><h1>{publicText(language, "eventUnavailable")}</h1><p className="public-registration-message">{error}</p></> : event && <>
      <h1>{event.title}</h1>
      <div className="public-registration-details"><span><CalendarDays size={17} />{date}</span><span><Clock3 size={17} />{event.isAllDay ? publicText(language, "allDay") : `${event.startTime}${event.endTime ? ` – ${event.endTime}` : ""}`}</span><span><MapPin size={17} />{event.location}</span></div>
      {event.description && <p className="public-registration-description">{event.description}</p>}
      {submitted ? <div className="public-registration-success"><span className="public-registration-check"><Check size={20} /></span><div><h2>{publicText(language, attendees.length ? (submitted === "registered" ? "partyRegistered" : "partyWaitlisted") : (submitted === "registered" ? "registered" : "waitlisted"))}</h2><p>{publicText(language, attendees.length ? "partyLinksHelp" : (submitted === "registered" ? "registeredHelp" : "waitlistedHelp"))}</p></div></div>
        : !event.registrationOpen ? <p className="public-registration-message">{publicText(language, "registrationClosed")}</p>
          : <>
            <p className="public-registration-capacity">{event.capacity ? publicText(language, "placesRemaining", { count: Math.max(event.capacity - event.registeredCount, 0) }) : publicText(language, "registrationOpen")}{event.waitlistCount ? publicText(language, "waitlistCount", { count: event.waitlistCount }) : ""}</p>
            <form className="public-registration-form" onSubmit={(submitEvent) => void register(submitEvent)}>
              <div className="form-row"><label>{publicText(language, "firstName")}<input name="firstName" autoComplete="given-name" maxLength={80} required /></label><label>{publicText(language, "lastName")}<input name="lastName" autoComplete="family-name" maxLength={80} required /></label></div>
              <label>{publicText(language, "email")}<input type="email" name="email" autoComplete="email" maxLength={254} required /></label>
              <RegistrationAnswers questions={event.questions ?? []} prefix="primary-" />
              {guests.map((guest, index) => <fieldset key={guest.key} disabled={sending}>
                <legend>{publicText(language, "additionalAttendee", { count: index + 1 })}</legend>
                <div className="form-row">
                  <label>{publicText(language, "firstName")}<input value={guest.firstName} required maxLength={80} onChange={(change) => setGuests((current) => current.map((person, position) => position === index ? { ...person, firstName: change.target.value } : person))} /></label>
                  <label>{publicText(language, "lastName")}<input value={guest.lastName} required maxLength={80} onChange={(change) => setGuests((current) => current.map((person, position) => position === index ? { ...person, lastName: change.target.value } : person))} /></label>
                </div>
                <RegistrationAnswers questions={event.questions ?? []} prefix={"guest-" + guest.key + "-"} />
                <button type="button" className="button button-secondary" onClick={() => setGuests((current) => current.filter((_, position) => position !== index))}>{publicText(language, "removeAttendee")}</button>
              </fieldset>)}
              {guests.length < 9 && <button type="button" className="button button-secondary" disabled={sending} onClick={() => { setGuests((current) => [...current, { key: nextGuestKey, firstName: "", lastName: "" }]); setNextGuestKey((key) => key + 1); }}>{publicText(language, "addAttendee")}</button>}
              <p className="public-registration-privacy">{publicText(language, event.formRevision ? "registrationAnswersPrivacy" : "eventPrivacy")}</p>
              {error && <p className="public-registration-error" role="alert">{error}</p>}
              <button className="button button-primary" type="submit" disabled={sending}>{sending ? publicText(language, "submitting") : publicText(language, "register")}</button>
            </form>
          </>}
    </>}
    {attendees.length > 0 && <ul>{attendees.map((person) => <li key={person.cancellationToken}>{person.firstName} {person.lastName} · <a href={window.location.pathname + "#receipt=" + person.cancellationToken} target="_blank" rel="noreferrer">{publicText(language, "registrationReceipt")}</a></li>)}</ul>}
    {submitted === "waitlisted" && cancellationToken && <p>
      <a href={window.location.pathname + "#waitlist=" + cancellationToken} target="_blank" rel="noreferrer">{publicText(language, "waitlistNotices")}</a>
    </p>}
    {!attendees.length && cancellationToken && <p><a href={window.location.pathname + "#receipt=" + cancellationToken} target="_blank" rel="noreferrer">{publicText(language, "registrationReceipt")}</a> · {publicText(language, "receiptPrivacy")}</p>}
    <footer>{publicText(language, "smartChurch")}</footer>
  </section></main>;
}
