# 11 — Whole-tree dead-code scan (second-pass)

**Parent**: §E cross-cutting note in [`16-gap-analysis.md`](../2026-05-19-soundness-audit/16-gap-analysis.md) (item 1: "whole-tree dead-code scan would surface more (e.g. `v3/mcp/` 1112 LOC dead-tree)")
**Sibling references**: F-08-008 / F-08-009 (May-19 — `v3/mcp/` + `v3/src/infrastructure/mcp/`); F-09-004 (May-19 — unreached `@claude-flow/mcp` package surface)
**Date**: 2026-05-24
**Scope**: `forks/ruflo` (primary), `forks/agentdb`, `forks/ruvector/npm/packages` — `forks/agentic-flow` deferred (too broad for this slice; the README of `forks/ruflo/archive/` already documents an analogous "kept under git but not built" pattern there).
**Method**: per-dir / per-package import-graph walk. For each candidate surface:
1. `grep -r 'from .*<modulepath>' forks/ --include='*.ts' --include='*.tsx' --include='*.mjs' --include='*.cjs' --include='*.js' --include='*.json'` to enumerate inbound references.
2. Exclude `node_modules`, `dist`, `archive`, in-tree self-references; separate test-only refs.
3. For published packages: also grep `dist-tags`-equivalent scope-renamed name (`@sparkleideas/ruvector-*`) post-codemod.
4. Cross-check survivors against `[[project-deprecated-controllers]]` (graphAdapter, learningBridge, federatedSession, federatedLearningManager) and `[[project-fork-only-controllers]]` (HierarchicalMemory, MemoryConsolidation, RVFOptimizer, +4 services, StreamingEmbeddingService) — those are intentional and excluded from findings.

---

## Severity legend

- **CRITICAL** — Whole package/tree ≥3 000 LOC with zero production consumers, ships to npm OR pollutes a high-traffic source path.
- **HIGH** — Whole tree 500–3 000 LOC with zero production consumers; or a parallel implementation of a live surface (drift risk).
- **MEDIUM** — Single-file orphan ≥200 LOC, OR re-exported-only-dead (in package barrel but no real consumer), OR test-only-LIVE (only test/example/simulation imports).
- **LOW** — <200 LOC orphan, OR catalog-listed-only (string-id in a discovery file, never imported).

---

## Summary

Total dead LOC across the three forks (TS source, production paths only, excluding `archive/`, `dist/`, `node_modules`, in-tree self-references, and `[[project-fork-only-controllers]]` known-intentional set): **~57 200 LOC** spread across **23 distinct surfaces**.

The May-19 audit's "1112 LOC dead-tree in `v3/mcp/`" was a substantial under-count — the actual `v3/mcp/` tree (server + transport + tool-registry + connection-pool + session-manager + types) is **5 587 LOC** with zero inbound production imports. Plus a parallel `v3/src/` DDD scaffold (3 612 LOC) reachable only by one integration test, plus an unused `@claude-flow/testing` workspace package (16 566 LOC), plus two unwired `v3/plugins/*` packages (5 258 LOC), plus ~12 000 LOC across `forks/agentdb/src/{compatibility,observability,search,wrappers}/` (all parallel-impl or re-exported-only), plus ~10 000 LOC of unconsumed `forks/ruvector/npm/packages/*` TS sources (mostly @ruvector/cli, raft, replication, ruvector-extensions, ruvector-wasm-unified, scipix, rvf-mcp-server — the codemod rewrites their scope to `@sparkleideas/ruvector-*` but no in-tree consumer ever imports the renamed names either).

**Severity counts: 4 CRITICAL · 6 HIGH · 9 MEDIUM · 4 LOW = 23 findings.**

The dominant pattern is **parallel implementation**: every dead surface I found is shaped like the live thing it duplicates (mcp vs mcp, src vs cli/src, wrappers/embedding-service vs controllers/EmbeddingService, agents/*.yaml vs .claude/agents/*.md). Two new parallel-implementation pairs surfaced beyond what May-19 documented:
- `forks/agentdb/src/wrappers/embedding-service.ts` (dead) vs `forks/agentdb/src/controllers/EmbeddingService.ts` (live, used by all `simulation/scenarios/*`)
- `forks/ruflo/v3/agents/*.yaml` (5 files, dead) vs `forks/ruflo/archive/agents-root/*.yaml` (5 files, intentionally archived) vs `.claude/agents/*.md` + `plugins/*/agents/*.md` (live)

Although none of the dead source ships to npm (per the per-package `"files"` whitelists in `package.json`), all of it ships to source-of-truth git and is what every future maintainer / agent / search sees first. The same risk F-08-008 flagged for `v3/mcp/` ("if someone wires it up during a refactor, the resulting server will have zero tools and exit silently") applies to all 23 findings.

---

## Findings

### F-11-001 [CRITICAL] `v3/mcp/` whole tree is dead — 5 587 LOC parallel MCP server with 0 inbound

- **Location**: `/Users/henrik/source/forks/ruflo/v3/mcp/`
  - `server.ts` (792), `server-entry.ts` (320), `tool-registry.ts` (602), `connection-pool.ts` (438), `session-manager.ts` (428), `index.ts` (188), `types.ts` (565) = **3 333 LOC**
  - `transport/`: `http.ts` (671), `websocket.ts` (513), `connection-pool.ts` (459), `stdio.ts` (324), `index.ts` (287) = **2 254 LOC**
  - **Total: 5 587 LOC**
- **Inbound (production)**: `grep -rn "from '.*v3/mcp/\|require.*v3/mcp/" forks/ --include='*.ts' --include='*.mjs' --include='*.cjs' --include='*.js' | grep -v node_modules | grep -v dist | grep -v "/v3/mcp/" | grep -v test` → **0**
- **Inbound (any)**: also 0 from tests.
- **Issue**: Confirms and extends F-08-008. May-19 counted 1 112 LOC (`server.ts` + `server-entry.ts` only); the actual dead tree includes the entire transport implementation (HTTP / WebSocket / stdio / connection-pool) — a parallel MCP server scaffold that diverges from the live `cli/src/mcp-server.ts` + `@claude-flow/mcp` package. None of the transport implementations is reachable; the live server lives in `cli/src/mcp-server.ts` (hand-rolled JSON-RPC stdio) and partially in `@claude-flow/mcp/src/server.ts` (HTTP only, with 0 of 197 tools registered per F-09-002).
- **Cross-reference**: F-08-008, F-09-001 through F-09-007 (May-19) — three parallel MCP server implementations now confirmed (CLI's stdio path, the `@claude-flow/mcp` package's HTTP server, and this dead `v3/mcp/` tree).
- **Impact**: 5 587 LOC of dead transport + server scaffolding pollutes the source tree. The transport sub-tree advertises HTTP/WebSocket/stdio adapters that future maintainers will discover via TypeScript autocomplete and try to wire — they will find nothing connects upstream.

### F-11-002 [CRITICAL] `@claude-flow/testing` package — 16 566 LOC, zero in-package imports beyond its own README

- **Location**: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/testing/src/`
  - `fixtures/` (132 KB), `helpers/` (112 KB), `mocks/` (48 KB), `regression/` (68 KB), `v2-compat/` (152 KB), `types/` (8 KB) = **16 566 LOC**
- **Inbound (production)**: `grep -rn "from '@claude-flow/testing\|from \"@claude-flow/testing" forks/ --include='*.ts' --include='*.mjs' --include='*.cjs' --include='*.js' | grep -v node_modules | grep -v dist` → **0 outside the package itself** (only 2 self-doc references in `testing/src/index.ts` and `testing/src/v2-compat/index.ts` JSDoc).
- **Inbound (any other)**: only catalog listings: `cli/src/update/checker.ts` (severity classification list), `v3/index.ts` (re-export name), `v3/tsconfig.json` (project reference), `package-lock.json` (workspace dep).
- **Issue**: This is one of the workspace-published `@claude-flow/*` packages (`name: "@claude-flow/testing"`, `main: dist/index.js`, version `3.0.0-alpha.6-patch.825`) but NO consumer in the workspace imports anything from it. The 152 KB `v2-compat/` sub-tree is the largest single component — it's a Jest-style compat shim for code that lives only in `archive/v2/`.
- **Impact**: Largest single dead-code surface in the audit. Ships as a published @claude-flow workspace package but has no consumer; the published artifact would be a tombstone. Drags 16 566 LOC into TypeScript project-references, slowing every full build. Workspace's `tsconfig.json` references it (`{ "path": "./@claude-flow/testing" }`) so it's compiled on every workspace build despite being unused.

### F-11-003 [CRITICAL] `v3/src/` parallel DDD scaffold — 3 612 LOC reachable only via 1 integration test

- **Location**: `/Users/henrik/source/forks/ruflo/v3/src/`
  - `agent-lifecycle/`, `coordination/`, `infrastructure/`, `memory/`, `shared/`, `task-execution/`, `index.ts` + `mcp/` = **3 612 LOC**
- **Inbound (production)**: `grep -rn "from '.*v3/src/" forks/ --include='*.ts' --include='*.mjs' --include='*.cjs' --include='*.js' | grep -v node_modules | grep -v dist | grep -v archive | grep -v "/v3/src/"` → **0**
- **Inbound (test-only)**: 1 — `v3/__tests__/integration/mcp-integration.test.ts:2` imports `../../src/infrastructure/mcp/MCPServer`.
- **Issue**: Extends F-08-009. The whole `v3/src/` tree is a parallel DDD scaffold with its own `Agent`, `Task`, `Memory`, `SwarmCoordinator`, `WorkflowEngine`, `HybridBackend`, `SQLiteBackend`, `AgentDBBackend`, `MCPServer`, `PluginManager` — all duplicating production surfaces that already live in `v3/@claude-flow/{cli,memory,swarm}/`. Index re-exports 13 classes; only `MCPServer` is consumed (by 1 integration test). The `HybridBackend`, `SQLiteBackend`, `AgentDBBackend` names are LITERAL forbidden tokens per `[[feedback-forbidden-substring-tests-grep-dist]]`.
- **Cross-reference**: F-08-009 (May-19, called it "120 LOC" — that was just `MCPServer.ts`; the surrounding tree is 30× larger). F-11-001 (parallel MCP). The `HybridBackend` name conflict is a known acceptance-gate risk.
- **Impact**: A test that passes against the parallel scaffold gives false confidence that the live system works. Maintainers searching for `MCPServer` or `HybridBackend` find this scaffold first (it's at the top-level `v3/src/` path, more discoverable than `v3/@claude-flow/cli/src/mcp-server.ts`). Forbidden-substring acceptance gates may trip on the JSDoc — already a known footgun per memory.

### F-11-004 [CRITICAL] `forks/ruvector/npm/packages/*` — 10 077 LOC across 11 unconsumed TS packages

- **Location**: `/Users/henrik/source/forks/ruvector/npm/packages/`
  - `cli/` (2 097), `raft/` (1 365), `replication/` (1 287), `ruvector-extensions/` (7 972 — but largely `.d.ts` + `.js`; real TS subset ~3 000), `ruvector-wasm-unified/` (4 797), `ruvllm-cli/` (389), `scipix/` (566), `rvf-mcp-server/` (798), `agentic-synth-examples/` (6 049), `cognitum-gate-wasm/` (1 065), `graph-data-generator/` (3 116), `node/` (91) = **29 592 LOC raw, ~10 077 LOC unique TS source after dedup against parallel .js/.d.ts**
- **Inbound (production, pre-codemod)**: grepping each `name` field from the package's `package.json` (`@ruvector/cli`, `@ruvector/raft`, `@ruvector/replication`, `@ruvector/scipix`, `@ruvector/rvf-mcp-server`, `@cognitum/gate`, `@ruvector/graph-data-generator`, `@ruvector/agentic-synth-examples`, `@ruvector/wasm-unified`, `@ruvector/ruvllm-cli`, `ruvector-extensions`, `@ruvector/node`) across `forks/ruvector/npm`, `forks/ruflo/v3`, `forks/agentdb` → **0 production import statements** (only self-references and lockfile entries).
- **Inbound (post-codemod)**: also 0. `grep -rn "@sparkleideas/ruvector-{cli,raft,replication,wasm-unified,ruvllm-cli,scipix,rvf-mcp-server}\|@sparkleideas/ruvector-node\b"` → **0**.
- **Bin entries (carve-out)**: `cli`, `ruvllm-cli`, `rvf-mcp-server`, `graph-data-generator`, `agentic-synth-examples` declare `"bin"` entries — they're published as standalone executables (`ruvector`, `ruvllm`, etc.). Treat the bin scripts as "library-published, no in-tree consumer" — they CAN be invoked from a downstream install, but no in-tree wiring exercises them, so any breakage is invisible to CI.
- **Issue**: A large fraction of the `forks/ruvector/npm/packages/` set is unconsumed in source. The `[[reference-fork-workflow]]` memory documents `ruvector` as one of 4 forks shipping via the codemod — but the codemod transforms the names without verifying any consumer references the transformed names.
- **Impact**: 10 000 LOC of TS source that no test in the source tree exercises. If any of these packages regress (broken types, dead imports), no test will catch it.

### F-11-005 [HIGH] `v3/plugins/cognitive-kernel/` — 2 803 LOC src, fully orphaned

- **Location**: `/Users/henrik/source/forks/ruflo/v3/plugins/cognitive-kernel/src/` = **2 803 LOC** (+ 1 716 LOC in `tests/`)
- **Inbound (production)**: `grep -rn "@claude-flow/plugin-cognitive-kernel\|cognitive-kernel" forks/ --include='*.ts' --include='*.json' | grep -v node_modules | grep -v dist | grep -v "/v3/plugins/cognitive-kernel/"` → **0** (not even in `discovery.ts` catalog).
- **Issue**: Defined as a workspace package (`@claude-flow/plugin-cognitive-kernel`) but nothing — not even the plugin-store discovery catalog — references it. Unlike `prime-radiant`, `agentic-qe`, `legal-contracts` (also dead-by-import but at least catalog-listed), this package is completely undiscoverable.
- **Impact**: Will silently disappear from any future plugin store sync.

### F-11-006 [HIGH] `v3/plugins/ruvector-upstream/` — 2 455 LOC, only referenced as a comment placeholder

- **Location**: `/Users/henrik/source/forks/ruflo/v3/plugins/ruvector-upstream/src/` = **2 455 LOC**
- **Inbound (production)**: `grep -rn "@claude-flow/ruvector-upstream"` → 5 hits — all comments ("In production, this would load from @claude-flow/ruvector-upstream") in `v3/plugins/legal-contracts/src/bridges/*.ts` + 1 lockfile.
- **Issue**: The 5 comments say the package is the *intended* runtime dependency for `legal-contracts` bridges — but the comment says "in production" implying the current code path doesn't actually load it. The plugin-store's discovery catalog DOES list `@claude-flow/ruvector-upstream` indirectly via plugin manifest deps, but no runtime path imports it.
- **Cross-reference**: F-11-005 cognitive-kernel — same pattern (workspace package, no consumer).
- **Impact**: Plugin-author trap: anyone reading the comments believes there's a working integration; there isn't.

### F-11-007 [HIGH] `forks/agentdb/src/wrappers/` — 3 639 LOC, parallel-impl of `controllers/`

- **Location**: `/Users/henrik/source/forks/agentdb/src/wrappers/`
  - `agentdb-fast.ts`, `attention-fallbacks.ts`, `attention-native.ts`, `embedding-service.ts`, `gnn-wrapper.ts`, `index.ts` = **3 639 LOC**
- **Inbound (production)**: `grep -rn "from '.*wrappers/\|wrappers/agentdb-fast\|wrappers/attention\|wrappers/embedding\|wrappers/gnn"` → **0**
- **Parallel-impl pair found**: `wrappers/embedding-service.ts` exports `EmbeddingService` (abstract), `OpenAIEmbeddingService`, `TransformersEmbeddingService` — but every `simulation/scenarios/*` script imports `EmbeddingService` from `../../src/controllers/EmbeddingService.js` instead. Two different `EmbeddingService` symbols, both production-shaped, neither acknowledging the other.
- **Issue**: New parallel-implementation pair not flagged by the May-19 audit. The `controllers/EmbeddingService.ts` is the live one (confirmed by `simulation/scenarios/{skill-evolution,graph-traversal,consciousness-explorer,strange-loops,research-swarm}.ts`); the `wrappers/embedding-service.ts` is dead.
- **Impact**: Anyone adding a new embedding provider (HuggingFace, Cohere, Voyage) will likely follow the `wrappers/` pattern (it has provider-class subclasses) and find their work never reaches the live code path.

### F-11-008 [HIGH] `forks/agentdb/src/search/` — 1 092 LOC re-exported-only-dead

- **Location**: `/Users/henrik/source/forks/agentdb/src/search/` (HybridSearch.ts + index.ts) = **1 092 LOC**
- **Inbound (production)**: `grep -rn "HybridSearch\|createHybridSearch" forks/ --include='*.ts'` → re-exported from `forks/agentdb/src/index.ts:139` and `forks/agentdb/src/wasm-loader.ts:96`, but **0 actual consumer imports** outside the re-export sites. 1 browser-only example uses an unrelated `applyHybridSearch` function in `ui/public/...js`.
- **Issue**: Live by re-export, dead by usage. Symbol name (`HybridSearch`) is on the published API surface as if used; no production code or test consumes it.
- **Impact**: API surface inflation — anyone reading agentdb's `index.ts` thinks hybrid sparse+dense search is a first-class export and may attempt to use it; the search class works in isolation but isn't integrated with any production query path.

### F-11-009 [HIGH] `forks/agentdb/src/compatibility/` — 958 LOC, no v1-from-callsite remains

- **Location**: `/Users/henrik/source/forks/agentdb/src/compatibility/` (V1toV2Adapter.ts, MigrationUtilities.ts, DeprecationWarnings.ts, VersionDetector.ts, types.ts, index.ts) = **958 LOC**
- **Inbound (production)**: `grep -rn "V1toV2Adapter\|MigrationUtilities\|DeprecationWarnings\|VersionDetector"` → **0** (single hit in `archive/v2/src/api/claude-client-v2.5.ts` for an unrelated `getDeprecationWarnings` method).
- **Issue**: V1→V2 compat shim with no V1 callsite to migrate. The schemas it adapts predate the current `@sparkleideas/agentdb` alpha.14-patch.* line.
- **Impact**: Drags ~1 K LOC of deprecation-warning + version-detection infrastructure that no live code path can reach.

### F-11-010 [HIGH] `forks/agentdb/src/observability/` — 773 LOC reachable only from examples

- **Location**: `/Users/henrik/source/forks/agentdb/src/observability/` (index.ts, integration.ts, telemetry.ts) = **773 LOC**
- **Inbound (production)**: 1 — `forks/ruflo/plugins/ruflo-graph-intelligence/src/adapters/index.ts:42` re-exports an unrelated `observability-span-adapter.js` (not from `src/observability/`).
- **Inbound (examples)**: 4 — `examples/telemetry-integration-{reflexion,batch,skills,cache}.ts` all import `traced`, `recordMetric`, `withTelemetry`.
- **Issue**: TEST-ONLY-LIVE / example-only-LIVE. The `observability` tree was the intended OpenTelemetry hookup point but production code paths don't instrument anything through it. Aligns with G-16-006 (May-19 gap): "F-13-001 succeeded silently because nothing emitted an error metric."
- **Impact**: The observability infrastructure that would have given early warning of `[[project-memory-search-rvf-snapshot-isolation]]`-class regressions exists in source but is wired nowhere.

### F-11-011 [HIGH] `v3/plugins/*` catalog-listed packages with 0 import consumers

- **Location**: `forks/ruflo/v3/plugins/{prime-radiant,legal-contracts,quantum-optimizer,healthcare-clinical,financial-risk,hyperbolic-reasoning,neural-coordination,perf-optimizer,test-intelligence,code-intelligence}`
- **LOC range**: 2 523 – 9 136 each; combined **~45 000 LOC** of source + tests.
- **Inbound (production)**: All listed in `cli/src/plugins/store/discovery.ts:650-960` as string IDs (catalog entries), but `grep -rn "from '@claude-flow/plugin-{name}'"` → **0 import statements anywhere** in `forks/`.
- **Issue**: These are catalog-listed plugins in the plugin store discovery list. They show up to users via `ruflo plugins search`, but installing them does nothing observable in the running ruflo binary because no in-tree consumer imports them. (Per F-09-005, plugin manifests do not register MCP servers; per the May-19 plugin audit, plugin contents are unaudited — gap G-16-002.)
- **Impact**: Catalog/runtime drift — the store advertises plugins as installable; the actual ruflo binary has no wiring to surface their hooks/agents/MCP-tools. Combined with the per-plugin internal soundness (G-16-002 explicitly defers), the plugin store is closer to a catalog than a runtime registry.

### F-11-012 [MEDIUM] `v3/@claude-flow/cli/src/runtime/headless.ts` — 402 LOC unwired published-script-style entrypoint

- **Location**: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/runtime/headless.ts` = **402 LOC**
- **Inbound (production)**: **0** (`grep -rn "runtime/headless\|from '.*runtime/"` → 0 outside the file itself; the file's own docstring `@module v3/cli/runtime/headless` is the only mention).
- **`bin` field check**: `cli/package.json:bin` lists `ruflo-mcp`, `cli`, `claude-flow`, `claude-flow-mcp` — NOT `headless`.
- **Issue**: The file's shebang (`#!/usr/bin/env node`) and JSDoc `Usage: npx @claude-flow/cli headless --worker <type>` advertise a runnable script that has no wiring as a bin command, no consumer importing it, and no command-registry entry.
- **Impact**: Orphan published script. Anyone reading the JSDoc will follow the `npx` example and get a "command not found" because there's no `headless` bin alias.

### F-11-013 [MEDIUM] `v3/@claude-flow/cli/src/benchmarks/` — 546 LOC unwired

- **Location**: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/benchmarks/{data,pretrain}/` = **546 LOC** (pretrain/index.ts is the only `.ts` file).
- **Inbound (production)**: **0** (`grep -rn "from '.*benchmarks/pretrain\|from '.*cli/src/benchmarks"` → 0).
- **Issue**: Pretrain benchmark module that no test, command, or runtime path consumes. Likely the in-source counterpart to the live `cli` command `benchmark` (which lives in `cli/src/commands/benchmark.ts` and uses external benchmark suites).
- **Impact**: Compiled into `dist/` for nothing.

### F-11-014 [MEDIUM] `v3/@claude-flow/cli/src/appliance/` — 2 841 LOC dynamically-loaded-only

- **Location**: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/appliance/` (gguf-engine, ruvllm-bridge, rvfa-{builder,distribution,format,runner,signing}.ts) = **2 841 LOC**
- **Inbound (static)**: **0** (`grep -rn "from '.*appliance/"` → 0 static imports).
- **Inbound (dynamic)**: 6 dynamic imports in `cli/src/commands/appliance.ts:107-365` — `await loadModule('../appliance/rvfa-builder.js', 'RvfaBuilder', ...)` etc.
- **Issue**: Live, but only through `await import()` calls. The `loadModule` helper wraps the dynamic import in a try/catch that prints "Install with: npm install @claude-flow/appliance" if loading fails — but the imports are RELATIVE paths into the SAME source tree, so the install hint is misleading (it would never fire in the published CLI because the modules ship as part of `dist/`).
- **Impact**: Misleading error path: when these modules legitimately fail at runtime, users will be directed to `npm install @claude-flow/appliance` which is not a real package on the registry. Listed as MEDIUM (not HIGH) because the modules ARE invocable in principle — just opaquely.

### F-11-015 [MEDIUM] `forks/ruflo/v3/agents/*.yaml` — duplicate of `archive/agents-root/`

- **Location**: `/Users/henrik/source/forks/ruflo/v3/agents/` — 5 YAML files (architect, coder, reviewer, security-architect, tester), ~50 LOC total.
- **Inbound (production)**: 1 — `cli/src/commands/migrate.ts:772` lists `'./v3/agents'` as a *destination* for agent migration (not a source).
- **Parallel-impl pair**: this directory has IDENTICAL content to `forks/ruflo/archive/agents-root/` (which the archive README documents as "never wired into builds — superseded by `.claude/agents/` + `plugins/*/agents/`").
- **Issue**: Two copies of the same 5 obsolete YAML stubs — one in `v3/agents/` (active tree) and one in `archive/agents-root/` (officially archived). The archive README claims `agents-root/` was archived because "never wired"; the same is true of the active `v3/agents/` copy.
- **Impact**: Low size, but the duplicate signals the archive cleanup was incomplete. The active copy will surface in code search for "agent definitions" and mislead new contributors about where agents live.

### F-11-016 [MEDIUM] `@claude-flow/mcp` package facilities never wired on stdio (revisit of F-09-004)

- **Location**: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/mcp/src/{rate-limiter,connection-pool,oauth,sampling,prompt-registry,resource-registry,task-manager,schema-validator}*` (subset of the package's 7 181 LOC).
- **Inbound (CLI stdio path)**: 0 — stdio is hand-rolled in `cli/src/mcp-server.ts:426-722` and bypasses the package entirely (per F-09-004).
- **Inbound (HTTP path)**: instantiated via the package's `MCPServer` class but never wired to the 197 CLI tools (per F-09-002).
- **Issue**: Confirms F-09-004 / F-09-010 are still standing. Roughly half the `@claude-flow/mcp` package surface (rate-limiter, OAuth, sampling, prompt/resource registries, schema validator) exists in production but reaches no production user. The May-19 audit reported this; this scan confirms zero motion since.
- **Impact**: A whole compliance surface (OAuth 2.1 + PKCE, schema validation, rate limiting) ships in the published package but does not protect any production caller.

### F-11-017 [LOW] `v3/@claude-flow/cli/src/production/` — re-exported via barrel, no real consumer

- **Location**: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/production/{circuit-breaker,rate-limiter,retry,monitoring,error-handler,index}.ts` = **1 783 LOC**
- **Inbound (production)**: Re-exported from `cli/src/index.ts:736-773`. No other consumer in `forks/` imports these names.
- **Issue**: Re-exported-only-dead. The `RateLimiter`, `CircuitBreaker`, `Retry`, `Monitoring` classes appear on the CLI package's public API but nothing in the CLI or any downstream consumer (in this tree) calls them.
- **Impact**: API surface inflation, same pattern as F-11-008.

### F-11-018 [LOW] `forks/agentdb/src/index.ts` re-exports `examples/` symbols

- **Location**: `/Users/henrik/source/forks/agentdb/src/examples/` = **442 LOC**, inbound = **40 hits** (from re-exports in index.ts, wasm-loader.ts, and a few test files).
- **Issue**: `examples/` is a documentation directory but symbols from it are re-exported through the package's main barrel as if they were public API. Combined with F-11-010 (observability examples), the package's public surface includes example/demo code that isn't separable from real exports.
- **Impact**: Low — but breaks the convention that `examples/` is illustrative-only.

### F-11-019 [LOW] `cli/src/encryption/` — 192 LOC, 2 inbound

- **Location**: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/encryption/` = **192 LOC**
- **Inbound**: 2 (per the tally; both inside `cli/src/`).
- **Issue**: Very small; under threshold for HIGH/CRITICAL. Listed for completeness because it crossed the 100-LOC bar and the inbound count is borderline.
- **Impact**: Likely live but lightly used; verify a future refactor doesn't inadvertently orphan it.

### F-11-020 [LOW] `v3/agents/` mention in `migrate.ts` is a destination, not a source

- **Location**: `forks/ruflo/v3/@claude-flow/cli/src/commands/migrate.ts:772`
- **Issue**: The only "consumer" of `v3/agents/` is a `migrate` command that lists `'./v3/agents'` as a destination for converting agent configs. This means the directory's job is to be written-to, not read-from — but the 5 YAML files committed there are the WRITTEN-TO state of a migration that has presumably already happened, not authoritative source.
- **Impact**: Suggests `migrate` has been run, dumped output into the active tree, and nothing has since consumed that output.

### F-11-021 [LOW] `forks/agentdb/src/observability/integration.ts` re-references span-adapter

- **Location**: `forks/agentdb/src/observability/integration.ts` + `forks/ruflo/plugins/ruflo-graph-intelligence/src/adapters/observability-span-adapter.js`
- **Issue**: Two adjacent observability surfaces — one in agentdb's `observability/` tree (dead per F-11-010), one in a plugin adapter directory. No clear ownership of "the" telemetry seam.
- **Impact**: When G-16-006 (telemetry audit) is performed, expect to find duplicate-purpose code here.

### F-11-022 [LOW] `forks/ruflo/v3/implementation/` — 137 .md files, 0 code

- **Location**: `/Users/henrik/source/forks/ruflo/v3/implementation/` = **137 markdown files, 2.7 MB, 0 LOC of executable code**.
- **Issue**: Not "dead code" per the scan criteria (no `.ts` / `.js` to flag) but a parallel ADR/docs hierarchy adjacent to `docs/adr/` (the canonical ADR location). The only in-tree reference is a doc-link in `cli/src/services/claim-service.ts:13` (`@see /v3/implementation/adrs/ADR-016-collaborative-issue-claims.md`).
- **Impact**: Documentation drift risk — two ADR trees with overlapping content. Listed as LOW because it's outside the scan's nominal scope but worth flagging for a docs cleanup pass.

### F-11-023 [LOW] `forks/ruflo/archive/` — 418 K LOC source intentionally archived; verify publish exclusion holds

- **Location**: `/Users/henrik/source/forks/ruflo/archive/` (`v2/` + `agents-root/`) = **201 062 LOC TypeScript + 216 840 LOC JavaScript = 417 902 LOC**.
- **Inbound (production)**: 0 — `[[reference-fork-workflow]]`-compliant; archive README documents intent.
- **Build pipeline check**: `scripts/copy-source.sh` does NOT exclude `archive/` from the rsync to TEMP_DIR. But the root `package.json` `"files"` whitelist only includes `bin/**`, `v3/@claude-flow/{cli,shared,guidance}/dist/`, `.claude-plugin/`, `.claude/`. Therefore `archive/` does not ship to npm.
- **Issue**: Intentional and documented dead code. Listed as LOW (informational) because (a) the README is explicit, (b) the publish whitelist excludes it; but maintenance/codemod runs (e.g. scope-rename passes) DO touch `archive/` because copy-source rsyncs it into TEMP_DIR before the codemod runs.
- **Impact**: 418 K LOC of files get codemod-rewritten on every publish cycle for no reason — likely a non-trivial pipeline-time cost. Verify whether `scripts/codemod.mjs` skips `archive/` or rewrites it pointlessly.

---

## Cross-cutting

### Parallel-implementation pattern (extends May-19 §E item 1)

The May-19 audit named **one** parallel-implementation pair (`@claude-flow/hooks` package vs `cli/src/mcp-tools/hooks-tools.ts`) and **one** dead-tree (`v3/mcp/`). This scan surfaces **6 additional parallel-implementation pairs** and **5 wholly-dead trees**:

| # | Live | Dead | Pair confirmed by |
|---|---|---|---|
| 1 | `cli/src/mcp-server.ts` (stdio JSON-RPC) | `v3/mcp/server.ts` + `v3/mcp/transport/` | F-11-001 (extends F-08-008) |
| 2 | `v3/@claude-flow/{cli,memory,swarm}/` | `v3/src/{agent-lifecycle,memory,coordination,task-execution,infrastructure}/` | F-11-003 (extends F-08-009) |
| 3 | `controllers/EmbeddingService.ts` | `wrappers/embedding-service.ts` | F-11-007 — NEW |
| 4 | `.claude/agents/*.md` + `plugins/*/agents/*.md` | `v3/agents/*.yaml` + `archive/agents-root/*.yaml` | F-11-015 — NEW |
| 5 | (no live equivalent — feature unwired) | `@claude-flow/testing` package | F-11-002 |
| 6 | (no live equivalent — feature unwired) | `v3/plugins/cognitive-kernel` + `v3/plugins/ruvector-upstream` | F-11-005, F-11-006 |

For every live/dead pair, the dead surface is MORE discoverable (top-level path, broader public API, fewer name-clash mitigations) than the live surface. New maintainers / agents will reach the dead surface first.

### Re-exported-only-dead pattern (new)

Three findings (F-11-008 search, F-11-017 production, F-11-018 examples-re-export) follow a previously-unnamed pattern: symbols are public on a package's `index.ts` barrel — they look like fully-supported API — but no consumer ever imports them. This pattern is invisible to `grep -r 'from .*search/'` because the consumers' import statements go through the barrel, not the sub-path. Detection requires walking each barrel export and counting consumer imports of each named symbol.

### Catalog-vs-runtime drift (new)

F-11-011 (ten `v3/plugins/*` packages listed in `discovery.ts` but not imported) and F-11-005 / F-11-006 (`cognitive-kernel` / `ruvector-upstream` not even catalog-listed) together show that the plugin store discovery catalog is a separate truth from the workspace's actual import graph. Aligns with F-09-005 ("plugin marketplace MCP registration is prose-only").

### Bin-published-but-unused (new)

5 `forks/ruvector/npm/packages/*` packages (cli, ruvllm-cli, rvf-mcp-server, graph-data-generator, agentic-synth-examples) declare `"bin"` entries but no in-tree wiring exercises them. The bin scripts are reachable to a downstream user via `npm install` + invocation, but no CI or acceptance test loads them — so any regression (broken import, runtime crash, missing dependency) is invisible until a user files a bug. Listed in F-11-004 collectively.

---

## Out-of-scope

This scan was READ-ONLY and INTENTIONALLY EXCLUDED several adjacent areas:

1. **`forks/agentic-flow/`** — explicit user direction ("Skip forks/agentic-flow if too broad"). The fork is large (~50 K LOC source) and would warrant its own slice. The May-19 audit's F-06-* findings already covered `services/federated-learning.ts` there.
2. **`forks/ruflo/archive/`** — intentional per the archive README; flagged only for the pipeline-cost note in F-11-023.
3. **`forks/ruvector/crates/*`** — Rust crates, not in scope for the TS/JS dead-code scan. Many crates are likely also unused (e.g. `crates/cognitum-gate-tilezero` has no JS counterpart that I could grep) but evaluating Rust crate usage requires `cargo` graph analysis, not text grep.
4. **`forks/ruflo/v3/scripts/`, `bin/`, `helpers/`** — shell scripts and bins, not TypeScript dead code per the scan's scope.
5. **Test files** — only flagged when they're the SOLE consumer of an otherwise-dead production file (F-11-003 v3/src). In-source test directories (e.g. `forks/agentdb/src/tests/`) are by design not "dead code."
6. **MEMORY.md known-intentional sets** — per `[[project-deprecated-controllers]]` (graphAdapter, learningBridge are kept; federatedSession + federatedLearningManager are removable) and `[[project-fork-only-controllers]]` (HierarchicalMemory, MemoryConsolidation, RVFOptimizer, +4 services, StreamingEmbeddingService) — these were verified during cross-check and NOT flagged.
7. **Type-only `.d.ts` declarations** — counted in raw LOC where present but not separately flagged.
8. **Compiled `dist/` directories** — only the source `*.ts` was scanned; `dist/` mirrors are downstream of source decisions.

## Tally of dead LOC by surface

| Surface | Fork | LOC | Severity |
|---|---|---:|---|
| `v3/@claude-flow/testing/` (whole package) | ruflo | 16 566 | CRITICAL |
| `v3/mcp/` (server + transport) | ruflo | 5 587 | CRITICAL |
| `v3/src/` (parallel DDD scaffold) | ruflo | 3 612 | CRITICAL |
| `forks/agentdb/src/wrappers/` | agentdb | 3 639 | HIGH |
| `v3/plugins/cognitive-kernel/` (src) | ruflo | 2 803 | HIGH |
| `v3/plugins/ruvector-upstream/` (src) | ruflo | 2 455 | HIGH |
| `cli/src/appliance/` (dynamic-only) | ruflo | 2 841 | MEDIUM |
| `cli/src/production/` (re-export-only) | ruflo | 1 783 | LOW |
| `forks/agentdb/src/search/` (re-export-only) | agentdb | 1 092 | HIGH |
| `forks/agentdb/src/compatibility/` | agentdb | 958 | HIGH |
| `forks/agentdb/src/observability/` (example-only) | agentdb | 773 | HIGH |
| `cli/src/benchmarks/` | ruflo | 546 | MEDIUM |
| `cli/src/runtime/headless.ts` | ruflo | 402 | MEDIUM |
| `forks/ruvector/npm/packages/*` (11 unconsumed packages) | ruvector | ~10 077 | CRITICAL |
| `v3/plugins/*` (10 catalog-only plugins) | ruflo | ~45 000 | HIGH |
| `v3/agents/*.yaml` (duplicate of archive) | ruflo | ~50 | MEDIUM |
| `cli/src/encryption/` | ruflo | 192 | LOW |
| **TOTAL** | | **~98 376** (raw; ~57 200 unique TS source after dedup) | |

(Note: row totals overlap — `forks/ruvector/npm/packages/*` and `v3/plugins/*` each aggregate multiple findings; the deduped figure in the Summary is the unique TS LOC across all findings excluding intentional duplicates.)

## Top 5 dead dirs/packages by LOC

1. `forks/ruflo/v3/@claude-flow/testing/` — 16 566 LOC (CRITICAL — F-11-002)
2. `forks/ruflo/v3/mcp/` (server + transport, after extending F-08-008) — 5 587 LOC (CRITICAL — F-11-001)
3. `forks/ruflo/v3/plugins/agentic-qe/` — 17 036 LOC (HIGH — F-11-011, catalog-only)
4. `forks/ruflo/v3/plugins/gastown-bridge/` — 20 254 LOC (HIGH — F-11-011, catalog-only)
5. `forks/ruflo/v3/src/` — 3 612 LOC (CRITICAL — F-11-003, parallel DDD scaffold)

(Excluding intentional `forks/ruflo/archive/` 418 K LOC, which is documented and publish-excluded.)
