#!/usr/bin/env bash
# lib/promote-packages.sh — Shared dist-tag promotion (P3: DRY)
#
# Usage:
#   source lib/promote-packages.sh
#   promote_packages <registry_url> <max_parallel> <pkg1@ver1> <pkg2@ver2> ...
#
# Returns 0 if all succeed, 1 if any fail.
# Writes count of promoted/failed packages to stdout as "promoted=N failed=M".

promote_packages() {
  local registry="$1" max_parallel="$2"; shift 2
  local -a pkg_vers=("$@")
  local total=${#pkg_vers[@]}

  if [[ $total -eq 0 ]]; then
    echo "promoted=0 failed=0"
    return 0
  fi

  local results_dir
  results_dir=$(mktemp -d /tmp/ruflo-promote-XXXXX)

  _promote_one() {
    local pkg_spec="$1"
    local result_file="${results_dir}/${pkg_spec//\//_}"
    local -a cmd=(npm dist-tag add "${pkg_spec}" latest)
    # Only pass --registry if a non-empty URL was provided
    [[ -n "${registry}" ]] && cmd+=(--registry "${registry}")
    if "${cmd[@]}" 2>/dev/null; then
      echo "OK" > "$result_file"
    else
      echo "FAIL" > "$result_file"
    fi
  }

  local -a pids=()
  local running=0

  for pkg_spec in "${pkg_vers[@]}"; do
    _promote_one "$pkg_spec" &
    pids+=($!)
    running=$((running + 1))
    if [[ $running -ge $max_parallel ]]; then
      wait -n 2>/dev/null || true
      running=$((running - 1))
    fi
  done
  wait "${pids[@]}" 2>/dev/null || true

  # Count results
  local promoted=0 failures=0
  for result_file in "$results_dir"/*; do
    [[ -f "$result_file" ]] || continue
    case "$(cat "$result_file" 2>/dev/null)" in
      OK)   promoted=$((promoted + 1)) ;;
      FAIL) failures=$((failures + 1)) ;;
    esac
  done
  rm -rf "$results_dir"

  echo "promoted=${promoted} failed=${failures}"
  [[ $failures -eq 0 ]]
}
