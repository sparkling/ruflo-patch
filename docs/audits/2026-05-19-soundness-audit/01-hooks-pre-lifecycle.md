# 01 — Pre-execution hooks soundness audit

## Summary

- Hooks audited: 6 (pre-task, pre-edit, pre-command, pretrain, session-start, session-restore)
  - Plus 3 auxiliary surfaces examined: `@claude-flow/hooks` registry + MCP exports, manifest A vs B vs C, `addHook` wrapper at hooks/src/index.ts:233
- Findings: 11 total / 4 critical / 5 warning / 2 note
- Soundness verdict: **FAIL**
- Completeness verdict: **FAIL**
- Bottom line: The pre-* lifecycle is split across two codepaths (`@claude-flow/hooks/src/mcp/*` is dead code; CLI's in-process `cli/src/mcp-tools/hooks-tools.ts` is the only path that ships), the line-233 `require(...)` in an ESM-only package will throw `ReferenceError` if `addHook()` is ever called, two competing hooks.json manifests disagree on PreToolUse matcher coverage (one fires for Bash only, the other for Task / Grep / Glob / Read / MCP too), `pretrain` returns canned multiplier-scaled fake stats, `session-restore` returns a hardcoded 1-hour duration constant, and `pre-edit` / `pre-task` / `session-start` ship silent-catch fallbacks that violate `feedback-no-fallbacks`.

## Findings

### F-01-001 [CRITICAL] ESM-vs-CJS `require()` in `addHook` will crash at call time

- **Location:** `forks/ruflo/v3/@claude-flow/hooks/src/index.ts:233-234`
- **Issue:** Package `"type": "module"` (verified at `package.json:5`) — ESM has no `require` global. `addHook()` calls `require('./registry/index.js')` and `require('./types.js')` synchronously in its body. The function will throw `ReferenceError: require is not defined` on its first call. The bug survives because the function is never called anywhere in the codebase: `grep` for `addHook\b` outside `__tests__/dist/node_modules` returns only its own definition.
- **Evidence:**
  ```ts
  // hooks/src/index.ts:225-242 — body of exported addHook() in an ESM package
  export function addHook(
    event: import('./types.js').HookEvent,
    handler: import('./types.js').HookHandler,
    options?: { ... }
  ): string {
    const { registerHook: register } = require('./registry/index.js');  // line 233
    const { HookPriority } = require('./types.js');                      // line 234
    return register(event, handler, options?.priority ?? HookPriority.Normal, { name: options?.name });
  }
  ```

  Compare with line 218-219, where the sibling `runHook()` function correctly uses dynamic `await import(...)`:

  ```ts
  const { executeHooks } = await import('./executor/index.js');
  ```

- **Impact:** Latent runtime bomb in a public-API helper. Any future caller (or downstream consumer of `@sparkleideas/hooks`) will hit the crash. The function is dead code today but is exported from the package's main entrypoint, so anyone discovering it through TypeScript autocompletion will reach for it and instantly trip the bug.

### F-01-002 [CRITICAL] Two parallel pre-* hook implementations exist; `@claude-flow/hooks/src/mcp/index.ts` is dead code

- **Location:**
  - `forks/ruflo/v3/@claude-flow/hooks/src/mcp/index.ts` (dead — 587 lines exporting `preEditTool`, `preCommandTool`, `postEditTool`, etc.)
  - `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts` (live — 4097 lines, all `hooks_pre-*` MCP tools the CLI actually registers)
- **Issue:** `grep -rn "preEditTool\|preCommandTool"` across the repo (excluding `node_modules`, `dist`, `archive`) returns hits **only inside `@claude-flow/hooks` itself** (`src/index.ts` exports + `src/mcp/index.ts` definition). No CLI module, no MCP-server module, no plugin manifest, no test, and no downstream package imports them. The only consumer of `@claude-flow/hooks`' types is `@claude-flow/guidance/src/hooks.ts`, which uses `HookRegistry` / `HookEvent` types but does NOT touch the MCP-tool exports. Meanwhile, CLI registers a completely separate set of tools (with different names like `hooks_pre-edit` vs `hooks/pre-edit`, different schemas, different handlers).
- **Evidence:** Tool-name divergence — the dead package uses MCP-style namespace separators (`hooks/pre-edit`), the live tooling uses underscore-separated names (`hooks_pre-edit`):
  ```ts
  // DEAD — hooks/src/mcp/index.ts:37
  export const preEditTool: MCPTool = { name: 'hooks/pre-edit', ... };

  // LIVE — cli/src/mcp-tools/hooks-tools.ts:783
  export const hooksPreEdit: MCPTool = { name: 'hooks_pre-edit', ... };
  ```

  And the live registry never references the dead one:
  ```ts
  // cli/src/mcp-client.ts:18 — only imports the live one
  import { hooksTools } from './mcp-tools/hooks-tools.js';
  // No import from '@claude-flow/hooks' or '@claude-flow/hooks/mcp'.
  ```

- **Impact:** ADR-0094-style dead-code surface that confuses readers, gets re-exported under `@sparkleideas/hooks`, drags 587 lines into the published bundle, and (worst) gives the false impression that pre-* hooks have richer schemas + risk-assessment than they really do. Anyone reading `@claude-flow/hooks/src/mcp/index.ts` will see thoughtful tool definitions; the *actual* MCP server runs from `hooks-tools.ts` whose handlers behave quite differently. This is a soundness violation under ADR-0201's "references resolve to something used" criterion.

### F-01-003 [CRITICAL] `hooks_pretrain` returns canned scaled-multiplier stats — no real work performed

- **Location:** `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts:1770-1796`
- **Issue:** The MCP tool's `description` reads `'Analyze repository to bootstrap intelligence (4-step pipeline)'`. The handler does not analyze anything. It picks a multiplier from the `depth` flag (`1` / `2` / `3`) and multiplies hardcoded counts to return fake numbers.
- **Evidence:**
  ```ts
  // hooks-tools.ts:1770-1796 — entire handler body
  handler: async (params: Record<string, unknown>) => {
    const path = (params.path as string) || '.';
    const depth = (params.depth as string) || 'medium';
    const startTime = Date.now();
    const multiplier = depth === 'deep' ? 3 : depth === 'shallow' ? 1 : 2;

    return {
      path, depth,
      stats: {
        filesAnalyzed: 42 * multiplier,
        patternsExtracted: 15 * multiplier,
        strategiesLearned: 8 * multiplier,
        trajectoriesEvaluated: 23 * multiplier,
        contradictionsResolved: 3,
      },
      pipeline: {
        retrieve: { status: 'completed', duration: 120 * multiplier },
        judge: { status: 'completed', duration: 180 * multiplier },
        distill: { status: 'completed', duration: 90 * multiplier },
        consolidate: { status: 'completed', duration: 60 * multiplier },
      },
      duration: Date.now() - startTime + (500 * multiplier),
    };
  },
  ```

  No filesystem read, no controller call (`getController` not invoked), no embedding, no actual retrieve / judge / distill / consolidate. `path` is accepted and echoed back but never opened. `duration` even fabricates an artificial wall-time padding (`+ 500 * multiplier`).

- **Impact:** Anyone calling `hooks pretrain --depth deep --path ./src` gets `filesAnalyzed: 126` regardless of repository size — including when the path doesn't exist. This is a stub masquerading as production code; it directly violates ADR-0201's "Complete" criterion (no stubs).

### F-01-004 [CRITICAL] `hooks_session-restore` returns hardcoded `duration: 3600000` and other fixed values

- **Location:** `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts:2146-2174` (handler) and `2113` (sibling `session-end` duration constant)
- **Issue:** `hooks_session-restore` does load a memory store and count entries (good), but most fields are hardcoded. The advertised contract reads `'Restore a previous session'`. The handler does NOT restore agents, does NOT restore tasks, does NOT re-spawn anything. It returns counts of keys whose strings *contain* `'task'` / `'agent'`, capped at 10/5, with no actual restoration side-effect. `originalSessionId` is faked as `session-${Date.now() - 86400000}` (one day ago) whenever the caller passes `'latest'`. Meanwhile `hooks_session-end:2113` hardcodes `duration: 3600000  // 1 hour in ms` regardless of actual session length.
- **Evidence:**
  ```ts
  // session-restore handler body, lines 2146-2174 (full)
  handler: async (params: Record<string, unknown>) => {
    const requestedId = (params.sessionId as string) || 'latest';
    const restoreAgents = params.restoreAgents !== false;
    const restoreTasks = params.restoreTasks !== false;
    const originalSessionId = requestedId === 'latest'
      ? `session-${Date.now() - 86400000}`   // <-- FAKE
      : requestedId;
    const newSessionId = `session-${Date.now()}`;
    const store = loadMemoryStore();
    const memoryEntryCount = Object.keys(store.entries).length;
    const taskEntries = Object.keys(store.entries).filter(k => k.includes('task')).length;
    const agentEntries = Object.keys(store.entries).filter(k => k.includes('agent')).length;
    return {
      sessionId: newSessionId,
      originalSessionId,
      restoredState: {
        tasksRestored: restoreTasks ? Math.min(taskEntries, 10) : 0,   // counts, not restored
        agentsRestored: restoreAgents ? Math.min(agentEntries, 5) : 0,
        memoryRestored: memoryEntryCount,
      },
      warnings: restoreTasks && taskEntries > 0
        ? [`${Math.min(taskEntries, 2)} tasks were in progress and may need review`]
        : undefined,
      dataSource: 'memory-store',
    };
  },
  ```

  And `session-end` summary lines 2118-2129:
  ```ts
  summary: { tasksExecuted: 12, tasksSucceeded: 10, tasksFailed: 2,
             commandsExecuted: 45, filesModified: 23, agentsSpawned: 5 },
  learningUpdates: { patternsLearned: 8, trajectoriesRecorded: 12, confidenceImproved: 0.05 },
  ```

- **Impact:** Both session-* tools advertise lifecycle behavior they do not perform. `session-restore` is the loadable-state half of `session-end`'s persist-state half; together they should round-trip session state. They do not. `session-end`'s `summary` block is the textbook stub — six fields, all hardcoded constants, returned regardless of what happened in the session. ADR-0201 completeness: FAIL.

### F-01-005 [WARN] Manifest divergence: `.claude-plugin/hooks/hooks.json` (live wiring) vs `plugin/hooks/hooks.json` (richer matchers + schema)

- **Location:**
  - Manifest A: `forks/ruflo/.claude-plugin/hooks/hooks.json` (used by Claude Code's plugin system today)
  - Manifest B: `forks/ruflo/plugin/hooks/hooks.json` (the more complete one — different directory name)
  - Manifest C: `forks/ruflo/plugins/ruflo-core/hooks/hooks.json` (third copy — different again, uses `modify-bash` / `modify-file` hook names that don't exist in CLI)
- **Issue:** Three manifests, all named `hooks.json`, all written for the same product, all diverging.
  - **A** (`.claude-plugin/`) wires only PreToolUse for `Bash` and `Write|Edit|MultiEdit`, plus PostToolUse for the same two, plus PreCompact + Stop. **No pre-task, no pre-search, no MCP pre/post, no SessionStart.** Stop calls `npx @sparkleideas/cli@latest hooks session-end ...`.
  - **B** (`plugin/`) wires PreToolUse for `Task`, `Grep|Glob|Read`, `mcp__claude-flow__.*`, PostToolUse for the same, UserPromptSubmit (route), SessionStart, SubagentStop (LLM evaluation prompt), Notification, PermissionRequest auto-allow. Uses the stdin-jq-xargs anti-injection pattern with timeouts + `continueOnError: true`.
  - **C** (`plugins/ruflo-core/`) refers to `hooks modify-bash` and `hooks modify-file` — neither command exists in `cli/src/commands/hooks.ts`.
- **Evidence:** Run from the audit:
  ```
  $ cat .claude-plugin/hooks/hooks.json | jq '.hooks | keys'
  ["PostToolUse", "PreCompact", "PreToolUse", "Stop"]

  $ cat plugin/hooks/hooks.json | jq '.hooks | keys'
  ["Notification", "PermissionRequest", "PostToolUse", "PreToolUse",
   "SessionStart", "Stop", "SubagentStop", "UserPromptSubmit"]
  ```

  Manifest A also targets `@sparkleideas/cli@latest` while B targets `claude-flow@alpha` — they reach **different npm packages** for the same CLI entry. After ADR-0143 (user-facing brand = `@sparkleideas/ruflo`), neither matches the recommended entrypoint.

- **Impact:** When Claude Code loads the ruflo plugin, exactly one of these files is the live one — the `.claude-plugin/hooks/hooks.json` is the canonical Claude Code plugin manifest location, so it's the live wiring. That means `hooks_pre-task` (the MCP tool that does real model-routing via ADR-026 enhanced-model-router) is **never triggered by tool-use lifecycle** because the live manifest has no `^Task$` matcher. The Task pre-spawn intelligence is completely off in the shipped plugin even though the MCP tool exists. Plus the live manifest uses the legacy `Bash` / `Write|Edit|MultiEdit` matchers without `^...$` anchors — matches like `BashOutput` / `WebFetch` may match the `Bash` regex unintentionally.

### F-01-006 [WARN] Silent-fallback fallbacks in `pre-task`, `pre-edit`, `session-start`, `session-restore` violate `feedback-no-fallbacks`

- **Location:** Multiple sites in `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts`
- **Issue:** Several `try { ... } catch { /* comment */ }` blocks (or `catch {}` with no body) mask controller-init / module-load failures and return a "success" path that misleads the caller. Per `feedback-no-fallbacks`, these are forbidden in this fork unless every catch makes the failure visible to the caller (and "non-critical comment" is not visibility).
- **Evidence:**
  - **`hooks_pre-task` line 1549** — enhanced-model-router failure swallowed entirely:
    ```ts
    try {
      const { getEnhancedModelRouter } = await import('../ruvector/enhanced-model-router.js');
      const router = getEnhancedModelRouter();
      const routeResult = await router.route(description, { filePath });
      // ... 30 lines computing modelRouting
    } catch {
      // Enhanced router not available
    }
    // Falls through and returns with modelRouting=undefined silently
    ```
    If the router throws because RuVector is broken, the caller learns nothing. The whole point of the ADR-026 enhanced model routing is to surface Tier 1 (Agent Booster) bypass opportunities; a silent catch hides exactly that signal.

  - **`hooks_pre-edit` line 805** — `context.fileExists: true` is hardcoded `true` without actually checking the filesystem:
    ```ts
    result.context = {
      fileExists: true,        // <-- never checks fs
      fileType: getFileType(filePath),
      relatedFiles: [],
      similarPatterns: [],
    };
    ```
    Comment in the *dead* `@claude-flow/hooks/src/mcp/index.ts:78` even admits it: `fileExists: true, // Would check fs in real implementation`. The live `hooks-tools.ts` made the same mistake without the candor.

  - **`hooks_session-start` line 2018-2020** — router-not-available silently swallowed:
    ```ts
    } catch {
      // Router not available
    }
    ```
    No log, no surfaced field saying "memory-router unavailable". The caller sees `sessionMemory: { controller: 'none', restoredPatterns: 0 }` and cannot tell whether (a) router truly returned zero or (b) the import crashed.

  - **`hooks_session-restore` line 1659** + similar:
    ```ts
    } catch { /* non-critical */ }
    ```
    Outcome persistence treated as non-critical with no telemetry surfaced.

- **Impact:** When a real bug breaks a controller, the pre-* hooks return apparently-fine results. `feedback-no-fallbacks` is unambiguous: "tests must FAIL when features are broken, not pass via catch/fallback branches." The current pattern passes silently. ADR-0086 Debt 7 history shows this exact pattern hiding a 3-state correctness bug.

### F-01-007 [WARN] `hooks_pre-edit` does not call any controller; no memory-router involvement

- **Location:** `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts:782-820`
- **Issue:** The handler is 27 lines. It calls `suggestAgentsForFile(filePath)` (pure function on extension → agent name) and returns a static object with `relatedFiles: []`, `similarPatterns: []`, `patterns: [{ pattern: '<ext> file editing', confidence: 0.85 }]`. The `0.85` is hardcoded. No vector search, no memory-router call, no pattern lookup. Compare to `hooks_post-edit` which does call `routeFeedbackOp` through the memory router — pre-edit is the inverse direction (read patterns before editing) and should be calling `getController('semanticRouter')` / `causalRecall` for similar files, just like `hooks_route` does.
- **Evidence:**
  ```ts
  // pre-edit handler — full body 794-819
  const filePath = params.filePath as string;
  const operation = (params.operation as string) || 'update';
  const suggestedAgents = suggestAgentsForFile(filePath);  // file-ext → static map
  const ext = getFileExtension(filePath);
  return {
    filePath, operation,
    context: {
      fileExists: true,                       // never checked (F-01-006)
      fileType: ext || 'unknown',
      relatedFiles: [],                       // never populated
      suggestedAgents,
      patterns: [{ pattern: `${ext} file editing`, confidence: 0.85 }],   // canned
      risks: operation === 'delete' ? ['File deletion is irreversible'] : [],
    },
    recommendations: [
      `Recommended agents: ${suggestedAgents.join(', ')}`,
      'Run tests after changes',
    ],
  };
  ```

- **Impact:** The description advertises `"Get context and agent suggestions before editing a file"` — context is not retrieved (`relatedFiles: []`), patterns are not searched. The ReasoningBank / memory-router pipeline that ADR-0084 plumbed through `post-edit` for write-side learning has no read-side counterpart in `pre-edit`. The hook is essentially logging + a hardcoded file-extension lookup table.

### F-01-008 [WARN] `hooks_pre-command` risk assessment is a fixed string-match list with no learning loop

- **Location:** `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts:878-912` (handler) and `739-779` (`assessCommandRisk`)
- **Issue:** `assessCommandRisk` is a substring matcher against a hardcoded list (`['rm -rf', 'format', 'fdisk', ...]` etc.). No call to memory-router, no use of recorded post-command outcomes to update risk, no learning. `hooks_post-command` line 936 *does* write to `routeMemoryOp` under namespace `'commands'`, but pre-command never reads from it. The learning loop is open.
- **Evidence:**
  ```ts
  // pre-command handler does not import memory-router; only call is to a local pure function:
  const assessment = assessCommandRisk(command);
  // assessCommandRisk@739: pure substring matching with no async I/O
  ```

- **Impact:** Pre-command and post-command are advertised as a pair (per the ADR-049 / ADR-0086 wiring comment in post-command). But there's no read-back. Recording outcomes that no one reads is wasted memory traffic. This is a completeness gap: the "self-learning" advertisement requires a closed loop, and the pre-command side of the loop is open.

### F-01-009 [WARN] CLI's `hooks` command bypasses MCP transport entirely — direct in-process function call

- **Location:** `forks/ruflo/v3/@claude-flow/cli/src/mcp-client.ts:156-183`
- **Issue:** The audit slice asked: "Does the CLI hook command route through MCP or bypass to in-process `hooks-tools.ts`?" Confirmed: it bypasses. `callMCPTool` is a misnomer — it looks up the tool in an in-process `Map` (`TOOL_REGISTRY` line 71) and calls `tool.handler(input, context)` synchronously. No JSON-RPC, no stdio/HTTP/WebSocket transport, no MCP protocol framing. The name "MCP client" suggests network behavior; the implementation is dispatch-by-name on a local function table.
- **Evidence:**
  ```ts
  // mcp-client.ts:156-183 — full implementation
  export async function callMCPTool<T = unknown>(toolName, input, context): Promise<T> {
    const tool = TOOL_REGISTRY.get(toolName);
    if (!tool) throw new MCPClientError(`MCP tool not found: ${toolName}`, toolName);
    try {
      const result = await tool.handler(input, context);  // direct local call
      return result as T;
    } catch (error) { ... }
  }
  ```

  And `mcp-server.ts:613-668` reveals that the MCP **server** also calls `callMCPTool` from the same in-process registry — so the "stdio MCP server" path and the "CLI command" path both share the same in-process dispatch.

- **Impact:** Not a bug per se, but a **soundness mismatch with documentation + manifest assumptions**. The plugin manifests B and C invoke `npx claude-flow@alpha hooks pre-edit` as a child-process spawn — that creates a brand-new node process, which loads the entire CLI, which then dispatches via the local registry. So every hook fired by manifest B pays cold-start cost (`npx` resolution + tool registry init). The "MCP transport" framing implies a long-lived server; in reality each hook is a fresh `npx` invocation. The official-bridge / MCP-server lifecycle in `@claude-flow/hooks/src/bridge/` is therefore largely decorative for the shipped hooks pipeline.

### F-01-010 [NOTE] `HookRegistry` in `@claude-flow/hooks/src/registry/index.ts` is only consumed by `@claude-flow/guidance` — almost dead

- **Location:** `forks/ruflo/v3/@claude-flow/hooks/src/registry/index.ts`
- **Issue:** Per the slice's prior recon, the registry was flagged as "possibly dead." Findings: It is consumed by exactly one non-test, non-archive caller — `@claude-flow/guidance/src/hooks.ts:172` (`registerAll(registry: HookRegistry): string[]`). The guidance package wires its own hooks onto a `HookRegistry` instance, but the CLI never instantiates one. The plugins package re-exports a *different* `HookRegistry` class (`@claude-flow/plugins/src/hooks/index.ts:54`, an unrelated `EventEmitter`-based registry), so there are two `HookRegistry` classes in the v3 workspace with no shared base. The hooks-package registry is not entirely dead but its surface area is wildly underused.
- **Evidence:**
  ```
  $ grep -rn "HookRegistry\b" v3 --include="*.ts" | grep -v "node_modules\|dist/\|__tests__"
  # Only hits: @claude-flow/hooks/src/registry/index.ts (definition),
  #            @claude-flow/hooks/src/index.ts (export),
  #            @claude-flow/guidance/src/hooks.ts (sole real consumer),
  #            @claude-flow/plugins/src/hooks/index.ts (unrelated duplicate class).
  ```

- **Impact:** Low-severity dead-code drag. If `@sparkleideas/hooks` is published, it ships ~268 lines of registry that one downstream package uses minimally.

### F-01-011 [NOTE] `hooks_session-start.daemonStatus.error` is a string but the field is omitted from the type when no error occurs

- **Location:** `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts:1964 / 1996-1999`
- **Issue:** `daemonStatus` is typed inline as `{ started: boolean; pid?: number; reused?: boolean; error?: string }` and is initialized to `{ started: false }`. On error path it's reassigned to `{ started: false, error: ... }`. The contract returned to the MCP caller is therefore conditionally shaped — no type discriminant on `started`. This is a minor schema-soundness gap; the MCP tool's input/output schema is not formally validated against this inline type. Other tools advertise `inputSchema` but no `outputSchema`, so consumers have no machine-readable shape contract.
- **Evidence:** Inline type literal at line 1964; no `outputSchema` field on any of the six audited tools (compare with how the dead `@claude-flow/hooks/src/mcp/index.ts` doesn't have one either, so this is symmetric).
- **Impact:** MCP consumers calling these tools have no JSONSchema for what comes back; they parse `JSON.stringify(...)` outputs and hope. Out-of-scope for soundness-of-references, in-scope for completeness-of-API.

## Hooks inventory

| Hook | Handler file | LOC | Sound | Complete | Notes |
|---|---|---|---|---|---|
| `hooks_pre-task` | `cli/src/mcp-tools/hooks-tools.ts` :1490-1574 | 85 | PARTIAL | PARTIAL | Real `suggestAgentsForTask` + enhanced-model-router call, but router failure silently swallowed (F-01-006); never reaches lifecycle because manifest A has no `^Task$` matcher (F-01-005) |
| `hooks_pre-edit` | `cli/src/mcp-tools/hooks-tools.ts` :782-820 | 39 | FAIL | FAIL | `fileExists: true` hardcoded (F-01-006); `relatedFiles: []` never populated; no memory-router involvement (F-01-007); confidence `0.85` canned |
| `hooks_pre-command` | `cli/src/mcp-tools/hooks-tools.ts` :878-912 | 35 | PASS | PARTIAL | Substring matcher works; no learning loop with `post-command` outcomes (F-01-008) |
| `hooks_pretrain` | `cli/src/mcp-tools/hooks-tools.ts` :1759-1797 | 38 | FAIL | FAIL | Pure canned multiplier stats (F-01-003); no filesystem read, no controller call |
| `hooks_session-start` | `cli/src/mcp-tools/hooks-tools.ts` :1947-2041 | 95 | PARTIAL | PARTIAL | PID guard + daemon spawn is real; `restoreLatest` only labels intent — actual restoration is `routeSessionOp({type:'start'})` whose result is silently swallowed on import failure (F-01-006) |
| `hooks_session-restore` | `cli/src/mcp-tools/hooks-tools.ts` :2135-2174 | 40 | FAIL | FAIL | Counts memory-store keys containing `'task'`/`'agent'` substrings, returns counts as "restored" — nothing is actually restored (F-01-004); `originalSessionId` fabricated when caller passes `'latest'` |
| `@claude-flow/hooks/src/mcp/preEditTool` (dead) | `hooks/src/mcp/index.ts` :36-98 | 63 | FAIL | FAIL | Never imported anywhere outside the hooks package (F-01-002) |
| `@claude-flow/hooks/src/mcp/preCommandTool` (dead) | `hooks/src/mcp/index.ts` :283-321 | 39 | FAIL | FAIL | Same — dead surface |
| `@claude-flow/hooks/src/index.addHook` (broken) | `hooks/src/index.ts` :225-242 | 18 | FAIL | N/A | ESM-`require` crash at first call (F-01-001) |

## Method

### Commands run
- `ls -la forks/ruflo/v3/@claude-flow/hooks/src/` (directory survey)
- `cat forks/ruflo/v3/@claude-flow/hooks/package.json` (verified `"type": "module"`)
- `cat .claude-plugin/hooks/hooks.json | jq '.hooks | keys'` and `plugin/hooks/hooks.json | jq '.hooks | keys'` (manifest divergence)
- `diff .claude-plugin/hooks/hooks.json plugin/hooks/hooks.json` (line-by-line manifest delta)
- `find forks/ruflo -name 'hooks.json' -not -path '*/node_modules/*'` (discovered 3rd manifest at `plugins/ruflo-core/hooks/hooks.json`)
- `grep -n "require\b" hooks/src/index.ts` (confirmed line 233 + 234 `require(...)` calls)
- `grep -rn "HookRegistry\|defaultRegistry\|@claude-flow/hooks" v3 --include="*.ts"` (mapped consumers)
- `grep -rn "preEditTool\|preCommandTool\|@claude-flow/hooks/mcp" v3 --include="*.ts"` (confirmed dead-code claim for the hooks/src/mcp/*)
- `grep -n "^export const hooksTools" cli/src/mcp-tools/hooks-tools.ts` (4055 — confirmed which tools ship)
- `grep -n "} catch" cli/src/mcp-tools/hooks-tools.ts` (catalogued all 50+ catch sites; focused on pre-* ones at lines 1549, 1659, 1674, 1896, 1979, 1989, 2018, 2067, 2089)
- `wc -l forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts` (4097 lines confirmed)

### Files read
- `forks/ruflo/v3/@claude-flow/hooks/src/index.ts` (full)
- `forks/ruflo/v3/@claude-flow/hooks/src/registry/index.ts` (full)
- `forks/ruflo/v3/@claude-flow/hooks/src/mcp/index.ts` (full)
- `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts` — lines 782-960 (pre-edit, post-edit, pre-command, post-command), 1442-1488 (hooks_list), 1490-1700 (pre-task, post-task), 1759-1945 (pretrain, build-agents, transfer), 1947-2174 (session-start, session-end, session-restore), 4055-4097 (export array)
- `forks/ruflo/v3/@claude-flow/cli/src/commands/hooks.ts` (lines 1-150, 400-750 — CLI subcommand wiring)
- `forks/ruflo/v3/@claude-flow/cli/src/mcp-client.ts` (lines 1-200 — registry + dispatch)
- `forks/ruflo/v3/@claude-flow/cli/src/mcp-server.ts` (lines 1-120 + grep for hook tool refs)
- `forks/ruflo/.claude-plugin/hooks/hooks.json` (manifest A — full)
- `forks/ruflo/plugin/hooks/hooks.json` (manifest B — full)
- `forks/ruflo/plugins/ruflo-core/hooks/hooks.json` (manifest C — full)

## Recommendations (DO NOT IMPLEMENT)

1. **F-01-001 fix:** Replace `require(...)` in `addHook()` with dynamic `await import(...)` and make the function async, OR delete `addHook` since it has no callers. (Per `feedback-fix-all-tests`, dead code that crashes if anyone trips it is still a bug.)
2. **F-01-002 fix:** Delete `@claude-flow/hooks/src/mcp/index.ts` entirely. Reroute any consumer (none today) to the CLI tools. Remove the corresponding exports from `hooks/src/index.ts` lines 69-82 and the package.json `./mcp` subpath export. The package becomes a types + registry library only.
3. **F-01-003 fix:** Either implement real pretrain (call into the ReasoningBank pipeline that the description advertises — `retrieve` / `judge` / `distill` / `consolidate` are existing controllers in the codebase) OR rename the tool to make it clear it's a stub (e.g., `hooks_pretrain_demo`) so callers don't rely on counts. The current shape violates ADR-0201 "no stubs" completeness.
4. **F-01-004 fix:** `session-restore` needs to actually call `routeSessionOp({type: 'restore', sessionId})` and surface what was restored from controllers (not key-substring counts). `session-end.summary` block should aggregate real telemetry from `sessionMemory.controller` rather than returning constants.
5. **F-01-005 fix:** Reconcile manifests. Pick one canonical location (Claude Code expects `.claude-plugin/hooks/hooks.json`), delete the other two, and bring the merged content forward — specifically: add the `^Task$` matcher to PreToolUse so `hooks_pre-task` actually runs, add `SessionStart` so `session-start` runs at Claude session boot, switch from `@sparkleideas/cli@latest` to `@sparkleideas/ruflo@latest` per ADR-0143, anchor every matcher with `^...$`. Update `package.json` `files` to ship only the canonical path.
6. **F-01-006 fix:** Replace silent `catch {}` blocks with either re-throws (after attempting recovery) or explicit telemetry — emit a structured log line via `console.error` (as `hooks_route` already does at lines 1037, 1070, 1090, 1119) OR surface a `_warning` field in the returned payload. The `feedback-no-fallbacks` principle is non-negotiable in this fork.
7. **F-01-007 fix:** Wire `hooks_pre-edit` through `getController('semanticRouter')` and `getController('causalRecall')` to actually retrieve similar-file context. The fields `relatedFiles` and `similarPatterns` exist in the return type — populate them.
8. **F-01-008 fix:** Have `pre-command` consult the `commands` namespace that `post-command` populates. Either via `routeMemoryOp({type: 'search', namespace: 'commands', query: command})` or via a richer controller. Today's substring-match list is fine as a tier-1 quick check but should be augmented by learned risk.
9. **F-01-009 fix:** Either rename `mcp-client.ts` to `tool-dispatcher.ts` (truth in naming) OR implement an actual MCP client that speaks JSON-RPC to a long-lived stdio server. The current design wastes the MCP framing the bridge layer was built for.
10. **F-01-010 fix:** Either expand `HookRegistry` usage so `cli/src/mcp-tools/hooks-tools.ts` registers through it (giving guidance + plugins a unified registry), OR fold `HookRegistry` into the guidance package and delete it from `@claude-flow/hooks`. Don't keep a published-but-unused public class.
11. **F-01-011 fix:** Add `outputSchema` to every MCP tool definition; treat undefined output shape as an API contract violation.
