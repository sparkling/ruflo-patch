# Build Timing Analysis — 2026-03-14 (post-sweep)

## Pipeline Summary

| Phase | Time | Notes |
|-------|------|-------|
| copy-source | 139ms | 4 forks rsync'd in parallel |
| codemod | 624ms | @claude-flow/* → @sparkleideas/* |
| build | 12,674ms | 38 compiled, 0 failed, 65 publishable |
| **Total** | **13.4s** | |

## Build Group Timing (topological order)

| Group | Packages | Wall-clock | Bottleneck |
|-------|----------|------------|------------|
| GROUP 0 | shared (1) | 784ms | shared |
| GROUP 1 | aidefence, memory, codex, embeddings (4) | 797ms | embeddings 793ms |
| GROUP 2 | hooks, neural, providers, browser, claims, plugins (6) | 1,303ms | plugins 1298ms |
| GROUP 3 | deployment, integration, swarm, security, performance, testing, guidance, mcp (8) | 1,537ms | mcp 1533ms |
| GROUP 4 | cli (1) | 1,554ms | cli 1551ms |
| EXTRA | 17 plugins + cross-repo (17) | 5,881ms | agentdb 5876ms |
| cross-repo | agent-booster TSC + WASM | 954ms | — |

## Per-Package Build Times (sorted slowest first)

| Package | Time | Group |
|---------|------|-------|
| agentdb | 5,876ms | EXTRA |
| prime-radiant | 2,582ms | EXTRA |
| gastown-bridge | 2,264ms | EXTRA |
| ruvector-upstream | 2,007ms | EXTRA |
| teammate-plugin | 1,939ms | EXTRA |
| agentdb-onnx | 1,778ms | EXTRA |
| hyperbolic-reasoning | 1,626ms | EXTRA |
| quantum-optimizer | 1,619ms | EXTRA |
| code-intelligence | 1,606ms | EXTRA |
| legal-contracts | 1,588ms | EXTRA |
| agentic-qe | 1,572ms | EXTRA |
| cli | 1,551ms | GROUP 4 |
| mcp | 1,533ms | GROUP 3 |
| perf-optimizer | 1,491ms | EXTRA |
| neural-coordination | 1,489ms | EXTRA |
| financial-risk | 1,451ms | EXTRA |
| cognitive-kernel | 1,445ms | EXTRA |
| healthcare-clinical | 1,417ms | EXTRA |
| test-intelligence | 1,387ms | EXTRA |
| plugins | 1,298ms | GROUP 2 |
| guidance | 1,134ms | GROUP 3 |
| testing | 999ms | GROUP 3 |
| claims | 959ms | GROUP 2 |
| browser | 853ms | GROUP 2 |
| providers | 817ms | GROUP 2 |
| embeddings | 793ms | GROUP 1 |
| performance | 790ms | GROUP 3 |
| shared | 780ms | GROUP 0 |
| codex | 685ms | GROUP 1 |
| swarm | 489ms | GROUP 3 |
| security | 489ms | GROUP 3 |
| integration | 479ms | GROUP 3 |
| neural | 439ms | GROUP 1 |
| hooks | 431ms | GROUP 2 |
| memory | 429ms | GROUP 1 |
| deployment | 415ms | GROUP 3 |
| aidefence | 363ms | GROUP 1 |

## Bottleneck Analysis

1. **agentdb (5.9s)** — 46% of total build time. Single package dominates. It's in the EXTRA group which runs serially after the main groups.

2. **EXTRA group (5.9s)** — 17 packages running in parallel, but agentdb alone takes 5.9s so the parallelism doesn't help (it's the long pole).

3. **GROUP 3 + GROUP 4 (3.1s)** — cli and mcp are the bottlenecks (~1.5s each). These are the critical path in the main build.

4. **Plugins (prime-radiant, gastown-bridge, ruvector-upstream, teammate-plugin)** — each 2-2.6s, but they run in parallel within EXTRA, masked by agentdb.

## Performance Improvement Opportunities

### High Impact

1. **agentdb incremental compilation** — agentdb takes 5.9s. If it hasn't changed, skip it entirely (check manifest hash). Currently EXTRA group always recompiles.

2. **Move agentdb to earlier group** — agentdb could start building in GROUP 2 (while cli/mcp build in GROUP 3/4), overlapping work.

3. **Pre-built type stubs for agentdb** — The TS errors in agentdb come from `attention-native.ts` calling wrong API. If we fix those, tsc might be faster (fewer error paths).

### Medium Impact

4. **Parallel EXTRA group** — The 17 EXTRA packages already build in parallel, but we could increase parallelism (currently limited by tsc fork count?).

5. **Skip unchanged packages** — The build already has a manifest freshness check at the top level, but per-package incremental checks could skip packages whose source hasn't changed.

6. **tsc --incremental** — Use TypeScript incremental compilation with `.tsbuildinfo` files. Could cut 30-50% off rebuild times for unchanged packages.

### Low Impact

7. **codemod caching** — 624ms. Could cache codemod output and skip if source + codemod hash unchanged. Minor savings.

8. **copy-source optimization** — 139ms is already fast. rsync delta mode could save a few ms on unchanged files.

## Test Timing

| Layer | Time | Tests |
|-------|------|-------|
| L0 (preflight) | ~10ms | sync checks |
| L1 (unit) | 94ms | 120 tests, 0 failures |
| L2 (integration) | — | Verdaccio-based |
| **Total** | **~0.1s** | |
