# ADR-0097: Check-Code Quality Program

- **Status**: Proposed — 2026-04-17
- **Date**: 2026-04-17
- **Scope**: `lib/acceptance-harness.sh` (canonical helpers), `lib/acceptance-*-checks.sh` (190 Phase 1–7 files), `scripts/lint-acceptance-checks.mjs`, `tests/unit/acceptance-checks-*.test.mjs`
- **Forked from**: ADR-0094 §D rows 11–12 (hive synthesis)
- **Related**: ADR-0094 (parent), ADR-0090 B1/B3/B5 (paired-unit-test precedent), ADR-0082 (no silent fallbacks — bad regex IS a silent pass path)

## Context

The ADR-0094 Phase 1–7 swarm produced 190 new acceptance checks in 27 files. Observations:
- **Zero** of the 27 files have paired unit tests (`tests/unit/acceptance-*-checks.test.mjs`). ADR-0090 B1/B3/B5 set the precedent (every Tier-B check has a paired `.test.mjs`); Phase 1–7 broke that precedent.
- **23 of 27** files implement their own `_<domain>_invoke_tool` helper, with minor drift between them.
- **~33% of Phase-7 first-run failures** were check-code bugs, not product bugs — primarily pattern regex too narrow (didn't match the MCP JSON content-wrapper response shape).
- **Zero** files parse the MCP `content[].text` envelope before pattern matching; all do raw-string regex on the envelope, leading to fragile patterns.
- **Zero** files use `trap`-based cleanup; leaked `.iso-*` directories and chmod-000 dirs accumulate.

Checks are code. Bad checks = silent fallbacks. This ADR defines the quality program.

## Decision (Proposed)

### Canonical harness extension

Add to `lib/acceptance-harness.sh`:
```bash
# _expect_mcp_body — invoke + unwrap content envelope + regex match.
# Usage: _expect_mcp_body <tool> <params_json> <regex> [label] [timeout]
_expect_mcp_body() { ... }

# _mcp_invoke_tool — single canonical invoke helper (superset of the 23 drift variants).
# Usage: _mcp_invoke_tool <tool> <params_json> <expect_regex> [label] [timeout] [--rw|--ro]
_mcp_invoke_tool() { ... }

# _with_iso_cleanup — wraps an _e2e_isolate-using check with trap-based cleanup.
# Usage: _with_iso_cleanup <check_id> <body_fn>
_with_iso_cleanup() { ... }
```

### Lint rules (L1-L7)
```
L1 (error):   _run_and_kill without explicit "" timeout arg
L2 (error):   check function not setting _CHECK_PASSED on every exit path
L3 (warn):    pattern regex used directly on _RK_OUT instead of via _expect_mcp_body
L4 (error):   `grep -c pat file || echo 0` — project's known bash trap
L5 (warn):    _<domain>_invoke_tool reimplemented instead of calling _mcp_invoke_tool
L6 (warn):    _e2e_isolate call without matching trap-based cleanup
L7 (error):   check function name missing `check_adr<NNNN>_` prefix (breaks catalog ID parsing)
```
Wire into `scripts/lint-acceptance-checks.mjs`; preflight fails on L1/L2/L4/L7, warns on L3/L5/L6.

### Paired unit test mandate

Every new acceptance check (from this ADR forward) ships with a paired subprocess-driver unit test that covers at minimum:
1. Happy path — mock CLI returns expected body; assert `_CHECK_PASSED=true`.
2. Tool-not-found path — mock CLI returns "Tool not found"; assert `_CHECK_PASSED=skip_accepted`.
3. Empty body path — mock CLI returns nothing; assert `_CHECK_PASSED=false` with diagnostic.
4. Crash path — mock CLI exits non-zero; assert `_CHECK_PASSED=false` with diagnostic.
5. Pattern mismatch — mock CLI returns valid JSON but mismatching body; assert `_CHECK_PASSED=false`.

Driver pattern: ADR-0090 B3's `tests/unit/adr0090-b3-daemon-metrics.test.mjs` is the template.

### Backfill strategy (three tiers)

**Tier X — Immediate paired backfill**: the 10 Phase 1–7 check functions whose first-run regex was narrower than the published response shape (listed in `docs/bugs/coverage-ledger.md` references + Implementation Log §2026-04-17 remediation swarm).

**Tier Y — Gate on Phase 9+**: no new check merges without a paired test from this point. CI enforces.

**Tier Z — Rolling retrofit**: remaining ~180 Phase 1–7 checks migrate to paired-unit-test + canonical helpers as their domain is touched for unrelated reasons.

Rationale: big-bang 190-test backfill is a 4-week distraction. The 33% first-run failure rate justifies Tier X + Y now; Tier Z piggybacks on organic touches.

## Alternatives

### A. Big-bang retrofit
Pair all 190 existing checks with unit tests in one sprint.
**Pros**: consistency; no two-tier world.
**Cons**: opportunity cost — diverts a swarm from Phase 8–10 behavioral work where the *next* bug class lives.

### B. No retrofit, new checks only
**Pros**: fastest path.
**Cons**: leaves 190 checks untested; the 33% first-run failure rate repeats on every cross-cutting edit.

### C. Property-based testing via bash fuzz harness
Randomly permute MCP response shapes, assert invariants.
**Pros**: catches regex brittleness that targeted tests miss.
**Cons**: novel tooling; no precedent in the project.

## Recommendation

Tier X (10 now) + Tier Y (CI gate) + Tier Z (rolling). Proposed by E6. Accepted by the hive.

## Acceptance criteria

1. `lib/acceptance-harness.sh` exports `_expect_mcp_body`, `_mcp_invoke_tool`, `_with_iso_cleanup`.
2. `scripts/lint-acceptance-checks.mjs` implements L1-L7; preflight exit code reflects errors.
3. Tier X: 10 paired-unit-test files exist in `tests/unit/` — one per targeted Phase-1–7 check.
4. Tier Y: pre-commit / pre-push hook (or CI job) rejects new `lib/acceptance-*-checks.sh` files without a matching `tests/unit/acceptance-*-checks.test.mjs`.
5. Tier Z tracker: a `docs/bugs/coverage-ledger.md` entry per Phase-1–7 file still on the old helpers, state `deferred` with explicit `accepted_until` dates.

## References

- ADR-0094 §D rows 11–12 (the synthesis this forks from)
- ADR-0090 B3's test (`tests/unit/adr0090-b3-daemon-metrics.test.mjs`) as the paired-unit-test template
- ADR-0082 (silent-fallbacks — bad regex IS a silent pass)
- Queen synthesis `/tmp/hive/queen-synthesis.md` §F row 3
