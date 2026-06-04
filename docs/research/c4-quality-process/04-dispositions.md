# C4 Quality & Process — Dispositions

**Protocol:** ADR-0292 step 6. **No implementation here** — proposals + checkpoints only. Synthesized
by the queen from `01-upstream-proof.md` (upstream-prover), `02-fork-diff.md` + `03-patch-audit.md`
(fork-auditor), and the devil's-advocate cross-examination (independent re-drives both envs; one
material correction N1 + qualifications N2–N4; errata folded into 01–03 and into ADR-0294/C2-02 on
2026-06-04). Re-convergence ADR: **ADR-0296**.

**DA verdict summary:** every load-bearing verdict UPHELD. The filename contradiction reproduced
byte-identically (airtight, sharpened to two axes); the worker-posture and detect/short-flag items
settled as PARITY/shared-drift; `useRuVector` settled as a dead flag BOTH sides. Material correction
N1: `graph_edges` is populated by the post-task/trajectory reinforcement path — the inherited
regression narrows to the `agentdb_causal-edge` write path (ADR-0294 R1 premise amended; fix
unaffected).

## Disposition table

| # | Divergence | Class | Disposition | Rationale |
|---|---|---|---|---|
| — | **adr/ddd causal edges starve the graph surface** (the category's one regression — `agentdb_causal-edge` writes never reach `graph_edges`; the adr plugin is the path's primary intended consumer) | FORK-REGRESSION (inherited) | **OWNED BY ADR-0294 R1** (implemented, in DA review) | Not C4-originating; C4 records the consumer impact. Premise narrowed per DA N1 (post-task/trajectory DO populate `graph_edges`; the causal-edge path is what's severed). Post-release: re-drive the adr-plugin composition (`adr import → causal-query` AND a causal-edge → graph-query round-trip). |
| **F1** | **adr filename contract — two-axis contradiction (the C4-material finding).** Prefix axis (BREAKING): plugin `adr-create` SKILL prescribes `NNNN-<slug>.md` (no prefix) while the plugin command + the canonical `agentdb index` REQUIRE `ADR-*.md` — a skill-following project is **un-indexable** (DA repro: skill-shaped file → EXIT 1; prefixed → EXIT 0; no normalization rescues). Digit axis (latent): command says 3-digit `ADR-NNN` vs 4-digit everywhere else | doc-contract defect | **FIX BOTH SURFACES** | Plugin command → `ADR-NNNN-<slug>.md` (4-digit, prefixed); plugin skill → require the `ADR-` prefix. The index glob is the project-canonical contract (matches the corpus, ADR-0271 prefixing) — docs converge on it, not vice versa. *Acceptance:* grep-contract check — both plugin surfaces state the canonical form; a skill-shaped example filename in either doc fails the check. |
| **F2** | **Doc-drift batch (LOW, fork-side):** jujutsu skill "with the diff" vs real `ref` arg; adr skill arg-shapes vs live schema; adr-index skill "run import.mjs" stale vs canonical `agentdb index`; testgen `coverage-gaps --limit` CLI flag phantom (MCP `limit` works both sides — narrowed by prover); `-t`/`-p` short-flag EXAMPLES — *premise corrected by the ADR-0295/0296 implementation DA: the parser accepts short flags at depth-1 (`hooks route -t` works); only level-2 nested subcommands (`hooks worker dispatch -t/-c/-p`) fail via a scoped-alias depth-1 limitation + flat-global-map collision (shared upstream byte-for-byte; the C4-DA evidence drove the level-2 shape, the implementer's counter-test drove level-1 — both half-right). Re-scoped: fix the worker-dispatch `examples` to long flags (rider on next batch)*; jujutsu README v3.6 pin; `import.mjs`↔skill namespace lag (script writes `adr-patterns`+`adr-edges`; prose claims `adr-edges` retired); `useRuVector` documented-but-dead (note inert both sides; keep the param for surface parity) | doc drift | **FIX DOCS with the batch** | All cite-verified; none behavioural. |
| **J1** | **Fork registers `agentdb_causal-query`/`agentdb_hierarchical-query`** — closing an UPSTREAM doc-drift (upstream's adr skills name tools its runtime lacks); end-to-end proven (adr-index edges read back cold) | FORK-AHEAD (direction-flip) | **KEEP (recorded)** | ADR-0176-lineage premise audited demonstrated; the fork's registration makes upstream's own documented surface real. |
| **J2** | **Fork `agentdb_hierarchical-recall` durable** (7 entries cold) where upstream same-shape is stub-empty — **with the DA qualification: durable-but-NON-semantic** (returns all keys at fixed score 0.5 regardless of query) | FORK-AHEAD (qualified) | **KEEP + record the limitation** | Durability beats upstream's empty. The non-semantic ranking is a recorded known-limitation; optional enhancement candidate for the memory lane later — NOT a re-convergence item (no upstream behaviour to converge to). |
| **J3** | **`agentdb index` CLI** (ADR-0273; replaces a 780-round-trip MCP wall), `adr-verify`/`verify.mjs`, MADR + `completed:` + cross-corpus lints | FORK-AHEAD | **KEEP** | Premises audited demonstrated; no upstream equivalent ("would upstream have sufficed?" — no; upstream's adr plugin is the simpler 4-section template). |
| — | **PARITY (~21)** incl.: jujutsu 6-tool `analyze_*` family (fully functional both sides), worker posture (testgaps✓/document○ identical registries; `trigger` bypasses enablement), `worker detect` doc-prompt 0% (identical patterns both sides), sparc/ddd substrate composition, migrations-style metadata | PARITY | **NO ACTION** | DA-settled; the three NEEDS-PROVER items are all closed. |
| — | **UPSTREAM-BROKEN: 0** (one upstream DOC-DRIFT — adr skills naming unregistered tools — is closed by the fork's J1) | — | — | |

## Key tensions recorded

1. **C4's mistake-class signature = doc-drift** (ratified-decision-not-propagated-to-prose) — distinct
   from C1 (wrong-shape), C2 (necessity-not-re-justified), C3 (un-merged paired fix). Four categories
   in: **0 fabricated-brokenness premises anywhere** (21/21 here; cumulative 68/68 + the single C1
   citation artifact). The corpus disease the program feared is, on the evidence, a documentation
   disease.
2. **The filename contradiction is the program's first fork-INTERNAL contract break** (skill vs
   command vs tool — three fork-shipped surfaces disagreeing), found only because the protocol drives
   docs as the spec. Worth a standing lint: plugin docs that state filename/arg contracts get
   grep-checks against the canonical tool behaviour.
3. **Dump-timing (N1)** joins cold-vs-warm in the validation-bar practice: an end-state claim needs a
   dump taken AFTER the last write of the drive, or a narrower per-path claim.

## What the C4 re-convergence ADR (ADR-0296) must contain

1. **F1** with its grep-contract acceptance check (wired per `feedback-always-wire-tests-into-cicd`).
2. **F2** doc batch. 3. **J1–J3 keeps** recorded. 4. Cross-refs: the inherited regression →
   ADR-0294 R1 (consumer-impact note + post-release adr-composition re-drive); N1 amendment trail.
5. No runtime code changes — this is a docs/contract-only category outcome.

## Go-ahead checkpoints

- F1/F2 are doc-only edits in the fork plugins + the grep-contract acceptance check; they enter the
  serial implementation lane (bundle-able with the ADR-0295 batch for efficiency — same lane, same
  DA).
- Post-release validation: adr-plugin composition re-drive (per the ADR-0294 R1 item) + the F1
  contract check green.
