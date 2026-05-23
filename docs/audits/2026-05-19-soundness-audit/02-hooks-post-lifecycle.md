# 02 — Post-execution + notification hooks soundness audit

## Summary

- Hooks audited: 7 (post-task, post-edit, post-command, session-end, notify, transfer, metrics)
  - Plus 3 auxiliary surfaces examined: the two divergent shipped manifests (`.claude-plugin/hooks/hooks.json`, `plugin/hooks/hooks.json`), the init-emitted `hook-handler.mjs` helper, and the `cli-core/hooks-defs.ts` thin-subset schema declarations.
- Findings: 13 total / 5 critical / 6 warning / 2 note
- Soundness verdict: **FAIL**
- Completeness verdict: **FAIL**
- Bottom line: All seven hooks are wired through `cli/src/mcp-tools/hooks-tools.ts` and registered in the MCP tool registry (`cli/src/mcp-client.ts:86`), so reference soundness holds at the registry level. However: (1) shipped manifests invoke at least nine CLI flags that are NOT declared on the relevant subcommands and rely on the parser's `allowUnknownFlags: true` to silently drop them — including the previously-flagged `notify --swarm-status`; (2) the two manifests `.claude-plugin/hooks/hooks.json` and `plugin/hooks/hooks.json` disagree on every PostToolUse matcher, on UserPromptSubmit, on Notification, on Stop (one calls `hooks session-end`, the other a `prompt-eval` evaluation prompt), and on which CLI binary to invoke (`@sparkleideas/cli@latest` vs `claude-flow@alpha`); (3) `hooks_session-end` returns hardcoded synthetic `summary` and `learningUpdates` fields (tasksExecuted: 12, patternsLearned: 8, etc.) regardless of real session state; (4) `hooks_transfer` fabricates pattern counts when the source project has no patterns (the "demo-data" fallback); (5) `hooks_notify` is a no-op stub returning a synthetic delivered/recipients shape, with no actual cross-agent transport; (6) the init-emitted `hook-handler.mjs` lacks handlers for `notify`, `post-command`, `pre-edit`, `user-prompt`, `post-tool-failure` even though settings-generator wires hooks that invoke them — they fall through to `console.log('[OK] Hook: ' + command)` and do nothing; (7) `hooks_post-task` synthesizes a `trajectoryId` string instead of finalizing the real trajectory via `hooks_intelligence_trajectory-end`; (8) silent catches per [[feedback-no-fallbacks]] are pervasive (40+ in the file; 11 directly on the audit-scope hooks).

## Findings

### F-02-001 [CRITICAL] `notify --swarm-status` flag is undeclared; parser silently swallows it

- **Location:**
  - manifest: `forks/ruflo/plugin/hooks/hooks.json:184` invokes `npx claude-flow@alpha hooks notify --message '{}' --swarm-status`.
  - CLI: `forks/ruflo/v3/@claude-flow/cli/src/commands/hooks.ts:5180-5187` declares `notifyCommand.options = [message, level, channel]` — no `swarm-status`.
  - parser: `cli/src/parser.ts:555` exports a singleton `commandParser = new CommandParser({ allowUnknownFlags: true })`. Unknown flags are silently accepted.
- **Issue:** Prior recon claim **CONFIRMED**. The Notification hook fires `hooks notify --message ... --swarm-status`; because `allowUnknownFlags: true`, the parser admits `--swarm-status` without complaint; because the `action` handler at lines 5192-5230 only reads `ctx.flags.message`, `ctx.flags.level`, `ctx.flags.channel`, the swarm-status intent is silently dropped. The hook prints the notification and stores a memory entry but never includes any swarm status — the user never gets the feature they declared in the manifest.
- **Impact:** Latent feature-vs-config drift. The manifest asserts intent ("Handle notifications with swarm status") that the implementation fails to honor. This is a textbook [[feedback-no-fallbacks]] violation laundered through the parser's permissive default — failure should be loud (`Unknown option: --swarm-status`), not silent.
- **Evidence:**
  ```json
  // plugin/hooks/hooks.json:182-189
  "Notification": [
    { "description": "Handle notifications with swarm status",
      "hooks": [
        { "type": "command",
          "command": "cat | jq -r '.message // empty' | tr '\\n' '\\0' | xargs -0 -I {} npx claude-flow@alpha hooks notify --message '{}' --swarm-status",
          "timeout": 3000, "continueOnError": true }
      ]
    }
  ]
  ```
  ```ts
  // cli/src/commands/hooks.ts:5180-5187
  const notifyCommand: Command = {
    name: 'notify',
    description: 'Send a notification message (logged to session)',
    options: [
      { name: 'message', short: 'm', type: 'string', ..., required: true },
      { name: 'level', short: 'l', type: 'string', ..., default: 'info' },
      { name: 'channel', short: 'c', type: 'string', ..., default: 'console' },
    ],
    ...
  ```

### F-02-002 [CRITICAL] `.claude-plugin/hooks/hooks.json` and `plugin/hooks/hooks.json` diverge on every meaningful event

- **Location:** Both manifests ship in the published fork tree.
  - `forks/ruflo/.claude-plugin/hooks/hooks.json` — 74 lines
  - `forks/ruflo/plugin/hooks/hooks.json` — 224 lines
- **Issue:** Prior recon claim **CONFIRMED with broader divergence** than reported. The two manifests disagree on every audit-scope event:

  | Event | `.claude-plugin/hooks/hooks.json` | `plugin/hooks/hooks.json` |
  |-------|-----------------------------------|---------------------------|
  | CLI binary | `npx @sparkleideas/cli@latest` | `npx claude-flow@alpha` |
  | PostToolUse / Bash | `post-command --command '{}' --track-metrics true --store-results true` | `post-command --command '{}' --track-metrics true --store-results true` (matches) |
  | PostToolUse / Write\|Edit\|MultiEdit | `post-edit --file '{}' --format true --update-memory true` | `post-edit --file '{}' --train-patterns` |
  | PostToolUse / Task | *(absent)* | `post-task --task-id '{}' --analyze-performance` |
  | PostToolUse / Grep\|Glob\|Read | *(absent)* | `post-search --query '{}' --cache-results` |
  | PostToolUse / mcp__claude-flow__* | *(absent)* | `mcp-post --tool '{}'` |
  | UserPromptSubmit | *(absent)* | `route --task '{}' --include-explanation` |
  | SessionStart | *(absent)* | `session-start --session-id '{}' --load-context` |
  | Notification | *(absent)* | `notify --message '{}' --swarm-status` |
  | Stop | `hooks session-end --generate-summary true --persist-state true --export-metrics true` | `type: "prompt"` with an evaluation prompt-eval |
  | PermissionRequest | *(absent)* | echo allow JSON |

  Beyond the binary name and Stop event divergence (the recon claim), `.claude-plugin/hooks/hooks.json` is **a strict subset** of `plugin/hooks/hooks.json` missing 8 of its events entirely, and the two events it overlaps on (`post-edit`) take different flags (`--format true --update-memory true` vs `--train-patterns`).

- **Impact:** Whichever manifest Claude Code loads governs which post-* lifecycle events fire. `.claude-plugin/hooks/hooks.json` is `claude plugin install`'s manifest per ADR-0117 ([[reference-claude-plugin-install]]); `plugin/hooks/hooks.json` is the legacy plugin location. A user installing via the modern path gets no Notification hook, no SessionStart, no UserPromptSubmit, no Task post-task, no Grep/Glob/Read post-search, and no mcp post-hooks — but they DO get a `hooks session-end --generate-summary true --persist-state true --export-metrics true` invocation whose three flags are all undeclared (see F-02-003).
- **Source of truth:** unclear. Both files are checked in to `forks/ruflo` HEAD. No ADR designates one as canonical.

### F-02-003 [CRITICAL] `session-end --generate-summary --persist-state --export-metrics` flags are all undeclared

- **Location:**
  - manifest: `.claude-plugin/hooks/hooks.json:68` — `npx @sparkleideas/cli@latest hooks session-end --generate-summary true --persist-state true --export-metrics true`
  - CLI: `cli/src/commands/hooks.ts:1996-2007` declares `sessionEndCommand.options = [save-state]` only.
  - parser silently swallows unknown flags ([[F-02-001 reference]]).
- **Issue:** All three flags in the `.claude-plugin` manifest's only Stop hook are undeclared. The CLI accepts them silently (no error), the action body reads only `ctx.flags.saveState`, and the MCP tool handler (`hooks_session-end`) accepts `saveState`, `exportMetrics`, `stopDaemon` per the schema at `cli/src/mcp-tools/hooks-tools.ts:2049-2053` — but `generateSummary` and `persistState` are not in the handler schema either. The full pipeline silently strips three claimed-intent flags. End-users believe they're getting summary generation + state persistence + metric export; they're getting a hardcoded mock summary instead (see F-02-004).
- **Impact:** Same as F-02-001: feature-vs-config drift, [[feedback-no-fallbacks]] violation laundered through parser permissiveness.

### F-02-004 [CRITICAL] `hooks_session-end` returns hardcoded synthetic summary and learningUpdates

- **Location:** `cli/src/mcp-tools/hooks-tools.ts:2111-2130`
- **Issue:** Regardless of the real session, the handler always returns:
  ```ts
  return {
    sessionId, duration: 3600000, // 1 hour in ms
    statePath: ...,
    daemon: { stopped: daemonStopped },
    sessionPersistence: sessionPersistence || { controller: 'none', persisted: false },
    summary: {
      tasksExecuted: 12, tasksSucceeded: 10, tasksFailed: 2,
      commandsExecuted: 45, filesModified: 23, agentsSpawned: 5,
    },
    learningUpdates: {
      patternsLearned: 8, trajectoriesRecorded: 12, confidenceImproved: 0.05,
    },
  };
  ```
  Every numeric in `summary` and `learningUpdates` is a literal constant. The `duration: 3600000` is "1 hour" hardcoded — there's no startTime captured at session-start that the handler could subtract from `Date.now()`. The CLI command at `cli/src/commands/hooks.ts:2042-2057` prints these constants in a "Session Summary" table to the user, presented as actual session statistics.
- **Impact:** Whatever `.claude-plugin/hooks/hooks.json` requests via `--generate-summary true --export-metrics true`, the response is a fabricated 12/10/2/45/23/5 summary. This is not a placeholder reachable only via dev paths — it's the unconditional return value of the function the published manifest invokes on every session end.
- **Sub-issue:** `sessionPersistence` IS wired through `routeSessionOp` (line 2076), so real ReflexionMemory persistence happens. The persisted state is real; the response payload is fictional. The mismatch will confuse anyone parsing the JSON output.

### F-02-005 [CRITICAL] `hooks_notify` is a stub that fabricates delivery/recipients

- **Location:** `cli/src/mcp-tools/hooks-tools.ts:2177-2204`
- **Issue:** The handler returns a hardcoded synthetic shape:
  ```ts
  return {
    notificationId: `notify-${Date.now()}`,
    message, target, priority,
    delivered: true,
    recipients: target === 'all' ? ['coder', 'architect', 'tester', 'reviewer'] : [target],
    timestamp: new Date().toISOString(),
  };
  ```
  There is no cross-agent transport, no message bus call, no swarm publish — `delivered: true` is unconditionally true, `recipients` is a hardcoded list of four agent type names (not actual spawned agents), and the function does no IPC, file write, or queue push of any kind. (The CLI-side `notifyCommand` at `cli/src/commands/hooks.ts:5216-5228` DOES persist the notification to the memory namespace, but that's the CLI layer — it bypasses `hooks_notify` entirely and writes directly via `routeMemoryOp`.) The MCP tool exists only to satisfy registration; calling it via MCP produces nothing real.
- **Impact:** Any consumer that invokes `hooks_notify` via MCP and trusts `delivered: true` will be lied to. There is no actual delivery mechanism. The four hardcoded recipient names are also a hidden coupling — they assume coder/architect/tester/reviewer agent types exist (often they don't, especially after agent specialization changes).
- **No-fallback violation:** This is the worst-case "stub success" — the function pretends to succeed without doing anything. Mirrors the [[feedback-skip-accepted-as-squelch]] pattern at the API level.

### F-02-006 [WARNING] `hooks_transfer` fabricates pattern counts via "demo-data" fallback

- **Location:** `cli/src/mcp-tools/hooks-tools.ts:1908-1942`
- **Issue:** When the source project's memory store is empty (or unreadable — see F-02-013 for the silent catch), the handler injects fake pattern counts:
  ```ts
  // If source has no patterns, provide demo data
  if (Object.values(byType).every(v => v === 0)) {
    byType['file-patterns'] = 8;
    byType['task-routing'] = 12;
    byType['command-risk'] = 5;
    byType['agent-success'] = 15;
  }
  ```
  Then it also fabricates skipped/conflict/duplicate counts via percentage arithmetic on the fake totals:
  ```ts
  skipped: {
    lowConfidence: Math.floor(total * 0.15),
    duplicates: Math.floor(total * 0.08),
    conflicts: Math.floor(total * 0.03),
  },
  stats: { avgConfidence: 0.82 + ..., avgAge: '3 days' },
  ```
  The `dataSource` field IS set to `'demo-data'` when this happens (line 1941), which is partial disclosure — but the user-facing CLI at `cli/src/commands/hooks.ts:1572-1601` does not surface the `dataSource` field in the printed table. They just see "Transferred 40 patterns" with the synthetic by-type breakdown.
- **Impact:** [[feedback-no-fallbacks]] violation — the function silently succeeds with fake numbers rather than reporting "no patterns to transfer." Users get a positive transfer summary without any actual transfer happening.
- **Recommendation note (for ADR-0201 follow-up writers):** consider explicitly returning `{ transferred: { total: 0, byType: {} }, dataSource: 'empty-source' }` and let the CLI render a clear "No patterns to transfer" message.

### F-02-007 [CRITICAL] `hooks_post-task` synthesizes `trajectoryId` instead of finalizing real trajectory

- **Location:** `cli/src/mcp-tools/hooks-tools.ts:1686`
- **Issue:** The handler returns:
  ```ts
  learningUpdates: {
    patternsUpdated: feedbackResult?.updated || (success ? 2 : 1),
    newPatterns: success ? 1 : 0,
    trajectoryId: `traj-${Date.now()}`,   // ← synthetic
    ...
  }
  ```
  This synthetic ID does not correspond to any entry in the real `activeTrajectories` map (declared at line 524). The actual trajectory persistence path is `hooksTrajectoryEnd` at line 2461, which: (a) looks up the trajectory in `activeTrajectories`, (b) calls `getRealStoreFunction()` to persist to AgentDB with a generated embedding, (c) triggers SONA learning + EWC++ consolidation. `hooks_post-task` invokes NONE of this — it calls only `routeFeedbackOp` (feedback record) and `routeCausalOp` (causal edge). Real trajectory finalization happens only if the caller orchestrates the full `trajectory-start → trajectory-step → trajectory-end` sequence directly via MCP. The line-1435 self-documenting `_note: 'Run hooks_post-task / hooks_intelligence_trajectory-end / hooks_route to populate'` acknowledges this gap.
- **Impact:** Post-task does NOT do "real work" per the ADR-0201 completeness definition. The shipped manifests' `post-task --task-id '{}' --analyze-performance` invocation cannot finalize a trajectory because the manifest doesn't pass a trajectory-start handle and the handler can't reconstruct one. The `learningUpdates.trajectoryId` field is a cosmetic placeholder that misleads downstream consumers expecting a queryable ID.
- **Sub-issue (warning):** `patternsUpdated: feedbackResult?.updated || (success ? 2 : 1)` — when `routeFeedbackOp` returns 0 updates (real), the OR-fallback produces hardcoded `2` (success) or `1` (failure). The synthetic numbers shadow real telemetry.

### F-02-008 [CRITICAL] init-generated `hook-handler.mjs` lacks handlers for notify / post-command / pre-edit / user-prompt / post-tool-failure; settings-generator wires them anyway

- **Location:**
  - `cli/src/init/settings-generator.ts:323-579` registers hooks for `pre-bash`, `pre-edit`, `pre-task`, `post-edit`, `post-command`, `post-task`, `route`, `user-prompt`, `session-restore`, `session-end`, `compact-manual`, `compact-auto`, `status`, `teammate-idle`, `post-tool-failure`, `notify`.
  - `cli/src/init/helpers-generator.ts:369-601` generates `hook-handler.mjs` with handlers for **only** `route`, `pre-bash`, `post-edit`, `session-restore`, `session-end`, `pre-task`, `post-task`, `compact-manual`, `compact-auto`, `status`, `stats`.
  - Fallthrough at `helpers-generator.ts:590-592`: `else if (command) { console.log('[OK] Hook: ' + command); }`.
- **Issue:** When `ruflo init` writes the user's `.claude/settings.json`, it wires hooks pointing to subcommands the locally-generated `hook-handler.mjs` does not implement. Specifically: `pre-edit`, `post-command`, `notify`, `user-prompt`, `teammate-idle`, `post-tool-failure`. Each unmatched subcommand falls through to a generic `[OK] Hook: ' + command'` print and otherwise does nothing.

  Concrete examples:
  - `post-command` is wired for every Bash invocation (`settings-generator.ts:383`). User runs `npm test` → hook fires → no-op.
  - `notify` is wired for every Notification event (`settings-generator.ts:573`). Claude Code emits a notification → hook fires → no-op.
  - `pre-edit` is wired for Write/Edit/MultiEdit (`settings-generator.ts:347`). Every file edit triggers a no-op.
- **Impact:** Quietly broken. Users see `[OK] Hook: post-command` lines in stderr (or `--quiet` mode hides them) and assume the hook ran. It didn't.
- **Subnote:** The init-generated `intelligence.cjs` minimal stub at `helpers-generator.ts:806-808` has `feedback: function(success) { /* Stub: no-op in minimal version */ }`, so even the wired `post-task` is half-real — it routes through `intelligence.feedback(true)` (hardcoded `true`, ignoring the actual outcome) and that's a no-op anyway.

### F-02-009 [WARNING] `post-task` hardcodes `intelligence.feedback(true)` regardless of actual outcome

- **Location:** `cli/src/init/helpers-generator.ts:543-549`
- **Issue:** The init-emitted hook-handler.mjs `post-task` handler:
  ```js
  'post-task': () => {
    if (intelligence && intelligence.feedback) {
      try {
        intelligence.feedback(true);   // ← always true, even for failed tasks
      } catch (e) { console.error(`[FAIL] hook-handler.post-task.feedback: ${e?.message || e}`); }
    }
    console.log('[OK] Task completed');
  },
  ```
  Even when the upstream Task tool returns a failure, this handler records a positive feedback. There's no plumbing of `success` from the hook payload to `intelligence.feedback()`.
- **Impact:** If `intelligence.feedback` is ever upgraded from the stub no-op to a real signal-recording function, this would poison the learning signal — every task would be recorded as successful regardless of actual outcome.

### F-02-010 [WARNING] `cli-core/hooks-defs.ts` schemas drift from real handler params

- **Location:**
  - `cli-core/src/mcp-tools/hooks-defs.ts:59-65` (post-task) declares `taskId`, `success`, `storeResults`.
  - `cli-core/src/mcp-tools/hooks-defs.ts:72-80` (post-edit) declares `file`, `success`, `trainNeural`.
  - But the live handler at `cli/src/mcp-tools/hooks-tools.ts:1587-1589` reads `storeDecisions` (not `storeResults`).
  - And the live handler at `cli/src/mcp-tools/hooks-tools.ts:825-833` accepts `filePath`, `success`, `agent` — no `trainNeural`, no `file`.
- **Issue:** cli-core ships a "thin subset" of MCP tool *definitions* without handlers (per the file's own comment at line 12 — "If a session needs a hooks_* not in this list, it falls through to @claude-flow/cli@alpha"). The definitions are intended to advertise the tool surface for tools/list responses while deferring handlers. But the schemas advertised disagree with the handlers cli-core delegates to: a downstream consumer wiring to `storeResults: true` per cli-core's declared schema will see their flag silently dropped by cli's handler, which reads only `storeDecisions`. Same for `trainNeural`. The handler at cli also expects `filePath` (camel-case) where cli-core declares `file` — flag name mismatch.
- **Impact:** Schema-vs-handler drift. The two repos look correct in isolation but fail to compose. Consumers using cli-core's published schema will see undefined runtime behavior of "advertised options."

### F-02-011 [WARNING] Pervasive silent catches in audit-scope handlers — [[feedback-no-fallbacks]] violations

- **Location:** Counted in `cli/src/mcp-tools/hooks-tools.ts`:
  - `hooks_post-task`: lines 1659 (`catch { /* non-critical */ }`), 1674 (same), 1896 (during transfer source-store load with empty fallback).
  - `hooks_post-edit`: lines 855 — re-throws as a `Fix: bridgeFallback` message; THIS one is actually fail-loud per HK-002a; not a violation.
  - `hooks_post-command`: line 944 — re-throws fail-loud per HK-002b; not a violation.
  - `hooks_session-end`: lines 2067 (`catch { /* Daemon may not be running */ }`), 2089 (`catch { /* Router not available */ }`), 2107 (console.error then proceed — has signal but doesn't propagate).
  - `hooks_transfer`: line 1896 (`catch { /* Fall back to empty store */ }`).
  - `hooks_metrics`: lines 1387 (`catch { /* non-fatal */ }`).
- **Issue:** Six audit-scope silent catches in addition to the structured fail-loud paths. The fail-loud pattern (re-throw with a `Fix:` hint) is the correct one — the `routeFeedbackOp` / `routeMemoryOp` failures in `post-edit` / `post-command` follow it. But the post-task outcome persistence (line 1659, 1674), session-end daemon-not-running (line 2067), session-end router-not-available (line 2089), and transfer empty-store (line 1896) catches are all the squelch shape.
  - The session-end "Daemon may not be running" comment is at least honest about the swallow, but it commits the same anti-pattern as [[feedback-skip-accepted-as-squelch]]: a `legit skip` for known absence is acceptable, but this catches ALL errors from `stopDaemon()`, including authentic failures during shutdown.
- **Impact:** Test failures masquerade as success — exactly what [[feedback-no-fallbacks]] forbids.

### F-02-012 [NOTE] `hooks_metrics` is mostly real but hardcodes performance marketing strings

- **Location:** `cli/src/mcp-tools/hooks-tools.ts:1425-1430`
- **Issue:** Real telemetry IS pulled (patterns/agents/commands from `.swarm/sona-patterns.json` and `.ruvector/intelligence.json`). Two issues:
  ```ts
  performance: {
    flashAttention: '2.49x-7.47x speedup',
    memoryReduction: '50-75% reduction',
    searchImprovement: '150x-12,500x faster',
    tokenReduction: '32.3% fewer tokens',
  },
  ```
  These are hardcoded marketing strings, not measured numbers — the dashboard claims a `2.49x-7.47x` Flash Attention speedup as if it were a runtime metric. The numbers are not even unit-typed (they're string ranges).
  And line 1370: `avgRiskScore: 0.15` — hardcoded constant rather than computed.
- **Impact:** Low severity since the real metrics flow IS wired and dominates the dashboard. But the "performance" section is decorative copy that bypasses the user's actual workload. If a user reports "your speedup numbers are wrong," there's no way to surface real numbers because no real measurement exists.

### F-02-013 [NOTE] `Notification → PostTask` bridge mapping is a stale legacy artifact

- **Location:** `forks/ruflo/v3/@claude-flow/hooks/src/bridge/official-hooks-bridge.ts:274`
- **Issue:** `OfficialHooksBridge` maps Claude Code's `Notification` event to V3's `HookEvent.PostTask` with the comment `// Closest match`. This bridge is dead code in the current architecture: published manifests invoke the CLI directly via shell, not through the in-process bridge, so this mapping is never consulted. But if a future consumer wires up the bridge, the mapping will silently route Notification events into PostTask handlers (which neither understand nor want them).
- **Impact:** Not load-bearing today (no consumer), but a future trap. Cross-references F-01-002's "dead-code in hooks package" finding — same package, same dead-by-default status.

## Inventory

### Audit-scope hook surfaces

| Surface | File | Lines | Live? |
|---------|------|-------|-------|
| `notifyCommand` (CLI) | `cli/src/commands/hooks.ts` | 5180-5232 | Live |
| `postTaskCommand` (CLI) | `cli/src/commands/hooks.ts` | 1899-1993 | Live |
| `postEditCommand` (CLI) | `cli/src/commands/hooks.ts` | 394-503 | Live |
| `postCommandCommand` (CLI) | `cli/src/commands/hooks.ts` | 622-712 | Live |
| `sessionEndCommand` (CLI) | `cli/src/commands/hooks.ts` | 1996-2074 | Live |
| `transferCommand` (CLI) | `cli/src/commands/hooks.ts` | 1619-1653 | Live (delegates to subcmd) |
| `transferFromProjectCommand` (CLI) | `cli/src/commands/hooks.ts` | 1496-1616 | Live |
| `metricsCommand` (CLI) | `cli/src/commands/hooks.ts` | 1304-1494 | Live |
| `hooksNotify` (MCP) | `cli/src/mcp-tools/hooks-tools.ts` | 2177-2204 | Stub |
| `hooksPostTask` (MCP) | `cli/src/mcp-tools/hooks-tools.ts` | 1576-1699 | Partial (real feedback, synthetic trajectory ID) |
| `hooksPostEdit` (MCP) | `cli/src/mcp-tools/hooks-tools.ts` | 822-876 | Real (fail-loud) |
| `hooksPostCommand` (MCP) | `cli/src/mcp-tools/hooks-tools.ts` | 914-959 | Real (fail-loud) |
| `hooksSessionEnd` (MCP) | `cli/src/mcp-tools/hooks-tools.ts` | 2044-2132 | Partial (real persistence + daemon, synthetic summary) |
| `hooksTransfer` (MCP) | `cli/src/mcp-tools/hooks-tools.ts` | 1871-1944 | Partial (demo-data fallback) |
| `hooksMetrics` (MCP) | `cli/src/mcp-tools/hooks-tools.ts` | 1306-1440 | Mostly real (synthetic performance strings) |
| Init-emitted handler | `cli/src/init/helpers-generator.ts:generateHookHandler` | 369-601 | Live; missing 6 subcommands |
| Settings-generator | `cli/src/init/settings-generator.ts:generateHooksConfig` | 323-584 | Live; wires 16 subcommands |
| `.claude-plugin` manifest | `forks/ruflo/.claude-plugin/hooks/hooks.json` | 74 lines | Live |
| `plugin/hooks` manifest | `forks/ruflo/plugin/hooks/hooks.json` | 224 lines | Live (legacy?) |
| Bridge mapping | `@claude-flow/hooks/src/bridge/official-hooks-bridge.ts` | 269-281 | Dead code |

### Tool-registry wiring (confirmed)

`cli/src/mcp-client.ts:71-116` registers `hooksTools` (from `cli/src/mcp-tools/hooks-tools.ts:4055-4095`) in `TOOL_REGISTRY`. All seven audit-scope tools (`hooksPostTask`, `hooksPostEdit`, `hooksPostCommand`, `hooksSessionEnd`, `hooksNotify`, `hooksTransfer`, `hooksMetrics`) are in the exported array. Reference soundness at the registry level holds.

### Undeclared-flag inventory (manifest-vs-CLI mismatch)

| Manifest | Subcommand | Undeclared flags |
|----------|------------|------------------|
| `plugin/hooks/hooks.json` | `notify` | `--swarm-status` |
| `plugin/hooks/hooks.json` | `post-edit` | `--train-patterns` |
| `plugin/hooks/hooks.json` | `post-command` | `--track-metrics`, `--store-results` |
| `plugin/hooks/hooks.json` | `post-task` | `--analyze-performance` |
| `.claude-plugin/hooks/hooks.json` | `post-edit` | `--format`, `--update-memory` |
| `.claude-plugin/hooks/hooks.json` | `post-command` | `--track-metrics`, `--store-results` |
| `.claude-plugin/hooks/hooks.json` | `session-end` | `--generate-summary`, `--persist-state`, `--export-metrics` |

All silently accepted by `cli/src/parser.ts:555` (`allowUnknownFlags: true`). All silently dropped by the corresponding handlers.

## Method

- Read `.claude-plugin/hooks/hooks.json` and `plugin/hooks/hooks.json` end-to-end.
- Found CLI handlers via `grep -n "^const \|^export const " cli/src/commands/hooks.ts` for full handler inventory.
- Read each post-* / notify / transfer / metrics handler body in full to check option declarations vs invocations.
- Verified parser permissive behavior at `cli/src/parser.ts:534-544` + singleton config at line 555.
- Read all corresponding MCP tool handlers in `cli/src/mcp-tools/hooks-tools.ts` (`hooksPostEdit`, `hooksPostCommand`, `hooksPostTask`, `hooksSessionEnd`, `hooksTransfer`, `hooksMetrics`, `hooksNotify`) for stub-vs-real determination.
- Confirmed registry wiring via `cli/src/mcp-client.ts:81-116` and `cli/src/mcp-tools/hooks-tools.ts:4055-4095`.
- Cross-checked `cli-core/src/mcp-tools/hooks-defs.ts` declared schemas vs `cli/src/mcp-tools/hooks-tools.ts` handler reads for `post-task` and `post-edit`.
- Walked the init pipeline: `settings-generator.ts:generateHooksConfig` → emitted commands → `helpers-generator.ts:generateHookHandler` body → handler key list.
- Counted silent catches via `grep -n "catch.*{\s*\/\*\|catch.*{\s*$"` in `hooks-tools.ts`.
- No tests executed (static audit per ADR-0201 scope; no source modifications per task contract).

## Recommendations

(Per task instructions, do NOT fix anything. These are flagged for the parent agent.)

1. **F-02-001, F-02-003 / undeclared flags:** Either (a) declare every flag the shipped manifests pass, or (b) flip the parser to `allowUnknownFlags: false` for the `hooks` subcommand tree. Option (a) is the minimal-blast-radius fix; option (b) surfaces every undeclared-flag site loudly. The shipped flags imply features (`--swarm-status`, `--generate-summary`, `--persist-state`, `--export-metrics`, `--train-patterns`, `--track-metrics`, `--store-results`, `--analyze-performance`, `--update-memory`) that should either be implemented or removed from the manifest.
2. **F-02-002 / manifest divergence:** Pick one as canonical; document the choice in an ADR (cf. ADR-0117 [[project-adr0117-rebrand.md]]). Delete the other or designate it as a strict mirror generated from the canonical. The split state with two diverged sources is a maintenance trap.
3. **F-02-004 / hardcoded session-end summary:** Either pull real values from a session-state store (the daemon already tracks much of this) or remove `summary` and `learningUpdates` from the response shape. Don't lie in JSON.
4. **F-02-005 / `hooks_notify` stub:** Decide whether cross-agent notification is in scope. If yes, wire to swarm bus; if no, return `{ delivered: false, reason: 'not-implemented' }` (or remove the tool from `hooksTools`). The current shape is a marketing-success stub.
5. **F-02-006 / transfer demo-data:** Replace the synthetic fallback with an honest zero-pattern response. Move the `dataSource: 'demo-data'` disclosure to be load-bearing in the CLI output table.
6. **F-02-007 / post-task trajectoryId:** Either wire `post-task` to `trajectory-end` (probably via an implicit `activeTrajectories` lookup keyed by taskId) or remove `trajectoryId` from the response shape. The current fake-ID return misleads callers expecting a queryable handle.
7. **F-02-008 / init handler gaps:** Generate handlers for `notify`, `post-command`, `pre-edit`, `user-prompt`, `post-tool-failure`, `teammate-idle` in `helpers-generator.ts`. Or, conversely, remove those subcommand wirings from `settings-generator.ts`. Don't ship a settings.json that points at non-existent handlers.
8. **F-02-009 / `feedback(true)` always:** Plumb the actual success flag through to `intelligence.feedback(success)` in the init-emitted `hook-handler.mjs`.
9. **F-02-010 / cli-core schema drift:** Either align cli-core's `hooks-defs.ts` schemas with the cli handler reads, or define the cli-core schemas as authoritative and update the handler. Pick one direction.
10. **F-02-011 / silent catches:** Audit each `catch { /* comment */ }` site against [[feedback-no-fallbacks]]. Convert legit-absence catches to typed-result returns; convert squelches to fail-loud `throw new Error("Fix: ...")`.
11. **F-02-012 / hardcoded performance marketing strings:** Either compute real numbers via benchmarking the local environment, or drop the `performance` section from `hooks_metrics`. Don't ship copy that looks like telemetry.
12. **F-02-013 / dead bridge mapping:** If the bridge is permanently dead code (cf. F-01-002), delete the package. If it's intended to be revived, fix the `Notification → PostTask` "closest match" mapping to either a dedicated event or a no-op.
