import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ModuleServerContext } from "../module-sdk.js";

type WikiAudience = "location" | "group" | "managers";
type WikiPageRow = { id: string; category_id: string; title: string; content_html: string; status: "active" | "archived"; redirect_url: string | null; is_homepage: boolean; audience?: WikiAudience; audience_group_id?: string | null; created_at: Date | string; updated_at: Date | string; updated_by: string | null; editor_name?: string | null };
type WikiCategoryRow = { id: string; name: string; parent_id: string | null; position: number; archived_at: Date | string | null; created_at: Date | string; updated_at: Date | string };
const allowedTags = new Set(["a", "b", "blockquote", "br", "code", "del", "div", "em", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "li", "ol", "p", "pre", "s", "span", "strong", "table", "tbody", "td", "th", "thead", "tr", "u", "ul"]);

function safeHtml(value: string): string {
  let html = value.slice(0, 500_000)
    .replace(/<(script|style|iframe|object|embed|svg|math|form|input|button|textarea|select|option|meta|link)[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(script|style|iframe|object|embed|svg|math|form|input|button|textarea|select|option|meta|link)\b[^>]*\/?\s*>/gi, "");
  html = html.replace(/<\/?([a-z0-9-]+)([^>]*)>/gi, (whole, rawTag: string, attributes: string) => {
    const tag = rawTag.toLowerCase();
    if (!allowedTags.has(tag)) return "";
    if (whole.startsWith("</")) return `</${tag}>`;
    if (tag === "br" || tag === "hr") return `<${tag}>`;
    if (tag !== "a" && tag !== "span") return `<${tag}>`;
    const hrefMatch = tag === "a" ? attributes.match(/\bhref\s*=\s*(["'])(.*?)\1/i) : null;
    const href = hrefMatch?.[2]?.trim() ?? "";
    const safeHref = /^(https?:\/\/|mailto:|\/|#)/i.test(href) && !/^\/\//.test(href) ? href.replace(/["<>\u0000-\u001f]/g, "") : "";
    const entityType = attributes.match(/\bdata-entity-type\s*=\s*(["'])(person|group|wiki|song)\1/i)?.[2]?.toLowerCase();
    const entityId = attributes.match(/\bdata-entity-id\s*=\s*(["'])([a-z0-9-]{1,80})\1/i)?.[2];
    const safeEntity = entityType && entityId ? ` data-entity-type="${entityType}" data-entity-id="${entityId}"` : "";
    return tag === "a" ? `<a${safeHref ? ` href="${safeHref.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}" rel="noopener noreferrer" target="_blank"` : ""}${safeEntity}>` : `<span${safeEntity}>`;
  });
  return html;
}

function pageDto(row: WikiPageRow) {
  return { id: row.id, categoryId: row.category_id, title: row.title, contentHtml: row.content_html, status: row.status, redirectUrl: row.redirect_url, isHomepage: row.is_homepage, audience: row.audience ?? "location", audienceGroupId: row.audience_group_id ?? null, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(), updatedBy: row.updated_by, editorName: row.editor_name ?? null };
}
function categoryDto(row: WikiCategoryRow) {
  return { id: row.id, name: row.name, parentId: row.parent_id, position: row.position, archivedAt: row.archived_at ? new Date(row.archived_at).toISOString() : null, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() };
}

export function registerModuleRoutes(app: FastifyInstance, context: ModuleServerContext) {
  const { pool, isDatabaseReady, resolveDepartmentId, validateMutation } = context;
  async function site(request: FastifyRequest, reply: FastifyReply, manage = false) {
    if (!pool || !isDatabaseReady()) { reply.code(503).send({ error: "The Wiki database is unavailable." }); return null; }
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return null;
    const enabled = await pool.query<{ enabled_modules: string[] }>("SELECT enabled_modules FROM departments WHERE id=$1", [departmentId]);
    if (!(enabled.rows[0]?.enabled_modules ?? []).includes("wiki")) { reply.code(404).send({ error: "Wiki is not enabled for this site." }); return null; }
    const canManage = isWikiManager(request);
    if (manage && !canManage) { reply.code(403).send({ error: "Wiki management access is required." }); return null; }
    return departmentId;
  }
  function isWikiManager(request: FastifyRequest) {
    return request.activeDepartmentRole === "site_admin" || (request.activeDepartmentModulePermissions?.wiki ?? []).includes("manage");
  }
  const pageReadCondition = (pageAlias: string, managerParam: number, userParam: number) => `($${managerParam}::boolean OR ${pageAlias}.audience='location' OR (${pageAlias}.audience='group' AND EXISTS (
    SELECT 1 FROM group_members audience_member
    JOIN department_memberships audience_user ON audience_user.contact_id=audience_member.contact_id AND audience_user.department_id=$1
    WHERE audience_member.group_id=${pageAlias}.audience_group_id AND audience_member.status='active' AND audience_user.user_id=$${userParam}
  )))`;
  async function canReadPage(request: FastifyRequest, departmentId: string, pageId: string) {
    if (isWikiManager(request)) {
      const page = await pool!.query("SELECT 1 FROM wiki_pages WHERE id=$1 AND department_id=$2", [pageId, departmentId]);
      return Boolean(page.rowCount);
    }
    const result = await pool!.query<{ allowed: boolean }>(
      `SELECT ${pageReadCondition("page", 3, 4)} AS allowed FROM wiki_pages page WHERE page.id=$2 AND page.department_id=$1 AND page.status='active'`,
      [departmentId, pageId, false, request.authenticatedUser!.id],
    );
    return Boolean(result.rows[0]?.allowed);
  }
  async function hideUnreadableWikiEntityLinks(html: string, request: FastifyRequest, departmentId: string) {
    if (isWikiManager(request)) return html;
    const matches = [...html.matchAll(/<(a|span)\b([^>]*\bdata-entity-type="wiki"[^>]*)>([\s\S]*?)<\/\1>/gi)];
    const ids = [...new Set(matches.map((match) => (match[2] ?? "").match(/\bdata-entity-id="([a-z0-9-]{1,80})"/i)?.[1]).filter((id): id is string => Boolean(id)))];
    const allowedIds = new Set<string>();
    for (const id of ids) if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) && await canReadPage(request, departmentId, id)) allowedIds.add(id);
    return html.replace(/<(a|span)\b([^>]*\bdata-entity-type="wiki"[^>]*)>([\s\S]*?)<\/\1>/gi, (full, _tag: string, attrs: string) => {
      const id = attrs.match(/\bdata-entity-id="([a-z0-9-]{1,80})"/i)?.[1];
      return id && allowedIds.has(id) ? full : "<span>Restricted Wiki page</span>";
    });
  }
  async function canFollowWikiLink(value: string, request: FastifyRequest, departmentId: string) {
    const id = value.match(/^(?:#wiki:|#entity:wiki:|\/wiki\/)([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i)?.[1];
    return !id || await canReadPage(request, departmentId, id);
  }
  const changed = (departmentId: string, payload: object) => context.realtime.publish("module:wiki:changed", departmentId, payload);

  app.get("/api/modules/wiki/groups", async (request, reply) => {
    const departmentId = await site(request, reply, true);
    if (!departmentId) return reply;
    return (await pool!.query("SELECT id,name FROM church_groups WHERE department_id=$1 AND status='active' ORDER BY name LIMIT 1000", [departmentId])).rows;
  });

  app.get<{ Querystring: { search?: string; categoryId?: string; status?: string } }>("/api/modules/wiki/categories", async (request, reply) => {
    const departmentId = await site(request, reply);
    if (!departmentId) return reply;
    const archived = request.query.status === "archived";
    const result = await pool!.query<WikiCategoryRow>(`SELECT id,name,parent_id,position,archived_at,created_at,updated_at FROM wiki_categories WHERE department_id=$1 AND ${archived ? "archived_at IS NOT NULL" : "archived_at IS NULL"} ORDER BY position,lower(name),created_at`, [departmentId]);
    return result.rows.map(categoryDto);
  });

  app.post<{ Body: { name: string; parentId?: string | null } }>("/api/modules/wiki/categories", { schema: { body: { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string", minLength: 1, maxLength: 120 }, parentId: { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] } } } } }, async (request, reply) => {
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await site(request, reply, true);
    if (!departmentId) return reply;
    const name = request.body.name.trim();
    if (!name) return reply.code(400).send({ error: "Category name is required." });
    const parentId = request.body.parentId ?? null;
    if (parentId) {
      const parent = await pool!.query("SELECT id FROM wiki_categories WHERE id=$1 AND department_id=$2 AND archived_at IS NULL", [parentId, departmentId]);
      if (!parent.rowCount) return reply.code(404).send({ error: "Parent category not found." });
    }
    const result = await pool!.query<WikiCategoryRow>("INSERT INTO wiki_categories(id,department_id,name,parent_id,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$5) RETURNING id,name,parent_id,position,archived_at,created_at,updated_at", [randomUUID(), departmentId, name, parentId, request.authenticatedUser!.id]);
    changed(departmentId, { action: "category-created", categoryId: result.rows[0].id });
    return reply.code(201).send(categoryDto(result.rows[0]));
  });

  app.put<{ Params: { id: string }; Body: { name: string; parentId?: string | null; position?: number } }>("/api/modules/wiki/categories/:id", async (request, reply) => {
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await site(request, reply, true);
    if (!departmentId) return reply;
    const name = request.body.name.trim();
    if (!name) return reply.code(400).send({ error: "Category name is required." });
    const parentId = request.body.parentId ?? null;
    if (parentId === request.params.id) return reply.code(400).send({ error: "A category cannot be its own parent." });
    if (parentId) {
      const parent = await pool!.query("SELECT id FROM wiki_categories WHERE id=$1 AND department_id=$2 AND archived_at IS NULL", [parentId, departmentId]);
      if (!parent.rowCount) return reply.code(404).send({ error: "Parent category not found." });
      const cycle = await pool!.query("WITH RECURSIVE descendants(id) AS (SELECT id FROM wiki_categories WHERE parent_id=$1 AND department_id=$2 UNION ALL SELECT child.id FROM wiki_categories child JOIN descendants parent ON child.parent_id=parent.id WHERE child.department_id=$2) SELECT 1 FROM descendants WHERE id=$3 LIMIT 1", [request.params.id, departmentId, parentId]);
      if (cycle.rowCount) return reply.code(400).send({ error: "A category cannot be moved under one of its descendants." });
    }
    const result = await pool!.query<WikiCategoryRow>("UPDATE wiki_categories SET name=$3,parent_id=$4,position=$5,updated_by=$6,updated_at=now() WHERE id=$1 AND department_id=$2 AND archived_at IS NULL RETURNING id,name,parent_id,position,archived_at,created_at,updated_at", [request.params.id, departmentId, name, parentId, request.body.position ?? 0, request.authenticatedUser!.id]);
    if (!result.rowCount) return reply.code(404).send({ error: "Category not found." });
    changed(departmentId, { action: "category-updated", categoryId: request.params.id });
    return categoryDto(result.rows[0]);
  });

  app.delete<{ Params: { id: string } }>("/api/modules/wiki/categories/:id", async (request, reply) => {
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await site(request, reply, true);
    if (!departmentId) return reply;
    const children = await pool!.query("SELECT 1 FROM wiki_categories WHERE parent_id=$1 AND department_id=$2 AND archived_at IS NULL UNION ALL SELECT 1 FROM wiki_pages WHERE category_id=$1 AND department_id=$2 AND status='active' LIMIT 1", [request.params.id, departmentId]);
    if (children.rowCount) return reply.code(409).send({ error: "Move or archive pages and child categories before archiving this category." });
    const result = await pool!.query("UPDATE wiki_categories SET archived_at=now(),updated_by=$3,updated_at=now() WHERE id=$1 AND department_id=$2 AND archived_at IS NULL RETURNING id", [request.params.id, departmentId, request.authenticatedUser!.id]);
    if (!result.rowCount) return reply.code(404).send({ error: "Category not found." });
    changed(departmentId, { action: "category-archived", categoryId: request.params.id });
    return { archived: true };
  });

  app.post<{ Params: { id: string } }>("/api/modules/wiki/categories/:id/restore", async (request, reply) => {
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await site(request, reply, true);
    if (!departmentId) return reply;
    const result = await pool!.query("UPDATE wiki_categories SET archived_at=NULL,updated_by=$3,updated_at=now() WHERE id=$1 AND department_id=$2 AND archived_at IS NOT NULL RETURNING id", [request.params.id, departmentId, request.authenticatedUser!.id]);
    if (!result.rowCount) return reply.code(404).send({ error: "Archived category not found." });
    changed(departmentId, { action: "category-restored", categoryId: request.params.id });
    return { restored: true };
  });

  app.get<{ Querystring: { search?: string; categoryId?: string; status?: string } }>("/api/modules/wiki/pages", async (request, reply) => {
    const departmentId = await site(request, reply);
    if (!departmentId) return reply;
    const status = isWikiManager(request) && request.query.status === "archived" ? "archived" : "active";
    const search = (request.query.search ?? "").trim().slice(0, 120);
    const result = await pool!.query<WikiPageRow>(`SELECT page.id,page.category_id,page.title,''::text AS content_html,page.status,page.redirect_url,page.is_homepage,page.audience,page.audience_group_id,page.created_at,page.updated_at,page.updated_by,editor.display_name AS editor_name FROM wiki_pages page LEFT JOIN app_users editor ON editor.id=page.updated_by WHERE page.department_id=$1 AND page.status=$2 AND ($3::uuid IS NULL OR page.category_id=$3) AND ($4='' OR page.title ILIKE '%'||$4||'%' OR ($5::boolean AND regexp_replace(page.content_html,'<[^>]*>',' ','g') ILIKE '%'||$4||'%')) AND ${pageReadCondition("page", 5, 6)} ORDER BY page.is_homepage DESC,page.updated_at DESC,lower(page.title) LIMIT 300`, [departmentId, status, request.query.categoryId ?? null, search, isWikiManager(request), request.authenticatedUser!.id]);
    return result.rows.map(pageDto);
  });

  app.get<{ Params: { id: string } }>("/api/modules/wiki/pages/:id", async (request, reply) => {
    const departmentId = await site(request, reply);
    if (!departmentId) return reply;
    const pageResult = await pool!.query<WikiPageRow>(`SELECT page.id,page.category_id,page.title,page.content_html,page.status,page.redirect_url,page.is_homepage,page.audience,page.audience_group_id,page.created_at,page.updated_at,page.updated_by,editor.display_name AS editor_name FROM wiki_pages page LEFT JOIN app_users editor ON editor.id=page.updated_by WHERE page.department_id=$1 AND page.id=$2 AND (${pageReadCondition("page", 3, 4)} OR page.status='archived' AND $3::boolean)`, [departmentId, request.params.id, isWikiManager(request), request.authenticatedUser!.id]);
    if (!pageResult.rowCount) return reply.code(404).send({ error: "Wiki page not found." });
    pageResult.rows[0].content_html = await hideUnreadableWikiEntityLinks(pageResult.rows[0].content_html, request, departmentId);
    const [links, files] = await Promise.all([
      pool!.query("SELECT id,title,url,created_at FROM wiki_page_links WHERE department_id=$1 AND page_id=$2 ORDER BY created_at,id", [departmentId, request.params.id]),
      pool!.query("SELECT stored.id,stored.title,stored.file_name AS \"fileName\",stored.content_type AS \"contentType\",stored.file_size AS \"fileSize\",stored.created_at AS \"createdAt\" FROM wiki_page_files link JOIN stored_files stored ON stored.id=link.file_id AND stored.department_id=link.department_id WHERE link.department_id=$1 AND link.page_id=$2 AND stored.deleted_at IS NULL ORDER BY link.created_at DESC", [departmentId, request.params.id]),
    ]);
    const visibleLinks = await Promise.all(links.rows.map(async (link) => await canFollowWikiLink(String(link.url), request, departmentId) ? link : null));
    const safeRedirect = pageResult.rows[0].redirect_url && await canFollowWikiLink(pageResult.rows[0].redirect_url, request, departmentId) ? pageResult.rows[0].redirect_url : null;
    pageResult.rows[0].redirect_url = safeRedirect;
    return { ...pageDto(pageResult.rows[0]), links: visibleLinks.filter((link) => link !== null), files: files.rows };
  });

  app.post<{ Body: { categoryId: string; title: string; contentHtml?: string; audience?: WikiAudience; audienceGroupId?: string | null } }>("/api/modules/wiki/pages", { schema: { body: { type: "object", additionalProperties: false, required: ["categoryId", "title"], properties: { categoryId: { type: "string", format: "uuid" }, title: { type: "string", minLength: 1, maxLength: 180 }, contentHtml: { type: "string", maxLength: 500000 }, audience: { type: "string", enum: ["location","group","managers"] }, audienceGroupId: { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] } } } } }, async (request, reply) => {
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await site(request, reply, true);
    if (!departmentId) return reply;
    const title = request.body.title.trim();
    if (!title) return reply.code(400).send({ error: "Page title is required." });
    const category = await pool!.query("SELECT id FROM wiki_categories WHERE id=$1 AND department_id=$2 AND archived_at IS NULL", [request.body.categoryId, departmentId]);
    if (!category.rowCount) return reply.code(404).send({ error: "Choose an active Wiki category." });
    const audience = request.body.audience ?? "location";
    const audienceGroupId = request.body.audienceGroupId ?? null;
    if (audience === "group" && !audienceGroupId) return reply.code(400).send({ error: "Choose a group for group-only visibility." });
    if (audience !== "group" && audienceGroupId) return reply.code(400).send({ error: "A group can only be selected for group-only visibility." });
    if (audienceGroupId) {
      const group = await pool!.query("SELECT id FROM church_groups WHERE id=$1 AND department_id=$2 AND status='active'", [audienceGroupId, departmentId]);
      if (!group.rowCount) return reply.code(400).send({ error: "Choose a group in this location." });
    }
    const id = randomUUID();
    const content = safeHtml(request.body.contentHtml ?? "");
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<WikiPageRow>("INSERT INTO wiki_pages(id,department_id,category_id,title,content_html,audience,audience_group_id,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING id,category_id,title,content_html,status,redirect_url,is_homepage,audience,audience_group_id,created_at,updated_at,updated_by", [id, departmentId, request.body.categoryId, title, content, audience, audienceGroupId, request.authenticatedUser!.id]);
      await client.query("INSERT INTO wiki_page_versions(id,department_id,page_id,title,content_html,editor_user_id) VALUES($1,$2,$3,$4,$5,$6)", [randomUUID(), departmentId, id, title, content, request.authenticatedUser!.id]);
      await client.query("COMMIT");
      changed(departmentId, { action: "page-created", pageId: id });
      return reply.code(201).send(pageDto(result.rows[0]));
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });

  app.put<{ Params: { id: string }; Body: { categoryId: string; title: string; contentHtml: string; redirectUrl?: string | null; audience: WikiAudience; audienceGroupId?: string | null } }>("/api/modules/wiki/pages/:id", { schema: { body: { type: "object", additionalProperties: false, required: ["categoryId", "title", "contentHtml", "audience"], properties: { categoryId: { type: "string", format: "uuid" }, title: { type: "string", minLength: 1, maxLength: 180 }, contentHtml: { type: "string", maxLength: 500000 }, redirectUrl: { anyOf: [{ type: "string", maxLength: 2000 }, { type: "null" }] }, audience: { type: "string", enum: ["location","group","managers"] }, audienceGroupId: { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] } } } } }, async (request, reply) => {
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await site(request, reply, true);
    if (!departmentId) return reply;
    const title = request.body.title.trim();
    if (!title) return reply.code(400).send({ error: "Page title is required." });
    const category = await pool!.query("SELECT id FROM wiki_categories WHERE id=$1 AND department_id=$2 AND archived_at IS NULL", [request.body.categoryId, departmentId]);
    if (!category.rowCount) return reply.code(404).send({ error: "Choose an active Wiki category." });
    const redirectUrl = request.body.redirectUrl?.trim() || null;
    if (redirectUrl && (!/^(https?:\/\/|\/)/i.test(redirectUrl) || /^\/\//.test(redirectUrl))) return reply.code(400).send({ error: "Redirect must use an HTTP(S) URL or a local path." });
    const audience = request.body.audience;
    const audienceGroupId = request.body.audienceGroupId ?? null;
    if (audience === "group" && !audienceGroupId) return reply.code(400).send({ error: "Choose a group for group-only visibility." });
    if (audience !== "group" && audienceGroupId) return reply.code(400).send({ error: "A group can only be selected for group-only visibility." });
    if (audienceGroupId) {
      const group = await pool!.query(`SELECT id FROM church_groups WHERE id=$1 AND department_id=$2 AND
        (status='active' OR EXISTS (SELECT 1 FROM wiki_pages page WHERE page.id=$3 AND page.department_id=$2 AND page.audience='group' AND page.audience_group_id=church_groups.id))`, [audienceGroupId, departmentId, request.params.id]);
      if (!group.rowCount) return reply.code(400).send({ error: "Choose a group in this location." });
    }
    const content = safeHtml(request.body.contentHtml);
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<WikiPageRow>("SELECT id,category_id,title,content_html,status,redirect_url,is_homepage,audience,audience_group_id,created_at,updated_at,updated_by FROM wiki_pages WHERE id=$1 AND department_id=$2 FOR UPDATE", [request.params.id, departmentId]);
      if (!current.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Wiki page not found." }); }
      const before = current.rows[0];
      if (before.title !== title || before.content_html !== content || before.category_id !== request.body.categoryId || before.redirect_url !== redirectUrl || before.audience !== audience || (before.audience_group_id ?? null) !== audienceGroupId) {
        await client.query("INSERT INTO wiki_page_versions(id,department_id,page_id,title,content_html,editor_user_id) VALUES($1,$2,$3,$4,$5,$6)", [randomUUID(), departmentId, before.id, before.title, before.content_html, request.authenticatedUser!.id]);
      }
      const result = await client.query<WikiPageRow>("UPDATE wiki_pages SET category_id=$3,title=$4,content_html=$5,redirect_url=$6,audience=$7,audience_group_id=$8,updated_by=$9,updated_at=now() WHERE id=$1 AND department_id=$2 RETURNING id,category_id,title,content_html,status,redirect_url,is_homepage,audience,audience_group_id,created_at,updated_at,updated_by", [request.params.id, departmentId, request.body.categoryId, title, content, redirectUrl, audience, audienceGroupId, request.authenticatedUser!.id]);
      await client.query("INSERT INTO wiki_page_versions(id,department_id,page_id,title,content_html,editor_user_id) VALUES($1,$2,$3,$4,$5,$6)", [randomUUID(), departmentId, request.params.id, title, content, request.authenticatedUser!.id]);
      await client.query("COMMIT");
      changed(departmentId, { action: "page-updated", pageId: request.params.id });
      return pageDto(result.rows[0]);
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });

  app.get<{ Params: { id: string } }>("/api/modules/wiki/pages/:id/versions", async (request, reply) => {
    const departmentId = await site(request, reply);
    if (!departmentId) return reply;
    if (!await canReadPage(request, departmentId, request.params.id)) return reply.code(404).send({ error: "Wiki page not found." });
    const result = await pool!.query("SELECT version.id,version.title,version.content_html AS \"contentHtml\",version.created_at AS \"createdAt\",version.editor_user_id AS \"editorId\",editor.display_name AS \"editorName\" FROM wiki_page_versions version LEFT JOIN app_users editor ON editor.id=version.editor_user_id WHERE version.department_id=$1 AND version.page_id=$2 ORDER BY version.created_at DESC,version.id DESC LIMIT 200", [departmentId, request.params.id]);
    return Promise.all(result.rows.map(async (version) => ({ ...version, contentHtml: await hideUnreadableWikiEntityLinks(version.contentHtml, request, departmentId) })));
  });

  app.get<{ Params: { id: string }; Querystring: { leftVersionId?: string; rightVersionId?: string } }>("/api/modules/wiki/pages/:id/versions/compare", { schema: {
    params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
    querystring: { type: "object", additionalProperties: false, required: ["leftVersionId", "rightVersionId"], properties: { leftVersionId: { type: "string", format: "uuid" }, rightVersionId: { type: "string", format: "uuid" } } },
  } }, async (request, reply) => {
    const departmentId = await site(request, reply, true);
    if (!departmentId) return reply;
    const leftVersionId = request.query.leftVersionId;
    const rightVersionId = request.query.rightVersionId;
    if (!leftVersionId || !rightVersionId || leftVersionId === rightVersionId) return reply.code(400).send({ error: "Choose two different revisions to compare." });
    const page = await pool!.query<{ id: string }>(
      `SELECT page.id FROM wiki_pages page WHERE page.id=$1 AND page.department_id=$2 AND ${pageReadCondition("page", 3, 4)}`,
      [request.params.id, departmentId, isWikiManager(request), request.authenticatedUser!.id],
    );
    if (!page.rowCount) return reply.code(404).send({ error: "Wiki page not found." });
    const revisions = await pool!.query<{ id: string; title: string; contentHtml: string; createdAt: Date | string; editorId: string | null; editorName: string | null }>(
      `SELECT version.id,version.title,version.content_html AS "contentHtml",version.created_at AS "createdAt",version.editor_user_id AS "editorId",editor.display_name AS "editorName"
         FROM wiki_page_versions version LEFT JOIN app_users editor ON editor.id=version.editor_user_id
        WHERE version.department_id=$1 AND version.page_id=$2 AND version.id=ANY($3::uuid[])`,
      [departmentId, request.params.id, [leftVersionId, rightVersionId]],
    );
    if (revisions.rowCount !== 2) return reply.code(404).send({ error: "One or both revisions could not be found for this page." });
    const byId = new Map(revisions.rows.map((revision) => [revision.id, revision]));
    const safeRevision = async (id: string) => {
      const revision = byId.get(id)!;
      const sanitized = safeHtml(revision.contentHtml);
      return { ...revision, contentHtml: await hideUnreadableWikiEntityLinks(sanitized, request, departmentId) };
    };
    return { left: await safeRevision(leftVersionId), right: await safeRevision(rightVersionId) };
  });

  app.post<{ Params: { id: string; versionId: string } }>("/api/modules/wiki/pages/:id/versions/:versionId/restore", async (request, reply) => {
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await site(request, reply, true);
    if (!departmentId) return reply;
    const version = await pool!.query<{ title: string; content_html: string }>("SELECT title,content_html FROM wiki_page_versions WHERE id=$1 AND page_id=$2 AND department_id=$3", [request.params.versionId, request.params.id, departmentId]);
    if (!version.rowCount) return reply.code(404).send({ error: "Wiki page version not found." });
    const current = await pool!.query<WikiPageRow>("SELECT id,category_id,title,content_html,status,redirect_url,is_homepage,created_at,updated_at,updated_by FROM wiki_pages WHERE id=$1 AND department_id=$2", [request.params.id, departmentId]);
    if (!current.rowCount) return reply.code(404).send({ error: "Wiki page not found." });
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO wiki_page_versions(id,department_id,page_id,title,content_html,editor_user_id) VALUES($1,$2,$3,$4,$5,$6)", [randomUUID(), departmentId, request.params.id, current.rows[0].title, current.rows[0].content_html, request.authenticatedUser!.id]);
      const result = await client.query<WikiPageRow>("UPDATE wiki_pages SET title=$3,content_html=$4,updated_by=$5,updated_at=now() WHERE id=$1 AND department_id=$2 RETURNING id,category_id,title,content_html,status,redirect_url,is_homepage,created_at,updated_at,updated_by", [request.params.id, departmentId, version.rows[0].title, version.rows[0].content_html, request.authenticatedUser!.id]);
      await client.query("INSERT INTO wiki_page_versions(id,department_id,page_id,title,content_html,editor_user_id) VALUES($1,$2,$3,$4,$5,$6)", [randomUUID(), departmentId, request.params.id, version.rows[0].title, version.rows[0].content_html, request.authenticatedUser!.id]);
      await client.query("COMMIT");
      changed(departmentId, { action: "page-restored", pageId: request.params.id });
      return pageDto(result.rows[0]);
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });

  app.post<{ Params: { id: string } }>("/api/modules/wiki/pages/:id/archive", async (request, reply) => {
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await site(request, reply, true);
    if (!departmentId) return reply;
    const result = await pool!.query("UPDATE wiki_pages SET status='archived',is_homepage=false,updated_by=$3,updated_at=now() WHERE id=$1 AND department_id=$2 AND status='active' RETURNING id", [request.params.id, departmentId, request.authenticatedUser!.id]);
    if (!result.rowCount) return reply.code(404).send({ error: "Active Wiki page not found." });
    changed(departmentId, { action: "page-archived", pageId: request.params.id });
    return { archived: true };
  });

  app.post<{ Params: { id: string } }>("/api/modules/wiki/pages/:id/restore", async (request, reply) => {
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await site(request, reply, true);
    if (!departmentId) return reply;
    const result = await pool!.query("UPDATE wiki_pages SET status='active',updated_by=$3,updated_at=now() WHERE id=$1 AND department_id=$2 AND status='archived' RETURNING id", [request.params.id, departmentId, request.authenticatedUser!.id]);
    if (!result.rowCount) return reply.code(404).send({ error: "Archived Wiki page not found." });
    changed(departmentId, { action: "page-restored", pageId: request.params.id });
    return { restored: true };
  });

  app.put<{ Params: { id: string }; Body: { isHomepage: boolean } }>("/api/modules/wiki/pages/:id/homepage", { schema: { body: { type: "object", additionalProperties: false, required: ["isHomepage"], properties: { isHomepage: { type: "boolean" } } } } }, async (request, reply) => {
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await site(request, reply, true);
    if (!departmentId) return reply;
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      if (request.body.isHomepage) await client.query("UPDATE wiki_pages SET is_homepage=false WHERE department_id=$1 AND is_homepage", [departmentId]);
      const result = await client.query("UPDATE wiki_pages SET is_homepage=$3,updated_by=$4,updated_at=now() WHERE id=$1 AND department_id=$2 AND status='active' RETURNING id", [request.params.id, departmentId, request.body.isHomepage, request.authenticatedUser!.id]);
      if (!result.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Active Wiki page not found." }); }
      await client.query("COMMIT");
      changed(departmentId, { action: "homepage-changed", pageId: request.params.id });
      return { isHomepage: request.body.isHomepage };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });

  app.post<{ Params: { id: string }; Body: { title: string; url: string } }>("/api/modules/wiki/pages/:id/links", { schema: { body: { type: "object", additionalProperties: false, required: ["title", "url"], properties: { title: { type: "string", minLength: 1, maxLength: 160 }, url: { type: "string", minLength: 1, maxLength: 2000 } } } } }, async (request, reply) => {
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await site(request, reply, true);
    if (!departmentId) return reply;
    const title = request.body.title.trim();
    const url = request.body.url.trim();
    if (!title || !/^(https?:\/\/|\/|#)/i.test(url) || /^\/\//.test(url)) return reply.code(400).send({ error: "Enter a link title and a safe HTTP(S) or local URL." });
    const page = await pool!.query("SELECT id FROM wiki_pages WHERE id=$1 AND department_id=$2 AND status='active'", [request.params.id, departmentId]);
    if (!page.rowCount) return reply.code(404).send({ error: "Active Wiki page not found." });
    const result = await pool!.query("INSERT INTO wiki_page_links(id,department_id,page_id,title,url,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,title,url,created_at", [randomUUID(), departmentId, request.params.id, title, url, request.authenticatedUser!.id]);
    changed(departmentId, { action: "link-added", pageId: request.params.id });
    return reply.code(201).send(result.rows[0]);
  });

  app.delete<{ Params: { id: string; linkId: string } }>("/api/modules/wiki/pages/:id/links/:linkId", async (request, reply) => {
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await site(request, reply, true);
    if (!departmentId) return reply;
    const result = await pool!.query("DELETE FROM wiki_page_links WHERE id=$1 AND page_id=$2 AND department_id=$3 RETURNING id", [request.params.linkId, request.params.id, departmentId]);
    if (!result.rowCount) return reply.code(404).send({ error: "Wiki page link not found." });
    changed(departmentId, { action: "link-removed", pageId: request.params.id });
    return { deleted: true };
  });

  app.get<{ Params: { id: string } }>("/api/modules/wiki/pages/:id/available-files", async (request, reply) => {
    const departmentId = await site(request, reply);
    if (!departmentId) return reply;
    if (!await canReadPage(request, departmentId, request.params.id)) return reply.code(404).send({ error: "Wiki page not found." });
    const result = await pool!.query("SELECT id,title,file_name AS \"fileName\",content_type AS \"contentType\",file_size AS \"fileSize\",created_at AS \"createdAt\" FROM stored_files WHERE department_id=$1 AND deleted_at IS NULL AND id NOT IN (SELECT file_id FROM wiki_page_files WHERE page_id=$2 AND department_id=$1) ORDER BY created_at DESC LIMIT 500", [departmentId, request.params.id]);
    return result.rows;
  });

  app.post<{ Params: { id: string }; Body: { fileId: string } }>("/api/modules/wiki/pages/:id/files", { schema: { body: { type: "object", additionalProperties: false, required: ["fileId"], properties: { fileId: { type: "string", format: "uuid" } } } } }, async (request, reply) => {
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await site(request, reply, true);
    if (!departmentId) return reply;
    const page = await pool!.query("SELECT id FROM wiki_pages WHERE id=$1 AND department_id=$2 AND status='active'", [request.params.id, departmentId]);
    if (!page.rowCount) return reply.code(404).send({ error: "Active Wiki page not found." });
    const file = await pool!.query("SELECT id FROM stored_files WHERE id=$1 AND department_id=$2 AND deleted_at IS NULL", [request.body.fileId, departmentId]);
    if (!file.rowCount) return reply.code(404).send({ error: "Active file not found in this site." });
    await pool!.query("INSERT INTO wiki_page_files(department_id,page_id,file_id,added_by) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [departmentId, request.params.id, request.body.fileId, request.authenticatedUser!.id]);
    changed(departmentId, { action: "file-attached", pageId: request.params.id });
    return { attached: true };
  });

  app.delete<{ Params: { id: string; fileId: string } }>("/api/modules/wiki/pages/:id/files/:fileId", async (request, reply) => {
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await site(request, reply, true);
    if (!departmentId) return reply;
    const result = await pool!.query("DELETE FROM wiki_page_files WHERE department_id=$1 AND page_id=$2 AND file_id=$3 RETURNING file_id", [departmentId, request.params.id, request.params.fileId]);
    if (!result.rowCount) return reply.code(404).send({ error: "Page attachment not found." });
    changed(departmentId, { action: "file-detached", pageId: request.params.id });
    return { detached: true };
  });

  app.get<{ Params: { id: string; fileId: string } }>("/api/modules/wiki/pages/:id/files/:fileId/download", async (request, reply) => {
    const departmentId = await site(request, reply);
    if (!departmentId) return reply;
    if (!await canReadPage(request, departmentId, request.params.id)) return reply.code(404).send({ error: "Wiki file not found." });
    const result = await pool!.query<{ file_name: string; content_type: string; file_data: Buffer }>(
      `SELECT stored.file_name,stored.content_type,stored.file_data
         FROM wiki_page_files attachment
         JOIN stored_files stored ON stored.id=attachment.file_id AND stored.department_id=attachment.department_id
        WHERE attachment.department_id=$1 AND attachment.page_id=$2 AND attachment.file_id=$3 AND stored.deleted_at IS NULL`,
      [departmentId, request.params.id, request.params.fileId],
    );
    const file = result.rows[0];
    if (!file) return reply.code(404).send({ error: "Wiki file not found." });
    reply.type(file.content_type).header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.file_name)}`).header("X-Content-Type-Options", "nosniff");
    return file.file_data;
  });

  app.get<{ Params: { id: string } }>("/api/modules/wiki/pages/:id/export/html", async (request, reply) => {
    const departmentId = await site(request, reply);
    if (!departmentId) return reply;
    if (!await canReadPage(request, departmentId, request.params.id)) return reply.code(404).send({ error: "Active Wiki page not found." });
    const result = await pool!.query<{ title: string; content_html: string }>("SELECT title,content_html FROM wiki_pages WHERE id=$1 AND department_id=$2 AND status='active'", [request.params.id, departmentId]);
    if (!result.rowCount) return reply.code(404).send({ error: "Active Wiki page not found." });
    result.rows[0].content_html = await hideUnreadableWikiEntityLinks(result.rows[0].content_html, request, departmentId);
    const title = result.rows[0].title.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
    return reply.type("text/html; charset=utf-8").header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; base-uri 'none'; form-action 'none'").header("X-Content-Type-Options", "nosniff").send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:850px;margin:3rem auto;padding:0 1rem;color:#17212b}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:.4rem}</style><main><h1>${title}</h1>${safeHtml(result.rows[0].content_html)}</main></html>`);
  });
}
