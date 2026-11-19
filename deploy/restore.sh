#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
compose_files=(-f compose.yaml)
if [[ -f deploy/compose.direct.yaml ]]; then compose_files+=(-f deploy/compose.direct.yaml); fi
if [[ -f deploy/compose.amx.yaml ]] && grep -q '^SMART_CHURCH_USE_AMX_MODULE=1' .env 2>/dev/null; then
  compose_files+=(-f deploy/compose.amx.yaml)
fi
if [[ -f deploy/compose.remote-desktop.yaml ]] && grep -q '^SMART_CHURCH_REMOTE_DESKTOP_MODULE_INSTALLED=1' .env 2>/dev/null; then
  compose_files+=(-f deploy/compose.remote-desktop.yaml)
fi
if [[ -f apps/api/src/modules/video-steffisburg/compose.yaml ]] && grep -q '^SMART_CHURCH_STREAMING_CONFIG_PATH=' .env 2>/dev/null; then
  compose_files+=(-f apps/api/src/modules/video-steffisburg/compose.yaml)
fi
if [[ -f apps/api/src/modules/remote-desktop/compose.yaml ]] && grep -q '^SMART_CHURCH_USE_REMOTE_DESKTOP=1' .env 2>/dev/null; then
  compose_files+=(-f apps/api/src/modules/remote-desktop/compose.yaml)
fi
compose_args=("${compose_files[@]}")
profile_args=()
if grep -q '^SMART_CHURCH_USE_BUNDLED_PROXY=1' .env 2>/dev/null; then profile_args+=(--profile bundled-proxy); fi
if grep -q '^SMART_CHURCH_USE_REMOTE_DESKTOP=1' .env 2>/dev/null; then profile_args+=(--profile remote-desktop); fi
backup_dir="${1:-}"
[[ -n "$backup_dir" && -d "$backup_dir" ]] || { echo "Usage: $0 /absolute/path/to/backup-directory" >&2; exit 1; }
backup_dir="$(cd -- "$backup_dir" && pwd)"
[[ -f "$backup_dir/database.dump" && -f "$backup_dir/storage.tar.gz" ]] || { echo "Backup must contain database.dump and storage.tar.gz." >&2; exit 1; }
[[ -f .env ]] || { echo "Missing .env; restore into a configured Smart-Church installation." >&2; exit 1; }
api_container="$(docker compose "${compose_args[@]}" "${profile_args[@]}" ps -q api)"
[[ -n "$api_container" ]] || { echo "The API container must exist before restoring." >&2; exit 1; }
volume_name="$(docker inspect "$api_container" --format '{{range .Mounts}}{{if eq .Destination "/var/lib/smart-church"}}{{.Name}}{{end}}{{end}}')"
[[ -n "$volume_name" ]] || { echo "Could not locate the Smart-Church data volume." >&2; exit 1; }

# Validate both archives before stopping the API or replacing any live data.
docker compose "${compose_args[@]}" "${profile_args[@]}" exec -T db pg_restore --list < "$backup_dir/database.dump" >/dev/null
docker run --rm -v "$backup_dir:/backup:ro" alpine:3.22 tar -tzf /backup/storage.tar.gz >/dev/null

backup_version=""
if [[ -f "$backup_dir/README.txt" ]]; then
  backup_version="$(sed -n 's/^Version: *//p' "$backup_dir/README.txt" | tail -n 1)"
fi
current_version="$(sed -n 's/^SMART_CHURCH_VERSION=//p' .env | tail -n 1)"
version_changed=0

set_app_version() {
  local version="$1" tmp
  tmp="$(mktemp .env.XXXXXX)"
  awk -v version="$version" '
    BEGIN { found = 0 }
    /^SMART_CHURCH_VERSION=/ { print "SMART_CHURCH_VERSION=" version; found = 1; next }
    { print }
    END { if (!found) print "SMART_CHURCH_VERSION=" version }
  ' .env > "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" .env
}

echo "This replaces the live database and all files in the Smart-Church data volume."
if [[ "$backup_version" =~ ^[0-9a-f]{40}$ && "$backup_version" != "$current_version" ]]; then
  echo "The backup was created with app version $backup_version; restore will also switch the app to that version."
elif [[ -n "$backup_version" && "$backup_version" != "$current_version" ]]; then
  echo "The backup's app version '$backup_version' is not a commit SHA; app version will remain $current_version."
fi
read -r -p "Type RESTORE to continue: " confirmation
[[ "$confirmation" == RESTORE ]] || { echo "Restore cancelled."; exit 1; }

# Pull the matching application images before touching live data. If they are
# unavailable, keep the existing deployment and database intact.
if [[ "$backup_version" =~ ^[0-9a-f]{40}$ && "$backup_version" != "$current_version" ]]; then
  set_app_version "$backup_version"
  if ! docker compose "${compose_args[@]}" "${profile_args[@]}" pull api web; then
    set_app_version "$current_version"
    echo "Could not retrieve the app images for backup version $backup_version; restore cancelled before changing live data." >&2
    exit 1
  fi
  version_changed=1
fi

api_restart_needed=1
restore_data_started=0
restart_api_after_restore() {
  if [[ "$api_restart_needed" -eq 1 ]]; then
    if [[ "$version_changed" -eq 1 && "$restore_data_started" -eq 0 ]]; then
      set_app_version "$current_version" || true
    fi
    if [[ "$version_changed" -eq 1 && "$restore_data_started" -eq 1 ]]; then
      docker compose "${compose_args[@]}" "${profile_args[@]}" up -d --no-deps api web \
        || docker compose "${compose_args[@]}" "${profile_args[@]}" start api \
        || echo "Could not restart the API automatically; start it with: docker compose start api" >&2
    else
      docker compose "${compose_args[@]}" "${profile_args[@]}" start api \
        || echo "Could not restart the API automatically; start it with: docker compose start api" >&2
    fi
  fi
}
trap restart_api_after_restore EXIT

docker compose "${compose_args[@]}" "${profile_args[@]}" stop api
restore_data_started=1
docker compose "${compose_args[@]}" "${profile_args[@]}" exec -T db sh -ec 'pg_restore --clean --if-exists --no-owner --exit-on-error --single-transaction --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' < "$backup_dir/database.dump"
docker run --rm -v "$volume_name:/data" -v "$backup_dir:/backup:ro" alpine:3.22 sh -ec \
  'find /data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +; tar -xzf /backup/storage.tar.gz -C /data; chown -R 1000:1000 /data'
if [[ "$version_changed" -eq 1 ]]; then
  docker compose "${compose_args[@]}" "${profile_args[@]}" up -d --no-deps api web
else
  docker compose "${compose_args[@]}" "${profile_args[@]}" start api
fi
api_restart_needed=0
trap - EXIT
echo "Restore complete. Check services with: docker compose ps"
