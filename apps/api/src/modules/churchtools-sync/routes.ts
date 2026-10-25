import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";

interface Dependencies {
  pool: Pool | null;
  isDatabaseReady: () => boolean;
  resolveDepartmentId: (request: FastifyRequest, reply: FastifyReply, requireSiteAdmin?: boolean) => Promise<string | null>;
}
type JsonObject = Record<string, any>;
type Settings = { department_id: string; instance_url: string; encrypted_login_token: string; enabled: boolean };
const running = new Set<string>();
const syncIntervalMs = 15 * 60 * 1000;

function cryptoKey() {
  const source = process.env.SMART_CHURCH_SYNC_ENCRYPTION_KEY || process.env.DATABASE_URL;
  if (!source) throw new Error("Set SMART_CHURCH_SYNC_ENCRYPTION_KEY to encrypt the ChurchTools token.");
  return scryptSync(source, "smart-church/churchtools-sync/v1", 32);
}
function encrypt(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", cryptoKey(), iv);
  const data = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}
function decrypt(value: string) {
  const [version, iv, tag, data] = value.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Re-enter the ChurchTools login token.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", cryptoKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch { throw new Error("Re-enter the ChurchTools login token."); }
}
function normalizeUrl(value: string) {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("Enter a valid ChurchTools URL."); }
  if (url.protocol !== "https:" || (url.hostname !== "church.tools" && !url.hostname.endsWith(".church.tools"))) {
    throw new Error("Use a secure ChurchTools cloud URL, such as https://my-church.church.tools.");
  }
  url.pathname = url.pathname.replace(/\/+$/, ""); url.search = ""; url.hash = "";
  return url.toString().replace(/\/$/, "");
}
async function get(base: string, token: string, path: string): Promise<JsonObject> {
  const response = await fetch(base.replace(/\/+$/, "") + "/api/" + path.replace(/^\/+/, ""), {
    headers: { Authorization: "Login " + token, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000), redirect: "error",
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error("ChurchTools rejected the token or does not grant read access to " + path.split("?")[0] + ".");
    throw new Error("ChurchTools returned HTTP " + response.status + " for " + path.split("?")[0] + ".");
  }
  return await response.json() as JsonObject;
}
function rows(payload: JsonObject): JsonObject[] {
  const options = [payload.data, payload.data?.data, payload.persons, payload.groups, payload.events, payload.appointments, payload.resources, payload.members, payload.data?.persons, payload.data?.groups, payload.data?.events, payload.data?.resources, payload.data?.appointments, payload.data?.members, payload.items];
  return (options.find(Array.isArray) ?? []).filter((value: unknown) => value && typeof value === "object");
}
function idOf(row: JsonObject) {
  const value = row.id ?? row.personId ?? row.groupId ?? row.eventId ?? row.appointmentId ?? row.resourceId;
  return value === undefined || value === null ? "" : String(value);
}
function firstText(...values: any[]) {
  return (values.find((value) => typeof value === "string" && value.trim()) ?? "").trim();
}
function personIdOf(row: JsonObject) {
  const value = row.personId ?? row.person?.id ?? row.person_id ?? row.memberId ?? row.person?.personId ?? row.id;
  return value === undefined || value === null ? "" : String(value);
}
async function mapConcurrent<T, R>(items: T[], concurrency: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const result = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) { const index = next++; result[index] = await run(items[index]); }
  }));
  return result;
}
function resourceCategory(row: JsonObject): "room" | "vehicle" | "equipment" | "other" {
  const value = firstText(row.resourceType?.name, row.type?.name, row.type, row.category).toLocaleLowerCase();
  if (/room|space|meeting|raum|zimmer|saal/.test(value)) return "room";
  if (/vehicle|car|bus|auto|fahrzeug/.test(value)) return "vehicle";
  if (/equipment|device|technical|technik|equipment|gerät/.test(value)) return "equipment";
  return "other";
}
async function list(base: string, token: string, endpoint: string) {
  const result: JsonObject[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const payload = await get(base, token, endpoint + (endpoint.includes("?") ? "&" : "?") + "limit=200&page=" + page);
    const entries = rows(payload);
    result.push(...entries);
    const meta = payload.meta?.pagination ?? payload.meta ?? payload.data?.meta?.pagination ?? {};
    const last = Number(meta.lastPage ?? meta.last_page ?? meta.totalPages ?? 0);
    if ((last && page >= last) || entries.length < 200) break;
  }
  return result;
}
async function testLogin(base: string, token: string) {
  if (!token.trim()) throw new Error("Enter a ChurchTools login token.");
  await get(base, token.trim(), "whoami");
}
function dateTime(value: any, dateFallback?: string, timeFallback?: string) {
  if (typeof value === "string" && value) {
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) return { date: value.slice(0, 10), time: value.length >= 16 ? value.slice(11, 16) : timeFallback?.slice(0, 5) || "09:00" };
  }
  if (dateFallback && /^\d{4}-\d{2}-\d{2}$/.test(dateFallback)) return { date: dateFallback, time: timeFallback?.slice(0, 5) || "09:00" };
  return null;
}
function mapEvents(events: JsonObject[]) {
  return events.flatMap((row) => {
    const sourceId = idOf(row);
    const start = dateTime(row.startDate ?? row.start ?? row.startDateTime ?? row.date, row.date, row.startTime);
    if (!sourceId || !start) return [];
    const end = dateTime(row.endDate ?? row.end ?? row.endDateTime, start.date, row.endTime);
    const assignments: JsonObject[] = Array.isArray(row.services) ? row.services : Array.isArray(row.eventServices) ? row.eventServices : [];
    const agenda: JsonObject[] = Array.isArray(row.agenda?.items) ? row.agenda.items : Array.isArray(row.agendaItems) ? row.agendaItems : [];
    return [{
      sourceId, title: firstText(row.name, row.title, row.subject) || "ChurchTools service",
      date: start.date, start: start.time, end: end?.date === start.date && end.time > start.time ? end.time : null,
      location: firstText(row.location?.name, row.location, row.place, row.calendarName, row.calendar?.name) || "ChurchTools",
      room: firstText(row.room?.name, row.room), description: firstText(row.description, row.note).slice(0, 2000),
      positions: assignments.flatMap((item) => {
        const name = firstText(item.serviceName, item.service?.name, item.name, item.title);
        const personId = item.personId ?? item.person?.id;
        return name ? [{ name, ...(personId ? { personId: String(personId) } : {}) }] : [];
      }),
      timePlan: agenda.flatMap((item) => {
        const title = firstText(item.name, item.title, item.label);
        if (!title) return [];
        const when = dateTime(item.startDateTime ?? item.start ?? item.time, start.date, item.startTime);
        const duration = Number(item.durationMinutes ?? item.duration);
        return [{ title, ...(when ? { startTime: when.time } : {}), ...(duration > 0 ? { durationMinutes: duration } : {}), ...(firstText(item.description, item.note) ? { notes: firstText(item.description, item.note).slice(0, 500) } : {}) }];
      }),
    }];
  });
}

export function registerChurchToolsSyncRoutes(app: FastifyInstance, deps: Dependencies) {
  const { pool, isDatabaseReady, resolveDepartmentId } = deps;
  app.register(async (routes) => {
    async function department(request: FastifyRequest, reply: FastifyReply, manage = false) {
      if (!pool || !isDatabaseReady()) { reply.code(503).send({ error: "The database is unavailable." }); return null; }
      return resolveDepartmentId(request, reply, manage);
    }
    async function settings(departmentId: string) {
      const result = await pool!.query<Settings>("SELECT department_id,instance_url,encrypted_login_token,enabled FROM churchtools_sync_settings WHERE department_id=$1", [departmentId]);
      return result.rows[0] ?? null;
    }
    async function statusError(departmentId: string, message: string) {
      await pool!.query("UPDATE churchtools_sync_settings SET last_sync_error=$2,updated_at=now() WHERE department_id=$1", [departmentId, message.slice(0, 1000)]);
    }
    async function run(departmentId: string) {
      if (!pool || !isDatabaseReady()) throw new Error("The database is unavailable.");
      if (running.has(departmentId)) throw new Error("A ChurchTools sync is already running.");
      running.add(departmentId);
      try {
        const config = await settings(departmentId);
        if (!config) throw new Error("Configure the ChurchTools connection first.");
        if (!config.enabled) throw new Error("ChurchTools sync is disabled.");
        const token = decrypt(config.encrypted_login_token);
        const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
        const to = new Date(Date.now() + 400 * 86400000).toISOString().slice(0, 10);
        const [people, groups, events, resources] = await Promise.all([
          list(config.instance_url, token, "persons"), list(config.instance_url, token, "groups"),
          get(config.instance_url, token, "events?from=" + from + "&to=" + to).then(rows),
          list(config.instance_url, token, "resources"),
        ]);
        const groupMembers = await mapConcurrent(groups, 8, async (group) => {
          const sourceId = idOf(group);
          if (!sourceId) return null;
          const embedded = Array.isArray(group.members) ? group.members : Array.isArray(group.persons) ? group.persons : null;
          if (embedded) return embedded as JsonObject[];
          try { return await list(config.instance_url, token, `groups/${encodeURIComponent(sourceId)}/members`); }
          catch (error) {
            if (error instanceof Error && error.message.includes("HTTP 404")) throw new Error(`ChurchTools did not return a member list for group “${firstText(group.name, group.title) || sourceId}”. Check the API path and group read permissions.`);
            throw error;
          }
        });
        const services = mapEvents(events);
        const db = await pool.connect();
        try {
          await db.query("BEGIN");
          const personMap = new Map<string, string>();
          for (const person of people) {
            const sourceId = idOf(person);
            if (!sourceId) continue;
            const first = firstText(person.firstName, person.first_name, person.firstname, person.givenName) || "ChurchTools";
            const last = firstText(person.lastName, person.last_name, person.lastname, person.familyName) || ("Person " + sourceId);
            const email = firstText(person.email, person.emailAddress) || null;
            const phone = firstText(person.mobile, person.phonePrivate, person.phoneWork, person.phone) || null;
            const found = await db.query<{ id: string }>("SELECT id FROM contacts WHERE department_id=$1 AND ((source_system='churchtools' AND source_id=$2) OR (source_system IS NULL AND $3::text IS NOT NULL AND lower(email)=lower($3))) ORDER BY CASE WHEN source_system='churchtools' THEN 0 ELSE 1 END LIMIT 1 FOR UPDATE", [departmentId, sourceId, email]);
            let localId: string;
            if (found.rowCount) {
              localId = found.rows[0].id;
              await db.query("UPDATE contacts SET first_name=$3,last_name=$4,email=$5,phone=$6,status='member',source_system='churchtools',source_id=$7,updated_at=now() WHERE id=$1 AND department_id=$2", [localId, departmentId, first, last, email, phone, sourceId]);
            } else {
              const inserted = await db.query<{ id: string }>("INSERT INTO contacts (id,department_id,first_name,last_name,email,phone,status,source_system,source_id) VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,'member','churchtools',$6) RETURNING id", [departmentId, first, last, email, phone, sourceId]);
              localId = inserted.rows[0].id;
            }
            personMap.set(sourceId, localId);
          }
          if (people.length) await db.query("DELETE FROM contacts WHERE department_id=$1 AND source_system='churchtools' AND source_id<>ALL($2::text[])", [departmentId, people.map(idOf).filter(Boolean)]);
          for (const [groupIndex, group] of groups.entries()) {
            const sourceId = idOf(group); const name = firstText(group.name, group.title);
            if (!sourceId || !name) continue;
            const description = firstText(group.description, group.information, group.note).slice(0, 1000);
            const found = await db.query<{ id: string }>("SELECT id FROM church_groups WHERE department_id=$1 AND source_system='churchtools' AND source_id=$2 FOR UPDATE", [departmentId, sourceId]);
            let groupId: string;
            if (found.rowCount) {
              groupId = found.rows[0].id;
              await db.query("UPDATE church_groups SET name=$3,description=$4,updated_at=now() WHERE id=$1 AND department_id=$2", [groupId, departmentId, name.slice(0, 120), description]);
            } else {
              const matching = await db.query<{ id: string }>("SELECT id FROM church_groups WHERE department_id=$1 AND source_system IS NULL AND lower(name)=lower($2) ORDER BY created_at LIMIT 1 FOR UPDATE", [departmentId, name]);
              if (matching.rowCount) {
                groupId = matching.rows[0].id;
                await db.query("UPDATE church_groups SET name=$3,description=$4,source_system='churchtools',source_id=$5,updated_at=now() WHERE id=$1 AND department_id=$2", [groupId, departmentId, name.slice(0, 120), description, sourceId]);
              } else {
                const inserted = await db.query<{ id: string }>("INSERT INTO church_groups (id,department_id,name,description,source_system,source_id) VALUES (gen_random_uuid(),$1,$2,$3,'churchtools',$4) RETURNING id", [departmentId, name.slice(0, 120), description, sourceId]);
                groupId = inserted.rows[0].id;
              }
            }
            const importedMembers = groupMembers[groupIndex];
            if (importedMembers !== null) {
              await db.query("DELETE FROM group_members WHERE group_id=$1", [groupId]);
              for (const member of importedMembers) {
                const personId = personIdOf(member);
                const contactId = personMap.get(personId);
                if (!contactId) continue;
                await db.query("INSERT INTO group_members (group_id,contact_id) VALUES ($1,$2) ON CONFLICT (group_id,contact_id) DO NOTHING", [groupId, contactId]);
              }
            }
          }
          if (groups.length) await db.query("DELETE FROM church_groups WHERE department_id=$1 AND source_system='churchtools' AND source_id<>ALL($2::text[])", [departmentId, groups.map(idOf).filter(Boolean)]);
          for (const resource of resources) {
            const sourceId = idOf(resource);
            const name = firstText(resource.name, resource.title, resource.resourceName);
            if (!sourceId || !name) continue;
            const typeName = firstText(resource.resourceType?.name, resource.type?.name, resource.type, resource.category);
            const location = firstText(resource.location?.name, resource.location, resource.place?.name, resource.place).slice(0, 160);
            const description = firstText(resource.description, resource.note, resource.information).slice(0, 1000);
            const capacityValue = Number(resource.capacity ?? resource.maxPersons ?? resource.max_persons);
            const capacity = Number.isInteger(capacityValue) && capacityValue > 0 && capacityValue <= 10000 ? capacityValue : null;
            const requiresApproval = resource.requiresApproval ?? resource.requires_approval ?? resource.approvalRequired ?? resource.mustBeConfirmed;
            const active = resource.active !== false && resource.archived !== true && resource.isArchived !== true;
            const existing = await db.query<{ id: string }>("SELECT id FROM bookable_resources WHERE department_id=$1 AND source_system='churchtools' AND source_id=$2 FOR UPDATE", [departmentId, sourceId]);
            const matching = existing.rowCount ? existing : await db.query<{ id: string }>("SELECT id FROM bookable_resources WHERE department_id=$1 AND source_system IS NULL AND lower(name)=lower($2) ORDER BY created_at LIMIT 1 FOR UPDATE", [departmentId, name]);
            const values = [departmentId, name.slice(0, 120), resourceCategory({ ...resource, category: typeName }), description, location, capacity, requiresApproval === undefined ? true : Boolean(requiresApproval), active, sourceId];
            if (matching.rowCount) await db.query("UPDATE bookable_resources SET name=$3,category=$4,description=$5,location=$6,capacity=$7,requires_approval=$8,active=$9,source_system='churchtools',source_id=$10,updated_at=now() WHERE id=$1 AND department_id=$2", [matching.rows[0].id, departmentId, ...values.slice(1)]);
            else await db.query("INSERT INTO bookable_resources (id,department_id,name,category,description,location,capacity,requires_approval,active,source_system,source_id) VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,'churchtools',$9)", values);
          }
          if (resources.length) {
            await db.query("DELETE FROM resource_bookings WHERE department_id=$1 AND resource_id IN (SELECT id FROM bookable_resources WHERE department_id=$1 AND source_system='churchtools' AND source_id<>ALL($2::text[]))", [departmentId, resources.map(idOf).filter(Boolean)]);
            await db.query("DELETE FROM bookable_resources WHERE department_id=$1 AND source_system='churchtools' AND source_id<>ALL($2::text[])", [departmentId, resources.map(idOf).filter(Boolean)]);
          }
          for (const event of services) {
            const positions = event.positions.map((item: any) => ({ name: item.name, ...(item.personId && personMap.has(item.personId) ? { contactId: personMap.get(item.personId) } : {}) }));
            const found = await db.query<{ id: string }>("SELECT id FROM service_events WHERE department_id=$1 AND source_system='churchtools' AND source_id=$2 FOR UPDATE", [departmentId, event.sourceId]);
            const data = [departmentId, event.title.slice(0, 160), event.date, event.start, event.end, event.location.slice(0, 160), event.description, event.room.slice(0, 160), JSON.stringify(positions), JSON.stringify(event.timePlan), event.sourceId];
            if (found.rowCount) {
              await db.query("UPDATE service_events SET title=$3,kind='service',event_date=$4,start_time=$5,end_time=$6,location=$7,description=$8,room=$9,positions=$10::jsonb,time_plan=$11::jsonb,updated_at=now() WHERE id=$1 AND department_id=$2", [found.rows[0].id, departmentId, ...data.slice(1, 10)]);
            } else {
              const matching = await db.query<{ id: string }>("SELECT id FROM service_events WHERE department_id=$1 AND source_system IS NULL AND lower(title)=lower($2) AND event_date=$3 AND start_time=$4 ORDER BY created_at LIMIT 1 FOR UPDATE", [departmentId, event.title.slice(0, 160), event.date, event.start]);
              if (matching.rowCount) await db.query("UPDATE service_events SET title=$3,kind='service',event_date=$4,start_time=$5,end_time=$6,location=$7,description=$8,room=$9,positions=$10::jsonb,time_plan=$11::jsonb,source_system='churchtools',source_id=$12,updated_at=now() WHERE id=$1 AND department_id=$2", [matching.rows[0].id, departmentId, ...data.slice(1)]);
              else await db.query("INSERT INTO service_events (id,department_id,title,kind,event_date,start_time,end_time,location,description,room,positions,time_plan,source_system,source_id) VALUES (gen_random_uuid(),$1,$2,'service',$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,'churchtools',$11)", data);
            }
          }
          if (services.length) await db.query("DELETE FROM service_events WHERE department_id=$1 AND source_system='churchtools' AND source_id<>ALL($2::text[])", [departmentId, services.map((event: any) => event.sourceId)]);
          await db.query("COMMIT");
        } catch (error) { await db.query("ROLLBACK"); throw error; }
        finally { db.release(); }
        await pool.query("UPDATE churchtools_sync_settings SET last_sync_at=now(),last_sync_error=NULL,people_count=$2,group_count=$3,service_count=$4,updated_at=now() WHERE department_id=$1", [departmentId, people.length, groups.length, services.length]);
        return { people: people.length, groups: groups.length, services: services.length, resources: resources.length };
      } catch (error) {
        await statusError(departmentId, error instanceof Error ? error.message : "Sync failed.");
        throw error;
      } finally { running.delete(departmentId); }
    }

    routes.get("/api/modules/sync/churchtools", async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      const result = await pool!.query("SELECT s.instance_url,s.enabled,s.last_sync_at,s.last_sync_error,(SELECT count(*)::int FROM contacts c WHERE c.department_id=s.department_id AND c.source_system='churchtools') AS people_count,(SELECT count(*)::int FROM church_groups g WHERE g.department_id=s.department_id AND g.source_system='churchtools') AS group_count,(SELECT count(*)::int FROM service_events e WHERE e.department_id=s.department_id AND e.source_system='churchtools') AS service_count,(SELECT count(*)::int FROM bookable_resources r WHERE r.department_id=s.department_id AND r.source_system='churchtools') AS resource_count FROM churchtools_sync_settings s WHERE s.department_id=$1", [dept]);
      const row = result.rows[0];
      return row ? { configured: true, instanceUrl: row.instance_url, enabled: row.enabled, lastSyncAt: row.last_sync_at, lastSyncError: row.last_sync_error, peopleCount: row.people_count, groupCount: row.group_count, serviceCount: row.service_count, resourceCount: row.resource_count } : { configured: false, enabled: false, peopleCount: 0, groupCount: 0, serviceCount: 0, resourceCount: 0 };
    });
    routes.put<{ Body: { instanceUrl: string; loginToken?: string } }>("/api/modules/sync/churchtools", { schema: { body: { type: "object", additionalProperties: false, required: ["instanceUrl"], properties: { instanceUrl: { type: "string", minLength: 10, maxLength: 255 }, loginToken: { type: "string", maxLength: 2048 } } } } }, async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      let base: string; try { base = normalizeUrl(request.body.instanceUrl); } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Invalid URL." }); }
      const old = await settings(dept);
      let token = request.body.loginToken?.trim();
      if (!token && old) try { token = decrypt(old.encrypted_login_token); } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Re-enter the token." }); }
      try { await testLogin(base, token ?? ""); } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "ChurchTools connection failed." }); }
      let encrypted: string; try { encrypted = encrypt(token!); } catch (error) { return reply.code(503).send({ error: error instanceof Error ? error.message : "Token encryption is unavailable." }); }
      await pool!.query("INSERT INTO churchtools_sync_settings (department_id,instance_url,encrypted_login_token,enabled) VALUES ($1,$2,$3,true) ON CONFLICT (department_id) DO UPDATE SET instance_url=EXCLUDED.instance_url,encrypted_login_token=EXCLUDED.encrypted_login_token,enabled=true,last_sync_error=NULL,updated_at=now()", [dept, base, encrypted]);
      return { saved: true, instanceUrl: base };
    });
    routes.post("/api/modules/sync/churchtools/run", async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      try { return await run(dept); } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Sync failed." }); }
    });
    routes.patch<{ Body: { enabled: boolean } }>("/api/modules/sync/churchtools", { schema: { body: { type: "object", additionalProperties: false, required: ["enabled"], properties: { enabled: { type: "boolean" } } } } }, async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      const result = await pool!.query("UPDATE churchtools_sync_settings SET enabled=$2,updated_at=now() WHERE department_id=$1 RETURNING enabled", [dept, request.body.enabled]);
      if (!result.rowCount) return reply.code(404).send({ error: "Configure ChurchTools first." });
      return { enabled: result.rows[0].enabled };
    });
    routes.delete("/api/modules/sync/churchtools", async (request, reply) => {
      const dept = await department(request, reply, true); if (!dept) return reply;
      if (running.has(dept)) return reply.code(409).send({ error: "Wait for sync to finish before removing imported data." });
      const db = await pool!.connect();
      try {
        await db.query("BEGIN");
        await db.query("DELETE FROM service_events WHERE department_id=$1 AND source_system='churchtools'", [dept]);
        await db.query("DELETE FROM church_groups WHERE department_id=$1 AND source_system='churchtools'", [dept]);
        await db.query("DELETE FROM resource_bookings WHERE department_id=$1 AND resource_id IN (SELECT id FROM bookable_resources WHERE department_id=$1 AND source_system='churchtools')", [dept]);
        await db.query("DELETE FROM bookable_resources WHERE department_id=$1 AND source_system='churchtools'", [dept]);
        await db.query("DELETE FROM contacts WHERE department_id=$1 AND source_system='churchtools'", [dept]);
        await db.query("DELETE FROM churchtools_sync_settings WHERE department_id=$1", [dept]);
        await db.query("COMMIT");
        return { deleted: true };
      } catch (error) { await db.query("ROLLBACK"); throw error; }
      finally { db.release(); }
    });
    const timer = setInterval(() => {
      if (!pool || !isDatabaseReady()) return;
      void pool.query("SELECT department_id FROM churchtools_sync_settings WHERE enabled=true").then(async (result) => {
        for (const row of result.rows) try { await run(row.department_id); } catch { /* Errors are recorded for the sync status page. */ }
      }).catch(() => {});
    }, syncIntervalMs);
    timer.unref();
    routes.addHook("onClose", async () => clearInterval(timer));
  });
}
