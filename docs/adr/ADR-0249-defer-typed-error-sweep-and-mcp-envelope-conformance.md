---
status: accepted
date: 2026-05-24
tags: [errors, mcp, advisory-baseline, deferred-work]
supersedes: []
depends-on: [ADR-0242]
implements: []
---

# Defer typed-error sweep and MCP envelope conformance pending usage data

## Context and Problem Statement

ADR-0242 (Batch 5, second-pass remediation) shipped the `@claude-flow/errors` package and two advisory-first lints that fired against the fork at the time of landing:

- `check-throw-new-error.mjs` — 887 bare `throw new Error(...)` sites in `forks/ruflo/v3/**`, 781 unique after content-key dedup.
- `check-mcp-handler-fatal-throw.mjs` — 61 MCP tool handlers that throw fatally instead of returning the protocol-conformant `{isError: true, content: [...]}` envelope.

Both lints exit `0` (advisory) and the per-call counts are baselined in:

- `lib/throw-new-error-allowlist.txt`
- `lib/mcp-handler-fatal-throw-allowlist.txt`

ADR-0242 §"Erosion-vs-rot disposition" parked the actual remediation deliberately: the count + content-keyed entries together produce a two-signal future-cycle check (erosion = new bare throws appearing; rot = baselined entries' surrounding code drifting). Driving the count to zero **now** collapses both signals and forces design decisions (which RufloErrorCode for each site? which handlers' throw shape is observable contract?) without the usage data that would inform them.

Post-Batch-5 housekeeping pass surfaced this as an explicit follow-up question: "do these now or defer?" This ADR records the deliberate defer.

## Decision Drivers

* **Signal preservation** — the erosion-vs-rot two-signal design only works while the baseline holds. Acting now permanently loses the signal for the cycle.
* **Code-design quality** — RufloErrorCode is a public-ish surface (downstream callers can switch on codes). Designing 781 unique codes cold (no usage data on which errors operators actually hit) means inventing them against speculation. Designing them against ~3 months of operator-reported failure modes means codes get named around real patterns.
* **MCP envelope behavioural change** — wrapping a `throw new Error` in `{isError: true, content: [{type: 'text', text: ...}]}` changes the *return value* the MCP client sees. Anywhere a caller wrote `try { tool() } catch (e) { ... }`, they now must check `if (result.isError)` instead. Subtly breaks callers that aren't covered by the existing tests.
* **Real scope** — 887 throws × ~1–3 min triage per site = 15–40 agent-hours of work. Even with 4 parallel coders, 200+ sites each is multi-session, and a single coder making a hasty "I'll just allowlist everything" decision wipes the value entirely.
* **Momentum vs care tradeoff** — momentum says do it now (typed-error library fresh in mind, lints just landed). Care says do it later (with usage data; with operator reports to anchor code design).

Care wins because the lints are non-blocking AS-DESIGNED. The cost of waiting is zero — the lints don't gate any release; they only report. The cost of acting hastily is permanent (bad code-name choices propagate; broken callers from envelope changes need debugging).

## Considered Options

* **Option A — Defer to next cycle, capture as ADR (this ADR)** — preserve erosion/rot signal; let usage data inform code design; revisit when re-evaluation triggers fire.
* **Option B — Drive count down now via parallel-coder sweep** — fork 4 coders; each takes ~200 sites; triage convert-vs-allowlist; ship. Loses signal; takes multi-session time; risks under-considered code-name design.
* **Option C — Drive count down in stages (e.g., handler envelopes first, throws later)** — partial signal preservation, smaller batch. Still designs codes cold; envelope changes still need caller-side updates.
* **Option D — Tighten the lints to error-on-new-entries (block additions, allow existing baseline)** — keeps the baseline for free; gates future erosion immediately. Doesn't help rot detection.

## Decision Outcome

Chosen option: **"Option A — Defer to next cycle, capture as ADR"**, because the lints' value is the two-signal future-cycle check, which only works if the baseline holds. The momentum case for acting now (typed-error library fresh, lints just landed) does not offset the permanent loss of signal + the risk of inventing 781 error codes against speculation rather than usage data.

Option D is recorded as a secondary follow-up for the re-evaluation trigger window — promote both lints from advisory to error-on-new-entries at the same time the cleanup sweep is scheduled.

### Re-evaluation triggers

This ADR is revisited and the cleanup work scheduled when ANY of the following holds:

1. **Operator-reported error volume** — `≥10` distinct operator-reported failures over a single cycle that name a bare-throw site as the root cause. The error sites surface organically; that's the design data we lack today.
2. **MCP client breakage from envelope mismatch** — `≥3` client-side issues filed against fork against the 61 fatal-throw handlers (caller expected `isError` envelope, got thrown exception). Confirms the handler set's protocol-conformance gap is observable.
3. **Erosion crossed** — `check-throw-new-error.mjs` count grows by `≥10%` (888 → ~975+) cycle-over-cycle. Crossing the threshold means the typed path isn't being used for *new* code, which means the baseline is stale evidence regardless.
4. **Major upstream sync resets the baseline** — upstream merges add ≥100 new `throw new Error` sites in one sync, swamping the baseline's signal value. At that point the baseline is gone whether we want it to be or not, so reset + sweep + re-baseline.

If NONE of these fire over ~3 months, this ADR stays in `accepted` status and the work stays deferred.

### Consequences

* Good, because the erosion-vs-rot two-signal design (per ADR-0242 §"Erosion-vs-rot disposition") stays intact for the next cycle's audit.
* Good, because RufloErrorCode design isn't anchored to 781 speculative codes invented without usage data; the eventual sweep gets to design against real operator-reported failure modes.
* Good, because the 61 MCP handlers' fatal-throw → isError envelope migration isn't rushed; caller-side updates can be done atomically with the handler change.
* Good, because zero release-pipeline impact — the lints are advisory-first by design; no gates move.
* Bad, because the typed-error path established by ADR-0242 (`@claude-flow/errors`) only has 2 consumers (the package itself + the gastown-bridge shim). Adoption is essentially zero until the sweep happens.
* Bad, because the MCP protocol-conformance gap for the 61 handlers means MCP clients can't programmatically distinguish "tool call failed" from "tool returned data" via the standard envelope. Tool consumers (Claude, third-party MCP clients) must rely on out-of-band error handling for those 61 surfaces.
* Bad, because the future-cycle sweep gets harder if the baseline grows materially during the deferral window — the cleanup scope inflates linearly.
* Neutral, because the deferral is itself an ADR-recorded decision; future sessions reading the corpus will see this artifact and not re-litigate the question without new evidence.

### Confirmation

Confirmation is the re-evaluation triggers themselves. Specifically:

1. `check-throw-new-error.mjs` continues to emit advisory counts; cycle-over-cycle delta is the erosion signal.
2. `check-mcp-handler-fatal-throw.mjs` continues to emit advisory counts; cycle-over-cycle delta on the 61-handler set is the protocol-conformance signal.
3. When any re-evaluation trigger fires, this ADR moves to `superseded by ADR-NNNN` where ADR-NNNN is the sweep-scheduling ADR. The supersedes-by edge is the durable confirmation that the deferral was honoured + retired through normal ADR succession.
4. If 3 months pass with none of the triggers firing, an audit-cycle ADR confirms "deferral remains in effect" — keeps the artifact visible without false motion.

## Pros and Cons of the Options

### Option A — Defer to next cycle, capture as ADR (chosen)

* Good, because preserves both signals (erosion + rot) for the cycle-over-cycle check.
* Good, because lets RufloErrorCode design accrete against real failure modes, not speculation.
* Good, because no release-pipeline disruption; the lints are advisory by design.
* Bad, because the @claude-flow/errors adoption flatlines at 2 consumers for the deferral window.
* Bad, because MCP protocol-conformance gap stays open for 61 handlers.

### Option B — Drive count down now via parallel-coder sweep

* Good, because momentum + library familiarity now would speed the work.
* Good, because the @claude-flow/errors package immediately gets ~700+ adoption sites, justifying its existence on the artifact axis.
* Bad, because permanently loses the erosion-vs-rot signal (the baseline goes from "887, watch for drift" to "0, no baseline").
* Bad, because designing 781 unique RufloErrorCode names cold means many codes get renamed/merged later as real failure modes surface.
* Bad, because 61 handlers' envelope migration changes return values — every test asserting the throw shape needs updating, and every uncovered caller silently breaks.
* Bad, because 15-40 agent-hours of work in a single push pressures the triage quality (the "I'll allowlist this" temptation grows).

### Option C — Drive count down in stages (handler envelopes first, throws later)

* Good, because the 61 handlers are a tractable scope (vs 887) and the envelope contract is well-defined per MCP spec.
* Good, because partial signal preservation — the bare-throw lint stays at baseline while the handler lint is acted on.
* Bad, because the handler envelope migration still needs caller-side care; doing it now without usage data risks the same breaking-change pattern.
* Bad, because the MCP-handler lint loses its baseline; only the bare-throw lint retains the two-signal check.

### Option D — Tighten the lints to error-on-new-entries (block additions, allow existing baseline)

* Good, because gates future erosion immediately; the baseline becomes a hard ceiling instead of a count.
* Good, because no code changes — pure lint config update.
* Bad, because doesn't help rot detection (entries that drift in place still pass).
* Bad, because conflates the future-sweep-scheduling decision with the immediate gate change; better to land the gate alongside the sweep, not orphaned.

## More Information

- [[ADR-0242]] — the shared error library + advisory-first lint baselines this ADR defers acting on.
- `forks/ruflo/v3/@claude-flow/errors/` — the typed-error package created in Batch 5; current consumers: `@claude-flow/errors` itself + `gastown-bridge/errors.ts` shim.
- `forks/ruflo/v3/@claude-flow/errors/README.md` — naming convention (`RUFLO_E_*`) documented for the eventual sweep.
- `ruflo-patch/scripts/check-throw-new-error.mjs` + `ruflo-patch/lib/throw-new-error-allowlist.txt` — the 887-site baseline.
- `ruflo-patch/scripts/check-mcp-handler-fatal-throw.mjs` + `ruflo-patch/lib/mcp-handler-fatal-throw-allowlist.txt` — the 61-handler baseline.
- Session 2026-05-24 follow-up audit — the parent-session conversation that surfaced the question "do these now or defer?" and produced this ADR.
- [[ADR-0233]] §"Reviews still owed" — the second-pass parent rollup that names this work as carry-forward.

## Amendments

### Amendment (2026-06-10): MCP-envelope half described the lint backwards; baselines verified intact

Adversarial re-verification (8-agent swarm):

* **Typed-error half: intact and healthy.** `lib/throw-new-error-allowlist.txt`
  = 781 entries, untouched since landing commit `91a1eef` (no silent
  padding); live run 2026-06-10: 902 scanned / 17 delta — erosion +1.7%,
  well under the 10% trigger. `@claude-flow/errors` adoption remains exactly
  2 consumers, as the "flatline" consequence predicted. Both lints run on
  every release (`scripts/ruflo-publish.sh:646,656`) — the erosion trigger
  is REAL and tracked; triggers 1–2 (operator reports / client issues) have
  no intake surface (aspirational); the ~3-month window runs to ~2026-08-24.
* **MCP-envelope half: the body describes the rule INVERTED.** The Context
  (:17) and Consequences say 61 handlers "throw fatally instead of returning
  the protocol-conformant `{isError: true}` envelope" and defer a
  throw→envelope migration. The actual deferred artifact
  (`scripts/check-mcp-handler-fatal-throw.mjs:2-31`, per ADR-0242:48,101,107)
  enforces the OPPOSITE direction: **fatals must THROW** (the server wrap
  emits JSON-RPC `-32603`); the lint flags handlers that catch-and-RETURN
  `{success:false}` for fatals. The baseline is **20 grandfathered of 63
  found** (allowlist header), not 61; current: 66 found / 3 delta. The
  deferral itself remains valid — the deferred work is migrating the 20
  grandfathered catch-and-return handlers to throw (plus triaging the +3
  delta), not wrapping throws in envelopes. Read trigger 2 accordingly:
  client breakage would manifest as missing `-32603`s, not missing
  envelopes.
