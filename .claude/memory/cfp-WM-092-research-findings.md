# WM-092 Research Findings: Constructor Import Failure

## Root Cause (CRITICAL)

**WM-092 tries to import a non-existent class**: `AgentDBBackend`

The class **does not exist** in:
- Published `@claude-flow/memory@3.0.0-alpha.11`
- Upstream commit `f6c4f5c` (what WM-085 uses)
- Any vendor files in claude-flow-patch

**What actually exists:**
- `HybridBackend` — the wrapper that uses both SQLite + AgentDB
- `ControllerRegistry` — added by WM-085
- `createDefaultEntry` — entry factory

## Import Failure Chain

1. WM-001 (order 350) imports `HybridBackend` ✓
2. WM-092 (order 990) tries to rename it to `AgentDBBackend` ✗
3. Runtime: `const { AgentDBBackend } = memPkg;` → undefined
4. Error: `TypeError: AgentDBBackend is not defined`

## Solution

**Keep `HybridBackend` class name, don't rename it.**

WM-092 should:
1. **Remove** rename operations (ops a, l, m, m2, n)
2. **Keep** HybridBackend import and class name
3. **Remove** SQLite config (ops b, c already do this)
4. **Update** comments to clarify "HybridBackend using AgentDB v3 RVF only"

Result: HybridBackend class remains, but SQLite layer is removed via MM-003.

## dbPath References

**All `.swarm` references are CORRECT** — they correctly place RVF files in `.swarm/` directory:
- `agentdb-memory.rvf` (main file)
- No other db paths need to change

No cross-directory consolidation needed at this layer.

## Downstream Failures (After WM-092 Rename)

These patches assume the renamed class exists:
- `agentdb-tools.js` WM-092l: `getAgentDBBackend()`
- `helpers-generator.js` WM-092m-m2: constructor calls
- `memory-tools.js` WM-092n: import statement

All fail because AgentDBBackend doesn't exist.

## Implementation Priority

1. Fix WM-092 ops a + l + m + m2 + n to NOT rename
2. Verify HybridBackend import still works
3. Test memory initialization works end-to-end
4. Update WM-092 README.md to document the fix
