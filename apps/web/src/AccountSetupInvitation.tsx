import { useEffect, useState, type FormEvent } from "react";

type Invitation = { status: "pending" | "accepted" | "revoked" | "expired" | "invalidated"; issuedAt: string; expiresAt: string };
type InvitationState = { eligible: boolean; invitation: Invitation | null };

async function errorMessage(response: Response, fallback: string) {
  const result = await response.json().catch(() => null) as { error?: string } | null;
  return result?.error || fallback;
}

export function AccountSetupInvitation({ userId, refreshCsrfToken }: { userId: string; refreshCsrfToken: () => Promise<string> }) {
  const route = `/api/users/${userId}/setup-invitation`;
  const [state, setState] = useState<InvitationState | null>(null);
  const [link, setLink] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean }>();

  useEffect(() => {
    const controller = new AbortController();
    void fetch(route, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(await errorMessage(response, "Could not load the setup invitation."));
      setState(await response.json() as InvitationState);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setFeedback({ text: error instanceof Error ? error.message : "Could not load the setup invitation.", error: true });
    });
    return () => controller.abort();
  }, [route]);

  async function change(method: "POST" | "DELETE") {
    setSaving(true);
    setLink("");
    setFeedback(undefined);
    try {
      const csrf = await refreshCsrfToken();
      const response = await fetch(route, { method, headers: { "x-csrf-token": csrf } });
      if (!response.ok) throw new Error(await errorMessage(response, "Could not update the setup invitation."));
      if (method === "POST") {
        const { setupCode, ...invitation } = await response.json() as Invitation & { setupCode: string };
        setState({ eligible: true, invitation });
        setLink(`${window.location.origin}/account-setup#${setupCode}`);
        setFeedback({ text: "Setup link created. Share it privately with the account holder." });
      } else {
        setState((current) => current?.invitation ? { ...current, invitation: { ...current.invitation, status: "revoked" } } : current);
        setFeedback({ text: "Setup link revoked." });
      }
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : "Could not update the setup invitation.", error: true });
    } finally {
      setSaving(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setFeedback({ text: "Setup link copied." });
    } catch {
      setFeedback({ text: "Select the link and copy it manually.", error: true });
    }
  }

  if (state && !state.eligible && !state.invitation) return null;
  return <section className="password-reset-panel" aria-label="Account setup invitation">
    <div className="password-reset-heading"><strong>Account setup invitation</strong></div>
    {state?.invitation && <p>Setup link status: {state.invitation.status}. {state.invitation.status === "pending" && <>Expires {new Date(state.invitation.expiresAt).toLocaleString()}.</>}</p>}
    {state?.eligible && <p>The account holder chooses their own password. A replacement link revokes the previous link.</p>}
    {!state && !feedback && <p role="status">Checking invitation status…</p>}
    <div className="password-reset-actions">
      {state?.eligible && <button className="button button-secondary" type="button" disabled={saving} onClick={() => void change("POST")}>
        {state.invitation ? "Create replacement setup link" : "Create setup link"}
      </button>}
      {(state?.invitation?.status === "pending" || state?.invitation?.status === "invalidated") && <button className="button button-secondary" type="button" disabled={saving} onClick={() => void change("DELETE")}>Revoke link</button>}
    </div>
    {link && <label>Setup link<div className="generated-password-row">
      <input value={link} readOnly onFocus={(event) => event.currentTarget.select()} spellCheck={false} />
      <button className="button button-secondary" type="button" onClick={() => void copyLink()}>Copy</button>
    </div></label>}
    {feedback && <p role={feedback.error ? "alert" : "status"}>{feedback.text}</p>}
  </section>;
}

export function PersonAccountOnboarding({ personId, departmentId, locationName, refreshCsrfToken }: {
  personId: string;
  departmentId: string;
  locationName: string;
  refreshCsrfToken: () => Promise<string>;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ username: string; invitation: Invitation & { setupCode: string } }>();
  const [copied, setCopied] = useState(false);
  const link = result ? `${window.location.origin}/account-setup#${result.invitation.setupCode}` : "";

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || result) return;
    const username = String(new FormData(event.currentTarget).get("username") ?? "");
    setError("");
    setSaving(true);
    try {
      const csrf = await refreshCsrfToken();
      const response = await fetch(`/api/contacts/${personId}/onboard-account`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrf, "x-department-id": departmentId },
        body: JSON.stringify({ username, role: "member" }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, "Could not create the linked account."));
      setResult(await response.json());
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not create the linked account.");
    } finally {
      setSaving(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setError("");
    } catch {
      setError("Select the setup link and copy it manually.");
    }
  }

  return <section className="password-reset-panel" aria-label="Smart-Church access">
    {!open && <button type="button" className="button button-secondary" onClick={() => setOpen(true)}>Create linked account</button>}
    {open && !result && <form onSubmit={(event) => void create(event)} className="auth-form">
      <div className="password-reset-heading"><strong>Review account access</strong></div>
      <p>Location: {locationName}. Role: Member. Additional permissions: None.</p>
      <p>The person will sign in with the username below after choosing a password. Share the setup link directly with them.</p>
      <label>Username<input name="username" autoComplete="off" minLength={3} maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9._\-]{2,31}" required /></label>
      <div className="password-reset-actions">
        <button className="button button-primary" disabled={saving}>{saving ? "Creating…" : "Create account and setup link"}</button>
        <button className="button button-secondary" type="button" disabled={saving} onClick={() => { setError(""); setOpen(false); }}>Cancel</button>
      </div>
    </form>}
    {result && <>
      <p role="status">Linked account {result.username} created. The setup link expires on {new Date(result.invitation.expiresAt).toLocaleDateString()}.</p>
      <label>Setup link<div className="generated-password-row">
        <input value={link} readOnly spellCheck={false} onFocus={(event) => event.currentTarget.select()} />
        <button type="button" className="button button-secondary" onClick={() => void copyLink()}>Copy link</button>
      </div></label>
      {copied && <p role="status">Setup link copied.</p>}
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

export function AccountSetupPage() {
  const [setupCode] = useState(() => window.location.hash.slice(1));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const validLink = /^[A-Za-z0-9_-]{43}$/.test(setupCode);
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !validLink || saved) return;
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password !== form.get("confirmPassword")) {
      setError("The passwords do not match.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/auth/accept-setup-invitation", {
        method: "POST", credentials: "omit", headers: { "content-type": "application/json" }, body: JSON.stringify({ setupCode, password }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, "Could not set up your account."));
      setSaved(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not set up your account.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="auth-page"><section className="auth-card" aria-labelledby="account-setup-heading">
    <header className="auth-heading"><h1 id="account-setup-heading">Set up your account</h1>
      <p>{saved ? "Your password is ready. Sign in with your existing username or email address." : "Choose a password for your Smart-Church account."}</p>
    </header>
    {!validLink && <p className="auth-message auth-message-error" role="alert">This setup link is unavailable. Ask your administrator for a new link.</p>}
    {validLink && !saved && <form className="auth-form" onSubmit={(event) => void submit(event)}>
      <label>New password<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label>
      <label>Confirm password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label>
      {error && <p className="auth-message auth-message-error" role="alert">{error}</p>}
      <button className="button button-primary auth-submit" disabled={busy}>{busy ? "Saving…" : "Set password"}</button>
    </form>}
    <div className="auth-footnote"><a href="/">Go to sign in</a></div>
  </section></main>;
}
