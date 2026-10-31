import { RefreshCw } from "lucide-react";
import { FederationSettings } from "./FederationSettings";

export function FederationModule({ departmentId, csrfToken, departments = [], settingsPanel = false }: { departmentId: string; csrfToken: string; departments?: Array<{ id: string; location: string; timeZone: string }>; settingsPanel?: boolean }) {
  return <div className={settingsPanel ? "sync-settings-panel-view" : undefined}>
    {!settingsPanel && <section className="page-heading"><div><div className="eyebrow">SYNCHRONIZATION</div><h1>Smart-Church Sync</h1><p className="page-subtitle">Connect Smart-Church installations, share selected site data, and manage redundancy.</p></div></section>}
    <section className="directory-card sync-settings-card">
      <div className="directory-heading"><div><h2>Server connections</h2><p>Pair Smart-Church installations, create data shares, and configure site replicas.</p></div><RefreshCw size={18} /></div>
      <FederationSettings csrfToken={csrfToken} departmentId={departmentId} departments={departments} />
    </section>
  </div>;
}
