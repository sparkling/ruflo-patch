#!/usr/bin/env bash
# lib/fork-paths.sh — Single source of truth for fork configuration
#
# Reads config/upstream-branches.json and exports:
#   FORK_NAMES[]          — ("ruflo" "agentic-flow" "ruv-FANN" "ruvector")
#   FORK_DIRS[]           — ("/home/claude/src/forks/ruflo" ...)
#   UPSTREAM_URLS[]       — ("https://github.com/..." ...)
#   UPSTREAM_BRANCHES[]   — ("main" "feature/agentic-flow-v2" ...)
#   FORK_DIR_RUFLO, FORK_DIR_AGENTIC, FORK_DIR_FANN, FORK_DIR_RUVECTOR
#
# Also provides:
#   _upstream_branch <name>  — returns the branch for a fork name
#
# Usage: source "$(dirname "${BASH_SOURCE[0]}")/../lib/fork-paths.sh"
#    or: source "${PROJECT_DIR}/lib/fork-paths.sh"

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
  for (const n of names) {
    const varName = n.replace(/-/g, '_').replace(/\\./, '_').toUpperCase();
    const shortName = {
      'ruflo': 'RUFLO',
      'agentic-flow': 'AGENTIC',
      'ruv-FANN': 'FANN',
      'ruvector': 'RUVECTOR',
    }[n] || varName;
    console.log('FORK_DIR_' + shortName + '=' + JSON.stringify(c[n].dir));
    console.log('UPSTREAM_' + shortName + '=' + JSON.stringify(c[n].url));
  }
" 2>/dev/null)"

# Helper: get the upstream branch name for a fork
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
