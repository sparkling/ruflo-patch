---
status: accepted
date: 2026-06-07
tags: [plugins, distribution, init, claude-code]
supersedes: []
depends-on: []
implements: []
---

# Fork marketplace identity split — `sparkleideas` marketplace + init-managed team-marketplace settings

## Context and Problem Statement

Claude Code plugin marketplaces are keyed by a machine-global `name` (from the
marketplace's `marketplace.json`); adding a second marketplace with the same
name **replaces** the first. Both upstream (`ruvnet/ruflo`) and the fork
(`sparkling/ruflo`) declare `name: "ruflo"`, so they cannot coexist on one
machine. On 2026-06-04 an upstream-install experiment ran
`/plugin marketplace add ruvnet/ruflo` and silently re-cloned the `ruflo`
marketplace from upstream, stranding the 33 fork plugins installed at user
scope (including the fork-only `ruflo-hive-mind` and `ruflo-wasm`, which the
upstream catalog does not list) as un-updatable cache orphans.

Two further out-of-the-box defects compound this:

1. Neither upstream nor fork `init` wires Claude Code plugins at all — plugin
   delivery is a documented manual `/plugin marketplace add` + N×
   `/plugin install` ritual.
2. Claude Code disables marketplace auto-update for third-party marketplaces
   by default, so even a correctly-registered marketplace goes stale (the
   machine's `ruflo` marketplace never refreshed after 2026-06-04;
   `legacybridge-cc-plugins` has been stale since 2026-05-16).

Requirement (user, 2026-06-07): installs of **upstream** ruflo and of the
**fork** must each work out of the box, pulling their own plugins, with no
post-install modifications — transparent from the init command forward.

## Decision Drivers

* Marketplace names are machine-global with replace-on-collision semantics —
  shared-name coexistence is impossible by construction.
* Fork plugins must update from `sparkling/ruflo` (which bumps every
  `plugin.json` per release); upstream plugins from `ruvnet/ruflo`.
* "Transparent after init" — no manual `/plugin` commands, no settings surgery.
* Upstream's documented flow must keep working verbatim (no donate-backs; we
  cannot patch upstream's init).
* Prefer Claude Code native mechanisms over fork-owned install machinery.

## Considered Options

* **Rename the fork marketplace** (`ruflo` → `sparkleideas`) and have fork
  init emit Claude Code's native team-marketplace settings
  (`extraKnownMarketplaces` + `enabledPlugins`) into generated project
  `.claude/settings.json`.
* **Keep one shared name `ruflo`** and re-point its source per machine/project
  — rejected: the global name key means the two sources replace each other;
  any upstream experiment re-hijacks the fork registration (exactly the
  2026-06-04 incident).
* **Fork-owned installer** (CLI code writing `~/.claude/plugins` internals) —
  rejected: duplicates Claude Code's installer, fragile against its internal
  schema, and the native team-marketplace flow already does this with a
  consent prompt.

## Decision Outcome

Chosen option: "Rename + init-managed team-marketplace settings", because it
is the only shape that satisfies the global-name constraint, and it delegates
all install/update mechanics to Claude Code's supported flow.

Concretely, in `forks/ruflo`:

1. `.claude-plugin/marketplace.json` `name`: `ruflo` → **`sparkleideas`**
   (matches the fork's npm scope `@sparkleideas/*`; upstream will never claim
   it, so the collision cannot recur). Plugin names and skill namespaces
   (`ruflo-core:…`) are unchanged — only the `@marketplace` suffix moves.
2. `settings-generator.ts` emits into generated project settings:
   * `extraKnownMarketplaces.sparkleideas = { source: { source: "github",
     repo: "sparkling/ruflo" } }`
   * `enabledPlugins`: all 33 fork plugins as `<plugin>@sparkleideas: true`,
     except `ruflo-security-audit@sparkleideas: false` (project posture).
   On folder-trust Claude Code prompts once and installs the marketplace +
   plugins natively — zero manual commands, any machine. `sparkling/ruflo` is
   public, so background auto-update needs no auth token.
3. Emission fixes riding the same surface: `claudemd-generator` install hint
   `@ruflo` → `@sparkleideas`; `statusline-generator` (and the repo's own
   generated `statusline.cjs`) version-probe path `marketplaces/ruflo/` →
   `marketplaces/sparkleideas/`; `build-hive-mind-plugin.sh` install hint;
   and the invalid permission rule `mcp__claude-flow__:*` →
   `mcp__claude-flow__*` (Claude Code allow-rule globs are only valid in the
   tool position; the `:*` form is silently skipped, leaving MCP tools
   un-allowlisted in every init'd project).

Out of scope (operator runbook, not code): per-machine
`/plugin → Marketplaces → Enable auto-update` for both `sparkleideas` and
`ruflo` (third-party marketplaces default OFF), and the one-time migration of
existing machines (re-install user-scope plugins as `@sparkleideas`, flip
`enabledPlugins` keys, drop stale `@ruflo` user-scope entries).

### Consequences

* Good, because upstream's documented flow (`marketplace add ruvnet/ruflo`,
  `install …@ruflo`) works verbatim alongside the fork — nothing squats the
  `ruflo` name anymore.
* Good, because fork plugin updates flow release → `sparkling/ruflo` push →
  marketplace refresh → plugin auto-update, with no fork-owned installer code.
* Good, because the init-emitted settings make a fork project portable: any
  collaborator/machine gets the full plugin set on first trust.
* Bad, because every existing `enabledPlugins` key (`…@ruflo`) on current
  machines/projects must migrate to `…@sparkleideas` once.
* Bad, because generated projects force-enable 32 plugins by default —
  context-cost is accepted to match the fork's default-ON posture
  ([[feedback-no-dormant-off-by-default-flags]]); users disable per project.
* Neutral, because marketplace auto-update remains a per-machine UI toggle —
  Claude Code offers no user-level settings key for it; documented in the
  runbook instead.

### Confirmation

Fork arch test `adr0301-marketplace-identity.arch.test.ts` asserts:
(a) `marketplace.json` name is `sparkleideas`; (b) generated settings contain
the `extraKnownMarketplaces.sparkleideas` block with repo `sparkling/ruflo`;
(c) generated `enabledPlugins` keys exactly match the marketplace plugin list
(drift gate) with `@sparkleideas` suffixes; (d) no generator emits `@ruflo`;
(e) the permissions allow list contains `mcp__claude-flow__*` and no `:*` MCP
form. Wired into the standard acceptance runner per
[[feedback-always-wire-tests-into-cicd]].

## More Information

* Root-cause forensics (this session, 2026-06-07): marketplace clone
  `~/.claude/plugins/marketplaces/ruflo` re-cloned from `ruvnet/ruflo` at
  2026-06-04T09:42:09Z (matching `/private/tmp/ruflo-learning-audit` +
  `/private/tmp/ruflo-fresh` project-scope installs to the second); all prior
  install records carry `sparkling/main` commit SHAs.
* Claude Code semantics: code.claude.com/docs/en/plugin-marketplaces ("Each
  user can register only one marketplace per name: adding a second marketplace
  with the same name replaces the first") and /docs/en/discover-plugins
  ("Official Anthropic marketplaces have auto-update enabled by default.
  Third-party and local development marketplaces have auto-update disabled by
  default").
* Completes the F-11-004 direction (ADR-0223 brand canonicalization): that fix
  re-pointed the `marketplace add` hint to `sparkling/ruflo` but kept the
  colliding name.
* Related: ADR-0248 (plugin marketplace integrity/honesty, CT-O) — same
  surface, orthogonal concern (catalog truthfulness vs marketplace identity).
