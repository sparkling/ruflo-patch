# lib/fork-paths.sh — Fork directory constants (ADR-0039)
#
# Single source of truth for fork directories and upstream URLs.
# Sourceable library — no `set -euo pipefail` (caller provides).
#
# Consumers: ruflo-publish.sh, ruflo-sync.sh, copy-source.sh, deploy-finalize.sh

# ---------------------------------------------------------------------------
# Fork directories (ADR-0027: source is local forks, not upstream repos)
# ---------------------------------------------------------------------------

FORK_DIR_RUFLO="/home/claude/src/forks/ruflo"
FORK_DIR_AGENTIC="/home/claude/src/forks/agentic-flow"
FORK_DIR_FANN="/home/claude/src/forks/ruv-FANN"
FORK_DIR_RUVECTOR="/home/claude/src/forks/ruvector"

FORK_NAMES=("ruflo" "agentic-flow" "ruv-FANN" "ruvector")
FORK_DIRS=("${FORK_DIR_RUFLO}" "${FORK_DIR_AGENTIC}" "${FORK_DIR_FANN}" "${FORK_DIR_RUVECTOR}")

# ---------------------------------------------------------------------------
# Upstream repository URLs
# ---------------------------------------------------------------------------

UPSTREAM_RUFLO="https://github.com/ruvnet/ruflo.git"
UPSTREAM_AGENTIC="https://github.com/ruvnet/agentic-flow.git"
UPSTREAM_FANN="https://github.com/ruvnet/ruv-FANN.git"
UPSTREAM_RUVECTOR="https://github.com/ruvnet/RuVector.git"

UPSTREAM_URLS=("${UPSTREAM_RUFLO}" "${UPSTREAM_AGENTIC}" "${UPSTREAM_FANN}" "${UPSTREAM_RUVECTOR}")

# ---------------------------------------------------------------------------
# Fork-name-to-variable helpers (Q2: eliminate case-switch boilerplate)
# ---------------------------------------------------------------------------
# Maps fork names to variable name prefixes for HEAD and UPSTREAM SHAs.
# Eliminates the repeated case "$name" in ruflo) ... esac pattern.

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
