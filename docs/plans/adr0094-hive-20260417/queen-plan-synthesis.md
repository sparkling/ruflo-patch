# Queen Plan Synthesis — ADR-0094 → 100%

Baseline: **452/396/1/55** (invoked/pass/fail/skip) at CLI `3.5.58-patch.136`, cascade 122s.
Goal: ADR-0094 `Implemented` with real-failure-driven ADRs 0095/0096/0097. **No ADR-0098+ drafted** (DA Veto 1).

---

## A. Cross-expert alignment issues

**A1. Envelope shape.** ADR-0097 (04-adr0097:10-13) assumes `{content:[{type:"text",text:..}]}`. Sprint-0 (01-sprint0:22-30) verified real shape is `[AgentDB]…\n[INFO]…\n[OK]…\nResult:\n<body>`. **Resolution:** strike node unwrap; use `awk '/^Result:/{f=1;next}f'`. ≤40 LOC.

**A2. ADR-0095 stated fix vs. source.** 02-adr0095:5 flags `mergePeerStateBeforePersist` already re-reads `.meta`+replays WAL. **Resolution:** S1 starts `root-cause-investigator` ALONE (SEQ 1). No implementer until D1–D6 ruled + architect amendment posted.

**A3. DAG dependencies.** 09-parallelism fans `{S1,S2,S3}` post-S0. 02-adr0095 blocks S5 on S1. 04-adr0097 blocks S4/S5/S6 on S3. **Resolution:** accept 09's fan; add explicit edge S3→S5.

**A4. Skip buckets.** 03-adr0096:20-26 has 5 ingest buckets; 11-skip-hygiene:22-26 has 4 action buckets. **Resolution:** keep both. Map `missing_binary+missing_env`→A; `tool_not_in_build`→D; `runtime_unavailable`→C; `prereq_absent`→B.

**A5. Catalog storage.** Sprint-0 proposes JSONL; ADR-0096 keeps SQLite. **Resolution:** JSONL in S0, promote to SQLite in S2. JSONL stays as `--export-jsonl` fallback.

**A6. Probe ownership.** DA attack 6 + 02/04/05 all separate probe from fix. **Resolution:** probe-writer Co-Authored-By MUST differ from fix-author's on colocated commits.

---

## B. DA verdict

- **Attack 1 (ADR inflation):** **Upheld.** 4 Proposed, 0 Implemented — no ADR-0098+ until 0094 flips.
- **Attack 2 (sequential sprints):** **Partially upheld.** S3→S4/S5/S6 helper dep real; S1→S5 RVF dep real. S2 does NOT block S4.
- **Attack 3 (swarms amplify confidence):** **Upheld.** t3-2 10/10 self-certification is documented; cap sub-0094 swarms at 8.
- **Attack 4 (80% ship line):** **Partially upheld.** Ship line = `invoked==100% AND verified≥85%`.
- **Attack 5 (fork-patch ceiling):** **Partially upheld.** Cap real; N=15 is arbitrary — see §F.
- **Attack 6 (probe=fix writer blind spot):** **Upheld.** Co-Authored-By diff enforced.
- **Attack 7 (skip-reverify cron rot):** **Upheld.** Fold into cascade nightly tier.
- **Attack 8 (Phase 11+ budget-gated = never):** **Partially upheld.** No cap floor; accept opportunistic.

**Vetoes:**
1. **Upheld** — no ADR-0098+ before 0094 Implemented.
2. **Upheld** — no 15-agent swarms below 0094 scope; cap 8.
3. **Upheld** — ship line 85% verified + 100% invoked.

---

## C. Revised sprint order

| # | Sprint | Pre-gate | Swarm profile | Scope | Post-gate | Deltas | Pri | ADR |
|---|---|---|---|---|---|---|---|---|
| **S0** | Prereqs | Baseline green | **4** hier-raft: coordinator, manifest-impl, catalog-impl (JSONL), harness-impl + adv-reviewer | `config/mcp-surface-manifest.json` (via `cli mcp tools`); `scripts/regen-mcp-manifest.mjs`; `scripts/catalog-rebuild.mjs` (JSONL + control-char strip); `lib/acceptance-harness.sh` (`_expect_mcp_body` awk, `_mcp_invoke_tool`, `_with_iso_cleanup`) | Manifest ≥200 tools; catalog --show=396/1/55; paired unit test green; 10 Tier-X migrated; cascade ≤150s | 0/0/0; 3 commits | **P0** | 0094 scaffold |
| **S1** | ADR-0095 RVF | S0 green; D1-D6 ruled by investigator FIRST | **6** hier-raft (02-adr0095): coord, root-cause-invest (SEQ 1), architect (SEQ 2), parallel {impl, adv-reviewer, probe+integ-tester} | `forks/ruflo/src/storage/rvf-backend.ts`; `scripts/diag-rvf-interproc-{race,rename-atomicity,fsync-durability}.mjs`; BUG-0008 closed | t3-2 green 3×/d×3d at N=6; all 3 probes green; Debt-15 row-count probe green; no SQLite re-intro; P95 persist ≤50ms N=8 | +1 pass, −1 fail; +2s | **P0** | 0095 Impl |
| **S2** | ADR-0096 catalog | S0 green (parallel with S1) | **4** hier-raft (03-adr0096): catalog-impl, skip-reverify-impl, manifest-impl + adv-reviewer. Schema bootstrap SYNC first | `scripts/catalog-rebuild.mjs` (SQLite + fingerprints + dashboard); `scripts/skip-reverify.mjs` (5 probes + sidecar install); `lib/acceptance-catalog-checks.sh` (≥6 checks) | 179 runs ingested; 55 skips classified; fingerprint churn ≤20/d; `--verify` regression test green; no `retry/retries/attempts` in scripts | 0/0/0; +3s | **P0** | 0096 Impl |
| **S3** | ADR-0097 helpers+lint | S0+S1+S2 green | **6** hier-raft (04-adr0097): coord, architect, coder-lint, coder-tests, tester, adv-reviewer + probe-writer. Architect SYNC first | `scripts/lint-acceptance-checks.mjs` L1-L7; `config/adr0097-grandfathered.json` (54 files); preflight Tier-Y hook; migrate 10 Tier-X + 10 paired unit tests | 23 drifted `_<dom>_invoke_tool` → 0 in Tier-X; lint preflight green; 3 evasion probes FAIL preflight; Tier-Z ledger filed | 0/0/0; −15s | **P0** | 0097 Impl |
| **S4** | Phase 8 invariants | S3 landed | **5** hier-simple-maj (05-phase8): Impl A (INV-1,2,7), Impl B (INV-3,4,5), Impl C (INV-6,8,9,10), adv-reviewer, probe-writer (INV-11) | `lib/acceptance-phase8-invariants.sh` (10 INV + INV-11 delta-sentinel) | 10 INV green; INV-11 fails on stubs; ≤20s; distinct `_e2e_isolate` per check | +10 pass; +20s | **P1** | 0094 P8 |
| **S5** | Phase 9 concurrency | S1 stable AND S3 landed | **6** hier-raft (06-phase9): harness-agent FIRST, claims, session, workflow, rvf-bridge, adv-reviewer | `lib/acceptance-phase9-concurrency.sh`; `_race_N_cli` addition | 7 races green 3×/d×3d; spread<100ms; meta-regression (delete `_race_N_cli` → all 7 FAIL) | +7 pass; +30s | **P1** | 0094 P9 |
| **S6** | Phase 10 idempotency | S3 landed | **2** hier-simple-maj (07-phase10): P10-A impl, P10-B wire+verify | `lib/acceptance-phase10-idempotency.sh` (A-H); `_p10_invoke` observer | 8 green; `f(x);f(x)` row-count delta; no silent no-op; ≤10s | +8 pass; +10s | **P1** | 0094 P10 |
| **S7** | Skip hygiene | S2 landed; AFTER S4-S6 to avoid bucket churn | **8** hier-mesh weighted-maj (cap 8 per Veto 2): 4 cluster leads + coord + reviewer + harness + probe-writer | Bucket B rewrites (+12 pass); Bucket C ledger; Bucket A Playwright nightly tier + GITHUB_TOKEN; Bucket D investigation → BUG-NNNN + upstream PRs | Skip 55→≤10; every skip has ledger; `streak_days>30` zero/ticketed; skip-reverify in cascade; Playwright separate tier | +45 pass, +2 fail (D bugs), −47 skip; +8s | **P2** | 0096 P2 |

**Final:** 443 pass / 2 fail / ~10 skip / 455 invoked ≈ **97.4% verified**. Cascade ≈ 180s.

---

## D. Strike-throughs and reorderings

1. **STRIKE ADR-0097 node-based `_mcp_unwrap`** (04-adr0097:11). **REPLACE** with `awk '/^Result:/{f=1;next}f'` per Sprint-0 finding.
2. **STRIKE 09-parallelism implied serial sprint execution.** Fan S4/S5/S6 in parallel post-S3; DA attack 2 upheld.
3. **REORDER S1: investigator SEQ 1 ALONE, implementer blocked until architect rules D1-D6.** Deliberately violates one-message rule because plan's stated failure mode may already be shipped.
4. **STRIKE S0 SQLite-first catalog.** Use JSONL in S0; promote to SQLite in S2. JSONL stays as export fallback (ADR-0086 RVF-primary extends).
5. **STRIKE skip-reverify as separate cron** (09-parallelism §5). DA attack 7 upheld — fold into cascade; cron dies silently (ADR-0088).
6. **STRIKE 08-topology 15-agent S7 swarm.** Cap at 8 per DA Veto 2.
7. **DEFER 12-documentation preflight rot-check to S2.** Don't gate S0 on docs infrastructure.
8. **STRIKE 11-skip-hygiene 80% framing.** Ship line is 85% verified + 100% invoked per DA Veto 3.
9. **REORDER S7 to run AFTER S4-S6.** Finalize skip taxonomy against stable check population.
10. **STRIKE CLAUDE.md update per sprint.** Only pattern-level lessons, not tactical.

---

## E. Shared-premise defenses

Prevent next "swarm declared fix, real test fails" (t3-2 10/10 lie):

1. **Probe-writer ≠ fix-writer, enforced.** `scripts/check-probe-authorship.mjs` (S0) diffs Co-Authored-By on colocated `diag-*.mjs` + source file commits in same PR. **DA Attack 6 enforced mechanically.**
2. **Investigator-phase precedes implementer-phase in S1+.** No implementer spawns until architect posts amendment. S1 cannot "one message" — investigator ruling is gate.
3. **Meta-regression probe per sprint** (ADR-0090 A2/A4 pattern): S4=INV-11 delta-sentinel; S5=delete `_race_N_cli` → all 7 FAIL; S6=stub `memory_store` → all 8 FAIL; S7=delete ledger → `--verify` FAIL.
4. **2-cascade stability before "victory".** No ADR flips `Implemented` on first green — 3 consecutive × 3 calendar days.
5. **Adversarial-reviewer in EVERY swarm.** Must produce ≥1 failing probe pre-signoff.
6. **Skip-reverify INSIDE cascade, not cron.** DA attack 7 fix.
7. **ADR-0094-log.md single source of truth.** Sibling ADRs append to own `Implementation notes`, cap 200 lines.

---

## F. Fork-patch ceiling

**DA Attack 5 modified.** N=15 arbitrary. **Proposal: N=30 soft, N=50 hard.**

- **Soft N=30:** patch #31 requires upstream PR + 14-day timeout before fork. Ledger columns `upstream_pr_url` + `upstream_timeout_date`.
- **Hard N=50:** no new fork-only patches.
- **Enforcement:** `scripts/adr-lifecycle-check.mjs` rule **(f)**: ledger entry `fix_commit` age >30d requires `upstream_pr_url OR upstream_declined_reason`. Preflight exit 1 if fork-only count >30 AND newest lacks `upstream_pr_url`.
- **Rationale:** N=15 halts velocity; N=30 + forced-upstream-attempt keeps velocity.
- **Location:** ledger column, not commit hook.

---

## G. Budget reconciliation

Current 122s; cap 300s; headroom 178s.

**Adds:** S4 +20s · S5 +30s · S6 +10s · S7 skip-reverify +20s (bucket-probe reuse, not 110s) · S2 catalog +3s. **Gross +83s.**

**Saves:** S3 helper dedup −15s (23→1 centralization, 3x 09's −5s) · retire-or-fold −10s. **Net +58s → cascade 180s. 120s headroom.**

**Retire-or-fold** (09-parallelism §5: ≥90d green, lifecycle-superseded):
- **FOLD `check_adr0086_debt15_surface_exists`** — superseded by ADR-0090 Tier A1 row-count probe. Delete S2.
- **FOLD 4-6 `config_get` read-only checks in Phase 4** — superseded by Phase 10 Check C. Delete S6.
- **FOLD `check_adr0059_phase1_bootstrap`** — superseded by INV-8 session round-trip. Delete S4.
- **RETAIN Phase 9 race checks** — mutation surfaces forbid retirement until Phase 9 exists.
- **NO retire** browser/github skips — `expected_skip` bucketed, not counted.

---

## H. Risks I accept

1. **Investigator finds ADR-0095 fix already shipped; real bug elsewhere.** Accepted: S1 investigator-first catches in 1d. **EWS:** commit `amendment: D1 false, cause is D3/D4`; scope stays ≤1 file.
2. **Phase 9 N=8 re-triggers S1 RVF bug (false-positive regression).** Accepted: S1 gate 3×/d×3d before S5. **EWS:** Phase 9 meta-regression probe fires; `diag-rvf-interproc-race.mjs` wrapper explicit.
3. **Tier-X migration breaks green check via envelope normalization.** Accepted: 10 files only; paired tests; 3×/d×3d cascade. **EWS:** `grep -c '_[a-z]*_invoke_tool'` monotone 23→13; any increase aborts.
4. **Skip classifier misbuckets ≥5 skips.** Accepted: S7 AFTER S4-S6 (stable pop); manual-review gate. **EWS:** S2 requires 55 classified; `bucket:unknown` blocks.
5. **Fork-patch N=30 cap slips toward N=50.** Accepted: pace ≤60/month; rule (f) blocks fork-only past 30. **EWS:** weekly ledger fork-only vs. upstream-PR count.

---

## I. Closing directive

Execute in order. Respect hive-then-swarm. **No ADR-0098+ until 0094 Implemented.**

1. Spawn S0 4-agent swarm in ONE message background. Write `config/mcp-surface-manifest.json` via `scripts/regen-mcp-manifest.mjs` using `cli mcp tools` (NOT `list-tools`); JSONL `scripts/catalog-rebuild.mjs` with control-char strip; `lib/acceptance-harness.sh` additions; migrate 10 Tier-X files. Three commits.
2. Spawn S1 root-cause-investigator ALONE. Reproduce t3-2 at N=6; rule D1-D6 before implementer.
3. After investigator returns, spawn S1 architect alone. Writes `Implementation notes` on `docs/adr/ADR-0095-rvf-inter-process-synchronization.md`.
4. After architect, spawn S1 tail 3-parallel (implementer, adv-reviewer, probe-writer) in ONE message. Probe-writer Co-Authored-By DIFFERS from implementer.
5. In parallel with S1, spawn S2 4-agent swarm. Schema bootstrap SYNC, then 3-parallel scripts, barrier to adv-reviewer + `lib/acceptance-catalog-checks.sh`.
6. **Gate S1:** flip ADR-0095→`Implemented`; close BUG-0008; strike ADR-0094 open-item #1.
7. **Gate S2:** flip ADR-0096→`Implemented`.
8. Spawn S3 6-agent swarm. Architect SYNC first, Block A 3-parallel, Block B 3-parallel. Probe-writer demonstrates 3 evasion probes FAIL preflight.
9. **Gate S3:** flip ADR-0097→`Implemented`.
10. Run `npm run sync` between S3 and S4. Rollback per 10-risk §4.
11. Fan S4+S5+S6 in parallel: three Task batches in ONE message. S5 harness-agent FIRST via explicit prompt ordering. Each spawns single-message per CLAUDE.md "After spawning, STOP".
12. **Gate S4+S5+S6:** 10 INV + 7 races + 8 idempotency green; meta-regression probes present; cascade ≤200s.
13. Spawn S7 8-agent hier-mesh swarm: Bucket B (3d) + C (1d) + A (5d Playwright nightly tier separate) + D (→BUG-NNNN + upstream PRs).
14. **Gate S7:** skip 55→≤10; ledger complete; skip-reverify inside cascade; Playwright `test-acceptance-browser.sh` separate.
15. **Final:** flip ADR-0094→`Implemented` at 443/2/10 (≈97.4% verified). Regenerate changelog; `adr-lifecycle-check.mjs` rules (a)-(f) green. No ADR-0098+ drafted.
