import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";

type HomeLink = { label: string; url: string };
type Welcome = { heading: string; subtitle: string; links: HomeLink[] };
type WelcomeUpdate = { heading?: string; subtitle?: string; links?: HomeLink[] };
const maxLinks = 12;

export function normalizeHomeLinks(value: unknown): HomeLink[] | null {
  if (!Array.isArray(value) || value.length > maxLinks) return null;
  const links: HomeLink[] = [];
  for (const entry of value) {
    if (!entry || typeof entry.label !== "string" || typeof entry.url !== "string") return null;
    const label = entry.label.trim();
    const url = entry.url.trim();
    if (!label || label.length > 80 || url.length > 2048 || /[\u0000-\u001f\u007f]/.test(label + url) || !/^https?:\/\//i.test(url)) return null;
    const parsed = URL.parse(url);
    if (!parsed || parsed.username || parsed.password || parsed.href.length > 2048) return null;
    links.push({ label, url: parsed.href });
  }
  return links;
}

export function registerHomeWelcome(app: FastifyInstance, dependencies: {
  getPool: () => Pool;
  department: (request: FastifyRequest, reply: FastifyReply) => Promise<string | null>;
  validateMutation: (request: FastifyRequest, reply: FastifyReply) => boolean;
  lockDepartmentForWrite: (client: PoolClient, departmentId: string) => Promise<boolean>;
}) {
  const path = "/api/modules/notifications/home-welcome";
  app.get(path, async (request, reply) => {
    const departmentId = await dependencies.department(request, reply);
    if (!departmentId) return reply;
    const { rows: [welcome] } = await dependencies.getPool().query<Welcome>(
      "SELECT heading,subtitle,links FROM overview_location_welcome WHERE department_id=$1", [departmentId],
    );
    return reply.header("Cache-Control", "private, no-store").send({ heading: welcome?.heading ?? "", subtitle: welcome?.subtitle ?? "", links: normalizeHomeLinks(welcome?.links) ?? [] });
  });
  app.put<{ Body: WelcomeUpdate }>(path, {
    schema: { body: { type: "object", additionalProperties: false, anyOf: [{ required: ["heading", "subtitle"] }, { required: ["links"], not: { anyOf: [{ required: ["heading"] }, { required: ["subtitle"] }] } }], properties: {
      heading: { type: "string", maxLength: 100 }, subtitle: { type: "string", maxLength: 300 },
      links: { type: "array", maxItems: maxLinks, items: { type: "object", additionalProperties: false, required: ["label", "url"], properties: {
        label: { type: "string", minLength: 1, maxLength: 80 }, url: { type: "string", minLength: 1, maxLength: 2048 },
      } } },
    } } },
  }, async (request, reply) => {
    if (!dependencies.validateMutation(request, reply)) return reply;
    const departmentId = await dependencies.department(request, reply);
    if (!departmentId) return reply;
    const actor = request.authenticatedUser?.id;
    if (!actor || request.activeDepartmentRole !== "site_admin" || request.headers.authorization) {
      return reply.code(403).send({ error: "A site administrator browser session is required to edit Home settings." });
    }
    const heading = request.body.heading?.trim() ?? null;
    const subtitle = request.body.subtitle?.trim() ?? null;
    const links = request.body.links === undefined ? null : normalizeHomeLinks(request.body.links);
    if (request.body.links && !links) return reply.code(400).send({ error: "Give each link a label and a valid HTTP or HTTPS address." });
    if (/[\u0000-\u001f\u007f]/.test((heading ?? "") + (subtitle ?? ""))) {
      return reply.code(400).send({ error: "Enter the heading and subtitle as single lines of text." });
    }
    const client = await dependencies.getPool().connect();
    try {
      await client.query("BEGIN");
      if (!await dependencies.lockDepartmentForWrite(client, departmentId)) {
        await client.query("ROLLBACK");
        return reply.code(423).send({ error: "This location is read-only." });
      }
      const membership = await client.query(
        `SELECT member.user_id FROM department_memberships member JOIN app_users account ON account.id=member.user_id
          WHERE member.department_id=$1 AND member.user_id=$2 AND member.role='site_admin'
            AND account.is_enabled AND NOT account.is_service_user AND NOT (account.must_change_password AND account.can_change_password)
          FOR SHARE OF member,account`,
        [departmentId, actor],
      );
      if (!membership.rowCount) {
        await client.query("ROLLBACK");
        return reply.code(403).send({ error: "A site administrator browser session is required to edit Home settings." });
      }
      const { rows: [welcome] } = await client.query<Welcome>(
        `INSERT INTO overview_location_welcome (department_id,heading,subtitle,links)
         VALUES($1,COALESCE($2,''),COALESCE($3,''),COALESCE($4::jsonb,'[]'::jsonb))
         ON CONFLICT(department_id) DO UPDATE SET
           heading=COALESCE($2,overview_location_welcome.heading),
           subtitle=COALESCE($3,overview_location_welcome.subtitle),
           links=COALESCE($4::jsonb,overview_location_welcome.links)
         RETURNING heading,subtitle,links`,
        [departmentId, heading, subtitle, links === null ? null : JSON.stringify(links)],
      );
      if (!welcome.heading && !welcome.subtitle && !welcome.links.length) {
        await client.query("DELETE FROM overview_location_welcome WHERE department_id=$1", [departmentId]);
      }
      await client.query("COMMIT");
      return reply.header("Cache-Control", "private, no-store").send(welcome);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
}
