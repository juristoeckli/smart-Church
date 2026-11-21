# Wiki module

This optional location-scoped module provides category and page management, rich text content, search, page history and restoration, safe archiving, homepage selection, redirects, page links, and attachments to location-owned File Storage records.

## Permissions

- Pages can be visible to everyone in the location, active members of one selected group, or Wiki managers only. Existing pages default to location visibility.
- Group visibility is based on an active `group_members` row for one of the viewer's location contacts. Site administrators and users with the Wiki `manage` grant can read and administer every page.
- Audience filtering applies to page lists and search, page details, versions, HTML export, and attachment listing/download. The generic File Storage download route also checks whether a file is linked only to Wiki pages the viewer cannot read.
- For viewers without Wiki manager access, search matches page titles only. Wiki managers can search both titles and body text. Typed links to unreadable Wiki pages are replaced with a generic restricted-page label in page content and history.
- Site administrators and users with the Wiki `manage` grant can edit pages and categories, set audience controls, maintain links, restore page history, and archive records.
- Uploading new attachments also requires the File Storage `manage` grant. Wiki managers can attach a file already stored for their location.
- Every record query is scoped to the active location. Wiki content is sanitized on the server before storage and HTML export.
- The audience group selector offers active groups only. New pages must use an active group; editing an existing page may retain its already assigned inactive group, so historical group-only content keeps its saved audience and remains readable under the existing membership rules.

## API

Routes are rooted at `/api/modules/wiki` and registered by the module loader from `manifest.json`. The web bundle is discovered from the sibling `apps/web/src/modules/wiki/module.tsx` entry.

The module keeps HTML revisions indefinitely and allows a manager to restore an archived category/page. Managers can preview a sanitized historical revision before restoring it and compare any two saved revisions side by side. The comparison endpoint requires Wiki manager access, verifies that both revisions belong to the selected location and page, sanitizes stored HTML before returning it, and applies the same linked-page readability redaction used by page history. Ordinary page readers retain the existing audience-scoped history preview and cannot call the comparison endpoint. The editor supports basic formatting, links, tables/lists via browser editing controls, and typed entity-link metadata. Entity ID lookup/autocomplete, file version history, a server-generated PDF (the browser print dialog is available), and full cross-module deep-link navigation are not included yet.
