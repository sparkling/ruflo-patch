## ADR-0248 — CT-O: plugin marketplace integrity + honesty

**Status**: proposed (post-swarm-review)
**Swarm**: 5 experts + devil's advocate, Quorum-majority per-plugin consensus (≥4/6)
**Triage rank**: 7 (per [[ADR-0233]] §Decision)

### Decision (post-swarm-review)

Apply the original ADR's **combination of Options A + C + narrow codemod-style
edit** with **three concrete amendments** surfaced by the panel: (i) F-07-004
disposition upgraded to adopt upstream's `scripts/ruflo-hook.sh` resilient
shim (verified-superior to the substitution the ADR proposed); (ii)
upstream-status claims for F-07-001 and F-07-004 corrected — both are
fork-only / fork-regressed, NOT "ALIGNED-WITH-FORK" as the ADR's pre-flight
states; (iii) brand-drift count for F-07-004 corrected from 5 → 3
(`grep -c` verified). Per-plugin votes are unanimous (6/6) on 8 of 12
dispositions; F-07-004 shim adoption is 5/6 (E4 hand-edit-only dissent
withdrawn after upstream evidence shown); F-07-007 description-rewrite is
5/6 with DA principled dissent recorded. DA withdraws on "lint is theatre"
(panel rationale: regression-guard not authorship-discipline) and on
"delete `ruflo-agentdb`" (real plugin with real registered tools); holds
principled dissent on "delete `ruflo-neural-trader`" (12-file CLI-shim
plugin) for future audit cycle.

### Implementation steps

1. **F-07-001 delete (preferred disposition)**: Remove
   `ruflo-graph-intelligence` entry from
   `forks/ruflo/.claude-plugin/marketplace.json`; delete
   `forks/ruflo/plugins/ruflo-graph-intelligence/` tree (verified
   fork-only — `ruvnet/ruflo/plugins/` has no `ruflo-graph-intelligence`
   directory). Record in INTEGRATION-LEDGER as `fork-only-deleted` (no
   upstream divergence — the plugin never existed upstream).
2. **F-07-002 phantom-tools removal**: Hand-edit
   `forks/ruflo/plugins/ruflo-agentdb/skills/vector-search/SKILL.md:5`
   to drop `mcp__ruflo__embeddings_rabitq_build|_search|_status` from
   `allowed-tools`; remove "RaBitQ 1-bit quantization" framing from
   skill body; update `scripts/smoke.sh:40-42,82,106-108` to drop the
   three phantom names from the expected-tools loop and markdown-grep
   gate; rewrite `docs/adrs/0001-agentdb-optimization.md:37,49,73` to
   drop false line-number citations. Record fork-vs-upstream divergence
   in INTEGRATION-LEDGER per `[[feedback-update-integration-ledger]]`
   (upstream carries the same phantom refs — fork is diverging
   intentionally to remove the lie).
3. **F-07-004 upstream shim re-adoption** (post-review amendment): Copy
   `ruvnet/ruflo/plugins/ruflo-core/scripts/ruflo-hook.sh` to
   `forks/ruflo/plugins/ruflo-core/scripts/` (new file in fork; the
   shim does NOT exist in fork today — verified via `ls
   forks/ruflo/plugins/ruflo-core/scripts/` returns no `ruflo-hook.sh`).
   Rewrite the 3 hook commands at lines 9, 18, 48 (`grep -c
   "claude-flow@alpha"` = 3, NOT 5 as the original ADR stated) to
   invoke `"${CLAUDE_PLUGIN_ROOT}/scripts/ruflo-hook.sh" <subcmd> || true`
   matching upstream's pattern. The shim prefers a locally-installed
   binary, falls back to `npx --prefer-offline`, always exits 0 so
   install failures never block a turn. The `_note` field in the shim
   explicitly forbids reverting to bare `npx <pkg>@alpha hooks` — this
   note must be preserved verbatim. Record in INTEGRATION-LEDGER as
   `import-from-upstream` (NOT `superseded-by-local`).
4. **F-07-006 description rewrites** (4 plugins —
   `ruflo-iot-cognitum`, `ruflo-federation`, `ruflo-knowledge-graph`,
   `ruflo-market-data`): Hand-edit each
   `plugins/<name>/.claude-plugin/plugin.json` description field to
   name the actually-composed MCP-tool families + add "workflow
   scaffold" / "thought-template" framing. No new lint — gated at PR
   review.
5. **F-07-007 description rewrite** (`ruflo-neural-trader`): Hand-edit
   `plugins/ruflo-neural-trader/.claude-plugin/plugin.json` to drop
   "112+ MCP tools" framing, name the `npx neural-trader` delegation
   explicitly. DA dissent recorded but disposition unchanged.
6. **Marketplace integrity lint** (`ruflo-patch/tests/pipeline/
   plugin-marketplace-integrity.test.mjs` — new file): 4 assertions
   per the ADR's Decision §Marketplace integrity lint section. After
   F-07-004's shim adoption, the plugin-hook-brand assertion (#3)
   strengthens to also require `${CLAUDE_PLUGIN_ROOT}/scripts/*.sh`
   routing for all hook commands. Forbidden-string set factored into
   shared `tests/pipeline/_brand-forbidden.mjs` helper (or reused from
   [[ADR-0235]]'s `umbrella-plugin-brand.test.mjs`).
7. **F-07-008 runtime verification**: Single sandbox `claude plugin
   install ruflo-cost-tracker@ruflo` + `grep -E
   "plugins/ruflo-cost-tracker/scripts" ~/.claude/plugins/
   ruflo-cost-tracker/skills/*/SKILL.md` to determine whether Claude
   Code rewrites the hardcoded `plugins/...` paths. Outcome (i): close
   F-07-008 with "accepted, document the convention in plugin's README".
   Outcome (ii): rewrite skill bodies to use `${CLAUDE_PLUGIN_ROOT}` or
   equivalent. Tracked as follow-up; not blocking ADR-0248 landing.

### Dependencies

- [[ADR-0210]] — stub-honesty mandate (implement / restore / delete,
  not label) — governs F-07-001 and F-07-002 dispositions; this ADR
  applies the principle per-plugin.
- [[ADR-0235]] (CT-B) — sibling content-invariant lint pattern for
  umbrella `plugin.json` brand miss; the per-plugin integrity lint
  here extends ADR-0235's pattern to plugin hooks + skill
  `allowed-tools` refs. Coordinate forbidden-string set so the two
  lints cannot drift.
- [[ADR-0143]] — brand-rebrand Pass 7 — F-07-004 is a Pass 5
  coverage-vs-reach gap (codemod matches the path but runs against
  build temp dir while marketplace ships from fork source via
  `marketplace.json source:` — see CT-O cross-bonus row in
  [[ADR-0233]]). Remedy is hand-edit + lint, NOT Pass 5 scope
  extension (rejected per [[ADR-0233]] pre-flight-inversion list).
- [[ADR-0117]] §Revision 2026-05-03 — service-method MCP server
  registration — the structural premise the 32 markdown-bundle plugins
  compose against; F-07-001 delete-disposition honours this design
  (the plugin's 6 MCP tools cannot be registered through plugin-side
  `mcpServers` blocks per service-method spec).
- [[ADR-0238]] (CT-E) — wire-or-remove for **central**
  `cli/src/mcp-tools/*.ts` surfaces; disjoint from this ADR's
  per-plugin scope.
- [[ADR-0201]] — Remediation-ADR pre-flight checklist — applied per
  cluster (A/B/C/D). Per the review, Cluster A check #2 and Cluster C
  check #2 are corrected; the four-check shape is preserved.

### Validation

- **F-07-001 deletion**: `grep -c "ruflo-graph-intelligence"
  forks/ruflo/.claude-plugin/marketplace.json` returns 0 AND
  `ls forks/ruflo/plugins/ruflo-graph-intelligence/` returns
  no-such-directory.
- **F-07-002 phantom-tools removal**: `grep -c "embeddings_rabitq"
  forks/ruflo/plugins/ruflo-agentdb/skills/vector-search/SKILL.md`
  returns 0 AND `grep -c "embeddings_rabitq"
  forks/ruflo/plugins/ruflo-agentdb/scripts/smoke.sh` returns 0.
  The marketplace integrity lint's tool-reference-resolution
  assertion fails today and passes after the fix.
- **F-07-004 shim adoption**: `grep -c "claude-flow@alpha"
  forks/ruflo/plugins/ruflo-core/hooks/hooks.json` returns 0 AND
  `grep -c "ruflo-hook.sh"
  forks/ruflo/plugins/ruflo-core/hooks/hooks.json` returns ≥3 AND
  `test -x forks/ruflo/plugins/ruflo-core/scripts/ruflo-hook.sh`
  succeeds (the shim was copied from upstream). The marketplace
  integrity lint's plugin-hook-brand assertion fails today and passes
  after the fix.
- **F-07-006 / F-07-007 description rewrites**: PR-review gated; no
  automated test (the rewrites are subjective).
- **F-07-008**: Runtime verification probe (cheap — single sandbox
  install + grep) determines disposition; no acceptance gate in
  ADR-0248 itself.
- **Marketplace integrity lint**: `npm run test:pipeline` invokes the
  new lint; all 4 assertions pass against the post-fix tree.
- No `skip_accepted` per `[[feedback-skip-accepted-as-squelch]]`.

### Top risk + mitigation

- **Risk**: F-07-001 deletion is a behaviour-visible change for anyone
  scripting "all plugins in `marketplace.json`" against the fork. If
  any downstream consumer (an autopilot worker, a future
  `plugin discover`-style tool, a memory entry citing the plugin)
  references `ruflo-graph-intelligence`, deletion silently breaks
  that reference. The ADR's fallback (b) — publish to Verdaccio AND
  wire `graphIntelligenceTools` into the cli registry AND add a
  markdown surface — preserves the listing but at a real cost
  (publish + cli-registry edit + new skill authoring); the ADR picks
  delete-preferred per [[ADR-0210]] stub-honesty.
- **Mitigation**: Search the corpus for `ruflo-graph-intelligence`
  references before landing the deletion. `grep -r
  "ruflo-graph-intelligence"
  ~/.claude/projects/-Users-henrik-source-ruflo-patch/memory/` to
  surface any memory entries; `grep -rn "graphIntelligenceTools"
  forks/ ruflo-patch/` to surface any code references; check
  `docs/adr/*` for any prior ADR that promises wiring (per the ADR's
  reference to ADR-126 / "Wedge-8" — that reference must be either
  re-targeted or marked deferred-without-target).
- **Secondary risk**: F-07-004 shim adoption introduces a new file
  (`scripts/ruflo-hook.sh`) into the fork. The shim runs on every
  `PostToolUse` / `Stop` hook fire — a bug in the shim is a
  per-tool-call cost. **Mitigation**: copy verbatim from upstream
  (`ruvnet/ruflo/plugins/ruflo-core/scripts/ruflo-hook.sh`) without
  modification; the upstream shim has been in production for months
  and is the proven path. Future fork-specific divergences (if any)
  go through INTEGRATION-LEDGER review.
