# Core and module API reference

This guide describes the HTTP API implemented by the Smart-Church server. It is intended for the first-party web client and trusted integrations. The API is not yet a separately versioned public integration contract; check the deployed server version and the route schemas before building an external client. This reference excludes EventDesk endpoints and data.

## Base URL and request format

The API is served by the same origin as the web app under `/api`. Most requests and responses use JSON with UTF-8. File upload, download, media, and presentation routes use binary bodies or responses and are noted in their module source. Route parameters use the names shown below; `:id`, `:userId`, `:contactId`, and similar segments are opaque IDs unless a route schema explicitly requires a UUID.

For browser clients, send requests with same-origin credentials. Do not put passwords, session cookies, CSRF tokens, API keys, or private profile data in URLs or logs.

## Authentication and security headers

Authentication uses the server-managed HTTP-only session cookie created by `/api/auth/login` or `/api/auth/setup`; the API does not accept a bearer token as a replacement. `GET /api/auth/status` returns the signed-in user and a CSRF token for browser writes. Send that value as `X-CSRF-Token` on state-changing requests and include the browser `Origin`. Production writes are restricted to the configured web origin. The login and setup routes are exempt from the CSRF header because they establish the session.

Location-scoped routes use `X-Department-Id` to select a location (the `departmentId` query parameter is supported only on routes that opt into it). The selected location must be a membership of the signed-in user. Always send the header when the user is acting in a selected location; never infer or reuse a location from an earlier user's request. A location can be read-only while it is a redundancy standby or fenced.

Routes normally require a signed-in user. The explicit unauthenticated exceptions are health, authentication, the HTTP-access notice, documented public registration/sign-up routes, the Resend webhook, signed federation endpoints, and Presenter public-output routes. Public routes use their own opaque token/signature checks; they do not confer access to the authenticated API.

Core area grants include `people_view_private`, `people_manage`, `events_manage`, `groups_manage`, and `resources_manage`; Server Administrators and location Site Administrators inherit access as implemented by the route. Server-wide actions use separate server permissions. Modules enforce their own module grants and may impose extra restrictions, such as a separate financial-data authorization. A core-area grant does not imply access to a module.

Common errors are JSON objects with an `error` message. Typical status codes are `400` for invalid input/context, `401` for an absent session, `403` for missing permission or invalid CSRF/origin, `404` for an absent record, `409` for a conflict, `423` for a fenced/read-only location, and `503` when a required service or database is unavailable. Individual routes may return other status codes and more specific response objects.

## Core endpoints

### Health and authentication

| Method | Path | Purpose / access |
| --- | --- | --- |
| `GET` | `/api/health` | Public server and database readiness. |
| `GET` | `/api/public/http-access` | Public HTTP-access mode used by the web warning/redirect UI. |
| `GET` | `/api/auth/status` | Current session, user preferences, and CSRF token. |
| `POST` | `/api/auth/setup` | Initial installation setup; requires the one-time setup code while no administrator exists. |
| `POST` | `/api/auth/login` | Create a session using username/email and password. |
| `POST` | `/api/auth/logout` | Revoke the current session. |
| `POST` | `/api/auth/change-password` | Change the current user's password; also used to satisfy a forced password change. |
| `PUT` | `/api/auth/preferences` | Save the user's date/time format and language preferences. |
| `GET` | `/api/auth/sessions` | List the current user's signed-in devices. |
| `DELETE` | `/api/auth/sessions/:id` | Revoke one of the current user's sessions. |

### Server, installation, users, and locations

These routes include server-wide administration. Most writes require a Server Administrator or the specific server permission; location membership management is restricted to the selected location's Site Administrator.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/admin/diagnostics` | Server and managed-worker diagnostics. |
| `POST` | `/api/admin/workers/:id/restart` | Restart an authorized managed worker. |
| `PUT` | `/api/admin/web-settings/http-access` | Set the web app's HTTP behavior. |
| `GET` | `/api/installation/modules` | Read installed/enabled module state. |
| `PUT` | `/api/installation/modules` | Enable/disable installation modules subject to required-module rules. |
| `GET`, `POST` | `/api/users` | List users or create an account. |
| `PUT`, `DELETE` | `/api/users/:id` | Edit or delete an account. |
| `POST` | `/api/users/:id/reset-password` | Set a temporary password and optionally require a change at next login. |
| `GET`, `POST` | `/api/departments` | List locations or create one. |
| `GET`, `PUT` | `/api/department` | Read/update the selected location profile. |
| `GET`, `PUT` | `/api/location-access`, `/api/location-access/:userId` | List, grant, edit, or revoke a user's membership in the selected location. |
| `GET` | `/api/people-options` | People choices used by account/access forms; fields are permission-filtered. |
| `GET`, `PUT` | `/api/branding` | Read or update installation branding. |

### People

| Method | Path | Purpose / access |
| --- | --- | --- |
| `GET` | `/api/contacts` | List contacts in the selected location. Private profile fields are returned only to users with private-People access. |
| `POST` | `/api/contacts` | Create a locally managed contact (`people_manage`). |
| `POST` | `/api/contacts/import` | Import a batch of contacts (`people_manage`). |
| `PUT`, `DELETE` | `/api/contacts/:id` | Update or delete a locally managed contact (`people_manage`). Synced contacts are protected from ordinary edits. |
| `GET` | `/api/visitor-follow-ups` | List follow-up work visible to the signed-in user. |

Request/response TypeScript contracts, including `Contact`, `ContactProfileData`, and status unions, are in [`packages/contracts/src/index.ts`](../packages/contracts/src/index.ts). The HTTP schemas in `apps/api/src/server.ts` define additional field and size limits.

### Events and services

| Method | Path | Purpose / access |
| --- | --- | --- |
| `GET`, `POST` | `/api/events` | List or create events/services in the selected location. Writes require `events_manage`. |
| `PUT`, `DELETE` | `/api/events/:id` | Update or delete a single event. |
| `PUT`, `DELETE` | `/api/events/:id/series` | Update or remove a recurring series. |
| `PUT` | `/api/events/:id/positions/:positionIndex/response` | Save an assigned person's pending/accepted/declined response. |
| `PUT` | `/api/events/:id/attendance` | Save adult and child attendance totals. |
| `GET`, `PUT`, `DELETE` | `/api/events/:id/check-ins` and `/api/events/:id/check-ins/:contactId` | List, record, or remove individual check-ins. |
| `GET` | `/api/events/:id/registrations` | List registrations and waitlist for an event. |
| `PUT` | `/api/events/:id/registrations/:registrationId/check-in` | Check in a registrant. |
| `PUT` | `/api/events/:id/check-ins/:contactId/follow-up` | Assign or update a visitor follow-up. |

Public event registration is available through `GET` and `POST /api/public/event-registrations/:token`. The token identifies the registration form; it is not an authenticated session.

### Groups and resources

These APIs are implemented by the Community module but use the shared `/api/groups` and `/api/resources` paths.

| Method | Path | Purpose / access |
| --- | --- | --- |
| `GET`, `POST` | `/api/groups` | List groups or create one; creation requires `groups_manage`. |
| `PUT`, `DELETE` | `/api/groups/:id` | Edit or delete a locally managed group. |
| `PUT` | `/api/groups/:id/members` | Replace local member assignments, roles, statuses, and join dates. |
| `PUT` | `/api/groups/:id/public-signup` | Enable/disable public sign-up and retrieve its token. |
| `GET` | `/api/groups/:id/join-requests` | List pending public join requests. |
| `PUT` | `/api/groups/:id/join-requests/:requestId` | Approve/decline a join request, optionally linking a contact. |
| `GET`, `POST` | `/api/groups/:id/meetings` | List or record a dated meeting/attendance record. |
| `GET`, `POST` | `/api/resources` | List or create bookable resources. |
| `PUT`, `DELETE` | `/api/resources/:id` | Edit or delete a resource. |
| `GET`, `POST` | `/api/resource-bookings` | List bookings or request a booking. |
| `PUT` | `/api/resource-bookings/:id/status` | Approve, decline, or cancel a booking. |

Public group sign-up uses `GET`/`POST /api/public/group-signups/:token`. Resource and group routes are location-scoped; booking approval and management permissions are checked by the Community module.

## Module API

Module availability is installation-wide, while most module records and settings are location-scoped. A disabled optional module may make its routes unavailable. Route handlers enforce the module's own grants in addition to session and location membership.

| Module | Route families | Notes |
| --- | --- | --- |
| Community feed | `/api/modules/community-feed/posts` and nested `/:postId/likes`, `/:postId/comments` | Location feed, posts, comments, reactions, and deletion. |
| Chat | `/api/modules/chat/contacts`, `/conversations`, `/conversations/:id/messages`, `/presence`, `/typing` | Conversation membership and role operations are nested under `/conversations/:id/members`. |
| Notifications | `/api/modules/notifications`, `/preferences`, `/announcements`, `/:id/read`, `/read-all` | User inbox/preferences and authorized location announcements. |
| File Storage | `/api/files`, `/api/files/:id`, `/api/files/:id/download` | Upload/download bodies are binary or multipart as configured; metadata and file access are location-scoped. |
| Email delivery | `/api/modules/email-worker/settings`, `/self-signup/settings`, `/self-signup/requests` | Server-admin email configuration and application review. The public application paths are listed below. |
| Sync | `/api/modules/sync/churchtools/*`, `/api/modules/sync/elvanto/*`, `/api/modules/sync/federation/*` | ChurchTools/Elvanto setup, previews, imports/exports, and audit endpoints require module management access. Financial reads additionally require explicit site-admin authorization. Federation v1 uses signed requests; see [`SERVER_TO_SERVER_SYNC.md`](SERVER_TO_SERVER_SYNC.md) and [`ELVANTO_SYNC.md`](ELVANTO_SYNC.md). |
| Presenter | `/api/presenter/datasets/*`, `/api/presenter/media/*`, `/api/presenter/sessions/*`; public output under `/api/modules/presenter/public/output/:token/*` | Dataset, media, presentation-session control, and token-scoped display endpoints. Upload/download endpoints carry binary data. |
| Video & streaming | `/api/video/*`, `/api/modules/video-steffisburg/youtube/connect`, `/api/auth/modules/video-steffisburg/youtube/callback` | Site-specific streaming, YouTube OAuth, planned streams, and device controls. Requires module configuration and permissions. |
| Remote desktop | `/api/modules/remote-desktop/destinations`, `/status`, `/session`, `/size`, `/client.js` | Destination management and browser gateway session control. Credentials are not returned by read endpoints. |

The exact route schemas and per-operation permission checks are maintained beside each module in `apps/api/src/modules/<module-id>/routes.ts` (or route helper files). Module registration, lifecycle, server context, workers, and replication APIs are defined in [`module-sdk.ts`](../apps/api/src/modules/module-sdk.ts); third-party authoring guidance is in [`module-authoring.md`](module-authoring.md). Sync route details and data limitations are documented in the linked module guides. The module-demo routes are a development example, not a supported product API.

## Public and service-to-service endpoints

| Method | Path | Authentication |
| --- | --- | --- |
| `GET`, `POST` | `/api/public/event-registrations/:token` | Opaque event-registration token. |
| `GET`, `POST` | `/api/public/group-signups/:token` | Opaque group sign-up token. |
| `POST` | `/api/public/self-signup/request` | Start an application by email. |
| `GET` | `/api/public/self-signup/form/:token` | Read the applicant form using its expiring token. |
| `POST` | `/api/public/self-signup/profile`, `/api/public/self-signup/confirm` | Submit profile details or confirm the email using the token. |
| `POST` | `/api/webhooks/resend` | Resend webhook signature verification. |
| `GET`, `POST` | `/api/modules/sync/federation/v1/*` | Installation signature, freshness, and replay checks; browser session auth is not used. |
| `GET` | `/api/modules/presenter/public/output/:token/*` | Presenter output token. |

There is no general unauthenticated data API. Do not expose the API port publicly without TLS and the configured origin/proxy protections.

## Source of truth and changes

Use route schemas and handlers as the authority for optional fields, limits, side effects, and permission details. Core contracts are in `packages/contracts`; core routes are in `apps/api/src/server.ts`; module route files are under `apps/api/src/modules`. If a route changes, update this reference and the relevant module guide in the same change. A generated OpenAPI document is not currently published by the server.

