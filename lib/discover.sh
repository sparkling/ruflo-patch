#!/bin/bash
# lib/discover.sh — Shared install discovery for patch-all.sh, check-patches.sh
#
# Finds @claude-flow/cli installations in a --target directory.
#
# Output: tab-separated lines:
#   dist_src \t version \t ruvector_cli \t ruv_swarm_root \t writable(yes|no)

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

# ── Discover installs in a --target directory ──
# Args: <target_dir>

discover_target_installs() {
  local dir="$1"

  # Standard layout: <dir>/node_modules/@claude-flow/cli/dist/src/
  if [ -d "$dir/node_modules" ]; then
    _cfp_probe_node_modules "$dir/node_modules"
  fi

  # Workspace layout: <dir>/v3/@claude-flow/cli/dist/src/
  # (used by sync-and-build.sh when targeting the temp build directory)
  local ws_dist_src="$dir/v3/@claude-flow/cli/dist/src"
  if [ -f "$ws_dist_src/memory/memory-initializer.js" ]; then
    local version
    version=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('$dir/v3/@claude-flow/cli/package.json','utf-8')).version)}catch{console.log('0.0.0')}" 2>/dev/null)
    printf '%s\t%s\t%s\t%s\t%s\n' "$ws_dist_src" "${version:-0.0.0}" "-" "-" "yes"
  fi
}
