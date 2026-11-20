#!/usr/bin/env bash
set -Eeuo pipefail

[[ -r /dev/tty ]] || { echo "Run the manager from an interactive terminal." >&2; exit 1; }

script_root=""
if [[ -f "${BASH_SOURCE[0]:-}" ]]; then
  candidate="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
  [[ -f "$candidate/compose.yaml" ]] && script_root="$candidate"
fi
if [[ -z "$script_root" && -f "$PWD/compose.yaml" ]]; then script_root="$PWD"; fi

if [[ -z "$script_root" || ! -f "$script_root/.env" ]]; then
  if command -v whiptail >/dev/null; then
    choice="$(whiptail --title "Smart-Church Manager" --menu "Smart-Church is not installed yet" 10 72 2 install "Install Smart-Church" exit "Exit" 3>&1 1>&2 2>&3)" || exit 0
  elif command -v dialog >/dev/null; then
    choice="$(dialog --title "Smart-Church Manager" --menu "Smart-Church is not installed yet" 10 72 2 install "Install Smart-Church" exit "Exit" 3>&1 1>&2 2>&3)" || exit 0
  else
    echo "Smart-Church is not installed yet."
    select choice in install exit; do
      [[ -n "${choice:-}" ]] && break
    done </dev/tty >/dev/tty
  fi
  [[ "$choice" == install ]] || exit 0
  if [[ -n "$script_root" ]]; then
    exec bash "$script_root/deploy/install.sh"
  fi
  install_dir="${SMART_CHURCH_INSTALL_DIR:-/opt/smart-church}"
  [[ "$(id -u)" -eq 0 ]] || { echo "Run the manager with sudo to install in $install_dir." >&2; exit 1; }
  command -v curl >/dev/null || { echo "Install curl, then retry." >&2; exit 1; }
  command -v tar >/dev/null || { echo "Install tar, then retry." >&2; exit 1; }
  mkdir -p "$install_dir"
  archive="$(mktemp)"
  trap 'rm -f "$archive"' EXIT
  curl -fsSL --retry 3 "https://github.com/juristoeckli/smart-Church/releases/latest/download/smart-church-deploy.tar.gz" -o "$archive"
  tar -xzf "$archive" -C "$install_dir"
  rm -f "$archive"
  trap - EXIT
  exec bash "$install_dir/deploy/install.sh"
fi

root="$script_root"
cd "$root"
source deploy/remote-desktop-env.sh
migrate_remote_desktop_env .env
initialize_remote_desktop_module_installation .env
for module_manager in apps/api/src/modules/*/manager.sh; do
  [[ -f "$module_manager" ]] && source "$module_manager"
done
command -v docker >/dev/null || { echo "Docker is required to manage Smart-Church." >&2; exit 1; }
docker compose version >/dev/null || { echo "The Docker Compose plugin is required." >&2; exit 1; }

build_compose_args() {
  compose_files=(-f compose.yaml)
  if [[ -f deploy/compose.direct.yaml ]]; then
    compose_files+=(-f deploy/compose.direct.yaml)
  fi
  if [[ -f deploy/compose.amx.yaml ]] && grep -q '^SMART_CHURCH_USE_AMX_MODULE=1' .env; then
    compose_files+=(-f deploy/compose.amx.yaml)
  fi
  if [[ -f deploy/compose.remote-desktop.yaml ]] && grep -q '^SMART_CHURCH_REMOTE_DESKTOP_MODULE_INSTALLED=1' .env; then
    compose_files+=(-f deploy/compose.remote-desktop.yaml)
  fi
  if [[ -f deploy/compose.module-packages.yaml ]]; then
    compose_files+=(-f deploy/compose.module-packages.yaml)
  fi
  if [[ -f apps/api/src/modules/video-steffisburg/compose.yaml ]] && grep -q '^SMART_CHURCH_STREAMING_CONFIG_PATH=' .env; then
    compose_files+=(-f apps/api/src/modules/video-steffisburg/compose.yaml)
  fi
  if [[ -f apps/api/src/modules/remote-desktop/compose.yaml ]] && grep -q '^SMART_CHURCH_USE_REMOTE_DESKTOP=1' .env; then
    compose_files+=(-f apps/api/src/modules/remote-desktop/compose.yaml)
  fi
  compose_args=("${compose_files[@]}")
  if grep -q '^SMART_CHURCH_USE_BUNDLED_PROXY=1' .env; then
    compose_args+=(--profile bundled-proxy)
  fi
  if grep -q '^SMART_CHURCH_USE_REMOTE_DESKTOP=1' .env; then
    compose_args+=(--profile remote-desktop)
  fi
}

build_compose_args

run_compose() {
  docker compose "${compose_args[@]}" "$@"
}

env_value() {
  sed -n "s/^$1=//p" .env | tail -n 1
}

manager_version_label() {
  local version branch
  version="$(env_value SMART_CHURCH_VERSION)"
  branch="$(env_value SMART_CHURCH_UPDATE_BRANCH)"
  version="${version:-unknown}"
  branch="${branch:-release}"
  if [[ "$version" =~ ^[0-9a-f]{40}$ ]]; then version="${version:0:7}"; fi
  printf 'Installed version: %s | Update branch: %s' "$version" "$branch"
}

manager_service_health() {
  local service="$1" container_id state health
  container_id="$(run_compose ps -q "$service" 2>/dev/null | head -n 1)"
  if [[ -z "$container_id" ]]; then printf 'not created'; return; fi
  state="$(docker inspect --format '{{.State.Status}}' "$container_id" 2>/dev/null || printf 'unknown')"
  if [[ "$state" != running ]]; then printf '%s' "$state"; return; fi
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}running{{end}}' "$container_id" 2>/dev/null || printf 'unknown')"
  printf '%s' "$health"
}

manager_health_summary() {
  printf 'DB %s  |  API %s  |  Web %s' \
    "$(manager_service_health db)" \
    "$(manager_service_health api)" \
    "$(manager_service_health web)"
}

select_backup_path() {
  local path choice custom_path index
  local -a backup_paths=() menu_items=() text_labels=()
  for path in "$root"/backups/*; do
    [[ -d "$path" && -f "$path/database.dump" && -f "$path/storage.tar.gz" ]] && backup_paths+=("$path")
  done

  for ((index=${#backup_paths[@]}-1; index>=0; index--)); do
    path="${backup_paths[$index]}"
    menu_items+=("$index" "$(basename -- "$path") · $(du -sh -- "$path" 2>/dev/null | cut -f1)")
    text_labels+=("$(basename -- "$path")")
  done
  menu_items+=(custom "Choose a custom path")
  text_labels+=("Choose a custom path")
  menu_items+=(cancel "Cancel")
  text_labels+=("Cancel")

  if command -v whiptail >/dev/null; then
    choice="$(whiptail --title "Restore a backup" --menu "Select an available backup or enter a custom path." 22 78 14 "${menu_items[@]}" 3>&1 1>&2 2>&3)" || return 1
  elif command -v dialog >/dev/null; then
    choice="$(dialog --title "Restore a backup" --menu "Select an available backup or enter a custom path." 22 78 14 "${menu_items[@]}" 3>&1 1>&2 2>&3)" || return 1
  else
    printf '\nAvailable backups (newest first):\n' >/dev/tty
    for ((index=0; index<${#backup_paths[@]}; index++)); do
      printf '  %d) %s\n' "$((index + 1))" "${text_labels[$index]}" >/dev/tty
    done
    printf '  %d) Choose a custom path\n  %d) Cancel\n' \
      "$(( ${#backup_paths[@]} + 1 ))" "$(( ${#backup_paths[@]} + 2 ))" >/dev/tty
    read -r -p 'Select a backup: ' choice </dev/tty
    if [[ "$choice" =~ ^[0-9]+$ ]]; then
      if (( choice == ${#backup_paths[@]} + 1 )); then choice=custom
      elif (( choice == ${#backup_paths[@]} + 2 )); then return 1
      elif (( choice >= 1 && choice <= ${#backup_paths[@]} )); then choice=$(( ${#backup_paths[@]} - choice ))
      else echo 'Choose a number shown in the list.' >/dev/tty; return 1
      fi
    fi
  fi

  if [[ "$choice" == custom ]]; then
    if command -v whiptail >/dev/null; then
      custom_path="$(whiptail --title "Custom backup path" --inputbox "Enter an absolute path or a path relative to the installation directory." 10 78 3>&1 1>&2 2>&3)" || return 1
    elif command -v dialog >/dev/null; then
      custom_path="$(dialog --title "Custom backup path" --inputbox "Enter an absolute path or a path relative to the installation directory." 10 78 3>&1 1>&2 2>&3)" || return 1
    else
      read -r -p 'Backup directory path: ' custom_path </dev/tty
    fi
    [[ -n "$custom_path" ]] || return 1
    printf '%s' "$custom_path"
    return 0
  fi
  [[ "$choice" != cancel && "$choice" =~ ^[0-9]+$ && -n "${backup_paths[$choice]:-}" ]] || return 1
  printf '%s' "${backup_paths[$choice]}"
}

set_env_value() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp .env.XXXXXX)"
  awk -v key="$key" -v value="$value" '
    BEGIN { found = 0 }
    index($0, key "=") == 1 { print key "=" value; found = 1; next }
    { print }
    END { if (!found) print key "=" value }
  ' .env > "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" .env
}

unset_env_value() {
  local key="$1" tmp
  tmp="$(mktemp .env.XXXXXX)"
  awk -v key="$key" 'index($0, key "=") != 1 { print }' .env > "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" .env
}

valid_ipv4() {
  local address="$1" octet
  local -a octets
  [[ "$address" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || return 1
  IFS=. read -r -a octets <<< "$address"
  for octet in "${octets[@]}"; do
    (( 10#$octet <= 255 )) || return 1
  done
}

valid_port() {
  [[ "$1" =~ ^[0-9]{1,5}$ ]] && (( 10#$1 >= 1 && 10#$1 <= 65535 ))
}

select_update_branch() {
  local current_version="$(env_value SMART_CHURCH_VERSION)" branch
  if command -v whiptail >/dev/null; then
    branch="$(whiptail --title "Smart-Church Branch" --menu "Current image: ${current_version:-latest}. Branch builds may contain unfinished changes." 14 72 4 \
      main "Production branch" \
      beta "Beta branch" \
      dev "Development branch" \
      cancel "Return to manager" 3>&1 1>&2 2>&3)" || return 1
  elif command -v dialog >/dev/null; then
    branch="$(dialog --title "Smart-Church Branch" --menu "Current image: ${current_version:-latest}. Branch builds may contain unfinished changes." 14 72 4 \
      main "Production branch" \
      beta "Beta branch" \
      dev "Development branch" \
      cancel "Return to manager" 3>&1 1>&2 2>&3)" || return 1
  else
    echo "Current image: ${current_version:-latest}" >/dev/tty
    select branch in main beta dev cancel; do
      [[ -n "${branch:-}" ]] && break
    done </dev/tty >/dev/tty
  fi
  printf '%s' "$branch"
}

force_update_branch() {
  local branch="$1" commit_sha image update_script
  case "$branch" in
    main|beta|dev) ;;
    *) echo "Choose main, beta, or dev before forcing a branch update." >&2; return 0 ;;
  esac
  command -v git >/dev/null || { echo "git is required to resolve the selected branch." >&2; return 1; }
  # Avoid GitHub's unauthenticated REST API rate limit when resolving branch refs.
  commit_sha="$(git ls-remote --exit-code https://github.com/juristoeckli/smart-Church.git "refs/heads/$branch" \
    | awk -v ref="refs/heads/$branch" '$2 == ref { print $1; exit }')"
  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] || { echo "Could not resolve the latest $branch commit from GitHub." >&2; return 1; }
  for image in smart-church-api smart-church-web; do
    if ! docker manifest inspect "ghcr.io/juristoeckli/$image:$commit_sha" >/dev/null 2>&1; then
      echo "The $branch images for commit $commit_sha are not published yet. Wait for the branch image build to finish, then retry." >&2
      return 0
    fi
  done
  if [[ "$(env_value SMART_CHURCH_USE_AMX_MODULE)" == 1 ]]; then
    for image in smart-church-web-amx smart-church-module-amx; do
      if ! docker manifest inspect "ghcr.io/juristoeckli/$image:$commit_sha" >/dev/null 2>&1; then
        echo "The AMX images for commit $commit_sha are not published yet. Wait for the branch image build to finish, then retry." >&2
        return 0
      fi
    done
  fi
  if [[ "$(env_value SMART_CHURCH_REMOTE_DESKTOP_MODULE_INSTALLED)" == 1 ]]; then
    for image in smart-church-module-remote-desktop; do
      if ! docker manifest inspect "ghcr.io/juristoeckli/$image:$commit_sha" >/dev/null 2>&1; then
        echo "The Remote desktop module image for commit $commit_sha is not published yet. Wait for the branch image build to finish, then retry." >&2
        return 0
      fi
    done
  fi
  echo "Forcing an update to $branch commit $commit_sha."
  update_script="deploy/.update-${commit_sha}.sh"
  curl -fsSL --retry 3 "https://raw.githubusercontent.com/juristoeckli/smart-Church/$commit_sha/deploy/update.sh" -o "$update_script" || {
    rm -f "$update_script"
    echo "Could not retrieve the updater from commit $commit_sha." >&2
    return 1
  }
  bash "$update_script" "$commit_sha" || {
    local status=$?
    rm -f "$update_script"
    return "$status"
  }
  rm -f "$update_script"
}

module_enabled() {
  local department_id="$1" module_id="$2" query result
  case "$module_id" in amx|video-steffisburg|remote-desktop|presenter) ;; *) return 2 ;; esac
  [[ "$department_id" =~ ^[0-9a-fA-F-]{36}$ ]] || { echo "The primary location ID is missing or invalid." >&2; return 1; }
  query="SELECT '$module_id' = ANY(enabled_modules) FROM departments WHERE id = '$department_id'::uuid"
  result="$(run_compose exec -T db sh -ec 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "$1"' sh "$query" | tr -d '\r')"
  [[ "$result" == t ]]
}

set_module_enabled() {
  local department_id="$1" module_id="$2" desired="$3" query result expected installation_query installation_id
  case "$module_id" in amx|video-steffisburg|remote-desktop|presenter) ;; *) return 2 ;; esac
  [[ "$department_id" =~ ^[0-9a-fA-F-]{36}$ ]] || { echo "The primary location ID is missing or invalid." >&2; return 1; }
  [[ "$desired" == true || "$desired" == false ]] || return 2
  installation_query="SELECT installation_id FROM departments WHERE id = '$department_id'::uuid"
  installation_id="$(run_compose exec -T db sh -ec 'psql -v ON_ERROR_STOP=1 -qAt -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1"' sh "$installation_query" | tr -d '\r')"
  [[ "$installation_id" =~ ^[0-9a-fA-F-]{36}$ ]] || { echo "Could not determine the installation for location $department_id." >&2; return 1; }
  expected=t
  [[ "$desired" == false ]] && expected=f
  query="DO \$amx\$
DECLARE
  registry_row_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM installation_modules
     WHERE installation_id='$installation_id'::uuid AND module_id='$module_id'
  ) INTO registry_row_exists;

  IF registry_row_exists THEN
    UPDATE installation_modules SET enabled=$desired,updated_at=now()
     WHERE installation_id='$installation_id'::uuid AND module_id='$module_id'
       AND client_managed=TRUE AND required=FALSE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Module $module_id is not an optional client-managed module';
    END IF;
  END IF;

  UPDATE departments AS department
     SET enabled_modules=COALESCE((
       SELECT array_agg(module_id ORDER BY module_id)
         FROM (
           SELECT module.module_id FROM installation_modules AS module
            WHERE module.installation_id=department.installation_id
              AND module.client_managed=TRUE AND module.enabled=TRUE
           UNION SELECT '$module_id'::text WHERE $desired
         ) AS active_modules
     ), ARRAY['file-storage','notifications']::TEXT[]), updated_at=now()
   WHERE department.installation_id='$installation_id'::uuid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No locations found for installation $installation_id';
  END IF;
  IF EXISTS (
    SELECT 1 FROM departments
     WHERE installation_id='$installation_id'::uuid
       AND (('$module_id'=ANY(enabled_modules)) IS DISTINCT FROM $desired)
  ) THEN
    RAISE EXCEPTION 'Location module state verification failed for $module_id';
  END IF;
END
\$amx\$;
SELECT '$expected'"
  result="$(run_compose exec -T db sh -ec 'psql -v ON_ERROR_STOP=1 -qAt -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1"' sh "$query" | tr -d '\r' | tail -n 1)"
  [[ "$result" == "$expected" ]] || {
    echo "Could not set $module_id to $desired for installation $installation_id (database verification returned '${result:-no row}')." >&2
    return 1
  }
}

select_module() {
  local amx_state="$1" video_state="$2" remote_desktop_state="$3" presenter_state="$4" choice
  if command -v whiptail >/dev/null; then
    choice="$(whiptail --title "Smart-Church Modules" --menu "Optional modules for $(env_value SMART_CHURCH_DEPARTMENT_NAME). Install downloads the selected module images." 18 78 5 \
      amx "AMX — $amx_state" \
      video-steffisburg "Video & streaming — $video_state" \
      remote-desktop "Remote desktop — $remote_desktop_state" \
      presenter "Presenter — $presenter_state" \
      back "Return" 3>&1 1>&2 2>&3)" || return 1
  elif command -v dialog >/dev/null; then
    choice="$(dialog --title "Smart-Church Modules" --menu "Optional modules for $(env_value SMART_CHURCH_DEPARTMENT_NAME). Install downloads the selected module images." 18 78 5 \
      amx "AMX — $amx_state" \
      video-steffisburg "Video & streaming — $video_state" \
      remote-desktop "Remote desktop — $remote_desktop_state" \
      presenter "Presenter — $presenter_state" \
      back "Return" 3>&1 1>&2 2>&3)" || return 1
  else
    echo "Optional modules for $(env_value SMART_CHURCH_DEPARTMENT_NAME): AMX [$amx_state], Video & streaming [$video_state], Remote desktop [$remote_desktop_state], Presenter [$presenter_state]" >/dev/tty
    select choice in amx video-steffisburg remote-desktop presenter back; do
      [[ -n "${choice:-}" ]] && break
      echo "Choose a number from the menu." >/dev/tty
    done </dev/tty >/dev/tty
  fi
  printf '%s' "$choice"
}

configure_video_settings() {
  local host port mac api_key default_host default_port default_mac
  [[ "$(env_value SMART_CHURCH_DEPARTMENT_NAME)" == "Steffisburg" ]] || {
    echo "Video & streaming settings are specific to the Steffisburg deployment." >&2
    return 1
  }
  host="$(env_value SMART_CHURCH_VIDEO_STEFFISBURG_DS700_HOST)"
  port="$(env_value SMART_CHURCH_VIDEO_STEFFISBURG_DS700_PORT)"
  mac="$(env_value SMART_CHURCH_VIDEO_STEFFISBURG_CLIENT_MAC)"
  default_host="${host:-10.6.70.90}"
  default_port="${port:-19540}"
  default_mac="${mac:-9c:5c:8e:00:c7:ac}"
  read -r -p "DS-700 host [$default_host]: " host </dev/tty
  read -r -p "DS-700 UDP port [$default_port]: " port </dev/tty
  read -r -p "Client MAC [$default_mac]: " mac </dev/tty
  host="${host:-$default_host}"
  port="${port:-$default_port}"
  mac="${mac:-$default_mac}"
  [[ "$host" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "Enter a valid IPv4 address or hostname for the DS-700." >&2; return 1; }
  valid_port "$port" || { echo "Enter a UDP port from 1 to 65535." >&2; return 1; }
  [[ "$mac" =~ ^([[:xdigit:]]{2}:){5}[[:xdigit:]]{2}$ ]] || { echo "Enter a MAC address in 00:11:22:33:44:55 format." >&2; return 1; }
  set_env_value SMART_CHURCH_VIDEO_STEFFISBURG_DS700_HOST "$host"
  set_env_value SMART_CHURCH_VIDEO_STEFFISBURG_DS700_PORT "$port"
  set_env_value SMART_CHURCH_VIDEO_STEFFISBURG_CLIENT_MAC "$mac"
  read -r -s -p "UniFi API key (press Enter to keep current, or type - to clear): " api_key </dev/tty
  echo >/dev/tty
  if [[ "$api_key" == "-" ]]; then
    set_env_value SMART_CHURCH_VIDEO_STEFFISBURG_UNIFI_API_KEY ""
  elif [[ -n "$api_key" ]]; then
    set_env_value SMART_CHURCH_VIDEO_STEFFISBURG_UNIFI_API_KEY "$api_key"
  fi
  echo "Video & streaming settings saved in the protected .env file."
  if [[ "$video_state" == "enabled" ]]; then
    build_compose_args
    run_compose up -d api || return 1
  fi
}

configure_module_settings() {
  local module_id="$1" function_name
  shift
  [[ "$module_id" =~ ^[a-z0-9][a-z0-9-]*$ ]] || { echo "Invalid module ID." >&2; return 1; }
  function_name="configure_${module_id//-/_}_module"
  declare -F "$function_name" >/dev/null || { echo "Module $module_id does not provide command-line settings."; return 1; }
  "$function_name" "$@"
}

module_package_tool() {
  local archive="$1" python_script
  shift
  python_script="$(cat <<'PY'
import json
import fcntl
import os
import re
import shutil
import sys
import tarfile
import tempfile
from pathlib import Path, PurePosixPath

MODULES = Path('/modules')
ID_RE = re.compile(r'^[a-z0-9][a-z0-9-]*$')
SEMVER_RE = re.compile(r'^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$')
MAX_ARCHIVE = 100 * 1024 * 1024
MAX_EXPANDED = 512 * 1024 * 1024
MAX_ENTRIES = 10000

def fail(message):
    raise SystemExit(message)

def safe_member_name(name):
    if not name or '\\' in name or name.startswith('/') or '\x00' in name:
        fail('Archive contains an unsafe path.')
    trimmed = name[:-1] if name.endswith('/') else name
    pieces = trimmed.split('/')
    if not trimmed or any(piece in ('', '.', '..') for piece in pieces):
        fail('Archive contains an unsafe path.')
    path = PurePosixPath(trimmed)
    if path.is_absolute() or any(part == '..' for part in path.parts):
        fail('Archive contains an unsafe path.')
    return trimmed

def read_package(archive_path):
    archive = Path(archive_path)
    if not archive.is_file() or archive.stat().st_size > MAX_ARCHIVE:
        fail('Module archive is missing or exceeds the 100 MiB limit.')
    try:
        tar = tarfile.open(archive, mode='r:gz')
    except (tarfile.TarError, OSError) as error:
        fail('Could not read a gzip tar archive: ' + str(error))
    members = []
    names = set()
    expanded = 0
    manifest_member = None
    web_present = False
    web_entry = False
    for member in tar:
        name = safe_member_name(member.name)
        if name in names:
            fail('Archive contains duplicate paths.')
        names.add(name)
        if len(names) > MAX_ENTRIES:
            fail('Archive contains too many entries.')
        if not (member.isdir() or member.isfile()):
            fail('Archive links and special files are not allowed.')
        allowed = name == 'manifest.json' or name == 'web' or name.startswith('web/') or '/' not in name
        if not allowed:
            fail('Archive paths must be root files or be under web/.')
        if '/' not in name and name != 'manifest.json' and (member.isdir() or not re.fullmatch(r'[A-Za-z0-9._-]+', name)):
            fail('Root package entries must be regular files with simple names.')
        if name == 'web' and not member.isdir():
            fail('web must be a directory.')
        if name == 'web' or name.startswith('web/'):
            web_present = True
            child = name[4:] if name.startswith('web/') else ''
            if child and child not in ('module.js', 'module.css', 'assets') and not child.startswith('assets/'):
                fail('The web/ folder may contain only module.js, module.css, and assets/.')
            if name == 'web/module.js' and member.isfile():
                web_entry = True
        if member.isfile():
            if member.size < 0:
                fail('Archive contains an invalid file size.')
            expanded += member.size
            if expanded > MAX_EXPANDED:
                fail('Expanded module package exceeds the 512 MiB limit.')
        if name == 'manifest.json':
            if not member.isfile() or member.size > 1024 * 1024:
                fail('manifest.json must be a regular file no larger than 1 MiB.')
            manifest_member = member
        members.append((member, name))
    if manifest_member is None:
        fail('Module archive must contain manifest.json at its root.')
    if not web_present or not web_entry:
        fail('External module packages must contain web/module.js.')
    source = tar.extractfile(manifest_member)
    if source is None:
        fail('Could not read manifest.json.')
    try:
        manifest = json.load(source)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        fail('manifest.json is not valid UTF-8 JSON: ' + str(error))
    if not isinstance(manifest, dict):
        fail('manifest.json must contain a JSON object.')
    module_id = manifest.get('id')
    version = manifest.get('version')
    worker_entry = manifest.get('workerEntry')
    if not isinstance(module_id, str) or not ID_RE.fullmatch(module_id):
        fail('Module manifest ID must match ^[a-z0-9][a-z0-9-]*$.')
    if not isinstance(version, str) or not SEMVER_RE.fullmatch(version):
        fail('Module manifest version must be semantic versioning (for example 1.2.3).')
    if 'name' in manifest and (not isinstance(manifest['name'], str) or not manifest['name'].strip()):
        fail('Module manifest name must be a non-empty string.')
    if 'description' in manifest and (not isinstance(manifest['description'], str) or len(manifest['description']) > 500):
        fail('Module manifest description must be a string of at most 500 characters.')
    for flag in ('required', 'enabledByDefault', 'clientManaged'):
        if flag in manifest and not isinstance(manifest[flag], bool):
            fail('Module manifest ' + flag + ' must be a boolean.')
    if 'serverEntry' in manifest:
        fail('serverEntry is not allowed; in-process API modules are not isolated.')
    if manifest.get('required') is True or manifest.get('enabledByDefault') is True:
        fail('External packages must remain optional and disabled until a Server Administrator enables them.')
    if manifest.get('clientManaged') is False:
        fail('External packages must be client-managed so they can be enabled in Settings → Modules.')
    dependencies = manifest.get('dependencies', {})
    if not isinstance(dependencies, dict):
        fail('Module manifest dependencies must be an object.')
    required = dependencies.get('required', [])
    optional = dependencies.get('optional', [])
    for kind, values in (('required', required), ('optional', optional)):
        if not isinstance(values, list) or any(not isinstance(value, str) or not ID_RE.fullmatch(value) for value in values):
            fail('Module manifest ' + kind + ' dependencies must be module IDs.')
        if len(set(values)) != len(values) or module_id in values:
            fail('Module manifest dependencies must be unique and cannot contain the module itself.')
    if set(required) & set(optional):
        fail('A module dependency cannot be both required and optional.')
    runtime_dependencies = manifest.get('runtimeDependencies')
    if runtime_dependencies is not None and (not isinstance(runtime_dependencies, list) or any(not isinstance(value, str) or not value.strip() for value in runtime_dependencies)):
        fail('Module manifest runtimeDependencies must be a list of non-empty strings.')
    access_grants = manifest.get('accessGrants')
    if access_grants is not None and (not isinstance(access_grants, list) or any(not isinstance(value, str) or not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,79}', value) for value in access_grants) or len(set(access_grants)) != len(access_grants)):
        fail('Module manifest accessGrants must be unique lowercase grant IDs.')
    if not isinstance(worker_entry, str) or not re.fullmatch(r'\./[A-Za-z0-9._-]+\.js', worker_entry) or '..' in worker_entry:
        fail('Module manifest must declare a module-local workerEntry such as ./worker.js.')
    worker_name = worker_entry[2:]
    if any('/' not in name and name != 'manifest.json' and name != worker_name for _, name in members):
        fail('The archive root may contain only manifest.json and the declared workerEntry file.')
    if not any(name == worker_name and member.isfile() for member, name in members):
        fail('The workerEntry file is missing from the archive root.')
    return tar, members, manifest, module_id, web_present

def inspect():
    tar, _, manifest, module_id, _ = read_package('/package.tar.gz')
    tar.close()
    print(module_id)

def install():
    tar, members, manifest, module_id, web_present = read_package('/package.tar.gz')
    web_root = MODULES / '.web'
    if web_root.exists() and (web_root.is_symlink() or not web_root.is_dir()):
        fail('The shared module web directory is not a regular directory.')
    target = MODULES / module_id
    web_target = web_root / module_id
    if target.exists() or target.is_symlink() or web_target.exists() or web_target.is_symlink():
        fail('That module ID is already installed. Uninstall it before replacing it.')
    MODULES.mkdir(parents=True, exist_ok=True)
    web_root.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix='.module-package-', dir=MODULES))
    stage_module = stage / module_id
    stage_web = stage / 'web'
    stage_module.mkdir()
    if web_present:
        stage_web.mkdir()
    try:
        for member, name in members:
            if member.isdir():
                if name == 'manifest.json':
                    fail('manifest.json must be a regular file.')
                if name.startswith('web/') and web_present:
                    relative = name[4:]
                    if relative:
                        (stage_web / relative).mkdir(parents=True, exist_ok=True)
                continue
            if name == 'manifest.json':
                destination = stage_module / name
            elif name.startswith('web/'):
                destination = stage_web / name[4:]
            elif '/' not in name:
                destination = stage_module / name
            else:
                fail('Archive contains an unsupported file.')
            destination.parent.mkdir(parents=True, exist_ok=True)
            source = tar.extractfile(member)
            if source is None:
                fail('Could not read an archive file.')
            with source, destination.open('xb') as output:
                shutil.copyfileobj(source, output, length=1024 * 1024)
        os.chmod(stage_module, 0o755)
        if web_present:
            os.chmod(stage_web, 0o755)
        if web_present:
            os.replace(stage_web, web_target)
        try:
            os.replace(stage_module, target)
        except Exception:
            if web_present and web_target.exists():
                shutil.rmtree(web_target)
            raise
        print(module_id)
    finally:
        tar.close()
        shutil.rmtree(stage, ignore_errors=True)

def valid_id(module_id):
    if not isinstance(module_id, str) or not ID_RE.fullmatch(module_id):
        fail('Invalid module ID.')
    return module_id

def uninstall(module_id):
    module_id = valid_id(module_id)
    target = MODULES / module_id
    web_root = MODULES / '.web'
    web_target = web_root / module_id
    removed = False
    for path in (target, web_target):
        if path.is_symlink():
            fail('Refusing to remove a symbolic link.')
        if path.exists():
            if not path.is_dir():
                fail('Refusing to remove a non-directory module path.')
            shutil.rmtree(path)
            removed = True
    if not removed:
        fail('No installed package was found with that exact ID.')
    print(module_id)

def list_installed():
    if not MODULES.is_dir():
        return
    for path in sorted(MODULES.iterdir()):
        if not path.is_dir() or path.is_symlink() or not ID_RE.fullmatch(path.name):
            continue
        try:
            manifest = json.loads((path / 'manifest.json').read_text(encoding='utf-8'))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            continue
        if isinstance(manifest, dict) and manifest.get('id') == path.name and 'serverEntry' not in manifest:
            print(path.name)

operation = sys.argv[1] if len(sys.argv) > 1 else ''
if operation in ('install', 'uninstall'):
    MODULES.mkdir(parents=True, exist_ok=True)
    lock = open(MODULES / '.module-package.lock', 'a')
    fcntl.flock(lock, fcntl.LOCK_EX)
if operation == 'inspect' and len(sys.argv) == 2:
    inspect()
elif operation == 'install' and len(sys.argv) == 2:
    install()
elif operation == 'uninstall' and len(sys.argv) == 3:
    uninstall(sys.argv[2])
elif operation == 'list' and len(sys.argv) == 2:
    list_installed()
else:
    fail('Invalid module package operation.')
PY
)"
  run_compose --profile module-packages run --rm -v "$archive:/package.tar.gz:ro" module-package-tools -c "$python_script" "$@"
}

install_external_module_package() {
  local source archive temporary_dir module_id installed catalog_query catalog_count
  [[ -f deploy/compose.module-packages.yaml ]] || { echo "The module package helper is missing. Update the Smart-Church deployment package first." >&2; return 1; }
  read -r -p "Local .tar.gz path or HTTPS URL: " source </dev/tty
  [[ -n "$source" ]] || { echo "Package source is required." >&2; return 1; }
  temporary_dir="$(mktemp -d)"
  archive="$temporary_dir/package.tar.gz"
  chmod 700 "$temporary_dir"
  if [[ "$source" =~ ^https:// ]]; then
    command -v curl >/dev/null || { rm -rf "$temporary_dir"; echo "curl is required to download module packages." >&2; return 1; }
    if ! curl -fsSL --proto '=https' --proto-redir '=https' --tlsv1.2 --connect-timeout 15 --max-time 300 --max-filesize 104857600 --retry 3 "$source" -o "$archive"; then
      rm -rf "$temporary_dir"
      echo "Could not download the HTTPS module package." >&2
      return 1
    fi
  elif [[ "$source" =~ ^[A-Za-z][A-Za-z0-9+.-]*:// ]]; then
    rm -rf "$temporary_dir"
    echo "Module package URLs must use HTTPS." >&2
    return 1
  else
    [[ -f "$source" ]] || { rm -rf "$temporary_dir"; echo "Local module archive was not found." >&2; return 1; }
    archive="$(realpath -- "$source")"
  fi
  if ! module_id="$(module_package_tool "$archive" inspect)"; then
    rm -rf "$temporary_dir"
    return 1
  fi
  [[ "$module_id" =~ ^[a-z0-9][a-z0-9-]*$ ]] || { rm -rf "$temporary_dir"; echo "The package validator returned an invalid ID." >&2; return 1; }
  run_compose exec -T db sh -ec 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null || {
    rm -rf "$temporary_dir"
    echo "Start the Smart-Church database before installing an external module package so its ID can be checked against the installation catalog." >&2
    return 1
  }
  catalog_query="SELECT CASE WHEN count(*)=0 THEN -1 ELSE count(*) FILTER (WHERE module_id='$module_id') END FROM installation_modules WHERE installation_id=(SELECT id FROM installations WHERE is_current=TRUE)"
  if ! catalog_count="$(run_compose exec -T db sh -ec 'psql -v ON_ERROR_STOP=1 -qAt -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1"' sh "$catalog_query" | tr -d '\r')"; then
    rm -rf "$temporary_dir"
    return 1
  fi
  [[ "$catalog_count" == 0 ]] || {
    rm -rf "$temporary_dir"
    if [[ "$catalog_count" == -1 ]]; then
      echo "Start the API and let it populate the module catalog before installing an external package." >&2
      return 1
    fi
    echo "Module ID $module_id is already registered in this installation. Choose a different ID." >&2
    return 1
  }
  if ! installed="$(module_package_tool "$archive" install)"; then
    rm -rf "$temporary_dir"
    return 1
  fi
  [[ "$installed" == "$module_id" ]] || { rm -rf "$temporary_dir"; echo "Installed module ID did not match the inspected package." >&2; return 1; }
  rm -rf "$temporary_dir"
  run_compose up -d api web || return 1
  run_compose restart api web || return 1
  echo "Installed module package $module_id. It remains disabled until a Server Administrator enables it in Settings → Modules."
  echo "Any database data owned by the module was left untouched."
}

uninstall_external_module_package() {
  local installed module_id confirmation archive enabled_query enabled_state dependent_script dependents dependent_id cleanup_query
  [[ -f deploy/compose.module-packages.yaml ]] || { echo "The module package helper is missing. Update the Smart-Church deployment package first." >&2; return 1; }
  archive="$(mktemp)"
  if ! installed="$(module_package_tool "$archive" list)"; then
    rm -f "$archive"
    return 1
  fi
  rm -f "$archive"
  [[ -n "$installed" ]] || { echo "No external module packages are installed."; return 0; }
  if command -v whiptail >/dev/null; then
    local -a choices=()
    while IFS= read -r module_id; do [[ -n "$module_id" ]] && choices+=("$module_id" "$module_id"); done <<< "$installed"
    module_id="$(whiptail --title "Uninstall module package" --menu "Select the exact module ID. Its database data will be kept." 16 72 8 "${choices[@]}" 3>&1 1>&2 2>&3)" || return 0
  elif command -v dialog >/dev/null; then
    local -a choices=()
    while IFS= read -r module_id; do [[ -n "$module_id" ]] && choices+=("$module_id" "$module_id"); done <<< "$installed"
    module_id="$(dialog --title "Uninstall module package" --menu "Select the exact module ID. Its database data will be kept." 16 72 8 "${choices[@]}" 3>&1 1>&2 2>&3)" || return 0
  else
    printf 'Installed external module packages:\n%s\n' "$installed"
    read -r -p "Exact module ID to uninstall: " module_id </dev/tty
  fi
  grep -Fxq -- "$module_id" <<< "$installed" || { echo "Select an installed package ID exactly as listed." >&2; return 1; }
  read -r -p "Type '$module_id' to remove its package files (database data stays): " confirmation </dev/tty
  [[ "$confirmation" == "$module_id" ]] || { echo "Uninstall cancelled."; return 0; }
  run_compose exec -T db sh -ec 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null || {
    echo "Start the Smart-Church database before uninstalling an external module package." >&2
    return 1
  }
  enabled_query="SELECT enabled FROM installation_modules WHERE installation_id=(SELECT id FROM installations WHERE is_current=TRUE) AND module_id='$module_id' AND client_managed=TRUE"
  enabled_state="$(run_compose exec -T db sh -ec 'psql -v ON_ERROR_STOP=1 -qAt -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1"' sh "$enabled_query" | tr -d '\r')"
  [[ -z "$enabled_state" || "$enabled_state" == t || "$enabled_state" == f ]] || { echo "Unexpected module activation state for $module_id." >&2; return 1; }
  [[ "$enabled_state" != t ]] || { echo "Disable $module_id in Settings → Modules before uninstalling its package." >&2; return 1; }
  run_compose up -d api >/dev/null || return 1
  enabled_state="$(run_compose exec -T db sh -ec 'psql -v ON_ERROR_STOP=1 -qAt -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1"' sh "$enabled_query" | tr -d '\r')"
  [[ "$enabled_state" != t ]] || { echo "Disable $module_id in Settings → Modules before uninstalling its package." >&2; return 1; }
  dependent_script="$(cat <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const targetId = process.argv[1];
const roots = ['/workspace/apps/api/src/modules', '/var/lib/smart-church/modules'];
const found = new Set();
for (const root of roots) {
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(root, entry.name, 'manifest.json'), 'utf8'));
      const required = manifest.dependencies?.required;
      if (manifest.id === entry.name && entry.name !== targetId && Array.isArray(required) && required.includes(targetId)) found.add(entry.name);
    } catch (error) { if (error.code !== 'ENOENT') continue; }
  }
}
for (const id of [...found].sort()) console.log(id);
NODE
)"
  dependents="$(run_compose exec -T api node -e "$dependent_script" "$module_id")" || return 1
  while IFS= read -r dependent_id; do
    [[ -n "$dependent_id" ]] || continue
    [[ "$dependent_id" =~ ^[a-z0-9][a-z0-9-]*$ ]] || { echo "An installed manifest contains an invalid dependent module ID; cannot safely uninstall $module_id." >&2; return 1; }
    echo "Cannot uninstall $module_id while installed module $dependent_id declares it as a required dependency. Uninstall the dependent module first." >&2
    return 1
  done <<< "$dependents"
  if [[ "$enabled_state" == f ]]; then
    cleanup_query="DO \$cleanup\$ DECLARE installation_uuid UUID; BEGIN SELECT id INTO installation_uuid FROM installations WHERE is_current=TRUE FOR UPDATE; IF installation_uuid IS NOT NULL THEN IF EXISTS (SELECT 1 FROM installation_modules WHERE installation_id=installation_uuid AND module_id='$module_id' AND client_managed=TRUE AND (enabled=TRUE OR required=TRUE)) THEN RAISE EXCEPTION 'Module $module_id became enabled or required during uninstall'; END IF; DELETE FROM installation_modules WHERE installation_id=installation_uuid AND module_id='$module_id' AND client_managed=TRUE AND required=FALSE AND enabled=FALSE; UPDATE departments SET enabled_modules=array_remove(enabled_modules,'$module_id'),updated_at=now() WHERE installation_id=installation_uuid; END IF; END; \$cleanup\$"
    if ! run_compose exec -T db sh -ec 'psql -v ON_ERROR_STOP=1 -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1"' sh "$cleanup_query"; then
      echo "The package files are still installed; catalog cleanup did not complete. No module data was changed." >&2
      return 1
    fi
  fi
  archive="$(mktemp)"
  if ! module_package_tool "$archive" uninstall "$module_id"; then
    rm -f "$archive"
    if [[ "$enabled_state" == f ]]; then
      run_compose restart api >/dev/null || echo "API restart failed; start the API to rebuild this package's disabled catalog entry." >&2
    fi
    echo "Package files remain installed. Module-owned data was not changed." >&2
    return 1
  fi
  rm -f "$archive"
  run_compose up -d api web || return 1
  run_compose restart api web || return 1
  echo "Uninstalled package files for $module_id. Database data was left untouched."
}

module_manager() {
  local department_id department_name amx_state video_state remote_desktop_state presenter_state action module_id key
  department_id="$(env_value SMART_CHURCH_DEPARTMENT_ID)"
  department_name="$(env_value SMART_CHURCH_DEPARTMENT_NAME)"
  while true; do
    if command -v whiptail >/dev/null; then
      action="$(whiptail --title "Smart-Church Module Manager" --menu "Install bundled modules or manage an external worker package." 20 78 6 \
        enable "Install / enable module" \
        disable "Disable module" \
        settings "Change module settings" \
        package-install "Install external package" \
        package-remove "Uninstall external package" \
        back "Return to manager" 3>&1 1>&2 2>&3)" || return 0
    elif command -v dialog >/dev/null; then
      action="$(dialog --title "Smart-Church Module Manager" --menu "Install bundled modules or manage an external worker package." 20 78 6 \
        enable "Install / enable module" \
        disable "Disable module" \
        settings "Change module settings" \
        package-install "Install external package" \
        package-remove "Uninstall external package" \
        back "Return to manager" 3>&1 1>&2 2>&3)" || return 0
    else
      echo "Primary location: ${department_name:-not configured}" >/dev/tty
      select action in enable disable settings package-install package-remove back; do
        [[ -n "${action:-}" ]] && break
        echo "Choose a number from the menu." >/dev/tty
      done </dev/tty >/dev/tty
    fi
    [[ "$action" == back ]] && return 0
    case "$action" in
      package-install) install_external_module_package || true; continue ;;
      package-remove) uninstall_external_module_package || true; continue ;;
    esac
    [[ "$department_id" =~ ^[0-9a-fA-F-]{36}$ ]] || { echo "SMART_CHURCH_DEPARTMENT_ID is missing or invalid in .env." >&2; return 1; }
    run_compose exec -T db sh -ec 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null || {
      echo "Start the Smart-Church database before managing bundled modules." >&2
      return 1
    }
    video_state=disabled
    remote_desktop_state=not-installed
    presenter_state=disabled
    amx_state=not-installed
    if [[ "$(env_value SMART_CHURCH_USE_AMX_MODULE)" == 1 ]]; then
      amx_state=disabled
      module_enabled "$department_id" amx && amx_state=enabled
    fi
    module_enabled "$department_id" video-steffisburg && video_state=enabled
    if [[ "$(env_value SMART_CHURCH_REMOTE_DESKTOP_MODULE_INSTALLED)" == 1 ]]; then
      remote_desktop_state=disabled
      module_enabled "$department_id" remote-desktop && remote_desktop_state=enabled
    fi
    module_enabled "$department_id" presenter && presenter_state=enabled
    module_id="$(select_module "$amx_state" "$video_state" "$remote_desktop_state" "$presenter_state")" || continue
    [[ "$module_id" == back ]] && continue
    case "$action:$module_id" in
      enable:amx)
        if [[ "$(env_value SMART_CHURCH_USE_AMX_MODULE)" != 1 ]]; then
          [[ -f deploy/compose.amx.yaml ]] || { echo "The AMX deployment files are missing. Update Smart-Church first." >&2; continue; }
          set_env_value SMART_CHURCH_USE_AMX_MODULE 1
          build_compose_args
          if ! run_compose pull web amx-module; then
            set_env_value SMART_CHURCH_USE_AMX_MODULE 0
            build_compose_args
            echo "Could not download the AMX images for version $(env_value SMART_CHURCH_VERSION). Confirm that this version has finished building, then retry." >&2
            continue
          fi
        fi
        set_module_enabled "$department_id" amx true || return 1
        build_compose_args
        run_compose up -d || return 1
        run_compose restart api || return 1
        amx_state=enabled
        echo "AMX installed and enabled for $department_name. Configure the NetLinx address under Settings → Modules → AMX."
        ;;
      enable:video-steffisburg)
        [[ "$department_name" == "Steffisburg" ]] || { echo "Video & streaming is only available for a Steffisburg location." >&2; continue; }
        [[ -f apps/api/src/modules/video-steffisburg/streaming.steffisburg.json ]] || { echo "The bundled Steffisburg configuration is missing. Update the deployment package first." >&2; continue; }
        if [[ -z "$(env_value SMART_CHURCH_STREAMING_CONFIG_PATH)" ]]; then
          set_env_value SMART_CHURCH_STREAMING_CONFIG_PATH ./apps/api/src/modules/video-steffisburg/streaming.steffisburg.json
        fi
        set_env_value SMART_CHURCH_VIDEO_STEFFISBURG_ENABLED 1
        set_module_enabled "$department_id" video-steffisburg true || return 1
        build_compose_args
        run_compose up -d api || return 1
        video_state=enabled
        echo "Video & streaming enabled for $department_name."
        ;;
      enable:remote-desktop)
        [[ -f apps/api/src/modules/remote-desktop/compose.yaml ]] || { echo "The Remote desktop deployment module is missing. Update the deployment package first." >&2; continue; }
        key="$(env_value REMOTE_DESKTOP_JSON_SECRET_KEY)"
        if [[ ! "$key" =~ ^[[:xdigit:]]{32}$ ]]; then
          command -v openssl >/dev/null || { echo "openssl is required to generate the Remote desktop service key." >&2; continue; }
          set_env_value REMOTE_DESKTOP_JSON_SECRET_KEY "$(openssl rand -hex 16)"
        fi
        set_env_value SMART_CHURCH_REMOTE_DESKTOP_MODULE_INSTALLED 1
        build_compose_args
        if ! run_compose pull remote-desktop-module; then
          if [[ "$(env_value SMART_CHURCH_USE_REMOTE_DESKTOP)" != 1 ]]; then
            set_env_value SMART_CHURCH_REMOTE_DESKTOP_MODULE_INSTALLED 0
          fi
          build_compose_args
          echo "Could not download the Remote desktop images for version $(env_value SMART_CHURCH_VERSION). Confirm that this version has finished building, then retry." >&2
          continue
        fi
        set_env_value SMART_CHURCH_USE_REMOTE_DESKTOP 1
        set_module_enabled "$department_id" remote-desktop true || return 1
        build_compose_args
        run_compose up -d || return 1
        run_compose restart api || return 1
        remote_desktop_state=enabled
        echo "Remote desktop enabled for $department_name. Configure its RDP target in module settings if needed."
        ;;
      enable:presenter)
        set_module_enabled "$department_id" presenter true || return 1
        presenter_state=enabled
        echo "Presenter enabled for $department_name. Configure its content in the Smart-Church web app."
        ;;
      disable:video-steffisburg)
        set_module_enabled "$department_id" video-steffisburg false || return 1
        set_env_value SMART_CHURCH_VIDEO_STEFFISBURG_ENABLED 0
        unset_env_value SMART_CHURCH_STREAMING_CONFIG_PATH
        build_compose_args
        run_compose up -d api || return 1
        video_state=disabled
        echo "Video & streaming disabled for $department_name. Its settings remain in .env."
        ;;
      disable:amx)
        set_module_enabled "$department_id" amx false || return 1
        run_compose restart api || return 1
        amx_state=disabled
        echo "AMX disabled for $department_name. Its images and settings remain installed so it can be enabled again."
        ;;
      disable:remote-desktop)
        set_module_enabled "$department_id" remote-desktop false || return 1
        if [[ "$(env_value SMART_CHURCH_USE_REMOTE_DESKTOP)" == 1 ]]; then
          run_compose stop remote-desktop-guacamole remote-desktop-guacd || return 1
          set_env_value SMART_CHURCH_USE_REMOTE_DESKTOP 0
          build_compose_args
        fi
        run_compose restart api || return 1
        remote_desktop_state=disabled
        echo "Remote desktop disabled for $department_name. Its settings remain in .env."
        ;;
      disable:presenter)
        set_module_enabled "$department_id" presenter false || return 1
        presenter_state=disabled
        echo "Presenter disabled for $department_name. Its settings and content remain available if re-enabled."
        ;;
      settings:video-steffisburg) configure_video_settings || true ;;
      settings:*) configure_module_settings "${action#settings:}" "$department_id" || true ;;
      settings:presenter) echo "Presenter content is managed in Smart-Church under the Presenter module." ;;
      *) echo "Choose an available module action." >&2 ;;
    esac
  done
}

choose_action() {
  local selection="" status action health
  while true; do
    health="$(manager_health_summary)"
    if [[ -n "${TERM:-}" && "$TERM" != dumb ]]; then printf '\033[H\033[2J' >/dev/tty; fi
    {
      printf 'Smart-Church Manager\n%s\n\n' "$(manager_version_label)"
      printf 'Live health · refreshes every 5 seconds\n  %s\n\n' "$health"
      printf ' 1) Health details          2) Network settings\n'
      printf ' 3) Select branch           4) Modules\n'
      printf ' 5) Service status          6) Start services\n'
      printf ' 7) Stop services           8) Restart services\n'
      printf ' 9) Follow logs            10) Create backup\n'
      printf '11) Restore backup         12) Update Smart-Church\n'
      printf '13) Uninstall              14) Exit\n\n'
    } >/dev/tty
    if IFS= read -e -r -t 5 -i "$selection" -p 'Select an operation: ' selection </dev/tty; then
      case "$selection" in
        1|health) action=health ;; 2|network) action=network ;; 3|branch) action=branch ;;
        4|modules) action=modules ;; 5|status) action=status ;; 6|start) action=start ;;
        7|stop) action=stop ;; 8|restart) action=restart ;; 9|logs) action=logs ;;
        10|backup) action=backup ;; 11|restore) action=restore ;; 12|update) action=update ;;
        13|uninstall) action=uninstall ;; 14|exit) action=exit ;;
        *) printf '\nChoose an operation from 1 to 14.\n' >/dev/tty; selection=""; sleep 1; continue ;;
      esac
      printf '%s' "$action"
      return 0
    else
      status=$?
      if (( status > 128 )); then continue; fi
      return 1
    fi
  done
}

while true; do
  action="$(choose_action)" || exit 0
  case "$action" in
    health)
      run_compose ps
      run_compose exec -T db sh -ec 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
      run_compose exec -T api node -e "fetch('http://127.0.0.1:3001/api/health').then(async response => { const body = await response.json(); if (!response.ok || body.status !== 'ok') process.exit(1); console.log('API: healthy') }).catch(() => process.exit(1))"
      run_compose exec -T api node -e "fetch('http://127.0.0.1:3001/').then(response => { if (!response.ok) process.exit(1); console.log('Direct HTTP service: healthy') }).catch(() => process.exit(1))"
      if grep -q '^SMART_CHURCH_DIRECT_HTTP=1' .env; then
        domain="$(env_value SMART_CHURCH_DOMAIN)"
        port="$(env_value SMART_CHURCH_DIRECT_HTTP_PORT)"
        echo "Direct HTTP: http://$domain:${port:-81}"
      else
        run_compose exec -T web node -e "fetch('http://127.0.0.1:8080/').then(response => { if (!response.ok) process.exit(1); console.log('Web UI: healthy') }).catch(() => process.exit(1))"
        domain="$(env_value SMART_CHURCH_DOMAIN)"
        port="$(env_value SMART_CHURCH_DIRECT_HTTP_PORT)"
        echo "Direct HTTP fallback: http://$domain:${port:-81}"
      fi
      ;;
    network)
      direct_bind_address="$(env_value SMART_CHURCH_DIRECT_HTTP_BIND_ADDRESS)"
      direct_port="$(env_value SMART_CHURCH_DIRECT_HTTP_PORT)"
      read -r -p "Direct HTTP bind IPv4 address [${direct_bind_address:-0.0.0.0}]: " new_direct_bind </dev/tty
      read -r -p "Direct HTTP fallback port [${direct_port:-81}]: " new_direct_port </dev/tty
      new_direct_bind="${new_direct_bind:-${direct_bind_address:-0.0.0.0}}"
      new_direct_port="${new_direct_port:-${direct_port:-81}}"
      valid_ipv4 "$new_direct_bind" || { echo "Enter an IPv4 address (0.0.0.0 binds all interfaces)." >&2; exit 1; }
      valid_port "$new_direct_port" || { echo "Enter a port from 1 to 65535." >&2; exit 1; }
      set_env_value SMART_CHURCH_DIRECT_HTTP_BIND_ADDRESS "$new_direct_bind"
      set_env_value SMART_CHURCH_DIRECT_HTTP_PORT "$new_direct_port"
      if grep -q '^SMART_CHURCH_DIRECT_HTTP=1' .env; then
        domain="$(env_value SMART_CHURCH_DOMAIN)"
        [[ -n "$domain" ]] || { echo "SMART_CHURCH_DOMAIN is missing from .env." >&2; exit 1; }
        if [[ "$new_direct_port" == 80 ]]; then
          set_env_value SMART_CHURCH_WEB_ORIGIN "http://$domain"
        else
          set_env_value SMART_CHURCH_WEB_ORIGIN "http://$domain:$new_direct_port"
        fi
      else
        bind_address="$(env_value SMART_CHURCH_HTTPS_BIND_ADDRESS)"
        http_port="$(env_value SMART_CHURCH_HTTP_PORT)"
        https_port="$(env_value SMART_CHURCH_HTTPS_PORT)"
        read -r -p "Bind IPv4 address [${bind_address:-0.0.0.0}]: " new_bind </dev/tty
        read -r -p "HTTP port [${http_port:-80}]: " new_http_port </dev/tty
        read -r -p "HTTPS port [${https_port:-443}]: " new_https_port </dev/tty
        new_bind="${new_bind:-${bind_address:-0.0.0.0}}"
        new_http_port="${new_http_port:-${http_port:-80}}"
        new_https_port="${new_https_port:-${https_port:-443}}"
        valid_ipv4 "$new_bind" || { echo "Enter an IPv4 address (0.0.0.0 binds all interfaces)." >&2; exit 1; }
        valid_port "$new_http_port" && valid_port "$new_https_port" || { echo "Enter ports from 1 to 65535." >&2; exit 1; }
        [[ "$new_http_port" != "$new_https_port" ]] || { echo "HTTP and HTTPS must use different ports." >&2; exit 1; }
        [[ "$new_direct_port" != "$new_http_port" && "$new_direct_port" != "$new_https_port" ]] || { echo "The direct HTTP fallback port must differ from the proxy ports." >&2; exit 1; }
        set_env_value SMART_CHURCH_HTTPS_BIND_ADDRESS "$new_bind"
        set_env_value SMART_CHURCH_HTTP_PORT "$new_http_port"
        set_env_value SMART_CHURCH_HTTPS_PORT "$new_https_port"
        domain="$(env_value SMART_CHURCH_DOMAIN)"
        [[ -n "$domain" ]] || { echo "SMART_CHURCH_DOMAIN is missing from .env." >&2; exit 1; }
        if [[ "$new_https_port" == 443 ]]; then
          set_env_value SMART_CHURCH_WEB_ORIGIN "https://$domain"
        else
          set_env_value SMART_CHURCH_WEB_ORIGIN "https://$domain:$new_https_port"
        fi
      fi
      run_compose up -d
      echo "Network settings applied."
      ;;
    branch)
      branch="$(select_update_branch)" || branch=cancel
      case "$branch" in
        main|beta|dev)
          set_env_value SMART_CHURCH_UPDATE_BRANCH "$branch"
          force_update_branch "$branch"
          ;;
        cancel) ;;
        *) echo "Choose main, beta, dev, or cancel." >&2; exit 1 ;;
      esac
      ;;
    modules) module_manager ;;
    status) run_compose ps ;;
    start) run_compose up -d ;;
    stop) run_compose stop ;;
    restart) run_compose restart ;;
    logs) run_compose logs --tail=200 --follow ;;
    backup) bash ./deploy/backup.sh ;;
    restore)
      backup_path="$(select_backup_path)" || continue
      bash ./deploy/restore.sh "$backup_path"
      ;;
    update)
      read -r -p "Release version to install [latest; current $(env_value SMART_CHURCH_VERSION)]: " version </dev/tty
      version="${version:-latest}"
      current_version="$(env_value SMART_CHURCH_VERSION)"
      target_version="$version"
      if [[ "$version" == latest ]]; then
        latest_tag="$(curl -fsSL --retry 3 https://api.github.com/repos/juristoeckli/smart-Church/releases/latest \
          | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
        [[ -n "$latest_tag" ]] || { echo "Could not resolve the latest Smart-Church release." >&2; break; }
        target_version="${latest_tag#v}"
      fi
      if [[ "$target_version" == "${current_version#v}" ]]; then
        echo "Smart-Church is already at version $target_version; nothing to update."
      else
        bash ./deploy/update.sh "$version"
      fi
      ;;
    uninstall) bash ./deploy/uninstall.sh; exit ;;
    exit) exit 0 ;;
    *) echo "Unknown manager operation: $action" >&2; exit 1 ;;
  esac
  read -r -p "Press Enter to return to the menu..." _ </dev/tty
done
