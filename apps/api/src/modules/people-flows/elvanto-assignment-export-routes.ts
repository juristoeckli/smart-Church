import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ModuleServerContext } from "../module-sdk.js";
import { createElvantoPeopleFlowClient } from "../churchtools-sync/elvanto-people-flow-client.js";

type JsonObject = Record<string, unknown>;
type ExportState = "queued" | "already_assigned" | "unmatched" | "ambiguous" | "added" | "stale" | "uncertain";
type ExportRow = {
  enrollmentId: string;
  contactId: string;
  sourceFlowId: string;
  sourceStepId: string;
  localFlowId: string;
  localStepId: string;
  personId: string | null;
  fingerprint: string;
  state: ExportState;
};
type ExportRun = {
  id: string;
  department_id: string;
  source_flow_id: string;
  local_flow_id: string;
  status: "preview" | "running" | "complete" | "uncertain" | "expired";
  preview_rows: ExportRow[];
  preview_sample: Array<{ name: string; sourceStepId: string; state: ExportState }>;
  cursor: number;
  added_count: number;
  existing_count: number;
  skipped_count: number;
  settings_fingerprint: string;
  previewed_at: Date | string;
};

function asRows(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.filter((row): row is JsonObject => Boolean(row) && typeof row === "object" && !Array.isArray(row));
  if (value && typeof value === "object") return Object.values(value).filter((row): row is JsonObject => Boolean(row) && typeof row === "object" && !Array.isArray(row));
  return [];
}

function elvantoStepIds(definition: unknown): Set<string> {
  const root = definition && typeof definition === "object" && !Array.isArray(definition) ? definition as JsonObject : {};
  const visit = (steps: unknown): string[] => asRows(steps).flatMap((step) => {
    const id = step.id === undefined || step.id === null ? "" : String(step.id).trim();
    return [...(id ? [id] : []), ...visit(step.steps)];
  });
  return new Set(visit(root.steps));
}

function directionValue(value: unknown) {
  const parsed = typeof value === "string" ? (() => { try { return JSON.parse(value) as unknown; } catch { return null; } })() : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "off";
  const direction = (parsed as JsonObject).peopleFlows;
  return direction === "smart_church_to_elvanto" || direction === "bidirectional" ? String(direction) : "off";
}

function counts(rows: ExportRow[]) {
  return {
    total: rows.length,
    queued: rows.filter((row) => row.state === "queued").length,
    added: rows.filter((row) => row.state === "added").length,
    alreadyAssigned: rows.filter((row) => row.state === "already_assigned").length,
    unmatched: rows.filter((row) => row.state === "unmatched").length,
    ambiguous: rows.filter((row) => row.state === "ambiguous").length,
    stale: rows.filter((row) => row.state === "stale").length,
    uncertain: rows.filter((row) => row.state === "uncertain").length,
  };
}

function runSample(run: ExportRun) {
  return run.preview_sample.map((sample, index) => ({ ...sample, state: run.preview_rows[index]?.state ?? sample.state }));
}

export function registerElvantoPeopleFlowAssignmentExportRoutes(app: FastifyInstance, context: ModuleServerContext) {
  const { pool, isDatabaseReady, resolveDepartmentId, validateMutation } = context;

  async function authorize(request: FastifyRequest, reply: FastifyReply, write: boolean) {
    if (!isDatabaseReady() || !pool) {
      reply.code(503).send({ error: "People Flow export is unavailable because the database is not ready." });
      return null;
    }
    if (write && !validateMutation(request, reply)) return null;
    if (!write) {
      const permissions = request.activeDepartmentPermissions ?? [];
      if (request.activeDepartmentRole !== "site_admin" && !permissions.includes("people_view_private") && !permissions.includes("people_manage")) {
        reply.code(403).send({ error: "You need private People access to view workflow export status." });
        return null;
      }
    }
    const departmentId = await resolveDepartmentId(request, reply, write, false, write ? "people_manage" : undefined);
    if (write && departmentId && !await context.isDepartmentWritable(departmentId)) {
      reply.code(423).send({ error: "This location is read-only while it is configured as a redundancy standby." });
      return null;
    }
    return departmentId;
  }

  async function connectedElvanto(departmentId: string) {
    const result = await pool!.query<{ encrypted_api_key: string; directions: unknown; updated_at: Date | string }>(
      "SELECT encrypted_api_key,directions,updated_at FROM elvanto_sync_settings WHERE department_id=$1",
      [departmentId],
    );
    const setting = result.rows[0];
    if (!setting) throw new Error("Connect Elvanto before exporting People Flow assignments.");
    if (directionValue(setting.directions) === "off") throw new Error("Select Smart Church to Elvanto or bidirectional People Flows sync before exporting assignments.");
    const settingsFingerprint = createHash("sha256").update(JSON.stringify([setting.encrypted_api_key, setting.directions, setting.updated_at])).digest("hex");
    return { client: createElvantoPeopleFlowClient(setting.encrypted_api_key), settingsFingerprint };
  }

  app.register(async (routes) => {
    routes.post<{ Body: { sourceFlowId: string } }>("/api/people-flows/elvanto-crosswalk/export-preview", {
      schema: { body: { type: "object", additionalProperties: false, required: ["sourceFlowId"], properties: { sourceFlowId: { type: "string", minLength: 1, maxLength: 160 } } } },
    }, async (request, reply) => {
      const departmentId = await authorize(request, reply, true);
      if (!departmentId) return reply;
      try {
        const { client, settingsFingerprint } = await connectedElvanto(departmentId);
        const linkResult = await pool!.query<{ source_flow_id: string; local_flow_id: string; local_status: string; definition: JsonObject | null }>(
          `SELECT link.source_flow_id,link.local_flow_id,flow.status AS local_status,snapshot.definition
             FROM elvanto_people_flow_links link
             JOIN people_flows flow ON flow.department_id=link.department_id AND flow.id=link.local_flow_id
             LEFT JOIN elvanto_people_flows_import snapshot ON snapshot.department_id=link.department_id AND snapshot.source_id=link.source_flow_id
            WHERE link.department_id=$1 AND link.source_flow_id=$2`,
          [departmentId, request.body.sourceFlowId],
        );
        const flowLink = linkResult.rows[0];
        if (!flowLink) return reply.code(404).send({ error: "Link this imported Elvanto flow to an active local workflow before exporting assignments." });
        if (flowLink.local_status !== "active") return reply.code(409).send({ error: "Activate the linked local workflow before exporting assignments." });
        if (!flowLink.definition) return reply.code(409).send({ error: "Refresh the imported Elvanto flow before exporting assignments." });

        const stepLinks = await pool!.query<{ source_step_id: string; local_step_id: string; local_active: boolean }>(
          `SELECT link.source_step_id,link.local_step_id,step.active AS local_active
             FROM elvanto_people_flow_step_links link
             JOIN people_flow_steps step ON step.department_id=link.department_id AND step.id=link.local_step_id
            WHERE link.department_id=$1 AND link.source_flow_id=$2 ORDER BY link.source_step_id`,
          [departmentId, request.body.sourceFlowId],
        );
        if (!stepLinks.rowCount) return reply.code(409).send({ error: "Map at least one Elvanto step to a local step before exporting assignments." });
        const knownRemoteSteps = elvantoStepIds(flowLink.definition);
        if (stepLinks.rows.some((step) => !step.local_active || !knownRemoteSteps.has(step.source_step_id))) {
          return reply.code(409).send({ error: "A mapped Elvanto or local step changed. Refresh the imported flow and review its links before exporting." });
        }

        const assignments = await pool!.query<{
          enrollment_id: string; contact_id: string; source_flow_id: string; source_step_id: string;
          local_flow_id: string; local_step_id: string; person_id: string | null; fingerprint: string; first_name: string; last_name: string;
        }>(
          `SELECT enrollment.id AS enrollment_id,enrollment.contact_id,step_link.source_flow_id,step_link.source_step_id,
                  flow.id AS local_flow_id,step_link.local_step_id,contact.elvanto_source_id AS person_id,contact.first_name,contact.last_name,
                  md5(concat_ws(':',enrollment.id,enrollment.updated_at::text,contact.id,COALESCE(contact.elvanto_source_id,''),step.updated_at::text,progress.status,progress.updated_at::text)) AS fingerprint
             FROM elvanto_people_flow_step_links step_link
             JOIN people_flow_steps step ON step.department_id=step_link.department_id AND step.id=step_link.local_step_id AND step.active=TRUE
             JOIN people_flows flow ON flow.department_id=step.department_id AND flow.id=step.flow_id AND flow.status='active'
             JOIN people_flow_enrollments enrollment ON enrollment.department_id=flow.department_id AND enrollment.flow_id=flow.id AND enrollment.status='active'
             JOIN people_flow_step_progress progress ON progress.department_id=enrollment.department_id AND progress.enrollment_id=enrollment.id AND progress.step_id=step.id AND progress.status='pending'
             JOIN contacts contact ON contact.department_id=enrollment.department_id AND contact.id=enrollment.contact_id
            WHERE step_link.department_id=$1 AND step_link.source_flow_id=$2
            ORDER BY step_link.source_step_id,enrollment.contact_id,enrollment.id LIMIT 20001`,
          [departmentId, request.body.sourceFlowId],
        );
        if (assignments.rows.length > 20000) return reply.code(409).send({ error: "This export contains more than 20,000 assignments. Narrow the workflow scope before previewing." });

        const memberships = new Map<string, Set<string>>();
        const stepsToCheck = [...new Set(assignments.rows.filter((row) => row.person_id).map((row) => row.source_step_id))];
        for (let offset = 0; offset < stepsToCheck.length; offset += 5) {
          await Promise.all(stepsToCheck.slice(offset, offset + 5).map(async (sourceStepId) => {
            memberships.set(sourceStepId, await client.listStepPersonIds(sourceStepId));
          }));
        }
        const identityCounts = new Map<string, number>();
        for (const assignment of assignments.rows) if (assignment.person_id) {
          const key = `${assignment.source_step_id}\0${assignment.person_id}`;
          identityCounts.set(key, (identityCounts.get(key) ?? 0) + 1);
        }
        const previewRecords = assignments.rows.map((assignment) => {
          const identityKey = `${assignment.source_step_id}\0${assignment.person_id ?? ""}`;
          const state: ExportState = !assignment.person_id ? "unmatched" : (identityCounts.get(identityKey) ?? 0) > 1 ? "ambiguous" : memberships.get(assignment.source_step_id)?.has(assignment.person_id) ? "already_assigned" : "queued";
          return {
            row: {
              enrollmentId: assignment.enrollment_id, contactId: assignment.contact_id, sourceFlowId: assignment.source_flow_id,
              sourceStepId: assignment.source_step_id, localFlowId: assignment.local_flow_id, localStepId: assignment.local_step_id,
              personId: assignment.person_id, fingerprint: assignment.fingerprint, state,
            } satisfies ExportRow,
            name: `${assignment.first_name} ${assignment.last_name}`.trim(),
            sourceStepId: assignment.source_step_id,
            state,
          };
        });
        const rows = previewRecords.map((record) => record.row);
        const sample = previewRecords.slice(0, 25).map(({ name, sourceStepId, state }) => ({ name, sourceStepId, state }));
        const runId = randomUUID();
        const summary = counts(rows);
        await pool!.query("DELETE FROM elvanto_people_flow_export_runs WHERE department_id=$1 AND previewed_at < now()-interval '30 days'", [departmentId]);
        await pool!.query(
          `INSERT INTO elvanto_people_flow_export_runs(id,department_id,source_flow_id,local_flow_id,settings_fingerprint,status,preview_rows,preview_sample,cursor,existing_count,skipped_count,created_by)
           VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,0,$9,$10,$11)`,
          [runId, departmentId, request.body.sourceFlowId, flowLink.local_flow_id, settingsFingerprint, rows.length ? "preview" : "complete", JSON.stringify(rows), JSON.stringify(sample), summary.alreadyAssigned, summary.unmatched + summary.ambiguous, request.authenticatedUser?.id ?? null],
        );
        await pool!.query(
          "INSERT INTO people_flow_audit(id,department_id,actor_user_id,action,flow_id,metadata) VALUES($1,$2,$3,'elvanto_assignment_export_previewed',$4,$5::jsonb)",
          [randomUUID(), departmentId, request.authenticatedUser?.id ?? null, flowLink.local_flow_id, JSON.stringify({ sourceFlowId: request.body.sourceFlowId, total: summary.total, queued: summary.queued, alreadyAssigned: summary.alreadyAssigned, unmatched: summary.unmatched })],
        );
        return { runId, status: rows.length ? "preview" : "complete", ...summary, cursor: 0, skipped: summary.unmatched + summary.ambiguous, sample };
      } catch (error) {
        return reply.code(400).send({ error: error instanceof Error ? error.message : "People Flow export preview failed." });
      }
    });

    routes.get<{ Querystring: { sourceFlowId: string } }>("/api/people-flows/elvanto-crosswalk/export-status", {
      schema: { querystring: { type: "object", additionalProperties: false, required: ["sourceFlowId"], properties: { sourceFlowId: { type: "string", minLength: 1, maxLength: 160 } } } },
    }, async (request, reply) => {
      const departmentId = await authorize(request, reply, false);
      if (!departmentId) return reply;
      await pool!.query("DELETE FROM elvanto_people_flow_export_runs WHERE department_id=$1 AND previewed_at < now()-interval '30 days'", [departmentId]);
      const result = await pool!.query<ExportRun>(
        `SELECT id,department_id,source_flow_id,local_flow_id,settings_fingerprint,status,preview_rows,preview_sample,cursor,added_count,existing_count,skipped_count,previewed_at
           FROM elvanto_people_flow_export_runs
          WHERE department_id=$1 AND source_flow_id=$2 ORDER BY previewed_at DESC LIMIT 1`,
        [departmentId, request.query.sourceFlowId],
      );
      const run = result.rows[0];
      if (!run) return { run: null };
      const expiresAt = new Date(run.previewed_at).getTime() + 60 * 60 * 1000;
      if (expiresAt <= Date.now() && (run.status === "preview" || run.status === "running")) {
        await pool!.query("UPDATE elvanto_people_flow_export_runs SET status='expired',updated_at=now() WHERE id=$1", [run.id]);
        return { run: null };
      }
      return { run: { runId: run.id, status: run.status, ...counts(run.preview_rows), cursor: run.cursor, added: run.added_count, alreadyAssigned: run.existing_count, skipped: run.skipped_count, expiresAt: new Date(expiresAt).toISOString(), sample: runSample(run) } };
    });

    routes.post<{ Body: { runId: string } }>("/api/people-flows/elvanto-crosswalk/export", {
      schema: { body: { type: "object", additionalProperties: false, required: ["runId"], properties: { runId: { type: "string", format: "uuid" } } } },
    }, async (request, reply) => {
      const departmentId = await authorize(request, reply, true);
      if (!departmentId) return reply;
      const connection = await pool!.connect();
      let locked = false;
      try {
        const lock = await connection.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtext($1)) AS locked", [`elvanto-people-flow-export:${request.body.runId}`]);
        locked = Boolean(lock.rows[0]?.locked);
        if (!locked) return reply.code(409).send({ error: "This People Flow export is already running in another request." });
        const runResult = await connection.query<ExportRun>(
          `SELECT id,department_id,source_flow_id,local_flow_id,settings_fingerprint,status,preview_rows,preview_sample,cursor,added_count,existing_count,skipped_count,previewed_at
             FROM elvanto_people_flow_export_runs WHERE id=$1 AND department_id=$2`,
          [request.body.runId, departmentId],
        );
        const run = runResult.rows[0];
        if (!run) return reply.code(404).send({ error: "People Flow export preview not found." });
        if (run.status === "complete") return { status: run.status, ...counts(run.preview_rows), cursor: run.cursor, added: run.added_count, alreadyAssigned: run.existing_count, skipped: run.skipped_count, complete: true, sample: runSample(run) };
        if (run.status === "uncertain") return reply.code(409).send({ error: "A previous Elvanto write has an uncertain result. Run a fresh preview before continuing; the exporter will check remote assignments first." });
        if (run.status === "expired" || Date.now() - new Date(run.previewed_at).getTime() > 60 * 60 * 1000) {
          await connection.query("UPDATE elvanto_people_flow_export_runs SET status='expired',updated_at=now() WHERE id=$1", [run.id]);
          return reply.code(409).send({ error: "This People Flow export preview expired. Run a fresh preview before writing." });
        }
        const { client, settingsFingerprint } = await connectedElvanto(departmentId);
        if (settingsFingerprint !== run.settings_fingerprint) {
          await connection.query("UPDATE elvanto_people_flow_export_runs SET status='expired',updated_at=now() WHERE id=$1", [run.id]);
          return reply.code(409).send({ error: "Elvanto connection or sync direction changed after preview. Run a fresh preview before writing." });
        }
        let added = run.added_count;
        let existing = run.existing_count;
        let skipped = run.skipped_count;
        let cursor = run.cursor;
        let writes = 0;
        let scanned = 0;
        const rows = run.preview_rows;
        const memberships = new Map<string, Set<string>>();
        const persist = async (status: ExportRun["status"]) => {
          await connection.query(
            "UPDATE elvanto_people_flow_export_runs SET status=$3,preview_rows=$4::jsonb,cursor=$5,added_count=$6,existing_count=$7,skipped_count=$8,updated_at=now() WHERE id=$1 AND department_id=$2",
            [run.id, departmentId, status, JSON.stringify(rows), cursor, added, existing, skipped],
          );
        };
        while (cursor < rows.length && writes < 5 && scanned < 100) {
          const row = rows[cursor];
          scanned += 1;
          if (row.state !== "queued") { cursor += 1; continue; }
          const assignmentLockKey = `elvanto-people-flow-assignment:${departmentId}:${row.sourceStepId}:${row.personId}`;
          const assignmentLock = await connection.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtext($1)) AS locked", [assignmentLockKey]);
          if (!assignmentLock.rows[0]?.locked) break;
          try {
          const stillEligible = await connection.query<{ fingerprint: string }>(
            `SELECT md5(concat_ws(':',enrollment.id,enrollment.updated_at::text,contact.id,COALESCE(contact.elvanto_source_id,''),step.updated_at::text,progress.status,progress.updated_at::text)) AS fingerprint
               FROM people_flow_enrollments enrollment
               JOIN people_flows flow ON flow.department_id=enrollment.department_id AND flow.id=enrollment.flow_id AND flow.status='active'
               JOIN people_flow_steps step ON step.department_id=flow.department_id AND step.flow_id=flow.id AND step.id=$6 AND step.active=TRUE
               JOIN people_flow_step_progress progress ON progress.department_id=enrollment.department_id AND progress.enrollment_id=enrollment.id AND progress.step_id=step.id AND progress.status='pending'
               JOIN contacts contact ON contact.department_id=enrollment.department_id AND contact.id=enrollment.contact_id
               JOIN elvanto_people_flow_links flow_link ON flow_link.department_id=flow.department_id AND flow_link.local_flow_id=flow.id AND flow_link.source_flow_id=$2
               JOIN elvanto_people_flow_step_links step_link ON step_link.department_id=flow.department_id AND step_link.source_flow_id=flow_link.source_flow_id AND step_link.local_step_id=step.id AND step_link.source_step_id=$3
             WHERE enrollment.department_id=$1 AND enrollment.id=$4 AND enrollment.contact_id=$5 AND enrollment.status='active' AND contact.elvanto_source_id=$7`,
            [departmentId, row.sourceFlowId, row.sourceStepId, row.enrollmentId, row.contactId, row.localStepId, row.personId],
          );
          if (!stillEligible.rowCount || stillEligible.rows[0].fingerprint !== row.fingerprint) {
            row.state = "stale"; skipped += 1; cursor += 1;
            await persist("running");
            continue;
          }
          let stepPeople = memberships.get(row.sourceStepId);
          if (!stepPeople) {
            stepPeople = await client.listStepPersonIds(row.sourceStepId);
            memberships.set(row.sourceStepId, stepPeople);
          }
          if (stepPeople.has(row.personId!)) {
            row.state = "already_assigned"; existing += 1; cursor += 1;
            await persist("running");
            continue;
          }
          if (!await context.isDepartmentWritable(departmentId)) {
            return reply.code(423).send({ error: "This location became read-only before the Elvanto write. No assignment was sent." });
          }
          try {
            await client.addPersonToStep(row.sourceStepId, row.personId!);
          } catch {
            row.state = "uncertain"; cursor += 1;
            await persist("uncertain");
            await connection.query(
              "INSERT INTO people_flow_audit(id,department_id,actor_user_id,action,flow_id,enrollment_id,step_id,metadata) VALUES($1,$2,$3,'elvanto_assignment_export_uncertain',$4,$5,$6,$7::jsonb)",
              [randomUUID(), departmentId, request.authenticatedUser?.id ?? null, run.local_flow_id, row.enrollmentId, row.localStepId, JSON.stringify({ sourceFlowId: row.sourceFlowId, sourceStepId: row.sourceStepId })],
            ).catch(() => {});
            return reply.code(409).send({ error: "Elvanto did not confirm the write outcome. No automatic retry was made; run a fresh preview to check whether the assignment was added." });
          }
          row.state = "added"; added += 1; writes += 1; cursor += 1;
          await persist("running");
          await connection.query(
            "INSERT INTO people_flow_audit(id,department_id,actor_user_id,action,flow_id,enrollment_id,step_id,metadata) VALUES($1,$2,$3,'elvanto_assignment_exported',$4,$5,$6,$7::jsonb)",
            [randomUUID(), departmentId, request.authenticatedUser?.id ?? null, run.local_flow_id, row.enrollmentId, row.localStepId, JSON.stringify({ sourceFlowId: row.sourceFlowId, sourceStepId: row.sourceStepId })],
          );
          } finally {
            await connection.query("SELECT pg_advisory_unlock(hashtext($1))", [assignmentLockKey]).catch(() => {});
          }
        }
        const complete = cursor >= rows.length;
        const status = complete ? "complete" : "running";
        await persist(status);
        return { status, ...counts(rows), cursor, added, alreadyAssigned: existing, skipped, complete, sample: runSample({ ...run, preview_rows: rows }) };
      } catch (error) {
        return reply.code(400).send({ error: error instanceof Error ? error.message : "People Flow export failed." });
      } finally {
        if (locked) await connection.query("SELECT pg_advisory_unlock(hashtext($1))", [`elvanto-people-flow-export:${request.body.runId}`]).catch(() => {});
        connection.release();
      }
    });
  });
}
