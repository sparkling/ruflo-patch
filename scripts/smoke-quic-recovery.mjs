#!/usr/bin/env node
/**
 * Smoke test: ADR-0265 §Aspirational row 7 — Automatic retry + recovery.
 *
 * Default disposition: ALWAYS `skip-by-policy:
 * requires-NET_ADMIN-or-mock-socket-loss-injection`.
 *
 * Why a stub:
 *   quinn loss-recovery (RFC 9002) is automatic by construction; the
 *   verification harness needs to INJECT packet loss to observe recovery.
 *   `tc netem` requires NET_ADMIN (not available on GitHub Actions runners).
 *   Mock-socket loss injection is the documented future path but requires
 *   wrapper-plumbing the UDP socket through a controlled mock, which is
 *   out-of-scope for the initial Phase-5 smoke harness.
 *
 * Per `feedback-skip-accepted-as-squelch`: this is a LEGITIMATE skip (the
 * test harness CANNOT inject controlled loss without NET_ADMIN or a
 * substrate-level mock-socket layer). NOT a squelch.
 *
 * Usage: node scripts/smoke-quic-recovery.mjs
 */

import { skipByPolicy } from './lib/smoke-adr0265-shared.mjs';

function main() {
  skipByPolicy('smoke-quic-recovery',
    'requires-NET_ADMIN-or-mock-socket-loss-injection: tc netem needs NET_ADMIN (CI lacks it); mock-socket loss injection layer not yet built',
    {
      adr: 'ADR-0265',
      aspirationalRow: 7,
      blockingCapability: 'NET_ADMIN (for tc netem) OR mock-socket loss injection wrapper',
    });
}

main();
