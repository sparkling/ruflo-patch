# Risk + Regression Management — All Sprints

Baseline (ADR-0094a-log.md 2026-04-17T15:04Z): **452/396 pass/1 fail/55 skip**, CLI `3.5.58-patch.136`. Every sprint diffs against this, re-freezes on green.

## 1. Regression Matrix (top-3 per sprint)

| Sprint | #1 | #2 | #3 |
|---|---|---|---|
| **S1 ADR-0095** (read-meta-under-lock + fsync) | `persistToDiskInner` rewrite hits every RVF writer → B5 controller round-trips (27 checks) + ADR-0086 Debt-15 row-count probe can flip green→red. | `fsync .meta + dir` latency may tip mega-parallel P3-P4 past bumped 30–60s timeouts (phantom timeout regression). | `.meta`-canonical rule (D4) must not reintroduce BUG-0005 SFVR misread — native/pure-TS coexistence (ADR-0092) fragile. |
| **S3 ADR-0097** (canonical `_expect_mcp_body`, 10 files) | Checks passing "by luck" via domain-keyword regex now unwrap envelope — if `awk '/^Result:/` misses preamble across all 10 domains, prior greens flip red. | `_with_iso_cleanup` trap races subprocess SIGTERM → intermittent red in `claims`, `workflow`, `coordination`. | Deleted per-domain `_<dom>_invoke_tool` may still be sourced by siblings → load-order `command not found`. |
| **S4-S6 Phase 8-10** | Phase-8 invariants mutate state; shared scratch = cross-check contamination (each needs distinct `_e2e_isolate` id). | Phase-9 concurrency (N=8) re-triggers S1's RVF inter-proc path → false-positive S1 regression. | Phase-10 idempotency "repeat⇒same" breaks on legit monotonic ids (session_id, trace_id). |
| **S7 skip hygiene** | Auto-promoter flips genuine permanent SKIP (native-only on pure-TS build) → fail that wasn't a regression. | Skip-streak counter resets on catalog rebuild; legit flakes lose history. | Flip-flop detector promotes oscillating pass/skip (embeddings jitter) prematurely. |

## 2. Post-Sprint Probe — Reporting Format

After each sprint-merge: full cascade → `node scripts/catalog-rebuild.mjs --append --compare-to <pre-id>` → `test-results/regression-<sprint>.md`:
```
## Sprint <N> — <ISO>
Pre:   452 / 396 pass / 1 fail / 55 skip
Post:  452 / 397 pass / 0 fail / 55 skip
NEW failures (green→red): 0
NEW skips    (green→skip): 0   ← counts as regression
NEW passes:  1 — t3-2-concurrent (ADR-0095)
Wall-clock:  122s → 131s (budget 300s)
Verdict: GREEN
```
`NEW failures>0` OR `NEW skips>0` OR `wall-clock>300s` = RED → §5 rollback.

## 3. Fingerprint False-Positives

Base: `sha1(check_id + first_error_line + fork_file)`. Collision handling: extend to `sha1(… + last_error_line + exit_code)`. Catalog stores both; short match + long differ → emit `[FP-COLLISION]`, treat as **new** failure. Ledger `BUG-XXXX.alt-root-causes[]`; any entry with `length>1` blocks auto-close (manual review).

## 4. Upstream Merge Plan

Divergence after S2 ≈ 7-9 fork commits. `sync upstream` runs **after S2 gate passes**, **before** S3 (ruflo-patch-only; avoids mid-migration conflicts on 10 files).

Rollback if upstream touched our territory:
```bash
cd forks/ruflo && git fetch ruvnet main && git merge --no-commit --no-ff ruvnet/main
# Re-run ADR-0095 probes; if upstream satisfies gate → checkout --theirs rvf-backend.ts
# Else → checkout --ours. Then: npm run build ; test-acceptance-fast.sh all
```
Never force-push `sparkling`; every merge is a new commit (bisect survival).

## 5. Per-Sprint Rollback

Each sprint = one commit (or prefix `adr0095:`, `adr0097:`, `phase8:`). Regression:
```bash
git revert --no-edit HEAD && bash scripts/test-acceptance-fast.sh all | tee /tmp/post-revert.log
```
Fork: `cd forks/ruflo && git revert <sha> && git push sparkling <branch>`, then rebuild + republish. Never `reset --hard` `sparkling`.

## 6. ADR-0087 Probe Enforcement

**Owner: adversarial-reviewer** in each swarm (not implementer — avoids confirmation bias). Probe at `scripts/diag-*.mjs` **before** fix merges. Gate: "probe passes post-fix AND would have failed pre-fix" — logged in `test-results/probe-ledger.jsonl`:
```json
{"sprint":"S1","fix_sha":"abc1","probe":"diag-rvf-interproc-rename-atomicity.mjs","fails_pre":true,"passes_post":true}
```
Target ratio = 1.0. Miss = sprint gate fails.

## 7. Known-Knowns — Preassigned Guards

| Anti-pattern | Guard |
|---|---|
| Regex too narrow (33% cause) | **L2**: every `_expect_mcp_body` regex must match ≥1 entry in `test-results/fixtures/envelope-samples.jsonl`. |
| Timeout <15s on heavy tools | **L3**: `_run_and_kill` with `$to<15` for embeddings_*, hooks_route, memory_store = lint error. |
| JSON control chars | **G1**: `_escape_json` strips `[\x00-\x08\x0B\x0C\x0E-\x1F]` on emit + catalog `--append` ingest. |
| CJS/ESM (BUG-0001) | **G2**: preflight rejects `require(` in fork ESM modules. |
| Native/pure-TS magic (BUG-0005) | **T1**: `adr0086-rvf-integration.test.mjs` asserts reader accepts both magics. |
| `grep -c … \|\| echo 0` | **L4**: preflight rejects; use `var=$(grep -c …); var=${var:-0}`. |
| Raw `npx @sparkleideas/cli@latest` | **L5**: rejected in `lib/acceptance-*.sh`; must use `$(_cli_cmd)`. |
| `_run_and_kill` exit-code | **L6**: rejects `[[ "$_RK_EXIT" -eq 0 ]]`; inspect stdout/file. |
