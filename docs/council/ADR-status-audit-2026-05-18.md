# ADR Status Audit — 2026-05-18

**Scope:** 15 ADRs in `status: proposed` audited for truthful status.
**Outcome:** 6 flipped to `implemented`, 1 to `superseded`, 7 documented as
partial, 1 documented as truly open. **Zero** ADRs found to be abandoned.

## Executive summary

Many of the 15 audited ADRs had verifiably landed implementations whose
status flip was simply deferred and never reconciled. Of the headline
"5 closed-on:2026-05-18 already set" cases, ADR-0181 and ADR-0184 were
indeed mechanical flips. Of the rest, the audit found 4 more genuinely
closed ADRs (0161, 0163, 0164, 0165) — all post-verification entries
existed in the ADR body but the frontmatter was stale. Seven ADRs had
substantial partial implementation that's been quietly load-bearing for
downstream work (most notably ADR-0177 — its substrate decision is the
referent for ADR-0180/0181/0184 even though several of its own phases
remain open). One ADR (0173) was already superseded twice (0174 → 0177)
but no `superseded-by` frontmatter recorded it. One ADR (0172) is truly
open with zero fork-code references and three specific deliverables
that have never landed.

## Per-bucket counts

| Bucket | Count | ADRs |
|---|---:|---|
| A — Implemented (status flipped + `closed-on` set) | 6 | 0161, 0163, 0164, 0165, 0181, 0184 |
| B — Partial implementation (status kept `proposed`; amendment added) | 7 | 0157, 0162, 0171, 0176, 0177, 0179, 0182 |
| C — Superseded by later ADR | 1 | 0173 (→ ADR-0174 → ADR-0177) |
| D — Truly open / no implementation work to date | 1 | 0172 |
| E — Abandoned / rejected | 0 | — |

**Note on ADR-0176 reclassification:** Originally pre-classified as A
during the planning phase; DA's review downgraded to B because Phase 5
(MCP-registry boot acceptance test) is undelivered. Phases 2 + 3 landed
per fork-code refs at `agentdb-tools.ts:505, 1148` and
`HierarchicalMemory.ts:487`.

**Note on ADR-0162 reclassification:** Originally pre-classified as A
during the planning phase; DA's review downgraded to B because Batches
G/H/I/J have no commit citations and the ADR-0094 tracker was never
updated to record the close-out.

## Per-ADR evidence table

| ADR | Bucket | Status change | Key evidence |
|---|---|---|---|
| **0157** | B | none (prose-style header preserved) | adr-create skill emits MADR canonical at `forks/ruflo/plugins/ruflo-adr/skills/adr-create/SKILL.md`; ruflo-patch corpus migration explicitly out-of-scope |
| **0161** | A | proposed → implemented; `closed-on: 2026-05-08` | `forks/agentdb` exists at alpha.14-patch.217+; `forks/agentic-flow/packages/agentdb/` deleted (1,105 files); memory `project-agentdb-parallel-extraction` confirms |
| **0162** | B | none (acceptance tracker not updated, batches G/H/I/J unverified) | Batches A/B/E hand-ports cited in `forks/ruflo/.../memory-router.ts:434,883,889` and `hive-mind-tools.ts:66,241`; plan files committed under `docs/plans/upstream-sync-2026-05-09-batch-*.md` |
| **0163** | A | proposed → implemented; `closed-on: 2026-05-10` | Body amendment `2026-05-10d` ("ROOT CAUSE FOUND AND FIXED. ADR closed"); Wave-4 fix shipped; instrumentation removed in follow-up commit |
| **0164** | A | proposed → implemented; `closed-on: 2026-05-10` | Body amendment `2026-05-10f` ("Phase A0e + Phase B1 landed; full closure verified 674/674"); release `accept-2026-05-10T184434Z`; B2/B3/B4/C dead-code cleanup deferred |
| **0165** | A | proposed → implemented; `closed-on: 2026-05-10` | Body amendment `2026-05-10b` ("Verified 674/674; ADR closed"); released as `@sparkleideas/cli@3.7.0-alpha.10-patch.18` |
| **0171** | B | none | Per `project-fork-only-controllers` memory: MincutService / SparsificationService / StreamingEmbeddingService wired via commit `f790426`; HierarchicalMemory / MemoryConsolidation / RVFOptimizer / SonaTrajectoryService / SemanticRouter / GNNService / GraphTransformerService all restored from `bd760f2`. Release-verification post-`f790426` not explicitly recorded; QUIC* + Raft scaffolding-only (zero consumers) |
| **0172** | D | none | Zero fork-code refs across all forks; init template `config-template.ts:202-203` still has `hierarchicalMemory: false, memoryConsolidation: false`; ADR-0177 made Phase B's postgres substrate context stale |
| **0173** | C | proposed → superseded; `superseded-by: ADR-0174` | ADR-0174 frontmatter `supersedes: [ADR-0173]`; ADR-0174 §"What changes about ADR-0173" documents AGE not installed; ADR-0174 itself then superseded by ADR-0177 |
| **0176** | B | none (Phase 5 acceptance gate not delivered) | Phase 2 renames + Phase 3 implementation in `agentdb-tools.ts:505,1148,604` and `HierarchicalMemory.ts:487` |
| **0177** | B | none (substrate decision in force; 12 open follow-ups + multi-phase execution program partial) | ADR-0180/0181/0184 cite ADR-0177 as the load-bearing substrate referent; Amendment 2 dependency-hygiene reversal landed wholesale; Phases 1, 1.5 (reverted), 1.6, 2 (factory swap) landed; Phases 3–6 + 13 enumerated open follow-ups outstanding |
| **0179** | B | none (audit-methodology contribution survives per ADR-0180 §345-353) | Six bridge-deletion behaviors subsumed by ADR-0180/0181 (cited in `agentdb-tools.ts:276,1461`); 34-row body-diff table (Phase 1 deliverable) remains a stub |
| **0181** | A | proposed → implemented (already had `closed-on: 2026-05-18`) | Body close-out amendment + `docs/council/ADR-0181-close-out-report.md`; final acceptance 672/681 default + 681/681 heavy (patch.181) |
| **0182** | B | none (~half the levers shipped; baseline + hard gate not in place) | Levers L2/L3/L4/L6/L7/L9 in `scripts/test-acceptance.sh`; `logs/release-disk-bytes.jsonl` exists; L1/L5/L8/L10-L13 + baseline capture + auto-fail gate outstanding |
| **0184** | A | proposed → implemented (already had `closed-on: 2026-05-18`) | Body close-out amendment + `docs/council/ADR-0184-close-out-report.md`; agentdb coverage complete |

## DA review concerns + how each was resolved

DA reviewed the Phase 3 plan and surfaced 5 concrete issues plus 7
specific corrections. Each was applied:

1. **Phase 1 + 2 commit-scope verification.** Concern: ensure fork
   code wasn't accidentally swept in. Resolution: every Phase 3 batch
   commit was preceded by `git diff --name-only --staged | grep -v
   "^docs/"` returning empty before commit. SHAs 5fd6299, 30778fc,
   81e15c1, d8c9a42, 11d6033, 6ec80f3 all touch only `docs/adr/*.md`.
2. **ADR-0176 downgrade A → B.** Concern: Phase 5 (MCP registry boot
   test) is undelivered. Resolution: status kept `proposed`,
   amendment explicitly enumerates Phases 2 + 3 landed and Phase 5
   open.
3. **ADR-0162 downgrade A → B.** Concern: batches G/H/I/J have no
   commit citations; ADR-0094 tracker not updated. Resolution: status
   kept `proposed`, amendment lists landed Batches A/B/E and open
   Batches G/H/I/J.
4. **ADR-0173 bidirectional fix.** Concern: ADR-0173 needed
   `superseded-by` and a body pointer to the supersession chain.
   Resolution: frontmatter changed to `status: superseded,
   superseded-by: ADR-0174`; body adds a top-of-document note
   referencing both ADR-0174 and ADR-0177.
5. **Cite correct amendment SHAs / dates.** Concern: cite
   `2026-05-10d` for ADR-0163 (not `2026-05-10b`); set `closed-on:
   2026-05-10` for ADR-0163/0164/0165 (not today). Resolution:
   applied. Also confirmed ADR-0166 already has `superseded-by:
   [ADR-0170]` — no further change needed.

Additional DA corrections per ADR were applied to ADR-0157 (no YAML
frontmatter — prose-style preserved), ADR-0171 (specific commit
`f790426` cited), ADR-0172 (three specific undelivered deliverables
named), ADR-0177 (substrate-decision-in-force vs execution-program
distinction; 13 follow-ups enumerated by section reference).

## Actually-open work (what's truly waiting for future implementers)

Stripping out close-outs that were just status-flip lag, the remaining
genuinely open work is:

- **ADR-0172** — router silent-fallback audit. Three named callsites in
  `memory-router.ts:1979,2338,2464`; disabled-controller registry
  documentation; init-template defaults for `hierarchicalMemory` and
  `memoryConsolidation`. Caveat: Phase B's substrate framing must be
  re-pointed at the ADR-0177/0180 archivist seam, not retired
  postgres/pglite.
- **ADR-0177 follow-ups #3, #4, #6–#13** — 9 items including
  RvfBackend concurrency hardening, self-learning NDCG@10 baseline,
  skill-manifest CI guard, `.swarm/` migration story, upstream Cypher
  PR coordination, federation/RAFT activation gate, ADR-007 Phase 2-5
  scaffolding completion, dual `config.json`/`embeddings.json`
  consolidation, ADR-060 proof-gated mutation activation.
- **ADR-0179** — 34-row body-diff table (Phase 1 deliverable) remains
  a stub; the ADR-0053 inheritance-debt catalogue and the
  controller-coverage acceptance check are open. The six bridge-deletion
  behaviors themselves are *not* open — those are now archivist work
  per ADR-0180.
- **ADR-0182** — levers L1/L5/L8/L10-L13, baseline capture (the hard
  prerequisite for the auto-fail gate), and the gate itself.
- **ADR-0162** — batches G/H/I/J upstream-sync hand-ports + the 5
  follow-up audit tasks (fetch-timeout, DB-write file-mode, pipeline
  allowlists, agentdb dead build scripts, cross-compile pinning).
- **ADR-0176 Phase 5** — MCP-registry boot acceptance test for the 4
  declared tool names (also closes ADR-0177 follow-up #6).
- **ADR-0171 release-verification gate** — confirm
  MincutService / SparsificationService / StreamingEmbeddingService
  wiring is exercised end-to-end by `npm run release` acceptance
  post-`f790426`.
- **ADR-0157 corpus migration** — ruflo-patch's own 163+ ADRs to MADR
  canonical (explicitly out-of-scope; a separate ADR if pursued).

## Commit SHAs (ruflo-patch main)

| Phase | SHA | Summary |
|---|---|---|
| Phase 1 | `5fd6299` | Flip ADR-0181 + ADR-0184 to implemented (closed-on already set) |
| Phase 2 | `30778fc` | Flip ADR-0161 to implemented; add `closed-on: 2026-05-08` |
| Phase 3a | `81e15c1` | Status reconciliation for ADR-0163, 0164, 0165 (closed 2026-05-10, 674/674 verified) |
| Phase 3c | `d8c9a42` | Mark ADR-0173 superseded by ADR-0174 (chain: 0174 → 0177) |
| Phase 3d | `11d6033` | Document ADR-0172 as truly open with 3 specific undelivered deliverables |
| Phase 3b | `6ec80f3` | Partial-implementation amendments for ADR-0157, 0162, 0171, 0176, 0177, 0179, 0182 |

All commits touch only `docs/adr/*.md`. No fork code changed.
