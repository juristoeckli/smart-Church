import type { CreateContact } from "@smart-church/contracts";

export const contactInputProperties = {
  firstName: { type: "string", minLength: 1, maxLength: 80 },
  lastName: { type: "string", minLength: 1, maxLength: 80 },
  email: { type: "string", maxLength: 254, pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$" },
  phone: { type: "string", maxLength: 40 },
  status: { type: "string", enum: ["member", "visitor"] },
} as const;

export function cleanContactInput(input: CreateContact) {
  return {
    firstName: input.firstName.trim(), lastName: input.lastName.trim(),
    email: input.email?.trim() || null, phone: input.phone?.trim() || null,
    status: input.status,
  };
}
