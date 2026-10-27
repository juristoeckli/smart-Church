import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Bell, CalendarClock, Check, CheckCheck, CircleAlert, Megaphone, Send, Settings2 } from "lucide-react";
import type { ModuleContext } from "../../module-registry";
import "./notifications.css";

type Notification = {
  id: string;
  kind: "announcement" | "event_reminder";
  title: string;
  body: string;
  eventId?: string;
  createdAt: string;
  readAt?: string;
};

type NotificationResponse = {
  notifications: Notification[];
  unreadCount: number;
  eventRemindersEnabled: boolean;
  canSend: boolean;
};

export function NotificationsModule({ departmentId, csrfToken }: ModuleContext) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [eventRemindersEnabled, setEventRemindersEnabled] = useState(true);
  const [canSend, setCanSend] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const unreadCount = notifications.filter((notification) => !notification.readAt).length;

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/modules/notifications", { headers: { "x-department-id": departmentId } });
      const result = await response.json() as NotificationResponse | { error?: string };
      if (!response.ok || !("notifications" in result)) throw new Error("error" in result ? result.error ?? "Could not load notifications." : "Could not load notifications.");
      setNotifications(result.notifications);
      setEventRemindersEnabled(result.eventRemindersEnabled);
      setCanSend(result.canSend);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load notifications.");
    } finally { setLoading(false); }
  }, [departmentId]);

  useEffect(() => { void load(); }, [load]);

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
    const result = await response.json() as { error?: string; eventRemindersEnabled?: boolean; recipientCount?: number };
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

  async function savePreferences(enabled: boolean) {
    setBusy(true); setError(""); setFeedback("");
    try {
      await mutate("/api/modules/notifications/preferences", "PUT", { eventRemindersEnabled: enabled });
      setEventRemindersEnabled(enabled);
      setFeedback(enabled ? "Event reminders are on." : "Event reminders are off.");
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
      const result = await mutate("/api/modules/notifications/announcements", "POST", { title, body });
      setFeedback(`Announcement sent to ${result.recipientCount ?? 0} ${result.recipientCount === 1 ? "person" : "people"}.`);
      setComposeOpen(false);
      formElement.reset();
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not send the announcement."); }
    finally { setBusy(false); }
  }

  return <>
    <div className={`demo-notice ${error ? "demo-notice-error" : ""}`}><span className="demo-dot" />{error || `Notifications for this location · ${unreadCount} unread`}</div>
    <section className="page-heading notification-page-heading">
      <div><div className="eyebrow">STAY CONNECTED</div><h1>Notifications</h1><p className="page-subtitle">Announcements and reminders for your church community.</p></div>
      <div className="notification-heading-actions">
        {canSend && <button className="button button-primary" type="button" onClick={() => setComposeOpen((open) => !open)}><Megaphone size={15} />{composeOpen ? "Close announcement" : "New announcement"}</button>}
        <button className="button button-secondary" type="button" onClick={() => void markAllRead()} disabled={busy || unreadCount === 0}><CheckCheck size={15} />Mark all read</button>
      </div>
    </section>

    {composeOpen && canSend && <section className="directory-card notification-compose-card">
      <div className="directory-heading"><div><h2>Location announcement</h2><p>This message will appear in every member’s notification inbox for this location.</p></div></div>
      <form className="notification-compose-form" onSubmit={sendAnnouncement}>
        <label>Title<input name="title" required maxLength={120} placeholder="A short announcement" /></label>
        <label>Message<textarea name="body" required maxLength={2000} rows={4} placeholder="Write a message for your church community…" /></label>
        <div className="form-actions"><button className="button button-primary" type="submit" disabled={busy}><Send size={14} />{busy ? "Sending…" : "Send announcement"}</button></div>
      </form>
    </section>}

    <section className="notification-preference-card" aria-label="Notification preferences">
      <div className="notification-preference-icon"><Settings2 size={17} /></div>
      <div className="notification-preference-copy"><strong>Event reminders</strong><span>Get an in-app reminder about scheduled services and events one day ahead.</span></div>
      <label className="notification-toggle"><input type="checkbox" checked={eventRemindersEnabled} disabled={busy} onChange={(event) => void savePreferences(event.target.checked)} /><span>{eventRemindersEnabled ? "On" : "Off"}</span></label>
    </section>

    {feedback && <p className="notification-feedback" role="status"><Check size={14} />{feedback}</p>}
    {error && <p className="notification-feedback notification-feedback-error" role="alert"><CircleAlert size={14} />{error}</p>}

    <section className="directory-card notification-inbox">
      <div className="directory-heading"><div><h2>Your inbox</h2><p>Showing your latest {notifications.length} notifications.</p></div><span className="notification-unread-pill"><Bell size={13} />{unreadCount} unread</span></div>
      {loading ? <p className="notification-empty" role="status">Loading notifications…</p> : notifications.length === 0 ? <div className="notification-empty-state"><span><Bell size={20} /></span><strong>You’re all caught up</strong><p>New announcements and event reminders will appear here.</p></div> : <div className="notification-list">
        {notifications.map((notification) => <article className={`notification-item${notification.readAt ? " notification-item-read" : " notification-item-unread"}`} key={notification.id}>
          <div className={`notification-item-icon ${notification.kind === "event_reminder" ? "notification-item-icon-event" : "notification-item-icon-announcement"}`}>{notification.kind === "event_reminder" ? <CalendarClock size={17} /> : <Megaphone size={17} />}</div>
          <div className="notification-item-content"><div className="notification-item-heading"><strong>{notification.title}</strong><time dateTime={notification.createdAt}>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(notification.createdAt))}</time></div><p>{notification.body}</p><small>{notification.kind === "event_reminder" ? "Event reminder" : "Location announcement"}</small></div>
          {!notification.readAt && <button className="button button-secondary notification-read-button" type="button" onClick={() => void markRead(notification)} aria-label={`Mark “${notification.title}” as read`}><Check size={14} />Read</button>}
        </article>)}
      </div>}
    </section>
    <footer className="page-footer"><span>Notifications are private to your account and selected location.</span><span>Event reminders are delivered in-app.</span></footer>
  </>;
}
