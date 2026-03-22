---
name: Full patch sweep from claude-flow-patch
description: Ported 54 of 146 patches from claude-flow-patch to ruflo-patch fork model (2026-03-14)
type: project
---

On 2026-03-14, analyzed all 146 patches from `~/src/claude-flow-patch` and ported valid ones to fork TypeScript source.

**Results**: 57 applied (54 ruflo + 3 ruvector), 1 skipped (WM-101 — shell-based AgentDB upgrade handled by build pipeline), 82 retired (ADR-068), 3 fixed upstream (CF-001, UI-001, WM-100), 2 N/A (WM-112/113 target CJS artifacts), 1 DOC-only, 1 env-only (EM-002 chmod).

**Why:** The claude-flow-patch project applied runtime Python patches to compiled JS in npm cache. Our ruflo-patch model patches TypeScript source in forks and rebuilds. This sweep brought all valid fixes into our fork model.

**How to apply:** Issues #1–#54 on `sparkling/ruflo-patch` track all patches. The fork commits are on main in `sparkling/ruflo` and `sparkling/ruv-FANN`. Next `npm run build` will pick up all changes.

**Ruvector fork added**: Forked `ruvnet/RuVector` → `sparkling/RuVector` (dir: `~/src/forks/ruvector`). Applied RV-001/002/003 directly to `bin/cli.js` (hand-written JS, no build step). Pipeline may need update to sync this fork.

**Not ported**:
- EM-002 (chmod @xenova/transformers cache) — environment fix, not source patch
