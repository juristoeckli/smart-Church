import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import type { ModuleServerContext, ReplicationRestoreContext } from "../module-sdk.js";

const tables = {
  settings: { name: "finance_settings", key: "", columns: "currency_code updated_at statement_mapping_scope" },
  accounts: { name: "finance_accounts", key: "id", columns: "id code name account_type active created_at updated_at" },
  centers: { name: "finance_cost_centers", key: "id", columns: "id code name active created_at updated_at" },
  donors: { name: "finance_donors", key: "id", columns: "id donor_type display_name email active created_at updated_at" },
  years: { name: "finance_accounting_years", key: "accounting_year", columns: "accounting_year label start_date end_date status created_by updated_by created_at updated_at" },
  taxes: { name: "finance_tax_types", key: "id", columns: "id code name rate_basis_points active created_at updated_at" },
  budgets: { name: "finance_budgets", key: "id", columns: "id accounting_year account_id cost_center_id amount_cents note created_by created_at updated_at" },
  journalNumbers: { name: "finance_journal_numbering", key: "accounting_year", columns: "accounting_year enabled next_number" },
  journals: { name: "finance_transactions", key: "id", columns: "id booking_date accounting_year receipt_number booking_text status reverses_transaction_id created_by created_at is_cost_center_transfer journal_sequence" },
  lines: { name: "finance_transaction_lines", key: "id", columns: "id transaction_id line_number account_id cost_center_id donor_id debit_cents credit_cents line_text" },
  yearEnd: { name: "finance_year_end_transfers", key: "id", columns: "id source_year target_year closing_equity_account_id closing_transaction_id opening_transaction_id created_by created_at" },
  receiptSettings: { name: "finance_receipt_settings", key: "", columns: "organization_name template_text numbering_prefix next_number updated_by updated_at" },
  receiptBatches: { name: "finance_receipt_batches", key: "id", columns: "id accounting_year period_start period_end collective created_by created_at" },
  receipts: { name: "finance_donation_receipts", key: "id", columns: "id batch_id donor_id receipt_number donor_name_snapshot donor_email_snapshot amount_cents currency_code period_start period_end rendered_text transaction_ids created_at" },
  bankImports: { name: "finance_bank_statement_imports", key: "id", columns: "id account_id file_name content_sha256 imported_by imported_at row_count" },
  bankRows: { name: "finance_bank_statement_rows", key: "id", columns: "id import_id line_number booking_date description reference amount_cents status suggested_transaction_id matched_transaction_id reconciled_by reconciled_at" },
  bankRules: { name: "finance_bank_suggestion_rules", key: "id", columns: "id account_id name statement_contains transaction_contains priority active created_by updated_by created_at updated_at" },
  mappings: { name: "finance_bank_statement_account_mappings", key: "source_digest", columns: "source_digest account_id updated_at" },
  evidence: { name: "finance_transaction_evidence", key: "id", columns: "id transaction_id file_name file_size file_data content_hash uploaded_by created_at" },
  audit: { name: "finance_audit", key: "id", columns: "id actor_user_id action record_kind record_id details created_at" },
} as const;
type Table = keyof typeof tables;
type Row = Record<string, unknown>;
type Snapshot = { version: 1 } & Record<Table, Row[]>;
const keys = Object.keys(tables) as Table[];
const userColumns = new Set(["created_by", "updated_by", "actor_user_id", "imported_by", "reconciled_by", "uploaded_by"]);
const textualColumns = new Set([
  "created_at", "updated_at", "reconciled_at", "imported_at",
  "period_start", "period_end", "start_date", "end_date", "booking_date",
  "amount_cents", "credit_cents", "debit_cents", "details",
]);
const mutable = new Set<Table>([
  "settings", "accounts", "centers", "donors", "years", "taxes", "budgets",
  "journalNumbers", "receiptSettings", "bankRules", "mappings",
]);
const maximumBytes = 64 * 1024 * 1024;
const maximumRows = 200_000;
const envelopeContext = Buffer.from("smart-church/finance-standby/v1");
const tooLarge = "Finance exceeds the standby snapshot size or record limit.";

function record(value: unknown): value is Row {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function recordKey(row: Row, table: Table) {
  return JSON.stringify(tables[table].key.split(" ").filter(Boolean).map(column => row[column]));
}

function readSnapshot(value: unknown): Snapshot {
  if (!record(value) || value.version !== 1) throw new Error("The Finance snapshot is invalid.");
  let count = 0;
  for (const key of keys) {
    const columns = tables[key].columns.split(" ");
    const rows = value[key];
    if (!Array.isArray(rows) || !rows.every(row => record(row) && Object.keys(row).length === columns.length
      && columns.every(column => Object.hasOwn(row, column))
      && tables[key].key.split(" ").filter(Boolean).every(column => typeof row[column] === "string" || typeof row[column] === "number"))) {
      throw new Error(`Finance snapshot rows for ${key} are invalid.`);
    }
    if (new Set(rows.map(row => recordKey(row, key))).size !== rows.length) throw new Error(`Finance snapshot rows for ${key} repeat an ID.`);
    count += rows.length;
  }
  if (count > maximumRows) throw new Error(tooLarge);
  return value as Snapshot;
}

function encoded(value: unknown): Buffer {
  const buffer = Buffer.from(JSON.stringify(value), "utf8");
  if (buffer.length > maximumBytes) throw new Error(tooLarge);
  return buffer;
}

function canonicalBase64(value: string): Buffer {
  const buffer = Buffer.from(value, "base64");
  if (buffer.toString("base64") !== value) throw new Error("The Finance snapshot has invalid encrypted or binary data.");
  return buffer;
}

function assertEvidence(snapshot: Snapshot) {
  for (const file of snapshot.evidence) {
    const size = file.file_size;
    if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 1 || size > 10 * 1024 * 1024 ||
        typeof file.file_data !== "string" || file.file_data.length !== Math.ceil(size / 3) * 4) {
      throw new Error("A Finance evidence attachment has an invalid size.");
    }
    const bytes = canonicalBase64(file.file_data);
    if (bytes.length !== size || createHash("sha256").update(bytes).digest("hex") !== file.content_hash) {
      throw new Error("A Finance evidence attachment does not match its recorded hash.");
    }
  }
}

function exactInteger(value: unknown): bigint {
  if ((typeof value !== "string" && typeof value !== "number") || (typeof value === "number" && !Number.isSafeInteger(value)) || !/^-?\d+$/.test(String(value))) {
    throw new Error("A Finance amount or sequence is invalid.");
  }
  return BigInt(value);
}

function orderedJournals(snapshot: Snapshot) {
  const byId = new Map(snapshot.journals.map(row => [row.id, row]));
  const done = new Set<unknown>();
  const ordered: Row[] = [];
  for (const journal of snapshot.journals) {
    let row: Row | undefined = journal;
    const stack: Row[] = [];
    const visiting = new Set<unknown>();
    while (row && !done.has(row.id)) {
      if (visiting.has(row.id)) throw new Error("Finance reversal references form a loop.");
      visiting.add(row.id);
      stack.push(row);
      if (row.reverses_transaction_id === null) break;
      row = byId.get(row.reverses_transaction_id);
      if (!row || row.status !== "posted") throw new Error("A Finance reversal refers to a missing or unposted journal.");
    }
    while (stack.length) {
      const next = stack.pop()!;
      done.add(next.id);
      ordered.push(next);
    }
  }
  return ordered;
}

function assertLedger(snapshot: Snapshot) {
  const journals = new Map(snapshot.journals.map(row => [row.id, row]));
  const totals = new Map<unknown, { debit: bigint; credit: bigint; count: number }>();
  const accounts = new Set(snapshot.accounts.map(row => row.id));
  const centers = new Set(snapshot.centers.map(row => row.id));
  const donors = new Set(snapshot.donors.map(row => row.id));
  for (const row of snapshot.lines) {
    if (!journals.has(row.transaction_id) || !accounts.has(row.account_id) ||
        (row.cost_center_id !== null && !centers.has(row.cost_center_id)) ||
        (row.donor_id !== null && !donors.has(row.donor_id))) {
      throw new Error("A Finance posting line refers to a missing journal, account, cost center, or donor.");
    }
    const debit = exactInteger(row.debit_cents), credit = exactInteger(row.credit_cents);
    if (debit < 0n || credit < 0n || (debit === 0n) === (credit === 0n)) throw new Error("A Finance posting line has an invalid debit or credit.");
    const total = totals.get(row.transaction_id) ?? { debit: 0n, credit: 0n, count: 0 };
    total.debit += debit; total.credit += credit; total.count += 1;
    totals.set(row.transaction_id, total);
  }
  const largestSequence = new Map<unknown, bigint>();
  for (const row of snapshot.journals) {
    const total = totals.get(row.id);
    if (row.status === "posted" && (!total || total.count < 2 || total.debit <= 0n || total.debit !== total.credit)) {
      throw new Error("The Finance snapshot contains an unbalanced posted journal.");
    }
    if (row.journal_sequence !== null) {
      const sequence = exactInteger(row.journal_sequence);
      const largest = largestSequence.get(row.accounting_year) ?? 0n;
      if (sequence > largest) largestSequence.set(row.accounting_year, sequence);
    }
  }
  const numbers = new Map(snapshot.journalNumbers.map(row => [row.accounting_year, exactInteger(row.next_number)]));
  for (const [year, last] of largestSequence) {
    if ((numbers.get(year) ?? 0n) <= last) throw new Error("A Finance journal counter would reuse an allocated receipt number.");
  }
  const receiptCounter = snapshot.receiptSettings[0]?.next_number;
  for (const row of snapshot.receipts) {
    if (!Array.isArray(row.transaction_ids) || row.transaction_ids.some(id => !journals.has(id))) {
      throw new Error("A Finance donation receipt refers to a missing journal.");
    }
    const allocated = /-(\d{6,})$/.exec(String(row.receipt_number))?.[1];
    if (!allocated || receiptCounter === undefined || exactInteger(receiptCounter) <= BigInt(allocated)) {
      throw new Error("The Finance donation receipt counter would reuse an allocated number.");
    }
  }
  const imports = new Map(snapshot.bankImports.map(row => [row.id, row]));
  const observedRows = new Map<unknown, number>();
  for (const row of snapshot.bankRows) {
    if (!imports.has(row.import_id)) throw new Error("A Finance statement row refers to a missing import.");
    observedRows.set(row.import_id, (observedRows.get(row.import_id) ?? 0) + 1);
  }
  if (snapshot.bankImports.some(row => (observedRows.get(row.id) ?? 0) !== row.row_count)) {
    throw new Error("A Finance statement is missing one or more imported rows.");
  }
  if (snapshot.mappings.length && typeof snapshot.settings[0]?.statement_mapping_scope !== "string") {
    throw new Error("A Finance statement mapping has no stable location scope.");
  }
  orderedJournals(snapshot);
  assertEvidence(snapshot);
}

function assertUsers(snapshot: Snapshot, core: unknown) {
  if (!record(core) || !record(core.tables) || !Array.isArray(core.tables.app_users)) {
    throw new Error("Finance standby requires a Core snapshot.");
  }
  const users = new Set(core.tables.app_users.filter(record).map(row => row.id));
  for (const key of keys) {
    for (const row of snapshot[key]) {
      if (Object.entries(row).some(([column, value]) => userColumns.has(column) && value !== null && !users.has(value))) {
        throw new Error("A Finance record refers to an actor outside the signed site account snapshot.");
      }
    }
  }
}

async function readiness(client: Pick<PoolClient, "query">, departmentId: string) {
  const actorQueries = keys.flatMap(key => {
    const table = tables[key];
    const columns = table.columns.split(" ").filter(column => userColumns.has(column));
    return columns.map(column => `SELECT ${column} AS actor_id FROM ${table.name}
      WHERE department_id=$1 AND ${column} IS NOT NULL`);
  });
  const { rows: [status] } = await client.query<{ count: string; bytes: string; outside_actor: boolean }>(
    `WITH totals AS (${keys.map(key => `SELECT count(*) AS records,COALESCE(sum(${key === "evidence"
      ? "file_size * 2 + 512" : "octet_length(row_to_json(item)::text)"}),0) AS bytes
       FROM ${tables[key].name} item WHERE department_id=$1`).join(" UNION ALL ")})
       SELECT sum(records)::text AS count,sum(bytes)::text AS bytes,
           EXISTS (SELECT 1 FROM (${actorQueries.join(" UNION ALL ")}) actors
             WHERE NOT EXISTS (SELECT 1 FROM department_memberships member
               WHERE member.department_id=$1 AND member.user_id=actors.actor_id)) AS outside_actor
         FROM totals`, [departmentId]);
  const recordCount = Number(status.count);
  const blockers = recordCount > maximumRows || Number(status.bytes) > maximumBytes ? [tooLarge] : [];
  if (status.outside_actor) blockers.push("Finance has records attributed to accounts outside this site. Restore those memberships before transfer.");
  return { recordCount, blockers };
}

async function collect(client: Pick<PoolClient, "query">, departmentId: string): Promise<Snapshot> {
  const snapshot = { version: 1 } as Snapshot;
  for (const key of keys) {
    const table = tables[key];
    const columns = table.columns.split(" ").map(column => {
      if (column === "file_data") return "replace(encode(item.file_data,'base64'),chr(10),'') AS file_data";
      if (column.endsWith("_at")) return `to_char(item.${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ${column}`;
      if (textualColumns.has(column) || (column === "next_number" && key === "receiptSettings")) return `item.${column}::text AS ${column}`;
      return `item.${column}`;
    }).join(",");
    const order = (table.key || "department_id").split(" ").map(column => `item.${column}`).join(",");
    snapshot[key] = (await client.query(`SELECT ${columns} FROM ${table.name} item WHERE department_id=$1 ORDER BY ${order}`, [departmentId])).rows;
  }
  return snapshot;
}

function mappedRow(row: Row, context: ReplicationRestoreContext) {
  return Object.fromEntries(Object.entries(row).map(([column, value]) => {
    if (!userColumns.has(column) || value === null) return [column,value];
    const local = context.userIdMap.get(String(value));
    if (!local) throw new Error("A Finance actor cannot be resolved on this standby.");
    return [column,local];
  }));
}

function equalRow(left: Row, right: Row, table: Table, ignoreActors = false) {
  return tables[table].columns.split(" ").every(column => (ignoreActors && userColumns.has(column))
    || JSON.stringify(left[column]) === JSON.stringify(right[column]));
}

function indexed(rows: Row[], table: Table) {
  return new Map(rows.map(row => [recordKey(row, table), row]));
}

function assertTarget(target: Snapshot, source: Snapshot, ignoreActors = false) {
  const existingPosted = new Set(target.journals.filter(row => row.status === "posted").map(row => row.id));
  const existingLines = indexed(target.lines, "lines");
  if (source.lines.some(row => existingPosted.has(row.transaction_id) && !existingLines.has(recordKey(row,"lines")))) {
    throw new Error("The incoming Finance snapshot adds a line to a journal already posted on the standby.");
  }
  for (const key of keys) {
    const incoming = indexed(source[key], key);
    for (const old of target[key]) {
      const next = incoming.get(recordKey(old, key));
      if (!next) {
        if (key === "bankRules") continue;
        throw new Error(`The incoming Finance snapshot omits existing ${key} records on the standby.`);
      }
      if ((key === "journalNumbers" || key === "receiptSettings") && exactInteger(next.next_number) < exactInteger(old.next_number)) {
        throw new Error("The incoming Finance snapshot would roll back a receipt counter.");
      }
      if (equalRow(old,next,key,ignoreActors) || mutable.has(key)) continue;
      if (key === "journals" && old.status === "draft") continue;
      if (key === "bankRows" && ["unmatched","suggested"].includes(String(old.status))
          && ["matched","ignored"].includes(String(next.status))) {
        // The live trigger checks the allowed transition, original columns, and references.
        continue;
      }
      throw new Error(`The incoming Finance snapshot differs from existing immutable ${key} records on the standby.`);
    }
  }
}

async function writeRow(client: PoolClient, departmentId: string, key: Table, row: Row, update: boolean) {
  const table = tables[key];
  const columns = table.columns.split(" ");
  const keyColumns = table.key.split(" ").filter(Boolean);
  const value = (column: string) => column === "file_data" ? canonicalBase64(String(row[column])) : row[column];
  if (update) {
    const mutableColumns = columns.filter(column => !keyColumns.includes(column));
    const conditions = keyColumns.map((column,index)=>`${column}=$${index+2}`).join(" AND ");
    const assignments = mutableColumns.map((column,index)=>`${column}=$${index+2+keyColumns.length}`).join(",");
    await client.query(`UPDATE ${table.name} SET ${assignments} WHERE department_id=$1${conditions ? " AND " + conditions : ""}`,
      [departmentId,...keyColumns.map(value),...mutableColumns.map(value)]);
  } else {
    await client.query(`INSERT INTO ${table.name}(department_id,${columns.join(",")}) VALUES(${[departmentId,...columns].map((_,index)=>"$"+(index+1)).join(",")})`,
      [departmentId,...columns.map(value)]);
  }
}

export function registerFinanceReplication(context: ModuleServerContext) {
  const { pool, isDatabaseReady } = context;
  context.replication.register({
    schemaVersion: "1",
    async requiresSnapshot(departmentId) {
      return Boolean(pool && isDatabaseReady() && (await readiness(pool,departmentId)).recordCount);
    },
    async inspect(departmentId) {
      if (!pool || !isDatabaseReady()) return { ready:false, blockers:["The Finance database is unavailable."], recordCount:0 };
      const state = await readiness(pool,departmentId);
      return { ready:state.blockers.length===0, ...state };
    },
    async exportSnapshot(client, departmentId) {
      const state = await readiness(client,departmentId);
      if (state.blockers.length) throw new Error(state.blockers.join(" "));
      const snapshot=readSnapshot(await collect(client,departmentId));
      assertLedger(snapshot);
      encoded(snapshot);
      return snapshot;
    },
    async prepareSnapshotForPeer(input, seal) {
      const plain=encoded(readSnapshot(input));
      const key=randomBytes(32), iv=randomBytes(12);
      const cipher=createCipheriv("aes-256-gcm",key,iv);
      cipher.setAAD(envelopeContext);
      const ciphertext=Buffer.concat([cipher.update(plain),cipher.final()]);
      return { version:1, sealedKey:seal(key.toString("base64")), iv:iv.toString("base64"),
        tag:cipher.getAuthTag().toString("base64"), ciphertext:ciphertext.toString("base64") };
    },
    async restoreSnapshotFromPeer(input, open) {
      if (!record(input) || input.version!==1 || typeof input.sealedKey!=="string" || input.sealedKey.length>65536 ||
        typeof input.iv!=="string" || input.iv.length!==16 || typeof input.tag!=="string" || input.tag.length!==24 ||
        typeof input.ciphertext!=="string" || input.ciphertext.length>Math.ceil(maximumBytes/3)*4) {
        throw new Error("The Finance snapshot must be encrypted for this standby.");
      }
      const key=canonicalBase64(open(input.sealedKey));
      if (key.length!==32) throw new Error("The Finance snapshot encryption key is invalid.");
      const decipher=createDecipheriv("aes-256-gcm",key,canonicalBase64(input.iv));
      decipher.setAAD(envelopeContext);
      decipher.setAuthTag(canonicalBase64(input.tag));
      const plain=Buffer.concat([decipher.update(canonicalBase64(input.ciphertext)),decipher.final()]);
      if (plain.length>maximumBytes) throw new Error(tooLarge);
      return readSnapshot(JSON.parse(plain.toString("utf8")));
    },
    restoreDependencies: {
      moduleIds:["core-site"],
      validate(input, dependencies) { const snapshot=readSnapshot(input); assertLedger(snapshot); assertUsers(snapshot,dependencies.get("core-site")); },
    },
    async validateRestoreTarget(client,departmentId,input) {
      if (input===undefined) {
        if ((await readiness(client,departmentId)).recordCount) throw new Error("The incoming snapshot omits existing Finance data.");
        return;
      }
      assertTarget(await collect(client,departmentId),readSnapshot(input),true);
    },
    async restoreSnapshot(client,departmentId,input,restoreContext) {
      const source=readSnapshot(input);
      const target=await collect(client,departmentId);
      const mapped=Object.fromEntries([["version",1],...keys.map(key=>[key,source[key].map(row=>mappedRow(row,restoreContext))])]) as Snapshot;
      assertTarget(target,mapped);
      const updatesAfterLines: Row[]=[];
      for (const key of keys) {
        const existing=indexed(target[key],key);
        if (key==="bankRules") {
          const current=indexed(mapped.bankRules,"bankRules");
          for (const row of target.bankRules) if (!current.has(recordKey(row,key))) {
            await client.query("DELETE FROM finance_bank_suggestion_rules WHERE department_id=$1 AND id=$2",[departmentId,row.id]);
          }
        }
        for (const row of key==="journals" ? orderedJournals(mapped) : mapped[key]) {
          const old=existing.get(recordKey(row,key));
          if (old && equalRow(old,row,key)) continue;
          if (key==="journals" && old?.status==="draft" && row.status==="posted") {
            updatesAfterLines.push(row);
          } else {
            await writeRow(client,departmentId,key,row,Boolean(old));
          }
        }
        if (key==="lines") for (const row of updatesAfterLines) await writeRow(client,departmentId,"journals",row,true);
      }
      return { recordCount:keys.reduce((count,key)=>count+source[key].length,0) };
    },
    async verifySnapshot(client,departmentId,input,restoreContext) {
      const source=readSnapshot(input), restored=await collect(client,departmentId);
      for (const key of keys) {
        const expected=indexed(source[key].map(row=>restoreContext ? mappedRow(row,restoreContext) : row),key);
        if (expected.size!==restored[key].length || restored[key].some(row=> {
          const candidate=expected.get(recordKey(row,key));
          return !candidate || !equalRow(candidate,row,key);
        })) return { ready:false, blockers:[`Finance ${key} differs from the signed snapshot.`] };
      }
      return { ready:true, blockers:[] };
    },
  });
}
