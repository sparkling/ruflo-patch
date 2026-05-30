---
status: accepted
date: 2026-05-19
tags: [hooks, dead-code, consolidation, parallel-implementations]
supersedes: []
depends-on: [ADR-0201]
implements: []
---

# Eliminate the parallel @claude-flow/hooks dead package

> **Third dialectical re-review (2026-05-20, 5-of-5 unanimous at file:line) — intent re-validated, second-pass mechanism prose corrected on TWO load-bearing claims; B-1, B-2, B-3 + C-1 through C-11 applied below.** The dead-ness is confirmed on every axis (never-wired in the CLI's entire git history; ESM `require` bomb ships at `hooks/src/index.ts:233-234`; `reasoningbank/` dead 1,565 LOC; 4 dead bins). But the second-pass swarm's mechanism prose was **factually wrong on two load-bearing claims**, refuted at file:line by 5 of 5 substantive experts:
>
> **(B-1) Publish mechanism — the lever is PAIRED, not "rsync alone".** The second-pass "purely discovery-based publish; `config/publish-levels.json` is read by nothing" claim is wrong. `scripts/publish.mjs:30-52 loadLevels()` reads `config/publish-levels.json` as **the canonical, fallback-deleted publish gate** (`publish.mjs:21-28` comment cites ADR-0113 Phase B step 25 explicitly deleting the fallback per `feedback-no-fallbacks`); `publish.mjs:317-321 pkgDir` check returns `{ok:false}` if the package dir is missing → level loop aborts FATAL. End-to-end chain: `ruflo-publish.sh:510 → publish-verdaccio.sh:141 → publish.mjs:30-52 loadLevels → publish.mjs:453 levels loop`. `config/publish-levels.json:51` IS the publish gate; **deleting `"@sparkleideas/hooks"` from `publish-levels.json:51` is THE lever, mandatory.** `rsync --exclude='v3/@claude-flow/hooks/'` on `copy-source.sh:93` is **defense-in-depth** (prevents wasted build+codemod cycles, ~40s/release saved) but **insufficient alone**: rsync-only without removing from publish-levels.json breaks the release at publish-time (pkgDir missing → FATAL).
>
> **(B-2) Guidance IS live, `/hooks` subpath IS dead-within-live.** The second-pass "open question — guidance/hooks.ts may be a deletion candidate rather than a fold target" footnote was framed as uncertain. It is now resolved at file:line: `cli/src/commands/guidance.ts` dynamically imports `@claude-flow/guidance` at **7 call sites** (`:59 /135 /136 /222 /323 /393 /494`) consuming subpaths `/compiler /retriever /gates /analyzer`; `cli/src/types/optional-modules.d.ts:423-462` declares modules for those 4 subpaths. The `/hooks` subpath has **zero runtime callers** in `cli/src` (architect-0203 conceded after md5-verifying fork=upstream byte-identical). **Guidance IS live; `/hooks` subpath IS provably dead-within-live; DELETE `guidance/src/hooks.ts` is narrowly correct** — guidance's live consumed surface is unaffected. No `hooks-types.ts` synthesis needed.
>
> **(B-3) Republish-then-unpublish ordering is mechanically blocking** (was implied, now explicit). `guidance/package.json:143` carries a **hard dep** `"@claude-flow/hooks": "3.0.0-alpha.7-patch.764"`. Currently-published `@sparkleideas/guidance@latest` resolves to `@sparkleideas/hooks`. **Mandatory ordering: republish hooks-free `@sparkleideas/guidance` FIRST**, confirm `@sparkleideas/guidance@latest` no longer pins hooks, **THEN** `npm unpublish @sparkleideas/hooks --registry=http://localhost:4873 --force`. Wrong order causes a 404 on guidance install during the gap.
>
> **CORRECTIONS folded in: C-1** bin count is FOUR not three (`hooks-daemon`, `statusline`, `claude-flow-hooks`, **plus `guidance` alias** to `dist/cli/guidance-cli.js`). **C-2** dead LOC framing = ~11,850 total (10,137 production + ~1,700 dead-package tests). **C-3** ReasoningBank LOC = 1,565 throughout. **C-4** "50 commits/6mo" → **42 commits to `hooks/src/` in last 6 months** (last upstream commit 2026-05-09, 11 days before this ADR; package not published to npm since 2026-01-07 — actively committed, less actively shipped; only ~5 of 42 are substantive). **C-5** first-commit gap is **~27h** not ~36h (hooks pkg `6af1310c0` 2026-01-05 19:12:36 UTC vs hooks-tools `bad2be391` 2026-01-06 22:38:00 UTC = 27h 25min). **C-7** ADR-0181 Phase 7 analogy refined to "cli/archivist split-brain" precision. **C-8** merge-tax split: tree-level 49-69 non-version-bump commits/6mo (justifies rsync-exclude); **guidance/src/hooks.ts SPECIFICALLY = 1 all-time commit, 0 since 2026-02-01** (3.5 months — DELETE is safe; merge-tax concern is theoretical not realized; CI guard + ledger remain precautionary). **C-9** consolidated 17-row Files-to-change table (see §Bin-and-publish disposition). **C-10** standing-rule disposition is `superseded-by-adr` (NOT `superseded-by-local` — different INTEGRATION-LEDGER vocab class; local ADR explicitly replaces upstream content). **C-11** upstream context: `@claude-flow/hooks` was created for upstream ADR-014's worker system; `hooks-tools.ts` was built on a different dispatch model 27h later; the worker substrate was never wired up.
>
> **Dialectic concluded with zero open items.** 5-of-5 substantive experts (architect + runtime + archaeologist + upstream + devil ×2) cross-verified at file:line. Three self-corrections during rebuttal (devil ×2, architect ×1) all evidence-grounded. Process integrity check passed: no BLOCKER overturned post-edit (the ADR-0202 failure pattern was specifically avoided by holding edits until the queen's 5th "zero open items" close).

## Context and Problem Statement

The audit captured in ADR-0201 (`docs/audits/2026-05-19-soundness-audit/`) confirms that the hook subsystem ships as **two parallel implementations**, and the wrong one is wired:

- **Dead path** — `@claude-flow/hooks` package at `forks/ruflo/v3/@claude-flow/hooks/`. Published as `@sparkleideas/hooks`. The package totals **~11,850 LOC** in TS (10,137 production in `src/` excluding `__tests__/` + ~1,700 dead-package test LOC), spanning `executor/` (420 LOC), `mcp/` (586 LOC), `workers/` (~2,758 LOC across `index.ts` + `mcp-tools.ts` + `session-hook.ts`), `llm/` (552 LOC), `registry/` (267 LOC), `reasoningbank/` (1,565 LOC), plus `index.ts` (242 LOC) and a `bridge/`. The package declares `"type": "module"` and exports 7 subpaths (`.`, `./registry`, `./executor`, `./daemons`, `./statusline`, `./mcp`, `./reasoningbank`, `./guidance`) plus **four bins**: `hooks-daemon`, `statusline`, `claude-flow-hooks`, and a `guidance` alias (both `claude-flow-hooks` and `guidance` → `./dist/cli/guidance-cli.js`, per `hooks/package.json:47-52`).
- **Live path** — `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts` (4097 LOC). All `hooks_*` MCP tools the CLI actually registers are defined here. The CLI's `mcp-client.ts:18` imports `'./mcp-tools/hooks-tools.js'`; the in-process `TOOL_REGISTRY` dispatches every hook call via `callMCPTool` → `tool.handler(input, context)`.

Verification (per F-01-002, F-03-001):

```
$ grep -rln "from.*@claude-flow/hooks\b" forks/ruflo/v3/@claude-flow/cli/src/
# zero matches
$ grep -rn "HookExecutor\|new HookExecutor\|workerMCPTools\|llmHooks\|preEditTool\|routeTaskTool" \
    forks/ruflo/v3/@claude-flow/cli/src/
# zero matches
```

The only non-test, non-dist consumer of any export from `@claude-flow/hooks` is `@claude-flow/guidance/src/hooks.ts`, which imports the `HookRegistry` and `HookEvent` *types* from `./registry/index.ts` + `./types.ts`. No code path in `cli/src/` instantiates `HookExecutor`, registers a hook through `HookRegistry`, calls `routeTaskTool` / `preEditTool` / `workerMCPTools`, or touches the `llm/` hooks. The `bridge/official-hooks-bridge.ts` mapping `Notification → PostTask` is also dead (F-02-013).

Three concrete soundness failures follow from the duplication:

1. **Tool-name divergence proves the parallel paths don't overlap.** Dead uses MCP-style slash namespaces (`hooks/pre-edit`, `hooks/route`); live uses underscores (`hooks_pre-edit`, `hooks_route`). Schemas differ (`storeResults` vs `storeDecisions`; `file` vs `filePath`; `trainNeural` not declared in the live handler). A reader landing on the dead `hooks/src/mcp/index.ts` reasonably infers that routing is keyword-buckets with fixed confidences (0.92 / 0.89 / 0.87 / 0.80 — F-03-001). The real routing in `hooks-tools.ts:975-1304` is a 5-tier graceful-degradation pipeline. The dead surface actively misleads.
2. **ESM `require` bomb in the dead package's public-API surface.** `forks/ruflo/v3/@claude-flow/hooks/src/index.ts:233-234` calls `require('./registry/index.js')` and `require('./types.js')` synchronously inside `addHook()`. The package declares `"type": "module"`, so `require` is not defined; the function will throw `ReferenceError` on first call (F-01-001). The bug is latent — `addHook` has zero callers — but it survives in published `@sparkleideas/hooks` and any future consumer reaching for it via TypeScript autocompletion trips the crash. The runtime probe (audit doc 13) confirms it is not triggered by any current hook path, which is exactly the unreachability that masks the defect today.
3. **Distribution bloat and reader confusion.** ~11,850 LOC (10,137 production + ~1,700 dead-package tests) of unused package source ships in `@sparkleideas/hooks`. Anyone investigating "where do hooks live?" hits the package first (it has the obvious name), reads richer-looking schemas + an executor architecture, and walks away with a wrong model. The audit recon for this very session burned cycles confirming the dead-status because the dead code looks load-bearing.

The decision in scope: **how to consolidate to one implementation**.

## Decision Drivers

- Soundness — every reference resolves to something used (ADR-0201 criterion); two impls violate this.
- No silent fallbacks — the `addHook` ESM crash + the misleading parallel schemas are both [[feedback-no-fallbacks]]-class defects masked by unreachability.
- Surgical change — minimize churn in the live path that already works; do not rewrite 4,097 LOC of functioning handlers.
- One canonical location — readers, contributors, and AI agents should land on one file when looking for hook handlers.
- Preserve `@claude-flow/guidance`'s type dependency on `HookRegistry` / `HookEvent` (the one real consumer of the dead package).
- Publish-bundle cleanup — `@sparkleideas/hooks` should not export entrypoints that crash on call.
- Do not regress the live path; the live `hooks_route` (5-tier graceful degradation per ADR-0191), `pattern-store`, `pattern-search`, and trajectory pipeline are working features.

## Considered Options

- **Option A — Delete the dead `@claude-flow/hooks` package surface; keep only what `@claude-flow/guidance` uses (`registry/index.ts` + `types.ts`).** CLI continues using `hooks-tools.ts` (status quo + cleanup). Removes `executor/`, `mcp/`, `workers/`, `llm/`, `bridge/`, the `hooks-daemon` + `statusline` bins, the broken `addHook` function, and the corresponding `package.json` subpath exports.
- **Option B — Migrate the CLI off `hooks-tools.ts` to consume `@claude-flow/hooks`.** Reimplement (or port) all 4,097 LOC of live handlers atop the dead package's `HookExecutor` + `HookRegistry` abstractions. Delete `cli/src/mcp-tools/hooks-tools.ts`.
- **Option C — Extract a shared core into a smaller new package; both consumers depend on it.** Define a minimal interface, refactor both impls to it, retire the divergent halves.
- **Option D — Leave `@claude-flow/hooks` in place; mark it `"deprecated"` in `package.json`; rely on tree-shaking to exclude it from consumer bundles.**

## Decision Outcome

**Chosen: Option A — eliminate the published `@claude-flow/hooks` surface via a PAIRED LEVER: (a) delete `"@sparkleideas/hooks"` from `config/publish-levels.json:51` (THE canonical publish gate per `scripts/publish.mjs:30-52 loadLevels()` + `:317-321` pkgDir check — fallback explicitly deleted per ADR-0113 Phase B step 25; MANDATORY); (b) `rsync --exclude='v3/@claude-flow/hooks/'` on `scripts/copy-source.sh:93` (defense-in-depth: prevents wasted build+codemod cycles, saves ~40s/release, zero merge-tax since fork source stays byte-identical to upstream). DELETE `@claude-flow/guidance`'s dead `hooks.ts` integration (its only intra-fork importer) rather than fold it. Per [[feedback-no-fallbacks]] / B-1: (a) alone is sufficient to stop publishing; (b) alone is INSUFFICIENT (tree absent from build but still in publish-levels → FATAL at `publish.mjs:317-321` pkgDir resolution). Both are required for a clean release.**

⚠️ **CORRECTED (swarm 2026-05-20):** the first draft said "Fold `registry/index.ts` + `types.ts` into guidance." The swarm found `guidance/src/hooks.ts` is **dead-within-live-guidance** (zero production callers of `registerAll`/`HookRegistry`/`GuidanceHookProvider`; the live `ruflo guidance` command imports only `/compiler /retriever /gates /analyzer`). So the correct move is to **delete `guidance/src/hooks.ts`, drop its `index.ts:78-81` re-export, and drop the `guidance/package.json:143` dependency** — NOT create `guidance/src/hooks-types.ts`. Folding builds runtime-enum infrastructure to keep a dead file compiling, which is anti-consolidation and maximizes merge-tax against upstream's package-importing version.

See §ReasoningBank disposition + §Bin-and-publish disposition in More Information for the definitive resolution of the three caveats this ADR's first draft left as "follow-up to confirm".

Rationale:

- **Option B is a rewrite without a forcing function.** `hooks-tools.ts` is the file that actually works end-to-end with `mcp-client.ts`, `mcp-server.ts`, the daemon hook firing, and the in-process `TOOL_REGISTRY`. The dead `HookExecutor` architecture was designed for a different dispatch model (registry → executor → handler queue) that the CLI does not use. The audit documents tool-name divergence (`hooks/pre-edit` vs `hooks_pre-edit`), schema divergence (`storeResults` vs `storeDecisions`, `file` vs `filePath`, `trainNeural` undeclared in live), and handler-shape divergence (dead `routeTaskTool` is a 4-bucket keyword switch with hardcoded confidences; live `hooks_route` is a 5-tier graceful-degradation pipeline through SolverBandit / SkillLibrary / LearningSystem / SemanticRouter / static patterns). Migrating to the dead surface means re-implementing the live behavior on top of an abstraction it was never designed for, **with no preserved value** from the dead code (no consumer relies on it). The live path also handles concerns the dead path does not — ADR-0191 graceful-degradation logging, ADR-0162 Batch E `synthetic-completed` honest worker verdicts, ADR-0112 explicit-target ReasoningBank pattern-store — none of which exist in `@claude-flow/hooks/src/mcp/*`.
- **Option C invents shared surface that does not exist today.** Live and dead implementations do not share types, schemas, or handler shapes. There is no "common core" waiting to be extracted; an extracted core would be a new design landing simultaneously with refactors in two directions. That is two changes plus a third, not consolidation.
- **Option D ships known dead, known-broken code.** Deprecating in `package.json` is metadata-only — `@sparkleideas/hooks` still publishes, still carries the `addHook` ESM crash, still misleads readers. Tree-shaking does not run for explicit `import '@sparkleideas/hooks/mcp'`; consumers who reach for the autocompletion-visible API still trip the bomb. Deprecation also creates a "two impls, one deprecated" steady state — the worst of both worlds for soundness.
- **Option A's cost is bounded.** Audit verification is unambiguous: zero `cli/src/` imports of `@claude-flow/hooks`. The single intra-fork importer (`@claude-flow/guidance/src/hooks.ts`) is itself dead-within-live-guidance (zero production callers of `registerAll` / `new HookRegistry` / `GuidanceHookProvider` / `createGuidanceHooks`; the live `cli/src/commands/guidance.ts` consumes `@claude-flow/guidance` at 7 dynamic-import call sites using only `/compiler /retriever /gates /analyzer` subpaths). Deleting the dead surface (`executor/`, `mcp/`, `workers/`, `llm/`, `bridge/`, `daemons/`, `statusline/`, `cli/guidance-cli.ts`, `reasoningbank/`, `swarm/`, the `addHook` function, all 4 bins) removes ~11,850 LOC plus seven `package.json` subpath exports.

### Consequences

* Good, because one canonical location for hook handlers (`cli/src/mcp-tools/hooks-tools.ts`); readers, contributors, and AI agents land on a single file.
* Good, because the ESM `require` bomb at `hooks/src/index.ts:233` (F-01-001) is deleted with the rest of `addHook`; no future caller can trip it.
* Good, because misleading dead schemas in `hooks/src/mcp/index.ts` (slash-namespaced parallel tool definitions with hardcoded keyword-bucket confidences) stop competing with the real `hooks_*` tools (F-01-002, F-03-001).
* Good, because `@sparkleideas/hooks` is removed from the publish set entirely via the paired lever (publish-levels.json + rsync-exclude); the dead `guidance/src/hooks.ts` is DELETED outright (no synthetic `hooks-types.ts` needed — the import is dead-within-live guidance).
* Good, because dead subdirectories that the audit flagged as ADR-0201-failing — `executor/`, `mcp/`, `workers/`, `llm/`, `bridge/` — stop shipping in one move rather than per-finding.
* Good, because the `bridge/official-hooks-bridge.ts:274` `Notification → PostTask` "closest match" mapping (F-02-013) stops shipping along with the bridge it lives in.
* Resolved (was "follow-up: external consumers"): the `@sparkleideas/hooks` subpath exports (`./executor`, `./mcp`, `./workers`, `./llm`, `./daemons`, `./statusline`, `./reasoningbank`, `./bridge`, `./swarm`) are removed from publication along with the package itself. The canonical user-facing entrypoint per ADR-0143 is `@sparkleideas/ruflo`; `@sparkleideas/cli` is the in-process implementation; `@sparkleideas/hooks` was never advertised as a user-facing package. The one intra-fork importer `@claude-flow/guidance/src/hooks.ts` is DELETED outright (dead-within-live; zero production callers of its exported `registerAll`/`HookRegistry`/`GuidanceHookProvider` surface). External consumers (if any — none verified, 0 GitHub dependents) see a 404 on subpath imports of the next published version: a clean fail-loud signal per [[feedback-no-fallbacks]], not a silent degradation. The integration ledger records the SHA of the publish-set removal under disposition `superseded-by-adr` referencing ADR-0203.
* Resolved (was "follow-up: bins"): all FOUR bins — `hooks-daemon`, `statusline`, `claude-flow-hooks`, `guidance` — are confirmed dead. Zero shell-outs from any in-tree manifest (`.claude-plugin/hooks/hooks.json` + `plugin/hooks/hooks.json` shell out to `@sparkleideas/cli`/`claude-flow@alpha`, never to any of these bin names; `@claude-flow/mcp/.claude/settings.json:129` shells `hooks statusline` *subcommand* not the bin → deletion safe). External users who registered a workflow that calls these bin names see a missing-command error on next install — fail-loud per [[feedback-no-fallbacks]], no tombstone shim. Note: the project's own `statusline-setup` agent (`~/.claude/skills/`) is a Claude Code feature, unrelated to this `statusline` bin; deleting this bin does not affect the agent.
* Resolved (was "follow-up: reasoningbank"): the `reasoningbank/` **1,565-LOC** subdirectory (1,149 LOC `index.ts` + 416 LOC `guidance-provider.ts` + 7 LOC `embedding-constants.ts`) is a THIRD parallel ReasoningBank implementation, independent of the canonical `forks/agentdb/src/controllers/ReasoningBank.ts` (686 LOC — used by the live `hooks_intelligence_pattern-store` per ADR-0112) and the canonical `forks/ruflo/v3/@claude-flow/neural/src/reasoning-bank.ts` (1,367 LOC — 4-step RETRIEVE/JUDGE/DISTILL/CONSOLIDATE learning pipeline). It reinvents `HNSWIndex` + `EmbeddingService` via fragile dynamic imports, exports a competing global singleton `reasoningBank` instance, and has ZERO callers outside the dead `@claude-flow/hooks` package. The 416-LOC `guidance-provider.ts` companion was meant to feed the `claude-flow-hooks` bin — also dead. Stop shipping with the rest. See §ReasoningBank disposition in More Information for the full analysis.
* Neutral, because Option A does not change live behavior — `cli/src/mcp-tools/hooks-tools.ts` continues to dispatch via `callMCPTool` exactly as it does today; no handler is touched.
* Neutral, because the live path's own outstanding defects (the stub handlers and silent catches catalogued in F-01-003 through F-03-018) remain. Those are out of scope for this ADR; they are properly addressed by separate ADRs in the same wave that target `hooks-tools.ts` directly.
* Neutral (N-1), because fork-direct dev builds inside `forks/ruflo/v3/` (e.g. `npm run build` invoked manually in a fork checkout) will still build `hooks/` — the rsync-exclude only affects the ruflo-patch publish pipeline, not direct-fork dev iteration. Wasted CPU on direct-fork dev, zero functional impact on shipped packages.

### Confirmation

The decision is confirmed by four artefacts, each of which fails the build if the consolidation regresses:

1. **Arch-test forbidding `@claude-flow/hooks` imports (static AND dynamic) + asserting tree exclusion.** A new arch-test under `forks/ruflo/v3/@claude-flow/cli/__tests__/arch/` asserts both `cli/src` AND `guidance/src` have no `@claude-flow/hooks` imports — covering **both static `from '…'` AND dynamic `await import('…')` syntax** — plus the tree is excluded from build (publish-levels.json has no `@sparkleideas/hooks` entry). **NIT N-4 (third-pass dialectic):** the regex MUST cover dynamic-import syntax. The static-only failure pattern tripped two experts during the dialectic itself (architect-0203 + devil-0203 both initially claimed "cli/src has zero `@claude-flow/guidance` imports" via static-only grep; both retracted after the 7 `await import('@claude-flow/guidance/...')` call sites at `commands/guidance.ts:59 /135 /136 /222 /323 /393 /494` were surfaced). A static-only arch-test would let a future contributor re-introduce the dead package via `await import('@claude-flow/hooks/...')` + a `declare module` companion in `optional-modules.d.ts` while the guard passed:
   ```ts
   // hooks-dead-package.arch.test.ts (sketch)
   import { findImports } from '../helpers/imports.js';
   import { readFileSync } from 'fs';
   it('cli/src + guidance/src do not import @claude-flow/hooks (static OR dynamic)', () => {
     const offenders = findImports({
       roots: [
         'forks/ruflo/v3/@claude-flow/cli/src',
         'forks/ruflo/v3/@claude-flow/guidance/src',
       ],
       // Match BOTH static and dynamic import syntax:
       patterns: [
         /from\s+['"]@claude-flow\/hooks(\/[\w-]+)?['"]/,               // static
         /(?:await\s+)?import\s*\(\s*['"]@claude-flow\/hooks(\/[\w-]+)?['"]/, // dynamic
       ],
     });
     expect(offenders).toEqual([]);
   });
   it('optional-modules.d.ts has no declare module @claude-flow/hooks', () => {
     const dts = readFileSync('forks/ruflo/v3/@claude-flow/cli/src/types/optional-modules.d.ts', 'utf8');
     expect(dts).not.toMatch(/declare\s+module\s+['"]@claude-flow\/hooks/);
   });
   it('publish-levels.json has no @sparkleideas/hooks entry', () => {
     const levels = JSON.parse(readFileSync('config/publish-levels.json', 'utf8'));
     const allPkgs = levels.levels.flatMap(l => l.packages);
     expect(allPkgs).not.toContain('@sparkleideas/hooks');
   });
   ```
   Hooked into `npm run test:unit`. New code that re-introduces a dead-path import (static OR dynamic) OR re-adds the package to the publish gate OR adds a declare-module typing companion fails CI. **The inevitable upstream re-merge will trip the import-test loud rather than silently re-diverging** (per §Swarm review evidence ledger standing rule).

2. **Full-deletion verified by build.** Once the change list lands (paired publish-lever + DELETE `guidance/src/hooks.ts` + DELETE bins + rsync-exclude), the CLI build (`npm run release`, which cascades through `build-packages.sh`) must complete green. Specifically:
   - `cli/src/mcp-tools/hooks-tools.ts` continues to type-check (it has no `@claude-flow/hooks` imports today; the package change is invisible to it).
   - `@claude-flow/guidance` continues to type-check after `guidance/src/hooks.ts` is DELETED + `guidance/src/index.ts:77-81` re-export block is removed + `guidance/package.json:143` dep is removed + `guidance/tests/hooks.test.ts` is removed + `guidance/vitest.config.ts:5-9` alias block is removed. The live `cli/src/commands/guidance.ts` consumes `@claude-flow/guidance` at 7 dynamic-import call sites using only `/compiler /retriever /gates /analyzer` subpaths — unaffected.
   - Acceptance group `p3` (hooks) continues to pass under `bash scripts/test-acceptance-fast.sh --group p3`. The live hooks pipeline is unaffected by the publish-set removal of code no live path imports.

3. **Publish-set removal + sequenced Verdaccio unpublish.** `@sparkleideas/hooks` is removed from `config/publish-levels.json:51` (THE canonical publish gate per `publish.mjs:30-52 loadLevels()`); the rsync-exclude on `copy-source.sh:93` prevents the tree from reaching the build (defense-in-depth). `grep -rn "@sparkleideas/hooks\|@claude-flow/hooks" forks/ruflo/v3/@claude-flow/guidance/ forks/ruflo/v3/@claude-flow/plugins/` returns zero matches. **B-3 ordering: republish hooks-free `@sparkleideas/guidance` FIRST** (`npm run release`) so `@sparkleideas/guidance@latest` no longer pins `@sparkleideas/hooks`; **THEN** `npm unpublish @sparkleideas/hooks --registry=http://localhost:4873 --force`. After this, `curl -sI http://localhost:4873/@sparkleideas/hooks` returns `404 Not Found`. Wrong order causes a 404 on guidance install during the gap.

4. **`@claude-flow/guidance` builds without `@claude-flow/hooks`.** After deletion, `npm run release` builds `@sparkleideas/guidance` standalone. `grep -rn "@sparkleideas/hooks\|@claude-flow/hooks" forks/ruflo/v3/@claude-flow/guidance/` returns zero matches. No synthetic `hooks-types.ts` file exists — the dead import was removed, not re-housed.

The 37 stale public-npm versions of `@sparkleideas/hooks` are explicitly **out of scope** for this ADR's confirmation. They are documented in §Bin-and-publish disposition's "Reference (informational)" subsection for context only; pursuing physical unpublish is a separate, manual, non-blocking activity that does not gate this ADR's acceptance.

The latent ESM `require` bomb at `hooks/src/index.ts:233-234` (F-01-001) is closed by the deletion of `addHook` itself, not by repair. The cross-references stand: F-01-001 (ESM `require` bomb), F-01-002 (parallel pre-* hook impls), F-03-001 (dead executor/registry/mcp/workers/llm/bridge), F-02-013 (dead bridge `Notification → PostTask` mapping). The ADR-0201 audit assigned all four to the same root cause; this ADR addresses that root cause in one move.

## Swarm review evidence (2026-05-20, second pass)

6-expert adversarial swarm (queen + architect + runtime + archaeologist +
upstream + devil's advocate), applying [[feedback-remediation-adr-preflight]].
**Intent validated (eliminate the published dead package); execution
corrected.**

- **Dead-ness confirmed on every axis (#3 premise-true).** Zero `cli/src`
  imports (fork AND upstream); the CLI **never** imported `@claude-flow/hooks`
  in its entire git history (pkg first commit `6af1310c0` 2026-01-05 19:12:36 UTC;
  `hooks-tools.ts` first commit `bad2be391` 2026-01-06 22:38:00 UTC,
  **~27h apart** — exact: 27h 25min) — a *never-wired parallel build*
  (per upstream ADR-014's worker architecture the CLI never adopted), the
  cleanest deletion category. ESM `require` bomb real
  (`hooks/src/index.ts:233-234`, `"type":"module"`) and ships
  (`files:[dist]`). `reasoningbank/` (1,565 LOC: 1,149 index + 416 guidance-provider + 7 embedding-constants) dead, zero callers.
  ADR-0143:66 backs "never user-advertised."
- **The publish mechanism is PAIRED — the second-pass swarm's "purely discovery-based" framing was FACTUALLY WRONG (5-of-5 unanimous at file:line — architect + runtime + archaeologist + upstream + devil, with archaeologist's prior defense formally retracted under cross-evidence):**
  - `scripts/publish.mjs:30-52 loadLevels()` reads `config/publish-levels.json` as **the canonical, fallback-deleted publish gate**. The source comment at `publish.mjs:21-28` is explicit: "ADR-0113 Phase B (Fix 3 step 25): config/publish-levels.json is the canonical source of truth. The hardcoded FALLBACK_LEVELS that lived here previously was deleted because it drifted out of sync... Per `feedback-no-fallbacks`, fail loud." `loadLevels()` throws FATAL on missing/malformed.
  - `scripts/publish.mjs:317-321 pkgDir` check returns `{ok:false}` if the package directory is missing → level loop aborts FATAL.
  - End-to-end chain (verified): `ruflo-publish.sh:510 → publish-verdaccio.sh:141 → publish.mjs:30-52 loadLevels → publish.mjs:453 levels loop`.
  - `config/publish-levels.json:51` lists `"@sparkleideas/hooks"` at Level 3 — **THIS is the gate**. Deleting it stops the publish.
  - `publish.mjs:92-145 buildPackageMap` IS discovery-driven (walks `${BUILD_DIR}`), but `loadLevels()` is the topo-list gate. Both surfaces are required: dir-present + listed-in-LEVELS.
  - **Paired-lever consequence:** removing from LEVELS without removing from disk = no publish (on-disk dist becomes invisible to the publish loop; OK). Removing from disk without removing from LEVELS = FATAL at `:317-321` when the level loop can't resolve `pkgDir`. Hence (a) `publish-levels.json:51` delete is MANDATORY; (b) `rsync --exclude` on `copy-source.sh:93` is recommended defense-in-depth (saves wasted build cycles).
  - `scripts/build-packages.sh:188` `_v3_packages=([cli-core]=1 ... [hooks]=1 ...)` is a v3-only filter; harmless either way (better hygiene to remove). `scripts/build-packages.sh:241` `group_2=(neural hooks browser plugins providers claims)` is the **degraded-mode fallback** (when publish-levels.json read fails) — same harmless either way.
  - `config/publish-levels.json` first introduced 2026-03-05 via `bc57b1a3c` (ADR-0005-0019 build-pipeline impl); fallback deletion landed via ADR-0113 Phase B step 25.
- **Merge-tax math, split (per C-8, empirically resolved):**
  - The fork's `forks/ruflo/v3/@claude-flow/hooks/` **tree** sees **42 commits to `hooks/src/` in the last 6 months** (last upstream commit 2026-05-09, 11 days before this ADR; package not published to npm since 2026-01-07 — actively committed, less actively shipped; only ~5 of 42 are substantive — test fixes + type-export bug; rest are checkpoint/bump churn). Tree-wide measurements: archaeologist 49 non-version-bump commits/6mo to `v3/@claude-flow/hooks/`; architect 69 to whole `hooks/`. The wide range (42–69) reflects different filter scopes, but all three measurements agree: **upstream is active, not frozen**.
  - `forks/ruflo/v3/@claude-flow/guidance/src/hooks.ts` **specifically**: **ONE commit ever** (the initial 2026-02-01 add); **ZERO subsequent non-version-bump touches in 3.5 months**. The recurring-merge-tax concern for the DELETE target is **theoretical, not realized** — DELETE is empirically safe. CI guard + standing-rule ledger entry remain warranted (catches the unlikely future case where upstream touches the file).
  - **rsync-exclude rationale:** keeps fork source byte-identical to upstream → zero tree merge-conflict on every sync that touches the 42 hooks/src/ commits. Without it, `git rm`-ing the fork tree would cause modify/delete conflicts on every such sync — recurring re-delete tax. The fork syncs via `git merge upstream/main` (`ruflo-sync.sh:140`); rsync-exclude is the sync-stable path. (If LOC-cleanup of the fork checkout is wanted later, `git rm` is the alternative — but would need to accept a recurring re-delete + the CI guard already proposed.)
- **guidance: DELETE, not fold (#runtime, decisive).** `guidance/src/hooks.ts`
  is dead-within-live-guidance — `registerAll`/`new HookRegistry`/
  `GuidanceHookProvider`/`createGuidanceHooks` have **zero production
  callers** (only `index.ts:78-81` re-export + tests); the live
  `commands/guidance.ts` uses only `/compiler /retriever /gates /analyzer`;
  the barrel `index.ts` is never imported by the CLI. Upstream's guidance is
  the same unwired state. **Delete `guidance/src/hooks.ts` + the
  `index.ts:78-81` re-export + `guidance/package.json:143` dep.** No
  `hooks-types.ts`. (The architect argued fold-to-preserve-the-public-export;
  but the export is dead, never consumed, and guidance is an internal package
  — deleting it breaks nothing real, and folding builds merge-tax-prone dead
  infra.)
- **Missed consumer + sequencing (#devil).** `plugins/package.json:49,55`
  declares `@claude-flow/hooks` as an *optional* peerDependency (zero
  `plugins/src` imports) — harmless to the build but must be removed or
  Confirmation #3's "grep returns zero" is false. **Unpublish ordering
  hazard:** `guidance/package.json:143` is a **hard** dep; the currently-
  published `@sparkleideas/guidance@latest` pins `@sparkleideas/hooks`. Run
  `npm run release` to publish the hooks-free guidance FIRST, confirm
  `@sparkleideas/guidance@latest` no longer pins hooks, THEN
  `npm unpublish @sparkleideas/hooks` — else a hard-dep 404 mid-transition.
- **CI guard + ledger.** The proposed `__tests__/arch/` + `helpers/imports.js`
  are **greenfield** (don't exist). Broaden the arch-test to also forbid
  `@claude-flow/hooks` imports in **`guidance/src`** and to assert
  `config/publish-levels.json` has no `@sparkleideas/hooks` entry — so the
  inevitable upstream re-merge fails loud rather than silently re-diverging.
  Add an INTEGRATION-LEDGER **SKIP-by-policy rule** à la ADR-0187's
  precedent (`docs/adr/ADR-0187:86-90`, "Future upstream-sync waves classify
  all ADR-111-tagged SHAs as `superseded-by-local` referencing ADR-0187"):
  future upstream-sync waves classify all SHAs touching
  `v3/@claude-flow/hooks/` as **`superseded-by-adr`** referencing ADR-0203
  (per C-10 — disposition word differs from ADR-0187's `superseded-by-local`
  because ADR-0203 is the "local ADR explicitly replaces upstream content"
  case per INTEGRATION-LEDGER vocab, not the "fork already moved past
  independently" case). Future sync agents auto-handle the re-appearing
  hooks tree + the re-added guidance import + plugins peer, instead of
  re-auditing (the ADR-0186 cost).
- **Bins: FOUR not three** — `hooks-daemon`, `statusline`, `claude-flow-hooks`,
  **and a `guidance` alias** (both → `guidance-cli.js`). Ledger should name
  all four. Live replacements confirmed (statusline-generator.ts, daemon.ts);
  `@claude-flow/mcp/.claude/settings.json:129` shells the `hooks statusline`
  *subcommand* (not the bin) → deletion safe.
- **Upstream alignment.** `hooks-tools.ts` is the upstream-aligned live path
  (upstream 4117 LOC vs fork 4097; identical `mcp-client.ts:18` wiring). Only
  the DEAD package is the divergence to resolve. No external consumers of
  `@sparkleideas/hooks` (0 GitHub dependents); the 37 stale public-npm
  versions are Verdaccio-shadowed brand-cleanliness, correctly out of scope.

## Pros and Cons of the Options

### Option A — delete the dead package surface

- Good, because the live path is untouched; zero risk of breaking a working feature by attempting to migrate it.
- Good, because the ESM `require` bomb (F-01-001), the misleading parallel tool definitions (F-01-002, F-03-001), and the dead bridge mapping (F-02-013) are all closed in one deletion sweep.
- Good, because `@sparkleideas/hooks` is removed from the publish set entirely via the paired lever (publish-levels.json + rsync-exclude) and the dead `guidance/src/hooks.ts` is DELETED outright — no separate package remains, no synthetic `hooks-types.ts` is added.
- Resolved (not bad): the `reasoningbank/` 1,565 LOC (1,149 index + 416 guidance-provider + 7 embedding-constants) is a third parallel ReasoningBank competing with the canonical agentdb and neural-package impls; the disposition analysis in §More Information concluded "stop shipping with the rest" because none of its features (`GuidancePattern` / `GuidanceResult` / `RoutingResult`) reach a live caller, and the 5-tier `hooks_route` graceful-degradation pipeline already covers the routing use case via different infrastructure.
- Resolved (not bad): the external breaking-change footprint is bounded by ADR-0143 — `@sparkleideas/ruflo` is the canonical user-facing entrypoint; `@sparkleideas/hooks` was never an advertised surface. The package is removed from the publish set entirely; `@claude-flow/guidance/src/hooks.ts` is DELETED outright (dead-within-live; per B-2 / C-6 the second-pass swarm's fold proposal was refuted at file:line). External consumers (if any — 0 GitHub dependents verified) see a 404 on subpath imports — fail loud per [[feedback-no-fallbacks]], not a silent degradation.

### Option B — migrate the CLI to consume `@claude-flow/hooks`

- Good, because the package's `HookExecutor` + `HookRegistry` abstractions would gain a real consumer, justifying their existence.
- Bad, because 4,097 LOC of working handlers in `hooks-tools.ts` would need to be reimplemented or ported on top of an abstraction that was never designed for them. Tool-name, schema, and handler-shape divergence (per F-01-002, F-03-001) means the port is a rewrite, not a refactor.
- Bad, because the live path includes features the dead path does not (ADR-0191 logged graceful degradation in `hooks_route`, ADR-0162 Batch E honest worker verdicts in `hooks_worker-dispatch`, ADR-0112 explicit-target ReasoningBank in `hooks_intelligence_pattern-store`). All would need to be re-built on the new substrate; risk of regression is high.
- Bad, because the migration delivers no observable behavior change. The motivation would be "the dead architecture is more elegant" — a refactor without a forcing function.
- Bad, because the ESM `require` bomb and the parallel-schemas misleading-reader problem are not closed by migration; they need separate fixes on top.

### Option C — extract a shared core into a new package

- Good, in the abstract, because clean abstractions could let both consumers compose without duplication.
- Bad, because there is no shared core to extract today. The live and dead handlers do not share types, schemas, or handler shapes. Extraction would be a new design dropping simultaneously with refactors in two directions — three changes, not one.
- Bad, because the extraction would land alongside the same dead-code soundness problems Option A solves directly. The package count grows from 5 to 6, not shrinks.
- Bad, because the only real "shared core" candidate today is `HookRegistry` + `HookEvent` types — already two files, already used by exactly one consumer (`guidance/src/hooks.ts`) that is itself dead-within-live (per B-2). The right shape for that is Option A's DELETE, not Option C's extraction.

### Option D — deprecate `@claude-flow/hooks` without deletion

- Good, because it is the lowest-risk change in the immediate term (one `"deprecated": true` flag in `package.json`).
- Bad, because the ESM `require` bomb still ships in `@sparkleideas/hooks`. Deprecation does not unpublish; new consumers still see and reach for the package.
- Bad, because the misleading parallel schemas in `hooks/src/mcp/index.ts` still exist on disk; readers still hit them first when investigating hooks.
- Bad, because deprecation creates a "two impls, one deprecated" steady state. The audit treats this as the worst-case soundness failure — references resolve to something, but to the wrong something. ADR-0201's "soundness" criterion is not met by a deprecated-but-shipping parallel impl.
- Bad, because deprecation defers the decision rather than making it; the consolidation will be needed eventually and Option D adds a transitional step that buys nothing.

## More Information

Lifecycle dates from the original record: proposed 2026-05-19, accepted 2026-05-20, implemented 2026-05-21. This ADR was swarm-reviewed.

- **Audit source documents:**
  - `docs/audits/2026-05-19-soundness-audit/01-hooks-pre-lifecycle.md` — F-01-001 (ESM `require` bomb in `addHook`), F-01-002 (two parallel pre-* impls; `hooks/src/mcp/index.ts` dead).
  - `docs/audits/2026-05-19-soundness-audit/03-hooks-intelligence-routing.md` — F-03-001 (`HookExecutor` / `HookRegistry` / `hooks/src/{mcp,workers,llm,bridge}` confirmed dead by exhaustive grep, zero `cli/src/` consumers).
  - `docs/audits/2026-05-19-soundness-audit/02-hooks-post-lifecycle.md` — F-02-013 (`bridge/official-hooks-bridge.ts:274` dead `Notification → PostTask` mapping).
  - `docs/audits/2026-05-19-soundness-audit/00-README.md` — cross-cutting pattern #1 ("parallel implementations, wrong one wired") and CRITICAL row #5 cite the deletion of the dead package as a direct fix.
- **ADR-0201** — the audit ADR that motivated the deletion; this ADR `depends-on: [0201]`.
- **Live path file** — `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts` (4097 LOC).
- **Dead path tree** — `forks/ruflo/v3/@claude-flow/hooks/src/` (stays in fork source byte-identical to upstream per the rsync-exclude lever; no `git rm`, no fold. The dead `guidance/src/hooks.ts` importer is DELETED, severing the only intra-fork consumer of `@claude-flow/hooks`).
- **Sole real consumer of the dead package** — `forks/ruflo/v3/@claude-flow/guidance/src/hooks.ts` (uses `HookRegistry` + `HookEvent` types; does not use `HookExecutor`, `routeTaskTool`, `workerMCPTools`, or `llmHooks`).
- **Upstream context (C-11):** per upstream `ruvnet/ruflo/v3/implementation/adrs/ADR-014-workers-system.md` (dated 2026-01-05), `@claude-flow/hooks` was explicitly created to host the V3 worker system (executor + workers + registry). The CLI's `hooks-tools.ts` was built on a different dispatch model 27h later (2026-01-06 — per C-5 first-commit gap), and the worker substrate the hooks package was designed to host was never wired up. The package is the upstream-authored half of a never-finished migration; the CLI never adopted the worker architecture.
- **Out of scope:** the stub handlers and silent catches inside the live `hooks-tools.ts` (F-01-003 through F-03-018) are addressed by other ADRs in the same audit-response wave; this ADR only addresses the parallel-implementation root cause.

### ReasoningBank disposition (resolved 2026-05-20)

The first draft of this ADR left `reasoningbank/` as "follow-up to confirm before sweep". This subsection records the confirmation and the rationale, so the decision is durable.

**The ReasoningBank landscape — three independent implementations**:

| Where | LOC | Status | Role |
|-------|-----|--------|------|
| `forks/agentdb/src/controllers/ReasoningBank.ts` | 686 | Canonical, live | Persistence layer — `ReasoningPattern` type, `VectorBackend` abstraction (RuVector/hnswlib), optional GNN, v1+v2 API, `recordOutcome` for learning |
| `forks/ruflo/v3/@claude-flow/neural/src/reasoning-bank.ts` | 1367 | Canonical, live | Learning pipeline — 4-step RETRIEVE/JUDGE/DISTILL/CONSOLIDATE, `Trajectory`/`Verdict`/`DistilledMemory`/`Pattern` types, lazy-imports agentdb |
| `forks/ruflo/v3/@claude-flow/hooks/src/reasoningbank/index.ts` + `guidance-provider.ts` | 1565 | Dead inside dead package | Routing/guidance variant — `GuidancePattern`/`GuidanceResult`/`RoutingResult` types, reinvents `HNSWIndex` + `EmbeddingService` via dynamic imports |

**Confirmed via grep** — outside-the-package consumers of `@claude-flow/hooks/reasoningbank/`: zero. Internal consumers (all dead): `hooks/src/index.ts`, `hooks/src/swarm/index.ts`, `hooks/src/llm/llm-hooks.ts`, `hooks/src/cli/guidance-cli.ts` (which feeds the also-dead `claude-flow-hooks` bin), plus 2 test files.

**What the live `hooks_*` actually uses**:

- `hooks_intelligence_pattern-store` (`cli/src/mcp-tools/hooks-tools.ts:2607-2702`) — goes through `memory-router` → AgentDB's `ReasoningBank` controller (implementation tag `'reasoning-bank-controller'`). Per ADR-0112 line 2701-2702, this is the only target; no silent fallback.
- `hooks_route` — 5-tier graceful-degradation pipeline through SolverBandit → SkillLibrary → LearningSystem → SemanticRouter → static patterns. Per ADR-0191 graceful-degradation logging. NOT the hooks-package ReasoningBank's `getGuidance()` / `RoutingResult` shape.
- `@claude-flow/neural`'s `ReasoningBank` — consumed by `cli/src/memory/neural-package-bridge.ts` + `cli/src/ruvector/index.ts` for the learning loop.

**Why the hooks-package version is wrong to keep**:

1. Third parallel implementation, zero live callers.
2. Reinvents `HNSWIndex` + `EmbeddingService` via fragile dynamic imports — bypasses agentdb's `VectorBackend`, `IDatabaseConnection`, and ADR-0181 `MutationContext`.
3. Exports a competing global singleton (`export const reasoningBank = new ReasoningBank()`) — would split-brain on patterns the same way ADR-0181 Phase 7 addressed for the cli/archivist split-brain class if anything ever wired it up (per C-7 precision: ADR-0181 Phase 7 resolved cli/archivist split-brain specifically, not a hooks-pkg/agentdb split-brain — same shape of problem, different surface).
4. Reader confusion compounds with five ReasoningBank files across the tree (counting agentic-flow + plugin examples); the hooks-package one is the most prominently named.
5. `guidance-provider.ts` (416 LOC) translates `GuidancePattern → recommendations: string[]` for the `claude-flow-hooks` bin — which is itself dead.

**Disposition: DELETE.** Folded into the package-wide sweep. No need to extract for future use because the two canonical impls already cover both roles (persistence + learning pipeline) on infrastructure that integrates with ADR-0181's audit chain.

### Bin-and-publish disposition (resolved 2026-05-20)

The first draft left `hooks-daemon` + `statusline` bins as "may break external workflows" and the publish surface as "external consumers unverified". This subsection records definitive dispositions.

**Bins**: `hooks-daemon`, `statusline`, `claude-flow-hooks` in `@sparkleideas/hooks/bin/`. Internal grep confirms zero shell-outs from in-tree manifests:

- `.claude-plugin/hooks/hooks.json` → shells `@sparkleideas/cli`
- `plugin/hooks/hooks.json` → shells `claude-flow@alpha`
- `plugins/ruflo-core/hooks/hooks.json` → references `modify-bash`/`modify-file` (already known broken per F-01-* finding, separate from this ADR's scope)

**Bin disposition: DELETE.** No tombstone shim. External users with workflows calling these bin names see `command not found` — fail loud per [[feedback-no-fallbacks]]. Note: the project's `statusline-setup` agent under `~/.claude/skills/` is a Claude Code feature, NOT this bin; deletion does not affect the agent.

**Where the live functionality lives (deleting these bins loses nothing):**

| Deleted bin | Live replacement |
|-------------|------------------|
| `statusline` (`hooks/src/statusline/index.ts`) | `cli/src/init/statusline-generator.ts` generates a self-contained `.claude/helpers/statusline.cjs` (~34 KB) per-project during `ruflo init`. `.claude/settings.json` → `statusLine.command` points at `node .claude/helpers/statusline.cjs`, never at the npm bin. Verified: zero references to the hooks bin from `cli/src/`. |
| `hooks-daemon` (`hooks/src/daemons/`) | `ruflo daemon` (the CLI command in `cli/src/commands/daemon.ts` — the subject of ADR-0202/0207). |
| `claude-flow-hooks` + `guidance` (both → `hooks/src/cli/guidance-cli.js`, the 4th bin per C-1) | No live replacement needed — the guidance CLI was dead, fed only by the dead `reasoningbank/guidance-provider.ts`. The `@claude-flow/guidance` package consumes ONLY `/compiler /retriever /gates /analyzer` subpaths via dynamic imports in `cli/src/commands/guidance.ts:59/135/136/222/323/393/494` (7 call sites; verified at file:line per B-2). The `/hooks` subpath has zero runtime callers — its DELETE doesn't affect the live `commands/guidance.ts` consumer. The live routing the system uses is the `hooks_route` pipeline in `hooks-tools.ts`, unrelated to this bin. |

**Publish surface**: per ADR-0143, `@sparkleideas/ruflo` is the canonical user-facing wrapper; `@sparkleideas/cli` is the in-process implementation. `@sparkleideas/hooks` was never an advertised user-facing package — it shipped as a side effect of the 41-package fork-publish system.

**Publish disposition: REMOVE `@sparkleideas/hooks` from the publish set via the paired lever** (publish-levels.json:51 + copy-source.sh:93 rsync-exclude). **DELETE `guidance/src/hooks.ts`** outright rather than fold — guidance is live (7 dynamic-import call sites consume `/compiler /retriever /gates /analyzer`), but the `/hooks` subpath is provably dead-within-live (per B-2). No synthesis of `hooks-types.ts`.

**Why DELETE not FOLD (corrects the second-pass "fold what guidance imports" framing):** `guidance/src/hooks.ts:18-29` imports `HookEvent` (runtime enum), `HookPriority` (runtime enum), `HookContext`/`HookResult`/`HookRegistrationOptions` (types), and `HookRegistry` (type-only) from `@claude-flow/hooks`. The second-pass swarm's fold proposal would land all six symbols in `guidance/src/hooks-types.ts` (moving runtime enum code, not just type declarations). The third-pass dialectic refuted this approach: `guidance/src/hooks.ts` is dead-within-live-guidance (zero production callers of `registerAll`/`HookRegistry`/`GuidanceHookProvider`/`createGuidanceHooks`); folding 6 symbols (including 2 runtime enums) to keep a dead file compiling is anti-consolidation. Empirical merge-tax math (C-8): `guidance/src/hooks.ts` has ONE all-time commit (the 2026-02-01 add) + ZERO non-version-bump touches in 3.5 months — DELETE is empirically safe. CI guard + ledger remain precautionary (catch the unlikely future case where upstream touches the file).

**Files to change — final consolidated 17-row list (C-9; paths under `forks/ruflo/v3/@claude-flow/` unless noted):**

| File | Change | Category |
|------|--------|----------|
| `config/publish-levels.json:51` (ruflo-patch) | DELETE `"@sparkleideas/hooks",` line | **MANDATORY (B-1 — THE publish gate)** |
| `guidance/src/hooks.ts` | DELETE entire file | **MANDATORY (B-2)** |
| `guidance/src/index.ts:77-81` | DELETE 3-export re-export block (`GuidanceHookProvider, createGuidanceHooks, gateResultsToHookResult`) | **MANDATORY** |
| `guidance/package.json:143` | DELETE `"@claude-flow/hooks": "3.0.0-alpha.7-patch.764"` line | **MANDATORY** |
| `guidance/tests/hooks.test.ts` | DELETE file (orphaned + broken after guidance/src/hooks.ts deletion) | **MANDATORY** |
| `guidance/vitest.config.ts:5-9` | DELETE `'@claude-flow/hooks': resolve(...)` alias block (orphaned after test deletion) | **MANDATORY** |
| `plugins/package.json:49, 54-56` | DELETE `@claude-flow/hooks` peer + `peerDependenciesMeta` entry (zero `plugins/src` imports; required for Confirmation #1's grep-zero invariant) | **MANDATORY (devil's missed-consumer finding)** |
| **Sequencing**: republish hooks-free `@sparkleideas/guidance` FIRST via `npm run release`; confirm `@sparkleideas/guidance@latest` no longer pins `@sparkleideas/hooks` | Before unpublish — hard-dep ordering hazard (B-3) | **MANDATORY** |
| `npm unpublish @sparkleideas/hooks --registry=http://localhost:4873 --force` | After republish step | **MANDATORY** |
| `scripts/copy-source.sh:93` (ruflo-patch) | ADD `--exclude='v3/@claude-flow/hooks/'` to the ruflo `rsync -a --delete` invocation | RECOMMENDED (defense-in-depth; saves ~40s/release; zero merge-tax) |
| `scripts/build-packages.sh:188` (ruflo-patch) | REMOVE `[hooks]=1` from `_v3_packages` literal | RECOMMENDED (hygiene; v3-only filter, harmless either way) |
| `scripts/build-packages.sh:241` (ruflo-patch) | REMOVE `hooks` from `group_2=(neural hooks browser plugins providers claims)` degraded-mode fallback | RECOMMENDED (degraded-mode fallback only; harmless either way) |
| `scripts/copy-source.sh:162` (ruflo-patch) | REMOVE `"${TEMP_DIR}/v3/@claude-flow/hooks"` from the dist-clear list | HYGIENE (loop silently skips missing dirs; not the gate per B-1 correction) |
| `config/package-map.json:10` (ruflo-patch) | REMOVE `"@claude-flow/hooks": "@sparkleideas/hooks"` mapping | HYGIENE (not read at codemod runtime; only the agentdb test fixture reads this file and asserts about agentdb, not hooks) |
| `forks/ruflo/v3/@claude-flow/testing/src/v2-compat/api-compat.test.ts:141` | REMOVE the `'claude-flow/hooks': '@claude-flow/hooks'` map entry | HYGIENE |
| `forks/ruflo/v3/@claude-flow/hooks/` source tree | **NO `git rm`** — rsync-exclude (above) leaves fork source byte-identical to upstream → zero merge-tax on every sync (5-of-5 verified) | EXPLICITLY NOT CHANGED |
| `scripts/codemod.mjs` (ruflo-patch) | NO EDIT (uses inline `SCOPED_PREFIX_FROM = '@claude-flow/'` at `:26`; has no per-package iteration to remove `hooks` from — the second-pass swarm correctly identified this) | EXPLICITLY NOT CHANGED |
| `config/published-versions.json:13`, `config/package-checksums.json`, `config/.publish-timing.json`, `scripts/.last-bumped-packages` (ruflo-patch) | NO PRE-EDIT (pipeline regenerates each release; pre-edit is churn for no benefit) | EXPLICITLY NOT CHANGED |

**Executable steps (in order):**

1. **Delete `"@sparkleideas/hooks"` from `config/publish-levels.json:51`** (THE publish gate per B-1).
2. **DELETE `guidance/src/hooks.ts`** + `guidance/src/index.ts:77-81` re-export + `guidance/package.json:143` dep + `guidance/tests/hooks.test.ts` + `guidance/vitest.config.ts:5-9` alias. Verify `grep -rn "@claude-flow/hooks\|@sparkleideas/hooks" forks/ruflo/v3/@claude-flow/guidance/` → zero.
3. **Clean `plugins/package.json:49,54-56`** (devil's missed-consumer; required for grep-zero invariant).
4. **Apply recommended hygiene edits**: `copy-source.sh:93` rsync-exclude, `build-packages.sh:188` + `:241`, `copy-source.sh:162`, `package-map.json:10`, `api-compat.test.ts:141`.
5. **Republish hooks-free `@sparkleideas/guidance` FIRST** via `npm run release`. Confirm `@sparkleideas/guidance@latest` resolves without `@sparkleideas/hooks`.
6. **Unpublish from Verdaccio**: `npm unpublish @sparkleideas/hooks --registry=http://localhost:4873 --force`. Verify `curl -sI http://localhost:4873/@sparkleideas/hooks` → 404.

**Open question — RESOLVED 2026-05-20 at file:line (B-2):** cli/src DOES dynamically import `@claude-flow/guidance` — at 7 sites in `commands/guidance.ts` (`:59 /135 /136 /222 /323 /393 /494`) consuming subpaths `/compiler /retriever /gates /analyzer` + `cli/src/types/optional-modules.d.ts:423-462` declares modules for those 4 subpaths. The `/hooks` subpath has zero runtime callers in `cli/src` (3 fork-tree hits: 1 module self-JSDoc at `guidance/src/hooks.ts:15`, 2 doc markdowns — confirmed by both architect-0203 + devil-0203 after self-correction, with md5-verified fork=upstream byte-identical `commands/guidance.ts`). **Guidance IS live; the `/hooks` subpath IS provably dead-within-live; DELETE `guidance/src/hooks.ts` is narrowly correct** — guidance's live consumed surface (`/compiler /retriever /gates /analyzer`) is unaffected.

The integration ledger records (per [[feedback-update-integration-ledger]]):

1. SHA at which `"@sparkleideas/hooks"` was removed from `config/publish-levels.json:51` (the publish gate per B-1).
2. SHA at which `guidance/src/hooks.ts` + its re-export + hard-dep + test + alias were DELETED (no synthetic `hooks-types.ts` exists).
3. SHA at which `plugins/package.json:49,54-56` was cleaned.
4. SHA at which the republish-then-unpublish sequence (B-3) completed.
5. **Standing rule** (per C-10, à la ADR-0187:86-90's SKIP-by-policy precedent): future upstream-sync waves classify all SHAs touching `v3/@claude-flow/hooks/` as `superseded-by-adr` referencing ADR-0203.

#### Reference (informational): the public-npm state

The following is documentation about the npm landscape — **not work this ADR commits to**. It's recorded so that whoever executes this ADR understands the full context.

- Verdaccio's `@sparkleideas/*` rule omits `proxy: npmjs`. Installs through Verdaccio for our scope never fall through to public npm. Verified: `curl -sI http://localhost:4873/@sparkleideas/<non-existent>` → `404 Not Found` directly, no proxy attempt. See [[reference-verdaccio]].
- Public npmjs.org has 37 stale `@sparkleideas/hooks` versions (last is `3.0.0-alpha.7-patch.38`). They predate the Verdaccio-only pipeline switch ([[reference-pipeline-publish-paths]]). Verdaccio carries `patch.764+`.
- The stale public-npm versions are **functionally unreachable** from any install in the user's environment because of the shadowing above. They exist as brand-cleanliness debt.
- Anyone NOT pointing at this Verdaccio (i.e. someone with default public-npm config) can still `npm install @sparkleideas/hooks@3.0.0-alpha.7-patch.38`. This ADR does not change that.
- If at some future point brand-cleanliness becomes a priority: file an npm support ticket to force-unpublish the 37 versions (>72h policy blocks `npm unpublish --force` for the owner; npm support typically accepts scope-owner brand-consolidation requests). That action is **out of scope for this ADR** — it's a separate, manual, multi-day support process that should not gate the consolidation work this ADR describes. Track it as its own ticket if/when pursued.
