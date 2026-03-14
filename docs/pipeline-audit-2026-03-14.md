# Pipeline Audit — 2026-03-14

## Soundness: Strong

- Failure gating correct at every stage — build failure blocks publish, test failure blocks state save
- State saved only after successful verify (not before)
- Version bumps idempotent — `fork-version.mjs` queries npm to determine next patch.N
- Flock handles orphaned sleep processes (exec 9>&- fix)
- Merge conflicts create labeled PRs for human review

## Completeness: Moderate Gaps

### Tested (16 checks)
T01-T16: Version, @latest, broken versions, init, settings, scope, MCP, ruflo init --full, doctor, wrapper proxy, memory lifecycle, neural training, agent-booster ESM/CLI, plugins SDK, plugin install

### Not Tested
- MCP server runtime (only checks config file exists)
- Hooks lifecycle (pre-task, post-task, session-start)
- Daemon start/stop
- Swarm init/coordination
- Session save/restore
- Security scan
- Cross-package runtime type compatibility (41 relationships, only 3-4 exercised)

### Patch Regression
No dedicated patch manifest or regression test. If a patch is silently reverted during upstream sync, no test catches it until a user reports.

## Performance (236s baseline)

| Phase | Time | % |
|-------|------|---|
| merge-detect | 3.6s | 2% |
| bump-versions | 1.2s | 1% |
| copy+codemod+build (publish) | 25.7s | 11% |
| test-ci (L0+L1) | 0.2s | 0% |
| verify (1st, cold) | 110.6s | 47% |
| copy+codemod+build (sync) | 26.5s | 11% |
| verify (2nd, warm) | 53.6s | 23% |
| sync PR creation | 9s | 4% |
| **Total** | **236s** | |

### Verify Breakdown (1st run)
- publish-verdaccio: 7.8s (7%)
- npx-cache-clear: 7.3s (7%)
- npm-install: 22.1s (20%)
- acceptance-checks: 61.7s (56%)
- promote: 9.7s (9%)

### Optimizations Applied
- D5: Skip sync build when no upstream changes (-80s)
- D1: Reuse build artifacts in sync stage (-26.5s)
- D4: Replace grep _cacache with --prefer-online (-13.6s)
- D2: Parallelize promote (-17s)

Target: 236s -> ~99s (2.4x faster)

## Patch Verification (10/10 spot checks PASS)

HW-001, NS-003, DM-002, SG-008, CF-006, WM-107, EM-002, GV-001, RS-001, AN-001 — all confirmed present in Verdaccio-published packages.
