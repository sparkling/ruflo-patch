---
status: proposed
date: 2026-06-08
tags: [ruvllm, microlora, validation, bug-fix, adapt-path]
supersedes: []
depends-on: [ADR-0231]
implements: []
---

# RuVLLM MicroLoRA `adapt`: reconcile inconsistent input-dimension validation

## Context and Problem Statement

The 2026-06-08 model-routing investigation (warm probes vs published
`@sparkleideas/cli@…patch.432`, ADR-0293 posture) **confirmed RuVLLM is real,
working local-inference + self-learning** — not the "EWC NaN / similarity 0 /
aspirational" red herring (that dismissal quoted *upstream* ADR-086, a different
package; the fork's per-call EWC++ adapt path shipped via [[ADR-0231]],
patch.292). A SONA `adapt(quality 0.9)` warm probe moved `quality_ema 0 → 0.52`
with **no NaN**, journaled cross-process and cross-session — the numeric path is
sound.

While probing, the agent found one **narrow, real validation bug** in
`ruvllm_microlora_adapt` (NOT a numeric/NaN problem): the input-dimension guard
reports **inconsistent expected dimensions across its two error branches.** For a
MicroLoRA adapter created with `inputDim = 8`:

* passing an **8-dim** input was rejected with `"expected 768, got 8"` — a *stale
  global 768* reference (the default embedding width), wrong for this adapter;
* passing a **64-dim** input was rejected with `"must match config.inputDim=8"` —
  the *correct per-instance* reference.

So one branch validates against a hard-coded 768 while the other validates against
the per-instance `config.inputDim`. The adapter's actual numeric path is fine;
this is purely a guard/error-message inconsistency that (a) emits a misleading
"expected 768" message and (b) risks the 768 branch mis-gating legitimately-small
adapters. It is the kind of stale-global-vs-per-instance desync noted in
`feedback-singleton-frozen-state-desync`.

## Decision Drivers

* Correctness + honesty of error reporting: a user sees "expected 768" for an
  adapter explicitly created at `inputDim=8` — confusing and wrong.
* Cheap, localised fix (one validation function, two branches) with a clear
  regression test.
* Keeps the (verified-good) numeric adapt path untouched.

## Considered Options

* **Reconcile both branches to per-instance `config.inputDim` (chosen).** Both
  error paths read the adapter's own `config.inputDim`; remove the stale 768
  literal.
* **Leave it** — rejected: misleading error + a latent mis-gate on small adapters
  is a real (if narrow) bug, and `feedback-no-squelch-tests` / honesty posture
  says fix root causes.
* **Default `inputDim` to 768 everywhere** — rejected: that contradicts the
  per-instance config the adapter was created with (MicroLoRA explicitly supports
  small adapter dims).

## Decision Outcome

Chosen: reconcile the dimension reference. Status `proposed`; no execution until
an explicit go-ahead.

### Tasks

* **T1 — Locate the two error branches** in the MicroLoRA `adapt` input-dimension
  validation (`@sparkleideas/ruvector-ruvllm` adapt path; the handler behind
  `ruvllm_microlora_adapt`).
* **T2 — Fix** both branches to read the per-instance `config.inputDim`
  consistently; delete the hard-coded `768` literal in the guard.
* **T3 — Regression test:** create an `inputDim=8` adapter, adapt with a wrong-dim
  input, assert the error references `config.inputDim=8` (not 768) on *both*
  the too-small and too-large input paths; confirm a correct `inputDim`-width
  input still adapts (numeric path unchanged).

### Consequences

* Good, because error messages match the adapter's real configured width and the
  guard stops mis-referencing 768.
* Good, because it closes the last "is RuVLLM actually working?" loose end with a
  fix rather than a dismissal.
* Neutral, because the verified numeric adapt/SONA path (quality_ema, EWC++) is
  untouched.

### Confirmation

The T3 regression test green: both error branches reference the per-instance
`config.inputDim`; a correct-width adapt still succeeds with a moving `quality_ema`
and no NaN.

## More Information

* [[ADR-0231]] — the per-call EWC++ adapt path (the real implementation this
  guard sits in front of); method [[ADR-0293]] (verify, don't assume broken).
* Evidence (2026-06-08 swarm): SONA adapt warm probe `quality_ema 0→0.52`, no
  NaN, journaled to `.claude-flow/ruvllm/sona-store.json` cross-session;
  MicroLoRA `adapt` dim guard inconsistency (`"expected 768, got 8"` vs
  `"must match config.inputDim=8"`) on an `inputDim=8` adapter. Installed runtime:
  `@sparkleideas/ruvector-ruvllm@2.5.5-patch.218`.
* User-facing counterpart: `~/source/hm/semantic-docs/docs/agentic-engineering/README.md`
  §2 (L3 RuVLLM) — confirmed real; this bug is below the README's altitude
  (the README claim "real, working, NaN-safe" stands).
