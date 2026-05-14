# ADR-0180 Phase 10 Report — ADR-0112 Retirement + Full-Program Summary

**Phase:** 10 of 10 (FINAL — ADR-0112 retirement)
**Topology:** mesh, 5 workers + 1 queen
**Date:** 2026-05-14
**Status:** Structural acceptance PASS with one explicitly-deferred item (ADR-0112 enforcement-code retirement, carried with F4-2).
**Author:** team-lead (queen-task coordinated the worker wave and verified all 5 deliverables on disk; team-lead authored the report preemptively when worker/queen messages crossed — see Coordination notes).

## Summary

Phase 10 retires **ADR-0112's rule** and lands the F9-5 carry-forward fix. All 5 workers delivered single-attempt; deliverables verified on disk by team-lead. The headline nuance: a scope correction surfaced mid-phase — Phase 6's ADR-0112 audit only grepped `forks/agentdb/src/`, missing the enforcement code that actually lives in `forks/ruflo/v3/@claude-flow/memory/`. The correct resolution is a **rule/code split**: ADR-0112's *governance rule* is superseded now (status flipped); ADR-0112's *enforcement code* (`RvfNotInitializedError`, `requireAgentDB()`) retires when F4-2 lands the archivist init-completion guarantee — deleting it now would remove a live fail-loud guard with no wired replacement, a `feedback-data-loss-zero-tolerance` violation.

## Worker outputs (verified on disk)

| Worker | Deliverable | Verified |
|---|---|---|
| `adr0112-status-flipper` | `docs/adr/ADR-0112-independent-stores-not-cross-store.md` line 3 → `**Status**: **Superseded by ADR-0180** (2026-05-14). Originally Implemented 2026-04-30...` (full implementation history preserved) + `## Superseded` section | ✅ status line confirmed |
| `drift-guard-verifier` | Gate 4 added to `run_adr0180_gates()` in `scripts/ruflo-publish.sh` — scans `forks/agentdb/src/` for `RvfNotInitializedError\|MemoryNotInitializedError\|requireAgentDB(\|ADR-0112 Phase 2`, excludes the 3 doc-narration sites, fails build on reappearance | ✅ `grep -c "Gate 4: ADR-0112"` = 1; function reports "all 4 gates passed" |
| `filehandle-import-fixer` | F9-5 fix — `audit-writer.ts:7` + `audit-rotation.ts:7` now `import type { FileHandle } from 'node:fs/promises'` (was wrongly sourced from `node:fs`) | ✅ both imports confirmed; `npx tsc --noEmit` shows 0 archivist FileHandle errors |
| `rvf-error-retirement` | Phase 10 section appended to `archivist/handlers/agentdb/ADR-0112-AUDIT.md` documenting: `RvfNotInitializedError` IS load-bearing (defined `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend-errors.ts:63`, used in `rvf-backend.ts`), NOT deleted, retirement deferred to F4-2 | ✅ 9 "Phase 10" matches in audit doc; class intact |
| `marker-cleanup-final-sweep` | Report-only sweep: 0 stray markers; 3 intentional doc-narration sites confirmed (`MODULE.md`, `archivist/index.ts`, `ADR-0112-AUDIT.md`); known-live `@claude-flow/memory` enforcement code classified separately | ✅ no edits, classification clean |

**Charter check:** `OK: 163 file(s) match charter (10 responsibilities enumerated)` — unchanged from Phase 7 (Phases 8-10 added tests/docs/scripts, not charter-tagged `src/archivist/**` files).

## The rule/code split (the Phase 10 disposition)

ADR-0180 Open Follow-up #5 §368/§370 conditions `RvfNotInitializedError` retirement on the archivist init-completion guarantee being live: *"handlers are invoked only after `Archivist.initialize()` resolves."* That guarantee is **F4-2** — the cli-runtime wire-up, deliberately deferred across all 10 phases (every handler body carries `TODO(F4-2)` breadcrumbs; controllers still hit `this.db` directly).

Therefore:
* **ADR-0112's rule is superseded NOW.** The "no coordinator above stores" rule is retired because ADR-0180 addresses its motivating concern (substrate-layer write amplification) structurally — by placing the archivist *above* MCP dispatch, not below it. Status flipped; `## Superseded` section added.
* **ADR-0112's enforcement code retires with F4-2.** `RvfNotInitializedError` + `requireAgentDB()` + the ~14 `controller-registry.ts` "ADR-0112 Phase 2" markers remain live in `forks/ruflo/v3/@claude-flow/memory/` because they are the *current* fail-loud guard. They retire when F4-2 wires the archivist init guarantee that replaces them. Gate 4 drift-guards the **archivist tree** (`forks/agentdb/src/`) so the patterns can't reappear *there* — but does not scan `forks/ruflo/v3/`, where they legitimately still exist pre-F4-2.

This split is honest structural acceptance: Phase 10's grep criterion shows non-zero, non-doc-comment hits in `@claude-flow/memory/` — and that is the *correct* state, not a failure.

## Full-program summary — ADR-0180 Execution Plan, Phases 0-10

| Phase | Surface | Outcome |
|---|---|---|
| **0** | Audit gates + acceptance | 3 audit passes (swarm-callers, Pass 1+2 inline, Pass 3 with 9 findings); ADR status `proposed` → `accepted`; Pre-Phase-2 scripting (`run_adr0180_gates()` + `check-archivist-charter.sh`) |
| **2** | Archivist scaffolding | 26 files, ~2,842 LoC — substrate-internal, branded types, audit-writer, hot-path-writer, testing surface (4 `TestResult` views), MODULE.md charter, 5 bench files, single-fd invariant test |
| **3** | `memory_*` (4 mutating + 5 ranked-read) | 7 handlers + 5 invariant files; `includeProvenance` on 5 ranked-read tools; charter 16 → 28 |
| **4** | `hive-mind_*` (6 tools) | 8 handlers + `makeFsJsonSubstrate` primitive extracted; 2 pre-Phase-4 maintenance commits on `forks/ruflo/v3 main`; `Archivist.dispatch()` public surface; charter 28 → 38 |
| **5** | FS-JSON group (17 stores) | 17 store handler dirs (~6,110 LoC); `fs-json-contention.spec.ts` + `phase_5_contention` baseline block; Open Follow-up #14 Site 2 unbounded-growth bug fixed; charter 38 → 131 |
| **6** | `agentdb_*` (~20 tools) + ADR-0112 cleanup | 18 handler files; `includeProvenance` on 8 ranked-read tools; ADR-0112-AUDIT.md; charter 131 → 149 |
| **7** | Hooks + daemons | 4 hook handlers (post-edit/pre-task hot-path, post-task, session-end w/ IPC nudge) + 8 daemon handlers + 2 bench files; #14 Sites 1+3 fail-loud fixes committed to `forks/ruflo/v3 main`; charter 149 → 163 |
| **8** | Lift archivist into `@sparkleideas/agentdb` + cli-core decision | Verified canonical location; standalone agentdb-mcp-server binds shared archivist instance (+15 LoC); cli-core JsonMemoryBackend documented as explicit non-archivist surface (OF#9) |
| **9** | Inter-controller orchestrators | 3 load-test scenario specs (A/B/C, ~688 LoC); 4 controllers migrated to `ctx.child()` / `ctx.bulk()` (~258 LoC); `reference-impls/DECISION.md` (defer per OF#25); controller signatures normalized to optional-`ctx?` |
| **10** | ADR-0112 retirement | Rule superseded; F9-5 FileHandle fix; Gate 4 drift guard; rule/code split documented |

**Totals:** 163 `.ts` files under `forks/agentdb/src/archivist/` — 140 handler files across 22 handler directories + 12 core modules (audit-writer/-rotation/-types, guards/-types, hot-path-writer, mutation-context, read-context, registration, substrate-internal, types, index) + 11 substrate/invariant/testing-surface files; ~12,339 LoC total. Plus 13 bench/test files and 10 council documents (Pass 3 audit + swarm-callers audit + 8 phase reports + this one). Charter progression: 16 → 28 → 38 → 131 → 149 → 163 (per-phase reported figures; minor reporting drift between phase headers, not reconciled — 163 is the charter-check authoritative count).

## Deferred work after Phase 10 — F4-2 and carried follow-ups

The Execution Plan's **structural scaffolding is 100% complete**. What remains is **runtime activation**, deliberately deferred from day one:

* **F4-2 — cli-runtime wire-up (the big one).** Every handler body is a `TODO(F4-2)` throw-stub; the cli/daemon/controller call sites still run the old authoritative paths. F4-2 wires `Archivist.initialize()` substrate-seam plumbing, flips handler bodies from throw-stubs to real `ctx.substrate.withWrite` calls, and re-points cli MCP tool handlers + controller call sites at `archivist.dispatch()`. Until F4-2, the archivist is fully scaffolded but not on the live write path.
* **F4-3 — cli body relocation.** Replace cli MCP tool handler bodies with `archivist.dispatch()` delegation (currently cli stays authoritative during the migration window).
* **ADR-0112 enforcement-code retirement.** Rides with F4-2: once the archivist init-completion guarantee is live, `RvfNotInitializedError` + `requireAgentDB()` + the `controller-registry.ts` markers in `forks/ruflo/v3/@claude-flow/memory/` retire.
* **F8-1..F8-25** — ~25 standalone-agentdb-mcp-server tools with no Phase 6 archivist handler counterpart; needs a scope decision (extend Phase 6 retroactively or dedicated phase).
* **F7-1** — daemon handler charter-tag normalization (`dispatch` → `substrate-seam` for the 4 daemon writers).
* **Replay test harness** — the 3 Phase 9 load specs + per-surface Tier-1 replay specs are pre-wired as F4-2 acceptance gates; they exercise structure today, real controllers post-F4-2.
* **`npm run release` full verification** — never run during the execution plan (reserved for the user); the first end-to-end build + publish + acceptance happens when the user runs it.

## Coordination notes

* **Crossed messages / worker-contract gap.** The queen's dispatch request and the team-lead's affirmation both landed after the workers had already executed (team-lead spawns queen + workers in one wave; the queen's tool surface does not include the native Agent tool — the same team-lead-holds-dispatch division documented in the Phase 5/6/9 reports). The queen sent ONE dispatch request — its TaskList showed tasks #1-5 `pending`/unowned and it explicitly hedged "confirm when spawned, or tell me if the dispatch division has changed" — then, on the team-lead's "messages crossed" reply, verified all 5 deliverables on disk and marked the tasks complete. The root cause is a **worker-contract gap**: workers did the file work + SendMessage'd reports but never claimed/updated their `TaskUpdate` entries, so the queen's TaskList read stale. Lesson for future phases: worker briefs must require `TaskUpdate` owner-claim + completed-status as part of the exit contract, not just SendMessage. (The report was the queen's contract-assigned deliverable; team-lead authored it preemptively when the messages crossed — not a queen failure to deliver.)
* **Worker single-attempt discipline caught the scope error independently.** `rvf-error-retirement` was briefed to "verify zero references" but its body-inspection found `RvfNotInitializedError` is load-bearing in `forks/ruflo/v3/@claude-flow/memory/` — and it correctly did NOT delete the class. The worker reached the same conclusion the queen's scope-correction reached, independently. This is the body-inspection-over-brief-assumption pattern from Phase 5 §1, holding through the final phase.
* **Queen-overrode-team-lead precedent (Phase 9, carried for the record).** In Phase 9 the queen correctly rejected a team-lead recommendation (option A — extend `MutationContext.bulk` to callback form) by reading the ADR text + types: announce-form `ctx.bulk` is intentional ADR design, and the change would have tripped Halt trigger (d). Architectural judgment flowed correctly up the chain.
* **No `npm run release` invoked in any phase.** All 10 phases respected the no-build / no-publish contract. All deliverables sit in the working tree for user review and commit.
* **No commits by team-lead or any queen.** The only fork-side commits are the 4 pre-phase maintenance commits (2 pre-Phase-4 hive-mind lock wraps + 2 Phase 7 fail-loud fixes) on `forks/ruflo/v3 main`, landed by their respective workers.

## Recommendation

**ADR-0180 Execution Plan Phases 0-10: structurally complete.** The archivist is fully scaffolded — type machinery, audit chain, hot-path queue, substrate primitives, 140 handler files across 22 surfaces, governance charter, bench harness, load-test specs, drift guards. The ADR's architectural decision surface is closed.

**Next step is F4-2** — the runtime-activation follow-on that flips the archivist from scaffolded to live. That is a distinct, substantial work item and the natural seam for a follow-up ADR or a dedicated execution plan. It was deferred deliberately and consistently across all 10 phases; nothing in Phases 0-10 was blocked on it.

Per the user's standing instruction, the full end-to-end verification (`npm run release` — build + publish + acceptance) is the user's to run; the working tree is ready for it.
