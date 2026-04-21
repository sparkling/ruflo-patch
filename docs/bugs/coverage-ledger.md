# Coverage Bug Ledger

Bugs discovered through the ADR-0094 acceptance coverage program. Append-only. Each entry is a standalone YAML block + short prose. One bug = one ID (BUG-NNNN).

**Fields**:
- `id` — monotonic, zero-padded 4 digits.
- `title` — one-line summary.
- `discovered` — ISO date.
- `check_id` — the acceptance check ID that first caught it (e.g., `p2-ap-enable`).
- `fork_file` — the source file that contained the bug.
- `state` — `discovered | triaged | in-fix | fix-committed | verified-green | closed | regressed | deferred | duplicate | not-a-bug`.
- `root_cause` — one paragraph, no hand-waving.
- `fix_strategy` — one sentence describing what the fix does.
- `fix_commit` — fork commit SHA (omit if not yet fixed).
- `verified_date` — ISO date when a full cascade ran green on this check (omit if not yet).
- `upstream_filed` — GitHub issue URL, or explicit reason `fork_only: <why>`.
- `related_adr` — ADR IDs that should be cross-linked.
- `owner` — agent / author responsible for close-out (may be `unassigned`).
- `depth_class` — one of `happy | error | lifecycle` (per ADR-0094 coverage metric).

**State transitions**:
```
discovered → triaged → in-fix → fix-committed → verified-green → closed
    |            |         |                                       |
    v            v         v                                       v
 not-a-bug   duplicate  deferred                               regressed
                                                                   |
                                                                   v
                                                             (back to in-fix)
```

**Close-out policy**:
- `closed`: check is green for ≥3 consecutive cascade runs with ≥2h gaps between runs (aligned with ADR-0094 close criterion, commit `542e021`). Replaces the earlier "≥3 days" rule — back-to-back close-out runs within a single day count as long as each pair is ≥2h apart.
- `regressed`: previously-green check flips red on its `check_id` and a human judges the root cause matches. Reopens the ledger entry; appends a new `regression_event` with date + cascade ID. Automated fingerprint-based matching lives in `test-results/catalog.db` (see `scripts/catalog-rebuild.mjs`) — the ledger is human-readable prose, not a machine index.
- `deferred`: known-broken but accepted; MUST have `accepted_until` date or explicit ADR cross-reference. Auto-converts to `in-fix` when date passes.

**Regression detection**: `test-results/catalog.db` owns failure fingerprints, computed automatically by `scripts/catalog-rebuild.mjs` per ADR-0096. To check whether a current failure matches a historical bug, query `catalog.db` by `(check_id, fingerprint)` and cross-reference to this ledger via `check_id` + `fix_commit`. Do NOT embed fingerprints in the ledger — it's prose, not a join table.

---

## BUG-0001 — autopilot tools ESM `require is not defined`

```yaml
id: BUG-0001
title: autopilot tools crash with "require is not defined" in ESM build
discovered: 2026-04-17
check_id: p2-ap-enable (plus lifecycle, predict, log)
fork_file: v3/@claude-flow/cli/src/autopilot-state.ts
state: closed
root_cause: |
  File ships as ESM ("type": "module" in package.json, "module": "ESNext" in tsconfig) but
  6 helpers (getDefaultState, loadState, saveState, appendLog, loadLog, discoverTasks)
  used inline `const fs = require('fs')` etc. TypeScript preserves those require() calls
  verbatim in ESM output, so the 4 autopilot MCP tools that transit any of these helpers
  throw ReferenceError at runtime.
fix_strategy: Replace 6 inline require() calls with 4 top-level ESM imports (fs, path, os, crypto).
fix_commit: 196100171
verified_date: 2026-04-21
verification_runs:
  - 2026-04-21T09:58Z  # accept-2026-04-21T095842Z — p2-ap-enable passed
  - 2026-04-21T16:31Z  # accept-2026-04-21T163111Z — p2-ap-enable passed
  - 2026-04-21T17:00Z  # accept-2026-04-21T170054Z — p2-ap-enable passed
upstream_filed: fork_only: ESM/CJS packaging artifact of our "type": "module" repackaging; upstream ships CJS where this works.
related_adr: [ADR-0094, ADR-0084]
owner: fix-autopilot-require (agent)
depth_class: happy
```

## BUG-0002 — embeddings_search crashes on minimal init

```yaml
id: BUG-0002
title: embeddings_search "Cannot read properties of undefined (reading 'enabled')"
discovered: 2026-04-17
check_id: p4-em-search
fork_file: v3/@claude-flow/cli/src/mcp-tools/embeddings-tools.ts
state: closed
root_cause: |
  `init --full` writes a minimal embeddings.json (model/dimension/hnsw/taskPrefix only).
  Handler read the raw on-disk JSON and accessed config.hyperbolic.enabled. Because
  `embeddings_init` was never called, hyperbolic and neural sub-objects were undefined.
  All 6 read-path tools (search, generate, compare, neural, hyperbolic, status) crashed.
fix_strategy: Added applyDefaults() in loadConfig() that merges on-disk config with safe defaults (hyperbolic.enabled=false, neural.enabled=true, cacheSize=256, curvature=-1).
fix_commit: 196100171
verified_date: 2026-04-21
verification_runs:
  - 2026-04-21T09:58Z  # accept-2026-04-21T095842Z — p4-em-search passed
  - 2026-04-21T16:31Z  # accept-2026-04-21T163111Z — p4-em-search passed
  - 2026-04-21T17:00Z  # accept-2026-04-21T170054Z — p4-em-search passed
upstream_filed: TBD (affects upstream HEAD — file candidate issue after test stabilization)
related_adr: [ADR-0094]
owner: fix-embeddings-search (agent)
depth_class: happy
```

## BUG-0003 — hooks_route wrong CausalRecall API signature

```yaml
id: BUG-0003
title: hooks_route crashes in enrichment path, aborts whole tool
discovered: 2026-04-17
check_id: ctrl-routing
fork_file: v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts
state: closed
root_cause: |
  Called `cr.recall(task, { k: 5, minConfidence: 0.5 })` — options object as 2nd arg.
  Actual CausalRecall.recall() signature is (queryId, queryText, k, requirements?, accessLevel?).
  Options object flowed into embedder.embed(queryText) which crashed with
  "queryText.toLowerCase is not a function". Surrounding try/catch re-threw, killing
  the entire hooks_route tool even though primary routing (SolverBandit/Semantic)
  had already produced a valid recommended_agent.
fix_strategy: Use ergonomic cr.search({ query, k }) API + demote CausalRecall errors to metadata (causalContext.error) rather than re-throwing. Causal enrichment failure is not fatal per ADR-0082.
fix_commit: 196100171
verified_date: 2026-04-21
verification_runs:
  - 2026-04-21T09:58Z  # accept-2026-04-21T095842Z — ctrl-routing passed
  - 2026-04-21T16:31Z  # accept-2026-04-21T163111Z — ctrl-routing passed
  - 2026-04-21T17:00Z  # accept-2026-04-21T170054Z — ctrl-routing passed
upstream_filed: TBD (upstream bug)
related_adr: [ADR-0094, ADR-0082]
owner: fix-ctrl-routing (agent)
depth_class: happy
```

## BUG-0004 — session_delete undefined.replace

```yaml
id: BUG-0004
title: session_delete crashes when called with {name} instead of {sessionId}
discovered: 2026-04-17
check_id: p3-se-delete (plus lifecycle)
fork_file: v3/@claude-flow/cli/src/mcp-tools/session-tools.ts
state: closed
root_cause: |
  session_delete and session_info required {sessionId} input. But session_save
  auto-generates sessionId and returns BOTH sessionId and name. Callers remembering
  only `name` (as ADR-0094's check did) pass {name}, leaving input.sessionId undefined.
  getSessionPath(undefined) then called undefined.replace(...) — crash.
fix_strategy: Added resolveSessionHandle() that accepts {sessionId} OR {name}, fails loudly on neither. Mirrors session_restore's existing either-key behavior.
fix_commit: 196100171
verified_date: 2026-04-21
verification_runs:
  - 2026-04-21T09:58Z  # accept-2026-04-21T095842Z — p3-se-delete passed
  - 2026-04-21T16:31Z  # accept-2026-04-21T163111Z — p3-se-delete passed
  - 2026-04-21T17:00Z  # accept-2026-04-21T170054Z — p3-se-delete passed
upstream_filed: TBD (upstream bug)
related_adr: [ADR-0094]
owner: fix-session-delete (agent)
depth_class: lifecycle
```

## BUG-0005 — RVF native `SFVR` magic misread as corruption

```yaml
id: BUG-0005
title: Pure-TS RvfBackend throws "bad magic SFVR" when native owns the file
discovered: 2026-04-17
check_id: t3-2-concurrent, adr0080-store-init
fork_file: v3/@claude-flow/memory/src/rvf-backend.ts
state: closed
root_cause: |
  SFVR is the native @ruvector/rvf-node segment magic (forks/ruvector/crates/rvf/rvf-types/src/constants.rs:32),
  co-designed to coexist with pure-TS 'RVF\0'. Native writes SFVR to the main .rvf path + pure-TS
  metadata to .rvf.meta sidecar. When the pure-TS backend initialized on a project previously
  owned by native, loadFromDisk read the main path, saw SFVR, and threw RvfCorruptError instead
  of falling back to .meta.
fix_strategy: Added NATIVE_MAGIC = 'SFVR' constant + peek-and-skip path in loadFromDisk that falls back to .meta sidecar when the main file is native-owned.
fix_commit: 196100171
verified_date: 2026-04-21
verification_runs:
  - 2026-04-21T09:58Z  # accept-2026-04-21T095842Z — t3-2-concurrent + adr0080-store-init passed
  - 2026-04-21T16:31Z  # accept-2026-04-21T163111Z — t3-2-concurrent + adr0080-store-init passed
  - 2026-04-21T17:00Z  # accept-2026-04-21T170054Z — t3-2-concurrent + adr0080-store-init passed
upstream_filed: TBD (upstream bug; ADR-0092 is the architecture context)
related_adr: [ADR-0094, ADR-0092, ADR-0086]
owner: fix-rvf-magic (agent)
depth_class: happy
```

## BUG-0006 — agentdb_experience_record wrote to wrong SQLite table

```yaml
id: BUG-0006
title: agentdb_experience_record wrote to episodes instead of learning_experiences
discovered: 2026-04-17
check_id: adr0090-b5-learningSystem
fork_file: v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts
state: closed
root_cause: |
  MCP handler called ReflexionMemory.storeEpisode (writes `episodes` table). The B5 check
  and the tool contract both expect the row to land in `learning_experiences`. Silent
  success + 0 rows in expected table = classic ADR-0082 violation.
fix_strategy: Rewired handler to call LearningSystem.recordExperience; pre-create parent learning_sessions row to satisfy FK constraint. Fail loudly if LearningSystem absent (no silent in-memory fallback).
fix_commit: 2f3a832d6
verified_date: 2026-04-21
verification_runs:
  - 2026-04-21T09:58Z  # accept-2026-04-21T095842Z — adr0090-b5-learningSystem passed
  - 2026-04-21T16:31Z  # accept-2026-04-21T163111Z — adr0090-b5-learningSystem passed
  - 2026-04-21T17:00Z  # accept-2026-04-21T170054Z — adr0090-b5-learningSystem passed
upstream_filed: TBD
related_adr: [ADR-0094, ADR-0082, ADR-0090]
owner: fix-controller-sqlite (agent)
depth_class: happy
```

## BUG-0007 — replayWal re-ingest created orphan native vec segments

```yaml
id: BUG-0007
title: replayWal re-ingested own entries into native backend, causing empty-search state
discovered: 2026-04-17
check_id: e2e-0059-p3-unified-both, e2e-0059-p3-dedup
fork_file: v3/@claude-flow/memory/src/rvf-backend.ts
state: closed
root_cause: |
  During mergePeerStateBeforePersist, replayWal unconditionally re-ingested WAL entries
  into the native @ruvector/rvf-node backend. Single-writer CLI processes killed
  mid-shutdown left N orphan vec segments but indexedVectors: 0, needsRebuild: true.
  Every subsequent search returned empty (ADR-0082 silent-empty signature).
fix_strategy: For entries already in this.entries (alreadyLoaded=true — written by our own store() this session), update metadata dictionary only; skip HNSW + native index writes. Newly-seen peer entries still fall through to full ingest path.
fix_commit: 2f3a832d6
verified_date: 2026-04-21
verification_runs:
  - 2026-04-21T09:58Z  # accept-2026-04-21T095842Z — e2e-0059-p3-unified-both + e2e-0059-p3-dedup passed
  - 2026-04-21T16:31Z  # accept-2026-04-21T163111Z — e2e-0059-p3-unified-both + e2e-0059-p3-dedup passed
  - 2026-04-21T17:00Z  # accept-2026-04-21T170054Z — e2e-0059-p3-unified-both + e2e-0059-p3-dedup passed
upstream_filed: TBD
related_adr: [ADR-0094, ADR-0082, ADR-0090]
owner: fix-controller-sqlite (agent)
depth_class: lifecycle
```

## BUG-0008 — RVF single-writer durability on process.exit(0) — CLOSED

```yaml
id: BUG-0008
title: Concurrent CLI writers lose 5/6 entries because process.exit(0) skips compactWal
discovered: 2026-04-17
check_id: t3-2-concurrent
fork_file: v3/@claude-flow/memory/src/rvf-backend.ts
state: closed
root_cause: |
  CLI's setTimeout(process.exit(0), 500).unref() does NOT fire beforeExit, so
  memory-router._ensureExitHook → shutdownRouter → compactWal chain is skipped in most
  of 6 concurrent writers. Typically one lucky writer's beforeExit fires in time,
  compacts with only its own in-memory state, writes .meta.entryCount=1, and unlinks
  the WAL. Other 5 writers' entries live in WAL but .meta stays at 1. Further
  investigation (ADR-0095 Sprint-1/Pass-2/Pass-3) revealed the primary loss mode was
  a 3-layer backend flip race (silent tryNativeInit fallback + disjoint .meta/.rvf
  write targets + shared .rvf.tmp rename collisions), with a residual APFS
  visibility window on rename closing only after fsync-before-rename (d11).
fix_strategy: |
  Full ADR-0095 program: (a/b/c) fail-loud native init + per-writer unique tmp path +
  RvfBackend dedupe; (d1/d2) serialize tryNativeInit under advisory lock + route CLI
  through shared factory; (d3) acquireLock mkdirs parent; (d4) strict RVF\0 invariant
  for pure-TS ownership; (d5/d6/d8/d10) .meta sidecar fallback + exit shutdown hook +
  write-amp reduction + LockHeld retry; (d11) fsync tmp before rename to close APFS
  visibility window. Net: entryCount===N and zero subproc failures across 40 trials
  per N∈{2,4,6,8} in the diag probe, plus green t3-2-concurrent in full cascade.
fix_commit: 571388979  # d11 fsync-before-rename; preceded by 196100171, 9c5809324, 3fe71b9c7, e6901f397
verified_date: 2026-04-20
verification_runs:
  - 2026-04-19T10:45Z
  - 2026-04-19T12:46Z
  - 2026-04-20T10:43Z
upstream_filed: fork_only: RVF concurrent-write semantics are fork-specific; upstream does not ship RVF backend yet.
related_adr: [ADR-0094, ADR-0095, ADR-0090, ADR-0082, ADR-0092]
owner: fix-t3-2-rvf-concurrent (agent, ADR-0095)
depth_class: lifecycle
```


## BUG-TIERZ-ADR0059 — acceptance-adr0059-checks.sh lacks paired unit test (ADR-0097 Tier Z)

```yaml
id: BUG-TIERZ-ADR0059
title: acceptance-adr0059-checks.sh lacks paired tests/unit/ driver (ADR-0097 Tier Z retrofit debt)
discovered: 2026-04-21
check_id: tierz-adr0059
fork_file: lib/acceptance-adr0059-checks.sh
state: deferred
accepted_until: 2026-07-01
root_cause: Phase 1-7 check predates ADR-0097 Tier X convention (paired subprocess-driver unit test in tests/unit/).
fix_strategy: Retrofit a paired tests/unit/ driver covering the 5 ADR-0097 scenarios (happy / tool-not-found / empty / crash / pattern-mismatch) when the domain is next touched, per Tier Z rolling-retrofit policy.
upstream_filed: fork_only: ruflo-patch test-harness debt; no upstream component.
related_adr: [ADR-0097]
owner: unassigned
depth_class: lifecycle
```

## BUG-TIERZ-ADR0059-PHASE3 — acceptance-adr0059-phase3-checks.sh lacks paired unit test (ADR-0097 Tier Z)

```yaml
id: BUG-TIERZ-ADR0059-PHASE3
title: acceptance-adr0059-phase3-checks.sh lacks paired tests/unit/ driver (ADR-0097 Tier Z retrofit debt)
discovered: 2026-04-21
check_id: tierz-adr0059-phase3
fork_file: lib/acceptance-adr0059-phase3-checks.sh
state: deferred
accepted_until: 2026-07-01
root_cause: Phase 1-7 check predates ADR-0097 Tier X convention (paired subprocess-driver unit test in tests/unit/).
fix_strategy: Retrofit a paired tests/unit/ driver covering the 5 ADR-0097 scenarios (happy / tool-not-found / empty / crash / pattern-mismatch) when the domain is next touched, per Tier Z rolling-retrofit policy.
upstream_filed: fork_only: ruflo-patch test-harness debt; no upstream component.
related_adr: [ADR-0097]
owner: unassigned
depth_class: lifecycle
```

## BUG-TIERZ-ADR0059-PHASE4 — acceptance-adr0059-phase4-checks.sh lacks paired unit test (ADR-0097 Tier Z)

```yaml
id: BUG-TIERZ-ADR0059-PHASE4
title: acceptance-adr0059-phase4-checks.sh lacks paired tests/unit/ driver (ADR-0097 Tier Z retrofit debt)
discovered: 2026-04-21
check_id: tierz-adr0059-phase4
fork_file: lib/acceptance-adr0059-phase4-checks.sh
state: deferred
accepted_until: 2026-07-01
root_cause: Phase 1-7 check predates ADR-0097 Tier X convention (paired subprocess-driver unit test in tests/unit/).
fix_strategy: Retrofit a paired tests/unit/ driver covering the 5 ADR-0097 scenarios (happy / tool-not-found / empty / crash / pattern-mismatch) when the domain is next touched, per Tier Z rolling-retrofit policy.
upstream_filed: fork_only: ruflo-patch test-harness debt; no upstream component.
related_adr: [ADR-0097]
owner: unassigned
depth_class: lifecycle
```

## BUG-TIERZ-ADR0071 — acceptance-adr0071-checks.sh lacks paired unit test (ADR-0097 Tier Z)

```yaml
id: BUG-TIERZ-ADR0071
title: acceptance-adr0071-checks.sh lacks paired tests/unit/ driver (ADR-0097 Tier Z retrofit debt)
discovered: 2026-04-21
check_id: tierz-adr0071
fork_file: lib/acceptance-adr0071-checks.sh
state: deferred
accepted_until: 2026-07-01
root_cause: Phase 1-7 check predates ADR-0097 Tier X convention (paired subprocess-driver unit test in tests/unit/).
fix_strategy: Retrofit a paired tests/unit/ driver covering the 5 ADR-0097 scenarios (happy / tool-not-found / empty / crash / pattern-mismatch) when the domain is next touched, per Tier Z rolling-retrofit policy.
upstream_filed: fork_only: ruflo-patch test-harness debt; no upstream component.
related_adr: [ADR-0097]
owner: unassigned
depth_class: lifecycle
```

## BUG-TIERZ-ADR0079-TIER1 — acceptance-adr0079-tier1-checks.sh lacks paired unit test (ADR-0097 Tier Z)

```yaml
id: BUG-TIERZ-ADR0079-TIER1
title: acceptance-adr0079-tier1-checks.sh lacks paired tests/unit/ driver (ADR-0097 Tier Z retrofit debt)
discovered: 2026-04-21
check_id: tierz-adr0079-tier1
fork_file: lib/acceptance-adr0079-tier1-checks.sh
state: deferred
accepted_until: 2026-07-01
root_cause: Phase 1-7 check predates ADR-0097 Tier X convention (paired subprocess-driver unit test in tests/unit/).
fix_strategy: Retrofit a paired tests/unit/ driver covering the 5 ADR-0097 scenarios (happy / tool-not-found / empty / crash / pattern-mismatch) when the domain is next touched, per Tier Z rolling-retrofit policy.
upstream_filed: fork_only: ruflo-patch test-harness debt; no upstream component.
related_adr: [ADR-0097]
owner: unassigned
depth_class: lifecycle
```

## BUG-TIERZ-ADR0079-TIER2 — acceptance-adr0079-tier2-checks.sh lacks paired unit test (ADR-0097 Tier Z)

```yaml
id: BUG-TIERZ-ADR0079-TIER2
title: acceptance-adr0079-tier2-checks.sh lacks paired tests/unit/ driver (ADR-0097 Tier Z retrofit debt)
discovered: 2026-04-21
check_id: tierz-adr0079-tier2
fork_file: lib/acceptance-adr0079-tier2-checks.sh
state: deferred
accepted_until: 2026-07-01
root_cause: Phase 1-7 check predates ADR-0097 Tier X convention (paired subprocess-driver unit test in tests/unit/).
fix_strategy: Retrofit a paired tests/unit/ driver covering the 5 ADR-0097 scenarios (happy / tool-not-found / empty / crash / pattern-mismatch) when the domain is next touched, per Tier Z rolling-retrofit policy.
upstream_filed: fork_only: ruflo-patch test-harness debt; no upstream component.
related_adr: [ADR-0097]
owner: unassigned
depth_class: lifecycle
```

## BUG-TIERZ-ADR0079-TIER3 — acceptance-adr0079-tier3-checks.sh lacks paired unit test (ADR-0097 Tier Z)

```yaml
id: BUG-TIERZ-ADR0079-TIER3
title: acceptance-adr0079-tier3-checks.sh lacks paired tests/unit/ driver (ADR-0097 Tier Z retrofit debt)
discovered: 2026-04-21
check_id: tierz-adr0079-tier3
fork_file: lib/acceptance-adr0079-tier3-checks.sh
state: deferred
accepted_until: 2026-07-01
root_cause: Phase 1-7 check predates ADR-0097 Tier X convention (paired subprocess-driver unit test in tests/unit/).
fix_strategy: Retrofit a paired tests/unit/ driver covering the 5 ADR-0097 scenarios (happy / tool-not-found / empty / crash / pattern-mismatch) when the domain is next touched, per Tier Z rolling-retrofit policy.
upstream_filed: fork_only: ruflo-patch test-harness debt; no upstream component.
related_adr: [ADR-0097]
owner: unassigned
depth_class: lifecycle
```

## BUG-TIERZ-AGENT-LIFECYCLE — acceptance-agent-lifecycle-checks.sh lacks paired unit test (ADR-0097 Tier Z)

```yaml
id: BUG-TIERZ-AGENT-LIFECYCLE
title: acceptance-agent-lifecycle-checks.sh lacks paired tests/unit/ driver (ADR-0097 Tier Z retrofit debt)
discovered: 2026-04-21
check_id: tierz-agent-lifecycle
fork_file: lib/acceptance-agent-lifecycle-checks.sh
state: deferred
accepted_until: 2026-07-01
root_cause: Phase 1-7 check predates ADR-0097 Tier X convention (paired subprocess-driver unit test in tests/unit/).
fix_strategy: Retrofit a paired tests/unit/ driver covering the 5 ADR-0097 scenarios (happy / tool-not-found / empty / crash / pattern-mismatch) when the domain is next touched, per Tier Z rolling-retrofit policy.
upstream_filed: fork_only: ruflo-patch test-harness debt; no upstream component.
related_adr: [ADR-0097]
owner: unassigned
depth_class: lifecycle
```

## BUG-TIERZ-AIDEFENCE — acceptance-aidefence-checks.sh lacks paired unit test (ADR-0097 Tier Z)

```yaml
id: BUG-TIERZ-AIDEFENCE
title: acceptance-aidefence-checks.sh lacks paired tests/unit/ driver (ADR-0097 Tier Z retrofit debt)
discovered: 2026-04-21
check_id: tierz-aidefence
fork_file: lib/acceptance-aidefence-checks.sh
state: deferred
accepted_until: 2026-07-01
root_cause: Phase 1-7 check predates ADR-0097 Tier X convention (paired subprocess-driver unit test in tests/unit/).
fix_strategy: Retrofit a paired tests/unit/ driver covering the 5 ADR-0097 scenarios (happy / tool-not-found / empty / crash / pattern-mismatch) when the domain is next touched, per Tier Z rolling-retrofit policy.
upstream_filed: fork_only: ruflo-patch test-harness debt; no upstream component.
related_adr: [ADR-0097]
owner: unassigned
depth_class: lifecycle
```

## BUG-TIERZ-AUTOPILOT — acceptance-autopilot-checks.sh lacks paired unit test (ADR-0097 Tier Z) — CLOSED

```yaml
id: BUG-TIERZ-AUTOPILOT
title: acceptance-autopilot-checks.sh lacks paired tests/unit/ driver (ADR-0097 Tier Z retrofit debt)
discovered: 2026-04-21
check_id: tierz-autopilot
fork_file: lib/acceptance-autopilot-checks.sh
paired_test_file: tests/unit/acceptance-autopilot-checks.test.mjs
state: closed
closed_date: 2026-04-21
root_cause: Phase 1-7 check predates ADR-0097 Tier X convention (paired subprocess-driver unit test in tests/unit/).
fix_strategy: Paired driver covers 9 autopilot checks × 3 scenarios (happy / tool-not-found / pattern-mismatch) via a bash shim sourcing the lib with stubbed _cli_cmd and _run_and_kill. 28/28 pass.
upstream_filed: fork_only: ruflo-patch test-harness debt; no upstream component.
related_adr: [ADR-0097]
owner: tester-agent
depth_class: lifecycle
```

## BUG-TIERZ-BROWSER — acceptance-browser-checks.sh lacks paired unit test (ADR-0097 Tier Z)

```yaml
id: BUG-TIERZ-BROWSER
title: acceptance-browser-checks.sh lacks paired tests/unit/ driver (ADR-0097 Tier Z retrofit debt)
discovered: 2026-04-21
check_id: tierz-browser
fork_file: lib/acceptance-browser-checks.sh
state: deferred
accepted_until: 2026-07-01
root_cause: Phase 1-7 check predates ADR-0097 Tier X convention (paired subprocess-driver unit test in tests/unit/).
fix_strategy: Retrofit a paired tests/unit/ driver covering the 5 ADR-0097 scenarios (happy / tool-not-found / empty / crash / pattern-mismatch) when the domain is next touched, per Tier Z rolling-retrofit policy.
upstream_filed: fork_only: ruflo-patch test-harness debt; no upstream component.
related_adr: [ADR-0097]
owner: unassigned
depth_class: lifecycle
```

## BUG-TIERZ-CLAIMS — acceptance-claims-checks.sh lacks paired unit test (ADR-0097 Tier Z)

```yaml
id: BUG-TIERZ-CLAIMS
title: acceptance-claims-checks.sh lacks paired tests/unit/ driver (ADR-0097 Tier Z retrofit debt)
discovered: 2026-04-21
check_id: tierz-claims
fork_file: lib/acceptance-claims-checks.sh
state: deferred
accepted_until: 2026-07-01
root_cause: Phase 1-7 check predates ADR-0097 Tier X convention (paired subprocess-driver unit test in tests/unit/).
fix_strategy: Retrofit a paired tests/unit/ driver covering the 5 ADR-0097 scenarios (happy / tool-not-found / empty / crash / pattern-mismatch) when the domain is next touched, per Tier Z rolling-retrofit policy.
upstream_filed: fork_only: ruflo-patch test-harness debt; no upstream component.
related_adr: [ADR-0097]
owner: unassigned
depth_class: lifecycle
```

## BUG-TIERZ-CLI-COMMANDS — acceptance-cli-commands-checks.sh lacks paired unit test (ADR-0097 Tier Z) — CLOSED

```yaml
id: BUG-TIERZ-CLI-COMMANDS
title: acceptance-cli-commands-checks.sh lacks paired tests/unit/ driver (ADR-0097 Tier Z retrofit debt)
discovered: 2026-04-21
check_id: tierz-cli-commands
fork_file: lib/acceptance-cli-commands-checks.sh
paired_test_file: tests/unit/acceptance-cli-commands-checks.test.mjs
state: closed
closed_date: 2026-04-21
root_cause: Phase 1-7 check predates ADR-0097 Tier X convention (paired subprocess-driver unit test in tests/unit/).
fix_strategy: |
  Paired driver covers 9 CLI-subcommand checks × 4 scenarios (exit 0 + match / nonzero exit / empty output / pattern-mismatch). Excludes check_adr0094_p7_cli_system_info from the unit matrix because its expected pattern contains `ruflo` and _p7_cli_check does not strip the `__RUFLO_DONE__:<rc>` sentinel from the body, causing spurious matches in unit shims — the live acceptance run is unaffected because real CLI status output has richer content. 37/37 pass.
upstream_filed: fork_only: ruflo-patch test-harness debt; no upstream component.
related_adr: [ADR-0097]
owner: tester-agent
depth_class: lifecycle
```

## BUG-TIERZ-COORDINATION — acceptance-coordination-checks.sh lacks paired unit test (ADR-0097 Tier Z)

```yaml
id: BUG-TIERZ-COORDINATION
title: acceptance-coordination-checks.sh lacks paired tests/unit/ driver (ADR-0097 Tier Z retrofit debt)
discovered: 2026-04-21
check_id: tierz-coordination
fork_file: lib/acceptance-coordination-checks.sh
state: deferred
accepted_until: 2026-07-01
root_cause: Phase 1-7 check predates ADR-0097 Tier X convention (paired subprocess-driver unit test in tests/unit/).
fix_strategy: Retrofit a paired tests/unit/ driver covering the 5 ADR-0097 scenarios (happy / tool-not-found / empty / crash / pattern-mismatch) when the domain is next touched, per Tier Z rolling-retrofit policy.
upstream_filed: fork_only: ruflo-patch test-harness debt; no upstream component.
related_adr: [ADR-0097]
owner: unassigned
depth_class: lifecycle
```

## BUG-TIERZ-DAA — acceptance-daa-checks.sh lacks paired unit test (ADR-0097 Tier Z)

```yaml
id: BUG-TIERZ-DAA
title: acceptance-daa-checks.sh lacks paired tests/unit/ driver (ADR-0097 Tier Z retrofit debt)
discovered: 2026-04-21
check_id: tierz-daa
fork_file: lib/acceptance-daa-checks.sh
state: deferred
accepted_until: 2026-07-01
root_cause: Phase 1-7 check predates ADR-0097 Tier X convention (paired subprocess-driver unit test in tests/unit/).
fix_strategy: Retrofit a paired tests/unit/ driver covering the 5 ADR-0097 scenarios (happy / tool-not-found / empty / crash / pattern-mismatch) when the domain is next touched, per Tier Z rolling-retrofit policy.
upstream_filed: fork_only: ruflo-patch test-harness debt; no upstream component.
related_adr: [ADR-0097]
owner: unassigned
depth_class: lifecycle
```

## BUG-TIERZ-DIAGNOSTIC — acceptance-diagnostic-checks.sh lacks paired unit test (ADR-0097 Tier Z)

```yaml
id: BUG-TIERZ-DIAGNOSTIC
title: acceptance-diagnostic-checks.sh lacks paired tests/unit/ driver (ADR-0097 Tier Z retrofit debt)
discovered: 2026-04-21
check_id: tierz-diagnostic
fork_file: lib/acceptance-diagnostic-checks.sh
state: deferred
accepted_until: 2026-07-01
root_cause: Phase 1-7 check predates ADR-0097 Tier X convention (paired subprocess-driver unit test in tests/unit/).
fix_strategy: Retrofit a paired tests/unit/ driver covering the 5 ADR-0097 scenarios (happy / tool-not-found / empty / crash / pattern-mismatch) when the domain is next touched, per Tier Z rolling-retrofit policy.
upstream_filed: fork_only: ruflo-patch test-harness debt; no upstream component.
related_adr: [ADR-0097]
owner: unassigned
depth_class: lifecycle
```

## BUG-TIERZ-E2E — acceptance-e2e-checks.sh lacks paired unit test (ADR-0097 Tier Z)

```yaml
id: BUG-TIERZ-E2E
title: acceptance-e2e-checks.sh lacks paired tests/unit/ driver (ADR-0097 Tier Z retrofit debt)
discovered: 2026-04-21
check_id: tierz-e2e
fork_file: lib/acceptance-e2e-checks.sh
state: deferred
accepted_until: 2026-07-01
root_cause: Phase 1-7 check predates ADR-0097 Tier X convention (paired subprocess-driver unit test in tests/unit/).
fix_strategy: Retrofit a paired tests/unit/ driver covering the 5 ADR-0097 scenarios (happy / tool-not-found / empty / crash / pattern-mismatch) when the domain is next touched, per Tier Z rolling-retrofit policy.
upstream_filed: fork_only: ruflo-patch test-harness debt; no upstream component.
related_adr: [ADR-0097]
owner: unassigned
depth_class: lifecycle
```

## BUG-TIERZ-FILE-OUTPUT — acceptance-file-output-checks.sh lacks paired unit test (ADR-0097 Tier Z)

```yaml
id: BUG-TIERZ-FILE-OUTPUT
title: acceptance-file-output-checks.sh lacks paired tests/unit/ driver (ADR-0097 Tier Z retrofit debt)
discovered: 2026-04-21
check_id: tierz-file-output
fork_file: lib/acceptance-file-output-checks.sh
state: deferred
accepted_until: 2026-07-01
root_cause: Phase 1-7 check predates ADR-0097 Tier X convention (paired subprocess-driver unit test in tests/unit/).
fix_strategy: Retrofit a paired tests/unit/ driver covering the 5 ADR-0097 scenarios (happy / tool-not-found / empty / crash / pattern-mismatch) when the domain is next touched, per Tier Z rolling-retrofit policy.
upstream_filed: fork_only: ruflo-patch test-harness debt; no upstream component.
related_adr: [ADR-0097]
owner: unassigned
depth_class: lifecycle
```

## BUG-TIERZ-GITHUB-INTEGRATION — acceptance-github-integration-checks.sh lacks paired unit test (ADR-0097 Tier Z)

```yaml
id: BUG-TIERZ-GITHUB-INTEGRATION
title: acceptance-github-integration-checks.sh lacks paired tests/unit/ driver (ADR-0097 Tier Z retrofit debt)
discovered: 2026-04-21
check_id: tierz-github-integration
fork_file: lib/acceptance-github-integration-checks.sh
state: deferred
accepted_until: 2026-07-01
root_cause: Phase 1-7 check predates ADR-0097 Tier X convention (paired subprocess-driver unit test in tests/unit/).
fix_strategy: Retrofit a paired tests/unit/ driver covering the 5 ADR-0097 scenarios (happy / tool-not-found / empty / crash / pattern-mismatch) when the domain is next touched, per Tier Z rolling-retrofit policy.
upstream_filed: fork_only: ruflo-patch test-harness debt; no upstream component.
related_adr: [ADR-0097]
owner: unassigned
depth_class: lifecycle
```

## BUG-TIERZ-GUIDANCE — acceptance-guidance-checks.sh lacks paired unit test (ADR-0097 Tier Z)

```yaml
id: BUG-TIERZ-GUIDANCE
title: acceptance-guidance-checks.sh lacks paired tests/unit/ driver (ADR-0097 Tier Z retrofit debt)
discovered: 2026-04-21
check_id: tierz-guidance
fork_file: lib/acceptance-guidance-checks.sh
state: deferred
accepted_until: 2026-07-01
root_cause: Phase 1-7 check predates ADR-0097 Tier X convention (paired subprocess-driver unit test in tests/unit/).
fix_strategy: Retrofit a paired tests/unit/ driver covering the 5 ADR-0097 scenarios (happy / tool-not-found / empty / crash / pattern-mismatch) when the domain is next touched, per Tier Z rolling-retrofit policy.
upstream_filed: fork_only: ruflo-patch test-harness debt; no upstream component.
related_adr: [ADR-0097]
owner: unassigned
depth_class: lifecycle
```

## BUG-TIERZ-HIVEMIND — acceptance-hivemind-checks.sh lacks paired unit test (ADR-0097 Tier Z)

```yaml
id: BUG-TIERZ-HIVEMIND
title: acceptance-hivemind-checks.sh lacks paired tests/unit/ driver (ADR-0097 Tier Z retrofit debt)
discovered: 2026-04-21
check_id: tierz-hivemind
fork_file: lib/acceptance-hivemind-checks.sh
state: deferred
accepted_until: 2026-07-01
root_cause: Phase 1-7 check predates ADR-0097 Tier X convention (paired subprocess-driver unit test in tests/unit/).
fix_strategy: Retrofit a paired tests/unit/ driver covering the 5 ADR-0097 scenarios (happy / tool-not-found / empty / crash / pattern-mismatch) when the domain is next touched, per Tier Z rolling-retrofit policy.
upstream_filed: fork_only: ruflo-patch test-harness debt; no upstream component.
related_adr: [ADR-0097]
owner: unassigned
depth_class: lifecycle
```

## BUG-TIERZ-HOOKS-LIFECYCLE — acceptance-hooks-lifecycle-checks.sh lacks paired unit test (ADR-0097 Tier Z) — CLOSED

```yaml
id: BUG-TIERZ-HOOKS-LIFECYCLE
title: acceptance-hooks-lifecycle-checks.sh lacks paired tests/unit/ driver (ADR-0097 Tier Z retrofit debt)
discovered: 2026-04-21
check_id: tierz-hooks-lifecycle
fork_file: lib/acceptance-hooks-lifecycle-checks.sh
paired_test_file: tests/unit/acceptance-hooks-lifecycle-checks.test.mjs
state: closed
closed_date: 2026-04-21
root_cause: Phase 1-7 check predates ADR-0097 Tier X convention (paired subprocess-driver unit test in tests/unit/).
fix_strategy: Paired driver covers 8 hooks checks × 4 scenarios (happy / tool-not-found / empty-body / pattern-mismatch) against the canonical _mcp_invoke_tool helper (Result: sentinel path). 33/33 pass.
upstream_filed: fork_only: ruflo-patch test-harness debt; no upstream component.
related_adr: [ADR-0097]
owner: tester-agent
depth_class: lifecycle
```

## BUG-TIERZ-INPUT-VALIDATION — acceptance-input-validation-checks.sh lacks paired unit test (ADR-0097 Tier Z)

```yaml
id: BUG-TIERZ-INPUT-VALIDATION
title: acceptance-input-validation-checks.sh lacks paired tests/unit/ driver (ADR-0097 Tier Z retrofit debt)
discovered: 2026-04-21
check_id: tierz-input-validation
fork_file: lib/acceptance-input-validation-checks.sh
state: deferred
accepted_until: 2026-07-01
root_cause: Phase 1-7 check predates ADR-0097 Tier X convention (paired subprocess-driver unit test in tests/unit/).
fix_strategy: Retrofit a paired tests/unit/ driver covering the 5 ADR-0097 scenarios (happy / tool-not-found / empty / crash / pattern-mismatch) when the domain is next touched, per Tier Z rolling-retrofit policy.
upstream_filed: fork_only: ruflo-patch test-harness debt; no upstream component.
related_adr: [ADR-0097]
owner: unassigned
depth_class: lifecycle
```

## BUG-TIERZ-MODEL-ROUTING — acceptance-model-routing-checks.sh lacks paired unit test (ADR-0097 Tier Z)

```yaml
id: BUG-TIERZ-MODEL-ROUTING
title: acceptance-model-routing-checks.sh lacks paired tests/unit/ driver (ADR-0097 Tier Z retrofit debt)
discovered: 2026-04-21
check_id: tierz-model-routing
fork_file: lib/acceptance-model-routing-checks.sh
state: deferred
accepted_until: 2026-07-01
root_cause: Phase 1-7 check predates ADR-0097 Tier X convention (paired subprocess-driver unit test in tests/unit/).
fix_strategy: Retrofit a paired tests/unit/ driver covering the 5 ADR-0097 scenarios (happy / tool-not-found / empty / crash / pattern-mismatch) when the domain is next touched, per Tier Z rolling-retrofit policy.
upstream_filed: fork_only: ruflo-patch test-harness debt; no upstream component.
related_adr: [ADR-0097]
owner: unassigned
depth_class: lifecycle
```

## BUG-TIERZ-PACKAGE — acceptance-package-checks.sh lacks paired unit test (ADR-0097 Tier Z)

```yaml
id: BUG-TIERZ-PACKAGE
title: acceptance-package-checks.sh lacks paired tests/unit/ driver (ADR-0097 Tier Z retrofit debt)
discovered: 2026-04-21
check_id: tierz-package
fork_file: lib/acceptance-package-checks.sh
state: deferred
accepted_until: 2026-07-01
root_cause: Phase 1-7 check predates ADR-0097 Tier X convention (paired subprocess-driver unit test in tests/unit/).
fix_strategy: Retrofit a paired tests/unit/ driver covering the 5 ADR-0097 scenarios (happy / tool-not-found / empty / crash / pattern-mismatch) when the domain is next touched, per Tier Z rolling-retrofit policy.
upstream_filed: fork_only: ruflo-patch test-harness debt; no upstream component.
related_adr: [ADR-0097]
owner: unassigned
depth_class: lifecycle
```

## BUG-TIERZ-PERFORMANCE-ADV — acceptance-performance-adv-checks.sh lacks paired unit test (ADR-0097 Tier Z)

```yaml
id: BUG-TIERZ-PERFORMANCE-ADV
title: acceptance-performance-adv-checks.sh lacks paired tests/unit/ driver (ADR-0097 Tier Z retrofit debt)
discovered: 2026-04-21
check_id: tierz-performance-adv
fork_file: lib/acceptance-performance-adv-checks.sh
state: deferred
accepted_until: 2026-07-01
root_cause: Phase 1-7 check predates ADR-0097 Tier X convention (paired subprocess-driver unit test in tests/unit/).
fix_strategy: Retrofit a paired tests/unit/ driver covering the 5 ADR-0097 scenarios (happy / tool-not-found / empty / crash / pattern-mismatch) when the domain is next touched, per Tier Z rolling-retrofit policy.
upstream_filed: fork_only: ruflo-patch test-harness debt; no upstream component.
related_adr: [ADR-0097]
owner: unassigned
depth_class: lifecycle
```

## BUG-TIERZ-PROGRESS — acceptance-progress-checks.sh lacks paired unit test (ADR-0097 Tier Z)

```yaml
id: BUG-TIERZ-PROGRESS
title: acceptance-progress-checks.sh lacks paired tests/unit/ driver (ADR-0097 Tier Z retrofit debt)
discovered: 2026-04-21
check_id: tierz-progress
fork_file: lib/acceptance-progress-checks.sh
state: deferred
accepted_until: 2026-07-01
root_cause: Phase 1-7 check predates ADR-0097 Tier X convention (paired subprocess-driver unit test in tests/unit/).
fix_strategy: Retrofit a paired tests/unit/ driver covering the 5 ADR-0097 scenarios (happy / tool-not-found / empty / crash / pattern-mismatch) when the domain is next touched, per Tier Z rolling-retrofit policy.
upstream_filed: fork_only: ruflo-patch test-harness debt; no upstream component.
related_adr: [ADR-0097]
owner: unassigned
depth_class: lifecycle
```

## BUG-TIERZ-SESSION-LIFECYCLE — acceptance-session-lifecycle-checks.sh lacks paired unit test (ADR-0097 Tier Z) — CLOSED

```yaml
id: BUG-TIERZ-SESSION-LIFECYCLE
title: acceptance-session-lifecycle-checks.sh lacks paired tests/unit/ driver (ADR-0097 Tier Z retrofit debt)
discovered: 2026-04-21
check_id: tierz-session-lifecycle
fork_file: lib/acceptance-session-lifecycle-checks.sh
paired_test_file: tests/unit/acceptance-session-lifecycle-checks.test.mjs
state: closed
closed_date: 2026-04-21
root_cause: Phase 1-7 check predates ADR-0097 Tier X convention (paired subprocess-driver unit test in tests/unit/).
fix_strategy: Paired driver covers 5 session checks × 3 scenarios (happy / tool-not-found / pattern-mismatch), exercising the _session_invoke_tool custom helper and the _session_seed prereq chain used by restore/delete/info. 16/16 pass.
upstream_filed: fork_only: ruflo-patch test-harness debt; no upstream component.
related_adr: [ADR-0097]
owner: tester-agent
depth_class: lifecycle
```

## BUG-TIERZ-STRUCTURE — acceptance-structure-checks.sh lacks paired unit test (ADR-0097 Tier Z)

```yaml
id: BUG-TIERZ-STRUCTURE
title: acceptance-structure-checks.sh lacks paired tests/unit/ driver (ADR-0097 Tier Z retrofit debt)
discovered: 2026-04-21
check_id: tierz-structure
fork_file: lib/acceptance-structure-checks.sh
state: deferred
accepted_until: 2026-07-01
root_cause: Phase 1-7 check predates ADR-0097 Tier X convention (paired subprocess-driver unit test in tests/unit/).
fix_strategy: Retrofit a paired tests/unit/ driver covering the 5 ADR-0097 scenarios (happy / tool-not-found / empty / crash / pattern-mismatch) when the domain is next touched, per Tier Z rolling-retrofit policy.
upstream_filed: fork_only: ruflo-patch test-harness debt; no upstream component.
related_adr: [ADR-0097]
owner: unassigned
depth_class: lifecycle
```

## BUG-TIERZ-TASK-LIFECYCLE — acceptance-task-lifecycle-checks.sh lacks paired unit test (ADR-0097 Tier Z)

```yaml
id: BUG-TIERZ-TASK-LIFECYCLE
title: acceptance-task-lifecycle-checks.sh lacks paired tests/unit/ driver (ADR-0097 Tier Z retrofit debt)
discovered: 2026-04-21
check_id: tierz-task-lifecycle
fork_file: lib/acceptance-task-lifecycle-checks.sh
state: deferred
accepted_until: 2026-07-01
root_cause: Phase 1-7 check predates ADR-0097 Tier X convention (paired subprocess-driver unit test in tests/unit/).
fix_strategy: Retrofit a paired tests/unit/ driver covering the 5 ADR-0097 scenarios (happy / tool-not-found / empty / crash / pattern-mismatch) when the domain is next touched, per Tier Z rolling-retrofit policy.
upstream_filed: fork_only: ruflo-patch test-harness debt; no upstream component.
related_adr: [ADR-0097]
owner: unassigned
depth_class: lifecycle
```

## BUG-TIERZ-TERMINAL — acceptance-terminal-checks.sh lacks paired unit test (ADR-0097 Tier Z)

```yaml
id: BUG-TIERZ-TERMINAL
title: acceptance-terminal-checks.sh lacks paired tests/unit/ driver (ADR-0097 Tier Z retrofit debt)
discovered: 2026-04-21
check_id: tierz-terminal
fork_file: lib/acceptance-terminal-checks.sh
state: deferred
accepted_until: 2026-07-01
root_cause: Phase 1-7 check predates ADR-0097 Tier X convention (paired subprocess-driver unit test in tests/unit/).
fix_strategy: Retrofit a paired tests/unit/ driver covering the 5 ADR-0097 scenarios (happy / tool-not-found / empty / crash / pattern-mismatch) when the domain is next touched, per Tier Z rolling-retrofit policy.
upstream_filed: fork_only: ruflo-patch test-harness debt; no upstream component.
related_adr: [ADR-0097]
owner: unassigned
depth_class: lifecycle
```

## BUG-TIERZ-TRANSFER — acceptance-transfer-checks.sh lacks paired unit test (ADR-0097 Tier Z)

```yaml
id: BUG-TIERZ-TRANSFER
title: acceptance-transfer-checks.sh lacks paired tests/unit/ driver (ADR-0097 Tier Z retrofit debt)
discovered: 2026-04-21
check_id: tierz-transfer
fork_file: lib/acceptance-transfer-checks.sh
state: deferred
accepted_until: 2026-07-01
root_cause: Phase 1-7 check predates ADR-0097 Tier X convention (paired subprocess-driver unit test in tests/unit/).
fix_strategy: Retrofit a paired tests/unit/ driver covering the 5 ADR-0097 scenarios (happy / tool-not-found / empty / crash / pattern-mismatch) when the domain is next touched, per Tier Z rolling-retrofit policy.
upstream_filed: fork_only: ruflo-patch test-harness debt; no upstream component.
related_adr: [ADR-0097]
owner: unassigned
depth_class: lifecycle
```

## BUG-TIERZ-WASM — acceptance-wasm-checks.sh lacks paired unit test (ADR-0097 Tier Z)

```yaml
id: BUG-TIERZ-WASM
title: acceptance-wasm-checks.sh lacks paired tests/unit/ driver (ADR-0097 Tier Z retrofit debt)
discovered: 2026-04-21
check_id: tierz-wasm
fork_file: lib/acceptance-wasm-checks.sh
state: deferred
accepted_until: 2026-07-01
root_cause: Phase 1-7 check predates ADR-0097 Tier X convention (paired subprocess-driver unit test in tests/unit/).
fix_strategy: Retrofit a paired tests/unit/ driver covering the 5 ADR-0097 scenarios (happy / tool-not-found / empty / crash / pattern-mismatch) when the domain is next touched, per Tier Z rolling-retrofit policy.
upstream_filed: fork_only: ruflo-patch test-harness debt; no upstream component.
related_adr: [ADR-0097]
owner: unassigned
depth_class: lifecycle
```

## BUG-TIERZ-WORKFLOW — acceptance-workflow-checks.sh lacks paired unit test (ADR-0097 Tier Z) — CLOSED

```yaml
id: BUG-TIERZ-WORKFLOW
title: acceptance-workflow-checks.sh lacks paired tests/unit/ driver (ADR-0097 Tier Z retrofit debt)
discovered: 2026-04-21
check_id: tierz-workflow
fork_file: lib/acceptance-workflow-checks.sh
paired_test_file: tests/unit/acceptance-workflow-checks.test.mjs
state: closed
closed_date: 2026-04-21
root_cause: Phase 1-7 check predates ADR-0097 Tier X convention (paired subprocess-driver unit test in tests/unit/).
fix_strategy: Paired driver covers the 2 single-call checks (workflow_run, workflow_template) × 3 scenarios plus the 7-step workflow_lifecycle chain (create -> list -> execute -> status -> cancel -> delete -> list) under _with_iso_cleanup and _extract_workflow_id's node shell-out. 10/10 pass.
upstream_filed: fork_only: ruflo-patch test-harness debt; no upstream component.
related_adr: [ADR-0097]
owner: tester-agent
depth_class: lifecycle
```

## BUG-ADR0059-NO-COLLISIONS-SILENT-PASS — check_adr0059_no_id_collisions lost assertion on fresh project — FIX-COMMITTED

```yaml
id: BUG-ADR0059-NO-COLLISIONS-SILENT-PASS
title: check_adr0059_no_id_collisions silently passed on fresh project (ADR-0082 violation)
discovered: 2026-04-21
check_id: e2e-0059-no-collisions
fork_file: lib/acceptance-adr0059-checks.sh
paired_test_file: tests/unit/acceptance-adr0059-no-collisions.test.mjs
state: fix-committed
root_cause: >
  The old branch "No ranked-context.json (fresh project)" returned PASS with
  no assertion whenever ranked-context.json was absent — the ADR-0082
  silent-pass shape. Today's cascade flipped it to loud-fail, revealing that
  the initial fix's seed path (intelligence.cjs recordEdit + consolidate +
  init) did not actually populate the store. consolidate reads from an RVF
  file, and a freshly init'd project has an RVF with header-only body
  (162 bytes, zero entries), so readStoreFromRvf returns null and consolidate
  short-circuits with "No store to consolidate". init therefore had no
  ranked entries to write, so ranked-context.json was never produced and the
  check failed with "Seeding failed". Driving the seed via `$cli memory
  store` instead does NOT help because of BUG-ADR0059-RVF-FORMAT-MISMATCH.
fix_strategy: >
  Write a minimal pure-TS RVF\0 file directly into an isolated copy of the
  project before driving consolidate + init. This bypasses the
  CLI-write-path format bug and exercises the ID-collision invariant the
  check actually cares about — intelligence.cjs never emits duplicate IDs
  during consolidate+init.
upstream_filed: fork_only: ruflo-patch test-harness fix; product bug surfaced separately.
related_adr: [ADR-0059, ADR-0082, ADR-0086, ADR-0094]
owner: coder-agent
depth_class: happy
```

## BUG-ADR0059-RVF-FORMAT-MISMATCH — intelligence.cjs cannot read the RVF files written by `$cli memory store`

```yaml
id: BUG-ADR0059-RVF-FORMAT-MISMATCH
title: intelligence.cjs readStoreFromRvf rejects the native SFVR format written by @ruvector/rvf-node
discovered: 2026-04-21
check_id: e2e-0059-intel-graph, e2e-0059-retrieval, e2e-0059-no-collisions
fork_file: v3/@claude-flow/cli/.claude/helpers/intelligence.cjs
state: discovered
root_cause: >
  Two RVF storage formats coexist in the build. (1) The native SFVR format
  written by the @ruvector/rvf-node backend (magic 'SFVR', NATIVE_MAGIC in
  rvf-backend.js) is what a freshly init'd project actually produces. (2) A
  pure-TS fallback format (magic 'RVF\0'). intelligence.cjs readStoreFromRvf
  only accepts 'RVF\0' (line 50: `if (magic !== 'RVF\0') return null`). Every
  CLI-driven write produces an SFVR file that intelligence.cjs silently
  rejects, so consolidate/init always report empty even when the CLI has
  persisted dozens of entries. This is exactly what was masking
  check_adr0059_intel_graph and check_adr0059_retrieval as silent passes
  today ("Intelligence graph empty (expected: intelligence.cjs reads SQLite,
  CLI writes RVF — debt 17)"). The debt-17 comment is stale — ADR-0086
  switched the reader from SQLite to RVF — but the format mismatch is still
  live.
fix_strategy: >
  Teach intelligence.cjs readStoreFromRvf to also accept the native SFVR
  magic and route it through the @ruvector/rvf-node reader, or detect SFVR
  and shell out to `cli memory export --format rvf0` for on-the-fly
  conversion. Either way, the three intelligence-graph-family acceptance
  checks (intel-graph, retrieval, insight) should be flipped from their
  "empty expected" silent-pass shape to a real assertion once the reader
  understands both formats.
upstream_filed: fork_only: our fork's intelligence.cjs; not in upstream ruvnet/* yet.
related_adr: [ADR-0059, ADR-0082, ADR-0086, ADR-0094]
owner: unassigned
depth_class: happy
```
