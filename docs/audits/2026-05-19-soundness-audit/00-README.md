# Codebase soundness and completeness audit — executive summary

**Audit ADR**: [ADR-0201](../../adr/ADR-0201-codebase-soundness-completeness-audit-with-runtime-validation.md)
**Date**: 2026-05-19
**Scope**: hooks, controllers, skills, MCP tools + server wiring, daemon, `ruflo init`-installed MCP servers, configuration, test coverage — plus runtime validation against a Verdaccio-installed `@sparkleideas/ruflo@latest` test project.
**Method**: 12 static read-only audit agents + 3 runtime validation agents in private `/tmp/ruflo-audit-*` sandboxes. Per [[feedback-no-fallbacks]] every silent catch was flagged.

---

## Bottom line

The shipped product **passes the happy-path smoke test** (runtime init + MCP stdio probe + 298 tools listable + 3/3 sample calls succeed) **but fails the moment real work begins**:

* Starting `ruflo daemon` immediately disables every memory-writing hook because the daemon's Memory Archivist holds the `.swarm/memory.rvf` lock for its entire lifetime → `RVF error 0x0300: LockHeld` on every `post-edit`/`post-command`/`post-task`/`route`. Exit code 0 hides the failure from caller scripts. **This is the single most important finding in the audit.** (F-13-001 CRITICAL)
* Behind the working surface, two parallel implementations of the **same subsystem** ship side-by-side, with the wrong one wired:
  - Hooks: `@claude-flow/hooks` package (~4,500 LOC) is dead code; the CLI uses `cli/src/mcp-tools/hooks-tools.ts` (4,097 LOC).
  - MCP server: package `mcp/src/server.ts` (with schema-validator, rate-limiter, OAuth, sampling) is bypassed; the user-facing `ruflo mcp start` runs a hand-rolled JSON-RPC stdio loop with no schema validation.
  - Daemon: real `ruflo daemon` family + parallel `process daemon` stub that writes the CLI's own PID to `daemon.pid`, colliding.
* Stubs labeled as real metrics are pervasive — `hooks_session-end`, `hooks_intelligence-reset`, `hooks_explain`, `hooks_pretrain`, `hooks_init`, `hooks_list`, `hooks_build-agents`, `hooks_notify`, `hooks_transfer`, `hooks_post-task`, `hooks_session-restore`, `NightlyLearner.discover`, `SyncCoordinator.resolveConflicts` — all return hardcoded or fabricated payloads.
* The codemod itself has a bug: 20 `.agents/skills/agent-*/SKILL.md` files contain corrupted shell `>$dev$null` from a codemod pass. Pipeline bug in `scripts/codemod.mjs`, not fork bug.

**Soundness**: FAIL. **Completeness**: FAIL.

The audit deliverable is fit-for-purpose (15 findings docs + 1 gap analysis); the production product needs ~30-40 concrete fixes before the advertised capabilities (hooks fire correctly, federation actually federates, daemon services actually work, learning actually learns) deliver real behaviour.

---

## Severity-ranked top findings

### CRITICAL (must fix before any soundness claim)

| # | Where | Issue | Fix lever |
|---|-------|-------|-----------|
| 1 | F-13-001 daemon+hooks runtime | Daemon's Memory Archivist holds RVF lock entire lifetime → every memory-writing hook fails silently after `daemon start` | Release lock between operations or move archivist to a coordinator role |
| 2 | F-03-* hooks | 7 fake-data stubs in `hooks-tools.ts` (intelligence-reset, explain, pretrain, init, list, build-agents, notify) return hardcoded numbers labeled as real metrics | Replace each with real impl or return `_stub: true` honestly |
| 3 | F-02-* hooks | `hooks_session-end` returns hardcoded constants payload (12/10/2/45/23/5) regardless of state | Wire to real session-state |
| 4 | F-02-* hooks | Init-emitted `hook-handler.mjs` has no handlers for `notify`/`post-command`/`pre-edit`/`user-prompt`/`post-tool-failure`/`teammate-idle` — they fall through to a generic `[OK] Hook: <name>` no-op | Add real handlers in init template |
| 5 | F-01-002 hooks | `hooks/src/index.ts:233` `require('./registry/index.js')` under `"type": "module"` ESM — `ReferenceError` at call time, masked by zero callers (in-package, but indicative) | Remove dead `@claude-flow/hooks` package, or convert to `import()` |
| 6 | F-02-* hooks | `allowUnknownFlags: true` global in `parser.ts:555` silently swallows 9 undeclared flags across audit-scope commands (`--swarm-status` is one) | Set `allowUnknownFlags: false` for hook subcommands; declare flags explicitly |
| 7 | F-06-* federation | `SyncCoordinator.resolveConflicts()` is a counting stub — `merge` case is a one-line comment, no data merge | Implement merge or document as not-yet-implemented |
| 8 | F-06-* federation | CRDT primitives (G-Counter, LWW-Register, OR-Set) exported in `types/quic.ts`, **zero callers in production sync path** | Wire to SyncCoordinator OR delete |
| 9 | F-06-* federation | `QUICConnectionPool` + `QUICStreamManager` marked "no production wiring" — operate over simulation half of `QUICConnection` | Wire to real transport or remove |
| 10 | F-06-* federation | `GraphDatabaseAdapter.initialize` silently replaces corrupt DB with fresh empty one — data-integrity loss | Surface error; refuse to start |
| 11 | F-08-001 MCP | HTTP transport server (`@claude-flow/mcp/src/server.ts`) registers only 4 built-in tools — HTTP callers get hollow surface vs stdio's 327 | Register full tool collection in HTTP path too |
| 12 | F-09-* MCP | Two parallel MCP server implementations; user-facing `ruflo mcp start` runs hand-rolled stdio JSON-RPC with no schema validation | Migrate to package server OR remove the package |
| 13 | F-09-* MCP | Protocol-version drift: stdio advertises `'2024-11-05'` string; package advertises `{major:2025, minor:11, patch:25}` object | Align both to single canonical version |
| 14 | F-10-* daemon | `DaemonIPCServer` instantiated, socket binds with 0600, logs "IPC server listening" — zero `registerMethod` callers anywhere → every RPC returns -32601 | Register real handlers or remove the server |
| 15 | F-10-* daemon | Parallel `process daemon` subcommand writes CLI's own PID to `daemon.pid` (collides with real daemon's PID file); status output uses hardcoded green checkmarks | Remove stub OR rename PID file |
| 16 | F-04-001 controllers/memory | `recordOutcome` silently swallows outcomes against deleted patterns | Surface error |
| 17 | F-04-003 controllers/memory | `consolidate()` swallows all fatals into partial reports | Discriminate fatal vs warning per [[feedback-best-effort-must-rethrow-fatals]] |

### HIGH

| # | Where | Issue |
|---|-------|-------|
| H1 | F-04-002 memory | `MemoryConsolidation` divide-by-zero on cold clusters |
| H2 | F-05-* learning | EWC++ Rust impl complete; **not invoked** on the `ruvllm_microlora_adapt` MCP path — per-call adapter skips EWC entirely |
| H3 | F-05-* learning | `NightlyLearner.discover` returns empty `CausalEdge[]` regardless of inputs (broken stub wrapper over real `discoverCausalEdges`) |
| H4 | F-07-* skills | 20 `.agents/skills/agent-*/SKILL.md` files contain codemod-corrupted `>$dev$null` shell — **bug in `scripts/codemod.mjs`** |
| H5 | F-07-* skills | 4 skills reference `.agents/scripts/*.sh` scripts that don't exist |
| H6 | F-04-* memory | `EmbeddingService` falls back to mock embeddings on init failure — direct [[feedback-no-fallbacks]] violation |
| H7 | F-04-* memory | `MemoryController.search()` ignores its VectorBackend entirely |
| H8 | F-02-* hooks | `hooks_transfer` fabricates pattern counts via demo-data fallback when source is empty |
| H9 | F-02-* hooks | `hooks_post-task` synthesizes a fake `trajectoryId` rather than finalizing a real trajectory via `hooks_intelligence_trajectory-end` |
| H10 | F-02-* hooks | Init-emitted `post-task` hardcodes `intelligence.feedback(true)` even when task failed |
| H11 | F-08-002/003/004 MCP | 3 specific tool handlers (neural/github/embeddings) swallow errors and return `success: true` with empty data |
| H12 | F-08-* MCP | 14 of 14 `loadXxxStore()` helpers share identical silent-catch JSON-parse anti-pattern (corruption masked) |
| H13 | F-11-* init | `generateMCPCommands()` still emits the stale `claude-flow` key + `@sparkleideas/cli@latest` binary in manual-setup hint — violates [[feedback-always-npx-for-ruflo]] |
| H14 | F-11-* init | No `@sparkleideas/agentdb` MCP entry despite agentdb being the 5th fork |
| H15 | F-14-* config | `.mcp.json` injects 4 `CLAUDE_FLOW_*` env vars (`MODE/TOPOLOGY/MEMORY_BACKEND/HOOKS_ENABLED`) — **no source reads them** (theatrical config) |
| H16 | F-14-* config | Naming-skew: loader expects `CLAUDE_FLOW_SWARM_TOPOLOGY`+`CLAUDE_FLOW_MEMORY_TYPE`; init emits `CLAUDE_FLOW_TOPOLOGY`+`CLAUDE_FLOW_MEMORY_BACKEND`. Both ignored |
| H17 | F-14-* config | 17 substrate packages bypass Zod-validated `ConfigLoader` and `JSON.parse` `config.json` directly — schema validation never reaches consumers |
| H18 | F-13-* runtime | `hooks route` hangs indefinitely on RVF lock when daemon is running |

### WARN / MEDIUM (selected, not exhaustive — see per-agent files)

* F-01-* hooks: `pre-edit` hardcodes `fileExists: true` without filesystem check.
* F-01-* hooks: `hooks_session-restore` doesn't restore — counts memory keys containing substrings, returns counts as "restored".
* F-02-* hooks: 8 event-level divergences between `.claude-plugin/hooks/hooks.json` and `plugin/hooks/hooks.json`; third manifest `plugins/ruflo-core/hooks/hooks.json` references nonexistent `modify-bash` / `modify-file` commands.
* F-03-* hooks: 8 lazy-loaders with identical silent-catch pattern.
* F-06-* federation: `services/federated-learning.ts` is dead code, zero callers.
* F-06-* federation: `CausalRecall` does single-hop SQL only despite "graph" naming.
* F-06-* federation: ADR-0200's §Confirmation lists agentdb-side `pushOnly`/`pullOnly` integration tests that **do not exist**.
* F-07-* skills: 41 duplicate skill names with divergent content; 3-way duplicate of `sparc-methodology` differs by ~1000 lines between `.agents/skills/` and `.claude/skills/`.
* F-07-* skills: 134 unreferenced `agent-*` skills bypassed by SKILLS_MAP.
* F-08-* MCP: Two adjacent dead-tree MCP server scaffolds (`v3/mcp/` 1112 LOC, `v3/src/infrastructure/mcp/MCPServer.ts` 120 LOC).
* F-09-* MCP: 33 plugin manifests claim "registers the ruflo MCP server" but contain no `mcpServers` field — prose-only.
* F-10-* daemon: status fabricates "NOT INITIALIZED" on any thrown error; no `daemon restart` subcommand.
* F-12-* runtime: `node_modules/.bin/ruflo` resolves to `@sparkleideas/cli` (last-write-wins) not the ADR-0143 wrapper, because both declare the `"ruflo"` bin name. Wrapper bypassed transparently.
* F-12-* runtime: MCP `serverInfo.version` hardcoded `3.0.0` instead of actual package version.
* F-14-* config: USERGUIDE documents 12 env vars (HNSW tuning, autopilot, tool-groups, log-level, security-mode) with **zero source consumers**.
* F-14-* config: Minimal init template omits `controllers/rateLimiter/workers/daemon` sections — defaults silently used.
* F-15-* runtime+tests: No `ruflo skills` CLI subcommand; only `ruflo plugins` (IPFS marketplace).
* F-15-* runtime+tests: Skills surface has **zero acceptance / unit / integration tests**.

### Confirmed prior-recon claims (from killed earlier run)

* HookExecutor architecture dead — confirmed (0 references in dist; 34 `callMCPTool` references).
* hooks/src/index.ts:233 ESM `require` bomb — confirmed in source; not triggered by tested paths because no live callers (latent).
* Plugin hooks JSON diverged — confirmed; 8 event-level divergences.
* `notify --swarm-status` undeclared — confirmed; one of 9.
* `graphAdapter` init catch silently degrades — confirmed in `agentic-flow/agentdb-service.ts:832-836`.
* `DaemonIPCServer` zero handlers — confirmed.

### Refuted prior-recon claims

* `ReasoningBank` line ~530 `success_rate` formula bug — NOT reproduced (SQL evaluates RHS pre-update; online mean math is correct).
* `model-route` always returns `'general-purpose'` — REFUTED (real path uses tiny-dancer-neural; haiku/sonnet/opus heuristic on fallback).
* ESM `require` bug triggered by hook firing — REFUTED in runtime probe (no hook path exercised reaches `addHook`).

---

## Per-surface verdicts

| Surface | Doc | Sound | Complete | Headline finding |
|---------|-----|-------|----------|------------------|
| Pre-execution hooks | [01](01-hooks-pre-lifecycle.md) | FAIL | FAIL | 2 parallel codebases, ESM bomb, stubs, manifest divergence |
| Post-execution hooks | [02](02-hooks-post-lifecycle.md) | FAIL | FAIL | Hardcoded session-end, init-template hook handlers missing |
| Intelligence/routing | [03](03-hooks-intelligence-routing.md) | PARTIAL | FAIL | 7 fake-data stubs alongside real routing core |
| Memory controllers | [04](04-controllers-memory.md) | PARTIAL | PARTIAL | recordOutcome silence, consolidate swallows fatals |
| Learning controllers | [05](05-controllers-learning.md) | PARTIAL | PARTIAL | EWC++ not invoked on per-call path; NightlyLearner stub wrapper |
| Graph/federation | [06](06-controllers-graph-federation.md) | FAIL | FAIL | SyncCoordinator merge stub, CRDTs unwired, QUIC simulated |
| Skills | [07](07-skills.md) | PARTIAL | PARTIAL | Codemod-corrupted SKILL.md files; 41 duplicates |
| MCP tools | [08](08-mcp-tool-implementations.md) | PARTIAL | PASS | 97.6% real; HTTP transport hollow; silent-catch loaders |
| MCP server wiring | [09](09-mcp-server-wiring.md) | FAIL | FAIL | Two parallel servers; user path has no schema validation |
| Daemon | [10](10-daemon.md) | PARTIAL | FAIL | IPC server with zero handlers; PID-file collision stub |
| Init + MCP install | [11](11-init-mcp-installation.md) | PASS | PARTIAL | Wrapper config correct; manual-setup hint stale |
| Config | [14](14-config-soundness.md) | PARTIAL | FAIL | Theatrical env vars, naming-skew, schema bypass |
| Runtime init+MCP | [12](12-runtime-init-and-mcp-server.md) | PASS | PASS | Happy path works; bin name collision quirk |
| Runtime hooks+daemon | [13](13-runtime-hooks-and-daemon.md) | FAIL | FAIL | Daemon RVF lock kills every hook |
| Runtime skills+tests | [15](15-runtime-skills-and-test-coverage.md) | PARTIAL | PARTIAL | No skills CLI; zero skills tests; runtime probe incomplete |

---

## Cross-cutting patterns

1. **Parallel implementations**, wrong one wired:
   - `@claude-flow/hooks` (dead) ↔ `cli/src/mcp-tools/hooks-tools.ts` (live)
   - `@claude-flow/mcp/src/server.ts` (rich, dead at user path) ↔ `cli/src/mcp-server.ts` (hand-rolled, live)
   - `ruflo daemon` (real) ↔ `ruflo process daemon` (stub)
   - HTTP transport (4 tools) ↔ stdio transport (327 tools)
   - `.claude-plugin/hooks/hooks.json` ↔ `plugin/hooks/hooks.json` ↔ `plugins/ruflo-core/hooks/hooks.json`
2. **Silent fallbacks violating [[feedback-no-fallbacks]]** — pervasive across hooks (≥20 sites), controllers (≥6), MCP tools (≥17 loaders + 3 handlers), daemon, init. Failures are masked from caller scripts (exit 0).
3. **Stubs labeled as real metrics** — hardcoded counts/factors/IDs returned as if computed. `Math.random()` used in `hooks_explain`.
4. **Theatrical configuration** — env vars in `.mcp.json` no source reads; USERGUIDE-documented vars no source reads; schema bypassed by 17 substrate packages.
5. **Disagreement between source-of-truth and consumers** — naming-skew on env vars, protocol-version drift on MCP, three-way divergence on hook manifests, prose-only plugin MCP registration.
6. **Latent bugs masked by unreachability** — ESM `require` bomb compiles fine and never throws because no caller wired in; dead packages still in `dist/`.
7. **Confirmation tests promised by ADRs that don't exist** — ADR-0200's agentdb-side `pushOnly`/`pullOnly` tests, ADR-0094 living tracker coverage claims.

---

## Recommended next steps (NOT IMPLEMENTED — audit-only deliverable)

* **Triage tier 1** (15 CRITICAL findings) → file as individual issues / ADR followups. Prioritize F-13-001 (daemon RVF lock) because it makes the daemon+hooks combination useless.
* **Codemod fix** — F-07-H4 `>$dev$null` corruption needs `scripts/codemod.mjs` patch before next `npm run release`.
* **Remove parallel-impl dead code** — delete `@claude-flow/hooks` package OR migrate CLI to it; delete `process daemon` stub OR rename PID file; pick one MCP server.
* **Restore confidence in published behaviour** — current runtime smoke test (12 + 13) is necessary but not sufficient. Add an acceptance check that starts the daemon then fires a hook and asserts the side-effect actually persisted (catches F-13-001 directly).
* **Read [16-gap-analysis.md](16-gap-analysis.md)** for the surfaces this audit did NOT cover — plugins, WASM, neural, security, telemetry, etc.

---

## Audit method

* 15 parallel agents (12 static + 3 runtime) dispatched per ADR-0201.
* Static agents: read-only audit; output only to the dedicated markdown file under this directory.
* Runtime agents: each created a private `/tmp/ruflo-audit-*-$$/` sandbox, `curl`-pinged Verdaccio, `npm install --registry=http://localhost:4873 @sparkleideas/ruflo@latest`, ran `ruflo init`, exercised the slice. `trap` cleanup on exit / error / signal.
* Per [[feedback-inspect-installed-not-dev-nodemodules]] — runtime agents inspected installed sandbox node_modules, never the dev tree.
* No source files were modified outside the audit output directory + ADR-0201.
* No orphan daemon / MCP-server processes remain.

Initial daemon-audit agent died with an API socket error before writing output; relaunched cleanly. Runtime-skills sub-slice A (agent 15) lost its `npm install` call mid-batch and reported sub-slice A incomplete — test-coverage inventory (sub-slice B) completed successfully.

All 15 + 1 README + 1 gap analysis written under `docs/audits/2026-05-19-soundness-audit/`.
