---
status: proposed
date: 2026-05-23
methodology: [MADR, retrospective, decision-narrative]
decision-makers: [Henrik Pettersen]
tags: [wave-3, sequencing, upstream-sync, adr-128, retrospective, no-fallbacks, misdiagnosis-correction]
depends-on: [0095, 0186, 0228]
related: [0088, 0143, 0162, 0187, 0203, 0204, 0207, 0208, 0209, 0210, 0211, 0212, 0213, 0214, 0215, 0216, 0217, 0218, 0219, 0220, 0221, 0222, 0223, 0224]
audience: ai-executor
---

# ADR-0229: Upstream refresh precedes Wave 3 finalization (catch-discrimination cascade close-out)

> **Decision narrative**: a chain of work starting with `feedback-no-fallbacks`
> driven catch-discrimination changes surfaced 9 acceptance failures, one
> attempted fix (bundling 39 skills into `cli/.claude/skills/`) was caught
> by the user as architecturally wrong, the investigation that followed
> located upstream ADR-128 (Init Bundle Reduce and Refactor, May 21
> 2026) as the proper resolution mechanism, and the conclusion is to
> sequence the upstream refresh (ADR-0228) BEFORE Move A (Wave 3
> finalization of the 0207-0224 batch). This ADR captures the chain, the
> correction, the discovery, and the resulting sequencing decision.

## Amendment 2026-05-23: Move C (ADR-0230 substrate re-convergence) slotted between Move B and Move A

The Move B (upstream sync, ADR-0228) → Move A (Wave 3 finalization) sequencing decision stands. Adding a third move discovered mid-execution while triaging ADR-0228 Batch S:

**Move C (NEW): substrate re-convergence per ADR-0230** — slot between Move B's close and Move A's start.

Discovery path: per-commit reading of upstream ADR-125 Phases 1-7 revealed upstream is now fixing several bugs that motivated fork-side substrate workarounds (HNSW persistence stubs, FTS5 fallback gap, ruvector.db leak, HybridBackend silent downgrade). The Batch S deferral disposition for the 5 ADR-125 phases was reversed; per ADR-0230 they re-disposition as `take-verbatim` (Phases 1/3/5/6/7) + `adapt` (Phases 2/4). The Archivist layer (ADR-0180/0181) stays fork-original above MCP; the substrate layer re-converges below MCP.

This does NOT change Move B → Move A sequencing. ADR-0230 is a sibling architectural decision born from the Batch S triage; its execution slots BEFORE Move A because Wave 3 finalization (the 0207-0224 ADR audit) needs the substrate to be stable.

Revised sequence:

| Move | Goal | Status (2026-05-23) |
|---|---|---|
| Move B (ADR-0228) | Upstream fork sync — Batches L through T | In progress — 113 picks landed across 4 batches; Batch S partial; Batch T pending |
| **Move C (ADR-0230)** | **Substrate re-convergence with upstream ADR-125** | **Proposed 2026-05-23 — 5 execution phases per the new ADR** |
| Move A (per `docs/audits/2026-05-19-soundness-audit/REMEDIATION-IMPLEMENTATION-HANDOVER.md`) | Wave 3 finalization — flip 0207-0224 from `proposed` → `implemented` | Pending — gated on ADR-0228 + ADR-0230 close |

Per Lesson 4 of this ADR (*"Sync ADR before audit ADR"*): the substrate re-convergence ADR (ADR-0230) is itself a sync ADR in spirit. Slotting it before Move A respects that lesson — re-converging substrate FIRST, auditing ADR fulfillment SECOND.

The "fail fast and fail loud, not fall back" user directive that opened this session continues to govern ADR-0230's execution: each phase passes `npm run release` end-to-end before the next begins; no half-deferred substrate state.

Additional user directive 2026-05-23 (during ADR-0230 framing discussion): *"pass all acceptance tests, no skips beyond the original 9"* — raises the acceptance hard gate from `≤ baseline (9)` to `= 0 fail, skip_accepted ≤ 10`. This applies to both ADR-0228 (Batch T close-out) and ADR-0230 (per-phase exit gates). Two existing acceptance failures (`adr0104-meta-preserved`, `e2e-0059-p4-socket-exists`) are now in scope (not deferred); see session-handover 2026-05-24 for assignment.

## Context and Problem Statement

The 0207-0224 ADR batch landed in source via prior sessions (per
`docs/audits/2026-05-19-soundness-audit/REMEDIATION-IMPLEMENTATION-HANDOVER.md`).
Wave 3 was the `npm run release` cascade — build, publish to Verdaccio,
run the full acceptance suite. The handover documented two pre-existing
concurrency test failures (`adr0090-a4-rvf-concurrent`,
`adr0154-cross-process-concurrent`) as blockers; this session opened with
the user asking me to investigate.

### The catch-discrimination cascade

The investigation followed this chain:

1. **Concurrency tests diagnosed**: traced via test instrumentation. Root
   cause was NOT a concurrency bug. Both failing tests had writer
   subprocesses silently falling back to pure-TS because
   `@ruvector/rvf-node` (native binding) wasn't resolvable from the
   subprocess module path. Pure-TS writes to `.meta` (legacy sidecar);
   `.rvf` was never created; `existsSync(rvfPath)` failed three phases
   downstream of the silent fallback, producing a confusing assertion
   mismatch.

2. **User directive — fail-loud**: "we should also fail fast and fail
   loud, not fall back" (and again: "dont do this:
   `RUFLO_ALLOW_PURE_TS_FALLBACK`. Just fail loud"). The catch in
   `tryNativeInit` that returned `false` on `MODULE_NOT_FOUND` and on
   cold-start `ENOENT` was inverted to throw unconditionally. Landed as
   `forks/ruflo@68efd1551` (the rvf-backend.ts changes) + ADR-0095
   amendment in `ruflo-patch@6c62f59`.

3. **`undiscriminating-catches` gate aborted release**: a pre-build lint
   in the release pipeline (`scripts/check-undiscriminating-catches.mjs`)
   detected 6 comment-only `catch {}` blocks in fork source —
   `hooks-tools.ts:1792/1888/1919/2627/2647` and `skill.ts:79`. User
   directive: "fix". All 6 catches were re-shaped with explicit
   discrimination (`if (err?.code !== 'ENOENT') console.warn(...)`),
   landed as `forks/ruflo@c9fe34312`.

4. **Release ran further; hit 9 acceptance failures**: 678/697 passed.
   The 9 failures broke into 4 classes:
   - 2 false positives from documentary comments in dist files
     (`adr0084-p3-hooks` + `adr0084-p4-zero-ext`)
   - 3 CLI surface gaps (`adr0143-init-mcp` needed `--yes`, two
     `adr0104` checks tied to `--command` / spawn short-flag drift)
   - 2 skill-related (`adr0216-corpus-shape` + `adr0216-cli-surface`)
   - 1 ADR-0100 grep gate against `skill.ts:110`
   - 1 daemon socket race (`e2e-0059-p4-socket-exists`)

### The misguided fix and the correction

For the 2 adr0216 failures (skills not emitted by `init --full`), I
diagnosed the cause as the cli package shipping 0 skills despite
`SKILLS_MAP` listing 39 names. My attempted fix was to copy 39 skill
directories from the fork's root `.claude/skills/` into
`forks/ruflo/v3/@claude-flow/cli/.claude/skills/`, mirroring the existing
`.claude/agents/` + `.claude/commands/` pattern. This landed as fork
commit `d7f28d139` ("fix(cli): add --yes/-y to init, anchor skill.ts on
findProjectRoot, bundle 39 skills in cli pkg").

**The user stopped this**: *"why are you adding skills in .claude? Are
they not now handled by plugins?"* and then *"Find upstream recent ADRs
on the plugin refactor. Plugins now installs skills as part of its
install"*.

Investigation that followed:

- **Upstream ADR-128 (May 21 2026)** — *"Init Bundle Reduce and Refactor:
  Skill Source-of-Truth, Plugin Deduplication Policy, and Optional Agent
  Categories"* — explicitly sets the policy: cli ships 29 specific core
  skills (`SKILLS_MAP.core/.agentdb/.github/.v3`); plugins own the other
  10 categories (`flowNexus`, `browser`, `dualMode`, `jujutsu`,
  `hiveMind`, `performance`, `workers`).
- ADR-128 Phase 5 (`9a66b2996`) adds a CI invariant
  `smoke-init-bundle-invariants.mjs` with the rule *"no plugin-init
  overlap"* — exactly what my 39-skill bundle would have violated.
- The fork hadn't integrated ADR-128 (or its 4 sibling phases). Last
  upstream merge was via ADR-0186 on 2026-05-18; ADR-128 landed upstream
  3 days after.
- The misguided commit `d7f28d139` was reverted as `d54e7d600`
  (`revert(cli): remove misguided .claude/skills/ bundle (ADR-128
  violation)`). The independent fixes from `d7f28d139` (the `--yes` flag
  + `findProjectRoot` substitution in `skill.ts`) were preserved because
  they were correct in isolation.

### What the correction revealed

The user's framing forced a re-read of the existing `INTEGRATION-LEDGER`
discipline and the standing-rule architecture:

- The fork had been carrying a 5-day-old upstream gap (May 18 → May 23).
- Inside that gap: ADR-128 (5 phases + doc) AND 10 security CVE patches
  across all 5 forks (May 23 security wave) AND ~83 ruvector substrate
  fixes (CypherEngine multi-row MATCH, ONNX wasm bundle, MCP stdio
  hygiene, supply-chain CI hardening, etc.).
- `findSourceDir` in the fork's `executor.ts:2189` had a 4-tier walk-up
  fallback that found skills on the maintainer's dogfood machine
  (`~/.claude/skills/`) but NOT in `/tmp/ruflo-accept-*/` CI runs. This
  is what ADR-128 §Gap 1 explicitly calls out: *"on the maintainer's
  machine this walk eventually reaches `~/.claude/skills/`; on any other
  machine, or in CI, it finds nothing and `copySkills()` emits a silent
  error."*
- adr0216 acceptance check was added by the R4 batch on a dogfood box
  where init "worked" — it was never green in CI. Per
  `feedback-inspect-installed-not-dev-nodemodules` this is exactly the
  failure mode the rule was authored to prevent.

So the misguided fix was masking a deeper architectural drift; the
correction surfaced ADR-128 as the canonical resolution path; ADR-128
sits inside an upstream gap that wants a proper sync; therefore the next
move is an upstream refresh (ADR-0228) BEFORE finalizing Wave 3.

## Decision Drivers

* **User directive 2026-05-23** (recorded verbatim above): plugins own
  skills; do not patch the symptom by bundling — discover the proper
  mechanism.
* **`feedback-no-fallbacks`**: the misguided bundle was the wrong shape
  *also* because Phase 5's invariant catches it as `no plugin-init
  overlap`. Converging with upstream's policy beats a fork-only patch.
* **`feedback-inspect-installed-not-dev-nodemodules`**: the dogfood path
  was already documented as a known-bad evaluation pattern. The lesson
  was already in memory; the work pattern violated it; the user surfaced
  the violation.
* **`feedback-trace-before-hypothesis`**: the prior agent's handover
  diagnosed adr0090/0154 as "deep concurrency"; the actual cause was a
  silent fallback three phases downstream. Trace identified the real
  root cause without a hypothesis-then-fix cycle. (Same lesson applied
  here when the bundle attempt was caught: the user's question forced a
  re-trace that surfaced ADR-128.)
* **`feedback-update-integration-ledger`**: every upstream pick/skip
  needs a ledger row. A 5-day gap means a sync ADR + per-SHA dispositions
  — exactly what ADR-0228 provides.
* **Wave 3 finalization integrity**: per the original handover, status
  flips (proposed → implemented) for ADRs 0207-0224 are the close-out
  step. Doing this BEFORE an upstream refresh would lock in a pre-sync
  baseline that the upcoming sync will mutate. Doing it AFTER closes
  the batch against a post-sync state that's likely more durable.

## Considered Options

* **Option A — Finalize Wave 3 first, sync later**: Move A first (per-ADR
  audit + ledger verify + memory-namespace record + status flips for
  0207-0224), THEN ADR-0228 sync. The original "Move A first"
  recommendation.
* **Option B — Sync first, finalize Wave 3 against post-sync state**:
  Execute ADR-0228 (security + ADR-128 + ruvector cluster + ruflo
  backlog), THEN finalize Wave 3 with the broader upstream context
  available. Status flips happen against the post-sync source.
* **Option C — Interleave**: Land security (Batch L) + ADR-128 (Batch M)
  ONLY from ADR-0228, then finalize Wave 3, then resume the remaining
  ADR-0228 batches (N-S).

## Decision Outcome

Chosen option: **Option B — Sync first, finalize Wave 3 against
post-sync state**, reversing the recommendation in the original
"what's next" framing of this session.

Rationale:

1. **adr0216 is unfixable pre-sync.** Wave 3 audit step 3 says "Per-ADR
   audit against the INSTALLED artifact" — every ADR's Confirmation items
   green. ADR-0215/0216 are part of the 0207-0224 batch and their
   confirmation includes the corpus-shape + cli-surface checks that the
   misguided-fix-was-an-attempt-to-resolve. Without ADR-128 Phase 1,
   those checks cannot reach their 38-floor in CI. Status flip for
   ADR-0216 would be flipping against a known-broken acceptance state.
2. **Security CVEs are non-deferrable.** Batch L (10 commits) ships
   shell-injection, SSRF, NaN-panic, SQL injection, JSON.parse crash,
   protobufjs + otel CVE fixes. Sitting on these across all 5 forks
   while we finalize a batch of older work is the wrong priority order.
3. **The ledger discipline is easier post-sync.** Per ADR-0228's
   "How to update INTEGRATION-LEDGER.md" section, every disposition gets
   a row. Doing ADR-0228 first means Wave 3's ledger-verify step
   operates against a current ledger state, not a 5-day-stale one.
4. **The catch-discrimination cascade is already in source.** The
   `forks/ruflo@68efd1551` (fail-loud `tryNativeInit`), `c9fe34312`
   (6 catches discriminated), `d54e7d600` (revert misguided skill
   bundle), plus the ruflo-patch ledger amendment to ADR-0095 — these
   are already committed. They survive the upstream refresh because
   they don't touch ADR-128's files; merge-time conflicts will be
   isolated.

The earlier in-session recommendation ("Move A first, then Move B")
was made before ADR-0228 was drafted and before the adr0216 → ADR-128
dependency was made explicit. This ADR supersedes that recommendation.

## What's next — sequencing

### Step 1: ADR-0228 execution (Move B — now first)

Execute ADR-0228 batches in this order:

1. **Batch L (security CVEs, all forks)** — 10 commits. Priority 1.
   Land before any other batch. Update ledger.
2. **Batch M (ADR-128 phases 1-5 + doc)** — ruflo only. Cherry-pick `-x`
   in upstream order. Resolve Phase 1 conflict against our skills
   revert state by taking upstream verbatim per ADR-0228 DP-1. Update
   ledger.
3. **Build verify** — `npm run release` to confirm Batch L+M didn't
   regress unit tests or pre-build gates. Acceptance should now hit
   adr0216 with 29 skills emitted; verify the 38-floor is reachable
   (the gap of 9 between 29 and 38 may be covered by plugins per
   ADR-128's policy or may require a harness-side plugin-install step
   to fill).
4. **Batch N (ruvector recent ~83 commits)** — May 18-22 cluster.
   Cherry-pick in chronological order; skip-mechanical for style-only
   commits per DP-4. Update ledger.
5. **Batches O-R (ruvector older + per-fork security verification)** —
   resolve remaining sync.
6. **Batch S (ruflo backlog ~263)** — largest unknown. Triage in
   ~20-30 commit cycles with build-verify between. Update ledger per
   cycle.
7. **Batch T (cleanup + ledger close-out summary block)** — append the
   per-fork totals matrix; flip ADR-0228 to `implemented`.

### Step 2: Wave 3 finalization (Move A — now second, post-sync)

After ADR-0228 closes, run the original handover Wave 3 audit checklist
against the post-sync state:

1. **Per-ADR audit** (handover step 3) — for each of ADRs 0207-0224,
   verify the `### Confirmation` items green against a fresh `ruflo
   init` project in `/tmp/...`. Use the published `@sparkleideas/ruflo`
   from Verdaccio, NOT dev node_modules.
2. **Verify INTEGRATION-LEDGER rows** (handover step 4) — per the 8
   batches enumerated in the handover:
   - ADR-0212/0213/0223 (3 rows added during implementation)
   - ADR-0214/0224 (3 rows)
   - ADR-0215/0216 (2 rows)
   - ADR-0217/0222 (2 rows)
   - ADR-0218 (2 rows)
   - ADR-0219/0220/0221 (no rows — fork-originated, no upstream SHA)
3. **Record verdicts to AgentDB memory** (handover step 5) — namespace
   `adr-batch-impl/adr-NNNN-validation`. Each entry includes:
   - Completeness matrix (Confirmation items vs verified state)
   - Soundness verdict
   - Mutation-check evidence (per the validation pattern that worked,
     §"Validation pattern that worked" in the handover)
4. **Flip ADR statuses** (handover step 6) — ADRs 0207-0224 from
   `proposed` → `implemented`. Update the `Status` line in each ADR's
   frontmatter. Commit as a single ruflo-patch commit referencing
   ADR-0229 and the post-sync state.

### Step 3: Close-out

Once both Move B (ADR-0228) and Move A (Wave 3 finalization) close:

1. Flip ADR-0229 from `proposed` → `implemented`.
2. Update `MEMORY.md` index with any new pointers (the bundle-mistake
   lesson + the upstream-first sequencing rationale).
3. Final `npm run release` baseline run — capture the post-everything
   acceptance count for the next sync's preflight comparison.

## Lessons captured

1. **The dogfood trap is real.** `findSourceDir` walks 10 dirs up from
   `process.cwd()`; that found 39 skills at `~/.claude/skills/` on the
   maintainer's box and 0 anywhere else. The fix is bundle-in-package
   (ADR-128 Phase 1) — NOT walk-up-from-cwd. Memory:
   `feedback-inspect-installed-not-dev-nodemodules`.
2. **Symptom-patching is the failure mode.** My bundle attempt was a
   symptom-patch (39 skills missing? add 39 skills). The architectural
   answer (29 in cli, 10 in plugins) was already specified in upstream
   ADR-128. Always read the upstream-recent-ADRs before patching.
3. **The user's "are you doing X correctly?" question is a forced
   re-trace.** When the user challenged the bundle attempt, the next
   move was to investigate plugins, then upstream ADRs, then ADR-128.
   The challenge didn't say "do Y instead"; it said "are you sure".
   The right response was to verify the architecture, not defend the
   patch.
4. **Sync ADR before audit ADR.** Wave 3 finalization (status flips +
   audit + verdicts) operates on a baseline. If the baseline is
   stale-vs-upstream, the finalization is brittle. Sync first; audit
   against current state.
5. **Recover the cheap wins from the misguided commit.** Reverting
   `d7f28d139` whole-sale would have lost the `--yes` flag and the
   `findProjectRoot` substitution in `skill.ts`, both of which were
   independently correct. The revert commit `d54e7d600` was scoped to
   just the skills directory; the other two fixes survived. When a
   commit bundles correct + incorrect work, slice the revert.

## Confirmation

This ADR is closed when:

1. ADR-0228 status is `implemented` (all batches landed, ledger updated,
   close-out summary block appended).
2. All 18 ADRs 0207-0224 statuses are `implemented` (Wave 3 finalization
   completed against post-sync state).
3. AgentDB memory namespace `adr-batch-impl/adr-NNNN-validation` has 18
   entries (one per 0207-0224 ADR).
4. `MEMORY.md` index reflects any new lessons from this ADR.
5. Final `npm run release` baseline captured.

## Out of scope (deliberate)

1. **Re-litigating the catch-discrimination work** — the fail-loud
   throws in `tryNativeInit` and the 6 discriminated catches stand.
   They were correct in isolation and survive ADR-0228's churn.
2. **Re-adding skill bundling to the fork** — ADR-128 Phase 1 ships 29
   skills in upstream; we take upstream as canonical. No fork-local
   skill duplication.
3. **adr0104 `--consensus/--topology` spawn flags** — these were
   identified as missing CLI surface during this session but not
   resolved. They may be addressed by ADR-128 (Phase 3 changes init
   defaults; spawn surface may also be touched in the broader sync) or
   require a separate fix. Defer to ADR-0228 close-out; if still
   failing post-sync, file a follow-up.
4. **e2e-0059 daemon socket race** — pre-existing daemon infrastructure
   issue. Defer to a separate ADR after ADR-0228 closes.

## Cross-references

- **ADR-0228** — the upstream sync runbook (Move B)
- **ADR-0095 amendment 2026-05-23** — fail-loud `tryNativeInit` policy
  change (the catch-discrimination cascade's root commit)
- **`docs/audits/2026-05-19-soundness-audit/REMEDIATION-IMPLEMENTATION-HANDOVER.md`** —
  the Wave 3 handover that defines the finalization checklist (Move A)
- **`docs/upstream/INTEGRATION-LEDGER.md`** — the cumulative record
  ADR-0228 close-out updates
- **Fork commits in this session**:
  - `forks/ruflo@68efd1551` — fail-loud `tryNativeInit`
  - `forks/ruflo@c9fe34312` — 6 catch discriminations
  - `forks/ruflo@d7f28d139` — misguided skills bundle (reverted)
  - `forks/ruflo@d54e7d600` — skills bundle revert (kept the --yes +
    findProjectRoot half)
- **ruflo-patch commits in this session**:
  - `6c62f59` — ADR-0095 amendment (strict fail-loud)
  - `e5d1942` — acceptance gates (0084 comment-strip, 0104 short-flag)
  - `ef30301` + `3ce5e17` — ADR-0228 runbook + ledger-update procedure
- **Memory references**:
  - `feedback-no-fallbacks` (the directive that started the cascade)
  - `feedback-inspect-installed-not-dev-nodemodules` (the dogfood-trap
    rule the bundle attempt violated)
  - `feedback-trace-before-hypothesis` (the diagnostic discipline that
    located the silent-fallback)
  - `feedback-update-integration-ledger` (the discipline ADR-0228
    operationalizes)
  - `feedback-skip-accepted-as-squelch` (rule that constrained the
    diagnostic — no `skip_accepted` to dodge)
