# @ruflo/patch — Patching Methodology

Runtime patches for `ruflo` (latest), `ruvector`, and `ruv-swarm`.

## Terminology

| Term | Meaning | Example |
|------|---------|---------|
| **Defect** | A tracked problem with its own directory, README, and fix.py | "Defect HW-001" |
| **Patch** | The code change addressing a defect | `fix.py` contains `patch()` calls |
| **GitHub issue** | Upstream issue on github.com/ruvnet/claude-flow | "GitHub issue #1111" |
| **Defect ID** | Unique identifier: `{PREFIX}-{NNN}` | HW-001, NS-003 |
| **Execution order** | Numeric prefix on directory name, spaced by 10 | `010-`, `370-` |

## Rules

- NEVER modify files inside the npm/npx cache directly -- edit `fix.py` scripts in `patch/`
- NEVER run individual `fix.py` files standalone -- always use `bash patch-all.sh`
- NEVER delete a defect without confirming it is truly obsolete
- NEVER reuse a defect ID that was previously assigned to a different GitHub issue
- ONE defect directory and ONE fix.py per GitHub issue
- ALWAYS verify with `bash check-patches.sh` after applying
- ALWAYS run `npm run preflight` before staging
- ALWAYS commit often

## Target Packages

| Package | Install | Env var |
|---------|---------|---------|
| `ruflo` (wraps `@claude-flow/cli`) | `npx ruflo` | `BASE` |
| `ruvector` | (bundled) | `RUVECTOR_CLI` |
| `ruv-swarm` | (bundled) | `RUV_SWARM_ROOT` |

## GitHub Issue Policy

Every defect MUST link to exactly one GitHub issue. Search first:

```bash
gh issue list --repo ruvnet/claude-flow --search "<keywords>" --limit 10
```

## Defect Categories

<!-- GENERATED:defect-tables:begin -->
| Prefix | Category | Count |
|--------|----------|-------|

## All 0 Defects

| ID | GitHub Issue | Severity |
|----|-------------|----------|
<!-- GENERATED:defect-tables:end -->

## Creating a New Defect

### Step 1: Find or create a GitHub issue

### Step 2: Choose a defect ID

Format: `{PREFIX}-{NNN}`. NEVER reuse an ID.

### Step 3: Create the defect directory

```bash
mkdir -p patch/{ORDER}-{PREFIX}-{NNN}-{slug}/
```

### Step 4: Write README.md

```markdown
# {PREFIX}-{NNN}: Short title

**Severity**: Critical | High | Medium | Low | Enhancement
**GitHub**: [#{number}](https://github.com/ruvnet/claude-flow/issues/{number})

## Root Cause
<What's wrong and why.>

## Fix
<What the patch does.>

## Files Patched
- <relative path from dist/src/>

## Ops
<N> ops in fix.py
```

### Step 5: Write fix.py and sentinel

```python
# {PREFIX}-{NNN}: Short title
# GitHub: #{number}

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

### Step 6: Update and test

```bash
npm run preflight
bash patch-all.sh --global
bash check-patches.sh
npm test
```

### Checklist

- [ ] GitHub issue exists
- [ ] `README.md`, `fix.py`, `sentinel` created
- [ ] Path variable in `lib/common.py` (if new file)
- [ ] New prefix in `lib/categories.json` (if new category)
- [ ] `npm run preflight` passes
- [ ] `bash patch-all.sh` applies + is idempotent
- [ ] `bash check-patches.sh` shows OK
- [ ] `npm test` passes
