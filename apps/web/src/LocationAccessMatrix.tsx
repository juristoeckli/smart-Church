import { useEffect, useState, type FormEvent } from "react";
import type { DepartmentProfile } from "@smart-church/contracts";
import { locationGrantStatusLabels, type LocationGrantPreview } from "./LocationAccessPreview";
import { registeredModules } from "./module-registry";

type MatrixAccount = LocationGrantPreview & { id: string; username?: string };
type MatrixResult = { page: number; total: number; hasNext: boolean; accounts: MatrixAccount[] };

export function LocationAccessMatrix({ department, permissionLabels, onOpenAccount }: {
  department: DepartmentProfile;
  permissionLabels: Record<string, string>;
  onOpenAccount: (id: string) => void;
}) {
  const [filters, setFilters] = useState({ q: "", withGrants: false, permission: "", permissionSource: "", accountStatus: "", page: 1 });
  const [permissionInput, setPermissionInput] = useState("");
  const [result, setResult] = useState<MatrixResult>();
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ q: filters.q, withGrants: String(filters.withGrants), page: String(filters.page) });
    if (filters.permission) query.set("permission", filters.permission);
    if (filters.permissionSource) query.set("permissionSource", filters.permissionSource);
    if (filters.accountStatus) query.set("accountStatus", filters.accountStatus);
    setResult(undefined);
    setError("");
    void fetch(`/api/location-access/matrix?${query}`, {
      headers: { "x-department-id": department.id }, signal: controller.signal,
    }).then(async (response) => {
      const data = await response.json() as MatrixResult | { error: string };
      if (!response.ok || "error" in data) throw new Error("error" in data ? data.error : "Could not load the permission matrix.");
      if (!controller.signal.aborted) setResult(data);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load the permission matrix.");
    });
    return () => controller.abort();
  }, [department.id, filters]);

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setFilters({
      q: String(data.get("q") ?? "").trim(), withGrants: data.has("withGrants"), page: 1,
      permission: permissionInput, permissionSource: permissionInput ? String(data.get("permissionSource") ?? "") : "",
      accountStatus: String(data.get("accountStatus") ?? ""),
    });
  }

  return <section className="location-access-history location-access-preview" aria-label="Location permission matrix">
    <form className="module-toolbar" onSubmit={apply}>
      <label>Account name or username<input type="search" name="q" maxLength={80} /></label>
      <label>Location permission<select name="permission" value={permissionInput} onChange={(event) => setPermissionInput(event.target.value)}>
        <option value="">Any permission</option>
        {Object.entries(permissionLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select></label>
      <label>Permission source<select name="permissionSource" key={permissionInput} disabled={!permissionInput}>
        <option value="">Any source</option>
        <option value="site_role">Site administrator role</option>
        <option value="direct">Direct grant</option>
        {permissionInput === "people_view_private" && <option value="via_people_manage">Included with Manage people</option>}
      </select></label>
      <label>Account status<select name="accountStatus">
        <option value="">Any status</option>
        {Object.entries(locationGrantStatusLabels).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
      </select></label>
      <label>Only accounts with grants<input type="checkbox" name="withGrants" /></label>
      <button type="submit" className="button button-secondary">Apply filters</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {!result && !error && <p role="status">Loading the permission matrix…</p>}
    {result && <p role="status">{result.total ? result.total.toLocaleString() + " matching accounts" : "No accounts match these filters."}</p>}
    {result && result.total > 0 && result.accounts.length === 0 && <p>No accounts on this page.</p>}
    {result && result.accounts.length > 0 && <div className="location-access-history-scroll"><table className="location-access-history-table">
      <caption>Account grants at {department.location}</caption>
      <thead><tr><th scope="col">Account</th><th scope="col">Role and status</th>
        {Object.entries(permissionLabels).map(([id, label]) => <th scope="col" key={id}>{label}</th>)}
        <th scope="col">Configured module grants</th>
      </tr></thead>
      <tbody>{result.accounts.map((account) => <tr key={account.id}>
        <th scope="row"><button className="button button-secondary" type="button" onClick={() => onOpenAccount(account.id)}>{account.displayName}</button>
          {account.username && <small className="location-access-matrix-username">@{account.username}</small>}
        </th>
        <td>{account.role === "site_admin" ? "Site administrator" : "Member"}<br />{locationGrantStatusLabels[account.status]}</td>
        {Object.keys(permissionLabels).map((permission) => {
          const source = account.permissions.find((item) => item.permission === permission)?.source;
          return <td key={permission}>{source === "site_role" ? "Inherited" : source === "direct" ? "Direct"
            : permission === "people_view_private" && account.canViewPrivateContactDetails ? "Via Manage people" : "—"}</td>;
        })}
        <td>{account.role === "site_admin" ? "Inherited for active modules" :
          Object.entries(account.modulePermissions).filter(([, grants]) => grants.length).map(([id, grants]) => {
            const module = registeredModules.find((entry) => entry.id === id);
            return <div key={id}><strong>{module?.name ?? id}</strong><br />{grants.map((grant) => module?.accessLevels?.find((level) => level.value === grant)?.label ?? grant).join(", ")}</div>;
          })
        }</td>
      </tr>)}</tbody>
    </table></div>}
    {result && (result.hasNext || result.page > 1) && <nav className="module-toolbar" aria-label="Permission matrix pages">
      <button className="button button-secondary" type="button" disabled={result.page <= 1} onClick={() => setFilters({ ...filters, page: result.page - 1 })}>Previous page</button>
      <span>Page {result.page}</span>
      <button className="button button-secondary" type="button" disabled={!result.hasNext} onClick={() => setFilters({ ...filters, page: result.page + 1 })}>Next page</button>
    </nav>}
  </section>;
}
