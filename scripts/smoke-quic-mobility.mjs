#!/usr/bin/env node
/**
 * Smoke test: ADR-0265 §Aspirational row 6 — Connection ID survives IP changes.
 *
 * Default disposition: ALWAYS `skip-by-policy:
 * requires-network-namespace-simulation`.
 *
 * Why a stub:
 *   `client.rs:88` sets `connection_id: 0, // TODO`. quinn migration needs
 *   `allow_migration` opt-in + multi-path testing infrastructure the fork
 *   CI lacks (network-namespace manipulation in GitHub Actions runners
 *   requires elevated capabilities not granted).
 *
 * Per `feedback-skip-accepted-as-squelch`: this is a LEGITIMATE skip (the
 * test harness CANNOT inject IP changes without NET_ADMIN / network
 * namespaces). NOT a squelch.
 *
 * Usage: node scripts/smoke-quic-mobility.mjs
 */

import { skipByPolicy } from './lib/smoke-adr0265-shared.mjs';

function main() {
  skipByPolicy('smoke-quic-mobility',
    'requires-network-namespace-simulation: connection_id is hard-coded 0 in client.rs:88; quinn allow_migration not enabled; CI lacks NET_ADMIN/netns',
    {
      adr: 'ADR-0265',
      aspirationalRow: 6,
      upstreamRef: 'crates/agentic-flow-quic/src/client.rs:88',
      blockingCapability: 'NET_ADMIN or unshare --net',
    });
}

main();
