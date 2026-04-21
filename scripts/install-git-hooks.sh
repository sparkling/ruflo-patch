#!/bin/sh
# scripts/install-git-hooks.sh — Install ADR-0097 Tier Y pre-push hook.
#
# Creates .git/hooks/pre-push that runs `node scripts/check-tier-y-gate.mjs`
# before allowing a push. Safe to re-run (idempotent: overwrites only our
# hook, warns if a different hook already exists).

set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
HOOK_DIR="$ROOT/.git/hooks"
HOOK_PATH="$HOOK_DIR/pre-push"
MARKER="# managed-by: scripts/install-git-hooks.sh (ADR-0097 Tier Y)"

if [ ! -d "$ROOT/.git" ]; then
  echo "ERROR: $ROOT is not a git working tree" >&2
  exit 1
fi

mkdir -p "$HOOK_DIR"

if [ -e "$HOOK_PATH" ] && ! grep -q "$MARKER" "$HOOK_PATH" 2>/dev/null; then
  echo "WARNING: $HOOK_PATH exists and was not installed by this script." >&2
  echo "         Move it aside, then re-run this installer." >&2
  exit 1
fi

cat > "$HOOK_PATH" <<'HOOK'
#!/bin/sh
# managed-by: scripts/install-git-hooks.sh (ADR-0097 Tier Y)
# Tier Y gate: reject new lib/acceptance-*-checks.sh without paired test.

ROOT=$(git rev-parse --show-toplevel)
if [ -z "$ROOT" ]; then
  echo "pre-push: not inside a git repo" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "pre-push: node not found on PATH; skipping ADR-0097 gate" >&2
  exit 0
fi

exec node "$ROOT/scripts/check-tier-y-gate.mjs"
HOOK

chmod +x "$HOOK_PATH"
echo "Installed ADR-0097 Tier Y pre-push hook at $HOOK_PATH"
