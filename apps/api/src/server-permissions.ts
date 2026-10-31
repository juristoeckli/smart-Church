import type { ServerPermission } from "@smart-church/contracts";

export const allServerPermissions: ServerPermission[] = ["server_view", "server_troubleshoot", "server_manage", "server_api"];

export function serverPermissionsForUser(role: string, permissions: ServerPermission[] | null | undefined): ServerPermission[] {
  return role === "server_admin" ? [...allServerPermissions] : permissions ?? [];
}

export function hasServerPermission(role: string | undefined, permissions: ServerPermission[] | undefined, required: ServerPermission) {
  return role === "server_admin" || Boolean(permissions?.includes(required));
}
