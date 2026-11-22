import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";
import type { ModuleServerContext } from "../module-sdk.js";

type CalendarChoice = { id: string; name: string };
type PublicAgenda = { id: string; name: string; calendars: CalendarChoice[] };
type PublicationInput = { name: string; calendarIds: string[] };
type CalendarAccess = (request: FastifyRequest) => boolean;

type PublicationSource = {
  department_id: string; calendar_ids: string[]; calendar_name: string;
  calendar_scope: "community"; time_zone: string; local_today: string;
};

export async function loadPublicAgenda(db: Pool, tokenHash: string) {
  const { rows: [source] } = await db.query<PublicationSource>(
    `SELECT publication.department_id,array_agg(calendar.id ORDER BY membership.position) AS calendar_ids,
            publication.name AS calendar_name,'community' AS calendar_scope,
            COALESCE(zone.name,'UTC') AS time_zone,to_char(now() AT TIME ZONE COALESCE(zone.name,'UTC'),'YYYY-MM-DD') AS local_today
       FROM church_calendar_agenda_publications publication
       JOIN departments department ON department.id=publication.department_id
       LEFT JOIN pg_timezone_names zone ON zone.name=department.time_zone
       JOIN church_calendar_agenda_calendars membership ON membership.publication_id=publication.id AND membership.department_id=publication.department_id
       JOIN church_calendar_calendars calendar ON calendar.id=membership.calendar_id AND calendar.department_id=membership.department_id
       JOIN church_calendar_public_feeds feed ON feed.calendar_id=calendar.id AND feed.department_id=calendar.department_id AND feed.revoked_at IS NULL
      WHERE publication.token_hash=$1 AND publication.revoked_at IS NULL AND calendar.archived_at IS NULL AND calendar.scope='community'
      GROUP BY publication.id,zone.name`, [tokenHash],
  );
  return source;
}

const params = { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", format: "uuid" } } } as const;

export function registerCalendarAgendaPublications(
  app: FastifyInstance, context: ModuleServerContext, canManage: CalendarAccess, hashFeedToken: (token: string) => string,
) {
  const base = "/api/modules/church-calendar/public-agendas";
  const scope = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!context.pool || !context.isDatabaseReady()) { void reply.code(503).send({ error: "Calendar storage is unavailable." }); return null; }
    if (request.method !== "GET" && !context.validateMutation(request, reply)) return null;
    const departmentId = await context.resolveDepartmentId(request, reply);
    if (!departmentId) return null;
    if (!canManage(request)) { void reply.code(403).send({ error: "Calendar management is required to publish agendas." }); return null; }
    return departmentId;
  };

  app.get(base, async (request, reply) => {
    const departmentId = await scope(request, reply);
    if (!departmentId) return reply;
    const result = await context.pool!.query<PublicAgenda>(
      `SELECT publication.id,publication.name,
              COALESCE(jsonb_agg(jsonb_build_object('id',calendar.id,'name',calendar.name) ORDER BY membership.position)
                FILTER (WHERE calendar.id IS NOT NULL AND feed.calendar_id IS NOT NULL),'[]'::jsonb) AS calendars
         FROM church_calendar_agenda_publications publication
         LEFT JOIN church_calendar_agenda_calendars membership ON membership.publication_id=publication.id AND membership.department_id=publication.department_id
         LEFT JOIN church_calendar_calendars calendar ON calendar.id=membership.calendar_id AND calendar.department_id=publication.department_id
           AND calendar.archived_at IS NULL AND calendar.scope='community'
         LEFT JOIN church_calendar_public_feeds feed ON feed.calendar_id=calendar.id AND feed.department_id=calendar.department_id AND feed.revoked_at IS NULL
        WHERE publication.department_id=$1 AND publication.revoked_at IS NULL
        GROUP BY publication.id ORDER BY publication.created_at,publication.id`, [departmentId],
    );
    return reply.header("Cache-Control", "private, no-store").send(result.rows);
  });

  const write = async (request: FastifyRequest, reply: FastifyReply, action: (client: PoolClient, departmentId: string) => Promise<unknown>) => {
    const departmentId = await scope(request, reply);
    if (!departmentId) return reply;
    const client = await context.pool!.connect();
    try {
      await client.query("BEGIN");
      if (!await context.lockDepartmentForWrite(client, departmentId)) {
        await client.query("ROLLBACK");
        return reply.code(423).send({ error: "This location is read-only." });
      }
      const result = await action(client, departmentId);
      await client.query(reply.statusCode >= 400 ? "ROLLBACK" : "COMMIT");
      if (reply.statusCode < 400) context.realtime.publish("module:church-calendar:changed", departmentId, { action: "public-agendas-changed" });
      return reply.header("Cache-Control", "private, no-store").send(result);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };

  app.post<{ Body: PublicationInput }>(base, { schema: { body: { type: "object", additionalProperties: false, required: ["name","calendarIds"], properties: {
    name: { type: "string", minLength: 1, maxLength: 120 },
    calendarIds: { type: "array", minItems: 2, maxItems: 8, items: { type: "string", format: "uuid" } },
  } } } }, (request, reply) => write(request, reply, async (client, departmentId) => {
    const name = request.body.name.trim();
    const calendarIds = request.body.calendarIds.map((id) => id.toLowerCase());
    if (!name || new Set(calendarIds).size !== calendarIds.length) {
      reply.code(400);
      return { error: "Enter a name and select distinct calendars." };
    }
    const calendars = await client.query<CalendarChoice>(
      `SELECT calendar.id,calendar.name FROM unnest($2::uuid[]) WITH ORDINALITY selected(id,position)
        JOIN church_calendar_calendars calendar ON calendar.id=selected.id AND calendar.department_id=$1
        JOIN church_calendar_public_feeds feed ON feed.calendar_id=calendar.id AND feed.department_id=calendar.department_id AND feed.revoked_at IS NULL
       WHERE calendar.archived_at IS NULL AND calendar.scope='community'
       ORDER BY selected.position FOR SHARE OF calendar,feed`, [departmentId, calendarIds],
    );
    if (calendars.rows.length !== calendarIds.length) {
      reply.code(409);
      return { error: "Every selected calendar needs an active public feed in this location." };
    }
    const id = randomUUID();
    const token = randomBytes(32).toString("base64url");
    await client.query("INSERT INTO church_calendar_agenda_publications(id,department_id,name,token_hash,created_by) VALUES($1,$2,$3,$4,$5)",
      [id, departmentId, name, hashFeedToken(token), request.authenticatedUser!.id]);
    await client.query(
      `INSERT INTO church_calendar_agenda_calendars(department_id,publication_id,calendar_id,position)
       SELECT $1,$2,selected.id,selected.position FROM unnest($3::uuid[]) WITH ORDINALITY selected(id,position)`, [departmentId, id, calendarIds],
    );
    reply.code(201);
    return { id, name, calendars: calendars.rows, embedUrl: `/api/public/church-calendar/agenda/${token}` };
  }));

  app.post<{ Params: { id: string } }>(`${base}/:id/rotate`, { schema: { params } }, (request, reply) => write(request, reply, async (client, departmentId) => {
    const token = randomBytes(32).toString("base64url");
    const { rows: [row] } = await client.query<{ id: string; name: string }>(
      "UPDATE church_calendar_agenda_publications SET token_hash=$3 WHERE id=$1 AND department_id=$2 AND revoked_at IS NULL RETURNING id,name",
      [request.params.id, departmentId, hashFeedToken(token)],
    );
    if (!row) { reply.code(404); return { error: "Public agenda not found." }; }
    return { ...row, embedUrl: `/api/public/church-calendar/agenda/${token}` };
  }));

  app.delete<{ Params: { id: string } }>(`${base}/:id`, { schema: { params } }, (request, reply) => write(request, reply, async (client, departmentId) => {
    const result = await client.query(
      "UPDATE church_calendar_agenda_publications SET revoked_at=now() WHERE id=$1 AND department_id=$2 AND revoked_at IS NULL",
      [request.params.id, departmentId],
    );
    if (!result.rowCount) { reply.code(404); return { error: "Public agenda not found." }; }
    return { revoked: true };
  }));
}
