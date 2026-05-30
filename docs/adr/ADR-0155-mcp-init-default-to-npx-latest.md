---
status: accepted
date: 2026-05-07
tags: [mcp, init, npx, branding]
supersedes: []
depends-on: []
implements: []
---

# Init template `.mcp.json` defaults to `npx -y @sparkleideas/ruflo@latest`, not globally-resolved binary path

## Context and Problem Statement

`forks/ruflo/v3/@claude-flow/cli/src/init/mcp-generator.ts:40-51` currently chooses between two `.mcp.json` shapes for the `ruflo` MCP server entry:

| Branch | When taken | Resulting command | Tradeoff |
|---|---|---|---|
| **A. Direct path** (default) | `which ruflo` finds a global binary | `command: <abs-path>, args: [mcp, start]` | Fast cold-start. Pinned to whatever `@claude-flow/cli` was bundled at last `npm install -g` time. |
| **B. npx-@latest** (fallback) | No global ruflo found | `command: npx, args: [-y, @sparkleideas/cli@latest, mcp, start]` | Always fetches @latest. ~5–8s npx cold-start each MCP boot. |

ADR-0104 §4a introduced branch A to keep MCP attach inside claude-code's `-p` mode handshake budget. The optimisation works as designed for users who keep their global ruflo current.

The optimisation has a failure mode the validation around ADR-0154 made concrete: the global wrapper at the resolved path delegates to a bundled `@claude-flow/cli` that ages relative to `@latest` on Verdaccio. Users running stale wrappers miss subsequent runtime fixes (e.g. d12 typed-retry, musl prebuild, Phase 4 loader-preference) even after we publish — same staleness shape as the HM project's pinned-npx-cache .mcp.json that motivated ADR-0154's "Operational recovery applied" section, just at the global-wrapper layer instead of the npx-cache layer.

Branch A's freshness model assumes "user keeps global current". Branch B's freshness model is "MCP boot pulls @latest each time". When a runtime fix lands, branch A users keep running stale code until they manually `npm install -g`; branch B users get the fix on next MCP boot.

## Considered Options

1. **Flip the default to the npx-@latest form (chosen)** — make `npx -y @sparkleideas/ruflo@latest mcp start` the unconditional default and remove the directly-resolved-global-path branch.
2. **Keep both branches; expose a flag (`--prefer-global` or `--prefer-npx`)**. Rejected. Defaults shape behavior more than flags do, and the user has stated explicitly we always use npx for ruflo. A flag preserves the staleness footgun for the ~all users who never set it.
3. **Auto-update the global ruflo on each MCP boot**. Rejected. Same complexity as npx but with a write-side effect on the user's global node_modules. npx is the lighter, well-understood mechanism for "current version on demand".
4. **Periodically cache-bust the global path** (e.g. weekly). Rejected. Adds state (last-resolved-time files), creates non-determinism, and still leaves a window where users run stale code.
5. **Document both shapes; let users choose at init time via prompt**. Rejected. Init is non-interactive in most flows; a prompt becomes a default-acceptance question that selects the wrong default for the dominant case.

## Decision Outcome

Chosen option: "Flip the default to the npx-@latest form", because freshness should be the default — every MCP boot resolving @latest eliminates the wrapper-staleness footgun, matches `feedback-always-npx-for-ruflo`, and keeps the user-facing brand consistent with ADR-0143.

Flip the default. The init template's `.mcp.json` `ruflo` entry MUST be:

```json
{
  "mcpServers": {
    "ruflo": {
      "command": "npx",
      "args": ["-y", "@sparkleideas/ruflo@latest", "mcp", "start"],
      "env": { ... }
    }
  }
}
```

Change in `mcp-generator.ts:40-51`: invert the conditional. The `npx -y @sparkleideas/ruflo@latest mcp start` form becomes the unconditional default. The directly-resolved-global-path branch is removed (not "kept behind a flag" — see §Considered Options).

Note the package change inside the npx form: `@sparkleideas/ruflo@latest` (the user-facing wrapper, per ADR-0143) replaces the current fallback's `@sparkleideas/cli@latest` (internal-only). The `@sparkleideas/ruflo` package is the canonical user-facing distribution; using it in the npx form keeps the brand consistent with the ADR-0143 surface.

Recovery scripts, USERGUIDE examples, and any other documentation that produces `.mcp.json` snippets MUST follow the same form.

### Consequences

* Good, because freshness is the default. Every MCP boot resolves @latest from the user's npm registry (or Verdaccio in dev). Runtime fixes land for users without manual `npm install -g`.
* Good, because brand consistency: the user-facing `@sparkleideas/ruflo` package appears in the user-facing `.mcp.json`, matching ADR-0143.
* Good, because it eliminates the wrapper-staleness footgun. Aligns with `feedback-always-npx-for-ruflo`.
* Bad, because of ~5–8s npx cold-start on every MCP boot. ADR-0104 §4a's perf concern is real; this ADR explicitly accepts it. Users who care more about cold-start than freshness can manually edit `.mcp.json` to use a direct path.
* Bad, because of the network dependency on first MCP boot per session (npm registry resolution). The npm-config `update_notifier: false` env stays.
* Neutral, because npm cache cold-starts pay a one-time install cost per `@latest` version change.

**Migration for existing projects**:
Existing `.mcp.json` files with the directly-resolved-global-path form continue to work — this ADR only changes what `ruflo init` writes for new projects. To update an existing project, either:

```bash
# Option A: re-init (rewrites .mcp.json)
cd "$PROJECT" && ruflo init --force

# Option B: surgical update via jq
jq '.mcpServers.ruflo = {
  "command": "npx",
  "args": ["-y", "@sparkleideas/ruflo@latest", "mcp", "start"],
  "env": .mcpServers.ruflo.env // {}
}' "$PROJECT/.mcp.json" > "$PROJECT/.mcp.json.new" && \
  mv "$PROJECT/.mcp.json.new" "$PROJECT/.mcp.json"
```

After either, kill any orphan MCP servers so the next claude-code session boots a fresh process:

```bash
pkill -KILL -f '@sparkleideas/(cli|ruflo)' || true
```

### Confirmation

Acceptance criteria:

1. `forks/ruflo/v3/@claude-flow/cli/src/init/mcp-generator.ts` `createRufloEntry()` returns the npx form unconditionally; `detectRufloPath()` and the `cachedRufloPath` module-state are removed.
2. The package referenced in the npx args is `@sparkleideas/ruflo@latest` (user-facing wrapper, ADR-0143), not `@sparkleideas/cli@latest`.
3. A unit test asserts the generated `.mcp.json` shape contains `"command": "npx"` and `"@sparkleideas/ruflo@latest"` in args; a regression-guard test asserts the `.mcp.json` does NOT contain absolute file paths under `command`.
4. USERGUIDE / README / ADR-0154 §"Operational recovery" snippets are audited for npx form consistency.
5. Pipeline acceptance suite continues to pass at 674/674 after the change.

## Open question (deferred)

If users end up wanting the perf optimisation back as an opt-in, the right shape is probably a `RUFLO_MCP_USE_GLOBAL=1` env var that init reads at write-time. Not implementing now — wait for actual demand. Tracked here so the question doesn't get lost.

## More Information

This decision relates to ADR-0104 (§4a — the perf optimisation this ADR partially reverts), ADR-0143 (user-facing brand `@sparkleideas/ruflo`), ADR-0154 (HM-class data-loss bug closed by Phase 4 loader-preference; motivates freshness), and the user-stated rule `feedback-always-npx-for-ruflo`.
