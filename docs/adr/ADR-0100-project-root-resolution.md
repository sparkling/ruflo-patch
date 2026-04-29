# ADR-0100: Project-Root Resolution — Walk-Up, Not `process.cwd()`

- **Status**: Proposed 2026-04-23 — hive-designed, not yet implemented. Supersedes ADR-0098 §"Scope-unit clarification" (2026-04-23) which incorrectly defended CWD-scoping as desired behaviour.
- **Date**: 2026-04-23
- **Scope**: Centralize `findProjectRoot()` in `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/types.ts` (replacing `getProjectCwd()` as the artifact anchor for every MCP handler). Blast radius: all MCP storage paths — `.swarm/` (swarm-tools), `.claude-flow/tasks/` (task-tools), `.claude-flow/system/` (system-tools), `.claude/` (guidance-tools — removes duplicated local walk-up). Add `.ruflo-project` sentinel file written by `ruflo init`. New acceptance check. Paired unit test per ADR-0097.
- **Related**: ADR-0098 (swarm-init dedupe — correct within a project root, wrong anchor), ADR-0097 (paired unit tests), ADR-0094 (acceptance coverage — add a check). Upstream: `ruvnet/claude-flow` (same bug exists there; file issue with reproduction).

## Context

User report 2026-04-23: a single ruflo-initialized project has multiple `.swarm/` folders at `src/hm/semantic-modelling/` AND `src/hm/semantic-modelling/generated/`, within the same project root. Reproduces on unpatched upstream `ruvnet/claude-flow` — **not caused by ADR-0098**; the sprawl is one layer below the dedupe logic ADR-0098 fixed.

### Root cause

`mcp-tools/types.ts:28`:
```ts
export function getProjectCwd(): string {
  return process.env.CLAUDE_FLOW_CWD || process.cwd();
}
```

Every MCP handler that persists per-project state (`swarm-tools.ts`, `task-tools.ts`, `system-tools.ts`, `guidance-tools.ts`) routes through this function. It assumes `process.cwd()` is the user's workspace. **Claude Code's documented behaviour invalidates that assumption.**

### Ecosystem evidence — this is not a ruflo bug in isolation

At least 10 open issues on `anthropics/claude-code` and related projects document Claude Code's process CWD drifting away from the project root during a session:

| Issue | Surface |
|---|---|
| [anthropics/claude-code#50960](https://github.com/anthropics/claude-code/issues/50960) | Hook commands resolve against drifted CWD; doubled paths like `.claude/claims/.claude/hooks/foo.py` |
| [anthropics/claude-code#14122](https://github.com/anthropics/claude-code/issues/14122) | Claude Code "loses track of working directory after creating subdirectory" |
| [anthropics/claude-code#46985](https://github.com/anthropics/claude-code/issues/46985) | Bash tool `cwd=/` in stream-json mode from non-shell parents |
| [anthropics/claude-code#35023](https://github.com/anthropics/claude-code/issues/35023) | Bash tool CWD does not persist for sub-agents |
| [anthropics/claude-code#42844](https://github.com/anthropics/claude-code/issues/42844) | `cd` mid-session silently resets to project root |
| [anthropics/claude-code#19903](https://github.com/anthropics/claude-code/issues/19903) | `/cd` feature request — unresolved |
| [anthropics/claude-code#15797](https://github.com/anthropics/claude-code/issues/15797) | MCP configuration file location detection issues |
| [modelcontextprotocol/python-sdk#1520](https://github.com/modelcontextprotocol/python-sdk/issues/1520) | No standard way for MCP server to learn workspace; `uvx` launch returns `~/.cache/uv/…` |
| [JetBrains LLM-20321](https://youtrack.jetbrains.com/projects/LLM/issues/LLM-20321/) | Same bug in JetBrains AI Assistant: MCP server resolves incorrect project root |

**Implication:** we cannot wait for Anthropic or `ruvnet/claude-flow` to fix this. Claude Code will continue to drift. An MCP server that assumes `process.cwd()` tracks the user's workspace is structurally broken across the ecosystem.

### Why ADR-0098's clarification was wrong

The 2026-04-23 follow-up to ADR-0098 claimed "CWD-scoped is correct because worktrees and test fixtures legitimately need isolation." That defence is half-right: worktrees and fixtures do need isolation. But the isolation boundary is the **project root**, not the CWD. Walk-up resolution preserves worktree and fixture isolation (each has its own marker) while eliminating intra-project sprawl.

### Pre-existing partial fix in the codebase

`mcp-tools/guidance-tools.ts:23-47` already walks up looking for `.claude/` (max-depth 10). That code exists because the guidance system independently hit the same problem and fixed it locally. Evidence of convergent need. The fix is to **lift, centralize, and generalize** that pattern — not invent one.

## Decision

### 1. Replace `getProjectCwd()` with `findProjectRoot()` in `types.ts`

One function, called per-invocation (never cached at module load — CWD drift means cached resolution is stale). Resolution order:

```ts
export function findProjectRoot(startDir?: string): string {
  const start = startDir || process.env.CLAUDE_FLOW_CWD || process.cwd();

  // Walk upward from start; first marker wins
  let dir = start;
  for (let i = 0; i < 32; i++) {  // 32 levels is beyond any real repo depth
    if (existsSync(join(dir, '.ruflo-project'))) return dir;  // explicit sentinel
    if (existsSync(join(dir, 'CLAUDE.md')) && existsSync(join(dir, '.claude'))) return dir;  // init'd project — BOTH required to skip docs/CLAUDE.md false-positives (review flaw 2)
    if (existsSync(join(dir, '.git'))) return dir;            // generic repo
    const parent = dirname(dir);
    if (parent === dir) break;  // reached filesystem root
    dir = parent;
  }

  // No marker found — honest fallback, log to BOTH stderr and persistent sink
  // (stderr is swallowed by Claude Code's MCP stdio transport — review flaw 5)
  const msg = `[ruflo] No project root marker found from ${start}; falling back to CWD. Consider running 'ruflo init' or creating '.ruflo-project'.`;
  console.warn(msg);
  try {
    const logPath = join(homedir(), '.ruflo', 'resolver-warnings.log');
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, `${new Date().toISOString()} ${msg}\n`);
  } catch { /* log best-effort; never throw from resolver */ }
  return start;
}

/**
 * @deprecated Use findProjectRoot() for ANY artifact/storage path.
 * Only use getDisplayCwd() for user-facing display or logging that genuinely
 * wants the drifting Claude Code CWD. A preflight grep gate in `npm run preflight`
 * fails the build if `getDisplayCwd` is imported from `mcp-tools/*-tools.ts`
 * files (see review flaw 3). Renamed from getProjectCwd to force audit.
 */
export function getDisplayCwd(): string {
  return process.env.CLAUDE_FLOW_CWD || process.cwd();
}
```

**Marker priority rationale:**

1. `.ruflo-project` wins — explicit sentinel trumps inference. Cheap to create, impossible to confuse.
2. `CLAUDE.md` is present in every `ruflo init`-ed project by design. Covers the current install base without requiring re-init.
3. `.git` is the generic fallback for any repo the user is working in. Preserves the current "it works in a git repo" behaviour.
4. No match → warn + return original CWD. **No silent fallback** — surfaces the problem per `feedback-no-fallbacks`.

### 2. Add `.ruflo-project` sentinel writer to `ruflo init`

`forks/ruflo/v3/@claude-flow/cli/src/init/*` writes a `.ruflo-project` file at init time. Contents:

```json
{
  "version": 1,
  "initDate": "2026-04-23T…",
  "cliVersion": "3.5.58-patch.N"
}
```

Content is informational only — the file's existence is what matters. The file is **not** gitignored — it SHOULD be committed so teammates cloning the repo get correct root resolution.

**Version migration policy (review flaw 1):** `version` is read by `findProjectRoot` but never blocks. Unknown versions emit a one-time `[ruflo] Sentinel version N unknown (we are version M) — treating as valid root` warning to the persistent log. Any future version change that needs different resolution behaviour MUST ship its own ADR with an explicit migration step (old CLIs read new sentinels as valid roots; new CLIs read old sentinels as valid roots; the file never becomes a compatibility tripwire).

### 3. Migrate artifact-writing handlers from `getProjectCwd()` → `findProjectRoot()` (with enforced rename)

Two mechanical edits across the fork:

**3a. Rename `getProjectCwd` → `getDisplayCwd` everywhere** (review flaw 3 — Devil and queen converged). The rename forces every callsite to be audited before it compiles. Comments like `// intentional CWD use` are unenforced and re-decay; the rename is enforced by the compiler.

**3b. Replace `getDisplayCwd()` with `findProjectRoot()` at artifact-writing sites:**

- `swarm-tools.ts:47` — `.swarm/` state
- `task-tools.ts:37, 246, 357, 402` — `.claude-flow/tasks/`, `.claude-flow/agents/store.json`
- `system-tools.ts:50, 201, 213, 296` — `.claude-flow/system/`
- `guidance-tools.ts:23-47` — **delete the local walk-up** (lines 20-47), import the centralized `findProjectRoot`. Guidance's existing `.claude/` marker is subsumed by the `CLAUDE.md + .claude/` pairing in the new resolver — semantically equivalent for init'd projects, stricter for docs subdirs. Note in commit message: guidance behaviour changes slightly in projects that have `.claude/` but no `CLAUDE.md` (synthetic test fixtures only — no real user hits this).

**3c. Preflight grep gate** — add `scripts/check-no-cwd-in-handlers.sh` wired into `npm run preflight`:

```sh
# Fail if any MCP handler file writing to disk uses getDisplayCwd
if grep -rn "getDisplayCwd" forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/*-tools.ts; then
  echo "ERROR: getDisplayCwd used in an MCP handler — use findProjectRoot for artifacts"
  exit 1
fi
```

The check is blunt but correct: every file matching `*-tools.ts` under `mcp-tools/` is a handler; handlers should never touch `getDisplayCwd`. If a display-only callsite legitimately needs to live in a handler file (unlikely), it gets an explicit allowlist comment + a test-harness exception, not a casual import.

### 4. Acceptance check (ADR-0094 Phase 9+)

`lib/acceptance-adr0100-checks.sh`, wired into `scripts/test-acceptance.sh`:

**Scenario A — intra-project sprawl + sentinel load-bearing (review flaw 1):**
1. Fresh `ruflo init` at `/tmp/ruflo-accept-XXXX/` → assert `.ruflo-project` and `CLAUDE.md` created; 0 `.swarm/`.
2. `mkdir -p src/deep/nested/dir && cd src/deep/nested/dir`.
3. Additionally create `src/CLAUDE.md` (simulating a docs stub at depth-1) WITHOUT a sibling `.claude/` there. This proves the fix for review flaw 2 (CLAUDE.md + `.claude/` pairing requirement).
4. Invoke `ruflo` (e.g. `swarm init`) from nested dir.
5. Assert: `.swarm/` appears ONLY at `/tmp/ruflo-accept-XXXX/.swarm/`, NOT at `src/deep/nested/dir/.swarm/`, NOT at `src/.swarm/` (the sentinel at root wins over the docs-stub CLAUDE.md at depth-1).
6. `find /tmp/ruflo-accept-XXXX/ -name '.swarm' -type d | wc -l` == 1.
7. Delete `.ruflo-project` at root; re-run step 4; assert `.swarm/` still created at root (CLAUDE.md + `.claude/` at root still match; the sentinel was not the ONLY marker — but Scenario D below proves it's load-bearing when distinguishing between a sentinel-at-depth-3 root vs a CLAUDE.md-at-depth-1 root).

**Scenario B — worktree isolation preserved:**
1. Fresh init at `A/`, fresh init at `A/.claude/worktrees/B/` (different `.ruflo-project`).
2. Invoke `swarm init` from within `B/`.
3. Assert: `A/.swarm/` untouched, `B/.swarm/` created.

**Scenario C — no-marker fallback surfaces (fixed per review flaw 5):**
1. `cd /tmp && cd ..`  (no markers anywhere).
2. Invoke `ruflo swarm init`.
3. Assert: stderr contains `[ruflo] No project root marker found` AND `~/.ruflo/resolver-warnings.log` gained an entry with that string + a timestamp. The persistent log is the contract — stderr is advisory because Claude Code's MCP stdio transport swallows it. Exit 0 still (warn, not fail).

**Scenario D — sentinel load-bearing (review flaw 1):**
1. Create `/tmp/ruflo-accept-YYYY/` with NO markers at root. Create `src/sub/` with a `CLAUDE.md` + `.claude/` pair (simulating an init'd subproject). Create `src/sub/deep/.ruflo-project` (simulating an explicit deeper root).
2. From `src/sub/deep/`, invoke `ruflo swarm init`.
3. Assert: `.swarm/` created at `src/sub/deep/`, NOT at `src/sub/`. Sentinel at depth-3 beats CLAUDE.md-pair at depth-1 — proves sentinel priority is load-bearing, not cosmetic.

**Scenario E — MCP-path no-marker persistent log (review flaw 5):**
1. No markers anywhere. Invoke the MCP handler DIRECTLY (not via CLI — emulates stdio transport where stderr is swallowed).
2. Assert: `~/.ruflo/resolver-warnings.log` has the warning; handler exit 0 but sprawl is detectable via the log.
3. This scenario PROVES the contract stated in Scenario C holds in the hostile environment (MCP stdio), not just CLI.

**Scenario F — resolver performance budget (review flaw 4):**
1. Create a synthetic depth-10 directory tree, no markers except at root.
2. Call `findProjectRoot` 1000 times from the deepest leaf.
3. Assert: mean wall ≤ 2 ms, p99 ≤ 5 ms on the reference M5 Max. Write the number to `docs/reports/perf/runs/adr0100-resolver-<sha>.json` (consumable by ADR-0099 perf program when it ships).
4. Fails build if p99 > 5 ms — prevents the Windows/OneDrive/NFS regression scenario the devil named. Runs on the M5 Max reference only; network-FS regressions caught reactively via the persistent-log warnings.

### 5. Paired unit test per ADR-0097

`forks/ruflo/v3/@claude-flow/cli/__tests__/find-project-root.test.ts`:

1. Sentinel wins over paired `CLAUDE.md + .claude/` — temp dir with both at DIFFERENT depths, assert returns the `.ruflo-project` parent (review flaw 1 — sentinel must be load-bearing, not decorative).
2. `CLAUDE.md` WITHOUT sibling `.claude/` is SKIPPED (review flaw 2) — temp dir has `docs/CLAUDE.md` but `docs/.claude/` absent; walk up must not stop at `docs/`. Asserts the pairing requirement.
3. `CLAUDE.md + .claude/` beats `.git` — covers init'd project inside a larger repo.
4. `.git` fallback — plain repo with neither sentinel nor paired CLAUDE.md.
5. Walk-up from nested dir — create markers at level 3, call from level 0, assert returns level 3.
6. Depth cap — 32-level synthetic tree returns CWD fallback + warning.
7. No marker anywhere — `/tmp/empty-XXXX/…` returns the original start, emits warning to stderr, AND appends a line to `~/.ruflo/resolver-warnings.log` (review flaw 5). Asserts BOTH sinks, not just stderr.
8. `CLAUDE_FLOW_CWD` override still works — env var wins over `process.cwd()` as the search start.
9. Sentinel `version: N+1` — unknown version warns once to persistent log but still returns the directory as root (review flaw 1, version migration policy).
10. Preflight gate — run `scripts/check-no-cwd-in-handlers.sh` against a crafted handler file that imports `getDisplayCwd`; assert exit 1 (review flaw 3 — lint enforcement, not comment convention).
11. Perf microbench — `findProjectRoot` mean ≤ 2 ms, p99 ≤ 5 ms over 1000 calls in depth-10 tree (review flaw 4 — no handwaved perf claim).

### 6. Revert ADR-0098 §"Scope-unit clarification"

Mark that section `**SUPERSEDED by ADR-0100 (2026-04-23 pm)**`. Do NOT delete the text — it records reasoning we later rejected, which is valuable history. Add a pointer paragraph at the top of the clarification section saying "the conclusion in this section was wrong — see ADR-0100."

### 7. File upstream issue on `ruvnet/claude-flow` — FILED 2026-04-23 as [ruvnet/ruflo#1639](https://github.com/ruvnet/ruflo/issues/1639)

Title: *"MCP handlers using `process.cwd()` as artifact anchor sprawl under Claude Code CWD drift"*

Body:
- Reproduction on upstream HEAD (user-confirmed 2026-04-23).
- Evidence: `src/hm/semantic-modelling/.swarm/` + `src/hm/semantic-modelling/generated/.swarm/` in one project.
- Link to anthropics/claude-code#50960 as the root cause upstream-of-upstream.
- Link to this ADR with the proposed `findProjectRoot()` implementation.
- Offer to upstream the fix via PR once our fork patch stabilizes.

Bundles with the upstream issue ADR-0098 already has pending (combine into one filing).

## Alternatives

### A. Wait for Anthropic to fix Claude Code CWD drift
**Pros**: upstream fix fixes all ecosystem MCP servers, not just ours.
**Cons**: 10+ open issues, no shipped fix, `/cd` feature request open since Issue #1628. Waiting is "hope as a strategy." Rejected.

### B. Rely on `CLAUDE_FLOW_CWD` env var (current partial mechanism)
**Pros**: zero code change — our install script already sets it.
**Cons**: Claude Code doesn't propagate it to subprocess Bash invocations; it works only when `ruflo` is called directly, not via MCP handlers spawned under CC. Already broken for the sprawl case (user's reproduction is WITH the env var). Rejected.

### C. Walk up only for `.swarm/`, not the other artifacts
**Pros**: minimal blast radius; fixes the user-reported symptom.
**Cons**: every other artifact has the same bug (`.claude-flow/tasks/`, `.claude-flow/system/`). Fixing one tool at a time means the sprawl migrates to the others. Rejected — centralize.

### D. Cache `findProjectRoot()` at module load
**Pros**: cheaper — one `existsSync` walk per process.
**Cons**: module-load-time CWD is exactly the CWD we don't trust. `guidance-tools.ts` did this and it's why we're in this mess. Rejected — per-invocation only.

### E. Use `.git` as the sole marker
**Pros**: universal, no new sentinel needed.
**Cons**: fails inside a monorepo where multiple projects share one `.git`; fails in projects not using git at all; fails when `.git` is above the intended project root. `.ruflo-project` sentinel disambiguates. Rejected as sole marker, accepted as tertiary fallback.

### F. Ship without the `.ruflo-project` sentinel (use `CLAUDE.md` + `.git` only)
**Pros**: no new file, no `ruflo init` change.
**Cons**: future drift — someone edits the CLAUDE.md-detection in `init`, suddenly resolution changes. Explicit sentinel future-proofs the contract. Also: `CLAUDE.md` can legitimately exist in docs subdirs of larger projects, causing false-positive early termination. Rejected.

### G. Pass the workspace via MCP handshake (`MCP_WORKSPACE` env var)
**Pros**: the "right" architectural answer — upstream MCP SDK Issue #1520 proposes this.
**Cons**: requires Anthropic or MCP SDK changes we don't control. Can coexist with walk-up when it lands. Deferred — implement walk-up now, migrate to handshake if/when upstream supports it.

## Consequences

**Positive:**
- `.swarm/`, `.claude-flow/tasks/`, `.claude-flow/system/` artifacts converge at one location per project, regardless of which subdirectory Claude Code's CWD drifted to.
- Guidance-tools local walk-up (lines 20-47) is deleted — one less divergent implementation of "find project root."
- `.ruflo-project` sentinel gives users a way to explicitly mark an intended root in ambiguous layouts (monorepos, nested projects).
- Upstream issue + proposed PR positions us as contributors, not just fork-patchers.

**Negative:**
- `findProjectRoot()` adds `existsSync` calls on every handler invocation. **Measured** via §5 test 11 + §4 Scenario F (review flaw 4 — no more handwaving): mean ≤ 2 ms, p99 ≤ 5 ms on M5 Max reference. Build fails if p99 > 5 ms. Network-FS users (Windows/OneDrive reparse points, NFS, sshfs) may see 20–200 ms per call; caught reactively via the persistent-log warning channel (Scenario E). Revisit if user reports appear.
- `.ruflo-project` is a new file users must learn about. Mitigated by `ruflo init` writing it automatically; existing projects pick up `CLAUDE.md`-based resolution without re-init.
- Behaviour change: existing users with stray `.swarm/` in subdirectories will find them ignored after upgrade. Their state is orphaned (same fate as the 66 orphans ADR-0098 cleaned). Acceptable.
- `getProjectCwd()` remains for display/logging uses — mild confusion potential ("two cwd functions?"). Mitigated by comments + one-time grep to confirm no artifact writer still uses the legacy name.

**Neutral / deferred:**
- MCP handshake `MCP_WORKSPACE` env (Alternative G) — migrate when upstream supports it. Walk-up is defensive; handshake is authoritative. Walk-up stays as belt-and-braces regardless.
- Other MCP servers in the ecosystem have the same bug — not our problem to fix beyond filing the upstream issue.

## Adversarial Review Outcome (2026-04-23)

Third-order hive `hive-1776935361015-683ejf` (queen `adr0100-queen-1776935364429-ve91`, devil `adr0100-devil-1776935365155-3xqh`) reviewed this ADR in parallel. Devil found 3 flaws; queen anticipated 3. **Devil and queen converged on 1** (the `getProjectCwd()` → `getDisplayCwd()` rename). Total: **5 distinct flaws, all disposition FIX — zero ACCEPT.** That unanimous FIX signal mattered: it meant every named flaw had a cheap textual fix that closed the 2029-regret surface, and none required re-architecting the walk-up decision.

| # | Flaw | Source | Severity | Disposition |
|---|---|---|---|---|
| 1 | Sentinel has no binding force — §4 Scenario A only asserts file exists, not that resolution used it; no version-migration policy | Devil | HIGH | **FIXED** — §4 Scenario A now creates `src/CLAUDE.md` as a decoy to prove sentinel priority; new Scenario D directly tests sentinel-at-depth-3 > CLAUDE.md-pair-at-depth-1; §2 gains version migration policy ("unknown version warns but never blocks") |
| 2 | `CLAUDE.md` false-positive in `docs/CLAUDE.md` or `packages/*/CLAUDE.md` — ADR concedes this risk in Alt F then ships anyway, same pattern as ADR-0098 | Queen | HIGH | **FIXED** — §1 resolver now requires `CLAUDE.md + .claude/` pairing (`&&` in the resolver), §5 test 2 asserts `docs/CLAUDE.md` without sibling `.claude/` is skipped |
| 3 | `getProjectCwd()` survives as a divergence trap — future contributor auto-completes familiar name, sprawls a new handler | **Devil AND queen converged** | CRITICAL | **FIXED** — renamed to `getDisplayCwd()` with `@deprecated` annotation; new `scripts/check-no-cwd-in-handlers.sh` preflight gate fails the build if `getDisplayCwd` appears in any `mcp-tools/*-tools.ts`; §5 test 10 exercises the gate |
| 4 | "1–2 ms on SSD. Acceptable" — handwaved perf claim; ADR-0099 perf program not yet shipped; Windows/OneDrive/NFS users could see 20–200 ms per call with no detection | Devil | MEDIUM-HIGH | **FIXED** — §4 Scenario F adds explicit p99 ≤ 5 ms gate on M5 Max reference; §5 test 11 microbenchmarks 1000 calls in depth-10 tree; network-FS regressions caught via persistent-log warnings (Scenario E) |
| 5 | `console.warn` to stderr is swallowed by Claude Code's MCP stdio transport — the "warning IS the contract" bullet is a silent fallback in practice, violating `feedback-no-fallbacks` | Queen | CRITICAL | **FIXED** — §1 resolver now logs to BOTH stderr AND `~/.ruflo/resolver-warnings.log` (best-effort append, never throws); §4 Scenarios C + E assert the persistent log is written; §5 test 7 asserts both sinks |

### Queen's net position (preserved verbatim)

> *"Three FIX dispositions, zero ACCEPT/DEFER/REJECT — that's a signal. ADR-0100 is substantively right (walk-up is the correct architecture, the ecosystem evidence is persuasive, the alternatives analysis is honest) but it repeats ADR-0098's pattern of naming a risk in the alternatives section and then shipping without mitigating it. The three likely flaws are all the same shape: 'the ADR knows this could be a problem and rationalizes past it.' That's exactly how we got here with ADR-0098's CWD-scope defence."*

### Devil's net judgment (preserved verbatim)

> *"Fix-then-ship. ADR-0100 correctly identifies the root cause (previous two attempts missed it) and proposes a structurally sound fix. But the three flaws above are precisely the shape of the regression patterns that got us here: an unenforced contract (sentinel), an unenforced convention (two-function-name discipline), and an unmeasured performance claim. Each has a small, surgical preventive edit."*

All 5 FIX edits landed in the ADR body directly (resolver code, Scenarios A/C/D/E/F, test list 1–11, Consequences perf bullet). ADR-0100 stays in **Proposed** status pending implementation of the fork patch (task 9).

## Hive Synthesis

- **First-order drafting** by claude-opus-4-7 at user direction, after ADR-0098 and its 2026-04-23 clarification both proved to have the wrong anchor-unit. Ecosystem research documented 10+ related issues in Claude Code / MCP SDK / JetBrains.
- **Third-order adversarial review** (this session's third hive — ADR-0098 had one, ADR-0099 had one) ran queen + devil's advocate in parallel. Converged on one flaw, diverged on four more — all FIX.
- **Hive IDs**:
  - `hive-1776935361015-683ejf` (this review)
  - Workers: `adr0100-queen-1776935364429-ve91`, `adr0100-devil-1776935365155-3xqh`
- No fourth-order review planned. If implementation reveals a gap, bug-fix ADR; if not, ADR transitions to Implemented after fork commit + publish.
