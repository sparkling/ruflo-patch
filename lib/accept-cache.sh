#!/usr/bin/env bash
# lib/accept-cache.sh — ADR-0182 L3: persistent ACCEPT_TEMP resolution.
#
# Exports _resolve_accept_temp() which echoes a directory path the
# acceptance harness should use as $ACCEPT_TEMP.
#
# Cache-hit semantics:
#   - Cache key = SHA-256(@sparkleideas/cli@latest version |
#                          @sparkleideas/ruflo@latest version |
#                          @sparkleideas/cli's shipped lock-equivalent)
#     The cli package does not ship a package-lock.json (verified
#     2026-05-16 against patch.161). The lock-equivalent is the
#     `dependencies` block of cli's package.json, which contains the
#     pinned `@sparkleideas/*` versions resolved at publish time. Any
#     publish of cli or any of its deps invalidates the cache by
#     construction.
#   - Cache dir lives under ${HOME}/.cache/ruflo-accept-persistent-<hash>
#     so macOS Temp Cleaner (which sweeps /tmp aggressively) does not
#     evict it between releases.
#   - The cache dir holds .release-epoch containing the cache key hash.
#     If startup-time recomputed key matches the on-disk epoch, the
#     caller may skip `npm install` and reuse the populated node_modules.
#   - If the epoch is missing, mismatched, or corrupt, the dir is
#     nuked-fresh and a new mktemp-style path returned (cache miss).
#
# Caller contract:
#   _resolve_accept_temp echoes the path on stdout. The caller checks
#   for $ACCEPT_TEMP/.release-epoch to discriminate cache-hit vs miss.
#   On cache MISS, the caller is responsible for:
#     (a) running `npm install` into the dir, and
#     (b) atomically writing the cache key into $ACCEPT_TEMP/.release-epoch
#         (write-then-rename) ONLY after the install succeeds.
#
# Concurrency: the release pipeline already holds a top-level flock
# (scripts/ruflo-publish.sh), so two `npm run release` invocations
# cannot race here. Manual invocations of test-acceptance.sh under
# RUFLO_PERSISTENT_ACCEPT=1 must be single-threaded by the operator.
#
# Per ADR-0182's hard requirements (L3 row):
#   (i)   Cache HIT skips npm install entirely.
#   (ii)  Cache key includes both resolved versions + cli's lock-equiv.
#   (iii) Postinstall idempotency is gated by an integration test in
#         tests/integration/persistent-accept-cache.test.mjs.
#   (iv)  Epoch guard nukes-fresh on mismatch/missing.
#   (v)   Behind RUFLO_PERSISTENT_ACCEPT=1, default off.
#   (vi)  4-week kill-switch (revert by 2026-06-13 if not promoted to
#         default).

# Guard against double-source.
if [[ -n "${_ACCEPT_CACHE_LOADED:-}" ]]; then return 0; fi
_ACCEPT_CACHE_LOADED=1

# ── SHA-256 portable wrapper (macOS has `shasum`, Linux has `sha256sum`) ──
_l3_sha256() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  else
    echo "ERROR: neither shasum nor sha256sum available" >&2
    return 1
  fi
}

# Compute the L3 cache key for the registry at $1 (default Verdaccio).
# Echoes the 64-char hex hash on stdout. Returns non-zero if any input
# cannot be resolved (registry unreachable, package not published, etc.)
# — per feedback-no-fallbacks, the caller must treat that as fatal and
# fall back to mktemp -d (cache miss), NOT silently proceed with a
# partial key.
_l3_compute_cache_key() {
  local registry="${1:-http://localhost:4873}"
  local cli_version ruflo_version cli_deps_blob

  cli_version=$(npm view "@sparkleideas/cli@latest" version \
    --registry "$registry" 2>/dev/null) || return 1
  [[ -z "$cli_version" ]] && return 1

  ruflo_version=$(npm view "@sparkleideas/ruflo@latest" version \
    --registry "$registry" 2>/dev/null) || return 1
  [[ -z "$ruflo_version" ]] && return 1

  # cli does not ship package-lock.json; the `dependencies` block of
  # its package.json is the lock-equivalent — pinned `@sparkleideas/*`
  # versions + third-party constraints, regenerated at publish time.
  # `npm view <pkg>@<ver> dependencies --json` returns the same bytes
  # the tarball ships.
  cli_deps_blob=$(npm view "@sparkleideas/cli@${cli_version}" \
    dependencies --json --registry "$registry" 2>/dev/null) || return 1
  [[ -z "$cli_deps_blob" || "$cli_deps_blob" == "undefined" ]] && return 1

  # Compose: version | version | deps-json. Order is fixed so the
  # hash is deterministic.
  printf '%s|%s|%s' "$cli_version" "$ruflo_version" "$cli_deps_blob" \
    | _l3_sha256
}

# Resolve the ACCEPT_TEMP path the caller should use.
# Echoes the path on stdout. Returns 0 always — cache-miss falls
# through to mktemp -d.
#
# Side effects (cache HIT): none beyond stat-ing the dir.
# Side effects (cache MISS): nukes any stale dir at the cache path,
# creates an empty dir there. The caller MUST `npm install` into it
# and write .release-epoch atomically on success.
#
# Arguments: $1 = registry URL (default Verdaccio).
_resolve_accept_temp() {
  local registry="${1:-http://localhost:4873}"
  local key cache_root cache_dir

  key=$(_l3_compute_cache_key "$registry") || {
    # Key resolution failed (registry down, package unpublished, etc.).
    # Per feedback-no-fallbacks: do NOT proceed with a partial key —
    # but also do NOT abort the release. Fall back to mktemp -d so the
    # release behaves exactly like the !RUFLO_PERSISTENT_ACCEPT path.
    # The L3 win is forgone for this release; correctness is preserved.
    echo "[accept-cache] WARN: cache key resolution failed (registry=$registry); falling back to mktemp" >&2
    mktemp -d "${TMPDIR:-/tmp}/ruflo-accept-XXXXX"
    return 0
  }

  # macOS Temp Cleaner (com.apple.bsd.periodic-daily) sweeps /tmp
  # nightly; ${HOME}/.cache is preserved across reboots and not swept.
  # Use a short prefix of the hash to keep the path readable while
  # avoiding collision between unrelated keys.
  cache_root="${HOME}/.cache"
  mkdir -p "$cache_root" 2>/dev/null || true
  cache_dir="${cache_root}/ruflo-accept-persistent-${key:0:16}"

  if [[ -d "$cache_dir" && -f "$cache_dir/.release-epoch" ]]; then
    local on_disk_key
    on_disk_key=$(cat "$cache_dir/.release-epoch" 2>/dev/null) || on_disk_key=""
    if [[ "$on_disk_key" == "$key" ]]; then
      # Cache HIT — caller will detect via .release-epoch presence
      # and skip npm install.
      echo "$cache_dir"
      return 0
    fi
    # Epoch mismatch — nuke-fresh per ADR §iv.
    rm -rf "$cache_dir" 2>/dev/null || true
  fi

  # Cache MISS: nuke any half-populated dir and recreate empty.
  # Don't write .release-epoch here — caller writes it AFTER install
  # succeeds, so a crashed install leaves no false-positive cache.
  rm -rf "$cache_dir" 2>/dev/null || true
  mkdir -p "$cache_dir" || {
    # mkdir failed (perms, disk full); fall back to mktemp.
    echo "[accept-cache] WARN: mkdir $cache_dir failed; falling back to mktemp" >&2
    mktemp -d "${TMPDIR:-/tmp}/ruflo-accept-XXXXX"
    return 0
  }
  echo "$cache_dir"
}

# Write the .release-epoch atomically (write-tmp + rename).
# Called by the harness AFTER a successful npm install on a cache-miss
# path, so subsequent releases can match the epoch.
#
# Arguments: $1 = the cache dir, $2 = registry (default Verdaccio).
# Returns non-zero if the key cannot be computed (caller should warn
# but the release proceeds — cache will be re-built next time).
_l3_write_release_epoch() {
  local cache_dir="$1"
  local registry="${2:-http://localhost:4873}"
  local key tmpfile
  key=$(_l3_compute_cache_key "$registry") || return 1
  tmpfile="${cache_dir}/.release-epoch.tmp.$$"
  printf '%s' "$key" > "$tmpfile" || return 1
  mv -f "$tmpfile" "${cache_dir}/.release-epoch" || return 1
  return 0
}
