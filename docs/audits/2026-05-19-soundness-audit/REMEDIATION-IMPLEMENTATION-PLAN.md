# Swarm-based implementation plan — unimplemented ADRs 0204+

> Companion to [COUNCIL-REVALIDATION-PLAN.md](./COUNCIL-REVALIDATION-PLAN.md) and
> [COUNCIL-REVALIDATION-HANDOVER.md](./COUNCIL-REVALIDATION-HANDOVER.md). Those
> cover *review*; this covers *implementation*. Every ADR below was re-validated
> 2026-05-22 — **implement against the corrected Confirmation in each ADR file +
> its `adr-batch-review/adr-NNNN-synthesis` memory**, not the original draft.

## Scope

**18 unimplemented ADRs, all `status: proposed`: 0207–0224.**

Excluded: 0204 / 0225 / 0226 / 0227 (`implemented`), 0205 / 0206 (`superseded by
ADR-0217`). **External precondition:** **0202** (RVF per-op lock — the live
CRITICAL data-loss bug, <0204 so out of named scope) must land first; 0207 and
0218 explicitly sequence behind it.

## What actually constrains execution

Logical dependencies are nearly absent — `depends-on` is `[0201]` (the audit, a
doc) for most. The only hard intra-batch code dependency is **0218 → 0207**, plus
a soft **0216-after-0215** ordering. So 16 of 18 are logically parallelizable.

**The real constraint is fork file-contention.** Two repos are hot:

| Fork | ADRs touching it |
|---|---|
| `forks/agentdb` | 0217, 0219, 0220, 0221, 0222 |
| `forks/ruflo` | 0207, 0208, 0209, 0210, 0211, 0212, 0213, 0214, 0216, 0218, 0220(memory), 0222(registry), 0223, 0224 |
| `forks/agentic-flow` | 0217 (`@internal` consumer), 0220 (sona) |
| `ruflo-patch` | 0215 gate, 0216 acceptance, 0218 test (harness only) |

Concurrent agents editing the same fork worktree collide. The plan groups ADRs
into **work packages with disjoint file surfaces**, runs each in an **isolated
git worktree** (`Agent` tool `isolation: "worktree"`), and has the queen merge
per fork in a conflict-minimizing order. This respects [[feedback-trunk-only-fork-development]]
(ephemeral worktree branches must fast-forward into `main` the same cycle),
[[feedback-no-history-squash]] (careful merge, no squash), and
[[feedback-commit-forks-before-release]] (commit before `npm run release`).

## Work packages

Grouped by fork (the contention axis) then disjoint surface. Each package = one
worktree-isolated implementer.

### forks/agentdb (3 packages)

| Pkg | ADRs | Surface (files) | Notes |
|---|---|---|---|
| **A1 · controllers-fail-loud** | 0219, 0221 | `controllers/ReasoningBank.ts`, `controllers/MemoryConsolidation.ts`, `backends/graph/GraphDatabaseAdapter.ts` | Disjoint files; shared fail-loud discipline (mirror ADR-0210). **0221 trap:** the outer catch (`:148`) must pass `GraphDatabaseCorruptError` through (re-validation finding). |
| **A2 · learning-honesty** | 0220 | `controllers/NightlyLearner.ts`, `controllers/LearningSystem.ts`, `services/SonaTrajectoryService.ts` (+ `forks/ruflo` `memory/learning-bridge.ts`, + `agentic-flow` sona) | **`discoverCausalEdges` returns a count, not an array** — F-05-001/024 fixes need a return-shape change (re-validation). EWC++ per-call (F-05-007) is a *separate future ADR* — honesty-doc only here. |
| **A3 · federation-cleanup** | 0217, 0222 | `controllers/SyncCoordinator.ts`, `types/quic.ts`, `src/index.ts`, delete `QUIC{ConnectionPool,StreamManager}.ts`; `services/federated-learning.ts` (delete) + `forks/ruflo` `memory/controller-registry.ts` (registry refs) | **0217 build-break trap:** `@internal` the live `VectorClock`/`incrementVectorClock`/`createVectorClock` (agentic-flow autopilot consumes them) — do **NOT** remove from exports. 0222: delete is confirmed-safe (call-graph trace = dead). Both touch `index.ts` → coordinate. |

### forks/ruflo (5 packages)

| Pkg | ADRs | Surface (files) | Notes |
|---|---|---|---|
| **R1 · daemon-dispatch** | 0207 → 0218 | `services/` daemon + `DaemonIPCServer` (delete), `mcp-tools/hooks-tools.ts`, `services/worker-daemon.ts` (+ `ruflo-patch` test) | **Ordered: 0207 removes the socket, then 0218 restores the producer.** Both behind 0202. 0218: port the producer using `findProjectRoot()` (not `getProjectCwd()`); `validateText` is a ~2-line wire of an existing util (re-validation). |
| **R2 · init-brand** | 0212, 0213, 0223 | `init/mcp-generator.ts`, `init/claudemd-generator.ts`, `commands/init.ts`, `package.json` bin | 0223 marketplace source = **`sparkling/ruflo`** (resolved). All three share the init-emission surface → sequence within the package. |
| **R3 · config** | 0214, 0224 | `shared/src/core/config/`, `init/config-template.ts`, + the **~17 substrate packages** (memory/plugins/integration/aidefence/cli/hooks/neural/embeddings) | **Largest package** (0224's 17-pkg accessor refactor). Arch-test must NOT honour an `adr-0100-allow` escape for `config.json` raw-parse (re-validation). |
| **R4 · skills** | 0215 → 0216 | `.agents/skills/**/SKILL.md` (revert), `commands/` skill-list CLI + `init/executor.ts`; `ruflo-patch` `tests/pipeline/` gate + `lib/acceptance-*` | **Ordered: 0215 source fix before 0216's gate.** 0215 gate = whole-file scan on the **general `\$<word>\$<word>` signature (74 files)**, not the 9-token alternation (re-validation). 0216: pin the SKILLS_MAP name-set + whitelist `dual-mode/`. |
| **R5 · hooks-cli-honesty** | 0208, 0209, 0210, 0211 | CLI flag parsing (`allowUnknownFlags`), `hooks/`, `mcp-tools/` stubs, `.agents/` adversarial hook handlers | 0208 lint-first then flip; 0209 arch-test + runtime smoke; 0210 per-handler implement/restore/delete/mark; 0211 implement-or-trim. Shared CLI/hooks surface → sequence within. |

`forks/agentic-flow` and `ruflo-patch` edits are folded into the owning package
(A2/A3 for agentic-flow; R1/R4 for ruflo-patch harness).

## Cross-fork build order (non-negotiable)

`agentic-flow` and `ruflo` consume `agentdb` as a **published package**
(Verdaccio). So agentdb changes (A1–A3) must be **built + published before**
agentic-flow/ruflo rebuild against them — critically for A3's `@internal`
VectorClock retention (removing it breaks the agentic-flow build). The canonical
`npm run release` rebuilds forks in dependency order (agentdb → agentic-flow →
ruflo) from committed state, so the integration wave drives it; do not hand-build
out of order. (Build after every fork change per [[feedback-build-after-change]];
the ADR-0225 build-before-test sequencing is already in the pipeline.)

## Execution waves

- **Wave 0 — precondition.** Land **0202** (RVF lock). Not in 204+ scope but
  gates 0207/0218 and frees the "after the live CRITICAL" sequencing the batch
  defers behind it.
- **Wave 1 — parallel implementation.** Spawn the 8 package agents
  (`isolation: "worktree"`, `run_in_background: true`) — agentdb and ruflo
  packages run fully in parallel (separate repos); within each fork the worktrees
  isolate file surfaces. Each agent: implement its ADR(s) to their **corrected
  Confirmation**, build its fork in-worktree, run the ADR's unit tests, report.
- **Wave 1.5 — per-ADR validation gate (independent).** For each package, spawn
  a *different* agent (not the implementer) to validate the worktree against the
  **Validation** section below — the completeness matrix + the soundness checks,
  including the **mutation check**. **A package does not merge until its
  validation passes.** A failed validation goes back to the implementer with the
  specific gap, never forward as a partial merge.
- **Wave 2 — per-fork integration.** Queen merges the *validated* worktrees into
  each fork's `main` (no squash). Merge order to minimize conflict: **agentdb**
  A1 → A2 → A3 (A3 owns the `index.ts` export edits, land last); **ruflo** R3 →
  R1 → R5 → R2 → R4 (config + daemon most separable; init-emission-heavy R2/R4
  last). Build + run each fork's `test:unit`/pipeline after each merge; a merge
  that breaks a sibling package's test reopens validation for both.
- **Wave 3 — release + per-ADR completeness audit.** Commit all forks → `npm run
  release` (rebuilds in dep order, publishes to Verdaccio, runs acceptance). Then
  a final **per-ADR audit against the *installed* artifact** (fresh init'd
  project, never dev `node_modules` — [[feedback-inspect-installed-not-dev-nodemodules]]):
  every ADR's Confirmation green; every new acceptance check present in **both**
  `run_check_bg` **and** the `collect_parallel` spec (else it runs but is
  silently uncounted — [[reference-acceptance-runcheck-vs-collect]]); zero
  failures ([[feedback-fix-all-tests]]); no `skip_accepted` dodging a real fix
  ([[feedback-skip-accepted-as-squelch]]). Append an INTEGRATION-LEDGER row for
  each upstream-derived change (0216 #1834/#1836, 0218 #1845, 0222 deletion) per
  [[feedback-update-integration-ledger]].

## Per-package agent spec

Each Wave-1 agent gets:

- **Type:** `coder` (or `ruflo-agentdb:agentdb-specialist` for A1–A3,
  `ruflo-rag-memory:memory-specialist` for A2). `isolation: "worktree"`.
- **Mandate:** "Implement ADR-NNNN to its `### Confirmation`. Read the ADR's
  `Second council re-validation` / `Direct review` block and
  `adr-batch-review/adr-NNNN-synthesis` first — the original draft has known
  errors the re-validation corrected (cited per package above). Build the fork;
  run the ADR's unit tests in-worktree; do NOT run `npm run release` (the queen
  integrates). Report files changed + test results."
- **Success = the ADR's Confirmation**, which the re-validation already made
  testable (e.g. 0215 deliberate-reintroduction fails the gate; 0218 e2e queue
  dispatch with fake timers; 0221 corrupt-file throws `GraphDatabaseCorruptError`;
  0224 invalid config.json throws via the accessor + arch-test green).
- **Stop condition:** tests green in-worktree, or escalate to queen on a
  cross-package/cross-fork conflict (don't reach into another package's files).

## Validation — sound + complete per ADR

Implementation is **not done when code is written** — it is done when an
*independent* validator (not the implementer) confirms the change is both
**complete** (the whole ADR is implemented) and **sound** (it works, doesn't
regress, and the tests actually prove it). Both axes are required; both gate the
merge.

### Completeness — the whole decision, not a slice

The recurring failure mode this whole batch exists to fix is the *partial*
implementation (ADR-0218 is literally "consumer landed, producer didn't"). So
completeness is a **matrix, not a vibe**: enumerate every sub-item of the ADR's
Decision Outcome **and** every bullet of its Confirmation, and map each to
concrete evidence (file:line of the change + the test that exercises it). Any
unmapped item = incomplete = no merge. Specifically watch for:

- multi-fix ADRs where only a subset shipped — 0219 (3 fixes), 0220 (8
  dispositions), 0223 (4 fixes), 0224 (3 changes incl. the 17-package migration:
  **all 17**, not 12).
- decision sub-items with no corresponding test.
- `TODO`/stub/`_note` markers left where the ADR said *implement* — the exact
  thing ADR-0210/0220 forbid.
- the cross-fork / ledger half — e.g. the 0216/0218/0222 INTEGRATION-LEDGER rows;
  0222's registry-reference cleanup, not just the file delete; 0217's
  agentic-flow `@internal` consumer, not just the agentdb edit.

### Soundness — it works, and the test proves it

- **Tests green AND non-vacuous.** The validator runs a **mutation check**:
  deliberately reintroduce the defect (revert the one-line fix / re-add the
  swallowed `catch` / put `$dev$null` back) and confirm the test goes **red**. A
  test that stays green under the reintroduced bug is theatre — the exact
  golden-master-pins-corruption trap 0215 rejected. Discard the mutation after.
- **Against the installed artifact, not dev `node_modules`** — verify in a fresh
  `ruflo init` project / the acceptance temp dir
  ([[feedback-inspect-installed-not-dev-nodemodules]]).
- **No reintroduced fallback** — the fix must *fail loud*; a `catch` that logs
  and continues, or a default that masks the error, fails soundness
  ([[feedback-no-fallbacks]]).
- **Full suite, zero failures** — not just the new test; the whole fork
  `test:unit` + acceptance. Never dismiss a failure as pre-existing
  ([[feedback-fix-all-tests]]); if ≥2 related checks fail, trace before
  hypothesizing ([[feedback-trace-before-hypothesis]]). Capture full output to a
  log and grep the log, never tail ([[feedback-full-test-output]]).
- **The check is actually counted** — present in both `run_check_bg` and the
  `collect_parallel` spec, or it runs and is silently uncounted
  ([[reference-acceptance-runcheck-vs-collect]]).

### Who validates, and the per-ADR record

Independent validator agent per package at **Wave 1.5** (reviews the worktree
read-only against the matrix + runs the mutation check); then the **queen's
Wave-3 audit** re-checks every ADR against the *published* build. Independence is
the point — the implementer's "done" is a hypothesis; the validator's mutation
check + completeness matrix is the proof. This mirrors the review dialectic,
applied to code instead of ADR text. Record each ADR's result to memory
`adr-batch-impl/adr-NNNN-validation` (completeness matrix + soundness verdict +
mutation-check evidence), so "is it really done?" is answerable without re-deriving.

## Risk register

- **Fork contention** → worktrees + queen merge order (above). The mitigation is
  the whole point of the package boundaries; agents must not edit outside their
  surface.
- **0217 export removal breaks agentic-flow** → A3 must `@internal` (not remove)
  the VectorClock family. Highest-severity trap; called out in the package + the
  ADR.
- **0224 is the biggest package** (17-pkg refactor) → can split the substrate
  migration from the accessor+arch-test if it stalls; the arch-test must land
  with the migration so "17 → 18" can't regress.
- **Cross-fork publish ordering** → driven by `npm run release`, never hand-built.
- **0202 precondition** external → if 0202 slips, 0207/0218 (R1) can still land
  the honesty half (the `queued`-lie fix is 0207-independent), but R1's full
  value waits on 0202.
- **Acceptance vs dev node_modules** → always a fresh init'd project, never
  `./node_modules/@sparkleideas/*` ([[feedback-inspect-installed-not-dev-nodemodules]]).

## References

- Per-ADR corrected specs: each ADR file's `Second council re-validation
  (2026-05-22)` (0215–0218) or `Direct review (2026-05-22)` (0219–0227) block.
- Per-ADR synthesis: memory namespace `adr-batch-review` (`adr-NNNN-synthesis`).
- Sequencing memory: [[project-adr0201-remediation-impl-order]].
- Pipeline: [[reference-pipeline-publish-paths]] (single entrypoint `npm run
  release`), [[reference-fork-workflow]] (4 forks, push to `sparkling`).
