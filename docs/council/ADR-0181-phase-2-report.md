# ADR-0181 Phase 2 Report — FS-JSON handler un-stub

**Phase:** 2 of 7
**Topology:** hierarchical-mesh / balanced — 10 agents (queen + Devil's Advocate + 6 family-grouped workers + 2 verifiers); leaner than the ADR's 25-agent spec per the Phase 1 anti-thrash carry-forward
**Date:** 2026-05-15
**Status:** **PASS — first-try exit gate.** `npm run release` acceptance 672/678 (0 failed, 6 skip_accepted), matching the pre-Phase-2 baseline. cli/agentdb/ruflo republished. No debugging cycles needed.
**Author:** team-lead (queen ran the coordination; team-lead finalized after queen's release-process detach issue at bump-versions)

## Summary

Phase 2 un-stubbed **51 of 55 FS-JSON-family handler bodies** in `forks/agentdb/src/archivist/handlers/` by porting the existing cli logic (`cli/src/mcp-tools/<family>-tools.ts` — `loadX → mutate → saveX-under-lock`) into a single `ctx.substrate.withWrite` scope. 4 handlers were accepted as genuinely-blocked **Phase 3/4 escape-hatches** with per-handler justifications. The exit gate passed on the **first** release run — a sharp contrast to Phase 1's four cycles.

## What landed (verified on disk)

Single fork commit on `forks/agentdb` `main`: **`ea6bab6` fix(archivist): un-stub FS-JSON handlers (ADR-0181 Phase 2)** — 64 files, +3927/-834 LoC:

| Component | Count / Detail |
|---|---|
| Un-stubbed handler bodies | 51 across 12 FS-JSON families (coord, neural, workflow, swarm, hive-mind, config, ruvllm, github, daa, system, wasm, autopilot) |
| New shared modules | 9 `shared.ts` files extracted per family for cross-handler utilities |
| New `FS_JSON_PATH_OVERRIDES` entries | 16 (one per family that needed a non-default cli path; a systemic gap caught by queen-level audit, see below) |
| `substrate-registry.ts` extension | Option A: sibling-rooted override form (swarm's `.swarm/swarm-state.json` lives outside `.claude-flow/`) |
| `shutdown.ts` reconciliation fix | Write-before-throw + count-guard, no seam change |
| Accepted escape-hatches | 4 (per `adr-0181/phase-2/phase-2-final-carry-forwards` memory) |

Verifications:
- `phase2-verify-pattern`: 51 PASS + 4 accepted carry-forwards + swarm 2/2 PASS post-shutdown-fix; substrate-semantic second-pass clean.
- `phase2-verify-stubcount`: PASS — independent on-disk recount; all 4 escape-hatches verified-genuine.
- `phase2-da`: 6/6 direct clear + Option A registry extension PASS + shutdown fix PASS.

Acceptance: **672/678, 0 failed, 6 skip_accepted**. Published: `@sparkleideas/cli@3.7.0-alpha.10-patch.94`, `@sparkleideas/agentdb@3.0.0-alpha.14-patch.106`.

## Three load-bearing decisions

### 1. Option A — sibling-rooted path override (team-lead ruling)

`fsJsonPathFor` hardcoded `joinPath(projectRoot, '.claude-flow', rel)`, but `swarm`'s cli path is `<projectRoot>/.swarm/swarm-state.json` — a sibling of `.claude-flow/`, not a child. The override map structurally couldn't express it. Option B (defer swarm) would have un-stubbed the body to write to a `.claude-flow/...` path *nothing reads*: silent split-brain at Phase 5 dispatch (`feedback-no-fallbacks` violation). **Ruling: Option A** — extend `fsJsonPathFor` to support a project-root-relative override form (~15 LoC, single file, swarm-only, comment-pinned). DA reviewed and PASS'd; the existing override semantics for the other 11 families unchanged.

### 2. Systemic `FS_JSON_PATH_OVERRIDES` gap (queen-level audit)

`phase2-verify-pattern` caught one missing override (ruvllm). The queen audited all 12 families and found **6 had missing-but-simple overrides** (neural, workflow, system, daa, wasm, autopilot) — the verifier's single-family hit was a sentinel for a systemic gap. The queen directed the 4 affected workers to land the remaining 6 overrides. Without that queen-level extrapolation, those 6 would have shipped silently writing to default paths the cli doesn't read.

### 3. Substrate-semantic correction (verifier → queen → cross-family re-audit)

The pattern verifier surfaced that `withWrite` is a **lock**, not a transaction — handlers cannot rely on read-result reuse across iteration boundaries or on cache invalidation on rollback. The queen propagated the corrected semantic across all PASS'd families via a second-pass audit (no other instances found beyond the originating slice). The captured invariant (**write-back-mutated-root**, in memory `adr-0181/phase-2/phase-2-substrate-cache-aliasing-invariant`) is a Phase 3+ carry-forward for substrate-layer enforcement. Per the queen's own analysis: "would have shipped silent data loss without it."

## Accepted escape-hatches (Phase 3/4 carry-forward)

Four handlers were accepted as genuinely blocked (not stale "Phase N" markers — recon-disambiguation rule held):

1. `github/<handler>` (× 1, flagged by `phase2-ruvllm-github`) — needs a cross-package helper chain that lives outside the Phase 2 substrate seam.
2. `autopilot/learn.ts` (flagged by `phase2-wasm-autopilot`) — depends on an AgentDB-backed controller (Phase 3 read-optimized surface).
3. `hive-mind/consensus` (flagged by `phase2-hive-config`) — companion mutation missing; cross-controller orchestration is Phase 4 work.
4. `hive-mind/status` (flagged by `phase2-hive-config`) — same companion-mutation gap as consensus.

All four are documented at `adr-0181/phase-2/phase-2-final-carry-forwards` with per-handler justifications.

## Coordination notes — Phase 1 carry-forward delivered

Phase 1's carry-forward was "bound the SendMessage-storm failure mode + verifier-gated task closure before a 25-agent phase." Phase 2 applied both:

- **Leaner swarm (10, not 25).** The un-stub work is mechanical and per-family-independent; the ADR's 25-agent cap was a ceiling, not a target. 6 workers (2 families each) + queen + DA + 2 verifiers fit the real parallel surface.
- **Verifier-gated closure.** Workers reported DONE to the queen but did NOT self-mark `completed`. The queen closed a worker's task only after a verifier confirmed that family. Premature-closure cycles: **zero** (vs Phase 1's repeated false-done claims).
- **No inter-worker SendMessage storm.** Workers reported to the queen only; DA engaged workers directly with port-fidelity challenges. Notification traffic stayed purposeful throughout (no empty idle-cycle storm).

The DA + verifier checks proved **orthogonal axes**: DA = port-fidelity-to-cli-mutation-semantics, verifier-pattern = substrate-semantic-correctness, verifier-stubcount = enumerated-exit-gate count. Neither substitutes for the others. The substrate-semantic finding (decision 3 above) would have been missed by DA alone; the path-override gap (decision 2) would have been missed by verifier-pattern alone (queen's audit caught it).

**Process incident at the gate:** the queen's first release attempt died at `bump-versions` — process-detach issue (no `nohup` on the long-running release). Team-lead relaunched with proper detach; second attempt passed cleanly. Captured for future-phase guidance: long-running gate commands must be `nohup`-detached.

## Exit gate

`npm run release` — the mandated Phase 2 gate — **passed on the first run** (second attempt; first attempt was the queen's detach-killed launch, which had not yet reached test-ci).

| Run | Phase reached | Result |
|---|---|---|
| 1 (queen) | bump-versions | killed by process-detach issue (no error) |
| 2 (team-lead, `nohup`) | full cascade | **PASS: 672/678 acceptance, 0 failed** |

Published: `@sparkleideas/cli@3.7.0-alpha.10-patch.94`, `@sparkleideas/agentdb@3.0.0-alpha.14-patch.106`, ruflo-patch wrapper bump to `patch.86` (uncommitted at release time, committed separately).

## Carry-forwards for Phase 3+

1. **The 4 escape-hatch handlers** — claim them in Phase 3 (`autopilot/learn.ts`) and Phase 4 (`github/<handler>`, `hive-mind/consensus`, `hive-mind/status`).
2. **The substrate-cache-aliasing invariant** (`adr-0181/phase-2/phase-2-substrate-cache-aliasing-invariant`) — Phase 3 should consider substrate-layer enforcement of the write-back-mutated-root rule.
3. **STORE_ID granularity vs cli single-store** (`adr-0181/phase-2/carry-forward-phase5-storeid`) — Phase 5 dispatch wiring may surface a multi-store-per-tool case.
4. **Long-running gate detach** — every phase's queen must `nohup`-detach its `npm run release` invocation (see Process incident above).
