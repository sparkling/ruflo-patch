---
status: accepted
date: 2026-05-25
tags: [upstream-sync, rvagent-wasm, graph-intelligence, council-disposition, ADR-129, ADR-130]
supersedes: []
depends-on: [ADR-0177, ADR-0181, ADR-0202, ADR-0227, ADR-0246, ADR-0253]
implements: []
---

# Upstream ADR-129 + ADR-130 integration disposition (council 2026-05-25)

## Context and Problem Statement

Upstream `ruvnet/ruflo` shipped two design ADRs in mid-2026 that the fork has not yet dispositioned:

* **ADR-129 — rvagent full integration** (upstream commit `47a7825b0`, v3.8.0 `bf0f505c9`). Wires `@ruvector/rvagent-wasm`'s `JsModelProvider` / `set_model_provider` / `addMcpTools` / gallery CRUD / agent introspection into the v3 MCP surface across 4 phases, replacing the echo-stub bypass with a real provider callback and adding 16 new MCP tools.
* **ADR-130 — graph intelligence integration** (upstream commit `542481053`, impl `edde98f9e`). Introduces a `graph_edges` table inside `MEMORY_SCHEMA_V3` plus a thin `graph-edge-writer.ts` module with module-level sql.js cache and fire-and-forget writes. Six phases: schema, query tool, hook side-effects, plugin adapter, pathfinder, benchmark.

The fork has its own architectural posture that diverges materially from upstream on both surfaces:

* For ADR-129: fork is on the **pre-129 baseline** for `agent-wasm.ts` and `wasm-agent-tools.ts` (echo-stub bypass present verbatim), but has a substantial **fork-only persistence layer** that upstream's PR is not aware of; fork's `@ruvector/rvagent-wasm` pin is **0.2.1-patch.145** (newer than upstream's `^0.1.0`) and already exposes every method ADR-129 requires.
* For ADR-130: fork has **no `MEMORY_SCHEMA_V3`** (the combined memory schema upstream depends on was never adopted), already has a different graph table (`causal_edges` with INTEGER ids, agentdb-internal, routed through the archivist), uses **mpnet-768** embeddings (vs upstream's MiniLM-384), and is gated by structural rules (ADR-0202 lint, ADR-0246 mutation-invariants, ADR-0253 FS-JSON staging carve-out) that the upstream writer would violate.

Two background research findings document the surface in detail:

* `docs/research/2026-05-25-adr129-rvagent-upstream-trace.md` (R-A): verdict `partial-pick`.
* `docs/research/2026-05-25-adr130-graph-archivist-trace.md` (R-B): verdict `DEFER whole pick`.

This ADR records the queen's disposition for both. Per `[[feedback-corpus-evidence-before-feature-work]]`, every disposition quotes the research finding rather than reasoning de novo.

## Decision Drivers

* **Honor existing structural rules.** ADR-0202's lint (`scripts/lint-no-daemon-lock-cache.mjs`), ADR-0246's mutation-invariants, ADR-0253's FS-JSON staging carve-out, and ADR-0177's RVF-primary axis are load-bearing — picking upstream code that violates them re-opens decisions the council already closed.
* **Take the cheap wins.** Where an upstream phase lands cleanly on top of the fork without violating structural rules, pick it. R-A explicitly identifies Phase 4 (plugin bridge) as such a case.
* **Don't re-implement what upstream got architecturally wrong.** Verbatim adopting `graph-edge-writer.ts` would re-introduce the exact module-scope handle cache + fire-and-forget write pattern that ADR-0181/0202/0246/0253 were authored to forbid. If we want graph intelligence, design it against the archivist seam — not by inheriting the upstream shape.
* **Preserve fork divergence where it's earned.** Fork's mpnet-768 + `causal_edges` + persistence-layer-wrapped WASM tools are not accidental — they reflect prior ADRs (ADR-0177, ADR-0227, ADR-0246, ADR-0166). Upstream picks that ignore those choices should be reshaped, not absorbed.

## Considered Options

* **Option A — Pick both verbatim.** Apply ADR-129 + ADR-130 as upstream shipped them. Rejected for both: R-A names two blockers (OpenRouter routing missing, persistence threading needed); R-B names four blocking ADR conflicts (ADR-0202/0246/0253/0177).
* **Option B — Partial-pick ADR-129, defer ADR-130 (this ADR).** Land ADR-129 Phase 4 (plugin bridge) as a low-risk pilot now; gate ADR-129 Phases 1-3 on the four named design questions; defer ADR-130 wholesale with a re-implementation criteria checklist if we revisit.
* **Option C — Defer both.** Hold until upstream consolidates or until the fork-side prerequisites land. Rejected because Phase 4 of ADR-129 has no prerequisites and shipping it is strictly value-positive.
* **Option D — Pick ADR-129 verbatim, re-implement ADR-130.** Skip ADR-129's three blockers by ignoring the persistence layer (the fork-only divergence). Rejected because it silently breaks cross-process agent state (the persistence layer exists for a reason: each MCP tool call is a separate CLI process per `wasm-agent-tools.ts:1-231`).

## Decision Outcome

Chosen: **Option B — Partial-pick ADR-129 (Phase 4 first); defer ADR-130 with re-implementation criteria if revisited.**

### Per-ADR disposition

| ADR | Disposition | Rationale |
|---|---|---|
| **ADR-129** | **`pick-partial`** — Phase 4 first (low-risk pilot); Phases 1-3 gated on 4 design questions | R-A: *"Phase 4 (plugin bridge) is unblocked low-risk pilot; Phases 1-3 need OpenRouter/persistence design."* The runtime methods already exist via `@ruvector/rvagent-wasm@0.2.1-patch.145` (R-A: *"runtime exposes all the methods ADR-129 requires"*). The blockers are real but bounded. |
| **ADR-130** | **`defer`** with `re-implement-when-revisited` | R-B: *"DEFER the whole pick. Partial-pick is possible but expensive: it requires a fork-only ADR (agentdb_graph_edge handler routed through the archivist, with mpnet-768 PQ encoder at 784B/edge, with witness_id re-mapped to archivist audit-chain ids, with causal_edges retire/coexist disposition resolved). The shipped upstream surface conflicts with ADR-0202, ADR-0246, ADR-0253, ADR-0177 in ways that can't be reconciled by codemod."* Four blocking ADR conflicts + schema impedance + embedding model lock make verbatim adoption a non-starter. |

Per `[[feedback-no-fallbacks]]`: this is a documented divergence with named conditions, not a silent skip.

## Plan — ADR-129 `pick-partial`

### Phase 4 (plugin bridge) — pick now

R-A surface map: *"Phase 4 (plugin manifest reader) lands as-is."* Specifically:

**Files to change in `forks/ruflo`:**

* `v3/@claude-flow/cli/src/mcp-tools/wasm-agent-tools.ts` — add `PluginRvagentConfig` + `PluginManifest` types + `loadPluginManifest()` + `extractPluginSkills()` helpers (R-A surface map: *"Insert ... `loadPluginManifest`, `extractPluginSkills` helpers (P2/P4 — ~80 lines, see upstream lines 27-99)"*). The P4 helpers stand alone — they don't require the P2 destructive-tool-pattern guards from the same code block.
* `scripts/smoke-wasm-plugin-bridge.mjs` — verbatim cherry-pick the upstream smoke (R-A: *"fixture plugin with rvagent.exposeSkillsAsTools, asserts skill appears in RVF manifest"*).
* `.github/workflows/v3-ci.yml` — add one CI job for the plugin-bridge smoke.

**Why this lands cleanly:**

* No persistence-layer threading required — `loadPluginManifest` is pure reader; no agent state changes.
* No OpenRouter dependency — pure-string manifest extraction, no LLM dispatch.
* No safe-list audit needed — Phase 4 doesn't introduce new MCP-tool-exposure beyond what `addMcpTools` already does internally.
* Plugin layout matches: R-A §"Open questions" #4: *"Upstream's `loadPluginManifest` searches `plugins/<name>/.claude-plugin/plugin.json`, `plugins/ruflo-<name>/...`, `v3/plugins/<name>/...`. Fork has /Users/henrik/source/forks/ruflo/plugins/ and /Users/henrik/source/forks/ruflo/v3/plugins/; matches."*

**Trigger:** This session or next session under a dedicated ADR; no further gating.

### Phases 1-3 — gated on four design questions

Land only after each question has a recorded answer. Per R-A §"Open questions":

| # | Design question | Affected file | Disposition needed |
|---|---|---|---|
| 1 | **OpenRouter routing decision** | `agent-execute-core.ts:94-130` | Pick (a) backport upstream `#2042` OpenRouter dispatch as prerequisite ADR; (b) land ADR-129 P1 with two-provider subset (Anthropic+Ollama) and document; or (c) defer ADR-129 P1 entirely. R-A: *"Affects 1 file; upstream's openrouter code is at 9c1a71f00-ish commits."* |
| 2 | **Persistence-layer threading** | `wasm-agent-tools.ts:1-231` + 16 new tool handlers | Each agent-mutating tool (`wasm_agent_reset`, 6 introspection, gallery `addCustom`/`removeCustom`/`importCustom`/`configure`) must wrap with `ensureLive` + `withStoreLock` + `snapshotAgent`. R-A: *"Does `wasm_agent_compose` need to persist composed RVFs to store.json, or are they ephemeral (returned to caller as base64 and forgotten)?"* Pick ephemeral or persistent before P2 lands. |
| 3 | **`SAFE_MCP_TOOLS` allowlist audit** | `wasm-agent-tools.ts:46-58` (post-129) | R-A: *"Upstream's safe-list at wasm-agent-tools.ts:46-58 post-129 names 30 tools ... Fork divergence: some names may differ (e.g. fork may have `memory_search_unified`, `memory_bridge_status`, etc. that upstream doesn't). Consider auditing fork's `mcp__ruflo__*` exports against the upstream allowlist before merge."* Map upstream's 30 names to fork's MCP registry; resolve any orphans before P3 lands. |
| 4 | **`loadRvf` type signature fix** | `optional-modules.d.ts:295` | R-A: *"Fix the stale `loadRvf(data: Uint8Array): boolean` to `loadRvf(id: string): Uint8Array` to match the actual package types in rvagent_wasm.d.ts:187. The shim was always wrong — landing P3 forces the issue."* Trivial fix; lands as a pre-req commit, not blocking by itself but must precede P3. |

### What is explicitly NOT in scope

* **OpenRouter back-port:** not chosen in this ADR. The decision-options live in question #1 above.
* **Persistence-schema migration:** if persistence threading lands, the `PersistedAgent` interface may need new fields; that schema change is its own ADR (R-A: *"the `PersistedAgent` interface needs an `rvf?: string` or `composed?: boolean` field, which is a forward-compatible schema change"*).
* **Bench harness (`scripts/bench-rvagent.mjs`) and baseline JSON:** optional per R-A; not picked in this disposition.

## Plan — ADR-130 `defer`

### Trigger condition to unblock

ADR-130 returns to council under any one of:

1. **Explicit user/queen mandate** to design fork-native graph intelligence (e.g., a new ADR explicitly requesting it).
2. **A real fork-side need** for graph-shaped retrieval that `causal_edges` cannot serve — e.g., trajectory-caused / reinforced-by edges between `memory_entries` rows that the current causal-graph (controller-id space) cannot represent.
3. **Upstream convergence** — if upstream itself revises ADR-130 to route through an archivist seam, mpnet, or removes the module-scope `_db` cache, re-evaluate against the new shape.

### Re-implementation criteria (if/when we revisit)

Per R-B's analysis, any fork-side graph-edges work MUST satisfy:

1. **Archivist routing.** Writes go through `routeMemoryOp({type:'graph-edge'})` or an equivalent `agentdb_graph_edge` archivist handler, not a module-scope `_db` cache. R-B: *"Picking ADR-130 means either (a) wiring a new `agentdb_graph_edge` archivist handler (fork-only divergence), (b) accepting silent graph writes (violates `feedback-no-fallbacks` / `feedback-best-effort-must-rethrow-fatals` / ADR-0181 audit-vs-storage rationale), or (c) deferring the whole pick."* Re-implementation picks (a).
2. **Substrate routing.** Writes route through `forks/agentdb/src/archivist/staging-substrate.ts` per ADR-0246 F-03-002 — staged invariants for RVF/SQLite, in-lock commit for FS-JSON (ADR-0253 C3). No direct `fs.writeFileSync` or `new SQL.Database(fileBuffer)` outside the substrate seam.
3. **ADR-0202 lint compliance.** No module-scope substrate handle cache; `scripts/lint-no-daemon-lock-cache.mjs` must pass. R-B: *"Module-scope `_db` cache in graph-edge-writer.ts:28-29 violates ADR-0202 scripts/lint-no-daemon-lock-cache.mjs."*
4. **mpnet-768 embeddings.** PQ encoder budget 784B/edge (4+4+4+4+768), not the upstream 400B/edge MiniLM-384 budget. R-B: *"A 768-dim encode would produce 4+4+4+4+768 = 784 bytes (vs the 400-byte ADR-130 budget assumption for 384-dim)."* ADR-0227's adaptive-floor 0.3→0.15 was tuned for mpnet; re-tuning for any other model is its own ADR.
5. **`causal_edges` disposition.** Pick one of: (a) retire `causal_edges` (breaks ADR-0181 Item 3 / ADR-0147 R7 — high cost), (b) coexist as two graph tables with a documented split (requires a new ADR justifying the 5-layer fragmentation ADR-130 was attacking), (c) consolidate `graph_edges` into the `causal_edges` shape (loses temporal-decay + witness_id semantics, requires translation layer). R-B §"Open questions" #2.
6. **No fire-and-forget writes.** Per `[[feedback-best-effort-must-rethrow-fatals]]`: data-integrity errors are fatal, not swallowed. The upstream `} catch { return false; }` pattern at `graph-edge-writer.ts:158-160` is forbidden in re-implementation.
7. **Witness chain mapping.** If the temporal/decay semantics are picked (`confidence` × `exp(-decay_rate × days_since_last_reinforced)` × `weight`), `witness_id` must map to the archivist's audit-chain entry id, not upstream's `verification/witness-fixes.json` (which the fork doesn't have). R-B §"Open questions" #6.

The re-implementation MUST land its own ADR (not amend this one).

## Archivist impact

Per `[[ADR-0253]]` and R-B's archivist-conflict analysis:

* **ADR-129 does NOT touch archivist substrate.** R-A surface map and conflict analysis confirm: the rvagent integration sits inside `wasm-agent-tools.ts` and `agent-wasm.ts`, none of which touch the archivist seam. Phase 4 reads plugin manifests from disk via `fs.readFileSync` — outside the substrate model, but reading bundled config files at process start is not a substrate operation. **No ADR-0253 amendment required for ADR-129 Phase 4 land.**
* **ADR-129 Phases 1-3 — persistence-layer interactions.** The fork-only persistence layer (`wasm-agent-tools.ts:26-231`) uses `<projectRoot>/.claude-flow/wasm-agents/store.json` with `withStoreLock` advisory-locking. This is **not** an archivist-routed substrate; it's parallel to the archivist's substrate map and predates the archivist seam restoration (ADR-0181). Open question for the council: does picking Phases 1-3 (which thread the 16 new tools through this layer) regress the substrate map by entrenching the non-archivist-routed `store.json` path, or is `wasm-agents/store.json` already a permanent carve-out (analogous to ADR-0253 C1 daemon Archivist FS-JSON)? **Surface this as an open question, not a blocker;** it does not block Phase 4 land. If Phases 1-3 are picked, a `wasm-agents/store.json` carve-out ADR may be needed.
* **ADR-130 conflicts with ADR-0253.** R-B: *"ADR-0253 C2 (two RVF-lock-holding workers) — graph-edge-writer adds a third module-scope lock-holding code path. ADR-0202's lint is module-scope-cache-banned; importing graph-edge-writer.ts as-is would either (a) fail the lint, or (b) require an exemption that re-opens ADR-0253's framing."* If ADR-130 is ever picked verbatim, ADR-0253 needs a C4 amendment to either accept the new module-scope cache (rejected by lint) or carve `graph-edge-writer` out (re-opens the framing). **The defer disposition in this ADR avoids both paths.**

## Risk register

Per `[[feedback-no-fallbacks]]`: only risks the research surfaced are listed; no speculative additions.

### ADR-129 Phase 4 (pilot)

| Risk | Source | Mitigation |
|---|---|---|
| Plugin manifest path layout drift between upstream and fork | R-A §"Open questions" #4 | R-A confirmed match for current fork layout (`plugins/`, `v3/plugins/`); spot-check on next existing plugin manifest before merge. |
| Unknown plugin name handling produces warning vs error | ADR-129 §Phase 4 design — upstream chose warning | Pick upstream's warning behavior verbatim; no fork divergence introduced. |

### ADR-129 Phases 1-3 (gated)

| Risk | Source | Mitigation |
|---|---|---|
| OpenRouter routing missing in fork | R-A §"Gap analysis" + §"Conflict surfaces" | Decision gate — option (a)/(b)/(c) recorded above; not landed in this ADR. |
| Persistence-layer + `wasm_agent_compose` interaction | R-A §"Open questions" #2 | Decision gate — ephemeral-vs-persistent decision must precede P2 land. |
| `SAFE_MCP_TOOLS` allowlist mismatch | R-A §"Open questions" #3 | Decision gate — audit fork's `mcp__ruflo__*` exports before P3 land. |
| `loadRvf` type signature wrong in fork's optional-modules.d.ts | R-A §"Conflict surfaces" + §"Open questions" | Trivial fix, lands as pre-req commit. |

### ADR-130 (deferred)

| Risk | Source | Mitigation |
|---|---|---|
| Embedding model lock makes verbatim adoption incompatible | R-B §"Embedding encoding compatibility" — *"PQ-quantized cosine MiniLM-384 vs mpnet-768 is mathematically meaningless"* | Re-implementation criteria #4 (mpnet-768 mandate) addresses this if we revisit. |
| Module-scope `_db` cache violates ADR-0202 lint | R-B §"Archivist write-path conflict" | Re-implementation criteria #3 (no module-scope cache) addresses this if we revisit. |
| Fire-and-forget writes violate `feedback-no-fallbacks` | R-B §"Archivist write-path conflict" — *"graph-edge-writer.ts:158-160 fire-and-forget pattern"* | Re-implementation criteria #6 (no fire-and-forget) addresses this if we revisit. |
| Schema impedance: no `MEMORY_SCHEMA_V3` in fork | R-B §"Schema compatibility" — *"The fork has no `MEMORY_SCHEMA_V3` to extend"* | Re-implementation criteria #5 (causal_edges disposition) acknowledges; if revisited, the fork-native graph schema lives in `forks/agentdb/src/schemas/` not `forks/ruflo/v3/@claude-flow/cli/src/memory/`. |

## Open questions

The devil's advocate will use these. All sourced from the research findings.

### From R-A (ADR-129)

1. **OpenRouter dependency** — backport first or ship two-provider subset? R-A §"Open questions" #1.
2. **Persistence-layer threading** — does `wasm_agent_compose` need to persist composed RVFs, or are they ephemeral? R-A §"Open questions" #2.
3. **`SAFE_MCP_TOOLS` allowlist correctness for fork's MCP surface** — audit upstream's 30 names against fork's `mcp__ruflo__*` exports. R-A §"Open questions" #3.
4. **Plugin bridge (P4) path-search compatibility** — does fork's plugin layout match upstream's `loadPluginManifest` search order in all relevant cases? R-A §"Open questions" #4. (R-A's spot-check says yes; the devil's advocate may push for an exhaustive audit.)
5. **`@ruvector/rvagent-wasm` version-pin policy** — keep fork's `0.2.1-patch.145` (recommended), pin upstream's `^0.1.0` for smoke parity, or bump upstream? R-A §"Open questions" #5.

### From R-B (ADR-130)

6. **Is the fork still in ADR-0253 shape?** If yes, ADR-130's module-scope `_db` cache is forbidden by ADR-0202 lint and contradicts ADR-0253's implication. R-B §"Open questions" #1.
7. **`graph_edges` vs `causal_edges`** — fork-native graph table disposition. R-B §"Open questions" #2.
8. **Embedding model migration** — accept MiniLM-384 coexistence with mpnet-768, or re-target to mpnet-768? R-B §"Open questions" #3.
9. **Temporal/decay semantics** — pick or skip the "graph that forgets" property? R-B §"Open questions" #4.
10. **Audit-chain story for graph writes** — wire fork-only `agentdb_graph_edge` handler, accept silent writes (rejected by re-implementation criteria #6), or defer? R-B §"Open questions" #5.
11. **Witness chain mapping** — map `witness_id` to fork's archivist audit-chain entry id, or accept NULL everywhere (downgrades the feature)? R-B §"Open questions" #6.

### Cross-cutting (queen-added, surfaced by the disposition)

12. **`wasm-agents/store.json` carve-out** — is this already an implicit ADR-0253-shaped carve-out (fork-only persistence substrate, parallel to the archivist), or does picking ADR-129 Phases 1-3 require a new carve-out ADR documenting it? Surface for the devil's advocate.

## Consequences

### Positive

* **Phase 4 of ADR-129 lands strictly value-positive** — plugin bridge is the smallest, lowest-risk piece, picks up upstream's design verbatim, no fork-side rework. R-A: *"Phase 4 is unblocked low-risk pilot."*
* **ADR-130's structural conflicts are documented** — future audits read this ADR and ADR-0253 together to understand why the fork doesn't have a `graph_edges` table. Re-litigation cost drops.
* **The four ADR-129 design questions are now shaped follow-up work** — each has a named decision, a named file, and a named gate. Not vague "review later" debt.
* **Re-implementation criteria for ADR-130 are explicit** — if a future fork-side graph intelligence ADR is authored, it has a 7-item checklist to satisfy, with each item traceable to a fork ADR (0177, 0181, 0202, 0227, 0246, 0253).

### Negative

* **Phases 1-3 of ADR-129 remain deferred** — the fork's WASM runtime keeps its echo-stub bypass for keyless environments; multi-turn agent loops continue to single-shot through `callAnthropicMessages`. This is a real feature gap relative to upstream, accepted in exchange for not landing four under-specified design decisions in one commit.
* **ADR-130's "graph that forgets" property is unreachable from the fork** until/unless a re-implementation ADR lands. This is intentional — the property's runtime shape conflicts with the fork's archivist seam — but it is a known capability gap.
* **Per-family disposition coarseness** — this ADR's decision applies to "ADR-129 Phases 1-3 as a group" rather than per-phase. If future evidence makes one of the three phases land-able without the others, that requires a follow-up ADR.

### Neutral

* **No code change in this ADR.** This is a documentation-and-disposition ADR; Phase 4 of ADR-129 lands in a separate commit under its own implementation ADR or a Batch-shaped roll-up.
* **No INTEGRATION-LEDGER entry yet.** When Phase 4 of ADR-129 actually lands, the ledger row is added then. Per `[[feedback-update-integration-ledger]]`, the ledger tracks code-landing events, not disposition decisions.
* **No upstream divergence introduced today.** Both upstream ADRs are dispositioned but neither is picked in code by this ADR.

## Confirmation

1. The two research findings (`docs/research/2026-05-25-adr129-rvagent-upstream-trace.md` and `docs/research/2026-05-25-adr130-graph-archivist-trace.md`) remain in-corpus as the disposition's evidence base. Future maintainers reviewing this ADR can audit the underlying claims directly.
2. If ADR-129 Phase 4 lands in a follow-up commit, its commit message references this ADR as the disposition source: e.g., `feat(ADR-0254 Phase-4): rvagent plugin-bridge from upstream ADR-129`.
3. If any of ADR-129's four design-question gates resolve in a follow-up ADR (OpenRouter, persistence-threading, safe-list audit, `loadRvf` typo fix), that ADR cites this one as the parent.
4. If ADR-130 is ever revisited, the re-implementation ADR cites this one as the parent disposition and walks the 7-item re-implementation-criteria checklist.
5. If a future audit re-flags either upstream ADR as un-dispositioned, the auditor cites this ADR as the pre-existing disposition.

## More Information

* `docs/research/2026-05-25-adr129-rvagent-upstream-trace.md` — R-A finding (ADR-129 surface map + verdict).
* `docs/research/2026-05-25-adr130-graph-archivist-trace.md` — R-B finding (ADR-130 archivist-conflict analysis + verdict).
* Upstream ADR-129 design doc: `git -C /Users/henrik/source/ruvnet/ruflo show 47a7825b0:v3/docs/adr/ADR-129-rvagent-full-integration.md`.
* Upstream ADR-130 design doc: `git -C /Users/henrik/source/ruvnet/ruflo show 542481053:v3/docs/adr/ADR-130-graph-intelligence-integration.md`.
* Upstream ADR-130 impl commit: `git -C /Users/henrik/source/ruvnet/ruflo show edde98f9e --stat`.
* `[[ADR-0177]]` — substrate restoration (RVF primary, SQLite carve-outs). The decision ADR-130's `graph_edges` write target conflicts with.
* `[[ADR-0181]]` — Archivist runtime activation. The seam ADR-130's `graph-edge-writer.ts` bypasses.
* `[[ADR-0202]]` — daemon RVF lock + no module-scope cache lint. The rule ADR-130's `_db`/`_dbPath` violates.
* `[[ADR-0227]]` — adaptive recall floor (0.3 → 0.15 for mpnet-768). The tuning ADR-130's embedding model would invalidate.
* `[[ADR-0246]]` — archivist mutation-invariants F-03-002. The contract ADR-130's fire-and-forget writes violate.
* `[[ADR-0253]]` — FS-JSON staging carve-out + 2 unmigrated workers (C2). The structural disposition ADR-130 would require amendment to.
* Memory `[[reference-embedding-model.md]]` — mpnet-768 canonical choice; informs ADR-130 re-implementation criteria #4.
* Memory `[[project-fork-only-controllers.md]]` — 8 fork-only HNSW controllers; informs ADR-130's "complementary not competing" analysis (R-B §"Performance overlap").
* Memory `[[feedback-no-fallbacks]]` — corpus rule informing the "carve-out not silent fallback" framing for both dispositions.
* Memory `[[feedback-best-effort-must-rethrow-fatals]]` — corpus rule informing ADR-130 re-implementation criteria #6.
* Memory `[[feedback-corpus-evidence-before-feature-work]]` — the rule grounding this ADR in the two research findings rather than first-principles reasoning.

## Amendment 2026-05-25 — Council Devil's-Advocate revisions

Devil's-Advocate critique committed as `11e9ffc` (`docs/audits/2026-05-25-adr0254-devils-advocate.md`). Verdict: `revise-with-specific-changes` — disposition (partial-pick ADR-129 + defer ADR-130) survives unchanged; two factual misreadings in the reasoning corrected here. Both verified against current fork state before applying.

### Revision 1 — OpenRouter gating condition is RESOLVED, not pending

The original ADR-129 gating list named four design questions. **Question #1 (OpenRouter routing) is already resolved.** While R-A authored its finding (before fork commit `1c31b3ecc` landed), the picks-implementer agent ran in parallel and landed `1c31b3ecc fix(mcp): #2042 — agent_execute routes through v3 provider system (Anthropic / OpenRouter / Ollama)` in `forks/ruflo` during the council session. R-A's "OpenRouter routing missing in fork" claim was true at time-of-grep but false at time-of-disposition.

Net effect on disposition: the ADR-129 Phases 1-3 gating list is **3 questions, not 4**:
1. ~~OpenRouter routing — RESOLVED via fork commit `1c31b3ecc`.~~
2. Persistence-layer threading for 16 new MCP tools (`ensureLive`, `snapshotAgent`, `store.json` semantics) — **STILL GATING**.
3. `SAFE_MCP_TOOLS` allowlist audit against fork's MCP registry — **STILL GATING**.
4. `optional-modules.d.ts:295` `loadRvf` signature typo — **STILL GATING** (trivial; can land standalone).

### Revision 2 — ADR-0202 lint scope correctly restated

The original "Negative" / "Re-implementation criteria #3" framing cited ADR-0202's `lint-no-daemon-lock-cache.mjs` as forbidding ADR-130's module-scope `_db` cache in `graph-edge-writer.ts`. **The lint script does not cover that file.** Verified: `scripts/lint-no-daemon-lock-cache.mjs` hard-targets `worker-daemon.ts` only via `TARGET_FILE = 'v3/@claude-flow/cli/src/services/worker-daemon.ts'` (line 34-36) and a single `readFileSync(TARGET_FILE, ...)` (line 58). It cannot fire on `graph-edge-writer.ts`.

Net effect on ADR-130 disposition: the ADR-0202 conflict is **policy-level**, not **automation-enforced**. Re-stated re-implementation criteria #3:

> 3. **No module-scope substrate cache** — ADR-0202 policy applies (no `let _db = null` at module scope, no equivalent path cache). The existing `lint-no-daemon-lock-cache.mjs` does NOT enforce this for non-`worker-daemon.ts` paths; re-implementation either extends the lint to cover the new file(s) or accepts policy-only enforcement.

### Revision 3 — Asymmetric-blocker distinction named

The DA observed that "OpenRouter missing" (ADR-129, treated as gated) and "MEMORY_SCHEMA_V3 missing" (ADR-130, treated as blocking) are both "missing scaffolding" but were dispositioned differently without explicit justification.

The asymmetry is real and load-bearing. OpenRouter is a **wire-up** — one provider dispatch shape extending a function. `MEMORY_SCHEMA_V3` is an **8-table host schema** whose RVF-primary substrate ([[ADR-0177]]) the fork explicitly rejected. Wire-ups are routinely backported; substrate schemas are not. This ADR's disposition rests on that distinction, made explicit here.

### Net disposition (unchanged)

* **ADR-129**: `pick-partial` — Phase 4 (plugin bridge) lands as a low-risk pilot; Phases 1-3 gated on **three** (not four) remaining design questions.
* **ADR-130**: `defer` with `re-implement-when-revisited` — 7-item re-implementation criteria stand, with item #3 reworded per Revision 2.

### Council closed

Research (R-A `3e5cacf`, R-B `6a5ab32`) → Queen (`8006eba`) → Devil's-Advocate (`11e9ffc`) → Amendment (this commit). No further iteration; this ADR is at terminal state pending implementation of Phase 4 or future revisit of ADR-130.
