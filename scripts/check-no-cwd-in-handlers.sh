#!/usr/bin/env bash
# scripts/check-no-cwd-in-handlers.sh — ADR-0100 §3c grep gate.
#
# Forbids path-anchoring `process.cwd()` use across CLI source. Fails the
# build (and the `adr0100-g-grep-gate` acceptance check) when any in-scope
# `.ts` file calls `process.cwd()` outside an allowlisted shape.
#
# WHY THIS GATE EXISTS
# --------------------
# ADR-0100 §1 says artifact-creating code MUST anchor on `findProjectRoot()`,
# never on `process.cwd()` — Claude Code drifts cwd between sessions, and
# anchoring on cwd causes duplicate `.swarm/`, `.claude-flow/`, etc. directories
# to land wherever the agent happened to chdir last. ADR-0100 §3c is the grep
# gate that enforces §1 statically before acceptance.
#
# SCOPE (expanded 2026-05-03 after adr0100-b/c regressions)
# ---------------------------------------------------------
# Original (release N-1):  forks/.../cli/src/mcp-tools/*-tools.ts only.
# That scope was too narrow — the duplicate-`.swarm/` regressions surfaced by
# adr0100-b-one-deep / adr0100-c-five-deep traced to `process.cwd()` uses
# OUTSIDE mcp-tools (init, commands, memory paths). The gate passed (0 hits in
# mcp-tools), then acceptance failed because the anchor-violating site lived
# in another directory.
#
# Broader scope, in order of section emit:
#   1. forks/.../cli/src/mcp-tools/*-tools.ts        (original — keep)
#   2. forks/.../cli/src/init/**/*.ts                (NEW)
#   3. forks/.../cli/src/commands/**/*.ts            (NEW)
#   4. forks/.../cli/src/memory/**/*.ts              (NEW)
#   5. forks/.../@claude-flow/memory/src/**/*.ts     (NEW)
#
# ALLOWLIST METHODOLOGY (per memory `feedback-no-fallbacks`: explicit, narrow)
# ---------------------------------------------------------------------------
# A line is allowlisted iff it matches one of:
#   (a) Comment shape — first non-whitespace tokens are `//`, `*`, or `/*`.
#       Existing migrated handlers keep teaching comments referencing
#       `process.cwd()` next to the `findProjectRoot()` they replaced; the
#       gate must not punish that.
#   (b) String-literal shape — `process.cwd()` is sandwiched between two
#       matching quote characters (`'…'`, `"…"`, or backtick…backtick) on
#       the same line, with no balancing close between the open and the call.
#       This catches generated subprocess code like
#         + 'catch(e){r=process.cwd()}';
#       in init/executor.ts where the literal text "process.cwd()" appears
#       in the source for hook child-processes to use at runtime — those
#       calls execute in the child's address space, not ours.
#   (c) Explicit annotation — line contains `adr-0100-allow:` (a project-
#       internal opt-out marker). Use sparingly; reserve for cases where the
#       `process.cwd()` call genuinely models the user's interactive cwd
#       (e.g. `getDisplayCwd()`-equivalent display strings) and migration to
#       `findProjectRoot()` would change semantics.
#
# Anything else is a violation. The gate exits non-zero with a per-section
# breakdown of hits, allowlisted, and violations so the failure tells the
# user where to look.
#
# WHERE WIRED
# -----------
#   • Invoked once as `check_adr0100_scenario_g_grep_gate` from
#     `lib/acceptance-adr0100-checks.sh` (parallel wave in
#     `scripts/test-acceptance.sh`).
#   • Standalone-runnable: `bash scripts/check-no-cwd-in-handlers.sh`
#     prints violations and exits 0 (clean) or 1 (any violation).
#   NOT wired into preflight — preflight is forbidden as a manual entrypoint
#   per CLAUDE.md "Build & Test — TWO COMMANDS, NOTHING ELSE", and the gate
#   inspects fork source under `forks/ruflo/v3/...` which is exactly the
#   shape acceptance checks already operate on.
#
# CONVENTIONS
# -----------
#   - Per memory `feedback-no-fallbacks`: the gate FAILS LOUD on any
#     non-allowlisted hit. No "warn and continue".
#   - Per memory `reference-grep-c-bash-trap`: count via captured-then-
#     defaulted `var=$(grep -c ...); var=${var:-0}` form.
#   - Per memory `feedback-no-tail-tests`: full output captured into a
#     log file; never piped through tail/head mid-stream.

set -uo pipefail

PROJECT_DIR=${PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}

# Resolve fork dir from config (same lookup adr0117 lib uses).
FORK_DIR=""
if [[ -n "${ADR0100_FORK_DIR:-}" ]]; then
  FORK_DIR="$ADR0100_FORK_DIR"
else
  FORK_DIR=$(node -e "
    const c = JSON.parse(require('fs').readFileSync(
      require('path').resolve('${PROJECT_DIR}', 'config', 'upstream-branches.json'), 'utf8'));
    process.stdout.write(c.ruflo?.dir || '');
  " 2>/dev/null)
fi

if [[ -z "$FORK_DIR" || ! -d "$FORK_DIR" ]]; then
  echo "ERROR [adr0100-cwd-gate]: cannot resolve ruflo fork dir from config/upstream-branches.json" >&2
  exit 2
fi

CLI_SRC="${FORK_DIR}/v3/@claude-flow/cli/src"
MEM_SRC="${FORK_DIR}/v3/@claude-flow/memory/src"

# Output sink (memory `feedback-no-tail-tests`: capture full output to disk,
# grep/inspect AFTER each step). Per-process to avoid cross-run trampling.
LOG_DIR=${ADR0100_LOG_DIR:-/tmp/ruflo-adr0100-cwd-gate}
mkdir -p "$LOG_DIR"
LOG="${LOG_DIR}/$$.log"
: > "$LOG"

# ── Allowlist classification helper ──
# Echoes "allow" or "violation" to stdout based on the source line $1.
# Inputs:
#   $1 = source line (after the file:lineno: prefix has been stripped)
_classify_line() {
  local src_line="$1"
  local trimmed
  trimmed=$(printf '%s' "$src_line" | sed -E 's/^[[:space:]]+//')

  # (a) comment shapes
  case "$trimmed" in
    '//'*)   echo "allow"; return ;;
    '*'*)    echo "allow"; return ;;
    '/*'*)   echo "allow"; return ;;
  esac

  # (c) explicit annotation marker — case-sensitive, narrow
  if [[ "$src_line" == *'adr-0100-allow:'* ]]; then
    echo "allow"; return
  fi

  # (b) string-literal shape — process.cwd() flanked by matching quote chars
  # on the same line. Use Perl for robust quote-pair detection: scan forward
  # from each `process.cwd()` occurrence and check whether ANY quote char
  # (single, double, backtick) appears strictly before AND strictly after
  # the call on this line. That catches generated subprocess code like
  #   + 'catch(e){r=process.cwd()}';
  # without false-positiving on `path.join(process.cwd(), '.x')` — the
  # latter has no quote BEFORE `process.cwd()`, only after.
  if printf '%s' "$src_line" | perl -ne '
    while (/process\.cwd\(\)/g) {
      my $pos = pos($_);
      my $before = substr($_, 0, $pos - length("process.cwd()"));
      my $after  = substr($_, $pos);
      my $b_q = ($before =~ /[\x27\x22\x60]/) ? 1 : 0;
      my $a_q = ($after  =~ /[\x27\x22\x60]/) ? 1 : 0;
      exit 0 if ($b_q && $a_q);
    }
    exit 1;
  '; then
    echo "allow"; return
  fi

  echo "violation"
}

# ── Per-section gate ──
# Args:
#   $1 = section label (printed)
#   $2 = literal description of file pattern (printed)
#   remaining args = file paths (already resolved)
#
# Sets globals:
#   _SEC_HITS, _SEC_ALLOW, _SEC_VIOL — counts for this section
#   _SEC_VIOL_FILE — path to a file containing this section's violations
_run_section() {
  local label="$1"; shift
  local desc="$1"; shift

  local hits_file="${LOG_DIR}/hits-$$-${label}.txt"
  local viol_file="${LOG_DIR}/violations-$$-${label}.txt"
  : > "$hits_file"
  : > "$viol_file"

  if (( $# > 0 )); then
    grep -HnE 'process\.cwd\(\)' "$@" >> "$hits_file" 2>/dev/null || true
  fi

  local total
  total=$(wc -l < "$hits_file" 2>/dev/null || echo 0)
  total=${total// /}
  total=${total:-0}

  local entry src_line verdict
  while IFS= read -r entry; do
    [[ -z "$entry" ]] && continue
    src_line=${entry#*:}        # drop file:
    src_line=${src_line#*:}     # drop lineno:
    verdict=$(_classify_line "$src_line")
    if [[ "$verdict" == "violation" ]]; then
      echo "$entry" >> "$viol_file"
    fi
  done < "$hits_file"

  local vcount
  vcount=$(wc -l < "$viol_file" 2>/dev/null || echo 0)
  vcount=${vcount// /}
  vcount=${vcount:-0}

  local acount=$(( total - vcount ))

  _SEC_HITS=$total
  _SEC_ALLOW=$acount
  _SEC_VIOL=$vcount
  _SEC_VIOL_FILE=$viol_file

  {
    echo ""
    echo "── ${label} ──"
    echo "scope:       ${desc}"
    echo "total hits:  ${_SEC_HITS}"
    echo "allowlisted: ${_SEC_ALLOW}"
    echo "violations:  ${_SEC_VIOL}"
    if (( _SEC_VIOL > 0 )); then
      echo ""
      echo "── violations (${label}) ──"
      cat "$viol_file"
    fi
  } | tee -a "$LOG"
}

# ── Build file lists per section ──
# Use `find` for unambiguous recursive enumeration. Bash globbing differs
# between 3.x (macOS system bash) and 4.x+ (linux, homebrew) — `find`
# is portable and emits each .ts file exactly once. We avoid `mapfile`
# (bash 4+) and use a `while read` loop instead for bash 3.2 portability.
_collect_into() {
  # Args: <varname> <root> <pattern>
  # Populates the named array variable with matching paths (sorted).
  local __varname="$1" __root="$2" __pattern="$3"
  eval "${__varname}=()"
  if [[ ! -d "$__root" ]]; then return 0; fi
  local __f
  while IFS= read -r __f; do
    [[ -z "$__f" ]] && continue
    eval "${__varname}+=( \"\$__f\" )"
  done < <(find "$__root" -type f -name "$__pattern" 2>/dev/null | sort)
}

# Section 1: original mcp-tools/*-tools.ts (NOT recursive — just the dir)
shopt -s nullglob
_files_mcp=( "${CLI_SRC}/mcp-tools"/*-tools.ts )
shopt -u nullglob

# Section 2-5: recursive .ts under each scope dir
_collect_into _files_init       "${CLI_SRC}/init"     '*.ts'
_collect_into _files_commands   "${CLI_SRC}/commands" '*.ts'
_collect_into _files_cli_memory "${CLI_SRC}/memory"   '*.ts'
_collect_into _files_pkg_memory "${MEM_SRC}"          '*.ts'

{
  echo "── ADR-0100 §3c grep gate ──"
  echo "fork dir: ${FORK_DIR}"
} | tee -a "$LOG"

_TOTAL_HITS=0
_TOTAL_ALLOW=0
_TOTAL_VIOL=0
_ALL_VIOL_FILES=()

_run_section "mcp-tools" "${CLI_SRC}/mcp-tools/*-tools.ts" "${_files_mcp[@]}"
_TOTAL_HITS=$(( _TOTAL_HITS + _SEC_HITS )); _TOTAL_ALLOW=$(( _TOTAL_ALLOW + _SEC_ALLOW )); _TOTAL_VIOL=$(( _TOTAL_VIOL + _SEC_VIOL ))
[[ "$_SEC_VIOL" -gt 0 ]] && _ALL_VIOL_FILES+=("$_SEC_VIOL_FILE")

_run_section "init" "${CLI_SRC}/init/**/*.ts" "${_files_init[@]}"
_TOTAL_HITS=$(( _TOTAL_HITS + _SEC_HITS )); _TOTAL_ALLOW=$(( _TOTAL_ALLOW + _SEC_ALLOW )); _TOTAL_VIOL=$(( _TOTAL_VIOL + _SEC_VIOL ))
[[ "$_SEC_VIOL" -gt 0 ]] && _ALL_VIOL_FILES+=("$_SEC_VIOL_FILE")

_run_section "commands" "${CLI_SRC}/commands/**/*.ts" "${_files_commands[@]}"
_TOTAL_HITS=$(( _TOTAL_HITS + _SEC_HITS )); _TOTAL_ALLOW=$(( _TOTAL_ALLOW + _SEC_ALLOW )); _TOTAL_VIOL=$(( _TOTAL_VIOL + _SEC_VIOL ))
[[ "$_SEC_VIOL" -gt 0 ]] && _ALL_VIOL_FILES+=("$_SEC_VIOL_FILE")

_run_section "cli-memory" "${CLI_SRC}/memory/**/*.ts" "${_files_cli_memory[@]}"
_TOTAL_HITS=$(( _TOTAL_HITS + _SEC_HITS )); _TOTAL_ALLOW=$(( _TOTAL_ALLOW + _SEC_ALLOW )); _TOTAL_VIOL=$(( _TOTAL_VIOL + _SEC_VIOL ))
[[ "$_SEC_VIOL" -gt 0 ]] && _ALL_VIOL_FILES+=("$_SEC_VIOL_FILE")

_run_section "pkg-memory" "${MEM_SRC}/**/*.ts" "${_files_pkg_memory[@]}"
_TOTAL_HITS=$(( _TOTAL_HITS + _SEC_HITS )); _TOTAL_ALLOW=$(( _TOTAL_ALLOW + _SEC_ALLOW )); _TOTAL_VIOL=$(( _TOTAL_VIOL + _SEC_VIOL ))
[[ "$_SEC_VIOL" -gt 0 ]] && _ALL_VIOL_FILES+=("$_SEC_VIOL_FILE")

{
  echo ""
  echo "── totals ──"
  echo "total hits:  ${_TOTAL_HITS}"
  echo "allowlisted: ${_TOTAL_ALLOW}"
  echo "violations:  ${_TOTAL_VIOL}"
} | tee -a "$LOG"

if (( _TOTAL_VIOL > 0 )); then
  echo "" >&2
  echo "ERROR [adr0100-cwd-gate]: ${_TOTAL_VIOL} non-allowlisted process.cwd() use(s) in CLI source." >&2
  echo "Migrate each to findProjectRoot() (artifacts) or getDisplayCwd() (display-only) per ADR-0100 §1." >&2
  echo "If the call genuinely needs the user's interactive cwd (rare), add an" >&2
  echo "'adr-0100-allow: <reason>' marker comment on the line." >&2
  echo "Log: ${LOG}" >&2
  exit 1
fi

exit 0
