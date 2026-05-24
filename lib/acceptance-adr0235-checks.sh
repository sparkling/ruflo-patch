# lib/acceptance-adr0235-checks.sh — ADR-0235 brand + helpers parity trip-wire.
#
# Wires Batch 1's ADR-0235 (umbrella plugin rebrand + bundled-static
# .claude/helpers/ deletion) into the fast acceptance runner. Two checks:
#
#   1. forks/ruflo/.claude/helpers/ directory is absent (per Option B —
#      generator is the source of truth).
#   2. The 7 forbidden-substring lints from the patch-repo node test pass
#      when grep'd directly against forks/ruflo/.claude-plugin/.
#
# The patch-repo node test (tests/pipeline/umbrella-plugin-brand.test.mjs)
# is also runnable in-place; this acceptance check provides a coarse-grain
# tripwire that does not require Node.
#
# Per ADR-0233 second-pass §Per-ADR validation gates.

_FORK_RUFLO="/Users/henrik/source/forks/ruflo"

# Forbidden substrings per the umbrella-plugin-brand.test.mjs lint contract.
# Tab-separated label/needle pairs to preserve embedded characters.
_ADR0235_FORBIDDEN=(
  '"name": "claude-flow"'
  '"version": "2.5.0"'
  '"name": "rUv"'
  'ruv@ruv.net'
  'npx claude-flow@alpha'
  'mcp add claude-flow '
  'https://github.com/ruvnet/claude-flow'
)

check_adr0235_helpers_dir_absent() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  if [[ ! -d "${_FORK_RUFLO}" ]]; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: ruflo fork path missing"
    return
  fi

  # ADR-0235 deletes the bundled-static asset directory shipped by the CLI
  # package — v3/@claude-flow/cli/.claude/helpers/ — NOT the fork's own
  # top-level repo .claude/helpers/ (which is a different, dev-time dir).
  local helpers="${_FORK_RUFLO}/v3/@claude-flow/cli/.claude/helpers"
  if [[ -d "$helpers" ]]; then
    local n
    n=$(find "$helpers" -type f 2>/dev/null | wc -l | tr -d ' ')
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: bundled-static v3/@claude-flow/cli/.claude/helpers/ re-appeared ($n files) — generator must be source of truth (ADR-0235 Option B)"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="bundled-static v3/@claude-flow/cli/.claude/helpers/ absent (generator is source of truth)"
}

check_adr0235_umbrella_brand_strings() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local pluginDir="${_FORK_RUFLO}/.claude-plugin"
  if [[ ! -d "$pluginDir" ]]; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: .claude-plugin/ missing"
    return
  fi

  local violations=0
  local first_violation=""
  for needle in "${_ADR0235_FORBIDDEN[@]}"; do
    # -r recurse, -F literal, -l list-files-with-matches.
    local hits
    hits=$(grep -rFl -- "$needle" "$pluginDir" 2>/dev/null | head -1)
    if [[ -n "$hits" ]]; then
      violations=$((violations + 1))
      [[ -z "$first_violation" ]] && first_violation="'$needle' in $hits"
    fi
  done

  if [[ "$violations" -gt 0 ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: $violations forbidden brand string(s) in .claude-plugin/ — first: $first_violation"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="All 7 forbidden brand strings absent from .claude-plugin/"
}
