#!/usr/bin/env bash
set -Eeuo pipefail

install_dir="${SMART_CHURCH_INSTALL_DIR:-/opt/smart-church}"
if [[ "$install_dir" != /* ]]; then
  echo "SMART_CHURCH_INSTALL_DIR must be an absolute path." >&2
  exit 1
fi
if [[ -L "$install_dir" ]]; then
  echo "Refusing to uninstall through a symlink: $install_dir" >&2
  exit 1
fi
install_dir="$(realpath -m -- "$install_dir")"
case "$install_dir" in
  /|/opt|/home|/root|/usr|/var|/etc|/tmp|/mnt|/media)
    echo "Refusing to remove a system directory: $install_dir" >&2
    exit 1
    ;;
esac

if [[ ! -e "$install_dir" && ! -L "$install_dir" ]]; then
  echo "No Smart-Church installation found at $install_dir."
  exit 0
fi
if [[ ! -f "$install_dir/compose.yaml" ]]; then
  echo "No Smart-Church compose.yaml found at $install_dir; refusing to remove this directory." >&2
  exit 1
fi
if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run with sudo to stop the services and remove $install_dir." >&2
  exit 1
fi
command -v docker >/dev/null || { echo "Docker is required to remove the Smart-Church containers and volumes." >&2; exit 1; }
docker compose version >/dev/null || { echo "The Docker Compose plugin is required." >&2; exit 1; }
[[ -r /dev/tty ]] || { echo "Run this command from an interactive terminal so you can confirm deletion." >&2; exit 1; }

echo "This permanently deletes the Smart-Church database, uploaded files, Caddy certificates, backups, secrets, and configuration in:"
echo "  $install_dir"
echo "Docker images will remain cached on this server."
read -r -p "Type DELETE $install_dir to continue: " confirmation </dev/tty
[[ "$confirmation" == "DELETE $install_dir" ]] || { echo "Uninstall cancelled."; exit 1; }

cd "$install_dir"
compose_files=(-f compose.yaml)
if [[ -f apps/api/src/modules/video-steffisburg/compose.yaml ]] && grep -q '^SMART_CHURCH_STREAMING_CONFIG_PATH=' .env 2>/dev/null; then
  compose_files+=(-f apps/api/src/modules/video-steffisburg/compose.yaml)
fi
if [[ ! -f .env ]]; then
  export POSTGRES_USER=uninstall POSTGRES_PASSWORD=uninstall POSTGRES_DB=uninstall
  export SMART_CHURCH_STREAMING_CONFIG_PATH=/dev/null
fi
docker compose "${compose_files[@]}" --profile bundled-proxy down --volumes --remove-orphans

rm -rf -- "$install_dir"
echo "Smart-Church has been removed from $install_dir."
