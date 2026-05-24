# 07 — Plugin contents (per-plugin soundness) audit

**Parent gap**: [G-16-002](../2026-05-19-soundness-audit/16-gap-analysis.md#g-16-002-high-plugin-contents--what-each-plugin-actually-does) [HIGH]
**Slice**: 07 of 12 (second-pass)
**Companion**: May-19 slice 08 (`mcp-tool-implementations.md`) covered the
central registry; this slice covers the 34 distributable plugins that the
marketplace ships on top of it.

## Summary

- Plugins inventoried: **34** declared in
  `forks/ruflo/.claude-plugin/marketplace.json` (180 LOC). All 34 plugin
  directories exist on disk under `forks/ruflo/plugins/`.
- Deep-dive sample: 7 plugins (`ruflo-core`, `ruflo-agentdb`, `ruflo-swarm`,
  `ruflo-hive-mind`, `ruflo-graph-intelligence`, `ruflo-neural-trader`,
  `ruflo-iot-cognitum`) plus an inventory roll-up of the other 27.
- Shape: 32 of 34 plugins are pure markdown bundles (commands + skills +
  agents, no `src/` directory, no `package.json`). 2 plugins ship real
  TypeScript code (`ruflo-graph-intelligence`, `ruflo-neural-trader`).
- Findings: 10 total / 3 critical / 5 warning / 2 note
- Soundness verdict: **PARTIAL PASS** — the markdown-bundle plugins resolve
  their `mcp__ruflo__*` tool refs against the central registry correctly
  in the vast majority of cases (185/189 unique refs registered, 2 phantom
  families). But one plugin (`ruflo-graph-intelligence`) ships 6 real MCP
  tools that are **dead-on-arrival** — never registered in the central
  `ruflo` server and not exposed via plugin manifest either (F-07-001).
  And one (`ruflo-agentdb`) hard-codes 3 `embeddings_rabitq_*` tool names
  in skill `allowed-tools` plus its own smoke gate, but those names do not
  appear anywhere in the cli's registered tools (F-07-002).
- Completeness verdict: **PARTIAL PASS** — every plugin in the marketplace
  has a `.claude-plugin/plugin.json` and is structurally well-formed. But
  the **umbrella `forks/ruflo/.claude-plugin/plugin.json` still declares
  `name: "claude-flow"`, `version: 2.5.0`, author `rUv`** — the ADR-0143
  rebrand never landed at this level (F-07-003). Two of the 34 plugins
  (`ruflo-browser`, `ruflo-hive-mind`) lack the `mcp` keyword in their
  declared keywords arrays even though their skills exclusively call
  `mcp__ruflo__*` tools — purely cosmetic but worth noting.
- Bottom line: the plugin marketplace is structurally a single
  service-method install — all 34 plugins depend on `ruflo init` having
  pre-registered the `ruflo` MCP server (per ADR-0117 §Revision
  2026-05-03). 32 plugins compose around that single shared registry
  correctly. The 2 plugins with real code (`graph-intelligence`,
  `neural-trader`) sit awkwardly: `neural-trader` shells out to
  `npx neural-trader` (its skill bodies all do this) and its `src/` is a
  tiny `pipeline-messages.ts` stub, while `graph-intelligence`'s 6 MCP
  tools are unreachable.

## Method

- Located all plugin manifests:
  `find /Users/henrik/source/forks/ruflo/plugins -maxdepth 3 -name plugin.json`
  → 34 hits, plus the umbrella at `.claude-plugin/plugin.json`.
- Parsed `marketplace.json` to confirm declaration coverage. All 34 plugins
  listed; all 34 source paths resolve to existing directories.
- For each plugin: counted commands / skills / agents / hooks / src / package.json
  files. See "Per-plugin shape" table below.
- Extracted every `mcp__ruflo__*` reference from skill `allowed-tools`
  frontmatter and command markdown bodies (189 unique). Cross-checked
  against the 310 tool names registered in
  `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/*.ts` (the canonical
  per-May-19 finding F-08 registry).
  - 185 of 189 refs match registered tools.
  - 4 mismatches: `embeddings_rabitq_build|_search|_status`
    (phantom — referenced in `ruflo-agentdb`'s skill + smoke test, not
    registered anywhere) and `hive-mind_` / `tool` (parsing artifacts
    from doc tables, not real refs).
- For each of the 7 sample plugins, read the skills / commands / hooks
  end-to-end, traced the script files they reference, and checked the
  smoke test script if present.
- Confirmed plugin npm-publish status via `npm view`. Plugins are NOT
  npm packages — they ship via git-relative `source: ./plugins/...` paths
  in `marketplace.json`. `@sparkleideas/ruflo-{core,graph-intelligence,
  neural-trader}` all return E404 on the Verdaccio registry. This is by
  design (per the May-19 audit's understanding of `claude plugin install`)
  but is worth confirming: plugins are git-marketplace artifacts, not npm.

## Per-plugin shape

```
ruflo-adr                      cmd=1  sk=4  ag=1  hooks=  src=  pkg=
ruflo-agentdb                  cmd=2  sk=2  ag=1  hooks=  src=  pkg=
ruflo-aidefence                cmd=1  sk=2  ag=1  hooks=  src=  pkg=
ruflo-autopilot                cmd=2  sk=2  ag=1  hooks=  src=  pkg=
ruflo-browser                  cmd=1  sk=9  ag=1  hooks=  src=  pkg=
ruflo-core                     cmd=2  sk=4  ag=4  hooks=Y src=  pkg=
ruflo-cost-tracker             cmd=1  sk=13 ag=1  hooks=  src=  pkg=
ruflo-daa                      cmd=1  sk=2  ag=1  hooks=  src=  pkg=
ruflo-ddd                      cmd=1  sk=3  ag=1  hooks=  src=  pkg=
ruflo-docs                     cmd=1  sk=2  ag=1  hooks=  src=  pkg=
ruflo-federation               cmd=1  sk=3  ag=1  hooks=  src=  pkg=
ruflo-goals                    cmd=1  sk=5  ag=4  hooks=  src=  pkg=
ruflo-graph-intelligence       cmd=0  sk=0  ag=0  hooks=  src=Y pkg=Y
ruflo-hive-mind                cmd=11 sk=2  ag=16 hooks=  src=  pkg=
ruflo-intelligence             cmd=2  sk=3  ag=1  hooks=  src=  pkg=
ruflo-iot-cognitum             cmd=1  sk=5  ag=4  hooks=  src=  pkg=
ruflo-jujutsu                  cmd=1  sk=2  ag=1  hooks=  src=  pkg=
ruflo-knowledge-graph          cmd=1  sk=2  ag=1  hooks=  src=  pkg=
ruflo-loop-workers             cmd=2  sk=2  ag=1  hooks=  src=  pkg=
ruflo-market-data              cmd=1  sk=2  ag=1  hooks=  src=  pkg=
ruflo-migrations               cmd=1  sk=2  ag=1  hooks=  src=  pkg=
ruflo-neural-trader            cmd=1  sk=6  ag=4  hooks=  src=Y pkg=
ruflo-observability            cmd=1  sk=2  ag=1  hooks=  src=  pkg=
ruflo-plugin-creator           cmd=1  sk=2  ag=1  hooks=  src=  pkg=
ruflo-rag-memory               cmd=2  sk=2  ag=1  hooks=  src=  pkg=
ruflo-ruvector                 cmd=1  sk=4  ag=1  hooks=  src=  pkg=
ruflo-ruvllm                   cmd=1  sk=2  ag=1  hooks=  src=  pkg=
ruflo-rvf                      cmd=1  sk=2  ag=1  hooks=  src=  pkg=
ruflo-security-audit           cmd=1  sk=2  ag=1  hooks=  src=  pkg=
ruflo-sparc                    cmd=1  sk=3  ag=1  hooks=  src=  pkg=
ruflo-swarm                    cmd=2  sk=2  ag=2  hooks=  src=  pkg=
ruflo-testgen                  cmd=1  sk=2  ag=1  hooks=  src=  pkg=
ruflo-wasm                     cmd=1  sk=2  ag=1  hooks=  src=  pkg=
ruflo-workflows                cmd=1  sk=2  ag=1  hooks=  src=  pkg=
```

Totals: 56 commands, 96 skills, 64 agents declared across the 34 plugins.
Only `ruflo-core` ships its own hook bundle (`hooks/hooks.json`). Only
`ruflo-graph-intelligence` has both `src/` (real TS) and `package.json`.
`ruflo-neural-trader` has `src/` (a single 1-file stub) but no
`package.json`.

## Findings

### F-07-001 [CRITICAL] `ruflo-graph-intelligence` ships 6 MCP tools that are dead-on-arrival

`forks/ruflo/plugins/ruflo-graph-intelligence/src/mcp-tools/index.ts:41-316`
declares a `graphIntelligenceTools: MCPTool[]` array exporting six handlers:

```
sublinear/page-rank-entry
sublinear/solve
sublinear/solve-on-change
sublinear/feasibility
sublinear/jl-embed
sublinear/analyze
```

The handlers are real (parse Zod schemas, dispatch through a registered
adapter to `sublinear-time-solver@1.7.0`, return `{success, result|error}`
shapes). Tests live in
`plugins/ruflo-graph-intelligence/tests/mcp-tools.test.ts`.

But nothing imports them into the central `ruflo` MCP server. Verified:

- `grep -rn "graphIntelligenceTools\|graph-intelligence" forks/ruflo/v3/@claude-flow/cli/src/`
  → zero hits.
- `grep -rn "sublinear/" forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/`
  → zero hits.
- The plugin's `.claude-plugin/plugin.json` declares no `mcpServers` and
  no commands / skills / agents (verified — `cmd=0 sk=0 ag=0`).
- The plugin's npm package `@sparkleideas/ruflo-graph-intelligence` is
  not published to Verdaccio (E404).

So the 6 tools are reachable only via direct `import` from a consumer that
already knows about the package. ADR-0117 §Revision 2026-05-03 makes
plugin-level MCP servers explicitly out-of-scope (the marketplace uses a
single shared init-registered server), which means there is no defined
mechanism for these tools to surface. ADR-126 (neural-trader substrate
integration) names this plugin's `sublinear/solve` as the Wedge-8 target
for replacing the neural-trader portfolio solver, then immediately notes
"today nothing in the plugin references CG or sublinear".

Severity: CRITICAL. The plugin ships in the marketplace listing with an
889-byte manifest describing rich functionality, peer-deps on
`@claude-flow/cli>=3.5.0`, and 12 test files passing — but no user can
call any of the 6 tools. This is the most clean-cut dead-on-arrival
finding in the marketplace.

### F-07-002 [CRITICAL] `ruflo-agentdb` declares 3 phantom `embeddings_rabitq_*` tools

`forks/ruflo/plugins/ruflo-agentdb/skills/vector-search/SKILL.md:5`
declares in `allowed-tools` frontmatter:

```
mcp__ruflo__embeddings_rabitq_build
mcp__ruflo__embeddings_rabitq_search
mcp__ruflo__embeddings_rabitq_status
```

The skill body describes "RaBitQ 1-bit quantization for 32× memory
reduction" as a first-class capability. The plugin's own smoke test
(`plugins/ruflo-agentdb/scripts/smoke.sh:40-42`) hard-asserts these names
appear in the skill markdown, and again at line 82 in a loop over 10
expected tool names.

None of the three are in the registered tool set
(`v3/@claude-flow/cli/src/mcp-tools/*.ts` ~ 310 names). Verified:
`grep -rn "embeddings_rabitq" forks/ruflo/v3/` → zero hits outside an
ADR-099 doc table that mentions them as a "vector search (HNSW, RaBitQ)"
example.

Effect: when an agent grants the skill its `allowed-tools` and tries to
call `mcp__ruflo__embeddings_rabitq_build`, the central `mcp-client.ts`
will throw `MCPClientError: MCP tool not found`. The skill is unrunnable
on the documented quantized path. The smoke test passes because it greps
the markdown for the string, not because the tool exists.

Severity: CRITICAL. The skill documents fictional behaviour as a marketed
feature. The smoke gate enforces the lie.

### F-07-003 [CRITICAL] Umbrella `plugin.json` is unbranded — claims `name: "claude-flow"`, author `rUv`

`forks/ruflo/.claude-plugin/plugin.json`:

```json
{
  "name": "claude-flow",
  "version": "2.5.0",
  "description": "Enterprise AI agent orchestration plugin with 150+ commands, 74+ specialized agents, SPARC methodology, ...",
  "author": { "name": "rUv", "email": "ruv@ruv.net" }
}
```

This file lives at the **umbrella** position — the one Claude Code reads
when the marketplace root is itself treated as a plugin. The 34 sub-plugin
manifests are all correctly branded as `ruflo-*` with `author: ruvnet` or
`Henrik Pettersen`, but the umbrella still wears the upstream brand.

Per [[reference-user-facing-brand]], the post-ADR-0143 canonical user-
facing brand is `@sparkleideas/ruflo`. Per ADR-0117 §Revision 2026-05-03
this file should *not* have an `mcpServers` block (which it correctly
doesn't) — but the rebrand of `name` / `description` / `author` was not
done. The 32 wrapper plugins explicitly do not register their own MCP
servers because they expect init to do it under the `ruflo` key; meanwhile
the install.sh path (`.claude-plugin/scripts/install.sh:137`) writes a
`claude-flow` keyed server invoking `npx claude-flow@alpha` — a different
binary, a different server key. Two bootstrap paths producing two
different MCP configurations.

Severity: CRITICAL. Anyone reading the umbrella manifest sees the upstream
plugin advertised under the wrong identity. The install.sh bootstrap path
configures a server that won't expose the `mcp__ruflo__*` tools the 32
wrapper plugins depend on. Only the `ruflo init` path produces a
configuration that matches the wrapper plugins' expectations.

### F-07-004 [WARNING] `ruflo-core` hooks shell out to `npx claude-flow@alpha`

`forks/ruflo/plugins/ruflo-core/hooks/hooks.json:9,18,48` invokes
`npx claude-flow@alpha hooks post-command`, `post-edit`, `session-end`.
Per ADR-0117 §Implementation, hook shellouts in `.claude-plugin/**` and
`plugins/**` were supposed to flip to `@sparkleideas/cli@latest` via
codemod Pass 5. The umbrella `.claude-plugin/hooks/hooks.json` was
correctly flipped (line 9-50 all use `@sparkleideas/cli@latest`), but
this per-plugin `ruflo-core` hooks file was missed by the codemod.

Effect: when `ruflo-core` is installed and its `PostToolUse` matcher
fires, the hook runs `npx claude-flow@alpha hooks post-command`. If the
upstream `claude-flow@alpha` package is installed in the user's machine,
that runs upstream code, not the fork. If it's not installed, npm fetches
it on demand from the public npm registry (per
[[feedback-always-npx-for-ruflo]] this is the wrong package).

Severity: WARNING. The fix is a one-line per-hook substitution.

### F-07-005 [WARNING] `ruflo-graph-intelligence` declares 0 commands / 0 skills / 0 agents

The plugin manifest lists `categories: ["intelligence", "graph", "memory",
"substrate"]` and an 889-byte description naming "single-entry personalized
PageRank, streaming delta updates, witness-signed reasoning artifacts,
federation-distributable PR vectors". But the plugin ships zero markdown
surface — no command file, no skill, no agent. A user who installs it via
`claude plugin install ruflo-graph-intelligence@ruflo` gets nothing.

This pairs with F-07-001: the only useful interface to this plugin is
direct npm import (`import { graphIntelligenceTools } from
'@sparkleideas/ruflo-graph-intelligence/mcp-tools'`), but the package
isn't published to npm. So installing via the marketplace gives an empty
shell.

Severity: WARNING. Hidden by the previous severity, but a separate
finding because it's a different surface (markdown bundle vs. MCP server
registration).

### F-07-006 [WARNING] `ruflo-iot-cognitum`'s 5 skills + 1 command compose only `memory_*` — none of the marketed IoT capabilities

The plugin describes "IoT device lifecycle, telemetry anomaly detection,
fleet management, witness chain verification". Its `allowed-tools` across
all 5 skills + 1 command reference only:

```
mcp__ruflo__memory_search
mcp__ruflo__memory_store
```

No `iot_*`, `cognitum_*`, `telemetry_*`, `device_*`, or `fleet_*` tool
family exists in the registry. The plugin is a thin documentation layer
that describes IoT-shaped workflows using generic memory primitives.
That's a defensible design choice (the LLM is the implementation engine),
but it makes the "Cognitum Seed hardware" + "witness chain verification"
claims aspirational rather than mechanical.

A similar pattern holds for `ruflo-federation` (3 skills, no
`federation_*` tools), `ruflo-knowledge-graph` (2 skills, uses
`agentdb_causal-edge` + generic AgentDB tools, not `kg_*`), and
`ruflo-market-data` (2 skills).

Severity: WARNING. Functional, but the marketplace descriptions over-
promise vs. the actual MCP surface. Pattern: domain-specialized plugin
descriptions composed of general-purpose memory + agentdb primitives.

### F-07-007 [WARNING] `ruflo-neural-trader` `src/` is one 1-file stub; "112+ MCP tools" claim is via `npx neural-trader`

The plugin's manifest description claims "112+ MCP tools, swarm
coordination, and portfolio optimization". The plugin ships:

- 6 skills under `skills/trader-*/`
- 4 agents under `agents/`
- 1 command (`trader.md`)
- `src/pipeline-messages.ts` (the **only** source file under `src/`)
- 3 benchmark scripts under `benchmarks/`

The 112 MCP tools live in a separate package (`npx neural-trader`) that
the skill bodies shell out to. Every skill follows the pattern:
`npx neural-trader --backtest --strategy ...` then capture output and
`mcp__ruflo__memory_store` the result. No MCP server bound by this
plugin exposes the 112 tools — the trader-side tools are invoked via CLI,
not MCP.

That's a valid design (delegate to a sibling package), but it means
declaring "112+ MCP tools" in the marketplace description is misleading.
The user doesn't get 112 MCP tools — they get 6 skills that each invoke
one external CLI command. The benchmarks (`benchmarks/results/`) show
real performance numbers (CG-native baseline, signal-generation, etc.),
so the underlying `neural-trader` package is real, but the plugin itself
is a 12-file skill shim.

Severity: WARNING. Marketing-vs-implementation mismatch in the
description; the actual install works as a CLI orchestration shim.

### F-07-008 [WARNING] `ruflo-cost-tracker` is the only plugin with deep skill-to-script binding

`ruflo-cost-tracker` has 13 skills (the most of any plugin) and 9 backing
scripts under `scripts/` (`bench.mjs`, `track.mjs`, `compact.mjs`,
`federation.mjs`, etc.). Skills invoke them as
`node plugins/ruflo-cost-tracker/scripts/track.mjs`. This works only when
the project root is the marketplace fork (`forks/ruflo/`); a real user
install would resolve to `~/.claude/plugins/ruflo-cost-tracker/scripts/...`
and the hardcoded `plugins/...` path would not match.

The `cost-track` skill body (line 19) shows this pattern. The skill is
correct for in-repo use but probably broken when installed via
`claude plugin install` to a different directory.

Severity: WARNING. Need to verify against a real installed-tree to
confirm whether `claude plugin install` resolves relative paths inside
skill bodies. If yes, this is a portability bug.

### F-07-009 [NOTE] `ruflo-browser` declares 9 skills (highest density after cost-tracker)

This is unusually broad: `browser-auth-flow`, `browser-extract`,
`browser-form-fill`, `browser-login`, `browser-record`, `browser-replay`,
`browser-scrape`, `browser-screenshot-diff`, `browser-test`. All
presumably wrap the `mcp__ruflo__browser_*` tool family which is
registered (~37 tools, verified). Not audited deeply but worth a follow-
up: high skill count is a fake-breadth risk indicator.

Severity: NOTE.

### F-07-010 [NOTE] No plugin install/uninstall idempotency hooks

No plugin (other than `ruflo-core`) ships a `PreToolUse` or `SessionStart`
hook to verify the plugin's runtime requirements are met (the central
MCP server is running, the expected tools are registered, etc.). If a
user installs `ruflo-agentdb` against an init that didn't register the
`ruflo` MCP server (e.g., older init), the skills will silently fail at
first invocation with "tool not found" errors.

Severity: NOTE. Defense-in-depth gap, not an active bug.

## Cross-cutting

### CC-1. The marketplace is a service-method install — by design

Per ADR-0117 §Revision 2026-05-03, all 34 plugins follow a uniform
"service method" pattern: no `mcpServers` block, no `npx` server-start
command in `plugin.json`, markdown-only skill bodies. The single shared
MCP server is registered at init time, not at plugin install time. This
design is reasonable, but:

- It makes plugins fully dependent on init having been run.
- It means `claude plugin install ruflo-foo@ruflo` does not actually
  install any executable code — only markdown.
- The two plugins that *do* ship code (`graph-intelligence`,
  `neural-trader`) are outliers that don't have a way to surface
  their code via the marketplace install path.

The ADR-0117 revision documents this explicitly. The marketplace
behaviour aligns with the revised decision, but the umbrella manifest
(F-07-003) and the legacy `install.sh` script were not updated.

### CC-2. Phantom tools are a real risk under the service-method model

Because plugin authors write skill `allowed-tools` frontmatter as a list
of `mcp__ruflo__*` names that they *expect* the central registry to
provide, there is no compile-time gate ensuring the names exist. The
`embeddings_rabitq_*` example (F-07-002) shows the failure mode: the
plugin author wrote the names, the smoke test was written to grep the
names back out of the markdown, and nobody compared either list against
the registry's actual output.

A simple cross-check (`grep` plugin `allowed-tools` ∪ `mcp__ruflo__`
mentions, diff against `cli/src/mcp-tools/*.ts` `name:` entries) would
catch this. The May-19 audit's `08-mcp-tool-implementations.md` did the
inverse (registry → handlers) but did not validate references from
plugins.

### CC-3. Dead-on-arrival risk under the service-method model is plugin-typed

The 32 markdown-bundle plugins can't be dead-on-arrival in the strong
sense — they ship working skill markdown that an LLM can read and act on,
even if some referenced tools don't exist (the LLM just gets an error).
The 2 code-shipping plugins **can** be DOA — F-07-001 is the example.
Any future plugin that ships its own MCP server (in violation of ADR-0117
revision) or its own typed handlers needs an additional wiring step to
become reachable; without it, the code is unreachable.

### CC-4. The wrapper-plugin description style routinely over-promises

Pattern observed across iot-cognitum, federation, knowledge-graph,
market-data: rich marketplace descriptions ("witness chain verification",
"PII-gated zero-trust", "PageRank distribution") implemented as
documentation that composes 2-3 generic memory/agentdb primitives. This
is defensible (the LLM can do a lot with primitives + good prompts) but
sets up reader expectations the implementation doesn't meet.

### CC-5. ADR-0213 prefix-duplication concern: not yet a problem

ADR-0213 (cited in slice brief) flags the risk of duplicate MCP tool
prefixes between aggregator and per-plugin servers. With the
service-method model in place, no per-plugin server exists today, so
there are no duplicates. If any plugin ever ships its own MCP server,
this concern becomes live.

## Out-of-scope (deferred to other slices)

- Per-plugin agent .md soundness (64 agents total) — covered by the
  May-19 skills slice and agent-types catalog. Not re-audited here.
- Deep audit of `ruflo-graph-intelligence/src/` correctness (the
  sublinear solver wiring, JL embedding, federation protocol) — code is
  unreachable per F-07-001 so deferred until wiring exists.
- `npm view @sparkleideas/cli` / `@sparkleideas/ruflo` provenance — covered
  by slice 11 (init MCP installation).
- Plugin install/uninstall harness behaviour (does `claude plugin install`
  resolve scripts/* relative paths inside skill bodies?) — needs runtime
  verification; F-07-008 flags but doesn't resolve.
- Codemod Pass 5 coverage gap that left `ruflo-core/hooks/hooks.json` on
  `claude-flow@alpha` (F-07-004) — pipeline soundness gap, deferred to
  slice covering `scripts/codemod.mjs`.
