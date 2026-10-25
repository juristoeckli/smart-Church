import type { PresenterPermission } from "@smart-church/contracts";

const permissionOptions: Array<{ value: PresenterPermission; label: string; description: string }> = [
  { value: "editor", label: "Editor", description: "Edit slides; intended for users outside the technical team." },
  { value: "operator", label: "Operator", description: "Edit slides and present them." },
  { value: "admin", label: "Admin", description: "Edit and present, and change layouts." },
];

export function hasPresenterAccess(enabled: boolean, isSiteAdmin: boolean, permissions: PresenterPermission[]) {
  return enabled && (isSiteAdmin || permissions.length > 0);
}

export function presenterCapabilities(isSiteAdmin: boolean, permissions: PresenterPermission[]) {
  const grants = new Set(permissions);
  return {
    canEdit: isSiteAdmin || grants.has("editor") || grants.has("operator") || grants.has("admin"),
    canPresent: isSiteAdmin || grants.has("operator") || grants.has("admin"),
    canManageLayouts: isSiteAdmin || grants.has("admin"),
  };
}

export function PresenterRightsFieldset({ permissions, onChange, isSiteAdmin }: {
  permissions: PresenterPermission[];
  onChange: (permissions: PresenterPermission[]) => void;
  isSiteAdmin: boolean;
}) {
  return <fieldset className="module-rights-fieldset">
    <legend>Presenter rights</legend>
    {isSiteAdmin ? <small>Site administrators inherit all Presenter rights.</small> : permissionOptions.map(({ value, label, description }) => <label className="module-right-option" key={value}>
      <input type="checkbox" checked={permissions.includes(value)} onChange={(event) => onChange(event.target.checked ? [...new Set([...permissions, value])] : permissions.filter((item) => item !== value))} />
      <span><strong>{label}</strong><small>{description}</small></span>
    </label>)}
  </fieldset>;
}
