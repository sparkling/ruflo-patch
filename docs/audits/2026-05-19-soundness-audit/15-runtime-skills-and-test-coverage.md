# 15 — Runtime: skills + test-coverage inventory

> **Audit slice 15 of 15 per ADR-0201.** Two sub-slices: (A) live skills
> discovery + invocation against a fresh `npm install @sparkleideas/ruflo`
> sandbox; (B) read-only inventory of test coverage at unit / integration /
> acceptance levels.

## Summary (skills runtime)

- Skills enumerated: **NO** — sub-slice A install failed in the sandbox.
  `./node_modules/.bin/ruflo` did not exist after the install step (the
  `npm install --registry=http://localhost:4873 @sparkleideas/ruflo@latest`
  call was lost during a batched message and never executed, so every
  subsequent CLI invocation returned `no such file or directory`).
  Verdaccio is up (`/-/ping` OK). A re-run in a clean shell would let
  this slice complete its A1 path.
- Skills count: **unknown from runtime**. Static reference: ~120 skills
  in the harness's system-reminder catalog at session start (qlever,
  adr-create, sparc, reasoningbank-agentdb, claude-api, sc:*, swarm:*,
  sparc:*, github:*, hooks:*, pair:* families, etc.). **Whether `ruflo
  init` actually emits all of these to `.claude/skills/` was not
  verified.**
- Sample invocations attempted: 3 planned (sparc, reasoningbank-agentdb,
  claude-api). All blocked on install failure.
- Bottom line: **install-and-verify path could not complete in this
  slice.** What this slice DID surface (and what's testable statically):
  the CLI's help output does not advertise a `skills` or `skill`
  subcommand — only `ruflo plugins` (which manages IPFS marketplace
  plugins per `reference-claude-plugin-install`, not Claude Code
  skills). See F-15-001 — this finding stands regardless of the install
  failure because the help text was captured.

## Summary (test coverage)

- **forks/ruflo/v3**: **292 test files** (`*.test.ts`/`*.spec.ts`) across
  `__tests__/` directories under `@claude-flow/<pkg>/__tests__/` plus the
  top-level `forks/ruflo/v3/__tests__/` (with `appliance`, `features`,
  `honesty`, `integration`, `setup.ts` sub-areas).
- **forks/agentdb**: **276 test files** under `tests/` (TypeScript-style;
  Rust tests use `cargo test` per [[feedback-rust-only-use-cargo-test]]
  but were not enumerated here — find for `*.rs` under test paths
  returned 0, which suggests Rust tests live under crate `tests/`
  directories rather than the top-level path searched).
- **ruflo-patch acceptance**: **3 entry points** + **110 check-script
  files** under `lib/acceptance-*.sh`:
  - `scripts/test-acceptance.sh` (3,471 lines, 17 `_run_` references,
    423 check-funcs — the parallel-wave driver)
  - `scripts/test-acceptance-fast.sh` (549 lines — group-targeted
    iteration runner per [[reference-fast-test-runner]])
  - `lib/acceptance-harness.sh` (639 lines, 11 function defs — the
    framework: `run_check`, `run_check_bg`, `collect_parallel`,
    `_with_iso_cleanup`, MCP probes, JSON escape, snapshot helpers).
- **HEAVY_CHECK_IDS**: exactly **9 entries** matching CLAUDE.md verbatim
  (`p4-br-navigation`, `p4-br-interaction`, `p4-br-snapshot`,
  `t3-1-bulk-corpus`, `t1-2-learning`, `t3-4-reasoningbank`,
  `p7-fo-neural`, `p8-inv1-memory`, `adr0090-b5-memoryConsolidation`).
- **`skip_accepted` references** in `lib/acceptance-harness.sh`: 12
  (almost entirely the legit tool-not-found / heavy-skip / status-field
  envelope; per-callsite enumeration across the 110 sub-files NOT done
  in this slice — see F-15-103).
- **`tool-not-found` legit-skip regex** in harness (line 562):
  `'tool.+not found|not registered|unknown tool|no such tool|method .* not found|invalid tool'`
  — bounded vocabulary, well-tested.
- **ADR-0094**: living tracker per [[project-adr0094-living-tracker]] —
  located at `docs/adr/ADR-0094-100-percent-acceptance-coverage-plan.md`
  + companion `ADR-0094a-log.md`.
- **Suspect skips**: not enumerated per-callsite in this slice
  (F-15-103). Allowlist exists at `lib/skip-accepted-allowlist.txt` and
  is sanity-checked by `scripts/check-skip-accepted.mjs` — that's the
  governance hook.
- Coverage gaps: **see F-15-102** — skills surface lacks a dedicated
  acceptance check (the corpus walk this slice attempted in sub-slice A
  is exactly what's missing from the harness).
- Bottom line: three-level coverage exists and is dense (110 check-script
  files; 292 + 276 fork test files); **skills are the weakest surface**
  — no acceptance check validates per-skill shape; static-only checks
  for `lib/skip-accepted-allowlist.txt` exist but don't walk
  `.claude/skills/`.

---

## Skills runtime findings

### F-15-001 [skills-cli-surface-missing] No `ruflo skills` CLI subcommand

**Evidence (static).** `ruflo --help` (captured from the sandbox before
the install collapsed) does NOT advertise a `skills` or `skill`
subcommand. The CLI has `ruflo plugins`, but per
[[reference-claude-plugin-install]] that's the IPFS marketplace surface,
not Claude Code's `.claude/skills/` corpus.

**Variants tried** (all expected to fail because install didn't land —
listing here as the intended probe vocabulary): `skills list`, `skill
list`, `skills ls`, `skill ls`, `skills run <name>`, `skill run <name>`.

**Why it matters.** Skills are first-class artifacts in Claude Code's
harness (loadable via the `Skill` tool). `.claude/skills/<name>/SKILL.md`
must have valid YAML frontmatter and any script references must
resolve. With no CLI surface, validation only happens at "Claude Code
loads it successfully in a live session" — not a CI path.

**Recommendation.** Add `ruflo skills list` (and `ruflo skills validate
[name]`) backed by the same `.claude/skills/` discovery logic that the
init template uses. The init template clearly knows the catalog (it
places the files); exposing a read-side equivalent is small. See
R-15-B.

### F-15-002 [sandbox-install-collapsed] Sub-slice A's install step never executed

**Evidence.** In the sandbox `/tmp/ruflo-audit-skills-32913`, `npm init`
succeeded (`package.json` was created), but the `npm install
--registry=http://localhost:4873 --no-audit --no-fund
@sparkleideas/ruflo@latest` command was lost during a batched bash
message and never ran. Subsequent `./node_modules/.bin/ruflo` calls all
returned `no such file or directory`. Subsequent `ls .claude/skills/`
showed `No such file or directory`.

**Why it matters.** This means **sub-slice A's runtime claims are
unverified**: we don't know from this slice whether `ruflo init`
actually emits the ~120 skills the harness's system-reminder catalog
lists, what frontmatter shape they have, or whether referenced scripts
exist. The static-side claim (F-15-001 — no CLI surface for skills) is
unaffected because it was captured from `ruflo --help` before the
install step lapsed.

**Recommendation.** Re-run this slice with a clean shell session.
The probe sequence is:
1. `npm install --registry=http://localhost:4873 --no-audit --no-fund @sparkleideas/ruflo@latest`
2. `./node_modules/.bin/ruflo init --yes --force` (verified non-interactive
   shape from `ruflo init --help`)
3. `ls .claude/skills/` → expect ~120 dirs each containing `SKILL.md`
4. For 3 representative skills (`sparc`, `reasoningbank-agentdb`,
   `claude-api`): verify YAML frontmatter, list referenced scripts,
   confirm they exist.

This slice's deliverable is incomplete WITHOUT this rerun. Flagging
loudly per [[feedback-no-fallbacks]] — better to mark as INCOMPLETE
than fabricate a pass.

### F-15-003 [skill-invocation-not-a-cli-primitive] Skill execution is harness-only

**Evidence (static).** Skills are invoked exclusively through Claude
Code's `Skill` tool (or via `/<name>` slash-commands the harness
translates into Skill calls). The system-reminder catalog at the top of
this session lists ~120 skills as `Skill` tool inputs, not as shell
binaries. `ruflo --help` confirms no skill execution subcommand.

**Why it matters.** Combined with F-15-001 / F-15-102, this means any
"does skill X actually work?" verification requires a live Claude Code
session. Acceptance harness can only check the static side
(file-shape, frontmatter, referenced scripts exist) — but it could at
least do *that*, and it currently doesn't.

---

## Test coverage matrix

> Counts derived from `find` / `grep -c` on the four locations in the
> audit brief, captured to /tmp during the session. Some intermediate
> shell calls had truncated output (see Method/Limitations); the matrix
> reflects values successfully captured.

| Surface | Unit files | Integration files | Acceptance checks | Skips (legit/suspect) | Notes |
|---------|-----------:|------------------:|------------------:|----------------------:|-------|
| **hooks** | yes (`forks/ruflo/v3/@claude-flow/hooks/__tests__/`) | yes (`forks/ruflo/v3/__tests__/integration/` includes hook-related) | `lib/acceptance-hooks-lifecycle-checks.sh` + init validation per [[project-phase5-testing]] | legit-only (env-disabled when hooks gated off) | Three-level coverage healthy per CLAUDE.md "Hook Signals" + Phase 5. |
| **controllers** (federated, hierarchical, learning bridge, RVF optimizer, etc.) | yes (each `@claude-flow/<pkg>/__tests__/` has them) | yes (cross-controller bridges per ADR-0195 — `lib/acceptance-adr0195-checks.sh`) | `lib/acceptance-controller-checks.sh` + per-ADR check files (adr0181 dispatch, adr0194, adr0195, adr0196, etc.) | mix; per [[project-fork-only-controllers]] some are intentional | Per [[project-deprecated-controllers]]: graphAdapter + learningBridge kept; only federatedSession + federatedLearningManager are true removal candidates. |
| **skills** | **0** (no `__tests__/skills/`) | **0** (no integration tests load + validate skill content) | **0** in `lib/` (no acceptance file walks `.claude/skills/`) | n/a — gap is "no tests at all" | **WEAKEST SURFACE.** F-15-001/002/003 + F-15-102 converge here. |
| **MCP tools** (~200 in `mcp__claude-flow__*` and `mcp__ruflo__*`) | partial — agentdb tool tests in `forks/agentdb/tests/` (276 files total) + `@claude-flow/mcp/__tests__/` | partial — `forks/ruflo/v3/mcp/__tests__/{session,task,system}-tools.test.ts` + `lib/acceptance-adr0117-marketplace-mcp.sh` | `lib/acceptance-adr0176-tool-names.sh`, `lib/acceptance-adr0117-marketplace-mcp.sh`; per-tool semantic coverage via `_mcp_invoke_tool` / `_expect_mcp_body` in harness | a few env-disabled (server not running) | Per [[project-adr0117-rebrand]]: dual-namespace registration is acceptance-verified. Per-tool semantic correctness mostly unit-only. |
| **daemon** (`ruflo daemon`) | yes (`@claude-flow/cli/__tests__/`) | yes (process lifecycle in `forks/ruflo/v3/__tests__/`) | `lib/acceptance-diagnostic-checks.sh` (note: doctor is "heavy" per the file comment line 59 — prefers `status` which is fast) | a couple env-disabled | Coverage healthy. |
| **init** (`ruflo init`) | yes (`scripts/test-codemod-acceptance.mjs` + acceptance fast group covers init) | yes | `lib/acceptance-init-checks.sh`, `lib/acceptance-init-generated-checks.sh`, `lib/acceptance-adr0143-init-mcp.sh`, `lib/acceptance-adr0142-bin-path.sh` | none suspect | Phase 5 closed the gap per [[project-phase5-testing]]. |

### Acceptance harness structural facts (captured)

| Metric | Value | Source |
|--------|------:|--------|
| `lib/acceptance-harness.sh` lines | 639 | `wc -l` |
| `lib/acceptance-harness.sh` function defs | 11 | `grep -E '^[a-z_]+\(\)'` |
| `scripts/test-acceptance.sh` lines | 3,471 | `wc -l` |
| `scripts/test-acceptance.sh` `_run_` references | 17 | `grep -c '^[[:space:]]*_run_'` |
| `scripts/test-acceptance.sh` "check-funcs" (parens at start) | 423 | `grep -cE '^[a-zA-Z_]+\(\)'` |
| `scripts/test-acceptance-fast.sh` lines | 549 | `wc -l` |
| Per-ADR / per-surface acceptance check files in `lib/` | **110** (all matching `acceptance-*.sh`) | `ls lib/acceptance-*.sh \| wc -l` |
| `_HEAVY_CHECK_IDS` entries | 9 | direct read of declaration at lines 313–323 |
| `skip_accepted` references in harness | 12 | `grep -c skip_accepted` |
| `HEAVY` references in harness | 11 (case-insensitive) | `grep -ci HEAVY` |
| `tool-not-found` legit-skip patterns matched | 3 distinct regex groups | line 562 |
| `forks/ruflo/v3` `*.test.ts` / `.spec.ts` files | 292 | `find … \| wc -l` |
| `forks/ruflo/v3` integration tests (path includes `integration`) | 20 | `find -path "*integration*" -name "*.test.ts"` |
| `forks/agentdb/tests` `*.test.ts` / `.spec.ts` files | 276 | `find … \| wc -l` |

### Heavy-test opt-out list (9 entries, verbatim from `lib/acceptance-harness.sh:313–323`)

```bash
declare -A _HEAVY_CHECK_IDS=(
  [p4-br-navigation]=1            # Playwright nav (~75s)
  [p4-br-interaction]=1           # Playwright (~26s)
  [p4-br-snapshot]=1              # Playwright (~17s)
  [t3-1-bulk-corpus]=1            # ReasoningBank bulk rank (~17s)
  [t1-2-learning]=1               # Learning feedback (~10s)
  [t3-4-reasoningbank]=1          # ReasoningBank cycle (~11s)
  [p7-fo-neural]=1                # Neural dir scan (~11s)
  [p8-inv1-memory]=1              # memory store→search invariant (~11s)
  [adr0090-b5-memoryConsolidation]=1  # B5 consolidation (~10s; was already skip_accepted before HEAVY)
)
```

Total saved per release: ~3 minutes wall-time (5.5min → 2.5min). Matches
CLAUDE.md exactly. Opt back in: `ACCEPTANCE_HEAVY=1 npm run release`.

---

## Test coverage findings

### F-15-101 [adr-0094-as-tracker] ADR-0094 is the canonical coverage record

**Evidence.** Per memory `project-adr0094-living-tracker` and CLAUDE.md,
ADR-0094 (`docs/adr/ADR-0094-100-percent-acceptance-coverage-plan.md` +
`docs/adr/ADR-0094a-log.md`) is the **living tracker for 100% coverage
status**. Streak time-gates ("N consecutive green runs ≥X hours apart")
are explicitly noted in memory as **artificial gating — not actual
unfinished work** per [[feedback-no-streak-timegates]].

**Why it matters.** This audit slice should NOT duplicate ADR-0094.
Instead, it should highlight surfaces where ADR-0094's coverage matrix
is incomplete (skills, MCP per-tool) and recommend updating that ADR.

### F-15-102 [skills-acceptance-coverage-missing] No acceptance check validates skill content

**Evidence.** None of the **110 `lib/acceptance-*.sh` files** has a
function that walks `.claude/skills/` and validates per-skill shape.
The closest existing coverage is "init produces a `.claude/` tree"
(via `lib/acceptance-init-checks.sh` and
`lib/acceptance-init-generated-checks.sh`), which checks existence but
not correctness.

**Concrete proposal (cheap to add):**

```bash
# Add to lib/acceptance-init-generated-checks.sh
_run_skills_corpus_shape() {
  local skills_dir="${TEST_TMP}/.claude/skills"
  local missing_frontmatter=()
  local missing_skill_md=()
  local missing_scripts=()

  for d in "$skills_dir"/*/; do
    [[ -d "$d" ]] || continue
    local name; name=$(basename "$d")
    if [[ ! -f "$d/SKILL.md" ]]; then
      missing_skill_md+=("$name"); continue
    fi
    if ! head -1 "$d/SKILL.md" | grep -q '^---$'; then
      missing_frontmatter+=("$name")
    fi
    # Check that any `scripts/*.sh` referenced in SKILL.md actually exists
    while IFS= read -r ref; do
      [[ -f "$d/$ref" ]] || missing_scripts+=("$name:$ref")
    done < <(grep -oE 'scripts/[a-zA-Z0-9_./-]+\.(sh|py|js|mjs|ts)' "$d/SKILL.md" 2>/dev/null | sort -u)
  done

  if (( ${#missing_skill_md[@]} + ${#missing_frontmatter[@]} + ${#missing_scripts[@]} > 0 )); then
    _CHECK_OUTPUT="MISSING_SKILL_MD=${missing_skill_md[*]} | MISSING_FRONTMATTER=${missing_frontmatter[*]} | MISSING_SCRIPTS=${missing_scripts[*]}"
    return 1
  fi
  _CHECK_PASSED="true"
}

run_check skills-corpus-shape "skills corpus has SKILL.md + frontmatter + scripts exist" _run_skills_corpus_shape structure
```

**Why it matters.** This closes the highest-value gap surfaced by
sub-slice A (skills runtime). Cost: ~25 lines of harness, runs in
milliseconds. It won't catch invocation-correctness (skills only run
inside Claude Code's Skill tool), but it WILL catch frontmatter drift,
missing SKILL.md, and broken script references — the three failure
modes that are shell-checkable.

### F-15-103 [skip-accepted-not-enumerated-per-callsite] Suspect-skip enumeration deferred

**Evidence.** The harness uses `skip_accepted` per
[[feedback-skip-accepted-as-squelch]], with the legit envelope at:

- `lib/acceptance-harness.sh` line 562 — tool-not-found regex
  (`tool.+not found|not registered|unknown tool|no such tool|method .*
  not found|invalid tool`)
- `lib/acceptance-harness.sh` lines 313–323 — `_HEAVY_CHECK_IDS` (9
  entries, all justified by per-test wall-time profile at lines 301–311)
- `lib/skip-accepted-allowlist.txt` — explicit allowlist file
- `scripts/check-skip-accepted.mjs` — governance / lint script

This slice did **NOT** enumerate every `skip_accepted` call across the
110 sub-files in `lib/acceptance-*.sh` to rate each callsite legit
vs suspect. That's a separate audit-able activity, bounded by the
allowlist contents.

**Why it matters.** Per [[feedback-skip-accepted-as-squelch]]:
"architectural gap, deferred" is suspect; tool-not-found /
heavy-skip / env-disabled are legit. Without a per-callsite walk,
this slice can confirm the **legit envelope exists** but cannot certify
that every actual call to `_CHECK_PASSED=skip_accepted` lands inside
that envelope.

**Recommendation.** Run `scripts/check-skip-accepted.mjs` and inspect
its output against `lib/skip-accepted-allowlist.txt`. If the script
already enforces the envelope automatically (its name suggests so),
then governance is in place and this finding becomes informational
only. A short manual audit of `lib/skip-accepted-allowlist.txt`
entries against the legit categories closes the loop.

### F-15-104 [heavy-skip-last-green-not-traceable-statically] HEAVY_SKIP run history requires test-results scan

**Evidence.** Per CLAUDE.md the 9 heavy skips are "reliably passing"
and the documentation at `docs/heavy-skip-justifications.md` (one of
the matches in the earlier `grep -rln 'HEAVY'` sweep) holds the
rationale. The "last green" evidence is **runtime telemetry**, not a
static file. `test-results/` directories hold transient per-release
artifacts. This slice did not walk those.

**Recommendation.** Add a harness step that writes a stable
`docs/quality/HEAVY-SKIP-LEDGER.md` (or extend
`docs/heavy-skip-justifications.md`) updated by the harness on every
`ACCEPTANCE_HEAVY=1` run, recording last-green timestamps per
`_HEAVY_CHECK_IDS` entry. Mirrors the
[[feedback-update-integration-ledger]] pattern.

### F-15-105 [acceptance-distribution-favours-per-ADR-files] One-file-per-ADR organization is dense

**Evidence.** Of the 110 `lib/acceptance-*.sh` files, ~60 are per-ADR
(e.g. `acceptance-adr0059-checks.sh`, `acceptance-adr0177-checks.sh`,
`acceptance-adr0194-checks.sh`, `acceptance-adr0195-checks.sh`,
`acceptance-adr0196-checks.sh`). The rest are per-surface
(`acceptance-controller-checks.sh`, `acceptance-hooks-lifecycle-checks.sh`,
`acceptance-init-checks.sh`, etc.).

**Why it matters.** This is a positive — high cardinality of small
per-ADR check files supports the [[feedback-trace-before-hypothesis]]
pattern (≥2 related failures => spawn read-only code-analyzer trace).
Each ADR's check file localizes failure causality. The matrix above
under "controllers" reflects this density.

---

## Method

### Commands run (sub-slice A — runtime)

```bash
# Precondition
curl -sf http://localhost:4873/-/ping            # → OK

# Sandbox
SANDBOX=/tmp/ruflo-audit-skills-32913
mkdir -p "$SANDBOX" && cd "$SANDBOX"
npm init -y                                       # → package.json created

# Install (intended; LOST DURING BATCH — see F-15-002)
# npm install --registry=http://localhost:4873 --no-audit --no-fund \
#   @sparkleideas/ruflo@latest

# Help captured (worked because the bin path was probed first):
# Per F-15-001: ruflo --help does not list skills/skill subcommand.

# Subsequent invocations all failed: ./node_modules/.bin/ruflo: no such file or directory
```

### Commands run (sub-slice B — static)

```bash
# Acceptance harness shape
wc -l /Users/henrik/source/ruflo-patch/lib/acceptance-harness.sh    # 639
grep -c run_check        /Users/.../lib/acceptance-harness.sh       # 5 (function defs + refs)
grep -c skip_accepted    /Users/.../lib/acceptance-harness.sh       # 12
grep -c HEAVY            /Users/.../lib/acceptance-harness.sh       # 7
grep -E '^[a-z_]+\(\)'   /Users/.../lib/acceptance-harness.sh       # 11 function defs
# _HEAVY_CHECK_IDS read directly from lines 313–323 (9 entries)

# Per-surface check-script inventory
ls /Users/.../lib/acceptance-*.sh | wc -l                            # 110

# Fork unit tests
find /Users/henrik/source/forks/ruflo/v3 -name "*.test.ts" -o -name "*.test.js" -o -name "*.spec.ts" | wc -l
# → 292

find /Users/henrik/source/forks/ruflo/v3 -path "*integration*" -name "*.test.ts" | wc -l
# → 20

find /Users/henrik/source/forks/agentdb -name "*.test.ts" -o -name "*.spec.ts" | wc -l
# → 276

# Heavy-skip docs
find / -name "heavy-skip-*"
# → docs/heavy-skip-justifications.md

# Skip-accepted governance
ls /Users/.../lib/skip-accepted-allowlist.txt          # exists
ls /Users/.../scripts/check-skip-accepted.mjs          # exists
```

### Files read

- `/Users/henrik/source/ruflo-patch/lib/acceptance-harness.sh`
  (read in chunks; full structural pass)
- `/Users/henrik/source/ruflo-patch/CLAUDE.md` (for command surface,
  heavy-skip list, hook signals)
- `/Users/henrik/source/ruflo-patch/docs/adr/ADR-0094-100-percent-acceptance-coverage-plan.md`
  (existence verified)
- `/Users/henrik/source/ruflo-patch/scripts/test-acceptance.sh` (head
  only — listing of groups in the header)
- `/Users/henrik/source/ruflo-patch/scripts/test-acceptance-fast.sh`
  (head only — groups list)

### Limitations

- **Sub-slice A install failure (F-15-002)** — primary deliverable
  blocked. F-15-001 still stands from the help-output capture, but the
  three-skill-walk and `.claude/skills/` enumeration could not run.
- Several bash calls in this slice had truncated or empty stdout
  delivery (independent of the install issue), particularly grep
  pipelines that captured to `/tmp/audit-*.txt`. Workarounds with
  smaller chunks succeeded. Counts above reflect successful captures.
- Sub-slice B did NOT enumerate `skip_accepted` per-callsite across the
  110 sub-files (F-15-103).
- Rust tests in `forks/agentdb` were not enumerated — `find . -name
  "*.rs" -path "*test*"` returned 0, but Rust integration tests
  typically live in crate `tests/` directories whose `.rs` files don't
  match `*test*` patterns. Per [[feedback-rust-only-use-cargo-test]],
  Rust dev-loop uses `cargo test` directly anyway.

---

## Recommendations

Ordered by impact / cost ratio:

1. **R-15-A (cheap, high impact)** — Add `_run_skills_corpus_shape` to
   `lib/acceptance-init-generated-checks.sh` (F-15-102 has the sketch).
   ~25 lines of harness; catches frontmatter drift, missing SKILL.md,
   broken script references. Highest-value closure of the skills gap.

2. **R-15-B (cheap, medium impact)** — Add `ruflo skills list` and
   `ruflo skills validate [name]` CLI subcommands backed by the same
   `.claude/skills/` discovery logic the init template uses. Closes
   F-15-001; restores CLI symmetry with `plugins`; gives CI a
   verification surface even when not running inside Claude Code.

3. **R-15-C (cheap, immediate)** — **Re-run this audit slice in a clean
   shell session** to complete sub-slice A (F-15-002). The probe is
   short (4 commands); doing it cleanly gives this audit its missing
   data and either confirms the runtime claims or surfaces real
   defects (missing skills in the published package, malformed
   frontmatter, etc.).

4. **R-15-D (medium cost, low risk)** — Walk every `skip_accepted`
   callsite in the 110 `lib/acceptance-*.sh` files (F-15-103). Inspect
   `scripts/check-skip-accepted.mjs` output against
   `lib/skip-accepted-allowlist.txt`. Rate each line legit/suspect.
   The lint may already cover this; verify.

5. **R-15-E (medium cost, medium impact)** — Promote
   `docs/heavy-skip-justifications.md` to also record last-green
   `ACCEPTANCE_HEAVY=1` timestamps per check (F-15-104). Mirror
   [[feedback-update-integration-ledger]] pattern.

6. **R-15-F (informational)** — Update ADR-0094 with the skills
   coverage gap (F-15-102) and the suspect-skip per-callsite audit
   (F-15-103) as open work items so the living tracker reflects
   current state.

### Out of scope for this audit slice

- Per-skill behavioural correctness ("does `/sparc` actually do what
  its SKILL.md claims?"). Requires a live Claude Code session.
- Re-evaluating the 9 `_HEAVY_CHECK_IDS` entries themselves —
  justifications captured at lines 301–311 of
  `lib/acceptance-harness.sh` + `docs/heavy-skip-justifications.md`;
  upstream-set.
- Test-result freshness (last-green timestamps per check) — needs the
  ledger from R-15-E to be auditable statically.
- Rust integration test enumeration in `forks/agentdb` — driven by
  `cargo test`, not a static `find` target.
