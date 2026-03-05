# Versioning & Packaging Analysis: ruvnet Ecosystem

**Date**: 2026-03-05
**Source**: 9-agent swarm analysis (3 discovery + 6 deep-dive) of npm registry, GitHub repos, commits/tags, issues/ADRs, local npx cache, and cross-package dependencies

---

## 1. Architecture Overview

The ruvnet ecosystem spans **48+ npm packages** across 4 scopes, published from 7+ GitHub repositories.

### Source Repositories

| Repo | Packages Published | Type |
|------|-------------------|------|
| `ruvnet/ruflo` | claude-flow, ruflo, @claude-flow/* (20 packages), coflow | pnpm monorepo |
| `ruvnet/ruvector` | ruvector, @ruvector/* (15+ packages) | Cargo/napi-rs monorepo |
| `ruvnet/agentic-flow` | agentic-flow, agentdb | npm workspaces monorepo |
| `ruvnet/ruv-FANN` | ruv-swarm | Subdirectory of FANN repo |
| `ruvnet/dspy.ts` | dspy.ts | Standalone |
| `ruvnet/sublinear-time-solver` | sublinear-time-solver | Standalone |
| `ruvnet/agenticsjs` | agenticsjs | Standalone |

### ruflo Monorepo Layout

```
ruvnet/ruflo/
├── package.json          (v3.5.2 — published as "claude-flow")
├── bin/                  (CLI entry points)
├── v2/                   (Legacy — excluded from npm)
├── v3/                   (Active development)
│   ├── package.json      (private @claude-flow/v3-monorepo)
│   ├── pnpm-workspace.yaml
│   └── @claude-flow/     (20 scoped packages)
├── packages/coflow/      (shorthand CLI wrapper, v3.1.0-alpha.4)
├── ruflo/                (unscoped CLI wrapper, v3.5.2)
└── plugin/               (Claude Code plugin integration)
```

### Publishing Config

- **Tooling**: pnpm workspaces
- **CI**: `.github/workflows/v3-ci.yml` — publishes on push to `v3` branch
- **Publish script**: `v3/@claude-flow/cli/scripts/publish.sh`
- **Root `files` glob**: Bundles `v3/@claude-flow/cli/dist/**`, `v3/@claude-flow/shared/dist/**`, `v3/@claude-flow/guidance/dist/**` directly into the root package
- **Publish sequence** (ADR-046): `@claude-flow/cli` → `claude-flow` → `ruflo`

---

## 2. Complete Dependency Tree (ruvnet packages only)

```
ruflo
└── @claude-flow/cli (direct)
    ├── @claude-flow/mcp (direct)
    ├── @claude-flow/shared (direct)
    └── [optional]
        ├── @claude-flow/memory
        │   └── agentdb
        │       ├── ruvector
        │       │   ├── @ruvector/core
        │       │   ├── @ruvector/attention
        │       │   ├── @ruvector/gnn
        │       │   └── @ruvector/sona
        │       └── @ruvector/graph-transformer
        ├── @claude-flow/guidance
        │   ├── @claude-flow/hooks
        │   │   ├── @claude-flow/memory (shared)
        │   │   ├── @claude-flow/neural
        │   │   │   ├── @ruvector/sona
        │   │   │   └── @claude-flow/memory (shared)
        │   │   └── @claude-flow/shared (shared)
        │   ├── @claude-flow/memory (shared)
        │   └── @claude-flow/shared (shared)
        ├── @claude-flow/embeddings
        ├── @claude-flow/codex
        ├── @claude-flow/aidefence
        ├── agentic-flow
        │   ├── @ruvector/core
        │   ├── @ruvector/router
        │   ├── @ruvector/ruvllm
        │   └── @ruvector/edge-full
        ├── @ruvector/sona
        ├── @ruvector/router
        ├── @ruvector/attention
        ├── @ruvector/learning-wasm
        └── @claude-flow/plugin-gastown-bridge
```

**Total ruvnet packages in tree**: 23 (max depth: 5 levels)
**No circular dependencies detected.**

---

## 3. @claude-flow/* Packages (20 packages)

### Version Status Matrix

| Package | Repo Version | npm Version | Status | Last Published | Gap |
|---------|-------------|-------------|--------|---------------|-----|
| `@claude-flow/cli` | 3.5.2 | 3.5.2 | In sync | 2026-02-28 | — |
| `@claude-flow/memory` | 3.0.0-alpha.11 | 3.0.0-alpha.11 | In sync (stale) | 2026-02-16 | 933 commits unpublished |
| `@claude-flow/mcp` | 3.0.0-alpha.8 | 3.0.0-alpha.8 | In sync | 2026-01-14 | — |
| `@claude-flow/neural` | 3.0.0-alpha.7 | 3.0.0-alpha.7 | In sync | 2026-01-23 | — |
| `@claude-flow/codex` | 3.0.0-alpha.9 | 3.0.0-alpha.9 | In sync | 2026-02-07 | — |
| `@claude-flow/claims` | 3.0.0-alpha.8 | 3.0.0-alpha.8 | In sync | 2026-01-23 | — |
| `@claude-flow/aidefence` | 3.0.2 | 3.0.2 | In sync | 2026-01-12 | — |
| `@claude-flow/guidance` | 3.0.0-alpha.1 | 3.0.0-alpha.1 | In sync | 2026-02-02 | — |
| `@claude-flow/embeddings` | 3.0.0-alpha.12 | 3.0.0-alpha.1 | **11 versions behind** | 2026-01-07 | 57 days |
| `@claude-flow/hooks` | 3.0.0-alpha.7 | 3.0.0-alpha.1 | **6 versions behind** | 2026-01-07 | 57 days |
| `@claude-flow/plugins` | 3.0.0-alpha.7 | 3.0.0-alpha.1 | **6 versions behind** | 2026-01-06 | 58 days |
| `@claude-flow/deployment` | 3.0.0-alpha.7 | 3.0.0-alpha.1 | **6 versions behind** | 2026-01-07 | 57 days |
| `@claude-flow/shared` | 3.0.0-alpha.6 | 3.0.0-alpha.1 | **5 versions behind** | 2026-01-06 | 58 days |
| `@claude-flow/providers` | 3.0.0-alpha.6 | 3.0.0-alpha.1 | **5 versions behind** | 2026-01-06 | 58 days |
| `@claude-flow/swarm` | 3.0.0-alpha.6 | 3.0.0-alpha.1 | **5 versions behind** | 2026-01-06 | 58 days |
| `@claude-flow/security` | 3.0.0-alpha.6 | 3.0.0-alpha.1 | **5 versions behind** | 2026-01-06 | 58 days |
| `@claude-flow/performance` | 3.0.0-alpha.6 | 3.0.0-alpha.1 | **5 versions behind** | 2026-01-06 | 58 days |
| `@claude-flow/testing` | 3.0.0-alpha.6 | 3.0.0-alpha.1 | **5 versions behind** | 2026-01-06 | 58 days |
| `@claude-flow/integration` | 3.0.0 | 3.0.0-alpha.1 | **Graduated to stable in repo** | 2026-01-12 | Type mismatch |
| `@claude-flow/browser` | 3.0.0-alpha.2 | 3.0.0-alpha.1 | **1 version behind** | 2026-01-20 | 44 days |
| `@claude-flow/plugin-gastown-bridge` | 0.1.3 | 0.1.3 | In sync | 2026-02-13 | — |
| `@claude-flow/plugin-agentic-qe` | 3.0.0-alpha.4 | 3.0.0-alpha.4 | In sync | 2026-01-23 | — |

**Summary**: 8 in sync, 12 behind (60% stale). Most were bulk-published 2026-01-06 and never updated.

### Wrapper Packages

| Package | npm Version | Repo Version | Source | Status |
|---------|------------|--------------|--------|--------|
| `claude-flow` | 3.5.2 | 3.5.2 | ruflo root package.json | In sync |
| `ruflo` | 3.5.2 | 3.5.2 | ruflo/ruflo/ | In sync |
| `coflow` | Not published | 3.1.0-alpha.4 | ruflo/packages/coflow/ | **Never published** |

---

## 4. @ruvector/* Packages (22+ packages)

**Source repo**: `ruvnet/ruvector` (Cargo/napi-rs monorepo)
**Latest git tag**: `v2.0.5`
**HEAD**: `f8f2c600` (2026-03-03)
**Gap**: 172 commits ahead of latest tag
**Workspace version**: 2.0.5 (Cargo.toml) — npm uses independent versioning per package

| Package | npm Version | Last Published | Staleness |
|---------|------------|---------------|-----------|
| `ruvector` | 0.2.11 | 2026-03-03 | Current |
| `@ruvector/core` | 0.1.30 | 2026-01-01 | **60 days stale** |
| `@ruvector/attention` | 0.1.31 | 2026-02-21 | 11 days |
| `@ruvector/router` | 0.1.28 | 2026-01-24 | **40 days stale** |
| `@ruvector/gnn` | 0.1.25 | 2026-02-26 | 5 days |
| `@ruvector/sona` | 0.1.5 | 2026-01-02 | **62 days stale** |
| `@ruvector/ruvllm` | 2.5.1 | 2026-02-21 | 11 days |
| `@ruvector/rvf` | 0.2.0 | 2026-02-22 | 10 days |
| `@ruvector/rvf-wasm` | 0.1.6 | 2026-02-17 | 15 days |
| `@ruvector/edge-full` | 0.1.0 | 2025-12-31 | **64 days stale** |
| `@ruvector/graph-transformer` | 2.0.4 | 2026-02-25 | 6 days |
| `@ruvector/graph-node` | 2.0.2 | 2026-02-13 | 19 days |
| `@ruvector/tiny-dancer` | 0.1.17 | 2026-02-13 | 19 days |
| `@ruvector/learning-wasm` | 0.1.29 | 2026-01-01 | **62 days stale** |
| `@ruvector/gnn-wasm` | 0.1.0 | 2025-12-02 | **92 days stale** |
| `@ruvector/node` | 0.1.22 | 2026-02-13 | 19 days |
| `@ruvector/wasm` | 0.1.29 | 2026-02-13 | 19 days |
| `ruvector-onnx-embeddings-wasm` | 0.1.2 | 2025-12-31 | **64 days stale** |
| `ruvector-attention-wasm` | 0.1.32 | 2026-01-23 | **41 days stale** |
| `ruvector-graph-transformer-wasm` | 2.0.4 | 2026-02-25 | 6 days |
| `ruvector-extensions` | 0.1.0 | 2025-11-25 | **100 days stale** |
| `ruvector-core-linux-x64-gnu` | 0.1.29 | 2025-12-29 | **65 days stale** |
| `ruvector-core-darwin-arm64` | 0.1.29 | 2025-12-29 | **65 days stale** |

**Versioning note**: Workspace declares `2.0.5` but npm packages use independent schemes (`0.1.x`, `0.2.x`, `2.x`). The root `ruvector` package is at `0.2.11` on npm but `0.1.2` in repo source — npm is ahead.

---

## 5. agentdb

**Source repo**: `ruvnet/agentic-flow` (monorepo, at `packages/agentdb/`)
**npm version**: 3.0.0-alpha.10
**Repo version**: 3.0.0-alpha.3
**Gap**: **461 commits ahead** of published gitHead
**Total versions published**: 97 (1.0.0 through 3.0.0-alpha.10)

### Version History

| Phase | Range | Period | Count |
|-------|-------|--------|-------|
| Stable 1.x | 1.0.0 → 1.6.1 | Oct 18–25, 2025 | 66 |
| Alpha 2.x | 2.0.0-alpha → 2.0.0-alpha.3.21 | Nov 30, 2025 – Feb 13, 2026 | 21 |
| Alpha 3.x | 3.0.0-alpha.1 → alpha.10 | Feb 21–27, 2026 | 10 |

### ruvnet Dependencies

- `ruvector` ^0.1.99 (direct)
- `@ruvector/graph-transformer` ^2.0.4 (direct)
- `@ruvector/gnn`, `@ruvector/attention`, `@ruvector/router`, `@ruvector/sona`, `@ruvector/graph-node` (optional)
- `@ruvector/rvf`, `@ruvector/rvf-node`, `@ruvector/rvf-wasm`, `@ruvector/ruvllm` (optional, source only)

---

## 6. agentic-flow

**Source repo**: `ruvnet/agentic-flow`
**npm latest**: 2.0.7 (published 2026-02-13)
**npm alpha**: 3.0.0-alpha.1 (published 2026-02-27)
**Repo HEAD version**: 2.0.2-alpha (in package.json)
**Latest git tag**: v2.3.6 (2025-11-24)
**Gap**: **540 commits ahead** of latest tag
**Total versions published**: 141

### Monorepo Sub-packages

| Package | Location | Published? |
|---------|----------|-----------|
| `agentic-flow` | `/agentic-flow/` | Yes (2.0.7 / 3.0.0-alpha.1) |
| `agentdb` | `/packages/agentdb/` | Yes (3.0.0-alpha.10) |
| `agent-booster` | `/packages/agent-booster/` | Unknown |
| `agentdb-onnx` | `/packages/agentdb-onnx/` | Unknown |
| `agentic-jujutsu` | `/packages/agentic-jujutsu/` | Unknown |
| `agentic-llm` | `/packages/agentic-llm/` | Unknown |

### ruvnet Dependencies (v2.0.7)

- `agentdb` ^2.0.0-alpha.2.20, `ruvector` ^0.1.69
- `@ruvector/core` ^0.1.29, `@ruvector/router` ^0.1.25, `@ruvector/ruvllm` ^0.2.3
- `@ruvector/edge-full` ^0.1.0, `@ruvector/tiny-dancer` 0.1.17
- `ruvector-onnx-embeddings-wasm` ^0.1.2

**Note**: v3.0.0-alpha.1 **downgraded** agentdb from `^2.0.0-alpha.2.20` to `^1.4.3` and dropped several @ruvector deps.

---

## 7. ruv-swarm

**Source repo**: `ruvnet/ruv-FANN` (subdirectory `ruv-swarm/npm/`)
**npm version**: 1.0.20 (published 2025-09-10)
**Repo version**: 1.0.18
**Gap**: npm is **ahead** of source version (diverged)
**Staleness**: **159 days** since last npm publish
**Dependencies**: better-sqlite3, uuid, ws

---

## 8. Other ruvnet Packages

| Package | npm Version | Repo | Notes |
|---------|------------|------|-------|
| `dspy.ts` | 2.1.1 | ruvnet/dspy.ts | Active |
| `sublinear-time-solver` | 1.5.0 | ruvnet/sublinear-time-solver | Active |
| `agenticsjs` | 1.0.5 | ruvnet/agenticsjs | Active |
| `musicai` | 1.0.0 | ruvnet/musicai | Active |
| `create-claude-flow-codex-ui` | 0.1.0-alpha.0 | Unknown | Early stage |
| `claude-flow-novice` | 2.21.0 | External (cfn-dev) | **Not ruvnet** |

### Third-Party Forks/Wrappers

| Package | Maintainer | Version |
|---------|-----------|---------|
| `@sparkleideas/claude-flow-patch` | sparklingideas | 3.1.0-alpha.44.patch.10 |
| `@sparkleideas/claude-flow-guidance` | sparklingideas | 3.0.0-alpha.1.wrapper.6 |

---

## 9. Cross-Package Version Conflicts

### RED — Breaking Conflicts

| Conflict | Consumer A | Consumer B | Issue |
|----------|-----------|-----------|-------|
| `@ruvector/ruvllm` | agentic-flow specifies `^0.2.3` | npm latest is `2.5.1` | Caret `^0.2.3` only matches `0.2.x`, not `2.x`. **Unresolvable.** |
| `agentdb` | @claude-flow/memory pins `2.0.0-alpha.3.7` | agentic-flow specifies `^2.0.0-alpha.2.20` | npm latest is `3.0.0-alpha.10` — neither range accepts it. **Dual-track alpha.** |

### YELLOW — Resolvable Conflicts

| Package | Range A | Range B | Resolution |
|---------|---------|---------|-----------|
| `@ruvector/router` | ruvector `^0.1.25` | cli `^0.1.27` | Resolves to 0.1.28 |
| `@ruvector/attention` | ruvector `^0.1.3` | cli `^0.1.4` | Resolves to 0.1.31 |
| `@ruvector/core` | ruvector `^0.1.25` | agentic-flow `^0.1.29` | Resolves to 0.1.30 |
| `@ruvector/sona` | ruvector `^0.1.4` | cli `^0.1.5` | Resolves to 0.1.5 |
| `@claude-flow/memory` | hooks `^alpha.1` | cli `^alpha.11` | All resolve to alpha.11 |

---

## 10. Git Tags vs npm Versions

### ruflo repo (ruvnet/ruflo)

| Tag | Date | Notes |
|-----|------|-------|
| `v3.0.0-alpha.79` | 2026-01-15 | **Latest tag — 933 commits behind HEAD** |
| `v2.7.34` | Late 2025 | Last v2 stable |

**Missing tags**: v3.5.0, v3.5.1, v3.5.2 exist in commit messages but have **NO git tags**.

### ruvector repo

**Latest tag**: `v2.0.5` — 172 commits behind HEAD

### agentic-flow repo

**Latest tag**: `v2.3.6` (2025-11-24) — 540 commits behind HEAD

---

## 11. Known Issues

### Critical

| Issue | Description | Impact |
|-------|-------------|--------|
| ADR-053 / #1264 | ControllerRegistry not exported from `@claude-flow/memory` | All `agentdb_*` MCP tools return `{ available: false }` |
| #1287 | Memory package nested dependency resolution failure | SessionStart silently skips memory bridge initialization |
| Missing tags | v3.5.x versions have no git tags across all repos | No reproducible builds |
| `@ruvector/ruvllm` spec error | agentic-flow `^0.2.3` vs actual `2.5.1` | Unresolvable semver conflict |
| agentdb dual-track | memory pins `2.0.0-alpha.3.7`, latest is `3.0.0-alpha.10` | Duplicate installs or resolution failure |

### High

| Issue | Description | Impact |
|-------|-------------|--------|
| 12 sub-packages stale | Most @claude-flow/* published Jan 6 and never updated | Dynamic imports get stale code |
| ADR-057 | Package size 1.3GB / 914 packages / 35s cold start | sql.js WASM is 18MB alone |
| #1231 | npm cache ECOMPROMISED errors | Blocks installation (fixed in alpha.50) |
| ruv-swarm 159 days stale | npm version diverged from source | Unreliable dependency |

### Medium

| Issue | Description | Impact |
|-------|-------------|--------|
| #1253 / #1280 | MCP server reports "claude-flow v3.0.0-alpha" | Confusing version display |
| ADR-046 | Three-package publish sequence not automated | Manual coordination |
| agentic-flow v3 alpha regression | v3.0.0-alpha.1 downgraded agentdb to ^1.4.3 | Dependency confusion |

---

## 12. Root Cause Analysis

The root `claude-flow` package bundles CLI dist files directly via its `files` glob:

```json
"files": [
  "bin/**",
  "v3/@claude-flow/cli/dist/**/*.js",
  "v3/@claude-flow/cli/dist/**/*.d.ts",
  "v3/@claude-flow/shared/dist/**",
  "v3/@claude-flow/guidance/dist/**"
]
```

This means the CLI "works" at 3.5.2 because its compiled output is included in the tarball. But anything that **dynamically imports** `@claude-flow/memory` at runtime (as `memory-bridge.js` does) resolves the separately-published npm package — frozen at `3.0.0-alpha.11` from February 16.

The same pattern repeats across the ecosystem:
- **agentdb** is 461 commits ahead of its published version
- **agentic-flow** is 540 commits ahead of its latest tag
- **ruvector** is 172 commits ahead of its latest tag
- **12 of 20 @claude-flow/* packages** haven't been published since January 6

---

## 13. What Should Have Been Published

### Packages needing republish

| Package | Current npm | Should Be | Reason |
|---------|------------|-----------|--------|
| `@claude-flow/memory` | 3.0.0-alpha.11 | ≥alpha.12 or 3.5.2 | ADR-053 controllers, ADR-057 RVF, hash embedding fixes |
| `@claude-flow/shared` | 3.0.0-alpha.1 | 3.0.0-alpha.6 | 5 versions unpublished |
| `@claude-flow/hooks` | 3.0.0-alpha.1 | 3.0.0-alpha.7 | 6 versions unpublished |
| `@claude-flow/embeddings` | 3.0.0-alpha.1 | 3.0.0-alpha.12 | **11 versions unpublished** |
| `@claude-flow/plugins` | 3.0.0-alpha.1 | 3.0.0-alpha.7 | 6 versions unpublished |
| `@claude-flow/providers` | 3.0.0-alpha.1 | 3.0.0-alpha.6 | 5 versions unpublished |
| `@claude-flow/deployment` | 3.0.0-alpha.1 | 3.0.0-alpha.7 | 6 versions unpublished |
| `@claude-flow/swarm` | 3.0.0-alpha.1 | 3.0.0-alpha.6 | 5 versions unpublished |
| `@claude-flow/security` | 3.0.0-alpha.1 | 3.0.0-alpha.6 | 5 versions unpublished |
| `@claude-flow/performance` | 3.0.0-alpha.1 | 3.0.0-alpha.6 | 5 versions unpublished |
| `@claude-flow/testing` | 3.0.0-alpha.1 | 3.0.0-alpha.6 | 5 versions unpublished |
| `@claude-flow/browser` | 3.0.0-alpha.1 | 3.0.0-alpha.2 | 1 version unpublished |
| `@claude-flow/integration` | 3.0.0-alpha.1 | 3.0.0 | Graduated to stable in repo |
| `@ruvector/core` | 0.1.30 | Needs rebuild | 60 days stale |
| `@ruvector/sona` | 0.1.5 | Needs rebuild | 62 days stale |
| `@ruvector/learning-wasm` | 0.1.29 | Needs rebuild | 62 days stale |
| `agentdb` | 3.0.0-alpha.10 | ≥alpha.11 | 461 commits unpublished |
| `agentic-flow` | 2.0.7 | ≥2.0.8 or 3.0.0 | 540 commits unpublished |
| `ruv-swarm` | 1.0.20 | Unknown | 159 days stale, version diverged |
| `coflow` | Not published | 3.1.0-alpha.4 | Never published |

### Missing git tags

| Repo | Tag | Should Point To |
|------|-----|----------------|
| ruflo | `v3.5.0` | Commit `7dc90047` (Feb 27) |
| ruflo | `v3.5.1` | Commit `5baf1f3c` (Feb 27) |
| ruflo | `v3.5.2` | Commit `f961baf8` (Feb 28) |
| agentic-flow | ≥v2.1.0 | HEAD (540 commits past v2.3.6) |
| ruvector | ≥v2.0.6 | HEAD (172 commits past v2.0.5) |

---

## 14. Publish Timeline

| Date | Package | npm Version | Notes |
|------|---------|------------|-------|
| 2025-07-01 | ruv-swarm | 0.2.0 | First publish |
| 2025-09-10 | ruv-swarm | 1.0.20 | **Last ruv-swarm publish** |
| 2025-10-04 | agentic-flow | 1.0.0 | First publish |
| 2025-10-18 | agentdb | 1.0.0 | First publish |
| 2025-11-24 | agentic-flow | v2.3.6 tag | Last git tag |
| 2026-01-06 | All @claude-flow/* | 3.0.0-alpha.1 | Bulk initial publish |
| 2026-01-06–01-30 | @claude-flow/cli | alpha.1 → alpha.190 | 190 alphas in 24 days |
| 2026-02-02–02-27 | @claude-flow/cli | 3.1.0-alpha.1 → alpha.55 | 55 alphas |
| 2026-02-13 | agentic-flow | 2.0.7 | **Last stable publish** |
| 2026-02-16 | @claude-flow/memory | 3.0.0-alpha.11 | **Last memory publish** |
| 2026-02-27 | @claude-flow/cli | 3.5.0 | First stable release |
| 2026-02-27 | agentic-flow | 3.0.0-alpha.1 | Alpha with dep regressions |
| 2026-02-28 | @claude-flow/cli | 3.5.2 | **Current CLI latest** |
| 2026-03-03 | ruvector | 0.2.11 | Latest ruvector |
| 2026-03-04 | agentdb | 3.0.0-alpha.10 | Latest agentdb |

---

## 15. Relationship to ruflo

Our patches exist because of the sub-package publishing gap:

| Patch | Compensates For |
|-------|----------------|
| MC-001 | autoStart:false in init/mcp-generator.js (independent CLI bug) |
| FB-001 | Silent fallbacks in memory-initializer.js (would be fixed by memory republish with logging) |
| FB-002 | Silent fallbacks in local helpers (independent of upstream publishes) |
| FB-004 | Wrong search threshold for hash embeddings (would be fixed by memory republish) |

### Patches Validated Against This Analysis

- **FB-003 (ControllerRegistry shim)** was removed from the active patch set, but the underlying issue (ADR-053) remains — `@claude-flow/memory` still doesn't export ControllerRegistry on npm
- **FB-004** compensates for threshold tuned for ONNX embeddings that most installs don't have — a memory republish with dynamic thresholds would make this patch unnecessary
- **MC-001** is an independent bug in CLI init code — unrelated to publishing drift

---

## 16. Summary Statistics

| Metric | Count |
|--------|-------|
| Total ruvnet npm packages | 48+ |
| Packages in dependency tree | 23 |
| GitHub source repos | 7 |
| @claude-flow/* packages in sync | 8/20 (40%) |
| @claude-flow/* packages stale | 12/20 (60%) |
| @ruvector/* packages stale (>30 days) | 10/22 (45%) |
| RED version conflicts | 2 |
| YELLOW version conflicts | 5 |
| Commits unpublished (ruflo) | 933 |
| Commits unpublished (agentic-flow) | 540 |
| Commits unpublished (ruvector) | 172 |
| Missing git tags | 5+ |
| Packages never published | 7 (swarm, security, performance, deployment, testing, integration, coflow) |
