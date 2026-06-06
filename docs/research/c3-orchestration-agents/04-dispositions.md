# C3 Orchestration & Agents — Dispositions

**Protocol:** ADR-0292 step 6. Per divergence: re-converge / keep-with-justification / unwind. **No
implementation here** — proposals + go-ahead checkpoints only. Synthesized by the queen from
`01-upstream-proof.md` (upstream-prover), `02-fork-diff.md` + `03-patch-audit.md` (fork-auditor), and
the devil's-advocate cross-examination (independent re-drives both envs; two reclassifications + one
new finding; errata folded into 01–03 on 2026-06-04). Re-convergence ADR: **ADR-0295**.

**DA verdict summary:** headline regression UPHELD-strengthened (catalogue-wide, env-cause refuted);
both direction-flips upheld; G6-fix upheld; 23/23 premise audit upheld (4 sampled). Two DA
reclassifications: the missing-tools "substitution" grade split (capability FORK-AHEAD + minor
surface FORK-REGRESSION — the "0 references" premise was false), and the `ruflo-agent` plugin note
corrected into a NEW unclassified delta (`managed_agent_*` cloud runtime absent). One DA-proven
positive: the fork's trajectory substitute genuinely reaches durable cross-session SONA learning
(0.55→0.595, successCount 1→2).

## Disposition table

| # | Divergence | Class | Disposition | Rationale |
|---|---|---|---|---|
| **R1** | **`agent_execute` dead — stale `MODEL_MAP`** (`agent-execute-core.js:34-37` ships `claude-3-5-*` ids; every logical-name call → provider 400 naming the invalid id; catalogue-wide — router-picked haiku 400s too). Upstream fixed in `16e59c261` (#1906/#1908): 4.x ids + `DEFAULT_ANTHROPIC_MODEL='claude-sonnet-4-6'`; `merge-base --is-ancestor` = NOT merged; ledger took only the paired #2042 half | FORK-REGRESSION (top; full bar) | **RE-CONVERGE (fix, highest C3 priority)** | Port the current upstream catalogue (current model ids — opus maps to `claude-opus-4-8` in present upstream; take upstream's CURRENT values, not the fix-commit snapshot) into `MODEL_MAP` + default. This also heals the coupled `wasm_agent_prompt` LLM path (shared `resolveAnthropicModel`; full-id passthrough unaffected). Add the missing INTEGRATION-LEDGER row for `16e59c261`/#1906. *Acceptance (NO paid calls):* drive the resolver (or a tools-layer dry probe) and assert every logical name (sonnet/haiku/opus/default) resolves to an id on a current-models allowlist; assert no `claude-3-5-` id remains in the built catalogue. |
| **R2** | **`hooks_task-completed` surface** (DA split-grade): capability = FORK-AHEAD via `trajectory-*` substitution (DA-proven durable); but the fork SHIPS consumers of the absent tool — `ruflo hooks task-completed` CLI **no-ops on pattern-training** (upstream's identical subcommand returns `patternsLearned:1`) and the hive-mind-advanced SKILL documents it as wired. No ledger row for the #2245 non-merge | minor FORK-REGRESSION (advertised CLI/skill surface) + FORK-AHEAD (capability) | **RE-CONVERGE the surface (small fix)** | Either register a thin `hooks_task-completed` MCP alias that drives the trajectory pipeline (closes the MCP-surface gap AND the CLI subcommand in one move — preferred), or rewire `commands/hooks.ts` to call `trajectory-*` directly. Align the hive-mind-advanced SKILL text. Add the #2245 ledger row. Keep `teammate-idle`/`agent_logs` REMOVED (correct ADR-0210 delete-the-synthetic-stub; both were self-disclosed stubs upstream). *Acceptance:* `ruflo hooks task-completed --train-patterns` (or the alias tool) produces real pattern-training evidence (content, not counters). |
| **R3** | **`managed_agent_*` Claude-cloud runtime absent** (DA new finding): upstream renamed ruflo-wasm → `ruflo-agent` and added the managed-agent skill + `managed_agent_*` MCP tools (`ef73a1616`/`3975ab512`); fork kept the `ruflo-wasm` name (ADR-0143 brand rule — fine) but never classified the missing cloud runtime; ledger row 125 covers only the version-bump half | unclassified → FORK-REGRESSION (managed-agent surface), LOW | **ACCEPT-WITH-RATIONALE (recommended) + ledger row** | Recommended rationale: the managed-agents runtime is a paid Anthropic cloud beta; upstream itself falls back to wasm without a key; the fork is local/Claude-Code-centric. Record the decision + add ledger rows for `ef73a1616`/`3975ab512` so the non-merge is deliberate, not invisible. (Alternative: port the surface — only if cloud-managed agents become a fork goal.) *Acceptance:* ledger rows present; ADR-0295 records the decision. |
| **W1** | `wasm_agent_prompt` (MCP path) returns bare `echo:` **without** the documented no-key NOTE (`[NOTE: set ANTHROPIC_API_KEY…]`) that the CLI path appends (dist `agent-wasm.js:117`) — DA-captured | minor honesty gap | **FIX with the batch** | Append the NOTE on the MCP path too (same honesty posture as O2/D2 precedents). *Acceptance:* MCP `wasm_agent_prompt` with no key returns the NOTE alongside the echo. |
| **W2** | wasm envelope-shape divergence: `content[0].text` returned as an OBJECT rather than a JSON string in some wasm tool responses | cosmetic protocol drift | **FIX-OR-RECORD with the batch** | Normalize to text-as-JSON-string if the change is contained; otherwise record as known shape. |
| **J1** | **`wasm_agent_create` works in fork while UPSTREAM-BROKEN** (`@ruvector/rvagent-wasm@0.1.0` glue-vs-binary skew; fork re-pinned to `0.2.1-patch.228`, ADR-0254; DA: ×3 deterministic, independent of the ruvllm-wasm package) | FORK-AHEAD (direction-flip) | **KEEP (recorded)** | The fork's 27-tool wasm surface is fully alive; upstream's is dead at create. ADR-0254's premise audited LOAD-BEARING-CORRECT. |
| **J2** | **`swarm_scale` wired** (upstream: phantom — catalog lists, registry `-32601`) | FORK-AHEAD (direction-flip) | **KEEP (recorded, with semantics note)** | Handler mutates `maxAgents` (scaling intent), not live `agentCount` — honest in-handler comment; docs should not imply agent spawn/despawn. |
| **J3** | **Auto-fire hook derives outcome** (`hook-handler.mjs:190-219`: success from `tool_response.status`, skips when underivable — vs upstream's hardcoded `feedback(true)` G6 fabrication) | FORK-AHEAD | **KEEP** | ADR-0290 premise audited LOAD-BEARING-CORRECT; fixes an upstream dishonesty. |
| **J4** | **hive-mind superset + `hive-mind-advanced` skill** (one shared runtime, two skills; real BFT quorum + pending-consensus shutdown guard at parity) | FORK-AHEAD | **KEEP** (known; memory `project-hive-mind-one-runtime-two-skills`) | Advanced layer is fork-authored protocol on the upstream runtime; merge-tax not break-risk. SKILL text alignment lands with R2. |
| **J5** | Orchestration stores stay **plain JSON** both sides (swarm/agents/tasks under `.claude-flow/` + `.swarm/swarm-state.json`); read-back holds cold | PARITY | **NO ACTION (recorded)** | The RVF divergence is memory-axis only (C2 J1); no orchestration merge-tax. |
| — | **PARITY (~50)**: swarm/agent/task lifecycle, hive-mind lifecycle/consensus, 27-tool wasm surface, DAA EMA, workflow state machine (pause gated on running — precondition noted), goals substrate, coordination tools, hooks routing | PARITY | **NO ACTION** | DA spot-checked 5+ by re-drive; one over-statement corrected (workflow pause precondition). |
| — | **UPSTREAM-BROKEN shared: 0** (the one upstream-broken item, wasm create, is fixed fork-side) | — | — | |
| **X1** | Doc staleness: wasm plugin README "10 tools" (live: 27); swarm contract "4 swarm tools" (live: 5 with scale); workflow cancel-label drift | doc drift | **FIX DOCS with the batch** | Auditor M-C3 items. |

## Key tensions recorded

1. **A new mistake class for the catalogue — "un-merged half of a paired upstream fix" (M-C1):** the
   ledger hand-ported #2042 (provider routing) but missed its pair #1906 (model catalogue). Both
   halves were needed; the half-merge produced the only C3 regression. Counter-process: when a ledger
   row hand-ports a fix, sweep the upstream PR/issue for paired commits before closing the row.
2. **The substitution lesson (R2):** replacing an upstream mechanism (deliberately, with a better
   one) is only complete when the fork's OWN advertised surfaces that referenced the old mechanism
   are rewired or aliased. The capability moved; the CLI subcommand silently no-opped.
3. **C3's premise hygiene continues the C2 pattern** (23/23 demonstrated, 0 assumed-broken; two
   premises upgraded to load-bearing-correct). Three categories in, the "fixes built on assumed
   brokenness" failure mode has appeared exactly once (C1's F1 citation) — the corpus risk is
   staleness and sync mechanics, not fabricated diagnoses.

## What the C3 re-convergence ADR (ADR-0295) must contain

1. **Fixes (go-ahead per program):** R1 (MODEL_MAP port + ledger row), R2 (alias-or-rewire + SKILL
   align + ledger row), W1 (MCP-path NOTE), W2 (envelope shape, fix-or-record), X1 (doc counts).
   Each fix with its acceptance check wired into `test-acceptance*.sh` (run_check_bg +
   collect_parallel) + CI path filter. R1's check MUST NOT make paid LLM calls.
2. **Decision item:** R3 accept-with-rationale (recommended) vs port — plus the two ledger rows
   either way.
3. **Keep-justifications:** J1–J5 recorded.
4. **Supersedes/refines:** nothing superseded; depends on ADR-0254 (J1), ADR-0290 (J3/R2), ADR-0143
   (plugin-name rationale in R3), ADR-0292/0291 (program/bar).

## Go-ahead checkpoints

- R1, R2, W1, W2 are fork code edits; X1 doc edits bundle with them. Authorized under the standing
  per-category pipeline (analysis → implement → validate) ratified 2026-06-04; implementation enters
  the serial implementation lane AFTER the ADR-0294 batch completes its DA review.
- R3 is a recorded DECISION (accept-with-rationale recommended) — flagged to the user with ADR-0295;
  silence = accept-with-rationale + ledger rows (no port).
- Post-release: re-drive `agent_execute` (resolver-level), the task-completed surface, and the W1
  envelope in a fork env against published packages; flip ADR-0295 on green checks.
