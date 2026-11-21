import { useState, type FormEvent } from "react";

type Change = "type" | "parent";
type Name = { id: string; name: string };
type Review = {
  sourceName: string;
  localName: string | null;
  type: Name | null;
  category: Name | null;
  categoryKnown: boolean;
  parent: Name | null;
  typeReady: boolean;
  parentReady: boolean;
  review: string | null;
};

export function GroupStructureReview({ departmentId, csrfToken, t }: {
  departmentId: string; csrfToken: string; t: (message: string) => string;
}) {
  const [sourceId, setSourceId] = useState("");
  const [token, setToken] = useState("");
  const [shown, setShown] = useState<Review | null>(null);
  const [selected, setSelected] = useState<Change[]>([]);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);

  function reset() {
    setShown(null);
    setSelected([]);
    setError("");
    setFeedback("");
  }

  async function submit(event: FormEvent<HTMLFormElement>, review?: string) {
    event.preventDefault();
    reset();
    setBusy(true);
    try {
      const response = await fetch("/api/modules/sync/churchtools/group-structure", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken },
        body: JSON.stringify({ groupId: sourceId.trim(), loginToken: token.trim(), ...(review ? { review, fields: selected } : {}) }),
      });
      const result = await response.json() as Review & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not review ChurchTools group structure.");
      if (review) {
        setToken("");
        setFeedback("The selected group fields were imported.");
      } else setShown(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not review ChurchTools group structure.");
    } finally { setBusy(false); }
  }

  const toggle = (field: Change) => setSelected((current) => current.includes(field)
    ? current.filter((value) => value !== field)
    : [...current, field]);

  const title = (value: Name | null, empty: string) => value ? `${value.name} (#${value.id})` : t(empty);

  return <section className="panel stack">
    <h3>{t("ChurchTools group structure")}</h3>
    <p>{t("Review a group and import a missing type or parent when both systems can verify the mapping.")}</p>
    <form className="stack" onSubmit={(event) => void submit(event)}>
      <fieldset disabled={busy}>
        <label>{t("ChurchTools group ID")}<input required inputMode="numeric" pattern="[1-9][0-9]{0,15}" value={sourceId} onChange={(event) => {
          setSourceId(event.target.value); reset();
        }} /></label>
        <label>{t("Your personal ChurchTools login token")}<input required type="password" autoComplete="off" maxLength={512} value={token} onChange={(event) => {
          setToken(event.target.value); reset();
        }} /></label>
        <button type="submit">{t("Review group structure")}</button>
      </fieldset>
    </form>
    {error && <p role="alert">{t(error)}</p>}
    {feedback && <p role="status">{t(feedback)}</p>}
    {shown && <>
      <dl>
        <dt>{t("ChurchTools group")}</dt><dd>{shown.sourceName}</dd>
        <dt>{t("Smart-Church group")}</dt><dd>{shown.localName ?? t("No verified local mapping")}</dd>
        <dt>{t("Source type")}</dt><dd>{title(shown.type, "Unavailable")}</dd>
        <dt>{t("Source category")}</dt><dd>{title(shown.category, shown.categoryKnown ? "No category" : "Unavailable")}</dd>
        <dt>{t("Source parent")}</dt><dd>{title(shown.parent, "No single public parent was verified")}</dd>
      </dl>
      {!shown.review && <p>{t("No group fields are eligible for import.")}</p>}
      {shown.review && <form className="stack" onSubmit={(event) => {
        if (shown.review && selected.length) void submit(event, shown.review);
        else event.preventDefault();
      }}>
        {shown.typeReady && <label><input type="checkbox" checked={selected.includes("type")} onChange={() => toggle("type")} />
          {t("Fill the missing Smart-Church group type")}
        </label>}
        {shown.parentReady && <label><input type="checkbox" checked={selected.includes("parent")} onChange={() => toggle("parent")} />
          {t("Set the missing parent. The subgroup can then appear on parent-group check-in rosters.")}
        </label>}
        <button type="submit" disabled={busy || !selected.length}>{t("Import selected group fields")}</button>
      </form>}
    </>}
  </section>;
}
