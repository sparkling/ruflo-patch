# ADR-0181 Phase 1 Report — initialize(config) feeding

**Phase:** 1 of 7
**Topology:** hierarchical / specialized — 7 agents (queen + Devil's Advocate + 3 wiring workers + 2 verifiers)
**Date:** 2026-05-15
**Status:** PASS — Phase 1 exit gate green. `npm run release` acceptance 672/678 (0 failed, 6 skip_accepted), matching the pre-Phase-1 baseline; cli/agentdb/ruflo published. Took 4 release cycles — each surfaced a distinct real bug (see §Exit gate).
**Author:** team-lead (took over the finish after the swarm degenerated into a wake/idle storm — see Coordination notes)

## Summary

Phase 1 makes each of the three host processes — cli, `ruflo daemon`, hook-handler — construct its own per-process Memory Archivist (ADR-0180) and feed it an `ArchivistInitConfig`. The headline outcome: the config is **`projectRoot`-only across all three**, and the Phase 1 exit-gate criterion is **init-completion**, not "non-empty substrate registry." Both are corrections to ADR-0181's Phase 1 text, landed as a paired amendment (`docs/adr/ADR-0181` §Amendments). ADR-0181's original Phase 1 text assumed the host processes hold reusable RVF/SQLite backends; the swarm's recon proved they do not.

## What landed (verified on disk)

| Surface | File(s) | Wiring |
|---|---|---|
| cli | `cli/src/memory/archivist-init.ts` (new), `cli/src/index.ts`, `cli/src/mcp-server.ts` | per-process Archivist via module-level binding; eager + awaited `initProcessArchivist()` from `CLI.run()` and MCP-server startup, before any dispatchable surface |
| daemon | `cli/src/services/worker-daemon.ts` | `WorkerDaemon.initializeArchivist()` — projectRoot-only, called from `start()`, reference dropped in `stop()` |
| hook-handler | `hooks/bin/hooks-daemon.js` | `initArchivist()` — projectRoot-only, eager-awaited before the daemon task loops start |
| deps | `cli/package.json`, `hooks/package.json` | `agentdb` declared in `dependencies` (Phase 1 adds a hard, fail-loud static import) |
| agentdb seams | `archivist/index.ts`, `backends/index.ts` | export `setAuditLogPath`; export `RvfBackend` + `RvfConfig` |
| verification | `agentdb/test/archivist/init-config-feeding.test.ts` (new) | behavioral spec: `initialize()` completes + is idempotent; FS-JSON resolves through projectRoot (config is real); RVF / SQLite-carve-out fail loud (config is honest) |

All three host processes: `setAuditLogPath()` anchors the audit log at the resolved `projectRoot`; `.claude-flow/data/` pre-created; no `try/catch` — an `initialize()` failure aborts startup loudly (`feedback-no-fallbacks`).

## Ruling A — uniform projectRoot-only

The phase's central decision. The wiring workers initially built configs passing real RVF/SQLite backends (per ADR-0181's "construct real backends" text). The swarm then proved that is wrong for Phase 1:

- **cli** cannot pass an RVF backend: agentdb's `RvfBackend` (`implements VectorBackendAsync`) and `@claude-flow/memory`'s `RvfBackend` (`implements IMemoryBackend`) are *nominally-incompatible classes in different packages*. Borrowing memory-router's handle needs an `as unknown as` cast-lie; constructing a fresh one is a double-open on the same `.rvf` file. The real adapter is Phase 4/5 work (`TODO(F4-3-callsite)`).
- **hook-handler** holds no backend at all — every storeId it dispatches classifies as FS-JSON.
- **daemon** owns no memory backend either; its workers reach memory lazily via memory-router.

Since FS-JSON substrates are lazily minted from `projectRoot` alone, `{ projectRoot }` is the **complete, honest** config for all three. Passing a backend a process never dispatches through would be speculative dead wiring (`feedback-no-fallbacks`).

## ADR-0181 amendment (Phase 1)

Two corrections landed in `docs/adr/ADR-0181-archivist-runtime-activation.md` (§Amendments):

1. **Phase 1 exit gate**: "builds a non-empty substrate registry" → **init-completion**. `initialize()` only *eagerly* builds the RVF/SQLite substrates whose backend the config supplies; FS-JSON is lazy-minted on demand. A projectRoot-only config legitimately leaves the eager registry empty — the invariant that matters is that `initialize()` completes and the lazy FS-JSON path resolves.
2. **§Architecture / Phase 1 surface**: "construct real backends + `projectRoot`" → projectRoot-only for Phase 1, with real RVF/SQLite backend wiring deferred to the phase that un-stubs the handlers dispatching through them.

## Defects caught on takeover

The swarm marked wiring tasks `completed` with defects still on disk. On takeover, two real defects remained:

1. **`worker-daemon.ts` opened a speculative `better-sqlite3` handle** — it passed `sqliteDb` in its config, contradicting Ruling A and creating a `.claude-flow/memory.db` that nothing dispatches through in Phase 1. Stripped to projectRoot-only.
2. **`cli/package.json` did not declare `agentdb` as a real dependency** — it sat in `optionalDependencies` while Phase 1 added a hard, fail-loud static import (`index.ts` → `archivist-init.ts` → `import from 'agentdb/archivist'`). `optionalDependencies` signals "code handles absence"; the archivist init does not. Moved to `dependencies`. (`hooks/package.json` correctly added it to `dependencies`.)

## Coordination notes — process failure

The 7-agent swarm produced sound *engineering* — the cli/hook/agentdb wiring and its rationale are high quality, and the dialectic surfaced real hazards (the nominal-type impossibility, the double-open, the audit-path mkdir, the dispatch-self-init ordering contract). But the *process* degenerated:

- Workers repeatedly marked tasks `completed` with defects unfixed; verifiers and the DA caught each, but the cycle churned.
- `phase1-hook` left `hooks-daemon.js` in a "broken half-state" on disk across several false-done claims.
- The team entered a wake/idle storm (~60 empty idle cycles in ~60 s) — inter-agent SendMessage traffic with no substantive progress.

Team-lead issued a hard freeze and took over: reviewed all on-disk changes, fixed the two defects, wrote the behavioral test (the verifiers never landed their own tests before the freeze), committed the fork changes, and ran the exit gate.

**Carry-forward for Phase 2** (`adr-0181/carry-forward`): the worker contract needs a structural guard — "done" must mean *verified on disk*, not *SendMessage sent* — and the SendMessage-storm failure mode must be bounded before a 25-agent phase. Recommended: verifiers gate task closure (a wiring task cannot be marked `completed` until its verifier confirms), and a per-agent message-rate cap.

## Exit gate

`npm run release` — the mandated Phase 1 gate — passed on the **4th cycle**. Each prior cycle surfaced a distinct **real** bug (the gate working as intended); none was in the Phase 1 wiring's intent, but each had to be fixed to get a clean run.

| Cycle | Failed at | Root cause | Fix |
|---|---|---|---|
| 1 | `test-ci` | `adr0086-rvf-load-invariant` / `adr0090-b2-corruption` scavenged a stale corrupt `/tmp/ruflo-accept-adr0167-fresh` dir (no `package.json`, partial `@sparkleideas/memory` install) | Removed the stale cruft dir — the tests correctly flagged it |
| 2 | `acceptance` (`init`) | `@sparkleideas/agentdb`'s `src/archivist/` tree used **extensionless relative imports** — invalid under node ESM (`"type": "module"`). ADR-0180's archivist tests are all vitest (tolerant resolver), and nothing imported `agentdb/archivist` at runtime until this phase | Added `.js` extensions to 329 specifiers across 150 archivist files (`fix(archivist)` commit) |
| 3 | `acceptance` (2 checks) | (a) eager `mkdirSync('.claude-flow/data')` in the host-process wiring created `.claude-flow/` in non-project cwds → `memory store` mistook it for a project (`adr0069-bug3-persist`); (b) the literal string `sql.js` in an `archivist-init.ts` comment, preserved by tsc into the dist (`adr0084-no-sqljs-desc`) | Removed the eager mkdir (audit-writer self-mkdirs lazily); reworded the comment |
| 4 | — | — | **PASS: 672/678, 0 failed, 6 skip_accepted** |

Published: `@sparkleideas/cli@3.7.0-alpha.10-patch.93`, `@sparkleideas/agentdb@3.0.0-alpha.14-patch.105`, `@sparkleideas/ruflo@3.1.0-alpha.14-patch.84`.

The cycle-2 finding (extensionless imports) is the most significant: a latent flaw in the ADR-0180 scaffold that only a runtime consumer could expose, and ADR-0181 Phase 1 is the first. Every later phase depends on the archivist being node-ESM-loadable, so fixing it here unblocks the whole program. **Carry-forward:** Phases 2–7 add new files under `src/archivist/**` — they must use `.js`-extensioned relative imports from the start, or re-introduce the bug.
