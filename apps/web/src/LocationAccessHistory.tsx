import { useEffect, useState, type FormEvent } from "react";
import { formatUserDate } from "./date-format";
import { registeredModules } from "./module-registry";

const actions = { granted: "Access granted", changed: "Access changed", revoked: "Access revoked" } as const;
type Action = keyof typeof actions;
type GrantState = { role: "member" | "site_admin"; contactId: string | null; permissions: string[]; modulePermissions: Record<string, string[]> };
type AccessChange = { id: string; actorName: string; targetName: string; action: Action; source: "location_access" | "server_accounts"; beforeAccess: GrantState | null; afterAccess: GrantState | null; createdAt: string };

function GrantDetails({ state, permissionLabels }: { state: GrantState | null; permissionLabels: Record<string, string> }) {
  if (!state) return <p>No access</p>;
  if (state.role === "site_admin") return <p>Site administrator · all location rights</p>;
  const moduleGrants = Object.entries(state.modulePermissions).map(([id, grants]) => {
    const module = registeredModules.find((item) => item.id === id);
    const labels = grants.map((grant) => module?.accessLevels?.find((level) => level.value === grant)?.label ?? grant);
    return `${module?.name ?? id} (${labels.join(", ")})`;
  });
  const grants = [...state.permissions.map((id) => permissionLabels[id] ?? id), ...moduleGrants];
  return <><p>Member</p>{grants.length ? <ul>{grants.map((grant, index) => <li key={index}>{grant}</li>)}</ul> : <p>No additional rights</p>}</>;
}

export function LocationAccessHistory({ departmentId, permissionLabels }: { departmentId: string; permissionLabels: Record<string, string> }) {
  const [name, setName] = useState("");
  const [action, setAction] = useState<Action | "">("");
  const [query, setQuery] = useState<{ name: string; action: Action | "" }>({ name: "", action: "" });
  const [history, setHistory] = useState<AccessChange[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setHistory(null);
    setError("");
    const params = new URLSearchParams();
    if (query.name) params.set("q", query.name);
    if (query.action) params.set("action", query.action);
    void fetch(`/api/location-access/history?${params}`, { headers: { "x-department-id": departmentId }, signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          const reason = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(reason?.error ?? "Could not load access history.");
        }
        const entries = await response.json() as AccessChange[];
        if (!controller.signal.aborted) setHistory(entries);
      }).catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load access history.");
      });
    return () => controller.abort();
  }, [departmentId, query]);

  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuery({ name: name.trim(), action });
  }

  return <section className="location-access-history" aria-label="Location access history">
    <form className="module-toolbar" onSubmit={filter}>
      <label>Account or actor<input type="search" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>Action<select value={action} onChange={(event) => setAction(event.target.value as Action | "")}>
        <option value="">All actions</option>{Object.entries(actions).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
      </select></label>
      <button type="submit" className="button button-secondary">Apply filters</button>
      <button type="button" className="button button-secondary" onClick={() => setQuery({ ...query })}>Refresh history</button>
    </form>
    {error ? <p role="alert">{error}</p> : !history ? <p role="status">Loading access history…</p> : history.length === 0 ? <p>No access changes match these filters.</p> : <>
      {history.length === 100 && <p>Showing the 100 most recent matching changes.</p>}
      <ul className="location-access-history-list">{history.map((entry) => <li key={entry.id}>
        <article><h3>{entry.targetName} · {actions[entry.action]}</h3>
          <p><time dateTime={entry.createdAt}>{formatUserDate(entry.createdAt, true)}</time> · {entry.actorName} · {entry.source === "server_accounts" ? "Server account administration" : "Location access"}</p>
          <details><summary>View permission changes</summary>
            <div className="location-access-history-states">
              <section><h4>Before</h4><GrantDetails state={entry.beforeAccess} permissionLabels={permissionLabels} /></section>
              <section><h4>After</h4><GrantDetails state={entry.afterAccess} permissionLabels={permissionLabels} /></section>
            </div>
            {entry.beforeAccess?.contactId !== entry.afterAccess?.contactId && (entry.beforeAccess?.contactId || entry.afterAccess?.contactId) && <p>Linked person changed.</p>}
          </details>
        </article>
      </li>)}</ul>
    </>}
  </section>;
}
