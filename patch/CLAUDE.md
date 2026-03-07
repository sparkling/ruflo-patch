# @ruflo/patch — Patching Methodology

Runtime patches for `ruflo` (latest), `ruvector`, and `ruv-swarm`.

## Terminology

| Term | Meaning | Example |
|------|---------|---------|
| **Defect** | A tracked problem with its own directory, README, and fix.py | "Defect HW-001" |
| **Patch** | The code change addressing a defect | `fix.py` contains `patch()` calls |
| **Defect ID** | Unique identifier: `{PREFIX}-{NNN}` | HW-001, NS-003 |
| **Execution order** | Numeric prefix on directory name, spaced by 10 | `010-`, `370-` |

## Rules

- NEVER create patches for this local repo -- ALL patches target the upstream npx package (`@claude-flow/cli`, `ruvector`, `ruv-swarm`)
- NEVER modify files inside the npm/npx cache directly -- edit `fix.py` scripts in `patch/`
- NEVER run individual `fix.py` files standalone -- always use `bash patch-all.sh`
- NEVER delete a defect without confirming it is truly obsolete
- NEVER reuse a defect ID
- ONE defect directory and ONE fix.py per defect
- ALWAYS verify with `bash check-patches.sh` after applying
- ALWAYS run `npm run preflight` before staging

## Target Packages

| Package | Install | Env var |
|---------|---------|---------|
| `ruflo` (wraps `@claude-flow/cli`) | `npx ruflo` | `BASE` |
| `ruvector` | (bundled) | `RUVECTOR_CLI` |
| `ruv-swarm` | (bundled) | `RUV_SWARM_ROOT` |

## Defect Categories

<!-- GENERATED:defect-tables:begin -->
| Prefix | Category | Count |
|--------|----------|-------|
| MC | MCP Configuration | 1 |
| FB | Fallback Instrumentation | 3 |
| SV | Semver Conflict Resolution | 3 (1 active, 2 retired) |
| SG | SG | 1 |

## All 8 Defects (6 active, 2 retired)

| ID | GitHub Issue | Severity | Status |
|----|-------------|----------|--------|
| MC-001 | MCP claude-flow server fails to start due to autoStart: false | High | Active |
| FB-001 | Instrument upstream fallback paths with debug logging | High | Active |
| FB-002 | Instrument local helper fallback code paths with debug logging | Enhancement | Active |
| FB-004 | Lower search threshold for hash-based embeddings | Medium | Active |
| SV-001 | Fix @ruvector/ruvllm semver range in agentic-flow | Critical | Active |
| SV-002 | Fix agentdb pin in @claude-flow/memory | Critical | **Retired** — codemod uses `*` |
| SV-003 | Fix agentdb range in agentic-flow | Critical | **Retired** — codemod uses `*` |
| SG-003 | Init missing helpers for --dual, --minimal, hooks, and upgrade paths | Critical | Active |
<!-- GENERATED:defect-tables:end -->

## Creating a New Defect

### Step 1: Choose a defect ID

Format: `{PREFIX}-{NNN}`. NEVER reuse an ID.

### Step 2: Create the defect directory

```bash
mkdir -p patch/{ORDER}-{PREFIX}-{NNN}-{slug}/
```

### Step 3: Write README.md

```markdown
# {PREFIX}-{NNN}: Short title

**Severity**: Critical | High | Medium | Low | Enhancement

## Root Cause
<What's wrong and why.>

## Fix
<What the patch does.>

## Files Patched
- <relative path from dist/src/>

## Ops
<N> ops in fix.py
```

### Step 4: Write fix.py and sentinel

```python
# {PREFIX}-{NNN}: Short title
# NOTE: Do NOT add `import` or `from common import` — patch-all.sh concatenates
# common.py + all fix.py files into a single script. Just use patch()/patch_all()
# and path variables (INIT_CMD, EXECUTOR, etc.) directly.

patch("{PREFIX}-{NNN}a: description",
    TARGET_VAR,
    """old string""",
    """new string""")
```

Sentinel directives:
```
grep "unique_string" path/to/target.js
absent "old_string" path/to/target.js
none
package: ruvector
```

**Patch API**:
- `patch(label, filepath, old, new)` -- replace first occurrence
- `patch_all(label, filepath, old, new)` -- replace ALL occurrences

Both are idempotent.

### Step 5: Update and test

```bash
npm run preflight
bash patch-all.sh --global    # quick local verification only
bash check-patches.sh
npm test
```

### Step 6: Deploy

After verifying locally, publish to deploy the fix to end users:

```bash
# Full pipeline: pull upstream → codemod → patch → build → publish
bash scripts/sync-and-build.sh
```

The build pipeline (`scripts/sync-and-build.sh`) pulls upstream, copies to a temp dir,
runs the codemod, applies patches via `patch-all.sh --target <build-dir>`, then publishes
the patched result to npm as `@sparkleideas/*`. Users get fixes via `npx @sparkleideas/cli`.

For testing the pipeline without publishing to real npm, use the integration test which
publishes to a local Verdaccio registry:

```bash
bash scripts/test-integration.sh
```

### Checklist

- [ ] `README.md`, `fix.py`, `sentinel` created
- [ ] Path variable in `lib/common.py` (if new file)
- [ ] New prefix in `lib/categories.json` (if new category)
- [ ] `npm run preflight` passes
- [ ] `bash patch-all.sh` applies + is idempotent
- [ ] `bash check-patches.sh` shows OK
- [ ] `npm test` passes
- [ ] Publish pipeline run to deploy fix

## Patch Deployment Model

Patches are **NOT** applied to the npx cache for production use. The correct flow is:

1. **Author** — create `patch/{ORDER}-{ID}-{slug}/` with `fix.py`, `README.md`, `sentinel`
2. **Verify** — `patch-all.sh --global` for quick local testing against the npx cache
3. **Publish** — `bash scripts/sync-and-build.sh` pulls upstream, runs codemod, applies patches
   via `patch-all.sh --target <build-dir>`, then publishes patched packages to npm
4. **Consume** — users run `npx @sparkleideas/cli` which pulls the published (already-patched) version

`patch-all.sh --global` is a **developer shortcut** for testing patches against the local npx
cache. It does NOT deploy fixes to end users. Only publishing does that.

`patch-all.sh --target <dir>` is the **build pipeline mode** used by `sync-and-build.sh`
to apply patches to the build artifact before publishing.

```
patch-all.sh modes:
  --global           → patches local npx cache (dev/debug only)
  --target <dir>     → patches a build copy (used by publish pipeline)
```
