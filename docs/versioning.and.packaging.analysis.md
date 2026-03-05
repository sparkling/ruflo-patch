# Versioning & Packaging Analysis: ruvnet/ruflo

**Date**: 2026-03-05
**Source**: 5-agent swarm analysis of npm registry, GitHub repo, commits/tags, issues/ADRs, and local npx cache

## Architecture

The repo (`ruvnet/ruflo`) is a **pnpm monorepo** at `v3/` with 20 `@claude-flow/*` packages, plus wrapper packages (`claude-flow`, `ruflo`, `coflow`). Publishing follows a three-package sequence per ADR-046:

1. `@claude-flow/cli` (shared implementation)
2. `claude-flow` (original umbrella)
3. `ruflo` (new umbrella)

### Monorepo Layout

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

---

## Published npm Packages

### @claude-flow Scope (16 packages)

| Package | npm Version | Repo Version | Status |
|---------|------------|--------------|--------|
| `@claude-flow/cli` | 3.5.2 | 3.5.2 | In sync |
| `@claude-flow/memory` | 3.0.0-alpha.11 | 3.0.0-alpha.11 | **Stale — 933 unpublished commits** |
| `@claude-flow/shared` | 3.0.0-alpha.1 | 3.0.0-alpha.6 | **5 versions behind** |
| `@claude-flow/neural` | 3.0.0-alpha.7 | 3.0.0-alpha.7 | In sync |
| `@claude-flow/hooks` | 3.0.0-alpha.1 | 3.0.0-alpha.7 | **6 versions behind** |
| `@claude-flow/mcp` | 3.0.0-alpha.8 | 3.0.0-alpha.8 | In sync |
| `@claude-flow/codex` | 3.0.0-alpha.9 | 3.0.0-alpha.9 | In sync |
| `@claude-flow/embeddings` | 3.0.0-alpha.12 | 3.0.0-alpha.12 | In sync |
| `@claude-flow/guidance` | 3.0.0-alpha.1 | 3.0.0-alpha.1 | In sync |
| `@claude-flow/claims` | 3.0.0-alpha.8 | 3.0.0-alpha.8 | In sync |
| `@claude-flow/aidefence` | 3.0.2 | 3.0.2 | In sync |
| `@claude-flow/plugins` | 3.0.0-alpha.1 | 3.0.0-alpha.7 | **6 versions behind** |
| `@claude-flow/providers` | 3.0.0-alpha.1 | 3.0.0-alpha.6 | **5 versions behind** |
| `@claude-flow/browser` | 3.0.0-alpha.1 | 3.0.0-alpha.2 | **1 version behind** |
| `@claude-flow/plugin-gastown-bridge` | 0.1.3 | 0.1.3 | In sync |
| `@claude-flow/plugin-agentic-qe` | 3.0.0-alpha.4 | 3.0.0-alpha.4 | In sync |

### Packages NOT Published (exist in repo only)

| Package | Repo Version |
|---------|-------------|
| `@claude-flow/swarm` | 3.0.0-alpha.6 |
| `@claude-flow/security` | 3.0.0-alpha.6 |
| `@claude-flow/performance` | 3.0.0-alpha.6 |
| `@claude-flow/deployment` | 3.0.0-alpha.7 |
| `@claude-flow/testing` | 3.0.0-alpha.6 |
| `@claude-flow/integration` | 3.0.0 |

### Wrapper Packages

| Package | npm Version | Repo Version | Status |
|---------|------------|--------------|--------|
| `claude-flow` | 3.5.2 | 3.5.2 | In sync |
| `ruflo` | 3.5.2 | 3.5.2 | In sync |
| `coflow` | Not published | 3.1.0-alpha.4 | **Never published** |

### Related Ecosystem

| Package | npm Version | Last Updated | Notes |
|---------|------------|--------------|-------|
| `ruvector` | 0.2.11 | 2026-03-03 | Active |
| `@ruvector/sona` | 0.1.5 | 2026-01-02 | Active |
| `@ruvector/router` | 0.1.28 | 2026-01-24 | Active |
| `@ruvector/attention` | 0.1.31 | 2026-02-21 | Active |
| `ruv-swarm` | 1.0.20 | 2025-09-10 | **Stale (6+ months)** |
| `agentic-flow` | 2.0.7 | Recent | Active |
| `agentdb` | 3.0.0-alpha.10 | 2026-03-04 | Active |

---

## Git Tags vs npm Versions

### Tag History

| Tag | Date | Notes |
|-----|------|-------|
| `v3.0.0-alpha.79` | 2026-01-15 | **Latest tag — 933 commits behind HEAD** |
| `v2.7.34` | Late 2025 | Last v2 stable |
| `v2.7.28`–`v2.7.33` | Late 2025 | v2 stable series |

### Missing Tags

**v3.5.0, v3.5.1, v3.5.2 exist in commit messages but have NO git tags.**

| Version | Commit Date | Commit Message |
|---------|------------|----------------|
| v3.5.0 | 2026-02-27 21:26 | "Ruflo v3.5.0 — First Major Stable Release" |
| v3.5.1 | 2026-02-27 23:29 | "Move native-dep packages to optionalDependencies" |
| v3.5.2 | 2026-02-28 02:50 | "chore: bump to v3.5.2 — RVF storage + security hardening" |

### Version Jump

`v3.0.0-alpha.79` (Jan 15) → `v3.1.0-alpha.42` (Feb 17) → `v3.5.0` (Feb 27)

No tags were created for any v3.1.0-alpha or v3.5.x versions. The v3.5.0 GitHub Release exists but subsequent point releases were not tagged.

---

## Known Issues

### Critical

| Issue | Description | Impact |
|-------|-------------|--------|
| ADR-053 / #1264 | ControllerRegistry not exported from `@claude-flow/memory` | All `agentdb_*` MCP tools return `{ available: false }` |
| #1287 | Memory package nested dependency resolution failure | SessionStart silently skips memory bridge initialization |
| Missing tags | v3.5.x versions have no git tags | No reproducible builds, no release traceability |

### High

| Issue | Description | Impact |
|-------|-------------|--------|
| Sub-package drift | `memory`, `shared`, `hooks`, `plugins`, `providers` all behind | Dynamic imports get stale code |
| ADR-057 | Package size 1.3GB / 914 packages / 35s cold start | sql.js WASM is 18MB alone |
| #1231 | npm cache ECOMPROMISED errors | Blocks installation (fixed in alpha.50) |

### Medium

| Issue | Description | Impact |
|-------|-------------|--------|
| #1253 / #1280 | MCP server reports "claude-flow v3.0.0-alpha" instead of "Ruflo v3.5.2" | Confusing version display |
| ADR-046 | Three-package publish sequence not automated | Manual coordination required |
| `ruv-swarm` stale | Last update Sep 2025 | Core orchestration library unmaintained |

---

## Root Cause Analysis

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

This means the CLI "works" at 3.5.2 because its compiled output is included in the tarball. But anything that **dynamically imports** `@claude-flow/memory` at runtime (as `memory-bridge.js` does) resolves the separately-published npm package — which is frozen at `3.0.0-alpha.11` from February 16.

This is why our ruflo-patch patches exist: the memory package on npm lacks ControllerRegistry (FB-003), has wrong search thresholds for hash embeddings (FB-004), and has silent fallback paths (FB-001).

---

## What Should Have Been Published

Based on repo HEAD (`ce02749`, Feb 28, 2026):

### Packages needing republish

| Package | Current npm | Should Be | Reason |
|---------|------------|-----------|--------|
| `@claude-flow/memory` | 3.0.0-alpha.11 | ≥3.0.0-alpha.12 or 3.5.2 | ADR-053 controllers, ADR-057 RVF, hash embedding fixes |
| `@claude-flow/shared` | 3.0.0-alpha.1 | 3.0.0-alpha.6 | 5 versions of changes unpublished |
| `@claude-flow/hooks` | 3.0.0-alpha.1 | 3.0.0-alpha.7 | 6 versions of changes unpublished |
| `@claude-flow/plugins` | 3.0.0-alpha.1 | 3.0.0-alpha.7 | 6 versions of changes unpublished |
| `@claude-flow/providers` | 3.0.0-alpha.1 | 3.0.0-alpha.6 | 5 versions of changes unpublished |

### Missing git tags

| Tag | Should Point To |
|-----|----------------|
| `v3.5.0` | Commit `7dc90047` (Feb 27) |
| `v3.5.1` | Commit `5baf1f3c` (Feb 27) |
| `v3.5.2` | Commit `f961baf8` (Feb 28) |

### Packages never published

`@claude-flow/swarm`, `@claude-flow/security`, `@claude-flow/performance`, `@claude-flow/deployment`, `@claude-flow/testing`, `@claude-flow/integration`, `coflow`

---

## Publish Timeline

| Date | Package | npm Version | Notes |
|------|---------|------------|-------|
| 2026-01-06 | All @claude-flow/* | 3.0.0-alpha.1 | Initial publish |
| 2026-01-06–01-30 | @claude-flow/cli | 3.0.0-alpha.1 → alpha.190 | 190 alphas in 24 days |
| 2026-02-02–02-27 | @claude-flow/cli | 3.1.0-alpha.1 → alpha.55 | 55 alphas |
| 2026-02-16 | @claude-flow/memory | 3.0.0-alpha.11 | **Last memory publish** |
| 2026-02-27 | @claude-flow/cli | 3.5.0 | First stable release |
| 2026-02-28 | @claude-flow/cli | 3.5.2 | **Current latest** |
| 2026-03-04 | agentdb | 3.0.0-alpha.10 | Latest ecosystem publish |

---

## Relationship to ruflo-patch

Our patches exist because of the sub-package publishing gap:

| Patch | Compensates For |
|-------|----------------|
| FB-001 | Silent fallbacks in memory-initializer.js (would be fixed by memory republish with logging) |
| FB-002 | Silent fallbacks in local helpers (independent of upstream publishes) |
| FB-003 | Missing ControllerRegistry export in @claude-flow/memory (ADR-053 never shipped) |
| FB-004 | Wrong search threshold for hash embeddings (would be fixed by memory republish) |
| MC-001 | autoStart:false in init/mcp-generator.js (independent bug in CLI) |
