# People Records module

The optional `people-records` module adds location-scoped directory extensions to the existing Contacts table and now lets People managers edit core profile fields from the directory.

## Implemented

- Define location-specific text, date, yes/no, and choice fields; edit field label/options/required/active settings.
- Save per-person field values with per-location foreign keys and change-history entries.
- Search/filter the private directory by text and member/visitor status; export the filtered directory and custom fields as CSV.
- Save personal directory views by name, retaining text search, member/visitor status, up to 10 active custom-field filters combined with AND, and up to 20 selected directory columns. Text fields support case-insensitive contains or exact matching; date fields support before, after, on, and rolling last/next 7, 30, or 90 day windows evaluated against the server current date at query time; yes/no and choice fields use exact matching. Last-N windows include today and the prior N−1 dates; next-N windows cover tomorrow through today plus N. Core columns include record ID, first name, last name, email, phone, and status; active custom fields can also be selected. Views are private to their creator and active location, and saved columns determine which fields appear in CSV exports. Up to 10 relationship-type conditions can also be combined with AND, including “has” and “does not have” semantics; relationship types are validated against the active location.
- Export a selected profile as a UTF-8 vCard containing the person's name, email, and phone.
- Edit first name, last name, email, phone, and member/visitor status with before/after audit history.
- Select multiple visible directory rows and change member/visitor status in one atomic, location-scoped action. Each changed profile gets an audit entry, and the existing automatic group-membership rules run for the new status.
- Select up to 500 visible directory rows and set or clear one active custom field in a single location-scoped transaction. Choice, yes/no, date, and text values are validated against the field definition; required fields cannot be cleared, and each changed profile receives an audit entry.
- Record consent purpose, granted/pending/withdrawn state, optional expiry and notes, with actor and history metadata.
- Manage a location-scoped relationship-type catalog with forward and reverse labels; add typed relationships from a person profile, display the reverse label from the related person profile, and remove the shared stored relationship from either side. Reciprocal labels are computed at read time, so one typed fact is stored once. Existing free-text rows remain visible and deletable.
- View a person's audit history for custom field, consent, and relationship changes.
- Find likely duplicate pairs by matching email or normalized first/last name. Managers can review both keeper directions and merge a source record transactionally after resolving linked-data conflicts.
- Merge preview highlights conflicting core profile values, custom fields, dates, and duplicate memberships or attendance. The keeper's non-empty profile values are preserved; conflicting values require explicit confirmation. Email and phone are copied from the source only when blank on the keeper.
- Merge migrates contact foreign-key references only within the active location (including group/event rows whose location is derived through their parent), handles service position assignments stored in JSON, preserves the source snapshot in a merge audit, and records history on the keeper. References that cannot be proven location-scoped block the operation. Cross-location merges are rejected.
- Upload up to 500 CSV rows, map source columns to first name, last name, email, phone, and active location custom fields, then preview mapped values, validation failures, likely duplicates, and counts. Select explicit valid new rows and confirm creation; the server revalidates field types and choices, rechecks duplicates inside a transaction, writes custom field values with per-field history, and records per-record plus batch audit entries. Imported records default to visitor status.
- Save and read first-class birth date and wedding anniversary values under private People access. These are stored in a module-owned, location-scoped table and can be edited only with People management access.
- Edit structured postal addresses in the contact profile with People management access. Private People readers can open addresses in profiles, select address columns for directory and CSV views, and include addresses in vCard exports. People managers can map address columns in CSV imports, preview their values, and create selected contacts after the duplicate recheck. A duplicate merge keeps the chosen record’s address when both records have different addresses and requires confirmation before merging.
- The Reports module adds upcoming birthdays and upcoming wedding anniversaries (next 30 days); report access requires both Reports view and private People permission.

## Access and data boundaries

Read APIs require `people_view_private` or `people_manage` at the resolved location. Mutations require `people_manage`, CSRF validation, and location-scoped record queries. The module manifest also advertises `view` and `manage` grants. API responses do not include another location's records.

## Remaining workflows

- Contact creation and profile edits remain separate workflows; merging is available only from duplicate review and requires a People manager.
- CSV import does not support column mapping or rollback after confirmed creation. It accepts first_name/firstname, last_name/lastname, email, and phone columns; imported contacts default to visitor status.
- Merge reference migration follows relational foreign keys targeting `contacts.id` and the known `service_events.positions[].contactId` JSON reference. Rows in other locations are never rewritten; an unscoped foreign-key reference blocks deletion rather than being changed. Informal references without a foreign key or this recognized JSON shape are not discoverable; review deployments for custom modules before merging.
- Change history records module-managed fields, consent and relationship changes, and edits made through this profile editor; other base contact writes are outside its audit trail.
- Legacy free-text relationship rows remain readable but are not converted into catalog types automatically and cannot be selected by relationship-type filters. Typed relationships use one forward stored row with a computed reverse display; household records and finer-grained relationship privacy rules are not modeled.
- Consent entries are append-only; withdrawing consent is represented by a new entry, and no retention/export automation is included.
- Bulk edits cover custom fields and member/visitor status; built-in profile attributes such as contact details are not batch editable. Configurable access partitioning within a location is also absent. Filters on distinct fields are supported; selecting the same custom field twice in one view is rejected. The directory keeps the person's name visible as its row identity even when first/last-name columns are unchecked.
- Anniversary reports cover only the next 30 days and do not schedule notifications. Birthday exports intentionally omit age.

The directory and CSV export can filter by active membership in a specific active group or any active group of a selected type at the current location. When both filters are set, the same group must match both. Saved directory views retain the filters. If a saved group or type becomes unavailable, the filter continues to apply until cleared.

Directory, saved views, and CSV support an exact group membership role filter (case-insensitive). When group, group type and role are combined, all filters apply to the same active membership.

People managers can archive or restore a person from their profile. The archive list and its CSV export honor the same filters. Archiving keeps the location contact, linked records, and audit history. Default directory and global search results exclude archived people. Imports continue checking all contacts for duplicates, including archived records.

The directory statistics panel counts all matching active or archived contacts before the page limit. It reports totals, member and visitor counts, and how many people have email and phone details. It uses the same location and filters as the displayed directory.

People managers can also archive or restore up to 500 visible selected contacts in one operation. The API rejects a selection that includes contacts outside the location and writes a history entry for each changed contact.

People can update a saved view with the current filters, sort, and columns, or rename the view without changing its stored criteria. Views remain private to their owner and location.

The directory shows 100 people per page. Changing location, archive mode, filters, or sort returns to the first page. Bulk actions apply to selected rows on the current page. API clients may supply `page` (one-based) and `pageSize` (1–500); callers that omit both keep the first 500 rows and the same response format. CSV still exports up to 5,000 matching people independently of page navigation.

People managers can add optional first contact date, nationality, and marital status fields from the Fields tab. These presets use the same private profile, directory filters, saved views, CSV mapping, and audit behavior as custom fields. Adding a preset does not replace a field that already uses the same key.

Managers with People and Groups management permissions can add selected active contacts to an active local group from the directory. The action takes a role and membership status, preserves existing memberships, and records new memberships through the installed group audit trigger.
