import { useState } from "react";

type AccountType = "asset" | "liability" | "equity" | "income" | "expense";
type Selection = { kind: "account" | "cost_center"; sourceId: string; action: "link" | "create"; accountType?: AccountType };
type CodeRow = { sourceId: string; code: string; sourceName: string; codeStatus: string; candidate: { name: string; accountType?: AccountType } | null };
type AccountRow = CodeRow & {
  sourceClassification: string;
  sourceHierarchy: { group: { name: string | null } | null; class: { name: string | null } | null; type: { name: string | null } | null };
  sourceFlags: { openingBalance: boolean; donation: boolean; taxRateConfigured: boolean };
};
type Review = { reviewHash: string; canApply: boolean; accounts: AccountRow[]; costCenters: CodeRow[] };
type Result = { created: number; linked: number; alreadyLinked: number; replayed: boolean };
type Option = ({ row: AccountRow; types: AccountType[]; kind: "account" } | { row: CodeRow; types: []; kind: "cost_center" }) & { action: Selection["action"] };
const sideTypes: Record<string, AccountType[]> = { asset: ["asset"], liability_or_equity: ["liability", "equity"], income_or_expense: ["income", "expense"] };
const endpoint = "/api/modules/sync/churchtools/finance/mapping";
const pageSize = 25;

export function FinanceMappingReview({ departmentId, periodId, t }: { departmentId: string; periodId: string; t: (message: string) => string }) {
  const [review, setReview] = useState<Review | null>(null);
  const [selected, setSelected] = useState<Record<string, Selection>>({});
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const options = review ? [
    ...review.accounts.flatMap<Option>((row) => {
      const types = sideTypes[row.sourceClassification] ?? [];
      const existing = row.candidate?.accountType;
      const special = row.sourceFlags.openingBalance || row.sourceFlags.donation || row.sourceFlags.taxRateConfigured;
      if (row.codeStatus === "active_code_match" && existing && types.includes(existing)) return [{ row, types: [existing], kind: "account", action: "link" }];
      if (row.codeStatus === "no_local_match" && types.length && !special && row.sourceName.trim() && row.sourceName.length <= 160) return [{ row, types, kind: "account", action: "create" }];
      return [];
    }),
    ...review.costCenters.flatMap<Option>((row) => {
      if (row.codeStatus === "active_code_match") return [{ row, types: [], kind: "cost_center", action: "link" }];
      if (row.codeStatus === "no_local_match" && row.sourceName.trim() && row.sourceName.length <= 160) return [{ row, types: [], kind: "cost_center", action: "create" }];
      return [];
    }),
  ] : [];
  const count = Object.keys(selected).length;

  async function request<T>(path: string, body?: object): Promise<T> {
    const response = await fetch(endpoint + path, {
      method: body ? "POST" : "GET",
      headers: { "x-department-id": departmentId, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const value = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(value.error ?? "Could not review ChurchTools finance data.");
    return value;
  }
  function select(key: string, selection?: Selection) {
    setSelected((current) => {
      if (selection) return Object.keys(current).length >= 100 && !current[key] ? current : { ...current, [key]: selection };
      const next = { ...current };
      delete next[key];
      return next;
    });
  }
  async function load() {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const query = new URLSearchParams({ periodId });
      setReview(await request<Review>(`?${query}`));
      setSelected({});
      setOffset(0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not review ChurchTools finance data.");
    } finally { setBusy(false); }
  }
  async function apply() {
    if (!review || !count) return;
    setBusy(true);
    setError("");
    try {
      setResult(await request<Result>("", { periodId, reviewHash: review.reviewHash, selections: Object.values(selected) }));
      setReview(null);
      setSelected({});
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not apply the selected finance mappings.");
    } finally { setBusy(false); }
  }
  return <section>
    <h3>{t("Review account and cost-center changes")}</h3>
    <button type="button" className="button button-secondary" disabled={busy} onClick={() => void load()}>{t("Load master-data review")}</button>
    {busy && <p role="status">{t("Working…")}</p>}
    {error && <p role="alert">{t(error)}</p>}
    {result && <p role="status">{result.created} {t("created")} · {result.linked} {t("linked")} · {result.alreadyLinked} {t("already linked")}{result.replayed ? ` · ${t("Previously applied batch")}` : ""}</p>}
    {review && !review.canApply && <p>{t("Enable the local Finance module before applying a mapping.")}</p>}
    {review?.canApply && <>
      <p>{count} {t("selected")} · {review.accounts.length + review.costCenters.length - options.length} {t("unavailable for automatic linking or creation")}</p>
      {options.length > 0 && <div className="table-wrap"><table>
        <thead><tr><th scope="col">{t("Source code")}</th><th scope="col">{t("Source name")}</th><th scope="col">{t("Local match")}</th><th scope="col">{t("Action")}</th></tr></thead>
        <tbody>{options.slice(offset, offset + pageSize).map(({ row, types, kind, action }) => {
          const key = `${kind}:${row.sourceId}`;
          const actionLabel = t(action === "link" ? "Link existing" : "Create");
          const source = kind === "account" ? row.sourceHierarchy : null;
          const hierarchy = [source?.type?.name, source?.class?.name, source?.group?.name].filter(Boolean).join(" · ");
          return <tr key={key}><td>{row.code}</td><th scope="row">{row.sourceName}{hierarchy && <small>{hierarchy}</small>}</th><td>{row.candidate?.name ?? "—"}</td><td>
            {kind === "account" ? <select value={selected[key]?.accountType ?? ""} aria-label={`${actionLabel} ${row.code}`} disabled={busy || count >= 100 && !selected[key]} onChange={(event) => {
              const entry = types.find((type) => type === event.target.value);
              select(key, entry ? { kind, action, sourceId: row.sourceId, accountType: entry } : undefined);
            }}><option value="">{t("Skip")}</option>{types.map((type) => <option key={type} value={type}>{actionLabel} · {t(type)}</option>)}</select>
              : <label><input type="checkbox" checked={Boolean(selected[key])} disabled={busy || count >= 100 && !selected[key]} onChange={(event) => select(key, event.target.checked ? { kind, action, sourceId: row.sourceId } : undefined)} /> {actionLabel}</label>}
          </td></tr>;
        })}</tbody>
      </table></div>}
      {options.length > pageSize && <div className="community-inline-actions">
        <button type="button" className="button button-secondary" disabled={!offset || busy} onClick={() => setOffset(offset - pageSize)}>{t("Previous")}</button>
        <button type="button" className="button button-secondary" disabled={offset + pageSize >= options.length || busy} onClick={() => setOffset(offset + pageSize)}>{t("Next")}</button>
      </div>}
      <button type="button" className="button button-primary" disabled={!count || busy} onClick={() => void apply()}>{t("Apply selected master-data changes")}</button>
    </>}
  </section>;
}
