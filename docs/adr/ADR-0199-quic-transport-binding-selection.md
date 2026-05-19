---
status: implemented
date: 2026-05-19
tags: [quic, transport, federation, phase5, ADR-0196]
supersedes: []
depends-on: [ADR-0196]
implements: []
---

# QUIC transport binding selection

## Context and Problem Statement

ADR-0196 §"Transport binding selection" deferred picking the actual
QUIC binding for the federation runtime. The autopilot-side adapter
(`SyncCoordinatorFederatedAdapter`) and the agentdb-side abstraction
(`SyncCoordinator` + `QUICServer` + `QUICClient`) all assume *some*
transport sits underneath, but `QUICServer.start()` /
`QUICClient.connect()` / `QUICConnection.connect()` are reference
stubs with in-source disclaimers (see ADR-0197 Finding 3 — "no socket
bind", "no production wiring"). Until a real binding ships, every
`requestSync()` call returns silently and Phase 5 cannot be tested
beyond the single-host two-SQLite case ADR-0196 already covers.

agentdb's `QUICServer.ts:111-112` already names two candidates in a
comment: `@fails-components/webtransport` and `node-quic`. Node 23
added `node:quic` as a built-in (still experimental). A fall-back
question is also live: if the QUIC library fails to install on a
given host (native build issue, postinstall failure) or fails to
runtime-detect a usable transport, what does federation degrade to?

This ADR picks the binding and the fallback, and scopes the
implementation in `QUICConnection.ts` so `QUICServer.ts` /
`QUICClient.ts` interfaces stay stable.

## Decision Drivers

* **Future-proof on standards** — WHATWG WebTransport is the
  long-term standard browsers expose; aligning the Node binding
  with the same API shape lets us share serialization / framing
  code with a future browser federation peer without rewrite.
* **Cross-Node-version** — agentdb's `package.json` declares
  `engines.node: ">=18.0.0"`. `node:quic` requires Node 23+ and
  is `--experimental-quic` gated; we cannot drop Node 18-22 users
  to pick it.
* **Real QUIC underneath** — HTTP/2 over TLS is not QUIC; it
  carries different latency / migration / 0-RTT properties.
  `QUICConnection`'s BBR + 0-RTT + migration code only makes sense
  if a real QUIC stack sits below it. HTTP/2 fallback is
  *fallback*, not the primary.
* **Operational sanity** — TLS cert provisioning, port binding
  (UDP 4433 default), and binary install cost are all real costs
  on the user's M5 Max single-host environment. The fallback must
  keep federation usable when a binary postinstall fails.
* **No multi-host rig** — selection must be testable on a single
  host (loopback + self-signed cert). ADR-0196's two-SQLite test
  already exercises the adapter layer; this ADR must exercise the
  *transport* layer the same way.

## Considered Options

* **`node:quic` (Node 23+ built-in)** — first-party,
  zero-postinstall, but gated on Node 23 with `--experimental-quic`.
  Drops every user below Node 23.
* **`@fails-components/webtransport`** — WHATWG WebTransport API
  on Node 18+ via native binding to `libquiche` / `libngtcp2`.
  WHATWG-aligned (browser-compatible API surface), real QUIC
  underneath. Native postinstall is the operational risk.
* **HTTP/2 fallback via `node:http2`** — built-in to Node, no
  install cost, TLS via standard certs. Not QUIC — no 0-RTT, no
  migration, no UDP, head-of-line blocking on multiplexed streams
  at the TCP layer. Fine as graceful degradation.
* **gRPC (`@grpc/grpc-js`)** — production-grade, but framing /
  protobuf semantics don't compose with agentdb's existing
  JSON `SyncPayload` envelopes. Re-tooling the wire format is
  out of scope.
* **libp2p** — peer-mesh / discovery layer; solves a different
  problem (peer discovery, NAT traversal) than the
  single-transport-binding choice. Future-orthogonal — could sit
  *above* the binding picked here, not as a replacement.

## Decision Outcome

Chosen option: **`@fails-components/webtransport` with HTTP/2
fallback via `node:http2`**, because the WHATWG-aligned API
surface aligns with the long-term browser federation story, it
supports Node 18+ (agentdb's declared floor), and the `node:http2`
fallback covers the install-failure / runtime-detect-failure case
without requiring a second binary dep. `node:quic` is rejected
*for now* on Node-version grounds; revisit when Node 22 is EOL.

The binding selection lives entirely in
`forks/agentdb/src/controllers/QUICConnection.ts`. `QUICServer.ts`
and `QUICClient.ts` keep their existing constructor / method
signatures — they delegate the socket-bind / connect work to a
new `Transport` abstraction inside `QUICConnection.ts`.

### Consequences

* Good, because the WebTransport surface is the same shape we'd
  use from a browser peer in the future — federation peers can
  eventually include browser sessions without reworking the
  wire layer.
* Good, because Node 18+ users (agentdb's declared floor) get
  real QUIC without a Node upgrade.
* Good, because `node:http2` is a built-in fallback that always
  works — federation degrades to HTTP/2-over-TLS when the QUIC
  binary fails to install, rather than silently no-op'ing.
* Bad, because `@fails-components/webtransport` has a native
  postinstall step (libquiche / libngtcp2 build). On hosts where
  it fails (no compiler toolchain, locked-down CI), federation
  falls back to HTTP/2 with degraded properties (no 0-RTT, no
  migration, no UDP).
* Bad, because UDP port 4433 (default) requires firewall rules
  the user must coordinate. HTTP/2 fallback uses TCP and reuses
  443/8443 patterns operators already know.
* Bad, because TLS certs are now non-optional. The user must
  provision a self-signed cert (test) or a real cert (production)
  and populate `ServerConfig.tlsCertPath` / `tlsKeyPath`.
  ADR-0196 §"Out of scope" punted on cert provisioning — this
  ADR doesn't fix that, but the test path uses a self-signed
  cert generated in-process via `node:crypto`.
* Neutral, because the binding choice does not affect the
  `FederatedSyncProvider` interface in
  `forks/agentic-flow/agentic-flow/src/coordination/federated-sync-provider.ts`
  — adapter callers are unaffected.
* Neutral, because `node:quic` remains a future option:
  `QUICConnection.ts` exposes a `Transport` interface, and a
  `NodeQUICTransport` implementation can be added without changing
  `QUICServer` / `QUICClient` callers when Node 22 EOLs.

### Confirmation

* `forks/agentdb/package.json` lists
  `@fails-components/webtransport` under `optionalDependencies`
  (matching the existing pattern for native binaries — see
  `better-sqlite3`, `hnswlib-node`).
* `forks/agentdb/tests/integration/quic-transport.test.ts`
  starts a `QUICServer` on `127.0.0.1:0` (ephemeral port), a
  `QUICClient` connects, pushes one `EpisodeSync` envelope, and
  the server receives it. The test uses a self-signed cert
  minted in-process via `node:crypto` — no system CA dep.
* The HTTP/2 fallback is exercised by setting
  `AGENTDB_QUIC_FORCE_FALLBACK=1` in a second test pass; same
  round-trip must succeed.
* `QUICServer.ts` and `QUICClient.ts` line counts and exported
  signatures are unchanged from pre-ADR — `git diff` over those
  two files shows zero changes.

## Pros and Cons of the Options

### `node:quic` (Node 23+)

* Good, because no postinstall, no native build, first-party.
* Good, because the experimental API converges with WebTransport
  shape over time per Node's roadmap.
* Bad, because Node 23+ excludes Node 18, 20, 22 users — agentdb's
  declared engine floor is `>=18.0.0`.
* Bad, because `--experimental-quic` flag gating is still required;
  ergonomically poor for end users.

### `@fails-components/webtransport`

* Good, because Node 18+ supported.
* Good, because WHATWG WebTransport API — same surface as browsers.
* Good, because real QUIC underneath (libquiche / libngtcp2).
* Bad, because native postinstall can fail on locked-down hosts.
* Bad, because relatively low-traffic package — bus factor concern.

### HTTP/2 via `node:http2`

* Good, because zero install, always available.
* Good, because TLS reuses standard cert / 443 patterns.
* Bad, because not QUIC — `QUICConnection`'s 0-RTT, migration,
  BBR pacing all become aspirational under HTTP/2.
* Bad, because TCP head-of-line blocking on multiplexed streams
  degrades sync-during-loss behaviour vs real QUIC.

### gRPC

* Good, because production-hardened, schemas, codegen.
* Bad, because protobuf re-tooling of agentdb's existing JSON
  `SyncPayload` envelopes is out of scope.
* Bad, because gRPC's HTTP/2 transport doesn't help vs the plain
  HTTP/2 fallback — same TCP properties.

### libp2p

* Good, because it solves NAT / peer discovery, which we'll need
  eventually for cross-network federation.
* Bad, because orthogonal to the binding-selection question —
  libp2p sits *above* a transport, doesn't replace one.
* Bad, because pulls in a peer-mesh / DHT story that exceeds
  Phase 5's scope.

## More Information

* **ADR-0196** — Phase 5 federated interface (parent). This ADR
  resolves §"Transport binding selection" deferred there.
* **ADR-0197** — Finding 3 documents the QUIC stub state
  (no `listen()`, no `bind()`, no production wiring).
* **Scope when implementing**:
  * `forks/agentdb/src/controllers/QUICConnection.ts` —
    introduce a `Transport` interface with two implementations:
    `WebTransportImpl` (primary) and `HTTP2TransportImpl`
    (fallback). Constructor selects via runtime detect:
    try `import('@fails-components/webtransport')`; on any
    error or when `AGENTDB_QUIC_FORCE_FALLBACK=1`, use HTTP/2.
  * `forks/agentdb/src/controllers/QUICServer.ts` — `start()`
    instantiates the same `Transport` and calls
    `transport.listen(host, port, tlsConfig)`. Same exported
    signature.
  * `forks/agentdb/src/controllers/QUICClient.ts` — `connect()`
    instantiates `Transport` and calls
    `transport.connect(host, port, tlsConfig)`. Same exported
    signature.
* **Out of scope** (defer to a future ADR if needed):
  * Cert provisioning UX (`ServerConfig.tlsCertPath` /
    `tlsKeyPath` population — user-supplied today).
  * Multi-peer mesh / discovery (libp2p territory).
  * `node:quic` migration when Node 22 EOLs.
  * Per-table sync opt-out from ADR-0196 open question — still
    accept-all-tables (see ADR-0196 §"Open questions" item 1).
