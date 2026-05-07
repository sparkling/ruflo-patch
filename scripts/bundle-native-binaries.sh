#!/usr/bin/env bash
# scripts/bundle-native-binaries.sh — Copy .node binaries into parent NAPI packages
#
# Bundles darwin-arm64 native binaries directly inside parent package dirs
# so the NAPI loader finds them via local file check (step 1 of two-step
# resolution). This eliminates the need to publish ~80 separate platform packages.
#
# Called by: copy-source.sh after rsync, before codemod.
# ADR-0071: RuVector Native Binary Management
# ADR-0150: Generalised to multi-fork via lib/napi-config.sh

set -euo pipefail

BUILD_DIR="${1:?Usage: bundle-native-binaries.sh <build-dir>}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Source napi config (ADR-0150). lib/fork-paths.sh is needed by napi-config.sh.
# shellcheck source=/dev/null
source "${ROOT_DIR}/lib/fork-paths.sh"
# shellcheck source=/dev/null
source "${ROOT_DIR}/lib/napi-config.sh"

# Map fork dir to its location in /tmp/ruflo-build/. cross-repo for ruvector
# (legacy ADR-0071); v3/ for in-tree forks like agentic-flow.
fork_to_build_path() {
  local fork_dir="$1"
  case "$fork_dir" in
    "$FORK_DIR_RUVECTOR") echo "$BUILD_DIR/cross-repo/ruvector" ;;
    "$FORK_DIR_AGENTIC")  echo "$BUILD_DIR/cross-repo/agentic-flow" ;;
    *) echo "" ;;
  esac
}

# Legacy alias retained for the rvf-node helper below
RUVECTOR_DIR="$(fork_to_build_path "$FORK_DIR_RUVECTOR")"

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

# copy_binary SRC_DIR DEST_DIR DISPLAY_PREFIX
#   Finds *.${TRIPLE}.node files in SRC_DIR and copies them to DEST_DIR.
#   Skips silently when the source dir or binary does not exist.
copy_binary() {
  local src_dir="$1"
  local dest_dir="$2"
  local display_prefix="${3:-$src_dir}"

  if [[ ! -d "$src_dir" ]]; then
    echo "  skip: source dir missing — ${src_dir#"$display_prefix/"}"
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
    echo "  skip: no *.${TRIPLE}.node in ${src_dir#"$display_prefix/"}"
    skipped=$((skipped + 1))
  fi
}

echo "=== bundle-native-binaries === platform=${TRIPLE}"
echo ""

# ── Iterate NAPI_PACKAGES (ADR-0150) ────────────────────────────────────
# Each entry maps a SOURCE crate dir → DEST npm-publish dir. The build tree
# ($BUILD_DIR) mirrors fork structure under cross-repo/<name> or v3/<name>,
# so we translate the fork-relative paths from the config to build-tree paths.

# ADR-0154 G3 (2026-05-07): copy cross-compiled prebuilds from npm/<platform>/
# subdirs into the package root as `index.<platform>.node` so the napi
# dispatcher's local-file check finds them. Without this, only the host
# platform's binary loads at runtime; cross-compiled binaries (e.g.
# linux-x64-musl produced via `napi build --target ...`) ship in the tarball
# but the dispatcher can't find them — falls through to a non-existent
# per-platform package and crashes with MODULE_NOT_FOUND on Alpine.
copy_crossbuilt_to_root() {
  local crate_dir="$1"
  local display_prefix="${2:-$crate_dir}"
  local binary_name="$3"
  local npm_dir="${crate_dir}/npm"
  if [[ ! -d "$npm_dir" ]]; then return; fi
  for plat_dir in "$npm_dir"/*/; do
    [[ -d "$plat_dir" ]] || continue
    local plat
    plat="$(basename "$plat_dir")"
    local source_file="${plat_dir}${binary_name}.${plat}.node"
    local target_file="${crate_dir}/index.${plat}.node"
    if [[ -f "$source_file" ]] && [[ ! -f "$target_file" ]]; then
      cp -p "$source_file" "$target_file"
      echo "  ✓ crossbuilt → root: ${target_file#"$display_prefix/"}"
      copied=$((copied + 1))
    fi
  done
}

for entry in "${NAPI_PACKAGES[@]}"; do
  napi_parse_entry "$entry" || continue
  build_root=$(fork_to_build_path "$NAPI_FORK_DIR")
  if [[ -z "$build_root" ]]; then
    echo "  skip: unmapped fork ${NAPI_FORK_DIR}"
    skipped=$((skipped + 1))
    continue
  fi
  if [[ ! -d "$build_root" ]]; then
    echo "  skip: build root missing for $(basename "$NAPI_FORK_DIR")"
    continue
  fi

  src_dir="${build_root}/${NAPI_CRATE_PATH}"
  dest_dir="${build_root}/${NAPI_DEST_NPM_DIR}"

  # ADR-0154 G3: also bundle cross-compiled prebuilds (e.g. linux-x64-musl
  # built on macOS via the messense toolchain). The `binaryName` is read
  # from the napi block in package.json — for rvf-node it's "rvf-node",
  # for ruvector-node it's "ruvector-node", etc.
  if [[ -f "${src_dir}/package.json" ]]; then
    bin_name=$(jq -r '.napi.binaryName // empty' "${src_dir}/package.json" 2>/dev/null)
    if [[ -n "$bin_name" ]]; then
      copy_crossbuilt_to_root "$src_dir" "$build_root" "$bin_name"
    fi
  fi

  # When src == dest (single-binary packages like agentic-jujutsu), the binary
  # is already in the publish dir — bundling is a no-op verification.
  if [[ "$src_dir" == "$dest_dir" ]]; then
    if [[ -d "$src_dir" ]] && ls "$src_dir"/*."${TRIPLE}".node >/dev/null 2>&1; then
      echo "  ✓ in-place: $(basename "$NAPI_FORK_DIR")/${NAPI_CRATE_PATH} (binary already at publish dir)"
      copied=$((copied + 1))
    else
      echo "  skip: no binary at $(basename "$NAPI_FORK_DIR")/${NAPI_CRATE_PATH}/*.${TRIPLE}.node"
      skipped=$((skipped + 1))
    fi
    continue
  fi

  copy_binary "$src_dir" "$dest_dir" "$build_root"
done

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
