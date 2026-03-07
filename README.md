# ruflo

[![npm version](https://img.shields.io/npm/v/@sparkleideas/ruflo)](https://www.npmjs.com/package/@sparkleideas/ruflo)
[![license](https://img.shields.io/npm/l/@sparkleideas/ruflo)](LICENSE)

**Drop-in replacement for `ruflo` / `@claude-flow/cli` with 933+ unpublished upstream commits, bug fixes, and working dependency resolution.**

The upstream [ruvnet/ruflo](https://github.com/ruvnet/ruflo) ecosystem (48+ npm packages) is severely stale — 60% of `@claude-flow/*` packages haven't been published since January 2026, `ruflo` is 933 commits behind its source, and maintainers are unresponsive. `ruflo` forks, rebuilds, patches, and republishes the entire ecosystem under the `@sparkleideas` scope so you get current code from a single `npx` command.

```bash
npx ruflo init
```

Same CLI, same commands, same flags — just swap `ruflo` for `@sparkleideas/ruflo`. If upstream catches up, switch back with a one-word change.

---

## Table of Contents

- [Quick Start](#quick-start)
- [What You Get](#what-you-get)
- [How It Works](#how-it-works)
- [Migrating from ruflo](#migrating-from-ruflo)
- [Runtime Patches (Legacy)](#runtime-patches-legacy)
- [For Maintainers](#for-maintainers)
  - [Build Pipeline](#build-pipeline)
  - [npm Scripts](#npm-scripts)
  - [Automated Builds](#automated-builds)
  - [Publishing and Promotion](#publishing-and-promotion)
  - [Rollback](#rollback)
  - [Testing](#testing)
- [Project Structure](#project-structure)
- [Architecture Decisions](#architecture-decisions)
- [Requirements](#requirements)
- [License](#license)

---

## Quick Start

```bash
# Run directly (no install needed)
npx @sparkleideas/ruflo init

# Or install globally
npm install -g @sparkleideas/ruflo
```

All commands work exactly like `ruflo`:

```bash
npx @sparkleideas/ruflo agent spawn -t coder          # spawn an agent
npx @sparkleideas/ruflo memory search --query "auth"  # search memory
npx @sparkleideas/ruflo mcp start                     # start MCP server
npx @sparkleideas/ruflo doctor                        # diagnose issues
```

---

## What You Get

| Feature | `ruflo` (upstream) | `ruflo` |
|---------|-------------------|---------------|
| Source commits | 933 behind | Current with upstream HEAD |
| `@claude-flow/*` packages | Last published Jan 2026 | Rebuilt from source every 6 hours |
| MCP autostart fix (MC-001) | Broken | Fixed |
| Fallback instrumentation (FB-001/002) | Missing | Included |
| Memory ControllerRegistry shim (FB-003) | Missing | Included |
| Hash embedding threshold fix (FB-004) | Missing | Included |
| Semver conflicts (`@ruvector/ruvllm`, `agentdb`) | Broken install | Resolved |
| `npm install` | Fails on dependency conflicts | Clean install |
| Plugin ecosystem | Not repackaged | 14 plugins under @sparkleideas/* |
| Tier 1 routing (agent-booster) | Not available | $0, <1ms for simple edits |

**42 packages** are rebuilt and published under the `@sparkleideas` scope across 5 dependency levels. The `@ruvector/*` packages are used as-is from public npm (they're current).

---

## How It Works

```
┌─────────────────────────────────────────────────────┐
│                  Build Pipeline                      │
│                                                      │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐        │
│  │ ruvnet/  │   │ ruvnet/  │   │ ruvnet/  │        │
│  │ ruflo    │   │ agentic- │   │ ruv-FANN │        │
│  │ (fork)   │   │ flow     │   │ (fork)   │        │
│  └────┬─────┘   └────┬─────┘   └────┬─────┘        │
│       │              │              │               │
│       └──────────┬───┘──────────────┘               │
│                  ▼                                    │
│         ┌────────────────┐                           │
│         │  git pull       │  Zero merge conflicts    │
│         │  (clean mirror) │  — forks are unmodified  │
│         └───────┬────────┘                           │
│                 ▼                                     │
│         ┌────────────────┐                           │
│         │  Codemod        │  @claude-flow/* →         │
│         │  (build-time)   │  @sparkleideas/*    │
│         └───────┬────────┘                           │
│                 ▼                                     │
│         ┌────────────────┐                           │
│         │  Apply patches  │  MC-001, FB-001–004,     │
│         │                 │  SV-001–003              │
│         └───────┬────────┘                           │
│                 ▼                                     │
│         ┌────────────────┐                           │
│         │  pnpm build     │  TypeScript → JS         │
│         └───────┬────────┘                           │
│                 ▼                                     │
│         ┌────────────────┐                           │
│         │  npm publish    │  42 packages,            │
│         │  --tag prerelease│ 5 levels, bottom-up     │
│         └────────────────┘                           │
└─────────────────────────────────────────────────────┘
```

**Key design choice**: The scope rename (`@claude-flow/*` → `@sparkleideas/*`) is a **build-time codemod**, never committed to the fork. This means `git pull` on the fork always produces zero merge conflicts, regardless of how much upstream changes.

The codemod transforms ~4,136 files per build:
- ~261 `package.json` files (name, dependencies, peerDependencies)
- ~3,875 JS/TS source files (import/require statements)

All patches and fixes are baked into the published packages — no runtime patching needed.

---

## Migrating from ruflo

### Commands

Replace `ruflo` with `@sparkleideas/ruflo`:

```bash
# Before
npx ruflo init
npx ruflo agent spawn -t coder
npx @claude-flow/cli@latest mcp start

# After
npx @sparkleideas/ruflo init
npx @sparkleideas/ruflo agent spawn -t coder
npx @sparkleideas/ruflo mcp start
```

### package.json

```diff
  "dependencies": {
-   "claude-flow": "^3.5.2"
+   "@sparkleideas/cli": "^3.5.3"
  }
```

### MCP / Claude Code Configuration

Update your `.claude/settings.json`:

```diff
  {
    "mcpServers": {
      "claude-flow": {
        "command": "npx",
-       "args": ["-y", "@claude-flow/cli@latest", "mcp", "start"]
+       "args": ["-y", "@sparkleideas/ruflo", "mcp", "start"]
      }
    }
  }
```

---

## Runtime Patches (Legacy)

> Most users should use `npx ruflo` instead — it includes all fixes permanently. Runtime patches are only needed if you must stay on the upstream `ruflo` package for compatibility reasons.

This repo also maintains runtime patches that can be applied directly to the upstream `ruflo` npx cache. These are fragile (wiped on cache updates) but useful as a stopgap.

### CLI Commands

```
ruflo apply  [--global] [--target <dir>]   Apply all patches
ruflo check  [--global] [--target <dir>]   Verify patches are applied
ruflo repair [--target <dir>]              Repair post-init helpers
```

### Patch Inventory

| ID | Patch | Description |
|----|-------|-------------|
| MC-001 | `010-MC-001-mcp-autostart` | Removes `autoStart: false` from MCP entry in init generator |
| FB-001 | `020-FB-001-fallback-instrumentation` | 10 ops instrumenting upstream fallback paths with logging |
| FB-002 | `021-FB-002-local-helper-instrumentation` | 16 ops instrumenting local helper fallback paths |
| FB-004 | `040-FB-004-search-threshold-for-hash-embeddings` | Lowers search threshold from 0.3→0.1 for hash embeddings |
| SV-001 | `050-SV-001-ruvllm-semver-fix` | Fixes `@ruvector/ruvllm ^0.2.3` → `^2.5.1` |
| SV-002 | `051-SV-002-agentdb-memory-pin` | **RETIRED** — codemod uses `*` for internal deps |
| SV-003 | `052-SV-003-agentdb-agentic-range` | **RETIRED** — codemod uses `*` for internal deps |
| SG-003 | `060-SG-003-init-helpers-all-paths` | Fixes missing `.claude/helpers/` for --dual, --minimal, hooks, and upgrade init paths |

Each patch is idempotent — safe to run multiple times. Adding a new patch requires no changes to any script; just create the directory with `README.md`, `fix.py`, and `sentinel`.

### Auto-Reapply

npx cache updates wipe patches. Auto-detect and reapply with a Claude Code hook:

```json
{
  "hooks": {
    "session_start": [
      { "command": "ruflo check --global", "timeout": 30000 }
    ]
  }
}
```

---

## For Maintainers

### Build Pipeline

The build is orchestrated by `scripts/sync-and-build.sh` and runs these phases:

1. **Load state** — Read last-built commit hashes from `scripts/.last-build-state`
2. **Check upstream** — `git ls-remote` against 3 repos (one HTTP request each)
3. **Check local** — `git log` for changes to `patch/` or `scripts/`
4. **Pull upstream** — `git fetch && git reset --hard origin/main` on each fork
5. **Copy to temp** — Clean copy to `/tmp/ruflo-build-*`
6. **Codemod** — `@claude-flow/*` → `@sparkleideas/*` (see `scripts/codemod.mjs`)
7. **Apply patches** — All `patch/*/fix.py` scripts via `patch-all.sh`
8. **Build** — `pnpm install && pnpm build`
9. **Test** — `npm test`
10. **Compute version** — per-package `bump_last_segment(max(upstream, lastPublished))`
11. **Publish** — 24 upstream packages across 5 dependency levels, bottom-up with 2s rate-limit
12. **Notify** — GitHub prerelease (triggers email)
13. **Save state** — Only after successful publish

If any phase fails, a GitHub Issue is created automatically. State is never updated on failure, so the next run retries.

### npm Scripts

| Command | Description |
|---------|-------------|
| `npm test` | Run unit test suite (78 tests) |
| `npm run preflight` | Sync generated doc tables and validate consistency |
| `npm run preflight:check` | CI mode — exits 1 if out of date |
| `npm run codemod` | Run scope-rename codemod standalone |
| `npm run publish:all` | Run topological publisher |
| `npm run publish:dry-run` | Dry-run publish (no npm writes) |
| `npm run build:sync` | Full build pipeline (sync-and-build.sh) |
| `npm run promote` | Promote a prerelease to `@latest` |
| `npm run rollback` | Roll back `@latest` to previous version |
| `npm run audit:imports` | Audit dynamic imports for codemod coverage |
| `npm run upstream-log` | Show recent upstream releases |
| `npm run systemd:install` | Install systemd timer and service units |

### Automated Builds

A systemd timer runs `sync-and-build.sh` every 6 hours:

```bash
# Install (one-time)
sudo npm run systemd:install

# View build logs
journalctl -u ruflo-sync

# Trigger manually
sudo systemctl start ruflo-sync.service

# Check timer status
systemctl list-timers ruflo-sync*
```

The service runs as the `claude` user with resource limits (`CPUQuota=800%`, `MemoryMax=32G`, `TimeoutStartSec=3600`). Secrets (`NPM_TOKEN`, `GH_TOKEN`) are loaded from `/home/claude/.config/ruflo/secrets.env`.

### Publishing and Promotion

Automated builds publish to the `prerelease` dist-tag. Users on `@latest` are unaffected until you explicitly promote:

```bash
# Review the prerelease
npx ruflo@prerelease --version

# Promote to @latest
npm run promote
# or manually:
npm dist-tag add @sparkleideas/ruflo@3.5.3 latest
```

**Version scheme**: Each package's version is computed as `bump_last_segment(max(upstream, lastPublished))`. For example, upstream `3.0.2` publishes as `3.0.3`, then `3.0.4` on rebuild. Per-package tracking in `config/published-versions.json`.

### Rollback

If a promoted version is broken:

```bash
# Roll back @latest to the previous known-good version
npm run rollback

# Or with a specific version
bash scripts/rollback.sh 3.5.3
```

This reassigns the `latest` dist-tag for `ruflo` and all 24 `@sparkleideas/*` packages. Takes effect immediately — no propagation delay.

### Testing

Five test types across three layers:

| Layer | Type | What | How to run |
|-------|------|------|------------|
| 1 | **Unit** | 93 tests — codemod, pipeline logic, publish order, patches | `npm test` |
| 1 | **Preflight** | Syncs generated doc tables, validates consistency | `npm run preflight` |
| 2 | **Integration** | 9-phase build pipeline against local Verdaccio | `bash scripts/test-integration.sh` |
| 3 | **Acceptance** | 14 end-user tests (init, version, doctor, MCP, memory) | `bash scripts/test-acceptance.sh` |
| — | **CI Validation** | Health check (env, systemd, secrets, upstream clones) | `bash scripts/validate-ci.sh` |

Acceptance tests run **post-publish** as Phase 12 of `sync-and-build.sh` — they validate the user experience against real npm. Integration tests validate the build pipeline against local Verdaccio. These are separate layers by design (see ADR-0020).

---

## Project Structure

```
ruflo/
├── bin/ruflo.mjs              CLI entry point
├── patch-all.sh                     Apply all patches (discovers patch/*/fix.py)
├── check-patches.sh                 Sentinel verification, auto-reapplies if wiped
├── repair-post-init.sh              Rehydrate .claude/helpers post-init
├── lib/
│   ├── common.py                    patch()/patch_all() helpers + path variables
│   ├── discover.mjs                 Dynamic patch discovery
│   ├── discover.sh                  Bash install discovery (npx cache, global prefix)
│   └── categories.json              Defect prefix → label mapping
├── scripts/
│   ├── sync-and-build.sh            Main build pipeline orchestrator
│   ├── codemod.mjs                  Scope-rename codemod (@claude-flow → @sparkleideas)
│   ├── publish.mjs                  Topological publisher (5 levels, 24 upstream packages)
│   ├── promote.sh                   Promote prerelease to @latest
│   ├── rollback.sh                  Roll back @latest to previous version
│   ├── test-runner.mjs              Unit test runner
│   ├── test-integration.sh          9-phase integration tests with Verdaccio
│   ├── test-acceptance.sh           End-user acceptance tests
│   ├── validate-ci.sh               CI environment health check
│   ├── audit-dynamic-imports.sh     Dynamic import inventory
│   ├── install-systemd.sh           systemd unit installer
│   ├── preflight.mjs                Pre-commit consistency check
│   └── upstream-log.mjs             Show recent upstream releases
├── config/
│   ├── package-map.json             Package name mappings (25 packages)
│   ├── publish-levels.json          Topological publish order (5 levels)
│   ├── ruflo-sync.timer             systemd timer unit
│   ├── ruflo-sync.service           systemd service unit
│   └── verdaccio-test.yaml          Isolated Verdaccio config for tests
├── patch/
│   ├── 010-MC-001-mcp-autostart/    MCP autostart fix
│   ├── 020-FB-001-fallback-*/       Fallback instrumentation (10 ops)
│   ├── 021-FB-002-local-helper-*/   Helper instrumentation (16 ops)
│   ├── 040-FB-004-search-*/         Hash embedding threshold fix
│   ├── 050-SV-001-ruvllm-*/         @ruvector/ruvllm semver fix
│   ├── 051-SV-002-agentdb-*/        agentdb memory pin (RETIRED)
│   ├── 052-SV-003-agentdb-*/        agentdb agentic range (RETIRED)
│   └── 060-SG-003-init-helpers-*/   Init helpers for all paths
├── tests/                           Unit tests (node:test)
├── docs/adr/                        Architecture Decision Records
└── .tool-versions                   nodejs 20.18.1, pnpm 9.15.4, python 3.12.8
```

---

## Architecture Decisions

All major decisions are documented as ADRs in `docs/adr/`:

| ADR | Title | Summary |
|-----|-------|---------|
| [0001](docs/adr/0001-remove-mcp-autostart-false.md) | Remove MCP autostart false | MC-001 patch rationale |
| [0002](docs/adr/0002-fallback-instrumentation.md) | Fallback instrumentation | FB-001/002 patch rationale |
| [0004](docs/adr/0004-search-threshold-for-hash-embeddings.md) | Search threshold for hash embeddings | FB-004 threshold fix |
| [0005](docs/adr/0005-fork-build-step-rename.md) | Fork + build-step rename | Core strategy: fork, codemod, publish |
| [0006](docs/adr/0006-npm-scope-naming.md) | npm scope naming | `@sparkleideas` scope (updated from ADR) |
| [0007](docs/adr/0007-drop-in-replacement-ux.md) | Drop-in replacement UX | One-word swap migration |
| [0008](docs/adr/0008-skip-ruvector-rebuild.md) | Skip ruvector rebuild | Node.js-only build (no Rust) |
| [0009](docs/adr/0009-systemd-timer-for-automated-builds.md) | systemd timer | 6-hour automated builds |
| [0010](docs/adr/0010-prerelease-publish-gate.md) | Prerelease publish gate | Auto-publish to prerelease, manual promote |
| [0011](docs/adr/0011-dual-build-trigger.md) | Dual build trigger | Upstream + local change detection |
| [0012](docs/adr/0012-version-numbering-scheme.md) | Version numbering | `bump_last_segment(max(upstream, lastPublished))` scheme |
| [0013](docs/adr/0013-codemod-implementation.md) | Codemod implementation | 2-phase transform, ordering rules |
| [0014](docs/adr/0014-topological-publish-order.md) | Topological publish order | 5-level bottom-up with rate limiting |
| [0015](docs/adr/0015-first-publish-bootstrap.md) | First-publish bootstrap | Auto-detect never-published packages |
| [0016](docs/adr/0016-dynamic-import-handling.md) | Dynamic import handling | 3-layer audit + patch strategy |
| [0017](docs/adr/0017-inherited-semver-conflict-resolution.md) | Semver conflict resolution | Fix inherited `@ruvector/ruvllm` + `agentdb` ranges |
| [0018](docs/adr/0018-initial-setup-runbook.md) | Initial setup runbook | Server setup, secrets, disaster recovery |
| [0019](docs/adr/0019-rollback-procedure.md) | Rollback procedure | Dist-tag reassignment, not unpublish |
| [0020](docs/adr/0020-testing-strategy.md) | Testing strategy | 3-layer testing + reproducibility framework |

---

## Requirements

- **Node.js** >= 20
- **Python** >= 3.8 (for runtime patch scripts)
- **Bash** (Linux or macOS)
- **pnpm** >= 8 (build pipeline only)
- **gh** CLI (build pipeline only — for GitHub releases and issues)

End users only need Node.js. The Python and pnpm requirements are for maintainers running the build pipeline or applying runtime patches.

---

## License

MIT — same as upstream. Original LICENSE and copyright notices are preserved in every republished package.
