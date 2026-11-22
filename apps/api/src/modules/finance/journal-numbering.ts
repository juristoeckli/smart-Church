import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import type { ModuleServerContext } from "../module-sdk.js";

type Scope = (request: FastifyRequest,reply: FastifyReply,write?: boolean) => Promise<string|null>;
type Audit = (client: PoolClient,department: string,request: FastifyRequest,action: string,kind: string,id: string,details: Record<string,unknown>) => Promise<void>;

export const journalReceiptConflictMessage = "This receipt number is already allocated. Choose a different number.";
export function isJournalReceiptConflict(error: unknown) {
  return typeof error==="object" && error!==null && "constraint" in error && error.constraint==="finance_journal_receipt_allocated";
}
export async function allocateJournalNumber(client: PoolClient,department: string,year: number) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('finance-journal-numbering:'||$1::text||':'||$2::text))",[department,year]);
  const { rows:[sequence] } = await client.query<{ next_number:number }>(
    "SELECT next_number FROM finance_journal_numbering WHERE department_id=$1 AND accounting_year=$2 AND enabled FOR UPDATE",[department,year],
  );
  if (!sequence) return null;
  const { rows:[reservation] } = await client.query<{ number:number; receiptNumber:string }>(`
    SELECT candidate AS number, label AS "receiptNumber"
      FROM generate_series($3::int,least($3::int+9999,999999999)) candidate
      CROSS JOIN LATERAL (SELECT 'J-'||$2::smallint::text||'-'||lpad(candidate::text,greatest(6,length(candidate::text)),'0') AS label) formatted
     WHERE NOT EXISTS (SELECT 1 FROM finance_transactions t
       WHERE t.department_id=$1 AND t.accounting_year=$2 AND t.receipt_number=formatted.label)
     ORDER BY candidate LIMIT 1`,[department,year,sequence.next_number]);
  if (!reservation) return null;
  await client.query("UPDATE finance_journal_numbering SET next_number=$3 WHERE department_id=$1 AND accounting_year=$2",
    [department,year,reservation.number+1]);
  return reservation;
}

export function registerJournalNumbering(app: FastifyInstance,context: ModuleServerContext,scope: Scope,audit: Audit) {
  const { pool,lockDepartmentForWrite,validateMutation }=context;
  app.put<{ Params:{year:string};Body:{enabled:boolean} }>("/api/modules/finance/accounting-years/:year/journal-numbering",{
    schema:{
      params:{type:"object",additionalProperties:false,required:["year"],properties:{year:{type:"string",pattern:"^(19[0-9]{2}|20[0-9]{2}|21[0-9]{2}|2200)$"}}},
      body:{type:"object",additionalProperties:false,required:["enabled"],properties:{enabled:{type:"boolean"}}},
    },
  },async (request,reply) => {
    const department=await scope(request,reply,true);
    if (!department || !validateMutation(request,reply)) return reply;
    const year=Number(request.params.year),{enabled}=request.body;
    const client=await pool!.connect();
    try {
      await client.query("BEGIN");
      if (!await lockDepartmentForWrite(client,department)) {
        await client.query("ROLLBACK");
        return reply.code(423).send({error:"This location is read-only."});
      }
      const { rows:[period] }=await client.query<{status:string}>(
        "SELECT status FROM finance_accounting_years WHERE department_id=$1 AND accounting_year=$2 FOR SHARE",[department,year],
      );
      if (period?.status!=="open") {
        await client.query("ROLLBACK");
        return reply.code(409).send({error:"Choose an open accounting year at this location."});
      }
      const { rows }=await client.query(`
        INSERT INTO finance_journal_numbering(department_id,accounting_year,enabled) VALUES($1,$2,$3)
        ON CONFLICT(department_id,accounting_year) DO UPDATE SET enabled=EXCLUDED.enabled
        WHERE finance_journal_numbering.enabled IS DISTINCT FROM EXCLUDED.enabled RETURNING enabled`,
      [department,year,enabled]);
      if (rows.length) await audit(client,department,request,"journal_numbering_changed","accounting_year",department,{year,enabled});
      await client.query("COMMIT");
      return {enabled};
    } catch(error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  });
}
