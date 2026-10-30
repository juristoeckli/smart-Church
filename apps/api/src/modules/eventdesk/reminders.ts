import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Pool, PoolClient } from "pg";
import { createDocumentEmailHtml, createDocumentPdf } from "./documents.js";

const apiKey = () => process.env.SMART_CHURCH_RESEND_API_KEY?.trim() || process.env.RESEND_API_KEY?.trim() || "";
const emailFrom = () => process.env.SMART_CHURCH_EMAIL_FROM?.trim() || process.env.EVENTDESK_EMAIL_FROM?.trim() || "";
const money = (cents: number) => `CHF ${(cents / 100).toFixed(2)}`;

type ReminderSettings = { enabled: boolean; delay_days: number[]; max_attempts: number };

export function startEventDeskReminderWorker(app: FastifyInstance, pool: Pool | null, isDepartmentWritable: (departmentId: string) => Promise<boolean>) {
  if (!pool) return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const locations = await pool.query<{ id: string; delay_days: number[]; max_attempts: number }>(`SELECT s.department_id AS id,s.delay_days,s.max_attempts
        FROM eventdesk_reminder_settings s JOIN departments d ON d.id=s.department_id
        WHERE s.enabled=true AND 'eventdesk'=ANY(d.enabled_modules)`);
      for (const location of locations.rows) {
        if (!(await isDepartmentWritable(location.id))) continue;
        const delayDays = location.delay_days.slice(0, Math.min(location.max_attempts, 10));
        if (!delayDays.length) continue;
        const candidates = await pool.query<{ id: string; overdue_days: number }>(`SELECT d.id,(CURRENT_DATE-d.due_date)::int AS overdue_days
          FROM eventdesk_documents d
          WHERE d.department_id=$1 AND d.kind IN ('invoice','deposit_invoice') AND d.status IN ('sent','partial')
            AND d.due_date IS NOT NULL AND d.due_date<CURRENT_DATE AND d.reminders_paused=false
            AND d.total_cents
              -coalesce((SELECT sum(p.amount_cents) FROM eventdesk_document_payments p WHERE p.document_id=d.id AND p.department_id=d.department_id),0)::int
              -coalesce((SELECT sum(c.total_cents) FROM eventdesk_documents c WHERE c.related_document_id=d.id AND c.department_id=d.department_id AND c.kind='credit_note' AND c.status IN ('draft','sent')),0)::int > 0
          ORDER BY d.due_date,d.created_at LIMIT 100`, [location.id]);
        for (const candidate of candidates.rows) {
          if (!(await isDepartmentWritable(location.id))) break;
          const windowIndex = delayDays.reduce((latest, delay, index) => candidate.overdue_days >= delay ? index : latest, -1);
          if (windowIndex < 0) continue;
          await sendScheduledReminder(pool, location.id, candidate.id, windowIndex + 1, delayDays[windowIndex], delayDays.length, isDepartmentWritable);
        }
      }
    } catch (error) {
      app.log.error({ err: error, module: "eventdesk-reminders" }, "Scheduled payment reminder cycle failed.");
    } finally { running = false; }
  };
  const timer = setInterval(() => void tick(), 60_000);
  timer.unref();
  app.addHook("onClose", async () => { clearInterval(timer); });
  void tick();
}

async function sendScheduledReminder(pool: Pool, departmentId: string, documentId: string, attemptNo: number, delayDays: number, maxAttempts: number, isDepartmentWritable: (departmentId: string) => Promise<boolean>) {
  if (!(await isDepartmentWritable(departmentId))) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const invoice = await client.query(`SELECT d.id,d.kind,d.status,d.due_date,d.document_number,d.customer_snapshot,d.lines,d.tax_rate_bps,d.subtotal_cents,d.tax_cents,d.total_cents,d.branding_snapshot,d.logo_snapshot,j.title AS job_title,original.document_number AS related_document_number,
        d.total_cents
          -coalesce((SELECT sum(p.amount_cents) FROM eventdesk_document_payments p WHERE p.document_id=d.id AND p.department_id=d.department_id),0)::int
          -coalesce((SELECT sum(c.total_cents) FROM eventdesk_documents c WHERE c.related_document_id=d.id AND c.department_id=d.department_id AND c.kind='credit_note' AND c.status IN ('draft','sent')),0)::int AS balance_cents,
        coalesce((d.customer_snapshot->>'email'),'') AS customer_email
      FROM eventdesk_documents d JOIN eventdesk_jobs j ON j.id=d.job_id AND j.department_id=d.department_id
      LEFT JOIN eventdesk_documents original ON original.id=d.related_document_id AND original.department_id=d.department_id
      WHERE d.id=$1 AND d.department_id=$2 AND d.kind IN ('invoice','deposit_invoice') AND d.status IN ('sent','partial')
        AND d.due_date IS NOT NULL AND d.due_date + $3::int <= CURRENT_DATE AND d.reminders_paused=false
      FOR UPDATE OF d`, [documentId, departmentId, delayDays]);
    if (!invoice.rowCount || Number(invoice.rows[0].balance_cents) <= 0) { await client.query("ROLLBACK"); return; }
    const row = invoice.rows[0];
    const insert = await client.query(`INSERT INTO eventdesk_reminder_attempts (id,department_id,document_id,attempt_no,delay_days,recipient_email,status)
      VALUES ($1,$2,$3,$4,$5,$6,'pending') ON CONFLICT (department_id,document_id,attempt_no) DO NOTHING RETURNING id`, [randomUUID(), departmentId, documentId, attemptNo, delayDays, row.customer_email]);
    if (!insert.rowCount) { await client.query("ROLLBACK"); return; }

    let status: "sent" | "failed" = "failed";
    let providerId = "";
    let error = "";
    const key = apiKey();
    const from = emailFrom();
    if (!key || !from) error = "Email delivery is not configured.";
    else if (!row.customer_email.trim()) error = "This customer has no email address.";
    else {
      const document = { id: row.id, number: row.document_number, kind: row.kind, issueDate: new Date().toISOString().slice(0, 10), dueDate: row.due_date, relatedDocumentNumber: row.related_document_number, customer: row.customer_snapshot, jobTitle: row.job_title, lines: row.lines, taxRateBps: row.tax_rate_bps, subtotalCents: row.subtotal_cents, taxCents: row.tax_cents, totalCents: row.total_cents, balanceCents: Number(row.balance_cents) };
      const saved = row.branding_snapshot ?? {};
      const branding = { businessName: saved.businessName ?? "", street: saved.street ?? "", postalCode: saved.postalCode ?? "", city: saved.city ?? "", country: saved.country ?? "", email: saved.email ?? "", phone: saved.phone ?? "", taxIdentifier: saved.taxIdentifier ?? "", paymentTerms: saved.paymentTerms ?? "", footer: saved.footer ?? "", template: saved.template, taxProfileName: saved.taxProfileName, legalText: saved.legalText, swissQrBill: saved.swissQrBill, logoJpeg: row.logo_snapshot ? Buffer.from(row.logo_snapshot) : null };
      const pdf = createDocumentPdf(document, branding);
      const subject = `Payment reminder: ${row.document_number}`;
      const message = `This is reminder ${attemptNo} of ${maxAttempts} for invoice ${row.document_number}. The overdue balance is ${money(Number(row.balance_cents))}.`;
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to: [row.customer_email], subject, html: createDocumentEmailHtml(document, branding, message, { balanceCents: Number(row.balance_cents) }), attachments: [{ filename: `${row.document_number}.pdf`, content: pdf.toString("base64") }] }),
        signal: AbortSignal.timeout(20_000),
      }).catch(() => null);
      if (!response) error = "The email provider did not respond before the request timed out.";
      else if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { message?: string; error?: string };
        error = (body.message ?? body.error ?? `Email provider returned HTTP ${response.status}.`).slice(0, 500);
      } else {
        const body = await response.json().catch(() => ({})) as { id?: string };
        providerId = body.id ?? "";
        status = "sent";
      }
    }
    await client.query(`UPDATE eventdesk_reminder_attempts SET status=$3,provider_message_id=$4,error_summary=$5,sent_at=CASE WHEN $3='sent' THEN now() ELSE NULL END WHERE id=$1 AND department_id=$2`, [insert.rows[0].id, departmentId, status, providerId, error]);
    await client.query(`INSERT INTO eventdesk_document_deliveries (id,department_id,document_id,recipient_email,subject,status,provider_message_id,error_summary,sent_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $6='sent' THEN now() ELSE NULL END)`, [randomUUID(), departmentId, documentId, row.customer_email, `Payment reminder: ${row.document_number}`, status, providerId, error]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
