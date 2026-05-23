---
status: proposed
date: 2026-05-23
methodology: [MADR, runbook, SPARC]
decision-makers: [Henrik Pettersen]
tags: [upstream-sync, fork-management, ruflo, agentic-flow, ruvector, ruv-FANN, agentdb, runbook, v3-of-0162-cycle, adr-128, security]
depends-on: [0162, 0186, 0187, 0203, 0204]
related: [0088, 0111, 0143, 0161, 0177, 0212, 0215, 0216, 0223, 0225, 0227]
audience: ai-executor
state_schema: 2
---

# ADR-0228: Upstream fork sync 2026-05-23 (v3 — takes over ADR-0186's close-out)

> **AI executor**: this is the runbook for the *unlanded* portion of the
> upstream delta accumulated since ADR-0186 closed on 2026-05-18. v3 does
> NOT supersede v2 — v2 retains authority for its landed batches; v3
> enumerates the post-2026-05-18 delta plus any pre-2026-05-18 SHAs that
> v2 missed. As of 2026-05-23 the raw delta across all 5 forks is **496
> commits** (per `git cherry HEAD origin/main`); after deducting standing-
> rule auto-skips (Batch J version-bump pattern, ADR-0187 ADR-111 decline,
> ADR-0203 hooks/ supersession, ADR-0088 spawn-only, ADR-0143 brand-flip,
> witness regenerations) and previously-disposed-via-retarget entries
> (ADR-0161 agentdb extraction), the actual triage surface is materially
> smaller (~150-200 substantive picks). The driver for v3 over a smaller
> tight-scope batch is the user directive (2026-05-23): "*let's first
> integrate all changes upstream since last time we merged from main*".

## Context and Problem Statement

ADR-0186 closed on 2026-05-18 with 12 pending picks resolved across ruflo
(F-1 statusline/init/hooks fixes + ADR-097/104 federation phases), ruvector
(RAIRS IVF + regression-guard CI), and agentic-flow (QUIC WebSocket fallback
+ confirmed `c2af4dc` already-handled via agentdb extraction). One stray
ruflo pick landed 2026-05-21 (`d065b2d65` → `241435e4d`, #1874 MCP
protocol-compliance smoke) under ADR-0204.

In the 5 days since, upstream has shipped material work across all five
forks. The headline items:

- **ADR-128 (upstream)** — Init Bundle Reduce and Refactor, 5 phases
  (`c63905e6a` → `9a66b2996`, May 21). Closes the skill source-of-truth gap
  (cli ships 0 skills, init defaults skills=true, silent failure on clean
  install — see the ADR-128 Context section). Phase 1 ships 29 skills in
  the cli package; Phases 2-4 reduce agents 98→17 and delete 9 orphan
  command files; Phase 5 adds the `smoke-init-bundle-invariants.mjs` CI
  gate (no orphans, no plugin-init overlap).
- **Security CVE wave (May 23)** — 10 commits across all 5 forks targeting
  shell injection (CWE-78), SSRF, hardcoded keys, NaN-panics, RUSTSEC
  advisories, SQL injection (REINDEX), insecure PRNG, JSON.parse crash
  hardening, protobufjs critical CVE + 16 high otel CVEs, transitive
  override patches.
- **ruvector cluster (May 18-22)** — ~83 commits covering ONNX wasm bundle
  + brain MCP ESM, CypherEngine multi-row MATCH, mcp-brain-server SIGTERM
  handling, SPARQL variable predicates, supply-chain CI, AVX-512 compile
  check, GNN seeded StdRng, ruvllm Qwen2/Gemma metadata, TypeScript fixes
  across 5 npm packages. Plus an MCP stdio hygiene fix (`38105cf89` —
  *route tracing output to stderr to prevent JSON-RPC stdio corruption*)
  that converges with our own ADR-0226.

The fork was at HEAD `d54e7d600` (post-revert of misguided skills-bundle)
when this audit ran.

## Decision Drivers

* **User directive (2026-05-23)**: "integrate all changes upstream since
  last time we merged from main" — broad scope, not tight scope.
* **Security is urgent**: 10 CVE/injection patches need to land regardless
  of broader scope decisions. Per `feedback-no-fallbacks` and the implicit
  zero-tolerance for shipped vulnerabilities.
* **ADR-128 unblocks adr0216 acceptance**: Phase 1 closes the skill
  source-of-truth gap that the dev-machine-only `findSourceDir` walk
  papered over. Without integration, adr0216-corpus-shape and
  adr0216-cli-surface are unreachable in CI.
* **MCP stdio hygiene (ruvector `38105cf89`) converges with fork ADR-0226**.
  Taking upstream avoids a hand-port maintenance tax.
* **Ledger integrity**: per the INTEGRATION-LEDGER's "How to use" section,
  "per-sync ADRs append rows here as part of their close-out". This ADR's
  close-out MUST update the ledger.
* **Per `feedback-update-integration-ledger`**: every cherry-pick, hand-
  port, SKIP, retarget decision MUST append a row to
  `docs/upstream/INTEGRATION-LEDGER.md` in the same commit/PR. Use
  `git cherry-pick -x` so trailers stay greppable.
* **Per `feedback-never-touch-hz-remote`**: the `hz` remote on
  `forks/ruflo` is FORBIDDEN; push targets stay `sparkling`.
* **Per `feedback-trunk-only-fork-development`**: all work lands on `main`
  via direct commits, NO feature branches, NO PRs.
* **Per `feedback-no-squash-fork-history`**: NEVER squash; merge carefully
  with `git cherry-pick -x`.

## Considered Options

* **Option A — Tight scope only**: security (10) + ADR-128 (5+doc) = ~16
  commits. Fast to land, doesn't address the broader backlog.
* **Option B — Tight + ruvector recent**: Option A + ~83 ruvector May-18-22
  commits. Brings in mcp-brain-server hardening, ONNX wasm bundle fixes,
  CypherEngine fixes — material substrate improvements.
* **Option C — Full sync (ADOPTED)**: All 496 raw upstream commits triaged
  against ledger + standing rules; substantive picks applied across all
  5 forks. Largest blast radius but closes the gap completely and matches
  the user directive verbatim.

## Decision Outcome

Chosen option: **Option C — Full sync**, because the user directive is
explicit ("integrate all changes upstream since last time we merged from
main"), the ledger discipline requires per-sync ADR + per-SHA disposition
either way, and tight scope leaves a growing un-disposed backlog that
makes the next sync harder.

## Preflight

State schema (`state_schema: 2` — same as ADR-0186):

| Item | State | Verification |
|---|---|---|
| toolchain | READY | npm/node/rust as of 2026-05-23; ADR-0186 preflight stand |
| forks_clean | required | `git -C forks/<fork> status --short` empty before each batch starts |
| upstreams_fetched | DONE 2026-05-23 | `git fetch origin` ran on all 5 forks at top of this ADR's audit |
| ledger_seed | DONE | INTEGRATION-LEDGER.md current through ADR-0186 + ADR-0204 + ADR-0215/0216 fork-local rows |
| pipeline_baseline | required | `npm run release` last green run before this batch starts; capture baseline for regression compare |

Standing rules carried over from ADR-0186:

1. **ADR-0088 spawn-only** — daemon spawn↔fork churn locked out. Auto-skip
   any upstream SHA matching `daemon.*spawn|spawn.*daemon|IPC pipe.*daemon`
   subject patterns.
2. **ADR-0143 brand canonical** — `@sparkleideas/ruflo` (user-facing) +
   `@sparkleideas/cli` (internal). Auto-skip upstream README/branding flips
   (Cognitum.One affiliate, `npx ruvflo` typos, Update branding sweeps).
3. **ADR-0187 ADR-111 declined** — all federation/WireGuard mesh SHAs are
   `superseded-by-local`. Auto-skip.
4. **ADR-0203 hooks/ supersession** — all `v3/@claude-flow/hooks/` SHAs
   are `superseded-by-adr`. Auto-skip.
5. **ADR-0161 agentdb extraction** — agentic-flow SHAs touching
   `packages/agentdb/` retarget to `forks/agentdb`. Verify via path match.
6. **Batch J version-bump pattern** — `chore(release): ... 3.7.0-alpha.X`
   and pure `chore: bump versions` are `skip-mechanical`. Fork has
   independent `-patch.N` chain.
7. **Witness manifest regenerations** — `verification.md.json` regens are
   fork-local `skip-by-policy`.
8. **`git cherry-pick -x`** mandatory for clean picks (preserves trailer);
   hand-ports MUST cite the upstream SHA in commit message.

## Batches

Numbering continues from ADR-0186 lettering pattern; Batches A-K used
there; this ADR uses Batches L-T.

### Batch L — Security CVEs (PRIORITY 1; all forks)

10 commits, mostly May 23. All MUST land before other batches; security
fixes are non-deferrable.

| Upstream SHA | Fork | Subject | Disposition (planned) |
|---|---|---|---|
| `0e1d26c11` | ruflo | fix(security): CVEs, shell injection, SSRF (#2114) | cherry-pick `-x` |
| `5b8e3ad0f` | ruflo | fix(deps): 3 moderate CVEs via npm overrides (#2113) | cherry-pick `-x` |
| `a3f1cdf` | agentic-flow | fix(security): shell-injectable execSync → safe-exec MCP (#156) | cherry-pick `-x` |
| `98ea0ba` | agentic-flow | fix(security): 7 shell injection sites, 45 CVEs (#157) | cherry-pick `-x` |
| `6a06854` | agentic-flow | fix(security): CWE-78, SSRF, hardcoded key, NaN-panic, RUSTSEC (#158) | cherry-pick `-x` |
| `026011e` | agentdb | fix(security): vuln deps + JSON.parse hardening (#3) | cherry-pick `-x` |
| `d902f9e` | agentdb | fix(security): protobufjs critical + 16 high otel + spawnSync (#4) | cherry-pick `-x` |
| `1776223` | agentdb | fix(security): SQL injection REINDEX, insecure PRNG, JSON.parse | cherry-pick `-x` |
| `9f373f0` | ruv-FANN | fix: security patches + compile error + Adam decay (#190) | cherry-pick `-x` |
| `1d93b35` | ruv-FANN | fix(security): 25 NaN-panic fixes + RUSTSEC | cherry-pick `-x` |

Conflict expectation: low for ruv-FANN + agentdb (small fork divergence on
those files). Medium for ruflo (the security file is `security/*` adjacent
to active fork work) and agentic-flow (npm overrides hunk likely conflicts
with our independent pin chain).

### Batch M — ADR-128 (5 phases + doc + release) — ruflo

7 commits, May 21. Land in upstream sequence so each phase's diff applies
against the previous phase's state.

| Upstream SHA | Subject | Disposition (planned) |
|---|---|---|
| `166ee7f25` | docs(adr): ADR-128 — init bundle reduce + refactor + skill source-of-truth fix | cherry-pick `-x` |
| `c63905e6a` | Phase 1 — ship 29 skills inside @claude-flow/cli package | cherry-pick `-x` |
| `865c901af` | Phase 2 — remove 9 forked agents (let plugins own them) | cherry-pick `-x` |
| `34e7b1e9f` | Phase 3 — opt-in domain-specific agent categories (98 → ~17 default) | cherry-pick `-x` |
| `0740b2fa1` | Phase 4 — delete 9 orphan command files (unreachable from COMMANDS_MAP) | cherry-pick `-x` |
| `9a66b2996` | Phase 5 — init-bundle-invariants smoke (no orphans, no plugin-init overlap) | cherry-pick `-x` |
| `1ce81a3e3` | chore(release): publish 3.7.0-alpha.76 — ADR-128 init bundle reduce | skip-mechanical (Batch J pattern: version-bump) |

**Conflict expectation**: Phase 1 (`c63905e6a`) likely conflicts with our
recent reverts (`d54e7d600` removed our misguided skill-bundle; the
upstream Phase 1 adds 29 specific skills — different set than the 39 our
revert removed). Resolution: take upstream's 29 (canonical), discard our
revert state. Phase 2 may conflict if the 9 forked agents have any
fork-local modifications. Phase 3 changes `DEFAULT_INIT_OPTIONS.agents.*`
defaults; need to verify our fork didn't set conflicting overrides. Phase 5
adds a new smoke test that ratchets the bundle.

**Adr-0216 implication**: post-ADR-128 integration, the adr0216 floor of
38 SKILL.md becomes reachable (29 cli-bundled + plugin-installed). Phase 5
smoke MUST pass before this ADR closes.

### Batch N — ruvector recent (May 18-22)

~83 commits. Lead with the structural fixes; defer style-only.

Notable picks:
- `bff1642b2` ONNX wasm bundle + brain MCP ESM errors + supply-chain CI (#481)
- `0ae4de957` import() inserts memories into HNSW (#315) (#483)
- `81aba6478` CypherEngine multi-row MATCH, rvlite ESM, LearningEngine export (#484)
- `38105cf89` route tracing output to stderr (#470) — **converges with ADR-0226**
- `600580a82` exit cleanly on SIGTERM/SIGINT/stdin-end in MCP server (#475)
- `7c3c1d424` LinearBitNet — ternary weight GEMV with zero-skip (#477)
- `f07540762` SPARQL variable predicates, DESCRIBE EOF (#488)
- `87399fa74` postgres: wrap optional-feature SQL functions in DO exception blocks (#485)
- `ca62a44c2` ruvllm reject unsupported GGUF + Qwen2/Gemma keys (#486)
- `bd71cd1e2` gnn: remove broken linux-arm64-musl from build matrix (#491)
- `bd616ece4` gnn: thread_rng → seeded StdRng (#495)
- `9d4e3ea71` sql: hnsw → ruhnsw access method rename (#496)
- `2495b8f1b` `a531628bb` `5ba2b59b5` `e3d8ff8e6` TS error fixes across 5 npm packages
- `d5e07f6e6` HNSW insert beam + distance-based pruning (#430)
- 4-5 style commits (`cargo fmt`, rustfmt) — take or batch-skip per implementer judgment

**Disposition strategy**: each fix commit cherry-picked `-x` individually.
Style commits cherry-picked in a single follow-up if and only if they
apply cleanly; otherwise skip-mechanical with note.

### Batch O — ruvector older un-dispositioned (pre-May-18)

~30 commits between the ledger's last ruvector row (`c4212106f` 2026-05-16
→ `6235e4f8d`) and the May-18 cutoff above. Likely already-cherry-picked
content; needs `git log forks/ruvector/main --grep="cherry picked from"`
verification per upstream SHA. Most will be `superseded-by-local` or
`already-landed-no-trailer`.

### Batch P — agentic-flow security (3 commits)

Just the 3 May-23 security commits already in Batch L above.

The other ~27 agentic-flow upstream commits surfacing in `git cherry` are
all from 2026-03-25 through 2026-05-09 and are already classified in the
ledger as `retargeted` to `forks/agentdb` (ADR-0161 extraction window).
Verify via cross-reference to ledger rows 142-151. Any new ones get
explicit ledger rows.

### Batch Q — agentdb security (3 commits)

Just the 3 May-23 security commits already in Batch L above.

### Batch R — ruv-FANN security (2 commits)

Just the 2 May-23 security commits already in Batch L above.

### Batch S — ruflo backlog (~263 substantive triage candidates)

Largest unknown. Triage approach:

1. **Auto-skip via standing rules** (apply mechanically):
   - 42 version-bump commits → Batch J pattern
   - 19 branding commits → ADR-0143 standing rule
   - 13 witness regens → fork-local skip
   - 9 ADR-111 federation phases → ADR-0187 decline
   - 1 daemon spawn IPC → ADR-0088 spawn-only
   - Subtotal: 84 auto-skip → recorded as a single roll-up row each
2. **Subtract ADRs already covered** (read ledger):
   - Already-disposed via ADR-0162 v1, ADR-0186, ADR-0187, ADR-0203,
     ADR-0204, ADR-0216, ADR-0215. Verify trailers + cite ledger rows.
3. **Triage remaining ~150-200 substantive picks** in batches of ~30 per
   commit cycle. Each commit gets explicit disposition. Categories:
   - feat (~81): take unless fork-conflicting
   - fix (~92): take with high priority (likely real bugs)
   - perf (~11): take
   - docs (~27): take or skip-by-policy if branding-adjacent
   - test (~11): take
   - refactor: per-commit decision
   - other (~25): per-commit decision

Implementation note: this is the largest sub-batch by volume. Recommend
batched cherry-pick cycles of ~20-30 commits, build-verify between cycles,
to avoid a 200-commit conflict storm at the end.

### Batch T — Final cleanup + ledger close-out

1. Run `node scripts/upstream-ledger-audit.mjs` (if exists; else manual
   cross-check) to verify every dispositioned SHA has a ledger row.
2. Append a single `## Synced via ADR-0228 (2026-05-23 v3)` summary block
   to INTEGRATION-LEDGER.md showing per-fork counts (picks landed, hand-
   ports, skips, retargets).
3. Update `state_schema` block above to record close-out.

## Decision Points

DP-1 — **ADR-128 Phase 1 conflict resolution**: take upstream's 29 cli-
bundled skills as canonical, discarding any fork-local divergent skill-
bundle attempts. **DECISION: take upstream verbatim.** Our fork has no
authoritative skill-bundle work to preserve; the 2026-05-23 misguided
39-skill bundle was reverted at `d54e7d600` before this ADR was written.

DP-2 — **ADR-128 Phase 3 default flip**: upstream changes
`DEFAULT_INIT_OPTIONS.agents.{github,hiveMind,v3,optimization}` from
true to false. If our fork has set these explicitly (e.g. via ADR-0223
brand-canonicalize work), the diff may conflict. **DECISION: take
upstream's opt-in defaults; restore via `--all-agents` flag.** Aligns
with `feedback-no-fallbacks` ("don't ship 98 agents by default when 17
suffice").

DP-3 — **ruvector cluster MCP stdio fix (`38105cf89`) vs ADR-0226 fork
work**: both target the same problem (tracing on stdout corrupts JSON-
RPC). **DECISION: take upstream; mark fork's ADR-0226 implementation as
`superseded-by-upstream` if they overlap; otherwise both stand.** Verify
via diff between upstream's change and fork's `2db0fdaeb` or similar.

DP-4 — **Style-only commits (cargo fmt, rustfmt)**: ~4-5 in ruvector.
**DECISION: cherry-pick if conflict-free; skip-mechanical otherwise.**
Style churn doesn't justify hand-port effort.

DP-5 — **Older agentic-flow commits**: 27 of 30 upstream commits are pre-
May-9 (ADR-071/072 work + agentdb extraction). **DECISION: verify already-
retargeted per ledger rows 142-151; explicitly classify any unrecorded
SHAs.** Don't reapply already-landed content.

## Confirmation

This ADR is closed when ALL of the following hold:

1. **Batch L (security) landed**: all 10 SHAs cherry-picked or hand-ported;
   trailers verified via `git log --grep="cherry picked from commit"`.
2. **Batch M (ADR-128) landed**: 6 implementing SHAs + doc cherry-picked;
   `smoke-init-bundle-invariants.mjs` passes; adr0216 acceptance check
   reaches its 38-floor.
3. **Batch N (ruvector recent) landed**: ≥90% of substantive picks
   integrated; any SKIPs documented with rationale.
4. **Batch O, P, Q, R landed**: full disposition coverage.
5. **Batch S (ruflo backlog) landed**: every upstream SHA in the `git
   cherry HEAD origin/main` window has a disposition (pick / skip /
   retarget / supersede). No un-dispositioned commits remain.
6. **Ledger updated**: every disposition has an INTEGRATION-LEDGER row.
   Roll-up rows acceptable for standing-rule auto-skips.
7. **Build green**: `npm run release` completes end-to-end with all gates
   (preflight + test:unit + build:tsc + publish:verdaccio + acceptance)
   passing. Acceptance failure count ≤ baseline at ADR open.
8. **No regressions**: unit + pipeline tests at fork-pre-sync count or
   better.
9. **Forks pushed to `sparkling`**: per `feedback-never-touch-hz-remote`
   the `hz` remote is NOT touched. Only `sparkling` and `ruflo-patch
   origin` receive pushes when authorized.
10. **State schema closed out**: `state_schema: 2` block updated with
    landed counts and close-out timestamp.

## Out of scope (deliberate)

1. **ADR-128 Phase 6+** — does not exist upstream; this sync covers only
   the 5 phases shipped May 21.
2. **Plugin auto-install during `ruflo init`** — ADR-128 explicitly
   defers this; users opt in via `ruflo plugins install <name>`.
3. **agentic-flow ADR-071/072 retroactive coverage** — already
   `retargeted` to `forks/agentdb` per ADR-0161; this ADR verifies
   coverage but doesn't re-port.
4. **Backfill of ADR-0162 v1 unrecorded SHAs** — the ledger's own "Notes /
   future work" calls for this as a separate cleanup; out of scope here.
5. **Cross-installation federation (`70e233946` ADR-111 phases 4-6)** —
   standing rule per ADR-0187 declines all ADR-111 SHAs.
6. **ruv-FANN dormancy** — fork has been dormant since 2026-02-09; this
   sync only takes the 2 security commits, no broader catch-up.

## Open questions

1. Does ADR-128 Phase 1's 29-skill set overlap with plugins that the fork
   already has? If yes, Phase 5 smoke will catch it; resolution is to
   delete the duplicate from cli/.claude/skills/ (favor plugin per
   ADR-128's policy).
2. Does ruvector cluster `38105cf89` (route tracing to stderr) require
   a corresponding ruflo-side change? Probably not — fork's ADR-0226
   already handles the ruflo side; ruvector's change is internal to
   mcp-brain-server.
3. Are any of ruflo's ~263 backlog commits tightly coupled to upstream
   ADR-128 (e.g. dependent fixes that won't apply standalone)? Will
   surface during Batch S triage.

## More information

* **ADR-0186** — predecessor (v2; landed 12 picks 2026-05-18)
* **ADR-0162** — predecessor (v1; May 9-10 ~280-commit sync)
* **ADR-0204** — May-21 stray pick (`d065b2d65` → `241435e4d`)
* **INTEGRATION-LEDGER.md** — the cumulative source of truth; this ADR
  is responsible for appending its rows on close-out
* **Upstream ADR-128** at `https://github.com/ruvnet/ruflo/blob/main/v3/docs/adr/ADR-128-init-bundle-reduce-refactor.md`
  (or local mirror at upstream commit `166ee7f25`)
* **Memory references**:
  - `feedback-update-integration-ledger.md`
  - `feedback-never-touch-hz-remote.md`
  - `feedback-trunk-only-fork-development.md`
  - `feedback-no-history-squash.md`
  - `feedback-no-fallbacks.md`
  - `feedback-upstream-means-upstream.md`
  - `feedback-no-time-estimates.md`

## State schema (close-out fill-in)

```yaml
state_schema_version: 2
adr: 0228
opened: 2026-05-23
closed: (pending)

forks:
  ruflo:
    upstream_head_at_open: b5cd79c26
    fork_head_at_open: d54e7d600
    raw_cherry_count: 347
    auto_skip_estimate: 84
    triage_estimate: 263
    landed: (pending)
    skipped: (pending)
    retargeted: (pending)
  agentic-flow:
    upstream_head_at_open: 6a06854
    fork_head_at_open: ed77824
    raw_cherry_count: 30
    auto_skip_estimate: 0
    triage_estimate: ~3 net new + 27 already-retargeted-verify
    landed: (pending)
  ruvector:
    upstream_head_at_open: eafba64fa
    fork_head_at_open: 678114a6e
    raw_cherry_count: 114
    auto_skip_estimate: ~5
    triage_estimate: ~109
    landed: (pending)
  agentdb:
    upstream_head_at_open: 1776223
    fork_head_at_open: a16b375
    raw_cherry_count: 3
    auto_skip_estimate: 0
    triage_estimate: 3
    landed: (pending)
  ruv-FANN:
    upstream_head_at_open: 1d93b35
    fork_head_at_open: 8ac3a38
    raw_cherry_count: 2
    auto_skip_estimate: 0
    triage_estimate: 2
    landed: (pending)

decision_points:
  DP-1: take-upstream-canonical
  DP-2: take-upstream-opt-in-defaults
  DP-3: take-upstream-mark-fork-superseded-if-overlap
  DP-4: pick-if-conflict-free-else-skip-mechanical
  DP-5: verify-retargets-classify-net-new

confirmation_status:
  batch_L_security: pending
  batch_M_adr128: pending
  batch_N_ruvector_recent: pending
  batch_O_ruvector_older: pending
  batch_P_agentic_flow: pending
  batch_Q_agentdb: pending
  batch_R_ruv_FANN: pending
  batch_S_ruflo_backlog: pending
  batch_T_cleanup_ledger: pending
  build_green: pending
  forks_pushed_sparkling: pending
```
