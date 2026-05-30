---
status: accepted
date: 2026-05-19
tags: [policy, lint, arch-test, no-fallbacks]
supersedes: []
depends-on: [ADR-0201]
implements: []
---

# Enforce no-fallbacks: gate dishonest success, not honest degradation

> **Reframed after a 6-expert swarm review (2026-05-20).** The original draft chose Option D — a third detector (`check-fallback-returns.mjs`) with three detections (3a literal-return, 3b state-flag-flip via ts-morph, 3c loadStore-collapse). The review found, with empirical evidence, that: (a) the "policy regressed → 29 new violations" premise is **factually wrong** (the sites are pre-existing, mostly upstream-inherited, and predate the detectors); (b) the inventory is materially miscounted (the "14 loadStore lacking `existsSync`" cluster has **0** matching sites — guards are present everywhere); (c) **3b runs at ~98% false-positive** because correctness-of-a-degraded-value is not statically decidable, and its one true positive is outside the detector's scan scope; (d) the predecessor gate already carries 342 allowlist entries (27% of scanned catches) — a third semantic gate would rot into theatre; (e) upstream ships fallbacks by design, so a blanket fork-only gate is a perpetual merge tax. The decision is changed to **Option E** — bulk-fix the genuine *dishonest-success / data-loss* subset, ship the helper library, add **one narrow advisory detector** for the dishonest-envelope shape, **drop 3b**, and enforce the semantic layer via typed `Result` + review + integration tests (ADR-0191's own lesson). See [Swarm review evidence](#swarm-review-evidence-2026-05-20).
>
> **Second-pass validation (2026-05-20):** Option E confirmed — every load-bearing empirical claim verified, including "0 loaders lack existsSync" (21 loaders, all guarded), the 5 `embeddings-tools` catch-on-failure envelopes (`:525/:630/:656/:686/:727`), the allowlist (`lib/undiscriminating-catches-allowlist.txt` — **262 entries / 1285 scanned ≈ 20%**; the "342 / 27%" cited elsewhere was the line-keyed count before the `fcab2bc` content-keying refactor), and 3b's undecidability (`WASMVectorSearch:256` honest vs `EmbeddingService:101` dishonest are the identical `catch { this.X = falsy }` shape). The advisory detector was *prototyped* (~25-line zero-dep byte-scanner) and returned exactly the 5 sites with zero false positives — decidable, unlike 3b. Three refinements (no decision change): **(1)** the ADR's "TBD" corrupt-JSON-collapse count resolves to **~20 sites** (existsSync-guarded loaders whose catch swallows `SyntaxError`→default = data loss) — strengthens step 2's bulk-fix scope; **(2)** the advisory detector should key on **bare `success:true` *inside a catch body*** (suspect-by-construction, purely lexical/decidable), NOT "with empty/default data" (harder to make lexical); **(3)** that simplification also catches the SONA site `embeddings-tools.ts:687`, which returns `success:true` with a *non-empty* `{enabled:false,reason}` discriminator — step 2 must disposition it explicitly (honest real-discriminator vs dishonest-at-the-`mcp-server.ts:673`-JSON-flatten-boundary), since the original "empty data" qualifier would have silently missed a **sixth** site (`:687`) beyond the 5 canonical envelopes — though the council's later finding is that `:687` is honest *at the payload* (the defect is protocol-level at `mcp-server.ts:695`), so the right detector shape is "`success:true` in a catch with no sibling discriminator," not "bare `success:true`" (which would flag the honest discriminated sites). 0209↔0210 detectors are distinct + mutually reinforcing (0209 = catch-fallback envelope; 0210 = fabricated-constant); 0191's protected catches are not re-litigated.

## Context and Problem Statement

The "no fallbacks — fail loud" policy is documented in [[feedback-no-fallbacks]], ADR-0082 (Rule 3: no product-code silent fallbacks), and operationalised by ADR-0191 (undiscriminating-catch triage). Two preflight gates exist and pass today (wired into `scripts/ruflo-publish.sh:471,484`):

* `scripts/check-silent-catches.mjs` — flags empty `catch {}` bodies.
* `scripts/check-undiscriminating-catches.mjs` — flags comment-only `catch { /* … */ }` bodies.

Both report `OK: 1283 catch block(s) scanned, all discriminate or are allowlisted` (verified). Both are hand-rolled character-scanners with **zero external dependencies**, and both scan **only** `forks/ruflo/v3/@claude-flow/cli/src` and `forks/agentic-flow/src` — **`forks/agentdb/src` is not scanned at all.**

The 2026-05-19 soundness audit found silent-fallback-shaped sites these syntactic gates don't catch, of the form "catch swallows the error and returns a synthetic value callers can't distinguish from real success." The original ADR-0209 proposed a third detector to catch this *semantic* pattern. The swarm review establishes that the problem is real but the original framing and design are not sound. The corrections below are the substance of this ADR.

### Correction 1 — this is a finite inherited backlog, not a regression

The original draft framed the sites as "the 28 catches ADR-0191 closed have been replaced by ~29 new violations." The git record refutes this:

* The loadStore family, `github-tools run()`, and `embeddings-tools` date to **January 2026**; `EmbeddingService` mock-fallback and `neural-tools` hash-fallback are **upstream code imported at fork-init** (May 5–6). The newest site predates ADR-0191 by ~10 days. **None postdate the detectors.**
* The two detectors were built 2026-05-18/19 — the same 24 hours as ADR-0191 and the audit. The sites were never "let in past a gate"; they were always there, outside every net cast (ADR-0191's net was capability-gate comment-only catches, a different shape).
* **No post-gate regression has been demonstrated.** A "forcing function against a regression cycle" addresses a cycle the evidence does not show.

Consequence: this is a one-time, audit-enumerated, finite corpus to *fix*, not a leak to *dam*. Urgency for an expensive perpetual gate is low; urgency for fixing the genuine data-loss bugs is real.

### Correction 2 — the distinction the policy actually needs: honest degradation vs dishonest success

The catches in question split into two categories that *look identical syntactically* but are opposite on the merits:

* **Honest graceful degradation (NOT a violation).** A native accelerator is absent, so a JS path returns the **same answer** (`WASMVectorSearch` `simdAvailable=false` → JS `cosineSimilarity` returns a numerically identical `number`; `HNSWIndex`, `RvfBackend`, `AttentionWASM`, `LearningSystem` GNN — the 42-site `this.X=null/false` corpus is overwhelmingly this). A missing file returns an empty store (`existsSync` → default). The degraded result is *correct*; the caller is not misled. This is upstream's deliberate resilience architecture (241 "fall back" comments, `#230` "SQLite Fallback" shipped as an *enhancement*).
* **Dishonest success / data loss (THE violation).** The catch returns a **wrong or synthetic** value dressed as success: `mockEmbedding(text)` / `hashEmbedding(text)` indistinguishable from a real vector; `{ success: true, results: [] }` when the operation actually failed; **corrupt JSON silently treated as a missing file** (data loss — the corrupt state is overwritten on next save). The caller cannot tell failure from success.

The original three detections conflate these because **correctness-of-the-degraded-value is not statically decidable** — `WASMVectorSearch:256` (`simdAvailable=false`) and `EmbeddingService:101` (`pipeline=null`) share the *same terminal `this.X=falsy` assignment* (EmbeddingService also rethrows the fatal dim-mismatch first and warns, but a static detector keying on the assignment can't use that); one is fine and one is a violation. This is precisely ADR-0191's release-3 lesson (lines 481-499): a detector cannot tell a contract-bound catch from paranoia — *"only the integration-test signal can."* The fork's no-fallbacks policy targets **only the dishonest-success/data-loss category**; honest degradation is allowed (and is upstream's design).

### Correction 3 — the inventory is materially miscounted (verified empirically)

| Original claim | Verified reality |
|---|---|
| F-08-005: **14** `loadXxxStore()` lacking `existsSync`, collapsing ENOENT+SyntaxError | **21** loaders exist; **0 lack `existsSync`** — ENOENT is universally guarded. The ADR's flagship "one mechanical fix for 14" target set **does not exist**. The real residual is *corrupt-JSON-collapse* (catch swallows `SyntaxError` after the guard) — a different, narrower concern; one site (`ruvllm-store.ts readJsonOrDefault`) carries a documented ADR-0082 rationale. The cited worked example `memory-tools.ts:103` is wrong — the guard is at `:97`. |
| F-08-004: **4** `embeddings-tools.ts` `success:true` empty-data catches | **5** (`:525,:630,:656,:686,:727`). Genuine dishonest-envelope violations. |
| F-08-002: `neural-tools.ts` 3a literal-return | Empty catch + **outer** fall-through (not a `return <literal>` in the catch). Silent specifically when a *loaded* provider throws at runtime (the `'hash-fallback'` note is only set if the model was `'none'`). Genuine but not 3a-shaped. |
| F-04-004: `EmbeddingService` mock-embedding | Genuine dishonest-success — but in `forks/agentdb/src` (**outside scan scope**), and the fork already rethrows the fatal dim-mismatch (`:90`, ADR-0177). |
| F-08-003: `github-tools run()` → `null` | `null` is a *discriminated absence* the caller checks — weakest of the cited "violations," arguably honest. |

The genuine, in-scope **dishonest-success/data-loss** subset is small: **one** clear `embeddings-tools` empty-envelope (`:525`; the other four cited carry honest `{enabled:false,reason}` discriminators and need only protocol-boundary disposition), the `neural-tools` runtime-throw, the corrupt-JSON-collapse sites (**~20-27 by the 2026-05-22 walk** — existsSync-guarded loaders whose catch swallows `SyntaxError`→default; judgment-dependent, not cleanly lexical), and the agentdb mock-embedding cluster (out of current scan scope). It is far smaller than "≥29" and is mostly mechanical.

### Correction 4 — a fork-only blanket gate fights upstream and rots like its predecessor

Upstream has **no** no-fallbacks policy or detector; all the cited sites are upstream-inherited. Upstream treats fallbacks as features — even when it agreed a "silent fallback to mock embeddings" was a bug (`#1516`), it fixed the **trigger** and **kept the fallback**. A fork-only semantic gate therefore re-flags upstream's intentional design on every sync (the fork is thousands of commits ahead and syncs continuously) — unbounded allowlist churn and merge conflicts on the exact hardened lines. And the precedent is concrete: `check-undiscriminating-catches.mjs` already carries **262 allowlist entries** against 1285 scanned (~20%). A 98%-FP 3b would add ~41 day-one entries — more allowlisted than caught, i.e. theatre.

## Decision Drivers

* **Fix the real bug, don't build a gate against a phantom regression** — the genuine data-loss/dishonest-success subset is finite and known; bulk-fixing it closes the actual harm today.
* **Gate only what is statically decidable AND a true violation** — the "`success:true` in a catch with no sibling discriminator" shape is mechanically detectable, and `:525` is unambiguously a violation; but cli/src-wide that lexical rule also flags honest discriminated sites (~6-7 FP), so it is an advisory signal, not a clean gate. Degraded-but-correct values are not statically separable from violations and must not be gated.
* **Don't re-litigate ADR-0191** — its Cluster B controller-routing catches and native-accelerator degradation are protected; any rule that flags them is wrong by prior decision.
* **Respect the squelch line** ([[feedback-skip-accepted-as-squelch]]) — a gate whose allowlist dwarfs its catches is false confidence; don't ship one.
* **Minimise upstream-merge tax** — scope the fork-only override to genuine data-integrity violations where the fork legitimately diverges, not to upstream's resilience architecture.
* **The durable enforcement of "honest about what happened" is type design + tests, not syntax** (ADR-0191's own conclusion) — a typed `Result<T,E>` discriminator makes failure observable at the type level; integration tests catch behavioural dishonesty syntax can't.

## Considered Options

* **Option A — ESLint rule banning `catch { return <literal> }`.** Syntactic; misses the real shapes.
* **Option B — ts-morph arch-test for semantic patterns.** Needs a type-checker the project doesn't have; ~98% FP on the degradation corpus.
* **Option C — Convention only.** Already proven insufficient for the genuine data-loss bugs.
* **Option D — Combined: 3a + 3b + 3c + helper library + allowlist (original draft).** Premise false, inventory wrong, 3b unshippable, gate rots. Rejected.
* **Option E (chosen) — Targeted: bulk-fix the genuine dishonest-success/data-loss subset; ship the helper library; add a fixed regression assertion for the genuine envelope site(s) (a permanently-advisory counter at most, not a promotable gate); drop 3b; enforce the semantic layer via typed `Result` + review + integration tests.**

## Decision Outcome

**Chosen: Option E.**

1. **Reframe and re-derive the corpus.** Replace "≥29 new violations" with the verified, categorised inventory: the genuine *dishonest-success/data-loss* subset only (the `:525` `embeddings-tools` empty-envelope + the four `:630/:656/:686/:727` SONA sites for protocol-boundary disposition; `neural-tools` runtime-throw; ~20-27 corrupt-JSON-collapse sites; the agentdb mock-embedding cluster). Honest degradation (the 42-site `this.X=null` accelerator corpus, ENOENT→default loaders) is explicitly **not** a violation.

2. **Bulk-fix the genuine subset directly** (the highest-value, lowest-risk work):
   * `embeddings-tools.ts` — **only `:525` is a genuine empty-envelope violation** (change `{ success: true, results: [] }`-on-failure to `success: false` / a `Result` error variant). The other four cited sites (`:630/:656/:686/:727` — the SONA drift/consolidate/adapt/status catches) already return a **non-empty `{enabled:false, reason}` discriminator** — honest *at the payload*, so do **NOT** blanket-flip them to `success:false` (that would regress an honest discriminator). Their real defect is *protocol-level*: `mcp-server.ts:695` flattens a returned `success:true` onto the success path (`trackRequest(...,true)`; `isError` is set only on `throw` at `:697`), so an absent intelligence module is recorded as a successful call. Disposition by surfacing the failure at the protocol boundary, not by rewriting the payload.
   * `neural-tools.ts` — surface the hash-fallback on a *runtime* provider throw (set the note unconditionally / rethrow), not only when the model was `'none'`.
   * Corrupt-JSON-collapse (~20-27 sites) — for any loader whose catch swallows `SyntaxError` after a present `existsSync` guard, rethrow `SyntaxError` (corruption is not absence — silent overwrite is data loss). Use the canonical template `wasm-agent-tools.ts:79-90`. **Per-site, not a blanket sweep:** rethrow on the **live** store path, but NOT where the swallow is on a *legacy-migration* path (e.g. `memory-tools.ts:97`'s `legacyPath`), where a corrupt legacy file must not crash the migration the system is trying to move past.
   * Mock/hash embeddings (`EmbeddingService`, agentdb) — gate the degradation behind an explicit `mockEmbeddings: true` and rethrow true fatals, per the ADR-0177 fatal-rethrow precedent (`EmbeddingDimensionMismatchError`); the explicit-`mockEmbeddings:true`-flag half is the audit's F-04-004 recommendation, not ADR-0177. Handle as code, not via a fork-only linter that fights upstream every sync.

3. **Ship the helper library** (genuine value, low cost), in the appropriate fork package (shipped via codemod — NOT `ruflo-patch/lib/`):
   * `tryOptionalImport` — already exists (`forks/ruflo/v3/@claude-flow/cli/src/utils/optional-import.ts:38`); document it.
   * `loadStoreOrCreate<T>(path, parse, default)` — net-new; encodes existsSync→default, parse-failure→throw.
   * `Result<T,E>` discriminator — net-new; the typed substrate that makes "honest absence" observable.

4. **Add a fixed-site regression assertion — NOT a promotable gate.** A faithful prototype of the lexical "`success:true` inside a catch" rule, run cli/src-wide (both scan roots, as the production `check-*.mjs` family does), returns **~12 hits with ~6-7 false positives** (the cancellation-discriminated `init.ts:888`/`task.ts:653`/`session.ts:338,793` sites; the `filtered:false` `agentdb-orchestration.ts:618` site; etc.). The "exactly 5, zero FP" figure was an artifact of prototyping against `embeddings-tools.ts` alone. So this rule **cannot** meet a "FP=0 + allowlist≈0" promotion precondition, and a wired `exit 1` gate would brush the same squelch line as the 262-entry predecessor. Instead: ship a **fixed integration/regression assertion** over the known `embeddings-tools.ts` envelope site(s) (a forced failure must return `success:false`), and — if a build-time signal is still wanted — a **permanently-advisory** counter keyed on the tighter shape "`success:true` in a catch with **no sibling discriminator key**" (matches `:525`, excludes the honest `reason`-carrying sites). **Drop the "advisory→`exit 1` promotion" framing**; do not present an un-promotable advisory as enforcement.

5. **Drop 3b entirely** (state-flag-flip / ts-morph). Recorded as evidence-deferred: it requires (a) bringing `forks/agentdb/src` into scan scope — which imports the 42-site legitimate-degradation corpus; (b) a type-checker the project deliberately avoids; (c) deciding degraded-value-correctness, which is not static. Its empirical FP is ~98% and its unique yield is one out-of-scope site. Revisit only if a real, reachable, non-discriminated state-flag-flip *regression* appears after Option E lands.

6. **Drop 3c-as-specified.** Its target set ("loaders lacking `existsSync`") is empty. The genuine residual (corrupt-JSON-collapse) is handled by the bulk-fix in step 2 + `loadStoreOrCreate`; only add a detector for it if a fresh corpus walk finds a recurring count worth gating, and only as a mechanical `SyntaxError`-not-discriminated rule.

7. **Durable semantic enforcement = type design + review + integration tests**, per ADR-0191. The `Result<T,E>` substrate (step 3) plus review of new error-handling plus integration tests that assert real-vs-degraded behaviour are what enforce "honest about what happened" — not a syntactic gate-per-shape arms race.

### Confirmation

* **Bulk-fix verified by behaviour, not syntax:** integration tests assert that a failed `embeddings_*` call returns `success: false` (not empty-but-true), that a corrupt store file causes a loud error (not silent reset), and that mock embeddings are reachable only with `mockEmbeddings: true` set. These are the tests ADR-0191 says are the real signal.
* **Fixed regression assertion (step 4):** an integration test asserts the known `embeddings-tools.ts` envelope site(s) return `success:false` on a forced failure (not empty-but-true). Any build-time counter ships **permanently advisory** (`exit 0` + count), keyed on "`success:true` in a catch with no sibling discriminator"; there is **no** promotion-to-`exit 1` path (the lexical rule carries ~6-7 cli/src-wide false positives, so a wired gate would need a day-one allowlist — squelch theatre). It stays out of `ruflo-publish.sh`'s blocking set.
* **No re-litigation:** the detector MUST NOT flag any ADR-0191 Cluster B catch or any native-accelerator `this.X=false` degradation; a test fixture of 3-4 such legitimate catches asserts zero flags.
* **Scope honesty:** the ADR does not claim to cover `forks/agentdb/src` (unscanned) or the ≥20 hook sites (different surface); those are named as out-of-scope, not silently missed.
* **Corpus re-derivation:** the "≥29" figure is replaced in this ADR by the categorised count before any rollout.

### Consequences

* Good, because the genuine data-loss/dishonest-success bugs get fixed directly and verified by behaviour — the actual harm closes now.
* Good, because the `Result<T,E>` + `loadStoreOrCreate` helpers give a real "do this instead" substrate and make honest absence type-observable.
* Good, because the one advisory detector targets a statically-decidable true-violation shape with near-zero FP, shipped advisory-first — it cannot rot into a squelch.
* Good, because dropping 3b avoids a ~98%-FP gate, an agentdb scan-scope expansion, a ts-morph dependency, and re-litigating ADR-0191's protected catches.
* Good, because the fork's no-fallbacks override is scoped to genuine data-integrity violations, minimising the merge tax against upstream's resilience architecture.
* Bad, because "honest degradation vs dishonest success" requires human/test judgment on the residual sites — there is no full automation. This is inherent (correctness-of-degraded-value isn't static), not a gap this ADR could close.
* Bad, because the helpers are net-new fork code shipped via codemod; engineers must learn `loadStoreOrCreate`/`Result` exist.
* Neutral, because the two existing syntactic gates are unchanged and keep passing.
* Neutral, because future novel dishonest shapes will still need case-by-case handling; the policy is enforced by types+tests+review, which scale better than a detector per shape.

## Pros and Cons of the Options

### Option D — original combined detector
* Good, because reuses existing scaffolding for the syntactic parts.
* Bad, because the premise (regression) is false; the inventory is miscounted (3c target set empty); 3b is ~98% FP with one out-of-scope true positive; the gate rots (342-entry precedent); it fights upstream's by-design fallbacks on every sync.

### Option E — targeted bulk-fix + helpers + one narrow advisory detector (chosen)
* Good, because fixes the real, finite subset and verifies by behaviour.
* Good, because the only gate it ships is narrow, statically-decidable, and squelch-resistant (advisory-first, allowlist-bounded).
* Good, because it honours ADR-0191's lesson (types+tests, not a detector for an undecidable semantic).
* Bad, because no full automation of the honest-vs-dishonest judgment — accepted as inherent.

### Options A / B / C
* A — syntactic, misses the real shapes. B — needs an absent type-checker, ~98% FP. C — convention alone proven insufficient for the data-loss bugs. (Option E folds in C's review element plus the concrete fixes and the narrow gate.)

## Swarm review evidence (2026-05-20)

Six-expert review; all claims verified against fork HEAD and upstream `ruvnet/ruflo`.

* **Detector Architect** — existing detectors are zero-dep char-scanners scanning only cli/agentic-flow (not agentdb). 3a's true literal-returns are honest `string|null` sentinels; 3c's "no existsSync" target set is empty (guards present); 3b targets out-of-scope agentdb, needs absent ts-morph, breaks the zero-dep invariant. Helpers: `tryOptionalImport` exists, `loadStoreOrCreate`/`Result` net-new. Verdict: re-spec/cut.
* **Code Archaeologist** — the 29 sites predate the detectors (Jan 2026 + fork-init); not a regression. ADR-0191's lesson: tooling can't tell contract from paranoia, "only integration tests can." Bulk-fix + mechanical checks; defer 3b.
* **Upstream Analyst** — no upstream no-fallbacks policy; all sites upstream-inherited; upstream ships fallbacks as features (241 comments, `#230` enhancement; `#1516` fixed the trigger, kept the fallback). Fork-only gate = perpetual merge tax. Support mechanical slice; reject 3b.
* **Verification Engineer** — confirmed "1283, all discriminate"; F-08-005 "14 lacking existsSync" → 0 of 21; F-08-004 is 5 not 4; 3b ≈98% FP (41/42) on a 42-site corpus dominated by legitimate accelerator degradation + protected Cluster B; allowlist already 342/1283 (27%). Ship narrowed 3a only; drop 3b; replace 3c with a corrupt-JSON rule only on fresh evidence.
* **Devil's Advocate** — premise false (all four artifacts dated same day); 3b doesn't match its own showcase (EmbeddingService has rethrow+10 warns, not "only statement"); 3a/3c miss their flagship targets; predecessor gate already a 342-entry squelch; biggest cluster (≥20 hooks) out of scope. Drop Option D; bulk-fix + helpers + maybe narrowed 3c.
* **Queen** — synthesis: gate dishonest-success/data-loss, not honest degradation (the undecidable distinction syntax can't make); Option E.

### Second council re-validation (2026-05-22)

A fresh 6-expert council re-verified ADR-0209 against fork HEAD + upstream. **Option E's direction re-affirmed** — the diagnosis (not-a-regression; the "14 loaders lacking existsSync" target set is empirically 0; 3b is genuinely ~98%-FP/undecidable) is sound, and dropping 3b leaves no real gap (the one genuine dishonest site, `EmbeddingService:101`, is out of scan scope and handled by step 2's bulk-fix). Two **substantive** corrections and a set of numeric fixes were folded in:

* **Bulk-fix scope narrowed (step 2):** of the 5 cited `embeddings-tools` envelopes, only `:525` is a genuine empty-envelope violation. `:630/:656/:686/:727` (the SONA catches) return honest `{enabled:false,reason}` discriminators — *do not* flip them to `success:false`; their real defect is protocol-level (`mcp-server.ts:695` records a returned `success:true` as a successful call). The genuine reachable subset is ~1 envelope + `neural-tools` runtime-throw + a judgment-dependent ~20-27 corrupt-JSON loaders + the out-of-scope agentdb cluster.
* **Detector reframed (step 4):** the "exactly 5, zero FP" claim was an artifact of file-scoped prototyping; cli/src-wide the lexical rule returns **~12 hits / ~6-7 FP**, so it **cannot** be promoted to `exit 1` without a day-one allowlist (squelch theatre). Replaced the "advisory→`exit 1` promotion gate" with a fixed regression assertion over the known envelope site(s) + an explicitly permanent-advisory counter keyed on "`success:true` in a catch with no sibling discriminator."
* **Corrupt-JSON rethrow is per-site, not a sweep** — `memory-tools.ts:97`'s swallow is on the *legacy-migration* path, where rethrowing `SyntaxError` could crash migration; rethrow only on live-store paths.
* **Numeric corrections:** the live allowlist is **262 entries / 1285 scanned (~20%)**, not "342 / 27%" (a content-keying refactor, `fcab2bc`, post-dated the original count); wiring is `ruflo-publish.sh:471,484`; ~21→~20 loaders; "identical shape" softened (EmbeddingService rethrows + warns first); ADR-0177 owns the *rethrow* precedent while the explicit-`mockEmbeddings` flag is audit F-04-004.

**Upstream + devil's-advocate minority:** because the detector's shape is upstream's deliberate idiom and its enforcement value is unevidenced (no demonstrated post-gate regression), consider dropping the build-time counter entirely and relying on the fixed regression assertion + the `Result`/`loadStoreOrCreate` helpers (landed only with their first real caller) + integration tests. Recorded for batch ratification; Option E's direction stands.

## More Information

Lifecycle dates from the original record: accepted 2026-05-19, implemented 2026-05-22. This ADR was swarm-reviewed.

* **ADR-0082** — parent policy (Rule 3: no silent product fallbacks).
* **ADR-0191** — undiscriminating-catch triage; Cluster A/B/C/D/E taxonomy; release-3 lesson "only the integration-test signal can" tell contract from paranoia (lines 481-499); 342-entry baseline allowlist (Phase D).
* **ADR-0177** — `EmbeddingDimensionMismatchError` fatal-rethrow precedent. (The *explicit `mockEmbeddings:true` flag* half of the mock/hash fix is the audit's F-04-004 recommendation, not ADR-0177.)
* **ADR-0201** — the audit; its "≥29" cross-cutting count is re-derived and categorised here.
* **Detectors / allowlists** — `scripts/check-silent-catches.mjs` (0 allowlist entries), `scripts/check-undiscriminating-catches.mjs` (~262 entries / 1285 scanned), wiring `scripts/ruflo-publish.sh:471,484`. Scan roots exclude `forks/agentdb/src`.
* **Genuine-violation sites** — `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/embeddings-tools.ts:525,630,656,686,727`; `neural-tools.ts:147-176`; `forks/agentdb/src/controllers/EmbeddingService.ts:87-127` (out of scan scope; fatal already rethrown at :90).
* **Honest-degradation sites (NOT violations)** — `WASMVectorSearch.ts:255-256`, `HNSWIndex.ts:465`, `RvfBackend.ts:288`, `AttentionWASM.ts:106`, `LearningSystem.ts:140`, and the ADR-0191 Cluster B routing chains (`memory-tools.ts:594/613/632`, `hooks-tools.ts:1069/1090/1118`).
* **Canonical template** — `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/wasm-agent-tools.ts:79-90` (existsSync→default, parse→throw).
* **Upstream** — no detectors/policy; `#1516` (fix trigger, keep fallback), `#230` (fallback-as-enhancement), `ruflo-hook.sh:13-14` (always exit 0).
* **Memory** — [[feedback-no-fallbacks]], [[feedback-no-squelch-tests]], [[feedback-skip-accepted-as-squelch]], [[feedback-best-effort-must-rethrow-fatals]], [[feedback-corpus-evidence-before-feature-work]], [[feedback-trace-before-hypothesis]], [[feedback-upstream-means-upstream]].

## Amendment — 2026-05-23 (Move A audit, implemented)

Status flipped: **proposed → implemented** (per Move A Phase C audit).

**Verified shipped:**

- Step 2 bulk-fix at the cited envelope: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/embeddings-tools.ts:525-527` returns `success: false` with `error:` field, pinned with `// ADR-0209 Option E item #2 — Database not available:` marker.
- Step 4 fixed regression assertion: `forks/ruflo/v3/@claude-flow/cli/__tests__/arch/adr0209-no-fallbacks-envelope.arch.test.ts` — 2 assertions (success:false pin + honest `error:` field). Passes via `npx vitest run` in 1ms.
- Step 3 partial: `tryOptionalImport` exists at `forks/ruflo/v3/@claude-flow/cli/src/utils/optional-import.ts:38` (pre-existing). `loadStoreOrCreate` and `Result<T,E>` deferred to first real caller per the ADR's own upstream/devil's-advocate minority note — not gating.

**Explicitly NOT shipped (and not required per the ADR's own decisions):**

- Step 4's permanently-advisory cli/src-wide counter (ADR recommends weighing dropping it; the fixed arch-test discharges the enforcement obligation).
- Step 5 dropped 3b (state-flag-flip) — by ADR's own decision.
- Step 6 dropped 3c-as-specified — by ADR's own decision (empty target set).

Confirmation aligns with [[feedback-no-fallbacks]] (genuine data-loss bug fixed at source) and [[feedback-skip-accepted-as-squelch]] (no allowlist-dwarfing-catches gate shipped). This is fork-original work — no INTEGRATION-LEDGER row (upstream actively SHIPS fallbacks as design; the ADR's Option E narrows the fork-only override to data-integrity violations).
