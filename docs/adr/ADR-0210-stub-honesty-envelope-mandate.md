---
status: accepted
date: 2026-05-19
tags: [mcp, honesty, stubs, policy]
supersedes: []
depends-on: [ADR-0201]
implements: []
---

# Stub honesty — implement, restore, or delete (not a fork-only `_stub` mandate)

> **Reframed after a 6-expert swarm review (2026-05-20).** The original draft chose Option D — mandate a `_stub: true` envelope on 11 stub MCP handlers, enforced by an AST arch-test. The review refuted the premise and the mechanism, with evidence: (a) **`_stub:true` does not reach the LLM caller** — the MCP server JSON-stringifies every result into `content[0].text` (`mcp-server.ts:673`), so the field is bytes in a blob, visible only to in-process TypeScript callers; (b) the arch-test is the **same ~84–98%-false-positive, not-statically-decidable detector ADR-0209's swarm rejected one day earlier**; (c) the LLM **selects** tools by `description` (which the ADR left out of scope) before any handler runs — so the ADR fixes the layer that matters least; (d) **3 of the 7 "fake-data stubs" are fork regressions** whose real implementations exist in upstream HEAD (the fork reverted them in `815615b47`), and (e) **upstream already decided this exact problem the opposite way** — ADR-073 *removed* fabrication and *wired real code*; commit `5d40236b1` is titled "Zero `_stub:true` remaining in mcp-tools/." The `_stub:true` shape the draft canonized is upstream's *abandoned* scaffolding. Decision changed to **Option B′ — implement/restore/delete per-stub (matching upstream ADR-073), fix the descriptions, and drop the arch-test for runtime smoke-tests.** See [Swarm review evidence](#swarm-review-evidence-2026-05-20).
>
> **Second-pass validation (2026-05-20):** B′ confirmed (inventory accurate: 3 `_stub` sites all in `performance-tools.ts`; upstream has 0; the `815615b47` collateral revert verified — `matchScore`→`Math.random`, `filesAnalyzed`→`42*multiplier`, `trajectories`→`156`; drop-the-arch-test is right — the one real regression was a *file-level revert* an AST detector wouldn't catch). **Five corrections folded into the steps below:** **(1) Step 1 is a per-handler HAND-PORT, not a clean cherry-pick** — `hooks_explain` is near-verbatim, `hooks_intelligence-reset` needs an fs-import extension + `getProjectCwd()`→`findProjectRoot()` (ADR-0100), and **`hooks_pretrain` re-targets its store** (the draft called this a "hard blocker"; the council found it is **not**): upstream's real impl uses `import('../memory/memory-bridge.js')` + `bridge.bridgeStoreEntry(...)`, and the fork deleted `memory-bridge.ts` (ADR-0085 `904687f7f`) — but the fork's drop-in is **already wired in-file**, `getRealStoreFunction()` (`hooks-tools.ts:87`) wrapping `routeMemoryOp({type:'store',…})` with the identical payload, already used by `hooks_post-task` + `trajectory-start`. So pretrain is a one-line import swap — the *easiest* of the three Step-1 ports. Its FS-scan re-syncs upstream, but its **store step is fork-original** (upstream's bridge path is gone), so ledger disposition = `hand-port (FS-scan) + fork-original (store)`, not a clean upstream re-sync. **(2) `hooks_notify`: drop "implement real delivery"** — upstream HEAD *still* hardcodes `delivered:true` (`hooks-tools.ts:2067`), so there is no real upstream code to restore; disposition is delete-or-`_note`-pending. And the 0210↔0211 defer is **a two-layer split, not a circular punt**: 0210 owns the **MCP tool** `hooks_notify` (`hooks-tools.ts:2200`); 0211 owns the **init-handler `notify` event** (`settings-generator.ts:573`→`helpers-generator.ts:591`) — pin ownership in both. **(3) Step 3 INCREASES divergence** for that one sub-field (upstream still carries `patternsApplied: length*3` at `:1679`) — still correct to delete fabrication, but don't call it "reduces divergence." **(4) Step 8 cli-core scope is narrower than implied** — `hooks-defs.ts` is defs-only (zero handlers); only `hooks_explain` overlaps, and it has an extra `topic`(defs `:121`)-vs-`task`(handler `:1707`) input-schema mismatch to reconcile, not just the description. **(5) Descriptions-fix coupling**: an honest-limitation description is only valid *alongside* a non-fabricating handler — upstream's `hooks_notify` (honest description + lying `delivered:true` handler) is the worst-quadrant proof.

## Context and Problem Statement

The 2026-05-19 soundness audit (ADR-0201, slices 03 + 08) found MCP tool handlers whose advertised behaviour exceeds their implementation: 7 "fake-data" handlers in `cli/src/mcp-tools/hooks-tools.ts` returning hardcoded/fabricated numbers as real metrics, plus a handful of "honest" stubs that admit incompleteness via a response field (`_stub: true` in `performance-tools.ts`; `executor: 'none' + _note` in `coordination-tools.ts`; `implementation: 'placeholder'` in three hooks branches). The fake-data variant is the real harm: a caller sees `success: true` with canned numbers presented as measurements. Per [[feedback-skip-accepted-as-squelch]] and [[feedback-no-fallbacks]], unimplemented surfaces must be observable, not masked behind a green envelope.

The original ADR proposed mandating one canonical `_stub: true` field on all such handlers, enforced by an arch-test. The swarm review establishes that the harm is real but the chosen remedy is the wrong instrument, for five reasons that reshape the decision.

### Finding 1 — `_stub:true` does not reach the LLM caller

The MCP server re-wraps every tool result before it crosses the protocol boundary:

```ts
// mcp-server.ts:695 (line drifted from the audit's :673)
result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
```

So `_stub:true` is flattened into a JSON **string** inside `content[0].text` — in protocol terms indistinguishable from `cleared.trajectories: 156`. There is no MCP `isError`, no structured-content channel, no field the model or harness is primed to act on. The ADR's lead driver — "a caller (Claude Code) detects the gap by inspecting the envelope" — is **structurally false for the LLM caller**; it holds only for *in-process TypeScript callers* (the CLI command wrappers, which hold the raw object). The draft's own smoke-test asserts `_stub` via `callMCPTool` (the in-process path), never over the `tools/call` wrap the model sees.

### Finding 2 — the layer that governs LLM behaviour is `description`, which the ADR defers

Tool **selection** happens from `tools/list` (`mcp-server.ts:647`) by `name` + `description`, **before any handler runs** — before `_stub` could exist. Those descriptions advertise full functionality (`hooks_notify` → "Send cross-agent notification"; `hooks_init` → "Initialize hooks in project with .claude/settings.json"). So the model selects on an honest-looking description, burns a turn, and only post-call receives a blob with `_stub` buried. The audit's own Recommendation 4 (F-08-006/007/011) said bake stub-status into the **description**; the original ADR declared exactly that out of scope. **Envelope honesty without description honesty fixes the layer the LLM reaches last, through a degraded channel, and defers the layer it decides on.**

### Finding 3 — the arch-test is ADR-0209's rejected detector

The draft's Confirmation step 2 flags "a numeric literal in a measurement-named field (`total`, `count`, `confidence`, `matchScore`, …) **without a prior `await` producing it**." Empirically, in `mcp-tools/`: `confidence:` literal = 25 sites (~3 fabrications, 22 legitimate, incl. 18 routing-table defaults); `total:` literal = 16 sites (2 fabrications, 14 honest `total:0` envelopes the ADR itself calls honest). The "without a prior await" qualifier is **not statically decidable** and inverts (honest sites are bare literals; the dishonest one sits adjacent to a real `suggestion.confidence`). Stripped, the rule is "flag every numeric literal in these fields" ≈ **84% FP**; the `Math.random()` variant ≈ **96% FP** (26 of 27 hits are ID-gen/jitter/real-benchmark data). It is also trivially evaded (`const x = 156; return {cleared:{trajectories:x}}`). This is the identical undecidable predicate ADR-0209's swarm dropped on 2026-05-20 (its "detector 3b"), on the same `hooks-tools.ts` corpus. A blocking gate over it would need a 20–40-entry allowlist to go green — theatre, the inverse of the squelch the ADR forbids.

### Finding 4 — 3 of the 7 "fake-data stubs" are fork regressions with real code in upstream HEAD

Git archaeology (corroborated by upstream comparison):

* `hooks_explain`, `hooks_pretrain`, `hooks_intelligence-reset` ship **real implementations in upstream `ruvnet/ruflo` HEAD** (real `matchScore` ratio + `routing-outcomes.json` read; real FS walk `filesAnalyzed++` + AgentDB store; real `unlinkSync` + `activeTrajectories.clear()` with true counts).
* The fork *had* these (upstream-authored, landed via `c2c083331`, 2026-05-09 21:59, committed by Henrik) and then **lost them ~2 hours later** to `815615b47`, which restored `hooks-tools.ts` to its pre-`c2c` baseline to undo a *co-located* memory-bridge re-introduction — collaterally reverting the real fixes and dropping `_stub`. The commit message admits the reworks "can be re-applied… in a follow-up"; the follow-up never happened.

For these three, the correct action is **revert the regression / re-sync upstream's real code** — closing 3 of 7 with upstream's own implementation at **zero divergence tax** (the fork pays tax *now* by carrying the regressed copies). Labeling them `_stub:true` would freeze a regression as policy and block re-adopting the real code.

### Finding 5 — upstream already decided this problem class: implement/delete, not label

Upstream has **no live `_stub` convention** (`grep "_stub:\s*true"` in upstream `cli/src` = 0 hits). It *invented* the field in its 2026-04-06 honesty audit (`a2e2def04`) and then **deliberately retired it** (`5d40236b1`: "Zero `_stub:true` remaining in mcp-tools/") as real implementations landed. Upstream's accepted **ADR-073** ("stub tool honesty / real predictions," issue #1514) chose **removal + real wiring** (`TokenOptimizer += 100` → real content-size; `neural_predict` random confidence → real embedding similarity), never a label. Upstream's *surviving* honesty idiom is `_note` (free-text), not `_stub`. Issues #653 ("85% of MCP tools are mock/stub"), #1058 (OPEN, "hook handlers are stubs… LIES"), #1514, #1636 all treat fake-data-as-real as **a bug to implement away**. The `_stub:true` shape the original ADR canonized is upstream's *abandoned intermediate state*; mandating it fork-only diverges from upstream's surviving convention and reverses its accepted decision.

### Inventory and scope corrections

* `_stub:true` exists at only **3 sites today** (all `performance-tools.ts` — `bottleneck/profile/optimize`), themselves upstream's discarded scaffolding (upstream removed them in `04d6a9a0a` when real metrics landed).
* `coordination_orchestrate` performs a **real archivist dispatch** before appending `executor:'none'` — it is partial-real, not a stub; it should not be forced to carry `_stub`.
* A **second definition site** exists at `cli-core/src/mcp-tools/hooks-defs.ts` (e.g. `hooks_explain`) that the original `cli/src/mcp-tools/` scope misses.
* No programmatic caller invokes the 7 fakes — only CLI command wiring and docs reference them.

## Decision Drivers

* **Honesty at the layer that matters** — the LLM selects on `description`; that surface must not advertise capability the tool lacks. Envelope/in-process honesty is secondary.
* **Match upstream's accepted decision** (ADR-073: implement/delete) — minimise divergence and merge tax; for the 3 regressions, upstream's real code is the fix.
* **Don't ship a gate over an undecidable predicate** — per ADR-0209's settled conclusion, fabrication-correctness isn't statically decidable; enforce with behaviour tests + types + review.
* **Implement-or-delete over label** ([[feedback-skip-accepted-as-squelch]], [[feedback-corpus-evidence-before-feature-work]]) — a labeled stub with no caller and no backend is permanent debt politely dressed; for caller-less tools, removal beats labeling.
* **`_note` over `_stub`** — use upstream's surviving idiom for any genuine residue, not a new fork-only field.
* **Loud-not-silent** ([[feedback-no-fallbacks]]) — fabricated numbers presented as measurements must be removed, regardless of disposition.

## Considered Options

* **Option A — Mandate `_stub:true` envelope.** Label-only; doesn't reach the LLM; freezes incompleteness.
* **Option B — Replace all stubs with real implementations (or remove).** Upstream's executed choice (ADR-073). The right spirit; the original draft called it "multi-week," but the review shows 3 are *reverts* and 2 are trivial.
* **Option C — Quarantine module + manifest prefix.** Forces stub-ness into the manifest (the right layer) but is coarse and a public-API change.
* **Option D — Hybrid: mandate `_stub:true` + per-stub tracking + arch-test (original).** Premise inverted, mechanism theatre, vocabulary divergent. Rejected.
* **Option B′ (chosen) — Discriminated implement/restore/delete per-stub (matching upstream ADR-073), fix the descriptions, drop the arch-test for runtime smoke-tests; reserve a `_note` honesty marker only for genuine pending-backend residue.**

## Decision Outcome

**Chosen: Option B′.** Per-stub disposition, ordered by leverage:

1. **Hand-port upstream HEAD's real implementations** for `hooks_explain`, `hooks_pretrain`, `hooks_intelligence-reset` (2nd-pass: this is a per-handler **hand-port**, NOT a clean `cherry-pick` — the 4000-line `hooks-tools.ts` has diverged across many handlers; `git show c2c083331:…`/upstream HEAD are *references*). Per-handler difficulty differs: **`hooks_explain`** near-verbatim (add the `validateText` import; reads `routing-outcomes.json`). **`hooks_intelligence-reset`** add `unlinkSync`/`readdirSync` to the fs import + rewrite upstream's `getProjectCwd()`→fork's `findProjectRoot()` (ADR-0100). **`hooks_pretrain`** HARD BLOCKER — upstream's real store is `import('../memory/memory-bridge.js')` + `bridge.bridgeStoreEntry(...)`, but the fork **deleted `memory-bridge.ts` (ADR-0085 `904687f7f`)**; re-target the store step to `memory-router` (`routeMemoryOp`), OR restore the real FS-scan only (`filesAnalyzed`/`totalLines`/`patternsExtracted`) and `_note` the `patternsStored`. Closes 3 of 7 with real code (end-state re-converges; the *operation* is a hand-port). Update `docs/upstream/INTEGRATION-LEDGER.md` (disposition `hand-port`; the `815615b47` revert dropped these — record the re-application).
2. **Implement the trivial two:** `hooks_list` via `listMCPTools().filter(t => t.name.startsWith('hooks_'))` (`mcp-client.ts:217`); `hooks_init` via the `mkdirSync`/`writeFileSync` pattern already in `hooks_build-agents` (or delete it and route to `commands/init.ts` if redundant). These are smaller than labeling them.
3. **Surgically delete the fabricated sub-field** `hooks_build-agents.patternsApplied: count * 3` (keep the real config-file writes). No marker needed; it's a deletion.
4. **`hooks_notify` (the MCP tool, `hooks-tools.ts:2200`)** — the only genuine needs-infra residue, and **0210 owns this MCP-tool site** (2nd-pass: NOT a circular defer with 0211 — 0211 owns the *distinct* init-handler `notify` event at `settings-generator.ts:573`→`helpers-generator.ts:591`; the audit lists `hooks_notify` under both F-03 and F-02 because they are two layers). Disposition: **delete the MCP tool** (zero programmatic callers) keeping any CLI command, **or** mark honestly with `_note` pending. **Drop "implement real delivery" as a co-equal option** — upstream HEAD *still* hardcodes `delivered:true` (`hooks-tools.ts:2067`), so there is no real upstream implementation to restore; building transport is net-new infra, out of this ADR's scope. Do not ship `delivered: true` for a no-op.
5. **`performance_bottleneck/profile/optimize`** — re-sync upstream's real implementations if present (upstream removed their `_stub` when real metrics landed); otherwise leave the existing `_stub` *as the transitional marker it already is* and track. Do not propagate `_stub` to new sites.
6. **Fix the descriptions** (NOT deferred to a sibling ADR — this is the load-bearing, LLM-facing layer). Any tool that must remain incomplete after steps 1–5 has its `tools/list` `description` state the limitation, so the model doesn't select it expecting full function. This subsumes the audit's F-08-006/007/011 Recommendation 4.
7. **Drop the AST arch-test.** Enforce with the **runtime smoke-test** the draft already lists (call each remaining incomplete tool via `callMCPTool`, assert honest output) + behaviour integration tests + code review + typed result discriminators (ADR-0209's settled approach). If a static guard is wanted, a **net-new** `check-fabrication.mjs` (it does not exist yet) built on the existing zero-dep `check-*.mjs` family (real members are `check-silent-catches.mjs` / `check-undiscriminating-catches.mjs` — there is no `check-*-catches.mjs`), keyed only on the narrow, low-FP shapes (`Math.random()`-in-a-metric, `* multiplier`-on-a-constant), shipped `exit 0`. The **load-bearing** enforcement is the behaviour smoke-test, not this advisory.
8. **Scope correction:** include `cli-core/src/mcp-tools/hooks-defs.ts`; exclude `coordination_orchestrate` (partial-real, already honest).

Net (the 7 original fakes): 3 **hand-ports** (item 1 — `hooks_explain`/`hooks_intelligence-reset` are true upstream re-syncs; `hooks_pretrain`'s store is fork-original) + 2 **fork-original implements** (item 2 — upstream `hooks_list`/`hooks_init` still fabricate, so these do NOT re-converge) + 1 sub-field deletion (item 3) + 1 `hooks_notify` **delete-or-`_note`, owned here** (item 4 — NOT deferred to 0211; only the distinct init-handler event is); perf trio (item 5) re-sync-or-keep-marker; descriptions fixed (item 6). **Scope extension** adds F-01-004 / F-02-007 / F-03-007. The `_stub`/`_note` marker is reserved for at most the `hooks_notify`/perf residue, using upstream's `_note` idiom — not a fork-wide mandate.

### Scope extension (added 2026-05-20, post-impl-order audit)

Three additional CRITICAL stubs from the ADR-0201 audit share Option B′'s per-handler disposition shape (fabricated values returned as if computed); they are folded into the same mandate here so the audit→ADR map is complete. The dialectic should re-derive each disposition independently — the proposals below are starting points.

- **F-01-004** `hooks_session-restore` (`hooks-tools.ts`, audit slice `01-hooks-pre-lifecycle.md`) — synthesizes a faked `originalSessionId` (`Date.now()-86400000`) and other fixed values. (Correction 2026-05-22: the `duration: 3600000` literal the draft cited here actually belongs to **`hooks_session-end`** — see F-03-013 below; and the `pending-insights.jsonl` source is an init-template *string* never read by the compiled MCP server, so that primary disposition is **not buildable**.) **Disposition:** the handler already reads `loadMemoryStore()` for real counts; drop the faked `originalSessionId` and `_note`-mark honest empty data when no real session state exists — never fabricate.
- **F-03-013** `hooks_session-end` (`hooks-tools.ts:~2113`, audit slice `03`) — returns a hardcoded `duration: 3600000` regardless of actual session length. **Disposition: implement** — compute real duration from the session-start timestamp if available, else `_note`-mark honest. (Previously hand-waved as an "item 3 sibling" with no disposition; pinned here.)
- **F-02-007** `hooks_post-task` (`hooks-tools.ts`, audit slice `02-hooks-post-lifecycle.md`) — synthesizes a fake `trajectoryId` rather than finalizing a real trajectory via `hooks_intelligence_trajectory-end`. **Tentative disposition: implement** — call the real `trajectory-end` path or return `_note`-marked "no active trajectory"; never synthesize. **Coordinate with ADR-0211** which owns the init-handler `post-task` event at `settings-generator.ts:389` → `helpers-generator.ts:546`; the MCP-tool layer (this ADR, `hooks-tools.ts:hooks_post-task`) and the lifecycle-event layer (0211) are separate sites, same ownership-split shape as `hooks_notify` (per Option B′ item 4).
- **F-03-007** `hooks_worker-detect` (`hooks-tools.ts`, audit slice `03-hooks-intelligence-routing.md`) — auto-dispatch loop uses fake `setTimeout(1500)` to flip workers to `completed`. **Tentative disposition: delete the fake flip** — if the auto-detected workers have a real run path, route through ADR-0218's queue producer (the daemon-queue file write to `.claude-flow/daemon-queue/<id>.json`); if no real-dispatch path exists for auto-detected workers, return an honest `pending` / `mcp-only` state rather than a fabricated `completed`. **Coordinate with ADR-0218** on the queue-producer reuse; the underlying queue infrastructure is 0218's domain.

Audit-trail clarification: 0210's existing per-handler list at items 1–4 already covers, by handler name, F-03-003 (intelligence-reset, item 1), F-03-004 (pretrain, item 1), F-03-005 (init, item 2), F-03-006 (list, item 2), F-03-011 (build-agents, item 3), F-03-013 (session-end — now pinned with its own disposition in the scope-extension list above), F-03-014 (`hooks_notify` MCP tool, item 4); F-08-006 / F-08-007 / F-08-011 are picked up by item 6 (descriptions). The above three (F-01-004 / F-02-007 / F-03-007) are the missing CRITICAL stubs from the same audit cluster the [[project-adr0201-remediation-impl-order]] map did not catch.

### Confirmation

* **Behaviour, not syntax:** integration tests assert real outcomes — `hooks_pretrain` reads the filesystem (file count matches a fixture), `hooks_intelligence-reset` actually deletes the data files, `hooks_list` returns the live registry count (= `listMCPTools()` filtered length, not a literal), `hooks_init` writes `.claude/settings.json` (asserted on disk). These are the signal ADR-0191/0209 identify as load-bearing.
* **Runtime smoke-test** (kept from the draft) for any tool still incomplete: `callMCPTool` → assert the honest marker / honest empty data; never a fabricated number.
* **Description honesty:** a test asserts that any tool whose handler is incomplete has a `description` that does not advertise the missing capability.
* **No fabrication regressions:** a **net-new** advisory `check-fabrication.mjs` (to be built on the existing zero-dep `check-silent-catches.mjs`/`check-undiscriminating-catches.mjs` family; `exit 0`) flags `Math.random()`/`*multiplier` in a returned metric field — narrow, low-FP shapes only; NOT the undecidable "numeric-literal-in-measurement-field" rule. The load-bearing enforcement is the behaviour smoke-test above, not this advisory.
* **Ledger:** the re-application of the 3 reverted upstream implementations is recorded in `INTEGRATION-LEDGER.md`.
* **Cross-ADR:** `hooks_notify` disposition tracked under ADR-0211; dead `@claude-flow/hooks` parallel handlers (F-03-001) under ADR-0203; the `cli-core` second site reconciled or noted.

### Consequences

* Good, because 2 of 7 (`hooks_explain`, `hooks_intelligence-reset`) close by re-adopting upstream's real code — *reducing* fork divergence instead of adding a fork-only label.
* Neutral, because the other fixes (`hooks_pretrain`'s store, `hooks_list`, `hooks_init`, the `patternsApplied` deletion) are fork-original — upstream still fabricates those handlers, so these remove fabrication without re-converging (and the `patternsApplied` deletion slightly *increases* divergence: upstream still carries `patternsApplied: length*3` at `hooks-tools.ts:1679`). Honesty is correctly preferred over convergence here.
* Good, because the 2 trivial implements + 1 sub-field deletion remove fabrication outright (no marker to maintain).
* Good, because fixing descriptions repairs the layer the LLM actually selects on — the honesty the original ADR deferred.
* Good, because dropping the AST arch-test avoids re-litigating ADR-0209's rejected, ~84–98%-FP, evadable detector and the allowlist-theatre it would create.
* Good, because matching upstream ADR-073 + `_note` keeps the fork convergent with upstream's surviving convention.
* Bad, because reverting `815615b47`'s collateral requires care — the original revert was undoing a real memory-bridge problem; the re-sync must take *only* the three handler implementations, not the bridge.
* Bad, because `hooks_notify` (and possibly the perf trio) genuinely lacks a backend; honest disposition there is delete-or-`_note`-pending-0211, not a quick win.
* Neutral, because the in-process `_stub`/`_note` marker still has value for TypeScript callers + CI, just not as the headline remediation and not as a fork-wide mandate.
* Neutral, because the `cli-core` second definition site widens scope slightly.

## Pros and Cons of the Options

### Option D — mandate `_stub:true` + arch-test (original)
* Good, because cheap single-field additions; immediate "honesty" claim.
* Bad, because `_stub` doesn't reach the LLM (`mcp-server.ts:673`); the arch-test is ADR-0209's rejected ~84–98%-FP undecidable detector; it defers description honesty (the layer that matters); it freezes 3 fork regressions as policy and reverses upstream's accepted ADR-073; it uses a fork-only field instead of upstream's `_note`.

### Option B′ — discriminated implement/restore/delete (chosen)
* Good, because fixes the real harm (removes fabrication), re-converges with upstream, repairs the selection-time layer, and enforces by decidable behaviour tests.
* Good, because most of the work is *reverting/cherry-picking upstream* + two trivial implements, not multi-week greenfield (the draft's objection to Option B).
* Bad, because `hooks_notify` and the perf trio still need real backends or principled deletion — no label shortcut.

### Options A / B / C
* A — label-only, doesn't reach the LLM, freezes debt. B — the right spirit (this is B′ made discriminated/cheap). C — manifest-prefix is coarse and a public-API change; description-honesty (step 6) captures its value surgically.

## Swarm review evidence (2026-05-20)

Six-expert review; verified against fork HEAD `3359a6a` and upstream `ruvnet/ruflo` HEAD `ef73a16`.

* **MCP Architect** — `_stub` flattened into `content[0].text` at `mcp-server.ts:673` → unreachable by the LLM; selection is by `description` (`mcp-server.ts:647`); `hooks_list`/`hooks_init` trivially implementable; `coordination_orchestrate` is partial-real. Verdict: implement/delete cheap; envelope is in-process-only.
* **Arch-Test Feasibility** — detection (i) ~84% FP, `Math.random` variant ~96% FP, "without prior await" not decidable, evadable → theatre; replace with the runtime smoke-test the ADR already lists; same as ADR-0209.
* **Code Archaeologist** — 7 fakes upstream-born (rUv, 2026-01-06); honest `_stub` shape upstream-native (Reuven, 2026-04-06); **3 are fork regressions** (`c2c083331` real fix reverted by `815615b47` ~2h later) — recoverable. Restore, don't label.
* **Upstream Analyst** — upstream has **0** live `_stub`; invented then retired it (`5d40236b1` "Zero `_stub:true` remaining"); ADR-073 chose implement/delete; surviving idiom is `_note`; 3 stubs already real in upstream HEAD; issues #653/#1058/#1514 treat fake-data as a bug. Decisive for Option B.
* **Devil's Advocate** — `_stub` is a squelch the selector never reads; upstream ADR-073 is the inherited precedent (implement/delete); no programmatic callers → delete beats label; arch-test = yesterday's rejected detector; partial-stub semantics undefined; second definition site (`cli-core`).
* **Queen** — synthesis: revert the 3 regressions, implement the 2 trivial, delete the fabricated sub-field, defer `notify` to 0211, fix descriptions, drop the arch-test, `_note` for residue. Option B′.

### Second council re-validation (2026-05-22)

A fresh 6-expert council re-verified ADR-0210 against fork HEAD + upstream. **Option B′ re-affirmed (6/6)** — every factual premise holds: `_stub` is flattened at `mcp-server.ts:695` (no `isError`, unreachable by the LLM); the 3-regression git story is exact (`c2c083331` 21:59 → `815615b47` 23:43); upstream has 0 live `_stub` / 18 `_note` and ADR-073 chose implement-delete; `hooks_notify` hardcodes `delivered:true` upstream too (no delivery to restore); the arch-test is ADR-0209's rejected ~84-98%-FP undecidable detector. Corrections folded in:

* **"Re-adopt upstream / reduces divergence" reclassified:** only `hooks_explain` + `hooks_intelligence-reset` are true zero-tax upstream hand-ports. `hooks_list` + `hooks_init` are **fork-original** (upstream still fabricates them — `total:26`, byte-identical path-string stub), and `hooks_pretrain`'s store is **fork-original** (upstream's `memory-bridge` path is deleted). Ledger dispositions corrected; the divergence framing in Consequences + the net tally rewritten.
* **`hooks_pretrain` is NOT a hard blocker** — the fork already wires `getRealStoreFunction()`→`routeMemoryOp` in-file (`hooks-tools.ts:87`, used by `post-task`+`trajectory-start`); pretrain is a one-line swap, the easiest Step-1 port.
* **F-01-004 / F-03-013 untangled:** the `duration:3600000` literal belongs to `hooks_session-**end**` (F-03-013, now given its own disposition), not `session-restore` (F-01-004, whose real defect is a faked `originalSessionId`). The `pending-insights.jsonl` source for F-01-004 is an init-template string never read at runtime — use the `_note` fallback.
* **Phantom guard fixed:** `check-fabrication.mjs` does not exist and there is no `check-*-catches.mjs`; named it net-new on the real `check-silent/undiscriminating-catches.mjs` family, and made the behaviour smoke-test the load-bearing enforcement.
* **`mcp-server.ts:673`→`:695`** drift corrected; net-tally relabeled (hand-ports not "reverts"; `hooks_notify` owned-here not "deferred-to-0211").

**Minority / queen recommendations (for batch ratification):** (1) **Split the delivery** — ship now the decidable subset (descriptions + the 3 fabrication deletes + the 2 fork-original implements + pretrain's one-line re-target + F-03-007's self-contained "delete the fake `setTimeout` flip" fallback); track separately the items coupled to still-`proposed` siblings (F-03-007's *preferred* route through ADR-0218's queue producer). (2) Acknowledge the **descriptions merge-tax** (upstream advertises full capability; an honest-limitation description re-flags every sync) — prefer **delete** over **describe** for caller-less tools. (3) The strongest form of the rejected Option D — a **protocol-level `isError`/`structuredContent`** signal at the `mcp-server.ts:695` wrap that *does* reach the LLM at call-time — was not considered by the original draft; if pursued it belongs in its **own micro-ADR**, not a revival of the in-process `_stub` field. B′'s direction stands.

## More Information

Lifecycle dates from the original record: accepted 2026-05-19, implemented 2026-05-23. This ADR was swarm-reviewed.

* **Upstream precedent:** `forks/ruflo/v3/implementation/adrs/ADR-073-stub-tool-honesty-real-predictions.md` (accepted; removed fabrication + wired real). Upstream commits `a2e2def04` (added `_stub`), `5d40236b1` ("Zero `_stub:true` remaining"), `04d6a9a0a` (perf-tools real metrics).
* **Fork regression:** `c2c083331` (real fixes, 2026-05-09 21:59) → `815615b47` (revert, ~2h later); recover via `git show c2c083331:…hooks-tools.ts` or upstream HEAD.
* **Sibling ADRs:** ADR-0209 (no-fallbacks; same swarm reframed it 2026-05-20 — fabrication not statically decidable, `Result`+tests+review over a detector); ADR-0211 (owns `hooks_init`/`hooks_notify`); ADR-0203 (deletes the dead `@claude-flow/hooks` parallel handlers, F-03-001).
* **Audit:** ADR-0201 slices `03-hooks-intelligence-routing.md`, `08-mcp-tool-implementations.md` (F-03-002/003/004/005/006/011/014, F-08-006/007/011); Rec 4 = description honesty.
* **Key sites:** fakes `hooks-tools.ts:1442-1488,1701-1797,1799-1868,2177-2246,2354-2372`; honest `_stub` `performance-tools.ts:226-233,379-386,399-406`; partial-real `coordination-tools.ts:844-855`; second definition site `cli-core/src/mcp-tools/hooks-defs.ts`; result wrap `mcp-server.ts:673`; tools/list `mcp-server.ts:647`; `listMCPTools` helper `mcp-client.ts:217`.
* **Memory:** [[feedback-skip-accepted-as-squelch]], [[feedback-no-fallbacks]], [[feedback-corpus-evidence-before-feature-work]], [[feedback-upstream-means-upstream]], [[feedback-update-integration-ledger]].

## Amendment — 2026-05-23 (Move A audit, implemented)

Status flipped: **proposed → implemented**. Implementation commit: `forks/ruflo` `98d10e489` ("fix(mcp-tools): ADR-0210 per-handler stub honesty dispositions").

**Behaviour evidence:** `forks/ruflo/v3/@claude-flow/cli/__tests__/mcp-tools/hooks-stub-honesty.test.ts` — 12/12 pass (1.93s). Covers all 11 dispositioned handlers:

- item 1 hand-ports: `hooks_explain` / `hooks_pretrain` (FS-scan + routeMemoryOp store, not upstream's deleted memory-bridge) / `hooks_intelligence-reset`
- item 2 fork-original implements: `hooks_list` (live registry filter) / `hooks_init` (writeFileSync settings.json)
- item 3 sub-field deletion: `hooks_build-agents.patternsApplied`
- item 4 `hooks_notify` MCP tool: `_note`-pending (no delivery backend); description corrected at `hooks-tools.ts:2393`
- scope extension: `hooks_session-restore` (F-01-004), `hooks_session-end` (F-03-013), `hooks_post-task` (F-02-007), `hooks_worker-detect` (F-03-007)

**Surviving markers per Option B′:**

- `_note` (upstream's surviving idiom): 9 sites in `hooks-tools.ts`, 4 in `coordination-tools.ts`
- `_stub:true`: 3 sites in `performance-tools.ts:229,382,402` preserved as transitional per item 5 (descriptions update deferred)

**OUTSTANDING — INTEGRATION-LEDGER row required** per [[feedback-update-integration-ledger]] + Confirmation bullet 4: ledger does not yet record the 3 item-1 hand-ports from upstream HEAD. Currently 0 matches for ADR-0210 / cited commit SHAs / hand-ported handler names. Add a ledger row before next upstream-sync cycle to avoid the same class of debt that cost the ADR-0186 re-audit.

**Other open items:** item 5 (performance-tools.ts perf trio) + item 6 (description honesty beyond `hooks_notify`) remain partial — track in follow-up if rescoped.
