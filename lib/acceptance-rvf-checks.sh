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

# RVF cosine score after reopen (ADR-0073 amendment, 2026-05-22).
#
# RVF's native open() does not persist the distance metric (RuVector rvf-runtime
# `try_open_once` rebuilds RvfOptions with `..Default::default()` → L2). So a
# store created `cosine` reopens as `l2`, its query returns L2² (= 2-2cos for the
# unit-normalized embeddings), and the old `1 - r.distance` conversion produced
# `2cos - 1` (negative for merely-related content) → the threshold gate dropped
# everything → memory_search total:0. The fix scores cosine DIRECTLY.
#
# The node repro forces the native (not pure-TS-fallback) path: create+close to
# lay down the file, REOPEN (handle → l2), store the probe doc on that handle so
# its numId is mapped in-process, then search a related query and assert the
# returned score equals the doc's TRUE cosine (not `2cos-1`). Skips narrowly
# (ADR-0082) if no consistent backend resolves.
check_rvf_cosine_score_after_reopen() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  local out
  out=$(node "${PROJECT_DIR}/scripts/diag-rvf-cosine-reopen.mjs" 2>&1)
  if echo "$out" | grep -q '^PASS:'; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="rvf-cosine-reopen: $(echo "$out" | grep '^PASS:' | head -1)"
  elif echo "$out" | grep -q '^SKIP:'; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="rvf-cosine-reopen: $(echo "$out" | grep '^SKIP:' | head -1)"
  else
    _CHECK_OUTPUT="rvf-cosine-reopen: $(echo "$out" | head -4 | tr '\n' ' ')"
  fi
}
