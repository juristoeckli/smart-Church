import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import type { ModuleServerContext } from "../module-sdk.js";
import { readDraftProvenance, reviewChurchToolsDraft, type DraftHeader, type DraftLine } from "./draft-promotion.js";

type Department = (request: FastifyRequest, reply: FastifyReply, write?: boolean) => Promise<string | null>;
type Audit = (client: PoolClient, departmentId: string, request: FastifyRequest, action: string, kind: string, recordId: string, details: Record<string, unknown>) => Promise<void>;
const params = { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", format: "uuid" } } } as const;
const posted = "churchtools-journal-draft-posted";
const selectHeader = `SELECT id,booking_date::text AS "bookingDate",accounting_year AS "accountingYear",receipt_number AS "receiptNumber",
  booking_text AS "bookingText",status,reverses_transaction_id AS "reversesTransactionId" FROM finance_transactions WHERE department_id=$1 AND id=$2`;
const selectLines = `SELECT l.id,l.line_number,l.account_id,a.code AS account_code,a.name AS account_name,a.account_type,a.active AS account_active,
  l.cost_center_id,l.donor_id,l.debit_cents,l.credit_cents,l.line_text FROM finance_transaction_lines l
  JOIN finance_accounts a ON a.department_id=l.department_id AND a.id=l.account_id
  WHERE l.department_id=$1 AND l.transaction_id=$2 ORDER BY l.line_number`;
const selectCurrency = "SELECT currency_code FROM finance_settings WHERE department_id=$1";
const selectYears = `SELECT accounting_year,status FROM finance_accounting_years WHERE department_id=$1 AND start_date<=$2::date AND end_date>=$2::date`;
const selectDuplicates = "SELECT 1 FROM finance_transactions WHERE department_id=$1 AND accounting_year=$2 AND receipt_number=$3 AND id<>$4 LIMIT 1";
type Year = { accounting_year: number; status: string };

export function registerChurchToolsDraftPromotion(app: FastifyInstance, context: ModuleServerContext, department: Department, audit: Audit) {
  const { pool, validateMutation, lockDepartmentForWrite } = context;
  app.get<{ Params: { id: string } }>("/api/modules/finance/transactions/:id/draft-review", { schema: { params } }, async (request, reply) => {
    const departmentId = await department(request, reply, true);
    if (!departmentId) return reply;
    const { id } = request.params;
    const header = (await pool!.query<DraftHeader>(selectHeader, [departmentId, id])).rows[0];
    if (!header) return reply.code(404).send({ error: "Transaction not found." });
    const [source, lines, settings, years, duplicate] = await Promise.all([
      readDraftProvenance(pool!, departmentId, id),
      pool!.query<DraftLine>(selectLines, [departmentId, id]),
      pool!.query<{ currency_code: string }>(selectCurrency, [departmentId]),
      pool!.query<Year>(selectYears, [departmentId, header.bookingDate]),
      pool!.query(selectDuplicates, [departmentId, header.accountingYear, header.receiptNumber, id]),
    ]);
    const review = source && reviewChurchToolsDraft(header, lines.rows, settings.rows[0]?.currency_code.trim() ?? "CHF", source);
    if (!review) return reply.code(409).send({ error: "Only an eligible linked ChurchTools draft can use this review action." });
    if (years.rows.length !== 1 || years.rows[0].accounting_year !== header.accountingYear || years.rows[0].status !== "open") {
      return reply.code(409).send({ error: "The draft must still belong to the same open accounting period." });
    }
    if (duplicate.rowCount) return reply.code(409).send({ error: "This receipt number is already used in the accounting period." });
    return reply.header("Cache-Control", "private, no-store").send({
      ...review, bookingDate: header.bookingDate, accountingYear: header.accountingYear, receiptNumber: header.receiptNumber, bookingText: header.bookingText,
      lines: lines.rows.map((line) => ({ accountCode: line.account_code, accountName: line.account_name, accountType: line.account_type,
        debitMinor: String(line.debit_cents), creditMinor: String(line.credit_cents), text: line.line_text })),
    });
  });
  app.post<{ Params: { id: string }; Body: { reviewHash: string } }>("/api/modules/finance/transactions/:id/post-draft", {
    schema: { params, body: { type: "object", additionalProperties: false, required: ["reviewHash"],
      properties: { reviewHash: { type: "string", pattern: "^[a-f0-9]{64}$" } },
    } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply, true);
    if (!departmentId || !validateMutation(request, reply)) return reply;
    const { id } = request.params;
    const { reviewHash } = request.body;
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '5s'");
      if (!await lockDepartmentForWrite(client, departmentId)) {
        await client.query("ROLLBACK");
        return reply.code(423).send({ error: "This location is read-only while it is a redundancy standby or fenced site." });
      }
      const initial = (await client.query<DraftHeader>(selectHeader, [departmentId, id])).rows[0];
      if (!initial) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Transaction not found." }); }
      const source = await readDraftProvenance(client, departmentId, id, true);
      if (!source) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "Only a linked ChurchTools journal draft can use this review action." }); }
      // Match year-end locking order before freezing receipt conflicts across the ledger.
      const years = initial.status === "draft" ? await client.query<Year>(selectYears + " FOR SHARE", [departmentId, initial.bookingDate]) : null;
      await client.query("LOCK TABLE finance_transactions IN SHARE ROW EXCLUSIVE MODE");
      const current = (await client.query<DraftHeader>(selectHeader + " FOR UPDATE", [departmentId, id])).rows[0];
      if (current?.status === "posted") {
        const prior = await client.query("SELECT 1 FROM finance_audit WHERE department_id=$1 AND record_kind='transaction' AND record_id=$2 AND action=$3 AND details->>'reviewHash'=$4",
          [departmentId, id, posted, reviewHash]);
        await client.query("COMMIT");
        return prior.rowCount
          ? reply.header("Cache-Control", "private, no-store").send({ id, status: "posted", replayed: true })
          : reply.code(409).send({ error: "This transaction is already posted." });
      }
      if (!current || !years || years.rows.length !== 1 || years.rows[0].status !== "open" || years.rows[0].accounting_year !== current.accountingYear
        || current.bookingDate !== initial.bookingDate) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "The draft must still belong to the same open accounting period." });
      }
      const duplicate = await client.query(selectDuplicates,
        [departmentId, current.accountingYear, current.receiptNumber, id]);
      if (duplicate.rowCount) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "This receipt number is already used in the accounting period." }); }
      await client.query("LOCK TABLE finance_settings IN SHARE MODE");
      await client.query("LOCK TABLE finance_transaction_lines IN SHARE MODE");
      const currency = (await client.query<{ currency_code: string }>(selectCurrency, [departmentId])).rows[0]?.currency_code.trim() ?? "CHF";
      const lines = await client.query<DraftLine>(selectLines + " FOR SHARE OF l,a", [departmentId, id]);
      const review = reviewChurchToolsDraft(current, lines.rows, currency, source);
      if (!review || review.reviewHash !== reviewHash) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "The draft changed or its posting lines are no longer eligible. Open its details again before posting." });
      }
      await client.query("UPDATE finance_transactions SET status='posted' WHERE department_id=$1 AND id=$2 AND status='draft'", [departmentId, id]);
      await audit(client, departmentId, request, posted, "transaction", id, {
        ...source, reviewHash, currency, accountingYear: current.accountingYear, debitMinor: review.debitMinor, creditMinor: review.creditMinor,
      });
      await client.query("COMMIT");
      return reply.header("Cache-Control", "private, no-store").send({ id, status: "posted", replayed: false });
    } catch (error) {
      await client.query("ROLLBACK");
      if (error && typeof error === "object" && "code" in error && error.code === "55P03") return reply.code(409).send({ error: "The journal is busy. Retry this reviewed draft." });
      throw error;
    } finally { client.release(); }
  });
}
