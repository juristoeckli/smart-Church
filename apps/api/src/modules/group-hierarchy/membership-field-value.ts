export const membershipFieldTypes = ["text", "number", "boolean", "date", "select"] as const;
export type MembershipFieldType = typeof membershipFieldTypes[number];
export type MembershipFieldValue = string | number | boolean;

export function normalizeMembershipFieldValue(field: { type: MembershipFieldType; options: string[] }, value: unknown) {
  if (value === null) return null;
  if (field.type === "boolean") return typeof value === "boolean" ? value : undefined;
  if (field.type === "number") return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || value.includes("\u0000")) return undefined;
  const text = value.trim();
  if (field.type === "text") return text.length <= 500 ? text || null : undefined;
  if (field.type === "select") return field.options.includes(text) ? text : undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || text.startsWith("0000-")) return undefined;
  const date = new Date(text + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : undefined;
}
