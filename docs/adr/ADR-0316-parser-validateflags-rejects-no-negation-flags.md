---
status: proposed
date: 2026-06-10
tags: [cli, parser, flag-validation, doc-drift, fix, upstream-shared]
supersedes: []
depends-on: [ADR-0208]
implements: []
---

# `validateFlags` rejects advertised `--no-*` boolean-negation flags

## Context and Problem Statement

`init --help` advertises `--no-global` (skip the `~/.claude/CLAUDE.md` pointer
block, #1744), but `init --no-global --force` exits 1 with `Unknown option:
--global` before the command body runs. A swarm investigation (2026-06-10)
traced it one layer below where it first appeared:

- The flag **is** declared (`commands/init.ts:1277`, `name: 'no-global'`),
  **parsed** (`parser.ts:340-343` negation branch: `--no-global` → stripped key
  `global` → `flags.global = false`), **honored** (`init.ts:194` reads
  `ctx.flags['global'] === false` → `:343` `skipGlobalClaudeMd = true`), and
  **listed** in `--help`. The #2098A consumer fix (`b5d12dc934`, 2026-05-21) is
  correct.
- But it is **unreachable**: `parser.ts` `validateFlags` builds `knownFlags`
  from declared option *names* (`no-global` → `normalizeKey` → `noGlobal`) and
  iterates `Object.keys(flags)`, which contains the *stripped* key `global`.
  `knownFlags.has('global')` is false → `Unknown option: --global` → `index.ts`
  exits 1. Active because **ADR-0208** set `allowUnknownFlags: false`.

The negation branch stores the stripped canonical key; `validateFlags` only
knows the declared `no-*` name; the two never reconcile. **General parser bug,
not init-specific** — all 6 declared `--no-*` flags are affected: `no-color`
(global + `hooks.ts`), `no-global` (`init.ts`), `no-auto-permissions`
(`hive-mind.ts`), `no-backup` (`appliance-advanced.ts`), `no-ruvector`
(`hooks.ts`). The user-visible instance is `init --no-global`. (`plugins.ts`
declares a *positive* `global` option, so `plugins … --no-global` coincidentally
works — which is why the bug was inconsistent and missed.)

Live-reproduced on the shipped bin (`status --no-color` → `Unknown option:
--color`, hermetic, no init side effects). `--help`/`--version` short-circuit
before validation, which is why the contradiction hides in help output.
Pre-existing (flag 2026-05-05 `7cdc331832`; #2098A consumer fix 2026-05-21
touched only `init.ts`, never `parser.ts`). **Upstream `origin/main` is
identical** — same unreachable-fix bug; per project policy, do not donate back.
Coverage gap: `parser.test.ts` tests negation parsing and `validateFlags` in
isolation, never their interaction under `allowUnknownFlags:false`.

## Decision Drivers

- An advertised flag that the parser rejects is the advertised-but-broken defect
  class the project forbids (ADR-0210 lineage). `--help` is a contract.
- One-site fix covering all 6 `--no-*` flags uniformly beats per-flag patches.
- ADR-0208's strict validation is correct — the gap is that it never accounted
  for the negation branch's key-stripping.

## Considered Options

1. **Reconcile `validateFlags` with the negation branch (chosen).** When a
   declared option name starts with `no-`, also register its stripped+normalized
   canonical key in `knownFlags`. One site in `parser.ts`; covers every `--no-*`.
2. **Per-flag allow-listing.** Add each stripped key by hand. Rejected — misses
   future `--no-*` flags; not DRY.
3. **`allowUnknownFlags: true` for init.** Rejected — reverts ADR-0208's strict
   validation and lets genuine typos through.

## Decision Outcome

**Chosen: Option 1.** `parser.ts` `validateFlags`, after building `knownFlags`,
registers `normalizeKey(opt.name.slice(3))` for every declared option whose name
starts with `no-`, so the negation branch's `flags.foo=false` survives
validation. Implemented in `forks/ruflo` `f26e858c2`. Distinct from #2098A
(consumer-read fix) and ADR-0208 (which correctly introduced strict validation).

## Consequences

- **Good:** all 6 advertised `--no-*` flags become functional; `--help` stops
  lying. No behavior change for normal flags (verified: `force`, `skip-claude`
  unaffected — no false positives).
- **Cost / risk:** negligible — additive to the known-flag set.

## Confirmation (acceptance — wired into `test-acceptance*.sh` + a workflow)

- `lib/acceptance-adr-noglobal-checks.sh` (RED-until-published — validates the
  shipped artifact): **advertised** — `init --help` lists `--no-global` (PASS on
  current artifact); **negation-accepted** — `status --no-color` (the same
  `validateFlags` path, hermetic, no init hang) does NOT print `Unknown option`
  (FAILs on the live buggy artifact, flips GREEN once the fork fix ships).
- Recommend a `parser.test.ts` unit asserting `validateFlags` returns `[]` for
  `{ color: false }` against a command declaring `no-color` (closes the
  isolation gap). Per `feedback-always-wire-tests-into-cicd`: wire run_check_bg +
  collect_parallel + `.github/workflows/`.
