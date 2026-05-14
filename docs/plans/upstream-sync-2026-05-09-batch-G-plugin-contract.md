# Batch G — ADR-0001 Plugin Contract Bundle (30 commits) — agent analysis (2026-05-09)

Source: ADR-0162 Batch G. Produced by general-purpose research agent against `forks/ruflo` `main`. READ-ONLY analysis.

## Deep dive on 3 representative commits

What "adopt plugin contract" means in code is **purely additive metadata + a structural smoke test**. None of the 3 commits change executable code, hooks, or the MCP surface. The pattern across all 3 (and consistent with the 27 others by commit-message shape):

| Element | What changes |
|---|---|
| `plugin.json` | `version` bumps to `0.2.0` (intelligence/agentdb to `0.3.0`); description elaborated; 3-5 keywords appended |
| `README.md` | New sections appended: Compatibility (pin to `@claude-flow/cli v3.6`), Namespace coordination, Verification, Architecture Decisions — all docs |
| `docs/adrs/0001-*.md` | New file (50-100 lines), status `Proposed` |
| `scripts/smoke.sh` | New file (~90 lines, structural-only checks: greps for keywords, frontmatter presence, no wildcard tools) |

**`bd384ad5e` (ruflo-core):** 4 files / +251/-5. Foundation contract — claims to register 300+ tools across 11 families, but actually changes zero registration code. Smoke checks are static greps.

**`df49b5176` (ruflo-adr):** 4 files / +218/-6. Same shape. Commit message confirms "Plugin behavior is unchanged (3 skills + 7 subcommand dispatcher remain intact)." Does NOT touch the two SKILL.md files we have locally pending.

**`714f501f7` (ruflo-swarm):** 4 files / +213/-3. Documents a "12-tool MCP surface" — but 0 tool registration changes. README adds the surface table; smoke greps for the tool names as strings.

**Verdict:** the contract is metadata-only. No hooks file, no MCP surface change, no plugin loader change, no settings.json. Crucially, the upstream commits use `@claude-flow/cli` as the pin and `mcp__claude-flow__*` namespaces — not our sparkling brand or `mcp__ruflo__*`.

## Version-conflict survey (5 plugins)

| Plugin | Fork version | Upstream sets | Delta |
|---|---|---|---|
| ruflo-core  | 0.1.0  | 0.2.0 | minor bump |
| ruflo-adr   | 0.1.14 | 0.2.0 | 13 patches behind upstream's base |
| ruflo-swarm | 0.1.0  | 0.2.0 | minor bump |
| ruflo-rvf   | 0.1.0  | 0.2.0 | minor bump |
| ruflo-sparc | 0.1.0  | 0.2.0 | minor bump |

Pipeline auto-bump operates on **package** versions (`2.7.47-patch.527`), not on `plugin.json` `version` field — confirmed by `git log -- plugins/ruflo-adr/.claude-plugin/plugin.json` showing the file has *not* been touched recently by the pipeline. So conflicts are localised to the version+keywords lines, not a moving target.

## Local pending-work collision

`git status plugins/ruflo-adr/` shows 2 modified SKILL.md files. `git show --stat df49b5176 -- plugins/ruflo-adr/skills/...` returns **no output** — upstream's `df49b5176` does **not** touch any SKILL.md. **Zero collision.** Our local refactor is to canonical MADR 4.x format + `mcp__ruflo__*` namespace; upstream is editing plugin.json/README/new files only.

## Bundle integrity & ordering

Verified against `upstream/main` log: the 30 commits appear consecutively at lines 107-136 (with `b5b6fb3fb` ruflo-browser at 138 separated by 2 unrelated commits). They sit **above** ADR-0001 cadence work (ADR-098 etc.) we already integrated. They are sequential per-plugin commits — no commit depends on another in the bundle for code (each touches only its own plugin tree). They cross-reference each other only in *prose* ("defers to ruflo-agentdb ADR-0001 §Namespace convention") — broken cross-refs become smoke-test failures, not runtime breakage. Self-contained per plugin.

## DECISION: DEFER

Reasoning chain:

1. **The contract is documentation, not capability.** No MCP wiring, no hooks, no plugin-loader change, no executable code. Per `feedback-no-value-judgements-on-features` the bias is to WIRE — but there is no capability here to wire. The smoke scripts grep for strings; the ADRs are status `Proposed`; the READMEs are reference text. Cherry-picking gains us static-greppable smoke files and metadata that *contradicts our brand* — namespace `mcp__claude-flow__*` and CLI pin `@claude-flow/cli`.
2. **Brand inversion cost > benefit.** Per ADR-0143 our user-facing surface is `@sparkleideas/ruflo`. The bundle hardcodes `@claude-flow/cli v3.6` pins and `mcp__claude-flow__*` namespaces in 30 plugins' READMEs / smoke / ADRs. Picking would force a per-plugin codemod pass to invert every one — work disproportionate to the 0 capability gain.
3. **30× plugin.json conflicts are individually trivial but bundle-wide noisy.** Each plugin.json conflict is a 3-way merge between fork 0.1.x, upstream 0.2.0, and our pipeline's downstream concerns. None blocks; together they are 30 places to be careful for documentation.
4. **Local ADR work conflicts in spirit, not file.** We just did a canonical-MADR refactor of `ruflo-adr` SKILLs locally. Upstream's `df49b5176` adds a status=Proposed self-referential ADR-0001 file with prose claims ("Plugin behavior is unchanged") that don't reflect our refactor's reality.
5. **Re-evaluation triggers:**
   - (a) Upstream promotes any contract from documentation to executable (smoke gates publishing, hooks file is added, plugin-loader validates ADR presence).
   - (b) We rebrand back to `@claude-flow/cli` (won't happen — see ADR-0143).
   - (c) We need `scripts/smoke.sh` per plugin for our own pipeline gating — at which point we author them ourselves to test our actual surface, not import 30 upstream greps.
   - (d) An ADR in this bundle is promoted from Proposed → Accepted upstream and starts being referenced normatively elsewhere.

**1-sentence ADR-0162 follow-up note:** "Batch G (30-commit ADR-0001 plugin contract) deferred — content is doc-only metadata hardcoding upstream brand (`@claude-flow/cli`, `mcp__claude-flow__*`) at 30 sites; re-evaluate if the contract becomes executable (loader/hook validation) or if we need plugin-level smoke gates in our pipeline (in which case we author them against our actual sparkling surface)."

## Files referenced

- `/Users/henrik/source/forks/ruflo/plugins/ruflo-adr/.claude-plugin/plugin.json`
- `/Users/henrik/source/forks/ruflo/plugins/ruflo-adr/skills/adr-create/SKILL.md` (locally modified — safe)
- `/Users/henrik/source/forks/ruflo/plugins/ruflo-adr/skills/adr-index/SKILL.md` (locally modified — safe)
- `/Users/henrik/source/forks/ruflo/plugins/ruflo-core/.claude-plugin/plugin.json`
- `/Users/henrik/source/forks/ruflo/plugins/ruflo-swarm/.claude-plugin/plugin.json`
