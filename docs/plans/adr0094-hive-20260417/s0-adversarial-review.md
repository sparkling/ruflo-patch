# S0 Adversarial Review (ADR-0094 Sprint 0)

Roles: adversarial-reviewer (ADR-0087) + out-of-scope probe-writer (addendum).
Inputs read at review time:
- `scripts/regen-mcp-manifest.mjs` (347 LOC, manifest-populator)
- `scripts/catalog-rebuild.mjs` (365 LOC, catalog-builder)
- `lib/acceptance-harness.sh` (372 LOC, harness-migrator)

Probes shipped by this agent:
- `scripts/diag-manifest-interproc.mjs` — fires exit 1 today (see §Agent 1).
- `tests/unit/catalog-malformed-json.test.mjs` — 8/8 passes today.

---

## Agent 1 — manifest-populator (`scripts/regen-mcp-manifest.mjs`)

### 3 worst-case scenarios

1. **The plan-spec table parser silently loses 12 tools today** (4.3% of real surface). The author made the correct call to switch to `--format json`, but the plan (`01-sprint0:9`) still prescribes the table regex. `parseMcpToolsTable` is *still exported* (line 144) "for documentation". Any future developer reading the plan OR re-enabling the fallback ships with the 12 `hooks_intelligence_*` / `agentdb_hierarchical_*` / `agentdb_attention_*` tools invisible. **The plan document and the code are now inconsistent; the plan is wrong.**
2. **Comment claim is factually wrong.** Line 19-22 asserts the table "truncates tool names at 17 chars (trailing '...'), losing ~58% of the real names". Raw table output disproves this — only descriptions truncate; tool names are preserved. The real reason the table drops 12 tools is **unknown even to the author** (likely: rows with non-matching category headers or long lines whose leading indent differs). If the architect ever revisits "why did we abandon the table?", the answer on file is incorrect. A senior engineer three years from now sees a false rationale and restores the fallback to "fix" perceived bloat.
3. **`_pinned_cli_version` resolution lies under offline conditions.** `resolvePinnedVersion()` (line 210) prefers the existing manifest's `_pinned_cli_version` — but when the manifest is the stub (`3.5.58-patch.136`), the resolver happily uses that even if the actual @latest has advanced to patch.137. The probe never fails-loud; the manifest simply ossifies. Queen plan §E #1 says "probe-writer Co-Authored-By differs from fix-author" but there's no mechanical check that the pinned version matches the `npm view @sparkleideas/cli@latest` answer **at regen time**, only at bootstrap.

### 3-year hindsight

A senior engineer reviewing in 2029 will ask: "Why do we have *two* parsers for the same CLI output and carry a comment calling one of them 'documentation only'?" The answer — `parseMcpToolsTable` is a live risk, not a doc — will be lost to time. Either delete the fallback entirely (recommended) or convert it into a **unit test** that asserts "table and JSON parsers agree" so regression to the table path auto-fails. The current shape violates the "ways the code can be wrong in three years" principle from ADR-0087.

### Failing probes

- `scripts/diag-manifest-interproc.mjs --from 3.5.58-patch.135 --to 3.5.58-patch.136` **exits 1** today. Diagnostic:
  ```
  TABLE-vs-JSON DIVERGENCE on 3.5.58-patch.136: table=265 json=277
    plan-spec table-parser misses 12 tools (4.3%)
  FAIL: table-vs-json divergence 4.3% > strict tolerance 3%
  ```
  Fix recommendations embedded in probe output: (a) update plan spec, (b) delete `parseMcpToolsTable`, or (c) repair the table parser.
- The cross-*version* drop check (10% tolerance) passes at 0.0%. That is not evidence the parser is correct; the JSON payload is simply stable across adjacent patch versions.

### Sign-off: **NO-GO** on current commit.

- Plan document (01-sprint0:9) is now incorrect and must be updated: change "parse `/^\s{2}(...)...(Enabled|Disabled)\s*$/`" to "parse `cli --format json mcp tools`".
- Either delete `parseMcpToolsTable` + `MIN_TOOLS=150` guard stays as-is, OR add a unit test that asserts `parseMcpToolsJson(raw) ⊇ parseMcpToolsTable(raw)` (superset invariant).
- Stub manifest still has `mcp_tools: []` on disk; `--write` never ran. Commit must include the populated manifest or it does not satisfy Sprint 0 acceptance criterion #1 (≥200 tools).

---

## Agent 2 — catalog-builder (`scripts/catalog-rebuild.mjs`)

### 3 worst-case scenarios

1. **Hard-coded `RESULTS = resolve(REPO_ROOT, 'test-results')` makes the script untestable against anything other than the real repo.** My probe had to *copy* the script into a fake repo to exercise it (see `catalog-malformed-json.test.mjs:181-200`). No env override. A future test that wants to exercise `--from-raw` against a deterministic fixture set either copies the script, symlinks the fixture dir (subtle cwd bug) or invokes the exported helpers directly. First two are bug magnets; third is what my probe does, but now two code paths are tested — the helpers and the driver — and integration between them is untested except on the real repo state.
2. **`fingerprint()` uses `first_error_line` which is whatever the first non-blank line is — even for `passed` rows.** Check `fingerprint()` at line 69: `const first = out.split('\n').find(l => l.trim().length > 0) || '';`. For a passing test the fingerprint encodes the first line of normal output. For flaky tests that pass or fail based on non-deterministic log lines (e.g. containing a timestamp, a PID, a wall clock), the fingerprint **churns across runs**. Plan (Queen §E #3) explicitly worries about this. Mitigation: only fingerprint when `status === 'failed'`, and *filter* lines matching `/\d{2}:\d{2}:\d{2}/` (timestamps), `/pid[= ]\d+/`, `/\/tmp\/[^ ]+/` from the `first` selector.
3. **`parseAdr0094Table` greps for digits in ADR-0094-log.md with regexes like `/Total acceptance checks\s*\|\s*(\d[\d, ]*)/`.** This is an almost-right substring grep. Two real failure modes:
   - The "Current coverage state" header might drift (`Current coverage snapshot`, `Current coverage table`). Grep returns `null`, `--verify` exits 2 saying "could not parse", which *looks* like a broken ADR file but is actually a false-alarm: the file parsed fine, the grep is brittle.
   - The `Passing` key also appears in unrelated contexts in the log (e.g. `"Passing the RVF test now requires..."`). The first match wins. Narrow the block to the `| ... |` table by tightening the `block` slice to the first `\n\n` gap after the header, not a blind 2000-char window.

### 3-year hindsight

"Why does the coverage catalog live in `test-results/catalog.jsonl` and ALSO get its fingerprints from first-error-line text that includes timestamps?" will be asked in 2029 when `adr-lifecycle-check.mjs` starts flapping on noise. The catalog is **the source of truth** about coverage — it must not treat human-readable log prose as stable input. Either:
- keep a `canonical_output` field on each row (the first 3 non-timestamp lines), and fingerprint from *that*; or
- fingerprint from structured fields only (`check_id`, `fork_file`, `error_class`), punting the free-text part to a separate `diagnostic_hash` that *is* allowed to churn.

### Failing probes

- `tests/unit/catalog-malformed-json.test.mjs` — all 8 assertions **pass** against the current state:
  - control-char strip removes ESC at byte 0 + 4 in string values (5 total)
  - emoji (🚀) round-trips byte-identically
  - DEL byte (0x7F) is preserved (spec excludes it)
  - subprocess `--append` exits 0, emits `stripped N` observability line
  - catalog rows contain no raw C0 control bytes
- **The probe does NOT find the fingerprint-churn or parseAdr0094Table-grep risk** — those are post-S0 timebombs, not S0 acceptance-criteria blockers. I flag them here for the record; they become Sprint-2 (ADR-0096) concerns per Queen §C row S2.

### Sign-off: **CONDITIONAL-GO.**

- Sprint 0 acceptance criteria are met: `--from-raw` ingests runs, `--show` dashboards, `--verify` works, malformed JSON is sanitised. 8/8 probes green.
- MUST-FIX before Sprint 2 flip to SQLite:
  - Fingerprint-churn guard (scenario 2 above).
  - `parseAdr0094Table` regex tightening (scenario 3 above).
  - At minimum, pass a `--results-dir` arg (or honour `RUFLO_CATALOG_RESULTS_DIR` env) so integration tests don't have to clone the script.

---

## Agent 3 — harness-migrator (`lib/acceptance-harness.sh`)

### 3 worst-case scenarios

1. **`_RK_EXIT` bug still live.** Line 270: `_MCP_EXIT="${_RK_EXIT:-1}"`. The memory entry `reference-run-and-kill-exit-code.md` (I couldn't find it at this path but Queen §C risks and CLAUDE.md's "What we tried" section warns repeatedly) says `$_RK_EXIT` captures `$?` from `cat`, not the CLI. The helper-migrator did NOT rewrite `_expect_mcp_body` to use direct `timeout` invocation — just inherited the broken pattern. A tool that errors with a non-zero CLI exit will surface `_MCP_EXIT=0` (because `cat` succeeded), preventing the harness from distinguishing "tool ran but returned non-match" from "tool crashed". Five of the 10 Tier-X check files depend on this distinction.
2. **JSON unwrap node invocation is a silent fall-through.** Lines 287-300: `node -e '...' || true`. If `node` is not on PATH (cf. `init`'d projects whose PATH is sanitised) the body stays raw and the fallback `if (/{content:[...]}/) { ... }` never fires — but also never errors. ADR-0082 "no silent fallback" is violated: the fallback **branch** is silent. Narrower fix: the node helper must emit a sentinel (`--RUFLO-UNWRAP-OK--` / `--RUFLO-UNWRAP-FAIL--`) on stderr, and the shell must assert presence or leave `_CHECK_OUTPUT` with a diagnostic.
3. **`_with_iso_cleanup` trap-RETURN interacts badly with `set -e`.** Line 369 installs `trap ... RETURN INT TERM`. If the `body_fn` call fails (non-zero exit) and the enclosing check function is `set -e` (which the harness wrappers use), bash's RETURN trap order with errexit is subtle — the trap fires but the outer `"$body_fn" "$iso"` return code is lost. Caller sees cleanup happened; caller doesn't see the body failure surface as `_CHECK_PASSED="false"`. The 10 migrated Tier-X files must demonstrate a *failed* body leading to `_CHECK_PASSED="false"` — that's a unit-test obligation not in Sprint-0 acceptance. The shape is "cleanup succeeded + body failed + result reported as pass" which is exactly the ADR-0082 anti-pattern.

### 3-year hindsight

"Why are we still shelling out to `node -e` from a bash script to parse a JSON envelope the CLI doesn't even emit?" will be the question in 2029. The defensive upstream-may-add-`{content:[...]}` branch is **forward guesswork**. If upstream adds envelope wrapping, it will ship with a deprecation window and the manifest-populator's CLI version pin will stabilise the problem. Delete the unwrap branch today and reinstate when upstream actually ships the envelope change. Otherwise the awk `/^Result:/{f=1;next}f` extraction is doing all the work and the JSON unwrap adds dead code + process-spawn cost per check (~40ms × 452 checks = 18s cascade tax).

### Failing probes

- None written *yet* — my two scripts target Agents 1 & 2 per the brief. However, the harness issues are detectable:
  - A probe that feeds `_expect_mcp_body` a tool whose CLI exits 2 with a regex-match body would PASS under the current code (because regex match wins before `_MCP_EXIT` is even checked). This is a Sprint-1 concern; filed for the follow-up probe-writer.
  - A meta-probe that sets `PATH=/usr/bin` (no `node`) and confirms the unwrap still works via fallback: this is a 4-line shell test; I did not write it here but recommend Agent 3 add it before commit.

### Sign-off: **CONDITIONAL-GO** with reservations.

- Sprint 0 acceptance criterion #4 (`grep -c '_[a-z]*_invoke_tool' lib/acceptance-*-checks.sh` drops 23 → ≤13): I observe **6** Tier-X check files modified in working tree (`aidefence`, `claims`, `coordination`, `hooks-lifecycle`, `model-routing`, `workflow`). Spec calls for **10** migrations (plus `cli-commands`, `file-output`, `input-validation`, `error-paths`). 4 outstanding. Cannot fully sign off on the drift reduction until all 10 land + `grep -c` count is re-run.
- Paired unit test `acceptance-harness-expect-mcp-body.test.mjs` **IS** in `tests/unit/` (corrected — initial review missed it). Also `acceptance-harness-escape-json.test.mjs` landed. That satisfies criterion #3 *structurally*; content not audited by this reviewer.
- Must add before Sprint 1 start: (a) `_MCP_EXIT` direct-timeout fix, (b) no-node-PATH fallback diagnostic, (c) trap-RETURN under set-e regression test.

---

## Shared-premise risks

These emerge only when the three commits land together:

1. **Dual-shape window.** harness-migrator rewrites `_escape_json` to emit canonical JSON escapes (`\u001b` for 0x1B). Any acceptance run produced *before* that commit lands has raw `\x1b` in its `test-results/accept-*/acceptance-results.json`. Any run produced *after* has `\u001b`. catalog-builder's `stripControlChars` runs on the file-text, so it handles the pre-commit shape (strips the raw 0x1B). It does NOT unescape `\u001b` — after commit those are legit JSON escape sequences and round-trip cleanly. Good news: the two shapes compose correctly. **Risk**: any third consumer (e.g. adr-lifecycle-check.mjs, skip-reverify in S2, a future diff of yesterday-vs-today run) that reads both pre- and post-commit JSON files and tries to compare literal `output` strings will see `\u001b` vs nothing, diverging needlessly. Recommendation: catalog-builder should normalise `output` to strip `\x1b[...m` ANSI sequences AFTER parse, not just C0 controls at file level.

2. **Sanity guard arithmetic.** manifest-populator's `MIN_TOOLS=150` is a lower bound. catalog-builder's verifier uses the ADR-0094 table's "Total acceptance checks" as the denominator for coverage percentages. If the manifest is regenerated and legitimately returns 180 tools (upstream refactor), the coverage DENOMINATOR changes — but the ADR-0094-log.md table's Total stays at 452 until a human edits it. `--verify` will exit 1 saying "divergence: total quoted=452 live=452+Δ" and block preflight. No automated reconciler. **Recommendation**: `--verify` should warn-not-fail when only `total` drifts and `passed + failed + skipped` still equals live total; fail only when the pass/fail/skip partition disagrees.

3. **Probe authorship check missing.** Queen §E #1 says `scripts/check-probe-authorship.mjs` enforces "probe-writer ≠ fix-writer". That script **does not exist yet** — I searched (not in `scripts/`). Without it, the mechanical enforcement is a paper policy. Neither of the three Agent-1/2/3 commits can satisfy DA Attack 6 without this guard. **Blocker** for Sprint 1 start (not Sprint 0 acceptance, but the queen-plan premise).

4. **Co-Authored-By mismatch risk.** All three commits will be attributed to `claude-flow <ruv@ruv.net>` by default (per CLAUDE.md commit protocol). The Queen's "probe-writer differs from fix-writer" rule fails open on trivial diff. Either insist on distinct `Co-Authored-By:` trailers per agent, OR move the check to the filesystem level (probe file has `// author: agent-6` banner, source has `// author: agent-N`).

---

## Summary scoreboard

| Agent | Files | Probe fires? | Sign-off | Blockers |
|---|---|---|---|---|
| 1 manifest-populator | `scripts/regen-mcp-manifest.mjs`, `config/mcp-surface-manifest.json` | **Yes — exit 1** on table-vs-JSON divergence | **NO-GO** | Stub manifest on disk; plan spec obsolete; rationale comment factually wrong |
| 2 catalog-builder | `scripts/catalog-rebuild.mjs` | No (8/8 pass) | **CONDITIONAL-GO** | Fingerprint-churn + parseAdr0094Table-grep timebombs for S2 |
| 3 harness-migrator | `lib/acceptance-harness.sh` + 6 Tier-X check files + 2 paired unit tests | N/A (not in brief) | **CONDITIONAL-GO** | `_RK_EXIT` bug; only 6/10 Tier-X migrations observed; 4 outstanding |
| Shared | — | — | **BLOCKED** | `scripts/check-probe-authorship.mjs` does not exist; dual-shape JSON output window |

**Overall Sprint-0 recommendation**: Agent 1 blocks. Agents 2 & 3 can land with follow-up items tracked. Shared-premise probe-authorship guard must exist before Sprint 1.
