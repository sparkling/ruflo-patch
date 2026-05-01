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

# ADR-0095 amendment (2026-05-01): rvf-node added to the bundle list.
# Without this entry, the `.node` binary in `npm/packages/rvf-node/` was
# only updated when the developer manually ran `napi build` + committed
# the result. Any change to `crates/rvf/rvf-runtime/src/locking.rs` (or
# any other rvf-runtime/rvf-node Rust source) silently shipped the
# previous binary because the cascade had no way to refresh it. The
# rebuild-when-stale logic below walks `.rs` files newer than the existing
# binary and triggers `napi build --release` if needed; a fresh build
# emits to `crates/rvf/rvf-node/index.${TRIPLE}.node`, which the existing
# `copy_binary` then copies to the publishable location.
maybe_rebuild_rvf_node() {
  local crate_dir="$RUVECTOR_DIR/crates/rvf/rvf-node"
  local binary="$crate_dir/index.${TRIPLE}.node"
  local needs_rebuild=0

  if [[ ! -f "$binary" ]]; then
    needs_rebuild=1
  else
    # Any Rust source newer than the binary triggers a rebuild. -newer
    # checks mtime; under git checkouts this is reliable because git sets
    # mtime on changed files.
    while IFS= read -r src; do
      if [[ "$src" -nt "$binary" ]]; then
        needs_rebuild=1
        break
      fi
    done < <(find "$RUVECTOR_DIR/crates/rvf" -name '*.rs' -type f 2>/dev/null)
  fi

  if [[ "$needs_rebuild" -eq 0 ]]; then
    return 0
  fi

  if ! command -v napi >/dev/null 2>&1 || ! command -v cargo >/dev/null 2>&1; then
    echo "  WARN: rvf-node Rust source is newer than ${binary##*/} but napi/cargo not found — shipping stale binary"
    return 0
  fi

  echo "  rebuild rvf-node: Rust source newer than ${binary##*/}"
  ( cd "$crate_dir" && napi build --platform --release --cargo-cwd . >/dev/null 2>&1 )
}

maybe_rebuild_rvf_node

# Map crates/rvf/rvf-node/index.<triple>.node → npm/packages/rvf-node/rvf-node.<triple>.node
copy_rvf_node_binary() {
  local src="$RUVECTOR_DIR/crates/rvf/rvf-node/index.${TRIPLE}.node"
  local dest_dir="$RUVECTOR_DIR/npm/packages/rvf-node"
  local dest="$dest_dir/rvf-node.${TRIPLE}.node"
  if [[ ! -f "$src" ]]; then
    echo "  skip: no rvf-node binary at crates/rvf/rvf-node/index.${TRIPLE}.node"
    skipped=$((skipped + 1))
    return
  fi
  mkdir -p "$dest_dir"
  cp -v "$src" "$dest"
  copied=$((copied + 1))
}

copy_rvf_node_binary

echo ""
echo "=== bundle-native-binaries === done: ${copied} copied, ${skipped} skipped"
