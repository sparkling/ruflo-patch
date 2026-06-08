# Session Handover — 2026-06-08

Long multi-thread session. Spanned plugin-marketplace identity, node toolchain
enforcement, Verdaccio topology, a codex-init repair, an adr-index perf finding,
a deep model-routing investigation, several machine/project setups, and a
recurring **meta-lesson: stop reflexively concluding ruflo is broken** (ADR-0293
pattern — the running code keeps refuting the skepticism).

## Shipped / live

| What | State |
|---|---|
| **ADR-0301** fork marketplace identity → `sparkleideas` | accepted; shipped (cli patch.428/429); machine migrated to 33× `@sparkleideas`, user-scope `@ruflo` removed |
| **ADR-0302** node toolchain enforcement | accepted; shipped (`28cd3c2`): `.tool-versions` committed, `_node_toolchain_guard` in publish, `lint-node-pin-parity` (flipped 21 stray `'22'` CI pins), brew node unlinked, mise shims-first; `launchctl` path applied (pending reboot) |
| **ADR-0303** Verdaccio topology (wildcard serves Mac + `hm` over Tailscale; loopback-shadow runbook) | accepted (`5a7b1db`); also in `CLAUDE.md` |
| **ruflo-adr 0.2.39** (adr-create templates reconciled to canonical MADR + `import.mjs` parses `implements`) | shipped cli patch.432 (fork `260d62f25`) |
| **ADR-0300** npx-mcp-boot landmine | confirmation closed — clean `npx -y @sparkleideas/ruflo@latest mcp start` verified @ patch.429 (`ca8ac6f`) |
| **ADR-0289** PII Phase-1 gate | flipped accepted; locked via the adr0290 A3 canary (fake secret+email); Phase 2 deferred (`2a0cb57`) |
| Booster test stranded-fix recovered from worktree | `bc1a549` |
| **semantic-docs README Q2** (model routing) corrected | edited 2026-06-08 (in `~/source/hm/semantic-docs`, that repo's working tree) |

## Proposed ADRs — PLANS ONLY, not executed (each gated on explicit go-ahead)

- **ADR-0304** — repair fork `init --codex` execution path. Test-install-driven:
  T1 = trace the `--codex` path (`init.ts → executor.ts → @claude-flow/codex
  initializer.ts`) and enumerate bugs before fixing. Point-fix already landed
  (fork `3ccb64e0e`: registers `ruflo`/`@sparkleideas/ruflo` not upstream
  `claude-flow`, npx-codex fallback) — ADR mandates VERIFYING it under test-install.
- **ADR-0305** — migrate the `adr-index` skill from `import.mjs` (≈840
  `npx @latest`-per-item spawns, ~5.6 min pure npx/cache-lock tax) to ADR-0273's
  in-process `agentdb index` (typed `implements` edges). Test-driven: run the
  builder end-to-end FIRST; confirm the opaque-blob-vs-typed-edge artifact
  question; then repoint the skill.
- **ADR-0306** — triage the unconsumed `MultiModelRouter` (WIRE / KEEP / DELETE
  per `feedback-no-consumer-is-not-stub`) + fix USERGUIDE routing doc-drift
  (`:894` "Q-learning" → Thompson; reconcile 24.5/30-50/75% savings figures).

## Fork code committed but NOT yet released (needs a release to ship)

- **`3ccb64e0e`** (`forks/ruflo`, pushed `sparkling/main`) — the codex-init
  realm fix. Lives in `@claude-flow/codex`; will reach consumers only when a
  release bumps that package's version.

## Headline finding — model routing (the "is it all broken?" investigation)

Question: *"Model routing — only Claude, or other models (and RuVLLM) too?"*
A 4-agent swarm (warm probes vs published patch.432 + shipped code) **refuted**
the prior session's "marketing / aspirational / unproven / docs-lie" answer:

- **Not only Claude.** Cross-provider routing is real, wired, shipped, and
  *empirically demonstrated*: `agent-execute-core.ts` (`callAnthropicMessages` →
  OpenRouter/Ollama/OpenAI-compat). Plus local RuVLLM ($0). Config via
  `RUFLO_PROVIDER`/`OPENROUTER_API_KEY`/`OLLAMA_*`.
- **L1 bandit** real + learning (warm: priors Beta(1,1)→(9,1), persisted).
- **RuVLLM** real, NOT aspirational — the "EWC NaN / similarity 0" claim was a
  **stale, misattributed** citation (upstream `ADR-086-ruvllm…`, a different
  package; closed by fork **ADR-0231**); "similarity 0" was a correct orthogonal
  cosine misread as a bug.
- **The ONE genuine gap:** the named `MultiModelRouter` (full provider list +
  cost/latency/quality scoring + circuit breaker) is real but **unconsumed
  shelfware** (mock dispatch, zero consumers) → no automatic failover / no
  auto-cheapest-selection on the live path (explicit env-driven instead). →
  ADR-0306.

## Broader semantic-docs README audit (agents covered Q1/Q3/Q4/Q5/Q8/Q10)

The doc is **mostly accurate** (skeptical hedges evidence-backed more often than
not). Localized errors found — FOLLOW-UPS, user only scoped me to Q2:
- **Q1 RAM figures invented:** "~512 MB CLI / ~4 GB swarm" have NO source
  (ADR-0243's RSS soak is *owed*, no published budget). Real sourced number:
  **~250 MB per headless `claude` worker** (`worker-daemon.ts:342`); a 6-worker
  swarm ≈ ~1.5 GB. Conclusion ("16 GB Mac is fine; ceiling is API cost") stands.
- **Q5 marketplace realm error:** doc says `/plugin marketplace add ruvnet/ruflo`
  + `install @ruflo` — that's UPSTREAM; on this machine it's `sparkling/ruflo` →
  `@sparkleideas` (ADR-0301). Also active/inactive plugin lists wrong (all 8
  "inactive" are enabled; `agent`/`graph-intelligence` are `@ruflo`-only;
  `security-audit` is the one disabled; `wasm` omitted).
- **Q3 stale date:** testgaps prompt is **Apr-5**, not "2026-06-07" (substance
  correct). `daemon.autoStart` citation imprecise (it's `mcp.autoStart`,
  conflicting yaml=false/json=true; daemon was running).
- **Q8:** MCP "per-user global" imprecise — registration is per-repo via `.mcp.json`.
- **ADR-086 citation misattributed** (fork 0086 = storage; the ruvllm one is
  upstream) — same root as the Q2 RuVLLM correction.

## Machine state

- **node:** mise 24.14.1, shims-first PATH (config.fish + ~/.profile + launchctl
  pending reboot); brew node **unlinked** (keep it so). NEVER `mise exec`-wrap
  the pipeline — a failing toolchain guard = fix the env.
- **codex client:** user ran `npm i -g @openai/codex@latest` (now 0.137; brew
  0.27.0 is dead-channel). Fork `ruflo` MCP server registered with codex via npx.
- **semantic-docs** (`~/source/hm/`): UPSTREAM init (Claude realm) — statusline +
  hooks now present (init had never run before).
- **semantic-learn** (`~/source/hm/`): FORK init, effectively DUAL (codex
  surfaces from `--codex` run + Claude-Code scaffolding from the no-codex re-run).
- **Verdaccio:** localhost-shadow (VS Code 4873 forward) fixed; topology recorded.
- **hm server:** committed lockfiles purged (`b070234a`), 4873 auto-forward
  ignore set; `RemoteForward 1080` removed from local ssh config.

## Memory updates this session

- `feedback-no-codex-mentions` — codex usage ban **reinstated** (Henrik
  Claude-only) with a carve-out: the fork ships `--codex`, so fixing its code is
  maintenance (ADR-0304).
- `feedback-rate-limit-just-retry` — NEW: on transient rate-limit, just retry,
  don't scale back / "keep it tight".
- `project-adr0301-marketplace-identity`, `project-adr0302-node-toolchain-enforcement`,
  `reference-verdaccio` (topology) — added/updated.

## Open / next (your call on each)

1. **Releases:** ADR-0304/0305/0306 are proposed plans (not executed); the codex
   fork fix `3ccb64e0e` needs a release to ship. Use `RUFLO_MAX_PARALLEL=4` if
   the machine is loaded (perf-gate flakes otherwise — adr0261-benchmark /
   e2e-0059 are load-sensitive, not regressions).
2. **README follow-ups** (Q1 RAM, Q5 realm, Q3 date, Q8 MCP, ADR-086 attribution)
   — flagged above, not yet fixed.
3. **implements-edge materialization** — deferred behind ADR-0305 T1 (run
   `agentdb index` end-to-end, scoped to `docs/adr`, NOT the worktree-polluted cwd).
4. **Per-machine UI:** `/plugin` → Marketplaces → Enable auto-update for
   `sparkleideas` + `ruflo`; reboot for the launchctl PATH.
5. **hm:** rotate the `ghp_…` token in `~/source/hm`'s git remote (still HTTPS —
   codex/ssh-over-443 not yet set up there); decide npm-security strategy now that
   lockfiles are gone.

## Key commits (ruflo-patch `main`, pushed)

`1ea576f` verdaccio topology · `53e5717` project @sparkleideas migration ·
`28cd3c2`+`f0fffae` ADR-0302 toolchain · `2752620` gitignore · `5a7b1db` ADR-0303 ·
`414abfb`+`4ae6c5e` ADR-0301 amendments · `c819218` published versions ·
`ca8ac6f` ADR-0300 closed · `bc1a549` booster fix · `2a0cb57` ADR-0289 ·
`028c845` ADR-0304 · `eb8c932` ADR-0305 · (+ ADR-0306 + this handover, this turn).
Fork: `3ccb64e0e` codex init fix (pushed `sparkling/main`).
