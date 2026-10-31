#!/bin/sh
set -u

log_dir=/var/log/smart-church/remote-desktop
log_file="$log_dir/guacd.log"
level_file="$log_dir/log-level"
umask 027
mkdir -p "$log_dir"

# Keep the most recent lines across container restarts without letting stale logs grow forever.
if [ -s "$log_file" ]; then
  tail -n 2000 "$log_file" > "$log_file.tmp" && mv "$log_file.tmp" "$log_file"
fi

fifo_dir="$(mktemp -d)"
fifo="$fifo_dir/guacd-output"
mkfifo "$fifo"

if [ ! -s "$level_file" ]; then
  printf '%s\n' "${LOG_LEVEL:-${GUACD_LOG_LEVEL:-info}}" > "$level_file"
fi
read_level() {
  level="$(cat "$level_file" 2>/dev/null || true)"
  case "$level" in error|warning|info|debug|trace) printf '%s' "$level" ;; *) printf '%s' "${LOG_LEVEL:-${GUACD_LOG_LEVEL:-info}}" ;; esac
}

# Keep Docker's normal container logs while copying the same output to the shared diagnostics volume.
tee -a "$log_file" < "$fifo" &
tee_pid=$!
forward_stop() {
  [ -n "${guacd_pid:-}" ] && kill -TERM "$guacd_pid" 2>/dev/null || true
  [ -n "${watcher_pid:-}" ] && kill "$watcher_pid" 2>/dev/null || true
  kill "$tee_pid" 2>/dev/null || true
}
trap forward_stop HUP INT TERM
status=0
log_level="$(read_level)"
while :; do
  /opt/guacamole/sbin/guacd -f -b 0.0.0.0 -L "$log_level" > "$fifo" 2>&1 &
  guacd_pid=$!
  (
    while kill -0 "$guacd_pid" 2>/dev/null; do
      sleep 1
      [ "$(read_level)" = "$log_level" ] || { kill -TERM "$guacd_pid" 2>/dev/null || true; exit 0; }
    done
  ) &
  watcher_pid=$!
  wait "$guacd_pid" || status=$?
  kill "$watcher_pid" 2>/dev/null || true
  wait "$watcher_pid" 2>/dev/null || true
  next_level="$(read_level)"
  [ "$next_level" != "$log_level" ] || break
  log_level="$next_level"
  status=0
done
wait "$tee_pid" || true
rm -rf "$fifo_dir"
exit "$status"
