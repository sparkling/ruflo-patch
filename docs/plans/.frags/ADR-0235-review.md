## ADR-0235 — CT-B: init-template golden-master or regenerate

**Status**: proposed (post-swarm-review)
**Swarm**: 5 experts + devil's advocate, Quorum-majority consensus (5/5 agree on shape; DA holds principled-but-narrow dissent on aggressiveness)
**Triage rank**: 3 (gates [[ADR-0211]]'s real implementation reaching npx users; gates [[ADR-0143]]'s brand reaching the umbrella manifest)

### Decision (post-swarm-review)

Apply the as-drafted **Option B (bundled-static deletion via `git rm` + `files:` trim) + Option D (preference inversion in `writeHelpers`) + content-invariant lint for F-07-003 (umbrella brand)** with five panel-adopted clarifications: (1) enumerate the 8 generator-covered names + the 3 currently-overlapping; (2) use `node --test` + `walkMd` pattern for both new tests per [[ADR-0215]] precedent; (3) the umbrella-brand fix is a NET-NEW lint, not a "Pass 7 path-scope extension" (Pass 7's regex doesn't cover brand strings); (4) bundled-static deletion is a two-part action (git removal + `files:` trim); (5) DA's "first-time offline install" framing is unfounded — `npm install` is online by definition, generator code is in `dist/`. DA holds principled dissent on remedy aggressiveness ("always regenerate" vs preference-inversion) — captured as the conservative-fallback inverse but not adopted as the chosen remedy.

### Implementation steps

1. **Preference-inversion in `writeHelpers`** (`forks/ruflo/v3/@claude-flow/cli/src/init/executor.ts:1184-1232`). The 8 names the generator dispatch produces: `pre-commit`, `post-commit`, `session.js`, `router.js`, `memory.js`, `hook-handler.mjs`, `intelligence.cjs`, `auto-memory-hook.mjs` (from `executor.ts:1234-1243`). Currently-known overlaps with bundled static: `hook-handler.mjs`, `intelligence.cjs`, `auto-memory-hook.mjs` (the 3). Verify the 5-vs-3 split at implementation time per ADR Decision §3 Pre-flight Check 3. Refactor seeds `result.created.files` from generators first, then skips those names in the copy loop. Maintain the upstream `findSourceHelpersDir` Strategy-1-through-4 walk for bundled-only filenames (the 33 orphans path, in case the conservative fallback is chosen).

2. **Bundled-static deletion (two-part action)** for the unconditional-Option-B path:
   - `git rm -r forks/ruflo/v3/@claude-flow/cli/.claude/helpers/` (removes all 41 bundled helpers; the 8 generator-covered overlap with regeneration, the 33 orphans triage with F-12-004 per Decision §2).
   - Drop `.claude` from `forks/ruflo/v3/@claude-flow/cli/package.json` `files:` array (line 80-83). Without BOTH steps, the directory either survives in git (re-added on `git add .`) or in published tarballs (`.claude` still listed).
   - If conservative fallback is chosen instead: keep `.claude` in `files:`, delete only the 3 overlap files (`hook-handler.mjs`, `intelligence.cjs`, `auto-memory-hook.mjs`), retain the 33 orphans (defers F-12-004).

3. **Build-time parity test** at `ruflo-patch/tests/pipeline/init-helpers-parity.test.mjs` using `node --test` (not vitest, per [[ADR-0215]] `skill-shell-integrity.test.mjs` placement). Walks the fork tree via the `walkMd`/`upstream.ruflo.dir` pattern from `marketplace-manifest.test.mjs`. For each name that exists in both the bundled static directory AND the generator dispatch, assert byte-equality. Fails loud on any drift. No `UPDATE_GOLDEN`-style operator-accept path. The test is meaningful only on the conservative-fallback path (where bundled static still exists); on the unconditional-deletion path, the test becomes trivially-vacuously-true and may be replaced with a different gate (the tarball-content lint per step 6).

4. **F-07-003 umbrella plugin.json brand fix** at `forks/ruflo/.claude-plugin/plugin.json:2-9`. Replace `"name": "claude-flow"` → `"name": "ruflo"`; `"version": "2.5.0"` → `"0.0.0"` placeholder (or coordinate with wrapper-version cadence per [[project-ruflo-wrapper-latest-regression]]); `"name": "rUv"` → `"Henrik Pettersen"` (or `"ruvnet"`); `homepage` and `repository.url` → `sparkling/ruflo` per [[reference-user-facing-brand]]. Hand-edit; the brand strings are out of Pass 7's regex scope (Pass 7 rewrites `@sparkleideas/cli`, not `claude-flow` brand strings) — corrected per Swarm review E3.

5. **F-07-003 install.sh disposition** at `forks/ruflo/.claude-plugin/scripts/install.sh:138-179`. **Preferred: delete the script entirely** — under [[ADR-0117]] §Revision 2026-05-03 service-method install, `.mcp.json` registration is the only supported path and install.sh's MCP-add is a contradicting parallel bootstrap. If retention is required (any external doc references it), rewrite the MCP-add line to `claude mcp add ruflo -- npx -y @sparkleideas/ruflo@latest mcp start` per [[feedback-always-npx-for-ruflo]]. Either path: also grep `docs/USERGUIDE.md` and `README.md` for `install.sh` references and update or remove.

6. **Content-invariant lints** at `ruflo-patch/tests/pipeline/umbrella-plugin-brand.test.mjs` (`node --test`, `walkMd` pattern, same harness as step 3). Scan `forks/ruflo/.claude-plugin/**/*.{json,sh}` for forbidden strings: `"name": "claude-flow"`, `"version": "2.5.0"`, `"name": "rUv"`, `npx claude-flow@alpha`, `mcp add claude-flow ` (trailing space). Fail loud on any hit. Pair with a one-liner tarball-content lint that runs `npm pack` then asserts `tar -tf … | grep -c '.claude/helpers/'` returns 0 on the unconditional-deletion path (or matches the conservative-fallback count).

7. **Pass 7 extension-allowlist widening** at `scripts/codemod.mjs`. Currently Pass 7 path scope predicate matches `.{md,json}`; widen to `.{md,json,sh}` to catch future `.sh`-located `@sparkleideas/cli` references (defense-in-depth; the install.sh rewrite is the primary fix). Add regression test asserting a deliberately-inserted `@sparkleideas/cli` reference in `.claude-plugin/scripts/install.sh` is flipped to `@sparkleideas/ruflo` by `transformSource()`. (Per Swarm review E3 — this is the corrected interpretation; the brand strings themselves remain out of Pass 7's regex scope, so the umbrella-brand lint at step 6 is the durable gate for those.)

8. **INTEGRATION-LEDGER rows** for the two fork-side fixes per [[feedback-update-integration-ledger]]:
   - Bundled-static removal: `superseded-by-local` disposition citing upstream `ruvnet/ruflo/v3/@claude-flow/cli/.claude/helpers/` (same byte-identical defect class present upstream — different sentinel `.cjs` vs `.mjs`, identical preference order).
   - Umbrella brand rebrand: `superseded-by-local` citing upstream `ruvnet/ruflo/.claude-plugin/plugin.json` (byte-identical for brand strings; upstream-by-design for `claude-flow` brand; ADR-0143 explicitly diverged).

### Dependencies

- [[ADR-0211]] — its source-side fix (14 handlers + fail-loud + `feedback(success)`) only reaches npx users once this ADR's bundled-static drift is closed. Without ADR-0235, ADR-0211 is "implemented in source, invisible at runtime" per F-12-001.
- [[ADR-0143]] — F-07-003 brand fix coordinates with codemod Pass 7. Pass 7 path scope already covers `.claude-plugin/**/*.{md,json}` (line 60) — the umbrella brand miss is at the regex layer (brand strings out of scope), not the path layer. Pass 7 extension allowlist widening (`.{md,json}` → `.{md,json,sh}`) is defense-in-depth for future `.sh`-located package refs.
- [[ADR-0215]] — model for the parity-test-as-invariant + content-invariant lint approach. Same harness choice (`node --test`), same file-walk pattern (`walkMd`), same fail-loud-no-operator-accept discipline.
- [[ADR-0210]] — stub-honesty mandate. Option B's bundled-static deletion is a direct application: keep what works (generators), document-or-remove what doesn't (33 orphans).
- [[ADR-0117]] §Revision 2026-05-03 — service-method install pattern. install.sh's `claude-flow` MCP key contradicts this (it writes a parallel bootstrap config). Preferred fix (delete install.sh) is ADR-0117-aligned.
- [[ADR-0117]] for marketplace MCP server registration under `ruflo` key — same identity the 32 wrapper plugins depend on.
- [[ADR-0233]] §CT-B — defect-class origin citing F-12-001 (HIGH), F-12-003 (MEDIUM), F-07-003 (CRITICAL).
- [[ADR-0201]] — Remediation-ADR pre-flight checklist cleared for this draft (all four checks pass per ADR §Pre-flight verification).

### Validation

- **Build-time parity test**: `ruflo-patch/tests/pipeline/init-helpers-parity.test.mjs` exists, runs under `node --test`, asserts byte-equality between each generator output and any same-name file in `forks/ruflo/v3/@claude-flow/cli/.claude/helpers/`. Fails today (bundled `hook-handler.mjs` has 8 keys, generator emits 14). After source-bundle alignment, passes.
- **Tarball-content lint**: `tar -tf $(npm pack @sparkleideas/cli@latest 2>/dev/null | tail -1) | grep -c '.claude/helpers/'` returns 0 (unconditional path) or 33 (conservative fallback — orphans retained). Pair with the parity test gate.
- **Runtime hook-handler verification**: `echo '{}' | node .claude/helpers/hook-handler.mjs pre-edit` in fresh `npx -y @sparkleideas/ruflo@latest init` sandbox runs the real `pre-edit` handler (returns FS check result, exit 0). Pre-fix this prints `[OK] Hook: pre-edit` (bundled static's old fallthrough).
- **`auto-memory-hook.mjs sync` verification**: `node .claude/helpers/auto-memory-hook.mjs sync` runs the real sync (`case 'sync': await doSync(); break;`), not the bundled static's `default` branch usage hint.
- **F-07-003 lint**: `ruflo-patch/tests/pipeline/umbrella-plugin-brand.test.mjs` fails on current tree (umbrella plugin.json + install.sh); passes after the source fix.
- **F-07-003 file content**: `forks/ruflo/.claude-plugin/plugin.json` reads `"name": "ruflo"` (canonical brand per [[reference-user-facing-brand]]); author is `Henrik Pettersen` or `ruvnet`; homepage points at the fork's repo. `install.sh` either deleted OR uses the canonical service-method MCP-add line.
- **Pass 7 regression test**: deliberately-inserted `@sparkleideas/cli` in `.claude-plugin/scripts/install.sh` is flipped to `@sparkleideas/ruflo` by `transformSource()`.
- **No regression**: `adr0211` acceptance group still passes (preference inversion makes generator and bundled identical, so user-facing behaviour matches generator).
- **No `skip_accepted`** per [[feedback-skip-accepted-as-squelch]] on either of the two new gates.

### Top risk + mitigation

- **Risk**: Bundled-static deletion (Option B) breaks a user workflow that depended on an orphan helper (e.g., `setup-mcp.sh`, `quick-start.sh`). F-12-004 classifies most orphans as dead code (fork-internal v3 dev tooling) or broken (`setup-mcp.sh` is wrong per F-12-008), so risk is low — but unverified per-file at decision time. Same pre-flight #1 trap shape that flipped ADRs 0207/0208/0209 ("signal reaches audience"): we *think* the orphans aren't reaching anyone, but absence-of-evidence is not evidence-of-absence.
- **Mitigation**: Conservative fallback is explicitly documented in ADR Decision §2: retain the 33 orphans, delete only the 3 generator-overlapping bundled statics. This unblocks F-12-001 / F-12-003 while deferring F-12-004's triage. The unconditional-deletion path remains the preferred end-state but is reversible by re-adding `.claude` to `files:` if a user-impact signal arrives post-release.
- **Secondary risk**: The umbrella-brand fix requires picking a canonical version triple for the umbrella plugin.json. The project lacks a single source-of-truth for the umbrella's identity (the wrapper-version cadence is brittle per [[project-ruflo-wrapper-latest-regression]]).
- **Mitigation**: Pin a `0.0.0` placeholder version until a wrapper-version-aware build step takes over (cross-bonus with future build-pipeline work).
