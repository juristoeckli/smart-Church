import { useEffect, useState, type FormEvent } from "react";

type EmailSettings = {
  mode: "direct" | "smtp";
  enabled: boolean;
  fromName: string;
  fromEmail: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: "none" | "starttls" | "tls";
  smtpUsername: string;
  passwordConfigured: boolean;
};
type Draft = EmailSettings & { smtpPassword: string; clearPassword: boolean };
const emptySettings: Draft = {
  mode: "direct", enabled: false, fromName: "Smart Church", fromEmail: "",
  smtpHost: "", smtpPort: 587, smtpSecurity: "starttls", smtpUsername: "",
  passwordConfigured: false, smtpPassword: "", clearPassword: false,
};

export function ServerEmailSettings({ refreshCsrfToken }: { refreshCsrfToken: () => Promise<string> }) {
  const [draft, setDraft] = useState<Draft>(emptySettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; error: boolean } | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/modules/email-worker/settings", { cache: "no-store" }).then(async (response) => {
      const result = await response.json() as Partial<EmailSettings> & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not load email settings.");
      if (!active) return;
      setDraft({ ...emptySettings, ...result, smtpPassword: "", clearPassword: false } as Draft);
    }).catch((error: unknown) => {
      if (active) setFeedback({ message: error instanceof Error ? error.message : "Could not load email settings.", error: true });
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setFeedback(null);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      const csrfToken = await refreshCsrfToken();
      const { passwordConfigured: _passwordConfigured, ...payload } = draft;
      const response = await fetch("/api/modules/email-worker/settings", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as Partial<EmailSettings> & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not save email settings.");
      setDraft((current) => ({ ...current, ...result, smtpPassword: "", clearPassword: false } as Draft));
      setFeedback({ message: "Email server settings saved.", error: false });
    } catch (error) {
      setFeedback({ message: error instanceof Error ? error.message : "Could not save email settings.", error: true });
    } finally { setSaving(false); }
  }

  if (loading) return <p className="server-settings-empty">Loading email server settings…</p>;

  return <form className="server-email-settings" onSubmit={(event) => void save(event)}>
    <div className="server-admin-panel-heading"><h3>Email delivery</h3><p>Configure the shared email service used by Smart-Church modules and notifications.</p></div>
    <label className="global-admin-option"><input type="checkbox" checked={draft.enabled} onChange={(event) => update("enabled", event.target.checked)} /><span><strong>{draft.enabled ? "Email delivery enabled" : "Email delivery disabled"}</strong><small>When enabled and configured, applications can send email through this server.</small></span></label>
    <label>Delivery mode<select value={draft.mode} onChange={(event) => update("mode", event.target.value as Draft["mode"])}><option value="direct">Direct delivery</option><option value="smtp">SMTP through a server</option></select></label>
    {draft.mode === "direct" ? <p className="server-email-help">Smart-Church looks up the recipient domain’s mail server and delivers directly. The host must allow outbound SMTP on port 25. Configure SPF and DKIM for reliable delivery.</p> : <>
      <div className="server-email-grid"><label>SMTP server<input required={draft.enabled} value={draft.smtpHost} onChange={(event) => update("smtpHost", event.target.value)} placeholder="smtp.example.org" autoComplete="off" /></label><label>Port<input type="number" min={1} max={65535} required value={draft.smtpPort} onChange={(event) => update("smtpPort", Number(event.target.value))} /></label><label>Connection security<select value={draft.smtpSecurity} onChange={(event) => update("smtpSecurity", event.target.value as Draft["smtpSecurity"])}><option value="starttls">STARTTLS (recommended)</option><option value="tls">Implicit TLS</option><option value="none">None</option></select></label><label>Username<input value={draft.smtpUsername} onChange={(event) => update("smtpUsername", event.target.value)} autoComplete="username" /></label></div>
      <label>SMTP password<input type="password" value={draft.smtpPassword} placeholder={draft.passwordConfigured ? "Saved securely · leave blank to keep" : "Optional"} onChange={(event) => update("smtpPassword", event.target.value)} autoComplete="new-password" /></label>
      {draft.passwordConfigured && <label className="server-email-clear-password"><input type="checkbox" checked={draft.clearPassword} onChange={(event) => update("clearPassword", event.target.checked)} /><span>Remove the saved SMTP password</span></label>}
    </>}
    <div className="server-email-grid"><label>Sender name<input required value={draft.fromName} maxLength={120} onChange={(event) => update("fromName", event.target.value)} /></label><label>Sender email address<input type="email" required={draft.enabled} value={draft.fromEmail} maxLength={254} onChange={(event) => update("fromEmail", event.target.value)} placeholder="noreply@example.org" /></label></div>
    {feedback && <p className={`user-access-feedback ${feedback.error ? "user-access-feedback-error" : ""}`} role={feedback.error ? "alert" : "status"}>{feedback.message}</p>}
    <div className="form-actions"><button className="button button-primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save email settings"}</button></div>
  </form>;
}
