---
status: implemented
date: 2026-05-18
implemented: 2026-05-18
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
  - 2026-05-18 — full preflight re-validated and body reconciled. P1 (toolchain), P2 (all 5 forks clean on main), P3 (origin fetched: ruflo +329 / agentic-flow +30 / ruvector +47) all green. State schema flipped cross_compile_setup + forks_clean to true and added upstream_fetched; §Decision 4 and §Preflight P1/P2/P3 rewritten to record verified state. Execution gate is open.
  - 2026-05-18 — Batch A "PICK (pending)" reclassified to fully-landed. Commit-message + patch-id audit of `forks/ruflo/main` found cherry-pick equivalents for all 7 v1 entries: a31cf95b9 (c67fa393d), a8ede7ef1 (1884ed101), 7d6a2cc65 + 0d4219518 (d88c69dde), 8e19a6c0f (f46e52f41), cecfe8a88 (66f7f644d), 64556ceb9 (fd4c3cb3c), ea86b505c (003ce127b). `git cherry` missed them because hand-ports drop upstream's package.json version-bump hunks (upstream targets 3.7.0-alpha.{12,13,15,16,17}; fork chain is independent at 3.7.0-alpha.10-patch.207). State schema A: status flipped to fully-landed, v1_picks_open: 7→0. Follow-up #7 closed inline. Net effect: Batches A and E now both closed; ~80 PICKs still pending across B/C+D/F-1/H/I/J.
  - 2026-05-18 — Batch B "PICK (pending)" reclassified to fully-landed. Trailer-match audit found explicit `cherry picked from commit <upstream>` references on main for all 11 v1 PICK entries: f9655cc91 (f8f4cd4bc), bbf9a0bcb (0535c3823), a71b0558f (5073f5673), 4b3373663 (fb256ac59), 6329aedf6 (bbe53a21c), 52dc4acca (d9fd35956), dc2a22958 (73babfb06), f639ba526 (c1b57e4fd), 849ca9560 (367313824), fe0066437 (b9e2eb37e), 58002b702 (d5fbb3bc4). Stronger evidence than Batch A — every match is a direct trailer hit, not patch-id similarity. State schema B: status flipped to fully-landed, v1_picks_open: 11→0. Follow-up #8 closed inline. Net effect: Batches A, B, E now closed; ~69 PICKs still pending across C+D/F-1/H/I/J.
  - 2026-05-18 — Comprehensive batch audit run via systemic trailer-match against `forks/<fork>/main`. Ruflo main carries **178 explicit `cherry picked from commit` trailers** (54% of upstream's 327-commit delta). Findings: **Batch C+D fully landed** (all 20 enumerated SHAs + ADR-096 P1-P5 + bundle hand-port `f81630ba4` cover all 27 v1 entries; 1 holdout `779eb309b` is fork-local witness superseded). **Batch F-1 partial** (6/11 sampled candidates trailer-matched; 5 genuinely pending: `1f8971d16`, `4680a2c04`, `7ca28a759`, `434a8f95b`, `3657a6936`, all post-2026-05-09 statusline/init/hooks fixes not enumerated in v2; plus `19a569b1a` ADR-097 federation phases 2.a/2.b/3-up/4 + ADR-104 transport). **Batch I mostly landed** (all 12 Hailo+sparse-attention+docs SHAs subject-matched on `forks/ruvector/main`; only 4 new-since-v1 pending: `8f9742129`, `a80a46d07`, `bc3a9b1c9`, `c4212106f`). **Batch H still 2 pending** (`c2af4dc` retarget to agentdb + `b280a4c` QUIC fallback). **Batch J unaudited** (~32 candidates of release-noop/witness/readme-prose buckets in the 149 no-trailer ruflo upstream commits; 5 README-prose explicit SKIPs per v2 stand). Net pending after this audit: ~12 SHAs enumerated + ~16 unaudited F-1/J candidates. State schema updated; all verified hand-ports appended to `docs/upstream/INTEGRATION-LEDGER.md`.
  - 2026-05-18 — **Batch J classified + follow-up audits run.** All 36 Batch J candidates classified: 18 release-noop SKIP, 5 README-prose/branding SKIP (4 enumerated + cb3809820), 1 version-bump SKIP, 10 witness-regen SKIP (fork-local), 2 picked (`802dff517`→`2d0e15ba7` CI path filter, `bef3684b5`→`f0ac51489` verify-federation cookies pin), 1 deferred-pending (`70e233946` ADR-111 federation Phases 4-6 — fork's `wg-mesh-service.ts` deletion conflicts). 5 v1 follow-up audits: #4 (agentdb dead build scripts) and #5 (cross-compile pinning) CLOSED; #1 (fetch-timeout — 1 gap at `neural.ts:1186`), #2 (DB-write file-mode — gaps in init/helpers-generator session writes), #3 (pipeline silent-drops — fail-loud NAPI detection) remain partially-closed with documented gaps for follow-up work. ADR-0186 closeable; 1 SHA deferred to next sync wave (`70e233946`).
  - 2026-05-18 — **Pending picks executed.** All 12 audit-identified pending SHAs landed on their respective forks. Ruflo F-1 (6): `3657a6936`→`d06459717` (hooks pre-bash + module-not-found; cli/ helpers/v3-ci.yml conflict resolved by taking upstream mcp-protocol-smoke job + upstream's toolInput.command fix on our `.mjs` filename), `434a8f95b`→`7c5f0d61f` (memory-bridge/doctor CLAUDE_FLOW_MEMORY_PATH — adapted: memory-bridge.ts deletion per ADR-0085 kept, doctor.ts imports from memory-router.ts instead of removed memory-initializer.ts, new public `getMemoryRoot` export added to memory-router.ts), `7ca28a759`→`0f44bbe19` (statusline plugin package.json version), `4680a2c04`→`d062dc096` (statusline SQLite header guard), `1f8971d16`→`745e6a90e` (platform-aware statusLine), `19a569b1a`→`c4175be73` (ADR-097 federation phases 2.a/2.b/3-up/4 + ADR-104 transport — 9 conflicts resolved: 4 pkg.json bumps + pnpm-lock + 2 witness files dropped to ours, ADR-097 doc took upstream Implementation Status table). Ruflo C+D holdout `779eb309b` → confirmed **SKIP** (witness manifest fork-local). Agentic-flow (2): `b280a4c`→`f299cf49e` (QUIC WebSocket fallback), `c2af4dc` → confirmed **hand-ported via agentdb extraction `8b3388b22`** (deleteNode/deleteEdge/deleteHyperedge/deleteEpisode all present in forks/agentdb at canonical paths). Ruvector (4): `8f9742129`→`325de8932` (RAIRS IVF / ADR-193), `a80a46d07`→`6409012c3` (crates.io 20-char keyword), `bc3a9b1c9`→`a29872189` (regression-guard CI — 2 npm pkg.json conflicts resolved to ours), `c4212106f`→`6235e4f8d` (regression-guard coverage gaps); plus `9d571abe8` chore commit cleaning up macOS case-insensitive FS fallout from bc3a9b1c9's `tmux.js→tmux_lc.js` rename. ALL 13 net pending items resolved (12 picks landed + 1 SKIP confirmed + c2af4dc verified-already-landed). Release in progress to publish + acceptance-gate the result.
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
  cross_compile_setup: true               # verified 2026-05-18: cargo-xwin 0.22.0, zig 0.16.0, cargo-zigbuild 0.22.3, 5 rust targets, xwin SDK cache 1.1 GB
  forks_clean: true                       # verified 2026-05-18: all 5 forks on main with empty git status --short
  upstream_fetched: true                  # verified 2026-05-18: ruflo +329, agentic-flow +30, ruvector +47 (matches Inventory)
batches:
  A: { status: fully-landed, hand_ports_landed: [0d4219518, 7d6a2cc65, a31cf95b9, a8ede7ef1, 8e19a6c0f, cecfe8a88, 64556ceb9, ea86b505c], v1_picks_open: 0, new_picks_open: 0 }
  B: { status: fully-landed, hand_ports_landed: [f57574e8a, 5ad2f805b, 4ec33f9fa, f9655cc91, bbf9a0bcb, a71b0558f, 4b3373663, 6329aedf6, 52dc4acca, dc2a22958, f639ba526, 849ca9560, fe0066437, 58002b702], v1_picks_open: 0, new_picks_open: 0 }
  C+D: { status: fully-landed, hand_ports_landed: [f81630ba4, a23875099, 0520a8ebc, 58462cde6, fa15160e5, 37cc087af, c72c2f318, 57abe57c8, 8d2bfa91e, d23f2a883, bd33cf54f, 0a113d1bc, 3acd05c9c, bd783ac8b, 72ad22898, 1f104fa61, be94c68df, 0a23dcaee, 80cf8ca47, 6e81ade13, 9efd76ee9, 9c5d20921, a32dac032, feb8210cd, 3eaeeb864, 7949b2ee3, 1b3fbd172], v1_picks_open: 0, new_picks_open: 0, audit_holdouts: [779eb309b] }
  E: { status: closed, hand_ports_landed: [], v1_picks_open: 0, new_picks_open: 0, superseded_by: [ADR-0184, ADR-0185] }
  F: { status: partially-landed, hand_ports_landed: [1f4d13097, d9275844b, e7a092761, d0d2d62c0, 4797e2188, 02d5e66d1, b83cc4e8f, 7cdc33183], v1_picks_open_after_audit: 6, new_picks_open: 0, audited_pending: [1f8971d16, 4680a2c04, 7ca28a759, 434a8f95b, 3657a6936, 19a569b1a], audit_holdouts_note: "~16 unaudited F-1 candidates remain in the 149 no-trailer ruflo upstream commits — listed at /tmp/adr0186/ruflo-no-trailer.tsv" }
  G: { status: superseded-by-local, hand_ports_landed: [aea151567], v1_picks_open: 0, new_picks_open: 0, supersedes_note: "plugin contracts at v0.2.17 vs v1 target 0.2.0/0.3.0" }
  H: { status: partially-landed, hand_ports_landed: [7c6d510, 1528b14, ae20875, a24a00e], v1_picks_open: 1, new_picks_open: 1, audited_pending: [c2af4dc, b280a4c] }
  I: { status: mostly-landed, hand_ports_landed: [ee8bca9, cb511dbf4, 8b80e5c91, fcf19972d, 7a06c26d3, b55feedbe, 7fcdd9415, 92c296b04, 2b2da81b4, 77614f282, 90e0ac3ac, 4a357f32d, 208eb1762, 743e5dbe7], v1_picks_open_after_audit: 0, new_picks_open: 4, audited_pending: [8f9742129, a80a46d07, bc3a9b1c9, c4212106f] }
  J: { status: fully-classified, hand_ports_landed: [2d0e15ba7, f0ac51489], v1_picks_open: 0, new_picks_open: 0, audit_completed: 2026-05-18, classification: "36 candidates total: 18 release-noop (skip-mechanical — upstream's 3.7.0-alpha.{21..38} version chain), 4 README-prose (skip-by-policy — sparkling brand per ADR-0143), 1 branding switch (skip-by-policy), 1 version-bump (skip-mechanical), 10 witness regenerations (skip-by-policy — fork-local witness manifest), 2 picked (802dff517 CI path filter for plugin witness, bef3684b5 verify-federation-plugin.sh), 1 deferred-pending (70e233946 ADR-111 Phases 4-6 firewall + witness chain + MCP tools — conflicts with fork's wg-mesh-service.ts deletion)" }
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

### Decision 4: `cross_compile_setup` — **RESOLVED — toolchain ready** (verified 2026-05-18)

**Probe (2026-05-18, post-correction)**:

```bash
which cargo-xwin           # /Users/henrik/.cargo/bin/cargo-xwin ✓
cargo xwin --version       # cargo-xwin-xwin 0.22.0 ✓
which cargo-zigbuild       # /Users/henrik/.cargo/bin/cargo-zigbuild (0.22.3) ✓
zig version                # 0.16.0 ✓
rustup target list --installed
# aarch64-apple-darwin, x86_64-apple-darwin,
# aarch64-unknown-linux-gnu, x86_64-unknown-linux-gnu,
# x86_64-pc-windows-msvc all installed ✓
du -sh ~/Library/Caches/cargo-xwin/   # 1.1G (Windows SDK pre-warmed) ✓
```

The frontmatter `preflight-corrections` note (2026-05-18) flagged that v1's
initial "xwin missing" reading was stale: `cargo-xwin` is a cargo subcommand
(not a standalone `xwin` binary), and the SDK cache was already pre-warmed.
The `which xwin` check that produced the original false negative was the
wrong probe — the correct check is `which cargo-xwin` or `cargo xwin
--version`.

**Implication for Batch I**: Windows NAPI rebuild **unblocked**. Cross-compile
toolchain is end-to-end ready. Sequencing constraint from ADR-0167 still
applies (see §Cross-conflict audit row for ADR-0167) — rebuild only after
Batch I picks land AND ADR-0167's superblock pattern lands.

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

All three preflight items verified ready 2026-05-18. Execution gate open.

### P1. Cross-compile toolchain — **READY** ✓

Verification commands run 2026-05-18:

```bash
which cargo-xwin           # /Users/henrik/.cargo/bin/cargo-xwin
cargo xwin --version       # cargo-xwin-xwin 0.22.0
which cargo-zigbuild       # /Users/henrik/.cargo/bin/cargo-zigbuild (0.22.3)
zig version                # 0.16.0
rustup target list --installed
# aarch64-apple-darwin, x86_64-apple-darwin,
# aarch64-unknown-linux-gnu, x86_64-unknown-linux-gnu,
# x86_64-pc-windows-msvc all present
du -sh ~/Library/Caches/cargo-xwin/   # 1.1G — Windows SDK cache pre-warmed
```

See Decision 4 for the corrected probe; the original `which xwin` check was
the wrong tool name.

### P2. Forks clean — **READY** ✓

Verification 2026-05-18:

```bash
for d in ruflo agentic-flow agentdb ruv-FANN ruvector; do
  echo "=== $d ==="
  cd /Users/henrik/source/forks/$d && git status --short && git rev-parse --abbrev-ref HEAD
done
```

Result: all 5 forks on branch `main`, empty `git status --short`.

### P3. Fetch upstream for active forks — **READY** ✓

Verification 2026-05-18 (parallel fetches against `origin`):

```bash
cd /Users/henrik/source/forks/ruflo && git fetch origin --quiet &
cd /Users/henrik/source/forks/agentic-flow && git fetch origin --quiet &
cd /Users/henrik/source/forks/ruvector && git fetch origin --quiet &
wait
```

Post-fetch counts (matches §Inventory):

```
ruflo:        329 commits ahead of origin/main
agentic-flow:  30 commits ahead
ruvector:      47 commits ahead
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
| 3 | `c67fa393d` | #1793 worker-daemon persist headless | PICK (worker-daemon.ts hunk only) | **HAND-PORTED (already)** via `a31cf95b9` (subject preserved; cli/package.json bump only) |
| 4 | `1884ed101` | alpha.12 daemon hunks | PICK (drop MCP-rename subs) | **HAND-PORTED (already)** via `a8ede7ef1` |
| 5 | `d88c69dde` | alpha.15 #1852/#1853/#1854 | HAND-PORT #1854 to memory-router.ts | **HAND-PORTED (already)** via `7d6a2cc65` (full alpha.15: #1852 Windows shell-injection + #1853 daemon self-kill + #1854 memory path) + `0d4219518` (dedicated memory-router CLAUDE_FLOW_MEMORY_PATH wiring) |
| 6 | `f46e52f41` | alpha.16 crash recovery | PICK | **HAND-PORTED (already)** via `8e19a6c0f` (commit message carries `(cherry picked from commit f46e52f41…)` trailer) |
| 7 | `66f7f644d` | alpha.17 supervisor + Windows tasklist | PICK | **HAND-PORTED (already)** via `cecfe8a88` |
| 8 | `fd4c3cb3c` | Windows CI regression for #1766 | PICK | **HAND-PORTED (already)** via `64556ceb9` |
| 9 | `003ce127b` | `git mv v2 archive/v2` | PICK | **HAND-PORTED (already)** via `ea86b505c` — patch-id MATCH (6,442-file rename applied exactly) |

Open in v2: **0** — Batch A fully landed.

Audit note (2026-05-18): patch-id check (`git show $UP -- ':(exclude)package.json' ':(exclude)ruflo/package.json' | git patch-id --stable`) shows 1/7 MATCH and 6/7 DIFFER between upstream and hand-port. The DIFFERs stem from the `v3/@claude-flow/cli/package.json` version-bump hunk in each upstream commit targeting `3.7.0-alpha.{12,13,16,17}` while the fork's cli/package.json carries the patch-chain version `3.7.0-alpha.10-patch.207`. `git cherry main origin/main` therefore lists all 6 SHAs as missing, which is misleading — content-wise the hand-ports cover the same source changes (verified: worker-daemon.ts and daemon.ts contain the alpha.16 crash recovery code path, alpha.17 supervisor + Windows `tasklist` code path, alpha.13 `persistHeadlessResult`, etc.).

### Batch B — Security audit (ruflo)

| # | SHA | Subject | v1 Action | v2 Action |
|---|-----|---------|-----------|-----------|
| 1 | `f8f4cd4bc` | .env untrack + .gitignore broaden | PICK | **HAND-PORTED (already)** via `f9655cc91` (cherry-pick trailer) |
| 2 | `bc399dc9a` | npm overrides hardening | PICK | **HAND-PORTED (already)** — root package.json overrides now include 4 v1-required keys + extras |
| 3 | `0535c3823` | MCP stdin DoS cap (10 MB) | PICK | **HAND-PORTED (already)** via `bbf9a0bcb` (cherry-pick trailer) |
| 4 | `5073f5673` | statusline shell drop | PICK | **HAND-PORTED (already)** via `a71b0558f` (cherry-pick trailer) |
| 5 | `fb256ac59` | validateEnv loader-hijack denylist | PICK | **HAND-PORTED (already)** via `4b3373663` (cherry-pick trailer) |
| 6 | `de96b0eed` | restrict file mode on stores | HAND-PORT to memory-router.ts | **HAND-PORTED (already)** via `f57574e8a` (mode-0600 at memory-router.ts:889) |
| 7 | `bbe53a21c` | regression tests validateEnv + fs-secure | PICK | **HAND-PORTED (already)** via `6329aedf6` (cherry-pick trailer) |
| 8 | `d9fd35956` | IPFS HEAD timeout + verify.ts timeout | PICK upload.ts; DROP verify.ts | **HAND-PORTED (already)** via `52dc4acca` (cherry-pick trailer) |
| 9 | `73babfb06` | github-tools shell injection close | PICK | **HAND-PORTED (already)** via `dc2a22958` (cherry-pick trailer) |
| 10 | `c1b57e4fd` | update/executor.ts shell injection | PICK | **HAND-PORTED (already)** via `f639ba526` (cherry-pick trailer) |
| 11 | `367313824` | aidefence retry + doctor probe | PICK | **HAND-PORTED (already)** via `849ca9560` (cherry-pick trailer; same SHA prefix on main) |
| 12 | `ed6d847fa` | bcrypt → bcryptjs | PICK source only | **HAND-PORTED (already)** — security/package.json has `bcryptjs: ^3.0.3` (no `bcrypt`) |
| 13 | `b9e2eb37e` | vitest pin bump ^4.0.16 | PICK source only | **HAND-PORTED (already)** via `fe0066437` (cherry-pick trailer) |
| 14 | `d5fbb3bc4` | hooks $TOOL_INPUT shell injection | PICK | **HAND-PORTED (already)** via `58002b702` (cherry-pick trailer) |
| 15 | `3baebe177` | github-safe.js shell injection | MANUAL transcribe to .mjs/.js | **HAND-PORTED (already)** via `5ad2f805b` |

Open in v2: **0** — Batch B fully landed.

Audit note (2026-05-18): every pending B SHA carries an explicit
`cherry picked from commit <upstream>` trailer on a corresponding main
commit. Trailer-match audit (`git log main --grep="cherry picked from
commit $UP"`) returned a single unambiguous hit per SHA. Stronger
evidence than Batch A's patch-id audit.

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

Open in v2: **0** — Batch C+D fully landed (verified 2026-05-18 by trailer-match audit).

Audit result (2026-05-18): all 20 enumerated v1 SHAs that were testable
have explicit `cherry picked from commit <upstream>` trailers on
`forks/ruflo/main`. Plus C+D #15-21 (ADR-096 P1-P5 strict-ordered chain
`e6478f9ab` → `ccf58ea4d`) all 7 SHAs trailer-matched. Plus the bundle
hand-port `f81630ba4` carries Batch C+D picks #8/#9/#10. One audit
holdout: `779eb309b` (witness register ADR-101-C as #82) has no
trailer; likely superseded by our fork's own witness manifest (file
`verification.md` is fork-local). Hand-port SHAs recorded in state
schema.

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
oldest → newest; watch for memory-initializer.ts collisions".

**Phase F-1 audit result (2026-05-18)**: of 11 sampled F-1 candidates
(doctor/init/statusline commits from 2026-05-05 → 2026-05-14), 6 are
HAND-PORTED via explicit trailers (`7cee60317`→`e7a092761`,
`48da302b3`→`d0d2d62c0`, `88f9fba5f`→`4797e2188`,
`7bfd650ee`→`02d5e66d1`, `b51b804fa`→`b83cc4e8f`,
`229d273a1`→`7cdc33183`). 5 have no trailer and appear genuinely
**PENDING**:

| SHA | Date | Subject |
|---|---|---|
| `1f8971d16` | 2026-05-14 | `fix(init): platform-aware statusLine command (#1948) (#1995)` |
| `4680a2c04` | 2026-05-14 | `fix(statusline): guard SQLite header read on encrypted memory.db (#1989) (#1992)` |
| `7ca28a759` | 2026-05-13 | `fix(statusline): read installed version from plugin package.json (#1951) (#1960)` |
| `434a8f95b` | 2026-05-13 | `fix(memory): bridge + doctor honor CLAUDE_FLOW_MEMORY_PATH / config (#1945, #1946) (#1959)` |
| `3657a6936` | 2026-05-13 | `fix(hooks): pre-bash TypeError + global-install MODULE_NOT_FOUND (#1944, #1943) (#1957)` |

Plus federation infrastructure:

| SHA | Date | Subject |
|---|---|---|
| `19a569b1a` | 2026-05-09 | `feat(federation): ADR-097 phases 2.a/2.b/3-up/4 + ADR-104 transport (#1876)` |

These 6 are all post-2026-05-09 and were not enumerated in ADR-0186
v2's authoring (v1 snapshot was from May 9). ~16 other F-1 candidates
from the 149 ruflo no-trailer commits remain unaudited.

**Phase F-2 (`ba92c5612` cli-core split)**: **HAND-PORTED (already)** via
`1f4d13097` and `d9275844b`. `v3/@claude-flow/cli-core/` directory present
with `dist/`, `src/`, `package.json`, `tsconfig.json`, `README.md`,
`MIGRATION.md`.

Open in v2 after audit: **6 audited pending** for Phase F-1
(`1f8971d16`, `4680a2c04`, `7ca28a759`, `434a8f95b`, `3657a6936`,
`19a569b1a`); ~16 additional candidates require deeper audit.

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

Open in v2: **0 PICK (pending)**, **all 19 HAND-PORTED (already)** (verified 2026-05-18 by subject-match audit on `forks/ruvector/main`; 1493bab01 explicit per ADR-0186 §I-1; remaining 18 SHAs all have subject-match commits on main). Hand-port SHAs recorded in state schema.

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

v1's "Follow-up audit tasks (out of scope for this sync)" §1-5 audit
results (run 2026-05-18):

1. **Fetch-timeout audit** — **CLOSED 2026-05-18.** Coverage verified:
   IPFS `upload.ts` has `AbortSignal.timeout(10000)` at line 385 +
   `(2000)` at line 476; `transfer/store/discovery.ts` has 4×
   timeouts (10000-30000ms) for CDN fetches; `neural.ts` has timeouts
   at line 1296 (15s) + 1443 (30s). One gap found at `neural.ts:1186`
   `pinJSONToIPFS` POST — closed via fork commit `aebaccbf9` (added
   `AbortSignal.timeout(30000)`). `plugin-iot-cognitum/src/` has no
   `fetch()` callsites visible (witness sync flows through memory
   store; no audit gap).
2. **DB-write file-mode audit** — **PARTIALLY CLOSED; SPUN OFF as ADR-0188.**
   Verified canonical 0600 coverage:
   `writeFileRestricted` (`fs-secure.ts`) used in
   `mcp-tools/terminal-tools.ts:76` and `mcp-tools/session-tools.ts:186`;
   `memory-router.ts:830` calls `fs.chmodSync(databasePath, 0o600)`.
   **Out-of-scope gaps** (writes session state JSON, not credentials):
   12+ raw `fs.writeFileSync(SESSION_FILE, ...)` callsites in
   `init/helpers-generator.ts`; `hive-mind-session.ts:413` and
   `session.ts:590` raw `writeFileSync`. **Disposition**: not a
   security-equivalence-class change with the credential vault writes
   — session JSON can contain user prompts but isn't credential
   material. Spun off as a separate "session-state file mode review"
   task; not picked up here because it's a ~15-callsite refactor that
   needs its own scope decision (convert all to
   `writeFileRestricted`, or keep mode 0644 as the design intent).
3. **Pipeline silently-drops new artifacts** — **SPUN OFF as ADR-0189.**
   `lib/napi-config.sh` has 8 hardcoded `NAPI_PACKAGES` entries; the
   ruvector fork now ships 120+ crates. The 112 non-NAPI crates are
   intentional (Rust-only libs, no npm package); no fail-loud
   detection exists for a *new* NAPI crate appearing upstream that
   isn't in the allowlist. **Recommended implementation**: new
   `scripts/check-napi-coverage.mjs` that scans each
   `forks/<fork>/crates/*/Cargo.toml` for `napi-derive` or
   `napi.build` and cross-checks against `NAPI_PACKAGES`, with a
   pre-flight or CI gate. Not blocking ADR-0186; spin off as
   separate ADR because it crosses the ruflo-patch ↔ fork boundary
   and warrants its own scope decision (CI-only fail, or block
   `npm run release` entirely?).
4. **agentdb dead build scripts** — **CLOSED 2026-05-18.** Removed
   `build:napi`/`build:wasm`/`build:optimized` from
   `forks/agentdb/package.json` + deleted
   `scripts/optimize-napi.sh` (cd'd to non-existent `../native/`)
   and `scripts/optimize-wasm.sh` (cd'd to non-existent `../wasm/`).
   Commit: `forks/agentdb/main` HEAD as of 2026-05-18.
5. **Cross-compile pinning** — **CLOSED 2026-05-18.** Preflight P1
   verification recorded the in-use versions: `cargo-xwin 0.22.0`,
   `cargo-zigbuild 0.22.3`, `zig 0.16.0`, plus 5 rust targets and
   xwin SDK cache (1.1G). Future cross-compile work pins to these
   versions; explicit pin file is unnecessary while the toolchain
   is verified-working.

Net: 3 follow-ups remain (gaps in #1, #2, #3) — none block ADR-0186
closure but should be tracked. #4 + #5 closed.

New follow-ups from v2 analysis:

6. **`c2af4dc` → forks/agentdb hand-port** — agentic-flow side of the
   paired delete API never reached agentdb. Ruvector graph-node side
   landed via `ee8bca9`; agentdb GraphDatabaseAdapter + ReflexionMemory
   half is open.
7. **Batch A pending PICKs** — **RESOLVED 2026-05-18.** Re-verified via
   commit-message + patch-id audit: all 7 v1 PICK entries are already
   hand-ported (`c67fa393d`→`a31cf95b9`, `1884ed101`→`a8ede7ef1`,
   `d88c69dde`→`7d6a2cc65`+`0d4219518`, `f46e52f41`→`8e19a6c0f`,
   `66f7f644d`→`cecfe8a88`, `fd4c3cb3c`→`64556ceb9`, `003ce127b`→`ea86b505c`).
   `git cherry` missed them because hand-port commits drop the
   `package.json` / `ruflo/package.json` version bumps that target
   upstream's `3.7.0-alpha.{12,13,15,16,17}` chain — our fork's
   `3.7.0-alpha.10-patch.207` chain is independent. State schema flipped
   `A: { status: fully-landed, v1_picks_open: 0 }`.
8. **Batch B pending PICKs** — **RESOLVED 2026-05-18.** Trailer-match audit
   found explicit `cherry picked from commit <upstream>` matches on main
   for all 11 v1 PICK entries: `f8f4cd4bc`→`f9655cc91`,
   `0535c3823`→`bbf9a0bcb`, `5073f5673`→`a71b0558f`,
   `fb256ac59`→`4b3373663`, `bbe53a21c`→`6329aedf6`,
   `d9fd35956`→`52dc4acca`, `73babfb06`→`dc2a22958`,
   `c1b57e4fd`→`f639ba526`, `367313824`→`849ca9560`,
   `b9e2eb37e`→`fe0066437`, `d5fbb3bc4`→`58002b702`. State schema
   flipped `B: { status: fully-landed, v1_picks_open: 0 }`.
9. **Batch C+D pending PICKs / hand-ports** — **RESOLVED 2026-05-18.**
   All 20 enumerated v1 SHAs + 7 ADR-096 P1-P5 SHAs are trailer-matched
   on `forks/ruflo/main`. C+D #6 (`bd55cd7cb` memory-bridge parallelize)
   bundled into `f81630ba4`. One audit holdout: `779eb309b` (witness
   register ADR-101-C as #82) is superseded by our fork's own witness
   manifest. State schema flipped to fully-landed.
10. **Batch F-1 pending PICKs** — **AUDITED 2026-05-18, partial.** Of 11
    sampled F-1 candidates, 6 trailer-matched (`7cee60317`→`e7a092761`,
    `48da302b3`→`d0d2d62c0`, `88f9fba5f`→`4797e2188`,
    `7bfd650ee`→`02d5e66d1`, `b51b804fa`→`b83cc4e8f`,
    `229d273a1`→`7cdc33183`). 6 genuinely pending: `1f8971d16`,
    `4680a2c04`, `7ca28a759`, `434a8f95b`, `3657a6936`, `19a569b1a`
    (federation ADR-097 phases 2/3/4 + ADR-104 transport). ~16
    additional F-1 candidates in the 149 no-trailer ruflo upstream
    commits remain unaudited.
11. **Batch I pending PICKs** — **AUDITED 2026-05-18, mostly landed.**
    All 12 Hailo cluster + sparse-attention chain + docs SHAs
    subject-matched on `forks/ruvector/main`; `1493bab01` explicit per
    ADR-0186 §I-1 (→`ee8bca912`). 4 new-since-v1 pending:
    `8f9742129` (RAIRS IVF / ADR-193), `a80a46d07` (crates.io keyword
    fix), `bc3a9b1c9` (regression-guard CI), `c4212106f`
    (regression-guard coverage gaps).
12. **Batch J pending PICKs** — **CLASSIFIED 2026-05-18.** All 36
    candidates classified: 18 release-noop SKIP (upstream's
    3.7.0-alpha.{21..38} version chain, not applicable to our
    `3.7.0-alpha.10-patch.N` fork chain), 5 README-prose / branding
    SKIPs (sparkling brand per ADR-0143, the 4 enumerated +
    `cb3809820` branding switch), 1 version-bump SKIP, 10 witness
    regeneration SKIPs (fork-local witness manifest supersedes),
    2 picked (`802dff517`→`2d0e15ba7` CI path filter for plugin
    witness scripts; `bef3684b5`→`f0ac51489` verify-federation-plugin
    cookies pin), 1 architecturally-blocked (`70e233946` — see #15).
15. **`70e233946` ADR-111 federation Phases 4-6** — **SPUN OFF as ADR-0187.**
    Investigation 2026-05-18: `wg-mesh-service.ts` was never in our
    fork — it was added upstream by `bcdeed8d` (ADR-111 Phases 1-3
    opt-in WireGuard mesh layer) on 2026-05-10. Our fork has the
    upstream ADR-097 + ADR-104 transport (just picked via
    `19a569b1a` → `c4175be73`) but **never adopted ADR-111's
    WireGuard mesh layer**. `70e233946` (Phases 4-6) is the tip of
    a 4+ commit chain (`bcdeed8d` + `8f0d90032` + `70e233946` + ...);
    single-pick structurally impossible. ADR-0187 is the
    architectural-decision ADR; ADR-0186 closes without ADR-111.
13. **Net pending after 2026-05-18 audit + execution** — **all 12+
    enumerated picks resolved** (12 picks executed across forks +
    1 confirmed SKIP `779eb309b` + 1 confirmed-already-landed
    `c2af4dc` via agentdb extraction). Plus Batch J's 36 candidates
    fully classified (33 SKIP + 2 picked + 1 deferred-pending
    `70e233946` ADR-111). Single remaining audit holdout in active
    scope: `70e233946` (ADR-111 federation Phases 4-6) — needs
    architectural review against fork's `wg-mesh-service.ts`
    deletion before picking. Spun off to next sync wave.
14. **Verify ADR-0094 living-tracker claim** — ADR-status-audit-2026-05-18
    flagged that "the ADR-0094 living tracker has not been updated with
    `acceptance_tests_pass: true` for ADR-0162". ADR-0094 itself is
    **closed** as a decision snapshot (per its frontmatter); volatile
    state lives in `docs/adr/ADR-0094-log.md` + `test-results/CATALOG.md`.
    v2 leaves the audit-tracker-update question to whoever executes the
    pending PICKs.

## Ledger maintenance rule (going-forward discipline)

This audit ran from a cold start because no per-SHA running record
existed. Reconstructing 178 cherry-pick trailers + classifying 149
no-trailer commits across 3 forks consumed hours and would have to
happen again on every sync wave at current velocity.

**Rule (enforced via `CLAUDE.md` + `feedback-update-integration-ledger`
memory):** every upstream integration action — cherry-pick, hand-port,
SKIP, retarget, superseded-by-local, superseded-by-adr — appends a row
to `docs/upstream/INTEGRATION-LEDGER.md` in the same commit/PR as the
integration. Captured at integration time the entry costs seconds;
reconstructed later it costs hours. The rule binds equally during
batched sync runs (ADR-0186 / future v3) and one-off picks.

Mechanical guardrails:

* Always cherry-pick with `git cherry-pick -x <SHA>` so the trailer
  `(cherry picked from commit <SHA>)` lands in the fork commit body.
  The audit tooling (`git log main --grep="cherry picked from commit"`)
  reads these. Trailer-less cherry-picks are the failure mode that
  forced ADR-0186's full re-audit.
* The ledger row references the authorizing ADR in the `ADR` column.
  For one-off picks outside a sync wave, cite the most recent
  upstream-program ADR (currently ADR-0186).
* Disposition vocabulary lives in the ledger's header; do not invent
  new dispositions — extend the header instead and reference the new
  term in this ADR.

## More information

* **Integration ledger**: `docs/upstream/INTEGRATION-LEDGER.md` is the
  single cumulative record of per-SHA dispositions across all forks.
  Batches A and B were appended on 2026-05-18; subsequent batches must
  append their hand-port / skip / pending decisions there as part of
  close-out (in addition to maintaining the per-batch table here).
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
