import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";

export function startEventDeskInspectionWorker(app: FastifyInstance, pool: Pool | null) {
  if (!pool) return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const due = await client.query(`SELECT s.*,a.name AS asset_name,u.serial_number
        FROM eventdesk_inspection_schedules s JOIN eventdesk_assets a ON a.id=s.asset_id AND a.department_id=s.department_id
        JOIN departments d ON d.id=s.department_id AND 'eventdesk'=ANY(d.enabled_modules)
        LEFT JOIN eventdesk_asset_units u ON u.id=s.unit_id AND u.department_id=s.department_id
        WHERE s.active=true AND s.next_due_date<=CURRENT_DATE
        ORDER BY s.next_due_date LIMIT 100 FOR UPDATE OF s SKIP LOCKED`);
      for (const schedule of due.rows) {
        const ticketId = randomUUID();
        const dueDate = schedule.next_due_date instanceof Date ? schedule.next_due_date.toISOString().slice(0, 10) : String(schedule.next_due_date).slice(0, 10);
        await client.query(`INSERT INTO eventdesk_service_tickets
          (id,department_id,asset_id,unit_id,inspection_schedule_id,kind,title,fault,priority,status,due_date,inspection_due_date)
          VALUES ($1,$2,$3,$4,$5,'inspection',$6,$7,'normal','open',$8,$8)
          ON CONFLICT (department_id,inspection_schedule_id,inspection_due_date) WHERE inspection_schedule_id IS NOT NULL DO NOTHING`,
        [ticketId, schedule.department_id, schedule.asset_id, schedule.unit_id, schedule.id, `Scheduled inspection: ${schedule.asset_name}${schedule.serial_number ? ` · ${schedule.serial_number}` : ""}`, schedule.notes ?? "", dueDate]);
        const ticket = await client.query("SELECT id FROM eventdesk_service_tickets WHERE department_id=$1 AND inspection_schedule_id=$2 AND inspection_due_date=$3", [schedule.department_id, schedule.id, dueDate]);
        if (ticket.rowCount) {
          const existing = await client.query("SELECT id FROM eventdesk_asset_maintenance WHERE department_id=$1 AND service_ticket_id=$2", [schedule.department_id, ticket.rows[0].id]);
          if (!existing.rowCount) {
            await client.query(`INSERT INTO eventdesk_asset_maintenance (id,department_id,asset_id,starts_at,ends_at,quantity,status,notes,service_ticket_id)
              VALUES ($1,$2,$3,CURRENT_DATE,CURRENT_DATE + interval '10 years',1,'scheduled',$4,$5)`, [randomUUID(), schedule.department_id, schedule.asset_id, `Inspection ${dueDate}`, ticket.rows[0].id]);
            if (schedule.unit_id) await client.query("UPDATE eventdesk_asset_units SET status='maintenance',updated_at=now() WHERE id=$1 AND department_id=$2 AND status NOT IN ('checked_out','retired')", [schedule.unit_id, schedule.department_id]);
          }
        }
        await client.query(`UPDATE eventdesk_inspection_schedules SET next_due_date=GREATEST(next_due_date + interval_days,CURRENT_DATE + interval_days),updated_at=now() WHERE id=$1 AND department_id=$2`, [schedule.id, schedule.department_id]);
      }
      await client.query("COMMIT");
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
