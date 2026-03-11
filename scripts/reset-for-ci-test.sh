#!/usr/bin/env bash
# reset-for-ci-test.sh — Reset pipeline state and prep for CI iteration.
#
# Phases:
#   1. Stop the systemd timer
#   2. Git sanity check (ruflo-patch repo)
#   3. Clear Verdaccio packages (@sparkleideas/*)
#   4. Clear pipeline state and caches
#   5. Seed state from current fork HEADs
#   6. Set timer to 1-minute interval and start
#   7. Print summary
#
# Flags:
#   --no-start   Skip timer start (for manual triggering)

set -euo pipefail

NO_START=false
for arg in "$@"; do
  case "$arg" in
    --no-start) NO_START=true ;;
    -h|--help)
      echo "Usage: $0 [--no-start]"
      echo "  --no-start  Skip starting the timer (manual trigger mode)"
      exit 0
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
TIMER_FILE="$HOME/.config/systemd/user/ruflo-sync.timer"

log() {
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"
}

log_error() {
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] ERROR: $*" >&2
}

# -------------------------------------------------------------------------
# Phase 1 — Stop the timer
# -------------------------------------------------------------------------
log "Phase 1: Stopping ruflo-sync timer..."
systemctl --user stop ruflo-sync.timer 2>/dev/null || true
systemctl --user stop ruflo-sync.service 2>/dev/null || true
log "  Timer stopped"

# -------------------------------------------------------------------------
# Phase 2 — Git sanity check (ruflo-patch repo)
# -------------------------------------------------------------------------
log "Phase 2: Git sanity check..."
cd "${PROJECT_DIR}"

if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
  log "  Working tree is dirty — stashing changes"
  git stash push -m "reset-for-ci-test auto-stash $(date -u +%Y%m%dT%H%M%SZ)"
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "${CURRENT_BRANCH}" != "main" ]]; then
  log "  Switching to main (was on ${CURRENT_BRANCH})"
  git checkout main
fi

# Warn about unpushed commits (don't force-reset)
# check if remote origin/main exists
LOCAL_SHA=$(git rev-parse HEAD 2>/dev/null)
REMOTE_SHA=$(git rev-parse origin/main 2>/dev/null || echo "")
if [[ -n "${REMOTE_SHA}" && "${LOCAL_SHA}" != "${REMOTE_SHA}" ]]; then
  AHEAD=$(git rev-list origin/main..HEAD --count 2>/dev/null || echo 0)
  if [[ "${AHEAD}" -gt 0 ]]; then
    log "  WARNING: ${AHEAD} unpushed commit(s) on main"
  fi
fi
log "  Git OK (on main)"

# -------------------------------------------------------------------------
# Phase 3 — Verdaccio reset
# -------------------------------------------------------------------------
log "Phase 3: Clearing Verdaccio @sparkleideas packages..."

VERDACCIO_STORAGE="$HOME/.verdaccio/storage/@sparkleideas"
if [[ -d "${VERDACCIO_STORAGE}" ]]; then
  # Count before clearing
  PKG_COUNT=$(find "${VERDACCIO_STORAGE}" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)
  rm -rf "${VERDACCIO_STORAGE}"
  log "  Removed ${PKG_COUNT} packages from storage"
else
  log "  No @sparkleideas storage directory found"
fi

log "  Restarting Verdaccio..."
systemctl --user restart verdaccio 2>/dev/null || {
  log_error "Failed to restart Verdaccio — is it installed as a user service?"
  log "  Trying direct restart..."
  pkill -f verdaccio 2>/dev/null || true
  sleep 1
  nohup verdaccio &>/dev/null &
}

# Wait for health (up to 10 seconds)
for i in $(seq 1 10); do
  if curl -sf http://localhost:4873/-/ping &>/dev/null; then
    log "  Verdaccio healthy (attempt ${i})"
    break
  fi
  if [[ $i -eq 10 ]]; then
    log_error "Verdaccio did not respond after 10s — continuing anyway"
  fi
  sleep 1
done

# -------------------------------------------------------------------------
# Phase 4 — Clear pipeline state
# -------------------------------------------------------------------------
log "Phase 4: Clearing pipeline state and caches..."

# State file
if [[ -f "${SCRIPT_DIR}/.last-build-state" ]]; then
  rm -f "${SCRIPT_DIR}/.last-build-state"
  log "  Removed .last-build-state"
fi

# Build cache
if [[ -d /tmp/ruflo-build ]]; then
  rm -rf /tmp/ruflo-build
  log "  Removed /tmp/ruflo-build"
fi

# Stale temp dirs
# Use bash glob — count removals
STALE_COUNT=0
for d in /tmp/ruflo-rq-* /tmp/ruflo-verify-*; do
  if [[ -e "$d" ]]; then
    rm -rf "$d"
    STALE_COUNT=$((STALE_COUNT + 1))
  fi
done
if [[ $STALE_COUNT -gt 0 ]]; then
  log "  Removed ${STALE_COUNT} stale temp dirs"
fi

# npm cache entries for @sparkleideas
# _npx cache
NPX_CLEANED=0
while IFS= read -r -d '' d; do
  rm -rf "$d"
  NPX_CLEANED=$((NPX_CLEANED + 1))
done < <(find "$HOME/.npm/_npx" -path "*/@sparkleideas" -type d -print0 2>/dev/null || true)
if [[ $NPX_CLEANED -gt 0 ]]; then
  log "  Removed ${NPX_CLEANED} npx cache entries"
fi

# _cacache index entries
CACACHE_CLEANED=0
while IFS= read -r -d '' f; do
  rm -f "$f"
  CACACHE_CLEANED=$((CACACHE_CLEANED + 1))
done < <(grep -rlZ sparkleideas "$HOME/.npm/_cacache/index-v5/" 2>/dev/null || true)
if [[ $CACACHE_CLEANED -gt 0 ]]; then
  log "  Removed ${CACACHE_CLEANED} npm cacache index entries"
fi

# Orphaned lock file
LOCKFILE="/tmp/ruflo-sync-and-build.lock"
if [[ -f "${LOCKFILE}" ]]; then
  # Check if anyone holds the lock
  if ! fuser "${LOCKFILE}" &>/dev/null; then
    rm -f "${LOCKFILE}"
    log "  Removed orphaned lock file"
  else
    log "  WARNING: Lock file held by another process — left in place"
  fi
fi

log "  Pipeline state cleared"

# -------------------------------------------------------------------------
# Phase 5 — Seed state from current fork HEADs
# -------------------------------------------------------------------------
log "Phase 5: Seeding state from fork HEADs..."
cd "${PROJECT_DIR}"
bash "${SCRIPT_DIR}/sync-and-build.sh" --seed-state
log "  State seeded"

# -------------------------------------------------------------------------
# Phase 6 — Set timer to 1 minute and start
# -------------------------------------------------------------------------
log "Phase 6: Configuring timer..."

if [[ -f "${TIMER_FILE}" ]]; then
  # Check if OnCalendar is already set to every minute
  # shellcheck disable=SC2251
  CURRENT_CAL=$(grep '^OnCalendar=' "${TIMER_FILE}" 2>/dev/null | head -1 | cut -d= -f2-)
  if [[ "${CURRENT_CAL}" != "*:*:00" ]]; then
    log "  Updating OnCalendar from '${CURRENT_CAL}' to '*:*:00'"
    sed -i "s|^OnCalendar=.*|OnCalendar=*:*:00|" "${TIMER_FILE}"
  else
    log "  OnCalendar already set to *:*:00 (every minute)"
  fi
else
  log_error "Timer file not found at ${TIMER_FILE}"
  log "  Run: bash scripts/install-systemd.sh to create it"
  exit 1
fi

systemctl --user daemon-reload

if [[ "${NO_START}" == "true" ]]; then
  log "  --no-start: timer NOT started (manual trigger mode)"
  log "  To trigger manually: systemctl --user start ruflo-sync.service"
else
  systemctl --user start ruflo-sync.timer
  log "  Timer started (1-minute interval)"
fi

# -------------------------------------------------------------------------
# Phase 7 — Summary
# -------------------------------------------------------------------------
echo ""
echo "=========================================="
echo "  CI Test Environment Ready"
echo "=========================================="
echo ""
echo "  Push a commit to any fork's main branch to trigger the pipeline."
echo ""
echo "  Monitor:"
echo "    journalctl --user -u ruflo-sync.service -f"
echo ""
echo "  Timer status:"
echo "    systemctl --user list-timers ruflo-sync.timer"
echo ""
if [[ "${NO_START}" == "true" ]]; then
  echo "  Manual trigger:"
  echo "    systemctl --user start ruflo-sync.service"
  echo ""
fi
echo "  State file: ${SCRIPT_DIR}/.last-build-state"
echo "  Verdaccio:  http://localhost:4873"
echo "=========================================="
