export const postalAddressFields = [
  { key: "street", label: "Street and house number", limit: 160, autoComplete: "address-line1" },
  { key: "additionalLine", label: "Additional address line", limit: 160, autoComplete: "address-line2" },
  { key: "city", label: "City", limit: 100, autoComplete: "address-level2" },
  { key: "region", label: "State or region", limit: 100, autoComplete: "address-level1" },
  { key: "postalCode", label: "Postal code", limit: 24, autoComplete: "postal-code" },
  { key: "country", label: "Country", limit: 100, autoComplete: "country-name" },
] as const;

export type PostalAddress = Partial<Record<(typeof postalAddressFields)[number]["key"], string>>;
