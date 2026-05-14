# Council Transcript — ADR-0144 dialectic review

**Date**: 2026-05-04
**Hive ID**: `adr-0144-review`
**Topology**: Single-round parallel positions + single-round parallel reactions, queen-composed transcript
**Workdir**: `/tmp/adr-0144-review/{positions,reactions}/`
**Source files**: every quote in §3 traces to a literal phrase in `/tmp/adr-0144-review/positions/<persona>.md` or `/tmp/adr-0144-review/reactions/<persona>-reactions.md`. No fabrication.

## §1 Agenda

| # | Question |
|---|---|
| Q1 | Is ADR-0144's §Diagnosis (Cause 1: tool-name mismatch + Cause 2: deferred-tool inheritance) mechanically correct as stated? |
| Q2 | Is the §Decision (Bash CLI from sub-agents as transport-class rule) sound regardless of root cause? |
| Q3 | Is the "transport-wide, ~200 tools" scope claim verified or extrapolated? |
| Q4 | Is ADR-0144 structurally a single architectural decision under Nygard semantics, or four artifacts bundled? |
| Q5 | Should ADR-0144 ship as Proposed/Accepted, refactor, or be rejected? |

## §2 Per-Expert Positions

### Persona A — MCP Transport Architect
> "The 600s symptom is an in-harness wait state, not a 'no JSON-RPC reply' condition. The fork's MCP server is never asked." Cites `mcp-server.ts:497-502` returning `-32601` sub-millisecond for unknown method names per JSON-RPC 2.0 §5.1. Concludes the §Diagnosis text needs a one-line correction: "harness never receives a JSON-RPC reply" → "harness never *emits* the JSON-RPC request." Same outcome, different layer, changes what a live reproduction would look for.

### Persona B — Claude Code Internals
> "Diagnosis is plausibly directionally correct but evidentially shaky." The deferred-tool inheritance contract is **observational, not specified** — the evidence is the system prompt's self-reference, not Anthropic documentation. Cause 1 alone is sufficient (the tool name was never registered per `.mcp.json:3`); Cause 2 is **co-stated, not co-validated**. Verifies the "Agent tool API doesn't expose schema injection" claim by inspecting parameters: confirmed correct.

### Persona C — Empirical Test Designer
> "A plausible hypothesis presented as a finding. Four code-reading agents, zero reproductions." Designs a 4-arm matrix: A wrong-name no-preamble (control), **B correct-name no-preamble (discriminator)**, C correct-name with `ToolSearch` preamble, D Bash CLI. Branch (ii) — A hangs, B works — refutes Cause 2 entirely. Demands the experiment before Accepted.

### Persona D — ADR Process Reviewer
> "Structurally four artifacts crammed into one ledger entry": postmortem of refuted ADR-0140 row 3a hypothesis, operational rule, adversarial-review meta, latent-defect tracker + memory-cleanup TODO. The §Decision is **not** a load-bearing decision under Nygard semantics — ADR-0140 row 3a already enumerated A/B/C; ADR-0144 picks (C) and re-explains why. Recommendation: demote to ADR-0140 §Amendment + `docs/plans/postmortem-3a-mcp-from-sub-agent.md`, free the 0144 number.

### Persona E — Devil's Advocate (contrarian)
Four charges: (1) diagnosis unfalsified, (2) Bash CLI fragile due to Verdaccio currency, (3) postmortem not architectural decision, (4) transport-wide scope extrapolated. Initial vote: reject as ADR.

## §3 Cross-Expert Discussion

**A → E (on charge 2, Bash-CLI fragility):** "E's charge 2 is a deployment ops concern, not a transport-class fragility. The JSON-RPC/stdio invariants that make Bash CLI correct are independent of `npx @latest` freshness — that's an ADR-0143-adjacent problem, not a reason to weaken the transport-class rule."

**B → A (on harness-vs-server distinction):** Co-signs A's mechanical correction. "A's 'harness never emits the JSON-RPC request' sharpens my own framing and is now the predicted signal for live-repro: server-side log silence. If we observe stderr quiet during arm B, Cause 2 is real and dominant; if we see `-32601`, Cause 1 was the only mechanism."

**B → E (on charge 2, refuted):** "E's Bash-CLI fragility charge **conflates two failure surfaces.** ADR-0144 governs *which transport to use across the Agent-tool boundary*, not *which version of the CLI is current*. Verdaccio currency affects main-thread Bash calls equally, and the council protocol already relies on this pattern in step 4 of `reference-hive-runtime-crosstalk-pattern.md` without observed failures." Charge 2 doesn't land.

**C → A (on layer distinction):** Sharpens C's experiment design. Adds Sub-agent E whose sole job is `tail -f` MCP server stderr during arms A and B. Server-side log silence during arm B = Cause 2 confirmed; presence of `-32601` = Cause 1 only.

**C → E (on disposition):** "E wants to reject the ADR pre-reproduction; I want to run the 4-arm experiment and let outcome drive disposition. Reject-without-test discards the empirically-validated §Decision (iter4) along with the unverified §Diagnosis, freezes learning, and presumes the experiment won't run."

**D → C (on refactor vs experiment, orthogonal or in tension?):** "Orthogonal. Run C's experiment AND apply D's refactor. Outcome (ii) collapses the rule to 'use correct tool name'; the amendment shrinks accordingly. Either way, the postmortem doc absorbs the four-agent investigation."

**D → E (on charge 4, transport-wide):** "Charge 4 overreaches. Architectural inference from one validated A/B is standard ledger practice — ADR-0117 set transport-wide marketplace policy from a single `.mcp.json` schema gap. The issue isn't the inference; it's that no A/B has been run at all yet. E's stronger charges 1, 2, 3 stand; charge 4 needs softening."

**E → A (on mechanical correction):** Co-signs. "A's correction strengthens charge 1 — the §Diagnosis is mechanically wrong as written, not just unverified. STRENGTHENING."

**E → B (on 'best current explanation' middle ground):** Accepts as concession. "B's 'demote to best current explanation' is the minimum acceptable downgrade. I'd take stronger but accept this as a partial victory."

**E → D (on refactor):** Consolidates. "D's refactor recommendation is my preferred path — D's option 1 (ADR-0140 §Amendment + postmortem doc) absorbs the rule body verbatim while freeing the ADR-0144 number for actual decisions."

## §4 Vote Table

| # | Question | A | B | C | D | E (DA) | Tally |
|---|---|---|---|---|---|---|---|
| Q1 | §Diagnosis correct as stated? | Reject (mechanical correction needed) | Demote (best current explanation) | Reject (unfalsified) | Reject (postmortem material) | Demote-to-hypothesis | **5-0 demote/reject** |
| Q2 | §Decision (Bash CLI rule) sound? | Accept | Accept | Accept (regardless of root cause) | Accept (with `_cli_cmd`, not bare `npx`) | Accept-with-conditions | **5-0 accept** |
| Q3 | "Transport-wide" scope verified? | Pending experiment | Pending | Pending (4-arm refines) | Pending | Hold (charge 4) | **5-0 unverified** |
| Q4 | One ADR or four artifacts? | Refactor | Refactor | Run + refactor | Refactor | Refactor | **5-0 refactor** |
| Q5 | ADR-0144 disposition? | Refactor per D opt-1 | Demote to Provisional | Run experiment OR D opt-1 | Demote to amendment + postmortem | Block-on-#1, prefer D opt-1 | **5-0 refactor** |

## §5 Findings

### VIOLATIONS

- **V1 (Q1)** — §Diagnosis text "harness never receives a JSON-RPC reply" is mechanically wrong. Per A + JSON-RPC 2.0 §5.1 + `mcp-server.ts:497-502`: an unknown tool name reaching the server produces `-32601` sub-millisecond, never a 600s wait. Therefore the bytes never reach the server — the stall is in-harness, pre-dispatch. Source: `positions/A-mcp-transport.md`, `reactions/A-reactions.md`.
- **V2 (Q4)** — ADR-0144 violates Nygard's single-decision contract. Bundles postmortem (refuted ADR-0140 row 3a hypothesis) + operational rule + adversarial-review acknowledgement + latent-defect tracker + memory-cleanup TODO. The §Decision is not load-bearing — ADR-0140 row 3a's option (C) is rebadged. Source: `positions/D-adr-process.md` §"Stance".

### WARNINGS

- **W1 (Q3)** — "Transport-wide, ~200 tools" scope is **inferred from one tool's behaviour**. Mechanistically defensible (per D's "ADR-0117 transport-wide policy from one `.mcp.json` gap") but unverified. C's arm B + memory_store extension would settle in <5 min.
- **W2 (Q1)** — Cause 2 (deferred-tool inheritance) is **co-stated, not co-validated**. Cause 1 (tool-name mismatch) alone explains the symptom. Source: B's "Cause 1 alone is sufficient" (`positions/B-claude-code-internals.md`).
- **W3 (Q2)** — Bash-CLI prescription must use `$(_cli_cmd)` per `reference-cli-cmd-helper` memory (36× faster than bare `npx @latest` under cache contention). ADR-0144's prose embeds the slow form. Source: `reactions/D-reactions.md`.

### OBSERVATIONS

- **O1** — §"Latent defect surfaced" (`mcp-server.ts:408-413` parse-error swallow) is structurally separate from the transport rule. Belongs in its own ticket.
- **O2** — Memory cleanup (`mcp__ruflo__hive-mind_memory` → `mcp__claude-flow__hive-mind_memory`) is documentation hygiene, not an ADR follow-up.
- **O3** — §"Adversarial review acknowledgement" inside the ADR is meta-process commentary; belongs in PR description or postmortem doc.

## §6 Verdict

**REFACTOR ADR-0144** along D's option 1, with the following remediations from the council:

1. **Apply A's mechanical correction** to §Diagnosis text in the postmortem doc.
2. **Apply B's framing demotion** ("best current explanation," Cause 2 unverified, Cause 1 sufficient).
3. **Apply D's structural change**: ADR-0140 absorbs the rule as `## Amendment 2026-05-04 — row 3a closure` (~30 lines). `docs/plans/postmortem-3a-mcp-from-sub-agent.md` carries the four-agent investigation, refuted hypotheses, A's correction, B's framing.
4. **Apply C's experimental gate**: the 4-arm matrix (with A's stderr-tail addition and C's memory_store extension) runs before §Scope claim ("transport-wide") is bound to anything beyond `hive-mind_memory`.
5. **Apply W3**: rule body MUST cite `$(_cli_cmd)` not bare `npx @sparkleideas/cli@latest`.
6. **Mark ADR-0144 as Superseded** — file remains for audit trail, status updated, points at ADR-0140 §Amendment + postmortem doc. Does NOT free the 0144 number (per B's "withdraw entirely if branch (ii) fires" — leave the file in place to record the closed-out hypothesis).

The §Decision (transport-class rule, Bash CLI from sub-agents) survives all five votes. Implementation lands as ADR-0140 amendment, not ADR-0144.

## §7 Expert Signatures

| Persona | Verdict |
|---|---|
| A — MCP Transport Architect | REFACTOR (per D opt-1 + my mechanical correction to §Diagnosis text) |
| B — Claude Code Internals | DEMOTE TO PROVISIONAL → REFACTOR per D opt-1 once experiment runs |
| C — Empirical Test Designer | RUN 4-arm experiment; refactor per D opt-1 acceptable as substitute |
| D — ADR Process Reviewer | REFACTOR per option 1; rule must use `$(_cli_cmd)` |
| E — Devil's Advocate (closing) | HOLDING charges 1, 3, 4; WITHDRAWING charge 2. VOTE: accept-with-conditions on rule, demote-to-hypothesis on diagnosis, block on Open-follow-up #1; preferred path = D's refactor |

Vote: **5-0 refactor**. No abstentions. DA explicitly withdrew charge 2 after refutation by B.
