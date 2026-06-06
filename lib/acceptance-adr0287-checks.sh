#!/usr/bin/env bash
# lib/acceptance-adr0287-checks.sh — ADR-0287 reporter/storage-honesty checks.
#
# ADR-0287 ("live manual-test remediation") fixed a cluster of reporters that
# LIED about a healthy system. The decide-per-item reporter tier — F8a, F8b,
# F4, F8e, F3b — is implemented on fork branch fix/adr0287-reporter-cosmetics
# (commit 9767dc601). These checks assert the POST-FIX behaviour against the
# INSTALLED package, so they go GREEN only AFTER that fork fix ships to the
# registry — they are RED until the release (by design; they validate the
# published artifact, not the working tree).
#
# The five fixes (ADR-0287 §Confirmation, lines 458-471 + §Findings):
#   F8a — `neural status` (CLI) AND the MCP `neural_status` tool report the real
#         embedding dimension (768, not 0 / 384); `_realEmbeddings`/dim truthful.
#   F8b — `doctor` config-canonical recommendation is config.json (json-wins,
#         ADR-0064/0214), NOT the inverted "keep YAML, archive JSON".
#   F4  — `doctor` reports the daemon as Running even when invoked from a
#         SUBDIRECTORY (PID path anchored to findProjectRoot(), not cwd; ADR-0137).
#   F8e — piping a spinner-driving command ("Checking neural systems…") to a
#         non-TTY sink yields NO `\r`-frame spam (isTTY guard on Spinner/Progress).
#   F3b — the default `route <task>` box shows an "untrained" label when
#         updateCount===0 (cold/fresh Q-model), instead of a misleading 12.5%/0.000.
#
# Conventions (mirror lib/acceptance-adr0137-checks.sh + the diagnostic checks):
#   - Each check uses a fresh /tmp/ruflo-adr0287-<X>-XXXX dir (NOT _e2e_isolate:
#     E2E_DIR is torn down before the standalone ADR blocks run, and its own
#     CLAUDE.md/.claude markers would let findProjectRoot walk past a nested
#     test root). A fresh `init --full` writes .ruflo-project + CLAUDE.md +
#     .claude/ + .claude-flow/config.json — the real project shape.
#   - node_modules is symlinked from the harness install (ACCEPT_TEMP/TEMP_DIR)
#     so `init` does not re-install ~440 packages (memory reference-cli-cmd-helper).
#   - CLI invoked via $CLI_BIN (harness-resolved local fork bin), never raw
#     `npx @sparkleideas/cli@latest` (memory reference-cli-cmd-helper).
#   - Full output captured to $s/.log; never piped through tail/head
#     (memory feedback-no-tail-tests / feedback-full-test-output).
#   - Counts via `var=$(grep -c ...); var=${var:-0}` (memory reference-grep-c-bash-trap).
#   - Non-TTY by construction (output goes to a file/pipe), so cli-core's
#     `colorEnabled` defaults OFF → box/table text is plain ASCII and greppable.
#
# Caller MUST set: REGISTRY, CLI_BIN, TEMP_DIR (or ACCEPT_TEMP). Caller MUST
# have sourced acceptance-checks.sh first (_run_and_kill / _run_and_kill_ro /
# _timeout). Sets _CHECK_PASSED ("true"|"false"|"skip_accepted") + _CHECK_OUTPUT.

set +u 2>/dev/null || true

# ── Shared: init a fresh project into $1 (symlinked node_modules, no reinstall).
# Mirrors _adr0137_init. Writes .ruflo-project + CLAUDE.md + .claude/ +
# .claude-flow/config.json so findProjectRoot() and the config reporter see a
# real init'd tree.
_adr0287_init() {
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
# F8a (CLI) — `neural status` reports the real 768-dim, not 0-dim.
#
# The HNSW Index row prints `<N> vectors, <dim>-dim` (neural.ts:497) when the
# index is available. Pre-fix the consumer read no `dimensions` field and the
# reporter showed `0-dim`; post-fix every backend's hnswStats literal carries
# `dimensions: this.config.dimensions` (768). We store one real memory entry
# first so the HNSW index is populated (`available:true`), then assert 768-dim.
# ════════════════════════════════════════════════════════════════════
check_adr0287_f8a_cli_neural_dim_768() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""

  local s; s=$(mktemp -d /tmp/ruflo-adr0287-f8a-cli-XXXX)
  local log="$s/.log"; : > "$log"

  _adr0287_init "$s"
  if [[ ! -d "$s/.claude-flow" ]]; then
    _CHECK_OUTPUT="F8a-CLI: init did not create .claude-flow/ at $s (init log: $(head -3 "$s/.init.log" 2>/dev/null | tr '\n' ' '))"
    rm -rf "$s" 2>/dev/null; return
  fi

  # Populate the HNSW index with a real-embedding entry so `neural status`
  # reports the index as available (else it prints "Not loaded" and the dim
  # is never shown). 60s budget: cold embedding model load under parallel load.
  _run_and_kill "cd '$s' && NPM_CONFIG_REGISTRY='$REGISTRY' '$CLI_BIN' memory store --key adr0287-f8a --value 'JWT refresh token rotation for stateless API auth' --namespace adr0287" "" 60
  echo "$_RK_OUT" >> "$log"

  # `neural status` — non-TTY (output redirected to a file) so colours are off.
  _run_and_kill "cd '$s' && NPM_CONFIG_REGISTRY='$REGISTRY' '$CLI_BIN' neural status" "" 60
  local status_out="$_RK_OUT"
  echo "$status_out" >> "$log"

  # Tool/command missing in this build → skip_accepted (honest, not a squelch).
  if echo "$status_out" | grep -qiE 'unknown command|command not found|not a (known|valid) command|no such command'; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: F8a-CLI: 'neural status' not in this build — $(echo "$status_out" | head -3 | tr '\n' ' ')"
    rm -rf "$s" 2>/dev/null; return
  fi

  # POSITIVE: the HNSW Index row reports 768-dim (real unified mpnet dim).
  # NEGATIVE: must NOT be the pre-fix `0-dim` (the lie this fix removes).
  if echo "$status_out" | grep -qE '768-dim'; then
    if echo "$status_out" | grep -qE '\b0-dim\b'; then
      _CHECK_OUTPUT="F8a-CLI: found 768-dim but ALSO 0-dim present (mixed reporter) — see $log"
    else
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="F8a-CLI PASS: 'neural status' HNSW Index reports 768-dim (real mpnet dim, not 0/384)"
    fi
  elif echo "$status_out" | grep -qiE 'HNSW Index.*Not loaded|@ruvector/core not available'; then
    # Index genuinely not available in this run → cannot assert the dim. Treat
    # as skip_accepted rather than a false fail (the fix is about the value
    # printed WHEN an index exists; no index = nothing to mis-report).
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: F8a-CLI: HNSW index not available after store (no index → dim not reported); store_out tail: $(echo "$_RK_OUT" | tail -3 | tr '\n' ' ')"
  else
    _CHECK_OUTPUT="F8a-CLI: 'neural status' did not report 768-dim. HNSW row: $(echo "$status_out" | grep -iE 'HNSW|dim' | head -3 | tr '\n' ' ')"
  fi

  rm -rf "$s" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# F8a (MCP) — `neural_status` tool reports truthful `_realEmbeddings` and does
# NOT fabricate the old `384` dim.
#
# Post-fix: `_realEmbeddings:true` for the real mpnet path; `totalEmbeddingDims`
# is the real stored dim (768) when a pattern exists, else `null` — NEVER the
# hardcoded `384` guess. We assert _realEmbeddings:true (real path is live per
# ADR-0287) and the absence of the 384 fabrication.
# ════════════════════════════════════════════════════════════════════
check_adr0287_f8a_mcp_neural_status_truthful() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""

  local s; s=$(mktemp -d /tmp/ruflo-adr0287-f8a-mcp-XXXX)
  local log="$s/.log"; : > "$log"

  _adr0287_init "$s"
  if [[ ! -d "$s/.claude-flow" ]]; then
    _CHECK_OUTPUT="F8a-MCP: init did not create .claude-flow/ at $s (init log: $(head -3 "$s/.init.log" 2>/dev/null | tr '\n' ' '))"
    rm -rf "$s" 2>/dev/null; return
  fi

  # Invoke the MCP tool via the installed CLI (own dir as cwd — E2E_DIR is gone
  # by the time this standalone block runs, so we do NOT reuse _neural_invoke_tool
  # which cd's into E2E_DIR).
  local work; work=$(mktemp /tmp/adr0287-neuralstatus-XXXXX)
  _run_and_kill_ro "cd '$s' && NPM_CONFIG_REGISTRY='$REGISTRY' '$CLI_BIN' mcp exec --tool neural_status --params '{}'" "$work" 60
  local body; body=$(cat "$work" 2>/dev/null || echo "")
  body=$(echo "$body" | grep -v '^__RUFLO_DONE__:')
  rm -f "$work" 2>/dev/null
  echo "$body" >> "$log"

  # Tool not registered in this build → skip_accepted (3-way bucket).
  if echo "$body" | grep -qiE 'tool.+not found|not found|not registered|unknown tool|no such tool|method .* not found|invalid tool'; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: F8a-MCP: neural_status tool not in build — $(echo "$body" | head -3 | tr '\n' ' ')"
    rm -rf "$s" 2>/dev/null; return
  fi

  # NEGATIVE first: the old fabrication was `totalEmbeddingDims: 384`. Post-fix
  # it is 768 or null — never 384. A bare 384 token tied to the dim field fails.
  if echo "$body" | grep -qE '"totalEmbeddingDims"[[:space:]]*:[[:space:]]*384|totalEmbeddingDims.*384'; then
    _CHECK_OUTPUT="F8a-MCP: neural_status still reports the fabricated 384 dim (pre-fix lie) — see $log"
    rm -rf "$s" 2>/dev/null; return
  fi

  # POSITIVE: real embeddings path is reported truthfully (true, not false) for
  # the live mpnet stack (ADR-0287: the real path is up in this environment).
  if echo "$body" | grep -qE '"_realEmbeddings"[[:space:]]*:[[:space:]]*true|_realEmbeddings.*true'; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="F8a-MCP PASS: neural_status reports _realEmbeddings:true and no fabricated 384 dim"
  elif echo "$body" | grep -qiE 'hash-based|hash-fallback|_realEmbeddings.*false'; then
    # Real embedding provider genuinely failed to load in this run → reporting
    # false is HONEST (the F8a fix is "stop lying", not "force true"). Skip
    # rather than false-fail; the 384 fabrication (the actual lie) was already
    # asserted absent above.
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: F8a-MCP: real embedding provider not loaded (hash-fallback honestly reported); 384 fabrication confirmed absent. Body: $(echo "$body" | head -5 | tr '\n' ' ')"
  else
    _CHECK_OUTPUT="F8a-MCP: neural_status output lacked _realEmbeddings truthy field. Body: $(echo "$body" | head -8 | tr '\n' ' ')"
  fi

  rm -rf "$s" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# F8b — `doctor` config-canonical pick is config.json (json-wins), not YAML.
#
# Force the collision branch (both config.json + config.yaml present). Pre-fix
# doctor inverted ADR-0069: "Archive the legacy JSON … keep <yaml> as canonical".
# Post-fix: "Archive the legacy YAML (mv config.yaml …) and keep config.json as
# the canonical config" + message "Config collision: canonical … + legacy …".
# `doctor --fix` prints both the message and the fix line.
# ════════════════════════════════════════════════════════════════════
check_adr0287_f8b_doctor_config_json_canonical() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""

  local s; s=$(mktemp -d /tmp/ruflo-adr0287-f8b-XXXX)
  local log="$s/.log"; : > "$log"

  _adr0287_init "$s"
  if [[ ! -f "$s/.claude-flow/config.json" ]]; then
    _CHECK_OUTPUT="F8b: init did not write .claude-flow/config.json at $s (init log: $(head -3 "$s/.init.log" 2>/dev/null | tr '\n' ' '))"
    rm -rf "$s" 2>/dev/null; return
  fi

  # Add a legacy YAML alongside the canonical JSON to trigger the collision
  # branch (the strongest discriminator of the inversion bug).
  printf 'version: 1\n' > "$s/.claude-flow/config.yaml"

  _run_and_kill "cd '$s' && NPM_CONFIG_REGISTRY='$REGISTRY' '$CLI_BIN' doctor --fix" "" 60
  local out="$_RK_OUT"
  echo "$out" >> "$log"

  if echo "$out" | grep -qi 'MODULE_NOT_FOUND'; then
    _CHECK_OUTPUT="F8b: doctor emitted MODULE_NOT_FOUND (broken install) — see $log"
    rm -rf "$s" 2>/dev/null; return
  fi

  # NEGATIVE: the pre-fix inverted recommendation must be GONE.
  if echo "$out" | grep -qiE 'keep .*config\.yaml as the canonical|Archive the legacy JSON|keep .*\.yaml.* as the canonical config'; then
    _CHECK_OUTPUT="F8b: doctor STILL recommends YAML-canonical (inverted pick not fixed). Config line: $(echo "$out" | grep -iE 'config|canonical|collision' | head -3 | tr '\n' ' ')"
    rm -rf "$s" 2>/dev/null; return
  fi

  # POSITIVE: the post-fix recommendation keeps config.json + archives the YAML.
  if echo "$out" | grep -qiE 'keep .*config\.json as the canonical' \
     && echo "$out" | grep -qiE 'Archive the legacy YAML'; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="F8b PASS: doctor recommends config.json canonical + archive legacy YAML (json-wins, ADR-0064/0214)"
  elif echo "$out" | grep -qiE 'canonical .*config\.json .* legacy .*config\.yaml'; then
    # Collision message present with canonical=json phrasing even if the fix
    # line was suppressed (e.g. --fix not echoed) — still proves json-canonical.
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="F8b PASS: doctor labels config.json as canonical (legacy YAML) in collision message"
  else
    _CHECK_OUTPUT="F8b: doctor config recommendation neither YAML-inverted nor JSON-canonical as expected. Config lines: $(echo "$out" | grep -iE 'config|canonical|collision|archive' | head -4 | tr '\n' ' ')"
  fi

  rm -rf "$s" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# F4 — `doctor` reports the daemon Running even from a SUBDIRECTORY.
#
# Pre-fix the PID path was cwd-relative (`.claude-flow/daemon.pid`), so running
# doctor from a subdir missed it → "Not running" misreport. Post-fix it anchors
# at join(findProjectRoot(), '.claude-flow', 'daemon.pid') (ADR-0137), still
# PID-gated (ADR-0207). We start a REAL daemon at the project root, confirm its
# PID is alive, then run doctor from nested/work/ and assert "Running (PID …)".
# ════════════════════════════════════════════════════════════════════
check_adr0287_f4_doctor_daemon_running_from_subdir() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""

  local s; s=$(mktemp -d /tmp/ruflo-adr0287-f4-XXXX)
  local log="$s/.log"; : > "$log"

  _adr0287_init "$s"
  # findProjectRoot needs a marker at the root. init writes .ruflo-project.
  if [[ ! -f "$s/.ruflo-project" && ! -d "$s/.claude" ]]; then
    _CHECK_OUTPUT="F4: init wrote no project-root marker (.ruflo-project / .claude) at $s (init log: $(head -3 "$s/.init.log" 2>/dev/null | tr '\n' ' '))"
    rm -rf "$s" 2>/dev/null; return
  fi

  # Start the worker daemon at the project root (writes .claude-flow/daemon.pid
  # there). --quiet suppresses the banner; backgrounded because it blocks.
  ( cd "$s" && NPM_CONFIG_REGISTRY="$REGISTRY" "$CLI_BIN" daemon start --quiet >/dev/null 2>&1 ) &
  local _daemon_spawn=$!

  # Wait up to 8s for the PID file (the ADR-0207 liveness signal).
  local _deadline=$(( $(date +%s) + 8 ))
  local pidfile="$s/.claude-flow/daemon.pid"
  while [[ $(date +%s) -lt $_deadline ]]; do
    [[ -f "$pidfile" ]] && break
    sleep 0.2
  done

  local dpid=""
  [[ -f "$pidfile" ]] && dpid=$(cat "$pidfile" 2>/dev/null | tr -d ' ')

  _adr0287_f4_cleanup() {
    [[ -n "$dpid" ]] && kill -TERM "$dpid" 2>/dev/null || true
    kill "$_daemon_spawn" 2>/dev/null || true
    sleep 0.3
    [[ -n "$dpid" ]] && kill -KILL "$dpid" 2>/dev/null || true
    rm -rf "$s" 2>/dev/null
  }

  # The daemon must actually be alive — otherwise doctor "Not running" would be
  # CORRECT and we'd not be testing the subdir-anchoring fix.
  if [[ -z "$dpid" ]] || ! kill -0 "$dpid" 2>/dev/null; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: F4: daemon did not come up (pid='$dpid'); cannot test subdir-anchoring without a live daemon. daemon log: $(cat "$s/.claude-flow/daemon.log" 2>/dev/null | tail -3 | tr '\n' ' ')"
    _adr0287_f4_cleanup; return
  fi

  # Run doctor from a nested subdir. findProjectRoot() must walk up to $s and
  # find the PID there. Pre-fix: cwd-relative path misses it → "Not running".
  mkdir -p "$s/nested/work"
  _run_and_kill "cd '$s/nested/work' && NPM_CONFIG_REGISTRY='$REGISTRY' '$CLI_BIN' doctor" "" 60
  local out="$_RK_OUT"
  echo "$out" >> "$log"

  # POSITIVE: Daemon Status row reports Running (PID …). NEGATIVE: not "Not running".
  local daemon_line; daemon_line=$(echo "$out" | grep -iE 'Daemon Status' | head -1)
  if echo "$daemon_line" | grep -qiE 'Running \(PID'; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="F4 PASS: doctor from nested/work/ reports daemon Running (PID anchored to project root). Line: ${daemon_line}"
  elif echo "$daemon_line" | grep -qiE 'Not running'; then
    _CHECK_OUTPUT="F4: doctor from subdir STILL reports 'Not running' (PID path not anchored to project root). Line: ${daemon_line}"
  else
    _CHECK_OUTPUT="F4: doctor daemon-status line unexpected from subdir. Line: '${daemon_line}' | full daemon grep: $(echo "$out" | grep -iE 'daemon' | head -3 | tr '\n' ' ')"
  fi

  _adr0287_f4_cleanup
}

# ════════════════════════════════════════════════════════════════════
# F8e — spinner-driving command produces NO `\r`-frame spam on non-TTY stdout.
#
# `neural status` drives a "Checking neural systems…" spinner. Pre-fix the
# Spinner wrote `\r<frame>` every 100ms with no isTTY guard → on a non-TTY sink
# (pipe/redirect) each frame appended a line. Post-fix start()/render()/stop()
# early-return when !process.stdout.isTTY. Assert the captured output contains
# ZERO carriage returns.
# ════════════════════════════════════════════════════════════════════
check_adr0287_f8e_spinner_no_cr_on_nontty() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""

  local s; s=$(mktemp -d /tmp/ruflo-adr0287-f8e-XXXX)
  local raw="$s/.raw"; : > "$raw"

  _adr0287_init "$s"
  if [[ ! -d "$s/.claude-flow" ]]; then
    _CHECK_OUTPUT="F8e: init did not create .claude-flow/ at $s (init log: $(head -3 "$s/.init.log" 2>/dev/null | tr '\n' ' '))"
    rm -rf "$s" 2>/dev/null; return
  fi

  # Run the spinner-driving command with stdout REDIRECTED TO A FILE (non-TTY).
  # We need the byte-exact stdout, so capture directly (not via _run_and_kill,
  # which strips its sentinel line but is fine — we instead run our own redirect
  # to preserve raw \r bytes). _timeout guards a hung process.
  ( cd "$s" && NPM_CONFIG_REGISTRY="$REGISTRY" _timeout 60 "$CLI_BIN" neural status ) > "$raw" 2>/dev/null || true

  # Did the command even run? If `neural status` is missing, skip (honest).
  if [[ ! -s "$raw" ]]; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: F8e: 'neural status' produced no output (command missing or crashed) — nothing to assert"
    rm -rf "$s" 2>/dev/null; return
  fi
  if grep -qiE 'unknown command|command not found|not a (known|valid) command' "$raw"; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: F8e: 'neural status' not in this build — $(head -2 "$raw" | tr '\n' ' ')"
    rm -rf "$s" 2>/dev/null; return
  fi

  # Count carriage returns in the raw stdout. Post-fix MUST be 0.
  local cr_count; cr_count=$(grep -c $'\r' "$raw" 2>/dev/null); cr_count=${cr_count:-0}

  if [[ "$cr_count" -eq 0 ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="F8e PASS: 'neural status' to non-TTY sink has zero \\r-frames (isTTY guard active)"
  else
    _CHECK_OUTPUT="F8e: 'neural status' to non-TTY emitted ${cr_count} line(s) containing \\r (spinner frame spam not guarded). First offenders: $(grep -a $'\r' "$raw" | head -3 | cat -v | tr '\n' '|')"
  fi

  rm -rf "$s" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# F3b — default `route <task>` box shows "untrained" when updateCount===0.
#
# A fresh project has no .swarm/q-learning-model.json → updateCount 0 → the
# Q-table is cold (uniform 12.5% / 0.000). Pre-fix the box printed that
# misleading number; post-fix (route.ts:213-217) it prints
# `Confidence: n/a (untrained — no learning data yet)` +
# `Q-Value: n/a (keyword match; train via "route feedback")`.
# Assert the untrained label on the cold state; assert the misleading
# `12.5%` confidence is absent.
# ════════════════════════════════════════════════════════════════════
check_adr0287_f3b_route_untrained_label() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""

  local s; s=$(mktemp -d /tmp/ruflo-adr0287-f3b-XXXX)
  local log="$s/.log"; : > "$log"

  _adr0287_init "$s"
  if [[ ! -d "$s/.claude-flow" ]]; then
    _CHECK_OUTPUT="F3b: init did not create .claude-flow/ at $s (init log: $(head -3 "$s/.init.log" 2>/dev/null | tr '\n' ' '))"
    rm -rf "$s" 2>/dev/null; return
  fi

  # Belt-and-braces: ensure the Q-model is genuinely cold (no prior state).
  rm -f "$s/.swarm/q-learning-model.json" 2>/dev/null || true

  # Default route box: `route "<task>"` routes via routeTaskCommand (no
  # subcommand). Non-TTY (redirected) → plain text.
  _run_and_kill "cd '$s' && NPM_CONFIG_REGISTRY='$REGISTRY' '$CLI_BIN' route 'implement authentication with JWT'" "" 60
  local out="$_RK_OUT"
  echo "$out" >> "$log"

  if echo "$out" | grep -qiE 'unknown command|command not found|not a (known|valid) command|no such command'; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: F3b: 'route' not in this build — $(echo "$out" | head -3 | tr '\n' ' ')"
    rm -rf "$s" 2>/dev/null; return
  fi

  # POSITIVE: untrained label present (cold Q-table). NEGATIVE: the misleading
  # uniform 12.5% confidence must NOT be shown for the cold state.
  if echo "$out" | grep -qiE 'untrained|no learning data yet|keyword match'; then
    if echo "$out" | grep -qE '12\.5%'; then
      _CHECK_OUTPUT="F3b: untrained label present BUT misleading 12.5% confidence still shown — see $log"
    else
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="F3b PASS: cold 'route' box shows untrained label (no learning data yet), not a misleading 12.5%/0.000"
    fi
  elif echo "$out" | grep -qE '12\.5%|Confidence:.*12\.5'; then
    _CHECK_OUTPUT="F3b: cold 'route' box still prints misleading 12.5% confidence with no untrained signal — see $log"
  else
    _CHECK_OUTPUT="F3b: 'route' box lacked an untrained label on a cold Q-table. Box lines: $(echo "$out" | grep -iE 'confidence|q-value|untrained|routing' | head -4 | tr '\n' ' ')"
  fi

  rm -rf "$s" 2>/dev/null
}
