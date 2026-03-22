# Settings-Generator Audit Results (2026-03-04)

## Audit Scope

Reviewed all patches that target `SETTINGS_GEN` (settings-generator.js) or affect settings.json generation, and verified coverage against 4 upstream bugs.

## Patches Targeting SETTINGS_GEN

| Defect ID | File | Description | Changes |
|-----------|------|-------------|---------|
| **SG-001** | `init/settings-generator.js`, `init/types.js` | Invalid hooks (TeammateIdle, TaskCompleted), overly broad permissions, relative paths, phantom statusLine config | 5 ops: replace invalid hooks → SubagentStop, fix permissions, use $CLAUDE_PROJECT_DIR, gate statusLine, fix MINIMAL preset |
| **SG-003** | `commands/init.js`, `init/executor.js`, `init/helpers-generator.js`, hook-handler.cjs template | Missing helpers generation for --dual, --minimal, hooks, upgrade paths | 7 ops (11 calls): executeInit for --dual, auto-generate critical helpers, fix requires, expand upgrade paths |
| **SG-004** | `commands/init.js` | Wizard missing parity with init | Checks for .claude/settings.json, adds prompt |
| **SG-006** | `commands/init.js` | Wizard captures permissionRequest hook but topology hardcoded | Hook capture in wizard |
| **SG-008** | `init/executor.js` | init should generate .claude-flow/config.json (not YAML) | Writes config.json instead of YAML |
| **SG-010** | `commands/init.js` | Add CLI options for all config.json settings | New CLI flags |

## Bug Coverage Analysis

### Bug 1: HOOK ORDER (SessionStart)
**Issue**: `auto-memory-hook.mjs import` should run AFTER `session-restore`, not before.

Upstream v3.5.2 structure:
```javascript
hooks.SessionStart = [
  {
    hooks: [
      { command: '...hook-handler.cjs session-restore', timeout: 15000 },
      { command: '...auto-memory-hook.mjs import', timeout: 8000 },
    ],
  },
];
```

**Status**: ✅ **CORRECT IN UPSTREAM** — auto-memory-hook.mjs import IS already second (after session-restore)
- No patch needed. The user's concern may be based on older code.

### Bug 2: DUPLICATE SESSION-END (PreCompact)
**Issue**: PreCompact hook config has TWO `session-end` commands (one in compact-manual, one in compact-auto), which is redundant.

Upstream v3.5.2 structure:
```javascript
hooks.PreCompact = [
  {
    matcher: 'manual',
    hooks: [
      { command: '...hook-handler.cjs compact-manual' },
      { command: '...hook-handler.cjs session-end', timeout: 5000 },
    ],
  },
  {
    matcher: 'auto',
    hooks: [
      { command: '...hook-handler.cjs compact-auto' },
      { command: '...hook-handler.cjs session-end', timeout: 6000 },
    ],
  },
];
```

**Status**: ❌ **NOT COVERED** — This IS redundant. Both compact-manual and compact-auto call session-end.
- No patch exists to deduplicate.
- Both calls are present in the template.

### Bug 3: MISSING TIMEOUT (Compact hooks)
**Issue**: The first hook in each PreCompact matcher (compact-manual, compact-auto) lacks a `timeout` property.

Upstream v3.5.2:
```javascript
{ command: '...hook-handler.cjs compact-manual' },  // ← NO TIMEOUT
{ command: '...hook-handler.cjs session-end', timeout: 5000 },  // ← HAS TIMEOUT
```

**Status**: ❌ **NOT COVERED** — compact-manual and compact-auto hooks lack timeouts.
- No patch exists to add timeouts.
- Could hang indefinitely if hook-handler.cjs compact-manual takes too long.

### Bug 4: STALE BACKEND (claudeFlow.memory.backend)
**Issue**: settings.json should set `backend: "agentdb"` not `backend: "hybrid"` (ADR-048).

**Investigation**: Searched settings-generator.js for claudeFlow.memory.backend structure but did NOT find it in the current template.
- Either: (a) claudeFlow.memory is not in settings.json, or (b) it's in a different file.
- Checked WM-003: WM-003d readConfig() sets defaults.backend = 'agentdb' in auto-memory-hook.mjs, but this is NOT the same as claudeFlow.memory.backend in settings.json.

**Status**: ⚠️ **UNCLEAR** — Need to verify:
1. Does settings.json have a `claudeFlow.memory.backend` field?
2. If yes, what value does it currently have?
3. If it's 'hybrid', WM-003 patch only fixes auto-memory-hook.mjs, not the settings.json template itself.

---

## Summary

| Bug | Status | Patch | Notes |
|-----|--------|-------|-------|
| 1: Hook order (SessionStart) | ✅ COVERED | None needed | Already correct in v3.5.2 |
| 2: Duplicate session-end | ❌ NOT COVERED | None | Redundancy exists in template |
| 3: Missing timeout | ❌ NOT COVERED | None | Compact hooks lack timeout property |
| 4: Stale backend | ⚠️ UNCLEAR | WM-003 (partial?) | Settings.json structure needs verification |

---

## Additional Findings

1. **SG-001** covers invalid hook events (TeammateIdle, TaskCompleted) not mentioned in the 4 bugs.
2. **WM-003** extends auto-memory-hook.mjs to read config.json and set backend='agentdb', but this may not cover the settings.json template itself.
3. **No patch currently reorders hooks** (Bug 1) — because the upstream is already correct.
4. **Bugs 2 & 3** appear to be genuine gaps in the current patch suite.
