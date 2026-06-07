---
status: accepted
date: 2026-06-07
tags: [toolchain, infrastructure, pipeline, ci]
supersedes: []
depends-on: []
implements: []
---

# Node toolchain: single pin, shims-first resolution, verify-at-chokepoints

## Context and Problem Statement

This machine hosts multiple Node projects with different node requirements
(ruflo-patch pins 24; opda/hm historically ran 22 — ADR-0287's cross-project
correction), and the stack carries ABI-bound native modules (`better-sqlite3`
in agentdb): the node that builds `node_modules` must be the node that runs
them. ADR-0287's wave settled the operational state on **node 24.14.1**
(mise global pin, daemon/MCP restarted onto 24, "neural is disabled"
red-herring traced to a swallowed ABI mismatch, patch.408).

That state had no *enforcement*. Node reaches processes through several
resolution contexts — interactive fish (mise-activated ✓), non-interactive
shells, hooks, long-lived daemons, the release pipeline, GitHub runners — and
only the first and last were governed. On 2026-06-07 Homebrew's `node`
formula (a dependency of aws-cdk/wrangler/jupyterlab/etc.) put **node 26** at
`/opt/homebrew/bin/node`, ahead of mise in the base PATH. Every ungoverned
context silently switched: the release pipeline died 19 minutes in with
`NODE_MODULE_VERSION 137 vs 147` ABI stack traces, and the live MCP server's
`agentdb_hierarchical-store` broke the same way. A pin-parity audit also
found **21 `node-version: '22'` pins across 13 GitHub workflows** — the
pre-June CI fleet never followed the 24 decision (only the two reconvergence
workflows carrying the "daemon-node-version trap" comment had been updated).

## Decision Drivers

* One machine, many projects, per-project node versions — a single global
  node cannot serve it; resolution must be per-directory.
* ABI-bound natives make version drift a *corruption* class, not an
  inconvenience; failures must be loud, early, and self-explanatory.
* No fallbacks ([[feedback-no-fallbacks]]): a pipeline that silently
  re-execs itself under the right node hides a broken environment.
* Brew's node cannot be uninstalled (six formulae depend on it) but must
  never win resolution.
* Pins were scattered (mise global, untracked `.tool-versions`, 28 workflow
  pins) with no parity mechanism.

## Considered Options

* **Single pin + shims-first resolution + verify-at-chokepoints** — one
  committed source of truth; one selection mechanism per environment class
  (workstation: mise shims-first base PATH; CI: `actions/setup-node`);
  fail-fast verification where it matters (pipeline preamble, preflight
  pin-parity lint).
* **Auto-rescue** (pipeline wraps itself in `mise exec`) — rejected: a
  fallback that masks environment breakage; the wrong node keeps winning
  everywhere else (daemons, hooks) while releases "work".
* **Adopt node 26 everywhere** (rebuild natives, bump pins) — rejected:
  contradicts ADR-0287's settled state for zero benefit, and re-runs the
  same race at node 28.
* **`brew uninstall node`** — unavailable: aws-cdk, cloudflare-wrangler,
  fauna-shell, jupyterlab, prettierd, shopify-cli depend on the keg.

## Decision Outcome

Chosen option: "Single pin + shims-first resolution + verify-at-chokepoints".
Principle: **persistent environments are verified, ephemeral environments are
constructed, and each environment class has exactly one selection
mechanism.**

1. **Single source of truth:** `.tool-versions` (`nodejs 24`) is committed
   (it had been untracked since 2026-04-03 — invisible drift). Major-level
   pin: node ABI changes per major. The mise *global* config stays 24.14.1
   for non-project directories (ADR-0287 fix, 2026-06-02).
2. **Workstation resolution — mise shims first, everywhere:**
   `~/.local/share/mise/shims` is prepended in `config.fish` (after
   `mise activate`; governs everything fish launches, incl. Claude Code and
   its hooks/daemons) and `~/.profile` (sh/bash contexts), plus
   `launchctl config user path` for GUI-spawned processes. Shims resolve the
   per-directory pin at exec time without shell activation. Brew's node is
   `brew unlink`ed (dependents use the keg path
   `/opt/homebrew/opt/node/...`, verified via shebangs, and keep working); a
   future `brew upgrade` relink is harmless because shims outrank it.
3. **Pipeline verification (never selection):** `ruflo-publish.sh` preamble
   `_node_toolchain_guard` asserts (a) node major == `.tool-versions` pin,
   (b) the `better-sqlite3` ABI canary loads under the running node
   (catches reverse drift: right node, stale `node_modules`;
   `MODULE_NOT_FOUND` is skip-not-fail so fresh CI checkouts pass). Dies in
   seconds with the fix instructions.
4. **CI construction + parity:** workflows keep `actions/setup-node`; all
   21 stray `'22'` pins flipped to `'24'`; new preflight lint
   `lint-node-pin-parity.mjs` (wired into `npm run preflight`, which the
   pipeline runs) asserts every workflow `node-version` matches the
   `.tool-versions` major, with an explicit (currently empty) allowlist for
   deliberate exceptions.

### Consequences

* Good, because all resolution contexts converge on the pin: verified live —
  post-change, plain `npm run test:unit` is green without `mise exec`
  (5192 ✔), the worker daemon restarted onto mise 24.14.1, and the guard's
  negative test (node-26 keg first on PATH) dies in <2s with the runbook.
* Good, because pin drift anywhere (workflows, future scatter) is now a
  preflight failure, not an archaeology project.
* Bad, because `launchctl config user path` needs sudo + re-login; until
  then GUI-spawned processes keep their inherited PATH (mitigated: brew node
  is unlinked, so nothing wrong is left to find).
* Bad, because a genuinely intended node-major bump must touch
  `.tool-versions`, the mise global, and rebuild natives — deliberate
  friction, documented here.
* Neutral, because the MCP server of any session started before the fix
  keeps its node-26 process until session restart (`agentdb_hierarchical-store`
  recovers then).

### Confirmation

* `lint-node-pin-parity.mjs` in the preflight chain (runs in pipeline + CI).
* `_node_toolchain_guard` in `ruflo-publish.sh` (negative-tested 2026-06-07:
  node-26-first PATH → `FATAL [ADR-0302]`, exit 1, pre-lock).
* Operational check when "live-only" bugs appear: `ps` the daemon/MCP
  process's node binary path first (ADR-0287 lesson, memory
  `project-mcp-daemon-runs-sqljs-fallback`).

## More Information

* ADR-0287 — the 2026-06-02/03 remediation that settled node 24 (daemon/MCP
  restart, opda/hm cross-project misattribution, mise global 24.14.1).
* Incident timeline 2026-06-07: brew node 26 → release `test-ci` ABI
  failures (`storage-config-adr0062`, `adr0086-sqlite-migration`) + live
  `agentdb_hierarchical-store` failure; recovered same day via this ADR's
  mechanism.
* The npx cache is ABI-blind (memory
  `project-agentdb-neural-disabled-redherring-and-node-abi`): cached natives
  built under the pinned node are correct; convergent resolution makes the
  cache safe without rebuilds.
