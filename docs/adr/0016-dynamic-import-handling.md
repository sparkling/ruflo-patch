# ADR-0016: Dynamic Import Handling

## Status

Accepted

## Context

### Specification (SPARC-S)

The scope-rename codemod (ADR-0005) transforms static import and require statements, rewriting `@claude-flow/*` to `@sparkleideas/*` across ~3,875 JS/TS source files. However, the upstream codebase contains dynamic imports where package names are constructed at runtime. These cannot be caught by static string replacement.

The confirmed case is `memory-bridge.js`, which dynamically imports `@claude-flow/memory` (documented in the versioning analysis, section 12). The general patterns at risk include:

- `require('@claude-flow/' + name)` -- string concatenation with a literal prefix
- `` import(`@claude-flow/${name}`) `` -- template literal with a literal prefix
- `const scope = '@claude-flow'; require(scope + '/memory')` -- variable holding the scope string
- `require(packageMap[key])` -- fully indirect lookup from a data structure

If any of these survive the codemod untransformed, the published package will throw `MODULE_NOT_FOUND` at runtime when the dynamic import executes, because `@claude-flow/memory` does not exist in the user's `node_modules` -- only `@sparkleideas/memory` does.

This addresses review issue C2 from the ADR review report.

### Pseudocode (SPARC-P)

```
PHASE 1 — Audit (one-time, re-run on major upstream changes):
  grep -rn "require.*@claude-flow.*+" upstream/
  grep -rn "import.*@claude-flow.*\$\{" upstream/
  grep -rn "'@claude-flow/'" upstream/   # literal prefix strings
  -> produce inventory: file, line number, pattern type, transformable?

PHASE 2 — Codemod special cases:
  FOR each pattern where '@claude-flow/' is a string literal:
    # e.g., '@claude-flow/' + name  ->  '@sparkleideas/' + name
    REPLACE the literal portion only
    # The variable portion (name) is untouched

PHASE 3 — Targeted patches for remaining cases:
  FOR each pattern that is fully indirect (variable scope, lookup table):
    CREATE a patch in patch/ that rewrites the specific import site
    # e.g., replace `require(packageMap[key])` with a lookup table
    #   that maps old names to new names
```

## Decision

### Architecture (SPARC-A)

Handle dynamic imports with a three-layer strategy, ordered from broadest coverage to most surgical:

**Layer 1: Codemod catches literal prefixes.** Most dynamic imports in the upstream codebase use a recognizable literal prefix -- either `'@claude-flow/' + variable` or `` `@claude-flow/${variable}` ``. The codemod already rewrites string literals containing `@claude-flow/`. Because the prefix is a distinct string token, the codemod transforms `'@claude-flow/'` to `'@sparkleideas/'` and the variable portion passes through unchanged. This handles the majority of dynamic import sites with zero additional work.

**Layer 2: Audit produces a complete inventory.** Before the first build, run a grep-based audit across all upstream source files to identify every occurrence of `@claude-flow` that is not a simple static import. The audit script lives at `scripts/audit-dynamic-imports.sh` and outputs a manifest: file path, line number, the matched pattern, and whether Layer 1 handles it. This audit must be re-run whenever upstream changes significantly (new packages added, major refactors).

**Layer 3: Targeted patches for edge cases.** For any dynamic import site that Layer 1 cannot handle -- such as a variable holding the full scope string, or a lookup table mapping package names -- create a targeted patch in `patch/` following the existing FB-* pattern. Each patch rewrites the specific import site to use the correct `@sparkleideas/` scope. These patches are maintained alongside FB-001/FB-002/MC-001 and are applied during the build after the codemod.

The key insight is that Layer 1 covers the common case (literal prefix concatenation) automatically. Layer 3 is only needed for truly indirect references, which are rare in practice because most codebases use a recognizable prefix string even in dynamic imports.

### Considered Alternatives

1. **Publish shim packages under the original `@claude-flow/*` names** -- Rejected. We do not own the `@claude-flow` npm scope and cannot publish there. Attempting to shadow them with npm `overrides` in the consumer's `package.json` would require every user to add configuration, defeating the drop-in replacement goal.

2. **Use npm `overrides` in the top-level `package.json` to alias `@claude-flow/*` to `@sparkleideas/*`** -- Rejected. npm `overrides` affect dependency resolution, not runtime `require()` calls. A dynamic `require('@claude-flow/memory')` still looks for that exact package in `node_modules`. Overrides do not create filesystem aliases.

3. **Bundle all packages into a single fat bundle to eliminate cross-package imports** -- Rejected. Already evaluated and rejected in ADR-0005 (Approach 6). Dynamic imports in `memory-bridge.js` and native addons (`better-sqlite3`, ruvector napi-rs) break bundling.

4. **Ignore dynamic imports and fix runtime errors as they surface** -- Rejected. `MODULE_NOT_FOUND` errors would occur in production use, creating a poor first impression and eroding trust. The audit is a one-time cost that prevents an entire class of runtime failures.

## Consequences

### Refinement (SPARC-R)

**Positive:**

- The three-layer strategy provides defense in depth -- most cases are handled automatically, edge cases are caught by the audit, and remaining cases get targeted patches
- The audit script is reusable across upstream updates -- run it to detect new dynamic import patterns introduced by upstream
- Layer 1 (codemod catches literal prefixes) requires no additional maintenance -- it falls out naturally from the existing string replacement logic
- Targeted patches (Layer 3) follow the established patch infrastructure, so no new tooling is needed

**Negative:**

- The audit must be re-run when upstream changes significantly, adding a manual step to the sync process
- Targeted patches for dynamic imports are fragile -- if upstream refactors the import site, the patch breaks (same limitation as all existing patches, mitigated by sentinel verification)
- If upstream introduces a new dynamic import pattern that Layer 1 does not catch and the audit is not re-run, the failure will surface at runtime

**Edge cases:**

- If upstream moves to a fully dynamic plugin loading system (e.g., reading package names from a config file at runtime), Layer 1 and Layer 3 cannot help. This would require a different approach such as a runtime module resolution hook. This scenario is unlikely given current upstream architecture
- Template literals with nested expressions (`` `@claude-flow/${getScope(config)}` ``) are handled by Layer 1 as long as the `@claude-flow/` prefix is a literal portion of the template

### Completion (SPARC-C)

Acceptance criteria:

- [ ] `scripts/audit-dynamic-imports.sh` exists and produces a manifest of all dynamic import sites referencing `@claude-flow`
- [ ] The audit manifest documents each site as "handled by codemod" or "requires targeted patch"
- [ ] Every site marked "requires targeted patch" has a corresponding patch in `patch/`
- [ ] `memory-bridge.js` dynamic import of `@claude-flow/memory` is confirmed handled (either by codemod or patch)
- [ ] Running the built packages with `npx ruflo-patch` does not produce `MODULE_NOT_FOUND` errors for any `@claude-flow/*` package
- [ ] The audit script is documented in the build pipeline so it is re-run on major upstream changes
