import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import type { ModuleServerContext } from "../module-sdk.js";

type Transfer = {
  submissionId: string; bookingDate: string; receiptNumber: string; bookingText: string; accountId: string;
  fromCostCenterId: string; toCostCenterId: string; amountCents: number;
};
type Previous = {
  accountingYear: number; bookingDate: string; receiptNumber: string; bookingText: string;
  creator: string | null; transfer: boolean; metadata: Record<string,unknown> | null;
};
type Hooks = {
  department: (request: FastifyRequest,reply: FastifyReply,write: boolean) => Promise<string | null>;
  audit: (client: PoolClient,id: string,request: FastifyRequest,action: string,kind: string,recordId: string,details: Record<string,unknown>) => Promise<void>;
  publish: (departmentId: string,action: string,recordId: string) => void;
  periodForDate: (client: PoolClient,departmentId: string,date: string) => Promise<{ rows: { accounting_year: number; status: string }[] }>;
  cleanText: (value: string) => string;
  validDateOnly: (value: string) => boolean;
};

const uuid = { type: "string", format: "uuid" } as const;
const schema = { body: { type:"object",additionalProperties:false,
  required:["submissionId","bookingDate","receiptNumber","bookingText","accountId","fromCostCenterId","toCostCenterId","amountCents"],
  properties:{
    submissionId:uuid,bookingDate:{type:"string",format:"date"},receiptNumber:{type:"string",minLength:1,maxLength:80},
    bookingText:{type:"string",minLength:1,maxLength:500},accountId:uuid,fromCostCenterId:uuid,toCostCenterId:uuid,
    amountCents:{type:"integer",minimum:1,maximum:9000000000000000},
  } } } as const;

export function registerCostCenterTransfers(app: FastifyInstance, context: ModuleServerContext, hooks: Hooks) {
  const { pool, lockDepartmentForWrite, validateMutation } = context;
  app.post<{ Body: Transfer }>("/api/modules/finance/transactions/cost-center-transfer",{ schema },async (request,reply) => {
    const departmentId = await hooks.department(request,reply,true);
    if (!departmentId || !validateMutation(request,reply)) return reply;
    const input = request.body;
    const id = input.submissionId.toLowerCase();
    const from = input.fromCostCenterId.toLowerCase(),to = input.toCostCenterId.toLowerCase(),accountId = input.accountId.toLowerCase();
    const receiptNumber = hooks.cleanText(input.receiptNumber),bookingText = hooks.cleanText(input.bookingText);
    const { bookingDate,amountCents } = input;
    if (!receiptNumber || !bookingText || !hooks.validDateOnly(bookingDate) || bookingDate.startsWith("0000-") || from===to) {
      return reply.code(400).send({ error:"Choose a valid date, booking text and receipt number, and two distinct cost centers." });
    }
    const metadata = { accountId, fromCostCenterId:from, toCostCenterId:to, amountCents };
    const actor = request.authenticatedUser!.id;
    const result = (accountingYear: number) => ({ id,accountingYear,bookingDate,receiptNumber,bookingText,
      status:"posted",debitCents:amountCents,creditCents:amountCents,isCostCenterTransfer:true });
    const client = await pool!.connect();
    const rollback = async (status: number,error: string) => {
      await client.query("ROLLBACK");
      return reply.code(status).send({error});
    };
    try {
      await client.query("BEGIN");
      if (!await lockDepartmentForWrite(client,departmentId)) return await rollback(423,"This location is read-only.");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[departmentId]);
      const { rows:[prior] } = await client.query<Previous>(`
        SELECT t.accounting_year AS "accountingYear",to_char(t.booking_date,'YYYY-MM-DD') AS "bookingDate",
          t.receipt_number AS "receiptNumber",t.booking_text AS "bookingText",t.created_by AS creator,t.is_cost_center_transfer AS transfer,
          (SELECT a.details FROM finance_audit a
            WHERE a.department_id=t.department_id AND a.record_kind='transaction' AND a.record_id=t.id
              AND a.action='cost_center_transfer_posted'
            ORDER BY a.created_at,a.id LIMIT 1) AS metadata
        FROM finance_transactions t WHERE t.department_id=$1 AND t.id=$2`,[departmentId,id]);
      if (prior) {
        if (!prior.transfer || prior.creator!==actor || prior.bookingDate!==bookingDate || prior.receiptNumber!==receiptNumber
          || prior.bookingText!==bookingText || !Object.entries(metadata).every(([key,value]) => prior.metadata?.[key]===value)) {
          return await rollback(409,"This submission was already used. Open a new transfer to post another entry.");
        }
        await client.query("COMMIT");
        return reply.send(result(prior.accountingYear));
      }
      const { rows:[period] } = await hooks.periodForDate(client,departmentId,bookingDate);
      if (period?.status!=="open") return await rollback(409,"The booking date must fall within an open configured accounting year.");
      const account = await client.query("SELECT id FROM finance_accounts WHERE department_id=$1 AND id=$2 AND active AND account_type IN ('asset','liability','equity') FOR SHARE",[departmentId,accountId]);
      if (!account.rows[0]) return await rollback(400,"Choose an active balance-sheet clearing account from this location.");
      const centers = await client.query("SELECT id FROM finance_cost_centers WHERE department_id=$1 AND id=ANY($2::uuid[]) AND active ORDER BY id FOR SHARE",[departmentId,[from,to]]);
      if (centers.rows.length!==2) return await rollback(400,"Choose two active cost centers from this location.");
      const inserted = await client.query(`
        INSERT INTO finance_transactions(id,department_id,booking_date,accounting_year,receipt_number,booking_text,created_by,is_cost_center_transfer)
        VALUES($1,$2,$3,$4,$5,$6,$7,true) ON CONFLICT (id) DO NOTHING RETURNING id`,
        [id,departmentId,bookingDate,period.accounting_year,receiptNumber,bookingText,actor]);
      if (!inserted.rows[0]) return await rollback(409,"This submission was already used. Open a new transfer to post another entry.");
      await client.query(`
        INSERT INTO finance_transaction_lines(id,department_id,transaction_id,line_number,account_id,cost_center_id,debit_cents,credit_cents)
        VALUES($1,$3,$4,1,$5,$6,$8,0),($2,$3,$4,2,$5,$7,0,$8)`,
        [randomUUID(),randomUUID(),departmentId,id,accountId,from,to,amountCents]);
      await hooks.audit(client,departmentId,request,"cost_center_transfer_posted","transaction",id,{ ...metadata,bookingDate,accountingYear:period.accounting_year });
      await client.query("COMMIT");
      hooks.publish(departmentId,"transaction-posted",id);
      return reply.code(201).send(result(period.accounting_year));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
}
