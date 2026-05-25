# 2026-05-25 — ADR-129 rvagent integration: upstream trace + fork surface map

## Summary (5 bullets max)

- Upstream ADR-129 (commit `47a7825b0`, v3.8.0 `bf0f505c9`) wires `@ruvector/rvagent-wasm`'s `JsModelProvider`/`addMcpTools`/gallery-CRUD/agent-introspection into the MCP surface across 4 phases, replacing the echo-stub bypass with a real provider callback and adding 16 new MCP tools.
- Fork is on the **upstream pre-129 baseline** for the substance: `agent-wasm.ts` (455 lines) and `wasm-agent-tools.ts` keep the 10-tool surface and the echo-stub detection path; no `JsModelProvider`/`set_model_provider` callsite exists outside type declarations.
- Fork has a substantial **fork-only divergence** that upstream doesn't have: a cross-process persistence layer in `wasm-agent-tools.ts` (`store.json` + advisory lock + `rehydrateWasmAgent`) — upstream ADR-129 is written against the pre-persistence baseline and merges will need to thread the 16 new tools through this layer.
- Fork pins **`@ruvector/rvagent-wasm@0.2.1-patch.145`** (newer than upstream's `^0.1.0` target); the runtime exposes all the methods ADR-129 requires (`set_model_provider`, `addMcpTools`, `loadRvf(id) → Uint8Array`, etc.) per `forks/ruvector/npm/packages/rvagent-wasm/rvagent_wasm.d.ts:187`. The fork's local stub `optional-modules.d.ts:295` is stale and declares the wrong `loadRvf` signature, but the package itself has correct types.
- Verdict: **partial-pick**. Phases 1-3 land cleanly on top of fork's persistence layer with re-routing through `ensureLive`. Phase 4 (plugin manifest reader) lands as-is. **Two real blockers**: (a) fork lacks OpenRouter routing in `callAnthropicMessages` (upstream issue #2042 fix not back-ported), so P1's three-provider claim degrades to Anthropic+Ollama only; (b) the persistence layer's `snapshotAgent` re-serialization model conflicts with composed RVF state on `wasm_agent_compose` — needs a design call before P2 merges.

## What ADR-129 introduces

Plain-English summary, grounded in `/Users/henrik/source/ruvnet/ruflo/v3/docs/adr/ADR-129-rvagent-full-integration.md`:

- **Phase 1 — JsModelProvider integration** (`agent-wasm.ts:109-196` post-commit). At `createWasmAgent` time, construct a `JsModelProvider` whose JS callback bridges to `callAnthropicMessages`/`resolveAnthropicModel` from `agent-execute-core.ts:94,282`, then call `agent.set_model_provider(provider)`. This makes the WASM runtime's internal turn loop dispatch through the v3 provider system. The echo-stub branch is preserved as a fallback for keyless environments.
- **Phase 2 — `wasm_agent_compose` + `addMcpTools` bridge** (`wasm-agent-tools.ts:324` + `agent-wasm.ts:421-460` post-commit). New MCP tool `wasm_agent_compose` accepts `{skills, mcpTools, prompts, tools, mcpToolsAllowDestructive, includePlugins}` and produces a base64-encoded RVF. `buildRvfContainer` gains an `mcpTools?: McpToolDescriptor[]` param that calls `builder.addMcpTools(JSON.stringify(...))`. `buildRvfFromTemplate` now passes `template.mcp_tools` (previously silently dropped).
- **Phase 3 — 16 new MCP tools across two groups** (`wasm-agent-tools.ts:437-755` post-commit):
  - **Agent introspection (6 tools)**: `wasm_agent_state`, `wasm_agent_todos`, `wasm_agent_tools`, `wasm_agent_turn_count`, `wasm_agent_is_stopped`, `wasm_agent_reset` — direct passthroughs to `WasmAgent.get_state()/get_todos()/get_tools()/turn_count()/is_stopped()/reset()`.
  - **Gallery CRUD (10 tools)**: `wasm_gallery_load_rvf`, `_configure`, `_categories`, `_list_by_category`, `_add_custom`, `_remove_custom`, `_import`, `_export`, `_active`, `_config`. `wasm_gallery_import` is the only HIGH_RISK one — it deserializes user JSON inside the WASM runtime and requires an AIDefence `aidefence_scan` gate before reaching `gallery.importCustom()`. The AIDefence pattern reuses `security-tools.ts:55` (`getAIDefence()` lazy singleton, established by ADR-118).
- **Phase 4 — Plugin bridge contract** (`wasm-agent-tools.ts:57-99` post-commit). Optional `rvagent` block in `.claude-plugin/plugin.json` declares `exposeSkillsAsTools: string[]` and `autoWireOnCompose: boolean`. `wasm_agent_compose` gains `includePlugins?: string[]` — calls `loadPluginManifest()`, parses `rvagent.exposeSkillsAsTools`, and passes the resulting skills through `addMcpTools`. Unknown plugin name yields a warning in the manifest, not an error.
- **Safety: destructive-tool gate** (`wasm-agent-tools.ts:27-43` post-commit). `wasm_agent_compose` defines `DESTRUCTIVE_TOOL_PATTERNS` (`/^memory_delete$/`, `/^federation_/`, `/^swarm_shutdown$/`, `/^agent_terminate$/`, `/_delete$/`, `/_remove$/`, `/_drop$/`, `/_shutdown$/`) and refuses destructive entries in `mcpTools` unless `mcpToolsAllowDestructive: true`. Safe-by-default allowlist `SAFE_MCP_TOOLS` (`wasm-agent-tools.ts:46-58`) covers 30 read/search-shaped tools.
- **Safety: `wasm_gallery_import` HIGH_RISK marking + AIDefence**. Upstream `wasm-agent-tools.ts:664-712` post-commit calls `getAIDefence()` against the templates JSON before `galleryImportCustom`. Rejection produces an MCP error response, not silent drop.
- **Smoke harness** (`scripts/smoke-wasm-*.mjs`, 4 scripts + matching CI jobs in `.github/workflows/v3-ci.yml`). Each phase has a smoke that runs without API keys (the keyless fallback covers CI). Provider-bridge smoke asserts `turn_count >= 1` to prove the WASM loop ran, not the bypass.
- **Telemetry**: `docs/benchmarks/rvagent-baseline.json` (new) + `scripts/bench-rvagent.mjs` capture P50/P95 latencies for create/prompt/compose/gallery operations as the 3.8.0 baseline.
- **CI/build fixes piggybacked on the PR** (unrelated to ADR substance): `memory-initializer.ts` honors `CLAUDE_FLOW_DISABLE_BRIDGE=1` for the #2120 memory smoke; pnpm-workspace recursion fixes in `.github/workflows/v3-ci.yml`.
- **No coupled deps required** — ADR-129 uses only existing `callAnthropicMessages` + the already-bundled `@ruvector/rvagent-wasm` (no new npm dep).

## Upstream consumers

Grep evidence in `/Users/henrik/source/ruvnet/ruflo`, post-`47a7825b0`:

- **Provider callback wiring** — exactly one callsite, the new `attachJsModelProvider()`:
  - `v3/@claude-flow/cli/src/ruvector/agent-wasm.ts:147` `const provider = new mod.JsModelProvider(async (messagesJson: string) => {`
  - `v3/@claude-flow/cli/src/ruvector/agent-wasm.ts:154` `agent.set_model_provider(provider);`
  - Called from `createWasmAgent` (line 125).
- **`addMcpTools` callsite** — one, in the extended builder:
  - `v3/@claude-flow/cli/src/ruvector/agent-wasm.ts:445` `builder.addMcpTools(JSON.stringify(opts.mcpTools));`
- **`wasm_agent_compose` MCP tool** — defined at `v3/@claude-flow/cli/src/mcp-tools/wasm-agent-tools.ts:324` (the largest new tool, ~110 lines). Imports `loadAgentWasm`, calls the extended `buildRvfContainer`, gates against `DESTRUCTIVE_TOOL_PATTERNS`.
- **`@ruvector/rvagent-wasm` package import sites** — unchanged from pre-129 baseline:
  - `v3/@claude-flow/cli/src/ruvector/agent-wasm.ts` is the sole importer; everything else routes through this module.
- **Smoke consumers**:
  - `scripts/smoke-wasm-provider-bridge.mjs` (87 lines, new) — creates an agent, prompts, asserts response not echo + `turn_count >= 1`.
  - `scripts/smoke-wasm-rvf-compose.mjs` (102 lines, new) — composes RVF with 2 tool descriptors, asserts `WasmRvfBuilder.validate()`.
  - `scripts/smoke-wasm-gallery-crud.mjs` (140 lines, new) — round-trips categories/add/list/export/remove.
  - `scripts/smoke-wasm-plugin-bridge.mjs` (118 lines, new) — fixture plugin with `rvagent.exposeSkillsAsTools`, asserts skill appears in RVF manifest.
- **Bench consumer**: `v3/@claude-flow/cli/scripts/bench-rvagent.mjs` (312 lines, new) — exercises the 4 phases for P50/P95 reporting.

## Fork's WASM agent surface today

In `/Users/henrik/source/forks/ruflo`, fork branch `main` at `34119ebcb`:

- **`v3/@claude-flow/cli/src/ruvector/agent-wasm.ts`** (455 lines) — the WASM adapter. Exports `createWasmAgent`, `promptWasmAgent`, `executeWasmTool`, `rehydrateWasmAgent`, `getWasmAgent`/State/Tools/Todos, `exportWasmState`, `terminateWasmAgent`, `listWasmAgents`, `createWasmMcpServer`, `listGalleryTemplates`/Count/Categories/Search, `getGalleryTemplate`, `createAgentFromTemplate`, `buildRvfContainer`, `buildRvfFromTemplate`.
- **`v3/@claude-flow/cli/src/mcp-tools/wasm-agent-tools.ts`** (519 lines) — MCP tool registry with cross-process persistence layer. Defines the 10 fork-baseline `wasm_*` tools.
- **`v3/@claude-flow/cli/src/types/optional-modules.d.ts:234-313`** — declares the full target API including `set_model_provider`, `JsModelProvider`, `addMcpTools`, all `WasmGallery` methods (including `loadRvf`, `importCustom`, `getCategories`, etc.) and `get_state`/`get_todos`/`get_tools`/`reset`. Stub typing: declares `loadRvf(data: Uint8Array): boolean` (wrong direction); the actual package types in `forks/ruvector/npm/packages/rvagent-wasm/rvagent_wasm.d.ts:187` declare `loadRvf(id: string): Uint8Array` (correct).
- **Fork's package pin** — `v3/@claude-flow/cli/package.json:125`: `"@ruvector/rvagent-wasm": "0.2.1-patch.145"`. Source at `/Users/henrik/source/forks/ruvector/npm/packages/rvagent-wasm`, sparkling fork of the upstream `0.1.0`. Methods like `set_model_provider`, `addMcpTools`, full gallery CRUD are present in the WASM exports (`rvagent_wasm.d.ts:103, 288, 143-195`).
- **Echo-stub bypass — present, in `promptWasmAgent`**:
  ```typescript
  // agent-wasm.ts:160-191
  const wasmResult = await entry.agent.prompt(input);
  // ...
  const isEchoStub = typeof wasmResult === 'string' &&
    (wasmResult === `echo: ${input}` || /^echo: /.test(wasmResult.slice(0, 12)));
  if (!isEchoStub) {
    return wasmResult;
  }
  // Echo stub detected — route through a real LLM call.
  if (!process.env.ANTHROPIC_API_KEY) { return `${wasmResult}\n[NOTE...]`; }
  const { callAnthropicMessages, resolveAnthropicModel } = await import('../mcp-tools/agent-execute-core.js');
  // ... best-effort recovery via callAnthropicMessages ...
  ```
- **`JsModelProvider` not constructed anywhere** — `grep -rn "new JsModelProvider\|set_model_provider" v3/@claude-flow/cli/src --include="*.ts"` returns:
  - `v3/@claude-flow/cli/src/types/optional-modules.d.ts:245` (type declaration only)
  - `v3/@claude-flow/cli/src/types/optional-modules.d.ts:260` (type declaration only)
  - `v3/@claude-flow/cli/src/ruvector/agent-wasm.ts:9` (doc-comment mentioning published API)
  - **Zero implementation hits**.
- **Persistence layer (fork-only)** — `wasm-agent-tools.ts:26-231`:
  - Path: `<projectRoot>/.claude-flow/wasm-agents/store.json` (via `findProjectRoot()`).
  - `PersistedAgent` interface (lines 32-53) records `{id, config, info, state, tools, todos, stateSnapshotAt}`.
  - `withStoreLock()` advisory-lock via `O_CREAT|O_EXCL` openSync on `store.json.lock` (5s budget, exponential backoff w/ jitter, stale-PID detection).
  - `snapshotAgent()` (lines 179-199) re-reads `getWasmAgent`/State/Tools/Todos after every state-changing op.
  - `ensureLive()` (lines 210-231) re-keys a fresh WasmAgent under the persisted ID via `rehydrateWasmAgent`.
  - Live registry is in-process only (each MCP call is a separate CLI process); persistence + rehydrate is what makes create-then-op lifecycles work across processes.
- **`rehydrateWasmAgent` (fork-only)** — `agent-wasm.ts:269-281`, called by `ensureLive` to re-key the auto-generated id from `createWasmAgent` back to the caller's persisted id.
- **Current behavior at runtime**: `wasm_agent_prompt` returns echo+hint when no key set, real Anthropic/Ollama response when keys set (via the best-effort recovery branch). Multi-turn WASM loop state (`turn_count`) is NOT advanced past 1 — every prompt is a single fresh round-trip through `callAnthropicMessages`, then snapshot. Tool dispatch inside the WASM agent's own loop never runs against a real LLM.

## Gap analysis: does fork have the bug upstream fixed?

**Yes — the echo-stub bypass is present in the fork** at `forks/ruflo/v3/@claude-flow/cli/src/ruvector/agent-wasm.ts:154-196`:

```typescript
export async function promptWasmAgent(agentId: string, input: string): Promise<string> {
  const entry = agents.get(agentId);
  if (!entry) throw new Error(`WASM agent not found: ${agentId}`);

  entry.info.state = 'running';
  try {
    const wasmResult = await entry.agent.prompt(input);
    entry.info.state = 'idle';
    syncAgentInfo(entry);

    // Detect the WASM echo stub.
    const isEchoStub = typeof wasmResult === 'string' &&
      (wasmResult === `echo: ${input}` || /^echo: /.test(wasmResult.slice(0, 12)));

    if (!isEchoStub) {
      return wasmResult;
    }

    // Echo stub detected — route through a real LLM call.
    if (!process.env.ANTHROPIC_API_KEY) {
      return `${wasmResult}\n[NOTE: bundled WASM agent has no LLM; set ANTHROPIC_API_KEY to enable real responses via Anthropic Messages API]`;
    }
    // ...callAnthropicMessages best-effort recovery...
```

This is **the exact pattern** the upstream ADR-129 P1 calls out at `ADR-129-rvagent-full-integration.md:11` ("Gap 1 — JsModelProvider wired around, not through"). The fork's bypass goes one step further than vanilla upstream pre-129 by also handling the recovery — but that's still "bypass not integrate." The bug upstream identifies and ADR-129 fixes is **present verbatim in the fork**.

Subordinate gaps from the ADR (all present in fork):
- **Gap 2 — `buildRvfFromTemplate` silently drops `mcp_tools`** — present at `agent-wasm.ts:446-455`. The fork's `buildRvfFromTemplate` passes only `{prompts, tools, skills}` to `buildRvfContainer`. The `GalleryTemplateDetail` interface (line 51) declares `mcp_tools`, but it's never read.
- **Gap 3 — 6 introspection methods unexposed via MCP** — present. The fork has `getWasmAgentState`, `getWasmAgentTools`, `getWasmAgentTodos` as TS exports (callable from inside the same process), but no MCP tools (`wasm_agent_state` etc.). The persistence layer uses them internally in `snapshotAgent`, but the surface is closed to MCP clients.
- **Gap 4 — 10 gallery methods unexposed** — present. Fork has `listGalleryTemplates`, `getGalleryCount`, `getGalleryCategories`, `searchGalleryTemplates`, `getGalleryTemplate`, `createAgentFromTemplate`, `buildRvfFromTemplate` only. No `loadRvf`, `configure`, `listByCategory`, `addCustom`, `removeCustom`, `importCustom`, `exportCustom`, `getActive`, `getConfig` exports.
- **Gap 5 — no plugin bridge** — present. Fork has no `loadPluginManifest`/`extractPluginSkills` helpers and no plugin.json `rvagent` field handling.

## Integration points

Per-file map for landing ADR-129 in `/Users/henrik/source/forks/ruflo`:

- **`v3/@claude-flow/cli/src/ruvector/agent-wasm.ts`** (455 → ~635 lines):
  - Insert `attachJsModelProvider(agent, config)` async helper (new ~30 lines) before `createWasmAgent`.
  - Modify `createWasmAgent` to call `await attachJsModelProvider(agent, config)` after `new mod.WasmAgent(configJson)` (existing line 122).
  - Update `promptWasmAgent` doc + simplify keyless fallback (echo-detection block becomes the secondary path; P1 attached provider is primary).
  - Extend `buildRvfContainer` signature with `mcpTools?: McpToolDescriptor[]` + new branch calling `builder.addMcpTools(JSON.stringify(opts.mcpTools))`.
  - Update `buildRvfFromTemplate` to pass `mcpTools: template.mcp_tools`.
  - Add 10 gallery CRUD exports: `galleryLoadRvf`, `galleryConfigure`, `galleryListByCategory`, `galleryAddCustom`, `galleryRemoveCustom`, `galleryImportCustom`, `galleryExportCustom`, `galleryGetActive`, `galleryGetConfig` + `resetWasmAgent` (per `agent-wasm.ts:496-558` post-129).
  - Add `export interface McpToolDescriptor`.
- **`v3/@claude-flow/cli/src/mcp-tools/wasm-agent-tools.ts`** (519 → ~1040 lines):
  - Imports: add `readFileSync, existsSync` (already imported in fork), add `resolve` from `node:path`.
  - Insert `DESTRUCTIVE_TOOL_PATTERNS`, `isDestructiveTool`, `SAFE_MCP_TOOLS`, `PluginRvagentConfig`, `PluginManifest`, `loadPluginManifest`, `extractPluginSkills` helpers (P2/P4 — ~80 lines, see upstream lines 27-99).
  - Add 16 new tool entries (P2 + P3): `wasm_agent_compose`, `wasm_agent_state`, `wasm_agent_todos`, `wasm_agent_tools`, `wasm_agent_turn_count`, `wasm_agent_is_stopped`, `wasm_agent_reset`, `wasm_gallery_load_rvf`, `wasm_gallery_configure`, `wasm_gallery_categories`, `wasm_gallery_list_by_category`, `wasm_gallery_add_custom`, `wasm_gallery_remove_custom`, `wasm_gallery_import` (with `aidefence_scan` gate), `wasm_gallery_export`, `wasm_gallery_active`, `wasm_gallery_config`.
  - **Persistence-layer threading**: each new agent-mutating tool (`wasm_agent_reset` at minimum) must wrap its handler with `await ensureLive(agentId)` (fork pattern) and re-snapshot via `withStoreLock(() => saveStore(...))`. The introspection tools (`wasm_agent_state`/`todos`/`tools`) need `ensureLive` first or they error on cold processes. **This is the largest divergence from upstream's hand-off**.
- **`v3/@claude-flow/cli/src/types/optional-modules.d.ts`** (line 295):
  - Fix the stale `loadRvf(data: Uint8Array): boolean` to `loadRvf(id: string): Uint8Array` to match the actual package types in `rvagent_wasm.d.ts:187`. The shim was always wrong — landing P3 forces the issue.
- **`scripts/smoke-wasm-*.mjs`** — 4 new files (cherry-pick verbatim or hand-adjust paths for fork's harness):
  - `smoke-wasm-provider-bridge.mjs`
  - `smoke-wasm-rvf-compose.mjs`
  - `smoke-wasm-gallery-crud.mjs`
  - `smoke-wasm-plugin-bridge.mjs`
- **`.github/workflows/v3-ci.yml`** — add 4 CI jobs (one per smoke).
- **`v3/@claude-flow/cli/__tests__/wasm-agent-tools.test.ts`** (141 → 157 lines in upstream after PR) — minor additions; fork already has the larger persistence-test variant.
- **`v3/@claude-flow/cli/scripts/bench-rvagent.mjs`** (new, 312 lines) — bench harness; optional for first land.
- **`docs/benchmarks/rvagent-baseline.json`** (new) — first measurement; optional.

## Conflict surfaces

Where fork diverges from upstream's wiring:

- **`wasm-agent-tools.ts:1-231`** — fork's persistence layer doesn't exist upstream. Upstream's new `wasm_agent_reset` handler (`wasm-agent-tools.ts:534-554` post-129) calls `wasm.resetWasmAgent` directly; fork must wrap with `await ensureLive(agentId)` and re-snapshot to persist the cleared state. Reason for divergence: upstream relies on the same-process in-memory `agents` Map; fork needs cross-process persistence because each MCP tool call is a separate CLI process.
- **`agent-wasm.ts:258-283`** — fork's `rehydrateWasmAgent` is fork-only. Doesn't conflict with ADR-129, but the new ADR-129 introspection wrappers (`getWasmAgentState`/Tools/Todos already exist in fork) must continue to work after `ensureLive` rehydrates a cold process — particularly important for `wasm_agent_state` (P3) which is meaningless on a freshly-rehydrated agent if the state wasn't persisted. Fork's `snapshotAgent` does persist state, but the new P3 tools must read from persistence (or live state) consistently.
- **`agent-execute-core.ts:94-130`** — fork's `callAnthropicMessages` supports **Anthropic + Ollama only**. Upstream pre-129 already supports **Anthropic + OpenRouter + Ollama** (issue #2042 fix). The fork is missing OpenRouter routing. Reason: upstream `9c1a71f00` (Ollama) and `562687ff2` (OpenRouter) landed in upstream's pre-129 baseline; fork picked up Ollama but not OpenRouter. ADR-129 P1's `attachJsModelProvider` checks `OPENROUTER_API_KEY` for activation guard — degrades gracefully but loses upstream's three-provider promise.
- **`optional-modules.d.ts:295`** — fork's `loadRvf(data: Uint8Array): boolean` declaration is wrong relative to the actual package (`rvagent_wasm.d.ts:187` says `loadRvf(id: string): Uint8Array`). Not a runtime conflict, but P3's `galleryLoadRvf` adapter won't type-check without fixing it. Reason: stub typing predates the `0.2.1-patch.145` API and was never updated.
- **`package.json:125`** — fork pins `@ruvector/rvagent-wasm@0.2.1-patch.145`; upstream pin (line 124 in upstream post-129 package.json) is still `^0.1.0`. Functionally fork is *ahead*: the 0.2.x rvagent already has all ADR-129's target methods. No conflict, but worth noting if upstream eventually bumps to a 0.2.x that drifts further.
- **No `ADR-115` in fork** — upstream ADR-129 anchors itself in ADR-115 (the rvagent rename). Fork has ADR-127, 128, but no ADR-115/118/119-126 individually copied. The rename has effectively happened (fork uses `@ruvector/rvagent-wasm` everywhere), but the doc trail is absent. Not a code-level conflict; relevant if the queen wants citation chain.

## Dependencies

ADR-129 builds on:

- **Issue #2042 — OpenRouter provider routing** (`/Users/henrik/source/ruvnet/ruflo` commit `562687ff2` or thereabouts). **NOT in fork**. ADR-129 P1 uses `callAnthropicMessages` for the JsModelProvider callback. Fork's `callAnthropicMessages` (`agent-execute-core.ts:94-130`) supports Anthropic + Ollama only. Decision needed: backport OpenRouter routing to fork first, or land P1 with the two-provider subset and re-converge with upstream later.
- **Issue #1810 — model pin fix** (`fix(wasm): bump default Sonnet from 20250514 to 4.6`, upstream `2fd38f4de`). **Present in fork** at `agent-wasm.ts:116` (`'anthropic:claude-sonnet-4-6'`).
- **G4 echo-routing fix** (upstream `591839304`). **Present in fork** at `agent-wasm.ts:154-196` (the bypass that ADR-129 P1 replaces).
- **ADR-115 — rvagent rename**. **Functionally in fork** (no `agentic-flow-wasm` references; all imports use `@ruvector/rvagent-wasm`). Doc not copied.
- **ADR-118 — AIDefence 2.3.0 integration pattern**. **Present in fork**: `@claude-flow/aidefence@3.0.2-patch.836` (`package.json:109`); `getAIDefence` lazy singleton + `aidefence_scan` MCP tool exist at `mcp-tools/security-tools.ts:55,164`. P3's `wasm_gallery_import` AIDefence gate has the prerequisites it needs.
- **ADR-127 — GitHub stack modernization**. **Present in fork** at `v3/docs/adr/ADR-127-github-stack-modernization.md`. ADR-129 cites it for smoke-pattern reuse; no code dep.
- **`@ruvector/rvagent-wasm` runtime methods**: `set_model_provider`, `JsModelProvider`, `addMcpTools`, `loadRvf(id: string): Uint8Array`, `importCustom(string): number`, `getCategories()`, `listByCategory(string)`, `addCustom/removeCustom/configure/getActive/getConfig`, `WasmAgent.reset()/get_state()/get_todos()/get_tools()/turn_count()/is_stopped()`. **All present** in fork's `0.2.1-patch.145` per `forks/ruvector/npm/packages/rvagent-wasm/rvagent_wasm.d.ts:103,143,187,195,288,358-360,366-367`.
- **`@claude-flow/aidefence`**: required for P3's `wasm_gallery_import` gate. **Present in fork**.
- **Fork's persistence layer** (no upstream counterpart): every P2/P3 mutating tool must thread through `withStoreLock` + `snapshotAgent`. This is **net new integration work** not present in upstream's PR.

## Open questions for the queen

1. **OpenRouter dependency — backport first or ship two-provider?** Upstream's ADR-129 P1 assumes Anthropic + OpenRouter + Ollama via `callAnthropicMessages`. Fork has only Anthropic + Ollama (#2042 OpenRouter routing not back-ported). Options: (a) backport upstream #2042 OpenRouter dispatch into `agent-execute-core.ts` as a prerequisite ADR; (b) land ADR-129 P1 with the two-provider subset and document the divergence; (c) defer ADR-129 entirely until #2042 is back-ported. Affects 1 file (`agent-execute-core.ts`); upstream's openrouter code is at `9c1a71f00`-ish commits.
2. **Persistence-layer threading for the 16 new tools.** Each new agent-mutating MCP tool (`wasm_agent_reset`, the 6 introspection ones, anything that touches gallery `addCustom`/`removeCustom`/`importCustom`/`configure`) must go through fork's `ensureLive` + `withStoreLock` + `snapshotAgent` pattern. Upstream's PR has zero awareness of this layer. Verify: does `wasm_agent_compose` need to persist composed RVFs to `store.json`, or are they ephemeral (returned to caller as base64 and forgotten)? If ephemeral — no persistence threading. If composed agents need to be recoverable across processes — the `PersistedAgent` interface needs an `rvf?: string` or `composed?: boolean` field, which is a forward-compatible schema change.
3. **`SAFE_MCP_TOOLS` allowlist correctness for fork's MCP surface.** Upstream's safe-list at `wasm-agent-tools.ts:46-58` post-129 names 30 tools (memory_*, embeddings_*, hooks_*, wasm_*, agentdb_*, neural_*, task_*). Verify each name resolves to a real tool in fork's MCP registry. Fork divergence: some names may differ (e.g. fork may have `memory_search_unified`, `memory_bridge_status`, etc. that upstream doesn't). Consider auditing fork's `mcp__ruflo__*` exports against the upstream allowlist before merge.
4. **Plugin bridge (P4) — does fork's plugin layout match upstream's path search?** Upstream's `loadPluginManifest` searches `plugins/<name>/.claude-plugin/plugin.json`, `plugins/ruflo-<name>/...`, `v3/plugins/<name>/...`. Fork has `/Users/henrik/source/forks/ruflo/plugins/` and `/Users/henrik/source/forks/ruflo/v3/plugins/`; matches. But if fork's plugin layout adds extra prefixes (e.g. `forks/ruflo/plugin/<name>`) the search needs adjustment. Spot-check on the next existing plugin manifest before merge.
5. **`@ruvector/rvagent-wasm` version-pin policy.** Fork is on `0.2.1-patch.145`; upstream's PR uses `^0.1.0`. Functionally fork is ahead and the API is present, but: do we want to (a) pin upstream's `^0.1.0` semantics during ADR-129 land for parity-of-validation against upstream smokes, (b) hold the `0.2.1-patch.145` pin and accept that the smokes are validating a different runtime, or (c) bump upstream's pin in the merged PR to match fork? Recommend (b) — fork's runtime is the production target and 0.2.x is API-compatible per declaration walk.

---

**Commit hash**: pending (file written, commit follows).
**Verdict**: **partial-pick** — Phases 1-4 are substantively right for the fork and the rvagent runtime already supports them; the integration is non-trivial because of (a) missing OpenRouter routing in fork's `callAnthropicMessages` and (b) the cross-process persistence layer that upstream isn't aware of. Blockers in priority order: 1 (OpenRouter decision), 2 (persistence-layer threading design), 3 (safe-list audit). Phase 4 is unblocked and could ship first as a low-risk pilot.
