---
status: implemented
date: 2026-05-20
implemented-date: 2026-05-22
tags: [init, mcp, ruflo-wrapper, brand, no-fallbacks, audit-followup]
supersedes: []
depends-on: [0201]
implements: []
---

# Canonicalize init-emitted MCP commands and brand hints to `@sparkleideas/ruflo` wrapper

> **Reviewed directly (2026-05-22).** Drafted from the ADR-0201 audit's slice
> 11 (init + MCP installation) — four related brand / wrapper / freshness
> drifts in init-emitted output not covered by ADR-0212 (ruflo bin name
> collision rename) or ADR-0213 (agentdb MCP registration). All four verified
> against live source and Option A confirmed; the F-11-004 marketplace source
> (left open by the draft) is resolved to `sparkling/ruflo`. See *Direct
> review*.

## Context and Problem Statement

The ADR-0201 audit's slice 11
(`docs/audits/2026-05-19-soundness-audit/11-init-mcp-installation.md`)
verified that the auto-generated `.mcp.json` matches canonical byte-for-byte
(F-11-010, F-11-007). But four init-emitted *adjacent* surfaces drift from
the canonical user-facing brand established by ADR-0143 + memory
[[reference-user-facing-brand]] + memory [[feedback-always-npx-for-ruflo]]:

- **F-11-001 [MEDIUM]** —
  `forks/ruflo/v3/@claude-flow/cli/src/init/mcp-generator.ts:124-151`.
  `generateMCPCommands()` emits manual-setup hint strings:
  - Hint emits: `claude mcp add claude-flow -- npx -y @sparkleideas/cli@latest mcp start`
  - Canonical: `claude mcp add ruflo -- npx -y @sparkleideas/ruflo@latest mcp start`
  - The hint uses the wrong server key (`claude-flow` instead of `ruflo`)
    AND the wrong binary (`@sparkleideas/cli` instead of `@sparkleideas/ruflo`).
    A user copy-pasting the hint registers the internal package under a
    deprecated key, then the `mcp__ruflo__*` tool prefixes documented
    elsewhere fail to resolve. README HIGH H13 elevates this severity.
- **F-11-002 [LOW]** —
  `forks/ruflo/v3/@claude-flow/cli/src/init/mcp-generator.ts:94-98`.
  `ruv-swarm` is not pinned to `@latest`:
  - `ruflo` uses `@sparkleideas/ruflo@latest` (correct per ADR-0155
    freshness rule)
  - `flow-nexus` uses `flow-nexus@latest`
  - `ruv-swarm` uses `'ruv-swarm'` (no `@latest`) — npx resolves from
    cache, exact staleness shape ADR-0155 eliminated for `ruflo`.
  - One-character fix (`'ruv-swarm@latest'`) brings it into line.
- **F-11-004 [MEDIUM]** —
  `forks/ruflo/v3/@claude-flow/cli/src/init/claudemd-generator.ts:171`.
  Generated CLAUDE.md documents the manual `/plugin marketplace add`
  command using `ruvnet/ruflo` (upstream) as the source. Per memory
  [[feedback-upstream-means-upstream]], `ruvnet/ruflo` is 395+ commits
  behind the fork; per ADR-0143 + memory [[reference-user-facing-brand]]
  the user-facing brand + marketplace.json owner is `sparkling`. The
  documented source should be `sparkling/ruflo` (or whatever the published
  marketplace path is), not `ruvnet/ruflo`.
- **F-11-005 [LOW]** —
  `forks/ruflo/v3/@claude-flow/cli/src/commands/init.ts:517-526` (init
  flow) + `:878` (upgrade flow). "Next steps" hint block prints
  `claude-flow daemon start` / `claude-flow memory init` / `claude-flow
  swarm init` / `claude-flow init --start-all` while the same block
  already uses `ruflo plugins --help` and `ruflo skill list` (lines
  524-525). Internal inconsistency. Per ADR-0143, the user-facing command
  is `ruflo`.

All four findings share a root cause: init-emitted output (manual-setup
hints, plugin marketplace hints, "Next steps" text) was not updated when
ADR-0143 introduced the `@sparkleideas/ruflo` wrapper as the canonical
user-facing surface. The auto-generated `.mcp.json` itself is correct;
the *surrounding* user-facing output drifts.

This is distinct from:

- **ADR-0212** — `ruflo` bin name collision (the npm bin resolution
  problem at `node_modules/.bin/ruflo`). Different surface.
- **ADR-0213** — `@sparkleideas/agentdb` MCP entry (the missing 5th-fork
  MCP server). Different finding (F-11-003).
- **ADR-0214** — env-var canonicalization (`CLAUDE_FLOW_*` naming-skew).
  Different surface (env vars, not commands/hints).

## Decision Drivers

- [[feedback-always-npx-for-ruflo]] — ALL registration must use
  `npx -y @sparkleideas/ruflo@latest mcp start`, never `@sparkleideas/cli`
  directly.
- [[reference-user-facing-brand]] — canonical user-facing brand per
  ADR-0143 is `@sparkleideas/ruflo`; `@sparkleideas/cli` is internal-only.
- [[feedback-upstream-means-upstream]] — upstream is `ruvnet/*` (the
  read-only origin), NOT the user-facing project. F-11-004's
  `ruvnet/ruflo` reference is wrong.
- ADR-0155 — freshness wins; npm install must resolve from registry
  (`@latest`), not from npx cache.
- [[feedback-no-fallbacks]] — divergence between the docs the user reads
  and the actual config init writes is the documentation-drift shape of
  the silent-fallback pattern (the user-facing docs lie about what
  init does).
- README severity: F-11-001 is HIGH H13; F-11-002 / F-11-004 / F-11-005
  are MEDIUM/LOW per the per-doc audit.

## Considered Options

- **Option A — Fix all four in one ADR (chosen).** Single edit pass:
  - `mcp-generator.ts:124-151`: flip `claude-flow` → `ruflo`,
    `@sparkleideas/cli@latest` → `@sparkleideas/ruflo@latest` in
    `generateMCPCommands()`.
  - `mcp-generator.ts:94-98`: change `'ruv-swarm'` →
    `'ruv-swarm@latest'`.
  - `claudemd-generator.ts:171`: replace `ruvnet/ruflo` with the correct
    marketplace source (`sparkling/ruflo` per memory; verify the actual
    published marketplace path during dialectic).
  - `init.ts:517-526` + `:878`: flip 4 `claude-flow` references to
    `ruflo`.
  All four share a "init-emitted output canonicalization" theme — one ADR,
  one PR, one review.
- **Option B — Fix only F-11-001 + F-11-005 (the brand drifts); defer
  F-11-002 + F-11-004 (the freshness + marketplace) to separate ADRs.**
  Rejected: artificial splitting — all four are init-emitted output
  drift; bundling reduces review overhead.
- **Option C — Fix only F-11-001 (the highest-severity one); leave the
  rest as known-limitations.** Rejected: the other three are single-line
  fixes; deferring them is purely procedural noise.
- **Option D — Status quo + documentation note that init output has
  known drifts.** Rejected: actively misleading users (the hint they
  copy-paste does the wrong thing).

## Decision Outcome

**Chosen: Option A — fix all four init-emitted drifts in one pass.**

Specific edits:

1. **F-11-001 fix** (`mcp-generator.ts:124-151`):

   ```ts
   // Replace:
   return [
     `claude mcp add claude-flow -- npx -y @sparkleideas/cli@latest mcp start`,
     ...
   ];

   // With:
   return [
     `claude mcp add ruflo -- npx -y @sparkleideas/ruflo@latest mcp start`,
     ...
   ];
   ```

   The `flow-nexus` and `ruv-swarm` lines in the same function get the
   F-11-002 fix (add `@latest`) applied at the same time.

2. **F-11-002 fix** (`mcp-generator.ts:94-98` + the hint lines at
   `:133,143`):

   ```ts
   // Replace:
   args: ['ruv-swarm', 'mcp', 'start'],

   // With:
   args: ['ruv-swarm@latest', 'mcp', 'start'],
   ```

3. **F-11-004 fix** (`claudemd-generator.ts:171`): replace
   `/plugin marketplace add ruvnet/ruflo` with
   `/plugin marketplace add sparkling/ruflo`. **Resolved (2026-05-22):** the
   fork's `.claude-plugin/marketplace.json` declares `owner.name: "sparkling"`
   / `name: "ruflo"`, and the fork's push remote is
   `git@github.com:sparkling/ruflo.git` — so `sparkling/ruflo` is the correct
   marketplace source. (Scope note: the `ruvnet/ruflo` *Documentation/Issues*
   URLs at `:185/:276/:277` are a separate question — the public docs live
   upstream — and are NOT part of F-11-004's marketplace-source fix.)

4. **F-11-005 fix** (`init.ts:517-526` + `:878`): four `claude-flow` →
   `ruflo` substitutions per block.

### Consequences

- Good, because users following the manual-setup hint get a working
  registration (no more wrong-key + wrong-binary copy-paste lossage).
- Good, because `ruv-swarm` joins the freshness invariant (`@latest`)
  established by ADR-0155.
- Good, because the plugin marketplace hint points at the maintained fork
  surface, not the stale upstream.
- Good, because the "Next steps" hint becomes self-consistent (all
  `ruflo`, not mixed `claude-flow`/`ruflo`).
- Bad, because users who memorized the old `claude-flow` hint will see
  different output — small UX cost; the new hint is the correct one.
- Neutral, because the F-11-004 marketplace source is now resolved
  (`sparkling/ruflo`, per the fork's `marketplace.json` owner + the sparkling
  remote) — no longer a dialectic-pending item.
- Neutral, because the auto-generated `.mcp.json` is unchanged (it was
  already correct per F-11-010).

### Confirmation

1. **Unit test (F-11-001):** call `generateMCPCommands()`; assert the
   returned strings contain `ruflo` (server key) and `@sparkleideas/ruflo@latest`
   (binary), NOT `claude-flow` or `@sparkleideas/cli@latest`.
2. **Unit test (F-11-002):** call `generateMCPConfig()` with `ruvSwarm: true`;
   assert the `args` array contains `'ruv-swarm@latest'`.
3. **Acceptance check (F-11-001 + F-11-004 + F-11-005):** fresh `ruflo init`
   sandbox per [[feedback-inspect-installed-not-dev-nodemodules]]:
   - Read the printed "Next steps" output; assert zero `claude-flow`
     substring matches.
   - Read the generated CLAUDE.md; assert the marketplace hint cites the
     sparkling source, NOT `ruvnet/ruflo`.
4. **Grep guard:** new arch-test in
   `forks/ruflo/v3/@claude-flow/cli/__tests__/arch/` that asserts:
   - `init.ts` + `mcp-generator.ts` + `claudemd-generator.ts` contain
     no `@sparkleideas/cli@latest` substring (it should be
     `@sparkleideas/ruflo@latest` throughout user-facing output).
   - Only internal pipeline code (not user-facing emissions) may reference
     `@sparkleideas/cli`.
5. **`npm run release`** acceptance group covering init passes unchanged
   except for the new test assertions.

## Pros and Cons of the Options

### Option A — fix all four in one ADR

- Good, because the four findings share a root cause (init-emitted output
  drift from ADR-0143 brand).
- Good, because one PR, one review, one acceptance.
- Bad, because F-11-004 needs marketplace-source verification during
  dialectic.

### Option B — split brand vs freshness vs marketplace

- Good, because each ADR scopes to one drift.
- Bad, because four 100-line ADRs for what is one root-cause fix.

### Option C — fix only F-11-001

- Bad, because the other three are single-line fixes shipped at the same
  cost.

### Option D — status quo + doc note

- Bad, because users follow the broken hint and the surface stays broken.

## Direct review (2026-05-22)

Reviewed directly (not via swarm) against the live fork source. **Verdict:
Option A confirmed; the F-11-004 marketplace source resolved.** All four
findings reproduce:

- **F-11-001** verified — `mcp-generator.ts:140` (and the Windows variant
  `:130`) emit `claude mcp add claude-flow -- npx -y @sparkleideas/cli@latest
  mcp start` (wrong key + wrong binary), while the `.mcp.json` entry itself
  (`:34`) already correctly uses `@sparkleideas/ruflo@latest` — only the
  copy-paste hint is broken.
- **F-11-002** verified — `ruv-swarm` is `['ruv-swarm', …]` (`:95`) and the
  hints (`:133/:143`) lack `@latest`, while `flow-nexus` has it.
- **F-11-005** verified — `init.ts:519-522` (+ upgrade `:878-881`) print
  `claude-flow daemon/memory/swarm/init` alongside `ruflo plugins`/`ruflo skill
  list` (`:524-525`) — the mixed brand.
- **F-11-004 resolved** — marketplace source is `sparkling/ruflo` (the fork's
  `.claude-plugin/marketplace.json` declares `owner: "sparkling"` / `name:
  "ruflo"`; push remote is `sparkling/ruflo`). The draft's "verify during
  dialectic" is closed.

Option A (one pass for all four) is correct — they share the ADR-0143
brand-drift root. The fix uses `@sparkleideas/ruflo@latest`, matching the
already-correct `.mcp.json` and [[feedback-always-npx-for-ruflo]] — no
wrapper-`@latest` regression introduced. Sibling boundaries (0212/0213/0214)
and the out-of-scope findings (F-11-003/006/007/008/009/010) are accurate.

## More Information

- **Audit source:** `docs/audits/2026-05-19-soundness-audit/11-init-mcp-installation.md`
  findings F-11-001 / F-11-002 / F-11-004 / F-11-005; README
  `00-README.md` HIGH H13.
- **Memory references:** [[feedback-always-npx-for-ruflo]],
  [[reference-user-facing-brand]], [[feedback-upstream-means-upstream]],
  [[project-adr0117-rebrand]] (marketplace registration context),
  [[feedback-no-fallbacks]] (documentation-drift shape),
  [[project-adr0201-remediation-impl-order]].
- **Related ADRs:** ADR-0143 (canonical user-facing brand = `@sparkleideas/ruflo`),
  ADR-0155 (npm freshness invariant — `@latest` everywhere),
  ADR-0117 (marketplace MCP server registration), ADR-0212 (ruflo bin
  name collision rename — different surface), ADR-0213 (agentdb MCP
  registration — different finding F-11-003), ADR-0214 (env-var
  canonicalization — different surface), ADR-0201 (parent audit).
- **NOT in scope:** F-11-003 (agentdb MCP entry — owned by ADR-0213),
  F-11-006 (idempotency — SOUND per audit), F-11-007 (hooks installation
  — SOUND), F-11-008 (skills install — SOUND modulo `dualMode` policy
  flagged separately), F-11-009 (daemon start opt-in — intentional),
  F-11-010 (path references — SOUND).

## Amendment — 2026-05-23 (Move A audit, implemented)

Status flipped: **proposed → implemented**. All 4 fixes shipped in `forks/ruflo` commit `dfe8ea93a`:

| Finding | Location | Verified |
|---|---|---|
| F-11-001 | `mcp-generator.ts:152,162` — `ruflo` key + `@sparkleideas/ruflo@latest` | arch-test (2 cases) |
| F-11-002 | `mcp-generator.ts:105,155,165` — `ruv-swarm@latest` | arch-test (2 cases) |
| F-11-004 | `claudemd-generator.ts:171` — `/plugin marketplace add sparkling/ruflo` | arch-test (2 cases: standard + full template) |
| F-11-005 | `init.ts:531-533,892-894` — `ruflo daemon/memory/swarm`; init.ts grep-guard | arch-test (2 cases: forbidden + positive) |

Grep-guard: 3 emitter files (`init.ts`, `mcp-generator.ts`, `claudemd-generator.ts`) contain zero `@sparkleideas/cli@latest` in user-facing output (comments stripped).

**Arch-test:** `forks/ruflo/v3/@claude-flow/cli/__tests__/arch/adr0223-init-emitted-brand-canonicalization.arch.test.ts` — 11/11 passing, 3ms.

Documentation/Issues URLs at `claudemd-generator.ts:278,284-285` intentionally remain at `https://github.com/ruvnet/ruflo` per the ADR's scope note (docs live upstream; only the marketplace source is fork-published).

**INTEGRATION-LEDGER row** already recorded at `docs/upstream/INTEGRATION-LEDGER.md:134` (cites `dfe8ea93a` + `1fa33d6`).

**Risk:** upstream is converging on `ruflo@alpha`/`npx ruflo@alpha` while fork uses `@sparkleideas/ruflo@latest`. Per ADR-0155 + [[feedback-always-npx-for-ruflo]] this is intentional but guarantees ongoing upstream-sync friction on these 3 files.
