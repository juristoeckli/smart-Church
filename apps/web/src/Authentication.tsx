import { useState, type FormEvent } from "react";
import { ArrowRight, Church, LockKeyhole } from "lucide-react";
import type { AuthenticatedUser } from "@smart-church/contracts";

const defaultLogoUrl = "/gfc-logo.svg";

export function Authentication({
  setupRequired,
  unavailableMessage,
  onAuthenticated,
}: {
  setupRequired: boolean;
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
      const result = await response.json() as { user?: AuthenticatedUser; error?: string };
      if (!response.ok || !result.user) throw new Error(result.error ?? "Could not sign in.");
      onAuthenticated(result.user);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not sign in.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="auth-title">
        <a className="auth-brand" href="#home" aria-label="GfC">
          <img src={defaultLogoUrl} alt="GfC" onError={(event) => { event.currentTarget.style.display = "none"; }} />
          <span>GfC</span>
        </a>
        <div className="auth-icon"><LockKeyhole size={20} /></div>
        <div className="auth-heading">
          <span className="eyebrow">GFC WORKSPACE</span>
          <h1 id="auth-title">{setupRequired ? "Set up your workspace" : "Welcome back"}</h1>
          <p>{setupRequired ? "Create the first server administrator account to manage this installation." : "Sign in to continue to your church workspace."}</p>
        </div>

        {unavailableMessage && <div className="auth-message auth-message-error" role="alert">{unavailableMessage}</div>}
        {error && <div className="auth-message auth-message-error" role="alert">{error}</div>}

        <form className="auth-form" onSubmit={submit}>
          {setupRequired && <>
            <label>One-time setup code<input name="setupCode" required autoComplete="one-time-code" minLength={8} maxLength={80} /></label>
            <p className="auth-hint">Find this code in the Core API terminal where the app is running.</p>
            <label>Church location<input name="location" required autoComplete="address-level2" maxLength={120} placeholder="Enter your location" /></label>
            <p className="auth-hint">You can change this later in location settings.</p>
            <label>Your name<input name="displayName" required autoComplete="name" maxLength={100} placeholder="Juri Stöckli" /></label>
            <label>Username<input name="username" required autoComplete="username" minLength={3} maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,31}" placeholder="juri.stoeckli" /></label>
          </>}
          {setupRequired
            ? <label>Email address<input name="email" type="email" required autoComplete="email" maxLength={254} placeholder="you@example.com" /></label>
            : <label>Username or email address<input name="identifier" required autoComplete="username" maxLength={254} placeholder="username or you@example.com" /></label>}
          <label>Password<input name="password" type="password" required autoComplete={setupRequired ? "new-password" : "current-password"} minLength={setupRequired ? 6 : 1} maxLength={128} placeholder={setupRequired ? "At least 6 characters" : "Your password"} /></label>
          <button className="button button-primary auth-submit" type="submit" disabled={isSubmitting || Boolean(unavailableMessage)}>
            {isSubmitting ? "Please wait…" : setupRequired ? "Create server administrator" : "Sign in"}
            {!isSubmitting && <ArrowRight size={17} />}
          </button>
        </form>

        <div className="auth-footnote"><Church size={14} /> Your account is stored on this installation.</div>
      </section>
      <div className="auth-background-mark" aria-hidden="true">GfC</div>
    </main>
  );
}
