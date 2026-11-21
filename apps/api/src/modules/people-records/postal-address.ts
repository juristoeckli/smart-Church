export const postalAddressLimits = { street: 160, additionalLine: 160, city: 100, region: 100, postalCode: 24, country: 100 } as const;
export type PostalAddress = Partial<Record<keyof typeof postalAddressLimits, string>>;

export const postalAddressSchema = {
  type: "object",
  additionalProperties: false,
  properties: Object.fromEntries(Object.entries(postalAddressLimits).map(([key, maxLength]) =>
    [key, { type: "string", maxLength, pattern: "^[^\\u0000\\r\\n]*$" }],
  )),
};

export function normalizePostalAddress(address: PostalAddress | null | undefined): PostalAddress {
  const result: PostalAddress = {};
  for (const key of Object.keys(postalAddressLimits) as Array<keyof PostalAddress>) {
    const value = address?.[key];
    if (typeof value === "string" && value.trim()) result[key] = value.trim();
  }
  return result;
}
