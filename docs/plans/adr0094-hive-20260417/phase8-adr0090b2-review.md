# Phase 8 — ADR-0090 Tier B2 RvfBackend Fail-Loud Review

**Author:** Agent V — **Date:** 2026-04-19
**Verdict:** APPROVE
**Scope:** `RvfBackend.loadFromDisk` corruption fail-loud contract; `RvfCorruptError` propagation through CLI storage wrapper.

---

## Coder deliverable under review

Two fork commits on `forks/ruflo@main` (both by Henrik Pettersen, 2026-04-16):

| Commit | Summary | Files | Lines |
|---|---|---|---|
| `f6f8f8b92` | fix: ADR-0090 Tier B2 — RvfBackend fail-loud on corrupt load | `rvf-backend.ts` + `memory-router.ts` | +110 / −11 |
| `12aa4cb33` | fix: ADR-0090 Tier B2 + ADR-0092 — loadFromDisk skips native binary path | `rvf-backend.ts` | +28 / −5 |

Combined: 2 source files, +138 / −16, zero `dist/` edits, zero `package.json` edits, zero codemod edits.

Test file `tests/unit/adr0090-b2-corruption.test.mjs` has a single commit (`bce38dc feat: ADR-0090 Tier B2 — RVF corruption recovery suite (w/ fork patches)`, 2026-04-16) and has NOT been modified after coder's fix landed.

---

## Planning-file caveat

Researcher plan at `/docs/plans/adr0094-hive-20260417/phase8-adr0090b2-plan.md` does **NOT** exist in this repo at review time. The B2 work predates the current "phase8-…" naming convention — it was implemented 2026-04-16 against the planning notes embedded in the commit messages themselves (see `f6f8f8b92` body). I reviewed against the **test contract** (`adr0090-b2-corruption.test.mjs`) as the canonical acceptance spec, and against CLAUDE.md §"What We Tried and Won't Try Again" entries for ADR-0082/0086/0089/0090.

---

## Findings table

| # | Item | Status | Evidence |
|---|---|---|---|
| C-1 | Bad magic on main file (no .meta, no WAL) → throws `RvfCorruptError` w/ `bad magic bytes` | PASS | `rvf-backend.ts:1760-1762` sets `loadFailed=true`, `loadFailReason='bad magic bytes (expected ...)'`. Matches test regex `/bad magic bytes/` at line 174. |
| C-2 | Bad magic on `.meta` (no main, no WAL) → throws w/ `bad magic` | PASS | Same branch as C-1; test opens `.meta` path directly at line 197. |
| C-3 | Truncated <8 bytes → throws w/ `shorter than the 8-byte RVF header` | PASS | `rvf-backend.ts:1755-1757` `else if (raw.length < 8) { loadFailReason = 'file is shorter than the 8-byte RVF header (${raw.length} bytes)' }`. Matches test regex at line 211. |
| C-4 | Truncated mid-header → throws w/ `truncated header` | PASS | `rvf-backend.ts:1769-1771` `else if (8 + headerLen > raw.length) { loadFailReason = 'truncated header (expected ${8 + headerLen} bytes, got ${raw.length})' }`. Matches test regex at line 225. |
| C-5 | Corrupt header JSON → throws w/ `header JSON parse failed\|bad magic\|corrupt` | PASS | `rvf-backend.ts:1777-1779` sets reason to `'header JSON parse failed: ${e.message}'`. Test also accepts the `bad magic` fallback (line 258) for native-SFVR files whose magic was zeroed. |
| C-6 | Truncated entries body → throws w/ `truncated entry\|bad magic` | PASS | Two adjacent branches cover it: `rvf-backend.ts:1788-1790` (`truncated entry-length prefix at offset ${offset} ...`) and `1799-1801` (`truncated entry body at offset ...`). Both match `/truncated entry/`. Test at line 286. |
| E-1 | `err.name === 'RvfCorruptError'` on every throw | PASS | Single throw site at `rvf-backend.ts:1876-1884` — `err.name = 'RvfCorruptError'` unconditional before `throw`. Test asserts at line 126. String-tagged name (not a subclassed Error) survives the dynamic-import module boundary — matches the B1 `EmbeddingDimensionError` pattern cited in commit body. |
| E-2 | Every error message contains the literal `is corrupt` | PASS | `rvf-backend.ts:1878` — `'RVF storage at ${loadPath} is corrupt: ${loadFailReason}. ...'`. Test asserts `/is corrupt/` at line 128. |
| N-1 | No throw when file is absent (cold start, count=0) | PASS | `if (loadPath)` at `rvf-backend.ts:1750` is skipped when `loadPath===null`. `loadFailed` stays false → guard at 1876 is false → no throw. Test at line 296-302. |
| N-2 | No throw when file is 0 bytes (cold start, count=0) | PASS | `rvf-backend.ts:1753-1754` explicit `if (raw.length === 0) { /* Empty file — treat as cold start, not corruption */ }`. Test at line 304-311. |
| N-3 | No throw when main corrupt + WAL has entries (count >= 1) | PASS | `rvf-backend.ts:1866-1868` `await this.replayWal();` runs unconditionally after the main-file block. If WAL populates `this.entries`, guard `this.entries.size === 0` at 1876 is false → no throw. Test at line 313-355. |
| N-4 | No throw when re-opening a clean main file | PASS | Main file parses cleanly → `loadFailed=false` → no throw. Test at line 357-364. |
| D-1 | Dist contains `RvfCorruptError` and `is corrupt:` | PASS | Verified in `/tmp/ruflo-fast-ua3L7/node_modules/@sparkleideas/memory/dist/rvf-backend.js:1852-1856`. |
| D-2 | Dist contains `Refusing to start with empty state` | PASS | Same dist line 1854. |
| D-3 | Dist gates main-path read on `!this.nativeDb` (ADR-0092 guard, ≥2 call sites) | PASS | Dist has 20+ `this.nativeDb` references, with the ADR-0092 guards at `1622` (mergePeerStateBeforePersist) and `1660` (loadFromDisk) — test requires ≥ 2. |
| S-1 | Test file untouched by coder | PASS | `git log --all -- tests/unit/adr0090-b2-corruption.test.mjs` shows exactly one commit (`bce38dc`, 2026-04-16), predating the fix. Coder did not modify the test to make it pass. |
| S-2 | CLI wrapper preserves `RvfCorruptError.name` | PASS | `memory-router.ts:522+` now has `if (e && (e as Error).name === 'RvfCorruptError') throw e;` **before** the generic `new Error('Storage initialization failed: ...')` wrap. Matches the B1 `EmbeddingDimensionError` pattern. Without this, the CLI would swallow the diagnostic and the corruption-specific exit path wouldn't fire. |
| S-3 | Fork patched, no codemod | PASS | Both commits in `forks/ruflo`, zero lines in `ruflo-patch/scripts/codemod`. |
| S-4 | No `dist/` edits in either commit | PASS | `git diff --name-only f6f8f8b92^..12aa4cb33` returns only 2 `v3/@claude-flow/*/src/*.ts` files. |
| S-5 | Scope creep check (files beyond rvf-backend.ts) | ACCEPTED | `memory-router.ts` (11 lines) IS the CLI surface required to preserve the error name — without it, the fix would be invisible to the CLI exit-code path. This is not scope creep; it's the minimum surface to make the fail-loud visible end-to-end. |
| S-6 | 500-line rule — `rvf-backend.ts` 2089 LOC | ACCEPTED | Per CLAUDE.md §"What We Tried and Won't Try Again" (2026-04 lesson on ADR-0089 intercept pattern), upstream-maintained files stay at their upstream size to avoid merge tax. `controller-registry.ts` 2063, `agentdb-service.ts` 1831 set the precedent. The B2 fix ADDS 138 lines but does not restructure the file. |
| S-7 | No silent-pass patterns in the fix itself | PASS | Every corruption branch sets `loadFailed = true` with a specific `loadFailReason`. The only `catch {}` remaining in the patched block is `replayWal` (line 1608, "Corrupt individual entry — skip and continue") which is correct behavior: WAL is a log of independent writes, and skipping corrupt individual entries while keeping valid ones is the intended WAL recovery semantics. Not an ADR-0082 violation. |

---

## Walk-through risk notes (non-blocking)

1. **`loadFailReason` string coverage.** Each regex in the test file matches a specific source-line literal. If future refactoring rewords any of these 6 reason strings, the corresponding test fails. This is the right behavior — the message IS the user-facing contract — but is worth documenting so nobody silently rewords the strings.

2. **Native-active + no `.meta` scenario.** When `tryNativeInit` succeeds AND `.meta` doesn't exist yet (first init in a project), `loadFromDisk` sets `loadPath=null` (lines 1660-1675), skips the main-file block, runs WAL replay (empty WAL on cold start), and returns. Correct — not a corruption scenario. The 12aa4cb33 commit's whole purpose is this guard.

3. **`if (loaded === 0)` truncation semantics** (lines 1788-1790, 1799-1801, 1815-1817). The `loadFailed=true` trips ONLY when the truncation happens before any entry is loaded. If 2 of 3 entries loaded and the 3rd is truncated, it logs (verbose) and returns what was loaded — `loadFailed` stays false, no throw. This matches the test contract (test 4: "no-throw cases" includes a partial-recovery note, though no specific test exercises "main partially recovered without WAL"). Correct design: a valid prefix is real data, not corruption.

4. **`readFile` catch** (lines 1859-1863). The outer try/catch around `readFile` sets `loadFailed=true` with `'read failed: ${err.message}'`. Matches ADR-0082: IO errors (EIO, EPERM) now surface as corruption signals rather than silent falls-through-to-WAL.

---

## Verdict

**APPROVE.**

- All 6 required throw paths are covered with the exact `loadFailReason` strings the test regexes demand.
- All 4 required no-throw paths preserve pre-fix behavior (cold-start, 0-byte, WAL-recover, clean-reopen).
- The single throw site at line 1876-1884 is the only path that creates `RvfCorruptError` and it unconditionally sets `name` and includes the `is corrupt` literal plus the user-facing refusal message.
- No silent-pass, no test modification, no scope creep beyond the one-file CLI wrapper that is semantically required.
- Published dist carries every tag the tests check.

Ship it.
