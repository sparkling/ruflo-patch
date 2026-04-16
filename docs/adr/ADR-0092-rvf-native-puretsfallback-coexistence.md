# ADR-0092: RVF native + pure-TS backend coexistence on a shared dbPath

- **Status**: Proposed — 2026-04-16
- **Date**: 2026-04-16
- **Scope**: `@claude-flow/memory` `RvfBackend` and the native `@ruvector/rvf-node` binding
- **Related**: ADR-0086 (Layer 1 Storage), ADR-0090 (Acceptance audit — discovered during Tier B1 work), the B7 multi-writer convergence fix (fork commits `03ecec5e0` and `de7ba4876`)

## Context

ADR-0090 Tier B1 work (2026-04-15/16) added an acceptance check for
dimension-mismatch fail-loud behavior. While writing an ad-hoc
multi-writer diagnostic to verify that the B7 seenIds tombstone fix
didn't regress the multi-writer convergence, a distinct format-
coexistence issue surfaced that the official B7 diagnostic
(`scripts/diag-rvf-inproc-race.mjs`) does not catch.

### Observed behavior

Four concurrent `RvfBackend` instances, all pointed at the same
`dbPath` (a plain path to `.rvf`), exhibit:

1. The first instance (W0) successfully loads the native `@ruvector/
   rvf-node` binding via `tryNativeInit()` — the native load appears to
   hold an exclusive resource, so subsequent instances in the same
   process cannot load it.
2. W1, W2, W3 each catch the native-load failure and fall back to the
   pure-TS HnswLite backend, emitting "not available, using pure-TS
   fallback".
3. At persist time, W0 writes its serialized metadata to `dbPath +
   '.meta'` (native's `metadataPath` getter returns `.meta` when
   `nativeDb` is set — see rvf-backend.ts:998), while W1-3 write their
   serialized metadata to `dbPath` directly (pure-TS uses `dbPath` as
   its `metadataPath`).
4. The merge-before-persist path prefers `.meta` when present:

   ```ts
   if (existsSync(metaPath)) {
     loadPath = metaPath;
   } else if (existsSync(this.config.databasePath)) {
     loadPath = this.config.databasePath;
   }
   ```

   So when W1-3 subsequently persist, their merge sees only W0's state
   (from `.meta`) — not their own prior writes via `dbPath` unless
   they'd committed through the shared WAL. And W0's `.meta` sidecar
   is never updated by W1-3 because they write to `dbPath`.

### Measured consequence

Ad-hoc diagnostic:
- 4 writers, each stores 1 unique entry, all shut down, fresh reader
  counts entries.
- Expected: 4.
- Observed (with my seenIds fix applied): **1**.
- Only W0's entry survives. W1-3's writes to `dbPath` are either
  overwritten or ignored because the reader prefers `.meta` on load.

The official B7 diagnostic (`scripts/diag-rvf-inproc-race.mjs`) does
NOT reproduce this because its 4 writers all take the pure-TS path
(which one? needs follow-up — perhaps the native binding fails in the
diagnostic's environment differently). Its matrix is 4/4 clean at N=2,
N=4, N=8 → suggesting the diagnostic never exercises the native +
pure-TS mix that the ad-hoc test hit.

### Why this is not a B7 regression

The B7 fix (`03ecec5e0`) addresses in-memory state convergence when
multiple pure-TS writers race on the same file format. The seenIds
tombstone followup (`de7ba4876`) addresses bulkDelete resurrection via
the same set-if-absent merge. Neither fix was scoped to — nor could
have addressed — the case where peer writers use a *different*
metadata format on a *different* file path.

This is a pre-existing divergence surfaced by the B1 work, not a
regression. The previous behavior (pre-B7) would have shown similar
data loss in the native-plus-pure-TS case because the underlying
format divergence has always existed.

### Why it's not obviously urgent

Real-world exposure requires:

1. Multiple concurrent processes (not threads — the native binding's
   exclusive load prevents same-process concurrency from triggering
   this) all opening the same `RvfBackend` on the same `dbPath`.
2. Exactly one of them successfully loading the native binding (the
   others must fall back).
3. The pure-TS-falling-back processes to have writes that land before
   the native process's last persist.

In practice, the CLI is the dominant consumer; it runs one process at
a time against a given project dir. The scenarios where this bites:

- Developer runs `cli memory store` in one terminal while a background
  daemon has an open RVF instance (native) on the same path.
- CI matrix with parallel memory ops (e.g. test parallelism) under the
  same temp dir.
- Multi-user / shared-filesystem deployments (rare for CLI use).

None of these are hypothetical — they're all plausible. But they're
also not the dominant code path, which is why the silent data loss
has survived undetected.

## Decision

Defer pending ADR review. The recommended disposition is one of two
options:

### Option A: Accept as known limitation (recommended for now)

- Document the constraint: concurrent CLI invocations on the same
  project dir should not mix native and pure-TS `RvfBackend`
  instances.
- Add a diagnostic check that warns when `@ruvector/rvf-node` is
  installed AND multiple `RvfBackend` processes are detected on the
  same dbPath (the existing `.rvf.lock` file already serializes
  persists, but does not prevent different processes from picking
  different backends independently).
- Extend `scripts/diag-rvf-inproc-race.mjs` (or add a sibling
  diagnostic) to explicitly cover the native + pure-TS mix so a
  future fix can be validated against a known-failing repro.
- Acceptance check does NOT gate the release on fixing this; the
  B1/B4/B7 fixes that shipped in the same session are the immediate
  priority. Schedule a fix in the next 2-4 sessions.

### Option B: Unify metadata path regardless of native/pure-TS

- Change `get metadataPath()` to always return `dbPath + '.meta'`
  (or always return `dbPath` — either unifies) so native and pure-TS
  writers serialize metadata to the same file.
- Native's NAPI format still lives at `dbPath`; its vector data is
  independent of the metadata sidecar.
- Risk: any external consumer that reads `.meta` directly needs to
  be audited. The `getStoredDimension()` helper on RvfBackend and
  the merge-before-persist reader are the known consumers in-tree.
- Risk: the native binding may own `dbPath` exclusively (file lock
  at the OS level); pure-TS writes to `dbPath` may already be
  failing silently. Investigate first.
- Risk: requires a migration for existing on-disk state where native
  has populated `.meta` and pure-TS has populated `dbPath` (or vice
  versa). The safe path: when opening an `RvfBackend`, if both
  `.meta` and `dbPath` have metadata headers, merge them with
  last-write-wins and persist the unified state to whichever path
  the new code uses.

### Option C: Block native + pure-TS coexistence loud-fail

- If `tryNativeInit()` fails because the native binding is already
  held by another process (detectable via a lockfile adjacent to
  the NAPI file), throw loudly rather than falling back to pure-TS
  silently.
- This surfaces the coexistence risk as a clear runtime error the
  operator must resolve (e.g. by stopping the daemon or by choosing
  one backend deployment-wide).
- Violates the "best-effort" pattern but is in line with ADR-0082
  "no silent fallbacks" when the fallback produces silently-wrong
  results.

**Recommended**: Option A now, then Option B as the medium-term fix
with a migration path. Option C is tempting but too aggressive —
plenty of users have the native binding installed but don't actually
run multiple processes against the same dbPath, and they should not
be forced to debug a loud failure that doesn't apply to them.

## Acceptance criteria for this ADR

This ADR is NOT implemented when it's committed. It's documented when
committed. "Implemented" requires:

1. A diagnostic or acceptance check that deterministically reproduces
   the native + pure-TS data loss (so any future fix can be validated
   against a known-failing repro).
2. A decision on Option A/B/C recorded as a status update to this ADR.
3. If Option B or C is chosen, the corresponding fork patch in
   `v3/@claude-flow/memory/src/rvf-backend.ts` plus unit and
   acceptance coverage.

Until the decision is made, do not file this as a bug for end users
— the exposure is narrow enough that a fix landing within a few
sessions is adequate.

## References

- `v3/@claude-flow/memory/src/rvf-backend.ts:998` — `get metadataPath()`
  returns `.meta` when native is active, `dbPath` otherwise
- `v3/@claude-flow/memory/src/rvf-backend.ts:582-618` — `tryNativeInit()`
  with fall-back-to-pure-TS on failure
- `v3/@claude-flow/memory/src/rvf-backend.ts:1110-1178` — `mergePeerStateBeforePersist()`
  reads `.meta` first, falls back to `dbPath`
- `scripts/diag-rvf-inproc-race.mjs` — B7 regression guard that does
  not hit this case
- Ad-hoc ruflo-patch diagnostic session (2026-04-15/16, not committed)
  — 4/4 → 1/4 convergence regression with dimensions:3, 4 writers on
  shared `dbPath` under the fresh `.112` install
