# ADR-0088: Daemon Scope Alignment — Scheduler Only, Never Hot Path

- **Status**: Implemented (2026-04-15) — **Amended 2026-04-20** (capability gate removed, see §Amendment 2026-04-20)
- **Date**: 2026-04-15
- **Implementation commits**:
  - fork: `c3ad3ebc9` (daemon scope alignment), `f182ab90d` (comment fix), **PENDING (2026-04-20)** (capability gate removal)
  - patch: `62d4f22` (ADR + tests + acceptance), `1c790d4` (stale Phase 4 check removal), `99a6418` (status → Implemented), `3ecc509` (flake root-cause fixes), `6e0379a` + `bbf78f8` (bash arithmetic bugs uncovered while debugging)
- **Scope**: Fork (`@claude-flow/cli`), Patch repo (`ruflo-patch` acceptance tests)
- **Related**: upstream ADR-014, ADR-019, ADR-020, ADR-050; our ADR-0082, ADR-0086

## Amendment 2026-04-20 — Capability gate removed

The original decision (§Decision item 8) made the SessionStart `daemon start` hook **conditional** on `which claude` succeeding at init time. Observation that forced the amendment:

- **The probe runs at init time, not at hook-invocation time.** Users who install Claude Code *after* `cli init --full` never get the daemon wired, even when it would now work. Re-running init is required to re-probe — an invisible trap.
- **The hook is already fail-safe.** The wired command is `npx @claude-flow/cli@latest daemon start --quiet 2>/dev/null || true` — it silently no-ops when the daemon cannot start (claude absent, already running, socket collision). Always wiring it is strictly cheaper than probing + remembering the result.
- **Two workers are always useful.** `consolidate` and `preload` (explicitly listed in §Preserve) run regardless of whether `claude` is on PATH. A degraded-mode daemon still delivers their value; it is not "worse than not starting."
- **Test harness reality.** The bash acceptance runner never fires `SessionStart`, so the capability gate's observable side effect is purely "does settings.json contain a daemon-start hook entry" — the probe controls a *string in a JSON file*, not actual daemon behavior.

Changes landing in fork commit (pending):

- Delete `claudeCliAvailable()` helper from `v3/@claude-flow/cli/src/init/settings-generator.ts` (~24 lines including docblock)
- Delete unused `import { execSync } from 'node:child_process'`
- Remove the `if (claudeCliAvailable()) { ... }` gate around the daemon-start hook push; push unconditionally
- Update §Decision item 8 below: "wire unconditionally; the `|| true` trailer is the honest capability gate at runtime"

Acceptance check `check_adr0088_conditional_init` (originally asserted "no claude → no daemon-start entry") is **retired** — its premise no longer holds. `check_adr0088_conditional_init_with_claude` (positive case) becomes the unconditional check: **init always wires the daemon-start hook**. Paired unit test `adr0088-init-conditional-wiring.test.mjs` is updated to assert unconditional wiring.

Preserves the rest of ADR-0088: daemon is still scheduler-only, still not in hot path, still not a memory/MCP RPC server. Only the init-time capability gate is reverted.

- **Related**: upstream ADR-014, ADR-019, ADR-020, ADR-050; our ADR-0082, ADR-0086

## Context

### Upstream's stated design (ADR-014, extended 2026-01-05 through 2026-01-07)

> "V3 needs a robust background worker system for continuous monitoring of system health, security, and performance ... V2 relies on shell scripts (`.claude/helpers/`) which are platform-specific (Linux/macOS only), difficult to test, not integrated with the TypeScript codebase, and lacking persistence and historical tracking."

ADR-014's stated purpose for the daemon is clear: **cross-platform TypeScript replacement for shell helpers**, scheduled background monitoring, state persistence, alert thresholds.

ADR-014 was extended three times in two days:
1. **2026-01-05** — 10 built-in workers in `@claude-flow/hooks` with `WorkerManager` class
2. **2026-01-06** — 12 trigger-based workers (different set) auto-dispatched by `UserPromptSubmit` hook
3. **2026-01-07** — Full `WorkerDaemon` service in `@claude-flow/cli/src/services/worker-daemon.ts`, auto-start on SessionStart, IPC server registering `memory.store/search/count/list/bulkInsert`

ADR-020 (2026-01-07) further extended the design with `HeadlessWorkerExecutor`:

> "By integrating `CLAUDE_CODE_HEADLESS` mode, workers can invoke Claude Code for intelligent analysis (not just file scanning), execute in sandboxed environments per worker type, scale across containers."

9 of the 12 workers are explicitly designed as **headless-AI workers** that spawn `claude` as a subprocess with sandbox profiles. They run in degraded local mode (write placeholder JSON) when `claude` is not on PATH. This is intentional, not a bug.

### The reversal (ADR-050, Intelligence Loop)

Written later, ADR-050 **explicitly rejects** the daemon approach for the highest-frequency path:

> "### Why not a daemon?
>
> A daemon would require process management, health checking, and IPC complexity. The file-based approach is simpler, more reliable, and stays within the performance budget."

And:

> "Each hook invocation is a separate process. There is no long-running daemon to hold state in memory. JSON files provide simple, atomic persistence between invocations."

ADR-050 decided the intelligence pipeline (`.claude/helpers/intelligence.cjs`, called on every `route`, `post-edit`, `session-start` hook event) would **not** use the daemon. File-based CJS only.

### Current reality (5-agent hive audit, 2026-04-15)

Verified from code across both the fork and patch repos:

| Area | Finding | File:line |
|---|---|---|
| `DaemonIPCClient` class | Defined, zero instantiations anywhere | `daemon-ipc.ts:208-302` |
| `DaemonIPCServer` memory methods | Registered, zero in-tree callers | `worker-daemon.ts:584-611` |
| `auto-memory-hook.mjs` daemon probe | Checks socket, prints "Daemon IPC: Active", then uses in-process backend anyway | `auto-memory-hook.mjs:241-326` |
| `daemon status` command | Prints "IPC Socket: LISTENING" based on file-existence check, not real handshake | `commands/daemon.ts:488-501` |
| `memory-router.ts` | Zero daemon imports; every `cli memory store` writes in-process | `memory/memory-router.ts` |
| `commands/init.ts` auto-start | Only wires daemon start with `--start-daemon`/`--start-all` flag; no capability detection | `commands/init.ts:386-422` |
| `hooks_worker-dispatch` MCP tool | `setTimeout()` stub updating an in-process Map; does not dispatch to daemon | `mcp-tools/hooks-tools.ts:3497-3590` |
| 9 of 12 "stub" workers | Write placeholder JSON with `note: "Install Claude Code CLI for AI-powered analysis"` | `worker-daemon.ts:971-1200` |

### The contradiction

ADR-014's 2026-01-07 extension added the IPC server intending the daemon to be the single writer for memory ops (ADR-059 Phase 4 framed this same way). ADR-050, written later, **rejected exactly this architecture**. The IPC server shipped anyway; the rejection did not propagate. Nobody wired a caller. The result: ~140 LOC of dead code, misleading status output, and an unresolved architectural question.

## Decision

The daemon is scoped to: **a cross-platform timer scheduler for background monitoring workers. Runs real AI analysis in headless mode when `claude` CLI is on PATH; runs in degraded local mode otherwise. Not part of any CLI hot path.**

It is explicitly **not**:
- a memory RPC server
- an MCP tool host
- involved in `memory store`, `memory search`, or `mcp exec`
- auto-started when it cannot do meaningful work

### Changes to enforce the scope

**Delete (dead code that contradicts ADR-050):**

1. `DaemonIPCClient` class (`daemon-ipc.ts:208-302`, ~95 LOC) — zero callers
2. `DaemonIPCServer` registration of `memory.store/search/count/list/bulkInsert` methods (`worker-daemon.ts:584-611`) — unused
3. `tryDaemonIPC()` and `ipcCall()` functions in `auto-memory-hook.mjs` (`:241-288`) — defined, never called
4. The `"[Phase 4] Daemon IPC available"` status print in `auto-memory-hook.mjs` — misleading
5. The `"IPC Socket: LISTENING"` line in `daemon status` output — file-existence theatre, not a real probe

**Add (honest UX, ~20 LOC):**

6. Capability detection at daemon startup — `which claude` equivalent check
7. Startup log (one line):
   - If `claude` on PATH: *"Daemon starting in headless mode — AI workers will invoke Claude Code."*
   - If not: *"Daemon starting in local mode — 9 of 12 workers will write placeholder metrics. Install Claude Code CLI for AI-powered background analysis."*
8. Conditional SessionStart auto-start wiring in `init/settings-generator.ts`:
   - If `claude` detected during init: wire the SessionStart hook per ADR-014's original intent
   - If not: do not wire it — starting a degraded-mode daemon is worse than not starting one
9. Replace `"IPC Socket: LISTENING"` in `daemon status` with `"AI Mode: headless"` or `"AI Mode: local"` based on current capability

**Preserve (no changes):**

- All 12 workers — they are headless-AI workers running in degraded local mode by design, per ADR-020
- `HeadlessWorkerExecutor` (1387 LOC) — upstream's actual AI-worker value prop
- `consolidate` and `preload` workers (the two that do real local work)
- PID file, state file, socket file, timer scheduling, resource gating
- `runtime/headless.ts` and the CI/appliance paths that depend on the daemon

## Consequences

### Positive

- Restores ADR-050 compliance — the memory/hooks hot path is in-process only, no silent daemon fallback
- Restores ADR-014's original intent — SessionStart auto-start wires when capability exists
- Honest UX — `daemon status` tells users exactly what mode they're in; no more "Active" without an active client
- Removes ~140 LOC of dead code across 3 files
- Zero impact on headless-AI users — ADR-019/020 paths unchanged
- No new architecture to explain — we are *restoring* upstream's own decisions, not inventing alternatives

### Negative

- Users without `claude` CLI on PATH get no auto-start — defensible because the daemon cannot do anything useful for them anyway
- ADR-059 Phase 4 "single writer via IPC" is formally abandoned — it was never shipped in production, but the architecture document implied it would be
- Requires touching `auto-memory-hook.mjs` in both fork and patch repo copies (keep in sync)

### Trade-offs

- We could delete the daemon entirely. Rejected: breaks 1387 LOC of upstream headless-AI investment and the `runtime/headless.ts` CI path.
- We could expand the daemon to host memory ops. Rejected: directly contradicts ADR-050, no version negotiation, silent fallback violates ADR-0082, zero adoption of the existing IPC surface.

## Alternatives Considered

### Option A: Delete the daemon entirely

Remove `daemon` command + worker scheduler + `HeadlessWorkerExecutor` + PID/state/socket files. Move `consolidate` to a session-end hook. Delete ADR-014/019/020 from upstream's design (would require upstream PR and ADR supersedure).

**Rejected**: Breaks `--headless` mode, breaks RVF appliance mode (ADR-058), deletes 1387 LOC of upstream work we have no right to discard unilaterally. ADR-014 and ADR-019 are still in force upstream.

### Option B: Wire the IPC server (Strategist proposal from 2026-04-15 hive)

Wire `memory-router.ts` to try `DaemonIPCClient.store/search` when the socket is up. Add `mcp.exec` IPC method. Move hook fan-out into daemon. Estimated 500-700 LOC.

**Rejected**: Directly contradicts ADR-050. The strategist proposed this under the assumption the daemon SHOULD be in the hot path; ADR-050 (which predates the proposal and the strategist did not consider) already decided the opposite. Any such expansion would require a new ADR that supersedes ADR-050, with data showing the file-based path has become the bottleneck. That data does not exist today.

### Option C: Status quo — keep dead code, don't wire auto-start

Leave `DaemonIPCClient`, the probe, the misleading status lines. Don't wire SessionStart. Don't detect capability.

**Rejected**: 95 LOC of dead code with misleading status lines is not neutral. Every future maintainer will waste time understanding why `DaemonIPCClient` exists with no callers. The misleading `"IPC Active"` print causes user confusion (verified — previous session's perf analyst was initially led to investigate daemon-IPC as a memory optimization path because of it).

### Option D (chosen): Scoped scheduler + capability-gated auto-start + dead code removal

~120 net LOC across 3 packages. No new architecture. Restores upstream's own stated design. Aligns with both ADR-014 (daemon exists as scheduler) and ADR-050 (no daemon in hot path).

## Implementation Results (2026-04-15)

**Unit tests**: 2615 pass, 0 fail
- `adr0088-dead-code-removal.test.mjs` — 17 tests, all pass
- `adr0088-capability-detection.test.mjs` — 15 tests, all pass
- `adr0088-init-conditional-wiring.test.mjs` — 14 tests, all pass
- `adr0084-router-phase3.test.mjs` — updated stale assertion to verify
  `memory.list` IPC handler is now ABSENT (superseded by ADR-0088)

**Acceptance tests**: **242/242 pass** (verified across 4 runs after
flake fixes)
- All 5 ADR-0088 acceptance checks pass consistently
- Retained ADR-0059 Phase 4 checks (socket-exists, ipc-probe, ipc-fallback) pass
- Removed stale ADR-0059 Phase 4 checks (store, search, count) — they tested
  handlers that no longer exist per ADR-0088 §Decision item 2

**Pre-existing flakes surfaced and root-cause fixed** while validating
ADR-0088 (commit `3ecc509`):

- `adr0080-store-init` — 277-317s hang, 1/3 runs failed. **Root cause**:
  the check hardcoded `npx @sparkleideas/cli@latest` instead of
  `$(_cli_cmd)`. Under parallel acceptance load (50+ concurrent checks),
  raw npx queued behind npm's internal lock on a 23GB cache directory;
  every other memory-store check bypassed this via the installed
  symlink at `$TEMP_DIR/node_modules/.bin/cli`. **Fix**: use `_cli_cmd`.
  Runtime: 277-317s → **7.7s** (36x).
- `e2e-0059-feedback` — 1/3 runs failed. **Root cause**: five parallel
  ADR-0059 checks all wrote to the same `$E2E_DIR/.claude-flow/data/
  ranked-context.json` via intelligence.cjs, causing read-during-write
  races. **Fix**: wrap the check body in `_e2e_isolate "0059-feedback"`
  so intelligence.cjs state lives in a private copy.

**Bash arithmetic bugs surfaced and fixed** while debugging the above
(commits `6e0379a`, `bbf78f8`): six acceptance check files used the
anti-pattern `var=$(grep -c 'pat' file 2>/dev/null || echo 0)`. Because
`grep -c` always prints a count (even "0") AND exits 1 when zero
matches, the `|| echo 0` fallback appends a second "0" to the subshell
stdout — producing "0\n0" which any subsequent `[[ $var -ge N ]]`
rejects with a syntax error. Canonical replacement (matching the
existing ADR-0084 convention):

```bash
var=$(grep -c 'pat' file 2>/dev/null)
var=${var:-0}
```

Files fixed: `acceptance-controller-checks.sh`, `acceptance-adr0068-checks.sh`,
`acceptance-adr0071-checks.sh`, `acceptance-adr0085-checks.sh`,
`acceptance-adr0086-checks.sh`, `acceptance-structure-checks.sh`.

**LOC change**: fork −140 / +60 = −80 net. Patch +1046 / −67 across ADR
doc + 3 unit tests + 5 acceptance checks + 1 stale test fix + 2 flake
root-cause fixes + 6 bash-arithmetic fixes.

## Acceptance Criteria

### Unit tests (ruflo-patch — `tests/unit/adr0088-*.test.mjs`)

- `adr0088-dead-code-removal.test.mjs`: Verify `DaemonIPCClient` is absent from published `@sparkleideas/cli` package; verify `tryDaemonIPC` and `ipcCall` are absent from `auto-memory-hook.mjs`; verify `memory.store` / `memory.search` / `memory.count` / `memory.list` / `memory.bulkInsert` method registrations are absent from `worker-daemon.js`
- `adr0088-capability-detection.test.mjs`: Mock `which claude` scenarios, verify correct startup log line is emitted
- `adr0088-init-conditional-wiring.test.mjs`: Mock init in a sandbox with and without `claude` on PATH, verify SessionStart hook is or is not wired

### Acceptance tests (ruflo-patch — `lib/acceptance-adr0088-checks.sh`)

- `check_adr0088_no_ipc_client`: `grep -r 'DaemonIPCClient' "$TEMP_DIR/node_modules/@sparkleideas/cli"` returns zero
- `check_adr0088_status_output`: `cli daemon status` output contains `"AI Mode:"` and does not contain `"IPC Socket: LISTENING"` nor `"Phase 4"`
- `check_adr0088_conditional_init`: `cli init --full` in a sandbox without `claude` on PATH does not add a daemon-start entry to `.claude/settings.json` SessionStart hooks
- `check_adr0088_conditional_init_with_claude`: Same test with a fake `claude` shim on PATH DOES add the daemon-start entry
- `check_adr0088_daemon_still_works`: `cli daemon start --quiet && cli daemon status` still prints health data in local mode without error

Wire both check files via `run_check_bg` + `collect_parallel` per ADR-0079 Tier 3 pattern.

## Related Decisions

### Upstream (respected, not overridden)

- **ADR-014** — *Cross-Platform Workers System*. Daemon is a scheduler. Preserved.
- **ADR-019** — *Headless Runtime Package*. Daemon can run in headless container mode. Preserved.
- **ADR-020** — *Headless Worker Integration*. 9 workers run headless-AI, local mode is degraded-by-design. Preserved.
- **ADR-050** — *Intelligence Loop*. Hot path is file-based, no daemon. **Enforced by this ADR**.
- **ADR-058** — *Self-Contained Ruflo RVF Appliance*. Appliance mode uses the daemon. Preserved.

### Ours

- **ADR-0082** — *Test Integrity, No Fallbacks*. IPC silent fallback (`isAvailable()` swallows errors) is incompatible with this ADR. Dead code removal resolves the violation.
- **ADR-0086** — *Layer 1 Storage Abstraction*. `RvfBackend` is in-process, sole CRUD path. ADR-0088 keeps it that way — memory ops never traverse IPC.

### Formally abandoned

- **ADR-059 Phase 4** (*Single Writer via IPC*). Never shipped. Contradicts ADR-050 which was written later. Formally closed by this ADR; remove the Phase 4 section from ADR-0059 or mark as superseded.

## Ordering

1. **Option 2 (lazy command modules)** — independent 200-400ms cold-start win, no daemon involvement. Ships first to deliver user-visible value.
2. **Dead code deletion** (items 1-5 above) — quick, restores ADR-050 compliance, ~140 LOC removed.
3. **Capability detection + conditional auto-start + honest status output** (items 6-9) — ~20 LOC added.
4. **Acceptance tests wired** — both unit and bash acceptance per ruflo-patch test pyramid.
5. **Stop.** No further daemon work without new data.

## Files Affected

**Fork (`@claude-flow/cli`):**
- `src/services/daemon-ipc.ts` — delete `DaemonIPCClient` class (lines 208-302)
- `src/services/worker-daemon.ts` — remove `memory.*` IPC method registrations (lines 584-611); add capability detection and startup log
- `src/commands/daemon.ts` — update `daemon status` output
- `src/commands/init.ts` / `src/init/settings-generator.ts` — add capability-gated SessionStart wiring
- `.claude/helpers/auto-memory-hook.mjs` — delete `tryDaemonIPC`, `ipcCall`, `"Phase 4"` print

**Patch (`ruflo-patch`):**
- `.claude/helpers/auto-memory-hook.mjs` — delete same helpers in the patch copy
- `tests/unit/adr0088-*.test.mjs` — 3 new test files
- `lib/acceptance-adr0088-checks.sh` — 5 check functions
- `scripts/test-acceptance.sh` — source and wire the new acceptance check file

## References

- upstream: `v3/implementation/adrs/ADR-014-workers-system.md`
- upstream: `v3/implementation/adrs/ADR-019-headless-runtime-package.md`
- upstream: `v3/implementation/adrs/ADR-020-headless-worker-integration.md`
- upstream: `v3/implementation/adrs/ADR-050-intelligence-loop.md`
- 5-agent hive audit (2026-04-15): Queen, archaeologist, integration mapper, strategist, devil's advocate reports
- Prior session perf analysis: `cli --version` and `mcp exec` cold-start path tracing
