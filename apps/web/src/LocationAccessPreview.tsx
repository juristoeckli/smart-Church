import { useEffect, useState } from "react";
import type { DepartmentProfile, LocationPermission } from "@smart-church/contracts";
import { registeredModules } from "./module-registry";

type Preview = {
  displayName: string;
  role: "site_admin" | "member";
  status: "enabled" | "disabled" | "service" | "password_required";
  permissions: Array<{ permission: LocationPermission; source: "site_role" | "direct" | "none" }>;
  canViewPrivateContactDetails: boolean;
  modulePermissions: Record<string, string[]>;
};

const statusLabels = {
  enabled: "Enabled",
  disabled: "Disabled",
  service: "API-only account",
  password_required: "Password change required before using the workspace",
};
const sourceLabels = { site_role: "Inherited from site administrator", direct: "Granted directly", none: "No grant" };

export function LocationAccessPreview({ department, members, userId, selectUser, permissionLabels }: {
  department: DepartmentProfile;
  members: readonly { id: string; displayName: string; username?: string }[];
  userId: string;
  selectUser: (id: string) => void;
  permissionLabels: Record<string, string>;
}) {
  return <section className="location-access-history location-access-preview" aria-label="Effective location access">
    <p>Review saved access for an account at {department.location}.</p>
    <label>Account<select value={userId} onChange={(event) => selectUser(event.target.value)}>
      <option value="">Choose an account</option>
      {members.map((member) => <option key={member.id} value={member.id}>{member.displayName}{member.username ? ` (@${member.username})` : ""}</option>)}
    </select></label>
    {userId && <AccountPreview key={userId} department={department} userId={userId} permissionLabels={permissionLabels} />}
  </section>;
}

function AccountPreview({ department, userId, permissionLabels }: {
  department: DepartmentProfile;
  userId: string;
  permissionLabels: Record<string, string>;
}) {
  const [preview, setPreview] = useState<Preview>();
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setPreview(undefined);
    setError("");
    void fetch(`/api/location-access/${encodeURIComponent(userId)}/preview`, {
      headers: { "x-department-id": department.id }, signal: controller.signal,
    }).then(async (response) => {
      const result = await response.json() as Preview | { error: string };
      if (!response.ok || "error" in result) throw new Error("error" in result ? result.error : "Could not load effective access.");
      if (!controller.signal.aborted) setPreview(result);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load effective access.");
    });
    return () => controller.abort();
  }, [department.id, userId, refresh]);

  const catalog = new Map(registeredModules.map((module) => [module.id, module]));
  const storedModuleIds = Object.keys(preview?.modulePermissions ?? {}).filter((id) => preview?.modulePermissions[id]?.length);
  const moduleIds = [...new Set([
    ...registeredModules.filter((module) => module.accessLevels?.length).map((module) => module.id),
    ...storedModuleIds,
  ])];

  return <>
    <div><button type="button" className="button button-secondary" onClick={() => setRefresh((value) => value + 1)}>Refresh access</button></div>
    {error && <p role="alert">{error}</p>}
    {!preview && !error && <p role="status">Checking saved access…</p>}
    {preview && <>
      <h3>{preview.displayName}</h3>
      <p>{preview.role === "site_admin" ? "Site administrator" : "Member"} · {statusLabels[preview.status]}</p>
      <div className="location-access-history-scroll"><table className="location-access-history-table">
        <caption>Location permissions</caption>
        <thead><tr><th scope="col">Permission</th><th scope="col">Source</th></tr></thead>
        <tbody>{preview.permissions.map(({ permission, source }) => <tr key={permission}>
          <th scope="row">{permissionLabels[permission] ?? permission}</th>
          <td>{permission === "people_view_private" && source === "none" && preview.canViewPrivateContactDetails ? "Included with Manage people" : sourceLabels[source]}</td>
        </tr>)}</tbody>
      </table></div>
      {moduleIds.length > 0 && <div className="location-access-history-scroll"><table className="location-access-history-table">
        <caption>Module grants</caption>
        <thead><tr><th scope="col">Module</th><th scope="col">Saved access</th></tr></thead>
        <tbody>{moduleIds.map((id) => {
          const module = catalog.get(id);
          const active = Boolean(module && department.enabledModules?.includes(id));
          const grants = (preview.modulePermissions[id] ?? []).map((value) => module?.accessLevels?.find((level) => level.value === value)?.label ?? value);
          return <tr key={id}><th scope="row">{module?.name ?? id}</th><td>{active && preview.role === "site_admin" ? sourceLabels.site_role : <>
            {grants.length ? grants.join(", ") : sourceLabels.none}{!active && " · Module unavailable"}
          </>}</td></tr>;
        })}</tbody>
      </table></div>}
    </>}
  </>;
}
