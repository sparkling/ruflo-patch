# ADR-0194 corpus gap analysis

**Question**: do real autopilot subjects exhibit the cross-lexical
failure case Phase 2 misses?

**Date**: 2026-05-19

**Method**: walked production data sources; ran Phase 2's exact
`_aggregatePatterns` algorithm
(`forks/agentic-flow/agentic-flow/src/coordination/autopilot-learning.ts:615-637`);
identified orphan subjects; computed pairwise cosine similarity over
all 124 subjects using `Xenova/all-mpnet-base-v2`
(per memory `reference-embedding-model`); classified pairs as
"shared-token" (Phase 2 catches) vs "cross-lex" (Phase 3 would
catch) and bucketed by similarity.

## Corpora walked

| Source                                                   | Subjects | Notes                                                                                       |
| -------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------- |
| `~/.claude/tasks/<team>/*.json`                          | 124      | All 124 unique; canonical `discoverTasks()` source (`autopilot-state.ts:219-242`)           |
| `.swarm/memory.db` episodes (`session_id='autopilot:%'`) | 0        | 17 DBs walked; 5 have current schema with `episodes` table, all empty for autopilot session |
| `.claude-flow/swarm-tasks.json`                          | 0        | `find /Users/henrik -name swarm-tasks.json` returned zero files                             |
| **Total (deduplicated)**                                 | **124**  |                                                                                             |

Notes:

- The `episodes`-table DBs (`ruflo-patch`, `hsbc-graph`, `opda`,
  `zed-rdf`, `forks/ruv-FANN/cuda-wasm`, `personal/graph/tests`,
  `ruvnet/ruv-FANN/cuda-wasm`) are empty (`COUNT(*) = 0`).
  Remaining DBs are an older schema (`memory_entries`/`patterns`/
  `trajectories`) that predates the autopilot episode landing.
  `personal/shacl` is corrupt. So the autopilot episode store has
  not yet accumulated production rows; subject-text signal lives
  entirely in `~/.claude/tasks`.
- The team task directory contains 96 team folders; 124 task JSON
  files are deepest-level (`<team>/<n>.json`). Each parses cleanly
  and produces a `subject` field via
  `data.subject || data.title || file`. No empty subjects.

## Phase 2 output on combined corpus

- Tokens with `count >= 2`: **97**
- Top 10 by frequency:

  | Count | Token       |
  | ----- | ----------- |
  | 17    | `phase`     |
  | 16    | `adr-0182`  |
  | 11    | `commit`    |
  | 10    | `batch`     |
  | 9     | `adr-0181`  |
  | 7     | `(ruflo,`   |
  | 6     | `commits)`  |
  | 6     | `blocked:`  |
  | 5     | `audit`     |
  | 4     | `adr-0170`  |

- Subjects that produce zero patterns (orphan rate — no ≥4-char
  token shared with any other subject): **11 / 124 = 8.9%**
- Subjects with zero tokens ≥4 chars at all (degenerate input): 0

All 11 orphan subjects:

```
[ 67] Compare outputs vs src/deprecated + SDS DB schema docs
[ 70] Decide on RegisterReadOpts.invariants extension (ADR-0180 §Read-path return shape)
[ 88] Loop termination — all 4 goal conditions
[ 92] N=8 verified beyond retry-budget reach (empirical)
[ 93] Optional: ADR-0166 trigger-driven decision
[103] Read source material for ADR briefings
[104] Refactor handler-barrel imports to defeat TDZ workaround
[105] Remove forks/ruflo/v3/mcp/tools/ dead tree (DEFERRED — keep on list)
[109] RVF/SQLite persistence cluster — architectural escalation
[110] Schema-validate drift: envelope-wrapper
[117] Validate 13 IA/ADR pairs (0171–0183)
```

A human reader sees these as 11 heterogeneous one-offs, not a coherent
semantic cluster.

## Embedding-similarity pair distribution

Pairwise cosine similarity over all 124 subjects, classified by
whether the pair shares ≥1 ≥4-char token (Phase 2 catches it) vs
not (only Phase 3 could catch it):

| Bucket          | sim ≥ 0.75 | sim 0.6–0.75 | sim 0.4–0.6 | sim < 0.4 |
| --------------- | ---------- | ------------ | ----------- | --------- |
| shared-token    | 1          | 48           | 257         | 196       |
| cross-lex       | **0**      | **5**        | 575         | 6 544     |

Total pairs: 7 626.

`MemoryConsolidation`'s precedent threshold is **0.75** cosine
(`MemoryConsolidation.ts:298-341`, `clusterThreshold` default —
the ADR explicitly cites this as the threshold to copy). At that
default, **the cross-lex bucket is empty**. Phase 3 would discover
zero new clusters at the default threshold.

Even relaxing to 0.6, only 5 cross-lex pairs cross the bar — and
those 5 pairs are mostly accidental:

```
0.61  ADR-0181 Phase 5 — F4-3 cli delegation                              ↔ ADR-0182 L4 row doc update — over-reach + root-isolation lessons
0.60  ADR-0181 Phase 5 — F4-3 cli delegation                              ↔ ADR-0182 L6: baseline capture (PREREQUISITE)
0.64  ADR-0181 Phase 7 — full-system verification                         ↔ ADR-0182 L6: baseline capture (PREREQUISITE)
0.62  ADR-0182 L1 — DROPPED with documented trigger (empirical retry…)    ↔ Optional: ADR-0166 trigger-driven decision
0.62  AgentDB MCP read-tool round-trip tests                              ↔ Unit-level fail-loud invariant test for AgentDBBackend
```

Three of the five are different ADRs incidentally describing similar
implementation shapes; one is a test-flavour echo. None is a "react
bug fix ↔ frontend defect resolution"-style semantic kinship the ADR
posits as the gap.

## Semantic groups Phase 2 fails to catch

Synthetic intent categorisation (word-list membership over the
corpus) shows what *should* be cross-lexical clusters if the
ADR's failure case were live. Each row is one human-recognisable
intent; "cross-lex pairs" counts pairs of subjects within the
intent group that share **no** ≥4-char token.

| Intent             | Members | Cross-lex pairs    |
| ------------------ | ------- | ------------------ |
| fix-bug            | 19      | 163/171 (95%)      |
| commit-publish     | 15      | 50/105 (48%)       |
| audit-review       | 12      | 54/66  (82%)       |
| cleanup-remove     | 11      | 44/55  (80%)       |
| test-verify        | 11      | 45/55  (82%)       |
| block-defer        | 7       | 6/21   (29%)       |
| refactor-rewrite   | 6       | 12/15  (80%)       |
| document-update    | 5       | 6/10   (60%)       |
| optimize-perf      | 5       | 6/10   (60%)       |
| wire-integrate     | 5       | 3/10   (30%)       |

By the word-list view alone, these look like exactly the cross-lex
gap ADR-0194 targets. **The embedding result above contradicts that
reading.** When the model is asked "are these actually similar in
meaning?", the answer is "barely". The intent categories are human
abstractions; in subject-string space the 19 "fix-bug" tasks span
`Diagnose validate-phase exit 2`, `Ergonomic fix: RvfBackend.tryNativeInit`,
`Investigate napi-rs v3 idents.length`, `[NEXT SESSION] Investigate`,
`Cache node_modules between releases` — they share an intent verb
but their objects (napi-rs, RVF, validate-phase, node_modules) are
genuinely different domains. Embedding cosine reflects that and
declines to cluster them.

The conclusion is sharper than expected: Phase 2's token-sharing
correlates well with embedding similarity in this corpus, because
the corpus is dominated by recurring identifier tokens (`adr-0182`,
`phase`, `batch`, `commit`) that ARE the semantic anchors. The
fix/audit/cleanup verbs are too generic for embedding clustering to
treat them as a kinship signal — exactly the opposite of the
"react bug fix" hypothetical, which is short enough to be dominated
by its intent token rather than its object.

## Verdict

**Gap is NOT EXHIBITED in current production data. Phase 2 is
empirically sufficient.**

Specific numbers driving the call:

- Cross-lexical pairs above the 0.75 default cluster threshold:
  **0 / 7 626**.
- Cross-lexical pairs above a relaxed 0.6 threshold: **5 / 7 626 =
  0.07%**, and those 5 are accidental cross-ADR shape echoes, not
  semantic clusters Phase 2 should be grouping.
- Orphan rate (Phase 2 produces zero patterns from these subjects):
  **8.9%**, and the 11 orphans are heterogeneous one-offs, not
  hidden clusters.
- Phase 2's `count >= 2` filter already returns 97 patterns from
  124 subjects — patterns ARE being discovered, just dominated by
  project-shape tokens (`adr-NNNN`, `phase`, `commit`, `batch`)
  rather than intent verbs.

The ADR-0194 readiness criterion was stated as:

> A populated autopilot corpus exists (real or synthesised,
> N ≥ 20) where Phase 2's `discoverSuccessPatterns()` returns
> fewer patterns than a hand-labelled ground truth would predict
> — specifically, where the corpus contains at least one
> cross-lexical cluster (no shared ≥4-char tokens) that Phase 2
> demonstrably misses.

That criterion is unmet by this corpus (N = 124, well above the
N ≥ 20 floor). Hand-labelling produced 10 plausible intent
categories, but the embedding model confirms they are NOT
high-cosine clusters in this corpus's actual subject-string space.

**Recommendation**: leave ADR-0194 at `proposed` and downgrade the
priority signal. The corpus that would justify Phase 3 must look
materially different from current production — likely populated
autopilot episodes from many independent sessions where intent
verbs anchor short subjects (closer to issue-tracker text) rather
than this project's long subjects dominated by ADR identifiers.

A second look should be triggered by either of:

1. The autopilot `episodes` table accumulating ≥ 200 rows with
   `session_id = 'autopilot:phase1'`. Current count across all
   17 walked DBs: 0. The cost of this gap analysis was a few
   minutes; it can be re-run cheaply when episode volume arrives.
2. A change in subject character — e.g. shorter free-text
   subjects where intent verbs dominate. Today's subjects are
   structured project labels; the ADR's hypothetical
   ("react bug fix", "fix slow query") are not the shape of work
   ruflo actually executes.

## Open questions / caveats

- **Embedding model choice.** The check uses `all-mpnet-base-v2`
  per memory `reference-embedding-model`. Phase 3 would use the
  same model via `AgentDBService.generateEmbedding`, so the
  similarity bands are directly comparable. A different model
  (e.g. a sentence-T5 with longer context training) could
  surface higher cross-lex similarities; not investigated.
- **Subject vs full episode text.** Phase 2 hashes the
  `subject` field. Episodes additionally carry `input`/`output`/
  `critique` (per schema in `episodes` table). The full text
  may have more cross-lexical content. ADR-0194 explicitly
  operates on `episode.subject` only, so this analysis is
  faithful to what would change. If a future Phase 3+ widens
  to `input + subject`, the gap could re-open and this analysis
  becomes stale.
- **Task subjects ≠ episode subjects exactly.** `discoverTasks()`
  reads team tasks for matching against incomplete work
  (`_matchByIncomplete`, `autopilot-learning.ts:639-652`).
  `_aggregatePatterns` runs on stored `AutopilotEpisode.subject`
  values written by `_record`. Today those are seeded from the
  same task discovery flow, so the corpora overlap, but a
  future change to how episodes get their subject text could
  drift the two. Worth re-running this analysis if `_record`
  starts capturing subjects from a different surface.
- **Threshold sensitivity.** The verdict holds at 0.75 (zero
  cross-lex hits) and at 0.6 (five hits, all accidental).
  Below 0.5 the cross-lex bucket fills with thousands of
  weakly-similar pairs which would over-cluster and produce
  worse output than Phase 2. There is no threshold band in
  which Phase 3 strictly improves on Phase 2 for this corpus.
- **Cardinality of empty autopilot episode tables.** Five DBs
  have the new-schema `episodes` table with zero
  `autopilot:%` rows. This is consistent with autopilot
  having shipped but not having generated production traffic
  yet. The gap analysis should be re-run when episode volume
  exists, since the `task` field stored in episodes may differ
  in shape from team-task `subject` strings.
- **Project-identifier dominance.** Top Phase 2 tokens are
  project-internal identifiers (`adr-0182`, `phase`, `batch`),
  not domain concepts. If autopilot is being asked to learn
  patterns about "what kinds of work succeed", those tokens
  encode "which workstream" rather than "what task type".
  Whether that's the signal we want is a Phase 2 quality
  question separate from ADR-0194's clustering question.
