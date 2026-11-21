import { appointmentWallTime, canonicalTimeZone, resolveAppointmentWallTime } from "../../calendar-time.js";
import { cleanLocalDateTime } from "../../calendar-occurrences.js";

export type SignupPolicyDraft = { opensAt: string | null; closesAt: string | null; defaultRole: string; heading: string; activeSeatLimit?: number | null; waitlistLimit?: number | null; countedRoles?: string[]; connectedAdmission?: boolean };
export const defaultSignupPolicy: SignupPolicyDraft = { opensAt: null, closesAt: null, defaultRole: "Member", heading: "", activeSeatLimit: null, waitlistLimit: null, countedRoles: [], connectedAdmission: false };
export const signupPolicySchema = {
  type: "object", additionalProperties: false, required: ["opensAt", "closesAt", "defaultRole", "heading"], properties: {
    opensAt: { type: ["string", "null"], maxLength: 19 },
    closesAt: { type: ["string", "null"], maxLength: 19 },
    defaultRole: { type: "string", minLength: 1, maxLength: 80 },
    heading: { type: "string", maxLength: 120 },
    activeSeatLimit: { type: ["integer", "null"], minimum: 1, maximum: 100000 },
    waitlistLimit: { type: ["integer", "null"], minimum: 0, maximum: 100000 },
    connectedAdmission: { type: "boolean" },
    countedRoles: { type: "array", maxItems: 40, items: { type: "string", minLength: 1, maxLength: 80 } },
  },
} as const;

function toInstant(local: string | null, timeZone: string) {
  if (local === null) return null;
  const wall = cleanLocalDateTime(local);
  const resolved = wall ? resolveAppointmentWallTime(wall, timeZone) : null;
  return resolved && !resolved.shifted ? new Date(resolved.instant).toISOString() : false;
}

export function normalizeSignupPolicy(draft: SignupPolicyDraft, locationZone: string | null) {
  const timeZone = canonicalTimeZone(locationZone) ?? "UTC";
  const opensAt = toInstant(draft.opensAt, timeZone);
  const closesAt = toInstant(draft.closesAt, timeZone);
  if (opensAt === false || closesAt === false) return "Choose valid opening and closing times in the location time zone.";
  if (opensAt && closesAt && opensAt >= closesAt) return "Signup closing time must be after opening time.";
  const defaultRole = draft.defaultRole.trim();
  if (!defaultRole) return "Enter a default membership role.";
  if (draft.connectedAdmission && defaultRole.toLowerCase() !== "member") {
    return "Immediate admission is available only with the Member role.";
  }
  const countedRoles = [...new Map((draft.countedRoles ?? []).map((label) => [label.trim().toLowerCase(), label.trim()])).values()].filter(Boolean);
  return {
    opensAt, closesAt, defaultRole, heading: draft.heading.trim(),
    activeSeatLimit: draft.activeSeatLimit ?? null, waitlistLimit: draft.waitlistLimit ?? null, countedRoles, connectedAdmission: draft.connectedAdmission ?? false,
  };
}

export function editableSignupPolicy(policy: SignupPolicyDraft, locationZone: string | null) {
  const timeZone = canonicalTimeZone(locationZone) ?? "UTC";
  const toLocal = (instant: string | null) => instant ? appointmentWallTime(Date.parse(instant), timeZone) : null;
  return { ...policy, timeZone, opensAt: toLocal(policy.opensAt), closesAt: toLocal(policy.closesAt) };
}

export function signupState(opensAt: string | Date | null, closesAt: string | Date | null, now = Date.now()): "scheduled" | "open" | "closed" {
  if (closesAt && now >= new Date(closesAt).getTime()) return "closed";
  if (opensAt && now < new Date(opensAt).getTime()) return "scheduled";
  return "open";
}
