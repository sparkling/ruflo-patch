---
status: proposed
date: 2026-05-24
tags: [validation, wasm, rust, error-handling]
supersedes: []
depends-on: [0201, 0231, 0233]
implements: []
---

# Surface out-of-range numeric config

## Context and Problem Statement

[[ADR-0233]] §CT-D ("Silent numeric clamps") catalogued four siblings of the same defect that [[ADR-0231]] wave A9 closed in `set_pattern_capacity`. The wave A9 fix dropped a silent `.max(10)` lower clamp so user input `5` is honored as-is (commit `6227eb8`, `forks/ruvector/crates/ruvllm-wasm/src/sona_instant.rs`). The upper bound (`.min(1000)`) was kept as the documented WASM ceiling.

The same file ships four more setters with the same anti-pattern shape — `value.max(N).min(M)` with no signal to the caller that the value was rewritten. The crate's `[lints.clippy]` config in `crates/ruvllm-wasm/Cargo.toml:122` explicitly sets `manual_clamp = "allow"`, so clippy never flagged the pattern (this is one of ~150 lints disabled in that section — slice 06 cross-cutting observation #4). A fifth site lives JS-side: `cli/src/ruvector/ruvllm-wasm.ts:142` declares `HNSW_MAX_SAFE_PATTERNS = 1024` and uses it to throw mid-ingest (on the 1025th `addPattern`) regardless of what `config.maxPatterns` the caller passed to construct the router.

The shape is uniform: a caller writes a plausible config value, the setter rewrites it without telling anyone, and downstream behaviour silently follows the rewritten value (or in the HNSW case, half-loads the corpus before the throw fires). For `set_learning_rate`, a PyTorch user passing `lr=2.0` gets adaptation at `lr=1.0` and never learns their config was edited under them. For HNSW, a caller asking for `maxPatterns: 5000` gets a runtime throw deep into ingestion.

[[ADR-0231]] wave A9 established the precedent: *honor user input; keep documented ceilings*. Wave A9 chose to drop the silent lower clamp rather than upgrade it to a typed error because (a) `set_pattern_capacity` had only one offending bound and (b) the ceiling case has a clear documented justification. The five siblings here have a mix: ranges (`micro_lora_rank` 1-4, `learning_rate` 0.0-1.0) where both ends carry semantic meaning, and the JS-side hard cap which has a comment claiming the WASM side now supports more.

## Pre-flight verification

Applied [[ADR-0201]]'s four-check checklist before writing the Decision Outcome:

1. **Signal reaches its audience.** Verified end-to-end on each site:
   - The four `sona_instant.rs` setters are reachable from `@ruvector/ruvllm-wasm` via `wasm_bindgen` setters; the JS caller is whatever pipeline writes a `SonaConfigWasm`. Today nothing in `cli/src/ruvector/*` calls those setters (they're configured at construction via the constructor defaults), but the surface is part of the public wasm-bindgen API and shipped in the published artefact. So the signal *would* reach external consumers; internally, the only path is through `SonaConfigWasm`'s `microLoraRank` / `learningRate` / `emaDecay` / `ewcLambda` setters by name. A `Result<(), JsValue>` surface change would propagate through wasm-bindgen as a JS-side throw.
   - The `HNSW_MAX_SAFE_PATTERNS` throw at `ruvllm-wasm.ts:170` is reachable from any caller of `createHnswRouter().addPattern(...)`; nothing in the fork swallows that throw (verified by `grep -rn 'createHnswRouter\|addPattern' cli/src/`).
2. **Upstream hasn't already decided it.** Verified by reading `/Users/henrik/source/ruvnet/RuVector/crates/ruvllm-wasm/src/sona_instant.rs:130-180` directly: upstream still has all five clamps including the `set_pattern_capacity` `.max(10)` that wave A9 already removed in the fork. Upstream has made no deliberate signal here — the clamps are an artefact, not a contract. Wave A9 is now ahead of upstream by one commit on this file; this ADR proposes to widen the same ahead-of-upstream posture across four more siblings. The integration ledger should record this so future syncs don't reintroduce the silent clamps (carry-forward note in §More Information).
3. **Premise/inventory is true at runtime.** Re-verified all five file:line citations by direct read:
   - `forks/ruvector/crates/ruvllm-wasm/src/sona_instant.rs:131` — `value.max(1).min(4)` ✓
   - `:143` — `value.max(0.0).min(1.0)` ✓
   - `:155` — `value.max(0.0).min(1.0)` ✓
   - `:179` — `value.max(0.0).min(1.0)` ✓
   - `forks/ruflo/v3/@claude-flow/cli/src/ruvector/ruvllm-wasm.ts:142` — `export const HNSW_MAX_SAFE_PATTERNS = 1024;` ✓ (and the throw at `:169-173` ✓)
   - Cargo lint confirmed: `crates/ruvllm-wasm/Cargo.toml:122` `manual_clamp = "allow"` under `[lints.clippy]` ✓
4. **No sibling-ADR overlap.** [[ADR-0233]] CT-D names this exact surface as a single theme; no other ADR in the 0234–0236 range was drafted, and the prior wave A9 work touched only `set_pattern_capacity`. The JS-side HNSW cap is not addressed by [[ADR-0232]] (pipeline rebuild phase) nor any other in-flight ADR.

## Decision Drivers

* **Honor user input** — wave A9's precedent ([[ADR-0231]]).
* **Don't silently rewrite plausible configuration** — surfacing the failure at the boundary is cheaper than tracing it out of "adaptation converged surprisingly fast".
* **Fail loud, not deep** — for HNSW, throwing at construction beats throwing on the 1025th `addPattern` call.
* **Keep documented ceilings** — bounds with real WASM/algorithmic meaning stay; the change is in how the violation is reported, not in the value itself.
* **`feedback-no-fallbacks`** — silent rewrites are the data-corruption-shape sibling of silent fallback paths.

## Considered Options

* **Option A — Return `Result<(), JsValue>` from each setter on out-of-range; throw at the JS boundary** — matches wave-A9 in shape (honor user input, keep ceiling) and uses wasm-bindgen's natural error surface. Caller-visible.
* **Option B — Replace `.max(N).min(M)` with an explicit `if value < N || value > M { return Err(...) }` and emit `console::warn_1` on clamp** — same end behaviour as A for out-of-range; adds a log-only warning path for borderline cases. More verbose; mixes "warn" and "error" semantics that A keeps clean.
* **Option C — Re-enable clippy `manual_clamp` + audit the rest of `[lints]` disables** — addresses the lint-blindness root cause. Orthogonal to A/B: clippy would flag the pattern but doesn't dictate the remediation. Worth doing as a follow-up, but cannot replace the per-site fix because the lint config is fork-local and the violation already shipped.
* **Option D — Document the clamps + accept the rounding silently** — explicit version of the status quo. Contradicts [[ADR-0231]] wave A9's precedent and the "honor user input" principle behind it.

## Decision Outcome

Chosen option: **Option A**, because it matches the [[ADR-0231]] wave A9 precedent in shape, uses wasm-bindgen's natural `Result<(), JsValue>` error path, and surfaces the violation at exactly the seam where the bad value entered the system.

For the HNSW JS-side site (#5), the analogous fix is to validate `config.maxPatterns <= HNSW_MAX_SAFE_PATTERNS` at `createHnswRouter` construction and throw with a clear "WASM HNSW maximum is N, requested M" message — not after `count` reaches the limit mid-ingest.

Option C (re-enable `manual_clamp`) is adopted as a follow-up commit in the same wave, scoped narrowly to that one lint. The broader `[lints]` audit is out of scope for this ADR; it belongs in a separate CT-style theme ADR if undertaken.

### Sites

| # | File:line | Setter | Current | Proposed |
|---|---|---|---|---|
| 1 | `forks/ruvector/crates/ruvllm-wasm/src/sona_instant.rs:131` | `set_micro_lora_rank` | `value.max(1).min(4)` | `Result<(), JsValue>`; `Err` if `value < 1 \|\| value > 4` |
| 2 | `:143` | `set_learning_rate` | `value.max(0.0).min(1.0)` | `Result<(), JsValue>`; `Err` if `value < 0.0 \|\| value > 1.0 \|\| !value.is_finite()` |
| 3 | `:155` | `set_ema_decay` | `value.max(0.0).min(1.0)` | `Result<(), JsValue>`; `Err` if `value < 0.0 \|\| value > 1.0 \|\| !value.is_finite()` |
| 4 | `:179` | `set_ewc_lambda` | `value.max(0.0).min(1.0)` | `Result<(), JsValue>`; `Err` if `value < 0.0 \|\| value > 1.0 \|\| !value.is_finite()` |
| 5 | `forks/ruflo/v3/@claude-flow/cli/src/ruvector/ruvllm-wasm.ts:142,169-173` | `HNSW_MAX_SAFE_PATTERNS` cap | mid-ingest throw at 1025th `addPattern` | construction-time validate `config.maxPatterns <= HNSW_MAX_SAFE_PATTERNS`; throw with `"WASM HNSW maximum is N, requested M"` |
| follow-up | `forks/ruvector/crates/ruvllm-wasm/Cargo.toml:122` | `manual_clamp = "allow"` | (no clippy signal) | Remove the allow; let clippy flag the pattern crate-wide |

Each setter keeps the same documented bounds — the change is in how violations are reported, not in the values themselves. The setters' wasm-bindgen attribute signature widens from a value-setter to a fallible setter; this is a wasm-bindgen-supported pattern (returning `Result<(), JsValue>` produces a JS throw at the call site).

### Consequences

* Good, because callers writing plausible-but-wrong configuration (`lr=2.0`, `microLoraRank=8`, `maxPatterns=5000`) get a fail-loud error at the setter, not silent rewrite + surprising convergence.
* Good, because the HNSW JS-side limit fires at construction time instead of mid-ingest, so partial-load failure modes go away.
* Good, because the change shape matches [[ADR-0231]] wave A9 — the precedent the fork already chose for `set_pattern_capacity`.
* Good, because `f32::is_finite()` validation on the three `f32` setters catches NaN at the boundary, removing one tributary to the `hnsw_router.rs` `partial_cmp().unwrap()` NaN panics flagged in slice 06 F-06-008.
* Bad, because the setter signature changes from infallible to fallible, which is a wasm-bindgen-visible API break for any external consumer of `@ruvector/ruvllm-wasm` who is calling these setters from JS. Mitigated because the fork's own code currently constructs `SonaConfigWasm` only via its constructor (not the setters); external consumers are limited to whatever downstream code uses the published artefact directly.
* Bad, because this widens the ahead-of-upstream delta on `sona_instant.rs` (wave A9 was one commit ahead; this ADR's implementation will be two). Every future merge from `ruvnet/RuVector` will re-encounter the upstream clamps and need to re-honor the fork's fail-loud variant. Mitigation: integration ledger entry naming the file and the wave-A9 + ADR-0237 precedent so the next syncer doesn't accidentally restore the silent clamps.
* Neutral, because Option C (re-enable `manual_clamp`) is taken as a same-wave follow-up; clippy will catch new occurrences of the pattern crate-wide without re-auditing the rest of the `[lints]` config.

### Confirmation

Three verification surfaces:

1. **Unit-test parity with wave A9.** Wave A9 un-ignored `test_pattern_buffer_overflow` to capture the bug it fixed. The same pattern applies here: add a fail-loud test per setter (`test_set_micro_lora_rank_rejects_out_of_range`, `test_set_learning_rate_rejects_negative`, `test_set_learning_rate_rejects_nan`, etc.) — each asserts `Err` for out-of-range input. Add an `assert_throws` test in the JS-side suite for `createHnswRouter({ maxPatterns: HNSW_MAX_SAFE_PATTERNS + 1 })`.
2. **Clippy lint** (follow-up commit, same wave). Removing `manual_clamp = "allow"` from `crates/ruvllm-wasm/Cargo.toml` provides a passive guard against re-introduction; `cargo clippy --all-targets -- -D warnings` becomes the enforcement signal. Sister ADRs may choose to extend this to other crates; not in scope here.
3. **Integration-ledger entry.** Append a row to `docs/upstream/INTEGRATION-LEDGER.md` naming `forks/ruvector/crates/ruvllm-wasm/src/sona_instant.rs` and the ADR-0237 precedent so the next upstream sweep doesn't accidentally restore the silent clamps (memory `feedback-update-integration-ledger`).

## More Information

* [[ADR-0231]] wave A9 — `set_pattern_capacity` precedent; same file, same defect class.
* [[ADR-0233]] §CT-D — theme catalog identifying these four sibling sites plus the JS-side HNSW cap (F-06-003, F-06-004).
* [[ADR-0201]] — Remediation-ADR pre-flight checklist applied above.
* Slice 06 audit: `docs/audits/2026-05-24-second-pass-audit/06-wasm-native-bindings.md` (F-06-003, F-06-004 — primary evidence; cross-cutting observation #4 — `[lints]` disables; F-06-008 — related NaN-panic surface that this ADR's `is_finite()` validation partially addresses).
* Precedent for fail-loud WASM validation in the same crate: `forks/ruvector/crates/ruvllm-wasm/src/pi_quant_wasm.rs:134-140` panics on out-of-range bits/k — proving the codebase already has a fail-loud posture; the SONA setters chose the wrong half.
* Wave A9 fix commit: `forks/ruvector` `6227eb8` (`fix(ruvllm-wasm): honor user pattern_capacity, drop silent .max(10) clamp`).
* Upstream comparison: `/Users/henrik/source/ruvnet/RuVector/crates/ruvllm-wasm/src/sona_instant.rs:130-180` retains all five clamps incl. the wave-A9-fixed `set_pattern_capacity` — confirms upstream has not made a deliberate signal here.
