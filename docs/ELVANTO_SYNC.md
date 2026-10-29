# Elvanto integration

## Current implementation

The Sync settings panel can connect an Elvanto account, verify its API key with a one-record People read, encrypt and store that key for the selected location, and save a direction choice for each planned data area. Direction choices are independent: disabled, Elvanto to Smart Church, Smart Church to Elvanto, or bidirectional. The all-area presets apply to People, People Flows, Groups, Services, Songs, and Calendar. Financial/giving remains disabled unless a site administrator explicitly enables it; the financial direction stays off if that permission is unchecked.

The settings panel also has a read-only People import preview when People is directed from Elvanto to Smart Church. It pages through People (up to 200 pages of 1,000 records), compares stable Elvanto IDs with already linked contacts, and reports likely creates, existing links, email matches, ambiguous email matches, and records needing review. It returns up to 50 sample names and actions to an authorized location administrator. Email matches are never merged automatically. If the API reports more records than were scanned, the preview is marked incomplete. A complete preview is required for import, expires after one hour, and is invalidated when connection settings change. The preview makes no contact changes.

After a complete preview, an administrator can import eligible contacts. Each request processes at most five Elvanto pages (5,000 people), and the next page and counts are saved transactionally so the administrator can resume later. Settings changes and disconnect are blocked while a batch is running. When the initial import is complete, the same button starts a full People refresh from page one; stable IDs make it safe to repeat, and no contacts are deleted. New contacts are stored with `source_system='elvanto'` and the Elvanto person ID; linked Elvanto contacts have name, email, phone, and the local member status refreshed. Email matches, malformed or missing names, and duplicate source IDs are skipped; they are not automatically merged. Elvanto-linked contacts are shown as read-only in the People directory and cannot be edited or deleted through the normal contact endpoints. This first People importer is one-way and does not yet do incremental change detection or export.

A read-only Groups preview pages through up to 200,000 Elvanto groups and includes each group's people list. It reports new groups, already linked groups, same-name conflicts, invalid rows, and membership matches. A complete preview must be less than one hour old before import. Each request imports at most five pages and saves its page and counts transactionally, so it can resume. Existing Elvanto groups refresh their description and membership roster; Elvanto membership positions become local group-member roles. Memberships link only to contacts already imported from Elvanto People; unmatched people are skipped and shown in the preview. Local groups with a matching name are skipped for manual resolution instead of being merged. Elvanto groups and memberships are read-only in the normal Groups workflows. Groups absent from Elvanto are not deleted, and public signup, local meeting attendance, exports, and reverse-direction sync are not supported by this adapter.

After choosing directions, an administrator can check read access for each selected area; each permission check fetches at most one record per list endpoint, and results contain only access status and a count. Songs also checks the arrangements endpoint when a song is available. Calendar and financial checks query a rolling five-year window. No records from these permission checks are stored. Direction choices do not activate a background job. Beyond the People and Groups imports above, other data areas are not currently imported, exported, or synchronized; a saved direction does not mean that direction is implemented.

## Set up a connection

1. Sign in to Elvanto with an administrator account.
2. Find the Secret API Key under **Settings → Developers → API**. Elvanto's [API key help article](https://help.elvanto.com/hc/en-us/articles/7626452924823-How-to-use-the-Elvanto-API) documents this location.
3. In Smart Church, open **Settings → Modules → Sync** for the location and paste the key into the Elvanto section. The key is sent to the API server for verification and encrypted at rest. It is never returned to the browser after saving.
4. Choose directions for each data area. Financial/giving starts disabled and needs its own explicit authorization.
5. Select **Test connection and save**. This validates the API key and People read permission; it does not test permissions for the other areas.
6. Select **Check selected API permissions** to check read access for every enabled direction. This is read-only and does not validate write access.
7. Select **Preview People import**, review the counts and email matches, then select **Import eligible contacts**. Import proceeds in batches of five pages; use **Continue People import** until the saved progress is complete. Later, rerun the preview and use **Refresh People from Elvanto** to reprocess the People list. Email matches are skipped for manual resolution.
8. Select **Preview Groups import** and review name conflicts and linked members. Import or refresh proceeds in batches of five pages. Import People first if you want the Groups adapter to link its members.

Elvanto documents API-key authentication using HTTP Basic authentication, with the API key as the username and a dummy password, in its [Getting Started guide](https://www.elvanto.com/api/getting-started/).

## Scope still to implement and verify

- Full People and volunteer field/status/custom-field mapping, People Flows, groups and memberships, services/plans/assignments, songs/arrangements, calendar events, and financial/giving records.
- Per-area field, relationship, custom-field, status, and deletion mappings; broader dry-run previews; incremental sync; and resumable pagination for every area. People import resumes by page but does not detect changes after its initial import.
- Conflict policy, deletion/archive behavior, rate-limit handling, retries, audit history, and disconnection after imports exist.
- Non-production read/write verification for every area and direction. The permission check covers selected-area read access only; it does not verify write access or perform a synchronization.

No Elvanto credentials are committed. Do not paste API keys into source files, issues, or chat.
