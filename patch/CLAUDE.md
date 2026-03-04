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
- ALWAYS commit often

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

## All 1 Defects

| ID | GitHub Issue | Severity |
|----|-------------|----------|
| MC-001 | MCP claude-flow server fails to start due to autoStart: false | High |
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
bash patch-all.sh --global
bash check-patches.sh
npm test
```

### Checklist

- [ ] `README.md`, `fix.py`, `sentinel` created
- [ ] Path variable in `lib/common.py` (if new file)
- [ ] New prefix in `lib/categories.json` (if new category)
- [ ] `npm run preflight` passes
- [ ] `bash patch-all.sh` applies + is idempotent
- [ ] `bash check-patches.sh` shows OK
- [ ] `npm test` passes
