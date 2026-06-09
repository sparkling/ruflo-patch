---
status: proposed
date: 2026-06-08
tags: [federation, memory-sharing, quic, inbound-dispatcher, phase-2, team-memory]
supersedes: []
depends-on: [ADR-0265]
implements: []
---

# Federation Phase-2: wire the inbound dispatcher so `federation_query` actually serves a remote memory read

## Context and Problem Statement

The 2026-06-08 multi-agent investigation (ADR-0293 posture — *prove* a capability
works before declaring it absent) hard-probed the recurring "does Ruflo give a
shared team brain?" question. **The negative answer held, but via an
absence-trace, and the supporting facts were wrong in both directions** (some
under-credited shipped code). The user-facing README §4/§10 was corrected
2026-06-08; this ADR captures the one genuine *framework* gap behind the
"no live shared brain" finding.

**What actually ships (verified, previously under-credited):**

* `ruflo-federation` (`@claude-flow/plugin-agent-federation@1.0.0-alpha.5-patch.197`
  — note: NOT the `alpha.16` the README had) is real DDD code: ed25519 identity,
  trust-evaluator, policy-engine, PII pipeline, audit log, circuit-breaker, 325
  tests. It **defines a memory-shaped envelope**: `federation_query` =
  *"Query federated memory from a remote peer (PII-gated)"* (`mcp-tools.ts:148`),
  with `messageType: 'memory-query' | 'context-share'`.
* The QUIC transport it would ride on **also ships** ([[ADR-0265]],
  `@sparkleideas/agentic-flow-quic-native` — real quinn N-API binaries), opt-in
  via `AGENTIC_FLOW_QUIC_NATIVE=1`.

**The gap (the genuine fix):** Phase 1 is **send-only**.
`federation-coordinator.ts:38` states *"Phase 1 … no inbound dispatcher"*; the
live probe is unambiguous:

```
$ ruflo-federation status
[warn] Federation transport does not expose onMessage(); inbound bytes will queue but not dispatch.
Active Sessions: 0 | Known Peers: 0 | Healthy: false
```

`sendMessage()` validates + dispatches *outbound*; nothing on the receiving node
consumes an inbound `memory-query` and answers it from the local store. So the
`federation_query` envelope exists end-to-*almost*-end. **(CORRECTED 2026-06-09 —
the "no peer serves the read / no live shared team brain" framing below was WRONG:
the transport is bidirectional (proven by a live `memory-query → memory-response`
round-trip) and the inbound dispatcher exists + is tested in source; it is merely
absent from the published build. See the Addendum.)** This
is implement-ahead (a real, well-built, honestly-Phase-1-marked surface), NOT
shelfware and NOT a lie.

## Decision Drivers

* The hard part is built (transport ships, envelope + trust/PII/audit/breaker
  exist); the missing piece is the inbound dispatch loop — a bounded Phase-2.
* Honesty: the corpus already marks this "Phase 1, no inbound dispatcher" — this
  ADR turns that latent marker into a scheduled, testable Phase-2 decision.
* A working (still gated, per-query, pull-based) cross-node memory read is the
  smallest real step toward team memory without the full QUIC+CRDT multi-writer
  store (which remains genuinely future work — see [[ADR-0121]]/[[ADR-0265]]).

## Considered Options

* **Wire the inbound dispatcher for `memory-query` only, gated (chosen as the
  proposal).** Implement `onMessage()` → route a verified, PII-gated `memory-query`
  to the local memory store, return a gated result. Pull-based, per-query, no
  replication. Keeps the trust/audit/breaker guarantees.
* **Build the full multi-writer shared store now (QUIC + CRDT replication)** —
  rejected as the next step: large, and `memory-query` pull covers the
  immediate "ask a teammate's node" use case without replication-conflict design.
* **Leave send-only, doc-only** — the README is now honest, but the framework
  keeps an envelope nothing answers; capturing the Phase-2 step is cheap and
  removes the dead-end.

## Decision Outcome

Chosen: record the gap + propose the gated inbound `memory-query` dispatcher as
federation Phase-2. Status `proposed`; no execution until an explicit go-ahead.

### Tasks

* **T1 — Inbound dispatcher.** Implement `onMessage()` on the federation transport
  so a received, signature-verified, trust-tier-and-PII-gated `memory-query` is
  routed to the local memory store and answered with a gated `context-share`
  response. Keep it opt-in (behind the federation enablement + `AGENTIC_FLOW_QUIC_NATIVE`).
* **T2 — Acceptance:** a two-node round-trip — node A `federation_query` → node B
  serves from its local store → A receives the gated result; plus a negative test
  that an untrusted/PII-violating query is refused and audited.
* **T3 — Keep the honesty marker accurate:** update `federation-coordinator.ts`'s
  "Phase 1, no inbound dispatcher" comment + status output when (and only when) T1
  lands; until then the README/USERGUIDE stay "send-only."

### Consequences

* Good, because the `federation_query` envelope stops being a dead-end and the
  fork gains a real (gated, pull-based) cross-node memory read.
* Good, because it's the minimal honest step toward team memory, preserving the
  zero-trust guarantees already built.
* Neutral, because git-as-memory-bus (the recommended team-memory path) is
  unaffected and remains the default.
* Bad (mitigated), because inbound network handling is security-sensitive; the
  existing ed25519 + trust + PII + audit + breaker stack must gate every served
  query, and T2's negative test enforces it. Real-time multi-writer replication
  (QUIC + CRDT shared store) remains out of scope / future.

### Confirmation

The T2 two-node round-trip green (trusted query served, untrusted refused +
audited), and the Phase-1 marker updated to reflect the wired dispatcher. Until
T1 ships, "no live shared team brain" remains the accurate, evidence-backed
verdict.

## More Information

* [[ADR-0265]] — fork-native QUIC federation transport (ships, opt-in) — the
  carrier this dispatcher rides. [[ADR-0121]] — hive-mind CRDT consensus (real
  merge primitives, single-host vote convergence — NOT a networked memory store).
  Method: [[ADR-0293]] (prove absence, don't assume it).
* Evidence (2026-06-08 swarm): envelope `mcp-tools.ts:148` (`federation_query`,
  `memory-query`/`context-share`); Phase-1 marker `federation-coordinator.ts:38`;
  live `onMessage()`-absent warn + `Healthy:false`. Installed:
  `@claude-flow/plugin-agent-federation@1.0.0-alpha.5-patch.197`.
* User-facing counterpart corrected 2026-06-08:
  `~/source/hm/semantic-docs/docs/agentic-engineering/README.md` §4/§10 —
  federation described as send-only (no inbound dispatcher), version fixed, and
  the IPFS claim moved off `intelligence-transfer` (local-disk per [[ADR-0293]])
  onto the separate `transfer_store-*` marketplace.

## Addendum (2026-06-09): the dispatcher is built in source; the transport is bidirectional (proven)

A follow-up 4-agent validation — user-driven, because the user disbelieved the
negatives (rightly: this was the THIRD wrong-negative this session after the
MultiModelRouter "mock" and the cost-optimizer "TODO", [[ADR-0306]]) — corrected
the framing above with live evidence:

* **The transport is bidirectional, proven live.** Two nodes on the shipped
  transport (agentic-flow WebSocket-fallback + native QUIC) completed a
  `memory-query → memory-response` round-trip. The "send-only / `Healthy:false` /
  `onMessage()` absent" probe was a MISREAD — it ran a bare `npx` node with the
  optional transport dep ABSENT (in-process mode), and `Healthy:false` was merely
  pre-`init` state, not a missing receiver.
* **The inbound dispatcher is already built + tested in source** —
  `inbound-dispatcher.ts` (`dispatchInbound()`: ed25519-verify → audit → emit
  `federation:inbound:memory-query`), wired via `transport.onMessage(...)` in
  `plugin.ts`, with `inbound-dispatcher.test.ts` (upstream ADR-109). It is simply
  **NOT in the currently-published `@claude-flow/plugin-agent-federation@latest`
  build**, which binds `transport.listen()` without calling `onMessage(dispatchInbound)`.
* A separate shipped impl, `FederationHubServer.handlePull`, genuinely serves reads
  (tenant-isolated, vector-clock) — but is DOA-as-shipped; see [[ADR-0310]].

**Revised tasks (supersede T1's "implement the dispatcher"):**
* **T1′ — Publish the existing dispatcher.** Cut a release of the federation plugin
  that includes `inbound-dispatcher.ts` wired to `transport.onMessage`. This is a
  build/packaging fix, not a from-scratch implementation.
* **T2′ — Add the built-in memory responder (the genuine remaining gap).** The
  dispatcher emits `federation:inbound:memory-query` "for the integrator"; no
  built-in subscriber answers it from the local memory store. Wire a gated
  (trust/PII) responder so `federation_query` round-trips memory by default.
* T3 (honesty marker) inverts: the *published build's* send-only state is the
  artifact-level truth; the design + source are bidirectional.

Accurate statement: NOT "send-only / no dispatcher" (that's the design) but "the
published build omits the existing, tested dispatcher, and no built-in responder
answers a memory-query from local memory." Evidence: `/tmp/ruflo-q4-validate/federation.md`.
README §4/§10 corrected again 2026-06-09 to credit the bidirectional transport.
