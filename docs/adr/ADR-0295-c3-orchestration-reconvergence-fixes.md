---
status: proposed
completed: false
date: 2026-06-04
tags: [orchestration, agents, wasm, hooks, model-catalogue, re-convergence, fork-regression, c3, fixes]
supersedes: []
depends-on: [ADR-0292, ADR-0291, ADR-0290, ADR-0254, ADR-0143]
implements: []
---

# C3 re-convergence — port the agent_execute model catalogue, rewire the task-completed surface, record the orchestration direction-flips

## Context and Problem Statement

The ADR-0292 C3 review (executed 2026-06-04; evidence in `docs/research/c3-orchestration-agents/01..04`,
raw drives in `/tmp/c3-evidence/`) proved the entire upstream orchestration spine works (swarm/agent/
task lifecycle, real BFT hive-mind consensus, DAA, workflows, goals, core — one third-party
UPSTREAM-BROKEN: `wasm_agent_create`, which the fork already fixes) and classified the fork's deltas.
A devil's-advocate pass re-drove every load-bearing claim: the single C3 fork regression was
**strengthened**, two researcher classifications were corrected, and one delta both researchers
missed was surfaced.

C3 continues the premise-hygiene pattern: **23/23 audited fork ADR premises DEMONSTRATED, zero
assumed-broken** — and adds a new mistake class to the program catalogue: the one regression came
from merging only half of a **paired** upstream fix.

**This ADR is `proposed` — it authorises no code by itself.** Implementation runs under the standing
per-category pipeline (analysis → implement → validate) ratified 2026-06-04; the fixes enter the
serial implementation lane after the ADR-0294 batch clears its DA review.

## Decision Drivers

* `agent_execute` — an advertised orchestration surface — fails 100% of logical-model-name calls in
  the fork while working upstream; the coupled `wasm_agent_prompt` LLM path shares the stale resolver.
* The fork's own `ruflo hooks task-completed` CLI silently no-ops on pattern-training — a
  self-inflicted surface gap from an otherwise-correct mechanism substitution (ADR-0290).
* Two direction-flips (fork fixes upstream-broken wasm create; fork wires upstream's phantom
  `swarm_scale`) deserve recording as justified fork-ahead, per the program's re-justification rule.
* Every fix lands with an acceptance check in `test-acceptance*.sh` + CI
  (`feedback-always-wire-tests-into-cicd`); the R1 check must never make paid LLM calls.

## Considered Options

* **Fix the two regressions + record the keeps and the R3 decision + repair docs** (this ADR). Chosen.
* Bulk re-sync the C3 surface from upstream — rejected: the fork is at parity or justified-ahead
  everywhere else; a bulk sync would unwind demonstrated improvements (re-pin, swarm_scale, G6 fix).
* Record-only — rejected: R1 kills an advertised tool family end-to-end; R2 is a silent no-op on the
  fork's own CLI surface.

## Decision Outcome

Adopt the C3 dispositions table (`docs/research/c3-orchestration-agents/04-dispositions.md`)
verbatim. Work items:

### Fork-regression fixes

* **R1 — port the `agent_execute` model catalogue (highest C3 priority).** The fork ships stale
  `claude-3-5-*` ids in `MODEL_MAP` (`agent-execute-core.ts`, built `:34-37`) → every logical-name
  call returns a provider 400 naming the invalid id (DA re-driven; env-cause refuted). Upstream fixed
  it in `16e59c261` (#1906/#1908) — the INTEGRATION-LEDGER hand-ported only the paired #2042 half.
  Fix: port upstream's CURRENT catalogue values (4.x ids; opus currently `claude-opus-4-8`;
  `DEFAULT_ANTHROPIC_MODEL='claude-sonnet-4-6'`); the shared `resolveAnthropicModel` heals the
  coupled `wasm_agent_prompt` path. Add the missing ledger row for `16e59c261`/#1906.
  *Acceptance (no paid calls):* resolver-level assertions — every logical name resolves to a
  current-allowlist id; no `claude-3-5-` id remains in the built catalogue.
* **R2 — rewire the task-completed surface.** The fork deliberately replaced upstream's
  `hooks_task-completed` mechanism with the trajectory pipeline (ADR-0290 — capability proven durable
  by the DA: cross-session SONA reinforcement 0.55→0.595), but left its own consumers dangling:
  `commands/hooks.ts` still calls the unregistered tool (graceful fallback → **functional no-op for
  pattern-training**) and the hive-mind-advanced SKILL documents it as wired. Fix (preferred):
  register a thin `hooks_task-completed` MCP alias that drives the trajectory pipeline — closing the
  MCP-surface gap and the CLI subcommand in one move; align the SKILL text; add the #2245 ledger row.
  `hooks_teammate-idle`/`agent_logs` stay removed (correct ADR-0210 stub-deletes).
  *Acceptance:* the task-completed surface produces real pattern-training evidence (content, not
  counters).
* **W1 — `wasm_agent_prompt` MCP-path honesty.** Append the documented no-key NOTE
  (`[NOTE: set ANTHROPIC_API_KEY…]`) on the MCP path (the CLI path already appends it;
  DA captured the bare `echo:`). *Acceptance:* no-key MCP prompt returns the NOTE.
* **W2 — wasm envelope shape.** Normalize `content[0].text`-as-object to text-as-JSON-string if
  contained; otherwise record as a known shape. *Acceptance per outcome.*

### Decision item

* **R3 — missing `managed_agent_*` Claude-cloud runtime** (upstream `ruflo-agent` = renamed
  ruflo-wasm + managed-agent skill, commits `ef73a1616`/`3975ab512`; fork kept the `ruflo-wasm` name
  per ADR-0143). **ACCEPT-WITH-RATIONALE (chosen, flagged for veto):** the runtime is a paid
  Anthropic cloud beta; upstream itself falls back to wasm without a key; the fork is
  local/Claude-Code-centric. Either way: add the two missing ledger rows so the non-merge is
  deliberate. Porting remains available later if cloud-managed agents become a fork goal.

### Fork-ahead justifications (recorded; no code change)

* **J1 — wasm re-pin (ADR-0254): KEEP.** Fork's `wasm_agent_create` works (`rvagent-wasm
  0.2.1-patch.228`) while upstream's `0.1.0` is broken (glue-vs-binary skew) — direction-flip;
  premise audited load-bearing-correct; independent of the ruvllm-wasm package (DA-verified).
* **J2 — `swarm_scale` wired: KEEP** (upstream: catalog-listed phantom, `-32601` live). Semantics
  note: mutates `maxAgents` (scaling intent), not live `agentCount` — docs must not imply
  spawn/despawn.
* **J3 — auto-fire outcome derivation (ADR-0290): KEEP** — fixes upstream's hardcoded
  `feedback(true)` G6 fabrication; derives from `tool_response.status`, skips when underivable.
* **J4 — hive-mind superset + advanced skill: KEEP** (one shared runtime + two skills; BFT parity
  verified; SKILL text alignment lands with R2).
* **J5 — orchestration stores plain JSON both sides: PARITY recorded** — the RVF divergence is
  memory-axis only; no orchestration merge-tax.

### Doc repairs (bundle with the batch)

* **X1:** wasm plugin README tool count (10 → 27); swarm contract tool count (4 → 5 incl. scale);
  workflow cancel-label drift; J2's semantics note where scale is documented.

### Consequences

* Good, because the only dead advertised surface in C3 (agent_execute + coupled wasm LLM path) comes
  back with a deterministic, unpaid acceptance gate.
* Good, because the substitution lesson (R2) is now codified: replacing a mechanism requires rewiring
  or aliasing every fork surface that referenced the old one.
* Good, because the paired-fix mistake class (M-C1) gets a standing counter-process: ledger rows that
  hand-port a fix must sweep the upstream PR for paired commits.
* Neutral, because R3 stays un-ported by recorded decision — reversible later.
* Bad, because the `hooks_task-completed` alias re-adds a name the fork once dropped — mitigated by
  it being a thin shim over the fork's own pipeline, not a port of upstream's mechanism.

### Confirmation

Each R/W fix lands with its acceptance check wired into `test-acceptance*.sh` (run_check_bg +
collect_parallel) and a CI path filter; the R1 check is resolver-level (no paid calls); the C3
evidence drives re-run green against the fixed release. This ADR flips to `accepted`/`completed:true`
when R1, R2, W1, W2 + X1 are shipped, the R3 ledger rows exist, and the checks are green in a
release.

## More Information

* Evidence: `docs/research/c3-orchestration-agents/01..04` (upstream proof, fork diff, patch audit,
  dispositions) — ADR-0292 protocol, ADR-0291 validation bar, DA verdicts + errata folded 2026-06-04
  (`/tmp/c3-evidence/da/logs/`).
* Program tracking: ADR-0292 (C3 row links here). Siblings: ADR-0293 (C1), ADR-0294 (C2).
* New mistake class recorded for the program: **M-C1 "un-merged half of a paired upstream fix"** —
  distinct from C1's wrong-shape, C2's necessity-not-re-justified, and C4's doc-drift signatures.

## Amendments

### Implementation record (2026-06-04, queen-led swarm; DA: ZERO BLOCKERS; PUSHED `17ea132aa..4d3afbe95`)

* **Fork commits:** R1 `39666a7ab` (MODEL_MAP = current upstream byte-for-byte: opus→`claude-opus-4-8`
  + `opus-4.7` alias, sonnet→`claude-sonnet-4-6`, haiku→`claude-haiku-4-5-20251001`;
  `executeAgentTask` folded through `resolveAnthropicModel`; zero stale `claude-3-5-` defaults
  fork-wide; OpenRouter map verified at-parity), R2 `bdc12f1c3` (thin `hooks_task-completed` alias
  driving the real start→step→end SONA path; `patternsLearned` derives from `sonaUpdate===true`;
  success derives from args — G6-clean; DA-verified real persisted learning 9/9 incl. 4-way
  concurrency), W1+W2 `9dbd55d1a` (single root cause: rvagent-wasm returns an OBJECT that defeated
  the `typeof==='string'` echo guard — normalize at the boundary; NOTE + text-as-string + the latent
  key-gated LLM routing all revive; outer double-wrap recorded, untouched), X1 `e8b494fbe`,
  (F1/F2 shipped in the same stack — see ADR-0296).
* **Both-ways:** published patch.415 → 6 FAIL; fixed → 9/9 (init'd env). Guards on the combined
  C1+C2+C3 overlay: adr0293 12/12, adr0294 14/14, adr0285 9/9, pipeline 289/289.
* **Recorded conditions (DA):** W1/W2 LOUD-SKIP in the standard acceptance wave (rvagent-wasm is
  RUFLO_RUVECTOR_TESTS-gated per ADR-0104b — heavy-test-opt-out; realistic standard-run result is
  7 pass / 2 skip, green); R2's registry-init LOUD-SKIP is a rare-substrate safety net, not a
  routine exemption (clean `init --full` passes reliably). NIT open: `ClaudeModel` union lacks
  `'opus-4.7'` (typing-only). Wiring: `4bcbceb`; ledger rows (16e59c261 + M-C1 annotation,
  aca2280f1, ef73a1616/3975ab512): `4edbd41`.
* Status stays `proposed`; flips with the release that turns `adr0295-c3-reconvergence` green.
