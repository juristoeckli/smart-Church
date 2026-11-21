import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scryptSync } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import type { ModuleServerContext } from "../module-sdk.js";

const kinds = ["service", "meeting", "community", "other"] as const;
type EventKind = typeof kinds[number];
type Provider = "google" | "microsoft";
type EventRow = { id: string; title: string; kind: EventKind; event_date: string; start_time: string; end_time: string | null; is_all_day: boolean; location: string; description: string | null; updated_at: string };
type Connection = { id: string; department_id: string; user_id: string; provider: Provider; account_email: string; calendar_id: string; calendar_name: string; encrypted_refresh_token: string; event_kinds: EventKind[]; last_sync_at: string | null; last_sync_error: string | null };
type CalendarItem = { id: string; name: string; primary?: boolean };
type OAuthTokens = { access_token: string; refresh_token?: string; expires_in?: number; token_type?: string };
const providerSet = new Set<Provider>(["google", "microsoft"]);

function digest(value: string) { return createHash("sha256").update(value).digest("hex"); }
function encryptionKey() {
  const source = process.env.SMART_CHURCH_CALENDAR_SYNC_ENCRYPTION_KEY || process.env.SMART_CHURCH_SYNC_ENCRYPTION_KEY || process.env.DATABASE_URL;
  if (!source) throw new Error("Set SMART_CHURCH_CALENDAR_SYNC_ENCRYPTION_KEY to protect calendar credentials.");
  return scryptSync(source, "smart-church/calendar-sync/v1", 32);
}
function encrypt(value: string) {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}
function decrypt(value: string) {
  const [version, iv, tag, data] = value.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Calendar credentials are unreadable. Please reconnect the calendar.");
  try { const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url")); decipher.setAuthTag(Buffer.from(tag, "base64url")); return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8"); }
  catch { throw new Error("Calendar credentials are unreadable. Please reconnect the calendar."); }
}
function normalizeKinds(value: unknown): EventKind[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !kinds.includes(item as EventKind))) throw new Error("Choose valid event types.");
  return [...new Set(value as EventKind[])];
}
function providerConfig(provider: Provider) {
  if (provider === "google") return {
    clientId: process.env.SMART_CHURCH_CALENDAR_GOOGLE_CLIENT_ID,
    clientSecret: process.env.SMART_CHURCH_CALENDAR_GOOGLE_CLIENT_SECRET,
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    scopes: ["openid", "email", "https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.calendarlist.readonly"],
  };
  return {
    clientId: process.env.SMART_CHURCH_CALENDAR_MICROSOFT_CLIENT_ID,
    clientSecret: process.env.SMART_CHURCH_CALENDAR_MICROSOFT_CLIENT_SECRET,
    authorize: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: ["openid", "profile", "email", "offline_access", "User.Read", "Calendars.ReadWrite"],
  };
}
function providerConfigured(provider: Provider) { const config = providerConfig(provider); return Boolean(config.clientId && config.clientSecret); }
function originFor(request: FastifyRequest) { return (process.env.SMART_CHURCH_WEB_ORIGIN || `${request.protocol}://${request.headers.host}`).replace(/\/$/, ""); }
function callbackUrl(request: FastifyRequest, provider: Provider) { return `${originFor(request)}/api/modules/calendar-sync/oauth/callback/${provider}`; }
function validProvider(value: string): value is Provider { return providerSet.has(value as Provider); }
async function requireUser(request: FastifyRequest, reply: FastifyReply, context: ModuleServerContext) {
  if (!request.authenticatedUser?.id) { reply.code(401).send({ error: "Sign in to continue." }); return null; }
  const departmentId = await context.resolveDepartmentId(request, reply);
  if (!departmentId) return null;
  return { departmentId, userId: request.authenticatedUser.id };
}
function setMutation(request: FastifyRequest, reply: FastifyReply, context: ModuleServerContext) { return context.validateMutation(request, reply); }

async function ensurePreferences(pool: Pool, departmentId: string, userId: string) {
  const existing = await pool.query<{ event_kinds: EventKind[]; feed_url_token: string | null; feed_enabled:boolean }>(
    "SELECT event_kinds,encrypted_feed_token AS feed_url_token,feed_enabled FROM calendar_sync_preferences WHERE department_id=$1 AND user_id=$2", [departmentId, userId]);
  if (existing.rowCount) return existing.rows[0]!;
  const token = randomBytes(32).toString("base64url");
  await pool.query("INSERT INTO calendar_sync_preferences(department_id,user_id,event_kinds,feed_token_hash,encrypted_feed_token,feed_enabled) VALUES($1,$2,$3,$4,'',FALSE) ON CONFLICT(department_id,user_id) DO NOTHING", [departmentId, userId, [...kinds], digest(token)]);
  const created = await pool.query<{ event_kinds: EventKind[]; feed_url_token: string; feed_enabled:boolean }>("SELECT event_kinds,encrypted_feed_token AS feed_url_token,feed_enabled FROM calendar_sync_preferences WHERE department_id=$1 AND user_id=$2", [departmentId, userId]);
  return created.rows[0]!;
}
function feedLink(request: FastifyRequest, token: string) { return `${originFor(request)}/api/public/calendar-sync/feed/${encodeURIComponent(token)}.ics`; }
function eventEnd(event:EventRow) {
  if(event.end_time)return {date:event.event_date.slice(0,10),time:event.end_time.slice(0,5)};
  const start=event.start_time.slice(0,5).split(":").map(Number);const date=new Date(`${event.event_date.slice(0,10)}T00:00:00Z`);date.setUTCMinutes(start[0]!*60+start[1]!+60);
  return {date:date.toISOString().slice(0,10),time:date.toISOString().slice(11,16)};
}
function escapeIcs(value: string) { return value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;"); }
function foldIcs(value: string) {
  const lines: string[] = [];
  let line = "";
  let bytes = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (bytes + characterBytes > 75 && line) {
      lines.push(line);
      line = ` ${character}`;
      bytes = 1 + characterBytes;
    } else {
      line += character;
      bytes += characterBytes;
    }
  }
  lines.push(line);
  return lines.join("\r\n");
}
function makeIcs(events: EventRow[], timeZone: string) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Smart-Church//Calendar Sync//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Smart-Church", `X-WR-TIMEZONE:${escapeIcs(timeZone)}`];
  for (const event of events) {
    const date = event.event_date.slice(0, 10).replace(/-/g, "");
    const endDate = event.is_all_day ? (() => { const d = new Date(`${event.event_date.slice(0, 10)}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10).replace(/-/g, ""); })() : eventEnd(event).date.replace(/-/g, "");
    const utcDateTime=(localDate:string,localTime:string)=>zonedDateTimeToUtc(localDate,localTime,timeZone).replace(/[-:]/g,"").replace(/\.\d{3}Z$/, "Z");
    lines.push("BEGIN:VEVENT", `UID:${event.id}@smart-church`, `DTSTAMP:${stamp}`, event.is_all_day ? `DTSTART;VALUE=DATE:${date}` : `DTSTART:${utcDateTime(event.event_date.slice(0,10),event.start_time)}`, event.is_all_day ? `DTEND;VALUE=DATE:${endDate}` : `DTEND:${utcDateTime(eventEnd(event).date,event.end_time||eventEnd(event).time)}`, `SUMMARY:${escapeIcs(event.title)}`);
    if (event.location) lines.push(`LOCATION:${escapeIcs(event.location)}`);
    if (event.description) lines.push(`DESCRIPTION:${escapeIcs(event.description)}`);
    lines.push(`CATEGORIES:${escapeIcs(event.kind)}`, `LAST-MODIFIED:${new Date(event.updated_at).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldIcs).join("\r\n")}\r\n`;
}
async function fetchEvents(pool: Pool, departmentId: string, eventKinds: EventKind[]) {
  if (!eventKinds.length) return [] as EventRow[];
  const result = await pool.query<EventRow>(
    `SELECT id,title,kind,event_date::text,start_time::text,end_time::text,is_all_day,location,description,updated_at::text
       FROM service_events WHERE department_id=$1 AND kind=ANY($2::text[]) ORDER BY event_date,start_time`, [departmentId, eventKinds]);
  return result.rows;
}

async function postForm(url: string, values: Record<string, string>) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(values) });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(payload.error_description || payload.error || "Calendar provider authorization failed."));
  return payload;
}
async function googleProfile(accessToken: string) {
  const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error("Google did not return the connected account profile.");
  return await response.json() as { email?: string };
}
async function microsoftProfile(accessToken: string) {
  const response = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error("Microsoft did not return the connected account profile.");
  return await response.json() as { mail?: string; userPrincipalName?: string };
}
async function refreshAccessToken(connection: Connection, pool: Pool): Promise<string> {
  const config = providerConfig(connection.provider); const refreshToken = decrypt(connection.encrypted_refresh_token);
  if (!config.clientId || !config.clientSecret) throw new Error(`${connection.provider === "google" ? "Google" : "Microsoft"} calendar OAuth is not configured on this server.`);
    const payload = await postForm(config.token, { client_id: config.clientId, client_secret: config.clientSecret, grant_type: "refresh_token", refresh_token: refreshToken, ...(connection.provider === "microsoft" ? { scope: config.scopes.join(" ") } : {}) }) as OAuthTokens;
  if (!payload.access_token) throw new Error("The calendar provider did not return an access token.");
  if (payload.refresh_token) await pool.query("UPDATE calendar_sync_connections SET encrypted_refresh_token=$2,updated_at=now() WHERE id=$1", [connection.id, encrypt(payload.refresh_token)]);
  return payload.access_token;
}
async function providerCalendars(provider: Provider, accessToken: string): Promise<CalendarItem[]> {
  const url = provider === "google" ? "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250" : "https://graph.microsoft.com/v1.0/me/calendars?$select=id,name&$top=100";
  const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  const payload = await response.json().catch(() => ({})) as { items?: Array<{ id: string; summary?: string; name?: string; primary?:boolean }>; value?: Array<{ id: string; name?: string; isDefaultCalendar?:boolean }> };
  if (!response.ok) throw new Error("Could not list calendars from the connected account.");
  return provider === "google" ? (payload.items ?? []).map((item) => ({ id: item.id, name: item.summary || item.id,primary:item.primary })) : (payload.value ?? []).map((item) => ({ id: item.id, name: item.name || item.id,primary:item.isDefaultCalendar }));
}
async function getCalendarEvents(pool: Pool, departmentId: string, kinds: EventKind[]) {
  const result = await pool.query<EventRow>(
    `SELECT id,title,kind,event_date::text,start_time::text,end_time::text,is_all_day,location,description,updated_at::text
       FROM service_events WHERE department_id=$1 AND kind=ANY($2::text[]) ORDER BY event_date,start_time`, [departmentId, kinds]);
  return result.rows;
}
function zonedDateTimeToUtc(date: string, time: string, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number); const [hour, minute, second = 0] = time.split(":").map(Number);
  const target = Date.UTC(year!, month! - 1, day!, hour!, minute!, second!);
  let guess = target;
  for (let index = 0; index < 3; index++) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(guess));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const represented = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour) % 24, Number(values.minute), Number(values.second));
    guess += target - represented;
  }
  return new Date(guess).toISOString();
}
function eventFingerprint(event: EventRow) { return digest(JSON.stringify([event.title,event.kind,event.event_date.slice(0,10),event.start_time,event.end_time,event.is_all_day,event.location,event.description])); }
async function remoteUpsert(provider: Provider, accessToken: string, calendarId: string, existingId: string | null, event: EventRow, timeZone: string) {
  let url: string; let method: string; let body: Record<string, unknown>;
  if (provider === "google") {
    const root = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
    url = existingId ? `${root}/${encodeURIComponent(existingId)}` : root; method = existingId ? "PATCH" : "POST";
    const end=eventEnd(event);
    body = { summary: event.title, description: event.description || undefined, location: event.location || undefined, extendedProperties: { private: { smartChurchEventId: event.id } }, ...(event.is_all_day ? { start: { date: event.event_date.slice(0,10) }, end: { date: (() => { const d = new Date(`${event.event_date.slice(0,10)}T00:00:00Z`); d.setUTCDate(d.getUTCDate()+1); return d.toISOString().slice(0,10); })() } } : { start: { dateTime: `${event.event_date.slice(0,10)}T${event.start_time.slice(0,8)}`, timeZone }, end: { dateTime: `${end.date}T${end.time}:00`, timeZone } }) };
  } else {
    const root = `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(calendarId)}/events`;
    url = existingId ? `${root}/${encodeURIComponent(existingId)}` : root; method = existingId ? "PATCH" : "POST";
    const end=eventEnd(event);
    body = { subject: event.title, body: event.description ? { contentType: "text", content: event.description } : undefined, location: event.location ? { displayName: event.location } : undefined, showAs: "busy", ...(event.is_all_day ? { isAllDay: true, start: { dateTime: `${event.event_date.slice(0,10)}T00:00:00`, timeZone: "UTC" }, end: { dateTime: (() => { const d = new Date(`${event.event_date.slice(0,10)}T00:00:00Z`); d.setUTCDate(d.getUTCDate()+1); return `${d.toISOString().slice(0,10)}T00:00:00`; })(), timeZone: "UTC" } } : { isAllDay: false, start: { dateTime: zonedDateTimeToUtc(event.event_date.slice(0,10), event.start_time, timeZone).slice(0,19), timeZone: "UTC" }, end: { dateTime: zonedDateTimeToUtc(end.date, `${end.time}:00`, timeZone).slice(0,19), timeZone: "UTC" } }) };
  }
  const response = await fetch(url, { method, headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json", ...(provider === "microsoft" ? { Prefer: 'outlook.timezone="UTC"' } : {}) }, body: JSON.stringify(body) });
  if (response.status === 404 && existingId) return remoteUpsert(provider, accessToken, calendarId, null, event, timeZone);
  if (!response.ok) { const text = await response.text().catch(() => ""); throw new Error(`${provider === "google" ? "Google" : "Microsoft"} calendar write failed (${response.status})${text ? `: ${text.slice(0,240)}` : "."}`); }
  if (response.status === 204) return existingId!;
  const payload = await response.json() as { id?: string };
  if (!payload.id && !existingId) throw new Error("The calendar provider did not return an event identifier.");
  return payload.id || existingId!;
}
async function remoteDelete(provider: Provider, accessToken: string, calendarId: string, remoteId: string) {
  const url = provider === "google" ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(remoteId)}` : `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(remoteId)}`;
  const response = await fetch(url, { method: "DELETE", headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok && response.status !== 404) throw new Error(`Calendar event deletion failed (${response.status}).`);
}
async function syncConnection(pool: Pool, connection: Connection) {
  const accessToken = await refreshAccessToken(connection, pool);
  const zoneResult = await pool.query<{ time_zone: string }>("SELECT time_zone FROM departments WHERE id=$1", [connection.department_id]);
  const timeZone = zoneResult.rows[0]?.time_zone || "Europe/Zurich";
  const events = await getCalendarEvents(pool, connection.department_id, connection.event_kinds);
  const existing = await pool.query<{ event_id: string; remote_event_id: string; event_fingerprint: string }>("SELECT event_id,remote_event_id,event_fingerprint FROM calendar_sync_event_links WHERE connection_id=$1", [connection.id]);
  const byEvent = new Map(existing.rows.map((row) => [row.event_id, row])); const activeIds = new Set(events.map((event) => event.id));
  for (const event of events) {
    const link = byEvent.get(event.id); const fingerprint = eventFingerprint(event);
    if (link && link.event_fingerprint === fingerprint) continue;
    const remoteId = await remoteUpsert(connection.provider, accessToken, connection.calendar_id, link?.remote_event_id ?? null, event, timeZone);
    await pool.query(`INSERT INTO calendar_sync_event_links(connection_id,event_id,remote_event_id,event_fingerprint) VALUES($1,$2,$3,$4)
      ON CONFLICT(connection_id,event_id) DO UPDATE SET remote_event_id=EXCLUDED.remote_event_id,event_fingerprint=EXCLUDED.event_fingerprint,updated_at=now()`, [connection.id,event.id,remoteId,fingerprint]);
  }
  for (const link of existing.rows) if (!activeIds.has(link.event_id)) {
    await remoteDelete(connection.provider, accessToken, connection.calendar_id, link.remote_event_id);
    await pool.query("DELETE FROM calendar_sync_event_links WHERE connection_id=$1 AND event_id=$2", [connection.id, link.event_id]);
  }
  await pool.query("UPDATE calendar_sync_connections SET last_sync_at=now(),last_sync_error=NULL,updated_at=now() WHERE id=$1", [connection.id]);
}

export function registerCalendarSyncRoutes(app: FastifyInstance, context: ModuleServerContext) {
  const pool = context.pool;
  if (!pool) return;
  const activeSyncs = new Set<string>();
  app.get("/api/modules/calendar-sync/status", async (request, reply) => {
    const identity = await requireUser(request, reply, context); if (!identity) return reply;
    const prefs = await ensurePreferences(pool, identity.departmentId, identity.userId);
    const connections = await pool.query<{ id: string; provider: Provider; account_email: string; calendar_id: string; calendar_name: string; event_kinds: EventKind[]; last_sync_at: string | null; last_sync_error: string | null }>("SELECT id,provider,account_email,calendar_id,calendar_name,event_kinds,last_sync_at::text,last_sync_error FROM calendar_sync_connections WHERE department_id=$1 AND user_id=$2 ORDER BY created_at", [identity.departmentId,identity.userId]);
    let token = ""; if(prefs.feed_enabled)try { token = decrypt(prefs.feed_url_token ?? ""); } catch { /* old or corrupt feed can be rotated from settings */ }
    return { configured: { google: providerConfigured("google"), microsoft: providerConfigured("microsoft") }, eventKinds: prefs.event_kinds, feedUrl: token ? feedLink(request, token) : null, connections: connections.rows.map((row) => ({ id:row.id,provider:row.provider,accountEmail:row.account_email,calendarId:row.calendar_id,calendarName:row.calendar_name,eventKinds:row.event_kinds,lastSyncAt:row.last_sync_at,lastSyncError:row.last_sync_error })) };
  });
  app.put<{ Body: { eventKinds: EventKind[] } }>("/api/modules/calendar-sync/preferences", async (request, reply) => {
    if (!setMutation(request,reply,context)) return reply;
    const identity = await requireUser(request,reply,context); if (!identity) return reply;
    let eventKinds: EventKind[]; try { eventKinds = normalizeKinds(request.body?.eventKinds); } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Choose valid event types." }); }
    const token = randomBytes(32).toString("base64url");
    await pool.query(`INSERT INTO calendar_sync_preferences(department_id,user_id,event_kinds,feed_token_hash,encrypted_feed_token,feed_enabled) VALUES($1,$2,$3,$4,'',FALSE)
      ON CONFLICT(department_id,user_id) DO UPDATE SET event_kinds=EXCLUDED.event_kinds,updated_at=now()`, [identity.departmentId,identity.userId,eventKinds,digest(token)]);
    return { eventKinds };
  });
  app.post("/api/modules/calendar-sync/feed", async (request, reply) => {
    if (!setMutation(request,reply,context)) return reply;
    const identity = await requireUser(request,reply,context); if (!identity) return reply;
    const token = randomBytes(32).toString("base64url");
    await pool.query(`INSERT INTO calendar_sync_preferences(department_id,user_id,event_kinds,feed_token_hash,encrypted_feed_token,feed_enabled) VALUES($1,$2,$3,$4,$5,TRUE)
      ON CONFLICT(department_id,user_id) DO UPDATE SET feed_token_hash=EXCLUDED.feed_token_hash,encrypted_feed_token=EXCLUDED.encrypted_feed_token,feed_enabled=TRUE,updated_at=now()`, [identity.departmentId,identity.userId,[...kinds],digest(token),encrypt(token)]);
    return { feedUrl: feedLink(request,token) };
  });
  app.delete("/api/modules/calendar-sync/feed", async (request, reply) => {
    if (!setMutation(request,reply,context)) return reply;
    const identity = await requireUser(request,reply,context); if (!identity) return reply;
    await pool.query("UPDATE calendar_sync_preferences SET feed_token_hash=$3,encrypted_feed_token='',feed_enabled=FALSE,updated_at=now() WHERE department_id=$1 AND user_id=$2", [identity.departmentId,identity.userId,digest(randomBytes(32).toString("base64url"))]);
    return { ok:true };
  });
  app.get<{ Params: { token: string } }>("/api/public/calendar-sync/feed/:token.ics", async (request, reply) => {
    const token = request.params.token;
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return reply.code(404).send();
    const found = await pool.query<{ department_id: string; user_id: string; event_kinds: EventKind[] }>("SELECT department_id,user_id,event_kinds FROM calendar_sync_preferences WHERE feed_token_hash=$1 AND feed_enabled=TRUE", [digest(token)]);
    if (!found.rowCount) return reply.code(404).send();
    const item = found.rows[0]!;
    const events = await fetchEvents(pool,item.department_id,item.event_kinds);
    const zone = await pool.query<{ time_zone: string }>("SELECT time_zone FROM departments WHERE id=$1", [item.department_id]);
    const body = makeIcs(events,zone.rows[0]?.time_zone || "Europe/Zurich");
    const etag=`"${digest(body)}"`;reply.header("ETag",etag).header("Cache-Control","private, max-age=300, must-revalidate").header("Content-Type","text/calendar; charset=utf-8").header("Content-Disposition","inline; filename=smart-church.ics").header("X-Robots-Tag","noindex, nofollow");
    if(request.headers["if-none-match"]===etag)return reply.code(304).send();
    return reply.send(body);
  });
  app.post<{ Params: { provider: string } }>("/api/modules/calendar-sync/oauth/:provider/start", async (request, reply) => {
    if (!setMutation(request,reply,context)) return reply;
    const identity = await requireUser(request,reply,context); if (!identity) return reply;
    const provider = request.params.provider;
    if (!validProvider(provider)) return reply.code(400).send({ error:"Choose Google Calendar or Microsoft 365." });
    const config = providerConfig(provider);
    if (!config.clientId || !config.clientSecret) return reply.code(503).send({ error:`${provider === "google" ? "Google" : "Microsoft"} calendar connection is not configured on this server.` });
    const state = randomBytes(32).toString("base64url");
    await pool.query("INSERT INTO calendar_sync_oauth_states(state_hash,department_id,user_id,provider,expires_at) VALUES($1,$2,$3,$4,now()+interval '10 minutes')", [digest(state),identity.departmentId,identity.userId,provider]);
    const url = new URL(config.authorize); url.searchParams.set("client_id",config.clientId); url.searchParams.set("response_type","code"); url.searchParams.set("redirect_uri",callbackUrl(request,provider)); url.searchParams.set("scope",config.scopes.join(" ")); url.searchParams.set("state",state);
    if (provider === "google") { url.searchParams.set("access_type","offline"); url.searchParams.set("include_granted_scopes","true"); url.searchParams.set("prompt","consent"); }
    else url.searchParams.set("response_mode","query");
    return { url:url.toString() };
  });
  app.get<{ Params: { provider: string }; Querystring: { code?: string; state?: string; error?: string } }>("/api/modules/calendar-sync/oauth/callback/:provider", async (request, reply) => {
    const provider = request.params.provider;
    const finish = (result: string) => reply.redirect(`/settings?calendarSync=${encodeURIComponent(result)}`);
    if (!validProvider(provider) || !request.query.state || !request.query.code || request.query.error) return finish("failed");
    const state = await pool.query<{ department_id: string; user_id: string; provider: Provider }>("DELETE FROM calendar_sync_oauth_states WHERE state_hash=$1 AND expires_at>now() RETURNING department_id,user_id,provider", [digest(request.query.state)]);
    const identity = state.rows[0]; if (!identity || identity.provider !== provider) return finish("expired");
    const config = providerConfig(provider); if (!config.clientId || !config.clientSecret) return finish("failed");
    try {
      const tokenPayload = await postForm(config.token,{client_id:config.clientId,client_secret:config.clientSecret,code:request.query.code,grant_type:"authorization_code",redirect_uri:callbackUrl(request,provider)}) as OAuthTokens;
      if (!tokenPayload.access_token || !tokenPayload.refresh_token) throw new Error("A refresh token was not returned. Revoke the previous app grant and try again.");
      const profile = provider === "google" ? await googleProfile(tokenPayload.access_token) : await microsoftProfile(tokenPayload.access_token);
      const email = provider === "google" ? (profile as {email?:string}).email || "Google account" : (profile as { mail?:string;userPrincipalName?:string }).mail || (profile as { userPrincipalName?:string }).userPrincipalName || "Microsoft account";
      const calendars = await providerCalendars(provider,tokenPayload.access_token);
      const calendar = calendars.find((item) => item.primary) || calendars.find((item) => item.id === "primary") || calendars[0];
      if (!calendar) throw new Error("The connected account has no available calendar.");
      const preferences=await pool.query<{event_kinds:EventKind[]}>("SELECT event_kinds FROM calendar_sync_preferences WHERE department_id=$1 AND user_id=$2",[identity.department_id,identity.user_id]);
      await pool.query(`INSERT INTO calendar_sync_connections(id,department_id,user_id,provider,account_email,calendar_id,calendar_name,encrypted_refresh_token,event_kinds)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT(department_id,user_id,provider,calendar_id) DO UPDATE SET account_email=EXCLUDED.account_email,calendar_name=EXCLUDED.calendar_name,encrypted_refresh_token=EXCLUDED.encrypted_refresh_token,last_sync_error=NULL,updated_at=now()`, [randomUUID(),identity.department_id,identity.user_id,provider,email,calendar.id,calendar.name,encrypt(tokenPayload.refresh_token),preferences.rows[0]?.event_kinds ?? [...kinds]]);
      return finish("connected");
    } catch (error) {
      request.log.warn({ err:error, provider },"Calendar account connection failed.");
      return finish("failed");
    }
  });
  app.get<{ Params: { provider: string } }>("/api/modules/calendar-sync/calendars/:provider", async (request,reply) => {
    const identity = await requireUser(request,reply,context); if (!identity) return reply;
    const provider=request.params.provider; if (!validProvider(provider)) return reply.code(400).send({error:"Unknown calendar provider."});
    const found=await pool.query<Connection>("SELECT * FROM calendar_sync_connections WHERE department_id=$1 AND user_id=$2 AND provider=$3 ORDER BY updated_at DESC LIMIT 1",[identity.departmentId,identity.userId,provider]);
    if (!found.rowCount) return reply.code(404).send({error:"Connect this provider first."});
    try { const access=await refreshAccessToken(found.rows[0]!,pool); return { calendars:await providerCalendars(provider,access) }; }
    catch (error) { return reply.code(502).send({error:error instanceof Error?error.message:"Could not list calendars."}); }
  });
  app.put<{ Params: { id:string }; Body: { calendarId?:string; eventKinds?:EventKind[] } }>("/api/modules/calendar-sync/connections/:id", async (request,reply) => {
    if (!setMutation(request,reply,context)) return reply;
    const identity=await requireUser(request,reply,context); if (!identity) return reply;
    const connection=await pool.query<Connection>("SELECT * FROM calendar_sync_connections WHERE id=$1 AND department_id=$2 AND user_id=$3",[request.params.id,identity.departmentId,identity.userId]);
    if(!connection.rowCount)return reply.code(404).send({error:"Calendar connection not found."});
    let eventKinds:EventKind[]; try { eventKinds=request.body?.eventKinds===undefined?connection.rows[0]!.event_kinds:normalizeKinds(request.body.eventKinds); } catch (error) { return reply.code(400).send({error:error instanceof Error?error.message:"Choose valid event types."}); }
    const calendarId=typeof request.body?.calendarId==="string"?request.body.calendarId.trim():connection.rows[0]!.calendar_id; if (!calendarId||calendarId.length>512) return reply.code(400).send({error:"Choose a valid calendar."});
    const linked=await pool.query<{remote_event_id:string}>("SELECT remote_event_id FROM calendar_sync_event_links WHERE connection_id=$1",[request.params.id]);
    let access:string;
    try { access=await refreshAccessToken(connection.rows[0]!,pool); }
    catch(error){ return reply.code(502).send({error:error instanceof Error?error.message:"Could not access the connected calendar."}); }
    const calendars=await providerCalendars(connection.rows[0]!.provider,access);
    const calendar=calendars.find((item)=>item.id===calendarId); if(!calendar)return reply.code(400).send({error:"That calendar is no longer available in the connected account."});
    if(connection.rows[0]!.calendar_id!==calendarId&&linked.rowCount){
      try { for(const event of linked.rows) await remoteDelete(connection.rows[0]!.provider,access,connection.rows[0]!.calendar_id,event.remote_event_id); }
      catch(error){ return reply.code(502).send({error:error instanceof Error?error.message:"Could not clear the previously selected calendar."}); }
    }
    const result=await pool.query("UPDATE calendar_sync_connections SET calendar_id=$4,calendar_name=$5,event_kinds=$6,updated_at=now(),last_sync_error=NULL,last_sync_at=NULL WHERE id=$1 AND department_id=$2 AND user_id=$3 RETURNING id",[request.params.id,identity.departmentId,identity.userId,calendarId,calendar.name,eventKinds]);
    if (!result.rowCount) return reply.code(404).send({error:"Calendar connection not found."});
    if(connection.rows[0]!.calendar_id!==calendarId)await pool.query("DELETE FROM calendar_sync_event_links WHERE connection_id=$1",[request.params.id]);
    return {ok:true};
  });
  app.delete<{ Params:{id:string} }>("/api/modules/calendar-sync/connections/:id",async(request,reply)=>{
    if(!setMutation(request,reply,context))return reply; const identity=await requireUser(request,reply,context);if(!identity)return reply;
    const connection=await pool.query<Connection>("SELECT * FROM calendar_sync_connections WHERE id=$1 AND department_id=$2 AND user_id=$3",[request.params.id,identity.departmentId,identity.userId]);
    if(!connection.rowCount)return reply.code(404).send({error:"Calendar connection not found."});
    const linked=await pool.query<{remote_event_id:string}>("SELECT remote_event_id FROM calendar_sync_event_links WHERE connection_id=$1",[request.params.id]);
    try { if(linked.rowCount){const access=await refreshAccessToken(connection.rows[0]!,pool);for(const event of linked.rows)await remoteDelete(connection.rows[0]!.provider,access,connection.rows[0]!.calendar_id,event.remote_event_id);} }
    catch(error){return reply.code(502).send({error:error instanceof Error?error.message:"Could not remove the synced events from the connected calendar."});}
    await pool.query("DELETE FROM calendar_sync_connections WHERE id=$1 AND department_id=$2 AND user_id=$3",[request.params.id,identity.departmentId,identity.userId]);return{ok:true};
  });

  const interval = setInterval(async () => {
    try {
      const due = await pool.query<Connection>("SELECT * FROM calendar_sync_connections WHERE last_sync_at IS NULL OR last_sync_at < now()-interval '2 minutes' ORDER BY last_sync_at NULLS FIRST LIMIT 25");
      for (const connection of due.rows) {
        if(activeSyncs.has(connection.id))continue;
        activeSyncs.add(connection.id);
        try { await syncConnection(pool,connection); }
        catch (error) { const message=error instanceof Error?error.message:"Calendar sync failed."; await pool.query("UPDATE calendar_sync_connections SET last_sync_error=$2,last_sync_at=now(),updated_at=now() WHERE id=$1",[connection.id,message.slice(0,1000)]); }
        finally {activeSyncs.delete(connection.id);}
      }
    } catch { /* Database may be restarting; next pass retries. */ }
  },60_000);
  interval.unref();
  app.addHook("onClose", async () => clearInterval(interval));
}
