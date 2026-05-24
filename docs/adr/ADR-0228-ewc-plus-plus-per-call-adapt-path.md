---
status: proposed
date: 2026-05-24
tags: [learning, sona, ewc, micro-lora, lora, wasm, ruvector, ruvllm, catastrophic-forgetting, audit-followup]
supersedes: []
depends-on: [0220]
implements: []
---

# EWC++ on the per-call adapt path (`ruvllm_microlora_adapt`)

> **Proposal — implementation split out of ADR-0220 per the 2026-05-22
> Option-A decision.** ADR-0220 closed the *honesty half* of F-05-007 by
> documenting `SonaConfig.ewcLambda` / `LearningBridge.ewcLambda` as
> background-only. This ADR proposes the *implementation half*: how (and
> whether) to wire EWC++ catastrophic-forgetting protection into the per-call
> path so that the contract advertised by `ewcLambda`'s name applies on every
> `adapt`, not only during the hourly background consolidation cycle. The
> recommendation below is **Option C** — a hybrid (per-call accumulates,
> background applies EWC) — because the dimensional / artefact / signal-quality
> constraints flagged in *Considered Options* are real and not trivially
> closed by direct wiring.

## Context and Problem Statement

ADR-0220's audit finding **F-05-007 [HIGH]** identified a contract gap on the
per-call MicroLoRA adapt path:

- The TS-side `ruvllm_microlora_adapt` MCP tool
  (`forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/ruvllm-tools.ts:340-357`)
  routes to `MicroLoraWasm.adapt`
  (`forks/ruflo/v3/@claude-flow/cli/src/ruvector/ruvllm-wasm.ts:259-307`).
- That path **does not consult EWC++**.
- EWC++ is fully implemented in
  `forks/ruvector/crates/sona/src/ewc.rs` and is invoked **only** by the
  background consolidation loop
  (`forks/ruvector/crates/sona/src/loops/background.rs:144-174`).
- `SonaConfig.ewcLambda`'s docstring (now amended in ADR-0220) used to imply
  EWC affects every `adapt`; per-call adapts in fact use only the LoRA gradient
  accumulator with no catastrophic-forgetting protection.

ADR-0220 chose **Option A — Per-handler honesty pass + EWC contract
clarification (chosen)** and explicitly *split the EWC++ implementation out*
into its own future ADR (this one), citing two constraints:

1. The Rust `MicroLoRA` in
   `forks/ruvector/crates/sona/src/lora.rs:192-229`
   (`accumulate_gradient`, `apply_accumulated`) would need to consult
   `EwcPlusPlus::apply_constraints` somewhere on the per-call codepath.
2. The WASM-published `MicroLoraWasm` is a separate artefact (`@ruvector/ruvllm-wasm`
   per `ruvllm-wasm.ts:269`) that the per-call path imports independently of
   `@ruvector/sona`'s coordinator. Wiring EWC into the per-call path therefore
   touches a different distribution boundary than the background cycle does.

This ADR proposes the implementation path. **No code is changed by this ADR**
— it is a decision document; the implementation lands in a follow-on session.

### Additional constraints surfaced during direct review (2026-05-24)

Walking the live ruvector source surfaced four constraints that the original
F-05-007 framing did not fully spell out. Naming them up-front because they
shape the option matrix:

- **C-1: EWC's Fisher is sized for BaseLoRA, not MicroLoRA.**
  `LoopCoordinator::with_config` at
  `forks/ruvector/crates/sona/src/loops/coordinator.rs:47-51` initialises
  `EwcPlusPlus` with `param_count = hidden_dim * base_lora_rank * 2`. With
  default `base_lora_rank = 4`, that's ~8× larger than MicroLoRA's parameter
  count (`hidden_dim * micro_lora_rank * 2` with `micro_lora_rank ∈ {1,2}`).
  `EwcPlusPlus::apply_constraints` (`ewc.rs:216-247`) returns `gradients.to_vec()`
  unchanged when sizes mismatch — i.e. **wiring the existing EWC into
  MicroLoRA naively would be a silent no-op**.
- **C-2: EWC++ currently constrains the BaseLoRA flow only.**
  In `background.rs:140-166` the constrained gradient flows into
  `update_base_lora(&constrained_gradients)` — there is no analogous
  `update_micro_lora` path. The constrained gradient does not flow into the
  micro accumulator today, by design (per the two-tier doc-comment at
  `lora.rs:1-5`: "MicroLoRA: Rank 1-2, per-request adaptation; BaseLoRA: Rank
  4-16, background adaptation"). EWC was scoped to the slow tier on purpose.
- **C-3: The TS per-call path passes a *placeholder* input, not a real gradient.**
  `ruvllm-wasm.ts:288` constructs
  `new Float32Array(Math.max(config.inputDim, MICROLORA_WASM_MIN_DIM))`
  (a zero-filled buffer) and passes that to `MicroLoraWasm.adapt(input, feedback)`.
  Whatever gradient EWC would constrain is computed *inside* the WASM call from
  `quality` + `learningRate` + `success` — i.e. the per-call path doesn't
  control a meaningful gradient vector from TS. Wiring EWC++ here means
  reasoning about a gradient that's synthesised inside the Rust/WASM
  `accumulate_gradient` path, not one the caller supplied.
- **C-4: `MicroLoraWasm` is republished from `@ruvector/ruvllm-wasm`,
  not `@ruvector/sona`.** ADR-0220 surfaced this. Confirmed at
  `ruvllm-wasm.ts:269` (`await import('@ruvector/ruvllm-wasm')`). The WASM
  artefact is built from `crates/ruvector-learning-wasm/src/lora.rs`, **not** from
  the `crates/sona/src/lora.rs` audited by F-05-007. Whether the same EWC++ type
  is even available in the WASM artefact's compilation unit needs to be checked
  before *any* of the options below ship. (See *Open questions*.)

## Decision Drivers

- **Correctness — catastrophic forgetting prevention.** When the contract
  promises EWC protection on `adapt`, callers reasonably expect their
  accumulated learning to be preserved across distribution shifts. Today the
  per-call path provides none.
- **Consistency with the background path.** Whatever EWC++ does in
  `background.rs:140-166` (apply constraints → update Fisher → update task
  memory) should be reflected on the per-call path if EWC is to apply there.
- **[[feedback-no-fallbacks]] — silent no-ops are anti-pattern.**
  C-1 means a naïve wire-up would silently no-op every call (dim mismatch
  triggers the `gradients.to_vec()` early-return at `ewc.rs:217-219`). That
  would be ADR-0210 stub honesty applied negatively — *exactly* the regression
  ADR-0220 fixed for the TS surface.
- **Minimal-surface-change to `MicroLoraWasm`.** The WASM artefact is a
  separate distribution; coordinated republishes of `@ruvector/ruvllm-wasm`
  + `@ruvector/sona` should be avoided unless the value justifies the blast
  radius.
- **[[feedback-trunk-only-fork-development]] + [[feedback-corpus-evidence-before-feature-work]].**
  The audit flagged a contract gap; it did **not** demonstrate observed
  catastrophic forgetting on a real per-call consumer. Building Rust+WASM
  infra for a hypothetical failure mode without corpus evidence is the
  pattern feedback-corpus-evidence warns against.
- **ADR-0193's EWC contract reference.** Per ADR-0220 *More Information*
  line 325, ADR-0193 is the EWC contract reference. Whatever this ADR decides
  must not contradict ADR-0193's stated semantics. (ADR-0193 is referenced
  rather than re-read here; the implementer should re-verify alignment.)

## Considered Options

### Option A — Wire EWC++ into `MicroLoRA::accumulate_gradient` directly

Modify `forks/ruvector/crates/sona/src/lora.rs` so `MicroLoRA::accumulate_gradient`
takes (or has access to) an `&EwcPlusPlus` and applies
`ewc.apply_constraints(&gradient_vec)` before adding the result into
`self.grad_up`. Republish `@ruvector/ruvllm-wasm` so `MicroLoraWasm.adapt`
threads through the constrained path.

To make this work without hitting C-1, EWC++ must be instantiated **separately
for the MicroLoRA tier** with `param_count = hidden_dim * micro_lora_rank * 2`,
either alongside the existing BaseLoRA-scoped instance or as a single
shared-but-tier-aware structure.

- Good, because closes the contract gap directly: every per-call `adapt`
  consults EWC.
- Good, because the WASM republish boundary is clean (a single artefact bump
  + a sona crate bump).
- Bad, because requires net-new Rust infra in `lora.rs` *and* changes the
  `EwcPlusPlus` ownership model (currently `Arc<RwLock<EwcPlusPlus>>` lives in
  `LoopCoordinator`, not in the `InstantLoop` that owns MicroLoRA — see
  `coordinator.rs:67-77` vs. `instant.rs:60-75`). A per-call EWC consult
  requires either threading a coordinator handle into the instant loop or
  duplicating EWC ownership.
- Bad, because of C-3: with a placeholder input, the gradient being
  constrained is itself synthesised inside the call from `quality` — the
  constraint operates on a signal the caller did not author. The *value* of
  EWC protection is therefore tied to the meaningfulness of that synthesised
  gradient.
- Bad, because the per-call hot-path now does an `EwcPlusPlus::apply_constraints`
  pass on every `adapt` — `ewc.rs:216-247` iterates `task_memory.len() *
  param_count + param_count` slots. For micro-tier sizing (~`hidden_dim * 2`)
  this is cheap, but it's still a per-call cost on a path advertised as
  "<100μs" (`lora.rs:5`).

### Option B — Per-call path stays without EWC++; document the contract narrowly

This is the **closed honesty half from ADR-0220**: keep the per-call path as-is;
keep the doc updates that clarify `ewcLambda` affects only the background
cycle. No code changes; ADR-0220's 2026-05-23 amendment closes this option.

- Good, because zero implementation risk; the contract is now honest.
- Good, because preserves the two-tier design intent (`lora.rs:1-5`: instant
  tier is for ultra-low latency; EWC is for the slow tier).
- Bad, because callers who *want* catastrophic-forgetting protection on every
  adapt have no API surface to opt in. They can pay the background cycle's
  cadence (hourly) but not per-call.
- Neutral, because this is already shipped under ADR-0220; selecting it here
  is equivalent to *closing this ADR as superseded by ADR-0220*.

### Option C — Hybrid: per-call accumulates without EWC++; background applies EWC++ to the accumulated state (recommended)

Leave `MicroLoRA::accumulate_gradient` and `apply_accumulated` unchanged on the
per-call path. Add a new pathway in the background cycle: when
`background.rs:run_cycle` runs, drain *both* trajectories (existing behaviour)
*and* the pending MicroLoRA gradient accumulator state; run that accumulator
state through `EwcPlusPlus::apply_constraints` before letting MicroLoRA
`apply_accumulated`; OR more conservatively, schedule a periodic
`micro.apply_constrained(&ewc)` that the background loop owns.

This preserves the per-call hot-path's <100μs target *and* gives the micro tier
EWC protection at the cadence the rest of the system already pays for.

Implementation sketch (subject to C-1/C-2/C-4 verification — see *Open questions*):

1. Add a method `MicroLoRA::apply_accumulated_constrained(&mut self, lr: f32,
   ewc: &EwcPlusPlus)` in `lora.rs` next to `apply_accumulated` (`lora.rs:213-229`).
   It runs `ewc.apply_constraints(&self.grad_up)` then applies the constrained
   gradient just as `apply_accumulated` does today.
2. In `LoopCoordinator::maybe_run_background` (`coordinator.rs:92-105`), after
   the existing `background.run_cycle` returns, call
   `instant.micro_lora().write().apply_accumulated_constrained(lr, &ewc.read())`.
   (Today the instant loop auto-flushes via `flush_threshold`; this would
   add a coordinated flush at the background cadence as well.)
3. Add a config knob `micro_ewc_at_background_cycle: bool` so the behaviour
   is opt-in initially.

- Good, because per-call latency is unchanged (instant tier stays as fast as
  today).
- Good, because the EWC machinery (Fisher, task memory) stays single-tenant —
  no separate micro-tier EWC instance, no C-1 dim-mismatch trap to navigate.
  *Note:* this only works if the micro and base gradient vectors can share an
  EWC instance, which requires either (a) projecting the micro gradient up to
  base's `param_count`, or (b) accepting that the constraint applies to the
  micro `grad_up` vector with a separate Fisher sized for it. This needs
  verification before implementation — see *Open questions*.
- Good, because the WASM-side `MicroLoraWasm` surface is unchanged: `adapt`
  remains unchanged at the TS boundary; the EWC consult happens entirely on
  the sona-coordinator side.
- Bad, because the contract is still "EWC at background cadence, not per-call"
  — callers expecting protection *between* background ticks still don't get
  it. This is a partial mitigation, not a full fix of F-05-007's contract gap.
- Neutral, because the doc clarification from ADR-0220 stays accurate
  (`ewcLambda` *primarily* affects the background cycle); ADR-0228 would
  narrow the gap from "background-only" to "at-background-cadence,
  including micro-tier."

### Option D — Defer further; act only on observed catastrophic forgetting

Close this ADR as deferred. Wait until a real consumer of
`ruvllm_microlora_adapt` demonstrates measurable catastrophic forgetting in
production (e.g. a SONA trajectory regression after sustained adapts on a
shifted task distribution). Then revisit with concrete failure data and
decide between A/C.

- Good, because matches [[feedback-corpus-evidence-before-feature-work]]:
  no observed failure → no infra build-out.
- Good, because the honesty half (ADR-0220) is shipped — there is no
  *silent* misadvertisement remaining; users who care can read the doc.
- Bad, because if/when a consumer hits the failure mode, recovery is harder
  than prevention (forgotten weights are not recoverable without retraining).
- Bad, because leaves the contract noise (EWC is described as protecting
  "every adapt" by audience expectation, even after the honesty doc fix —
  the doc fix is in the source, not in audience priors). Repeated audit
  passes may keep re-finding this until it's structurally fixed.

### Option E — Move MicroLoRA out of the EWC-aware coordinator entirely; document EWC as base-tier-only (and rename `ewcLambda`)

Rename `SonaConfig.ewcLambda` to `SonaConfig.baseLoraEwcLambda` (or similar),
and update the docstring and external advertising to make EWC's tier scope
unambiguous from the field name. No behavioural change; the rename is the fix.

- Good, because removes the naming ambiguity that caused F-05-007 to be flagged
  HIGH (the docstring promised more than the impl delivered).
- Good, because zero runtime risk.
- Bad, because this is a config-surface rename across `@ruvector/sona`,
  `@ruvector/ruvllm-wasm`, `forks/ruflo/v3/@claude-flow/cli`, and any
  `init`-generated configs. Renames have non-trivial blast radius.
- Bad, because it accepts the contract gap as permanent and pushes the
  resolution to naming, not behaviour. If a consumer *needs* per-call
  protection, this option doesn't deliver it.

### Discarded variants

- **A′** — Add a *second* `EwcPlusPlus` instance sized for the micro tier and
  thread it into the `InstantLoop`. Functionally an Option-A variant; called
  out only because the dim mismatch (C-1) makes it tempting. Carries Option A's
  cost plus EWC-state-duplication complexity. Not recommended unless an
  Option-A implementer concludes a single shared instance can't span tiers.
- **A″** — Apply EWC constraints in the WASM-side `MicroLoraWasm` (in
  `crates/ruvector-learning-wasm`) instead of `crates/sona`. Closer to the
  actual call-site but moves EWC machinery into the WASM artefact, which
  expands the WASM bundle and forks the EWC implementation across two crates.
  Rejected by inspection.

## Decision Outcome

**Recommended: Option C — Hybrid (per-call accumulates without EWC++;
background applies EWC++ to the accumulated micro state at the background
cadence). Opt-in via `micro_ewc_at_background_cycle: bool` config.**

Rationale: Option C is the best fit for the constraint stack:

- Preserves the per-call <100μs target (lora.rs:5 design intent).
- Doesn't touch the `MicroLoraWasm` distribution boundary (C-4) — no WASM
  republish coordinated with sona crate.
- Reuses the existing single `EwcPlusPlus` instance owned by `LoopCoordinator`
  (mitigates C-1 / C-2 instead of duplicating EWC machinery).
- Gives callers protection at the same cadence they already accept for
  background learning — a strict improvement over Option B (today's shipped
  state) without the Option A cost.
- Is reversible: behind a config flag, default-off until corpus evidence
  warrants default-on (aligns with [[feedback-corpus-evidence-before-feature-work]]).

Option C is *not* a full fix of F-05-007's contract gap (callers wanting
between-background-tick protection still don't get it). If a consumer surfaces
that need with concrete failure data, escalate to Option A in a follow-on
ADR — Option C does not preclude Option A.

### Implementation steps (for the follow-on session)

1. **Verify open questions below** (see *Open questions*) before touching
   `lora.rs`. In particular, confirm that the `EwcPlusPlus` constructed at
   `coordinator.rs:47-51` with `param_count = hidden_dim * base_lora_rank * 2`
   can be re-used over a micro gradient sized `hidden_dim * micro_lora_rank * 2`
   *without* tripping the dim-mismatch no-op at `ewc.rs:217-219`. If not,
   construct a second EWC instance sized for the micro tier (A′-style) and
   thread it into the coordinator.
2. **Add `MicroLoRA::apply_accumulated_constrained`** in
   `forks/ruvector/crates/sona/src/lora.rs` next to `apply_accumulated`
   (`:213-229`).
3. **Add coordinator-level wiring** in
   `forks/ruvector/crates/sona/src/loops/coordinator.rs`'s
   `maybe_run_background` (`:92-105`) and `force_background` (`:108-111`).
4. **Add config knob** `SonaConfig.micro_ewc_at_background_cycle: bool`
   (default `false`).
5. **Bump `@ruvector/sona`** crate version; `@ruvector/ruvllm-wasm` does
   **not** need rebuild for Option C (verify this is still true after step 1).
6. **TS surface untouched**: no change to `ruvllm-wasm.ts:259-307` or
   `ruvllm-tools.ts:340-357`. The per-call MCP tool's `tools/list`
   description remains the ADR-0220 honest version ("EWC at background
   cadence, not per call").
7. **Acceptance test (Rust)**: add a test in
   `forks/ruvector/crates/sona/src/loops/coordinator.rs`'s `tests` module
   that:
   - Enables `micro_ewc_at_background_cycle`.
   - Drives N adapts (accumulating micro grad).
   - Forces a background cycle.
   - Asserts the micro `up_proj` post-cycle differs from the unconstrained
     `apply_accumulated` baseline — the EWC constraint actually mutated the
     applied gradient.
8. **Acceptance test (TS, optional)**: extend the existing ADR-0220 test file
   `tests/unit/controllers/adr0220-learning-honesty.test.ts` (or a sibling)
   with a behavioural assertion that under default config, the per-call MCP
   `ruvllm_microlora_adapt` tool still does *not* trigger EWC consult — i.e.
   the opt-in default is preserved.
9. **Commit** following [[feedback-commit-forks-before-release]] — fork
   changes committed *before* any `npm run release`.

### Consequences

- Good, because the per-call hot path stays fast.
- Good, because EWC machinery stays single-coordinator (no state duplication).
- Good, because behind an opt-in flag, so existing consumers see no behavioural
  change unless they elect in.
- Bad, because callers expecting *strict* per-call EWC protection still don't
  get it — only at-background-cadence. The full F-05-007 fix awaits an
  Option A follow-on if corpus evidence demands it.
- Bad, because adds a config knob to `SonaConfig` (an `init`-generated surface);
  the rollout must include the `init` template update.
- Neutral, because no INTEGRATION-LEDGER row — this is net-new fork-local
  infra, not an upstream hand-port.

### Confirmation

This ADR is closed when:

1. **Open questions (below) are answered in writing** — either in this ADR's
   amendment block or in the implementation-session ADR.
2. **`MicroLoRA::apply_accumulated_constrained` exists** in
   `forks/ruvector/crates/sona/src/lora.rs` and has a unit test asserting
   it differs from `apply_accumulated` when EWC has accumulated Fisher.
3. **Coordinator wiring exists** in
   `forks/ruvector/crates/sona/src/loops/coordinator.rs`'s
   `maybe_run_background` / `force_background`, gated on
   `SonaConfig.micro_ewc_at_background_cycle`.
4. **A behavioural test in `crates/sona`** demonstrates that the
   constrained-apply path mutates `up_proj` differently than the
   unconstrained path (i.e. EWC is not silently no-op'ing on dim mismatch
   per C-1).
5. **`@ruvector/sona` crate bump shipped** to Verdaccio; `@ruvector/ruvllm-wasm`
   *not* bumped (Option C does not require it).
6. **ADR-0220's amendment block updated** to note that F-05-007's per-call
   implementation half landed via this ADR (or is explicitly still deferred,
   if a future session decides Option C wasn't enough and escalates to A).

## Pros and Cons of the Options

### Option A — Direct wire into MicroLoRA accumulate

- Good: closes the contract gap fully (every per-call adapt consults EWC).
- Bad: net-new Rust + WASM republish coordinated change; per-call latency cost;
  C-1 / C-3 require non-trivial design work.

### Option B — Stay as-is; document narrowly

- Good: shipped (ADR-0220); zero risk.
- Bad: no opt-in path for callers who want per-call protection.

### Option C — Hybrid (recommended)

- Good: preserves hot path, single EWC instance, opt-in, reversible.
- Bad: partial fix — between-background-tick adapts unprotected.

### Option D — Defer entirely

- Good: matches corpus-evidence-before-feature-work; no infra debt.
- Bad: prevention is cheaper than recovery from forgotten weights.

### Option E — Rename `ewcLambda` to make tier scope explicit

- Good: cheap; removes the misadvertisement at the field-name level.
- Bad: config-surface rename with multi-fork blast radius; accepts gap as permanent.

## Open questions (must be answered before Option C implementation)

These are constraints I could not fully resolve from a 30-minute read of the
ruvector source. The implementation-session ADR (or this ADR's amendment)
must close them:

1. **Q-1 (C-1 resolution).** Can the `EwcPlusPlus` instance constructed at
   `coordinator.rs:47-51` (`param_count = hidden_dim * base_lora_rank * 2`,
   default ~8× MicroLoRA size) actually constrain a MicroLoRA `grad_up`
   vector? At `ewc.rs:217-219` the constraint returns the gradient unchanged
   on dim mismatch — so unless we (a) project the micro gradient into the
   base's parameter space, (b) construct a second EWC instance sized for the
   micro tier, or (c) re-size the existing instance to span both, **Option C
   would silently no-op**. Recommended path: (b), a second instance — keeps
   tier semantics clean, costs a few KB.
2. **Q-2 (EWC artefact in WASM compilation unit).** Is `EwcPlusPlus` even
   present in the WASM artefact built from
   `crates/ruvector-learning-wasm/src/lora.rs`, or only in the native sona
   crate? If only native, Option A would require duplicating EWC into the
   WASM crate. (Option C sidesteps this by keeping EWC consults inside the
   sona coordinator, not the WASM artefact — verify that's still true.)
3. **Q-3 (gradient signal quality on per-call path).** Per C-3, the per-call
   TS path passes a zero-filled placeholder input; the gradient is
   synthesised inside `accumulate_gradient` from
   `signal.quality_score * signal.gradient_estimate[i]` (`lora.rs:204`).
   Where does `signal.gradient_estimate` come from on the per-call path?
   `from_trajectory` in the instant loop derives one from a real trajectory,
   but the per-call MCP path doesn't pass a trajectory — it passes
   `(quality, learningRate, success)`. The implementer must trace
   `AdaptFeedbackWasm` → `LearningSignal` to confirm there's a meaningful
   gradient for EWC to constrain on this path, OR conclude that EWC
   protection on a synthesised-from-scalar gradient is theatre.
4. **Q-4 (ADR-0193 contract alignment).** ADR-0193 is the EWC contract
   reference per ADR-0220. Re-read it before implementation and confirm
   Option C does not contradict its stated semantics. If ADR-0193 promises
   strict per-call EWC, Option C is the wrong recommendation and Option A
   becomes mandatory.

If Q-1 or Q-3 resolves negatively (no meaningful gradient or no clean way to
size EWC for the micro tier), **escalate to Option D (defer)** rather than
shipping a no-op.

## More Information

- **Parent ADR:** [ADR-0220](ADR-0220-learning-controllers-honesty-pass.md) —
  honesty half of F-05-007; this ADR is the split-out implementation half.
- **EWC contract reference:** ADR-0193 (per ADR-0220 *More Information* line 325).
  Confirm alignment before implementation.
- **Source file references:**
  - `forks/ruvector/crates/sona/src/lora.rs:13` — `MicroLoRA` struct
  - `forks/ruvector/crates/sona/src/lora.rs:192-210` — `accumulate_gradient`
    (per-call hot path; currently no EWC consult)
  - `forks/ruvector/crates/sona/src/lora.rs:213-229` — `apply_accumulated`
    (the unconstrained applier this ADR proposes mirroring with a
    `_constrained` variant)
  - `forks/ruvector/crates/sona/src/lora.rs:307-422` — `BaseLoRA` (the slow
    tier EWC currently protects)
  - `forks/ruvector/crates/sona/src/loops/instant.rs:60-128` — `InstantLoop`,
    owner of the MicroLoRA; per-call flow through `on_trajectory` →
    `accumulate_gradient`
  - `forks/ruvector/crates/sona/src/loops/background.rs:140-178` — the
    *existing* EWC++ invocation in the slow tier (Loop B)
  - `forks/ruvector/crates/sona/src/loops/coordinator.rs:47-77` —
    `LoopCoordinator::with_config` constructs the single `EwcPlusPlus`
    instance and owns the `Arc<RwLock>`
  - `forks/ruvector/crates/sona/src/ewc.rs:216-247` —
    `EwcPlusPlus::apply_constraints`, the dim-mismatch silent-no-op site (C-1)
  - `forks/ruvector/crates/sona/src/engine.rs:69-77` — `apply_micro_lora`
    (per-call entry that does NOT route through EWC)
  - `forks/ruflo/v3/@claude-flow/cli/src/ruvector/ruvllm-wasm.ts:259-307` —
    TS-side `createMicroLora` wrapper; per-call `adapt` at `:283-290` passes
    a placeholder zero-filled input (C-3)
  - `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/ruvllm-tools.ts:340-357` —
    the `ruvllm_microlora_adapt` MCP tool the audit flagged
- **Memory references:**
  - [[feedback-no-fallbacks]] — silent no-op anti-pattern (C-1 trap).
  - [[feedback-corpus-evidence-before-feature-work]] — supports the opt-in,
    default-off recommendation in Option C; supports Option D as fallback if
    open questions resolve negatively.
  - [[feedback-trunk-only-fork-development]] — confirms trunk-only rollout.
  - [[feedback-commit-forks-before-release]] — implementation discipline.
- **No INTEGRATION-LEDGER row** — fork-local Rust infra, not an upstream
  hand-port.

## Amendment — 2026-05-24 (Q-1 and Q-3 verified from source)

Two of the four open questions from the original proposal were
verified against the live ruvector source. Findings change the
implementation calculus.

### Q-1 — Fisher matrix dimensional mismatch (CONFIRMED)

`coordinator.rs:47-48`:

```rust
let ewc = Arc::new(RwLock::new(EwcPlusPlus::new(EwcConfig {
    param_count: config.hidden_dim * config.base_lora_rank * 2,
    ...
})));
```

`ewc.rs:217-219`:

```rust
pub fn apply_constraints(&self, gradients: &[f32]) -> Vec<f32> {
    if gradients.len() != self.config.param_count {
        return gradients.to_vec();
    }
    ...
}
```

With `base_lora_rank = 4` (default) and `micro_lora_rank ∈ {1, 2}`,
the Fisher matrix is sized 2-4× larger than MicroLoRA's gradient
vector. Wiring the existing `EwcPlusPlus` into `MicroLoRA::accumulate_gradient`
naively returns `gradients.to_vec()` unchanged — a **silent no-op**.

**Resolution:** Option C implementation MUST construct a **second
`EwcPlusPlus` instance** sized `hidden_dim * micro_lora_rank * 2`
for the micro tier. Sharing the base-tier Fisher is not viable.

### Q-3 — TS per-call path passes a zero placeholder (BIGGER FINDING)

`ruvllm-wasm.ts:283-289`:

```ts
adapt(quality: number, learningRate = 0.01, success = true): void {
  const feedback = new mod.AdaptFeedbackWasm();
  feedback.quality = quality;
  feedback.learningRate = learningRate;
  try { (feedback as any).success = success; } catch { /* v2.0.2 quirk */ }
  const input = new Float32Array(Math.max(config.inputDim, MICROLORA_WASM_MIN_DIM));
  lora.adapt(input, feedback);
},
```

`input` is a fresh `Float32Array` with no values written — every
element is `0.0`.

`crates/ruvllm-wasm/src/micro_lora.rs:341-373`:

```rust
fn accumulate_gradient(&mut self, input: &[f32], quality: f32) {
    // intermediate[r] = sum of input[i] * lora_a[i*rank+r] over i
    // grad_b[idx] += intermediate[r] * reward * scaling * 0.01
    // grad_a[idx] += input[i] * reward * scaling * 0.01
    ...
}
```

When `input` is all-zero:

- `intermediate[r] = 0` for all r → `grad_b` not updated
- `grad_a[idx] += 0 * reward * scaling * 0.01 = 0` → `grad_a` not updated

**The TS-side per-call `adapt()` is currently a no-op end-to-end.**
The quality feedback is consumed but produces zero gradient because
the input vector is zero. Whether EWC++ is wired in or not is
**moot for this path** — there is no meaningful gradient to
constrain.

### What this means for the implementation

The proposed Option C (Hybrid) is **still the right call** —
arguably more so given Q-3:

- Per-call accumulates without EWC++ ✓ (and currently
  accumulates *nothing* because input is zero, so EWC would be
  applied to a zero gradient).
- Background applies EWC++ to accumulated state ✓ (this is where
  real adaptation happens via `coordinator.rs:60-65` ->
  `BackgroundLoop` -> `lora.rs:459 accumulate_micro`).
- Q-1's second EWC instance is needed if/when the background's
  micro tier becomes the consumer.

BUT — Option C's primary value (catastrophic-forgetting protection
on per-call adapts) **cannot be delivered until Q-3 is fixed**.
The per-call path needs either:

  (a) Receive the actual input context the adapt is targeting,
      not a zero placeholder. This means restructuring the TS API
      to take an `input: Float32Array` parameter on `adapt()`.
      Caller obligation.
  (b) Be renamed/redocumented as "register quality feedback for
      later batch processing" — honest about its actual semantics
      — and the EWC++ wiring deferred until (a) is the chosen
      remediation path.

### Revised recommendation

**Defer Option C implementation** until **Q-3 is independently
resolved** — i.e. until a separate ADR addresses the TS per-call
adapt's zero-input issue. Wiring EWC++ onto a path that produces
zero gradients adds machinery for no behaviour change; it's
performance overhead without correctness gain.

Once Q-3 is resolved (path either takes real input OR is renamed
to honest semantics), Option C can be implemented with Q-1's
second EwcPlusPlus instance.

**Q-2 (WASM artefact EWC availability) and Q-4 (ADR-0193
alignment) remain open** — investigation deferred to the
implementation session.

### Status update

ADR-0228 stays `proposed`. The implementation path is clearer
(Option C with a second EWC instance for the micro tier), but
the prerequisite (Q-3 resolution: TS path receives real input)
is its own work item outside this ADR's scope. The TS placeholder
finding (Q-3) should be tracked as a separate audit follow-up —
it predates this ADR and isn't fixed by Option C's wiring.

No code change in this amendment — pure research findings. Doc-only.
