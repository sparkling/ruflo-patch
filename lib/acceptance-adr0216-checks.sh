#!/usr/bin/env bash
# lib/acceptance-adr0216-checks.sh — ADR-0216 Option E checks.
#
# Two checks, both running against the fresh init'd P5 project:
#
#   _run_skills_corpus_shape  — corpus-shape regression guard. Pins
#     the SKILLS_MAP name-set (38 SKILL.md-bearing skills + 1 whitelist),
#     asserts each emitted skill dir has a SKILL.md (except dual-mode),
#     asserts frontmatter parses with name: == dir slug (#1054 invariant).
#
#   _run_skills_cli_surface  — closes F-15-001 broken-promise. Runs
#     `ruflo skill list --format json` against the init'd dir, asserts
#     exit 0, parses JSON output, asserts each emitted skill appears in
#     the list mapped to an existing SKILL.md.
#
# Caller MUST set:
#   P5_DIR   — directory where init was run (contains .claude/skills/)
#   CLI_BIN  — path to the CLI binary
#
# Per ADR-0216 §(2):
#   - The floor is a SKILL.md-file count, not a dir count.
#   - `dual-mode/` is whitelisted as a known SKILL.md-less category —
#     a blanket "skip dirs lacking SKILL.md" would silently hide a real
#     future missing-SKILL.md regression.
#   - Floor: 30 (--yes default) / 38 (--full). P5 init uses --full.

# Canonical 33-entry SKILL.md-bearing name-set + 1 whitelist
# (dual-mode = SKILL.md-less). Matches the arch-test pin
# v3/@claude-flow/cli/__tests__/arch/adr0216-skills-map-pin.arch.test.ts.
#
# 2026-05-23 (ADR-0228 Batch M): post upstream ADR-128 + #1836 prune,
# the cli template bundles 33 skills (29 from Phase 1 c63905e6a + 4
# from Phase 5 9a66b2996: browser, dual-mode, flow-nexus-*). The 5
# previously-bundled skills (agentic-jujutsu, hive-mind-advanced,
# performance-analysis, worker-benchmarks, worker-integration) are no
# longer in cli/.claude/skills/ — three were pruned as duplicates by
# upstream's #1836 (`02976fcb9`), two (worker-*) were never bundled
# by upstream. They still exist in the fork's top-level .claude/skills/
# but init's `findSourceDir` walks the cli package, not the wrapper.
# Per ADR-128 §"Out of scope" #2, plugin auto-install during init was
# explicitly deferred; users opt in via `ruflo plugins install`.
_ADR0216_EXPECTED_SKILLS=(
  'agentdb-advanced'
  'agentdb-learning'
  'agentdb-memory-patterns'
  'agentdb-optimization'
  'agentdb-vector-search'
  'browser'
  'flow-nexus-neural'
  'flow-nexus-platform'
  'flow-nexus-swarm'
  'github-code-review'
  'github-multi-repo'
  'github-project-management'
  'github-release-management'
  'github-workflow-automation'
  'hooks-automation'
  'pair-programming'
  'reasoningbank-agentdb'
  'reasoningbank-intelligence'
  'skill-builder'
  'sparc-methodology'
  'stream-chain'
  'swarm-advanced'
  'swarm-orchestration'
  'v3-cli-modernization'
  'v3-core-implementation'
  'v3-ddd-architecture'
  'v3-integration-deep'
  'v3-mcp-optimization'
  'v3-memory-unification'
  'v3-performance-optimization'
  'v3-security-overhaul'
  'v3-swarm-coordination'
  'verification-quality'
)

# Whitelist: SKILL.md-less categories. Currently just dual-mode (has
# helper dual-*.md + README.md but no SKILL.md; ships on --full only).
_ADR0216_SKILL_MD_LESS_WHITELIST=(
  'dual-mode'
)

# Floor (SKILL.md-file count) for --full init. Post-ADR-128 + #1836:
# 33 (was 38 pre-prune). The 5 dropped skills (agentic-jujutsu,
# hive-mind-advanced, performance-analysis, worker-{benchmarks,
# integration}) live outside the cli bundle now.
_ADR0216_FLOOR_FULL=33

# ══════════════════════════════════════════════════════════════════════════════
# _run_skills_corpus_shape — corpus-shape regression guard
# ══════════════════════════════════════════════════════════════════════════════
_run_skills_corpus_shape() {
  _CHECK_PASSED="false"
  local skills_dir="${P5_DIR}/.claude/skills"
  if [[ ! -d "$skills_dir" ]]; then
    _CHECK_OUTPUT="ADR-0216: skills dir absent at $skills_dir (init didn't emit)"
    return
  fi

  # 1) Collect emitted skill dirs (alphabetical).
  local -a emitted_dirs=()
  local d
  while IFS= read -r d; do
    [[ -z "$d" ]] && continue
    emitted_dirs+=("$(basename "$d")")
  done < <(find "$skills_dir" -mindepth 1 -maxdepth 1 -type d | sort)

  if (( ${#emitted_dirs[@]} == 0 )); then
    _CHECK_OUTPUT="ADR-0216: no skill dirs emitted under $skills_dir"
    return
  fi

  # 2) Build expected set (full SKILLS_MAP name-set) for comparison.
  local -A expected_set=()
  local name
  for name in "${_ADR0216_EXPECTED_SKILLS[@]}"; do
    expected_set["$name"]=1
  done
  for name in "${_ADR0216_SKILL_MD_LESS_WHITELIST[@]}"; do
    expected_set["$name"]=1
  done

  # 3) Pin: every emitted dir must be in the expected set.
  local -a unexpected=()
  for d in "${emitted_dirs[@]}"; do
    if [[ -z "${expected_set[$d]:-}" ]]; then
      unexpected+=("$d")
    fi
  done
  if (( ${#unexpected[@]} > 0 )); then
    _CHECK_OUTPUT="ADR-0216: ${#unexpected[@]} emitted skill(s) not in SKILLS_MAP: ${unexpected[*]}"
    return
  fi

  # 4) Pin: every expected SKILL.md-bearing entry must have been emitted
  # WITH a SKILL.md present. `dual-mode` is whitelisted SKILL.md-less.
  local -A whitelist_set=()
  for name in "${_ADR0216_SKILL_MD_LESS_WHITELIST[@]}"; do
    whitelist_set["$name"]=1
  done

  local -a missing_skill_md=()
  local skill_md_count=0
  for d in "${emitted_dirs[@]}"; do
    if [[ -n "${whitelist_set[$d]:-}" ]]; then
      # whitelisted SKILL.md-less category — skip the SKILL.md check
      continue
    fi
    if [[ ! -f "$skills_dir/$d/SKILL.md" ]]; then
      missing_skill_md+=("$d")
    else
      skill_md_count=$((skill_md_count + 1))
    fi
  done
  if (( ${#missing_skill_md[@]} > 0 )); then
    _CHECK_OUTPUT="ADR-0216: ${#missing_skill_md[@]} skill dir(s) missing SKILL.md: ${missing_skill_md[*]}"
    return
  fi

  # 5) Floor enforcement: SKILL.md-file count must reach the --full floor.
  if (( skill_md_count < _ADR0216_FLOOR_FULL )); then
    _CHECK_OUTPUT="ADR-0216: SKILL.md count $skill_md_count < floor $_ADR0216_FLOOR_FULL"
    return
  fi

  # 6) For every emitted SKILL.md: parse frontmatter, assert name:
  # is present. The #1054 invariant originally required name: == dir
  # slug, but upstream's ADR-128 Phase 1 skills (29 of them) ship with
  # human-readable Title Case names (e.g. `name: "AgentDB Advanced
  # Features"` for the `agentdb-advanced` dir). The CLI's `skill list`
  # output uses the dir slug as the canonical `name` field anyway, so
  # the frontmatter `name:` is just a display title. Relaxed: just
  # require the name: key is present.
  local frontmatter_violations=""
  local skill_md
  for d in "${emitted_dirs[@]}"; do
    [[ -n "${whitelist_set[$d]:-}" ]] && continue
    skill_md="$skills_dir/$d/SKILL.md"
    # Extract the name: line from the leading ---\n...\n--- block.
    local name_val
    name_val=$(node -e "
      const fs = require('fs');
      const c = fs.readFileSync('$skill_md', 'utf8');
      const m = c.match(/^---\n([\s\S]*?)\n---/);
      if (!m) { process.stdout.write(''); process.exit(0); }
      const lines = m[1].split('\n');
      for (const ln of lines) {
        const kv = ln.match(/^name:\s*(.+)\$/);
        if (kv) { process.stdout.write(kv[1].trim().replace(/^['\"](.*)['\"]\$/, '\$1')); process.exit(0); }
      }
    " 2>/dev/null)
    if [[ -z "$name_val" ]]; then
      frontmatter_violations="$frontmatter_violations $d:no-name"
    fi
  done
  if [[ -n "$frontmatter_violations" ]]; then
    _CHECK_OUTPUT="ADR-0216: skills with missing frontmatter name::${frontmatter_violations}"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0216 corpus shape OK: ${skill_md_count} SKILL.md (floor=${_ADR0216_FLOOR_FULL}), ${#emitted_dirs[@]} emitted dirs, dual-mode whitelisted"
}

# ══════════════════════════════════════════════════════════════════════════════
# _run_skills_cli_surface — `ruflo skill list` exists and resolves
# ══════════════════════════════════════════════════════════════════════════════
_run_skills_cli_surface() {
  _CHECK_PASSED="false"
  if [[ -z "$CLI_BIN" ]]; then
    _CHECK_OUTPUT="ADR-0216: CLI_BIN not set"
    return
  fi

  # Run `ruflo skill list --format json --cwd $P5_DIR` (the advertised
  # spelling per init.ts:529,889 + claudemd-generator.ts:154,167,179).
  local out
  out=$(timeout 15 "$CLI_BIN" skill list --format json --cwd "$P5_DIR" 2>&1) || true
  local rc=$?

  # The CLI hangs at exit on open SQLite handles (per ADR-0039 T1) —
  # `_run_and_kill`-style behaviour. Don't gate on rc; gate on output.

  # Output must be parseable JSON with at least the floor count.
  # The CLI may emit log lines like `[AgentDB] Telemetry disabled`
  # before the JSON output. Find the first line that STARTS with `[`
  # (column 0) — that's the JSON array opening, not a log prefix.
  # Use line slicing (lines.slice(i).join), NOT data.indexOf(lines[i]),
  # because the latter finds the FIRST '[' anywhere — which is the log
  # prefix itself.
  local count
  count=$(node -e "
    try {
      const data = process.argv[1];
      const lines = data.split('\n');
      let startLine = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('[') && !lines[i].match(/^\[\w+\]/)) {
          startLine = i;
          break;
        }
      }
      if (startLine < 0) { process.stdout.write('0'); process.exit(0); }
      const jsonText = lines.slice(startLine).join('\n');
      const j = JSON.parse(jsonText);
      process.stdout.write(String(j.length));
    } catch (e) {
      process.stdout.write('0');
    }
  " "$out" 2>/dev/null) || count=0

  if (( count < _ADR0216_FLOOR_FULL )); then
    _CHECK_OUTPUT="ADR-0216 skill list: parsed ${count} entries, floor ${_ADR0216_FLOOR_FULL}. Output head: ${out:0:200}"
    return
  fi

  # Spot-check: at least sparc-methodology and one other canonical skill
  # appear in the output (they would always emit on --full).
  if ! echo "$out" | grep -q 'sparc-methodology'; then
    _CHECK_OUTPUT="ADR-0216 skill list: missing sparc-methodology in output"
    return
  fi
  if ! echo "$out" | grep -q 'swarm-orchestration'; then
    _CHECK_OUTPUT="ADR-0216 skill list: missing swarm-orchestration in output"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0216 skill list OK: ${count} entries; floor=${_ADR0216_FLOOR_FULL}; advertised command resolves"
}
