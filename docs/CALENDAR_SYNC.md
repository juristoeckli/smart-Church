# Calendar Sync setup

Calendar Sync is a hidden module with a settings panel; it adds no navigation item. Each user can filter the local event categories, publish a private ICS link, and connect a Google Calendar or Microsoft 365 calendar. Connected calendars are updated by the server in the background.

## Configure provider OAuth

The server administrator configures OAuth application credentials in the deployment environment and restarts the API. Do not put provider secrets in source control.

For Google Calendar, create an OAuth client for a web application in Google Cloud, enable the Google Calendar API, and configure the app's consent screen. Set:

```env
SMART_CHURCH_CALENDAR_GOOGLE_CLIENT_ID=...
SMART_CHURCH_CALENDAR_GOOGLE_CLIENT_SECRET=...
```

For Microsoft 365, register a web application in Microsoft Entra ID and allow organizational and personal Microsoft accounts if both are needed. Add the delegated Microsoft Graph permissions `Calendars.ReadWrite`, `User.Read`, and `offline_access`. Set:

```env
SMART_CHURCH_CALENDAR_MICROSOFT_CLIENT_ID=...
SMART_CHURCH_CALENDAR_MICROSOFT_CLIENT_SECRET=...
```

For each provider configured, register this exact redirect URI, replacing the origin with the deployed Smart-Church HTTPS origin:

```text
https://church.example.org/api/modules/calendar-sync/oauth/callback/google
https://church.example.org/api/modules/calendar-sync/oauth/callback/microsoft
```

The callback paths are also shown in the Calendar Sync settings. Set a stable `SMART_CHURCH_SYNC_ENCRYPTION_KEY` before users connect accounts. Changing that key later makes stored refresh tokens unreadable and requires users to reconnect.

## User setup

In Settings → Modules, open Calendar Sync. Select the event categories to sync, then connect a Google or Microsoft account and choose one of its calendars. Connections sync in one direction, from Smart-Church to the chosen calendar. A user can also create a private ICS feed; the link acts as a secret, so share it only with trusted calendar apps and revoke it if exposed. ICS feed consumers may refresh on their own schedule.

The ICS feed includes event titles, dates/times, location, and description for the categories selected by that user. Event sync maintains provider event IDs so repeated runs update the same calendar items. Deleting or unselecting local events removes their linked provider items on the next sync.

## Provider documentation

- [Google Calendar web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server) and [Google Calendar event insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)
- [Microsoft identity platform authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow) and [Microsoft Graph create event](https://learn.microsoft.com/en-us/graph/api/calendar-post-events?view=graph-rest-1.0)
