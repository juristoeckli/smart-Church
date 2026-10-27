#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
backup_dir="${1:-}"
[[ -n "$backup_dir" && -d "$backup_dir" ]] || { echo "Usage: $0 /absolute/path/to/backup-directory" >&2; exit 1; }
backup_dir="$(cd -- "$backup_dir" && pwd)"
[[ -f "$backup_dir/database.dump" && -f "$backup_dir/storage.tar.gz" ]] || { echo "Backup must contain database.dump and storage.tar.gz." >&2; exit 1; }
[[ -f .env ]] || { echo "Missing .env; restore into a configured Smart-Church installation." >&2; exit 1; }
api_container="$(docker compose ps -q api)"
[[ -n "$api_container" ]] || { echo "The API container must exist before restoring." >&2; exit 1; }
volume_name="$(docker inspect "$api_container" --format '{{range .Mounts}}{{if eq .Destination "/var/lib/smart-church"}}{{.Name}}{{end}}{{end}}')"
[[ -n "$volume_name" ]] || { echo "Could not locate the Smart-Church data volume." >&2; exit 1; }

echo "This replaces the live database and all files in the Smart-Church data volume."
read -r -p "Type RESTORE to continue: " confirmation
[[ "$confirmation" == RESTORE ]] || { echo "Restore cancelled."; exit 1; }

docker compose stop api
docker compose exec -T db sh -ec 'pg_restore --clean --if-exists --no-owner --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" -' < "$backup_dir/database.dump"
docker run --rm -v "$volume_name:/data" -v "$backup_dir:/backup:ro" alpine:3.22 sh -ec \
  'find /data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +; tar -xzf /backup/storage.tar.gz -C /data; chown -R 1000:1000 /data'
docker compose start api
echo "Restore complete. Check services with: docker compose ps"
