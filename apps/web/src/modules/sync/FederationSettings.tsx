import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Check, Copy, Link2, Plus, RefreshCw, ShieldCheck, ShieldOff, Trash2 } from "lucide-react";
import { getActiveLanguage } from "../../i18n";
import { translateModuleText } from "../../module-registry";
import { translationsForModule } from "../translations";
import type { DepartmentProfile } from "@smart-church/contracts";

type FederationIdentity = { installationId: string; displayName: string; publicKeyPem: string; fingerprint: string; protocolVersion: string };
type ConnectionMode = "both" | "creator_to_joiner" | "joiner_to_creator";
type Peer = { installation_id: string; display_name: string; base_url: string | null; fingerprint: string; trust_state: "pending" | "trusted" | "revoked"; direction: "incoming" | "outgoing"; outbound_enabled: boolean; inbound_enabled: boolean; created_at: string; approved_at: string | null; last_seen_at: string | null; last_error: string | null; channels?: { inbound: boolean; outbound: boolean; outboundError?: string | null } };
type Invitation = { id: string; expires_at: string; created_at: string; connection_mode: ConnectionMode };
type PeerSettings = { identity: FederationIdentity; peers: Peer[]; invitations: Invitation[] };
type Discovery = { baseUrl: string; identity: FederationIdentity; existingTrustState: string | null };
type Share = { id: string; recipientInstallationId: string; recipientDepartmentId: string | null; peerName: string; scopes: string[]; deliveryMode: "pull" | "push"; state: "active" | "revoked"; createdAt: string; lastPushedAt: string | null; lastPushError: string | null };
type Subscription = { id: string; sourceInstallationId: string; sourceServerName: string; sourceBaseUrl: string; sourceGrantId: string; scopes: string[]; deliveryMode: "pull" | "push"; state: "pending" | "active" | "rejected" | "revoked"; lastSyncedAt: string | null; lastError: string | null; sourceRevision: string | null; recordCount: number };
type IncomingGrant = { id: string; sourceInstallationId: string; sourceServerName: string; sourceDepartmentName: string; recipientDepartmentId: string | null; recipientDepartmentName: string | null; scopes: string[]; deliveryMode: "pull" | "push"; revision: number; createdAt: string };
type RedundancyReadiness = { departmentId: string; role: "primary" | "standby" | "fenced" | "unknown"; primaryInstallationId: string | null; upstreamInstallationId: string | null; upstreamDepartmentId: string | null; siteEpoch: string | null; lastSnapshotId: string | null; lastSnapshotAt: string | null; lastVerifiedAt: string | null; lastError: string | null; replicas: Array<{ peer_installation_id: string; peer_department_id: string; peer_name: string | null; last_snapshot_id: string | null; last_snapshot_at: string | null; last_verified_at: string | null; last_error: string | null }>; pendingStandbyRequests: Array<{ id: string; sourceInstallationId: string; sourceDepartmentId: string; sourceDepartmentName: string; sourceEpoch: string; sourceServerName: string; createdAt: string }>; pendingPullRequests: Array<{ id: string; targetInstallationId: string; targetDepartmentId: string; targetDepartmentName: string; sourceEpoch: string; targetServerName: string; createdAt: string }>; modulesReady: boolean; snapshotVerified: boolean; ready: boolean; reason: string; modules: Array<{ moduleId: string; moduleName: string; ready: boolean; schemaVersion: string | null; installedVersion: string | null; recordCount: number | null; blockers: string[] }> };
type RedundancyPeerSite = { id: string; name: string; time_zone: string; role: string };

const availableScopes = [{ id: "people_names", label: "People names", detail: "Names and member/visitor status only. No contact details or login data." }, { id: "services", label: "Services & events", detail: "Schedule details only. No attendance, registrations, or assignments." }];
const connectionModeLabel = (mode: ConnectionMode) => mode === "both" ? "Both servers initiate" : mode === "creator_to_joiner" ? "Invitation creator → joining server" : "Joining server → invitation creator";

export function FederationSettings({ csrfToken, departmentId, departments }: { csrfToken: string; departmentId: string; departments: Array<Pick<DepartmentProfile, "id" | "location">> }) {
  const language = getActiveLanguage();
  const tr = (value: string) => translateModuleText(value, translationsForModule("sync"), language);
  const [settings, setSettings] = useState<PeerSettings | null>(null);
  const [shares, setShares] = useState<Share[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [incomingGrants, setIncomingGrants] = useState<IncomingGrant[]>([]);
  const [redundancyReadiness, setRedundancyReadiness] = useState<RedundancyReadiness | null>(null);
  const [redundancyPeerId, setRedundancyPeerId] = useState("");
  const [redundancyPeerSites, setRedundancyPeerSites] = useState<RedundancyPeerSite[]>([]);
  const [redundancyPeerSiteId, setRedundancyPeerSiteId] = useState("");
  const [fencingNote, setFencingNote] = useState("");
  const [promotionNote, setPromotionNote] = useState("");
  const [confirmSnapshotDataLoss, setConfirmSnapshotDataLoss] = useState(false);
  const [selectedScopes, setSelectedScopes] = useState<string[]>(["services"]);
  const [deliveryMode, setDeliveryMode] = useState<"pull" | "push">("push");
  const [baseUrl, setBaseUrl] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [verified, setVerified] = useState(false);
  const [newInvitation, setNewInvitation] = useState<{ id: string; pairingCode: string; expiresAt: string; connectionMode: ConnectionMode } | null>(null);
  const [invitationConnectionMode, setInvitationConnectionMode] = useState<ConnectionMode>("both");
  const [remoteStates, setRemoteStates] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [wizard, setWizard] = useState<"sync" | "share" | null>(null);
  const [wizardSourceId, setWizardSourceId] = useState(departmentId);
  const [wizardPeerId, setWizardPeerId] = useState("");
  const [wizardDestinationId, setWizardDestinationId] = useState("");
  const [wizardSites, setWizardSites] = useState<RedundancyPeerSite[]>([]);

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
      if (subscriptionResponse.ok) setSubscriptions(subscriptionData.subscriptions ?? []);
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load server Sync settings."); }
  }, [departmentId]);

  const refreshChannelStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/modules/sync/federation/channels", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json() as { channels?: Array<{ installationId: string; inbound: boolean; outbound: boolean; outboundError?: string | null }> };
      const statuses = new Map((data.channels ?? []).map((channel) => [channel.installationId, channel]));
      setSettings((current) => current ? {
        ...current,
        peers: current.peers.map((peer) => {
          const channel = statuses.get(peer.installation_id);
          return {
            ...peer,
            channels: channel
              ? { inbound: channel.inbound, outbound: channel.outbound, outboundError: channel.outboundError }
              : { inbound: false, outbound: false, outboundError: null },
          };
        }),
      } : current);
    } catch { /* Keep the last known state until the next poll. */ }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => { void refreshChannelStatus(); }, 5_000);
    return () => window.clearInterval(timer);
  }, [refreshChannelStatus]);

  async function request<T>(path: string, method: string, body?: object, requestDepartmentId = departmentId): Promise<T> {
    const response = await fetch(path, { method, headers: { "x-csrf-token": csrfToken, "x-department-id": requestDepartmentId, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "The request failed.");
    return data;
  }

  async function loadWizardSites(peerInstallationId: string) {
    setWizardPeerId(peerInstallationId); setWizardDestinationId(""); setWizardSites([]);
    if (!peerInstallationId) return;
    setBusy("wizard-sites"); setError("");
    try {
      const result = await request<{ sites: RedundancyPeerSite[] }>(`/api/modules/sync/federation/redundancy/peer-sites?peerInstallationId=${encodeURIComponent(peerInstallationId)}`, "GET", undefined, wizardSourceId);
      setWizardSites(result.sites);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load destination sites."); }
    finally { setBusy(""); }
  }

  async function submitWizard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!wizard || !wizardSourceId || !wizardPeerId || (wizard === "share" && !wizardDestinationId)) return;
    setBusy("wizard-submit"); setError(""); setFeedback("");
    try {
      if (wizard === "sync") {
        const result = await request<{ destination: string; requestState: string }>("/api/modules/sync/federation/redundancy/create-replica", "POST", { peerInstallationId: wizardPeerId }, wizardSourceId);
        setFeedback(`Created ${result.destination}. The destination Server Administrator must approve the standby request before replication starts.`);
      } else {
        await request("/api/modules/sync/federation/shares", "POST", { peerInstallationId: wizardPeerId, recipientDepartmentId: wizardDestinationId, scopes: selectedScopes, deliveryMode }, wizardSourceId);
        setFeedback("Share created. The destination site can now find and accept it.");
      }
      setWizard(null); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create the connection."); }
    finally { setBusy(""); }
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
    if (!window.confirm(tr("The next primary snapshot will replace this location's existing data. Continue?"))) return;
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

  async function requestOutboundStandby() {
    if (!redundancyPeerId || !redundancyPeerSiteId) return;
    if (!window.confirm(tr("This local site's data will be replaced by the selected primary's full snapshot after its administrator approves the request. Continue?"))) return;
    setBusy("redundancy-pull-request"); setError(""); setFeedback("");
    try {
      const result = await request<{ requestState: string; role: string }>("/api/modules/sync/federation/redundancy/request-pull-standby", "POST", { peerInstallationId: redundancyPeerId, sourceDepartmentId: redundancyPeerSiteId, replaceExistingData: true });
      setFeedback(result.requestState === "approved" ? "The source already approved this standby. Its first snapshot will be pulled over the authenticated WebSocket channel." : "Outbound standby request sent. The selected primary's administrator must approve it before any data is replaced."); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not request an outbound standby."); }
    finally { setBusy(""); }
  }

  async function reviewStandbyRequest(item: RedundancyReadiness["pendingStandbyRequests"][number], decision: "approve" | "reject") {
    if (decision === "approve" && !window.confirm(tr(`Approve ${item.sourceServerName} · ${item.sourceDepartmentName} as this site's primary? Its next verified snapshot will replace this site's replicated data.`))) return;
    setBusy(`standby-request:${item.id}`); setError(""); setFeedback("");
    try {
      await request(`/api/modules/sync/federation/redundancy/standby-requests/${item.id}/review`, "POST", { decision, confirmReplace: decision === "approve" });
      setFeedback(decision === "approve" ? "Standby enabled. The primary will send its first snapshot shortly." : "Standby request rejected."); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not review the standby request."); }
    finally { setBusy(""); }
  }

  async function reviewPullStandbyRequest(item: RedundancyReadiness["pendingPullRequests"][number], decision: "approve" | "reject") {
    if (decision === "approve" && !window.confirm(tr(`Approve ${item.targetServerName} · ${item.targetDepartmentName} to pull complete snapshots of this site's data?`))) return;
    setBusy(`pull-standby-request:${item.id}`); setError(""); setFeedback("");
    try {
      await request(`/api/modules/sync/federation/redundancy/pull-standby-requests/${item.id}/review`, "POST", { decision, confirmReplace: decision === "approve" });
      setFeedback(decision === "approve" ? "Outbound standby approved. The standby will pull and verify its first snapshot shortly." : "Outbound standby request rejected."); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not review the outbound standby request."); }
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

  async function pushReplica(replica: RedundancyReadiness["replicas"][number]) {
    setBusy(`replica:${replica.peer_installation_id}:${replica.peer_department_id}`); setError(""); setFeedback("");
    try {
      const result = await request<{ snapshotId: string; unchanged?: boolean }>("/api/modules/sync/federation/redundancy/push", "POST", { peerInstallationId: replica.peer_installation_id, targetDepartmentId: replica.peer_department_id });
      setFeedback(result.unchanged ? "The replica already matches this site." : `Replica updated with snapshot ${result.snapshotId}.`); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not sync this replica."); await load(); }
    finally { setBusy(""); }
  }

  async function fenceCurrentPrimary() {
    if (!window.confirm(tr("This immediately makes this location read-only. Confirm the old primary has also been blocked from serving traffic or writes outside this app."))) return;
    setBusy("redundancy-fence"); setError(""); setFeedback("");
    try {
      await request("/api/modules/sync/federation/redundancy/fence", "POST", { note: fencingNote });
      setFencingNote(""); setFeedback("This server is fenced and read-only."); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not fence this location."); }
    finally { setBusy(""); }
  }

  async function promoteStandby() {
    if (!redundancyReadiness?.upstreamInstallationId) return;
    if (!window.confirm(tr("Promotion enables writes on this server. Confirm the old primary has been externally fenced. Changes made there after the last snapshot may be missing."))) return;
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
      const result = await request<{ connectionMode: ConnectionMode }>("/api/modules/sync/federation/peers", "POST", { baseUrl: discovery.baseUrl, pairingCode, expectedFingerprint: discovery.identity.fingerprint });
      setPairingCode(""); setDiscovery(null); setVerified(false);
      setFeedback(`Connection request sent. Direction: ${connectionModeLabel(result.connectionMode)}. A Server Administrator on the other server must approve this server too.`);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not pair with that server."); }
    finally { setBusy(""); }
  }

  async function createInvitation() {
    setBusy("invite"); setError(""); setFeedback("");
    try {
      const result = await request<{ id: string; pairingCode: string; expiresAt: string; connectionMode: ConnectionMode }>("/api/modules/sync/federation/invitations", "POST", { connectionMode: invitationConnectionMode });
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
    if (!window.confirm(tr(`Remove the connection to ${peer.display_name}? Its WebSocket channel will close and all shares with this server will stop.`))) return;
    setBusy(`revoke:${peer.installation_id}`); setError(""); setFeedback("");
    try { await request(`/api/modules/sync/federation/peers/${peer.installation_id}`, "DELETE"); setFeedback(`Connection to ${peer.display_name} removed.`); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : `Could not revoke ${peer.display_name}.`); }
    finally { setBusy(""); }
  }

  async function revokeShare(share: Share) {
    if (!window.confirm(tr(`Revoke this ${share.scopes.join(" and ")} share with ${share.peerName}?`))) return;
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
    if (!window.confirm(tr(`Remove the shared data from ${subscription.sourceServerName}?`))) return;
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
    <div className="directory-heading"><div><h2><ShieldCheck size={18} />Smart-Church connections</h2><p>Connect sites across trusted Smart-Church servers.</p></div><button className="button button-secondary" type="button" onClick={() => void load()} disabled={Boolean(busy)}><RefreshCw size={15} />Refresh</button></div>
    {error && <p className="federation-message federation-error" role="alert">{error}</p>}
    {feedback && <p className="federation-message federation-success" role="status">{feedback}</p>}
    {settings && <div className="federation-identity"><div><strong>This server identity</strong><small>{settings.identity.displayName} · generated automatically and stored on this server</small></div><code>{settings.identity.fingerprint}</code></div>}

    {wizard && <div className="module-settings-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setWizard(null); }}><section className="module-settings-dialog federation-wizard" role="dialog" aria-modal="true" aria-labelledby="federation-wizard-title"><header className="module-settings-dialog-header"><div><span><h3 id="federation-wizard-title">{wizard === "sync" ? "Add Sync" : "Add Share"}</h3><small>{wizard === "sync" ? "Create a replica site on another server." : "Share selected data with a site on another server."}</small></span></div><button type="button" className="icon-button" aria-label="Close" onClick={() => setWizard(null)}>×</button></header><form className="federation-wizard-form" onSubmit={(event) => void submitWizard(event)}>
      <label>Source site<select value={wizardSourceId} onChange={(event) => { setWizardSourceId(event.target.value); setWizardPeerId(""); setWizardSites([]); }} required><option value="">Choose a site</option>{departments.map((site) => <option key={site.id} value={site.id}>{site.location}</option>)}</select></label>
      <label>Destination server<select value={wizardPeerId} onChange={(event) => void loadWizardSites(event.target.value)} required><option value="">Choose a trusted server</option>{settings?.peers.filter((peer) => peer.trust_state === "trusted").map((peer) => <option key={peer.installation_id} value={peer.installation_id}>{peer.display_name}</option>)}</select></label>
      {wizard === "share" && <label>Destination site<select value={wizardDestinationId} onChange={(event) => setWizardDestinationId(event.target.value)} disabled={!wizardSites.length || busy === "wizard-sites"} required><option value="">{busy === "wizard-sites" ? "Loading sites…" : "Choose a destination site"}</option>{wizardSites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>}
      {wizard === "sync" && <p className="sync-help">The destination will be named <strong>{departments.find((site) => site.id === wizardSourceId)?.location ?? "source site"}_replica</strong>. It starts empty and will only receive data after the destination Server Administrator approves it.</p>}
      {wizard === "share" && <><label>Sync initiator<select value={deliveryMode} onChange={(event) => setDeliveryMode(event.target.value as "pull" | "push")}><option value="push">This server pushes</option><option value="pull">Receiving server pulls</option></select></label><fieldset className="federation-scope-options">{availableScopes.map((scope) => <label key={scope.id}><input type="checkbox" checked={selectedScopes.includes(scope.id)} onChange={(event) => setSelectedScopes((current) => event.target.checked ? [...current, scope.id] : current.filter((item) => item !== scope.id))} /><span><strong>{scope.label}</strong><small>{scope.detail}</small></span></label>)}</fieldset></>}
      <div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setWizard(null)}>Cancel</button><button type="submit" className="button button-primary" disabled={Boolean(busy) || !wizardSourceId || !wizardPeerId || (wizard === "share" && (!wizardDestinationId || !selectedScopes.length))}><Plus size={15} />{busy === "wizard-submit" ? "Creating…" : wizard === "sync" ? "Create Sync" : "Create Share"}</button></div>
    </form></section></div>}

    <div className="federation-two-column">
      <article className="federation-panel"><div className="federation-panel-heading"><div><h3>Invite another server</h3><p>Generate a one-time code and share it with its Server Administrator.</p></div><button type="button" className="button button-primary" onClick={() => void createInvitation()} disabled={Boolean(busy)}><Plus size={15} />Create invitation</button></div>
        <label className="federation-direction-picker">WebSocket connection direction <select value={invitationConnectionMode} onChange={(event) => setInvitationConnectionMode(event.target.value as ConnectionMode)}><option value="both">Both servers initiate (A ↔ B)</option><option value="creator_to_joiner">Invitation creator initiates (A → B)</option><option value="joiner_to_creator">Joining server initiates (B → A)</option></select><small>A is this server, which creates the invitation code. This controls the persistent channel after pairing; the joining server still opens a temporary bootstrap connection to submit the code. Sync messages can travel both ways over an open channel.</small></label>
        {newInvitation && <div className="federation-invite"><strong>Share this code once</strong><code>{newInvitation.pairingCode}</code><small>WebSocket direction: {connectionModeLabel(newInvitation.connectionMode)}</small><div><button type="button" className="button button-secondary" onClick={() => void copy(newInvitation.pairingCode)}><Copy size={14} />Copy code</button><button type="button" className="button button-danger" onClick={() => void cancelInvitation(newInvitation.id)} disabled={Boolean(busy)}>Revoke</button><small>Expires {new Date(newInvitation.expiresAt).toLocaleString()}</small></div></div>}
        {settings?.invitations.filter((item) => item.id !== newInvitation?.id).map((item) => <div className="federation-list-row" key={item.id}><span>Unused invitation · {connectionModeLabel(item.connection_mode)} · expires {new Date(item.expires_at).toLocaleString()}</span><button type="button" className="button button-danger" onClick={() => void cancelInvitation(item.id)} disabled={Boolean(busy)}><Trash2 size={14} />Revoke</button></div>)}
      </article>
      <article className="federation-panel"><div className="federation-panel-heading"><div><h3>Connect to another server</h3><p>Verify the full fingerprint out of band before accepting its identity.</p></div></div>
        <form className="federation-connect-form" onSubmit={discover}><label>Server URL<input type="url" required placeholder="https://church.example.org" value={baseUrl} onChange={(event) => { setBaseUrl(event.target.value); setDiscovery(null); setVerified(false); }} /></label><button type="submit" className="button button-secondary" disabled={Boolean(busy) || !baseUrl.trim()}><Link2 size={15} />{busy === "discover" ? "Verifying…" : "Verify server"}</button></form>
        {discovery && <form className="federation-discovery" onSubmit={pair}><strong>{discovery.identity.displayName}</strong><small>Installation ID: {discovery.identity.installationId}</small><code>{discovery.identity.fingerprint}</code><label>One-time invitation code from that server<input type="password" autoComplete="off" value={pairingCode} onChange={(event) => setPairingCode(event.target.value)} required /></label><label className="federation-confirm"><input type="checkbox" checked={verified} onChange={(event) => setVerified(event.target.checked)} />I compared the full fingerprint with the administrator of this server.</label><button type="submit" className="button button-primary" disabled={Boolean(busy) || !verified || !pairingCode.trim()}><ShieldCheck size={15} />{busy === "pair" ? "Connecting…" : "Send connection request"}</button></form>}
      </article>
    </div>

    <section className="federation-peer-section federation-connection-section"><div className="federation-panel-heading"><div><h3>Connected Servers</h3><p>Connect sites across trusted Smart-Church servers.</p></div><button type="button" className="button button-secondary" onClick={() => { void load(); void refreshChannelStatus(); }} disabled={Boolean(busy)}><RefreshCw size={14} />Refresh</button></div>
      {!settings?.peers.length && <p className="sync-help">No servers have been paired yet.</p>}
      {settings?.peers.map((peer) => <article className={`federation-peer federation-peer-${peer.trust_state}`} key={peer.installation_id}><div className="federation-peer-details"><div className="federation-peer-title"><strong>{peer.display_name}</strong><span className={`federation-state federation-state-${peer.trust_state}`}>{peer.trust_state}</span><span>{peer.direction === "incoming" ? "Incoming request" : "Outgoing request"}</span></div><small>{peer.base_url ?? "No advertised URL · inbound WebSocket only"} · {peer.installation_id}</small><code>{peer.fingerprint}</code>{peer.trust_state === "trusted" && <small>WebSocket channels · Outbound: {peer.channels?.outbound ? "Connected" : "Waiting"} · Inbound: {peer.channels?.inbound ? "Connected" : "Waiting"}</small>}{peer.trust_state === "trusted" && !peer.channels?.outbound && peer.channels?.outboundError && <small className="federation-last-error">Outbound channel: {peer.channels.outboundError}</small>}{peer.last_seen_at && <small>Last checked: {new Date(peer.last_seen_at).toLocaleString()}</small>}{peer.last_error && <small className="federation-last-error">Last check failed: {peer.last_error}</small>}{remoteStates[peer.installation_id] && <small>Remote status: {remoteStates[peer.installation_id]}</small>}</div><div className="federation-peer-actions">
        {peer.trust_state !== "revoked" && <button type="button" className="button button-secondary" onClick={() => void checkPeer(peer)} disabled={Boolean(busy) || (peer.trust_state !== "trusted" && !peer.base_url)}><RefreshCw size={14} />{busy === `check:${peer.installation_id}` ? "Checking…" : "Check"}</button>}
        {peer.trust_state === "pending" && peer.direction === "incoming" && <button type="button" className="button button-primary" onClick={() => void approvePeer(peer)} disabled={Boolean(busy)}><ShieldCheck size={14} />{busy === `approve:${peer.installation_id}` ? "Approving…" : "Approve"}</button>}
        {peer.trust_state === "pending" && peer.direction === "outgoing" && <button type="button" className="button button-primary" onClick={() => void approvePeer(peer)} disabled={Boolean(busy) || remoteStates[peer.installation_id] !== "trusted"}><Check size={14} />Approve remote</button>}
        {peer.trust_state !== "revoked" && <button type="button" className="button button-danger" onClick={() => void revokePeer(peer)} disabled={Boolean(busy)}><ShieldOff size={14} />Revoke</button>}
      </div></article>)}
    </section>

    <section className="federation-peer-section federation-data-section"><div className="federation-panel-heading"><div><h3>Shares</h3><p>Share selected site data with another server and location.</p></div><button type="button" className="button button-primary" onClick={() => { setWizard("share"); setWizardSourceId(departmentId); setWizardPeerId(""); setWizardSites([]); setError(""); }} disabled={!settings?.peers.some((peer) => peer.trust_state === "trusted")}><Plus size={14} />Add Share</button></div>
      <div className="federation-sync-table federation-share-table"><div className="federation-sync-heading"><span>Origin Server/Site → Destination Server/Site</span><span>What content gets shared</span><span>Status</span><span>Actions</span></div>
        {shares.map((share) => <article className="federation-sync-row" key={share.id}><div><strong>{departments.find((site) => site.id === departmentId)?.location ?? "This site"} → {share.peerName}</strong><small>{share.peerName} · site {share.recipientDepartmentId ?? "Any accepted site"}</small></div><div>{share.scopes.map((scope) => availableScopes.find((item) => item.id === scope)?.label ?? scope).join(" · ")}</div><div><span className={`federation-state federation-state-${share.state === "active" ? "trusted" : "pending"}`}>{share.state}</span><small>{share.deliveryMode === "push" ? "This server sends" : "Destination pulls"}</small>{share.lastPushError && <small className="federation-last-error">{share.lastPushError}</small>}</div><div className="federation-peer-actions">{share.state === "active" && share.deliveryMode === "push" && <button type="button" className="button button-secondary" onClick={() => void pushShare(share)} disabled={Boolean(busy)}><RefreshCw size={14} />{busy === `push:${share.id}` ? "Syncing…" : "Sync now"}</button>}<button type="button" className="button button-danger" onClick={() => void revokeShare(share)} disabled={Boolean(busy)}><Trash2 size={14} />Delete</button></div></article>)}
        {subscriptions.map((subscription) => <article className="federation-sync-row" key={subscription.id}><div><strong>{subscription.sourceServerName} → {departments.find((site) => site.id === departmentId)?.location ?? "This site"}</strong><small>{subscription.sourceServerName} · incoming share</small></div><div>{subscription.scopes.map((scope) => availableScopes.find((item) => item.id === scope)?.label ?? scope).join(" · ")}</div><div><span className={`federation-state federation-state-${subscription.state === "active" ? "trusted" : subscription.state === "revoked" ? "revoked" : "pending"}`}>{subscription.state}</span><small>{subscription.recordCount} records</small>{subscription.lastSyncedAt && <small>Last sync: {new Date(subscription.lastSyncedAt).toLocaleString()}</small>}</div><div className="federation-peer-actions">{subscription.state === "active" && <button type="button" className="button button-secondary" onClick={() => void pullSubscription(subscription)} disabled={Boolean(busy)}><RefreshCw size={14} />{busy === `sync:${subscription.id}` ? "Syncing…" : "Sync now"}</button>}<button type="button" className="button button-danger" onClick={() => void rejectSubscription(subscription)} disabled={Boolean(busy)}><Trash2 size={14} />Delete</button></div></article>)}
        {!shares.length && !subscriptions.length && <p className="sync-help">No shares are configured yet.</p>}
      </div>
      <div className="federation-incoming-grants"><div className="federation-panel-heading"><div><h4>Available shares</h4><p>Accept a share offered to this location.</p></div><button type="button" className="button button-secondary" onClick={() => void discoverGrants()} disabled={Boolean(busy)}><RefreshCw size={14} />{busy === "discover-grants" ? "Checking…" : "Find shares"}</button></div>{incomingGrants.map((grant) => { const accepted = subscriptions.some((item) => item.sourceInstallationId === grant.sourceInstallationId && item.sourceGrantId === grant.id && item.state !== "rejected"); return <article className="federation-sync-row" key={`${grant.sourceInstallationId}:${grant.id}`}><div><strong>{grant.sourceServerName} · {grant.sourceDepartmentName} → {departments.find((site) => site.id === departmentId)?.location ?? "This site"}</strong></div><div>{grant.scopes.map((scope) => availableScopes.find((item) => item.id === scope)?.label ?? scope).join(" · ")}</div><div><span className="federation-state federation-state-pending">{accepted ? "Accepted" : "Available"}</span></div><div><button type="button" className="button button-primary" onClick={() => void acceptGrant(grant)} disabled={Boolean(busy) || accepted}>{accepted ? "Accepted" : busy === `accept:${grant.id}` ? "Accepting…" : "Accept share"}</button></div></article>; })}</div>
    </section>

    <section className="federation-peer-section federation-data-section"><div className="federation-panel-heading"><div><h3>Sync</h3><p>Replicate this site's data to a matching site on another server.</p></div><button type="button" className="button button-primary" onClick={() => { setWizard("sync"); setWizardSourceId(departmentId); setWizardPeerId(""); setWizardSites([]); setError(""); }} disabled={!settings?.peers.some((peer) => peer.trust_state === "trusted")}><Plus size={14} />Add Sync</button></div>
      <div className="federation-sync-table"><div className="federation-sync-heading"><span>Origin Server/Site → Destination Server/Site</span><span>What content gets synced</span><span>Status</span><span>Actions</span></div>
        {redundancyReadiness?.replicas.map((replica) => <article className="federation-sync-row" key={`${replica.peer_installation_id}:${replica.peer_department_id}`}><div><strong>{departments.find((site) => site.id === departmentId)?.location ?? "This site"} → {replica.peer_name ?? replica.peer_installation_id}</strong><small>Destination site {replica.peer_department_id}</small></div><div>Full site snapshot · enabled modules and their replicated data</div><div><span className={`federation-state federation-state-${replica.last_verified_at && !replica.last_error ? "trusted" : "pending"}`}>{replica.last_error ? "Error" : replica.last_verified_at ? "Verified" : "Waiting"}</span><small>{replica.last_verified_at ? `Verified ${new Date(replica.last_verified_at).toLocaleString()}` : "No verified snapshot yet"}</small>{replica.last_error && <small className="federation-last-error">{replica.last_error}</small>}</div><div><button type="button" className="button button-secondary" onClick={() => void pushReplica(replica)} disabled={Boolean(busy) || redundancyReadiness?.role !== "primary"}><RefreshCw size={14} />{busy === `replica:${replica.peer_installation_id}:${replica.peer_department_id}` ? "Syncing…" : "Sync now"}</button></div></article>)}
        {!redundancyReadiness?.replicas.length && <p className="sync-help">No replica syncs are configured yet.</p>}
      </div>
    </section>

    <details className="federation-advanced"><summary>Redundancy and recovery settings</summary>

    <article className="federation-panel federation-redundancy">
      <div className="federation-panel-heading"><div><h3>Site redundancy</h3><p>One writable primary, read-only standby servers, and manual promotion after fencing the old primary.</p></div><span className={`federation-state federation-state-${redundancyReadiness?.ready ? "trusted" : "pending"}`}>{redundancyReadiness?.ready ? "Recovery checks passed" : "Not ready"}</span></div>
      <p>Replication uses an authenticated WebSocket over the existing HTTPS/API port. A server behind NAT opens an outbound channel; either side can send over that channel. Before promotion, power off or externally block the old primary; the confirmation below records that action but cannot perform it for you.</p>
      <p className="sync-help">Full-site snapshots include user profile data and password hashes so members can sign in after failover. Users sign in again; active sessions and server-wide roles and permissions stay local to each server.</p>
      <p className="sync-help">Committed site changes trigger a snapshot push over WebSocket; a periodic check remains as a fallback. Larger transfers or connection failures can increase replication lag. Promotion requires a snapshot verified within the last five minutes; writes after that snapshot may be lost.</p>
      <div className="federation-redundancy-status"><strong>Current role: {redundancyReadiness?.role ?? "unknown"}</strong><span>Site epoch: {redundancyReadiness?.siteEpoch ?? "—"}</span><span>Module checks: {redundancyReadiness?.modulesReady ? "Ready" : "Not ready"}</span><span>Replica: {redundancyReadiness?.snapshotVerified ? "Matches last snapshot" : "Not verified"}</span>{redundancyReadiness?.upstreamInstallationId && <span>Configured primary: {settings?.peers.find((peer) => peer.installation_id === redundancyReadiness.upstreamInstallationId)?.display_name ?? redundancyReadiness.upstreamInstallationId} · location {redundancyReadiness.upstreamDepartmentId}</span>}{redundancyReadiness?.lastSnapshotAt && <span>Last snapshot: {new Date(redundancyReadiness.lastSnapshotAt).toLocaleString()}</span>}{redundancyReadiness?.lastVerifiedAt && <span>Last verified: {new Date(redundancyReadiness.lastVerifiedAt).toLocaleString()}</span>}{redundancyReadiness?.lastError && <span className="federation-error">Last replication error: {redundancyReadiness.lastError}</span>}</div>
      {redundancyReadiness?.role === "primary" && <><strong>Standby replication</strong>{redundancyReadiness.replicas.length ? <ul>{redundancyReadiness.replicas.map((replica) => <li key={`${replica.peer_installation_id}:${replica.peer_department_id}`}><strong>{replica.peer_name ?? replica.peer_installation_id}:</strong> {replica.last_verified_at ? `verified ${new Date(replica.last_verified_at).toLocaleString()}` : "waiting for first verified snapshot"}{replica.last_error && <span className="federation-error"> · {replica.last_error}</span>}</li>)}</ul> : <p className="sync-help">No verified standby targets yet. Configure a standby on a trusted server; the primary will discover and sync it automatically.</p>}</>}
      <strong>Enabled-module readiness</strong>{redundancyReadiness?.modules.length ? <ul>{redundancyReadiness.modules.map((module) => <li key={module.moduleId}><strong>{module.moduleName}:</strong> {module.ready ? `ready · ${module.recordCount ?? 0} records` : module.blockers.join(" ")}</li>)}</ul> : <p className="sync-help">Module readiness could not be loaded for this location.</p>}<p>{redundancyReadiness?.reason ?? "Every enabled module must pass its local recovery check."}</p>
      {redundancyReadiness && redundancyReadiness.pendingStandbyRequests.length > 0 && <section className="federation-redundancy-action"><h4>Incoming standby requests</h4><p>A Server Administrator here chooses whether this site accepts the other server's snapshots.</p>{redundancyReadiness.pendingStandbyRequests.map((item) => <article className="federation-peer" key={item.id}><div className="federation-peer-details"><strong>{item.sourceServerName} · {item.sourceDepartmentName}</strong><small>Site epoch {item.sourceEpoch} · requested {new Date(item.createdAt).toLocaleString()}</small></div><div className="federation-peer-actions"><button type="button" className="button button-primary" onClick={() => void reviewStandbyRequest(item, "approve")} disabled={Boolean(busy)}>{busy === `standby-request:${item.id}` ? "Saving…" : "Approve standby"}</button><button type="button" className="button button-danger" onClick={() => void reviewStandbyRequest(item, "reject")} disabled={Boolean(busy)}>Reject</button></div></article>)}</section>}
      {redundancyReadiness && redundancyReadiness.pendingPullRequests.length > 0 && <section className="federation-redundancy-action"><h4>Outbound standby requests</h4><p>A Server Administrator for this primary chooses whether the trusted server can pull its snapshots.</p>{redundancyReadiness.pendingPullRequests.map((item) => <article className="federation-peer" key={item.id}><div className="federation-peer-details"><strong>{item.targetServerName} · {item.targetDepartmentName}</strong><small>Source epoch {item.sourceEpoch} · requested {new Date(item.createdAt).toLocaleString()}</small></div><div className="federation-peer-actions"><button type="button" className="button button-primary" onClick={() => void reviewPullStandbyRequest(item, "approve")} disabled={Boolean(busy)}>{busy === `pull-standby-request:${item.id}` ? "Saving…" : "Approve outbound standby"}</button><button type="button" className="button button-danger" onClick={() => void reviewPullStandbyRequest(item, "reject")} disabled={Boolean(busy)}>Reject</button></div></article>)}</section>}
      {redundancyReadiness?.role === "primary" && <section className="federation-redundancy-action"><h4>Primary actions</h4><label>Trusted standby server<select value={redundancyPeerId} onChange={(event) => void loadRedundancyPeerSites(event.target.value)}><option value="">Choose a server</option>{settings?.peers.filter((peer) => peer.trust_state === "trusted").map((peer) => <option key={peer.installation_id} value={peer.installation_id}>{peer.display_name}</option>)}</select></label><label>Standby location<select value={redundancyPeerSiteId} onChange={(event) => setRedundancyPeerSiteId(event.target.value)} disabled={!redundancyPeerSites.length}><option value="">Choose a location</option>{redundancyPeerSites.map((site) => <option key={site.id} value={site.id}>{site.name} · {site.id} · {site.role}</option>)}</select></label><div className="community-inline-actions"><button className="button button-primary" type="button" onClick={() => void requestStandby()} disabled={busy !== "" || !redundancyPeerId || !redundancyPeerSiteId}><Plus size={15} />Request selected location as standby</button><button className="button button-secondary" type="button" onClick={() => void requestOutboundStandby()} disabled={busy !== "" || !redundancyPeerId || !redundancyPeerSiteId}><Plus size={15} />Become outbound standby of selected primary</button><button className="button button-secondary" type="button" onClick={() => void pushRedundancySnapshot()} disabled={busy !== "" || !redundancyPeerId || !redundancyPeerSiteId}><RefreshCw size={15} />{busy === "redundancy-push" ? "Pushing…" : "Push snapshot"}</button></div><label>Describe the external fencing action<textarea value={fencingNote} onChange={(event) => setFencingNote(event.target.value)} minLength={20} maxLength={1000} placeholder="For example: WAN uplink disconnected and the server powered off." /></label><button className="button button-danger" type="button" onClick={() => void fenceCurrentPrimary()} disabled={busy !== "" || fencingNote.trim().length < 20}>Fence this server and make it read-only</button></section>}
      {redundancyReadiness?.role === "standby" && <section className="federation-redundancy-action"><h4>Standby actions</h4><p>Promotion is enabled after local module checks pass and this standby still matches its last snapshot. This does not confirm that the primary has no newer writes.</p><label>Confirm the old primary installation<input value={redundancyReadiness.upstreamInstallationId ?? ""} readOnly /></label><label>Describe how the old primary was fenced<textarea value={promotionNote} onChange={(event) => setPromotionNote(event.target.value)} minLength={20} maxLength={1000} placeholder="For example: power removed and router rule blocks its LAN and WAN traffic." /></label><label className="federation-confirm"><input type="checkbox" checked={confirmSnapshotDataLoss} onChange={(event) => setConfirmSnapshotDataLoss(event.target.checked)} />I understand primary changes made after the last snapshot may be missing from this standby.</label><button className="button button-danger" type="button" onClick={() => void promoteStandby()} disabled={busy !== "" || !redundancyReadiness.ready || promotionNote.trim().length < 20 || !confirmSnapshotDataLoss}>{busy === "redundancy-promote" ? "Promoting…" : "Promote this standby"}</button></section>}
      {redundancyReadiness?.role === "fenced" && <section className="federation-redundancy-action"><h4>Rejoin as standby</h4><p>This server is fenced and read-only. Select the newer primary; its next verified snapshot will replace this site's data.</p><label>New primary server<select value={redundancyPeerId} onChange={(event) => void loadRedundancyPeerSites(event.target.value)}><option value="">Choose a server</option>{settings?.peers.filter((peer) => peer.trust_state === "trusted").map((peer) => <option key={peer.installation_id} value={peer.installation_id}>{peer.display_name}</option>)}</select></label><label>Primary location<select value={redundancyPeerSiteId} onChange={(event) => setRedundancyPeerSiteId(event.target.value)} disabled={!redundancyPeerSites.length}><option value="">Choose a location</option>{redundancyPeerSites.map((site) => <option key={site.id} value={site.id}>{site.name} · {site.id} · {site.role}</option>)}</select></label><button className="button button-secondary" type="button" onClick={() => void configureStandby()} disabled={busy !== "" || !redundancyPeerId || !redundancyPeerSiteId}><Plus size={15} />Configure as standby and replace data</button></section>}
    </article>
    <p className="federation-footnote">Peer discovery, pairing, status, and data transfers use authenticated WebSocket channels over the existing HTTPS/API port. Direct HTTP federation requests are rejected. People scope sends names and member/visitor status only; private contact information and login data are excluded. Schedule scope excludes attendance, registrations, and assignments.</p>
    </details>
  </section>;
}
