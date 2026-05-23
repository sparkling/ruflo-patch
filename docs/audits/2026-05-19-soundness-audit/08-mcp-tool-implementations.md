# 08 — MCP tool implementations (server-side handler quality) audit

## Summary

- Tools audited (static): 327 MCP tool entries across 28 category files in
  `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/` (≈28,612 LOC). Sampled 60+
  handlers in depth across all 28 active categories; rolled up the remainder.
- Canonical registration: confirmed. `@claude-flow/cli/src/mcp-client.ts:81`
  contains exactly one `registerTools([...])` call wiring 30 tool collections
  into a single `TOOL_REGISTRY: Map<string, MCPTool>` (line 71). Zero duplicate
  tool names across the whole surface.
- Findings: 14 total / 3 critical / 7 warning / 4 note
- Soundness verdict: **PARTIAL PASS** — the live surface is well-architected
  (typed `archivist.dispatch`, validation, atomic FS writes, named errors), but
  three families ship handlers that silently swallow errors and return
  `success: true` with empty data (F-08-002, F-08-003, F-08-004), and one
  category-banner (coordination/DAA "LOCAL STATE MANAGEMENT") plus three
  explicitly-flagged `_stub: true` returns in `performance-tools.ts` confirm
  the cli surface does not implement what its names promise (F-08-006,
  F-08-007).
- Completeness verdict: **PARTIAL PASS** — every category from the slice
  brief is registered and dispatches to a real backend, with three exceptions:
  (a) the `@claude-flow/mcp` package (`v3/@claude-flow/mcp/src/server.ts`,
  1134 LOC) registers only 4 built-in tools (`system/info`, `system/health`,
  `system/metrics`, `tools/list-detailed`) and is the HTTP-transport server
  the cli boots via `import('@claude-flow/mcp')` — it does NOT contain the
  30 categories, so HTTP callers see a dramatically different tool surface
  (F-08-001); (b) `v3/mcp/server.ts` (792 LOC) + `v3/mcp/server-entry.ts`
  (320 LOC) reference a `./tools/index.js` path that does not exist —
  dead-code (F-08-008); (c) `v3/src/infrastructure/mcp/MCPServer.ts`
  (120 LOC) is parallel scaffolding only imported by one test
  (F-08-009).
- Bottom line: The CLI's in-process registry (the path `npm run release`
  ships and what plugins and Claude Code actually call via `mcp-client.ts`)
  is sound and complete for **stdio** transport. The HTTP transport path is
  hollow — `@claude-flow/mcp` exposes only 4 tools, not 327. Two adjacent
  dead-tree MCP server scaffolds (`v3/mcp/` and `v3/src/infrastructure/mcp/`)
  add confusion but do not break anything because nothing imports from them.

## Method

- Located all candidate MCP source roots from the slice brief:
  - `forks/ruflo/v3/@claude-flow/mcp/src/server.ts` + `tool-registry.ts`
  - `forks/ruflo/v3/@claude-flow/hooks/src/mcp/index.ts`
  - `forks/ruflo/v3/src/mcp/` (only an `index.ts` re-export)
  - `forks/ruflo/v3/src/infrastructure/mcp/MCPServer.ts` + `tools/`
  - `forks/ruflo/v3/mcp/server.ts` + `server-entry.ts` + `tool-registry.ts`
  - `forks/agentdb/src/archivist/handlers/**` (the real backends most tools
    delegate to via `archivist.dispatch(...)`)
- Traced the actual production wire by grepping for `registerTools(` and
  `TOOL_REGISTRY` (single hit: `cli/src/mcp-client.ts:81`). Verified every
  command in `cli/src/commands/` imports `callMCPTool` from `mcp-client.ts`,
  not from any other `MCPServer` class.
- Per category file:
  - Counted tool entries (`grep -cE "^[[:space:]]*name:[[:space:]]*'"`),
    sampled 1-3 handlers, traced their import chain, and labeled the
    delegation target (archivist dispatch / direct controller / file-only
    state / inline computation / explicit stub).
  - Scanned for the silent-fallback anti-pattern: empty `catch { … return
    { success: true, ... } }` blocks, `try { … } catch { return null }`
    helpers used in critical-path callsites, and `// fall through` comments
    near defaults.
- Cross-checked duplicates (`grep -hoE "name: '..."` → `sort | uniq -d`):
  none.
- Cross-checked schema completeness (`name:` count vs `inputSchema:` count):
  327 names, 299 schemas. The 28-tool delta is accounted for by `guidance-tools.ts`
  using `name:` for both 16 catalog entries and 5 actual tools — a static
  catalog quirk, not a schema gap (verified by manual read).
- Spot-checked lifecycle assumption: `agentdb_session-start` / `-end` ARE
  registered as callable MCP tools and DO have real archivist handlers; the
  CLAUDE.md statement that hooks manage them automatically is about the
  *recommended invocation pattern*, not a no-op handler.

## Per-category roll-up

Categories listed top-to-bottom in the slice brief; "delegation" describes the
handler's actual backend; "real" = handler does meaningful work + delegates to
a controller / dispatch / IPC; "stub" = explicit `_stub: true` or "honest stub"
return without real backend; "missing-schema" = `name:` registered without an
adjacent `inputSchema:` block.

| Category file | Tools | Real | Stub | Missing-schema | Delegation target |
|---|---:|---:|---:|---:|---|
| `agent-tools.ts` | 8 | 8 | 0 | 0 | archivist.dispatch + agent-execute-core (HTTP to Anthropic) |
| `swarm-tools.ts` | 4 | 4 | 0 | 0 | archivist.dispatch + FS-JSON re-read |
| `memory-tools.ts` | 10 | 10 | 0 | 0 | archivist.dispatch (1) + routeMemoryOp (9) |
| `config-tools.ts` | 6 | 6 | 0 | 0 | Inline FS-JSON with shape detection |
| `hooks-tools.ts` | 36 | 33 | 0 | 0 | routeMemoryOp + sona + intelligence (3 placeholder branches per file comment) |
| `task-tools.ts` | 7 | 7 | 0 | 0 | archivist.dispatch (all 7) |
| `session-tools.ts` | 5 | 5 | 0 | 0 | fs-secure + advisory lock (intentionally cli-local per ADR-0181) |
| `hive-mind-tools.ts` | 9 | 8 | 0 | 0 | archivist.dispatch (4) + cli-local FS-JSON (5, with declared rationale); 1 carries Wave-3 TODO |
| `workflow-tools.ts` | 10 | 10 | 0 | 0 | archivist.dispatch + re-read; status/list deferred per file comment |
| `analyze-tools.ts` | 6 | 6 | 0 | 0 | diff-classifier (real git-diff parsing) |
| `progress-tools.ts` | 4 | 4 | 0 | 0 | Live walk of `v3/**` directory + counts |
| `embeddings-tools.ts` | 7 | 4 | 0 | 0 | Real ONNX + memory router; **3 catches silently return `success: true`** (F-08-004) |
| `claims-tools.ts` | 12 | 12 | 0 | 0 | archivist.dispatch + FS-JSON re-read |
| `security-tools.ts` | 6 | 6 | 0 | 0 | `@claude-flow/aidefence` (lazy-loaded; install attempted; named errors) |
| `transfer-tools.ts` | 11 | 11 | 0 | 0 | `transfer/anonymization`, `transfer/ipfs`, `transfer/store` |
| `system-tools.ts` | 15 | 15 | 0 | 0 | Real `os.*` + `process.*` APIs |
| `terminal-tools.ts` | 5 | 5 | 0 | 0 | Real `execSync` + encrypted FS persistence |
| `neural-tools.ts` | 6 | 5 | 0 | 0 | Real embeddings (3 tiers); **1 catch silently falls back to hash embedding** (F-08-002) |
| `performance-tools.ts` | 6 | 3 | **3** | 0 | Real benchmarks + system metrics; **3 tools `_stub: true`** (F-08-007) |
| `github-tools.ts` | 5 | 5 | 0 | 0 | Real `gh` + `git` exec; **`run()` helper silently returns null on error** (F-08-003) |
| `daa-tools.ts` | 8 | 8 | 0 | 0 | archivist.dispatch + advisory lock; banner: "LOCAL STATE MANAGEMENT, no distributed" |
| `coordination-tools.ts` | 7 | 6 | **1** | 0 | archivist.dispatch; `coordination_orchestrate` is honest stub (`executor:'none'`) (F-08-006) |
| `browser-tools.ts` | 23 | 23 | 0 | 0 | `agent-browser` CLI via execFileSync with named errors |
| `browser-session-tools.ts` | 5 | 5 | 0 | 0 | Shells out to ruvector + agent-browser; graceful when missing |
| `agentdb-tools.ts` | 50 | 50 | 0 | 0 | archivist.dispatch (typed dispatch) + RVF/SQLite gating |
| `ruvllm-tools.ts` | 10 | 10 | 0 | 0 | WASM `loadRuvllmWasm()` + journal-replay across processes |
| `wasm-agent-tools.ts` | 10 | 10 | 0 | 0 | WASM agent registry + atomic FS persistence; fails loud on corrupt store |
| `guidance-tools.ts` | 5 | 5 | 0 | 0 | Static catalog of 16 capability areas + workflow recommendations |
| `autopilot-tools.ts` | 10 | 10 | 0 | 0 | autopilot-state.ts with FS persistence |
| **Total** | **327** | **319** | **4** | **0** | **97.6% real, 1.2% stub, 0% missing schemas** |

Note: `coverageRouterTools` is exported from `mcp-tools/index.ts:17` (`from
'../ruvector/coverage-tools.js'`) but is NOT in `mcp-client.ts`'s
`registerTools()` spread, so it does not contribute to the live registry. This
is a sub-category-level completeness gap (F-08-010).

## Findings

### F-08-001 [CRITICAL] `@claude-flow/mcp` server registers only 4 tools, not 327

- **Location:** `forks/ruflo/v3/@claude-flow/mcp/src/server.ts:1036-1093`
  (function `registerBuiltInTools`).
- **Issue:** The HTTP/websocket-transport server in `@claude-flow/mcp` (used
  by `cli/src/mcp-server.ts:730: await import('@claude-flow/mcp')`) only
  registers 4 built-in tools at startup: `system/info`, `system/health`,
  `system/metrics`, and `tools/list-detailed`. The function explicitly logs
  `'Built-in tools registered', { count: 4 }`. The 327-tool registry in
  `cli/src/mcp-tools/` is NEVER attached to this server — the stdio path
  bypasses it entirely (it calls `callMCPTool` directly via the in-process
  `TOOL_REGISTRY` Map), while the HTTP path through this server has nothing
  but the 4 built-ins.
- **Evidence:**
  - `server.ts:1091` — `this.logger.info('Built-in tools registered', { count: 4 });`
  - `mcp-server.ts:730` — `const { createMCPServer } = await import('@claude-flow/mcp');`
    confirms the HTTP path uses this minimal server.
  - `mcp-server.ts:426` (the stdio path) — `const { listMCPTools, callMCPTool,
    hasTool } = await import('./mcp-client.js');` — uses the 327-tool
    in-process registry instead.
- **Impact:** HTTP MCP transport callers (e.g. anyone configuring `--transport
  http`) will get 4 tools, not 327. This is a hidden mode-dependent surface
  cut that the user/agent has no way to see without reading the server
  source. The CLAUDE.md flow assumes stdio (Claude Code default) — that works.
  Anything other than stdio is hollow.
- **Recommendation:** Either (a) wire `registerBuiltInTools` to also register
  the CLI tool registry, OR (b) make HTTP transport go through the same
  in-process registry. Document explicitly which transports are supported.

### F-08-002 [CRITICAL] `neural-tools.ts` silently falls back to hash-based "embedding" when ML model fails

- **Location:** `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/neural-tools.ts:144-177`
  (function `generateEmbedding`).
- **Issue:** When real embedding tiers (agentic-flow ReasoningBank, ONNX
  provider, etc.) fail at runtime, the function falls back to a hash-based
  pseudo-embedding using a linear-congruential generator seeded from the
  text hash. The fallback embedding has the right shape (right dimensions)
  but **no semantic meaning** — and the file admits this:
  ```
  // NOTE: No semantic meaning — only useful for consistent deduplication,
  // not similarity search
  ```
  Despite this, the fallback is wired into `neural_train` /
  `neural_predict` / `neural_patterns` (3 of 6 tools in the category) which
  consumers will interpret as a working similarity search.
- **Evidence:** Lines 146-152:
  ```ts
  if (realEmbeddings && text) {
    try {
      return await realEmbeddings.embed(text);
    } catch {
      // Fall back to hash-based
    }
  }
  ```
- **Impact:** Pattern stores fill with vectors that look like embeddings but
  fail similarity at query time. Violates `feedback-no-fallbacks`. The file
  HAS the explicit comment at line 69-73 ("No Tier 4 mock fallback ... Silently
  substituting mock embeddings would hide a missing production dependency")
  declaring this very design rule — and then the same file violates it 80
  lines later when the production embedding throws at call time.
- **Recommendation:** Drop the try/catch fallback at line 149-151; let the
  callsite see the real exception. The file already does the right thing for
  module-load failures; do the same for per-call failures.

### F-08-003 [CRITICAL] `github-tools.ts` `run()` swallows all `gh`/`git` failures and returns `null`

- **Location:** `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/github-tools.ts:86-92`
  (function `run`) and `100-112` (function `runArgv`).
- **Issue:** Both shell-exec helpers wrap `execSync`/`execFileSync` in
  `try { … } catch { return null; }`. The 5 github_* tools (`github_repo_analyze`,
  `github_pr_manage`, `github_issue_track`, `github_workflow`, `github_metrics`)
  all consume `run()` results without consistently distinguishing "gh not
  installed" (legitimate degraded state) from "gh failed with stderr"
  (real error the caller needs to see). The result is that authentication
  failures, rate-limit hits, network errors, and stale tokens all surface
  as a generic null → empty-results envelope.
- **Evidence:** line 86-92:
  ```ts
  function run(cmd: string, cwd?: string): string | null {
    try {
      return execSync(cmd, ...).trim();
    } catch {
      return null;
    }
  }
  ```
- **Impact:** When github tools return `{ owner, repo, branch, metrics: {...0
  for all fields...} }`, the caller cannot tell whether the repo is empty,
  the API rate-limited them, the token is bad, or the network is down.
  Violates `feedback-no-fallbacks`.
- **Recommendation:** Have `run()` discriminate ENOENT (degrade to "gh not
  installed") from non-zero-exit-with-stderr (return discriminated error,
  not null), and propagate that into the response shape.

### F-08-004 [WARNING] `embeddings-tools.ts` returns `success: true` after 4 distinct catch blocks

- **Location:** `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/embeddings-tools.ts`
  lines 525-542, 630-636, 656-662, 686-691.
- **Issue:** Four catch blocks in `embeddings_search` (line 525),
  `embeddings_neural action='drift'` (line 630), `action='consolidate'`
  (line 656), and `action='adapt'` (line 686) each return `{ success: true,
  status: {...} }` with empty / disabled fields. The `embeddings_search`
  variant carries a comment "Database not available - return empty but
  truthful" — but `success: true` is **not** truthful when the database is
  unavailable; the request did not succeed in finding any embeddings, it
  failed to query. A caller checking `result.success` will not know.
- **Evidence:** Line 526-540:
  ```ts
  } catch {
    // Database not available - return empty but truthful
    return {
      success: true,
      query,
      results: [],
      metadata: { ... },
      message: 'No embeddings indexed yet. Use memory store to add documents.',
    };
  }
  ```
- **Impact:** Caller cannot distinguish "no embeddings stored" (a state) from
  "database query crashed" (a failure). Violates `feedback-no-fallbacks`.
- **Recommendation:** Return `success: false` from these catches with the
  underlying error message; let the harness decide whether to retry, alert,
  or display "no results."

### F-08-005 [WARNING] All file-local `loadStore` helpers use empty `catch { /* return default */ }`

- **Location:** 14 files across `cli/src/mcp-tools/`:
  - `agent-tools.ts:87`, `claims-tools.ts:83`, `config-tools.ts:125`,
    `coordination-tools.ts:132`, `daa-tools.ts:92`, `github-tools.ts:61`,
    `hive-mind-tools.ts` (multiple), `memory-tools.ts:103`, `neural-tools.ts:132`,
    `session-tools.ts` (multiple), `swarm-tools.ts:163`, `system-tools.ts:70`,
    `task-tools.ts:83`, `terminal-tools.ts:63`, `workflow-tools.ts:90`.
- **Issue:** Each `loadXxxStore()` function wraps its `JSON.parse(readFileSync(...))`
  in `try { … } catch { /* Return empty store */ }`. This pattern is
  borderline acceptable for "file does not exist" (would be ENOENT) but
  collapses two distinct failures into one default-return path:
  (a) file missing → fine, (b) file corrupt JSON → silently use default
  (loses data, hides corruption).
- **Evidence:** Total empty `catch` blocks across all category files: **84
  occurrences** (`grep -nE "^\s*\}\s*catch\s*\{\s*$" *.ts | wc -l`). Most
  are file-load helpers per above.
- **Note:** `wasm-agent-tools.ts:79-90` does this correctly — it splits
  `existsSync` (missing → default) from parse failure (`throw new Error("Corrupt
  ... store at ${path}")`). That's the pattern to copy.
- **Impact:** A truncated `.claude-flow/agents/store.json` (after a crash, or
  user edit, or filesystem error) yields an empty store on next call. The
  agent records are silently lost. ADR-0082 / `feedback-no-fallbacks`.
- **Recommendation:** Adopt the wasm-agent-tools.ts pattern: check `existsSync`
  for the missing-file branch, and re-throw on JSON parse errors.

### F-08-006 [WARNING] `coordination_orchestrate` is an honest stub but the category banner mislabels what's missing

- **Location:** `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/coordination-tools.ts:1-9`
  (file banner) and `844-855` (handler).
- **Issue:** The file banner says "These tools provide LOCAL STATE MANAGEMENT.
  No actual distributed coordination." The orchestrate handler is correctly
  marked `executor: 'none'` + carries an `_note` telling callers to use
  `agent_spawn + Task` or `hive-mind_spawn` for real execution. **But the
  tool name `coordination_orchestrate` and its description "Orchestrate
  multi-agent task execution"** advertise the opposite. The banner caveat
  is real and accurately admits the limitation; the tool's name and
  description do not.
- **Impact:** The honest stub is honest *if you read the source*. From the
  MCP manifest (which is what the agent / Claude Code consume), the
  description still promises orchestration. Same pattern in `daa-tools.ts`
  (file banner at lines 6-9 + `daa_workflow_execute` description). Not a
  silent fallback — the tool DOES run (records the orchestration), it just
  doesn't execute it.
- **Recommendation:** Bake "(does not execute; records intent only)" into
  the description string at the MCP boundary. The current `_note` field in
  the response is only seen post-call.

### F-08-007 [WARNING] `performance-tools.ts` ships 3 explicit `_stub: true` tools

- **Location:** `performance-tools.ts:226-233` (`performance_bottleneck`),
  `379-386` (`performance_profile`), `399-406` (`performance_optimize`).
- **Issue:** 3 of 6 tools in the performance category return:
  ```ts
  return {
    success: true,
    _stub: true,
    message: 'X not yet implemented. Use Y for ...',
    bottlenecks: [],
  };
  ```
- **Impact:** Same pattern issue as F-08-006 — the MCP manifest description
  ("Detect performance bottlenecks", "Profile specific component",
  "Apply performance optimizations") implies they work. The `_stub: true`
  field is honest but post-hoc.
- **Recommendation:** Either (a) prepend "[STUB]" to the description string,
  OR (b) implement them. The other 3 tools (`performance_benchmark`,
  `performance_metrics`, `performance_report`) ARE real with actual timing
  and `process.memoryUsage()`.

### F-08-008 [WARNING] `v3/mcp/server.ts` (792 LOC) + `server-entry.ts` (320 LOC) reference non-existent `./tools/index.js`

- **Location:** `forks/ruflo/v3/mcp/server-entry.ts:23` imports
  `./tools/index.js`. **No `v3/mcp/tools/` directory exists** in source
  (only in `dist/v3/mcp/tools/`).
- **Issue:** This appears to be a parallel scaffolding from an earlier
  refactor that was meant to host a single canonical tool registry. The
  files compile because their imports use `.js` extensions that TypeScript
  resolves at build time (and the dist copy exists). At runtime, the
  scaffold would fail to start because `./tools/index.js` resolves into
  a stale dist tree, not source.
- **Evidence:** `grep -rn "from '../../mcp/" v3 | grep -v node_modules |
  grep -v dist | grep -v archive` → 0 hits. Nothing imports from
  `v3/mcp/server.ts` in the live source tree.
- **Impact:** Dead code. Confuses future contributors who try to find "the
  MCP server." Carries a real risk: if someone wires it up during a refactor,
  the resulting server will have zero tools (because `./tools/index.js`
  doesn't exist in src) and exit silently.
- **Recommendation:** Either complete the move (port `mcp-client.ts`'s
  registry into `v3/mcp/tools/index.ts` and delete the cli copy), or delete
  `v3/mcp/` outright.

### F-08-009 [NOTE] `v3/src/infrastructure/mcp/MCPServer.ts` is parallel DDD scaffold imported by one test

- **Location:** `forks/ruflo/v3/src/infrastructure/mcp/MCPServer.ts` (120 LOC).
- **Issue:** Yet another `MCPServer` class. Sole consumers:
  - `v3/__tests__/integration/mcp-integration.test.ts`
  - `v3/src/index.ts:29` (re-exports it; no source consumer)
  - `v3/src/mcp/index.ts` (8 LOC; only re-exports it)
- **Impact:** Same as F-08-008 — dead scaffolding adjacent to the live
  surface. Has its own 3-file `tools/` sub-tree
  (`AgentTools.ts:138`, `ConfigTools.ts:209`, `MemoryTools.ts:156`)
  exporting `MCPToolProvider`-shape classes that no production code wires
  into the live registry.
- **Recommendation:** Decide whether the DDD `MCPServer` is the v3 target
  (in which case migrate cli's `mcp-client.ts` to it) or delete.

### F-08-010 [NOTE] `coverageRouterTools` exported from `mcp-tools/index.ts` but not in live registry

- **Location:** `cli/src/mcp-tools/index.ts:17`
  (`export { coverageRouterTools } from '../ruvector/coverage-tools.js'`)
  vs `cli/src/mcp-client.ts:81-116` (spread list).
- **Issue:** The barrel re-exports `coverageRouterTools` but `mcp-client.ts`
  doesn't include them in the `registerTools(...)` spread.
- **Impact:** If a test or downstream import resolves `coverageRouterTools`
  through the barrel and expects them callable via `callMCPTool`, the
  lookup will fail (`MCPClientError: MCP tool not found`).
- **Recommendation:** Either add to the live registry (recommended — the
  coverage_router family is documented in plugin-coverage-router) or remove
  the barrel export to prevent silent drift.

### F-08-011 [NOTE] `hooks-tools.ts` ships 3 placeholder branches in the SONA learning + intelligence paths

- **Location:** `cli/src/mcp-tools/hooks-tools.ts:3167`
  (`implementation: sona ? 'real-sona-learning' : 'placeholder'`),
  `3191` (`let implementation = 'placeholder'`), `3257-3258` and `3302-3303`
  ("Fall back to placeholder").
- **Issue:** Three handlers (`hooks_intelligence_pattern-search`,
  `hooks_intelligence_learn`, `hooks_intelligence_attention`) explicitly
  carry a `placeholder` flag in their returned envelope when the SONA /
  Intelligence modules are unavailable. Better than silently faking it
  (the flag is surfaced to the caller), but the description string still
  promises real behavior.
- **Impact:** Same description-vs-implementation drift as F-08-007. The
  `placeholder` flag is honest; the description is not.
- **Recommendation:** Same as F-08-007 — bake "(placeholder when SONA
  unavailable)" into the manifest description.

### F-08-012 [NOTE] `agentdb_session-start` / `-end` ARE callable MCP tools; CLAUDE.md note is about invocation pattern

- **Location:** `agentdb-tools.ts:444-500` defines `agentdbSessionStart` +
  `agentdbSessionEnd` with real handlers that delegate to
  `agentdb-orchestration.ts`'s `sessionStart()` + `sessionEnd()`.
- **Observation:** The slice brief flags CLAUDE.md's "Do NOT call
  agentdb_session-start / session-end — hooks manage session lifecycle
  automatically" — this is a *usage guideline*, not a no-op implementation.
  Both handlers do real work (ReflexionMemory episodic replay on start,
  NightlyLearner consolidation on end). The brief's "lifecycle:
  agentdb_session-start / session-end are hook-managed" check is satisfied
  — the tools exist and work, the docs just steer agents away from manual
  invocation.

### F-08-013 [NOTE] `hooks-tools.ts` carries a documented "PHASE 7 work" deferral with 3 blockers

- **Location:** `hooks-tools.ts:5-25` (file-level docblock).
- **Observation:** 37 hooks tools in this file are *intentionally* NOT
  flipped to archivist dispatch in Phase 5. The docblock cites three
  blockers (name-mismatch between cli's `pre-task` and archivist's
  `pre_task`; ToolPayloadMap coverage gap for 33 of 37 tools; ADR-0180
  §160 explicit Phase 7 scheduling). This is well-documented technical
  debt, not silent code rot.
- **No fix needed for this audit.** Listed for completeness in the
  per-category roll-up where the "hooks-tools.ts" row shows 33 real / 3
  with placeholder branches.

### F-08-014 [NOTE] `analyze-tools.ts` `useRuVector` option carries "graceful fallback if unavailable" in the schema description

- **Location:** `analyze-tools.ts:46-49`.
- **Observation:** The schema explicitly says `description: 'Attempt to use
  ruvector for analysis (graceful fallback if unavailable)'`. The fallback
  is at the *option layer* (caller opts in/out), and the analyze handler
  does propagate the analyze error correctly (line 85-91 catches and
  returns `{ error: true, message: ..., ref }`). This is acceptable —
  not a silent fallback, just an opt-in degradation knob with a clear
  error path.
- **No fix needed.**

## Architecture observations (non-finding)

- **Single canonical registration point:** `cli/src/mcp-client.ts:81` is
  the sole `registerTools([...30 collections])` call. Verified.
- **Typed dispatch surface:** 12 of 28 category files (agent, swarm,
  memory, claims, task, hive-mind, agentdb, workflow, coordination, daa,
  agent-execute-core, autopilot indirect) use the typed
  `archivist.dispatch<K>` overload from `forks/agentdb/src/archivist/
  dispatch-types.ts`. ToolPayloadMap satisfies enforce payload shape at
  compile time (no `as` lies).
- **Validation discipline:** `validate-input.ts` (325 LOC) exposes
  `validateIdentifier`, `validateText`, `validatePackageName`,
  `validateGitRef`, `validatePath`, `validateEnv`, `validateNumber`,
  `validateWorkerType`, `validateAgentSpawn`, `validateTaskSources`.
  Used consistently at handler entry across all 28 category files.
- **Atomic FS writes:** Most file-based stores use `tmp + rename`
  (atomic on POSIX within the same FS) and O_EXCL advisory locks for
  cross-process serialization. Pattern: `daa-tools.ts:99-105`,
  `wasm-agent-tools.ts:97-108`.
- **No `return { ok: true }` stubs found** across 327 tools; the slice
  brief's prior recon assumption holds.
- **Zero duplicate tool names** across the 327-tool surface (verified
  via `sort | uniq -d` of `name:` declarations).

## Recommendations (prioritized)

1. **F-08-001:** Either wire `@claude-flow/mcp`'s HTTP server to the
   327-tool registry, or document explicitly that HTTP transport supports
   only 4 tools. The current asymmetry is a footgun.
2. **F-08-002, F-08-003, F-08-004:** Remove the 6 silent-fallback catch
   blocks. Let the real exception propagate to the response shape with
   `success: false` + named error. Follow the wasm-agent-tools.ts pattern.
3. **F-08-005:** Apply the wasm-agent-tools.ts split (ENOENT → default,
   parse error → throw) to the 14 `loadXxxStore()` helpers. Largely
   mechanical; each is the same 7-line shape.
4. **F-08-006, F-08-007, F-08-011:** Bake stub / placeholder status into
   the MCP manifest `description` strings (visible at agent decision time)
   rather than only the response envelope `_stub:true` / `_note:` /
   `implementation:'placeholder'` fields (visible only post-call).
5. **F-08-008, F-08-009:** Decide on dead-tree disposition for
   `v3/mcp/` (792 LOC) and `v3/src/infrastructure/mcp/MCPServer.ts`
   (120 LOC). Either complete the move or delete.
6. **F-08-010:** Reconcile the `coverageRouterTools` barrel export with
   the live `mcp-client.ts` registry. Either add to the spread or remove
   from the barrel.

## File paths referenced (all absolute)

- `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/mcp-client.ts`
  — canonical registration point (line 81 = `registerTools([...])`)
- `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/mcp-server.ts`
  — server lifecycle wrapper; line 730 imports HTTP server
- `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/`
  — 39 files; 28,612 LOC; the live MCP tool surface
- `/Users/henrik/source/forks/ruflo/v3/@claude-flow/mcp/src/server.ts`
  — HTTP/websocket server; 1134 LOC; registers only 4 built-in tools
- `/Users/henrik/source/forks/ruflo/v3/@claude-flow/hooks/src/mcp/index.ts`
  — 587 LOC; dead-code (per 01-hooks-pre-lifecycle.md F-01-002)
- `/Users/henrik/source/forks/ruflo/v3/mcp/server.ts`
  — 792 LOC; dead-code; references non-existent `./tools/index.js`
- `/Users/henrik/source/forks/ruflo/v3/mcp/server-entry.ts`
  — 320 LOC; entry point for dead `v3/mcp/server.ts`
- `/Users/henrik/source/forks/ruflo/v3/src/infrastructure/mcp/MCPServer.ts`
  — 120 LOC; DDD scaffold; one-test consumer
- `/Users/henrik/source/forks/ruflo/v3/src/infrastructure/mcp/tools/`
  — `AgentTools.ts`, `ConfigTools.ts`, `MemoryTools.ts`; scaffold tools
- `/Users/henrik/source/forks/agentdb/src/archivist/handlers/`
  — the real backends most live tools delegate to via `archivist.dispatch`
