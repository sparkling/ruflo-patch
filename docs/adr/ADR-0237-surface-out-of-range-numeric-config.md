---
status: implemented
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

## Swarm review (2026-05-24)

**Pattern**: P2 Consensus Decision Hive. **Consensus**: Quorum-majority (≥3/4 + DA explicit). **Queen**: tactical. **Panel**: 4 experts + 1 DA. **Transport**: queen-composed.

### Panel composition

- Expert 1 — Rust setter-API specialist (idiomatic `Result<(), JsValue>` vs panic; clamp-vs-error tradeoff)
- Expert 2 — Clippy lint-discipline specialist (`[lints.clippy] manual_clamp = "allow"`; what other lints are silenced)
- Expert 3 — WASM-bindgen JS-boundary specialist (how `Result` surfaces to JS callers; error-throw shape)
- Expert 4 — Upstream sync-tax specialist (CT-D's "upstream still ships all 5 clamps" finding — fork-only divergence cost)
- Devil's Advocate

### Upstream intent (per-clamp verification)

Direct read of `/Users/henrik/source/ruvnet/RuVector/crates/ruvllm-wasm/src/sona_instant.rs` against `forks/ruvector/.../sona_instant.rs`:

| Line | Setter | Fork | Upstream | Status |
|---|---|---|---|---|
| `:131` | `set_micro_lora_rank` | `value.max(1).min(4)` | `value.max(1).min(4)` | **byte-identical** |
| `:143` | `set_learning_rate` | `value.max(0.0).min(1.0)` | `value.max(0.0).min(1.0)` | **byte-identical** |
| `:155` | `set_ema_decay` | `value.max(0.0).min(1.0)` | `value.max(0.0).min(1.0)` | **byte-identical** |
| `:167` | `set_pattern_capacity` | `value.min(1000)` (wave A9) | `value.max(10).min(1000)` | **fork 1 ahead** (commit `6227eb8`) |
| `:179` | `set_ewc_lambda` | `value.max(0.0).min(1.0)` | `value.max(0.0).min(1.0)` | **byte-identical** |

Both `Cargo.toml` files carry **identical clippy lint config**: `[lints.clippy] manual_clamp = "allow"` (fork `:122`, upstream `:119`) — same ~150 lints silenced in the same `[lints]` block. Upstream is **neutral-by-omission**, not aligned, on the four silent-clamp setters. Pre-flight check 2 ("upstream hasn't already decided it") clears: upstream ships the clamps as an artefact of clippy lint-discipline collapse, not a deliberate contract. The fork's wave-A9 disposition (`pattern_capacity`) is the only deliberate signal in this file.

### Other clippy lints silenced in the same `[lints.clippy]` block

The audit's cross-cutting observation #4 stated "~150 lints disabled". Spot-checking the same block: `manual_div_ceil`, `manual_is_multiple_of`, `manual_range_contains`, `manual_clamp`, `manual_checked_ops`, `manual_let_else`, `manual_memcpy`, `manual_repeat_n`, `manual_contains`, `manual_flatten`, `manual_abs_diff`, `manual_slice_size_calculation`, `manual_strip`, `manual_unwrap_or`, `manual_swap`, `comparison_chain`, `match_like_matches_macro`, `redundant_closure*`, `unnecessary_*` (12+ variants), `cast_*_truncation/wrap/precision/lossless/sign`, `unwrap_or_default`, `partialeq_to_none`, `nonminimal_bool`, `collapsible_*`, `single_match_else`, `if_same_then_else`, `unnested_or_patterns` — silenced as "research-tier crate, doc/style churn deferred. Correctness + suspicious lints stay denied" (`Cargo.toml:84` comment). Re-enabling `manual_clamp` narrowly (Option C follow-up) is **not** equivalent to a full `[lints]` audit; that broader audit is correctly scoped out of this ADR.

### ADR-180+ alignment

[[ADR-0231]] wave A9 (implemented 2026-05-24, eighth amendment) is the **direct precedent** — same file, same defect class, same disposition shape: drop the silent clamp, honor user input, keep the documented ceiling. The ADR-0231 commit message ("honor user pattern_capacity, drop silent .max(10) clamp") establishes the verb the four siblings inherit. [[ADR-0095]] amendment 2026-05-23 ("dont do this: `RUFLO_ALLOW_PURE_TS_FALLBACK`. Just fail loud") is the cross-corpus precedent for rejecting escape-hatch options — Option B's `console::warn_1` log-only path is the WASM analogue and is correctly rejected here. [[ADR-0234]] (CT-A, proposed today) uses the **per-site disposition table + divergence comment + INTEGRATION-LEDGER row** shape for "fork now N ahead of upstream"; ADR-0237's sites table + ledger-entry confirmation step is the same shape applied to the WASM-Rust seam. [[ADR-0210]] (stub-honesty mandate) is not in conflict — these are real correctness fixes, not surface-without-enforcement. [[ADR-0233]] §CT-D names this exact theme; no other ADR in 0234–0248 covers it.

### Critique outcomes

| Expert | Critique | Vote | Adopted? |
|---|---|---|---|
| Expert 1 (Rust setter-API) | Option A correctly chooses `Result<(), JsValue>` over panic. `pi_quant_wasm.rs:134-140` panics on out-of-range bits/k as the audit notes — that's the wrong precedent for *runtime* validation (panic is for invariant violations the API contract forbids; out-of-range hyperparameters are user-input errors). `Result<(), JsValue>` is idiomatic for wasm-bindgen's fallible-setter pattern. One amendment: the ADR's `f32::is_finite()` guard on lines 67-69 of the Sites table is correctly placed for the three `f32` setters, but should explicitly handle the NaN-as-negative-zero edge case (`-0.0` parses as `< 0.0` via `partial_cmp` only when normalized — but `.is_finite()` returns true for `-0.0`; the `< 0.0` check rejects it correctly). No code change; the ADR is sound. | agree | n/a (corroboration) |
| Expert 1 (Rust setter-API) | The Sites table's "Proposed" column says `Err if value < 1 \|\| value > 4` for `set_micro_lora_rank` (line 67) but `usize` cannot be `< 0`, so `value < 1` is the real lower-bound check. The constraint `value > 4` is correct. This is fine as-stated — `value < 1` correctly excludes `0` for `usize`. | agree | n/a (corroboration) |
| Expert 2 (Clippy lint-discipline) | The follow-up Option C says "re-enable `manual_clamp` + audit the rest of `[lints]` disables". The ADR correctly scopes the broader audit out (line 60: "broader `[lints]` audit is out of scope for this ADR; it belongs in a separate CT-style theme ADR if undertaken"). But: re-enabling `manual_clamp` alone is asymmetric — the lint catches `x.max(N).min(M)` and suggests `x.clamp(N, M)`, which would have prevented the original anti-pattern but does NOT validate vs error-vs-clamp semantics. **The lint and the per-site fix are orthogonal: the lint enforces *style*; the per-site fix enforces *contract*.** Re-enabling the lint is good belt-and-braces but doesn't guard the *next* setter that genuinely needs `.clamp()` for ceiling-only enforcement (e.g. `set_pattern_capacity` after wave A9 — which has `value.min(1000)`, no `.max()`, doesn't trip the lint). | amend | **ADOPTED** — note in Decision Outcome that Option C (lint re-enable) is a regression guard for the anti-pattern shape, not a guard against the underlying contract bug; per-site fix is load-bearing, lint is belt-and-braces. |
| Expert 2 (Clippy lint-discipline) | The Cargo.toml has `correctness = { level = "deny", priority = -1 }` and `suspicious = { level = "deny", priority = -1 }` (lines 111-112). `manual_clamp` is in the `style` category, not `correctness` — re-enabling it crate-wide may surface 50+ existing violations across other crates in the workspace (the `[lints.clippy]` block applies only to `ruvllm-wasm` per the `[lints]` table-level scoping). Recommend narrow scope: re-enable in `ruvllm-wasm` only, not workspace-wide; defer the workspace sweep to a separate ADR. | amend | **ADOPTED** — confirm in Decision Outcome that Option C follow-up is **per-crate** (`ruvllm-wasm/Cargo.toml` only), not workspace-wide; matches the audit's "scoped narrowly to that one lint" framing. |
| Expert 3 (WASM-bindgen JS-boundary) | wasm-bindgen's `Result<(), JsValue>` from a setter produces a JS-side `throw` at the assignment site. So `sonaConfig.learningRate = 2.0` in JS will throw — matching expected JS-property-setter semantics. The ADR's "wasm-bindgen-visible API break for any external consumer" caveat (line 81) is correct. One refinement: the error message format matters because JS callers catch `JsValue` and may stringify it for logging. Recommend the `JsValue::from_str(...)` payload include the setter name, the offending value, and the valid range — e.g. `"set_learning_rate: value 2.0 out of range [0.0, 1.0]"`. The audit's `feedback-no-fallbacks` and ADR-0095's "include `code`, surface the path, name the ADR that removed the fallback" precedent applies here. | amend | **ADOPTED** — note in Decision Outcome that error messages should follow the ADR-0095 precedent: include setter name, offending value, valid range, and `ADR-0237` reference. |
| Expert 3 (WASM-bindgen JS-boundary) | The `SonaConfigWasm` constructor at `:97-108` accepts no parameters — all fields are initialized to defaults. Users must call setters to deviate from defaults. So the *only* path to a bad value is through the setters this ADR fixes; constructor-level validation is not needed (currently). However, **`fromJson` at `:189-191`** uses `serde_json::from_str` which deserializes directly into struct fields without invoking setters — bypassing the new validation. Either: (a) accept that `fromJson` is a power-user escape hatch and document it, or (b) add a post-deserialize validation pass. **Recommend (a)** — `fromJson` round-trips data the system itself produced (i.e. through `toJson` from a previously-validated config); validating it again is belt-and-braces. | amend | **ADOPTED (lightweight)** — note in Consequences that `fromJson` does not invoke setters; round-trip safety is sufficient for the documented use case but future direct-construction-from-untrusted-JSON would need a post-deserialize validation pass. Not a Decision change, just a forward-pointer. |
| Expert 4 (Upstream sync-tax) | The per-clamp verification confirms: 4 of 5 sites are **byte-identical with upstream**; the fork is already 1 ahead on `set_pattern_capacity` (wave A9). After this ADR ships, the fork will be **5 ahead** of upstream on `sona_instant.rs`. Every future merge from `ruvnet/RuVector` will re-encounter the upstream clamps and need to honor the fork's fail-loud variant. The ADR's Confirmation §3 (INTEGRATION-LEDGER entry) correctly addresses this. **Recommend strengthening**: cite the [[ADR-0234]] precedent ("CT-A correction-4 warning") — when fork-only fail-loud diverges from upstream-by-design behaviour, the divergence-marker comment at the throw site MUST name the ADR for the next upstream-sync agent. | amend | **ADOPTED** — note in Confirmation §3 that divergence-marker comments (`// ADR-0237: fork diverges from upstream silent clamp`) accompany each Err return; matches [[ADR-0234]] per-site disposition shape. |
| Expert 4 (Upstream sync-tax) | The ledger entry needs to be specific about the *scope*: not "this file" generally, but "lines 131, 143, 155, 167, 179 — the five SonaConfigWasm setters — diverged 2026-05-24 per ADR-0237". Future merge tooling may diff at the function level; a file-level note is too coarse. | amend | **ADOPTED** — Confirmation §3 ledger entry to include per-line citation matching the Sites table. |
| DA | "Honor user input → silent NaN propagation downstream." If `set_learning_rate(NaN)` returns `Err` (rejected), but `set_learning_rate(1.0)` (a clamped valid value the user *thought* was 2.0 but was actually `NaN.min(1.0)` = NaN per IEEE 754 partial order) succeeds — wait, the current `value.max(0.0).min(1.0)` produces NaN if value is NaN (NaN propagates through both `.max` and `.min`). So *today* the fork already has silent NaN propagation. The fix REMOVES this silent path because `!value.is_finite()` would Err. The DA's concern is *backwards* — the current code is the silent-NaN path; the proposed fix closes it. **Withdraw on this argument.** | hold | **REJECTED (panel persuades DA)** — the `f32::is_finite()` guard explicitly catches NaN at the boundary; the audit's F-06-008 (NaN unwrap panics deeper in `hnsw_router.rs`) is partially mitigated by this fix per the ADR's "Good" consequence at line 80. |
| DA | "ADR-0095 amendment trail proves wave-A9 was a one-off — universalizing is overreach." Wave A9 fixed ONE clamp (`set_pattern_capacity`) for ONE reason (the lower clamp didn't have a documented justification, only the ceiling did). The other four clamps DO have semantic ranges (`micro_lora_rank` 1-4 because rank-0 is meaningless; `learning_rate` 0-1 because >1 diverges; `ema_decay` 0-1 because >1 explodes; `ewc_lambda` 0-1 because lambda is a regularization weight). Silent clamping to the valid range is **arguably correct behaviour** — the user passed garbage, the system used a safe value, no work was lost. The "honor user input" principle should be balanced against "don't make the user re-call the API with the value the system already knew was right". | amend | **REJECTED (panel majority)** — Experts 1, 3, 4 vote against: (1) "silent rewrite to safe value" is the exact `feedback-no-fallbacks` anti-pattern (Expert 1); (2) the PyTorch-user `lr=2.0` example in the Context section (line 18) is a real instance where adaptation proceeds at `lr=1.0` and the user never learns their config was edited (Expert 3); (3) wave A9's precedent IS the policy — "honor user input; keep documented ceilings" — and the fork's posture is fail-loud not silent-correct (Expert 4). Expert 2 abstains: the lint-discipline question is orthogonal to the contract question. Panel vote: **3 reject, 1 abstain, DA holds principled dissent on the broader "silent-correct vs fail-loud" framing**. |

### Devil's Advocate final position

**Withdraws on the NaN-propagation challenge** (panel rationale: the fix CLOSES the silent NaN path that exists today; the DA's concern was inverted). **Holds principled dissent on the "silent-correct vs fail-loud" framing** for the four semantically-bounded setters — acknowledges the panel's 3/4 vote on Option A is correct per the [[ADR-0231]] wave A9 precedent, but flags for the record that the precedent was *one* setter (ceiling-only) and the universalization to *four* setters with documented semantic ranges is a step the fork is now taking on its own authority, not on direct upstream signal. Does NOT block the Decision. Notes that if a future fork user complains about API ergonomics ("my config was correct except for `lr=1.5`, now my whole config push fails"), the per-site disposition pattern is reversible at low cost (one setter at a time).

### Improvements adopted

1. **Decision Outcome clarification**: Option C (re-enable `manual_clamp`) is **regression guard for the anti-pattern shape, not a guard against the underlying contract bug**. Per-site fix (Option A) is load-bearing; lint is belt-and-braces. The lint catches `x.max(N).min(M)` but does not catch ceiling-only `x.min(M)` or other "silent rewrite" shapes.
2. **Decision Outcome scoping**: Option C follow-up is **per-crate** (`ruvllm-wasm/Cargo.toml` line 122 only), not workspace-wide. Re-enabling `manual_clamp` workspace-wide may surface ~50+ existing violations in other crates that are out of CT-D scope.
3. **Confirmation §1 amendment**: error-message format follows the ADR-0095 precedent — `JsValue::from_str` payload includes the setter name, the offending value, the valid range, and the `ADR-0237` reference. Example: `"set_learning_rate: value 2.0 out of range [0.0, 1.0] (ADR-0237)"`.
4. **Confirmation §3 amendment**: INTEGRATION-LEDGER row cites per-line scope (`sona_instant.rs:131, :143, :155, :179` — the four newly-diverged setters; `:167` is the wave-A9 prior divergence already recorded). Each Err return in the implementation carries a divergence-marker comment `// ADR-0237: fork diverges from upstream silent clamp` matching the [[ADR-0234]] per-site disposition pattern.
5. **Consequences forward-pointer**: `fromJson` (line 189-191) deserializes directly into struct fields without invoking setters; round-trip safety is sufficient for the documented use case (round-tripping a previously-validated config). If future use-cases require direct construction from untrusted JSON, a post-deserialize validation pass would be owed — out of this ADR's scope.
6. **DA principled-dissent recorded** on the "silent-correct vs fail-loud" framing for semantically-bounded setters — the wave-A9 precedent was one ceiling-only setter; this ADR universalizes to four range-bounded setters. Reversibility at low cost (one setter at a time) is noted.

### Vote tally

Per Quorum-majority (≥3/4 + DA explicit):

| Voter | Vote on Option A + Option C follow-up |
|---|---|
| Expert 1 (Rust setter-API) | **APPROVE** |
| Expert 2 (Clippy lint-discipline) | **APPROVE** (with scoping amendment — adopted) |
| Expert 3 (WASM-bindgen JS-boundary) | **APPROVE** (with error-message amendment — adopted) |
| Expert 4 (Upstream sync-tax) | **APPROVE** (with ledger-citation amendment — adopted) |
| Devil's Advocate | **PRINCIPLED DISSENT, does not block** (withdraws on NaN-propagation challenge; holds on "silent-correct vs fail-loud" framing for semantically-bounded setters) |

**Verdict**: 4/4 experts approve (quorum met at ≥3/4); DA holds principled dissent on framing but does not block. Decision Outcome stands; improvements 1-6 above are folded into the ADR by reference.
