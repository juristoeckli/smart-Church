import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import type { ModuleServerContext } from "../module-sdk.js";
import { normalizePostalAddress, postalAddressLimits, postalAddressSchema, type PostalAddress } from "./postal-address.js";

type ContactParams = { contactId: string };
type HouseholdInput = { label: string; salutation?: string; postalAddress?: PostalAddress };
type HouseholdRow = { id: string; label: string; salutation: string; postal_address: PostalAddress };
type MutationResult = { status: number; payload: object };
type DepartmentResolver = (request: FastifyRequest, reply: FastifyReply, write?: boolean) => Promise<string | null>;

const uuid = { type: "string", format: "uuid" } as const;
const uuidPattern = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const personPath = "/api/people-records/:contactId/household";
const params = { type: "object", required: ["contactId"], additionalProperties: false, properties: { contactId: uuid } } as const;
const householdBody = { type: "object", required: ["label"], additionalProperties: false, properties: {
  label: { type: "string", minLength: 1, maxLength: 120, pattern: "^[^\\u0000\\r\\n]*$" },
  salutation: { type: "string", maxLength: 160, pattern: "^[^\\u0000\\r\\n]*$" }, postalAddress: postalAddressSchema,
} };
const maxHouseholdMembers = 50;
const addressKeys = Object.keys(postalAddressLimits) as Array<keyof PostalAddress>;

function csvCell(value: string | undefined) {
  const text = value ?? "";
  const safe = /^(?:\s*[=+@-]|[\t\r])/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}

function completePostalAddress(address: PostalAddress) {
  return Boolean(address.street && address.city && address.postalCode);
}

export function registerPeopleHouseholds(routes: FastifyInstance, context: ModuleServerContext, department: DepartmentResolver) {
  const { pool, validateMutation, lockDepartmentForWrite, realtime } = context;

  async function mutate(request: FastifyRequest<{ Params: ContactParams }>, reply: FastifyReply,
    change: (client: PoolClient, departmentId: string, current: HouseholdRow | undefined) => Promise<MutationResult>) {
    const departmentId = await department(request, reply, true);
    if (!departmentId || !validateMutation(request, reply)) return reply;
    const { contactId } = request.params;
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      if (!await lockDepartmentForWrite(client, departmentId)) {
        await client.query("ROLLBACK");
        return reply.code(423).send({ error: "This location is read-only." });
      }
      const contact = await client.query<{ archived_at: Date | null }>("SELECT archived_at FROM contacts WHERE department_id=$1 AND id=$2 FOR NO KEY UPDATE", [departmentId, contactId]);
      if (!contact.rows[0] || contact.rows[0].archived_at) {
        await client.query("ROLLBACK");
        return contact.rows[0] ? reply.code(409).send({ error: "Restore this person before updating household membership." }) : reply.code(404).send({ error: "Person not found at this location." });
      }
      const membership = await client.query<HouseholdRow>(
        `SELECT household.id,household.label,household.salutation,household.postal_address FROM people_record_household_members member
           JOIN people_record_households household ON household.id=member.household_id AND household.department_id=member.department_id
          WHERE member.department_id=$1 AND member.contact_id=$2 FOR UPDATE OF household`, [departmentId, contactId],
      );
      const result = await change(client, departmentId, membership.rows[0]);
      await client.query("COMMIT");
      if (result.status < 400) realtime.publish("people-records:changed", departmentId, { contactId });
      return reply.code(result.status).send(result.payload);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async function recordMembership(client: PoolClient, departmentId: string, contactId: string, actorId: string, action: "household_linked" | "household_unlinked", household: HouseholdRow) {
    const value = JSON.stringify({ householdId: household.id, label: household.label });
    await client.query(
      "INSERT INTO people_record_history(id,department_id,contact_id,actor_user_id,action,subject,before_value,after_value) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)",
      [randomUUID(), departmentId, contactId, actorId, action, household.label, action === "household_unlinked" ? value : null, action === "household_linked" ? value : null],
    );
  }

  routes.get<{ Params: ContactParams }>(personPath, { schema: { params } }, async (request, reply) => {
    const departmentId = await department(request, reply);
    if (!departmentId) return reply;
    const result = await pool!.query<{ household: object | null }>(
      `SELECT CASE WHEN household.id IS NOT NULL THEN jsonb_build_object('id',household.id,'label',household.label,
                'salutation',household.salutation,'postalAddress',household.postal_address,'members',(
                  SELECT jsonb_agg(jsonb_build_object('id',person.id,'name',concat_ws(' ',person.first_name,person.last_name),'archived',person.archived_at IS NOT NULL)
                                  ORDER BY lower(person.last_name),lower(person.first_name),person.id)
                    FROM people_record_household_members member
                    JOIN contacts person ON person.id=member.contact_id AND person.department_id=member.department_id
                   WHERE member.household_id=household.id AND member.department_id=household.department_id
                )) END AS household
         FROM contacts contact
         LEFT JOIN people_record_household_members membership ON membership.contact_id=contact.id AND membership.department_id=contact.department_id
         LEFT JOIN people_record_households household ON household.id=membership.household_id AND household.department_id=membership.department_id
        WHERE contact.id=$2 AND contact.department_id=$1`, [departmentId, request.params.contactId],
    );
    if (!result.rows[0]) return reply.code(404).send({ error: "Person not found at this location." });
    return reply.header("cache-control", "private, no-store").send(result.rows[0]);
  });

  routes.get<{ Querystring: { kind: "households" | "people"; q?: string } }>("/api/people-records/households/options", {
    schema: { querystring: { type: "object", required: ["kind"], additionalProperties: false, properties: {
      kind: { type: "string", enum: ["households", "people"] }, q: { type: "string", maxLength: 100 },
    } } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply);
    if (!departmentId) return reply;
    const search = request.query.q?.trim() ?? "";
    const result = request.query.kind === "households"
      ? await pool!.query(
        `SELECT household.id,household.label FROM people_record_households household WHERE household.department_id=$1
          AND strpos(lower(household.label),lower($2))>0 ORDER BY lower(household.label),household.id LIMIT 30`, [departmentId, search],
      )
      : await pool!.query(
        `SELECT contact.id,concat_ws(' ',contact.first_name,contact.last_name) AS label FROM contacts contact
          WHERE contact.department_id=$1 AND contact.archived_at IS NULL
            AND strpos(lower(concat_ws(' ',contact.first_name,contact.last_name)),lower($2))>0
            AND NOT EXISTS(SELECT 1 FROM people_record_household_members member WHERE member.department_id=contact.department_id AND member.contact_id=contact.id)
          ORDER BY lower(contact.last_name),lower(contact.first_name),contact.id LIMIT 30`, [departmentId, search],
      );
    return reply.header("cache-control", "private, no-store").send(result.rows);
  });

  routes.post<{ Params: ContactParams; Body: HouseholdInput }>(personPath, { schema: { params, body: householdBody } }, async (request, reply) => {
    return mutate(request, reply, async (client, departmentId, current) => {
      if (current) return { status: 409, payload: { error: "This person already belongs to a household." } };
      const label = request.body.label.trim();
      if (!label) return { status: 400, payload: { error: "Enter a household label." } };
      const household: HouseholdRow = { id: randomUUID(), label, salutation: request.body.salutation?.trim() ?? "", postal_address: normalizePostalAddress(request.body.postalAddress) };
      await client.query(
        "INSERT INTO people_record_households(id,department_id,label,salutation,postal_address) VALUES($1,$2,$3,$4,$5::jsonb)",
        [household.id, departmentId, household.label, household.salutation, JSON.stringify(household.postal_address)],
      );
      await client.query("INSERT INTO people_record_household_members(department_id,contact_id,household_id) VALUES($1,$2,$3)", [departmentId, request.params.contactId, household.id]);
      await recordMembership(client, departmentId, request.params.contactId, request.authenticatedUser!.id, "household_linked", household);
      return { status: 201, payload: { id: household.id } };
    });
  });

  routes.put<{ Params: ContactParams; Body: { householdId: string } }>(personPath, { schema: { params, body: {
    type: "object", required: ["householdId"], additionalProperties: false, properties: { householdId: uuid },
  } } }, async (request, reply) => {
    return mutate(request, reply, async (client, departmentId, current) => {
      if (current?.id === request.body.householdId.toLowerCase()) return { status: 200, payload: { id: current.id } };
      if (current) return { status: 409, payload: { error: "Remove this person from their current household first." } };
      const target = await client.query<HouseholdRow>("SELECT id,label,salutation,postal_address FROM people_record_households WHERE department_id=$1 AND id=$2 FOR UPDATE", [departmentId, request.body.householdId]);
      const household = target.rows[0];
      if (!household) return { status: 404, payload: { error: "Household not found at this location." } };
      const size = await client.query<{ count: number }>("SELECT count(*)::int AS count FROM people_record_household_members WHERE department_id=$1 AND household_id=$2", [departmentId, household.id]);
      if (size.rows[0].count >= maxHouseholdMembers) return { status: 409, payload: { error: `A household can have up to ${maxHouseholdMembers} people.` } };
      await client.query("INSERT INTO people_record_household_members(department_id,contact_id,household_id) VALUES($1,$2,$3)", [departmentId, request.params.contactId, household.id]);
      await recordMembership(client, departmentId, request.params.contactId, request.authenticatedUser!.id, "household_linked", household);
      return { status: 200, payload: { id: household.id } };
    });
  });

  routes.patch<{ Params: ContactParams; Body: HouseholdInput }>(personPath, { schema: { params, body: householdBody } }, async (request, reply) => {
    return mutate(request, reply, async (client, departmentId, current) => {
      if (!current) return { status: 404, payload: { error: "This person does not belong to a household." } };
      const label = request.body.label.trim();
      if (!label) return { status: 400, payload: { error: "Enter a household label." } };
      const salutation = request.body.salutation?.trim() ?? current.salutation;
      const address = request.body.postalAddress === undefined ? current.postal_address : normalizePostalAddress(request.body.postalAddress);
      const update = await client.query(
        `UPDATE people_record_households SET label=$3,salutation=$4,postal_address=$5::jsonb,updated_at=now()
          WHERE id=$2 AND department_id=$1 AND (label,salutation,postal_address) IS DISTINCT FROM ($3,$4,$5::jsonb) RETURNING id`,
        [departmentId, current.id, label, salutation, JSON.stringify(address)],
      );
      if (update.rowCount) await client.query(
        `INSERT INTO people_record_history(id,department_id,contact_id,actor_user_id,action,subject,before_value,after_value)
           VALUES($1,$2,$3,$4,'household_updated',$5,$6::jsonb,$7::jsonb)`,
        [randomUUID(), departmentId, request.params.contactId, request.authenticatedUser!.id, label, JSON.stringify({ label: current.label }), JSON.stringify({ label })],
      );
      return { status: 200, payload: { id: current.id } };
    });
  });

  routes.delete<{ Params: ContactParams }>(personPath, { schema: { params } }, async (request, reply) => {
    return mutate(request, reply, async (client, departmentId, current) => {
      if (!current) return { status: 404, payload: { error: "This person does not belong to a household." } };
      await client.query("DELETE FROM people_record_household_members WHERE department_id=$1 AND contact_id=$2", [departmentId, request.params.contactId]);
      await recordMembership(client, departmentId, request.params.contactId, request.authenticatedUser!.id, "household_unlinked", current);
      return { status: 200, payload: { removed: true } };
    });
  });

  routes.get<{ Querystring: { contactIds: string; combineHouseholds?: boolean; skipIncomplete?: boolean } }>("/api/people-records/mailing-recipients.csv", {
    schema: { querystring: { type: "object", required: ["contactIds"], additionalProperties: false, properties: {
      contactIds: { type: "string", minLength: 36, maxLength: 3699 }, combineHouseholds: { type: "boolean" }, skipIncomplete: { type: "boolean" },
    } } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply);
    if (!departmentId) return reply;
    const contactIds = request.query.contactIds.toLowerCase().split(",");
    if (contactIds.length > 100 || new Set(contactIds).size !== contactIds.length || contactIds.some((id) => !uuidPattern.test(id))) {
      return reply.code(400).send({ error: "Select up to 100 different people." });
    }
    const { combineHouseholds = true, skipIncomplete = true } = request.query;
    const result = await pool!.query<{ name: string; household_id: string | null; household_label: string | null; salutation: string | null; address: PostalAddress; household_address: PostalAddress | null }>(
      `SELECT concat_ws(' ',contact.first_name,contact.last_name) AS name,contact.postal_address AS address,
              household.id AS household_id,household.label AS household_label,household.salutation,household.postal_address AS household_address
         FROM contacts contact
         LEFT JOIN people_record_household_members member ON member.contact_id=contact.id AND member.department_id=contact.department_id
         LEFT JOIN people_record_households household ON household.id=member.household_id AND household.department_id=member.department_id
        WHERE contact.department_id=$1 AND contact.id=ANY($2::uuid[]) AND contact.archived_at IS NULL
        ORDER BY lower(contact.last_name),lower(contact.first_name),contact.id`, [departmentId, contactIds],
    );
    if (result.rows.length !== contactIds.length) return reply.code(404).send({ error: "Select active people at this location." });
    const seen = new Set<string>();
    const lines = [["Recipient", "Salutation", "Street", "Additional line", "City", "Region", "Postal code", "Country"].map(csvCell).join(",")];
    let skipped = 0;
    for (const recipient of result.rows) {
      const householdId = combineHouseholds ? recipient.household_id : null;
      if (householdId && seen.has(householdId)) continue;
      if (householdId) seen.add(householdId);
      const address = normalizePostalAddress(householdId ? recipient.household_address : recipient.address);
      if (skipIncomplete && !completePostalAddress(address)) { skipped += 1; continue; }
      lines.push([
        householdId ? recipient.household_label ?? recipient.name : recipient.name,
        householdId ? recipient.salutation ?? "" : "",
        ...addressKeys.map((key) => address[key]),
      ].map(csvCell).join(","));
    }
    return reply.type("text/csv; charset=utf-8").header("content-disposition", "attachment; filename=mailing-recipients.csv")
      .header("cache-control", "private, no-store").header("x-exported-recipients", String(lines.length - 1))
      .header("x-skipped-recipients", String(skipped)).send("\uFEFF" + lines.join("\r\n"));
  });
}
