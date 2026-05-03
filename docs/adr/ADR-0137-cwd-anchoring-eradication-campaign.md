# ADR-0137: Eradicate cwd-anchoring across 98 sites — supersede `adr-0100-allow:` annotations with real fixes + runtime guard

- **Status**: **Proposed (2026-05-03)** — concrete campaign with phased rollout. Supersedes the Strategy-B band-aid from commit `7fbcfle` on `forks/ruflo` `main`.
- **Date**: 2026-05-03
- **Deciders**: Henrik Pettersen
- **Supersedes (partially)**: the 98 `// adr-0100-allow: tracked in ADR-0118 known-debt` annotations added in `7fbcfle`. Each phase below removes annotations as it lands real fixes.
- **Related**: ADR-0100 (project-root-resolution — the design this ADR finally implements end-to-end), ADR-0118 (hive-mind-runtime-gaps-tracker — the inventory this ADR drains), ADR-0098 (swarm-init-sprawl — same anti-sprawl ethos), ADR-0082 (test-integrity-no-fallbacks — runtime guard must fail loud), commit `aec0dcf` on ruflo-patch (broadened grep gate that surfaced the 98 sites)
- **Scope**: All 98 `process.cwd()` use sites currently annotated as known-debt across `forks/ruflo/v3/@claude-flow/cli/src/{init,commands,memory}/` + `@claude-flow/memory/src/`. Plus a new runtime guard in the storage write path. Plus a new acceptance check that runs from a non-root cwd.

## Context

ADR-0100 ratified "always walk up to project root via `findProjectRoot()`, never anchor on `process.cwd()`" as the design. Commit `aec0dcf` (ruflo-patch) broadened the grep gate `scripts/check-no-cwd-in-handlers.sh` from `mcp-tools/*-tools.ts` (4 hits, all allowlisted) to also cover `init/`, `commands/`, `memory/cli`, and `@claude-flow/memory/src/`. The broadened gate flagged **98 violations**.

Commit `7fbcfle` on `forks/ruflo` annotated all 98 with `// adr-0100-allow: tracked in ADR-0118 known-debt` so the gate would pass and the release could ship green. The annotations made the gate happy. They did not fix the bug.

### Symptom

Any tool, MCP handler, hook, or subagent that runs from a non-root cwd and hits one of the 98 sites creates a fresh `.claude-flow/` (or `.swarm/`, `.claude/`) in that cwd instead of using the real project root one. Examples observed in this repo:

- `docs/adr/.claude-flow/data/` — created by something with cwd anchored under `docs/adr/`
- The `.gitignore` rule `**/.claude-flow/` + `!/.claude-flow/` (commit `e85d58f` on ruflo-patch) suppresses these from `git status` but does NOT prevent their creation. They still consume disk and confuse later tools that happen to walk up from a non-root cwd and find one of these strays before reaching the real project root.

### Inventory (from the parallel-agent triage in commit `aec0dcf`)

| Section | Total `process.cwd()` hits | Allowlisted | Violations | Dominant shape |
|---|---:|---:|---:|---|
| `mcp-tools/*-tools.ts` (original gate scope) | 4 | 4 | 0 | comments only — already fixed |
| `cli/src/init/**/*.ts` | 18 | 3 | **15** | `path.join(process.cwd(), '.claude', type)` |
| `cli/src/commands/**/*.ts` | 66 | 2 | **64** | `path.join(process.cwd(), '.swarm'\|'.claude-flow'\|'.claude', ...)` |
| `cli/src/memory/**/*.ts` | 8 | 1 | **7** | `path.resolve(process.cwd(), '.swarm')` + walk-up reimplementations |
| `@claude-flow/memory/src/**/*.ts` | 12 | 0 | **12** | `JSON.parse(readFileSync(join(process.cwd(), '.claude-flow', 'config.json'), ...))` |
| **Total violations** | — | — | **98** | — |

Largest single-file concentrations: `commands/hooks.ts` (33), `init/executor.ts` (15), `commands/daemon.ts` (6), `commands/migrate.ts` (4), `commands/neural.ts` (4), `commands/doctor.ts` (4).

### Why annotations alone are wrong

1. **The bug still creates strays.** The grep gate is a static check; it does not prevent the runtime behavior. A user running `ruflo memory store` from a subdirectory still creates `<subdir>/.claude-flow/`.
2. **Annotations rot.** `// adr-0100-allow:` markers persist after the underlying issue is fixed elsewhere; later authors trust them and replicate the bad pattern.
3. **Per memory `feedback-data-loss-zero-tolerance.md`**: writing memory state to a stray `.claude-flow/` instead of the real one IS data loss — the user's memory store may silently target the wrong DB.
4. **Per memory `feedback-no-fallbacks.md`**: cwd-anchored paths are a silent fallback. If `process.cwd()` is wrong, the code writes somewhere wrong without complaining. Must fail loud.

## Decision

A four-part campaign. All four must land for this ADR to close.

### Part 1 — Real fix at all 98 violation sites

Replace each `process.cwd()` site with the appropriate primitive. Three canonical fix shapes by call-site role:

| Call-site role | Replace with | Rationale |
|---|---|---|
| Library code that needs project root | `findProjectRoot()` from `@claude-flow/cli/src/utils/find-project-root.ts` (or sibling) | Walks up from `import.meta.url`, anchors on project markers (`package.json`, `.claude-flow/`, `CLAUDE.md`) |
| Function that already receives a context/options object | New required parameter `projectRoot: string`; caller computes via `findProjectRoot()` once | Avoids repeated walks; makes data-flow explicit; testable |
| Subprocess `cwd:` option for spawning a child process | `cwd: projectRoot` (where `projectRoot` resolved as above) | Subprocess inherits correct cwd anchoring |
| Default value for an `InitOptions.targetDir` style field | `findProjectRoot()` at construction time, NOT at use time | Avoid recomputing per use; capture intent at config-build time |
| Walk-up reimplementations (e.g. `let dir = process.cwd(); while (...) dir = path.dirname(dir)`) | Replace entire walk with `findProjectRoot()` | Single source of truth; consistent project-marker rules |

### Part 2 — Runtime guard in the storage write path

Add a guard at every storage-backend write entry point (RVF, SQLite, RVlite, JSON-file backends, `.claude/` writers) that:

1. Computes `expectedRoot = findProjectRoot()`
2. Asserts the path being written is anchored at `expectedRoot`
3. Throws a fail-loud error if not — message must include the bad path, the resolved root, and a pointer to ADR-0137

The guard catches violations Part 1 missed AND any new violations introduced by future code. Per `feedback-no-fallbacks.md`: must throw, never silently coerce or warn.

Pseudocode:

```ts
function assertProjectRootAnchored(targetPath: string, root = findProjectRoot()): void {
  const abs = path.resolve(targetPath);
  if (!abs.startsWith(root + path.sep) && abs !== root) {
    throw new Error(
      `[adr-0137] storage write to '${abs}' is not anchored at project root '${root}'. ` +
      `This indicates a cwd-anchoring violation. See ADR-0137.`
    );
  }
}
```

Wire it at:
- `forks/ruflo/v3/@claude-flow/memory/src/persistence/rvf-backend.ts` write entry points
- `forks/ruflo/v3/@claude-flow/memory/src/persistence/sqlite-backend.ts` write entry points
- Any direct `fs.writeFileSync` / `fs.writeFile` to `.claude-flow/`, `.claude/`, `.swarm/` paths

### Part 3 — Acceptance check from a non-root cwd

Add `lib/acceptance-adr0137-checks.sh` (or extend existing `acceptance-adr0100-checks.sh`) with:

- Scenario H: from a 1-deep cwd (`<project>/docs/adr/`), run `ruflo memory store --key x --value y --namespace test`
- Scenario I: same from 5-deep cwd
- Scenario J: from a non-root cwd, run `ruflo init` in a fresh tmpdir; assert no stray `.claude-flow/` appears under cwd OR any subdir
- Scenario K: run `ruflo hive-mind spawn ...` from non-root cwd; assert state written under project root only

After each scenario: walk the entire project tree and assert ZERO `.claude-flow/` directories exist except the project root one. Fail loud if any are found.

### Part 4 — Remove all 98 `// adr-0100-allow:` annotations as their sites are fixed

Each phase landing real fixes for site set N MUST remove the corresponding annotations in the same commit. Annotations and real fixes do not coexist. The grep gate stays in place — once all 98 are fixed, the gate's allowlist count for the broadened scope drops to 0.

## Phased rollout (5 phases)

Order chosen by impact density (memory → wide-blast-radius → narrower):

| Phase | Site set | Violations | Why this order |
|---|---|---:|---|
| **P1** | `@claude-flow/memory/src/` | 12 | Highest data-loss risk per memory `feedback-data-loss-zero-tolerance.md`; fixing here is the prerequisite for the runtime guard in Part 2 to be testable |
| **P2** | `cli/src/memory/` | 7 | Same data-loss class, smaller surface, removes the `rabitq-index.ts` and `sona-optimizer.ts` cwd-anchored persistence (load + save sites) |
| **P3** | `cli/src/init/` | 15 | Init runs once per project but creates the directory structure; fixing here prevents the most-common stray-creation path (running `init` from a subdir) |
| **P4** | Runtime guard (Part 2) wired in + acceptance check (Part 3) | guard + 4 scenarios | Lands AFTER P1+P2+P3 so the guard doesn't trip on still-broken sites in P5 |
| **P5** | `cli/src/commands/` | 64 | Largest fix; landing it last lets earlier phases stabilize. The 33 hits in `commands/hooks.ts` alone could be a sub-phase if the diff is unwieldy |

Each phase is one PR/commit on `forks/ruflo` `main` with descriptive message. Each phase runs through `npm run release` per the canonical 2-command path before the next phase starts. ADR-0094 streak does not advance during this campaign — finish the campaign, then re-anchor.

## Acceptance criteria for closing this ADR

1. **Zero `// adr-0100-allow:` annotations** in `forks/ruflo` source. Grep returns empty.
2. **Zero violations** in the broadened grep gate (`scripts/check-no-cwd-in-handlers.sh` exit code 0 with all sections at `viol: 0`).
3. **Runtime guard active** at all storage-backend write entry points. Tests cover the failure path (assert thrown error with ADR-0137 reference).
4. **Acceptance check passes** from 1-deep, 5-deep, and tmpdir cwd; tree-walk asserts no stray `.claude-flow/` after each scenario.
5. **Three consecutive green `npm run release` runs** with the runtime guard active and the acceptance check enabled — proves no regression at the release boundary.
6. **`.gitignore` rule `**/.claude-flow/` + `!/.claude-flow/` becomes belt-and-suspenders** — the campaign should mean strays never get created in the first place; the gitignore catches anything we missed.

## Trade-offs and risks

- **Risk: real fixes destabilize working flows.** Mitigation: phased rollout, release-gated between phases, P5 (largest) last so earlier phases burn in.
- **Risk: `findProjectRoot()` itself isn't bulletproof** — it walks markers, but if a marker is ambiguous (e.g., monorepo with nested `package.json`), it can resolve to the wrong root. ADR-0100 is the canonical source for the marker hierarchy; if a marker bug exists, fix `findProjectRoot()` not the call sites. **Out of scope for this ADR**: re-litigating ADR-0100's marker rules.
- **Risk: tests written before the fix may pass before AND after** if they don't actually exercise the cwd-anchoring path. Mitigation: scenarios J and K explicitly run from non-root cwd and tree-walk for stray dirs — these can only pass if the fix actually works.
- **Cost: large diff across 98 sites.** Acceptable. The annotations were a temporary measure; carrying them long-term is worse than landing the fix.
- **Compatibility risk for downstream**: any external code that imported a function expecting it to default to `process.cwd()` may break when we change the default to `findProjectRoot()`. Mitigation: the `Function that already receives a context/options object` row above keeps backward compatibility by adding `projectRoot` as a required parameter (callers must update); the breaking change is intentional and documented in the relevant package's CHANGELOG.

## What this ADR does NOT propose

- **Not proposing to delete existing stray `.claude-flow/` dirs.** That's `git clean` territory or a one-shot cleanup script; not an architectural decision.
- **Not proposing changes to `findProjectRoot()` itself.** ADR-0100's marker rules are the contract; this ADR consumes them.
- **Not proposing a behavioral change to `.gitignore`.** Commit `e85d58f` is sufficient for catching any strays the campaign misses.
- **Not proposing changes to the upstream `ruvnet/ruflo`.** Per memory `feedback-no-upstream-donate-backs.md` — fork-side fix only. Upstream's USERGUIDE doesn't even mention the cwd-anchoring class of bug.
- **Not proposing migration of the 4 `mcp-tools/*-tools.ts` sites** — they're already comment-only allowlist hits per the inventory; no real violation there.

## Open questions

1. **Should the runtime guard be a hard error or a soft warning during P1-P3?** Hard error means a half-fixed state breaks. Soft warning means strays still get created mid-campaign. Recommendation: hard error gated by env var `RUFLO_ADR0137_ENFORCE=1` during P1-P3, hard error unconditionally after P4 lands.
2. **Should `findProjectRoot()` cache its result per-process?** Walks are cheap (~ms) but could add up across 98 fixed sites if each computes independently. Recommendation: yes, memoize at module level. Defer to follow-up if perf matters.
3. **Should we add a corresponding rule for `.swarm/` and `.claude/` strays?** Same bug class. The 98 violations include all three target dirs. The runtime guard should cover all three; the gitignore rule already covers `.claude-flow/`. Add `.swarm/` and `.claude/` non-root-only to gitignore in P4.

## Consequences

- **Positive**: bug class eliminated end-to-end. No more stray dirs anywhere. User's mental model (".claude-flow/ lives at project root, period") finally matches code reality.
- **Positive**: runtime guard makes the bug class non-regressible. Future violations trip the guard on first invocation.
- **Positive**: ADR-0118 known-debt tracker shrinks by 98 entries when this campaign closes.
- **Negative**: large diff (~98 sites + guard + acceptance check), executed in 5 phases over multiple release cycles.
- **Negative**: brief window of incompatibility for downstream code that relies on cwd-defaulting. Acceptable per fork-patch model (memory `project-terminology.md`).

## Implementation notes

1. Per memory `feedback-trunk-only-fork-development.md`: each phase commits directly to `forks/ruflo` `main`, no feature branches.
2. Per memory `feedback-fork-commit-attribution.md`: no `Co-Authored-By` trailer on fork commits.
3. Per CLAUDE.md "TWO COMMANDS, NOTHING ELSE": each phase verified via `npm run test:unit` then `npm run release`. No `npm run build`, no piecemeal cascade scripts.
4. Per `feedback-complete-acceptance-tests.md`: P4's acceptance check is a hard gate. Not optional, not skip-able.
5. The grep gate's allowlist count drops with each phase. Track the trajectory in commit messages: `fix(adr-0137 P1): eliminate cwd anchoring in @claude-flow/memory/src (12→0)`.

## Re-audit reminder

When this ADR closes, update ADR-0118's known-debt counter to 0 for the broadened-gate sections. Update ADR-0135 Matrix C if the fix changes any plugin-shipped skill counts (it shouldn't — purely path-resolution change). Add a memory entry under `feedback-` namespace stating "the cwd-anchoring class is eliminated; runtime guard is the canonical enforcement point".
