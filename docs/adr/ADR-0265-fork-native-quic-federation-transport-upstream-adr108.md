---
status: proposed
completed: false
date: 2026-05-27
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

- **`forks/ruflo/v3/@claude-flow/...` WebSocket QUIC fallback** — hand-ported from upstream `b280a4c` (PR #153) at fork commit `f299cf49e` per [[ADR-0186]] row 266. Federation transport falls back to WS today; auto-upgrade path exists if QUIC binding ships.
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
- Loader pattern (already in fork from ADR-0186) auto-upgrades transparently when binding loads
- WS fallback retention preserves browser/UDP-blocked-firewall paths

**Cons:**
- Implementation surface is multi-week (Rust + N-API + cross-compile CI + integration tests + verification routine)
- Upstream Phase-1 (#15-21) work overlaps; we may need to land changes that upstream later supersedes (merge tax inverted)
- No evidenced product use case today (per ADR-108's defer-reason #2): federation traffic is human/agent-rate (≤100 RPS), WS handles it fine

### Option B — Defer until upstream Phase-1 ships

Hold per upstream ADR-108's gate. Re-evaluate when any of issues #15-21 close. Equivalent to upstream's own disposition.

**Pros:**
- Zero implementation cost
- Upstream may ship a more refined N-API wrapper than we'd write

**Cons:**
- Defers indefinitely; upstream Phase-1 timeline unknown
- Inverts the [[ADR-0261]] precedent (fork picked up upstream ADR-130 design without waiting for upstream Phase-1 completion)
- Misses an opportunity to converge with upstream early

### Option C — Implement now PLUS donate-back N-API crate to upstream

Same as Option A, plus file the N-API binding crate as a PR to `ruvnet/agentic-flow`.

**Pros:**
- Lowers fork's permanent maintenance burden
- Closes upstream Phase-1 #17 (TS wrapper) directly

**Cons:**
- Violates `[[feedback-no-upstream-donate-backs]]`
- Coordination overhead with upstream review cycle

## Decision Outcome

**Proposed: Option A.**

Why A over B:
- The user-direct mandate (2026-05-27) is "we are going to implement the upstream vision for QUIC" — Option B fails that mandate.
- ADR-0261 already demonstrated the fork-implementing-ahead-of-upstream pattern works (graph_edges shipped in fork before upstream finalized its WASM build).
- Upstream's loader pattern is already in fork ([[ADR-0186]] row 266); the integration glue is the missing piece, not the foundation.

Why A over C:
- Fork policy bans upstream donate-backs.
- Convergence with upstream happens at the Rust-crate consumption layer, not at the N-API wrapper layer (which is a fork-side concern by design).

This ADR is **proposed**. Ratification + implementation are separate steps following the [[ADR-0261]] pattern.

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

**Conclusion**: zero upstream Phase-1 progress in the 18 days since ADR-108 was drafted. The N-API binding crate and per-platform binary distribution must be authored fork-side. Option A's premise (fork-implementing-ahead-of-upstream) holds — there is no upstream work to consume.

**Council input**: workers in the D.1 ratification council should treat upstream's documented `crates/agentic-flow-quic/` (the `quinn`-based Rust crate) as a fixed dependency to wrap. They should NOT assume any TypeScript wrapper, integration tests, or benchmarks exist upstream — those are part of the fork deliverable.

## Aspirational upstream documentation goals (to be verified, not committed)

Upstream agentic-flow's QUIC documentation (`docs/architecture/QUIC-IMPLEMENTATION-SUMMARY.md`, `docs/quic/QUIC-STATUS.md`, `docs/reviews/quic-implementation-review.md`, `examples/quic-server-coordinator.js`, `benchmarks/quic-transport.bench.ts`) makes the following capability claims. These are **hypotheses** the fork's implementation + verification routine will measure; not commitments to deliver:

| Claim (per upstream docs) | Verification path |
|---|---|
| Sub-millisecond latency between nodes ("<1ms latency") | Benchmark: `agentic-flow/benchmarks/quic-transport.bench.ts` (QUIC vs HTTP/2 vs WebSocket) — port to fork-side `scripts/benchmark-quic-federation.mjs`. Pass criterion: p99 < 5ms on localhost loopback; document actual cross-tailnet figure |
| 0-RTT reconnection (instant task assignment for returning peers) | Smoke: `scripts/smoke-quic-0rtt-reconnect.mjs` — establish, tear down, reconnect; assert handshake count is 0 on the second connection |
| Multiplexed streams (no head-of-line blocking) | Smoke: `scripts/smoke-quic-multiplex.mjs` — open N concurrent streams, induce slow-receiver on stream 0, assert streams 1..N-1 are unaffected |
| Built-in TLS 1.3 encryption | Smoke: assert `getTransportCapabilities()` reports `tlsVersion: 'TLS_1_3'`; wireshark-equivalent inspection in CI as documentation, not gate |
| 100+ concurrent agent connections on single socket | Benchmark T1 in `benchmark-quic-federation.mjs` — agent counts `[10, 100, 1000]` per upstream's `quic-transport.bench.ts` shape |
| Connection ID survives IP changes (mobility) | Smoke: `scripts/smoke-quic-mobility.mjs` — simulate IP change mid-session, assert connection survives. Skip-by-policy if test harness can't simulate (document as deferred-verification, not silent pass) |
| Automatic retry + recovery | Smoke: induce packet loss via `tc netem` in CI; assert delivery completes |
| Event-based broadcasting | Smoke: `scripts/smoke-quic-broadcast.mjs` — 1 sender, N receivers, assert all receive |

The **claim** "QUIC enables sub-millisecond latency synchronization between AgentDB instances" (from the Tessl skill at `tessl.io/registry/skills/github/ruvnet/ruflo/AgentDB%20Advanced%20Features`) is **explicitly REJECTED** by this ADR's scope: AgentDB-instance sync is [[ADR-0217]] territory and remains quarantined. The Tessl claim is upstream documentation drift; this ADR does NOT propose to make it true.

## Implementation plan (skeleton — concrete after ratification)

Following the [[ADR-0261]] structure. Files named at this level of abstraction; specifics in the post-ratification amendment:

### Phase 1 — Native binding crate (Rust + N-API)

* `forks/agentic-flow/crates/agentic-flow-quic-node/` — new crate wrapping `crates/agentic-flow-quic/` in `napi-rs` for Node.js native module
* `Cargo.toml` + `package.json` + `napi` build config
* Exports: `connect(config)`, `listen(port, config)`, `send(connId, streamId, bytes)`, `receive(connId, streamId)`, `close(connId)`, `stats(connId)`

### Phase 2 — Multi-platform binary distribution

* `@agentic-flow/quic-native-darwin-arm64`
* `@agentic-flow/quic-native-darwin-x64`
* `@agentic-flow/quic-native-linux-x64-gnu`
* `@agentic-flow/quic-native-linux-arm64-gnu`
* `@agentic-flow/quic-native-win32-x64-msvc`
* `optionalDependencies` in `@sparkleideas/agentic-flow` resolves the right one at install

### Phase 3 — Loader extension

* Edit `forks/agentic-flow/agentic-flow/src/transport/quic-loader.ts` `isRealQuicAvailable()` to replace placeholder with real platform-specific import per upstream ADR-108 §"Phase 1 — Detection"
* Edit `forks/agentic-flow/agentic-flow/src/transport/quic.ts` to use the native binding when `isRealQuicAvailable()` returns true; otherwise WS fallback

### Phase 4 — Federation plugin adoption

* Edit `forks/ruflo/v3/@claude-flow/plugin-agent-federation/src/plugin.ts` to surface `selectedBackend` via `getTransportCapabilities()`
* Doctor surface: `--component federation` reports `selectedBackend=quic` when native loaded

### Phase 5 — Verification routine

* New `scripts/smoke-quic-*.mjs` files per §"Aspirational" table (8 smokes minimum)
* `scripts/benchmark-quic-federation.mjs` matching upstream's `quic-transport.bench.ts` shape
* Wire into canonical harness: `lib/acceptance-adr0265-checks.sh` per `[[feedback-always-wire-tests-into-cicd]]`
* Add `adr0265` to fast-runner group dispatch
* CI stanza in `.github/workflows/v3-ci-quic.yml`

### Phase 6 — Codemod guards

* `scripts/codemod.mjs` `WONT_MERGE` list: any upstream files that need fork-divergent shape (TBD per implementation)
* Lint extension at `scripts/lint-no-daemon-lock-cache.mjs` if Phase 1 introduces handler-style files

## Acceptance criteria (8 — to be expanded in implementation amendment)

| # | Criterion | Verification |
|---|---|---|
| C1 | N-API binding loads on macOS arm64 | `node -e "require('@agentic-flow/quic-native-darwin-arm64')"` exits 0 |
| C2 | Loader auto-upgrades when env var + binding present | `AGENTIC_FLOW_QUIC_NATIVE=1` → `getTransportCapabilities().selectedBackend === 'quic'` |
| C3 | Loader falls back to WS when binding absent | Without env var: `selectedBackend === 'websocket-fallback'` |
| C4 | Federation send round-trips on both backends | Smoke fires same payload via both; both succeed |
| C5 | Doctor surface reports correct backend | `cli doctor --component federation` output includes `selectedBackend=...` |
| C6 | Benchmarks meet documented targets | See §"Aspirational" verification table; pass criteria documented |
| C7 | No QUIC stack re-introduction in agentdb | Arch test from [[ADR-0217]] still passes — `forks/agentdb/src/controllers/QUIC{ConnectionPool,StreamManager}.ts` MUST NOT exist |
| C8 | All 8 verification smokes wired into canonical harness | `lib/acceptance-adr0265-checks.sh` defines them; `bash scripts/test-acceptance-fast.sh adr0265` runs them |

## Risks

| Risk | Mitigation |
|---|---|
| Upstream agentic-flow Phase-1 (#15-21) lands while we're implementing; their N-API wrapper differs from ours | Track upstream issues weekly; if upstream merges Phase-1 #17 (TS wrapper) before our Phase 2, evaluate adopting upstream's shape and discarding ours |
| Cross-compile CI matrix grows fork's CI cost significantly | Bench CI cost before+after; if >2× release time, drop to 2 platforms (linux-x64-gnu + darwin-arm64) and document the others as community-build-only |
| Aspirational claims don't survive verification (sub-ms latency, 0-RTT, etc.) | Document actual measured figures in this ADR's `implemented` amendment; no marketing claims that the benchmarks don't support per `[[feedback-corpus-evidence-before-feature-work]]` |
| Mobility test requires network-namespace manipulation CI doesn't have | Tag smoke as `skip-by-policy` with explicit reason; document deferred verification in §"Aspirational" table |
| Multi-writer agentdb-sync gets re-requested (ADR-0217 territory) | This ADR explicitly scopes to federation-transport; agentdb-sync requests route to ADR-0217's evidence-trigger predicate |
| WebSocket fallback drift — QUIC code paths bug-fix while WS path goes stale | Smokes test BOTH backends per C4; CI runs both env-on and env-off |

## Cross-references

* Upstream [[ADR-108]] (`ruvnet/ruflo/v3/docs/adr/ADR-108-native-quic-binding.md`) — the design this ADR picks up; upstream remains `Proposed — gated`
* Upstream ADR-104 (federation wire transport loader pattern) — auto-upgrade mechanism that fork already inherited via [[ADR-0186]] row 266
* Upstream ADR-105 (federation v1 state snapshot) — reference doc; explains the loader's role
* Upstream ADR-107 (federation TLS) — orthogonal: TLS for the WS phase; QUIC has TLS 1.3 built-in
* Upstream ADR-109 (receive-side dispatch) — fork-implemented via [[ADR-0186]]; applies regardless of transport
* Upstream ADR-111 (federation network mesh via WireGuard) — orthogonal alternative; can coexist with QUIC
* [[ADR-0186]] — Batch I rollup; row 266 hand-ported upstream `b280a4c` WebSocket QUIC fallback. THIS ADR builds on that loader.
* [[ADR-0217]] — **scope distinct**: quarantined agentdb-sync QUIC stack. THIS ADR is federation-transport native QUIC. ADR-0217's quarantine remains valid for its scope; this ADR does NOT supersede it. The two ADRs are siblings addressing different surfaces of the QUIC topic.
* [[ADR-0199]] / [[ADR-0200]] / [[ADR-0201]] — foundational federation ADRs cited as `depends-on` (mirror ADR-0217's dependency set)
* [[ADR-0205]] / [[ADR-0206]] — already superseded by [[ADR-0217]]; not re-superseded here
* [[ADR-0261]] — pattern precedent: fork-native re-implementation of upstream ADR-N with council + revisions + ratification + amendment + acceptance via canonical harness
* Tessl skill `tessl.io/registry/skills/github/ruvnet/ruflo/AgentDB%20Advanced%20Features` — flagged as documentation drift in §"Aspirational" (claim "between AgentDB instances" is rejected by this ADR's scope)
* `[[feedback-no-upstream-donate-backs]]` — informs Option C rejection
* `[[feedback-corpus-evidence-before-feature-work]]` — informs aspirational-claims-must-be-verified framing
* `[[feedback-always-wire-tests-into-cicd]]` — informs §Phase 5 harness wiring
* `[[reference-acceptance-perf-analyzer]]` — use post-implementation to verify new smokes don't introduce PARALLEL-WASTE
* INTEGRATION-LEDGER: a new row will be added on ratification linking this ADR to upstream ADR-108's status

## Confirmation

This ADR is proposed-only. To advance:

0. **Verify the upstream Phase-1 issue tracker state**. Check `ruvnet/agentic-flow#15-21` for any closed-since-2026-05-09 progress that affects scope. Document deltas before ratification.
1. **Council review** of the design (Option A). Devil's-advocate critique on the aspirational-claims table — are any of the upstream-documented capabilities physically impossible on fork's substrate (e.g., 0-RTT requires session ticket persistence — is there a fork constraint that breaks this)?
2. **Ratification** flips status `proposed` → `accepted`.
3. **Implementation** is a separate ADR amendment (status → `implemented`, with the 6-phase deliverables in place).
4. **Acceptance criteria audit** at end of implementation: each of the 8 criteria has a passing acceptance test verifying its compliance. Aspirational-claims table populated with MEASURED figures.
5. **Cross-link sibling [[ADR-0217]]** — add a §"Cross-references" backref to this ADR in ADR-0217's body, confirming the two scopes coexist (federation transport here; agentdb-sync quarantine there).

Until step 4 completes, upstream ADR-108 stays `Proposed — gated` from upstream's POV; the fork's commitment to implementation is captured here.
