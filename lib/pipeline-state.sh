# lib/pipeline-state.sh — Pipeline mutable state declarations (C1: single source of truth)
#
# Sourceable library — no `set -euo pipefail` (caller provides).
# All pipeline mutable state is declared here ONCE. Scripts source this
# instead of re-declaring the same variables independently.
#
# Consumers: ruflo-publish.sh, ruflo-sync.sh, deploy-finalize.sh

# ---------------------------------------------------------------------------
# Fork HEAD SHAs (set by merge detection / sync, read by state save)
# ---------------------------------------------------------------------------

NEW_RUFLO_HEAD=""
NEW_AGENTIC_HEAD=""
NEW_FANN_HEAD=""
NEW_RUVECTOR_HEAD=""

# ---------------------------------------------------------------------------
# Upstream SHAs (loaded from state, updated by sync)
# ---------------------------------------------------------------------------

UPSTREAM_RUFLO_SHA=""
UPSTREAM_AGENTIC_SHA=""
UPSTREAM_FANN_SHA=""
UPSTREAM_RUVECTOR_SHA=""

# ---------------------------------------------------------------------------
# Selective version bumping (publish-only)
# ---------------------------------------------------------------------------

CHANGED_FORK_SHAS=""           # format: dir1:oldSha,dir2:oldSha
CHANGED_PACKAGES_JSON="all"    # JSON array of @sparkleideas/* packages (full transitive set)
DIRECTLY_CHANGED_JSON="all"    # source-changed only (for build, no transitive deps)

# ---------------------------------------------------------------------------
# Build artifacts
# ---------------------------------------------------------------------------

BUILD_VERSION=""
BUILD_COMPILED_COUNT=""
BUILD_TOTAL_COUNT=""
TEMP_DIR=""

# ---------------------------------------------------------------------------
# Deferred operations
# ---------------------------------------------------------------------------

PENDING_VERSION_PUSHES=()

# ---------------------------------------------------------------------------
# Infrastructure
# ---------------------------------------------------------------------------

GLOBAL_TIMEOUT_PID=""
