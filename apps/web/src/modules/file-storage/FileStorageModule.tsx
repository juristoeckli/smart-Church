import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Check, Download, File, FileAudio, FileImage, FileText, FileVideo, Folder, Pencil, Plus, RotateCcw, Search, Trash2, Upload, X } from "lucide-react";
import type { StoredFile, StoredFolder, UserLanguage } from "@smart-church/contracts";
import { moduleTranslation, type ModuleRealtime } from "../../module-registry";
import { translationsForModule } from "../translations";
import { mergeModuleTranslationOverrides } from "../ui-translation-overrides";

const maxResourceSize = 25 * 1024 * 1024;
const fileStorageTranslations = mergeModuleTranslationOverrides("file-storage", translationsForModule("file-storage"));

function resourceIcon(type: string) {
  if (type.startsWith("image/")) return FileImage;
  if (type.startsWith("video/")) return FileVideo;
  if (type.startsWith("audio/")) return FileAudio;
  if (type.includes("pdf") || type.includes("word") || type.includes("presentation") || type.includes("spreadsheet")) return FileText;
  return File;
}

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileStorageModule({ departmentId, csrfToken, canManage, language, realtime }: { departmentId: string; csrfToken: string; canManage: boolean; language: UserLanguage; realtime?: ModuleRealtime }) {
  const t = (key: string) => moduleTranslation(fileStorageTranslations, language, key);
  const fileInput = useRef<HTMLInputElement>(null);
  const [resources, setResources] = useState<StoredFile[]>([]);
  const [folders, setFolders] = useState<StoredFolder[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [editing, setEditing] = useState<StoredFile | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("General");
  const [fileFolderId, setFileFolderId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [trashView, setTrashView] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const loadResources = useCallback(async (signal?: AbortSignal, quiet = false) => {
    if (!quiet) { setLoading(true); setError(""); }
    try {
      const response = await fetch(`/api/files${trashView ? "?view=trash" : ""}`, { headers: { "x-department-id": departmentId }, signal });
      const result = await response.json() as StoredFile[] | { error?: string };
      if (!response.ok || !Array.isArray(result)) throw new Error(!Array.isArray(result) ? result.error ?? "Could not load files." : "Could not load files.");
      setResources(result);
      if (!trashView) {
        const folderResponse = await fetch("/api/files/folders", { headers: { "x-department-id": departmentId }, signal });
        const folderResult = await folderResponse.json() as StoredFolder[] | { error?: string };
        if (!folderResponse.ok || !Array.isArray(folderResult)) throw new Error("error" in folderResult ? folderResult.error ?? "Could not load folders." : "Could not load folders.");
        setFolders(folderResult);
      }
    } catch (reason) { if (!signal?.aborted && !quiet) setError(reason instanceof Error ? reason.message : "Could not load files."); }
    finally { if (!signal?.aborted && !quiet) setLoading(false); }
  }, [departmentId, trashView]);

  useEffect(() => {
    const controller = new AbortController();
    void loadResources(controller.signal);
    const refresh = () => { void loadResources(undefined, true); };
    const unsubscribeChanged = realtime?.subscribe("module:file-storage:changed", refresh);
    const unsubscribeConnected = realtime?.subscribe("realtime:connected", refresh);
    return () => { controller.abort(); unsubscribeChanged?.(); unsubscribeConnected?.(); };
  }, [departmentId, loadResources, realtime]);

  const categories = useMemo(() => ["All", ...new Set(resources.map((resource) => resource.category).sort((a, b) => a.localeCompare(b)))], [resources]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return resources.filter((resource) => (trashView || (resource.folderId ?? null) === currentFolderId) && (categoryFilter === "All" || resource.category === categoryFilter) && (!normalized || `${resource.title} ${resource.fileName} ${resource.category}`.toLocaleLowerCase().includes(normalized)));
  }, [resources, categoryFilter, currentFolderId, query, trashView]);
  const currentFolder = folders.find((folder) => folder.id === currentFolderId) ?? null;
  const visibleFolders = folders.filter((folder) => folder.parentId === currentFolderId);
  const folderPath = useMemo(() => {
    const path: StoredFolder[] = [];
    let folder = currentFolder;
    while (folder) { path.unshift(folder); folder = folders.find((candidate) => candidate.id === folder?.parentId) ?? null; }
    return path;
  }, [currentFolder, folders]);
  function folderLabel(folder: StoredFolder) {
    const path: string[] = [folder.name];
    let parentId = folder.parentId;
    while (parentId) {
      const parent = folders.find((candidate) => candidate.id === parentId);
      if (!parent) break;
      path.unshift(parent.name);
      parentId = parent.parentId;
    }
    return path.join(" / ");
  }

  function openUpload() {
    setEditing(null); setSelectedFile(null); setTitle(""); setCategory("General"); setFileFolderId(currentFolderId); setError("");
    window.setTimeout(() => fileInput.current?.click(), 0);
  }

  function openEdit(resource: StoredFile) {
    setSelectedFile(null); setEditing(resource); setTitle(resource.title); setCategory(resource.category); setFileFolderId(resource.folderId ?? null); setError("");
  }

  async function createFolder() {
    const name = window.prompt(t("Folder name"))?.trim();
    if (!name) return;
    try {
      const response = await fetch("/api/files/folders", { method: "POST", headers: { "content-type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken }, body: JSON.stringify({ name, parentId: currentFolderId }) });
      const result = await response.json() as StoredFolder | { error?: string };
      if (!response.ok || !("id" in result)) throw new Error("error" in result ? result.error ?? "Could not create the folder." : "Could not create the folder.");
      setFolders((current) => [...current, result].sort((a, b) => a.name.localeCompare(b.name)));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create the folder."); }
  }

  async function renameFolder(folder: StoredFolder) {
    const name = window.prompt(t("Folder name"), folder.name)?.trim();
    if (!name || name === folder.name) return;
    try {
      const response = await fetch(`/api/files/folders/${folder.id}`, { method: "PUT", headers: { "content-type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken }, body: JSON.stringify({ name }) });
      const result = await response.json() as StoredFolder | { error?: string };
      if (!response.ok || !("id" in result)) throw new Error("error" in result ? result.error ?? "Could not rename the folder." : "Could not rename the folder.");
      setFolders((current) => current.map((item) => item.id === result.id ? result : item));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not rename the folder."); }
  }

  async function deleteFolder(folder: StoredFolder) {
    if (!window.confirm(t("Delete folder “{name}”? It must be empty.").replace("{name}", folder.name))) return;
    try {
      const response = await fetch(`/api/files/folders/${folder.id}`, { method: "DELETE", headers: { "x-department-id": departmentId, "x-csrf-token": csrfToken } });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not delete the folder.");
      setFolders((current) => current.filter((item) => item.id !== folder.id));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete the folder."); }
  }

  async function saveResource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError("");
    try {
      if (editing) {
        const response = await fetch(`/api/files/${editing.id}`, {
          method: "PUT", headers: { "content-type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken }, body: JSON.stringify({ title, category, folderId: fileFolderId }),
        });
        const result = await response.json() as StoredFile | { error?: string };
        if (!response.ok || !("id" in result)) throw new Error("error" in result ? result.error ?? "Could not update the file." : "Could not update the file.");
        setResources((current) => current.map((item) => item.id === result.id ? result : item));
      } else if (selectedFile) {
        const params = new URLSearchParams({ filename: selectedFile.name, title: title.trim() || selectedFile.name, category: category.trim() || "General" });
        if (fileFolderId) params.set("folderId", fileFolderId);
        const response = await fetch(`/api/files?${params}`, {
          method: "POST", headers: { "content-type": "application/vnd.smart-church.resource", "x-resource-content-type": selectedFile.type || "application/octet-stream", "x-department-id": departmentId, "x-csrf-token": csrfToken }, body: selectedFile,
        });
        const result = await response.json() as StoredFile | { error?: string };
        if (!response.ok || !("id" in result)) throw new Error("error" in result ? result.error ?? "Could not upload the file." : "Could not upload the file.");
        setResources((current) => [...current, result].sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title)));
      }
      setEditing(null); setSelectedFile(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save the file."); }
    finally { setSaving(false); }
  }

  async function downloadResource(resource: StoredFile) {
    try {
      const response = await fetch(`/api/files/${resource.id}/download`, { headers: { "x-department-id": departmentId } });
      if (!response.ok) { const result = await response.json() as { error?: string }; throw new Error(result.error ?? "Could not download this file."); }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = resource.fileName; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not download this file."); }
  }

  async function deleteResource(resource: StoredFile) {
    if (!window.confirm(t("Move “{title}” to trash?").replace("{title}", resource.title))) return;
    try {
      const response = await fetch(`/api/files/${resource.id}`, { method: "DELETE", headers: { "x-department-id": departmentId, "x-csrf-token": csrfToken } });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(t(result.error ?? "Could not move the file to trash."));
      setResources((current) => current.filter((item) => item.id !== resource.id));
    } catch (reason) { setError(reason instanceof Error ? t(reason.message) : t("Could not move the file to trash.")); }
  }

  async function restoreResource(resource: StoredFile) {
    try {
      const response = await fetch(`/api/files/${resource.id}/restore`, { method: "POST", headers: { "x-department-id": departmentId, "x-csrf-token": csrfToken } });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(t(result.error ?? "Could not restore the file."));
      setResources((current) => current.filter((item) => item.id !== resource.id));
    } catch (reason) { setError(reason instanceof Error ? t(reason.message) : t("Could not restore the file.")); }
  }

  async function permanentlyDeleteResource(resource: StoredFile) {
    if (!window.confirm(t("Permanently delete “{title}” and its file? This cannot be undone.").replace("{title}", resource.title))) return;
    try {
      const response = await fetch(`/api/files/${resource.id}/permanent`, { method: "DELETE", headers: { "x-department-id": departmentId, "x-csrf-token": csrfToken } });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(t(result.error ?? "Could not permanently delete the file."));
      setResources((current) => current.filter((item) => item.id !== resource.id));
    } catch (reason) { setError(reason instanceof Error ? t(reason.message) : t("Could not permanently delete the file.")); }
  }

  return <>
    <div className={`demo-notice ${error ? "demo-notice-error" : ""}`}><span className="demo-dot" />{error || "Shared files for your church community"}{error && <button className="event-retry" type="button" onClick={() => void loadResources()}>Try again</button>}</div>
    <section className="page-heading"><div><div className="eyebrow">SHARED MATERIALS</div><h1>File storage</h1><p className="page-subtitle">Keep forms, guides, recordings, and other church files easy to find.</p></div>{canManage && !trashView && <div className="button-group"><button className="button button-secondary" type="button" onClick={() => void createFolder()}><Folder size={16} /> Add folder</button><button className="button button-primary" type="button" onClick={openUpload}><Upload size={16} /> Add file</button></div>}</section>
    <section className="directory-card community-resource-card"><div className="directory-heading"><div><h2>{trashView ? t("Trash") : currentFolder?.name ?? t("Church files")}</h2><p>{trashView ? resources.length : filtered.length} {filtered.length === 1 ? t("file") : t("files")} · {t("· Up to 25 MiB per file")}</p></div>{canManage && <div className="button-group"><button className="button button-secondary" type="button" aria-pressed={!trashView} onClick={() => { setTrashView(false); setCurrentFolderId(null); }}>{t("Files")}</button><button className="button button-secondary" type="button" aria-pressed={trashView} onClick={() => setTrashView(true)}>{t("Trash")}</button></div>}</div>
      {!trashView && <nav className="file-folder-breadcrumb" aria-label={t("Folder path")}><button type="button" onClick={() => setCurrentFolderId(null)}>{t("Church files")}</button>{folderPath.map((folder) => <span key={folder.id}><span aria-hidden="true">/</span><button type="button" onClick={() => setCurrentFolderId(folder.id)}>{folder.name}</button></span>)}</nav>}
      <div className="directory-toolbar community-resource-toolbar"><label className="search-field"><Search size={15} /><input aria-label="Search files" placeholder="Search files…" value={query} onChange={(event) => setQuery(event.target.value)} /></label><label className="community-category-filter"><span className="sr-only">Filter by category</span><select aria-label="Filter files by category" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>{categories.map((item) => <option key={item} value={item}>{t(item)}</option>)}</select></label></div>
      {loading ? <p className="community-empty">Loading files…</p> : <div className="community-resource-list">{!trashView && visibleFolders.map((folder) => <article className="community-resource-row" key={folder.id}><span className="community-resource-icon"><Folder size={19} /></span><button className="file-folder-open" type="button" onClick={() => setCurrentFolderId(folder.id)}><strong>{folder.name}</strong><small>{t("Folder")}</small></button>{canManage && <><button className="community-row-action" type="button" aria-label={`${t("Rename")} ${folder.name}`} title={t("Rename")} onClick={() => void renameFolder(folder)}><Pencil size={15} /></button><button className="community-row-action community-row-delete" type="button" aria-label={`${t("Delete")} ${folder.name}`} title={t("Delete")} onClick={() => void deleteFolder(folder)}><Trash2 size={15} /></button></>}</article>)}{filtered.map((resource) => { const Icon = resourceIcon(resource.contentType); return <article className="community-resource-row" key={resource.id}><span className="community-resource-icon"><Icon size={19} /></span><div className="community-resource-title"><strong>{resource.title}</strong><small>{resource.category} · {resource.fileName} · {formatSize(resource.fileSize)}</small></div>{trashView ? canManage && <><button className="community-row-action" type="button" aria-label={`${t("Restore")} ${resource.title}`} title={t("Restore")} onClick={() => void restoreResource(resource)}><RotateCcw size={16} /></button><button className="community-row-action community-row-delete" type="button" aria-label={`${t("Delete permanently")} ${resource.title}`} title={t("Delete permanently")} onClick={() => void permanentlyDeleteResource(resource)}><Trash2 size={15} /></button></> : <><button className="community-row-action" type="button" aria-label={`${t("Download")} ${resource.title}`} title={t("Download")} onClick={() => void downloadResource(resource)}><Download size={16} /></button>{canManage && <><button className="community-row-action" type="button" aria-label={`${t("Edit")} ${resource.title}`} title={t("Edit")} onClick={() => openEdit(resource)}><Pencil size={15} /></button><button className="community-row-action community-row-delete" type="button" aria-label={`${t("Delete")} ${resource.title}`} title={t("Delete")} onClick={() => void deleteResource(resource)}><Trash2 size={15} /></button></>}</>}</article>; })}{!visibleFolders.length && !filtered.length && <p className="community-empty">{trashView ? t("Trash is empty.") : resources.some((resource) => (resource.folderId ?? null) === currentFolderId) ? "No files match your search." : "This folder is empty. Add a folder or file to get started."}</p>}</div>}
    </section>
    <footer className="page-footer"><span>Useful things, ready when you need them.</span><span>© 2026 Smart Church</span></footer>
    <input ref={fileInput} className="sr-only" type="file" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (!file) return; if (file.size > maxResourceSize) { setError("Files must be 25 MiB or smaller."); event.currentTarget.value = ""; return; } setSelectedFile(file); setTitle(file.name.replace(/\.[^.]+$/, "")); setCategory("General"); setEditing(null); setError(""); }} />
    {(editing || selectedFile) && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && (setEditing(null), setSelectedFile(null))}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="resource-form-title"><div className="modal-heading"><div><span className="eyebrow">FILE STORAGE</span><h2 id="resource-form-title">{editing ? "Edit file details" : "Add a file"}</h2><p>{selectedFile?.name ?? editing?.fileName}</p></div><button className="icon-button" type="button" aria-label="Close" onClick={() => { setEditing(null); setSelectedFile(null); }}><X size={18} /></button></div><form onSubmit={saveResource}><label>Title<input autoFocus required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>Category<input required maxLength={80} list="resource-categories" value={category} onChange={(event) => setCategory(event.target.value)} placeholder="General" /><datalist id="resource-categories">{categories.filter((item) => item !== "All").map((item) => <option key={item} value={item} />)}<option value="Forms" /><option value="Worship" /><option value="Children" /><option value="Administration" /></datalist></label><label>{t("Folder")}<select value={fileFolderId ?? ""} onChange={(event) => setFileFolderId(event.target.value || null)}><option value="">{t("Church files")}</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folderLabel(folder)}</option>)}</select></label>{error && <p className="user-access-feedback user-access-feedback-error" role="alert">{error}</p>}<div className="form-actions"><button className="button button-secondary" type="button" onClick={() => { setEditing(null); setSelectedFile(null); }}>Cancel</button><button className="button button-primary" type="submit" disabled={saving || !title.trim() || !category.trim()}>{editing ? <Check size={15} /> : <Plus size={15} />}{saving ? "Saving…" : editing ? "Save changes" : "Upload file"}</button></div></form></section></div>}
  </>;
}
