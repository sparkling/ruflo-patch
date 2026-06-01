# Session Handover — 2026-06-01 — Test `adr-create` + `odr-create` across all 4 storage mechanisms

## Goal

Verify that the `adr-create` and `odr-create` skills correctly create their
markdown artifact AND register it into **all four storage mechanisms** the
ADR/ODR index uses — exercising store / retrieve / update / upsert / delete /
search / get on each surface, for BOTH skills. This is the create-side analogue
of the ADR-0285 index op-matrix test; reuse that methodology.

> Context: ADR-0285 (shipped green this session, cli@patch.402 / agentdb@414)
> repaired the causal/recall MCP surfaces and made `agentdb index --purge`
> idempotent. This test confirms the **create** skills land data correctly on
> the now-fixed surfaces — and shakes out the **greenfield ODR side** (0 ODRs
> exist yet).

## The 4 storage mechanisms (+ the disk source)

Per the ADR-0285 investigation, the index spans **4 logical surfaces across 2
engines**. Confirmed live in `.swarm/` this session:

| # | Surface | Engine | ADR keying | ODR keying | Written by |
|---|---|---|---|---|---|
| **S1** | `hierarchical_memory` | SQLite (`memory.db`, WAL) | `adr/ADR-NNNN` | `odr/ODR-NNNN` | create skill (`hierarchical-store`) + index |
| **S2** | `*-patterns` namespace | RVF + HNSW (`memory.rvf`) | `adr-patterns` | `odr-patterns` | create skill (`memory_store`) + index |
| **S3** | `causal_edges` (+ `adr_node_ids` map) | SQLite | typed relations + inverses | (same) | **index only** (adr-create does NOT; odr-create MAY — see below) |
| **S4** | `causal-edges` namespace | RVF + HNSW | edge vectors | edge vectors | index (D9 mirror) |

**Disk source of truth (not a write target):** `docs/adr/ADR-*.md` (291 today,
incl. ADR-0285) and `docs/ontology/odr/ODR-*.md` (**0 today — greenfield**).

### Create-vs-index split (critical — sets expectations per surface)

- `adr-create` (`~/.claude/skills/adr-create/SKILL.md`) writes **S1 + S2 only**:
  step 4 `agentdb_hierarchical-store{path:'adr/ADR-NNNN'}` (S1), step 6
  `memory_store{namespace:'adr-patterns', key:'ADR-NNNN'}` (S2). It does **not**
  write edges — `allowed-tools` has no `agentdb_causal-edge`. The `depends-on:` /
  `supersedes:` / `implements:` frontmatter edges (S3/S4) are derived later by
  `adr-index` (the `agentdb index` batch, ADR-0273).
- `odr-create` (`~/.claude/skills/odr-create/SKILL.md`) writes **S1 + S2**: step 5
  `hierarchical-store{path:'odr/ODR-NNNN'}`, step 7 `memory_store{namespace:'odr-patterns'}`.
  **BUT its `allowed-tools` DOES list `agentdb_causal-edge`** (adr-create's does
  not). The documented steps don't call it — so a key test question is whether
  odr-create writes any S3 edge or just declares the capability. Resolve this.

So per surface, the **expected create-time writes** are: S1 ✅, S2 ✅, S3/S4 ✅ only
after running `adr-index` / `odr-index`. Test both phases.

## Current live baseline (measured 2026-06-01)

- S1: 291 `adr/*` keyed records (291 distinct, no dup); **0 `odr/*`**.
- S2: `adr-patterns` 287→291 (post-reconcile); **`odr-patterns` namespace does
  not exist yet** (memory_stats shows no `odr-patterns`).
- S3: `causal_edges` 910 total = 910 distinct (depends-on 428/428, supersedes
  18/18, implements 9/9); `adr_node_ids` 215. **No ODR edges.**
- S4: `causal-edges` RVF namespace ~877.

So the ODR side is a **cold-start**: `odr-create` will mint **ODR-0001**, create
`docs/ontology/odr/` (+ likely need `DCAP.md`), and create the `odr-patterns`
namespace from scratch. Test that the first-ever write on each ODR surface works.

## Test plan — per skill × per surface × op-matrix

Mirror the ADR-0285 op-matrix (store / retrieve / update / upsert / delete /
search / get). Use **probe ids** (`adr/ZZTEST-*`, `odr/ZZTEST-*`), never real
records, and clean up after (delete the probe from every surface; the ZZTEST
node-id rows too). Cross-check ground truth via direct `sqlite3 .swarm/memory.db`
+ `memory_stats` (RVF), not just the tool's own return.

### Phase 1 — `adr-create` (the skill end-to-end)
1. Invoke `/adr-create "<probe title>"` → assert: file at `docs/adr/ADR-NNNN-*.md`
   (MADR format, frontmatter), **S1** `hierarchical-query adr/ADR-NNNN` returns 1,
   **S2** `memory_retrieve{namespace:'adr-patterns', key:'ADR-NNNN'}` found.
2. **S1 op-matrix** (`agentdb_hierarchical-*`): store ✓ · query/get ✓ · recall
   (ADR-0285: was Internal error → now non-error) · upsert (re-store same key → 1,
   ADR-0281) · delete-by-key (→0).
3. **S2 op-matrix** (`memory_*`, namespace `adr-patterns`): store · retrieve ·
   search (HNSW) · list · upsert (`upsert:true` replaces) · delete.
4. **S3/S4 via `adr-index`**: run `cli agentdb index --dir docs/adr --purge` (the
   patch.402 cli), assert the new probe ADR's `depends-on` edges land in S3
   (`causal_edges`, total==distinct, no dup — ADR-0285 P1/P2) and S4
   (`causal-edges` namespace). Then `agentdb_causal-query{cause:'adr/ADR-NNNN'}`
   returns them (ADR-0285 P7; note the cold-process 2s→15s timeout fix).

### Phase 2 — `odr-create` (greenfield — exercises first-ever ODR writes)
1. Invoke `/odr-create "<probe title>"` → assert: file at
   `docs/ontology/odr/ODR-0001-*.md` (DCAP: 6 H2 sections `## Context`/`## Decision`/
   `## Rules`/`## Alternatives`/`## Consequences`/`## References`, frontmatter with
   `kind`/`scope`); **S1** `hierarchical-query odr/ODR-0001` returns 1; **S2**
   `memory_retrieve{namespace:'odr-patterns', key:'ODR-0001'}` found (namespace
   created cold).
2. **S1 op-matrix** on `odr/*` keys (same ops as Phase 1 step 2 — confirm `/` in
   `odr/ODR-x` is accepted, ADR-0285 P5).
3. **S2 op-matrix** on the new `odr-patterns` namespace.
4. **RESOLVE the `agentdb_causal-edge` question**: does odr-create write any S3
   edge directly (its allowed-tools permits it), or only via `odr-index`? Inspect
   `causal_edges` for ODR-typed rows after create-but-before-index.
5. **S3/S4 via `odr-index`** (`~/.claude/skills/odr-index/SKILL.md`): run it; assert
   the ODR edges build (cross-corpus `depends-on` ODR→ADR is allowed; `supersedes`/
   `implements` intra-corpus only — `odr-review` enforces this). This is the
   **first-ever `odr-index` run** — watch for cold-start / missing-`DCAP.md` /
   empty-namespace failures.

## Known-fixed issues to regression-check (from ADR-0285, all on these surfaces)

These were broken pre-ADR-0285 and are now fixed — the create test is a good place
to confirm they hold for both corpora:
- **S1 recall** (`hierarchical-recall`) — was `Internal error` (sql.js NAMED-bind);
  now non-error. **S3 recall** (`causal-recall`) — same.
- **S3 create** (`causal-edge`) — was `no such savepoint`; now succeeds on `/`-keys.
- **S3 delete** (`causal-edge-delete` / `causal-node-delete`) — was `/`-rejection /
  undefined-bind; now works.
- **Idempotent purge** — `index --purge` clears `causal_edges` + `adr_node_ids`
  (no dup on re-run).
- **Caveat — the live daemon runs the sql.js fallback** (see
  `project-mcp-daemon-runs-sqljs-fallback` memory): some of these bugs only show
  on the daemon, not a fresh better-sqlite3 `cli mcp exec`. Test BOTH where it
  matters (the sql.js path is unit-covered in agentdb; the live daemon needs a
  restart to pick up patch.402 — it currently serves the old build).

## Test mechanics

- **Two harnesses, both valid:**
  1. **Live**, via the `mcp__ruflo__*` tools or `cli mcp exec` against this
     project's `.swarm` (probe keys + cleanup). Fast; tests the real store. The
     session daemon is stale (pre-patch.402) — restart Claude Code or use a fresh
     patch.402 `cli mcp exec` (a patch.400 install is at `/tmp/adr-test-cli-v400`;
     install patch.402 fresh for current).
  2. **Isolated**, the ADR-0281/0273 smoke pattern (`cli mcp exec` against a
     Verdaccio temp install). Wire any new gate into `test-acceptance*.sh`
     (`run_check_bg` + `collect_parallel`) + `.github/workflows/` — never run a
     smoke by hand to "verify" (memory: `feedback-always-wire-tests-into-cicd`).
- **Ground truth:** `sqlite3 .swarm/memory.db` for S1/S3 (`hierarchical_memory`,
  `causal_edges`, `adr_node_ids`), `memory_stats` for S2/S4 namespace counts.
  Note RVF cross-process snapshot lag (memory_stats via a long-lived daemon can be
  stale vs a fresh process — ADR-0285 P9).
- **Cleanup:** delete every probe from S1 (`hierarchical-delete`), S2
  (`memory_delete`), and the `ZZTEST` rows from `adr_node_ids` / `causal_edges`.
  Then `git checkout`/`rm` the probe `.md` files. Re-run `index --purge` to
  reconcile if you wrote probes through the index.

## Deliverable

A test report: a per-skill × per-surface table (✅/❌ per op), the resolved
odr-create-causal-edge question, any first-ever-ODR cold-start defects, and a
green/red verdict. If defects are found, file them like ADR-0285 (fix in the
fork, smoke wired into the canonical harness, release green). Leave nothing
deferred or skipped.

## Pointers

- Skills: `~/.claude/skills/{adr-create,adr-index,odr-create,odr-index,odr-review}/SKILL.md`.
- ODR normative spec: `docs/ontology/odr/DCAP.md` (referenced by odr-create; confirm it exists before the first odr-create).
- ADR-0285 (the surface fixes this builds on): `docs/adr/ADR-0285-repair-adr-index-causal-recall-surfaces-and-complete-purge.md`.
- ADR-0285 follow-up handover: `docs/SESSION-HANDOVER-2026-06-01-adr0285-followups.md`.
