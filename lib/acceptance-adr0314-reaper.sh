#!/usr/bin/env bash
# lib/acceptance-adr0314-reaper.sh — ADR-0314 defensive orphan-Chrome reaper.
#
# WHY: the browser acceptance checks (p4-br-*, lib/acceptance-browser-checks.sh)
# drive a headless Chrome through the third-party `agent-browser` binary
# (vercel-labs/agent-browser; NOT fork-owned). agent-browser runs a PERSISTENT
# per-session daemon that owns Chrome. When the MCP server that spawned it is
# SIGKILLed (the browser checks `_timeout`-SIGKILL the hung stdio `mcp start`
# server — see lib/acceptance-browser-checks.sh:189-200), the daemon + its
# Chrome are REPARENTED TO init (PPID 1) and outlive the run, busy-spinning on
# software-GL helpers (~8-9 cores). This is the perf-gate contention source
# recorded in memory/feedback-perf-gate-failure-check-machine-load.md.
#
# The fork-side launch-site teardown (signal handlers + idempotent close in
# agent-browser-adapter.ts and browser-tools.ts) fixes the SIGINT/SIGTERM and
# normal-exit paths. A SIGKILL skips every handler, so this defensive reaper is
# the backstop for that one escape (ADR-0314 Decision Outcome = Option 4).
#
# PRECISION CONTRACT (the load-bearing safety property):
#   Reap ONLY orphaned (PPID == 1) processes whose command matches
#   `agent-browser-chrome`. NEVER touch a live-parented session — a running
#   browser agent (PPID = its launcher, not 1) must survive untouched. We do
#   NOT use a bare `pkill -f`: that would also kill live-parented sessions.
#   Instead we enumerate via `ps`, filter PPID==1 in awk, and `kill -9` each
#   surviving PID individually. The char-class self-match guard
#   (`[a]gent-browser-chrome`) keeps the matcher (this script / a grep) from
#   matching ITSELF. Verified by the negative-control check in
#   lib/acceptance-adr0314-checks.sh.
#
# Idempotent + best-effort: safe to call multiple times, never fails the run.
#
# Exposes:
#   _adr0314_orphan_pids        → echo PPID-1 agent-browser-chrome PIDs (one/line)
#   _adr0314_orphan_count       → echo the count of the above
#   _adr0314_orphan_profile_dirs→ echo leftover temp-profile dirs (one/line)
#   _adr0314_reap_orphans [tag] → kill the orphans + remove their temp profiles
#
# No required env. Pure POSIX-ish bash + ps/awk/kill/rm. macOS + Linux.

# ── Process matcher (PPID == 1 ∧ command ~ agent-browser-chrome) ─────────
# Self-match guard: the bracket class '[a]gent-...' matches the literal string
# "agent-..." but not this awk program's own command line.
_adr0314_orphan_pids() {
  # `ps -Ao pid,ppid,command`: portable column order on both macOS (BSD) and
  # Linux (procps). awk: ppid (field 2) == 1 AND the joined command contains
  # the guarded token. Print only the PID (field 1).
  ps -Ao pid,ppid,command 2>/dev/null | awk '
    $2 == 1 {
      line = ""
      for (i = 3; i <= NF; i++) line = line $i " "
      if (line ~ /[a]gent-browser-chrome/) print $1
    }
  '
}

_adr0314_orphan_count() {
  local n
  n=$(_adr0314_orphan_pids | grep -c . 2>/dev/null)
  echo "${n:-0}"
}

# ── Leftover temp profiles (agent-browser-chrome-* under the temp roots) ──
# agent-browser names each session profile `<TMPDIR>/agent-browser-chrome-*`.
# On macOS that resolves under /var/folders/.../T (and its /private alias);
# on Linux under /tmp. We also honour an explicit $TMPDIR.
_adr0314_orphan_profile_dirs() {
  local roots=()
  [[ -n "${TMPDIR:-}" ]] && roots+=("${TMPDIR%/}")
  roots+=(/tmp /var/folders /private/var/folders)
  local r d
  for r in "${roots[@]}"; do
    [[ -d "$r" ]] || continue
    # -maxdepth keeps the /var/folders walk shallow + fast (profiles live at
    # .../T/agent-browser-chrome-*, depth 3 below /var/folders).
    while IFS= read -r d; do
      [[ -z "$d" ]] && continue
      # Canonicalize to the PHYSICAL path so the macOS /var → /private/var
      # symlink alias collapses to one entry (otherwise the same profile is
      # listed twice — once per root — and the count is inflated). `cd -P`
      # is portable where `realpath`/`readlink -f` may be absent.
      ( cd -P "$d" 2>/dev/null && pwd -P ) || printf '%s\n' "$d"
    done < <(find "$r" -maxdepth 4 -type d -name 'agent-browser-chrome-*' 2>/dev/null)
  done | sort -u
}

# ── The reaper: kill PPID-1 orphans, then remove leftover temp profiles ──
# $1 (optional): a tag for the log line (e.g. "before browser group").
_adr0314_reap_orphans() {
  local tag="${1:-}"
  local pids pid killed=0
  pids=$(_adr0314_orphan_pids)

  if [[ -n "$pids" ]]; then
    while IFS= read -r pid; do
      [[ -z "$pid" ]] && continue
      # Re-confirm PPID==1 at kill time (TOCTOU guard): a process can reparent
      # between enumeration and kill; we must never -9 a now-live-parented PID.
      local ppid_now
      ppid_now=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
      if [[ "$ppid_now" == "1" ]]; then
        kill -9 "$pid" 2>/dev/null && killed=$((killed + 1)) || true
      fi
    done <<< "$pids"
  fi

  # Remove leftover temp profiles (best-effort; only the named dirs).
  local d removed=0
  while IFS= read -r d; do
    [[ -z "$d" ]] && continue
    rm -rf "$d" 2>/dev/null && removed=$((removed + 1)) || true
  done < <(_adr0314_orphan_profile_dirs)

  # Log only when something was actually reaped, to keep noise down. The
  # acceptance harness defines log(); fall back to stderr if unsourced.
  if (( killed > 0 || removed > 0 )); then
    local msg="[adr0314-reaper] ${tag:+$tag: }reaped ${killed} orphaned agent-browser-chrome PPID-1 proc(s), removed ${removed} temp profile(s)"
    if declare -F log >/dev/null 2>&1; then log "  $msg"; else echo "$msg" >&2; fi
  fi
  return 0
}
