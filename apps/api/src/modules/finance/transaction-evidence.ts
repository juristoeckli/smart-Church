import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import type { ModuleServerContext } from "../module-sdk.js";
import { attachmentFilename, filenameForUpload } from "../people-records/attachments.js";

const uploadType = "application/vnd.smart-church.finance-evidence";
const path = "/api/modules/finance/transactions/:transactionId/evidence";
const maxBytes = 10 * 1024 * 1024;
const maxFiles = 10;
const maxBase64 = Math.ceil(maxBytes / 3) * 4;
export const simpleEvidenceBodyLimit = maxBase64 + 32 * 1024;
export const simpleEvidenceSchema = {
  type: "array", maxItems: maxFiles, items: {
    type: "object", additionalProperties: false, required: ["filename", "base64"],
    properties: {
      filename: { type: "string", minLength: 1, maxLength: 255 },
      base64: { type: "string", minLength: 4, maxLength: maxBase64 },
    },
  },
} as const;
export type SimpleEvidenceInput = { filename: string; base64: string };
export type TransactionEvidence = { fileName: string; payload: Buffer; contentHash: string };
type EvidenceError = { status: number; error: string };
const uuid = { type:"string",format:"uuid" } as const;
const transactionParams = { type:"object",additionalProperties:false,required:["transactionId"],properties:{ transactionId:uuid } } as const;
const fileParams = { type:"object",additionalProperties:false,required:["transactionId","fileId"],properties:{ transactionId:uuid,fileId:uuid } } as const;
type Params = { transactionId:string };
type Hooks = {
  department: (request: FastifyRequest, reply: FastifyReply, write?: boolean) => Promise<string | null>;
  audit: (client: PoolClient,id: string,request: FastifyRequest,action: string,kind: string,recordId: string,details: Record<string,unknown>) => Promise<void>;
};

function supportedExtension(file: Buffer) {
  if (file.length >= 8 && file.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "png";
  if (file.length >= 4 && file[0]===255 && file[1]===216 && file[2]===255) return "jpg";
  if (file.length >= 8 && /^%PDF-[12][.][0-9]/.test(file.toString("ascii",0,8))) return "pdf";
  return null;
}

function prepareEvidence(filename: string, payload: Buffer): TransactionEvidence | EvidenceError {
  if (!Buffer.isBuffer(payload) || !payload.length) return { status: 400, error: "Choose a non-empty receipt." };
  if (payload.length > maxBytes) return { status: 413, error: "Receipts must be 10 MiB or smaller." };
  const extension = supportedExtension(payload);
  if (!extension) return { status: 415, error: "Upload a PDF, PNG or JPEG receipt." };
  const base = filenameForUpload(filename).replace(/\.[^.]+$/, "");
  const fileName = Array.from(base.trim() || "receipt").slice(0,176).join("") + "." + extension;
  return { fileName, payload, contentHash: createHash("sha256").update(payload).digest("hex") };
}

export function prepareSimpleEvidence(inputs: SimpleEvidenceInput[]): TransactionEvidence[] | EvidenceError {
  const unique = new Map<string,TransactionEvidence>();
  let total = 0;
  for (const input of inputs) {
    const payload = Buffer.from(input.base64,"base64");
    if (payload.toString("base64") !== input.base64) return { status: 400, error: "One receipt could not be decoded." };
    total += payload.length;
    if (total > maxBytes) return { status: 413, error: "Simple booking receipts can total up to 10 MiB." };
    const file = prepareEvidence(input.filename,payload);
    if ("error" in file) return file;
    if (!unique.has(file.contentHash)) unique.set(file.contentHash,file);
  }
  return [...unique.values()].sort((a,b) => a.contentHash.localeCompare(b.contentHash));
}

export async function storeTransactionEvidence(client: PoolClient, departmentId: string, transactionId: string, actorId: string, file: TransactionEvidence) {
  const fileId = randomUUID();
  await client.query(`
    INSERT INTO finance_transaction_evidence(id,department_id,transaction_id,file_name,file_size,file_data,content_hash,uploaded_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [fileId,departmentId,transactionId,file.fileName,file.payload.length,file.payload,file.contentHash,actorId],
  );
  return fileId;
}

export function registerTransactionEvidence(routes: FastifyInstance, context: ModuleServerContext, { department,audit }: Hooks) {
  const { pool,validateMutation,lockDepartmentForWrite } = context;
  routes.addContentTypeParser(uploadType,{ parseAs:"buffer",bodyLimit:maxBytes },(_request,body,done) => done(null,body));

  routes.get<{ Params:Params }>(path,{schema:{params:transactionParams}},async (request,reply) => {
    const id = await department(request,reply);
    if (!id) return reply;
    const { rows:[record] } = await pool!.query<{ files: unknown[] }>(`
      SELECT COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'fileName',e.file_name,'fileSize',e.file_size,
          'uploadedAt',e.created_at,'uploadedBy',COALESCE(attribution.actor_name,account.display_name)) ORDER BY e.created_at DESC,e.id)
        FROM finance_transaction_evidence e LEFT JOIN app_users account ON account.id=e.uploaded_by
        LEFT JOIN finance_actor_attribution attribution ON attribution.department_id=e.department_id
          AND attribution.record_table='finance_transaction_evidence' AND attribution.record_key=e.id::text AND attribution.actor_slot='uploaded_by'
        WHERE e.department_id=t.department_id AND e.transaction_id=t.id),'[]') AS files
      FROM finance_transactions t WHERE t.department_id=$1 AND t.id=$2 AND t.status='posted'`,[id,request.params.transactionId]);
    reply.header("Cache-Control","private, no-store");
    if (!record) return reply.code(404).send({error:"Posted transaction not found."});
    return reply.send(record.files);
  });

  routes.post<{ Params:Params; Querystring:{ filename:string }; Body:Buffer }>(path,{
    bodyLimit:maxBytes,
    schema:{ params:transactionParams,querystring:{ type:"object",additionalProperties:false,required:["filename"],
      properties:{ filename:{type:"string",minLength:1,maxLength:255} } } },
  },async (request,reply) => {
    const id = await department(request,reply,true);
    if (!id || !validateMutation(request,reply)) return reply;
    const evidence = prepareEvidence(request.query.filename, request.body);
    if ("error" in evidence) return reply.code(evidence.status).send({ error: evidence.error });
    const { transactionId } = request.params;
    const client = await pool!.connect();
    const rollback = async (status: number,error: string) => {
      await client.query("ROLLBACK");
      return reply.code(status).send({error});
    };
    reply.header("Cache-Control","private, no-store");
    try {
      await client.query("BEGIN");
      if (!await lockDepartmentForWrite(client,id)) return await rollback(423,"This location is read-only.");
      const posted = await client.query("SELECT id FROM finance_transactions WHERE department_id=$1 AND id=$2 AND status='posted' FOR UPDATE",[id,transactionId]);
      if (!posted.rows[0]) return await rollback(404,"Posted transaction not found.");
      const { rows:[existing] } = await client.query<{ id:string }>(
        "SELECT id FROM finance_transaction_evidence WHERE department_id=$1 AND transaction_id=$2 AND content_hash=$3",
        [id,transactionId,evidence.contentHash],
      );
      if (existing) {
        await client.query("COMMIT");
        return reply.send({id:existing.id});
      }
      const { rows:[limit] } = await client.query<{ count:number }>(
        "SELECT count(*)::int AS count FROM finance_transaction_evidence WHERE department_id=$1 AND transaction_id=$2",[id,transactionId],
      );
      if (limit.count>=maxFiles) return await rollback(409,"A transaction can have up to 10 supporting receipts.");
      const fileId = await storeTransactionEvidence(client,id,transactionId,request.authenticatedUser!.id,evidence);
      await audit(client,id,request,"receipt_evidence_added","transaction",transactionId,{ fileId,fileSize:evidence.payload.length });
      await client.query("COMMIT");
      return reply.code(201).send({id:fileId});
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  routes.get<{ Params:Params & { fileId:string } }>(path+"/:fileId",{schema:{params:fileParams}},async (request,reply) => {
    const id = await department(request,reply);
    if (!id) return reply;
    const { transactionId,fileId } = request.params;
    const { rows:[file] } = await pool!.query<{ file_name:string;file_data:Buffer }>(`
      SELECT e.file_name,e.file_data FROM finance_transaction_evidence e
      JOIN finance_transactions t ON t.department_id=e.department_id AND t.id=e.transaction_id AND t.status='posted'
      WHERE e.department_id=$1 AND e.transaction_id=$2 AND e.id=$3`,[id,transactionId,fileId]);
    reply.header("Cache-Control","private, no-store");
    if (!file) return reply.code(404).send({error:"Receipt not found."});
    return reply.type("application/octet-stream").header("Content-Disposition",attachmentFilename(file.file_name))
      .header("X-Content-Type-Options","nosniff").header("Cross-Origin-Resource-Policy","same-origin").send(file.file_data);
  });
}
