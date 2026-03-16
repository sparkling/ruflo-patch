#!/usr/bin/env bash
# reset-for-ci-test.sh — Reset pipeline state and prep for CI iteration.
#
# Phases:
#   1. Stop the systemd timer
#   2. Git sanity check (ruflo-patch repo)
#   3. Reset forks to upstream/main (removes all patch commits)
#   4. Clear Verdaccio packages (@sparkleideas/*)
#   5. Clear pipeline state and caches
#   6. Seed state from current fork HEADs
#   7. Set timer to 1-minute interval and start
#   8. Print summary
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

# ── Timing helpers ────────────────────────────────────────────────
_ns() { date +%s%N 2>/dev/null || echo 0; }
_elapsed_ms() {
  local s="$1" e="$2"
  if [[ "$s" != "0" && "$e" != "0" ]]; then echo $(( (e - s) / 1000000 )); else echo 0; fi
}

RESET_PHASE_TIMINGS=""
RESET_START=$(_ns)

_record_reset_phase() {
  local name="$1" ms="$2"
  RESET_PHASE_TIMINGS="${RESET_PHASE_TIMINGS} ${name}:${ms}"
  if [[ $ms -ge 1000 ]]; then
    log "  Phase '${name}': ${ms}ms ($(( ms / 1000 ))s)"
  else
    log "  Phase '${name}': ${ms}ms"
  fi
}

# -------------------------------------------------------------------------
# Phase 1 — Stop the timer
# -------------------------------------------------------------------------
_p1=$(_ns)
log "Phase 1: Stopping ruflo-sync timer..."
systemctl --user stop ruflo-sync.timer 2>/dev/null || true
systemctl --user stop ruflo-sync.service 2>/dev/null || true
log "  Timer stopped"
_record_reset_phase "stop-timer" "$(_elapsed_ms "$_p1" "$(_ns)")"

# -------------------------------------------------------------------------
# Phase 2 — Git sanity check (ruflo-patch repo)
# -------------------------------------------------------------------------
_p2=$(_ns)
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
_record_reset_phase "git-check" "$(_elapsed_ms "$_p2" "$(_ns)")"

# -------------------------------------------------------------------------
# Phase 3 — Reset forks to upstream/main
# -------------------------------------------------------------------------
_p3=$(_ns)
log "Phase 3: Resetting forks to upstream/main..."

FORK_NAMES=("ruflo" "agentic-flow" "ruv-FANN")
FORK_DIRS=("$HOME/src/forks/ruflo" "$HOME/src/forks/agentic-flow" "$HOME/src/forks/ruv-FANN")

for i in "${!FORK_NAMES[@]}"; do
  _fork_name="${FORK_NAMES[$i]}"
  _fork_dir="${FORK_DIRS[$i]}"

  if [[ ! -d "${_fork_dir}/.git" ]]; then
    log "  SKIP ${_fork_name}: not a git repo"
    continue
  fi

  _fork_start=$(_ns)

  # Ensure upstream remote exists
  if ! git -C "${_fork_dir}" remote get-url upstream &>/dev/null; then
    log "  SKIP ${_fork_name}: no upstream remote"
    continue
  fi

  # Fetch upstream
  git -C "${_fork_dir}" fetch upstream main --quiet 2>/dev/null || {
    log_error "Failed to fetch upstream for ${_fork_name}"
    continue
  }

  # Count commits being removed
  _ahead=$(git -C "${_fork_dir}" rev-list --count upstream/main..origin/main 2>/dev/null || echo "?")

  # Checkout main and hard reset to upstream
  git -C "${_fork_dir}" checkout main --quiet 2>/dev/null || true
  git -C "${_fork_dir}" reset --hard upstream/main --quiet 2>/dev/null || {
    log_error "Failed to reset ${_fork_name} to upstream/main"
    continue
  }

  # Force push to origin to sync the GitHub fork
  git -C "${_fork_dir}" push origin main --force --quiet 2>/dev/null || {
    log_error "Failed to force push ${_fork_name}"
    continue
  }

  # Clean up stale tags (version bump tags from previous runs)
  _stale_tags=$(git -C "${_fork_dir}" tag -l 'v*-patch.*' 2>/dev/null | wc -l)
  if [[ $_stale_tags -gt 0 ]]; then
    git -C "${_fork_dir}" tag -l 'v*-patch.*' | xargs git -C "${_fork_dir}" tag -d 2>/dev/null || true
    git -C "${_fork_dir}" push origin --delete $(git -C "${_fork_dir}" ls-remote --tags origin | grep 'patch\.' | awk '{print $2}' | sed 's|refs/tags/||') 2>/dev/null || true
    log "  ${_fork_name}: cleaned ${_stale_tags} stale tags"
  fi

  _fork_ms=$(_elapsed_ms "$_fork_start" "$(_ns)")
  log "  ${_fork_name}: reset to upstream/main (removed ${_ahead} commits, ${_fork_ms}ms)"
done
_record_reset_phase "reset-forks" "$(_elapsed_ms "$_p3" "$(_ns)")"

# -------------------------------------------------------------------------
# Phase 4 — Verdaccio reset
# -------------------------------------------------------------------------
_p4=$(_ns)
log "Phase 4: Clearing Verdaccio @sparkleideas packages..."

VERDACCIO_STORAGE="$HOME/.verdaccio/storage/@sparkleideas"
_p4_rm=$(_ns)
if [[ -d "${VERDACCIO_STORAGE}" ]]; then
  # Count before clearing
  PKG_COUNT=$(find "${VERDACCIO_STORAGE}" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)
  rm -rf "${VERDACCIO_STORAGE}"
  log "  Removed ${PKG_COUNT} packages ($(_elapsed_ms "$_p4_rm" "$(_ns)")ms)"
else
  log "  No @sparkleideas storage directory found"
fi

_p4_restart=$(_ns)
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
    log "  Verdaccio healthy (attempt ${i}, $(_elapsed_ms "$_p4_restart" "$(_ns)")ms)"
    break
  fi
  if [[ $i -eq 10 ]]; then
    log_error "Verdaccio did not respond after 10s — continuing anyway"
  fi
  sleep 1
done
_record_reset_phase "verdaccio-reset" "$(_elapsed_ms "$_p4" "$(_ns)")"

# -------------------------------------------------------------------------
# Phase 5 — Clear pipeline state
# -------------------------------------------------------------------------
_p5=$(_ns)
log "Phase 5: Clearing pipeline state and caches..."

# State file
if [[ -f "${SCRIPT_DIR}/.last-build-state" ]]; then
  rm -f "${SCRIPT_DIR}/.last-build-state"
  log "  Removed .last-build-state"
fi

# Build cache
_p5_build=$(_ns)
if [[ -d /tmp/ruflo-build ]]; then
  rm -rf /tmp/ruflo-build
  log "  Removed /tmp/ruflo-build ($(_elapsed_ms "$_p5_build" "$(_ns)")ms)"
fi

# Stale temp dirs
_p5_stale=$(_ns)
STALE_COUNT=0
for d in /tmp/ruflo-rq-* /tmp/ruflo-verify-*; do
  if [[ -e "$d" ]]; then
    rm -rf "$d"
    STALE_COUNT=$((STALE_COUNT + 1))
  fi
done
if [[ $STALE_COUNT -gt 0 ]]; then
  log "  Removed ${STALE_COUNT} stale temp dirs ($(_elapsed_ms "$_p5_stale" "$(_ns)")ms)"
fi

# npm cache entries for @sparkleideas
# _npx cache
_p5_npx=$(_ns)
NPX_CLEANED=0
while IFS= read -r -d '' d; do
  rm -rf "$d"
  NPX_CLEANED=$((NPX_CLEANED + 1))
done < <(find "$HOME/.npm/_npx" -path "*/@sparkleideas" -type d -print0 2>/dev/null || true)
if [[ $NPX_CLEANED -gt 0 ]]; then
  log "  Removed ${NPX_CLEANED} npx cache entries ($(_elapsed_ms "$_p5_npx" "$(_ns)")ms)"
fi

# _cacache index entries
_p5_cacache=$(_ns)
CACACHE_CLEANED=0
while IFS= read -r -d '' f; do
  rm -f "$f"
  CACACHE_CLEANED=$((CACACHE_CLEANED + 1))
done < <(grep -rlZ sparkleideas "$HOME/.npm/_cacache/index-v5/" 2>/dev/null || true)
if [[ $CACACHE_CLEANED -gt 0 ]]; then
  log "  Removed ${CACACHE_CLEANED} npm cacache index entries ($(_elapsed_ms "$_p5_cacache" "$(_ns)")ms)"
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
_record_reset_phase "clear-state" "$(_elapsed_ms "$_p5" "$(_ns)")"

# -------------------------------------------------------------------------
# Phase 6 — Seed state from current fork HEADs
# -------------------------------------------------------------------------
_p6=$(_ns)
log "Phase 6: Seeding state from fork HEADs..."
cd "${PROJECT_DIR}"
bash "${SCRIPT_DIR}/ruflo-pipeline.sh" --seed-state
log "  State seeded"
_record_reset_phase "seed-state" "$(_elapsed_ms "$_p6" "$(_ns)")"

# -------------------------------------------------------------------------
# Phase 7 — Set timer to 1 minute and start
# -------------------------------------------------------------------------
_p7=$(_ns)
log "Phase 7: Configuring timer..."

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
_record_reset_phase "configure-timer" "$(_elapsed_ms "$_p7" "$(_ns)")"

# -------------------------------------------------------------------------
# Phase 8 — Summary
# -------------------------------------------------------------------------
RESET_END=$(_ns)
RESET_TOTAL_MS=$(_elapsed_ms "$RESET_START" "$RESET_END")

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
echo ""
echo "  ── Timing ──────────────────────────────"
for entry in $RESET_PHASE_TIMINGS; do
  _name="${entry%%:*}"
  _ms="${entry##*:}"
  if [[ $RESET_TOTAL_MS -gt 0 ]]; then
    _pct=$(( (_ms * 100) / RESET_TOTAL_MS ))
  else
    _pct=0
  fi
  if [[ $_ms -ge 1000 ]]; then
    printf "  %-20s %6dms (%3ds) %3d%%\n" "$_name" "$_ms" "$((_ms / 1000))" "$_pct"
  else
    printf "  %-20s %6dms        %3d%%\n" "$_name" "$_ms" "$_pct"
  fi
done
printf "  %-20s %6dms (%3ds)\n" "TOTAL" "$RESET_TOTAL_MS" "$((RESET_TOTAL_MS / 1000))"
echo "  ─────────────────────────────────────────"
echo "=========================================="
