import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";

type Welcome = { heading: string; subtitle: string };

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
      "SELECT heading,subtitle FROM overview_location_welcome WHERE department_id=$1", [departmentId],
    );
    return reply.header("Cache-Control", "private, no-store").send(welcome ?? { heading: "", subtitle: "" });
  });
  app.put<{ Body: Welcome }>(path, {
    schema: { body: { type: "object", additionalProperties: false, required: ["heading", "subtitle"], properties: {
      heading: { type: "string", maxLength: 100 }, subtitle: { type: "string", maxLength: 300 },
    } } },
  }, async (request, reply) => {
    if (!dependencies.validateMutation(request, reply)) return reply;
    const departmentId = await dependencies.department(request, reply);
    if (!departmentId) return reply;
    const actor = request.authenticatedUser?.id;
    if (!actor || request.activeDepartmentRole !== "site_admin" || request.headers.authorization) {
      return reply.code(403).send({ error: "A site administrator browser session is required to edit the welcome message." });
    }
    const heading = request.body.heading.trim();
    const subtitle = request.body.subtitle.trim();
    if (/[\u0000-\u001f\u007f]/.test(heading + subtitle)) {
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
        return reply.code(403).send({ error: "A site administrator browser session is required to edit the welcome message." });
      }
      if (heading || subtitle) {
        await client.query(
          `INSERT INTO overview_location_welcome (department_id,heading,subtitle) VALUES($1,$2,$3)
           ON CONFLICT(department_id) DO UPDATE SET heading=EXCLUDED.heading,subtitle=EXCLUDED.subtitle`,
          [departmentId, heading, subtitle],
        );
      } else {
        await client.query("DELETE FROM overview_location_welcome WHERE department_id=$1", [departmentId]);
      }
      await client.query("COMMIT");
      return reply.header("Cache-Control", "private, no-store").send({ heading, subtitle });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
}
