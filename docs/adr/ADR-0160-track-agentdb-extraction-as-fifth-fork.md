---
status: proposed
date: 2026-05-08
methodology: [SPARC, MADR]
decision-makers: [Henrik Pettersen]
consulted: []
informed: []
tags: [agentdb, fork-tracking, codemod, mcp, ruvector-adapter, parallel-extraction]
related: [0078, 0094, 0147, 0148, 0150, 0154, 0157]
---

# ADR-0160: Track upstream agentdb extraction as a fifth fork — parallel-source response with vendored copy retained

## Context and Problem Statement

<!-- SPARC: S — Specification -->

Upstream `ruvnet/agentdb` was created as a standalone GitHub repo on 2025-10-18, but the load-bearing extraction work landed on **2026-05-06** (commits `e8a3a80` "feat: Claude Code marketplace + 6 plugins + npm SEO bump", `a74a6b6` "chore: clean up repo root", `43d1cc3` "docs: rewrite README in ruflo style"). The new repo publishes `agentdb@3.0.0-alpha.14` to public npm and ships six Claude Code plugins (`agentdb-{core,memory,search,graph,learning,causal}`). Two days later — today — the user surfaced the extraction and asked us to "fix our forks accordingly."

The naive interpretation ("upstream removed agentdb from agentic-flow") is **wrong**:

| Source | State | Verified by |
|---|---|---|
| `ruvnet/agentic-flow` HEAD `f31065c` (2026-05-02) | `packages/agentdb/` STILL VENDORED at v3.0.0-alpha.3; latest commit is `fix(agentdb): cache prepared statements to plug sql.js leak (#144)` | gh api repos/ruvnet/agentic-flow/commits |
| `ruvnet/agentdb` HEAD `a478ab3` (2026-05-06) | `agentdb@3.0.0-alpha.14` on npm; TypeScript-only; 6 plugins under `/plugins/agentdb-*/`; references `@ruvector/graph-transformer@^2.0.4` | gh api repos/ruvnet/agentdb/contents/package.json |
| public npm `agentdb` | `latest=3.0.0-alpha.14`, `next=3.0.0-alpha.7`, `alpha=3.0.0-alpha.11` | `npm view agentdb dist-tags` |
| our published `@sparkleideas/agentdb` | `3.0.0-alpha.10-patch.492` | `npm view @sparkleideas/agentdb version` |

So the extraction is **parallel**, not migratory: ruvnet maintains BOTH sources today, with ruvnet/agentdb 11 alpha versions ahead and accruing new surface (plugins, marketplace integration, README rewrite) that the vendored copy doesn't have. agentic-flow's vendored copy is maintenance-only (one bug-fix commit since 2026-04-01).

**Our forks are pinned to the vendored copy.** Concretely:

| Fork | Reference | Notes |
|---|---|---|
| `forks/agentic-flow/packages/agentdb/` | `name: "agentdb"`, version `3.0.0-alpha.10-patch.492` | full source vendored; sibling `packages/agentdb-onnx` |
| `forks/ruflo` root + `v2/` | `"agentdb": "3.0.0-alpha.10-patch.492"` (same version pin) + postinstall `scripts/fix-agentdb-imports.sh` | depends on the npm-published artifact, which is our patched copy of the vendored source |
| `forks/ruvector/crates/rvf/rvf-adapters/agentdb/` | 1,132 lines of Rust (`index_adapter.rs` 320, `vector_store.rs` 338, `pattern_store.rs` 456) | bridges agentdb HNSW lifecycle to RVF INDEX_SEG layers — Rust adapter against a TypeScript+sql.js peer |
| `forks/ruv-FANN` | skill `.md` references only (≤15 mentions) | no production dependency; doc surface only |

**Patch repo references** are equally entangled: codemod Pass 2 (`scripts/codemod.mjs:41`) maps `agentdb` → `@sparkleideas/agentdb`; `config/package-map.json:77` declares agentdb a member of `ruvnet/agentic-flow` upstream; 5 agent definitions hardcode `mcp__agentic-flow__agentdb_*` tool names; 12+ acceptance tests exercise the vendored shape; `.claude/helpers/auto-memory-hook.mjs` resolves `@sparkleideas/agentdb` via `createRequire()` for SessionStart/End wiring; `config/published-versions.json` pins a now-stale `@sparkleideas/agentdb@3.0.0-alpha.10-patch.52` (`.52` not `.492`).

The decision to make: **how do we incorporate the new upstream source into our fork tracking, given that (a) the vendored copy still exists and is also maintained, (b) ruvnet/agentdb is on a divergent path with a richer surface, (c) our codemod and MCP wiring assume "agentdb lives in agentic-flow," and (d) ruvector's Rust adapter assumes a specific HNSW peer that may have shifted in the new TypeScript-only repo?**

## Decision Drivers

- **Default to WIRE the new source.** Per `feedback-no-value-judgements-on-features`, "wire vs don't wire" decisions default to WIRE. ruvnet/agentdb has marketplace plugins, an MCP tool surface, and an active README/SEO push — refusing to track it because "agentic-flow's vendored copy is sufficient" is the exact value-judgement the rule prohibits.
- **Preserve the vendored copy for now.** Switching consumption from `forks/agentic-flow/packages/agentdb` to a fresh `forks/agentdb` mid-flight risks breaking ruflo's npm-published artifact (`@sparkleideas/agentdb`) and the 12 acceptance tests that exercise its current shape. ADR-0147's R6 fix is in our vendored copy and not yet upstreamed; throwing the vendored copy away now loses that fix.
- **Don't let the two sources drift silently.** If we track both, an upstream divergence in the alpha-stream MUST surface as a CI signal, not as a 6-month-later "wait, why did our memory backend stop working" debugging trip. Per `feedback-data-loss-zero-tolerance`, silent divergence is unacceptable.
- **Trunk-only, sparkling-only, no `hz`.** Per `reference-fork-workflow` + `feedback-trunk-only-fork-development` + `feedback-never-touch-hz-remote`, every new fork lives on `main`, pushes to `sparkling`, and has NO `hz` remote.
- **Preserve `mcp__agentic-flow__agentdb_*` tool names.** 5 agent definitions reference these. Renaming them now would be churn for no observable benefit until the upstream MCP server actually moves. Per CLAUDE.md "match existing style, even if you'd do it differently."
- **The Rust adapter at `forks/ruvector/crates/rvf/rvf-adapters/agentdb/` is load-bearing for RVF.** If it doesn't compile against the new repo's API (TypeScript-only, no Rust crate), we cannot consume the new repo as a runtime dependency without replacing or rewriting the adapter. The adapter's continued viability is a Phase 1 acceptance gate, not a Phase 0 assumption.
- **Codemod must NOT collide with the public npm `agentdb`.** Our Pass 2 unscoped-rename (`agentdb` → `@sparkleideas/agentdb`) was designed against a fork-only `agentdb` package. With public npm now publishing `agentdb@3.0.0-alpha.14`, an unfortunate `npm install agentdb` somewhere in our pipeline could pull the upstream package by accident if the rename doesn't fully cover. The rename must remain the primary defense; this ADR keeps it.

## Considered Options

<!-- SPARC: P — Pseudocode -->

### Option 1 — Do nothing; keep tracking only the vendored copy in agentic-flow

Ignore ruvnet/agentdb. Continue patching `forks/agentic-flow/packages/agentdb`. If upstream agentic-flow eventually deletes its vendored copy, deal with it then.

### Option 2 — Replace vendored with the new fork; consume from `forks/agentdb` exclusively

Add `forks/agentdb` mirroring ruvnet/agentdb. DELETE `forks/agentic-flow/packages/agentdb` and `packages/agentdb-onnx`. Switch `forks/ruflo`'s `agentdb` dep to point at `@sparkleideas/agentdb-extracted` (or rename the published artifact). Update codemod Pass 2 to source from the new fork. Update `config/package-map.json` to declare agentdb a member of `ruvnet/agentdb` upstream.

### Option 3 — Add `forks/agentdb` as a fifth fork; KEEP the vendored copy; document dual-tracking with a CI drift-detector (RECOMMENDED)

Mirror ruvnet/agentdb as `forks/agentdb` (sparkling-pushed, trunk-only, no hz). Treat it as an **observation-only fork for now** — no code consumes from it yet; the vendored copy in `forks/agentic-flow/packages/agentdb` remains the runtime source. Add a CI drift-detector that compares `forks/agentdb` HEAD's `src/` tree against `forks/agentic-flow/packages/agentdb/src/` and reports the diff. Update `config/package-map.json` to declare both upstream sources. Defer all consumption-switching to a follow-up ADR once the divergence stabilises and the ruvector Rust adapter's compatibility is verified.

### Option 4 — Add `forks/agentdb` and consume from it, keeping vendored as a deprecation-period fallback

Mirror ruvnet/agentdb as `forks/agentdb`. Switch ruflo's runtime dep to consume from the new fork's published artifact. Mark `forks/agentic-flow/packages/agentdb` as "frozen, deprecation period" — no new fixes go there. Plan a deletion ADR for the vendored copy after a stabilisation window.

### Option 5 — Filing an upstream issue asking ruvnet to declare which source is canonical

Open an issue at `ruvnet/agentdb` or `ruvnet/agentic-flow` asking which is the source of truth. Wait for clarification before mirroring or migrating.

## Decision Outcome

<!-- SPARC: A — Architecture -->

**Chosen option: Option 3** — add `forks/agentdb` as a fifth fork in observation mode; keep `forks/agentic-flow/packages/agentdb` as the runtime source for now; add a CI drift-detector; defer consumption-switching to a follow-up ADR gated on adapter compatibility verification.

### Why Option 3 over the others

- **vs Option 1 (do nothing).** Ignoring ruvnet/agentdb means we don't notice when upstream lands a fix or feature in the new repo that doesn't backport to the vendored copy. The marketplace + 6 plugins commit (`e8a3a80`, 2026-05-06) is exactly that shape — net-new surface that doesn't exist in the vendored copy. Per `feedback-don't-curate-features`, default-to-wire wins; passive-track loses.
- **vs Option 2 (replace vendored).** Would break our published `@sparkleideas/agentdb@3.0.0-alpha.10-patch.492` consumers (`forks/ruflo` and any external HM consumer that pinned it) at the same moment we'd be re-validating against a divergent source. Two large changes at once = unsustainable diagnosis surface when something fails. Rejected on change-batching grounds.
- **vs Option 4 (consume from new fork, keep vendored as fallback).** Same risk as Option 2, but spread over a "deprecation period" that we would then have to define, monitor, and eventually close — none of which the user has asked for. The Rust adapter compatibility question (does ruvector's `rvf-adapters/agentdb` still bind to the new TS-only repo?) is an unresolved Phase 0 hazard; pretending we can answer it during a deprecation period rather than as a gate is wishful.
- **vs Option 5 (file upstream issue).** Per `feedback-no-upstream-donate-backs`, we don't file issues on `ruvnet/*` for fork housekeeping. Even if we did, waiting for an answer is not a substitute for tracking the source of truth ourselves.

### What changes (and what doesn't)

**Changes (Phase 1):**
1. Create `forks/agentdb/` mirroring `ruvnet/agentdb` HEAD `a478ab3` on `main`. Remotes: `origin = ruvnet/agentdb`, `sparkling = sparkling/agentdb`, `upstream = ruvnet/agentdb`. NO `hz` remote.
2. Add `ruvnet/agentdb` as a tracked upstream in `config/package-map.json`. The published-name mapping (line 32) `agentdb` → `@sparkleideas/agentdb` continues to apply; the `upstreamRepos` block (line 77) gains `ruvnet/agentdb` alongside `ruvnet/agentic-flow`.
3. Add CI drift-detector at `scripts/agentdb-drift-detect.sh` that runs in the acceptance suite and compares `forks/agentdb/src/` against `forks/agentic-flow/packages/agentdb/src/` (or `agentic-flow/src/agentdb/` — whichever is the live in-tree path). Reports modified/added/deleted files as a build-info table; does NOT fail the pipeline (this is signal, not gate). Output stored to `.claude-flow/data/agentdb-drift-<TS>.json` for indexing.
4. Update `README.md` to declare 5 forks (currently lists 4 per `reference-fork-workflow`).
5. Update `reference-fork-workflow.md` memory to declare 5 forks.

**Explicitly NOT changed in this ADR:**
- `forks/agentic-flow/packages/agentdb/` — stays as the runtime source for `@sparkleideas/agentdb`.
- `forks/ruflo` `agentdb` dep version — stays at `3.0.0-alpha.10-patch.492`.
- ruvector Rust adapter — stays as-is; its compatibility against ruvnet/agentdb is a follow-up ADR's Phase 0.
- `mcp__agentic-flow__agentdb_*` tool names — preserved; 5 agent files not touched.
- Codemod Pass 2 — `agentdb` → `@sparkleideas/agentdb` mapping unchanged.
- `.claude/helpers/auto-memory-hook.mjs` — `loadMemoryPackage` resolves `@sparkleideas/agentdb` unchanged.
- 6 upstream agentdb plugins (`agentdb-core`, etc.) — NOT installed in the patch repo; their adoption is its own scope (potentially ADR-0162+).

<!-- SPARC: R — Refinement -->

### Consequences

- **Good** — the new upstream surface is *visible* to our pipeline as soon as it lands. Drift between the two sources surfaces in CI output, not in 6-month-later debugging.
- **Good** — keeping the vendored copy as runtime source preserves ADR-0147's R6 fix (which is fork-only) and avoids breaking `@sparkleideas/agentdb` consumers.
- **Good** — sets up a clean migration path: once the Rust adapter compatibility is verified and the divergence stabilises, a follow-up ADR (ADR-0161+) can switch consumption with full diagnostic context.
- **Bad** — we pay a small ongoing cost: pulling `forks/agentdb` periodically; running drift-detection in CI; reading the drift report when it's non-empty. Estimated ~1 minute of CI time per release; ~5 minutes of reviewer time per non-empty drift report.
- **Bad** — `forks/agentdb` will accumulate sparkling-side commits if we ever land local-only patches there (we shouldn't, but the option exists and someone may misuse it). Mitigation: the fork is observation-only by ADR; deviations require an explicit follow-up ADR.
- **Neutral** — npm collision risk (public `agentdb@3.0.0-alpha.14` vs our `@sparkleideas/agentdb@3.0.0-alpha.10-patch.492`) is unchanged; codemod Pass 2 already handles it.
- **Neutral** — the 6 upstream agentdb plugins are unaddressed; if a future ADR decides to wire them, this ADR's `forks/agentdb` mirror is the prerequisite.

<!-- SPARC: C — Completion -->

### Confirmation

This decision is implemented when ALL of the following are observable from CI / file state / pipeline output:

1. `forks/agentdb/.git/config` exists with three remotes: `origin = https://github.com/ruvnet/agentdb.git`, `upstream = https://github.com/ruvnet/agentdb.git`, `sparkling = git@github.com:sparkling/agentdb.git`. NO `hz` remote.
2. `forks/agentdb/` HEAD is on `main` and tracks `sparkling/main`. The clone matches ruvnet/agentdb HEAD `a478ab3` (or whatever HEAD is current at adoption time) by tree-sha.
3. `config/package-map.json` declares `ruvnet/agentdb` in `upstreamRepos` (added alongside the existing `ruvnet/agentic-flow`).
4. `scripts/agentdb-drift-detect.sh` exists, is executable, and produces `.claude-flow/data/agentdb-drift-<TS>.json` when run.
5. The acceptance suite invokes drift-detection and stores the latest report to `.claude-flow/data/agentdb-drift-latest.json`.
6. `README.md` declares 5 forks; `reference-fork-workflow.md` memory updated to match.
7. Regression test `tests/unit/adr0160-agentdb-fifth-fork.test.mjs` asserts: (a) `forks/agentdb` exists, (b) drift-detector script exists and is +x, (c) `config/package-map.json` lists both upstream repos, (d) `forks/agentic-flow/packages/agentdb` STILL exists (preserves runtime source — guards against accidental deletion).
8. Pipeline acceptance suite continues to pass at no regression vs current pass count.

## Pros and Cons of the Options

### Option 1 — Do nothing

- **Bad** — net-new ruvnet/agentdb surface (marketplace plugins, README, SEO push) doesn't reach us until upstream agentic-flow backports it (which may never happen).
- **Bad** — violates `feedback-no-value-judgements-on-features` (default-to-wire).
- **Good** — zero churn, zero CI cost, zero new fork to maintain.
- **Neutral** — preserves current state perfectly; if upstream agentic-flow eventually deletes its vendored copy, this option converts to a forced migration.

### Option 2 — Replace vendored

- **Bad** — Rust adapter compatibility is unverified; switching consumption could brick `forks/ruvector/crates/rvf/rvf-adapters/agentdb/`.
- **Bad** — loses ADR-0147 R6 fix (fork-only, in vendored copy).
- **Bad** — breaks `@sparkleideas/agentdb` consumers mid-divergence (high diagnostic surface).
- **Good** — single source of truth.
- **Good** — aligns with the apparent upstream direction.

### Option 3 — Fifth fork in observation mode (CHOSEN)

- **Good** — visible drift; default-to-wire honoured.
- **Good** — runtime stability preserved.
- **Good** — sets up clean migration via follow-up ADR.
- **Bad** — small ongoing CI + maintenance cost.
- **Bad** — `forks/agentdb` could be misused as a development target if discipline lapses (mitigated by ADR text + drift-detector failing loudly on local divergence).
- **Neutral** — defers the harder question (consumption switch) without resolving it.

### Option 4 — Consume from new fork with vendored fallback

- **Bad** — forces the Rust adapter compatibility question NOW with no diagnostic time.
- **Bad** — "deprecation period" is undefined and would require its own ADR to close.
- **Good** — eventually arrives at the desired end state (consumption from new repo).
- **Neutral** — adds operational complexity (two sources running in parallel) for the duration of the deprecation period.

### Option 5 — File upstream issue

- **Bad** — violates `feedback-no-upstream-donate-backs`.
- **Bad** — wait time is unbounded; doesn't unblock fork-side work.
- **Good** — would in principle yield authoritative clarity if answered.

## More Information

### Out of scope (deferred to follow-up ADRs)

1. **Adapter compatibility verification (ADR-0161 candidate).** Does `forks/ruvector/crates/rvf/rvf-adapters/agentdb/` compile and bind correctly against `ruvnet/agentdb` HEAD's TypeScript surface? The new repo is TS-only; the adapter targets a Rust+TypeScript shape that may have moved. This is a Phase 0 of any future "switch consumption to new fork" ADR.
2. **Consumption switch (ADR-0162 candidate).** Once #1 is verified, switch `forks/ruflo`'s `agentdb` dep to consume from the new fork's published artifact. Update `@sparkleideas/agentdb` build pipeline to track the new source. Decommission `forks/agentic-flow/packages/agentdb`.
3. **6 upstream plugin adoption (ADR-0163 candidate).** Adopt `agentdb-core`, `agentdb-memory`, `agentdb-search`, `agentdb-graph`, `agentdb-learning`, `agentdb-causal` plugins from ruvnet/agentdb. Reconcile with our existing `ruflo-agentdb` plugin (per `reference-hive-mind-skills-and-commands.md`-style namespace overlap concerns).
4. **MCP tool prefix migration (ADR-0164 candidate).** If/when upstream moves agentdb's MCP server out of the agentic-flow MCP namespace into its own (`mcp__agentdb__*` instead of `mcp__agentic-flow__agentdb_*`), update agent definitions, codemod Pass 4, and the manifest at `config/mcp-surface-manifest.json`. ADR-0148's audit pattern applies.
5. **`agentdb-onnx` sibling package handling.** ruvnet/agentdb does NOT obviously have an `agentdb-onnx` analog (no `/packages/agentdb-onnx/` in the new repo as of `a478ab3`). What happens to `forks/agentic-flow/packages/agentdb-onnx` when we eventually migrate? Tracked here as awareness; resolved in ADR-0162.

### Implementation order

1. **Lock the spec** — this ADR (ADR-0160), Status: Proposed → Accepted on review.
2. **Clone the fork** — `git clone https://github.com/ruvnet/agentdb.git forks/agentdb` (no `hz` remote setup; `sparkling` remote added pointing at `git@github.com:sparkling/agentdb.git` once the sparkling repo is created via existing fork-creation pattern).
3. **Update `config/package-map.json`** to add `ruvnet/agentdb` to `upstreamRepos`.
4. **Implement drift-detector** at `scripts/agentdb-drift-detect.sh`. Output JSON shape: `{ ts, ruvnet_agentdb_head, agentic_flow_packages_agentdb_head, modified: [], added: [], deleted: [] }`. Append-only log + a "latest" symlink/copy.
5. **Wire into acceptance suite** — drift-detector runs after build but before publish; output stored; non-empty diff is reported but does NOT fail the run.
6. **Write regression test** `tests/unit/adr0160-agentdb-fifth-fork.test.mjs`.
7. **Update README + memory** — declare 5 forks.
8. **First drift report** — observe and store. If the diff is small and well-understood, archive it as "baseline at adoption". If large, file a follow-up to investigate before any consumption decision.

### References

- Upstream new repo: https://github.com/ruvnet/agentdb (HEAD `a478ab3`, 2026-05-06)
- Upstream agentic-flow: https://github.com/ruvnet/agentic-flow (HEAD `f31065c`, 2026-05-02; vendored copy at `packages/agentdb` v3.0.0-alpha.3)
- Public npm — plain `agentdb`: `latest=3.0.0-alpha.14`, 11 alpha versions ahead of vendored
- Our published — `@sparkleideas/agentdb`: `3.0.0-alpha.10-patch.492`
- Fork audit (this ADR's research): `forks/agentic-flow/packages/agentdb` (242 .ts hits, 713 doc mentions); `forks/ruflo` (101 .ts hits, postinstall `fix-agentdb-imports.sh`); `forks/ruvector/crates/rvf/rvf-adapters/agentdb/` (1,132 lines Rust); `forks/ruv-FANN` (15 doc mentions, no production code)
- Patch-repo audit: codemod Pass 2 (`scripts/codemod.mjs:41`); `config/package-map.json:77`; 5 agent definitions reference `mcp__agentic-flow__agentdb_*`; 12+ acceptance tests; `.claude/helpers/auto-memory-hook.mjs:148-261`
- ADR-0078: Bridge-elimination — eliminated `getBridge()` in agentdb-tools.ts
- ADR-0094: Acceptance coverage program (parent of agentdb fix waves)
- ADR-0147: Cross-process AgentDB read fixes (R6 fork-only, R7 deferred)
- ADR-0148: MCP tool surface audit
- ADR-0150: NAPI build pipeline multi-package generalisation (sibling pattern; agentdb's NAPI status TBD by ADR-0161)
- ADR-0154: RVF storage unification (single-file)
- ADR-0157: MADR + SPARC ADR template (this ADR's format authority)
- Memory: `feedback-no-value-judgements-on-features` (default-to-wire); `reference-fork-workflow` (4 → 5 forks); `feedback-trunk-only-fork-development`; `feedback-never-touch-hz-remote`; `feedback-no-upstream-donate-backs`; `feedback-data-loss-zero-tolerance`
