import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Bell, CalendarClock, Check, CheckCheck, CircleAlert, ClipboardCheck, Megaphone, Send, Settings2, UserCheck } from "lucide-react";
import { moduleTranslation, type ModuleContext } from "../../module-registry";
import type { ChurchGroup } from "@smart-church/contracts";
import { formatUserDate } from "../../date-format";
import { translationsForModule } from "../translations";
import { mergeModuleTranslationOverrides } from "../ui-translation-overrides";
import "./notifications.css";

const notificationTranslations = mergeModuleTranslationOverrides("notifications", translationsForModule("notifications"));

type Notification = {
  id: string;
  kind: "announcement" | "event_reminder" | "service_request" | "follow_up_assignment" | "follow_up_reminder" | "community_feed" | "report_ready";
  title: string;
  body: string;
  eventId?: string;
  contactId?: string;
  emailDeliveryStatus?: "pending" | "sent" | "delayed" | "delivered" | "bounced" | "complained" | "suppressed" | "failed" | "skipped";
  createdAt: string;
  readAt?: string;
};

type NotificationResponse = {
  notifications: Notification[];
  unreadCount: number;
  eventRemindersEnabled: boolean;
  serviceRequestsEnabled: boolean;
  followUpsEnabled: boolean;
  emailEnabled: boolean;
  emailAddress: string | null;
  emailDeliveryConfigured: boolean;
  emailSuppressed: boolean;
  canSend: boolean;
};

type EmailTemplateKind = "announcement" | "event_reminder" | "service_request" | "follow_up_assignment" | "follow_up_reminder" | "community_feed";
type EmailTemplate = { kind: EmailTemplateKind; subjectTemplate: string; bodyTemplate: string; updatedAt: string | null };
type AnnouncementPreview = {
  accountCount: number;
  emailEligibleCount: number;
  emailConfigured: boolean;
  sampleEmail: { subject: string; text: string };
};
type NotificationMutationResult = { eventRemindersEnabled?: boolean; serviceRequestsEnabled?: boolean; followUpsEnabled?: boolean; emailEnabled?: boolean; recipientCount?: number };
const emailTemplateKinds: Array<{ kind: EmailTemplateKind; label: string }> = [
  { kind: "announcement", label: "Church announcements" },
  { kind: "event_reminder", label: "Event reminders" },
  { kind: "service_request", label: "Volunteer requests" },
  { kind: "follow_up_assignment", label: "Visitor follow-up assignments" },
  { kind: "follow_up_reminder", label: "Visitor follow-up reminders" },
  { kind: "community_feed", label: "Community Feed" },
];

export function NotificationsModule({ departmentId, csrfToken, language }: ModuleContext) {
  const t = (key: string) => moduleTranslation(notificationTranslations, language, key);
  const format = (key: string, values: Record<string, string>) => Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), t(key));
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [eventRemindersEnabled, setEventRemindersEnabled] = useState(true);
  const [serviceRequestsEnabled, setServiceRequestsEnabled] = useState(true);
  const [followUpsEnabled, setFollowUpsEnabled] = useState(true);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [emailAddress, setEmailAddress] = useState<string | null>(null);
  const [emailDeliveryConfigured, setEmailDeliveryConfigured] = useState(false);
  const [emailSuppressed, setEmailSuppressed] = useState(false);
  const [canSend, setCanSend] = useState(false);
  const [emailTemplates, setEmailTemplates] = useState<EmailTemplate[]>([]);
  const [emailTemplateKind, setEmailTemplateKind] = useState<EmailTemplateKind>("announcement");
  const [emailTemplateSubject, setEmailTemplateSubject] = useState("");
  const [emailTemplateBody, setEmailTemplateBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [detailsNotification, setDetailsNotification] = useState<Notification | null>(null);
  const [groups, setGroups] = useState<ChurchGroup[]>([]);
  const [announcementAudience, setAnnouncementAudience] = useState<"location" | "groups">("location");
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [announcementPreview, setAnnouncementPreview] = useState<{ departmentId: string; result: AnnouncementPreview }>();
  const unreadCount = notifications.filter((notification) => !notification.readAt).length;

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/modules/notifications", { headers: { "x-department-id": departmentId } });
      const result = await response.json() as NotificationResponse | { error?: string };
      if (!response.ok || !("notifications" in result)) throw new Error("error" in result ? result.error ?? "Could not load notifications." : "Could not load notifications.");
      setNotifications(result.notifications);
      setEventRemindersEnabled(result.eventRemindersEnabled);
      setServiceRequestsEnabled(result.serviceRequestsEnabled);
      setFollowUpsEnabled(result.followUpsEnabled);
      setEmailEnabled(result.emailEnabled);
      setEmailAddress(result.emailAddress);
      setEmailDeliveryConfigured(result.emailDeliveryConfigured);
      setEmailSuppressed(result.emailSuppressed);
      setCanSend(result.canSend);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load notifications.");
    } finally { setLoading(false); }
  }, [departmentId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!canSend) return;
    let active = true;
    void fetch("/api/modules/notifications/email-templates", { headers: { "x-department-id": departmentId } }).then(async (response) => {
      const result = await response.json() as { error?: string; templates?: EmailTemplate[] };
      if (!response.ok || !Array.isArray(result.templates)) throw new Error(result.error ?? "Could not load email templates.");
      if (active) setEmailTemplates(result.templates);
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Could not load email templates."); });
    return () => { active = false; };
  }, [canSend, departmentId]);

  useEffect(() => {
    const selected = emailTemplates.find((item) => item.kind === emailTemplateKind);
    setEmailTemplateSubject(selected?.subjectTemplate ?? "");
    setEmailTemplateBody(selected?.bodyTemplate ?? "");
  }, [emailTemplates, emailTemplateKind]);

  useEffect(() => {
    if (!detailsNotification) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setDetailsNotification(null); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [detailsNotification]);

  useEffect(() => {
    if (!canSend) return;
    let active = true;
    void fetch("/api/groups", { headers: { "x-department-id": departmentId } }).then(async (response) => {
      const result = await response.json() as ChurchGroup[] | { error?: string };
      if (!response.ok || !Array.isArray(result)) throw new Error("Could not load groups for announcement targeting.");
      if (active) setGroups(result);
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Could not load groups for announcement targeting."); });
    return () => { active = false; };
  }, [canSend, departmentId]);

  async function mutate<Result = NotificationMutationResult>(path: string, method: string, body?: object) {
    const response = await fetch(path, {
      method,
      headers: {
        "x-department-id": departmentId,
        "x-csrf-token": csrfToken,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json() as Result & { error?: string };
    if (!response.ok) throw new Error(result.error ?? "The request failed.");
    return result;
  }

  async function markRead(notification: Notification) {
    if (notification.readAt) return;
    try {
      await mutate(`/api/modules/notifications/${encodeURIComponent(notification.id)}/read`, "POST");
      const readAt = new Date().toISOString();
      setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, readAt } : item));
      setDetailsNotification((current) => current?.id === notification.id ? { ...current, readAt } : current);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update this notification."); }
  }

  async function markAllRead() {
    if (!unreadCount) return;
    setBusy(true); setError("");
    try {
      await mutate("/api/modules/notifications/read-all", "POST");
      const readAt = new Date().toISOString();
      setNotifications((current) => current.map((item) => item.readAt ? item : { ...item, readAt }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not mark notifications as read."); }
    finally { setBusy(false); }
  }

  async function savePreferences(eventReminders: boolean, serviceRequests: boolean, followUps: boolean, email: boolean) {
    setBusy(true); setError(""); setFeedback("");
    try {
      await mutate("/api/modules/notifications/preferences", "PUT", { eventRemindersEnabled: eventReminders, serviceRequestsEnabled: serviceRequests, followUpsEnabled: followUps, emailEnabled: email });
      setEventRemindersEnabled(eventReminders);
      setServiceRequestsEnabled(serviceRequests);
      setFollowUpsEnabled(followUps);
      setEmailEnabled(email);
      setFeedback("Notification preferences saved.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save notification preferences."); }
    finally { setBusy(false); }
  }

  async function saveEmailTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setFeedback("");
    try {
      const result = await mutate(`/api/modules/notifications/email-templates/${emailTemplateKind}`, "PUT", { subjectTemplate: emailTemplateSubject, bodyTemplate: emailTemplateBody });
      const saved = result as unknown as EmailTemplate;
      setEmailTemplates((current) => [...current.filter((item) => item.kind !== emailTemplateKind), saved]);
      setFeedback("Notification email template saved. Empty fields use the built-in template.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save this email template."); }
    finally { setBusy(false); }
  }

  async function submitAnnouncement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const preview = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") !== "send";
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const title = String(form.get("title") ?? "").trim();
    const body = String(form.get("body") ?? "").trim();
    setBusy(true); setError(""); setFeedback("");
    try {
      const groupIds = announcementAudience === "groups" ? selectedGroupIds : [];
      if (announcementAudience === "groups" && groupIds.length === 0) throw new Error("Select at least one group for this announcement.");
      const payload = { title, body, audience: announcementAudience, groupIds };
      if (preview) {
        setAnnouncementPreview(undefined);
        const result = await mutate<AnnouncementPreview>("/api/modules/notifications/announcements/preview", "POST", payload);
        setAnnouncementPreview({ departmentId, result });
        return;
      }
      const result = await mutate("/api/modules/notifications/announcements", "POST", payload);
      const recipientCount = result.recipientCount ?? 0;
      setFeedback(format(recipientCount === 1 ? "Announcement sent to {count} person." : "Announcement sent to {count} people.", { count: String(recipientCount) }));
      setComposeOpen(false);
      setAnnouncementAudience("location");
      setSelectedGroupIds([]);
      setAnnouncementPreview(undefined);
      formElement.reset();
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : preview ? "Could not preview the announcement." : "Could not send the announcement."); }
    finally { setBusy(false); }
  }

  return <>
    <div className={`demo-notice ${error ? "demo-notice-error" : ""}`}><span className="demo-dot" />{error || format("Notifications for this location · {count} unread", { count: String(unreadCount) })}</div>
    <section className="page-heading notification-page-heading">
      <div><div className="eyebrow">STAY CONNECTED</div><h1>Notifications</h1><p className="page-subtitle">Announcements, event reminders, volunteer requests, and visitor follow-ups.</p></div>
      <div className="notification-heading-actions">
        {canSend && <button className="button button-primary" type="button" disabled={busy} onClick={() => { setAnnouncementPreview(undefined); setComposeOpen((open) => !open); }}><Megaphone size={15} />{composeOpen ? "Close announcement" : "New announcement"}</button>}
        <button className="button button-secondary" type="button" onClick={() => void markAllRead()} disabled={busy || unreadCount === 0}><CheckCheck size={15} />Mark all read</button>
      </div>
    </section>

    {composeOpen && canSend && <section className="directory-card notification-compose-card">
      <div className="directory-heading"><div><h2>Church announcement</h2><p>Send this message to everyone in the location or to active members of selected groups.</p></div></div>
      <form className="notification-compose-form" onSubmit={submitAnnouncement} onInput={() => setAnnouncementPreview(undefined)} aria-busy={busy}>
        <fieldset className="announcement-audience" disabled={busy}><legend>Audience</legend><label><input type="radio" name="announcementAudience" checked={announcementAudience === "location"} onChange={() => setAnnouncementAudience("location")} />Everyone in this location</label><label><input type="radio" name="announcementAudience" checked={announcementAudience === "groups"} onChange={() => setAnnouncementAudience("groups")} />Selected groups</label></fieldset>
        {announcementAudience === "groups" && <fieldset className="announcement-group-picker" disabled={busy}><legend>Select groups</legend>{groups.length ? groups.map((group) => <label key={group.id}><input type="checkbox" checked={selectedGroupIds.includes(group.id)} onChange={(event) => setSelectedGroupIds((current) => event.target.checked ? [...current, group.id] : current.filter((id) => id !== group.id))} /><span>{group.name}<small>{group.memberCount} people</small></span></label>) : <p>No groups are available in this location.</p>}</fieldset>}
        <label>Title<input name="title" required maxLength={120} placeholder="A short announcement" disabled={busy} /></label>
        <label>Message<textarea name="body" required maxLength={2000} rows={4} placeholder="Write a message for your church community…" disabled={busy} /></label>
        {announcementPreview?.departmentId === departmentId && <section className="announcement-preview" aria-label="Announcement preview">
          <h3>Announcement preview</h3>
          <dl>
            <div><dt>In-app recipients</dt><dd>{announcementPreview.result.accountCount}</dd></div>
            <div><dt>Eligible for email</dt><dd>{announcementPreview.result.emailEligibleCount}</dd></div>
          </dl>
          {!announcementPreview.result.emailConfigured && <p>Email delivery is currently unavailable for this location.</p>}
          <p>These counts reflect current membership and email preferences.</p>
          <h4>Sample email in your language</h4>
          <strong>{announcementPreview.result.sampleEmail.subject}</strong>
          <pre>{announcementPreview.result.sampleEmail.text}</pre>
        </section>}
        <div className="form-actions">
          <button className="button button-secondary" type="submit" value="preview" disabled={busy || (announcementAudience === "groups" && selectedGroupIds.length === 0)}>Preview announcement</button>
          <button className="button button-primary" type="submit" value="send" disabled={busy || (announcementAudience === "groups" && selectedGroupIds.length === 0)}><Send size={14} />Send announcement</button>
        </div>
      </form>
    </section>}

    {canSend && <section className="directory-card notification-template-card">
      <div className="directory-heading"><div><h2>Notification email templates</h2><p>Customize the subject and plain-text message for each notification type. Emails remain escaped and use the standard Smart Church layout.</p></div></div>
      <form className="notification-template-form" onSubmit={(event) => void saveEmailTemplate(event)}>
        <label>Notification type<select value={emailTemplateKind} disabled={busy} onChange={(event) => setEmailTemplateKind(event.target.value as EmailTemplateKind)}>{emailTemplateKinds.map((item) => <option key={item.kind} value={item.kind}>{item.label}</option>)}</select></label>
        <label>Email subject<input maxLength={240} value={emailTemplateSubject} disabled={busy} onChange={(event) => setEmailTemplateSubject(event.target.value)} placeholder="Default: notification title" /></label>
        <label>Email message<textarea maxLength={4000} rows={5} value={emailTemplateBody} disabled={busy} onChange={(event) => setEmailTemplateBody(event.target.value)} placeholder="Default: notification message" /></label>
        <p className="notification-template-help">Supported placeholders: <code>{"{title}"}</code>, <code>{"{body}"}</code>, <code>{"{open_url}"}</code>. Leave either field blank to use its built-in default. Template text is plain text; HTML is escaped automatically.</p>
        <div className="form-actions"><button className="button button-primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save email template"}</button></div>
      </form>
    </section>}

    <section className="notification-preference-card" aria-label="Notification preferences">
      <div className="notification-preference-icon"><Settings2 size={17} /></div>
      <div className="notification-preference-copy"><strong>Event reminders</strong><span>Get an in-app reminder about scheduled services and events one day ahead.</span></div>
      <label className="notification-toggle"><input type="checkbox" checked={eventRemindersEnabled} disabled={busy} onChange={(event) => void savePreferences(event.target.checked, serviceRequestsEnabled, followUpsEnabled, emailEnabled)} /><span>{eventRemindersEnabled ? "On" : "Off"}</span></label>
    </section>
    <section className="notification-preference-card" aria-label="Volunteer request preferences">
      <div className="notification-preference-icon"><ClipboardCheck size={17} /></div>
      <div className="notification-preference-copy"><strong>Service position requests</strong><span>Get an in-app message when you are assigned a service position in the next 30 days.</span></div>
      <label className="notification-toggle"><input type="checkbox" checked={serviceRequestsEnabled} disabled={busy} onChange={(event) => void savePreferences(eventRemindersEnabled, event.target.checked, followUpsEnabled, emailEnabled)} /><span>{serviceRequestsEnabled ? "On" : "Off"}</span></label>
    </section>
    <section className="notification-preference-card" aria-label="Visitor follow-up preferences">
      <div className="notification-preference-icon"><UserCheck size={17} /></div>
      <div className="notification-preference-copy"><strong>Visitor follow-ups</strong><span>Get an in-app notice when you are assigned a visitor follow-up and a reminder near its due date.</span></div>
      <label className="notification-toggle"><input type="checkbox" checked={followUpsEnabled} disabled={busy} onChange={(event) => void savePreferences(eventRemindersEnabled, serviceRequestsEnabled, event.target.checked, emailEnabled)} /><span>{followUpsEnabled ? "On" : "Off"}</span></label>
    </section>
    <section className="notification-preference-card" aria-label="Email notification preferences">
      <div className="notification-preference-icon"><Send size={17} /></div>
      <div className="notification-preference-copy"><strong>Email notifications</strong><span>{emailSuppressed ? "This address was suppressed after a bounce or complaint. Update your account email before expecting further delivery." : emailAddress ? format("Send inbox notifications to {email}.", { email: emailAddress }) : "Add an email address to your account to enable email notifications."}{!emailDeliveryConfigured && " Email delivery also needs to be configured by your administrator."}</span></div>
      <label className="notification-toggle"><input type="checkbox" checked={emailEnabled} disabled={busy || (!emailEnabled && (!emailDeliveryConfigured || !emailAddress || emailSuppressed))} onChange={(event) => void savePreferences(eventRemindersEnabled, serviceRequestsEnabled, followUpsEnabled, event.target.checked)} /><span>{emailEnabled ? "On" : "Off"}</span></label>
    </section>

    {feedback && <p className="notification-feedback" role="status"><Check size={14} />{feedback}</p>}
    {error && <p className="notification-feedback notification-feedback-error" role="alert"><CircleAlert size={14} />{error}</p>}

    <section className="directory-card notification-inbox">
      <div className="directory-heading"><div><h2>Your inbox</h2><p>{format("Showing your latest {count} notifications.", { count: String(notifications.length) })}</p></div><span className="notification-unread-pill"><Bell size={13} />{unreadCount} unread</span></div>
      {loading ? <p className="notification-empty" role="status">Loading notifications…</p> : notifications.length === 0 ? <div className="notification-empty-state"><span><Bell size={20} /></span><strong>You’re all caught up</strong><p>New announcements and event reminders will appear here.</p></div> : <div className="notification-list">
        {notifications.map((notification) => <article className={`notification-item notification-clickable-item${notification.readAt ? " notification-item-read" : " notification-item-unread"}`} key={notification.id} tabIndex={0} onClick={(event) => { if (event.target instanceof Element && event.target.closest("button, a, input, select, textarea")) return; setDetailsNotification(notification); }} onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) { event.preventDefault(); setDetailsNotification(notification); } }}>
          <div className={`notification-item-icon ${notification.kind === "event_reminder" || notification.kind === "follow_up_reminder" ? "notification-item-icon-event" : notification.kind === "service_request" || notification.kind === "follow_up_assignment" ? "notification-item-icon-request" : "notification-item-icon-announcement"}`}>{notification.kind === "event_reminder" || notification.kind === "follow_up_reminder" ? <CalendarClock size={17} /> : notification.kind === "service_request" ? <ClipboardCheck size={17} /> : notification.kind === "follow_up_assignment" ? <UserCheck size={17} /> : <Megaphone size={17} />}</div>
          <div className="notification-item-content"><div className="notification-item-heading"><strong>{notification.title}</strong><time dateTime={notification.createdAt}>{formatUserDate(notification.createdAt, true)}</time></div><p>{notification.body}</p><small>{notification.kind === "event_reminder" ? "Event reminder" : notification.kind === "service_request" ? "Volunteer request" : notification.kind === "follow_up_assignment" ? "Visitor follow-up assignment" : notification.kind === "follow_up_reminder" ? "Visitor follow-up reminder" : notification.kind === "community_feed" ? "Community Feed notification" : notification.kind === "report_ready" ? "Scheduled report" : "Location announcement"}</small>{notification.emailDeliveryStatus && <small className={`notification-email-status notification-email-status-${notification.emailDeliveryStatus}`}>{format("Email {status}", { status: t(notification.emailDeliveryStatus === "pending" ? "queued" : notification.emailDeliveryStatus === "sent" ? "accepted by provider" : notification.emailDeliveryStatus) })}</small>}</div>
          {!notification.readAt && <button className="button button-secondary notification-read-button" type="button" onClick={() => void markRead(notification)} aria-label={format("Mark “{title}” as read", { title: notification.title })}><Check size={14} />Read</button>}
        </article>)}
      </div>}
    </section>
    {detailsNotification && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setDetailsNotification(null)}><section className="modal item-details-modal notification-details-modal" role="dialog" aria-modal="true" aria-labelledby="notification-details-title"><div className="modal-heading"><div><span className="eyebrow">{detailsNotification.kind === "event_reminder" ? "EVENT REMINDER" : detailsNotification.kind === "service_request" ? "VOLUNTEER REQUEST" : detailsNotification.kind === "follow_up_assignment" ? "VISITOR FOLLOW-UP" : detailsNotification.kind === "follow_up_reminder" ? "FOLLOW-UP REMINDER" : detailsNotification.kind === "community_feed" ? "COMMUNITY FEED" : detailsNotification.kind === "report_ready" ? "SCHEDULED REPORT" : "ANNOUNCEMENT"}</span><h2 id="notification-details-title">{detailsNotification.title}</h2><p>{formatUserDate(detailsNotification.createdAt, true)}</p></div><button className="icon-button" type="button" aria-label="Close dialog" onClick={() => setDetailsNotification(null)}>×</button></div><p className="notification-details-body">{detailsNotification.body}</p><dl className="event-details-grid"><div><dt>Type</dt><dd>{detailsNotification.kind === "event_reminder" ? "Event reminder" : detailsNotification.kind === "service_request" ? "Volunteer request" : detailsNotification.kind === "follow_up_assignment" ? "Visitor follow-up assignment" : detailsNotification.kind === "follow_up_reminder" ? "Visitor follow-up reminder" : detailsNotification.kind === "community_feed" ? "Community Feed notification" : detailsNotification.kind === "report_ready" ? "Scheduled report" : "Location announcement"}</dd></div><div><dt>Status</dt><dd>{detailsNotification.readAt ? "Read" : "Unread"}</dd></div>{detailsNotification.emailDeliveryStatus && <div><dt>Email delivery</dt><dd>{format("Email {status}", { status: t(detailsNotification.emailDeliveryStatus === "pending" ? "queued" : detailsNotification.emailDeliveryStatus === "sent" ? "accepted by provider" : detailsNotification.emailDeliveryStatus) })}</dd></div>}</dl><div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setDetailsNotification(null)}>Close</button>{!detailsNotification.readAt && <button className="button button-primary" type="button" onClick={() => void markRead(detailsNotification)}><Check size={14} />Read</button>}</div></section></div>}
    <footer className="page-footer"><span>Notifications are private to your account and selected location.</span><span>Reminders, requests, and follow-ups are delivered in-app.</span></footer>
  </>;
}
