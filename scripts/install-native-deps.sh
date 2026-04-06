#!/usr/bin/env bash
# scripts/install-native-deps.sh — Build ALL @ruvector NAPI-RS binaries from source
#
# Why: upstream npm binaries are opaque .node files with no embedded provenance.
# 4 of 10 have no git tag. ruvllm@2.3.0 was never published. We can't verify
# what's in the npm binaries. Building from source gives us traceable SHAs.
#
# Build strategy:
#   - Packages WITH a tag: checkout tag, build, record tag SHA
#   - Packages WITHOUT a tag: build from fork HEAD, record HEAD SHA
#   - Pure JS packages: install from npm (no binary to build)
#
# Requires: Rust toolchain (cargo), @napi-rs/cli (napi), ruvector fork
# Idempotent: skips if binary already exists with matching SHA.
#
# Usage: npm run setup:native   OR   bash scripts/install-native-deps.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

source "${PROJECT_DIR}/lib/fork-paths.sh"

log() { echo "[$(date -u '+%H:%M:%S')] $*" >&2; }

AGENTIC_DIR="${FORK_DIR_AGENTIC}"
NODE_MODULES="${AGENTIC_DIR}/node_modules"
RUVECTOR_DIR="${FORK_DIR_RUVECTOR}"
TMPDIR="${TMPDIR:-/tmp}/ruflo-native-deps"

if [[ ! -d "${NODE_MODULES}" ]]; then
  log "SKIP: ${NODE_MODULES} does not exist (run npm install first)"
  exit 0
fi

mkdir -p "${TMPDIR}"

# Source cargo env
[[ -f "$HOME/.cargo/env" ]] && source "$HOME/.cargo/env" 2>/dev/null

# --- Platform detection ---
PLATFORM="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
case "${ARCH}" in
  x86_64)  ARCH="x64" ;;
  aarch64) ARCH="arm64" ;;
  arm64)   ARCH="arm64" ;;
esac

# --- Check prerequisites ---
HAS_RUST=false
HAS_NAPI=false
command -v cargo &>/dev/null && HAS_RUST=true
command -v napi &>/dev/null && HAS_NAPI=true

if ! $HAS_RUST || ! $HAS_NAPI; then
  log "WARN: Missing build tools (cargo=$HAS_RUST, napi=$HAS_NAPI)"
  log "WARN: Install: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh && npm i -g @napi-rs/cli"
  log "WARN: Falling back to npm binaries where available"
fi

# ============================================================================
# Helper: install pure JS package from npm
# ============================================================================

install_pure_pkg() {
  local pkg_name="$1"
  local pkg_version="$2"
  local target_dir="${NODE_MODULES}/${pkg_name}"

  if [[ -f "${target_dir}/package.json" ]]; then
    local v; v=$(node -e "console.log(require('${target_dir}/package.json').version)" 2>/dev/null || echo "")
    if [[ "${v}" == "${pkg_version}" ]]; then
      log "OK: ${pkg_name}@${v} (pure JS)"
      return 0
    fi
  fi

  log "Installing ${pkg_name}@${pkg_version} (pure JS)..."
  local packed; packed=$(echo "${pkg_name}" | sed 's/@//; s/\//-/g')
  local tarball="${TMPDIR}/${packed}-${pkg_version}.tgz"
  [[ ! -f "${tarball}" ]] && npm pack "${pkg_name}@${pkg_version}" --pack-destination "${TMPDIR}" --silent 2>/dev/null
  mkdir -p "${target_dir}"
  tar xzf "${tarball}" -C "${TMPDIR}" 2>/dev/null
  cp -r "${TMPDIR}/package/"* "${target_dir}/"
  rm -rf "${TMPDIR}/package"
  log "OK: ${pkg_name}@${pkg_version} installed"
}

# ============================================================================
# Helper: build NAPI binary from ruvector fork source
# ============================================================================

# build_from_source <npm_pkg_name> <platform_pkg_name> <crate_dir> <napi_crate_name> <git_ref> <upstream_declared_ver>
#
# git_ref: tag name (e.g. "v0.1.31") or "HEAD" for fork HEAD
# upstream_declared_ver: what the parent package.json optionalDeps says (for documentation)
build_from_source() {
  local npm_pkg="$1"           # e.g. @ruvector/attention
  local platform_pkg="$2"     # e.g. @ruvector/attention-darwin-arm64
  local crate_dir="$3"        # e.g. crates/ruvector-attention-node (relative to ruvector fork)
  local crate_name="$4"       # e.g. ruvector-attention-node (Cargo package name)
  local git_ref="$5"          # e.g. v0.1.31 or HEAD
  local declared_ver="$6"     # e.g. 0.1.31

  local binary_dir="${NODE_MODULES}/${platform_pkg}"
  local output_name
  # Derive .node filename from crate name (napi convention: crate-name.platform-arch.node)
  output_name=$(echo "${crate_name}" | tr '-' '_')

  # Resolve SHA (always from HEAD — we build the latest fork code)
  local sha
  sha=$(git -C "${RUVECTOR_DIR}" rev-parse --short HEAD 2>/dev/null || echo "unknown")

  # Skip if already built from this SHA
  if [[ -f "${binary_dir}/package.json" ]]; then
    local existing_sha; existing_sha=$(node -e "try{console.log(require('${binary_dir}/package.json')._gitSha)}catch{console.log('')}" 2>/dev/null)
    if [[ "${existing_sha}" == "${sha}" ]]; then
      log "OK: ${platform_pkg} (SHA ${sha}, already built)"
      return 0
    fi
  fi

  if ! $HAS_RUST || ! $HAS_NAPI; then
    log "SKIP: ${platform_pkg} (no Rust/napi toolchain — install to build from source)"
    return 1
  fi

  local full_crate_dir="${RUVECTOR_DIR}/${crate_dir}"
  if [[ ! -f "${full_crate_dir}/Cargo.toml" ]]; then
    log "WARN: ${platform_pkg} — crate not found at ${crate_dir}"
    return 1
  fi

  log "Building ${platform_pkg} from HEAD (SHA ${sha})..."

  (
    cd "${full_crate_dir}" && \
    napi build --platform --release --cargo-cwd . 2>&1 | tail -3
  )

  # Find the built .node file
  local built_node
  built_node=$(find "${full_crate_dir}" -maxdepth 1 -name "*.${PLATFORM}-${ARCH}.node" -newer "${full_crate_dir}/Cargo.toml" -type f 2>/dev/null | head -1)
  # Fallback: check index.platform-arch.node pattern
  [[ -z "${built_node}" ]] && built_node="${full_crate_dir}/index.${PLATFORM}-${ARCH}.node"

  if [[ -f "${built_node}" ]]; then
    mkdir -p "${binary_dir}"
    local dest_name
    dest_name=$(basename "${built_node}")
    cp "${built_node}" "${binary_dir}/${dest_name}"

    cat > "${binary_dir}/package.json" << PKGJSON
{
  "name": "${platform_pkg}",
  "version": "0.0.0-sha.${sha}",
  "description": "Built from source. Upstream declared ${declared_ver}. Ref: ${git_ref}.",
  "os": ["${PLATFORM}"],
  "cpu": ["${ARCH}"],
  "main": "${dest_name}",
  "license": "MIT",
  "_upstreamDeclaredVersion": "${declared_ver}",
  "_gitRef": "${git_ref}",
  "_gitSha": "${sha}",
  "_builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
PKGJSON
    log "OK: ${platform_pkg} (SHA ${sha}, ref ${git_ref})"
  else
    log "WARN: ${platform_pkg} build produced no .node file"
  fi
}

# ============================================================================
# Helper: install npm fallback if build_from_source is not available
# ============================================================================

install_npm_fallback() {
  local pkg_name="$1"
  local pkg_version="$2"
  local platform_pkg="$3"
  local platform_version="$4"

  local target_dir="${NODE_MODULES}/${pkg_name}"
  local platform_dir="${NODE_MODULES}/${platform_pkg}"

  if [[ -f "${platform_dir}/package.json" ]]; then
    log "OK: ${platform_pkg} already installed (npm fallback)"
    return 0
  fi

  log "Installing ${pkg_name}@${pkg_version} from npm (fallback — no source build)..."

  for dir_pkg_ver in "${pkg_name}@${pkg_version}:${target_dir}" "${platform_pkg}@${platform_version}:${platform_dir}"; do
    local spec="${dir_pkg_ver%%:*}"
    local dest="${dir_pkg_ver##*:}"
    local packed; packed=$(echo "${spec%%@*}" | sed 's/@//; s/\//-/g')
    local ver="${spec##*@}"
    local tarball="${TMPDIR}/${packed}-${ver}.tgz"
    [[ ! -f "${tarball}" ]] && npm pack "${spec}" --pack-destination "${TMPDIR}" --silent 2>/dev/null || continue
    mkdir -p "${dest}"
    tar xzf "${tarball}" -C "${TMPDIR}" 2>/dev/null
    cp -r "${TMPDIR}/package/"* "${dest}/"
    rm -rf "${TMPDIR}/package"
  done
  log "OK: ${platform_pkg}@${platform_version} (npm fallback)"
}

# ============================================================================
# Pure JS packages (no binary to build)
# ============================================================================

install_pure_pkg "@ruvector/ruvllm" "2.5.4"
install_pure_pkg "@ruvector/rvf" "0.2.1"
install_pure_pkg "@ruvector/rvf-solver" "0.1.8"
install_pure_pkg "@ruvector/rvf-wasm" "0.1.6"

# ============================================================================
# NAPI-RS binaries — ALL built from fork HEAD
#
# Why HEAD, not tags: we're a fork with our own patches. Tags are upstream's
# stale release markers. Building from HEAD ensures our Rust changes (e.g.
# ADR-0068 dimension alignment) are included in every binary.
#
# | Package           | Crate                                | Upstream Declared |
# |-------------------|--------------------------------------|-------------------|
# | attention         | crates/ruvector-attention-node        | 0.1.31            |
# | core (unscoped)   | crates/ruvector-node                  | 0.1.29            |
# | gnn               | crates/ruvector-gnn-node              | 0.1.25            |
# | graph-node        | crates/ruvector-graph-node            | 2.0.2             |
# | graph-transformer | crates/ruvector-graph-transformer-node| 2.0.4             |
# | router            | crates/ruvector-router-ffi            | 0.1.27            |
# | ruvllm            | examples/ruvLLM (with -F napi)        | 2.3.0 (never published) |
# | rvf-node          | crates/rvf/rvf-node                   | 0.1.7             |
# | sona              | crates/sona                           | 0.1.5             |
# | tiny-dancer       | crates/ruvector-tiny-dancer-node      | 0.1.15            |
# ============================================================================

build_from_source \
  "@ruvector/attention" "@ruvector/attention-${PLATFORM}-${ARCH}" \
  "crates/ruvector-attention-node" "ruvector-attention-node" \
  "HEAD" "0.1.31" \
  || install_npm_fallback "@ruvector/attention" "0.1.31" "@ruvector/attention-${PLATFORM}-${ARCH}" "0.1.31"

# core uses UNSCOPED platform package names (ruvector-core-*, not @ruvector/core-*)
build_from_source \
  "@ruvector/core" "ruvector-core-${PLATFORM}-${ARCH}" \
  "crates/ruvector-node" "ruvector-node" \
  "HEAD" "0.1.29" \
  || install_npm_fallback "@ruvector/core" "0.1.31" "ruvector-core-${PLATFORM}-${ARCH}" "0.1.29"

build_from_source \
  "@ruvector/gnn" "@ruvector/gnn-${PLATFORM}-${ARCH}" \
  "crates/ruvector-gnn-node" "ruvector-gnn-node" \
  "HEAD" "0.1.25" \
  || install_npm_fallback "@ruvector/gnn" "0.1.25" "@ruvector/gnn-${PLATFORM}-${ARCH}" "0.1.25"

build_from_source \
  "@ruvector/graph-node" "@ruvector/graph-node-${PLATFORM}-${ARCH}" \
  "crates/ruvector-graph-node" "ruvector-graph-node" \
  "HEAD" "2.0.2" \
  || install_npm_fallback "@ruvector/graph-node" "2.0.3" "@ruvector/graph-node-${PLATFORM}-${ARCH}" "2.0.2"

build_from_source \
  "@ruvector/graph-transformer" "@ruvector/graph-transformer-${PLATFORM}-${ARCH}" \
  "crates/ruvector-graph-transformer-node" "ruvector-graph-transformer-node" \
  "HEAD" "2.0.4" \
  || install_npm_fallback "@ruvector/graph-transformer" "2.0.4" "@ruvector/graph-transformer-${PLATFORM}-${ARCH}" "2.0.4"

build_from_source \
  "@ruvector/router" "@ruvector/router-${PLATFORM}-${ARCH}" \
  "crates/ruvector-router-ffi" "ruvector-router-ffi" \
  "HEAD" "0.1.27" \
  || install_npm_fallback "@ruvector/router" "0.1.29" "@ruvector/router-${PLATFORM}-${ARCH}" "0.1.27"

build_from_source \
  "@ruvector/rvf-node" "@ruvector/rvf-node-${PLATFORM}-${ARCH}" \
  "crates/rvf/rvf-node" "rvf-node" \
  "HEAD" "0.1.7" \
  || install_npm_fallback "@ruvector/rvf-node" "0.1.8" "@ruvector/rvf-node-${PLATFORM}-${ARCH}" "0.1.7"

build_from_source \
  "@ruvector/sona" "@ruvector/sona-${PLATFORM}-${ARCH}" \
  "crates/sona" "ruvector-sona" \
  "HEAD" "0.1.5" \
  || install_npm_fallback "@ruvector/sona" "0.1.5" "@ruvector/sona-${PLATFORM}-${ARCH}" "0.1.5"

build_from_source \
  "@ruvector/tiny-dancer" "@ruvector/tiny-dancer-${PLATFORM}-${ARCH}" \
  "crates/ruvector-tiny-dancer-node" "ruvector-tiny-dancer-node" \
  "HEAD" "0.1.15" \
  || install_npm_fallback "@ruvector/tiny-dancer" "0.1.18" "@ruvector/tiny-dancer-${PLATFORM}-${ARCH}" "0.1.15"

# ruvllm: no tag, no npm binary at declared version. Must build from source.
# Build uses examples/ruvLLM with -F napi (special case — not a crate in crates/)
_ruvllm_binary_dir="${NODE_MODULES}/@ruvector/ruvllm-${PLATFORM}-${ARCH}"
_ruvllm_sha=$(git -C "${RUVECTOR_DIR}" rev-parse --short HEAD 2>/dev/null || echo "unknown")
if [[ -f "${_ruvllm_binary_dir}/package.json" ]]; then
  _existing_sha=$(node -e "try{console.log(require('${_ruvllm_binary_dir}/package.json')._gitSha)}catch{console.log('')}" 2>/dev/null)
  if [[ "${_existing_sha}" == "${_ruvllm_sha}" ]]; then
    log "OK: @ruvector/ruvllm-${PLATFORM}-${ARCH} (SHA ${_ruvllm_sha}, already built)"
  fi
elif $HAS_RUST && $HAS_NAPI && [[ -f "${RUVECTOR_DIR}/examples/ruvLLM/Cargo.toml" ]]; then
  _cargo_ver=$(grep '^version' "${RUVECTOR_DIR}/examples/ruvLLM/Cargo.toml" | head -1 | sed 's/.*"\(.*\)"/\1/')
  log "Building @ruvector/ruvllm-${PLATFORM}-${ARCH} from source (Cargo ${_cargo_ver}, SHA ${_ruvllm_sha})..."
  ( cd "${RUVECTOR_DIR}/examples/ruvLLM" && napi build --platform --release --features napi --cargo-cwd . 2>&1 | tail -3 )
  _built="${RUVECTOR_DIR}/examples/ruvLLM/index.${PLATFORM}-${ARCH}.node"
  if [[ -f "${_built}" ]]; then
    mkdir -p "${_ruvllm_binary_dir}"
    cp "${_built}" "${_ruvllm_binary_dir}/ruvllm.${PLATFORM}-${ARCH}.node"
    cat > "${_ruvllm_binary_dir}/package.json" << PKGJSON
{
  "name": "@ruvector/ruvllm-${PLATFORM}-${ARCH}",
  "version": "0.0.0-sha.${_ruvllm_sha}",
  "description": "Built from fork HEAD. Upstream declared 2.3.0 (commit 02cde183) but never tagged/built/published it. Cargo.toml: ${_cargo_ver}.",
  "os": ["${PLATFORM}"],
  "cpu": ["${ARCH}"],
  "main": "ruvllm.${PLATFORM}-${ARCH}.node",
  "license": "MIT",
  "_upstreamDeclaredVersion": "2.3.0",
  "_gitRef": "HEAD",
  "_gitSha": "${_ruvllm_sha}",
  "_cargoVersion": "${_cargo_ver}",
  "_builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
PKGJSON
    log "OK: @ruvector/ruvllm-${PLATFORM}-${ARCH} (SHA ${_ruvllm_sha})"
  else
    log "WARN: ruvllm build produced no output"
  fi
else
  log "SKIP: @ruvector/ruvllm-${PLATFORM}-${ARCH} (no Rust toolchain or ruvector fork)"
fi

# Also install the parent JS packages for npm-fallback packages
# (build_from_source only builds the binary; the parent JS may not be installed)
for pkg_ver in "@ruvector/attention:0.1.31" "@ruvector/core:0.1.31" "@ruvector/gnn:0.1.25" \
               "@ruvector/graph-node:2.0.3" "@ruvector/graph-transformer:2.0.4" \
               "@ruvector/router:0.1.29" "@ruvector/rvf-node:0.1.8" \
               "@ruvector/sona:0.1.5" "@ruvector/tiny-dancer:0.1.18"; do
  pkg="${pkg_ver%%:*}"
  ver="${pkg_ver##*:}"
  install_pure_pkg "${pkg}" "${ver}"
done

# Cleanup
rm -rf "${TMPDIR}/package"

log "Native deps installation complete"
