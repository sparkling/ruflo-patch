# C1 Learning & Intelligence — Patch-History Audit

**Protocol:** ADR-0292 step 5. For each fork ADR touching C1 surfaces, classify the **problem statement** as
DEMONSTRATED (evidence of the failure in the ADR / linked artifacts / re-confirmed here) vs ASSUMED (asserted
brokenness without production-shape proof). Plus: the provenance of the trajectory-tool `enabled:false` flag.

## The `enabled:false` provenance (the keystone the protocol flagged)

**Where:** `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts:1485-1519` — a static array **returned by
the `hooks_list` MCP tool**. `intelligence_trajectory-start/-step/-end`, `pattern-store`, `pattern-search`,
`stats`, `learn`, `attention` carry `enabled:false`; `route`, `post-task`, `session-start/-end`, `metrics` carry
`enabled:true`.

**When + why (git -S on the fork, branch `main`):** commit **`7162ba58c` "ML-005: Enable core hooks by default in
hooksList"** (sparkling, 2026-03-15, *Fixes sparkling/ruflo-patch#70*). Commit message: *"All 26 hooks were
registered but disabled. Set enabled:true for 5 core hooks (session-start, session-end, route, metrics,
post-task) so automated learning works out of the box."* The diff ADDED the `enabled` field to the `hooks_list`
output and set it `true` for the 5 auto-firing hooks, `false` for the rest. Later touched by `c2c083331` (F10
attention placeholder) and `815615b47` (ADR-0084/0086 router migration).

**What it actually means:** `enabled` here is **display metadata in `hooks_list`'s return value** describing which
hooks fire **automatically via `settings.json`**. It is **not consulted by any execution path** — the trajectory
MCP tools execute and do real SONA learning regardless (proven live, both fork and upstream-equivalent handler at
`hooks-tools.ts:2980` `trajectory-end` → `sona.processTrajectoryOutcome` + RVF persist). `enabled:false` for
trajectory tools correctly means **"not wired as an auto-fire hook"** — which is the *same* dormant-auto-trigger
state as upstream (ADR-0291 G1), NOT "the tool is off."

**Conclusion:** the chain ADR-0287 §F10 → ADR-0291 F1 → ADR-0292 expectation compressed *"trajectory tools are
`enabled:false` in `hooks_list`"* into *"the fork's trajectory tools are disabled / off the live path
(regression)."* **That compression is a wrong-shape reading** — the identical failure mode ADR-0291 was written to
prevent. The tools work in the fork.

## ADR premise classification

| ADR | Problem statement | Class | Notes (re-confirmed here?) |
|---|---|---|---|
| **ADR-0195** (autopilot-learning Phase-4 cross-controller bridges) | Three learning controllers (AutopilotLearning, LearningSystem, SonaRvfService) exist in isolation; no event surface couples them — cites file:line for each, `INTENTIONAL SPLIT` comment, producer/consumer methods. | **DEMONSTRATED** | Architectural premise with code citations. The downstream live state (episodes=0, learner not auto-triggered) is consistent. Note ADR-0291 reframes G3 (episode learning absent upstream too) — ADR-0195's "isolation" is real but the *fix* is implement-ahead (ADR-0177), not a regression repair. |
| **ADR-0211** (init-emitted hook-handler completion) | `settings.json` wires 16 hook subcommands; handler implements 11; 6 fall through to `[OK] Hook:` no-op; `post-task` hardcodes `intelligence.feedback(true)`. | **DEMONSTRATED** | Cites `helpers-generator.ts:590-592` + `:543-549`, git blame of fork over-reach (`0cd9c4a39 SG-012`) vs upstream-inherited gaps (`4b42218b4`, `15664e072`). Self-corrects the original Option-D over-reach. The `feedback(true)` poison = ADR-0291 **G6** (independently confirmed upstream). Exemplary evidence discipline. |
| **ADR-0227** (recalibrate adaptive similarity threshold for mpnet) | The "ONNX 0.3–0.95 similarity" assumption is empirically wrong for mpnet; 0.3 floor drops genuine matches in the 0.25–0.30 band. | **DEMONSTRATED** | Measured cosine table via `embeddings_compare` (RELATED 0.25–0.65, UNRELATED ~0), names the consumers that search without a threshold. Matches `project-memory-search-rvf-snapshot-isolation` memory. Empirical, reproducible. |
| **ADR-0268** (autonomous skill-promotion flywheel) | Flywheel broken at 4 points: no autonomous episode recording; consolidation starved (`episodes` empty); `GROUP BY task` (free-text) never groups; (4th). | **DEMONSTRATED** | "council, code-verified at HEAD", file:line per break. **G3 re-confirmed live here: `episodes`=0 rows upstream AND fork.** Upstream `ADR-053:531` deferred the same wiring — genuine implement-ahead, not a port. |
| **ADR-0277** (close autonomous causal learning loop) | Loop ~90% built + SQLite-consistent; the single genuinely-missing piece is an autonomous trigger for the producer (`NightlyLearner`). | **DEMONSTRATED** | Explicitly *overturns* a prior wrong "no-consumer/speculative" deferral with a file:line+live-probe closure map. Honest about what's wired vs missing. Aligns with ADR-0291 G1/G4 (no scheduled learner upstream either). |
| **ADR-0279** (episodes carry action dimension) | `episodes` records no action dim; both router consumers want `E[reward\|action,context]`; loop output can't key to the decision. | **DEMONSTRATED** | Schema-level fact (`schema.sql` columns), names exact consumers. Keystone for ADR-0280. Confirmed live: fork `agentdb_reflexion-store` now carries `action`+`task_type` props (absent upstream). |
| **ADR-0280** (causal-recall default routing hot path) | Default rank is cosine-only / online-bandit; neither consults the de-confounded action-value the loop produces → routing is associative not causal. | **DEMONSTRATED** | `intelligence.ts findSimilar` + ModelRouter cited; the blend is small/flag-gated/cosine-floored (cautious). The premise (cosine-only default) is verifiable; the fix is FORK-AHEAD over upstream. |
| **ADR-0287 §F10** (frozen learning layer) | SONA `lastAdaptation` frozen 2026-04-04; `learn` worker finds 0 episodes; learning tables empty; **dormant BY DESIGN** (no auto capture caller). | **DEMONSTRATED — with one mis-framed sub-citation** | The core claim is **correct and re-confirmed live**: `episodes`=0 (both sides), no auto-trigger (G1), trajectory tools write RVF/sona-patterns but NOT `episodes`/`sona_trajectories`/`lastAdaptation`. ADR-0287 even shows the live probe (`sonaUpdate:true, patternsExtracted:1` yet tables unmoved). **The mis-framed part:** it cites `enabled:false (:1510-1512)` as if the tool were inert — it is `hooks_list` cosmetics; the tool runs. The downstream ADR-0291 F1 inherited and *amplified* that into "fork regression: trajectory tools disabled," which is **false**. The frozen-learning premise itself stands; the enabled:false citation is the seed of a wrong-shape verdict. |
| **ADR-0289** (PII redaction before durable capture) | No redact/sanitize/has_pii step exists in the capture path; episodes carry free-text (task/input/output/code/critique) → secrets/PII into a durable embedded federated store. | **DEMONSTRATED** | Confirmed (2026-06-03) absence of any redact step; structural separability insight (routing signal = structured fields, PII = free-text) is sound. Forward-looking policy ADR; premise is a verified gap. |
| **ADR-0290** (wire automatic learning capture) | Learning frozen since 2026-04-04 (inherits ADR-0287 §F10); write chain already live (ADR-0268); **only the trigger is missing**; the live file-hook terminates in JSON sidecars and never calls the capture. | **DEMONSTRATED** | The premise = ADR-0287 §F10's *correct* core (re-confirmed live). Explicitly aligns with upstream **ADR-074** (#2245 honest-wiring → incremental automation) and frames the fix as a trigger wire, not a new subsystem, metadata-only, decoupled from PII. The 17/17 smoke proves the *mechanism*; per ADR-0292 the smoke does not prove *necessity* — but the trigger-gap premise is independently demonstrated. |

## Summary

- **9 of 10 ADRs: problem statement fully DEMONSTRATED** (file:line, live probes, measured data, council
  code-verification). This area's fork ADRs are, on the whole, evidence-disciplined — several explicitly
  *overturn* their own earlier wrong deferrals (0277) or over-reach (0211).
- **ADR-0287 §F10: DEMONSTRATED core + one mis-framed citation.** The "frozen learning / dormant-by-design /
  no-auto-trigger / episodes-empty" premise is **correct and re-confirmed live**. But its `enabled:false
  (:1510-1512)` citation reads `hooks_list` display metadata as tool-inertness, and **ADR-0291 F1 amplified that
  into a non-existent "trajectory tools disabled" fork regression** — the one ASSUMED-brokenness artefact in the
  C1 chain, and the thing this whole program exists to catch.
- **No fork C1 ADR was built on a fabricated/un-probed brokenness premise.** The patches address real gaps
  (frozen auto-capture, associative routing, threshold miscalibration, hook no-ops, PII governance). The
  *characterisation* error is narrow and downstream (F1's enabled:false framing), not in the patch premises
  themselves.
