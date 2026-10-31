import type { ServerPermission } from "@smart-church/contracts";
import { getActiveLanguage } from "./i18n";
import { ModuleTranslationHost } from "./module-registry";
import { translationsForModule } from "./modules/translations";

const permissions: Array<{ value: ServerPermission; label: string; description: string }> = [
  { value: "server_view", label: "View system diagnostics", description: "Read installation-wide server status and sanitized logs. This permission cannot restart workers or change settings." },
  { value: "server_troubleshoot", label: "Troubleshoot workers", description: "Restart supervised workers and inspect recovery state." },
  { value: "server_manage", label: "Manage installation", description: "Manage accounts, locations, modules, branding, email, and web settings." },
  { value: "server_api", label: "Use the API", description: "Generate and manage a personal API key for API access." },
];

export function ServerPermissionsFieldset({ permissions: selected, onChange, apiRequired = false }: { permissions: ServerPermission[]; onChange: (permissions: ServerPermission[]) => void; apiRequired?: boolean }) {
  return <ModuleTranslationHost translations={translationsForModule("core-admin")} language={getActiveLanguage()}><fieldset className="module-rights-fieldset"><legend>Installation permissions</legend>{permissions.filter(({ value }) => !(apiRequired && value === "server_api")).map(({ value, label, description }) => <label className="module-right-option" key={value}><input type="checkbox" checked={selected.includes(value)} onChange={(event) => onChange(event.target.checked ? [...new Set([...selected, value])] : selected.filter((permission) => permission !== value))} /><span><strong>{label}</strong><small>{description}</small></span></label>)}{apiRequired && <div className="module-right-option module-right-option-required"><input type="checkbox" checked disabled aria-label="API access required for service accounts" /><span><strong>API access · required</strong><small>Service accounts always use API keys. This access cannot be disabled.</small></span></div>}</fieldset></ModuleTranslationHost>;
}
