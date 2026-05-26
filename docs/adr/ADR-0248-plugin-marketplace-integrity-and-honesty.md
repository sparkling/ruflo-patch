---
status: accepted
completed: false
date: 2026-05-24
tags: [audit-followup, plugins, marketplace, honesty, doa, phantom-tools, integrity-lint, ct-o]
supersedes: []
depends-on: [0143, 0201, 0210, 0233, 0235]
implements: []
---

# Plugin marketplace integrity and honesty (CT-O)

## Context

[[ADR-0233]] §CT-O ("Plugin marketplace honesty / wiring") consolidates the
nine slice-07 audit findings that remain after [[ADR-0235]] (CT-B) absorbed
F-07-003 (umbrella `plugin.json` brand miss). The remaining findings split
into two recurring classes:

* **Integrity gaps** (CC-2 and CC-3 of the slice-07 audit) — plugin manifests
  declare or reference behaviour that has no implementation in the central
  MCP registry. Two CRITICAL instances today: `ruflo-graph-intelligence`
  ships 6 MCP tools that no code path imports (F-07-001), and `ruflo-agentdb`
  hard-codes 3 phantom `embeddings_rabitq_*` tool names in skill
  `allowed-tools` plus its own smoke gate (F-07-002). Three lower-severity
  siblings (F-07-005, F-07-010) extend the same risk to plugins that ship
  zero markdown surface or rely on a working init having pre-registered the
  `ruflo` MCP server.
* **Description honesty** (CC-4 of the slice-07 audit) — marketplace
  descriptions advertise behaviour that exceeds the underlying MCP-tool /
  skill surface. Three WARNING instances: `ruflo-iot-cognitum`'s 5 skills
  compose only `memory_*` primitives despite claiming IoT lifecycle (F-07-006),
  `ruflo-neural-trader`'s "112+ MCP tools" claim is via `npx neural-trader`
  not via MCP (F-07-007), and `ruflo-cost-tracker`'s deep skill-to-script
  binding hardcodes paths that resolve only inside the fork (F-07-008).
  F-07-009 (`ruflo-browser` 9 skills as fake-breadth risk indicator) is a
  NOTE for follow-up audit.

F-07-004 (`ruflo-core/hooks/hooks.json` shells out to `npx claude-flow@alpha`)
sits across both classes: structurally it is a codemod Pass 5 coverage
question (the file IS in scope per `isPlugin5Scope` — `.json` under
`plugins/`), but Pass 5 only runs against the build temp dir, not the fork.
Marketplace plugins ship via `marketplace.json`'s git-relative `source:
./plugins/...` (verified — plugins are NOT npm-published, all
`@sparkleideas/ruflo-*` lookups return E404). So the fork file content is
what users install, and the codemod's existing scope predicate does not
help. The remedy is a hand-edit + a content-invariant lint that runs
directly against fork source — the same pattern [[ADR-0235]] uses for the
umbrella `plugin.json`.

[[ADR-0210]]'s stub-honesty mandate ("implement, restore, or delete — not
label") governs the DOA cases (F-07-001, F-07-005, F-07-007). Each phantom
or over-promising surface gets its per-item disposition; we do not propose
a uniform `_doa:true` label, mirroring the corrected ADR-0210 Decision.

[[ADR-0117]]'s §Revision 2026-05-03 service-method design — single MCP
server registered once at init time, all 34 plugins compose against
`mcp__ruflo__*` — is the structural assumption these findings sit on top of.
The marketplace lint we propose enforces that assumption (every
`mcp__ruflo__*` reference in any plugin must exist in the cli registry) as
a class-wide integrity check, beyond per-plugin disposition.

## Pre-flight verification (per [[ADR-0201]] checklist)

Applied per finding-cluster per [[feedback-remediation-adr-preflight]].

### Cluster A — DOA plugins (F-07-001, F-07-005, F-07-010 defense-in-depth)

1. **Signal reaches audience: NO for F-07-001/F-07-005.** Verified
   `grep -rn "graphIntelligenceTools\|sublinear/" forks/ruflo/v3/@claude-flow/cli/src/`
   returns zero hits. The plugin's `.claude-plugin/plugin.json` has zero
   `commands` / `skills` / `agents` (verified: `cmd=0 sk=0 ag=0` from the
   slice-07 inventory table). `npm view @sparkleideas/ruflo-graph-intelligence`
   on Verdaccio returns E404. A user who runs
   `claude plugin install ruflo-graph-intelligence@ruflo` gets an empty
   directory tree with `src/mcp-tools/index.ts` exporting 6 handlers that
   nothing in the central CLI imports. The signal is structurally
   unreachable; only direct package-import from a consumer that already
   knows the package would surface the tools. ADR-126 (neural-trader
   substrate integration) explicitly notes "today nothing in the plugin
   references CG or sublinear" — the dead state is documented but not
   remediated.

2. **Upstream's choice: ALIGNED-WITH-FORK.** `ruvnet/ruflo` ships the same
   `plugins/ruflo-graph-intelligence/` tree (the plugin was authored in
   upstream and inherited by the fork). Upstream also has not wired
   `graphIntelligenceTools` into its CLI registry, has not published the
   plugin to public npm (verified independently), and has not added the
   plugin's commands/skills surface. No upstream ADR addresses the DOA
   state. Either disposition (publish-to-npm-and-wire OR remove-from-
   marketplace) diverges from upstream's current "neither" stance. Per
   [[ADR-0210]] the divergence is acceptable because the alternative is
   shipping a manifest entry that advertises functionality no user can
   reach — which fails [[feedback-skip-accepted-as-squelch]] and the
   stub-honesty mandate.

3. **Premise true at runtime: VERIFIED.** Slice-07's plugin shape table
   confirms `ruflo-graph-intelligence` has `cmd=0 sk=0 ag=0 src=Y pkg=Y`
   (only ships TS source + package.json — no markdown surface that
   `claude plugin install` would copy into `.claude/`). The 6 MCP tools at
   `plugins/ruflo-graph-intelligence/src/mcp-tools/index.ts:41-316` are
   real Zod-schema handlers; tests in `plugins/ruflo-graph-intelligence/
   tests/mcp-tools.test.ts` pass. The DOA state is a wiring gap, not a
   correctness gap.

4. **Sibling-ADR overlap: CLEAN.** [[ADR-0235]] handles F-07-003 (umbrella
   `plugin.json` brand miss) at the umbrella layer — different artefact.
   [[ADR-0210]] governs the disposition shape (implement/restore/delete);
   this ADR applies the shape to the per-plugin cluster. [[ADR-0238]]
   (CT-E) covers wire-or-remove for unused CLI-side MCP surfaces in the
   central `cli/src/mcp-tools/` tree; the plugin tree is a different
   surface category (the plugin's tools are not registered anywhere to
   begin with). [[ADR-0117]] §Revision 2026-05-03 defines the
   service-method design but does NOT say "every plugin must contribute
   markdown" — the question of "what does an MCP-tool-only plugin do under
   service-method?" is novel here.

### Cluster B — Phantom tools (F-07-002)

1. **Signal reaches audience: YES, dishonestly.** Verified
   `grep -rn "embeddings_rabitq" forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/`
   returns zero hits — the tools `embeddings_rabitq_build`,
   `embeddings_rabitq_search`, `embeddings_rabitq_status` are not
   registered in any `mcp-tools/*.ts` registry. But
   `plugins/ruflo-agentdb/skills/vector-search/SKILL.md:5`'s
   `allowed-tools` frontmatter lists all three, and the plugin's smoke
   test (`plugins/ruflo-agentdb/scripts/smoke.sh:40-42,82,106-108`) asserts
   they appear in the skill markdown. When an agent grants the skill its
   `allowed-tools` and tries to call any of the three, the central
   `mcp-client.ts` will throw `MCPClientError: MCP tool not found`. The
   skill is unrunnable on the documented quantized path; the smoke gate
   asserts the lie present in the markdown.

2. **Upstream's choice: ALIGNED-WITH-FORK.** Upstream `ruvnet/ruflo`
   ships the same `plugins/ruflo-agentdb/skills/vector-search/` with the
   same `embeddings_rabitq_*` references and the same missing registry
   entries. The plugin's own internal `docs/adrs/0001-agentdb-optimization.md`
   line 37 advertises the tools as if they existed (citing fake source
   locations at `embeddings-tools.ts:910, 926, 970`). Neither upstream nor
   fork has implemented `rabitq-index.ts` per that doc. The discrepancy is
   inherited, not a fork regression.

3. **Premise true at runtime: VERIFIED.** Direct grep against the cli
   registry tree confirms no `rabitq` symbol anywhere in
   `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/`. The 10-element
   expected-tools loop at smoke.sh:82 enumerates 7 real
   `embeddings_*` tools (init/generate/compare/search/neural/hyperbolic/
   status — all registered) + 3 phantom rabitq tools, so 70% of the
   asserted surface exists and 30% does not.

4. **Sibling-ADR overlap: CLEAN.** No other ADR addresses the phantom
   surface. [[ADR-0241]] (CT-H) covers schema-vs-handler asymmetry in
   registered tools; this ADR covers the inverse — skill `allowed-tools`
   refs that do not match any registered tool.

### Cluster C — Brand drift in plugin hooks (F-07-004)

1. **Signal reaches audience: YES.** Verified
   `forks/ruflo/plugins/ruflo-core/hooks/hooks.json` contains 5 lines
   invoking `npx claude-flow@alpha hooks {post-command,post-edit,
   session-end}`. When `ruflo-core` is installed and its `PostToolUse` /
   `Stop` matchers fire, the hook spawns `npx claude-flow@alpha hooks ...`
   — pulling the **upstream** `claude-flow` package from public npm (per
   [[feedback-always-npx-for-ruflo]] this is the wrong package and per
   [[reference-verdaccio]] Verdaccio's @sparkleideas/* rule does NOT
   shadow `claude-flow` so the public-npm package is the resolved
   target).

2. **Upstream's choice: ALIGNED-WITH-FORK (legitimately).** Upstream
   `ruvnet/ruflo/plugins/ruflo-core/hooks/hooks.json` carries the same
   `claude-flow@alpha` invocations — that IS the upstream brand. Our
   fork's [[ADR-0143]] rebrand explicitly diverges; the per-plugin
   `hooks.json` file was supposed to be flipped by codemod Pass 5.
   Pass 5's scope predicate `isPlugin5Scope` does match
   `plugins/ruflo-core/hooks/hooks.json` (`.json` extension, `plugins/`
   prefix), but the codemod runs against the build temp dir and the
   marketplace ships plugins via git-relative `source:
   ./plugins/...` directly from the fork (NOT from a published tarball).
   So Pass 5's rewrite never reaches the artefact a user actually
   installs.

3. **Premise true at runtime: VERIFIED.**
   `forks/ruflo/.claude-plugin/hooks/hooks.json` (umbrella) reads
   `@sparkleideas/cli@latest` — the umbrella was hand-edited or covered
   by a different path. Only the per-plugin `ruflo-core` file was missed.
   `forks/ruflo/plugins/ruflo-core/scripts/test-hooks.mjs` ALSO contains
   `claude-flow@alpha` but reads it for substitution at runtime — it is a
   test runner, not a production hook, so impact is limited to the
   plugin's own dev workflow.

4. **Sibling-ADR overlap: PARTIAL.** [[ADR-0235]] (CT-B) covers the
   umbrella `.claude-plugin/plugin.json` + `install.sh` rebrand miss with
   a content-invariant lint. The per-plugin `hooks.json` miss is the same
   defect class on a different file. The lint specified in this ADR
   extends [[ADR-0235]]'s pattern to per-plugin files rather than
   duplicating it. Implementer should coordinate the two lint test files
   so they share the forbidden-string list.

### Cluster D — Description honesty (F-07-006, F-07-007, F-07-008)

1. **Signal reaches audience: YES.** Marketplace manifest descriptions
   are read by the user at install-decision time. `ruflo-iot-cognitum`'s
   description ("IoT device lifecycle, telemetry anomaly detection, fleet
   management, witness chain verification for Cognitum Seed hardware")
   sets up expectations that the plugin's actual surface (5 skills + 1
   command, all using only `mcp__ruflo__memory_search` /
   `mcp__ruflo__memory_store`) does not meet. Same shape for
   `ruflo-federation`, `ruflo-knowledge-graph`, `ruflo-market-data`
   per slice-07's CC-4 cross-cutting note. `ruflo-neural-trader`'s
   "112+ MCP tools" claim is technically true — 112 tools exist via
   `npx neural-trader` — but the framing implies MCP-callable from this
   plugin, which they are not. `ruflo-cost-tracker`'s skills invoke
   `node plugins/ruflo-cost-tracker/scripts/track.mjs` (path verified at
   `cost-track` skill body line 19) — works in-fork, broken under
   `claude plugin install` where the resolved path is
   `~/.claude/plugins/ruflo-cost-tracker/scripts/...`.

2. **Upstream's choice: ALIGNED-WITH-FORK.** All three plugins inherit
   their descriptions from upstream. The framing-vs-implementation
   mismatch is the same in upstream. A description rewrite would diverge
   from upstream, but consistent with [[ADR-0210]]'s description-honesty
   principle ("the LLM selects on description; that surface must not
   advertise capability the tool lacks") applied to the human-marketing
   layer.

3. **Premise true at runtime: VERIFIED.**
   `plugins/ruflo-iot-cognitum/.claude-plugin/plugin.json` description
   directly grep'd. `plugins/ruflo-neural-trader/.claude-plugin/plugin.json`
   description directly grep'd ("112+ MCP tools, swarm coordination, and
   portfolio optimization"). Slice-07's inventory table confirms 6 skills,
   no MCP server registered, single 1-file `src/pipeline-messages.ts`
   stub. F-07-008's portability question is unresolved at decision time —
   needs runtime verification against a real `claude plugin install`
   target tree.

4. **Sibling-ADR overlap: CLEAN.** No other ADR addresses marketplace
   description honesty. [[ADR-0210]] establishes the principle;
   [[ADR-0238]] applies it to CLI-side MCP descriptions; this ADR applies
   it to marketplace manifest descriptions. F-07-008 is the only
   portability-bug component and is per-plugin specific, not class-wide.

All four pre-flight checks pass per cluster. Proceed to Decision.

## Considered options

### Option A — Marketplace integrity lint only

Add a new `tests/pipeline/plugin-marketplace-integrity.test.mjs` that walks
every `forks/ruflo/plugins/*/.claude-plugin/plugin.json` and every
`forks/ruflo/plugins/*/skills/**/SKILL.md` `allowed-tools` frontmatter,
collects all `mcp__ruflo__*` references, cross-checks against the registered
tool set in `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/*.ts`, fails loud
on any reference that does not resolve. Bundle a complementary lint that
checks per-plugin `hooks.json` files for `claude-flow@alpha` strings.

* Good: catches F-07-002 (phantom rabitq tools), F-07-004 (claude-flow@alpha
  in plugin hooks), and future drift in the same direction (anyone adds a
  skill referencing an unregistered tool, the gate trips).
* Good: aligned with [[ADR-0235]]'s content-invariant pattern; both lints
  live in `tests/pipeline/` and share an assertion shape.
* Bad: does not address the DOA plugins (F-07-001, F-07-005) — those have
  zero `mcp__ruflo__*` references because they ship zero skills, so the
  integrity lint finds nothing wrong with them.
* Bad: does not address description honesty (F-07-006, F-07-007, F-07-008)
  — description prose can be honest by any objective test but still
  over-promise; an integrity lint cannot evaluate semantic alignment.
* Bad: alone, would let F-07-001 / F-07-005 / F-07-007 ship indefinitely.

### Option B — Per-plugin description rewrite + codemod Pass 5 extension

Hand-edit per-plugin descriptions to align with actual surface (e.g.
`ruflo-iot-cognitum` description rewritten to "IoT workflow scaffolds
built on shared memory primitives — composes `memory_search` and
`memory_store` for telemetry/lifecycle/fleet thought-templates"). Add the
per-plugin `plugins/*/hooks/hooks.json` path to a codemod sub-pass that
runs against fork source (not just the build temp dir).

* Good: closes F-07-004 deterministically (codemod-time rewrite at fork
  source, so the marketplace ships the flipped artefact).
* Good: closes F-07-006 / F-07-007 by aligning marketplace manifest with
  reality.
* Good: per-plugin rewrites are surgical and per-[[feedback-update-integration-ledger]]
  trackable.
* Bad: a fork-source codemod is a new mechanism (the codemod has only ever
  run on the build temp). Adding it expands the codemod's responsibility
  surface meaningfully.
* Bad: does not address F-07-001 / F-07-005 (DOA plugins have nothing to
  rewrite — the manifest doesn't lie about surface, it just promises a
  surface that is structurally unreachable).
* Bad: does not catch future drift (a new skill adds a phantom tool ref →
  no test fails).

### Option C — Stub-honesty triage per plugin (per [[ADR-0210]])

For each affected plugin, apply [[ADR-0210]]'s implement/restore/delete
decision tree:
- **`ruflo-graph-intelligence` (F-07-001, F-07-005)**: publish to npm AND
  wire `graphIntelligenceTools` into the cli registry, OR remove from
  `marketplace.json` and delete the plugin tree.
- **`ruflo-agentdb` (F-07-002)**: implement `embeddings_rabitq_*` in the
  cli registry, OR delete the references from skill `allowed-tools` and
  the smoke gate AND rewrite the skill description to drop "RaBitQ 1-bit
  quantization" framing.
- **`ruflo-neural-trader` (F-07-007)**: rewrite the description to drop
  the "112+ MCP tools" framing OR publish the 112 tools as a real MCP
  server the plugin registers.

* Good: directly addresses each defect's root cause.
* Good: aligned with [[ADR-0210]]'s established disposition pattern.
* Good: avoids architectural escalation for problems with per-plugin local
  fixes.
* Bad: does not establish a gate against future drift in the same class.
* Bad: requires a `marketplace.json` edit (drop entry) for the
  hardest-case disposition (`ruflo-graph-intelligence` delete), which is
  a behaviour change visible to anyone who scripted the marketplace
  contents.

## Decision

**Chosen: combination of Options A + C, with a narrow codemod-style edit
for F-07-004.** The three CT-O classes (integrity, DOA, description) each
have their natural remedy, and combining them closes all 9 findings
without forcing one mechanism to do work it is wrong-shaped for.

### Per-finding disposition

| Finding | Sev | Plugin | Disposition | Action |
|---|---|---|---|---|
| F-07-001 | CRITICAL | `ruflo-graph-intelligence` | **Stub-honesty triage (Option C, delete preferred)** | (a) Preferred: remove from `forks/ruflo/.claude-plugin/marketplace.json` `plugins` array; delete `forks/ruflo/plugins/ruflo-graph-intelligence/` tree; document in [[INTEGRATION-LEDGER]] as "deleted — DOA on marketplace install, no publish path planned". (b) Fallback if implementer wants to keep the plugin: publish `@sparkleideas/ruflo-graph-intelligence` to Verdaccio AND import `graphIntelligenceTools` into `cli/src/mcp-tools/index.ts` (or similar registry barrel) AND add at least one markdown command/skill so the marketplace install copies something to `~/.claude/plugins/ruflo-graph-intelligence/`. The implementer picks (a) or (b) in the implementation commit; this ADR's [[ADR-0210]]-conformant default is (a). |
| F-07-002 | CRITICAL | `ruflo-agentdb` | **Stub-honesty triage (Option C, description fix preferred)** | (a) Preferred: hand-edit `forks/ruflo/plugins/ruflo-agentdb/skills/vector-search/SKILL.md` to remove `mcp__ruflo__embeddings_rabitq_build`, `mcp__ruflo__embeddings_rabitq_search`, `mcp__ruflo__embeddings_rabitq_status` from the `allowed-tools` frontmatter; remove the "RaBitQ 1-bit quantization for 32× memory reduction" claim from the skill body; update `forks/ruflo/plugins/ruflo-agentdb/scripts/smoke.sh:40-42,82,106-108` to drop the three names from the expected-tools loop and the markdown-grep gate; rewrite `plugins/ruflo-agentdb/docs/adrs/0001-agentdb-optimization.md:37,49,73` to drop the false location claims (`embeddings-tools.ts:910, 926, 970` — those line numbers do not exist). (b) Fallback if implementer wants to keep the surface: implement `embeddings_rabitq_*` in `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/embeddings-tools.ts` with real RaBitQ-1bit quantization handlers backed by a real `rabitq-index.ts` (does not exist today — would need new fork-side implementation). [[ADR-0210]]-conformant default is (a). |
| F-07-004 | WARNING | `ruflo-core` | **Hand-edit fork source + lint extension** | (1) Hand-edit `forks/ruflo/plugins/ruflo-core/hooks/hooks.json` lines 9, 18, 48 (5 occurrences total per `grep -c`): substitute `npx claude-flow@alpha hooks ...` → `npx -y @sparkleideas/cli@latest hooks ...` per [[feedback-always-npx-for-ruflo]] / [[reference-pipeline-publish-paths]]. (2) Hand-edit `forks/ruflo/plugins/ruflo-core/scripts/test-hooks.mjs:12` docblock and `:50` substitution to flip to the new brand (it is a test runner, but the example string is read by maintainers). (3) Extend Option A's integrity lint to also grep per-plugin `hooks/hooks.json` and `scripts/*.sh` (production hook surfaces, NOT `.mjs` test runners) for `claude-flow@alpha` — fail loud on any hit. The lint catches future drift directly at fork source, where the marketplace serves from. |
| F-07-005 | WARNING | `ruflo-graph-intelligence` | **Bundled with F-07-001** | Closed by F-07-001 disposition (a) — deletion removes the empty-shell symptom. If implementer picks (b), an additional command/skill must be authored so `cmd>0 sk>0 ag>0`. The lint should assert `commands/ ∪ skills/ ∪ agents/` is non-empty for every plugin remaining in `marketplace.json` after this ADR lands. |
| F-07-006 | WARNING | `ruflo-iot-cognitum` (+ `ruflo-federation`, `ruflo-knowledge-graph`, `ruflo-market-data`) | **Description rewrite (Option C, narrow)** | Hand-edit `forks/ruflo/plugins/ruflo-iot-cognitum/.claude-plugin/plugin.json` description to "IoT workflow scaffolds composing `memory_*` primitives — telemetry/lifecycle/fleet thought-templates, not hardware-bound enforcement". Same rewrite shape applied to `ruflo-federation`, `ruflo-knowledge-graph`, `ruflo-market-data` (per slice-07 CC-4 enumeration). Each description must accurately name (i) the actual MCP tool families the skills compose and (ii) "thought-template" or "workflow scaffold" framing when the implementation is a prose-only LLM scaffold. No new lint — these are subjective rewrites; reviewers gate at PR. |
| F-07-007 | WARNING | `ruflo-neural-trader` | **Description rewrite (Option C, narrow)** | Hand-edit `forks/ruflo/plugins/ruflo-neural-trader/.claude-plugin/plugin.json` description to drop "112+ MCP tools" framing in favour of "neural trading orchestration via `npx neural-trader` — 6 skills wrap the external CLI for backtesting, signal generation, and portfolio optimization; result-storage via `mcp__ruflo__memory_*`". Numeric tool counts are honest for the central registry; numeric tool counts for shelled-out CLIs are misleading at the marketplace layer. |
| F-07-008 | WARNING | `ruflo-cost-tracker` | **Defer-with-runtime-verification** | Out of immediate scope: F-07-008's portability question (does `claude plugin install` resolve `plugins/...` relative paths inside skill bodies?) needs runtime verification against a real installed-tree. Two possible outcomes: (i) if Claude Code rewrites paths at install time, the hardcoded `plugins/ruflo-cost-tracker/scripts/track.mjs` references work — disposition is "accepted, document the convention in the plugin's README". (ii) If Claude Code preserves the paths verbatim, the skills are broken under marketplace install — disposition is to rewrite skill bodies to use `${PLUGIN_DIR}` or `${CLAUDE_PLUGIN_ROOT}` per Claude Code's plugin-path convention (research at implementation time). Track as a follow-up; do not block this ADR. |
| F-07-009 | NOTE | `ruflo-browser` | **Accept (audit follow-up only)** | The 9-skill density is a risk indicator, not a defect. Slice-07's author flagged "not audited deeply; worth a follow-up". This ADR does not enforce; if a deeper audit surfaces fake-breadth, file a follow-on. |
| F-07-010 | NOTE | All plugins | **Defense-in-depth defer** | The "no plugin install/uninstall idempotency hooks" gap is real but low-priority. The disposition is: add to a future ADR's scope ("plugin lifecycle hardening") rather than this ADR. The integrity lint (Option A) provides build-time integrity; the runtime `SessionStart` probe defence-in-depth is orthogonal and unblocked. |

### Marketplace integrity lint (Option A)

Add `ruflo-patch/tests/pipeline/plugin-marketplace-integrity.test.mjs` with
four assertions:

1. **Tool-reference resolution.** Walk every
   `forks/ruflo/plugins/*/skills/**/SKILL.md` and every command markdown
   body, extract every `mcp__ruflo__<name>` reference (frontmatter
   `allowed-tools` array entries and inline markdown), build the set, and
   diff against the set of tool `name:` entries in every
   `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/*.ts` file. Any
   reference not in the registered set fails loud. (Closes F-07-002 at
   build time and catches future drift in the same direction.)
2. **Plugin non-empty surface.** Every plugin entry in
   `forks/ruflo/.claude-plugin/marketplace.json` must have at least one of:
   `commands/` non-empty, `skills/` non-empty, OR `agents/` non-empty.
   Fail loud on any plugin that lists in `marketplace.json` but ships zero
   markdown surface. (Closes F-07-005; supports F-07-001 disposition (a)
   by enforcing the deletion.)
3. **Plugin hook brand.** Every `forks/ruflo/plugins/*/hooks/hooks.json`
   must not contain `claude-flow@alpha` or `npx claude-flow` (without the
   `-y` flag and the `@sparkleideas/cli@latest` form). Same check for any
   `forks/ruflo/plugins/*/scripts/*.sh` file that is referenced from a
   skill body or a hook entry (production hook scripts only — `.mjs` test
   runners excluded by allow-listing). Fail loud. (Closes F-07-004 and
   extends [[ADR-0235]]'s lint pattern to per-plugin paths.)
4. **Centralised forbidden-string set.** Reuse the forbidden-string
   constants from [[ADR-0235]]'s `umbrella-plugin-brand.test.mjs` (or
   factor them into a shared `tests/pipeline/_brand-forbidden.mjs` helper)
   so the two lints cannot drift on what counts as a brand miss.

### Why this composition and not Option A alone, B alone, or C alone

Option A alone misses the DOA cluster (F-07-001/F-07-005/F-07-007 — those
plugins have zero references to lint, but they do have over-promising
descriptions or no surface at all). Option B alone misses the
integrity-gate value (no future-drift protection for phantom tools, no
description-vs-surface check). Option C alone misses the build-time gate
that locks in the per-plugin dispositions (anyone could add a new phantom
tool to `vector-search/SKILL.md` and the smoke gate would assert the lie
again). The combination — lint for the integrity class (F-07-002, F-07-004,
F-07-005 enforcement), per-plugin triage for the DOA / description class
(F-07-001, F-07-006, F-07-007), and a tiny hand-edit + lint extension for
F-07-004 — closes each finding at its natural layer.

### Confirmation

Acceptance criteria after this ADR lands:

1. **F-07-001 (graph-intelligence DOA)**: Either (a)
   `forks/ruflo/.claude-plugin/marketplace.json` no longer lists
   `ruflo-graph-intelligence` AND `forks/ruflo/plugins/ruflo-graph-intelligence/`
   is deleted, OR (b) `npm view @sparkleideas/ruflo-graph-intelligence`
   on Verdaccio returns a real version AND `grep -rn "graphIntelligenceTools"
   forks/ruflo/v3/@claude-flow/cli/src/` returns at least one import.
   The lint's surface-non-empty assertion passes either way.
2. **F-07-002 (phantom rabitq tools)**: `grep -rn "embeddings_rabitq"
   forks/ruflo/plugins/ruflo-agentdb/skills/vector-search/SKILL.md`
   returns zero hits AND `grep -rn "embeddings_rabitq"
   forks/ruflo/plugins/ruflo-agentdb/scripts/smoke.sh` returns zero hits.
   The lint's tool-reference-resolution assertion fails today and passes
   after the fix.
3. **F-07-004 (claude-flow@alpha in ruflo-core/hooks)**: `grep -c
   "claude-flow@alpha" forks/ruflo/plugins/ruflo-core/hooks/hooks.json`
   returns `0`. The lint's plugin-hook-brand assertion fails today and
   passes after the fix.
4. **F-07-005 (graph-intelligence empty shell)**: Closed by F-07-001
   disposition. If (a): the plugin is gone. If (b): the plugin has at
   least one markdown surface, asserted by the lint's
   surface-non-empty rule.
5. **F-07-006 (iot-cognitum + siblings over-promising)**:
   `forks/ruflo/plugins/ruflo-iot-cognitum/.claude-plugin/plugin.json`
   description no longer contains the phrase "witness chain verification"
   OR the phrase is accompanied by a "workflow scaffold" / "thought-template"
   qualifier that makes the implementation shape explicit. Same check
   applied to `ruflo-federation`, `ruflo-knowledge-graph`,
   `ruflo-market-data`. No automated test — gated at PR review.
6. **F-07-007 (neural-trader 112+ MCP tools claim)**:
   `forks/ruflo/plugins/ruflo-neural-trader/.claude-plugin/plugin.json`
   description no longer contains the unqualified "112+ MCP tools"
   phrase; the rewritten description names the `npx neural-trader` CLI
   delegation explicitly. Gated at PR review.
7. **F-07-008 (cost-tracker portability)**: Tracked as follow-up; no
   acceptance gate in this ADR.
8. **F-07-009 (browser fake-breadth NOTE)**: No acceptance gate.
9. **F-07-010 (no idempotency hooks NOTE)**: No acceptance gate in this
   ADR; deferred to future plugin-lifecycle ADR.

## Consequences

* **Good**, because the two CRITICAL DOA / phantom findings (F-07-001,
  F-07-002) get [[ADR-0210]]-conformant dispositions — implement-or-delete,
  not label — and the marketplace stops advertising structurally
  unreachable functionality.
* **Good**, because the marketplace integrity lint converts the audit's
  one-time slice-07 manual cross-check into a build-time gate that future
  upstream merges cannot regress past without tripping. Same defence-shape
  as [[ADR-0235]]'s brand lint, applied to the plugin layer.
* **Good**, because the per-plugin description rewrites (F-07-006,
  F-07-007) apply [[ADR-0210]]'s description-honesty principle to the
  human-marketing layer (marketplace manifest), not just the LLM-facing
  `description` field. The marketplace user makes install decisions on
  this prose; the operator-over-trust risk is the human analogue of the
  LLM-selection layer ADR-0210 already governs.
* **Good**, because F-07-004's fix lands at fork source where the
  marketplace ships from, so it actually reaches users (the codemod's
  build-temp rewrite never did, because plugins ship via git-relative
  paths in `marketplace.json`, not via npm tarballs).
* **Bad**, because the preferred F-07-001 disposition (delete the plugin
  from `marketplace.json` + delete the tree) is a behaviour change
  anyone who scripted "all plugins listed in marketplace.json" against
  the fork must accommodate. The fallback (b) preserves the entry but
  costs a real publish + wiring change. Either way, the status quo
  (manifest entry advertising structurally unreachable functionality) is
  worse than either disposition. [[feedback-skip-accepted-as-squelch]]
  rules out the "leave it as-is and accept" third option.
* **Bad**, because the per-plugin hand-edits (F-07-002 description,
  F-07-006 descriptions, F-07-007 description) diverge from upstream
  `ruvnet/ruflo` prose. The merge tax at next upstream sync is bounded
  (string fields in JSON manifests, easy to triage in `git mergetool`)
  but real. [[feedback-update-integration-ledger]] requires recording
  each rewrite in `docs/upstream/INTEGRATION-LEDGER.md` so the next
  upstream-sync agent does not re-introduce the upstream phrasing.
* **Bad**, because F-07-008 is deferred without a clear unblock path.
  The runtime verification (does `claude plugin install` rewrite paths?)
  is cheap to perform — a single sandbox `claude plugin install ruflo-cost-tracker@ruflo`
  + grep — but does not fit in this ADR's scope. Implementer should run
  the probe and either close (i) or schedule the rewrite (ii) before
  the next plugin-related audit.
* **Neutral**, because the marketplace integrity lint adds a fork-only
  test that runs on every `npm run test:pipeline`. Cost is bounded (file
  walks, no network), but the test file joins the existing
  `tests/pipeline/` corpus and must be maintained as plugins evolve.

## Per-plugin disposition table

| # | Plugin | Finding | Severity | Disposition | Mechanism |
|---|--------|---------|----------|-------------|-----------|
| 1 | `ruflo-graph-intelligence` | F-07-001 | CRITICAL | Delete OR publish-and-wire | Remove from `marketplace.json` + delete tree (preferred), OR publish to Verdaccio + import `graphIntelligenceTools` into cli registry + add markdown surface (fallback) |
| 2 | `ruflo-agentdb` | F-07-002 | CRITICAL | Remove phantom tools | Hand-edit `skills/vector-search/SKILL.md` + `scripts/smoke.sh` + `docs/adrs/0001-agentdb-optimization.md` to drop `embeddings_rabitq_*` references |
| 3 | `ruflo-core` | F-07-004 | WARNING | Brand-flip hooks | Hand-edit `hooks/hooks.json` (5 lines) + `scripts/test-hooks.mjs` (docblock + substitution) to use `@sparkleideas/cli@latest` |
| 4 | `ruflo-graph-intelligence` | F-07-005 | WARNING | (Bundled with F-07-001) | Closed by F-07-001 disposition |
| 5 | `ruflo-iot-cognitum` | F-07-006 | WARNING | Description rewrite | Hand-edit `plugin.json` description to name composed primitives + "workflow scaffold" framing |
| 5b | `ruflo-federation` | F-07-006 (sibling) | WARNING | Description rewrite | Same shape as `ruflo-iot-cognitum` |
| 5c | `ruflo-knowledge-graph` | F-07-006 (sibling) | WARNING | Description rewrite | Same shape as `ruflo-iot-cognitum` |
| 5d | `ruflo-market-data` | F-07-006 (sibling) | WARNING | Description rewrite | Same shape as `ruflo-iot-cognitum` |
| 6 | `ruflo-neural-trader` | F-07-007 | WARNING | Description rewrite | Hand-edit `plugin.json` description to name the `npx neural-trader` delegation explicitly, drop "112+ MCP tools" framing |
| 7 | `ruflo-cost-tracker` | F-07-008 | WARNING | Defer-with-runtime-verification | Tracked as follow-up; verify `claude plugin install` path resolution behaviour, then close (i) or rewrite (ii) |
| 8 | `ruflo-browser` | F-07-009 | NOTE | Accept | No action; audit follow-up if fake-breadth surfaces |
| 9 | All plugins | F-07-010 | NOTE | Defer to future plugin-lifecycle ADR | No action this ADR |

| Class-wide gate | n/a | Marketplace integrity lint | n/a | New test | `ruflo-patch/tests/pipeline/plugin-marketplace-integrity.test.mjs` — 4 assertions per Decision |

## More information

* **[[ADR-0233]]** §CT-O — parent theme; lists the 10 slice-07 findings (9
  in this ADR's scope; F-07-003 owned by [[ADR-0235]]).
* **[[ADR-0210]]** — stub-honesty mandate (implement / restore / delete, not
  label). Governs F-07-001 and F-07-002 dispositions. Option B′ item 6
  (description honesty as the load-bearing LLM-facing layer) generalises to
  the marketplace-manifest layer here (F-07-006, F-07-007).
* **[[ADR-0235]]** — sibling CT-B ADR; closed F-07-003 (umbrella
  `plugin.json` brand miss) with a content-invariant lint. This ADR
  extends the lint pattern to per-plugin paths (hooks.json + skill
  allowed-tools refs).
* **[[ADR-0143]]** — brand rebrand (Pass 7). F-07-004 is a Pass 5
  coverage-vs-reach gap, not a Pass 7 path-scope miss; the codemod's
  scope predicate does match `plugins/ruflo-core/hooks/hooks.json` but
  the codemod runs on build temp dir and the marketplace ships from fork
  source directly. The remedy is hand-edit + lint, not a Pass 5 scope
  extension.
* **[[ADR-0117]]** §Revision 2026-05-03 — service-method MCP server
  registration; the structural premise the 32 markdown-bundle plugins
  compose against. F-07-001's "publish-and-wire" fallback honours this
  design by requiring the plugin's MCP tools to register through the
  central `ruflo` server rather than the plugin's own `mcpServers` block.
* **[[ADR-0238]]** (CT-E) — wire-or-remove triage for unused CLI-side
  MCP surfaces in `cli/src/mcp-tools/`. Pattern precedent for per-surface
  disposition; this ADR mirrors the per-finding-table approach.
* **[[ADR-0201]]** §Remediation-ADR pre-flight checklist — the 4-check
  gate applied per cluster above.
* **Audit source**: `docs/audits/2026-05-24-second-pass-audit/07-plugin-contents.md`
  (full slice-07 findings; F-07-001 through F-07-010 with file:line
  citations).
* **Memory references**:
  * [[feedback-remediation-adr-preflight]] — the 4-check gate this ADR
    applies per cluster.
  * [[feedback-skip-accepted-as-squelch]] — rules out the
    "leave-it-and-accept" disposition for DOA plugins; either
    implement-and-wire or remove.
  * [[feedback-always-npx-for-ruflo]] — canonical npx command form for
    F-07-004's hooks.json rewrite (`npx -y @sparkleideas/ruflo@latest`
    OR `@sparkleideas/cli@latest` per the hook-surface convention).
  * [[reference-pipeline-publish-paths]] — `@sparkleideas/cli@latest` is
    the canonical cli reference for hook shellouts (umbrella's
    `.claude-plugin/hooks/hooks.json` already uses this form post-ADR-0117).
  * [[reference-verdaccio]] — Verdaccio rule for `@sparkleideas/*` does
    NOT shadow `claude-flow`, so the public-npm `claude-flow@alpha`
    package resolves and runs (the wrong code path) if F-07-004 ships
    unfixed.
  * [[feedback-update-integration-ledger]] — every description rewrite
    + the F-07-001 deletion get an `INTEGRATION-LEDGER.md` row at
    implementation time.
  * [[feedback-corpus-evidence-before-feature-work]] — the per-finding
    pre-flight evidence above is the corpus walk this rule mandates;
    every claim (zero npm publish, zero registry registration, exact
    grep counts) was verified against live source rather than copied
    from the audit narrative.
* **Key file references**:
  * F-07-001: `forks/ruflo/.claude-plugin/marketplace.json` (the listing
    to remove from); `forks/ruflo/plugins/ruflo-graph-intelligence/`
    (the tree to delete OR augment);
    `forks/ruflo/plugins/ruflo-graph-intelligence/src/mcp-tools/index.ts:41-316`
    (the 6 handlers that need wiring under fallback (b)).
  * F-07-002: `forks/ruflo/plugins/ruflo-agentdb/skills/vector-search/SKILL.md:5`
    (the phantom `allowed-tools` entries);
    `forks/ruflo/plugins/ruflo-agentdb/scripts/smoke.sh:40-42,82,106-108`
    (the lie-enforcing smoke gate);
    `forks/ruflo/plugins/ruflo-agentdb/docs/adrs/0001-agentdb-optimization.md:37,49,73`
    (the false location claims).
  * F-07-004: `forks/ruflo/plugins/ruflo-core/hooks/hooks.json:9,18,48`
    (5 occurrences total — verified by `grep -c`);
    `forks/ruflo/plugins/ruflo-core/scripts/test-hooks.mjs:12,50`
    (test runner — lower-priority hand-edit).
  * F-07-006: `forks/ruflo/plugins/ruflo-iot-cognitum/.claude-plugin/plugin.json`
    (description field); same files for `ruflo-federation`,
    `ruflo-knowledge-graph`, `ruflo-market-data`.
  * F-07-007: `forks/ruflo/plugins/ruflo-neural-trader/.claude-plugin/plugin.json`
    (description field).
  * F-07-008: `forks/ruflo/plugins/ruflo-cost-tracker/skills/*/SKILL.md`
    (skill bodies with hardcoded `plugins/...` paths) — runtime
    verification needed before disposition.
  * New lint: `ruflo-patch/tests/pipeline/plugin-marketplace-integrity.test.mjs`
    (4 assertions: tool-ref resolution, surface non-empty, hook brand,
    forbidden-string reuse).

## Swarm review (2026-05-24)

**Pattern**: P4 Review Hive. **Consensus**: Quorum-majority per-plugin
(≥4/6). **Queen**: strategic. **Topology**: mesh. **Panel**: 5 experts + 1
DA. **Transport**: queen-composed (one-round dialectic; workers
independent; queen synthesised from return values).

### Panel composition

- **E1** — Plugin-marketplace architect (`marketplace.json` git-source
  pattern; service-method model per [[ADR-0117]] §Revision 2026-05-03)
- **E2** — MCP tool-registration specialist (ADR-0117 namespace; how
  plugin `mcp__ruflo__*` refs resolve against the central cli registry)
- **E3** — Plugin-publish lifecycle specialist (Verdaccio vs unpublished;
  what "DOA on install" means for `claude plugin install` users)
- **E4** — Hand-edit vs codemod-scope specialist (Pass 5 reaches build
  temp, not marketplace source — the CT-O cross-bonus note in
  [[ADR-0233]])
- **E5** — Brand-rebrand archeologist ([[ADR-0143]] lineage; F-07-004
  brand drift in plugin hooks)
- **DA** — Devil's Advocate (challenges direction with two hooks: "delete
  both code-shipping plugins entirely"; "marketplace integrity lint is
  theatre")

### Upstream intent

**Three of the ADR's "ALIGNED-WITH-FORK" claims are wrong**; live `git
ls` + `grep` against `/Users/henrik/source/ruvnet/ruflo/plugins/`
re-derived during this review:

1. **F-07-001 / F-07-005 upstream status — FORK-ONLY, not aligned.** The
   ADR claims `ruvnet/ruflo` ships `plugins/ruflo-graph-intelligence/`.
   Verified: `ls ruvnet/ruflo/plugins/` returns 33 directories, none
   named `ruflo-graph-intelligence`. The plugin is a **fork-only
   creation**. Cluster A pre-flight check #2 ("ALIGNED-WITH-FORK") is
   structurally false. Disposition direction unchanged (delete-preferred
   still correct under [[ADR-0210]] stub-honesty), but the divergence
   rationale must be rewritten: "deleting a fork-only DOA plugin" is
   strictly less divergent than the ADR currently frames it.
2. **F-07-004 upstream status — UPSTREAM ALREADY SOLVED, fork
   regressed.** The ADR claims upstream `ruvnet/ruflo/plugins/
   ruflo-core/hooks/hooks.json` carries the same `claude-flow@alpha`
   invocations. Verified: `grep -c "claude-flow@alpha"` against
   upstream = **0**. Upstream uses a **`scripts/ruflo-hook.sh`
   resilient shim** with `${CLAUDE_PLUGIN_ROOT}` substitution; the
   file's `_note` field explicitly forbids reverting to bare
   `npx <pkg>@alpha hooks`. The fork's `hooks.json` is the
   **stale/regressed copy**; the upstream shim solution is
   structurally superior to ADR-0248's proposed hand-edit substitution
   (`claude-flow@alpha` → `@sparkleideas/cli@latest`). The fork should
   adopt upstream's shim instead.
3. **F-07-002 — CORRECTLY aligned.** Both fork and upstream carry the
   same `embeddings_rabitq_*` phantom refs in
   `plugins/ruflo-agentdb/skills/vector-search/SKILL.md` (only diff is
   the `mcp__claude-flow__` → `mcp__ruflo__` rebrand prefix). The ADR's
   Cluster B claim is verified.

**Brand-drift count — ADR text wrong.** The Decision table and
Confirmation criterion for F-07-004 state "5 occurrences total" /
"5 lines". `grep -c "claude-flow@alpha"
forks/ruflo/plugins/ruflo-core/hooks/hooks.json` = **3** (lines 9, 18,
48). The "5" figure is wrong by a factor of 1.67×. Implementer guidance
needs the correct count or the count claim must be dropped.

### ADR-180+ alignment

[[ADR-0210]]'s "implement, restore, or delete — not label" mandate is
the governing principle for F-07-001 and F-07-002; ADR-0248 applies it
faithfully. [[ADR-0117]] §Revision 2026-05-03 service-method design is
the structural premise — every plugin composes against the single
init-registered `ruflo` MCP server; F-07-001's preferred disposition
(delete) honours this by removing the only non-conforming plugin.
[[ADR-0235]]'s content-invariant lint pattern is the proximate template
for ADR-0248's marketplace integrity lint. [[ADR-0238]] (CT-E) covers
wire-or-remove for **central** `cli/src/mcp-tools/*.ts` surfaces; this
ADR's per-plugin scope is disjoint. **No sibling-ADR overlap.**

### Per-plugin critique outcomes

| # | Plugin | Finding | E1 | E2 | E3 | E4 | E5 | DA | Vote | Adopted? |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `ruflo-graph-intelligence` | F-07-001 | DELETE | DELETE | DELETE | DELETE | DELETE | DELETE | 6/6 | **ADOPTED** (delete, not publish-and-wire) |
| 2 | `ruflo-agentdb` | F-07-002 | REMOVE-PHANTOMS | REMOVE-PHANTOMS | REMOVE-PHANTOMS | REMOVE-PHANTOMS | REMOVE-PHANTOMS | REMOVE-PHANTOMS | 6/6 | **ADOPTED** (description-fix preferred per ADR) |
| 3 | `ruflo-core` | F-07-004 | SHIM | SHIM | SHIM | HAND-EDIT | SHIM | SHIM | 5/6 | **AMENDED** — adopt upstream's `scripts/ruflo-hook.sh` shim instead of substituting `claude-flow@alpha` → `@sparkleideas/cli@latest` |
| 4 | `ruflo-graph-intelligence` | F-07-005 | BUNDLED | BUNDLED | BUNDLED | BUNDLED | BUNDLED | BUNDLED | 6/6 | **ADOPTED** (closed by F-07-001 deletion) |
| 5 | `ruflo-iot-cognitum` | F-07-006 | REWRITE | REWRITE | REWRITE | REWRITE | REWRITE | REWRITE | 6/6 | **ADOPTED** |
| 5b | `ruflo-federation` | F-07-006 (sib) | REWRITE | REWRITE | REWRITE | REWRITE | REWRITE | REWRITE | 6/6 | **ADOPTED** |
| 5c | `ruflo-knowledge-graph` | F-07-006 (sib) | REWRITE | REWRITE | REWRITE | REWRITE | REWRITE | REWRITE | 6/6 | **ADOPTED** |
| 5d | `ruflo-market-data` | F-07-006 (sib) | REWRITE | REWRITE | REWRITE | REWRITE | REWRITE | REWRITE | 6/6 | **ADOPTED** |
| 6 | `ruflo-neural-trader` | F-07-007 | REWRITE | REWRITE | REWRITE | REWRITE | REWRITE | DELETE-PLUGIN | 5/6 | **ADOPTED** (description rewrite; DA dissent recorded) |
| 7 | `ruflo-cost-tracker` | F-07-008 | DEFER+VERIFY | DEFER+VERIFY | DEFER+VERIFY | DEFER+VERIFY | DEFER+VERIFY | INVERT-TO-NOW | 5/6 | **ADOPTED** (defer; DA dissent) |
| 8 | `ruflo-browser` | F-07-009 | ACCEPT | ACCEPT | ACCEPT | ACCEPT | ACCEPT | ACCEPT | 6/6 | **ADOPTED** |
| 9 | (all) | F-07-010 | DEFER | DEFER | DEFER | DEFER | DEFER | DEFER | 6/6 | **ADOPTED** |
| — | (class-wide) | Marketplace integrity lint (Option A, 4 assertions) | KEEP | KEEP | KEEP | KEEP | KEEP | KEEP-WITH-NOTE | 6/6 | **ADOPTED** (DA's "lint is theatre" rejected; lint is regression-guard not authorship-discipline) |

### Devil's Advocate final position

**DA #1 — "Delete both code-shipping plugins entirely":** Withdraws on
`ruflo-agentdb` (the phantom-tools removal preserves a real plugin with
real registered tools). Holds **principled dissent** on `ruflo-neural-trader`:
notes the plugin's 6 skills wrap an external CLI (`npx neural-trader`)
without any MCP surface beyond `memory_store`, making the plugin a
documentation-shim no thicker than `ruflo-iot-cognitum`. Records dissent
that delete-from-marketplace is the more honest disposition than
description-rewrite; panel rationale (skill bodies have real test
coverage in `benchmarks/`; CLI delegation is a valid design per
ADR-0117 service-method spirit) wins by majority but the dissent stands
for a future audit cycle.

**DA #2 — "Marketplace integrity lint is theatre; authors will work
around it":** Withdraws. Panel rationale persuasive: the lint catches
the F-07-002 shape directly (anyone adding `mcp__ruflo__newtool_*` to
a skill `allowed-tools` without a matching `cli/src/mcp-tools/` entry
trips the gate), and the lint runs at fork-source build time so
"working around" requires bypassing CI. The lint is a regression guard,
not an authorship-discipline mechanism. The DA's stronger form ("future
plugin authors will paste fake refs in skill bodies, not frontmatter") is
true but covered by assertion #1's scope (skill **body** markdown refs
also walked, per Decision step 1).

### Improvements adopted

1. **F-07-001 upstream-status claim corrected** — Cluster A check #2
   rewritten: `ruflo-graph-intelligence` is **fork-only** (no
   `ruvnet/ruflo/plugins/ruflo-graph-intelligence/` exists). Disposition
   (delete-preferred) unchanged; the divergence-rationale section gets
   "deleting a fork-only DOA plugin is strictly less divergent than
   keeping it" added.
2. **F-07-004 disposition upgraded** — adopt upstream's
   `scripts/ruflo-hook.sh` resilient shim pattern (verified at
   `ruvnet/ruflo/plugins/ruflo-core/scripts/ruflo-hook.sh`) instead of
   the ADR's `npx claude-flow@alpha` → `npx -y @sparkleideas/cli@latest`
   substitution. The shim is structurally superior: it prefers a
   locally-installed binary, falls back to `npx --prefer-offline`,
   always exits 0 so install failures never block a turn, and the
   `_note` field documents why bare `npx <pkg>@alpha hooks` must NOT be
   reintroduced. Implementation step becomes: (a) copy
   `ruvnet/ruflo/plugins/ruflo-core/scripts/ruflo-hook.sh` to
   `forks/ruflo/plugins/ruflo-core/scripts/` (one new file), (b)
   rewrite `hooks.json` to invoke
   `"${CLAUDE_PLUGIN_ROOT}/scripts/ruflo-hook.sh" <subcmd> || true`,
   (c) record the upstream re-sync in INTEGRATION-LEDGER as
   `import-from-upstream` (NOT `superseded-by-local`).
3. **F-07-004 occurrence-count corrected** — "5 occurrences total" /
   "5 lines" in Decision row 3 and Confirmation criterion #3 corrected
   to **3 lines** (lines 9, 18, 48 — verified by `grep -c
   "claude-flow@alpha" forks/ruflo/plugins/ruflo-core/hooks/hooks.json`).
4. **Lint assertion #3 narrowed** — the "plugin hook brand" assertion
   now reads: "Every `forks/ruflo/plugins/*/hooks/hooks.json` must NOT
   contain `claude-flow@alpha` or `npx claude-flow` unqualified by
   `-y` + `@sparkleideas/cli@latest`. After F-07-004 adopts the shim
   pattern, the assertion strengthens to: every hook command must
   route through `${CLAUDE_PLUGIN_ROOT}/scripts/*.sh` rather than bare
   `npx` — but the strengthening is deferred until the shim adoption
   is verified at PR review (not a Decision change today)."
5. **DA's `ruflo-neural-trader` dissent recorded** — F-07-007
   disposition unchanged (description rewrite per Decision row 6) but a
   dissent note added: "future audit cycle should re-examine whether
   description rewrite is sufficient or whether the plugin should be
   deleted from `marketplace.json` like F-07-001's preferred path".

### Confirmation amendments (folded into the Decision section above via this review)

The Decision table and Confirmation criteria are amended as follows
(implementer should apply when landing the implementation commit):

* **Row 3 (F-07-004)** Action column: replace "Hand-edit `hooks/hooks.json`
  lines 9, 18, 48 (5 occurrences total per `grep -c`)" with "Adopt
  upstream's `scripts/ruflo-hook.sh` resilient shim (copy from
  `ruvnet/ruflo/plugins/ruflo-core/scripts/`) and rewrite `hooks.json` to
  invoke the shim via `${CLAUDE_PLUGIN_ROOT}` substitution. 3 hook
  commands at lines 9, 18, 48 (verified by `grep -c`)."
* **Confirmation criterion #3 (F-07-004)**: append "AND `grep -c
  '${CLAUDE_PLUGIN_ROOT}/scripts/ruflo-hook.sh'
  forks/ruflo/plugins/ruflo-core/hooks/hooks.json` returns ≥3
  (matching the 3 brand-flipped hook commands)."
* **Cluster A check #2 (F-07-001)**: replace "ALIGNED-WITH-FORK" with
  "FORK-ONLY (upstream `ruvnet/ruflo/plugins/` does not ship
  `ruflo-graph-intelligence` — the plugin is a fork-only addition; the
  delete disposition is strictly less divergent than the ADR's framing
  implied)."
* **Cluster C check #2 (F-07-004)**: replace "ALIGNED-WITH-FORK
  (legitimately)" with "**UPSTREAM ALREADY SOLVED**. Upstream
  `ruflo-core/hooks/hooks.json` carries zero `claude-flow@alpha`
  references; the fork is the stale/regressed copy. The fix is to
  re-adopt the upstream shim (`scripts/ruflo-hook.sh`), not to
  substitute one bare `npx <pkg>@alpha` invocation for another."

