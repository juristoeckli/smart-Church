import { exportFormatQuery, sendReportWorkbook, type ExportFormatQuery } from "./xlsx.js";
import type { Pool, PoolClient } from "pg";
import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ModuleServerContext } from "../module-sdk.js";
import { canManagePeopleFields } from "../people-records/field-privacy.js";

type FieldType = "text" | "number" | "date";
type DatasetKey = "people" | "groups" | "memberships" | "events" | "finance" | "resourceBookings";
type Field = { key: string; label: string; type: FieldType };
type Filter = { field: string; operator: "equals" | "contains" | "gt" | "gte" | "lt" | "lte"; value: string | number };
type ChartType = "table" | "column" | "line";
type Axis = string | string[];
type Definition = { dataset: DatasetKey; columns: string[]; filters: Filter[]; sortBy: string; direction: "asc" | "desc"; groupBy?: Axis; pivotBy?: Axis; chartType?: ChartType; aggregate?: { operation: "count" | "sum" | "average"; field?: string } };
type DataSet = { key: DatasetKey; title: string; permission: "people" | "groups" | "events" | "finance" | "resources"; description: string; fields: Field[]; sql: string };
const MAX_ROWS = 5000;
const MAX_PREVIEW = 500;
const MAX_AXIS_FIELDS = 3;
const datasetDefinitions: DataSet[] = [
  { key: "people", title: "People", permission: "people", description: "Private contact directory fields.", fields: [
    { key: "firstName", label: "First name", type: "text" }, { key: "lastName", label: "Last name", type: "text" }, { key: "email", label: "Email", type: "text" }, { key: "phone", label: "Phone", type: "text" }, { key: "status", label: "Status", type: "text" }, { key: "createdDate", label: "Created date", type: "date" },
  ], sql: `SELECT first_name AS "firstName",last_name AS "lastName",COALESCE(email,'') AS email,COALESCE(phone,'') AS phone,status,created_at::date::text AS "createdDate" FROM contacts c WHERE c.department_id=$1 ORDER BY c.last_name,c.first_name LIMIT ${MAX_ROWS}` },
  { key: "groups", title: "Groups", permission: "groups", description: "Group directory fields.", fields: [
    { key: "groupName", label: "Group name", type: "text" }, { key: "createdDate", label: "Created date", type: "date" },
  ], sql: `SELECT name AS "groupName",created_at::date::text AS "createdDate" FROM church_groups WHERE department_id=$1 ORDER BY name LIMIT ${MAX_ROWS}` },
  { key: "memberships", title: "Group memberships", permission: "groups", description: "Members and roles. Contact fields require private People access.", fields: [
    { key: "groupName", label: "Group", type: "text" }, { key: "firstName", label: "First name", type: "text" }, { key: "lastName", label: "Last name", type: "text" }, { key: "role", label: "Role", type: "text" }, { key: "membershipStatus", label: "Membership status", type: "text" }, { key: "joinedOn", label: "Joined on", type: "date" }, { key: "email", label: "Email", type: "text" },
  ], sql: `SELECT g.name AS "groupName",c.first_name AS "firstName",c.last_name AS "lastName",m.role,m.status AS "membershipStatus",m.joined_on::text AS "joinedOn",COALESCE(c.email,'') AS email FROM group_members m JOIN church_groups g ON g.id=m.group_id JOIN contacts c ON c.id=m.contact_id AND c.department_id=g.department_id WHERE g.department_id=$1 ORDER BY g.name,c.last_name,c.first_name LIMIT ${MAX_ROWS}` },
  { key: "events", title: "Events and attendance", permission: "events", description: "Service dates, attendance totals, and check-in counts.", fields: [
    { key: "eventDate", label: "Date", type: "date" }, { key: "title", label: "Title", type: "text" }, { key: "kind", label: "Type", type: "text" }, { key: "location", label: "Location", type: "text" }, { key: "adults", label: "Adults", type: "number" }, { key: "children", label: "Children", type: "number" }, { key: "checkIns", label: "Check-ins", type: "number" }, { key: "firstTimeVisitors", label: "First-time visitors", type: "number" },
  ], sql: `SELECT event.event_date::text AS "eventDate",event.title,event.kind,event.location,event.attendance_adults AS adults,event.attendance_children AS children,COUNT(checkin.contact_id)::int AS "checkIns",COUNT(checkin.contact_id) FILTER(WHERE checkin.first_time_visitor)::int AS "firstTimeVisitors" FROM service_events event LEFT JOIN event_attendance_checkins checkin ON checkin.event_id=event.id LEFT JOIN contacts contact ON contact.id=checkin.contact_id AND contact.department_id=event.department_id WHERE event.department_id=$1 AND (checkin.contact_id IS NULL OR contact.id IS NOT NULL) GROUP BY event.id ORDER BY event.event_date DESC,event.start_time DESC LIMIT ${MAX_ROWS}` },
  { key: "resourceBookings", title: "Resource bookings", permission: "resources", description: "Booking dates, status, and duration by resource. Dates use the location time zone.", fields: [
    { key: "resourceName", label: "Resource", type: "text" },
    { key: "category", label: "Resource category", type: "text" },
    { key: "startsOn", label: "Start date", type: "date" },
    { key: "endsOn", label: "End date", type: "date" },
    { key: "status", label: "Booking status", type: "text" },
    { key: "durationMinutes", label: "Duration (minutes)", type: "number" },
  ], sql: `SELECT resource.name AS "resourceName", resource.category,
                 to_char(booking.starts_at AT TIME ZONE department.time_zone, 'YYYY-MM-DD') AS "startsOn",
                 to_char(booking.ends_at AT TIME ZONE department.time_zone, 'YYYY-MM-DD') AS "endsOn",
                 booking.status,
                 extract(epoch FROM booking.ends_at - booking.starts_at)::double precision / 60 AS "durationMinutes"
            FROM resource_bookings booking
            JOIN bookable_resources resource ON resource.id=booking.resource_id AND resource.department_id=booking.department_id
            JOIN departments department ON department.id=booking.department_id
           WHERE booking.department_id=$1
           ORDER BY booking.starts_at DESC, booking.id
           LIMIT ${MAX_ROWS}` },
  { key: "finance", title: "Finance postings", permission: "finance", description: "Posted ledger lines with account, donor, and cost-center labels.", fields: [
    { key: "bookingDate", label: "Booking date", type: "date" }, { key: "receiptNumber", label: "Receipt number", type: "text" }, { key: "bookingText", label: "Booking text", type: "text" }, { key: "accountCode", label: "Account code", type: "text" }, { key: "accountName", label: "Account", type: "text" }, { key: "costCenter", label: "Cost center", type: "text" }, { key: "donor", label: "Donor", type: "text" }, { key: "debitCents", label: "Debit (minor units)", type: "number" }, { key: "creditCents", label: "Credit (minor units)", type: "number" },
  ], sql: `SELECT txn.booking_date::text AS "bookingDate",txn.receipt_number AS "receiptNumber",txn.booking_text AS "bookingText",account.code AS "accountCode",account.name AS "accountName",COALESCE(center.name,'') AS "costCenter",COALESCE(donor.display_name,'') AS donor,line.debit_cents::numeric AS "debitCents",line.credit_cents::numeric AS "creditCents" FROM finance_transaction_lines line JOIN finance_transactions txn ON txn.id=line.transaction_id AND txn.department_id=line.department_id JOIN finance_accounts account ON account.id=line.account_id AND account.department_id=line.department_id LEFT JOIN finance_cost_centers center ON center.id=line.cost_center_id AND center.department_id=line.department_id LEFT JOIN finance_donors donor ON donor.id=line.donor_id AND donor.department_id=line.department_id WHERE line.department_id=$1 AND txn.status='posted' ORDER BY txn.booking_date DESC,txn.created_at DESC LIMIT ${MAX_ROWS}` },
];
const uuid = { type: "string", format: "uuid" };

type DesignerAccess = Pick<FastifyRequest, "activeDepartmentRole" | "activeDepartmentPermissions" | "activeDepartmentModulePermissions">;

function permitted(request: DesignerAccess, permission: DataSet["permission"]) {
  if (request.activeDepartmentRole === "site_admin") return true;
  const grants = request.activeDepartmentPermissions ?? [];
  if (permission === "people") return grants.includes("people_view_private") || grants.includes("people_manage");
  if (permission === "groups") return grants.includes("groups_manage");
  if (permission === "events") return grants.includes("events_manage");
  if (permission === "resources") return grants.includes("resources_manage") || (request.activeDepartmentModulePermissions?.["resource-scheduler"] ?? []).includes("manage");
  const finance = request.activeDepartmentModulePermissions?.finance ?? [];
  return finance.includes("view") || finance.includes("manage");
}

function axisKeys(axis?: Axis) {
  return typeof axis === "string" ? [axis] : axis ?? [];
}

function cleanAxis(value: unknown, fields: Map<string, Field>): string[] | null {
  if (value === undefined || value === "") return [];
  const keys = Array.isArray(value) ? value : [value];
  if (keys.length > MAX_AXIS_FIELDS || new Set(keys).size !== keys.length || keys.some((key) => typeof key !== "string" || !fields.has(key))) return null;
  return keys;
}

function cleanDefinition(input: unknown, fields: Field[]): Definition | string {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "Choose a report definition.";
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => !["dataset", "columns", "filters", "sortBy", "direction", "groupBy", "pivotBy", "chartType", "aggregate"].includes(key))) return "The report definition contains an unsupported option.";
  const fieldByKey = new Map(fields.map((field) => [field.key, field]));
  const dataset = value.dataset;
  if (typeof dataset !== "string" || !datasetDefinitions.some((item) => item.key === dataset)) return "Choose an available dataset.";
  if (!Array.isArray(value.columns) || value.columns.length < 1 || value.columns.length > 12 || value.columns.some((key) => typeof key !== "string" || !fieldByKey.has(key)) || new Set(value.columns).size !== value.columns.length) return "Choose between one and twelve available columns.";
  if (!Array.isArray(value.filters) || value.filters.length > 8) return "Use no more than eight filters.";
  const filters: Filter[] = [];
  for (const raw of value.filters) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "A filter is invalid.";
    const f = raw as Record<string, unknown>;
    if (Object.keys(f).some((key) => !["field", "operator", "value"].includes(key))) return "A filter contains an unsupported option.";
    const field = typeof f.field === "string" ? fieldByKey.get(f.field) : undefined;
    const operator = f.operator;
    if (!field || !["equals", "contains", "gt", "gte", "lt", "lte"].includes(String(operator))) return "A filter uses an unsupported field or operator.";
    if (operator === "contains" && field.type !== "text") return "Contains can only be used with text fields.";
    if (["gt", "gte", "lt", "lte"].includes(String(operator)) && field.type === "text") return "Numeric or date comparisons need a number or date field.";
    let filterValue: string | number;
    if (field.type === "number") {
      if (typeof f.value !== "number" || !Number.isFinite(f.value) || !Number.isSafeInteger(f.value)) return "Enter a whole numeric value within the supported safe range.";
      filterValue = f.value;
    } else {
      if (typeof f.value !== "string" || f.value.length > 200 || !f.value.trim()) return "Enter a filter value.";
      if (field.type === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(f.value) || !Number.isFinite(Date.parse(f.value + "T00:00:00Z")) || new Date(f.value + "T00:00:00Z").toISOString().slice(0, 10) !== f.value)) return "Enter a valid date filter value.";
      filterValue = f.value.trim();
    }
    filters.push({ field: field.key, operator: operator as Filter["operator"], value: filterValue });
  }
  if (value.sortBy !== undefined && (typeof value.sortBy !== "string" || !fieldByKey.has(value.sortBy))) return "Choose an available sort field.";
  if (value.direction !== undefined && value.direction !== "asc" && value.direction !== "desc") return "Choose ascending or descending sort order.";
  const sortBy = typeof value.sortBy === "string" ? value.sortBy : String(value.columns[0]);
  const direction = value.direction === "desc" ? "desc" : "asc";
  const rowKeys = cleanAxis(value.groupBy, fieldByKey);
  if (!rowKeys) return `Choose up to ${MAX_AXIS_FIELDS} distinct row fields.`;
  const columnKeys = cleanAxis(value.pivotBy, fieldByKey);
  if (!columnKeys || (columnKeys.length > 0 && !rowKeys.length) || columnKeys.some((key) => rowKeys.includes(key))) return `Choose up to ${MAX_AXIS_FIELDS} distinct pivot column fields that are not used on the row axis.`;
  const groupBy = rowKeys.length > 1 ? rowKeys : rowKeys[0];
  const pivotBy = columnKeys.length > 1 ? columnKeys : columnKeys[0];
  const chartType = value.chartType;
  if (chartType !== undefined && chartType !== "table" && chartType !== "column" && chartType !== "line") return "Choose a supported report presentation.";
  if (!groupBy && (chartType === "column" || chartType === "line")) return "Group report rows to use a chart.";
  let aggregate: Definition["aggregate"];
  if (value.aggregate !== undefined && value.aggregate !== null) {
    if (!value.aggregate || typeof value.aggregate !== "object" || Array.isArray(value.aggregate)) return "Choose a supported aggregate.";
    const raw = value.aggregate as Record<string, unknown>;
    if (Object.keys(raw).some((key) => !["operation", "field"].includes(key))) return "The aggregate contains an unsupported option.";
    if (!["count", "sum", "average"].includes(String(raw.operation))) return "Choose count, sum, or average.";
    const numeric = typeof raw.field === "string" ? fieldByKey.get(raw.field) : undefined;
    if (raw.operation !== "count" && (!numeric || numeric.type !== "number")) return "Sum and average need an available numeric field.";
    aggregate = { operation: raw.operation as "count" | "sum" | "average", ...(raw.operation === "count" ? {} : { field: numeric!.key }) };
  }
  if (groupBy && !aggregate) aggregate = { operation: "count" };
  return { dataset: dataset as DatasetKey, columns: value.columns as string[], filters, sortBy, direction, ...(groupBy ? { groupBy } : {}), ...(pivotBy ? { pivotBy } : {}), ...(chartType ? { chartType } : {}), ...(aggregate ? { aggregate } : {}) };
}
function compare(a: unknown, b: unknown, type: FieldType) {
  if (type === "number") {
    const left = String(a ?? 0), right = String(b ?? 0);
    if (/^-?\d+$/.test(left) && /^-?\d+$/.test(right)) { const difference = BigInt(left) - BigInt(right); return difference < 0n ? -1 : difference > 0n ? 1 : 0; }
    return Number(a ?? 0) - Number(b ?? 0);
  }
  return String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: type === "date", sensitivity: "base" });
}

const MAX_PIVOT_COLUMNS = 24;
class PivotWidthError extends Error {
  constructor() { super(`Pivot columns have more than ${MAX_PIVOT_COLUMNS} distinct combinations. Add a filter or change the column fields.`); }
}

function aggregateRecords(records: Array<Record<string, unknown>>, operation: NonNullable<Definition["aggregate"]>["operation"], field: Field | undefined) {
  if (operation === "count") return records.length;
  const values = field ? records.map((row) => row[field.key] ?? 0) : [];
  if (operation === "sum" && values.every((value) => /^-?\d+$/.test(String(value)))) {
    return values.reduce<bigint>((sum, value) => sum + BigInt(String(value)), 0n).toString();
  }
  const sum = values.reduce<number>((total, value) => total + Number(value), 0);
  return operation === "average" && values.length ? sum / values.length : sum;
}

function aggregateLabel(operation: NonNullable<Definition["aggregate"]>["operation"], field: Field | undefined) {
  return operation === "count" ? "Count" : `${operation === "sum" ? "Sum" : "Average"} of ${field?.label ?? "value"}`;
}

function groupRows(rows: Array<Record<string, unknown>>, fields: Field[]) {
  const groups = new Map<string, { values: string[]; records: Array<Record<string, unknown>> }>();
  for (const row of rows) {
    const values = fields.map(({ key }) => String(row[key] ?? ""));
    const key = JSON.stringify(values);
    const existing = groups.get(key);
    if (existing) existing.records.push(row);
    else groups.set(key, { values, records: [row] });
  }
  return groups;
}

function compareAxis(left: string[], right: string[], fields: Field[]) {
  for (const [index, field] of fields.entries()) {
    const order = compare(left[index], right[index], field.type);
    if (order) return order;
  }
  return 0;
}

function groupedReport(rows: Array<Record<string, unknown>>, definition: Definition, rowFields: Field[], columnFields: Field[], valueField: Field | undefined, maxOutputRows: number) {
  const direction = definition.direction === "desc" ? -1 : 1;
  const groups = [...groupRows(rows, rowFields).values()].sort((left, right) => compareAxis(left.values, right.values, rowFields) * direction);
  const { operation } = definition.aggregate!;
  const valueLabel = aggregateLabel(operation, valueField);
  const rowColumns = rowFields.map(({ key, label }) => ({ key, label }));
  const visible = groups.slice(0, maxOutputRows);
  const rowValues = (values: string[]) => rowFields.map(({ key }, index) => [key, values[index]] as const);
  if (!columnFields.length) return {
    columns: [...rowColumns, { key: "aggregate", label: valueLabel }],
    rows: visible.map(({ values, records }) => Object.fromEntries([...rowValues(values), ["aggregate", aggregateRecords(records, operation, valueField)]])),
    totalRows: groups.length,
  };

  const categories = groupRows(rows, columnFields);
  if (categories.size > MAX_PIVOT_COLUMNS) throw new PivotWidthError();
  const legacyLayout = rowFields.length === 1 && columnFields.length === 1;
  if (legacyLayout) rowColumns[0].label = `${rowFields[0].label} / ${columnFields[0].label} (${valueLabel})`;
  const pivotColumns = [...categories.entries()].sort((left, right) => compareAxis(left[1].values, right[1].values, columnFields)).map(([categoryKey, { values }], index) => {
    const tuple = columnFields.map(({ label }, position) => `${label}: ${values[position] ? JSON.stringify(values[position]) : "(Blank)"}`).join(" › ");
    return { categoryKey, key: `pivot_${index}`, label: legacyLayout ? values[0] || "(Blank)" : `${tuple} (${valueLabel})` };
  });
  return {
    columns: [...rowColumns, ...pivotColumns.map(({ key, label }) => ({ key, label }))],
    rows: visible.map(({ values, records }) => {
      const cells = groupRows(records, columnFields);
      return Object.fromEntries([...rowValues(values), ...pivotColumns.map(({ key, categoryKey }) => {
        const cell = cells.get(categoryKey);
        return [key, cell ? aggregateRecords(cell.records, operation, valueField) : null];
      })]);
    }),
    totalRows: groups.length,
  };
}

function applyDefinition(inputRows: Array<Record<string, unknown>>, definition: Definition, dataset: DataSet, maxOutputRows = MAX_PREVIEW) {
  const byKey = new Map(dataset.fields.map((field) => [field.key, field]));
  const filtered = inputRows.filter((row) => definition.filters.every((filter) => {
    const field = byKey.get(filter.field)!;
    const raw = row[field.key];
    if (filter.operator === "equals") return field.type === "text" ? String(raw ?? "").toLocaleLowerCase() === String(filter.value).toLocaleLowerCase() : compare(raw, filter.value, field.type) === 0;
    if (filter.operator === "contains") return String(raw ?? "").toLocaleLowerCase().includes(String(filter.value).toLocaleLowerCase());
    const order = compare(raw, filter.value, field.type);
    return filter.operator === "gt" ? order > 0 : filter.operator === "gte" ? order >= 0 : filter.operator === "lt" ? order < 0 : order <= 0;
  }));
  const sortField = byKey.get(definition.sortBy)!;
  if (definition.groupBy && definition.aggregate) {
    const rowKeys = axisKeys(definition.groupBy);
    const rowFields = rowKeys.map((key) => byKey.get(key)!);
    const columnFields = axisKeys(definition.pivotBy).map((key) => byKey.get(key)!);
    const valueField = definition.aggregate.field ? byKey.get(definition.aggregate.field) : undefined;
    const chartType = definition.chartType ?? "table";
    return { ...groupedReport(filtered, definition, rowFields, columnFields, valueField, maxOutputRows), capped: inputRows.length === MAX_ROWS, chartType, chartCategoryKeys: rowKeys };
  }
  filtered.sort((a, b) => compare(a[definition.sortBy], b[definition.sortBy], sortField.type) * (definition.direction === "desc" ? -1 : 1));
  const columns = definition.columns.map((key) => ({ key, label: byKey.get(key)!.label }));
  return { columns, rows: filtered.slice(0, maxOutputRows).map((row) => Object.fromEntries(definition.columns.map((key) => [key, row[key] as string | number | boolean | null]))), totalRows: filtered.length, capped: inputRows.length === MAX_ROWS };
}

export function registerReportDesigner(app: FastifyInstance, context: ModuleServerContext) {
  const { pool, isDatabaseReady, resolveDepartmentId, validateMutation } = context;
  const canViewReports = (request: FastifyRequest) => request.activeDepartmentRole === "site_admin" || (request.activeDepartmentModulePermissions?.reports ?? []).some((grant) => grant === "view" || grant === "manage");
  async function scope(request: FastifyRequest, reply: FastifyReply) {
    if (!pool || !isDatabaseReady()) { reply.code(503).send({ error: "Reports are unavailable because the database is not ready." }); return null; }
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return null;
    if (!canViewReports(request)) { reply.code(403).send({ error: "Reports view access is required." }); return null; }
    return departmentId;
  }
  async function datasets(request: DesignerAccess, departmentId: string, database: Pool | PoolClient = pool!): Promise<DataSet[]> {
    const presence = await database.query<{ finance: boolean; people: boolean; memberships: boolean; resources: boolean }>(
      `SELECT to_regclass('public.finance_transactions') IS NOT NULL AS finance,
              to_regclass('public.people_record_fields') IS NOT NULL AS people,
              to_regclass('public.group_membership_custom_fields') IS NOT NULL AS memberships,
              to_regclass('public.bookable_resources') IS NOT NULL
                AND to_regclass('public.resource_bookings') IS NOT NULL AS resources`,
    );
    const present = presence.rows[0];
    const canManageFields = canManagePeopleFields(request);
    const customFields = permitted(request, "people") && present?.people
      ? await database.query<{ id: string; label: string; field_type: string }>(
        `SELECT field.id::text,field.label,field.field_type FROM people_record_fields field
          WHERE field.department_id=$1 AND field.active AND ($2::boolean OR COALESCE(to_jsonb(field)->>'visibility','private_people')='private_people')
          ORDER BY field.position,field.label LIMIT 40`, [departmentId, canManageFields],
      )
      : { rows: [] };
    const membershipCustomKeys = permitted(request, "people") && present?.memberships
      ? await database.query<{ key: string }>(
        "SELECT DISTINCT jsonb_object_keys(custom_fields) AS key FROM group_membership_custom_fields WHERE department_id=$1 ORDER BY key LIMIT 40", [departmentId],
      )
      : { rows: [] };
    const definitions = datasetDefinitions.map((item) => {
      if (item.key === "memberships" && membershipCustomKeys.rows.length) {
        const additions = membershipCustomKeys.rows.map(({ key }) => ({ key: `memberCustom_${createHash("sha256").update(key).digest("hex").slice(0, 16)}`, label: `Membership custom: ${key.slice(0, 100)}`, type: "text" as const }));
        const expressions = membershipCustomKeys.rows.map(({ key }, index) => {
          const safeKey = key.replace(/'/g, "''");
          return `(SELECT custom_fields->>'${safeKey}' FROM group_membership_custom_fields custom WHERE custom.group_id=m.group_id AND custom.contact_id=m.contact_id AND custom.department_id=g.department_id) AS "${additions[index]!.key}"`;
        });
        return { ...item, fields: [...item.fields, ...additions], sql: item.sql.replace(" FROM group_members m", `,${expressions.join(",")} FROM group_members m`) };
      }
      if (item.key !== "people" || !customFields.rows.length) return item;
      const fields = customFields.rows.filter((field) => /^[0-9a-f-]{36}$/i.test(field.id));
      const additions = fields.map((field) => ({ key: `custom_${field.id.replace(/-/g, "")}`, label: `Custom: ${field.label}`, type: field.field_type === "date" ? "date" as const : "text" as const }));
      if (!additions.length) return item;
      const fieldVisibility = canManageFields ? "TRUE" : "COALESCE(to_jsonb(field)->>'visibility','private_people')='private_people'";
      const expressions = fields.map((field) => `(SELECT record.value #>> '{}' FROM people_record_values record
        JOIN people_record_fields field ON field.id=record.field_id AND field.department_id=record.department_id
        WHERE record.department_id=c.department_id AND record.contact_id=c.id AND record.field_id='${field.id}'::uuid AND field.active AND ${fieldVisibility}) AS "custom_${field.id.replace(/-/g, "")}"`);
      return { ...item, fields: [...item.fields, ...additions], sql: item.sql.replace(" FROM contacts", `,${expressions.join(",")} FROM contacts`) };
    });
    return definitions.filter((item) => permitted(request, item.permission)
      && (item.key !== "finance" || present?.finance)
      && (item.key !== "resourceBookings" || present?.resources)
      && (item.key !== "memberships" || permitted(request, "people")));
  }
  async function runSavedDesign(access: DesignerAccess, departmentId: string, input: Record<string, unknown>, database: PoolClient) {
    const dataset = (await datasets(access, departmentId, database)).find((item) => item.key === input?.dataset);
    if (!dataset) return null;
    const definition = cleanDefinition(input, dataset.fields);
    if (typeof definition === "string") return null;
    const raw = await database.query<Record<string, unknown>>(dataset.sql, [departmentId]);
    return { dataset: dataset.key, title: `${dataset.title} report`, generatedAt: new Date().toISOString(), ...applyDefinition(raw.rows, definition, dataset, MAX_ROWS) };
  }
  app.get("/api/modules/reports/designer/catalog", async (request, reply) => {
    const departmentId = await scope(request, reply); if (!departmentId) return reply;
    return (await datasets(request, departmentId)).map(({ key, title, description, fields }) => ({ key, title, description, fields }));
  });
  app.post<{ Body: { definition: unknown }; Querystring: ExportFormatQuery }>("/api/modules/reports/designer/preview", { schema: { querystring: exportFormatQuery, body: { type: "object", additionalProperties: false, required: ["definition"], properties: { definition: { type: "object", additionalProperties: true } } } } }, async (request, reply) => {
    const departmentId = await scope(request, reply); if (!departmentId) return reply;
    if (!validateMutation(request, reply)) return reply;
    const available = await datasets(request, departmentId);
    const input = request.body.definition as Record<string, unknown>;
    const dataset = available.find((item) => item.key === input?.dataset);
    if (!dataset) return reply.code(403).send({ error: "That dataset is unavailable for your permissions." });
    const definition = cleanDefinition(input, dataset.fields);
    if (typeof definition === "string") return reply.code(400).send({ error: definition });
    try {
      const raw = await pool!.query(dataset.sql, [departmentId]);
      const result = applyDefinition(raw.rows as Array<Record<string, unknown>>, definition, dataset);
      const report = { dataset: dataset.key, title: `${dataset.title} report`, generatedAt: new Date().toISOString(), ...result };
      return request.query.format === "xlsx" ? sendReportWorkbook(reply, report, "ad-hoc-" + dataset.key) : report;
    } catch (error) {
      if (error instanceof PivotWidthError) return reply.code(400).send({ error: error.message });
      return reply.code(503).send({ error: "The report could not be generated from the available data." });
    }
  });
  app.get("/api/modules/reports/designer/saved", async (request, reply) => {
    const departmentId = await scope(request, reply); if (!departmentId) return reply;
    const byDataset = new Map((await datasets(request, departmentId)).map((item) => [item.key, item]));
    const result = await pool!.query<{ definition: Record<string, unknown> }>("SELECT id,name,definition,share_scope AS \"shareScope\",owner_user_id=$2 AS \"canEdit\",created_at AS \"createdAt\",updated_at AS \"updatedAt\", CASE WHEN owner_user_id=$2 THEN schedule_days END AS \"scheduleDays\", CASE WHEN owner_user_id=$2 THEN notify_when_ready END AS \"notifyWhenReady\", CASE WHEN owner_user_id=$2 THEN next_run_at END AS \"nextRunAt\", CASE WHEN owner_user_id=$2 THEN last_run_at END AS \"lastRunAt\", CASE WHEN owner_user_id=$2 THEN last_run_status END AS \"lastRunStatus\", CASE WHEN owner_user_id=$2 THEN run_history END AS \"runHistory\" FROM saved_designer_reports WHERE department_id=$1 AND (owner_user_id=$2 OR share_scope='department') AND definition->>'dataset'=ANY($3::text[]) ORDER BY lower(name),id", [departmentId, request.authenticatedUser!.id, [...byDataset.keys()]]);
    return result.rows.filter(({ definition }) => {
      const dataset = byDataset.get(definition.dataset as DatasetKey);
      return dataset && typeof cleanDefinition(definition, dataset.fields) !== "string";
    });
  });
  app.post<{ Body: { name: string; definition: unknown; shareScope?: "private" | "department" } }>("/api/modules/reports/designer/saved", { schema: { body: { type: "object", additionalProperties: false, required: ["name", "definition"], properties: { name: { type: "string", minLength: 1, maxLength: 120 }, definition: { type: "object", additionalProperties: true }, shareScope: { type: "string", enum: ["private", "department"] } } } } }, async (request, reply) => {
    const departmentId = await scope(request, reply); if (!departmentId) return reply;
    if (!validateMutation(request, reply)) return reply;
    const available = await datasets(request, departmentId);
    const input = request.body.definition as Record<string, unknown>;
    const dataset = available.find((item) => item.key === input?.dataset);
    if (!dataset) return reply.code(403).send({ error: "That dataset is unavailable for your permissions." });
    const definition = cleanDefinition(input, dataset.fields);
    if (typeof definition === "string") return reply.code(400).send({ error: definition });
    const name = typeof request.body.name === "string" ? request.body.name.trim().replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 120) : "";
    if (!name) return reply.code(400).send({ error: "Enter a name for this report." });
    try {
      const result = await pool!.query("INSERT INTO saved_designer_reports(id,department_id,owner_user_id,name,definition,share_scope) VALUES($1,$2,$3,$4,$5::jsonb,$6) RETURNING id,name,definition,share_scope AS \"shareScope\",owner_user_id=$3 AS \"canEdit\",created_at AS \"createdAt\",updated_at AS \"updatedAt\"", [randomUUID(), departmentId, request.authenticatedUser!.id, name, JSON.stringify(definition), request.body.shareScope ?? "private"]);
      return reply.code(201).send(result.rows[0]);
    } catch { return reply.code(409).send({ error: "A personal report with that name already exists." }); }
  });
  app.put<{ Params: { id: string }; Body: { name: string; definition: unknown; shareScope?: "private" | "department" } }>("/api/modules/reports/designer/saved/:id", { schema: { params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: uuid } }, body: { type: "object", additionalProperties: false, required: ["name", "definition"], properties: { name: { type: "string", minLength: 1, maxLength: 120 }, definition: { type: "object", additionalProperties: true }, shareScope: { type: "string", enum: ["private", "department"] } } } } }, async (request, reply) => {
    const departmentId = await scope(request, reply); if (!departmentId) return reply;
    if (!validateMutation(request, reply)) return reply;
    const available = await datasets(request, departmentId);
    const input = request.body.definition as Record<string, unknown>;
    const dataset = available.find((item) => item.key === input?.dataset);
    if (!dataset) return reply.code(403).send({ error: "That dataset is unavailable for your permissions." });
    const definition = cleanDefinition(input, dataset.fields);
    if (typeof definition === "string") return reply.code(400).send({ error: definition });
    const name = request.body.name.trim().replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 120);
    if (!name) return reply.code(400).send({ error: "Enter a name for this report." });
    try {
      const result = await pool!.query("UPDATE saved_designer_reports SET name=$4,definition=$5::jsonb,share_scope=COALESCE($6,share_scope),updated_at=now(), scheduled_result=NULL, last_run_status=NULL, last_run_at=NULL, next_run_at=CASE WHEN schedule_days IS NOT NULL THEN now() END WHERE id=$1 AND department_id=$2 AND owner_user_id=$3 RETURNING id,name,definition,share_scope AS \"shareScope\",owner_user_id=$3 AS \"canEdit\",created_at AS \"createdAt\",updated_at AS \"updatedAt\"", [request.params.id, departmentId, request.authenticatedUser!.id, name, JSON.stringify(definition), request.body.shareScope ?? null]);
      if (!result.rowCount) return reply.code(404).send({ error: "Personal report not found." });
      return result.rows[0];
    } catch { return reply.code(409).send({ error: "A personal report with that name already exists." }); }
  });
  app.put<{ Params: { id: string }; Body: { shareScope: "private" | "department" } }>("/api/modules/reports/designer/saved/:id/sharing", { schema: { params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: uuid } }, body: { type: "object", additionalProperties: false, required: ["shareScope"], properties: { shareScope: { type: "string", enum: ["private", "department"] } } } } }, async (request, reply) => {
    const departmentId = await scope(request, reply); if (!departmentId) return reply;
    if (!validateMutation(request, reply)) return reply;
    const result = await pool!.query("UPDATE saved_designer_reports SET share_scope=$4,updated_at=now() WHERE id=$1 AND department_id=$2 AND owner_user_id=$3 RETURNING id,share_scope AS \"shareScope\"", [request.params.id, departmentId, request.authenticatedUser!.id, request.body.shareScope]);
    if (!result.rowCount) return reply.code(404).send({ error: "Personal report not found." });
    return result.rows[0];
  });
  app.delete<{ Params: { id: string } }>("/api/modules/reports/designer/saved/:id", { schema: { params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: uuid } } } }, async (request, reply) => {
    const departmentId = await scope(request, reply); if (!departmentId) return reply;
    if (!validateMutation(request, reply)) return reply;
    const result = await pool!.query("DELETE FROM saved_designer_reports WHERE id=$1 AND department_id=$2 AND owner_user_id=$3 RETURNING id", [request.params.id, departmentId, request.authenticatedUser!.id]);
    if (!result.rowCount) return reply.code(404).send({ error: "Personal report not found." });
    return { deleted: true };
  });
  const savedIdSchema = { type: "object", additionalProperties: false, required: ["id"], properties: { id: uuid } } as const;
  const schedulePath = "/api/modules/reports/designer/saved/:id";
  app.put<{ Params: { id: string }; Body: { days: 1 | 7 | null; notifyWhenReady?: boolean; runNow?: boolean } }>(`${schedulePath}/schedule`, {
    schema: { params: savedIdSchema, body: { type: "object", additionalProperties: false, required: ["days"], properties: { days: { enum: [1, 7, null] }, notifyWhenReady: { type: "boolean" }, runNow: { type: "boolean" } } } },
  }, async (request, reply) => {
    const departmentId = await scope(request, reply); if (!departmentId) return reply;
    if (!validateMutation(request, reply)) return reply;
    if (request.activeDepartmentRole !== "site_admin" && !request.activeDepartmentModulePermissions?.reports?.includes("manage")) {
      return reply.code(403).send({ error: "Reports management access is required." });
    }
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      if (!await context.lockDepartmentForWrite(client, departmentId)) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "This location is read-only on this installation." });
      }
      const keys = (await datasets(request, departmentId, client)).map(({ key }) => key);
      const updated = await client.query(
        `UPDATE saved_designer_reports SET schedule_days=$4, notify_when_ready=COALESCE($6,notify_when_ready), next_run_at=CASE WHEN $4::int IS NULL THEN NULL WHEN $7::boolean THEN now() WHEN $4=schedule_days THEN next_run_at ELSE now() END,
          scheduled_result=CASE WHEN $4=schedule_days THEN scheduled_result END, last_run_at=CASE WHEN $4=schedule_days THEN last_run_at END, last_run_status=CASE WHEN $4=schedule_days THEN last_run_status END
         WHERE id=$1 AND department_id=$2 AND owner_user_id=$3 AND (NOT $7::boolean OR ($4::int IS NOT NULL AND schedule_days=$4 AND $6::boolean IS NULL)) AND definition->>'dataset'=ANY($5::text[])`,
        [request.params.id, departmentId, request.authenticatedUser!.id, request.body.days, keys, request.body.notifyWhenReady ?? null, request.body.runNow ?? false],
      );
      await client.query("COMMIT");
      if (!updated.rowCount) return reply.code(404).send({ error: "Personal report not found." });
      return { scheduled: request.body.days !== null };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
  app.get<{ Params: { id: string }; Querystring: ExportFormatQuery }>(`${schedulePath}/scheduled-result`, { schema: { querystring: exportFormatQuery, params: savedIdSchema } }, async (request, reply) => {
    const departmentId = await scope(request, reply); if (!departmentId) return reply;
    const available = await datasets(request, departmentId);
    const query = await pool!.query<{ definition: Record<string, unknown>; scheduled_result: Awaited<ReturnType<typeof runSavedDesign>> | null }>(
      "SELECT definition,scheduled_result FROM saved_designer_reports WHERE id=$1 AND department_id=$2 AND owner_user_id=$3",
      [request.params.id, departmentId, request.authenticatedUser!.id],
    );
    const saved = query.rows[0];
    const dataset = available.find(({ key }) => key === saved?.definition?.dataset);
    const definition = dataset && saved ? cleanDefinition(saved.definition, dataset.fields) : null;
    if (!saved?.scheduled_result || !dataset || !definition || typeof definition === "string") {
      return reply.code(404).send({ error: "No scheduled result is available." });
    }
    if (request.query.format === "xlsx") return sendReportWorkbook(reply, saved.scheduled_result, "ad-hoc-" + dataset.key);
    const report = definition.groupBy ? { ...saved.scheduled_result, chartType: definition.chartType ?? "table", chartCategoryKeys: axisKeys(definition.groupBy) } : saved.scheduled_result;
    return reply.header("cache-control", "private, no-store").send(report);
  });
  return { runSavedDesign };
}
