import { financePdf } from "./pdf.js";
import { financeWorkbook } from "./workbook.js";
import { registerChurchToolsDraftPromotion } from "./draft-promotion-routes.js";
import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import type { ModuleServerContext } from "../module-sdk.js";

type FinanceLineInput = { accountId: string; costCenterId?: string | null; donorId?: string | null; debitCents: number; creditCents: number; text?: string };
type FinanceTransactionBody = { bookingDate: string; receiptNumber: string; bookingText: string; lines: FinanceLineInput[] };
type FinanceLineRow = { id: string; line_number: number; account_id: string; account_code: string; account_name: string; account_type: string; cost_center_id: string | null; cost_center_name: string | null; donor_id: string | null; donor_name: string | null; debit_cents: string | number; credit_cents: string | number; line_text: string };

const uuid = { type: "string", format: "uuid" } as const;
const lineSchema = {
  type: "object", additionalProperties: false,
  required: ["accountId", "debitCents", "creditCents"],
  properties: { accountId: uuid, costCenterId: { anyOf: [uuid, { type: "null" }] }, donorId: { anyOf: [uuid, { type: "null" }] }, debitCents: { type: "integer", minimum: 0, maximum: 9000000000000000 }, creditCents: { type: "integer", minimum: 0, maximum: 9000000000000000 }, text: { type: "string", maxLength: 500 } },
} as const;
const transactionSchema = {
  type: "object", additionalProperties: false, required: ["bookingDate", "receiptNumber", "bookingText", "lines"],
  properties: { bookingDate: { type: "string", format: "date" }, receiptNumber: { type: "string", minLength: 1, maxLength: 80 }, bookingText: { type: "string", minLength: 1, maxLength: 500 }, lines: { type: "array", minItems: 2, maxItems: 100, items: lineSchema } },
} as const;

function cleanText(value: string) { return value.trim().replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " "); }
function validDateOnly(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function csvCell(value: unknown) {
  const text = String(value ?? "");
  const safeText = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}
function sendFinanceExport(request: FastifyRequest, reply: FastifyReply, filename: string, header: string[], rows: unknown[][]) {
  if ((request.params as { format?: string }).format === "pdf") {
    return reply.type("application/pdf")
      .header("Cache-Control", "private, no-store")
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Disposition", `attachment; filename=${filename}.pdf`)
      .send(financePdf(filename.replace(/-/g, " "), header, rows));
  }
  if ((request.params as { format?: string }).format === "xlsx") {
    return reply.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("Content-Disposition", `attachment; filename=${filename}.xlsx`)
      .send(financeWorkbook(header, rows));
  }
  if ((request.params as { format?: string }).format === "html") {
    const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
    const title = filename.replace(/-/g, " ");
    const columns = header.map((value) => `<th scope="col">${escape(value)}</th>`).join("");
    const body = rows.map((row) => `<tr>${row.map((value) => `<td>${escape(value)}</td>`).join("")}</tr>`).join("");
    return reply.type("text/html; charset=utf-8")
      .header("Cache-Control", "private, no-store")
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Disposition", `attachment; filename=${filename}.html`)
      .send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
        <meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title>
        <style>@page{size:landscape;margin:12mm}body{font:14px system-ui,sans-serif;color:#111}h1{text-transform:capitalize}table{border-collapse:collapse;width:100%}th,td{border:1px solid #777;padding:5px;text-align:left;overflow-wrap:anywhere}thead{display:table-header-group}tr{break-inside:avoid}@media print{.hint{display:none}body{font-size:10pt}}</style>
        </head><body><main><h1>${escape(title)}</h1><p class="hint">Use your browser’s Print command to print or save as PDF.</p>
        <table><thead><tr>${columns}</tr></thead><tbody>${body}</tbody></table>${rows.length ? "" : "<p>No matching entries.</p>"}</main></body></html>`);
  }
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  return reply.type("text/csv; charset=utf-8").header("Content-Disposition", `attachment; filename=${filename}.csv`).send(`\uFEFF${csv}`);
}
function asMoney(value: string | number) { const number = Number(value); return Number.isSafeInteger(number) ? number : 0; }

function parseCsvRows(csv: string): string[][] | string {
  if (typeof csv !== "string" || csv.length > 2_000_000) return "CSV must be 2 MiB or smaller.";
  const firstLine = csv.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = []; let cell = ""; let quoted = false;
  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i]!;
    if (quoted) {
      if (char === '"' && csv[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
      continue;
    }
    if (char === '"' && cell.length === 0) quoted = true;
    else if (char === delimiter) { row.push(cell); cell = ""; }
    else if (char === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += char;
    if (rows.length > 20_001) return "A statement can contain at most 20,000 rows.";
  }
  if (quoted) return "CSV contains an unclosed quoted field.";
  if (cell.length || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
  while (rows.length && rows.at(-1)!.every((value) => !value.trim())) rows.pop();
  if (rows.length < 2) return "CSV needs a header and at least one statement row.";
  const width = rows[0]!.length;
  if (width < 2 || width > 50 || rows.some((value) => value.length !== width)) return "CSV rows must have the same 2 to 50 columns.";
  return rows;
}

function statementDate(value: string): string | null {
  const clean = value.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(clean);
  const euro = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(clean);
  if (!iso && !euro) return null;
  const year = Number(iso?.[1] ?? euro?.[3]); const month = Number(iso?.[2] ?? euro?.[2]); const day = Number(iso?.[3] ?? euro?.[1]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1900 && year <= 2200 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date.toISOString().slice(0, 10) : null;
}

function statementAmount(value: string): number | null {
  let clean = value.trim().replace(/[\s'’]/g, "");
  const negative = /^\(.*\)$/.test(clean) || clean.startsWith("-");
  clean = clean.replace(/[()]/g, "").replace(/^[+-]/, "");
  if (clean.includes(",") && clean.includes(".")) {
    if (clean.lastIndexOf(",") > clean.lastIndexOf(".")) clean = clean.replace(/\./g, "").replace(",", ".");
    else clean = clean.replace(/,/g, "");
  } else if (clean.includes(",")) {
    const tail = clean.split(",").at(-1) ?? "";
    clean = tail.length <= 2 ? clean.replace(/\./g, "").replace(",", ".") : clean.replace(/,/g, "");
  } else if ((clean.match(/\./g)?.length ?? 0) > 1) {
    const lastDot = clean.lastIndexOf("."); clean = clean.slice(0, lastDot).replace(/\./g, "") + clean.slice(lastDot);
  }
  if (!/^\d+(?:\.\d{1,2})?$/.test(clean)) return null;
  const cents = Math.round(Number(clean) * 100) * (negative ? -1 : 1);
  return Number.isSafeInteger(cents) && cents !== 0 ? cents : null;
}

const transactionFilterIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const transactionDonorFilter = "AND ($6::uuid IS NULL OR EXISTS (SELECT 1 FROM finance_transaction_lines donor_line JOIN finance_donors donor ON donor.department_id=donor_line.department_id AND donor.id=donor_line.donor_id WHERE donor_line.department_id=t.department_id AND donor_line.transaction_id=t.id AND donor.id=$6))";
const transactionAccountFilter = "AND ($7::uuid IS NULL OR EXISTS (SELECT 1 FROM finance_transaction_lines account_line JOIN finance_accounts account ON account.department_id=account_line.department_id AND account.id=account_line.account_id WHERE account_line.department_id=t.department_id AND account_line.transaction_id=t.id AND account.id=$7))";
type TransactionOrderQuery = { sort?: string; direction?: string };
function transactionOrder(query: TransactionOrderQuery, forExport: boolean) {
  const group = forExport ? " OVER (PARTITION BY t.id)" : "";
  const columns: Record<string, string> = {
    date: "t.booking_date",
    receipt: "lower(t.receipt_number)",
    description: "lower(t.booking_text)",
    debit: "COALESCE(sum(l.debit_cents)" + group + ",0)",
    credit: "COALESCE(sum(l.credit_cents)" + group + ",0)",
    status: "t.status",
  };
  if (!query.sort || !Object.hasOwn(columns, query.sort)) {
    return forExport ? "t.booking_date,t.created_at,t.id,l.line_number" : "t.booking_date DESC,t.created_at DESC,t.id DESC";
  }
  const direction = query.direction === "asc" ? "ASC" : "DESC";
  return columns[query.sort] + " " + direction + ",t.created_at DESC,t.id DESC" + (forExport ? ",l.line_number" : "");
}

export function registerModuleRoutes(app: FastifyInstance, context: ModuleServerContext) {
  const { pool, isDatabaseReady, resolveDepartmentId, validateMutation, realtime } = context;

  async function department(request: FastifyRequest, reply: FastifyReply, write = false) {
    if (!pool || !isDatabaseReady()) { reply.code(503).send({ error: "Finance is unavailable because the database is not ready." }); return null; }
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return null;
    const grants = request.activeDepartmentModulePermissions?.finance ?? [];
    const allowed = request.activeDepartmentRole === "site_admin" || (write ? grants.includes("manage") : grants.includes("view") || grants.includes("manage"));
    if (!allowed) { reply.code(403).send({ error: write ? "Finance management access is required." : "Finance view access is required." }); return null; }
    return departmentId;
  }

  async function audit(client: PoolClient, departmentId: string, request: FastifyRequest, action: string, recordKind: string, recordId: string, details: Record<string, unknown> = {}) {
    await client.query("INSERT INTO finance_audit(id,department_id,actor_user_id,action,record_kind,record_id,details) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)", [randomUUID(), departmentId, request.authenticatedUser?.id ?? null, action, recordKind, recordId, JSON.stringify(details)]);
  }

  registerChurchToolsDraftPromotion(app, context, department, audit);

  function publish(departmentId: string, action: string, recordId: string) {
    realtime.publish("module:finance:changed", departmentId, { action, recordId, changedAt: new Date().toISOString() });
  }

  function receiptPeriod(input: { year?: unknown; from?: unknown; to?: unknown }) {
    const year = typeof input.year === "number" ? input.year : typeof input.year === "string" && /^\d{4}$/.test(input.year) ? Number(input.year) : NaN;
    if (!Number.isInteger(year) || year < 1900 || year > 2200) return null;
    const from = typeof input.from === "string" ? input.from : `${year}-01-01`;
    const to = typeof input.to === "string" ? input.to : `${year}-12-31`;
    const dateOk = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + "T00:00:00Z")) && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
    if (!dateOk(from) || !dateOk(to) || from > to) return null;
    return { year, from, to };
  }

  async function periodForDate(client: PoolClient, departmentId: string, date: string) {
    return client.query<{ accounting_year: number; status: string }>("SELECT accounting_year,status FROM finance_accounting_years WHERE department_id=$1 AND start_date<=$2::date AND end_date>=$2::date FOR SHARE", [departmentId, date]);
  }

  async function receiptPeriodForLocation(departmentId: string, input: { year?: unknown; from?: unknown; to?: unknown }) {
    const period = receiptPeriod(input);
    if (!period || (typeof input.from === "string" && typeof input.to === "string")) return period;
    const configured = await pool!.query<{ from: string; to: string }>("SELECT start_date::text AS \"from\",end_date::text AS \"to\" FROM finance_accounting_years WHERE department_id=$1 AND accounting_year=$2", [departmentId, period.year]);
    return configured.rowCount ? { ...period, from: typeof input.from === "string" ? period.from : configured.rows[0]!.from, to: typeof input.to === "string" ? period.to : configured.rows[0]!.to } : period;
  }

  async function eligibleReceipts(departmentId: string, from: string, to: string, donorId?: string) {
    return pool!.query<{ donorId: string; donorName: string; donorEmail: string; amountCents: string; transactionIds: string[] }>(
      `SELECT d.id AS "donorId",d.display_name AS "donorName",d.email AS "donorEmail",
              sum(l.credit_cents-l.debit_cents)::text AS "amountCents",
              array_agg(DISTINCT t.id ORDER BY t.id) AS "transactionIds"
         FROM finance_donors d
         JOIN finance_transaction_lines l ON l.department_id=d.department_id AND l.donor_id=d.id
         JOIN finance_transactions t ON t.department_id=l.department_id AND t.id=l.transaction_id AND t.status='posted'
         JOIN finance_accounts a ON a.department_id=l.department_id AND a.id=l.account_id AND a.account_type='income'
        WHERE d.department_id=$1 AND d.active=true AND t.booking_date BETWEEN $2::date AND $3::date
          AND ($4::uuid IS NULL OR d.id=$4::uuid)
        GROUP BY d.id,d.display_name,d.email
       HAVING sum(l.credit_cents-l.debit_cents)>0
        ORDER BY lower(d.display_name),d.id LIMIT 1000`, [departmentId, from, to, donorId ?? null],
    );
  }

  function renderReceiptText(template: string, replacements: Record<string, string>) {
    return template.replace(/\{\{(donorName|period|amount|currency|organization)\}\}/g, (_match, key: string) => replacements[key] ?? "");
  }

  function escapeHtml(value: string) {
    const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };
    return value.replace(/[&<>"']/g, (character) => entities[character]!);
  }

  type TaxTypeInput = { code: string; name: string; rateBasisPoints: number | null };
  app.post<{ Body: TaxTypeInput }>("/api/modules/finance/tax-types", {
    schema: { body: { type: "object", additionalProperties: false, required: ["code", "name", "rateBasisPoints"], properties: {
      code: { type: "string", minLength: 1, maxLength: 32 },
      name: { type: "string", minLength: 1, maxLength: 160 },
      rateBasisPoints: { anyOf: [{ type: "integer", minimum: 0, maximum: 10000 }, { type: "null" }] },
    } } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply, true);
    if (!departmentId || !validateMutation(request, reply)) return reply;
    const code = cleanText(request.body.code);
    const name = cleanText(request.body.name);
    if (!code || !name) return reply.code(400).send({ error: "Tax type code and name are required." });
    const id = randomUUID();
    const result = await pool!.query(
      "INSERT INTO finance_tax_types(id,department_id,code,name,rate_basis_points) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id",
      [id, departmentId, code, name, request.body.rateBasisPoints],
    );
    if (!result.rowCount) return reply.code(409).send({ error: "Tax type code already exists." });
    publish(departmentId, "tax-type-created", id);
    return reply.code(201).send({ id });
  });

  app.patch<{ Params: { id: string }; Body: { active: boolean } }>("/api/modules/finance/tax-types/:id", {
    schema: {
      params: { type: "object", required: ["id"], properties: { id: uuid } },
      body: { type: "object", additionalProperties: false, required: ["active"], properties: { active: { type: "boolean" } } },
    },
  }, async (request, reply) => {
    const departmentId = await department(request, reply, true);
    if (!departmentId || !validateMutation(request, reply)) return reply;
    const result = await pool!.query(
      "UPDATE finance_tax_types SET active=$3,updated_at=now() WHERE department_id=$1 AND id=$2 RETURNING id",
      [departmentId, request.params.id, request.body.active],
    );
    if (!result.rowCount) return reply.code(404).send({ error: "Tax type not found." });
    publish(departmentId, "tax-type-updated", request.params.id);
    return { updated: true };
  });

  app.get("/api/modules/finance/bootstrap", async (request, reply) => {
    const departmentId = await department(request, reply);
    if (!departmentId) return reply;
    const [settings, accounts, costCenters, donors, years, budgets, accountingYears, taxTypes] = await Promise.all([
      pool!.query("SELECT currency_code AS \"currencyCode\" FROM finance_settings WHERE department_id=$1", [departmentId]),
      pool!.query("SELECT id,code,name,account_type AS \"accountType\",active FROM finance_accounts WHERE department_id=$1 ORDER BY code", [departmentId]),
      pool!.query("SELECT id,code,name,active FROM finance_cost_centers WHERE department_id=$1 ORDER BY code", [departmentId]),
      pool!.query(`SELECT d.id,d.donor_type AS "donorType",d.display_name AS "displayName",d.email,d.active,
        COALESCE((SELECT sum(l.credit_cents-l.debit_cents) FROM finance_transaction_lines l JOIN finance_transactions t ON t.id=l.transaction_id AND t.department_id=l.department_id JOIN finance_accounts a ON a.id=l.account_id AND a.department_id=l.department_id WHERE l.department_id=d.department_id AND l.donor_id=d.id AND a.account_type='income' AND t.status='posted'),0)::text AS "totalGiftsCents",
        (SELECT max(t.booking_date) FROM finance_transaction_lines l JOIN finance_transactions t ON t.id=l.transaction_id AND t.department_id=l.department_id JOIN finance_accounts a ON a.id=l.account_id AND a.department_id=l.department_id WHERE l.department_id=d.department_id AND l.donor_id=d.id AND l.credit_cents>0 AND a.account_type='income' AND t.status='posted') AS "latestGiftDate"
        FROM finance_donors d WHERE d.department_id=$1 ORDER BY d.display_name LIMIT 2000`, [departmentId]),
      pool!.query("SELECT accounting_year AS year FROM finance_accounting_years WHERE department_id=$1 UNION SELECT DISTINCT accounting_year AS year FROM finance_transactions WHERE department_id=$1 UNION SELECT DISTINCT accounting_year AS year FROM finance_budgets WHERE department_id=$1 ORDER BY year DESC", [departmentId]),
      pool!.query(`SELECT b.id,b.accounting_year AS "accountingYear",b.account_id AS "accountId",a.code AS "accountCode",a.name AS "accountName",b.cost_center_id AS "costCenterId",c.code AS "costCenterCode",c.name AS "costCenterName",b.amount_cents AS "amountCents",b.note FROM finance_budgets b LEFT JOIN finance_accounts a ON a.id=b.account_id AND a.department_id=b.department_id LEFT JOIN finance_cost_centers c ON c.id=b.cost_center_id AND c.department_id=b.department_id WHERE b.department_id=$1 ORDER BY b.accounting_year DESC,a.code,c.code`, [departmentId]),
      pool!.query(`SELECT accounting_year AS "accountingYear",label,start_date AS "startDate",end_date AS "endDate",status FROM finance_accounting_years WHERE department_id=$1 ORDER BY start_date DESC`, [departmentId]),
      pool!.query('SELECT id,code,name,active,rate_basis_points AS "rateBasisPoints" FROM finance_tax_types WHERE department_id=$1 ORDER BY active DESC,lower(code),id', [departmentId]),
    ]);
    return { currency: settings.rows[0]?.currencyCode ?? "CHF", accounts: accounts.rows, costCenters: costCenters.rows, donors: donors.rows, years: years.rows.map((row) => Number(row.year)), accountingYears: accountingYears.rows, budgets: budgets.rows, taxTypes: taxTypes.rows };
  });

  app.post<{ Body: { accountingYear: number; label: string; startDate: string; endDate: string } }>("/api/modules/finance/accounting-years", { schema: { body: { type: "object", additionalProperties: false, required: ["accountingYear", "label", "startDate", "endDate"], properties: { accountingYear: { type: "integer", minimum: 1900, maximum: 2200 }, label: { type: "string", minLength: 1, maxLength: 120 }, startDate: { type: "string", format: "date" }, endDate: { type: "string", format: "date" } } } } }, async (request, reply) => {
    const departmentId = await department(request, reply, true); if (!departmentId) return reply; if (!validateMutation(request, reply)) return reply;
    const label = cleanText(request.body.label); if (!label || request.body.startDate > request.body.endDate) return reply.code(400).send({ error: "Enter a label and a valid date range." });
    const client = await pool!.connect(); const id = String(request.body.accountingYear);
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [departmentId]);
      const overlap = await client.query("SELECT 1 FROM finance_accounting_years WHERE department_id=$1 AND start_date<=$3::date AND end_date>=$2::date LIMIT 1", [departmentId, request.body.startDate, request.body.endDate]);
      if (overlap.rowCount) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "Accounting year dates cannot overlap another configured year." }); }
      const result = await client.query("INSERT INTO finance_accounting_years(department_id,accounting_year,label,start_date,end_date,status,created_by,updated_by) VALUES($1,$2,$3,$4,$5,'open',$6,$6) ON CONFLICT DO NOTHING RETURNING accounting_year AS \"accountingYear\",label,start_date AS \"startDate\",end_date AS \"endDate\",status", [departmentId, request.body.accountingYear, label, request.body.startDate, request.body.endDate, request.authenticatedUser?.id ?? null]);
      if (!result.rowCount) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "That accounting year already exists." }); }
      await audit(client, departmentId, request, "accounting_year_created", "accounting_year", id, { label, startDate: request.body.startDate, endDate: request.body.endDate });
      await client.query("COMMIT"); publish(departmentId, "accounting-year-created", id); return reply.code(201).send(result.rows[0]);
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  });

  app.patch<{ Params: { year: string }; Body: { label: string; startDate: string; endDate: string; status: "open" | "closed" } }>("/api/modules/finance/accounting-years/:year", { schema: { params: { type: "object", additionalProperties: false, required: ["year"], properties: { year: { type: "string", pattern: "^(19[0-9]{2}|20[0-9]{2}|21[0-9]{2}|2200)$" } } }, body: { type: "object", additionalProperties: false, required: ["label", "startDate", "endDate", "status"], properties: { label: { type: "string", minLength: 1, maxLength: 120 }, startDate: { type: "string", format: "date" }, endDate: { type: "string", format: "date" }, status: { type: "string", enum: ["open", "closed"] } } } } }, async (request, reply) => {
    const departmentId = await department(request, reply, true); if (!departmentId) return reply; if (!validateMutation(request, reply)) return reply;
    const label = cleanText(request.body.label); if (!label || request.body.startDate > request.body.endDate) return reply.code(400).send({ error: "Enter a label and a valid date range." });
    const client = await pool!.connect();
    try {
      await client.query("BEGIN"); await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [departmentId]);
      const existing = await client.query("SELECT accounting_year,label,start_date::text,end_date::text,status FROM finance_accounting_years WHERE department_id=$1 AND accounting_year=$2 FOR UPDATE", [departmentId, Number(request.params.year)]);
      if (!existing.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Accounting year not found." }); }
      if (request.body.status === "closed" && existing.rows[0]!.status !== "closed") { await client.query("ROLLBACK"); return reply.code(409).send({ error: "Close the year with a balanced closing and carry-forward workflow." }); }
      if (request.body.status === "open" && existing.rows[0]!.status === "closed") {
        const transferred = await client.query("SELECT 1 FROM finance_year_end_transfers WHERE department_id=$1 AND source_year=$2", [departmentId, Number(request.params.year)]);
        if (transferred.rowCount) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "A year with posted closing entries cannot be reopened. Correct the entries with audited reversals." }); }
      }
      const overlap = await client.query("SELECT 1 FROM finance_accounting_years WHERE department_id=$1 AND accounting_year<>$2 AND start_date<=$4::date AND end_date>=$3::date LIMIT 1", [departmentId, Number(request.params.year), request.body.startDate, request.body.endDate]);
      if (overlap.rowCount) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "Accounting year dates cannot overlap another configured year." }); }
      const changedDates = existing.rows[0]!.start_date !== request.body.startDate || existing.rows[0]!.end_date !== request.body.endDate;
      if (changedDates) {
        const linkedTransfer = await client.query("SELECT 1 FROM finance_year_end_transfers WHERE department_id=$1 AND (source_year=$2 OR target_year=$2) LIMIT 1", [departmentId, Number(request.params.year)]);
        if (linkedTransfer.rowCount) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "Accounting-year dates cannot change after a closing or carry-forward journal has been posted." }); }
        const outside = await client.query("SELECT 1 FROM finance_transactions WHERE department_id=$1 AND accounting_year=$2 AND (booking_date<$3::date OR booking_date>$4::date) UNION ALL SELECT 1 FROM finance_receipt_batches WHERE department_id=$1 AND accounting_year=$2 AND (period_start<$3::date OR period_end>$4::date) LIMIT 1", [departmentId, Number(request.params.year), request.body.startDate, request.body.endDate]);
        if (outside.rowCount) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "The date range would exclude existing transactions or receipts. Preserve their dates or use another accounting year." }); }
      }
      const updated = await client.query("UPDATE finance_accounting_years SET label=$3,start_date=$4,end_date=$5,status=$6,updated_by=$7,updated_at=now() WHERE department_id=$1 AND accounting_year=$2 RETURNING accounting_year AS \"accountingYear\",label,start_date AS \"startDate\",end_date AS \"endDate\",status", [departmentId, Number(request.params.year), label, request.body.startDate, request.body.endDate, request.body.status, request.authenticatedUser?.id ?? null]);
      await audit(client, departmentId, request, request.body.status === existing.rows[0]!.status ? "accounting_year_updated" : `accounting_year_${request.body.status}`, "accounting_year", request.params.year, { label, startDate: request.body.startDate, endDate: request.body.endDate, status: request.body.status });
      await client.query("COMMIT"); publish(departmentId, "accounting-year-updated", request.params.year); return updated.rows[0];
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  });

  app.get<{ Params: { year: string } }>("/api/modules/finance/accounting-years/:year/summary", { schema: { params: { type: "object", additionalProperties: false, required: ["year"], properties: { year: { type: "string", pattern: "^(19[0-9]{2}|20[0-9]{2}|21[0-9]{2}|2200)$" } } } } }, async (request, reply) => {
    const departmentId = await department(request, reply, true); if (!departmentId) return reply;
    const year = Number(request.params.year);
    const configured = await pool!.query<{ accountingYear: number; label: string; startDate: string; endDate: string; status: string }>("SELECT accounting_year AS \"accountingYear\",label,start_date::text AS \"startDate\",end_date::text AS \"endDate\",status FROM finance_accounting_years WHERE department_id=$1 AND accounting_year=$2", [departmentId, year]);
    if (!configured.rowCount) return reply.code(404).send({ error: "Accounting year not found." });
    const period = configured.rows[0]!;
    const [totals, bankRows, budgets, settings, transfer] = await Promise.all([
      pool!.query<{ transactions: string; debitCents: string; creditCents: string; incomeCents: string; expenseCents: string }>(
        `SELECT count(DISTINCT t.id)::text AS transactions,COALESCE(sum(l.debit_cents),0)::text AS \"debitCents\",COALESCE(sum(l.credit_cents),0)::text AS \"creditCents\",
                COALESCE(sum(CASE WHEN a.account_type='income' THEN l.credit_cents-l.debit_cents ELSE 0 END),0)::text AS \"incomeCents\",
                COALESCE(sum(CASE WHEN a.account_type='expense' THEN l.debit_cents-l.credit_cents ELSE 0 END),0)::text AS \"expenseCents\"
           FROM finance_transactions t JOIN finance_transaction_lines l ON l.department_id=t.department_id AND l.transaction_id=t.id
           JOIN finance_accounts a ON a.department_id=l.department_id AND a.id=l.account_id
          WHERE t.department_id=$1 AND t.accounting_year=$2 AND t.booking_date BETWEEN $3::date AND $4::date AND t.status='posted'`, [departmentId, year, period.startDate, period.endDate]),
      pool!.query<{ rowCount: string; amountCents: string }>("SELECT count(*)::text AS \"rowCount\",COALESCE(sum(abs(amount_cents)),0)::text AS \"amountCents\" FROM finance_bank_statement_rows WHERE department_id=$1 AND booking_date BETWEEN $2::date AND $3::date AND status IN ('unmatched','suggested')", [departmentId, period.startDate, period.endDate]),
      pool!.query<{ id: string; accountCode: string | null; accountName: string | null; accountType: string | null; costCenterCode: string | null; costCenterName: string | null; budgetCents: string; actualCents: string }>(
        `SELECT b.id,a.code AS \"accountCode\",a.name AS \"accountName\",a.account_type AS \"accountType\",c.code AS \"costCenterCode\",c.name AS \"costCenterName\",
                b.amount_cents::text AS \"budgetCents\",COALESCE(sum(CASE WHEN t.id IS NULL THEN 0 WHEN actual_account.account_type='income' THEN l.credit_cents-l.debit_cents ELSE l.debit_cents-l.credit_cents END),0)::text AS \"actualCents\"
           FROM finance_budgets b LEFT JOIN finance_accounts a ON a.department_id=b.department_id AND a.id=b.account_id
           LEFT JOIN finance_cost_centers c ON c.department_id=b.department_id AND c.id=b.cost_center_id
           LEFT JOIN finance_transactions t ON t.department_id=b.department_id AND t.accounting_year=b.accounting_year AND t.status='posted'
           LEFT JOIN finance_transaction_lines l ON l.department_id=t.department_id AND l.transaction_id=t.id
              AND (b.account_id IS NULL OR l.account_id=b.account_id) AND (b.cost_center_id IS NULL OR l.cost_center_id=b.cost_center_id)
           LEFT JOIN finance_accounts actual_account ON actual_account.department_id=l.department_id AND actual_account.id=l.account_id
          WHERE b.department_id=$1 AND b.accounting_year=$2 GROUP BY b.id,a.code,a.name,a.account_type,c.code,c.name ORDER BY a.code,c.code,b.id LIMIT 5000`, [departmentId, year]),
      pool!.query<{ currency: string }>("SELECT currency_code AS currency FROM finance_settings WHERE department_id=$1", [departmentId]),
      pool!.query("SELECT source_year AS \"sourceYear\",target_year AS \"targetYear\",closing_transaction_id AS \"closingTransactionId\",opening_transaction_id AS \"openingTransactionId\",closing_equity_account_id AS \"closingEquityAccountId\",created_at AS \"createdAt\" FROM finance_year_end_transfers WHERE department_id=$1 AND source_year=$2", [departmentId, year]),
    ]);
    const total = totals.rows[0]!; const unmatched = bankRows.rows[0]!;
    return {
      period,
      currency: settings.rows[0]?.currency ?? "CHF",
      totals: { transactionCount: Number(total.transactions), debitCents: asMoney(total.debitCents), creditCents: asMoney(total.creditCents), incomeCents: asMoney(total.incomeCents), expenseCents: asMoney(total.expenseCents) },
      unreconciledBank: { rowCount: Number(unmatched.rowCount), amountCents: asMoney(unmatched.amountCents) },
      budgetVariance: budgets.rows.map((row) => ({ ...row, budgetCents: asMoney(row.budgetCents), actualCents: asMoney(row.actualCents), varianceCents: asMoney(row.budgetCents) - asMoney(row.actualCents) })),
      yearEndTransfer: transfer.rows[0] ?? null,
    };
  });

  app.post<{ Params: { year: string }; Body: { targetYear: number; closingEquityAccountId: string } }>("/api/modules/finance/accounting-years/:year/close-and-carry-forward", { schema: { params: { type: "object", additionalProperties: false, required: ["year"], properties: { year: { type: "string", pattern: "^(19[0-9]{2}|20[0-9]{2}|21[0-9]{2}|2200)$" } } }, body: { type: "object", additionalProperties: false, required: ["targetYear", "closingEquityAccountId"], properties: { targetYear: { type: "integer", minimum: 1900, maximum: 2200 }, closingEquityAccountId: uuid } } } }, async (request, reply) => {
    const departmentId = await department(request, reply, true); if (!departmentId) return reply; if (!validateMutation(request, reply)) return reply;
    const sourceYear = Number(request.params.year); const targetYear = request.body.targetYear;
    if (targetYear !== sourceYear + 1) return reply.code(400).send({ error: "Carry-forward can only target the immediately following accounting year." });
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [departmentId]);
      const years = await client.query<{ accounting_year: number; start_date: string; end_date: string; status: string }>("SELECT accounting_year,start_date::text,end_date::text,status FROM finance_accounting_years WHERE department_id=$1 AND accounting_year=ANY($2::smallint[]) ORDER BY accounting_year FOR UPDATE", [departmentId, [sourceYear, targetYear]]);
      const source = years.rows.find((row) => row.accounting_year === sourceYear); const target = years.rows.find((row) => row.accounting_year === targetYear);
      if (!source || !target) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "Configure both the source and next accounting year first." }); }
      if (source.status !== "open" || target.status !== "open") { await client.query("ROLLBACK"); return reply.code(409).send({ error: "The source and target accounting years must both be open." }); }
      if (target.start_date <= source.end_date) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "The target period must begin after the source period ends." }); }
      const existing = await client.query("SELECT source_year FROM finance_year_end_transfers WHERE department_id=$1 AND source_year=$2", [departmentId, sourceYear]);
      if (existing.rowCount) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "Closing and carry-forward entries already exist for this accounting year." }); }
      const equity = await client.query("SELECT id FROM finance_accounts WHERE department_id=$1 AND id=$2 AND active AND account_type='equity' FOR SHARE", [departmentId, request.body.closingEquityAccountId]);
      if (!equity.rowCount) { await client.query("ROLLBACK"); return reply.code(400).send({ error: "Choose an active equity account for the closing balance." }); }

      // P&L accounts are zeroed by reversing their net debit/credit balances; the offset goes to equity by cost center.
      const profitLoss = await client.query<{ account_id: string; cost_center_id: string | null; net_cents: string }>(
        `SELECT l.account_id,l.cost_center_id,sum(l.debit_cents-l.credit_cents)::text AS net_cents
           FROM finance_transactions t JOIN finance_transaction_lines l ON l.department_id=t.department_id AND l.transaction_id=t.id
           JOIN finance_accounts a ON a.department_id=l.department_id AND a.id=l.account_id
          WHERE t.department_id=$1 AND t.booking_date BETWEEN $2::date AND $3::date AND t.status='posted' AND a.account_type IN ('income','expense')
          GROUP BY l.account_id,l.cost_center_id HAVING sum(l.debit_cents-l.credit_cents)<>0 ORDER BY l.account_id,l.cost_center_id`, [departmentId, source.start_date, source.end_date]);
      const pnlByCenter = new Map<string, { costCenterId: string | null; net: bigint }>();
      const closingLines: Array<{ accountId: string; costCenterId: string | null; debit: bigint; credit: bigint; text: string }> = [];
      for (const row of profitLoss.rows) {
        const net = BigInt(row.net_cents); const centerKey = row.cost_center_id ?? "none";
        const aggregate = pnlByCenter.get(centerKey) ?? { costCenterId: row.cost_center_id, net: 0n };
        aggregate.net += net; pnlByCenter.set(centerKey, aggregate);
        closingLines.push({ accountId: row.account_id, costCenterId: row.cost_center_id, debit: net < 0n ? -net : 0n, credit: net > 0n ? net : 0n, text: "Year-end result close" });
      }
      for (const aggregate of pnlByCenter.values()) {
        if (aggregate.net !== 0n) closingLines.push({ accountId: request.body.closingEquityAccountId, costCenterId: aggregate.costCenterId, debit: aggregate.net > 0n ? aggregate.net : 0n, credit: aggregate.net < 0n ? -aggregate.net : 0n, text: "Year-end result transferred to equity" });
      }
      const balanceRows = await client.query<{ account_id: string; cost_center_id: string | null; net_cents: string }>(
        `SELECT l.account_id,l.cost_center_id,sum(l.debit_cents-l.credit_cents)::text AS net_cents
           FROM finance_transactions t JOIN finance_transaction_lines l ON l.department_id=t.department_id AND l.transaction_id=t.id
           JOIN finance_accounts a ON a.department_id=l.department_id AND a.id=l.account_id
          WHERE t.department_id=$1 AND t.booking_date<=$2::date AND t.status='posted' AND a.account_type IN ('asset','liability','equity')
          GROUP BY l.account_id,l.cost_center_id HAVING sum(l.debit_cents-l.credit_cents)<>0 ORDER BY l.account_id,l.cost_center_id`, [departmentId, source.end_date]);
      const openingLines = balanceRows.rows.map((row) => { const net = BigInt(row.net_cents); return { accountId: row.account_id, costCenterId: row.cost_center_id, debit: net > 0n ? net : 0n, credit: net < 0n ? -net : 0n, text: "Opening balance carried forward" }; });
      // Include the P&L result just credited or debited to the selected equity
      // account in the source year, so the target's net equity is complete.
      for (const line of closingLines.filter((entry) => entry.accountId === request.body.closingEquityAccountId)) {
        const existingLine = openingLines.find((entry) => entry.accountId === line.accountId && entry.costCenterId === line.costCenterId);
        const net = (existingLine ? existingLine.debit - existingLine.credit : 0n) + line.debit - line.credit;
        if (existingLine) openingLines.splice(openingLines.indexOf(existingLine), 1);
        if (net !== 0n) openingLines.push({ accountId: line.accountId, costCenterId: line.costCenterId, debit: net > 0n ? net : 0n, credit: net < 0n ? -net : 0n, text: "Opening balance carried forward" });
      }
      for (const [name, lines] of [["closing", closingLines], ["opening", openingLines]] as const) {
        if (lines.length > 32767) { await client.query("ROLLBACK"); return reply.code(409).send({ error: `The ${name} entry exceeds the supported journal line limit.` }); }
        for (const line of lines) if (line.debit > 9_000_000_000_000_000n || line.credit > 9_000_000_000_000_000n) { await client.query("ROLLBACK"); return reply.code(409).send({ error: `A ${name} balance exceeds the supported safe amount range.` }); }
      }
      const debitSum = (lines: typeof closingLines) => lines.reduce((sum, line) => sum + line.debit, 0n);
      if (debitSum(closingLines) !== closingLines.reduce((sum, line) => sum + line.credit, 0n) || debitSum(openingLines) !== openingLines.reduce((sum, line) => sum + line.credit, 0n)) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "The calculated closing balances are not balanced. No entries were posted." }); }

      async function postYearEnd(lines: typeof closingLines, bookingDate: string, accountingYear: number, receiptNumber: string, bookingText: string) {
        if (!lines.length) return null;
        if (lines.length < 2) throw new Error("A year-end journal requires at least two lines.");
        const id = randomUUID();
        await client.query("INSERT INTO finance_transactions(id,department_id,booking_date,accounting_year,receipt_number,booking_text,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)", [id, departmentId, bookingDate, accountingYear, receiptNumber, bookingText, request.authenticatedUser?.id ?? null]);
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index]!;
          await client.query("INSERT INTO finance_transaction_lines(id,department_id,transaction_id,line_number,account_id,cost_center_id,debit_cents,credit_cents,line_text) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", [randomUUID(), departmentId, id, index + 1, line.accountId, line.costCenterId, line.debit.toString(), line.credit.toString(), line.text]);
        }
        await audit(client, departmentId!, request, "transaction_posted", "transaction", id, { bookingDate, accountingYear, receiptNumber, entryType: "year_end", lineCount: lines.length });
        return id;
      }
      const closingId = await postYearEnd(closingLines, source.end_date, sourceYear, `YE-CLOSE-${sourceYear}`, `Year-end closing entries ${sourceYear}`);
      const openingId = await postYearEnd(openingLines, target.start_date, targetYear, `YE-OPEN-${targetYear}`, `Opening balances carried forward from ${sourceYear}`);
      const transferId = randomUUID();
      await client.query("INSERT INTO finance_year_end_transfers(id,department_id,source_year,target_year,closing_equity_account_id,closing_transaction_id,opening_transaction_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [transferId, departmentId, sourceYear, targetYear, request.body.closingEquityAccountId, closingId, openingId, request.authenticatedUser?.id ?? null]);
      await client.query("UPDATE finance_accounting_years SET status='closed',updated_by=$3,updated_at=now() WHERE department_id=$1 AND accounting_year=$2", [departmentId, sourceYear, request.authenticatedUser?.id ?? null]);
      await audit(client, departmentId!, request, "accounting_year_closed_with_carry_forward", "year_end_transfer", transferId, { sourceYear, targetYear, closingTransactionId: closingId, openingTransactionId: openingId, closingEquityAccountId: request.body.closingEquityAccountId, closingLineCount: closingLines.length, openingLineCount: openingLines.length });
      await client.query("COMMIT");
      publish(departmentId, "year-end-transfer-created", transferId); publish(departmentId, "accounting-year-updated", String(sourceYear));
      return reply.code(201).send({ id: transferId, sourceYear, targetYear, closingTransactionId: closingId, openingTransactionId: openingId, status: "completed" });
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  });

  app.get("/api/modules/finance/receipts/settings", async (request, reply) => {
    const departmentId = await department(request, reply); if (!departmentId) return reply;
    const result = await pool!.query("SELECT organization_name AS \"organizationName\",template_text AS \"templateText\",numbering_prefix AS \"numberingPrefix\" FROM finance_receipt_settings WHERE department_id=$1", [departmentId]);
    return result.rows[0] ?? { organizationName: "", templateText: "Donation receipt for {{period}}\n\nReceived from: {{donorName}}\nAmount: {{currency}} {{amount}}\n\nThank you for your support.\n{{organization}}", numberingPrefix: "DR" };
  });

  app.put<{ Body: { organizationName: string; templateText: string; numberingPrefix: string } }>("/api/modules/finance/receipts/settings", { schema: { body: { type: "object", additionalProperties: false, required: ["organizationName", "templateText", "numberingPrefix"], properties: { organizationName: { type: "string", maxLength: 180 }, templateText: { type: "string", minLength: 1, maxLength: 4000 }, numberingPrefix: { type: "string", pattern: "^[A-Za-z0-9-]{1,24}$" } } } } }, async (request, reply) => {
    const departmentId = await department(request, reply, true); if (!departmentId) return reply; if (!validateMutation(request, reply)) return reply;
    const organizationName = cleanText(request.body.organizationName).slice(0, 180);
    const templateText = request.body.templateText.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
    if (!organizationName || !templateText || !request.body.numberingPrefix.trim()) return reply.code(400).send({ error: "Organization name, receipt template, and numbering prefix are required." });
    const result = await pool!.query("INSERT INTO finance_receipt_settings(department_id,organization_name,template_text,numbering_prefix,updated_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(department_id) DO UPDATE SET organization_name=EXCLUDED.organization_name,template_text=EXCLUDED.template_text,numbering_prefix=EXCLUDED.numbering_prefix,updated_by=EXCLUDED.updated_by,updated_at=now() RETURNING organization_name AS \"organizationName\",template_text AS \"templateText\",numbering_prefix AS \"numberingPrefix\"", [departmentId, organizationName, templateText, request.body.numberingPrefix.toUpperCase(), request.authenticatedUser?.id ?? null]);
    publish(departmentId, "receipt-settings-updated", departmentId); return result.rows[0];
  });

  app.get<{ Querystring: { year?: string; from?: string; to?: string; donorId?: string } }>("/api/modules/finance/receipts/preview", async (request, reply) => {
    const departmentId = await department(request, reply); if (!departmentId) return reply;
    const period = await receiptPeriodForLocation(departmentId, { year: request.query.year, from: request.query.from, to: request.query.to });
    if (!period) return reply.code(400).send({ error: "Choose a valid accounting year and date range." });
    const configured = await pool!.query("SELECT status FROM finance_accounting_years WHERE department_id=$1 AND accounting_year=$2 AND start_date<=$3::date AND end_date>=$4::date", [departmentId, period.year, period.from, period.to]);
    if (!configured.rowCount) return reply.code(409).send({ error: "The receipt date range must be covered by one configured accounting year." });
    if (configured.rows[0]!.status !== "open") return reply.code(409).send({ error: "Receipts cannot be issued for a closed accounting year." });
    if (request.query.donorId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request.query.donorId)) return reply.code(400).send({ error: "Choose a valid donor." });
    const result = await eligibleReceipts(departmentId, period.from, period.to, request.query.donorId);
    return { ...period, currency: (await pool!.query("SELECT currency_code FROM finance_settings WHERE department_id=$1", [departmentId])).rows[0]?.currency_code ?? "CHF", donors: result.rows.map((row) => ({ donorId: row.donorId, donorName: row.donorName, donorEmail: row.donorEmail, amountCents: asMoney(row.amountCents), donationCount: row.transactionIds.length })) };
  });

  app.post<{ Body: { year: number; from?: string; to?: string; donorId?: string | null; collective: boolean } }>("/api/modules/finance/receipts/issue", { schema: { body: { type: "object", additionalProperties: false, required: ["year", "collective"], properties: { year: { type: "integer", minimum: 1900, maximum: 2200 }, from: { type: "string", format: "date" }, to: { type: "string", format: "date" }, donorId: { anyOf: [uuid, { type: "null" }] }, collective: { type: "boolean" } } } } }, async (request, reply) => {
    const departmentId = await department(request, reply, true); if (!departmentId) return reply; if (!validateMutation(request, reply)) return reply;
    if (!request.body.collective && !request.body.donorId) return reply.code(400).send({ error: "Choose an individual donor or issue a collective batch." });
    if (request.body.collective && request.body.donorId) return reply.code(400).send({ error: "Choose either a collective batch or one individual donor." });
    const period = await receiptPeriodForLocation(departmentId, { year: request.body.year, from: request.body.from, to: request.body.to });
    if (!period) return reply.code(400).send({ error: "Choose a valid date range within the accounting year." });
    const client = await pool!.connect();
    let batchId = "";
    try {
      await client.query("BEGIN");
      const configured = await client.query("SELECT status FROM finance_accounting_years WHERE department_id=$1 AND accounting_year=$2 AND start_date<=$3::date AND end_date>=$4::date FOR SHARE", [departmentId, period.year, period.from, period.to]);
      if (!configured.rowCount || configured.rows[0]!.status !== "open") { await client.query("ROLLBACK"); return reply.code(409).send({ error: "The receipt range must be covered by an open configured accounting year." }); }
      await client.query("INSERT INTO finance_receipt_settings(department_id) VALUES($1) ON CONFLICT(department_id) DO NOTHING", [departmentId]);
      const settings = await client.query<{ organization_name: string; template_text: string; numbering_prefix: string; next_number: string }>("SELECT organization_name,template_text,numbering_prefix,next_number::text FROM finance_receipt_settings WHERE department_id=$1 FOR UPDATE", [departmentId]);
      const eligible = await eligibleReceipts(departmentId, period.from, period.to, request.body.donorId ?? undefined);
      if (!eligible.rowCount) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "No eligible posted donations were found for that donor and date range." }); }
      batchId = randomUUID();
      await client.query("INSERT INTO finance_receipt_batches(id,department_id,accounting_year,period_start,period_end,collective,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)", [batchId, departmentId, period.year, period.from, period.to, request.body.collective, request.authenticatedUser?.id ?? null]);
      const currency = (await client.query<{ currency_code: string }>("SELECT currency_code FROM finance_settings WHERE department_id=$1", [departmentId])).rows[0]?.currency_code ?? "CHF";
      let nextNumber = BigInt(settings.rows[0]!.next_number);
      const receipts: Array<{ id: string; batchId: string; receiptNumber: string; donorName: string; amountCents: number; printUrl: string; batchPrintUrl: string }> = [];
      for (const donor of eligible.rows) {
        const receiptId = randomUUID();
        const receiptNumber = `${settings.rows[0]!.numbering_prefix}-${period.year}-${nextNumber.toString().padStart(6, "0")}`;
        const amountCents = asMoney(donor.amountCents);
        if (amountCents <= 0) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "A donor total is outside the supported safe amount range." }); }
        const renderedText = renderReceiptText(settings.rows[0]!.template_text, { donorName: donor.donorName, period: `${period.from} to ${period.to}`, amount: (amountCents / 100).toFixed(2), currency, organization: settings.rows[0]!.organization_name });
        await client.query("INSERT INTO finance_donation_receipts(id,department_id,batch_id,donor_id,receipt_number,donor_name_snapshot,donor_email_snapshot,amount_cents,currency_code,period_start,period_end,rendered_text,transaction_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::uuid[])", [receiptId, departmentId, batchId, donor.donorId, receiptNumber, donor.donorName, donor.donorEmail, amountCents, currency, period.from, period.to, renderedText, donor.transactionIds]);
        receipts.push({ id: receiptId, batchId, receiptNumber, donorName: donor.donorName, amountCents, printUrl: `/api/modules/finance/receipts/${receiptId}/print`, batchPrintUrl: `/api/modules/finance/receipts/batches/${batchId}/print` }); nextNumber += 1n;
      }
      await client.query("UPDATE finance_receipt_settings SET next_number=$2,updated_by=$3,updated_at=now() WHERE department_id=$1", [departmentId, nextNumber.toString(), request.authenticatedUser?.id ?? null]);
      await audit(client, departmentId, request, "donation_receipts_issued", "receipt_batch", batchId, { accountingYear: period.year, periodStart: period.from, periodEnd: period.to, collective: request.body.collective, count: receipts.length });
      await client.query("COMMIT");
      publish(departmentId, "receipts-issued", batchId);
      return reply.code(201).send({ batchId, ...period, collective: request.body.collective, receipts });
    } catch (error) { await client.query("ROLLBACK"); if ((error as { code?: string }).code === "23505") return reply.code(409).send({ error: "Receipts have already been issued for this donor or period." }); throw error; }
    finally { client.release(); }
  });

  app.get<{ Querystring: { year?: string } }>("/api/modules/finance/receipts", async (request, reply) => {
    const departmentId = await department(request, reply); if (!departmentId) return reply;
    const year = request.query.year && /^\d{4}$/.test(request.query.year) ? Number(request.query.year) : null;
    const result = await pool!.query(`SELECT r.id,r.batch_id AS "batchId",r.receipt_number AS "receiptNumber",r.donor_name_snapshot AS "donorName",r.amount_cents AS "amountCents",r.currency_code AS currency,r.period_start AS "periodStart",r.period_end AS "periodEnd",r.created_at AS "createdAt",b.collective FROM finance_donation_receipts r JOIN finance_receipt_batches b ON b.department_id=r.department_id AND b.id=r.batch_id WHERE r.department_id=$1 AND ($2::smallint IS NULL OR b.accounting_year=$2) ORDER BY r.created_at DESC,r.receipt_number LIMIT 500`, [departmentId, year]);
    return result.rows.map((row) => ({ ...row, amountCents: asMoney(row.amountCents), printUrl: `/api/modules/finance/receipts/${row.id}/print`, batchPrintUrl: `/api/modules/finance/receipts/batches/${row.batchId}/print` }));
  });

  app.get<{ Params: { batchId: string } }>("/api/modules/finance/receipts/batches/:batchId/print", { schema: { params: { type: "object", additionalProperties: false, required: ["batchId"], properties: { batchId: uuid } } } }, async (request, reply) => {
    const departmentId = await department(request, reply); if (!departmentId) return reply;
    const result = await pool!.query<{ receipt_number: string; donor_name_snapshot: string; amount_cents: string; currency_code: string; period_start: string; period_end: string; rendered_text: string }>(
      "SELECT receipt_number,donor_name_snapshot,amount_cents::text,currency_code,period_start::text,period_end::text,rendered_text FROM finance_donation_receipts WHERE department_id=$1 AND batch_id=$2 ORDER BY receipt_number,id",
      [departmentId, request.params.batchId],
    );
    if (!result.rowCount) return reply.code(404).send({ error: "Receipt batch not found." });
    const documents = result.rows.map((receipt) => `<article class="receipt"><header><h1>Donation receipt</h1><strong>${escapeHtml(receipt.receipt_number)}</strong></header><p class="meta">${escapeHtml(receipt.donor_name_snapshot)} · ${escapeHtml(receipt.period_start)} to ${escapeHtml(receipt.period_end)} · ${escapeHtml((asMoney(receipt.amount_cents) / 100).toFixed(2))} ${escapeHtml(receipt.currency_code)}</p><div class="receipt-body">${escapeHtml(receipt.rendered_text)}</div></article>`).join("");
    return reply.type("text/html; charset=utf-8").header("X-Content-Type-Options", "nosniff").header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'").header("Content-Disposition", `inline; filename="donation-receipts-${request.params.batchId}.html"`).send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Donation receipt batch</title><style>body{font:16px/1.55 system-ui,sans-serif;color:#17212b;margin:0;background:#f4f6f8}.toolbar{max-width:780px;margin:1rem auto;text-align:right}.receipt{box-sizing:border-box;max-width:780px;min-height:500px;margin:1rem auto 3rem;padding:3rem;background:white;box-shadow:0 8px 30px #0001;break-after:page;page-break-after:always}.receipt:last-of-type{break-after:auto;page-break-after:auto}header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #ccd4dc;padding-bottom:1rem}.meta{color:#475569;font-size:.9rem}.receipt-body{white-space:pre-wrap;margin-top:3rem}@media print{body{background:white}.toolbar{display:none}.receipt{margin:0;box-shadow:none;max-width:none;min-height:0;break-after:page;page-break-after:always}.receipt:last-of-type{break-after:auto;page-break-after:auto}}</style><div class="toolbar"><button onclick="window.print()">Print batch</button></div>${documents}</html>`);
  });

  app.get<{ Params: { id: string } }>("/api/modules/finance/receipts/:id/print", { schema: { params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: uuid } } } }, async (request, reply) => {
    const departmentId = await department(request, reply); if (!departmentId) return reply;
    const result = await pool!.query<{ receipt_number: string; donor_name_snapshot: string; amount_cents: string; currency_code: string; period_start: string; period_end: string; rendered_text: string }>("SELECT receipt_number,donor_name_snapshot,amount_cents::text,currency_code,period_start::text,period_end::text,rendered_text FROM finance_donation_receipts WHERE department_id=$1 AND id=$2", [departmentId, request.params.id]);
    if (!result.rowCount) return reply.code(404).send({ error: "Receipt not found." });
    const receipt = result.rows[0]!;
    const text = escapeHtml(receipt.rendered_text);
    return reply.type("text/html; charset=utf-8").header("X-Content-Type-Options", "nosniff").header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'").header("Content-Disposition", `inline; filename=\"${receipt.receipt_number.replace(/[^A-Za-z0-9_-]/g, "_")}.html\"`).send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Donation receipt ${escapeHtml(receipt.receipt_number)}</title><style>body{font:16px/1.55 system-ui,sans-serif;color:#17212b;margin:0;background:#f4f6f8}.receipt{box-sizing:border-box;max-width:780px;min-height:500px;margin:3rem auto;padding:3rem;background:white;box-shadow:0 8px 30px #0001}.receipt-head{display:flex;justify-content:space-between;border-bottom:1px solid #ccd4dc;padding-bottom:1rem}.receipt-body{white-space:pre-wrap;margin-top:3rem}.meta{color:#475569;font-size:.9rem}@media print{body{background:white}.receipt{margin:0;box-shadow:none;max-width:none}button{display:none}}</style><main class="receipt"><header class="receipt-head"><div><h1>Donation receipt</h1><div class="meta">Receipt ${escapeHtml(receipt.receipt_number)}</div></div><button onclick="window.print()">Print</button></header><p class="meta">${escapeHtml(receipt.period_start)} to ${escapeHtml(receipt.period_end)} · ${escapeHtml((asMoney(receipt.amount_cents) / 100).toFixed(2))} ${escapeHtml(receipt.currency_code)}</p><article class="receipt-body">${text}</article></main></html>`);
  });

  app.put<{ Body: { currency: string } }>("/api/modules/finance/settings", { schema: { body: { type: "object", additionalProperties: false, required: ["currency"], properties: { currency: { type: "string", pattern: "^[A-Z]{3}$" } } } } }, async (request, reply) => {
    const departmentId = await department(request, reply, true);
    if (!departmentId) return reply;
    if (!validateMutation(request, reply)) return reply;
    const hasLedger = await pool!.query("SELECT 1 FROM finance_transactions WHERE department_id=$1 LIMIT 1", [departmentId]);
    if (hasLedger.rowCount) return reply.code(409).send({ error: "Currency cannot be changed after transactions have been posted." });
    await pool!.query("INSERT INTO finance_settings(department_id,currency_code) VALUES($1,$2) ON CONFLICT(department_id) DO UPDATE SET currency_code=EXCLUDED.currency_code,updated_at=now()", [departmentId, request.body.currency]);
    publish(departmentId, "settings-updated", departmentId);
    return { currency: request.body.currency };
  });

  app.post<{ Body: { code: string; name: string; accountType: string } }>("/api/modules/finance/accounts", { schema: { body: { type: "object", additionalProperties: false, required: ["code", "name", "accountType"], properties: { code: { type: "string", minLength: 1, maxLength: 32 }, name: { type: "string", minLength: 1, maxLength: 160 }, accountType: { type: "string", enum: ["asset", "liability", "equity", "income", "expense"] } } } } }, async (request, reply) => {
    const departmentId = await department(request, reply, true); if (!departmentId) return reply; if (!validateMutation(request, reply)) return reply;
    const code = cleanText(request.body.code); const name = cleanText(request.body.name); if (!code || !name) return reply.code(400).send({ error: "Account code and name are required." });
    const id = randomUUID();
    try { await pool!.query("INSERT INTO finance_accounts(id,department_id,code,name,account_type) VALUES($1,$2,$3,$4,$5)", [id, departmentId, code, name, request.body.accountType]); }
    catch { return reply.code(409).send({ error: "Account code already exists or the account is invalid." }); }
    publish(departmentId, "account-created", id); return reply.code(201).send({ id, code, name, accountType: request.body.accountType, active: true });
  });

  app.patch<{ Params: { id: string }; Body: { active: boolean } }>("/api/modules/finance/accounts/:id", { schema: { params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: uuid } }, body: { type: "object", additionalProperties: false, required: ["active"], properties: { active: { type: "boolean" } } } } }, async (request, reply) => {
    const departmentId = await department(request, reply, true); if (!departmentId) return reply; if (!validateMutation(request, reply)) return reply;
    const result = await pool!.query("UPDATE finance_accounts SET active=$3,updated_at=now() WHERE department_id=$1 AND id=$2 RETURNING id", [departmentId, request.params.id, request.body.active]);
    if (!result.rowCount) return reply.code(404).send({ error: "Account not found." }); publish(departmentId, "account-updated", request.params.id); return { updated: true };
  });

  app.post<{ Body: { code: string; name: string } }>("/api/modules/finance/cost-centers", { schema: { body: { type: "object", additionalProperties: false, required: ["code", "name"], properties: { code: { type: "string", minLength: 1, maxLength: 32 }, name: { type: "string", minLength: 1, maxLength: 160 } } } } }, async (request, reply) => {
    const departmentId = await department(request, reply, true); if (!departmentId) return reply; if (!validateMutation(request, reply)) return reply;
    const code = cleanText(request.body.code); const name = cleanText(request.body.name); if (!code || !name) return reply.code(400).send({ error: "Cost center code and name are required." });
    const id = randomUUID();
    try { await pool!.query("INSERT INTO finance_cost_centers(id,department_id,code,name) VALUES($1,$2,$3,$4)", [id, departmentId, code, name]); }
    catch { return reply.code(409).send({ error: "Cost center code already exists or the cost center is invalid." }); }
    publish(departmentId, "cost-center-created", id); return reply.code(201).send({ id, code, name, active: true });
  });

  app.patch<{ Params: { id: string }; Body: { active: boolean } }>("/api/modules/finance/cost-centers/:id", { schema: { params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: uuid } }, body: { type: "object", additionalProperties: false, required: ["active"], properties: { active: { type: "boolean" } } } } }, async (request, reply) => {
    const departmentId = await department(request, reply, true); if (!departmentId) return reply; if (!validateMutation(request, reply)) return reply;
    const result = await pool!.query("UPDATE finance_cost_centers SET active=$3,updated_at=now() WHERE department_id=$1 AND id=$2 RETURNING id", [departmentId, request.params.id, request.body.active]);
    if (!result.rowCount) return reply.code(404).send({ error: "Cost center not found." }); publish(departmentId, "cost-center-updated", request.params.id); return { updated: true };
  });

  app.post<{ Body: { donorType: "individual" | "joint"; displayName: string; email?: string } }>("/api/modules/finance/donors", { schema: { body: { type: "object", additionalProperties: false, required: ["donorType", "displayName"], properties: { donorType: { type: "string", enum: ["individual", "joint"] }, displayName: { type: "string", minLength: 1, maxLength: 180 }, email: { type: "string", maxLength: 254 } } } } }, async (request, reply) => {
    const departmentId = await department(request, reply, true); if (!departmentId) return reply; if (!validateMutation(request, reply)) return reply;
    const id = randomUUID(); const name = cleanText(request.body.displayName); if (!name) return reply.code(400).send({ error: "Enter a donor name." });
    const result = await pool!.query("INSERT INTO finance_donors(id,department_id,donor_type,display_name,email) VALUES($1,$2,$3,$4,$5) RETURNING id,donor_type AS \"donorType\",display_name AS \"displayName\",email,active", [id, departmentId, request.body.donorType, name, cleanText(request.body.email ?? "")]);
    publish(departmentId, "donor-created", id); return reply.code(201).send(result.rows[0]);
  });

  app.patch<{ Params: { id: string }; Body: { active: boolean } }>("/api/modules/finance/donors/:id", { schema: { params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: uuid } }, body: { type: "object", additionalProperties: false, required: ["active"], properties: { active: { type: "boolean" } } } } }, async (request, reply) => {
    const departmentId = await department(request, reply, true); if (!departmentId) return reply; if (!validateMutation(request, reply)) return reply;
    const result = await pool!.query("UPDATE finance_donors SET active=$3,updated_at=now() WHERE department_id=$1 AND id=$2 RETURNING id", [departmentId, request.params.id, request.body.active]);
    if (!result.rowCount) return reply.code(404).send({ error: "Donor not found." }); publish(departmentId, "donor-updated", request.params.id); return { updated: true };
  });

  app.get<{ Params: { id: string; format: string }; Querystring: { from?: string; to?: string } }>("/api/modules/finance/donors/:id/statement.:format", { schema: { params: { type: "object", additionalProperties: false, required: ["id", "format"], properties: { id: uuid, format: { enum: ["csv", "xlsx", "html", "pdf"] } } }, querystring: { type: "object", additionalProperties: false, properties: { from: { type: "string", format: "date" }, to: { type: "string", format: "date" } } } } }, async (request, reply) => {
    if (!["csv", "xlsx", "html", "pdf"].includes((request.params as { format: string }).format)) return reply.code(404).send({ error: "Export format not found." });
    const departmentId = await department(request, reply, true); if (!departmentId) return reply;
    if ((request.query.from && !validDateOnly(request.query.from)) || (request.query.to && !validDateOnly(request.query.to)) || (request.query.from && request.query.to && request.query.from > request.query.to)) return reply.code(400).send({ error: "Choose a valid donor-statement date range." });
    const donor = await pool!.query("SELECT 1 FROM finance_donors WHERE department_id=$1 AND id=$2", [departmentId, request.params.id]);
    if (!donor.rowCount) return reply.code(404).send({ error: "Donor not found." });
    const result = await pool!.query(`SELECT t.booking_date,t.accounting_year,t.receipt_number,d.display_name AS donor_name,t.booking_text,a.code AS account_code,a.name AS account_name,c.code AS cost_center_code,l.line_text,l.credit_cents-l.debit_cents AS amount_cents,s.currency_code
         FROM finance_donors d
         JOIN finance_transaction_lines l ON l.department_id=d.department_id AND l.donor_id=d.id
         JOIN finance_transactions t ON t.department_id=l.department_id AND t.id=l.transaction_id AND t.status='posted'
         JOIN finance_accounts a ON a.department_id=l.department_id AND a.id=l.account_id AND a.account_type='income'
         LEFT JOIN finance_cost_centers c ON c.department_id=l.department_id AND c.id=l.cost_center_id
         JOIN finance_settings s ON s.department_id=d.department_id
        WHERE d.department_id=$1 AND d.id=$2 AND l.credit_cents<>l.debit_cents
          AND ($3::date IS NULL OR t.booking_date >= $3) AND ($4::date IS NULL OR t.booking_date <= $4)
        ORDER BY t.booking_date,t.created_at,t.id,l.line_number`, [departmentId, request.params.id, request.query.from ?? null, request.query.to ?? null]);
    const header = ["booking_date", "accounting_year", "receipt_number", "donor_name", "booking_text", "account_code", "account_name", "cost_center_code", "line_text", "gift_amount_cents", "currency"];
    return sendFinanceExport(request, reply, `finance-donor-statement-${request.params.id}`, header, result.rows.map((row) => [row.booking_date, row.accounting_year, row.receipt_number, row.donor_name, row.booking_text, row.account_code, row.account_name, row.cost_center_code, row.line_text, row.amount_cents, row.currency_code]));
  });

  app.get<{ Querystring: { from?: string; to?: string; year?: string; q?: string; donorId?: string; accountId?: string; page?: string; pageSize?: string } & TransactionOrderQuery }>("/api/modules/finance/transactions", async (request, reply) => {
    const departmentId = await department(request, reply); if (!departmentId) return reply;
    if ((request.query.from && !validDateOnly(request.query.from)) || (request.query.to && !validDateOnly(request.query.to))) return reply.code(400).send({ error: "Choose valid start and end dates." });
    const from = request.query.from && /^\d{4}-\d{2}-\d{2}$/.test(request.query.from) ? request.query.from : null;
    const to = request.query.to && /^\d{4}-\d{2}-\d{2}$/.test(request.query.to) ? request.query.to : null;
    if (from && to && from > to) return reply.code(400).send({ error: "The start date must be on or before the end date." });
    const year = request.query.year && /^\d{4}$/.test(request.query.year) ? Number(request.query.year) : null;
    const q = cleanText(request.query.q ?? "").slice(0, 100);
    const page = Math.max(1, Math.min(100_000, Number.parseInt(request.query.page ?? "1", 10) || 1));
    const pageSize = Math.max(10, Math.min(100, Number.parseInt(request.query.pageSize ?? "50", 10) || 50));
    const { donorId, accountId } = request.query;
    if (donorId !== undefined && (typeof donorId !== "string" || !transactionFilterIdPattern.test(donorId))) {
      return reply.code(400).send({ error: "Choose a valid Finance donor." });
    }
    if (accountId !== undefined && (typeof accountId !== "string" || !transactionFilterIdPattern.test(accountId))) {
      return reply.code(400).send({ error: "Choose a valid Finance account." });
    }
    const filters = [departmentId, from, to, year, q, donorId ?? null, accountId ?? null];
    const count = await pool!.query<{ total: string }>(`SELECT count(*)::text AS total FROM finance_transactions t
      WHERE t.department_id=$1 AND ($2::date IS NULL OR t.booking_date >= $2) AND ($3::date IS NULL OR t.booking_date <= $3) AND ($4::smallint IS NULL OR t.accounting_year=$4) AND ($5='' OR t.receipt_number ILIKE '%'||$5||'%' OR t.booking_text ILIKE '%'||$5||'%') ${transactionDonorFilter} ${transactionAccountFilter}`, filters);
    const result = await pool!.query(`SELECT t.id,t.booking_date AS "bookingDate",t.accounting_year AS "accountingYear",t.receipt_number AS "receiptNumber",t.booking_text AS "bookingText",t.status,t.reverses_transaction_id AS "reversesTransactionId",t.created_at AS "createdAt",COALESCE(sum(l.debit_cents),0)::text AS "debitCents",COALESCE(sum(l.credit_cents),0)::text AS "creditCents",count(l.id)::int AS "lineCount"
      FROM finance_transactions t LEFT JOIN finance_transaction_lines l ON l.department_id=t.department_id AND l.transaction_id=t.id
      WHERE t.department_id=$1 AND ($2::date IS NULL OR t.booking_date >= $2) AND ($3::date IS NULL OR t.booking_date <= $3) AND ($4::smallint IS NULL OR t.accounting_year=$4) AND ($5='' OR t.receipt_number ILIKE '%'||$5||'%' OR t.booking_text ILIKE '%'||$5||'%') ${transactionDonorFilter} ${transactionAccountFilter}
      GROUP BY t.id ORDER BY ${transactionOrder(request.query, false)} LIMIT $8 OFFSET $9`, [...filters, pageSize, (page - 1) * pageSize]);
    return { items: result.rows.map((row) => ({ ...row, debitCents: asMoney(row.debitCents), creditCents: asMoney(row.creditCents) })), total: Number(count.rows[0]?.total ?? 0), page, pageSize };
  });

  app.post<{ Body: FinanceTransactionBody }>("/api/modules/finance/transactions", { schema: { body: transactionSchema } }, async (request, reply) => {
    const departmentId = await department(request, reply, true); if (!departmentId) return reply; if (!validateMutation(request, reply)) return reply;
    const receiptNumber = cleanText(request.body.receiptNumber); const bookingText = cleanText(request.body.bookingText);
    const lines = request.body.lines.map((line) => ({ ...line, text: cleanText(line.text ?? "") }));
    if (!receiptNumber || !bookingText) return reply.code(400).send({ error: "Receipt number and booking text are required." });
    if (lines.some((line) => (line.debitCents > 0) === (line.creditCents > 0))) return reply.code(400).send({ error: "Each line must contain either a debit or a credit amount." });
    const debitTotal = lines.reduce((sum, line) => sum + line.debitCents, 0); const creditTotal = lines.reduce((sum, line) => sum + line.creditCents, 0);
    if (!Number.isSafeInteger(debitTotal) || !Number.isSafeInteger(creditTotal) || debitTotal <= 0 || debitTotal !== creditTotal) return reply.code(400).send({ error: "Debits and credits must be equal and greater than zero." });
    const bookingDate = request.body.bookingDate;
    if (new Date(`${bookingDate}T00:00:00.000Z`).toISOString().slice(0, 10) !== bookingDate) return reply.code(400).send({ error: "Booking date is invalid." });
    const id = randomUUID(); const client = await pool!.connect(); let accountingYear = 0;
    try {
      await client.query("BEGIN");
      const configured = await periodForDate(client, departmentId, bookingDate);
      if (!configured.rowCount || configured.rows[0]!.status !== "open") { await client.query("ROLLBACK"); return reply.code(409).send({ error: "The booking date must fall within an open configured accounting year." }); }
      const accountingYear = configured.rows[0]!.accounting_year;
      const referenced = await client.query(`SELECT count(*)::int AS count FROM finance_accounts a WHERE a.department_id=$1 AND a.active AND a.id=ANY($2::uuid[])`, [departmentId, [...new Set(lines.map((line) => line.accountId))]]);
      if (referenced.rows[0].count !== new Set(lines.map((line) => line.accountId)).size) { await client.query("ROLLBACK"); return reply.code(400).send({ error: "Select active accounts from this location." }); }
      for (const line of lines) {
        if (line.costCenterId) { const valid = await client.query("SELECT 1 FROM finance_cost_centers WHERE department_id=$1 AND id=$2 AND active", [departmentId, line.costCenterId]); if (!valid.rowCount) { await client.query("ROLLBACK"); return reply.code(400).send({ error: "Select active cost centers from this location." }); } }
        if (line.donorId) { const valid = await client.query("SELECT 1 FROM finance_donors WHERE department_id=$1 AND id=$2 AND active", [departmentId, line.donorId]); if (!valid.rowCount) { await client.query("ROLLBACK"); return reply.code(400).send({ error: "Select active donors from this location." }); } }
      }
      await client.query("INSERT INTO finance_transactions(id,department_id,booking_date,accounting_year,receipt_number,booking_text,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)", [id, departmentId, bookingDate, accountingYear, receiptNumber, bookingText, request.authenticatedUser?.id ?? null]);
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index]!;
        await client.query("INSERT INTO finance_transaction_lines(id,department_id,transaction_id,line_number,account_id,cost_center_id,donor_id,debit_cents,credit_cents,line_text) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [randomUUID(), departmentId, id, index + 1, line.accountId, line.costCenterId ?? null, line.donorId ?? null, line.debitCents, line.creditCents, line.text ?? ""]);
      }
      await audit(client, departmentId, request, "transaction_posted", "transaction", id, { bookingDate, accountingYear, receiptNumber, debitCents: debitTotal, creditCents: creditTotal, lineCount: lines.length });
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    publish(departmentId, "transaction-posted", id); return reply.code(201).send({ id, bookingDate, accountingYear, receiptNumber, bookingText, status: "posted", debitCents: debitTotal, creditCents: creditTotal });
  });

  app.get<{ Params: { id: string } }>("/api/modules/finance/transactions/:id", { schema: { params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: uuid } } } }, async (request, reply) => {
    const departmentId = await department(request, reply); if (!departmentId) return reply;
    const transaction = await pool!.query("SELECT id,booking_date AS \"bookingDate\",accounting_year AS \"accountingYear\",receipt_number AS \"receiptNumber\",booking_text AS \"bookingText\",status,reverses_transaction_id AS \"reversesTransactionId\",created_at AS \"createdAt\" FROM finance_transactions WHERE department_id=$1 AND id=$2", [departmentId, request.params.id]);
    if (!transaction.rowCount) return reply.code(404).send({ error: "Transaction not found." });
    const lines = await pool!.query<FinanceLineRow>(`SELECT l.id,l.line_number,l.account_id,a.code AS account_code,a.name AS account_name,a.account_type,l.cost_center_id,c.name AS cost_center_name,l.donor_id,d.display_name AS donor_name,l.debit_cents,l.credit_cents,l.line_text FROM finance_transaction_lines l JOIN finance_accounts a ON a.id=l.account_id AND a.department_id=l.department_id LEFT JOIN finance_cost_centers c ON c.id=l.cost_center_id AND c.department_id=l.department_id LEFT JOIN finance_donors d ON d.id=l.donor_id AND d.department_id=l.department_id WHERE l.department_id=$1 AND l.transaction_id=$2 ORDER BY l.line_number`, [departmentId, request.params.id]);
    const auditRows = await pool!.query("SELECT audit.id,audit.action,audit.record_kind AS \"recordKind\",audit.record_id AS \"recordId\",audit.details,audit.created_at AS \"createdAt\",actor.display_name AS \"actorName\" FROM finance_audit audit LEFT JOIN app_users actor ON actor.id=audit.actor_user_id WHERE audit.department_id=$1 AND (audit.record_id=$2 OR audit.details->>'reversalId'=$2::text) ORDER BY audit.created_at,audit.id", [departmentId, request.params.id]);
    return { ...transaction.rows[0], lines: lines.rows.map((line) => ({ id: line.id, lineNumber: Number(line.line_number), accountId: line.account_id, accountCode: line.account_code, accountName: line.account_name, accountType: line.account_type, costCenterId: line.cost_center_id, costCenterName: line.cost_center_name, donorId: line.donor_id, donorName: line.donor_name, debitCents: asMoney(line.debit_cents), creditCents: asMoney(line.credit_cents), text: line.line_text })), audit: auditRows.rows };
  });

  app.post<{ Params: { id: string }; Body: { reason: string } }>("/api/modules/finance/transactions/:id/void", { schema: { params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: uuid } }, body: { type: "object", additionalProperties: false, required: ["reason"], properties: { reason: { type: "string", minLength: 1, maxLength: 500 } } } } }, async (request, reply) => {
    const departmentId = await department(request, reply, true); if (!departmentId) return reply; if (!validateMutation(request, reply)) return reply;
    const reason = cleanText(request.body.reason); if (!reason) return reply.code(400).send({ error: "Enter a reason for the reversal." });
    const client = await pool!.connect(); const reversalId = randomUUID();
    try {
      await client.query("BEGIN");
      const original = await client.query("SELECT id,booking_date,accounting_year,receipt_number,booking_text,status FROM finance_transactions WHERE department_id=$1 AND id=$2 FOR UPDATE", [departmentId, request.params.id]);
      if (!original.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Transaction not found." }); }
      const source = original.rows[0];
      if (source.status !== "posted") { await client.query("ROLLBACK"); return reply.code(409).send({ error: "Only posted transactions can be reversed." }); }
      const prior = await client.query("SELECT id FROM finance_transactions WHERE department_id=$1 AND reverses_transaction_id=$2", [departmentId, request.params.id]);
      if (prior.rowCount) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "This transaction already has a reversal." }); }
      const sourceLines = await client.query("SELECT account_id,cost_center_id,donor_id,debit_cents,credit_cents,line_text FROM finance_transaction_lines WHERE department_id=$1 AND transaction_id=$2 ORDER BY line_number", [departmentId, request.params.id]);
      const reversalDate = new Date().toISOString().slice(0, 10);
      const configured = await periodForDate(client, departmentId, reversalDate);
      if (!configured.rowCount || configured.rows[0]!.status !== "open") { await client.query("ROLLBACK"); return reply.code(409).send({ error: "A reversal requires an open accounting year covering today's date." }); }
      const reversalYear = configured.rows[0]!.accounting_year;
      await client.query("INSERT INTO finance_transactions(id,department_id,booking_date,accounting_year,receipt_number,booking_text,status,reverses_transaction_id,created_by) VALUES($1,$2,$3,$4,$5,$6,'posted',$7,$8)", [reversalId, departmentId, reversalDate, reversalYear, `REV-${source.receipt_number}`.slice(0, 80), `Reversal of ${source.receipt_number}: ${reason}`.slice(0, 500), request.params.id, request.authenticatedUser?.id ?? null]);
      for (let index = 0; index < sourceLines.rows.length; index++) {
        const line = sourceLines.rows[index]!;
        await client.query("INSERT INTO finance_transaction_lines(id,department_id,transaction_id,line_number,account_id,cost_center_id,donor_id,debit_cents,credit_cents,line_text) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [randomUUID(), departmentId, reversalId, index + 1, line.account_id, line.cost_center_id, line.donor_id, line.credit_cents, line.debit_cents, `Reversal: ${line.line_text}`.slice(0, 500)]);
      }
      await audit(client, departmentId, request, "transaction_reversed", "transaction", request.params.id, { reversalId, reason });
      await audit(client, departmentId, request, "reversal_posted", "transaction", reversalId, { reversesTransactionId: request.params.id });
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    publish(departmentId, "transaction-reversed", reversalId); return reply.code(201).send({ reversalId, reversesTransactionId: request.params.id, status: "posted" });
  });

  app.post<{ Body: { accountingYear: number; accountId?: string | null; costCenterId?: string | null; amountCents: number; note?: string } }>("/api/modules/finance/budgets", { schema: { body: { type: "object", additionalProperties: false, required: ["accountingYear", "amountCents"], properties: { accountingYear: { type: "integer", minimum: 1900, maximum: 2200 }, accountId: { anyOf: [uuid, { type: "null" }] }, costCenterId: { anyOf: [uuid, { type: "null" }] }, amountCents: { type: "integer", minimum: 0, maximum: 9000000000000000 }, note: { type: "string", maxLength: 500 } } } } }, async (request, reply) => {
    const departmentId = await department(request, reply, true); if (!departmentId) return reply; if (!validateMutation(request, reply)) return reply;
    if (!request.body.accountId && !request.body.costCenterId) return reply.code(400).send({ error: "Choose an account, cost center, or both for the budget." });
    const id = randomUUID(); const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      const configured = await client.query("SELECT status FROM finance_accounting_years WHERE department_id=$1 AND accounting_year=$2 FOR SHARE", [departmentId, request.body.accountingYear]);
      if (!configured.rowCount || configured.rows[0]!.status !== "open") { await client.query("ROLLBACK"); return reply.code(409).send({ error: "Choose an open configured accounting year before saving a budget." }); }
      const inserted = await client.query("INSERT INTO finance_budgets(id,department_id,accounting_year,account_id,cost_center_id,amount_cents,note,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING id", [id, departmentId, request.body.accountingYear, request.body.accountId ?? null, request.body.costCenterId ?? null, request.body.amountCents, cleanText(request.body.note ?? ""), request.authenticatedUser?.id ?? null]);
      if (!inserted.rowCount) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "A budget for this year and scope already exists, or an account/cost center is invalid." }); }
      await audit(client, departmentId, request, "budget_created", "budget", id, { accountingYear: request.body.accountingYear, amountCents: request.body.amountCents });
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); if ((error as { code?: string }).code === "23503") return reply.code(400).send({ error: "Budget references an invalid account or cost center." }); throw error; } finally { client.release(); }
    publish(departmentId, "budget-saved", id); return reply.code(201).send({ id, accountingYear: request.body.accountingYear, accountId: request.body.accountId ?? null, costCenterId: request.body.costCenterId ?? null, amountCents: request.body.amountCents, note: request.body.note ?? "" });
  });

  app.patch<{ Params: { id: string }; Body: { amountCents: number; note?: string } }>("/api/modules/finance/budgets/:id", { schema: { params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: uuid } }, body: { type: "object", additionalProperties: false, required: ["amountCents"], properties: { amountCents: { type: "integer", minimum: 0, maximum: 9000000000000000 }, note: { type: "string", maxLength: 500 } } } } }, async (request, reply) => {
    const departmentId = await department(request, reply, true); if (!departmentId) return reply; if (!validateMutation(request, reply)) return reply;
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query("SELECT id,accounting_year FROM finance_budgets WHERE department_id=$1 AND id=$2 FOR UPDATE", [departmentId, request.params.id]);
      if (!existing.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Budget not found." }); }
      const configured = await client.query("SELECT status FROM finance_accounting_years WHERE department_id=$1 AND accounting_year=$2 FOR SHARE", [departmentId, existing.rows[0]!.accounting_year]);
      if (!configured.rowCount || configured.rows[0]!.status !== "open") { await client.query("ROLLBACK"); return reply.code(409).send({ error: "Budgets cannot be changed for a closed or unconfigured accounting year." }); }
      await client.query("UPDATE finance_budgets SET amount_cents=$3,note=$4,updated_at=now() WHERE department_id=$1 AND id=$2", [departmentId, request.params.id, request.body.amountCents, cleanText(request.body.note ?? "")]);
      await audit(client, departmentId, request, "budget_updated", "budget", request.params.id, { accountingYear: existing.rows[0].accounting_year, amountCents: request.body.amountCents });
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    publish(departmentId, "budget-updated", request.params.id); return { id: request.params.id, updated: true };
  });

  app.get<{ Querystring: { year?: string } }>("/api/modules/finance/reports/trial-balance", async (request, reply) => {
    const departmentId = await department(request, reply); if (!departmentId) return reply;
    const year = request.query.year && /^\d{4}$/.test(request.query.year) ? Number(request.query.year) : new Date().getFullYear();
    const result = await pool!.query(`SELECT a.id,a.code,a.name,a.account_type AS "accountType",COALESCE(sum(CASE WHEN t.id IS NOT NULL THEN l.debit_cents ELSE 0 END),0)::text AS "debitCents",COALESCE(sum(CASE WHEN t.id IS NOT NULL THEN l.credit_cents ELSE 0 END),0)::text AS "creditCents",COALESCE(sum(CASE WHEN t.id IS NOT NULL THEN l.debit_cents-l.credit_cents ELSE 0 END),0)::text AS "netCents" FROM finance_accounts a LEFT JOIN finance_transaction_lines l ON l.department_id=a.department_id AND l.account_id=a.id LEFT JOIN finance_transactions t ON t.department_id=l.department_id AND t.id=l.transaction_id AND t.status='posted' AND t.accounting_year=$2 WHERE a.department_id=$1 GROUP BY a.id ORDER BY a.code`, [departmentId, year]);
    const accounts = result.rows.map((row) => ({ ...row, debitCents: asMoney(row.debitCents), creditCents: asMoney(row.creditCents), netCents: asMoney(row.netCents) }));
    return { accountingYear: year, accounts, totals: { debitCents: accounts.reduce((sum, row) => sum + row.debitCents, 0), creditCents: accounts.reduce((sum, row) => sum + row.creditCents, 0) } };
  });

  app.get<{ Querystring: { accountId?: string; from?: string; to?: string } }>("/api/modules/finance/reports/account-statement", async (request, reply) => {
    const departmentId = await department(request, reply); if (!departmentId) return reply;
    const accountId = request.query.accountId; if (!accountId) return reply.code(400).send({ error: "Choose an account." });
    if ((request.query.from && !validDateOnly(request.query.from)) || (request.query.to && !validDateOnly(request.query.to)) || (request.query.from && request.query.to && request.query.from > request.query.to)) return reply.code(400).send({ error: "Choose a valid account-statement date range." });
    const result = await pool!.query(`WITH entries AS (
        SELECT t.id,t.booking_date,t.accounting_year,t.receipt_number,t.booking_text,l.line_text,l.debit_cents,l.credit_cents,t.created_at,l.line_number,
               sum(l.debit_cents-l.credit_cents) OVER (ORDER BY t.booking_date,t.created_at,t.id,l.line_number)::text AS running_balance_cents
          FROM finance_transaction_lines l JOIN finance_transactions t ON t.id=l.transaction_id AND t.department_id=l.department_id
         WHERE l.department_id=$1 AND l.account_id=$2 AND t.status='posted'
      )
      SELECT id,booking_date AS "bookingDate",accounting_year AS "accountingYear",receipt_number AS "receiptNumber",booking_text AS "bookingText",line_text AS "lineText",debit_cents::text AS "debitCents",credit_cents::text AS "creditCents",running_balance_cents AS "runningBalanceCents"
        FROM entries WHERE ($3::date IS NULL OR booking_date >= $3) AND ($4::date IS NULL OR booking_date <= $4)
       ORDER BY booking_date,created_at,id,line_number`, [departmentId, accountId, request.query.from ?? null, request.query.to ?? null]);
    return result.rows.map((row) => ({ ...row, debitCents: asMoney(row.debitCents), creditCents: asMoney(row.creditCents), runningBalanceCents: asMoney(row.runningBalanceCents) }));
  });

  app.get<{ Querystring: { year?: string } }>("/api/modules/finance/reports/cost-center-statement", async (request, reply) => {
    const departmentId = await department(request, reply); if (!departmentId) return reply;
    const year = request.query.year && /^\d{4}$/.test(request.query.year) ? Number(request.query.year) : new Date().getFullYear();
    const result = await pool!.query(`SELECT c.id,c.code,c.name,COALESCE(sum(CASE WHEN t.id IS NOT NULL THEN l.debit_cents ELSE 0 END),0)::text AS "debitCents",COALESCE(sum(CASE WHEN t.id IS NOT NULL THEN l.credit_cents ELSE 0 END),0)::text AS "creditCents",count(DISTINCT t.id)::int AS "transactionCount" FROM finance_cost_centers c LEFT JOIN finance_transaction_lines l ON l.department_id=c.department_id AND l.cost_center_id=c.id LEFT JOIN finance_transactions t ON t.department_id=l.department_id AND t.id=l.transaction_id AND t.status='posted' AND t.accounting_year=$2 WHERE c.department_id=$1 GROUP BY c.id ORDER BY c.code`, [departmentId, year]);
    return { accountingYear: year, costCenters: result.rows.map((row) => ({ ...row, debitCents: asMoney(row.debitCents), creditCents: asMoney(row.creditCents) })) };
  });

  app.get<{ Querystring: { accountId?: string; from?: string; to?: string } }>("/api/modules/finance/reports/account-statement.:format", { schema: { querystring: { type: "object", additionalProperties: false, required: ["accountId"], properties: { accountId: uuid, from: { type: "string", format: "date" }, to: { type: "string", format: "date" } } } } }, async (request, reply) => {
    if (!["csv", "xlsx", "html", "pdf"].includes((request.params as { format: string }).format)) return reply.code(404).send({ error: "Export format not found." });
    const departmentId = await department(request, reply, true); if (!departmentId) return reply;
    if ((request.query.from && !validDateOnly(request.query.from)) || (request.query.to && !validDateOnly(request.query.to)) || (request.query.from && request.query.to && request.query.from > request.query.to)) return reply.code(400).send({ error: "Choose a valid account-statement date range." });
    const result = await pool!.query(`WITH entries AS (
        SELECT t.booking_date,t.accounting_year,t.receipt_number,t.booking_text,l.line_text,l.debit_cents,l.credit_cents,t.created_at,t.id,l.line_number,
               sum(l.debit_cents-l.credit_cents) OVER (ORDER BY t.booking_date,t.created_at,t.id,l.line_number) AS running_balance_cents
          FROM finance_transaction_lines l JOIN finance_transactions t ON t.id=l.transaction_id AND t.department_id=l.department_id
         WHERE l.department_id=$1 AND l.account_id=$2 AND t.status='posted'
      )
      SELECT booking_date,accounting_year,receipt_number,booking_text,line_text,debit_cents,credit_cents,running_balance_cents
        FROM entries WHERE ($3::date IS NULL OR booking_date >= $3) AND ($4::date IS NULL OR booking_date <= $4)
       ORDER BY booking_date,created_at,id,line_number`, [departmentId, request.query.accountId, request.query.from ?? null, request.query.to ?? null]);
    const header = ["booking_date", "accounting_year", "receipt_number", "booking_text", "line_text", "debit_cents", "credit_cents", "running_balance_cents"];
    return sendFinanceExport(request, reply, "finance-account-statement", header, result.rows.map((row) => [row.booking_date, row.accounting_year, row.receipt_number, row.booking_text, row.line_text, row.debit_cents, row.credit_cents, row.running_balance_cents]));
  });

  app.get<{ Querystring: { year?: string } }>("/api/modules/finance/reports/cost-center-statement.:format", async (request, reply) => {
    if (!["csv", "xlsx", "html", "pdf"].includes((request.params as { format: string }).format)) return reply.code(404).send({ error: "Export format not found." });
    const departmentId = await department(request, reply, true); if (!departmentId) return reply;
    const year = request.query.year && /^\d{4}$/.test(request.query.year) ? Number(request.query.year) : new Date().getFullYear();
    const result = await pool!.query(`SELECT c.code,c.name,COALESCE(sum(CASE WHEN t.id IS NOT NULL THEN l.debit_cents ELSE 0 END),0) AS debit_cents,
              COALESCE(sum(CASE WHEN t.id IS NOT NULL THEN l.credit_cents ELSE 0 END),0) AS credit_cents,count(DISTINCT t.id)::int AS transaction_count
         FROM finance_cost_centers c LEFT JOIN finance_transaction_lines l ON l.department_id=c.department_id AND l.cost_center_id=c.id
         LEFT JOIN finance_transactions t ON t.department_id=l.department_id AND t.id=l.transaction_id AND t.status='posted' AND t.accounting_year=$2
        WHERE c.department_id=$1 GROUP BY c.id ORDER BY c.code`, [departmentId, year]);
    const header = ["accounting_year", "cost_center_code", "cost_center_name", "debit_cents", "credit_cents", "transaction_count"];
    return sendFinanceExport(request, reply, `finance-cost-centers-${year}`, header, result.rows.map((row) => [year, row.code, row.name, row.debit_cents, row.credit_cents, row.transaction_count]));
  });

  app.get<{ Querystring: { year?: string; report?: string } }>("/api/modules/finance/reports/turnover.:format", async (request, reply) => {
    if (!["csv", "xlsx", "html", "pdf"].includes((request.params as { format: string }).format)) return reply.code(404).send({ error: "Export format not found." });
    const departmentId = await department(request, reply, true); if (!departmentId) return reply;
    const year = request.query.year && /^\d{4}$/.test(request.query.year) ? Number(request.query.year) : new Date().getFullYear();
    const report = request.query.report ?? "trial-balance";
    if (!["trial-balance", "balance-sheet", "profit-loss"].includes(report)) return reply.code(400).send({ error: "Choose a valid turnover report." });
    const result = await pool!.query(`SELECT a.code,a.name,a.account_type,
              COALESCE(sum(CASE WHEN t.id IS NOT NULL THEN l.debit_cents ELSE 0 END),0) AS debit_cents,
              COALESCE(sum(CASE WHEN t.id IS NOT NULL THEN l.credit_cents ELSE 0 END),0) AS credit_cents,
              COALESCE(sum(CASE WHEN t.id IS NOT NULL THEN l.debit_cents-l.credit_cents ELSE 0 END),0) AS net_cents
         FROM finance_accounts a LEFT JOIN finance_transaction_lines l ON l.department_id=a.department_id AND l.account_id=a.id
         LEFT JOIN finance_transactions t ON t.department_id=l.department_id AND t.id=l.transaction_id AND t.status='posted' AND t.accounting_year=$2
        WHERE a.department_id=$1 GROUP BY a.id ORDER BY a.code`, [departmentId, year]);
    const rows = report === "balance-sheet" ? result.rows.filter((row) => ["asset", "liability", "equity"].includes(row.account_type)) : report === "profit-loss" ? result.rows.filter((row) => ["income", "expense"].includes(row.account_type)) : result.rows;
    const header = ["accounting_year", "account_code", "account_name", "account_type", "debit_cents", "credit_cents", "net_cents"];
    return sendFinanceExport(request, reply, `finance-turnover-${report}-${year}`, header, rows.map((row) => [year, row.code, row.name, row.account_type, row.debit_cents, row.credit_cents, row.net_cents]));
  });

  app.get<{ Querystring: { from?: string; to?: string; year?: string; q?: string; donorId?: string; accountId?: string } & TransactionOrderQuery }>("/api/modules/finance/transactions/export.:format", async (request, reply) => {
    if (!["csv", "xlsx", "html", "pdf"].includes((request.params as { format: string }).format)) return reply.code(404).send({ error: "Export format not found." });
    const departmentId = await department(request, reply); if (!departmentId) return reply;
    if ((request.query.from && !validDateOnly(request.query.from)) || (request.query.to && !validDateOnly(request.query.to)) || (request.query.from && request.query.to && request.query.from > request.query.to)) return reply.code(400).send({ error: "Choose a valid date range." });
    const { donorId, accountId } = request.query;
    if (donorId !== undefined && (typeof donorId !== "string" || !transactionFilterIdPattern.test(donorId))) {
      return reply.code(400).send({ error: "Choose a valid Finance donor." });
    }
    if (accountId !== undefined && (typeof accountId !== "string" || !transactionFilterIdPattern.test(accountId))) {
      return reply.code(400).send({ error: "Choose a valid Finance account." });
    }
    const result = await pool!.query(`SELECT t.booking_date,t.accounting_year,t.receipt_number,t.booking_text,a.code AS account_code,a.name AS account_name,c.code AS cost_center_code,d.display_name AS donor_name,l.debit_cents,l.credit_cents,l.line_text FROM finance_transactions t JOIN finance_transaction_lines l ON l.department_id=t.department_id AND l.transaction_id=t.id JOIN finance_accounts a ON a.department_id=l.department_id AND a.id=l.account_id LEFT JOIN finance_cost_centers c ON c.department_id=l.department_id AND c.id=l.cost_center_id LEFT JOIN finance_donors d ON d.department_id=l.department_id AND d.id=l.donor_id WHERE t.department_id=$1 AND t.status='posted' AND ($2::date IS NULL OR t.booking_date >= $2) AND ($3::date IS NULL OR t.booking_date <= $3) AND ($4::smallint IS NULL OR t.accounting_year=$4) AND ($5='' OR t.receipt_number ILIKE '%'||$5||'%' OR t.booking_text ILIKE '%'||$5||'%') ${transactionDonorFilter} ${transactionAccountFilter} ORDER BY ${transactionOrder(request.query, true)}`, [departmentId, request.query.from && /^\d{4}-\d{2}-\d{2}$/.test(request.query.from) ? request.query.from : null, request.query.to && /^\d{4}-\d{2}-\d{2}$/.test(request.query.to) ? request.query.to : null, request.query.year && /^\d{4}$/.test(request.query.year) ? Number(request.query.year) : null, cleanText(request.query.q ?? "").slice(0, 100), donorId ?? null, accountId ?? null]);
    const header = ["booking_date", "accounting_year", "receipt_number", "booking_text", "account_code", "account_name", "cost_center_code", "donor_name", "debit_cents", "credit_cents", "line_text"];
    return sendFinanceExport(request, reply, "finance-transactions", header, result.rows.map((row) => [row.booking_date, row.accounting_year, row.receipt_number, row.booking_text, row.account_code, row.account_name, row.cost_center_code, row.donor_name, row.debit_cents, row.credit_cents, row.line_text]));
  });

  const statementUploadSchema = {
    type: "object", additionalProperties: false, required: ["accountId", "fileName", "csv"],
    properties: { accountId: uuid, fileName: { type: "string", minLength: 1, maxLength: 180 }, csv: { type: "string", minLength: 1, maxLength: 2_000_000 } },
  } as const;
  async function validateStatementAccount(departmentId: string, accountId: string) {
    const result = await pool!.query<{ id: string; account_type: string; active: boolean }>("SELECT id,account_type,active FROM finance_accounts WHERE department_id=$1 AND id=$2", [departmentId, accountId]);
    return result.rows[0]?.account_type === "asset" && result.rows[0]?.active ? result.rows[0] : null;
  }

  app.get("/api/modules/finance/bank-suggestion-rules", async (request, reply) => {
    const departmentId = await department(request, reply); if (!departmentId) return reply;
    return (await pool!.query(
      `SELECT rule.id,rule.account_id AS "accountId",account.code AS "accountCode",account.name AS "accountName",rule.name,
              rule.statement_contains AS "statementContains",rule.transaction_contains AS "transactionContains",rule.priority,rule.active,
              rule.created_at AS "createdAt",rule.updated_at AS "updatedAt"
         FROM finance_bank_suggestion_rules rule JOIN finance_accounts account ON account.department_id=rule.department_id AND account.id=rule.account_id
        WHERE rule.department_id=$1 ORDER BY rule.priority DESC,lower(rule.name),rule.id`, [departmentId],
    )).rows;
  });

  app.post<{ Body: { accountId: string; name: string; statementContains: string; transactionContains: string; priority?: number } }>("/api/modules/finance/bank-suggestion-rules", {
    schema: { body: { type: "object", additionalProperties: false, required: ["accountId", "name", "statementContains", "transactionContains"], properties: { accountId: uuid, name: { type: "string", minLength: 1, maxLength: 100 }, statementContains: { type: "string", minLength: 1, maxLength: 120 }, transactionContains: { type: "string", minLength: 1, maxLength: 120 }, priority: { type: "integer", minimum: 0, maximum: 1000 } } } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply, true); if (!departmentId) return reply; if (!validateMutation(request, reply)) return reply;
    const name = cleanText(request.body.name); const statementContains = cleanText(request.body.statementContains); const transactionContains = cleanText(request.body.transactionContains);
    if (!name || !statementContains || !transactionContains) return reply.code(400).send({ error: "Enter a rule name and both matching phrases." });
    const validAccount = await validateStatementAccount(departmentId, request.body.accountId);
    if (!validAccount) return reply.code(400).send({ error: "Choose an active asset account for the bank rule." });
    const client = await pool!.connect(); const id = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO finance_bank_suggestion_rules(id,department_id,account_id,name,statement_contains,transaction_contains,priority,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)", [id, departmentId, request.body.accountId, name, statementContains, transactionContains, request.body.priority ?? 100, request.authenticatedUser?.id ?? null]);
      await audit(client, departmentId, request, "bank_suggestion_rule_created", "bank_suggestion_rule", id, { accountId: request.body.accountId, name, statementContains, transactionContains, priority: request.body.priority ?? 100 });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "23505") return reply.code(409).send({ error: "A bank suggestion rule with that name already exists." });
      throw error;
    } finally { client.release(); }
    publish(departmentId, "bank-suggestion-rule-created", id);
    return reply.code(201).send({ id, accountId: request.body.accountId, name, statementContains, transactionContains, priority: request.body.priority ?? 100, active: true });
  });

  app.patch<{ Params: { id: string }; Body: { active: boolean } }>("/api/modules/finance/bank-suggestion-rules/:id", {
    schema: { params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: uuid } }, body: { type: "object", additionalProperties: false, required: ["active"], properties: { active: { type: "boolean" } } } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply, true); if (!departmentId) return reply; if (!validateMutation(request, reply)) return reply;
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query("UPDATE finance_bank_suggestion_rules SET active=$3,updated_by=$4,updated_at=now() WHERE department_id=$1 AND id=$2 RETURNING id", [departmentId, request.params.id, request.body.active, request.authenticatedUser?.id ?? null]);
      if (!result.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Bank suggestion rule not found." }); }
      await audit(client, departmentId, request, request.body.active ? "bank_suggestion_rule_enabled" : "bank_suggestion_rule_disabled", "bank_suggestion_rule", request.params.id, { active: request.body.active });
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    publish(departmentId, "bank-suggestion-rule-updated", request.params.id);
    return { updated: true };
  });

  app.delete<{ Params: { id: string } }>("/api/modules/finance/bank-suggestion-rules/:id", {
    schema: { params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: uuid } } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply, true); if (!departmentId) return reply; if (!validateMutation(request, reply)) return reply;
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query("DELETE FROM finance_bank_suggestion_rules WHERE department_id=$1 AND id=$2 RETURNING id,name,statement_contains,transaction_contains,account_id", [departmentId, request.params.id]);
      if (!result.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Bank suggestion rule not found." }); }
      const rule = result.rows[0]!;
      await audit(client, departmentId, request, "bank_suggestion_rule_deleted", "bank_suggestion_rule", request.params.id, rule);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    publish(departmentId, "bank-suggestion-rule-deleted", request.params.id);
    return { deleted: true };
  });

  app.post<{ Body: { accountId: string; fileName: string; csv: string } }>("/api/modules/finance/bank-statements/preview", { bodyLimit: 2_200_000, schema: { body: statementUploadSchema } }, async (request, reply) => {
    const departmentId = await department(request, reply); if (!departmentId) return reply;
    const account = await validateStatementAccount(departmentId, request.body.accountId);
    if (!account) return reply.code(400).send({ error: "Choose an active asset account for this statement." });
    const parsed = parseCsvRows(request.body.csv);
    if (typeof parsed === "string") return reply.code(400).send({ error: parsed });
    const headers = parsed[0]!.map((value, index) => (index === 0 ? value.replace(/^\uFEFF/, "") : value).trim().slice(0, 120));
    const contentHash = createHash("sha256").update(request.body.csv, "utf8").digest("hex");
    const duplicate = await pool!.query("SELECT id FROM finance_bank_statement_imports WHERE department_id=$1 AND account_id=$2 AND content_sha256=$3", [departmentId, request.body.accountId, contentHash]);
    return { headers, rowCount: parsed.length - 1, duplicate: Boolean(duplicate.rowCount), sample: parsed.slice(1, 6).map((row) => row.map((value) => value.slice(0, 200))) };
  });

  app.post<{ Body: { accountId: string; fileName: string; csv: string; mapping: { date: number; amount: number; description?: number | null; reference?: number | null } } }>("/api/modules/finance/bank-statements/import", {
    bodyLimit: 2_200_000,
    schema: { body: { ...statementUploadSchema, required: ["accountId", "fileName", "csv", "mapping"], properties: { ...statementUploadSchema.properties, mapping: { type: "object", additionalProperties: false, required: ["date", "amount"], properties: { date: { type: "integer", minimum: 0, maximum: 49 }, amount: { type: "integer", minimum: 0, maximum: 49 }, description: { anyOf: [{ type: "integer", minimum: 0, maximum: 49 }, { type: "null" }] }, reference: { anyOf: [{ type: "integer", minimum: 0, maximum: 49 }, { type: "null" }] } } } } } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply, true); if (!departmentId) return reply;
    if (!validateMutation(request, reply)) return reply;
    if (!await validateStatementAccount(departmentId, request.body.accountId)) return reply.code(400).send({ error: "Choose an active asset account for this statement." });
    const parsed = parseCsvRows(request.body.csv);
    if (typeof parsed === "string") return reply.code(400).send({ error: parsed });
    const headers = parsed[0]!.map((value, index) => (index === 0 ? value.replace(/^\uFEFF/, "") : value).trim().slice(0, 120));
    const { date: dateColumn, amount: amountColumn, description: descriptionColumn, reference: referenceColumn } = request.body.mapping;
    const selected = [dateColumn, amountColumn, descriptionColumn, referenceColumn].filter((value): value is number => typeof value === "number");
    if (selected.some((value) => value < 0 || value >= headers.length) || new Set(selected).size !== selected.length) return reply.code(400).send({ error: "Map each statement column to a different CSV column." });
    const rows: Array<{ line: number; date: string; amount: number; description: string; reference: string }> = [];
    const errors: string[] = [];
    for (let index = 1; index < parsed.length; index += 1) {
      const values = parsed[index]!;
      const date = statementDate(values[dateColumn] ?? "");
      const amount = statementAmount(values[amountColumn] ?? "");
      if (!date) errors.push(`Row ${index + 1}: date is invalid.`);
      if (amount === null) errors.push(`Row ${index + 1}: amount is invalid or zero.`);
      if (errors.length >= 50) break;
      if (date && amount !== null) rows.push({ line: index + 1, date, amount, description: cleanText(values[descriptionColumn ?? -1] ?? "").slice(0, 500), reference: cleanText(values[referenceColumn ?? -1] ?? "").slice(0, 180) });
    }
    if (errors.length) return reply.code(400).send({ error: "Fix the CSV rows before importing.", details: errors });
    const contentHash = createHash("sha256").update(request.body.csv, "utf8").digest("hex");
    const fileName = cleanText(request.body.fileName).replace(/[\\/]/g, "_").slice(0, 180) || "statement.csv";
    const duplicate = await pool!.query("SELECT id FROM finance_bank_statement_imports WHERE department_id=$1 AND account_id=$2 AND content_sha256=$3", [departmentId, request.body.accountId, contentHash]);
    if (duplicate.rowCount) return reply.code(409).send({ error: "This exact statement file has already been imported for the selected account." });
    const minDate = rows.reduce((min, row) => row.date < min ? row.date : min, rows[0]!.date);
    const maxDate = rows.reduce((max, row) => row.date > max ? row.date : max, rows[0]!.date);
    const candidates = await pool!.query<{ id: string; booking_date: string; receipt_number: string; booking_text: string; amount_cents: string }>(
      `SELECT transaction.id,transaction.booking_date::text,transaction.receipt_number,transaction.booking_text,
              sum(line.debit_cents-line.credit_cents)::text AS amount_cents
         FROM finance_transactions transaction JOIN finance_transaction_lines line ON line.department_id=transaction.department_id AND line.transaction_id=transaction.id
        WHERE transaction.department_id=$1 AND transaction.status='posted' AND line.account_id=$2
          AND transaction.booking_date BETWEEN ($3::date - 3) AND ($4::date + 3)
        GROUP BY transaction.id ORDER BY transaction.booking_date DESC LIMIT 20000`, [departmentId, request.body.accountId, minDate, maxDate],
    );
    const parsedCandidates = candidates.rows.map((candidate) => ({ ...candidate, amount: asMoney(candidate.amount_cents) }));
    const ruleRows = await pool!.query<{ statement_contains: string; transaction_contains: string }>(
      "SELECT statement_contains,transaction_contains FROM finance_bank_suggestion_rules WHERE department_id=$1 AND account_id=$2 AND active ORDER BY priority DESC,created_at,id LIMIT 500",
      [departmentId, request.body.accountId],
    );
    const rules = ruleRows.rows.map((rule) => ({ statement: rule.statement_contains.toLocaleLowerCase(), transaction: rule.transaction_contains.toLocaleLowerCase() }));
    let ruleAppliedRows = 0;
    const suggested = rows.map((row) => {
      const statementText = `${row.description} ${row.reference}`.toLocaleLowerCase();
      const appliedRule = rules.find((rule) => statementText.includes(rule.statement));
      if (appliedRule) ruleAppliedRows += 1;
      const matches = parsedCandidates.filter((candidate) => candidate.amount === row.amount
        && Math.abs(Date.parse(candidate.booking_date) - Date.parse(row.date)) <= 3 * 86_400_000
        && (!appliedRule || `${candidate.booking_text} ${candidate.receipt_number}`.toLocaleLowerCase().includes(appliedRule.transaction)));
      return matches.length === 1 ? matches[0]!.id : null;
    });
    const batchId = randomUUID(); const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO finance_bank_statement_imports(id,department_id,account_id,file_name,content_sha256,imported_by,row_count) VALUES($1,$2,$3,$4,$5,$6,$7)", [batchId, departmentId, request.body.accountId, fileName, contentHash, request.authenticatedUser?.id ?? null, rows.length]);
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index]!; const suggestedTransactionId = suggested[index];
        await client.query("INSERT INTO finance_bank_statement_rows(id,department_id,import_id,line_number,booking_date,description,reference,amount_cents,status,suggested_transaction_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [randomUUID(), departmentId, batchId, row.line, row.date, row.description, row.reference, row.amount, suggestedTransactionId ? "suggested" : "unmatched", suggestedTransactionId]);
      }
      await audit(client, departmentId, request, "bank_statement_imported", "bank_statement_import", batchId, { fileName, rowCount: rows.length, accountId: request.body.accountId, suggestedCount: suggested.filter(Boolean).length, activeRuleCount: rules.length, ruleAppliedRows });
      await client.query("COMMIT");
      publish(departmentId, "bank-statement-imported", batchId);
      return reply.code(201).send({ id: batchId, rowCount: rows.length, suggestedCount: suggested.filter(Boolean).length });
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "23505") return reply.code(409).send({ error: "This statement file has already been imported." });
      throw error;
    } finally { client.release(); }
  });

  app.get("/api/modules/finance/bank-statements", async (request, reply) => {
    const departmentId = await department(request, reply); if (!departmentId) return reply;
    return (await pool!.query(`SELECT imported.id,imported.file_name AS "fileName",imported.imported_at AS "importedAt",imported.row_count AS "rowCount",account.code AS "accountCode",account.name AS "accountName",
      count(row.id) FILTER(WHERE row.status='matched')::int AS matched,count(row.id) FILTER(WHERE row.status='suggested')::int AS suggested,count(row.id) FILTER(WHERE row.status='unmatched')::int AS unmatched,count(row.id) FILTER(WHERE row.status='ignored')::int AS ignored
      FROM finance_bank_statement_imports imported JOIN finance_accounts account ON account.department_id=imported.department_id AND account.id=imported.account_id LEFT JOIN finance_bank_statement_rows row ON row.department_id=imported.department_id AND row.import_id=imported.id
      WHERE imported.department_id=$1 GROUP BY imported.id,account.code,account.name ORDER BY imported.imported_at DESC LIMIT 100`, [departmentId])).rows;
  });

  app.get<{ Params: { id: string } }>("/api/modules/finance/bank-statements/:id", { schema: { params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: uuid } } } }, async (request, reply) => {
    const departmentId = await department(request, reply); if (!departmentId) return reply;
    const result = await pool!.query(`SELECT row.id,row.line_number AS "lineNumber",row.booking_date AS "bookingDate",row.description,row.reference,row.amount_cents AS "amountCents",row.status,row.suggested_transaction_id AS "suggestedTransactionId",row.matched_transaction_id AS "matchedTransactionId",transaction.receipt_number AS "transactionReceipt",transaction.booking_text AS "transactionText"
      FROM finance_bank_statement_rows row JOIN finance_bank_statement_imports imported ON imported.department_id=row.department_id AND imported.id=row.import_id LEFT JOIN finance_transactions transaction ON transaction.department_id=row.department_id AND transaction.id=COALESCE(row.matched_transaction_id,row.suggested_transaction_id)
      WHERE row.department_id=$1 AND imported.id=$2 ORDER BY row.line_number LIMIT 20000`, [departmentId, request.params.id]);
    return result.rows.map((row) => ({ ...row, amountCents: asMoney(row.amountCents) }));
  });

  app.put<{ Params: { id: string }; Body: { action: "match" | "ignore"; transactionId?: string } }>("/api/modules/finance/bank-statement-rows/:id/reconcile", {
    schema: { params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: uuid } }, body: { type: "object", additionalProperties: false, required: ["action"], properties: { action: { type: "string", enum: ["match", "ignore"] }, transactionId: uuid } } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply, true); if (!departmentId) return reply;
    if (!validateMutation(request, reply)) return reply;
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      const row = await client.query<{ id: string; import_id: string; account_id: string; amount_cents: string; booking_date: string; status: string }>("SELECT row.id,row.import_id,imported.account_id,row.amount_cents::text,row.booking_date::text,row.status FROM finance_bank_statement_rows row JOIN finance_bank_statement_imports imported ON imported.department_id=row.department_id AND imported.id=row.import_id WHERE row.department_id=$1 AND row.id=$2 FOR UPDATE OF row", [departmentId, request.params.id]);
      if (!row.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Statement row not found." }); }
      if (!["unmatched", "suggested"].includes(row.rows[0]!.status)) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "This row has already been reconciled or ignored." }); }
      let transactionId: string | null = null;
      if (request.body.action === "match") {
        transactionId = request.body.transactionId ?? null;
        if (!transactionId) { await client.query("ROLLBACK"); return reply.code(400).send({ error: "Choose a posted ledger transaction to match." }); }
        const posting = await client.query("SELECT transaction.id FROM finance_transactions transaction JOIN finance_transaction_lines line ON line.department_id=transaction.department_id AND line.transaction_id=transaction.id WHERE transaction.department_id=$1 AND transaction.id=$2 AND transaction.status='posted' AND line.account_id=$3 GROUP BY transaction.id HAVING sum(line.debit_cents-line.credit_cents)=$4", [departmentId, transactionId, row.rows[0]!.account_id, row.rows[0]!.amount_cents]);
        if (!posting.rowCount) { await client.query("ROLLBACK"); return reply.code(400).send({ error: "The selected posting does not match this bank account and amount." }); }
      }
      await client.query("UPDATE finance_bank_statement_rows SET status=$3,matched_transaction_id=$4,reconciled_by=$5,reconciled_at=now() WHERE department_id=$1 AND id=$2", [departmentId, request.params.id, request.body.action === "match" ? "matched" : "ignored", transactionId, request.authenticatedUser?.id ?? null]);
      await audit(client, departmentId, request, request.body.action === "match" ? "bank_statement_row_matched" : "bank_statement_row_ignored", "bank_statement_row", request.params.id, { importId: row.rows[0]!.import_id, transactionId });
      await client.query("COMMIT");
      publish(departmentId, "bank-statement-row-reconciled", request.params.id);
      return { status: request.body.action === "match" ? "matched" : "ignored", transactionId };
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "23505") return reply.code(409).send({ error: "That ledger posting is already matched to a statement row." });
      throw error;
    }
    finally { client.release(); }
  });
}
