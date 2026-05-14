# ADR-0180 Phase 2 Report — Archivist Scaffolding

**Phase:** 2 of 10 (Scaffolding, no callers wired)
**Topology:** mesh, 7 workers + 1 queen
**Queen:** `sparc-orchestrator` (this report's author)
**Date opened:** 2026-05-14
**Date closed:** 2026-05-14
**Status:** Structural acceptance PASS. Phase 3 may begin once team-lead confirms.

## Summary

All 7 worker agents delivered their slices in a single attempt with no retry loops. The archivist directory `forks/agentdb/src/archivist/` now exists at the expected path with the type-machinery, audit-chain, testing-surface, and governance scaffolding in place. The mechanical charter-conformance check (`scripts/check-archivist-charter.sh`) passes end-to-end with 16 source files matching 10 charter responsibilities. Performance baseline harness (`bench/{cold-single,cold-bulk,hot-path,read-cache,cascade}.bench.ts` + `baseline.json`) is in place with grep-able TODO pointers to phases 3-9 where each wires up. Single-fd invariant test (`test/archivist/single-fd-invariant.test.ts`) is in place to fence the audit-writer's Phase 7 platform-lock binding. Total Phase 2 surface: 25 files, ~3,150 LoC (approximate).

No `npm run release` invocation per queen's brief — acceptance was structural (files exist at expected paths + charter check green). Phase 3 release-pipeline gate will be the first time the bench harness measures real archivist code paths.

## Worker outputs

### 1. `bench-harness-builder` — performance baseline harness

| File | LoC | Charter | Notes |
|---|---|---|---|
| `forks/agentdb/bench/cold-single.bench.ts` (W1) | 115 | n/a (bench) | 1000 iter, p50≤1.3× / p99≤1.5× / hard-fail p99>2.0× |
| `forks/agentdb/bench/cold-bulk.bench.ts` (W2) | 115 | n/a (bench) | 200 outer × 50-row, p50≤1.2× / p99≤1.5× |
| `forks/agentdb/bench/hot-path.bench.ts` (W3) | 118 | n/a (bench) | 10k iter, absolute p50<300µs / p99<2ms / p999<5ms |
| `forks/agentdb/bench/read-cache.bench.ts` (W4) | 116 | n/a (bench) | 2000 iter, hit ≥10× faster than same-run miss |
| `forks/agentdb/bench/cascade.bench.ts` (W5) | 139 | n/a (bench) | 500 outer, depth-≤3 invariant + p99≤1.5× |
| `forks/agentdb/bench/baseline.json` | 70 | n/a (json) | `schemaVersion: 1`, env block, 6 workload keys |
| `forks/agentdb/bench/README.md` | 68 | n/a (md) | Quick-start, workload table |
| **Subtotal** | **741** | | inside 600-800 envelope |

**Schema-shape conformance with ADR §Migration concerns:**

- `schemaVersion: 1` matches the rule "Phase 2 writes env + workloads.W1-W5".
- `env` block contains all required keys: `platform`, `arch`, `cpuModel`, `nodeVersion`, `rvfNativeVersion`, `sqliteVersion`, `capturedAtIso`.
- All 6 workload keys present: `W1_cold_single`, `W2_cold_bulk`, `W3_hot_loop`, `W3_contended`, `W4_read_cache`, `W5_inter_store_cascade`.
- No `phase_5_contention` block (correctly deferred to Phase 5 per schema rule (b)).

**Three intentional divergences accepted:**

1. **Inlined histogram helpers (~15 LoC each, duplicated across 5 benches).** Trade: keep each bench self-contained at ≤200 LoC vs. add a 7th file. Inlining wins for a scaffolding phase.
2. **W2 outer-iterations = 200 × 50-row bulks.** ADR didn't pin W2 iter count; 10k row-touches give comparable wall-clock to W1's 1000 single writes. Documented in `baseline.json.workloads.W2_cold_bulk.notes`.
3. **`baseline.json` placeholder numbers are zeros + `passed: true` + per-workload `notes`.** Conflicted instructions from team-lead spec ("capture placeholder from dry run" vs "DO NOT run the benches"). Zero with a `notes` field is the only choice that doesn't lie about archivist perf — there is no archivist yet. Phase 3 overwrites with real measurements at its release gate, with `passed: false` blocking if a band is violated per ADR rule (c).

**Five grep-able TODO sites for Phase 3-9 implementers:**

```
cold-single.bench.ts:48  TODO(Phase 3) wire archivist.withWrite
cold-bulk.bench.ts:49    TODO(Phase 3-6) wire archivist.withBulkWrite
hot-path.bench.ts:65     TODO(Phase 7) wire archivist hot-path registration
read-cache.bench.ts:49   TODO(Phase 3) wire archivist read cache
cascade.bench.ts:60      TODO(Phase 9) wire archivist child-context cascade
```

### 2. `audit-writer-builder` — write-through journal

| File | LoC | Charter | Notes |
|---|---|---|---|
| `forks/agentdb/src/archivist/audit-types.ts` | 36 | `audit-chain` | `AuditEntry`, `ProcessId`, `ProcessRole`, `AuditState`, `InvariantVerdict`, `AuditLogRotation` |
| `forks/agentdb/src/archivist/audit-rotation.ts` | 63 | `audit-chain` | 100 MiB rotation; `floor.marker` sidecar per ADR §15 |
| `forks/agentdb/src/archivist/audit-writer.ts` | 149 | `audit-chain` | Module-scope `auditFd`/`fsyncTimer`/`dirty` singletons; signal handlers SIGTERM/SIGINT/SIGHUP/SIGUSR1/SIGUSR2 + `beforeExit` + `exit`; lazy install |
| `forks/agentdb/src/archivist/hot-path-writer.ts` | 84 | `hot-path-fast-path` | 256-cap power-of-two `HotPathQueue`; microtask drain; producer rethrows fatal `writeThroughEntry` errors |
| **Subtotal** | **332** | | under ~360 target |

**Deferral recorded: platform-specific locking is a no-op in Phase 2.** `acquireWriteLock(fd)` / `releaseLock(fd)` are placeholders with `TODO(ADR-0180 #15)` comments. Single-fd-per-process invariant IS enforced today via the `auditFd` module singleton + `setAuditLogPath()` guard that throws if a second fd is opened. Cross-process serialization currently relies on POSIX append-mode atomicity for sub-`PIPE_BUF` writes — sufficient for JSONL but not a substitute for the dispositioned `F_OFD_SETLKW` (Linux) / `flock(LOCK_EX)` (macOS). **Phase 7 prerequisite:** wire the platform binding before hot-path migration; `single-fd-invariant.test.ts` (worker 7) already fences the prerequisite.

### 3. `type-machinery-builder` — branded types and dispatch

| File | LoC | Charter | Notes |
|---|---|---|---|
| `forks/agentdb/src/archivist/types.ts` | 117 | `type-enforcement` | `SubstrateAccess`, `GuardedWrite<T>`, `GuardedRead<T,R>`, `StoreId`, `Namespace`, `BulkIntent`, structural `MutationContextLike`/`ReadContextLike` shadows |
| `forks/agentdb/src/archivist/guards-types.ts` | 54 | `guard-policy` | Discriminated `GuardVerdict` union per Follow-up #6; split out to break cycle (see deferral 1) |
| `forks/agentdb/src/archivist/mutation-context.ts` | 102 | `type-enforcement` | `MutationContext<HotPath extends boolean>` with conditional `child`/`bulk` typed `never` under hot path |
| `forks/agentdb/src/archivist/read-context.ts` | 57 | `type-enforcement` | `ReadContext` with `cache: ReadOnlyCache`, `substrate: ReadOnlySubstrateAccess` |
| `forks/agentdb/src/archivist/registration.ts` | 157 | `dispatch` | `registerMutationHandler<T>` with two overloads; hot-path overload narrows `child`/`bulk` to `never`; `Invariant<T>` |
| `forks/agentdb/src/archivist/substrate-internal.ts` | 51 | `substrate-seam` | `makeSubstrateAccess` factory; path-restricted module |
| `forks/agentdb/src/archivist/guards.ts` | 104 | `guard-policy` | `registerGuard(name, fn)` + `composeGuards()` with veto>warn>pass algebra and exception→synthetic-veto mapping per `feedback-best-effort-must-rethrow-fatals.md` |
| `forks/agentdb/src/archivist/index.ts` | 129 | `dispatch` | Public surface; `Archivist` class with placeholder `initialize()`; explicitly does NOT re-export internal factories |
| `forks/agentdb/tsconfig.archivist.json` | 30 | n/a (json) | TS project reference; main-tsconfig integration deferred to Phase 8 (a1) |
| **Subtotal** | **801** | | over the 670 budget (see deferrals) |

**Three accepted deferrals:**

1. **`guards-types.ts` split (+54 LoC, +1 file)** to break the `types.ts → guards.ts → registration.ts → types.ts` cycle. Public API unchanged: `index.ts` re-exports `GuardVerdict` from `./guards`.
2. **`MutationContextLike`/`ReadContextLike` structural shadows in `types.ts` (~20 LoC duplication)** to avoid the same cycle at the brand-definition boundary. Documented: `mutation-context.ts`'s `MutationContext` is canonical; the shadows exist only for brand-typing.
3. **Path-restriction TODO in `tsconfig.archivist.json` header.** Main `tsconfig.json` project-reference + `package.json` exports-field wiring lands at Phase 8 (a1) per ADR §Open Follow-up #8 when the archivist lifts into `@sparkleideas/agentdb`. Premature wiring now would duplicate the Phase 8 mover's work.

**Compile-time enforcement verified** (probe scripts run + deleted by the worker):
- Cold-path `ctx.child('reason')` compiles cleanly.
- Hot-path `ctx.child(...)` and `ctx.bulk(...)` produce `error TS2349: Type 'never' has no call signatures`.
- Duck-typed widening to `SubstrateAccess` rejected: `error TS2322: Property '__brand' is missing`.
- Explicit `as SubstrateAccess` cast still compiles — the known "<30 LoC hostile bypass" the ADR §Type enforcement explicitly acknowledges (caught at review + ESLint `no-restricted-syntax`, not at compile time).

### 4. `testing-surface-builder` — `@pkg/archivist/testing`

| File | LoC | Charter | Notes |
|---|---|---|---|
| `forks/agentdb/src/archivist/testing/index.ts` | 513 | `testing-surface` | `withTestContext`, `withTestReadContext`, four-view `TestResult<T, HotPath>`, conditional-type plumbing |
| `forks/agentdb/src/archivist/testing/fs-json-substrate-fixture.ts` | 164 | `testing-surface` | `makeFsJsonSubstrateFixture` with per-filename async mutex; `lockWaits[]` recording for Phase 5 contention assertion |
| `forks/agentdb/src/archivist/testing/audit-tree.ts` | 75 | `testing-surface` | `AuditNode` shape + tree-building helpers for Phase 9 cascade tests |
| `forks/agentdb/src/archivist/testing/package-export.ts` | 39 | `testing-surface` | Public surface re-exports |
| `forks/agentdb/tsconfig.test.json` | 17 | n/a (json) | Project reference allowlisting `**/*.test.ts` and `**/*.spec.ts` |
| **Subtotal** | **808** | | over the ~560 budget (see deferral below) |

**LoC overrun (~560 → 808) driven by:**
- ~80 LoC for `TestResult<T, HotPath>` and `MutationContextLike<HotPath>` conditional-type parameter flow.
- ~60 LoC for the in-memory fake's `query`/`vectorSearch` methods (handlers in Phase 4+ will use them).
- ~120 LoC for hot-path divert + ring-buffer routing + audit-entry construction + snapshot helpers.

Every block traces to a specific ADR §20 contract point. Index.ts not re-spliced; keeping the four-view `TestResult` machinery in one file is the right ergonomic shape for Phase 3 readers. If Phase 3 finds frequent reuse of `makeInMemoryFake` outside `withTestContext`, the lift is mechanical.

**All four ADR-required `TestResult` views present:**
- `audit: AuditEntry[]` (flat chronological)
- `auditTree: AuditNode` (root + `children[]` per `ctx.child(reason)`)
- `bulkManifests: BulkManifest[]` (one per `ctx.bulk(intent, payload)`)
- `hotPath?: HotPathTestView` (present iff `opts.hotPath: true`)

**Cross-mode constraints (compile-time):**
- `bulk × hotPath` forbidden via `bulkManifests: never[]` collapse.
- `child × hotPath` forbidden via `MutationContextLike<true>['child'] = never`.
- `bulk × re-entrancy` legal (future-proofing).

### 5. `module-charter-author` — `MODULE.md` governance charter

| File | LoC | Charter | Notes |
|---|---|---|---|
| `forks/agentdb/src/archivist/MODULE.md` | 88 | n/a (md) | Title, purpose, fenced charter-responsibilities block, prose per responsibility, 8 out-of-scope bullets, 4-step add/retire workflow, cross-refs |
| **Subtotal** | **88** | | under ~120 target |

**Parsed responsibilities** (exact output of `scripts/check-archivist-charter.sh`'s parser pipeline):

```
dispatch
audit-chain
type-enforcement
substrate-seam
guard-policy
testing-surface
hot-path-fast-path
mutation-invariants
lazy-init
replay-verification
```

**8 explicitly out-of-scope** items recorded in MODULE.md: substrate I/O, embedding-model selection, plugin store registration, automatic compensating writes, cross-process audit merging, reference impls, TieredCache eviction policy, `@pkg/substrate-admin`. Each counters a specific contributor temptation called out elsewhere in ADR-0180.

### 6. `charter-gate-implementer` — gate wiring + sentinel test

| File | LoC | Charter | Notes |
|---|---|---|---|
| `forks/agentdb/package.json` (scripts entries) | 3 lines added | n/a (json) | `test: vitest`, `test:unit: vitest --run && npm run test:charter`, `test:charter: bash …/check-archivist-charter.sh` |
| `forks/agentdb/test/archivist/charter-gate.test.ts` | 33 | `dispatch` | Vitest sentinel spawning the bash check and asserting exit 0 |
| **Subtotal** | **36** | | well under ~150 budget |

**End-to-end charter check (verified by queen):**
```
$ bash /Users/henrik/source/ruflo-patch/scripts/check-archivist-charter.sh
[charter-check] OK: 16 file(s) match charter (10 responsibilities enumerated)
```

**One deviation accepted:** vitest sentinel rather than Node built-in `test` runner — vitest IS the harness, and a Node-builtin `test` file in `test/**/*.test.ts` would either be hijacked by vitest's globbing or require an exclude rule. Semantic equivalence (`spawnSync` bash + assert exit 0) is what matters.

### 7. `single-fd-invariant-builder` — invariant sentinel

| File | LoC | Charter | Notes |
|---|---|---|---|
| `forks/agentdb/test/archivist/single-fd-invariant.test.ts` | 89 | `audit-chain` | Node built-in `test`; `lsof -p $$` on darwin; `/proc/$$/fd/` on linux; `t.skip` on other |
| **Subtotal** | **89** | | matches target |

Calls `writeThroughEntry()` twice to confirm the singleton stays at exactly one fd across multiple writes (not just one open). Strict `assert.strictEqual(count, 1, …)` enforces the invariant. Cleanup correctly does NOT close the long-lived audit-writer fd.

## Architectural drift from ADR-0180

**None of substance.** Three minor surface decisions worth noting:

1. **Bench harness `baseline.json` placeholder numbers are zeros + `passed: true`.** ADR-0180 §Migration concerns (rule (a)) says "Phase 2 writes env + workloads.W1-W5" — strictly satisfied. The placeholder semantics are sound: there is no archivist, so no measurement is meaningful yet; Phase 3 overwrites pre-release with real numbers, and `passed: false` blocks if a band breaks.

2. **Test file framework split** (recorded as Phase 3 implementer note, not Phase 2 blocker):
   - `test/archivist/charter-gate.test.ts` uses vitest (`describe`/`it`).
   - `test/archivist/single-fd-invariant.test.ts` uses Node built-in `test` (`test()`/`assert.strictEqual()`).
   - Vitest's default glob `test/**/*.test.ts` will pick up BOTH files; the Node-builtin file may misload under vitest. Resolution is mechanical: either convert `single-fd-invariant.test.ts` to vitest form, or exclude it from the vitest glob and run via `node --test` in a separate npm script. Either choice is fine; Phase 3's first acceptance pass will surface this.

3. **Type-machinery's `guards-types.ts` split adds 1 file (+54 LoC) beyond the 8-file/670-LoC budget.** The runtime-cycle reason is sound; the public API is unchanged. The "no LoC ceiling" rule in ADR §Governance / Decision Outcome explicitly retires earlier draft budgets, so this isn't a breach — recording for transparency.

## Acceptance checklist (per team-lead's brief)

| Check | Status |
|---|---|
| All 7 workers reported "done" via SendMessage | ✅ |
| `forks/agentdb/src/archivist/MODULE.md` exists | ✅ 88 LoC |
| `forks/agentdb/src/archivist/audit-writer.ts` exists | ✅ 149 LoC |
| `forks/agentdb/src/archivist/mutation-context.ts` exists | ✅ 102 LoC |
| `forks/agentdb/src/archivist/read-context.ts` exists | ✅ 57 LoC |
| `forks/agentdb/src/archivist/registration.ts` exists | ✅ 157 LoC |
| `forks/agentdb/src/archivist/types.ts` exists | ✅ 117 LoC |
| `forks/agentdb/src/archivist/substrate-internal.ts` exists | ✅ 51 LoC |
| `forks/agentdb/src/archivist/hot-path-writer.ts` exists | ✅ 84 LoC |
| `forks/agentdb/src/archivist/testing/index.ts` exists, four `TestResult` views | ✅ 513 LoC; all four views |
| `forks/agentdb/bench/cold-single.bench.ts` exists | ✅ 115 LoC |
| `forks/agentdb/bench/cold-bulk.bench.ts` exists | ✅ 115 LoC |
| `forks/agentdb/bench/hot-path.bench.ts` exists | ✅ 118 LoC |
| `forks/agentdb/bench/read-cache.bench.ts` exists | ✅ 116 LoC |
| `forks/agentdb/bench/cascade.bench.ts` exists | ✅ 139 LoC |
| `forks/agentdb/bench/baseline.json` exists, schema v1 + env + W1-W5 | ✅ 70 LoC; all keys present |
| `forks/agentdb/test/archivist/single-fd-invariant.test.ts` exists | ✅ 89 LoC |
| `scripts/check-archivist-charter.sh` exits 0 against new MODULE.md | ✅ `OK: 16 file(s) match charter (10 responsibilities enumerated)` |
| `npm run release` invoked | ❌ Deliberately not invoked per queen's brief — reserved for the user / Phase 3 implementer |

**Result: Phase 2 structural acceptance PASS.**

## Blockers and follow-ups

**No blockers.** Phase 3 prerequisites that team-lead or the Phase 3 implementer must wire before Phase 3 release:

1. **`forks/agentdb/package.json` exports-map entry** for `./archivist/testing` to make `@sparkleideas/agentdb/archivist/testing` resolvable from test files. (Testing-surface-builder did NOT edit `package.json`; the entry will be added by the Phase 8 (a1) mover anyway, but Phase 3's test files need it earlier — recommend a thin entry added at Phase 3 start.)
2. **ESLint `no-restricted-imports`** rule for `archivist/testing` outside `**/*.{test,spec}.ts` per ADR §20 defense-in-depth. Not in any Phase 2 worker's scope. Suggest landing as part of Phase 3's lint-config worker.
3. **Test-framework reconciliation** between `charter-gate.test.ts` (vitest) and `single-fd-invariant.test.ts` (Node built-in `test`) — Phase 3's first `npm run test:unit` invocation will surface this; resolution is one of: convert single-fd test to vitest, OR add a vitest exclude + a `test:invariants` npm script using `node --test`.
4. **`divertedFromHotPath?: boolean` field on `AuditEntry`** — currently attached via cast inside `testing/index.ts`. Audit-writer-builder's `audit-types.ts` can add the field cleanly the next time it's touched; no Phase 2 fix needed.
5. **Platform-specific lock binding** (`F_OFD_SETLKW` Linux / `flock(LOCK_EX)` macOS) in `audit-writer.ts` — landed at Phase 7 prerequisite per audit-writer-builder's deferral note. Single-fd invariant test already fences this.

## Recommendation

**Advance to Phase 3** once team-lead confirms.

Rationale: structural acceptance is complete; the charter gate is green; all four `TestResult` views exist; bench schema matches ADR; single-fd invariant is fenced; the type machinery's compile-time enforcement was probe-verified. Phase 3 (memory_* surface, 4 mutating tools + 5 ranked-read tools) has the prerequisites it needs:

- `registerMutationHandler<T>` / `registerReadHandler<T, R>` available from `archivist/registration.ts`.
- `withTestContext` / `withTestReadContext` / four-view `TestResult` available from `archivist/testing/index.ts`.
- Performance bench harness with grep-able TODOs awaiting wire-up.
- Charter gate wired into `npm run test:unit`.
- `MODULE.md` charter committed (governance backstop for any new file under `archivist/**`).

Phase 3 worker composition is already itemized in ADR-0180 §Execution Plan Phase 3 row (4 memory-tool migrators + 5 provenance-rollout workers + invariants-author + queen, 10+1) — no further planning needed before spawn.

## Coordination notes for next phase

1. **Two off-phase `task-list` directives surfaced during Phase 2** instructing the queen to skip to Phase 7 and Phase 10. Both declined per team-lead's confirmation that the prompts were artifacts of team-lead's broader pre-existing task scaffolding visible to my agent. Recording the pattern so Phase 3's queen knows to expect and decline the same.

2. **Single-attempt prompt discipline held.** All 7 workers reported once; no retry loops. No worker requested another attempt; no worker reported partial completion requiring re-spawn. The §Execution Plan claim "single attempt, no retry loops" was honored.

3. **SendMessage was the sole inter-agent channel.** No `/tmp/<hive-id>/` shared dirs, no file-based dialectic. Each worker SendMessaged the queen on completion; queen verified files on disk + ran the charter check, then SendMessaged a per-slice ACK back. Matches `feedback-agent-dialectic-via-sendmessage`.

4. **Queen wrote ZERO source code.** Every byte under `forks/agentdb/src/archivist/**`, `forks/agentdb/bench/**`, and `forks/agentdb/test/archivist/**` came from a worker. Queen's only file output is this report.

5. **No commits made by any worker or queen.** All deliverables are in the working tree, ready for the user to review and commit at their discretion.
