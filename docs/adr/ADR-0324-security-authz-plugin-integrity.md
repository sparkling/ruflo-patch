---
status: proposed
date: 2026-06-11
tags: [security, authorization, plugin-integrity, ed25519, batch-u-followup, upstream-port]
supersedes: []
depends-on: [ADR-0301]
implements: []
---

# ADR-144/145 P1 — authorization propagator + Ed25519 plugin integrity (ON + self-inert)

## Context
Upstream `1c98cbee6` (ADR-144/145 P1) ships an AgentAuthorizationPropagator +
PluginIntegrityVerifier (Ed25519) OFF-by-default (future v4). The fork does not
ship dormant off-by-default features (`feedback-no-dormant-off-by-default-flags`).

## Decision
Hand-port both, but **ON + self-inert-until-data** (not off-by-default):
- `security/src/authorization/propagator.ts` (ADR-144): enforces only when an
  `AuthScope` is present; `checkToolCallOrInert()` is a no-op `allow` with no
  scope (the fork attaches none today → zero behavior change). Escape hatch
  `RUFLO_STRICT_AUTH=false` disables.
- `security/src/plugins/integrity-verifier.ts` (ADR-145, `@noble/ed25519`):
  returns a new `self-inert` verdict (pass-through) when trust-anchors is empty
  — NOT upstream's `unknown-signer`, which would block every plugin. Enforces
  once a real anchor is configured. Escape hatch `RUFLO_STRICT_PLUGINS=false`.
- `cli/src/plugins/trust/trust-anchors.json` (empty seed). `@noble/ed25519`
  added to `security/package.json` (pkg builds standalone). ADR-146 P2 NOT
  ported (depends on ToolOutputGuardrail/ADR-131, absent → inert).

## Consequences
- Good: real plugin-signature + agent-authorization capability, default-ON yet
  identical-to-before until anchors/scopes exist; escape hatch DISABLES.
- Open (P2): `trust-anchors.json` lives under `src/` which the cli `files[]`
  excludes — inert now (P1 is library-only, no loader/call site); must be
  resolved (dist copy) when a call site is wired.

## Confirmation
Per-class tests: self-inert path (no behavior change) + ON path (verify/reject).
tsc clean (security's only tsc error is a stale-dev-env bcryptjs in a pre-existing
untouched file; the release's fresh install resolves it). forks/ruflo `955df69db`.
