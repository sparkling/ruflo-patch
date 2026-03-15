# Full Patch Sweep — 2026-03-14

Analyzed all 146 patches from `~/src/claude-flow-patch` (runtime Python patches applied to compiled JS in npm cache) and ported valid ones to TypeScript source edits in our fork model.

## Summary

| Status | Count | Details |
|--------|-------|---------|
| **Applied** | 57 | Ported to fork source (54 ruflo + 3 ruvector) |
| **Retired (ADR-068)** | 82 | Superseded by bridge-first rewrite (WM-100+ series) |
| **Fixed upstream** | 3 | CF-001, UI-001, WM-100 |
| **Not patchable** | 0 | (RV-001/002/003 resolved by forking ruvector) |
| **N/A** | 2 | WM-112/113 — target CJS artifacts that don't exist in TS source |
| **Skipped (build pipeline)** | 1 | WM-101 — shell-based AgentDB upgrade handled by npm install |
| **DOC-only** | 1 | DOC-001 — README documentation |

## Patches Applied

### Services — 10 patches (worker-daemon.ts, headless-worker-executor.ts)

| ID | Issue | Description | Upstream |
|----|-------|-------------|----------|
| HW-001 | [#2](https://github.com/sparkling/ruflo-patch/issues/2) | stdin pipe never closed → child hangs | ruvnet/claude-flow#1111 |
| HW-002 | [#3](https://github.com/sparkling/ruflo-patch/issues/3) | Non-zero exit codes silently swallowed | ruvnet/claude-flow#1112 |
| HW-003 | [#4](https://github.com/sparkling/ruflo-patch/issues/4) | Hardcoded aggressive scheduling intervals | ruvnet/claude-flow#1113 |
| HW-004 | [#5](https://github.com/sparkling/ruflo-patch/issues/5) | runWithTimeout leaves orphaned processes | ruvnet/claude-flow#1117 |
| DM-001 | [#6](https://github.com/sparkling/ruflo-patch/issues/6) | daemon.log always empty | ruvnet/claude-flow#1116 |
| DM-002 | [#7](https://github.com/sparkling/ruflo-patch/issues/7) | maxCpuLoad=2.0 blocks workers on multi-core | — |
| DM-003 | [#8](https://github.com/sparkling/ruflo-patch/issues/8) | macOS freemem() returns ~0, blocking workers | ruvnet/claude-flow#1077 |
| DM-004 | [#9](https://github.com/sparkling/ruflo-patch/issues/9) | Worker preload/consolidation are stubs | ruvnet/claude-flow#1139 |
| DM-006 | [#10](https://github.com/sparkling/ruflo-patch/issues/10) | No log rotation — logs grow unbounded | ruvnet/claude-flow#1114 |
| WM-108 | [#11](https://github.com/sparkling/ruflo-patch/issues/11) | Reduce consolidation interval to 10 minutes | ruvnet/claude-flow#829 |

### MCP Hooks — 9 patches (hooks-tools.ts)

| ID | Issue | Description | Upstream |
|----|-------|-------------|----------|
| HK-002 | [#18](https://github.com/sparkling/ruflo-patch/issues/18) | Hook handlers are stubs / silent catches (PARTIAL) | ruvnet/claude-flow#1058 |
| HK-003 | [#19](https://github.com/sparkling/ruflo-patch/issues/19) | hooks_metrics returns hardcoded fake data | ruvnet/claude-flow#1158 |
| HK-004 | [#20](https://github.com/sparkling/ruflo-patch/issues/20) | session-start ignores daemon.autoStart | ruvnet/claude-flow#1175 |
| HK-005 | [#21](https://github.com/sparkling/ruflo-patch/issues/21) | No PID guard — multiple daemons start | ruvnet/claude-flow#1171 |
| NS-003 | [#22](https://github.com/sparkling/ruflo-patch/issues/22) | Namespace typo: 'pattern' vs 'patterns' | ruvnet/claude-flow#1136 |
| WM-104 | [#23](https://github.com/sparkling/ruflo-patch/issues/23) | CausalRecall integration in routing | ruvnet/claude-flow#829 |
| WM-106 | [#24](https://github.com/sparkling/ruflo-patch/issues/24) | LearningBridge activation in intelligence_learn | ruvnet/claude-flow#829 |
| WM-107 | [#25](https://github.com/sparkling/ruflo-patch/issues/25) | Falsy-OR bug: quality=0 swallowed (|| → ??) | ruvnet/claude-flow#1209 |
| WM-114 | [#26](https://github.com/sparkling/ruflo-patch/issues/26)–[#28](https://github.com/sparkling/ruflo-patch/issues/28) | AttentionService wiring (4 controllers) | ruvnet/claude-flow#829 |

### MCP Memory — 4 patches (memory-tools.ts)

| ID | Issue | Description | Upstream |
|----|-------|-------------|----------|
| NS-001 | [#29](https://github.com/sparkling/ruflo-patch/issues/29) | Search/list default namespace 'default' → 'all' | ruvnet/claude-flow#1123 |
| NS-002 | [#30](https://github.com/sparkling/ruflo-patch/issues/30) | Require explicit namespace for store/delete/retrieve | ruvnet/claude-flow#581 |
| WM-103 | — | MetadataFilter + MMR diversity in search pipeline | ruvnet/claude-flow#829 |
| WM-105 | — | MemoryGraph importance scoring | ruvnet/claude-flow#1214 |

### Commands — 6 patches (config.ts, doctor.ts, start.ts, status.ts, swarm.ts)

| ID | Issue | Description | Upstream |
|----|-------|-------------|----------|
| CF-002 | [#12](https://github.com/sparkling/ruflo-patch/issues/12) | Config export shows hardcoded defaults | ruvnet/claude-flow#1142 |
| CF-003 | [#13](https://github.com/sparkling/ruflo-patch/issues/13) | Doctor missing memory backend check (PARTIAL) | ruvnet/claude-flow#1186 |
| CF-004 | [#14](https://github.com/sparkling/ruflo-patch/issues/14) | Config get/export reads from config.json on disk | ruvnet/claude-flow#1193 |
| CF-006 | [#15](https://github.com/sparkling/ruflo-patch/issues/15) | Migrate config.yaml → config.json in start/status/init | ruvnet/claude-flow#1197 |
| SG-005 | [#16](https://github.com/sparkling/ruflo-patch/issues/16) | Add 'start all' subcommand | ruvnet/claude-flow#1177 |
| SG-009 | [#17](https://github.com/sparkling/ruflo-patch/issues/17) | Remove --v3-mode, make v3 the default | ruvnet/claude-flow#1202 |

### Init Generators — 13 patches (init.ts, executor.ts, types.ts, settings-generator.ts, helpers-generator.ts)

| ID | Issue | Description | Upstream |
|----|-------|-------------|----------|
| CF-009 | [#42](https://github.com/sparkling/ruflo-patch/issues/42) | Upgrade MINIMAL preset to v3 defaults | ruvnet/claude-flow#1203 |
| SG-001 | [#43](https://github.com/sparkling/ruflo-patch/issues/43) | Fix init permission patterns + statusLine guard (PARTIAL) | ruvnet/claude-flow#1150 |
| SG-003 | [#44](https://github.com/sparkling/ruflo-patch/issues/44) | --dual generates helpers, critical helpers fallback | ruvnet/claude-flow#1169 |
| SG-004 | [#45](https://github.com/sparkling/ruflo-patch/issues/45) | Wizard parity with init | ruvnet/claude-flow#1181 |
| SG-006 | [#46](https://github.com/sparkling/ruflo-patch/issues/46) | Wizard misses permissionRequest hook | ruvnet/claude-flow#1184 |
| SG-007 | [#47](https://github.com/sparkling/ruflo-patch/issues/47) | structuredClone deep copy for init options | ruvnet/claude-flow#1188 |
| SG-008 | [#48](https://github.com/sparkling/ruflo-patch/issues/48) | Generate config.json instead of config.yaml | ruvnet/claude-flow#1195 |
| SG-010 | [#49](https://github.com/sparkling/ruflo-patch/issues/49) | Add CLI options for all config.json settings | ruvnet/claude-flow#1205 |
| SG-011 | [#50](https://github.com/sparkling/ruflo-patch/issues/50) | Fix stale --topology hierarchical refs | ruvnet/claude-flow#1206 |
| SG-012 | [#51](https://github.com/sparkling/ruflo-patch/issues/51) | Complete settings-generator output (PARTIAL) | ruvnet/claude-flow#1291 |
| HK-001 | [#52](https://github.com/sparkling/ruflo-patch/issues/52) | Post-edit file_path from stdin (PARTIAL) | ruvnet/claude-flow#1155 |
| HK-006 | [#53](https://github.com/sparkling/ruflo-patch/issues/53) | Fail-loud init template helpers | ruvnet/claude-flow#829 |
| MM-001 | [#54](https://github.com/sparkling/ruflo-patch/issues/54) | Remove dead persistPath config option | ruvnet/claude-flow#1152 |

### Memory System — 11 patches (memory-initializer.ts, memory-bridge.ts, controller-registry.ts, cache-manager.ts, sqljs-backend.ts, neural.ts, helpers/)

| ID | Issue | Description | Upstream |
|----|-------|-------------|----------|
| EM-001 | [#31](https://github.com/sparkling/ruflo-patch/issues/31) | Config-driven embedding model selection (PARTIAL) | ruvnet/claude-flow#1143 |
| GV-001 | [#32](https://github.com/sparkling/ruflo-patch/issues/32) | HNSW ghost vector cleanup on delete | ruvnet/claude-flow#1122 |
| MM-002 | [#33](https://github.com/sparkling/ruflo-patch/issues/33) | Add .unref() to timers blocking process exit | ruvnet/claude-flow#1256 |
| WM-102 | [#34](https://github.com/sparkling/ruflo-patch/issues/34) | Wire config.json into ControllerRegistry init | ruvnet/claude-flow#1204 |
| WM-111 | [#35](https://github.com/sparkling/ruflo-patch/issues/35) | Enable EnhancedEmbeddingService in controllers | ruvnet/claude-flow#829 |
| WM-115 | [#36](https://github.com/sparkling/ruflo-patch/issues/36) | WASMVectorSearch with JS fallback | ruvnet/claude-flow#829 |
| WM-116 | [#37](https://github.com/sparkling/ruflo-patch/issues/37) | Fix AgentMemoryScope null placeholder | ruvnet/claude-flow#1227 |
| UI-002 | [#38](https://github.com/sparkling/ruflo-patch/issues/38) | Fix neural status always showing "Not loaded" | ruvnet/claude-flow#1146 |
| WM-003 | [#39](https://github.com/sparkling/ruflo-patch/issues/39) | Activate AutoMemoryBridge with AgentDB backend | ruvnet/claude-flow#1102 |
| IN-003 | [#40](https://github.com/sparkling/ruflo-patch/issues/40) | CJS intelligence snapshot reader | ruvnet/claude-flow#829 |
| IN-004 | [#41](https://github.com/sparkling/ruflo-patch/issues/41) | CJS intelligence signal writer | ruvnet/claude-flow#829 |

### ruv-FANN Fork — 1 patch (ruv-swarm/npm/package.json)

| ID | Issue | Description | Upstream |
|----|-------|-------------|----------|
| RS-001 | [#1](https://github.com/sparkling/ruflo-patch/issues/1) | Bump better-sqlite3 ^11.6.0 → ^12.0.0 for Node 24 | ruvnet/ruv-FANN#185 |

### RuVector Fork — 3 patches (npm/packages/ruvector/bin/cli.js)

Forked `ruvnet/RuVector` → `sparkling/RuVector`, cloned to `~/src/forks/ruvector`. The CLI is hand-written JS (no build step).

| ID | Issue | Description | Upstream |
|----|-------|-------------|----------|
| RV-001 | [#55](https://github.com/sparkling/ruflo-patch/issues/55) | force-learn calls nonexistent tick() method | — |
| RV-002 | [#56](https://github.com/sparkling/ruflo-patch/issues/56) | activeTrajectories not loaded from saved file | — |
| RV-003 | [#57](https://github.com/sparkling/ruflo-patch/issues/57) | trajectory-end doesn't update stats counters | ruvnet/ruv-FANN#186 |

## Not Ported

### Cannot patch in fork model (1)

| ID | Reason |
|----|--------|
| EM-002 | Filesystem permissions fix (`chmod`), not a source patch |

### Retired by ADR-068 (82)

All WM patches from 001–092 (except WM-003) plus IN-001, IN-002, MM-003 were retired by ADR-068 (bridge-first rewrite). They were superseded by the WM-100+ series which uses the upstream bridge architecture.

### Fixed upstream (3)

| ID | What fixed it |
|----|---------------|
| CF-001 | Doctor already uses JSON config in upstream HEAD |
| UI-001 | Upstream added nullish coalescing (`?? 0`) |
| WM-100 | ControllerRegistry already exported from @claude-flow/memory |

### Other (3)

| ID | Reason |
|----|--------|
| WM-101 | Shell-based AgentDB v3 upgrade — handled by build pipeline's `npm install` |
| WM-112 | Targets CJS intelligence.cjs artifact — no TS source equivalent |
| WM-113 | Targets CJS hook-handler.cjs artifact — no TS source equivalent |
| DOC-001 | Documentation-only patch (README.md) |

## Files Changed

26 files across both forks, +1,656 / -401 lines:

```
 .claude/helpers/auto-memory-hook.mjs                | 109 ++++++--
 v3/@claude-flow/cli/.claude/helpers/auto-memory-hook.mjs | 109 ++++++--
 v3/@claude-flow/cli/.claude/helpers/intelligence.cjs | 102 ++++++-
 v3/@claude-flow/cli/src/commands/config.ts          |  67 ++++-
 v3/@claude-flow/cli/src/commands/doctor.ts          | 107 +++++++
 v3/@claude-flow/cli/src/commands/index.ts           |   6 +-
 v3/@claude-flow/cli/src/commands/init.ts            | 245 ++++++++++++++--
 v3/@claude-flow/cli/src/commands/neural.ts          |   7 +-
 v3/@claude-flow/cli/src/commands/start.ts           | 119 ++++----
 v3/@claude-flow/cli/src/commands/status.ts          |   6 +-
 v3/@claude-flow/cli/src/commands/swarm.ts           |  32 +--
 v3/@claude-flow/cli/src/index.ts                    |   2 +-
 v3/@claude-flow/cli/src/init/claudemd-generator.ts  |   2 +-
 v3/@claude-flow/cli/src/init/executor.ts            | 131 +++++----
 v3/@claude-flow/cli/src/init/helpers-generator.ts   |  48 ++--
 v3/@claude-flow/cli/src/init/settings-generator.ts  | 109 +++++++-
 v3/@claude-flow/cli/src/init/types.ts               |  68 ++++-
 v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts    | 309 +++++++++++++++++----
 v3/@claude-flow/cli/src/mcp-tools/memory-tools.ts   | 135 +++++++--
 v3/@claude-flow/cli/src/memory/memory-bridge.ts     |  77 ++++-
 v3/@claude-flow/cli/src/memory/memory-initializer.ts |  76 ++++-
 v3/@claude-flow/cli/src/services/headless-worker-executor.ts | 28 +-
 v3/@claude-flow/cli/src/services/worker-daemon.ts   | 142 +++++++---
 v3/@claude-flow/memory/src/cache-manager.ts         |   1 +
 v3/@claude-flow/memory/src/controller-registry.ts   |  19 +-
 v3/@claude-flow/memory/src/sqljs-backend.ts         |   1 +
```

## Methodology

1. Cataloged all 146 patches from `~/src/claude-flow-patch/patch/` by reading README.md and fix.py files
2. Cross-referenced each patch against fork TypeScript source using 5 parallel verification agents
3. Classified each as VALID, PARTIAL, FIXED, N/A, or Retired
4. Ported valid patches using 6 parallel patcher agents, each handling non-overlapping file groups
5. Created GitHub issues on `sparkling/ruflo-patch` for tracking
6. Committed to fork main branches and pushed
