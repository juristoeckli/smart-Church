#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
[[ -f .env ]] || { echo "Missing .env; run deploy/install.sh first." >&2; exit 1; }
version="${1:-latest}"
[[ "$version" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "Use a release version such as 1.2.3 or latest." >&2; exit 1; }
version="${version#v}"
current_version="$(sed -n 's/^SMART_CHURCH_VERSION=//p' .env | tail -n 1)"
update_branch="$(sed -n 's/^SMART_CHURCH_UPDATE_BRANCH=//p' .env | tail -n 1)"
[[ -n "$update_branch" ]] || update_branch=release
if [[ "$current_version" =~ ^[0-9a-f]{40}$ ]]; then current_version="${current_version:0:7}"; fi
echo "Current version: ${current_version:-unknown} ($update_branch); target: $version"

bash ./deploy/backup.sh

sync_deployment_files() {
  local temp_dir source_url tag file mode local_path
  local files=(
    compose.yaml
    .env.production.example
    deploy/compose.direct.yaml
    deploy/README.md
    deploy/Caddyfile
    deploy/Caddyfile.self-signed
    deploy/install.sh
    deploy/uninstall.sh
    deploy/backup.sh
    deploy/restore.sh
    deploy/update.sh
    deploy/manage.sh
    deploy/nginx-central-example.conf
    apps/api/src/modules/video-steffisburg/compose.yaml
    apps/api/src/modules/video-steffisburg/streaming.example.json
    apps/api/src/modules/video-steffisburg/.env.example
    apps/api/src/modules/video-steffisburg/README.md
    apps/api/src/modules/remote-desktop/compose.yaml
    apps/api/src/modules/remote-desktop/guacd-wave2.patch
    apps/api/src/modules/remote-desktop/build-guacd.sh
  )
  temp_dir="$(mktemp -d)"
  trap 'rm -rf "$temp_dir"' RETURN

  if [[ "$version" =~ ^[0-9a-f]{40}$ ]]; then
    for file in "${files[@]}" apps/api/src/modules/video-steffisburg/streaming.steffisburg.json; do
      source_url="https://raw.githubusercontent.com/juristoeckli/smart-Church/$version/$file"
      curl -fsSL --retry 3 "$source_url" -o "$temp_dir/${file//\//_}" || {
        echo "Could not retrieve deployment file $file from commit $version." >&2
        return 1
      }
    done
  else
    if [[ "$version" == "latest" ]]; then
      source_url="https://github.com/juristoeckli/smart-Church/releases/latest/download/smart-church-deploy.tar.gz"
    else
      tag="v$version"
      source_url="https://github.com/juristoeckli/smart-Church/releases/download/$tag/smart-church-deploy.tar.gz"
    fi
    curl -fsSL --retry 3 "$source_url" -o "$temp_dir/deploy.tar.gz" || {
      echo "Could not retrieve the deployment package for $version." >&2
      return 1
    }
    tar -xzf "$temp_dir/deploy.tar.gz" -C "$temp_dir"
  fi

  for file in "${files[@]}"; do
    local_path="$temp_dir/$file"
    if [[ "$version" =~ ^[0-9a-f]{40}$ ]]; then
      local_path="$temp_dir/${file//\//_}"
    fi
    [[ -f "$local_path" ]] || { echo "Deployment package is missing $file." >&2; return 1; }
    mode=644
    [[ "$file" == deploy/*.sh ]] && mode=755
    install -D -m "$mode" "$local_path" "$root/$file"
  done

  local config_file="apps/api/src/modules/video-steffisburg/streaming.steffisburg.json"
  if [[ ! -e "$root/$config_file" ]]; then
    if [[ "$version" =~ ^[0-9a-f]{40}$ ]]; then
      local_path="$temp_dir/${config_file//\//_}"
    else
      local_path="$temp_dir/$config_file"
    fi
    if [[ -f "$local_path" ]]; then install -D -m 644 "$local_path" "$root/$config_file"; fi
  fi
  trap - RETURN
  rm -rf "$temp_dir"
}

sync_deployment_files || exit 1

sync_video_module() {
  local module_dir="apps/api/src/modules/video-steffisburg"
  local temp_dir archive tag source_url
  [[ -d "$module_dir" ]] || mkdir -p "$module_dir"
  temp_dir="$(mktemp -d)"
  trap 'rm -rf "$temp_dir"' RETURN

  if [[ "$version" =~ ^[0-9a-f]{40}$ ]]; then
    for file in compose.yaml streaming.steffisburg.json; do
      source_url="https://raw.githubusercontent.com/juristoeckli/smart-Church/$version/apps/api/src/modules/video-steffisburg/$file"
      curl -fsSL --retry 3 "$source_url" -o "$temp_dir/$file" || {
        echo "Could not retrieve the Video & streaming module files for commit $version." >&2
        return 1
      }
    done
  else
    if [[ "$version" == "latest" ]]; then
      source_url="https://github.com/juristoeckli/smart-Church/releases/latest/download/smart-church-deploy.tar.gz"
    else
      tag="v$version"
      source_url="https://github.com/juristoeckli/smart-Church/releases/download/$tag/smart-church-deploy.tar.gz"
    fi
    if curl -fsSL --retry 3 "$source_url" -o "$temp_dir/deploy.tar.gz"; then
      for file in compose.yaml streaming.steffisburg.json; do
        tar -xOzf "$temp_dir/deploy.tar.gz" "apps/api/src/modules/video-steffisburg/$file" > "$temp_dir/$file" || {
          echo "The deployment package does not include the Video & streaming module's $file." >&2
          return 1
        }
      done
    else
      echo "The selected release has no downloadable deployment package; leaving module files unchanged."
      return 0
    fi
  fi

  install -m 644 "$temp_dir/compose.yaml" "$module_dir/compose.yaml"
  if [[ ! -e "$module_dir/streaming.steffisburg.json" ]]; then
    install -m 644 "$temp_dir/streaming.steffisburg.json" "$module_dir/streaming.steffisburg.json"
    echo "Installed the bundled Steffisburg Video configuration."
  else
    echo "Kept the existing Steffisburg Video configuration."
  fi
  trap - RETURN
  rm -rf "$temp_dir"
}

department_name="$(sed -n 's/^SMART_CHURCH_DEPARTMENT_NAME=//p' .env | tail -n 1)"
streaming_config="$(sed -n 's/^SMART_CHURCH_STREAMING_CONFIG_PATH=//p' .env | tail -n 1)"
if [[ "$department_name" == "Steffisburg" || -n "$streaming_config" ]]; then
  command -v curl >/dev/null || { echo "curl is required to update the Video & streaming module files." >&2; exit 1; }
  sync_video_module || exit 1
  if [[ "$department_name" == "Steffisburg" && -z "$streaming_config" && -f apps/api/src/modules/video-steffisburg/streaming.steffisburg.json ]]; then
    printf '%s\n' 'SMART_CHURCH_STREAMING_CONFIG_PATH=./apps/api/src/modules/video-steffisburg/streaming.steffisburg.json' >> .env
    streaming_config="./apps/api/src/modules/video-steffisburg/streaming.steffisburg.json"
  fi
fi

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
if [[ -f deploy/compose.direct.yaml ]]; then
  compose_files+=(-f deploy/compose.direct.yaml)
fi
if [[ -f apps/api/src/modules/video-steffisburg/compose.yaml ]] && grep -q '^SMART_CHURCH_STREAMING_CONFIG_PATH=' .env; then
  compose_files+=(-f apps/api/src/modules/video-steffisburg/compose.yaml)
fi
if [[ -f apps/api/src/modules/remote-desktop/compose.yaml ]] && grep -q '^SMART_CHURCH_USE_SYSTEM_LAPTOP=1' .env; then
  compose_files+=(-f apps/api/src/modules/remote-desktop/compose.yaml)
fi
profile_args=()
if grep -q '^SMART_CHURCH_USE_BUNDLED_PROXY=1' .env; then profile_args+=(--profile bundled-proxy); fi
if grep -q '^SMART_CHURCH_USE_SYSTEM_LAPTOP=1' .env; then profile_args+=(--profile system-laptop); fi
pull_services=(db api web)
if grep -q '^SMART_CHURCH_USE_BUNDLED_PROXY=1' .env; then pull_services+=(caddy); fi
if grep -q '^SMART_CHURCH_USE_SYSTEM_LAPTOP=1' .env; then
  pull_services+=(system-laptop-guacamole)
  guacd_image="$(sed -n 's/^SYSTEM_LAPTOP_GUACD_IMAGE=//p' .env | tail -n 1)"
  if [[ "$guacd_image" == "smart-church/guacd:1.6.0-wave2" ]]; then
    docker image inspect "$guacd_image" >/dev/null 2>&1 || {
      echo "The locally built Wave2 guacd image is missing. Rebuild it with: bash ./apps/api/src/modules/remote-desktop/build-guacd.sh" >&2
      exit 1
    }
  else
    pull_services+=(system-laptop-guacd)
  fi
fi
docker compose "${compose_files[@]}" "${profile_args[@]}" pull "${pull_services[@]}"
docker compose "${compose_files[@]}" "${profile_args[@]}" up -d
echo "Updated to $version. Verify with: docker compose ps"
echo "If migration or startup fails, restore the backup created immediately before this update."
