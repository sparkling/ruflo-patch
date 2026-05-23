# Session Handover — 2026-05-29

> Companion to `docs/SESSION-HANDOVER-2026-05-28.md` (Move A
> follow-up agenda — now executed). This handover is **execution
> record + forward look**: what landed in the 2026-05-24 session
> (Stages A–F), what stayed deferred with cited reasons, and what
> the next session should pick up.

## TL;DR

- **All 11 Move A follow-up items + 3 standing carry-forwards + 3
  open horizons from the 2026-05-28 handover were addressed this
  session.** Most landed; remaining items deferred with cited
  conditional reasons (see Stages D–F below).
- **Stage B fully landed in the `/loop` continuation phase**:
  B1 (lint), B2 (3 forks/ruflo cleanup commits resolving all 42
  drifts), B3 (acceptance trip-wire with planted-drift smoke test).
- **11 commits in `ruflo-patch/main`** (`5439372` → `4d50f0c`),
  **6 fork-side commits** (5× forks/ruflo, 1× forks/agentdb).
- **Acceptance baseline at handover:** 16/16 PASS on
  `adr0059,p4,adr0208` (was 15/15 — the new trip-wire is the 16th
  check).
- **All 5 trees clean** at handover.
- **Net-new ADRs:** 1 (ADR-0228 EWC++ per-call adapt — proposed).
- **Next-session priority:** ADR-0181 Phase 4 (cli-process-backend
  handler un-stub — promotable, preconditions met) and ADR-0228
  implementation (4 open questions resolution first).

## What landed (Stage A–F execution record)

### Stage A — Quick wins (4/4 closed)

| # | Item | Commit | Outcome |
|---|---|---|---|
| A1 | ADR-0220 F-05-016 closure amendment | `1093850` | Verified `learning-bridge.ts:261-276` already shipped the fix; amended ADR-0220 closing the "status unclear" gap. |
| A2 | ADR-0213 busy_timeout closure amendment | `2f7d0da` | Verified `input-validation.ts:64-72` shipped `busy_timeout` in ALLOWED_PRAGMAS (fork commit `d1b6145`); amended ADR-0213 closing the first precondition for the deferred opt-in registration ADR. |
| A3 | ADR-0210 INTEGRATION-LEDGER row | `22e43e9` | Appended row for `98d10e489` (3 hand-ports: hooks_explain / hooks_pretrain / hooks_intelligence-reset); cites upstream `5d40236b1` as representative SHA. Closes the [[feedback-update-integration-ledger]] debt. |
| A4 | ADR-0214 USERGUIDE env-var cleanup | `cac5560bb` (forks/ruflo) | Aligned `forks/ruflo/docs/USERGUIDE.md` env-var docs to loader reality. Renamed bare `_TOPOLOGY` → `_SWARM_TOPOLOGY` (the actual loader name). Fixed `_MEMORY_BACKEND` → `_MEMORY_TYPE`. Updated `EMBEDDING_DIM` default `384` → `768` per [[reference-embedding-model]]. Tagged 9 unhonored vars `[doc-only]` with a banner. |

### Stage C — ADR-0217 quarantine (5/5 closed)

Single ADR-0217 closure amendment (`4a3bf3d`) records all 5 sub-items:

| # | Item | Outcome |
|---|---|---|
| C1 | Vector-clock carve-out verified | Already preserved at `agentdb/src/index.ts:174-198` (3 `@public` + 4 `@internal` markers + ADR-0217 comment block). 4 arch-test assertions pin this. |
| C2 | CLI guard for `agentdb sync` | `forks/agentdb` commit `0a3bed3` added guards to `quicStartServer` + `quicConnect` (matching pre-existing `quicPush` / `quicPull` pattern). Truncated dead bodies that referenced QUICServer/QUICClient classes (which C3/C4 deleted earlier in Move A). |
| C3 | `resolveConflicts` / `conflictStrategy` retraction | Already shipped (as `@deprecated` retention + public-surface retraction). Arch-test pins all 3 forms. |
| C4 | `QUICConnectionPool` / `QUICStreamManager` file deletion + arch-test | Already shipped. Arch-test §§1-2 pin file non-existence. |
| C5 | Honest docs sweep | `forks/agentdb` `a17dab1` (QUIC docs banners on QUIC-INDEX.md + QUIC-ARCHITECTURE.md + QUIC-SYNC-IMPLEMENTATION.md) + `forks/ruflo` `684a98744` (USERGUIDE QUIC notes). |

All 13 tests in `forks/agentdb/tests/unit/adr0217-adr0222-arch.test.ts` pass post-session.

### Stage D — Larger items (4 landed, 1 deferred-by-condition)

| # | Item | Commit | Outcome |
|---|---|---|---|
| D7 | New ADR for ADR-0220 F-05-007 EWC++ per-call adapt | `3dcd705` (ADR-0228) | Drafted via adr-architect agent. Recommends **Option C — Hybrid** (per-call accumulates without EWC++; background applies EWC++ to accumulated micro-tier state, gated by opt-in flag). Implementation deferred to a follow-on session. 4 open questions explicitly flagged as gating implementation (Fisher matrix size mismatch, placeholder input on TS path, WASM artefact EWC availability, ADR-0193 alignment). |
| D8 | ADR-0221 F-06-006 agentic-flow consumer demotion | — | **DEFERRED per handover's own conditional** ("Follow-up ADR if it surfaces in acceptance"). Acceptance is 15/15 — F-06-006 has not surfaced. Pattern (`agentdb-service.ts:832-836` try/catch demotion of `graphEnabled`/`gnnEnabled`/`routerEnabled`/`sonaEnabled`) is real but matches an existing pattern, not a regression. Re-evaluate next session if acceptance trips. |
| D9 | ADR-0222 upstream merge-tax runbook note | `be1c4ae` | Appended "Re-introduction guards" section + sync runbook to INTEGRATION-LEDGER.md. Covers `federated-learning.ts` (ADR-0222) + `QUICConnectionPool.ts`/`QUICStreamManager.ts` (ADR-0217). Cites the existing arch-test pins. |
| D10 | ADR-0214 Council MUST-FIX #2 honoured-by-loader test | `c8673c0f8` (forks/ruflo) | New test at `forks/ruflo/v3/@claude-flow/shared/__tests__/config-loader-env-honoured.test.ts`. 9 cases (6 positive + 1 invalid + 1 rebrand-correctness + 1 unset-default). All pass. Also closed ADR-0214 with amendment `f62b64a`. |
| D11 | ADR-0224 sync-vs-async drift amendment | `939db69` | Re-read `getValidatedConfig` JSDoc rationale; locked the sync choice as intentional-for-now (substrate callsites are module-init top-level eager reads, no `await` available). Revisit gated on a separate substrate-refactor ADR. |

### Stage B — ADR-0208 outstanding sub-steps (3/3 landed in `/loop` continuation)

| # | Item | Commit | Outcome |
|---|---|---|---|
| B1 | `scripts/check-manifest-flag-drift.mjs` lint | `ae85038` (ruflo-patch) | Phase 1 lint shipped. Initially exited 1 with 42 drifts on current state (matches ADR-0208's inventory exactly: 12 manifest flags + 6 undefined subcommands + ~20 doc flags). Phase 1 limitations documented inline: declared-set via regex over `hooks.ts`, NOT resolved command tree (alias/spread options at `hooks.ts:4497/4516/4548/4557` may produce false positives — to be addressed when AST-resolution lands). |
| B2 | Clean 11 undeclared flags + 6 undefined subcommands | `c18cb12dd`, `15c45da11`, `2cf96d189` (forks/ruflo) | **DONE.** Dispatched 3 parallel coder agents (b2-claude-plugin, b2-upstream-manifests, b2-shipped-docs) per the agent-fan-out protocol. `c18cb12dd`: `.claude-plugin/hooks/hooks.json` (6 → 0). `15c45da11`: `plugin/hooks/hooks.json` + `plugins/ruflo-core/hooks/hooks.json` (18 → 0; 4 fabricated subcommand blocks deleted in `plugin/`; 2 fabricated subcommand blocks deleted in `plugins/ruflo-core/`). `2cf96d189`: 5 hooks docs in `.claude/commands/hooks/` (18 → 0). All 6 undefined subcommands (mcp-pre, mcp-post, pre-search, post-search, modify-bash, modify-file) verified absent from upstream too. **Total drift: 42 → 0.** |
| B3 | Acceptance trip-wire | `ca1e6ec` + `4d50f0c` (ruflo-patch) | **DONE.** `ca1e6ec`: `lib/acceptance-adr0208-checks.sh` + new `adr0208` group in `scripts/test-acceptance-fast.sh`. Planted-drift smoke test confirms both transitions: bogus flag in post-edit.md → FAIL (1 drift); revert → PASS. `4d50f0c`: gitignore the `.claude-flow/routing-outcomes.json` daemon-generated runtime artifact. **Acceptance baseline becomes 16/16 PASS on `adr0059,p4,adr0208`.** |

### Stage E — Standing carry-forwards (status checks)

| # | Item | Verdict |
|---|---|---|
| E1 | ADR-0181 Phase 4 cli-process-backend handler un-stub | **PROMOTABLE.** Preconditions met — ADR-0230 hybrid-tier wiring landed 2026-05-23 (fork commit `fe682324b`). The `MutationContext` factory can now construct the hybrid-tier backend. Outstanding: un-stub 6 handlers (route, pattern-search, reflexion-retrieve, skill-search, daemon×2) with hybrid-tier construction. Substantial multi-handler undertaking — promote to next-session agenda. |
| E2 | 19 Batch S source-conflict deferrals (non-ADR-125) | **STAYS CARRY-FORWARD.** No per-family re-evaluation this session. 62 upstream cherries picked since 2026-05-23 but the Batch S 19 are an explicit deferral set requiring sync-sweep re-eval. |
| E3 | 5 ruvector Batch O deferrals (sparse-attention) | **STAYS CARRY-FORWARD with status change.** Some consumer code now exists in `forks/ruflo/v3/@claude-flow/plugins/src/integrations/ruvector/` (attention-executor.ts:3 sparse mentions; attention-mechanisms.ts). Was "not consumed" per the 2026-05-28 handover — now "partial consumption, re-eval gated on dedicated sweep." |

### Stage F — Open horizons

| # | Item | Verdict |
|---|---|---|
| F1 | Move B candidates | None active. No new horizon opened. |
| F2 | Pushing to `sparkling` | Nothing pushed this session. User decision when ready. Still 3+ sessions of unpushed work. |
| F3 | Periodic upstream sync trigger | A3 ledger row landed — the hard precondition for any agent-led sync touching `hooks-tools.ts` is now satisfied. No sync executed this session. |

## Acceptance baseline at handover

- `bash scripts/test-acceptance-fast.sh adr0059,p4,adr0208` → **16/16 PASS** (new adr0208 trip-wire is the 16th check)
- `bash scripts/test-acceptance-fast.sh adr0059,p4` → 15/15 PASS (legacy baseline)
- `cd forks/agentdb && npx vitest run tests/unit/adr0217-adr0222-arch.test.ts` → 13/13 PASS
- `cd forks/ruflo/v3 && npx vitest run @claude-flow/shared/__tests__/config-loader-env-honoured.test.ts --exclude="**/node_modules/**"` → 9/9 PASS
- `node scripts/check-manifest-flag-drift.mjs` → exit 0 (lint clean — every manifest/doc flag and subcommand resolves to a declaration)

## File-system state at handover

| Location | State |
|---|---|
| `forks/ruflo/main` | clean; 6 commits ahead of session start (A4, C5, D10, B2 ×3) |
| `forks/agentdb/main` | clean; 2 commits ahead of session start (C2, C5) |
| `forks/agentic-flow/main` | unchanged (D8 deferred) |
| `forks/ruv-FANN/main` | unchanged |
| `forks/ruvector/main` | unchanged (D7 implementation deferred) |
| `ruflo-patch/main` | `4d50f0c`; 11 commits ahead of session start `5439372` |
| `sparkling/*` push state | nothing pushed in 3+ sessions |
| `hz` remote | untouched per [[feedback-never-touch-hz-remote]] |

## Recommended next-session priority order

### Tier 1 — Larger items with clean preconditions

1. **ADR-0181 Phase 4 — cli-process-backend handler un-stub.**
   Promoted from standing carry-forward (E1). Substrate ready
   (ADR-0230 done). Un-stub 6 handlers (route, pattern-search,
   reflexion-retrieve, skill-search, daemon×2); verify
   `(svc as any).backend instanceof HybridBackend === true` per
   ADR-0181 Phase 4 land checklist + ADR-125 Acceptance Criterion #2.
   Substantial multi-handler undertaking deserving its own session.
2. **ADR-0228 implementation (EWC++ per-call adapt).** The proposal
   landed this session; the 4 open questions need resolution before
   implementation (see ADR-0228 § "Open questions"). Most critical:
   Q-1 (Fisher matrix sized for BaseLoRA not MicroLoRA — would
   silently no-op without a second EWC instance).

### Tier 2 — Conditional / opportunistic

3. **D8 — ADR-0221 F-06-006 consumer demotion.** Re-check next
   session: if acceptance trips on the copy-paste anti-pattern at
   `agentic-flow/src/services/agentdb-service.ts:832-836`,
   implement the demote. Otherwise stays deferred.
4. **B1 lint Phase 2.** Upgrade to AST-resolution of the command
   tree (or `dist/src/commands/hooks.js` dynamic import) so the
   alias/spread options at `hooks.ts:4497/4516/4548/4557` are
   covered. Will reduce false-positive class. Not blocking — the
   current Phase 1 lint correctly identified all 42 drifts.

### Tier 3 — Open horizons

5. **Push to `sparkling`** — 3+ sessions unpushed. User decision.
6. **Periodic upstream sync** — A3 ledger row precondition now met;
   D9 runbook documents the `--ours` paths the next sync needs.

## Pre-flight (run before any work)

Identical to prior sessions:

```bash
# 1. Fork ruflo clean
git -C /Users/henrik/source/forks/ruflo status --short
# expect: empty

# 2. Ruflo-patch clean
git -C /Users/henrik/source/ruflo-patch status --short
# expect: empty

# 3. Acceptance baseline (includes new adr0208 trip-wire)
bash scripts/test-acceptance-fast.sh adr0059,p4,adr0208
# expect: 16/16 passed

# 4. Manifest drift inventory (now clean — guards against regression)
node scripts/check-manifest-flag-drift.mjs
# expect: exit 0 — Lint OK
```

Abort on any failure; surface the discrepancy. Per
[[feedback-trace-before-hypothesis]] — if a failure surfaces ≥2
related checks, spawn a read-only trace agent FIRST before any fix
hypothesis.

## Standing rules in effect

Unchanged from prior handovers — re-stated for self-containment:

- [[feedback-remediation-adr-preflight]] — 4-check preflight if any
  new ADR work happens
- [[feedback-no-fallbacks]] — silent fallbacks banned
- [[feedback-update-integration-ledger]] — A3 closed the open debt;
  next sync still owes new rows (per D9's runbook)
- [[feedback-trace-before-hypothesis]] — ≥2 related fails → trace
  agent before fix hypothesis
- [[feedback-commit-often]] — never leave untracked ADRs / fixes
  across a session; pre-handover `git status --short` MUST be clean
- [[feedback-always-use-the-skill]] — Skill tool for skill-wrapped
  capabilities
- [[feedback-trunk-only-fork-development]] — all on `main`, no PRs
- [[feedback-never-touch-hz-remote]] — `hz` remote off-limits
- [[feedback-no-history-squash]] — no squashing
- [[feedback-skip-accepted-as-squelch]] — `skip_accepted` is for
  tool-not-found / env-disabled, NOT architectural deferral
- [[feedback-no-time-estimates]] — risk shape only, not time anchors
- [[feedback-inspect-installed-not-dev-nodemodules]] — audit via
  fresh `/tmp` install, never dev `node_modules/`
- [[feedback-commit-forks-before-release]] — commit fork edits
  before `npm run release` (no release this session)
- [[feedback-test-in-init-projects]] — fresh-init harness for
  behavioural tests (D10 test pattern — vitest in fork, isolated
  via tempDir + saved/restored env)
- [[feedback-corpus-evidence-before-feature-work]] — applied to
  D7's Option C choice + B4 (ADR-0208 Step 5 fuzzy-match) staying
  deferred

## How to resume in the next session

1. **Read this file first.**
2. Read `docs/SESSION-HANDOVER-2026-05-28.md` if Move A follow-up
   agenda context is needed (otherwise skip — all items addressed).
3. Pre-flight (4 checks above).
4. Pick a follow-up to work on:
   - **Tier 1 (B2/B3):** B2 is the most concrete next step. Live
     inventory via `node scripts/check-manifest-flag-drift.mjs`.
   - **Tier 2 (Phase 4 / ADR-0228 impl):** larger; consider scope
     first.
5. **Per [[feedback-commit-often]]:** commit each logical change in
   the same turn as the edit. Don't end a session with untracked WIP.
6. **Per [[feedback-always-use-the-skill]]:** if a swarm is needed,
   dispatch via `Skill(skill: "ruflo-swarm:swarm")` + MCP tools,
   not raw `npx`.
7. Acceptance gate (`adr0059,p4`) after fork edits or any
   code-touching commit. Doc-only commits don't require per-commit
   gating.
8. End the session with `git status --short` clean and a fresh
   handover doc capturing what landed.

## Cross-references

- **Prior handover (Move A follow-up agenda)** — `docs/SESSION-HANDOVER-2026-05-28.md`
- **Move A execution record** — `docs/SESSION-HANDOVER-2026-05-27.md`
- **Move A queue handover** — `docs/SESSION-HANDOVER-2026-05-26.md`
- **Wave 3 ADRs (all terminal)** — `docs/adr/ADR-0207-*.md` through `docs/adr/ADR-0224-*.md`
- **New this session** — `docs/adr/ADR-0228-ewc-plus-plus-per-call-adapt-path.md` (proposed)
- **INTEGRATION-LEDGER** — `docs/upstream/INTEGRATION-LEDGER.md` (A3 row + D9 Re-introduction guards section)
- **New lint** — `scripts/check-manifest-flag-drift.mjs` (Phase 1)
- **New behavioural test** — `forks/ruflo/v3/@claude-flow/shared/__tests__/config-loader-env-honoured.test.ts`
- **Memory entries** — no new entries needed at this handover; existing entries unchanged.
