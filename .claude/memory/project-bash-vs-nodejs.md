---
name: Bash-to-Node.js stage script conversion (planned)
description: Convert ruflo-publish.sh and ruflo-sync.sh from hybrid bash/node to pure ESM — approved but not yet scheduled
type: project
---

Convert ruflo-publish.sh (390 lines) and ruflo-sync.sh (509 lines) from hybrid bash+inline-node to pure ESM Node.js scripts.

**Why:** 14 inline `node -e` snippets prove the scripts are already half-JavaScript. All JSON manipulation, SHA comparison, and string processing is cleaner in JS. Shell primitives (git, rsync) can be called via `execFile`.

**Scope:**
1. Create `lib/pipeline-node.mjs` — shared Node.js pipeline utilities (logging, timing, state, git helpers, retry)
2. Convert `scripts/ruflo-publish.sh` → `scripts/ruflo-publish.mjs`
3. Convert `scripts/ruflo-sync.sh` → `scripts/ruflo-sync.mjs`
4. Update dispatcher `sync-and-build.sh` to call `node scripts/ruflo-publish.mjs`
5. Update `package.json` sync target
6. Keep bash libs for other consumers (build-packages.sh, copy-source.sh, etc.)

**Effort:** ~8 hours (P4 priority from hive-mind critique)

**How to apply:** When this is scheduled, use parallel agents for the two stage scripts. Create shared lib first as foundation.
