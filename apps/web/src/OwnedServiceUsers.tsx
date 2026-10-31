import { useEffect, useState } from "react";
import { ApiKeySettings } from "./ApiKeySettings";

type OwnedServiceUser = { id: string; displayName: string; username: string; apiKeyEnabled: boolean };

export function OwnedServiceUsers() {
  const [users, setUsers] = useState<OwnedServiceUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/auth/service-users", { cache: "no-store" }).then(async (response) => {
      const result = await response.json() as OwnedServiceUser[] | { error?: string };
      if (!response.ok || !Array.isArray(result)) throw new Error(!Array.isArray(result) ? result.error ?? "Could not load your service users." : "Could not load your service users.");
      if (!cancelled) setUsers(result);
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load your service users.");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  return <section className="my-settings-section" aria-labelledby="owned-service-users-title">
    <div><h3 id="owned-service-users-title">Service users you own</h3><p>You can manage API keys for these accounts. Account rights remain managed by administrators.</p>
      {loading && <small role="status">Loading service users…</small>}
      {error && <small role="alert">{error}</small>}
      {!loading && !error && users.length === 0 && <small>No service users are assigned to you.</small>}
    </div>
    <div className="owned-service-user-list">{users.map((user) => <article key={user.id}>
      <strong>{user.displayName} <small data-no-translate>(@{user.username})</small></strong>
      <ApiKeySettings key={user.id} mode="service" userId={user.id} userName={user.displayName} enabled={user.apiKeyEnabled} onEnabledChange={(enabled) => setUsers((current) => current.map((entry) => entry.id === user.id ? { ...entry, apiKeyEnabled: enabled } : entry))} />
    </article>)}</div>
  </section>;
}
