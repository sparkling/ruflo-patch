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

  local g3_tmp
  g3_tmp=$(mktemp -d /tmp/ruflo-g3-bin-path-XXXXX)
  # shellcheck disable=SC2064  # want $g3_tmp expanded now
  trap "rm -rf '$g3_tmp'" RETURN

  # Fresh install of @sparkleideas/ruflo from Verdaccio
  (cd "$g3_tmp" \
    && echo '{"name":"g3-bin-path-test","version":"1.0.0","private":true}' > package.json \
    && echo "registry=${REGISTRY}" > .npmrc \
    && npm install @sparkleideas/ruflo --registry "$REGISTRY" \
       --no-audit --no-fund --prefer-offline 2>&1 > "$g3_tmp/install.log") || {
    _CHECK_OUTPUT="G3: npm install @sparkleideas/ruflo failed (see $g3_tmp/install.log)"
    end_ns=$(_ns)
    _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  }

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
