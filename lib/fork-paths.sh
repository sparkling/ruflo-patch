#!/usr/bin/env bash
# lib/fork-paths.sh — Single source of truth for fork configuration (ADR-0039)
#
# Reads config/upstream-branches.json and exports:
#   FORK_NAMES[]          — ("ruflo" "agentic-flow" "ruv-FANN" "ruvector")
#   FORK_DIRS[]           — ("/home/claude/src/forks/ruflo" ...)
#   UPSTREAM_URLS[]       — ("https://github.com/..." ...)
#   UPSTREAM_BRANCHES[]   — ("main" "feature/agentic-flow-v2" ...)
#   FORK_DIR_RUFLO, FORK_DIR_AGENTIC, FORK_DIR_FANN, FORK_DIR_RUVECTOR
#   UPSTREAM_RUFLO, UPSTREAM_AGENTIC, UPSTREAM_FANN, UPSTREAM_RUVECTOR
#
# Also provides:
#   _upstream_branch <name>          — returns the tracked branch for a fork
#   set_fork_head <name> <sha>       — sets NEW_<PREFIX>_HEAD
#   get_fork_head <name>             — prints NEW_<PREFIX>_HEAD
#   get_prev_head <name>             — prints PREV_<PREFIX>_HEAD
#   set_upstream_sha <name> <sha>    — sets UPSTREAM_<PREFIX>_SHA
#   get_upstream_sha <name>          — prints UPSTREAM_<PREFIX>_SHA
#
# Consumers: ruflo-publish.sh, ruflo-sync.sh, copy-source.sh, deploy-finalize.sh

# Guard against double-sourcing
[[ -n "${_FORK_PATHS_LOADED:-}" ]] && return 0
_FORK_PATHS_LOADED=1

_FORK_PATHS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_FORK_PATHS_CONFIG="${_FORK_PATHS_DIR}/../config/upstream-branches.json"

if [[ ! -f "$_FORK_PATHS_CONFIG" ]]; then
  echo "FATAL: config/upstream-branches.json not found at $_FORK_PATHS_CONFIG" >&2
  exit 1
fi

# Parse JSON once with node, emit shell assignments
eval "$(node -e "
  const c = JSON.parse(require('fs').readFileSync('${_FORK_PATHS_CONFIG}', 'utf8'));
  const names = Object.keys(c);
  const dirs = names.map(n => c[n].dir);
  const urls = names.map(n => c[n].url);
  const branches = names.map(n => c[n].branch || 'main');

  // Emit bash arrays
  console.log('FORK_NAMES=(' + names.map(n => JSON.stringify(n)).join(' ') + ')');
  console.log('FORK_DIRS=(' + dirs.map(d => JSON.stringify(d)).join(' ') + ')');
  console.log('UPSTREAM_URLS=(' + urls.map(u => JSON.stringify(u)).join(' ') + ')');
  console.log('UPSTREAM_BRANCHES=(' + branches.map(b => JSON.stringify(b)).join(' ') + ')');

  // Emit named constants for backward compat
  const SHORT = {
    'ruflo': 'RUFLO', 'agentic-flow': 'AGENTIC',
    'ruv-FANN': 'FANN', 'ruvector': 'RUVECTOR',
  };
  for (const n of names) {
    const s = SHORT[n] || n.replace(/-/g, '_').toUpperCase();
    console.log('FORK_DIR_' + s + '=' + JSON.stringify(c[n].dir));
    console.log('UPSTREAM_' + s + '=' + JSON.stringify(c[n].url));
  }
" 2>/dev/null)"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# _upstream_branch <name> — returns tracked upstream branch for a fork
_upstream_branch() {
  local name="$1"
  for i in "${!FORK_NAMES[@]}"; do
    if [[ "${FORK_NAMES[$i]}" == "$name" ]]; then
      echo "${UPSTREAM_BRANCHES[$i]}"
      return
    fi
  done
  echo "main"
}

# Fork-name-to-variable helpers (Q2: eliminate case-switch boilerplate)
declare -A _FORK_HEAD_PREFIX=(
  [ruflo]=RUFLO
  [agentic-flow]=AGENTIC
  [ruv-FANN]=FANN
  [ruvector]=RUVECTOR
)

# set_fork_head "ruflo" "$sha"  →  NEW_RUFLO_HEAD="$sha"
set_fork_head() {
  local prefix="${_FORK_HEAD_PREFIX[$1]:-}"
  [[ -n "$prefix" ]] && declare -g "NEW_${prefix}_HEAD=$2"
}

# get_fork_head "ruflo"  →  prints value of NEW_RUFLO_HEAD
get_fork_head() {
  local prefix="${_FORK_HEAD_PREFIX[$1]:-}"
  [[ -n "$prefix" ]] || return 1
  local var="NEW_${prefix}_HEAD"
  echo "${!var:-}"
}

# get_prev_head "ruflo"  →  prints value of PREV_RUFLO_HEAD
get_prev_head() {
  local prefix="${_FORK_HEAD_PREFIX[$1]:-}"
  [[ -n "$prefix" ]] || return 1
  local var="PREV_${prefix}_HEAD"
  echo "${!var:-}"
}

# set_upstream_sha "ruflo" "$sha"  →  UPSTREAM_RUFLO_SHA="$sha"
set_upstream_sha() {
  local prefix="${_FORK_HEAD_PREFIX[$1]:-}"
  [[ -n "$prefix" ]] && declare -g "UPSTREAM_${prefix}_SHA=$2"
}

# get_upstream_sha "ruflo"  →  prints value of UPSTREAM_RUFLO_SHA
get_upstream_sha() {
  local prefix="${_FORK_HEAD_PREFIX[$1]:-}"
  [[ -n "$prefix" ]] || return 1
  local var="UPSTREAM_${prefix}_SHA"
  echo "${!var:-}"
}
