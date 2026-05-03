#!/usr/bin/env bash
# lib/acceptance-adr0127-adaptive.sh — ADR-0127 (T9) adaptive autoscaling
#
# Acceptance for the protocol-layer queen-side consumer that lives in
# `swarm/src/adaptive-loop.ts` and the runtime population of
# `HealthReport.partitionDetected` + the new T9 fields in
# `monitorSwarmHealth()`.
#
# These checks operate against the codemodded swarm dist:
#   - `/tmp/ruflo-build/v3/@claude-flow/swarm/dist/adaptive-loop.js`
#   - `/Users/henrik/source/forks/ruflo/v3/@claude-flow/swarm/dist/adaptive-loop.js` (fallback)
#
# Per ADR-0118 task-T9 prompt (this lib is NOT wired into
# scripts/test-acceptance.sh — the orchestrator decides if/when to wire
# it). Intended to be invoked manually:
#   bash scripts/test-acceptance.sh ... && bash lib/acceptance-adr0127-adaptive.sh
#
# Requires (sourced from acceptance-harness.sh): _ns, _elapsed_ms,
# _cli_cmd, _e2e_isolate. Caller MUST set REGISTRY, TEMP_DIR.
#
# Per `feedback-no-fallbacks.md`: every check must FAIL when the feature
# is broken. Missing dist → check fails (does NOT pass with "skipped").
# Per `feedback-no-squelch-tests.md`: assertions are real, not no-ops.

set +u 2>/dev/null || true

# Cached path to the codemodded swarm dist. Prefer freshest mtime
# between codemod build dir + fork's own dist (mirrors the unit test
# resolver in tests/unit/adr0127-adaptive-topology.test.mjs). The fork
# dist takes over when the developer iterates fork sources without
# re-running the codemod.
__ADR0127_LOOP_DIST=""
__ADR0127_QUEEN_DIST=""
_adr0127_pick_freshest() {
  local a="$1" b="$2"
  if [[ -f "$a" && -f "$b" ]]; then
    if [[ "$a" -nt "$b" ]]; then echo "$a"; else echo "$b"; fi
  elif [[ -f "$a" ]]; then echo "$a"
  elif [[ -f "$b" ]]; then echo "$b"
  fi
}
_adr0127_resolve_dists() {
  if [[ -z "$__ADR0127_LOOP_DIST" ]]; then
    __ADR0127_LOOP_DIST=$(_adr0127_pick_freshest \
      "/tmp/ruflo-build/v3/@claude-flow/swarm/dist/adaptive-loop.js" \
      "/Users/henrik/source/forks/ruflo/v3/@claude-flow/swarm/dist/adaptive-loop.js")
  fi
  if [[ -z "$__ADR0127_QUEEN_DIST" ]]; then
    __ADR0127_QUEEN_DIST=$(_adr0127_pick_freshest \
      "/tmp/ruflo-build/v3/@claude-flow/swarm/dist/queen-coordinator.js" \
      "/Users/henrik/source/forks/ruflo/v3/@claude-flow/swarm/dist/queen-coordinator.js")
  fi
}

# Helper: run a node script with the loop dist preloaded; capture stdout.
_adr0127_run_script() {
  local script="$1"
  _adr0127_resolve_dists
  if [[ -z "$__ADR0127_LOOP_DIST" ]]; then
    echo "DIST_MISSING"
    return 1
  fi
  node --input-type=module -e "$(cat <<NODESCRIPT
import('${__ADR0127_LOOP_DIST}').then(async (mod) => {
  try {
    ${script}
  } catch (e) {
    console.log('THROWN:' + e.message);
  }
}).catch(e => console.log('IMPORT_FAILED:' + e.message));
NODESCRIPT
)" 2>&1
}

# ════════════════════════════════════════════════════════════════════
# AC #1 — adaptive-loop.ts module is built and exports the documented surface
# ════════════════════════════════════════════════════════════════════
check_adr0127_adaptive_loop_module_present() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _adr0127_resolve_dists
  if [[ -z "$__ADR0127_LOOP_DIST" ]]; then
    _CHECK_OUTPUT="ADR-0127 AC#1: adaptive-loop.js dist not present at any known path"
    end_ns=$(_ns); _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi
  local missing=()
  for sym in AdaptiveLoop createAdaptiveLoop computeQueuePercentiles computeLoadCoV computeIdleWorkerCount detectPartitionFromHeartbeats pickMostBackloggedDomain pickLongestIdleWorker ADAPTIVE_LOOP_DEFAULTS; do
    if ! grep -qE "export\s+(class|function|const)\s+${sym}\b" "$__ADR0127_LOOP_DIST"; then
      missing+=("$sym")
    fi
  done
  if (( ${#missing[@]} == 0 )); then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0127 AC#1: adaptive-loop.js exports all 9 documented symbols"
  else
    _CHECK_OUTPUT="ADR-0127 AC#1: adaptive-loop.js missing exports — ${missing[*]}"
  fi
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# ════════════════════════════════════════════════════════════════════
# AC #2 — preliminary thresholds match ADR-0127 §Specification
# ════════════════════════════════════════════════════════════════════
check_adr0127_preliminary_thresholds() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  local out
  out=$(_adr0127_run_script "
    const d = mod.ADAPTIVE_LOOP_DEFAULTS;
    const ok =
      d.pollIntervalMs === 5000 &&
      d.settleWindowMs === 30000 &&
      d.dampeningWindowMs === 30000 &&
      d.highWaterQueueDepth === 3 &&
      d.lowWaterQueueDepth === 0 &&
      d.highCoV === 0.6 &&
      d.lowCoV === 0.3 &&
      d.perTypeMin === 1 &&
      d.maxFlipsPerWindow === 4;
    console.log(ok ? 'OK' : 'FAIL:' + JSON.stringify(d));
  ")
  if [[ "$out" == OK ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0127 AC#2: all 9 preliminary thresholds match §Specification"
  else
    _CHECK_OUTPUT="ADR-0127 AC#2: thresholds drift — $out"
  fi
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# ════════════════════════════════════════════════════════════════════
# AC #3 — sustained scale-up under simulated queue depth above high-water
# ════════════════════════════════════════════════════════════════════
check_adr0127_sustained_scale_up() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  local out
  out=$(_adr0127_run_script "
    let now = 0;
    const calls = [];
    const swarm = {
      getAgentsByDomain: () => [],
      getAllAgents: () => [],
      getAvailableAgents: () => [],
      getMetrics: () => ({}),
      getDomainConfigs: () => new Map(),
      getStatus: () => ({ domains: [{ name: 'core', agentCount: 5, availableAgents: 5, busyAgents: 0, tasksQueued: 10, tasksCompleted: 0 }], metrics: {} }),
      assignTaskToDomain: async () => 'a',
      proposeConsensus: async () => ({}),
      broadcastMessage: async () => {},
    };
    const loop = mod.createAdaptiveLoop(
      swarm,
      {
        scaleUp: async (d) => calls.push({ kind: 'up', d }),
        scaleDown: async () => {},
        switchTopology: async () => 'OK',
      },
      { pollIntervalMs: 1000, dampeningWindowMs: 2000, settleWindowMs: 100000, now: () => now },
    );
    loop.start();
    for (let i = 0; i < 6; i++) { now += 1000; await loop.tickOnce(); }
    loop.stop();
    const upCount = calls.filter(c => c.kind === 'up').length;
    console.log(upCount === 1 && calls[0].d === 'core' ? 'OK' : 'FAIL:upCount=' + upCount + ',calls=' + JSON.stringify(calls));
  ")
  if [[ "$out" == OK ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0127 AC#3: sustained scale-up fires exactly once after dampening window"
  else
    _CHECK_OUTPUT="ADR-0127 AC#3: $out"
  fi
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# ════════════════════════════════════════════════════════════════════
# AC #4 — oscillation flap produces zero actions (hysteresis preserved)
# ════════════════════════════════════════════════════════════════════
check_adr0127_oscillation_flap_zero_actions() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  local out
  out=$(_adr0127_run_script "
    let now = 0;
    let hi = true;
    const calls = [];
    const swarm = {
      getAgentsByDomain: () => [],
      getAllAgents: () => [],
      getAvailableAgents: () => [],
      getMetrics: () => ({}),
      getDomainConfigs: () => new Map(),
      getStatus: () => ({ domains: [{ name: 'core', agentCount: 5, availableAgents: 5, busyAgents: 0, tasksQueued: hi ? 10 : 0, tasksCompleted: 0 }], metrics: {} }),
      assignTaskToDomain: async () => 'a',
      proposeConsensus: async () => ({}),
      broadcastMessage: async () => {},
    };
    const loop = mod.createAdaptiveLoop(
      swarm,
      {
        scaleUp: async (d) => calls.push({ kind: 'up', d }),
        scaleDown: async (a, d) => calls.push({ kind: 'down', a, d }),
        switchTopology: async () => 'OK',
      },
      { pollIntervalMs: 1000, dampeningWindowMs: 5000, settleWindowMs: 5000, now: () => now },
    );
    loop.start();
    for (let i = 0; i < 20; i++) {
      now += 1000;
      hi = !hi;
      await loop.tickOnce();
    }
    loop.stop();
    console.log(calls.length === 0 ? 'OK' : 'FAIL:calls=' + JSON.stringify(calls));
  ")
  if [[ "$out" == OK ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0127 AC#4: oscillation flap (20 ticks) produces zero actions"
  else
    _CHECK_OUTPUT="ADR-0127 AC#4: $out"
  fi
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# ════════════════════════════════════════════════════════════════════
# AC #5 — adversarial flip-rate halts the loop loud (circuit-breaker)
# ════════════════════════════════════════════════════════════════════
check_adr0127_adversarial_flip_rate_halts() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  local out
  out=$(_adr0127_run_script "
    let now = 0;
    let queue = 10;
    const swarm = {
      getAgentsByDomain: () => [],
      getAllAgents: () => [],
      getAvailableAgents: () => [],
      getMetrics: () => ({}),
      getDomainConfigs: () => new Map(),
      getStatus: () => ({ domains: [{ name: 'core', agentCount: 5, availableAgents: 5, busyAgents: 0, tasksQueued: queue, tasksCompleted: 0 }], metrics: {} }),
      assignTaskToDomain: async () => 'a',
      proposeConsensus: async () => ({}),
      broadcastMessage: async () => {},
    };
    const faults = [];
    const loop = mod.createAdaptiveLoop(
      swarm,
      {
        scaleUp: async () => {},
        scaleDown: async () => {},
        switchTopology: async () => 'OK',
      },
      { pollIntervalMs: 1000, dampeningWindowMs: 1000, settleWindowMs: 1000, maxFlipsPerWindow: 3, flipWindowMs: 60000, now: () => now },
    );
    loop.on('fault', f => faults.push(f));
    loop.start();
    for (let i = 0; i < 30; i++) {
      now += 1000;
      const phase = Math.floor(i / 4) % 2;
      queue = phase === 0 ? 10 : 0;
      await loop.tickOnce();
      if (loop.getState().status === 'halted') break;
    }
    loop.stop();
    const halted = loop.getState().status === 'halted';
    const flipFault = faults.some(f => f.reason === 'flip-rate-ceiling');
    console.log(halted && flipFault ? 'OK' : 'FAIL:halted=' + halted + ',faults=' + JSON.stringify(faults.map(f => f.reason)));
  ")
  if [[ "$out" == OK ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0127 AC#5: adversarial flip-rate halts loop loud (no silent toleration)"
  else
    _CHECK_OUTPUT="ADR-0127 AC#5: $out"
  fi
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# ════════════════════════════════════════════════════════════════════
# AC #6 — partition asymmetric suspends scaling, surfaces partition fault
# ════════════════════════════════════════════════════════════════════
check_adr0127_partition_suspends_scaling() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  local out
  out=$(_adr0127_run_script "
    let now = 0;
    const calls = [];
    const swarm = {
      getAgentsByDomain: () => [],
      getAllAgents: () => [{ id: { id: 'a1', swarmId: 's', type: 'coder', instance: 1 }, name: 'a', type: 'coder', status: 'idle', capabilities: {}, metrics: {}, workload: 0, health: 1, lastHeartbeat: new Date(), topologyRole: 'worker', connections: [] }],
      getAvailableAgents: () => [],
      getMetrics: () => ({}),
      getDomainConfigs: () => new Map(),
      getStatus: () => ({ domains: [{ name: 'core', agentCount: 5, availableAgents: 5, busyAgents: 0, tasksQueued: 10, tasksCompleted: 0 }], metrics: {} }),
      assignTaskToDomain: async () => 'a',
      proposeConsensus: async () => ({}),
      broadcastMessage: async () => {},
      getLastHealthReport: () => ({
        reportId: 'r', timestamp: new Date(), overallHealth: 0,
        domainHealth: new Map(), agentHealth: [], bottlenecks: [], alerts: [],
        metrics: {}, recommendations: [],
        partitionDetected: true,
        queueDepthP50: 0, queueDepthP90: 10, queueDepthP99: 10,
        idleWorkerCount: 1, loadCoV: 0, breachedThreshold: 'none',
        breachDurationMs: 0, pollTimestamp: now,
        flipsInWindow: { scale: 0, topology: 0 },
      }),
    };
    const faults = [];
    const loop = mod.createAdaptiveLoop(
      swarm,
      {
        scaleUp: async (d) => calls.push({ kind: 'up', d }),
        scaleDown: async () => {},
        switchTopology: async () => 'OK',
      },
      { pollIntervalMs: 1000, dampeningWindowMs: 1000, settleWindowMs: 1000, now: () => now },
    );
    loop.on('fault', f => faults.push(f));
    loop.start();
    now += 1000;
    await loop.tickOnce();
    loop.stop();
    const suspended = loop.getState().status === 'suspended';
    const partFault = faults.some(f => f.reason === 'partition-detected');
    const noScale = calls.length === 0;
    console.log(suspended && partFault && noScale ? 'OK' : 'FAIL:suspended=' + suspended + ',partFault=' + partFault + ',calls=' + JSON.stringify(calls));
  ")
  if [[ "$out" == OK ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0127 AC#6: partitionDetected suspends scaling + emits partition fault"
  else
    _CHECK_OUTPUT="ADR-0127 AC#6: $out"
  fi
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# ════════════════════════════════════════════════════════════════════
# AC #7 — topology switch decision emitted on cov-high (mesh target)
# ════════════════════════════════════════════════════════════════════
check_adr0127_cov_high_topology_decision() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  local out
  out=$(_adr0127_run_script "
    let now = 0;
    const calls = [];
    const swarm = {
      getAgentsByDomain: () => [],
      getAllAgents: () => [],
      getAvailableAgents: () => [],
      getMetrics: () => ({}),
      getDomainConfigs: () => new Map(),
      // queen domain saturated (load=1), core idle (load=0) → CoV high
      getStatus: () => ({ domains: [
        { name: 'queen', agentCount: 1, availableAgents: 0, busyAgents: 1, tasksQueued: 0, tasksCompleted: 0 },
        { name: 'core', agentCount: 5, availableAgents: 5, busyAgents: 0, tasksQueued: 0, tasksCompleted: 0 },
      ], metrics: {} }),
      assignTaskToDomain: async () => 'a',
      proposeConsensus: async () => ({}),
      broadcastMessage: async () => {},
    };
    const loop = mod.createAdaptiveLoop(
      swarm,
      {
        scaleUp: async () => {},
        scaleDown: async () => {},
        switchTopology: async (t) => { calls.push({ kind: 'switch', t }); return 'OK'; },
      },
      { pollIntervalMs: 1000, dampeningWindowMs: 2000, settleWindowMs: 100000, now: () => now },
    );
    loop.start();
    for (let i = 0; i < 6; i++) { now += 1000; await loop.tickOnce(); }
    loop.stop();
    const swCount = calls.filter(c => c.kind === 'switch').length;
    console.log(swCount === 1 && calls[0].t === 'mesh' ? 'OK' : 'FAIL:swCount=' + swCount + ',calls=' + JSON.stringify(calls));
  ")
  if [[ "$out" == OK ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0127 AC#7: cov-high triggers exactly one switchTopology(mesh) decision"
  else
    _CHECK_OUTPUT="ADR-0127 AC#7: $out"
  fi
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# ════════════════════════════════════════════════════════════════════
# AC #8 — pre-T10 NOT_IMPLEMENTED return logs and continues, no halt
# ════════════════════════════════════════════════════════════════════
check_adr0127_not_implemented_marker_honoured() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  local out
  out=$(_adr0127_run_script "
    let now = 0;
    const swarm = {
      getAgentsByDomain: () => [],
      getAllAgents: () => [],
      getAvailableAgents: () => [],
      getMetrics: () => ({}),
      getDomainConfigs: () => new Map(),
      getStatus: () => ({ domains: [
        { name: 'queen', agentCount: 1, availableAgents: 0, busyAgents: 1, tasksQueued: 0, tasksCompleted: 0 },
        { name: 'core', agentCount: 5, availableAgents: 5, busyAgents: 0, tasksQueued: 0, tasksCompleted: 0 },
      ], metrics: {} }),
      assignTaskToDomain: async () => 'a',
      proposeConsensus: async () => ({}),
      broadcastMessage: async () => {},
    };
    const applied = [];
    const loop = mod.createAdaptiveLoop(
      swarm,
      {
        scaleUp: async () => {},
        scaleDown: async () => {},
        switchTopology: async () => 'NOT_IMPLEMENTED',
      },
      { pollIntervalMs: 1000, dampeningWindowMs: 2000, settleWindowMs: 100000, now: () => now },
    );
    loop.on('action.applied', a => applied.push(a));
    loop.start();
    for (let i = 0; i < 4; i++) { now += 1000; await loop.tickOnce(); }
    loop.stop();
    const nim = applied.some(a => a.result === 'NOT_IMPLEMENTED');
    const notHalted = loop.getState().status !== 'halted';
    console.log(nim && notHalted ? 'OK' : 'FAIL:nim=' + nim + ',applied=' + JSON.stringify(applied));
  ")
  if [[ "$out" == OK ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0127 AC#8: pre-T10 NOT_IMPLEMENTED marker logged + loop continues"
  else
    _CHECK_OUTPUT="ADR-0127 AC#8: $out"
  fi
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# ════════════════════════════════════════════════════════════════════
# AC #9 — HealthReport ctor carries new T9 fields (source-level check)
# ════════════════════════════════════════════════════════════════════
#
# The behavioural variant (load queen-coordinator.js, call
# monitorSwarmHealth, inspect the report) requires the full transitive
# import chain (queen-coordinator → embedding-constants → @claude-flow/memory)
# to be resolvable at the dist's import path. That chain only resolves
# in the codemodded `/tmp/ruflo-build` environment when packages have been
# rewritten to `@sparkleideas/*` and published to Verdaccio.
#
# In the standalone fork dist, the chain doesn't resolve. We therefore
# do the structural check at source level — the ctor body must reference
# all 10 T9 + partition fields. The behavioural variant is exercised by
# AC #3-8 (which use the loop alone, not the queen ctor).
check_adr0127_health_report_carries_t9_fields() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  local fork_src="/Users/henrik/source/forks/ruflo/v3/@claude-flow/swarm/src/queen-coordinator.ts"
  if [[ ! -f "$fork_src" ]]; then
    _CHECK_OUTPUT="ADR-0127 AC#9: fork queen-coordinator.ts source not present at $fork_src"
    end_ns=$(_ns); _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi
  # Locate the HealthReport ctor and check each field appears.
  local fields="queueDepthP50 queueDepthP90 queueDepthP99 idleWorkerCount loadCoV breachedThreshold breachDurationMs pollTimestamp flipsInWindow partitionDetected"
  local ctor_body
  ctor_body=$(awk '/const report: HealthReport = {/,/^    };/' "$fork_src")
  if [[ -z "$ctor_body" ]]; then
    _CHECK_OUTPUT="ADR-0127 AC#9: HealthReport ctor not found in $fork_src"
    end_ns=$(_ns); _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi
  local missing=()
  local f
  for f in $fields; do
    if ! grep -q "\\b${f}\\b" <<< "$ctor_body"; then
      missing+=("$f")
    fi
  done
  if (( ${#missing[@]} == 0 )); then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0127 AC#9: HealthReport ctor references all 10 T9 + partition fields"
  else
    _CHECK_OUTPUT="ADR-0127 AC#9: HealthReport ctor missing fields — ${missing[*]}"
  fi
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# ════════════════════════════════════════════════════════════════════
# AC #10 — adaptive resolver returns a concrete topology (T10 hand-off)
# ════════════════════════════════════════════════════════════════════
check_adr0127_adaptive_resolver_returns_concrete_topology() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  local out
  out=$(_adr0127_run_script "
    const swarm = {
      getAgentsByDomain: () => [],
      getAllAgents: () => [],
      getAvailableAgents: () => [],
      getMetrics: () => ({}),
      getDomainConfigs: () => new Map(),
      getStatus: () => ({ domains: [
        { name: 'queen', agentCount: 1, availableAgents: 0, busyAgents: 1, tasksQueued: 0, tasksCompleted: 0 },
        { name: 'core', agentCount: 5, availableAgents: 5, busyAgents: 0, tasksQueued: 0, tasksCompleted: 0 },
      ], metrics: {} }),
      assignTaskToDomain: async () => 'a',
      proposeConsensus: async () => ({}),
      broadcastMessage: async () => {},
    };
    const loop = mod.createAdaptiveLoop(swarm, {
      scaleUp: async () => {}, scaleDown: async () => {},
      switchTopology: async () => 'OK',
    });
    const t = await loop.resolveAdaptiveTopology();
    console.log(t !== 'adaptive' && (t === 'mesh' || t === 'hierarchical' || t === 'hierarchical-mesh') ? 'OK:' + t : 'FAIL:' + t);
  ")
  if [[ "$out" == OK:* ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0127 AC#10: adaptive resolver returns concrete topology — ${out#OK:}"
  else
    _CHECK_OUTPUT="ADR-0127 AC#10: $out"
  fi
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}
