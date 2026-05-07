#!/usr/bin/env bash
# scripts/verify-alpine.sh — ADR-0154 R4 / G3 mitigation verification.
#
# The Alpine/musl prebuild was added to forks/ruvector/crates/rvf/rvf-node/
# npm/linux-x64-musl/ via cross-compile on macOS. Without a Docker load test
# in CI, the prebuild ships verified-only-at-the-file-level — the actual
# runtime behavior on Alpine is unverified.
#
# This script closes that gap. Runs on demand against the current published
# `@sparkleideas/cli@latest` on Verdaccio.
#
# What it asserts:
#   1. Pull `node:alpine` Docker image.
#   2. Run a fresh container, install `@sparkleideas/cli@latest` from
#      Verdaccio (forwarded via --add-host=host.docker.internal:host-gateway).
#   3. Inside the container, `require('@sparkleideas/ruvector-rvf-node')`.
#   4. Pass: the dispatcher selects the linux-x64-musl prebuild + loads.
#   5. Fail: dispatcher errors with MODULE_NOT_FOUND or symbol resolution
#      failure → R4 mitigation incomplete; the prebuild is unloadable on
#      Alpine despite shipping in the tarball.
#
# Usage:
#   bash scripts/verify-alpine.sh
#   bash scripts/verify-alpine.sh --registry http://host.docker.internal:4873
#
# Exit codes:
#   0 — Alpine load verified
#   1 — Docker not available (CI infrastructure missing)
#   2 — Verdaccio unreachable
#   3 — Native binding load failed (R4 mitigation broken)
#   4 — npm install failed
#
# Per CLAUDE.md feedback-no-fallbacks: any failure mode is loud + explicit.

set -uo pipefail

# ── Defaults ─────────────────────────────────────────────────────────────
REGISTRY="${REGISTRY:-http://host.docker.internal:4873}"
HOST_REGISTRY="${HOST_REGISTRY:-http://localhost:4873}"
# Default: install ONLY the rvf-node package + its umbrella dependency. The
# full @sparkleideas/cli pulls better-sqlite3 (a different native binding
# that lacks an Alpine prebuild and requires Python + g++ to build from
# source — not the test target). Override with `--package <name>` if you
# want to verify the full CLI stack on a richer base image.
PACKAGE="${PACKAGE:-@sparkleideas/ruvector-rvf-node@latest}"
NATIVE_PACKAGE="${NATIVE_PACKAGE:-@sparkleideas/ruvector-rvf-node}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --registry) REGISTRY="$2"; shift 2 ;;
    --package)  PACKAGE="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,40p' "$0" | sed 's/^# *//'
      exit 0 ;;
    *) echo "unknown flag: $1" >&2; exit 1 ;;
  esac
done

log()    { echo "[verify-alpine] $*" >&2; }
log_ok() { echo "[verify-alpine] ✓ $*" >&2; }
log_err(){ echo "[verify-alpine] ✗ $*" >&2; }

# ── Pre-flight ───────────────────────────────────────────────────────────

if ! command -v docker >/dev/null 2>&1; then
  log_err "docker not found in PATH. Install Docker Desktop (or any docker daemon) and re-run."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  log_err "docker daemon is not responding. Start Docker Desktop and re-run."
  exit 1
fi

if ! curl -sf --max-time 3 "$HOST_REGISTRY/-/ping" >/dev/null 2>&1; then
  log_err "Verdaccio unreachable at $HOST_REGISTRY. Bring it up (memory reference-verdaccio.md says it's always-on) and re-run."
  exit 2
fi

log "Verdaccio: reachable at $HOST_REGISTRY (will be exposed as $REGISTRY inside the container)."

# ── Docker image pull (idempotent) ───────────────────────────────────────

log "pulling node:alpine ..."
docker pull node:alpine >/dev/null 2>&1 || {
  log_err "docker pull node:alpine failed."
  exit 1
}

# ── Compose the in-container script ──────────────────────────────────────
# Steps: install @sparkleideas/cli@latest from Verdaccio, then `require`
# the native binding inside node. The require() will trigger the napi
# dispatcher's isMusl() branch (index.js detects musl libc) and load
# ./index.linux-x64-musl.node OR @sparkleideas/ruvector-rvf-node-linux-x64-musl.

CONTAINER_SCRIPT=$(cat <<'INNER'
set -e
echo "[container] node version: $(node -v)"
echo "[container] npm version: $(npm -v)"
echo "[container] arch: $(uname -m)"
echo "[container] libc: $(ldd --version 2>&1 | head -1)"

# Use a scratch dir so we don't pollute /tmp's permissions.
mkdir -p /tmp/verify-alpine && cd /tmp/verify-alpine
npm init -y >/dev/null 2>&1
npm config set registry "$REGISTRY"

echo "[container] installing $PACKAGE from $REGISTRY ..."
if ! npm install --no-audit --no-fund --prefer-online "$PACKAGE" >/tmp/install.log 2>&1; then
  echo "[container] npm install failed:"
  tail -30 /tmp/install.log
  exit 4
fi

echo "[container] resolving $NATIVE_PACKAGE via dispatcher ..."
node -e "
  const path = require('path');
  const dispatcher = require.resolve('$NATIVE_PACKAGE');
  console.log('[container] dispatcher path:', dispatcher);
  const native = require('$NATIVE_PACKAGE');
  if (!native || typeof native !== 'object') {
    console.error('[container] dispatcher resolved but returned non-object:', typeof native);
    process.exit(3);
  }
  // Native exports must include RvfDatabase (the canonical class).
  if (typeof native.RvfDatabase !== 'function') {
    console.error('[container] missing RvfDatabase export. Got keys:', Object.keys(native));
    process.exit(3);
  }
  console.log('[container] ✓ RvfDatabase loaded successfully on Alpine musl.');
" || {
  rc=$?
  echo "[container] native binding load failed (exit $rc)"
  exit "$rc"
}
INNER
)

# ── Run the container ────────────────────────────────────────────────────

log "running node:alpine container (--platform=linux/amd64 to match the linux-x64-musl prebuild)..."
TMP_OUT=$(mktemp -t verify-alpine-out.XXXXXX)
trap 'rm -f "$TMP_OUT"' EXIT

# --platform=linux/amd64 forces x86_64 even on ARM hosts (Apple Silicon via
# OrbStack/Docker Desktop). Without it, Apple Silicon gets a linux/arm64
# image whose dispatcher looks for @sparkleideas/ruvector-rvf-node-linux-
# arm64-musl — a prebuild we do not ship today (deferred until ARM Alpine
# becomes a release target).
if docker run --rm \
  --platform=linux/amd64 \
  --add-host=host.docker.internal:host-gateway \
  -e REGISTRY="$REGISTRY" \
  -e PACKAGE="$PACKAGE" \
  -e NATIVE_PACKAGE="$NATIVE_PACKAGE" \
  node:alpine sh -c "$CONTAINER_SCRIPT" 2>&1 | tee "$TMP_OUT"; then
  log_ok "Alpine load verified — $NATIVE_PACKAGE loads on linux-x64-musl."
  exit 0
else
  rc=$?
  log_err "container exited $rc"
  case "$rc" in
    3) log_err "Native binding failed to load. R4 mitigation is incomplete: the linux-x64-musl prebuild ships in the tarball but does not load on Alpine. Likely cause: cross-compile produced a binary with wrong dependencies, missing symbols, or relocation issues. Check the build host's musl-cross toolchain version + recompile." ;;
    4) log_err "npm install failed inside the container. Verdaccio reachable from host but not from container? Check --add-host flag." ;;
    *) log_err "unexpected failure mode. Output saved to $TMP_OUT (will be deleted on exit; copy now if needed)." ;;
  esac
  exit "$rc"
fi
