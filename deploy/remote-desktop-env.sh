#!/usr/bin/env bash

# Move settings from the previous module name without exposing secret values.
migrate_remote_desktop_env() {
  local env_file="${1:-.env}" tmp
  [[ -f "$env_file" ]] || return 0
  tmp="$(mktemp "${env_file}.XXXXXX")"
  awk '
    BEGIN {
      count = split("SYSTEM_LAPTOP_JSON_SECRET_KEY REMOTE_DESKTOP_JSON_SECRET_KEY SYSTEM_LAPTOP_RDP_HOST REMOTE_DESKTOP_RDP_HOST SYSTEM_LAPTOP_RDP_PORT REMOTE_DESKTOP_RDP_PORT SYSTEM_LAPTOP_RDP_USERNAME REMOTE_DESKTOP_RDP_USERNAME SYSTEM_LAPTOP_RDP_PASSWORD REMOTE_DESKTOP_RDP_PASSWORD SYSTEM_LAPTOP_GUACAMOLE_API_URL REMOTE_DESKTOP_GUACAMOLE_API_URL SYSTEM_LAPTOP_GUACD_IMAGE REMOTE_DESKTOP_GUACD_IMAGE SYSTEM_LAPTOP_GUACD_LOG_LEVEL REMOTE_DESKTOP_GUACD_LOG_LEVEL SMART_CHURCH_USE_SYSTEM_LAPTOP SMART_CHURCH_USE_REMOTE_DESKTOP", pairs, " ")
      for (i = 1; i <= count; i += 2) { old = pairs[i]; new = pairs[i + 1]; old_to_new[old] = new; new_to_old[new] = old }
    }
    {
      separator = index($0, "=")
      key = separator ? substr($0, 1, separator - 1) : ""
      if (key in old_to_new) {
        if (!(old_to_new[key] in seen_new)) migrated[old_to_new[key]] = substr($0, separator + 1)
        next
      }
      if (key in new_to_old) seen_new[key] = 1
      lines[++line_count] = $0
    }
    END {
      for (i = 1; i <= line_count; i++) print lines[i]
      for (i = 1; i <= count; i += 2) { key = pairs[i + 1]; if (key in migrated && !(key in seen_new)) print key "=" migrated[key] }
    }
  ' "$env_file" > "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$env_file"
}
