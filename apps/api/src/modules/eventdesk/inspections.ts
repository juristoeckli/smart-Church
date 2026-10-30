import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";

export function startEventDeskInspectionWorker(app: FastifyInstance, pool: Pool | null, isDepartmentWritable: (departmentId: string) => Promise<boolean>) {
  if (!pool) return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const due = await client.query(`SELECT s.*,coalesce(s.asset_id,u.asset_id) AS service_asset_id,a.name AS asset_name,u.serial_number
        FROM eventdesk_inspection_schedules s LEFT JOIN eventdesk_asset_units u ON u.id=s.unit_id AND u.department_id=s.department_id
        JOIN eventdesk_assets a ON a.id=coalesce(s.asset_id,u.asset_id) AND a.department_id=s.department_id
        JOIN departments d ON d.id=s.department_id AND 'eventdesk'=ANY(d.enabled_modules)
        WHERE s.active=true AND s.next_due_date<=CURRENT_DATE
        ORDER BY s.next_due_date LIMIT 100 FOR UPDATE OF s SKIP LOCKED`);
      for (const schedule of due.rows) {
        if (!(await isDepartmentWritable(schedule.department_id))) continue;
        const ticketId = randomUUID();
        const dueDate = schedule.next_due_date instanceof Date ? schedule.next_due_date.toISOString().slice(0, 10) : String(schedule.next_due_date).slice(0, 10);
        await client.query(`INSERT INTO eventdesk_service_tickets
          (id,department_id,asset_id,unit_id,inspection_schedule_id,owner_user_id,kind,title,fault,priority,status,due_date,inspection_due_date)
          VALUES ($1,$2,$3,$4,$5,$6,'inspection',$7,$8,'normal','open',$9,$9)
          ON CONFLICT (department_id,inspection_schedule_id,inspection_due_date) WHERE inspection_schedule_id IS NOT NULL DO NOTHING`,
        [ticketId, schedule.department_id, schedule.service_asset_id, schedule.unit_id, schedule.id, schedule.owner_user_id, `Scheduled inspection: ${schedule.asset_name}${schedule.serial_number ? ` · ${schedule.serial_number}` : ""}`, schedule.notes ?? "", dueDate]);
        const ticket = await client.query("SELECT id FROM eventdesk_service_tickets WHERE department_id=$1 AND inspection_schedule_id=$2 AND inspection_due_date=$3", [schedule.department_id, schedule.id, dueDate]);
        if (ticket.rowCount) {
          const existing = await client.query("SELECT id FROM eventdesk_asset_maintenance WHERE department_id=$1 AND service_ticket_id=$2", [schedule.department_id, ticket.rows[0].id]);
          let maintenanceId = existing.rows[0]?.id as string | undefined;
          if (!maintenanceId) {
            const created = await client.query(`INSERT INTO eventdesk_asset_maintenance (id,department_id,asset_id,starts_at,ends_at,quantity,status,notes,service_ticket_id)
              VALUES ($1,$2,$3,CURRENT_DATE,CURRENT_DATE + interval '10 years',1,'scheduled',$4,$5) RETURNING id`, [randomUUID(), schedule.department_id, schedule.service_asset_id, `Inspection ${dueDate}`, ticket.rows[0].id]);
            maintenanceId = created.rows[0].id;
          }
          await client.query("UPDATE eventdesk_service_tickets SET maintenance_id=$3 WHERE id=$1 AND department_id=$2", [ticket.rows[0].id, schedule.department_id, maintenanceId]);
          if (!existing.rowCount) {
            if (schedule.unit_id) await client.query("UPDATE eventdesk_asset_units SET status='maintenance',updated_at=now() WHERE id=$1 AND department_id=$2 AND status NOT IN ('checked_out','retired')", [schedule.unit_id, schedule.department_id]);
          }
        }
        await client.query(`UPDATE eventdesk_inspection_schedules SET next_due_date=GREATEST(next_due_date + interval_days,CURRENT_DATE + interval_days),updated_at=now() WHERE id=$1 AND department_id=$2`, [schedule.id, schedule.department_id]);
      }
      await client.query("COMMIT");
      await sendDueInspectionReminders(pool, isDepartmentWritable);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      app.log.error({ err: error, module: "eventdesk-inspections" }, "Inspection schedule cycle failed.");
    } finally {
      client.release();
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), 60 * 60_000);
  timer.unref();
  app.addHook("onClose", async () => { clearInterval(timer); });
  void tick();
}

async function sendDueInspectionReminders(pool: Pool, isDepartmentWritable: (departmentId: string) => Promise<boolean>) {
  const candidates = await pool.query<{ department_id: string; schedule_id: string; due_date: string; owner_user_id: string; owner_email: string; asset_name: string; serial_number: string | null }>(`SELECT s.department_id,s.id AS schedule_id,s.next_due_date::text AS due_date,s.owner_user_id,u.email AS owner_email,a.name AS asset_name,unit.serial_number
    FROM eventdesk_inspection_schedules s
    LEFT JOIN eventdesk_asset_units unit ON unit.id=s.unit_id AND unit.department_id=s.department_id
    JOIN eventdesk_assets a ON a.id=coalesce(s.asset_id,unit.asset_id) AND a.department_id=s.department_id
    JOIN app_users u ON u.id=s.owner_user_id
    JOIN departments d ON d.id=s.department_id AND 'eventdesk'=ANY(d.enabled_modules)
    WHERE s.active=true AND s.next_due_date BETWEEN CURRENT_DATE AND CURRENT_DATE+7
      AND nullif(trim(u.email),'') IS NOT NULL
    ORDER BY s.next_due_date LIMIT 100`);
  for (const row of candidates.rows) {
    if (!(await isDepartmentWritable(row.department_id))) continue;
    const id = randomUUID();
    const claim = await pool.query(`INSERT INTO eventdesk_inspection_reminder_attempts (id,department_id,schedule_id,inspection_due_date,recipient_email,status)
      VALUES ($1,$2,$3,$4,$5,'pending')
      ON CONFLICT (department_id,schedule_id,inspection_due_date) DO UPDATE SET recipient_email=EXCLUDED.recipient_email
      WHERE eventdesk_inspection_reminder_attempts.status='pending'
      RETURNING id`, [id, row.department_id, row.schedule_id, row.due_date, row.owner_email]);
    if (!claim.rowCount) continue;
    const key = process.env.SMART_CHURCH_RESEND_API_KEY?.trim() || process.env.RESEND_API_KEY?.trim() || "";
    const from = process.env.SMART_CHURCH_EMAIL_FROM?.trim() || process.env.EVENTDESK_EMAIL_FROM?.trim() || "";
    let status = "failed";
    let providerId = "";
    let error = "";
    if (!key || !from) error = "Email delivery is not configured.";
    else {
      const item = `${row.asset_name}${row.serial_number ? ` · ${row.serial_number}` : ""}`;
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to: [row.owner_email], subject: `Inspection due soon: ${item}`, html: `<p>An inspection for <strong>${escapeHtml(item)}</strong> is due on ${escapeHtml(row.due_date)}.</p><p>Open EventDesk to review the inspection schedule and service ticket.</p>` }),
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
    await pool.query(`UPDATE eventdesk_inspection_reminder_attempts SET status=$3,provider_message_id=$4,error_summary=$5,sent_at=CASE WHEN $3='sent' THEN now() ELSE NULL END
      WHERE id=$1 AND department_id=$2`, [claim.rows[0].id, row.department_id, status, providerId, error]);
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]!);
}
