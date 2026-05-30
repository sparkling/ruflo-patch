---
status: superseded
date: 2026-05-19
tags: [crdt, quic, federation, dead-code]
supersedes: []
depends-on: [ADR-0199, ADR-0201]
implements: []
---

# Wire CRDT primitives + QUIC transport into production sync (or remove)

> **Superseded by [ADR-0217](./ADR-0217-implement-full-quic-synchronization-architecture.md).**
> This ADR framed the CRDT primitives + QUIC pool/stream-manager as a
> "wire or remove" choice and chose a split (keep CRDT, delete the QUIC sim
> classes).
>
> **Supersession rationale corrected (2026-05-20 second-pass swarm):** the
> original banner cited ADR-0217's *build-the-architecture* option — it said
> "ADR-0217 is the production caller (closes F-06-002)" and that the pool/
> stream-manager would be "rebuilt … in Phase 5 only if benchmarks demand it."
> ADR-0217 was reframed to **QUARANTINE** the dormant federation stack (no
> driver), so both clauses are stale: **0217 is NOT a production caller of the
> CRDT primitives** — it *retracts* them from the public surface / marks them
> `@internal` and closes F-06-002 *by honesty, not by use or deletion*; and
> there is **no Phase 5** (the phased build is a preserved-but-not-built
> blueprint). The supersession holds, with the split's two halves resolved by
> quarantine: **(1) the "remove" half is VINDICATED** — 0217 action 3 deletes
> `QUICConnectionPool` + `QUICStreamManager` + tests and adds an arch-test
> forbidding re-import (closes F-06-003, "no driver justifies them"); **(2)
> the "keep CRDT" half becomes "keep but mark internal/unwired"** (0217 action
> 1) — the primitives stay in `types/quic.ts` for a possible future product
> bet but are removed from the advertised API. Retained for reference; **act
> via ADR-0217 (quarantine), not via this ADR's wire-or-rebuild framing.**

## Context and Problem Statement

The 2026-05-19 soundness audit (ADR-0201, slice 06) found two
separate-but-coupled gaps in `forks/agentdb/src/controllers/`:

* **CRDT primitives are declared but unwired.** `src/types/quic.ts`
  declares G-Counter (`GCounter`), LWW-Register (`LWWRegister<T>`),
  and OR-Set (`ORSet<T>`) types plus their merge operations
  (`mergeGCounter`, `mergeLWWRegister`, `mergeORSet`,
  `incrementGCounter`, `updateLWWRegister`, `addToORSet`,
  `removeFromORSet`). Audit grep for callers returns only the
  defining file:

  ```bash
  $ grep -rn "mergeGCounter\|mergeLWWRegister\|mergeORSet" src/ \
      | grep -v types/quic.ts
  # (empty)
  ```

  The `SyncCoordinator` push/pull/apply path serialises raw
  episode/skill/edge rows via `SELECT * FROM ...` and applies
  them via `INSERT OR REPLACE` — it never converts to the
  `SkillSync` / `CausalEdgeSync` / `EpisodeSync` envelopes that
  the CRDT types are designed to carry. The federation wire
  format advertises CRDT semantics, the runtime does not have
  CRDT merge (F-06-002).

* **`QUICConnectionPool` + `QUICStreamManager` are unwired and
  operate over the simulation half of `QUICConnection`.** Both
  files carry the same header banner:

  ```ts
  // TODO: ADR required before activation — ADR-0161 lift,
  //       no production wiring
  ```

  `grep -rn "new QUICConnectionPool\|new QUICStreamManager"
  forks/agentdb` returns zero hits anywhere in `src/`, `tests/`,
  or `examples/`. Their internal `connection: QUICConnection` is
  the simulation class (the BBR / 0-RTT / migration metadata
  layer at `QUICConnection.ts:415-711`), not the `Transport`
  abstraction that ADR-0199 selected. The real federation path
  goes through `createClientTransport()` / `createServerTransport()`
  (lines 400-413), used directly by `QUICClient.connect()` /
  `QUICServer.start()` without any pool or stream-manager
  intermediation (F-06-003).

The audit's "TODO: ADR required" header is the prompt. ADR-0199
chose the transport binding (`@fails-components/webtransport` +
`node:http2` fallback) and supplanted the architectural slot the
pool/stream-manager would have occupied. ADR-0205 (proposed,
F-06-001) addresses the broken `resolveConflicts` stub by
implementing actual merge — making CRDT-merge wiring the natural
home for the primitives that already exist on the type side.

The decision space is symmetric — wire or remove — but the
right answer per piece is asymmetric.

## Decision Drivers

* **Doc drift is a soundness hazard.** Type-level CRDT shapes
  advertise convergence guarantees the runtime does not provide.
  Either honour the advertisement or retract it.
* **Code-without-callers grows defects silently.** The pool /
  stream-manager files have unit tests, type-check clean, and
  appear via export hygiene to be part of the public surface —
  but exercise no production path. Maintenance cost is real,
  signal is zero.
* **Architectural fit with ADR-0199.** ADR-0199 selected a
  `Transport` abstraction inside `QUICConnection.ts`; the
  pool/stream-manager files reach into the `QUICConnection`
  simulation class (`BBR/0-RTT/migration` metadata layer) and
  thus cannot be wired to the real transport without rewriting
  them against the `Transport` interface. Wiring is not
  "uncomment two lines"; it is a re-architecture.
* **Coupling with ADR-0205.** F-06-001's stub `resolveConflicts`
  is the natural caller for the CRDT merge functions in
  `types/quic.ts`. If ADR-0205 implements merge using the
  existing primitives, CRDT is wired *by* implementing
  resolution. Removing CRDT primitives ahead of ADR-0205 means
  ADR-0205 must reimplement them — wasted work.
* **No-fallbacks discipline.** Per [[feedback-no-fallbacks]],
  shipping types that "look like" CRDT but reduce at runtime
  to `INSERT OR REPLACE` is a silent-fallback pattern at the
  data-integrity boundary. The fix is either runtime parity or
  removal.
* **Asymmetric cost.** CRDT primitives are 600 LoC of pure
  functions with full tests already present in
  `tests/unit/quic-crdt.test.ts` (the audit notes the
  definitions ship with their own behaviour tests). The QUIC
  pool + stream-manager are 721 LoC combined and depend on the
  simulation `QUICConnection` — restructuring them is a
  multi-day refactor.
* **Production surface area honesty.** Per ADR-0201's framing,
  every surface in the agentdb public export should either be
  reachable from a documented production path or labelled
  experimental. Limbo (commented "TODO: ADR required" with no
  ADR ever filed) is the worst state.

## Considered Options

* **Option A — Wire everything into production sync.** Wire
  CRDTs into `SyncCoordinator` (per ADR-0205), wire
  `QUICConnectionPool` + `QUICStreamManager` to the
  `Transport` abstraction from ADR-0199.
* **Option B — Remove all four pieces.** Delete CRDT primitives
  from `types/quic.ts`, delete `QUICConnectionPool.ts` +
  `QUICStreamManager.ts`, remove their tests and exports.
* **Option C — Move all four to `experimental/`.** Same code,
  new directory, opt-in via env-var flag; off the production
  surface but available for users who want to experiment.
* **Option D — Split: keep CRDT primitives (cheap, wired by
  ADR-0205); remove QUIC simulation classes (expensive,
  supplanted by ADR-0199).** Asymmetric disposition per the
  asymmetric cost of each piece.

## Decision Outcome

**Chosen: Option D — split disposition.**

* **CRDT primitives stay** in `types/quic.ts`. ADR-0205's merge
  implementation in `resolveConflicts` becomes the production
  caller for `mergeGCounter` / `mergeLWWRegister` / `mergeORSet`
  and for the helper constructors / mutators
  (`incrementGCounter`, `updateLWWRegister`,
  `addToORSet`, `removeFromORSet`). The audit's F-06-002 finding
  resolves as part of ADR-0205's implementation log, not as a
  separate ADR.

* **`QUICConnectionPool` + `QUICStreamManager` are removed.**
  Delete both files. Remove their tests
  (`tests/unit/quic-connection-pool.test.ts`,
  `tests/unit/quic-stream-manager.test.ts`). Remove the
  simulation-side `QUICConnection.send()` / `QUICConnection.connect()`
  paths *only if* no other caller remains; otherwise leave the
  simulation class as a metrics layer per ADR-0199's
  "BBR/0-RTT/migration metadata on top of real transport"
  posture. Remove the `// TODO: ADR required before activation`
  comments from anywhere they survive.

Rationale:

* **Option A** (wire everything) is unjustified for the QUIC
  side: ADR-0199 already wired the real transport via a
  *different* abstraction (the `Transport` interface in
  `QUICConnection.ts`). Wiring pool + stream-manager would
  require either retargeting them onto `Transport` (a rewrite,
  not a wire-up) or restoring the simulation class as the
  primary transport (regression against ADR-0199). Neither
  improves federation.

* **Option B** (remove everything) wastes the CRDT primitives,
  which are correct, well-tested pure functions with no
  maintenance burden and which ADR-0205 wants. Removing them
  forces ADR-0205 to reimplement.

* **Option C** (move to `experimental/`) preserves the limbo
  state in a less visible directory. Limbo is the failure mode
  to escape; renaming the directory doesn't change the
  documentation drift, the unused-code hazard, or the
  uncertainty about whether to maintain.

* **Option D** matches the asymmetric cost: keep the cheap-and-
  wanted, drop the expensive-and-supplanted. CRDT wiring
  becomes ADR-0205's concern; QUIC pool/stream-manager become
  this ADR's deletion concern. Each piece moves out of limbo
  by the path that fits it.

### Interaction with ADR-0205

ADR-0205 is the production caller for the CRDT merge functions
that this ADR keeps. The two ADRs are intentionally cross-coupled:

* This ADR commits to *not* removing the CRDT primitives, so
  ADR-0205 can rely on them.
* ADR-0205 commits to actually calling them, so this ADR's
  "keep" disposition stays justified (a "keep" with no future
  caller would devolve to limbo again).

If ADR-0205 is rejected or chooses a different merge strategy
that bypasses the existing primitives, this ADR's "keep" half
must be revisited and likely flipped to "remove."

### Consequences

* Good, because the CRDT primitives gain a production caller
  via ADR-0205 — the federation wire format's CRDT semantics
  become honoured at the runtime layer (F-06-002 resolved).
* Good, because the `// TODO: ADR required before activation`
  banner disappears from the agentdb tree — limbo eliminated
  per ADR-0201's framing.
* Good, because the agentdb tree loses 721 LoC of unwired
  code plus its two unit tests, reducing surface area and
  maintenance burden.
* Good, because ADR-0199's `Transport` abstraction remains the
  single federation transport story — no competing pool /
  stream-manager surface to confuse readers.
* Bad, because deleting `QUICConnectionPool` discards a
  reasonable design for connection reuse at scale. A future
  ADR may need to reintroduce pooling against the `Transport`
  interface from ADR-0199 — this ADR does not preclude that,
  but the new pool would be a fresh implementation, not a
  resurrection of the deleted file.
* Bad, because `QUICStreamManager`'s multi-priority stream
  scheduling logic disappears with the file. WebTransport
  already exposes multi-stream semantics natively (per
  ADR-0199's binding choice), so the loss is small — but if a
  future federation profile needs explicit priority scheduling,
  that logic must be rebuilt.
* Bad, because removing the unit tests for the deleted files
  reduces aggregate coverage numbers — paper loss only, since
  the removed tests covered code that was never called in
  production.
* Neutral, because the simulation half of `QUICConnection`
  (BBR / 0-RTT / migration metadata) remains in place per
  ADR-0199's "metadata layer on top of real transport" posture.
  Removing the pool / stream-manager does not require removing
  the simulation half.
* Neutral, because `QUICServer` / `QUICClient` exported
  signatures are unchanged — no downstream caller (agentic-flow
  adapter side or otherwise) is affected by the removal.
* Neutral, because the cross-corpus federation contract
  (`agentic-flow/coordination/federated-sync-provider.ts`)
  references `pushOnly` / `pullOnly` per ADR-0200, not the
  pool / stream-manager — adapter callers unaffected.

### Confirmation

* **Arch-test forbids imports from the deleted modules.** Add
  an arch-test (in `forks/agentdb/tests/integration/` —
  alongside `quic-transport.test.ts`) that asserts no file
  under `src/` imports `./QUICConnectionPool` or
  `./QUICStreamManager`. The test uses a simple recursive grep
  via `node:fs.glob`:

  ```ts
  // forks/agentdb/tests/integration/no-deleted-quic-imports.test.ts
  it('does not import QUICConnectionPool or QUICStreamManager', async () => {
    const offenders: string[] = [];
    for await (const entry of fs.glob('src/**/*.ts', { cwd: pkgRoot })) {
      const text = await fs.readFile(path.join(pkgRoot, entry), 'utf8');
      if (/from\s+['"]\.\.?\/.*QUICConnectionPool['"]/.test(text) ||
          /from\s+['"]\.\.?\/.*QUICStreamManager['"]/.test(text)) {
        offenders.push(entry);
      }
    }
    expect(offenders).toEqual([]);
  });
  ```

  Per [[feedback-no-fallbacks]] the test fails loudly when
  either string reappears.

* **Arch-test forbids exports from the deleted modules.**
  `src/controllers/index.ts` and `src/index.ts` must not
  re-export `QUICConnectionPool` or `QUICStreamManager`. Same
  arch-test extends to those barrel files.

* **CRDT primitives must be imported by `SyncCoordinator`
  after ADR-0205 lands.** Add a positive arch-test:
  `SyncCoordinator.ts` must reference at least one of
  `mergeGCounter` / `mergeLWWRegister` / `mergeORSet`. This
  test starts as an `it.skip` (pending ADR-0205) and flips to
  `it` when ADR-0205's implementation lands. Once green it
  locks the wiring against future regression.

* **Audit re-run.** ADR-0201's slice 06 audit re-runs the
  grep query
  `grep -rn "mergeGCounter\|mergeLWWRegister\|mergeORSet" src/`
  and asserts non-empty output excluding `types/quic.ts`. Same
  audit asserts
  `find src -name 'QUICConnectionPool.ts' -o -name 'QUICStreamManager.ts'`
  is empty. F-06-002 + F-06-003 close on those two assertions.

* **Public-surface integrity.** `forks/agentdb` test
  `tests/integration/public-exports-stable.test.ts` (or
  equivalent — add if missing) snapshots the agentdb public
  export surface and asserts the deletion does not silently
  break any documented consumer. The snapshot diff must show
  exactly the two removed class names; no other surface
  changes.

* **No fallback to deleted modules in agentic-flow.**
  `forks/agentic-flow` grep
  `grep -rn "QUICConnectionPool\|QUICStreamManager" forks/agentic-flow/agentic-flow/src`
  must return zero hits before merge; cross-fork removability
  precondition.

## Pros and Cons of the Options

### Option A — Wire everything into production sync

* Good, because every declared surface gains a caller —
  documentation drift resolved on both pieces.
* Good, because `QUICConnectionPool`'s connection-reuse logic
  could in principle reduce TLS handshake cost at scale.
* Bad, because the pool + stream-manager target the simulation
  `QUICConnection`, not the `Transport` from ADR-0199.
  "Wiring" is a euphemism for "rewrite against a different
  abstraction" — multi-day work for a federation surface that
  has no demonstrated bottleneck.
* Bad, because two transport surfaces (pool + `Transport`) would
  coexist in `QUICConnection.ts`, creating exactly the
  "which one is real?" confusion that F-06-003 calls out.
* Bad, because WebTransport (ADR-0199's binding) exposes
  multi-stream semantics natively — `QUICStreamManager`'s
  priority scheduling duplicates capability the transport
  already provides.

### Option B — Remove all four pieces

* Good, because the agentdb tree loses both unwired surfaces
  and the federation wire-type CRDT shapes whose runtime
  doesn't honour them — internal honesty restored.
* Good, because removal is fast: delete files, update
  exports, drop tests.
* Bad, because ADR-0205's merge implementation needs CRDT
  primitives — removing forces ADR-0205 to reimplement (or
  pick a different strategy that ignores CRDT entirely).
* Bad, because the `SkillSync` / `CausalEdgeSync` /
  `EpisodeSync` envelope types are correct and well-designed;
  losing them along with the merge functions wastes good
  type-design work.

### Option C — Move all four to `experimental/`

* Good, because preserves the code for opt-in users without
  claiming production status.
* Good, because the `// TODO: ADR required` banner can be
  removed (the experimental directory is itself the answer).
* Bad, because moving doesn't resolve doc drift — readers still
  see CRDT types in the public surface (or get told to import
  from `experimental/`, which is worse signal).
* Bad, because the QUIC pool / stream-manager still target the
  simulation `QUICConnection`; the move doesn't fix the
  architectural mismatch with ADR-0199's `Transport`. Opt-in
  via flag would activate broken wiring.
* Bad, because experimental directories accrete dead weight —
  ADR-0201's framing wants surfaces *out of* limbo, not
  relocated within it.

### Option D — Split

* Good, because matches the asymmetric cost of the two pieces
  (CRDT cheap to keep, QUIC sim expensive to maintain).
* Good, because pairs naturally with ADR-0205 — that ADR
  becomes the production caller for the preserved CRDT side,
  and this ADR's removal disposition lands independently.
* Good, because the `Transport` story from ADR-0199 stays the
  single federation transport surface.
* Bad, because two ADRs (this one + ADR-0205) must land
  together to close F-06-002 — the partial state where this
  one lands first leaves CRDT primitives looking even more
  unwired (they had types-only callers; now they have nothing
  pending ADR-0205).
* Bad, because the deletion is irreversible in the sense that
  resurrecting `QUICConnectionPool` after the fact requires
  rewriting it against `Transport` anyway — but that cost
  exists in Option A too, so no marginal loss.

## More Information

* **ADR-0199** (`docs/adr/ADR-0199-quic-transport-binding-selection.md`)
  — Selected `@fails-components/webtransport` with `node:http2`
  fallback; introduced the `Transport` abstraction in
  `QUICConnection.ts` that supplants the simulation-class role
  the pool / stream-manager would have played.
* **ADR-0200** (`docs/adr/ADR-0200-synccoordinator-push-only-pull-only-public-surface.md`)
  — Public `pushOnly()` / `pullOnly()` methods; their internal
  `applyChanges` call is the production caller site that
  ADR-0205 will route CRDT merge through. This ADR's
  disposition is consistent with ADR-0200's invariant that
  direction-only methods must not silently call the other
  direction's path.
* **ADR-0201** (`docs/adr/ADR-0201-codebase-soundness-completeness-audit-with-runtime-validation.md`)
  — Parent audit. Slice 06 produced findings F-06-002
  (unwired CRDT) and F-06-003 (unwired QUIC pool /
  stream-manager) that this ADR resolves.
* **ADR-0205** (proposed, separate document) — Implements
  actual conflict resolution in `SyncCoordinator.resolveConflicts`
  to close F-06-001. This ADR's "keep CRDT" half presumes
  ADR-0205 lands and uses the preserved primitives.
* **Cross-references**:
  * `forks/agentdb/src/types/quic.ts:101-188, 566-702` — CRDT
    type + merge-function definitions preserved by this ADR.
  * `forks/agentdb/src/controllers/QUICConnectionPool.ts` —
    deleted by this ADR.
  * `forks/agentdb/src/controllers/QUICStreamManager.ts` —
    deleted by this ADR.
  * `forks/agentdb/src/controllers/QUICConnection.ts:400-413`
    — `createServerTransport()` / `createClientTransport()`
    factories preserved (ADR-0199's surface, unrelated to
    this ADR's removal scope).
  * `forks/agentdb/src/controllers/QUICConnection.ts:415-711`
    — simulation half (BBR / 0-RTT / migration metadata)
    preserved per ADR-0199's "metadata layer on top of real
    transport" posture; this ADR does not touch it.
  * `forks/agentdb/src/controllers/SyncCoordinator.ts:679-705`
    — broken `resolveConflicts` stub, ADR-0205's territory.
  * `forks/agentdb/src/controllers/index.ts` + `src/index.ts`
    — export barrel files; remove `QUICConnectionPool` /
    `QUICStreamManager` re-exports.
* **Out of scope**:
  * Whether to rebuild a `QUICConnectionPool` against the
    ADR-0199 `Transport` abstraction in a future ADR — left
    open; no current evidence of a federation throughput
    bottleneck demanding pooling.
  * Whether the simulation half of `QUICConnection`
    (`QUICConnection.send()`, `QUICConnection.connect()`)
    should be removed once the pool / stream-manager are
    gone. The audit lists it as a "split-purpose" file
    (F-06 reference soundness table); leave for a separate
    ADR if its remaining callers prove to be the
    pool / stream-manager only.
  * The agentic-flow-side silent-catch on
    `graphAdapter.initialize()` (F-06-006) — separate ADR
    territory.

## Amendment — 2026-05-23 (Move A audit, supersession reconciliation)

Superseder ADR-0217 reached terminal status **`deferred`** on 2026-05-23 (Option C — quarantine + honesty; multi-writer build deferred to a future evidenced product-bet ADR). This ADR's `status: superseded by ADR-0217` is unchanged: deferred IS a valid terminal disposition for a superseder. The practical meaning is "the CRDT-merge-fn wire-or-remove choice posed here resolves toward 'remove' for the production pool/stream-manager (carried into 0217's quarantine actions) and 'quarantine' for the CRDT primitives — we are not wiring nor immediately removing the vector-clock family because the agentic-flow consumer at `autopilot-learning.ts:42-43,1083` still imports it."

Quarantine actions (export retraction, CLI guard, dead-stub deletion, `QUICConnectionPool`/`QUICStreamManager` deletion + arch-test, honest docs) are a follow-on slice owned by ADR-0217; this ADR carries no new code work.
