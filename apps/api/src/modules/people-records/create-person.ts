import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import type { CreateContact } from "@smart-church/contracts";
import { cleanContactInput, contactInputProperties } from "../../contact-input.js";
import type { ModuleServerContext } from "../module-sdk.js";
import { withChoiceDefinitionWrite } from "./choice-rename.js";
import { normalizePostalAddress, postalAddressSchema, type PostalAddress } from "./postal-address.js";

import { normalizePeopleLocalDateTime } from "./local-datetime.js";
import { normalizeMultilineField } from "./multiline-field.js";
import { validPeopleNumber } from "./number-field.js";

import { validPeopleChoices } from "./multiselect-field.js";

type FieldValue = string | boolean | number | string[];
type NewPerson = CreateContact & { postalAddress?: PostalAddress; fields?: Record<string, unknown> };
type CreationField = { id: string; field_key: string; field_type: string; label: string; required: boolean; options: unknown; text_max_length: number | null };
type DepartmentResolver = (request: FastifyRequest, reply: FastifyReply, write?: boolean) => Promise<string | null>;
type WriteHistory = (
  departmentId: string, contactId: string, request: FastifyRequest, action: string,
  subject: string, before: unknown, after: unknown, client: PoolClient,
) => Promise<void>;
function validValue(field: CreationField, value: unknown): value is FieldValue {
  if (field.field_type === "multiselect") return validPeopleChoices(value, field.options);
  if (field.field_type === "number") return validPeopleNumber(value, field.text_max_length ?? undefined);
  if (field.field_type === "boolean") return typeof value === "boolean";
  if (typeof value !== "string" || !value.trim()) return false;
  if (field.field_type === "text" || field.field_type === "multiline") return value.length <= (field.text_max_length ?? 2000);
  if (field.field_type === "select") return Array.isArray(field.options) && field.options.includes(value);
  if (field.field_type === "datetime") return normalizePeopleLocalDateTime(value) !== null;
  if (field.field_type !== "date" || !/^(?!0000-)\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00Z");
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function registerPersonCreation(routes: FastifyInstance, context: ModuleServerContext, department: DepartmentResolver, writeHistory: WriteHistory) {
  routes.post<{ Body: NewPerson }>("/api/people-records/people", {
    schema: { body: { type: "object", additionalProperties: false, required: ["firstName", "lastName", "status"], properties: {
      ...contactInputProperties,
      postalAddress: postalAddressSchema,
      fields: {
        type: "object",
        propertyNames: { type: "string", format: "uuid" },
        additionalProperties: true,
      },
    } } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply, true);
    if (!departmentId || !context.validateMutation(request, reply)) return reply;
    const input = cleanContactInput(request.body);
    if (!input.firstName || !input.lastName) return reply.code(400).send({ error: "First and last name are required." });
    const provided = request.body.fields ?? {};
    const postalAddress = normalizePostalAddress(request.body.postalAddress);

    const created = await withChoiceDefinitionWrite(context.pool!, departmentId, async (client) => {
      if (!await context.lockDepartmentForWrite(client, departmentId)) {
        return { status: 409, error: "This location cannot be changed on this installation." } as const;
      }
      const { rows: fields } = await client.query<CreationField>(
        `SELECT id,field_key,field_type,label,required,options,text_max_length FROM people_record_fields
          WHERE department_id=$1 AND active AND show_on_create ORDER BY position,label,id FOR SHARE`, [departmentId],
      );
      const available = new Set(fields.map((field) => field.id));
      if (Object.keys(provided).some((id) => !available.has(id))) {
        return { status: 409, error: "The available fields changed. Refresh the People form and try again." } as const;
      }
      const values: { field: CreationField; value: FieldValue }[] = [];
      for (const field of fields) {
        const raw = provided[field.id];
        const value = field.field_type === "multiline" && typeof raw === "string" ? normalizeMultilineField(raw) : raw;
        if (value === undefined || value === "" || (field.field_type === "multiselect" && Array.isArray(value) && value.length === 0)) {
          if (field.required) return { status: 400, error: "Enter a value for “" + field.label + "”." } as const;
          continue;
        }
        if (!validValue(field, value)) return { status: 400, error: "Choose a valid value for “" + field.label + "”." } as const;
        values.push({ field, value: field.field_type === "datetime" ? normalizePeopleLocalDateTime(value)! : value });
      }
      const id = randomUUID();
      await client.query(
        `INSERT INTO contacts(id,department_id,first_name,last_name,email,phone,status,postal_address)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
        [id, departmentId, input.firstName, input.lastName, input.email, input.phone, input.status, JSON.stringify(postalAddress)],
      );
      await writeHistory(departmentId, id, request, "person_created", "profile", undefined, { status: input.status }, client);
      for (const { field, value } of values) {
        await client.query(
          "INSERT INTO people_record_values(department_id,contact_id,field_id,value,updated_by) VALUES($1,$2,$3,$4::jsonb,$5)",
          [departmentId, id, field.id, JSON.stringify(value), request.authenticatedUser?.id ?? null],
        );
        await writeHistory(departmentId, id, request, "field_updated", field.id, undefined, value, client);
      }
      return { person: { id, ...input, postalAddress, archivedAt: null,
        fields: Object.fromEntries(values.map(({ field, value }) => [field.field_key, value])) } };
    });
    if ("error" in created) return reply.code(created.status ?? 400).send({ error: created.error });
    context.realtime.publish("core:contacts:changed", departmentId, { contactId: created.person.id });
    context.realtime.publish("people-records:changed", departmentId, { contactId: created.person.id });
    return reply.code(201).send(created.person);
  });
}
