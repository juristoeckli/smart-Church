# Interface languages

Smart Church stores a language preference on each user account. The setting follows the user across locations and sign-ins. Available choices are English (`en`), German (`de`), French (`fr`), and Italian (`it`); English is the fallback.

## Translation coverage

Localization is being rolled out by interface area. The current dictionary covers the shared navigation, Settings tabs and personal preferences (including session management), Overview, the Groups screen (including membership, public sign-up, join requests, and attendance), and Services & events schedule browsing (including list and month views). Event management dialogs, check-in and follow-up workflows, other core pages, and built-in modules still need translation. Backend error messages and some module-specific states also remain in English. The language selector does not mean those areas are fully localized yet.

## Adding or updating a translation

1. Add or update the English key in `apps/web/src/i18n.ts`.
2. Add the same key to all four language dictionaries in that file. The dictionaries share the English key type, so TypeScript reports a missing translation key.
3. Use the `translate` function for user-facing strings and keep each sentence as a complete translated value; do not assemble sentences from translated fragments.
4. Keep backend data, enum values, route names, and persisted values language-neutral. Translate only what the user sees.
5. Run the web TypeScript check. Review each language in the UI before marking its area complete.
