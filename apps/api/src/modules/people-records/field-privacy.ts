import type { FastifyRequest } from "fastify";

export const customFieldVisibilities = ["private_people", "people_managers"] as const;
export type CustomFieldVisibility = typeof customFieldVisibilities[number];

export function canManagePeopleFields(request: Pick<FastifyRequest, "activeDepartmentRole" | "activeDepartmentPermissions">) {
  return request.activeDepartmentRole === "site_admin" || (request.activeDepartmentPermissions ?? []).includes("people_manage");
}
