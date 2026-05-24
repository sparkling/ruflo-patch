## ADR-0237 — CT-D: surface out-of-range numeric config

**Status**: proposed (post-swarm-review)
**Swarm**: 4 experts + devil's advocate, Quorum-majority consensus
**Triage rank**: 12 (per [[ADR-0233]] §Decision triage order)

### Decision (post-swarm-review)

Apply **Option A + same-wave Option C lint rider** as originally drafted, with five
scoping/clarification amendments surfaced by the panel: (i) error-message format follows the
[[ADR-0095]] amendment precedent — `JsValue::from_str` payload includes setter name, offending
value, valid range, and `ADR-0237` reference; (ii) Option C lint re-enable is **per-crate**
(`ruvllm-wasm/Cargo.toml:122` only), not workspace-wide — re-enabling `manual_clamp`
workspace-wide may surface ~50+ existing violations across other crates out of CT-D scope;
(iii) the lint catches `x.max(N).min(M)` but does NOT guard ceiling-only `x.min(M)` or other
silent-rewrite shapes — per-site fix is load-bearing, lint is belt-and-braces; (iv)
INTEGRATION-LEDGER row cites per-line scope (`:131, :143, :155, :179` — the four newly-diverged
setters; `:167` is wave-A9's prior divergence); (v) each `Err` return carries a divergence-marker
comment `// ADR-0237: fork diverges from upstream silent clamp` matching the [[ADR-0234]]
per-site disposition pattern. DA withdraws on the NaN-propagation challenge (current code IS
the silent-NaN path; fix CLOSES it) but holds principled dissent on universalizing wave A9's
ceiling-only precedent to four range-bounded setters (does NOT block).

### Implementation steps

1. **Sites 1-4 (Rust) fork-side fix** in `forks/ruvector/crates/ruvllm-wasm/src/sona_instant.rs`:
   - `:131` `set_micro_lora_rank`: change signature to `pub fn set_micro_lora_rank(&mut self, value: usize) -> Result<(), JsValue>`; reject `value < 1 || value > 4` with `JsValue::from_str("set_micro_lora_rank: value {value} out of range [1, 4] (ADR-0237)")`. Add divergence-marker comment.
   - `:143` `set_learning_rate`: change to `Result<(), JsValue>`; reject `value < 0.0 || value > 1.0 || !value.is_finite()` with formatted error; divergence-marker comment.
   - `:155` `set_ema_decay`: same shape as `:143`.
   - `:179` `set_ewc_lambda`: same shape as `:143`.
   Commit per `[[feedback-commit-forks-before-release]]`.
2. **Site 5 (JS) fork-side fix** in `forks/ruflo/v3/@claude-flow/cli/src/ruvector/ruvllm-wasm.ts`:
   At `createHnswRouter` (line 150-198), validate `config.maxPatterns <= HNSW_MAX_SAFE_PATTERNS`
   at construction time; throw with `"WASM HNSW maximum is ${HNSW_MAX_SAFE_PATTERNS}, requested ${config.maxPatterns} (ADR-0237)"` if exceeded. Remove the mid-ingest `count >=
   HNSW_MAX_SAFE_PATTERNS` throw at `:169-173` (the construction-time check obviates it; the
   counter logic can stay for `addPattern` boolean return). Commit separately from the Rust
   fix; the JS-side fix is fork-only and does not need a wasm rebuild.
3. **Option C follow-up commit (same wave)**: remove `manual_clamp = "allow"` from
   `forks/ruvector/crates/ruvllm-wasm/Cargo.toml:122` (per-crate, not workspace-wide). Verify
   `cargo clippy --all-targets -- -D warnings` passes on `ruvllm-wasm` with the lint
   re-enabled. Commit per `[[feedback-commit-forks-before-release]]`.
4. **INTEGRATION-LEDGER row** for sites 1-4: `superseded-by-local` disposition citing this
   ADR; upstream `ruvnet/RuVector/crates/ruvllm-wasm/src/sona_instant.rs:131, :143, :155, :179`
   carries the byte-identical silent clamps, so this is fork-only merge-tax until upstream
   takes a matching patch. The wave-A9 prior divergence at `:167` is already recorded; this row
   extends it to the four siblings. Record per `[[feedback-update-integration-ledger]]`.
5. **Site 5 INTEGRATION-LEDGER row**: fork-only fix (the `ruvllm-wasm.ts` file is fork-original
   per [[ADR-0234]] CT-A check 2; no upstream counterpart). No merge tax.
6. **Acceptance check** invoked via `_run_and_kill` (registered in both `run_check_bg` and
   `collect_parallel` per `[[reference-acceptance-runcheck-vs-collect]]`): instantiate
   `SonaConfigWasm` via WASM bindings, call `set_learning_rate(2.0)` — expect a JS throw with
   `"ADR-0237"` substring; call `set_learning_rate(NaN)` — expect throw; call
   `set_micro_lora_rank(0)` and `set_micro_lora_rank(5)` — both expect throws; call
   `createHnswRouter({ maxPatterns: HNSW_MAX_SAFE_PATTERNS + 1 })` — expect throw at
   construction (not mid-ingest); call `set_pattern_capacity(5)` — expect SUCCESS (wave A9
   precedent, no lower clamp). The wasm-bindgen `Result<(), JsValue>` surface produces JS
   throws that the test catches with `expect(() => ...).toThrow(/ADR-0237/)`.
7. **Rust unit tests** in `crates/ruvllm-wasm/src/sona_instant.rs#[cfg(test)] mod tests`: add
   `test_set_micro_lora_rank_rejects_out_of_range`, `test_set_learning_rate_rejects_negative`,
   `test_set_learning_rate_rejects_above_one`, `test_set_learning_rate_rejects_nan`,
   `test_set_ema_decay_rejects_nan`, `test_set_ewc_lambda_rejects_out_of_range` — each asserts
   `Err` for the out-of-range case. Matches the wave-A9 precedent of un-ignoring
   `test_pattern_buffer_overflow` to capture the bug it fixed.

### Dependencies

- [[ADR-0231]] wave A9 — the `set_pattern_capacity` precedent in the same file; same defect
  class, same fix shape (honor user input; keep documented ceilings). This ADR's
  implementation extends the wave-A9 disposition to four sibling setters in the same file.
- [[ADR-0095]] amendment 2026-05-23 — corpus-level precedent for rejecting escape-hatch
  options (the "dont do this: `RUFLO_ALLOW_PURE_TS_FALLBACK`. Just fail loud" disposition
  applies analogously to Option B's `console::warn_1` log-only path, correctly rejected here).
- [[ADR-0234]] (CT-A) — sibling theme also using the per-site disposition + divergence comment
  + INTEGRATION-LEDGER row shape for "fork now N ahead of upstream". This ADR is the
  Rust-WASM-seam counterpart to [[ADR-0234]]'s TS-loader-seam fixes.
- [[ADR-0233]] §CT-D — defect-class origin citing F-06-003 (WARNING, 4 setters) and F-06-004
  (WARNING, HNSW cap). This ADR IS the CT-D remediation.
- [[ADR-0201]] — Remediation-ADR pre-flight checklist that cleared this draft (all four
  checks pass: signal-reaches-audience for the wasm-bindgen setters via the public
  `@ruvector/ruvllm-wasm` artefact AND for the HNSW JS-side cap via `createHnswRouter`
  callers; upstream-neutral-by-omission on the 4 setters; premise true at runtime per direct
  file:line citations; no sibling-ADR overlap with 0234-0236, 0238-0248).

### Validation

- Source-shape grep: `forks/ruvector/crates/ruvllm-wasm/src/sona_instant.rs` —
  `grep -c 'value\.max([0-9.]*).min([0-9.]*)' sona_instant.rs` returns **zero** matches
  (the four silent-clamp sites are gone; `set_pattern_capacity:167` already has
  `value.min(1000)` per wave A9 and matches a stricter pattern).
- Source-shape grep: `forks/ruflo/v3/@claude-flow/cli/src/ruvector/ruvllm-wasm.ts` —
  `createHnswRouter` body contains the construction-time `maxPatterns` validation throw;
  `count >= HNSW_MAX_SAFE_PATTERNS` mid-ingest throw is removed (or downgraded to a
  belt-and-braces assertion if the WASM index can grow under the user's nose).
- Source-shape grep: `forks/ruvector/crates/ruvllm-wasm/Cargo.toml` — line 122 no longer
  contains `manual_clamp = "allow"`; `cargo clippy --all-targets -- -D warnings` passes on
  `ruvllm-wasm` crate.
- Rust unit-test pass: `cargo test -p ruvllm-wasm sona_instant::tests::test_set_` shows the
  6 new tests passing.
- Behavioural acceptance: the `_run_and_kill`-registered check in implementation step 6
  exercises all 5 sites end-to-end via JS bindings; failures throw with `ADR-0237` substring.
- No `skip_accepted` per `[[feedback-skip-accepted-as-squelch]]`.

### Top risk + mitigation

- **Risk**: wasm-bindgen-visible API break for external consumers of `@ruvector/ruvllm-wasm`
  who are calling the setters from JS — `sonaConfig.learningRate = 1.5` will THROW instead of
  silently coercing to `1.0`. The fork's own code currently constructs `SonaConfigWasm` only
  via its constructor (the audit verified no fork code calls the setters by name), so the
  blast radius is external-consumer-only. But the WASM artefact is published as
  `@sparkleideas/ruvector-ruvllm-wasm` and any downstream consumer pinning the published
  artefact will see the breaking change on update.
- **Mitigation**: the wave-A9 commit message convention (`fix(ruvllm-wasm): honor user
  pattern_capacity, drop silent .max(10) clamp`) sets the precedent for the changelog framing
  — "honor user input; previously-silent rewrites now throw at the boundary". The version bump
  on the `@ruvector/ruvllm-wasm` artefact should be a **minor** under semver (new throws on
  inputs previously coerced — surface change but not a deletion); the ADR-0237 reference in
  every error message gives downstream consumers a trace path to understand the disposition.
  Belt-and-braces: the per-crate Option C lint re-enable prevents new sites from accreting
  in `ruvllm-wasm`; the cross-cutting [[ADR-0233]] observation #4 (the broader `[lints]`
  audit) is correctly scoped out — a future ADR may take that on if the fork's lint posture
  is reviewed.

### Cross-bonus / related work

- **F-06-008 partial closure** (cross-cutting): the audit's NOTE F-06-008 (`hnsw_router.rs`
  unwrap()s NaN panic in graph-traversal hot path) is **partially mitigated** by this ADR's
  `f32::is_finite()` guard on the three `f32` setters — NaN at the config-setter boundary
  is rejected before it can propagate into HNSW route/insert paths. The graph-traversal
  `unwrap()`s still need their own fix (per the audit's singleton disposition
  `fix-in-place — pre-validate f32::is_finite() at WASM boundary`), but this ADR closes one
  of the tributaries.
- **F-06-003 + F-06-004 closure**: this ADR's 5 sites cover both audit findings completely.
- **Option C ([[ADR-0233]] cross-cutting observation #4)**: the per-crate `manual_clamp`
  re-enable here is a **narrow** disposition of the broader "150+ lints disabled in
  ruvllm-wasm" observation. The broader audit is correctly scoped out; if undertaken, a
  future ADR would walk the workspace's `[lints]` configs and decide per-lint whether the
  "research-tier crate, doc/style churn deferred" comment still applies.
