#!/usr/bin/env node
/**
 * Smoke test: ADR-0265 §Aspirational row 2 — 0-RTT reconnection.
 *
 * Default disposition: ALWAYS `skip-by-policy:
 * upstream-client-lacks-session-cache` per §R1.2.
 *
 * Why a stub:
 *   Upstream `crates/agentic-flow-quic/src/client.rs:79-83` does NOT call
 *   `into_0rtt()`; `enable_0rtt: true` flag at `types.rs:20` is a dead flag.
 *   Server side sets `max_early_data_size = 1024*1024` at `server.rs:183`
 *   but client never sends early data. The smoke is unwritable against the
 *   current upstream Rust crate.
 *
 * Phase 1.5 (opt-in, fork-native patch path) is the route to make this
 * smoke writable. Until then this file ships as a documented stub that
 * exits 0 with `skip_accepted: true`.
 *
 * Per `feedback-skip-accepted-as-squelch`: this is a LEGITIMATE skip
 * (feature genuinely unavailable in the substrate). NOT a squelch.
 *
 * Usage: node scripts/smoke-quic-0rtt-reconnect.mjs
 */

import { skipByPolicy } from './lib/smoke-adr0265-shared.mjs';

function main() {
  skipByPolicy('smoke-quic-0rtt-reconnect',
    'upstream-client-lacks-session-cache: client.rs:79-83 does not call into_0rtt(); enable_0rtt flag at types.rs:20 is dead (Phase 1.5 not yet shipped)',
    {
      adr: 'ADR-0265',
      aspirationalRow: 2,
      phasePath: 'Phase 1.5 (opt-in fork-native patch to client.rs)',
      upstreamRef: 'crates/agentic-flow-quic/src/client.rs:79-83',
    });
}

main();
