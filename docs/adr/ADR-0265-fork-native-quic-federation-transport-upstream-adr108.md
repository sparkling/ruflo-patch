---
status: accepted
completed: false
date: 2026-05-27
amended: 2026-05-27
tags: [upstream-sync, quic, federation, transport, native-binding, napi, ADR-108, design-gate]
supersedes: []
depends-on: [ADR-0186, ADR-0199, ADR-0200, ADR-0201, ADR-0217]
implements: []
---

# Fork-native QUIC federation transport — upstream ADR-108 implementation

## Context

Upstream [ruvnet/ruflo `v3/docs/adr/ADR-108-native-quic-binding.md`](https://github.com/ruvnet/ruflo) proposes a native QUIC binding for federation transport. Status upstream: **`Proposed — gated on upstream agentic-flow Phase-1`** (2026-05-09). The gate is upstream issues `ruvnet/agentic-flow#15-21` — 7 Phase-1 tickets (foundation impl, WASM deps, TS wrapper, integration tests, benchmark, wasm-pack pipeline, validation).

What exists upstream today (verified 2026-05-27 in `/Users/henrik/source/ruvnet/agentic-flow/`):

- `crates/agentic-flow-quic/` — **Rust crate using `quinn`** (canonical Rust QUIC impl). Full client + server features behind compile-time feature flags.
- `crates/agentic-flow-quic/src/wasm.rs` — WASM bindings, **explicitly a stub** ("WASM build is a stub since browsers don't support UDP/QUIC directly. For production QUIC, use native Node.js builds.")
- `agentic-flow/src/transport/quic.ts` (598 LOC) + `swarm/quic-coordinator.ts` (583) + `config/quic.ts` (265) — **WASM-based swarm coordination QUIC**, status "Complete ✅" per `docs/architecture/QUIC-IMPLEMENTATION-SUMMARY.md` (date 2025-10-16). NOTE: this is the **swarm** track, not federation.
- 14+ design docs under `docs/quic/`, `docs/architecture/`, `docs/reviews/` documenting the vision (see §"Aspirational upstream documentation goals" below)

What's missing in upstream for the federation track per ADR-108:

1. **No N-API binding crate** — needs `crates/agentic-flow-quic-node/` wrapping client/server in `napi-rs`
2. **No per-platform binary distribution** — pattern from `@ruvector/*`: `@agentic-flow/quic-native-darwin-arm64`, `@agentic-flow/quic-native-linux-x64-gnu`, etc. via `optionalDependencies`
3. **No platform detection in `loadQuicTransport`** — today's env-var probe is a placeholder
4. **No CI matrix for cross-compiled binaries** — GitHub Actions Linux/macOS/Windows + ARM cross-compile

Fork-side state today:

- **`forks/ruflo/v3/@claude-flow/...` WebSocket QUIC fallback** — hand-ported from upstream `b280a4c` (PR #153) at fork commit `f299cf49e` per [[ADR-0186]] row 266. Federation transport falls back to WS today; auto-upgrade path exists if QUIC binding ships AND Phase 3 rewires the `loadQuicTransport()` return statement (per §Revision 1 §R1.5).
- **`forks/agentic-flow/agentic-flow/src/*quic*.ts`** — ~1446 LOC swarm coordination QUIC, codemod-mirrored from upstream. Used for agent-to-agent coordination, NOT for federation transport.
- **`forks/agentdb/src/controllers/QUIC{ConnectionPool,StreamManager}.ts`** — **deleted per [[ADR-0217]]** (2026-05-23 quarantine). Different scope: that was inter-agentdb-DB multi-writer sync; this ADR is federation transport. The [[ADR-0217]] quarantine remains valid for its scope — see §"Cross-references".

This ADR commits the fork to picking up upstream ADR-108's vision: ship a native QUIC binding usable as federation transport, with WS fallback retained as first-class. Upstream's `Proposed — gated` status flips to "fork-implementing-ahead" for the binding layer — the Rust crate is upstream's; the N-API wrapper, multi-platform distribution, fork-side loader, and federation plugin adoption are fork deliverables.

## Decision Drivers

* **Match upstream's vision, not invent new.** Upstream's ADR-108 already designs the loader pattern, env-var opt-in, multi-platform binary distribution, doctor surface, and verification routine. The fork picks this up directly; divergence requires invariant justification.
* **Additive, not replacement.** WebSocket fallback stays first-class. QUIC is opt-in via `AGENTIC_FLOW_QUIC_NATIVE=1` (mirroring upstream's design). Per upstream's anti-goal #1: no QUIC-or-nothing.
* **No agentdb-sync re-introduction.** [[ADR-0217]] quarantined the agentdb-instance-to-agentdb-instance sync surface as evidenced-product-bet-deferred. This ADR explicitly does NOT extend QUIC into that surface — federation transport (ruflo plugin layer) is the only target.
* **Honest framing of aspirational goals.** Upstream's QUIC documentation makes capability claims (sub-ms latency, 0-RTT reconnection, multiplexed streams, mobility) that must be VERIFIED through benchmarks, not asserted. Per `[[feedback-corpus-evidence-before-feature-work]]`: capability claims are hypotheses until measured.
* **No donate-back to upstream.** Per `[[feedback-no-upstream-donate-backs]]`: the N-API binding crate lives in fork, not as a PR to ruvnet. Fork carries the integration burden; upstream's Rust crate is consumed as-is.

## Considered Options

### Option A — Implement now per upstream ADR-108

Build the N-API binding crate + multi-platform binary distribution + fork-side loader extension + federation plugin adoption + verification routine + smokes. Mirror upstream's plan; diverge only where fork invariants force it.

**Pros:**
- Matches upstream's direction of travel directly; minimizes future merge tax
- Real native QUIC unlocks the documented capabilities (per §"Aspirational" below — to be verified)
- Loader pattern (already in fork from ADR-0186) auto-upgrades when Phase 3 rewires the return (per §Revision 1 §R1.5)
- WS fallback retention preserves browser/UDP-blocked-firewall paths

**Cons:**
- Implementation surface is multi-phase (Rust + N-API + cross-compile CI + integration tests + verification routine)
- Upstream Phase-1 (#15-21) work overlaps; we may need to land changes that upstream later supersedes (merge tax inverted)

### Option B — Defer until upstream Phase-1 ships

Hold per upstream ADR-108's gate. Re-evaluate when any of issues #15-21 close. Equivalent to upstream's own disposition.

### Option C — Implement now PLUS donate-back N-API crate to upstream

Same as Option A, plus file the N-API binding crate as a PR to `ruvnet/agentic-flow`. Violates `[[feedback-no-upstream-donate-backs]]`.

## Decision Outcome

**Accepted: Option A** (status flipped `proposed` → `accepted` 2026-05-27 after D.1 council ratification — see §Revision 1).

Why A over B:
- The user-direct mandate (2026-05-27) is "we are going to implement the upstream vision for QUIC" — Option B fails that mandate.
- ADR-0261 already demonstrated the fork-implementing-ahead-of-upstream pattern works (graph_edges shipped in fork before upstream finalized its WASM build).
- Upstream's loader pattern is already in fork ([[ADR-0186]] row 266); the integration glue is the missing piece, not the foundation.

Why A over C:
- Fork policy bans upstream donate-backs.
- Convergence with upstream happens at the Rust-crate consumption layer, not at the N-API wrapper layer (which is a fork-side concern by design).

## Pre-flight (D.0) — Upstream Phase-1 verification

**Verified 2026-05-27 via local mirror `/Users/henrik/source/ruvnet/agentic-flow/` + `gh issue list -R ruvnet/agentic-flow --search QUIC`.**

| Upstream artifact | State (2026-05-27) | Delta since ADR-108 draft (2026-05-09) |
|---|---|---|
| Issue #15 (Phase-1 Foundation Implementation) | OPEN; last updated 2025-10-12 | unchanged |
| Issue #16 (Phase-1 Fix WASM Build Dependencies) | OPEN; last updated 2025-10-12 | unchanged |
| Issue #17 (Phase-1 TypeScript QUIC Wrapper) | OPEN; last updated 2025-10-12 | unchanged |
| Issue #18 (Phase-1 Integration Tests) | OPEN; last updated 2025-10-12 | unchanged |
| Issue #19 (Phase-1 Benchmark Suite) | OPEN; last updated 2025-10-12 | unchanged |
| Issue #20 (Phase-1 wasm-pack Build Pipeline) | OPEN; last updated 2025-10-12 | unchanged |
| Issue #21 (Phase-1 Validation & Documentation) | OPEN; last updated 2025-10-12 | unchanged |
| Issue #23 (Release v1.5.14: QUIC Transport Layer Integration) | OPEN; last updated 2025-10-16 | unchanged |
| Issue #52 (HTTP/2, HTTP/3, WebSocket Fallback for streaming) | OPEN; last updated 2025-11-06 | orthogonal; not Phase-1 |
| `crates/agentic-flow-quic-node/` directory | **does NOT exist** upstream | confirms: no N-API wrapper anywhere upstream |
| Commits in `crates/agentic-flow-quic/` since 2026-05-09 | **none** | crate is frozen since ADR-108 draft |

**Conclusion**: zero upstream Phase-1 progress in the 18 days since ADR-108 was drafted. The N-API binding crate and per-platform binary distribution must be authored fork-side. Option A's premise (fork-implementing-ahead-of-upstream) holds.

## Aspirational upstream documentation goals (verified by D.1 council, 2026-05-27)

Upstream agentic-flow's QUIC documentation makes the following capability claims. These are **hypotheses** the fork's implementation + verification routine measures; not commitments to deliver. **Confidence column** added per §Revision 1 council audit:

| # | Claim (per upstream docs) | Verification path | Confidence | Notes |
|---|---|---|---|---|
| 1 | Sub-millisecond latency between nodes | Benchmark `scripts/benchmark-quic-federation.mjs` (QUIC vs HTTP/2 vs WS). Pass criterion: **p99 < 5ms on localhost loopback**; cross-host figure is observational, NOT pass/fail | **M** | "Sub-ms" is loopback-only by physics. quinn loopback p99 typically 0.3-2ms. Cross-host is RTT-bound. |
| 2 | 0-RTT reconnection (instant task assignment for returning peers) | Smoke `scripts/smoke-quic-0rtt-reconnect.mjs` — establish, tear down, reconnect; assert handshake count is 0 on the second connection | **L** — `skip-by-policy` unless Phase 1.5 ships | Upstream client at `crates/agentic-flow-quic/src/client.rs:79-83` does NOT call `into_0rtt()`; `enable_0rtt: true` flag at `types.rs:20` is a dead flag. Smoke is unwritable against current crate. See Phase 1.5 below for the patch path. |
| 3 | Multiplexed streams (no head-of-line blocking) | Smoke `scripts/smoke-quic-multiplex.mjs` — open ≥4 concurrent streams, induce ≥500ms slow-receiver on stream 0, assert streams 1..N-1 unaffected | **H** | quinn-by-construction (RFC 9000). `server.rs:117` spawns per-stream tokio tasks. Passes on first try. |
| 4 | Built-in TLS 1.3 encryption | Smoke: assert `getTransportCapabilities()` reports `tlsVersion: 'TLS_1_3'` (typed constant return) | **H** | rustls + quinn = TLS 1.3-only by RFC 9001. Tautological. |
| 5 | 100+ concurrent agent connections on single socket | Benchmark T1 in `scripts/benchmark-quic-federation.mjs`. CI pass target: **100 concurrent connections**. 1000-agent test is **stretch / manual-only, not in CI** | **M (100) / L (1000)** | `server.rs:193-194` caps `max_concurrent_bidi_streams` at 100 hardcoded per-connection. 1000 hits FD/UDP socket limits in CI runners. |
| 6 | Connection ID survives IP changes (mobility) | Smoke `scripts/smoke-quic-mobility.mjs` — tagged **`skip-by-policy: requires-network-namespace-simulation`** | **L** | `client.rs:88` sets `connection_id: 0, // TODO`. quinn migration needs `allow_migration` opt-in + multi-path testing infrastructure fork CI lacks. |
| 7 | Automatic retry + recovery | Smoke `scripts/smoke-quic-recovery.mjs` — application-level retry assertion via mock-socket loss injection. `tc netem` (NET_ADMIN-required) NOT used per GitHub-Actions constraint | **M** | quinn loss-recovery (RFC 9002) is automatic; verification harness must work without NET_ADMIN. |

(Broadcast row REMOVED per §Revision 1 §R1.4 — not a QUIC primitive; upstream "broadcast" lives in `swarm/quic-coordinator.ts` TS layer unrelated to N-API federation path. If application-layer fan-out testing is wanted, route to Phase 4 federation-plugin smokes, not C8.)

The **claim** "QUIC enables sub-millisecond latency synchronization between AgentDB instances" (from the Tessl skill at `tessl.io/registry/skills/github/ruvnet/ruflo/AgentDB%20Advanced%20Features`) is **explicitly REJECTED** by this ADR's scope: AgentDB-instance sync is [[ADR-0217]] territory and remains quarantined. The Tessl claim is upstream documentation drift; this ADR does NOT propose to make it true.

## Implementation plan

Following the [[ADR-0261]] structure. §Revision 1 (2026-05-27) refined §Exports signatures, added Phase 1.5, staged Phase 2, pinned cross-package symbol contracts, and added 13-invariant constraint manifest.

### Phase 1 — Native binding crate (Rust + N-API)

* `forks/agentic-flow/crates/agentic-flow-quic-node/` — new crate wrapping `crates/agentic-flow-quic/` in `napi-rs` for Node.js native module
* `Cargo.toml` + `package.json` + `napi` build config
* Cargo features: `default = ["client", "server"]`; target only `cfg(not(target_family = "wasm"))`
* **Exports (§Revision 1 — no `streamId` parameter; upstream has no multi-stream-reuse API):**
  * `connect(addr: string, config: ConnectionConfig) → Promise<connId: number>` — wraps `QuicClient::new` + `QuicClient::connect`; registers `quinn::Connection` in opaque internal `HashMap<u64, quinn::Connection>` keyed by `connId`. **Never exposes `quinn::Connection` across N-API boundary.**
  * `listen(port: number, config: ConnectionConfig, onMessage: ThreadsafeFunction<{from: string, message: QuicMessage}>) → Promise<serverHandle: number>` — wraps `QuicServer::new` + spawns `run()` on tokio runtime; drains the `mpsc::UnboundedReceiver` and invokes `onMessage` per arrival.
  * `send(connId: number, bytes: Buffer, messageType?: 'Task'|'Result'|'Status'|'Coordination'|'Heartbeat'|'Custom') → Promise<void>` — wraps `QuicClient::send_message`; one fresh `open_bi` per call (upstream's model); bytes wrapped into `QuicMessage` with default `MessageType::Custom("raw")` if `messageType` unset.
  * `close(connId: number) → Promise<void>` — registry lookup; `quinn::Connection::close(0u32.into(), b"shutdown")`. Client-wide shutdown via separate `closeAll() → Promise<void>` export.
  * `stats(connId: number) → Promise<ConnectionStats>` — reads `quinn::Connection::stats()` directly from registry; returns `{rtt_us, bytes_sent, bytes_received, ...}` per-conn. Pool-wide stats via separate `poolStats() → Promise<PoolStats>`.
* Error mapping: `QuicError` → JS `Error` with `{code: category(), recoverable: is_recoverable(), message}`; do NOT stringify whole error.
* File layout: split into `src/lib.rs` (re-exports + `#[napi]`-annotated entry), `src/client.rs`, `src/server.rs`, `src/streams.rs`, `src/registry.rs` — each module under 500 LOC per CLAUDE.md (known divergence per §Revision 1 — Rust requires the split for napi-rs macro coherence).

### Phase 1.5 — Client-side TLS session-ticket cache (gated by 0-RTT smoke writability)

**Optional. Required only if §Aspirational row 2 is to be a real smoke rather than `skip-by-policy`-tagged.**

* Patch `crates/agentic-flow-quic/src/client.rs` fork-native (no upstream donate-back per `[[feedback-no-upstream-donate-backs]]`):
  * Add `Arc<RwLock<rustls::client::ClientSessionStore>>` to `QuicClient`
  * Wire `quinn::ClientConfig::with_session_ticket_store()`; call `endpoint.connect_with()` using `client_config.into_0rtt(...)` when session ticket exists
  * Populate after first successful `connect()`; reuse on subsequent connects to same SNI/addr

**Default disposition**: Phase 1.5 is deferred to a follow-up patch; the 0-RTT smoke ships tagged `skip-by-policy: upstream-client-lacks-session-cache` in initial implementation.

### Phase 2 — Multi-platform binary distribution (staged per §Revision 1)

**Phase 2a (initial — 2 platforms; lowers CI cost; flips the loader for primary targets):**
* `@agentic-flow/quic-native-darwin-arm64` (dev machine + Apple Silicon prod)
* `@agentic-flow/quic-native-linux-x64-gnu` (dominant cloud target)

**Phase 2b (after Phase 2a stabilizes; adds 3 platforms):**
* `@agentic-flow/quic-native-darwin-x64`
* `@agentic-flow/quic-native-linux-arm64-gnu`
* `@agentic-flow/quic-native-win32-x64-msvc`

`optionalDependencies` in `@sparkleideas/agentic-flow` resolves the right one at install. Loader gracefully falls to WS when no matching binary present (e.g., on a platform not yet in Phase 2b).

**CI matrix** follows `forks/ruvector/.github/workflows/build-native.yml` template (drop-in copy + rename + retarget crate path). Runners: `macos-14` (arm64 M1, free on Pro plan; cross-compiles x64 via Xcode), `ubuntu-22.04` (linux-x64 native + linux-arm64 cross via `gcc-aarch64-linux-gnu`), `windows-2022`. `Swatinem/rust-cache@v2` key includes `Cargo.lock` + Rust toolchain version.

**Verdaccio publish strategy**: CI workflow builds artifacts only (uploads `*.node` per platform). Existing `scripts/publish-verdaccio.sh` (run from M5 Max) downloads + publishes per-platform packages. **Verdaccio remains `localhost:4873`-only** per `[[reference-verdaccio]]`; do NOT expose externally.

**Code-signing**: known-deferred. Verdaccio-local distribution avoids macOS Gatekeeper / Windows SmartScreen because `localhost:4873` does not apply `com.apple.quarantine` xattr. Re-evaluate before any public-npm publish.

### Phase 3 — Loader extension

* Edit `forks/agentic-flow/agentic-flow/src/transport/quic-loader.ts`:
  * `isRealQuicAvailable()` (line 497-508): replace env-var-only placeholder with platform-detection import of `@agentic-flow/quic-native-${process.platform}-${process.arch}{-gnu|-msvc}`
  * **`loadQuicTransport()` (line 524-539): when `isRealQuicAvailable()` returns true, return the native-binding-backed `AgentTransport` instead of `WebSocketFallbackTransport.create(config)`** — this `return`-statement rewire IS the actual upgrade trigger; Phase 1+2 alone do not flip the loader (clarified per §Revision 1 §R1.5).
* **Widen `TransportCapabilities.selectedBackend` literal union** (line 549): `'quic' | 'websocket'` → `'quic' | 'websocket' | 'websocket-fallback'`. Loader returns `'websocket-fallback'` when env var unset OR binding load fails. Backward-compat: `'websocket'` retained for callsites that don't care about fallback distinction. Per §Revision 1 §R1.3.
* WS fallback path remains first-class (no throw on no-binding); preserves upstream ADR-108 anti-goal #1.

### Phase 4 — Federation plugin adoption

* Edit `forks/ruflo/v3/@claude-flow/plugin-agent-federation/src/plugin.ts`:
  * Plumb `getTransportCapabilities()` result into a new public method on the plugin instance
  * Preserve federation envelope format, Ed25519 signing, and `verifySignature()` semantics (lines 73-78, 116-171) — transport is a substrate; envelope is wire-stable per [[ADR-0199]]/[[ADR-0200]]/[[ADR-0201]]
* Edit `forks/ruflo/v3/@claude-flow/cli/src/commands/doctor.ts`:
  * Add `runFederationChecks()` returning a `HealthCheck` whose `message` matches `/selectedBackend=(quic|websocket-fallback)\b/`
  * Invoked via `cli doctor --component federation`

### Phase 5 — Verification routine (7 smokes minimum per §Revision 1)

* New `scripts/smoke-quic-*.mjs` files:
  * `scripts/smoke-quic-binding-load.mjs` (C1)
  * `scripts/smoke-quic-loader-upgrade.mjs` (C2)
  * `scripts/smoke-quic-loader-fallback.mjs` (C3)
  * `scripts/smoke-quic-federation-roundtrip.mjs` (C4 — fires same payload via both backends)
  * `scripts/smoke-quic-doctor.mjs` (C5)
  * `scripts/smoke-quic-multiplex.mjs` (§Aspirational row 3)
  * `scripts/smoke-quic-tls13.mjs` (§Aspirational row 4)
* Optional / `skip-by-policy`-tagged smokes:
  * `scripts/smoke-quic-0rtt-reconnect.mjs` (row 2 — gated on Phase 1.5)
  * `scripts/smoke-quic-mobility.mjs` (row 6 — `requires-network-namespace-simulation`)
  * `scripts/smoke-quic-recovery.mjs` (row 7 — mock-socket loss injection)
* `scripts/benchmark-quic-federation.mjs` — measures latency (target p99 < 5ms loopback) + concurrent connections (target 100)
* Wire into canonical harness: `lib/acceptance-adr0265-checks.sh` per `[[feedback-always-wire-tests-into-cicd]]`
* Add `adr0265` to fast-runner group dispatch (`test-acceptance-fast.sh`)
* CI stanza in `.github/workflows/v3-ci-quic.yml` — both env-on AND env-off branches per C4
* Run `node scripts/analyze-acceptance-perf.mjs` post-implementation; apply ADR-0261 §L4 shared-temp pattern if PARALLEL-WASTE >2 per `[[reference-acceptance-perf-analyzer]]`

### Phase 6 — Codemod guards

* `scripts/codemod.mjs` `WONT_MERGE` list: `QUICConnectionPool` + `QUICStreamManager` as forbidden strings under `forks/agentdb/src/controllers/` (C7.b — complements C7.a's arch test)
* New `scripts/lint-no-agentdb-in-quic-crate.mjs`: assert `grep -rn "from.*agentdb" forks/agentic-flow/crates/agentic-flow-quic-node/` returns 0 hits (C7.c — reverse-import guard)

### Cross-package symbol contracts (§Revision 1 — pin before D.2 spawn per ADR-0261 §L5)

Implementation agents working in parallel across `forks/agentic-flow` + `forks/ruflo` + `forks/ruflo-patch` MUST honor these EXACT strings. Mismatch costs an alignment-fix cycle per ADR-0261 §L5 lesson.

| Symbol | Exact value | Consumers |
|---|---|---|
| N-API binding package family | `@agentic-flow/quic-native-{darwin-arm64,darwin-x64,linux-x64-gnu,linux-arm64-gnu,win32-x64-msvc}` | agentic-flow publishes; ruflo consumes via `optionalDependencies`; ruflo-patch smokes import |
| Loader env-var | `AGENTIC_FLOW_QUIC_NATIVE=1` | agentic-flow reads (`quic-loader.ts:503`); ruflo plugin docstring; ruflo-patch smokes set |
| `getTransportCapabilities()` return shape | `{quicAvailable: boolean, webSocketFallbackAvailable: true, selectedBackend: 'quic' \| 'websocket' \| 'websocket-fallback', tlsVersion?: 'TLS_1_3'}` | agentic-flow declares; ruflo doctor consumes; ruflo-patch C5 smoke asserts |
| Loader public exports | `loadQuicTransport`, `isQuicAvailable`, `getTransportCapabilities`, `WebSocketFallbackTransport` from `'agentic-flow/transport/loader'` | all 3 repos |
| Doctor command | `cli doctor --component federation` | ruflo CLI implements; ruflo-patch C5 smoke invokes |
| Doctor output grep target | line matching `/selectedBackend=(quic\|websocket-fallback)\b/` | ruflo CLI emits structured `HealthCheck.message`; ruflo-patch C5 smoke greps |
| Native binding entry exports | `connect`, `listen`, `send`, `close`, `stats`, `closeAll`, `poolStats` (per Phase 1 §Exports above) | agentic-flow crate napi-rs `#[napi]` annotations; loader calls; C1 smoke `require` probe |
| Smoke harness check name | `adr0265` (used by `bash scripts/test-acceptance-fast.sh adr0265`) | ruflo-patch only |

### Constraint manifest (§Revision 1 council)

Implementation agents MUST respect 13 fork-side invariants surfaced by the D.1 fork-invariants steward:

* **I1**: No agentdb-side QUIC stack — preserves [[ADR-0217]] quarantine; codemod + arch test enforce (C7.a/b/c)
* **I2**: Loader public symbol names stable (no rename/move) — `loadQuicTransport`/`isQuicAvailable`/`getTransportCapabilities` re-exported via `agentic-flow/src/transport/index.ts:4-6`
* **I3**: `selectedBackend` literal union widens (not redefines) — Phase 3 handles per §R1.3
* **I4**: WS fallback first-class — no throw-on-no-binding; preserves ADR-108 anti-goal #1
* **I5**: Env-var name exactly `AGENTIC_FLOW_QUIC_NATIVE` — do NOT rename across the 3 repos
* **I6**: Federation envelope format / Ed25519 signing / signed-bytes contract unchanged across both transports (ADR-095 G2 invariant; `plugin.ts:73-78,116-171`)
* **I7**: `AgentTransport` interface contract preserved across both backends — `plugin.ts:36-40` cast must continue working
* **I8**: Doctor output greppable — `HealthCheck.message` contains literal `selectedBackend=...`
* **I9**: `SyncCoordinator` (agentdb) public surface untouched — Phase 3+4 changes touch only `forks/agentic-flow/agentic-flow/src/transport/*` + `forks/ruflo/v3/@claude-flow/plugin-agent-federation/src/plugin.ts`
* **I10**: No `@fails-components/webtransport` dep in `@agentic-flow/quic-native-*` (ADR-0199 separation; that pick is agentdb-side)
* **I11**: Smokes run in `/tmp/ruflo-quic-smoke-$$/` sandboxes per [[ADR-0201]] runtime validation contract; trap-cleanup on success AND failure
* **I12**: Trunk-only commits to `main` on all 3 repos per `[[feedback-trunk-only-fork-development]]`; commit BEFORE `npm run release` per `[[feedback-commit-forks-before-release]]`
* **I13**: Aspirational claims verified by measured benchmarks per `[[feedback-corpus-evidence-before-feature-work]]`; `skip-by-policy` permitted with explicit reason per `[[feedback-skip-accepted-as-squelch]]`

## Acceptance criteria (revised per §Revision 1 — 7 smokes minimum + 3-part C7)

| # | Criterion | Verification |
|---|---|---|
| C1 | N-API binding loads on host platform | `scripts/smoke-quic-binding-load.mjs` — `require('@agentic-flow/quic-native-<platform>')` exits 0; for non-Phase-2a platforms, `skip-by-policy: platform-not-published-yet` until Phase 2b lands |
| C2 | Loader auto-upgrades when env var + binding present | `scripts/smoke-quic-loader-upgrade.mjs` — `AGENTIC_FLOW_QUIC_NATIVE=1` → `getTransportCapabilities().selectedBackend === 'quic'` |
| C3 | Loader falls back to WS when env var unset OR binding load fails | `scripts/smoke-quic-loader-fallback.mjs` — without env var: `selectedBackend === 'websocket-fallback'` (literal union widened per §Phase 3) |
| C4 | Federation send round-trips on both backends | `scripts/smoke-quic-federation-roundtrip.mjs` — same payload fired via `selectedBackend='quic'` AND `selectedBackend='websocket-fallback'`; both succeed; envelope + Ed25519 signing untouched |
| C5 | Doctor surface reports correct backend | `scripts/smoke-quic-doctor.mjs` — `cli doctor --component federation` output matches `/selectedBackend=(quic\|websocket-fallback)\b/` |
| C6 | Benchmarks meet documented targets | `scripts/benchmark-quic-federation.mjs` — p99 < 5ms loopback latency (§Aspirational row 1); 100 concurrent connections (§Aspirational row 5). Cross-host figure observational. Aspirational table populated with MEASURED figures in `completed: true` amendment |
| C7.a | No QUIC stack re-introduction in agentdb (arch test) | Arch test from [[ADR-0217]] still passes — `forks/agentdb/src/controllers/QUIC{ConnectionPool,StreamManager}.ts` MUST NOT exist |
| C7.b | Codemod forbidden-string guard | `scripts/codemod.mjs WONT_MERGE` includes `QUICConnectionPool`/`QUICStreamManager` literals; release pipeline aborts if either appears in `forks/agentdb/src/` |
| C7.c | Reverse-import guard | `grep -rn "from.*agentdb" forks/agentic-flow/crates/agentic-flow-quic-node/` returns 0 hits (enforced by `scripts/lint-no-agentdb-in-quic-crate.mjs`) |
| C8 | Verification smokes wired into canonical harness | `lib/acceptance-adr0265-checks.sh` defines 7 active smokes (binding-load, loader-upgrade, loader-fallback, federation-roundtrip, doctor, multiplex, tls13); 3 optional `skip-by-policy`-tagged (0-RTT, mobility, recovery); `bash scripts/test-acceptance-fast.sh adr0265` runs them |

## Risks

| Risk | Mitigation |
|---|---|
| Upstream agentic-flow Phase-1 (#15-21) lands while we're implementing; their N-API wrapper differs from ours | Track upstream issues weekly; if upstream merges Phase-1 #17 (TS wrapper) before our Phase 2b, evaluate adopting upstream's shape and discarding ours |
| Cross-compile CI matrix grows fork's CI cost significantly | Phase 2a (2 platforms) stays under ADR-0261-baseline budget; Phase 2b (5 platforms) warm-cache wall-clock ~17min stays under 2× of the 9-min baseline; cold-cache may breach (~23min) but should be infrequent. Alert if any single release exceeds 150 billed-min (sign of cache thrash). Drop to 2-platform fast-path only if cold-cache misses exceed 1-in-10 over a 50-release window. |
| Aspirational claims don't survive verification | Document actual MEASURED figures in `completed: true` amendment; no marketing claims that benchmarks don't support per `[[feedback-corpus-evidence-before-feature-work]]`. §Aspirational table Confidence-rated H/M/L per §Revision 1. |
| 0-RTT smoke is unwritable against current upstream Rust crate | Upstream client at `client.rs:79-83` does not call `into_0rtt()`; `enable_0rtt: true` flag is dead. Default: smoke tagged `skip-by-policy` (§Aspirational row 2). Phase 1.5 is opt-in patch path to make smoke writable. |
| Mobility test requires network-namespace manipulation CI doesn't have | Tagged `skip-by-policy: requires-network-namespace-simulation` per §Aspirational row 6 |
| Automatic retry verification path requires `NET_ADMIN` (not available on GitHub Actions) | Replace `tc netem` with mock-socket loss injection (default) OR tag `skip-by-policy: requires-NET_ADMIN` |
| Code-signing — macOS Gatekeeper / Windows SmartScreen | **Known-deferred, low-severity** while distribution is Verdaccio-local (`localhost:4873` does NOT apply `com.apple.quarantine` xattr). Re-evaluate before any public-npm publish per `[[reference-verdaccio]]`. |
| Verdaccio→GitHub Actions topology — fork's Verdaccio is `localhost:4873` only, not exposed publicly | CI workflow builds artifacts only; downloads + publishes via existing `scripts/publish-verdaccio.sh` from the M5 Max. Do NOT expose Verdaccio externally — preserves `[[reference-verdaccio]]` invariant |
| Multi-writer agentdb-sync gets re-requested ([[ADR-0217]] territory) | This ADR explicitly scopes to federation-transport; agentdb-sync requests route to [[ADR-0217]]'s evidence-trigger predicate. C7.b codemod guard enforces at release-time. |
| WebSocket fallback drift — QUIC code paths bug-fix while WS path goes stale | Smokes test BOTH backends per C4; CI runs both env-on and env-off branches |

## Cross-references

* Upstream ADR-108 (`ruvnet/ruflo/v3/docs/adr/ADR-108-native-quic-binding.md`) — the design this ADR picks up; upstream remains `Proposed — gated`. INTEGRATION-LEDGER row to land same-commit as ratification: disposition `reimplemented-via-adr-0265`
* Upstream ADR-104 (federation wire transport loader pattern) — fork inherited via [[ADR-0186]] row 266. **This ADR closes ADR-104's own TODO Phase-2** ("Federation plugin wiring — `agentic-flow/transport/loader` integration"); ledger row 107 cross-ref to be added
* Upstream ADR-105 (federation v1 state snapshot) — reference doc; explains the loader's role
* Upstream ADR-107 (federation TLS) — orthogonal: TLS for the WS phase; QUIC has TLS 1.3 built-in. Fork already carries `pinnedFingerprints` + `caPath` via codemod-mirror; alpha.12 batch hand-ported as ledger row 94 (`1884ed101`→`a8ede7ef1`), re-audited as row 110 in [[ADR-0218]]
* Upstream ADR-109 (receive-side dispatch) — fork-implemented via [[ADR-0186]]; applies regardless of transport
* Upstream ADR-111 (federation network mesh via WireGuard) — fork-declined per [[ADR-0187]] standing rule; not affected by this ADR
* [[ADR-0186]] — Batch I rollup; row 266 hand-ported upstream `b280a4c` WebSocket QUIC fallback. THIS ADR builds on that loader
* [[ADR-0217]] — **scope distinct**: quarantined agentdb-sync QUIC stack. THIS ADR is federation-transport native QUIC. ADR-0217's quarantine remains valid for its scope; this ADR does NOT supersede it
* [[ADR-0199]] / [[ADR-0200]] / [[ADR-0201]] — foundational federation ADRs cited as `depends-on`
* [[ADR-0205]] / [[ADR-0206]] — already superseded by [[ADR-0217]]; not re-superseded here
* [[ADR-0261]] — pattern precedent: fork-native re-implementation of upstream ADR-N with council + revisions + ratification + amendment + acceptance via canonical harness
* Tessl skill `tessl.io/registry/skills/github/ruvnet/ruflo/AgentDB%20Advanced%20Features` — flagged as documentation drift in §"Aspirational" (claim "between AgentDB instances" rejected by this ADR's scope)
* `[[feedback-no-upstream-donate-backs]]` — informs Option C rejection AND Phase 1.5 (fork-native patch, no PR to upstream)
* `[[feedback-corpus-evidence-before-feature-work]]` — informs aspirational-claims-must-be-verified framing
* `[[feedback-always-wire-tests-into-cicd]]` — informs §Phase 5 harness wiring
* `[[reference-acceptance-perf-analyzer]]` — use post-implementation to verify new smokes don't introduce PARALLEL-WASTE
* `[[reference-verdaccio]]` — Verdaccio-local distribution mitigates code-signing concerns; do NOT expose externally
* INTEGRATION-LEDGER rows to land at ratification: new row for ADR-108 disposition `reimplemented-via-adr-0265`; cross-ref annotations on rows 107 (ADR-104 Phase-2 closure) and 266 (PR #153 WS-fallback first-class retention)

## Revision 1 — Council findings (2026-05-27)

D.1 council (5 parallel expert lenses; ZERO consensus voting per `[[feedback-no-hive-ceremony-for-impl]]`) surfaced the following load-bearing changes; applied as in-place amendments to the sections above. Status flipped `proposed` → `accepted` once this revision landed.

### R1.1 §Exports signature — drop `streamId` parameter

Original §Exports listed `send(connId, streamId, bytes)` and `receive(connId, streamId)`. Upstream archeologist found upstream `crates/agentic-flow-quic/` has **no stream-multiplexing API** — every send opens a fresh `open_bi()` (`client.rs:111`), and receive on the client side is symmetric (each `recv_message` opens its own `open_bi()`). Server side delivers via `mpsc::UnboundedReceiver` from `QuicServer::new`, not per-stream pull.

**Resolution**: Phase 1 §Exports drops `streamId` parameter. `send(connId, bytes, messageType?)` opens fresh stream per call (matching upstream's model). Server-side receive is push-based via `onMessage` ThreadsafeFunction registered at `listen()`. Per-stream addressing is upstream-future scope (would require fork patch to expose `Connection::open_bi` reuse; deferred).

### R1.2 0-RTT smoke is unwritable against current crate

Upstream client at `crates/agentic-flow-quic/src/client.rs:79-83` always full-handshakes; no `into_0rtt()` call; `enable_0rtt: true` flag at `types.rs:20` is a dead flag (zero readers in crate source). Server-side sets `max_early_data_size = 1024*1024` at `server.rs:183` but client never sends early data.

**Resolution**: Default disposition is `skip-by-policy: upstream-client-lacks-session-cache` on the 0-RTT smoke. Phase 1.5 (added per §R1.2) is the opt-in fork-native patch path to make the smoke writable.

### R1.3 C3 string mismatch — widen union, don't redefine

Original C3 expected `selectedBackend === 'websocket-fallback'`, but fork source at `quic-loader.ts:549` returns `'websocket'`. Pure string-equality would fail.

**Resolution**: Phase 3 widens `TransportCapabilities.selectedBackend` literal union from `'quic' | 'websocket'` to `'quic' | 'websocket' | 'websocket-fallback'`. Loader emits `'websocket-fallback'` when env var unset OR binding load fails; backward-compat `'websocket'` retained for callsites that don't distinguish.

### R1.4 Broadcast not a QUIC capability — remove from C8

Aspirational-claims auditor + upstream archeologist concur: there is no broadcast primitive in `crates/agentic-flow-quic/`. The upstream "broadcast" lives in `swarm/quic-coordinator.ts` — a TypeScript-over-WASM application-layer fan-out unrelated to the N-API federation path. QUIC has no broadcast at the protocol layer (unicast UDP only).

**Resolution**: Broadcast row REMOVED from §Aspirational table. C8 smoke count revised from "8 minimum" to "7 minimum" (4 active + 3 optional `skip-by-policy`-tagged). Application-layer fan-out, if wanted, routes to Phase 4 federation-plugin smokes — outside this ADR's scope.

### R1.5 "Auto-upgrades" wording overstates Phase 1+2 alone

Original Option A pros said "Loader pattern auto-upgrades transparently when binding loads." This is misleading: even with Phase 1+2 done, `loadQuicTransport()` at line 524-539 unconditionally returns `WebSocketFallbackTransport.create(config)`. The `return`-statement rewire in Phase 3 IS the actual upgrade trigger.

**Resolution**: §Context line 33 amended ("auto-upgrade path exists if QUIC binding ships AND Phase 3 rewires the `loadQuicTransport()` return statement"). §Phase 3 explicitly names the return-statement rewire as the trigger.

### R1.6 Phase 2 staging (2a → 2b)

CI engineer recommended staged rollout: ship 2 primary platforms first to validate the loader before paying the full 5-platform matrix cost. ruvector workflow at `forks/ruvector/.github/workflows/build-native.yml` is a drop-in template for the napi-rs cross-compile matrix.

**Resolution**: Phase 2 split into 2a (`darwin-arm64` + `linux-x64-gnu`) and 2b (`darwin-x64`, `linux-arm64-gnu`, `win32-x64-msvc`). Phase 2b ships after Phase 2a stabilizes.

### R1.7 Cross-package symbol contracts pinned

Per ADR-0261 §L5 lesson, parallel implementation agents working in 3 separate repos MUST share an explicit symbol contract or face an alignment-fix cycle. §Implementation plan now includes "Cross-package symbol contracts" subsection pinning 8 symbols (package names, env-var, return shape, doctor format, native exports, smoke harness name).

### R1.8 Constraint manifest — 13 fork invariants

Fork-invariants steward produced a 13-row constraint manifest binding the implementation to invariants from ADR-0186/0199/0200/0201/0217. Folded into §Implementation plan as "Constraint manifest" subsection.

### R1.9 New §Risks rows

Three risks added: code-signing (known-deferred under Verdaccio-local), CI minute budget (alert at 150 billed-min/release), Verdaccio→GitHub Actions topology (CI builds, M5 Max publishes).

### R1.10 New acceptance criteria C7.b + C7.c

C7 split into C7.a (existing arch test), C7.b (codemod forbidden-string guard at release-time, complementing the test-time arch check), C7.c (reverse-import guard — no `from.*agentdb` in `@agentic-flow/quic-native-*`).

### R1.11 Aspirational table confidence ratings

§Aspirational table gained a Confidence column (H/M/L). HIGH: multiplex, TLS 1.3 (quinn-by-construction). MEDIUM: sub-ms latency (loopback only), 100 concurrent (1000 stretch). LOW + skip-by-policy: 0-RTT, mobility, recovery. Broadcast removed.

### R1.12 ADR-104 Phase-2 closure cross-ref

ADR-104's open TODO ("Federation plugin wiring — `agentic-flow/transport/loader` integration") is owned by this ADR. INTEGRATION-LEDGER row 107 will gain a cross-ref note pointing here. Also: ADR-107 TLS work (`pinnedFingerprints`/`caPath` at `quic-loader.ts:49,54,305-338`) is already fork-side via the alpha.12 batch (ledger rows 94, 110); no gap audit required.

### R1.13 ADR-108 INTEGRATION-LEDGER row

New row to land same-commit as this ADR's ratification:

```
| — | 2026-05-27 | upstream ADR-108 native QUIC binding — fork-implementing-ahead via ADR-0265 | reimplemented-via-adr-0265 | — | 0265 | Upstream `Proposed — gated on agentic-flow Phase-1`; agentic-flow#15-21 frozen since 2026-05-09 (zero commits in `crates/agentic-flow-quic/` since draft). Fork picks up loader/binding/multi-platform-binary/doctor-surface/verification work. WS fallback retained per upstream's anti-goal #1. |
```

## Confirmation

This ADR is **accepted** (2026-05-27). Remaining steps to `completed: true`:

0. ✅ **D.0 — Upstream Phase-1 verification** (committed `3ec26cf`)
1. ✅ **D.1 — Council review of Option A** (5-expert parallel fan-out; findings folded into §Revision 1)
2. ✅ **Ratification** — `proposed` → `accepted` (this commit)
3. ⏳ **D.2 — Implementation** (3-agent parallel fan-out per repo; ADR amendment `implemented: <date>` after completion)
4. ⏳ **D.3 — Validate + commit + release + push** (12-step gate per `docs/plans/2026-05-27-post-adr0261-upstream-merge-completion-plan.md` §D.3)
5. ⏳ **D.4 — Acceptance criteria audit** — each of C1-C8 has a passing acceptance test; §Aspirational table populated with MEASURED figures; cross-link sibling [[ADR-0217]] §Cross-references with backref to this ADR
