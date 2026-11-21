import { useState, type FormEvent } from "react";

type Category = { id: string; name: string };
type Page = { guid: string; title: string; revision: string };
type Review = Page & {
  category: Category;
  text: string;
  target: { action: string; name: string | null };
  review: string | null;
};

const actionMessages: Record<string, string> = {
  existing: "A copy of this source revision already exists.",
  saved_page_changed: "A previous copy is linked to this page. Its native content stays as it is.",
  category_archived: "The mapped Wiki category is archived or unavailable.",
  page_title_conflict: "The Wiki category already contains a page with this title.",
  category_name_conflict: "A local category with the same name already exists.",
};

export function WikiCopyReview({ departmentId, csrfToken, t }: {
  departmentId: string; csrfToken: string; t: (message: string) => string;
}) {
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [categoryId, setCategoryId] = useState("");
  const [pages, setPages] = useState<Page[] | null>(null);
  const [pageGuid, setPageGuid] = useState("");
  const [shown, setShown] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");

  async function load(stage: "categories" | "pages" | "preview" | "apply") {
    const review = shown?.review;
    setShown(null);
    setError("");
    setFeedback("");
    setBusy(true);
    try {
      const body = stage === "categories" ? {} : stage === "pages" ? { categoryId }
        : { categoryId, pageGuid, ...(stage === "apply" && review ? { review } : {}) };
      const response = await fetch("/api/modules/sync/churchtools/wiki-copy", {
        method: "POST", headers: { "Content-Type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken },
        body: JSON.stringify(body),
      });
      const result = await response.json() as Review & { categories?: Category[]; pages?: Page[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not review the ChurchTools Wiki.");
      if (stage === "categories") {
        setCategories(result.categories ?? []);
        setCategoryId("");
        setPages(null);
        setPageGuid("");
      } else if (stage === "pages") {
        setPages(result.pages ?? []);
        setPageGuid("");
      } else if (stage === "apply") {
        setFeedback("The page was copied to Wiki for managers.");
      } else setShown(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not review the ChurchTools Wiki.");
    } finally { setBusy(false); }
  }

  function reviewPage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pageGuid) void load("preview");
  }

  return <section className="panel stack">
    <h3>{t("Copy ChurchTools Wiki pages")}</h3>
    <p>{t("Copy guest-readable, reference-free Markdown as text into a managers-only Wiki page.")}</p>
    <button type="button" disabled={busy} onClick={() => void load("categories")}>{t("Find guest-readable categories")}</button>
    {categories && (categories.length ? <>
      <label>{t("ChurchTools Wiki category")}<select value={categoryId} disabled={busy} onChange={(event) => {
        setCategoryId(event.target.value); setPages(null); setPageGuid(""); setShown(null); setFeedback(""); setError("");
      }}>
        <option value="">{t("Choose a category")}</option>
        {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
      </select></label>
      <button type="button" disabled={busy || !categoryId} onClick={() => void load("pages")}>{t("Find pages in this category")}</button>
    </> : <p>{t("ChurchTools returned no guest-readable Wiki categories.")}</p>)}
    {pages && (pages.length ? <form className="stack" onSubmit={reviewPage}>
      <label>{t("ChurchTools Wiki page")}<select value={pageGuid} disabled={busy} onChange={(event) => {
        setPageGuid(event.target.value); setShown(null); setFeedback(""); setError("");
      }}>
        <option value="">{t("Choose a page")}</option>
        {pages.map((page) => <option key={page.guid} value={page.guid}>{page.title}</option>)}
      </select></label>
      <button type="submit" disabled={busy || !pageGuid}>{t("Review Wiki page")}</button>
    </form> : <p>{t("This category has no guest-readable Markdown pages to review.")}</p>)}
    {error && <p role="alert">{t(error)}</p>}
    {feedback && <p role="status">{t(feedback)}</p>}
    {shown && <div className="stack">
      <h4>{shown.title}</h4>
      <p>{t("Source revision")} {shown.revision} · {t("Destination category")} {shown.target.name ?? shown.category.name}</p>
      <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: "16rem", overflow: "auto" }}>{shown.text}</pre>
      {shown.review
        ? <button type="button" disabled={busy} onClick={() => void load("apply")}>{t("Copy page for Wiki managers")}</button>
        : <p>{t(actionMessages[shown.target.action] ?? "This page cannot be copied.")}</p>}
    </div>}
  </section>;
}
