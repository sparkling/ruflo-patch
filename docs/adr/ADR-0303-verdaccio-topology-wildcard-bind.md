---
status: accepted
date: 2026-06-07
tags: [infrastructure, registry, networking]
supersedes: []
depends-on: []
implements: []
---

# Verdaccio topology: one instance, wildcard bind, serving this machine + hm over Tailscale

## Context and Problem Statement

The private npm registry (Verdaccio, `:4873`) is load-bearing for the entire
fork pipeline ([[reference-verdaccio]] semantics: shadows public npm for
`@sparkleideas/*`, no `proxy: npmjs` on that scope). Its deployment topology
was undocumented — no ADR, and the session memory only said "runs globally on
this machine". On 2026-06-07 that gap turned a 54-minute pipeline hang into
an archaeology exercise: `localhost:4873` was black-holed while Verdaccio was
in fact healthy, and the first diagnosis ("VS Code forward from a dead
remote — remove it") could not be evaluated against any recorded topology.

The actual topology (confirmed with Henrik, now recorded): **one** Verdaccio
instance, hosted on this Mac, binding `*:4873`, consumed by BOTH this machine
(via `localhost`) AND the `hm` server (via the Mac's Tailscale address,
`http://100.75.183.120:4873` in hm's `~/.npmrc`).

The incident mechanics: a VS Code Remote session to `hm` auto-forwarded port
4873 (its output-watcher saw `localhost:4873` — seeded by `resolved:` URLs in
lockfiles committed from this Mac), binding `127.0.0.1:4873` locally. A
loopback-specific bind outranks a wildcard bind for `localhost` traffic, so
every local consumer hung against the dead forward while Tailscale/LAN
clients worked. (Auto-forwarding restores remembered ports per workspace, so
"new session re-creates it" — until the seed and the port rule were fixed.)

## Decision Drivers

* The wildcard bind is load-bearing (hm's Tailscale path) but is exactly what
  makes the loopback shadowable — that coupling must be documented.
* Diagnosis time: with the topology recorded, "localhost hangs but
  `<tailscale-ip>:4873/-/ping` answers" identifies a loopback shadow in one
  command.
* Registry URLs leak into artifacts (lockfile `resolved:` URLs) and seed
  tooling on other machines — cross-machine consumers must not inherit
  loopback URLs.

## Considered Options

* **Document the wildcard topology + guard the failure mode** (this ADR):
  keep `*:4873`; record the loopback-shadow diagnosis; eliminate the seeds
  (lockfiles) and pin VS Code's port rule on remotes.
* **Bind Verdaccio to specific interfaces** (loopback + Tailscale IP) —
  rejected: Tailscale IPs can change; binding races tailscaled at boot; and
  the loopback listener can STILL be shadowed-by-failure if anything else
  grabs it first. Complexity without removing the failure class.
* **Move all consumers (including local) to the Tailscale URL** — rejected:
  couples local releases to tailscaled being up; `localhost` is the correct
  local path and is baked into the pipeline (`_cli_cmd`, acceptance,
  Verdaccio shadowing semantics).

## Decision Outcome

Chosen option: "Document + guard". The topology is canonical as stated above;
the guards shipped 2026-06-07:

1. **Diagnosis runbook** (CLAUDE.md "Infrastructure: Verdaccio Registry" +
   [[reference-verdaccio]]): if `localhost:4873` hangs while
   `http://<LAN-or-Tailscale-ip>:4873/-/ping` answers,
   `lsof -nP -iTCP:4873 -sTCP:LISTEN` — two listeners = loopback shadow;
   stop the VS Code forward. Never narrow Verdaccio's bind; never "restart
   Verdaccio" as a first move (it is almost never the component at fault).
2. **Seed elimination on hm**: committed lockfiles carrying
   `localhost:4873` `resolved:` URLs deleted from
   `hm-group/semantic-modelling` (commit `b070234a`), with `.gitignore`
   `package-lock.json` + repo-root `.npmrc` `package-lock=false` preventing
   regeneration. hm's registry remains the Tailscale URL.
3. **Forward suppression on hm**: machine-scoped VS Code setting
   `"remote.portsAttributes": {"4873": {"onAutoForward": "ignore"}}` in
   `~/.vscode-server/data/Machine/settings.json` (applies to that remote
   only).

### Consequences

* Good, because the failure mode is now a one-command diagnosis with a
  recorded fix, and its only known seed + trigger are both eliminated.
* Good, because the load-bearing wildcard bind is protected from
  well-meaning "harden it to loopback" cleanups.
* Bad, because hm has no lockfiles now: npm installs there float within
  semver ranges, and dependabot cannot produce precise lockfile bumps —
  npm security updates on hm need a deliberate strategy (open decision,
  outside this ADR).
* Neutral, because the Tailscale IP is written in hm's `~/.npmrc`; if the
  Mac's tailnet address ever changes, that one line must follow (MagicDNS
  name would remove this, left as an option).

### Confirmation

Operational, not test-gated: the runbook commands in CLAUDE.md. The
acceptance suite exercises `localhost:4873` on every release, so a recurring
shadow surfaces as the documented signature (pipeline hang at a
registry-touching phase with Verdaccio healthy via LAN).

## More Information

* Incident + forensics: this session 2026-06-07 — release run 3 hung 54 min
  at `sanitize-optional-deps`, 0% CPU; `curl localhost:4873/-/ping` timeout
  vs LAN 200/8ms; two listeners (Code Helper on `127.0.0.1`, Verdaccio on
  `*`); seed = 889+459 `localhost:4873` resolved URLs in hm lockfiles;
  VS Code restores remembered forwards per workspace on reconnect.
* [[reference-verdaccio]] — registry shadowing semantics (unchanged by this
  ADR).
* ADR-0302 — the same day's other environment-enforcement decision (node
  toolchain); together they close the two ambient-environment failure
  classes that hit the 2026-06-07 release runs.
