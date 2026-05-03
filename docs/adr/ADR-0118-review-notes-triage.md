# ADR-0118 Review Notes Triage

- **Status**: Living tracker (per ADR-0094 pattern)
- **Date**: 2026-05-02 (initial); resolved 2026-05-02 by 15-agent triage
- **Purpose**: Consolidates open questions surfaced during MADR/SPARC critique of ADR-0119–ADR-0128.

## Summary after triage

55 questions resolved across 15 parallel agents. Final shape:

| Bucket | Count | Action required |
|---|---|---|
| **HENRIK-DECISION** | **0 (all resolved 2026-05-02)** | All 6 decisions resolved. See §Henrik decisions resolved below. |
| AUTO-RESOLVED | 25 | Answered by code-grep, memory rule, or another ADR. Resolutions logged below. |
| DEFER-TO-IMPL | 16 | Implementer documents in §Specification when code lands. No pre-decision needed. |
| DEFER-TO-FOLLOWUP-ADR | 5 | Concrete escalation trigger needed before action. Tracked for future. |
| ALREADY-RESOLVED | 3 | Source ADR's review-notes column already says `(resolved)`. |

## Henrik decisions resolved (2026-05-02)

- **H1** (Row 2, ADR-0119) → **B**: throw on undefined queen at propose/vote time
- **H2** (Row 3, ADR-0119) → **a**: accept USERGUIDE as canon for `QUEEN_WEIGHT = 3`
- **H3** (Row 23, ADR-0123) → **(i)** for T5 (SIGKILL-without-power-loss); new **ADR-0130** tracks **(ii)** true power-loss durability via RVF WAL fsync
- **H4** (Row 33, ADR-0125) → **a**: extend T7 completion to gate on separate fork-root README diff
- **H5** (Rows 15, 31, 39) → **B**: keep single-axis lift gate; shrink each affected ADR's claim to "T marked complete with Owner/Commit naming green-CI commit"
- **H6** (Rows 32, 43) → **A**: fold orphan steps via §Open questions item 3 (Row 32 → T6/ADR-0124 archive of `queenType`; Row 43 → two-phase lift inside T9)

## Henrik decisions — resolved (historical reference)

The original 6-decision specification, retained for traceability. Each decision links back to the source ADR(s) it gated:

- **H1 — Queen-absent semantics in weighted consensus** (Row 2, ADR-0119): contract-shape decision between permissive denominator math and throw on undefined queen. Resolved B (throw).
- **H2 — `QUEEN_WEIGHT = 3` rationale** (Row 3, ADR-0119): three options (accept USERGUIDE / derive paragraph / defer). Resolved a (accept USERGUIDE as canon).
- **H3 — SIGKILL durability test granularity** (Row 23, ADR-0123): (i) SIGKILL-only vs (ii) FUSE/eatmydata true power-loss. Resolved (i) for T5; (ii) split into new ADR-0130.
- **H4 — ADR-0107 fork-root README copy lift gating** (Row 33, ADR-0125): T7 lift mechanism touches plugin README and frontmatter, not fork-root README. Resolved a (extend T7 to gate on fork-root README diff).
- **H5 — Annotation lifecycle lift-gate axes** (composite of Rows 15, 31, 39): 3-axis vs 1-axis gate. Resolved B (keep 1-axis, shrink each ADR's claim).
- **H6 — Orphan step folding rule** (composite of Rows 32, 43): fold-into-T default per §Open questions item 3. Resolved A (apply default; Row 32 folds into T6, Row 43 two-phase inside T9).

---

## AUTO-RESOLVED (25 rows, with answers)

### Apply `feedback-no-fallbacks.md` globally

| Row | ADR | Answer |
|---|---|---|
| 1 | 0119 | Replace entire `default:` arm of `calculateRequiredVotes` with `throw`, not just the new `'weighted'` branch. Memory rule applies globally. |
| 16 | 0122 | Throw on missing `type` in `hive-mind_memory.set`, not default to `'system'`. The "permanent retention" silent default is the exact silent-fallback anti-pattern. Edits: ADR-0122 §Specification, §Pseudocode, swap unit test `t4_default_type_is_system` → `t4_missing_type_throws`. |
| 40 | 0126 | `calculateCapabilityScore` MUST throw at scoring site when no agent of any matching type for `task.type` is in pool. Existing `score = 0.5` baseline IS the fallback. ADR-0126 §Specification needs amendment. |

### Code-grep verifications

| Row | Question | Finding |
|---|---|---|
| 4 | T1 single-file diff scope | Confirmed. `tryResolveProposal` (lines 134-163) and `calculateRequiredVotes` (lines 78-104) co-located in same file; deadlock arithmetic intrinsically tied to weighted change. |
| 9 | Raft term collision with gossip | Term-pinning explicit at `hive-mind-tools.ts:595, 597, 620` gated on `strategy === 'raft'` literal. Gossip skips entire block. No collision. |
| 19 | Env-var convention | Use `CLAUDE_FLOW_HIVE_SWEEP_MS`, NOT `RUFLO_HIVE_SWEEP_MS`. `CLAUDE_FLOW_*` is overwhelming runtime convention (~37 vars, 150+ uses); `RUFLO_*` is appliance-only (3 vars). Update ADR-0122 (3 occurrences). |
| 20 | sql.js precondition met | Single sql.js import at `rvf-migration.ts:128` is one-shot legacy reader, not active backend. Suggest ADR-0123 add caveat sentence. |
| 21 | Atomic write infrastructure preserved | `saveHiveState` (lines 201-210) does tmp+rename per ADR-0104 §5; `withHiveStoreLock` at line 214 intact. |
| 24 | Cache coherency audit clean | No module-scope `state` variable in `hive-mind-tools.ts`; all 26 callsites follow `const state = loadHiveState()` pattern. |
| 37 | Where TaskType gets assigned | No keyword classifier exists. `task.type` is set directly by caller (`task-orchestrator.ts:125`) or hardcoded literal in `queen-coordinator.ts:711-814`. ADR-0126 §Specification "trigger keyword" framing is moot — should be removed or reframed as "callers must emit literal type." |
| 45 | `monitorSwarmHealth()` duplication | Confirmed at `queen-coordinator.ts:1415`. Loop reuses, no parallelisation. |
| 46 | `partitionDetected` field | **Does NOT exist.** Pre-implementation step required: either add field to `_status`/`HealthReport`, or write follow-up ADR exposing it. Partition-asymmetric integration test cannot pass without this. |

### Editorial / documentation fixes ready

| Row | Edit needed | Target |
|---|---|---|
| 17 | Replace `rvfBackend.write(entryKey(entry.id), entry)` → `for (const [key, entry] of Object.entries(state.sharedMemory)) { rvfBackend.write(entryKey(key), entry) }` | ADR-0123 §Pseudocode line 234 |
| 51 | "5 swarm topologies" → "6 swarm topologies"; line 92 → line 90 in summary row | ADR-0116 lines 51 and 217 |
| 54 | Add R8 paragraph (sub-queen failure in hierarchical-mesh — three options: promote worker / fail sub-hive task / absorb workers; decision deferred) | ADR-0109 §Risks |

### Cross-ADR auto-resolutions

| Row | Resolution |
|---|---|
| 13 | ALREADY-RESOLVED — ADR-0121 §Review note 4 closes (kept for future T1 weighted-vote variant) |
| 29 | ALREADY-RESOLVED — ADR-0124 §Specification:198 already accepts gap; deferred until concrete tampering scenario |
| 30 | Housekeeping defer — `hive-mind-` prefix sufficient per ADR-0124 §Files:156 |
| 35 | ALREADY-RESOLVED — ADR-0125 §Review note 4 already says `(resolved)` |
| 42 | ALREADY-RESOLVED — `(resolved-with-condition)`: T7 prompt-only forces `adaptive-loop.ts` placement |
| 44 | ALREADY-RESOLVED — `(resolved)`: type-level extension at line 183 doesn't violate ADR-0105 marker |
| 48 | ALREADY-RESOLVED — `(resolved-with-condition)`: post-hoc rationale acknowledged with re-validation trigger |
| 52 | ALREADY-RESOLVED — ADR-0118 §Dependency graph already corrected (lines 41-48) |

---

## DEFER-TO-IMPL (16 rows, no pre-decision needed)

These resolve when the implementer writes `§Specification` for the relevant Tn:

- **Rows 5, 6, 7, 8** (ADR-0120): settle_check API surface; roundTimeoutMs configurability; opportunistic re-seed; partition terminology
- **Rows 10, 11, 12, 14** (ADR-0121): CRDT round termination; `Set` JSON serialisation; same-voter dual-write; `vote` action signature overload
- **Row 18** (ADR-0122): legacy migration false-positive bound
- **Row 22** (ADR-0123): cache update ordering
- **Row 31** (ADR-0124): annotation-lifecycle materialise sequencing — collapses into H5 if adopted
- **Row 34** (ADR-0125): adaptive `_consensus` rule check after T1/T2/T3 land
- **Row 36** (ADR-0126): `typeMatches` extension strategy (option a vs b)
- **Row 41** (ADR-0127): PRELIMINARY threshold values measured during integration tests
- **Row 43** (ADR-0127): T9/T10 two-phase lift — collapses into H6 if adopted
- **Row 47** (ADR-0127): flip-rate ceiling default (4/hour)
- **Row 49** (ADR-0127): mid-task switch deferral counter (only confirmed switches count)
- **Row 53** (ADR-0128): T8 prompt rendering vs protocol enforcement

---

## DEFER-TO-FOLLOWUP-ADR (5 rows, escalation triggers documented)

These remain in the tracker pending a concrete trigger:

- **Row 25** (ADR-0124): verbatim queen-prompt drift — escalates when fork build introduces non-backwards-compat skeleton
- **Row 26** (ADR-0123/0124): cross-process cache coherency — escalates when real coherency bug observed in field
- **Row 27** (ADR-0124): checkpoint-vs-active-write coherency — escalates if misleading-resume bug surfaces
- **Row 28** (ADR-0124): `schemaVersion` migration tool — escalates when v2 actually introduced
- **Row 38** (ADR-0126): non-MD prompt envelope sentinels — escalates if non-MD surface materialises
- **Row 50** (ADR-0128): USERGUIDE diagram alignment — USERGUIDE-track concern, not fork-source
- **Row 55** (ADR-0128): `swarm.mutateTopology` second consumer — escalates when manual operator command materialises

---

## Resolution log

| Date | Rows | Resolution | Source ADR updated? |
|---|---|---|---|
| 2026-05-02 | H1 (row 2) | Throw on undefined queen — Option B chosen | Pending ADR-0119 edit |
| 2026-05-02 | H2 (row 3) | Accept USERGUIDE as canon for QUEEN_WEIGHT=3 — Option a chosen | Pending ADR-0119 edit |
| 2026-05-02 | H3 (row 23) | SIGKILL-without-power-loss for T5; new ADR-0130 for true power-loss durability | Pending ADR-0123 edit + ADR-0130 creation |
| 2026-05-02 | H4 (row 33) | T7 gates on fork-root README diff — Option a chosen | Pending ADR-0125 edit |
| 2026-05-02 | H5 (rows 15, 31, 39) | Single-axis lift gate; shrink each ADR's claim — Option B chosen | Pending ADR-0121, ADR-0124, ADR-0126 edits |
| 2026-05-02 | H6 (rows 32, 43) | Fold orphan steps via §Open questions item 3 — Option A chosen | Pending ADR-0124 edit (queenType in archive) |
| 2026-05-02 | 1, 16, 40 | Apply feedback-no-fallbacks globally — replace defaults with throw | Pending ADR-0119/0122/0126 edits |
| 2026-05-02 | 17 | `entry.id` → map-iteration tuple | Pending ADR-0123 edit |
| 2026-05-02 | 19 | RUFLO_* → CLAUDE_FLOW_* prefix | Pending ADR-0122 edit |
| 2026-05-02 | 51 | "5" → "6" topology count + line 92 → 90 | Pending ADR-0116 edit |
| 2026-05-02 | 52 | Dependency graph direction | Already done |
| 2026-05-02 | 54 | Sub-queen failure R8 paragraph | Pending ADR-0109 edit |

## References

- ADR-0118 — hive-mind runtime gaps tracker (parent)
- ADR-0119 through ADR-0128 — per-task ADRs whose review notes are consolidated here
- `feedback-no-fallbacks.md` — fail-loud requirement underlying H1, H3, rows 1, 16, 40
- `feedback-data-loss-zero-tolerance.md` — durability bar underlying H3, row 20
- `feedback-no-value-judgements-on-features.md` — ship-the-full-surface posture underlying row 50
- ADR-0094 — living tracker pattern this document follows
