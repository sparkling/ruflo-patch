# Council re-validation — handover (resume at ADR-0215)

Re-validating the ADR-0201 remediation batch (ADR-0208 → 0227), one ADR at a time. **COMPLETE (2026-05-22): 0208–0227 all re-validated.** 0208–0214 in a prior pass; 0215–0218 via the 6-expert + queen dialectic council (this session); **0219–0227 via queen-direct review** — the user dropped the swarm/dialectic mid-batch ("ignore any swarm instructions… and decide yourself"), so from 0219 on the reviewer verified each ADR's claims directly against live code/upstream and folded corrections in without a council. Per-ADR syntheses are in memory namespace `adr-batch-review` (`adr-NNNN-synthesis`); each ADR file carries a `Second council re-validation (2026-05-22)` block (0215–0218) or a `Direct review (2026-05-22)` note (0219–0227).

## The method (per ADR)

1. Read the ADR fully.
2. Spawn **6 experts in parallel** (`Agent` tool, `run_in_background: true`, all in one message), each with a falsifiable, claim-by-claim mandate. **Verify against real code/upstream/ADRs — do not rubber-stamp** (these ADRs already record a prior 05-20 review; the job is to re-check it).
3. Wait for all 6 (no polling). Adjudicate conflicts as queen.
4. Edit the ADR: fold in corrections + append a `### Second council re-validation (2026-05-22)` subsection (under Swarm review evidence, before More Information).
5. Validate (`grep` required sections nested, key fixes present), store a one-paragraph synthesis to memory, mark the task done, advance.

### The 6 expert lenses

- **Code archaeologist** (`code-analyzer`) — verify every fork file:line citation; line numbers drift, grep for symbols.
- **Upstream analyst** (`researcher`) — verify upstream claims/issues; is the divergence justified? is the defect fork-introduced vs upstream-inherited?
- **Corpus analyst** (`adr-architect`) — verify sibling-ADR + audit representations; depends-on/supersession correctness.
- **Template auditor** (`reviewer`) — MADR conformance + internal contradictions (esp. stale text surviving the 2nd-pass).
- **Feasibility expert** (`system-architect`) — is the spec buildable? orphans, test breakage, gate placement, stale-dist trap.
- **Devil's advocate** (`analyst`) — attack the chosen option; steelman the rejected ones; honest net verdict + conditions.

## State (resume points)

- **Task board:** tasks #8–#20 = ADRs 0215–0227 (`TaskList`).
- **Memory namespace `adr-batch-review`:** `batch-shared-context` (paths/traps) + `adr-NNNN-synthesis` (per done ADR). Each expert reads `batch-shared-context`; findings stored under `adr-NNNN-review`.
- **Edits:** in the ADR files (`docs/adr/ADR-02NN-*.md`), each with a `Second council re-validation (2026-05-22)` block.

## Reusable shared context (paths + traps)

- Fork root: ADR `forks/ruflo/...` paths resolve under `/Users/henrik/source/` (i.e. `/Users/henrik/source/forks/ruflo/...`, `/Users/henrik/source/forks/agentdb/...`). `ruflo-patch` has no `forks/` subdir.
- Upstream: `/Users/henrik/source/ruvnet/{ruflo,agentdb}`; upstream ADRs at `ruvnet/ruflo/v3/implementation/adrs/`. Issues via `gh -R ruvnet/ruflo` (fallback `-R ruvnet/claude-flow`).
- Audit: `docs/audits/2026-05-19-soundness-audit/` (findings `F-XX-YYY`). Template: `~/.claude/skills/adr-create/SKILL.md`.
- Traps: line numbers drift ~10-30 (sibling code landed 05-21 — esp. ADR-0202's per-op-lock); `ADR-050`/`ADR-053` in these ADRs mean **upstream** docs, not the fork-local `0050`/`0053`; gates/lints must read the **codemod-built/installed dist**, not the gitignored fork-root dist; `## Swarm review evidence` + `swarm-reviewed` tag + ADR-refs-in-tags are established cohort conventions.

## Recurring findings to check on every ADR

- **`## Consequences` should be nested `### Consequences`** under Decision Outcome (cohort defect — hit 0208/0212/0213; 0209/0210/0211/0214 were clean).
- **`depends-on` should be bare-number** `[0201]`, not `[ADR-0201]` (0211/0216 are known prefixed outliers).
- **"owned by sibling ADR" punts** — verify the named owner actually exists/owns it and isn't closed (0214's `GUIDANCE_*` punted to ADRs that never owned it).
- **"upstream-inherited" vs fork-introduced** — pickaxe upstream; several "upstream" claims are fork-authored.
- **ADR-0202 is now `implemented` (2026-05-21)** — any "accepted but unimplemented" / F-13-001-lifelong-lock framing is stale (see 0207/0211).
- Stale "~N tools/vars" counts re-listed from the first pass (0213/0214).

## Remaining queue (0215–0227) with hints

- **0215** `codemod-golden-master-test`
- **0216** `skills-surface-cli-and-dedupe-policy` — depends-on likely prefixed-form outlier; check.
- **0217** `implement-full-quic-synchronization-architecture` — **wholesale supersession** of 0205/0206 (so `supersedes: [0205, 0206]` + those carry `status: superseded by ADR-0217` — the one wholesale case, contrast with the clause-level pattern).
- **0218** `restore-worker-dispatch-queue-producer` — **depends-on 0207** (after 0207 deletes the socket, the file-poll queue is the sole channel; 0218 restores its missing producer). Tightly coupled to 0207's queen findings.
- **0219** `memory-controllers-fail-loud-on-recordoutcome-and-consolidate`
- **0220** `learning-controllers-honesty-pass`
- **0221** `graphdatabaseadapter-surface-corrupt-db-errors`
- **0222** `delete-dead-services-federated-learning` — check the "deprecated controllers" memory: only `federatedSession`/`federatedLearningManager` are deletable; keep `graphAdapter`/`learningBridge`.
- **0223** `init-mcp-commands-canonicalize-to-ruflo-wrapper` — overlaps 0213's F-11-001 fold + 0212's wrapper brand; coordinate.
- **0224** `config-defaults-skew-and-substrate-zod-bypass` — sibling of 0214 (F-14-014 Zod bypass / F-14-015 NaN); shares the config surface.
- **0225** `sequence-build-before-test-ci`
- **0226** `mcp-stdio-frames-raw-stdout`
- **0227** `recalibrate-adaptive-similarity-threshold-for-mpnet` — already shipped per memory (floor 0.3→0.15, fork `16d7c87cd`, patch.259); verify the ADR matches the shipped change.
