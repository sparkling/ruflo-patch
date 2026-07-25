# Handover — codex / ruflo / ruvnet-brain / hz

**Date**: 2026-07-25
**Machines**: `hz` (aka `gene`, Hetzner AX102 NBG1-DC1, Nuremberg) and the local Mac
**Repos touched**: `sparkling/ruflo-source-patch` (all commits pushed to `main`)

---

## 1. Verified facts about Codex skill discovery (read this first)

Established by reading the **codex 0.145.0 binary itself**, not by inference:

| String | Occurrences |
|---|---|
| `SKILL.md` | 109 |
| `.codex/skills` | 4 |
| `skill.toml` | **0** |
| `.agents/skills` | **0** |

Codex's own embedded text:

> "I will place it in `$CODEX_HOME/skills` (or `~/.codex/skills` when `CODEX_HOME` is unset) so Codex can discover it automatically."
> "Installs into `$CODEX_HOME/skills/<skill-name>` (defaults to `~/.codex/skills`)."

**Conclusions:**

- Codex discovers skills as `<skills-dir>/<name>/SKILL.md`, rooted at `$CODEX_HOME/skills`.
- **`skill.toml` is not a Codex format.** The `.codex/skills/*/skill.toml` manifests in `agent-harness-generator` and `metaharness` are read by something, but it is **not** codex.
- `.agents/skills/` has **zero** references in the binary. Whether codex reaches ruflo's skills via `[[skills.config]]` entries in `.agents/config.toml` is **UNVERIFIED** and is the next thing to check.

---

## 2. Known-wrong thing I shipped

**`18d9ca7` writes four `.codex/skills/<name>/skill.toml` manifests that codex cannot read.**

- Files: `search-ruvnet`, `ruflo-memory-search`, `ruflo-memory-store`, `ruflo-swarm-init`
- Written into projects by `lib/dual/ruflo-add-codex.sh` step 2c, sourced from `lib/dual/codex-skills/`
- Also installed by hand into `~/source/oxigraph/.codex/skills/` on hz
- They are inert, not harmful. Nothing breaks; they simply do nothing.

**Cause:** I copied the shape from rUv's repos (`agent-harness-generator/.codex/skills/repo-genome/skill.toml`) without checking whether codex consumes it. The arg schemas inside them *were* verified against live `tools/list`, so the content is accurate — the container format is wrong.

**Options** (undecided):

1. Convert to `SKILL.md` at the path codex actually scans, and confirm empirically that a skill appears in a codex session.
2. Revert `18d9ca7` entirely, on the grounds that MCP tools are already self-describing (each carries `description` + `inputSchema` via `tools/list`), so the manifests were discoverability sugar rather than a fix.

Option 2 is defensible: the original premise ("the MCP surface reaches codex undescribed") is **false** — codex receives full descriptions and JSON schemas for every tool over MCP.

**Do not file** the drafted "ruflo/codex emits no skill.toml" issue. The premise does not survive contact with the binary.

---

## 3. Upstream issues

### Filed and fixed

| Issue | Status |
|---|---|
| [stuinfla/ruvnet-brain#41](https://github.com/stuinfla/ruvnet-brain/issues/41) | **Closed/fixed** in 3.9.72-dev (`0ff4c2e`). `shellSkeleton()` adopted verbatim from the reference implementation supplied in the report. |
| [stuinfla/ruvnet-brain#42](https://github.com/stuinfla/ruvnet-brain/issues/42) | **Closed/fixed** in 3.9.72-dev (`969b1ed`) — but see #43; the fix does not work on npm installs. |

### Filed and open

| Issue | Summary |
|---|---|
| [stuinfla/ruvnet-brain#43](https://github.com/stuinfla/ruvnet-brain/issues/43) | The #42 Codex wiring is inert on npm installs. `wireCodexHost()` reads `<pkg>/plugin/mcp/server.mjs`, but `plugin/` is excluded by `package.json`'s `files` whitelist (verified: 0 `package/plugin/*` entries in the 3.9.75-dev tarball). Works from a git checkout only. |
| [ruvnet/ruflo#2765](https://github.com/ruvnet/ruflo/issues/2765) | `@claude-flow/codex` built-in skills reference docs that were never authored + render wrong script paths. **NOT yet validated as unintentional — see Outstanding.** |
| [ruvnet/ruflo#2777](https://github.com/ruvnet/ruflo/issues/2777) | `ruflo init` imports the entire `ruvnet/ruflo` repo (97MB, 384 `SKILL.md`) into `.agents/skills/ruflo/`. Cause: `vercel-labs/skills` copies `dirname(SKILL.md)`, and ruflo's canonical `SKILL.md` sits at the repo root. Upstream's own fix commit claims "~1 file". |

---

## 4. Commits pushed to `sparkling/ruflo-source-patch`

| Commit | What |
|---|---|
| `453f751` | `supersede`: `verify-interface` could never retire — `JSON_PARSE` marker anchored on one *spelling* (`"$NODE_BIN" -e '`) of upstream's fix, which moved into a shared `hook-input.mjs`. Markers are now lists of accepted spellings via a shared `hasFixMarker()`. |
| `465f0a4` | `dual`: `ruflo-new-dual.sh` left 8 plugin-duplicated hook entries behind. The dedupe sweep was documented in a header comment instead of being run. Now step 5, on by default, `--no-dedupe` to skip. |
| `dd5c375` → `70248e3` | Reverted. An env-var workaround (`RUFLO_NO_SKILLS_SH=1`) in one script — wrong for a patch repo, since it only helps callers who go through that script. |
| `99c9df7` | `init` patch target, third fragment: suppress `maybeInstallSkillsSh()` so `ruflo init` stops importing the 97MB repo (#2777). |
| `247b93e` | Fixed 5 em-dash md-lint violations I introduced (the repo bans em-dashes; lint was clean at 0 before). |
| `dae59f5` | Docs: recorded #2777 across README targets table, README upstream-issues table, patch-library comment, and ADR-022 (`Updated` stamp, "two files, four edits" → "three files, five edits"). |
| `02c728b` | `dual`: register `ruvnet-brain`'s MCP server for Codex (its installer never did). **Still needed** — upstream's replacement is inert on npm (#43). |
| `18d9ca7` | `dual`: four `.codex/skills/*/skill.toml` manifests. **KNOWN WRONG — see §2.** |

---

## 5. State of `hz`

### Services — deliberately quiesced

Stopped: `haproxy`, `oauth2-proxy`, `artalk`, `grlc`, `postgresql@17-main`, `docker.socket`, `containerd`, `ModemManager`, `wpa_supplicant`, `atd`.

**Verdaccio: stopped AND permanently disabled** (`verdaccio.service`, `verdaccio-seed.service`, `verdaccio-persist.timer` all `disabled`). It was the dead `@sparkleideas` registry; nothing resolves against it. Storage left in place at `~/.local/share/verdaccio` (12K).

Still running by design: `sshd`, `tailscaled`, `systemd-resolved`. **Do not stop these** — SSH is bound to `tailscale0` only, so stopping either is a lockout requiring Hetzner rescue.

Also running: the oxigraph ruflo daemon and MCP servers (not part of the shutdown request).

### Firewall (ufw)

```
Default: deny (incoming)
22/tcp     on tailscale0   ALLOW IN  Anywhere          # SSH via Tailscale only
41641/udp                  ALLOW IN  81.97.158.56      # Tailscale WireGuard - dpls
41641/udp                  ALLOW IN  185.96.220.130    # Tailscale WireGuard - henrik macbook
22/tcp (v6) on tailscale0  ALLOW IN  Anywhere (v6)
```

80/443 removed (v4 + v6) after haproxy was stopped. External scan confirms **every TCP port closed** on `213.133.100.202`; only `udp/41641` answers, and only from the two whitelisted IPs.

**41641/udp is Tailscale's WireGuard port, not ruflo-mcp.** Owned by `tailscaled` pid 1421 (`--port=41641`). ruflo MCP is **stdio** — verified 0 listening sockets across all three processes. It cannot be scoped to the tailnet range: WireGuard packets arrive from peers' *public* IPs and *create* the tailnet, so a `100.64.0.0/10` rule would match nothing and permanently force DERP relay.

Henrik's IP is static, so the two-IP pin is correct and should stay. An earlier suggestion to open it to `Anywhere` was withdrawn.

### Other hz config changed

- `~/.codex/config.toml`: dead `[mcp_servers.claude-flow]` removed (args lacked `mcp start`, cost a 30s timeout every launch). `[mcp_servers.ruvnet-brain]` added by hand, pointing at the marketplace checkout. `model = "gpt-5.6-sol"` (was the retired `gpt-5.3-codex`).
- `~/.claude/env.sh:5` and `~/.config/ruflo/secrets.env:3`: `NPM_CONFIG_REGISTRY` commented out. **This was the real npm breakage** — env vars override `.npmrc`, so npm pointed at a dead Verdaccio while the file looked correct.
- Removed a 1.7GB stale `@sparkleideas` npx cache (`_npx/c1e25e42fe45c385`) that made the monitor log a `skip:anchor-not-found` warning every 5 minutes.
- ⚠️ **`NPM_TOKEN` is exported from `~/.claude/env.sh:2` and its value was leaked into a session transcript. It should be revoked and reissued.** Still outstanding.

### ruflo-source-patch on hz

8 targets live (`cwd`, `daemon`, `memory`, `init`, `adr-template`, `adr-index`, `mcp-prefix`, `design-wall`). `verify-interface` and `adr-reindex` retired with sticky `state.json` records. Monitor on cron every 300s, default behaviour (the temporary `RSP_NO_STALE_WRITER_KILL=1` pin has been removed). 29 ruflo plugins installed at user scope, matching the Mac.

---

## 6. Outstanding

1. **Decide the fate of `18d9ca7`** (§2) — convert to `SKILL.md` at a path codex actually scans, or revert.
2. **Verify whether codex reads ruflo's `.agents/skills/`** via `[[skills.config]]` in `.agents/config.toml`. This determines whether ruflo's codex skills work at all, and is a prerequisite for any issue on the subject.
3. **#2765 not yet validated.** Henrik asked for a check against ruflo ADRs/docs that the dangling doc references are unintentional, then a patch. Not started. Note the prior art: ADR-027 documents `.codex/` as *gitignored local overrides*, which is evidence ruflo's directory choices are deliberate and should be checked before assuming a defect.
4. **Revoke `NPM_TOKEN`** on hz.
5. **ruvnet-brain retirement stays parked** until #43 is fixed. `02c728b` is still load-bearing.
6. `81.97.158.56` ("dpls") in the ufw rules — confirm still needed, else remove.
7. hz's TLS cert for `*.hm.sparklingideas.co.uk` expired 2026-06-21; renewal has been failing for a month. Moot while haproxy is stopped.

---

## 7. Process notes worth keeping

- **Verify against the artifact, never the pattern.** Three separate errors this session came from inferring instead of checking: the `skill.toml` format (codex has zero references to it), the supersede marker (anchored on a spelling, not a behaviour), and "upstream knows it clones the repo" (misread a comment about a temp-dir clone).
- **`ss`/`pgrep` self-matching inflates counts.** `pgrep -f "daemon start"` matches the shell running that very command. Always confirm via `/proc/<pid>/cmdline`.
- **Env vars beat `.npmrc`.** `npm config list` marks the override with `; overridden by env`.
- **Test scaffolds in `/tmp`, never in a live project.** Four re-scaffolds of `~/source/oxigraph` were destructive and avoidable.
- **`gh` must run as the `sparkling` account** for these repos; the EMU work account cannot create issues on external repos. Switch, act, switch back.
