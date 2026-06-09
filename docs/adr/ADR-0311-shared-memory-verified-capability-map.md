---
status: accepted
date: 2026-06-09
tags: [memory-sharing, team-memory, capability-map, hive-mind, daa, federation, honesty, verified]
supersedes: []
depends-on: []
implements: []
---

# Verified capability map: shared / collective memory (Q4/Q10) — the negatives were wrong

## Context and Problem Statement

The recurring "does Ruflo give a shared team brain?" question (user-facing README
§4/§10) was answered, across this session, with a run of NEGATIVES that kept turning
out WRONG when the SHIPPED artifact was actually examined or run — the THIRD such
wrong-negative in one session (after the MultiModelRouter "mock" and the cost-optimizer
"TODO"; see [[ADR-0306]]). A user-driven 4-agent validation (2026-06-09), bound to
"assume the capability exists, hunt across ALL packages, and TRY TO MAKE IT WORK,"
settled it with live evidence. This ADR records the verified map so the question stops
being re-litigated from the skeptical prior.

## Verified facts (live evidence)

**Collective memory across agents — LIVE today, on one machine:**
* **hive-mind** — shared collective memory: 8 typed entry classes
  (knowledge/context/task/result/error/metric/consensus/system) with per-type TTL,
  persisted to `.claude-flow/hive-mind/state.json`, lock-serialized across concurrent
  agents (ADR-0122). *Proven:* one agent's write read back by a separate process; the
  store already held real consensus votes + multi-agent council results from prior swarms.
* **daa** — `daa_knowledge_share` transfers knowledge between named agents
  (source/targets/domain/content), persisted under an exclusive lock, surviving across
  processes (proven live).
* **knowledge-graph** — a persistent, queryable entity/relation graph in AgentDB's
  `kg-graph` namespace, recallable by any later session/agent.

**Cross-machine sharing — building blocks ship and FUNCTION, but none is turnkey:**
* **federation transport is bidirectional** — a `memory-query → memory-response`
  round-trip was proven between two nodes (WS-fallback + native QUIC). The earlier
  "send-only / `Healthy:false`" was a misread probe. The inbound dispatcher exists +
  is tested in source but is absent from the published build, and no built-in responder
  answers a memory-query from local memory ([[ADR-0309]]).
* **`FederationHubServer`** — a real multi-tenant WebSocket memory-sync hub (vector-clock
  push/pull, tenant isolation), proven syncing across processes, but DOA-as-shipped
  (init race + missing CLI entry) ([[ADR-0310]]).
* **IPFS distribution is real** — anonymized *pattern* bundles (`ruflo-intelligence`) and
  whole `.rvf` appliances (`ruflo appliance publish`) publish to IPFS (own node /
  web3.storage / Pinata), fetch + verify by CID; credential-gated; the curated public
  catalog currently ships a single sample.

**Genuine true-negatives (survived a hard refutation):** `ruvector server` unimplemented
("Server package not yet available"); `ruvector cluster` "Coming Soon"; `ruvector brain`
= a client for a hosted service (`pi.ruv.io`); AgentDB multi-writer QUIC sync
experimental/quarantined (ADR-0217, off by default); `ruflo-rag-memory` + the
`intelligence-transfer` skill are genuinely local.

## Decision Outcome

Record this as the verified capability map. Corrected verdict: **a real collective brain
across agents on one machine exists today (hive-mind + DAA); cross-machine/team sharing is
"shipped building blocks, not yet turnkey," NOT "absent."** The user-facing README §4/§10
was rewritten 2026-06-09 to this, dropping "alpha"/maturity-denigration and keeping only
evidenced limits. Actionable fixes: [[ADR-0309]] (publish the dispatcher + add the
responder) and [[ADR-0310]] (fix the hub's shipping bugs).

### Consequences
* Good: the corpus records the verified truth, not the skeptical prior; future
  "is the shared brain real?" questions start from evidence.
* Good: two bounded fixes ([[ADR-0309]], [[ADR-0310]]) would make cross-machine sharing turnkey.

### Confirmation
Evidence files: `/tmp/ruflo-q4-validate/{federation,shared-store,transfer,plugins}.md`;
README §4/§10 (semantic-docs) reflects this map.

## More Information
* Meta-lesson (third instance): a "mock / stub / not-wired / no-shared-store" verdict must
  be validated against the SHIPPED artifact + a live run, and must enumerate ALL packages
  (the real capability repeatedly lived in `agentic-flow`, not the obvious class). See
  `feedback-capability-not-single-named-class`, `feedback-no-consumer-is-not-stub`,
  [[ADR-0293]], [[ADR-0306]].
