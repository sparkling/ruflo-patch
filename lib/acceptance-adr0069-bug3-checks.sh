#!/usr/bin/env bash
# lib/acceptance-adr0069-bug3-checks.sh — ADR-0069 Bug #3: memory store/retrieve
# persistence across CLI invocations outside an init'd project.
#
# Before the fix: the router's _doInit() hardcoded
# `databasePath = '.claude-flow/memory.rvf'` as a cwd-relative path. Two
# invocations from different cwds wrote to two different files, so a
# `store` + `retrieve` pair (each its own Node process) returned "not found".
#
# After the fix: when no ancestor `.claude-flow/` exists, the router resolves
# to `$HOME/.claude-flow/data/memory.rvf` — a stable per-user location. A
# store followed by a separate retrieve invocation finds the value.
#
# Caller MUST set: TEMP_DIR, REGISTRY (like other acceptance check libs).
# Uses _cli_cmd (from acceptance-checks.sh) so parallel invocations share the
# installed CLI binary, not `npx ...@latest` (36× slower; memory note
# reference-cli-cmd-helper).

# ════════════════════════════════════════════════════════════════════
# ADR-0069 Bug #3: cross-invocation persistence outside init context
# ════════════════════════════════════════════════════════════════════
#
# Assertion: in a throwaway tmpdir with NO `.claude-flow/` ancestor, running
# `cli memory store --key foo --value bar --namespace ns` then separately
# (new Node process) running `cli memory retrieve --key foo --namespace ns`
# MUST return "bar".
#
# Uses a scoped test HOME so the check never touches the real
# $HOME/.claude-flow/data/ (test isolation + easy cleanup).
check_adr0069_bug3_store_persist_outside_init() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # Precondition: we need a cli binary to run.
  local cli; cli=$(_cli_cmd)
  if [[ -z "$cli" ]]; then
    _CHECK_OUTPUT="ADR-0069 Bug #3: _cli_cmd returned empty (CLI not installed)"
    return
  fi

  # Create a throwaway cwd that lives OUTSIDE any project. Pick a sibling of
  # TEMP_DIR's parent to guarantee no `.claude-flow/` ancestor. (TEMP_DIR
  # itself is an npm install dir and has no `.claude-flow/`, but the test
  # cwd must also be free of it and outside the ruflo-patch repo tree.)
  local scratch_cwd
  scratch_cwd=$(mktemp -d -t adr0069bug3-cwd-XXXXXX)

  # Scoped HOME so the per-user default lives in a temp location we can wipe.
  # Without this, store writes into the real ~/.claude-flow/data/ and leaves
  # residue. The fix under test is HOME-keyed, so overriding HOME changes
  # only the test's resolved path — it still exercises the same code path.
  local scratch_home
  scratch_home=$(mktemp -d -t adr0069bug3-home-XXXXXX)

  # Defensive cleanup in all exit paths.
  local _cleanup_done=0
  _adr0069_bug3_cleanup() {
    [[ "$_cleanup_done" == "1" ]] && return
    _cleanup_done=1
    # Only remove paths we created (mktemp -d produces absolute paths).
    if [[ -n "$scratch_cwd"    && "$scratch_cwd"    == /*  && -d "$scratch_cwd"    ]]; then rm -rf "$scratch_cwd";    fi
    if [[ -n "$scratch_home"   && "$scratch_home"   == /*  && -d "$scratch_home"   ]]; then rm -rf "$scratch_home";   fi
  }
  trap _adr0069_bug3_cleanup RETURN

  # Sanity: no .claude-flow ancestor under scratch_cwd. mktemp gives us
  # /tmp/adr0069bug3-cwd-XXXXXX. The only ancestors are / and /tmp, neither
  # of which has .claude-flow (we just made the leaf). Assert anyway.
  local probe="$scratch_cwd"
  while [[ "$probe" != "/" ]]; do
    if [[ -d "$probe/.claude-flow" ]]; then
      _CHECK_OUTPUT="ADR-0069 Bug #3: test precondition violated — ancestor .claude-flow/ at $probe"
      return
    fi
    probe=$(dirname "$probe")
  done

  local ns="adr0069bug3ns"
  local key="bug3foo"
  local val="bug3bar"

  # Invocation 1: memory store.
  # Explicit HOME override + cd to scratch_cwd ensures:
  #   (a) no ancestor .claude-flow/ → outside-project branch taken
  #   (b) per-user default routes to $scratch_home/.claude-flow/data/memory.rvf
  local store_out
  store_out=$(mktemp /tmp/adr0069bug3-store-XXXXX)
  _run_and_kill "cd '$scratch_cwd' && HOME='$scratch_home' NPM_CONFIG_REGISTRY='$REGISTRY' $cli memory store --key '$key' --value '$val' --namespace '$ns'" "$store_out" 60
  local store_exit="$_RK_EXIT"
  local store_text; store_text=$(cat "$store_out" 2>/dev/null)

  # Check store succeeded (allow exit-code unreliability per memory note
  # feedback-run-and-kill-exit-code — fall back to output content match).
  if ! echo "$store_text" | grep -qiE 'stored|success'; then
    _CHECK_OUTPUT="ADR-0069 Bug #3: memory store failed (exit=$store_exit). Output: $(echo "$store_text" | tail -5 | tr '\n' '|')"
    rm -f "$store_out"
    return
  fi
  rm -f "$store_out"

  # Verify the RVF file landed where we expect — per-user persistent path.
  # If the fix regressed to cwd-relative, the file would be at
  # $scratch_cwd/.claude-flow/memory.rvf (NOT at $scratch_home/...). That
  # alternate location is the old buggy behavior; the check below detects
  # that regression explicitly.
  local expected_rvf="$scratch_home/.claude-flow/data/memory.rvf"
  local legacy_rvf="$scratch_cwd/.claude-flow/memory.rvf"

  if [[ -f "$legacy_rvf" && ! -f "$expected_rvf" ]]; then
    _CHECK_OUTPUT="ADR-0069 Bug #3: REGRESSION — store wrote to cwd-relative $legacy_rvf instead of per-user $expected_rvf"
    return
  fi

  if [[ ! -f "$expected_rvf" ]]; then
    _CHECK_OUTPUT="ADR-0069 Bug #3: per-user RVF file not created at $expected_rvf after store"
    return
  fi

  # Invocation 2: memory retrieve (separate Node process).
  # If the bug is present, this would get an empty in-memory backend and
  # return "not found" even though store_text said success.
  local retrieve_out
  retrieve_out=$(mktemp /tmp/adr0069bug3-retr-XXXXX)
  _run_and_kill "cd '$scratch_cwd' && HOME='$scratch_home' NPM_CONFIG_REGISTRY='$REGISTRY' $cli memory retrieve --key '$key' --namespace '$ns'" "$retrieve_out" 60
  local retrieve_text; retrieve_text=$(cat "$retrieve_out" 2>/dev/null)
  rm -f "$retrieve_out"

  # The retrieved Value: block should contain our original value. The
  # CLI's output format (memory.ts retrieveCommand) prints a box with
  # `Value:` followed by the content.
  if ! echo "$retrieve_text" | grep -qF "$val"; then
    # Surface a 5-line tail of the output so regressions are debuggable.
    local tail_text
    tail_text=$(echo "$retrieve_text" | tail -5 | tr '\n' '|')
    _CHECK_OUTPUT="ADR-0069 Bug #3: retrieve did NOT return '$val' (bug is live). Tail: $tail_text"
    return
  fi

  # ADR-0069 Bug #3 regression catcher: also assert retrieve did not print
  # "Key not found" — that's the ADR-documented failure mode we are fixing.
  if echo "$retrieve_text" | grep -qi 'key not found'; then
    _CHECK_OUTPUT="ADR-0069 Bug #3: retrieve returned 'Key not found' — persistence still broken"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0069 Bug #3: store+retrieve round-trip works outside init context (RVF at $expected_rvf)"
}
