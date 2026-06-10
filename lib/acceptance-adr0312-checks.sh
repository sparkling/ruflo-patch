#!/usr/bin/env bash
# lib/acceptance-adr0312-checks.sh — ADR-0312 hook-side CJS-helper check.
#
# ADR-0312: router/session/memory hook helpers are CJS (module.exports) but were
# emitted with .js extensions. Under a project whose package.json declares
# "type":"module", Node parses .js as ESM and the load throws → the loader nulls
# the helper → the route hook prints "[INFO] Router not available, using default
# routing" instead of the recommendation box. Fix = emit them as .cjs and have
# hook-handler.mjs resolve .cjs-first (legacy .js fallback).
#
# This check inits a FRESH project, forces "type":"module" into its
# package.json, then runs the route hook with a routable prompt and asserts the
# stdout contains the recommendation box and does NOT contain "Router not
# available". It exercises the ON path (ADR-0312 T3), validating the PUBLISHED
# package — RED until the fork fix ships, GREEN after (by design).
#
# Conventions mirror lib/acceptance-adr0287-checks.sh:
#   - fresh /tmp/ruflo-adr0312-XXXX dir (not _e2e_isolate).
#   - node_modules symlinked from the harness install (no ~440-pkg reinstall).
#   - CLI via $CLI_BIN (never raw npx).
#   - full output to $s/.log (feedback-no-tail-tests).
#   - counts via var=$(grep -c ...); var=${var:-0} (reference-grep-c-bash-trap).
#   - non-TTY by construction → box text is plain ASCII and greppable.
#
# Caller MUST set: REGISTRY, CLI_BIN, TEMP_DIR (or ACCEPT_TEMP). Caller MUST
# have sourced acceptance-checks.sh first (_timeout). Sets _CHECK_PASSED
# ("true"|"false"|"skip_accepted") + _CHECK_OUTPUT.

set +u 2>/dev/null || true

_adr0312_init() {
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
# T3 — route hook renders the recommendation box under "type":"module".
# ════════════════════════════════════════════════════════════════════
check_adr0312_route_hook_type_module() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""

  local s; s=$(mktemp -d /tmp/ruflo-adr0312-XXXX)
  local log="$s/.log"; : > "$log"

  _adr0312_init "$s"

  local handler="$s/.claude/helpers/hook-handler.mjs"
  if [[ ! -f "$handler" ]]; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="no hook-handler.mjs after init (helpers component disabled?) — $s/.init.log"
    rm -rf "$s" 2>/dev/null; return
  fi

  # Force the project into ESM mode — this is the condition that breaks .js
  # helpers. Patch package.json's "type" (init writes one; add if absent).
  node -e '
    const fs=require("fs"),p=process.argv[1]+"/package.json";
    let j={}; try{ j=JSON.parse(fs.readFileSync(p,"utf8")); }catch{}
    j.type="module"; fs.writeFileSync(p, JSON.stringify(j,null,2));
  ' "$s" 2>>"$log" || {
    # init may not write a package.json at all → create a minimal ESM one so
    # the .claude/helpers dir is governed by "type":"module".
    printf '{"name":"adr0312-fixture","type":"module"}\n' > "$s/package.json"
  }

  # Assert the helpers really are .cjs (the fix shipped), else this is the bug.
  local cjs_count
  cjs_count=$(ls "$s/.claude/helpers/router.cjs" "$s/.claude/helpers/session.cjs" "$s/.claude/helpers/memory.cjs" 2>/dev/null | grep -c .)
  cjs_count=${cjs_count:-0}

  # Run the route hook with a routable prompt. The handler reads PROMPT from
  # env/stdin; provide both for robustness. Non-TTY → plain ASCII box.
  local out
  out=$( cd "$s" && PROMPT="implement a new authentication function in TypeScript" \
         _timeout 30 node .claude/helpers/hook-handler.mjs route \
         <<<'{"prompt":"implement a new authentication function in TypeScript"}' 2>&1 )
  printf '%s\n' "$out" >> "$log"

  local has_box not_avail
  has_box=$(printf '%s' "$out" | grep -ciE "Primary Recommendation|Recommendation"); has_box=${has_box:-0}
  not_avail=$(printf '%s' "$out" | grep -ciE "Router not available"); not_avail=${not_avail:-0}

  if [[ "$cjs_count" -eq 3 && "$has_box" -ge 1 && "$not_avail" -eq 0 ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="type:module route hook renders recommendation box; 3 .cjs helpers; 0 'Router not available'"
  else
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="ADR-0312 FAIL: cjs_helpers=$cjs_count/3 box=$has_box 'Router not available'=$not_avail — see $log"
  fi

  rm -rf "$s" 2>/dev/null
}
