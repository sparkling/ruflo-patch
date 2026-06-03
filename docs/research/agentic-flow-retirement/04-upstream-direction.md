# Facet 4 — Upstream direction for agentic-flow + the AgentDBService/fastmcp layer

Swarm `swarm-1780507536857-mruhcx`, facet 4 of 5. READ-ONLY research.

**Freshness of sources (origin/main HEADs):**
- `agentic-flow` origin/main: `6a06854` — 2026-05-23 (`fix(security): CWE-78 …`)
- `agentdb` origin/main: `648e502` — 2026-05-29 (`feat: ADR-073 SOTA roadmap …`)
- `ruflo` origin/main: `844f68d` — 2026-06-02

---

## Verdict

**Retiring agentic-flow's fork-authored `AgentDBService` + fastmcp wrapper ALIGNS with upstream direction.**

Upstream has already done the consolidation our facet is asking about. The standalone `agentdb`
package is the canonical home of the "agentdb behind a service + MCP tools" concept; upstream
agentic-flow has **deleted its vendored agentdb** and now consumes the published `agentdb` npm
package as a plain dependency. There is **no `AgentDBService` and no agentdb-specific MCP layer
anywhere on any of the three forks' origin/main** — that pattern is purely a fork (ruflo-patch)
invention layered on top. Retiring it moves us *toward* upstream's shape, not away from it.

---

## Q1 — Is upstream deprecating/absorbing agentic-flow's agentdb-integration into standalone agentdb + claude-flow, or keeping a distinct AgentDB/MCP layer?

**Absorbing into standalone `agentdb`.** Evidence:

- agentic-flow `agentic-flow/src/agentdb/index.ts` (origin/main) is a **backwards-compat re-export
  shim**, not an implementation. Its header literally says:
  > "This module provides backwards-compatible exports for code that previously used embedded
  > AgentDB controllers. **Now proxies to agentdb npm package.** … @since v1.7.0 — Integrated
  > agentdb as proper dependency."
  Every export is `export { ReflexionMemory } from 'agentdb';` etc. The vendored controllers are gone.
- agentic-flow's inner `agentic-flow/package.json` (origin/main) lists `"agentdb": "^3.0.0-alpha.14"`
  as a real dependency. The root `package.json` does too. So upstream agentic-flow *depends on* the
  standalone package; it does not vendor or re-implement it.
- The standalone `agentdb@3.0.0-alpha.16` package.json description states its own purpose includes:
  > "… **Backs the agentic-flow / ruflo / Claude Code memory layer.**"
  Upstream explicitly frames agentdb as the layer that backs agentic-flow — i.e. agentic-flow is a
  *consumer*, agentdb is the *substrate*.

This is the same move ruflo-patch made internally with ADR-0161 (extract agentdb into its own 5th
fork, delete ~1,105 vendored copies). Upstream did the analogous extraction at the npm-package level.

## Q2 — Does upstream still depend on agentic-flow, and for what?

This facet's repos are the three ruvnet forks we hold locally (`ruflo`, `agentdb`, `agentic-flow`);
the claude-flow v3 monorepo is **not** present locally, so I cannot read its origin/main `package.json`
directly (caveat below). What the available origin/mains show:

- `agentdb` does **not** depend on agentic-flow (no such dep in its package.json) — the dependency
  arrow points **agentic-flow → agentdb**, one-way. agentdb is the leaf/substrate.
- agentic-flow positions itself (origin/main README) as the top-level **orchestration platform**:
  "66 self-learning agents, 213 MCP tools, autonomous multi-agent swarms." Its MCP server (the
  `fastmcp` dependency) is the **agent/swarm-orchestration** MCP surface (213 tools), *not* an
  agentdb wrapper. agentdb is just one subsystem inside it (the memory layer), consumed as a lib.
- So upstream keeps agentic-flow alive as a **distinct product**: the orchestration/agents/hooks/
  workers/ReasoningBank platform. What it does **not** keep is a bespoke agentdb-service+MCP layer —
  that role is delegated wholesale to the standalone `agentdb` package's own MCP server.

## Q3 — Is "wrap agentdb behind a service + N MCP tools" an upstream concept, or fork-only?

**The *pattern* is upstream — but it lives in the standalone `agentdb` package, not in agentic-flow.**
The specific ruflo-patch artifact (`AgentDBService` class + 12-tool fastmcp layer *inside agentic-flow*)
is **fork-only**. Two distinct things:

1. **Upstream's version (the real one):** standalone `agentdb` ships
   `agentdb/src/mcp/agentdb-mcp-server.ts` (2,470 lines) exposing **41 MCP tools** across six
   families (`agentdb_init/insert/search/delete`, `reflexion_store/retrieve`, `skill_create/search`,
   `causal_add_edge/query/traverse`, `recall_with_certificate`, `learner_discover`, `learning_*`,
   `experience_record`, `consolidate_now`, pattern store/search/stats, batch variants, …). Installed
   via `claude mcp add agentdb -- npx agentdb mcp start`. agentdb's README calls these "First-class
   Claude Code / Cursor / Cline integration."

2. **The fork's version (the one under review):** an `AgentDBService` + ~12 fastmcp tools wired
   *into agentic-flow*. Confirmed **absent from origin/main on all three forks**
   (`AgentDBService` file count = 0 / 0 / 0 for agentic-flow / agentdb / ruflo). It is *also* not
   present in our local agentic-flow or ruflo `git ls-files` HEAD under that name — so wherever the
   reviewed layer lives, it is a ruflo-patch construct, not upstream's. (Where exactly it sits in the
   patch tree is facets 1–3's concern; for this facet the load-bearing fact is: it is **not upstream**.)

Net: the fork re-invented, *inside agentic-flow*, a thin echo of the MCP-tool surface that upstream
already ships *standalone* in the `agentdb` package. Two parallel MCP surfaces for the same engine.

## Q4 — What do upstream ADRs/READMEs say about agentic-flow ↔ agentdb ↔ claude-flow + its future?

- **agentdb `docs/ADR-073-sota-roadmap-and-this-release.md` (2026-05-29, most recent commit):** the
  active SOTA roadmap. It treats agentdb's **own MCP server as the canonical agent-facing surface**
  and is *growing* it: "MCP surface jumps from 33 → ~38 tools, all wrapping internals that already
  work. Agent discoverability improves materially." It explicitly flags "Several SOTA-grade
  primitives **exist internally but aren't reachable via MCP**" as a defect to fix by exposing more
  agentdb MCP tools (causal traversal, MMR rerank, hybrid search, skill lifecycle, consolidate).
  → Upstream is **investing in agentdb's MCP layer as THE surface**, not in any agentic-flow-side wrapper.
- **agentdb README:** "🔗 agentic-flow Integration — **Drop-in** for agentic-flow — backs
  ReasoningBank, MemoryController, NightlyLearner, and 30+ agents." Confirms the substrate role.
- **agentic-flow README (origin/main):** describes agentdb only as a consumed capability via the
  `EnhancedAgentDBWrapper` code wrapper (`gnnEnhancedSearch`, `flashAttention`, GNN/attention) — an
  in-process *library* wrapper, **not** a service + MCP-tool layer. The architecture diagram stacks
  `App → EnhancedAgentDBWrapper → AgentDB@alpha`. No AgentDBService box exists.
- **agentic-flow `plans/agentdb-v2/` (ADR-001 "Backend Abstraction", ARCHITECTURE, README):** an
  older (2025-11-28) vector-**backend** abstraction plan (RuVector vs hnswlib auto-detection). It is
  about choosing the vector engine under agentdb — *not* about wrapping agentdb behind a service with
  MCP tools. So even agentic-flow's own agentdb ADRs never describe the reviewed pattern.

## Q5 — Net: align or diverge?

**ALIGN.** Retiring agentic-flow's `AgentDBService` + fastmcp layer:
- Removes a fork-only construct that **has no upstream counterpart inside agentic-flow** (and never did).
- Matches upstream's actual topology: agentic-flow consumes `agentdb` as a **library dependency**
  (re-export shim + `EnhancedAgentDBWrapper`); the **agent-facing MCP surface for agentdb is owned by
  the standalone `agentdb` package** (41 tools, actively expanding per ADR-073).
- Eliminates a duplicate/parallel MCP surface for the same engine — exactly the kind of redundancy
  upstream's consolidation (extract agentdb → standalone, agentic-flow re-exports) was designed to
  end.

The only thing that keeps agentic-flow itself alive upstream is its **orchestration platform** role
(agents, hooks, workers, ReasoningBank, swarms, its own 213-tool *orchestration* fastmcp server) —
none of which is the agentdb-service layer under review. Retiring the agentdb wrapper does **not**
touch what keeps agentic-flow alive.

---

## Caveats

- **claude-flow v3 monorepo not inspected directly.** It is not checked out locally, so I could not
  read its origin/main `package.json`/ADRs to confirm whether v3 still depends on agentic-flow and for
  what. Inference from the three forks: the dependency arrow is agentic-flow → agentdb (one-way), and
  agentdb is the shared substrate "backing agentic-flow / ruflo / Claude Code." A v3-specific check is
  the one open verification item; it does not change the align verdict, which rests on agentdb +
  agentic-flow origin/main alone.
- **"fastmcp" in agentic-flow is the orchestration server, not an agentdb wrapper.** The `fastmcp`
  dep (and the 213-tool MCP surface) serves agent/swarm orchestration. Do not conflate "agentic-flow
  uses fastmcp" with "agentic-flow wraps agentdb in fastmcp." It does not.
- **Tool-count mismatch is expected.** Upstream agentdb's surface is 41 tools (ADR-073: 33→~38 path);
  the fork's reviewed layer is ~12. The fork layer is a *subset re-wrap*, further evidence it is a
  fork convenience, not an upstream mirror.
- **Exact location of the fork's AgentDBService in the patch tree** was not pinned down here (out of
  facet scope + not found under that name in local HEAD `git ls-files`); facets 1–3 own that. This
  facet's claim is narrower and robust: the construct is absent from all upstream origin/mains.
