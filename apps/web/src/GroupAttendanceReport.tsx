import { useEffect, useRef, useState, type FormEvent } from "react";
import { Download, FileBarChart2 } from "lucide-react";
import { formatUserDate } from "./date-format";
import "./GroupAttendanceReport.css";

type Filters = { kind: "meetings" | "people"; from: string; to: string; member: string; state: string; contactId: string; contactName: string };
type ReportRow = {
  meetingId: string; date: string; title: string; state: "upcoming" | "open" | "completed";
  contactId?: string; firstName?: string; lastName?: string;
} & Record<string, string | number | undefined>;
type Report = { columns: { key: string; label: string }[]; rows: ReportRow[]; truncated: boolean };
const initialFilters: Filters = { kind: "meetings", from: "", to: "", member: "", state: "", contactId: "", contactName: "" };
const displayValues: Record<string, string> = { upcoming: "Upcoming", open: "Open", completed: "Completed", present: "Present", absent: "Absent", excused: "Excused" };
const pageSize = 30;

export function GroupAttendanceReport({ departmentId, groupId }: { departmentId: string; groupId: string }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(initialFilters);
  const [filters, setFilters] = useState(initialFilters);
  const [loaded, setLoaded] = useState<{ url: string; report: Report }>();
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const exportController = useRef<AbortController | null>(null);
  useEffect(() => () => exportController.current?.abort(), []);
  const { contactName, ...query } = filters;
  const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value));
  const url = "/api/groups/" + groupId + "/attendance-report?" + params;

  const report = loaded?.url === url ? loaded.report : undefined;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setLoaded(undefined);
    setError("");
    setPage(0);
    void fetch(url, { signal: controller.signal, headers: { "x-department-id": departmentId } })
      .then(async (response) => {
        const result = await response.json() as Report & { error?: string };
        if (!response.ok) throw new Error(result.error ?? "Could not load the attendance report.");
        if (!controller.signal.aborted) setLoaded({ url, report: result });
      }).catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load the attendance report.");
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [departmentId, open, url, revision]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFilters({ ...form, member: form.member.trim() });
    setRevision((current) => current + 1);
  }

  function showPerson(row: ReportRow) {
    if (!row.contactId) return;
    const exact = { ...filters, member: "", contactId: row.contactId, contactName: [row.firstName, row.lastName].filter(Boolean).join(" ") };
    setForm(exact);
    setFilters(exact);
  }

  async function exportReport(format: "csv" | "xlsx") {
    if (exporting || !report) return;
    const controller = new AbortController();
    exportController.current = controller;
    setExporting(true);
    setError("");
    try {
      const response = await fetch(url + "&format=" + format, { signal: controller.signal, headers: { "x-department-id": departmentId } });
      if (!response.ok) {
        const failure = await response.json() as { error?: string };
        throw new Error(failure.error ?? "Could not export the attendance report.");
      }
      const content = await response.blob();
      if (controller.signal.aborted) return;
      const downloadUrl = URL.createObjectURL(content);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = "group-attendance-" + filters.kind + "." + format;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not export the attendance report.");
    } finally {
      if (!controller.signal.aborted) setExporting(false);
    }
  }

  return <div className="group-attendance-report">
    <button className="button button-secondary" type="button" aria-expanded={open} disabled={exporting} onClick={() => setOpen((current) => !current)}>
      <FileBarChart2 size={15} />{open ? "Hide attendance report" : "Attendance report"}
    </button>
    {open && <section aria-label="Group attendance report">
      <form className="group-meeting-form" onSubmit={submit}>
        <label>Report<select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as Filters["kind"] })}>
          <option value="meetings">Meeting summaries</option><option value="people">Individual attendance</option>
        </select></label>
        <label>Start date<input type="date" value={form.from} max={form.to || undefined} onChange={(event) => setForm({ ...form, from: event.target.value })} /></label>
        <label>End date<input type="date" value={form.to} min={form.from || undefined} onChange={(event) => setForm({ ...form, to: event.target.value })} /></label>
        <label>Meeting state<select value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value })}>
          <option value="">All meetings</option><option value="upcoming">Upcoming</option><option value="open">Open</option><option value="completed">Completed</option>
        </select></label>
        <label>Member name<input type="search" maxLength={160} value={form.member} disabled={Boolean(form.contactId)} onChange={(event) => setForm({ ...form, member: event.target.value })} /></label>
        {form.contactId && <button className="button button-secondary" type="button" disabled={exporting} onClick={() => {
          setForm({ ...form, contactId: "", contactName: "" });
          setFilters({ ...filters, contactId: "", contactName: "" });
        }}>Clear {contactName || "member filter"}</button>}
        <button className="button button-primary" type="submit" disabled={loading || exporting}>Apply filters</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">Loading attendance report…</p>}
      {report && <>
        <div className="community-inline-actions">
          <button className="button button-secondary" type="button" disabled={exporting} onClick={() => void exportReport("csv")}><Download size={14} /> CSV</button>
          <button className="button button-secondary" type="button" disabled={exporting} onClick={() => void exportReport("xlsx")}><Download size={14} /> Excel</button>
        </div>
        {report.truncated && <p role="status">Showing the first 1,000 rows. Refine your filters to see a smaller set.</p>}
        {report.rows.length > 0 ? <>
          <div className="group-attendance-report-table">
            <table>
              <thead><tr>{report.columns.map(({ key, label }) => <th scope="col" key={key}>{label}</th>)}</tr></thead>
              <tbody>{report.rows.slice(page * pageSize, (page + 1) * pageSize).map((row) => <tr key={row.meetingId + ":" + (row.contactId ?? "")}>
                {report.columns.map(({ key }) => {
                  const value = row[key] ?? "";
                  return <td key={key}>{key === "firstName" && row.contactId && !filters.contactId
                    ? <button className="button button-secondary" type="button" disabled={exporting} onClick={() => showPerson(row)} aria-label={"Show attendance for " + row.firstName + " " + row.lastName}>{value}</button>
                    : key === "date" ? formatUserDate(row.date) : key === "state" || key === "attendance" ? displayValues[String(value)] : value}</td>;
                })}
              </tr>)}</tbody>
            </table>
          </div>
          {report.rows.length > pageSize && <nav aria-label="Attendance report pages" className="community-inline-actions">
            <button className="button button-secondary" type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
            <span>{page + 1} of {Math.ceil(report.rows.length / pageSize)}</span>
            <button className="button button-secondary" type="button" disabled={(page + 1) * pageSize >= report.rows.length} onClick={() => setPage(page + 1)}>Next</button>
          </nav>}
        </> : <p className="community-empty">No attendance records match these filters.</p>}
      </>}
    </section>}
  </div>;
}
