---
status: proposed
date: 2026-05-18
methodology: [SPARC, MADR, runbook]
decision-makers: [Henrik Pettersen]
tags: [upstream-sync, fork-management, ruflo, agentic-flow, ruvector, ruv-FANN, agentdb, runbook, v2-of-0162-unlanded-work]
depends-on: [ADR-0117, ADR-0143, ADR-0161, ADR-0167, ADR-0177, ADR-0180, ADR-0181, ADR-0184, ADR-0185]
implements: []
related: [0094, 0143, 0156, 0162, 0167, 0177, 0180]
audience: ai-executor
state_schema: 2
preflight-corrections:
  - 2026-05-18 — cross_compile_setup was reported "still false" but verified READY post-authoring. cargo-xwin 0.22.0 + zig 0.16.0 + cargo-zigbuild 0.22.3 all installed; 5 rust targets (aarch64/x86_64-apple-darwin, aarch64/x86_64-unknown-linux-gnu, x86_64-pc-windows-msvc) installed; xwin SDK cache pre-warmed (1.1 GB at ~/Library/Caches/cargo-xwin/). Batch I Windows NAPI cross-compile is end-to-end ready. Decision-point §cross_compile_setup superseded by this preflight correction.
---

# ADR-0186: Upstream fork sync — May 18, 2026 (v2, takes over ADR-0162's unlanded work)

> **AI executor**: this is a refreshed runbook for the *unlanded* portion of
> ADR-0162 (Batches G/H/I/J + the 5 follow-up audit tasks). v2 does NOT
> supersede v1 — v1 retains authority for its landed batches (A/B/C+D/E/F/K
> hand-ports cited at `memory-router.ts:434, 883, 889` and
> `hive-mind-tools.ts:66, 241`). v2 enumerates the *current* upstream delta
> as of 2026-05-18 and re-resolves the five decision points against today's
> code state. Execute top-to-bottom only after the decision-gate is closed.

## Context and Problem Statement

ADR-0162 captured the upstream-fork delta on 2026-05-09 (220 ruflo + 29
agentic-flow + 39 ruvector commits ahead). Per the 2026-05-18 ADR status
audit (`docs/council/ADR-status-audit-2026-05-18.md`), Batches A/B/C+D/E/F/K
landed on `forks/ruflo/main` as **hand-ports** (15 commits referencing
`ADR-0162` by name), but Batches G/H/I/J never closed and were never re-run
against fresh upstream. Nine days later the upstream snapshot has drifted
substantially:

* **ruflo** is now **329 commits ahead** of `forks/ruflo` (up from 220) — 109
  net-new upstream commits including federation work (ADR-105 to ADR-120 in
  upstream's numbering), neural-trader CI hardening, witness-manifest
  refresh, and the cli-core split itself (`ba92c5612`).
* **agentic-flow** added one commit (`b280a4c`, WebSocket QUIC fallback) for
  total **30** ahead.
* **ruvector** added 8 commits (sparse-mario, RAIRS IVF, regression-guard
  CI, NAPI binary rebuilds) for total **47** ahead.
* **ruv-FANN** stays dormant (0 commits since 2026-02-09).
* **agentdb** stays caught up (0 commits ahead; upstream tip `a478ab3` from
  2026-05-06).

Additionally, six post-2026-05-09 ADRs have changed the landscape v1
reasoned against:

* **ADR-0161** (implemented 2026-05-08) — agentdb extracted to a 5th fork;
  upstream's `packages/agentdb/` is gone in our agentic-flow.
* **ADR-0167** (accepted 2026-05-10) — cross-process RVF write coordination;
  shapes ruvector's authoritative coordination layer.
* **ADR-0177** (proposed 2026-05-12, substrate decision in force) — adopts
  upstream's RVF-first Cognitive Container substrate; supersedes ADRs
  0170/0174/0175 (the previous postgres divergence).
* **ADR-0180** (accepted 2026-05-13) + **ADR-0181** (implemented 2026-05-18)
  — thin Memory Archivist + runtime activation; sits *above* the substrate.
* **ADR-0184** + **ADR-0185** (both implemented 2026-05-18) — hive-mind
  consensus handler port + cli retirement; closes ADR-0162 Batch E content.
* **ADR-0117** (revising 2026-05-03) — marketplace MCP server registration
  pivot to init-time `ruflo` key; collides with Batch G's per-plugin
  `mcpServers` blocks from upstream.

The v1 ADR is now actively misleading as an executable plan: half its
decision points have already been answered in code; SHAs it lists as
"unresolved PICK" have either landed via hand-port or been superseded by
local work that's structurally ahead (e.g. plugin contracts at v0.2.17 vs
v1's target v0.2.0/v0.3.0). v2 refreshes the plan to today's reality.

## Decision Drivers

* **Sync truthfulness** — every disposition (PICK / SKIP / HAND-PORTED) must
  match current code state, not the May-9 snapshot.
* **Post-May-9 ADR coherence** — v2's per-batch dispositions must respect the
  six ADRs that landed between v1 and now; surfaces those ADRs own must not
  be re-claimed by upstream-sync cherry-picks.
* **No fork-code execution this ADR** — v2 is pure spec authoring; cherry-picks,
  hand-ports, and rebuilds happen in a future ADR or swarm.
* **Honest landing classification** — v1 used a binary PICK/SKIP model. v2
  adds **HAND-PORTED (already)** and **HAND-PORTED (pending)** so the truth
  of v1's deferred close-out is captured, not erased.
* `feedback-no-fallbacks` — every disposition needs explicit rationale; no
  defaults.
* `feedback-trace-before-hypothesis` — every cross-conflict claim cites a
  specific file or ADR section.

## Considered Options

1. **Execute v1 as-written.** Rejected — v1's decision points have been
   answered in code; its SHAs are misaligned with current state; its batch
   list omits 109 new ruflo commits and 9 new commits across the other
   forks.
2. **Amend v1 in place.** Rejected — the existing amendment block already
   records the partial close-out for landed batches. Layering a second
   amendment that re-enumerates Batches G/H/I/J with refreshed SHAs would
   bloat v1 past readable length.
3. **Author v2 (this ADR) and supersede v1 entirely.** Rejected — v1's
   landed-batch hand-port evidence (`memory-router.ts:434, 883, 889`,
   `hive-mind-tools.ts:66, 241`, 15 ADR-0162-tagged commits) is the
   authoritative source for Batches A/B/C+D/E/F/K. Supersession would
   imply v1 is stale on those batches, which is not true.
4. **Author v2 as a scope-narrowed runbook for the unlanded work; keep v1
   authoritative for landed batches.** Chosen. v1 and v2 coexist; each
   closes itself by execution of its own scope.
5. **Author v2 + retire v1 entirely.** Rejected — same reason as option
   3, stronger form.

## Decision Outcome

Author ADR-0186 as a fresh runbook for the *unlanded* portion of ADR-0162
(Batches G/H/I/J + 5 follow-up audit tasks + 8 new follow-ups specific to
the refreshed delta). v2 inherits v1's batch structure (A–J) but each
batch table is rebuilt against current SHAs and dispositions for landed
batches are recorded as "HAND-PORTED (already)" with citation back to v1's
amendment. Five decision points re-resolved; one new decision point added
(`adr_0117_compatibility`). Cross-conflict audit against six post-May-9
ADRs documented. **Execution deferred** to a future swarm or follow-up ADR.

**Frontmatter relationship**: ADR-0186 carries `related: [..., 0162]`;
v1 carries `related: [..., 0186]`. Neither carries `superseded-by` —
v1 status stays `proposed` (partial), and ADR-0186 status stays
`proposed` until its unlanded scope is closed.

## Execution state schema (v2)

Maintain at `/Users/henrik/source/ruflo-patch/.claude-flow/data/sync-2026-05-18.yaml`.

```yaml
sync_id: 2026-05-18-upstream-v2
schema_version: 2
takes_over_unlanded_from: 2026-05-09-upstream  # ADR-0162 v1; v1 keeps authority for landed batches
decisions_resolved:
  adr_0088_policy: spawn-only             # resolved by code state — see Decisions §1
  pre_extraction_routing: skip            # resolved by lift-and-shift verification
  paired_delete_api: partial              # ruvector side landed; agentic-flow side open
  adr_0117_compatibility: clean           # NEW — verified no collision (upstream Batch G doesn't introduce mcpServers blocks)
preflight:
  cross_compile_setup: false              # xwin still missing
  forks_clean: false
batches:
  A: { status: partially-landed, hand_ports_landed: [0d4219518], v1_picks_open: 7, new_picks_open: 0 }
  B: { status: partially-landed, hand_ports_landed: [f57574e8a, 5ad2f805b, 4ec33f9fa], v1_picks_open: 12, new_picks_open: 0 }
  C+D: { status: partially-landed, hand_ports_landed: [f81630ba4], v1_picks_open: 24, new_picks_open: 5 }
  E: { status: closed, hand_ports_landed: [], v1_picks_open: 0, new_picks_open: 0, superseded_by: [ADR-0184, ADR-0185] }
  F: { status: partially-landed, hand_ports_landed: [1f4d13097, d9275844b], v1_picks_open: 22, new_picks_open: 0 }
  G: { status: superseded-by-local, hand_ports_landed: [aea151567], v1_picks_open: 0, new_picks_open: 0, supersedes_note: "plugin contracts at v0.2.17 vs v1 target 0.2.0/0.3.0" }
  H: { status: partially-landed, hand_ports_landed: [7c6d510, 1528b14, ae20875, a24a00e], v1_picks_open: 2, new_picks_open: 1 }
  I: { status: partially-landed, hand_ports_landed: [ee8bca9, cb511dbf4], v1_picks_open: 17, new_picks_open: 5 }
  J: { status: pending, hand_ports_landed: [], v1_picks_open: 20, new_picks_open: 0 }
post_batch:
  version_anchor_advance: false
  verdaccio_publish: false
  acceptance_tests_pass: false
  pushed_to_sparkling: false
```

## Inventory at sync time (verified 2026-05-18)

| Fork           | Upstream tip                     | Local tip                   | Ahead | Verdict |
|----------------|----------------------------------|------------------------------|------:|---------|
| ruflo          | `f8ab5a325` (2026-05-16)         | `09edad65f` (patch.207)      |   329 | Active — Batches A/B/C+D/F/J open; E closed; G superseded |
| agentic-flow   | `b280a4c` (2026-05-09)           | `a7659ff` (patch.755)         |    30 | Active — Batch H partial |
| ruvector       | `53f041978` (2026-05-17)         | `764ae906c` (patch.351)      |    47 | Active — Batch I partial |
| ruv-FANN       | `46f6f8a` (2026-02-09)           | `6c87ef9`                    |     0 | Dormant — patch-bump only |
| agentdb        | `a478ab3` (2026-05-06)           | `a701bc2` (alpha.14-patch.219)|    0 | Caught up — extracted per ADR-0161 |

Delta files saved at `/tmp/adr0186-{ruflo,agentic-flow,ruvector}-delta.txt`
(snapshot only; regenerate via `git log origin/main --not main --oneline`).

## Decisions gate (re-resolved for v2)

### Decision 1: `adr_0088_policy` — locked **spawn-only**

**Evidence**: `forks/ruflo/v3/@claude-flow/cli/src/commands/daemon.ts:11`
already carries `// ADR-0162 Batch A (spawn-only policy): kept spawn()
instead of fork()`. The code uses `spawn(process.execPath, spawnArgs,
spawnOpts)` at line 301 with no IPC channel. No further decision needed.

**Implication for Batch A**: upstream SHAs `a10a13e62` and `69e72d2e4`
remain **SKIP**. The detached/disconnect intent from `69e72d2e4` already
captured by our spawn-only path.

### Decision 2: `pre_extraction_routing` — **skip** (verified)

**Check (re-run 2026-05-18)**:

```bash
ls /Users/henrik/source/forks/agentdb/src/controllers/SparsificationService.ts \
   /Users/henrik/source/forks/agentdb/src/controllers/MincutService.ts \
   /Users/henrik/source/forks/agentdb/tests/unit/sparsification.test.ts | wc -l
# Result: 3 → lift-and-shift covered
```

**Implication for Batch H**: 11 pre-extraction commits remain SKIP.

### Decision 3: `paired_delete_api` — **partial** (ruvector landed; agentic-flow open)

**Evidence**: ruvector side landed via `ee8bca912` (manual merge of
`1493bab01`, 2026-05-09) per `git log forks/ruvector/main --grep
ADR-0162`. Agentic-flow side (`c2af4dc` adding delete API to
GraphDatabaseAdapter + ReflexionMemory.deleteEpisode) has **no corresponding
hand-port** in `forks/agentdb` (zero matches for `c2af4dc`, `delete API`,
`deleteEpisode`, `GraphDatabaseAdapter` in `forks/agentdb/git log`).

**Implication for Batch H**: re-target `c2af4dc` to `forks/agentdb` as
HAND-PORTED (pending). The runbook step is documented; execution deferred.

### Decision 4: `cross_compile_setup` — **still false** (xwin missing)

**Probe (2026-05-18)**:

```bash
which cargo-zigbuild       # /Users/henrik/.cargo/bin/cargo-zigbuild ✓
which xwin                 # xwin not found ✗
zig version                # 0.16.0 ✓
rustup target list --installed | grep -E "(apple|linux|windows)"
# x86_64-pc-windows-msvc target IS installed; xwin (build helper) is NOT
```

**Implication for Batch I**: Windows NAPI rebuild still blocked. v2
documents `cargo install cargo-xwin` as the remediation; user can run when
ready. Until then, the Windows binary stays as upstream-produced
(`53f041978` ships fresh ones; we can lift those if license allows, or skip
the Windows target on the rebuild pass).

### Decision 5 (NEW): `adr_0117_compatibility` — **clean (no collision)**

**Context**: ADR-0117 (Revision 2026-05-03) registers the MCP server at
**init time** via `forks/ruflo/v3/@claude-flow/cli/src/init/mcp-generator.ts`
under the key `ruflo`. Authoring concern was whether upstream's Batch G
plugin contract bundle re-introduces per-plugin `mcpServers` blocks that
would shadow ADR-0117's init-time registration.

**Verification 2026-05-18** (empirical, not speculative):

1. **Plugin manifests don't carry `mcpServers` blocks.** Sampled
   `plugins/ruflo-agentdb/.claude-plugin/plugin.json` (version `0.3.17`) —
   no `mcpServers` field. The post-ADR-0117 plugin shape carries
   `name`/`description`/`version`/`author`/`homepage`/`license`/`keywords`
   only.
2. **Upstream `df49b5176` (Batch G entry-point) doesn't introduce
   `mcpServers` blocks either.** Inspection shows the upstream commit
   touches plugin.json `version` (0.1.1 → 0.2.0) + `keywords` array, plus
   adds `scripts/smoke.sh` and a Compatibility section to README. No MCP
   namespace registration in the diff.
3. **The `version` field is the plugin schema version, not an MCP
   namespace.** Conflating the two would be a category error. ADR-0117's
   post-revision decision concerns the `mcpServers` block, not the plugin
   schema version field.

**Decision**: No "drop hunks" policy needed. KEEP plugin contract version
bumps; KEEP codemod Pass 5 which rewrites `claude-flow@alpha` →
`@sparkleideas/cli@latest` in `.claude-plugin/**` and `plugins/**`
(ADR-0117 confirms this stays as the orthogonal `npx`-shellout sanitizer).

Note: our plugin contracts are already at v0.2.17 / v0.3.17 (sampled
across `ruflo-sparc`, `ruflo-swarm`, `ruflo-testgen`, `ruflo-workflows`,
`ruflo-agentdb`), substantially ahead of v1's 0.2.0/0.3.0 target. Batch G
is **SUPERSEDED BY LOCAL WORK** regardless of any compat concern.

## Preflight (refreshed)

### P1. Cross-compile toolchain (status: false)

```bash
# Remaining step:
cargo install cargo-xwin
# Then:
rustup target add x86_64-pc-windows-msvc  # already installed
```

Verification: `xwin --version` returns a version string.

### P2. Forks clean

```bash
for d in ruflo agentic-flow agentdb ruv-FANN ruvector; do
  echo "=== $d ==="
  cd /Users/henrik/source/forks/$d && git status --short && git rev-parse --abbrev-ref HEAD
done
```

Expected: each fork shows empty `git status --short`, branch `main`.

### P3. Fetch upstream for active forks

```bash
cd /Users/henrik/source/forks/ruflo && git fetch origin --quiet
cd /Users/henrik/source/forks/agentic-flow && git fetch origin --quiet
cd /Users/henrik/source/forks/ruvector && git fetch origin --quiet
```

Note: per `reference-fork-workflow` memory, `origin` is `ruvnet` (read-only)
on each fork; `sparkling` is the push target. v2 reads from `origin`.

## Per-batch matrices

Each batch table lists v1 SHAs with current disposition. Append "+new" rows
for commits that arrived after 2026-05-09.

### Batch A — Daemon (ruflo)

**Pre-conditions**: `decisions_resolved.adr_0088_policy == spawn-only` (✓).
**Cwd**: `/Users/henrik/source/forks/ruflo`.

| # | SHA | Subject | v1 Action | v2 Action |
|---|-----|---------|-----------|-----------|
| 1 | `a10a13e62` | #1691 daemon spawn→fork | PICK (if partial-revert) / SKIP (if spawn-only) | **SKIP** — locked spawn-only |
| 2 | `69e72d2e4` | #1766 IPC pipe break | PICK / SKIP | **SKIP** — locked spawn-only |
| 3 | `c67fa393d` | #1793 worker-daemon persist headless | PICK (worker-daemon.ts hunk only) | **PICK (pending)** — verify worker-daemon.ts merge |
| 4 | `1884ed101` | alpha.12 daemon hunks | PICK (drop MCP-rename subs) | **PICK (pending)** |
| 5 | `d88c69dde` | alpha.15 #1852/#1853/#1854 | HAND-PORT #1854 to memory-router.ts | **HAND-PORTED (already)** via `0d4219518` |
| 6 | `f46e52f41` | alpha.16 crash recovery | PICK | **PICK (pending)** |
| 7 | `66f7f644d` | alpha.17 supervisor + Windows tasklist | PICK | **PICK (pending)** |
| 8 | `fd4c3cb3c` | Windows CI regression for #1766 | PICK | **PICK (pending)** |
| 9 | `003ce127b` | `git mv v2 archive/v2` | PICK | **PICK (pending)** — coordinate with fork's current v2/ state |

Open in v2: **7 PICK (pending)**.

### Batch B — Security audit (ruflo)

| # | SHA | Subject | v1 Action | v2 Action |
|---|-----|---------|-----------|-----------|
| 1 | `f8f4cd4bc` | .env untrack + .gitignore broaden | PICK | **PICK (pending)** — verify .env files already removed in fork |
| 2 | `bc399dc9a` | npm overrides hardening | PICK | **HAND-PORTED (already)** — root package.json overrides now include 4 v1-required keys + extras |
| 3 | `0535c3823` | MCP stdin DoS cap (10 MB) | PICK | **PICK (pending)** |
| 4 | `5073f5673` | statusline shell drop | PICK | **PICK (pending)** |
| 5 | `fb256ac59` | validateEnv loader-hijack denylist | PICK | **PICK (pending)** |
| 6 | `de96b0eed` | restrict file mode on stores | HAND-PORT to memory-router.ts | **HAND-PORTED (already)** via `f57574e8a` (mode-0600 at memory-router.ts:889) |
| 7 | `bbe53a21c` | regression tests validateEnv + fs-secure | PICK | **PICK (pending)** |
| 8 | `d9fd35956` | IPFS HEAD timeout + verify.ts timeout | PICK upload.ts; DROP verify.ts | **PICK (pending)** |
| 9 | `73babfb06` | github-tools shell injection close | PICK | **PICK (pending)** |
| 10 | `c1b57e4fd` | update/executor.ts shell injection | PICK | **PICK (pending)** |
| 11 | `367313824` | aidefence retry + doctor probe | PICK | **PICK (pending)** |
| 12 | `ed6d847fa` | bcrypt → bcryptjs | PICK source only | **HAND-PORTED (already)** — security/package.json has `bcryptjs: ^3.0.3` (no `bcrypt`) |
| 13 | `b9e2eb37e` | vitest pin bump ^4.0.16 | PICK source only | **PICK (pending)** — verify against current vitest pin |
| 14 | `d5fbb3bc4` | hooks $TOOL_INPUT shell injection | PICK | **PICK (pending)** |
| 15 | `3baebe177` | github-safe.js shell injection | MANUAL transcribe to .mjs/.js | **HAND-PORTED (already)** via `5ad2f805b` |

Open in v2: **12 PICK (pending)**.

### Batch C+D — Memory + ADR features (ruflo)

Strict ordering (15→21 for ADR-096 phases). 27 v1 SHAs.

| # | SHA | Subject | v2 Action |
|---|-----|---------|-----------|
| 1-3 | `4f2f68d52`, `53409aba5`, `ea8cbf697` | embeddings alpha.13/14/16 | **PICK (pending)** |
| 4 | `21f668c55` | transformers-loader | **PICK (pending)** |
| 5 | `c32ddead2` | ADR-094 docs | **PICK (pending)** |
| 6 | `bd55cd7cb` | memory-bridge post-init parallelize | **HAND-PORT (pending)** to post-extraction seam |
| 7-10 | `6b46946dc`, `122193a45`, `3eb6b4d65`, `0377945c9` | intelligence dedup, memory stats, content-hash dedupe, idempotent init | **PICK (pending)** |
| 11 | `d031c3d13` | agentdb delete MCP tools | **HAND-PORT (pending)** to post-extraction agentdb-tools.ts |
| 12 | `966335022` | bsqlite optdep + ^12.9.0 | **PICK (pending)** — coordinate with ADR-0086 Debt 7 state |
| 13-14 | `d6936bae3`, `3e8781bd2` | memory alpha.15 anchor, CI no-bsqlite | **PICK (pending)** |
| 15-21 | `e6478f9ab`...`ccf58ea4d` | ADR-096 design + P1–P5 | **PICK (pending)** — strict-ordered |
| 22-24 | `62a6fc5fb`, `7e1cc06df`, `149ea30a4` | ADR-097 design + P1 + plugin docs | **PICK (pending)** — re-evaluate against fork's ADR-097 implementation status |
| 25-27 | `9d4a9ea96`, `3ba0b6141`, `779eb309b` | ADR-101 squash + build-fix + witness register | **HAND-PORTED (already)** via `3ba0b6141` (in fork main) and `779eb309b` (in fork main) — verify; upstream squash itself NOT picked |

Open in v2: **24 PICK / HAND-PORT (pending)** (subset of 27).

Note: Picks #25-27 — `3ba0b6141` and `779eb309b` actually appear in our
fork's main log (verified via `tail` of ruflo delta sample). Hand-port
classification confirmed.

**New since v1** (sampled from ruflo delta head): local fork-side commits
landing ADR-105 through ADR-120 (federation, midstream/QUIC, ADR-115
managed agents, ADR-117 marketplace MCP). These are **NOT upstream
PICK targets** — local fork work. v2 logs them for context only.

### Batch E — Hive-mind / swarm / MCP fixes (ruflo)

**v2 verdict: CLOSED.**

Evidence from v1 amendment + ADR-status-audit:

* `hive-mind-tools.ts:66, 241` carries `// ADR-093 F3 (ADR-0162 Batch E
  hand-port)` for consensus persistence wiring.
* `3b3f94c54` lands findProjectRoot in F2 daemon detection.
* ADR-0184 (implemented 2026-05-18) ported the hive-mind consensus handler
  to `forks/agentdb/src/archivist/handlers/hive-mind/consensus/<strategy>.ts`.
* ADR-0185 (implemented 2026-05-18) retired the cli-side handler.

All 8 v1 SHAs in Batch E are subsumed. v2 closes Batch E with no open PICKs.

### Batch F — CLI / doctor / init + cli-core split (ruflo)

**Phase F-1**: ~22 standard CLI/doctor/init commits. v1 plan said "apply
oldest → newest; watch for memory-initializer.ts collisions". v2 marks
these as **PICK (pending)** with the same pre-flight: collision check
against `cfb0cea02` per ADR-0156.

**Phase F-2 (`ba92c5612` cli-core split)**: **HAND-PORTED (already)** via
`1f4d13097` and `d9275844b`. `v3/@claude-flow/cli-core/` directory present
with `dist/`, `src/`, `package.json`, `tsconfig.json`, `README.md`,
`MIGRATION.md`.

Open in v2: **22 PICK (pending)** for Phase F-1.

### Batch G — ADR-0001 plugin contract bundle (ruflo)

**v2 verdict: SUPERSEDED BY LOCAL WORK.**

v1 targeted `df49b5176..6324f5ae0` + `b5b6fb3fb` (30 commits) to bump
plugin contracts to v0.2.0/v0.3.0. Current state:

* `forks/ruflo/plugins/ruflo-sparc/.claude-plugin/plugin.json` → v0.2.17
* `forks/ruflo/plugins/ruflo-swarm/.claude-plugin/plugin.json` → v0.2.17
* `forks/ruflo/plugins/ruflo-testgen/.claude-plugin/plugin.json` → v0.2.17
* `forks/ruflo/plugins/ruflo-workflows/.claude-plugin/plugin.json` → v0.2.17

79 plugin-themed commits since 2026-05-09 (counted from ruflo delta) have
driven local plugin work past v1's PICK target. `aea151567` is a Batch K
hand-port (cost-tracker rebrand). Plugin contract substance is in.

**Risk to monitor**: re-runs of upstream merge could re-introduce
`mcpServers` blocks in umbrella `.claude-plugin/plugin.json` (the original
ADR-0117 Phase 1 rollback target). Per Decision 5: codemod Pass 5 owns the
sanitization; v2 confirms keep.

Open in v2: **0**. Batch G closes.

### Batch H — agentic-flow (29 v1 + 1 new SHA)

**Cwd**: `/Users/henrik/source/forks/agentic-flow`.

#### H-1: APPLY (6 v1 commits)

| # | SHA | v1 Action | v2 Action |
|---|-----|-----------|-----------|
| 1 | `f5b6c7d` | PICK with retarget | **HAND-PORTED (already)** via `1528b14` (agentic-flow side) |
| 2 | `50eef3a` | PICK (WASM regen only) | **HAND-PORTED (already)** via `ae20875` |
| 3 | `c2af4dc` | RE-TARGET to forks/agentdb | **HAND-PORT (pending)** — agentdb side never received this; ruvector paired half landed via `ee8bca9` |
| 4 | `d231a13` | PICK (.gitignore only) | **HAND-PORTED (already)** via `a24a00e` |
| 5 | `e60a5ba` | PARTIAL (top-level test infra) | **HAND-PORTED (already)** via `7c6d510`; playwright + browser test files present |
| 6 | `62e4961` | Skip if 5 lands | **SKIP (verified)** — content subsumed by `7c6d510` |

Open in v2: **1 HAND-PORT (pending)** (`c2af4dc`).

#### H-2: RE-TARGET to forks/agentdb (3 docs)

| SHA | Doc | v2 Action |
|---|---|---|
| `c830a98` | ADR-072-ruvector-advanced-features-integration.md | **RE-TARGETED (already)** — present in `forks/agentdb/docs/adrs/` |
| `25b26e2` | ADR-071-agentdb-ruvector-wasm-capabilities-review.md | **RE-TARGETED (already)** — present |
| `54440ca` | PRE-PUBLISH-REVIEW.md | **RE-TARGETED (already)** — present at `forks/agentdb/PRE-PUBLISH-REVIEW.md` |

Open in v2: **0**.

#### H-3: SKIP (20 commits, mechanical — v1 list still valid)

`daa521a`, `61f5841`, `629eb4f`, `bc31f0b`, `5e0497d` (5 submodule pins);
`d671c91`, `57a3859`, `1b85f67` (3 release no-ops);
`bd434bf`, `45bbf17`, `7bbe540`, `6ef7ebb`, `0a8d6a1`, `24adb18`,
`034b0a6`, `acfba14`, `2f24973`, `d19c130`, `a65ae9e` (11 lift-and-shift);
`74f1a59` (1 historical release note). Total: **20 SKIP** (v2 confirms).

#### H-4: NEW since v1 (1 commit)

| SHA | Subject | v2 Action |
|---|---|---|
| `b280a4c` | WebSocket QUIC fallback for federation transport (#153) | **PICK (pending)** — directly relevant to fork's ADR-097 federation peer transport; upstream's QUIC API was stubbed |

Open in v2 (combining H-1 + H-4): **2** (`c2af4dc` to agentdb,
`b280a4c` PICK to agentic-flow).

### Batch I — ruvector (39 v1 + 8 new = 47 ahead)

**Cwd**: `/Users/henrik/source/forks/ruvector`.

#### I-1: APPLY v1 chronological chain (21 SHAs)

| Cluster | SHAs | v1 Action | v2 Action |
|---|---|---|---|
| Hailo cluster | `d771d06ee` → `c7b0ba4c0` → `c12d828b7` → `0442856c3*` → `c6d69003a` → `55eae8887` | PICK chronologically | **PICK (pending)** all 6 — `0442856c3*` requires binary-hunk strip |
| Graph-node delete | `1493bab01` | PICK (manual merge, paired with c2af4dc) | **HAND-PORTED (already)** via `ee8bca912` |
| Sparse-attention | `4922b034f` → ... → `51b1ca777` (9 SHAs in chain) | PICK strict-ordered | **PICK (pending)** all 9 |
| Docs | `c30987277`, `068bb637a`, `36912ba3e`, `58de8932d` | PICK | **PICK (pending)** all 4 |

Open in v2: **18 PICK (pending)**, **1 HAND-PORTED (already)**.

#### I-2: SKIP 18 NAPI binaries (verified pure binary)

`ef5274c29`, `e38347601`, `6808c706e`, `fa39e66cf`, `ec4e4bbd1`,
`1b106721b`, `5c580ebae`, `645c94df4`, `259c28965`, `5ea1c275e`,
`b71981b5c`, `81a3532f3`, `77b44c2e1`, `999bfbdf7`, `225184550`,
`368d64a29`, `5e0a1a414`, `8b518302c`. v2 confirms **18 SKIP**.

#### I-3: NEW since v1 (8 commits)

| SHA | Subject | v2 Action |
|---|---|---|
| `51b1ca777` | sparse-mario (training-free retrieval LM + masked diffusion + ruvllm_retrieval_diffusion) | **PICK (pending)** — appears in v1's I-1 sparse-attention chain; double-check it lands cleanly without 8 prerequisites from chain |
| `8f9742129` | rairs-ivf — RAIRS IVF, ruvector's first Inverted File Index (ADR-193) (#459) | **PICK (pending)** |
| `a80a46d07` | shorten keyword to satisfy crates.io 20-char limit | **PICK (pending)** — minor; carries with the ADR-193 chain |
| `bc3a9b1c9` | 9-issue cleanup batch + regression-guard CI workflow (#466) | **PICK (pending)** |
| `c4212106f` | close 3 regression-guard coverage gaps from PR #466 review (#468) | **PICK (pending)** — depends on `bc3a9b1c9` |
| `29ba5349e`, `9054c2cc6`, `12f8890e0`, `53f041978` | NAPI binary regen chores | **SKIP** (4) — same policy as I-2; we rebuild from source |

Open in v2 (combining I-1 + I-3): **22 PICK (pending)** + 1
HAND-PORTED + 22 SKIP.

#### I-4: Cross-compile rebuild blocker

`cross_compile_setup` still false (xwin missing). Rebuild of Windows NAPI
target deferred until P1 is closed. Recommended remediation:

```bash
cargo install cargo-xwin
```

#### I-5: ADR-0167 sequencing

Ruvector's NAPI tip (`53f041978`) lands fresh binaries built from
`c4212106f` content. ADR-0167's RVF cross-process write coordination
applies at the rust layer. v2 notes: do NOT rebuild ruvector NAPI before
both (a) v2 picks land and (b) ADR-0167's superblock pattern lands (if
that's the chosen path — ADR-0167 still in "discussion" status). Confirm
with ADR-0167 owner before rebuild.

### Batch J — CI / witness / release / docs (ruflo, ~25 commits)

**SKIP — 5 README prose** (v1 verified):
`00039a833`, `cb3809820`, `1c266663c`, `7523e4daa`, `6f11cc794`.
Per ADR-0143 the sparkling-branded README is canonical; upstream's
Cognitum.One affiliate links + `npx ruvflo init` typo + 🔌 emoji tweaks
remain SKIP.

**Open in v2**: ~20 PICK (pending) for the remaining CI/witness/release
churn. Run last so witness manifests reflect actual state.

### Batches K-and-beyond (out of v1's scope; introduced by v2)

The 109 net-new ruflo commits between 2026-05-09 and 2026-05-18 include
substantial local fork-side feature work (ADR-105 to ADR-120, federation
optimisations, neural-trader mitigations). These are **NOT upstream PICK
targets** — they're already in our fork. v2 records them for context
under §Background, batch table OMITTED.

## Cross-conflict audit (post-May-9 ADRs)

| Post-May-9 ADR | Status (2026-05-18) | Affected v2 batches | Resolution |
|---|---|---|---|
| ADR-0117 | revising | G | **No collision (verified).** Plugin manifests don't carry `mcpServers` blocks (sampled `ruflo-agentdb/.claude-plugin/plugin.json` v0.3.17 — none). Upstream `df49b5176` inspected — modifies plugin.json `version`/`keywords` + adds `smoke.sh`, no `mcpServers` block. The plugin.json `version` field is the plugin schema version, not an MCP namespace. ADR-0117 post-revision and Batch G are orthogonal. Codemod Pass 5 stays. |
| ADR-0143 | accepted | J | **Skip** 5 README prose commits (upstream's Cognitum.One + `npx ruvflo init` typo conflict with sparkling brand). |
| ADR-0161 | implemented | H pre-extraction | **Skip** 11 pre-extraction commits — lift-and-shift verified 3/3 sentinel files present. |
| ADR-0167 | accepted | I rebuild order | **Risk-surface verified clean.** ADR-0167's coordination surface is `crates/ruvector-rvf/src/{read_path.rs,write_path.rs,store.rs}`. All 20 Batch I v1 PICK SHAs (Hailo cluster + sparse-attention + docs) probed via `git show --name-only`: **zero touches** to those three files. New SHA `bc3a9b1c9` touches `crates/mcp-brain-server/src/store.rs` — different crate, not RVF. **Sequence Batch I NAPI rebuild** after ADR-0167's superblock pattern lands so the rebuild ships the authoritative coordination layer. |
| ADR-0177 | proposed (substrate in force) | H test infra, I sparse-attention | **No conflict (verified).** ADR-0177 §Decision Outcome anchors graph data as RVF segments via `@ruvector/graph-node`. Batch H entry `e60a5ba` brings in `tests/browser/graph-transformer-wasm.test.ts` — file header reads "Phase 2 of ADR-071: WASM Fallback Testing"; imports are `@playwright/test` + `ruvector-graph-transformer-wasm`; tests `JsGraphTransformer` and `SublinearAttention` instantiation only. No archivist / substrate / write-path touches. Test infra is additive. |
| ADR-0180 / ADR-0181 | accepted / implemented | H browser test | **No conflict (verified).** Same Playwright-WASM test file. Imports `@playwright/test` and `ruvector-graph-transformer-wasm` only; does NOT import from archivist modules. Confirmed by reading `e60a5ba:tests/browser/graph-transformer-wasm.test.ts` directly. |
| ADR-0184 / ADR-0185 | implemented | E (closed) | **Closes** Batch E — consensus handler ported + cli retired; ADR-0162 Batch E hand-port subsumed. |

## Post-all-batches (deferred to execution ADR)

Pipeline hand-off identical to v1 §Post-all-batches — `npm run release`
orchestrates `fork-version.mjs`, codemod, build, Verdaccio publish, and
acceptance. **v2 does not re-spec the pipeline**; it just lists the gates
the future executor must clear:

1. Sanity gate: `git log origin/main --not main --oneline | wc -l` per fork
   ≤ expected residual (5 README + 20 SKIP for ruflo, ≤ 8 for agentic-flow,
   ≤ 22 NAPI binaries for ruvector).
2. Version anchor advance (`scripts/fork-version.mjs`).
3. `npm run release` (Verdaccio publish + codemod + acceptance gate).
4. Cold-cache benchmark: `time npx -y --registry=http://localhost:4873
   @sparkleideas/ruflo@latest --version` < 5s.
5. Push to `sparkling` for each fork (`origin` is `ruvnet` read-only).

## Open follow-ups (carried from v1, not closed by v2)

v1's "Follow-up audit tasks (out of scope for this sync)" §1-5 are still
open. v2 carries them forward unchanged:

1. **Fetch-timeout audit** — port `AbortSignal.timeout(N)` pattern to
   transfer-store CDN, IPFS upload/HEAD, neural artifact downloads,
   iot-cognitum witness sync.
2. **DB-write file-mode audit** — verify all sensitive write sites use
   `writeFileRestricted` or equivalent 0600 discipline.
3. **Pipeline silently-drops new artifacts** — `lib/napi-config.sh` and
   `scripts/build-wasm.sh` hardcoded allowlists; add fail-loud detection.
4. **agentdb dead build scripts** — vestigial `build:napi`/`build:wasm` in
   `forks/agentdb/package.json` reference non-existent dirs.
5. **Cross-compile pinning** — pin `zig` and `cargo-zigbuild` to known-good
   versions; `cargo-xwin` install not yet recorded.

New follow-ups from v2 analysis:

6. **`c2af4dc` → forks/agentdb hand-port** — agentic-flow side of the
   paired delete API never reached agentdb. Ruvector graph-node side
   landed via `ee8bca9`; agentdb GraphDatabaseAdapter + ReflexionMemory
   half is open.
7. **Batch A pending PICKs** (7) — `c67fa393d`, `1884ed101`, `f46e52f41`,
   `66f7f644d`, `fd4c3cb3c`, `003ce127b` + verification that `d88c69dde`
   hand-port (`0d4219518`) covers the full intent of #1852/#1853/#1854.
8. **Batch B pending PICKs** (12) — security tightening not yet
   hand-ported (validateEnv loader-hijack denylist, IPFS HEAD timeout,
   shell-injection close on github-tools + executor.ts, hooks
   `$TOOL_INPUT`, vitest pin).
9. **Batch C+D pending PICKs / hand-ports** (24) — embeddings alpha
   versions, transformers-loader, ADR-094 docs, memory-bridge
   parallelize hand-port to post-extraction seam, agentdb delete MCP
   tools hand-port, ADR-096 P1–P5 phases (strict-ordered), ADR-097
   design + P1.
10. **Batch F-1 pending PICKs** (~22) — standard CLI/doctor/init
    sequence; coordinate with `cfb0cea02` (ADR-0156).
11. **Batch I pending PICKs** (~22) — Hailo cluster, sparse-attention
    chain (with sparse-mario as the latest), rairs-ivf, regression-guard
    CI, docs.
12. **Batch J pending PICKs** (~20) — CI/witness/release tail; run
    last so witness reflects actual state.
13. **Verify ADR-0094 living-tracker claim** — ADR-status-audit-2026-05-18
    flagged that "the ADR-0094 living tracker has not been updated with
    `acceptance_tests_pass: true` for ADR-0162". ADR-0094 itself is
    **closed** as a decision snapshot (per its frontmatter); volatile
    state lives in `docs/adr/ADR-0094-log.md` + `test-results/CATALOG.md`.
    v2 leaves the audit-tracker-update question to whoever executes the
    pending PICKs.

## More information

* **Supersedes**: ADR-0162 (kept open; v1 amendment records partial
  close-out for Batches A/B/C+D/E/F/K).
* **Source-of-truth status audit**: `docs/council/ADR-status-audit-2026-05-18.md`.
* **v1 plan files** (still applicable for execution detail):
  * `docs/plans/upstream-sync-2026-05-09.md`
  * `docs/plans/upstream-sync-2026-05-09-batch-A-daemon.md`
  * `docs/plans/upstream-sync-2026-05-09-batch-B-security.md`
  * `docs/plans/upstream-sync-2026-05-09-batch-CD-memory-adr.md`
  * `docs/plans/upstream-sync-2026-05-09-batch-G-plugin-contract.md`
  * `docs/plans/upstream-sync-2026-05-09-batch-HI-cross-fork.md`
* **Delta snapshots (2026-05-18)**:
  * `/tmp/adr0186-ruflo-delta.txt` (329 lines)
  * `/tmp/adr0186-agentic-flow-delta.txt` (30 lines)
  * `/tmp/adr0186-ruvector-delta.txt` (47 lines)
* **Author report**: `docs/council/ADR-0186-author-report.md`.
