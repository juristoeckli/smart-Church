import { useState, type FormEvent } from "react";

type Classification = {
  personId: string;
  localName: string;
  localStatus: string;
  status: { sourceId: string; name: string; isMember: boolean; proposed: "member" | "visitor" | null } | null;
  tags: Array<{ sourceId: string; name: string }> | null;
  review: string | null;
};

export function PersonClassificationReview({ departmentId, csrfToken, t }: {
  departmentId: string; csrfToken: string; t: (message: string) => string;
}) {
  const [personId, setPersonId] = useState("");
  const [token, setToken] = useState("");
  const [result, setResult] = useState<Classification | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");

  function reset() {
    setResult(null);
    setConfirmed(false);
    setFeedback("");
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>, review?: string) {
    event.preventDefault();
    const loginToken = token.trim();
    reset();
    setBusy(true);
    try {
      const response = await fetch("/api/modules/sync/churchtools/person-classification", {
        method: "POST", headers: { "Content-Type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken },
        body: JSON.stringify({ personId: personId.trim(), loginToken, ...(review ? { review } : {}) }),
      });
      const payload = await response.json() as Classification & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not review the ChurchTools person.");
      if (review) {
        setToken("");
        setFeedback("The People status was updated.");
      } else setResult(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not review the ChurchTools person.");
    } finally { setBusy(false); }
  }

  return <section className="panel stack">
    <h3>{t("ChurchTools People classifications")}</h3>
    <p>{t("Review the status and tags for a person previously linked by the ChurchTools import. Tags stay in ChurchTools.")}</p>
    <form className="stack" onSubmit={(event) => void submit(event)}>
      <fieldset disabled={busy}>
        <label>{t("ChurchTools person ID")}<input required inputMode="numeric" pattern="[1-9][0-9]{0,15}" value={personId} onChange={(event) => {
          setPersonId(event.target.value); reset();
        }} /></label>
        <label>{t("Your personal ChurchTools login token")}<input required type="password" autoComplete="off" maxLength={512} value={token} onChange={(event) => {
          setToken(event.target.value); reset();
        }} /></label>
        <button type="submit">{t("Review person")}</button>
      </fieldset>
    </form>
    {error && <p role="alert">{t(error)}</p>}
    {feedback && <p role="status">{t(feedback)}</p>}
    {result && <>
      <dl>
        <dt>{t("Smart-Church person")}</dt><dd>{result.localName} · {t(result.localStatus)}</dd>
        <dt>{t("ChurchTools status")}</dt>
        <dd>{result.status
          ? <>{result.status.name} (#{result.status.sourceId}) · {t(result.status.isMember ? "Counts as a member" : "Does not count as a member")}</>
          : t("The status was unavailable to this account or had no matching definition.")}</dd>
        <dt>{t("ChurchTools tags")}</dt>
        <dd>{result.tags === null ? t("The tags were unavailable to this account.")
          : result.tags.length ? result.tags.map((tag) => `${tag.name} (#${tag.sourceId})`).join(", ") : t("This person has no tags.")}</dd>
      </dl>
      {result.status && result.status.proposed === null && <p>{t("ChurchTools did not confirm that the person is active and living. The Smart-Church status will stay as it is.")}</p>}
      {result.review && result.status?.proposed && <form className="stack" onSubmit={(event) => {
        event.preventDefault();
        if (confirmed && result.review) void submit(event, result.review);
      }}>
        <label><input type="checkbox" required checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          {t("I reviewed the status mapping and understand that automatic group membership rules may run.")}
        </label>
        <button type="submit" disabled={busy || !confirmed}>
          {t(result.status.proposed === "member" ? "Apply member status" : "Apply visitor status")}
        </button>
      </form>}
    </>}
  </section>;
}
