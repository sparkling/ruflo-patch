# ADR-0129: Hive-mind CLI bugs surfaced during ADR-0116/0117 testing

- **Status**: Proposed (2026-05-02), **Living tracker** (per ADR-0094 pattern) — last reviewed 2026-05-03; per-bug status may need refresh
- **Date**: 2026-05-02
- **Deciders**: Henrik Pettersen
- **Depends on**: ADR-0116 (marketplace plugin packaging — testing surfaced these bugs), ADR-0117 (MCP server registration)
- **Related**: ADR-0118 (runtime gaps tracker — orthogonal concern; these are CLI bugs, not runtime/protocol gaps)
- **Scope**: Fork-side CLI work in `forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts` and adjacent MCP-tool wiring. Per `feedback-patches-in-fork.md`, these are bugs and bugs are fixed in fork.

## Context

End-to-end testing of `ruflo-hive-mind` (ADR-0116) against `@sparkleideas/cli@3.5.58-patch.323` from a fresh `init --full` project surfaced four CLI-layer bugs that are **not** covered by ADR-0118's runtime tracker (T1-T10). The runtime tracker addresses advertised-but-unimplemented protocols/types (weighted/gossip/CRDT consensus, memory types + TTL, queen/worker-type behaviour, etc.). The bugs catalogued here are pure CLI bugs — dispatch routing, output formatting, argument parsing — that exist on top of an otherwise-working runtime.

Reproduction environment:
- Project: `/tmp/ruflo-newproj-test`, created via `npx @sparkleideas/cli@latest init --full`
- Plugin install: all 33 sparkling-marketplace plugins via `claude plugin install <name>@ruflo --scope project`
- CLI binary: `@sparkleideas/cli@3.5.58-patch.323` resolved from local Verdaccio
- Hive lifecycle exercised: `hive-mind init` → `spawn -n 3` → `broadcast` → `memory store/list` → `consensus` → `shutdown`

The four bugs are independent: each can be fixed and shipped without unblocking the others. None depend on ADR-0118 T1-T10 landing first.

## Decision

**Track four CLI bugs as discrete tasks (B1-B4) in this living tracker.** Each carries its own reproduction, root-cause hypothesis, file targets, and acceptance criteria. Each lands as a separate fork commit with its own test (per `feedback-no-fallbacks.md` + `feedback-all-test-levels.md`).

This document is the index — fixes ship in fork; the §Status table updates as bugs close.

## Bug catalog

### B1 — `hive-mind memory store -k <k> -v <v>` is a no-op

**Reproduction**:

```bash
$ npx @sparkleideas/cli@latest hive-mind memory store -k test/key -v "hello hive"
Shared Memory (0 keys)
[INFO] No keys in shared memory
```

The `store` subcommand emits the same output as `list` and the value never persists. `hive-mind memory list` after the `store` confirms 0 keys.

**Root-cause hypothesis**:
- The MCP tool `hive-mind_memory` (`mcp-tools/hive-mind-tools.ts:937-1010`) DOES support a `set` action against `state.sharedMemory[key]` (verified by ADR-0116's verification matrix). So the runtime is functional.
- The CLI bug is in `commands/hive-mind.ts`'s `memory` subcommand dispatcher — likely either (a) routes the `store` action to `list`, (b) constructs the `set` call with wrong field names that the MCP tool ignores, or (c) calls `set` but doesn't `saveHiveState()` so the value is dropped.

**Files to inspect**:
- `forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts` — `memory` subcommand handler
- `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:937-1010` — `hive-mind_memory` MCP tool

**Acceptance criteria**:
1. `hive-mind memory store -k k -v v` exits 0 with a confirmation message naming the key
2. `hive-mind memory list` immediately afterward shows 1 key with value `v`
3. `hive-mind memory get -k k` returns `v`
4. The stored value survives `hive-mind shutdown` + reinit (confirms `saveHiveState()` ran)
5. Unit test in `tests/unit/` exercises store→get→list against a temp hive root

### B2 — `hive-mind shutdown` reports `undefined`/`No` for telemetry fields

**Reproduction**:

```bash
$ npx @sparkleideas/cli@latest hive-mind shutdown
... Graceful shutdown in progress...                                    Hive mind shutdown complete

  - Agents terminated: undefined
  - State saved: No
  - Shutdown time: undefined
```

Three fields print placeholders. `State saved: No` is particularly suspicious — if state truly wasn't saved, that's a B1-class bug too; if it was saved, the field is misreporting.

**Root-cause hypothesis**:
- The shutdown handler returns an object (from `hive-mind_shutdown` MCP tool, `mcp-tools/hive-mind-tools.ts:872`) but the CLI output template reads field names that don't match the returned shape.
- Or: the shutdown MCP tool itself returns a stub without those fields populated, and the CLI dutifully prints `undefined`.

**Files to inspect**:
- `forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts` — shutdown subcommand printer
- `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:872` — `hive-mind_shutdown` MCP tool

**Acceptance criteria**:
1. After running `init` + `spawn -n 3` + `shutdown`: output shows numeric agent count (3), `State saved: Yes`, ISO timestamp for shutdown time
2. Unit test asserts the JSON returned by `hive-mind_shutdown` contains keys `agentsTerminated: number`, `stateSaved: boolean`, `shutdownTime: string`
3. Acceptance check that runs the full lifecycle and greps for `undefined` in shutdown output (must be zero matches)

### B3 — `hive-mind <subcommand> --help` prints parent help

**Reproduction**:

```bash
$ npx @sparkleideas/cli@latest hive-mind memory --help
# (prints the parent `hive-mind` subcommand list, not `memory`-specific help)

$ npx @sparkleideas/cli@latest hive-mind consensus --help
# (same — parent help, not consensus-specific)
```

This affects all 11 hive-mind subcommands. Users running `--help` on a specific subcommand can't discover its flags.

**Root-cause hypothesis**:
- The CLI's argument-parser routes `--help` to the deepest registered command. If the subcommand's `--help` handler isn't registered (or the parser short-circuits to the parent), the global parent help wins.
- Could be a yargs/commander config quirk, or per-subcommand definitions missing `.help()` registration.

**Files to inspect**:
- `forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts` — subcommand definitions
- Whatever CLI framework is in use (yargs builders + `command()` chains)

**Acceptance criteria**:
1. Each of 11 subcommands (`init`, `spawn`, `status`, `task`, `join`, `leave`, `consensus`, `broadcast`, `memory`, `optimize-memory`, `shutdown`) has a distinct `--help` output naming its own flags
2. The `--help` output for `spawn` documents `-n`, `-t`, `--queen-type`, `--consensus`, `--claude` per ADR-0116 AC #6
3. Acceptance check loops over the 11 subcommands and asserts `--help` output contains a unique-to-that-subcommand string (e.g. each subcommand's name appears in its own help body)

### B4 — `hive-mind spawn -t a,b,c` treats comma-string as a single literal type

**Reproduction**:

```bash
$ npx @sparkleideas/cli@latest hive-mind spawn -n 3 -t researcher,coder,tester
[INFO] Spawning 3 worker agent(s)...
+--------------------------------+--------+--------+----------+
| Agent ID                       | Role   | Status | Joined   |
+--------------------------------+--------+--------+----------+
| hive-worker-...-3vaa           | worker | idle   | 21:59:43 |
| hive-worker-...-fy9r           | worker | idle   | 21:59:43 |
| hive-worker-...-7jmn           | worker | idle   | 21:59:43 |
+--------------------------------+--------+--------+----------+
```

In subsequent `status` output, all 3 workers display Type `researche...` (truncated). The comma-separated string is being stored as a single type literal applied to all workers.

**Root-cause hypothesis**:
- `-t` flag is declared as `string` (single value) rather than `string[]` (array via repeated flags) or with a `coerce` that splits on commas
- The spawn handler then passes the same string to all `n` workers

**Decision needed**: pick one input contract:
- **Option A**: repeated flag — `-t researcher -t coder -t tester` (most CLI-conventional; works with most parsers natively)
- **Option B**: comma-split — `-t researcher,coder,tester` (matches the user's intuition seen in this bug; one extra `coerce` step)
- **Option C**: support both
- **Option D**: introduce `--types <list>` as separate flag

ADR-0116 doesn't pin this; the spawn command's frontmatter just says `-t` exists. Pick A or B and document.

**Files to inspect**:
- `forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts` — `spawn` subcommand builder

**Acceptance criteria**:
1. After picking the input contract: `spawn -n 3 -t <three types>` results in 3 workers with the 3 distinct types, visible in `status` output
2. If `n` workers requested but fewer types specified: documented behaviour (cycle? error? assign default?)
3. If more types than `n` specified: documented behaviour (truncate? error?)
4. Unit test covers the picked contract + the under/over edge cases
5. AC #6 in ADR-0116 (spawn documents `--queen-type` and `--consensus`) gets extended to also assert `-t` semantics in the spawn command's `--help` (this depends on B3 fixing per-subcommand help)

## Dependency graph

- B3 (per-subcommand help) is a soft dependency for B4 acceptance — B4's AC #5 reads spawn's `--help` to assert `-t` semantics
- B1 and B2 share the `hive-mind-tools.ts` file but touch different MCP-tool definitions (`memory` vs `shutdown`) — pickable independently
- All four are independent of ADR-0118 T1-T10. None block T-tasks; T-tasks don't block these.

## Status

| Bug | Title | Status | Owner | Commit | Notes |
|---|---|---|---|---|---|
| B1 | `memory store` is a no-op | open | — | — | — |
| B2 | `shutdown` undefined/No fields | open | — | — | — |
| B3 | `--help` falls through to parent | open | — | — | affects all 11 subcommands |
| B4 | `spawn -t a,b,c` not split | open | — | — | input-contract decision needed |

Status values: `open` | `in-progress` | `complete` | `wontfix`. When a bug closes, fill `Owner`/`Commit`, set `complete`, and confirm the corresponding acceptance check is wired into `scripts/test-acceptance.sh`.

## Why a separate tracker (vs. amending ADR-0118)

ADR-0118 tracks **runtime/protocol gaps** — things the USERGUIDE advertises that have no working implementation (weighted consensus, gossip protocol, memory types + TTL, queen-type runtime differentiation, etc.). Each T-task is a non-trivial implementation that closes a feature gap.

ADR-0129 tracks **CLI bugs** — surfaces where the runtime works but the CLI dispatch/output/parsing layer is broken. Each B-task is small (probably <100 lines + tests) and orthogonal to the runtime.

Mixing them in ADR-0118 would conflate two different work streams with different file targets, different review surface, and different dependencies on other T-tasks. Keeping them separate keeps each tracker focused and lets either track close independently.

## Acceptance criteria (tracker-level)

- [ ] Each B-task has reproduction steps that fail before the fix and pass after
- [ ] Each B-task lands with unit tests in `tests/unit/` covering the fix
- [ ] Where applicable (B1, B4), an acceptance check is wired into `scripts/test-acceptance.sh` so regressions are caught
- [ ] §Status table reflects current state of each B-task

## Out of scope

- ADR-0118 T1-T10 (runtime gaps) — separate tracker
- USERGUIDE re-flow / doc updates — covered by ADR-0116 plugin README annotations
- Any non-hive-mind CLI bugs — file under their own ADR or fix directly per `feedback-patches-in-fork.md`

## References

- ADR-0116 §USERGUIDE-vs-implementation verification matrix — surfaced what's runtime vs documentation
- ADR-0116 §Acceptance criteria #11 — CLI command coverage check (does NOT verify each subcommand's `--help` output, hence B3 wasn't caught)
- ADR-0118 — runtime gaps tracker (10 T-tasks, orthogonal)
- Reproduction transcript: this conversation 2026-05-02 (testing of hive-mind plugin against `@sparkleideas/cli@3.5.58-patch.323`)
- `feedback-patches-in-fork.md` — fork is the right place for these fixes
- `feedback-no-fallbacks.md` — fixes ship with tests; no silent passes
