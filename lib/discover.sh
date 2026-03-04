#!/bin/bash
# lib/discover.sh — Shared install discovery for patch-all.sh, check-patches.sh, repair-post-init.sh
#
# Finds ALL @claude-flow/cli installations across three patterns:
#   1. Direct npx:   {npx_cache}/{hash}/node_modules/@claude-flow/cli/dist/src/
#   2. Umbrella npx: {npx_cache}/{hash}/node_modules/claude-flow/v3/@claude-flow/cli/dist/src/
#   3. Umbrella global: {npm_prefix}/lib/node_modules/claude-flow/v3/@claude-flow/cli/dist/src/
#
# Output: tab-separated lines:
#   dist_src \t version \t ruvector_cli \t ruv_swarm_root \t writable(yes|no)

# ── npx cache roots ──

_cfp_npx_cache_roots() {
  # Linux / macOS
  local home_npx="$HOME/.npm/_npx"
  [ -d "$home_npx" ] && echo "$home_npx"

  # Windows (Git Bash / MSYS2): $LOCALAPPDATA/npm-cache/_npx
  if [ -n "${LOCALAPPDATA:-}" ]; then
    local win_npx
    if command -v cygpath >/dev/null 2>&1; then
      win_npx="$(cygpath "$LOCALAPPDATA")/npm-cache/_npx"
    else
      win_npx="$LOCALAPPDATA/npm-cache/_npx"
    fi
    [ -d "$win_npx" ] && echo "$win_npx"
  fi
}

# ── Probe a single node_modules directory ──
# Args: <node_modules_dir>
# Outputs tab-separated lines for each valid install found.

_cfp_probe_node_modules() {
  local nm_dir="$1"
  [ -d "$nm_dir" ] || return 0

  local layouts=(
    "@claude-flow/cli/dist/src"
    "claude-flow/v3/@claude-flow/cli/dist/src"
  )

  local _seen_real=()

  for layout in "${layouts[@]}"; do
    local dist_src="$nm_dir/$layout"
    [ -f "$dist_src/memory/memory-initializer.js" ] || continue

    # Deduplicate by realpath
    local real
    real="$(realpath "$dist_src" 2>/dev/null || echo "$dist_src")"
    local dup=0
    for s in "${_seen_real[@]}"; do
      [ "$s" = "$real" ] && { dup=1; break; }
    done
    [ "$dup" -eq 1 ] && continue
    _seen_real+=("$real")

    # Version
    local pkg_json="$dist_src/../../package.json"
    local version
    version=$(grep -o '"version": *"[^"]*"' "$pkg_json" 2>/dev/null | head -1 | cut -d'"' -f4)
    [ -z "$version" ] && version="unknown"

    # Companion: ruvector — search sibling node_modules and umbrella's v3/node_modules
    local rv_cli="-"
    local search_dirs=("$nm_dir")
    # If umbrella layout, also search inside v3/node_modules
    if [[ "$layout" == claude-flow/* ]]; then
      local v3_nm="$nm_dir/claude-flow/v3/node_modules"
      [ -d "$v3_nm" ] && search_dirs+=("$v3_nm")
    fi
    for sd in "${search_dirs[@]}"; do
      if [ -f "$sd/ruvector/bin/cli.js" ]; then
        rv_cli="$(cd "$sd/ruvector/bin" 2>/dev/null && pwd)/cli.js"
        break
      fi
    done

    # Companion: ruv-swarm root
    local rs_root="-"
    for sd in "${search_dirs[@]}"; do
      if [ -f "$sd/ruv-swarm/package.json" ]; then
        rs_root="$(cd "$sd/ruv-swarm" 2>/dev/null && pwd)"
        break
      fi
    done

    # Writable check
    local writable="yes"
    [ -w "$dist_src/memory/memory-initializer.js" ] || writable="no"

    # Use "-" for empty fields to prevent bash IFS collapsing consecutive delimiters
    printf '%s\t%s\t%s\t%s\t%s\n' "$dist_src" "$version" "$rv_cli" "$rs_root" "$writable"
  done
}

# ── Discover all global installs ──
# Outputs tab-separated lines (same format as _cfp_probe_node_modules).

discover_all_cf_installs() {
  local _global_seen=()

  # 1. npx cache directories
  while IFS= read -r cache_root; do
    [ -n "$cache_root" ] || continue
    for hash_dir in "$cache_root"/*/; do
      [ -d "$hash_dir/node_modules" ] || continue
      while IFS= read -r line; do
        [ -n "$line" ] || continue
        local ds="${line%%	*}"
        local real
        real="$(realpath "$ds" 2>/dev/null || echo "$ds")"
        local dup=0
        for s in "${_global_seen[@]}"; do
          [ "$s" = "$real" ] && { dup=1; break; }
        done
        [ "$dup" -eq 1 ] && continue
        _global_seen+=("$real")
        echo "$line"
      done < <(_cfp_probe_node_modules "$hash_dir/node_modules")
    done
  done < <(_cfp_npx_cache_roots)

  # 2. Global npm prefix
  local npm_prefix
  npm_prefix="$(npm config get prefix 2>/dev/null)" || true
  if [ -n "$npm_prefix" ]; then
    local prefix_dirs=("$npm_prefix/lib/node_modules" "$npm_prefix/node_modules")
    for pdir in "${prefix_dirs[@]}"; do
      [ -d "$pdir" ] || continue
      while IFS= read -r line; do
        [ -n "$line" ] || continue
        local ds="${line%%	*}"
        local real
        real="$(realpath "$ds" 2>/dev/null || echo "$ds")"
        local dup=0
        for s in "${_global_seen[@]}"; do
          [ "$s" = "$real" ] && { dup=1; break; }
        done
        [ "$dup" -eq 1 ] && continue
        _global_seen+=("$real")
        echo "$line"
      done < <(_cfp_probe_node_modules "$pdir")
    done
  fi
}

# ── Discover installs in a --target directory ──
# Args: <target_dir>

discover_target_installs() {
  local dir="$1"
  [ -d "$dir/node_modules" ] || return 0
  _cfp_probe_node_modules "$dir/node_modules"
}
