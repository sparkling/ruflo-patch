#!/usr/bin/env bash
# lib/acceptance-adr0296-checks.sh — ADR-0296 C4 Quality & Process re-convergence
# (doc/contract only). A grep-contract check against the fork's plugin source
# tree (no MCP smoke — the F1/F2 findings are documentation contracts):
#
#   F1 — adr filename contract (two axes) converged on the canonical
#        `ADR-NNNN-<slug>.md` form (the `agentdb index` glob `ADR-*.md` is the
#        project-canonical contract; a skill-shaped no-prefix file is
#        un-indexable — EXIT 1):
#        - plugin command adr.md: 3-digit ADR-NNN → 4-digit ADR-NNNN; no bare
#          3-digit ADR-NNN-<slug> remains.
#        - plugin skill adr-create/SKILL.md: the "NO `ADR-` filename prefix"
#          prescription is GONE; both surfaces state `ADR-NNNN-<slug>.md`.
#   F2 spot-greps (the cite-verified doc-drift fixes):
#        - adr-index SKILL no longer claims `adr-edges` is "retired" / that edges
#          go to `causal-edges` (import.mjs writes adr-patterns + adr-edges).
#        - testgen test-gaps SKILL no longer advertises a phantom
#          `coverage-gaps --limit` CLI flag.
#        - jujutsu diff-analyze SKILL names the real `ref` arg.
#
# This is a both-ways check by construction: it FAILs against the unfixed plugin
# tree (the no-prefix string + 3-digit form present) and PASSes after the
# ADR-0296 F1/F2 edits ship. No paid calls, no MCP server, no install — pure
# source grep against the fork checkout resolved from config/upstream-branches.json.

if ! declare -f _ns >/dev/null 2>&1; then
  _ns() { date +%s%N 2>/dev/null || echo $(( $(date +%s) * 1000000000 )); }
fi
if ! declare -f _elapsed_ms >/dev/null 2>&1; then
  _elapsed_ms() { echo $(( ( ${2:-0} - ${1:-0} ) / 1000000 )); }
fi

__ADR0296_FORK_DIR=""
_adr0296_resolve_fork() {
  if [[ -n "$__ADR0296_FORK_DIR" ]]; then return; fi
  __ADR0296_FORK_DIR=$(node -e "
    const c = JSON.parse(require('fs').readFileSync(
      require('path').resolve('${PROJECT_DIR:-.}', 'config', 'upstream-branches.json'), 'utf8'));
    process.stdout.write(c.ruflo?.dir || '');
  " 2>/dev/null)
}

check_adr0296_c4_reconvergence() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  _adr0296_resolve_fork
  local fork="$__ADR0296_FORK_DIR"
  if [[ -z "$fork" || ! -d "$fork" ]]; then
    _CHECK_OUTPUT="ADR-0296: could not resolve fork dir from config/upstream-branches.json (ruflo.dir='$fork')"
    end_ns=$(_ns); _EXIT=2; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  local adr_cmd="$fork/plugins/ruflo-adr/commands/adr.md"
  local adr_skill="$fork/plugins/ruflo-adr/skills/adr-create/SKILL.md"
  local idx_skill="$fork/plugins/ruflo-adr/skills/adr-index/SKILL.md"
  local tg_skill="$fork/plugins/ruflo-testgen/skills/test-gaps/SKILL.md"
  local jj_skill="$fork/plugins/ruflo-jujutsu/skills/diff-analyze/SKILL.md"

  local failures=""
  local n

  # — F1 prefix axis: the no-prefix prescription must be GONE from the skill —
  if [[ -f "$adr_skill" ]]; then
    n=$(grep -c "NO .ADR-. filename prefix" "$adr_skill"); n=${n:-0}
    if [[ "$n" -ne 0 ]]; then failures="$failures [F1: adr-create SKILL still prescribes no-prefix filename ($n)]"; fi
    n=$(grep -c "ADR-NNNN-<slug>.md" "$adr_skill"); n=${n:-0}
    if [[ "$n" -lt 1 ]]; then failures="$failures [F1: adr-create SKILL missing canonical ADR-NNNN-<slug>.md]"; fi
  else
    failures="$failures [F1: missing $adr_skill]"
  fi

  # — F1 digit axis: command must use 4-digit ADR-NNNN, no bare 3-digit form —
  if [[ -f "$adr_cmd" ]]; then
    n=$(grep -c "ADR-NNN-<slug>" "$adr_cmd"); n=${n:-0}
    if [[ "$n" -ne 0 ]]; then failures="$failures [F1: adr.md still uses 3-digit ADR-NNN-<slug> ($n)]"; fi
    n=$(grep -c "ADR-NNNN-<slug>.md" "$adr_cmd"); n=${n:-0}
    if [[ "$n" -lt 1 ]]; then failures="$failures [F1: adr.md missing canonical ADR-NNNN-<slug>.md]"; fi
  else
    failures="$failures [F1: missing $adr_cmd]"
  fi

  # — F2: adr-index SKILL must not claim adr-edges retired / causal-edges —
  if [[ -f "$idx_skill" ]]; then
    n=$(grep -c "adr-edges. namespace is retired\|legacy .adr-edges. namespace is retired" "$idx_skill"); n=${n:-0}
    if [[ "$n" -ne 0 ]]; then failures="$failures [F2: adr-index SKILL still claims adr-edges retired]"; fi
    n=$(grep -c "adr-edges" "$idx_skill"); n=${n:-0}
    if [[ "$n" -lt 1 ]]; then failures="$failures [F2: adr-index SKILL no longer references the live adr-edges namespace]"; fi
  else
    failures="$failures [F2: missing $idx_skill]"
  fi

  # — F2: testgen test-gaps SKILL must not advertise phantom coverage-gaps --limit —
  # Match only an INVOCATION line (`hooks coverage-gaps … --limit`), not prose
  # that explains the flag is absent.
  if [[ -f "$tg_skill" ]]; then
    n=$(grep -c "hooks coverage-gaps.*--limit" "$tg_skill"); n=${n:-0}
    if [[ "$n" -ne 0 ]]; then failures="$failures [F2: test-gaps SKILL still invokes phantom 'hooks coverage-gaps … --limit']"; fi
  else
    failures="$failures [F2: missing $tg_skill]"
  fi

  # — F2: jujutsu diff-analyze SKILL must name the real ref arg —
  if [[ -f "$jj_skill" ]]; then
    n=$(grep -c "\`ref\` arg\|with a .ref. arg" "$jj_skill"); n=${n:-0}
    if [[ "$n" -lt 1 ]]; then failures="$failures [F2: diff-analyze SKILL does not name the real ref arg]"; fi
  else
    failures="$failures [F2: missing $jj_skill]"
  fi

  end_ns=$(_ns)
  _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns")
  if [[ -z "$failures" ]]; then
    _CHECK_PASSED="true"
    _EXIT=0
    _CHECK_OUTPUT="ADR-0296 F1/F2 grep-contract: all surfaces canonical (fork=$fork)"
  else
    _EXIT=1
    _CHECK_OUTPUT="ADR-0296 F1/F2 grep-contract FAILED:$failures"
  fi
  _OUT="$_CHECK_OUTPUT"
}
