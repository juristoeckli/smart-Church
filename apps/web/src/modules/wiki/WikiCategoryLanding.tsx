import { useEffect, useState } from "react";
import { BookOpenText, Copy, FileText } from "lucide-react";

type Category = { id: string; name: string; position: number };
type Page = { id: string; title: string };

export function WikiCategoryLanding({ departmentId, category, categoriesLoaded, revision, children, onOpenCategory, onOpenPage, onCopy }: {
  departmentId: string; category?: Category; categoriesLoaded: boolean; revision: number; children: Category[];
  onOpenCategory: (id: string) => void; onOpenPage: (id: string) => void; onCopy: () => void;
}) {
  const [pages, setPages] = useState<Page[]>();
  const [error, setError] = useState("");
  const categoryId = category?.id;
  useEffect(() => {
    if (!categoryId) return;
    const controller = new AbortController();
    void fetch("/api/modules/wiki/pages?" + new URLSearchParams({ categoryId, status: "active" }), {
      headers: { "x-department-id": departmentId }, signal: controller.signal, cache: "no-store",
    }).then(async (response) => {
      if (!response.ok) throw new Error();
      const result = await response.json() as Page[];
      if (!controller.signal.aborted) setPages(result);
    }).catch(() => {
      if (!controller.signal.aborted) setError("Could not load the pages in this category.");
    });
    return () => controller.abort();
  }, [categoryId, departmentId, revision]);

  if (!categoriesLoaded) return <p role="status">Loading Wiki category…</p>;
  if (!category) return <p role="alert">This Wiki category is unavailable.</p>;
  return <section aria-label="Wiki category">
    <header className="wiki-editor-header">
      <div><span className="wiki-muted">WIKI CATEGORY</span><h1>{category.name}</h1></div>
      <button className="button button-secondary" type="button" onClick={onCopy}><Copy size={15} /> Copy category link</button>
    </header>
    {children.length > 0 && <nav aria-label="Subcategories" className="wiki-page-list">
      {[...children].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)).map((child) =>
        <button className="wiki-page-item" key={child.id} type="button" onClick={() => onOpenCategory(child.id)}>
          <BookOpenText size={15} /> {child.name}
        </button>)}
    </nav>}
    {error && <p role="alert">{error}</p>}
    {!error && !pages && <p role="status">Loading pages…</p>}
    {pages && (pages.length ? <nav aria-label="Pages in this category" className="wiki-page-list">
      {pages.map((page) => <button className="wiki-page-item" key={page.id} type="button" onClick={() => onOpenPage(page.id)}>
        <FileText size={15} /> {page.title}
      </button>)}
    </nav> : <p className="wiki-muted">No readable pages are published in this category.</p>)}
  </section>;
}
