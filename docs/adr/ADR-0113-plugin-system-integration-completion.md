# ADR-0113: Plugin system integration completion (post-ADR-0111 W4)

- **Status**: Proposed (2026-05-01)
- **Date**: 2026-05-01
- **Deciders**: Henrik Pettersen
- **Methodology**: 14-agent specialized audit swarm (`swarm-1777663583250-1fqsl3`, hierarchical-mesh, read-only) following the public marketplace pitch that surfaced the question "is the plugin system actually integrated?"
- **Depends on**: ADR-0111 (upstream merge program, W4 step 4 merged 92 commits into `forks/ruflo` at `f6fcb76c6`)
- **Closes**: integration gaps surfaced post-W4 acceptance gate

## Context

ADR-0111's W4 merged upstream's 92-commit window into `forks/ruflo` `main`. That window included substantial plugin-system additions: `81418649c` (19-plugin marketplace), `f3cc99d8b` (CRIT-02 plugin sandboxing), `1976c57cc`+5 (federation plugin), `8b8127d75`+5 (IoT Cognitum), `26f3230da` (12 missing plugin registrations), `1405eab66` (10 slash-command renames + Opus 4.7 default), `643ed0024` (RuFlo branding rebrand), `7ed18b833`+`a47c96fad` (npm-wrapped plugins).

ADR-0111's risk register (R10) flagged the namespace-gate codemod question, ADR-0111 §"Plugin support: 3-layer state" cataloged the 3-layer architecture, and ADR-0111 §"Marketplace identity decision" recommended Option B (parallel `sparkling/ruflo-marketplace`). The merge committed without executing those recommendations — they were tracked as follow-ups.

Post-W4 acceptance was 146/147 GREEN against `@sparkleideas/cli@3.5.58-patch.317`. Following the public marketing narrative ("install marketplace, install core plugins, use Claude Code normally"), a 14-agent audit swarm verified end-to-end whether the published distribution actually delivers that experience. The verdict is **no, not yet** — multiple integration steps that the ADR-0111 plan deferred or missed remain open. This ADR catalogs them and decides the fixes.

## Audit findings (14-agent swarm, 2026-05-01)

### Critical (would-break-users)

1. **Plugin sandbox CRIT-02 was not merged.** Upstream commit `f3cc99d8b` (vm isolation + 8-permission capability gating + `PluginPermissions` interface + namespace-based trust gate) is not on `forks/ruflo` `main` after the W4 merge. `v3/@claude-flow/shared/src/plugin-sandbox.ts` does not exist. `plugin-interface.ts` has no `PluginPermissions` field. `plugin-loader.ts` calls `plugin.initialize(context)` directly with full host context (line 324). Community plugins execute in-process with full Node access. Zero defense in depth.

2. **Codemod skips `.md` files.** `scripts/codemod.mjs:58` `ALLOWED_EXTENSIONS = {.js, .ts, .mjs, .cjs, .json, .d.ts, .d.mts}` excludes markdown. **325 `@claude-flow/*` references in plugin + .claude-plugin docs ship verbatim** (corrected 2026-05-01 from initial 482 estimate; verified via `grep -rln "@claude-flow/" forks/ruflo/plugins/ forks/ruflo/.claude-plugin/ | grep '\.md$' | xargs grep -c "@claude-flow/" | awk -F: '{s+=$2} END {print s}'`). Users following copy-paste install instructions invoke the upstream public-npm CLI, bypassing the local `@sparkleideas/cli` distribution and the patch repo's pinned-deps guarantee.

3. **MCP tool prefix mismatch.** Server registers as `name: 'ruflo'` (`mcp-server.ts:367,471`) → Claude Code namespaces tools as `mcp__ruflo__*`. But **524 plugin docs reference `mcp__claude-flow__*`** (corrected 2026-05-01 from initial 121 estimate; verified via `grep -rn "mcp__claude-flow__" forks/ruflo/plugins/ | wc -l` — gap is 4.3× larger than the audit reported). Internal CLI is also schizophrenic: `hive-mind.ts` uses `mcp__ruflo__*` (32 refs), `settings-generator.ts:32` + `claudemd-generator.ts:114-139` use `mcp__claude-flow__*`. Plugin instructions to invoke MCP tools fail because the server doesn't expose those tool names.

4. **Federation plugin (`@sparkleideas/plugin-agent-federation`) not published to Verdaccio.** Source merged into `forks/ruflo`, version-bumped locally to `1.0.0-alpha.3-patch.5`, but never reaches the registry. `scripts/copy-source.sh:146-154` enumerates 9 packages explicitly; `plugin-agent-federation` is not in the list. `ruflo-federation` bin entry unreachable from init'd projects. ADR-078 spec exists in fork (`v3/implementation/adrs/`) but not mirrored in `ruflo-patch/docs/adr/`. Zero acceptance test coverage.

5. **IoT Cognitum plugin (`@sparkleideas/plugin-iot-cognitum`) not published.** Same pattern as federation: source merged, version-bumped to `1.0.0-alpha.5-patch.5`, missing from `copy-source.sh` allowlist, no codemod registration, no version-bump entry, no acceptance check. `cognitum-iot` bin unreachable. ADR-079 spec inside fork but not in patch repo.

6. **All 3 npm-wrapped plugins break in our distribution.** `ruflo-rag-memory`, `ruflo-ruvector`, `ruflo-neural-trader` shell out via `npx <pkg>` from public npm in `.md` agent prompts. `neural-trader` is not in codemod's `UNSCOPED_MAP`. No `@sparkleideas/neural-trader` published. Even `@sparkleideas/ruvector` (which IS in `UNSCOPED_MAP`) is bypassed because the wrappers are in `.md` files (gap #2).

7. **Marketplace identity points at upstream.** `.claude-plugin/marketplace.json` has `name: "ruflo"`, `owner: { name: "ruvnet" }`, plugin entries with relative `source: ./plugins/<name>` (no scope-rename). User typing `/plugin marketplace add ruvnet/ruflo` resolves to upstream's manifest, hardcoded to `@claude-flow/cli`. Distribution incoherent for sparkling.

### High (would-confuse-users)

8. **`c1eb37d53` issue-#1604 memory-path fix regressed by W4 take-ours.** `memory-tools.ts:19` reverted to `MEMORY_DIR = '.claude-flow/memory'`. Lost the `.swarm/memory.db` alignment that c1eb37d53 introduced.

9. **11+ stale `@claude-flow/cli@latest` invocations in init templates.** `claudemd-generator.ts:270` + `executor.ts` (560, 1492, 1576, 1579, 1582, 1666, 1669, 1672–1781). Init writes user-facing docs telling users to run `npx -y @claude-flow/cli@latest swarm/agent/memory/doctor/security`. Codemod rewrites scope to `@sparkleideas/cli@latest`, NOT to upstream's new `ruflo@latest` convention. Mixed branding.

10. **Plugin slash-command renames present but READMEs reference stale.** All 10 `1405eab66` renames (`/browser` → `/ruflo-browser`, `/memory` → `/ruflo-memory`, etc.) exist in `plugins/*/commands/`. But `plugins/ruflo-browser/README.md:21` and `plugins/ruflo-loop-workers/README.md:14` still backtick the old slash names. Users get wrong instructions.

11. **`hooks.ts:4137` still hardcodes `'Opus 4.6 (1M context)'`.** All other Opus 4.7 default sites correct (settings-generator + statusline-generator). Single stale reference.

### Low (cosmetic)

12. **Top-level `package.json` `name` is still `"claude-flow"`** (proxy package). Bin self-id labels in `cli.js:38` + `mcp-server.js:26` log `[claude-flow-mcp]` — cosmetic but confusing in user logs.

### Architectural

13. **Pipeline package allowlists are hardcoded and don't auto-discover.** This is the meta-pattern behind findings 4, 5, and the earlier `ruvector-learning-wasm` smoke-test bug. Corrected inventory (post-hive 2026-05-01 — Code Analyzer + Researcher):
    - `scripts/publish.mjs:25-74` — **the actual source of truth.** `tests/pipeline/publish-order.test.mjs:15` imports `LEVELS` from here, NOT from `publish-levels.json`. The audit missed this entirely.
    - `config/publish-levels.json` — duplicate of the above; appears to be decorative documentation, not the runtime list. Reconcile or delete.
    - `scripts/codemod.mjs:34-54` `UNSCOPED_MAP` (16 entries)
    - `tests/pipeline/publish-order.test.mjs:27-103` `KNOWN_DEPS` (58 packages, must mirror `LEVELS`)
    - `scripts/copy-source.sh:145-154` — **NOT a package allowlist** (audit was wrong on this). Lines 145-154 are a stale-dist clearer that flags `.ts → dist/` recompile detection. The actual cross-repo package selection is governed by `rsync` filters earlier in the script.
    - `scripts/run-fork-version.sh` — **does not enumerate** (audit was wrong). Delegates to `fork-version.mjs` which walks the fork tree dynamically. Already auto-discovery; serves as the proof-of-concept for Fix 3.
    Net: **5 real lists** (not 4-5), with `scripts/publish.mjs` being the highest-leverage one. Every new fork package requires updating 4 of them. The W4 merge added 2 plugin packages (federation, iot-cognitum) and missed all 4 — because the lists are not auto-derived from the fork tree.

## Decision

Six independent fixes, prioritized by user impact:

### Fix 1 — Backport `f3cc99d8b` plugin sandbox

Cherry-pick `f3cc99d8b` from upstream onto `forks/ruflo` `main`. Verify:
- `v3/@claude-flow/shared/src/plugin-sandbox.ts` exists (vm isolation)
- `plugin-interface.ts` declares `PluginPermissions` with all 8 permissions
- `plugin-loader.ts` routes through sandbox before `plugin.initialize(context)`
- Trust-level routing checks `@claude-flow/` namespace prefix → "official" trust (codemod will rewrite to `@sparkleideas/` per existing `SCOPED_RE`)

After backport, run W4 letter G's deferred acceptance test (per ADR-0111 R10): publish a fixture plugin with `name: '@sparkleideas/test-plugin'`, `trustLevel: 'official'`, assert capability-access verification.

### Fix 2 — Extend codemod to process `.md` files

Add `.md` to `scripts/codemod.mjs:58` `ALLOWED_EXTENSIONS`. Verify by re-running pipeline and grepping `/tmp/ruflo-build/plugins/**/*.md` for `@claude-flow/`. Expected: zero matches post-codemod.

Add a `mcp__claude-flow__` → `mcp__ruflo__` rewrite rule (literal-substring replacement) in the same pass, with narrow regex `mcp__claude-flow__[a-z]` to avoid false hits on log tags like `claude-flow-mcp`.

Add a test in `tests/pipeline/codemod.test.mjs` covering: markdown extension processing, `mcp__claude-flow__*` → `mcp__ruflo__*` rewrite, and `@claude-flow/cli` → `@sparkleideas/cli` in install-command shape.

### Fix 3 — Auto-discover pipeline package allowlists

Replace the hardcoded enumerations with auto-discovery from the fork tree.

**Path correction (post-hive 2026-05-01):** Forks live at `/Users/henrik/source/forks/{ruflo,agentic-flow,ruv-FANN,ruvector}/`, NOT inside `ruflo-patch/`. Auto-discovery code MUST consume `lib/fork-paths.sh` `FORK_DIRS[@]` rather than hardcoding `forks/<fork>/...` paths.

**Filtering "is this published?":** signal is `package.json` `"name"` starting with `@claude-flow/` OR being in `UNSCOPED_MAP` keys. **Must explicitly exclude:**
- `forks/ruflo/v2/examples/*/package.json` (24 sample-app dirs with names like `"calc-app"`)
- Any path containing `node_modules/`, `__tests__/`, `test/fixtures/`, or `*/scratch/`
- Any `package.json` with `"private": true`
- Depth cap: max 5 levels from fork root (per Devil's Advocate gap-catch — prevents experimental WIP directories from silently shipping to npm)

Replace these enumerations:

- **`scripts/publish.mjs:25-74` `LEVELS`** (highest priority — actual source of truth): keep manual topological ordering (dependency graph requires it), but add a preflight test that fails loud if a discovered package is missing from `LEVELS`. Generalizes the pre-W4 `ruvector-learning-wasm` smoke fix.
- `scripts/codemod.mjs:34-54` `UNSCOPED_MAP`: derive from the discovered set. New packages auto-mapped.
- `tests/pipeline/publish-order.test.mjs:27-103` `KNOWN_DEPS`: derive from build-tree walk; bump the count constants at lines 188-193.
- `config/publish-levels.json`: reconcile with `scripts/publish.mjs` `LEVELS` — make one canonical, the other a generated artifact, OR delete the JSON if decorative.
- `scripts/copy-source.sh:145-154`: this is a stale-dist clearer, not a package allowlist; auto-discover the package list it sweeps from the same walked set.

**Dry-run gate (promoted from §Negative consequences to §Done):** `npm run preflight -- --discover-dry-run` must list discovered packages for review before publish. Without this, auto-discovery silently picks up unintended packages on the next fork-tree change.

### Fix 4 — Marketplace identity (Option B per ADR-0111)

**Use the existing public `sparkling/ruflo` fork repo** as the marketplace source — no new repo needed. Tree-hash comparison verified `plugins/` (`7551e0185e404d4ccbe492d6a5ed55bcc71a2bb1`) and `.claude-plugin/` (`bfdf393c8fe02a983619c72c636244beeea594b7`) are byte-identical between our fork's `main` and upstream `origin/main`, so structural substitution is clean — only content rewrites are needed.

Steps:
1. **Apply codemod to `.md` files in fork source** (depends on Fix 2). Run codemod on `forks/ruflo/plugins/**/*.md` and `forks/ruflo/.claude-plugin/**/*.md`. Result: `npx -y @claude-flow/cli@latest …` → `npx -y @sparkleideas/cli@latest …` (or `ruflo@latest` per Fix 6.1 convention); `mcp__claude-flow__*` → `mcp__ruflo__*`.
2. **Update `.claude-plugin/marketplace.json` `owner.name`** field from `"ruvnet"` to `"sparkling"` (distribution identity). `name: "ruflo"` stays — that's the Claude Code marketplace identifier, not the repo identity.
3. **Commit + push to `sparkling` remote** (`git@github.com:sparkling/ruflo.git`). The existing fork becomes the marketplace source.
4. **Document in README** the install path: `/plugin marketplace add sparkling/ruflo` instead of `ruvnet/ruflo`. The shorthand resolves to `https://github.com/sparkling/ruflo.git` (our fork's HTTPS URL).

This avoids creating + maintaining a separate `sparkling/ruflo-marketplace` repo as ADR-0111 recommended (Option B). Per `feedback-trunk-only-fork-development`, our fork's `main` IS the canonical sparkling-side source — using it directly as the marketplace is consistent with that posture.

**Caveat:** any time we apply codemod to fork `.md` files, the fork tree diverges from upstream's tree (lose the byte-identical match). That's acceptable — fork divergence in `.md` files is the intended outcome of the rebrand. Future upstream merges will re-introduce `@claude-flow/cli@latest` markdown refs that codemod must re-apply; the codemod test (Fix 2 addition) locks this contract.

### Fix 5 — Federation + IoT plugin pipeline wiring

**Site corrections (post-hive 2026-05-01):** the audit's enumeration was partially wrong. Updated targets:

Add `plugin-agent-federation` and `plugin-iot-cognitum` to:
- `scripts/publish.mjs:25-74` `LEVELS` Level 4 (the runtime source of truth — was missed by audit)
- `config/publish-levels.json` Level 4 (only if reconciled per Fix 3; otherwise skip — decorative)
- `tests/pipeline/publish-order.test.mjs:27-103` `KNOWN_DEPS` AND bump `LEVELS.flat().length` count assertion at line 197 + per-level counts at lines 188-193
- `scripts/codemod.mjs:34-54` `UNSCOPED_MAP` (if either plugin needs scope rewriting)
- ~~`scripts/copy-source.sh:146-154`~~ — **NOT applicable**, those lines are a stale-dist clearer, not a package allowlist
- ~~`scripts/run-fork-version.sh`~~ — **NOT applicable**, already auto-discovery via `fork-version.mjs`
- The actual `rsync` filters in `scripts/copy-source.sh` (cross-repo selection) — verify federation + iot are not filtered out

Add acceptance checks `check_ruflo_federation_bin` + `check_cognitum_iot_bin` to verify the new bin entries resolve from an init'd project. **Both checks must do TWO levels** (per Tester gap-catch): (1) `command -v ruflo-federation` resolves from `$E2E_DIR`, AND (2) `ruflo-federation --version` (or equivalent) actually executes — invoke via direct `timeout` (NOT `_run_and_kill`, per memory `feedback-run-and-kill-exit-code`). PATH resolution alone is insufficient: a stub bin pointing at missing JS resolves but crashes.

Mirror ADR-078 + ADR-079 specs from `forks/ruflo/v3/implementation/adrs/` into `ruflo-patch/docs/adr/` per ADR-0111 §"Decision plan step 7" cross-reference policy.

### Fix 6 — Targeted regression fixes

- **6.1** `claudemd-generator.ts:270` + `executor.ts` 11 sites: rewrite `@claude-flow/cli@latest` → **`@sparkleideas/cli@latest`** (revised 2026-05-01 from initial `ruflo@latest` plan). The audit assumed `ruflo@latest` matched an upstream rebrand convention, but Researcher verified: `ruflo` is published only on public npm by upstream (`ruvnet`), not in our Verdaccio distribution; `forks/ruflo/bin/` contains only `cli.js` (no standalone `ruflo` bin). Direct rewrite to `@sparkleideas/cli@latest` keeps init'd projects inside our distribution. (Alternative: publish `@sparkleideas/cli` with `ruflo` bin alias to Verdaccio — separate decision; not blocking this ADR.)
- **6.2** ~~`memory-tools.ts:19`: restore `c1eb37d53` #1604 fix~~ — **ALREADY LANDED** (verified 2026-05-01 by Researcher). Commit `cf6595a2c` ("Restore c1eb37d53 #1604 memory-path fix lost by ADR-0111 W4 take-ours") is on HEAD. The audit's `memory-tools.ts:19` line/symbol pin was also stale: that line in `v3/@claude-flow/cli/src/mcp-tools/memory-tools.ts` shows `MAX_QUERY_LENGTH = 4096`, not `MEMORY_DIR`. **Strike from §Done.**
- **6.3** `hooks.ts:4137`: bump `'Opus 4.6 (1M context)'` → `'Opus 4.7 (1M context)'`.
- **6.4** Plugin READMEs `ruflo-browser/README.md:21`, `ruflo-loop-workers/README.md:14`: update slash-command refs to renamed names.
- **6.5** Top-level `package.json` `name`: `"claude-flow"` → `"ruflo"` (matches the wrapper bin). Bin self-id labels in `cli.js:38` + `mcp-server.js:26`: `[claude-flow-mcp]` → `[ruflo-mcp]`.

## Consequences

### Positive

- Distribution coherence: a user installing `@sparkleideas/cli` and following any plugin's install instructions stays inside the sparkling distribution, gets pinned `-patch.N` versions, doesn't fall through to public-npm upstream.
- Plugin sandbox provides defense-in-depth **for trusted-but-buggy plugins** — guardrail against drive-by misuse (accidental `process.exit(1)`, `globalThis` mutation, `require.cache` hot-patching). **NOT a security boundary against malicious code** (Node's `vm` module is documented to not be a V8 security boundary; well-known escapes via `this.constructor.constructor('return process')()` and prototype-chain walks). Reframe per Security Architect — this distinction must be in user-facing documentation so `trustLevel: 'community'` is not assumed safe to run unattended.
- Federation + IoT plugins reach users (currently the merge claims them as features but they're invisible).
- Pipeline allowlists self-update on fork tree changes — no recurrence of the `ruvector-learning-wasm` / federation / IoT pattern.
- Branding consistency reduces user confusion ("which CLI am I supposed to install?").

### Negative

- Codemod processing `.md` files increases pipeline scope; `.md` files are not currently version-controlled for codemod test coverage like `.ts/.json` are. Adds test surface.
- Auto-discovering allowlists couples the pipeline to fork tree shape — if a fork experiments with package layouts, the pipeline could pick up unintended packages. Mitigation: a dry-run mode that lists discovered packages for review before publish.
- Codemod's `.md` scope expansion means future upstream merges re-introduce `@claude-flow/cli@latest` markdown refs that codemod must re-apply on every cycle; the codemod test (Fix 2 addition) locks this contract. Trade-off: lose byte-identical fork-tree match against upstream `plugins/` + `.claude-plugin/`, but that's an intentional rebrand divergence. No new repo created — uses existing public `sparkling/ruflo` fork (reverses ADR-0111's Option B "5th repo" recommendation; the simpler approach is acceptable since the fork is already public).
- Backporting `f3cc99d8b` may surface conflicts against W4 take-ours decisions on `plugin-interface.ts` and `plugin-loader.ts`. Hand-merge required.

### Neutral

- The plugin system remains additive on top of `init` (does not replace it). User flow stays: `npm install -g @sparkleideas/cli` → `ruflo init` → `/plugin marketplace add sparkling/ruflo-marketplace` → `/plugin install ruflo-core@ruflo`. The marketing pitch is incomplete (omits the init step) but the architecture is sound.

## Status note: plugin system vs init command

The audit raised the question whether the plugin system replaces `init`. **It does not.** The two systems own different concerns:

| Layer | Concern | Owner |
|---|---|---|
| Workspace bootstrap (`config.json`, `embeddings.json`, `.mcp.json`, `settings.json`, `CLAUDE.md`, statusline, hooks, agents/skills/commands directories) | First-time write | `ruflo init` |
| Capability extension (Claude Code native plugins: agents, slash commands, skills) | Additive, idempotent | Plugin marketplace |
| Sandboxed execution of community plugin code | Isolation per ADR R10 | Plugin sandbox (Fix 1) |
| Cross-process state, RVF storage, ControllerRegistry, daemon | Always-on infrastructure | runtime daemon (`ruflo daemon`) |

Plugins ENRICH a workspace; init BOOTSTRAPS one. A plugin's `install` hook *could* technically write the runtime configs, but that would conflate additive (plugins) with first-time-write (init), break uninstall idempotency, and require every plugin to know the full workspace template. Current architecture is correct.

The marketing narrative ("install marketplace, install core plugins, use Claude Code normally") elides the bootstrap step. After this ADR ships, README + plugin READMEs should explicitly state: **`ruflo init` first, then `/plugin marketplace add sparkling/ruflo-marketplace`.**

## Implementation order

Mechanical dependencies between fixes:

1. **Fix 6** (targeted regressions) — independent, low risk, can land first
2. **Fix 2** (codemod `.md`) — unblocks fixes 4, 5, 6.1
3. **Fix 5** (federation + IoT pipeline wiring) — depends on Fix 3 path-list update OR explicit add
4. **Fix 3** (auto-discover allowlists) — refactor; subsumes manual additions in Fix 5
5. **Fix 4** (marketplace identity Option B) — depends on Fix 2 (.md codemod) AND Fix 3 (so the marketplace push uses the auto-derived list, not a manual one we'll re-edit next merge)
6. **Fix 1** (plugin sandbox backport) — independent; cherry-pick + hand-merge against W4 take-ours of `plugin-interface.ts`

**Recommended landing sequence (revised post-hive 2026-05-01): 6 → 2 → 5 → 3 → 4 → 1.**

Two changes from the original 6→2→5→1→4→3:
- **Fix 3 before Fix 4** (Queen): once Fix 4 pushes the marketplace to public `sparkling/ruflo`, every subsequent fork-tree change needs the allowlists right. Landing Fix 3 first means the marketplace push uses auto-derived lists; Fix 5's manual additions become Fix 3's first regression test.
- **Fix 1 last, not fourth** (Queen): Fix 1 is the highest-conflict, lowest-blocker work. Putting it after distribution coherence (2, 5, 3, 4) means if the hand-merge stalls, the user-facing pitch already works. Sandbox is correctness; coherence is shippability.

### Execution phases by risk shape

The 6 fixes split into 4 phases by reversibility and autonomy boundary, not by technical dependency:

**Phase A — now-safe batch (Fix 6 + Fix 2 + Fix 5).** ~15 files across fork + patch repo. Every change is `git revert`-reversible; nothing leaves Verdaccio or the local fork remotes (`sparkling/*`). Fix 6 = 5 small text edits in fork source (12 install-cmd substitutions, one Opus version line, two README slash-name fixes, top-level `package.json` `name` + 2 bin self-id labels). Fix 2 = one-line `ALLOWED_EXTENSIONS` addition + one regex rewrite in `scripts/codemod.mjs` + 5 test cases in `tests/pipeline/codemod.test.mjs`. Fix 5 = `scripts/publish.mjs` LEVELS Level 4 add + `KNOWN_DEPS`/count constants + 2 acceptance checks. Test gate: `npm run test:unit && npm run test:acceptance` per CLAUDE.md pyramid. Single commit-train. No confirmation needed — proceed when starting.

**Phase B — focused refactor (Fix 3).** Replaces 4 hardcoded lists with `FORK_DIRS[@]`-driven derivation. Internal ordering: dry-run gate (`npm run preflight -- --discover-dry-run`) lands FIRST so the discovered set is reviewable, THEN the actual derivation flips. Patch repo only. Reversible but spans pipeline scripts — wants its own attention, not bundled with Phase A.

**Phase C — explicit go-ahead required (Fix 4).** Pushes codemod-rewritten content + `marketplace.json` `owner.name: "sparkling"` to public `sparkling/ruflo`. Pre-push, all changes are local + reversible. Push itself is visible; force-revert works but leaves a trace. **Do not execute autonomously.** Confirm before push that: (a) Phase A + B are green, (b) README install-path text is verified, (c) the SHA being pushed is the intended one.

**Phase D — focused conflict-resolution (Fix 1).** Cherry-pick `f3cc99d8b` onto `forks/ruflo` `main`; hand-merge against W4 take-ours of `plugin-interface.ts` + `plugin-loader.ts`; new `plugin-sandbox.ts` clean-add; fixture plugin + acceptance test. Wants undivided attention — worst time to bundle is when distraction causes a take-ours/take-theirs mistake. Stage as a `-patch.N` with NO other changes so rollback is one revert.

**Test gates per phase:** every phase runs full `npm run test:acceptance` before commit-train completes, per CLAUDE.md `feedback-all-test-levels`. No fix in any phase is "done" until its corresponding §Done acceptance signal lands green.

## Cross-cutting prerequisites

- **Distribution model is Verdaccio-only, no public-npm publishing or proxy fallthrough.** All `@sparkleideas/*` packages are published exclusively to local Verdaccio (`http://localhost:4873`) per memory `reference-pipeline-publish-paths`. Verdaccio is the only registry users (= Henrik) install from. Implication for Fix 1's namespace-prefix trust gate (`@sparkleideas/*` → "official"): only Henrik can publish to Verdaccio, so the namespace prefix is effectively pinned to publisher identity in the closed-world distribution. The Security Architect's "public-npm scope-squatting" concern is moot here. (Public-npm scope status is `sparklingideas <henrik@sparklingideas.co.uk>` per 2026-05-01 check, but it's not load-bearing for this distribution's threat model.)
- **Registry-of-truth for "official" trust** — Fix 1's namespace-prefix gate is sufficient under the closed-world Verdaccio model. Manifest hash pin to `.claude-plugin/marketplace.json` is overkill given single-publisher publish path; revisit only if the distribution model changes.

## Implementation plan

Concrete step-by-step execution mapped to the four phases. Each step lists the touch site, the operation, and the gate before moving on. §Done has the per-fix acceptance signals; this plan has the order-of-operations.

### Phase A — autonomous batch (Fix 6 + Fix 2 + Fix 5)

**A1. Fix 6 in `forks/ruflo` (trunk-only, no Co-Authored-By).** Sequential text edits then build:

1. `executor.ts` + `claudemd-generator.ts` — 12 sites: `@claude-flow/cli@latest` → `@sparkleideas/cli@latest`
2. `hooks.ts:4137` — `'Opus 4.6 (1M context)'` → `'Opus 4.7 (1M context)'`
3. `plugins/ruflo-browser/README.md:21` + `plugins/ruflo-loop-workers/README.md:14` — slash-command renames per `1405eab66`
4. Top-level `package.json` `name` → `"ruflo"`; `cli.js:38` + `mcp-server.js:26` log tags → `[ruflo-mcp]`
5. `cd forks/ruflo && npm run build` — must succeed
6. Commit on `forks/ruflo` `main`, push to `sparkling` remote (NOT `origin`)

**A2. Fix 2 in patch repo (this repo).** 

7. `scripts/codemod.mjs:58` — add `'.md'` to `ALLOWED_EXTENSIONS`
8. `scripts/codemod.mjs` — add `mcp__claude-flow__([a-zA-Z0-9_]+)` → `mcp__ruflo__$1` rewrite rule (positioned after the scope rewrite, before file-write)
9. `tests/pipeline/codemod.test.mjs` — add 5 cases (positive: install-cmd + MCP prefix + code-fence; negative: log-tag survives + `node_modules` skipped)
10. `npm run test:unit` — must pass

**A3. Fix 5 in patch repo.**

11. `scripts/publish.mjs:25-74` — add `@sparkleideas/plugin-agent-federation` + `@sparkleideas/plugin-iot-cognitum` to LEVELS Level 4
12. `tests/pipeline/publish-order.test.mjs` — extend `KNOWN_DEPS` with both packages; bump `LEVELS.flat().length` constant + per-level counts at lines 188-193, 197
13. `scripts/codemod.mjs` `UNSCOPED_MAP` — add entries if either plugin needs scope rewriting
14. `lib/acceptance-adr0113-plugin-checks.sh` (NEW) — implement `check_adr0113_ruflo_federation_bin` + `check_adr0113_cognitum_iot_bin` (both `command -v` AND direct `timeout` invocation, NOT `_run_and_kill`)
15. `scripts/test-acceptance.sh` — source the new check file; wire checks into the parallel wave using `$(_cli_cmd)` per `reference-cli-cmd-helper`
16. Mirror upstream ADR-078 + ADR-079 from `forks/ruflo/v3/implementation/adrs/` into `docs/adr/` (cross-reference policy)
17. `npm run test:unit && npm run test:acceptance` — must pass green

**A4. Phase A commit boundary.**

18. Single commit on patch repo (Fix 2 + Fix 5 + new acceptance checks)
19. Verify Verdaccio publishes federation + iot via `npm run deploy` if running full pipeline; otherwise `npm view @sparkleideas/plugin-agent-federation@latest --registry=http://localhost:4873`

### Phase B — focused refactor (Fix 3)

20. Implement `--discover-dry-run` flag in preflight (location TBD — `scripts/preflight.sh` or new `scripts/preflight-discover.mjs`); walks `FORK_DIRS[@]` for `package.json` matching name-prefix `@claude-flow/` OR in `UNSCOPED_MAP`; applies exclusions (`private:true`, `node_modules/`, `__tests__/`, `scratch/`); depth cap 5
21. `tests/pipeline/preflight-package-coverage.test.mjs` (NEW) — walks fork tree, asserts discovered set ⊆ `scripts/publish.mjs` LEVELS ⊆ `KNOWN_DEPS` ⊆ `UNSCOPED_MAP`
22. Add fixture: drop synthetic `package.json` into a fixture fork tree, run preflight, assert non-zero exit
23. Run dry-run, review output, confirm discovered set matches expectations
24. Flip `scripts/codemod.mjs` `UNSCOPED_MAP` and `tests/pipeline/publish-order.test.mjs` `KNOWN_DEPS` to derive from the walked set
25. Reconcile `config/publish-levels.json` with `scripts/publish.mjs` LEVELS — make one canonical, the other generated, OR delete the JSON if confirmed decorative
26. `npm run test:unit && npm run test:acceptance` — must pass green
27. Commit on patch repo

### Phase C — explicit go-ahead before public push (Fix 4)

28. Verify Phase A + B green via full cascade
29. Run codemod over `forks/ruflo/plugins/**/*.md` + `forks/ruflo/.claude-plugin/**/*.md` (now operates because Fix 2 added `.md` to allowed extensions); assert `grep -r "@claude-flow/" forks/ruflo/plugins forks/ruflo/.claude-plugin` returns 0
30. Edit `forks/ruflo/.claude-plugin/marketplace.json` `owner.name`: `"ruvnet"` → `"sparkling"`. Keep `name: "ruflo"` (marketplace identifier, not repo identity)
31. `tests/pipeline/marketplace-manifest.test.mjs` (NEW) — assert `owner.name === "sparkling"`, `name === "ruflo"`, scoped paths intact
32. `lib/acceptance-adr0113-plugin-checks.sh` add `check_adr0113_marketplace_owner_sparkling` (cheap manifest grep, every run) + network-gated check (`RUFLO_MARKETPLACE_NETWORK_TESTS=1`)
33. Update README install path: `/plugin marketplace add ruvnet/ruflo` → `/plugin marketplace add sparkling/ruflo`. Add prerequisite note: "`ruflo init` first, then `/plugin marketplace add sparkling/ruflo`" per §Status note
34. `npm run test:unit && npm run test:acceptance` — must pass green
35. **PAUSE — explicit user confirm required before push.** Verify: SHA being pushed, README text, manifest content, `git ls-remote sparkling main` current state
36. `git -C forks/ruflo push sparkling main` (per `reference-fork-workflow.md`)
37. Verify post-push: `git ls-remote sparkling main` SHA matches local; from a fresh init'd project, `/plugin marketplace add sparkling/ruflo` resolves

### Phase D — focused conflict-resolution (Fix 1)

38. `cd forks/ruflo && git cherry-pick f3cc99d8b` — expect conflicts on `plugin-interface.ts` + `plugin-loader.ts` (per W4 take-ours)
39. Hand-merge: preserve W4 take-ours decisions where they don't conflict with sandbox API; adopt upstream sandbox-related additions (`PluginPermissions` interface, `plugin-sandbox.ts` clean add, `initialize` routing through sandbox)
40. Update namespace gate from `@claude-flow/` → `@sparkleideas/` (or rely on Fix 2 codemod to do this if the gate ships in `.ts` source)
41. Verify: `find forks/ruflo -name plugin-sandbox.ts` returns ≥1; `grep -c "PluginPermissions" plugin-interface.ts` ≥ 1; `plugin-loader.ts` routes through sandbox before `initialize(context)`
42. `cd forks/ruflo && npm run build` — must succeed
43. `tests/fixtures/plugin-escape-attempt/index.js` (NEW) — fixture attempting `require('child_process').exec`, `process.exit(1)`, prototype-chain escape (`this.constructor.constructor('return process')()`)
44. `lib/acceptance-adr0113-plugin-checks.sh` add `check_adr0113_w4g_plugin_sandbox_capability_deny` — load fixture, assert all escape attempts denied with `PermissionDenied` BEFORE `initialize()` runs; trust-routing assertion (fixture with `@sparkleideas/test-plugin` → official; `community/foo` → restricted)
45. `npm run test:unit && npm run test:acceptance` — must pass green
46. Stage as a `-patch.N` with NO other changes (rollback constraint: one revert undoes the entire sandbox change)
47. Commit on `forks/ruflo` `main`, push to `sparkling`
48. Verify rollback path: dry-run `git revert <sha>` reverses cleanly without re-conflicting

### Inter-phase gates

- After **A**: full cascade green, federation + iot resolvable from init'd project, codemod tests cover `.md`
- After **B**: dry-run output reviewed and accepted; preflight test fails on synthetic missing-package fixture
- After **C**: marketplace manifest is correct on `sparkling/ruflo` HEAD; install path verified end-to-end from a fresh init'd project
- After **D**: sandbox fixture denies all escapes; trust routing matches `@sparkleideas/` prefix; `-patch.N` rolls back cleanly

### What this plan does NOT include

- Migration plan if the distribution model changes (closed-world Verdaccio → public-npm publish): out of scope; revisit Cross-cutting prerequisites if that happens
- Plugin uninstall idempotency tests (Devil's Advocate gap-catch): tracked as separate follow-up, not blocking ADR-0113
- ADR-0111 R10 follow-up beyond what's covered by Fix 1 (W4 letter G acceptance test): if R10 has additional artifacts, file separately

## §Done

§Done items revised post-hive 2026-05-01: each item now names a measurable acceptance signal (test function, grep target, or registry assertion). Items 6.4 and 6.5 tightened from "updated" to specific grep targets per Production Validator review.

- [ ] **Fix 1**: `f3cc99d8b` cherry-picked onto `forks/ruflo` `main`. Acceptance: (a) `find forks/ruflo -name plugin-sandbox.ts` returns ≥1 match; (b) `grep -c "PluginPermissions" forks/ruflo/v3/@claude-flow/shared/src/plugin-interface.ts` ≥ 1; (c) new check `check_adr0113_w4g_plugin_sandbox_capability_deny` in `lib/acceptance-adr0113-plugin-checks.sh` runs a fixture plugin (`tests/fixtures/plugin-escape-attempt/`) attempting `require('child_process').exec`, `process.exit(1)`, and prototype-chain escape; ALL must fail with `PermissionDenied` BEFORE `initialize()` runs. (d) Trust-routing assertion: fixture with `name: '@sparkleideas/test-plugin'` resolves `trustLevel: 'official'`; `community/foo` does not.
- [ ] **Fix 2**: `.md` in `scripts/codemod.mjs:58` `ALLOWED_EXTENSIONS`; `mcp__claude-flow__[a-zA-Z0-9_]` → `mcp__ruflo__$1` rewrite (broader than initial `[a-z]` per Code Analyzer). Acceptance: 5 cases in `tests/pipeline/codemod.test.mjs`: (1) `npx -y @claude-flow/cli@latest swarm` → `npx -y @sparkleideas/cli@latest swarm`; (2) `mcp__claude-flow__memory_store` → `mcp__ruflo__memory_store`; (3) **negative**: `[claude-flow-mcp]` log tag survives unchanged; (4) **negative**: `node_modules/**/*.md` not touched; (5) code-fence content rewrites identical to prose. Plus acceptance: `grep -r "@claude-flow/" /tmp/ruflo-build/plugins/**/*.md | wc -l` == 0.
- [x] **Fix 3** (landed 2026-05-02 Phase B): pipeline allowlists auto-derived from `FORK_DIRS[@]`. Acceptance signals:
  - (a) `tests/pipeline/preflight-package-coverage.test.mjs` walks fork tree (private:true skip + path-fragment exclusions + depth cap 5) and asserts discovered set ⊆ `scripts/publish.mjs` LEVELS ∪ WONT_PUBLISH ∪ WONT_PUBLISH_PATTERNS. ✓
  - (b) Synthetic-fixture sub-suite drops `@claude-flow/synthetic-new-package-from-test` into a temp tree, runs the discover+coverage check via child node, asserts exit 1 with GAP: report; inverse clean-fixture asserts exit 0. ✓
  - (c) `npm run discover-packages` (new npm alias) → `node scripts/preflight.mjs --discover-dry-run` lists discovered packages with in-LEVELS / MISSING / WONT_PUBLISH / not-in-fork sections. ✓
  - Bonus: deleted drifted `FALLBACK_LEVELS` from `scripts/publish.mjs` (subsumes step 25); `config/publish-levels.json` is now the single canonical source, fail-loud on read/schema error per `feedback-no-fallbacks`.
- [x] **Fix 4** (landed 2026-05-02 Phase C; pushed to public `sparkling/ruflo`): `marketplace.json` `owner.name` rewritten from `"ruvnet"` to `"sparkling"`; codemod-rewritten content on fork `main` (commit `b24e46829`) pushed to `git@github.com:sparkling/ruflo.git`. `git ls-remote sparkling main` returns `b24e46829a53332965bcd5df0ee28f1ff5cfe761` (= local main). Acceptance signals:
  - (a) `tests/pipeline/marketplace-manifest.test.mjs` (NEW, 7 tests) asserts `owner.name === "sparkling"`, `name === "ruflo"`, scoped paths `./plugins/<name>` intact, manifest contains zero `@claude-flow/`; plus 3 contract tests scanning `forks/ruflo/{plugins,.claude-plugin}/**/*.md` for residual `@claude-flow/` or `mcp__claude-flow__` refs. ✓
  - (b) `check_adr0113_marketplace_owner_sparkling` (NEW, every-run) greps fork manifest via `node`-driven JSON parse. ✓
  - (c) `check_adr0113_marketplace_remote_sparkling` (NEW, gated by `RUFLO_MARKETPLACE_NETWORK_TESTS=1`) does `git ls-remote sparkling main` and asserts SHA matches local fork HEAD on `main`. Default behavior: SKIP (since CI doesn't have SSH credentials for the public sparkling org). Pre-push, this check correctly reports `local b24e46829 ≠ sparkling fe6b9211`; post-push it must flip to PASS. ✓ (verified standalone)
  - (d) README updated with `/plugin marketplace add sparkling/ruflo` install path; prerequisite "ruflo init first" note per §Status note. ✓
  - Codemod regex hardened: `mcp__claude-flow__([a-zA-Z0-9_]+|\*)` now also matches the literal-asterisk glob form ("`mcp__claude-flow__*`") used in plugin docs (Phase C surfaced one such occurrence the original regex missed).
  - **Push status:** PUSHED 2026-05-02 to `git@github.com:sparkling/ruflo.git` after explicit user confirmation. Post-push network check (`RUFLO_MARKETPLACE_NETWORK_TESTS=1`): PASS, `sparkling/ruflo main = local main = b24e4682`.
- [ ] **Fix 5**: federation + iot plugins reach Verdaccio with `-patch.N` pin. Acceptance: (a) `npm view @sparkleideas/plugin-agent-federation@latest version --registry=http://localhost:4873` returns a version; same for `plugin-iot-cognitum`; (b) `check_adr0113_ruflo_federation_bin` does both `command -v ruflo-federation` AND `ruflo-federation --version` (via direct `timeout`, not `_run_and_kill`); same pattern for `check_adr0113_cognitum_iot_bin`; (c) ADR-078/079 mirrored into `ruflo-patch/docs/adr/`.
- [ ] **Fix 6.1** (revised target): `executor.ts` + `claudemd-generator.ts` `@claude-flow/cli@latest` → `@sparkleideas/cli@latest` (12 sites). Acceptance: `grep -rn "@claude-flow/cli@latest" forks/ruflo/v3/@claude-flow/cli/src/` returns 0 matches; `grep -rn "@sparkleideas/cli@latest" <same>` returns 12. Plus acceptance check `check_adr0113_executor_uses_sparkleideas_cli`.
- [x] ~~**Fix 6.2**~~: ALREADY LANDED in `cf6595a2c` (verified 2026-05-01). Strike from active checklist.
- [ ] **Fix 6.3**: `hooks.ts:4137` `'Opus 4.6 (1M context)'` → `'Opus 4.7 (1M context)'`. Acceptance: `grep -c "Opus 4.6" forks/ruflo/v3/@claude-flow/cli/src/hooks.ts` == 0; `check_adr0113_no_opus_46_strings` greps `node_modules/@sparkleideas/**/dist/**` from init'd project.
- [ ] **Fix 6.4**: Plugin READMEs `ruflo-browser/README.md:21`, `ruflo-loop-workers/README.md:14` updated. Acceptance: `grep -E '/(browser|memory)\b' forks/ruflo/plugins/ruflo-browser/README.md` returns 0 matches; `grep -E '/ruflo-(browser|memory)\b' <same>` returns ≥1.
- [ ] **Fix 6.5**: Top-level `package.json` `name: "ruflo"`. Bin self-id labels rewritten. Acceptance: (a) `jq -r .name package.json` == `"ruflo"`; (b) `grep -c "claude-flow-mcp" forks/ruflo/cli.js forks/ruflo/mcp-server.js` == 0; (c) `check_adr0113_proxy_bin_selfid_ruflo_mcp` runs the published `ruflo-mcp` bin in subprocess, captures stderr, asserts log tag is `[ruflo-mcp]`.

## Revision history

- **2026-05-01 (initial draft)** — proposed by 14-agent audit swarm.
- **2026-05-01 (post-hive revision)** — 8-agent hive (queen + devil's advocate + security architect + system architect + tester + code analyzer + researcher + production validator) reviewed the draft. Updates applied:
  - Finding 2 count corrected (482 → 325)
  - Finding 3 count corrected (121 → 524)
  - Finding 13 hardcoded-list inventory corrected: added `scripts/publish.mjs:25-74` (the actual source of truth — was missed); removed `scripts/run-fork-version.sh` (already auto-discovery); reclassified `scripts/copy-source.sh:145-154` as stale-dist clearer not allowlist
  - Fix 3 paths corrected: forks live at `/Users/henrik/source/forks/`, NOT in `ruflo-patch/`; consume `lib/fork-paths.sh` `FORK_DIRS[@]`. Added explicit exclusion filters and depth cap (Devil's Advocate gap-catch). Promoted dry-run gate from Negative Consequences to §Done.
  - Fix 5 sites corrected per Code Analyzer: target is `scripts/publish.mjs` LEVELS, not `copy-source.sh:146-154`.
  - Fix 6.1 target changed from `ruflo@latest` to `@sparkleideas/cli@latest`: `ruflo` is upstream-only, not in our Verdaccio distribution; `forks/ruflo/bin/` has no standalone `ruflo` bin.
  - Fix 6.2 STRUCK: already landed in `cf6595a2c` per Researcher verification.
  - Sandbox §Consequences reframed (Security Architect): vm sandbox is defense-in-depth for trusted-but-buggy plugins, NOT a security boundary against malicious code.
  - Implementation order changed from `6→2→5→1→4→3` to `6→2→5→3→4→1` (Queen): Fix 3 before Fix 4 so marketplace push uses auto-derived list; Fix 1 last because coherence is shippability.
  - §Done checklist tightened: each item now names a measurable acceptance signal (test function, grep target, or registry assertion).
  - Cross-cutting prerequisites section added then revised: the distribution model is Verdaccio-only with no public-npm publishing or proxy fallthrough, so the public-npm scope-squatting concern is moot. Namespace-prefix trust gate is sufficient under single-publisher Verdaccio.
  - §Implementation order extended with execution-phase decomposition by risk shape: Phase A (Fix 6+2+5, autonomous), Phase B (Fix 3, focused refactor), Phase C (Fix 4, explicit go-ahead before public push), Phase D (Fix 1, focused conflict-resolution). Replaces earlier soft "too risky to bundle" framing with explicit autonomy boundaries.
  - §Implementation plan added: 48 numbered steps mapped to the four phases. Each step lists the touch site + operation + gate. Inter-phase gates documented; out-of-scope follow-ups (distribution-model migration, uninstall idempotency, R10 follow-ups) explicitly excluded.

## Implementation Log

### 2026-05-01 — Phase A landed (Fix 6 + Fix 2 + Fix 5)

Phase A executed per the autonomous-batch §Implementation order. Touch summary:

**A1 — Fix 6 in `forks/ruflo` (`main`, push to `sparkling`):**
- Fix 6.1 (revised count): `@claude-flow/cli@latest` → `@sparkleideas/cli@latest`
  across **33 sites in 7 files** in `v3/@claude-flow/cli/src/` (audit's
  "12 sites" was incomplete — verified by grep, fixed all). Files:
  `init/executor.ts` (19), `commands/init.ts` (8), `init/claudemd-generator.ts`
  (1), `init/settings-generator.ts` (1), `commands/doctor.ts` (1),
  `commands/start.ts` (1), `commands/swarm.ts` (2).
- Fix 6.2: STRUCK (already landed in `cf6595a2c` per ADR pre-revision).
- Fix 6.3: `commands/hooks.ts:4137` `'Opus 4.6 (1M context)'` →
  `'Opus 4.7 (1M context)'`.
- Fix 6.4 (corrected scope): only `plugins/ruflo-browser/README.md:21`
  (`/browser` → `/ruflo-browser`). Audit's `ruflo-loop-workers/README.md:14`
  reference is to the Claude Code built-in `/loop` skill, NOT a renamed
  plugin command — left intact (verified against rename commit
  `1405eab66`'s ninefold list).
- Fix 6.5: **DEFERRED.** Audit's acceptance targets (`cli.js:38`,
  `mcp-server.js:26`) don't exist at fork root. Top-level
  `package.json` `name: "claude-flow"` → `"ruflo"` was specified but
  cascades to `config/publish-levels.json` Level 5 + `KNOWN_DEPS` +
  `UNSCOPED_MAP` — beyond the audit's listed touch sites. Filed as
  follow-up; "cosmetic" priority per audit Finding 12.
- Pre-existing fork build (top-level `tsc`) is broken on missing
  `@types/node` — pipeline builds per-package via `build-packages.sh`,
  unaffected.

**A2 — Fix 2 codemod `.md` + MCP rewrite (`ruflo-patch`):**
- `scripts/codemod.mjs`: added `.md` to `ALLOWED_EXTENSIONS`, added Pass 4
  rewriting `mcp__claude-flow__([a-zA-Z0-9_]+)` → `mcp__ruflo__$1`.
  Pattern's flanking `__` separators don't false-hit `[claude-flow-mcp]`
  log tags or `@claude-flow/cli` scope refs.
- `tests/pipeline/codemod.test.mjs`: 5 new ADR-0113 cases (markdown
  install command, MCP prefix rewrite, log-tag negative, node_modules
  negative, code-fence-vs-prose parity). All 27 codemod tests pass.

**A3 — Fix 5 federation + IoT pipeline wiring (`ruflo-patch`):**
- `config/publish-levels.json`: Level 4 +`@sparkleideas/plugin-agent-federation`,
  +`@sparkleideas/plugin-iot-cognitum`.
- `scripts/publish.mjs`: same in `FALLBACK_LEVELS`.
- `tests/pipeline/publish-order.test.mjs`: `KNOWN_DEPS` +2 entries (both
  with empty internal deps); `LEVELS[3].length: 22 → 24`, total
  `58 → 60`. All 53 publish-order tests pass.
- `scripts/build-packages.sh`: added `plugin-agent-federation` +
  `plugin-iot-cognitum` to BOTH `_v3_packages` (bash filter) AND `v3set`
  (JS filter). These plugins live under `v3/@claude-flow/plugin-*/` (not
  the conventional `v3/plugins/*/` location used by other plugins) per
  the upstream-merge layout.
- `lib/acceptance-adr0113-plugin-checks.sh` (NEW): 6 checks —
  `check_adr0113_federation_resolves`, `check_adr0113_iot_resolves`,
  `check_adr0113_ruflo_federation_bin`, `check_adr0113_cognitum_iot_bin`
  (both bin checks use direct `_timeout` per
  `feedback-run-and-kill-exit-code`),
  `check_adr0113_executor_uses_sparkleideas_cli` (Fix 6.1 acceptance —
  greps installed `@sparkleideas/cli/dist`),
  `check_adr0113_no_opus_46_strings` (Fix 6.3 acceptance — same).
- `lib/acceptance-checks.sh`: source new check file.
- `scripts/test-acceptance.sh`: harness installs federation + iot
  alongside other pre-installed packages; `run_check_bg` for 6 ADR-0113
  checks; `collect_parallel` wait-list updated.
- `docs/adr/ADR-078-agent-llm-federation-plugin.md`,
  `docs/adr/ADR-079-iot-cognitum-plugin.md` (NEW): mirrored from
  `forks/ruflo/v3/implementation/adrs/`. 3-digit naming preserves source
  filename and avoids collision with the patch repo's existing 4-digit
  `ADR-0078-bridge-elimination-agentdb-tools.md` and
  `ADR-0079-acceptance-test-completeness.md`.

**A4 — Test gates:**
- `npm run test:pipeline`: 139/139 pass.
- Targeted: `node --test tests/pipeline/codemod.test.mjs
  tests/pipeline/publish-order.test.mjs`: 53/53 pass.
- `npm run test:unit` (full): pre-existing test-runner default
  `TEST_TIMEOUT=300000` (5 min) was shorter than the suite's actual
  runtime; bumped to 1800000 (30 min). See subsequent log entry for the
  underlying perf fixes that cut wall-clock to ~65s.
- `npm run test:acceptance`: deferred to post-publish (chicken-and-egg
  — federation + iot must be in Verdaccio before harness install).
  Phase A4's last step (per §Implementation order step 19) verifies
  Verdaccio publish.

### 2026-05-02 — Test wall-clock + unskip program

User-flagged regression after Phase A: `npm run test:unit` was hitting
the test-runner timeout. Investigation found three pre-existing tests
(in `tests/unit/adr0086-rvf-*.test.mjs`) doing real `npm install` of
`@sparkleideas/memory@latest` — three parallel installs serialized on
the npm cache lock and stretched wall-clock from ~65s to 25-30 min.
Two passes of fixes:

**Pass 1 — perf (commit `3b1f61a`):**
- `tests/unit/adr0086-rvf-integration.test.mjs`: tarball pre-flight
  replaces `npm install` for the marker check. `npm view @latest
  dist.tarball` → `curl` 200-300KB tarball → `tar -xzO
  package/dist/rvf-backend.js`. ~22ms vs 22-30s — 1000×.
- `tests/unit/adr0086-rvf-load-invariant.test.mjs`: invariant 2 reuses
  `/tmp/ruflo-unit-rvf-install/` shared install populated by
  `installFromVerdaccio()` (idempotent). Falls back to fresh scratch
  install only if cache is empty.
- `tests/unit/adr0086-rvf-real-integration.test.mjs:703`: documented
  why `Promise.race`/`setTimeout` work-arounds for the flock deadlock
  cannot work — flock syscall isn't cancelable, so even after `t.skip()`
  the file's Node process stays alive on pending I/O until SIGTERM.
- `scripts/test-runner.mjs`: TEST_TIMEOUT default 300000 → 1200000
  (initially), then 1800000 (30 min); concurrency default 8 → 12.

**Pass 2 — unskip (commit `3f74b37`):**
User mandated removing the `SKIP_T3_2_BOOTSTRAP=1` env-var skip
altogether and fixing the underlying issues. Each test exercised
standalone (per "only execute the test under test, never run
everything"):

- `adr0086-rvf-integration.test.mjs` "subprocess N=6": removed env-var
  gate AND the obsolete Pass 2 marker check. The marker check was
  testing for the **d1 design's** source-text ordering (`acquireLock`
  before `reapStaleTmpFiles` in `initialize()`), which has been
  REPLACED by ADR-0095's swarm-2 amendment (items d12+d13+d14, fork
  commit `76f0b76`) — the new design intentionally inverts that
  ordering (`reapStaleTmpFiles` first, no JS lock; `acquireLock` only
  around `loadFromDisk`). Pass 1 markers (`reapStaleTmpFiles` +
  `_tmpCounter`) are present in the published dist, so the test runs
  end-to-end. **PASS in 38s** against current Verdaccio.
- `adr0086-rvf-integration.test.mjs` "in-process N=6": removed env-var
  gate. Marker check on fork dist already passes. **PASS in 197ms**.
- `adr0086-rvf-real-integration.test.mjs:703` "replayWal": removed
  env-var gate. Added `await backend.shutdown()` to the preceding
  "store without shutdown" test (line 671) — the durability assertion
  fires BEFORE shutdown so the test contract ("data is durable
  immediately after `store()` returns") is preserved; the shutdown is
  test-framework hygiene to release the BSD-style flock on
  `<dbPath>.lock` so the next test's second backend can acquire. Per
  ADR-0090 Tier B7, WAL is compacted into `.meta` synchronously inside
  `store()`, so on-disk state is identical with-or-without shutdown.
  **Group 5 PASS in 30ms (both tests)**.
- `tests/unit/skip-reverify.test.mjs` "createSidecar — cleanup trap":
  the slow path was `npm i @sparkleideas/cli@latest` taking 31s in
  isolation — over the 30s `spawnSync` budget — failing under cache
  contention with parallel adr0086-rvf installs. `scripts/skip-reverify.mjs`
  `createSidecar()` now uses `--prefer-offline --no-package-lock --cache
  /tmp/ruflo-skip-reverify-npm-cache` flags. Cold install 27s / warm
  19s, both under budget. Per-call cache eliminates lock contention.
  Latest-version-resolution contract is covered separately by
  acceptance smoke checks (`check_latest_resolves`,
  `check_no_broken_versions`) which use `npm view @latest` directly
  without cache shortcuts. **PASS in 24.8s**.
- `package.json`: reverted `SKIP_T3_2_BOOTSTRAP=1` default in
  `test:unit` (added in 3b1f61a as a workaround; removed per user).
- `scripts/test-runner.mjs`: stripped stale `SKIP_T3_2_BOOTSTRAP`
  references from the TIMEOUT_MS comment.

**Misdiagnosis correction.** The 3b1f61a commit message (and an earlier
status update) claimed "the ADR-0095 Pass 2 fix hasn't been republished
to Verdaccio". This was wrong — the swarm-2 amendment (d12+d13+d14)
landed in fork commit `76f0b76` AND has been published. The
misdiagnosis came from trusting the test's own skip diagnostic
("lacks ADR-0095 Pass 2 marker (d1: acquireLock before
reapStaleTmpFiles in initialize). Republish after Pass 2 fork commit:
npm run publish:verdaccio.") at face value. The marker was checking
for d1's source-text ordering, but d1 was REPLACED by swarm-2 which
inverts that ordering — the marker became obsolete the moment swarm-2
shipped. ADR-0095 §Status line and the 2026-05-01 swarm-2 amendment
entry document the correct design state. Removed the obsolete marker
check; the test now correctly runs against the swarm-2 dist.

**Result:** all 4 previously-skipped tests now PASS standalone with no
SKIP env vars. Verified per the user mandate of "only execute the test
under test":
```
node --test --test-name-pattern="spawns 6 real cli memory store"      → PASS 38s
node --test --test-name-pattern="6 RvfBackend instances on same path" → PASS 197ms
node --test --test-name-pattern="Group 5"                             → PASS 30ms (both)
node --test --test-name-pattern="creates a tmp dir under"             → PASS 24.8s
```

### 2026-05-02 — Phase B landed (Fix 3)

Phase B executed per §Implementation order, with one combined step
adjustment. Touch summary:

**B1 — Preflight discovery walker (`scripts/preflight-discover.mjs`).**
NEW module exposes `discover()`, `uniqueMappedNames()`,
`expectedPublishedSet()`, `isWontPublish()`, `mapName()`. Walks every
fork in `config/upstream-branches.json` (depth cap 5), filters by
SKIP_PATH_FRAGMENTS (`/node_modules/`, `/__tests__/`,
`/test/fixtures/`, `/scratch/`, `/.git/`, `/dist/`, `/v2/examples/`),
then to in-scope names — `@claude-flow/*`, `@ruvector/*`, or in
`UNSCOPED_MAP` keys. Maps each to its post-codemod `@sparkleideas/*`
name and reports.

`UNSCOPED_MAP` is now exported from `scripts/codemod.mjs` (was a
private const) — single source of truth for non-scoped name mappings.

**B2 — `WONT_PUBLISH` + `WONT_PUBLISH_PATTERNS`.** The Phase B initial
dry-run surfaced 103 packages discovered-but-not-in-LEVELS. Inventory:
- 1 v2 legacy: `@claude-flow/migration` (v2/src/migration; v3 cli has
  built-in migration helpers)
- 1 standalone bin: `ruflo` (forks/ruflo/ruflo/; distribution uses
  `@sparkleideas/cli` per Fix 6.1 revised target)
- 1 wasm-pack-broken: `cuda-wasm` (existing comment in
  `publish-order.test.mjs:85` says removed by prior decision)
- ~100 ruvector experimental — covered by 3 patterns:
  - NAPI platform binaries (`*-darwin-*` etc.) → upstream-published, not in our pipeline
  - Experimental wasm-pack outputs (`-edge`, `-delta-behavior`, `-exotic-wasm`, etc.)
  - ruvector tooling/CLIs/servers not in LEVELS
  Pattern-based skip lets new platform binaries auto-resolve; new packages
  that DON'T match a pattern fail-loud (forces decision).

**B3 — `--discover-dry-run` flag wired into `scripts/preflight.mjs`.**
Calls back into `preflight-discover.mjs` for the walk + classification,
prints structured report (in-LEVELS / DISCOVERED-but-MISSING /
in-LEVELS-but-not-DISCOVERED / WONT_PUBLISH), exits 1 on any
unaccounted gap. New npm alias: `npm run discover-packages`.

**B4 — `tests/pipeline/preflight-package-coverage.test.mjs` (NEW).**
8 tests across 2 describe blocks:
- 6 contract tests (discovers ≥ 60; every-discovered-in-LEVELS-or-WONT_PUBLISH;
  every-LEVELS-discoverable; UNSCOPED_MAP completeness;
  publish-levels.json loadable; WONT_PUBLISH_PATTERNS not dead).
- 2 synthetic-fixture fail-loud tests: drop a `@claude-flow/synthetic-...`
  package into a fixture tree, run the discover+coverage check via
  child node, assert exit 1 with "GAP:" report. Inverse: clean fixture
  exits 0.

**B5 — Step 25 reconciliation: deleted `FALLBACK_LEVELS` from
`scripts/publish.mjs`.** The dry-run revealed that
`config/publish-levels.json` (canonical, loaded at runtime) had 22
Level 1 entries while the in-source FALLBACK_LEVELS had only 5 — silent
drift. Per `feedback-no-fallbacks`, replaced the silent fallback with
a `throw` on JSON read failure. `loadLevelsFromJson() || FALLBACK_LEVELS`
became `LEVELS = loadLevels()` where `loadLevels()` throws on read or
schema failure with a message pointing at ADR-0113 §step 25.

**B6 — Step 24 (flip allowlists to derive from walk): reframed.**
- `UNSCOPED_MAP` cannot be "derived from the walked set" — the walker
  uses it as input for the in-scope filter.
- `KNOWN_DEPS` values come from per-package.json `dependencies` —
  full programmatic derivation requires reading every fork
  package.json at test time. Disproportionate complexity for the
  rarity of `dependencies`-shape changes upstream.
- Pragmatic contract instead: coverage test catches LEVELS-side
  drift (test `every discovered package is in LEVELS or WONT_PUBLISH`);
  existing publish-order.test.mjs catches LEVELS↔KNOWN_DEPS desync
  (tests `every package in KNOWN_DEPS exists in LEVELS` + reverse).
  This already locks the contract auto-derivation was supposed to
  give.

**B7 — Test gates:**
- `npm run test:pipeline`: 147/147 pass (8 new tests added).
- `npm run test:unit`: 3706/3706 pass; 0 skipped; 69.8s wall clock.
- Acceptance not run: Phase B is pipeline-script-only, no fork
  changes, no user-facing behavior change. Per CLAUDE.md test pyramid
  table for "Codemod / pipeline script": preflight + pipeline + unit
  is sufficient.

**Outstanding sub-step:** §Implementation plan step 26 calls for
`config/publish-levels.json` "make one canonical, the other a
generated artifact, OR delete the JSON if confirmed decorative."
Outcome: kept JSON as canonical, deleted the in-source duplicate.
The JSON is NOT a generated artifact (it's hand-edited when adding
new packages) — that part of the audit's framing was wrong.

### 2026-05-02 — Phase C landed locally (Fix 4) — push pending

Phase C executed per §Implementation order steps 28-34, halted at
step 35 (PAUSE before public push). Touch summary:

**C1 — Codemod application to fork .md files (`scripts/apply-codemod-to-fork-md.mjs`, NEW).**
Standalone runner that imports `transformSource()` from
`scripts/codemod.mjs` and applies the 4 codemod passes
(@claude-flow/ → @sparkleideas/, @ruvector/ → @sparkleideas/ruvector-,
unscoped imports, mcp__claude-flow__ → mcp__ruflo__) to ONLY the
`.md` files under `forks/ruflo/plugins/` and
`forks/ruflo/.claude-plugin/`. Why standalone: full pipeline
codemod would re-touch dirty package.json files that exist on fork
HEAD from prior pipeline runs. Result: 159 of 198 .md files
rewritten with 851 substitutions.

`scripts/codemod.mjs`:
- Exported `transformSource()` so the standalone runner can reuse it
  without duplicating the regex passes.
- Hardened MCP regex: `mcp__claude-flow__([a-zA-Z0-9_]+|\*)` (was
  `[a-zA-Z0-9_]+` only). Phase C dry-run surfaced one occurrence
  using the literal-asterisk glob form ("valid `mcp__claude-flow__*`
  identifiers") that the original regex missed. Test added
  to `tests/pipeline/codemod.test.mjs` covers both numeric-suffix and
  glob-suffix cases.

**C2 — Marketplace manifest identity (`forks/ruflo/.claude-plugin/marketplace.json`).**
`owner.name`: `"ruvnet"` → `"sparkling"`; `owner.url` updated to
`https://github.com/sparkling`. `name: "ruflo"` retained (Claude
Code marketplace identifier). Plugin source paths
`./plugins/<name>` left intact (relative paths, not scope-renamed).

**C3 — Test coverage (`tests/pipeline/marketplace-manifest.test.mjs`, NEW).**
7 tests across 2 describe blocks:
- 4 manifest-content tests: owner.name == sparkling; manifest name ==
  ruflo; plugin sources are relative ./plugins/; manifest contains zero
  @claude-flow/.
- 3 fork-tree codemod-applied tests: walk plugins/**/*.md and
  .claude-plugin/**/*.md, assert zero @claude-flow/ or
  mcp__claude-flow__ refs remain.

**C4 — Acceptance checks
(`lib/acceptance-adr0113-plugin-checks.sh`).** Two new checks:
- `check_adr0113_marketplace_owner_sparkling` (every-run): greps
  fork manifest via `node`-driven JSON parse. Cheap; runs on every
  acceptance pass.
- `check_adr0113_marketplace_remote_sparkling` (gated by
  `RUFLO_MARKETPLACE_NETWORK_TESTS=1`): `git ls-remote sparkling main`
  vs local main SHA. Default SKIP (no SSH creds on CI). Verified
  pre-push: correctly reports `local b24e46829 ≠ sparkling
  fe6b9211`; post-push must flip to PASS.
- Wired both into `scripts/test-acceptance.sh` `run_check_bg` calls
  + `collect_parallel` wait list.

**C5 — Fork commit (`forks/ruflo` `b24e46829`).** Single commit on
`main` containing 160 files (159 .md + marketplace.json), 851
substitutions, 851 line-changes. NO Co-Authored-By trailer per
`feedback-fork-commit-attribution`. Pushed to nothing yet (per Phase
C step 35).

**C6 — Patch repo README updated.** Added "Plugin marketplace"
subsection to Quick Start: `npx @sparkleideas/ruflo init` first, then
`/plugin marketplace add sparkling/ruflo`. Documents the prerequisite
order per §Status note.

**Test gates:**
- `npm run test:pipeline`: 154/154 pass (7 new from
  marketplace-manifest.test.mjs).
- `npm run test:unit`: 3706/3706 pass; 0 skipped; 69.9s.
- `npm run test:acceptance`: TBD (running at time of this
  documentation pass — appended below on completion).

**PUSH STATUS:** PUSHED 2026-05-02 with user confirmation. Steps 36-37
verified:
- `git -C forks/ruflo push sparkling main` →
  `fe6b92111..b24e46829  main -> main`.
- `git ls-remote sparkling main` returns
  `b24e46829a53332965bcd5df0ee28f1ff5cfe761` (= local main).
- Network-gated acceptance check
  `check_adr0113_marketplace_remote_sparkling` with
  `RUFLO_MARKETPLACE_NETWORK_TESTS=1`: PASS,
  `sparkling/ruflo main = local main = b24e4682`.

The `sparkling/ruflo` repo on github.com now serves as the marketplace
source. End-to-end install path from a fresh init'd project:
`/plugin marketplace add sparkling/ruflo` → resolves to
`https://github.com/sparkling/ruflo.git` HEAD on `main` →
codemod-applied plugin content + `owner.name: "sparkling"` manifest.
