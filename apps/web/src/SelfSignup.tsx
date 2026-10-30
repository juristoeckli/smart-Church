import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, Church } from "lucide-react";
import { AuthLanguageSelect, useAuthLanguage } from "./auth-language";

const logoUrl = "/smart-church-mark.svg";

export function SelfSignupPage({ confirmation }: { confirmation: boolean }) {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const queryDepartmentId = new URLSearchParams(window.location.search).get("departmentId") ?? "";
  const { language, selectLanguage, t } = useAuthLanguage();
  const [email, setEmail] = useState("");
  const [departmentId, setDepartmentId] = useState(queryDepartmentId);
  const [loading, setLoading] = useState(!confirmation);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (confirmation) return;
    if (!token) { setError(t("invalidLink")); setLoading(false); return; }
    let active = true;
    void fetch(`/api/public/self-signup/form/${encodeURIComponent(token)}`, { cache: "no-store" }).then(async (response) => {
      const result = await response.json() as { email?: string; departmentId?: string; language?: "en" | "de" | "fr" | "it"; error?: string };
      if (!response.ok || !result.email) throw new Error(t("expiredLink"));
      if (active) setEmail(result.email);
      if (active && result.departmentId) setDepartmentId(result.departmentId);
      if (active && result.language) selectLanguage(result.language);
    }).catch(() => { if (active) setError(t("expiredLink")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [confirmation, token]);

  async function submitProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/public/self-signup/profile", {
        method: "POST", headers: { "content-type": "application/json", "x-department-id": departmentId },
        body: JSON.stringify({ token, language, firstName: String(values.get("firstName")).trim(), lastName: String(values.get("lastName")).trim(), phone: String(values.get("phone")).trim(), street: String(values.get("street")).trim(), streetNumber: String(values.get("streetNumber")).trim(), postalCode: String(values.get("postalCode")).trim(), city: String(values.get("city")).trim() }),
      });
      const result = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(t("submitDetailsError"));
      setMessage(result.message ?? t("detailsSaved"));
    } catch { setError(t("submitDetailsError")); }
    finally { setSaving(false); }
  }

  async function confirmEmail() {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/public/self-signup/confirm", { method: "POST", headers: { "content-type": "application/json", "x-department-id": departmentId }, body: JSON.stringify({ token }) });
      const result = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(t("confirmError"));
      setMessage(result.message ?? t("confirmSuccess"));
    } catch { setError(t("confirmError")); }
    finally { setSaving(false); }
  }

  return <main className="auth-page"><section className="auth-card" aria-labelledby="self-signup-title">
    <div className="auth-language-row"><AuthLanguageSelect language={language} onChange={selectLanguage} label={t("language")} /></div>
    <a className="auth-brand" href="/" aria-label={t("brandHome")}><img src={logoUrl} alt="" /><span className="auth-brand-name"><span>smart</span>-Church</span></a>
    <div className="auth-heading"><span className="eyebrow">{t("signupEyebrow")}</span><h1 id="self-signup-title">{confirmation ? t("confirmEmail") : t("signupTitle")}</h1><p>{confirmation ? t("confirmEmailHelp") : t("profileHelp")}</p></div>
    {error && <div className="auth-message auth-message-error" role="alert">{error}</div>}
    {message ? <><div className="auth-message" role="status">{message}</div><a className="button button-secondary auth-submit" href="/">{t("returnToSignIn")}</a></>
      : confirmation ? <button className="button button-primary auth-submit" type="button" onClick={() => void confirmEmail()} disabled={saving || !token}>{saving ? t("confirming") : t("confirmAddress")}<ArrowRight size={16} /></button>
        : loading ? <p className="auth-hint" role="status">{t("checkingLink")}</p>
          : email && <form className="auth-form" onSubmit={(event) => void submitProfile(event)}>
            <label>{t("email")}<input type="email" value={email} readOnly aria-readonly="true" /></label>
            <div className="self-signup-name-fields"><label>{t("firstName")}<input name="firstName" required maxLength={80} autoComplete="given-name" autoFocus /></label><label>{t("lastName")}<input name="lastName" required maxLength={80} autoComplete="family-name" /></label></div>
            <label>{t("phone")}<input name="phone" maxLength={32} autoComplete="tel" /></label>
            <label>{t("street")}<input name="street" maxLength={160} autoComplete="address-line1" /></label>
            <div className="self-signup-name-fields"><label>{t("streetNumber")}<input name="streetNumber" maxLength={24} autoComplete="address-line2" /></label><label>{t("postalCode")}<input name="postalCode" maxLength={20} autoComplete="postal-code" /></label></div>
            <label>{t("city")}<input name="city" maxLength={100} autoComplete="address-level2" /></label>
            <button className="button button-primary auth-submit" type="submit" disabled={saving}>{saving ? t("submitting") : t("submitReview")}<ArrowRight size={16} /></button>
          </form>}
    <div className="auth-footnote"><Church size={14} /> {t("verifiedFootnote")}</div>
  </section></main>;
}
