# 2026-05-25 — stale install cleanup execution

## Verdict

**GREEN** — 42 stale files deleted, all 4 post-cleanup verification checks pass, no regressions.

## Scope

Follow-up to `docs/plans/2026-05-25-semantic-modelling-ruflo-migration.md` (commit `4919b24`) §"Open follow-up": clean up files installed by older ruflo versions that the current `@sparkleideas/ruflo@latest` (patch.292 / cli patch.316) doesn't refresh, in `/Users/henrik/source/hm/semantic-modelling/`.

The memory subsystem was already migrated in commit `1aed318` (today's earlier audit). This pass covers `.claude/{agents,helpers,skills,commands}/`, `.claude-flow/` subdirs beyond `data/sessions/logs/`, and root config files.

## Reference install

Path: `/tmp/ruflo-init-reference-20260525T155103Z`

Built with `npx -y @sparkleideas/ruflo@latest init --full --force --with-embeddings`. Exit code 0. Reported "89 agents, 34 skills, 23 commands" — matches v3.7.0-alpha.10-patch.316.

File count: **319** files in canonical bundle.

## Diff summary

| Set | Count | Meaning |
|---|---|---|
| A (reference) | 319 | What current ruflo init writes |
| B (project, filtered) | 405 | semantic-modelling files in `.claude/{agents,commands,helpers,skills,scripts,settings*.json}` + `.claude-flow/{agents,daa,hive-mind,metrics,neural,security,workflows,*.json,*.yaml}` (excludes user-owned regions: `worktrees/`, `projects/`, `memory/`, `data/`, `sessions/`, `logs/`) |
| A ∩ B (both) | 314 | Present and refreshed |
| **B \ A (project-only / candidates)** | **91** | Files in project but NOT in current install |
| A \ B (ref-only / init-skipped) | 5 | `memory.rvf`/`.lock` + root-level `.mcp.json`/`.ruflo-project`/`CLAUDE.md`; all accounted for (root files exist; rvf intentionally absent per prior migration) |

## Classification of B \ A (91 candidates)

Classification rule per task spec:

- **user-owned** — matches preserve-rule (`custom/`, `yaml-model-*`, `settings.local.json`) OR contains project-specific ADR refs (HM ontology, ADR-0167 reasoner, ADR-0016 YAML framework)
- **stale-safe-to-delete** — NOT user-owned, NOT in current install, `grep -rn "<basename>" /Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/` returns **ZERO hits**
- **stale-investigate** — candidate but grep returned ≥1 hit → preserve pending investigation
- **preserve-runtime-state** — `.claude-flow/*.json` or `*/state.json`/`*/store.json` with grep hits → operational state (daemon-written, similar to `data/sessions`)
- **preserve-os-noise** — `.DS_Store` (macOS Finder artifacts, out of scope)

| Class | Count |
|---|---|
| user-owned (preserved) | 31 |
| **stale-safe-to-delete (DELETED)** | **42** |
| stale-investigate (preserved) | 5 |
| preserve-runtime-state | 11 |
| preserve-os-noise | 2 |
| **Total** | **91** |

### user-owned (31 preserved)

By explicit constraint-rule (7):

- `.claude/agents/custom/sds-repo-learner.md`
- `.claude/agents/yaml-model-{adjudicator,enricher,validator-crossdim,validator-events,validator-structure}.md` (5)
- `.claude/settings.local.json`

By project-domain content (24) — grep confirms zero ruflo refs; content references HM ontology / ADR-0019 / ADR-0167 OD8 / ADR-0016 / Roslyn:

- `.claude/agents/ontology-{retriever,synthesiser}.md` (2)
- `.claude/skills/batch-review/{AGENT.md,SKILL.md}` (2)
- `.claude/skills/generate-yaml/SKILL.md`
- `.claude/skills/reason/{SKILL.md,AGENT.md,MERGE-AGENT.md}` (3)
- `.claude/skills/reason/references/*.md|*.yaml` (15)
- `.claude/skills/yaml-model/SKILL.md`

### stale-safe-to-delete (42 DELETED)

All zero hits in `forks/ruflo/v3/@claude-flow/cli/src/`. All mtime Apr 21–22 (predate today's init). All bundled `core/`, `goal/`, `v3/` sources confirmed to no longer contain them.

**Older-version agents (9):**

- `.claude/agents/core/{coder,researcher,reviewer,tester}.md` — current bundle has only `core/planner.md`
- `.claude/agents/goal/goal-planner.md` — current bundle has `goal/agent.md` (different file)
- `.claude/agents/v3/{adr-architect,memory-specialist,security-auditor,sparc-orchestrator}.md` — current bundle's `v3/` has 10 files, none with these names

**Older-version helpers (32):**

Current bundle's `.claude/helpers/` has 9 files: `auto-memory-hook.mjs`, `hook-handler.mjs`, `intelligence.cjs`, `memory.js`, `post-commit`, `pre-commit`, `router.js`, `session.js`, `statusline.cjs`. Project had 45 — the 32 deleted are:

- `adr-compliance.sh`, `auto-commit.sh`, `checkpoint-manager.sh`, `daemon-manager.sh`, `ddd-tracker.sh`
- `github-safe.js`, `github-safe.mjs`, `github-setup.sh`
- `guidance-hook.sh`, `guidance-hooks.sh`
- `health-monitor.sh`
- `learning-hooks.sh`, `learning-optimizer.sh`, `learning-service.mjs`, `metrics-db.mjs`
- `pattern-consolidator.sh`, `perf-worker.sh`
- `quick-start.sh`, `security-scanner.sh`, `setup-mcp.sh`, `standard-checkpoint-hooks.sh`
- `statusline.js`
- `swarm-comms.sh`, `swarm-hooks.sh`, `swarm-monitor.sh`
- `sync-memory.sh`, `sync-v3-metrics.sh`, `update-v3-progress.sh`, `v3-quick-status.sh`, `v3.sh`, `validate-v3-config.sh`, `worker-manager.sh`

**Orphan daemon telemetry (1):**

- `.claude-flow/cjs-intelligence-signals.json` — zero hits anywhere in `v3/`, mtime Apr 21, no current code reads it

### stale-investigate (5 PRESERVED)

Candidates with ≥1 grep hit; not deleted to honour the "ZERO hits" bar:

| File | Hits | Notes |
|---|---|---|
| `.claude-flow/config.yaml` | 4 | Legacy fallback per ADR-0069 (`config.json` is canonical); runtime still reads it if `config.json` absent |
| `.claude/helpers/hook-handler.cjs` | 1 | Only hit is a doc comment in `settings-generator.ts:17` describing the OLD path; current `settings.json` references `hook-handler.mjs` only. Likely safe to delete in a follow-up but strict rule preserves it. |
| `.claude/helpers/package.json` | 21 | Generic `package.json` matches; no specific `helpers/package.json` reference, but bare basename too common — strict rule preserves it. Content is `{ "type": "commonjs" }` (25 bytes). |
| `.claude/helpers/README.md` | 3 | Generic `README.md` matches; not specifically reinstalled by current init. |
| `.claude/helpers/statusline-hook.sh` | 1 | `helpers-generator.ts:1491` actively writes this when `components.statusline` is enabled — but reference install (`--full`) did NOT produce it. Possible init regression worth a follow-up issue. Project's copy is from older version (mtime Apr 22) but is still referenced by current code. |

### preserve-runtime-state (11 PRESERVED)

Daemon/CLI-written state files with grep hits in current code — analogous to `.claude-flow/data/` and `.claude-flow/sessions/` (already excluded by constraints):

- `.claude-flow/agents.json`, `.claude-flow/agents/store.json`
- `.claude-flow/daa/store.json`
- `.claude-flow/daemon-state.json`
- `.claude-flow/hive-mind/state.json`
- `.claude-flow/metrics/{codebase-map,consolidation,performance,security-audit,test-gaps}.json` (5)
- `.claude-flow/neural/models.json`

### preserve-os-noise (2 PRESERVED)

- `.claude/.DS_Store`, `.claude-flow/.DS_Store` — macOS Finder artifacts, out of scope.

## Cleanup executed

Deletions logged to `/tmp/deletion-log.txt`. Total: **42 files, 346,672 bytes (~338 KB) reclaimed**.

Largest deletions:

| File | Bytes |
|---|---|
| `.claude/helpers/learning-service.mjs` | 35,402 |
| `.claude/agents/v3/memory-specialist.md` | 29,897 |
| `.claude/agents/v3/security-auditor.md` | 23,101 |
| `.claude/helpers/swarm-hooks.sh` | 21,147 |
| `.claude/agents/core/tester.md` | 15,810 |
| `.claude/agents/core/reviewer.md` | 15,598 |
| `.claude-flow/cjs-intelligence-signals.json` | 15,195 |
| `.claude/helpers/metrics-db.mjs` | 14,445 |
| `.claude/agents/core/coder.md` | 13,711 |
| `.claude/agents/core/researcher.md` | 12,559 |

(Full per-file list in `/tmp/deletion-log.txt` snapshot retained at `/tmp/semantic-modelling-stale-snap-20260525T155129Z`.)

## Post-cleanup verification

All four checks PASS (no regression from baseline):

| Check | Baseline | Post-cleanup | Status |
|---|---|---|---|
| `.mcp.json` sha256 | `1f5795c9...3bcf715` | `1f5795c9...3bcf715` | PASS — unchanged |
| `.swarm/memory.db` table count | 33 | 33 | PASS — unchanged |
| `memory_search "validation"` | 2 results @ 0.44 / 0.43 | 2 results @ 0.44 / 0.43 | PASS — unchanged |
| `ruflo --version` | `v3.7.0-alpha.10-patch.316` | `v3.7.0-alpha.10-patch.316` | PASS — CLI works |

Additional spot-check:

- `settings.json` references 3 helpers (`auto-memory-hook.mjs`, `hook-handler.mjs`, `statusline.cjs`) — all 3 resolve to existing files post-cleanup.
- Memory round-trip (store + recall a fresh test entry) successful; test entry deleted after verification to leave project in clean baseline state.

## Open items

Five files preserved as `stale-investigate` (see above). The `statusline-hook.sh` case is the most interesting — `helpers-generator.ts:1491` actively writes it, but the reference `--full` install didn't produce it. Worth a follow-up to determine whether (a) `--full` doesn't enable `components.statusline`, or (b) the reference install path silently skipped statusline-hook.sh. Not a regression in the project (the older copy is present and the current settings.json doesn't reference it directly).

Other observations (out of scope for cleanup, recorded for completeness):

- `.claude/projects/` (1 file, 4KB) was excluded from diff scope per constraint (Claude Code session data, not ruflo). Confirmed `.claude/projects/` is Claude Code's own dir, not ruflo-managed.
- `.claude/worktrees/` contains 375,906 files / 8.0G — entirely user-owned git worktrees, correctly excluded.
- `.claude/.DS_Store` and `.claude-flow/.DS_Store` are macOS noise; outside the audit's mandate but trivial to delete in any future general housekeeping pass.

## Reproducibility

- Reference install: `/tmp/ruflo-init-reference-20260525T155103Z` (319-file manifest at `file-manifest.txt`)
- Pre-cleanup snapshot: `/tmp/semantic-modelling-stale-snap-20260525T155129Z` (8.1G, includes worktrees)
- Classification JSON: `/tmp/classification.json`
- Deletion log: `/tmp/deletion-log.txt`
- Process: 6 phases per task spec; all WRITES limited to `/tmp/*` and authorised deletions in `/Users/henrik/source/hm/semantic-modelling/`; `forks/ruflo` was READ-ONLY (greps only).
