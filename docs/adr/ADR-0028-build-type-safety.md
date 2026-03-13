# ADR-0028: Build Type Safety — Eliminating noCheck Fallback

## Status

Accepted

## Context

### Problem Statement (Specification)

The build pipeline (`sync-and-build.sh`) compiled TypeScript packages using a three-level fallback:

1. `tsc --skipLibCheck` (full type-check + emit)
2. `tsc --skipLibCheck --noCheck` (emit without type-checking)
3. `tsc --skipLibCheck --noCheck --isolatedModules` (last resort)

Only 2 of 56 packages passed level 1. The remaining 54 silently fell through to `--noCheck` or failed entirely — producing **no `dist/` output** for 19 published packages. Errors were piped to `/dev/null`, masking the failures.

This caused:
- `ERR_MODULE_NOT_FOUND` at runtime for 11 of 16 acceptance tests
- Packages published to npm with `main: "dist/index.js"` but no `dist/` directory
- Zero visibility into build health (errors swallowed)

### Root Causes Identified

| Category | Error Codes | Packages Affected | Root Cause |
|----------|-------------|-------------------|------------|
| Project references | — | All 21 v3 packages | `composite: true` kept after removing `references` |
| rootDir violation | TS6059, TS6307 | cli | Relative imports to `../../../swarm/` escape rootDir |
| rootDir mismatch | — | 19 packages | Build set `rootDir: '.'` overriding `rootDir: './src'`, changing output path |
| Test files in src/ | TS2307 (vitest) | 7 packages | `*.test.ts` files import `vitest` which isn't installed |
| Missing @types | TS7016 | mcp, codex | `express`, `cors`, `fs-extra` lack type declarations |
| Missing module stubs | TS2307 | embeddings | `agentic-flow/embeddings` has no types |
| Upstream type bugs | TS2554, TS2339, etc. | shared, security, browser, performance, providers | Zod v4 API changes, casing mismatches |
| Packages outside build path | — | 17 packages | `v3/plugins/*` and `cross-repo/*` not in build loop |

## Decision (Pseudocode → Architecture)

### Algorithm

```
FOR each package with tsconfig.json:
  1. STRIP composite and references (standalone build)
  2. PRESERVE original rootDir (don't override './src' → '.')
  3. EXCLUDE **/*.test.ts, **/*.spec.ts, **/__tests__/**
  4. MAP sibling @sparkleideas/* packages via paths for cross-package type resolution
  5. ADD @types from tsc toolchain (express, cors, fs-extra)
  6. ADD stubs for optional modules (agentic-flow/embeddings, onnxruntime-node)
  7. TRY level 1 (full type-check)
  8. FALLBACK to level 2 (--noCheck) only for upstream code bugs (category 6)
  9. LOG errors instead of /dev/null
```

### Architecture

```
/tmp/ruflo-tsc-toolchain/
  node_modules/
    typescript@5
    @types/express
    @types/cors
    @types/fs-extra
  stubs/
    agentic-flow_embeddings.d.ts    # Optional module stubs
    onnxruntime-node.d.ts

tsconfig.build.json (generated per-package):
  compilerOptions:
    composite: false (deleted)
    rootDir: preserved from original
    skipLibCheck: true
    paths: { "@sparkleideas/*": ["../*/src/index.ts"] }
    typeRoots: [toolchain/@types, ./node_modules/@types]
  exclude: ["**/*.test.ts", "**/*.spec.ts", "**/__tests__/**"]
```

### Build Coverage (expanded)

```
v3/@claude-flow/*              21 packages (main build groups 0-4)
v3/plugins/*                   13 packages (plugin packages)
cross-repo/agentic-flow/       agentdb, agentdb-onnx, agentic-flow root
```

### Fork Patch: SG-004

Cross-package relative imports in `cli/src/infrastructure/in-memory-repositories.ts`:

```typescript
// BEFORE: violates rootDir, blocks all CLI emit
import { Agent } from '../../../swarm/src/domain/entities/agent.js';

// AFTER: local copies in _swarm-types/
import { Agent } from './_swarm-types/agent.js';
```

Four swarm type files copied into `cli/src/infrastructure/_swarm-types/`.

## Consequences (Refinement → Completion)

### Results

| Metric | Before | After |
|--------|--------|-------|
| Packages compiling | 2/56 | 38/41 |
| Published packages with working `dist/` | 2/41 | 38/41 |
| Acceptance tests passing | 5/16 | 14/16 |
| Build errors visible | 0% (swallowed) | 100% (logged) |
| Pipeline total time | 14+ min | ~114s |

### Remaining Items (noCheck still needed)

5 packages still require `--noCheck` due to upstream type bugs:

| Package | Errors | Issue |
|---------|--------|-------|
| shared | 15 | Zod v4 API changes (`.string()` arity) |
| security | 8 | Zod v4 `.ip()`, error map types |
| browser | 2 | Zod v4 API changes |
| performance | 9 | `@ruvector/attention` export casing (PascalCase vs camelCase) |
| providers | 2 | Iterator downlevel (needs `downlevelIteration` flag) |

These are upstream code bugs — fixing them requires fork patches against the ruflo or agentic-flow repos.

### Remaining Acceptance Failures

| Test | Issue | Fix |
|------|-------|-----|
| T07 MCP config | `cli init` doesn't create `.mcp.json` | Upstream CLI init command |
| T08 ruflo init --full | npx subprocess timeout in background | Increase timeout or use local binary |

### Risks

- `--noCheck` fallback masks real type errors in the 5 affected packages
- Type stubs for optional modules (`agentic-flow/embeddings`) may drift from actual API
- `@types` packages in tsc toolchain need periodic updates

### Follow-up

- Fork patches for Zod v4 compat (shared, security, browser)
- Fork patch for `@ruvector/attention` casing (performance)
- Add `downlevelIteration: true` to providers tsconfig
- Remove `--noCheck` fallback once all upstream bugs are patched
