#!/usr/bin/env bash
# scripts/check-no-cwd-in-handlers.sh — ADR-0100 §3c grep gate.
#
# Fails if `process.cwd()` appears as a code-level call in any MCP handler
# (`forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/*-tools.ts`). Comment lines
# that mention `process.cwd()` as documentation are explicitly allowlisted —
# the migrated handlers ALL keep an "ADR-0100: anchor on project root, not
# process.cwd() (Claude Code CWD drift)." comment as a teaching cue, and
# stripping that text would make the gate harm the readability of the very
# code it guards.
#
# Where wired:
#   • Invoked once as `check_adr0100_grep_gate` from
#     `lib/acceptance-adr0100-checks.sh` (called via run_check_bg in
#     scripts/test-acceptance.sh's parallel wave).
#   • Standalone-runnable: `bash scripts/check-no-cwd-in-handlers.sh`
#     prints violations and exits 0 (clean) or 1 (any violation).
#   NOT wired into preflight — preflight is forbidden as a manual entrypoint
#   per CLAUDE.md "Build & Test — TWO COMMANDS, NOTHING ELSE", and the gate
#   inspects fork source under `forks/ruflo/v3/...` which is exactly the
#   shape acceptance checks already operate on.
#
# Allowlist methodology (from already-migrated handlers, fork @
# /Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/mcp-tools):
#   - swarm-tools.ts:47    — comment: "// ADR-0100: findProjectRoot walks up
#                                       to the project root marker, NOT
#                                       process.cwd()."
#   - neural-tools.ts:95   — comment: "// ADR-0100: anchor on project root,
#                                       not process.cwd() (Claude Code CWD
#                                       drift)."
#   - ruvllm-store.ts:38   — same teaching comment (gate doesn't scope this
#                              file — it's not *-tools.ts — but illustrates
#                              the convention).
# All three keep a `// ... process.cwd() ...` comment with `findProjectRoot()`
# on the very next line. The pattern below allowlists exactly that shape:
# any line where the FIRST non-whitespace tokens are `//`. Block-comment
# variants (`/* ... */`, ` * `) are also allowlisted because TypeScript
# JSDoc commonly references the function it wraps (see types.ts L35).
#
# Conventions:
#   - Per memory `feedback-no-fallbacks`: the gate FAILS LOUD on any
#     non-comment hit. No "warn and continue".
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

HANDLER_GLOB="${FORK_DIR}/v3/@claude-flow/cli/src/mcp-tools"
if [[ ! -d "$HANDLER_GLOB" ]]; then
  echo "ERROR [adr0100-cwd-gate]: handler dir missing: $HANDLER_GLOB" >&2
  exit 2
fi

# Output sink (memory `feedback-no-tail-tests`: capture full output to disk,
# grep/inspect AFTER each step). Per-process to avoid cross-run trampling.
LOG_DIR=${ADR0100_LOG_DIR:-/tmp/ruflo-adr0100-cwd-gate}
mkdir -p "$LOG_DIR"
LOG="${LOG_DIR}/$$.log"
: > "$LOG"

# Collect every line containing `process.cwd()` from in-scope handlers.
# Pass multiple files to a single grep so `-n` emits `file:lineno:source`
# uniformly (single-file grep -n omits the filename prefix and breaks
# downstream parsing). `-H` forces filename prefix even on a single file
# match, belt-and-braces.
HITS_FILE="${LOG_DIR}/hits-$$.txt"
: > "$HITS_FILE"
shopt -s nullglob
# Build the file list explicitly — globbing inline as args ensures each
# match is emitted with its filename, without spawning one grep per file.
_handler_files=( "${HANDLER_GLOB}"/*-tools.ts )
shopt -u nullglob
if (( ${#_handler_files[@]} > 0 )); then
  grep -HnE 'process\.cwd\(\)' "${_handler_files[@]}" >> "$HITS_FILE" 2>/dev/null || true
fi

total_lines=$(wc -l < "$HITS_FILE" 2>/dev/null || echo 0)
total_lines=${total_lines// /}

# Filter out allowlist (comment lines).
VIOLATIONS_FILE="${LOG_DIR}/violations-$$.txt"
: > "$VIOLATIONS_FILE"

# A line is a comment if its FIRST non-whitespace tokens are one of:
#   //     — line-style comment (most common in *-tools.ts)
#   *      — JSDoc body line (block comment continuation, e.g. types.ts L35)
#   /*     — block comment opener
# We strip the file-prefix (file:line:) before checking.
while IFS= read -r entry; do
  [[ -z "$entry" ]] && continue
  # entry shape: <file>:<lineno>:<source line>
  # Extract just the source line (everything after second ':').
  src_line=${entry#*:}        # drop file:
  src_line=${src_line#*:}     # drop lineno:

  # Trim leading whitespace.
  trimmed=$(printf '%s' "$src_line" | sed -E 's/^[[:space:]]+//')

  case "$trimmed" in
    '//'*)   continue ;;          # line comment
    '*'*)    continue ;;          # JSDoc continuation line
    '/*'*)   continue ;;          # block comment opener
  esac

  # Not a comment — record as violation.
  echo "$entry" >> "$VIOLATIONS_FILE"
done < "$HITS_FILE"

vcount=$(wc -l < "$VIOLATIONS_FILE" 2>/dev/null || echo 0)
vcount=${vcount// /}
vcount=${vcount:-0}

acount=$(( total_lines - vcount ))

{
  echo "── ADR-0100 §3c grep gate ──"
  echo "scope:       ${HANDLER_GLOB}/*-tools.ts"
  echo "fork dir:    ${FORK_DIR}"
  echo "total hits:  ${total_lines}"
  echo "allowlisted: ${acount}  (lines starting with '//', '/*', or ' * ')"
  echo "violations:  ${vcount}"
  if (( vcount > 0 )); then
    echo ""
    echo "── violations ──"
    cat "$VIOLATIONS_FILE"
  fi
} | tee -a "$LOG"

if (( vcount > 0 )); then
  echo "" >&2
  echo "ERROR [adr0100-cwd-gate]: ${vcount} non-comment process.cwd() use(s) in mcp-tools/*-tools.ts." >&2
  echo "Migrate each to findProjectRoot() (artifacts) or getDisplayCwd() (display-only) per ADR-0100 §1." >&2
  echo "Log: ${LOG}" >&2
  exit 1
fi

exit 0
