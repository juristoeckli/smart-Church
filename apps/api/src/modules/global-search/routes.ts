import { personTagMatch } from "../people-records/tag-search.js";
import { canManagePeopleFields } from "../people-records/field-privacy.js";
import { isResourceBookingManager } from "../../resource-booking-policy.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { isServerModuleEnabled, type ModuleServerContext } from "../module-sdk.js";

type SearchResult = { id: string; type: "person" | "group" | "wiki" | "song" | "event" | "resource" | "booking"; title: string; detail?: string };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function canSearchPeople(request: FastifyRequest) {
  return request.activeDepartmentRole === "site_admin"
    || (request.activeDepartmentPermissions ?? []).some((permission) => permission === "people_view_private" || permission === "people_manage");
}

function canManageWiki(request: FastifyRequest) {
  return request.activeDepartmentRole === "site_admin" || (request.activeDepartmentModulePermissions?.wiki ?? []).includes("manage");
}

export function registerModuleRoutes(app: FastifyInstance, context: ModuleServerContext) {
  const { pool, isDatabaseReady, resolveDepartmentId } = context;

  app.get<{ Querystring: { q?: string } }>("/api/modules/global-search", {
    schema: { querystring: { type: "object", additionalProperties: false, required: ["q"], properties: { q: { type: "string", minLength: 1, maxLength: 100 } } } },
  }, async (request, reply) => {
    if (!pool || !isDatabaseReady()) return reply.code(503).send({ error: "Search is unavailable because the database is not ready." });
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const rawQuery = request.query.q?.trim() ?? "";
    const emptyCategories = { people: [], groups: [], wiki: [], songs: [], events: [], resources: [], bookings: [] };
    if (/^tag:/i.test(rawQuery)) {
      reply.header("cache-control", "private, no-store");
      const tag = rawQuery.slice(4).trim();
      const empty = { isIdQuery: false, canSearchPeople: false, categories: emptyCategories };
      if (!tag || /[\u0000-\u001f\u007f]/.test(tag) || !canSearchPeople(request) || !isServerModuleEnabled("people-records")) return empty;
      const available = await pool.query<{ ready: boolean }>(
        `SELECT 'people-records'=ANY(enabled_modules)
             AND to_regclass('public.people_record_values') IS NOT NULL
             AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='people_record_fields' AND column_name='visibility') AS ready
           FROM departments WHERE id=$1`, [departmentId],
      );
      if (!available.rows[0]?.ready) return empty;
      const people = await pool.query<{ id: string; title: string }>(
        `SELECT c.id,concat_ws(' ',c.first_name,c.last_name) AS title FROM contacts c
          WHERE c.department_id=$1 AND c.archived_at IS NULL AND ${personTagMatch("$2", "$3")}
          ORDER BY lower(c.last_name),lower(c.first_name),c.id LIMIT 6`,
        [departmentId, tag, canManagePeopleFields(request)],
      );
      return { isIdQuery: false, canSearchPeople: true, categories: {
        ...emptyCategories, people: people.rows.map((row): SearchResult => ({ ...row, type: "person" })),
      } };
    }
    const isIdQuery = rawQuery.startsWith("#");
    const id = isIdQuery ? rawQuery.slice(1).trim() : "";
    const searchText = rawQuery.replace(/[\\%_]/g, "").trim().slice(0, 100);
    const validIdQuery = isIdQuery && id.length > 0 && id.length <= 100 && !/[\u0000-\u001f\u007f]/.test(id);
    const localUuidQuery = validIdQuery && uuidPattern.test(id);
    if ((!isIdQuery && searchText.length < 2) || (isIdQuery && !validIdQuery)) {
      return { isIdQuery, canSearchPeople: canSearchPeople(request), categories: emptyCategories };
    }
    const pattern = `%${searchText}%`;
    const values = localUuidQuery ? [departmentId, id] : [departmentId, pattern];
    const canViewPrivatePeople = canSearchPeople(request);
    const wikiManager = canManageWiki(request);

    const optional = await pool.query<{
      wikiEnabled: boolean;
      wikiReady: boolean;
      songsReady: boolean;
      communityEnabled: boolean;
      contactSourceReady: boolean;
      groupSourceReady: boolean;
      migrationLinksReady: boolean;
    }>(
      `SELECT COALESCE($2::text = ANY(location.enabled_modules),false) AS "wikiEnabled",
              to_regclass('public.wiki_pages') IS NOT NULL AND to_regclass('public.wiki_categories') IS NOT NULL AS "wikiReady",
              to_regclass('public.worship_songs') IS NOT NULL AS "songsReady",
              $3::text = ANY(location.enabled_modules) AS "communityEnabled",
              EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contacts' AND column_name='source_system')
                AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contacts' AND column_name='source_id') AS "contactSourceReady",
              EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='church_groups' AND column_name='source_system')
                AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='church_groups' AND column_name='source_id') AS "groupSourceReady",
              to_regclass('public.churchtools_migration_links') IS NOT NULL
                AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='churchtools_migration_links' AND column_name='department_id')
                AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='churchtools_migration_links' AND column_name='area')
                AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='churchtools_migration_links' AND column_name='source_id')
                AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='churchtools_migration_links' AND column_name='local_record_id') AS "migrationLinksReady"
         FROM departments location WHERE location.id=$1`,
      [departmentId, "wiki", "community"],
    );
    const state = optional.rows[0] ?? { wikiEnabled: false, wikiReady: false, songsReady: false, communityEnabled: false, contactSourceReady: false, groupSourceReady: false, migrationLinksReady: false };
    const wikiAudienceCondition = `($3::boolean OR page.audience='location' OR (page.audience='group' AND EXISTS (
      SELECT 1 FROM group_members audience_member
      JOIN department_memberships audience_user ON audience_user.contact_id=audience_member.contact_id AND audience_user.department_id=page.department_id
      WHERE audience_member.group_id=page.audience_group_id AND audience_member.status='active' AND audience_user.user_id=$4
    )))`;

    const [peopleRows, groupRows, wikiRows, songRows, eventRows, resourceRows, bookingRows] = await Promise.all([
      canViewPrivatePeople ? pool.query<{ id: string; title: string }>(
        localUuidQuery
          ? `SELECT id,concat_ws(' ',first_name,last_name) AS title FROM contacts WHERE department_id=$1 AND archived_at IS NULL AND id=$2`
          : validIdQuery
            ? externalPersonLookupSql(state.contactSourceReady, state.migrationLinksReady)
            : `SELECT id,concat_ws(' ',first_name,last_name) AS title FROM contacts WHERE department_id=$1 AND archived_at IS NULL AND concat_ws(' ',first_name,last_name) ILIKE $2 ORDER BY lower(last_name),lower(first_name),id LIMIT 6`,
        localUuidQuery || !validIdQuery ? values : [departmentId, id],
      ).then((result) => result.rows) : Promise.resolve([]),
      pool.query<{ id: string; title: string; detail: string }>(
        localUuidQuery
          ? `SELECT id,name AS title,COALESCE(to_jsonb(group_row)->>'group_type','') AS detail FROM church_groups group_row WHERE department_id=$1 AND status='active' AND id=$2`
          : validIdQuery
            ? externalGroupLookupSql(state.groupSourceReady, state.migrationLinksReady)
            : `SELECT id,name AS title,COALESCE(to_jsonb(group_row)->>'group_type','') AS detail FROM church_groups group_row WHERE department_id=$1 AND status='active' AND name ILIKE $2 ORDER BY lower(name),id LIMIT 6`,
        localUuidQuery || !validIdQuery ? values : [departmentId, id],
      ).then((result) => result.rows),
      state.wikiEnabled && state.wikiReady && (!validIdQuery || localUuidQuery) ? pool.query<{ id: string; title: string; detail: string }>(
        localUuidQuery
          ? `SELECT page.id,page.title,COALESCE(category.name,'') AS detail FROM wiki_pages page LEFT JOIN wiki_categories category ON category.id=page.category_id AND category.department_id=page.department_id WHERE page.department_id=$1 AND page.id=$2 AND page.status='active' AND ${wikiAudienceCondition}`
          : `SELECT page.id,page.title,COALESCE(category.name,'') AS detail FROM wiki_pages page LEFT JOIN wiki_categories category ON category.id=page.category_id AND category.department_id=page.department_id WHERE page.department_id=$1 AND page.title ILIKE $2 AND page.status='active' AND ${wikiAudienceCondition} ORDER BY lower(page.title),page.id LIMIT 6`,
        [...values, wikiManager, request.authenticatedUser!.id],
      ).then((result) => result.rows) : Promise.resolve([]),
      state.songsReady && (!validIdQuery || localUuidQuery || state.migrationLinksReady) ? pool.query<{ id: string; title: string; detail: string | null }>(
        localUuidQuery
          ? `SELECT id,title,authors AS detail FROM worship_songs WHERE department_id=$1 AND id=$2 AND active=true`
          : validIdQuery
            ? `SELECT song.id,song.title,song.authors AS detail
                 FROM churchtools_migration_links link
                 JOIN worship_songs song ON song.id=link.local_record_id AND song.department_id=link.department_id
                WHERE link.department_id=$1 AND link.area='song' AND split_part(link.source_id,'#',2)=$2 AND song.active=true
                ORDER BY lower(song.title),song.id LIMIT 6`
            : `SELECT id,title,authors AS detail FROM worship_songs WHERE department_id=$1 AND title ILIKE $2 AND active=true ORDER BY lower(title),id LIMIT 6`,
        localUuidQuery || !validIdQuery ? values : [departmentId, id],
      ).then((result) => result.rows) : Promise.resolve([]),
      localUuidQuery || !validIdQuery || state.migrationLinksReady ? pool.query<{ id: string; title: string; detail: string }>(
        localUuidQuery
          ? `SELECT id,title,concat(to_char(event_date,'YYYY-MM-DD'),' · ',kind,' · ',location) AS detail FROM service_events WHERE department_id=$1 AND id=$2`
          : validIdQuery
            ? `SELECT event.id,event.title,concat(to_char(event.event_date,'YYYY-MM-DD'),' · ',event.kind,' · ',event.location) AS detail
                 FROM churchtools_migration_links link JOIN service_events event ON event.id=link.local_record_id AND event.department_id=link.department_id
                WHERE link.department_id=$1 AND link.area='event' AND link.source_id=$2 LIMIT 6`
            : `SELECT id,title,concat(to_char(event_date,'YYYY-MM-DD'),' · ',kind,' · ',location) AS detail FROM service_events WHERE department_id=$1 AND (title ILIKE $2 OR location ILIKE $2) ORDER BY event_date DESC,title,id LIMIT 6`,
        localUuidQuery || !validIdQuery ? values : [departmentId, id],
      ).then((result) => result.rows) : Promise.resolve([]),
      state.communityEnabled && (localUuidQuery || !validIdQuery || state.migrationLinksReady) ? pool.query<{ id: string; title: string; detail: string }>(
        localUuidQuery
          ? `SELECT id,name AS title,concat(category,' · ',nullif(location,'')) AS detail FROM bookable_resources WHERE department_id=$1 AND id=$2 AND (active=true OR $3::boolean) AND can_view_bookable_resource(department_id,visibility_group_id,$4,$3)`
          : validIdQuery
            ? `SELECT resource.id,resource.name AS title,concat(resource.category,' · ',nullif(resource.location,'')) AS detail
                 FROM churchtools_migration_links link JOIN bookable_resources resource ON resource.id=link.local_record_id AND resource.department_id=link.department_id
                WHERE link.department_id=$1 AND link.area='resource' AND link.source_id=$2 AND (resource.active=true OR $3::boolean) AND can_view_bookable_resource(resource.department_id,resource.visibility_group_id,$4,$3) LIMIT 6`
            : `SELECT id,name AS title,concat(category,' · ',nullif(location,'')) AS detail FROM bookable_resources WHERE department_id=$1 AND name ILIKE $2 AND (active=true OR $3::boolean) AND can_view_bookable_resource(department_id,visibility_group_id,$4,$3) ORDER BY lower(name),id LIMIT 6`,
        localUuidQuery || !validIdQuery ? [...values, isResourceBookingManager(request, isServerModuleEnabled("resource-scheduler")), request.authenticatedUser!.id] : [departmentId, id, isResourceBookingManager(request, isServerModuleEnabled("resource-scheduler")), request.authenticatedUser!.id],
      ).then((result) => result.rows) : Promise.resolve([]),
      state.communityEnabled ? pool.query<{ id: string; title: string; detail: string }>(
        localUuidQuery
          ? `SELECT booking.id,booking.purpose AS title,concat(resource.name,' · ',to_char(booking.starts_at,'YYYY-MM-DD HH24:MI'),' · ',booking.status) AS detail FROM resource_bookings booking JOIN bookable_resources resource ON resource.id=booking.resource_id AND resource.department_id=booking.department_id WHERE booking.department_id=$1 AND booking.id=$2 AND booking.ends_at>now()-interval '30 days' AND booking.starts_at<now()+interval '6 months' AND (resource.active=true OR $3::boolean) AND (booking.requested_by=$4 OR can_view_bookable_resource(resource.department_id,resource.visibility_group_id,$4,$3))`
          : validIdQuery
            ? `SELECT booking.id,booking.purpose AS title,concat(resource.name,' · ',to_char(booking.starts_at,'YYYY-MM-DD HH24:MI'),' · ',booking.status) AS detail FROM resource_bookings booking JOIN bookable_resources resource ON resource.id=booking.resource_id AND resource.department_id=booking.department_id WHERE booking.department_id=$1 AND false`
            : `SELECT booking.id,booking.purpose AS title,concat(resource.name,' · ',to_char(booking.starts_at,'YYYY-MM-DD HH24:MI'),' · ',booking.status) AS detail FROM resource_bookings booking JOIN bookable_resources resource ON resource.id=booking.resource_id AND resource.department_id=booking.department_id WHERE booking.department_id=$1 AND (booking.purpose ILIKE $2 OR resource.name ILIKE $2) AND booking.ends_at>now()-interval '30 days' AND booking.starts_at<now()+interval '6 months' AND (resource.active=true OR $3::boolean) AND (booking.requested_by=$4 OR can_view_bookable_resource(resource.department_id,resource.visibility_group_id,$4,$3)) ORDER BY booking.starts_at,resource.name LIMIT 6`,
        validIdQuery && !localUuidQuery ? [departmentId] : localUuidQuery ? [...values, isResourceBookingManager(request, isServerModuleEnabled("resource-scheduler")), request.authenticatedUser!.id] : [...values, isResourceBookingManager(request, isServerModuleEnabled("resource-scheduler")), request.authenticatedUser!.id],
      ).then((result) => result.rows) : Promise.resolve([]),
    ]);

    const categories = {
      people: peopleRows.map((row): SearchResult => ({ id: row.id, type: "person", title: row.title })),
      groups: groupRows.map((row): SearchResult => ({ id: row.id, type: "group", title: row.title, ...(row.detail ? { detail: row.detail } : {}) })),
      wiki: wikiRows.map((row): SearchResult => ({ id: row.id, type: "wiki", title: row.title, ...(row.detail ? { detail: row.detail } : {}) })),
      songs: songRows.map((row): SearchResult => ({ id: row.id, type: "song", title: row.title, ...(row.detail ? { detail: row.detail } : {}) })),
      events: eventRows.map((row): SearchResult => ({ id: row.id, type: "event", title: row.title, detail: row.detail })),
      resources: resourceRows.map((row): SearchResult => ({ id: row.id, type: "resource", title: row.title, detail: row.detail })),
      bookings: bookingRows.map((row): SearchResult => ({ id: row.id, type: "booking", title: row.title, detail: row.detail })),
    };
    return { isIdQuery, canSearchPeople: canViewPrivatePeople, categories };
  });
}

function externalPersonLookupSql(sourceColumnsReady: boolean, migrationLinksReady: boolean) {
  const selectors: string[] = [];
  if (sourceColumnsReady) selectors.push(`SELECT contact.id,concat_ws(' ',contact.first_name,contact.last_name) AS title
    FROM contacts contact WHERE contact.department_id=$1 AND contact.archived_at IS NULL AND contact.source_system='churchtools' AND contact.source_id=$2`);
  if (migrationLinksReady) selectors.push(`SELECT contact.id,concat_ws(' ',contact.first_name,contact.last_name) AS title
    FROM churchtools_migration_links link JOIN contacts contact
      ON contact.id=link.local_record_id AND contact.department_id=link.department_id
    WHERE link.department_id=$1 AND link.area='person' AND contact.archived_at IS NULL AND link.source_id=$2`);
  return selectors.length
    ? `SELECT DISTINCT id,title FROM (${selectors.join(" UNION ALL ")}) imported_person LIMIT 6`
    : `SELECT id,concat_ws(' ',first_name,last_name) AS title FROM contacts WHERE department_id=$1 AND $2::text IS NOT NULL AND false`;
}

function externalGroupLookupSql(sourceColumnsReady: boolean, migrationLinksReady: boolean) {
  const selectors: string[] = [];
  if (sourceColumnsReady) selectors.push(`SELECT group_row.id,group_row.name AS title,COALESCE(to_jsonb(group_row)->>'group_type','') AS detail
    FROM church_groups group_row WHERE group_row.department_id=$1 AND group_row.status='active'
      AND group_row.source_system='churchtools' AND group_row.source_id=$2`);
  if (migrationLinksReady) selectors.push(`SELECT group_row.id,group_row.name AS title,COALESCE(to_jsonb(group_row)->>'group_type','') AS detail
    FROM churchtools_migration_links link JOIN church_groups group_row
      ON group_row.id=link.local_record_id AND group_row.department_id=link.department_id
    WHERE link.department_id=$1 AND link.area='group' AND link.source_id=$2 AND group_row.status='active'`);
  return selectors.length
    ? `SELECT DISTINCT id,title,detail FROM (${selectors.join(" UNION ALL ")}) imported_group LIMIT 6`
    : `SELECT id,name AS title,COALESCE(to_jsonb(group_row)->>'group_type','') AS detail FROM church_groups group_row WHERE department_id=$1 AND $2::text IS NOT NULL AND false`;
}
