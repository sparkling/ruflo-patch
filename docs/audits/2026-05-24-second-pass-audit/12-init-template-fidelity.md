# Audit 12 — Init-template fidelity (every emitted file)

Parent ADR: /Users/henrik/source/ruflo-patch/docs/adr/ADR-0201-codebase-soundness-completeness-audit-with-runtime-validation.md
Predecessor (2026-05-19): 11-init-mcp-installation.md
Slice: every file `ruflo init` writes — sandbox runtime verification
Mode: read-only static + sandboxed runtime
Date: 2026-05-24

## Methodology

1. Located template emitters in `forks/ruflo/v3/@claude-flow/cli/src/init/`:
   - `executor.ts` (orchestrator, copy-vs-generate dispatcher)
   - `settings-generator.ts` (`.claude/settings.json`)
   - `mcp-generator.ts` (`.mcp.json`)
   - `claudemd-generator.ts` (`CLAUDE.md`)
   - `helpers-generator.ts` (`hook-handler.mjs`, `auto-memory-hook.mjs`, etc.)
   - `config-template.ts` / `statusline-generator.ts` / `embedding-models.ts`
2. Ran fresh `npx -y @sparkleideas/ruflo@latest init` in `/tmp/ruflo-audit-init-12972` and `/tmp/ruflo-audit-init-clean-38989` (clean cache, two passes).
3. Cataloged emitted artefacts: `.claude/`, `.claude-flow/`, `.mcp.json`, `CLAUDE.md`.
4. For each emitted artefact, evaluated declared-vs-wired capabilities, brand consistency (`reference-user-facing-brand`, `feedback-always-npx-for-ruflo`), env-var canonicality (ADR-0214), MCP server soundness (ADR-0117 / ADR-0213).

## Summary

* **Emitted file count (clean init):** 250 (109 unique generated + 141 copied templates; init banner reports "12 directories, 109 files").
* **Top-level breakdown:** `.claude/agents/` (17 md+yaml), `.claude/commands/` (150 md across 13 dirs + 5 top-level), `.claude/skills/` (30 SKILL.md), `.claude/helpers/` (41 files), `.claude/scripts/` (1), `.claude-flow/` (8 stub files), plus `CLAUDE.md` + `.mcp.json` at root.
* **Files with fidelity issues found:** 38 (1 critical regression vs ADR-0211 "implemented" status; 6 medium drift issues; 31 helper templates that ship but are never wired by `settings.json`).
* **Findings: 8 (1 high / 3 medium / 4 low).** Plus 1 cross-cutting pattern.
* **ADR cross-references verified:** ADR-0211 (regression — see F-12-001), ADR-0214 (partial — see F-12-002), ADR-0117/ADR-0213 (sound, see "Sound surfaces"), ADR-0143 brand (mostly aligned, see F-12-003).

The most material discovery: **ADR-0211 (status: implemented 2026-05-22) is invisible at runtime** because the published wrapper's static `.claude/helpers/hook-handler.mjs` is preferred over the regenerated version by `executor.ts:findSourceHelpersDir`. The F-02 defect from the May-19 audit is therefore still live in published output (verified against `@sparkleideas/ruflo@latest` = wrapper `3.1.0-alpha.14-patch.274` pinning cli `3.7.0-alpha.10-patch.298`).

## Sandbox runtime artefacts

* `/tmp/ruflo-audit-init-12972/` (first pass)
* `/tmp/ruflo-audit-init-clean-38989/` (second pass, clean cache reverification)

Both passes produced byte-identical `.claude/helpers/hook-handler.mjs` content (8 handlers, not 14). Both passes deferred to the wrapper's bundled static file.

## Findings

### F-12-001 [HIGH] ADR-0211 implemented in source but invisible at runtime — copy-first defeats the regeneration path

* **Files:**
  * /Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/init/executor.ts (function `findSourceHelpersDir` + the "Try to copy existing helpers from source first" block)
  * /Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/init/helpers-generator.ts:570-655 (14 handler keys — the post-ADR-0211 source)
  * Wrapper static asset: `@sparkleideas/cli/.claude/helpers/hook-handler.mjs` (only 8 handlers — pre-ADR-0211)
  * Runtime evidence: `/tmp/ruflo-audit-init-12972/.claude/helpers/hook-handler.mjs` (matches wrapper static, NOT helpers-generator.js output)
* **Symptom:**
  * `.claude/settings.json` wires **13 distinct subcommands** (`route`, `pre-bash`, `pre-edit`, `pre-task`, `post-edit`, `post-task`, `post-command`, `session-restore`, `session-end`, `compact-manual`, `compact-auto`, `status`, `notify`).
  * The emitted `.claude/helpers/hook-handler.mjs` declares **only 8** (`route`, `pre-bash`, `post-edit`, `post-task`, `pre-task`, `session-restore`, `session-end`, `stats`).
  * 5 wired subcommands (`pre-edit`, `post-command`, `compact-manual`, `compact-auto`, `status`, `notify`) silently fall through to `[OK] Hook: <name>` and exit 0 — no router/session/intelligence side effects. Confirmed at runtime: `echo '{}' | node .claude/helpers/hook-handler.mjs pre-edit` → `[OK] Hook: pre-edit` (no real check). Identical behaviour for `post-command`, `compact-manual`, `status`, `notify`.
* **Why this matters:** the May-19 audit's `F-02-008` (hook handler missing subcommands) was the load-bearing defect ADR-0211 was written to fix. The fix landed in `helpers-generator.ts` (the regeneration path) on 2026-05-23 (commit `e4077b10f`). But `executor.ts` prefers a copied helper file over regeneration when `findSourceHelpersDir()` resolves to a directory containing `hook-handler.mjs` — and `@sparkleideas/cli` ships a static `.claude/helpers/hook-handler.mjs` at the package root, so the copy path always wins. The regenerated version is dead code in published builds. **ADR-0211's "implemented" status is therefore misleading for any user who installs via npx.**
* **Bridge to ADR-0215's spirit (codemod golden-master):** this is the init-template equivalent of the codemod golden-master gap that ADR-0215 closed — the build pipeline ships a static asset that diverges from its supposed source-of-truth without any drift gate.
* **Suggestion:**
  * (a) Add a build-time check that the static `.claude/helpers/hook-handler.mjs` shipped in the wrapper matches the output of `generateHookHandler()` from `helpers-generator.ts` — fail the release if they diverge.
  * (b) OR remove the static asset from the wrapper and force the regeneration path, then add a golden-master test that asserts ADR-0211's chosen 14 handlers are present.
  * (c) ADR-0211's "Confirmation #1" already prescribes a build-time subset test asserting `settings-generator.ts` subcommands are a strict subset of `helpers-generator.ts` handler keys — verify whether that test exists and runs against the **published artefact**, not the source.

### F-12-002 [MEDIUM] ADR-0214 partially shipped — `.mcp.json` renamed but `.claude/settings.json` still emits theatrical/non-canonical names

* **Files:**
  * /Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/init/mcp-generator.ts (renames LANDED — `CLAUDE_FLOW_SWARM_TOPOLOGY` / `CLAUDE_FLOW_MEMORY_TYPE` per the rename half)
  * /Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/init/settings-generator.ts (still emits stale `claudeFlow.memory.agentdb.primaryStorage:"pglite"`)
  * Emitted: `/tmp/ruflo-audit-init-clean-38989/.mcp.json` and `.claude/settings.json`
* **Symptoms:**
  * `.mcp.json` `env` block now contains only `npm_config_update_notifier`, `CLAUDE_FLOW_MAX_AGENTS`, `CLAUDE_FLOW_SWARM_TOPOLOGY`, `CLAUDE_FLOW_MEMORY_TYPE` — the theatrical `MODE`, `HOOKS_ENABLED`, `TOPOLOGY`, `MEMORY_BACKEND` are removed (ADR-0214 step 1+2 ✔). However the names retain the `CLAUDE_FLOW_` prefix — ADR-0214 prescribes alignment to the loader's reader names which are bare `SWARM_TOPOLOGY` / `MEMORY_TYPE`. Either the rename is incomplete or ADR-0214's "implemented" status anticipated the prefix-retaining variant.
  * `.claude/settings.json` `claudeFlow.memory.agentdb.primaryStorage: "pglite"` is stale per memory `[[project-adr0170-superseded-phase-d-trap]]` — pglite was reverted; SQLite is the substrate. Documenting `pglite` here is the same "theatrical config" anti-pattern ADR-0214 condemns: a value the system does not act on.
  * No `claude-flow.config.json` env-binding surface — `.claude-flow/config.json` (line 14+: `embedding.model=Xenova/all-mpnet-base-v2`, `embedding.dimension=768`) is correctly aligned to `[[reference-embedding-model]]`. ✔
* **Suggestion:** decide whether ADR-0214's "canonical reader name" is `SWARM_TOPOLOGY` or `CLAUDE_FLOW_SWARM_TOPOLOGY` and align both writers; remove the `primaryStorage:"pglite"` line from `settings-generator.ts` (or replace with `"sqlite"` per the post-revert truth) — ADR-0177 supersedes ADR-0170 and forbids referencing pglite as the substrate.

### F-12-003 [MEDIUM] `auto-memory-hook.mjs sync` subcommand wired by Stop hook is unimplemented

* **Files:**
  * /Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/init/settings-generator.ts (Stop hook block invokes `auto-memory-hook.mjs sync`)
  * Emitted: `/tmp/ruflo-audit-init-12972/.claude/settings.json` line 121 (Stop) — `node .claude/helpers/auto-memory-hook.mjs sync`
  * Emitted runtime: `/tmp/ruflo-audit-init-12972/.claude/helpers/auto-memory-hook.mjs:359-364` — switch only handles `import` and `status`; `default` branch prints `Usage: auto-memory-hook.mjs <import|status>` and exits 0.
  * Source (`forks/ruflo/v3/@claude-flow/cli/src/init/helpers-generator.ts:1060-1063`) **DOES** have a `case 'sync': await doSync(); break;` — but this is again the regeneration path, not the wrapper's bundled static file.
* **Symptom:** every Stop event silently produces a stderr usage hint and triggers no memory sync. Same shape as F-12-001 — settings.json declares a capability the static helper file does not provide, despite the source being correct.
* **Severity:** Medium — the Stop hook is the canonical session-end memory persist trigger, so this silently breaks cross-session memory continuity for any user installing via npx.
* **Suggestion:** subsumed by F-12-001's fix — drift gate between source helpers and the wrapper's static assets.

### F-12-004 [MEDIUM] 38 of 41 emitted helpers are orphaned templates (never wired in `settings.json`)

* **Files:** all of `/tmp/ruflo-audit-init-12972/.claude/helpers/*` except the 3 referenced: `hook-handler.mjs`, `auto-memory-hook.mjs`, `statusline.cjs`.
* **Symptom:** init writes 41 helper files into every user project. `grep -oE '\.claude/helpers/[a-zA-Z._-]+' .claude/settings.json | sort -u` returns only 3 paths. The 38 orphans include:
  * **Fork-internal V3 dev tooling** (zero user value): `v3.sh`, `v3-quick-status.sh`, `sync-v3-metrics.sh`, `update-v3-progress.sh`, `validate-v3-config.sh` (the last one fails out-of-box: "Missing required directory: src").
  * **Unused helper modules** declared as dependencies of orphan helpers: `learning-service.mjs` (only invoked by orphan `learning-hooks.sh`), `metrics-db.mjs` (no callers), `github-safe.mjs` (no callers), `pattern-consolidator.sh`, `perf-worker.sh`, `worker-manager.sh`, `swarm-comms.sh`, `swarm-monitor.sh`, `learning-optimizer.sh`, `health-monitor.sh`, `security-scanner.sh`, `adr-compliance.sh`, `ddd-tracker.sh`, `checkpoint-manager.sh`, `standard-checkpoint-hooks.sh`, `guidance-hook.sh`, `guidance-hooks.sh`, `daemon-manager.sh`.
  * **Setup scripts users could plausibly invoke manually** (so not pure noise): `setup-mcp.sh`, `quick-start.sh`, `github-setup.sh`, `pre-commit`, `post-commit`, `statusline-hook.sh`, `statusline.js` (the *non-cjs* variant — duplicates `statusline.cjs`; see F-12-005).
* **Why this matters:** these are install-noise per `[[feedback-no-fallbacks]]`'s spirit — a hook/helper declared but never wired is the same anti-pattern as a silent fallback. Several use `npx claude-flow` (pre-rebrand) or hardcode upstream paths (see F-12-006). They occupy mental space when users grep `.claude/helpers/`.
* **Suggestion:** triage — keep only helpers settings.json wires + user-runnable utilities (`setup-mcp.sh`, `quick-start.sh`); move v3-internal scripts out of the init template entirely. If they exist for fork-developers, they belong in `forks/ruflo/scripts/`, not in user projects.

### F-12-005 [LOW] `statusline.cjs` and `statusline.js` are near-duplicates with conflicting version banners

* **Files:**
  * Emitted: `.claude/helpers/statusline.cjs` (879 lines, banner "RuFlo V3 Statusline Generator (Optimized)") — wired by settings.json
  * Emitted: `.claude/helpers/statusline.js` (321 lines, banner "RuFlo V3.5 Statusline Generator") — **never referenced** by any settings.json key, never sourced by any other helper
* **Symptom:** two implementations of the same thing ship side-by-side. The `.js` variant is dead code in shipping templates, and its "V3.5" banner contradicts the live "V3" banner. The duplication invites future skew where a fix lands in one and not the other.
* **Suggestion:** delete `statusline.js` from the template; keep only `statusline.cjs` (the wired one).

### F-12-006 [LOW] Many emitted helpers still use pre-rebrand `npx claude-flow` invocations + upstream `ruvnet/*` references

* **Files (emitted):**
  * `.claude/helpers/setup-mcp.sh:15` — `claude mcp add claude-flow npx claude-flow mcp start` (every token wrong: server-key `claude-flow` not `ruflo`; binary `claude-flow` not `@sparkleideas/ruflo@latest`; missing `-y`)
  * `.claude/helpers/github-setup.sh:25-28` — `echo "  - npx claude-flow github swarm"` (×4 stale invocations user is told to run)
  * `.claude/helpers/quick-start.sh:8-17` — `npx claude-flow swarm init`, `agent spawn`, `task orchestrate`, `swarm monitor` (×4)
  * `.claude-flow/CAPABILITIES.md` — three links to `https://github.com/ruvnet/claude-flow` (project moved per `[[reference-user-facing-brand]]`)
  * `CLAUDE.md:158` — `https://github.com/ruvnet/ruflo/blob/main/docs/USERGUIDE.md` (upstream — per `[[feedback-upstream-means-upstream]]` upstream is 395+ commits behind)
  * `.claude/agents/`, `.claude/commands/`, `.claude/skills/` — **623 lines** across these subtrees contain `npx claude-flow@v3alpha` invocations (sample: `.claude/agents/core/planner.md`'s 5+ memory/hook calls).
* **Symptom:** the rebrand to `@sparkleideas/ruflo` (ADR-0143) is incomplete across copied template content. Users see `claude-flow` in multiple places where they should see `ruflo`.
* **Suggestion:** add the templates to the codemod's brand-flip pass (ADR-0215's golden-master test should also assert no `claude-flow` strings remain in copied templates outside intentionally-named slash-command files — see F-12-007).

### F-12-007 [LOW] Three `claude-flow-*` slash commands keep the pre-rebrand brand

* **Files (emitted):** `.claude/commands/claude-flow-help.md`, `.claude/commands/claude-flow-memory.md`, `.claude/commands/claude-flow-swarm.md` — these define `/claude-flow-help`, `/claude-flow-memory`, `/claude-flow-swarm` slash commands.
* **Symptom:** filename `claude-flow-help.md` produces user-typed slash command `/claude-flow-help`. Per `[[reference-user-facing-brand]]` the user-facing brand is `ruflo`, so these should be `/ruflo-help`, `/ruflo-memory`, `/ruflo-swarm` — or removed if the `ruflo` MCP server's tools already cover the surface (which they do via `mcp__ruflo__memory_*` etc.).
* **Severity:** Low — Claude Code slash commands are namespaced separately from MCP tool names; the `claude-flow-*` slash commands don't strictly collide. But the brand inconsistency leaks.

### F-12-008 [LOW] `setup-mcp.sh` is fundamentally wrong but ships to every user

* **Files:** `.claude/helpers/setup-mcp.sh` (15 lines)
* **Symptom:** the script's stated purpose is "Setup MCP server for Claude Flow" — a manual fallback for users whose init `.mcp.json` write somehow failed. The actual command it runs is `claude mcp add claude-flow npx claude-flow mcp start` — exactly the failure mode `[[feedback-always-npx-for-ruflo]]` warns against (no `@latest`, wrong server key, wrong binary). If a user runs this they end up with a registered MCP server that resolves stale `npm` cache *and* under the wrong key (`claude-flow` instead of `ruflo`), invalidating every `mcp__ruflo__*` tool reference everywhere else in this template.
* **Suggestion:** either fix the command to `claude mcp add ruflo -- npx -y @sparkleideas/ruflo@latest mcp start` (per `CLAUDE.md:162` in the same emitted template, which has the correct form) or delete the script entirely. The latter is cleaner — it duplicates `.mcp.json` registration.

## Cross-cutting pattern (generalising the per-file findings)

**The init template ships a static asset surface that is not gated by tests against the source-of-truth generators.** F-12-001 (hook-handler.mjs) and F-12-003 (auto-memory-hook.mjs sync) are the same defect class: the build pipeline (a) compiles `helpers-generator.ts` to `helpers-generator.js` AND (b) bundles static `.claude/helpers/*.mjs` files into the published wrapper. At runtime, `executor.ts:findSourceHelpersDir` prefers (b) over (a). When ADRs land in (a), they're invisible.

The pattern matches ADR-0215's findings for the codemod (golden-master gap), but for the init-template surface. The remediation pattern is the same: **a build-time test asserting parity between the source-of-truth generator output and the published static asset**. Without it, every future ADR touching helper handlers, hook commands, or settings.json wiring risks the same "implemented in source, invisible at runtime" failure mode.

A companion gap: **the published wrapper's bundled `.claude/helpers/` is older than the cli it pins.** Wrapper version `3.1.0-alpha.14-patch.274` predates ADR-0211's 2026-05-22 implementation, but the wrapper pins cli `3.7.0-alpha.10-patch.298` (which DOES contain the new generator). The wrapper bump cadence missed this update. This makes F-12-001's regression a release-cadence issue too, not just a static-asset issue: even if the wrapper rebuilds its helpers from the cli's generator, an old wrapper publish freezes the user-facing helpers.

## Sound surfaces verified

* **`.mcp.json` server registration:** byte-for-byte matches ADR-0117 / ADR-0213 expected format. `ruflo` server key correct; binary `@sparkleideas/ruflo@latest` correct; `npx -y` correct per `[[feedback-always-npx-for-ruflo]]`. (F-11-001's manual-setup-hint divergence from May-19 not reverified — `generateMCPCommands()` exists but is not called by `executor.ts`, so it's not in the per-file scope.)
* **`CLAUDE.md` top-level brand:** the project rebranding to `ruflo` has landed in CLAUDE.md proper — `ruflo skill list`, `ruflo plugins --help`, `mcp__ruflo__*`, marketplace path `sparkling/ruflo` (May-19 F-11-004 partially fixed). The "Next steps" text in init output also now says `ruflo daemon start` etc. (May-19 F-11-005 fixed).
* **`.claude-flow/config.json`:** embedding model + dimension + HNSW params align with `[[reference-embedding-model]]` (`Xenova/all-mpnet-base-v2`, 768, M=23/efC=100/efS=50). ✔
* **`.claude/skills/` count:** 30 skills emitted vs init banner "30 skills" — match. (Skills v3-* are fork-internal dev tracking, similar concern shape to F-12-004's v3-internal scripts — flagged at the meta level, no individual finding.)
* **`.claude/agents/` count:** 17 emitted vs banner "17 agents" — match. (But `.claude-flow/CAPABILITIES.md` advertises "60+ agents" — drift between marketing doc and what init actually emits; cosmetic only.)
* **`.claude/scripts/check-patches.sh`:** invoked from SessionStart, advisory-only, exits 0 regardless. Correctly wired.
* **`auto-memory-hook.mjs import`** (the SessionStart variant — not `sync`): runs, imports 0 entries cleanly. ✔

## Out-of-scope

* `generateMCPCommands()` manual-setup hint (May-19 F-11-001) — exists in source, not called by `executor.ts`. Not emitted to user surface, so out of this slice's per-file scope. Still flagged as a comment in F-12-004 (similar dead-code shape as the orphan helpers).
* Hook router internals (`router.js`, `intelligence.cjs`, `session.js`, `memory.js`) — these are the helpers `hook-handler.mjs` `safeImport`s. Their internal correctness was audited by May-19 slices 01-03; this slice only verifies the dispatcher contract.
* SG-003 / ADR-0202 hook-lock interactions — covered by May-19 slices 12-13 + the running ADR-0202/ADR-0207 work.
* Agent / command / skill **content** quality (vs the brand-pollution count surfaced in F-12-006). The 623 `npx claude-flow` lines are flagged but their behavioural correctness isn't audited here.
* `forks/ruflo/plugins/ruflo-*` plugin templates — flagged at G-16-002 in the May-19 gap analysis, not in this slice.
* `.mcp.json` `--start-all` / `--with-marketplace` flag paths — not exercised by the default-init runtime probe.
* Upstream-divergent settings keys (e.g. `agentTeams`, `claudeFlow.daemon.workers`) — soundness as a config schema is config-soundness slice 14's territory.

## Sandbox cleanup

```bash
rm -rf /tmp/ruflo-audit-init-*
```
