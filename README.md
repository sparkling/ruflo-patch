# @ruflo/patch

Community runtime patches for [`ruflo`](https://www.npmjs.com/package/ruflo) (wraps `@claude-flow/cli`), [`ruvector`](https://www.npmjs.com/package/ruvector), and [`ruv-swarm`](https://www.npmjs.com/package/ruv-swarm).

These patches fix bugs and wire up unactivated subsystems in the upstream packages via idempotent Python scripts that perform targeted string replacements on npx-cached source files. Each patch targets a specific GitHub issue, ships its own `fix.py`, sentinel check, and documentation.

## Contents

- [Quick Start](#quick-start)
- [CLI Commands](#cli-commands)
- [How It Works](#how-it-works)
- [Patch Structure](#patch-structure)
- [Target Packages](#target-packages)
- [Init-Script Patches](#init-script-patches)
- [Auto-Reapply on Update](#auto-reapply-on-update)
- [Scripts](#scripts)
- [Compatibility](#compatibility)

## Quick Start

**Patch before init.** Several patches fix the init/generator scripts. If you run `claude-flow init` before patching, the generated `.claude/helpers/` files will be stubs with no learning, no PageRank, and no-op feedback. Always patch first:

```bash
# 1. Patch first -- fixes the init generators
npx --yes @ruflo/patch apply --global

# 2. Then init (or re-init if already initialized)
npx @claude-flow/cli@latest init            # fresh project
npx @claude-flow/cli@latest init upgrade    # existing project

# 3. Verify
npx --yes @ruflo/patch check
```

If you already initialized before patching:

```bash
npx --yes @ruflo/patch repair --target /path/to/project
```

## Requirements

- Node.js >= 20
- Python 3.6+
- Bash

## Install

```bash
npm install -g @ruflo/patch
```

Or run directly with npx (no install required):

```bash
npx @ruflo/patch apply
```

## CLI Commands

```
ruflo-patch apply  [--global] [--target <dir>]   Apply all patches
ruflo-patch check  [--global] [--target <dir>]   Verify patches are applied
ruflo-patch repair [--target <dir>]              Repair post-init helpers
ruflo-patch --help                               Show help
```

### Target Options

| Flag | Target | When to use |
|------|--------|-------------|
| *(none)* | Global npx cache (default) | Most common -- patches the npx cache |
| `--global` | `~/.npm/_npx/*/node_modules/` | Explicit global-only |
| `--target <dir>` | `<dir>/node_modules/` | Project with a local install |
| `--global --target <dir>` | Both locations | Covers both invocation paths |

`npx ruflo` uses local `node_modules` if present, otherwise the global npx cache.

### Examples

```bash
# Patch all global installs
ruflo-patch apply

# Patch a specific project
ruflo-patch apply --target ~/my-project

# Patch both global and local
ruflo-patch apply --global --target ~/my-project

# Verify patches are still applied after an npm install
ruflo-patch check

# Repair helper files in a project initialized before patching
ruflo-patch repair --target ~/my-project
```

## How It Works

1. **Discovery** (`lib/discover.sh`) scans the npx cache and npm global prefix for `@claude-flow/cli`, `ruvector`, and `ruv-swarm` installations. Handles direct installs, umbrella layouts, and deduplicates by realpath.
2. **Patching** (`patch-all.sh`) concatenates `lib/common.py` with every `patch/*/fix.py` (sorted by numeric execution-order prefix via `sort -V`) and runs them as a single Python process against each discovered install.
3. **Verification** (`check-patches.sh`) reads `patch/*/sentinel` files and confirms each patch is still present. If any sentinel fails, it auto-runs `patch-all.sh` to reapply.
4. **Repair** (`repair-post-init.sh`) rehydrates `.claude/helpers` in projects that were initialized before patches were applied.

All patches use `patch()` / `patch_all()` helpers that are idempotent -- safe to run multiple times. Re-running produces "0 applied, N already present".

## Patch Structure

Each defect lives in its own directory under `patch/`:

```
patch/{ORDER}-{PREFIX}-{NNN}-{slug}/
  README.md    # Root cause, fix description, severity, GitHub link
  fix.py       # patch()/patch_all() calls (idempotent)
  sentinel     # Verification directives for check-patches.sh
```

- **ORDER**: Numeric execution-order prefix (e.g. `010`, `370`, `1210`). Spaced by 10 to allow insertions. Controls dependency ordering.
- **PREFIX-NNN**: Defect ID tied to a GitHub issue (e.g. `HW-001`, `WM-028`)
- **slug**: Lowercase-kebab-case summary

### Sentinel Directives

Each `sentinel` file declares how `check-patches.sh` verifies the patch:

| Directive | Meaning |
|-----------|---------|
| `grep "pattern" file` | Pass if pattern is found in file (standard check) |
| `absent "pattern" file` | Pass if pattern is **not** found (removal check) |
| `none` | No sentinel -- skip verification |
| `package: ruvector` | Gate on optional package; skipped if not installed |

Adding a new patch requires no edits to any script -- just create the directory with `README.md`, `fix.py`, and `sentinel`.

## Target Packages

| Package | Install | Patched files | Env var |
|---------|---------|---------------|---------|
| `ruflo` (wraps `@claude-flow/cli`) | `npx ruflo` | `~/.npm/_npx/*/node_modules/@claude-flow/cli/dist/src/` | `BASE` |
| `ruvector` | (bundled) | `~/.npm/_npx/*/node_modules/ruvector/bin/cli.js` | `RUVECTOR_CLI` |
| `ruv-swarm` | (bundled) | `~/.npm/_npx/*/node_modules/ruv-swarm/` | `RUV_SWARM_ROOT` |

`BASE` is set by `patch-all.sh`. All path variables in `lib/common.py` derive from it.

## Defect Categories

Patches are organized by prefix into categories:

| Prefix | Category |
|--------|----------|
| CF | Config & Doctor |
| DM | Daemon & Workers |
| EM | Embeddings & HNSW |
| GV | Ghost Vectors |
| HK | Hooks |
| HW | Headless Worker |
| IN | Intelligence |
| MM | Memory Management |
| NS | Memory Namespace |
| RS | ruv-swarm |
| RV | RuVector Intelligence |
| SG | Settings Generator |
| UI | Display & Cosmetic |
| WM | Wiring / Memory Integration |
| MC | MCP Configuration |
| DOC | Documentation |

## Init-Script Patches

Several patches target the **init/generator scripts** (`executor.js`, `settings-generator.js`, `helpers-generator.js`). These fix the code that *generates* your `.claude/` project files -- but applying patches does **not** update files already generated in your project.

If your project was initialized before patching:

**Option A: Run `repair`** (recommended)

```bash
ruflo-patch apply --global
ruflo-patch repair --target .
```

**Option B: Re-run init upgrade** (regenerates from patched scripts)

```bash
ruflo-patch apply --global
npx @claude-flow/cli@latest init upgrade --force
```

Caution: Option B may overwrite other customizations in `.claude/`.

## Auto-Reapply on Update

When `npx` fetches a new version of `@claude-flow/cli`, it replaces cached files and wipes all patches. Use one of these approaches to auto-detect and reapply.

### Claude Code Hook (recommended for AI agents)

Add to your project's `.claude/settings.json`:

```jsonc
{
  "hooks": {
    "session_start": [
      {
        "command": "ruflo-patch check --global",
        "timeout": 30000
      }
    ]
  }
}
```

### Cron (headless environments)

```bash
*/5 * * * * ruflo-patch check --global >> /tmp/patch-sentinel.log 2>&1
```

### npm postinstall

```jsonc
{
  "scripts": {
    "postinstall": "npx --yes @ruflo/patch apply --target ."
  }
}
```

`check-patches.sh` is fast and idempotent -- under 2 seconds when patches are intact. If any sentinel fails, it reapplies automatically.

## Repository Structure

```
ruflo-patch/
  bin/ruflo-patch.mjs      CLI entry point
  patch-all.sh             Apply all patches (globs patch/*/fix.py dynamically)
  check-patches.sh         Sentinel: reads patch/*/sentinel files dynamically
  repair-post-init.sh      Post-init helper repair
  lib/
    common.py              Shared patch()/patch_all() helpers + path variables
    discover.mjs           Dynamic patch discovery (single source of truth)
    discover.sh            Bash install discovery (npx cache, global prefix)
    categories.json        Prefix-to-label mapping
  scripts/
    preflight.mjs          Pre-commit sync: doc tables, versions
    test-runner.mjs        Test runner with skip threshold enforcement
    upstream-log.mjs       Show recent upstream releases
  patch/
    {NNN}-{ID}-{slug}/     One directory per defect
      README.md            Defect report
      fix.py               Idempotent patch script
      sentinel             Verification directives
  tests/                   node:test test suites
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm test` | Run test suite |
| `npm run preflight` | Sync generated doc tables and validate consistency |
| `npm run preflight:check` | CI mode -- exits 1 if anything is out of date |
| `npm run upstream-log` | Show recent upstream releases |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PATCH_INCLUDE` | Regex to include only matching patch directories |
| `PATCH_EXCLUDE` | Regex to exclude matching patch directories |

## Key Design Decisions

- **Zero-maintenance discovery**: `patch-all.sh`, `check-patches.sh`, and doc generation all discover patches dynamically -- no hardcoded lists.
- **Idempotent**: `patch()` checks if the replacement string is already present before modifying.
- **Non-destructive**: Patches only modify the npx cache, never the npm registry package.
- **Platform-aware**: macOS-specific patches auto-skip on Linux.
- **Sentinel-guarded**: `check-patches.sh` detects cache wipes and auto-reapplies.

## Compatibility

- Tested against `ruflo@latest` (wraps `@claude-flow/cli`)
- Requires Python 3.6+ and Bash
- Works on Linux and macOS

## License

MIT
