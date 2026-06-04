---
status: proposed
completed: false
date: 2026-06-04
tags: [learning, intelligence, ruvllm, neural, transfer, re-convergence, fork-regression, c1, fixes]
supersedes: []
depends-on: [ADR-0292, ADR-0291, ADR-0287, ADR-0290, ADR-0086]
implements: []
---

# C1 re-convergence — fix the four real Learning & Intelligence fork regressions, record the fork-ahead justifications

## Context and Problem Statement

The ADR-0292 C1 review (executed 2026-06-04; evidence in `docs/research/c1-learning-intelligence/`,
raw drives in `/tmp/c1-evidence/`) proved every advertised upstream C1 feature works
(intelligence 24/24, autopilot 10/10, ruvllm 10/10; UPSTREAM-BROKEN in Ruflo code: 0) and classified
the fork's deltas. The headline correction: the long-suspected fork regression — trajectory tools
"disabled" — **does not exist** (`enabled:false` is `hooks_list` display metadata; the fork's
trajectory path is PARITY: runs, learns, persists `.swarm/sona-patterns.json` + RVF). The review
instead surfaced **four real fork regressions** (each verified to the ADR-0291 validation bar) and
re-justified the fork's learning additions as genuine implement-ahead. This ADR is the disposition
carrier: the corrections, the four fixes, the recorded keep-justifications, and the doc repairs.

**This ADR is `proposed` — it authorises no code.** D1–D4 are fork code edits gated on an explicit
go-ahead; D9–D11 doc/label edits ship with the implementation batch.

## Decision Drivers

* ADR-0292's null hypothesis discharged for C1: divergences classified, regressions isolated with the
  full evidence bar — fixes can be surgical.
* `feedback-no-fallbacks` / honesty posture: two regressions are fabrication/dishonest-capability bugs.
* The entire `ruflo-ruvllm` plugin surface is dead in the fork while working upstream (worst regression).
* Every fix must land with an acceptance check in `test-acceptance*.sh` + CI
  (`feedback-always-wire-tests-into-cicd`).

## Considered Options

* **Fix the four regressions + record keep-justifications + repair docs** (this ADR). Chosen.
* Bulk re-sync the C1 surface from upstream — rejected: the audit shows the fork is at parity or
  justified-ahead everywhere else; a bulk sync would unwind demonstrated improvements (D5–D8).

## Decision Outcome

Adopt the C1 dispositions table (`04-dispositions.md`) verbatim. Work items:

### Corrections (record-keeping — already applied or applied with this ADR)

* **C-1: ADR-0291 F1 retracted** (applied, commit `a6eaf2a`): fork trajectory tools are enabled and
  working; `enabled:false` is `hooks_list` display metadata (origin: commit `7162ba58c` "ML-005").
* **C-2: ADR-0287 §F10 citation footnoted** (applied with this ADR): the `enabled:false (:1510-1512)`
  citation is non-load-bearing — F10's frozen-learning premise stands on the episodes/trigger evidence,
  which the C1 review reconfirmed (episodes = 0 rows on upstream too).

### Fork-regression fixes (D1–D4 — fork code edits, go-ahead required)

* **D1 — RuVLLM WASM init skew (highest priority).** All 6 `ruvllm_*` create/config tools die with
  `mod.initSync is not a function`: the cli wrapper (`src/ruvector/ruvllm-wasm.ts`, gate at
  `src/ruvector/index.ts:211`) requires `initSync`, but vendored
  `@sparkleideas/ruvector-ruvllm-wasm@2.0.2-patch.93` is a newer wasm-bindgen build exporting
  `init`/auto-instantiate only (verified in the installed package). Fix: update the wrapper to the new
  module shape (preferred — keeps the newer wasm) or re-pin the wasm package to an `initSync` build.
  *Acceptance:* one MCP-session `ruvllm_hnsw_create → add → route` returns a real `score`;
  `ruvllm_status` reports the wasm loaded.
* **D2 — `hooks_transfer` demo-data fabrication → unwind.** Fork returns `total:40` fabricated
  patterns tagged `dataSource:"demo-data"` on an empty/nonexistent source (hooks-tools.ts:2233-2237);
  upstream returns honest `{success:false, "No patterns found"}`. Restore the honest empty return.
  *Acceptance:* `hooks_transfer{sourcePath:<nonexistent>}` ⇒ `success:false`, `transferred:0`, no
  `demo-data` marker anywhere in the response.
* **D3 — `neural_*` hash-fallback → wire to the real embedder.** `neural_train/predict/status` run on
  a hash fallback (`_realEmbeddings:false`, `cosineSimilarity:0` with `confidence:1`, 384/768 dim
  disagreement) while the fork's `embeddings_*` mpnet path works. Route the neural-tools store through
  the same real embedder; fix the `confidence@similarity:0` scoring bug. Re-verify after D1 (likely
  partly downstream of the WASM init failure). *Acceptance:* `neural_status._realEmbeddings:true`;
  a predict on disjoint text does not return `confidence:1`.
* **D4 — `neural_compress` advertised no-op → decide.** Fork: `{success:false, "Quantization not
  available — memory-initializer removed in ADR-0086 Phase 1"}`. Options: (a) honest capability
  boundary — tool reports "not supported in this build" as documented behaviour (preferred; ties to
  the ADR-0086 disposition), or (b) re-port a quantization path. Either way: no half-advertised no-op.
  *Acceptance:* the tool's response matches its documented capability statement.

### Fork-ahead justifications (recorded; no code change)

* **D5 — episode/action-value/causal cluster** (ADR-0268/0277/0279/0280; `agentdb_learner_run`,
  `agentdb_experience_record`, `agentdb_learning_predict`, reflexion-store w/ action+task_type,
  causal-recall): KEEP. Re-justification per ADR-0292: upstream has **no episode writer and no
  scheduled learner at all** (live-confirmed; ADR-0291 G3/G4) — there is nothing to "re-enable";
  this is genuine implement-ahead aligned with upstream ADR-074's stated direction. All four ADR
  premises audited DEMONSTRATED (`03-patch-audit.md`).
* **D6 — `neural_train` runtime enum enforcement**: KEEP (fork strictly more correct than upstream's
  silent acceptance of invalid types). Side doc-fix below.
* **D7 — unified `neural_patterns` read** (surfaces reasoningBank patterns): KEEP with this record.
* **D8 — ADR-0290 auto-capture trigger**: KEEP (shipped, 17/17). The G1 trigger gap it plugs is
  independently demonstrated and identical upstream; stays metadata-only per ADR-0289 decoupling.

### Doc/label repairs (bundle with the implementation batch)

* **D6-doc:** `neural-train` SKILL + `neural.md` wrongly document `--pattern-type
  coordination|edit|task`; actual schema enum is `[moe,transformer,classifier,embedding]`.
* **D9:** optionally rename `hooks_list`'s `enabled` field → `autoFire` to stop the misreading class
  that produced F1.
* **D10:** `intelligence-transfer` skill documents an IPFS/Pinata surface the tool (both sides) never
  had — document the real `{sourcePath, filter, minConfidence}` surface.
* **D11:** `ruvector embed` ONNX-bundling + `stats` redb bug are third-party (`ruvector@0.2.25`),
  identical both sides — note in vector-setup skill; no fork action.

### Consequences

* Good, because the worst regression (a whole plugin family dead) gets fixed with a deterministic
  acceptance gate; the honesty regressions (D2, D4) get unwound per the fork's own rules.
* Good, because the fork's learning additions are now *recorded* as justified fork-ahead — closing the
  "fixes built on assumed brokenness" question for C1 (9/10 premises demonstrated; the one assumed
  artifact was the F1 citation, now retracted).
* Bad, because D3's full fix may depend on D1 — sequencing risk; mitigated by re-verifying D3 after D1.
* Neutral, because D4 is a decision (honest boundary vs re-port) deferred to implementation go-ahead.

### Confirmation

Each D1–D4 fix lands with its acceptance check wired into `test-acceptance*.sh` (run_check_bg +
collect_parallel) and a CI workflow path filter; the C1 review drives (`/tmp/c1-evidence/` JSONL
inventory) re-run green against the fixed release. This ADR flips to `accepted`/`completed:true`
when D1–D4 + doc repairs are shipped and the checks are green in a release.

## More Information

* Evidence: `docs/research/c1-learning-intelligence/01..04-*.md` (upstream proof, fork diff, patch
  audit, dispositions) — produced under ADR-0292's protocol with the ADR-0291 validation bar.
* Program tracking: ADR-0292 (C1 row links here). Corrections recorded against ADR-0291 (F1) and
  ADR-0287 (§F10 citation footnote).
