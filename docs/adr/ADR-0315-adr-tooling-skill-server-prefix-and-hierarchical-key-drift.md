---
status: proposed
date: 2026-06-10
tags: [adr-tooling, skills, mcp-server-registration, hierarchical-memory, doc-drift, plugin]
supersedes: []
depends-on: [ADR-0113, ADR-0117, ADR-0281, ADR-0285]
implements: []
---

# ADR-tooling skill drift: `mcp__ruflo__` prefix, `adr/<id>` key slash, and `path:`/`key:` naming

## Context and Problem Statement

While creating an ADR in a downstream project via the `ruflo-adr` `adr-create`
skill, three independent mismatches surfaced between what the skill **documents**
and what the installed tool **accepts**. None corrupted the ADR file (the
markdown file is the canonical artefact; the AgentDB store is an index/search
convenience), but each makes the skill fail or silently no-op when followed
verbatim:

1. **Hierarchical key contains `/`.** Skill step 4 stores with
   `key: adr/ADR-NNNN`. The drift only bites on **upstream / older installs**:
   - **Current fork (`@sparkleideas/*`):** `agentdb_hierarchical-store`
     validates the key with `validateString` (length-only, **allows `/`** —
     `agentdb-tools.ts:695`). `hierarchical-delete` (ADR-0281 R3) and the causal
     create/delete/node paths (ADR-0285 P5) were deliberately moved to the same
     length-only validation so the whole `adr/<id>` keyspace round-trips. So on
     the current fork `adr/ADR-NNNN` **works**.
   - **Upstream `claude-flow` or a pre-ADR-0281 fork:** the key is gated by
     `validateIdentifier` (`validate-input.ts:13`,
     `/^[a-zA-Z0-9_][a-zA-Z0-9_\-.:]{0,127}$/`) which **rejects `/`** (but
     allows `:`). Following the skill there fails; the colon form
     `adr:ADR-NNNN` is what succeeds.

2. **`mcp__ruflo__` server prefix.** Skill tool refs are
   `mcp__ruflo__agentdb_hierarchical-store` (etc.). Claude Code resolves
   `mcp__<key>__<tool>` where `<key>` is the **server registration key** in
   `.mcp.json`, not the server's announced `name`. A project that registered the
   server as `claude-flow` (e.g. via the legacy
   `claude mcp add claude-flow …` bootstrap, or a pre-ADR-0117 `init`, or
   upstream's public-npm package) exposes the tools as `mcp__claude-flow__*`, so
   the skill's `mcp__ruflo__*` refs resolve to nothing and the caller must
   substitute `mcp__claude-flow__*` by hand.

3. **`path:` vs `key:` parameter naming.** The live schema's field is `key`. The
   current `adr-create/SKILL.md` (step 4) and `commands/adr.md` already say
   `key`, but `agents/adr-architect.md:71` still says *"with path `adr/<adr-id>`"*
   — stale naming in the agent doc.

**Provenance (answers "was the prefix added with the mirror ODR skill?" — no):**
- The `mcp__ruflo__` prefix entered via **ADR-0113 Phase C** (`b24e46829`,
  2026-05-02), which rebranded 524 `mcp__claude-flow__*` → `mcp__ruflo__*` across
  121 plugin `.md` files for the sparkling marketplace identity.
- **ADR-0117** then registered the `ruflo` MCP server via `init`'s
  service-method so those refs resolve (chosen over a wholesale 522-file
  rebrand). It explicitly accepted that a `claude-flow`-keyed registration leaves
  `mcp__ruflo__*` refs unresolved.
- The ODR skills (`~/.claude/skills/odr-{create,index,review}`) are a later
  mirror of the ADR skills and **inherited** the already-`ruflo` prefix; there
  are zero ODR commits in the fork. The ODR mirror did not introduce it.
- The `/`-in-key acceptance on the fork is the result of **ADR-0281** (store +
  delete) and **ADR-0285 P5** (causal) moving off `validateIdentifier` to
  length-only `validateString`. The skill's `adr/<id>` is therefore correct *for
  the fork* but fragile against upstream/older servers.

## Decision Drivers

- **Skill honesty / works-when-followed** — a skill that documents a value or
  tool name the installed surface refuses is the same advertised-but-broken
  defect class the project forbids elsewhere (ADR-0210 lineage).
- **Robustness across server identity** — the skill should work whether the MCP
  server is registered as `ruflo` (ADR-0117 canonical) or `claude-flow` (legacy
  bootstrap / upstream), and against both the fork's length-only key validation
  and upstream's `validateIdentifier`.
- **Keyspace consistency** — existing fork stores use `adr/<id>`; a switch to
  `adr:<id>` forks the keyspace and would orphan prior records from queries.
- **Surgical, fork-only** (`feedback-patches-in-fork`).

## Considered Options

**For (1) the `/` key:**
- **A1 — Skill uses `adr:ADR-NNNN` (colon).** Works on fork AND upstream/older
  (`:` is in `validateIdentifier`). Cost: forks the keyspace from existing
  `adr/<id>` records; `hierarchical-query adr/ADR-*` globs and the adr-index
  builder assume `/`.
- **A2 — Keep `adr/ADR-NNNN` (slash); require the fork server.** No skill change;
  instead guarantee the project runs the current fork (which accepts `/`). Pairs
  with fixing (2). Cost: skill is knowingly non-portable to upstream.
- **A3 — Relax `validateIdentifier` to accept `/` globally.** Moot for store
  (already length-only) and already done for delete/causal; would only matter for
  any remaining `validateIdentifier`-gated key path.

**For (2) the prefix:**
- **C1 — Align registration to `ruflo` everywhere (ADR-0117 canonical).** Fix the
  CLAUDE.md "Support" bootstrap line (`claude mcp add claude-flow …` →
  register as `ruflo`) and ensure `init` registers `ruflo`, so `mcp__ruflo__*`
  refs resolve. Skill unchanged.
- **C2 — Make skills server-agnostic.** Not expressible — Claude Code skills
  reference tools by the full `mcp__<key>__<tool>` literal; there is no wildcard.
- **C3 — Per-project remediation.** Re-register the affected downstream
  project's server as `ruflo` pointing at `@sparkleideas/ruflo`.

**For (3) naming:** trivial — `s/path/key/` in `agents/adr-architect.md` (+ audit
`commands/`).

## Decision Outcome

**Proposed — fix direction pending maintainer selection (see Open Question).**
The likely-recommended combination, subject to confirmation:
- **(1) A2** (keep `adr/<id>`; the fork already accepts it — do not fork the
  keyspace) **+** **(2) C1** (align bootstrap/registration to `ruflo` so the
  fork server is what the skill talks to) **+** **(3)** the trivial doc fix.

This keeps the existing keyspace, makes the skill correct against the fork it is
written for, and fixes the prefix at its real root (registration identity, per
ADR-0117) rather than per-skill. The alternative emphasis — **(1) A1** colon key
for maximum portability to upstream — is recorded but trades keyspace
consistency for upstream-compat the fork doesn't otherwise need.

## Consequences

- **Good:** the `adr-create`/`adr-index` skills work when followed verbatim on a
  correctly-registered fork project; the bootstrap docs stop advertising a
  server key that breaks plugin refs.
- **Cost / risk (A1 path, if chosen):** keyspace migration of existing `adr/<id>`
  records, or dual-read; not free.
- **Out of scope:** a wholesale `claude-flow`→`ruflo` rebrand (ADR-0117 already
  rejected this).

## Confirmation (acceptance — wire into `test-acceptance*.sh` + a workflow)

- A skill-doc lint asserting `adr-create`/`adr-index`/`adr-architect` reference a
  single consistent tool prefix and parameter name (`key`, not `path`), matching
  the live schema.
- If C1: an acceptance check that a fresh `init` registers the MCP server under
  the key the skills reference (`ruflo`) and that `mcp__ruflo__agentdb_hierarchical-store`
  resolves; and that the CLAUDE.md bootstrap line matches.
- A round-trip check storing `adr/ADR-9XXX` via the shipped tool and reading it
  back (guards the `/`-acceptance regression).
- Per `feedback-always-wire-tests-into-cicd`: wire into the runner
  (`run_check_bg` + `collect_parallel`) and `.github/workflows/`.

## Open Question (maintainer — asked 2026-06-10)

Which fix emphasis: **A2+C1** (keep `adr/<id>`, align registration to `ruflo` —
fork-correct, keyspace-stable) or **A1** (switch the skill to `adr:<id>` colon
keys for upstream portability, accepting a keyspace fork)? And should the fix
also correct the legacy `claude mcp add claude-flow …` bootstrap line in
`CLAUDE.md` to register as `ruflo`?
