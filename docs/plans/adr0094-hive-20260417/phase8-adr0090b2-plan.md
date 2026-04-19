# Phase 8 — ADR-0090 Tier B2 RvfCorruptError fix plan

## Root cause
`loadFromDisk` already stamps `err.name='RvfCorruptError'` at 1877-1884, but `tryNativeInit` runs FIRST (called from `initialize()` line 215) and throws plain `Error` at lines 939/964/975/1017. When tests zero file magic, the native-init peek (822-851) triggers 964/975 and the raw Error bubbles through. Secondary: SFVR-magic files with wiped manifest throw native `ManifestNotFound` re-wrapped as plain `Error` at 939.

## Section A — RvfCorruptError class
- **Location**: rvf-backend.ts top-of-file, after imports, before `MAGIC` constants. Same file — no new module.
- **Signature**: `class RvfCorruptError extends Error { constructor(path: string, reason: string) { super(\`RVF storage at ${path} is corrupt: ${reason}. No WAL recovery data available. Refusing to start with empty state to prevent silent overwrite of the corrupt file on next persist. Move or delete the file to start fresh, or restore from a backup.\`); this.name = 'RvfCorruptError'; } }`
- Two-arg (path, reason). Preserves existing 1878-1882 wording → dist-regex assertions at test lines 380-387 still pass.

## Section B — 6 throw sites

| # | Test regex | Site | Current | Fix |
|---|---|---|---|---|
| B1 | `/bad magic bytes/` | tryNativeInit 973-980 unknown-magic | plain `Error("unknown magic")` | `throw new RvfCorruptError(path, \`bad magic bytes (got ${JSON.stringify(peekStr)}, expected 'SFVR' or 'RVF\\0')\`)` |
| B2 | `/bad magic/` | Same 973-980 on `.meta` path OR 963-969 partial-peek | plain `Error` | B1 + also 963-969: `throw new RvfCorruptError(path, \`only ${peekBytesRead}/4 magic bytes present — truncated or mid-write\`)` |
| B3 | `/shorter than the 8-byte RVF header/` | loadFromDisk 1755-1757 | Correct reason; works in pure-TS — only fails when tryNativeInit preempts | B1 fix covers preempt |
| B4 | `/truncated header/` | loadFromDisk 1769-1771 | Correct; preempted same way | B1 fix covers |
| B5 | `/header JSON parse failed\|bad magic\|corrupt/i` | loadFromDisk 1777-1779 | Correct; preempted | B1 fix covers (regex accepts `/bad magic/`) |
| B6 | `/truncated entry\|bad magic/` | loadFromDisk 1798-1801 | Correct; preempted | B1 fix covers |

Also convert line 1877 `new Error(...)` → `new RvfCorruptError(loadPath!, loadFailReason)` (mechanical). Optional: line 939 `RvfDatabase.open failed` → `RvfCorruptError` for ManifestNotFound (matches `/corrupt/i`).

## Section C — 4 no-throw invariants

| # | Test | Handling | Action |
|---|---|---|---|
| C1 | File absent | tryNativeInit 822 sees `fileOnDisk=false`, cold-start path. loadFromDisk 1658-1721 gets `loadPath=null`, skips main block, empty WAL — no throw | None |
| C2 | 0-byte file | loadFromDisk 1753-1754 explicit cold-start. But tryNativeInit 963 `fileOnDisk && peekBytesRead<4` fires on 0-byte (peekBytesRead=0) — currently throws | Guard: `if (fileOnDisk && peekBytesRead > 0 && peekBytesRead < 4)` so 0-byte falls to 1753 |
| C3 | Main corrupt + WAL recovers | loadFromDisk 1866-1868 always replays WAL; 1876 only throws when `entries.size===0`. Test 313-354 zeroes 4 bytes → tryNativeInit 975 preempts WAL replay | **Restructure**: tryNativeInit must not throw on unknown/partial magic. Set `this._deferredCorruptReason = reason` + `return false`. loadFromDisk 1876 becomes `if ((loadFailed \|\| this._deferredCorruptReason) && entries.size===0)` so replayWal (1868) runs first |
| C4 | Valid main + clean reopen | tryNativeInit 972 sees `RVF\0` → false. loadFromDisk pure-TS parse 1750-1858 succeeds, no throw | None |

Verified line numbers in rvf-backend.ts @ forks/ruflo/v3/@claude-flow/memory/src/.

## Section D — Fork dependency
`@claude-flow/memory` package.json:19-33 declares no @claude-flow/* deps for rvf-backend.ts. Grep of 22 RvfBackend-referencing files: all intra-package (`memory/src/*.ts`) or downstream (`cli/src/*`) consumers that import via `@sparkleideas/memory` index (index.ts:190-191). Cascade step 7a rebuilds `memory` before `cli` by dep-group (ADR-0038), so the fix propagates automatically. No cross-package updates; no package.json edits. Exporting `RvfCorruptError` from index.ts is optional — tests check `err.name` string.

## Section E — Test-side sanity
Re-read `assertCorruptThrow` (115-137) and 8 case bodies (156-288, 296-364). Every reason regex is satisfiable by the unified wording. No-throw invariants all map to existing paths plus C2+C3 adjustments. Nothing overspecified; no impossible invariants.
