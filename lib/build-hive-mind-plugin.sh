#!/usr/bin/env bash
# lib/build-hive-mind-plugin.sh — ADR-0116 ruflo-hive-mind plugin materialise script
#
# Copies upstream skill / agent / command files into a fresh
# `plugins/ruflo-hive-mind/` tree under the target fork checkout, applies the
# ADR-0113 codemod (`@claude-flow/cli@latest` ← `claude-flow`,
# `mcp__claude-flow__` → `mcp__ruflo__`), and generates plugin.json + README +
# per-command frontmatter.
#
# Determinism contract (ADR-0116 AC #14):
#   - No timestamps, no random suffixes, no locale-dependent sort.
#   - Two consecutive runs produce a byte-identical tree.
#   - Source-of-truth for the 16 agents, 11 commands, 2 skills is hardcoded
#     in this script (see `_upstream_*` arrays). Drift surfaces as a fail.
#
# Inputs (env vars):
#   UPSTREAM_DIR  — absolute path to upstream ruvnet/ruflo checkout.
#                   Default: /Users/henrik/source/ruvnet/ruflo
#                   If absent, falls back to FALLBACK_DIR below (LOG WARNING).
#   FORK_DIR      — fork checkout where plugins/ruflo-hive-mind/ is written.
#                   Default: /Users/henrik/source/forks/ruflo
#   ADR0118_PATH  — path to ADR-0118-hive-mind-runtime-gaps-tracker.md.
#                   Default: $(dirname "$0")/../docs/adr/ADR-0118-hive-mind-runtime-gaps-tracker.md
#   FALLBACK_DIR  — if UPSTREAM_DIR is missing, copy from this dir instead
#                   (defaults to FORK_DIR — i.e. self-rematerialise).
#                   Logs a WARNING line so this is never the silent default.
#
# Exit codes:
#   0 — success (tree materialised, codemod applied, plugin.json/README written)
#   1 — required dependency missing (missing file, missing tool)
#   2 — codemod assertion failed (a forbidden string slipped through)
#
# Usage examples:
#   bash lib/build-hive-mind-plugin.sh
#   FORK_DIR=/tmp/ruflo-rematerialised bash lib/build-hive-mind-plugin.sh
#   UPSTREAM_DIR=/path/to/ruvnet/ruflo bash lib/build-hive-mind-plugin.sh

set -euo pipefail

# ──────────────────────────────────────────────────────────────────
# Resolve inputs
# ──────────────────────────────────────────────────────────────────

UPSTREAM_DIR="${UPSTREAM_DIR:-/Users/henrik/source/ruvnet/ruflo}"
FORK_DIR="${FORK_DIR:-/Users/henrik/source/forks/ruflo}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ADR0118_PATH="${ADR0118_PATH:-${SCRIPT_DIR}/../docs/adr/ADR-0118-hive-mind-runtime-gaps-tracker.md}"
FALLBACK_DIR="${FALLBACK_DIR:-${FORK_DIR}}"

PLUGIN_DIR="${FORK_DIR}/plugins/ruflo-hive-mind"

_log()  { printf '[build-hive-mind-plugin] %s\n' "$*" >&2; }
_warn() { printf '[build-hive-mind-plugin] WARNING: %s\n' "$*" >&2; }
_fail() { printf '[build-hive-mind-plugin] FAIL: %s\n' "$*" >&2; exit 1; }

# Decide source directory to copy from (upstream first; fallback if absent)
SRC_MODE="upstream"
SRC_DIR="$UPSTREAM_DIR"
if [[ ! -d "$UPSTREAM_DIR" ]]; then
  if [[ -d "$FALLBACK_DIR" && -d "$FALLBACK_DIR/plugins/ruflo-hive-mind" ]]; then
    _warn "UPSTREAM_DIR=$UPSTREAM_DIR not found; falling back to already-materialised state at $FALLBACK_DIR/plugins/ruflo-hive-mind (NOT the default mode — fix UPSTREAM_DIR)"
    SRC_MODE="fallback"
    SRC_DIR="$FALLBACK_DIR"
  else
    _fail "UPSTREAM_DIR=$UPSTREAM_DIR missing and no fallback at $FALLBACK_DIR/plugins/ruflo-hive-mind"
  fi
fi

if [[ ! -f "$ADR0118_PATH" ]]; then
  _fail "ADR-0118 not found at $ADR0118_PATH (status table required for annotation lifecycle)"
fi

_log "src=$SRC_MODE ($SRC_DIR)"
_log "dest=$PLUGIN_DIR"

# ──────────────────────────────────────────────────────────────────
# Source-of-truth arrays (hardcoded — drift surfaces as a fail, not silent corruption)
# ──────────────────────────────────────────────────────────────────

# Plugin path => upstream relative path. Edit only when ADR-0116 §Source-of-truth changes.
# Format: "plugin/relative/path|upstream/relative/path"
_pairs_skills=(
  "skills/hive-mind/SKILL.md|.agents/skills/hive-mind/SKILL.md"
  "skills/hive-mind-advanced/SKILL.md|v3/@claude-flow/cli/.claude/skills/hive-mind-advanced/SKILL.md"
)

_pairs_agents=(
  "agents/queen-coordinator.md|.claude/agents/hive-mind/queen-coordinator.md"
  "agents/collective-intelligence-coordinator.md|.claude/agents/hive-mind/collective-intelligence-coordinator.md"
  "agents/scout-explorer.md|.claude/agents/hive-mind/scout-explorer.md"
  "agents/swarm-memory-manager.md|.claude/agents/hive-mind/swarm-memory-manager.md"
  "agents/worker-specialist.md|.claude/agents/hive-mind/worker-specialist.md"
  "agents/v3-queen-coordinator.md|.claude/agents/v3/v3-queen-coordinator.md"
  "agents/byzantine-coordinator.md|.claude/agents/consensus/byzantine-coordinator.md"
  "agents/raft-manager.md|.claude/agents/consensus/raft-manager.md"
  "agents/gossip-coordinator.md|.claude/agents/consensus/gossip-coordinator.md"
  "agents/crdt-synchronizer.md|.claude/agents/consensus/crdt-synchronizer.md"
  "agents/quorum-manager.md|.claude/agents/consensus/quorum-manager.md"
  "agents/performance-benchmarker.md|.claude/agents/consensus/performance-benchmarker.md"
  "agents/security-manager.md|.claude/agents/consensus/security-manager.md"
  "agents/adaptive-coordinator.md|.claude/agents/swarm/adaptive-coordinator.md"
  "agents/hierarchical-coordinator.md|.claude/agents/swarm/hierarchical-coordinator.md"
  "agents/mesh-coordinator.md|.claude/agents/swarm/mesh-coordinator.md"
)

# Commands: plugin path | upstream path | description (used to generate frontmatter,
# since upstream commands don't carry frontmatter; descriptions encode the contract).
# Format: "plugin path|upstream path|description"
_pairs_commands=(
  "commands/hive-mind.md|.claude/commands/hive-mind/hive-mind.md|Hive Mind overview and dispatch entry point"
  "commands/hive-mind-init.md|.claude/commands/hive-mind/hive-mind-init.md|Initialize a hive-mind swarm with queen-led coordination"
  "commands/hive-mind-spawn.md|.claude/commands/hive-mind/hive-mind-spawn.md|Spawn a Hive Mind swarm — supports --queen-type (Strategic|Tactical|Adaptive) and --consensus (majority|weighted|byzantine|raft|gossip|crdt|quorum)"
  "commands/hive-mind-status.md|.claude/commands/hive-mind/hive-mind-status.md|Show hive-mind swarm status and worker health"
  "commands/hive-mind-stop.md|.claude/commands/hive-mind/hive-mind-stop.md|Stop a running hive-mind swarm"
  "commands/hive-mind-resume.md|.claude/commands/hive-mind/hive-mind-resume.md|Resume a checkpointed hive-mind session"
  "commands/hive-mind-memory.md|.claude/commands/hive-mind/hive-mind-memory.md|Query and manage collective hive memory across 8 memory types with TTL"
  "commands/hive-mind-metrics.md|.claude/commands/hive-mind/hive-mind-metrics.md|Show hive-mind performance and consensus metrics"
  "commands/hive-mind-consensus.md|.claude/commands/hive-mind/hive-mind-consensus.md|Run a consensus vote across hive workers (Majority|Weighted|Byzantine|Raft|Gossip|CRDT|Quorum)"
  "commands/hive-mind-sessions.md|.claude/commands/hive-mind/hive-mind-sessions.md|Manage hive-mind sessions: list, checkpoint, export, import"
  "commands/hive-mind-wizard.md|.claude/commands/hive-mind/hive-mind-wizard.md|Interactive wizard for hive-mind setup and tuning"
)

# allowed-tools strings injected into skill frontmatter (skill name → line value)
_skill_allowed_tools__hive_mind='Bash(npx *) Read mcp__ruflo__hive-mind_init mcp__ruflo__hive-mind_spawn mcp__ruflo__hive-mind_status mcp__ruflo__hive-mind_consensus'
_skill_allowed_tools__hive_mind_advanced='Bash(npx *) Read Write Edit Grep Glob mcp__ruflo__hive-mind_init mcp__ruflo__hive-mind_spawn mcp__ruflo__hive-mind_status mcp__ruflo__hive-mind_join mcp__ruflo__hive-mind_leave mcp__ruflo__hive-mind_consensus mcp__ruflo__hive-mind_broadcast mcp__ruflo__hive-mind_shutdown mcp__ruflo__hive-mind_memory mcp__ruflo__memory_store mcp__ruflo__memory_search Agent Task'

# Per-command Tn assignments (which Tns each annotated command is gated on).
# Files NOT listed here ship with no implementation-status annotation.
# Format: "filename|comma-separated Tns"
_command_tn_map=(
  "hive-mind-consensus.md|T1,T2,T3"
  "hive-mind-memory.md|T4,T5"
  "hive-mind-sessions.md|T6"
  "hive-mind-resume.md|T6"
)

# Per-command verdict (used when ANY of the file's Tns are still active).
# Once all listed Tns are `complete`, the field is omitted entirely.
# Hardcoded per the ADR-0116 verdict table:
#   consensus → partial (consensus ENGINE works; just missing 3 voting modes)
#   memory    → partial (basic get/set works; types + TTL absent)
#   sessions  → missing (entire checkpoint/resume/export/import absent)
#   resume    → missing (same)
_command_verdict_active__hive_mind_consensus="partial"
_command_verdict_active__hive_mind_memory="partial"
_command_verdict_active__hive_mind_sessions="missing"
_command_verdict_active__hive_mind_resume="missing"

# Gap matrix rows (ADR-0116 verification matrix). Order is fixed by ADR.
# Format: "Tn|status_glyph|feature|evidence"
_gap_matrix=(
  "T1|✗|Weighted consensus (Queen 3x)|missing from \`ConsensusStrategy\` enum|\`mcp-tools/hive-mind-tools.ts:35\`"
  "T2|✗|Gossip consensus|missing from \`ConsensusStrategy\` enum|\`mcp-tools/hive-mind-tools.ts:35,518\`"
  "T3|✗|CRDT consensus|missing from \`ConsensusStrategy\` enum|\`mcp-tools/hive-mind-tools.ts:35,518\`"
  "T4|✗|8 Memory types + TTLs|flat dict, no TTL|\`mcp-tools/hive-mind-tools.ts:937-1010\`"
  "T5|✗|LRU + SQLite WAL backend|JSON file persistence|\`loadHiveState\`/\`saveHiveState\`"
  "T6|✗|Session checkpoint/resume/export/import|command surfaces only|\`commands/hive-mind/{sessions,resume}.md\`"
  "T7|⚠|Queen-type behaviour|prompt-string substitution only|\`commands/hive-mind.ts:75,88\`"
  "T8|⚠|Worker-type behaviour|display grouping + 4 scoring nudges|\`swarm/src/queen-coordinator.ts:1248-1251\`"
  "T9|⚠|Adaptive topology (auto-scaling)|config flag only|\`swarm/src/unified-coordinator.ts:585\`"
  "T10|⚠|5 swarm topologies|prompt-string substitution only|\`commands/hive-mind.ts:77,92\`"
)

# ──────────────────────────────────────────────────────────────────
# Parse ADR-0118 §Status — produce T_STATUS associative-array
# ──────────────────────────────────────────────────────────────────
# Status values: open | in-progress | escalated-to-adr | complete

declare -A T_STATUS

_parse_adr0118_status() {
  local in_status=0 line tn status
  while IFS= read -r line; do
    if [[ "$line" =~ ^##[[:space:]]+Status[[:space:]]*$ ]]; then
      in_status=1
      continue
    fi
    if (( in_status )) && [[ "$line" =~ ^##[[:space:]] ]]; then
      break
    fi
    if (( in_status )); then
      # Match `| T1 | ADR-0119 | complete | ...` rows
      if [[ "$line" =~ ^\|[[:space:]]*(T[0-9]+)[[:space:]]*\|[[:space:]]*ADR-[0-9]+[[:space:]]*\|[[:space:]]*([a-z-]+)[[:space:]]*\| ]]; then
        tn="${BASH_REMATCH[1]}"
        status="${BASH_REMATCH[2]}"
        T_STATUS["$tn"]="$status"
      fi
    fi
  done < "$ADR0118_PATH"

  # Defensive fallbacks: if the table omits any T1..T10 row, treat as `open`.
  local t
  for t in T1 T2 T3 T4 T5 T6 T7 T8 T9 T10; do
    if [[ -z "${T_STATUS[$t]+x}" ]]; then
      _warn "ADR-0118 §Status missing $t row — defaulting to 'open'"
      T_STATUS["$t"]="open"
    fi
  done
}

# Returns 0 (true) if ALL Tns in the comma-separated arg list are `complete`.
_all_tns_complete() {
  local list="$1" t
  IFS=',' read -ra arr <<< "$list"
  for t in "${arr[@]}"; do
    if [[ "${T_STATUS[$t]:-open}" != "complete" ]]; then return 1; fi
  done
  return 0
}

# Returns 0 if Tn is "active" — needs to keep its README row + frontmatter.
# Active means status is one of: open | in-progress | escalated-to-adr.
_tn_active() {
  local t="$1" s="${T_STATUS[$1]:-open}"
  case "$s" in
    open|in-progress|escalated-to-adr) return 0 ;;
    *) return 1 ;;
  esac
}

# Returns "partial"|"missing"|"" for a given command basename.
# Empty if all listed Tns are `complete` (annotation lifted).
# Otherwise picks the hardcoded verdict from _command_verdict_active__*.
_command_status() {
  local basename_no_ext="$1" list="$2"
  if _all_tns_complete "$list"; then
    echo ""
    return 0
  fi
  # Translate dashes to underscores for the variable lookup.
  local var_name="_command_verdict_active__${basename_no_ext//-/_}"
  echo "${!var_name:-partial}"
}

# ──────────────────────────────────────────────────────────────────
# Codemod helpers — applied after every file copy
# ──────────────────────────────────────────────────────────────────
# Substitutions (ADR-0113 + ADR-0117):
#   - `npx claude-flow `         → `npx @sparkleideas/cli@latest `
#   - `claude-flow@alpha`        → `@sparkleideas/cli@latest`
#   - `mcp__claude-flow__`       → `mcp__ruflo__`
#
# Sed delimiter chosen as `|` to avoid escaping `/` paths.

_codemod_inplace() {
  local f="$1"
  # Use perl: portable across macOS/Linux (no -i'' quirks), supports atomic write.
  perl -i -pe '
    s|npx claude-flow |npx \@sparkleideas/cli\@latest |g;
    s|claude-flow\@alpha|\@sparkleideas/cli\@latest|g;
    s|mcp__claude-flow__|mcp__ruflo__|g;
  ' "$f"
}

# ──────────────────────────────────────────────────────────────────
# Skill copy + allowed-tools injection
# ──────────────────────────────────────────────────────────────────
# Both skills upstream have closing `---` frontmatter terminator. Insert the
# allowed-tools line on the line BEFORE the closing `---`.

_emit_skill() {
  local plugin_rel="$1" upstream_rel="$2" allowed_tools="$3"
  local src dst
  if [[ "$SRC_MODE" == "upstream" ]]; then
    src="${SRC_DIR}/${upstream_rel}"
  else
    src="${SRC_DIR}/plugins/ruflo-hive-mind/${plugin_rel}"
  fi
  dst="${PLUGIN_DIR}/${plugin_rel}"
  [[ -f "$src" ]] || _fail "skill source missing: $src"
  mkdir -p "$(dirname "$dst")"

  if [[ "$SRC_MODE" == "fallback" ]]; then
    # Already-materialised tree → copy verbatim, no transformations.
    cp "$src" "$dst"
    return
  fi

  # Pre-codemod copy
  cp "$src" "$dst"

  # Inject allowed-tools line before the closing `---`. Skip if already present.
  if ! grep -q '^allowed-tools:' "$dst"; then
    awk -v at="allowed-tools: ${allowed_tools}" '
      BEGIN { fm_open=0; injected=0 }
      NR==1 && $0=="---" { print; fm_open=1; next }
      fm_open && $0=="---" && !injected {
        print at; print; fm_open=0; injected=1; next
      }
      { print }
    ' "$dst" > "${dst}.tmp"
    mv "${dst}.tmp" "$dst"
  fi

  _codemod_inplace "$dst"
}

# ──────────────────────────────────────────────────────────────────
# Agent copy + model: sonnet injection + trailing-newline fix
# ──────────────────────────────────────────────────────────────────

_emit_agent() {
  local plugin_rel="$1" upstream_rel="$2"
  local src dst
  if [[ "$SRC_MODE" == "upstream" ]]; then
    src="${SRC_DIR}/${upstream_rel}"
  else
    src="${SRC_DIR}/plugins/ruflo-hive-mind/${plugin_rel}"
  fi
  dst="${PLUGIN_DIR}/${plugin_rel}"
  [[ -f "$src" ]] || _fail "agent source missing: $src"
  mkdir -p "$(dirname "$dst")"

  cp "$src" "$dst"
  if [[ "$SRC_MODE" == "fallback" ]]; then return; fi

  # Inject `model: sonnet` before closing frontmatter `---`. Skip if present.
  if ! grep -q '^model:' "$dst"; then
    awk '
      BEGIN { fm_open=0; injected=0 }
      NR==1 && $0=="---" { print; fm_open=1; next }
      fm_open && $0=="---" && !injected {
        print "model: sonnet"; print; fm_open=0; injected=1; next
      }
      { print }
    ' "$dst" > "${dst}.tmp"
    mv "${dst}.tmp" "$dst"
  fi

  # Ensure file ends with exactly one trailing newline (some upstream files
  # truncate at the last char). Use xxd because $() strips trailing \n,
  # making string comparison unreliable.
  if [[ -s "$dst" ]]; then
    local last_hex
    last_hex=$(tail -c 1 "$dst" | xxd -p)
    # 0a = \n. If absent, append one.
    if [[ "$last_hex" != "0a" ]]; then
      printf '\n' >> "$dst"
    fi
  fi

  _codemod_inplace "$dst"
}

# ──────────────────────────────────────────────────────────────────
# Command copy + frontmatter generation + memory.md special block
# ──────────────────────────────────────────────────────────────────
# Upstream commands have NO frontmatter. We synthesise it from the
# _pairs_commands description column. The 4 annotated files additionally get
# `implementation-status:` + `gap-tracker:` lines, gated on ADR-0118 §Status.

_command_tns_for() {
  # Look up the comma-separated Tn list for a command filename.
  # Returns empty string if the filename is not in _command_tn_map.
  local needle="$1" pair name tns
  for pair in "${_command_tn_map[@]}"; do
    name="${pair%%|*}"
    tns="${pair##*|}"
    if [[ "$name" == "$needle" ]]; then
      echo "$tns"
      return 0
    fi
  done
  echo ""
}

_format_gap_tracker_yaml() {
  # Convert "T1,T2,T3" → "[ADR-0118-T1, ADR-0118-T2, ADR-0118-T3]"
  local list="$1" t out=""
  IFS=',' read -ra arr <<< "$list"
  for t in "${arr[@]}"; do
    [[ -n "$out" ]] && out="$out, "
    out="${out}ADR-0118-${t}"
  done
  echo "[${out}]"
}

_memory_table_block() {
  # Reusable USERGUIDE-contract block appended to hive-mind-memory.md.
  # Always present (AC #9 enforces it). The trailing implementation-status
  # blockquote is added separately when at least one of T4/T5 is still active.
  cat <<'EOF'

## Collective Memory Types (USERGUIDE contract)

| Type | TTL | Purpose |
|---|---|---|
| `knowledge` | permanent | Long-term shared facts and learned patterns |
| `context` | 1h | Short-lived working context |
| `task` | 30min | Active task state |
| `result` | permanent | Task outcomes |
| `error` | 24h | Failure traces |
| `metric` | 1h | Performance metrics |
| `consensus` | permanent | Decisions reached via voting |
| `system` | permanent | Hive infrastructure state |
EOF
}

_memory_status_block() {
  # Appended after the table when T4 or T5 is still active.
  cat <<'EOF'

> **Implementation status**: `partial` — see ADR-0118 T4 (memory types + TTLs) and T5 (LRU + SQLite WAL backend). The current MCP backend exposes a flat key/value dict with no type discriminator or TTL.
EOF
}

_emit_command() {
  local plugin_rel="$1" upstream_rel="$2" description="$3"
  local src dst basename
  basename=$(basename "$plugin_rel")
  if [[ "$SRC_MODE" == "upstream" ]]; then
    src="${SRC_DIR}/${upstream_rel}"
  else
    src="${SRC_DIR}/plugins/ruflo-hive-mind/${plugin_rel}"
  fi
  dst="${PLUGIN_DIR}/${plugin_rel}"
  [[ -f "$src" ]] || _fail "command source missing: $src"
  mkdir -p "$(dirname "$dst")"

  if [[ "$SRC_MODE" == "fallback" ]]; then
    cp "$src" "$dst"
    return
  fi

  # Determine frontmatter contents
  local name="${basename%.md}"
  local tns; tns=$(_command_tns_for "$basename")
  local impl_status=""
  if [[ -n "$tns" ]]; then
    impl_status=$(_command_status "$name" "$tns")
  fi

  {
    printf -- '---\n'
    printf 'name: %s\n' "$name"
    printf 'description: %s\n' "$description"
    if [[ -n "$impl_status" ]]; then
      printf 'implementation-status: %s\n' "$impl_status"
      printf 'gap-tracker: %s\n' "$(_format_gap_tracker_yaml "$tns")"
    fi
    printf -- '---\n\n'
    cat "$src"
    # Special-case appendices (these live ONLY in the plugin, not upstream):
    # hive-mind-memory.md: 8-memory-type contract block (always appended);
    # implementation-status blockquote when T4/T5 still active.
    if [[ "$basename" == "hive-mind-memory.md" ]]; then
      _memory_table_block
      if _tn_active T4 || _tn_active T5; then
        _memory_status_block
      fi
    fi
    # hive-mind-stop.md: anchor required by ADR-0116 AC #11 (USERGUIDE
    # §Hive-Mind Coordination block names `hive-mind stop` separately from
    # the §CLI Commands list). The upstream body uses `hive-mind hive-mind-stop`
    # (double-prefix) which doesn't satisfy the anchor — append a canonical line.
    if [[ "$basename" == "hive-mind-stop.md" ]]; then
      printf '\nCanonical invocation: `npx @sparkleideas/cli@latest hive-mind stop`\n'
    fi
  } > "$dst"

  _codemod_inplace "$dst"
}

# ──────────────────────────────────────────────────────────────────
# plugin.json (deterministic generation)
# ──────────────────────────────────────────────────────────────────

_emit_plugin_json() {
  local dst="${PLUGIN_DIR}/.claude-plugin/plugin.json"
  mkdir -p "$(dirname "$dst")"
  # Use a node one-liner so we get jq-compatible JSON without a jq dependency.
  node -e '
    const obj = {
      name: "ruflo-hive-mind",
      description: "Queen-led hive-mind collective intelligence — skills, agents, and commands for Byzantine/Raft/Gossip consensus, collective memory, and worker specialization",
      version: "0.1.0",
      author: { name: "Henrik Pettersen", url: "https://github.com/sparkling" },
      homepage: "https://github.com/sparkling/ruflo",
      license: "MIT",
      keywords: ["ruflo", "hive-mind", "queen-worker", "consensus", "collective-intelligence", "byzantine"]
    };
    process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
  ' > "$dst"
}

# ──────────────────────────────────────────────────────────────────
# README.md (skeleton + filtered gap matrix)
# ──────────────────────────────────────────────────────────────────

_emit_readme() {
  local dst="${PLUGIN_DIR}/README.md"
  mkdir -p "$(dirname "$dst")"

  # Build active-row list
  local rows=()
  local entry tn glyph feat ev1 ev2 evidence
  for entry in "${_gap_matrix[@]}"; do
    IFS='|' read -r tn glyph feat ev1 ev2 <<< "$entry"
    if _tn_active "$tn"; then
      # Combined evidence cell preserves any embedded `|` from the matrix
      evidence="$ev1"
      [[ -n "${ev2:-}" ]] && evidence="$evidence|$ev2"
      rows+=("| ${feat} | ${glyph} ${ev1} | ${ev2} | ADR-0118 ${tn} |")
    fi
  done

  {
    printf '# ruflo-hive-mind\n\n'
    printf 'Queen-led collective intelligence with consensus mechanisms for sparkling/ruflo.\n\n'
    printf '## Install\n\n'
    printf '    /plugin marketplace add sparkling/ruflo\n'
    printf '    /plugin install ruflo-hive-mind@ruflo\n\n'
    printf "## What's in the box\n\n"
    printf '%s\n' '- 2 skills: `hive-mind`, `hive-mind-advanced`'
    printf '%s\n' '- 16 agents (hive coordination, consensus, topology)'
    printf '%s\n\n' '- 11 slash commands'
    printf '## USERGUIDE contract\n\n'
    printf 'This plugin materialises everything the upstream USERGUIDE advertises for hive-mind. See `docs/USERGUIDE.md` (upstream) §Hive Mind for the full surface.\n\n'
    printf '## Known gaps vs. USERGUIDE\n\n'
    if (( ${#rows[@]} == 0 )); then
      printf 'All USERGUIDE-advertised features have runtime support. ADR-0118 §Status reports every tracked task as `complete`. The next review cycle may reopen items if upstream reflows.\n'
    else
      printf 'The following USERGUIDE-advertised features ship as documentation only — runtime support is partial or missing. Tracked in ADR-0118.\n\n'
      printf '| Feature | Status | Evidence | Tracker |\n'
      printf '|---|---|---|---|\n'
      local row
      for row in "${rows[@]}"; do
        printf '%s\n' "$row"
      done
      printf '\n'
      printf 'When ADR-0118 closes a row, the materialise script removes the row from this README and the corresponding annotation from the relevant command file.\n'
    fi
  } > "$dst"
}

# ──────────────────────────────────────────────────────────────────
# Codemod assertion (post-write fail-safe)
# ──────────────────────────────────────────────────────────────────

_assert_codemod_clean() {
  # Forbidden post-codemod strings: `mcp__claude-flow__`, `claude-flow@alpha`,
  # `npx claude-flow ` (legacy CLI). `@claude-flow/cli@latest` is the
  # POST-codemod string; permitted.
  # NOTE: grep returns 1 when no match, which trips `set -e`. Use `|| true`.
  local hits2 hits3 hits4
  hits2=$( { grep -rE 'mcp__claude-flow__' "$PLUGIN_DIR" 2>/dev/null || true; } | wc -l | tr -d ' ')
  hits3=$( { grep -rE '\bclaude-flow@alpha\b' "$PLUGIN_DIR" 2>/dev/null || true; } | wc -l | tr -d ' ')
  hits4=$( { grep -rE 'npx claude-flow ' "$PLUGIN_DIR" 2>/dev/null || true; } | wc -l | tr -d ' ')
  hits2="${hits2:-0}"; hits3="${hits3:-0}"; hits4="${hits4:-0}"

  if [[ "$hits2" != "0" || "$hits3" != "0" || "$hits4" != "0" ]]; then
    _log "codemod assertion FAILED: mcp__claude-flow__=$hits2 claude-flow@alpha=$hits3 npx_claude-flow=$hits4"
    exit 2
  fi
}

# ──────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────

_main() {
  _parse_adr0118_status

  # Wipe + recreate plugin tree so removed sources don't persist
  if [[ -d "$PLUGIN_DIR" ]]; then
    rm -rf "$PLUGIN_DIR"
  fi
  mkdir -p "$PLUGIN_DIR/.claude-plugin" "$PLUGIN_DIR/agents" "$PLUGIN_DIR/commands" "$PLUGIN_DIR/skills"

  # Skills (special: per-skill allowed-tools)
  local pair plugin_rel upstream_rel
  for pair in "${_pairs_skills[@]}"; do
    plugin_rel="${pair%%|*}"
    upstream_rel="${pair##*|}"
    case "$plugin_rel" in
      skills/hive-mind/SKILL.md)          _emit_skill "$plugin_rel" "$upstream_rel" "$_skill_allowed_tools__hive_mind" ;;
      skills/hive-mind-advanced/SKILL.md) _emit_skill "$plugin_rel" "$upstream_rel" "$_skill_allowed_tools__hive_mind_advanced" ;;
      *) _fail "unknown skill: $plugin_rel" ;;
    esac
  done

  # Agents
  for pair in "${_pairs_agents[@]}"; do
    plugin_rel="${pair%%|*}"
    upstream_rel="${pair##*|}"
    _emit_agent "$plugin_rel" "$upstream_rel"
  done

  # Commands
  local cdesc
  for pair in "${_pairs_commands[@]}"; do
    plugin_rel="${pair%%|*}"
    local rest="${pair#*|}"
    upstream_rel="${rest%%|*}"
    cdesc="${rest#*|}"
    _emit_command "$plugin_rel" "$upstream_rel" "$cdesc"
  done

  # Manifests
  _emit_plugin_json
  _emit_readme

  _assert_codemod_clean

  _log "OK: plugin tree materialised at $PLUGIN_DIR"
}

_main "$@"
