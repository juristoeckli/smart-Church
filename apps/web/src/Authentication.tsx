import { useState, type FormEvent } from "react";
import { ArrowRight, Church, LockKeyhole } from "lucide-react";
import type { AuthenticatedUser } from "@smart-church/contracts";
import { AuthLanguageSelect, useAuthLanguage } from "./auth-language";

const smartChurchLogoUrl = "/smart-church-mark.svg";
const usernamePattern = "[A-Za-z0-9][A-Za-z0-9._-]{2,31}";
function authValidationMessage(message: string | undefined, t: ReturnType<typeof useAuthLanguage>["t"]) {
  const detail = message?.toLowerCase() ?? "";
  if (detail.includes("username")) return t("invalidUsername");
  if (detail.includes("email")) return t("invalidEmail");
  if (detail.includes("password")) return t("invalidPassword");
  if (detail.includes("setupcode")) return t("invalidSetupCode");
  if (detail.includes("location")) return t("invalidLocation");
  if (detail.includes("displayname")) return t("invalidName");
  return t("invalidGeneric");
}

function authApiMessage(message: string | undefined, t: ReturnType<typeof useAuthLanguage>["t"]) {
  const detail = message?.toLowerCase() ?? "";
  if (detail.includes("username, email, or password") || detail.includes("username, email") || detail.includes("credentials")) return t("invalidCredentials");
  if (detail.includes("too many sign-in attempts")) return t("tooManyAttempts");
  if (detail.includes("one-time setup code")) return t("setupInvalid");
  if (detail.includes("account database is unavailable")) return t("accountUnavailable");
  return t("signInError");
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
  const { language, selectLanguage, t } = useAuthLanguage();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const password = String(values.get("password"));
    const confirmation = String(values.get("confirmation"));
    if (password.length < 12) { setError(t("passwordMin")); return; }
    if (password !== confirmation) { setError(t("passwordMismatch")); return; }
    setError("");
    setIsSubmitting(true);
    let localizedFailure: string | undefined;
    try {
      const response = await fetch("/api/auth/change-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
      const result = await response.json() as { user?: AuthenticatedUser; error?: string };
      if (!response.ok || !result.user) {
        localizedFailure = result.error?.toLowerCase().includes("account database is unavailable")
          ? t("accountUnavailable")
          : t("signInError");
        throw new Error(localizedFailure);
      }
      onChanged(result.user);
    } catch {
      setError(localizedFailure ?? t("signInError"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return <main className="auth-page"><AuthBackdrop /><section className="auth-card" aria-labelledby="password-change-title"><div className="auth-language-row"><AuthLanguageSelect language={language} onChange={selectLanguage} label={t("language")} /></div><a className="auth-brand" href="#home" aria-label={t("brandHome")}><img src={smartChurchLogoUrl} alt="" /><span className="auth-brand-name"><span>smart</span>-Church</span></a><div className="auth-icon"><LockKeyhole size={20} /></div><div className="auth-heading"><span className="eyebrow">{t("accountSecurity")}</span><h1 id="password-change-title">{t("choosePassword")}</h1><p>{t("choosePasswordHelp")}</p></div>{error && <div className="auth-message auth-message-error" role="alert">{error}</div>}<form className="auth-form" onSubmit={submit}><label>{t("newPassword")}<input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" autoFocus /></label><p className="auth-hint">{t("passwordMin")}</p><label>{t("confirmPassword")}<input name="confirmation" type="password" required minLength={12} maxLength={128} autoComplete="new-password" /></label><button className="button button-primary" type="submit" disabled={isSubmitting}>{isSubmitting ? t("updating") : t("setPassword")}<ArrowRight size={16} /></button></form><p className="auth-footer">{t("accountStored")}</p></section></main>;
}

export function Authentication({
  setupRequired,
  setupLocation,
  selfSignupEnabled,
  selfSignupSites = [],
  unavailableMessage,
  onAuthenticated,
}: {
  setupRequired: boolean;
  setupLocation?: string;
  selfSignupEnabled?: boolean;
  selfSignupSites?: Array<{ id: string; name: string }>;
  unavailableMessage: string;
  onAuthenticated: (user: AuthenticatedUser) => void;
}) {
  const { language, selectLanguage, t } = useAuthLanguage();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [showSignup, setShowSignup] = useState(false);
  const [signupFeedback, setSignupFeedback] = useState("");

  async function requestSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("signupEmail")).trim();
    const departmentId = String(form.get("signupSite") ?? "");
    setIsSubmitting(true); setError(""); setSignupFeedback("");
    try {
      const response = await fetch("/api/public/self-signup/request", { method: "POST", headers: { "content-type": "application/json", "x-department-id": departmentId }, body: JSON.stringify({ email, language, departmentId }) });
      const result = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(t("signupError"));
      setSignupFeedback(t("signupFallback"));
    } catch { setError(t("signupError")); }
    finally { setIsSubmitting(false); }
  }

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
    let localizedFailure: string | undefined;
    try {
      const response = await fetch(setupRequired ? "/api/auth/setup" : "/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as { user?: AuthenticatedUser; error?: string; message?: string };
      if (!response.ok || !result.user) {
        const message = response.status === 400 && result.error === "Bad Request"
          ? authValidationMessage(result.message, t)
          : authApiMessage(result.error ?? result.message, t);
        localizedFailure = message;
        throw new Error(message);
      }
      onAuthenticated(result.user);
    } catch {
      setError(localizedFailure ?? t("signInError"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <AuthBackdrop />
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-language-row"><AuthLanguageSelect language={language} onChange={selectLanguage} label={t("language")} /></div>
        <a className="auth-brand" href="#home" aria-label={t("brandHome")}>
          <img src={smartChurchLogoUrl} alt="" />
          <span className="auth-brand-name"><span>smart</span>-Church</span>
        </a>
        <div className="auth-heading">
          <span className="eyebrow">{t("smartChurch")}</span>
          <h1 id="auth-title">{setupRequired ? t("setupTitle") : showSignup ? t("signupTitle") : t("welcome")}</h1>
          <p>{setupRequired ? t("setupHelp") : showSignup ? t("signupHelp") : t("loginHelp")}</p>
        </div>

        {(unavailableMessage || !setupRequired && showSignup && selfSignupEnabled === false) && <div className="auth-message auth-message-error" role="alert">{t("unavailable")}</div>}
        {error && <div className="auth-message auth-message-error" role="alert">{error}</div>}

        {showSignup ? <form className="auth-form" onSubmit={(event) => void requestSignup(event)}>
          <label>{t("site")}<select name="signupSite" required defaultValue=""><option value="" disabled>{t("chooseSite")}</option>{selfSignupSites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
          <label>{t("email")}<input name="signupEmail" type="email" required autoComplete="email" maxLength={254} placeholder="you@example.com" autoFocus /></label>
          {signupFeedback && <p className="auth-hint" role="status">{signupFeedback}</p>}
          <button className="button button-primary auth-submit" type="submit" disabled={isSubmitting || Boolean(unavailableMessage) || selfSignupEnabled === false}>{isSubmitting ? t("sending") : t("sendSignupLink")}<ArrowRight size={16} /></button>
          <button className="auth-link-button" type="button" onClick={() => { setShowSignup(false); setError(""); }}>{t("backToSignIn")}</button>
        </form> : <form className="auth-form" onSubmit={submit}>
          {setupRequired && <>
            <label>{t("oneTimeCode")}<input name="setupCode" required autoComplete="one-time-code" minLength={8} maxLength={80} /></label>
            <p className="auth-hint">{t("setupCodeHelp")}</p>
            <label>{t("churchLocation")}<input name="location" required autoComplete="address-level2" maxLength={120} placeholder={t("enterLocation")} defaultValue={setupLocation ?? ""} /></label>
            <p className="auth-hint">{t("locationHelp")}</p>
            <label>{t("yourName")}<input name="displayName" required autoComplete="name" maxLength={100} placeholder="Juri Stöckli" /></label>
            <label>{t("username")}<input name="username" required autoComplete="username" minLength={3} maxLength={32} pattern={usernamePattern} title={`${t("usernameHelp")} ${t("usernameEmailHelp")}`} aria-describedby="username-help" placeholder="juri.stoeckli" /></label>
            <p className="auth-hint" id="username-help">{t("usernameHelp")} {t("usernameEmailHelp")}</p>
          </>}
          {setupRequired
            ? <label>{t("email")}<input name="email" type="email" required autoComplete="email" maxLength={254} placeholder="you@example.com" /></label>
            : <label>{t("usernameOrEmail")}<input name="identifier" required autoComplete="username" maxLength={254} placeholder={t("identifierPlaceholder")} /></label>}
          <label>{t("password")}<input name="password" type="password" required autoComplete={setupRequired ? "new-password" : "current-password"} minLength={setupRequired ? 12 : 1} maxLength={128} aria-describedby={setupRequired ? "setup-password-help" : undefined} placeholder={setupRequired ? t("passwordPlaceholder") : t("currentPasswordPlaceholder")} /></label>
          {setupRequired && <p className="auth-hint" id="setup-password-help">{t("use12Chars")}</p>}
          <button className="button button-primary auth-submit" type="submit" disabled={isSubmitting || Boolean(unavailableMessage)}>
            {isSubmitting ? t("pleaseWait") : setupRequired ? t("createAdmin") : t("signIn")}
            {!isSubmitting && <ArrowRight size={17} />}
          </button>
        </form>}

        {!setupRequired && selfSignupEnabled && !showSignup && <button className="auth-link-button" type="button" onClick={() => { setShowSignup(true); setError(""); }}>{t("createAccount")}</button>}

        <div className="auth-footnote"><Church size={14} /> {t("accountStored")}</div>
      </section>
    </main>
  );
}
