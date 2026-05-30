---
status: accepted
date: 2026-05-07
tags: [memory, cli, rvf, data-loss]
supersedes: []
depends-on: []
implements: []
---

# `memory init --force` actually resets, and `init` reports the real backend + path

## Context and Problem Statement

`forks/ruflo/v3/@claude-flow/cli/src/commands/memory.ts:1222-1495` implements `ruflo memory init`. Reading it against the post-ADR-0154 contract surfaces three concrete bugs and one consistency gap:

### Bug 1 — `--force` silently no-ops (memory.ts:1275-1291)

```ts
const force = ctx.flags.force as boolean;   // collected
// ...
const { ensureRouter } = await import('../memory/memory-router.js');
await ensureRouter();                        // force never passed through
```

Verified by reading `memory-router.ts:781-788`:

```ts
export async function ensureRouter(): Promise<void> {
  if (_initialized) return;
  // ADR-0086 I2: fast-fail on persistent init failure
  if (_initFailed) throw new Error('Storage initialization permanently failed. Call resetRouter() ...');
  // ...
}
```

`ensureRouter()` early-returns on the `_initialized` flag — once a backend is initialised it does nothing. The router DOES expose a `resetRouter()` function at `memory-router.ts:2144` that clears `_storage`, `_initialized`, `_initFailed`, `_initPromise`, `_lockPath`, etc. — but that function is never called by the `memory init` action. So `--force` neither resets in-process state nor touches disk. The flag is documented as "Overwrite existing database" but the code does nothing different with it. Users running it on a project with stale state get a misleading "Schema initialized" success message and unchanged on-disk state. This is the exact `feedback-no-fallbacks` antipattern at the user's most explicit recovery seam.

ADR-0154's HM-class bug fix is closed by Phase 4 loader-preference, but the operational recovery section ("recovery applied 2026-05-07") still resorts to manual `mv .swarm/memory.rvf.meta .swarm/memory.rvf.meta.disabled-$TS` + `pkill` because `memory init --force` doesn't actually reset. The clean-state escape valve users expect is broken.

### Bug 2 — Hardcoded `dbPath` lies about where data lives (memory.ts:1295-1310)

```ts
const result = {
  success: true as boolean,        // unconditional
  backend,                          // echoes the user's flag, not the resolved backend
  schemaVersion: '3.0',             // hardcoded
  dbPath: customPath || '.swarm/memory.db',  // SQLite path, even for RVF
  features: { vectorEmbeddings: true, /* ... */ },  // hardcoded true
  controllers: undefined,
  tablesCreated: [] as string[],    // never populated
  indexesCreated: [] as string[],   // never populated
  error: undefined,
};
```

Then at `memory.ts:1341` the user sees `Database Path: .swarm/memory.db` regardless of the actual on-disk file. Under ADR-0086 + ADR-0154, the canonical RVF store is `.swarm/memory.rvf` (or `.claude-flow/memory.rvf` per the migrate command's defaults at `memory.ts:1500-1501`). Showing `.swarm/memory.db` is wrong for any RVF-active backend (the production default).

### Bug 3 — Vanity hardcoded result telemetry (memory.ts:1295-1316)

The `result` object's fields (`success`, `backend`, `schemaVersion`, `dbPath`, `features`, `controllers`, `tablesCreated`, `indexesCreated`) are all synthesized JS-side rather than pulled from the router. `success: true` is hardcoded literal. The handler at line 1313 (`if (!result.success)`) is dead code: the entire action body is wrapped in `try/catch`, so if `ensureRouter()` throws, the catch handles it before `result` is even constructed. So Bug 3 is **not** "masks failures" — failures DO surface via the catch. The bug is narrower: the `result` object reports unverified vanity values that don't reflect actual router state. This still violates ADR-0082's spirit (telemetry should be honest), but the severity is lower than failure-masking.

### Consistency gap — guidance still emits the internal package name (split into ADR-0155 follow-up patch)

Three recovery-instruction sites still emit non-canonical names for `memory init`:

- `init/executor.ts:1807` — `npx @sparkleideas/cli@latest memory init --force`
- `mcp-tools/guidance-tools.ts:590` — `cmd: 'npx @sparkleideas/cli@latest memory init --force'`
- `mcp-tools/hooks-tools.ts:2734` — `claude-flow memory init`

Per ADR-0155 + ADR-0143, these must be `@sparkleideas/ruflo@latest` (and `ruflo memory init` for the bare command). **This is a 5-line patch under ADR-0155's umbrella, not part of ADR-0156's scope** — see "Scope split" in §Decision Outcome below. ADR-0156 focuses on the `--force` semantic + path-honesty bugs. The string fix lands separately and faster.

## Considered Options

1. **Wire `--force` to actually reset + report the real backend/path (chosen)** — make the documented contract real, pull `dbPath`/`backend` from resolved router state, and drop fabricated telemetry.
2. **Auto-detect "stale state" and reset without `--force`** — rejected. Implicit destructive behavior on a frequently-run command violates `Executing actions with care`. Explicit opt-in is the right shape.
3. **Make `memory init` a pure no-op when state already exists; require manual `rm`** — rejected. The flag exists; users expect it to work; the documented contract is "Overwrite existing database". Honor the documented contract.
4. **Delete `.swarm/` glob on `--force`** — rejected. `feedback-data-loss-zero-tolerance` + the existence of `.bak-*` / `.disabled-*` / `.migrated-*` files we explicitly want to preserve through a reset rule out anything broader than the canonical sibling set.
5. **Move `--force` into a separate `memory reset` subcommand** — partially considered. Cleaner conceptually: a clearly-named destructive command + `--force` becomes a deprecated alias that prints "use `memory reset` instead". Rejected for ADR-0156 because it's a UX migration on top of the bug fix; the existing flag has a documented contract; users running it expect it to work. **Worth its own ADR if/when scope expands** — added to "Out of scope" below.
6. **Do nothing; just fix the documentation to say "currently no-op"** — rejected. Lower risk, but leaves the user with no working reset escape valve and forces continued reliance on manual `rm` recipes. ADR-0154's recovery section already documents the manual approach; codifying "the flag doesn't work, sorry" in the docs is not an improvement.
7. **Ship only the path-honesty fixes (Bug 2 + Bug 3); skip `--force` semantic fix** — considered. Smaller change, lower risk. Rejected because Bug 2 + Bug 3 are cosmetic and Bug 1 is the user-impacting one. Half-fix doesn't help the people trying to recover from corruption. Worth bundling.

## Decision Outcome

Chosen option: "Wire `--force` to actually reset + report the real backend/path", because Bug 1 (the silent no-op) is the user-impacting failure at the most explicit recovery seam, and honoring the documented "Overwrite existing database" contract restores the clean-state escape valve while honest telemetry satisfies ADR-0082.

### Scope split

The original draft bundled the three guidance-string fixes with the semantic fixes. The critical review (see §Revision history) flagged that the strings are a 5-line patch under ADR-0155's existing umbrella with no new ADR needed, while the semantic work requires router-API additions and tests. Splitting lets the strings land in the next pipeline cycle while ADR-0156 takes the time it needs.

- **ADR-0155 follow-up patch (separate commit, no ADR change)**: 3 string edits at `init/executor.ts:1807`, `mcp-tools/guidance-tools.ts:590`, `mcp-tools/hooks-tools.ts:2734`. Verify the `adr0117-no-bare-ruflo` regex catches them; extend `PATCHED_FILES` if needed. Done.
- **ADR-0156 (this ADR)**: the `--force` semantic fix + path-honesty fixes for `commands/memory.ts`.

### 1. Wire `--force` to actually reset the canonical files

Before calling `ensureRouter()`, when `--force` is set:

1. Resolve the canonical RVF path from the active config. The implementation must use the SAME resolver the running router uses — `forks/ruflo/v3/@claude-flow/memory/src/resolve-config.ts` (`resolveConfig()` → `dbPath` field) is the canonical source. DO NOT hardcode `.swarm/memory.db` and DO NOT introduce a parallel resolver. If the implementer finds `resolveConfig`'s output insufficient (e.g. it returns a backend-config-shape rather than a single path), add a thin getter to `resolve-config.ts` rather than re-implementing the resolution. The `customPath` flag (`-p / --path`) overrides; absent that, `resolveConfig` wins.
2. Compute the canonical sibling set:
   - `<path>` — the main RVF/SFVR file
   - `<path>.meta` — the legacy sidecar (per ADR-0154 delivered contract: still written unconditionally)
   - `<path>.wal` — write-ahead log
   - `<path>.lock` — native flock file
   - `<path>.jslock` — JS-side advisory lock
   - `<path>.ingestlock` — native ingest lock
3. **Lock-acquisition before deletion**: try to acquire the JS advisory lock (`<path>.jslock`) with a short timeout (e.g. 2s). Two cases to discriminate:
   - **Self-held lock** (this process already initialised the router earlier in the same CLI invocation): re-acquisition is fine via the existing reentrant `_lockHeldDepth` counter. Proceed to step 4.
   - **Peer-held lock** (another process holds it): **fail loud** with a message like "another process holds `<path>.jslock`; refuse to reset live state. PIDs that hold ruflo MCP: <list>". Do NOT unlink lock files held by peers — that's a use-after-free shape per `feedback-data-loss-zero-tolerance`.

   The discriminator is whether `process.pid` matches the lock-file's recorded owner PID, OR whether `flock(LOCK_EX)` returns immediately (self) vs blocks beyond the timeout (peer).
4. **Print the to-be-deleted list before unlinking**. With `--quiet` set, skip the print but still execute. With `--quiet` NOT set, print the list and the entry count from the existing `.rvf` (use `peekDimensions` / size to estimate count without full load). Defensive UX — the flag is named `--force` so explicit confirmation isn't required, but the user should see what got removed in the log.
5. For each path in the canonical sibling set: if `existsSync` and `lstatSync` shows a regular file (NOT a symlink — see Risks): `unlinkSync`. Log each removal at INFO level.
6. After deletion, call `resetRouter()` (already exported at `memory-router.ts:2144`) to clear `_storage`, `_initialized`, `_initFailed`, `_lockPath`. Without this, the in-process cached backend persists across the reset and `ensureRouter()` returns the now-orphaned router rather than re-initializing from clean disk.
7. Then call `ensureRouter()` to re-initialize fresh.

CRITICAL: never delete files outside the canonical set. No glob-based wipes. No `rm -rf .swarm/`. Per `feedback-data-loss-zero-tolerance`, only the explicitly enumerated paths. Backups (`.bak-*`, `.disabled-*`, `.migrated-*`) are NEVER auto-deleted — they're the user's safety net. If `--verbose`: list them so the user knows they're there but the implementation does not touch them.

**Non-destructive alternative** (referenced in the flag's `--help` and the printed warning before deletion): users who want to preserve data should use `node scripts/migrate-meta-to-segments.mjs <project>` (the ADR-0154 G6 tool) instead of `--force`. That tool consolidates `.meta` into `.rvf` segments without losing entries; backs up the source files; and has explicit `--prefer-rvf` / `--prefer-meta` modes when the two diverge. `--force` is the destructive escape valve; `migrate` is the preserve-data path.

### 2. Pull `dbPath` + `backend` from the resolved router state

Replace the hardcoded `result` object with values pulled from the router after `ensureRouter()` returns. The exact getter shape will be fleshed out during implementation; sketch:

```ts
await ensureRouter();
// new exported getters on memory-router (added as part of this work):
const result = {
  backend: getActiveBackendName(),     // resolved, not echoed flag
  dbPath: getActiveBackendPaths(),     // string OR string[] — see "Hybrid backend" below
  features: getActiveFeatures(),       // resolved per backend
  schemaVersion: getSchemaVersion(),
  controllers: getControllerStats(),
};
```

`success` is no longer part of `result` — if `ensureRouter()` returned, the action succeeded; if it threw, the existing `try/catch` already prints `printError` and returns exit code 1. Removing the dead vanity flag is cleaner than adding a `isHealthy()` predicate that also trivially returns true post-`ensureRouter`.

**Hybrid backend caveat**: backend `hybrid` (the production default per `memory.ts:1232`) uses both SQLite and RVF. `dbPath` for hybrid is multi-valued. Either:

- (a) `getActiveBackendPaths()` returns `string[]` for hybrid, `string` (single) for sqlite/agentdb/rvf, and the display shows each on its own line; or
- (b) hybrid is explicitly out of scope for ADR-0156 and the existing hardcoded `'.swarm/memory.db'` stays for hybrid until a follow-up — with a clear comment that hybrid path-display is unfixed.

Implementation should pick (a) — listing both paths is honest and trivial. If router internals make (a) hard, (b) is acceptable as long as the limitation is documented in `--help` and the display.

If `memory-router` doesn't yet expose those getters, add them as part of this work — do not synthesize values JS-side.

### 3. Drop fabricated `tablesCreated`/`indexesCreated` + `success` flag

These are an SQLite-era leak that doesn't apply to RVF. Remove from `result` and from the display block (`memory.ts:1338-1349`). Also drop `success` (see §2 — `ensureRouter` returning successfully is the success signal; the literal-true field was vanity).

### 4. Add unit + acceptance tests

- **Unit**: assert `--force` deletes a sentinel `.swarm/memory.rvf` byte (write a 4-byte file, run init `--force`, assert file gone). Sentinel approach so the test is independent of router internals.
- **Unit**: assert `--force` does NOT touch `<path>.bak-*`, `<path>.disabled-*`, `<path>.migrated-*` siblings (write 3 named backup files, run init `--force`, assert all 3 still present).
- **Unit**: assert `--force` fails loud when a peer holds `<path>.jslock` (lock the file from a child process via `flock`, run init `--force`, assert exit code ≠ 0 and error message mentions the lock).
- **Unit**: assert displayed `dbPath` matches the actual file the router opened (write at one path, init reports same path; for hybrid: assert both paths shown).
- **Unit**: assert `--force` is a symlink-safe no-op (create a symlink at the canonical path pointing elsewhere, run init `--force`, assert the symlink is removed but the symlink target is NOT touched).
- **Acceptance**: full e2e in an isolated project — `cli memory init` creates `.swarm/memory.rvf` with SFVR magic; `cli memory init --force` (after writes) clears the canonical sibling set and recreates with SFVR magic + zero entries; backups untouched.

### Consequences

* Good, because `--force` becomes the working escape valve. ADR-0154's "operational recovery" section can be simplified — users no longer need to manually `mv` files.
* Good, because the displayed path matches the file actually opened. Eliminates the "I deleted .swarm/memory.db and it didn't help" support burden.
* Good, because `success` reflects reality. Failures fail loud per ADR-0082.
* Good, because of brand consistency with ADR-0155 across all user-facing `memory init` guidance.
* Bad, because of a slightly larger `commands/memory.ts` action body (added file enumeration + unlink loop). Acceptable — under 30 lines.
* Bad, because `memory-router` may need new public getters (`activeBackendPath()`, `activeBackendName()`, `isHealthy()`, `activeFeatures()`). Acceptable — these are values it already tracks internally; promoting them is mechanical.
* Neutral, because no data migration needed. Existing projects with `.swarm/memory.db` (legacy SQLite) continue to use the existing migrate command (`memory migrate --from-sqlite`). This ADR doesn't change that flow.
* Neutral, because recovery scripts in operational runbooks (e.g., ADR-0154's "Operational recovery applied 2026-05-07" section) should be updated to reference `memory init --force` once it works, replacing the manual `mv .meta` dance. That update is decoupled from this ADR's acceptance — see §Out of scope. It's a non-blocking documentation follow-up that can land any time after #1-#5 of §Decision ship.

### Confirmation

Per `feedback-no-squelch-tests`, every criterion must be observable from a test or pipeline output, not just code review.

1. **`--force` deletes the canonical sibling set**: a sentinel `.rvf` file (4 zero bytes) is unlinked by `cli memory init --force`. Verified by the unit test in §Decision step 4 line 1.
2. **`--force` preserves backups**: `<path>.bak-test`, `<path>.disabled-test`, `<path>.migrated-test` files survive `cli memory init --force`. Verified by unit test.
3. **`--force` fails loud on peer-held lock**: when a peer process holds `<path>.jslock`, `cli memory init --force` exits non-zero with an error message naming the held lock. Verified by unit test.
4. **`--force` is symlink-safe**: when `<path>` is a symlink, the symlink is removed but the target is NOT touched. Verified by unit test.
5. **Displayed `dbPath` matches the file the router opened** for each backend (sqlite, agentdb, rvf, hybrid). Hybrid MUST display all backend paths (§Decision step 2 option a) — option b is acceptable only if the implementer documents in the commit message why option a was infeasible (e.g. router internals genuinely don't expose multi-path getters and the work is out of proportion to this ADR's scope). Verified by unit tests parameterised over backends.
6. **Fabricated `tablesCreated` / `indexesCreated` / `success` are gone** from the user-visible display. Verified by an output snapshot test that captures the post-init display and asserts none of the three field labels appear.
7. **`migrate-meta-to-segments.mjs` is referenced in `--help`** as the non-destructive alternative. Verified by parsing the help output for the string.
8. **No regressions**: pipeline acceptance suite passes ≥ 675/675 (current 674 baseline + the 1 new acceptance test from §Decision step 4); unit suite passes ≥ 4178/4180 (current 4173 pass + 2 skipped + the 5 new unit tests from §Decision step 4). Verified by pipeline run. If the implementer adds additional defensive tests not enumerated above, the totals scale accordingly — the criterion is "zero failures, zero regressions, every new test from §Decision step 4 lands and passes".

## Risks

| Risk | Mitigation |
|---|---|
| **Lock race** — peer process writes mid-reset, sees its lock disappear, ends up with broken state | Acquire `<path>.jslock` first with short timeout; fail loud if held. NEVER unlink lock files held by peers. Test for this case (see §Decision step 3). |
| **Concurrent peer writer skips the lock entirely** (degraded peer in fallback mode, or buggy custom backend) | Out of scope — the lock invariant is a fork-wide assumption per ADR-0095. If broken there, broken here. Document the assumption in `--help`. |
| **Symlink deletion** — `<path>` is a symlink to elsewhere; naive `unlinkSync` removes the link but leaves the target intact, OR follows the symlink and deletes the target | Use `lstatSync` + verify regular file before `unlinkSync` — never follow. If symlink: log and skip with a "refusing to traverse symlink at canonical path" warning. |
| **File enumeration miss** — a future RVF format adds a new sibling extension; `--force` leaves it on disk → partial reset → confusing state | Centralise the canonical sibling list in one constant (e.g. `RVF_CANONICAL_EXTENSIONS = ['', '.meta', '.wal', '.lock', '.jslock', '.ingestlock']`) and reuse from migration tool + tests. Single-source so future additions are visible. |
| **Hybrid backend path-display ambiguity** | (a) Display all paths for hybrid (preferred), or (b) explicit out-of-scope (acceptable). See §Decision step 2. |
| **Ephemeral / `:memory:` backends** | `--force` on a `:memory:` backend should be a no-op with an INFO log; never error. Test this. |
| **User runs `--force` against a project with 1000 entries by misclick** | Print to-be-deleted list + entry count BEFORE unlinking. Document `migrate-meta-to-segments.mjs` as the non-destructive alternative in `--help`. The flag IS named `--force` so we don't add a confirmation prompt; the printed list is the warning. |
| **`resetRouter()` interaction with peer in-process holders** | `resetRouter()` clears module-level `_storage` etc.; if another part of the same process still holds a reference to the prior storage instance, it'll keep using it after reset. This is a process-wide design constraint of the existing router — out of scope for ADR-0156. The CLI's `memory init` is invoked from a fresh process so this isn't a problem in practice. |

## Origin / source diagnostic (verbatim)

Recommendation captured at the moment this ADR was triggered, preserved verbatim so the chain from observation → ADR is auditable. Acceptance criterion #5 below incorporates everything in this diagnostic.

> Yes — small follow-up to ADR-0155. Two sites still emit internal-only `@sparkleideas/cli@latest` in user-facing guidance for `memory init`:
>
> ```
> forks/ruflo/v3/@claude-flow/cli/src/init/executor.ts:1807
>    "npx @sparkleideas/cli@latest memory init --force"
>
> forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/guidance-tools.ts:590
>    { cmd: 'npx @sparkleideas/cli@latest memory init --force', ... }
> ```
>
> These are user-facing recovery instructions — `feedback-always-npx-for-ruflo` plus ADR-0143 (user-facing brand `@sparkleideas/ruflo`) say they should be `@sparkleideas/ruflo@latest`. Same shape as ADR-0155 just fixed for `.mcp.json`.
>
> There's also `mcp-tools/hooks-tools.ts:2734` — `claude-flow memory init` (legacy bare command name; should be `ruflo memory init` for the user-facing surface).
>
> My recommendation: yes, ship it as a small extension of ADR-0155 (no new ADR needed — this is the same rule, broader application). 3 string edits, plus the regression guard in `adr0117-no-bare-ruflo.test.mjs` already covers the contract once we expand its `PATCHED_FILES` list. ~5-line change.

The above recommendation called for a guidance-strings-only patch under ADR-0155's umbrella. The initial ADR-0156 draft bundled those strings with the `--force` semantic + path-honesty fixes uncovered in the same investigation. The post-revision scope split (see §Decision Outcome §Scope split and §Revision history) reverts to the original recommendation: **the 3 string fixes land as an ADR-0155-umbrella patch (no new ADR), and ADR-0156 is scoped purely to the `--force` semantic + path-honesty work**. Reasoning: the strings are 5 lines and ship in the next pipeline cycle; the semantic work needs router-API additions and 6 new tests. Splitting lets the cheap fix land fast without waiting on the bigger one. The "Bundling is correct" framing in the previous version of this paragraph was wrong — the critical review correctly identified that decoupling lets each ship at its own pace.

## Out of scope (deferred)

- Re-implementing Phase 5c suppress-meta with session_save/restore awareness (referenced in ADR-0154 G4 reconciliation; remains its own follow-up if/when needed).
- Refactoring `memory-router.ts`'s internal state shape — the new getters this ADR requires can be thin wrappers over existing internals.
- A general "reset everything in `.swarm/`" command that includes WAL files from killed processes, orphan locks, etc. Worth its own ADR if user demand surfaces.
- Migrating `--force` to a new `memory reset` subcommand with `--force` as a deprecated alias (Considered Option #5). Worth a separate UX ADR if surfaces signal that `--force` is too easy to misuse despite the printed warning.
- Updating ADR-0154 §"Operational recovery applied 2026-05-07" to reference `cli memory init --force` for the file-cleanup step. Decoupled from this ADR — the recovery doc update is non-blocking and can land once #1-#5 above ship; tracked as a documentation follow-up, not a §Acceptance criterion.

## Revision history

**2026-05-07 (initial draft)**: 4 fixes bundled (--force semantics, path-honesty, fabricated success masking failures, 3 guidance strings). 7 acceptance criteria. 4 considered alternatives.

**2026-05-07T19 (this revision, post critical-review)**:
- Verified Bug 1 by reading `memory-router.ts:781-788` (ensureRouter) and `:2144-2158` (resetRouter). Confirmed `--force` is a true no-op; framing kept as written.
- Rephrased Bug 3 from "fabricated success masks failures" → "vanity hardcoded result telemetry". The try/catch wrapper means failures DO surface; the bug is dishonest telemetry, not failure-masking. Lower severity than originally stated.
- **Scope split**: 3 guidance-string fixes moved to an ADR-0155-umbrella patch (5-line change, no new ADR). ADR-0156 now scoped purely to the `--force` semantic + path-honesty fixes.
- Added §Risks table covering 7 specific risks: lock race, peer-skipping-lock, symlink, file-enumeration miss, hybrid path-display, `:memory:`-backend, misclick UX, resetRouter+peer in-process. Each with a mitigation.
- Added lock-acquisition step (acquire `<path>.jslock` first; fail loud if held by peer; never unlink lock files held by peers) to §Decision step 1.
- Added symlink-safety step (`lstatSync` + verify regular file before unlink).
- Added "non-destructive alternative" pointer to `migrate-meta-to-segments.mjs --prefer-rvf` in `--force`'s `--help` and pre-deletion warning.
- Added hybrid-backend path-display caveat in §Decision step 2 with two acceptable resolutions.
- Removed `success: false` from §Decision step 2 (success post-`ensureRouter` is implied by control-flow; the literal-true field was vanity).
- Added 4 new tests (backup-preservation, peer-lock-error, symlink-safety, parameterised-over-backends).
- Added 2 new considered alternatives (do-nothing+fix-docs, ship-half).
- Tightened acceptance criteria from 7 → 8, all observable from tests/pipeline output (per `feedback-no-squelch-tests`).
- Moved ADR-0154 recovery-doc update from §Acceptance criteria → §Out of scope (decoupled — non-blocking documentation follow-up).

**2026-05-07T19+ (this revision, post soundness/completeness analysis)**:
- Removed duplicate `## Considered alternatives` section (an editing artifact — the post-revision 6-alternative version was added without removing the original 4-alternative version).
- Rewrote the §Origin/source-diagnostic concluding paragraph: previously said "Bundling is correct, ship the strings AND semantic fix together" — that was the pre-scope-split position. Updated to reflect the actual post-revision decision (strings split out, ADR-0156 scoped to semantics only).
- Fixed §Consequences/Migration's stale reference to "acceptance-criterion #6" — recovery-doc update is no longer an AC, it's in §Out of scope. Pointer corrected.
- Specified the path resolver (§Decision step 1): use `forks/ruflo/v3/@claude-flow/memory/src/resolve-config.ts:resolveConfig().dbPath`, not a parallel resolver.
- Added self-vs-peer lock discriminator to §Decision step 3: same-process re-acquisition via `_lockHeldDepth` is fine; peer-held lock is the failure case. Discriminator: `flock(LOCK_EX)` returns immediately for self, blocks for peer.
- Tightened AC #5: option (a) is required; option (b) requires implementer justification in commit message.
- AC #6: removed unobservable "reading memory.ts after the change" half; kept only the snapshot test (per `feedback-no-squelch-tests`).
- AC #8: fixed test-count arithmetic — 675/675 acceptance (was 674), 4178/4180 unit (was 4173 + 5 + 2 skipped).

## More Information

Original status: "**[RECONCILED 2026-05-29 → IMPLEMENTED; see ADR-0270]** Shipped in fork commit `cfb0cea02` (`memory init --force` reset + honest dbPath display), corroborated by ADR-0164 (`completed: true`). One residual: the contract test `tests/unit/adr0156-memory-init-force.test.mjs` exists but is **not wired into the standard CICD runner** (`feedback-always-wire-tests-into-cicd`). Original status preserved below. — Proposed 2026-05-07 (revised 2026-05-07T19 after critical review — see Revision history)."

This decision relates to ADR-0086 (RVF is primary, SQLite is fallback), ADR-0154 (HM-class bug closed by loader-preference; clean-reset is the user-facing escape valve), ADR-0155 (user-facing brand `@sparkleideas/ruflo@latest`), ADR-0082 (no silent fallbacks), and the feedback notes `feedback-no-fallbacks` and `feedback-data-loss-zero-tolerance`. The reconciliation note references ADR-0270 and ADR-0164.
