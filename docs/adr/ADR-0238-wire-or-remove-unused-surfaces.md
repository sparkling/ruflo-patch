---
status: proposed
date: 2026-05-24
tags: [audit-followup, stub-honesty, wire-or-remove, aidefence, claims, telemetry, consensus, ct-e]
supersedes: []
depends-on: [0201, 0210, 0233]
implements: []
---

# Per-surface wire-or-remove triage for unused security/telemetry/consensus APIs (CT-E)

## Context and Problem Statement

[[ADR-0233]] §CT-E ("Surface without enforcement") consolidates eight unused
or under-implemented surfaces across security, telemetry, and consensus where
rich APIs sit on top of code paths that nothing invokes. Per [[ADR-0210]]'s
stub-honesty mandate (implement / restore / delete, not label), each surface
needs its own per-item decision; CT-E names them collectively but their
asymmetric costs and upstream postures call for **separate dispositions**.

Surfaces in scope (from [[ADR-0233]] §CT-E and the four referenced audit
slices):

1. **AIDefence MCP tools** (6 tools, F-04-001) — `aidefence_scan`,
   `aidefence_is_safe`, `aidefence_has_pii`, `aidefence_analyze`,
   `aidefence_stats`, `aidefence_learn`. ZERO non-test callers anywhere in
   `forks/ruflo/v3/@claude-flow/cli/src/`; the "3-gate" defense-in-depth
   contract in `plugins/ruflo-aidefence/docs/adrs/0001-aidefence-contract.md`
   is prose-only. `memory_store`, `agent_spawn`, `callMCPTool` all bypass.
2. **Claims RBAC central-dispatch bypass** (F-04-003) — CLI `claims check/
   grant/list` policy system exists in `cli/src/commands/claims.ts`; central
   MCP dispatch (`mcp-client.ts::callMCPTool`, `archivist.dispatch`) performs
   no claims/permission check; every mutating MCP tool is reachable without
   policy evaluation.
3. **`agentdb_telemetry_metrics` / `_spans` MCP tools** (F-05-003) — bound
   to `TelemetryManager.getInstance()` (`controller-registry.ts:2225-2236`);
   the class has NO `getMetrics` or `getSpans` method, so the tools always
   fall through to a "not available" notice that misrepresents the
   architecture. Permanently dead.
4. **`@claude-flow/swarm/src/consensus/{raft,byzantine,gossip}.ts`** (1,425
   LOC, F-09-001) — full PBFT three-phase / Raft leader-election / gossip
   fanout simulation. Zero CLI imports (`grep -rn "from '@claude-flow/swarm'"
   cli/src/` returns zero). Only in-tree consumer is `unified-coordinator.ts`
   itself plus three README/MIGRATION/ADR mentions.
5. **agentdb-side "Raft" handler** (F-09-004) — no candidate state, no
   election timeout, no `RequestVote`/`AppendEntries`, no log. Implements
   term-bucketed majority voting against a queen-elected leader.
6. **`paxos` mode** (F-09-008) — declared in swarm `ConsensusAlgorithm` type
   (`swarm/src/types.ts:199`) and `CONSENSUS_ALGORITHMS` (`swarm/src/index.ts:326`);
   `ConsensusEngine.initialize()` silently substitutes Raft with comment
   "Fall back to Raft for Paxos (similar guarantees)."
7. **`weighted` mode CLI / MCP enum mismatch** (F-09-007) — user CLI flag
   enum (`hive-mind-tools.ts:73` `ConsensusStrategyName`) has 5 modes; the
   internal `ConsensusStrategy` enum + agentdb dispatcher both support
   `weighted` with full 277-LOC handler (`weighted.ts`); skill doc advertises
   "7 algorithms"; user can only reach `weighted` by bypassing the CLI
   parser.
8. **5 consensus agent types** (F-09-010) — `byzantine-coordinator`,
   `raft-manager`, `gossip-coordinator`, `crdt-synchronizer`, `quorum-manager`
   in `cli/.claude/agents/consensus/*.md`. Markdown prompt templates only;
   no dispatch path connects the agent name to any consensus enforcement.

[[ADR-0210]] explicitly governs CT-E ("implement, restore, or delete — not
label"). The mandate's three operations map directly onto each surface's
options, but `_note`-marking is reserved for handlers whose `description`
is corrected at the same time (per Option B' item 6).

## Pre-flight verification (per [[ADR-0201]] checklist)

Applied per surface ([[feedback-remediation-adr-preflight]]).

### Surface 1 — AIDefence MCP tools

1. **Signal reaches audience?** Yes — `aidefence_*` are real MCP tools the
   LLM can call via `tools/list`; descriptions on `security-tools.ts:135,220,
   306,358,453,508` advertise the surface accurately for opt-in use. The
   defense-in-depth gap is **producer-side** (no mandatory pre-scan), not
   description honesty.
2. **Upstream's choice?** Identical to fork — `grep -rln "aidefence_is_safe\|
   aidefence_has_pii\|aidefence_scan" ruvnet/ruflo/v3/@claude-flow/cli/src/`
   excluding the same four files (security-tools, auto-install, browser-
   session, doctor) returns ONLY `init/claudemd-generator.ts` (CLAUDE.md
   template advisory). Upstream does NOT wire aidefence into
   `memory_store`/`agent_spawn`/`callMCPTool` either. Wiring at the central
   boundary diverges from upstream by design choice, not by regression.
3. **Premise true at runtime?** Yes — `cli/src/mcp-tools/auto-install.ts:145`
   lists four tools for ensure-installed, and `doctor.ts:337-359` checks
   package loadability, but neither invokes a scan on a real payload. The
   "ZERO non-test callers" claim is accurate for the gating use case.
4. **Sibling-ADR overlap?** None — no other proposed ADR addresses aidefence
   wiring. [[ADR-0210]] covers `hooks_notify` `_note`-marking but not security
   defense-in-depth. ADR-0203 (delete dead `@claude-flow/hooks`) is the
   delete-pattern precedent.

### Surface 2 — Claims RBAC central-dispatch bypass

1. **Signal reaches audience?** No — `commands/claims.ts` writes/reads
   policy file; `callMCPTool` never consults it (F-04-003 grep:
   `grep -rn "checkClaim\|hasPermission\|isGranted\|grantedClaims\|
   claimsConfig\|aidefence" cli/src/mcp-tools/` = zero hits). The signal
   exists but is read by nothing.
2. **Upstream's choice?** Same — `grep` against `ruvnet/ruflo/v3/
   @claude-flow/cli/src/mcp-client.ts` and `ruvnet/agentdb/src/archivist/`
   for the same predicates returns zero. Upstream also ships `claims.ts`
   without dispatch wiring. Fork-only wiring would open a permanent merge
   tax (every upstream sync re-flags the divergence) for a security boundary
   upstream chose not to enforce.
3. **Premise true at runtime?** Yes — `mcp-client.ts:161-188` and
   `archivist/index.ts:828-858` both confirmed: tool-name lookup + handler
   invocation only, no per-tool claim requirement, no caller-identity
   plumbing in `MCPCallContext`. F-04-002 (the separate permissive-on-error
   fallback in `commands/claims.ts:268-271`) is a **different** finding
   covered by [[ADR-0220]]'s honesty-pass scope, not this ADR.
4. **Sibling-ADR overlap?** Partial — F-04-002 (permissive-default) is
   covered by [[ADR-0220]]. F-04-004 (caller-supplied identity in issue
   claims) is bound to the federated-claims ADR-101 direction. This ADR
   owns ONLY F-04-003 (central dispatch wiring); the other two are tracked
   separately.

### Surface 3 — `agentdb_telemetry_metrics` / `_spans` MCP tools

1. **Signal reaches audience?** The MCP tools surface a notice
   ("getMetrics not available" / "Counters require explicit startSpan/
   increment calls from controller operations") that misrepresents the
   architecture — implying instrumentation exists and just isn't called.
   No controller calls `telemetryManager.startSpan()` or `recordMetric()`
   anywhere in the audited tree (F-05-003).
2. **Upstream's choice?** Fork-only surface. `grep -rn "agentdb_telemetry_
   metrics\|agentdb_telemetry_spans" ruvnet/ruflo/v3/@claude-flow/cli/src/
   mcp-tools/` returns ZERO. The fork comment "===== ADR-0045 =====" at
   `agentdb-tools.ts:1587` confirms it was introduced as fork-only ADR-0045.
   Upstream `TelemetryManager` exists (`ruvnet/agentdb/src/observability/`)
   but no MCP tools introspect it. Implementing real `getMetrics`/`getSpans`
   on `TelemetryManager` would require adding an in-process span/metric ring
   buffer — OpenTelemetry's `Tracer`/`Meter` don't natively support
   introspection.
3. **Premise true at runtime?** Yes — confirmed at `agentdb-tools.ts:1596-
   1612` (`typeof ctrl.getMetrics === 'function'` always false) and
   `agentdb/src/observability/telemetry.ts:78-344` (class definition has
   `initialize`, `getTracer`, `startSpan`, `recordQueryLatency`,
   `recordCacheHit/Miss`, `recordError`, `recordOperation`, `shutdown`,
   `isEnabled`, `resetStats` — no `getMetrics()`, no `getSpans()`).
4. **Sibling-ADR overlap?** None — telemetry tools are a self-contained
   subset of CT-E. The wider telemetry instrumentation gap (no spans
   anywhere on `memory_store` path, no exporter wired even in production)
   is a separate ADR's concern; this ADR scopes ONLY the two dead MCP tools.

### Surface 4 — Dead `@claude-flow/swarm/src/consensus/{raft,byzantine,gossip}.ts`

1. **Signal reaches audience?** No — the 1,425 LOC is unreachable from any
   user-facing path. `grep -rn "from '@claude-flow/swarm'" cli/src/` = zero;
   README documents `import { UnifiedSwarmCoordinator } from '@claude-flow/
   swarm'` as a public API but no MCP tool / CLI command / init wiring
   reaches it.
2. **Upstream's choice?** Upstream still ships these files AND adds
   `federation-transport.ts` + `transport.ts` siblings (real federation
   transport plumbing not present in the fork). Upstream is **investing**
   in this surface, not abandoning it. Deletion in fork would open the
   merge tax (every upstream sync re-introduces them). But upstream's CLI
   also doesn't import `ConsensusEngine` from `cli/src/` — same dead state
   on the user path; upstream's investment is at the package level for an
   external consumer that does not exist in either tree.
3. **Premise true at runtime?** Yes — `unified-coordinator.ts:303` is the
   only `ConsensusEngine` instantiation; `unified-coordinator.ts` itself
   has no production callsite. Even on the (dead) path, peers are local
   Map entries (F-09-002), so the implementations cannot deliver
   distributed-consensus semantics regardless of wiring.
4. **Sibling-ADR overlap?** Partial — ADR-0203's "delete dead package"
   pattern is the natural shape, but cross-fork merge cost (upstream still
   carries + extends) inverts the calculus. ADR-0210 covers the agent-name
   stub-honesty layer; ADR-0217 quarantined a different dead-federation
   subset (`QUICConnectionPool`/`QUICStreamManager`).

### Surface 5 — agentdb-side "Raft" handler honesty

1. **Signal reaches audience?** Yes — the user reaches this handler via
   `--consensus raft`. The handler's behaviour (term-bucketed majority
   voting against a queen-elected leader) is honest at the implementation
   level (typed errors, deadlock arithmetic, no `_stub`); the NAME
   "Raft" oversells what the surface delivers.
2. **Upstream's choice?** Same handler exists upstream (per F-09-* the
   handlers are fork-stable agentdb code). Upstream skill docs at
   `forks/ruflo/.claude/skills/hive-mind-advanced/SKILL.md:136` use the
   phrasing "Leader-elected single-decision rounds with term ordering"
   which is more honest than `commands/hive-mind.ts:146`'s "Raft,
   Leader-based consensus."
3. **Premise true at runtime?** Yes — confirmed at `agentdb/src/archivist/
   handlers/hive-mind/consensus/raft.ts:52-55` (term sourced from
   `state.queen.term`, no candidate state) and `:154` (resolution is
   `floor(N/2)+1` majority). The handler IS Raft-flavoured (term ordering,
   single-pending-per-term, no double-vote) but NOT Raft (no leader
   election, no log replication, no RPC).
4. **Sibling-ADR overlap?** None — naming honesty for `raft` is unique
   to this surface. F-09-006 (the `byzantine`→`bft` silent normalisation)
   is a related-but-distinct find handled in the same disposition.

### Surface 6 — `paxos` silent substitution

1. **Signal reaches audience?** No — declared in swarm `ConsensusAlgorithm`
   type at `swarm/src/types.ts:199` and CLI-facing `CONSENSUS_ALGORITHMS`
   constant at `swarm/src/index.ts:326`, but the swarm path is dead
   (surface 4 above). The substitution happens at
   `swarm/src/consensus/index.ts:77-85` with comment "Fall back to Raft
   for Paxos (similar guarantees)" — silent fallback per
   [[feedback-no-fallbacks]] if anyone ever reaches it.
2. **Upstream's choice?** Identical — same declaration + same substitution
   upstream.
3. **Premise true at runtime?** Yes — confirmed file paths above.
4. **Sibling-ADR overlap?** Bundled with surface 4 (dead swarm consensus
   tree) — if surface 4 is quarantined/deleted, `paxos` follows the same
   disposition naturally.

### Surface 7 — `weighted` CLI/MCP enum mismatch

1. **Signal reaches audience?** Partially — `weighted` is reachable via
   the MCP tool with `{strategy: 'weighted'}` payload (works); not
   reachable via `hive-mind --consensus weighted` CLI flag (rejected at
   parse). Skill doc advertises 7 algorithms; CLI flag exposes 5.
2. **Upstream's choice?** Same drift (per F-09-007 locations are
   fork-stable; upstream-equivalent files have the same enum split). No
   merge cost to align.
3. **Premise true at runtime?** Yes — confirmed at `hive-mind-tools.ts:73`
   (5-mode CLI enum) vs `:313` (6-mode internal enum), and `consensus/
   weighted.ts` (277-LOC handler exists and works).
4. **Sibling-ADR overlap?** None — pure enum-alignment fix, no
   architectural overlap with other ADRs.

### Surface 8 — Consensus agent-type Markdown files

1. **Signal reaches audience?** Yes via prompt selection — the 5
   Markdown agent files (`byzantine-coordinator.md` etc.) are advertised
   in `init/executor.ts:1748`, `appliance/rvfa-builder.ts:51`, and
   `mcp-tools/guidance-tools.ts:87`. When spawned, Claude reads the
   prompt body (claims "Deploy PBFT three-phase protocol, threshold
   signature schemes, zero-knowledge proofs for vote verification") and
   roleplays. No dispatch path connects the agent name to any of the
   per-strategy consensus handlers from surfaces 4-7.
2. **Upstream's choice?** Same — these are Claude-Code-pattern agent
   Markdown files, not fork inventions. Upstream's posture is identical
   (prompt-only roleplay is the broader Claude Code agent convention).
3. **Premise true at runtime?** Yes — `cli/.claude/agents/consensus/*.md`
   are prompt templates with frontmatter + body; no `.ts` dispatch file
   exists. The pattern matches every other agent type in the catalog.
4. **Sibling-ADR overlap?** [[ADR-0210]] handles `hooks_notify`
   description honesty; the analogous fix for these agents is description
   honesty in the Markdown frontmatter ("advisory roleplay; does not
   enforce real consensus protocols"). No ADR currently covers
   agent-Markdown honesty as a class — this finding may seed one but
   does not block per-surface action here.

## Considered Options

* **Option A — Per-surface explicit triage with concrete remove-vs-wire
  decision per item** (chosen). Honours [[ADR-0210]]'s implement/restore/
  delete-not-label discipline. Each surface gets its own row with its own
  upstream-respecting disposition.
* **Option B — Blanket remove all unused APIs in one sweep.** Symmetric
  but wrong: AIDefence and the swarm consensus tree have legitimate use
  cases (manual scan utility; upstream-investment-tracked); removing
  wholesale forces re-introduction or merge tax. Violates pre-flight
  check 2 (upstream alignment) for surfaces 1, 4, 6.
* **Option C — Wire all of them properly (cost).** AIDefence at central
  dispatch is a feature decision (redact-or-reject policy with PII
  trade-offs); claims RBAC plumbing requires `caller_identity` in
  `MCPCallContext` (an architectural change); the dead swarm consensus
  tree's "wiring" is a rewrite (single-process simulation cannot deliver
  distributed semantics regardless); `getMetrics`/`getSpans` requires
  building ring buffers OpenTelemetry doesn't natively provide. Out of
  scope for one ADR; deferred to product-bet ADRs where evidence
  warrants.
* **Option D — Document each as "advisory" via [[ADR-0210]] envelope.**
  Rejected per [[ADR-0210]]'s own decision — `_stub:true`/`_note` is
  reserved for handler residue with corrected descriptions; it does NOT
  apply to (a) missing producer-side wiring (surfaces 1, 2 — there is
  no handler envelope to mark, the gap is that nothing CALLS the
  handler), (b) dead-code subtrees (surface 4 — the file as a whole
  shouldn't ship a marker), or (c) name-vs-semantics mismatches
  (surfaces 5, 8 — description fix, not envelope fix).

## Decision Outcome

**Chosen: Option A — per-surface triage.** Decision table below.

| # | Surface | Disposition | Action | Rationale |
|---|---------|-------------|--------|-----------|
| 1 | AIDefence MCP tools (6) | **Honesty-correction + keep** | (a) Rewrite `@claude-flow/aidefence/src/index.ts:1-30` docblock + `plugins/ruflo-aidefence/README` to "manual scan utility" framing per F-04-005. (b) Rewrite `plugins/ruflo-aidefence/docs/adrs/0001-aidefence-contract.md` 3-gate ADR to describe the gates as caller-opt-in, not enforced. (c) Remove the misleading `aidefence_verdict` description + comment from `browser-session-tools.ts:306,308,323-329` (F-04-008). (d) Defer "wire at central dispatch" to a future product-bet ADR (would require redact-or-reject policy + PII consent model). | Upstream does NOT wire either; fork-only wiring is a permanent merge tax for a security boundary upstream chose not to enforce. The harm today is framing (operator over-trust per F-04-005), not API absence. |
| 2 | Claims RBAC central-dispatch | **Remove the API surface** | Delete `cli/src/commands/claims.ts`'s policy-evaluation surface (or label the CLI command as advisory-only with a banner: "this command writes policy that NOTHING currently enforces"). Document in CLI help that `claims check/grant/list` is policy-management for future enforcement, not a runtime gate. F-04-002's permissive-default fallback removal is owned by [[ADR-0220]] honesty-pass scope and lands there. | Half-implemented authorization is worse than none (it ships with the appearance of a security boundary). Upstream-aligned; building real plumbing requires `caller_identity` in `MCPCallContext` — a multi-ADR architectural change with no driver. |
| 3 | `agentdb_telemetry_metrics` / `_spans` | **Delete the tools** | Delete the two MCP tool registrations at `cli/src/mcp-tools/agentdb-tools.ts:1587-1641`. Update `agents/observability-engineer.md` + `observe-metrics`/`observe-trace` skills to point at the working stat tools (`agentdb_resource_usage`, `agentdb_circuit_status`, `agentdb_rate_limit_status`, `agentdb_query_stats` — F-05-009) with the caveat that "metric history" requires explicit polling-into-memory. Mark the supersession of ADR-0045 in the deletion commit. | Fork-only invention; permanently dead (no `getMetrics`/`getSpans` on the bound class, no plan to add them, the API design doesn't match what `Tracer`/`Meter` can introspect anyway). Deletion + redirect to working tools is honest; implementing real ring buffers is a separate product-bet ADR with no driver today. |
| 4 | Dead `swarm/src/consensus/*.ts` | **Quarantine, do not delete** | Add a file-header `// QUARANTINED: not reachable from any user-facing path; reach via dispatch through agentdb/archivist/handlers/hive-mind/consensus/* instead. Retained to track upstream's investment` to `raft.ts`, `byzantine.ts`, `gossip.ts`, and `consensus/index.ts`. Add an arch-test forbidding new in-tree imports (existing `unified-coordinator.ts:303` carved out). Update `swarm/README.md` to mark the `ConsensusEngine` example as "experimental; live consensus path is `hive-mind --consensus <mode>`". DO NOT delete the files. | Upstream still ships these files AND adds `federation-transport.ts` + `transport.ts` siblings (investment, not abandonment). Deletion opens permanent merge tax. Even on the dead path, F-09-002 confirms the implementations cannot deliver distributed-consensus semantics without a multi-process substrate. Quarantine + arch-test (per ADR-0217's pattern) signals the dead state without diverging. |
| 5 | agentdb "Raft" handler naming | **Description honesty** | Rewrite `cli/src/commands/hive-mind.ts:146` help text from "Raft, Leader-based consensus" to "Raft-flavoured: term-bucketed majority voting against a queen-elected leader (no leader election, no log replication, no RPC)". Same rewrite to `mcp-tools/hive-mind-tools.ts` `hive-mind_init` `consensus` enum description. Skill doc at `forks/ruflo/.claude/skills/hive-mind-advanced/SKILL.md:136` already uses honest phrasing — leave it. | The implementation IS honest at the handler level (typed errors, correct arithmetic). The name overpromises; correcting the user-facing description aligns surface with implementation without forcing a rewrite of working code. |
| 6 | `paxos` mode | **Bundled with surface 4** | When surface 4's quarantine lands, remove `'paxos'` from `swarm/src/types.ts:199` `ConsensusAlgorithm` and `swarm/src/index.ts:326` `CONSENSUS_ALGORITHMS`. Delete the `case 'paxos':` fall-through at `consensus/index.ts:77-85`. (Quarantined files keep the silent-substitution bug invisible behind the arch-test, but removing the lie from the type/constant aligns with [[feedback-no-fallbacks]].) | Silent fallback per [[feedback-no-fallbacks]]; harmless today because the path is dead, but the type system advertises Paxos support. Cost is trivial: delete one enum member + one switch case. |
| 7 | `weighted` mode CLI/MCP alignment | **Align enums (add to CLI)** | Add `'weighted'` to `cli/src/mcp-tools/hive-mind-tools.ts:73` `ConsensusStrategyName` enum and to the `hive-mind --consensus` CLI flag enum at `commands/hive-mind.ts`. Update help text + skill doc count from 5 to 6 modes (or 7 if `crdt` is counted separately). The 277-LOC `weighted.ts` handler already works; this is enum-only. | The capability is implemented and tested; only the user-facing parser blocks it. Cheapest reachable fix; surfaces a working feature ADR-0119 already shipped. |
| 8 | 5 consensus agent-type Markdown | **Frontmatter honesty + advisory note** | Add to each of `cli/.claude/agents/consensus/{byzantine-coordinator,raft-manager,gossip-coordinator,crdt-synchronizer,quorum-manager}.md` frontmatter: `advisory: true` AND a leading body paragraph "**Advisory roleplay only.** This agent's prompt describes distributed-consensus mechanisms (PBFT, Raft, gossip, CRDT, quorum) but spawning it does NOT enforce them. Real consensus dispatch goes through `hive-mind --consensus <mode>` → `agentdb/archivist/handlers/hive-mind/consensus/*` (single-process state-merge with per-strategy threshold arithmetic). The byzantine-coordinator name does not connect to PBFT three-phase protocol implementation." Same edit to `consensus-builder.md` + `security-manager.md` (referenced in F-09-010). | Consistent with [[ADR-0210]] description-honesty principle applied to the agent-prompt layer. Avoids deletion (the prompts have value as cognitive scaffolds for the LLM) while preventing operator over-trust. |

### Cross-cutting consequences

* **Good**, because each surface gets its honesty story straight without
  forcing wire-or-delete asymmetry where it doesn't fit.
* **Good**, because dispositions respect upstream's posture (no fork-only
  wiring for surfaces upstream chose not to wire; no deletion of subtrees
  upstream actively maintains).
* **Good**, because the two surface deletions (telemetry MCP tools,
  optionally claims CLI) are fork-only inventions — zero upstream merge
  cost.
* **Good**, because the `weighted` enum fix surfaces a working feature
  (ADR-0119) currently unreachable from documented paths.
* **Good**, because description-honesty fixes (surfaces 1, 5, 8) close
  the framing gap [[ADR-0210]] identified as the LLM-facing load-bearing
  layer.
* **Bad**, because the quarantine disposition (surface 4) leaves 1,425
  LOC of dead code in the tree to track upstream — file-header tag +
  arch-test is bookkeeping the maintainer pays per upstream sync.
* **Bad**, because the AIDefence "downgrade to manual utility" framing
  loses the marketed defense-in-depth story; package re-positioning may
  not match how operators want to think about security. The alternative
  (real central wiring) is deferred to a future product-bet ADR; this
  ADR closes the framing gap immediately and unblocks future wiring with
  honest documentation as the prerequisite.
* **Neutral**, because surface 2's claims RBAC could equally be "delete
  the command + docs" or "label as advisory" — picking advisory keeps the
  CLI surface for future use without claiming runtime enforcement.
* **Neutral**, because surface 8's advisory frontmatter does not change
  agent behaviour; it changes operator expectations. Per
  [[feedback-no-fallbacks]] the asymmetric cost favours adding the
  honesty label over rewriting the prompt corpus to drop consensus
  language.

### Confirmation (per-surface gates)

* **Surface 1**: `grep -rn "AI Manipulation Defense\|self-learning capabilities\|HNSW-indexed threat pattern search" forks/ruflo/v3/@claude-flow/aidefence/src/index.ts forks/ruflo/plugins/ruflo-aidefence/README` returns zero hits after the rewrite. `aidefence_verdict` references in `browser-session-tools.ts` either describe enforcement that exists OR are removed.
* **Surface 2**: `claude-flow claims check` CLI prints a banner ("ADVISORY: this command writes policy that NOTHING currently enforces. See ADR-0238.") OR the command is deleted entirely. The chosen sub-option is recorded in the implementation commit message.
* **Surface 3**: `grep -rn "agentdb_telemetry_metrics\|agentdb_telemetry_spans" forks/ruflo/v3/@claude-flow/cli/src/` returns ZERO. Skill `observe-metrics` test asserts the tool list it references is non-empty (post-redirect).
* **Surface 4**: An arch-test `forks/ruflo/v3/@claude-flow/swarm/__tests__/no-new-consensus-imports.test.ts` asserts that no NEW `.ts` file imports from `./consensus/` (existing `unified-coordinator.ts:303` allowlisted). File header `// QUARANTINED` present on all four files. README has the "experimental" disclaimer.
* **Surface 5**: `commands/hive-mind.ts:146` help text no longer says "Leader-based consensus" without the "Raft-flavoured" qualifier. MCP tool `hive-mind_init` schema description matches.
* **Surface 6**: `grep -rn "'paxos'" forks/ruflo/v3/@claude-flow/swarm/src/` returns zero hits (or only in deleted commit metadata).
* **Surface 7**: `claude-flow hive-mind --consensus weighted` accepts at parse and dispatches to the agentdb `weighted` handler. Behaviour test in `cli/__tests__/hive-mind-consensus-weighted.test.ts` exercises end-to-end propose+vote+resolve.
* **Surface 8**: All 5 consensus agent Markdown files have `advisory: true` in frontmatter and a leading "Advisory roleplay only" paragraph. Same applied to `consensus-builder.md` + `security-manager.md`.

### Out of scope

* **AIDefence central-dispatch wiring** (the "wire" half of surface 1) —
  deferred to a future product-bet ADR with PII consent model + redact-or-
  reject policy decisions. This ADR closes the framing gap, which is the
  prerequisite for future wiring.
* **Claims RBAC plumbing** (`caller_identity` in `MCPCallContext`) — same
  deferral; a multi-ADR architectural change with no driver today.
* **F-04-002** (permissive-on-error fallback in `commands/claims.ts:268-
  271`) — owned by [[ADR-0220]] honesty-pass scope.
* **F-04-004** (caller-supplied identity in issue-claim handlers) — bound
  to ADR-101 federated-claims direction.
* **F-04-006, F-04-007** (PII coverage gaps; `aidefence_learn` poisoning)
  — separate findings; this ADR scopes ONLY the wire-or-remove decision,
  not detector-quality or auth-surface improvements.
* **Real `getMetrics`/`getSpans` on `TelemetryManager`** — would require
  building ring buffers OpenTelemetry doesn't natively provide; a separate
  product-bet ADR if and when there's a real driver.
* **F-09-005** (`coordination_consensus` vs `coordination_topology` enum
  disjointedness) — separate finding, not in CT-E's eight surfaces.
* **F-09-006** (`byzantine`→`bft` silent normalisation) — naming/aliasing
  honesty bundled with surface 5's broader description rework if
  implementer chooses; otherwise tracked as F-09-006 alone.
* **F-09-009** (gossip/CRDT "convergence" honesty in skill docs) —
  documented in source comments already; doc rewrite is a separate skill-
  doc pass.

## More Information

* **[[ADR-0233]]** §CT-E — parent theme for this triage; lists the eight
  surfaces and references the audit findings.
* **[[ADR-0210]]** — stub-honesty mandate; governs the per-surface
  implement / restore / delete decision pattern. Specifically, Option B′
  item 6 (description honesty as the load-bearing LLM-facing layer) shapes
  surfaces 1, 5, 8.
* **[[ADR-0201]]** — parent audit + pre-flight checklist. Each surface in
  this ADR cleared all four checks (signal-reaches-audience, upstream-
  posture, premise-true-at-runtime, no-sibling-overlap).
* **[[ADR-0220]]** — owns F-04-002 (permissive-default fallback in
  `commands/claims.ts:268-271`); F-04-002 is NOT in this ADR's scope.
* **[[ADR-0203]]** — delete-the-dead-package precedent (for `@claude-flow/
  hooks`); inverted by surface 4's quarantine disposition because upstream
  still maintains the package.
* **[[ADR-0217]]** — quarantine pattern (CRDT primitives + dead QUIC
  classes); precedent for surface 4's file-header tag + arch-test approach.
* **[[ADR-0222]]** — delete-dead-services precedent (`federated-learning.ts`);
  inverted by surface 4 because upstream still ships + extends the consensus
  tree.
* **Audit sources**:
  * `docs/audits/2026-05-24-second-pass-audit/04-security-aidefence-claims-pii.md`
    — F-04-001 (surface 1), F-04-003 (surface 2), F-04-005 (surface 1
    framing), F-04-008 (surface 1 `browser_cookie_use` advertising).
  * `docs/audits/2026-05-24-second-pass-audit/05-telemetry-observability.md`
    — F-05-003 (surface 3); F-05-009 (working stat tools for redirect).
  * `docs/audits/2026-05-24-second-pass-audit/09-consensus-protocols.md` —
    F-09-001 (surface 4 dead code), F-09-002 (single-process simulation),
    F-09-004 (surface 5 "Raft" honesty), F-09-007 (surface 7 weighted),
    F-09-008 (surface 6 paxos), F-09-010 (surface 8 agent-type Markdown).
* **Key file references**:
  * Surface 1: `forks/ruflo/v3/@claude-flow/aidefence/src/index.ts:1-30`;
    `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/browser-session-tools.ts:306,308,323-329`;
    `plugins/ruflo-aidefence/docs/adrs/0001-aidefence-contract.md:36-44`.
  * Surface 2: `forks/ruflo/v3/@claude-flow/cli/src/commands/claims.ts`;
    `forks/ruflo/v3/@claude-flow/cli/src/mcp-client.ts:161-188`;
    `forks/agentdb/src/archivist/index.ts:828-858`.
  * Surface 3: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts:1587-1641`;
    `forks/agentdb/src/observability/telemetry.ts:78-344`;
    `forks/ruflo/v3/@claude-flow/memory/src/controller-registry.ts:2225-2236`.
  * Surface 4: `forks/ruflo/v3/@claude-flow/swarm/src/consensus/{raft,byzantine,gossip}.ts`;
    `forks/ruflo/v3/@claude-flow/swarm/src/consensus/index.ts:77-85,267 LOC`;
    `forks/ruflo/v3/@claude-flow/swarm/src/unified-coordinator.ts:303`.
  * Surface 5: `forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts:146`;
    `forks/agentdb/src/archivist/handlers/hive-mind/consensus/raft.ts:52-55,154`.
  * Surface 6: `forks/ruflo/v3/@claude-flow/swarm/src/types.ts:199`;
    `forks/ruflo/v3/@claude-flow/swarm/src/index.ts:326`;
    `forks/ruflo/v3/@claude-flow/swarm/src/consensus/index.ts:77-85`.
  * Surface 7: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:73,313`;
    `forks/agentdb/src/archivist/handlers/hive-mind/consensus/weighted.ts` (277 LOC);
    `forks/ruflo/.claude/skills/hive-mind-advanced/SKILL.md:130`.
  * Surface 8: `forks/ruflo/v3/@claude-flow/cli/.claude/agents/consensus/*.md`
    (5 files + `consensus-builder.md`, `security-manager.md`);
    `forks/ruflo/v3/@claude-flow/cli/src/init/executor.ts:1748`.
* **Memory references**:
  * [[feedback-no-fallbacks]] — silent substitutions (surface 6) and
    half-implemented authorization (surface 2) as anti-patterns.
  * [[feedback-remediation-adr-preflight]] — 4-check pre-flight applied
    per surface above.
  * [[feedback-corpus-evidence-before-feature-work]] — surfaces 1 + 4
    "build wiring/feature" rejected on upstream-evidence-not-yet pattern.
  * [[feedback-update-integration-ledger]] — surface 3 deletion (fork-only
    surface, no upstream sync needed) and surface 4 quarantine (track
    upstream merge cost) both warrant ledger rows on implementation.
  * [[project-deprecated-controllers]] — pattern precedent for the
    "label-removable, then delete" lifecycle.
