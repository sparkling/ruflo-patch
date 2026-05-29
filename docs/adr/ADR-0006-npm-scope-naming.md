# ADR-0006: @sparkleideas as npm Scope

## Status

Implemented

## Context

### Specification (SPARC-S)

ADR-0005 establishes that we will fork upstream repos and publish rebuilt packages to public npm under a new scope. This ADR decides the scope name.

The upstream ecosystem uses multiple naming conventions:

- `@claude-flow/*` -- the primary scoped packages (20 packages: `cli`, `memory`, `hooks`, etc.)
- `claude-flow` -- the unscoped core package
- `ruflo` -- a wrapper/CLI entry point around `claude-flow`
- `agentdb`, `agentic-flow` -- unscoped packages from `ruvnet/agentic-flow`
- `ruv-swarm` -- unscoped package from `ruvnet/ruv-FANN`
- `@ruvector/*` -- scoped packages from `ruvnet/ruvector` (not renamed; see ADR-0008)

Our repo is called `ruflo`. `ruflo` is a thin wrapper around `claude-flow`. The scope must clearly signal "this is a patched fork of the claude-flow ecosystem."

### Pseudocode (SPARC-P)

```
DEFINE scope = "@sparkleideas"

MAPPING:
  @claude-flow/*        -> @sparkleideas/*
  claude-flow           -> @sparkleideas/claude-flow
  agentdb               -> @sparkleideas/agentdb
  agentic-flow          -> @sparkleideas/agentic-flow
  ruv-swarm             -> @sparkleideas/ruv-swarm
  ruflo                 -> ruflo (top-level, unscoped)

NOT RENAMED:
  ruvector              -> ruvector (use published)
  @ruvector/*           -> @ruvector/* (use published)
```

## Decision

### Architecture (SPARC-A)

Use `@sparkleideas` as the npm scope for all rebuilt packages. The scope mirrors upstream `@claude-flow` with `-patch` appended, making the relationship immediately obvious.

**Complete package mapping:**

| Upstream Package | Our Package | Notes |
|-----------------|-------------|-------|
| `@claude-flow/memory` | `@sparkleideas/memory` | Scoped packages get direct mapping |
| `@claude-flow/cli` | `@sparkleideas/cli` | Same |
| `@claude-flow/hooks` | `@sparkleideas/hooks` | Same |
| `@claude-flow/neural` | `@sparkleideas/neural` | Same |
| `claude-flow` | `@sparkleideas/claude-flow` | Unscoped becomes scoped |
| `agentdb` | `@sparkleideas/agentdb` | Brought under scope for consistency |
| `agentic-flow` | `@sparkleideas/agentic-flow` | Same |
| `ruv-swarm` | `@sparkleideas/ruv-swarm` | Same |
| `ruflo` | `ruflo` | Top-level entry point, stays unscoped |

**Not renamed (use published versions from public npm):**

| Package | Reason |
|---------|--------|
| `ruvector` | Relatively current (see ADR-0008) |
| `@ruvector/*` | Same -- no rebuild needed |

### Considered Alternatives

1. **`@ruflo`** -- Rejected. `ruflo` is a wrapper around `claude-flow`, not the core ecosystem. Naming the scope after the wrapper creates a mismatch: `@ruflo/memory` implies "ruflo's memory" when it is actually "claude-flow's memory, patched." The scope should reflect the core package naming.

2. **`@ruflo`** -- Rejected. Too close to the upstream `ruflo` package name. Creates confusion about whether `@ruflo/cli` is an official upstream package or our fork.

3. **Unscoped packages** (e.g., `claude-flow-patch-memory`) -- Rejected. Clutters the global npm namespace with 20+ unscoped packages. Scoped packages are the standard practice for related package sets. Unscoped names are longer and harder to read.

4. **`@claude-flow-fixed`** -- Rejected. "Fixed" implies the upstream is broken, which is inaccurate -- the code works, it is just not published. "Patch" is more precise: we are applying patches and publishing current code.

## Consequences

### Refinement (SPARC-R)

**Positive:**

- Immediately recognizable relationship: seeing `@sparkleideas/memory` tells you it is a patched version of `@claude-flow/memory`
- The codemod is a straightforward string replacement: `@claude-flow/` becomes `@sparkleideas/`
- Users never type the scoped names directly -- they use `ruflo` which depends on `@sparkleideas/*` internally
- npm scope registration is a one-time operation

**Negative:**

- The scope name is long (20 characters). Internal dependency declarations are verbose. This is cosmetic -- users do not interact with these names.
- If upstream ever transfers the `@claude-flow` scope to us, the `-patch` suffix becomes misleading. This is a desirable problem to have.

**Trade-offs and edge cases:**

- Unscoped upstream packages (`agentdb`, `agentic-flow`, `ruv-swarm`) become scoped under `@sparkleideas`. This is intentional -- it groups all our packages under one scope for discoverability and namespace cleanliness.
- The top-level `ruflo` stays unscoped because it is the user-facing CLI entry point. Users type `npx ruflo`, not `npx @sparkleideas/ruflo`.
- `claude-flow` (unscoped upstream) becomes `@sparkleideas/claude-flow` (scoped). The codemod must handle this asymmetric mapping.

**Neutral:**

- npm scopes are free to register for public packages
- The scope can be registered under a personal npm account or an npm organization

### Completion (SPARC-C)

- [ ] npm scope `@sparkleideas` registered on npmjs.com
- [ ] Codemod handles all mappings in the table above, including the asymmetric `claude-flow` -> `@sparkleideas/claude-flow` case
- [ ] `npm view @sparkleideas/cli` resolves after first publish
- [ ] `ruflo` package.json lists `@sparkleideas/*` dependencies, not `@claude-flow/*`
- [ ] No `@ruvector/*` packages are renamed or republished

## Follow-up 2026-04-21: CLI bin rebrand to `ruflo`

**Rationale.** After install, users had to type `npx @sparkleideas/cli@latest ...` (or `claude-flow ...` via the backwards-compat alias) for every invocation. The short global-install name `ruflo` matches the repo/brand and drops a verbose 30-character prefix from the CLI surface.

**What changed.** In `forks/ruflo/v3/@claude-flow/cli/package.json` the `bin` map now exposes `ruflo` → `./bin/cli.js`, `ruflo-mcp` → `./bin/mcp-server.js`, and keeps `claude-flow` + `claude-flow-mcp` as backwards-compat aliases. The bare `"cli"` entry was removed — it collided with other globally-installed packages. The CLAUDE.md generator (`src/init/claudemd-generator.ts`) now emits `ruflo <cmd>` throughout the body; the one-time bootstrap `claude mcp add claude-flow -- npx -y @claude-flow/cli@latest` stays so first-run install still works without prior global install. MCP server identifier `claude-flow` and tool prefix `mcp__claude-flow__*` are unchanged — they are different identifiers and rebranding them would break tool lookup.

**Tests.** Two paired unit tests: `tests/unit/rebrand-ruflo-bin.test.mjs` (bin map contract — 7 assertions) and `tests/unit/rebrand-ruflo-claudemd.test.mjs` (template output against post-codemod dist — 7 assertions, with explicit fallback to pre-codemod source when `/tmp/ruflo-build` is absent).

**Backwards compatibility.** `claude-flow` and `claude-flow-mcp` bin entries are retained. Existing scripts that call the old names still work.

**Codemod gap fixed in-session (2026-04-21).** The original `scripts/codemod.mjs` `renameObjectKeys` passed every `bin` key through `applyNameMapping`. For unscoped names in `UNSCOPED_MAP` (notably `ruflo` and `claude-flow`), bin keys got rewritten to `@sparkleideas/ruflo` / `@sparkleideas/claude-flow` — invalid bin names (npm rejects `/` in executables). Post-codemod the published `bin` map ended up as `{"ruflo-mcp", "claude-flow-mcp", "@sparkleideas/ruflo", "@sparkleideas/claude-flow"}`, meaning `npm i -g @sparkleideas/cli` silently landed nothing usable. **Fix**: `KEY_RENAME_FIELDS` in `scripts/codemod.mjs` reduced from `['bin', 'exports']` → `['exports']`. Bin keys now pass through verbatim. `exports` keys are subpath specifiers (".", "./bm25") that don't intersect `UNSCOPED_MAP`, so leaving that pathway intact is a safe no-op. Regression-guarded by `tests/unit/codemod-bin-preservation.test.mjs` (4 tests: literal `ruflo`, literal `claude-flow`, mixed 4-key rebrand map, and exports-subpath preservation) — all green. `tests/unit/ruvector-scope-rename.test.mjs` (24 tests) still green, confirming the exports + dep-keys + source-rewrite pathways are unaffected.

**Impact.** Before this fix, the `ruflo` rebrand would not actually land on any published package — the codemod bug predates the rebrand and affected the `claude-flow` bin too (so the prior backwards-compat alias was also broken on the published `@sparkleideas/cli`). This was a latent publish-time correctness bug uncovered while adding `ruflo`. Fix is isolated (1 line change + 1 new test) and rolls forward — no version bump required beyond the existing `-patch.N` cadence.

## Follow-up 2026-04-21 (reversal): restore `cli` bin alias for npx UX

**Rationale.** Removing the bare `cli` bin entry in the earlier rebrand broke `npx @sparkleideas/cli@latest ...` — npx auto-derives the executable name from the unscoped portion of the package name (`cli`), so with no matching bin entry it exits with "could not determine executable to run". Users were forced onto the verbose `npx -p @sparkleideas/cli@latest ruflo ...` form, which is worse UX than what the rebrand set out to fix. The earlier "collision risk" concern is moot in practice because `cli` is only ever invoked transiently under `npx` temp roots, not installed globally into `PATH`.

**What changed.** `forks/ruflo/v3/@claude-flow/cli/package.json` bin map now includes `"cli": "./bin/cli.js"` alongside `ruflo`, `ruflo-mcp`, `claude-flow`, and `claude-flow-mcp`. `ruflo` remains the primary (intended global-install name); `cli` is an npx-bootstrap alias only. The codemod `KEY_RENAME_FIELDS = ['exports']` fix from the previous follow-up is untouched — bin keys still pass through verbatim, so `cli` survives the scope rename step. Paired test `tests/unit/rebrand-ruflo-bin.test.mjs` flipped: the old "does NOT expose bare `cli`" assertion became "exposes `cli` as a backwards-compat alias for npx auto-invocation", with the reasoning documented inline.
