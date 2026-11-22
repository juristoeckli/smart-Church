import type { FastifyRequest } from "fastify";
import type { PoolClient } from "pg";

export async function wikiFileAudienceSchema(db: Pick<PoolClient, "query">) {
  const result = await db.query<{ pages: boolean; attachments: boolean; audience: boolean }>(
    `SELECT to_regclass('public.wiki_pages') IS NOT NULL AS pages,to_regclass('public.wiki_page_files') IS NOT NULL AS attachments,
      EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.wiki_page_files')
        AND attname='managers_only' AND NOT attisdropped) AS audience`,
  );
  const state = result.rows[0];
  if (state?.pages && state.attachments && state.audience) return "complete" as const;
  if (state?.pages === false && state.attachments === false) return "absent" as const;
  return "partial" as const;
}

export function canManageStoredFileWikiAudience(request: FastifyRequest) {
  return request.activeDepartmentRole === "site_admin" || (request.activeDepartmentModulePermissions?.wiki ?? []).includes("manage");
}

// Queries use stored_files alias "stored", with Wiki manager grant and viewer ID at $2 and $3.
export const storedFileWikiAudienceSql = `(
  NOT EXISTS (SELECT 1 FROM wiki_page_files attachment WHERE attachment.department_id=stored.department_id AND attachment.file_id=stored.id)
  OR $2::boolean
  OR EXISTS (
    SELECT 1 FROM wiki_page_files attachment JOIN wiki_pages page ON page.id=attachment.page_id AND page.department_id=attachment.department_id
     WHERE attachment.department_id=stored.department_id AND attachment.file_id=stored.id AND NOT attachment.managers_only AND page.status='active'
       AND (page.audience='location' OR (page.audience='group' AND EXISTS (
         SELECT 1 FROM group_members member JOIN department_memberships membership ON membership.contact_id=member.contact_id AND membership.department_id=stored.department_id
          WHERE member.group_id=page.audience_group_id AND member.status='active' AND membership.user_id=$3
       )))
  ))`;
