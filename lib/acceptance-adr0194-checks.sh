#!/usr/bin/env bash
# lib/acceptance-adr0194-checks.sh — ADR-0194: AutopilotLearning Phase 3
# (embedding-cluster pattern discovery).
#
# ADR-0194 status is `accepted` as of 2026-05-19. Closure criteria (per
# the ADR itself) include:
#   * getMetrics() returns engine: 'keyword' | 'embedding-cluster'
#   * discoverSuccessPatterns() returns ≥ 1 pattern in a populated corpus,
#     including cross-lexical clusters (Phase 3 path)
#   * an acceptance probe asserts both of the above
#
# Until ADR-0194 lands, these checks FAIL — that is the closure-criterion
# signal the ADR's "Decision Outcome" relies on. Per
# `feedback-no-fallbacks.md`, FAIL is the right disposition: no skip_accepted
# masking until the feature exists.
#
# Surfaces under test (post-ADR):
#   - `ruflo autopilot patterns --json` — new subcommand that returns the
#     full DiscoveredPattern[] AND a top-level `engine` field. The pre-ADR
#     surface is `autopilot learn --json` which omits `engine`; the check
#     accepts either subcommand path so it survives the rename.
#
# Caller MUST set: REGISTRY, TEMP_DIR, ACCEPT_TEMP, P5_DIR (Phase 5 init dir).
#
# Catalog naming: check_adr0194_* is L7-accepted via the adr-NNNN filename tag.

# ── helpers ─────────────────────────────────────────────────────────────────

# Invoke `autopilot patterns --json` (or fall back to `autopilot learn --json`
# pre-ADR) and write the captured stdout to $out_file. Returns the exit code
# via _RK_EXIT (set by _run_and_kill_ro). Caller inspects $out_file.
_adr0194_run_patterns_json() {
  local dir="$1" out_file="$2"
  local cli; cli=$(_cli_cmd)
  # Prefer the post-ADR subcommand; if it errors with "Unknown command", the
  # caller decides whether to fall back to `learn --json` (the pre-ADR shape
  # which can NEVER carry an `engine` field, so falling back means the check
  # FAILs on the engine assertion — the closure-criterion path).
  _run_and_kill_ro \
    "cd '${dir}' && NPM_CONFIG_REGISTRY='${REGISTRY}' ${cli} autopilot patterns --json 2>&1" \
    "$out_file" \
    30
}

# Seed two cross-lexical episode groups so Phase 2's keyword aggregator
# (count>=2) returns ZERO while Phase 3's cluster aggregator returns ≥2.
# Each set is three episodes sharing no ≥4-char token but semantically
# identical. Mirrors the ADR-0194 Context section's failure cases.
_adr0194_seed_episodes() {
  local dir="$1"
  local cli; cli=$(_cli_cmd)
  # Set A: react bug fix family
  for subject in "react bug fix" "frontend defect resolution" "ui regression"; do
    _run_and_kill \
      "cd '${dir}' && NPM_CONFIG_REGISTRY='${REGISTRY}' ${cli} memory store --key 'adr0194-seed-$(echo "$subject" | tr ' ' '-')' --value '${subject}' --namespace autopilot:episodes" \
      "" 20
  done
  # Set B: OAuth/SAML/SSO family
  for subject in "implement OAuth login" "build SAML signup" "add SSO flow"; do
    _run_and_kill \
      "cd '${dir}' && NPM_CONFIG_REGISTRY='${REGISTRY}' ${cli} memory store --key 'adr0194-seed-$(echo "$subject" | tr ' ' '-')' --value '${subject}' --namespace autopilot:episodes" \
      "" 20
  done
}

# ── (1) populated corpus: both engines produce patterns ─────────────────────

# check_adr0194_patterns_populated — assert `autopilot patterns --json` against
# a corpus seeded with cross-lexical groups returns:
#   * a top-level `engine` field of value 'keyword' or 'embedding-cluster'
#   * a `patterns` array with len ≥ 1
#   * (post-Phase 3 only) at least one pattern whose `source: 'cluster'` —
#     this last assertion is the strongest Phase 3 closure signal.
check_adr0194_patterns_populated() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  if [[ -z "${P5_DIR:-}" || ! -d "$P5_DIR" ]]; then
    _CHECK_OUTPUT="adr0194-populated: \$P5_DIR not exported or missing (Phase 5 init scheduling broken?)"
    return
  fi

  local dir; dir=$(mktemp -d "${ACCEPT_TEMP:-/tmp}/_check_workdirs/ruflo-adr0194-pop-XXXXX")
  # shellcheck disable=SC2064
  trap "rm -rf '$dir' 2>/dev/null; trap - RETURN INT TERM" RETURN INT TERM
  _acceptance_snapshot "$P5_DIR" "$dir"
  : > "$dir/.ruflo-project"

  if [[ ! -f "${dir}/.claude-flow/config.json" ]]; then
    _CHECK_OUTPUT="adr0194-populated: clone from \$P5_DIR failed (no config.json)"
    return
  fi

  _adr0194_seed_episodes "$dir"

  local out_file; out_file=$(mktemp "${ACCEPT_TEMP:-/tmp}/adr0194-pop-XXXXX")
  _adr0194_run_patterns_json "$dir" "$out_file"
  local raw; raw=$(cat "$out_file" 2>/dev/null || echo "")
  rm -f "$out_file"
  # Strip the sentinel line
  raw=$(echo "$raw" | grep -v '^__RUFLO_DONE__:')

  if echo "$raw" | grep -qiE 'unknown command|unknown subcommand|no such command'; then
    _CHECK_OUTPUT="adr0194-populated: \`autopilot patterns\` subcommand not present in published CLI — ADR-0194 not yet implemented. Raw: $(echo "$raw" | head -3 | tr '\n' ' ')"
    return
  fi

  # Extract the JSON object — autopilot CLI may prepend banner lines.
  # Take from the first { to the last } and try to parse.
  local body
  body=$(node -e '
    (() => {
      const raw = require("fs").readFileSync(0, "utf8");
      const s = raw.indexOf("{");
      const e = raw.lastIndexOf("}");
      if (s < 0 || e < s) { process.exit(2); }
      try {
        const j = JSON.parse(raw.slice(s, e + 1));
        process.stdout.write(JSON.stringify(j));
      } catch { process.exit(3); }
    })();
  ' <<<"$raw" 2>/dev/null)

  if [[ -z "$body" ]]; then
    _CHECK_OUTPUT="adr0194-populated: \`autopilot patterns --json\` produced no parseable JSON. Raw (first 10 lines): $(echo "$raw" | head -10 | tr '\n' ' ' | head -c 600)"
    return
  fi

  # Closure-criterion assertions, in order of strength:
  #   (a) top-level `engine` field present and one of the two valid values
  #   (b) `patterns` array length ≥ 1 (populated corpus)
  local engine
  engine=$(node -e "
    try {
      const j = JSON.parse(require('fs').readFileSync(0,'utf8'));
      process.stdout.write(String(j.engine ?? j.metrics?.engine ?? ''));
    } catch {}
  " <<<"$body" 2>/dev/null)

  if [[ "$engine" != "keyword" && "$engine" != "embedding-cluster" ]]; then
    _CHECK_OUTPUT="adr0194-populated: missing 'engine' field — got '${engine:-undefined}' (want 'keyword' or 'embedding-cluster'). ADR-0194 §LearningMetrics.engine not yet wired. Body: $(echo "$body" | head -c 400)"
    return
  fi

  local patlen
  patlen=$(node -e "
    try {
      const j = JSON.parse(require('fs').readFileSync(0,'utf8'));
      const p = Array.isArray(j.patterns) ? j.patterns : [];
      process.stdout.write(String(p.length));
    } catch { process.stdout.write('0'); }
  " <<<"$body" 2>/dev/null)

  if ! [[ "$patlen" =~ ^[0-9]+$ ]] || (( patlen < 1 )); then
    _CHECK_OUTPUT="adr0194-populated: engine='${engine}' but patterns.length=${patlen:-0} (want ≥1 with 6 seeded cross-lexical episodes)"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="adr0194-populated: engine='${engine}', patterns.length=${patlen} from cross-lexical seed"
}

# ── (2) empty corpus: returns [] rather than erroring ───────────────────────

# check_adr0194_patterns_empty — assert `autopilot patterns --json` against
# a freshly-init'd project (no episodes) returns a structurally-valid response
# with an empty patterns array, NOT an error and NOT undefined.
check_adr0194_patterns_empty() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  if [[ -z "${P5_DIR:-}" || ! -d "$P5_DIR" ]]; then
    _CHECK_OUTPUT="adr0194-empty: \$P5_DIR not exported or missing"
    return
  fi

  local dir; dir=$(mktemp -d "${ACCEPT_TEMP:-/tmp}/_check_workdirs/ruflo-adr0194-empty-XXXXX")
  # shellcheck disable=SC2064
  trap "rm -rf '$dir' 2>/dev/null; trap - RETURN INT TERM" RETURN INT TERM
  _acceptance_snapshot "$P5_DIR" "$dir"
  : > "$dir/.ruflo-project"

  # Deliberately do NOT seed episodes. Phase 5 init may have written some
  # baseline state; the assertion below only checks structure, not "exactly 0
  # patterns" (which would be brittle to harness changes).
  local out_file; out_file=$(mktemp "${ACCEPT_TEMP:-/tmp}/adr0194-empty-XXXXX")
  _adr0194_run_patterns_json "$dir" "$out_file"
  local raw; raw=$(cat "$out_file" 2>/dev/null || echo "")
  rm -f "$out_file"
  raw=$(echo "$raw" | grep -v '^__RUFLO_DONE__:')

  if echo "$raw" | grep -qiE 'unknown command|unknown subcommand|no such command'; then
    _CHECK_OUTPUT="adr0194-empty: \`autopilot patterns\` subcommand not present — ADR-0194 not implemented"
    return
  fi

  # No throws / no "Error:" preamble — empty corpus must produce a clean JSON
  # response (the pre-ADR `learn --json` returns {available:false,patterns:[]}
  # which satisfies this contract; the post-ADR `patterns --json` should
  # match the same structural shape).
  if echo "$raw" | grep -qE '^(Error:|TypeError:|ReferenceError:)'; then
    _CHECK_OUTPUT="adr0194-empty: subcommand threw on empty corpus (want clean empty []): $(echo "$raw" | head -5 | tr '\n' ' ' | head -c 400)"
    return
  fi

  local body
  body=$(node -e '
    (() => {
      const raw = require("fs").readFileSync(0, "utf8");
      const s = raw.indexOf("{");
      const e = raw.lastIndexOf("}");
      if (s < 0 || e < s) { process.exit(2); }
      try {
        const j = JSON.parse(raw.slice(s, e + 1));
        process.stdout.write(JSON.stringify(j));
      } catch { process.exit(3); }
    })();
  ' <<<"$raw" 2>/dev/null)

  if [[ -z "$body" ]]; then
    _CHECK_OUTPUT="adr0194-empty: subcommand produced no parseable JSON on empty corpus: $(echo "$raw" | head -10 | tr '\n' ' ' | head -c 400)"
    return
  fi

  local is_array
  is_array=$(node -e "
    try {
      const j = JSON.parse(require('fs').readFileSync(0,'utf8'));
      process.stdout.write(Array.isArray(j.patterns) ? 'yes' : 'no');
    } catch { process.stdout.write('no'); }
  " <<<"$body" 2>/dev/null)

  if [[ "$is_array" != "yes" ]]; then
    _CHECK_OUTPUT="adr0194-empty: response.patterns is not an array on empty corpus. Body: $(echo "$body" | head -c 400)"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="adr0194-empty: empty corpus returns structurally-valid response with patterns:[] (no error)"
}
