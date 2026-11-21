import type { FastifyReply } from "fastify";
import { createWorkbook } from "../finance/workbook.js";

export const exportFormatQuery = { type: "object", additionalProperties: false, properties: { format: { type: "string", enum: ["xlsx"] } } } as const;
export type ExportFormatQuery = { format?: "xlsx" };

export function sendReportWorkbook(reply: FastifyReply, report: { columns: { key: string; label: string }[]; rows: Record<string, unknown>[] }, name: string) {
  const rows = report.rows.map((row) => report.columns.map(({ key }) => row[key]));
  return reply.header("cache-control", "private, no-store")
    .header("content-disposition", 'attachment; filename="' + name.replace(/[^a-z0-9-]/gi, "-") + '.xlsx"')
    .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    .send(createWorkbook("Report", report.columns.map(({ label }) => label), rows));
}
