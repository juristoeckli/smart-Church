import { useEffect, useState } from "react";
import { LogOut, RefreshCw, ShieldOff } from "lucide-react";
import { formatUserDate } from "./date-format";
import { translate } from "./i18n";

type AuthSession = {
  id: string;
  userAgent: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
};

export function UserSessions({ onSignedOut }: { onSignedOut: () => void | Promise<void> }) {
  const [sessions, setSessions] = useState<AuthSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revokingId, setRevokingId] = useState("");

  async function loadSessions() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/sessions", { cache: "no-store" });
      const result = await response.json() as { sessions?: AuthSession[]; error?: string };
      if (!response.ok || !Array.isArray(result.sessions)) throw new Error(result.error ?? "Could not load sign-in sessions.");
      setSessions(result.sessions);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load sign-in sessions.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadSessions(); }, []);

  async function revokeSession(session: AuthSession) {
    if (!window.confirm(translate("sessions.confirmRevoke").replace("{device}", session.userAgent || translate("sessions.unknownDevice")))) return;
    setRevokingId(session.id);
    setError("");
    try {
      const response = await fetch(`/api/auth/sessions/${session.id}`, { method: "DELETE" });
      const result = await response.json() as { revoked?: boolean; current?: boolean; error?: string };
      if (!response.ok || !result.revoked) throw new Error(result.error ?? "Could not revoke this sign-in session.");
      if (result.current) {
        await onSignedOut();
        return;
      }
      setSessions((current) => current.filter((item) => item.id !== session.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not revoke this sign-in session.");
    } finally {
      setRevokingId("");
    }
  }

  return <section className="my-settings-section auth-sessions-section" aria-labelledby="auth-sessions-title">
    <div>
      <h3 id="auth-sessions-title">{translate("sessions.title")}</h3>
      <p>{translate("sessions.description")}</p>
      {error && <small className="system-notification-feedback" role="alert">{error}</small>}
    </div>
    <div className="auth-session-list">
      <div className="auth-session-toolbar"><button className="button button-secondary" type="button" onClick={() => void loadSessions()} disabled={loading}><RefreshCw size={14} />{translate("sessions.refresh")}</button></div>
      {loading ? <p className="community-empty">{translate("sessions.loading")}</p> : sessions.length ? sessions.map((session) => <article className="auth-session-card" key={session.id}>
        <div className="auth-session-details">
          <strong>{session.userAgent || translate("sessions.unknownDevice")}{session.current && <span className="auth-session-current">{translate("sessions.current")}</span>}</strong>
          <small>{translate("sessions.lastActive")}: {formatUserDate(session.lastSeenAt, true)}</small>
          <small>{translate("sessions.created")}: {formatUserDate(session.createdAt, true)}</small>
          <small>{translate("sessions.expires")}: {formatUserDate(session.expiresAt, true)}</small>
        </div>
        <button className="button button-secondary auth-session-revoke" type="button" disabled={revokingId === session.id} onClick={() => void revokeSession(session)}>
          {session.current ? <LogOut size={14} /> : <ShieldOff size={14} />}{revokingId === session.id ? translate("sessions.revoking") : session.current ? translate("sessions.signOutHere") : translate("sessions.revoke")}
        </button>
      </article>) : <p className="community-empty">{translate("sessions.none")}</p>}
    </div>
  </section>;
}
