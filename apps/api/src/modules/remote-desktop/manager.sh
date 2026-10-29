remote_desktop_store() {
  local action="$1" department_id="$2" payload="${3:-}"
  if [[ -n "$payload" ]]; then
    printf '%s' "$payload" | run_compose exec -T api node --import tsx src/modules/remote-desktop/manage-destinations.ts "$action" "$department_id"
  else
    run_compose exec -T api node --import tsx src/modules/remote-desktop/manage-destinations.ts "$action" "$department_id"
  fi
}

remote_desktop_encode() { printf '%s' "$1" | base64 | tr -d '\r\n'; }
remote_desktop_decode() { printf '%s' "$1" | base64 -d; }

configure_remote_desktop_destinations() {
  local department_id="$1" action choice row id name64 host64 port protocol username64 auto name host username password password_mode payload auto_text rows_text ready=0 attempt
  local -a rows=() choices=()
  for attempt in {1..30}; do
    if rows_text="$(remote_desktop_store list "$department_id" 2>/dev/null)"; then ready=1; break; fi
    sleep 1
  done
  ((ready == 1)) || { echo 'The destination database did not become ready.' >&2; return 1; }
  [[ -z "$rows_text" ]] || mapfile -t rows <<< "$rows_text"
  echo "Remote desktop destinations for $(env_value SMART_CHURCH_DEPARTMENT_NAME):"
  local index=1
  for row in "${rows[@]}"; do
    IFS=$'\t' read -r id name64 host64 port protocol username64 auto <<< "$row"
    printf '  %s. %s — %s://%s:%s (user: %s)\n' "$index" "$(remote_desktop_decode "$name64")" "$protocol" "$(remote_desktop_decode "$host64")" "$port" "$(remote_desktop_decode "$username64")"
    ((index+=1))
  done
  if command -v whiptail >/dev/null; then
    action="$(whiptail --title 'Remote desktop destinations' --menu 'Choose a destination action' 14 72 4 add 'Add destination' edit 'Edit destination' remove 'Remove destination' back 'Return' 3>&1 1>&2 2>&3)" || return 0
  else
    select action in add edit remove back; do [[ -n "${action:-}" ]] && break; done </dev/tty >/dev/tty
  fi
  [[ "$action" == back ]] && return 0
  if [[ "$action" != add ]]; then
    ((${#rows[@]} > 0)) || { echo 'There are no destinations to edit or remove.'; return 0; }
    local -a menu_args=()
    for row in "${rows[@]}"; do
      IFS=$'\t' read -r id name64 host64 port protocol username64 auto <<< "$row"
      menu_args+=("$id" "$(remote_desktop_decode "$name64") · $protocol · $(remote_desktop_decode "$host64"):$port")
    done
    if command -v whiptail >/dev/null; then
      choice="$(whiptail --title 'Remote desktop destinations' --menu 'Select a destination' 18 78 8 "${menu_args[@]}" 3>&1 1>&2 2>&3)" || return 0
    else
      select choice in "${rows[@]}" back; do [[ -n "${choice:-}" ]] && break; done </dev/tty >/dev/tty
      [[ "$choice" == back ]] && return 0
      id="${choice%%$'\t'*}"
    fi
    if [[ "$action" == remove ]]; then
      read -r -p 'Remove this destination? [y/N]: ' choice </dev/tty
      [[ "$choice" =~ ^[Yy]$ ]] || return 0
      remote_desktop_store delete "$department_id" <<< "$id"
      return
    fi
    id="$choice"
    for row in "${rows[@]}"; do
      IFS=$'\t' read -r row_id name64 host64 port protocol username64 auto <<< "$row"
      [[ "$row_id" == "$id" ]] && break
    done
    name="$(remote_desktop_decode "$name64")"
    host="$(remote_desktop_decode "$host64")"
    username="$(remote_desktop_decode "$username64")"
  else
    id=""
    name=""
    host=""
    port=""
    protocol="rdp"
    username=""
    auto=1
  fi
  read -r -p "Destination name [${name:-new destination}]: " choice </dev/tty
  name="${choice:-$name}"
  read -r -p "Host [${host:-IP or DNS name}]: " choice </dev/tty
  host="${choice:-$host}"
  read -r -p "Protocol (rdp/vnc/spice) [$protocol]: " choice </dev/tty
  protocol="${choice:-$protocol}"
  local suggested_port=3389
  [[ "$protocol" == rdp ]] || suggested_port=5900
  read -r -p "Port [${port:-$suggested_port}]: " choice </dev/tty
  port="${choice:-${port:-$suggested_port}}"
  read -r -p "Username [${username:-none}]: " choice </dev/tty
  username="${choice:-$username}"
  if [[ "$auto" == 1 ]]; then auto_text=1; else auto_text=0; fi
  read -r -p "Autologin with saved username and password? [${auto_text/1/Y}${auto_text/0/n}/Y]: " choice </dev/tty
  [[ "$choice" =~ ^[Nn]$ ]] && auto_text=0 || auto_text=1
  if [[ "$id" ]]; then
    read -r -s -p 'New password (Enter = empty password; type - to keep current): ' password </dev/tty
    echo >/dev/tty
    if [[ "$password" == '-' ]]; then password_mode=keep; password=''; else password_mode=set; fi
  else
    read -r -s -p 'Password (Enter sends an empty password): ' password </dev/tty
    echo >/dev/tty
    password_mode=set
  fi
  payload="$(printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s' "$id" "$(remote_desktop_encode "$name")" "$(remote_desktop_encode "$host")" "$port" "$protocol" "$(remote_desktop_encode "$username")" "$(remote_desktop_encode "$password")" "$auto_text" "$password_mode")"
  remote_desktop_store save "$department_id" "$payload"
}

configure_remote_desktop_module() {
  local department_id="$1" secret guacd_image wave2_choice
  secret="$(env_value SYSTEM_LAPTOP_JSON_SECRET_KEY)"
  if [[ ! "$secret" =~ ^[[:xdigit:]]{32}$ ]]; then
    command -v openssl >/dev/null || { echo 'openssl is required to generate the remote desktop service key.' >&2; return 1; }
    set_env_value SYSTEM_LAPTOP_JSON_SECRET_KEY "$(openssl rand -hex 16)"
    secret="$(env_value SYSTEM_LAPTOP_JSON_SECRET_KEY)"
  fi
  set_env_value SMART_CHURCH_USE_SYSTEM_LAPTOP 1
  build_compose_args
  run_compose up -d api system-laptop-guacd system-laptop-guacamole || return 1
  configure_remote_desktop_destinations "$department_id" || return 1
  if [[ -n "$(env_value SYSTEM_LAPTOP_RDP_HOST)" || -n "$(env_value SYSTEM_LAPTOP_RDP_PASSWORD)" ]]; then
    set_env_value SYSTEM_LAPTOP_RDP_HOST ''
    set_env_value SYSTEM_LAPTOP_RDP_PORT ''
    set_env_value SYSTEM_LAPTOP_RDP_USERNAME ''
    set_env_value SYSTEM_LAPTOP_RDP_PASSWORD ''
    build_compose_args
    run_compose up -d api || return 1
  fi
  guacd_image="$(env_value SYSTEM_LAPTOP_GUACD_IMAGE)"
  if [[ "$guacd_image" == 'smart-church/guacd:1.6.0-wave2' ]]; then
    read -r -p 'Keep patched Wave2 audio support? [Y/n]: ' wave2_choice </dev/tty
    if [[ "$wave2_choice" =~ ^[Nn]$ ]]; then unset_env_value SYSTEM_LAPTOP_GUACD_IMAGE; fi
  else
    read -r -p 'Build and use patched Wave2 audio support? [y/N]: ' wave2_choice </dev/tty
    if [[ "$wave2_choice" =~ ^[Yy]([Ee][Ss])?$ ]]; then
      if ! docker image inspect smart-church/guacd:1.6.0-wave2 >/dev/null 2>&1; then bash ./apps/api/src/modules/remote-desktop/build-guacd.sh || return 1; fi
      set_env_value SYSTEM_LAPTOP_GUACD_IMAGE smart-church/guacd:1.6.0-wave2
    else
      unset_env_value SYSTEM_LAPTOP_GUACD_IMAGE
    fi
  fi
  echo 'Remote desktop destinations are shared with the web app settings.'
}
