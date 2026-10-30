# ChurchTools one-time migration

The Sync settings page can create a read-only preview and import a bounded snapshot from a configured ChurchTools installation. This is a one-time import into Smart-Church; it does not write to ChurchTools or establish ongoing synchronization.

## Supported mapping

| ChurchTools source | Smart-Church destination | Mapping and behavior |
| --- | --- | --- |
| Person | Contact | Stable ChurchTools person ID is kept in the migration crosswalk. First name, last name, email, and phone are mapped. A matching email is reported for review and is never used by itself to merge people. |
| Group | Group | Stable group ID, name, and description are mapped. Memberships are connected when the person has a migration crosswalk or an existing ChurchTools source ID. Role, normalized status, and entry date are mapped when recognized in the member response. The importer adds memberships and keeps existing local membership details. |
| Event | Service or event | Stable event ID, title, date, start/end time, all-day state, location, room, description, volunteer positions, and time-plan items are mapped where the source provides them. Plan item title/name/label (including nested song title/name), start time, duration, and description/note are normalized. Position holders link only when their person ID resolves locally. |
| Song and arrangement | Worship song catalog | Smart-Church can store song titles, authors, keys, arrangement names, and HTTPS links to licensed charts/audio. ChurchTools agenda song titles may be retained as plan item titles, but no separate song/arrangement catalog record, source-ID link, author/key, licensed chart/audio reference, or per-item responsible-role link is imported. The migration preview lists unsupported agenda and nested-song field names without copying their values. |
| Resource | Bookable resource | Stable resource ID, name, supported category, description, location, capacity, approval requirement, and active state are mapped. Category values are normalized to Smart-Church's room, vehicle, equipment, or other values. |

The importer does not map person profiles beyond the fields above, family or other person relationships, custom group-membership fields, planned group exit dates, membership remarks or waiting-list positions/history, event series/recurrence, event plans beyond the normalized fields above, song/arrangement records or their licensed links, per-item responsible-role links, position response states, or resource bookings. Unsupported agenda and nested-song field names are listed in the migration preview and counted in its unmapped-field total. Service-plan templates created in Smart-Church are local templates and do not claim a ChurchTools source ID. Resource bookings require a verified source booking schema and a safe mapping from ChurchTools users to Smart-Church accounts; they are not imported. These are known migration gaps, not silently claimed as migrated data.

## Review and conflict rules

- Preview lists total/create/update/review/invalid counts and a sample of up to 40 source records. Unmapped person fields are counted.
- Matching uses stable source IDs. Email, group name, and event title/date/time matches are conflicts for review and are skipped during import; records are not merged on those values.
- Existing records linked by a stable ID can be updated. New migration records remain editable and are kept outside scheduled-sync cleanup.
- Group imports add source memberships only; they do not remove existing memberships.
- Source lists must finish within 100 pages of 200 records per endpoint. An incomplete list prevents a preview from being saved. The selected date range applies to events.

## Progress and recovery

The preview snapshot is encrypted using the server's configured encryption key. Import processes at most 50 records in a database transaction and stores its page and created/updated/skipped/failed counts. A record-level database error rolls back only that record, advances the batch, and records its area and stable source ID in the administrator-visible failure summary. Retry migration replays the same snapshot idempotently after the cause is corrected. A batch-level failure rolls back the whole transaction and does not advance the saved page. Keep the server encryption key available until the migration is complete.

Preview and import require location-management permission. Use a dedicated ChurchTools login token with only the required read access. Do not put tokens in issue comments or logs. A complete production migration should first be verified against a non-production ChurchTools site and reconciled against source counts.

## Source API

ChurchTools documents that the installed instance serves its own OpenAPI specification at `/system/runtime/swagger/openapi.json`; endpoint availability and fields can vary by installed version. Review that specification before relying on any mapping or endpoint: [ChurchTools API documentation](https://churchtools.academy/en/help/system-settings/api-en/api-documentation/).
