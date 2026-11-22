import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { Archive, ArrowDownToLine, BookOpenText, ChevronDown, ChevronRight, Copy, FilePlus2, FileText, History, ImagePlus, Link2, Pencil, Plus, Printer, RotateCcw, Save, Search, Trash2, X } from "lucide-react";
import type { ModuleContext } from "../../module-registry";
import { discardWikiDraft, readWikiDraft, wikiDraftKey, writeWikiDraft, type WikiDraft, type WikiDraftContent } from "./wiki-drafts";
import { WikiCategoryLanding } from "./WikiCategoryLanding";
import { WikiLinkCopyActions } from "./WikiLinkCopyActions";

type Category = { id: string; name: string; parentId: string | null; position: number; archivedAt: string | null };
type WikiAudience = "location" | "group" | "managers";
type GroupOption = { id: string; name: string };
const attachmentPageSize = 15;
type FileSort = "added" | "name" | "title" | "uploader";

type WikiFile = { id: string; title: string; fileName: string; contentType: string; fileSize: number; createdAt: string; attachedAt?: string; attachedByName?: string | null; displayTitle?: string | null; managersOnly?: boolean };
type WikiLink = { id: string; title: string; url: string; created_at?: string; managers_only?: boolean };
type WikiPage = { id: string; categoryId: string; title: string; contentHtml: string; status: "active" | "archived"; redirectPageId: string | null; isHomepage: boolean; audience: WikiAudience; audienceGroupId: string | null; createdAt: string; updatedAt: string; updatedBy: string | null; editorName?: string | null; editRevision?: string; links?: WikiLink[]; files?: WikiFile[] };
type AudienceSnapshot = { audience: WikiAudience; groupId: string | null };
type CategorySnapshot = { id: string; name: string };
type PageVersion = { id: string; title: string; contentHtml: string; createdAt: string; editorId: string | null; editorName: string | null; audienceChange?: { from: AudienceSnapshot; to: AudienceSnapshot } | null; categoryChange?: { from: CategorySnapshot; to: CategorySnapshot } | null; redirectChange?: { from: string | null; to: string | null } | null };
type VersionComparison = { left: PageVersion; right: PageVersion };
type EntityType = "person" | "group" | "wiki" | "song";
type WikiEntityMatch = { id: string; title: string; detail?: string };
const entityTypes: EntityType[] = ["person", "group", "wiki", "song"];

function categoryTree(categories: Category[], parentId: string | null = null, depth = 0): Array<{ category: Category; depth: number }> {
  return categories.filter((category) => category.parentId === parentId).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)).flatMap((category) => [{ category, depth }, ...categoryTree(categories, category.id, depth + 1)]);
}
function humanDate(value: string) { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function sizeLabel(bytes: number) { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }

function headingFingerprint(title: string) {
  // Use a fixed-width fingerprint so links stay short even for long headings.
  let hash = 0xcbf29ce484222325n;
  for (const character of title.normalize("NFC")) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(character.codePointAt(0)!)) * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

export function WikiModule({ department, departmentId, accountId, csrfToken, canManageSite, realtime, state, directorySearch, onNavigateEntity }: ModuleContext) {
  const editor = useRef<HTMLDivElement>(null);
  const editorRange = useRef<Range | null>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  const [privateUploadPageId, setPrivateUploadPageId] = useState<string>();
  const sharedPageOpened = useRef(false);
  const sharedHeading = useRef<{ pageId: string; id: string } | null>(null);
  const initialNavigationState = useRef(state);
  const directorySearchGeneration = useRef(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [pages, setPages] = useState<WikiPage[]>([]);
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [selectedPage, setSelectedPage] = useState<WikiPage | null>(null);
  const currentPageId = useRef<string | null>(null);
  useEffect(() => { currentPageId.current = selectedPage?.id ?? null; }, [selectedPage?.id]);
  const [headings, setHeadings] = useState<Array<{ id: string; title: string; level: number }>>([]);
  const [bulkPageIds, setBulkPageIds] = useState<string[]>([]);
  const [bulkAudience, setBulkAudience] = useState<WikiAudience | "">("");
  const [bulkGroupId, setBulkGroupId] = useState("");
  const [bulkCategoryId, setBulkCategoryId] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [categoryLandingId, setCategoryLandingId] = useState("");
  const categoryLandingRef = useRef("");
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [hideRedirects, setHideRedirects] = useState(false);
  const pageList = useRef({ version: 0, hideRedirects: false });
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
  const [linkSort, setLinkSort] = useState<"added" | "title">("added");
  const [fileSort, setFileSort] = useState<FileSort>("added");
  const [filePageIndex, setFilePageIndex] = useState(0);
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
  const [attachManagersOnly, setAttachManagersOnly] = useState(false);
  const [showInlineImages, setShowInlineImages] = useState(false);
  const [showTableForm, setShowTableForm] = useState(false);
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [categoryParentId, setCategoryParentId] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkManagersOnly, setLinkManagersOnly] = useState(false);
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null);
  const [detailsSearch, setDetailsSearch] = useState("");
  useEffect(() => {
    setEditingLinkId(null); setLinkTitle(""); setLinkUrl(""); setLinkManagersOnly(false); setDetailsSearch("");
  }, [selectedPage?.id, departmentId]);
  const detailQuery = detailsSearch.trim().toLocaleLowerCase();
  const canManage = canManageSite || (department.modulePermissions?.wiki ?? []).includes("manage");
  const filteredLinks = links.filter((link) => (!link.managers_only || canManage)
    && (!detailQuery || [link.title, link.url].some((value) => value.toLocaleLowerCase().includes(detailQuery))));
  const filteredFiles = attachedFiles.filter((file) => (!file.managersOnly || canManage)
    && (!detailQuery || [file.title, file.fileName, file.attachedByName ?? ""].some((value) => value.toLocaleLowerCase().includes(detailQuery))));
  const lastFilePage = Math.max(0, Math.ceil(filteredFiles.length / attachmentPageSize) - 1);
  const filePage = Math.min(filePageIndex, lastFilePage);
  const firstFileIndex = filePage * attachmentPageSize;
  const visibleFiles = filteredFiles.sort((a, b) => {
    const byDate = (b.attachedAt ?? b.createdAt).localeCompare(a.attachedAt ?? a.createdAt);
    if (fileSort === "name") return a.fileName.localeCompare(b.fileName) || byDate || a.id.localeCompare(b.id);
    if (fileSort === "title") return a.title.localeCompare(b.title) || byDate || a.id.localeCompare(b.id);
    if (fileSort === "uploader") {
      if (Boolean(a.attachedByName) !== Boolean(b.attachedByName)) return a.attachedByName ? -1 : 1;
      return (a.attachedByName ?? "").localeCompare(b.attachedByName ?? "") || byDate || a.id.localeCompare(b.id);
    }
    return byDate || a.id.localeCompare(b.id);
  }).slice(firstFileIndex, firstFileIndex + attachmentPageSize);
  useEffect(() => { setFilePageIndex(0); }, [departmentId, selectedPage?.id, detailQuery, fileSort]);
  useEffect(() => { setFilePageIndex((page) => Math.min(page, lastFilePage)); }, [lastFilePage]);
  const [redirectDraft, setRedirectDraft] = useState("");
  const [showEntityLink, setShowEntityLink] = useState(false);
  const [entityType, setEntityType] = useState<EntityType>("person");
  const [entityId, setEntityId] = useState("");
  const [entityLabel, setEntityLabel] = useState("");
  const [wikiPageQuery, setWikiPageQuery] = useState("");
  const [wikiPageMatches, setWikiPageMatches] = useState<WikiEntityMatch[]>([]);
  const [wikiPageSearchBusy, setWikiPageSearchBusy] = useState(false);
  const [pickerCreateOpen, setPickerCreateOpen] = useState(false);
  const [pickerPageTitle, setPickerPageTitle] = useState("");
  const [pickerPageCategory, setPickerPageCategory] = useState("");
  const [pickerCreateBusy, setPickerCreateBusy] = useState(false);
  const [pickerCreateError, setPickerCreateError] = useState("");
  const [pickerCreateNotice, setPickerCreateNotice] = useState("");

  const draftKey = canManage && selectedPage?.status === "active" ? wikiDraftKey(accountId, departmentId, selectedPage.id) : "";
  const [storedDraft, setStoredDraft] = useState<{ key: string; draft: WikiDraft }>();
  const [draftPreview, setDraftPreview] = useState<{ key: string; html: string; title: string }>();
  const [draftStorageFailed, setDraftStorageFailed] = useState(false);
  const draftAccess = useRef({ draftKey, canManage });
  draftAccess.current = { draftKey, canManage };
  const editorBase = useRef<{ key: string; pageId: string; revision: string; content: WikiDraftContent } | undefined>(undefined);
  const recoveredDraft = draftKey && storedDraft?.key === draftKey ? storedDraft.draft : undefined;

  useEffect(() => {
    const draft = readWikiDraft(draftKey);
    setStoredDraft(draft ? { key: draftKey, draft } : undefined);
    setDraftPreview(undefined);
    setDraftStorageFailed(false);
  }, [draftKey]);

  useEffect(() => { if (editing && !canManage) setEditing(false); }, [editing, canManage]);

  useEffect(() => {
    const element = editor.current;
    const base = editorBase.current;
    if (!editing || !canManage || !draftKey || !element || base?.key !== draftKey) return;
    const saveDraft = () => {
      if (draftAccess.current.draftKey !== draftKey || currentPageId.current !== base.pageId || editorBase.current !== base) return;
      const content = { title: titleDraft, categoryId: categoryDraft, audience: audienceDraft, audienceGroupId: audienceGroupIdDraft,
        redirectPageId: redirectDraft, contentHtml: element.innerHTML };
      if (JSON.stringify(content) === JSON.stringify(base.content)) {
        if (readWikiDraft(draftKey)?.baseRevision === base.revision && discardWikiDraft(draftKey)) setStoredDraft(undefined);
        return;
      }
      const draft = { baseRevision: base.revision, savedAt: Date.now(), content };
      if (writeWikiDraft(draftKey, draft)) {
        setStoredDraft({ key: draftKey, draft });
        setDraftStorageFailed(false);
      } else setDraftStorageFailed(true);
    };
    const observer = new MutationObserver(saveDraft);
    observer.observe(element, { subtree: true, childList: true, attributes: true, characterData: true });
    saveDraft();
    window.addEventListener("pagehide", saveDraft);
    return () => { observer.disconnect(); window.removeEventListener("pagehide", saveDraft); };
  }, [editing, canManage, draftKey, titleDraft, categoryDraft, audienceDraft, audienceGroupIdDraft, redirectDraft]);
  const canUpload = canManage && selectedPage?.status === "active"
    && (canManageSite || (department.modulePermissions?.["file-storage"] ?? []).includes("manage"));
  const canSearchPeople = department.role === "site_admin" || (department.permissions ?? []).some((permission) => permission === "people_view_private" || permission === "people_manage");
  const flatCategories = useMemo(() => categoryTree(categories), [categories]);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(() => new Set());
  const categoryParents = useMemo(() => new Map(categories.map((category) => [category.id, category.parentId])), [categories]);
  const parentCategories = useMemo(() => new Set(categoryParents.values()), [categoryParents]);
  const visibleCategories = flatCategories.filter(({ category }) => {
    const visited = new Set<string>();
    for (let parent = category.parentId; parent && !visited.has(parent); parent = categoryParents.get(parent) ?? null) {
      visited.add(parent);
      if (collapsedCategories.has(parent)) return false;
    }
    return true;
  });
  useEffect(() => { setCollapsedCategories(new Set()); }, [departmentId]);
  useEffect(() => {
    const ancestors = new Set<string>();
    for (const id of [selectedPage?.categoryId, selectedCategoryId]) {
      for (let parent = id ? categoryParents.get(id) : null; parent && !ancestors.has(parent); parent = categoryParents.get(parent) ?? null) ancestors.add(parent);
    }
    setCollapsedCategories((current) => {
      if (![...ancestors].some((id) => current.has(id))) return current;
      return new Set([...current].filter((id) => !ancestors.has(id)));
    });
  }, [categoryParents, selectedPage?.id, selectedPage?.categoryId, selectedCategoryId]);
  const [pageLayout, setPageLayout] = useState<"list" | "gallery" | "table">("list");
  const [tableSort, setTableSort] = useState("updated-desc");
  const [tableColumns, setTableColumns] = useState({ category: true, updated: true, editor: false, status: false });
  const categoryNames = useMemo(() => new Map(categories.map((category) => [category.id, category.name])), [categories]);
  const visiblePages = useMemo(() => pages.filter((page) =>
    (!hideRedirects || !page.redirectPageId) && (!selectedCategoryId || page.categoryId === selectedCategoryId)),
  [pages, hideRedirects, selectedCategoryId]);
  const tablePages = useMemo(() => [...visiblePages].sort((a, b) => {
    if (tableSort === "title") return a.title.localeCompare(b.title);
    if (tableSort === "category") return (categoryNames.get(a.categoryId) ?? "").localeCompare(categoryNames.get(b.categoryId) ?? "") || a.title.localeCompare(b.title);
    const updated = Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
    return (tableSort === "updated-asc" ? updated : -updated) || a.title.localeCompare(b.title);
  }), [visiblePages, tableSort, categoryNames]);
  const bulkIds = visiblePages.filter((page) => page.status === "active" && bulkPageIds.includes(page.id)).map((page) => page.id);
  useEffect(() => { setShowTableForm(false); }, [departmentId, selectedPage?.id, editing]);
  useEffect(() => { setBulkPageIds([]); setBulkAudience(""); setBulkGroupId(""); setBulkCategoryId(""); }, [departmentId, selectedCategoryId, search, status, hideRedirects]);

  function pageSelection(page: WikiPage) {
    if (!canManage || status !== "active" || editing || creating || page.status !== "active") return null;
    const selected = bulkIds.includes(page.id);
    return <input type="checkbox" aria-label={`Select ${page.title}`} checked={selected} disabled={busy || (!selected && bulkIds.length >= 100)} onChange={(event) => {
      const checked = event.target.checked;
      setBulkPageIds((ids) => checked ? [...ids, page.id] : ids.filter((id) => id !== page.id));
    }} />;
  }

  function audienceLabel(value: AudienceSnapshot) {
    if (value.audience === "group") return groups.find((group) => group.id === value.groupId)?.name ?? "Restricted group";
    return value.audience === "managers" ? "Wiki managers only" : "Everyone in this location";
  }
  const inlineImageFiles = attachedFiles.filter((file) => ["image/jpeg", "image/png", "image/webp"].includes(file.contentType) && file.fileSize >= 1 && file.fileSize <= 2_000_000);

  async function api<T>(path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const response = await fetch(path, { method, headers: { "x-department-id": departmentId, ...(method !== "GET" ? { "x-csrf-token": csrfToken } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), cache: "no-store" });
    const result = await response.json().catch(() => null) as T | { error?: string } | null;
    if (!response.ok) throw new Error(result && typeof result === "object" && "error" in result ? result.error ?? "The request could not be completed." : "The request could not be completed.");
    return result as T;
  }

  async function refresh(keepPageId = selectedPage?.id, nextStatus: "active" | "archived" = status, preserveSelection = false) {
    const generation = directorySearchGeneration.current;
    const listVersion = ++pageList.current.version;
    const stillCurrent = () => generation === directorySearchGeneration.current && listVersion === pageList.current.version;
    const hide = pageList.current.hideRedirects;
    setError("");
    try {
      const [nextCategories, nextPages] = await Promise.all([
        api<Category[]>(`/api/modules/wiki/categories?status=${categoryStatus}`),
        api<WikiPage[]>(`/api/modules/wiki/pages?${new URLSearchParams({
          status: nextStatus, ...(search.trim() ? { search: search.trim() } : {}), ...(hide ? { hideRedirects: "true" } : {}),
        })}`),
      ]);
      const nextGroups = canManage ? await api<GroupOption[]>("/api/modules/wiki/groups") : null;
      if (!stillCurrent()) return;
      if (nextGroups) setGroups(nextGroups);
      setCategories(nextCategories); setPages(nextPages); setCategoriesLoaded(true);
      if (preserveSelection || categoryLandingRef.current) return;
      const keepHiddenRedirect = hide && selectedPage?.id === keepPageId && selectedPage?.status === nextStatus && Boolean(selectedPage.redirectPageId);
      const nextId = keepHiddenRedirect || nextPages.some((page) => page.id === keepPageId)
        ? keepPageId : nextPages.find((page) => page.isHomepage)?.id ?? nextPages[0]?.id;
      if (nextId) await openPage(nextId); else { setSelectedPage(null); setLinks([]); setAttachedFiles([]); }
    } catch (reason) { if (stillCurrent()) setError(reason instanceof Error ? reason.message : "Could not load Wiki pages."); }
  }

  function categoryUrl(categoryId: string) {
    const url = new URL(window.location.pathname, window.location.origin);
    url.searchParams.set("wikiCategory", categoryId);
    url.searchParams.set("wikiLocation", departmentId);
    url.hash = "module-wiki";
    return url;
  }

  function closeCategoryLanding() {
    categoryLandingRef.current = "";
    setCategoryLandingId("");
    const url = new URL(window.location.href);
    if (!url.searchParams.has("wikiCategory")) return;
    url.searchParams.delete("wikiCategory");
    if (!url.searchParams.has("wikiPage")) url.searchParams.delete("wikiLocation");
    window.history.replaceState(window.history.state, "", url);
  }

  function openCategory(categoryId: string, shareAddress = true) {
    directorySearchGeneration.current += 1;
    categoryLandingRef.current = categoryId;
    setCategoryLandingId(categoryId);
    setSelectedCategoryId(categoryId);
    setStatus("active");
    setCategoryStatus("active");
    setSelectedPage(null);
    currentPageId.current = null;
    setLinks([]);
    setAttachedFiles([]);
    setEditing(false);
    setCreating(false);
    setError("");
    if (shareAddress) {
      const url = new URL(window.location.href);
      url.searchParams.delete("wikiPage");
      url.searchParams.delete("wikiHeading");
      url.searchParams.set("wikiCategory", categoryId);
      url.searchParams.set("wikiLocation", departmentId);
      window.history.replaceState(window.history.state, "", url);
    }
  }

  async function copyCategoryLink(categoryId: string) {
    try {
      await navigator.clipboard.writeText(categoryUrl(categoryId).href);
      setFeedback("Category link copied.");
    } catch {
      setError("Could not copy the Wiki category link. Check your browser clipboard permissions.");
    }
  }

  async function copyPageLink(pageId: string, headingId?: string) {
    const url = new URL(window.location.pathname, window.location.origin);
    url.searchParams.set("wikiPage", pageId);
    url.searchParams.set("wikiLocation", departmentId);
    if (headingId) url.searchParams.set("wikiHeading", headingId);
    url.hash = "module-wiki";
    setError("");
    setFeedback("");
    try {
      await navigator.clipboard.writeText(url.href);
      setFeedback(headingId ? "Heading link copied." : "Page link copied.");
    } catch {
      setError("Could not copy the Wiki link. Check your browser clipboard permissions.");
    }
  }
  function showPage(page: WikiPage) {
    currentPageId.current = page.id;
    setSelectedPage(page);
    setTitleDraft(page.title);
    setCategoryDraft(page.categoryId);
    setRedirectDraft(page.redirectPageId ?? "");
    setAudienceDraft(page.audience);
    setAudienceGroupIdDraft(page.audienceGroupId ?? "");
    setLinks(page.links ?? []);
    setAttachedFiles(page.files ?? []);
    if (editor.current) editor.current.innerHTML = page.contentHtml;
  }

  async function openPage(id: string, visited = new Set<string>()) {
    closeCategoryLanding();
    const generation = directorySearchGeneration.current;
    if (visited.has(id)) { setError("This Wiki redirect leads to a loop."); return; }
    visited.add(id);
    try {
      const detail = await api<WikiPage>(`/api/modules/wiki/pages/${id}`);
      if (generation !== directorySearchGeneration.current) return;
      if (!canManage && detail.redirectPageId) { await openPage(detail.redirectPageId, visited); return; }
      setComparison(null);
      showPage(detail);
    } catch (reason) { if (generation === directorySearchGeneration.current) setError(reason instanceof Error ? reason.message : "Could not open Wiki page."); }
  }

  useEffect(() => {
    if (directorySearch) return;
    if (state === initialNavigationState.current && ["wikiPage", "wikiCategory"].some((key) => new URLSearchParams(window.location.search).has(key))) return;
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
    if (directorySearch) return;
    if (state === initialNavigationState.current && ["wikiPage", "wikiCategory"].some((key) => new URLSearchParams(window.location.search).has(key))) return;
    if (!/^wiki-create:\d+$/.test(state) || !canManage) return;
    setStatus("active"); setSearch(""); setSelectedCategoryId(""); setSelectedPage(null); setEditing(false);
    setDraftTitle(""); setDraftAudience("location"); setDraftAudienceGroupId(""); setError("");
    const categoryId = categories.find((category) => !category.archivedAt)?.id;
    if (categoryId) { setDraftCategory(categoryId); setCreating(true); }
    else { setDraftCategory(""); setCreating(false); setError("Create a Wiki category before creating a page."); }
  }, [state, canManage, categories]);

  useEffect(() => {
    if (!directorySearch) return;
    closeCategoryLanding();
    directorySearchGeneration.current += 1;
    sharedPageOpened.current = true;
    sharedHeading.current = null;
    setStatus("active");
    setCategoryStatus("active");
    setSearch(directorySearch.query);
    setSelectedCategoryId("");
    setBulkPageIds([]);
    setSelectedPage(null);
    setLinks([]);
    setAttachedFiles([]);
    setEditing(false);
    setCreating(false);
    setError("");
    directorySearch.onHandled(directorySearch.requestId);
  }, [directorySearch]);

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

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const pageId = params.get("wikiPage");
      const categoryId = params.get("wikiCategory");
      const locationId = params.get("wikiLocation");
      if (!sharedPageOpened.current && !pageId && categoryId) {
        if (locationId && locationId !== departmentId) {
          categoryLandingRef.current = categoryId;
          setSelectedPage(null);
          setError("Switch to the location associated with this Wiki link.");
          return;
        }
        sharedPageOpened.current = true;
        if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(categoryId)) {
          categoryLandingRef.current = categoryId;
          setSelectedPage(null);
          setError("This Wiki category is unavailable.");
          return;
        }
        openCategory(categoryId.toLowerCase(), false);
        void refresh("", "active", true);
        return;
      }
      if (!sharedPageOpened.current && pageId && /^[a-z0-9-]{1,80}$/i.test(pageId)) {
        if (locationId && locationId !== departmentId) {
          setSelectedPage(null);
          setLinks([]);
          setAttachedFiles([]);
          setError("Switch to the location associated with this Wiki link.");
          return;
        }
        sharedPageOpened.current = true;
        const id = params.get("wikiHeading");
        if (id && /^wiki-heading-[a-z0-9-]{1,80}-[a-f0-9]{16}-[1-9][0-9]{0,7}$/i.test(id)) {
          sharedHeading.current = { pageId, id };
        }
        void refresh("", "active", true);
        void openPage(pageId);
        return;
      }
      sharedPageOpened.current = true;
      void refresh("");
    }, 220);
    return () => window.clearTimeout(timer);
  }, [departmentId, status, categoryStatus, search]);
  useEffect(() => realtime?.subscribe("module:wiki:changed", () => { void refresh(undefined, status, editing || creating); }), [realtime, departmentId, status, categoryStatus, search, hideRedirects, editing, creating]);
  useEffect(() => {
    if (!selectedPage || !editor.current || editing) {
      setHeadings([]);
      return;
    }
    editor.current.innerHTML = selectedPage.contentHtml;
    const occurrences = new Map<string, number>();
    const outline = Array.from(editor.current.querySelectorAll<HTMLHeadingElement>("h1,h2,h3,h4,h5,h6"))
      .flatMap((heading) => {
        const title = heading.textContent?.trim();
        if (!title) return [];
        const fingerprint = headingFingerprint(title);
        const occurrence = (occurrences.get(fingerprint) ?? 0) + 1;
        occurrences.set(fingerprint, occurrence);
        const id = `wiki-heading-${selectedPage.id}-${fingerprint}-${occurrence}`;
        heading.id = id;
        heading.tabIndex = -1;
        return [{ id, title, level: Number(heading.tagName.slice(1)) }];
      });
    setHeadings(outline);
    const target = sharedHeading.current;
    if (target?.pageId === selectedPage.id) {
      sharedHeading.current = null;
      const heading = document.getElementById(target.id);
      if (heading && editor.current.contains(heading) && outline.some(({ id }) => id === target.id)) {
        heading.focus({ preventScroll: true });
        heading.scrollIntoView({ block: "start" });
      }
    }
  }, [selectedPage?.id, selectedPage?.contentHtml, editing]);

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true); setError(""); setFeedback("");
    try { await action(); setFeedback(success); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The request could not be completed."); }
    finally { setBusy(false); }
  }

  async function applyBulkAudience(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || busy || !bulkIds.length || !bulkAudience || (bulkAudience === "group" && !bulkGroupId)) return;
    const audienceGroupId = bulkAudience === "group" ? bulkGroupId : null;
    if (!window.confirm(`Change the audience for ${bulkIds.length} selected pages to ${audienceLabel({ audience: bulkAudience, groupId: audienceGroupId })}?`)) return;
    await run(async () => {
      await api("/api/modules/wiki/pages/bulk-audience", "POST", { pageIds: bulkIds, audience: bulkAudience, audienceGroupId });
      setBulkPageIds([]);
      await refresh();
    }, "Audience updated for selected pages.");
  }

  async function applyBulkCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const category = categories.find((item) => item.id === bulkCategoryId && !item.archivedAt);
    if (!canManage || busy || !bulkIds.length || !category) return;
    if (!window.confirm(`Move ${bulkIds.length} selected pages to ${category.name}?`)) return;
    await run(async () => {
      await api("/api/modules/wiki/pages/bulk-category", "POST", { pageIds: bulkIds, categoryId: category.id });
      setBulkPageIds([]);
      setBulkCategoryId("");
      await refresh();
    }, "Category updated for selected pages.");
  }

  async function createPage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draftCategory || !draftTitle.trim()) return;
    await run(async () => {
      const page = await api<WikiPage>("/api/modules/wiki/pages", "POST", { categoryId: draftCategory, title: draftTitle.trim(), contentHtml: "", audience: draftAudience, audienceGroupId: draftAudience === "group" ? draftAudienceGroupId : null });
      closeCategoryLanding();
      setCreating(false); setDraftTitle(""); setDraftCategory(""); setDraftAudience("location"); setDraftAudienceGroupId(""); setStatus("active"); await refresh(page.id, "active");
    }, "Wiki page created.");
  }

  function setEditBase(page: WikiPage) {
    editorBase.current = page.editRevision ? { key: draftKey, pageId: page.id, revision: page.editRevision, content: {
      title: page.title, categoryId: page.categoryId, audience: page.audience, audienceGroupId: page.audienceGroupId ?? "",
      redirectPageId: page.redirectPageId ?? "", contentHtml: editor.current?.innerHTML ?? page.contentHtml,
    } } : undefined;
  }

  function clearRecoveredDraft(key: string) {
    if (!key || discardWikiDraft(key)) {
      setStoredDraft(undefined);
      setDraftPreview(undefined);
    } else setError("Could not discard this browser draft.");
  }

  async function openEditor(draft?: WikiDraft) {
    const pageId = selectedPage?.id;
    if (!canManage || !pageId || busy) return;
    const stillCurrent = () => draftAccess.current.canManage && draftAccess.current.draftKey === draftKey
      && currentPageId.current === pageId;
    await run(async () => {
      const current = await api<WikiPage>("/api/modules/wiki/pages/" + pageId);
      if (!stillCurrent()) return;
      if (current.status !== "active" || !current.editRevision) throw new Error("This Wiki page can no longer be edited.");
      showPage(current);
      if (draft) {
        const preview = await api<{ contentHtml: string }>("/api/modules/wiki/pages/" + pageId + "/draft-preview", "POST", {
          contentHtml: draft.content.contentHtml,
        });
        if (!stillCurrent()) return;
        if (draft.baseRevision !== current.editRevision) {
          setDraftPreview({ key: draftKey, html: preview.contentHtml, title: draft.content.title });
          return;
        }
        setEditBase(current);
        setTitleDraft(draft.content.title);
        setCategoryDraft(draft.content.categoryId);
        setAudienceDraft(draft.content.audience);
        setAudienceGroupIdDraft(draft.content.audienceGroupId);
        setRedirectDraft(draft.content.redirectPageId);
        if (editor.current) editor.current.innerHTML = preview.contentHtml;
      } else setEditBase(current);
      setDraftPreview(undefined);
      setEditing(true);
    }, "");
  }

  async function savePage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPage || !editor.current || !canManage || editorBase.current?.pageId !== selectedPage.id || editorBase.current.key !== draftKey) return;
    const expectedRevision = editorBase.current.revision;
    await run(async () => {
      const page = await api<WikiPage>(`/api/modules/wiki/pages/${selectedPage.id}`, "PUT", { expectedRevision, categoryId: categoryDraft, title: titleDraft.trim(), contentHtml: editor.current!.innerHTML, redirectPageId: redirectDraft || null, audience: audienceDraft, audienceGroupId: audienceDraft === "group" ? audienceGroupIdDraft : null });
      editorBase.current = undefined;
      clearRecoveredDraft(draftKey);
      setSelectedPage({ ...selectedPage, ...page, links, files: attachedFiles }); setEditing(false); await refresh(page.id);
    }, "Page saved.");
  }

  function format(command: string, value?: string) { editor.current?.focus(); document.execCommand(command, false, value); }
  function rememberEditorRange() {
    const selection = window.getSelection();
    if (selection?.rangeCount && editor.current?.contains(selection.anchorNode)) editorRange.current = selection.getRangeAt(0).cloneRange();
  }
  function insertTable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || !editor.current) return;
    const values = new FormData(event.currentTarget);
    const rows = Number(values.get("rows"));
    const columns = Number(values.get("columns"));
    if (!Number.isInteger(rows) || rows < 1 || rows > 20 || !Number.isInteger(columns) || columns < 1 || columns > 10) return;

    const target = editorRange.current?.cloneRange();
    const selection = window.getSelection();
    editor.current.focus();
    if (target && selection && editor.current.contains(target.commonAncestorContainer)) {
      selection.removeAllRanges();
      selection.addRange(target);
    } else if (selection) {
      const end = document.createRange();
      end.selectNodeContents(editor.current);
      end.collapse(false);
      selection.removeAllRanges();
      selection.addRange(end);
    }
    const headings = Array.from({ length: columns }, (_, index) => `<th>Column ${index + 1}</th>`).join("");
    const row = `<tr>${"<td><br></td>".repeat(columns)}</tr>`;
    format("insertHTML", `<table><thead><tr>${headings}</tr></thead><tbody>${row.repeat(rows)}</tbody></table><p><br></p>`);
    rememberEditorRange();
    setShowTableForm(false);
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
  function closeEntityPicker() {
    if (pickerCreateBusy) return;
    setShowEntityLink(false);
    setPickerCreateOpen(false);
    setPickerCreateError("");
    setPickerCreateNotice("");
  }

  function startPickerPage() {
    const available = categories.filter((item) => !item.archivedAt);
    const current = available.find((item) => item.id === categoryDraft) ?? available[0];
    if (!current) return;
    setPickerPageCategory(current.id);
    setPickerPageTitle(wikiPageQuery.trim().slice(0, 180));
    setPickerCreateError("");
    setPickerCreateNotice("");
    setPickerCreateOpen(true);
  }

  async function createPickerPage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = pickerPageTitle.trim();
    const categoryId = pickerPageCategory;
    const source = selectedPage;
    const base = editorBase.current;
    if (!canManage || !editing || entityType !== "wiki" || !source || !base || pickerCreateBusy || !title
      || !categories.some((category) => category.id === categoryId && !category.archivedAt)
      || (audienceDraft === "group" && !audienceGroupIdDraft)) return;
    setPickerCreateBusy(true);
    setPickerCreateError("");
    try {
      const page = await api<WikiPage>("/api/modules/wiki/pages", "POST", {
        categoryId, title, contentHtml: "", audience: audienceDraft,
        audienceGroupId: audienceDraft === "group" ? audienceGroupIdDraft : null,
      });
      if (!draftAccess.current.canManage || currentPageId.current !== source.id || editorBase.current !== base) return;
      setEntityId(page.id);
      setEntityLabel(page.title.slice(0, 160));
      setWikiPageQuery("");
      setWikiPageMatches([]);
      setPickerCreateOpen(false);
      setPickerCreateNotice("Page created and selected. Insert the link, then save the source page when ready.");
      void refresh(source.id, status, true);
    } catch (reason) {
      setPickerCreateError(reason instanceof Error ? reason.message : "Could not create this Wiki page.");
    } finally {
      setPickerCreateBusy(false);
    }
  }

  function insertEntityLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = entityId.trim(); const label = entityLabel.trim();
    if (!id || !label || !editor.current) return;
    const anchor = document.createElement("a");
    anchor.href = entityType === "wiki" ? `#wiki:${encodeURIComponent(id)}` : `#entity:${entityType}:${encodeURIComponent(id)}`;
    anchor.dataset.entityType = entityType; anchor.dataset.entityId = id; anchor.textContent = label;
    const target = editorRange.current?.cloneRange();
    const selection = window.getSelection();
    editor.current.focus();
    if (selection) {
      if (target && editor.current.contains(target.commonAncestorContainer)) {
        selection.removeAllRanges();
        selection.addRange(target);
      } else {
        selection.selectAllChildren(editor.current);
        selection.collapseToEnd();
      }
    }
    document.execCommand("insertHTML", false, anchor.outerHTML);
    rememberEditorRange();
    setEntityId(""); setEntityLabel(""); closeEntityPicker();
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
    await run(async () => { await api(`/api/modules/wiki/categories/${category.id}`, "PUT", { name, parentId: category.parentId }); await refresh(); }, "Category saved.");
  }
  async function setCategoryPosition(category: Category) {
    const input = window.prompt("Order among sibling categories. Lower numbers appear first. Equal positions sort by name.", String(category.position));
    if (input === null) return;
    const position = Number(input);
    if (!input.trim() || !Number.isInteger(position) || position < -100000 || position > 100000) {
      setError("Enter a whole number from −100,000 to 100,000.");
      return;
    }
    if (position === category.position) return;
    await run(async () => {
      await api(`/api/modules/wiki/categories/${category.id}/position`, "PUT", { position });
      await refresh();
    }, "Category order saved.");
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
    if (!selectedPage || !editor.current || !canManage || editorBase.current?.pageId !== selectedPage.id || editorBase.current.key !== draftKey) return;
    const expectedRevision = editorBase.current.revision;
    await run(async () => {
      const page = await api<WikiPage>(`/api/modules/wiki/pages/${selectedPage.id}`, "PUT", { expectedRevision, categoryId: categoryDraft || selectedPage.categoryId, title: titleDraft || selectedPage.title, contentHtml: editor.current!.innerHTML, redirectPageId: redirectDraft || null, audience: audienceDraft, audienceGroupId: audienceDraft === "group" ? audienceGroupIdDraft : null });
      showPage({ ...selectedPage, ...page, links, files: attachedFiles });
      setEditBase(page);
      clearRecoveredDraft(draftKey);
      await refresh(page.id, status, true);
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
    if (!selectedPage || !window.confirm(`Restore version “${version.title}” from ${humanDate(version.createdAt)}? This restores the title and content under the current page audience. Category and redirect stay as currently configured. The current content will be saved in history.`)) return;
    await run(async () => { await api(`/api/modules/wiki/pages/${selectedPage.id}/versions/${version.id}/restore`, "POST", {}); setShowHistory(false); await refresh(selectedPage.id); }, "Version restored.");
  }

  function resetLinkForm() {
    setEditingLinkId(null); setLinkTitle(""); setLinkUrl(""); setLinkManagersOnly(false);
  }

  async function saveLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPage || selectedPage.status !== "active") return;
    const pageId = selectedPage.id;
    const linkId = editingLinkId;
    await run(async () => {
      const link = await api<WikiLink>(`/api/modules/wiki/pages/${pageId}/links${linkId ? `/${linkId}` : ""}`,
        linkId ? "PATCH" : "POST", { title: linkTitle.trim(), url: linkUrl.trim(), managersOnly: linkManagersOnly });
      if (currentPageId.current !== pageId) return;
      setLinks((current) => linkId ? current.map((item) => item.id === linkId ? link : item) : [...current, link]);
      resetLinkForm();
    }, linkId ? "Link updated." : "Link added.");
  }
  async function removeLink(linkId: string) {
    if (!selectedPage) return;
    await run(async () => { await api(`/api/modules/wiki/pages/${selectedPage.id}/links/${linkId}`, "DELETE"); setLinks((current) => current.filter((link) => link.id !== linkId)); }, "Link removed.");
  }
  async function uploadAndAttach(file: File) {
    if (!selectedPage || !canUpload || busy) return;
    await run(async () => {
      const pageId = selectedPage.id;
      const query = new URLSearchParams({ filename: file.name, managersOnly: String(privateUploadPageId === pageId) });
      const path = `/api/modules/wiki/pages/${pageId}`;
      const response = await fetch(`${path}/files/upload?${query}`, { method: "POST", headers: { "x-department-id": departmentId, "x-csrf-token": csrfToken, "x-resource-content-type": file.type || "application/octet-stream", "content-type": "application/vnd.smart-church.resource" }, body: await file.arrayBuffer() });
      if (!response.ok) {
        const error = await response.json().catch(() => ({})) as { error?: string; message?: string };
        throw new Error(error.message ?? error.error ?? "File upload failed.");
      }
      const next = await api<WikiPage>(path);
      if (currentPageId.current === pageId) setAttachedFiles(next.files ?? []);
    }, "Attachment uploaded and added.");
  }
  async function loadAvailableFiles() {
    if (!selectedPage) return;
    await run(async () => { setAvailableFiles(await api<WikiFile[]>(`/api/modules/wiki/pages/${selectedPage.id}/available-files`)); setAttachManagersOnly(false); setShowAttachments(true); }, "");
  }
  async function attachFile(fileId: string) {
    if (!selectedPage) return;
    await run(async () => { await api(`/api/modules/wiki/pages/${selectedPage.id}/files`, "POST", { fileId, managersOnly: attachManagersOnly }); const page = await api<WikiPage>(`/api/modules/wiki/pages/${selectedPage.id}`); setAttachedFiles(page.files ?? []); setAvailableFiles((current) => current.filter((file) => file.id !== fileId)); }, "File attached.");
  }
  async function renameAttachment(file: WikiFile) {
    if (!selectedPage || selectedPage.status !== "active") return;
    const input = window.prompt("Attachment title on this page. Leave blank to use the original file title.", file.title);
    if (input === null) return;
    const displayTitle = input.trim() || null;
    if (displayTitle === (file.displayTitle ?? null) || (file.displayTitle == null && displayTitle === file.title)) return;
    await run(async () => {
      const updated = await api<Pick<WikiFile, "title" | "displayTitle">>(
        `/api/modules/wiki/pages/${selectedPage.id}/files/${file.id}`, "PATCH", { displayTitle },
      );
      if (currentPageId.current === selectedPage.id) {
        setAttachedFiles((current) => current.map((attachment) => attachment.id === file.id ? { ...attachment, ...updated } : attachment));
      }
    }, displayTitle ? "Attachment renamed." : "Original attachment title restored.");
  }

  async function updateAttachmentVisibility(file: WikiFile) {
    if (!selectedPage || selectedPage.status !== "active" || !canManage) return;
    const managersOnly = !file.managersOnly;
    await run(async () => {
      const updated = await api<Pick<WikiFile, "managersOnly">>(
        `/api/modules/wiki/pages/${selectedPage.id}/files/${file.id}`, "PATCH", { managersOnly },
      );
      if (currentPageId.current === selectedPage.id) {
        setAttachedFiles((current) => current.map((attachment) => attachment.id === file.id ? { ...attachment, ...updated } : attachment));
      }
    }, managersOnly ? "Attachment restricted to Wiki managers." : "Attachment visible to page readers.");
  }

  async function detachFile(fileId: string) {
    if (!selectedPage) return;
    await run(async () => { await api(`/api/modules/wiki/pages/${selectedPage.id}/files/${fileId}`, "DELETE"); setAttachedFiles((current) => current.filter((file) => file.id !== fileId)); }, "File detached.");
  }

  function renderCategory(category: Category, depth: number) {
    return <div className="wiki-category-row" key={category.id} style={{ paddingInlineStart: `${Math.min(depth, 6) * .8}rem` }}>{parentCategories.has(category.id) && <button className="wiki-category-toggle" type="button" aria-expanded={!collapsedCategories.has(category.id)} aria-label={`${collapsedCategories.has(category.id) ? "Expand" : "Collapse"} ${category.name}`} onClick={() => setCollapsedCategories((current) => { const next = new Set(current); if (next.has(category.id)) next.delete(category.id); else next.add(category.id); return next; })}>{collapsedCategories.has(category.id) ? <ChevronRight size={15} /> : <ChevronDown size={15} />}</button>}<button className={`wiki-category-item ${depth ? "wiki-category-child" : ""}`} type="button" aria-current={selectedCategoryId === category.id} onClick={() => {
        if (category.archivedAt) setSelectedCategoryId(selectedCategoryId === category.id ? "" : category.id);
        else openCategory(category.id);
      }}><BookOpenText size={14} />{category.name}</button>{canManage && <details className="wiki-category-menu"><summary aria-label={`Actions for ${category.name}`}>···</summary><div>{categoryStatus === "active" ? <><button type="button" onClick={() => void addSubcategory(category)}>Add subcategory</button><button type="button" onClick={() => void renameCategory(category)}>Rename</button><button type="button" disabled={busy} onClick={() => void setCategoryPosition(category)}>Set sort order</button><button type="button" onClick={() => void archiveCategory(category)}>Archive</button></> : <button type="button" onClick={() => void restoreCategory(category)}>Restore</button>}</div></details>}</div>;
  }

  function goToWikiHome() {
    closeCategoryLanding();
    const needsRefresh = status !== "active" || categoryStatus !== "active" || search !== "";
    setStatus("active");
    setCategoryStatus("active");
    setSearch("");
    setSelectedCategoryId("");
    setEditing(false);
    setCreating(false);
    if (!needsRefresh) void refresh("");
  }

  return <div className={`wiki-page ${pageLayout !== "list" ? "wiki-page-gallery-layout" : ""}`}>
    <aside className="wiki-panel" aria-label="Wiki categories">
      <div className="wiki-panel-head"><h2>Categories</h2><div className="wiki-actions"><select className="wiki-select" aria-label="Category status" value={categoryStatus} onChange={(event) => { closeCategoryLanding(); setCategoryStatus(event.target.value as "active" | "archived"); setSelectedCategoryId(""); }}><option value="active">Active</option><option value="archived">Archived</option></select>{canManage && categoryStatus === "active" && <button className="button button-secondary" type="button" title="Create category" onClick={() => setShowNewCategory(true)}><Plus size={15} /></button>}</div></div>
      <button type="button" className="wiki-category-item" disabled={busy || editing || creating} onClick={goToWikiHome}>Wiki home</button>
      {categoryStatus === "active" && <button type="button" className={`wiki-category-item ${!selectedCategoryId ? "wiki-category-selected" : ""}`} onClick={() => categoryLandingRef.current ? goToWikiHome() : setSelectedCategoryId("")}>All pages</button>}
      <div className="wiki-category-list">{visibleCategories.map(({ category, depth }) => renderCategory(category, depth))}</div>
      {!categories.length && <p className="wiki-empty">No categories yet. Create a category to organize pages.</p>}
      {canManage && <button className="button button-primary" type="button" onClick={() => { setDraftCategory(selectedCategoryId || categories[0]?.id || ""); setDraftTitle(""); setCreating(true); }} disabled={!categories.length}><FilePlus2 size={15} /> New page</button>}
    </aside>

    <aside className="wiki-panel" aria-label="Wiki pages">
      <div className="wiki-panel-head"><h2>Pages</h2><select className="wiki-select" aria-label="Page status" value={status} onChange={(event) => setStatus(event.target.value as "active" | "archived")}><option value="active">Active</option><option value="archived">Archived</option></select></div>
      <label className="wiki-search"><Search size={14} /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search pages" aria-label="Search Wiki pages" /></label>
      <label className="wiki-redirect-filter"><input type="checkbox" checked={hideRedirects} onChange={(event) => {
        const next = event.target.checked;
        pageList.current.hideRedirects = next;
        setHideRedirects(next);
        void refresh(selectedPage?.id, status, true);
      }} /> Hide redirects</label>
      {canManage && status === "active" && !editing && !creating && <form className="wiki-bulk-audience" onSubmit={applyBulkAudience}>
        <label>Audience for selected pages<select className="wiki-select" value={bulkAudience} onChange={(event) => setBulkAudience(event.target.value as WikiAudience | "")}>
          <option value="">Choose an audience</option><option value="location">Everyone in this location</option><option value="group">Members of one group</option><option value="managers">Wiki managers only</option>
        </select></label>
        {bulkAudience === "group" && <label>Group<select className="wiki-select" required value={bulkGroupId} onChange={(event) => setBulkGroupId(event.target.value)}>
          <option value="">Choose a group</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
        </select></label>}
        <button className="button button-secondary" type="submit" disabled={busy || !bulkIds.length || !bulkAudience || (bulkAudience === "group" && !bulkGroupId)}>Apply to {bulkIds.length} selected</button>
      </form>}
      {canManage && status === "active" && !editing && !creating && bulkIds.length > 0 && <form className="wiki-bulk-audience" onSubmit={applyBulkCategory}>
        <label>Category for selected pages<select className="wiki-select" value={bulkCategoryId} onChange={(event) => setBulkCategoryId(event.target.value)}>
          <option value="">Choose a category</option>
          {categories.filter((category) => !category.archivedAt).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select></label>
        <button className="button button-secondary" type="submit" disabled={busy || !bulkCategoryId}>Move {bulkIds.length} selected</button>
      </form>}
      <div className="wiki-page-layout" role="group" aria-label="Wiki page layout">
        <button className="button button-secondary" type="button" aria-pressed={pageLayout === "list"} onClick={() => setPageLayout("list")}>List</button>
        <button className="button button-secondary" type="button" aria-pressed={pageLayout === "table"} onClick={() => setPageLayout("table")}>Table</button>
        <button className="button button-secondary" type="button" aria-pressed={pageLayout === "gallery"} onClick={() => setPageLayout("gallery")}>Gallery</button>
      </div>
      {pageLayout === "table" ? <div className="wiki-index">
        <div className="wiki-index-controls">
          <label>Sort by <select className="wiki-select" value={tableSort} onChange={(event) => setTableSort(event.target.value)}>
            <option value="updated-desc">Most recently updated</option>
            <option value="updated-asc">Least recently updated</option>
            <option value="title">Title</option>
            <option value="category">Category</option>
          </select></label>
          <details><summary>Columns</summary>
            {(["category", "updated", "editor", "status"] as const).map((column) => <label key={column}>
              <input type="checkbox" checked={tableColumns[column]} onChange={(event) => {
                const checked = event.target.checked;
                setTableColumns((columns) => ({ ...columns, [column]: checked }));
              }} /> {({ category: "Category", updated: "Updated", editor: "Editor", status: "Status" })[column]}
            </label>)}
          </details>
        </div>
        {tablePages.length > 0 && <div className="wiki-index-scroll"><table aria-label="Wiki page index">
          <thead><tr>
            {canManage && status === "active" && !editing && !creating && <th scope="col">Select</th>}
            <th scope="col">Title</th>
            {tableColumns.category && <th scope="col">Category</th>}
            {tableColumns.updated && <th scope="col">Updated</th>}
            {tableColumns.editor && <th scope="col">Editor</th>}
            {tableColumns.status && <th scope="col">Status</th>}
          </tr></thead>
          <tbody>{tablePages.map((page) => <tr key={page.id}>
            {canManage && status === "active" && !editing && !creating && <td>{pageSelection(page)}</td>}
            <td><button type="button" className={`wiki-index-title ${selectedPage?.id === page.id ? "wiki-page-item-selected" : ""}`} aria-current={selectedPage?.id === page.id} onClick={() => { setEditing(false); void openPage(page.id); }}>{page.isHomepage ? "⌂ " : ""}{page.title}</button></td>
            {tableColumns.category && <td>{categoryNames.get(page.categoryId) ?? "—"}</td>}
            {tableColumns.updated && <td>{humanDate(page.updatedAt)}</td>}
            {tableColumns.editor && <td>{page.editorName ?? "—"}</td>}
            {tableColumns.status && <td>{page.status === "archived" ? "Archived" : page.redirectPageId ? "Redirect" : "Active"}</td>}
          </tr>)}</tbody>
        </table></div>}
      </div> :
      <div className={pageLayout === "gallery" ? "wiki-page-list wiki-page-gallery" : "wiki-page-list"}>{visiblePages.map((page) => <div className="wiki-bulk-page-row" key={page.id}>{pageSelection(page)}<button type="button" className={`wiki-page-item ${selectedPage?.id === page.id ? "wiki-page-item-selected" : ""} ${page.status === "archived" ? "wiki-page-archived" : ""}`} aria-current={selectedPage?.id === page.id} onClick={() => { setEditing(false); void openPage(page.id); }}>{pageLayout === "gallery" && <FileText className="wiki-page-gallery-icon" size={24} aria-hidden="true" />}<strong>{page.isHomepage ? "⌂ " : ""}{page.title}</strong>{pageLayout === "gallery" && <small>{categoryNames.get(page.categoryId) ?? "Wiki page"}{page.status === "archived" ? " · Archived" : ""}{page.redirectPageId ? " · Redirect" : ""}</small>}<small>{humanDate(page.updatedAt)}{page.editorName ? ` · ${page.editorName}` : ""}</small></button></div>)}</div>}
      {!visiblePages.length && <p className="wiki-empty">{search ? "No pages match your search." : "No pages in this view."}</p>}
    </aside>

    {!editing && !creating && selectedPage && createPortal(
      <article className="wiki-print-document">
        <h1>{selectedPage.title}</h1>
        <p className="wiki-print-updated">Updated {humanDate(selectedPage.updatedAt)}</p>
        <div className="wiki-print-content" dangerouslySetInnerHTML={{ __html: selectedPage.contentHtml }} />
      </article>,
      document.body,
    )}

    <main className="wiki-editor">
      {error && <div role="alert" className="wiki-error">{error}</div>}{feedback && <div role="status" className="wiki-feedback">{feedback}</div>}
      {!editing && !creating && recoveredDraft && <section className="wiki-feedback" aria-label="Recover Wiki draft">
        <p>Unsaved draft from {humanDate(new Date(recoveredDraft.savedAt).toISOString())}.</p>
        <div className="wiki-actions">
          <button type="button" className="button button-secondary" disabled={busy}
            onClick={() => void openEditor(recoveredDraft)}>{recoveredDraft.baseRevision === selectedPage?.editRevision ? "Restore draft" : "Review draft"}</button>
          <button type="button" className="button button-quiet" disabled={busy} onClick={() => clearRecoveredDraft(draftKey)}>Discard draft</button>
        </div>
        {draftPreview?.key === draftKey && <div>
          <p>The published page changed. Compare your draft below with the published page. Copy any text you want to keep before discarding the draft.</p>
          <h3>{draftPreview.title}</h3>
          <div className="wiki-content" dangerouslySetInnerHTML={{ __html: draftPreview.html }} />
        </div>}
      </section>}
      {editing && draftStorageFailed && <p role="status">This draft could not be stored in this browser.</p>}
      {creating ? <form onSubmit={createPage} className="wiki-create-form"><div className="wiki-editor-header"><div><span className="wiki-muted">NEW WIKI PAGE</span><h2>Create a page</h2></div><button className="button button-quiet" type="button" onClick={() => setCreating(false)} aria-label="Cancel"><X size={17} /></button></div><label>Title<input autoFocus className="wiki-title-input" maxLength={180} value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} required /></label><label>Category<select className="wiki-select" value={draftCategory} onChange={(event) => setDraftCategory(event.target.value)} required><option value="">Select category</option>{flatCategories.map(({ category, depth }) => <option key={category.id} value={category.id}>{"— ".repeat(depth)}{category.name}</option>)}</select></label><label>Who can read this page?<select className="wiki-select" value={draftAudience} onChange={(event) => { setDraftAudience(event.target.value as WikiAudience); if (event.target.value !== "group") setDraftAudienceGroupId(""); }}><option value="location">Everyone in this location</option><option value="group">Members of one group</option><option value="managers">Wiki managers only</option></select></label>{draftAudience === "group" && <label>Group<select className="wiki-select" required value={draftAudienceGroupId} onChange={(event) => setDraftAudienceGroupId(event.target.value)}><option value="">Choose a group</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>}<div className="wiki-actions"><button className="button button-primary" type="submit" disabled={busy || !draftTitle.trim() || !draftCategory || (draftAudience === "group" && !draftAudienceGroupId)}><Plus size={15} /> Create page</button></div></form>
      : categoryLandingId ? <WikiCategoryLanding key={departmentId + ":" + categoryLandingId} departmentId={departmentId}
        category={categories.find((category) => category.id === categoryLandingId && !category.archivedAt)}
        categoriesLoaded={categoriesLoaded} revision={pageList.current.version} children={categories.filter((category) => category.parentId === categoryLandingId && !category.archivedAt)}
        onOpenCategory={openCategory} onOpenPage={(id) => void openPage(id)} onCopy={() => void copyCategoryLink(categoryLandingId)} />
      : selectedPage ? <>
        <div className="wiki-editor-header"><div><span className="wiki-muted">{status === "archived" ? "ARCHIVED WIKI PAGE" : "WIKI PAGE"}</span>{editing ? <input className="wiki-title-input" maxLength={180} value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} aria-label="Page title" /> : <h1>{selectedPage.isHomepage ? "⌂ " : ""}{selectedPage.title}</h1>}<p className="wiki-muted">{categories.find((category) => category.id === (editing ? categoryDraft : selectedPage.categoryId))?.name ?? "Uncategorized"} · Audience: {selectedPage.audience === "group" ? `Group · ${groups.find((group) => group.id === selectedPage.audienceGroupId)?.name ?? "selected group"}` : selectedPage.audience === "managers" ? "Wiki managers only" : "Everyone in this location"} · Updated {humanDate(selectedPage.updatedAt)}{selectedPage.editorName ? ` by ${selectedPage.editorName}` : ""}</p></div><div className="wiki-actions">{!editing && selectedPage.status === "active" && <button className="button button-secondary" type="button" onClick={() => void copyPageLink(selectedPage.id)}><Copy size={15} /> Copy page link</button>}{!editing && <button className="button button-secondary" type="button" onClick={() => window.print()}><Printer size={15} /> Print page</button>}<a className="button button-secondary" href={`/api/modules/wiki/pages/${selectedPage.id}/export/html`} target="_blank" rel="noreferrer"><ArrowDownToLine size={15} /> HTML</a><a className="button button-secondary" href={`/api/modules/wiki/pages/${selectedPage.id}/export/pdf`}><ArrowDownToLine size={15} /> PDF</a>{canManage && status === "active" && !editing && <><button className="button button-primary" type="button" disabled={busy || Boolean(recoveredDraft)} onClick={() => void openEditor()}><Pencil size={15} /> Edit</button><button className="button button-secondary" type="button" onClick={() => void setHomepage()}>{selectedPage.isHomepage ? "Unset homepage" : "Set homepage"}</button></>}{canManage && editing && <button className="button button-primary" type="button" onClick={(event) => { event.preventDefault(); void savePage(new Event("submit") as unknown as FormEvent<HTMLFormElement>); }} disabled={busy || !titleDraft.trim() || (audienceDraft === "group" && !audienceGroupIdDraft)}><Save size={15} /> Save</button>}{canManage && editing && <button type="button" className="button button-secondary" disabled={busy}
          onClick={() => { editorBase.current = undefined; setEditing(false); void openPage(selectedPage.id); }}>Close editor</button>}{canManage && <button className="button button-secondary" type="button" onClick={() => void openHistory()}><History size={15} /> History</button>}{canManage && status === "active" && !editing && <button className="button button-secondary" type="button" onClick={() => void archivePage()}><Archive size={15} /> Archive</button>}{canManage && status === "archived" && <button className="button button-secondary" type="button" onClick={() => void restorePage()}><RotateCcw size={15} /> Restore</button>}</div></div>
        {editing && <><label className="wiki-field-label">Category<select className="wiki-select" value={categoryDraft} onChange={(event) => setCategoryDraft(event.target.value)}>{flatCategories.map(({ category, depth }) => <option key={category.id} value={category.id}>{"— ".repeat(depth)}{category.name}</option>)}</select></label><label className="wiki-field-label">Who can read this page?<select className="wiki-select" value={audienceDraft} onChange={(event) => { setAudienceDraft(event.target.value as WikiAudience); if (event.target.value !== "group") setAudienceGroupIdDraft(""); }}><option value="location">Everyone in this location</option><option value="group">Members of one group</option><option value="managers">Wiki managers only</option></select></label>{audienceDraft === "group" && <label className="wiki-field-label">Group<select className="wiki-select" required value={audienceGroupIdDraft} onChange={(event) => setAudienceGroupIdDraft(event.target.value)}><option value="">Choose a group</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>}<div className="wiki-toolbar" role="toolbar" aria-label="Page formatting"><button type="button" title="Bold" onClick={() => format("bold")}><strong>B</strong></button><button type="button" title="Italic" onClick={() => format("italic")}><em>I</em></button><button type="button" title="Strikethrough" onClick={() => format("strikeThrough")}><s>S</s></button><button type="button" title="Code" onClick={() => format("formatBlock", "pre")}><code>Code</code></button><button type="button" title="Heading" onClick={() => format("formatBlock", "h2")}>H2</button><button type="button" title="Bulleted list" onClick={() => format("insertUnorderedList")}>• List</button><button type="button" title="Numbered list" onClick={() => format("insertOrderedList")}>1. List</button><button type="button" title="Insert link" onClick={() => { const url = window.prompt("Link URL"); if (url) format("createLink", url); }}><Link2 size={15} /> Link</button><button type="button" title="Add typed link" onMouseDown={rememberEditorRange} onClick={() => { setPickerCreateOpen(false); setPickerCreateNotice(""); setShowEntityLink(true); }}>@ Entity</button><button type="button" title="Insert inline image" disabled={!inlineImageFiles.length} onMouseDown={rememberEditorRange} onClick={() => setShowInlineImages(true)}><ImagePlus size={15} /> Image</button><button type="button" aria-expanded={showTableForm} aria-controls={showTableForm ? "wiki-insert-table" : undefined} onMouseDown={rememberEditorRange} onClick={() => setShowTableForm((open) => !open)}>Table</button><button type="button" title="Insert divider" onClick={() => format("insertHorizontalRule")}>Divider</button><button type="button" title="Undo" onClick={() => format("undo")}>Undo</button><button type="button" title="Redo" onClick={() => format("redo")}>Redo</button></div>{!inlineImageFiles.length && <p className="wiki-muted">Attach a JPEG, PNG, or WebP image (up to 2 MB) to this page to insert it inline.</p>}</>}
        {!editing && headings.length > 0 && <details className="wiki-contents">
          <summary>Table of contents</summary>
          <nav aria-label="Wiki table of contents">
            <ul>{headings.map(({ id, title, level }) => (
              <li key={id} style={{ marginInlineStart: `${(level - 1) * 0.75}rem` }}>
                <a href={`#${id}`} onClick={(event) => {
                  event.preventDefault();
                  const heading = document.getElementById(id);
                  heading?.focus({ preventScroll: true });
                  heading?.scrollIntoView({ block: "start" });
                }}>{title}</a>
                {selectedPage.status === "active" && (
                  <button className="button button-quiet" type="button" aria-label={`Copy link to ${title}`} title="Copy heading link" onClick={() => void copyPageLink(selectedPage.id, id)}>
                    <Copy size={14} />
                  </button>
                )}
              </li>
            ))}</ul>
          </nav>
        </details>}
        {editing && showTableForm && <form id="wiki-insert-table" className="wiki-toolbar" aria-label="Insert table" onSubmit={insertTable} onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setShowTableForm(false);
            editor.current?.focus();
          }
        }}>
          <label>Body rows <input autoFocus name="rows" type="number" min={1} max={20} defaultValue={2} required /></label>
          <label>Columns <input name="columns" type="number" min={1} max={10} defaultValue={2} required /></label>
          <button type="submit">Insert table</button>
          <button type="button" onClick={() => { setShowTableForm(false); editor.current?.focus(); }}>Cancel</button>
        </form>}
        <div ref={editor} className="wiki-content" onClick={followWikiEntityLink} onMouseUp={rememberEditorRange} onKeyUp={rememberEditorRange} onBlur={rememberEditorRange} contentEditable={editing && canManage} suppressContentEditableWarning role={editing ? "textbox" : undefined} aria-label="Wiki page content" aria-multiline={editing} data-placeholder="Write your page content here. Use the toolbar for formatting and entity links." />
        {selectedPage.redirectPageId && <p className="wiki-muted">This page redirects to <button className="button button-quiet" type="button" onClick={() => { setEditing(false); void openPage(selectedPage.redirectPageId!); }}>{pages.find((page) => page.id === selectedPage.redirectPageId)?.title ?? "another Wiki page"}</button>.</p>}
        {editing && <div className="wiki-redirect-editor"><label>Redirect to Wiki page<select className="wiki-input" value={redirectDraft} onChange={(event) => setRedirectDraft(event.target.value)}><option value="">No redirect</option>{pages.filter((page) => page.status === "active" && page.id !== selectedPage.id).map((page) => <option key={page.id} value={page.id}>{page.title}</option>)}</select></label><button className="button button-secondary" type="button" disabled={busy} onClick={() => void updateRedirect()}>Save redirect</button></div>}
        <label className="wiki-search"><Search size={14} /><input type="search" value={detailsSearch} onChange={(event) => setDetailsSearch(event.target.value)}
          placeholder="Search files and links" aria-label="Search files and links" maxLength={160} /></label>
        <div className="wiki-detail-sections"><section className="wiki-detail-section"><div className="wiki-panel-head"><h3>Links</h3><label>Sort <select value={linkSort} onChange={(event) => setLinkSort(event.target.value === "title" ? "title" : "added")}><option value="added">Newest first</option><option value="title">Title</option></select></label></div>{canManage && status === "active" && <form className="wiki-add-link" onSubmit={saveLink}><input className="wiki-input" aria-label="Link title" value={linkTitle} onChange={(event) => setLinkTitle(event.target.value)} placeholder="Link title" maxLength={160} required /><input className="wiki-input" inputMode="url" aria-label="Link address" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="https://…" maxLength={2000} required />
          <label><input type="checkbox" checked={linkManagersOnly} disabled={busy} onChange={(event) => setLinkManagersOnly(event.target.checked)} /> Wiki managers only</label>
          <button className="button button-secondary" type="submit" disabled={busy}>{editingLinkId ? <><Save size={14} /> Save link</> : <><Plus size={14} /> Add link</>}</button>{editingLinkId && <button className="button button-quiet" type="button" disabled={busy} onClick={resetLinkForm}>Cancel</button>}</form>}{[...filteredLinks].sort((a,b) => linkSort === "title" ? a.title.localeCompare(b.title) : (b.created_at ?? "").localeCompare(a.created_at ?? "")).map((link) => <div className="wiki-link-row" key={link.id}><a href={link.url} target="_blank" rel="noreferrer">{link.title}</a>{link.created_at && <small className="wiki-file-meta">{humanDate(link.created_at)}</small>}
        {link.managers_only && <small className="wiki-file-meta">Wiki managers only</small>}<WikiLinkCopyActions key={link.url} url={link.url} title={link.title} />{canManage && status === "active" && <div className="wiki-actions"><button type="button" className="button button-quiet" disabled={busy} onClick={() => {
          setEditingLinkId(link.id); setLinkTitle(link.title); setLinkUrl(link.url); setLinkManagersOnly(Boolean(link.managers_only));
        }} aria-label={`Edit ${link.title}`}><Pencil size={14} /> Edit</button><button type="button" className="button button-quiet" onClick={() => void removeLink(link.id)} aria-label={`Remove ${link.title}`}><Trash2 size={14} /></button></div>}</div>)}{!filteredLinks.length && <p className="wiki-muted">{detailQuery ? "No links match the search." : "No links attached."}</p>}</section>
        <section className="wiki-detail-section"><div className="wiki-panel-head"><h3>Files</h3><div className="wiki-actions"><label>Sort files <select value={fileSort} onChange={(event) => setFileSort(event.target.value as FileSort)}>
          <option value="added">Newest first</option><option value="title">Attachment title</option><option value="name">File name</option><option value="uploader">Attached by</option>
        </select></label>{canUpload && <button className="button button-quiet" type="button" disabled={busy} onClick={() => filePicker.current?.click()} title="Upload file"><Plus size={14} /> Upload</button>}{canManage && <button className="button button-quiet" type="button" onClick={() => void loadAvailableFiles()} title="Attach an existing file"><FileText size={14} /> Attach</button>}<input ref={filePicker} hidden type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadAndAttach(file); event.currentTarget.value = ""; }} /></div></div>
          {canUpload && <>
            <label><input type="checkbox" disabled={busy} checked={privateUploadPageId === selectedPage.id}
              onChange={(event) => setPrivateUploadPageId(event.target.checked ? selectedPage.id : undefined)} /> Make uploads visible to Wiki managers only</label>
            <div
              className="wiki-file-drop-zone"
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes("Files")) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = busy ? "none" : "copy";
              }}
              onDrop={(event) => {
                if (!event.dataTransfer.types.includes("Files")) return;
                event.preventDefault();
                if (busy) return;
                const files = event.dataTransfer.files;
                if (files.length > 1) {
                  setError("Drop one file at a time.");
                  return;
                }
                if (files[0]) void uploadAndAttach(files[0]);
              }}
            >
              Drop a file here to attach it to this page.
            </div>
          </>}
          {visibleFiles.map((file) => <div className="wiki-file-row" key={file.id}><span><a href={`/api/modules/wiki/pages/${selectedPage.id}/files/${file.id}/download`} target="_blank" rel="noreferrer">{file.title}</a><small className="wiki-file-meta"> · {file.fileName} · {sizeLabel(file.fileSize)} · {humanDate(file.attachedAt ?? file.createdAt)}{file.attachedByName ? ` · Attached by ${file.attachedByName}` : ""}{file.managersOnly ? " · Wiki managers only" : ""}</small></span>{canManage && <div className="wiki-actions">{selectedPage.status === "active" && <button type="button" className="button button-quiet" disabled={busy} onClick={() => void renameAttachment(file)} aria-label={`Rename ${file.title}`}><Pencil size={14} /> Rename</button>}{selectedPage.status === "active" && <button type="button" className="button button-quiet" disabled={busy} onClick={() => void updateAttachmentVisibility(file)} aria-label={`${file.managersOnly ? "Share with page readers" : "Restrict to Wiki managers"}: ${file.title}`}>{file.managersOnly ? "Share with page readers" : "Restrict to Wiki managers"}</button>}<button type="button" className="button button-quiet" onClick={() => void detachFile(file.id)} aria-label={`Remove ${file.title}`}><X size={14} /></button></div>}</div>)}{!filteredFiles.length && <p className="wiki-muted">{detailQuery ? "No files match the search." : "No files attached."}</p>}
          {lastFilePage > 0 && <nav className="wiki-actions" aria-label="Attached files pages">
            <button type="button" className="button button-quiet" disabled={filePage === 0} onClick={() => setFilePageIndex(filePage - 1)}>Previous</button>
            <span role="status">{firstFileIndex + 1}–{firstFileIndex + visibleFiles.length} of {filteredFiles.length}</span>
            <button type="button" className="button button-quiet" disabled={filePage === lastFilePage} onClick={() => setFilePageIndex(filePage + 1)}>Next</button>
          </nav>}</section></div>
      </> : <div className="wiki-empty"><BookOpenText size={28} /><h2>Welcome to Wiki</h2><p>Choose a page to read or create the first page for this location.</p>{canManage && categories.length > 0 && <button className="button button-primary" type="button" onClick={() => { setDraftCategory(selectedCategoryId || categories[0].id); setCreating(true); }}><Plus size={15} /> Create a page</button>}</div>}
    </main>

    {showHistory && <div className="wiki-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowHistory(false); }}><section className="wiki-modal" role="dialog" aria-modal="true" aria-labelledby="wiki-history-title"><div className="wiki-panel-head"><div><span className="wiki-muted">VERSION HISTORY</span><h2 id="wiki-history-title">{selectedPage?.title}</h2></div><button className="button button-quiet" type="button" onClick={() => setShowHistory(false)} aria-label="Close history"><X size={18} /></button></div>{canManage && versions.length > 1 && <div className="wiki-version-compare-controls"><label>Compare revision<select value={compareLeftId} onChange={(change) => setCompareLeftId(change.target.value)}>{versions.map((version) => <option key={version.id} value={version.id}>{version.title} · {humanDate(version.createdAt)}</option>)}</select></label><span>with</span><label>Revision<select value={compareRightId} onChange={(change) => setCompareRightId(change.target.value)}>{versions.map((version) => <option key={version.id} value={version.id}>{version.title} · {humanDate(version.createdAt)}</option>)}</select></label><button className="button button-primary" type="button" disabled={!compareLeftId || !compareRightId || compareLeftId === compareRightId || busy} onClick={() => void compareVersions()}><FileText size={14} /> Compare</button></div>}{versions.map((version) => <div className="wiki-version-item" key={version.id}><div><strong>{version.title}</strong><small className="wiki-muted">{humanDate(version.createdAt)}{version.editorName ? ` · ${version.editorName}` : ""}</small>{version.audienceChange && <small className="wiki-muted">Audience changed from {audienceLabel(version.audienceChange.from)} to {audienceLabel(version.audienceChange.to)}</small>}{version.categoryChange && <small className="wiki-muted">Category moved from {version.categoryChange.from.name} to {version.categoryChange.to.name}</small>}{version.redirectChange && <small className="wiki-muted">Redirect {version.redirectChange.from ? (version.redirectChange.to ? "changed" : "removed") : "added"}</small>}</div><div className="wiki-actions"><button className="button button-secondary" type="button" onClick={() => setPreviewVersion(version)}><FileText size={14} /> Preview</button><button className="button button-secondary" type="button" onClick={() => void restoreVersion(version)}><RotateCcw size={14} /> Restore</button></div></div>)}{!versions.length && <p className="wiki-empty">No saved versions yet.</p>}</section></div>}
    {comparison && <div className="wiki-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setComparison(null)}><section className="wiki-modal wiki-version-comparison" role="dialog" aria-modal="true" aria-labelledby="wiki-version-comparison-title"><div className="wiki-panel-head"><div><span className="wiki-muted">MANAGER REVISION COMPARISON</span><h2 id="wiki-version-comparison-title">{selectedPage?.title}</h2></div><button className="button button-quiet" type="button" onClick={() => setComparison(null)} aria-label="Close revision comparison"><X size={18} /></button></div><div className="wiki-version-comparison-columns">{([comparison.left, comparison.right] as const).map((version, index) => <section className="wiki-version-comparison-column" key={version.id}><header><strong>{index === 0 ? "Selected revision" : "Compared revision"}</strong><span>{version.title}</span><small className="wiki-muted">{humanDate(version.createdAt)}{version.editorName ? ` · ${version.editorName}` : ""}</small></header><article className="wiki-version-preview-content" dangerouslySetInnerHTML={{ __html: version.contentHtml }} /></section>)}</div><div className="wiki-modal-actions"><button className="button button-secondary" type="button" onClick={() => setComparison(null)}>Close comparison</button></div></section></div>}
    {previewVersion && <div className="wiki-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setPreviewVersion(null)}><section className="wiki-modal wiki-version-preview" role="dialog" aria-modal="true" aria-labelledby="wiki-version-preview-title"><div className="wiki-panel-head"><div><span className="wiki-muted">READ-ONLY REVISION PREVIEW · {humanDate(previewVersion.createdAt)}</span><h2 id="wiki-version-preview-title">{previewVersion.title}</h2><small className="wiki-muted">{previewVersion.editorName ? `Saved by ${previewVersion.editorName}` : "Saved revision"}</small></div><button className="button button-quiet" type="button" onClick={() => setPreviewVersion(null)} aria-label="Close revision preview"><X size={18} /></button></div><article className="wiki-version-preview-content" dangerouslySetInnerHTML={{ __html: previewVersion.contentHtml }} /><div className="wiki-modal-actions"><button className="button button-secondary" type="button" onClick={() => setPreviewVersion(null)}>Close preview</button>{canManage && <button className="button button-primary" type="button" onClick={() => { const version = previewVersion; setPreviewVersion(null); void restoreVersion(version); }}><RotateCcw size={14} /> Restore this version</button>}</div></section></div>}
    {showAttachments && <div className="wiki-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowAttachments(false); }}><section className="wiki-modal" role="dialog" aria-modal="true" aria-labelledby="wiki-files-title"><div className="wiki-panel-head"><h2 id="wiki-files-title">Attach a stored file</h2><button className="button button-quiet" type="button" onClick={() => setShowAttachments(false)} aria-label="Close"><X size={18} /></button></div><label><input type="checkbox" checked={attachManagersOnly} onChange={(event) => setAttachManagersOnly(event.target.checked)} disabled={busy} /> Wiki managers only</label>{availableFiles.map((file) => <div className="wiki-file-row" key={file.id}><span><strong>{file.title}</strong><small className="wiki-file-meta"> · {file.fileName} · {sizeLabel(file.fileSize)}</small></span><button className="button button-secondary" type="button" disabled={busy} onClick={() => void attachFile(file.id)}><Plus size={14} /> Attach</button></div>)}{!availableFiles.length && <p className="wiki-empty">No other files are available in this location.</p>}</section></div>}
    {showInlineImages && <div className="wiki-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowInlineImages(false); }}><section className="wiki-modal" role="dialog" aria-modal="true" aria-labelledby="wiki-inline-images-title"><div className="wiki-panel-head"><h2 id="wiki-inline-images-title">Insert inline image</h2><button className="button button-quiet" type="button" onClick={() => setShowInlineImages(false)} aria-label="Close"><X size={18} /></button></div><p className="wiki-muted">Choose a JPEG, PNG, or WebP image already attached to this page. Readers can load it only if they can read this page.</p>{inlineImageFiles.map((file) => <div className="wiki-file-row" key={file.id}><span><strong>{file.title}</strong><small className="wiki-file-meta"> · {file.fileName} · {sizeLabel(file.fileSize)}</small></span><button className="button button-secondary" type="button" onClick={() => insertInlineImage(file)}><ImagePlus size={14} /> Insert</button></div>)}{!inlineImageFiles.length && <p className="wiki-empty">Attach a JPEG, PNG, or WebP image no larger than 2 MB before inserting it inline.</p>}</section></div>}
    {showNewCategory && <div className="wiki-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowNewCategory(false); }}><form className="wiki-modal" role="dialog" aria-modal="true" aria-labelledby="wiki-category-title" onSubmit={addCategory}><div className="wiki-panel-head"><h2 id="wiki-category-title">Create category</h2><button className="button button-quiet" type="button" onClick={() => setShowNewCategory(false)} aria-label="Close"><X size={18} /></button></div><label>Category name<input autoFocus className="wiki-input" maxLength={120} value={categoryName} onChange={(event) => setCategoryName(event.target.value)} required /></label><label>Parent category<select className="wiki-select" value={categoryParentId} onChange={(event) => setCategoryParentId(event.target.value)}><option value="">No parent</option>{flatCategories.map(({ category, depth }) => <option key={category.id} value={category.id}>{"— ".repeat(depth)}{category.name}</option>)}</select></label><div className="wiki-modal-actions"><button className="button button-secondary" type="button" onClick={() => setShowNewCategory(false)}>Cancel</button><button className="button button-primary" type="submit" disabled={busy || !categoryName.trim()}><Plus size={14} /> Create category</button></div></form></div>}
    {showEntityLink && <div className="wiki-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeEntityPicker(); }}>
      <form className="wiki-modal" role="dialog" aria-modal="true" aria-labelledby="wiki-entity-title" onSubmit={pickerCreateOpen ? createPickerPage : insertEntityLink}>
        <div className="wiki-panel-head"><h2 id="wiki-entity-title">{pickerCreateOpen ? "Create a linked Wiki page" : "Insert linked record"}</h2>
          <button className="button button-quiet" type="button" onClick={closeEntityPicker} disabled={pickerCreateBusy} aria-label="Close"><X size={18} /></button></div>
        {pickerCreateOpen ? <>
          <label>New page title<input autoFocus className="wiki-input" required maxLength={180} value={pickerPageTitle}
            disabled={pickerCreateBusy} onChange={(event) => setPickerPageTitle(event.target.value)} /></label>
          <label>Category<select className="wiki-select" required value={pickerPageCategory}
            disabled={pickerCreateBusy} onChange={(event) => setPickerPageCategory(event.target.value)}>
            {flatCategories.filter(({ category }) => !category.archivedAt).map(({ category, depth }) =>
              <option key={category.id} value={category.id}>{"— ".repeat(depth)}{category.name}</option>)}
          </select></label>
          <p className="wiki-muted">The new page will be visible to {audienceLabel({ audience: audienceDraft, groupId: audienceGroupIdDraft || null })}.
            Creating it leaves your source page in the editor.</p>
          {pickerCreateError && <p role="alert" className="wiki-error">{pickerCreateError}</p>}
          <div className="wiki-modal-actions">
            <button type="button" className="button button-secondary" disabled={pickerCreateBusy}
              onClick={() => setPickerCreateOpen(false)}>Back to search</button>
            <button type="submit" className="button button-primary" disabled={pickerCreateBusy || !pickerPageTitle.trim()
              || !pickerPageCategory || (audienceDraft === "group" && !audienceGroupIdDraft)}>
              {pickerCreateBusy ? "Creating…" : "Create and select page"}
            </button>
          </div>
        </> : <><p className="wiki-muted">Search for a person, group, Wiki page, or song that is visible to you.</p><label>Record type<select className="wiki-select" value={entityType} onChange={(event) => { setEntityType(event.target.value as EntityType); setEntityId(""); setEntityLabel(""); setWikiPageQuery(""); setWikiPageMatches([]); }}>{entityTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>{entityType !== "person" || canSearchPeople ? <><label>Find a {entityType === "wiki" ? "Wiki page" : entityType === "person" ? "person" : entityType === "group" ? "group" : "song"}<input autoFocus className="wiki-input" type="search" value={wikiPageQuery} onChange={(event) => setWikiPageQuery(event.target.value)} placeholder="Type at least two characters" /></label>{wikiPageSearchBusy && <p className="wiki-muted" role="status">Searching records…</p>}{wikiPageQuery.trim().length >= 2 && !wikiPageSearchBusy && !wikiPageMatches.length && <p className="wiki-muted">No discoverable {entityType} records found.</p>}{wikiPageMatches.length > 0 && <div className="wiki-page-list" role="listbox" aria-label={`Matching ${entityType} records`}>{wikiPageMatches.map((match) => <button key={match.id} className="wiki-page-item" type="button" role="option" aria-selected={entityId === match.id} onClick={() => { setEntityId(match.id); setEntityLabel(match.title); setWikiPageQuery(""); setWikiPageMatches([]); }}><strong>{match.title}</strong>{match.detail && <small>{match.detail}</small>}</button>)}</div>}</> : <p className="wiki-muted">Private People access is required to search for person links.</p>}{entityType === "wiki" && canManage && editing && flatCategories.some(({ category }) => !category.archivedAt) &&
          <button className="button button-secondary" type="button" onClick={startPickerPage}><Plus size={15} /> Create a Wiki page</button>}
        {pickerCreateNotice && <p role="status">{pickerCreateNotice}</p>}
        <label>Record ID<input className="wiki-input" value={entityId} onChange={(event) => setEntityId(event.target.value)} maxLength={80} required readOnly /></label><label>Link text<input className="wiki-input" value={entityLabel} onChange={(event) => setEntityLabel(event.target.value)} maxLength={160} required /></label><div className="wiki-modal-actions"><button className="button button-secondary" type="button" onClick={closeEntityPicker}>Cancel</button><button className="button button-primary" type="submit" disabled={!entityId}>Insert link</button></div>
        </>}
      </form>
    </div>}
  </div>;
}
