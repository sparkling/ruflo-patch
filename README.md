# @ruflo/patch

Runtime patches for `@claude-flow/cli`, `ruvector`, and `ruv-swarm`.

Applies idempotent, folder-per-defect hotfixes to installed packages without waiting for upstream releases. Each patch targets a specific GitHub issue, ships its own `fix.py`, sentinel check, and documentation.

## Requirements

- Node.js >= 20
- Python 3 (for patch scripts)
- Bash

## Install

```bash
npm install -g @ruflo/patch
```

Or run directly:

```bash
npx @ruflo/patch apply
```

## Usage

```
ruflo-patch apply  [--global] [--target <dir>]   Apply all patches
ruflo-patch check  [--global] [--target <dir>]   Verify patches are applied
ruflo-patch repair [--target <dir>]              Repair post-init helpers
ruflo-patch --help                               Show help
```

### Options

| Flag | Description |
|------|-------------|
| `--global` | Patch all global installs (npx cache + npm global prefix) |
| `--target <dir>` | Patch `node_modules` inside a specific directory |

If neither flag is given, `--global` is assumed.

### Examples

```bash
# Patch all global installs
ruflo-patch apply

# Patch a specific project
ruflo-patch apply --target ~/my-project

# Verify patches are still applied after an npm install
ruflo-patch check

# Repair helper files in a project initialized before patching
ruflo-patch repair --target ~/my-project
```

## How It Works

1. **Discovery** (`lib/discover.sh`) scans npx cache and npm global prefix for `@claude-flow/cli`, `ruvector`, and `ruv-swarm` installations.
2. **Patching** (`patch-all.sh`) concatenates `lib/common.py` with every `patch/*/fix.py` (sorted by execution-order prefix) and runs them against each discovered install.
3. **Verification** (`check-patches.sh`) reads `patch/*/sentinel` files and confirms each patch is still present.
4. **Repair** (`repair-post-init.sh`) rehydrates `.claude/helpers` in projects that were initialized before patches were applied.

All patches use `patch()` / `patch_all()` helpers that are idempotent -- safe to run multiple times.

## Patch Structure

Each defect lives in its own directory under `patch/`:

```
patch/{ORDER}-{PREFIX}-{NNN}-{slug}/
  README.md    # Root cause, fix description, severity, GitHub link
  fix.py       # patch()/patch_all() calls
  sentinel     # Verification directives (grep/absent patterns)
```

- **ORDER**: Numeric execution-order prefix (e.g. `010`, `370`)
- **PREFIX-NNN**: Defect ID tied to a GitHub issue (e.g. `HW-001`)
- **slug**: Human-readable name

## Scripts

| Command | Description |
|---------|-------------|
| `npm test` | Run test suite |
| `npm run preflight` | Sync generated doc tables and validate consistency |
| `npm run preflight:check` | CI mode -- exits 1 if anything is out of date |
| `npm run upstream-log` | Show upstream changelog context |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PATCH_INCLUDE` | Regex to include only matching patch directories |
| `PATCH_EXCLUDE` | Regex to exclude matching patch directories |

## License

MIT
