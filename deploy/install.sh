#!/usr/bin/env bash
set -Eeuo pipefail

repository="juristoeckli/smart-Church"
install_dir="${SMART_CHURCH_INSTALL_DIR:-/opt/smart-church}"

if [[ ! -f compose.yaml ]]; then
  script_dir=""
  if [[ -f "${BASH_SOURCE[0]:-}" ]]; then
    script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
  fi
  if [[ -n "$script_dir" && -f "$script_dir/../compose.yaml" ]]; then
    cd "$script_dir/.."
  else
    if [[ "$(id -u)" -ne 0 ]]; then
      echo "Run with sudo so the release can be installed in $install_dir." >&2
      exit 1
    fi
    command -v curl >/dev/null || { echo "Install curl, then retry." >&2; exit 1; }
    command -v tar >/dev/null || { echo "Install tar, then retry." >&2; exit 1; }
    command -v docker >/dev/null || { echo "Install Docker Engine and the Docker Compose plugin, then retry." >&2; exit 1; }
    docker compose version >/dev/null || { echo "The Docker Compose plugin is required." >&2; exit 1; }
    version="${SMART_CHURCH_VERSION:-latest}"
    if [[ "$version" == "latest" ]]; then
      version="$(curl -fsSL "https://api.github.com/repos/$repository/releases/latest" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
    fi
    [[ "$version" =~ ^v?[A-Za-z0-9._-]+$ ]] || { echo "Could not resolve a valid Smart-Church release tag." >&2; exit 1; }
    version="${version#v}"
    mkdir -p "$install_dir"
    archive="$(mktemp)"
    trap 'rm -f "$archive"' EXIT
    curl -fsSL --retry 3 "https://github.com/$repository/releases/download/v$version/smart-church-deploy.tar.gz" -o "$archive"
    tar -xzf "$archive" -C "$install_dir"
    cd "$install_dir"
  fi
fi

root="$(pwd)"
command -v docker >/dev/null || { echo "Install Docker Engine and the Docker Compose plugin, then retry." >&2; exit 1; }
docker compose version >/dev/null || { echo "The Docker Compose plugin is required." >&2; exit 1; }
command -v openssl >/dev/null || { echo "Install openssl, then retry." >&2; exit 1; }
[[ -r /dev/tty ]] || { echo "Run this command from an interactive terminal so the installer can ask for your domain and location." >&2; exit 1; }
[[ "$(uname -m)" == "x86_64" ]] || { echo "This release currently supports Linux x86_64 servers." >&2; exit 1; }
[[ -f "$root/compose.yaml" && -f "$root/deploy/Caddyfile" ]] || { echo "Run this from a Smart-Church deployment package." >&2; exit 1; }
[[ ! -e "$root/.env" ]] || { echo "A .env already exists at $root. Keep it and use deploy/update.sh instead." >&2; exit 1; }

read -r -p "Public domain name (DNS must point here; ports 80/443 must be open): " domain </dev/tty
[[ "$domain" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || { echo "Enter a public DNS name such as church.example.org." >&2; exit 1; }
read -r -p "Church location name [My Church]: " location </dev/tty
location="${location:-My Church}"
read -r -p "Release version [${SMART_CHURCH_VERSION:-latest}]: " version </dev/tty
version="${version:-${SMART_CHURCH_VERSION:-latest}}"
[[ "$version" == "latest" || "$version" =~ ^v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$ ]] || { echo "Use a semantic release version such as 1.2.3 or latest." >&2; exit 1; }
version="${version#v}"

db_password="$(openssl rand -hex 24)"
sync_key="$(openssl rand -hex 32)"
department_id="$(cat /proc/sys/kernel/random/uuid)"
cat > "$root/.env" <<EOF
POSTGRES_USER=smart_church
POSTGRES_PASSWORD=$db_password
POSTGRES_DB=smart_church
SMART_CHURCH_DATABASE_URL=postgresql://smart_church:$db_password@db:5432/smart_church
SMART_CHURCH_WEB_ORIGIN=https://$domain
SMART_CHURCH_DOMAIN=$domain
SMART_CHURCH_TRUST_PROXY=172.30.250.2
SMART_CHURCH_DOCKER_SUBNET=172.30.250.0/24
SMART_CHURCH_PROXY_IP=172.30.250.2
SMART_CHURCH_DEPARTMENT_ID=$department_id
SMART_CHURCH_DEPARTMENT_NAME=$location
SMART_CHURCH_SYNC_ENCRYPTION_KEY=$sync_key
SMART_CHURCH_VERSION=$version
SMART_CHURCH_USE_BUNDLED_PROXY=1
EOF
chmod 600 "$root/.env"
mkdir -p "$root/backups"
chmod 700 "$root/backups"

cd "$root"
docker compose --profile bundled-proxy pull
docker compose --profile bundled-proxy up -d

setup_code=""
for _ in $(seq 1 60); do
  setup_code="$(docker compose --profile bundled-proxy logs --no-color --tail=100 api 2>/dev/null | sed -n 's/.*"setupCode":"\([^"]*\)".*/\1/p' | tail -n 1)"
  [[ -n "$setup_code" ]] && break
  sleep 2
done

echo
echo "Smart-Church is starting at https://$domain"
if [[ -n "$setup_code" ]]; then
  echo "First-run setup code: $setup_code"
  echo "Enter it in the browser to create the first Server Administrator."
else
  echo "The first-run code is not in the recent logs yet. Read it with: docker compose --profile bundled-proxy logs api"
fi
echo "Save the generated database and sync secrets in the protected .env file."
echo "Back up with: ./deploy/backup.sh"
