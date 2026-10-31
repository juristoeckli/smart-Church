import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { StoredFile } from "@smart-church/contracts";
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { PoolClient } from "pg";
import type { ModuleServerContext } from "../module-sdk.js";

const resourceLimit = 25 * 1024 * 1024;
function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value as Record<string, unknown>).sort().map((key) => JSON.stringify(key) + ":" + canonical((value as Record<string, unknown>)[key])).join(",") + "}";
  return JSON.stringify(value);
}
type ResourceRow = { id: string; title: string; category: string; file_name: string; content_type: string; file_size: number; created_at: Date | string };
function mapResource(row: ResourceRow): StoredFile {
  return { id: row.id, title: row.title, category: row.category, fileName: row.file_name, contentType: row.content_type, fileSize: row.file_size, createdAt: new Date(row.created_at).toISOString() };
}

export function registerModuleRoutes(app: FastifyInstance, context: ModuleServerContext) {
  const { pool, isDatabaseReady, resolveDepartmentId } = context;
  context.replication.register({
    schemaVersion: "1",
    inspect: async (departmentId) => {
      if (!pool || !isDatabaseReady()) return { ready: false, blockers: ["The file storage database is unavailable."], recordCount: 0 };
      const result = await pool.query<{ count: string; bytes: string }>("SELECT count(*)::text,sum(file_size)::text AS bytes FROM stored_files WHERE department_id=$1", [departmentId]);
      const count = Number(result.rows[0].count);
      const bytes = Number(result.rows[0].bytes ?? 0);
      return { ready: bytes <= 200 * 1024 * 1024, blockers: bytes > 200 * 1024 * 1024 ? ["Stored files exceed the current 200 MiB snapshot safety limit."] : [], recordCount: count };
    },
    exportSnapshot: async (client: PoolClient, departmentId) => {
      const files = await client.query("SELECT id,title,category,file_name,content_type,file_size,encode(file_data,'base64') AS file_data,created_at,updated_at,deleted_at FROM stored_files WHERE department_id=$1 ORDER BY id", [departmentId]);
      return { version: 1, files: files.rows };
    },
    restoreSnapshot: async (client: PoolClient, departmentId, input) => {
      if (!input || typeof input !== "object" || (input as { version?: unknown }).version !== 1 || !Array.isArray((input as { files?: unknown }).files)) throw new Error("The File Storage snapshot is invalid.");
      const files = (input as { files: Array<Record<string, unknown>> }).files;
      await client.query("DELETE FROM stored_files WHERE department_id=$1", [departmentId]);
      for (const file of files) {
        const encodedData = typeof file.file_data === "string" ? file.file_data.replace(/[\r\n]/g, "") : "";
        if (typeof file.id !== "string" || typeof file.title !== "string" || typeof file.category !== "string" || typeof file.file_name !== "string" || typeof file.content_type !== "string" || typeof file.file_size !== "number" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encodedData)) throw new Error("The File Storage snapshot contains an invalid file record.");
        const buffer = Buffer.from(encodedData, "base64");
        if (buffer.length !== file.file_size || buffer.length > resourceLimit) throw new Error("A replicated file does not match its declared size or exceeds 25 MiB.");
        const deletedAt = file.deleted_at == null ? null : file.deleted_at;
        if (deletedAt !== null && (typeof deletedAt !== "string" || !Number.isFinite(Date.parse(deletedAt)))) throw new Error("The File Storage snapshot contains an invalid deletion date.");
        await client.query("INSERT INTO stored_files(id,department_id,title,category,file_name,content_type,file_size,file_data,created_at,updated_at,deleted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", [file.id, departmentId, file.title, file.category, file.file_name, file.content_type, buffer.length, buffer, file.created_at, file.updated_at, deletedAt]);
      }
      return { recordCount: files.length };
    },
    verifySnapshot: async (client: PoolClient, departmentId, input) => {
      if (!input || typeof input !== "object" || (input as { version?: unknown }).version !== 1 || !Array.isArray((input as { files?: unknown }).files)) return { ready: false, blockers: ["No verified File Storage snapshot is available."] };
      const expected = (input as { files: Array<Record<string, unknown>> }).files;
      const actual = (await client.query("SELECT id,title,category,file_name,content_type,file_size,encode(file_data,'base64') AS file_data,created_at,updated_at,deleted_at FROM stored_files WHERE department_id=$1 ORDER BY id", [departmentId])).rows as Array<Record<string, unknown>>;
      if (actual.length !== expected.length) return { ready: false, blockers: [`Stored file count differs: expected ${expected.length}, found ${actual.length}.`] };
      const expectedRows = expected.map((row) => canonical({ ...row, deleted_at: row.deleted_at ?? null })).sort();
      const actualRows = actual.map((row) => canonical({ ...row, deleted_at: row.deleted_at ?? null })).sort();
      return expectedRows.some((row, index) => row !== actualRows[index]) ? { ready: false, blockers: ["Stored file metadata or binary content differs after restore."] } : { ready: true, blockers: [] };
    },
  });
  app.register(async (routes) => {
    routes.addContentTypeParser("application/vnd.smart-church.resource", { parseAs: "buffer", bodyLimit: resourceLimit }, (_request, body, done) => done(null, body));
    async function department(request: FastifyRequest, reply: FastifyReply, requireManage = false) {
      if (!isDatabaseReady() || !pool) {
        reply.code(503).send({ error: "The file storage database is unavailable." });
        return null;
      }
      const departmentId = await resolveDepartmentId(request, reply);
      if (!departmentId) return null;
      const hasManageAccess = request.activeDepartmentRole === "site_admin"
        || (request.activeDepartmentModulePermissions?.["file-storage"] ?? []).includes("manage");
      if (requireManage && !hasManageAccess) {
        reply.code(403).send({ error: "File storage management access is required." });
        return null;
      }
      return departmentId;
    }

    routes.get<{ Querystring: { view?: string } }>("/api/files", async (request, reply) => {
      const view = request.query.view ?? "active";
      if (view !== "active" && view !== "trash") return reply.code(400).send({ error: "Choose a valid file view." });
      const departmentId = await department(request, reply, view === "trash");
      if (!departmentId) return reply;
      const result = await pool!.query<ResourceRow>(
        `SELECT id, title, category, file_name, content_type, file_size, created_at FROM stored_files
          WHERE department_id = $1 AND ${view === "trash" ? "deleted_at IS NOT NULL" : "deleted_at IS NULL"}
          ORDER BY lower(category), lower(title), created_at DESC`, [departmentId],
      );
      return result.rows.map(mapResource);
    });

    routes.post<{ Body: Buffer; Querystring: { title?: string; category?: string; filename?: string } }>("/api/files", { bodyLimit: resourceLimit, schema: {
      querystring: { type: "object", properties: { title: { type: "string", maxLength: 160 }, category: { type: "string", maxLength: 80 }, filename: { type: "string", maxLength: 255 } } },
    } }, async (request, reply) => {
      const departmentId = await department(request, reply, true);
      if (!departmentId) return reply;
      if (!Buffer.isBuffer(request.body) || request.body.length < 1) return reply.code(400).send({ error: "Choose a file to upload." });
      if (request.body.length > resourceLimit) return reply.code(413).send({ error: "Files must be 25 MiB or smaller." });
      const fileName = basename(request.query.filename || "resource").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim().slice(0, 255) || "resource";
      const title = (request.query.title?.trim() || fileName).slice(0, 160);
      const category = (request.query.category?.trim() || "General").slice(0, 80);
      const requestedType = request.headers["x-resource-content-type"];
      const contentType = typeof requestedType === "string" && /^[\w.+-]+\/[\w.+-]+$/.test(requestedType) ? requestedType.slice(0, 120) : "application/octet-stream";
      const result = await pool!.query<ResourceRow>(
        `INSERT INTO stored_files (id, department_id, title, category, file_name, content_type, file_size, file_data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id, title, category, file_name, content_type, file_size, created_at`,
        [randomUUID(), departmentId, title, category, fileName, contentType, request.body.length, request.body],
      );
      return reply.code(201).send(mapResource(result.rows[0]));
    });

    routes.put<{ Params: { id: string }; Body: { title: string; category: string } }>("/api/files/:id", { schema: {
      params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["title", "category"], properties: { title: { type: "string", minLength: 1, maxLength: 160 }, category: { type: "string", minLength: 1, maxLength: 80 } } },
    } }, async (request, reply) => {
      const departmentId = await department(request, reply, true);
      if (!departmentId) return reply;
      const title = request.body.title.trim();
      const category = request.body.category.trim();
      if (!title || !category) return reply.code(400).send({ error: "Title and category are required." });
      const result = await pool!.query<ResourceRow>(
        `UPDATE stored_files SET title = $3, category = $4, updated_at = now()
          WHERE id = $1 AND department_id = $2 AND deleted_at IS NULL
          RETURNING id, title, category, file_name, content_type, file_size, created_at`,
        [request.params.id, departmentId, title, category],
      );
      if (!result.rowCount) return reply.code(404).send({ error: "Resource not found." });
      return mapResource(result.rows[0]);
    });

    routes.get<{ Params: { id: string } }>("/api/files/:id/download", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } } }, async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const result = await pool!.query("SELECT file_name, content_type, file_data FROM stored_files WHERE id = $1 AND department_id = $2 AND deleted_at IS NULL", [request.params.id, departmentId]);
      const resource = result.rows[0];
      if (!resource) return reply.code(404).send({ error: "Resource not found." });
      reply.type(resource.content_type).header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(resource.file_name)}`).header("X-Content-Type-Options", "nosniff");
      return resource.file_data as Buffer;
    });

    routes.delete<{ Params: { id: string } }>("/api/files/:id", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } } }, async (request, reply) => {
      const departmentId = await department(request, reply, true);
      if (!departmentId) return reply;
      const result = await pool!.query("UPDATE stored_files SET deleted_at = now(), updated_at = now() WHERE id = $1 AND department_id = $2 AND deleted_at IS NULL RETURNING id", [request.params.id, departmentId]);
      if (!result.rowCount) return reply.code(404).send({ error: "Resource not found." });
      return { deleted: true, trashed: true };
    });

    routes.post<{ Params: { id: string } }>("/api/files/:id/restore", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } } }, async (request, reply) => {
      const departmentId = await department(request, reply, true);
      if (!departmentId) return reply;
      const result = await pool!.query("UPDATE stored_files SET deleted_at = NULL, updated_at = now() WHERE id = $1 AND department_id = $2 AND deleted_at IS NOT NULL RETURNING id", [request.params.id, departmentId]);
      if (!result.rowCount) return reply.code(404).send({ error: "Resource not found." });
      return { restored: true };
    });

    routes.delete<{ Params: { id: string } }>("/api/files/:id/permanent", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } } }, async (request, reply) => {
      const departmentId = await department(request, reply, true);
      if (!departmentId) return reply;
      const result = await pool!.query("DELETE FROM stored_files WHERE id = $1 AND department_id = $2 AND deleted_at IS NOT NULL RETURNING id", [request.params.id, departmentId]);
      if (!result.rowCount) return reply.code(404).send({ error: "Resource not found." });
      return { deleted: true, permanently: true };
    });
  });
}
