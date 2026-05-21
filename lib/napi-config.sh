#!/usr/bin/env bash
# lib/napi-config.sh — Shared napi-package config (ADR-0150)
#
# Single source of truth for napi-rs packages that ship native .node binaries.
# Sourced by:
#   - scripts/napi-rebuild.sh — detect Rust source changes + rebuild .node
#   - scripts/bundle-native-binaries.sh — copy .node into npm-package parent dirs
#   - tests/unit/adr0150-napi-config.test.mjs — schema validation
#
# Format: NAPI_PACKAGES is an array of "<fork_dir_var>:<crate_path>:<dest_npm_dir>"
#   - <fork_dir_var>:  name of the FORK_DIR_* env var (e.g. FORK_DIR_RUVECTOR)
#   - <crate_path>:    relative path under fork to the napi crate (where .node files land)
#   - <dest_npm_dir>:  relative path under fork to the npm-publish dir (where binary
#                      must be present for "step 1 local file check" of NAPI loader)
#
# When dest_npm_dir == crate_path, the npm package IS the crate dir (no separate
# publish dir); bundle is a no-op. Common pattern for single-binary packages
# (agentic-jujutsu).

# ADR-0150: extend napi-rebuild + bundle-native-binaries beyond ruvector.
NAPI_PACKAGES=(
  # ── ruvector (8 entries, established by ADR-0133/ADR-0071) ──
  "FORK_DIR_RUVECTOR:crates/ruvector-graph-node:npm/packages/graph-node"
  "FORK_DIR_RUVECTOR:crates/ruvector-node:npm/packages/core"
  "FORK_DIR_RUVECTOR:crates/ruvector-router-ffi:npm/packages/router"
  "FORK_DIR_RUVECTOR:crates/ruvector-tiny-dancer-node:npm/packages/tiny-dancer"
  "FORK_DIR_RUVECTOR:crates/sona:npm/packages/sona"
  "FORK_DIR_RUVECTOR:examples/ruvLLM:npm/packages/ruvllm"
  "FORK_DIR_RUVECTOR:crates/rvf/rvf-node:npm/packages/rvf-node"

  # ── ruvector (added 2026-05-18 per ADR-0189 + user policy "always @sparkleideas") ──
  # Single-binary packages: crate IS the npm publish dir, no separate dest.
  "FORK_DIR_RUVECTOR:crates/ruvector-solver-node:crates/ruvector-solver-node"
  "FORK_DIR_RUVECTOR:crates/agentic-robotics-node:crates/agentic-robotics-node"

  # ── ruvector gnn + attention (added 2026-05-21) ──
  # Prebuilt darwin-arm64 .node existed in-crate but never shipped: gnn was a
  # stale publish; attention's .npmignore excluded *.node. Single-binary: crate
  # IS the npm publish dir (dest_npm_dir == crate_path). See ADR-0150.
  "FORK_DIR_RUVECTOR:crates/ruvector-gnn-node:crates/ruvector-gnn-node"
  "FORK_DIR_RUVECTOR:crates/ruvector-attention-node:crates/ruvector-attention-node"

  # ── agentic-jujutsu (ADR-0150) ──
  # Single-binary package: crate IS the npm publish dir, dest_npm_dir == crate_path.
  "FORK_DIR_AGENTIC:packages/agentic-jujutsu:packages/agentic-jujutsu"
)

# Helper: parse one config entry into 3 globals: NAPI_FORK_DIR, NAPI_CRATE_PATH, NAPI_DEST_NPM_DIR
# Usage:
#   napi_parse_entry "FORK_DIR_RUVECTOR:crates/x:npm/packages/y"
#   echo "$NAPI_FORK_DIR/$NAPI_CRATE_PATH"
napi_parse_entry() {
  local entry="$1"
  IFS=':' read -r _fork_var NAPI_CRATE_PATH NAPI_DEST_NPM_DIR <<<"$entry"
  # Resolve fork_var to its actual path (set by lib/fork-paths.sh)
  NAPI_FORK_DIR="${!_fork_var:-}"
  if [[ -z "$NAPI_FORK_DIR" ]]; then
    return 1
  fi
  return 0
}

# Helper: list unique fork dirs that have at least one napi package
napi_unique_forks() {
  local seen=""
  for entry in "${NAPI_PACKAGES[@]}"; do
    napi_parse_entry "$entry" || continue
    if [[ ":$seen:" != *":$NAPI_FORK_DIR:"* ]]; then
      seen="${seen}:${NAPI_FORK_DIR}"
      echo "$NAPI_FORK_DIR"
    fi
  done
}
