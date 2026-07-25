# Handover to Codex — ruflo-source-patch / ruvnet-brain / hz

**Written**: 2026-07-25. Assume no prior context. Everything below was verified against real artifacts unless explicitly marked UNVERIFIED.

---

## 0. Access

| Thing | How |
|---|---|
| `hz` server (aka `gene`) | `ssh hz` — Hetzner AX102, Nuremberg, public IP `213.133.100.202`, tailnet IP `100.119.242.104` |
| SSH reachability | **Tailnet only.** `ufw` allows `22/tcp on tailscale0`. Public port 22 is closed by design. |
| Connection flapping | The tailnet path drops intermittently. **Just retry** — 1-5 attempts with ~12s sleeps usually reconnects. The box stays up throughout (check `ping 213.133.100.202`). |
| GitHub | Issues/pushes for these repos need the **`sparkling`** account. The default active account is an EMU work account that **cannot** create issues on external repos. Use `gh auth switch --user sparkling`, act, then switch back to `henrik-pettersen_hmgroup`. |
| Patch repo | `/Users/henrik/source/ruflo-source-patch` (pushes to `sparkling/ruflo-source-patch`) |

---

## 1. The one fact that invalidates a lot of prior reasoning

**Codex does not read `skill.toml`.** Verified by inspecting the `codex` 0.145.0 binary on hz:

```
SKILL.md        109 occurrences
.codex/skills     4
skill.toml        0     <-- zero
[dispatch]        0     <-- zero
.agents/skills    0     <-- zero
```

Codex's own embedded text:

> "I will place it in `$CODEX_HOME/skills` (or `~/.codex/skills` when `CODEX_HOME` is unset) so Codex can discover it automatically."
> "Installs into `$CODEX_HOME/skills/<skill-name>` (defaults to `~/.codex/skills`)."

**Therefore:**

- Codex discovers `<skills-dir>/<name>/SKILL.md`, rooted at `$CODEX_HOME/skills`, with `references/` and `scripts/` resolved relative to that `SKILL.md`.
- The `.codex/skills/*/skill.toml` manifests in `agent-harness-generator` and `metaharness` are consumed by something, but **it is not Codex**.
- **UNVERIFIED and important:** `.agents/skills` has zero occurrences too. Whether Codex reaches ruflo's generated skills via the `[[skills.config]]` entries that `codex init` writes into `.agents/config.toml` is **not established**. Resolve this before making any claim about ruflo's codex skills working or not working.

Reproduce:
```bash
B=/usr/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex
strings "$B" | grep -c 'skill\.toml'   # 0
strings "$B" | grep -c 'SKILL\.md'     # 109
```

---

## 2. Known-wrong code that is committed and deployed

**`18d9ca7` in `ruflo-source-patch` ships four inert files.**

- `lib/dual/codex-skills/{search-ruvnet,ruflo-memory-search,ruflo-memory-store,ruflo-swarm-init}/skill.toml`
- Written into projects by `lib/dual/ruflo-add-codex.sh` step 2c
- Also hand-installed at `~/source/oxigraph/.codex/skills/` on hz
- Codex ignores them entirely. Nothing breaks; they simply do nothing.

The arg schemas inside them **were** verified against live `tools/list`, so the content is accurate — only the container format is wrong.

**Decide one of:**

1. **Revert `18d9ca7`.** Defensible: MCP tools are already self-describing (each carries `description` + `inputSchema` via `tools/list`), so the manifests solved a problem that does not exist.
2. Port to `SKILL.md` under the path Codex actually scans, and **verify empirically** in a real Codex session that a skill appears. Do not ship on inference again.

Option 1 is the lower-risk default.

---

## 3. Upstream issues

### Open, needing action

| Issue | State |
|---|---|
| [stuinfla/ruvnet-brain#43](https://github.com/stuinfla/ruvnet-brain/issues/43) | **The blocker for #42.** `wireCodexHost()` reads `<pkg>/plugin/mcp/server.mjs`, but `plugin/` is excluded by `package.json`'s `files` whitelist — verified: 0 `package/plugin/*` entries in the 3.9.75-dev tarball. So the Codex registration is inert on every npm install; it works only from a git checkout. |
| [ruvnet/ruflo#2765](https://github.com/ruvnet/ruflo/issues/2765) | Filed, **never validated**. Built-in codex skills reference docs that were never authored + render wrong script paths. Henrik asked for a check against ruflo ADRs/docs that this is unintentional, **then** a patch. Not started. Prior art to weigh: ADR-027 documents `.codex/` as *gitignored local overrides*, which is evidence ruflo's directory choices are deliberate. |
| [ruvnet/ruflo#2777](https://github.com/ruvnet/ruflo/issues/2777) | Filed + patched (`99c9df7`). A correction comment is posted retracting one impact claim (see §5). |

### Closed / fixed

| Issue | State |
|---|---|
| [ruvnet-brain#41](https://github.com/stuinfla/ruvnet-brain/issues/41) | Fixed 3.9.72-dev (`0ff4c2e`). |
| [ruvnet-brain#42](https://github.com/stuinfla/ruvnet-brain/issues/42) | Fixed 3.9.72-dev (`969b1ed`), but see #43 — inert on npm. A correction comment is posted (§5). |

---

## 4. Immediate next action (was in flight when the session ended)

```bash
ssh hz
claude plugin marketplace update ruvnet-brain
```

**Why:** the npm package on hz is `3.9.75-dev`, but the Claude Code plugin (marketplace checkout) is still **`3.9.70-dev`**. They version independently. The #42 fix landed in 3.9.72, so **none of it is on that box yet** — which is why no `.codex/skills/*/skill.toml` from upstream is visible there.

**Then verify:**
```bash
find ~/.claude/plugins/marketplaces/ruvnet-brain -path "*skills*" \( -name skill.toml -o -name SKILL.md \)
ruvnet-brain --doctor 2>&1 | grep -i codex
```

**Caveat:** `~/.codex/config.toml` on hz currently contains a **hand-added** `[mcp_servers.ruvnet-brain]` (points at the marketplace path, no managed-block markers). Under upstream's design, a hand-written entry outside their markers means **theirs will never take over**. Remove it if you want to test their path:

```bash
# back up first
awk '/^\[mcp_servers\.ruvnet-brain\]/{s=1;next} s&&/^\[/{s=0} !s' ~/.codex/config.toml > /tmp/c && mv /tmp/c ~/.codex/config.toml
```

⚠️ If you remove it and upstream's registration then fails (likely, per #43), **hz is left with no brain in Codex**. That already happened once. Restore with:

```bash
B=$HOME/.claude/plugins/marketplaces/ruvnet-brain/plugin/mcp/server.mjs
printf '\n[mcp_servers.ruvnet-brain]\ncommand = "node"\nargs = ["%s"]\n' "$B" >> ~/.codex/config.toml
```

---

## 5. Corrections already posted upstream (do not re-litigate)

- **#42** — retracted the `.codex/skills/*/skill.toml` recommendation. The maintainer had *implemented* it; those manifests are inert. The MCP-registration half remains correct.
- **#43** — retracted a closing note implying the manifests were worth packaging.
- **#2777** — withdrew impact claim 2 ("exhausts Codex's 2% skills budget"). It was correlation, not a proven mechanism, given `.agents/skills` has 0 occurrences in the binary. All measured facts in that issue stand.

---

## 6. `hz` state

### Services — intentionally quiesced

Stopped: `haproxy`, `oauth2-proxy`, `artalk`, `grlc`, `postgresql@17-main`, `docker.socket`, `containerd`, `ModemManager`, `wpa_supplicant`, `atd`.

**Verdaccio stopped and permanently disabled** (`verdaccio.service`, `verdaccio-seed.service`, `verdaccio-persist.timer`). It served the dead `@sparkleideas` registry. Storage retained at `~/.local/share/verdaccio` (12K).

Running by design: `sshd`, `tailscaled`, `systemd-resolved`, plus the oxigraph ruflo daemon + MCP servers.

**Never stop `sshd` or `tailscaled`.** SSH is bound to `tailscale0`; stopping either is a lockout requiring Hetzner rescue.

### Firewall

```
Default: deny (incoming)
22/tcp     on tailscale0   ALLOW IN  Anywhere          # SSH via Tailscale only
41641/udp                  ALLOW IN  81.97.158.56      # Tailscale WireGuard - dpls
41641/udp                  ALLOW IN  185.96.220.130    # Tailscale WireGuard - henrik macbook
22/tcp (v6) on tailscale0  ALLOW IN  Anywhere (v6)
```

External scan confirms every TCP port closed on the public IP. `80/443` were removed after haproxy stopped.

**`41641/udp` is Tailscale's WireGuard port, not ruflo-mcp.** Owned by `tailscaled` (`--port=41641`). ruflo MCP is **stdio** — 0 listening sockets, verified. It **cannot** be scoped to the tailnet range: WireGuard packets arrive from peers' *public* IPs and *create* the tailnet, so a `100.64.0.0/10` rule matches nothing and would force permanent DERP relay. Henrik's IP is static; the two-IP pin is correct — leave it.

### Config changed on hz

- `~/.codex/config.toml`: dead `[mcp_servers.claude-flow]` removed (its args lacked `mcp start`, costing a 30s timeout every launch); `model = "gpt-5.6-sol"` (was retired `gpt-5.3-codex`); hand-added `[mcp_servers.ruvnet-brain]`.
- `~/.claude/env.sh:5` + `~/.config/ruflo/secrets.env:3`: `NPM_CONFIG_REGISTRY` commented out. **This was the real npm breakage** — env vars override `.npmrc`, so npm pointed at a dead Verdaccio while the file looked correct. Check `npm config list` for `; overridden by env`.
- Removed a 1.7GB stale `@sparkleideas` npx cache (`_npx/c1e25e42fe45c385`) that made the patch monitor log a warning every 5 minutes.

### ruflo-source-patch on hz

8 targets live (`cwd`, `daemon`, `memory`, `init`, `adr-template`, `adr-index`, `mcp-prefix`, `design-wall`). `verify-interface` + `adr-reindex` retired with sticky `state.json` records. Monitor on cron every 300s, default behaviour. 29 ruflo plugins at user scope.

---

## 7. Outstanding work, priority order

1. **Revoke `NPM_TOKEN`** — exported from `~/.claude/env.sh:2`; its value was leaked into a session transcript. Only item with a real security cost.
2. **Decide the fate of `18d9ca7`** (§2) — revert, or port to `SKILL.md` and verify empirically.
3. **Resolve the `.agents/skills` question** (§1) — does Codex read it via `[[skills.config]]`? Prerequisite for judging #2765 and for any claim about ruflo's codex skills.
4. **Validate #2765 against ruflo ADRs**, then patch if genuinely unintentional.
5. **ruvnet-brain retirement stays parked** until #43 is fixed. `02c728b` is still load-bearing.
6. Confirm `81.97.158.56` ("dpls") is still a live machine, else drop the ufw rule.
7. hz TLS cert for `*.hm.sparklingideas.co.uk` expired 2026-06-21; renewal failing for a month. Moot while haproxy is stopped.

---

## 8. Traps that cost time in this session

- **Verify against the artifact, never the pattern.** Three errors came from inference: the `skill.toml` format, a supersede marker anchored on a *spelling* rather than a behaviour, and misreading a comment about a temp-dir clone as "upstream knows".
- **`pgrep -f "X"` matches the shell running that very command.** Confirm process counts via `/proc/<pid>/cmdline`.
- **Env vars beat `.npmrc`.** `npm config list` flags it with `; overridden by env`.
- **`npx <pkg>` can silently run a stale global install.** hz ran ruvnet-brain 3.9.69 while reporting "latest 3.9.75". Check the actual resolved path.
- **Test scaffolds in `/tmp`, never a live project.** `~/source/oxigraph` was destructively re-scaffolded four times.
- **The repo's md-lint bans em-dashes.** Run `node scripts/md-lint.mjs` before committing docs; it must report 0 problems.
- **Retirement requires the target to be *installed*.** `retireSuperseded()` iterates `state.patchTargets + state.pluginTargets`; uninstalling a target removes it from consideration so it can never be recorded as retired.
