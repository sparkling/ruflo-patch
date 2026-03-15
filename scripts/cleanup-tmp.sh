#!/usr/bin/env bash
# scripts/cleanup-tmp.sh — Remove stale ruflo temp files (Q5)
set -euo pipefail

MAX_AGE_HOURS="${1:-24}"

log() { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] cleanup: $*" >&2; }

# Clean stale timing files
for pattern in /tmp/ruflo-timing-*.jsonl /tmp/ruflo-publish-verdaccio-timing.jsonl /tmp/ruflo-acceptance-timing.jsonl /tmp/ruflo-rsync-*; do
  for f in $pattern; do
    [[ -f "$f" ]] || continue
    if [[ $(find "$f" -maxdepth 0 -mmin +$((MAX_AGE_HOURS * 60)) -print 2>/dev/null | wc -l) -gt 0 ]]; then
      rm -f "$f"
      log "Removed stale: $f"
    fi
  done
done

# Clean stale lock files (only if no holder)
LOCKFILE="/tmp/ruflo-sync-and-build.lock"
if [[ -f "$LOCKFILE" ]]; then
  if ! fuser "$LOCKFILE" 2>/dev/null | grep -q '[0-9]'; then
    rm -f "$LOCKFILE"
    log "Removed orphaned lock: $LOCKFILE"
  fi
fi

log "Cleanup complete"
