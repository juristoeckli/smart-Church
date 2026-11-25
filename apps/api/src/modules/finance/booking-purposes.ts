import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import type { ModuleServerContext } from "../module-sdk.js";

type PurposeInput = {
  name: string; direction: "income" | "expense"; bankAccountId: string;
  counterAccountId: string; costCenterId: string; sortOrder: number; active: boolean;
};
type PurposeRow = PurposeInput & { id: string; usable: boolean };
type RouteContext = Pick<ModuleServerContext, "pool" | "validateMutation" | "lockDepartmentForWrite">;
type Dependencies = {
  department(request: FastifyRequest, reply: FastifyReply, write: boolean): Promise<string | null>;
  cleanText(value: string): string;
  audit(client: PoolClient, departmentId: string, request: FastifyRequest, action: string, kind: string, id: string, details: Record<string, unknown>): Promise<void>;
  publish(departmentId: string, action: string, id: string): void;
};

const uuid = { type: "string", format: "uuid" } as const;
const purposeSchema = {
  type: "object", additionalProperties: false,
  required: ["name", "direction", "bankAccountId", "counterAccountId", "costCenterId", "sortOrder", "active"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 120 }, direction: { type: "string", enum: ["income", "expense"] },
    bankAccountId: uuid, counterAccountId: uuid, costCenterId: uuid, sortOrder: { type: "integer", minimum: 0, maximum: 10000 },
    active: { type: "boolean" },
  },
} as const;
const purposeColumns = `purpose.id, purpose.name, purpose.direction, purpose.bank_account_id AS "bankAccountId",
  purpose.counter_account_id AS "counterAccountId", purpose.cost_center_id AS "costCenterId",
  purpose.sort_order AS "sortOrder", purpose.active,
  (purpose.active AND bank.active AND bank.account_type='asset' AND counter.active
    AND counter.account_type=purpose.direction AND center.active) AS usable`;
const purposeJoins = `FROM finance_booking_purposes purpose
  JOIN finance_accounts bank ON bank.department_id=purpose.department_id AND bank.id=purpose.bank_account_id
  JOIN finance_accounts counter ON counter.department_id=purpose.department_id AND counter.id=purpose.counter_account_id
  JOIN finance_cost_centers center ON center.department_id=purpose.department_id AND center.id=purpose.cost_center_id`;

export async function readBookingPurpose(client: PoolClient, departmentId: string, id: string) {
  const { rows: [purpose] } = await client.query<PurposeRow>(
    `SELECT ${purposeColumns} ${purposeJoins}
     WHERE purpose.department_id=$1 AND purpose.id=$2 FOR SHARE OF purpose,bank,counter,center`, [departmentId, id],
  );
  return purpose?.usable ? purpose : null;
}

export function registerBookingPurposes(app: FastifyInstance, context: RouteContext, deps: Dependencies) {
  const path = "/api/modules/finance/booking-purposes";
  const { pool, validateMutation, lockDepartmentForWrite } = context;
  const { department, cleanText, audit, publish } = deps;
  app.get(path, async (request, reply) => {
    const departmentId = await department(request, reply, true); if (!departmentId) return reply;
    return (await pool!.query<PurposeRow>(
      `SELECT ${purposeColumns} ${purposeJoins} WHERE purpose.department_id=$1
       ORDER BY purpose.active DESC,purpose.sort_order,lower(purpose.name),purpose.id`, [departmentId],
    )).rows;
  });

  async function write(request: FastifyRequest<{ Body: PurposeInput }>, reply: FastifyReply, id?: string) {
    const departmentId = await department(request, reply, true); if (!departmentId) return reply;
    if (!validateMutation(request, reply)) return reply;
    const purpose = { ...request.body, name: cleanText(request.body.name) };
    if (!purpose.name) return reply.code(400).send({ error: "Enter a booking purpose name." });

    const client = await pool!.connect();
    const recordId = id ?? randomUUID();
    try {
      await client.query("BEGIN");
      if (!await lockDepartmentForWrite(client, departmentId)) {
        await client.query("ROLLBACK");
        return reply.code(423).send({ error: "This location is read-only." });
      }
      const { rows: [previous] } = id
        ? await client.query<PurposeRow>(
          `SELECT ${purposeColumns} ${purposeJoins} WHERE purpose.department_id=$1 AND purpose.id=$2 FOR UPDATE OF purpose`, [departmentId, id],
        ) : { rows: [] };
      if (id && !previous) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Booking purpose not found." });
      }
      const sameReferences = previous && previous.direction === purpose.direction &&
        previous.bankAccountId === purpose.bankAccountId.toLowerCase() &&
        previous.counterAccountId === purpose.counterAccountId.toLowerCase() &&
        previous.costCenterId === purpose.costCenterId.toLowerCase();
      if (purpose.active || !sameReferences) {
        const references = await client.query(`
          SELECT 1 FROM finance_accounts bank
          JOIN finance_accounts counter ON counter.department_id=bank.department_id AND counter.id=$3
          JOIN finance_cost_centers center ON center.department_id=bank.department_id AND center.id=$4
          WHERE bank.department_id=$1 AND bank.id=$2 AND bank.active AND bank.account_type='asset'
            AND counter.active AND counter.account_type=$5 AND center.active
          FOR SHARE OF bank,counter,center`, [departmentId, purpose.bankAccountId, purpose.counterAccountId, purpose.costCenterId, purpose.direction],
        );
        if (!references.rowCount) {
          await client.query("ROLLBACK");
          return reply.code(400).send({ error: "Choose an active bank asset, a matching income or expense account, and an active cost center from this location." });
        }
      }
      const values = [departmentId, recordId, purpose.name, purpose.direction, purpose.bankAccountId, purpose.counterAccountId, purpose.costCenterId, purpose.sortOrder, purpose.active];
      if (id) {
        await client.query(`UPDATE finance_booking_purposes
          SET name=$3,direction=$4,bank_account_id=$5,counter_account_id=$6,cost_center_id=$7,sort_order=$8,active=$9,updated_at=now()
          WHERE department_id=$1 AND id=$2`, values);
      } else {
        await client.query(`INSERT INTO finance_booking_purposes(department_id,id,name,direction,bank_account_id,counter_account_id,cost_center_id,sort_order,active)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, values);
      }
      await audit(client, departmentId, request, id ? "booking_purpose_updated" : "booking_purpose_created", "booking_purpose", recordId,
        { ...purpose, ...(previous ? { previous } : {}) });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "23505") return reply.code(409).send({ error: "A booking purpose with this name already exists at this location." });
      throw error;
    } finally { client.release(); }
    publish(departmentId, "booking-purpose-updated", recordId);
    return reply.code(id ? 200 : 201).send({ id: recordId });
  }

  app.post<{ Body: PurposeInput }>(path, { schema: { body: purposeSchema } }, (request, reply) => write(request, reply));
  app.put<{ Params: { id: string }; Body: PurposeInput }>(path + "/:id", {
    schema: { body: purposeSchema, params: { type: "object", required: ["id"], properties: { id: uuid } } },
  }, (request, reply) => write(request, reply, request.params.id));
}
