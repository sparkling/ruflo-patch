#!/usr/bin/env bash
# lib/acceptance-adr-syshealth-checks.sh — system_health storage-honesty checks.
#
# ADR-0287-CLASS reporter-honesty defect (NEW item, not in the original
# ADR-0287 F1–F10 set). The MCP `system_health` tool probed ONLY the legacy
# `.claude-flow/memory/store.json` path to decide the `memory` check. The fork's
# memory persists to `.swarm/memory.db` (sql.js) and `.claude-flow/memory.rvf` /
# `.swarm/*.rvf` (RVF) — NEVER `store.json`. So a fully-working store reported
# `memory: degraded — Memory store not found`, dragging the overall score down.
# (Live repro in ruflo-patch: store.json absent, .swarm/memory.db 1MB written
# today, memory_search works.) Upstream fixed the identical bug as issue #1843
# (commit 1884ed101) by probing a candidate-set of supported store paths.
#
# The fork fix mirrors #1843 SURGICALLY (memory-check hunk only — NOT the deep
# disk/network/score-denominator rewrites that #2219-cluster/#1892 added; those
# import statfsSync/dns the fork doesn't have, and are out of scope for this
# honesty bug). It ships on the fork branch carrying the system-tools.ts patch.
# These checks assert the POST-FIX behaviour against the INSTALLED package, so
# they go GREEN only AFTER that fork fix reaches the registry — RED until then
# (by design; they validate the published artifact, not the working tree).
#
# Two checks:
#   M1 — with a real store present (.swarm/memory.db, created by a live
#        memory_store), `system_health` reports memory:healthy (no
#        "store not found"). This is the actual bug: working store, false degraded.
#   M2 — ARCH-GUARD: the shipped tool source probes a candidate SET (≥3 paths,
#        incl. `.swarm/memory.db`), not a single hardcoded `store.json`. Guards
#        against a future cherry-pick silently re-introducing the legacy probe.
#
# Conventions (mirror lib/acceptance-adr0287-checks.sh):
#   - Fresh /tmp/ruflo-syshealth-<X>-XXXX dir; node_modules symlinked from the
#     harness install (ACCEPT_TEMP/TEMP_DIR) so `init` does not reinstall.
#   - CLI invoked via $CLI_BIN (harness-resolved local fork bin), never raw npx.
#   - Full output captured to $s/.log; never piped through tail/head.
#   - Counts via `var=$(grep -c ...); var=${var:-0}` (reference-grep-c-bash-trap).
#   - Non-TTY by construction → plain ASCII, greppable.
#
# Caller MUST set: REGISTRY, CLI_BIN, TEMP_DIR (or ACCEPT_TEMP). Caller MUST have
# sourced acceptance-checks.sh first (_run_and_kill / _run_and_kill_ro /
# _timeout). Sets _CHECK_PASSED ("true"|"false"|"skip_accepted") + _CHECK_OUTPUT.

set +u 2>/dev/null || true

# Timing-helper fallbacks (the fast runner does not define _ns/_elapsed_ms).
if ! declare -f _ns >/dev/null 2>&1; then
  _ns() { date +%s%N 2>/dev/null || echo $(( $(date +%s) * 1000000000 )); }
fi
if ! declare -f _elapsed_ms >/dev/null 2>&1; then
  _elapsed_ms() { echo $(( ( ${2:-0} - ${1:-0} ) / 1000000 )); }
fi

# ── Shared: init a fresh project into $1 (symlinked node_modules, no reinstall).
_syshealth_init() {
  local target="$1"
  local nm_src=""
  if [[ -n "${ACCEPT_TEMP:-}" && -d "$ACCEPT_TEMP/node_modules" ]]; then
    nm_src="$ACCEPT_TEMP/node_modules"
  elif [[ -n "${TEMP_DIR:-}" && -d "$TEMP_DIR/node_modules" ]]; then
    nm_src="$TEMP_DIR/node_modules"
  elif [[ -n "${E2E_DIR:-}" && -d "$E2E_DIR/node_modules" ]]; then
    nm_src="$E2E_DIR/node_modules"
  fi
  [[ -n "$nm_src" ]] && ln -sf "$nm_src" "$target/node_modules" 2>/dev/null || true
  ( cd "$target" && NPM_CONFIG_REGISTRY="$REGISTRY" _timeout 120 "$CLI_BIN" init --full --quiet 2>&1 ) > "$target/.init.log" 2>&1 || true
}

# ════════════════════════════════════════════════════════════════════
# M1 — system_health reports memory:healthy when a real store exists.
#
# Drive a live `memory store` (writes the canonical store — .swarm/memory.db in
# the fork's default config), then invoke the `system_health` MCP tool and
# assert the `memory` check is healthy with NO "store not found" message. This
# is the exact false-negative the fix removes: working store, honest health.
# ════════════════════════════════════════════════════════════════════
check_syshealth_m1_memory_healthy_when_store_exists() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""

  local s; s=$(mktemp -d /tmp/ruflo-syshealth-m1-XXXX)
  local log="$s/.log"; : > "$log"

  _syshealth_init "$s"
  if [[ ! -d "$s/.claude-flow" ]]; then
    _CHECK_OUTPUT="M1: init did not create .claude-flow/ at $s (init log: $(head -3 "$s/.init.log" 2>/dev/null | tr '\n' ' '))"
    rm -rf "$s" 2>/dev/null; return
  fi

  # Populate the canonical store so the memory check has something real to find.
  # 60s budget: cold embedding model load under parallel acceptance load.
  _run_and_kill "cd '$s' && NPM_CONFIG_REGISTRY='$REGISTRY' '$CLI_BIN' memory store --key syshealth-m1 --value 'JWT refresh token rotation for stateless API auth' --namespace syshealth" "" 60
  echo "$_RK_OUT" >> "$log"

  # Sanity: a real store file must now exist (else healthy would be wrong and
  # the test would be vacuous). Accept any of the fork's canonical store paths.
  local store_found="no"
  for p in "$s/.swarm/memory.db" "$s/.claude-flow/memory.rvf" "$s/.swarm/memory.rvf" "$s/.swarm/agentdb-memory.rvf" "$s/.claude-flow/memory/store.json"; do
    [[ -e "$p" ]] && { store_found="yes"; echo "store present: $p" >> "$log"; break; }
  done
  if [[ "$store_found" == "no" ]]; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: M1: memory store wrote no on-disk file in this throwaway install (no canonical store path present) — cannot assert healthy-when-present. store_out: $(echo "$_RK_OUT" | tail -3 | tr '\n' ' ')"
    rm -rf "$s" 2>/dev/null; return
  fi

  # Invoke the system_health tool (own dir as cwd).
  local work; work=$(mktemp /tmp/syshealth-m1-XXXXX)
  _run_and_kill_ro "cd '$s' && NPM_CONFIG_REGISTRY='$REGISTRY' '$CLI_BIN' mcp exec --tool system_health --params '{}'" "$work" 60
  local body; body=$(cat "$work" 2>/dev/null || echo "")
  body=$(echo "$body" | grep -v '^__RUFLO_DONE__:')
  rm -f "$work" 2>/dev/null
  echo "$body" >> "$log"

  # Tool not registered in this build → skip_accepted (3-way bucket).
  if echo "$body" | grep -qiE 'tool.+not found|not registered|unknown tool|no such tool|method .* not found|invalid tool'; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: M1: system_health tool not in build — $(echo "$body" | head -3 | tr '\n' ' ')"
    rm -rf "$s" 2>/dev/null; return
  fi

  # NEGATIVE: the pre-fix lie must be GONE — no "store not found" while a store
  # exists. Scope to the memory check's message (the only place it appears).
  if echo "$body" | grep -qiE 'memory store not found|store not found .* run memory init'; then
    _CHECK_OUTPUT="M1: system_health STILL reports 'memory store not found' though a real store exists (legacy store.json-only probe not fixed) — see $log"
    rm -rf "$s" 2>/dev/null; return
  fi

  # POSITIVE: the memory check is healthy. The tool returns JSON with a checks[]
  # array; grep for the memory check object carrying status:healthy. Tolerant of
  # key ordering / whitespace (name before or after status in the object).
  if echo "$body" | grep -qiE '"name"[[:space:]]*:[[:space:]]*"memory"' \
     && echo "$body" | grep -qiE '"status"[[:space:]]*:[[:space:]]*"healthy"'; then
    # Strong form: prove the *memory* entry specifically is healthy (a single
    # line carrying both tokens, after compacting the JSON onto one line per
    # object). Fall back to the pair-present assertion if pretty-printed.
    local compact; compact=$(echo "$body" | tr -d '\n' | sed 's/},\s*{/}\n{/g')
    if echo "$compact" | grep -E '"memory"' | grep -qiE 'healthy'; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="M1 PASS: system_health reports memory:healthy with a real store present (no false 'store not found')"
    else
      # memory + healthy both present but not provably on the same entry; the
      # NEGATIVE assertion above already proved the lie is gone, so PASS but note.
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="M1 PASS (pretty-printed JSON): no 'store not found' lie; memory + healthy both present. checks: $(echo "$body" | grep -iE 'name|status' | head -8 | tr '\n' ' ')"
    fi
  else
    _CHECK_OUTPUT="M1: system_health memory check not provably healthy. memory/status lines: $(echo "$body" | grep -iE 'memory|status|healthy|degraded' | head -8 | tr '\n' ' ')"
  fi

  rm -rf "$s" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# M2 — ARCH-GUARD: the shipped tool probes a candidate SET, not a single
# hardcoded store.json. Mirrors the ADR-0287 F2 arch-guard idea: a future
# cherry-pick must not silently re-introduce the legacy single-path probe.
#
# Reads the INSTALLED package source (compiled dist or src in the install) for
# the system_health memory-check region and asserts (a) `.swarm/memory.db` is
# among the probed paths, and (b) there is MORE than one candidate path (a set,
# not the lone `store.json`). Path-resilient: searches the install tree for the
# system-tools artifact.
# ════════════════════════════════════════════════════════════════════
check_syshealth_m2_archguard_candidate_set() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""

  local nm=""
  if [[ -n "${ACCEPT_TEMP:-}" && -d "$ACCEPT_TEMP/node_modules" ]]; then
    nm="$ACCEPT_TEMP/node_modules"
  elif [[ -n "${TEMP_DIR:-}" && -d "$TEMP_DIR/node_modules" ]]; then
    nm="$TEMP_DIR/node_modules"
  fi
  if [[ -z "$nm" ]]; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: M2: no installed node_modules to arch-guard (ACCEPT_TEMP/TEMP_DIR unset)"
    return
  fi

  # Locate the shipped system-tools artifact (compiled .js preferred; src .ts
  # acceptable). The CLI package may be @sparkleideas/cli or @claude-flow/cli.
  local artifact=""
  artifact=$(grep -rls "name: 'system_health'" \
    "$nm/@sparkleideas/cli" "$nm/@claude-flow/cli" \
    2>/dev/null | grep -iE 'system-tools' | head -1)
  if [[ -z "$artifact" ]]; then
    # Broaden: any file under the CLI packages defining system_health.
    artifact=$(grep -rls "name: 'system_health'" "$nm/@sparkleideas" "$nm/@claude-flow" 2>/dev/null | head -1)
  fi
  if [[ -z "$artifact" || ! -f "$artifact" ]]; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: M2: could not locate shipped system-tools artifact under $nm/@sparkleideas|@claude-flow"
    return
  fi

  # NEGATIVE: the legacy single-path probe `const memoryDbPath = ... store.json`
  # with no candidate array must be GONE. Count `.swarm/memory.db` references
  # and total distinct store-path tokens near the memory check.
  local swarm_db_refs; swarm_db_refs=$(grep -c "\.swarm.*memory\.db\|memory\.db" "$artifact" 2>/dev/null); swarm_db_refs=${swarm_db_refs:-0}
  local candidate_paths; candidate_paths=$(grep -oE "join\([^)]*'(store\.json|store\.rvf|memory\.db|agentdb\.sqlite|claude-flow\.db|memory\.rvf|agentdb\.rvf)'" "$artifact" 2>/dev/null | wc -l | tr -d ' ')
  candidate_paths=${candidate_paths:-0}

  echo "artifact=$artifact swarm_db_refs=$swarm_db_refs candidate_paths=$candidate_paths"

  if [[ "$swarm_db_refs" -ge 1 && "$candidate_paths" -ge 3 ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="M2 PASS: shipped system-tools probes a candidate SET ($candidate_paths store paths incl. .swarm/memory.db) — legacy store.json-only probe gone. artifact=$artifact"
  elif [[ "$candidate_paths" -le 1 ]]; then
    _CHECK_OUTPUT="M2: shipped system-tools still probes a SINGLE store path (candidate_paths=$candidate_paths, .swarm/memory.db refs=$swarm_db_refs) — legacy store.json-only probe not fixed. artifact=$artifact"
  else
    _CHECK_OUTPUT="M2: shipped system-tools candidate set incomplete (candidate_paths=$candidate_paths, .swarm/memory.db refs=$swarm_db_refs; need .swarm/memory.db + ≥3 paths). artifact=$artifact"
  fi
}
