#!/usr/bin/env bash
# Behavioral RVF acceptance checks — run against the INSTALLED CLI, which
# bundles a consistent native (@ruvector/rvf-node) + JS pair. These scenarios
# cannot run in the unit tier: a bare @sparkleideas/memory install is pure-TS,
# and the build tree's JS resolves a stray, version-mismatched native. The
# unit tier keeps only the deterministic source-shape contracts
# (tests/unit/rvf-search-orphan-numid.test.mjs, rvf-concurrent-init.test.mjs).
#
# (Concurrent-init convergence — the ADR-0167 RVFR fix — is already guarded by
# check_t3_2_rvf_concurrent_writes in acceptance-adr0079-tier3-checks.sh.)

# RVF search orphan-numId self-heal (was unit "Bug-1", ADR-0082 loud fallback).
#
# Process A stores an embedded entry (native write assigns numIds). A separate
# process B opens the same .rvf with an empty nativeReverseMap, so native
# query() returns hits whose numIds map to nothing. The fix detects the
# all-orphan case and falls through to pure-TS search over the loaded entries.
# Pre-fix, B's search returns 0 results; post-fix it finds the entry.
check_rvf_orphan_numid_selfheal() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  local cli; cli=$(_cli_cmd)
  local iso; iso=$(_e2e_isolate "rvf-orphan-numid")
  local ns="rvf-orphan-$$"

  # Process A: store an entry with an embedding, then exit (persists numIds).
  ( cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 90 $cli memory store \
      --key "rec/auth-jwt" --value "jwt authentication tokens and session handling" \
      --namespace "$ns" > "$iso/orphan-store.log" 2>&1 )

  if ! grep -qiE 'stored|success' "$iso/orphan-store.log" 2>/dev/null; then
    _CHECK_OUTPUT="rvf-orphan-numid: store (process A) did not succeed: $(head -3 "$iso/orphan-store.log" 2>/dev/null | tr '\n' ' ')"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  # Process B (fresh process): semantic search. Pre-fix returns nothing because
  # orphan numIds are dropped; post-fix the orphan-self-heal falls through to
  # pure-TS search and finds the entry.
  local out
  out=$(cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 90 $cli memory search \
      -q "authentication" --namespace "$ns" 2>&1)

  if echo "$out" | grep -qiE 'rec/auth-jwt|jwt authentication'; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="rvf-orphan-numid: cross-process search found the stored entry — orphan-numId self-heal works on the installed (consistent native) artifact"
  else
    _CHECK_OUTPUT="rvf-orphan-numid: cross-process search returned no matching hit — orphan-numId self-heal not firing. Search output: $(echo "$out" | head -4 | tr '\n' ' ')"
  fi

  rm -rf "$iso" 2>/dev/null
}
