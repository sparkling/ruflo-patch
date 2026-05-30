---
status: accepted
date: 2026-04-26
tags: [readme, forks, packaging, documentation]
supersedes: []
depends-on: []
implements: []
---

# Fork README Update Program — Delta Prelude per Fork

## Context and Problem Statement

The four forks ship as `@sparkleideas/*` packages. End users who land on the GitHub repo see upstream READMEs that:

- Don't mention the `@sparkleideas` scope at all
- Reference upstream install commands (`npx @claude-flow/cli`, `npm i claude-flow`) that no longer publish
- Don't explain why someone would use the fork over the upstream npm packages
- Have URLs pointing at `github.com/ruvnet/claude-flow` (now redirected to `ruvnet/ruflo`)

Per CLAUDE.md, the default scope of all our work is the **repackaged published version**. The forks' READMEs are user-facing surface for that product and currently contradict the install story we ship.

### Inventory (verified 2026-04-26)

| Fork | README size | Tagline | Build branch (verify before commit) |
|---|---|---|---|
| `ruflo` | 7541 lines | "RuFlo v3.5: Enterprise AI Orchestration Platform" | `main` (per memory `reference-fork-workflow`, may differ) |
| `ruvector` | 5484 lines | "Self-Learning, Vector Memory & Agentic Operating System" | `main` |
| `agentic-flow` | 1925 lines | "Agentic-Flow v2" | `main` |
| `ruv-FANN` | 196 lines | "The Neural Intelligence Framework" | `main` |

All four have `sparkling` remote configured. No fork's README currently mentions `@sparkleideas`, the patch model, or the cross-package version pinning that defines our value-add over installing from npm directly.

### Why this matters now

- Pipeline publishes `@sparkleideas/*` to real npm (61+ revisions of `@sparkleideas/cli`)
- Users discovering us via npm hit the GitHub repo and see no install path that matches what's published
- Stale `ruvnet/claude-flow` URLs in fork READMEs (verified by ADR-0101 discovery agents — see ADR-0101-companion findings) need updating to `ruvnet/ruflo`
- Memory `feedback-patches-in-fork` requires bug-fix patches to live in the forks; users need to know where to file issues — currently ambiguous

## Considered Options

* **1. Delta prelude, not wholesale rewrite** (chosen) — prepend a `@sparkleideas`-specific prelude section to each existing README, keeping upstream content intact.
* **B. Wholesale rewrite** — Rejected: ~15K lines of upstream content to replace; most is still accurate; loses upstream maintainers' voice and deep technical sections we can't easily recreate; creates merge friction every time we sync upstream; no user benefit beyond what a prelude provides.

## Decision Outcome

Chosen option: "Delta prelude, not wholesale rewrite", because most upstream content is still accurate and a self-contained prepended prelude is low-risk, reversible, survives upstream sync, and delivers the user-facing install story (`@sparkleideas` scope, patch model, version pinning) without the merge friction or voice-loss of a 15K-line rewrite.

### 1. Approach: delta prelude, not wholesale rewrite

For each fork, **prepend a `@sparkleideas`-specific prelude section** to the existing README. Keep the rest of the upstream content intact. Prelude covers (template, per-fork variations expected):

1. **What this is** — "This is the `@sparkleideas` patched fork of `<upstream>`. We rebuild from upstream HEAD with pinned cross-package versions and apply layered bug-fix patches."
2. **Install** — `npm i @sparkleideas/<pkg>` with the actual current version
3. **What's different vs upstream** — short bullet list (built from HEAD not stale tags, all 41 packages pinned together with `-patch.N` refs, layered fixes)
4. **Where to file issues** — fork-specific guidance (upstream bug → ruvnet, packaging/patch issue → sparkling)
5. **Link to `ruflo-patch`** — for contributors / pipeline curiosity
6. **Pointer to "for upstream README, see below"** — explicit handoff to inherited content

**Rejected: wholesale rewrite (Option B).**
- ~15K lines of upstream content to replace; most is still accurate
- Loses upstream maintainers' voice and deep technical sections we can't easily recreate
- Creates merge friction every time we sync upstream
- No user benefit beyond what a prelude provides

### 2. Per-fork sub-scope (initial estimates, refined after discovery)

| Fork | Effort | Special considerations |
|---|---|---|
| `ruflo` | Heaviest prelude (~300–400 lines). Most user-facing CLI surface. Needs migration guide from upstream `@claude-flow/cli` install commands. URL fix-up of `ruvnet/claude-flow` badges (~15–20 hits per ADR-0101 discovery). | Deepest patch surface; mention which patches we currently apply. |
| `agentic-flow` | Medium prelude (~150–250 lines). | Foundation library per ADR-001; explain its relationship to `ruflo`. |
| `ruvector` | Medium prelude (~150–250 lines). | Vector memory engine; lots of independent install paths. |
| `ruv-FANN` | Light prelude (~50–100 lines) OR a one-paragraph note. **Pending user decision** — small patch surface may not warrant full template. | Smallest README, possibly minimal divergence from upstream. |

### 3. Discovery work required before drafting

For each of the 4 forks, in parallel (4 agents):

1. **Patch delta** — `git -C <fork> log <upstream-merge-base>..HEAD --oneline --stat`, distinguish codemod-generated changes (scope rename) from real patches.
2. **Package map** — which `@sparkleideas/*` packages publish from this fork, cross-referenced with `config/publish-levels.json`.
3. **Current README TOC + first 100 lines** — so the prelude lands cleanly without contradicting what follows.
4. **Stale-URL inventory** — `github.com/ruvnet/claude-flow` references that need updating to `ruvnet/ruflo` (some may stay technical; per ADR-0101 discovery already partially mapped).
5. **Install commands currently shown** — every `npx @claude-flow/*` and `npm i claude-flow` example that needs a `@sparkleideas/*` variant.

Output: a per-fork "prelude brief" the drafting step consumes.

### 4. Drafting + commit workflow

1. Discovery agents produce per-fork briefs (this ADR's first deliverable).
2. User confirms prelude template + per-fork special-handling decisions.
3. Drafting happens **on the fork's `main`** (the only branch — fork work is trunk-based per memory `feedback-trunk-only-fork-development`).
4. Push to `sparkling` remote (NOT `origin` which is read-only ruvnet) per memory `reference-fork-workflow`.
5. Verify rendered output on the fork's GitHub UI (not just diff inspection).

### 5. Per-fork work breakdown

Each fork's work splits into **Discovery → Draft → Review → Commit**. Discovery items are read-only; drafting begins after user confirms the open decisions; review verifies acceptance criteria; commit lands on the fork's build branch and pushes to `sparkling`. Dependencies marked in brackets.

#### Fork A: `ruflo` (heaviest — main user-facing CLI)

**Discovery**
- A.D1: `git log <upstream-merge-base>..HEAD --oneline --stat` to inventory real patches vs codemod-generated noise
- A.D2: Cross-ref `ruflo-patch/config/publish-levels.json` to list all `@sparkleideas/*` packages publishing from this fork (likely all 41+ at the highest level + `@sparkleideas/cli`, `@sparkleideas/claude-flow`, etc.)
- A.D3: Section map of current `README.md` (7541 lines) — extract H1/H2 + line ranges; identify where the prelude lands without contradicting downstream content
- A.D4: Inventory of `github.com/ruvnet/claude-flow` URLs (badges, links inside technical sections — ~15–20 hits per ADR-0101 discovery; classify as fix-now vs upstream-content)
- A.D5: Inventory of stale install commands: `npx @claude-flow/cli@latest`, `npm i claude-flow`, `npx claude-flow@v3alpha` — each needs a `@sparkleideas/*` equivalent
- A.D6: List all binary names exposed (`ruflo`, `claude-flow`, `npx ...`) — confirm what users actually type
- A.D7: Identify if `CLAUDE.md` (root) has overlap with `README.md` prelude content (avoid duplication; CLAUDE.md is contributor-facing, README is user-facing)

**Draft** (~300–400 lines, prepended to `README.md`)
- A.DR1: Banner + tagline (positioned BEFORE existing "🌊 RuFlo v3.5" banner)
- A.DR2: "What this is" — `@sparkleideas` patched fork; rebuilt from upstream HEAD; layered bug-fix patches
- A.DR3: Install table (npm `@sparkleideas/cli`, `@sparkleideas/ruflo`, `@sparkleideas/claude-flow`; current version inserted at draft time)
- A.DR4: "What's different vs upstream" bullet list (HEAD not stale tags; pinned 41-package release; layered patches; current MCP server name)
- A.DR5: Migration block — old `npx @claude-flow/cli@latest` ↔ new `npx @sparkleideas/cli@latest`; equivalent CLI flags; equivalent MCP `claude mcp add` command
- A.DR6: Issue-filing decision tree (upstream bug → `ruvnet/ruflo`; packaging/patch issue → `sparkling/ruflo` or `ruflo-patch`)
- A.DR7: "For pipeline/contributor docs see `ruflo-patch`" pointer
- A.DR8: Bulk URL fix-up per stale-URL policy (decision §Open §4)

**Review / Commit**
- A.R1: No `npx @claude-flow/cli` or `npm i claude-flow` in prelude (acceptance criterion)
- A.R2: Stale URLs handled per policy
- A.R3: Verify build branch + `sparkling` remote (memory `feedback-fork-commits`)
- A.R4: Render-check on `sparkling/ruflo` GitHub UI before promoting ADR to Implemented

#### Fork B: `agentic-flow` (medium — foundation library, ADR-001)

**Discovery**
- B.D1–B.D5: same template as A.D1–A.D5
- B.D6: Clarify which `@sparkleideas/agentic-flow` versions and ADR-001 status — the prelude must explain that this is the foundation `@sparkleideas/cli` builds on, not a parallel CLI
- B.D7: Note any `litellm`/provider docs that reference upstream package names

**Draft** (~150–250 lines)
- B.DR1: Banner + tagline
- B.DR2: "What this is" + ADR-001 relationship to `@sparkleideas/cli`
- B.DR3: Install (`npm i @sparkleideas/agentic-flow`)
- B.DR4: Different vs upstream
- B.DR5: Brief migration block (smaller surface than A)
- B.DR6: Issue-filing
- B.DR7: Link to `ruflo-patch` + ADR-001 reference

**Review / Commit**: same template as A.R1–A.R4.

#### Fork C: `ruvector` (medium — vector memory engine)

**Discovery**
- C.D1–C.D5: same template
- C.D6: Map the **multiple install paths** (the README shows ~5 distinct ones: interactive installer, attention module, coherence engine, with-GPU, etc.) — every one needs a `@sparkleideas` equivalent or migration note

**Draft** (~150–250 lines)
- C.DR1–C.DR7: same template as B; emphasis on the install-path multiplicity in C.DR3
- C.DR8: Note compression/performance claims that reference `@sparkleideas` package versions specifically (vs vague upstream version refs)

**Review / Commit**: same template.

#### Fork D: `ruv-FANN` (lightest — neural intelligence framework)

**Pending user decision §Open §2**: full prelude or one-paragraph note?

**If full prelude (~50–100 lines)**: same template as B/C, scaled down.

**If one-paragraph note**:
- D.DR1: Single paragraph at top of `README.md`: "This is the `@sparkleideas` patched fork of `ruv-FANN`. Install via `npm i @sparkleideas/ruv-fann` (or whichever package name applies — confirm via D.D2). For the upstream README, see below. Issues: <fork-specific guidance>."
- D.DR2: URL fix-up per stale-URL policy (likely small surface — 196-line README)

**Review / Commit**: same template, lighter render-check.

#### Cross-fork sequencing

1. Run **all 4 discovery agent groups in parallel** (one agent per fork; each does that fork's D1–D7).
2. After discovery, **user confirms decisions §Open §1–§5** with discovery data in hand.
3. Drafting can run **in parallel per fork** once decisions are locked (4 parallel drafting agents).
4. Review and commit happen **per fork sequentially** (one PR at a time so we can correct prelude template based on first PR's review feedback before propagating to later forks).
5. Promote this ADR from **Proposed → In Progress** when first fork's drafting begins; **In Progress → Implemented** when all 4 PRs merged and verified.

### Consequences

**Pros**
* Good, because it is low-risk, incremental, reversible.
* Good, because it preserves upstream maintainers' content and voice.
* Good, because it survives upstream sync (prelude is a self-contained block).
* Good, because each fork's PR is independently reviewable.
* Good, because of clear acceptance criteria: prelude renders correctly on GitHub, install commands work, issue-filing guidance matches reality.

**Cons**
* Bad, because of slight duplication if upstream eventually adds similar packaging notes.
* Bad, because it doesn't address potentially stale upstream content (out of scope by design).
* Bad, because there are four separate fork PRs to coordinate.
* Bad, because the prelude length on `ruflo` (~300 lines on top of 7541) makes the README quite long.

### Confirmation

#### Acceptance criteria (per fork)

- [ ] Prelude added at top of `README.md`, before any upstream content
- [ ] First install command shown is `@sparkleideas/<pkg>` with current version
- [ ] At least one paragraph explaining "what's different vs upstream"
- [ ] Issue-filing guidance present (which repo for which kind of bug)
- [ ] Link to `ruflo-patch` repo for pipeline/contributors
- [ ] No `npx @claude-flow/cli` or `npm i claude-flow` install command appears in the prelude (upstream-section examples may stay)
- [ ] `ruvnet/claude-flow` GitHub URLs updated to `ruvnet/ruflo` per stale-URL policy (decision §Open §4)
- [ ] Rendered output verified on `sparkling/<fork>` GitHub UI before promotion to Implemented

## Open Decisions — RESOLVED 2026-05-29 (user, see ADR-0270)

All five answered; this ADR is no longer blocked on user input. Re-scope note:
the upstream README rewrite (ruflo 7541→408 lines, `9250df2df`) shrank the job
dramatically — the prelude + ~6 stale-URL fixes are now comfortably one commit.

1. **Audience priority** → **end-user installer.** The prelude leads with "what
   this is + how to install `@sparkleideas/ruflo`", not a migration narrative.
2. **`ruv-FANN` scope** → **one-paragraph "this is the sparkling fork of
   ruvnet/ruv-FANN" note** (it's the lowest-level Rust crate, ~196-line README,
   never installed directly by end-users). Full prelude on the other 4.
3. **Migration guide depth** → **a migration pointer in every user-facing fork**
   (ruflo, agentdb, ruvector, agentic-flow) — not ruflo-only.
4. **Stale-URL policy** → **fix all 6** (`ruvnet/claude-flow`: ruflo 3, ruvector 2,
   agentic-flow 1), **split-by-purpose**: attribution / "forked from" links →
   `ruvnet/ruflo`; badges + issue/support links → the sparkling fork repo.
5. **ADR structure** → **single ADR-0101** for the whole program (no per-fork
   sub-ADRs — the re-scoped work is too small to warrant them).

**Status:** **IMPLEMENTED 2026-05-29** — prelude + note + migration pointers + 6
URL fixes landed across all 5 forks (commit SHAs in the top marker).

## Status transitions

- **Proposed** (2026-04-26, current) — planning, awaiting user decisions §Open
- **In Progress** — when discovery agents complete and drafting begins on at least one fork
- **Implemented** — when all 4 fork PRs merged and READMEs verified live on `sparkling/<fork>`

## More Information

Status: IMPLEMENTED 2026-05-29 (see ADR-0270). All 5 §Open Decisions were answered by the user (installer-audience; ruv-FANN one-paragraph note; migration pointer in every user-facing fork; fix all 6 stale URLs split-by-purpose; single ADR), then shipped the same day across all 5 forks: installer prelude + migration pointer + forked-from attribution on the 4 user-facing READMEs (`@sparkleideas/{ruflo,agentdb,ruvector,agentic-flow}`), a one-paragraph fork-identity note on `ruv-FANN`, and all 6 stale `ruvnet/claude-flow` URLs repointed to the sparkling fork (split-by-purpose). Fork commits: ruflo `106d6cc6b`, agentdb `ed23fc6`, ruvector `28a2669ec`, agentic-flow `814d319d`, ruv-FANN `f9494d2`. Re-scoped small after the upstream README rewrite (ruflo 7541→408 lines). The original pre-implementation status was "Proposed 2026-04-26 — planning phase, several decisions deferred to user." Dated 2026-04-26.

Scope: update `README.md` in each of the 4 forks (`forks/ruflo`, `forks/agentic-flow`, `forks/ruv-FANN`, `forks/ruvector`) to reflect that they ship as `@sparkleideas/*` packages built from upstream HEAD with pinned cross-package deps. Not in scope: rewriting upstream content, modifying ADRs, the `ruflo-patch` repo's own `README.md`.

The original record cross-referenced these related decisions: ADR-0027 (fork model — `@claude-flow/*` → `@sparkleideas/*`); memory `reference-fork-workflow` (build branches, push to `sparkling`); and memory `feedback-fork-commits` (verify branch + remote before push).
