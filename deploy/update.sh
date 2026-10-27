#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
[[ -f .env ]] || { echo "Missing .env; run deploy/install.sh first." >&2; exit 1; }
version="${1:-latest}"
[[ "$version" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "Use a release version such as 1.2.3 or latest." >&2; exit 1; }
version="${version#v}"

bash ./deploy/backup.sh
tmp="$(mktemp .env.XXXXXX)"
trap 'rm -f "$tmp"' EXIT
awk -v version="$version" '
  BEGIN { found = 0 }
  /^SMART_CHURCH_VERSION=/ { print "SMART_CHURCH_VERSION=" version; found = 1; next }
  { print }
  END { if (!found) print "SMART_CHURCH_VERSION=" version }
' .env > "$tmp"
chmod 600 "$tmp"
mv "$tmp" .env
trap - EXIT

compose_files=(-f compose.yaml)
if [[ -f apps/api/src/modules/video-steffisburg/compose.yaml ]] && grep -q '^SMART_CHURCH_STREAMING_CONFIG_PATH=' .env; then
  compose_files+=(-f apps/api/src/modules/video-steffisburg/compose.yaml)
fi
profile_args=()
if grep -q '^SMART_CHURCH_USE_BUNDLED_PROXY=1' .env; then profile_args+=(--profile bundled-proxy); fi
docker compose "${compose_files[@]}" "${profile_args[@]}" pull
docker compose "${compose_files[@]}" "${profile_args[@]}" up -d
echo "Updated to $version. Verify with: docker compose ps"
echo "If migration or startup fails, restore the backup created immediately before this update."
