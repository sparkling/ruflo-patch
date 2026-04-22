#!/usr/bin/env bash
# check-patches.sh — advisory fork-health probe for ruflo-patch
#
# Wired as a SessionStart hook by settings-generator.ts. Detects common fork
# drift states (detached HEAD, missing push remote, wrong build branch) and
# warns to stderr. This hook is ADVISORY: it must never abort the session,
# so we always exit 0 at the end. Drift surfaces as visible `[check-patches]`
# stderr warnings — no silent catch-and-swallow, no silent-pass fallbacks.
#
# Args:
#   --global   no-op; kept for backwards compat with settings-generator wiring
#   -h|--help  print usage and exit 0
#
# Exit: always 0.

set -u

usage() {
  cat <<'EOF'
Usage: check-patches.sh [--global] [-h|--help]

Advisory SessionStart hook: inspects sibling forks in ../forks/ and warns
to stderr when a fork is in a drifted state (detached HEAD, missing
'sparkling' remote, or on a branch other than 'main').

Options:
  --global    No-op flag kept for backwards compatibility with the
              fork-side settings-generator wiring.
  -h, --help  Print this help and exit 0.

Exit status is always 0; warnings never abort the session.
EOF
}

# Parse args; unknown args are tolerated silently.
for arg in "$@"; do
  case "$arg" in
    --global)
      # no-op, preserved for backwards compat
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      # Tolerate unknown args — advisory hook must not fail hard.
      ;;
  esac
done

# Resolve repo root. If we're not in a git repo, quietly exit 0: there is
# nothing meaningful to probe (user is likely outside the project tree).
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$REPO_ROOT" ]; then
  exit 0
fi

FORKS_DIR="$(cd "$REPO_ROOT/.." 2>/dev/null && pwd)/forks"
if [ ! -d "$FORKS_DIR" ]; then
  # No forks directory alongside the patch repo. Nothing to check, but we
  # do NOT swallow this silently — emit a one-line advisory so missing
  # scaffolding is visible.
  echo "[check-patches] no sibling ../forks/ directory at $FORKS_DIR — skipping fork health probe" >&2
  exit 0
fi

EXPECTED_FORKS="ruflo agentic-flow ruv-FANN claude-flow-helpers"
EXPECTED_BRANCH="main"
EXPECTED_REMOTE="sparkling"

DRIFT=0

for fork_name in $EXPECTED_FORKS; do
  fork_path="$FORKS_DIR/$fork_name"
  if [ ! -d "$fork_path/.git" ] && [ ! -f "$fork_path/.git" ]; then
    # Missing fork is not necessarily drift (may be intentional on some
    # machines), but we note it at a lower emphasis.
    continue
  fi

  # Detached HEAD check
  current_ref="$(git -C "$fork_path" symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
  if [ -z "$current_ref" ]; then
    detached_sha="$(git -C "$fork_path" rev-parse --short HEAD 2>/dev/null || echo "unknown")"
    echo "[check-patches] $fork_name: detached HEAD at $detached_sha (expected branch: $EXPECTED_BRANCH)" >&2
    DRIFT=$((DRIFT + 1))
  elif [ "$current_ref" != "$EXPECTED_BRANCH" ]; then
    echo "[check-patches] $fork_name: on branch '$current_ref' (expected '$EXPECTED_BRANCH' for build pipeline)" >&2
    DRIFT=$((DRIFT + 1))
  fi

  # Missing push remote check
  if ! git -C "$fork_path" remote get-url "$EXPECTED_REMOTE" >/dev/null 2>&1; then
    echo "[check-patches] $fork_name: missing '$EXPECTED_REMOTE' remote (required push target for ruflo-patch builds)" >&2
    DRIFT=$((DRIFT + 1))
  fi
done

if [ "$DRIFT" -gt 0 ]; then
  echo "[check-patches] $DRIFT fork-health issue(s) detected — review warnings above" >&2
fi

# Advisory hook: always exit 0 so SessionStart never wedges the pipeline.
exit 0
