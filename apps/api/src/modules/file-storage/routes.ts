import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { StoredFile, StoredFolder } from "@smart-church/contracts";
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { PoolClient } from "pg";
import type { ModuleServerContext } from "../module-sdk.js";
import { canManageStoredFileWikiAudience, wikiFileAudienceSchema, storedFileWikiAudienceSql } from "../../stored-file-wiki-access.js";

import { storedFileUploadLimit as resourceLimit, storedFileUploadMetadata } from "./upload.js";
import { isSnapshotRow, storedWikiAttachmentFingerprint, validateStoredWikiAttachmentEvidence } from "../wiki/replication-access.js";
function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value as Record<string, unknown>).sort().map((key) => JSON.stringify(key) + ":" + canonical((value as Record<string, unknown>)[key])).join(",") + "}";
  return JSON.stringify(value);
}
type ResourceRow = { id: string; title: string; category: string; file_name: string; content_type: string; file_size: number; created_at: Date | string; folder_id?: string | null };
function mapResource(row: ResourceRow): StoredFile {
  return { id: row.id, title: row.title, category: row.category, fileName: row.file_name, contentType: row.content_type, fileSize: row.file_size, createdAt: new Date(row.created_at).toISOString(), folderId: row.folder_id ?? null };
}
type FolderRow = { id: string; name: string; parent_id: string | null; created_at: Date | string };
function mapFolder(row: FolderRow): StoredFolder { return { id: row.id, name: row.name, parentId: row.parent_id, createdAt: new Date(row.created_at).toISOString() }; }

const missingWikiSnapshot = "File Storage replication requires a corresponding Wiki snapshot while this location has Wiki attachments.";

function recordedWikiFingerprint(input: unknown) {
  return isSnapshotRow(input) && typeof input.wikiAttachmentAccess === "string" ? input.wikiAttachmentAccess : "none";
}

export function registerModuleRoutes(app: FastifyInstance, context: ModuleServerContext) {
  const { pool, isDatabaseReady, resolveDepartmentId } = context;
  context.replication.register({
    schemaVersion: "3",
    inspect: async (departmentId, replication) => {
      if (!pool || !isDatabaseReady()) return { ready: false, blockers: ["The file storage database is unavailable."], recordCount: 0 };
      const result = await pool.query<{ count: string; bytes: string }>("SELECT ((SELECT count(*) FROM stored_files WHERE department_id=$1)+(SELECT count(*) FROM stored_file_versions WHERE department_id=$1)+(SELECT count(*) FROM stored_file_folders WHERE department_id=$1))::text AS count,((SELECT COALESCE(sum(file_size),0) FROM stored_files WHERE department_id=$1)+(SELECT COALESCE(sum(file_size),0) FROM stored_file_versions WHERE department_id=$1))::text AS bytes", [departmentId]);
      const count = Number(result.rows[0].count);
      const bytes = Number(result.rows[0].bytes ?? 0);
      const blockers: string[] = [];
      if (bytes > 200 * 1024 * 1024) blockers.push("Stored files exceed the current 200 MiB snapshot safety limit.");
      try {
        if (await storedWikiAttachmentFingerprint(pool, departmentId) !== "none" && !replication?.moduleIds.has("wiki")) {
          blockers.push(missingWikiSnapshot);
        }
      } catch (error) {
        blockers.push(error instanceof Error ? error.message : "Wiki attachment permissions cannot be verified.");
      }
      return { ready: !blockers.length, blockers, recordCount: count };
    },
    exportSnapshot: async (client: PoolClient, departmentId, replication) => {
      const wikiAttachmentAccess = await storedWikiAttachmentFingerprint(client, departmentId);
      if (wikiAttachmentAccess !== "none" && !replication?.moduleIds.has("wiki")) throw new Error(missingWikiSnapshot);
      const files = await client.query("SELECT id,title,category,file_name,content_type,file_size,folder_id,encode(file_data,'base64') AS file_data,created_at,updated_at,deleted_at FROM stored_files WHERE department_id=$1 ORDER BY id", [departmentId]);
      const folders = await client.query("SELECT id,name,parent_id,created_at FROM stored_file_folders WHERE department_id=$1 ORDER BY id", [departmentId]);
      const versions = await client.query("SELECT id,department_id,file_id,version_number,title,category,file_name,content_type,file_size,encode(file_data,'base64') AS file_data,uploaded_by,created_at FROM stored_file_versions WHERE department_id=$1 ORDER BY file_id,version_number", [departmentId]);
      return { version: 3, ...(files.rows.length || versions.rows.length ? { wikiAttachmentAccess } : {}), files: files.rows, folders: folders.rows, versions: versions.rows };
    },
    restoreDependencies: {
      moduleIds: ["wiki"],
      validate: (snapshot, dependencies) => validateStoredWikiAttachmentEvidence(snapshot, dependencies.get("wiki")),
    },
    prepareRestore: async (client, departmentId, snapshot, replication) => {
      if (snapshot === undefined) return;
      const current = await storedWikiAttachmentFingerprint(client, departmentId);
      if (current !== "none" && !replication?.moduleIds.has("wiki")) throw new Error(missingWikiSnapshot);
    },
    restoreSnapshot: async (client: PoolClient, departmentId, input, restoreContext) => {
      if (!input || typeof input !== "object" || ![1, 2, 3].includes((input as { version?: number }).version ?? 0) || !Array.isArray((input as { files?: unknown }).files)) throw new Error("The File Storage snapshot is invalid.");
      // Wiki prepareRestore must clear dependent links before File Storage replaces their files.
      if (await storedWikiAttachmentFingerprint(client, departmentId) !== "none") throw new Error(missingWikiSnapshot);
      const files = (input as { files: Array<Record<string, unknown>> }).files;
      const folders = (input as { folders?: Array<Record<string, unknown>> }).folders ?? [];
      const versions = (input as { versions?: Array<Record<string, unknown>> }).versions ?? [];
      await client.query("DELETE FROM stored_files WHERE department_id=$1", [departmentId]);
      await client.query("DELETE FROM stored_file_folders WHERE department_id=$1", [departmentId]);
      const pendingFolders = [...folders];
      while (pendingFolders.length) {
        const readyIndex = pendingFolders.findIndex((folder) => folder.parent_id == null || !pendingFolders.some((candidate) => candidate.id === folder.parent_id));
        if (readyIndex < 0) throw new Error("The File Storage snapshot contains an invalid folder hierarchy.");
        const [folder] = pendingFolders.splice(readyIndex, 1);
        if (typeof folder.id !== "string" || typeof folder.name !== "string" || (folder.parent_id != null && typeof folder.parent_id !== "string")) throw new Error("The File Storage snapshot contains an invalid folder.");
        await client.query("INSERT INTO stored_file_folders(id,department_id,name,parent_id,created_at) VALUES($1,$2,$3,$4,$5)", [folder.id, departmentId, folder.name, folder.parent_id ?? null, folder.created_at]);
      }
      for (const file of files) {
        const encodedData = typeof file.file_data === "string" ? file.file_data.replace(/[\r\n]/g, "") : "";
        if (typeof file.id !== "string" || typeof file.title !== "string" || typeof file.category !== "string" || typeof file.file_name !== "string" || typeof file.content_type !== "string" || typeof file.file_size !== "number" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encodedData)) throw new Error("The File Storage snapshot contains an invalid file record.");
        const buffer = Buffer.from(encodedData, "base64");
        if (buffer.length !== file.file_size || buffer.length > resourceLimit) throw new Error("A replicated file does not match its declared size or exceeds 25 MiB.");
        const deletedAt = file.deleted_at == null ? null : file.deleted_at;
        if (deletedAt !== null && (typeof deletedAt !== "string" || !Number.isFinite(Date.parse(deletedAt)))) throw new Error("The File Storage snapshot contains an invalid deletion date.");
        if (file.folder_id != null && typeof file.folder_id !== "string") throw new Error("The File Storage snapshot contains an invalid file folder.");
        await client.query("INSERT INTO stored_files(id,department_id,title,category,file_name,content_type,file_size,file_data,folder_id,created_at,updated_at,deleted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)", [file.id, departmentId, file.title, file.category, file.file_name, file.content_type, buffer.length, buffer, file.folder_id ?? null, file.created_at, file.updated_at, deletedAt]);
      }
      const fileIds = new Set(files.map((file) => file.id));
      for (const version of versions) {
        const encodedData = typeof version.file_data === "string" ? version.file_data.replace(/[\r\n]/g, "") : "";
        if (typeof version.id !== "string" || typeof version.file_id !== "string" || !fileIds.has(version.file_id) || !Number.isInteger(version.version_number) || (version.version_number as number) < 1 || typeof version.title !== "string" || typeof version.category !== "string" || typeof version.file_name !== "string" || typeof version.content_type !== "string" || typeof version.file_size !== "number" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encodedData)) throw new Error("The File Storage snapshot contains an invalid file version.");
        const buffer = Buffer.from(encodedData, "base64");
        if (buffer.length !== version.file_size || buffer.length > resourceLimit) throw new Error("A replicated file version does not match its declared size or exceeds 25 MiB.");
        const uploadedBy = version.uploaded_by == null ? null : restoreContext.userIdMap.get(String(version.uploaded_by)) ?? version.uploaded_by;
        await client.query("INSERT INTO stored_file_versions(id,department_id,file_id,version_number,title,category,file_name,content_type,file_size,file_data,uploaded_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)", [version.id, departmentId, version.file_id, version.version_number, version.title, version.category, version.file_name, version.content_type, buffer.length, buffer, uploadedBy, version.created_at]);
      }
      return { recordCount: files.length + folders.length + versions.length };
    },
    verifySnapshot: async (client: PoolClient, departmentId, input, restoreContext) => {
      if (!input || typeof input !== "object" || ![1, 2, 3].includes((input as { version?: number }).version ?? 0) || !Array.isArray((input as { files?: unknown }).files)) return { ready: false, blockers: ["No verified File Storage snapshot is available."] };
      if (await storedWikiAttachmentFingerprint(client, departmentId) !== recordedWikiFingerprint(input)) {
        return { ready: false, blockers: ["Restored Wiki attachment access differs from the signed snapshot."] };
      }
      const expected = (input as { files: Array<Record<string, unknown>> }).files;
      const actual = (await client.query("SELECT id,title,category,file_name,content_type,file_size,folder_id,encode(file_data,'base64') AS file_data,created_at,updated_at,deleted_at FROM stored_files WHERE department_id=$1 ORDER BY id", [departmentId])).rows as Array<Record<string, unknown>>;
      if (actual.length !== expected.length) return { ready: false, blockers: [`Stored file count differs: expected ${expected.length}, found ${actual.length}.`] };
      const normalizeFiles = (rows: Array<Record<string, unknown>>) => rows.map((row) => canonical({ ...row, deleted_at: row.deleted_at ?? null, folder_id: row.folder_id ?? null })).sort();
      const expectedRows = normalizeFiles(expected);
      const actualRows = normalizeFiles(actual);
      if (expectedRows.some((row, index) => row !== actualRows[index])) return { ready: false, blockers: ["Stored file metadata or binary content differs after restore."] };
      const expectedVersions = (input as { versions?: Array<Record<string, unknown>> }).versions ?? [];
      const actualVersions = (await client.query("SELECT id,department_id,file_id,version_number,title,category,file_name,content_type,file_size,encode(file_data,'base64') AS file_data,uploaded_by,created_at FROM stored_file_versions WHERE department_id=$1 ORDER BY file_id,version_number", [departmentId])).rows as Array<Record<string, unknown>>;
      if (actualVersions.length !== expectedVersions.length) return { ready: false, blockers: [`Stored file version count differs: expected ${expectedVersions.length}, found ${actualVersions.length}.`] };
      const normalizeVersions = (rows: Array<Record<string, unknown>>, expected = false) => rows.map((row) => canonical({ ...row, department_id: expected ? departmentId : row.department_id, uploaded_by: row.uploaded_by == null ? null : expected ? restoreContext?.userIdMap.get(String(row.uploaded_by)) ?? row.uploaded_by : row.uploaded_by })).sort();
      const normalizedExpectedVersions = normalizeVersions(expectedVersions, true);
      const normalizedActualVersions = normalizeVersions(actualVersions);
      if (normalizedExpectedVersions.some((row, index) => row !== normalizedActualVersions[index])) return { ready: false, blockers: ["Stored file version metadata or binary content differs after restore."] };
      const expectedFolders = (input as { folders?: Array<Record<string, unknown>> }).folders ?? [];
      const actualFolders = (await client.query("SELECT id,name,parent_id,created_at FROM stored_file_folders WHERE department_id=$1 ORDER BY id", [departmentId])).rows as Array<Record<string, unknown>>;
      const normalized = (rows: Array<Record<string, unknown>>) => rows.map((row) => canonical({ ...row, parent_id: row.parent_id ?? null })).sort();
      return canonical(normalized(expectedFolders)) !== canonical(normalized(actualFolders)) ? { ready: false, blockers: ["Stored folder metadata differs after restore."] } : { ready: true, blockers: [] };
    },
  });
  app.register(async (routes) => {
    routes.addContentTypeParser("application/vnd.smart-church.resource", { parseAs: "buffer", bodyLimit: resourceLimit }, (_request, body, done) => done(null, body));
    async function department(request: FastifyRequest, reply: FastifyReply, requireManage = false) {
      reply.header("Cache-Control", "private, no-store");
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

    async function requireStoredFileRead(request: FastifyRequest, reply: FastifyReply, departmentId: string, fileId: string) {
      const schema = await wikiFileAudienceSchema(pool!);
      if (schema === "absent") return true;
      if (schema === "partial") {
        reply.code(503).send({ error: "File sharing permissions are unavailable." });
        return false;
      }
      const result = await pool!.query(`SELECT 1 FROM stored_files stored
        WHERE stored.department_id=$1 AND stored.id=$4 AND ${storedFileWikiAudienceSql}`,
        [departmentId, canManageStoredFileWikiAudience(request), request.authenticatedUser!.id, fileId]);
      if (result.rowCount) return true;
      reply.code(404).send({ error: "Resource not found." });
      return false;
    }

    routes.get<{ Querystring: { view?: string } }>("/api/files", async (request, reply) => {
      const view = request.query.view ?? "active";
      if (view !== "active" && view !== "trash") return reply.code(400).send({ error: "Choose a valid file view." });
      const departmentId = await department(request, reply, view === "trash");
      if (!departmentId) return reply;
      const wikiSchema = await wikiFileAudienceSchema(pool!);
      if (wikiSchema === "partial") return reply.code(503).send({ error: "File sharing permissions are unavailable." });
      const audienceFilter = wikiSchema === "complete" ? `AND ${storedFileWikiAudienceSql}` : "";
      const listParameters = wikiSchema === "complete" ? [departmentId, canManageStoredFileWikiAudience(request), request.authenticatedUser!.id] : [departmentId];
      const result = await pool!.query<ResourceRow>(
        `SELECT stored.id,stored.title,stored.category,stored.file_name,stored.content_type,stored.file_size,stored.created_at,stored.folder_id FROM stored_files stored
          WHERE stored.department_id = $1 AND ${view === "trash" ? "stored.deleted_at IS NOT NULL" : "stored.deleted_at IS NULL"} ${audienceFilter}
          ORDER BY lower(stored.category), lower(stored.title), stored.created_at DESC`, listParameters,
      );
      return result.rows.map(mapResource);
    });

    routes.get("/api/files/folders", async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const result = await pool!.query<FolderRow>("SELECT id,name,parent_id,created_at FROM stored_file_folders WHERE department_id=$1 ORDER BY lower(name),created_at", [departmentId]);
      return result.rows.map(mapFolder);
    });

    routes.post<{ Body: { name: string; parentId?: string | null } }>("/api/files/folders", { schema: {
      body: { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string", minLength: 1, maxLength: 120 }, parentId: { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] } } },
    } }, async (request, reply) => {
      const departmentId = await department(request, reply, true);
      if (!departmentId) return reply;
      const name = request.body.name.trim();
      if (!name) return reply.code(400).send({ error: "Folder name is required." });
      const parentId = request.body.parentId ?? null;
      if (parentId) {
        const parent = await pool!.query("SELECT id FROM stored_file_folders WHERE id=$1 AND department_id=$2", [parentId, departmentId]);
        if (!parent.rowCount) return reply.code(404).send({ error: "Parent folder not found." });
      }
      try {
        const result = await pool!.query<FolderRow>("INSERT INTO stored_file_folders(id,department_id,name,parent_id) VALUES($1,$2,$3,$4) RETURNING id,name,parent_id,created_at", [randomUUID(), departmentId, name, parentId]);
        return reply.code(201).send(mapFolder(result.rows[0]));
      } catch (error) {
        if ((error as { code?: string }).code === "23505") return reply.code(409).send({ error: "A folder with that name already exists here." });
        throw error;
      }
    });

    routes.put<{ Params: { id: string }; Body: { name: string } }>("/api/files/folders/:id", { schema: {
      params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string", minLength: 1, maxLength: 120 } } },
    } }, async (request, reply) => {
      const departmentId = await department(request, reply, true);
      if (!departmentId) return reply;
      const name = request.body.name.trim();
      if (!name) return reply.code(400).send({ error: "Folder name is required." });
      try {
        const result = await pool!.query<FolderRow>("UPDATE stored_file_folders SET name=$3 WHERE id=$1 AND department_id=$2 RETURNING id,name,parent_id,created_at", [request.params.id, departmentId, name]);
        if (!result.rowCount) return reply.code(404).send({ error: "Folder not found." });
        return mapFolder(result.rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23505") return reply.code(409).send({ error: "A folder with that name already exists here." });
        throw error;
      }
    });

    routes.delete<{ Params: { id: string } }>("/api/files/folders/:id", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } } }, async (request, reply) => {
      const departmentId = await department(request, reply, true);
      if (!departmentId) return reply;
      const childCount = await pool!.query<{ count: string }>("SELECT ((SELECT count(*) FROM stored_files WHERE folder_id=$1 AND department_id=$2) + (SELECT count(*) FROM stored_file_folders WHERE parent_id=$1 AND department_id=$2))::text AS count", [request.params.id, departmentId]);
      if (Number(childCount.rows[0].count) > 0) return reply.code(409).send({ error: "Move or delete the folder contents before deleting this folder." });
      const result = await pool!.query("DELETE FROM stored_file_folders WHERE id=$1 AND department_id=$2 RETURNING id", [request.params.id, departmentId]);
      if (!result.rowCount) return reply.code(404).send({ error: "Folder not found." });
      return { deleted: true };
    });

    routes.post<{ Body: Buffer; Querystring: { title?: string; category?: string; filename?: string; folderId?: string } }>("/api/files", { bodyLimit: resourceLimit, schema: {
      querystring: { type: "object", properties: { title: { type: "string", maxLength: 160 }, category: { type: "string", maxLength: 80 }, filename: { type: "string", maxLength: 255 }, folderId: { type: "string", format: "uuid" } } },
    } }, async (request, reply) => {
      const departmentId = await department(request, reply, true);
      if (!departmentId) return reply;
      if (!Buffer.isBuffer(request.body) || request.body.length < 1) return reply.code(400).send({ error: "Choose a file to upload." });
      if (request.body.length > resourceLimit) return reply.code(413).send({ error: "Files must be 25 MiB or smaller." });
      const { fileName, title, contentType } = storedFileUploadMetadata(request.query, request.headers["x-resource-content-type"]);
      const category = (request.query.category?.trim() || "General").slice(0, 80);
      const folderId = request.query.folderId ?? null;
      if (folderId) {
        const folder = await pool!.query("SELECT id FROM stored_file_folders WHERE id=$1 AND department_id=$2", [folderId, departmentId]);
        if (!folder.rowCount) return reply.code(404).send({ error: "Folder not found." });
      }
      const result = await pool!.query<ResourceRow>(
        `INSERT INTO stored_files (id, department_id, title, category, file_name, content_type, file_size, file_data, folder_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id, title, category, file_name, content_type, file_size, created_at, folder_id`,
        [randomUUID(), departmentId, title, category, fileName, contentType, request.body.length, request.body, folderId],
      );
      return reply.code(201).send(mapResource(result.rows[0]));
    });

    routes.put<{ Params: { id: string }; Body: { title: string; category: string; folderId?: string | null } }>("/api/files/:id", { schema: {
      params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["title", "category"], properties: { title: { type: "string", minLength: 1, maxLength: 160 }, category: { type: "string", minLength: 1, maxLength: 80 }, folderId: { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] } } },
    } }, async (request, reply) => {
      const departmentId = await department(request, reply, true);
      if (!departmentId) return reply;
      if (!await requireStoredFileRead(request, reply, departmentId, request.params.id)) return reply;
      const title = request.body.title.trim();
      const category = request.body.category.trim();
      if (!title || !category) return reply.code(400).send({ error: "Title and category are required." });
      const folderId = request.body.folderId ?? null;
      if (folderId) {
        const folder = await pool!.query("SELECT id FROM stored_file_folders WHERE id=$1 AND department_id=$2", [folderId, departmentId]);
        if (!folder.rowCount) return reply.code(404).send({ error: "Folder not found." });
      }
      const result = await pool!.query<ResourceRow>(
        `UPDATE stored_files SET title = $3, category = $4, folder_id = $5, updated_at = now()
          WHERE id = $1 AND department_id = $2 AND deleted_at IS NULL
          RETURNING id, title, category, file_name, content_type, file_size, created_at, folder_id`,
        [request.params.id, departmentId, title, category, folderId],
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
      if (!await requireStoredFileRead(request, reply, departmentId, request.params.id)) return reply;
      reply.type(resource.content_type).header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(resource.file_name)}`).header("X-Content-Type-Options", "nosniff");
      return resource.file_data as Buffer;
    });

    routes.get<{ Params: { id: string } }>("/api/files/:id/versions", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } } }, async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const file = await pool!.query("SELECT id FROM stored_files WHERE id=$1 AND department_id=$2 AND deleted_at IS NULL", [request.params.id, departmentId]);
      if (!file.rowCount) return reply.code(404).send({ error: "Resource not found." });
      if (!await requireStoredFileRead(request, reply, departmentId, request.params.id)) return reply;
      const versions = await pool!.query(
        `SELECT version.id,version.version_number AS "versionNumber",version.title,version.category,version.file_name AS "fileName",version.content_type AS "contentType",version.file_size AS "fileSize",version.uploaded_by AS "uploadedBy",u.display_name AS "uploadedByName",version.created_at AS "createdAt"
           FROM stored_file_versions version LEFT JOIN app_users u ON u.id=version.uploaded_by
          WHERE version.department_id=$1 AND version.file_id=$2 ORDER BY version.version_number DESC`,
        [departmentId, request.params.id],
      );
      return versions.rows.map((version) => ({ ...version, createdAt: new Date(version.createdAt as Date | string).toISOString() }));
    });

    routes.post<{ Params: { id: string }; Body: Buffer; Querystring: { filename?: string } }>("/api/files/:id/versions", { bodyLimit: resourceLimit, schema: {
      params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
      querystring: { type: "object", properties: { filename: { type: "string", maxLength: 255 } } },
    } }, async (request, reply) => {
      const departmentId = await department(request, reply, true);
      if (!departmentId) return reply;
      if (!await requireStoredFileRead(request, reply, departmentId, request.params.id)) return reply;
      if (!Buffer.isBuffer(request.body) || request.body.length < 1) return reply.code(400).send({ error: "Choose a replacement file." });
      if (request.body.length > resourceLimit) return reply.code(413).send({ error: "Files must be 25 MiB or smaller." });
      const fileName = basename(request.query.filename || "resource").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim().slice(0, 255) || "resource";
      const requestedType = request.headers["x-resource-content-type"];
      const contentType = typeof requestedType === "string" && /^[\w.+-]+\/[\w.+-]+$/.test(requestedType) ? requestedType.slice(0, 120) : "application/octet-stream";
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        const current = await client.query<{ title: string; category: string; file_name: string; content_type: string; file_size: number; file_data: Buffer }>(
          "SELECT title,category,file_name,content_type,file_size,file_data FROM stored_files WHERE id=$1 AND department_id=$2 AND deleted_at IS NULL FOR UPDATE",
          [request.params.id, departmentId],
        );
        if (!current.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Resource not found." }); }
        const before = current.rows[0]!;
        const sequence = await client.query<{ version_number: number }>("SELECT COALESCE(max(version_number),0)+1 AS version_number FROM stored_file_versions WHERE department_id=$1 AND file_id=$2", [departmentId, request.params.id]);
        await client.query(
          "INSERT INTO stored_file_versions(id,department_id,file_id,version_number,title,category,file_name,content_type,file_size,file_data,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
          [randomUUID(), departmentId, request.params.id, sequence.rows[0]!.version_number, before.title, before.category, before.file_name, before.content_type, before.file_size, before.file_data, request.authenticatedUser!.id],
        );
        const updated = await client.query<ResourceRow>(
          "UPDATE stored_files SET file_name=$3,content_type=$4,file_size=$5,file_data=$6,updated_at=now() WHERE id=$1 AND department_id=$2 RETURNING id,title,category,file_name,content_type,file_size,created_at,folder_id",
          [request.params.id, departmentId, fileName, contentType, request.body.length, request.body],
        );
        await client.query(
          "DELETE FROM stored_file_versions WHERE id IN (SELECT id FROM stored_file_versions WHERE department_id=$1 AND file_id=$2 ORDER BY version_number DESC OFFSET 5)",
          [departmentId, request.params.id],
        );
        await client.query("COMMIT");
        context.realtime.publish("module:file-storage:changed", departmentId, { fileId: request.params.id, action: "version-added" });
        return reply.code(201).send({ ...mapResource(updated.rows[0]), versionNumber: sequence.rows[0]!.version_number });
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    });

    routes.get<{ Params: { id: string; versionId: string } }>("/api/files/:id/versions/:versionId/download", { schema: { params: { type: "object", required: ["id", "versionId"], properties: { id: { type: "string", format: "uuid" }, versionId: { type: "string", format: "uuid" } } } } }, async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      if (!await requireStoredFileRead(request, reply, departmentId, request.params.id)) return reply;
      const result = await pool!.query<{ file_name: string; content_type: string; file_data: Buffer }>(
        "SELECT version.file_name,version.content_type,version.file_data FROM stored_file_versions version JOIN stored_files stored ON stored.id=version.file_id AND stored.department_id=version.department_id WHERE version.id=$1 AND version.file_id=$2 AND version.department_id=$3 AND stored.deleted_at IS NULL",
        [request.params.versionId, request.params.id, departmentId],
      );
      const version = result.rows[0];
      if (!version) return reply.code(404).send({ error: "File version not found." });
      reply.type(version.content_type).header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(version.file_name)}`).header("X-Content-Type-Options", "nosniff");
      return version.file_data;
    });

    routes.post<{ Params: { id: string; versionId: string } }>("/api/files/:id/versions/:versionId/restore", { schema: { params: { type: "object", required: ["id", "versionId"], properties: { id: { type: "string", format: "uuid" }, versionId: { type: "string", format: "uuid" } } } } }, async (request, reply) => {
      const departmentId = await department(request, reply, true);
      if (!departmentId) return reply;
      if (!await requireStoredFileRead(request, reply, departmentId, request.params.id)) return reply;
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        const current = await client.query<{ title: string; category: string; file_name: string; content_type: string; file_size: number; file_data: Buffer }>("SELECT title,category,file_name,content_type,file_size,file_data FROM stored_files WHERE id=$1 AND department_id=$2 AND deleted_at IS NULL FOR UPDATE", [request.params.id, departmentId]);
        const version = await client.query<{ version_number: number; title: string; category: string; file_name: string; content_type: string; file_size: number; file_data: Buffer }>("SELECT version_number,title,category,file_name,content_type,file_size,file_data FROM stored_file_versions WHERE id=$1 AND file_id=$2 AND department_id=$3", [request.params.versionId, request.params.id, departmentId]);
        if (!current.rowCount || !version.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Resource or file version not found." }); }
        const before = current.rows[0]!;
        const sequence = await client.query<{ version_number: number }>("SELECT COALESCE(max(version_number),0)+1 AS version_number FROM stored_file_versions WHERE department_id=$1 AND file_id=$2", [departmentId, request.params.id]);
        await client.query("INSERT INTO stored_file_versions(id,department_id,file_id,version_number,title,category,file_name,content_type,file_size,file_data,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", [randomUUID(), departmentId, request.params.id, sequence.rows[0]!.version_number, before.title, before.category, before.file_name, before.content_type, before.file_size, before.file_data, request.authenticatedUser!.id]);
        const restored = version.rows[0]!;
        await client.query("UPDATE stored_files SET file_name=$3,content_type=$4,file_size=$5,file_data=$6,updated_at=now() WHERE id=$1 AND department_id=$2", [request.params.id, departmentId, restored.file_name, restored.content_type, restored.file_size, restored.file_data]);
        await client.query("DELETE FROM stored_file_versions WHERE id IN (SELECT id FROM stored_file_versions WHERE department_id=$1 AND file_id=$2 ORDER BY version_number DESC OFFSET 5)", [departmentId, request.params.id]);
        await client.query("COMMIT");
        context.realtime.publish("module:file-storage:changed", departmentId, { fileId: request.params.id, action: "version-restored", restoredVersion: restored.version_number });
        return { restored: true, restoredVersion: restored.version_number };
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    });

    routes.delete<{ Params: { id: string } }>("/api/files/:id", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } } }, async (request, reply) => {
      const departmentId = await department(request, reply, true);
      if (!departmentId) return reply;
      if (!await requireStoredFileRead(request, reply, departmentId, request.params.id)) return reply;
      const result = await pool!.query("UPDATE stored_files SET deleted_at = now(), updated_at = now() WHERE id = $1 AND department_id = $2 AND deleted_at IS NULL RETURNING id", [request.params.id, departmentId]);
      if (!result.rowCount) return reply.code(404).send({ error: "Resource not found." });
      return { deleted: true, trashed: true };
    });

    routes.post<{ Params: { id: string } }>("/api/files/:id/restore", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } } }, async (request, reply) => {
      const departmentId = await department(request, reply, true);
      if (!departmentId) return reply;
      if (!await requireStoredFileRead(request, reply, departmentId, request.params.id)) return reply;
      const result = await pool!.query("UPDATE stored_files SET deleted_at = NULL, updated_at = now() WHERE id = $1 AND department_id = $2 AND deleted_at IS NOT NULL RETURNING id", [request.params.id, departmentId]);
      if (!result.rowCount) return reply.code(404).send({ error: "Resource not found." });
      return { restored: true };
    });

    routes.delete<{ Params: { id: string } }>("/api/files/:id/permanent", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } } }, async (request, reply) => {
      const departmentId = await department(request, reply, true);
      if (!departmentId) return reply;
      if (!await requireStoredFileRead(request, reply, departmentId, request.params.id)) return reply;
      const result = await pool!.query("DELETE FROM stored_files WHERE id = $1 AND department_id = $2 AND deleted_at IS NOT NULL RETURNING id", [request.params.id, departmentId]);
      if (!result.rowCount) return reply.code(404).send({ error: "Resource not found." });
      return { deleted: true, permanently: true };
    });
  });
}
