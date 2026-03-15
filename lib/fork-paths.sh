# lib/fork-paths.sh — Fork directory constants (ADR-0039)
#
# Single source of truth for fork directories and upstream URLs.
# Sourceable library — no `set -euo pipefail` (caller provides).
#
# Consumers: sync-and-build.sh, copy-source.sh, deploy-finalize.sh,
#            ruflo-publish.sh, ruflo-sync.sh

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
