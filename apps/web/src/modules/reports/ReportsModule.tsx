import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Download, Play, Save, Trash2 } from "lucide-react";
import type { ModuleContext } from "../../module-registry";
import "./reports.css";

type ReportKey = "people-directory" | "people-consent-history" | "people-status-changes" | "upcoming-birthdays" | "upcoming-anniversaries" | "group-summary" | "group-roster" | "group-meeting-attendance" | "group-lifecycle" | "event-attendance" | "event-staffing" | "event-absence-conflicts" | "event-service-plan" | "event-registration-summary" | "event-registration-details" | "check-in-trend" | "visitor-follow-up" | "worship-song-usage" | "resource-bookings" | "resource-utilization" | "finance-account-summary" | "finance-budget-vs-actual" | "finance-donor-giving";
type ReportDefinition = { key: ReportKey; title: string; description: string; permission: string };
type ReportColumn = { key: string; label: string };
type ReportResult = { reportKey: ReportKey; title: string; generatedAt: string; columns: ReportColumn[]; rows: Array<Record<string, string | number | boolean | null>> };
type GroupOption = { id: string; name: string };
type Filters = { from?: string; to?: string; groupId?: string; status?: string; followUpStatus?: string; accountingYear?: string };
type SavedReport = { id: string; reportKey: ReportKey; name: string; filters: Filters; ownerId: string };
type DesignerField = { key: string; label: string; type: "text" | "number" | "date" };
type DesignerDataset = { key: "people" | "groups" | "memberships" | "events" | "finance"; title: string; description: string; fields: DesignerField[] };
type DesignerFilter = { field: string; operator: "equals" | "contains" | "gt" | "gte" | "lt" | "lte"; value: string };
type DesignerDefinition = { dataset: DesignerDataset["key"]; columns: string[]; filters: Array<{ field: string; operator: DesignerFilter["operator"]; value: string | number }>; sortBy: string; direction: "asc" | "desc"; groupBy?: string; aggregate?: { operation: "count" | "sum" | "average"; field?: string } };
type DesignerResult = { dataset: DesignerDataset["key"]; title: string; generatedAt: string; columns: ReportColumn[]; rows: Array<Record<string, string | number | boolean | null>>; totalRows: number; capped: boolean };
type SavedDesignerReport = { id: string; name: string; definition: DesignerDefinition; createdAt: string; updatedAt: string };

function csvCell(value: unknown) {
  const text = String(value ?? "");
  const safe = /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
  return "\"" + safe.replace(/"/g, "\"\"") + "\"";
}

export function ReportsModule({ department, departmentId, csrfToken, canManageSite }: ModuleContext) {
  const [definitions, setDefinitions] = useState<ReportDefinition[]>([]);
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [saved, setSaved] = useState<SavedReport[]>([]);
  const [reportKey, setReportKey] = useState<ReportKey | "">("");
  const [filters, setFilters] = useState<Filters>({});
  const [result, setResult] = useState<ReportResult | null>(null);
  const [savedName, setSavedName] = useState("");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [section, setSection] = useState<"catalog" | "designer">("catalog");
  const [designerCatalog, setDesignerCatalog] = useState<DesignerDataset[]>([]);
  const [savedDesigner, setSavedDesigner] = useState<SavedDesignerReport[]>([]);
  const [datasetKey, setDatasetKey] = useState<DesignerDataset["key"] | "">("");
  const datasetKeyRef = useRef<DesignerDataset["key"] | "">("");
  const [designerColumns, setDesignerColumns] = useState<string[]>([]);
  const [designerFilters, setDesignerFilters] = useState<DesignerFilter[]>([]);
  const [designerSortBy, setDesignerSortBy] = useState("");
  const [designerDirection, setDesignerDirection] = useState<"asc" | "desc">("asc");
  const [designerGroupBy, setDesignerGroupBy] = useState("");
  const [designerAggregate, setDesignerAggregate] = useState<"count" | "sum" | "average">("count");
  const [designerAggregateField, setDesignerAggregateField] = useState("");
  const [designerResult, setDesignerResult] = useState<DesignerResult | null>(null);
  const [designerReportName, setDesignerReportName] = useState("");
  const [selectedDesignerId, setSelectedDesignerId] = useState("");
  const [designerRunning, setDesignerRunning] = useState(false);
  const canManageReports = canManageSite || (department.modulePermissions?.reports ?? []).includes("manage");

  const request = useCallback(async <T,>(url: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetch(url, {
      ...init,
      headers: { "x-department-id": departmentId, ...(init.body ? { "content-type": "application/json", "x-csrf-token": csrfToken } : {}), ...init.headers },
      cache: "no-store",
    });
    const data = await response.json() as T | { error?: string };
    if (!response.ok) throw new Error((data as { error?: string }).error ?? "The request could not be completed.");
    return data as T;
  }, [departmentId, csrfToken]);

  const loadSupportingData = useCallback(async () => {
    setError("");
    try {
      const [nextDefinitions, nextSaved, nextDesignerCatalog, nextSavedDesigner] = await Promise.all([
        request<ReportDefinition[]>("/api/modules/reports/catalog"),
        request<SavedReport[]>("/api/modules/reports/saved"),
        request<DesignerDataset[]>("/api/modules/reports/designer/catalog"),
        request<SavedDesignerReport[]>("/api/modules/reports/designer/saved"),
      ]);
      setDefinitions(nextDefinitions);
      setSaved(nextSaved);
      setDesignerCatalog(nextDesignerCatalog);
      setSavedDesigner(nextSavedDesigner);
      const activeDefinition = nextDesignerCatalog.find((item) => item.key === datasetKeyRef.current) ?? nextDesignerCatalog[0];
      datasetKeyRef.current = activeDefinition?.key ?? "";
      setDatasetKey(activeDefinition?.key ?? "");
      if (activeDefinition) {
        setDesignerColumns((current) => { const valid = current.filter((key) => activeDefinition.fields.some((field) => field.key === key)); return valid.length ? valid : activeDefinition.fields.slice(0, 6).map((field) => field.key); });
        setDesignerSortBy((current) => activeDefinition.fields.some((field) => field.key === current) ? current : activeDefinition.fields[0]?.key ?? "");
      }
      setReportKey((current) => current && nextDefinitions.some((item) => item.key === current) ? current : nextDefinitions[0]?.key ?? "");
      try { setGroups(await request<GroupOption[]>("/api/modules/reports/groups")); }
      catch { setGroups([]); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load reports."); }
    finally { setLoading(false); }
  }, [request]);

  useEffect(() => { void loadSupportingData(); }, [loadSupportingData]);

  async function runReport() {
    if (!reportKey) return;
    setRunning(true); setError(""); setMessage("");
    try {
      const parameters = new URLSearchParams({ reportKey });
      for (const [key, value] of Object.entries(filters)) if (value) parameters.set(key, value);
      setResult(await request<ReportResult>("/api/modules/reports/run?" + parameters.toString()));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The report could not be generated."); }
    finally { setRunning(false); }
  }

  function downloadCsv() {
    if (!result) return;
    const lines = [result.columns.map((column) => csvCell(column.label)).join(","), ...result.rows.map((row) => result.columns.map((column) => csvCell(row[column.key])).join(","))];
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = result.reportKey + ".csv";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function saveDefinition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reportKey || !savedName.trim()) return;
    setError(""); setMessage("");
    try {
      await request("/api/modules/reports/saved", { method: "POST", body: JSON.stringify({ reportKey, name: savedName.trim(), filters }) });
      setSavedName("");
      setMessage("Saved report definition.");
      await loadSupportingData();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save the report."); }
  }

  async function deleteDefinition(item: SavedReport) {
    if (!window.confirm("Delete this saved report definition?")) return;
    try {
      await request("/api/modules/reports/saved/" + item.id, { method: "DELETE", headers: { "x-csrf-token": csrfToken } });
      setSaved((current) => current.filter((entry) => entry.id !== item.id));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete the saved report."); }
  }

  function definitionForDesigner(): DesignerDefinition | null {
    if (!datasetKey || !designerColumns.length) return null;
    const dataset = designerCatalog.find((item) => item.key === datasetKey);
    if (!dataset) return null;
    const definition: DesignerDefinition = { dataset: datasetKey, columns: designerColumns, filters: designerFilters.filter((filter) => filter.field && filter.value !== "").map((filter) => {
      const field = dataset.fields.find((item) => item.key === filter.field)!;
      return { field: filter.field, operator: filter.operator, value: field.type === "number" ? Number(filter.value) : filter.value };
    }), sortBy: designerSortBy || designerColumns[0]!, direction: designerDirection };
    if (designerGroupBy) definition.groupBy = designerGroupBy;
    if (designerGroupBy) definition.aggregate = designerAggregate === "count" ? { operation: "count" } : { operation: designerAggregate, field: designerAggregateField };
    return definition;
  }

  async function previewDesigner() {
    const definition = definitionForDesigner(); if (!definition) return;
    setDesignerRunning(true); setError(""); setMessage(""); setResult(null);
    try { setDesignerResult(await request<DesignerResult>("/api/modules/reports/designer/preview", { method: "POST", body: JSON.stringify({ definition }) })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not run the report designer."); }
    finally { setDesignerRunning(false); }
  }

  async function saveDesigner() {
    const definition = definitionForDesigner(); if (!definition || !designerReportName.trim()) return;
    try {
      const path = selectedDesignerId ? `/api/modules/reports/designer/saved/${selectedDesignerId}` : "/api/modules/reports/designer/saved";
      await request(path, { method: selectedDesignerId ? "PUT" : "POST", body: JSON.stringify({ name: designerReportName.trim(), definition }) });
      setMessage(selectedDesignerId ? "Updated personal report." : "Saved personal report."); setSavedDesigner(await request<SavedDesignerReport[]>("/api/modules/reports/designer/saved"));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save the report."); }
  }

  async function removeDesigner(savedReport: SavedDesignerReport) {
    if (!window.confirm(`Delete personal report “${savedReport.name}”?`)) return;
    try { await request(`/api/modules/reports/designer/saved/${savedReport.id}`, { method: "DELETE", headers: { "x-csrf-token": csrfToken } }); setSavedDesigner((items) => items.filter((item) => item.id !== savedReport.id)); if (selectedDesignerId === savedReport.id) setSelectedDesignerId(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete the report."); }
  }

  function loadDesigner(savedReport: SavedDesignerReport) {
    const definition = savedReport.definition;
    datasetKeyRef.current = definition.dataset; setDatasetKey(definition.dataset); setDesignerColumns(definition.columns); setDesignerFilters(definition.filters.map((filter) => ({ ...filter, value: String(filter.value) })));
    setDesignerSortBy(definition.sortBy); setDesignerDirection(definition.direction); setDesignerGroupBy(definition.groupBy ?? "");
    setDesignerAggregate(definition.aggregate?.operation ?? "count"); setDesignerAggregateField(definition.aggregate?.field ?? ""); setDesignerReportName(savedReport.name); setSelectedDesignerId(savedReport.id); setDesignerResult(null);
  }

  function downloadDesignerCsv() {
    if (!designerResult) return;
    const lines = [designerResult.columns.map((column) => csvCell(column.label)).join(","), ...designerResult.rows.map((row) => designerResult.columns.map((column) => csvCell(row[column.key])).join(","))];
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `ad-hoc-${designerResult.dataset}.csv`; link.click(); URL.revokeObjectURL(link.href);
  }

  const selected = definitions.find((item) => item.key === reportKey);
  const activeDataset = designerCatalog.find((item) => item.key === datasetKey);
  const setFilter = (key: keyof Filters, value: string) => setFilters((current) => ({ ...current, [key]: value || undefined }));

  return <main className="reports-module">
    <header className="page-heading"><div><div className="eyebrow">REPORTING</div><h1>Reports</h1><p className="page-subtitle">Run permission-checked reports and export the visible results.</p></div></header>
    {error && <p className="reports-message reports-error" role="alert">{error}</p>}
    {message && <p className="reports-message reports-success" role="status">{message}</p>}
    <div className="reports-mode-tabs" role="tablist" aria-label="Report modes"><button type="button" role="tab" aria-selected={section === "catalog"} onClick={() => setSection("catalog")}>Report catalog</button><button type="button" role="tab" aria-selected={section === "designer"} onClick={() => setSection("designer")}>Ad hoc designer</button></div>
    {loading ? <p className="reports-empty">Loading reports…</p> : section === "designer" ? <>
      {!designerCatalog.length ? <p className="reports-empty">No datasets are available for your permissions.</p> : <div className="reports-layout reports-designer-layout">
        <section className="reports-panel reports-designer-panel">
          <h2>Build a report</h2>
          <label>Dataset<select value={datasetKey} onChange={(event) => { const next = designerCatalog.find((item) => item.key === event.target.value); datasetKeyRef.current = next?.key ?? ""; setDatasetKey(next?.key ?? ""); setDesignerColumns(next?.fields.slice(0, 6).map((field) => field.key) ?? []); setDesignerFilters([]); setDesignerSortBy(next?.fields[0]?.key ?? ""); setDesignerGroupBy(""); setDesignerAggregate("count"); setDesignerAggregateField(""); setDesignerResult(null); setSelectedDesignerId(""); setDesignerReportName(""); }}><option value="">Choose a dataset</option>{designerCatalog.map((item) => <option key={item.key} value={item.key}>{item.title}</option>)}</select></label>
          {activeDataset && <><p className="reports-description">{activeDataset.description} Results use a fixed field catalog, location-scoped queries, and bounded previews.</p>
            <fieldset className="reports-field-choices"><legend>Columns (choose up to 12)</legend>{activeDataset.fields.map((field) => <label key={field.key}><input type="checkbox" checked={designerColumns.includes(field.key)} onChange={(event) => setDesignerColumns((current) => event.target.checked ? current.length < 12 ? [...current, field.key] : current : current.filter((key) => key !== field.key))} />{field.label}</label>)}</fieldset>
            <div className="reports-designer-subhead"><h3>Filters</h3><button type="button" className="button button-secondary" disabled={designerFilters.length >= 8} onClick={() => setDesignerFilters((current) => [...current, { field: activeDataset.fields[0]?.key ?? "", operator: "equals", value: "" }])}>Add filter</button></div>
            {designerFilters.map((filter, index) => { const filterField = activeDataset.fields.find((field) => field.key === filter.field) ?? activeDataset.fields[0]; return <div className="reports-designer-filter" key={index}><select aria-label={`Filter field ${index + 1}`} value={filter.field} onChange={(event) => setDesignerFilters((current) => current.map((item, row) => row === index ? { ...item, field: event.target.value, operator: "equals", value: "" } : item))}>{activeDataset.fields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}</select><select aria-label={`Filter operation ${index + 1}`} value={filter.operator} onChange={(event) => setDesignerFilters((current) => current.map((item, row) => row === index ? { ...item, operator: event.target.value as DesignerFilter["operator"] } : item))}><option value="equals">is</option>{filterField?.type === "text" && <option value="contains">contains</option>}{filterField?.type !== "text" && <><option value="gt">greater than</option><option value="gte">at least</option><option value="lt">less than</option><option value="lte">at most</option></>}</select><input aria-label={`Filter value ${index + 1}`} type={filterField?.type === "date" ? "date" : filterField?.type === "number" ? "number" : "text"} step={filterField?.type === "number" ? 1 : undefined} value={filter.value} onChange={(event) => setDesignerFilters((current) => current.map((item, row) => row === index ? { ...item, value: event.target.value } : item))} /><button type="button" className="reports-filter-remove" aria-label={`Remove filter ${index + 1}`} onClick={() => setDesignerFilters((current) => current.filter((_, row) => row !== index))}>×</button></div>; })}
            <div className="reports-date-filters"><label>Sort by<select value={designerSortBy} onChange={(event) => setDesignerSortBy(event.target.value)}>{activeDataset.fields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}</select></label><label>Order<select value={designerDirection} onChange={(event) => setDesignerDirection(event.target.value as "asc" | "desc")}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label></div>
            <label>Group by (optional)<select value={designerGroupBy} onChange={(event) => { setDesignerGroupBy(event.target.value); if (!designerAggregateField) setDesignerAggregateField(activeDataset.fields.find((field) => field.type === "number")?.key ?? ""); }}><option value="">No grouping</option>{activeDataset.fields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}</select></label>
            {designerGroupBy && <div className="reports-date-filters"><label>Aggregate<select value={designerAggregate} onChange={(event) => setDesignerAggregate(event.target.value as "count" | "sum" | "average")}><option value="count">Count rows</option><option value="sum" disabled={!activeDataset.fields.some((field) => field.type === "number")}>Sum</option><option value="average" disabled={!activeDataset.fields.some((field) => field.type === "number")}>Average</option></select></label>{designerAggregate !== "count" && <label>Numeric field<select value={designerAggregateField} onChange={(event) => setDesignerAggregateField(event.target.value)}>{activeDataset.fields.filter((field) => field.type === "number").map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}</select></label>}</div>}
            <div className="reports-designer-actions"><button className="button button-primary" type="button" onClick={() => void previewDesigner()} disabled={designerRunning || designerColumns.length === 0}><Play size={16} />{designerRunning ? "Running…" : "Preview report"}</button><input aria-label="Personal report name" maxLength={120} value={designerReportName} onChange={(event) => setDesignerReportName(event.target.value)} placeholder="Name this report" /><button className="button button-secondary" type="button" onClick={() => void saveDesigner()} disabled={!designerReportName.trim() || !designerColumns.length}><Save size={15} />{selectedDesignerId ? "Update" : "Save"}</button>{selectedDesignerId && <button className="button button-secondary" type="button" onClick={() => { setSelectedDesignerId(""); setDesignerReportName(""); }}>Save as new</button>}</div>
          </>}
        </section>
        <aside className="reports-panel reports-saved"><h2>Personal reports</h2>{savedDesigner.length ? <ul>{savedDesigner.map((item) => <li key={item.id}><button type="button" className="reports-saved-open" onClick={() => loadDesigner(item)}>{item.name}<small>{designerCatalog.find((dataset) => dataset.key === item.definition.dataset)?.title ?? item.definition.dataset}</small></button><button className="reports-delete" type="button" aria-label={`Delete ${item.name}`} onClick={() => void removeDesigner(item)}><Trash2 size={15} /></button></li>)}</ul> : <p className="reports-description">Saved designs are private to your account.</p>}</aside>
      </div>}
      {designerResult && <section className="reports-results"><div className="reports-results-heading"><div><h2>{designerResult.title}</h2><p>{designerResult.totalRows} rows · previewing {designerResult.rows.length} · generated {new Date(designerResult.generatedAt).toLocaleString()}{designerResult.capped ? " · dataset capped at 5,000 source rows" : ""}</p></div><button className="button button-secondary" type="button" onClick={downloadDesignerCsv}><Download size={16} />Export preview CSV</button></div>{designerResult.rows.length ? <div className="reports-table-wrap"><table><thead><tr>{designerResult.columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{designerResult.rows.map((row, index) => <tr key={index}>{designerResult.columns.map((column) => <td key={column.key}>{row[column.key] === null || row[column.key] === undefined ? "—" : String(row[column.key])}</td>)}</tr>)}</tbody></table></div> : <p className="reports-empty">No rows match this report.</p>}</section>}
    </> : definitions.length === 0 ? <p className="reports-empty">No reports are available for your permissions. Ask an administrator for Reports access and the relevant People, Groups, Events or Finance permissions.</p> : <div className="reports-layout">
      <section className="reports-panel">
        <h2>Choose a report</h2>
        <label>Report<select value={reportKey} onChange={(event) => { setReportKey(event.target.value as ReportKey); setResult(null); }}><option value="">Select a report</option>{definitions.map((item) => <option key={item.key} value={item.key}>{item.title}</option>)}</select></label>
        {selected && <p className="reports-description">{selected.description}</p>}
        {["people-directory", "people-consent-history", "people-status-changes", "group-meeting-attendance", "group-lifecycle", "event-attendance", "event-staffing", "event-absence-conflicts", "event-service-plan", "event-registration-summary", "event-registration-details", "check-in-trend", "visitor-follow-up", "worship-song-usage", "resource-bookings", "resource-utilization", "finance-account-summary", "finance-donor-giving"].includes(reportKey) && <div className="reports-date-filters"><label>From<input required={reportKey === "event-absence-conflicts"} type="date" value={filters.from ?? ""} onChange={(event) => setFilter("from", event.target.value)} /></label><label>To<input required={reportKey === "event-absence-conflicts"} type="date" value={filters.to ?? ""} onChange={(event) => setFilter("to", event.target.value)} /></label></div>}
        {reportKey === "people-directory" && <label>Person status<select value={filters.status ?? ""} onChange={(event) => setFilter("status", event.target.value)}><option value="">All statuses</option><option value="member">Member</option><option value="visitor">Visitor</option></select></label>}
        {["group-roster", "group-meeting-attendance"].includes(reportKey) && <label>Group{reportKey === "group-roster" ? " (required)" : " (optional)"}<select required={reportKey === "group-roster"} value={filters.groupId ?? ""} onChange={(event) => setFilter("groupId", event.target.value)}><option value="">{reportKey === "group-roster" ? "Choose a group" : "All groups"}</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>}
        {reportKey === "visitor-follow-up" && <label>Follow-up state<select value={filters.followUpStatus ?? ""} onChange={(event) => setFilter("followUpStatus", event.target.value)}><option value="">All states</option><option value="needed">Needed</option><option value="done">Done</option><option value="not_needed">Not needed</option></select></label>}
        {reportKey === "finance-budget-vs-actual" && <label>Accounting year (optional)<input type="number" min={1900} max={2200} value={filters.accountingYear ?? ""} onChange={(event) => setFilter("accountingYear", event.target.value)} placeholder="All years" /></label>}
        <button className="button button-primary" type="button" onClick={() => void runReport()} disabled={running || !reportKey || (reportKey === "event-absence-conflicts" && (!filters.from || !filters.to || filters.to < filters.from || Date.parse(`${filters.to}T00:00:00Z`) - Date.parse(`${filters.from}T00:00:00Z`) > 366 * 86_400_000))}><Play size={16} />{running ? "Running…" : "Run report"}</button>
        {canManageReports && reportKey && <form className="reports-save-form" onSubmit={(event) => void saveDefinition(event)}><label>Save this definition<input maxLength={120} value={savedName} onChange={(event) => setSavedName(event.target.value)} placeholder="e.g. Monthly visitor follow-up" /></label><button className="button button-secondary" type="submit" disabled={!savedName.trim()}><Save size={15} />Save</button></form>}
      </section>
      <aside className="reports-panel reports-saved"><h2>Saved reports</h2>{saved.length ? <ul>{saved.map((item) => <li key={item.id}><button type="button" className="reports-saved-open" onClick={() => { setReportKey(item.reportKey); setFilters(item.filters ?? {}); setResult(null); }}>{item.name}<small>{definitions.find((definition) => definition.key === item.reportKey)?.title}</small></button>{canManageReports && <button className="reports-delete" type="button" aria-label={"Delete " + item.name} onClick={() => void deleteDefinition(item)}><Trash2 size={15} /></button>}</li>)}</ul> : <p className="reports-description">Saved report definitions will appear here.</p>}</aside>
    </div>}
    {result && <section className="reports-results"><div className="reports-results-heading"><div><h2>{result.title}</h2><p>{result.rows.length} rows · generated {new Date(result.generatedAt).toLocaleString()}</p></div><button className="button button-secondary" type="button" onClick={downloadCsv}><Download size={16} />Export CSV</button></div>{result.rows.length ? <div className="reports-table-wrap"><table><thead><tr>{result.columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{result.rows.map((row, index) => <tr key={index}>{result.columns.map((column) => <td key={column.key}>{row[column.key] === null || row[column.key] === undefined ? "—" : String(row[column.key])}</td>)}</tr>)}</tbody></table></div> : <p className="reports-empty">No rows match these filters.</p>}</section>}
  </main>;
}
