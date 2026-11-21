import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { Archive, ArrowDownToLine, BookOpenText, FilePlus2, FileText, History, ImagePlus, Link2, Pencil, Plus, Printer, RotateCcw, Save, Search, Trash2, X } from "lucide-react";
import type { ModuleContext } from "../../module-registry";

type Category = { id: string; name: string; parentId: string | null; position: number; archivedAt: string | null };
type WikiAudience = "location" | "group" | "managers";
type GroupOption = { id: string; name: string };
type WikiFile = { id: string; title: string; fileName: string; contentType: string; fileSize: number; createdAt: string };
type WikiLink = { id: string; title: string; url: string; created_at?: string };
type WikiPage = { id: string; categoryId: string; title: string; contentHtml: string; status: "active" | "archived"; redirectPageId: string | null; isHomepage: boolean; audience: WikiAudience; audienceGroupId: string | null; createdAt: string; updatedAt: string; updatedBy: string | null; editorName?: string | null; links?: WikiLink[]; files?: WikiFile[] };
type PageVersion = { id: string; title: string; contentHtml: string; createdAt: string; editorId: string | null; editorName: string | null };
type VersionComparison = { left: PageVersion; right: PageVersion };
type EntityType = "person" | "group" | "wiki" | "song";
type WikiEntityMatch = { id: string; title: string; detail?: string };
const entityTypes: EntityType[] = ["person", "group", "wiki", "song"];

function categoryTree(categories: Category[], parentId: string | null = null, depth = 0): Array<{ category: Category; depth: number }> {
  return categories.filter((category) => category.parentId === parentId).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)).flatMap((category) => [{ category, depth }, ...categoryTree(categories, category.id, depth + 1)]);
}
function humanDate(value: string) { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function sizeLabel(bytes: number) { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }

export function WikiModule({ department, departmentId, csrfToken, canManageSite, realtime, state, onNavigateEntity }: ModuleContext) {
  const editor = useRef<HTMLDivElement>(null);
  const editorRange = useRef<Range | null>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [pages, setPages] = useState<WikiPage[]>([]);
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [selectedPage, setSelectedPage] = useState<WikiPage | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"active" | "archived">("active");
  const [categoryStatus, setCategoryStatus] = useState<"active" | "archived">("active");
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftCategory, setDraftCategory] = useState("");
  const [draftAudience, setDraftAudience] = useState<WikiAudience>("location");
  const [draftAudienceGroupId, setDraftAudienceGroupId] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [categoryDraft, setCategoryDraft] = useState("");
  const [audienceDraft, setAudienceDraft] = useState<WikiAudience>("location");
  const [audienceGroupIdDraft, setAudienceGroupIdDraft] = useState("");
  const [links, setLinks] = useState<WikiLink[]>([]);
  const [attachedFiles, setAttachedFiles] = useState<WikiFile[]>([]);
  const [versions, setVersions] = useState<PageVersion[]>([]);
  const [previewVersion, setPreviewVersion] = useState<PageVersion | null>(null);
  const [comparison, setComparison] = useState<VersionComparison | null>(null);
  const [compareLeftId, setCompareLeftId] = useState("");
  const [compareRightId, setCompareRightId] = useState("");
  const [availableFiles, setAvailableFiles] = useState<WikiFile[]>([]);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showAttachments, setShowAttachments] = useState(false);
  const [showInlineImages, setShowInlineImages] = useState(false);
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [categoryParentId, setCategoryParentId] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [redirectDraft, setRedirectDraft] = useState("");
  const [showEntityLink, setShowEntityLink] = useState(false);
  const [entityType, setEntityType] = useState<EntityType>("person");
  const [entityId, setEntityId] = useState("");
  const [entityLabel, setEntityLabel] = useState("");
  const [wikiPageQuery, setWikiPageQuery] = useState("");
  const [wikiPageMatches, setWikiPageMatches] = useState<WikiEntityMatch[]>([]);
  const [wikiPageSearchBusy, setWikiPageSearchBusy] = useState(false);

  const canManage = canManageSite || (department.modulePermissions?.wiki ?? []).includes("manage");
  const canUpload = canManageSite || (department.modulePermissions?.["file-storage"] ?? []).includes("manage");
  const canSearchPeople = department.role === "site_admin" || (department.permissions ?? []).some((permission) => permission === "people_view_private" || permission === "people_manage");
  const flatCategories = useMemo(() => categoryTree(categories), [categories]);
  const visiblePages = useMemo(() => pages.filter((page) => !selectedCategoryId || page.categoryId === selectedCategoryId), [pages, selectedCategoryId]);
  const inlineImageFiles = attachedFiles.filter((file) => file.contentType === "image/jpeg" && file.fileSize >= 1 && file.fileSize <= 2_000_000);

  async function api<T>(path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const response = await fetch(path, { method, headers: { "x-department-id": departmentId, ...(method !== "GET" ? { "x-csrf-token": csrfToken } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), cache: "no-store" });
    const result = await response.json().catch(() => null) as T | { error?: string } | null;
    if (!response.ok) throw new Error(result && typeof result === "object" && "error" in result ? result.error ?? "The request could not be completed." : "The request could not be completed.");
    return result as T;
  }

  async function refresh(keepPageId = selectedPage?.id, nextStatus: "active" | "archived" = status) {
    setError("");
    try {
      const [nextCategories, nextPages] = await Promise.all([
        api<Category[]>(`/api/modules/wiki/categories?status=${categoryStatus}`),
        api<WikiPage[]>(`/api/modules/wiki/pages?status=${nextStatus}${search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ""}`),
      ]);
      if (canManage) setGroups(await api<GroupOption[]>("/api/modules/wiki/groups"));
      setCategories(nextCategories); setPages(nextPages);
      const nextId = nextPages.some((page) => page.id === keepPageId) ? keepPageId : nextPages.find((page) => page.isHomepage)?.id ?? nextPages[0]?.id;
      if (nextId) await openPage(nextId); else { setSelectedPage(null); setLinks([]); setAttachedFiles([]); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load Wiki pages."); }
  }

  async function openPage(id: string, visited = new Set<string>()) {
    if (visited.has(id)) { setError("This Wiki redirect leads to a loop."); return; }
    visited.add(id);
    try {
      const detail = await api<WikiPage>(`/api/modules/wiki/pages/${id}`);
      if (!canManage && detail.redirectPageId) { await openPage(detail.redirectPageId, visited); return; }
      setComparison(null);
      setSelectedPage(detail); setTitleDraft(detail.title); setCategoryDraft(detail.categoryId); setRedirectDraft(detail.redirectPageId ?? ""); setAudienceDraft(detail.audience ?? "location"); setAudienceGroupIdDraft(detail.audienceGroupId ?? ""); setLinks(detail.links ?? []); setAttachedFiles(detail.files ?? []);
      if (editor.current) editor.current.innerHTML = detail.contentHtml;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not open Wiki page."); }
  }

  useEffect(() => {
    const match = /^wiki-page:([a-z0-9-]{1,80}):\d+$/i.exec(state);
    if (!match) return;
    setStatus("active");
    setSearch("");
    setSelectedCategoryId("");
    setEditing(false);
    setCreating(false);
    setError("");
    void openPage(match[1]);
  }, [state]);

  useEffect(() => {
    if (!/^wiki-create:\d+$/.test(state) || !canManage) return;
    setStatus("active"); setSearch(""); setSelectedCategoryId(""); setSelectedPage(null); setEditing(false);
    setDraftTitle(""); setDraftAudience("location"); setDraftAudienceGroupId(""); setError("");
    const categoryId = categories.find((category) => !category.archivedAt)?.id;
    if (categoryId) { setDraftCategory(categoryId); setCreating(true); }
    else { setDraftCategory(""); setCreating(false); setError("Create a Wiki category before creating a page."); }
  }, [state, canManage, categories]);

  function followWikiEntityLink(event: MouseEvent<HTMLElement>) {
    if (editing) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest<HTMLAnchorElement>('a[data-entity-type][data-entity-id]');
    if (!anchor) return;
    const entityType = anchor.dataset.entityType;
    const entityId = anchor.dataset.entityId?.trim();
    if (!entityId || !/^[a-z0-9-]{1,80}$/i.test(entityId)) return;
    if (entityType === "person" || entityType === "group" || entityType === "song") {
      event.preventDefault();
      onNavigateEntity?.(entityType, entityId);
      return;
    }
    if (entityType !== "wiki") return;
    const pageId = entityId;
    if (!pageId || pageId === selectedPage?.id || !/^[a-z0-9-]{1,80}$/i.test(pageId)) return;
    event.preventDefault();
    setEditing(false);
    setShowHistory(false);
    setPreviewVersion(null);
    setComparison(null);
    setSelectedCategoryId("");
    setCreating(false);
    void openPage(pageId);
  }

  useEffect(() => {
    const query = wikiPageQuery.trim();
    if (!showEntityLink || query.length < 2 || (entityType === "person" && !canSearchPeople)) {
      setWikiPageMatches([]);
      setWikiPageSearchBusy(false);
      return;
    }
    const controller = new AbortController();
    setWikiPageMatches([]);
    setWikiPageSearchBusy(true);
    const timer = window.setTimeout(() => {
      const endpoint = `/api/modules/wiki/entity-search?type=${entityType}&q=${encodeURIComponent(query)}`;
      void fetch(endpoint, {
        headers: { "x-department-id": departmentId }, cache: "no-store", signal: controller.signal,
      }).then(async (response) => {
        if (!response.ok) throw new Error("Could not search for discoverable records.");
        return await response.json() as WikiEntityMatch[];
      }).then(setWikiPageMatches).catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) setWikiPageMatches([]);
      }).finally(() => { if (!controller.signal.aborted) setWikiPageSearchBusy(false); });
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [canSearchPeople, departmentId, entityType, showEntityLink, wikiPageQuery]);

  useEffect(() => { const timer = window.setTimeout(() => { void refresh(""); }, 220); return () => window.clearTimeout(timer); }, [departmentId, status, categoryStatus, search]);
  useEffect(() => realtime?.subscribe("module:wiki:changed", () => { void refresh(); }), [realtime, departmentId, status, categoryStatus, search]);
  useEffect(() => {
    if (selectedPage && editor.current && !editing) editor.current.innerHTML = selectedPage.contentHtml;
  }, [selectedPage?.id, selectedPage?.contentHtml, editing]);

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true); setError(""); setFeedback("");
    try { await action(); setFeedback(success); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The request could not be completed."); }
    finally { setBusy(false); }
  }

  async function createPage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draftCategory || !draftTitle.trim()) return;
    await run(async () => {
      const page = await api<WikiPage>("/api/modules/wiki/pages", "POST", { categoryId: draftCategory, title: draftTitle.trim(), contentHtml: "", audience: draftAudience, audienceGroupId: draftAudience === "group" ? draftAudienceGroupId : null });
      setCreating(false); setDraftTitle(""); setDraftCategory(""); setDraftAudience("location"); setDraftAudienceGroupId(""); setStatus("active"); await refresh(page.id, "active");
    }, "Wiki page created.");
  }

  async function savePage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPage || !editor.current) return;
    await run(async () => {
      const page = await api<WikiPage>(`/api/modules/wiki/pages/${selectedPage.id}`, "PUT", { categoryId: categoryDraft, title: titleDraft.trim(), contentHtml: editor.current!.innerHTML, redirectPageId: redirectDraft || null, audience: audienceDraft, audienceGroupId: audienceDraft === "group" ? audienceGroupIdDraft : null });
      setSelectedPage({ ...selectedPage, ...page, links, files: attachedFiles }); setEditing(false); await refresh(page.id);
    }, "Page saved.");
  }

  function format(command: string, value?: string) { editor.current?.focus(); document.execCommand(command, false, value); }
  function rememberEditorRange() {
    const selection = window.getSelection();
    if (selection?.rangeCount && editor.current?.contains(selection.anchorNode)) editorRange.current = selection.getRangeAt(0).cloneRange();
  }
  function insertInlineImage(file: WikiFile) {
    if (!selectedPage || !editor.current) return;
    const image = document.createElement("img");
    image.src = `/api/modules/wiki/pages/${selectedPage.id}/files/${file.id}/inline`;
    image.alt = file.title;
    const target = editorRange.current?.cloneRange();
    const selection = window.getSelection();
    editor.current.focus();
    if (target && editor.current.contains(target.commonAncestorContainer)) {
      target.deleteContents();
      target.insertNode(image);
      target.setStartAfter(image);
      target.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(target);
    } else {
      editor.current.append(image);
    }
    editorRange.current = null;
    setShowInlineImages(false);
  }
  function insertEntityLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = entityId.trim(); const label = entityLabel.trim();
    if (!id || !label || !editor.current) return;
    const anchor = document.createElement("a");
    anchor.href = entityType === "wiki" ? `#wiki:${encodeURIComponent(id)}` : `#entity:${entityType}:${encodeURIComponent(id)}`;
    anchor.dataset.entityType = entityType; anchor.dataset.entityId = id; anchor.textContent = label;
    editor.current.focus(); document.execCommand("insertHTML", false, anchor.outerHTML);
    setEntityId(""); setEntityLabel(""); setShowEntityLink(false);
  }

  async function addCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const next = await api<Category>("/api/modules/wiki/categories", "POST", { name: categoryName.trim(), parentId: categoryParentId || null });
      setCategoryName(""); setCategoryParentId(""); setShowNewCategory(false); setCategories((current) => [...current, next]); setSelectedCategoryId(next.id);
    }, "Category created.");
  }

  async function archivePage() {
    if (!selectedPage || !window.confirm(`Archive “${selectedPage.title}”? You can restore it later.`)) return;
    await run(async () => { await api(`/api/modules/wiki/pages/${selectedPage.id}/archive`, "POST", {}); setSelectedPage(null); await refresh(""); }, "Page archived.");
  }
  async function restorePage() {
    if (!selectedPage) return;
    await run(async () => { await api(`/api/modules/wiki/pages/${selectedPage.id}/restore`, "POST", {}); setStatus("active"); await refresh(selectedPage.id, "active"); }, "Page restored.");
  }
  async function setHomepage() {
    if (!selectedPage) return;
    await run(async () => { await api(`/api/modules/wiki/pages/${selectedPage.id}/homepage`, "PUT", { isHomepage: !selectedPage.isHomepage }); await refresh(selectedPage.id); }, selectedPage.isHomepage ? "Homepage cleared." : "Homepage set.");
  }
  async function renameCategory(category: Category) {
    const name = window.prompt("Category name", category.name)?.trim();
    if (!name || name === category.name) return;
    await run(async () => { await api(`/api/modules/wiki/categories/${category.id}`, "PUT", { name, parentId: category.parentId, position: category.position }); await refresh(); }, "Category saved.");
  }
  async function archiveCategory(category: Category) {
    if (!window.confirm(`Archive category “${category.name}”? It must have no active pages or child categories.`)) return;
    await run(async () => { await api(`/api/modules/wiki/categories/${category.id}`, "DELETE"); setSelectedCategoryId(""); await refresh(""); }, "Category archived.");
  }
  async function restoreCategory(category: Category) {
    await run(async () => { await api(`/api/modules/wiki/categories/${category.id}/restore`, "POST", {}); setCategoryStatus("active"); await refresh(selectedPage?.id, "active"); }, "Category restored.");
  }
  async function addSubcategory(parent: Category) {
    const name = window.prompt(`New subcategory under “${parent.name}”`);
    if (!name?.trim()) return;
    await run(async () => { const next = await api<Category>("/api/modules/wiki/categories", "POST", { name: name.trim(), parentId: parent.id }); setCategories((current) => [...current, next]); setSelectedCategoryId(next.id); }, "Subcategory created.");
  }
  async function updateRedirect() {
    if (!selectedPage || !editor.current) return;
    await run(async () => {
      const page = await api<WikiPage>(`/api/modules/wiki/pages/${selectedPage.id}`, "PUT", { categoryId: categoryDraft || selectedPage.categoryId, title: titleDraft || selectedPage.title, contentHtml: editor.current!.innerHTML, redirectPageId: redirectDraft || null, audience: audienceDraft, audienceGroupId: audienceDraft === "group" ? audienceGroupIdDraft : null });
      await refresh(page.id);
    }, redirectDraft ? "Redirect saved." : "Redirect removed.");
  }
  async function openHistory() {
    if (!selectedPage) return;
    await run(async () => {
      const nextVersions = await api<PageVersion[]>(`/api/modules/wiki/pages/${selectedPage.id}/versions`);
      setVersions(nextVersions); setCompareRightId(nextVersions[0]?.id ?? ""); setCompareLeftId(nextVersions[1]?.id ?? nextVersions[0]?.id ?? ""); setComparison(null); setShowHistory(true);
    }, "");
  }
  async function compareVersions() {
    if (!selectedPage || !compareLeftId || !compareRightId || compareLeftId === compareRightId) return;
    await run(async () => {
      const query = new URLSearchParams({ leftVersionId: compareLeftId, rightVersionId: compareRightId });
      setComparison(await api<VersionComparison>(`/api/modules/wiki/pages/${selectedPage.id}/versions/compare?${query}`));
    }, "");
  }
  async function restoreVersion(version: PageVersion) {
    if (!selectedPage || !window.confirm(`Restore version “${version.title}” from ${humanDate(version.createdAt)}? The current page will be saved in history.`)) return;
    await run(async () => { await api(`/api/modules/wiki/pages/${selectedPage.id}/versions/${version.id}/restore`, "POST", {}); setShowHistory(false); await refresh(selectedPage.id); }, "Version restored.");
  }

  async function addLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedPage) return;
    await run(async () => { const link = await api<WikiLink>(`/api/modules/wiki/pages/${selectedPage.id}/links`, "POST", { title: linkTitle.trim(), url: linkUrl.trim() }); setLinks((current) => [...current, link]); setLinkTitle(""); setLinkUrl(""); }, "Link added.");
  }
  async function removeLink(linkId: string) {
    if (!selectedPage) return;
    await run(async () => { await api(`/api/modules/wiki/pages/${selectedPage.id}/links/${linkId}`, "DELETE"); setLinks((current) => current.filter((link) => link.id !== linkId)); }, "Link removed.");
  }
  async function uploadAndAttach(file: File) {
    if (!selectedPage) return;
    await run(async () => {
      const query = new URLSearchParams({ title: file.name, category: "Wiki", filename: file.name });
      const response = await fetch(`/api/files?${query}`, { method: "POST", headers: { "x-department-id": departmentId, "x-csrf-token": csrfToken, "x-resource-content-type": file.type || "application/octet-stream", "content-type": "application/vnd.smart-church.resource" }, body: await file.arrayBuffer() });
      const stored = await response.json() as WikiFile | { error?: string };
      if (!response.ok || !("id" in stored)) throw new Error("error" in stored ? stored.error ?? "File upload failed." : "File upload failed.");
      await api(`/api/modules/wiki/pages/${selectedPage.id}/files`, "POST", { fileId: stored.id });
      const next = await api<WikiPage>(`/api/modules/wiki/pages/${selectedPage.id}`); setAttachedFiles(next.files ?? []);
    }, "Attachment uploaded and added.");
  }
  async function loadAvailableFiles() {
    if (!selectedPage) return;
    await run(async () => { setAvailableFiles(await api<WikiFile[]>(`/api/modules/wiki/pages/${selectedPage.id}/available-files`)); setShowAttachments(true); }, "");
  }
  async function attachFile(fileId: string) {
    if (!selectedPage) return;
    await run(async () => { await api(`/api/modules/wiki/pages/${selectedPage.id}/files`, "POST", { fileId }); const page = await api<WikiPage>(`/api/modules/wiki/pages/${selectedPage.id}`); setAttachedFiles(page.files ?? []); setAvailableFiles((current) => current.filter((file) => file.id !== fileId)); }, "File attached.");
  }
  async function detachFile(fileId: string) {
    if (!selectedPage) return;
    await run(async () => { await api(`/api/modules/wiki/pages/${selectedPage.id}/files/${fileId}`, "DELETE"); setAttachedFiles((current) => current.filter((file) => file.id !== fileId)); }, "File detached.");
  }

  function renderCategory(category: Category, depth: number) {
    return <div className="wiki-category-row" key={category.id}><button className={`wiki-category-item ${depth ? "wiki-category-child" : ""}`} style={{ paddingLeft: `${.6 + Math.min(depth, 6) * .8}rem` }} type="button" aria-current={selectedCategoryId === category.id} onClick={() => setSelectedCategoryId(selectedCategoryId === category.id ? "" : category.id)}><BookOpenText size={14} />{category.name}</button>{canManage && <details className="wiki-category-menu"><summary aria-label={`Actions for ${category.name}`}>···</summary><div>{categoryStatus === "active" ? <><button type="button" onClick={() => void addSubcategory(category)}>Add subcategory</button><button type="button" onClick={() => void renameCategory(category)}>Rename</button><button type="button" onClick={() => void archiveCategory(category)}>Archive</button></> : <button type="button" onClick={() => void restoreCategory(category)}>Restore</button>}</div></details>}</div>;
  }

  return <div className="wiki-page">
    <aside className="wiki-panel" aria-label="Wiki categories">
      <div className="wiki-panel-head"><h2>Categories</h2><div className="wiki-actions"><select className="wiki-select" aria-label="Category status" value={categoryStatus} onChange={(event) => { setCategoryStatus(event.target.value as "active" | "archived"); setSelectedCategoryId(""); }}><option value="active">Active</option><option value="archived">Archived</option></select>{canManage && categoryStatus === "active" && <button className="button button-secondary" type="button" title="Create category" onClick={() => setShowNewCategory(true)}><Plus size={15} /></button>}</div></div>
      {categoryStatus === "active" && <button type="button" className={`wiki-category-item ${!selectedCategoryId ? "wiki-category-selected" : ""}`} onClick={() => setSelectedCategoryId("")}>All pages</button>}
      <div className="wiki-category-list">{flatCategories.map(({ category, depth }) => renderCategory(category, depth))}</div>
      {!categories.length && <p className="wiki-empty">No categories yet. Create a category to organize pages.</p>}
      {canManage && <button className="button button-primary" type="button" onClick={() => { setDraftCategory(selectedCategoryId || categories[0]?.id || ""); setDraftTitle(""); setCreating(true); }} disabled={!categories.length}><FilePlus2 size={15} /> New page</button>}
    </aside>

    <aside className="wiki-panel" aria-label="Wiki pages">
      <div className="wiki-panel-head"><h2>Pages</h2><select className="wiki-select" aria-label="Page status" value={status} onChange={(event) => setStatus(event.target.value as "active" | "archived")}><option value="active">Active</option><option value="archived">Archived</option></select></div>
      <label className="wiki-search"><Search size={14} /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search pages" aria-label="Search Wiki pages" /></label>
      <div className="wiki-page-list">{visiblePages.map((page) => <button type="button" className={`wiki-page-item ${selectedPage?.id === page.id ? "wiki-page-item-selected" : ""} ${page.status === "archived" ? "wiki-page-archived" : ""}`} key={page.id} aria-current={selectedPage?.id === page.id} onClick={() => { setEditing(false); void openPage(page.id); }}><strong>{page.isHomepage ? "⌂ " : ""}{page.title}</strong><small>{humanDate(page.updatedAt)}{page.editorName ? ` · ${page.editorName}` : ""}</small></button>)}</div>
      {!visiblePages.length && <p className="wiki-empty">{search ? "No pages match your search." : "No pages in this view."}</p>}
    </aside>

    <main className="wiki-editor">
      {error && <div role="alert" className="wiki-error">{error}</div>}{feedback && <div role="status" className="wiki-feedback">{feedback}</div>}
      {creating ? <form onSubmit={createPage} className="wiki-create-form"><div className="wiki-editor-header"><div><span className="wiki-muted">NEW WIKI PAGE</span><h2>Create a page</h2></div><button className="button button-quiet" type="button" onClick={() => setCreating(false)} aria-label="Cancel"><X size={17} /></button></div><label>Title<input autoFocus className="wiki-title-input" maxLength={180} value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} required /></label><label>Category<select className="wiki-select" value={draftCategory} onChange={(event) => setDraftCategory(event.target.value)} required><option value="">Select category</option>{flatCategories.map(({ category, depth }) => <option key={category.id} value={category.id}>{"— ".repeat(depth)}{category.name}</option>)}</select></label><label>Who can read this page?<select className="wiki-select" value={draftAudience} onChange={(event) => { setDraftAudience(event.target.value as WikiAudience); if (event.target.value !== "group") setDraftAudienceGroupId(""); }}><option value="location">Everyone in this location</option><option value="group">Members of one group</option><option value="managers">Wiki managers only</option></select></label>{draftAudience === "group" && <label>Group<select className="wiki-select" required value={draftAudienceGroupId} onChange={(event) => setDraftAudienceGroupId(event.target.value)}><option value="">Choose a group</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>}<div className="wiki-actions"><button className="button button-primary" type="submit" disabled={busy || !draftTitle.trim() || !draftCategory || (draftAudience === "group" && !draftAudienceGroupId)}><Plus size={15} /> Create page</button></div></form>
      : selectedPage ? <>
        <div className="wiki-editor-header"><div><span className="wiki-muted">{status === "archived" ? "ARCHIVED WIKI PAGE" : "WIKI PAGE"}</span>{editing ? <input className="wiki-title-input" maxLength={180} value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} aria-label="Page title" /> : <h1>{selectedPage.isHomepage ? "⌂ " : ""}{selectedPage.title}</h1>}<p className="wiki-muted">{categories.find((category) => category.id === (editing ? categoryDraft : selectedPage.categoryId))?.name ?? "Uncategorized"} · Audience: {selectedPage.audience === "group" ? `Group · ${groups.find((group) => group.id === selectedPage.audienceGroupId)?.name ?? "selected group"}` : selectedPage.audience === "managers" ? "Wiki managers only" : "Everyone in this location"} · Updated {humanDate(selectedPage.updatedAt)}{selectedPage.editorName ? ` by ${selectedPage.editorName}` : ""}</p></div><div className="wiki-actions"><button className="button button-secondary" type="button" title="Print page" onClick={() => window.print()}><Printer size={15} /> Print</button><a className="button button-secondary" href={`/api/modules/wiki/pages/${selectedPage.id}/export/html`} target="_blank" rel="noreferrer"><ArrowDownToLine size={15} /> HTML</a><a className="button button-secondary" href={`/api/modules/wiki/pages/${selectedPage.id}/export/pdf`}><ArrowDownToLine size={15} /> PDF</a>{canManage && status === "active" && !editing && <><button className="button button-primary" type="button" onClick={() => setEditing(true)}><Pencil size={15} /> Edit</button><button className="button button-secondary" type="button" onClick={() => void setHomepage()}>{selectedPage.isHomepage ? "Unset homepage" : "Set homepage"}</button></>}{canManage && editing && <button className="button button-primary" type="button" onClick={(event) => { event.preventDefault(); void savePage(new Event("submit") as unknown as FormEvent<HTMLFormElement>); }} disabled={busy || !titleDraft.trim() || (audienceDraft === "group" && !audienceGroupIdDraft)}><Save size={15} /> Save</button>}{canManage && <button className="button button-secondary" type="button" onClick={() => void openHistory()}><History size={15} /> History</button>}{canManage && status === "active" && !editing && <button className="button button-secondary" type="button" onClick={() => void archivePage()}><Archive size={15} /> Archive</button>}{canManage && status === "archived" && <button className="button button-secondary" type="button" onClick={() => void restorePage()}><RotateCcw size={15} /> Restore</button>}</div></div>
        {editing && <><label className="wiki-field-label">Category<select className="wiki-select" value={categoryDraft} onChange={(event) => setCategoryDraft(event.target.value)}>{flatCategories.map(({ category, depth }) => <option key={category.id} value={category.id}>{"— ".repeat(depth)}{category.name}</option>)}</select></label><label className="wiki-field-label">Who can read this page?<select className="wiki-select" value={audienceDraft} onChange={(event) => { setAudienceDraft(event.target.value as WikiAudience); if (event.target.value !== "group") setAudienceGroupIdDraft(""); }}><option value="location">Everyone in this location</option><option value="group">Members of one group</option><option value="managers">Wiki managers only</option></select></label>{audienceDraft === "group" && <label className="wiki-field-label">Group<select className="wiki-select" required value={audienceGroupIdDraft} onChange={(event) => setAudienceGroupIdDraft(event.target.value)}><option value="">Choose a group</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>}<div className="wiki-toolbar" role="toolbar" aria-label="Page formatting"><button type="button" title="Bold" onClick={() => format("bold")}><strong>B</strong></button><button type="button" title="Italic" onClick={() => format("italic")}><em>I</em></button><button type="button" title="Strikethrough" onClick={() => format("strikeThrough")}><s>S</s></button><button type="button" title="Code" onClick={() => format("formatBlock", "pre")}><code>Code</code></button><button type="button" title="Heading" onClick={() => format("formatBlock", "h2")}>H2</button><button type="button" title="Bulleted list" onClick={() => format("insertUnorderedList")}>• List</button><button type="button" title="Numbered list" onClick={() => format("insertOrderedList")}>1. List</button><button type="button" title="Insert link" onClick={() => { const url = window.prompt("Link URL"); if (url) format("createLink", url); }}><Link2 size={15} /> Link</button><button type="button" title="Add typed link" onClick={() => setShowEntityLink(true)}>@ Entity</button><button type="button" title="Insert inline image" disabled={!inlineImageFiles.length} onMouseDown={rememberEditorRange} onClick={() => setShowInlineImages(true)}><ImagePlus size={15} /> Image</button><button type="button" title="Undo" onClick={() => format("undo")}>Undo</button><button type="button" title="Redo" onClick={() => format("redo")}>Redo</button></div>{!inlineImageFiles.length && <p className="wiki-muted">Attach a JPEG image (up to 2 MB) to this page to insert it inline.</p>}</>}
        <div ref={editor} className="wiki-content" onClick={followWikiEntityLink} onMouseUp={rememberEditorRange} onKeyUp={rememberEditorRange} onBlur={rememberEditorRange} contentEditable={editing} suppressContentEditableWarning role={editing ? "textbox" : undefined} aria-label="Wiki page content" aria-multiline={editing} data-placeholder="Write your page content here. Use the toolbar for formatting and entity links." />
        {selectedPage.redirectPageId && <p className="wiki-muted">This page redirects to <button className="button button-quiet" type="button" onClick={() => { setEditing(false); void openPage(selectedPage.redirectPageId!); }}>{pages.find((page) => page.id === selectedPage.redirectPageId)?.title ?? "another Wiki page"}</button>.</p>}
        {editing && <div className="wiki-redirect-editor"><label>Redirect to Wiki page<select className="wiki-input" value={redirectDraft} onChange={(event) => setRedirectDraft(event.target.value)}><option value="">No redirect</option>{pages.filter((page) => page.status === "active" && page.id !== selectedPage.id).map((page) => <option key={page.id} value={page.id}>{page.title}</option>)}</select></label><button className="button button-secondary" type="button" disabled={busy} onClick={() => void updateRedirect()}>Save redirect</button></div>}
        <div className="wiki-detail-sections"><section className="wiki-detail-section"><div className="wiki-panel-head"><h3>Links</h3></div>{canManage && status === "active" && <form className="wiki-add-link" onSubmit={addLink}><input className="wiki-input" value={linkTitle} onChange={(event) => setLinkTitle(event.target.value)} placeholder="Link title" maxLength={160} required /><input className="wiki-input" type="url" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="https://…" maxLength={2000} required /><button className="button button-secondary" type="submit" disabled={busy}><Plus size={14} /> Add</button></form>}{links.map((link) => <div className="wiki-link-row" key={link.id}><a href={link.url} target="_blank" rel="noreferrer">{link.title}</a>{canManage && status === "active" && <button type="button" className="button button-quiet" onClick={() => void removeLink(link.id)} aria-label={`Remove ${link.title}`}><Trash2 size={14} /></button>}</div>)}{!links.length && <p className="wiki-muted">No links attached.</p>}</section>
        <section className="wiki-detail-section"><div className="wiki-panel-head"><h3>Files</h3><div className="wiki-actions">{canUpload && <button className="button button-quiet" type="button" onClick={() => filePicker.current?.click()} title="Upload file"><Plus size={14} /> Upload</button>}{canManage && <button className="button button-quiet" type="button" onClick={() => void loadAvailableFiles()} title="Attach an existing file"><FileText size={14} /> Attach</button>}<input ref={filePicker} hidden type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadAndAttach(file); event.currentTarget.value = ""; }} /></div></div>{attachedFiles.map((file) => <div className="wiki-file-row" key={file.id}><span><a href={`/api/modules/wiki/pages/${selectedPage.id}/files/${file.id}/download`} target="_blank" rel="noreferrer">{file.title}</a><small className="wiki-file-meta"> · {file.fileName} · {sizeLabel(file.fileSize)}</small></span>{canManage && <button type="button" className="button button-quiet" onClick={() => void detachFile(file.id)} aria-label={`Remove ${file.title}`}><X size={14} /></button>}</div>)}{!attachedFiles.length && <p className="wiki-muted">No files attached.</p>}</section></div>
      </> : <div className="wiki-empty"><BookOpenText size={28} /><h2>Welcome to Wiki</h2><p>Choose a page to read or create the first page for this location.</p>{canManage && categories.length > 0 && <button className="button button-primary" type="button" onClick={() => { setDraftCategory(selectedCategoryId || categories[0].id); setCreating(true); }}><Plus size={15} /> Create a page</button>}</div>}
    </main>

    {showHistory && <div className="wiki-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowHistory(false); }}><section className="wiki-modal" role="dialog" aria-modal="true" aria-labelledby="wiki-history-title"><div className="wiki-panel-head"><div><span className="wiki-muted">VERSION HISTORY</span><h2 id="wiki-history-title">{selectedPage?.title}</h2></div><button className="button button-quiet" type="button" onClick={() => setShowHistory(false)} aria-label="Close history"><X size={18} /></button></div>{canManage && versions.length > 1 && <div className="wiki-version-compare-controls"><label>Compare revision<select value={compareLeftId} onChange={(change) => setCompareLeftId(change.target.value)}>{versions.map((version) => <option key={version.id} value={version.id}>{version.title} · {humanDate(version.createdAt)}</option>)}</select></label><span>with</span><label>Revision<select value={compareRightId} onChange={(change) => setCompareRightId(change.target.value)}>{versions.map((version) => <option key={version.id} value={version.id}>{version.title} · {humanDate(version.createdAt)}</option>)}</select></label><button className="button button-primary" type="button" disabled={!compareLeftId || !compareRightId || compareLeftId === compareRightId || busy} onClick={() => void compareVersions()}><FileText size={14} /> Compare</button></div>}{versions.map((version) => <div className="wiki-version-item" key={version.id}><div><strong>{version.title}</strong><small className="wiki-muted">{humanDate(version.createdAt)}{version.editorName ? ` · ${version.editorName}` : ""}</small></div><div className="wiki-actions"><button className="button button-secondary" type="button" onClick={() => setPreviewVersion(version)}><FileText size={14} /> Preview</button><button className="button button-secondary" type="button" onClick={() => void restoreVersion(version)}><RotateCcw size={14} /> Restore</button></div></div>)}{!versions.length && <p className="wiki-empty">No saved versions yet.</p>}</section></div>}
    {comparison && <div className="wiki-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setComparison(null)}><section className="wiki-modal wiki-version-comparison" role="dialog" aria-modal="true" aria-labelledby="wiki-version-comparison-title"><div className="wiki-panel-head"><div><span className="wiki-muted">MANAGER REVISION COMPARISON</span><h2 id="wiki-version-comparison-title">{selectedPage?.title}</h2></div><button className="button button-quiet" type="button" onClick={() => setComparison(null)} aria-label="Close revision comparison"><X size={18} /></button></div><div className="wiki-version-comparison-columns">{([comparison.left, comparison.right] as const).map((version, index) => <section className="wiki-version-comparison-column" key={version.id}><header><strong>{index === 0 ? "Selected revision" : "Compared revision"}</strong><span>{version.title}</span><small className="wiki-muted">{humanDate(version.createdAt)}{version.editorName ? ` · ${version.editorName}` : ""}</small></header><article className="wiki-version-preview-content" dangerouslySetInnerHTML={{ __html: version.contentHtml }} /></section>)}</div><div className="wiki-modal-actions"><button className="button button-secondary" type="button" onClick={() => setComparison(null)}>Close comparison</button></div></section></div>}
    {previewVersion && <div className="wiki-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setPreviewVersion(null)}><section className="wiki-modal wiki-version-preview" role="dialog" aria-modal="true" aria-labelledby="wiki-version-preview-title"><div className="wiki-panel-head"><div><span className="wiki-muted">READ-ONLY REVISION PREVIEW · {humanDate(previewVersion.createdAt)}</span><h2 id="wiki-version-preview-title">{previewVersion.title}</h2><small className="wiki-muted">{previewVersion.editorName ? `Saved by ${previewVersion.editorName}` : "Saved revision"}</small></div><button className="button button-quiet" type="button" onClick={() => setPreviewVersion(null)} aria-label="Close revision preview"><X size={18} /></button></div><article className="wiki-version-preview-content" dangerouslySetInnerHTML={{ __html: previewVersion.contentHtml }} /><div className="wiki-modal-actions"><button className="button button-secondary" type="button" onClick={() => setPreviewVersion(null)}>Close preview</button>{canManage && <button className="button button-primary" type="button" onClick={() => { const version = previewVersion; setPreviewVersion(null); void restoreVersion(version); }}><RotateCcw size={14} /> Restore this version</button>}</div></section></div>}
    {showAttachments && <div className="wiki-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowAttachments(false); }}><section className="wiki-modal" role="dialog" aria-modal="true" aria-labelledby="wiki-files-title"><div className="wiki-panel-head"><h2 id="wiki-files-title">Attach a stored file</h2><button className="button button-quiet" type="button" onClick={() => setShowAttachments(false)} aria-label="Close"><X size={18} /></button></div>{availableFiles.map((file) => <div className="wiki-file-row" key={file.id}><span><strong>{file.title}</strong><small className="wiki-file-meta"> · {file.fileName} · {sizeLabel(file.fileSize)}</small></span><button className="button button-secondary" type="button" onClick={() => void attachFile(file.id)}><Plus size={14} /> Attach</button></div>)}{!availableFiles.length && <p className="wiki-empty">No other files are available in this location.</p>}</section></div>}
    {showInlineImages && <div className="wiki-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowInlineImages(false); }}><section className="wiki-modal" role="dialog" aria-modal="true" aria-labelledby="wiki-inline-images-title"><div className="wiki-panel-head"><h2 id="wiki-inline-images-title">Insert inline image</h2><button className="button button-quiet" type="button" onClick={() => setShowInlineImages(false)} aria-label="Close"><X size={18} /></button></div><p className="wiki-muted">Choose a JPEG already attached to this page. Readers can load it only if they can read this page.</p>{inlineImageFiles.map((file) => <div className="wiki-file-row" key={file.id}><span><strong>{file.title}</strong><small className="wiki-file-meta"> · {file.fileName} · {sizeLabel(file.fileSize)}</small></span><button className="button button-secondary" type="button" onClick={() => insertInlineImage(file)}><ImagePlus size={14} /> Insert</button></div>)}{!inlineImageFiles.length && <p className="wiki-empty">Attach a JPEG image no larger than 2 MB before inserting it inline.</p>}</section></div>}
    {showNewCategory && <div className="wiki-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowNewCategory(false); }}><form className="wiki-modal" role="dialog" aria-modal="true" aria-labelledby="wiki-category-title" onSubmit={addCategory}><div className="wiki-panel-head"><h2 id="wiki-category-title">Create category</h2><button className="button button-quiet" type="button" onClick={() => setShowNewCategory(false)} aria-label="Close"><X size={18} /></button></div><label>Category name<input autoFocus className="wiki-input" maxLength={120} value={categoryName} onChange={(event) => setCategoryName(event.target.value)} required /></label><label>Parent category<select className="wiki-select" value={categoryParentId} onChange={(event) => setCategoryParentId(event.target.value)}><option value="">No parent</option>{flatCategories.map(({ category, depth }) => <option key={category.id} value={category.id}>{"— ".repeat(depth)}{category.name}</option>)}</select></label><div className="wiki-modal-actions"><button className="button button-secondary" type="button" onClick={() => setShowNewCategory(false)}>Cancel</button><button className="button button-primary" type="submit" disabled={busy || !categoryName.trim()}><Plus size={14} /> Create category</button></div></form></div>}
    {showEntityLink && <div className="wiki-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowEntityLink(false); }}><form className="wiki-modal" role="dialog" aria-modal="true" aria-labelledby="wiki-entity-title" onSubmit={insertEntityLink}><div className="wiki-panel-head"><h2 id="wiki-entity-title">Insert linked record</h2><button className="button button-quiet" type="button" onClick={() => setShowEntityLink(false)} aria-label="Close"><X size={18} /></button></div><p className="wiki-muted">Search for a person, group, Wiki page, or song that is visible to you.</p><label>Record type<select className="wiki-select" value={entityType} onChange={(event) => { setEntityType(event.target.value as EntityType); setEntityId(""); setEntityLabel(""); setWikiPageQuery(""); setWikiPageMatches([]); }}>{entityTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>{entityType !== "person" || canSearchPeople ? <><label>Find a {entityType === "wiki" ? "Wiki page" : entityType === "person" ? "person" : entityType === "group" ? "group" : "song"}<input autoFocus className="wiki-input" type="search" value={wikiPageQuery} onChange={(event) => setWikiPageQuery(event.target.value)} placeholder="Type at least two characters" /></label>{wikiPageSearchBusy && <p className="wiki-muted" role="status">Searching records…</p>}{wikiPageQuery.trim().length >= 2 && !wikiPageSearchBusy && !wikiPageMatches.length && <p className="wiki-muted">No discoverable {entityType} records found.</p>}{wikiPageMatches.length > 0 && <div className="wiki-page-list" role="listbox" aria-label={`Matching ${entityType} records`}>{wikiPageMatches.map((match) => <button key={match.id} className="wiki-page-item" type="button" role="option" aria-selected={entityId === match.id} onClick={() => { setEntityId(match.id); setEntityLabel(match.title); setWikiPageQuery(""); setWikiPageMatches([]); }}><strong>{match.title}</strong>{match.detail && <small>{match.detail}</small>}</button>)}</div>}</> : <p className="wiki-muted">Private People access is required to search for person links.</p>}<label>Record ID<input className="wiki-input" value={entityId} onChange={(event) => setEntityId(event.target.value)} maxLength={80} required readOnly /></label><label>Link text<input className="wiki-input" value={entityLabel} onChange={(event) => setEntityLabel(event.target.value)} maxLength={160} required /></label><div className="wiki-modal-actions"><button className="button button-secondary" type="button" onClick={() => setShowEntityLink(false)}>Cancel</button><button className="button button-primary" type="submit" disabled={!entityId}>Insert link</button></div></form></div>}
  </div>;
}
