# Session handover — 2026-06-04: ADR-0290 shipped · upstream learning audit (4 correction waves) · ADR-0292 review program · C1 executed → ADR-0293

Branch: `worktree-reactive-yawning-garden` (worktree of ruflo-patch). All session work is committed
here; **not merged to main** (see Open Items #1).

## 1. ADR-0290 Phase 1 — SHIPPED and verified

* **Fork commits (on `main`, pushed via the day's releases):** cli `6123c14cd`
  (`--task`/`--session` + CLI-side metadata-only boundary + handler taskType/skip_embedding +
  generator capture spawn), agentdb `ae38e2e` (`skipEmbedding` plumbing → SQLite-only insert).
  Published in **cli 3.7.0-alpha.10-patch.415 / agentdb 3.0.0-alpha.14-patch.427** (carried out by the
  parallel session's release cycles; commits verified as ancestors).
* **Verified both ways:** pre-fix release (patch.408) → smoke exit 1, 5 FAILs (gate bites); post-fix
  published packages → **17/17 PASS** ending in `action-values.json` row
  `(taskType=authentication, action=<agent>, samples=1, meanReward=0.6)`.
* **Live hook deployed** to this repo's `.claude/helpers/hook-handler.mjs` (commit `ad18d74`):
  outcome-derived feedback + detached metadata-only capture spawn
  (`RUFLO_DISABLE_TASK_CAPTURE=1` / `RUFLO_TASK_CAPTURE_CMD=<bin>` escape hatches).
* **Test loop:** `scripts/smoke-adr0290-learning-loop.mjs` (standalone or shared-temp);
  acceptance check `adr0290-learning-loop` wired into `test-acceptance.sh` (run_check_bg +
  collect_parallel) + `test-acceptance-fast.sh adr0290` + `.github/workflows/v3-ci-learning-capture.yml`.
* **Key design facts** (memory `project-adr0290-learning-capture-shipped`): CLI is the metadata-only
  boundary (derive task_type from description ONLY — tier-2 agentType hijack would degenerate
  E[reward|action,task_type]); episode task = type slug (taskWellFormed + causal grouping);
  `skip_embedding` for content-free episodes; payload truth: PostToolUse fires with
  `tool_name:"Agent"`, success from `tool_response.status`.

## 2. Upstream learning audit — four correction waves → ADR-0291

User challenged "broken" findings three times; a fourth correction came from the C1 review. Final map
in **ADR-0291** (accepted): upstream HAS a working durable cross-session learning loop
(trajectory MCP tools → `.swarm/memory.db` trajectories w/ embeddings + `.swarm/sona-patterns.json`
reload/reinforce — proven `successCount 1→2`); the real gaps are **trigger** (nothing automatic
reaches the optimizer — plugin path persists counters only, full write-trace) and **consumption**
(routing never reads learned patterns). Episodes + scheduled learner don't exist upstream
(fork-only). **Validation bar** (ADR-0291 §Confirmation, binding for any "broken" verdict):
production shape · documented defaults · fs write-trace shim + SQLite dumps + tree diff ·
installed-dist code check · counters-vs-content. Audit env: `/tmp/ruflo-fresh` (upstream 3.10.36 via
documented installer + all 33 marketplace plugins; public npm registry required — local Verdaccio's
`@ruvector/*` shadow breaks upstream installs).

## 3. ADR-0292 — full feature review program (proposed)

All Ruflo features reviewed plugin-by-plugin (35 plugins, 8 keyword-derived categories), null
hypothesis **upstream works; fork divergence is the bug**; per-plugin protocol (enumerate → prove
upstream → mechanism → fork diff w/ FORK-REGRESSION as default class → patch-history audit →
disposition). Execution gated per category.

## 4. C1 (Learning & Intelligence) — REVIEWED → ADR-0293 (proposed)

Background-agent execution + first-hand spot-checks. Findings
(`docs/research/c1-learning-intelligence/01..04`):

* **Upstream: 0 broken** (intelligence 24/24, autopilot 10/10, ruvllm 10/10, ruvector CLI 6 + 2
  third-party/env limitations identical both sides).
* **ADR-0291 F1 RETRACTED** (commit `a6eaf2a`): fork trajectory tools are NOT disabled —
  `enabled:false` is `hooks_list` **display metadata** (verified: list-handler array; post-task rows
  carry the same flag). Fork trajectory path = PARITY. ADR-0287 §F10 citation footnoted accordingly.
* **Real fork regressions (ADR-0293 D1–D4, fixes gated on go-ahead):**
  D1 ruvllm WASM init skew — cli requires `wasm.initSync`, vendored
  `@sparkleideas/ruvector-ruvllm-wasm@2.0.2-patch.93` exports none → all 6 ruvllm tools dead
  (highest priority); D2 `hooks_transfer` fabricates `total:40 dataSource:"demo-data"` → unwind;
  D3 `neural_*` on hash-fallback (`_realEmbeddings:false`, `confidence:1@similarity:0`) → wire to the
  working mpnet path (re-check after D1); D4 `neural_compress` advertised no-op → honest capability
  boundary or re-port (ADR-0086 tie).
* **Fork-ahead keeps (D5–D8):** episode/action-value/causal cluster (upstream has no episode
  writer/scheduled learner — implement-ahead), neural_train enum enforcement, unified
  neural_patterns, ADR-0290 trigger. **9/10 fork ADR premises audited DEMONSTRATED** — the
  "fixes built on assumed brokenness" hypothesis did NOT hold for C1; the single assumed artifact was
  the F1 citation.
* Doc repairs queued in ADR-0293 (neural-train skill enum drift, hooks_list `enabled`→`autoFire`
  relabel option, intelligence-transfer IPFS doc drift, vector-setup note).

## 5. Open items (next session)

1. **Merge + release (the ADR-0290 green bar).** This branch must merge to ruflo-patch `main`, then
   release **from the main checkout** — worktree releases fail the `undiscriminating-catches` gate
   (allowlist keys are root-relative; memory `feedback-release-from-main-checkout-only`). Merge is
   blocked by the **parallel session's uncommitted** ADR-0287 acceptance edits in the main checkout
   (`test-acceptance*.sh`, `lib/acceptance-adr0287-checks.sh`, workflow — additive, disjoint from
   ours; auto-merges once committed). Then one release runs adr0287 + adr0290 checks together.
2. **ADR-0293 D1–D4 implementation** — awaiting explicit go-ahead. Start with D1 (wrapper update to
   the new wasm-bindgen shape, or re-pin); D3 re-verified after D1; every fix lands with its
   acceptance check + CI filter.
3. **ADR-0292 next categories** — C2 Memory & Data is next (highest fork-patch density). Reuse the C1
   pattern: background agent + the binding brief (envs, validation bar, production shapes,
   no-fork-edits, deliverables under `docs/research/c2-.../`).
4. **Environment cleanup (optional):** `/tmp/ruflo-fresh`, `/tmp/ruflo-fork-c1`, `/tmp/c1-evidence`
   are disposable; `claude plugin marketplace remove ruflo` + uninstall the 33 project-scoped plugins
   if the upstream marketplace registration (user settings) is unwanted; dev-workspace symlinks added
   under `forks/ruflo/v3/@claude-flow/{cli,memory}/node_modules/` (agentdb, @xenova/transformers,
   @ruvector/rvf-node) emulate the installed layout for probes — harmless, unversioned.
5. **ruflo-patch version bump note:** fork mains have moved (cli patch.415+/agentdb patch.427+ via
   the parallel session's iterations — check its outcome before assuming green).

## 6. Memory updates this session

`project-adr0290-learning-capture-shipped` (new) · `feedback-release-from-main-checkout-only` (new) ·
`project-upstream-learning-audit-2026-06-04` (new, 4 correction waves recorded incl. F1 retraction) ·
`project-mcp-daemon-runs-sqljs-fallback` (resolved-for-ruflo-patch note) · MEMORY.md index updated.

## 7. Commits on this branch (oldest→newest)

`ad18d74` live hook capture · `d932b17` smoke + acceptance/CI wiring + ADR-0290 record ·
`a1ed9ff` ADR-0290 both-ways verification · `5e588fe` ADR-0291 · `12e78c8` ADR-0292 ·
`a6eaf2a` C1 research + F1 retraction · (this commit) ADR-0293 + ADR-0287 footnote + ADR-0292 C1 link
+ this handover.
