---
status: accepted
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
`feedback-singleton-frozen-state-desync`. **(CORRECTED 2026-06-10 — see
Amendments: live repro confirmed both symptoms but REFUTED this diagnosis. No
768 literal exists on the guard path; the cli wrapper writes
`inputDim`/`outputDim` onto a WASM config that only has
`inFeatures`/`outFeatures`, so every adapter is silently created 768×768 and
non-768 adapters are entirely unusable — functional, not cosmetic.)**

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

## Amendments

### Amendment (2026-06-10): root cause revised — config-plumbing no-op, not a stale 768 literal; tasks retargeted; severity raised

A live adversarial re-verification (MCP repro against the newest publish —
npx cache ≡ Verdaccio latest: cli patch.432,
`ruvector-ruvllm@2.5.5-patch.218`, `ruvector-ruvllm-wasm@2.0.2-patch.93`;
fork HEAD matches dist — nothing stale, the bug is live) CONFIRMED both
symptoms exactly (`inputDim:8` adapter → 8-dim input rejected `Input size
mismatch: expected 768, got 8`; 64-dim input rejected `input.length=64 must
match config.inputDim=8`) and REFUTED the diagnosis:

* **No hard-coded 768 literal exists on the guard path.** The Rust/WASM guard
  validates per-instance everywhere (`micro_lora.rs:516-522,535,569` all
  check `self.adapter.in_features`). The "768" in the message is the WASM
  config DEFAULT (`MicroLoraConfigWasm::new()` = 768×768,
  `micro_lora.rs:71-78`) surviving a silent wrong-property write.
* **Real root cause: the cli wrapper writes properties the WASM config does
  not have.** `forks/ruflo/v3/@claude-flow/cli/src/ruvector/ruvllm-wasm.ts:322-323`
  sets `loraConfig.inputDim/outputDim`, but the WASM class exposes
  `inFeatures/outFeatures` (`ruvllm_wasm.d.ts:507-511`) — the values land as
  inert expandos and EVERY adapter is silently created 768×768 (probe:
  `cfg.inputDim=8` → `cfg.inFeatures` still 768; `toJson()` of the "8-dim"
  adapter shows `in_features:768, out_features:768`). `rank`/`alpha` plumb
  correctly (names match).
* **Severity raised: functional, not cosmetic.** Non-768 adapters are
  entirely unusable — no input width can ever adapt one (8-dim → WASM
  rejects; 64- and 768-dim → JS guard rejects). Corroborated: both
  2026-06-08 `inputDim:8` store entries in `microlora-store.json` have empty
  journals (every adapt failed). The Context's "purely a guard/error-message
  inconsistency" and "risks … mis-gating" understated a deterministic total
  mis-gate.
* **Prior art:** the symptom was documented 2026-04-17 as W4-A2 in
  `@sparkleideas/ruflo/lib/acceptance-ruvllm-checks.sh:275-279` ("Smaller
  dims pass create() but then fail adapt()… expected 768"), worked around by
  pinning `inputDim:768`; an older auto-pad workaround landed as
  `01c764f6f` (v3.6.2). Not a fresh 2026-06-08 discovery.

**Tasks retargeted (T1/T2 superseded as written; T3 stands VERBATIM):**

* **T1′ —** Fix the property names in the cli wrapper
  (`ruvllm-wasm.ts:322-323`): `loraConfig.inFeatures = config.inputDim;
  loraConfig.outFeatures = config.outputDim;` — two lines; the Rust side
  needs no change. (T1's package attribution was wrong:
  `@sparkleideas/ruvector-ruvllm` native is only the status backend; the
  handler chain is `cli/dist/src/mcp-tools/ruvllm-tools.js:347-389` →
  `cli/dist/src/ruvector/ruvllm-wasm.js` → `ruvector-ruvllm-wasm`.)
* **T2′ —** Drop "delete the hard-coded 768 literal" (no such literal
  exists). Note: message reconciliation alone would leave the 768×768
  internal shape — T3's third assertion ("correct `inputDim`-width input
  still adapts") is the load-bearing check that forces the real fix; keep
  it.
* **T4 (new) —** Un-pin the `acceptance-ruvllm-checks.sh` small-dim
  workaround (its 768-pinning comment goes stale once fixed) and extend it
  to assert a non-768 adapter round-trips create→adapt.

SONA/EWC++ context re-confirmed live (768×768 adapter `adapt(quality 0.9,
consolidate)` → `samples_seen=1`, no NaN; `sona-store.json` journal intact;
ADR-0231 accepted @ patch.292). Probe residue: one inert create record
(`lora-mq7uzrlm-d1w9`) remains in `microlora-store.json` — no delete tool
exists; failed adapts journal nothing.
