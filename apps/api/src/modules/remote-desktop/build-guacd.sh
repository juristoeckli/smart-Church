#!/usr/bin/env bash
set -Eeuo pipefail

module_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
patch_file="$module_root/guacd-wave2.patch"
image_tag="smart-church/guacd:1.6.0-wave2"

command -v git >/dev/null || { echo "Install git to build the optional Wave2 guacd image." >&2; exit 1; }
command -v docker >/dev/null || { echo "Docker is required to build the optional Wave2 guacd image." >&2; exit 1; }
[[ -f "$patch_file" ]] || { echo "The Wave2 patch is missing from the deployment package." >&2; exit 1; }

temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT
source_dir="$temp_dir/guacamole-server"

git -c core.autocrlf=false clone --depth 1 --branch 1.6.0 https://github.com/apache/guacamole-server.git "$source_dir"
git -C "$source_dir" apply --check "$patch_file"
git -C "$source_dir" apply "$patch_file"
docker build \
  --build-arg 'WITH_FREERDP=2\.11\.7' \
  --build-arg 'WITH_LIBWEBSOCKETS=v4\.3\.3' \
  --tag "$image_tag" \
  --file "$source_dir/Dockerfile" \
  "$source_dir"

echo "Built $image_tag with RDPSND Wave2 support."
