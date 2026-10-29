import { useState, type FormEvent } from "react";
import { ArrowRight, Church, LockKeyhole } from "lucide-react";
import type { AuthenticatedUser } from "@smart-church/contracts";

const smartChurchLogoUrl = "/smart-church-mark.svg";
const usernamePattern = "[A-Za-z0-9][A-Za-z0-9._-]{2,31}";
const usernameHelp = "Use 3–32 characters: letters, numbers, dots, hyphens, or underscores. Put your email in the Email address field.";

function authValidationMessage(message: string | undefined) {
  const detail = message?.toLowerCase() ?? "";
  if (detail.includes("username")) return usernameHelp;
  if (detail.includes("email")) return "Enter a valid email address.";
  if (detail.includes("password")) return "Use a password between 12 and 128 characters.";
  if (detail.includes("setupcode")) return "Check the one-time setup code and enter at least 8 characters.";
  if (detail.includes("location")) return "Enter a church location with no more than 120 characters.";
  if (detail.includes("displayname")) return "Enter your name with no more than 100 characters.";
  return "Some information is invalid. Check the field requirements and try again.";
}

function AuthDove({ className }: { className: string }) {
  return <svg className={className} viewBox="0 0 180 215" aria-hidden="true">
    <path d="M82 130c-16 20-38 33-69 38 1 18 13 34 32 43 16-13 26-33 30-54" fill="#d7e0fb" stroke="#0b307d" strokeWidth="8" strokeLinejoin="round" />
    <g className="auth-dove-wing">
      <path d="M91 108C83 79 62 64 39 64c-13 0-23-3-32-9v24c0 12 8 20 21 21-2 10 5 18 17 19-2 10 6 18 18 18h25" fill="#d7e0fb" stroke="#0b307d" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M28 100h25M40 119h24M62 137h26" fill="none" stroke="#0b307d" strokeWidth="8" strokeLinecap="round" />
    </g>
    <path d="M81 105c16-18 31-40 47-42 13-2 22 7 21 18-1 8-8 14-18 23l-12 11c4 20-3 38-18 51-14 12-32 16-54 15 20-15 33-34 34-55 0-8-2-15-7-21z" fill="#fff" stroke="#0b307d" strokeWidth="8" strokeLinejoin="round" />
    <path d="M137 78l28 8-25 12" fill="#ffc83d" stroke="#0b307d" strokeWidth="7" strokeLinejoin="round" />
    <circle cx="137" cy="78" r="4.5" fill="#0b307d" />
    <path d="M133 62l-8-23M135 58l8-20" fill="none" stroke="#0b307d" strokeWidth="5" strokeLinecap="round" />
    <path d="M127 42c-13-1-21-10-21-23 12 0 20 7 23 18M140 39c2-13 11-20 24-19 0 12-7 20-20 23" fill="#9bd13d" stroke="#0b307d" strokeWidth="5" strokeLinejoin="round" />
  </svg>;
}

function AuthBackdrop() {
  return <>
    <svg className="auth-cross" viewBox="0 0 240 400" aria-hidden="true">
      <path d="M89 10h17l5 27 5-27h11l7 20 4-20h13v94h85l-7 7 7 3v41l-40 5 40 5v11h-85v214h-13l-4-20-7 20h-11l-5-27-5 27H89V176H4v-11l40-5-40-5v-41l12-3-7-7h80V10z" fill="currentColor" />
    </svg>
    <svg className="auth-cross auth-cross-secondary" viewBox="0 0 240 400" aria-hidden="true">
      <path d="M89 10h17l5 27 5-27h11l7 20 4-20h13v94h85l-7 7 7 3v41l-40 5 40 5v11h-85v214h-13l-4-20-7 20h-11l-5-27-5 27H89V176H4v-11l40-5-40-5v-41l12-3-7-7h80V10z" fill="currentColor" />
    </svg>
    <AuthDove className="auth-dove auth-dove-main" />
    <AuthDove className="auth-dove auth-dove-follower" />
    <span className="auth-word auth-word-faith" aria-hidden="true">Faith</span>
    <span className="auth-word auth-word-hope" aria-hidden="true">Hope</span>
    <span className="auth-word auth-word-love" aria-hidden="true">Love</span>
    <span className="auth-word auth-word-faith auth-word-duplicate" aria-hidden="true">Faith</span>
    <span className="auth-word auth-word-hope auth-word-duplicate" aria-hidden="true">Hope</span>
    <span className="auth-word auth-word-love auth-word-duplicate" aria-hidden="true">Love</span>
    <img className="auth-book" src="/auth-cartoon-bible-flat.png" alt="" aria-hidden="true" />
    <img className="auth-book auth-book-secondary" src="/auth-cartoon-bible-flat.png" alt="" aria-hidden="true" />
  </>;
}

export function PasswordChangeRequired({ onChanged }: { onChanged: (user: AuthenticatedUser) => void }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const password = String(values.get("password"));
    const confirmation = String(values.get("confirmation"));
    if (password.length < 12) { setError("Use at least 12 characters."); return; }
    if (password !== confirmation) { setError("The passwords do not match."); return; }
    setError("");
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/change-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
      const result = await response.json() as { user?: AuthenticatedUser; error?: string };
      if (!response.ok || !result.user) throw new Error(result.error ?? "Could not change your password.");
      onChanged(result.user);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not change your password.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return <main className="auth-page"><AuthBackdrop /><section className="auth-card" aria-labelledby="password-change-title"><a className="auth-brand" href="#home" aria-label="Smart-Church home"><img src={smartChurchLogoUrl} alt="" /><span className="auth-brand-name"><span>smart</span>-Church</span></a><div className="auth-icon"><LockKeyhole size={20} /></div><div className="auth-heading"><span className="eyebrow">ACCOUNT SECURITY</span><h1 id="password-change-title">Choose a new password</h1><p>Your administrator reset your password. Set a new one to continue.</p></div>{error && <div className="auth-message auth-message-error" role="alert">{error}</div>}<form className="auth-form" onSubmit={submit}><label>New password<input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" autoFocus /></label><p className="auth-hint">Use at least 12 characters.</p><label>Confirm new password<input name="confirmation" type="password" required minLength={12} maxLength={128} autoComplete="new-password" /></label><button className="button button-primary" type="submit" disabled={isSubmitting}>{isSubmitting ? "Updating…" : "Set new password"}<ArrowRight size={16} /></button></form><p className="auth-footer">Your account is stored on this installation.</p></section></main>;
}

export function Authentication({
  setupRequired,
  setupLocation,
  unavailableMessage,
  onAuthenticated,
}: {
  setupRequired: boolean;
  setupLocation?: string;
  unavailableMessage: string;
  onAuthenticated: (user: AuthenticatedUser) => void;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const payload = setupRequired
      ? {
        setupCode: String(values.get("setupCode")).trim(),
        location: String(values.get("location")).trim(),
        displayName: String(values.get("displayName")).trim(),
        email: String(values.get("email")).trim(),
        username: String(values.get("username")).trim(),
        password: String(values.get("password")),
      }
      : {
        identifier: String(values.get("identifier")).trim(),
        password: String(values.get("password")),
      };

    setError("");
    setIsSubmitting(true);
    try {
      const response = await fetch(setupRequired ? "/api/auth/setup" : "/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as { user?: AuthenticatedUser; error?: string; message?: string };
      if (!response.ok || !result.user) {
        const message = response.status === 400 && result.error === "Bad Request"
          ? authValidationMessage(result.message)
          : result.error ?? result.message ?? "Could not sign in.";
        throw new Error(message);
      }
      onAuthenticated(result.user);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not sign in.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <AuthBackdrop />
      <section className="auth-card" aria-labelledby="auth-title">
        <a className="auth-brand" href="#home" aria-label="Smart-Church home">
          <img src={smartChurchLogoUrl} alt="" />
          <span className="auth-brand-name"><span>smart</span>-Church</span>
        </a>
        <div className="auth-heading">
          <span className="eyebrow">SMART-CHURCH</span>
          <h1 id="auth-title">{setupRequired ? "Set up your workspace" : "Welcome back"}</h1>
          <p>{setupRequired ? "Create the first server administrator account to manage this installation." : "Sign in to continue to your church workspace."}</p>
        </div>

        {unavailableMessage && <div className="auth-message auth-message-error" role="alert">{unavailableMessage}</div>}
        {error && <div className="auth-message auth-message-error" role="alert">{error}</div>}

        <form className="auth-form" onSubmit={submit}>
          {setupRequired && <>
            <label>One-time setup code<input name="setupCode" required autoComplete="one-time-code" minLength={8} maxLength={80} /></label>
            <p className="auth-hint">Find this code in the Core API terminal where the app is running.</p>
            <label>Church location<input name="location" required autoComplete="address-level2" maxLength={120} placeholder="Enter your location" defaultValue={setupLocation ?? ""} /></label>
            <p className="auth-hint">You can change this later in location settings.</p>
            <label>Your name<input name="displayName" required autoComplete="name" maxLength={100} placeholder="Juri Stöckli" /></label>
            <label>Username<input name="username" required autoComplete="username" minLength={3} maxLength={32} pattern={usernamePattern} title={usernameHelp} aria-describedby="username-help" placeholder="juri.stoeckli" /></label>
            <p className="auth-hint" id="username-help">{usernameHelp}</p>
          </>}
          {setupRequired
            ? <label>Email address<input name="email" type="email" required autoComplete="email" maxLength={254} placeholder="you@example.com" /></label>
            : <label>Username or email address<input name="identifier" required autoComplete="username" maxLength={254} placeholder="username or you@example.com" /></label>}
          <label>Password<input name="password" type="password" required autoComplete={setupRequired ? "new-password" : "current-password"} minLength={setupRequired ? 12 : 1} maxLength={128} aria-describedby={setupRequired ? "setup-password-help" : undefined} placeholder={setupRequired ? "At least 12 characters" : "Your password"} /></label>
          {setupRequired && <p className="auth-hint" id="setup-password-help">Use 12–128 characters.</p>}
          <button className="button button-primary auth-submit" type="submit" disabled={isSubmitting || Boolean(unavailableMessage)}>
            {isSubmitting ? "Please wait…" : setupRequired ? "Create server administrator" : "Sign in"}
            {!isSubmitting && <ArrowRight size={17} />}
          </button>
        </form>

        <div className="auth-footnote"><Church size={14} /> Your account is stored on this installation.</div>
      </section>
    </main>
  );
}
