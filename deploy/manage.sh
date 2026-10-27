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
    select choice in install exit </dev/tty >/dev/tty; do
      [[ -n "${choice:-}" ]] && break
    done
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
command -v docker >/dev/null || { echo "Docker is required to manage Smart-Church." >&2; exit 1; }
docker compose version >/dev/null || { echo "The Docker Compose plugin is required." >&2; exit 1; }

compose_files=(-f compose.yaml)
if grep -q '^SMART_CHURCH_DIRECT_HTTP=1' .env; then
  compose_files+=(-f deploy/compose.direct.yaml)
fi
if [[ -f apps/api/src/modules/video-steffisburg/compose.yaml ]] && grep -q '^SMART_CHURCH_STREAMING_CONFIG_PATH=' .env; then
  compose_files+=(-f apps/api/src/modules/video-steffisburg/compose.yaml)
fi
compose_args=("${compose_files[@]}")
if grep -q '^SMART_CHURCH_USE_BUNDLED_PROXY=1' .env; then
  compose_args+=(--profile bundled-proxy)
fi

run_compose() {
  docker compose "${compose_args[@]}" "$@"
}

env_value() {
  sed -n "s/^$1=//p" .env | tail -n 1
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
    select branch in main beta dev cancel </dev/tty >/dev/tty; do
      [[ -n "${branch:-}" ]] && break
    done
  fi
  printf '%s' "$branch"
}

force_update_branch() {
  local branch="$1" commit_sha image
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
  bash ./deploy/update.sh "$commit_sha"
}

choose_action() {
  local action
  if command -v whiptail >/dev/null; then
    action="$(whiptail --title "Smart-Church Manager" --menu "Choose an operation" 22 78 13 \
      health "Check database, API and web health" \
      network "Manage listening ports and interface" \
      branch "Select branch and update" \
      force "Force update selected branch" \
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
    action="$(dialog --title "Smart-Church Manager" --menu "Choose an operation" 22 78 13 \
      health "Check database, API and web health" \
      network "Manage listening ports and interface" \
      branch "Select branch and update" \
      force "Force update selected branch" \
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
    echo "Install whiptail or dialog for a graphical terminal menu." >/dev/tty
    select action in health network branch force status start stop restart logs backup restore update uninstall exit </dev/tty >/dev/tty; do
      [[ -n "${action:-}" ]] && break
      echo "Choose a number from the menu." >/dev/tty
    done
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
      if grep -q '^SMART_CHURCH_DIRECT_HTTP=1' .env; then
        run_compose exec -T api node -e "fetch('http://127.0.0.1:3001/').then(response => { if (!response.ok) process.exit(1); console.log('Web UI: healthy') }).catch(() => process.exit(1))"
      else
        run_compose exec -T web node -e "fetch('http://127.0.0.1:8080/').then(response => { if (!response.ok) process.exit(1); console.log('Web UI: healthy') }).catch(() => process.exit(1))"
      fi
      ;;
    network)
      if grep -q '^SMART_CHURCH_DIRECT_HTTP=1' .env; then
        bind_address="$(env_value SMART_CHURCH_DIRECT_HTTP_BIND_ADDRESS)"
        port="$(env_value SMART_CHURCH_DIRECT_HTTP_PORT)"
        read -r -p "Bind IPv4 address [${bind_address:-0.0.0.0}]: " new_bind </dev/tty
        read -r -p "Direct HTTP port [${port:-81}]: " new_port </dev/tty
        new_bind="${new_bind:-${bind_address:-0.0.0.0}}"
        new_port="${new_port:-${port:-81}}"
        valid_ipv4 "$new_bind" || { echo "Enter an IPv4 address (0.0.0.0 binds all interfaces)." >&2; exit 1; }
        valid_port "$new_port" || { echo "Enter a port from 1 to 65535." >&2; exit 1; }
        set_env_value SMART_CHURCH_DIRECT_HTTP_BIND_ADDRESS "$new_bind"
        set_env_value SMART_CHURCH_DIRECT_HTTP_PORT "$new_port"
        domain="$(env_value SMART_CHURCH_DOMAIN)"
        [[ -n "$domain" ]] || { echo "SMART_CHURCH_DOMAIN is missing from .env." >&2; exit 1; }
        if [[ "$new_port" == 80 ]]; then
          set_env_value SMART_CHURCH_WEB_ORIGIN "http://$domain"
        else
          set_env_value SMART_CHURCH_WEB_ORIGIN "http://$domain:$new_port"
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
    force) force_update_branch "$(env_value SMART_CHURCH_UPDATE_BRANCH)" ;;
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
      read -r -p "Release version [latest]: " version </dev/tty
      bash ./deploy/update.sh "${version:-latest}"
      ;;
    uninstall) bash ./deploy/uninstall.sh; exit ;;
    exit) exit 0 ;;
    *) echo "Unknown manager operation: $action" >&2; exit 1 ;;
  esac
  read -r -p "Press Enter to return to the menu..." _ </dev/tty
done
