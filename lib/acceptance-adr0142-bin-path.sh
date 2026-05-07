# lib/acceptance-adr0142-bin-path.sh — Guard G3 (ADR-0142)
#
# Verifies the published @sparkleideas/ruflo wrapper:
#   (a) installs @sparkleideas/cli into its node_modules (post-pivot only —
#       Phase 1 wrapper has no cli dep, in which case this check passes
#       trivially since the wrapper still functions via its own redirect)
#   (b) the cli's bin/cli.js exists at the expected path
#   (c) `node node_modules/.bin/ruflo --version` exits 0 with non-empty stdout
#
# Lives in a separate temp dir from the main harness's $TEMP_DIR so we get
# a clean install of the wrapper specifically (the main harness installs
# @sparkleideas/cli directly, not the wrapper).
#
# Per memory `reference-cli-cmd-helper.md`: this check intentionally does
# NOT use $(_cli_cmd) because it's testing the wrapper's bin invocation
# directly — the helper's "use installed binary" semantics are exactly
# what we want to verify.

# shellcheck disable=SC2034  # _CHECK_PASSED set as a side-effect of the check function

check_adr0142_bin_path() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"

  # Use shared wrapper-solo install built once at harness boot
  # (scripts/test-acceptance.sh wrapper-solo-install phase, 2026-05-07).
  # Eliminates the per-check 70s npm install + the cache-contention race
  # that drove the original --cache=<isolated> workaround. Falls back to
  # a per-check install if WRAPPER_SOLO_TEMP isn't set (ad-hoc test runs).
  local g3_tmp
  if [[ -n "${WRAPPER_SOLO_TEMP:-}" && -d "${WRAPPER_SOLO_TEMP}/node_modules/@sparkleideas/ruflo" ]]; then
    g3_tmp="$WRAPPER_SOLO_TEMP"
    # NOTE: don't trap-rm — this dir is shared across checks
  else
    g3_tmp=$(mktemp -d /tmp/ruflo-g3-bin-path-XXXXX)
    # shellcheck disable=SC2064  # want $g3_tmp expanded now
    trap "rm -rf '$g3_tmp'" RETURN

    (cd "$g3_tmp" \
      && echo '{"name":"g3-bin-path-test","version":"1.0.0","private":true}' > package.json \
      && echo "registry=${REGISTRY}" > .npmrc \
      && npm install @sparkleideas/ruflo --registry "$REGISTRY" \
         --cache "$g3_tmp/.npm-cache" \
         --no-audit --no-fund --prefer-offline 2>&1 > "$g3_tmp/install.log") || {
      _CHECK_OUTPUT="G3: npm install @sparkleideas/ruflo failed (see $g3_tmp/install.log first 10 lines): $(head -10 "$g3_tmp/install.log" 2>/dev/null | tr '\n' ' ')"
      end_ns=$(_ns)
      _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
      return
    }
  fi

  # (a) wrapper bin exists
  local wrapper_bin="${g3_tmp}/node_modules/.bin/ruflo"
  if [[ ! -x "$wrapper_bin" ]]; then
    _CHECK_OUTPUT="G3: wrapper bin missing at ${wrapper_bin}"
    end_ns=$(_ns)
    _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  # (b) cli's bin/cli.js exists at expected path (only meaningful post-pivot;
  #     pre-pivot wrapper has no cli dep, so the file simply isn't there).
  #     We don't fail when missing pre-pivot — the wrapper's --version still
  #     works via npx-redirect. Post-pivot, this becomes a hard requirement.
  local cli_bin="${g3_tmp}/node_modules/@sparkleideas/cli/bin/cli.js"
  local has_cli_dep="false"
  if [[ -f "${g3_tmp}/node_modules/@sparkleideas/cli/package.json" ]]; then
    has_cli_dep="true"
    if [[ ! -f "$cli_bin" ]]; then
      _CHECK_OUTPUT="G3: post-pivot wrapper missing cli bin at ${cli_bin}"
      end_ns=$(_ns)
      _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
      return
    fi
  fi

  # (c) wrapper boots — `--version` must exit 0 with non-empty output
  local version_out
  version_out=$(_timeout 30 "$wrapper_bin" --version 2>&1) || true
  local rc=$?
  if [[ $rc -ne 0 || -z "$version_out" ]]; then
    _CHECK_OUTPUT="G3: 'ruflo --version' failed (exit=$rc): $(echo "$version_out" | head -3)"
    end_ns=$(_ns)
    _EXIT=$rc; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  _CHECK_PASSED="true"
  if [[ "$has_cli_dep" == "true" ]]; then
    _CHECK_OUTPUT="G3: bin OK (post-pivot — cli at ${cli_bin}); --version: $(echo "$version_out" | head -1)"
  else
    _CHECK_OUTPUT="G3: bin OK (Phase 1 transitional — wrapper has no cli dep yet); --version: $(echo "$version_out" | head -1)"
  fi
  end_ns=$(_ns)
  _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# ════════════════════════════════════════════════════════════════════
# AC#10 (ADR-0142): MCP JSON-RPC round-trip THROUGH the wrapper
#
# Replaces the manual smoke "claude mcp add ruflo -- npx -y
# @sparkleideas/ruflo mcp start; serves JSON-RPC". Per project policy,
# everything via build/deploy scripts — never manual. This automates the
# JSON-RPC half (the "claude mcp add" UX half is Claude Code's, not ours).
#
# Method:
#   1. Fresh install of @sparkleideas/ruflo from Verdaccio (separate dir
#      so concurrent checks don't contend)
#   2. Spawn `node node_modules/.bin/ruflo mcp start` as a subprocess
#      (the SAME invocation Claude Code uses)
#   3. Send a minimal JSON-RPC `initialize` request via stdin
#   4. Read response on stdout within timeout
#   5. PASS if response is well-formed JSON-RPC with matching id +
#      a `result` member (or `error.code` for tool-not-found, which
#      still proves the wrapper imported cli + dispatched MCP mode)
# ════════════════════════════════════════════════════════════════════

check_adr0142_mcp_jsonrpc() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"

  # Use shared wrapper-solo install (built once at harness boot in
  # scripts/test-acceptance.sh wrapper-solo-install phase, 2026-05-07).
  # MCP-JSONRPC check is stateless wrt the install dir — just sends a
  # JSON-RPC initialize over stdin. Falls back to per-check install if
  # WRAPPER_SOLO_TEMP isn't set (ad-hoc test runs).
  local mcp_tmp
  if [[ -n "${WRAPPER_SOLO_TEMP:-}" && -d "${WRAPPER_SOLO_TEMP}/node_modules/@sparkleideas/ruflo" ]]; then
    mcp_tmp="$WRAPPER_SOLO_TEMP"
  else
    mcp_tmp=$(mktemp -d /tmp/ruflo-g3-mcp-jsonrpc-XXXXX)
    # shellcheck disable=SC2064
    trap "rm -rf '$mcp_tmp'" RETURN

    (cd "$mcp_tmp" \
      && echo '{"name":"g3-mcp-jsonrpc-test","version":"1.0.0","private":true}' > package.json \
      && echo "registry=${REGISTRY}" > .npmrc \
      && npm install @sparkleideas/ruflo --registry "$REGISTRY" \
         --cache "$mcp_tmp/.npm-cache" \
         --no-audit --no-fund --prefer-offline 2>&1 > "$mcp_tmp/install.log") || {
      _CHECK_OUTPUT="MCP-JSONRPC: npm install failed (see $mcp_tmp/install.log)"
      end_ns=$(_ns); _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"; return
    }
  fi

  local wrapper_bin="${mcp_tmp}/node_modules/.bin/ruflo"
  if [[ ! -x "$wrapper_bin" ]]; then
    _CHECK_OUTPUT="MCP-JSONRPC: wrapper bin missing at ${wrapper_bin}"
    end_ns=$(_ns); _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"; return
  fi

  # Build a minimal JSON-RPC initialize request. MCP spec 2024-11-05 form.
  local req='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"adr0142-jsonrpc-probe","version":"1.0.0"}}}'
  local resp_log="${mcp_tmp}/jsonrpc-resp.log"

  # Spawn wrapper → cli → MCP server in stdio mode. Send request, capture
  # response, kill on timeout. Exit 124 from `timeout` = SIGTERM after 15s
  # (server kept stdin open waiting for more — that's expected MCP behavior).
  echo "$req" | _timeout 15 "$wrapper_bin" mcp start > "$resp_log" 2>&1 || true

  # Find the JSON-RPC response line. cli prints log lines like
  # "[AgentDB] Telemetry disabled" and "[ruflo-mcp] Starting in stdio mode"
  # before the response. Filter for lines starting with `{"jsonrpc"`.
  local resp_line
  resp_line=$(grep '^{"jsonrpc"' "$resp_log" | head -1)

  if [[ -z "$resp_line" ]]; then
    _CHECK_OUTPUT="MCP-JSONRPC: no JSON-RPC response from wrapper-spawned server. First 15 lines of stdout:
$(head -15 "$resp_log" 2>/dev/null)"
    end_ns=$(_ns); _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"; return
  fi

  # Parse the response and validate shape via node (jq-free).
  local parse_result
  parse_result=$(node -e '
    try {
      const r = JSON.parse(process.argv[1]);
      if (r.jsonrpc !== "2.0") { console.log("BAD_VERSION:" + (r.jsonrpc||"<missing>")); process.exit(0); }
      if (r.id !== 1) { console.log("BAD_ID:" + JSON.stringify(r.id)); process.exit(0); }
      if (r.result) { console.log("OK_RESULT:" + (r.result.serverInfo?.name || r.result.protocolVersion || "result-present")); process.exit(0); }
      if (r.error) { console.log("OK_ERROR_BUT_VALID_RPC:code=" + r.error.code); process.exit(0); }
      console.log("BAD_NEITHER_RESULT_NOR_ERROR");
    } catch (e) { console.log("PARSE_ERROR:" + e.message); }
  ' "$resp_line" 2>&1)

  if [[ "$parse_result" == OK_RESULT:* || "$parse_result" == OK_ERROR_BUT_VALID_RPC:* ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="MCP-JSONRPC PASS: wrapper → cli → MCP server initialize round-trip OK (${parse_result})"
    end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"; return
  fi

  _CHECK_OUTPUT="MCP-JSONRPC: response shape invalid (${parse_result}). Response: ${resp_line:0:300}"
  end_ns=$(_ns); _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}
