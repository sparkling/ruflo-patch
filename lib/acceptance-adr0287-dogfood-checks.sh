#!/usr/bin/env bash
# lib/acceptance-adr0287-dogfood-checks.sh — ADR-0287 T1-silo + F1 dogfood checks.
#
# These assert THIS repo's OWN checked-in dogfood config (ruflo-patch/.claude/ +
# settings.json), NOT a fresh-init'd project. The fresh-init template is already
# clean — the generator emits no RVF silo and no Stop->sync wire
# (helpers-generator.ts generateAutoMemoryHook + settings-generator.ts:566-574,
# fork b35b85a69). The divergence ADR-0287 items 3+4 flag lives ONLY in
# ruflo-patch's stale dogfood, so we grep $PROJECT_DIR directly.
# (acceptance-adr0287-checks.sh covers the INSTALLED reporters against a fresh
# init — F8a/F8b/F4/F8e/F3b; THIS file covers the dogfood drift T1+F1.)
#
#   T1-silo (a) — the dogfood auto-memory-hook.mjs no longer instantiates an
#                 `.swarm/agentdb-memory.rvf` silo backend: createBackend is
#                 JSON-only, so the SessionStart `import` hook regenerates no
#                 silo .rvf. (The silo was written in-process and was invisible
#                 to memory_search; ADR-0287 T1, lines 192-209.)
#   T1-silo (b) — settings.json has NO Stop hook wiring the removed `sync`
#                 subcommand (ADR-0083 Wave 2 removed `sync`; the generated
#                 template emits no Stop key at all). The stale wire printed
#                 `Usage: <import|status>` + exit 1 on every assistant turn.
#   F1          — MCP_TIMEOUT=60000 is present in a launch env Claude Code reads
#                 into its OWN process: user ~/.claude/settings.json top-level
#                 env OR this repo's project .claude/settings.json top-level env.
#                 It is NOT honored from .mcp.json per-server env (that goes to
#                 the spawned server, not the client that owns the connect-wait;
#                 ADR-0287 lines 221/244).
#
# Conventions (mirror lib/acceptance-adr0287-checks.sh + the diagnostic checks):
#   - Pure greps of the checked-out tree; NO init, NO Verdaccio, NO CLI spawn,
#     no node_modules — these are static dogfood-state assertions, server-less.
#   - Counts via `var=$(grep -c ...); var=${var:-0}` (memory reference-grep-c-bash-trap).
#   - Each check sets _CHECK_PASSED ("true"|"false") + _CHECK_OUTPUT. No
#     skip_accepted path: the files are always present in this repo, and a
#     missing file is a genuine FAIL (the dogfood is the subject under test).
#
# Caller MUST set: PROJECT_DIR (repo root — set by test-acceptance.sh:74). Caller
# MUST have sourced acceptance-checks.sh / the harness first (for the _CHECK_*
# protocol). Server-less; no REGISTRY / CLI_BIN / ACCEPT_TEMP needed.

set +u 2>/dev/null || true

# ════════════════════════════════════════════════════════════════════
# T1-silo (a) — dogfood hook instantiates NO agentdb-memory.rvf silo backend.
#
# Post-fix createBackend() returns only `{ backend: new JsonFileBackend(...) }`
# and never touches `.swarm/agentdb-memory.rvf` / memPkg.RvfBackend /
# memPkg.AgentDBBackend. We assert the silo is gone two ways:
#   NEGATIVE — the `agentdb-memory.rvf` path literal and the
#              `new memPkg.RvfBackend(...)` / `new memPkg.AgentDBBackend(...)`
#              instantiations are ABSENT from the hook source.
#   POSITIVE — createBackend still returns a JsonFileBackend (the JSON store the
#              template uses + doStatus() reports), so the import path is intact.
# Static-source assertion (not "trigger Stop then ls") because the silo is
# written by the SessionStart `import` path, not Stop, and a runtime probe of a
# live-session hook is non-deterministic; the JSON-only source IS the end-state.
# ════════════════════════════════════════════════════════════════════
check_adr0287_t1_no_rvf_silo_in_dogfood_hook() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""

  local hook="$PROJECT_DIR/.claude/helpers/auto-memory-hook.mjs"
  if [[ ! -f "$hook" ]]; then
    _CHECK_OUTPUT="T1a FAIL: dogfood hook not found at $hook"
    return
  fi

  # NEGATIVE: the silo path literal + the RVF/AgentDB backend instantiations,
  # in ACTIVE CODE only. The post-fix patch adds an explanatory comment that
  # legitimately mentions the retired `.swarm/agentdb-memory.rvf` path, so we
  # drop `//`-comment lines before matching (else the doc comment false-fails).
  # Active-code signal = the `agentdb-memory.rvf` path used in a join() / string
  # literal, or a `new memPkg.RvfBackend(` / `new memPkg.AgentDBBackend(`.
  local _silo_re="agentdb-memory\.rvf|new[[:space:]]+memPkg\.(RvfBackend|AgentDBBackend)"
  local silo_hits
  silo_hits=$(grep -vE '^[[:space:]]*//' "$hook" 2>/dev/null | grep -cE "$_silo_re" 2>/dev/null)
  silo_hits=${silo_hits:-0}

  if [[ "$silo_hits" -ne 0 ]]; then
    _CHECK_OUTPUT="T1a FAIL: dogfood auto-memory-hook.mjs still wires an agentdb-memory.rvf silo in active code ($silo_hits ref(s)). Offenders: $(grep -nE "$_silo_re" "$hook" | grep -vE ':[[:space:]]*//' | head -3 | tr '\n' '|')"
    return
  fi

  # POSITIVE: createBackend still returns a JsonFileBackend (import path intact).
  if ! grep -qE "new[[:space:]]+JsonFileBackend\(" "$hook" 2>/dev/null; then
    _CHECK_OUTPUT="T1a FAIL: silo absent BUT createBackend no longer returns a JsonFileBackend — the JSON import store path is broken. createBackend body: $(grep -nA4 'function createBackend' "$hook" | head -6 | tr '\n' '|')"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="T1a PASS: dogfood auto-memory-hook.mjs instantiates no agentdb-memory.rvf silo backend (JSON-only createBackend; SessionStart import regenerates no silo .rvf)"
}

# ════════════════════════════════════════════════════════════════════
# T1-silo (b) — settings.json has no Stop hook invoking the removed `sync`.
#
# The exact stale wire is `auto-memory-hook.mjs" sync` (the `sync` subcommand the
# script no longer accepts; it prints `Usage: <import|status>` + exit 1 every
# turn). Post-fix it is absent — the generated template emits no Stop key at all
# (settings-generator.ts:566-574 "intentionally NOT wired"). We assert the stale
# `sync` invocation is gone; the broader `"Stop"` key may legitimately be
# absent entirely (preferred) or repurposed to a non-sync command later, so we
# key the FAIL on the specific `auto-memory-hook ... sync` invocation, not on the
# mere presence of a `"Stop"` key.
# ════════════════════════════════════════════════════════════════════
check_adr0287_t1_no_stale_stop_sync_hook() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""

  local settings="$PROJECT_DIR/.claude/settings.json"
  if [[ ! -f "$settings" ]]; then
    _CHECK_OUTPUT="T1b FAIL: dogfood settings.json not found at $settings"
    return
  fi

  # Match the `auto-memory-hook.mjs sync` invocation. The live wire's separator
  # is an escaped-quote + space (`...auto-memory-hook.mjs\" sync`), so the bytes
  # between `mjs` and `sync` are a backslash, a quote and a space — none of them
  # lowercase letters. `[^a-z]{1,4}` spans exactly that separator without
  # depending on JSON escaping specifics, and `sync` is the next lowercase token.
  local _stop_re='auto-memory-hook\.mjs[^a-z]{1,4}sync'
  local sync_hits
  sync_hits=$(grep -cE "$_stop_re" "$settings" 2>/dev/null)
  sync_hits=${sync_hits:-0}

  if [[ "$sync_hits" -eq 0 ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="T1b PASS: settings.json has no Stop->auto-memory-hook.mjs sync wire (matches generated template: no stale sync subcommand)"
  else
    _CHECK_OUTPUT="T1b FAIL: settings.json still wires the removed 'sync' subcommand ($sync_hits ref). Offender: $(grep -nE "$_stop_re" "$settings" | head -2 | tr '\n' '|')"
  fi
}

# ════════════════════════════════════════════════════════════════════
# F1 — MCP_TIMEOUT=60000 present in a launch env Claude reads into its OWN
# process: user ~/.claude/settings.json env OR project .claude/settings.json env.
#
# MCP_TIMEOUT governs the Claude Code CLIENT's connect-wait for an MCP server's
# `initialize`; it is read from the Claude Code process env. The per-server `env`
# in .mcp.json is injected into the SPAWNED SERVER's env and does NOT change the
# client timeout — so .mcp.json is deliberately NOT accepted here (ADR-0287
# lines 221/244: the home is "Claude Code's launch env"). We accept either the
# user-global settings (per-machine operator setting, the ADR's framing) or the
# project .claude/settings.json top-level env (committed, CI-visible).
#
# NB for the queen: if F1 is applied ONLY to user-global ~/.claude/settings.json,
# this check passes on this machine but is RED on a clean CI runner. To make it
# CI-stable, apply F1 to the PROJECT .claude/settings.json env (committed). If F1
# is instead consciously skipped (ADR line 632 sanctions that), drop this check
# from the run_check_bg + collect_parallel lists.
# ════════════════════════════════════════════════════════════════════
check_adr0287_f1_mcp_timeout_set() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""

  local user_settings="${HOME}/.claude/settings.json"
  local proj_settings="$PROJECT_DIR/.claude/settings.json"

  # Match "MCP_TIMEOUT": "60000" (string) or 60000 (bare) in either settings
  # file. Claude reads env values as strings; the string form is canonical.
  local found="" f
  for f in "$user_settings" "$proj_settings"; do
    [[ -f "$f" ]] || continue
    if grep -qE '"MCP_TIMEOUT"[[:space:]]*:[[:space:]]*"?60000"?' "$f" 2>/dev/null; then
      found="$f"; break
    fi
  done

  if [[ -n "$found" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="F1 PASS: MCP_TIMEOUT=60000 set in launch env ($found)"
  else
    _CHECK_OUTPUT="F1 FAIL: MCP_TIMEOUT=60000 absent from both ${user_settings} and ${proj_settings} top-level env (ADR-0287 item 4). NB: NOT honored from .mcp.json per-server env — that feeds the server subprocess, not the client connect-wait."
  fi
}
