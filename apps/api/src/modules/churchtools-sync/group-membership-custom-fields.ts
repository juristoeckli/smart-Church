type SourceObject = Record<string, unknown>;
const object = (value: unknown): SourceObject | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as SourceObject : undefined;
const fieldId = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : null;
const numericOption = (value: unknown): value is string => typeof value === "string" && /^\d{1,16}$/.test(value);
const supportedTypes = ["checkbox", "date", "datetime", "multiselect", "number", "radioselect", "select", "text", "textarea"] as const;
type FieldType = typeof supportedTypes[number];
const credentialField = /password|passphrase|access[ _-]*token|refresh[ _-]*token|login[ _-]*token|api[ _-]*key|private[ _-]*key|secret|credential/i;

type Definition = {
  sourceId: string;
  name: string;
  referenceName: string;
  fieldType: FieldType;
  securityLevel: number;
  options: Map<string, string>;
};
export type ChurchToolsMembershipCustomValue = Omit<Definition, "options"> & {
  value: string | null | string[];
  selectedOptions?: Array<{ sourceId: string; name: string }>;
};

export function readChurchToolsMembershipFieldDefinitions(payload: unknown, groupSourceId: string) {
  const result = object(payload);
  if (!Array.isArray(result?.data) || object(result.meta)?.count !== result.data.length) throw new Error("ChurchTools returned an incomplete group membership field list.");
  const definitions = new Map<string, Definition>();
  for (const entry of result.data) {
    const item = object(entry);
    if (item?.type !== "group") continue;
    const field = object(item.field);
    const sourceId = fieldId(field?.id);
    const groupId = fieldId(field?.groupId);
    const name = typeof field?.name === "string" ? field.name.trim() : "";
    const referenceName = typeof field?.referenceName === "string" ? field.referenceName : "";
    const fieldType = field?.fieldTypeCode;
    const securityLevel = field?.securityLevel;
    if (groupId !== groupSourceId || !sourceId || !name || name.length > 100 || !/^[a-z0-9_-]{1,64}$/.test(referenceName)
      || typeof securityLevel !== "number" || !Number.isSafeInteger(securityLevel) || securityLevel < 0
      || !supportedTypes.includes(fieldType as FieldType) || credentialField.test(name) || credentialField.test(referenceName)) continue;
    if (definitions.has(sourceId)) throw new Error("ChurchTools returned duplicate group membership field definitions.");
    const options = new Map<string, string>();
    for (const choice of Array.isArray(field?.options) ? field.options : []) {
      const option = object(choice);
      if (numericOption(option?.id) && typeof option?.name === "string" && option.name.trim() && option.name.length <= 500) options.set(option.id, option.name);
    }
    definitions.set(sourceId, { sourceId, name, referenceName, fieldType: fieldType as FieldType, securityLevel, options });
  }
  return definitions;
}

export function normalizeVisibleChurchToolsMembershipFields(entries: unknown, definitions: ReadonlyMap<string, Definition>): ChurchToolsMembershipCustomValue[] {
  if (!Array.isArray(entries)) return [];
  const fields: ChurchToolsMembershipCustomValue[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const field = object(entry);
    const sourceId = fieldId(field?.id);
    const definition = sourceId ? definitions.get(sourceId) : undefined;
    if (!definition) continue;
    if (seen.has(definition.sourceId)) throw new Error("ChurchTools repeated an imported custom field value.");
    seen.add(definition.sourceId);
    const { options, ...metadata } = definition;
    const value = field?.value;
    if (value === null) {
      fields.push({ ...metadata, value });
    } else if (definition.fieldType === "multiselect") {
      if (Array.isArray(value) && value.length <= 200 && value.every(numericOption)) {
        fields.push({ ...metadata, value, selectedOptions: value.map((id) => ({ sourceId: id, name: options.get(id) ?? id })) });
      }
    } else if (typeof value === "string" && value.length <= 4000) {
      if (definition.fieldType === "checkbox" && value !== "0" && value !== "1") continue;
      if (definition.fieldType === "select" || definition.fieldType === "radioselect") {
        if (!numericOption(value)) continue;
        fields.push({ ...metadata, value, selectedOptions: [{ sourceId: value, name: options.get(value) ?? value }] });
      } else fields.push({ ...metadata, value });
    }
  }
  return fields;
}
