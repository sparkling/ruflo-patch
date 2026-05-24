## ADR-0243 — CT-J: long-lived process resource discipline

**Status**: proposed (post-swarm-review)
**Swarm**: 4 experts + devil's advocate, Quorum-majority consensus
**Topology**: hierarchical · **Queen**: tactical · **Transport**: queen-composed
**Triage rank**: 14 of 15 (per [[ADR-0233]] §Decision; lowest-urgency batch)

### Decision (post-swarm-review)

Apply **Option A (per-site surgical fixes) for live sites + Option C
addendum (`no-unref-setinterval` ESLint rule) + explicit deferral of
F-10-002 to CT-F (ADR-0239)** as originally drafted, with **five
clarifications** surfaced by the panel: (i) bounded-LRU dispose contract
made explicit — probe `destroy`/`free`/`dispose` on eviction; behaviour
test asserts process RSS not just `Map.size`; (ii) `no-unref-setinterval`
lint scoped to `cli/src/**` + `memory/src/**` ONLY, `v3/mcp/**` exempted
via `overrides` until CT-F decides; (iii) `daemonShutdownHandlersInstalled`
idempotency flag MUST be module-scope `let`, not class-scope `private`
(the `daemon trigger` path constructs fresh `WorkerDaemon` per call); (iv)
Consequences updated to acknowledge F-10-003 is already on deck for the
HandleRegistry extraction; (v) F-10-007 eager-flush fix recorded with a
follow-up footnote that even post-fix a single 300MB transient on load is
an inherent ceiling — stream-ingest is a separate ADR. DA holds
principled dissent on the F-10-007 ceiling (out of CT-J scope) and
withdraws on the lint-vs-perf-monitor challenge.

### Implementation steps

1. **F-10-001 — bounded LRU on three `ruvllm-tools.ts:312-314` Maps.**
   New class (or local helper matching the `HiveLRU` shape at
   `hive-mind-tools.ts:868-931`). Cap from
   `CLAUDE_FLOW_RUVLLM_CACHE_MAX` env (default 64; fail-loud on invalid
   per `[[feedback-no-fallbacks]]`). Move-to-front on `get`. **Eviction
   probes `typeof handle.destroy === 'function' ? handle.destroy() : typeof handle.free === 'function' ? handle.free() : typeof handle.dispose === 'function' ? handle.dispose() : noop` in that priority order.** Commit per
   `[[feedback-commit-forks-before-release]]`. Behaviour test cycles 200
   distinct ids through `mcp__ruflo__ruvllm_hnsw_create`, asserts (a)
   `Map.size === 64`, (b) **process RSS stays under LRU-cap budget**
   (~64 × per-instance WASM heap), (c) eviction count matches the spec.

2. **F-10-005 — bounded LRU + idle-TTL on `activeTrajectories`** at
   `hooks-tools.ts:528`. Default cap 256, TTL 1 hour from last step.
   Symmetric with F-10-001 dispose contract (trajectories have no native
   handle, so dispose probe yields noop — but the probe shape stays for
   future-proofing). Behaviour test: start trajectory, simulate idle 1h,
   assert eviction.

3. **F-10-007 — eager-flush `_pendingNativeIngest`** at
   `rvf-backend.ts:186-187`. Inside `ensureNativeSemanticReady`,
   immediately after native append completes: `this._pendingNativeIngest = []`,
   THEN `this._nativeRehydrated = true` (in that order so a re-entrant
   call cannot append against a half-cleared array). Behaviour test:
   load 100K entries into RVF without calling `search()`, call
   `ensureNativeSemanticReady` directly, assert
   `_pendingNativeIngest.length === 0` AND subsequent `search()` returns
   the loaded set. **Zero merge tax** (fork-only code — upstream
   rvf-backend.ts is 527 LOC vs fork's 3,221 LOC; the field doesn't
   exist upstream).

4. **F-10-010 — module-scope idempotency gate for daemon signal handlers**
   at `worker-daemon.ts:462-472, 483-504`. **Module-scope** (top-level
   `let daemonShutdownHandlersInstalled = false`), NOT class-scope
   `private`. Same gate shape for `installCrashHandlers`
   (`uncaughtException` + `unhandledRejection`). Adopts the
   `audit-writer::installSignalHandlersOnce` pattern verbatim. Behaviour
   test: call `daemon trigger` twice in same process via in-tree harness,
   assert `process.listenerCount('SIGTERM')` stays at 1 (and same for
   SIGINT, SIGHUP, uncaughtException, unhandledRejection).

5. **F-10-002 — DEFER to CT-F (ADR-0239 cluster 2).** Track as closed-by-
   reference in this ADR's site table. If CT-F **deletes** `v3/mcp/`,
   F-10-002 evaporates with the subtree; if CT-F **keeps**, apply
   `.unref()` per timer as a one-line follow-up amendment AND remove the
   `v3/mcp/**` exemption from the lint scope. See cross-bonus row in
   [[ADR-0233]] §Cross-bonus dependencies.

6. **`no-unref-setinterval` ESLint rule** added under
   `forks/ruflo/v3/@claude-flow/cli/.eslintrc.json` (existing config —
   verified) AND `forks/ruflo/v3/@claude-flow/memory/.eslintrc.json`
   (create new). Scoped via `overrides.files` to **`cli/src/**` and
   `memory/src/**` ONLY**; `v3/mcp/**` explicitly **excluded** until
   CT-F decides. Defer the NAPI/WASM-Map arch-test (Option C part b) as
   a follow-up — requires custom TypeScript-AST traversal materially more
   work than the lint.

7. **INTEGRATION-LEDGER rows**:
   - F-10-001: `superseded-by-local` citing this ADR; upstream
     `ruvnet/ruflo/v3/@claude-flow/cli/src/mcp-tools/ruvllm-tools.ts:312-314`
     carries the byte-identical defect — fork-only merge tax until
     upstream takes a matching patch.
   - F-10-010: `superseded-by-local` citing this ADR; upstream
     `ruvnet/ruflo/v3/@claude-flow/cli/src/services/worker-daemon.ts:366-375`
     carries the byte-identical defect. Fork-only merge tax.
   - F-10-007: **no ledger row needed** (fork-only code per
     [[project-fork-only-controllers]]; the field doesn't exist upstream).
   - F-10-005: `superseded-by-local` if upstream `hooks-tools.ts` carries
     the same module-scope Map (verify at implementation time).

### Dependencies

- [[ADR-0233]] §CT-J — defect-class origin citing F-10-001, F-10-002
  (CRITICAL), F-10-005, F-10-007, F-10-010 (WARN/NOTE counter-flag).
- [[ADR-0239]] (CT-F cluster 2) — gates F-10-002 site #2. **Cross-bonus**
  per ADR-0233 §Cross-bonus dependencies: deleting `v3/mcp/` evaporates
  F-10-002 (3 timers) AND F-05-001 (CT-G site #1) with one delete.
- [[ADR-0244]] (CT-K) **F-01-002 sequenced after CT-J Site #4** per ADR-0233:
  "canonical PID/signal discipline lives at CT-J Site #4". Adopting F-10-010
  here unblocks the CT-K `start --daemon` PID-race fix.
- [[ADR-0080]] — HNSW 100K maxElements cap is the source of F-10-007's
  300MB upper bound; eager-flush closes retention-after-rehydrate but
  doesn't change the cap.
- [[ADR-0073]] — RVF substrate-persistence charter; F-10-007 fix
  preserves "RVF is source of truth" invariant.
- [[ADR-0201]] — Remediation-ADR pre-flight checklist that cleared this
  draft. Check #4 ("no sibling-ADR overlap") was the flip point — the
  audit's original static suggestion to fix F-10-002 per-site collided
  with CT-F's planned `v3/mcp/` deletion; deferral was the correct
  inversion. Pre-flight clears for all 4 live sites unconditionally.
- [[ADR-0215]] — golden-master pattern is the precedent for ship-cleanup
  + cheap regression-guard lint together, rather than gate-only.
- `[[feedback-no-fallbacks]]` — LRU on invalid `maxEntries` MUST throw
  (matches `HiveLRU` constructor at hive-mind-tools.ts:876-883).
- `[[feedback-remediation-adr-preflight]]` — corpus-level rule gating
  this ADR's drafting.
- `[[project-fork-only-controllers]]` — establishes F-10-007 RvfBackend
  enhancements as fork-only code with zero merge tax.

### Validation

- **Source-shape grep**:
  - `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/ruvllm-tools.ts:312-314`
    Maps wrapped in bounded-LRU class (or local helper), constructor reads
    `CLAUDE_FLOW_RUVLLM_CACHE_MAX` env (default 64).
  - `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts:186-187` —
    `_pendingNativeIngest = []` assignment present inside
    `ensureNativeSemanticReady` BEFORE `_nativeRehydrated = true`.
  - `forks/ruflo/v3/@claude-flow/cli/src/services/worker-daemon.ts` —
    module-scope `let daemonShutdownHandlersInstalled = false` declaration
    AND `setupShutdownHandlers` short-circuits if set.
  - `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts:528` —
    `activeTrajectories` wrapped in bounded-LRU + idle-TTL.
- **ESLint pass**: `npm run lint --workspace=@claude-flow/cli` and
  `@claude-flow/memory` fail red on a deliberate `setInterval` without
  `.unref()` in `cli/src/` or `memory/src/`; pass green for the existing
  compliant sites (`worker-daemon.ts`, `worker-queue.ts`, `mcp-server.ts`,
  `rvf-backend.ts.persistTimer`). `v3/mcp/` sites stay un-linted until CT-F.
- **Behavioural acceptance** (per per-site test specs in
  [[ADR-0243]] §Decision):
  - Cycle 200 distinct ids through `ruvllm_hnsw_create`; assert process
    RSS does not grow past the LRU-cap budget (~64 × per-instance WASM
    heap), not just `Map.size === 64`.
  - Load 100K entries into RVF without calling `search()`; call
    `ensureNativeSemanticReady`; assert `_pendingNativeIngest.length === 0`
    AND subsequent `search()` returns the loaded set.
  - Call `daemon trigger` twice in same process; assert
    `process.listenerCount('SIGTERM') === 1` (and same for SIGINT,
    SIGHUP, uncaughtException, unhandledRejection).
- **Runtime stress carry-forward**: per [[ADR-0201]] §Carry-forward and
  [[ADR-0233]] §Reviews still owed, the full scope of G-16-014 — a
  long-running runtime stress test (10K+ MCP tool calls against a
  single MCP-stdio process with RSS / FD-count / listener-count budget
  assertions) — remains owed AFTER CT-J's per-site patches and CT-F's
  site #2 resolution land. The per-site behaviour tests assert each FIX
  at its seam but NOT freedom-from-drift at the process level.
- **No `skip_accepted`** per `[[feedback-skip-accepted-as-squelch]]`.

### Top risk + mitigation

- **Risk**: F-10-001 LRU lands without the strengthened dispose contract,
  so the bounded JS Map evicts entries but the underlying WASM heap stays
  retained (a `MicroLora`/`SonaInstant`/`HnswRouter` `destroy`/`free`
  call is needed to release the WASM-side memory). Behaviour test
  asserting only `Map.size === 64` would pass while the actual leak
  continues — RSS still grows linearly with distinct ids.
- **Mitigation**: dispose probe is mandatory per Expert 1's amendment;
  behaviour test asserts process RSS budget, not just `Map.size`.
  The probe priority order (`destroy` → `free` → `dispose` → noop) is
  explicit so future WASM types with different lifecycle methods are
  handled without code change. Matches Expert 1's concern that "silent
  eviction without releasing WASM heap is the actual bug, not the JS
  Map size".

- **Risk** (secondary): F-10-002 deferral leaves the v3/mcp/ event-loop-
  pin live in the tree. A CLI command that transiently constructs a
  `ConnectionPool` via an as-yet-unidentified import path hangs Node on
  exit until CT-F decides.
- **Mitigation**: audit confirmed zero external callers of `v3/mcp/`
  today (CT-F pre-flight check #3 verified 0 hits for `from '.*v3/mcp/'`
  outside the subtree itself). The lint catches NEW uses elsewhere; the
  CT-F triage decision is owed at triage priority #10 — well-bounded
  wait. If CT-F defers further, this ADR carries an amendment to apply
  the `.unref()` per-site fix and remove the lint exemption.
