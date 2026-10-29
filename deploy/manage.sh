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
  if [[ -f apps/api/src/modules/video-steffisburg/compose.yaml ]] && grep -q '^SMART_CHURCH_STREAMING_CONFIG_PATH=' .env; then
    compose_files+=(-f apps/api/src/modules/video-steffisburg/compose.yaml)
  fi
  if [[ -f apps/api/src/modules/remote-desktop/compose.yaml ]] && grep -q '^SMART_CHURCH_USE_SYSTEM_LAPTOP=1' .env; then
    compose_files+=(-f apps/api/src/modules/remote-desktop/compose.yaml)
  fi
  compose_args=("${compose_files[@]}")
  if grep -q '^SMART_CHURCH_USE_BUNDLED_PROXY=1' .env; then
    compose_args+=(--profile bundled-proxy)
  fi
  if grep -q '^SMART_CHURCH_USE_SYSTEM_LAPTOP=1' .env; then
    compose_args+=(--profile system-laptop)
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
  command -v curl >/dev/null || { echo "curl is required to resolve the selected branch." >&2; return 1; }
  commit_sha="$(curl -fsSL --retry 3 -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/juristoeckli/smart-Church/commits/$branch" \
    | sed -n 's/^[[:space:]]*{"sha":[[:space:]]*"\([0-9a-f]\{40\}\)".*/\1/p; s/^[[:space:]]*"sha":[[:space:]]*"\([0-9a-f]\{40\}\)".*/\1/p' | head -n 1)"
  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] || { echo "Could not resolve the latest $branch commit from GitHub." >&2; return 1; }
  for image in smart-church-api smart-church-web; do
    if ! docker manifest inspect "ghcr.io/juristoeckli/$image:$commit_sha" >/dev/null 2>&1; then
      echo "The $branch images for commit $commit_sha are not published yet. Wait for the branch image build to finish, then retry." >&2
      return 0
    fi
  done
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
  case "$module_id" in video-steffisburg|remote-desktop|presenter) ;; *) return 2 ;; esac
  [[ "$department_id" =~ ^[0-9a-fA-F-]{36}$ ]] || { echo "The primary location ID is missing or invalid." >&2; return 1; }
  query="SELECT '$module_id' = ANY(enabled_modules) FROM departments WHERE id = '$department_id'::uuid"
  result="$(run_compose exec -T db sh -ec 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "$1"' sh "$query" | tr -d '\r')"
  [[ "$result" == t ]]
}

set_module_enabled() {
  local department_id="$1" module_id="$2" desired="$3" query result expected
  case "$module_id" in video-steffisburg|remote-desktop|presenter) ;; *) return 2 ;; esac
  [[ "$department_id" =~ ^[0-9a-fA-F-]{36}$ ]] || { echo "The primary location ID is missing or invalid." >&2; return 1; }
  [[ "$desired" == true || "$desired" == false ]] || return 2
  query="UPDATE departments SET enabled_modules = CASE WHEN $desired AND NOT ('$module_id' = ANY(enabled_modules)) THEN array_append(enabled_modules, '$module_id') WHEN NOT $desired THEN array_remove(enabled_modules, '$module_id') ELSE enabled_modules END, updated_at = now() WHERE id = '$department_id'::uuid RETURNING '$module_id' = ANY(enabled_modules)"
  result="$(run_compose exec -T db sh -ec 'psql -v ON_ERROR_STOP=1 -qAt -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1"' sh "$query" | tr -d '\r')"
  expected=t
  [[ "$desired" == false ]] && expected=f
  [[ "$result" == "$expected" ]] || {
    echo "Could not set $module_id to $desired for location $department_id (database verification returned '${result:-no row}')." >&2
    return 1
  }
}

select_module() {
  local video_state="$1" laptop_state="$2" presenter_state="$3" choice
  if command -v whiptail >/dev/null; then
    choice="$(whiptail --title "Smart-Church Modules" --menu "Optional modules for $(env_value SMART_CHURCH_DEPARTMENT_NAME). Modules are included in the Smart-Church deployment." 17 78 4 \
      video-steffisburg "Video & streaming — $video_state" \
      remote-desktop "Remote desktop — $laptop_state" \
      presenter "Presenter — $presenter_state" \
      back "Return" 3>&1 1>&2 2>&3)" || return 1
  elif command -v dialog >/dev/null; then
    choice="$(dialog --title "Smart-Church Modules" --menu "Optional modules for $(env_value SMART_CHURCH_DEPARTMENT_NAME). Modules are included in the Smart-Church deployment." 17 78 4 \
      video-steffisburg "Video & streaming — $video_state" \
      remote-desktop "Remote desktop — $laptop_state" \
      presenter "Presenter — $presenter_state" \
      back "Return" 3>&1 1>&2 2>&3)" || return 1
  else
    echo "Optional modules for $(env_value SMART_CHURCH_DEPARTMENT_NAME): Video & streaming [$video_state], Remote desktop [$laptop_state], Presenter [$presenter_state]" >/dev/tty
    select choice in video-steffisburg remote-desktop presenter back; do
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

module_manager() {
  local department_id department_name video_state laptop_state presenter_state action module_id key
  department_id="$(env_value SMART_CHURCH_DEPARTMENT_ID)"
  department_name="$(env_value SMART_CHURCH_DEPARTMENT_NAME)"
  [[ "$department_id" =~ ^[0-9a-fA-F-]{36}$ ]] || { echo "SMART_CHURCH_DEPARTMENT_ID is missing or invalid in .env." >&2; return 1; }
  run_compose exec -T db sh -ec 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null || {
    echo "Start the Smart-Church database before managing modules." >&2
    return 1
  }
  video_state=disabled
  laptop_state=disabled
  presenter_state=disabled
  module_enabled "$department_id" video-steffisburg && video_state=enabled
  module_enabled "$department_id" remote-desktop && laptop_state=enabled
  module_enabled "$department_id" presenter && presenter_state=enabled

  while true; do
    if command -v whiptail >/dev/null; then
      action="$(whiptail --title "Smart-Church Module Manager" --menu "Primary location: ${department_name:-not configured}. Install enables a bundled module for this location; disable keeps its settings." 16 78 4 \
        enable "Install / enable module" \
        disable "Disable module" \
        settings "Change module settings" \
        back "Return to manager" 3>&1 1>&2 2>&3)" || return 0
    elif command -v dialog >/dev/null; then
      action="$(dialog --title "Smart-Church Module Manager" --menu "Primary location: ${department_name:-not configured}. Install enables a bundled module for this location; disable keeps its settings." 16 78 4 \
        enable "Install / enable module" \
        disable "Disable module" \
        settings "Change module settings" \
        back "Return to manager" 3>&1 1>&2 2>&3)" || return 0
    else
      echo "Primary location: ${department_name:-not configured}; Video & streaming: $video_state; Remote desktop: $laptop_state; Presenter: $presenter_state" >/dev/tty
      select action in enable disable settings back; do
        [[ -n "${action:-}" ]] && break
        echo "Choose a number from the menu." >/dev/tty
      done </dev/tty >/dev/tty
    fi
    [[ "$action" == back ]] && return 0
    module_id="$(select_module "$video_state" "$laptop_state" "$presenter_state")" || continue
    [[ "$module_id" == back ]] && continue
    case "$action:$module_id" in
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
        key="$(env_value SYSTEM_LAPTOP_JSON_SECRET_KEY)"
        if [[ ! "$key" =~ ^[[:xdigit:]]{32}$ ]]; then
          command -v openssl >/dev/null || { echo "openssl is required to generate the Remote desktop service key." >&2; continue; }
          set_env_value SYSTEM_LAPTOP_JSON_SECRET_KEY "$(openssl rand -hex 16)"
        fi
        set_env_value SMART_CHURCH_USE_SYSTEM_LAPTOP 1
        set_module_enabled "$department_id" remote-desktop true || return 1
        build_compose_args
        run_compose up -d || return 1
        laptop_state=enabled
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
      disable:remote-desktop)
        set_module_enabled "$department_id" remote-desktop false || return 1
        if [[ "$(env_value SMART_CHURCH_USE_SYSTEM_LAPTOP)" == 1 ]]; then
          run_compose stop system-laptop-guacamole system-laptop-guacd || return 1
          set_env_value SMART_CHURCH_USE_SYSTEM_LAPTOP 0
          build_compose_args
        fi
        laptop_state=disabled
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
  local action prompt
  prompt="$(manager_version_label)"
  prompt+=$'\nChoose an operation'
  if command -v whiptail >/dev/null; then
    action="$(whiptail --title "Smart-Church Manager" --menu "$prompt" 24 78 13 \
      health "Check database, API and web health" \
      network "Manage listening ports and interface" \
      branch "Select branch and update" \
      modules "Install, enable, disable and configure modules" \
      status "Show service status" \
      start "Start services" \
      stop "Stop services" \
      restart "Restart services" \
      logs "Follow service logs" \
      backup "Create a backup" \
      restore "Restore a backup" \
      update "Update Smart-Church" \
      uninstall "Uninstall Smart-Church" \
      exit "Exit" 3>&1 1>&2 2>&3)" || return 1
  elif command -v dialog >/dev/null; then
    action="$(dialog --title "Smart-Church Manager" --menu "$prompt" 24 78 13 \
      health "Check database, API and web health" \
      network "Manage listening ports and interface" \
      branch "Select branch and update" \
      modules "Install, enable, disable and configure modules" \
      status "Show service status" \
      start "Start services" \
      stop "Stop services" \
      restart "Restart services" \
      logs "Follow service logs" \
      backup "Create a backup" \
      restore "Restore a backup" \
      update "Update Smart-Church" \
      uninstall "Uninstall Smart-Church" \
      exit "Exit" 3>&1 1>&2 2>&3)" || return 1
  else
    echo >/dev/tty
    echo "Smart-Church Manager" >/dev/tty
    echo "$prompt" >/dev/tty
    echo "Install whiptail or dialog for a graphical terminal menu." >/dev/tty
    select action in health network branch modules status start stop restart logs backup restore update uninstall exit; do
      [[ -n "${action:-}" ]] && break
      echo "Choose a number from the menu." >/dev/tty
    done </dev/tty >/dev/tty
  fi
  printf '%s' "$action"
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
      read -r -p "Absolute path to backup directory: " backup_path </dev/tty
      [[ -n "$backup_path" ]] && bash ./deploy/restore.sh "$backup_path"
      ;;
    update)
      read -r -p "Release version to install [latest; current $(env_value SMART_CHURCH_VERSION)]: " version </dev/tty
      bash ./deploy/update.sh "${version:-latest}"
      ;;
    uninstall) bash ./deploy/uninstall.sh; exit ;;
    exit) exit 0 ;;
    *) echo "Unknown manager operation: $action" >&2; exit 1 ;;
  esac
  read -r -p "Press Enter to return to the menu..." _ </dev/tty
done
