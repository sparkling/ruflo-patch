---
status: accepted
date: 2026-05-24
tags: [init, helpers, template, drift]
supersedes: []
depends-on: [ADR-0143, ADR-0201, ADR-0211, ADR-0215, ADR-0233]
implements: []
---

# Init-template fidelity — gate or regenerate the bundled-static layer (CT-B)

## Context and Problem Statement

The 2026-05-24 second-pass soundness audit ([[ADR-0233]] §CT-B) identified a recurring structural defect: the published wrapper ships static `.claude/helpers/*.mjs` files that override the source-of-truth generators at runtime. Three "implemented" ADRs are invisible at runtime as a consequence.

The mechanism is in `forks/ruflo/v3/@claude-flow/cli/src/init/executor.ts:1129-1179`, in `findSourceHelpersDir()`. The function searches four strategies for a directory containing the sentinel file `hook-handler.mjs`:

1. `require.resolve('@claude-flow/cli/package.json')` → package root → `.claude/helpers/`
2. `__dirname`-relative (dist/src/init → package root)
3. Walk up from `__dirname`
4. cwd-relative

For published `@sparkleideas/cli` installs, Strategy 1 wins because the package's `files:` array (`v3/@claude-flow/cli/package.json:80-83`) includes `.claude`, so the bundled `forks/ruflo/v3/@claude-flow/cli/.claude/helpers/` directory ships in the npm tarball. `writeHelpers()` (`executor.ts:1184-1232`) then copies from that directory and **returns early** (line 1230: `return; // Skip generating if we copied from source`). The fallback regeneration path (lines 1234-1243) only runs when no bundled source is found.

Concretely:

* `.claude/settings.json` wires **14 hook subcommands** (verified post-ADR-0211: `route`, `pre-bash`, `pre-edit`, `pre-task`, `post-edit`, `post-task`, `post-command`, `session-restore`, `session-end`, `compact-manual`, `compact-auto`, `status`, `notify`, plus `stats` reachable as a CLI-only handler).
* The source `helpers-generator.ts:generateHookHandler()` defines **14 handler keys** (lines 453-655 — confirmed by literal grep).
* The bundled static `v3/@claude-flow/cli/.claude/helpers/hook-handler.mjs` defines **8 handler keys** (lines 125-240: `route`, `pre-bash`, `post-edit`, `session-restore`, `session-end`, `pre-task`, `post-task`, `stats`).
* The bundled static's mtime (1779135890, 2026-05-14) **predates** the source mtime (1779552172, 2026-05-19) — directly proving the regeneration step did not run after the [[ADR-0211]] fix shipped on 2026-05-23.

The 6 wired subcommands missing from the bundled static (`pre-edit`, `post-command`, `notify`, `compact-manual`, `compact-auto`, `status`) silently no-op at the bundled static's now-removed `[OK] Hook: <name>` fallthrough (the fallthrough lives in the bundled static, not the source — source has the fail-loud `[FAIL] hook-handler: no handler for subcommand:` per ADR-0211 step 5). F-12-001 [HIGH].

The same defect class hits `auto-memory-hook.mjs`: source generator includes a `sync` subcommand (line 1060-1062 in helpers-generator.ts: `case 'sync': await doSync(); break;`); the bundled static's switch only handles `import` and `status` — every Stop hook silently prints a usage hint and triggers no memory sync. F-12-003 [MEDIUM].

A different but adjacent failure mode hits the umbrella plugin layer: `forks/ruflo/.claude-plugin/plugin.json` still declares `name: "claude-flow"`, `version: "2.5.0"`, author `rUv` (verified at lines 2-9) — the [[ADR-0143]] rebrand never reached this file. `forks/ruflo/.claude-plugin/scripts/install.sh:138-179` writes a `claude-flow` MCP key invoking `npx claude-flow@alpha` — wrong server key (clobbers the `ruflo` key the 32 wrapper plugins depend on), wrong binary (upstream, not the fork), missing `-y` per [[feedback-always-npx-for-ruflo]]. F-07-003 [CRITICAL]. The plugin.json/install.sh sites are hand-edited, not generated — they are not a `findSourceHelpersDir` symptom — but they share the structural pattern: **a published static asset that diverges silently from its source-of-truth peer (in this case, the codemod rebrand pass that [[ADR-0143]] established).**

This is the init-template analogue of the codemod golden-master gap that [[ADR-0215]] closed.

## Pre-flight verification

Per the [Remediation-ADR pre-flight checklist](./ADR-0201-codebase-soundness-completeness-audit-with-runtime-validation.md#remediation-adr-pre-flight-checklist-added-2026-05-20), all four checks were run before drafting Decision Outcome.

**Check 1 — Signal reaches its audience: PASSED.** Traced the propagation end-to-end. Source `helpers-generator.ts:453-655` writes 14 keys. Bundle target `v3/@claude-flow/cli/.claude/helpers/hook-handler.mjs:125-240` ships 8. Published cli package's `files: ["scripts", ".claude", "README.md"]` includes the bundled `.claude/helpers/` directory. `findSourceHelpersDir` Strategy 1 (`require.resolve('@claude-flow/cli/package.json')`) resolves to the npx-installed package root. `writeHelpers()` copies all 41 bundled helpers and returns early (line 1230). The two sandbox runs in F-12-001 (`/tmp/ruflo-audit-init-12972/.claude/helpers/hook-handler.mjs` byte-identical to bundled static, both passes) directly verify this code path. The signal is observable: `echo '{}' | node .claude/helpers/hook-handler.mjs pre-edit` in either sandbox prints `[OK] Hook: pre-edit` (the bundled static's old fallthrough), not the source's `[FAIL] hook-handler: no handler`. The bundled-static defect is the user-visible runtime artefact.

**Check 2 — Upstream hasn't already decided: NO CONFLICT.** Upstream `ruvnet/ruflo` ships a similar bundled static `.claude/helpers/hook-handler.cjs` (per ADR-0211 §More Information line 147) and maintains the same defect class — wires more subcommands in `settings-generator.ts` than its handler implements. Upstream has not fixed this; no upstream ADR, issue, or PR addresses the bundled-static drift. A fork-only enforcement does not generate merge tax — the fork's bundled `.claude/helpers/` is a fork artefact (regenerated from the fork's generators) and our gate would only run against fork output. For F-07-003 (umbrella plugin.json + install.sh), upstream `.claude-plugin/plugin.json` carries the same `name: "claude-flow"` / `2.5.0` / `rUv` strings — that is the upstream brand, by design. Our [[ADR-0143]] rebrand explicitly diverged. The umbrella file should have been in scope of ADR-0143's Pass 7 path scope (`.claude-plugin/**/*.json` was listed in §Pass 7 path scope line 60). The miss is a Pass 7 path-scope gap, not an upstream conflict.

**Check 3 — Premise/inventory is true at runtime: VERIFIED EXACTLY.** Counts re-derived from live code, not the audit table:

* `helpers-generator.ts:generateHookHandler()` handler keys, by literal grep `grep -nE "(route|pre-bash|pre-edit|pre-task|post-edit|post-task|post-command|session-restore|session-end|compact-manual|compact-auto|status|notify|stats)':"` over lines 377-700: **14** (`route`, `pre-bash`, `post-edit`, `session-restore`, `session-end`, `pre-task`, `post-task`, `post-command`, `pre-edit`, `notify`, `compact-manual`, `compact-auto`, `status`, `stats`).
* Bundled static `v3/@claude-flow/cli/.claude/helpers/hook-handler.mjs` handler keys, by `grep -nE "'[a-z-]+': \(\) =>"`: **8** (`route`, `pre-bash`, `post-edit`, `session-restore`, `session-end`, `pre-task`, `post-task`, `stats`).
* Drift delta: 6 keys (`post-command`, `pre-edit`, `notify`, `compact-manual`, `compact-auto`, `status`) — exactly matches F-12-001's symptom list.
* mtime sanity: bundled static `1779135890` < source `1779552172` (bundled predates source). The [[ADR-0211]] amendment dates the source fix as shipped 2026-05-23; the bundled mtime is 2026-05-14 — 9 days stale. This is observable evidence that no build step regenerates the bundle from the source.
* Fallback regeneration surface area: `executor.ts:1234-1243` writes 8 helpers from generators (`pre-commit`, `post-commit`, `session.js`, `router.js`, `memory.js`, `hook-handler.mjs`, `intelligence.cjs`, `auto-memory-hook.mjs`). The bundled `.claude/helpers/` ships **41** files. So 33 bundled helpers have **no generator counterpart** — they cannot be regenerated. Of the 8 generator-covered helpers, 5 (`pre-commit`, `post-commit`, `session.js`, `router.js`, `memory.js`) probably do not have a bundled static at the same path; the 3 that overlap and drift are `hook-handler.mjs`, `auto-memory-hook.mjs`, `intelligence.cjs`. Need to verify the 5-vs-3 split at implementation time; for this ADR's decision the load-bearing fact is that **at least 3 generator-covered helpers overlap with bundled statics and are observed to drift.**
* F-07-003 verified: `forks/ruflo/.claude-plugin/plugin.json:2-9` reads `"name": "claude-flow"`, `"version": "2.5.0"`, `"author": {"name": "rUv", "email": "ruv@ruv.net"}`, `"homepage": "https://github.com/ruvnet/claude-flow"`. `forks/ruflo/.claude-plugin/scripts/install.sh:138,140,155,157,178-179` contains `"claude-flow":` MCP key and `npx claude-flow@alpha` invocations. Confirmed by grep, not transcribed from audit.

**Check 4 — No sibling-ADR overlap: CLEAN.**

* [[ADR-0215]] owns the codemod golden-master / content-invariant gate over `.agents/skills/` and the build tree — different seam (skill content corruption, source-resident, not template-emitter drift). This ADR is the structurally analogous gate for the init-template seam, which 0215 explicitly does not reach (`SKILLS_MAP` does not include `.agents/skills/`, and conversely 0215's signature does not match the helper-handler-key drift class).
* [[ADR-0211]] implemented the source-side fix (14 handlers, fail-loud, no `exit(0)` swallow). This ADR makes 0211 visible to npx users; it does not change 0211's decision.
* [[ADR-0216]] owns user-facing `.claude/skills/` shape validation — different artefact category (skills, not helpers).
* [[ADR-0143]] established the codemod's Pass 7 path-scope rebrand. The F-07-003 umbrella plugin.json/install.sh miss is a Pass 7 coverage gap; the remedy is to add those paths to Pass 7's in-scope list **and** fix the current file contents. This ADR's gate for F-07-003 is a content-invariant lint (no `claude-flow` / `2.5.0` / `rUv` / `claude-flow@alpha` strings in user-facing umbrella files) — narrower than a golden-master, complementary to ADR-0143 not overlapping.
* No 0233-batch sibling ADR addresses the bundled-static drift seam. CT-A (silent fallbacks) and CT-G (stdio corruption) hit different seams. CT-C (hardcoded-list drift) is structurally similar but in the pipeline registry, not the bundled-static layer.

All four checks pass. Proceed to Decision.

## Considered Options

### Option A — Golden-master test per emitted file (mirror [[ADR-0215]])

Snapshot every file `ruflo init` writes to a fixture directory; CI diffs `init` output against snapshots; fail on any divergence. Mirror ADR-0215's golden-master mechanism.

* Good: byte-equality is decidable and false-positive-free.
* Good: catches drift in any direction (source change, bundle change, generator behaviour change).
* Bad: surface is 109+ unique generated files plus 141 copied templates (per F-12 audit). Maintenance tax is large — every legitimate template change requires a snapshot bump.
* Bad: snapshots can rot toward rubber-stamped acceptance (the `UPDATE_GOLDEN=1` anti-pattern [[ADR-0215]] explicitly rejected).
* Bad: pins corruption-against-corruption if the snapshot is taken from a currently-stale tree (the [[ADR-0215]] failure mode). Today the bundled static is stale, so an immediate snapshot would lock in the bug.
* Bad: orthogonal to the actual defect — the bug is **drift between source and bundle**, not **drift between bundle and a baseline**. Option A would catch the wrong shape.

### Option B — Delete the bundled static helpers; force regeneration on every init

Remove `forks/ruflo/v3/@claude-flow/cli/.claude/helpers/` from the published package (drop `.claude` from the `files:` array, or delete the directory). `findSourceHelpersDir` Strategies 1-3 fail (no sentinel anywhere in package), and `writeHelpers` falls through to the regeneration path at lines 1234-1243.

* Good: source-of-truth wins automatically; no parallel surface to drift.
* Good: the regeneration path **already exists and is wired** (fallback at line 1234) — no new code required beyond removing the bundle.
* Good: aligned with [[feedback-no-fallbacks]] — one path, no silent override.
* Good: deletes ~38 orphan helpers (F-12-004) at the same time, since the regeneration path only writes 8 helpers (the ones generators produce). Users get a smaller, honest `.claude/helpers/` directory.
* Bad: any helper currently shipped only as a bundled static (the 33 generator-orphans) disappears from user installs. F-12-004 already classifies these as fork-internal dev tooling (`v3.sh`, `v3-quick-status.sh`, `sync-v3-metrics.sh`, etc.) plus unwired modules (`learning-service.mjs`, `metrics-db.mjs`) and setup scripts (`setup-mcp.sh`, `quick-start.sh`, `github-setup.sh`). Most are dead code or fork-developer-only; a few (`setup-mcp.sh`, `quick-start.sh`) might be useful to keep — but `setup-mcp.sh` is broken (F-12-008, writes wrong MCP config) and should be deleted regardless.
* Bad: breaks any user workflow that depends on a bundled static the generator does not produce. Risk is low (most are dead per F-12-004) but unverified per-file at decision time.
* Neutral: triages the 33 orphans implicitly — they are removed unless someone explicitly adds a generator. This forces the F-12-004 decision to happen rather than continuing indefinitely.

### Option C — Regenerate-on-init + sha-pin (regenerate from generators, then sha-check against last known-good)

`writeHelpers` always calls generators; after writing, checksum each generated file against a tracked `sha256.lock` baseline; fail loud on mismatch (regenerator output drifted from baseline).

* Good: catches generator-internal regressions.
* Bad: adds a third moving part (the `sha256.lock` baseline) that itself needs maintenance and a refresh ceremony.
* Bad: still ships the bundled-static layer (parity with source not enforced; only generator-vs-baseline).
* Bad: misses the actual defect — the drift is between generator and bundle, not between generator runs.
* Bad: every legitimate generator change requires a baseline bump, which is the same rubber-stamp risk as Option A.

### Option D — Invert preference: generator beats static if both present

Modify `findSourceHelpersDir` (or `writeHelpers`) so the generator output is used whenever both a generator and a bundled static exist for the same filename; bundled static is the fallback for filenames the generator does not produce.

* Good: surgical change (~10 lines in `writeHelpers`).
* Good: regenerator wins where it exists (3 known files: `hook-handler.mjs`, `auto-memory-hook.mjs`, `intelligence.cjs` per the executor.ts:268 / :525 / :1241-1243 call surface); bundled static still serves the 33 orphans.
* Good: preserves the bundled-static layer for files no generator exists for, so no F-12-004 collateral damage.
* Good: catches the F-12-001 / F-12-003 defects directly — the next `init` after this change emits the 14-handler `hook-handler.mjs` and the `sync`-capable `auto-memory-hook.mjs`.
* Bad: leaves the bundled-static layer alive and silently shadowing — if a future generator is added without removing the bundled counterpart, the preference inversion needs to keep working; one easy refactor could re-invert and reintroduce the bug. Needs a complementary parity test (so it converges with Option A's spirit at runtime, not as a snapshot).
* Bad: does not address F-07-003 (umbrella plugin.json / install.sh) — those are not in the helper-generator path at all.

## Decision Outcome

Chosen option: "Option B + Option D + a targeted content-invariant lint for F-07-003", because the actual defect is dual-source drift that the bundle-side deletion, the preference inversion, and the umbrella-plugin lint each close at their natural layer.

**Chosen: Option B + Option D + a targeted content-invariant lint for F-07-003** — combine the bundle-side deletion (Option B) for files no generator produces, the preference inversion (Option D) for files where both exist, and a lint pass for the umbrella-plugin/install.sh sites that fall outside the helpers seam entirely. Reject Options A and C as wrong-shape for the actual defect.

Per-site disposition:

1. **`hook-handler.mjs` and `auto-memory-hook.mjs` (and `intelligence.cjs` if it overlaps)** — apply Option D: in `writeHelpers` (`executor.ts:1184-1232`), invert the preference so the generator runs first for these names; bundled static is consulted only for names the generator does not produce. The simplest implementation is to seed `result.created.files` from the generators (lines 1234-1243 surface, moved before the copy block) and skip those names in the copy loop. **Add a build-time parity test** in `ruflo-patch/tests/pipeline/init-helpers-parity.test.mjs` (mirroring `skill-shell-integrity.test.mjs`'s placement and runner choice — `node --test`, not vitest): for each name that exists in both the bundled static directory AND the generator dispatch, assert byte-equality. Fail loud, no `UPDATE_GOLDEN`-style accept path. The parity invariant prevents Option D's "easy re-inversion" failure mode and aligns with [[feedback-no-fallbacks]].

2. **The 33 bundled-static orphans** (no generator counterpart) — apply Option B: triage with F-12-004 in scope. The intent of this ADR is the seam fix, not the orphan classification, but the seam fix is the natural moment to do the classification. Concretely: drop `.claude` from the cli package's `files:` array (`v3/@claude-flow/cli/package.json:80-83`) and stop shipping ANY bundled `.claude/helpers/` to users. The generator-produced helpers are written by the fallback regeneration path (lines 1234-1243). Any orphan worth keeping must either get a generator or move to `forks/ruflo/scripts/` for fork-developer use only. **This part of the decision triages F-12-004 by deletion, the [[ADR-0210]] stub-honesty default.** If the deletion is judged too aggressive at implementation time, the conservative fallback is to delete only the 3 generator-overlapping bundled statics and leave the 33 orphans (keeps F-12-004 unresolved but unblocks F-12-001 / F-12-003).

3. **F-07-003 — umbrella `plugin.json` + `install.sh`** — apply a content-invariant lint in the same `ruflo-patch/tests/pipeline/` directory: scan `forks/ruflo/.claude-plugin/**/*.json` and `.sh` for the forbidden strings `"name": "claude-flow"`, `"version": "2.5.0"`, `"name": "rUv"`, `npx claude-flow@alpha`, `mcp add claude-flow ` (with trailing space to exclude false-positives in prose). Fail loud on any hit. Fix the current file contents in the same commit pair as the lint lands (test-first per the project's TDD discipline): umbrella plugin.json `name → ruflo`, `version → next-released-fork-version` (or `0.0.0` placeholder if version is owned elsewhere), author `rUv → ruvnet` or `Henrik Pettersen`, homepage to fork's repo; install.sh's MCP write to the canonical form (`claude mcp add ruflo -- npx -y @sparkleideas/ruflo@latest mcp start`) or delete install.sh entirely if `.mcp.json` registration is the only supported path (likely, per ADR-0117 §Revision 2026-05-03's service-method design). Also extend [[ADR-0143]]'s Pass 7 *extension* allowlist to include `.sh` (currently `.{md,json}` only per ADR-0143 line 60). The brand-string drift itself is out of Pass 7's regex scope — Pass 7 rewrites `@sparkleideas/cli` package refs, not `name: "claude-flow"` brand strings — so the `umbrella-plugin-brand.test.mjs` lint is the durable gate; the Pass 7 extension is a defense-in-depth widening for future `.sh` rebrand needs (corrected per Swarm review (2026-05-24) E3). The umbrella sites are not regeneratable (they are hand-edited static files), so the lint is the only durable gate.

### Why this composition and not Option A alone

Option A (golden-master per emitted file) is the wrong instrument because the actual defect is **dual-source drift** (two writers of the same artefact diverging), not **single-source regression** (one writer changing unexpectedly). The right gate for dual-source drift is **a parity assertion between the two sources**, not a snapshot of one of them. The 109-file maintenance tax of Option A is also not warranted — the drift is concentrated in a handful of overlapping files (3 today), and only those need parity gates.

Option B alone would solve F-12-001 and F-12-003 but does not prevent re-introduction (a future commit could re-add the bundled static, and the bug returns). Option D alone preserves the bundled-static layer as a silent shadow that can be re-inverted by accident. The combination — B for the orphans, D for the overlaps, lint for F-07-003 — closes each seam at its natural layer.

Option C is rejected outright: it adds a baseline that needs ceremony to refresh, does not catch the dual-source drift, and the existing per-pass tests already cover generator-internal regressions (precedent: ADR-0211's `__tests__/init/adr0211-hook-handler-event-completion.test.ts`).

### Confirmation

Acceptance check (fresh `ruflo init` sandbox per [[feedback-inspect-installed-not-dev-nodemodules]]):

1. **Parity test for generator-overlapping bundled statics:** `ruflo-patch/tests/pipeline/init-helpers-parity.test.mjs` exists, runs under `node --test`, and asserts byte-equality between each generator output and any same-name file in `forks/ruflo/v3/@claude-flow/cli/.claude/helpers/`. Fails today (bundled `hook-handler.mjs` has 8 keys, generator emits 14). After the source-bundle alignment, passes.
2. **Bundled-static removal verification:** `tar -tf $(npm pack @sparkleideas/cli@latest 2>/dev/null | tail -1) | grep '.claude/helpers/'` returns 0 lines (the directory is no longer in the published tarball). If the conservative fallback is chosen instead, the count is 33 (orphans retained), and a fresh `init` emits a `.claude/helpers/hook-handler.mjs` with 14 handler keys from the regeneration path, not the 8 from the deleted bundled static.
3. **Runtime hook-handler verification:** `echo '{}' | node .claude/helpers/hook-handler.mjs pre-edit` in a fresh init sandbox exits non-zero with `[FAIL] hook-handler: no handler for subcommand: pre-edit` only if the user has not yet upgraded to the parity-passing release. Post-release, the same command runs the real `pre-edit` handler (returns FS check result, exit 0).
4. **`auto-memory-hook.mjs sync` verification:** `node .claude/helpers/auto-memory-hook.mjs sync` runs the real sync (`case 'sync': await doSync(); break;`), not the bundled static's `default` branch usage hint.
5. **F-07-003 lint verification:** `ruflo-patch/tests/pipeline/umbrella-plugin-brand.test.mjs` exists, asserts the forbidden-string list against `forks/ruflo/.claude-plugin/**/*.{json,sh}`. Fails on the current tree (umbrella plugin.json + install.sh). After the source fix, passes.
6. **F-07-003 file content fix verification:** `forks/ruflo/.claude-plugin/plugin.json` reads `"name": "ruflo"` (or the project-canonical brand), author is `ruvnet` or `Henrik Pettersen`, homepage points at the fork's repo. `forks/ruflo/.claude-plugin/scripts/install.sh` either no longer writes an MCP key (preferred: delete the script) OR writes the canonical `claude mcp add ruflo -- npx -y @sparkleideas/ruflo@latest mcp start` line and uses no `claude-flow@alpha` invocations.
7. **Pass 7 scope extension:** `scripts/codemod.mjs`'s Pass 7 path-scope predicate (per [[ADR-0143]] §Pass 7 path scope) matches `.claude-plugin/**/*.{json,sh}`. A regression test exists asserting that a deliberately-inserted `@sparkleideas/cli` reference in `.claude-plugin/plugin.json` is flipped to `@sparkleideas/ruflo` by `transformSource()`.
8. **No regression to ADR-0211's existing acceptance:** the `adr0211` acceptance group still passes after Option D's preference inversion (the parity test makes generator and bundled identical, so the user-facing behaviour does not change — but it now matches the generator, not the bundled static).

### Consequences

* Good, because the three "implemented" ADRs ([[ADR-0211]] hook-handler keys, [[ADR-0211]]'s `auto-memory-hook.mjs sync`, [[ADR-0143]] brand rebrand) become visible to npx-installing users for the first time — closes the "implemented in source, invisible at runtime" failure mode that audit F-12-001 / F-12-003 / F-07-003 collectively diagnosed.
* Good, because the parity test (init-helpers-parity) prevents recurrence at build time, where the signal is not eaten by any runtime catch — same mechanism class as [[ADR-0211]]'s build-time subset test, applied to the build-pipeline layer rather than the init-handler layer.
* Good, because the F-07-003 lint and Pass 7 path-scope extension prevent the umbrella-plugin rebrand miss from recurring on any future hand-edit.
* Good, because the bundled-static deletion (Option B) eliminates the 33 orphan helpers (F-12-004) by default, forcing the keep-or-delete decision rather than letting them rot indefinitely. Aligns with [[ADR-0210]] stub-honesty.
* Bad, because the bundled-static deletion may surprise any user workflow that depended on an orphan helper (e.g. `setup-mcp.sh`, `quick-start.sh`). Risk is low per F-12-004's classification (most orphans are dead code, `setup-mcp.sh` is actively broken per F-12-008) but unverified per-file. The conservative fallback (retain orphans, delete only the 3 overlaps) is documented in the Decision.
* Bad, because the F-07-003 fix requires picking a canonical brand-version-author triple for the umbrella plugin.json. Project lacks a single source-of-truth for the umbrella's identity; the implementer must coordinate with the wrapper-version cadence (per [[project-ruflo-wrapper-latest-regression]] memory note, version cadence has been brittle). Mitigation: pin a `0.0.0` placeholder until the wrapper-version-aware build step takes over, then upgrade.
* Bad, because removing install.sh entirely (preferred F-07-003 fix) breaks any user docs or external README that references it. Need to grep docs/USERGUIDE.md and README.md and either retitle or delete those references.
* Neutral, because the runtime user-visible behaviour for the 6 missing hook subcommands changes from `[OK] Hook: <name>` no-op (bundled static's old fallthrough) to real handler invocation (post-fix). For `compact-manual` / `compact-auto` / `status`, the real handlers just print guidance text — observable but low-impact. For `pre-edit` / `post-command` / `notify`, the real handlers do meaningful local work per [[ADR-0211]].
* Neutral, because bundled-static deletion does not impact post-install offline behaviour: `npm install` requires network by definition, and the generator code (`dist/init/helpers-generator.js`) ships in the same tarball as the bundled static did, so all 8 generator-covered helpers regenerate offline after install (clarified per Swarm review (2026-05-24) E5 refutation of DA's "first-time offline install" framing).

## Sites table

| Site | File | Lines | Defect | Severity | Disposition |
|------|------|-------|--------|----------|-------------|
| 1 | `forks/ruflo/v3/@claude-flow/cli/src/init/executor.ts` | 1129-1232 | `findSourceHelpersDir` + `writeHelpers` prefer bundled static over generator | HIGH | Option D inversion (generator wins for overlapping names) |
| 2 | `forks/ruflo/v3/@claude-flow/cli/.claude/helpers/hook-handler.mjs` | 125-240 | 8 keys vs 14 in generator; ADR-0211 invisible | HIGH | Option B delete from package OR Option D inversion regenerates it |
| 3 | `forks/ruflo/v3/@claude-flow/cli/.claude/helpers/auto-memory-hook.mjs` | 359-364 | No `sync` case; Stop hook breaks cross-session memory persist | MEDIUM | Option B delete OR Option D inversion regenerates it |
| 4 | `forks/ruflo/v3/@claude-flow/cli/.claude/helpers/` (directory) | 41 files | 33 generator-orphans; bundled static layer entire | MEDIUM | Option B: drop `.claude` from cli package `files:` (with conservative fallback per Decision) |
| 5 | `forks/ruflo/v3/@claude-flow/cli/package.json` | 80-83 | `files: ["scripts", ".claude", "README.md"]` ships the bundled static layer | n/a | Drop `.claude` (Option B); or leave and rely on Option D + parity test |
| 6 | `forks/ruflo/.claude-plugin/plugin.json` | 2-9 | `name: "claude-flow"`, `version: "2.5.0"`, author `rUv` (ADR-0143 miss) | CRITICAL | Hand-edit to canonical brand + add to Pass 7 path scope + lint |
| 7 | `forks/ruflo/.claude-plugin/scripts/install.sh` | 138-179 | `"claude-flow"` MCP key + `npx claude-flow@alpha` (wrong server key, wrong binary) | CRITICAL | Delete the script OR rewrite the MCP add line + add to Pass 7 path scope + lint |
| 8 | `scripts/codemod.mjs` (Pass 7 path scope) | (per [[ADR-0143]] §Pass 7 path scope) | `.claude-plugin/**/*.{json,sh}` missing from in-scope list | MEDIUM | Add the path; regression test verifies a deliberate `@sparkleideas/cli` insertion gets flipped |
| 9 | `ruflo-patch/tests/pipeline/init-helpers-parity.test.mjs` | (new) | n/a — net-new parity gate | n/a | Create — `node --test`, walks generator-output vs bundled-static byte-equality |
| 10 | `ruflo-patch/tests/pipeline/umbrella-plugin-brand.test.mjs` | (new) | n/a — net-new content-invariant lint | n/a | Create — `node --test`, forbidden-string scan |

## More information

* [[ADR-0233]] §CT-B — the cross-cutting theme this ADR addresses (F-12-001 HIGH, F-12-003 MEDIUM, F-07-003 CRITICAL).
* [[ADR-0211]] — implemented the source-side hook-handler fix (14 handlers, fail-loud, `feedback(success)`). This ADR makes that fix visible to users.
* [[ADR-0215]] — codemod golden-master / content-invariant gate over `.agents/skills/`. Same defect-class shape (published static drifts from source-of-truth); different seam (skill content vs init template). This ADR mirrors 0215's "content invariant, not byte-snapshot" remedy choice (chose Option E in 0215, mirrored as Option D + parity here).
* [[ADR-0143]] — the brand rebrand. F-07-003 is a Pass 7 path-scope coverage gap; this ADR extends Pass 7's in-scope list and adds a lint to enforce it.
* [[ADR-0210]] — stub-honesty mandate. The "delete the bundled `.claude/helpers/` layer" half of Option B is a direct application: keep what works (generators), document-or-remove what doesn't (the 33 orphans).
* [[ADR-0117]] §Revision 2026-05-03 — service-method MCP install pattern. install.sh's `claude-flow` MCP key writes a non-service-method config that contradicts ADR-0117 in addition to ADR-0143.
* [[ADR-0201]] §Remediation-ADR pre-flight checklist — the 4-check gate applied above.
* `feedback-remediation-adr-preflight` — the corpus rule that gates this ADR.
* `feedback-no-fallbacks` — the parity test and lint both fail loud, no operator-accept path.
* `feedback-no-squelch-tests` — no `UPDATE_GOLDEN`-style snapshot regenerate path; the parity test and lint are content invariants, not pinned baselines.
* `feedback-patches-in-fork` — the source-content fixes for F-07-003 land in the fork; the parity test and lint land in `ruflo-patch/tests/pipeline/`.
* `reference-user-facing-brand` — the canonical brand for F-07-003's umbrella plugin.json fix.
* `feedback-always-npx-for-ruflo` — the canonical MCP-add command for the install.sh rewrite (if not deleted).
* `project-ruflo-wrapper-latest-regression` — context for the wrapper-version cadence brittleness that complicates the F-07-003 fix.
* Audit source files: `docs/audits/2026-05-24-second-pass-audit/12-init-template-fidelity.md` (F-12-001, F-12-003), `docs/audits/2026-05-24-second-pass-audit/07-plugin-contents.md` (F-07-003).

## Swarm review (2026-05-24)

**Pattern**: P2 Decision. **Consensus**: Quorum-majority (≥3/5). **Queen**: tactical. **Panel**: 5 experts + DA. **Topology**: hierarchical. **Transport**: queen-composed.

### Panel composition

- **Expert 1 — Init template specialist** (helpers-generator vs bundled static; `executor.ts:findSourceHelpersDir` preference order)
- **Expert 2 — Codemod-scope specialist** (ADR-0215 model: codemod golden-master for analogous problem class)
- **Expert 3 — Brand-rebrand archeologist** (ADR-0143 Pass history; what was supposed to flip and didn't)
- **Expert 4 — Build-pipeline specialist** (how the wrapper gets built + bundled, when generators vs static run)
- **Expert 5 — npx-installation simulator** (first-time-install offline behavior; cache states)
- **Devil's Advocate** — "Delete bundled static → break first-time installs offline (no source generators available); the bundled static is a feature, not a bug"

### Upstream intent

Verified by directly comparing fork and upstream sources. Upstream `ruvnet/ruflo/v3/@claude-flow/cli/src/init/executor.ts:1055-1105` has the **identical** `findSourceHelpersDir` preference order (Strategy 1: `require.resolve('@claude-flow/cli/package.json')` → package-root `.claude/helpers/`; Strategies 2-4 are fallbacks) and the **same** `writeHelpers` copy-then-return-early structure at `executor.ts:1110-1180` (line 1148: `return; // Skip generating if we copied from source`). The single material difference: upstream's sentinel is `hook-handler.cjs` (line 1057) and upstream's generator targets `'hook-handler.cjs': generateHookHandler()` (line 1159), while the fork uses `.mjs` throughout (`executor.ts:1131,1241`). Upstream's bundled `v3/@claude-flow/cli/.claude/helpers/hook-handler.cjs` carries 8 handler keys (verified by `grep -nE "'[a-z-]+':"`: `route`, `pre-bash`, `post-edit`, `session-restore`, `session-end`, `pre-task`, `post-task`, `stats`) — same drift defect class is present upstream by the same mechanism. Upstream `.claude-plugin/plugin.json` is **byte-identical** to the fork's for the brand strings (`name: "claude-flow"`, `version: "2.5.0"`, author `rUv`, homepage `ruvnet/claude-flow`) — confirms F-07-003 is a Pass 7 path-scope miss, not an upstream-conflict; the only diff is upstream retains `mcpServers` (3 servers) while the fork correctly removed it per [[ADR-0117]] §Revision 2026-05-03. Upstream `install.sh` is byte-identical to the fork's including the `"claude-flow"` MCP key + `npx claude-flow@alpha`. No upstream ADR/issue/PR addresses either the bundled-static drift or the umbrella rebrand miss. Fork-only fix on both is the only path; no merge tax beyond the natural sentinel-rename drift already present.

### ADR-180+ alignment

ADR-0211 (implemented 2026-05-22) added the 14 handler keys + fail-loud + `feedback(success)` to `helpers-generator.ts`, but only at the **source**; its Confirmation #1 prescribes a "build-time subset test asserting `settings-generator.ts` subcommands are a strict subset of `helpers-generator.ts` handler keys" — that test exists at the source layer but does NOT run against the published artefact, leaving the bundled-static drift unguarded. ADR-0235 closes exactly that audit-disclosed gap. ADR-0215 (implemented 2026-05-22, Option E) chose a producer-agnostic content-invariant gate (`tests/pipeline/skill-shell-integrity.test.mjs`, `node --test`) over a byte-equality golden-master — the structurally identical decision shape mirrored here: parity invariant (not snapshot) + fail-loud (no `UPDATE_GOLDEN` operator-accept). ADR-0143 (accepted 2026-05-04) defined Pass 7 path scope (line 60: `.claude-plugin/**/*.{md,json}`) — the umbrella plugin.json **should** be in scope; verified by inspection it is not being rewritten (the file retains upstream brand strings 17+ days later). ADR-0223 (init MCP canonicalization) and ADR-0117 §Revision 2026-05-03 (service-method install) are consistent: install.sh shouldn't be writing an MCP key at all under service-method, so delete-rather-than-rewrite is upstream-aligned. No conflicts with ADR-180+ batch; alignment is direct.

### Critique outcomes

| Expert | Critique | Vote | Adopted? |
|---|---|---|---|
| **E1 — Init template** | The Decision conflates two distinct overlap sets. The 8-name set "Fall back to generating helpers" (`executor.ts:1234-1243`) is the only set Option D's preference inversion can act on. The 33-name set lives only in the bundled static. Implementation step must explicitly enumerate which 8 names get preference-inverted (`pre-commit`, `post-commit`, `session.js`, `router.js`, `memory.js`, `hook-handler.mjs`, `intelligence.cjs`, `auto-memory-hook.mjs`), of which 3 currently overlap with bundled statics (`hook-handler.mjs`, `auto-memory-hook.mjs`, `intelligence.cjs`). | agree | YES — fragment Step 1 enumerates the 3 overlap names and the 5 non-overlap names explicitly |
| **E2 — Codemod-scope** | The ADR correctly cites ADR-0215 as a model but understates the mirror. ADR-0215 was a single content-invariant grep over one tree; this ADR proposes (a) parity test + (b) tarball-content lint + (c) brand-string lint — three gates. Recommend the parity test use the same `node --test` runner choice + `walkMd`/file-walk pattern (`marketplace-manifest.test.mjs`) for consistency, not invent a new harness. | agree | YES — fragment Step 3 specifies `node --test`, `walkMd` pattern; cross-references `skill-shell-integrity.test.mjs:walkMd` |
| **E3 — Brand-rebrand archeologist** | Pass 7's path scope DID include `.claude-plugin/**/*.{md,json}` (verified line 60 of ADR-0143). The miss is therefore not a path-scope gap — it's that Pass 7's *regex* matches `@sparkleideas/cli` → `@sparkleideas/ruflo` but does NOT match `claude-flow` → `ruflo` for the umbrella's brand strings (`name`, `homepage`, etc.). The brand strings are a different rebrand surface than the codemod was designed to cover. ADR-0235 should explicitly call this out: the fix is a NET-NEW lint, not a "Pass 7 path-scope extension" (which would do nothing — the strings are out of Pass 7's regex scope). | agree | YES — Decision step 3 rephrased + fragment risk section clarifies; Pass 7 already covers paths but the strings are out of its regex scope. The ADR's "extend Pass 7 path scope" language is corrected. |
| **E4 — Build-pipeline** | The bundled static is committed to the fork at `forks/ruflo/v3/@claude-flow/cli/.claude/helpers/` — it's NOT regenerated by any build step. The cli's `prepublishOnly` only copies README.md. So Option B's "drop `.claude` from `files:`" is the only way to keep them out of the published tarball; just deleting the directory doesn't survive `git`. The fragment should specify BOTH: (a) modify `package.json` `files:` array AND (b) `git rm -r forks/ruflo/v3/@claude-flow/cli/.claude/helpers/`. Otherwise contributors will accidentally re-add it via `git add .`. | agree | YES — fragment Step 2 specifies both git removal and files: array change |
| **E5 — npx-installation simulator** | The DA's "break first-time offline installs" concern is unfounded: `npx -y @sparkleideas/ruflo@latest init` is by definition online — npm install requires network to fetch the package. The bundled static is shipped IN the package tarball, so "offline after install" is irrelevant; the package is already downloaded. The regeneration path runs against the same in-process `helpers-generator.js` (compiled from `.ts`), which is itself in the tarball under `dist/`. Once `dist/` is in the package, all 8 generator-overlapping helpers regenerate offline. The 33 orphans are dead code per F-12-004; their loss is a feature. | agree | YES — DA argument refuted; recorded in DA position section |
| **DA — Devil's Advocate** | The bundled static is a feature, not a bug: (a) it provides a known-good baseline that doesn't depend on generator output being correct; (b) deleting it removes ~33 orphan helpers that might have value not yet discovered (`setup-mcp.sh`, `quick-start.sh`); (c) preference-inversion is a half-measure that leaves the bug latent — anyone reverting the inversion re-introduces it. **Stronger version**: just delete the entire `findSourceHelpersDir` copy path — always regenerate. Simpler than preference-inversion. | challenge | PARTIALLY — DA's "always regenerate" position is folded into the Decision as the preferred fallback if the conservative-fallback path (per ADR-0235 §Decision item 2) is chosen. The ADR's explicit conservative fallback already covers the orphan-retention concern. |

### DA final position

**Held — with explicit principled dissent on the surface-area pruning question.** The DA accepts that Option B+D+lint solves F-12-001, F-12-003, F-07-003 at their respective seams. The DA holds that the preference-inversion approach is a structurally weaker remedy than "delete the copy path entirely; always regenerate" — but this disagreement is a question of remedy *aggressiveness*, not of *correctness*. The DA's stronger position ("always regenerate") is captured as a documented option (Decision §1 already references the conservative fallback as the inverse end of this scale). The DA does **not** dissent on F-07-003 (umbrella rebrand) or on the parity-test-as-invariant approach. The DA's "bundled static as feature" framing was refuted by E5 (offline-install argument is unfounded; npm install is online by definition; generators run offline post-install).

### Improvements adopted

1. **E1 — Enumerate the 8 generator-covered names explicitly.** Decision §1 already says "for these names" but does not list them; fragment Step 1 enumerates: `pre-commit`, `post-commit`, `session.js`, `router.js`, `memory.js`, `hook-handler.mjs`, `intelligence.cjs`, `auto-memory-hook.mjs` (the 8 from `executor.ts:1235-1243`), of which `hook-handler.mjs`, `intelligence.cjs`, `auto-memory-hook.mjs` are the 3 known overlaps with the bundled static. Verify the 5-vs-3 split at implementation time (Decision §3 Pre-flight verification Check 3 already flagged this as load-bearing-fact-not-yet-verified).
2. **E2 — Consistent test harness.** The parity test (`init-helpers-parity.test.mjs`) and the umbrella-brand lint (`umbrella-plugin-brand.test.mjs`) both use `node --test`, walk the fork tree via the `walkMd` pattern (per [[ADR-0215]] / `marketplace-manifest.test.mjs`). No vitest. No new harness invention.
3. **E3 — Correct the Pass 7 framing.** Decision §3's "extend Pass 7's path scope to include `.claude-plugin/**/*.{json,sh}`" is technically wrong — Pass 7's path scope already covers `.claude-plugin/**/*.{md,json}` per [[ADR-0143]] line 60. The miss is at the *regex* layer: Pass 7 rewrites `@sparkleideas/cli` → `@sparkleideas/ruflo`, not `"name": "claude-flow"` → `"name": "ruflo"`. The umbrella plugin.json brand strings are out of Pass 7's regex scope by design. **Fix**: the umbrella-brand lint (`umbrella-plugin-brand.test.mjs`) is the durable gate; Pass 7 extension is irrelevant. (Note: `.sh` is genuinely missing from Pass 7's `.{md,json}` extension list and IS a valid extension addition — but the regex+content gap remains.) The Decision text is amended in-place below.
4. **E4 — Two-part bundled-static deletion.** Fragment Step 2 specifies BOTH (a) `git rm -r forks/ruflo/v3/@claude-flow/cli/.claude/helpers/` AND (b) drop `.claude` from `forks/ruflo/v3/@claude-flow/cli/package.json` `files:` array (line 80-83). Either alone is insufficient.
5. **E5 — Strengthen DA refutation.** Decision Consequences amended to call out that npm install is online by definition; bundled-static deletion does not impact post-install offline regeneration because generator code lives in `dist/` (in the tarball).

### Decision text amendments (folded in same commit)

Apply two narrow amendments to the body above:

- **Decision §3 sentence** "Also extend [[ADR-0143]]'s Pass 7 path scope to include `.claude-plugin/**/*.{json,sh}` so future drift is caught at the rebrand layer" → REPLACE WITH: "Also extend [[ADR-0143]]'s Pass 7 *extension* allowlist to include `.sh` (currently `.{md,json}` only, per ADR-0143 line 60). The brand-string drift itself is out of Pass 7's regex scope (Pass 7 rewrites `@sparkleideas/cli` package refs, not `name: "claude-flow"` brand strings), so the `umbrella-plugin-brand.test.mjs` lint is the durable gate; the Pass 7 extension is a defense-in-depth lint widening for future `.sh` rebrand needs."
- **Decision Consequences** — append one bullet: "Neutral, because bundled-static deletion does not impact post-install offline behaviour: `npm install` requires network by definition, and the generator code (`dist/init/helpers-generator.js`) ships in the same tarball as the bundled static did, so all 8 generator-covered helpers regenerate offline after install."
