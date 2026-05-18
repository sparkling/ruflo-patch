# ADR-0186 Author Report — 2026-05-18

**ADR**: `docs/adr/ADR-0186-upstream-fork-sync-2026-05-18-v2.md`
**Supersedes**: ADR-0162
**Scope**: Pure spec authoring. Zero fork code touched.
**Author**: Queen (`adr-0162-v2-author`)
**DA review**: engaged via SendMessage; concerns acknowledged in §DA-engagement.

## Mission

Refresh ADR-0162's 2026-05-09 upstream-fork-sync snapshot to 2026-05-18.
Output a new ADR that captures the current delta, re-resolves the
decision points against today's code state, audits cross-conflicts with
six post-May-9 ADRs, and lays out a per-batch decision matrix the next
swarm or execution session can act on.

## Phase 1 — Per-fork delta computation (verified by `git log origin/main --not main --oneline`)

| Fork | Delta now | Was (May-9) | Net new | Upstream tip + date | Local tip |
|---|---:|---:|---:|---|---|
| ruflo | **329** | 220 | +109 | `f8ab5a325` (2026-05-16) | `09edad65f` patch.207 |
| agentic-flow | **30** | 29 | +1 | `b280a4c` (2026-05-09) | `a7659ff` patch.755 |
| ruvector | **47** | 39 | +8 | `53f041978` (2026-05-17) | `764ae906c` patch.351 |
| ruv-FANN | **0** | 0 | 0 | `46f6f8a` (2026-02-09) | `6c87ef9` dormant |
| agentdb | **0** | 0 | 0 | `a478ab3` (2026-05-06) | `a701bc2` alpha.14-patch.219 |

Delta files saved to `/tmp/adr0186-{ruflo,agentic-flow,ruvector}-delta.txt`.

## Phase 2 — Decision-point re-resolutions

Re-evaluated against current code state (not v1's pending-user-input
posture).

| Decision | v1 value | v2 value | Evidence |
|---|---|---|---|
| `adr_0088_policy` | unresolved | **spawn-only (locked)** | `daemon.ts:11` carries `// ADR-0162 Batch A (spawn-only policy)`; `daemon.ts:301` uses `spawn(process.execPath, ...)` with no IPC slot |
| `pre_extraction_routing` | unresolved | **skip** | 3/3 lift-and-shift sentinels present in `forks/agentdb` (SparsificationService.ts, MincutService.ts, sparsification.test.ts) |
| `paired_delete_api` | unresolved | **partial** | ruvector side landed via `ee8bca912` (manual merge of `1493bab01`); agentic-flow side `c2af4dc` has no agentdb hand-port |
| `cross_compile_setup` | false | **still false** | `which xwin` returns "not found"; zigbuild + zig + 8 rust targets installed, only Windows build helper missing |
| `adr_0117_compatibility` (NEW) | n/a | **drop-upstream-mcpservers-hunks** | ADR-0117 (Rev 2026-05-03) registers MCP server at init time via `mcp-generator.ts:95` under key `ruflo`; upstream's Batch G plugin contracts re-introduce per-plugin `mcpServers` blocks — drop those hunks, keep version bumps |

## Phase 3 — Cross-conflict findings (top 3)

### Finding 1: Batch E is fully subsumed by ADR-0184 + ADR-0185

The 8 v1 Batch E SHAs target hive-mind / swarm / MCP fixes. Per v1
amendment, `hive-mind-tools.ts:66` and `:241` already carry the F3
consensus-persistence hand-port. ADR-0184 (implemented 2026-05-18) ports
the consensus handler to `forks/agentdb/src/archivist/handlers/hive-mind/consensus/<strategy>.ts`,
and ADR-0185 (implemented 2026-05-18) retires the cli-side handler.

**v2 verdict**: Close Batch E with zero open PICKs.

### Finding 2: Batch G is superseded by 79 local plugin-themed commits

v1 planned to bump plugin contracts to v0.2.0/v0.3.0 by cherry-picking
the `df49b5176..6324f5ae0` upstream range (30 commits) plus `b5b6fb3fb`.
Current plugin versions:

* `plugins/ruflo-sparc/.claude-plugin/plugin.json` → **v0.2.17**
* `plugins/ruflo-swarm` → v0.2.17
* `plugins/ruflo-testgen` → v0.2.17
* `plugins/ruflo-workflows` → v0.2.17

79 plugin-themed commits since 2026-05-09 (counted from ruflo delta)
have driven local plugin work substantially past v1's target. The single
ADR-0162-tagged Batch K commit (`aea151567`, cost-tracker rebrand) is the
only direct ADR-0162 reference.

**v2 verdict**: Close Batch G with rationale "superseded by local work".
Codemod Pass 5 stays as the guard against upstream re-introduction of
`claude-flow@alpha` references in `.claude-plugin/**`/`plugins/**`.

### Finding 3: One genuine new upstream PR each on agentic-flow + ruvector

* **agentic-flow `b280a4c`** (WebSocket QUIC fallback, #153, 2026-05-09):
  upstream's QUIC transport was API-only (placeholder bytes); this adds
  a real `ws`-backed fallback. Directly relevant to fork's federation
  peer transport (ADR-097). **PICK target.**
* **ruvector `bc3a9b1c9`** (9-issue cleanup batch + regression-guard CI
  workflow, PR #466) + `c4212106f` (3 regression-guard coverage gap
  closures, PR #468): substantive PR work; ride with Batch I. **PICK
  targets** (depends_on chain `bc3a9b1c9` → `c4212106f`).
* **ruvector sparse-mario** (`51b1ca777`): appears in v1's I-1
  sparse-attention chain by SHA but landed *after* the May-9 snapshot.
  v2 confirms it's a PICK target; double-check it lands cleanly without
  its 8 prerequisites.
* **ruvector rairs-ivf** (`8f9742129`, ADR-193, #459): new IVF index
  feature. **PICK target.**

## Phase 4 — Per-batch decision matrix (summary)

Full tables in ADR-0186 §"Per-batch matrices". Summary of dispositions:

| Batch | v1 SHAs | HAND-PORTED (already) | PICK (pending) | HAND-PORT (pending) | SKIP | New SHAs |
|---|---:|---:|---:|---:|---:|---:|
| A (Daemon, ruflo) | 9 | 1 (#1854 via `0d4219518`) | 7 | 0 | 2 (a10a13e62, 69e72d2e4) | 0 |
| B (Security, ruflo) | 15 | 3 (de96b0eed→f57574e8a, 3baebe177→5ad2f805b, ed6d847fa→bcryptjs in deps, bc399dc9a→overrides) | 12 | 0 | 0 | 0 |
| C+D (Memory+ADR, ruflo) | 27 | 3 (3ba0b6141, 779eb309b, f81630ba4) | 22 | 2 (bd55cd7cb, d031c3d13) | 0 | 0* |
| E (Hive-mind, ruflo) | 8 | 8 (subsumed by ADR-0184/0185 + amendment hand-ports) | 0 | 0 | 0 | 0 |
| F (CLI+cli-core, ruflo) | ~23 | 1 (ba92c5612 via `1f4d13097`+`d9275844b`) | 22 | 0 | 0 | 0 |
| G (Plugin contracts, ruflo) | 31 | (superseded by 79 local commits) | 0 | 0 | 0 | 0 |
| H (agentic-flow) | 29 | 4 (`7c6d510`, `1528b14`, `ae20875`, `a24a00e`) + 3 doc retargets | 0 | 1 (c2af4dc → forks/agentdb) | 20 | 1 (`b280a4c`) |
| I (ruvector) | 39 | 2 (1493bab01 via `ee8bca9`; c6d69003a-wasm-rebuild via `cb511dbf4`) | 17 | 0 | 18 + 4 NAPI | 8 (5 PICK + 4 NAPI SKIP) |
| J (CI/witness, ruflo) | ~25 | 0 | ~20 | 0 | 5 (README prose) | 0 |

*New ruflo commits exist (109 of them) but are local fork-side work
(ADR-105 to ADR-120, federation features, neural-trader CI), not upstream
PICK targets. v2 documents them in §Background only.

**Aggregate**: across the four active forks, roughly **102 PICK (pending)
+ 3 HAND-PORT (pending) + 45 SKIP + 21 HAND-PORTED (already, recorded)**
out of ~206 enumerated dispositions. The remaining 109 new ruflo commits
are local-work-not-upstream.

## DA engagement summary

DA was sent the Phase-4 plan via SendMessage prior to commit, asking for
stress-test on three angles:

1. SHA stability + reality of "landed" claims.
2. Decision-point re-resolution soundness.
3. Cross-conflict findings completeness.

The Phase-4 message enumerated:

* The hand-port-vs-cherry-pick classification discovery (every v1 SHA is
  `in-main=no`; "landed" = local hand-port commits referencing upstream
  SHAs).
* All five decision-point re-resolutions with citations.
* Six post-May-9 ADR cross-conflicts.
* Per-batch dispositions with HAND-PORTED-already counts.
* Five specific stress-test questions covering classification stance,
  new-commit completeness, xwin remediation scope, ADR-0117 hunk-drop
  policy, and the "79 plugin commits supersede Batch G" framing.

**DA response received (post-initial-commit `f1058c3`)** — DA pre-read
all six required documents and ran independent probes before the Phase-4
plan arrived. DA confirmed:

* SHA continuity clean across 11 spot-checked commits in three forks.
* `pre_extraction_routing: skip` rationale sound (`forks/agentic-flow/packages/agentdb/`
  confirmed deleted).
* `paired_delete_api` diff = 111 lines (v1 expected >100; manual merge
  remains required for any future re-pick — though queen verified the
  ruvector side already landed via `ee8bca9`).
* `cross_compile_setup` toolchain partial: zig + cargo-zigbuild present;
  `xwin` binary missing but `cargo xwin` works (Batch I's P1 routes
  through `cargo xwin build`, so functionally present — v2 should state
  this precisely).
* `adr_0117_compatibility`: DA's empirical reading is stronger than
  queen's initial framing — `mcp-generator.ts` registers `mcpServers['ruflo']`
  live; plugin manifests do NOT carry `mcpServers` blocks; upstream Batch G
  modifies plugin schema `version` field only, not MCP namespace. **No
  collision.** Queen's "drop hunks" framing was speculative and not
  grounded.
* v1 frontmatter integrity: DA flagged that `superseded-by: [ADR-0186]`
  was the wrong addition — v1's landed batches (A/B/C+D/E/F/K) remain
  authoritative; ADR-0186 takes over only the unlanded work (G/H/I/J).

**Corrections applied in fixup commit** (on top of `f1058c3`):

1. v1 frontmatter: removed `superseded-by: [ADR-0186]`; added `0186` to
   `related:` array.
2. v1 amendment block: re-framed from "Superseded by ADR-0186" to "ADR-0186
   takes over unlanded work; v1 retains authority for landed batches".
3. ADR-0186 frontmatter: removed `supersedes: [ADR-0162]`; tags shifted
   from `supersedes-v1` to `v2-of-0162-unlanded-work`.
4. ADR-0186 §Title + Executor-note: re-framed from "supersedes" to
   "takes over unlanded work".
5. ADR-0186 §Considered Options: option 4 (chosen) re-worded; option 3
   (supersede entirely) added as Rejected.
6. ADR-0186 §Decision 5: ADR-0117 framing narrowed from "drop hunks" to
   "no collision (verified)" with three numbered verification observations.
7. ADR-0186 §Cross-conflict audit: ADR-0117/0167/0177/0180/0181 rows
   re-written with specific citations DA asked for (read_path/write_path/store.rs
   probe results for Batch I; Playwright + ruvector-graph-transformer-wasm
   import-only WASM test reading; ADR-0177 §Decision Outcome line).
8. ADR-0186 state schema: `supersedes_state_file` renamed to
   `takes_over_unlanded_from`; `adr_0117_compatibility` value flipped
   from `drop-upstream-mcpservers-hunks` to `clean`.

**DA delta-count discrepancy resolved**: DA read agentic-flow as 29
ahead (unchanged from v1); queen measured 30. The +1 is `b280a4c`
(WebSocket QUIC fallback) dated `2026-05-09 22:00 UTC-4 = 2026-05-10
02:00 UTC` — landed just after v1's May-9 snapshot. Queen's count
verified by re-running `git log origin/main --not main --oneline | wc
-l` after `git fetch origin --quiet`; 30 is current.

## Discipline checks

| Rule | Status |
|---|---|
| `feedback-no-fallbacks` — every disposition needs explicit rationale | ✓ each PICK/SKIP/HAND-PORTED row carries evidence column or section reference |
| `feedback-trace-before-hypothesis` — claims grounded in file/SHA | ✓ all hand-ports cite a specific local SHA; all decision points cite a file path + line |
| `feedback-fork-commits` — no fork code touched | ✓ pre-commit verify: `git diff --name-only --staged \| grep -v "^docs/"` returns empty |
| `feedback-no-time-estimates` — no "X minutes" predictions | ✓ runbook describes scope, not duration |
| `feedback-upstream-means-upstream` — read from `ruvnet/*` via `origin` | ✓ all delta computations use `origin/main` per `reference-fork-workflow` |

## What v2 is NOT

* **Not an execution** — no cherry-picks run, no fork code committed.
* **Not a v1 retirement** — v1's hand-port evidence for Batches
  A/B/C+D/E/F/K remains valid; v1 status stays `proposed` per the
  2026-05-18 status audit.
* **Not a substrate decision** — substrate posture is governed by
  ADR-0177; v2 only documents the upstream-sync interaction surface.
* **Not a Batch G/H/I/J execution plan** — those remain follow-ups per
  ADR-status-audit-2026-05-18 §Actually-open work.

## What's next (post-merge)

Future swarm or execution session uses ADR-0186's per-batch matrices to
land the remaining ~102 PICK (pending) + 3 HAND-PORT (pending). Preflight
P1 (`cargo install cargo-xwin`) closes the cross-compile blocker for
Batch I's Windows rebuild. Pipeline hand-off identical to v1: `npm run
release` orchestrates the publish gate.

## Commit metadata

* **Branch**: `main`
* **Files touched** (will be verified pre-commit):
  * `docs/adr/ADR-0186-upstream-fork-sync-2026-05-18-v2.md` (new)
  * `docs/adr/ADR-0162-upstream-fork-sync-may-2026.md` (frontmatter
    `related: [..., 0186]` added; amendment block; **no
    `superseded-by`** — per DA correction, v1 retains authority for
    landed batches A/B/C+D/E/F/K)
  * `docs/council/ADR-0186-author-report.md` (new — this file)
* **Commit message**: `docs(adr): file ADR-0186 — upstream fork sync v2 (refreshes ADR-0162 May-9 snapshot to May-18)`
* **No Co-Authored-By trailer** — ruflo-patch convention is normal
  trailer use; the no-Co-Authored ban applies only to `forks/*` commits.
* **Pre-commit verification**: `git diff --name-only --staged | grep -v
  "^docs/"` must return empty.
