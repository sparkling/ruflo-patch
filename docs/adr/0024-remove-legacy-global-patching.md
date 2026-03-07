# ADR-0024: Remove Legacy Global Patching

- **Status**: Accepted
- **Date**: 2026-03-07
- **Deciders**: ruflo-patch maintainers
- **Methodology**: SPARC + MADR

## Decision Drivers

- The repackaging pipeline (ADR-0005, ADR-0022) bakes patches into published `@sparkleideas/*` packages at build time
- Users install `@sparkleideas/cli`, not `@claude-flow/cli` — runtime patching of the npx cache is obsolete
- The `--global` code path patches the wrong target (`@claude-flow/cli` in `~/.npm/_npx/`)
- `repair-post-init.sh` exists only to reapply patches wiped by npx cache updates — irrelevant when patches are pre-baked
- Legacy CLI commands (`ruflo apply/check/repair`) expose infrastructure that users never need
- `check-patches.sh --global` in Layer 0 verifies sentinels against the local npx cache, not the build output — false confidence

## Context and Problem Statement

### Specification (SPARC-S)

The project has two patching models that coexist:

**Old model** (pre-repackaging): Users ran `npx @claude-flow/cli`. Patches were applied to the local npx cache via `patch-all.sh --global`. Every npx cache update wiped them. `check-patches.sh --global` detected wipes and auto-reapplied. `repair-post-init.sh` handled post-init remediation. `bin/ruflo.mjs` exposed `apply`, `check`, and `repair` CLI commands.

**New model** (repackaging pipeline, ADR-0005/0022): Users run `npx @sparkleideas/cli`. `sync-and-build.sh` Phase 8 calls `patch-all.sh --target <build-dir>` against compiled `dist/src/*.js` files. The patched result is published to npm. Users get pre-patched packages. No runtime patching needed.

The old model's `--global` code path, `repair-post-init.sh`, and CLI patch commands are dead code — they operate on a package (`@claude-flow/cli`) that users no longer install. Keeping them creates confusion about which patching model is active and which verification commands are meaningful.

### Pseudocode (SPARC-P)

```
Current patch-all.sh:
  if --global:
    targets = discover_all_cf_installs()    # scans ~/.npm/_npx/ for @claude-flow/cli
    apply patches to each target
  if --target <dir>:
    targets = discover_target_installs(dir)  # scans build dir for @claude-flow/cli/dist/src/
    apply patches to each target

After this ADR:
  require --target <dir>
  targets = discover_target_installs(dir)
  apply patches to each target
```

## Considered Options

### Option A: Mark as deprecated, keep code

Add deprecation warnings to `--global` and legacy CLI commands. No code removal.

- Pro: Zero risk of breaking anything
- Con: Dead code persists, instructions remain confusing, `check-patches.sh` in Layer 0 still verifies the wrong target

### Option B: Remove legacy code paths (chosen)

Remove `--global` from `patch-all.sh` and `check-patches.sh`. Delete `repair-post-init.sh`. Remove `apply/check/repair` from `bin/ruflo.mjs`. Clean up `lib/discover.sh`.

- Pro: Clean codebase, unambiguous instructions, no false-confidence sentinel checks
- Con: Cannot patch local npx cache anymore (but this is the point — users don't need it)

## Decision

### Architecture (SPARC-A)

Option B. Remove all legacy global patching infrastructure.

**Scripts modified:**

| File | Change |
|------|--------|
| `patch-all.sh` | Remove `--global` flag, make `--target` required |
| `check-patches.sh` | Remove `--global` flag, make `--target` required, remove auto-reapply |
| `repair-post-init.sh` | Delete |
| `bin/ruflo.mjs` | Remove `apply/check/repair` commands and `runBash` helper |
| `lib/discover.sh` | Remove `discover_all_cf_installs()` and `_cfp_npx_cache_roots()` |
| `package.json` | Remove 3 scripts from `files` array |

**Docs updated:**

| File | Change |
|------|--------|
| `tests/CLAUDE.md` | Full rewrite — remove `check-patches.sh` and `--global` from test matrix, document `sync-and-build.sh --test-only` as Layers -1–3 runner |
| `patch/CLAUDE.md` | Remove `--global` references from checklist and deployment model |
| Memory `MEMORY.md` | Update testing table and patch workflow to match |

**Pipeline callers unchanged** — already use `--target`:
- `sync-and-build.sh` line 255: `patch-all.sh --target ${TEMP_DIR}`
- `test-integration.sh` line 588: `patch-all.sh --target ${TEMP_BUILD}`

**Layer 0 change**: Remove `check-patches.sh` from pre-commit. Sentinel verification happens inside the pipeline (test-integration.sh Phase 4, sync-and-build.sh Phase 8). Pre-commit testing simplified to `npm run preflight && npm test`.

### Refinement (SPARC-R)

**New patch workflow** (post-removal):

1. Create `patch/{ORDER}-{PREFIX}-{NNN}-{slug}/` with `README.md`, `fix.py`, `sentinel`
2. Add path variable in `lib/common.py` if targeting a new file
3. `npm run preflight && npm test` — all pass
4. Commit
5. Deploy: `bash scripts/sync-and-build.sh` (or wait for 6h systemd timer)

Patches are auto-discovered by the pipeline — `patch-all.sh` globs `patch/*/fix.py` sorted by numeric prefix. No manual wiring needed.

**Pre-commit test matrix** (updated):

| Change type | Layers | Commands |
|-------------|--------|----------|
| Patch `fix.py` | 0, 1 | `npm run preflight && npm test` |
| Test scripts | 0, 1 | `npm run preflight && npm test` |
| Codemod or pipeline script | 0, 1, 2 | above + `bash scripts/test-integration.sh` |
| sync-and-build.sh or RQ | 0–3 | `bash scripts/sync-and-build.sh --test-only` |
| Deploy to npm | 0–4 | `bash scripts/sync-and-build.sh` |
| Verify live packages | 4 | `bash scripts/test-acceptance.sh` |

## Consequences

### Completion (SPARC-C)

**Positive:**
- Unambiguous patching model — patches only flow through the build pipeline
- No false-confidence sentinel checks against the wrong target
- Simplified pre-commit testing (`npm run preflight && npm test`)
- ~200 lines of dead code removed
- New contributors cannot be confused by two coexisting patching models

**Negative:**
- Cannot patch local `@claude-flow/cli` npx cache anymore (intentional — users don't use it)
- Developers who used `--global` for quick local testing must use `sync-and-build.sh --test-only` instead (slower but tests what users actually get)

**Neutral:**
- Existing ADRs (0002, 0004, 0007) reference `--global` — they remain as historical records

## Relates To

- **ADR-0005**: Fork + build-step rename (established the repackaging pipeline)
- **ADR-0007**: Drop-in replacement UX (introduced `repair-post-init.sh` and CLI patch commands — this ADR supersedes those aspects)
- **ADR-0022**: Full ecosystem repackaging (made `@sparkleideas/*` the user-facing packages)
- **ADR-0023**: Google testing framework (defines the 6-layer test model referenced here)
