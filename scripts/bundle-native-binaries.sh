#!/usr/bin/env bash
# scripts/bundle-native-binaries.sh — Copy .node binaries into parent NAPI packages
#
# Bundles darwin-arm64 native binaries directly inside parent package dirs
# so the NAPI loader finds them via local file check (step 1 of two-step
# resolution). This eliminates the need to publish ~80 separate platform packages.
#
# Called by: copy-source.sh after rsync, before codemod.
# ADR-0071: RuVector Native Binary Management

set -euo pipefail

BUILD_DIR="${1:?Usage: bundle-native-binaries.sh <build-dir>}"
RUVECTOR_DIR="$BUILD_DIR/cross-repo/ruvector"

# Detect platform
PLATFORM="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
case "$ARCH" in
  aarch64|arm64) ARCH="arm64" ;;
  x86_64)        ARCH="x64"   ;;
esac
TRIPLE="${PLATFORM}-${ARCH}"   # e.g. darwin-arm64

copied=0
skipped=0

# copy_binary SRC_DIR DEST_DIR
#   Finds *.${TRIPLE}.node files in SRC_DIR and copies them to DEST_DIR.
#   Skips silently when the source dir or binary does not exist.
copy_binary() {
  local src_dir="$1"
  local dest_dir="$2"

  if [[ ! -d "$src_dir" ]]; then
    echo "  skip: source dir missing — ${src_dir#"$RUVECTOR_DIR/"}"
    skipped=$((skipped + 1))
    return
  fi

  local found=0
  for f in "$src_dir"/*."${TRIPLE}".node; do
    [[ -e "$f" ]] || continue
    found=1
    mkdir -p "$dest_dir"
    cp -v "$f" "$dest_dir/"
    copied=$((copied + 1))
  done

  if [[ $found -eq 0 ]]; then
    echo "  skip: no *.${TRIPLE}.node in ${src_dir#"$RUVECTOR_DIR/"}"
    skipped=$((skipped + 1))
  fi
}

echo "=== bundle-native-binaries === platform=${TRIPLE}"
echo "    ruvector dir: $RUVECTOR_DIR"
echo ""

if [[ ! -d "$RUVECTOR_DIR" ]]; then
  echo "WARN: ruvector dir does not exist — nothing to bundle"
  exit 0
fi

# ── Mappings: crate build dir → parent package dir ──────────────────────

copy_binary \
  "$RUVECTOR_DIR/crates/ruvector-graph-node" \
  "$RUVECTOR_DIR/npm/packages/graph-node"

copy_binary \
  "$RUVECTOR_DIR/crates/ruvector-node" \
  "$RUVECTOR_DIR/npm/packages/core"

copy_binary \
  "$RUVECTOR_DIR/crates/ruvector-router-ffi" \
  "$RUVECTOR_DIR/npm/packages/router"

copy_binary \
  "$RUVECTOR_DIR/crates/ruvector-tiny-dancer-node" \
  "$RUVECTOR_DIR/npm/packages/tiny-dancer"

copy_binary \
  "$RUVECTOR_DIR/crates/sona" \
  "$RUVECTOR_DIR/npm/packages/sona"

copy_binary \
  "$RUVECTOR_DIR/examples/ruvLLM" \
  "$RUVECTOR_DIR/npm/packages/ruvllm"

echo ""
echo "=== bundle-native-binaries === done: ${copied} copied, ${skipped} skipped"
