import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ModuleServerContext } from "../module-sdk.js";

type SearchResult = { id: string; type: "person" | "group" | "wiki" | "song"; title: string; detail?: string };
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
    const isIdQuery = rawQuery.startsWith("#");
    const id = isIdQuery ? rawQuery.slice(1).trim() : "";
    const searchText = rawQuery.replace(/[\\%_]/g, "").trim().slice(0, 100);
    const validIdQuery = isIdQuery && id.length > 0 && id.length <= 100 && !/[\u0000-\u001f\u007f]/.test(id);
    const localUuidQuery = validIdQuery && uuidPattern.test(id);
    if ((!isIdQuery && searchText.length < 2) || (isIdQuery && !validIdQuery)) {
      return { isIdQuery, canSearchPeople: canSearchPeople(request), categories: { people: [], groups: [], wiki: [], songs: [] } };
    }
    const pattern = `%${searchText}%`;
    const values = localUuidQuery ? [departmentId, id] : [departmentId, pattern];
    const canViewPrivatePeople = canSearchPeople(request);
    const wikiManager = canManageWiki(request);

    const optional = await pool.query<{
      wikiEnabled: boolean;
      wikiReady: boolean;
      songsReady: boolean;
      contactSourceReady: boolean;
      groupSourceReady: boolean;
      migrationLinksReady: boolean;
    }>(
      `SELECT COALESCE($2::text = ANY(location.enabled_modules),false) AS "wikiEnabled",
              to_regclass('public.wiki_pages') IS NOT NULL AND to_regclass('public.wiki_categories') IS NOT NULL AS "wikiReady",
              to_regclass('public.worship_songs') IS NOT NULL AS "songsReady",
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
      [departmentId, "wiki"],
    );
    const state = optional.rows[0] ?? { wikiEnabled: false, wikiReady: false, songsReady: false, contactSourceReady: false, groupSourceReady: false, migrationLinksReady: false };
    const wikiAudienceCondition = `($3::boolean OR page.audience='location' OR (page.audience='group' AND EXISTS (
      SELECT 1 FROM group_members audience_member
      JOIN department_memberships audience_user ON audience_user.contact_id=audience_member.contact_id AND audience_user.department_id=page.department_id
      WHERE audience_member.group_id=page.audience_group_id AND audience_member.status='active' AND audience_user.user_id=$4
    )))`;

    const [peopleRows, groupRows, wikiRows, songRows] = await Promise.all([
      canViewPrivatePeople ? pool.query<{ id: string; title: string }>(
        localUuidQuery
          ? `SELECT id,concat_ws(' ',first_name,last_name) AS title FROM contacts WHERE department_id=$1 AND id=$2`
          : validIdQuery
            ? externalPersonLookupSql(state.contactSourceReady, state.migrationLinksReady)
            : `SELECT id,concat_ws(' ',first_name,last_name) AS title FROM contacts WHERE department_id=$1 AND concat_ws(' ',first_name,last_name) ILIKE $2 ORDER BY lower(last_name),lower(first_name),id LIMIT 6`,
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
      state.songsReady && (!validIdQuery || localUuidQuery) ? pool.query<{ id: string; title: string; detail: string | null }>(
        localUuidQuery
          ? `SELECT id,title,authors AS detail FROM worship_songs WHERE department_id=$1 AND id=$2 AND active=true`
          : `SELECT id,title,authors AS detail FROM worship_songs WHERE department_id=$1 AND title ILIKE $2 AND active=true ORDER BY lower(title),id LIMIT 6`,
        values,
      ).then((result) => result.rows) : Promise.resolve([]),
    ]);

    const categories = {
      people: peopleRows.map((row): SearchResult => ({ id: row.id, type: "person", title: row.title })),
      groups: groupRows.map((row): SearchResult => ({ id: row.id, type: "group", title: row.title, ...(row.detail ? { detail: row.detail } : {}) })),
      wiki: wikiRows.map((row): SearchResult => ({ id: row.id, type: "wiki", title: row.title, ...(row.detail ? { detail: row.detail } : {}) })),
      songs: songRows.map((row): SearchResult => ({ id: row.id, type: "song", title: row.title, ...(row.detail ? { detail: row.detail } : {}) })),
    };
    return { isIdQuery, canSearchPeople: canViewPrivatePeople, categories };
  });
}

function externalPersonLookupSql(sourceColumnsReady: boolean, migrationLinksReady: boolean) {
  const selectors: string[] = [];
  if (sourceColumnsReady) selectors.push(`SELECT contact.id,concat_ws(' ',contact.first_name,contact.last_name) AS title
    FROM contacts contact WHERE contact.department_id=$1 AND contact.source_system='churchtools' AND contact.source_id=$2`);
  if (migrationLinksReady) selectors.push(`SELECT contact.id,concat_ws(' ',contact.first_name,contact.last_name) AS title
    FROM churchtools_migration_links link JOIN contacts contact
      ON contact.id=link.local_record_id AND contact.department_id=link.department_id
    WHERE link.department_id=$1 AND link.area='person' AND link.source_id=$2`);
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
