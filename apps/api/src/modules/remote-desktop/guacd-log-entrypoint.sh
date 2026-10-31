#!/bin/sh
set -u

log_dir=/var/log/smart-church/remote-desktop
log_file="$log_dir/guacd.log"
umask 027
mkdir -p "$log_dir"

# Keep the most recent lines across container restarts without letting stale logs grow forever.
if [ -s "$log_file" ]; then
  tail -n 2000 "$log_file" > "$log_file.tmp" && mv "$log_file.tmp" "$log_file"
fi

fifo_dir="$(mktemp -d)"
fifo="$fifo_dir/guacd-output"
mkfifo "$fifo"

# Keep Docker's normal container logs while copying the same output to the shared diagnostics volume.
tee -a "$log_file" < "$fifo" &
tee_pid=$!
/opt/guacamole/sbin/guacd -f -b 0.0.0.0 -L "${LOG_LEVEL:-${GUACD_LOG_LEVEL:-info}}" > "$fifo" 2>&1 &
guacd_pid=$!

forward_stop() {
  kill -TERM "$guacd_pid" 2>/dev/null || true
}
trap forward_stop HUP INT TERM

status=0
wait "$guacd_pid" || status=$?
wait "$tee_pid" || true
rm -rf "$fifo_dir"
exit "$status"
