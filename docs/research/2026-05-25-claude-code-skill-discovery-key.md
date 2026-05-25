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
