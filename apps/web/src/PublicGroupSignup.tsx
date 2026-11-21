import { useEffect, useState, type FormEvent } from "react";
import { Check, ContactRound } from "lucide-react";
import type { SignupQuestion } from "./GroupSignupFormEditor";
import { publicErrorText, publicLanguage, publicText } from "./public-translations";

type PublicGroup = { name: string; description: string; revision?: string | null; questions?: SignupQuestion[]; heading?: string; signupState?: "scheduled" | "open" | "closed"; opensAt?: string | null; timeZone?: string };

export function PublicGroupSignup({ token }: { token: string }) {
  const language = publicLanguage();
  const [group, setGroup] = useState<PublicGroup | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [reload, setReload] = useState(0);
  const [formChanged, setFormChanged] = useState(false);

  useEffect(() => {
    document.documentElement.lang = language;
    let active = true;
    setLoading(true);
    setError("");
    setFormChanged(false);
    fetch(`/api/public/group-signups/${encodeURIComponent(token)}`)
      .then(async (response) => {
        const result = await response.json() as PublicGroup | { error?: string };
        if (!response.ok || !("name" in result)) throw new Error(publicErrorText(language, "error" in result ? result.error ?? "This group link is unavailable." : "This group link is unavailable."));
        if (active) setGroup(result);
      })
      .catch((reason) => { if (active) { setGroup(null); setError(publicErrorText(language, reason instanceof Error ? reason.message : "Could not load this group.")); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token, language, reload]);

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (!group || loading || sending || formChanged) return;
    setSending(true); setError("");
    const values = new FormData(formEvent.currentTarget);
    const answers = Object.fromEntries((group.questions ?? []).map(({ id }) => [id, String(values.get("question-" + id) ?? "").trim()]));
    try {
      const response = await fetch(`/api/public/group-signups/${encodeURIComponent(token)}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ firstName: String(values.get("firstName")).trim(), lastName: String(values.get("lastName")).trim(), email: String(values.get("email")).trim(), ...(group.revision ? { formRevision: group.revision, answers } : {}) }),
      });
      const result = await response.json() as { status?: string; error?: string; code?: string };
      if (result.code === "group_signup_window_closed") setReload((value) => value + 1);
      if (response.status === 409 && result.error === "The signup questions changed. Reload the form before submitting.") setFormChanged(true);
      if (!response.ok || result.status !== "pending") throw new Error(publicErrorText(language, result.error ?? "Could not send your request."));
      setSubmitted(true);
    } catch (reason) { setError(publicErrorText(language, reason instanceof Error ? reason.message : "Could not send your request.")); }
    finally { setSending(false); }
  }

  return <main className="public-registration-page"><section className="public-registration-card">
    <span className="eyebrow">{publicText(language, "groupEyebrow")}</span>
    {loading && !group ? <p className="public-registration-message">{publicText(language, "groupLoading")}</p> : !group ? <><h1>{publicText(language, "groupUnavailable")}</h1><p className="public-registration-message">{error}</p></> : <>
      <span className="public-registration-group-icon"><ContactRound size={22} /></span>
      <h1>{group.heading || group.name}</h1>
      {group.heading && <p>{group.name}</p>}
      {group.description && <p className="public-registration-description">{group.description}</p>}
      {submitted ? <div className="public-registration-success"><span className="public-registration-check"><Check size={20} /></span><div><h2>{publicText(language, "groupRequestSent")}</h2><p>{publicText(language, "groupRequestHelp")}</p></div></div> : group.signupState === "closed" || group.signupState === "scheduled" ? <div className="public-registration-message">
        <p>{publicText(language, group.signupState === "scheduled" ? "groupSignupScheduled" : "groupSignupClosed")}</p>
        {group.signupState === "scheduled" && group.opensAt && <p><time dateTime={group.opensAt}>
          {new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short", timeZone: group.timeZone }).format(new Date(group.opensAt))}
        </time>{group.timeZone ? " · " + group.timeZone : ""}</p>}
      </div> : <form className="public-registration-form" onSubmit={(event) => void submit(event)}>
        <p>{publicText(language, "groupRequestIntro")}</p>
        <div className="form-row"><label>{publicText(language, "firstName")}<input name="firstName" autoComplete="given-name" maxLength={80} required /></label><label>{publicText(language, "lastName")}<input name="lastName" autoComplete="family-name" maxLength={80} required /></label></div>
        <label>{publicText(language, "email")}<input type="email" name="email" autoComplete="email" maxLength={254} required /></label>
        {(group.questions ?? []).map((question) => <label key={question.id}>{question.label}
          {question.type === "choice" ? <select name={"question-" + question.id} required={question.required} defaultValue="">
            <option value="">—</option>{(question.options ?? []).map((value) => <option key={value} value={value}>{value}</option>)}
          </select> : <input name={"question-" + question.id} required={question.required} maxLength={160} />}
        </label>)}
        <p className="public-registration-privacy">{publicText(language, group.questions?.length ? "groupPrivacyWithAnswers" : "groupPrivacy")}</p>
        {error && <p className="public-registration-error" role="alert">{error}</p>}
        {formChanged && <button className="button button-secondary" type="button" onClick={() => setReload((value) => value + 1)}>Reload signup form</button>}
        <button className="button button-primary" type="submit" disabled={loading || sending || formChanged}>{sending ? publicText(language, "sending") : publicText(language, "requestToJoin")}</button>
      </form>}
    </>}
    <footer>{publicText(language, "smartChurch")}</footer>
  </section></main>;
}
