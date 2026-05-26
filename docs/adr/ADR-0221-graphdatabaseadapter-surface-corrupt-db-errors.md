---
status: accepted
completed: true
date: 2026-05-20
implemented-date: 2026-05-22
tags: [graphadapter, agentdb, data-integrity, fail-loud, no-fallbacks, audit-followup]
supersedes: []
depends-on: [0201]
implements: []
---

# `GraphDatabaseAdapter` must surface corrupt-DB errors instead of silent replacement

> **Reviewed directly (2026-05-22).** Drafted from a single CRITICAL audit
> finding (F-06-005) that escaped the 0205/0206/0217 federation cluster — a
> graph-adapter data-integrity issue, not a sync/CRDT/QUIC issue. Verified
> against live source; Option A confirmed with one feasibility correction
> (the outer catch must pass `GraphDatabaseCorruptError` through, else it
> clobbers the actionable error). See *Direct review*.

## Context and Problem Statement

The ADR-0201 audit
(`docs/audits/2026-05-19-soundness-audit/06-controllers-graph-federation.md`
F-06-005) found that `GraphDatabaseAdapter.initialize()` silently replaces
a corrupt-on-disk graph database with a fresh empty one. This is the
worst-case failure mode for a federation peer: the corrupt-side node boots
green, advertises itself as empty to its peers, and the next sync pushes
the peers' full state into the blank DB — effectively rolling the peer to
genesis. The audit ranks this CRITICAL (data-integrity boundary).

The defect is in the inner try/catch wrapping the existing-DB-open path:

```ts
// forks/agentdb/src/backends/graph/GraphDatabaseAdapter.ts:128-144
try {
  if (require('fs').existsSync(this.config.storagePath)) {
    this.db = GraphDatabase.open(this.config.storagePath);
    console.log('✅ Opened existing RuVector graph database');
    return;
  }
} catch (e) {
  // Database doesn't exist or is corrupt, create new one  ← silent data loss path
}

// Create new database
this.db = new GraphDatabase({
  distanceMetric: this.config.distanceMetric || 'Cosine',
  dimensions: this.config.dimensions || 384,
  storagePath: this.config.storagePath
});
```

The comment "Database doesn't exist or is corrupt, create new one" is the
catch body — there is no discrimination, no quarantine, no signal. The outer
try-catch (lines 148-154) is correct (re-throws with install hint); only
the inner one is wrong.

This is a textbook [[feedback-no-fallbacks]] violation at a data-integrity
boundary, and a textbook [[feedback-best-effort-must-rethrow-fatals]]
violation — the catch swallows two semantically different errors (file
absent vs file corrupt) and proceeds with the same recovery (create empty)
in both cases.

Cross-reference: the same call-site has a related but distinct issue at the
agentic-flow consumer layer (F-06-006: `agentic-flow/src/services/agentdb-service.ts:832-836`
demotes any `graphAdapter.initialize()` failure to `console.warn` +
`graphEnabled=false`). That copy-paste anti-pattern repeats for
`routerEnabled`/`sonaEnabled`/`gnnEnabled` in the same file — a broader
problem flagged by the audit as out-of-scope for the graphadapter ADR
specifically. **This ADR addresses only the inner catch inside
`GraphDatabaseAdapter.initialize`**; the agentic-flow side belongs to a
separate ADR if pursued.

## Decision Drivers

- [[feedback-no-fallbacks]] — silent fallback on a corrupt DB is the
  worst case (the audit's exact framing: "the worst-case failure mode for
  a sync system").
- [[feedback-best-effort-must-rethrow-fatals]] — file-absent and
  file-corrupt are different conditions and must be handled differently.
- Data integrity is non-recoverable: once the corrupt file is silently
  replaced, the original data is gone. There is no "try harder later."
- The fix is small (~10-15 lines) and local to one file.
- README severity: F-06-005 is CRITICAL #10 in the executive summary's
  CRITICAL table.

## Considered Options

- **Option A — Discriminate file-absent from file-corrupt; refuse to start
  on corrupt (chosen).** Reshape the inner try/catch to use
  `fs.existsSync` as the gate (already done), and on `GraphDatabase.open`
  throw: if the error is "file not found"-class, fall through to create
  new; otherwise (corruption, permission, version mismatch), re-throw with
  a wrapped `GraphDatabaseCorruptError` carrying the original cause. The
  user sees a loud, actionable error rather than a silent zero-out.
- **Option B — Quarantine the corrupt file and create a fresh one;
  warn loudly.** On corruption error, rename the corrupt file to
  `<storagePath>.corrupt.<timestamp>` and proceed with a fresh DB. The
  data is preserved on disk for forensics but the system continues to run.
  This is the "graceful degradation with audit trail" shape. Trades
  immediate availability for explicit user action.
- **Option C — Make the recovery behaviour configurable via
  `GraphConfig.onCorrupt: 'throw' | 'quarantine' | 'replace'`.** Default
  to `'throw'`. Lets advanced users opt into the current behaviour. More
  surface than the audit finding needs.
- **Option D — Status quo.** Rejected outright — direct
  [[feedback-no-fallbacks]] violation at a data-integrity boundary,
  flagged CRITICAL by the audit.

## Decision Outcome

**Chosen: Option A — discriminate and refuse to start on corrupt.**

The minimal, audit-respecting fix. The reshaped catch:

```ts
try {
  if (require('fs').existsSync(this.config.storagePath)) {
    try {
      this.db = GraphDatabase.open(this.config.storagePath);
      console.log('✅ Opened existing RuVector graph database');
      return;
    } catch (openErr) {
      // Discriminate: file present but open failed → corruption/perm/version
      throw new GraphDatabaseCorruptError(
        `Failed to open graph database at ${this.config.storagePath}: ${openErr.message}. ` +
        `Refusing to silently replace. To recover: move the file aside ` +
        `(e.g. mv ${this.config.storagePath} ${this.config.storagePath}.corrupt.$(date +%s)) ` +
        `and restart.`,
        { cause: openErr }
      );
    }
  }
} catch (existsErr) {
  // existsSync threw — file system error, not "database doesn't exist"
  throw existsErr;
}

// File absent: create new database (legitimate first-boot path)
this.db = new GraphDatabase({ … });
```

Rationale:

- File-absent is a legitimate first-boot path; create new.
- File-present + open-fails is a fatal that must surface — the user (or
  operator) decides whether to quarantine, restore from backup, or accept
  data loss by deleting the file.
- The error message includes the explicit recovery command — actionable
  loudness over silent recovery.
- Option B's quarantine is appealing but adds filesystem write logic to the
  init path; the audit's CRITICAL framing favours fail-loud over
  graceful-with-trail.
- Option C's configurability is scope creep — the audit found one defect,
  not a missing feature.
- **The outer catch (`:148-154`) must pass `GraphDatabaseCorruptError`
  through.** It currently re-wraps *every* error into a generic
  `Failed to initialize RuVector Graph Database…` Error, which would clobber
  the new corrupt error's type and its actionable recovery message. Add
  `if (error instanceof GraphDatabaseCorruptError) throw error;` before the
  generic re-wrap. (Without this, Option A's loud error is silently flattened
  by the outer wrapper — the earlier "outer is unaffected" framing was wrong.)

### Consequences

- Good, because a corrupt graph DB now surfaces as a loud, actionable error
  instead of a silent zero-out that propagates to federation peers.
- Good, because the [[feedback-no-fallbacks]] discipline gains one more
  closed surface at the highest-impact category (data integrity).
- Good, because the fix is local (one file, ~15 lines) and matches the
  audit's evidence exactly.
- Bad, because users on a corrupt graph DB will see a startup error instead
  of a "working" zero-state system. Mitigated by the actionable error
  message; the alternative was federation-data loss.
- Bad, because the inner-catch comment ("Database doesn't exist or is
  corrupt, create new one") needs replacement; reviewers reading the diff
  will need to understand the old comment was wrong, not the new code.
- Bad (corrected), because the outer try/catch (`:148-154`) currently
  re-wraps ALL errors into a generic `Failed to initialize` Error — so it
  must add an `instanceof GraphDatabaseCorruptError` passthrough, else it
  swallows the new corrupt error's type and recovery message. (The draft's
  "outer is unaffected" was wrong.)

### Confirmation

1. **Unit test:** create a corrupt file at `storagePath` (truncated /
   wrong-format bytes); call `initialize()`; assert it throws
   `GraphDatabaseCorruptError` with the original cause attached.
2. **Unit test:** call `initialize()` with no file at `storagePath`;
   assert a fresh DB is created and `initialize()` resolves.
3. **Unit test:** create a permission-denied file at `storagePath`;
   assert it throws (not silently creates new).
4. **Federation regression test:** run a two-node sync with one node
   carrying a corrupt graph file; assert the corrupt node fails to start
   (NOT that it accepts the peer's state into a blank DB).
5. **`npm run release`** acceptance — existing agentdb tests pass; any
   test that depended on the silent-replace behaviour must be updated.

## Pros and Cons of the Options

### Option A — discriminate and refuse to start

- Good, because the simplest fail-loud variant.
- Good, because the error message gives the operator the recovery command.
- Bad, because operators with corrupt files see a startup failure (which
  is the correct behaviour for a data-integrity violation).

### Option B — quarantine + fresh DB

- Good, because preserves the corrupt file on disk for forensics.
- Good, because the system continues to run (graceful degradation).
- Bad, because adds filesystem write logic to init.
- Bad, because the audit's CRITICAL framing prefers fail-loud — silent
  continuation, even with quarantine, is the wrong default.

### Option C — configurable behaviour

- Good, because lets advanced users tune.
- Bad, because expands surface beyond what the audit asked.

### Option D — status quo

- Bad, because directly violates [[feedback-no-fallbacks]] at the
  worst-case category.

## Direct review (2026-05-22)

Reviewed directly (not via swarm) against the live agentdb source. **Verdict:
Option A confirmed; one feasibility correction.**

- **F-06-005 verified** — `GraphDatabaseAdapter.initialize()` (`:118`) has an
  inner `try { if existsSync → GraphDatabase.open → return } catch (e) {}`
  (`:130-135`) that swallows a corrupt-open and falls through to
  `new GraphDatabase(...)` (`:140`) — silent zero-out.
- **Judgment: Option A (refuse-to-start) over B (quarantine) / C
  (configurable) is correct.** B's quarantine-and-continue still boots the
  node *empty* — for a federation peer that is the very rollback hazard the
  audit flags; preserving the corrupt file for forensics does not remove the
  empty-boot risk. A refuses to participate with a blank DB. C is scope creep
  on a one-defect finding.
- **Feasibility correction (folded in):** Option A throws
  `GraphDatabaseCorruptError` from *inside* the outer try, whose catch (`:148`)
  re-wraps every error generically — clobbering the new type and recovery
  message. The fix must add an `instanceof GraphDatabaseCorruptError`
  passthrough in the outer catch; the ADR's "outer is unaffected" claim is
  corrected.

The F-06-006 agentic-flow consumer demotion is correctly scoped out (separate
ADR); fixing the adapter side first surfaces it more visibly — the right
sequencing.

## More Information

- **Audit source:**
  `docs/audits/2026-05-19-soundness-audit/06-controllers-graph-federation.md`
  finding F-06-005; README `00-README.md` CRITICAL #10.
- **Related but out-of-scope finding:** F-06-006 — the agentic-flow
  consumer layer (`agentic-flow/src/services/agentdb-service.ts:832-836`)
  demotes any `graphAdapter.initialize()` failure to `console.warn` +
  `graphEnabled=false`. The same copy-paste pattern repeats for
  router/sona/gnn. That belongs to a follow-up ADR (e.g.
  "agentic-flow controller-init failures must be fatal") if pursued;
  this ADR fixes the adapter side only. Fixing the adapter side will
  surface the agentic-flow side's silent demotion more visibly — which is
  the correct sequencing.
- **Memory references:** [[feedback-no-fallbacks]],
  [[feedback-best-effort-must-rethrow-fatals]],
  [[project-adr0201-remediation-impl-order]].
- **Related ADRs:** ADR-0201 (parent audit), ADR-0209 (no-fallbacks
  arch-test — runtime smoke test pattern), ADR-0217 (QUIC sync quarantine —
  sibling federation ADR, different surface), ADR-0178 (fork-only
  controllers restoration — graphAdapter is one of the restored
  controllers, F-06-013 confirms it's intact + delete-API extended).

## Amendment — 2026-05-23 (Move A audit, implemented)

Status flipped: **proposed → implemented**. Implementation landed in `forks/agentdb` commit `ebe9cc2` (co-committed with ADR-0219 fail-loud memory hardening).

**Code:** `forks/agentdb/src/backends/graph/GraphDatabaseAdapter.ts`

- `:108-113` — `GraphDatabaseCorruptError` class added.
- `:149-166` — inner try/catch reshaped per Option A: `existsSync` gate + `GraphDatabase.open` inner try; on open failure throws `GraphDatabaseCorruptError` with cause + recovery command in message.
- `:180-182` — outer catch passthrough (`instanceof GraphDatabaseCorruptError → throw error`) added before generic re-wrap, per the feasibility correction in the Direct Review section.

**Tests:** `forks/agentdb/tests/unit/backends/GraphDatabaseAdapter.test.ts` — 4/4 pass (vitest, 5ms):

1. fresh DB when no file at storagePath,
2. throws `GraphDatabaseCorruptError` when file exists but open fails,
3. message includes storagePath + recovery hint,
4. outer catch does NOT re-wrap (type preserved).

Confirmation items 1-3 satisfied. Items 4 (two-node federation regression test) and 5 (`npm run release` end-to-end) remain owned by acceptance — not gated on this terminal status flip.

Upstream pre-flight: `ruvnet/ruflo` has zero history touching `GraphDatabaseAdapter`; `ruvnet/agentdb` (2026-05-06 spin-off) has zero graph code. No re-converge risk. No INTEGRATION-LEDGER row (fork-original work).

**Follow-up flagged:** F-06-006 (agentic-flow consumer demotion at `agentdb-service.ts:832-836`) is explicitly out-of-scope and remains unaddressed — same copy-paste anti-pattern repeats for `routerEnabled`/`sonaEnabled`/`gnnEnabled`. Worth filing as a known follow-up.
