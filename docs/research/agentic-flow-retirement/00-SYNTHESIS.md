# Synthesis — Is agentic-flow's `AgentDBService` + fastmcp MCP layer retirable dead weight?

> Queen synthesis of swarm `swarm-1780507536857-mruhcx` (5 read-only facets, 2026-06-03).
> Facet detail: `01-live-invocation.md` · `02-package-usage.md` · `03-capability-gap.md` ·
> `04-upstream-direction.md` · `05-blast-radius.md`. **Recommendation only — no code changed, nothing deleted.**

## Verdict

**YES — retire the `AgentDBService` + fastmcp `stdio-full` "island" *within the agentic-flow fork*.** It is
fork-authored, reached by zero live ruflo paths except one duck-typed autopilot edge, loses **no** capability,
and retiring it **moves the fork toward upstream's actual topology**. Do **not** drop the agentic-flow
dependency itself (the live tree still needs ~15 other subpaths). The fork's own code already calls this layer
the legacy path "Phase 5 will remove entirely."

Recommended scope = **Scope A** (facet 5): retire the island in the fork; keep the dep.

## Why (the five facets converge)

1. **Not launched live (facet 1).** agentic-flow's fastmcp server (`stdio-full`) is reached by **no** ruflo
   daemon/worker/skill/plugin/CI/init, and the claude-flow v3 MCP server has zero reference to it. The only
   live edge to the *class* is a **duck-typed** `getAgentDBService()` call inside `autopilot-learning`.
2. **Package usage splits cleanly (facet 2).** agentic-flow is an `optionalDependency`; the live tree uses it
   for reasoningbank / workers / core / hooks / transport / autopilot-learning — **none of which is the
   AgentDBService+fastmcp island.** "Drop the dep" ≠ "retire the island"; only the latter is in scope.
3. **Zero capability loss (facet 3).** The island backs **~80+ tools** (not "12") across ~10 fastmcp modules and
   ~30 `AgentDBService` methods — *every one* is a thin delegation to a `forks/agentdb` controller that
   survives, or maps to a live `mcp__ruflo__*` tool / `agentdb` CLI command. Truly-unique-and-lost: **none**.
   The fork's own `controller-bridge.ts` header: AgentDBService is the legacy path, "**Phase 5 will remove this
   bridge entirely**." Even `agentic-flow mcp` routes to a slim server *without* AgentDBService.
4. **Aligns with upstream (facet 4).** Upstream already consolidated: agentic-flow deleted its vendored agentdb
   and now **re-exports the standalone `agentdb` package**; `agentdb`'s own MCP server (41 tools, growing per
   ADR-073) is the canonical agent-facing surface. The fork's `AgentDBService`+fastmcp is a **duplicate parallel
   surface that exists on no upstream branch**. Retiring it removes the redundancy upstream's split was meant to
   end. (agentic-flow stays alive upstream as the *orchestration* platform — untouched by this.)
5. **Low, bounded blast radius (facet 5).** A self-contained **14-file static-import island**; no published
   `exports` subpath, no arch-guard gate, no skill surface. What must move in the same change: the
   `check_adr0089_agentdb_service_wraps` acceptance check (both `run_check_bg` + `collect_parallel`), an
   INTEGRATION-LEDGER row, a new reverse-import guard, dead codemod rewrites, and the `agentic-flow mcp`
   subcommand decision.

## F10 interaction — orthogonal (facet 5 §3)

F10's chosen seam (a) writes episodes through the **ruflo/SQLite** path (`hooks_post-task → agentdb_reflexion_store`)
and **never touches `AgentDBService`**. `_attachLearningSubscriber` (which lives in `AgentDBService`) is the
expensive event-bus half-seam F10 **rejected**. So retiring `AgentDBService` removes the producer-half F10
already chose not to use. **Recommendation: land F10 seam (a) first**, so the producer is provably island-free
before deletion. The one thing to preserve is the duck-typed episode-sink contract `autopilot-learning` expects
— in the live ruflo path the injector is ruflo-side, so likely safe; confirm at execution time.

## Correction this swarm forced on ADR-0287 §F5

My first F5 reachability note ("banner only on agentic-flow's own surface, not the live process") was **too
clean** and is now corrected in the ADR. The banner *is* reachable in the live claude-flow process — via the
autopilot edge `tryLoadLearning()` → `autopilot-learning.initialize()` → `getAgentDBService()` →
`getInstance()` (auto-`initialize()` → Phase-2). It fires on autopilot CLI / `autopilot_*` MCP tools / `doctor`
(and agentic-flow's own MCP), **not** on `memory_store`/`search`/`health` — which is why the manual test never
saw it. This *strengthens* F5: the false banner is a real live-process defect, not a standalone-only cosmetic.

## Open decision gates (HUMAN calls required before any execution)

1. **[GATING] Is agentic-flow's standalone MCP server wanted as a separate product?** The island *is*
   `agentic-flow mcp`'s ~220-tool `stdio-full` server. ruflo never uses it. If no external/standalone consumer
   wants it → delete it. If it's a shipped product → **slim** it to the 11 AgentDBService-free tool modules
   instead of deleting `stdio-full`. This call decides delete-vs-slim.
2. **Does anything external consume `mcp__agentic-flow__*` tools?** The codemod rewrites
   `mcp__agentic-flow__agentdb_* → mcp__agentdb__*`, implying a historical external surface — confirm no live
   `.mcp.json`/skill/downstream registers it before deleting.
3. **Re-anchor ADR-0192/0193/0195/0196's "episode store" language** from `AgentDBService` to the duck-typed /
   SQLite sink? (Per `feedback-no-consumer-is-not-stub`: this is a deliberate *retire-a-real-capability* call —
   justified by "no live consumer + superseded by the ruflo/SQLite sink + upstream-aligned," NOT "it's dead.")
4. **Formalize as a successor ADR?** ADR-0287 §F5 explicitly anticipates "the larger ADR" this is. Recommended:
   a new ADR (supersedes/extends F5) recording the retirement decision + the sequenced Scope-A plan, ratified
   before any deletion.

## Recommended next step

Produce a **successor ADR** for the Scope-A retirement (gated on the decisions above, esp. #1), sequenced
**after** F10 seam (a). No deletion until that ADR is ratified and an explicit go-ahead is given.
