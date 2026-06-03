# Facet 1 — Live-invocation trace of agentic-flow MCP / AgentDBService

Swarm `swarm-1780507536857-mruhcx`, facet 1 of 5. READ-ONLY trace. No code modified.

## Verdict

**The agentic-flow fastmcp MCP server (`stdio-full` / `poc-stdio` / `http-sse` / `hooks-server`) is NEVER reached in any live ruflo workflow.** Its only entry points are the standalone `agentic-flow` bin (`dist/cli-proxy.js`) and the package.json `mcp:*` scripts — both human-run-by-hand only. No ruflo daemon, worker, skill, plugin, CI job, init template, or the claude-flow v3 MCP server launches, spawns, registers, or proxies to it.

**The `AgentDBService` CLASS is reached on exactly ONE narrow live ruflo edge — but NOT via fastmcp.** ruflo's CLI lazily does `import('agentic-flow/coordination/autopilot-learning')` (autopilot-state.ts:334, `.catch(()=>null)`), and `AutopilotLearning.initialize()` transitively does `import('../services/agentdb-service.js')` → `getAgentDBService()` (autopilot-learning.ts:384-385). So `AgentDBService` is **transitively, optionally** reachable from a live ruflo path. The fastmcp layer is not on that path.

Net: **fastmcp = dead weight for ruflo. AgentDBService = NOT pure dead weight** — one optional CLI consumer keeps it alive (plus agentic-flow's own bins/fastmcp).

## Launch surfaces for agentic-flow's MCP server, and who triggers them

| Surface | Entry | Triggered by ruflo? |
|---|---|---|
| `agentic-flow` bin | `dist/cli-proxy.js` (package.json bin) | No — only a human `npx agentic-flow ...` |
| `agentdb` bin | `dist/agentdb/cli/agentdb-cli.js` (package.json bin) | No |
| fastmcp stdio-full / poc-stdio / http-sse / hooks-server | `package.json` scripts `mcp:stdio` / `mcp:fastmcp-poc` / `mcp:http`, + `src/mcp/fastmcp/servers/*` | No — package-local scripts; nothing in ruflo invokes them |
| claude-flow v3 MCP server | `@claude-flow/mcp` | **No reference at all** — see proof #2 |

## Proof (file:line)

1. **Live ruflo MCP = claude-flow v3, agentdb tools are claude-flow's own.**
   `.mcp.json` → `npx -y @sparkleideas/ruflo@latest mcp start`, `CLAUDE_FLOW_MODE=v3`.
   `v3/@claude-flow/cli/dist/src/mcp-tools/agentdb-tools.js` imports from `../memory/memory-router.js`, `./agentdb-orchestration.js`, `../memory/archivist-init.js` — **zero** agentic-flow.

2. **v3 MCP package has NO agentic-flow/fastmcp/AgentDBService reference.**
   `grep agentic-flow|fastmcp|AgentDBService|stdio-full` over `v3/@claude-flow/mcp/{src,dist}` → empty. The live MCP server does not delegate/proxy any tool to agentic-flow's fastmcp (answers swarm sub-Q4).

3. **Nothing spawns the agentic-flow / agentdb bin.**
   `grep spawn|exec|child_process … agentic-flow|agentdb` over all of `v3/@claude-flow` → only agent-*spawning* APIs and doc comments. No `child_process` of either bin (sub-Q6).

4. **agentic-flow is an OPTIONAL lazy peer, and the bridge targets `agentic-flow/core` + `agentic-flow` — not fastmcp, not AgentDBService.**
   `v3/@claude-flow/plugins/dist/integrations/agentic-flow.js:24-35` `loadAgenticFlow()` does `import('agentic-flow/core')` + `import('agentic-flow')`, `catch { return false }`. Its "MCP command handler" at :265 is an **in-process** `agenticFlowAgents.handleMCPCommand?.(...)` call on that module — NOT the fastmcp stdio server. This `AgenticFlowBridge` is exported but only consumed by the CLI update-checker allowlist (`update/checker.js:23`, `validator.js:11`) and a DDD-metrics worker that reads the dir by name (`hooks/dist/workers/index.js:1111`) — **never instantiated in a live MCP path**.

5. **The ONLY live ruflo→agentic-flow runtime imports (all `.catch(()=>null)` optional):**
   - `agentic-flow/reasoningbank` — TokenOptimizer (`integration/.../token-optimizer.js:48`), neural-tools embeddings (`cli/.../mcp-tools/neural-tools.js:23`), hooks/memory commands. Embedding/RB surface, **not** fastmcp, **not** `AgentDBService`.
   - `agentic-flow/coordination/autopilot-learning` — `cli/dist/src/autopilot-state.js:285`. This is the one edge that **transitively** reaches `AgentDBService` (autopilot-learning.ts:384 `import('../services/agentdb-service.js')` → `getAgentDBService()`).

6. **No init/template registers agentic-flow as an MCP server (sub-Q5).**
   `.claude` skills mention `npx agentdb@latest mcp` (ruvnet's standalone `agentdb` npm pkg, doc-only) — never agentic-flow's fastmcp. No `.mcp.json` template adds an `agentic-flow` server entry.

7. **CI never launches it (sub-Q3).**
   Only `ruflo-patch/.github/workflows/v3-ci-quic.yml` even contains the string "agentic-flow"; no workflow runs its fastmcp server or the bins.

8. **gastown-bridge `IAgentDBService` is a RED HERRING** — a local in-memory-stub interface (`sync-bridge.ts:215`, `createStubAgentDB` index.ts:1146), unrelated to agentic-flow's `AgentDBService` class. And v3 `controller-intercept.ts:8` states "ADR-0085: AgentDBService reference removed — no such class exists" *within the v3 monorepo* (the class lives only in agentic-flow).

## Caveats

- "fastmcp dead for ruflo" is about LIVE invocation. The standalone `agentic-flow`/`agentdb` bins still expose fastmcp to a human — retiring fastmcp removes that hand-run surface (out of scope here, but a real consumer for facets weighing total retirement).
- `AgentDBService` retirement is gated by the `autopilot-learning` → `agentdb-service.js` edge AND agentic-flow's own `reasoningbank` path that ruflo *does* import. Retiring fastmcp alone is safe for ruflo; retiring `AgentDBService` is **not** without first severing/replacing the `autopilot-learning` consumer (confirm with facets owning the autopilot-state + reasoningbank surfaces).
- Trace was over working trees (forks/ruflo @ patch.408, agentic-flow @ 2.0.2-alpha-patch.956); not validated against a fresh installed `@sparkleideas/ruflo`. The `.mcp.json` + v3-MCP-package facts are the load-bearing ones and are config/source, not install-state-dependent.
