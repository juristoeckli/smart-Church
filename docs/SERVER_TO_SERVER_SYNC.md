# Server-to-server synchronisation

Status: implementation in progress, 30 October 2026. Pairing, signed requests,
scoped manual sharing, automatic chunked full-site snapshots over the existing
HTTPS API, and module-owned snapshot adapters are implemented for core site data
and every module currently shipped in this repository. Sync settings use exactly
three tabs: ChurchTools, Elvanto, and Server-to-server. The Server-to-server tab
can configure a standby, push and verify a snapshot, fence this installation as
read-only, promote a standby, and rejoin a fenced installation as a standby.
Promotion is manual and requires an administrator to attest that the old
primary was externally fenced. Redundancy remains blocked until all enabled
modules pass readiness and recovery is verified between two independent
installations.

This plan covers installation identity, peer trust, scoped sharing, replication,
revocation, key rotation, and recovery. A trusted peer relationship is not a
data grant. Neither side receives user, location, or administrator access just
because the servers are paired.

## Goals and boundaries

- Each installation has one persistent Ed25519 signing identity. It is separate
  from TLS certificates, passwords, OAuth credentials, and encryption keys.
- Every network operation is initiated by the configured sync-client server.
  The source only answers authenticated requests and never opens a connection
  back to the client.
- Federation uses the existing Smart-Church HTTPS/API origin and listener. It
  adds no listener, network service, or firewall port.
- Administrators pair peers explicitly and verify fingerprints through an
  independent channel before approving either direction of trust.
- HTTPS protects requests in transit. Signed requests bind the sender, method,
  path/query, timestamp, nonce, and body. Requests are rejected on replay or
  stale timestamps.
- A peer can only access grants explicitly issued to its installation. Trust
  and grants are not transitive. There is no remote login or server-to-server
  administrator session.
- The owning installation remains authoritative. Remote records are read-only
  replicas. A local copy gets a new ID and provenance, then becomes independent.
- Contact records, site memberships, user profile settings, and password hashes
  are replicated. Account identity is matched by email or existing account ID.
  Active login sessions, server-wide roles, and server permissions remain local
  to each installation. Users sign in again after failover; replicated password
  hashes preserve their credentials without copying live session tokens.
- Share only selected locations and data categories, with personal contact
  details excluded unless an additional field-level grant is given.
- The first usable slice is manually initiated peer pairing and a signed health
  check plus explicit shares for names/status and services/events. Other module
  data is added only when an adapter has complete export, import, update,
  tombstone, and access-control handling.

## Identity generation and storage

1. On first Sync-module startup, generate an Ed25519 key pair using the OS
   cryptographic random source. Do not ask an operator to generate or paste
   private key material.
2. Persist the PKCS#8 private key in the application data volume at
   `sync/identity-ed25519.pem`, mode `0600`; create its directory mode `0700`.
   `SMART_CHURCH_SYNC_IDENTITY_KEY_FILE` may select a protected path. Never put
   the private key in PostgreSQL, logs, exports, diagnostics, the browser, or
   Git. The public SPKI key and fingerprint may be stored in the Sync module's
   database metadata.
3. Bind the public key to the current installation UUID on first start. On
   later starts, verify the file parses, the derived public key matches the
   stored public key, and the installation UUID is unchanged. Fail closed if a
   previously registered identity key is missing or mismatched; silently
   generating a replacement would create an impersonation risk.
4. Fingerprint = SHA-256 over DER-encoded SubjectPublicKeyInfo, rendered as
   uppercase hexadecimal pairs separated by colons. Display the entire value
   for manual comparison. Do not use a truncated fingerprint for approval.
5. Back up the identity file together with the database and persistent data
   volume. Protect the backup and keep its recovery key separately. Restoring
   only the database or only the key is not a supported server identity
   recovery procedure.

Each installation also creates a separate X25519 key pair beside the Ed25519
identity file, using the `.x25519.pem` suffix and the same directory/file
permissions. Its public key is included in the Ed25519-signed identity
response; its private key never leaves that server. Modules decrypt their own
stored credentials, seal each credential to the signed standby public key for
the HTTPS transfer, then encrypt it under the standby's local module key after
receipt. The peer encryption key is fetched again for each snapshot, so key
rotation does not require sharing private keys or re-pairing the Ed25519
identity.

## Trust establishment and key exchange

Pairing uses a one-time invitation created by the receiving installation:

1. An administrator on server B creates an invitation. Generate 32 random
   bytes, show the base64url code once, store only its SHA-256 hash, and expire
   it after 30 minutes. It is single-use and bound to B's current installation
   identity. Revoke it at any time.
2. An administrator on server A enters B's base URL and invitation code. A
   fetches B's public identity over HTTPS: protocol version, installation UUID,
   display name, public key, fingerprint, and a signature over the response.
   A shows the exact URL, identity, and full fingerprint. The administrator
   compares that fingerprint with B through a separate trusted channel.
3. After explicit confirmation, A sends a pairing request containing A's
   installation UUID, name, public key, fingerprint, base URL, protocol
   version, and invitation code. B validates and consumes the invitation in a
   transaction, checks the key/fingerprint, rejects self-pairing, and records
   A as `pending`. B returns its peer-record ID and a signed response.
4. A stores B as `pending` and displays B's exact fingerprint. The administrator
   on B independently verifies A's fingerprint out of band, then approves A.
   A's administrator sees the signed approval status and separately approves
   B. Both sides must trust the other before data exchange. A pairing code alone
   never enables data access.
5. Repeating a pairing request is idempotent only for the same installation
   UUID and same public key. A different key for a known installation is a key
   change and requires the key-rotation procedure, not an overwrite.

Invitation codes are secrets: never log them, put them in URLs, or store them
in clear text. The base URL must be an HTTP(S) origin with no credentials,
query, or fragment. Production peer connections require HTTPS. Local development
may use HTTP for loopback fixtures only. Redirects are disabled for all peer
requests.

## Signed request protocol

Protocol identifier: `smart-church-federation/1`.

Headers: `X-SC-Installation`, `X-SC-Timestamp` (Unix milliseconds),
`X-SC-Nonce` (at least 128 random bits, base64url), and
`X-SC-Signature` (base64url Ed25519 signature).

Canonical bytes are UTF-8:

```text
SC-FEDERATION-V1\n
<UPPERCASE_METHOD>\n
<path-and-query-as-sent>\n
<timestamp>\n
<nonce>\n
<lowercase-hex-SHA256-of-exact-body-bytes>
```

An empty request has an empty body and its SHA-256 digest. The body is capped
at 1 MiB. Verify the signature against the public key pinned for that
installation; require a trusted peer except for the narrow pending-peer status
check. Accept timestamps within five minutes of server time. Persist each
`(installation UUID, nonce)` under a unique constraint until at least ten
minutes after acceptance; reject duplicates. Bound per-peer request rates and
fail closed on malformed headers, unknown protocol versions, invalid UTF-8,
unknown peers, revoked peers, redirects, and signature errors.

Responses from federation endpoints are signed over protocol identifier,
HTTP status, request nonce (empty for public discovery), and exact response
body hash. Clients verify response signatures against the pinned peer key.
Return generic authentication errors to callers and log only peer ID, route,
failure class, and correlation ID; never log invitation codes, signatures,
request bodies, contact records, or private keys.

## Grants, data model, and replication

Trust is installation-wide; sharing is location-scoped. Each grant contains:

- unique grant UUID and monotonically increasing grant revision;
- owner installation UUID and owner location UUID;
- recipient installation UUID; the receiving Site Administrator chooses the
  destination location when accepting the grant;
- one or more supported data scopes, each with explicit field policy;
- creation/update actor and timestamps, state (`active`/`revoked`), and expiry;
- optional linked remote user IDs used only for attribution, never for login.

The owner creates or revokes grants. The recipient may accept or reject an
incoming grant; a rejected grant cannot be reactivated without a new explicit
request. Each grant selects one initiator: either the receiving server pulls,
or the owner server pushes outbound to the receiving server. This supports a
source behind NAT with no port forwarding when the destination has its normal
HTTPS/API endpoint reachable. The destination never opens a callback to the
source. There is no extra listener, service, or port. Neither server may widen
the other's field scope. A person, group,
event, or resource remains owned by the source installation and location.

Peer pairing can also be outbound-only. Set
`SMART_CHURCH_SYNC_PEER_BASE_URL=outbound-only` on a server with no inbound
HTTPS URL; it can still initiate signed requests to its reachable peer. The
receiving server stores the peer without a callback address, so operations
that require reaching that server must be initiated there. The default `auto`
uses `SMART_CHURCH_WEB_ORIGIN` (or the request origin in production); set the
variable to the server's externally reachable HTTPS origin when callback
access is available.

For full-site redundancy, either server can initiate setup. If the primary can
reach the standby, it sends a standby request and the standby's Server
Administrator approves it; the primary then pushes snapshots. If only the
standby can reach the primary, its administrator selects the primary and sends
a signed outbound standby request. A Server Administrator on the primary
approves that exact installation and site before any snapshot is released.
After approval, the standby pulls snapshots over its existing outbound
HTTPS/API connection. Both paths bind authorization to the source site, target
installation, target site, and source epoch. Neither path requires a callback
to an outbound-only server or an additional network port.

Every adapter must define a stable globally unique source ID, owner ID,
monotonic record revision, canonical serialization/version, allowed fields,
relationship/reference mapping, and deletion tombstone. Each grant has an
opaque cursor. Once incremental feeds are introduced, each batch is bounded
(record count and byte size), ordered by sequence, and returns `nextCursor`,
`hasMore`, and a deterministic batch ID. Destination applies each batch and
advances the cursor in one transaction; retries are safe and cannot duplicate
records. A cursor older than retained tombstones triggers a full scoped
snapshot. The source marks deletion with a tombstone and retains it until all
active recipients have advanced or the retention window expires. Revoked
grants stop future reads immediately; on reconnect the recipient removes
managed replica data and its local cache. An exported file cannot be recalled.

The first adapters are deliberately narrow: people names plus member/visitor
status (no private contact or login data), and service/event schedule fields
(no attendance, volunteer assignments, public registration details, or
bookings). They support bounded full snapshots on explicit pull or push. Since
these first adapters have no change feed or tombstone ledger, each successful
sync replaces the complete managed replica atomically. A reciprocal grant is
needed to copy data in both directions. Replicas remain separate, read-only
records; they do not yet appear as owned contacts or events in the receiving
site's regular screens. Sync is manual in this implementation. Further adapters
must use incremental revisions, cursors, and tombstones before automatic
scheduling is enabled.

Further data adapters should be delivered separately and in this order:

1. Shareable reference libraries with no private contact fields.
2. Contacts with per-field disclosure grants and stable origin identity links.
3. Groups and memberships, after contact-link policy is defined.
4. Services/events and public schedule metadata.
5. Resources and bookings only after conflict and availability semantics are
   specified. A booking copy must never reserve a resource on the owner server.

Each grant uses its selected pull or outbound push mode. Each adapter exposes a
bounded export endpoint. Sync stores replicas in
module-owned tables so local records cannot be mistaken for owned records or
edited as if authoritative. Creating a local copy allocates new IDs and stores
provenance; it is not attached to the source grant.

## Revocation and key rotation

Revoking a peer immediately blocks signed requests and every grant under it.
Keep a non-sensitive audit record with actor, timestamp, peer installation ID,
fingerprint, and reason. The recipient purges managed replicas on its next
connection; a disconnected recipient cannot be remotely erased. Re-pairing
requires new manual verification. Trust is not inherited by a replacement key.

Rotation is an explicit two-sided ceremony: the old key signs a proposal
containing the new public key, fingerprint, installation UUID, and expiry; the
new key signs proof of possession. Each peer administrator verifies the new
full fingerprint independently and approves it. The recipient temporarily
accepts signatures by both keys for that peer, records the transition, then
retires the old key after the initiator confirms. If the old key is lost or
compromised, revoke that peer relationship and pair again after separate
identity verification; do not offer an unauthenticated reset.

## Operations and failure behaviour

- Manual pull or push is available first. Automatic sync is opt-in per grant,
  uses jittered polling, timeouts, bounded retries with backoff, and a
  per-grant lease so only one job runs at once.
- Show last success, last safe error, cursor progress, and revoked/rejected
  state. A sync failure never partially advances a cursor or deletes records.
- Revalidate trust and grants on every batch. Never replay expired invitations,
  approvals, or commands. Federation carries data only; it cannot start workers
  or issue device-control commands.
- Keep PII and OAuth secrets out of metrics and sanitized diagnostics. Rate
  limit discovery, invitation attempts, pairing, status checks, and data pulls.
- Deploy behind HTTPS. A TLS-terminating proxy is supported; its hop to Core
  must remain on a protected private network. Do not expose the API directly
  over untrusted HTTP.
- Back up the database, the signing identity file, and module replica state
  consistently. Restore tests must prove the same fingerprint and that peer
  sequence cursors remain consistent.

## Site redundancy

Redundancy is a special replication relationship, not a second ordinary copy
of selected records. The intended topology is one writable primary and one or
more read-only standby servers carrying the same location ID. The primary may
push to a reachable standby over the same existing HTTPS/API endpoint, so the
primary does not need port forwarding. A standby never sends writes back while
it is in standby mode. The site administrator explicitly chooses the primary,
standby, and supported modules/data, and sees per-module replication health.

Promotion requires a Server Administrator to first fence the old primary
(stop it or block its ability to accept users/writes), then promote the standby
and increment a persisted site epoch. All writes on the new primary carry the
new epoch. When the old primary next reaches a trusted former standby, it
compares signed site epochs and automatically fences itself if the peer is
already primary at a newer epoch. Manual promotion remains the only way to
activate a standby. Do not promise safe automatic failover across
an ordinary network partition without a quorum or external fencing authority:
both isolated servers cannot otherwise know which one is allowed to write.
The primary pushes complete site snapshots to each configured, reachable
standby automatically. The default interval is 60 seconds and can be set with
`SMART_CHURCH_REDUNDANCY_SYNC_INTERVAL_SECONDS` (30–240 seconds). Transfers use
only the existing signed HTTPS/API connection. A verified snapshot proves that
the standby matches the source at that snapshot time, not that it contains
writes made during or after the transfer. The interface shows per-standby
replication health and requires explicit acknowledgment before promotion with
possible data loss. Promotion is blocked if the last verified snapshot is more
than five minutes old; manual push remains available for planned failover.
After promotion, the old primary can only rejoin as a standby and must discard
or explicitly reconcile any unreplicated writes; it must not merge concurrent
site histories automatically. The promoted primary retains the former standby
identity and site ID. Once the old primary is manually reconfigured as that
primary's standby, it initiates signed snapshot pulls over its outbound HTTPS
connection. This supports rejoin when the old primary has no inbound port
forwarding. Each pull replaces the standby with a complete module-owned
snapshot and verifies it before marking the replica current. New promotions
retain both the former standby installation and site identity. For promotions
recorded by older builds, the new primary falls back to its latest promotion
audit to identify the former installation; its administrator must select the
correct local site when reconnecting.

Serving the same complete site requires every active module to provide a
module-owned replication adapter for all authoritative records, files,
settings, and required secrets, and requires consistent backup/restore and
fencing behaviour. Adapters currently cover core records; Chat, Community Feed,
Community data, File Storage, Notifications, Email Delivery, EventDesk,
Presenter, Remote Desktop, Video & streaming, ChurchTools/Elvanto integration
data, and Module Demo. Each enabled module must still pass its own readiness
checks. The core adapter copies password hashes and user profile fields so site
members can sign in after failover; active sessions, server-wide roles, and
server permissions stay local. Snapshot transfer is signed and uses HTTPS, and
staged chunks are deleted after restore. Per-site SMTP credentials are sealed
for the standby and re-encrypted with its local key. Other host-level service
settings remain local and must be configured on each server when required. The readiness check also
blocks promotion while self-sign-up is enabled or has unresolved requests,
because the self-sign-up workflow is installation-wide and is not part of the
location snapshot.

The Video adapter compares a fingerprint of its parsed worker configuration
and converter runtime settings between servers, and requires the standby's
local worker process to report ready; the devices themselves still need to be
reachable during recovery. Remote Desktop credentials are decrypted locally,
sealed to the standby's authenticated X25519 public key for transfer, then
encrypted under the standby's own module key. The standby gateway must be
configured and its client endpoint must respond locally. ChurchTools and
Elvanto integration credentials use the same per-peer envelope approach.
Presenter snapshots copy datasets and site media as well as database records.
Video OAuth settings and Presenter data are location-scoped in the current
adapters, so each site's snapshot stays separate from other locations on the
same installation.
EventDesk uses a keyed fingerprint of its Resend API key and sender address in
the adapter version, so the two servers must have matching mail delivery
settings; the secret itself is never included in a snapshot. Other external APIs, OAuth
credentials, device networks, local
worker processes, and operational state cannot be made available merely by copying
database rows. A Server Administrator must provision and verify these local
dependencies before promotion. Transient Chat presence is deliberately rebuilt.

The app cannot power off a remote host or enforce network isolation. Its Fence
action only records the administrator's attestation and makes that installation
read-only in Smart-Church. Before promotion, physically power off or block the
old primary's user and API traffic outside the app. After promotion, keep the
old host fenced through rejoin; configure it as a standby and replace its data
from the newer primary before allowing writes. Two-server integration,
restore, workload, and network-fencing procedures have not yet been verified,
so successful adapter checks alone do not certify production readiness.

Each API module registers its own replication adapter through the generic
module SDK extension point. The adapter owns its module data, snapshot format,
restore transaction, verification, and recovery blockers. The Sync module
only coordinates signed transport, staging, and readiness; it must not encode
other modules' schemas. The readiness API checks each enabled installation
module and fails closed when the adapter is missing or reports a blocker.
Core site records, files, module state, user/location mappings, version
compatibility, staged whole-site restore, read-only standby enforcement, and
promotion fencing have implementation paths; two-server restore, workload, and
network-fencing procedures still need end-to-end verification.

## Implementation sequence

1. Pair peers, approve trust on both servers, and protect signing identities.
2. Use explicit scoped grants for ordinary data sharing; use the separate
   full-site snapshot path for redundancy.
3. Review the readiness blockers and provision required module encryption
   keys, worker configuration, device access, and external connectors on both
   servers. Core user credentials are replicated with the site snapshot.
4. Exercise two independent installations, then complete fencing, epoch
   propagation, stale-primary rejection, rejoin, restore, and key rotation
   procedures before declaring redundancy production-ready.

No data adapter is considered complete until owner edits, recipient replica,
retry, update, deletion, revoke/purge, permission denial, and recovery have all
been exercised against two independent installations.
