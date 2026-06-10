# lib/acceptance-adr-noglobal-checks.sh — ADR-0316: `--no-*` boolean-negation
# flags must survive `validateFlags` under `allowUnknownFlags: false`.
#
# Bug: the parser strips `--no-foo` to the canonical key `foo` and stores
# `flags.foo = false` (parser.ts negation branch). But `validateFlags` builds
# its known-flag set from the DECLARED option names (e.g. `no-global` →
# normalizeKey → `noGlobal`), so the stripped key `global` is absent from the
# set. Under ADR-0208 (`allowUnknownFlags: false`) the unknown-flag loop then
# emits `Unknown option: --global` and `index.ts` calls `process.exit(1)`,
# BEFORE the command body ever runs. So every advertised `--no-<flag>` whose
# declared name is `no-<flag>` is rejected by the very parser that advertises
# it in `--help`.
#
# init's `--no-global` (#1744 / #2098A) is the user-visible instance: `init
# --help` lists `--no-global`, but `init --no-global` aborts with
# `[ERROR] Unknown option: --global`. The init.ts:194 read of
# `flags['global'] === false` is correct but unreachable.
#
# These checks run against the SHIPPED, codemod'd, published artifact
# (`@sparkleideas/*` installed in TEMP_DIR by the harness; bin = `ruflo`).
# We assert two things end-to-end:
#   (A) `init --help` advertises `--no-global` (the contract the bug breaks).
#   (B) the parser ACCEPTS `--no-*` boolean negation (the root cause), probed
#       hermetically via `status --no-color` — the same `validateFlags` path
#       `--no-global` rides, with no init side effects / virgin-HOME hang.
#
# Contract (per lib/acceptance-checks.sh): each check sets
#   _CHECK_PASSED ("true"/"false"), _CHECK_OUTPUT, _EXIT, _DURATION_MS, _OUT.
# Helpers available: _cli_cmd, _ns, _elapsed_ms, _timeout.

# shellcheck disable=SC2034  # _CHECK_PASSED/_EXIT/_DURATION_MS/_OUT set as side-effects

# ──────────────────────────────────────────────────────────────────────────
# (A) `init --help` advertises `--no-global`. Cheap, no project mutation.
# ──────────────────────────────────────────────────────────────────────────
check_adr_noglobal_advertised() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"

  local cli help_out
  cli=$(_cli_cmd)

  help_out=$(_timeout 30 bash -c "$cli init --help" 2>&1) || true

  if echo "$help_out" | grep -q -- '--no-global'; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="noglobal-advertised PASS: 'init --help' lists --no-global ($(echo "$help_out" | grep -- '--no-global' | head -1 | sed 's/^[[:space:]]*//'))"
    end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"; return
  fi

  _CHECK_OUTPUT="noglobal-advertised FAIL: 'init --help' does not list --no-global. Help head:
$(echo "$help_out" | head -20)"
  end_ns=$(_ns); _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# ──────────────────────────────────────────────────────────────────────────
# (B) The parser ACCEPTS `--no-*` boolean negation (root cause), via a fast,
#     hermetic, side-effect-free command.
#
# Why not run `init --no-global` here? Two reasons:
#   1. `init` performs HOME-based scaffolding; pointing HOME at a virgin
#      sandbox makes it HANG before the validation gate (observed: rc=124,
#      no output) — so a sandbox-HOME init can't distinguish "parser
#      accepted" from "hung pre-validation". Running with the real HOME
#      would mutate the workspace.
#   2. The defect is NOT in init — it's in `validateFlags` (parser.ts): the
#      known-flag set is built from declared option NAMES (`no-color` →
#      normalizeKey → `noColor`), but the negation branch stores the STRIPPED
#      key (`color`). So `color`/`global`/... are flagged `Unknown option`
#      under ADR-0208 (`allowUnknownFlags: false`). EVERY `--no-<x>` whose
#      declared name is `no-<x>` is affected.
#
# `--no-color` is a GLOBAL option (parser.ts globalOptions), so it rides on
# any command. We probe it on `status` — a lightweight read-only command that
# DOES run the validation gate (verified: `status --no-color` → exit 1,
# `[ERROR] Unknown option: --color` on the buggy artifact) and exits fast
# with NO filesystem mutation and NO virgin-HOME hang. This is the same
# `validateFlags` code path `--no-global` hits; fixing it fixes both.
#
# Assertion: FAIL iff output contains "Unknown option" (the bug's exact
# signature, emitted by validateFlags → index.ts → process.exit(1) before the
# command body). Absence of that string == the negation flag was accepted.
# ──────────────────────────────────────────────────────────────────────────
check_adr_noglobal_negation_accepted() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"

  local cli run_out
  cli=$(_cli_cmd)

  # `status --no-color`: runs validateFlags, exits fast, mutates nothing.
  run_out=$(_timeout 45 bash -c "$cli status --no-color" 2>&1) || true

  if echo "$run_out" | grep -qi 'Unknown option'; then
    _CHECK_OUTPUT="noglobal-negation FAIL (parser rejects --no-* negation — root cause of advertised-but-rejected --no-global): $(echo "$run_out" | grep -i 'Unknown option' | head -1)"
    end_ns=$(_ns); _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"; return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="noglobal-negation PASS: parser accepts --no-* boolean negation ('status --no-color' produced no 'Unknown option'); --no-global rides the same validateFlags path."
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}
