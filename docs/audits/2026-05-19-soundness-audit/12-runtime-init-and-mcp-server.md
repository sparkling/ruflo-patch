# 12 — Runtime: init + MCP server validation

## Summary

- Verdaccio: up
- @sparkleideas/ruflo installed: yes (wrapper version 3.1.0-alpha.14-patch.208; pinned CLI 3.7.0-alpha.10-patch.237)
- `ruflo init`: PASS (init.log clean, 12 dirs + 102 files claimed; 319 actual files under .claude/)
- `.mcp.json` matches canonical: yes (byte-identical to `/Users/henrik/source/ruflo-patch/.mcp.json`)
- MCP server boot: PASS (stdio JSON-RPC initialize succeeded; protocolVersion 2024-11-05; serverInfo { name: "ruflo", version: "3.0.0" })
- Tools exposed (count): 298 via JSON-RPC tools/list; 302 by CLI `ruflo mcp tools` table rows
- Sample tool calls: 3/3 passed (`agentdb_health` → 45 controllers; `memory_stats` → backend SQLite+HNSW; `hooks_list` → 7 hook types)
- Bottom line: end-to-end happy path is sound — Verdaccio install, init, MCP server boot, and tool execution all work; one architectural concern logged about `npm`'s last-write-wins resolution of the shared `ruflo` bin name routing around the ADR-0143 wrapper.

## Step-by-step

1. **Verdaccio ping** — `curl -sf http://localhost:4873/-/ping` returned `{}` (200). PASS.

2. **Sandbox created** — `/tmp/ruflo-audit-init-mcp-18858` (`SANDBOX=$$ → 18858`). `npm init -y` produced minimal `package.json`.

3. **`npm install --registry=http://localhost:4873 @sparkleideas/ruflo@latest`** — exit code 0. Output:

   ```
   added 770 packages in 40s
   ```

   Installed wrapper version `3.1.0-alpha.14-patch.208`. Pinned CLI dep `3.7.0-alpha.10-patch.237`. 6 npm deprecation warnings (koa-router@14, prebuild-install@7.1.3, boolean@3.2.0, node-domexception@1.0.0, glob@10.5.0; plus npm config "python" — all pre-existing, not introduced by ruflo).

4. **`ruflo` binary** —

   ```
   lrwxr-xr-x  node_modules/.bin/ruflo -> ../@sparkleideas/cli/bin/cli.js
   ```

   See F-12-001 below — the symlink points at `@sparkleideas/cli/bin/cli.js`, NOT at the wrapper's `@sparkleideas/ruflo/bin/ruflo.mjs`. Behaviour is functionally equivalent in this test (same code path eventually) but bypasses the ADR-0143 wrapper.

5. **`ruflo init --force --no-with-embeddings`** — clean exit. init.log shows:

   ```
   Initializing RuFlo V3
   ... Initializing...    RuFlo V3 initialized successfully!
   Directories: 12 created | Files: 102 created
   ```

   Note: init.log claims 102 files but `find $SANDBOX/.claude -type f | wc -l` shows 319 files actually present under `.claude/`. Either the count is wrong or it excludes copied skill / agent / command markdowns. Not blocking; flagged as F-12-003 NOTE.

6. **Generated files** (matching the audit checklist):

   ```
   /tmp/ruflo-audit-init-mcp-18858/.mcp.json
   /tmp/ruflo-audit-init-mcp-18858/CLAUDE.md
   /tmp/ruflo-audit-init-mcp-18858/.claude/settings.json
   ```

   `.hooks.json` was NOT generated as a separate file — hooks are configured inline inside `.claude/settings.json` (`hooks.PreToolUse`, `hooks.PostToolUse`, etc.). This matches the canonical project structure. Also generated: `.ruflo-project` marker, full `.claude/{agents,commands,helpers,scripts,skills}/` trees (98 agents, 24 commands, 0 skills as stated), `.claude-flow/{data,logs,sessions,...}/` runtime dirs.

7. **`.mcp.json` diff vs canonical** — byte-identical. `diff -u` produced no output. All required env vars present with correct values:
   - `command: "npx"`
   - `args: ["-y", "@sparkleideas/ruflo@latest", "mcp", "start"]`
   - `env.CLAUDE_FLOW_MODE: "v3"`
   - `env.CLAUDE_FLOW_HOOKS_ENABLED: "true"`
   - `env.CLAUDE_FLOW_TOPOLOGY: "hierarchical-mesh"`
   - `env.CLAUDE_FLOW_MAX_AGENTS: "15"`
   - `env.CLAUDE_FLOW_MEMORY_BACKEND: "hybrid"`

   PASS.

8. **MCP server boot (JSON-RPC stdio probe)** — wrote a `mcp-stdio-probe.mjs` that spawns `./node_modules/.bin/ruflo mcp start`, sends line-delimited JSON-RPC `initialize` then `tools/list` then 3 × `tools/call` requests. Sample of initialize response:

   ```json
   {
     "jsonrpc": "2.0",
     "id": 1,
     "result": {
       "protocolVersion": "2024-11-05",
       "serverInfo": { "name": "ruflo", "version": "3.0.0" },
       "capabilities": {
         "tools": { "listChanged": true },
         "resources": { "subscribe": true, "listChanged": true }
       }
     }
   }
   ```

   PASS.

9. **tools/list** — 298 tools. First 10 names: `agent_spawn, agent_execute, agent_terminate, agent_status, agent_list, agent_pool, agent_health, agent_update, swarm_init, swarm_status`. All three target tools present: `agentdb_health: true`, `memory_stats: true`, `hooks_list: true`.

10. **Sample tool calls** — all 3 returned real, non-stub data via JSON-RPC `tools/call` with `arguments: {}`:

    - **A. `agentdb_health`** — returned `{ available: true, controllers: 45, controllerNames: [resourceTracker, rateLimiter, circuitBreaker, telemetryManager, reasoningBank, tieredCache, attentionMetrics, metadataFilter, hierarchicalMemory, solverBandit, agentMemoryScope, vectorBackend, memoryGraph, mutationGuard, selfAttention, crossAttention, multiHeadAttention, nativeAccelerator, queryOptimizer, gnnService, attentionService, flashAttentionService, moeAttentionService, skills, explainableRecall, reflexion, causalGraph, hybridSearch, attestationLog, batchOperations, enhancedEmbeddingService, auditLogger, causalRecall, nightlyLearner, learningSystem, selfLearningRvfBackend, indexHealthMonitor, semanticRouter, graphTransformer, guardedVectorBackend, contextSynthesizer, rvfOptimizer, mmrDiversityRanker, quantizedVectorStore, sonaTrajectory], source: "registry" }`. 45 controllers — matches reference fork-only controllers catalog ([[project-fork-only-controllers]]).
    - **B. `memory_stats`** — returned `{ initialized: true, totalEntries: 0, entriesWithEmbeddings: 0, embeddingCoverage: "0%", namespaces: {}, backend: "SQLite + HNSW", version: "3.0.0", features: { vectorEmbeddings: true, hnswIndex: true, semanticSearch: true } }`. Backend reports "SQLite + HNSW" rather than the "hybrid" backend specified in `.mcp.json` env — see F-12-004 NOTE.
    - **C. `hooks_list`** — returned `{ hooks: [{pre-edit PreToolUse active enabled:false}, {post-edit PostToolUse active enabled:false}, {pre-command PreToolUse active enabled:false}, {post-command PostToolUse active enabled:false}, {pre-task PreToolUse active enabled:false}, {post-task PostToolUse active enabled:true}, {route intelligence active enabled:true}, {explain intelligence active enabled:false}, {session-start SessionStart active ...}, ...] }`. 7 hook types listed; init log claims "7 hook types enabled" matches.

    All three sample calls returned PASS with `"OK] Tool executed"` markers in execution log and structured JSON results. Tool execution durations: agentdb_health 1357.80ms, memory_stats 2712.81ms, hooks_list 0.05ms (first-call boot dominates; subsequent calls would be faster).

11. **Cleanup** — `pgrep -af "$SANDBOX"` → empty (no stray procs from this sandbox). `find $SANDBOX -type s -o -name '*.pid' -o -name '*.sock'` → empty. Pre-existing `ruflo mcp start` PIDs outside the sandbox (6107, 43184, 52007, 57409) belong to other Claude Code sessions and are unrelated. Trap cleanup not exercised because no abnormal exit; SIGTERM in the probe script killed the child within 1.5s without escalation to SIGKILL.

## Findings

### F-12-001 [WARN] `ruflo` bin name shared between wrapper and CLI, last-write-wins routes around ADR-0143 wrapper

- Location: `node_modules/.bin/ruflo` symlink resolution
- Issue: `@sparkleideas/cli/package.json` declares `bin: { "ruflo": "bin/cli.js", ... }`, AND `@sparkleideas/ruflo/package.json` declares `bin: { "ruflo": "bin/ruflo.mjs" }`. npm installs the last-written entry; on this fresh install the symlink went to `@sparkleideas/cli/bin/cli.js`, not the wrapper. This means `./node_modules/.bin/ruflo` and (by extension) any agent that resolves `ruflo` via PATH bypasses the ADR-0143 wrapper entirely.
- Evidence:

  ```
  $ readlink node_modules/.bin/ruflo
  ../@sparkleideas/cli/bin/cli.js

  $ node node_modules/@sparkleideas/ruflo/bin/ruflo.mjs --version
  ruflo v3.7.0-alpha.10-patch.237

  $ node node_modules/@sparkleideas/cli/bin/cli.js --version
  ruflo v3.7.0-alpha.10-patch.237
  ```

  Both report the CLI version (the wrapper proxies in-process, so wrapper output and CLI output are identical for `--version`). Lockfile confirms `@sparkleideas/cli` declares 5 bin entries including `ruflo`; `@sparkleideas/ruflo` declares only `ruflo`.

- Impact: In this test the wrapper-vs-CLI question is observationally moot because the wrapper is just a thin proxy that dynamic-imports the CLI's `bin/cli.js`. But the wrapper exists for a reason (ADR-0142/0143 cite three bugs the wrapper exists to mitigate: npx staleness, semver `*` range mismatch, ESM exports-map resolution). When the symlink resolves to the CLI directly, none of those mitigations are in play. The wrapper has guards G1-G4 (lockstep version check, no-fallback enforcement, bin-path validation, header). When users invoke `npx -y @sparkleideas/ruflo@latest <cmd>` (as `.mcp.json` does), they DO get the wrapper. When users invoke a locally-installed `ruflo` from PATH (or `./node_modules/.bin/ruflo` as `claude` MCP runners often do), they may or may not — depends on npm install order.
- Recommendation: either (a) remove `"ruflo"` from `@sparkleideas/cli`'s bin map to force PATH resolution through the wrapper, OR (b) document this as intentional fallback behaviour with a test that asserts both paths route to compatible code. Option (a) is cleaner but is a packaging change in the CLI fork. Cross-reference: this audit cannot tell whether the order-dependence is reproducible — needs a clean reinstall on a different machine to confirm.

### F-12-002 [NOTE] MCP server initialize response advertises `version: "3.0.0"` regardless of installed wrapper/CLI version

- Location: `node_modules/@sparkleideas/cli/bin/mcp-server.js` initialize handler
- Issue: `initialize` response returns `serverInfo: { name: "ruflo", version: "3.0.0" }`. Installed wrapper is `3.1.0-alpha.14-patch.208`; installed CLI is `3.7.0-alpha.10-patch.237`. The `3.0.0` looks hardcoded and is not the actual package version.
- Evidence: see step 8 INIT_RESPONSE.
- Impact: Cosmetic; MCP clients that key on server version for compatibility decisions could be misled. Low priority.
- Recommendation: have the MCP server read its own package.json at boot and report the actual version.

### F-12-003 [NOTE] Init log "Files: 102 created" undercounts actual file count

- Location: `ruflo init` UI summary
- Issue: Init UI prints `Files: 102 created` but `find $SANDBOX/.claude -type f | wc -l` = 319.
- Evidence: see step 5.
- Impact: Cosmetic. Probably counts top-level helper files and excludes the agent/command/skill markdown trees. Misleading but not load-bearing.
- Recommendation: either fix the counter or label it "core files" vs "total files".

### F-12-004 [NOTE] `memory_stats` reports `backend: "SQLite + HNSW"` despite `.mcp.json` env setting `CLAUDE_FLOW_MEMORY_BACKEND=hybrid`

- Location: `memory_stats` tool implementation
- Issue: `.mcp.json` env declares `CLAUDE_FLOW_MEMORY_BACKEND=hybrid`. `memory_stats` returns `backend: "SQLite + HNSW"`. Either the env var is not consumed by `memory_stats`, or "SQLite + HNSW" IS the implementation of "hybrid" and the label disagrees with the configured name.
- Evidence: see step 10 sample B and step 7 `.mcp.json` content.
- Impact: Likely cosmetic — per [[project-rvf-primary]] memory the project's stance is RVF primary with SQLite fallback only, and `entriesWithEmbeddings: 0` suggests no actual data was stored. But the discrepancy between configured backend name and reported backend name is a freshness signal that could mask a real misconfiguration.
- Recommendation: confirm whether `CLAUDE_FLOW_MEMORY_BACKEND=hybrid` is consumed by anything at runtime; if yes, normalize the reported backend label to match.

## Installed vs source distinction

- **Installed wrapper package version**: `3.1.0-alpha.14-patch.208` (Verdaccio, latest)
- **Installed CLI package version**: `3.7.0-alpha.10-patch.237` (Verdaccio, latest, pinned by wrapper)
- **F-12-001 (bin name conflict)**: exists in installed packages (lockfile evidence above). Also exists at source: `/Users/henrik/source/ruflo-patch/package.json` line 43-45 declares `bin: { ruflo: "bin/ruflo.mjs" }`, and the published CLI's `@sparkleideas/cli/package.json` declares `bin: { ..., ruflo: "bin/cli.js", ... }`. Diagnosis: **already-fixed-pending-release would not help — both wrapper and CLI legitimately want to ship the `ruflo` name. The fix has to be a deliberate choice (drop the cli-side declaration OR accept the order-dependence) and likely requires a CLI fork bump.**
- **F-12-002 (hardcoded version)**: exists in installed `node_modules/@sparkleideas/cli/bin/mcp-server.js`; presumed to exist in `/Users/henrik/source/forks/ruflo/v3/.../mcp-server.ts` (not verified by this slice — would need a separate read of fork source). Diagnosis: **needs-new-patch in the cli fork** to wire the package.json version into the initialize response.
- **F-12-003 (init counter)**: in installed wrapper or CLI init UI. Diagnosis: **needs-new-patch in cli fork**.
- **F-12-004 (memory backend label)**: in installed CLI memory_stats handler. Diagnosis: **needs-new-patch in cli fork**.

## Method

Commands run (chronological, abbreviated):

```bash
curl -sf http://localhost:4873/-/ping                                              # Step 1
SANDBOX=/tmp/ruflo-audit-init-mcp-$$; mkdir -p $SANDBOX && cd $SANDBOX             # Step 2
npm init -y                                                                        # Step 3
npm install --registry=http://localhost:4873 @sparkleideas/ruflo@latest            # Step 4
ls -la node_modules/@sparkleideas/ruflo/ && cat .../ruflo/package.json | jq .bin   # Step 5
ls -la node_modules/.bin/ruflo                                                     # Step 6
./node_modules/.bin/ruflo init --help                                              # Step 7 (help discovery)
./node_modules/.bin/ruflo init --force --no-with-embeddings                        # Step 8
find $SANDBOX -maxdepth 4 -type f \( -name '.mcp.json' -o ... \)                   # Step 9
diff -u /Users/henrik/source/ruflo-patch/.mcp.json $SANDBOX/.mcp.json              # Step 10
./node_modules/.bin/ruflo mcp tools                                                # Step 11 (CLI list)
./node_modules/.bin/ruflo mcp exec -t hooks_list -p '{}'                           # Step 12 (CLI exec)
./node_modules/.bin/ruflo mcp exec -t memory_stats -p '{}'                         # Step 13
./node_modules/.bin/ruflo mcp exec -t agentdb_health -p '{}'                       # Step 14
node mcp-stdio-probe.mjs                                                           # Step 15 (JSON-RPC stdio probe)
pgrep -af "$SANDBOX"; find $SANDBOX -type s -o -name '*.pid'                       # Step 16 (cleanup verification)
```

Logs captured (all in `$SANDBOX/`):

- `npm-init.log` — npm init output
- `install.log` — `npm install` output (full)
- `init.log` — `ruflo init --force --no-with-embeddings` output (full)
- `mcp-tools-list-full.log` — `ruflo mcp tools` table output
- `mcp-exec-hooks_list.log`, `mcp-exec-memory_stats.log`, `mcp-exec-agentdb_health.log` — sample tool CLI exec outputs
- `mcp-stdio-probe.mjs` — Node.js JSON-RPC stdio probe (source)
- `mcp-stdio-probe.log` — probe output (initialize + tools/list + 3 × tools/call)

Sandbox path: `/tmp/ruflo-audit-init-mcp-18858`. NOT cleaned up automatically since the audit may want to re-inspect; user can `rm -rf /tmp/ruflo-audit-init-mcp-*` when done.

## Recommendations

1. **F-12-001 (WARN)**: Decide explicitly between (a) removing `"ruflo"` from `@sparkleideas/cli`'s bin so the wrapper always wins, or (b) accepting CLI direct-symlink as functionally equivalent and adding a test asserting both invocation paths reach the same runtime via dynamic import. The current state is order-dependent and silently routes around the wrapper's guards.
2. **F-12-002 (NOTE)**: Wire MCP server initialize handler to report actual `@sparkleideas/cli` package version instead of hardcoded `3.0.0`.
3. **F-12-003 (NOTE)**: Fix init's "Files: N created" counter to match actual file count, or relabel.
4. **F-12-004 (NOTE)**: Reconcile `CLAUDE_FLOW_MEMORY_BACKEND=hybrid` config with the runtime label `SQLite + HNSW`. Either harmonize the label or document that "hybrid" maps to "SQLite + HNSW".

End-to-end runtime: **sound**. All canonical install/init/MCP-boot/tool-call paths produce real data with no errors. Findings are quality-of-life and architectural-consistency items, not functional regressions.
