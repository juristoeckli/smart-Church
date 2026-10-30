import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Check, Copy, Link2, Plus, RefreshCw, ShieldCheck, ShieldOff, Trash2 } from "lucide-react";

type FederationIdentity = { installationId: string; displayName: string; publicKeyPem: string; fingerprint: string; protocolVersion: string };
type Peer = { installation_id: string; display_name: string; base_url: string | null; fingerprint: string; trust_state: "pending" | "trusted" | "revoked"; direction: "incoming" | "outgoing"; created_at: string; approved_at: string | null; last_seen_at: string | null; last_error: string | null };
type Invitation = { id: string; expires_at: string; created_at: string };
type PeerSettings = { identity: FederationIdentity; peers: Peer[]; invitations: Invitation[]; canReceiveCallbacks?: boolean };
type Discovery = { baseUrl: string; identity: FederationIdentity; existingTrustState: string | null };
type Share = { id: string; recipientInstallationId: string; peerName: string; scopes: string[]; deliveryMode: "pull" | "push"; state: "active" | "revoked"; createdAt: string; lastPushedAt: string | null; lastPushError: string | null };
type Subscription = { id: string; sourceInstallationId: string; sourceServerName: string; sourceBaseUrl: string; sourceGrantId: string; scopes: string[]; deliveryMode: "pull" | "push"; state: "pending" | "active" | "rejected" | "revoked"; lastSyncedAt: string | null; lastError: string | null; sourceRevision: string | null; recordCount: number };
type IncomingGrant = { id: string; sourceInstallationId: string; sourceServerName: string; sourceDepartmentName: string; scopes: string[]; deliveryMode: "pull" | "push"; revision: number; createdAt: string };
type RedundancyReadiness = { departmentId: string; role: "primary" | "standby" | "fenced" | "unknown"; primaryInstallationId: string | null; upstreamInstallationId: string | null; upstreamDepartmentId: string | null; siteEpoch: string | null; lastSnapshotId: string | null; lastSnapshotAt: string | null; lastVerifiedAt: string | null; lastError: string | null; replicas: Array<{ peer_installation_id: string; peer_department_id: string; peer_name: string | null; last_snapshot_id: string | null; last_snapshot_at: string | null; last_verified_at: string | null; last_error: string | null }>; pendingStandbyRequests: Array<{ id: string; sourceInstallationId: string; sourceDepartmentId: string; sourceDepartmentName: string; sourceEpoch: string; sourceServerName: string; createdAt: string }>; modulesReady: boolean; snapshotVerified: boolean; ready: boolean; reason: string; modules: Array<{ moduleId: string; moduleName: string; ready: boolean; schemaVersion: string | null; installedVersion: string | null; recordCount: number | null; blockers: string[] }> };
type RedundancyPeerSite = { id: string; name: string; time_zone: string; role: string };

const availableScopes = [{ id: "people_names", label: "People names", detail: "Names and member/visitor status only. No contact details or login data." }, { id: "services", label: "Services & events", detail: "Schedule details only. No attendance, registrations, or assignments." }];

export function FederationSettings({ csrfToken, departmentId }: { csrfToken: string; departmentId: string }) {
  const [settings, setSettings] = useState<PeerSettings | null>(null);
  const [shares, setShares] = useState<Share[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [replicas, setReplicas] = useState<Record<string, Array<{ scope: string; sourceId: string; record: Record<string, unknown> }>>>({});
  const [incomingGrants, setIncomingGrants] = useState<IncomingGrant[]>([]);
  const [redundancyReadiness, setRedundancyReadiness] = useState<RedundancyReadiness | null>(null);
  const [redundancyPeerId, setRedundancyPeerId] = useState("");
  const [redundancyPeerSites, setRedundancyPeerSites] = useState<RedundancyPeerSite[]>([]);
  const [redundancyPeerSiteId, setRedundancyPeerSiteId] = useState("");
  const [fencingNote, setFencingNote] = useState("");
  const [promotionNote, setPromotionNote] = useState("");
  const [confirmSnapshotDataLoss, setConfirmSnapshotDataLoss] = useState(false);
  const [selectedPeer, setSelectedPeer] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>(["services"]);
  const [deliveryMode, setDeliveryMode] = useState<"pull" | "push">("push");
  const [baseUrl, setBaseUrl] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [verified, setVerified] = useState(false);
  const [newInvitation, setNewInvitation] = useState<{ id: string; pairingCode: string; expiresAt: string } | null>(null);
  const [remoteStates, setRemoteStates] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/modules/sync/federation", { cache: "no-store" });
      const data = await response.json() as PeerSettings | { error?: string; details?: string };
      if (!response.ok || !("identity" in data)) {
        const message = "error" in data ? data.error ?? "Could not load server Sync settings." : "Could not load server Sync settings.";
        const details = "details" in data ? data.details?.trim() : "";
        throw new Error(details ? `${message} ${details}` : message);
      }
      setSettings(data);
      const [shareResponse, subscriptionResponse] = await Promise.all([
        fetch("/api/modules/sync/federation/shares", { headers: { "x-department-id": departmentId }, cache: "no-store" }),
        fetch("/api/modules/sync/federation/subscriptions", { headers: { "x-department-id": departmentId }, cache: "no-store" }),
      ]);
      const readinessResponse = await fetch("/api/modules/sync/federation/redundancy/readiness", { headers: { "x-department-id": departmentId }, cache: "no-store" });
      if (readinessResponse.ok) setRedundancyReadiness(await readinessResponse.json() as RedundancyReadiness);
      const [shareData, subscriptionData] = await Promise.all([shareResponse.json() as Promise<{ shares?: Share[] }>, subscriptionResponse.json() as Promise<{ subscriptions?: Subscription[] }>]);
      if (shareResponse.ok) setShares(shareData.shares ?? []);
      if (subscriptionResponse.ok) {
        const list = subscriptionData.subscriptions ?? [];
        setSubscriptions(list);
        const active = list.filter((item) => item.state === "active");
        const entries = await Promise.all(active.map(async (item) => {
          const response = await fetch(`/api/modules/sync/federation/replicas?subscriptionId=${encodeURIComponent(item.id)}`, { headers: { "x-department-id": departmentId }, cache: "no-store" });
          const data = await response.json() as { records?: Array<{ scope: string; sourceId: string; record: Record<string, unknown> }> };
          return [item.id, response.ok ? data.records ?? [] : []] as const;
        }));
        setReplicas(Object.fromEntries(entries));
      }
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load server Sync settings."); }
  }, [departmentId]);

  useEffect(() => { void load(); }, [load]);

  async function request<T>(path: string, method: string, body?: object): Promise<T> {
    const response = await fetch(path, { method, headers: { "x-csrf-token": csrfToken, "x-department-id": departmentId, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "The request failed.");
    return data;
  }

  async function loadRedundancyPeerSites(peerInstallationId: string) {
    setRedundancyPeerId(peerInstallationId);
    setRedundancyPeerSites([]); setRedundancyPeerSiteId("");
    if (!peerInstallationId) return;
    setBusy("redundancy-sites"); setError("");
    try {
      const result = await request<{ sites: RedundancyPeerSite[] }>(`/api/modules/sync/federation/redundancy/peer-sites?peerInstallationId=${encodeURIComponent(peerInstallationId)}`, "GET");
      setRedundancyPeerSites(result.sites ?? []);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load the selected server's locations."); }
    finally { setBusy(""); }
  }

  async function configureStandby() {
    if (!redundancyPeerId || !redundancyPeerSiteId) return;
    if (!window.confirm("The next primary snapshot will replace this location's existing data. Continue?")) return;
    setBusy("redundancy-standby"); setError(""); setFeedback("");
    try {
      await request("/api/modules/sync/federation/redundancy/standby", "POST", { sourceInstallationId: redundancyPeerId, sourceDepartmentId: redundancyPeerSiteId, replaceExistingData: true });
      setFeedback("This location is configured as a read-only standby. The primary will begin automatic replication; use Push snapshot to sync immediately."); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not configure this location as a standby."); }
    finally { setBusy(""); }
  }

  async function requestStandby() {
    if (!redundancyPeerId || !redundancyPeerSiteId) return;
    setBusy("redundancy-request-standby"); setError(""); setFeedback("");
    try {
      const result = await request<{ destination: string }>("/api/modules/sync/federation/redundancy/request-standby", "POST", { peerInstallationId: redundancyPeerId, targetDepartmentId: redundancyPeerSiteId });
      setFeedback(`Standby request sent for ${result.destination}. A Server Administrator on that server must approve it.`); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not send a standby request."); }
    finally { setBusy(""); }
  }

  async function reviewStandbyRequest(item: RedundancyReadiness["pendingStandbyRequests"][number], decision: "approve" | "reject") {
    if (decision === "approve" && !window.confirm(`Approve ${item.sourceServerName} · ${item.sourceDepartmentName} as this site's primary? Its next verified snapshot will replace this site's replicated data.`)) return;
    setBusy(`standby-request:${item.id}`); setError(""); setFeedback("");
    try {
      await request(`/api/modules/sync/federation/redundancy/standby-requests/${item.id}/review`, "POST", { decision, confirmReplace: decision === "approve" });
      setFeedback(decision === "approve" ? "Standby enabled. The primary will send its first snapshot shortly." : "Standby request rejected."); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not review the standby request."); }
    finally { setBusy(""); }
  }

  async function pushRedundancySnapshot() {
    if (!redundancyPeerId || !redundancyPeerSiteId) return;
    setBusy("redundancy-push"); setError(""); setFeedback("");
    try {
      const result = await request<{ snapshotId: string; verifiedAt: string; unchanged?: boolean }>("/api/modules/sync/federation/redundancy/push", "POST", { peerInstallationId: redundancyPeerId, targetDepartmentId: redundancyPeerSiteId });
      setFeedback(result.unchanged ? "The standby already matches the current site data." : `The standby accepted and verified snapshot ${result.snapshotId}.`); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not push the redundancy snapshot."); }
    finally { setBusy(""); }
  }

  async function fenceCurrentPrimary() {
    if (!window.confirm("This immediately makes this location read-only. Confirm the old primary has also been blocked from serving traffic or writes outside this app.")) return;
    setBusy("redundancy-fence"); setError(""); setFeedback("");
    try {
      await request("/api/modules/sync/federation/redundancy/fence", "POST", { note: fencingNote });
      setFencingNote(""); setFeedback("This server is fenced and read-only."); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not fence this location."); }
    finally { setBusy(""); }
  }

  async function promoteStandby() {
    if (!redundancyReadiness?.upstreamInstallationId) return;
    if (!window.confirm("Promotion enables writes on this server. Confirm the old primary has been externally fenced. Changes made there after the last snapshot may be missing.")) return;
    setBusy("redundancy-promote"); setError(""); setFeedback("");
    try {
      const result = await request<{ epoch: string }>("/api/modules/sync/federation/redundancy/promote", "POST", { fencedInstallationId: redundancyReadiness.upstreamInstallationId, fencingNote: promotionNote, confirmSnapshotDataLoss });
      setPromotionNote(""); setConfirmSnapshotDataLoss(false); setFeedback(`This server is primary at site epoch ${result.epoch}.`); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not promote this standby."); }
    finally { setBusy(""); }
  }

  async function discover(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("discover"); setError(""); setFeedback(""); setDiscovery(null); setVerified(false);
    try {
      const result = await request<Discovery>("/api/modules/sync/federation/discover", "POST", { baseUrl });
      setBaseUrl(result.baseUrl); setDiscovery(result);
      if (result.existingTrustState) setFeedback(`This installation is already known as ${result.existingTrustState}.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not verify that server."); }
    finally { setBusy(""); }
  }

  async function pair(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!discovery || !verified) return;
    setBusy("pair"); setError(""); setFeedback("");
    try {
      await request("/api/modules/sync/federation/peers", "POST", { baseUrl: discovery.baseUrl, pairingCode, expectedFingerprint: discovery.identity.fingerprint });
      setPairingCode(""); setDiscovery(null); setVerified(false);
      setFeedback("Connection request sent. A Server Administrator on the other server must verify and approve this server too.");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not pair with that server."); }
    finally { setBusy(""); }
  }

  async function createInvitation() {
    setBusy("invite"); setError(""); setFeedback("");
    try {
      const result = await request<{ id: string; pairingCode: string; expiresAt: string }>("/api/modules/sync/federation/invitations", "POST", {});
      setNewInvitation(result); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create an invitation."); }
    finally { setBusy(""); }
  }

  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setFeedback("Copied to clipboard."); }
    catch { setError("Clipboard access was denied. Select and copy the value manually."); }
  }

  async function cancelInvitation(id: string) {
    setBusy(`invite:${id}`); setError("");
    try { await request(`/api/modules/sync/federation/invitations/${id}`, "DELETE"); if (newInvitation?.id === id) setNewInvitation(null); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not revoke the invitation."); }
    finally { setBusy(""); }
  }

  async function checkPeer(peer: Peer) {
    setBusy(`check:${peer.installation_id}`); setError("");
    try {
      const result = await request<{ reachable: boolean; remoteTrustState: string }>(`/api/modules/sync/federation/peers/${peer.installation_id}/check`, "POST", {});
      setRemoteStates((current) => ({ ...current, [peer.installation_id]: result.remoteTrustState }));
      setFeedback(result.remoteTrustState === "trusted" ? `${peer.display_name} approved this installation.` : `${peer.display_name} is reachable; its trust state is ${result.remoteTrustState}.`);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : `Could not reach ${peer.display_name}.`); await load(); }
    finally { setBusy(""); }
  }

  async function approvePeer(peer: Peer) {
    setBusy(`approve:${peer.installation_id}`); setError(""); setFeedback("");
    try {
      await request(`/api/modules/sync/federation/peers/${peer.installation_id}/trust`, "PUT", {});
      setFeedback(`${peer.display_name} is now trusted. Data still requires a separate share grant.`); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : `Could not approve ${peer.display_name}.`); }
    finally { setBusy(""); }
  }

  async function revokePeer(peer: Peer) {
    if (!window.confirm(`Revoke trust for ${peer.display_name}? All sync grants to this server will stop.`)) return;
    setBusy(`revoke:${peer.installation_id}`); setError(""); setFeedback("");
    try { await request(`/api/modules/sync/federation/peers/${peer.installation_id}`, "DELETE"); setFeedback(`${peer.display_name} has been revoked.`); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : `Could not revoke ${peer.display_name}.`); }
    finally { setBusy(""); }
  }

  async function createShare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("share"); setError(""); setFeedback("");
    try {
      await request("/api/modules/sync/federation/shares", "POST", { peerInstallationId: selectedPeer, scopes: selectedScopes, deliveryMode });
      setFeedback("Share created. The recipient must accept it before records can sync."); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create the data share."); }
    finally { setBusy(""); }
  }

  async function revokeShare(share: Share) {
    if (!window.confirm(`Revoke this ${share.scopes.join(" and ")} share with ${share.peerName}?`)) return;
    setBusy(`share:${share.id}`); setError("");
    try { await request(`/api/modules/sync/federation/shares/${share.id}`, "DELETE"); setFeedback("Share revoked. The receiving server will purge its replica on its next sync."); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not revoke this share."); }
    finally { setBusy(""); }
  }

  async function pushShare(share: Share) {
    setBusy(`push:${share.id}`); setError(""); setFeedback("");
    try {
      const result = await request<{ recordCount: number; destinationCount: number }>(`/api/modules/sync/federation/shares/${share.id}/push`, "POST", {});
      setFeedback(`Pushed ${result.recordCount} records to ${result.destinationCount} accepted location(s).`); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not push the shared data."); await load(); }
    finally { setBusy(""); }
  }

  async function discoverGrants() {
    setBusy("discover-grants"); setError(""); setFeedback("");
    try { const result = await request<{ grants: IncomingGrant[] }>("/api/modules/sync/federation/discover-grants", "POST", {}); setIncomingGrants(result.grants); setFeedback(result.grants.length ? `Found ${result.grants.length} available share(s).` : "No active shares are available from trusted servers."); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not find incoming shares."); }
    finally { setBusy(""); }
  }

  async function acceptGrant(grant: IncomingGrant) {
    setBusy(`accept:${grant.id}`); setError("");
    try { await request("/api/modules/sync/federation/subscriptions", "POST", { sourceInstallationId: grant.sourceInstallationId, sourceGrantId: grant.id }); setFeedback("Share accepted. Run Sync now to pull the records, or ask the source administrator to push them."); await load(); await discoverGrants(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not accept this share."); }
    finally { setBusy(""); }
  }

  async function rejectSubscription(subscription: Subscription) {
    if (!window.confirm(`Remove the shared data from ${subscription.sourceServerName}?`)) return;
    setBusy(`remove:${subscription.id}`); setError("");
    try { await request(`/api/modules/sync/federation/subscriptions/${subscription.id}`, "DELETE"); setFeedback("Subscription removed and its managed replica purged."); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not remove the subscription."); }
    finally { setBusy(""); }
  }

  async function pullSubscription(subscription: Subscription) {
    setBusy(`sync:${subscription.id}`); setError(""); setFeedback("");
    try { const result = await request<{ recordCount: number }>(`/api/modules/sync/federation/subscriptions/${subscription.id}/sync`, "POST", {}); setFeedback(`Received ${result.recordCount} records from ${subscription.sourceServerName}.`); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : `Could not sync ${subscription.sourceServerName}.`); await load(); }
    finally { setBusy(""); }
  }

  return <section className="directory-card federation-settings-card">
    <div className="directory-heading"><div><h2><ShieldCheck size={18} />Server-to-server Sync</h2><p>Pair Smart-Church installations. Peer trust alone does not grant access to site data.</p></div><button className="button button-secondary" type="button" onClick={() => void load()} disabled={Boolean(busy)}><RefreshCw size={15} />Refresh</button></div>
    {error && <p className="federation-message federation-error" role="alert">{error}</p>}
    {feedback && <p className="federation-message federation-success" role="status">{feedback}</p>}
    {settings && <div className="federation-identity"><div><strong>This server identity</strong><small>{settings.identity.displayName} · generated automatically and stored on this server</small></div><code>{settings.identity.fingerprint}</code></div>}

    <div className="federation-two-column">
      <article className="federation-panel"><div className="federation-panel-heading"><div><h3>Invite another server</h3><p>Generate a one-time code and share it with its Server Administrator.</p></div><button type="button" className="button button-primary" onClick={() => void createInvitation()} disabled={Boolean(busy)}><Plus size={15} />Create invitation</button></div>
        {newInvitation && <div className="federation-invite"><strong>Share this code once</strong><code>{newInvitation.pairingCode}</code><div><button type="button" className="button button-secondary" onClick={() => void copy(newInvitation.pairingCode)}><Copy size={14} />Copy code</button><button type="button" className="button button-danger" onClick={() => void cancelInvitation(newInvitation.id)} disabled={Boolean(busy)}>Revoke</button><small>Expires {new Date(newInvitation.expiresAt).toLocaleString()}</small></div></div>}
        {settings?.invitations.filter((item) => item.id !== newInvitation?.id).map((item) => <div className="federation-list-row" key={item.id}><span>Unused invitation · expires {new Date(item.expires_at).toLocaleString()}</span><button type="button" className="button button-danger" onClick={() => void cancelInvitation(item.id)} disabled={Boolean(busy)}><Trash2 size={14} />Revoke</button></div>)}
      </article>
      <article className="federation-panel"><div className="federation-panel-heading"><div><h3>Connect to another server</h3><p>Verify the full fingerprint out of band before accepting its identity.</p></div></div>
        <form className="federation-connect-form" onSubmit={discover}><label>Server URL<input type="url" required placeholder="https://church.example.org" value={baseUrl} onChange={(event) => { setBaseUrl(event.target.value); setDiscovery(null); setVerified(false); }} /></label><button type="submit" className="button button-secondary" disabled={Boolean(busy) || !baseUrl.trim()}><Link2 size={15} />{busy === "discover" ? "Verifying…" : "Verify server"}</button></form>
        {discovery && <form className="federation-discovery" onSubmit={pair}><strong>{discovery.identity.displayName}</strong><small>Installation ID: {discovery.identity.installationId}</small><code>{discovery.identity.fingerprint}</code><label>One-time invitation code from that server<input type="password" autoComplete="off" value={pairingCode} onChange={(event) => setPairingCode(event.target.value)} required /></label><label className="federation-confirm"><input type="checkbox" checked={verified} onChange={(event) => setVerified(event.target.checked)} />I compared the full fingerprint with the administrator of this server.</label><button type="submit" className="button button-primary" disabled={Boolean(busy) || !verified || !pairingCode.trim()}><ShieldCheck size={15} />{busy === "pair" ? "Connecting…" : "Send connection request"}</button></form>}
      </article>
    </div>

    <div className="federation-peer-section"><h3>Known servers</h3>
      {!settings?.peers.length && <p className="sync-help">No servers have been paired yet.</p>}
      {settings?.peers.map((peer) => <article className={`federation-peer federation-peer-${peer.trust_state}`} key={peer.installation_id}><div className="federation-peer-details"><div className="federation-peer-title"><strong>{peer.display_name}</strong><span className={`federation-state federation-state-${peer.trust_state}`}>{peer.trust_state}</span><span>{peer.direction === "incoming" ? "Incoming request" : "Outgoing request"}</span></div><small>{peer.base_url ?? "Outbound-only · no callback address"} · {peer.installation_id}</small><code>{peer.fingerprint}</code>{peer.last_seen_at && <small>Last checked: {new Date(peer.last_seen_at).toLocaleString()}</small>}{peer.last_error && <small className="federation-last-error">Last check failed: {peer.last_error}</small>}{remoteStates[peer.installation_id] && <small>Remote status: {remoteStates[peer.installation_id]}</small>}</div><div className="federation-peer-actions">
        {peer.trust_state !== "revoked" && <button type="button" className="button button-secondary" onClick={() => void checkPeer(peer)} disabled={Boolean(busy) || !peer.base_url} title={!peer.base_url ? "This installation cannot be called back; check from that server." : undefined}><RefreshCw size={14} />{busy === `check:${peer.installation_id}` ? "Checking…" : "Check"}</button>}
        {peer.trust_state === "pending" && peer.direction === "incoming" && <button type="button" className="button button-primary" onClick={() => void approvePeer(peer)} disabled={Boolean(busy)}><ShieldCheck size={14} />{busy === `approve:${peer.installation_id}` ? "Approving…" : "Approve"}</button>}
        {peer.trust_state === "pending" && peer.direction === "outgoing" && <button type="button" className="button button-primary" onClick={() => void approvePeer(peer)} disabled={Boolean(busy) || remoteStates[peer.installation_id] !== "trusted"}><Check size={14} />Approve remote</button>}
        {peer.trust_state !== "revoked" && <button type="button" className="button button-danger" onClick={() => void revokePeer(peer)} disabled={Boolean(busy)}><ShieldOff size={14} />Revoke</button>}
      </div></article>)}
    </div>
    <div className="federation-peer-section"><h3>Share this location</h3><p className="sync-help">Only share selected fields with a trusted server. Sync runs when an administrator starts Push or Sync now; automatic background sync is not enabled. To copy data both ways, create and accept a share in each direction.</p>
      <form className="federation-share-form" onSubmit={createShare}>
        <label>Trusted server<select required value={selectedPeer} onChange={(event) => setSelectedPeer(event.target.value)}><option value="">Choose a server</option>{settings?.peers.filter((peer) => peer.trust_state === "trusted").map((peer) => <option key={peer.installation_id} value={peer.installation_id}>{peer.display_name}</option>)}</select></label>
        <label>Sync initiator<select value={deliveryMode} onChange={(event) => setDeliveryMode(event.target.value as "pull" | "push")}><option value="pull" disabled={!settings?.canReceiveCallbacks}>Receiving server pulls</option><option value="push">This server pushes outbound</option></select></label>
        {!settings?.canReceiveCallbacks && <small className="sync-help">This development server has no public HTTPS callback address. It can still send data to a reachable HTTPS server by using outbound push.</small>}
        <div className="federation-scope-options">{availableScopes.map((scope) => <label key={scope.id}><input type="checkbox" checked={selectedScopes.includes(scope.id)} onChange={(event) => setSelectedScopes((current) => event.target.checked ? [...current, scope.id] : current.filter((item) => item !== scope.id))} /><span><strong>{scope.label}</strong><small>{scope.detail}</small></span></label>)}</div>
        <button type="submit" className="button button-primary" disabled={Boolean(busy) || !selectedPeer || !selectedScopes.length}><Plus size={15} />Create share</button>
      </form>
      {shares.map((share) => <article className="federation-peer" key={share.id}><div className="federation-peer-details"><div className="federation-peer-title"><strong>{share.peerName}</strong><span className={`federation-state federation-state-${share.state === "active" ? "trusted" : "revoked"}`}>{share.state}</span></div><small>{share.scopes.map((scope) => availableScopes.find((item) => item.id === scope)?.label ?? scope).join(" · ")} · {share.deliveryMode === "push" ? "This server pushes outbound" : "Receiver pulls"}</small>{share.lastPushedAt && <small>Last push: {new Date(share.lastPushedAt).toLocaleString()}</small>}{share.lastPushError && <small className="federation-last-error">Last push failed: {share.lastPushError}</small>}</div><div className="federation-peer-actions">{share.state === "active" && share.deliveryMode === "push" && <button type="button" className="button button-primary" onClick={() => void pushShare(share)} disabled={Boolean(busy)}><RefreshCw size={14} />{busy === `push:${share.id}` ? "Pushing…" : "Push now"}</button>}{share.state === "active" && <button type="button" className="button button-danger" onClick={() => void revokeShare(share)} disabled={Boolean(busy)}><ShieldOff size={14} />Revoke</button>}</div></article>)}
    </div>

    <div className="federation-peer-section"><div className="federation-panel-heading"><div><h3>Shared with this location</h3><p>Only a Server Administrator can create server trust; a Site Administrator decides whether to receive shared data.</p></div><button type="button" className="button button-secondary" onClick={() => void discoverGrants()} disabled={Boolean(busy)}><RefreshCw size={14} />{busy === "discover-grants" ? "Checking…" : "Find shares"}</button></div>
      {incomingGrants.map((grant) => { const accepted = subscriptions.some((item) => item.sourceInstallationId === grant.sourceInstallationId && item.sourceGrantId === grant.id && item.state !== "rejected"); return <article className="federation-peer" key={`${grant.sourceInstallationId}:${grant.id}`}><div className="federation-peer-details"><strong>{grant.sourceDepartmentName} · {grant.sourceServerName}</strong><small>{grant.scopes.map((scope) => availableScopes.find((item) => item.id === scope)?.label ?? scope).join(" · ")} · {grant.deliveryMode === "push" ? "Source pushes outbound" : "This server pulls"}</small></div><button type="button" className="button button-primary" onClick={() => void acceptGrant(grant)} disabled={Boolean(busy) || accepted}>{accepted ? "Accepted" : busy === `accept:${grant.id}` ? "Accepting…" : "Accept share"}</button></article>; })}
      {subscriptions.map((subscription) => <article className="federation-peer" key={subscription.id}><div className="federation-peer-details"><div className="federation-peer-title"><strong>{subscription.sourceServerName}</strong><span className={`federation-state federation-state-${subscription.state === "active" ? "trusted" : subscription.state === "revoked" ? "revoked" : "pending"}`}>{subscription.state}</span></div><small>{subscription.scopes.map((scope) => availableScopes.find((item) => item.id === scope)?.label ?? scope).join(" · ")} · {subscription.deliveryMode === "push" ? "Source pushes outbound" : "This server pulls"} · {subscription.recordCount} records</small>{subscription.lastSyncedAt && <small>Last sync: {new Date(subscription.lastSyncedAt).toLocaleString()}</small>}{subscription.lastError && <small className="federation-last-error">Last sync failed: {subscription.lastError}</small>}</div><div className="federation-peer-actions">{subscription.state === "active" && <button type="button" className="button button-primary" onClick={() => void pullSubscription(subscription)} disabled={Boolean(busy)}><RefreshCw size={14} />{busy === `sync:${subscription.id}` ? "Syncing…" : subscription.deliveryMode === "push" ? "Pull now" : "Sync now"}</button>}{subscription.state === "active" && <button type="button" className="button button-danger" onClick={() => void rejectSubscription(subscription)} disabled={Boolean(busy)}><Trash2 size={14} />Remove</button>}</div>
        {replicas[subscription.id]?.length > 0 && <div className="federation-replica-list">{replicas[subscription.id].map((item) => <div className="federation-replica-record" key={`${item.scope}:${item.sourceId}`}>{item.scope === "people_names" ? <><strong>{String(item.record.firstName)} {String(item.record.lastName)}</strong><small>{String(item.record.status)}</small></> : <><strong>{String(item.record.title)}</strong><small>{String(item.record.eventDate)} {String(item.record.startTime)} · {String(item.record.location)}</small>{item.record.description && <small>{String(item.record.description)}</small>}</>}</div>)}</div>}
      </article>)}
      {!incomingGrants.length && !subscriptions.length && <p className="sync-help">No incoming shares are configured for this location.</p>}
    </div>
    <article className="federation-panel federation-redundancy">
      <div className="federation-panel-heading"><div><h3>Site redundancy</h3><p>One writable primary, read-only standby servers, and manual promotion after fencing the old primary.</p></div><span className={`federation-state federation-state-${redundancyReadiness?.ready ? "trusted" : "pending"}`}>{redundancyReadiness?.ready ? "Recovery checks passed" : "Not ready"}</span></div>
      <p>Replication uses the existing HTTPS/API connection. A server without port forwarding can push outbound to a reachable standby. Before promotion, power off or externally block the old primary; the confirmation below records that action but cannot perform it for you.</p>
      <p className="sync-help">Full-site snapshots include user profile data and password hashes so members can sign in after failover. Users sign in again; active sessions and server-wide roles and permissions stay local to each server.</p>
      <p className="sync-help">The primary automatically pushes a complete snapshot to each configured standby about once per minute over the existing HTTPS/API connection. Larger transfers or connection failures can increase replication lag. Promotion requires a snapshot verified within the last five minutes; writes after that snapshot may be lost.</p>
      <div className="federation-redundancy-status"><strong>Current role: {redundancyReadiness?.role ?? "unknown"}</strong><span>Site epoch: {redundancyReadiness?.siteEpoch ?? "—"}</span><span>Module checks: {redundancyReadiness?.modulesReady ? "Ready" : "Not ready"}</span><span>Replica: {redundancyReadiness?.snapshotVerified ? "Matches last snapshot" : "Not verified"}</span>{redundancyReadiness?.upstreamInstallationId && <span>Configured primary: {settings?.peers.find((peer) => peer.installation_id === redundancyReadiness.upstreamInstallationId)?.display_name ?? redundancyReadiness.upstreamInstallationId} · location {redundancyReadiness.upstreamDepartmentId}</span>}{redundancyReadiness?.lastSnapshotAt && <span>Last snapshot: {new Date(redundancyReadiness.lastSnapshotAt).toLocaleString()}</span>}{redundancyReadiness?.lastVerifiedAt && <span>Last verified: {new Date(redundancyReadiness.lastVerifiedAt).toLocaleString()}</span>}{redundancyReadiness?.lastError && <span className="federation-error">Last replication error: {redundancyReadiness.lastError}</span>}</div>
      {redundancyReadiness?.role === "primary" && <><strong>Standby replication</strong>{redundancyReadiness.replicas.length ? <ul>{redundancyReadiness.replicas.map((replica) => <li key={`${replica.peer_installation_id}:${replica.peer_department_id}`}><strong>{replica.peer_name ?? replica.peer_installation_id}:</strong> {replica.last_verified_at ? `verified ${new Date(replica.last_verified_at).toLocaleString()}` : "waiting for first verified snapshot"}{replica.last_error && <span className="federation-error"> · {replica.last_error}</span>}</li>)}</ul> : <p className="sync-help">No verified standby targets yet. Configure a standby on a trusted server; the primary will discover and sync it automatically.</p>}</>}
      <strong>Enabled-module readiness</strong>{redundancyReadiness?.modules.length ? <ul>{redundancyReadiness.modules.map((module) => <li key={module.moduleId}><strong>{module.moduleName}:</strong> {module.ready ? `ready · ${module.recordCount ?? 0} records` : module.blockers.join(" ")}</li>)}</ul> : <p className="sync-help">Module readiness could not be loaded for this location.</p>}<p>{redundancyReadiness?.reason ?? "Every enabled module must pass its local recovery check."}</p>
      {redundancyReadiness?.pendingStandbyRequests?.length > 0 && <section className="federation-redundancy-action"><h4>Incoming standby requests</h4><p>A Server Administrator here chooses whether this site accepts the other server's snapshots.</p>{redundancyReadiness.pendingStandbyRequests.map((item) => <article className="federation-peer" key={item.id}><div className="federation-peer-details"><strong>{item.sourceServerName} · {item.sourceDepartmentName}</strong><small>Site epoch {item.sourceEpoch} · requested {new Date(item.createdAt).toLocaleString()}</small></div><div className="federation-peer-actions"><button type="button" className="button button-primary" onClick={() => void reviewStandbyRequest(item, "approve")} disabled={Boolean(busy)}>{busy === `standby-request:${item.id}` ? "Saving…" : "Approve standby"}</button><button type="button" className="button button-danger" onClick={() => void reviewStandbyRequest(item, "reject")} disabled={Boolean(busy)}>Reject</button></div></article>)}</section>}
      {redundancyReadiness?.role === "primary" && <section className="federation-redundancy-action"><h4>Primary actions</h4><label>Trusted standby server<select value={redundancyPeerId} onChange={(event) => void loadRedundancyPeerSites(event.target.value)}><option value="">Choose a server</option>{settings?.peers.filter((peer) => peer.trust_state === "trusted").map((peer) => <option key={peer.installation_id} value={peer.installation_id}>{peer.display_name}</option>)}</select></label><label>Standby location<select value={redundancyPeerSiteId} onChange={(event) => setRedundancyPeerSiteId(event.target.value)} disabled={!redundancyPeerSites.length}><option value="">Choose a location</option>{redundancyPeerSites.map((site) => <option key={site.id} value={site.id}>{site.name} · {site.id} · {site.role}</option>)}</select></label><div className="community-inline-actions"><button className="button button-primary" type="button" onClick={() => void requestStandby()} disabled={busy !== "" || !redundancyPeerId || !redundancyPeerSiteId}><Plus size={15} />Request selected location as standby</button><button className="button button-secondary" type="button" onClick={() => void pushRedundancySnapshot()} disabled={busy !== "" || !redundancyPeerId || !redundancyPeerSiteId}><RefreshCw size={15} />{busy === "redundancy-push" ? "Pushing…" : "Push snapshot"}</button></div><label>Describe the external fencing action<textarea value={fencingNote} onChange={(event) => setFencingNote(event.target.value)} minLength={20} maxLength={1000} placeholder="For example: WAN uplink disconnected and the server powered off." /></label><button className="button button-danger" type="button" onClick={() => void fenceCurrentPrimary()} disabled={busy !== "" || fencingNote.trim().length < 20}>Fence this server and make it read-only</button></section>}
      {redundancyReadiness?.role === "standby" && <section className="federation-redundancy-action"><h4>Standby actions</h4><p>Promotion is enabled after local module checks pass and this standby still matches its last snapshot. This does not confirm that the primary has no newer writes.</p><label>Confirm the old primary installation<input value={redundancyReadiness.upstreamInstallationId ?? ""} readOnly /></label><label>Describe how the old primary was fenced<textarea value={promotionNote} onChange={(event) => setPromotionNote(event.target.value)} minLength={20} maxLength={1000} placeholder="For example: power removed and router rule blocks its LAN and WAN traffic." /></label><label className="federation-confirm"><input type="checkbox" checked={confirmSnapshotDataLoss} onChange={(event) => setConfirmSnapshotDataLoss(event.target.checked)} />I understand primary changes made after the last snapshot may be missing from this standby.</label><button className="button button-danger" type="button" onClick={() => void promoteStandby()} disabled={busy !== "" || !redundancyReadiness.ready || promotionNote.trim().length < 20 || !confirmSnapshotDataLoss}>{busy === "redundancy-promote" ? "Promoting…" : "Promote this standby"}</button></section>}
      {redundancyReadiness?.role === "fenced" && <section className="federation-redundancy-action"><h4>Rejoin as standby</h4><p>This server is fenced and read-only. Select the newer primary; its next verified snapshot will replace this site's data.</p><label>New primary server<select value={redundancyPeerId} onChange={(event) => void loadRedundancyPeerSites(event.target.value)}><option value="">Choose a server</option>{settings?.peers.filter((peer) => peer.trust_state === "trusted").map((peer) => <option key={peer.installation_id} value={peer.installation_id}>{peer.display_name}</option>)}</select></label><label>Primary location<select value={redundancyPeerSiteId} onChange={(event) => setRedundancyPeerSiteId(event.target.value)} disabled={!redundancyPeerSites.length}><option value="">Choose a location</option>{redundancyPeerSites.map((site) => <option key={site.id} value={site.id}>{site.name} · {site.id} · {site.role}</option>)}</select></label><button className="button button-secondary" type="button" onClick={() => void configureStandby()} disabled={busy !== "" || !redundancyPeerId || !redundancyPeerSiteId}><Plus size={15} />Configure as standby and replace data</button></section>}
    </article>
    <p className="federation-footnote">Transfers use this server’s existing HTTPS/API connection only. Push mode means the source opens an outbound connection; it does not need port forwarding. People scope sends names and member/visitor status only; private contact information and login data are excluded. Schedule scope excludes attendance, registrations, and assignments.</p>
  </section>;
}
