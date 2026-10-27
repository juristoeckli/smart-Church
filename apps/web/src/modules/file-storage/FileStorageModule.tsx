import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Check, Download, File, FileAudio, FileImage, FileText, FileVideo, Pencil, Plus, Search, Trash2, Upload, X } from "lucide-react";
import type { StoredFile } from "@smart-church/contracts";

const maxResourceSize = 25 * 1024 * 1024;

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

export function FileStorageModule({ departmentId, csrfToken, canManage }: { departmentId: string; csrfToken: string; canManage: boolean }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [resources, setResources] = useState<StoredFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [editing, setEditing] = useState<StoredFile | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("General");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function loadResources(signal?: AbortSignal) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/files", { headers: { "x-department-id": departmentId }, signal });
      const result = await response.json() as StoredFile[] | { error?: string };
      if (!response.ok || !Array.isArray(result)) throw new Error(!Array.isArray(result) ? result.error ?? "Could not load files." : "Could not load files.");
      setResources(result);
    } catch (reason) { if (!signal?.aborted) setError(reason instanceof Error ? reason.message : "Could not load files."); }
    finally { if (!signal?.aborted) setLoading(false); }
  }

  useEffect(() => {
    const controller = new AbortController();
    void loadResources(controller.signal);
    return () => controller.abort();
  }, [departmentId]);

  const categories = useMemo(() => ["All", ...new Set(resources.map((resource) => resource.category).sort((a, b) => a.localeCompare(b)))], [resources]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return resources.filter((resource) => (categoryFilter === "All" || resource.category === categoryFilter) && (!normalized || `${resource.title} ${resource.fileName} ${resource.category}`.toLocaleLowerCase().includes(normalized)));
  }, [resources, categoryFilter, query]);

  function openUpload() {
    setEditing(null); setSelectedFile(null); setTitle(""); setCategory("General"); setError("");
    window.setTimeout(() => fileInput.current?.click(), 0);
  }

  function openEdit(resource: StoredFile) {
    setSelectedFile(null); setEditing(resource); setTitle(resource.title); setCategory(resource.category); setError("");
  }

  async function saveResource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError("");
    try {
      if (editing) {
        const response = await fetch(`/api/files/${editing.id}`, {
          method: "PUT", headers: { "content-type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken }, body: JSON.stringify({ title, category }),
        });
        const result = await response.json() as StoredFile | { error?: string };
        if (!response.ok || !("id" in result)) throw new Error("error" in result ? result.error ?? "Could not update the file." : "Could not update the file.");
        setResources((current) => current.map((item) => item.id === result.id ? result : item));
      } else if (selectedFile) {
        const params = new URLSearchParams({ filename: selectedFile.name, title: title.trim() || selectedFile.name, category: category.trim() || "General" });
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
    if (!window.confirm(`Delete “${resource.title}” and its file? This cannot be undone.`)) return;
    try {
      const response = await fetch(`/api/files/${resource.id}`, { method: "DELETE", headers: { "x-department-id": departmentId, "x-csrf-token": csrfToken } });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not delete the file.");
      setResources((current) => current.filter((item) => item.id !== resource.id));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete the file."); }
  }

  return <>
    <div className={`demo-notice ${error ? "demo-notice-error" : ""}`}><span className="demo-dot" />{error || "Shared files for your church community"}{error && <button className="event-retry" type="button" onClick={() => void loadResources()}>Try again</button>}</div>
    <section className="page-heading"><div><div className="eyebrow">SHARED MATERIALS</div><h1>File storage</h1><p className="page-subtitle">Keep forms, guides, recordings, and other church files easy to find.</p></div>{canManage && <button className="button button-primary" type="button" onClick={openUpload}><Upload size={16} /> Add file</button>}</section>
    <section className="directory-card community-resource-card"><div className="directory-heading"><div><h2>Church files</h2><p>{resources.length} {resources.length === 1 ? "file" : "files"} · Up to 25 MiB per file</p></div></div>
      <div className="directory-toolbar community-resource-toolbar"><label className="search-field"><Search size={15} /><input aria-label="Search files" placeholder="Search files…" value={query} onChange={(event) => setQuery(event.target.value)} /></label><label className="community-category-filter"><span className="sr-only">Filter by category</span><select aria-label="Filter files by category" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label></div>
      {loading ? <p className="community-empty">Loading files…</p> : filtered.length ? <div className="community-resource-list">{filtered.map((resource) => { const Icon = resourceIcon(resource.contentType); return <article className="community-resource-row" key={resource.id}><span className="community-resource-icon"><Icon size={19} /></span><div className="community-resource-title"><strong>{resource.title}</strong><small>{resource.category} · {resource.fileName} · {formatSize(resource.fileSize)}</small></div><button className="community-row-action" type="button" aria-label={`Download ${resource.title}`} title="Download" onClick={() => void downloadResource(resource)}><Download size={16} /></button>{canManage && <><button className="community-row-action" type="button" aria-label={`Edit ${resource.title}`} title="Edit" onClick={() => openEdit(resource)}><Pencil size={15} /></button><button className="community-row-action community-row-delete" type="button" aria-label={`Delete ${resource.title}`} title="Delete" onClick={() => void deleteResource(resource)}><Trash2 size={15} /></button></>}</article>; })}</div> : <p className="community-empty">{resources.length ? "No files match your search." : "No shared files yet. Add a file to start file storage."}</p>}
    </section>
    <footer className="page-footer"><span>Useful things, ready when you need them.</span><span>© 2026 Smart Church</span></footer>
    <input ref={fileInput} className="sr-only" type="file" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (!file) return; if (file.size > maxResourceSize) { setError("Files must be 25 MiB or smaller."); event.currentTarget.value = ""; return; } setSelectedFile(file); setTitle(file.name.replace(/\.[^.]+$/, "")); setCategory("General"); setEditing(null); setError(""); }} />
    {(editing || selectedFile) && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && (setEditing(null), setSelectedFile(null))}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="resource-form-title"><div className="modal-heading"><div><span className="eyebrow">FILE STORAGE</span><h2 id="resource-form-title">{editing ? "Edit file details" : "Add a file"}</h2><p>{selectedFile?.name ?? editing?.fileName}</p></div><button className="icon-button" type="button" aria-label="Close" onClick={() => { setEditing(null); setSelectedFile(null); }}><X size={18} /></button></div><form onSubmit={saveResource}><label>Title<input autoFocus required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>Category<input required maxLength={80} list="resource-categories" value={category} onChange={(event) => setCategory(event.target.value)} placeholder="General" /><datalist id="resource-categories">{categories.filter((item) => item !== "All").map((item) => <option key={item} value={item} />)}<option value="Forms" /><option value="Worship" /><option value="Children" /><option value="Administration" /></datalist></label>{error && <p className="user-access-feedback user-access-feedback-error" role="alert">{error}</p>}<div className="form-actions"><button className="button button-secondary" type="button" onClick={() => { setEditing(null); setSelectedFile(null); }}>Cancel</button><button className="button button-primary" type="submit" disabled={saving || !title.trim() || !category.trim()}>{editing ? <Check size={15} /> : <Plus size={15} />}{saving ? "Saving…" : editing ? "Save changes" : "Upload file"}</button></div></form></section></div>}
  </>;
}
