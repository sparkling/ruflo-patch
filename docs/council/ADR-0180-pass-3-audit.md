# ADR-0180 Pass 3 Audit — Pre-Acceptance Cross-Reference & Coherence Sweep

**Date:** 2026-05-14
**Auditor:** Claude Code (`/loop`-driven, 5 iterations)
**Scope:** Optional-but-recommended third audit pass before ADR-0180 status flip per §Execution Plan Phase 0 (line 309: *"a third pass after the Execution Plan landing is optional but recommended before accepting"*).
**Outcome:** 9 findings landed inline in ADR-0180 with `(per audit Pass 3, <severity> → resolved)` attribution, matching the Pass 1/2 convention. No findings deferred. Phase 0 gate clear.

## Purpose

Pass 1 and Pass 2 (both inline-resolved between 2026-05-13 and 2026-05-14) caught:

* Pass 1 — substrate-handle leakage to test utilities (FATAL → resolved); recovery-scan bounds (MEDIUM → resolved); macOS vs Linux locking semantics (HIGH → resolved); cross-process hot-path real-pipeline bench (HIGH → resolved).
* Pass 2 — charter conformance check mechanization (HIGH → resolved); package-label update for (a1) lift (FATAL → resolved); Phase 5 contention threshold gate (MEDIUM → resolved).

Pass 3's brief was to look for **residual flaws after the Execution Plan landing** — surface-level audits driven by re-reading the ADR end-to-end, focusing on:

1. Cross-reference internal consistency (every `§X`, `(per QN)`, `Follow-up #N`, `Phase N`, `ADR-XXXX` resolves).
2. Execution Plan vs. deliverable coherence (every named worker / exit gate in the per-phase table has a corresponding spec).
3. Benchmark spec completeness (W1-W5 + W3-contended + Phase 5 contention gate + #13 microbench mutually consistent).
4. Deferred-decision scan ("TBD" / open-question framing without disposition).
5. Structural optimization (redundancy, length, paragraph organization).

## Headline finding

**The ADR was already substantively complete after Pass 1 + Pass 2** — Pass 3 surfaced no architectural reopens, no missing dispositions, and no contradiction between Considered Options / Decision Outcome / Architecture / Migration concerns. The 9 findings are all **internal-consistency drift** introduced as the document grew across audit passes: stale terminology after design-change reconciliation, label collisions, count mismatches between the per-phase table and its referent specs, and one unspecified file schema (`bench/baseline.json`). None of them changed an architectural claim; all are mechanical corrections plus one specification expansion.

## Findings

### Cross-reference audit (3 findings)

* **(A) HIGH — `W1`/`W2` namespace collision.** The labels `W1` and `W2` were used for **two distinct concepts**: (i) performance baseline workloads at §Migration concerns line 174/246/511 (W1 cold single write, W2 cold bulk write, W3 hot loop, W4 read cache, W5 inter-store cascade), and (ii) cross-process MutationContext watchdog mechanisms at Open Follow-up #15 (the original W1 grep gate and W2 runtime WARN). A future reader hitting "W1 + W2 watchdogs prevent silent lapse" cannot disambiguate from "perf-band breach against the W1-W5 baseline". **Fix:** watchdog mechanisms renamed to `WD1` and `WD2` at #15; downstream references updated. Workload labels W1-W5 retain their canonical meaning.

* **(B) LOW — `ADR-100` misattribution.** §Open Follow-up #9 (cli-core JsonMemoryBackend disposition) cited *"(ADR-100 cold-cache <5s budget vs cli's ~25s)"* as the architectural reason cli-core is decoupled from the heavy cli/agentdb dependency tree. Two issues: (1) the canonical numbering is `ADR-0100` (four-digit); (2) ADR-0100 is *Project-Root Resolution — Walk-Up, Not `process.cwd()`*, not a cold-cache budget ADR. The actual provenance of the 22.9× cold-cache speedup claim is ADR-0162 §Batch F-2 (`ba92c5612` cli-core split). **Fix:** reference corrected to *"per ADR-0162 §Batch F-2 — cli-core split `ba92c5612` measured 22.9× cold-cache speedup; cli-core targets ~5s vs cli's ~25s cold start"*, with explicit acknowledgement that the earlier "ADR-100" string was wrong on both numbering and target.

* **(C) MEDIUM — `Q/T/F/R/W` label provenance index missing.** ADR-0180 carries 24 attribution labels (Q1-Q10, T1-T3, F1-F2, R1-R4, W1-W5) referencing research-collection findings from prior swarm audits that were never archived as a separate document. Each label is dereferenceable inline — the prose around each `(per QN)` makes its meaning clear — but a reader picking the ADR up cold cannot get a complete picture of any single label without grep-and-trace. **Fix:** added a `Q/T/F/R/W label provenance` sub-section under §More Information mapping each of the 24 labels to its substantive location in the document, plus a one-line `grep` recipe for traceability. Inline labels retained verbatim; the index is additive.

### Execution Plan coherence audit (3 findings)

* **(D) HIGH — Phase 7 daemon-worker-migrator list mismatch.** The per-phase table named *"6× daemon-worker-migrator (one per scheduled worker — consolidation, auto-memory, hooks-learning, sync, autopilot, ranked-context)"*. Cross-checked against §Caller surfaces: (a) the worker-daemon's actual scheduled workers are `map / audit / optimize / consolidate / testgaps / benchmark`, not the listed names; (b) `auto-memory` and `hooks-learning` correspond to AutoMemoryBridge + HooksLearningDaemon, which are SEPARATE daemons (not worker-daemon scheduled workers); (c) `sync`, `autopilot`, `ranked-context` are not daemons at all — they are MCP namespaces (Phase 5 FS-JSON stores) and a consolidate-worker output file respectively. The row staffed a coherent count (6) with incoherent names. **Fix:** row rewritten to canonical *`6× worker-daemon-migrator` (map/audit/optimize/consolidate/testgaps/benchmark) + `2× standalone-daemon-migrator` (AutoMemoryBridge, HooksLearningDaemon)*; total worker count bumped 12 → 14; `ranked-context.json + graph-state.json + intelligence-snapshot.json` correctly identified as outputs of the consolidate worker (per #11 disposition migration plan) rather than separate daemons. "Up to 15 agents per phase" summary line updated to move Phase 7 into the ceiling group.

* **(E) MEDIUM — Phase 3 provenance count three-way mismatch.** §Provenance rollout scope (line 103) listed 5 tools for Phase 3 (`memory_search/retrieve/list/search_unified/bridge_status`) but its prose said *"the four mutating tools have read siblings"*. The Phase 3 row staffed *"4× provenance-rollout-worker (1 per ranked-read tool: search/retrieve/list/search_unified — ~210 LoC total)"*. The Phase 3 row's exit gate said *"provenance flag works on all 5 ranked-read tools"*. Three numbers; "15 ranked-read tools" total (line 103 header) cross-summed only if Phase 3 = 5 (5+8+2=15) not 4 (4+8+2=14). **Fix:** authoritative number = 5; §Provenance rollout scope prose clarified that the four mutating-tool read siblings PLUS `memory_bridge_status` (standalone read tool surfacing archivist provenance) make 5; Phase 3 row updated to `5× provenance-rollout-worker` covering all 5 names; worker count 9 → 10.

* **(G) MEDIUM — Pre-Phase-2 scripting list omitted the Phase 4 maintenance-commit gate.** §Pre-Phase-2 prerequisite (line 311) enumerated the one-shot `scripts/ruflo-publish.sh` additions as `(1) ADR-0180-Halt:/Amendment: trailer scan + (2) charter conformance hook`. But Phase 4's exit gate (per-phase table) reads *"`scripts/ruflo-publish.sh` confirms maintenance commits on `forks/ruflo/v3 main`"*, which requires a third addition to the pipeline that is established before any phase spawns. Without explicit attribution, Phase 4 inherits an implicit dependency. **Fix:** Pre-Phase-2 prerequisite expanded to three explicit additions: (1) Halt/Amendment trailer scan, (2) charter conformance hook, (3) pre-Phase-4 maintenance-commit gate. Each gate's failure mode is named.

### Benchmark spec audit (2 findings)

* **(H) MEDIUM — `bench/baseline.json` schema undefined.** The baseline file is referenced from §Migration concerns Phase 2 deliverable (W1-W5 + W3-contended bands), Phase 5 contention gate disposition (empirical lockWaits + max-wait numbers), and the per-phase "Phase N cannot release until W1+W3 within bands" gate. Three writers, no shared shape — a recipe for per-phase divergence and silent format drift. **Fix:** explicit JSON Schema added at the Phase 2 deliverable paragraph: `schemaVersion` field; single-file `env` block (platform, arch, cpuModel, nodeVersion, rvfNativeVersion, sqliteVersion, capturedAtIso); per-workload structure `{iterations, baseline_us, archivist_us, ratio, band, passed}` keyed by `W1_cold_single` etc.; separate top-level `phase_5_contention` block (since it measures a gate, not a workload). Six rules govern who writes which fields, when bumps invalidate the file, and how env-mismatch is handled. Also clarified W4's *"≥10× substrate"* baseline as **same-tool same-run substrate-miss measurement**, not a cross-run constant.

* **(I) LOW — Phase 5 row exit gate completeness.** The per-phase table Phase 5 cell named the contention gate as *"`lockWaits.length <= 1.5 * mutationCount`"*, but disposition #10 (the gate's spec) requires TWO assertions: that one PLUS `max(lockWaits.map(w => w.waitedMs)) <= 200`. **Fix:** row updated to cite both assertions per #10, with the additional gate `bench/baseline.json.phase_5_contention` block-write.

### Live-design / stale-terminology audit (1 finding)

* **(J) HIGH — "ring buffer" stale across 4 live-design sites after #17/#18 reconciliation.** Open Follow-ups #17 and #18 jointly **retire the in-memory durability ring buffer** in favor of a write-through journal to the audit fd + batched fsync ≤100ms, with a 256-entry in-flight queue for latency smoothing (NOT durability). But the live-design sections of the ADR — §Architecture · Performance and hot paths (line 124), and §Open Follow-up #13 header + contracts #2 + #5 + microbench — all still framed the design around an *"in-memory ring buffer"*. A reader who follows the ADR top-down builds the wrong mental model and is only corrected on reading #17. **Fix:** all 6 live-design sites rewritten to use the post-reconciliation terminology (`256-entry in-flight queue + write-through journal + ≤100ms batched fsync`) with explicit pointers to #17/#18 for the historical context. The #17 and #18 disposition bodies themselves correctly retain "ring buffer" mentions — they are the historical record of why the change was made and must not be rewritten.

### Deferred-decision scan (no findings)

Scanned for TBDs / FIXMEs / "decide before" / open question phrasings without dispositions. Every "Decide before Phase X" / question-form open-follow-up header (#4, #6, #8, #15, #16, #17, #18, #19, #22, #23) is followed by an explicit `**Disposition (...)**` block. No genuine TBDs remain.

### Structural optimization (no action)

ADR is 969 lines after Pass 3 (was 905 pre-Pass-3). The longest paragraph is §Migration concerns Phase 4 (~3.3KB) — information-dense but internally well-organized via bolded sub-topic markers. No redundancy across sections; the §Architecture bullets and §Open Follow-ups complement rather than duplicate. Aggressive prose trimming would lose information density that is load-bearing for downstream Phases 2-10 swarm prompts. Recommendation: no structural changes.

## Synthesis

* **Pass 3 surfaced no architectural reopen.** All findings are mechanical (label collisions, stale terminology, count drift, schema gap, misattribution) and all landed inline with `(per audit Pass 3, <severity> → resolved)` attribution.

* **Pre-acceptance gate (§Execution Plan Phase 0) is clear.** Pass 1 + Pass 2 + Pass 3 audits are complete; no FATAL or HIGH severity items remain open. The recommended-but-optional third pass was performed and produced 9 actionable corrections, all applied.

* **Recommendation:** flip ADR-0180 status from `proposed` to `accepted`. Phase 2 (scaffolding) can begin once the Pre-Phase-2 scripting prerequisite (per Finding G) lands on `main`.

## Process notes

* **Cadence:** 5 audit iterations of ~120s each, driven by `/loop` dynamic mode. Each iteration: re-enter context, pick up an in-progress audit task, surface ≥1 finding, land an inline fix, update task state, schedule next wake.
* **Method:** end-to-end re-read of the ADR with targeted greps for label patterns (`Q[0-9]`, `T[0-9]`, `F[0-9]`, `R[0-9]`, `W[0-9]`, `§[A-Z]`, `ADR-[0-9]+`, `Phase [0-9]`, `#[0-9]+`). Cross-reference every label against both definition site and use sites; flag any divergence.
* **No swarm spawned.** Pass 3 fit a single-agent linear sweep rather than the 4-agent parallel topology of the Pass-1/Pass-2 swarm-callers audit, because the residual-flaw class is fundamentally cross-cutting (any agent specialized to one slice would miss the W1/W2 collision, which spans §15 and §Migration concerns).
* **Tasks:** 8-task list (one per Pass 3 audit dimension + report-writing + acceptance verification) tracked via TaskCreate/TaskUpdate.

## Related

* [ADR-0180](../adr/ADR-0180-adopt-thin-memory-coordinator-with-type-enforced-mutation-handlers.md) — the decision this audit informs. Findings A-J land inline with Pass-3 attribution.
* [docs/council/ADR-0180-swarm-callers-audit.md](ADR-0180-swarm-callers-audit.md) — the prior caller-catalog audit (2026-05-13) that drove §Caller surfaces + §Migration concerns + Open Follow-ups #7-#14.
* Pass 1 + Pass 2 audits — inline-resolved in ADR-0180 between 2026-05-13 and 2026-05-14, not separately archived. Their fixes are attributed inline via `(per audit Pass 1, …)` / `(per audit Pass 2, …)` markers.
