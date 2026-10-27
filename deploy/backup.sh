#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
[[ -f .env ]] || { echo "Missing .env; run deploy/install.sh first." >&2; exit 1; }
api_container="$(docker compose ps --status running -q api)"
[[ -n "$api_container" ]] || { echo "The API container is not running." >&2; exit 1; }
volume_name="$(docker inspect "$api_container" --format '{{range .Mounts}}{{if eq .Destination "/var/lib/smart-church"}}{{.Name}}{{end}}{{end}}')"
[[ -n "$volume_name" ]] || { echo "Could not locate the Smart-Church data volume." >&2; exit 1; }

umask 077
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="$root/backups/$stamp"
mkdir -p "$backup_dir"
api_was_running=1
restart_api() {
  if [[ "$api_was_running" -eq 1 ]]; then docker compose start api >/dev/null || true; fi
}
trap restart_api EXIT

docker compose stop api >/dev/null
docker compose exec -T db sh -ec 'pg_dump --format=custom --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' > "$backup_dir/database.dump"
docker run --rm -v "$volume_name:/data:ro" -v "$backup_dir:/backup" alpine:3.22 \
  tar -czf "/backup/storage.tar.gz" -C /data .
printf 'Smart-Church backup\nCreated UTC: %s\nVersion: %s\n' "$stamp" "$(grep '^SMART_CHURCH_VERSION=' .env | cut -d= -f2- || true)" > "$backup_dir/README.txt"
api_was_running=0
docker compose start api >/dev/null
echo "Backup created: $backup_dir"
echo "Encrypt it before copying it off this server."
