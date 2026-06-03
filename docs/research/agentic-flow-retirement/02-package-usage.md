# Facet 2 — Catalog of live `agentic-flow` PACKAGE usage in `forks/ruflo`

Swarm `swarm-1780507536857-mruhcx`, facet 2 of 5. READ-ONLY.

Scope: `forks/ruflo` live tree only. EXCLUDES `archive/`, `node_modules`, `dist`, `*.map`, tests
(`*.test.*`, `*.spec.*`, `__tests__/`). Freshness: working tree as of 2026-06-03.

## TL;DR

- **The prior pass's "~3 places" claim is wrong (undercount).** There are **17 source references**
  to the `agentic-flow` package across the live tree; of those, **2 are code comments** (not imports),
  leaving **15 real import sites** in **11 files**.
- **Exactly ONE is a static import** (`from 'agentic-flow/transport/loader'`,
  `plugin-agent-federation/src/plugin.ts:46`). **Every other use is a dynamic
  `import('agentic-flow…').catch(() => null)`** that degrades to a local fallback.
- `agentic-flow` is declared **`optionalDependencies`** in BOTH the root `claude-flow`
  package.json AND `cli/package.json` — it is **never a hard dependency**.
- **(i) Drop-the-dep** and **(ii) retire-the-AgentDBService+fastmcp-subset** are different actions.
  - **(i) Cannot drop the npm dep outright while keeping current behavior.** A small number of live
    feature paths still *opportunistically* load it: `autopilot-learning` (CLI autopilot),
    `reasoningbank` embeddings (neural-tools, hooks `pretrain`, token-optimizer), and federation
    QUIC transport. Dropping it doesn't crash anything (all guarded), but it silently disables
    those features. It's an **optionalDep**, so "dropping" = removing the optional dep + the
    consumer call sites; the dep is *opportunistically* (not *structurally*) load-bearing.
  - **(ii) Retiring the `AgentDBService` + fastmcp subset *within the fork* is NOT safe as-is**,
    because the one live coordination subpath claude-flow imports — `agentic-flow/coordination/autopilot-learning`
    — has a **hard runtime coupling to `AgentDBService`** (`getAgentDBService()`, `storeEpisode`,
    `recallEpisodes`, `getSonaService`). The fastmcp *MCP-server tool layer*, separately, has **no
    claude-flow importer at all** and is a stronger retirement candidate (see §4).

## 1. Complete reference table (live tree)

| # | File:line | Kind | Specifier / symbol | Live or vestigial |
|---|---|---|---|---|
| 1 | `plugin-agent-federation/src/plugin.ts:46` | **static import** | `agentic-flow/transport/loader` → `loadQuicTransport`, `getTransportCapabilities`, types | **LIVE** (only hard import; but in an *optional installable* plugin, not auto-loaded by CLI) |
| 2 | `cli/src/autopilot-state.ts:334` | dynamic `import().catch` | `agentic-flow/coordination/autopilot-learning` → `AutopilotLearning` | **LIVE** (CLI autopilot; guarded, returns null if absent) |
| 3 | `cli/src/mcp-tools/neural-tools.ts:25` | dynamic `import().catch` | `agentic-flow/reasoningbank` → `computeEmbedding` (Tier-1 embeddings) | **LIVE** (falls back to `@claude-flow/embeddings`, then hash) |
| 4 | `cli/src/commands/hooks.ts:4616` | dynamic `import().catch` | `agentic-flow/reasoningbank` → `retrieveMemories`/`formatMemoriesForPrompt` (in `pretrain`) | **LIVE** (guarded; "using fallbacks" path) |
| 5 | `cli/src/commands/hooks.ts:4630` | dynamic `import().catch` | `agentic-flow` (main, legacy availability probe) | LIVE-but-probe-only (only reached if reasoningbank import already failed) |
| 6 | `cli/src/ruvector/enhanced-model-router.ts:556` | dynamic `import().catch` | `agentic-flow/agent-booster` → `enhancedApply` | **VESTIGIAL** — subpath maps to a dist file that **does not exist** (`agent-booster/index.js` missing); code comment admits it; always falls through to npx fallback |
| 7 | `integration/src/agentic-flow-bridge.ts:226` | dynamic `import().catch` | `agentic-flow` (main) → `createAgenticFlow` factory | **VESTIGIAL** — main entry does **not export `createAgenticFlow`**; factory is always `undefined` → permanent local-fallback |
| 8 | `integration/src/agent-adapter.ts:446` | dynamic `import().catch` | `agentic-flow` (main) → `createAgenticFlow` | **VESTIGIAL** (same: factory never exists) |
| 9 | `integration/src/swarm-adapter.ts:851` | dynamic `import().catch` | `agentic-flow` (main) → `createAgenticFlow` | **VESTIGIAL** (same) |
| 10 | `integration/src/sdk-bridge.ts:339` | dynamic `import().catch` | `agentic-flow` (main) → `VERSION` | **VESTIGIAL** — main does not export `VERSION`; always falls back to hardcoded `2.0.1-alpha.50` |
| 11 | `integration/src/token-optimizer.ts:68` | dynamic `safeImport` | `agentic-flow` (main) + `agentic-flow/reasoningbank` + agent-booster | Mixed: main/booster VESTIGIAL; reasoningbank branch is real-but-only-if-installed |
| 12 | `plugins/src/integrations/agentic-flow.ts:36–37` | dynamic `import()` | `agentic-flow/core` + `agentic-flow` (main) | **VESTIGIAL** — `agentic-flow/core` subpath **does not exist** in exports (only `./wrappers` maps to dist/core); load always fails → fallback |
| 13 | `cli/src/services/agentic-flow-bridge.ts:30` | dynamic `import().catch` | `agentic-flow/reasoningbank` | **VESTIGIAL** — entire bridge file has **0 importers** in live CLI source |
| 14 | `cli/src/services/agentic-flow-bridge.ts:41` | dynamic `import().catch` | `agentic-flow/router` | **VESTIGIAL** (0 importers) |
| 15 | `cli/src/services/agentic-flow-bridge.ts:52` | dynamic `import().catch` | `agentic-flow/orchestration` | **VESTIGIAL** — 0 importers AND `orchestration` subpath **does not exist** in exports |
| — | `swarm/src/queen-coordinator.ts:1251` | **comment** | `// use: import('agentic-flow').computeEmbedding` | not an import |
| — | `integration/src/swarm-adapter.ts:889` | **comment** | same illustrative comment | not an import |

### Out-of-scope but adjacent (NOT in `forks/ruflo`)
- `ruflo-patch/.claude/helpers/learning-service.mjs:463` — reaches **directly into the filesystem**
  (`node_modules/agentic-flow/dist/embeddings/optimized-embedder.js`, `existsSync`-guarded), bypassing
  the exports map. This lives in the **patch repo**, not the fork, so it's outside my facet's scope —
  but it is a real opportunistic consumer of the installed package and another facet/owner should
  account for it when judging whether the *installed artifact* can disappear.

## 2. What the agentic-flow package actually exports (ground truth)

`forks/agentic-flow` `package.json` `exports` + `dist` reality:
- **Main entry `agentic-flow` (`dist/index.js`) exports only `reasoningbank` (namespace) and `main`.**
  It does **NOT** export `createAgenticFlow`, `computeEmbedding`, `retrieveMemories`, or `VERSION`
  at the top level. This is why all `import('agentic-flow')`-for-`createAgenticFlow`/`VERSION` sites
  (#7–#10) are permanent no-op fallbacks.
- Real, resolvable subpaths used live: `./reasoningbank` ✓, `./transport/loader` ✓,
  `./coordination/autopilot-learning` ✓, `./router` ✓.
- Referenced-but-broken subpaths: `./agent-booster` (mapped, dist file missing), `./core`
  (not in exports), `./orchestration` (not in exports).

## 3. What keeps the dep alive (the honest minimum)

If you removed every VESTIGIAL site (rows 6–15), the dep would still be *opportunistically* pinned by
the LIVE sites:
1. **`autopilot-learning`** — CLI `autopilot-state.ts` (the autopilot/`/loop` feature).
2. **`reasoningbank`** — Tier-1 ML embeddings in `neural-tools.ts` + memory retrieval in hooks `pretrain`.
3. **`transport/loader`** — federation QUIC/WebSocket wire transport (the ONE static import).

All three are guarded/optional. None *crash* if the dep is absent (it's an `optionalDependencies`);
they degrade: hash-based embeddings instead of ML, no autopilot learning, no federation transport.
So the accurate statement is: **the dep is opportunistically load-bearing for 3 features, not
structurally required for the package to boot.** "Drop the dep" therefore = a feature-removal
decision (kill those 3 paths), not a pure cleanup.

Caveat on the static import (#1): it sits in `@claude-flow/plugin-agent-federation`, which is a
**separate workspace package** compiled on its own and shipped as an **optional installable**
(`npm install @claude-flow/plugin-agent-federation@alpha`, per `cli/commands/doctor.ts:481/496`) —
it is NOT auto-registered into the main CLI. So this static import does not pin agentic-flow inside
the primary shipped CLI artifact; it pins it only for users who install that plugin. (Notably the
plugin's own package.json doesn't even declare agentic-flow as a dep — it relies on the host install.)

## 4. (i) Drop-dep vs (ii) Retire-subset — explicit verdicts

These are **different actions**; a reader must not conflate them.

**(i) Drop the `agentic-flow` npm dependency from claude-flow.**
- **Verdict: not a free cleanup — it's a 3-feature removal.** Mechanically safe (optionalDep, all
  consumers guarded), but it disables autopilot-learning, ReasoningBank ML embeddings, and federation
  transport. Removing rows 6–15 (the vestigial sites) is pure cleanup with **zero behavioral change**
  (those already no-op today). Whether to also cut rows 1–4 is the real product decision.

**(ii) Retire agentic-flow's `AgentDBService` + fastmcp layer *within the agentic-flow fork*.**
- The two pieces split cleanly and should be judged **separately**:
  - **fastmcp MCP-server *tool* layer** (`agentic-flow/src/mcp/fastmcp/**`, `standalone-stdio*.ts`):
    **claude-flow imports `agentic-flow/agentdb` and the fastmcp tools NOWHERE** in the live tree
    (grep empty). From claude-flow's perspective this subset is **unreached** → the strongest
    retirement candidate *with respect to claude-flow*. (Whether agentic-flow's *own* standalone MCP
    binary needs it is a different fork-internal question this facet didn't fully chase — flagged.)
  - **`AgentDBService` class itself**: **NOT dead weight.** The one live coordination subpath
    claude-flow does import — `coordination/autopilot-learning` — has a **hard runtime dependency**
    on `AgentDBService` (`getAgentDBService()`, `storeEpisode`, `recallEpisodes`, `getSonaService`,
    `generateEmbedding(s)`, DEGRADED-mode status checks). Retiring `AgentDBService` would break the
    autopilot-learning feature that claude-flow actively loads. The live-consumed `reasoningbank`
    and `transport/loader` subpaths, by contrast, have **no** dependency on `AgentDBService`/fastmcp
    (grep empty) — clean separation.

**Net:** you *can* retire the **fastmcp MCP-server tool subset** within the fork independently of the
dep question (no claude-flow consumer), but you *cannot* retire **`AgentDBService`** without first
severing/replacing the autopilot-learning coupling. And dropping the npm dep entirely is a
feature-cut, not a no-op cleanup.

## 5. Caveats / not fully determined

- I did not trace whether agentic-flow's **own** standalone MCP entrypoint (`standalone-stdio.ts`)
  is shipped/used independently of claude-flow; the fastmcp "unreached by claude-flow" verdict is
  scoped to claude-flow's import graph, which is this facet's remit. Facet owners covering the
  agentic-flow fork's own surface should confirm.
- The `learning-service.mjs` filesystem-path consumer lives in `ruflo-patch`, outside `forks/ruflo`;
  noted but not in scope.
- "Vestigial" here means "the import resolves to undefined/missing and always hits the fallback,"
  established from the exports map + `dist/index.js` export list — not from runtime tracing. The
  conclusions about missing exports (`createAgenticFlow`, `VERSION`, `./core`, `./orchestration`,
  `agent-booster` dist) are firm; the "0 importers" facts are from grep of the live `.ts` tree.
