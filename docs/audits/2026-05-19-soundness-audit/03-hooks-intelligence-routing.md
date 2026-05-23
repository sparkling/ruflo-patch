# 03 — Intelligence / routing / model / worker hooks soundness audit

## Summary

- Tools audited: 19 in scope
  - Intelligence cluster (9): `hooks_intelligence`, `hooks_intelligence-reset`, `hooks_intelligence_trajectory-start`, `hooks_intelligence_trajectory-step`, `hooks_intelligence_trajectory-end`, `hooks_intelligence_pattern-store`, `hooks_intelligence_pattern-search`, `hooks_intelligence_stats`, `hooks_intelligence_learn`, `hooks_intelligence_attention`
  - Routing (3): `hooks_route`, `hooks_model-route`, `hooks_model-outcome`, `hooks_model-stats`
  - Worker dispatch (5): `hooks_worker-list`, `hooks_worker-dispatch`, `hooks_worker-status`, `hooks_worker-detect`, `hooks_worker-cancel`
  - Lifecycle/inventory (5): `hooks_explain`, `hooks_init`, `hooks_list`, `hooks_build-agents`, `hooks_pretrain`
- Findings: 18 total / 7 CRITICAL / 7 WARN / 4 NOTE
- Soundness verdict: **PARTIAL** (real handlers exist; many references resolve but several depend on unreachable singletons via silent-catch fall-through)
- Completeness verdict: **FAIL** (multiple production-shipped tools return hardcoded fake values labeled as real metrics)
- Bottom line: The recon claim is **CONFIRMED** — `HookExecutor`, `HookRegistry`, `@claude-flow/hooks/src/mcp/*`, `@claude-flow/hooks/src/workers/*`, `@claude-flow/hooks/src/llm/*` are entirely unreached by the CLI hooks pipeline (zero imports from `cli/src/`). The CLI calls `callMCPTool` → in-process `TOOL_REGISTRY` dispatch → `cli/src/mcp-tools/hooks-tools.ts` (4,097 LOC) which contains the only handlers that ship. Inside that file: `hooks_route` is genuinely sophisticated (5-tier graceful-degradation through SolverBandit / SkillLibrary / LearningSystem / SemanticRouter / static patterns with documented ADR-0191 fall-through logging), and the trajectory + pattern-store / pattern-search + intelligence_stats handlers do real I/O against memory-router controllers. But `hooks_intelligence-reset` returns hardcoded `156 / 89 / 12500` cleared-counts that nothing was actually cleared; `hooks_explain` returns hardcoded `0.87` historical-success rates and `0.85 + Math.random()` patterns; `hooks_pretrain` multiplies hardcoded constants by depth — no analysis; `hooks_init` claims to write `.claude/settings.json` and returns the path without writing anything; `hooks_list` returns a hardcoded 26-entry static array claiming everything is `status: 'active'`; `hooks_build-agents` ships hardcoded agent capabilities; `hooks_model-route` falls through to a heuristic when the router import fails (silent-catch); the `hooks_worker-detect` auto-dispatch path still uses fake `setTimeout(1500)` to flip workers to `completed`. The audit question "does model-route always return 'general-purpose'?" is **REFUTED** — the real path uses `tiny-dancer-neural` via `getModelRouter()`; but the fallback heuristic on import-fail is a silent reduction.

## Findings

### F-03-001 [CRITICAL] HookExecutor / HookRegistry / @claude-flow/hooks/{mcp,workers,llm} are entirely dead — confirms prior recon

- **Location:**
  - `forks/ruflo/v3/@claude-flow/hooks/src/executor/index.ts` (420 LOC — `HookExecutor` class)
  - `forks/ruflo/v3/@claude-flow/hooks/src/registry/index.ts` (267 LOC — `HookRegistry` class)
  - `forks/ruflo/v3/@claude-flow/hooks/src/mcp/index.ts` (586 LOC — `routeTaskTool` etc., 9 tools using `hooks/<name>` namespace)
  - `forks/ruflo/v3/@claude-flow/hooks/src/workers/index.ts` + `mcp-tools.ts` + `session-hook.ts` (2,758 LOC combined — `workerMCPTools`, `workerRunTool`, etc.)
  - `forks/ruflo/v3/@claude-flow/hooks/src/llm/llm-hooks.ts` (552 LOC — `preLLMCallHook`, `postLLMCallHook`, `errorLLMCallHook`, `llmHooks` default)
- **Issue:** The recon hypothesis was: "HookExecutor architecture is dead; CLI bypasses via `callMCPTool` → in-process `hooks-tools.ts`." Verified by exhaustive grep:
  ```
  $ grep -rn "from.*@claude-flow/hooks\b" forks/ruflo/v3/@claude-flow/cli/src/
  # zero matches
  $ grep -rn "HookExecutor\|new HookExecutor" forks/ruflo/v3/@claude-flow/cli/src/
  # zero matches
  $ grep -rn "workerMCPTools\|workerRunTool" forks/ruflo/v3/@claude-flow/ --include="*.ts" | grep -v __tests__ | grep -v "/dist/"
  # only definitions + re-export from hooks/src/index.ts — no consumer
  ```
  The `@claude-flow/hooks` package as a whole is consumed transitively only by `@claude-flow/guidance/src/hooks.ts` (uses `HookRegistry` type) and the unrelated `@claude-flow/plugins` (uses its OWN `HookRegistry`, different class). Nothing in `cli/src/` touches it.
- **Evidence:** `mcp-client.ts:18` imports only `'./mcp-tools/hooks-tools.js'`, the in-process registry. The "MCP server" code in `cli/src/mcp-server.ts` also uses the same `callMCPTool` dispatch (per F-01-009 from the pre-lifecycle audit). Tool-name divergence proves the parallel implementations don't overlap: dead path uses `hooks/route` (slash), live path uses `hooks_route` (underscore). All 19 tools in this audit's scope are defined in `hooks-tools.ts` with `hooks_*` names; none of the `hooks/<x>` variants in `hooks/src/mcp/index.ts` are reachable.
- **Impact:** ~4,500 LOC of dead surface (executor 420 + registry 267 + mcp 586 + workers 2,758 + llm 552) ships in `@sparkleideas/hooks`. The dead `@claude-flow/hooks/src/mcp/index.ts:478-555` `routeTaskToAgent` function uses a switch of hardcoded confidence values (`0.92` for "security", `0.89` for "test", `0.87` for "review", `0.80` default) — anyone reading the package thinks routing is keyword-buckets with fixed confidences; the real routing in `hooks-tools.ts` is a 5-tier graceful-degradation pipeline. ADR-0201 soundness "references resolve to something used": FAIL for the package as a whole. Note: this finding overlaps F-01-002 from the pre-lifecycle audit but extends it to the workers, executor, and llm subdirectories which the prior audit didn't enumerate.

### F-03-002 [CRITICAL] `hooks_explain` returns hardcoded fake confidence values + `Math.random()` patterns

- **Location:** `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts:1702-1756`
- **Issue:** The MCP description is `'Explain routing decision with full transparency'`. The handler claims to surface decision factors (keyword match, historical success, agent availability, task complexity) with weights and values. Several of those values are constants, and the matched-pattern scores are `0.85 + Math.random() * 0.1`.
- **Evidence:**
  ```ts
  // hooks-tools.ts:1720-1729
  for (const [pattern, _result] of Object.entries(TASK_PATTERNS)) {
    if (taskLower.includes(pattern)) {
      matchedPatterns.push({
        pattern,
        matchScore: 0.85 + Math.random() * 0.1,                  // <-- random fake
        examples: [
          `Previous ${pattern} task completed successfully`,     // <-- canned string
          `${pattern} patterns from repository analysis`,        // <-- canned string
        ],
      });
    }
  }
  // lines 1735-1740
  factors: [
    { factor: 'Keyword Match', weight: 0.4, value: suggestion.confidence, impact: 'Primary routing signal' },
    { factor: 'Historical Success', weight: 0.3, value: 0.87, impact: 'Past task success rate' }, // <-- hardcoded 0.87
    { factor: 'Agent Availability', weight: 0.2, value: 0.95, impact: 'All suggested agents available' }, // <-- 0.95
    { factor: 'Task Complexity', weight: 0.1, value: task.length > 100 ? 0.8 : 0.3, impact: 'Complexity assessment' },
  ],
  // line 1750
  `Historical success rate for similar tasks: 87%`, // <-- literal string
  ```
- **Impact:** The tool's contract is "transparency about the decision." It actively misleads: every caller sees "Historical success rate: 87%" regardless of actual outcomes. `Math.random()` in the matchScore makes the output non-deterministic; running `hooks_explain` twice on the same task yields different "match scores." ADR-0201 completeness FAIL; non-determinism violates the "evidence not language" principle from the project memory `feedback-corpus-evidence-before-feature-work`.

### F-03-003 [CRITICAL] `hooks_intelligence-reset` returns hardcoded `cleared` counts; nothing is actually reset

- **Location:** `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts:2354-2372`
- **Issue:** The MCP tool's description is `'Reset intelligence learning state'`. The handler accepts no parameters, performs zero side effects, and returns:
  ```ts
  return {
    reset: true,
    cleared: {
      trajectories: 156,    // <-- hardcoded
      patterns: 89,         // <-- hardcoded
      hnswIndex: 12500,     // <-- hardcoded
    },
    timestamp: new Date().toISOString(),
  };
  ```
  No call to `activeTrajectories.clear()` (the in-process Map at `hooks-tools.ts:564`); no call to `sona.reset()`; no call to `routeMemoryOp({type:'delete', namespace:'trajectories'})`; no call to ReasoningBank purge; no filesystem unlink of `.swarm/sona-patterns.json` or `.ruvector/intelligence.json` (the two stores read by `hooks_metrics`).
- **Evidence:** Full handler body is 12 lines, all literals + a timestamp. CLI surfaces this at `cli/src/commands/hooks.ts:2262` via `await callMCPTool('hooks_intelligence-reset', {})` — the wrapper trusts the return and prints "reset complete" to the user.
- **Impact:** Direct violation of the "no stubs" rule (ADR-0201) and `feedback-skip-accepted-as-squelch`: this is exactly "architectural gap, deferred" disguised as a working tool. Users running `claude-flow hooks intelligence-reset` get a green checkmark while their trajectory store remains intact. Worse, the numbers are oddly specific (`156`, `89`, `12500`) which makes the lie convincing.

### F-03-004 [CRITICAL] `hooks_pretrain` re-confirmed as multiplier-on-constants stub

- **Location:** `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts:1759-1796`
- **Issue:** Identical to F-01-003 from the pre-lifecycle audit; recorded again here because this audit's scope explicitly includes `hooks_pretrain` and the finding generalizes to **all four "intelligence bootstrap" tools** (`pretrain`, `build-agents`, `transfer`, `init`). Handler picks a multiplier from depth (`1`/`2`/`3`), multiplies hardcoded constants, and returns. No filesystem read, no controller call, no embedding.
- **Evidence:** Per F-01-003. Specifically:
  ```ts
  filesAnalyzed: 42 * multiplier,
  patternsExtracted: 15 * multiplier,
  strategiesLearned: 8 * multiplier,
  ```
  None of those counts derive from actual repository state. Calling `hooks_pretrain --path /nonexistent` returns `filesAnalyzed: 84` for depth=medium (`42*2`) — a path that doesn't exist still "analyzed 84 files."
- **Impact:** Listed in the scope summary as both a soundness and completeness FAIL. Pre-lifecycle audit recommended either implementing the documented `retrieve / judge / distill / consolidate` pipeline or renaming to make the stub status explicit. Strongly seconded here.

### F-03-005 [CRITICAL] `hooks_init` claims to write `.claude/settings.json` and `.claude/hooks` — does not

- **Location:** `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts:2208-2246`
- **Issue:** The MCP description is `'Initialize hooks in project with .claude/settings.json'`. Handler returns `created: { settingsJson: '${path}/.claude/settings.json', hooksDir: '${path}/.claude/hooks' }` but contains no `writeFileSync`, no `mkdirSync`, no filesystem mutation at all. `hooksConfigured` is hardcoded ternary on template name (`4` / `9` / `16`).
- **Evidence:**
  ```ts
  // hooks-tools.ts:2219-2245 — entire handler
  handler: async (params: Record<string, unknown>) => {
    const path = (params.path as string) || '.';
    const template = (params.template as string) || 'standard';
    const force = params.force as boolean;
    const hooksConfigured = template === 'minimal' ? 4 : template === 'full' ? 16 : 9;
    return {
      path, template,
      created: {
        settingsJson: `${path}/.claude/settings.json`,
        hooksDir: `${path}/.claude/hooks`,
      },
      hooks: {
        configured: hooksConfigured,
        types: ['PreToolUse', 'PostToolUse', 'SessionStart', 'SessionEnd'],
      },
      intelligence: { enabled: template !== 'minimal', sona: template === 'full', moe: template === 'full', hnsw: template !== 'minimal' },
      overwritten: force,
    };
  },
  ```
  Compare with `hooksBuildAgents` (line 1832-1853) which does call `mkdirSync` + `writeFileSync` — so the pattern of filesystem persistence exists in this file. `hooks_init` is missing it.
- **Impact:** The CLI wrapper at `commands/hooks.ts` calls this and reports "hooks initialized" to the user; the user runs `ls .claude/settings.json` and finds nothing. Worse, the real init flow lives elsewhere (`memory init` / `init` command in `commands/init.ts`); `hooks_init` advertises an init that doesn't exist as an isolated tool. If users have come to rely on the printed "configured: 9" number, they have been seeing a hardcoded constant the whole time.

### F-03-006 [CRITICAL] `hooks_list` returns hardcoded static array — no runtime registry consultation

- **Location:** `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts:1442-1488`
- **Issue:** The MCP description is `'List all registered hooks'`. Handler returns a 26-entry array of hardcoded objects, every one with `status: 'active'`. No call to `TOOL_REGISTRY.values()` (the in-process registry that **actually** holds the tools); no call to `listMCPTools()` (which exists at `mcp-client.ts:217` and would return real registered tools). The `enabled: true/false` flags are arbitrary literals.
- **Evidence:**
  ```ts
  // hooks-tools.ts:1449-1487 — entire handler
  handler: async () => {
    return {
      hooks: [
        { name: 'pre-edit', type: 'PreToolUse', status: 'active', enabled: false },
        { name: 'post-edit', type: 'PostToolUse', status: 'active', enabled: false },
        // ... 24 more entries, all hardcoded
      ],
      total: 26,   // <-- hardcoded; not Array.length
    };
  },
  ```
  The `total: 26` is a number literal, not `hooks.length`. The enabled flags don't reflect the project's actual `.claude-plugin/hooks/hooks.json` manifest state.
- **Impact:** A "list" tool that doesn't list is the canonical observability violation. Users running `hooks list` to debug "is my pre-edit hook enabled?" get `enabled: false` as a hardcoded answer regardless of what their settings.json says. If a new tool is added to `hooksTools` (line 4055), `hooks_list` does not reflect it. ADR-0201 completeness FAIL; this is also a soundness mismatch (the "registry" the tool surfaces isn't the registry that exists).

### F-03-007 [CRITICAL] `hooks_worker-detect` auto-dispatch uses fake `setTimeout(1500)` to flip workers to `completed`

- **Location:** `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts:3842-3867`
- **Issue:** `hooks_worker-dispatch` was fixed by ADR-093 F2 (ADR-0162 Batch E) to surface honest `no-daemon` / `queued` / `synthetic-completed` verdicts. But the **sibling** `hooks_worker-detect` autoDispatch branch (when called with `autoDispatch: true`) still uses the pre-fix pattern: spawns workers with `status: 'running'`, schedules a `setTimeout(() => { w.status = 'completed' }, 1500)`, and returns dispatched IDs as if the work was real. No daemon check, no honest verdict.
- **Evidence:**
  ```ts
  // hooks-tools.ts:3842-3867 — autoDispatch branch
  if (autoDispatch) {
    const dispatched: string[] = [];
    for (const trigger of detection.triggers) {
      const workerId = `worker_${trigger}_${++workerIdCounter}_${Date.now().toString(36)}`;
      activeWorkers.set(workerId, {
        id: workerId, trigger, context: prompt.slice(0, 100),
        status: 'running',           // <-- claims running
        progress: 0, phase: 'initializing', startedAt: new Date(),
      });
      dispatched.push(workerId);

      // Mark worker completion after processing
      setTimeout(() => {              // <-- fake completion timer
        const w = activeWorkers.get(workerId);
        if (w) {
          w.progress = 100;
          w.phase = 'completed';
          w.status = 'completed';     // <-- flips to completed without running anything
          w.completedAt = new Date();
        }
      }, 1500);
    }
    result.autoDispatched = true;
    result.workerIds = dispatched;
  }
  ```
  Compare to `hooks_worker-dispatch` lines 3713-3731 which now correctly reports `no-daemon` / `queued` / `synthetic-completed` per ADR-093 F2.
- **Impact:** ADR-0162 Batch E hand-port was incomplete: the fix landed in one branch (worker-dispatch) but not the parallel branch (worker-detect autoDispatch). Anyone using `hooks worker-detect "optimize this query"` with autoDispatch sees workers marked complete after 1.5 seconds with no actual work. This is the exact `feedback-no-fallbacks` failure-mask the project's memory warns against: skip_accepted as a squelch. ADR-093 F2 explicitly called this out in audit finding #1700 item 1.

### F-03-008 [WARN] `hooks_model-route` silent-catch on router import fails to a fallback heuristic

- **Location:** `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts:3877-3933` (router init + handler)
- **Issue:** `getModelRouterInstance()` (lines 3879-3889) wraps the `await import('../ruvector/model-router.js')` in `try { ... } catch { modelRouterInstance = null; }`. When `null` is returned, the handler falls through to `analyzeComplexityFallback(task)` (a 12-line heuristic at lines 3995-4010) and returns `model: complexity > 0.7 ? 'opus' : complexity > 0.4 ? 'sonnet' : 'haiku'` with a hardcoded `confidence: 0.7` and `implementation: 'fallback'`. This is per `feedback-no-fallbacks`: silent catch with a fallback that returns success.
- **Evidence:**
  ```ts
  // line 3879-3889 — lazy loader
  async function getModelRouterInstance() {
    if (!modelRouterInstance) {
      try {
        const { getModelRouter } = await import('../ruvector/model-router.js');
        modelRouterInstance = getModelRouter();
      } catch {
        modelRouterInstance = null;    // <-- silent
      }
    }
    return modelRouterInstance;
  }

  // line 3904-3933 — handler
  handler: async (params: Record<string, unknown>) => {
    const router = await getModelRouterInstance();
    if (!router) {
      const complexity = analyzeComplexityFallback(task);
      return {
        model: complexity > 0.7 ? 'opus' : complexity > 0.4 ? 'sonnet' : 'haiku',
        confidence: 0.7,                                                  // <-- canned
        complexity,
        reasoning: 'Fallback heuristic (model router not available)',
        implementation: 'fallback',                                        // <-- at least labels itself
      };
    }
    // ... real path
  },
  ```
- **Impact:** The audit question 2 ("does model-route always return 'general-purpose'?") is REFUTED — the real-path return uses `tiny-dancer-neural` per `model-router.ts:756` `getModelRouter` exporting a real `ModelRouter` class (827 LOC of real complexity-analysis + Beta-prior bandit). But the fall-through path returns a heuristic. **Soundness partial**: the field `implementation: 'fallback'` does surface the degradation, so this isn't fully silent — but the import failure itself is squelched without a log line. Per `feedback-no-fallbacks` the catch should at least `console.error` the underlying error (compare `hooks_route` lines 1037, 1070, 1090, 1119 which log fall-throughs).

### F-03-009 [WARN] `hooks_route` has documented graceful-degradation but a few silent catches survive the ADR-0191 cleanup

- **Location:** `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts:975-1304`
- **Issue:** ADR-0191 Cluster B revised the route_task handler to log all controller fall-throughs via `console.error` (see comment at lines 994-1006 + actual logging at lines 1037, 1070, 1090, 1119). The pattern is documented and the silent-vs-logged catches were deliberately reconciled. But three sites still have **silent** catches:
  - **Line 1161-1163** (`taskRouter` controller path):
    ```ts
    } catch {
      // AgentDB router not available — fall through to local routing
    }
    ```
    No `console.error`. The comment claims documented degradation; the project's recent ADR-0191 work made other fall-throughs visible, but this one was missed.
  - **Line 1202-1204** (native VectorDb path):
    ```ts
    } catch {
      // Native failed, try pure JS fallback
    }
    ```
    Also silent.
  - **Line 1251-1256** (causal recall) — partially handled:
    ```ts
    } catch (e) {
      // Best-effort: causal context is routing metadata enrichment, not a fatal
      // dependency. Swallow (don't re-throw) so routing still returns a
      // recommended_agent from keyword/semantic fallback above.
      causalContext = { error: (e as Error)?.message || String(e) };
    }
    ```
    This one is OK: surfaces the error in the response payload. Counts as observable.
- **Evidence:** Compare line 1037 (`console.error('[hooks_route] SolverBandit fall-through: ${...}')`) to line 1161 (silent). The cleanup was uneven.
- **Impact:** Per `feedback-no-fallbacks`, three sites where backend availability is masked in production-shipped routing. Lower severity than F-03-002/F-03-003 because the **real** routing still functions (it just doesn't log which tier was chosen when the failure was silent). But it's a regression from the ADR-0191 architectural intent.

### F-03-010 [WARN] `hooks_intelligence_attention` `placeholder` fallback returns fake sigmoid weights labeled as attention

- **Location:** `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts:3308-3316` + `3320-3330`
- **Issue:** When `mode='flash'` and `getFlashAttention()` returns null (silent catch at `getFlashAttention` line 479-490), the handler falls through to a placeholder loop:
  ```ts
  if (results.length === 0) {
    for (let i = 0; i < topK; i++) {
      results.push({
        index: i,
        weight: Math.exp(-i * 0.5) / (1 + Math.exp(-i * 0.5)),  // <-- canned sigmoid
        pattern: `Attention target #${i + 1}`,                   // <-- canned label
      });
    }
  }
  ```
  And the response *unconditionally* includes a `stats` block claiming the speedup as if the computation happened:
  ```ts
  return {
    query, mode, results,
    stats: {
      computeTimeMs,
      speedup: mode === 'flash' ? '2.49x-7.47x' : mode === 'moe' ? '1.5x-3x' : '1.5x-2x',  // <-- always claims speedup
      memoryReduction: mode === 'flash' ? '50-75%' : '25-40%',                              // <-- canned
    },
    implementation,   // <-- 'placeholder' when real impl failed (good)
  };
  ```
- **Impact:** The `implementation: 'placeholder'` field is honest, but only consumers who check it know the result is fake. Anyone reading just `results` + `stats.speedup` sees `2.49x-7.47x` claimed on every call. The same `speedup` strings appear unconditionally in `hooks_metrics.performance` (line 1425-1430): marketing-quality benchmark claims hardcoded into production responses regardless of whether benchmarks were actually run. **Symmetric finding**: same issue at `hooks_intelligence.components.{flashAttention,ewc,lora,moe,sona}` (lines 2282-2331) where every `note` field claims real capabilities (e.g., `"Flash Attention with O(N) memory (2.49x-7.47x speedup)"`) regardless of whether the optimizer was actually loaded.

### F-03-011 [WARN] `hooks_build-agents` writes real config YAMLs but `stats` block is fake math

- **Location:** `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts:1800-1867`
- **Issue:** The handler *does* write config files via `mkdirSync` + `writeFileSync` (lines 1834-1853) — that part is real. But the `stats` block at lines 1861-1865 is fabricated:
  ```ts
  stats: {
    configsGenerated: filteredAgents.length,
    patternsApplied: filteredAgents.length * 3,           // <-- fake; no patterns applied
    optimizationsIncluded: filteredAgents.reduce((acc, a) => acc + a.optimizations.length, 0),
  },
  ```
  `patternsApplied` claims 3 patterns per agent were applied, but no `routePatternOp({type: 'apply'})` is called anywhere. The hardcoded `agents` array at lines 1818-1824 has hardcoded `capabilities` and `optimizations` strings — those are also static metadata, not learned.
- **Evidence:** Lines 1819-1823:
  ```ts
  { type: 'coder', configFile: ..., capabilities: ['code-generation', 'refactoring', 'debugging'], optimizations: ['flash-attention', 'token-reduction'] },
  { type: 'architect', ..., capabilities: ['system-design', 'api-design', 'documentation'], optimizations: ['context-caching', 'memory-persistence'] },
  // etc.
  ```
- **Impact:** The tool advertises "Generate optimized agent configurations **from pretrain data**" — pretrain data is never read. Coupled with F-03-004 (pretrain doesn't produce data) this is "stub feeds stub" — the entire bootstrap pipeline (`pretrain` → `build-agents`) is two stubs in a trench coat.

### F-03-012 [WARN] `hooks_transfer` falls back to canned demo data when source is empty

- **Location:** `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts:1883-1943`
- **Issue:** When `sourceMemoryPath` doesn't exist OR has no entries, the handler injects synthetic demo data:
  ```ts
  // line 1910-1916
  if (Object.values(byType).every(v => v === 0)) {
    byType['file-patterns'] = 8;
    byType['task-routing'] = 12;
    byType['command-risk'] = 5;
    byType['agent-success'] = 15;
  }
  ```
  Plus synthetic skip stats:
  ```ts
  // line 1932-1936
  skipped: {
    lowConfidence: Math.floor(total * 0.15),
    duplicates: Math.floor(total * 0.08),
    conflicts: Math.floor(total * 0.03),
  },
  stats: {
    avgConfidence: 0.82 + (minConfidence > 0.8 ? 0.1 : 0),
    avgAge: '3 days',  // <-- hardcoded string
  },
  ```
  The handler *does* set `dataSource: 'demo-data'` when source was empty (line 1941), so the lie is partially labeled. But anyone calling the tool to **transfer** patterns from a real (empty) project gets 40 fake "transferred" patterns and a misleading "transferred.total" count.
- **Impact:** Demo-data injection is a textbook stub anti-pattern. A genuine empty-source case should return `total: 0` not `total: 40`. The conditional silently injects falseness; the caller has to inspect `dataSource` to know.

### F-03-013 [WARN] `hooks_session-end` returns hardcoded `summary` + `learningUpdates` regardless of actual session

- **Location:** `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts:2111-2129`
- **Issue:** Already noted as F-01-004 from the pre-lifecycle audit; re-noting here because this audit's scope intersects through `model-stats` / `hooks_metrics` adjacency:
  ```ts
  return {
    sessionId,
    duration: 3600000,                       // <-- hardcoded 1 hour
    statePath: ...,
    daemon: { stopped: daemonStopped },
    sessionPersistence: sessionPersistence || { controller: 'none', persisted: false },
    summary: {
      tasksExecuted: 12, tasksSucceeded: 10, tasksFailed: 2,    // <-- all hardcoded
      commandsExecuted: 45, filesModified: 23, agentsSpawned: 5,
    },
    learningUpdates: { patternsLearned: 8, trajectoriesRecorded: 12, confidenceImproved: 0.05 },  // <-- hardcoded
  };
  ```
- **Impact:** Per F-01-004. Especially relevant to this slice because `hooks_intelligence_stats` (in scope here) shares a data lineage with session-end's `learningUpdates` field — both should be reading from `sona-patterns.json` / `intelligence.json` but only `hooks_metrics` actually does.

### F-03-014 [WARN] `hooks_notify` performs no actual delivery — pure return-with-`delivered:true`

- **Location:** `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts:2177-2204`
- **Issue:** The MCP description is `'Send cross-agent notification'`. Handler returns:
  ```ts
  return {
    notificationId: `notify-${Date.now()}`,
    message, target, priority,
    delivered: true,                                                       // <-- claimed without action
    recipients: target === 'all' ? ['coder', 'architect', 'tester', 'reviewer'] : [target],
    timestamp: new Date().toISOString(),
  };
  ```
  No event-bus emit, no IPC send, no message queue write, no notifications-namespace store. The recipients list `['coder', 'architect', 'tester', 'reviewer']` for `target='all'` is a 4-element hardcoded fixture.
- **Impact:** Per ADR-0201 completeness: stub. Specifically problematic because the broader project relies on cross-agent messaging for the daemon / worker lifecycle (per `claims_handoff`, `hive-mind_broadcast`); `hooks_notify` advertises that surface and provides none of it. Adjacent to F-03-007 (worker-detect autoDispatch fake) — both are "looks like an event happened" without the event.

### F-03-015 [NOTE] `hooks_intelligence` returns mixed real-and-fake metrics

- **Location:** `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts:2249-2351`
- **Issue:** The `realMetrics` block at lines 2333-2338 does pull from `getIntelligenceStatsFromMemory()` (legitimate read of `.claude-flow/memory/store.json` — see lines 564-647). But the `components.*` block at lines 2282-2331 returns advertising-style notes regardless of actual capability:
  - `flashAttention.note: 'Flash Attention with O(N) memory (2.49x-7.47x speedup)'` when `flashAvailable=true` — the speedup claim is from the paper, not measured locally.
  - `embeddings.note: 'Real ONNX embeddings via Xenova/all-mpnet-base-v2'` — claimed unconditionally even if `transformers` isn't installed.
  - `implementationStatus.working` lists 12 capabilities as "working" without checking the corresponding getter returns (`flashAvailable`, `loraAvailable` are checked for `status` but not for `working` membership).
- **Evidence:** Lines 2339-2347:
  ```ts
  implementationStatus: {
    working: [
      'memory-store', 'embeddings', 'trajectory-recording', 'claims', 'swarm-coordination',
      'hnsw-index', 'pattern-storage', 'sona-optimizer', 'ewc-consolidation', 'moe-routing',
      'flash-attention', 'lora-adapter'
    ],
    partial: [], notImplemented: [],
  },
  ```
- **Impact:** `realMetrics` is genuinely real; the rest is canned. Mid-severity because the `realMetrics` is correctly labeled and a careful caller can distinguish — but the marketing-y note fields are misleading. Adjacent to F-03-010.

### F-03-016 [NOTE] `hooks_intelligence_learn` uses `generateSimpleEmbedding` (hash) for AttentionService.addMemory

- **Location:** `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts:178-219` (the embedding) + `3127-3148` (the use site)
- **Issue:** `generateSimpleEmbedding` is a deterministic hash-of-`Math.sin/cos`-of-character-codes function — not a real ONNX embedding. It's used by `hooks_route` (line 1177), `hooks_intelligence_attention` (line 3200), and indirectly any caller that ends up at the keyword fallback. The function comment says `"This is for routing purposes where we need consistent, fast embeddings"` — fair for fast tier routing, but the resulting Float32Array gets handed to controllers (`attnService.attend`, `taskRouter.route`) that expect a real embedding. If the controller does cosine similarity against real ONNX vectors, hash-derived vectors will produce semantically-meaningless similarity scores.
- **Evidence:**
  ```ts
  // lines 178-204 (excerpt)
  function generateSimpleEmbedding(text: string, dimension: number = EMBEDDING_DIM): Float32Array {
    const embedding = new Float32Array(dimension);
    // ... character-level Math.sin / Math.cos
    embedding[i] = value / Math.max(1, text.length);
    // ... normalize
  }
  ```
  Per project memory `reference-embedding-model` the canonical model is `Xenova/all-mpnet-base-v2`, 768-dim, HNSW m=23/efC=100/efS=50. `generateSimpleEmbedding` produces 768-dim vectors with the same shape but completely incompatible semantics.
- **Impact:** Latent correctness bug: routing decisions can silently use hash-vectors against ONNX-vectors. Lower severity because the relevant code paths often fall through to keyword matching before this matters, but the dimensionality match means callers receive results that *look* valid. Per `feedback-full-model-names` and `reference-embedding-model`, the only sanctioned embedding source is `Xenova/all-mpnet-base-v2`.

### F-03-017 [NOTE] Worker daemon presence detection in `hooks_worker-dispatch` reads a flat-file PID; honest verdicts depend on daemon-state contract

- **Location:** `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts:3668-3685` (PID-file check) + `3713-3731` (verdict)
- **Issue:** The ADR-093 F2 fix (per F-03-007 inverse — this branch IS fixed) reads `.claude-flow/daemon.pid` and `process.kill(pid, 0)` to test liveness. Good. But the `'queued'` verdict (line 3721-3722) trusts that the daemon polls `activeWorkers` via "its own state file" — there's no proof in this file that the daemon actually does so. If the daemon doesn't poll the in-memory Map, queued workers languish forever and `hooks_worker-status` keeps returning `pending`.
- **Evidence:** Line 3719-3722:
  ```ts
  // Daemon is alive — record the queued worker. The daemon polls activeWorkers
  // via its own state file, so this constitutes a real queue entry.
  reportedStatus = 'queued';
  note = `Worker queued for daemon (pid ${daemonPid}). Poll hooks_worker-status to track progression...`;
  ```
  The activeWorkers Map (line 3537) is an **in-process** Map. A daemon running as a separate process cannot read this Map directly — it would need an IPC channel or a shared file. The comment ("its own state file") suggests there's a serialization step somewhere, but no code in this file writes the Map to disk on dispatch. **Followup needed** to confirm the daemon side (out-of-scope for this static audit).
- **Impact:** Lower severity, marked NOTE because the fix is honest in spirit (the verdict labels are accurate) but the contract between this dispatcher and the daemon process is unverified by the audit-scoped files. Could be a critical bug if the daemon polls a serialized version of activeWorkers that doesn't get written here.

### F-03-018 [NOTE] `getSONAOptimizer`, `getEWCConsolidator`, `getMoERouter`, `getFlashAttention`, `getLoRAAdapter`, `getCausalRecallInstance`, `getRealStoreFunction`, `getRealSearchFunction` all share the same silent-catch import pattern

- **Location:** `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts:49-105, 114-153, 479-504, 962-973, 3879-3889`
- **Issue:** Eight lazy-loader functions follow the identical structure:
  ```ts
  let instance = null;
  async function getXxxInstance() {
    if (!instance) {
      try {
        const { getXxx } = await import('...');
        instance = await getXxx();
      } catch {
        instance = null;   // <-- silent
      }
    }
    return instance;
  }
  ```
  Each silently catches the import error and returns null. Callers check `if (xxx) { /* real path */ } else { /* fallback */ }`. The import failure is never surfaced. Per `feedback-no-fallbacks`, the failure mode should be observable — either `console.error` the error or include a `_unavailable_reasons: { sona: '...' }` field in tool responses.
- **Evidence:** Per the line ranges above, all eight follow the same shape. Most concerning: `getCausalRecallInstance` (line 962-973) — failure of causal recall could mean a corrupted memory store, which the caller never learns about.
- **Impact:** A widespread pattern that violates `feedback-no-fallbacks`. Each individual occurrence is mild; the cumulative effect is that "controller not available" becomes the default state and tools silently degrade to canned values (F-03-002, F-03-008, F-03-010). Recommendation: replace the bare catch with `console.error(`[hooks-tools] ${name} unavailable: ${e.message}`)` to make degradation observable, matching the ADR-0191 pattern that `hooks_route` already follows.

## Tool inventory

| Tool | Handler file:lines | LOC | Sound | Complete | Notes |
|---|---|---|---|---|---|
| `hooks_route` | `cli/src/mcp-tools/hooks-tools.ts:975-1304` | 330 | PARTIAL | PASS | 5-tier graceful-degradation with ADR-0191 logged fall-through, 3 residual silent catches (F-03-009); uses real controllers (SolverBandit, SkillLibrary, LearningSystem, SemanticRouter, taskRouter) when available; falls through to `suggestAgentsForTask` keyword fallback when none yield |
| `hooks_model-route` | `cli/src/mcp-tools/hooks-tools.ts:3892-3933` | 42 | PARTIAL | PASS | Real `tiny-dancer-neural` path via `ruvector/model-router.ts` (827 LOC); silent-catch fallback heuristic when import fails (F-03-008) |
| `hooks_model-outcome` | `cli/src/mcp-tools/hooks-tools.ts:3936-3966` | 31 | PASS | PASS | Calls `router.recordOutcome(task, model, outcome)` when router exists; otherwise still returns `recorded: true` (slightly dishonest but minor) |
| `hooks_model-stats` | `cli/src/mcp-tools/hooks-tools.ts:3969-3992` | 24 | PASS | PASS | Returns `available: false` explicitly when router is null; honest verdict |
| `hooks_intelligence` | `cli/src/mcp-tools/hooks-tools.ts:2249-2351` | 103 | PARTIAL | PARTIAL | `realMetrics` legitimate; `components.*.note` fields canned marketing strings; `implementationStatus.working` hardcoded array (F-03-015) |
| `hooks_intelligence-reset` | `cli/src/mcp-tools/hooks-tools.ts:2354-2372` | 19 | FAIL | FAIL | Stub — no side effects, hardcoded `156/89/12500` (F-03-003) |
| `hooks_intelligence_trajectory-start` | `cli/src/mcp-tools/hooks-tools.ts:2375-2413` | 39 | PASS | PASS | Real Map insert into `activeTrajectories`; returns real activeCount |
| `hooks_intelligence_trajectory-step` | `cli/src/mcp-tools/hooks-tools.ts:2415-2459` | 45 | PASS | PASS | Real append to trajectory.steps; honestly reports `recorded: !!trajectory` |
| `hooks_intelligence_trajectory-end` | `cli/src/mcp-tools/hooks-tools.ts:2461-2602` | 142 | PARTIAL | PASS | Real `storeFn` call to memory-router; real `sona.processTrajectoryOutcome` call when SONA loaded; silent catch on SONA + EWC failures (line 2544, 2566) per F-03-018 |
| `hooks_intelligence_pattern-store` | `cli/src/mcp-tools/hooks-tools.ts:2605-2706` | 102 | PASS | PASS | ADR-0112-aligned: explicit ReasoningBank target, no silent fallback to RVF (line 2702: "Per ADR-0112, no silent fallback to RVF"); OPT-017 neural-store side-effect cache is properly labeled |
| `hooks_intelligence_pattern-search` | `cli/src/mcp-tools/hooks-tools.ts:2708-2855` | 148 | PARTIAL | PASS | Three-tier search (router → search-fn → neural-store), each tier silent-catches; final empty case returns honest `backend: 'unavailable'` |
| `hooks_intelligence_stats` | `cli/src/mcp-tools/hooks-tools.ts:2858-3052` | 195 | PARTIAL | PARTIAL | Real reads from SONA / EWC / MoE / Flash / LoRA when loaded; `memoryFallback` path uses `getIntelligenceStatsFromMemory` (legitimate JSON read); fall-through silently per F-03-018 |
| `hooks_intelligence_learn` | `cli/src/mcp-tools/hooks-tools.ts:3054-3170` | 117 | PARTIAL | PASS | Real `lb.learn(...)` via memory-router with explicit throw on failure (good — no silent catch); but `generateSimpleEmbedding` is hash-based (F-03-016) feeding to AttentionService |
| `hooks_intelligence_attention` | `cli/src/mcp-tools/hooks-tools.ts:3173-3332` | 160 | PARTIAL | PARTIAL | Real `attnService.attend` + MoE + FlashAttention paths when available; placeholder sigmoid weights labeled `implementation: 'placeholder'` (F-03-010); marketing speedup strings unconditional |
| `hooks_worker-list` | `cli/src/mcp-tools/hooks-tools.ts:3586-3632` | 47 | PASS | PASS | Reads static `WORKER_CONFIGS` (metadata, fine) + real `activeWorkers` Map; honest counts |
| `hooks_worker-dispatch` | `cli/src/mcp-tools/hooks-tools.ts:3635-3752` | 118 | PASS | PASS | Post-ADR-093 F2: honest `no-daemon` / `queued` / `synthetic-completed` verdicts; daemon-presence check via PID file is real (F-03-017 caveat) |
| `hooks_worker-status` | `cli/src/mcp-tools/hooks-tools.ts:3755-3808` | 54 | PASS | PASS | Real read from `activeWorkers` Map; honest duration computation |
| `hooks_worker-detect` | `cli/src/mcp-tools/hooks-tools.ts:3811-3875` | 65 | FAIL | FAIL | Detection regex is real, but autoDispatch branch (lines 3842-3867) still uses fake `setTimeout(1500)` completion timer — ADR-093 F2 fix didn't reach this branch (F-03-007) |
| `hooks_worker-cancel` | `cli/src/mcp-tools/hooks-tools.ts:4013-4052` | 40 | PASS | PASS | Real Map mutation; honest result |
| `hooks_explain` | `cli/src/mcp-tools/hooks-tools.ts:1702-1756` | 55 | FAIL | FAIL | Hardcoded factors (0.87, 0.95) + `Math.random()` patterns + literal `"87%"` string (F-03-002) |
| `hooks_init` | `cli/src/mcp-tools/hooks-tools.ts:2208-2246` | 39 | FAIL | FAIL | No filesystem writes; advertised paths returned as strings without creation (F-03-005) |
| `hooks_list` | `cli/src/mcp-tools/hooks-tools.ts:1442-1488` | 47 | FAIL | FAIL | Hardcoded 26-entry static array; `total: 26` is a literal not `Array.length` (F-03-006) |
| `hooks_build-agents` | `cli/src/mcp-tools/hooks-tools.ts:1800-1867` | 68 | PARTIAL | FAIL | Real config-file writes (good); hardcoded agent metadata + fake `patternsApplied: count*3` (F-03-011) |
| `hooks_pretrain` | `cli/src/mcp-tools/hooks-tools.ts:1759-1796` | 38 | FAIL | FAIL | Multiplier-on-constants stub; no fs read, no controller call (F-03-004 / F-01-003) |
| `hooks_transfer` | `cli/src/mcp-tools/hooks-tools.ts:1871-1944` | 74 | PARTIAL | FAIL | Real source-store read; demo-data injection when empty + synthetic skip stats (F-03-012) |
| `hooks_notify` | `cli/src/mcp-tools/hooks-tools.ts:2177-2204` | 28 | FAIL | FAIL | Pure stub — no delivery, no IPC, no queue (F-03-014) |
| `hooks_intelligence_attention` (placeholder return) | included above |  | — | — | See F-03-010 |
| (dead) `routeTaskTool` | `@claude-flow/hooks/src/mcp/index.ts:153-207` | 55 | FAIL | FAIL | Hardcoded 4-bucket switch with fixed confidences; not consumed by CLI (F-03-001) |
| (dead) `routeTaskToAgent` | `@claude-flow/hooks/src/mcp/index.ts:478-555` | 78 | FAIL | FAIL | Same — hardcoded confidence per keyword bucket; not used (F-03-001) |
| (dead) `workerMCPTools` (8 tools) | `@claude-flow/hooks/src/workers/mcp-tools.ts:436-460` | 462 file | FAIL | N/A | Re-exported from `hooks/src/index.ts:144`; no external consumer (F-03-001) |
| (dead) `llmHooks` (4 functions) | `@claude-flow/hooks/src/llm/llm-hooks.ts:544-552` | 552 file | FAIL | N/A | Defined + exported, never imported by CLI (F-03-001) |

## Method

### Commands run
- `ls forks/ruflo/v3/@claude-flow/hooks/src/` and subdirs (executor, workers, llm, reasoningbank, registry, mcp)
- `grep -rln "@claude-flow/hooks\b" forks/ruflo/v3/@claude-flow/cli/src/` (zero matches — confirms dead-package claim)
- `grep -rn "HookExecutor\b\|new HookExecutor" forks/ruflo/v3/@claude-flow/cli/src/` (zero matches)
- `grep -rn "workerMCPTools\|workerRunTool\|workerStartTool" forks/ruflo/v3/@claude-flow/` excluding `dist`/`__tests__` (only definitions + hooks/src/index.ts re-export)
- `grep -n "^export const " forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts` (mapped all 30+ tool exports; identified line ranges for scope tools)
- `grep -n "^async function get" forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts` (catalogued all 10 lazy loaders for F-03-018)
- `grep -n "return 'general-purpose'\|'general-purpose'" hooks-tools.ts model-router.ts enhanced-model-router.ts` (zero matches — refutes audit question 2)
- `grep -n "Math.random\|hardcoded\|0\\.85\\|0\\.87\\|0\\.95" hooks-tools.ts` (located stub-confidence values)
- `wc -l` on each scope file
- `grep -n "setTimeout\|setInterval" hooks-tools.ts` (located worker-detect fake completion timer at 3858)
- `grep -n "} catch" hooks-tools.ts | wc -l` (counted catch sites; cross-referenced F-03-009 / F-03-018)

### Files read
- `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts` — lines 49-220 (lazy loaders + helpers), 540-647 (memory store + intelligence stats), 975-1304 (hooks_route, full), 1306-1488 (hooks_metrics + hooks_list), 1702-1797 (hooks_explain + hooks_pretrain), 1800-1944 (build-agents + transfer), 2044-2204 (session-end / restore / notify), 2208-2351 (hooks_init + hooks_intelligence), 2354-2602 (intelligence-reset + trajectory-* full), 2605-2855 (pattern-store + pattern-search), 2858-3170 (intelligence_stats + intelligence_learn), 3173-3332 (intelligence_attention), 3336-3631 (worker WORKER_CONFIGS, detectWorkerTriggers, worker-list), 3635-3875 (worker-dispatch + worker-status + worker-detect), 3877-4052 (model-route + model-outcome + model-stats + worker-cancel), 4055-4097 (export array)
- `forks/ruflo/v3/@claude-flow/cli/src/mcp-client.ts` (1-300 — registry dispatch + utility exports)
- `forks/ruflo/v3/@claude-flow/cli/src/commands/hooks.ts` (5343 LOC total; grepped for callMCPTool dispatch sites + intelligence subcommand wiring)
- `forks/ruflo/v3/@claude-flow/hooks/src/executor/index.ts` (1-100; confirms HookExecutor exists, then confirmed dead by zero imports)
- `forks/ruflo/v3/@claude-flow/hooks/src/registry/index.ts` (1-100 + grep)
- `forks/ruflo/v3/@claude-flow/hooks/src/mcp/index.ts` (1-300, 478-587 — parallel implementations with hardcoded stubs)
- `forks/ruflo/v3/@claude-flow/hooks/src/reasoningbank/index.ts` (1-1149 — `ReasoningBank` class + `FallbackEmbeddingService` + `RealEmbeddingService`; identifies in-memory-fallback mode + hash-based fallback embedding)
- `forks/ruflo/v3/@claude-flow/hooks/src/workers/mcp-tools.ts` (grep for exports; verified separate `worker_*` namespace, not `hooks_worker-*`)
- `forks/ruflo/v3/@claude-flow/hooks/src/llm/llm-hooks.ts` (grep for exports + consumers)
- `forks/ruflo/v3/@claude-flow/cli/src/ruvector/model-router.ts` (lines 32-291 + grep for exports — `ModelRouter` class is real, 827 LOC of complexity-analysis + Beta-prior bandit)
- `docs/audits/2026-05-19-soundness-audit/01-hooks-pre-lifecycle.md` (full — for format reference + cross-audit deduplication)

## Recommendations (DO NOT IMPLEMENT)

1. **F-03-001 fix:** Delete the dead subdirectories of `@claude-flow/hooks` that have zero CLI consumers: `executor/`, `mcp/`, `workers/`, `llm/`. Keep `registry/` only if `@claude-flow/guidance` still consumes it, otherwise fold the guidance hook into a local registry. Remove the subpath exports from `@claude-flow/hooks/package.json`. The hooks package becomes a types library plus the surviving `reasoningbank` + `bridge` runtime paths.
2. **F-03-002 fix:** Replace `Math.random()` and hardcoded `0.87` / `0.95` values in `hooks_explain` with either (a) actual decision telemetry from the most-recent `hooks_route` call (use the same memory-router that `hooks_metrics` reads from), or (b) honest `null` + a `note: 'No historical data; explanation reflects rule-based defaults'`. Determinism + truthfulness over marketing.
3. **F-03-003 fix:** Either implement real reset (clear `activeTrajectories`, call `routeMemoryOp({type:'delete', namespace:'trajectories'})`, unlink `.swarm/sona-patterns.json` + `.ruvector/intelligence.json`, call `sona.reset()` if loaded) and return real cleared-counts, or rename to `hooks_intelligence_reset_demo` so the stub status is explicit. Per `feedback-skip-accepted-as-squelch`, this is a textbook squelch.
4. **F-03-004 fix:** Same recommendation as F-01-003 — implement or rename. The `retrieve / judge / distill / consolidate` pipeline has real controllers elsewhere; wire them in.
5. **F-03-005 fix:** Either implement filesystem writes (`mkdirSync`, `writeFileSync` for `.claude/settings.json` and `.claude/hooks/`) matching `hooks_build-agents`'s pattern, or remove the tool entirely and route to the canonical `init` command. The current state is the worst of both: claims to act, doesn't.
6. **F-03-006 fix:** Replace the hardcoded `hooks_list` body with a real registry walk:
   ```ts
   handler: async () => {
     const tools = listMCPTools().filter(t => t.name.startsWith('hooks_'));
     return { hooks: tools.map(t => ({ name: t.name.slice(6), description: t.description, ... })), total: tools.length };
   };
   ```
   Use `listMCPTools()` from `mcp-client.ts:217` which already exists.
7. **F-03-007 fix:** Remove the `setTimeout(1500)` fake completion in `hooks_worker-detect` autoDispatch (lines 3858-3866). Either delegate to the same `hooks_worker-dispatch` honest-verdict logic, or change autoDispatch to call dispatch in a loop and use its verdict. This is the same fix ADR-093 F2 applied to dispatch — it just wasn't applied to detect.
8. **F-03-008 fix:** Add `console.error` to `getModelRouterInstance` catch (line 3884), matching the ADR-0191 pattern at `hooks_route` lines 1037+. Also surface in the response a `_fallback_reason` field when `implementation: 'fallback'` is returned.
9. **F-03-009 fix:** Add `console.error` to the three silent-catch sites in `hooks_route` (lines 1161, 1202; 1251 is already observable via `causalContext.error`). The ADR-0191 cleanup was incomplete.
10. **F-03-010 fix:** Drop the unconditional `stats.speedup` + `stats.memoryReduction` strings when `implementation === 'placeholder'`. Either omit `stats` or set it to honest `null`. Same fix for `hooks_metrics.performance` (lines 1425-1430) — those are marketing claims, not measurements.
11. **F-03-011 fix:** Drop the fake `patternsApplied: count * 3` from `hooks_build-agents.stats`. Either omit the field or compute it from real pattern retrieval (requires F-03-004 to be done first).
12. **F-03-012 fix:** Remove the demo-data injection in `hooks_transfer` (lines 1911-1916). When source has no patterns, return `total: 0` and an explicit `note: 'Source project has no learned patterns'`. Demo-data is acceptable only as opt-in via a `seedDemo: true` parameter.
13. **F-03-013 fix:** Per F-01-004.
14. **F-03-014 fix:** Either implement actual notification dispatch (event-bus emit or claims-handoff record) or rename to `hooks_notify_record` to make it clear the tool only records intent. Per `feedback-no-fallbacks`, `delivered: true` without delivery is a stub-as-success.
15. **F-03-015 fix:** Change `implementationStatus.working` to be computed from `if (sonaAvailable) working.push('sona-optimizer')` etc. Demote the canned `notes` to factual capability strings without speedup claims.
16. **F-03-016 fix:** Either guard `generateSimpleEmbedding` to only be used in keyword-fallback paths (never handed to controllers expecting ONNX vectors), or replace its callers with a real embedding service call. Currently `hooks_route:1177` passes hash-vectors to native VectorDb (which may have ONNX-trained patterns).
17. **F-03-017 fix:** Out of scope for this static audit; confirm daemon-side state-file contract in a follow-up that includes `cli/src/services/worker-daemon.ts` and friends.
18. **F-03-018 fix:** Bulk-replace the eight silent-catch lazy loaders with `console.error` logging the underlying import error. Optionally accumulate `_unavailable_reasons` on a module-global that intelligence-related tools can surface (so `hooks_intelligence` can show `{ sona: 'Cannot find module ...', moe: 'Module load timeout' }` instead of just `status: 'loading'`).
