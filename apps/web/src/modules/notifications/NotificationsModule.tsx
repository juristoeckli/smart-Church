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
  kind: "announcement" | "event_reminder" | "service_request" | "follow_up_assignment" | "follow_up_reminder";
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
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [groups, setGroups] = useState<ChurchGroup[]>([]);
  const [announcementAudience, setAnnouncementAudience] = useState<"location" | "groups">("location");
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
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
    void fetch("/api/groups", { headers: { "x-department-id": departmentId } }).then(async (response) => {
      const result = await response.json() as ChurchGroup[] | { error?: string };
      if (!response.ok || !Array.isArray(result)) throw new Error("Could not load groups for announcement targeting.");
      if (active) setGroups(result);
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Could not load groups for announcement targeting."); });
    return () => { active = false; };
  }, [canSend, departmentId]);

  async function mutate(path: string, method: string, body?: object) {
    const response = await fetch(path, {
      method,
      headers: {
        "x-department-id": departmentId,
        "x-csrf-token": csrfToken,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json() as { error?: string; eventRemindersEnabled?: boolean; serviceRequestsEnabled?: boolean; followUpsEnabled?: boolean; emailEnabled?: boolean; recipientCount?: number };
    if (!response.ok) throw new Error(result.error ?? "The request failed.");
    return result;
  }

  async function markRead(notification: Notification) {
    if (notification.readAt) return;
    try {
      await mutate(`/api/modules/notifications/${encodeURIComponent(notification.id)}/read`, "POST");
      setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item));
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

  async function sendAnnouncement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const title = String(form.get("title") ?? "").trim();
    const body = String(form.get("body") ?? "").trim();
    setBusy(true); setError(""); setFeedback("");
    try {
      const groupIds = announcementAudience === "groups" ? selectedGroupIds : [];
      if (announcementAudience === "groups" && groupIds.length === 0) throw new Error("Select at least one group for this announcement.");
      const result = await mutate("/api/modules/notifications/announcements", "POST", { title, body, audience: announcementAudience, groupIds });
      const recipientCount = result.recipientCount ?? 0;
      setFeedback(format(recipientCount === 1 ? "Announcement sent to {count} person." : "Announcement sent to {count} people.", { count: String(recipientCount) }));
      setComposeOpen(false);
      setAnnouncementAudience("location");
      setSelectedGroupIds([]);
      formElement.reset();
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not send the announcement."); }
    finally { setBusy(false); }
  }

  return <>
    <div className={`demo-notice ${error ? "demo-notice-error" : ""}`}><span className="demo-dot" />{error || format("Notifications for this location · {count} unread", { count: String(unreadCount) })}</div>
    <section className="page-heading notification-page-heading">
      <div><div className="eyebrow">STAY CONNECTED</div><h1>Notifications</h1><p className="page-subtitle">Announcements, event reminders, volunteer requests, and visitor follow-ups.</p></div>
      <div className="notification-heading-actions">
        {canSend && <button className="button button-primary" type="button" onClick={() => setComposeOpen((open) => !open)}><Megaphone size={15} />{composeOpen ? "Close announcement" : "New announcement"}</button>}
        <button className="button button-secondary" type="button" onClick={() => void markAllRead()} disabled={busy || unreadCount === 0}><CheckCheck size={15} />Mark all read</button>
      </div>
    </section>

    {composeOpen && canSend && <section className="directory-card notification-compose-card">
      <div className="directory-heading"><div><h2>Church announcement</h2><p>Send this message to everyone in the location or to active members of selected groups.</p></div></div>
      <form className="notification-compose-form" onSubmit={sendAnnouncement}>
        <fieldset className="announcement-audience"><legend>Audience</legend><label><input type="radio" name="announcementAudience" checked={announcementAudience === "location"} onChange={() => setAnnouncementAudience("location")} />Everyone in this location</label><label><input type="radio" name="announcementAudience" checked={announcementAudience === "groups"} onChange={() => setAnnouncementAudience("groups")} />Selected groups</label></fieldset>
        {announcementAudience === "groups" && <fieldset className="announcement-group-picker"><legend>Select groups</legend>{groups.length ? groups.map((group) => <label key={group.id}><input type="checkbox" checked={selectedGroupIds.includes(group.id)} onChange={(event) => setSelectedGroupIds((current) => event.target.checked ? [...current, group.id] : current.filter((id) => id !== group.id))} /><span>{group.name}<small>{group.memberCount} people</small></span></label>) : <p>No groups are available in this location.</p>}</fieldset>}
        <label>Title<input name="title" required maxLength={120} placeholder="A short announcement" /></label>
        <label>Message<textarea name="body" required maxLength={2000} rows={4} placeholder="Write a message for your church community…" /></label>
        <div className="form-actions"><button className="button button-primary" type="submit" disabled={busy || (announcementAudience === "groups" && selectedGroupIds.length === 0)}><Send size={14} />{busy ? "Sending…" : "Send announcement"}</button></div>
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
        {notifications.map((notification) => <article className={`notification-item${notification.readAt ? " notification-item-read" : " notification-item-unread"}`} key={notification.id}>
          <div className={`notification-item-icon ${notification.kind === "event_reminder" || notification.kind === "follow_up_reminder" ? "notification-item-icon-event" : notification.kind === "service_request" || notification.kind === "follow_up_assignment" ? "notification-item-icon-request" : "notification-item-icon-announcement"}`}>{notification.kind === "event_reminder" || notification.kind === "follow_up_reminder" ? <CalendarClock size={17} /> : notification.kind === "service_request" ? <ClipboardCheck size={17} /> : notification.kind === "follow_up_assignment" ? <UserCheck size={17} /> : <Megaphone size={17} />}</div>
          <div className="notification-item-content"><div className="notification-item-heading"><strong>{notification.title}</strong><time dateTime={notification.createdAt}>{formatUserDate(notification.createdAt, true)}</time></div><p>{notification.body}</p><small>{notification.kind === "event_reminder" ? "Event reminder" : notification.kind === "service_request" ? "Volunteer request" : notification.kind === "follow_up_assignment" ? "Visitor follow-up assignment" : notification.kind === "follow_up_reminder" ? "Visitor follow-up reminder" : "Location announcement"}</small>{notification.emailDeliveryStatus && <small className={`notification-email-status notification-email-status-${notification.emailDeliveryStatus}`}>{format("Email {status}", { status: t(notification.emailDeliveryStatus === "pending" ? "queued" : notification.emailDeliveryStatus === "sent" ? "accepted by provider" : notification.emailDeliveryStatus) })}</small>}</div>
          {!notification.readAt && <button className="button button-secondary notification-read-button" type="button" onClick={() => void markRead(notification)} aria-label={format("Mark “{title}” as read", { title: notification.title })}><Check size={14} />Read</button>}
        </article>)}
      </div>}
    </section>
    <footer className="page-footer"><span>Notifications are private to your account and selected location.</span><span>Reminders, requests, and follow-ups are delivered in-app.</span></footer>
  </>;
}
