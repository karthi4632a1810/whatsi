#!/usr/bin/env bash
# Nightly MongoDB backup: one gzip archive per day in ./backups, kept KEEP_DAYS days.
# Restore: see README → Backups.
set -uo pipefail
KEEP_DAYS="${KEEP_DAYS:-14}"
AT="${BACKUP_AT:-02:00}"

backup() {
  local file="/backups/whatsi-$(TZ=Asia/Kolkata date +%F).archive.gz"
  if mongodump --uri="$MONGO_URI" --gzip --archive="$file.tmp" --quiet; then
    mv "$file.tmp" "$file"
    echo "[backup] $(date -Is) wrote $file ($(du -h "$file" | cut -f1))"
  else
    rm -f "$file.tmp"
    echo "[backup] $(date -Is) FAILED" >&2
  fi
  find /backups -name 'whatsi-*.archive.gz' -mtime "+$KEEP_DAYS" -delete
}

# Make sure today has a backup, then run every night at $AT (India time).
[ -f "/backups/whatsi-$(TZ=Asia/Kolkata date +%F).archive.gz" ] || backup
while true; do
  now=$(date +%s)
  next=$(TZ=Asia/Kolkata date -d "today $AT" +%s)
  [ "$next" -le "$now" ] && next=$(TZ=Asia/Kolkata date -d "tomorrow $AT" +%s)
  sleep $((next - now))
  backup
done
