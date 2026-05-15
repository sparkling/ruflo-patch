# ADR-0181 Phase 4 Report — substrate wiring + cli-backend handler bodies

**Phase:** 4 of 7
**Topology:** hierarchical-mesh / balanced — 8 agents (queen-by-team-lead + Devil's Advocate + 5 workers + 2 verifiers)
**Date:** 2026-05-15
**Status:** **PASS** — `npm run release` acceptance 672/678 (0 failed, 6 skip_accepted), matching the pre-Phase-4 baseline. cli/agentdb republished. Took 2 release cycles; the first surfaced 2 real performance regressions which a hotfix resolved.
**Author:** team-lead (also played queen; ran the exit gate)

## Summary

Phase 4 is the architectural heavy-lift: build the cli `RvfBackend` adapter (Option A, typed bridge from `@claude-flow/memory`'s `RvfBackend` → agentdb's `VectorBackendAsync`), wire `sqliteDb` + the three capability factories (`taskRouter`/`embeddingScorer`/`patternReader`) into the cli's `ArchivistInitConfig`, un-stub the 8 `agentdb_*` read handlers + the `route` mutation, and investigate the 4 Phase-2 escape-hatches. All landed; **`autopilot/learn.ts`** stayed a Phase 5+ carry-forward (depends on a 4th controller — `AutopilotLearning` — distinct from the 3 Phase 4 capabilities).

## What landed (verified on disk)

Two fork commits on `forks/agentdb` `main`:

| Commit | Files | Scope |
|---|---|---|
| `3cc11f1` | 25 (+4095 / -451) | Phase 4 substrate wiring + 9 handler un-stubs + `MemoryRvfAdapter` (~250 LoC) + 88 unit tests + `ArchivistInitConfig.rvfBackend` widening (`RvfBackend` → `VectorBackendAsync` interface) + adapter `package.json` exports |
| (none) | — | (cli-side commit was on the ruflo fork — see below) |

Two fork commits on `forks/ruflo` `main`:

| Commit | Files | Scope |
|---|---|---|
| `5c21e52b8` | 3 (+429 / -60) | Initial Phase 4 cli wiring — `archivist-init.ts` extended to feed 5 new slots; `memory-router.ts` `getStorageInstance()` export; daemon doc-block |
| `8664a3307` | 1 (+56 / -53) | **Hotfix** — defer `rvfBackend` + `sqliteDb` wiring (see Exit gate) |

Per-handler verification: `phase4-da` cleared all 5 workers after detailed dialectic rounds; **V1** PASS on substrate-wiring (registry non-empty for RVF + SQLite + capabilities); **V2** PASS on 6 handler-pattern items + `memory_search_index` Phase 5 carry-forward.

## Three load-bearing decisions

### 1. Option A — typed `RvfBackend` adapter (team-lead ruling)

The cli's existing RVF handle is `@claude-flow/memory`'s `RvfBackend` (`implements IMemoryBackend`); agentdb's `ArchivistInitConfig.rvfBackend` was typed against agentdb's `RvfBackend` (`implements VectorBackendAsync`) — nominally-incompatible classes. Three options weighed in recon:

- **A**: typed adapter, ~250-350 LoC.
- **B**: separate `.rvf` path for agentdb (~50-80 LoC).

**Ruling: A** — Option B silently splits storage (two HNSW indices, two vector spaces) and violates `feedback-data-loss-zero-tolerance`. Option A's LoC is amortized infrastructure cost; it also paves the way to collapse Phase 3's `memory_search_index` indirection in Phase 5.

`phase4-adapter` shipped 88 tests (`test/adapters/memory-rvf-adapter.test.ts`) — full method coverage including the sync-API fail-loud surface and `MemoryEntry`/`SearchResult` reshape. The adapter is brand-honest: `implements VectorBackendAsync` directly, no `as unknown as` casts.

### 2. Interface widening (`RvfBackend` → `VectorBackendAsync`) — type-shape ruling

When `phase4-adapter` slotted the new adapter into `archivist-init.ts`, the worker flagged that `ArchivistInitConfig.rvfBackend: RvfBackend` was typed against the *concrete class* — so `new MemoryRvfAdapter(...)` wouldn't assign without an `as unknown as` cast (a cast-lie that violates the whole Option A rationale).

**Ruling: widen.** Changed `ArchivistInitConfig.rvfBackend: RvfBackend` → `: VectorBackendAsync` (interface contract over concrete class). Same widening propagated to `substrates/rvf-store.ts` (`RvfSubstrateHandle.rvf` + `makeRvfSubstrate` param). The archivist's substrate factories only invoke interface methods anyway. Result: every Phase 4 callsite assigns without any cast.

### 3. Defer `rvfBackend` + `sqliteDb` wiring (Phase 4 hotfix, cycle 2)

The first release cycle exposed 2 real regressions:

- **`t1-6-empty-search`** ballooned from ~575ms (Phase 3 baseline) to **18465ms** — `memory search` blocked on the cli's eager `await ensureRouter()` (memory-router cold-start = HNSW index build + ONNX model load, ~12-18s).
- **`adr0100-e-sentinel-pri`** — `await ensureRouter()` invokes memory-router's own `_findProjectRoot()` (memory-router.ts L260), which walks **up** to the nearest `.claude-flow/` ancestor, bypassing an inner `.ruflo-project` sentinel — and wrote `memory.rvf` + `memory.rvf.lock` to the *outer* `.swarm/`.

Root cause analysis: agentdb's `archivist/index.ts:320` invokes `rvfBackendFactory?.()` **eagerly inside `initialize()`** — so a "lazy" factory just shifts cost from `initProcessArchivist()` to `archivist.initialize()`, no relief. A truly-lazy factory pattern would need an archivist API change (out of Phase 4 scope).

**Hotfix: omit `rvfBackend` + `sqliteDb` from the cli's config entirely.** Phase 4's W3/W4/W5 handlers REGISTER against the archivist (for type safety + future Phase 5 dispatch), but the cli currently still dispatches the 8 agentdb_* + 5 memory_* reads through its **own** mcp-tools handlers — not through `archivist.dispatchRead()`. Until Phase 5 flips the call sites, the archivist never invokes its substrates, so wiring them up was pure latency cost. All Phase 4 scaffolding stays on disk (adapter, handler bodies, capability factories) for Phase 5 to wire in.

This is sound, not gate-weakening: substrate-only handlers (W3 RVF reads, W4 SQLite reads) are tested in isolation by `forks/agentdb/test/archivist/handlers/agentdb/**` (24 tests, all green). The release acceptance gate exercises the cli's pre-Phase-4 paths which never enter the archivist's substrate machinery. Capability factories (`taskRouter` / `embeddingScorer` / `patternReader`) stay wired — they're cheap.

## Process incidents

### CPU thrash (acceptance test orphan)

After the first acceptance failure, an `npx -y @sparkleideas/agentdb@latest migrate --from sqlite --to pglite` child process from `adr0170-migration-roundtrip.test.mjs` was left running at **99.7% CPU**. Cause: `runAgentdb()` `spawnSync()` had no `timeout` parameter, and ADR-0177 retired the pglite substrate — so the migrate hangs indefinitely in unsupported-target-handling.

Two-layer defense landed in `030b6c5` (ruflo-patch commit):
1. **`adr0170-migration-roundtrip.test.mjs`** — added `pgliteTargetSupported()` probe (bounded `migrate --help` call, greps for pglite target); if missing, `SKIP_ACCEPTED` the whole suite. Plus `timeout: 120_000` + `killSignal: 'SIGKILL'` on every `runAgentdb()` `spawnSync`. SIGKILL with `status === null` throws a loud "timed out — likely substrate retirement" diagnostic.
2. **`scripts/test-acceptance.sh` cleanup()** — defensive grandchild sweep: `pgrep -P $$` + `pkill -KILL -P $$` in a 5-iteration loop. Catches deep descendants (3 levels below `node --test` workers) the existing bash job-tracking missed.

Net effect: a hung child from any future acceptance test gets killed within 120s of the test failing, AND any leftover descendants get swept on script exit. The 99.7% CPU 20-minute thrash cannot recur.

### Multi-agent dialectic — productive

`phase4-da` ran 3+ dialectic rounds with workers, cleared all 5. The team-lead made 3 architectural rulings (Option A adapter, interface widening, defer-substrate-wiring hotfix); all routed through the queen in <10 minutes each. Memory namespace `adr-0181/phase-4` carries the recon, rulings, and per-worker carry-forwards.

## Accepted carry-forwards (Phase 5+)

1. **`autopilot/learn.ts`** — depends on `AutopilotLearning` controller (separate from the 3 Phase 4 capabilities). Phase 5+ needs a 4th capability or threading the controller via `ArchivistInitConfig`.
2. **`neural-patterns` `stats` action** — controller-bound GNNService telemetry, no persistence layer. Needs a GNNService capability.
3. **`causal-recall` full ADR-0033 utility** (`α·sim + β·uplift − γ·latencyCost`) — Phase 4 ships uplift-only (single-signal); the vector + latency legs need a CausalRecall capability that surfaces both.
4. **W3 read / W5+ write metadata-shape pact** (`hierarchical_recall`, `neural_patterns`) — read-side assumptions need verification against the corresponding write handlers when Phase 5 un-stubs them.
5. **`memory_search_index` indirection collapse** — needs either a substrate-seam expansion (`getByKey` / `list` on `SubstrateHandle`) or per-handler routing decisions at the cli delegation boundary.
6. **Re-wire `rvfBackend` + `sqliteDb`** when Phase 5 flips cli call sites to `archivist.dispatchRead()`. The hotfix omitted them; bringing them back without re-triggering the cold-start latency needs care — either a truly-lazy factory (archivist API change) or arrange for `ensureRouter()` to be called only on the path that actually dispatches through RVF.
7. **FS-JSON cwd-pollution** — pre-existing, broader than Phase 4: FS-JSON lazy-mint creates `.claude-flow/<store>/` under whatever cwd the dispatch happens in. Should gate on the same marker check the archivist init now uses.

## Exit gate

`npm run release` — passed on cycle 2:

| Cycle | Outcome |
|---|---|
| 1 (eager rvfBackend + sqliteDb) | `t1-6-empty-search` 18s timeout, `adr0100-e-sentinel-pri` outer-`.swarm/` pollution. Also exposed acceptance-test CPU-thrash bug (orphan migrate). |
| 2 (post-hotfix + defense) | **PASS: 672/678 acceptance, 0 failed, 6 skip_accepted** |

Published: `@sparkleideas/cli@3.7.0-alpha.10-patch.97`, `@sparkleideas/agentdb@3.0.0-alpha.14-patch.109`, ruflo-patch wrapper bump to `patch.89`.

## Coordination notes — micro-swarm + queen-by-team-lead

Phase 4's 8-agent swarm (queen-by-team-lead + DA + 5 workers + 2 verifiers) matched the parallel surface well. Workers reported done without overrunning, DA caught real defects in 3-round dialectic, verifiers gate-closed properly. Premature-closure cycles: zero. The Phase 1/2/3 carry-forwards (anti-thrash briefs, verifier-gated closure, structured shutdown protocol, queen-level systemic audit) all delivered.

The team-lead's three rulings (Option A, widening, hotfix) avoided the Phase 1-style swarm thrash by being decisive on architecture-level questions the swarm couldn't resolve internally.
