# 2026-05-25 — INTEGRATION-LEDGER misc skip-mechanical + reverted audit

## Verdict

2-DISCREPANCIES — 6 of 7 entries verified; Batch S 9-SHA roll-up has 2 concerns
(unenumerated SHA set + fork-side lockfile drift the "rerere" claim glosses).

## Per-entry findings

### Batch S 9-SHA "empty-picks (rerere'd)"   [ledger line 165]

Row text: "ADR-122/agent-browser lockfile refreshes + rerere'd duplicates" /
"9 cherry-picks reported empty (content already applied via rerere cache from
prior conflict resolutions)."

The ledger does NOT enumerate the 9 SHAs — they live in the background agent
output (task abe01952896821c2a) and the ledger row is a roll-up. Per the prompt,
sample 3 best-match candidates from upstream `ruvnet/ruflo` Batch S window
(2026-05-18..05-22).

The 4 most likely candidates by subject match ("ADR-122 — refresh ... lockfile" /
"browser rvf smoke"):

| Upstream SHA | Subject | Files touched | Lines |
|---|---|---|---|
| `87f2a26cd` | chore(deps): ADR-122 — refresh v3/pnpm-lock.yaml for agent-browser 0.27 | `v3/pnpm-lock.yaml` | +151 / -592 |
| `338f7320a` | chore(deps): ADR-122 — refresh root package-lock for agent-browser 0.27 bump | `package-lock.json` | +261 / -85 |
| `62aa08f49` | ci: ADR-122 — browser rvf smoke uses pnpm (workspace:* protocol) | `.github/workflows/v3-ci.yml` | (workflow tweak) |
| `cc007d952` | ci: ADR-122 — make browser rvf smoke tolerant of missing dist | `.github/workflows/v3-ci.yml`, `scripts/smoke-browser-rvf-create-flags.mjs` | +16 / -5 |

Plus likely the merge `0ddf1dfa` (PR #2043 merge of `feat/adr-122-browser-beyond-sota`).
That's 5 of 9; the remaining 4 are plausibly other merge commits or ADR-123 doc
duplicates, but cannot be confirmed without the background agent log.

**Sampled 3 explicitly:**

#### Sample #1 — `87f2a26cd` (v3/pnpm-lock.yaml refresh)
- Touches only `v3/pnpm-lock.yaml` (+151 / -592)
- Upstream regenerates pnpm lockfile after agent-browser ^0.6.0 → ^0.27.0 bump
- Fork DOES have `v3/pnpm-lock.yaml` and DOES use `pnpm install --frozen-lockfile`
  in 10+ CI jobs (`forks/ruflo/.github/workflows/v3-ci.yml:217,252,286,330,404,...`)
- Fork's current `v3/pnpm-lock.yaml` HEAD content still pins
  `agent-browser version: 0.6.0` while `v3/@claude-flow/browser/package.json`
  declares `^0.27.0` (verified by `git show main:v3/pnpm-lock.yaml | grep agent-browser`).
- **Same goes for `v3/package-lock.json` line 834: also pins `"agent-browser": "^0.6.0"`**
- **The "empty / already applied" claim does NOT hold** — the fork has real
  lockfile drift that this upstream commit was specifically targeting.

#### Sample #2 — `338f7320a` (root package-lock.json refresh)
- Touches only `package-lock.json` at upstream root (+261 / -85)
- Fork's root `package-lock.json` exists but is structurally different from
  upstream's at-root file (fork has different scope of deps). Without a deeper
  fork-vs-upstream root-lockfile compare, the empty-fix claim is plausible
  but the rationale isn't "rerere'd" — it's "fork uses different lockfile
  layout / different root deps."

#### Sample #3 — `cc007d952` (CI: browser rvf smoke tolerant of missing dist)
- Touches `.github/workflows/v3-ci.yml` + `scripts/smoke-browser-rvf-create-flags.mjs`
- Workflow change adds `continue-on-error: true` on a build step + switches
  to pnpm + `--frozen-lockfile`. Script makes `/dist/` scan skip rather than fail.
- Fork's `v3-ci.yml` is heavily diverged (fork has 1400+ lines, fork-specific jobs).
- Picking this would have substantive content but the divergence may make it
  "already applied" by virtue of fork having its own equivalent guard. Without
  diffing the affected smoke script in both, cannot definitively confirm.

**rerere-claim assessment:**
- The fork DOES have a populated rerere cache (`forks/ruflo/.git/rr-cache/`
  has 100+ recorded resolutions), so the "rerere replay" mechanism is in active use.
- rerere is "reuse recorded resolution" — it does NOT silently swallow conflicts;
  it replays a previously-recorded fixup. The replayed result is still committed.
- However, framing 4 lockfile/CI commits as "rerere'd duplicates" is misleading.
  The actual reason most/all of these would be empty is:
  (a) upstream's pnpm-lock refresh targets a file the fork hasn't kept synced
      anyway (fork's v3/pnpm-lock.yaml still has agent-browser 0.6.0);
  (b) upstream's CI tweaks target workflow files the fork has already heavily diverged from;
  (c) the ADR-122 PR merge `0ddf1dfa` is empty by construction when all
      its parents' content has been picked.
- The genuine concern: by labeling as "skip-mechanical", the audit dropped a
  signal that the fork still needs to either regenerate its lockfiles OR remove
  pnpm/npm-frozen-lockfile gates from CI for the agent-browser dep change.

### agentic-flow `62e4961` subsumed-by `7c6d510`   [ledger line 227]

Row text: "Merge PR #148 release/merge-adr-071-wasm | skip-mechanical | — |
content subsumed by 7c6d510"

`62e4961` and the upstream content-merge `e60a5ba` (which is what `7c6d510`
hand-ported) touch IDENTICAL file lists.

Verification:
- `git diff --name-only 62e4961^1..62e4961 | sort` → 72 files
- `git diff --name-only e60a5ba^1..e60a5ba | sort` → 72 files
- `diff /tmp/62e4961.files /tmp/e60a5ba.files` → empty (no differences)
- Both: 18,117 insertions / 426 deletions

`62e4961` is the GitHub PR-merge wrapper of `e60a5ba` (which is itself the
chore-merge of feature/adr-071-wasm-integration into main). The fork's
`7c6d510` is recorded in the row above (line 226) as the hand-port of `e60a5ba`.
Picking `62e4961` would therefore be a no-op — same content path.

**Claim holds.** Disposition `skip-mechanical / subsumed by 7c6d510` correct.

### Batch N 4-SHA "CI retrigger"   [ledger line 310]

Row text: "ci: retrigger/kick stuck CI jobs | skip-mechanical | empty-fix
CI re-trigger commits"

Identified the 4 SHAs from `ruvnet/RuVector` (2026-05-22 window):
- `ad27f854` — "ci: retrigger CI after Actions runner fix"
- `f1204835` — "ci: retrigger CI with cleared queue"
- `1d7d22ee` — "ci: kick stuck queued jobs after binary commit"
- `fc62a9f0` — "ci: retrigger CI after binary update afab7f13"

Sampled all 4 via `git show --stat`:
- `ad27f854`: empty diff (no `---`/`+++` blocks, no `Notes:` header beyond
  Co-Authored-By trailer)
- `f1204835`: empty diff
- `1d7d22ee`: empty diff
- `fc62a9f0`: empty diff

All 4 are genuine empty-commits (no file changes). Their entire purpose is
to push a new SHA so GitHub Actions reruns workflows that were stuck/cancelled.

**Claim holds.** Disposition correct.

### Batch N 1-SHA "router 0.1.31 revert"   [ledger line 313]

Row text: "chore: revert router 0.1.31 bump from this PR | skip-mechanical |
revert of a version bump within an upstream PR; not applicable to fork chain"

Identified SHA: `be91ddf0` (in `ruvnet/RuVector`).

`git show --stat be91ddf0`:
- 6 files modified, all under `npm/packages/router*/package.json`
- Total: +11 / -11 lines (1:1 ratio — pure version revert 0.1.31 → 0.1.30)
- Files: `router/`, `router-darwin-arm64/`, `router-darwin-x64/`,
  `router-linux-arm64-gnu/`, `router-linux-x64-gnu/`, `router-win32-x64-msvc/`
- Commit body confirms the revert is itself reverted in the follow-up release PR

Fork has its own independent `-patch.N` chain on `npm/packages/router*`
(Batch J standing rule). An upstream PR-internal revert of a PR-internal bump
truly is not applicable.

**Claim holds.** Date on the ledger says "2026-05-22" but `be91ddf0` is dated
2026-05-18; minor date discrepancy but immaterial to the disposition.

### Batch N 2-SHA "postgres Cargo.lock + diskann README"   [ledger line 314]

Row text: "chore(postgres) regenerate Cargo.lock / chore(diskann) README sync |
skip-mechanical | lockfile/README mechanics"

Identified SHAs:
- `076c4619` — "chore(postgres): regenerate ruvector-postgres Cargo.lock"
- `89350f80` — "chore(diskann): sync README + package.json to published 0.1.1"

`076c4619`:
- Touches ONLY `crates/ruvector-postgres/Cargo.lock` (+327 / -5156)
- Pure Cargo.lock regen. Lockfile mechanic. **Claim holds.**

`89350f80`:
- Touches `npm/packages/diskann/README.md` (+137 / -20) AND
  `npm/packages/diskann/package.json` (+1 / -1; version 0.1.0 → 0.1.1)
- Per commit body: "expanded README and 0.1.1 version were already published
  to npm by an earlier release, but never committed back to git. Verified
  identical to `npm pack @ruvector/diskann@0.1.1`."
- The package.json touch is a 1-char version sync to match what's already on npm.
  No functional code change. **Claim mostly holds**; ledger description
  "README sync" omits the version bump but the commit's intent is mechanical sync.

Date on ledger says "2026-05-22" but `89350f80` is dated 2026-05-18; minor.

### Batch N 2-SHA "rustfmt / cargo fmt"   [ledger line 315]

Row text: "style: rustfmt / cargo fmt touched blocks | skip-mechanical |
style-only churn; defer per DP-4"

Identified SHAs:
- `1d43f2c3` — "style: rustfmt embedder.rs (#487)"
- `b26001ad` — "style: cargo fmt --all on touched HNSW pruning block"

`1d43f2c3`:
- Touches ONLY `crates/mcp-brain-server/src/bin/embedder.rs`
- All hunks are pure formatting (argument wrapping, parenthesis placement).
  No logic change. Confirmed by diff inspection.

`b26001ad`:
- Touches ONLY `crates/ruvector-router-core/src/index.rs`
- 2 hunks both collapsing multi-line expressions to single lines.
  Logic preserved verbatim. Commit body: "No behaviour change."

Both are pure formatting commits, no logic alteration. **Claim holds.**

### Reverted row sanity check   [ledger line 117]

Row text: `5228ffc44` | security: convert session-state writes to writeFileRestricted (0600) — ADR-0188 Option 1 attempt | reverted | `634747deb` (revert), `5be65f3bf` (Option 2 doc note) | ADR-0188

Verified all three commits in `forks/ruflo`:
- `5228ffc44` (Henrik Pettersen, 2026-05-18 22:26): converts 2 TS-level writes
  in `hive-mind-session.ts` + `session.ts` to `writeFileRestricted`.
- `634747deb` (Henrik Pettersen, 2026-05-18 22:38): `Revert "5228ffc44..."`,
  exact revert (2 files, +2 / -7).
- `5be65f3bf` (Henrik Pettersen, 2026-05-18 22:39): docs(fs-secure) Option 2
  boundary note recorded in `fs-secure.ts` as code-adjacent rationale.

Chronology and disposition coherent. **Claim holds.**

Minor categorization note: `5228ffc44` is a FORK SHA (Henrik Pettersen author),
not an upstream pick, so its placement under the upstream cherry-pick table is
unusual — `fork-local-reverted` would be more accurate than `reverted`. Material?
No — the row's notes column already labels it "ADR-0188 Option 1 attempt; reverted".

## Discrepancies

### Discrepancy #1 (HIGH) — Batch S 9-SHA "rerere'd" claim glosses fork lockfile drift

The row note "content already applied via rerere cache from prior conflict
resolutions" is misleading for the 4 lockfile/CI commits that are likely in
the 9-SHA set:

- Fork's `v3/pnpm-lock.yaml` and `v3/package-lock.json` STILL pin
  `agent-browser ^0.6.0`, while `v3/@claude-flow/browser/package.json` declares
  `^0.27.0` (per `da6bcf6d3` Phase 0 hand-port).
- Fork uses `pnpm install --frozen-lockfile` in 10+ CI jobs against
  `v3/pnpm-lock.yaml`.
- That means upstream's `87f2a26cd` (and possibly `338f7320a`) regeneration
  was solving a real fork-applicable problem, not a no-op.
- The fact that fork CI is presumably green today suggests either
  (a) those jobs don't gate on the browser dep specifically, or
  (b) the fork hasn't run them post-Phase 0 against an environment that
  exercises agent-browser. Either way, "skip-mechanical / empty" understates
  the situation.

Recommended remediation: Add a follow-up entry (or amend row 165 in
`INTEGRATION-LEDGER.md`) noting that the fork still needs to either
regenerate `v3/pnpm-lock.yaml` + `v3/package-lock.json` for the agent-browser
^0.27.0 bump, OR explicitly accept the drift and document why CI doesn't break.

### Discrepancy #2 (LOW) — Batch S 9-SHA row doesn't enumerate the 9

The row text references "9 cherry-picks reported empty" but the SHAs live only
in the background agent task output (task `abe01952896821c2a`), not in the
ledger itself or in the audit-supporting docs. Per
`feedback-update-integration-ledger.md` ("every cherry-pick / hand-port / SKIP /
retarget decision MUST append a row to `docs/upstream/INTEGRATION-LEDGER.md` in
the same commit/PR"), roll-ups that hide concrete SHAs make future audits
harder. The 52-SHA NAPI roll-up (line 309) has the same shape but is reasonable
because the SHAs all share an identical mechanical pattern; here, mixing
"lockfile refresh", "CI workflow tweak", and "PR merge" semantics under one
roll-up obscures that one of them (lockfile) has a fork-applicable signal.

Recommended remediation: Either expand row 165 to list the 9 SHAs and per-SHA
disposition, OR add a separate "Batch S deferred follow-ups" row noting the
lockfile drift specifically.

## Other notes (non-discrepancies)

- Date in Batch N rows says "2026-05-22" but `be91ddf0`, `89350f80`,
  `b26001ad` are dated 2026-05-18. Immaterial — all fall within Batch N
  window (2026-05-18..05-23).
- Row 117 (`5228ffc44` reverted) is technically a fork-local SHA under the
  upstream cherry-pick table. Cosmetic only; the disposition is clear.
