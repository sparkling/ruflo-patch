# 07 — Skills Audit (Static, Fork-Side)

Per ADR-0201, read-only soundness + completeness audit of skill registrations
across this repo and the `forks/ruflo/` tree (excluding upstream `ruvnet/*`
and user-home `~/.claude/skills/`).

## Summary

- **Skill directories scanned**: 5 primary roots + 33 plugin `skills/` dirs
  + 2 v3 package subsets (40 total).
- **SKILL.md files (in scope, non-archive, non-node_modules)**: 280
  (35 + 134 + 104 v3-cli + 4 + 1 + 2 small subsets; see table).
- **Sound** (well-formed YAML, name+description present, scripts resolve):
  ~258 / 280 ≈ 92%.
- **Complete** (real-work bodies; no `echo TODO` stubs): 280 / 280 — no
  pure-stub skills observed.
- **Issues found**: 8 substantive (F-07-001…F-07-008).
- **Critical**: F-07-001 (broken script path refs in 4 `.agents/skills/`
  files) and F-07-002 (codemod-corrupted `>$dev$null` in 20
  `.agents/skills/` files) — both ship to user projects via `ruflo init`
  when those skill names enter `SKILLS_MAP`.
- **Structural risk**: 41 duplicate skill *names* across .claude/skills,
  .agents/skills, and plugins/. The fork's own `.claude/settings.json`
  acknowledges this with a `_comment_skillListingBudgetFraction` budget
  bump to 6%. Predictability of "which copy wins" is undefined.

## Skill Discovery & Registration

Skills are discovered in two parallel ways:

1. **Project `.claude/skills/`** — Claude Code auto-scans
   `<project>/.claude/skills/*/SKILL.md`. Populated by `ruflo init`'s
   `copySkills()` function
   (`forks/ruflo/v3/@claude-flow/cli/src/init/executor.ts:919-970`) from
   the `SKILLS_MAP` const at lines 37-92. Source resolution uses
   `findSourceDir('skills', sourceBaseDir)` at line 2172 — walks
   package-root, parents, then cwd-relative directories.

2. **Plugin marketplace** — `forks/ruflo/.claude-plugin/marketplace.json`
   declares 33 plugin entries. Each plugin's
   `.claude-plugin/plugin.json` registers the plugin; Claude Code then
   auto-discovers `plugins/<plugin>/skills/*/SKILL.md`. There is no
   explicit skills array in plugin.json — directory layout IS the
   registration.

**Init wiring** (`forks/ruflo/v3/@claude-flow/cli/src/init/executor.ts:227`):
when `options.components.skills === true`, `copySkills()` runs and copies
each category's named skills (e.g. `core`, `agentdb`, `github`, `v3`,
`dualMode`, `jujutsu`, `hiveMind`, `performance`, `workers`) from the
fork source root into the user project's `.claude/skills/`. The init
wizard surfaces these categories at `commands/init.ts:633-645`.

## Skills Inventory (Locations)

| Location | Skills | SKILL.md | Notes |
|----------|-------:|---------:|-------|
| `/Users/henrik/source/ruflo-patch/.claude/skills/` | 33 dirs | 33 | Project-side; rich content; tracks `forks/ruflo/.claude/skills/` |
| `/Users/henrik/source/forks/ruflo/.claude/skills/` | 39 dirs | 37 | Canonical "user-visible" skill source consumed by `copySkills()`. 2 dirs are content-only without SKILL.md (`dual-mode/` has 3 sub-`.md` files but no SKILL.md). |
| `/Users/henrik/source/forks/ruflo/.agents/skills/` | 134 dirs | 134 | Pre-generated agent prompts wrapped as skills. Naming: `agent-<role>`. NOT consumed by `copySkills()` directly (the SKILLS_MAP has no `agent-*` entries). Looks like an internal "agents as skills" experiment. |
| `/Users/henrik/source/forks/ruflo/plugin/skills/` | 39 entries | 37 | **Symlink** → `../.claude/skills/`. Same set as `.claude/skills/`; not a separate location. |
| `/Users/henrik/source/forks/ruflo/plugins/ruflo-*/skills/` (33 plugins) | varies | 104 | Plugin-scoped; auto-discovered by Claude Code via plugin manifest. |
| `/Users/henrik/source/forks/ruflo/v3/@claude-flow/codex/.agents/skills/` | 4 dirs | 4 | Codex package's pre-bundled skill subset. |
| `/Users/henrik/source/forks/ruflo/v3/@claude-flow/browser/skills/` | 1 dir | 1 | Browser package's own skill. |
| `/Users/henrik/source/forks/ruflo/ruflo/src/ruvocal/.claude/skills/` | 1 dir | 1 | Stray nested skill (sub-sub-project). |

Plugin breakdown (top of 33 plugins):

| Plugin | Skills |
|--------|-------:|
| ruflo-cost-tracker | 13 |
| ruflo-browser      | 9 |
| ruflo-neural-trader| 6 |
| ruflo-iot-cognitum | 5 |
| ruflo-goals        | 5 |
| ruflo-ruvector / -core / -adr | 4 |
| ruflo-sparc / -intelligence / -federation / -ddd | 3 |
| 23 plugins         | 2 each |

Out-of-scope (not audited per task constraints):

- `~/.claude/skills/` (user home).
- `forks/ruflo/archive/v2/...` (archive paths).
- `ruflo-patch/node_modules/` and any vendored mirror.

## Sample SKILL.md Soundness

Plugin skills (104 files): inspected representative ~15 (ruflo-core,
ruflo-adr, ruflo-agentdb, ruflo-knowledge-graph, ruflo-jujutsu,
ruflo-plugin-creator, ruflo-iot-cognitum, ruflo-neural-trader,
ruflo-workflows, ruflo-cost-tracker, ruflo-ruvector, ruflo-ddd,
ruflo-migrations, ruflo-browser, ruflo-core/witness).

- Frontmatter shape: `name`, `description`, `argument-hint`,
  `allowed-tools` (MCP-tool list) — clean and consistent.
- All `mcp__ruflo__*` tool refs match the canonical ruflo MCP server
  namespace (per codemod Pass 4 / ADR-0113 Fix 2).
- Script refs that resolve correctly: `plugins/ruflo-core/skills/witness/SKILL.md`
  → `plugins/ruflo-core/scripts/witness/{init,regen,verify,history,lib}.mjs`
  (all 5 present); `plugins/ruflo-plugin-creator/skills/create-plugin/SKILL.md`
  → `plugins/<name>/scripts/smoke.sh` template (template-time, not a
  static ref).

`.claude/skills/` (37 files) and `ruflo-patch/.claude/skills/` (33 files):

- All have well-formed YAML frontmatter (closing `---` present;
  `name` + `description` present; checked all 37 + 33 with the audit
  script — no failures).
- Bodies are substantive (smallest: `init-project/SKILL.md` at 497 bytes,
  which is still a real instruction-and-command body, not a stub).

`.agents/skills/` (134 files): see findings F-07-001 and F-07-002
below. The 20 with `>$dev$null` artifacts are syntactically still
SKILL.md but contain shell that will not work when invoked verbatim.

---

## Findings

### F-07-001 — Broken `.agents/scripts/...` references in 4 skills

**Severity**: HIGH (refs resolve to nonexistent paths).

Four `.agents/skills/*/SKILL.md` files reference scripts at
`.agents/scripts/<name>.sh`, but the scripts actually live at
`.agents/skills/<skill>/scripts/<name>.sh`. The `.agents/scripts/`
directory does not exist in the fork.

Affected (verified):

- `/Users/henrik/source/forks/ruflo/.agents/skills/sparc-methodology/SKILL.md`
  refs `.agents/scripts/sparc-init.sh`, `.agents/scripts/sparc-review.sh`
  → actual: `.agents/skills/sparc-methodology/scripts/{sparc-init,sparc-review}.sh`.
- `/Users/henrik/source/forks/ruflo/.agents/skills/swarm-orchestration/SKILL.md`
  refs `.agents/scripts/swarm-start.sh`, `.agents/scripts/swarm-monitor.sh`
  → actual: `.agents/skills/swarm-orchestration/scripts/*.sh`.
- `/Users/henrik/source/forks/ruflo/.agents/skills/memory-management/SKILL.md`
  refs `.agents/scripts/memory-backup.sh`, `.agents/scripts/memory-consolidate.sh`
  → actual: `.agents/skills/memory-management/scripts/*.sh`.
- `/Users/henrik/source/forks/ruflo/.agents/skills/security-audit/SKILL.md`
  refs `.agents/scripts/security-scan.sh`, `.agents/scripts/cve-remediate.sh`
  → actual: `.agents/skills/security-audit/scripts/*.sh`.

User-impact: if these skills get invoked and the user follows the
referenced path verbatim, `bash: .agents/scripts/sparc-init.sh: No such
file or directory`. The scripts themselves exist and look functional
(sample: `sparc-init.sh` creates phase files; `security-scan.sh` runs a
scan pipeline) — so the soundness defect is purely the path reference.

### F-07-002 — Codemod-corrupted `>$dev$null` in 20 `.agents/skills/` files

**Severity**: HIGH (shell will fail at runtime).

Twenty `.agents/skills/agent-*/SKILL.md` files contain `>$dev$null` or
`2>$dev$null` inside hook code blocks (originally `>/dev/null`). When
the hook is sourced, the shell expands `$dev` and `$null` to empty
strings, producing `> 2>&1` which is a syntax error
(`bash: syntax error near unexpected token '2'`).

Full list (verified with `grep -lF 'dev$null'`):

- agent-analyze-code-quality, agent-arch-system-design, agent-data-ml-model,
  agent-dev-backend-api, agent-github-modes, agent-implementer-sparc-coder,
  agent-multi-repo-swarm, agent-ops-cicd-github, agent-pr-manager,
  agent-project-board-sync, agent-swarm-issue, agent-sync-coordinator,
  agent-tdd-london-swarm, agent-tester, agent-v3-integration-architect,
  agent-v3-memory-specialist, agent-v3-performance-engineer,
  agent-v3-queen-coordinator, agent-v3-security-architect,
  github-project-management.

The pattern is consistent — `>$dev$null` (a corrupted
`>/dev/null`) — and the corresponding "real" agent files at
`forks/ruflo/.claude/agents/testing/tdd-london-swarm.md` do NOT contain
the artifact. That implies a generator (or a regex pass) introduced it
when emitting the `.agents/skills/` mirror. The current codemod
(`scripts/codemod.mjs`) does not perform this substitution; the
corruption is in the fork's source-of-truth `.agents/skills/` tree, so
running `npm run release` would ship the bad shell unchanged into any
user project that opts into these skill names.

Note: `.agents/skills/` is NOT currently referenced by `SKILLS_MAP` in
the cli init executor, so these specific skills aren't shipped to user
projects via `ruflo init` today. They remain visible in fork-developer
sessions where Claude Code scans the working tree.

### F-07-003 — 41 duplicate skill *names* across registration roots

**Severity**: MEDIUM (Claude Code "which copy wins" undefined).

Total SKILL.md files in scope: 280. Total unique skill names: 239.
Duplicates: 41 names (some 3-way).

Three-way duplicates (`.agents/skills/` + `.claude/skills/` +
plugin/v3 location):

- `sparc-methodology` — `.agents/skills/`, `.claude/skills/`,
  `v3/@claude-flow/codex/.agents/skills/`.
- `hive-mind-advanced` — `.agents/skills/`, `.claude/skills/`,
  `plugins/ruflo-hive-mind/skills/`.

Two-way duplicates (representative, partial list):

- `swarm-orchestration`, `swarm-advanced`, `stream-chain`, `skill-builder`
- `agentdb-advanced`, `agentdb-learning`, `agentdb-memory-patterns`,
  `agentdb-optimization`, `agentdb-vector-search`
- `github-code-review`, `github-multi-repo`, `github-project-management`,
  `github-release-management`, `github-workflow-automation`
- `flow-nexus-{neural,platform,swarm}`
- `hooks-automation`, `pair-programming`, `performance-analysis`,
  `verification-quality`, `reasoningbank-{agentdb,intelligence}`
- All 9 `v3-*` skills (`v3-cli-modernization`, `v3-core-implementation`,
  `v3-ddd-architecture`, `v3-integration-deep`, `v3-mcp-optimization`,
  `v3-memory-unification`, `v3-performance-optimization`,
  `v3-security-overhaul`, `v3-swarm-coordination`)
- `worker-{benchmarks,integration}`
- `agentic-jujutsu`, `browser`, `memory-management`, `security-audit`,
  `hive-mind`, `github-automation`

**Content divergence**: duplicates are NOT identical copies.
`sparc-methodology` `.agents/skills/` version is 118 lines (terse,
purpose+triggers); `.claude/skills/` version is 1,106 lines (full
methodology playbook); `ruflo-patch/.claude/skills/` is 1,115 lines (a
near-clone of the `.claude/skills/` version but with the older
`description:` shape). All three render the same `name:
sparc-methodology` frontmatter — Claude Code has no formal precedence
rule for which to surface.

The fork's `.claude/settings.json` explicitly admits this:

```jsonc
"_comment_skillListingBudgetFraction": "#1834 — repo has 367 SKILL.md
  files (5x duplicates of common skills) across .agents/skills,
  .claude/skills, archive/v2/.claude/skills, v3/@claude-flow/{cli,mcp}/
  .claude/skills. With Claude Code's default 1% budget, ~378
  descriptions get truncated. Bumping to 6% covers the actual usage
  (5.5%). Long-term fix is to prune the duplicates and archive paths."
```

The settings file is documenting symptom-management, not a resolution.

### F-07-004 — `dual-mode/` skill directory has no SKILL.md

**Severity**: LOW (directory exists but doesn't register as a skill).

`forks/ruflo/.claude/skills/dual-mode/` contains `README.md`,
`dual-collect.md`, `dual-coordinate.md`, `dual-spawn.md` — but no
`SKILL.md` file. Claude Code requires `SKILL.md` to register the
directory as a skill. The 3 `dual-*.md` files appear to be intended as
slash-command bodies, not skill definitions.

`SKILLS_MAP` includes `dualMode: ['dual-mode']` at executor.ts:49, so
`ruflo init --dual-mode` would copy this orphan directory into
user projects, where it would silently fail to register as a skill.

Additionally — the contents reference "Codex" which is on the
forbidden-topic list per the project's memory note
`feedback-no-codex-mentions.md`. The directory should likely be
removed from `SKILLS_MAP` and excised entirely from the fork source.

### F-07-005 — Leaked `.claude-flow/metrics/` runtime dir inside `skill-builder/`

**Severity**: LOW (cosmetic; will get copied to user projects).

`ruflo-patch/.claude/skills/skill-builder/` contains a
`.claude-flow/metrics/{agent-metrics.json, task-metrics.json,
performance.json}` directory. This is runtime state that leaked into a
skill directory at copy time. `copyDirRecursive()` in
`executor.ts:962` will faithfully copy it to user projects. Should be
gitignored / scrubbed.

### F-07-006 — 134 `agent-*` skills in `.agents/skills/` are unreferenced

**Severity**: LOW (dead-on-disk in user-init flow; live in dev session).

`SKILLS_MAP` (executor.ts:37-92) contains 32 skill names across
categories. None of the 134 `agent-*` entries in `.agents/skills/`
appear in `SKILLS_MAP`. So `ruflo init` does NOT ship these to user
projects.

In fork-developer sessions, Claude Code WILL discover them (any
`SKILL.md` under the working tree's `.claude/skills/` or `.agents/skills/`
counts), which is why the F-07-002 `>$dev$null` corruption is visible
to fork-developer sessions despite not shipping.

If the intent of `.agents/skills/` was to provide a parallel "agent as
skill" namespace, the SKILLS_MAP wiring is missing. If the intent was
to be fork-internal, the dual-namespace `name:` blocks (e.g.
`agent-coder` and inner `coder`) confuse the SKILL.md spec — only the
outer block is recognized; the inner block's `hooks`/`capabilities`
metadata is rendered as body text.

### F-07-007 — `forks/ruflo/.claude/settings.json` skills.source mismatch

**Severity**: LOW (legacy config; appears unused).

`.claude/settings.json:263-266`:

```json
"skills": {
  "source": ".claude/commands",
  "enabled": true
}
```

`source: ".claude/commands"` looks like a stale config from a prior
schema. Skills should live under `.claude/skills/`, not `.claude/commands/`.
Claude Code 2.x discovers skills from `.claude/skills/` by directory
convention, not from a `settings.skills.source` field. This entry is
dead config.

### F-07-008 — Init executor's `findSourceDir` has 14 fallback paths

**Severity**: INFO (ordering surprise risk).

`executor.ts:2172` resolves the skill source dir against a 14-entry
ordered list (explicit `sourceBaseDir`, `packageDotClaude`, 10 levels
of upward `.claude/` walk, 3 cwd-based, 2 v2 fallbacks for agents
only, 2 `plugin/` fallbacks). First-match-wins.

In a fork-developer session, the package-root `.claude/` wins. But in
acceptance tests that install the published tarball in `/tmp`, the
walk-up may match an UNINTENDED ancestor's `.claude/skills/` (e.g.
`~/.claude/skills/` if the test dir is nested deep enough). The fallback
breadth is sound for "I'm using @sparkleideas/cli somewhere", but
adversarial enough that surprising skill-sets could appear. This is
operating-as-designed; flag for awareness.

Source paths that would never resolve outside fork-dev: the cwd-based
and v2 fallbacks — once shipped via `npm install`, neither path exists.

---

## Method

Read-only audit, performed via:

1. `find <root> -name SKILL.md -not -path '*/archive/*' -not -path '*/node_modules/*'` for each skill root.
2. Frontmatter validation: `awk` parse for opening + closing `---`, presence of `name:` and `description:` lines between them.
3. Stub detection: `grep -l "TODO\|echo TODO\|stub\|placeholder"` and content-length sanity check (lowest non-stub: 497 bytes).
4. Script-reference resolution: for the 4 `.agents/skills/*/scripts/` skills, traced documented paths vs filesystem.
5. Duplicate detection: extract `name:` from each SKILL.md, count name uniqueness across the 280-file corpus.
6. Registration wiring: traced `SKILLS_MAP` (executor.ts:37-92) → `copySkills()` (line 919) → `findSourceDir()` (line 2172). Cross-checked plugin auto-discovery via `marketplace.json` + per-plugin `.claude-plugin/plugin.json`.
7. Codemod-corruption scan: `grep -lF 'dev$null'` across all SKILL.md files; cross-checked with corresponding upstream-style agent definitions.

No files modified. No commands run beyond `find`, `grep`, `awk`, `ls`, `diff`, `wc`, `head`, and `cat`.

## Recommendations (not implemented per audit scope)

1. F-07-001/F-07-002 ship a fork-side fix-PR that retargets script
   references and replaces `>$dev$null`/`2>$dev$null` with the
   original `/dev/null`. These are pure-content fixes that could go in
   a single commit.
2. F-07-003: pick a canonical location per skill name and delete the
   others. The fork's `_comment_skillListingBudgetFraction` already
   tracks this as work-in-progress (their referenced upstream issue is
   #1834); align with whatever decision lives there.
3. F-07-004: drop `dual-mode` from `SKILLS_MAP.dualMode` and remove
   the directory; per project memory it's also a forbidden topic.
4. F-07-005: gitignore `.claude-flow/` inside skill dirs; add an
   acceptance check that skill copy does not produce nested
   `.claude-flow/metrics/`.
5. F-07-006: decide if `.agents/skills/` is a deliberate parallel
   namespace. If yes, wire it through `SKILLS_MAP` (and fix the F-07-002
   corruption first). If no, archive the directory.
6. F-07-007: delete the dead `skills:` block from
   `.claude/settings.json`.
7. F-07-008: tighten `findSourceDir` to skip cwd-based and v2-based
   fallbacks when running from an installed npm package — they're
   never useful in that mode and risk surprising matches.

## File paths (load-bearing)

Audit-implicated SKILL.md/init source paths (absolute):

- `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/init/executor.ts` — `SKILLS_MAP` const (37-92), `copySkills()` (919-970), `findSourceDir()` (2172-2233).
- `/Users/henrik/source/forks/ruflo/.claude/settings.json` (skills section at 263; `_comment_skillListingBudgetFraction` documenting duplicate problem).
- `/Users/henrik/source/forks/ruflo/.claude-plugin/marketplace.json` — 33 plugin registrations.
- F-07-001 affected SKILL.md files:
  - `/Users/henrik/source/forks/ruflo/.agents/skills/sparc-methodology/SKILL.md`
  - `/Users/henrik/source/forks/ruflo/.agents/skills/swarm-orchestration/SKILL.md`
  - `/Users/henrik/source/forks/ruflo/.agents/skills/memory-management/SKILL.md`
  - `/Users/henrik/source/forks/ruflo/.agents/skills/security-audit/SKILL.md`
- F-07-002 affected SKILL.md files: 20 paths under `/Users/henrik/source/forks/ruflo/.agents/skills/agent-*/SKILL.md` plus `/Users/henrik/source/forks/ruflo/.agents/skills/github-project-management/SKILL.md` (full list in F-07-002).
- F-07-004: `/Users/henrik/source/forks/ruflo/.claude/skills/dual-mode/` (missing SKILL.md; contains codex-referencing files).
- F-07-005: `/Users/henrik/source/ruflo-patch/.claude/skills/skill-builder/.claude-flow/metrics/*.json`.
