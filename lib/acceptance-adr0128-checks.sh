#!/usr/bin/env bash
# lib/acceptance-adr0128-checks.sh — ADR-0128 (T10) topology runtime dispatch
#
# Acceptance for the per-topology coordination protocol that lives at the
# worker-spawn dispatch site in `unified-coordinator.ts`. Each of the six
# advertised topology values must produce a distinct observable coordination
# trace; the dispatch site must throw on unknown topologies and on `adaptive`
# until ADR-0127 (T9) lands.
#
# These checks operate against:
#   - the published @sparkleideas/cli (TOPOLOGIES enum advertised via help/init)
#   - the codemodded swarm dist (`/tmp/ruflo-build/v3/@claude-flow/swarm/...`)
#     — drives the behavioural per-topology assertions
#   - the codemodded CLI dist (`/tmp/ruflo-build/v3/@claude-flow/cli/...`) for
#     the prompt-side topology block
#
# Requires: _cli_cmd, _e2e_isolate from acceptance-harness.sh
# Caller MUST set: REGISTRY, TEMP_DIR (or E2E_DIR)

set +u 2>/dev/null || true

# Cached paths to the codemodded swarm and CLI dists. Discovered once per
# source.
__ADR0128_SWARM_DIST=""
__ADR0128_CLI_DIST=""
_adr0128_resolve_dists() {
  if [[ -z "$__ADR0128_SWARM_DIST" ]]; then
    if [[ -f "/tmp/ruflo-build/v3/@claude-flow/swarm/dist/unified-coordinator.js" ]]; then
      __ADR0128_SWARM_DIST="/tmp/ruflo-build/v3/@claude-flow/swarm/dist/unified-coordinator.js"
    elif [[ -f "/Users/henrik/source/forks/ruflo/v3/@claude-flow/swarm/dist/unified-coordinator.js" ]]; then
      __ADR0128_SWARM_DIST="/Users/henrik/source/forks/ruflo/v3/@claude-flow/swarm/dist/unified-coordinator.js"
    fi
  fi
  if [[ -z "$__ADR0128_CLI_DIST" ]]; then
    if [[ -f "/tmp/ruflo-build/v3/@claude-flow/cli/dist/src/commands/hive-mind.js" ]]; then
      __ADR0128_CLI_DIST="/tmp/ruflo-build/v3/@claude-flow/cli/dist/src/commands/hive-mind.js"
    elif [[ -f "/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/dist/src/commands/hive-mind.js" ]]; then
      __ADR0128_CLI_DIST="/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/dist/src/commands/hive-mind.js"
    fi
  fi
}

# ════════════════════════════════════════════════════════════════════
# AC #1 — TOPOLOGIES enum has all 6 advertised values (CLI surface)
# ════════════════════════════════════════════════════════════════════
#
# Validates the surface contract: `--topology ring` and `--topology star`
# must both resolve via `choices: TOPOLOGIES.map(t => t.value)` at the
# CLI parsing layer (commands/hive-mind.ts:399).
check_adr0128_topologies_enum_six() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _adr0128_resolve_dists

  if [[ -z "$__ADR0128_CLI_DIST" ]]; then
    _CHECK_OUTPUT="ADR-0128 AC#1: CLI dist not present at any known path"
    end_ns=$(_ns); _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  local missing=()
  local t
  for t in hierarchical mesh hierarchical-mesh ring star adaptive; do
    if ! grep -qE "value:\s*['\"]${t}['\"]" "$__ADR0128_CLI_DIST"; then
      missing+=("$t")
    fi
  done

  if (( ${#missing[@]} == 0 )); then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0128 AC#1: all 6 topology values present in TOPOLOGIES enum"
  else
    _CHECK_OUTPUT="ADR-0128 AC#1: TOPOLOGIES enum missing values — ${missing[*]}"
  fi
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# ════════════════════════════════════════════════════════════════════
# AC #2-6 — per-topology dispatch wires correct permissions
# ════════════════════════════════════════════════════════════════════
#
# Each AC runs the swarm dist, calls `dispatchByTopology`, and asserts
# the structural shape of the returned protocol surface.
#
# Helper that runs a node script with the dist preloaded; captures stdout.
_adr0128_run_dispatch() {
  local script="$1"
  _adr0128_resolve_dists
  if [[ -z "$__ADR0128_SWARM_DIST" ]]; then
    echo "DIST_MISSING"
    return 1
  fi
  node --input-type=module -e "$(cat <<NODESCRIPT
import('${__ADR0128_SWARM_DIST}').then(async (mod) => {
  const coord = new mod.UnifiedSwarmCoordinator();
  try {
    ${script}
  } catch (e) {
    console.log('THROWN:' + e.message);
  }
}).catch(e => console.log('IMPORT_FAILED:' + e.message));
NODESCRIPT
)" 2>&1
}

check_adr0128_dispatch_hierarchical_wires_correct_permissions() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  local out
  out=$(_adr0128_run_dispatch "
    const r = await coord.dispatchByTopology({
      topology: 'hierarchical',
      queenAgentId: 'queen-1',
      workerAgentIds: ['w-1', 'w-2', 'w-3'],
    });
    const ok = r.peerVisibility === 'none'
      && r.workers.every(w => w.subscriptionSet.length === 1 && w.subscriptionSet[0] === 'queen-1')
      && r.workers.every(w => w.memoryNamespace.includes('/private/'))
      && r.workers.every(w => w.memoryWriteAllowed === true);
    console.log(ok ? 'OK' : 'FAIL:' + JSON.stringify(r));
  ")
  if [[ "$out" == OK ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0128 hierarchical: queen-only subscriptions + private memory namespace"
  else
    _CHECK_OUTPUT="ADR-0128 hierarchical failed: $out"
  fi
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

check_adr0128_dispatch_mesh_wires_correct_permissions() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  local out
  out=$(_adr0128_run_dispatch "
    const ids = ['w-1', 'w-2', 'w-3', 'w-4'];
    const r = await coord.dispatchByTopology({
      topology: 'mesh',
      queenAgentId: 'queen-1',
      workerAgentIds: ids,
    });
    let totalEdges = 0;
    let ok = r.peerVisibility === 'full';
    for (const w of r.workers) {
      const peers = w.subscriptionSet.filter(s => s !== 'queen-1');
      if (peers.length !== ids.length - 1) { ok = false; break; }
      totalEdges += peers.length;
      if (!w.memoryWriteAllowed) { ok = false; break; }
      if (!w.memoryNamespace.endsWith('/shared')) { ok = false; break; }
    }
    if (totalEdges !== ids.length * (ids.length - 1)) ok = false;
    console.log(ok ? ('OK:edges=' + totalEdges) : 'FAIL:' + JSON.stringify(r));
  ")
  if [[ "$out" == OK:* ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0128 mesh: O(N^2) full peer visibility — ${out#OK:}"
  else
    _CHECK_OUTPUT="ADR-0128 mesh failed: $out"
  fi
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

check_adr0128_dispatch_hierarchical_mesh_wires_correct_permissions() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  local out
  out=$(_adr0128_run_dispatch "
    const r = await coord.dispatchByTopology({
      topology: 'hierarchical-mesh',
      queenAgentId: 'queen-1',
      workerAgentIds: ['w-1','w-2','w-3','w-4','w-5','w-6','w-7'],
    });
    let ok = r.peerVisibility === 'sub-hive-mesh-plus-subqueen-reports';
    if (!Array.isArray(r.subHives) || r.subHives.length === 0) ok = false;
    // sub-queens point upward only to top queen; sub-queen memory is
    // namespaced under /sub/.../summary
    const subQueenIds = (r.subHives || []).map(h => h.subQueenAgentId);
    for (const w of r.workers.filter(w => subQueenIds.includes(w.agentId))) {
      if (!(w.subscriptionSet.length === 1 && w.subscriptionSet[0] === 'queen-1')) { ok = false; break; }
      if (!w.memoryNamespace.includes('/sub/')) { ok = false; break; }
    }
    // recursion-cap probe: dispatching with _recursionDepth=1 must throw
    let capRejected = false;
    try {
      await coord.dispatchByTopology({
        topology: 'hierarchical-mesh',
        queenAgentId: 'queen-1',
        workerAgentIds: ['w-1','w-2','w-3'],
        _recursionDepth: 1,
      });
    } catch (e) {
      if (/recursion cap exceeded/.test(e.message)) capRejected = true;
    }
    if (!capRejected) ok = false;
    console.log(ok ? ('OK:subhives=' + r.subHives.length) : 'FAIL:' + JSON.stringify(r).slice(0, 400));
  ")
  if [[ "$out" == OK:* ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0128 hierarchical-mesh: sub-hive mesh + sub-queen reports + recursion capped — ${out#OK:}"
  else
    _CHECK_OUTPUT="ADR-0128 hierarchical-mesh failed: $out"
  fi
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

check_adr0128_dispatch_ring_wires_correct_permissions() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  local out
  out=$(_adr0128_run_dispatch "
    const ids = ['w-0','w-1','w-2','w-3'];
    const r = await coord.dispatchByTopology({
      topology: 'ring',
      queenAgentId: 'queen-1',
      workerAgentIds: ids,
    });
    let ok = r.peerVisibility === 'previous-neighbour-only';
    for (let i = 0; i < ids.length; i++) {
      const w = r.workers[i];
      if (w.subscriptionSet.length !== 0) { ok = false; break; }
      const predIdx = (i - 1 + ids.length) % ids.length;
      if (w.ringPredecessorKey !== \`hive-mind/queen-1/ring/slot-\${predIdx}\`) { ok = false; break; }
      if (w.ringSuccessorKey !== \`hive-mind/queen-1/ring/slot-\${i}\`) { ok = false; break; }
    }
    console.log(ok ? 'OK' : 'FAIL:' + JSON.stringify(r));
  ")
  if [[ "$out" == OK ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0128 ring: deterministic N-step chain, zero broadcasts"
  else
    _CHECK_OUTPUT="ADR-0128 ring failed: $out"
  fi
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

check_adr0128_dispatch_star_wires_correct_permissions() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  local out
  out=$(_adr0128_run_dispatch "
    const r = await coord.dispatchByTopology({
      topology: 'star',
      queenAgentId: 'queen-1',
      workerAgentIds: ['w-1','w-2','w-3'],
    });
    const ok = r.peerVisibility === 'none'
      && r.workers.every(w => w.subscriptionSet.length === 1 && w.subscriptionSet[0] === 'queen-1')
      && r.workers.every(w => w.memoryWriteAllowed === false)
      && r.workers.every(w => w.memoryNamespace.endsWith('/aggregate'));
    console.log(ok ? 'OK' : 'FAIL:' + JSON.stringify(r));
  ")
  if [[ "$out" == OK ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0128 star: hub-and-spoke, zero worker memory writes"
  else
    _CHECK_OUTPUT="ADR-0128 star failed: $out"
  fi
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# ════════════════════════════════════════════════════════════════════
# AC #7 — adaptive throws not-implemented marker pending T9 (no fallback)
# ════════════════════════════════════════════════════════════════════
check_adr0128_adaptive_throws_pending_t9() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  local out
  out=$(_adr0128_run_dispatch "
    try {
      await coord.dispatchByTopology({
        topology: 'adaptive',
        queenAgentId: 'queen-1',
        workerAgentIds: ['w-1'],
      });
      console.log('FAIL:no-throw');
    } catch (e) {
      if (/adaptive topology dispatch requires T9\\/ADR-0127/.test(e.message)) {
        console.log('OK');
      } else {
        console.log('FAIL:wrong-message:' + e.message);
      }
    }
  ")
  if [[ "$out" == OK ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0128 adaptive: throws not-implemented marker pending T9 (no silent fallback)"
  else
    _CHECK_OUTPUT="ADR-0128 adaptive failed: $out"
  fi
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# ════════════════════════════════════════════════════════════════════
# AC #8 — unknown topology throws (no silent fallback to hierarchical-mesh)
# ════════════════════════════════════════════════════════════════════
check_adr0128_unknown_topology_throws() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  local out
  out=$(_adr0128_run_dispatch "
    try {
      await coord.dispatchByTopology({
        topology: 'centralized',
        queenAgentId: 'queen-1',
        workerAgentIds: ['w-1'],
      });
      console.log('FAIL:no-throw');
    } catch (e) {
      if (/unknown topology/.test(e.message)) {
        console.log('OK');
      } else {
        console.log('FAIL:wrong-message:' + e.message);
      }
    }
  ")
  if [[ "$out" == OK ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0128 unknown-topology: throws (no silent fallback)"
  else
    _CHECK_OUTPUT="ADR-0128 unknown-topology failed: $out"
  fi
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# ════════════════════════════════════════════════════════════════════
# AC #9 — queen prompt carries topology-specific protocol block per topology
# ════════════════════════════════════════════════════════════════════
#
# Verifies the published CLI's compiled prompt path inlines a
# topology-specific block (rather than the bare `🔗 Topology: ${topology}`
# substring). Each of the 6 topology values must appear as a switch case
# in the rendered protocol-block function.
check_adr0128_prompt_protocol_block_per_topology() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _adr0128_resolve_dists

  if [[ -z "$__ADR0128_CLI_DIST" ]]; then
    _CHECK_OUTPUT="ADR-0128 AC#9: CLI dist not present"
    end_ns=$(_ns); _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  if ! grep -q "renderTopologyProtocolBlock" "$__ADR0128_CLI_DIST"; then
    _CHECK_OUTPUT="ADR-0128 AC#9: renderTopologyProtocolBlock symbol absent from compiled CLI"
    end_ns=$(_ns); _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  local missing=()
  local t
  for t in hierarchical mesh hierarchical-mesh ring star adaptive; do
    # `case 'X':` survives TS-to-JS compilation as `case "X":`
    if ! grep -qE "case\s+['\"]${t}['\"]" "$__ADR0128_CLI_DIST"; then
      missing+=("$t")
    fi
  done

  if (( ${#missing[@]} == 0 )); then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0128 AC#9: all 6 topology cases rendered + renderTopologyProtocolBlock present"
  else
    _CHECK_OUTPUT="ADR-0128 AC#9: prompt block missing topology cases — ${missing[*]}"
  fi
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}
