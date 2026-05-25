# 2026-05-25 — Claude Code skill discovery: directory-segment or filename?

## Verdict

**Directory-segment, with a closed set of four roots.** Claude Code discovers
skills only by walking the four documented roots (enterprise, personal,
project `.claude/skills/`, and plugin `<plugin>/skills/`) and globbing
`*/SKILL.md` immediately beneath them. A `SKILL.md` filename at any other
path is invisible to the loader.

## Evidence

### Documentation

Source: <https://code.claude.com/docs/en/skills> (canonical; `docs.claude.com`
issues a 301 to `code.claude.com`).

> "Where you store a skill determines who can use it:
>
> | Location   | Path                                                | Applies to                     |
> | :--------- | :-------------------------------------------------- | :----------------------------- |
> | Enterprise | See managed settings                                | All users in your organization |
> | Personal   | `~/.claude/skills/<skill-name>/SKILL.md`            | All your projects              |
> | Project    | `.claude/skills/<skill-name>/SKILL.md`              | This project only              |
> | Plugin     | `<plugin>/skills/<skill-name>/SKILL.md`             | Where plugin is enabled        |"

> "Project skills load from `.claude/skills/` in your starting directory and
> in every parent directory up to the repository root … Claude Code also
> discovers skills from nested `.claude/skills/` directories on demand. For
> example, if you're editing a file in `packages/frontend/`, Claude Code also
> looks for skills in `packages/frontend/.claude/skills/`."

> "The `--add-dir` flag grants file access rather than configuration
> discovery, but skills are an exception: `.claude/skills/` within an added
> directory is loaded automatically. … Other `.claude/` configuration such as
> subagents, commands, and output styles is not loaded from additional
> directories."

All four documented roots end in either `/.claude/skills/` or `/skills/` (the
plugin form, anchored by an enabled plugin's root). The docs nowhere describe
walking arbitrary subtrees looking for `SKILL.md`.

### Source code (Claude Code CLI binary)

Binary inspected: `/Users/henrik/.local/share/claude/versions/2.1.150`
(Mach-O 64-bit, the active install per `which claude` →
`/Users/henrik/.local/bin/claude` symlink).

`strings` grep for skill-loader signatures:

```
$ grep -aoE 'skills/\*/SKILL\.md|\.claude/skills' .../2.1.150 | sort -u
.claude/skills
skills/*/SKILL.md
```

Only two relevant patterns appear: the directory-segment `.claude/skills` and
the one-level glob `skills/*/SKILL.md`. No `**/SKILL.md` recursive glob, no
substring search for `SKILL.md`, no `findSkills`/`discoverSkills` walker that
would scan arbitrary trees. The presence of `globSync` next to
`skills/*/SKILL.md` matches a "list direct children of a fixed root" pattern,
not a recursive filename search.

### Empirical probe

Working directory: `/Users/henrik/source/ruflo-patch`. This repo has
**no** `.claude/skills/` subdirectory of its own:

```
$ find /Users/henrik/source/ruflo-patch -maxdepth 4 -name SKILL.md
(empty)
$ ls /Users/henrik/source/ruflo-patch/.claude
agents  commands  helpers  memory  memory.db  projects
scheduled_tasks.lock  scripts  settings.json  worktrees
```

The fork that hosts the duplicate SKILL.md files
(`/Users/henrik/source/forks/ruflo`) is a **separate repo**, not nested
under ruflo-patch. It contains, among others:

- `forks/ruflo/.claude/skills/agentdb-advanced/SKILL.md` (and ~19 siblings)
- `forks/ruflo/.agents/skills/agent-coder/SKILL.md` (and ~133 siblings)
- `forks/ruflo/plugins/ruflo-adr/skills/adr-create/SKILL.md` (and many more)
- `forks/ruflo/v3/.claude/skills/...` (38 files)

Cross-reference against the system-reminder skill list opened at the top of
this conversation:

| Fork path                                                | Skill name on disk            | Appears in system-reminder? |
| :------------------------------------------------------- | :---------------------------- | :-------------------------- |
| `forks/ruflo/.agents/skills/agent-coder/SKILL.md`        | `agent-coder`                 | **No**                      |
| `forks/ruflo/.agents/skills/agent-byzantine-coordinator` | `agent-byzantine-coordinator` | **No**                      |
| `forks/ruflo/plugins/ruflo-adr/skills/adr-verify`        | `adr-verify`                  | **No**                      |
| `forks/ruflo/plugins/ruflo-adr/skills/adr-create`        | `adr-create`                  | Yes — but as `adr-create` / `ruflo-adr:adr-create` |
| `forks/ruflo/v3/.claude/skills/*`                        | (anything)                    | **No**                      |

The two skills from `plugins/ruflo-adr/skills/` that DO appear in the
system-reminder (`adr-create`, `adr-index`, `adr-review`) are present because
the **installed** plugin cache also contains them:

```
$ ls /Users/henrik/.claude/plugins/cache/ruflo/ruflo-adr/0.1.16/skills
adr-create  adr-index  adr-review
```

`adr-verify` exists in the fork's `plugins/ruflo-adr/skills/` but is NOT in
the installed cache at `~/.claude/plugins/cache/ruflo/ruflo-adr/0.1.16/skills/`
— and it correctly does NOT show up in the system-reminder. This confirms
the loader follows the **installed plugin manifest**, not the source repo
sitting under `forks/`.

Other skills surfaced in the system-reminder correlate exclusively with:

- Personal skills: `ls ~/.claude/skills/` → `adr-create`, `adr-index`,
  `diagramming`, `markdown-editor`, `mermaid-export`, `notebook`, `odr-*`,
  `owl`, `qlever`, `shacl`, `skos`, `sparql`.
- Installed plugin caches:
  `~/.claude/plugins/cache/{claude-plugins-official,ruflo,legacybridge-cc-plugins}/<plugin>/<ver>/skills/`.
- Bundled (in the Mach-O): `run`, `verify`, `code-review`, `init`,
  `review`, `security-review`, `loop`, `schedule`, `claude-api`,
  `fewer-permission-prompts`, `update-config`, `keybindings-help`.

Nothing in the system-reminder traces back to a `SKILL.md` outside one of
those four documented roots.

## Implication for Item C (SKILL.md dedup)

**Dedup is narrow — the only fork-side SKILL.md files that pollute the
discovery surface live under `forks/ruflo/.claude/skills/` (and any
`forks/ruflo/<sub>/.claude/skills/` discovered as the user navigates into
a subdirectory of an opened session in that repo).**

Specifically:

1. **`forks/ruflo/.agents/skills/<name>/SKILL.md` (~134 files)** — invisible
   to the loader. The path segment is `.agents/`, not `.claude/`. These cost
   nothing in the skill listing budget. Leave them alone; pruning them only
   matters if some *other* tool reads them.

2. **`forks/ruflo/plugins/<plugin>/skills/<name>/SKILL.md` (~104 files)** —
   invisible at session start. They become visible only when the plugin is
   installed via `claude plugin install <plugin>@<marketplace>`, at which
   point Claude Code reads the **installed cache copy** at
   `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/skills/`, not
   the source under `forks/`. Source-tree dedup here is a release-hygiene
   question, not a session-budget question.

3. **`forks/ruflo/v3/.claude/skills/<name>/SKILL.md` (~38 files)** —
   discovery here is conditional on opening a Claude Code session whose
   starting directory is `forks/ruflo/v3/` (or any ancestor walks into it
   via `--add-dir` / a subdirectory edit). For a session opened in
   `forks/ruflo/`, the doc-claimed walker descends only when the user edits
   a file under `v3/`. Treat these as a real-but-conditional pollution
   source and dedup against `forks/ruflo/.claude/skills/` if the same skill
   exists in both — but the path-segment rule still holds: they're under
   `.claude/skills/`.

4. **`forks/ruflo/.claude/skills/<name>/SKILL.md` (~20 files)** — the
   actual polluter when a Claude Code session opens at the fork root.
   This is the set that Item C should dedup.

**Recommended scope for Item C:** prune duplicates only between
`forks/ruflo/.claude/skills/` and `forks/ruflo/v3/.claude/skills/` (and
between either of those and the canonical source-of-truth set under
`forks/ruflo/plugins/<plugin>/skills/`, since the plugin cache is what
ships to users). Do NOT touch `.agents/skills/` for skill-discovery
reasons — that directory is invisible to Claude Code's loader.

## 2026-05-25 amendment — Item C cannot execute the prune

Agent C investigated and found the premise above is partly wrong about the
v3 path:

1. **`forks/ruflo/v3/.claude/skills/` does NOT exist** as a path. The
   actual location is `forks/ruflo/v3/@claude-flow/cli/.claude/skills/`
   (33 SKILL.md files, not 38). The pre-amendment count of 38 conflated
   it with the top `forks/ruflo/.claude/skills/` set.
2. The `v3/@claude-flow/cli/.claude/skills/` set is **not** a session-
   discovery copy — it is the **npm package payload** that `ruflo init`
   copies into user projects via the `SKILLS_MAP` table in
   `forks/ruflo/v3/@claude-flow/cli/src/init/executor.ts`. Gated by
   `scripts/smoke-init-bundle-invariants.mjs` and the ADR-0216 arch-test
   `__tests__/arch/adr0216-skills-map-pin.arch.test.ts`.
3. **Removing the v3/cli copies would ship a broken npm tarball** — the
   smoke fails, and if forced through, `ruflo init` on user machines
   would fail to copy those skills.

What the content diff shows for the 33 name-collisions:

- 24 are **byte-identical** (only mtime differs).
- 9 differ:
  - 5 (`github-*`, `verification-quality`): the top `.claude/skills/`
    copy is fresher (has `mcp__ruflo__*` rebrand + CI-Guards section).
    v3/cli is stale.
  - 3 (`hooks-automation`, `sparc-methodology`, `swarm-advanced`):
    **v3/cli has REGRESSED to `mcp__claude-flow__*`** — violates
    [[ADR-0143]] rebrand. Top copy is correct.

### Disposition of Item C

**Item C is closed as no-op.** The dedup as planned is not viable
because the two directories are not duplicates — they are a source vs
payload split that the build pipeline understands. The `skillListing-
BudgetFraction = 0.06` (above the 0.01 default per `.claude/settings.json`)
is left as-is per the original rule "if at or above default, leave it."

### Follow-up filed (independent of Item C)

The 8 content-drifted v3/cli copies need to be re-synced from the top
`.claude/skills/` copies. The 3 `mcp__claude-flow__*` regressions are a
[[ADR-0143]] violation in shipped payload. Recommended next-session
work: copy top → v3/cli for the 8 drifted skills + a smoke that asserts
they stay in lockstep going forward. NOT in scope for this session's
Item C.

### 2026-05-25 follow-up resolution

The follow-up landed as `forks/ruflo` commits `02b6d7bcf` (8 files top
→ v3/cli) + `34119ebcb` (verification-quality reverse, v3/cli → top).
Source-of-truth direction is **per-file**, not uniform:

- For 8 files (`github-code-review`, `github-multi-repo`,
  `github-project-management`, `github-release-management`,
  `github-workflow-automation`, `hooks-automation`,
  `sparc-methodology`, `swarm-advanced`): **top wins**. v3/cli was
  stale (3 files had regressed to `mcp__claude-flow__*` per
  [[ADR-0143]]; 5 lacked the CI-Guards section).
- For `verification-quality`: **v3/cli wins**. The C amendment had
  this direction backwards. Top was stale (76 `claude-flow@alpha`
  refs, no CI-Guards section); v3/cli was fresh (85 `ruflo@alpha`
  refs, full CI-Guards table + witness manifest).

The C amendment's blanket "top is source-of-truth" rule was wrong; the
truth is that drift is bidirectional and each name-collision must be
diffed on its own. A lockstep-smoke is still warranted to catch future
drift in either direction.

Smoke `scripts/smoke-init-bundle-invariants.mjs` reported 17 pre-
existing violations both before and after the sync — none caused by
this work. They are: 5 parser-regex bugs in the smoke itself and 12
unrelated ADR-128 plugin-agent basename collisions. Filed as future-
session work.
