import { useEffect, useMemo, useState } from "react";
import { Download, FileUp, FileDown } from "lucide-react";

type Entity = "customers" | "equipment" | "suppliers" | "venues" | "freelancers" | "jobs";
type Report = "utilisation" | "job_costs" | "availability" | "overdue_returns" | "maintenance" | "crew";
type DataRow = Record<string, string>;
const entityLabels: Record<Entity, string> = { customers: "Customers", equipment: "Equipment", suppliers: "Suppliers", venues: "Venues", freelancers: "Freelancers", jobs: "Jobs" };
const templates: Record<Entity, string[]> = {
  customers: ["id","kind","name","contact_person","email","phone","street","postal_code","city","country","notes","active"],
  equipment: ["id","name","category","quantity","daily_rate_cents","active","notes","barcode","supplier_ref"],
  suppliers: ["id","name","contact_person","email","phone","street","postal_code","city","country","notes","active"],
  venues: ["id","name","contact_person","email","phone","street","postal_code","city","country","notes","active"],
  freelancers: ["id","name","email","phone","roles","hourly_rate_cents","notes","active"],
  jobs: ["id","title","customer_name","customer_ref","starts_at","ends_at","venue","venue_ref","status","notes"],
};
const reportLabels: Record<Report, string> = { utilisation: "Equipment utilisation", job_costs: "Job cost and margin", availability: "Equipment availability", overdue_returns: "Overdue supplier returns", maintenance: "Maintenance schedule", crew: "Crew fulfilment" };
const quoteCsv = (value: unknown) => { const text = String(value ?? ""); return `"${(/^[\s]*[=+\-@\t\r]/.test(text) ? `'${text}` : text).replaceAll('"', '""')}"`; };

function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, ""); const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted && char === '"' && text[index + 1] === '"') { cell += '"'; index++; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && text[index + 1] === "\n") index++; row.push(cell); cell = ""; if (row.some((part) => part.trim())) rows.push(row); row = []; }
    else cell += char;
  }
  if (quoted) throw new Error("The CSV contains an unclosed quoted field.");
  row.push(cell); if (row.some((part) => part.trim())) rows.push(row);
  return rows;
}

function saveCsv(name: string, headers: string[], rows: unknown[][]) {
  const text = `\uFEFF${[headers, ...rows].map((row) => row.map(quoteCsv).join(",")).join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" })); const link = document.createElement("a"); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DataReportsSection({ departmentId, csrfToken, customers, assets, permissions, canFinance, onImported }: {
  departmentId: string; csrfToken: string; customers: { id: string; name: string }[]; assets: { id: string; name: string }[]; permissions: Record<Entity, boolean>; canFinance: boolean; onImported: () => Promise<void>;
}) {
  const [entity, setEntity] = useState<Entity>("customers");
  const [report, setReport] = useState<Report>(permissions.equipment ? "utilisation" : canFinance ? "job_costs" : "crew");
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<DataRow[]>([]);
  const [preview, setPreview] = useState<{ previewId: string; rows: { row: number; data: DataRow; errors: string[]; duplicate: string | null }[]; validCount: number; errorCount: number; duplicateCount: number } | null>(null);
  const [reportRows, setReportRows] = useState<DataRow[]>([]);
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const allowedEntities = (Object.keys(entityLabels) as Entity[]).filter((key) => permissions[key]);
  const allowedReports = (Object.keys(reportLabels) as Report[]).filter((key) => key === "job_costs" ? canFinance : key === "crew" ? permissions.freelancers : permissions.equipment);
  const query = useMemo(() => new URLSearchParams({ report, from, to, status, ...(customerId ? { customerId } : {}), ...(assetId ? { assetId } : {}) }).toString(), [report, from, to, status, customerId, assetId]);
  const canReport = allowedReports.length > 0;
  useEffect(() => { setReportRows([]); }, [query]);

  async function api<T,>(url: string, method = "GET", body?: unknown): Promise<T> {
    const response = await fetch(url, { method, headers: { "x-department-id": departmentId, ...(method === "GET" ? {} : { "content-type": "application/json", "x-csrf-token": csrfToken }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json().catch(() => ({})) as T & { error?: string };
    if (!response.ok) throw new Error(result.error || "EventDesk data request failed.");
    return result;
  }

  async function chooseFile(file?: File) {
    setFileName(file?.name ?? ""); setPreview(null); setRows([]); setError("");
    if (!file) return;
    if (file.size > 900_000) { setError("Choose a CSV file smaller than 900 KiB."); return; }
    try {
      const matrix = parseCsv(await file.text());
      if (matrix.length < 2) throw new Error("Add a header row and at least one data row.");
      const headers = matrix[0].map((header) => header.trim().toLowerCase().replace(/[\s-]+/g, "_"));
      if (headers.some((header) => !header) || new Set(headers).size !== headers.length) throw new Error("CSV headers must be unique and cannot be blank.");
      if (matrix.slice(1).some((cells) => cells.length > headers.length && cells.slice(headers.length).some((cell) => cell.trim()))) throw new Error("A CSV row contains more values than there are headers.");
      const data = matrix.slice(1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
      if (data.length > 1000) throw new Error("A CSV file can contain up to 1,000 data rows.");
      setRows(data); setBusy(true);
      const result = await api<{ previewId: string; rows: typeof preview extends infer _ ? { row: number; data: DataRow; errors: string[]; duplicate: string | null }[] : never; validCount: number; errorCount: number; duplicateCount: number }>("/api/eventdesk/data/import/preview", "POST", { entity, rows: data });
      setPreview(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not preview this CSV file."); }
    finally { setBusy(false); }
  }

  async function commitImport() {
    if (!preview) return;
    setBusy(true); setError("");
    try {
      await api(`/api/eventdesk/data/import/${preview.previewId}/commit`, "POST", {});
      setPreview(null); setRows([]); setFileName(""); await onImported();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not import these rows."); }
    finally { setBusy(false); }
  }

  async function loadReport() {
    setBusy(true); setError("");
    try { const result = await api<{ rows: DataRow[] }>(`/api/eventdesk/reports?${query}`); setReportRows(result.rows); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load the report."); }
    finally { setBusy(false); }
  }

  async function exportEntity() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/eventdesk/data/export?entity=${entity}`, { headers: { "x-department-id": departmentId } });
      if (!response.ok) throw new Error("Could not export this record set.");
      const url = URL.createObjectURL(await response.blob()); const link = document.createElement("a"); link.href = url; link.download = `eventdesk-${entity}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not export this record set."); }
    finally { setBusy(false); }
  }

  function downloadTemplate() { saveCsv(`eventdesk-${entity}-template.csv`, templates[entity], []); }
  function exportReport() { if (!reportRows.length) return; const headers = Object.keys(reportRows[0]); saveCsv(`eventdesk-${report}-${from}-${to}.csv`, headers, reportRows.map((row) => headers.map((header) => row[header]))); }

  return <div className="eventdesk-workspace">
    {error && <p role="alert" className="eventdesk-form-error">{error}</p>}
    <section className="eventdesk-panel"><div className="eventdesk-panel-heading"><div><h2>CSV import and export</h2><p>Download a documented template, validate and preview rows, then explicitly commit the import. Existing matches and invalid rows block the commit.</p></div></div>
      <div className="eventdesk-form-grid"><label>Record type<select value={entity} onChange={(event) => { setEntity(event.target.value as Entity); setPreview(null); setFileName(""); }} disabled={!allowedEntities.length}>{allowedEntities.map((key) => <option key={key} value={key}>{entityLabels[key]}</option>)}</select></label><div className="eventdesk-inline-actions"><button className="button button-secondary" type="button" onClick={downloadTemplate}><Download size={14} /> CSV template</button>{permissions[entity] && <button className="button button-secondary" type="button" disabled={busy} onClick={() => void exportEntity()}><FileDown size={14} /> Export {entityLabels[entity].toLowerCase()}</button>}</div></div>
      {allowedEntities.length > 0 && <label>Import CSV<input key={entity} type="file" accept=".csv,text/csv" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void chooseFile(file); }} /></label>}
      {fileName && <p className="eventdesk-muted">Selected {fileName} · {rows.length} data row(s)</p>}
      {preview && <><div className="eventdesk-stat-grid"><article className="eventdesk-stat"><span>Ready to import</span><strong>{preview.validCount}</strong></article><article className="eventdesk-stat"><span>Rows with errors</span><strong>{preview.errorCount}</strong></article><article className="eventdesk-stat"><span>Duplicate matches</span><strong>{preview.duplicateCount}</strong></article></div><div className="eventdesk-scroll-table"><table><thead><tr><th>CSV row</th><th>Record</th><th>Validation</th></tr></thead><tbody>{preview.rows.map((item) => <tr key={item.row}><td>{item.row}</td><td>{item.data.name || item.data.title || item.data.id || "—"}</td><td>{item.errors.join(" ")}{item.duplicate && <span className="eventdesk-form-error">{item.duplicate}</span>}{!item.errors.length && !item.duplicate && <span>Ready</span>}</td></tr>)}</tbody></table></div><div className="form-actions"><button className="button button-primary" type="button" disabled={busy || preview.validCount !== preview.rows.length || preview.errorCount > 0 || preview.duplicateCount > 0} onClick={() => void commitImport()}><FileUp size={14} /> Commit import</button></div></>}
    </section>
    {canReport && <section className="eventdesk-panel"><div className="eventdesk-panel-heading"><div><h2>Operational reports</h2><p>Location-scoped reports include multi-warehouse stock, external sub-rentals, cancelled jobs, and issued credits where relevant.</p></div></div>
      <div className="eventdesk-form-grid"><label>Report<select value={report} onChange={(event) => setReport(event.target.value as Report)}>{allowedReports.map((key) => <option key={key} value={key}>{reportLabels[key]}</option>)}</select></label><label>From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>Through<input type="date" min={from} value={to} onChange={(event) => setTo(event.target.value)} /></label><label>Status<input value={status} onChange={(event) => setStatus(event.target.value)} placeholder="Any status · exact value" /></label><label>Customer<select value={customerId} onChange={(event) => setCustomerId(event.target.value)}><option value="">All customers</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label><label>Equipment<select value={assetId} onChange={(event) => setAssetId(event.target.value)}><option value="">All equipment</option>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label></div>
      <div className="eventdesk-inline-actions"><button className="button button-primary" type="button" disabled={busy || from > to} onClick={() => void loadReport()}>Run report</button><button className="button button-secondary" type="button" disabled={busy || !reportRows.length} onClick={exportReport}><Download size={14} /> Export results</button></div>
      {reportRows.length > 0 && <><p className="eventdesk-muted">{reportRows.length} result(s) · {reportLabels[report]}</p><div className="eventdesk-scroll-table"><table><thead><tr>{Object.keys(reportRows[0]).map((key) => <th key={key}>{key.replaceAll("_", " ")}</th>)}</tr></thead><tbody>{reportRows.map((row, index) => <tr key={String(row.id ?? row.job_id ?? row.asset_id ?? index)}>{Object.keys(reportRows[0]).map((key) => <td key={key}>{String(row[key] ?? "—")}</td>)}</tr>)}</tbody></table></div></>}
      {!reportRows.length && <p className="eventdesk-muted">Choose filters and run a report. Results can be exported as CSV.</p>}
    </section>}
  </div>;
}
