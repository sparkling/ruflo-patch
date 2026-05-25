# 2026-05-25 — INTEGRATION-LEDGER version-bump roll-up audit

## Verdict

**3-CONTAIN-SUBSTANCE** (in the 18-SHA Batch J roll-up).

The Batch J 18-SHA roll-up (line ~123) silently bundles three non-pure
SHAs whose disposition the ledger does not surface:

1. `0c2b0c02f` — **witness manifest regen, not a version bump**
   (mis-categorized; belongs with the witness-manifest roll-up at line ~124).
2. `cffa55744` — **README plugin-links enhancement (107 insertions)** +
   3 OS-witness manifest regens (`verification/{linux,macos,windows}/manifest.md.json`),
   in addition to the version-bump payload.
3. `91657b9fc` — **`scripts/audit-fix-invariants.mjs` +77 lines (9 new CI guards)**,
   in addition to the version-bump payload.

The Batch M `1ce81a3e3`, Batch J `a075c59fc`, and all Batch N
version-/router-bump SHAs sampled are pure-mechanical and correctly
classified.

Skip-disposition outcome unchanged for `0c2b0c02f` (witness regens are
fork-superseded per the Batch J `verification.md.json` roll-up rule).
Skip-disposition partially correct for `cffa55744` and `91657b9fc`:
their version-bump fragment is mechanical, but the README and audit-script
fragments are real upstream content. Whether to port them is a downstream
question — but the ledger should not claim they are "release-noop."

---

## Per-SHA findings

### Batch J 18-SHA roll-up (line ~123) — sampled 18 of 18

Repository: `ruvnet/ruflo` @ HEAD `ef73a1616`.

Pure-version-bump if-and-only-if `git show --stat` lists only
`package.json`, `package-lock.json`, or `npm-shrinkwrap.json` siblings.

| SHA | Date | Subject | Files touched | Substance? | Verdict |
|---|---|---|---|---|---|
| `0c2b0c02f` | 2026-05-03 | chore(release): regen witness for 3.6.27 (Ollama provider fix) | `verification.md.json` (1 file, +10/-10) | YES — witness regen, NO package.json | **MIS-CATEGORIZED** (this is a witness regen, not a version bump; belongs in the next-row witness roll-up) |
| `c08ac2251` | 2026-05-10 | chore(release): 3.7.0-alpha.21 — ships #1883 + #1884 fixes | 3 × `package.json` + `package-lock.json` | NO | pure-version-bump |
| `e2bc6d9ce` | 2026-05-11 | chore(release): @claude-flow/swarm 3.0.0-alpha.7 — ADR-095 G2 consensus transport | `v3/@claude-flow/swarm/package.json` (1 file) | NO | pure-version-bump |
| `7415f83ad` | 2026-05-11 | chore(release): 3.7.0-alpha.22 — ADR-112 tool discoverability + #1889 + #1892 | 3 × `package.json` | NO | pure-version-bump |
| `5b36fe531` | 2026-05-11 | chore(release): 3.7.0-alpha.23 — ships #1863 + #1899 | 3 × `package.json` + `package-lock.json` | NO | pure-version-bump |
| `3c447854d` | 2026-05-11 | chore(release): 3.7.0-alpha.24 — ships #1906 agent_execute model-alias fix | 3 × `package.json` + `package-lock.json` | NO | pure-version-bump |
| `cffa55744` | 2026-05-12 | chore(release): 3.7.0-alpha.27 — ships managed_agent_* (ADR-115) + ruflo-wasm→ruflo-agent (#1934) | 3 × `package.json` **+ `ruflo/README.md` (+64/-64) + `v3/@claude-flow/cli/README.md` (+64/-64) + 3 OS-witness manifests (`verification/{linux,macos,windows}/manifest.md.json`) + `verification/macos/history.jsonl`** (9 files, 107 insertions, 106 deletions) | **YES** — `ruflo/README.md` plugin-link substantive enhancement (PR #1932 payload, adds clickable `[ruflo-core](plugins/ruflo-core/README.md)` markup across 27 plugin rows), bundled into the release commit. Also witness regen. | **MIXED-WITH-SUBSTANCE** — README plugin-links (PR #1932) is a real content enhancement; the ledger's "release-noop" claim is incorrect for this SHA. |
| `4d6e47d8a` | 2026-05-13 | chore(release): 3.7.0-alpha.28 — ships #1947 + #1944 + #1943 critical fixes | 3 × `package.json` | NO | pure-version-bump |
| `3c4638bb9` | 2026-05-13 | chore(release): 3.7.0-alpha.29 — ships #1945 + #1946 + #1951 critical fixes | 3 × `package.json` | NO | pure-version-bump |
| `3b14b7aa9` | 2026-05-13 | chore(release): 3.7.0-alpha.30 — ships #1953 + #1939 fixes | 3 × `package.json` | NO | pure-version-bump |
| `6f7d04d22` | 2026-05-13 | chore(release): 3.7.0-alpha.31 — ships #1941 + #1940 bridge fixes | 3 × `package.json` | NO | pure-version-bump |
| `0cdad108b` | 2026-05-13 | chore(release): 3.7.0-alpha.32 — ships #1947 RC2 fix | 3 × `package.json` | NO | pure-version-bump |
| `40e94434f` | 2026-05-13 | chore(release): 3.7.0-alpha.33 — 14 critical fixes since alpha.27 | 3 × `package.json` | NO | pure-version-bump |
| `c29ed9963` | 2026-05-13 | chore(release): 3.7.0-alpha.34 — ships #1968 fix + #1946/#1943/#1940 closeouts | 3 × `package.json` | NO | pure-version-bump |
| `4a19793e5` | 2026-05-14 | chore(release): 3.7.0-alpha.35 — ships #1974 mitigation | 3 × `package.json` | NO | pure-version-bump |
| `91657b9fc` | 2026-05-14 | chore(release): 3.7.0-alpha.36 — 10 fixes + audit guard update (#2001) | 3 × `package.json` **+ `scripts/audit-fix-invariants.mjs` (+77 lines, 9 new INVARIANTS entries)** (4 files, 80 insertions, 3 deletions) | **YES** — Adds 9 CI invariant checks for issues #1989, #1987, #1948, #1937, #1921, #1910, #1880, #1872, #1990 covering source-side fixes (statusline magic-bytes, page-count clamp, memory-stats persistent count, exclusion-patterns flag, otel pin, MCP stdio mode, scaleAgents target semantics, executeTask try/catch). | **MIXED-WITH-SUBSTANCE** — audit-fix-invariants.mjs adds 9 regression-guard invariants. Note: 8 of 9 invariants reference upstream fixes (#1987, #1937, #1921, #1910, #1880, #1872, #1990) that are NOT in the integration ledger — they were never picked into the fork. Even if the 77-line addition were ported, those 8 guards would assert on substring/regex patterns in files the fork doesn't have the fixes for. So skipping the substance has a defensible justification, just not the one the ledger gave. |
| `6e0ced793` | 2026-05-14 | chore(release): 3.7.0-alpha.37 — ADR-119 + ADR-120 + Step 2 loader (#2008) | 3 × `package.json` | NO | pure-version-bump |
| `29ea78f21` | 2026-05-14 | chore(release): 3.7.0-alpha.38 — ADR-120 Step 3 (Rust peer crate) + Step 2 path update (#2010) | 3 × `package.json` | NO | pure-version-bump |

**Sub-verdict:** 15 of 18 pure-version-bump. 1 of 18 mis-categorized
(witness regen, not version bump). 2 of 18 mixed-with-substance
(README plugin-links + 9 CI invariants).

### Batch J 1-SHA `a075c59fc` (line ~126)

Subject: `chore: bump versions for #1874 publish chain`
Date: 2026-05-09.
Files touched: 5 × `package.json` (`mcp` 3.0.0-alpha.8→.9; `shared`
3.0.0-alpha.7→.8; `cli`, `claude-flow`, `ruflo` 3.7.0-alpha.18→.19).
No source files. **PURE-VERSION-BUMP**. Disposition correct.

### Batch M `1ce81a3e3` (alpha.76 release — ADR-128, line ~146)

**HIGH-RISK SHA — full inspection performed:**

```
commit 1ce81a3e350bdff7d7955c45fb0d0fb3a6884920
Author: ruv <ruv@ruv.net>
Date:   Thu May 21 15:53:10 2026 -0400

    chore(release): publish 3.7.0-alpha.76 — ADR-128 init bundle reduce + refactor

 package.json                     | 2 +-
 ruflo/package.json               | 2 +-
 v3/@claude-flow/cli/package.json | 2 +-
 3 files changed, 3 insertions(+), 3 deletions(-)
```

**Verdict:** PURE-VERSION-BUMP. The ADR-128 substantive work
(skill bundling, agent removal, agents.all default flip, COMMANDS_MAP
restructure, smoke gates) lives in `166ee7f25`, `c63905e6a`,
`865c901af`, `34e7b1e9f`, `0740b2fa1`, and `9a66b2996` — all of which
ARE individually rowed in the ledger (lines ~140-145, cherry-picked or
hand-ported per ADR-0228). `1ce81a3e3` is genuinely just the release
publish-commit AFTER those phases landed. Disposition correct.

The "ADR-128 init bundle reduce + refactor" subject is descriptive of the
release contents, not of the commit's own diff. The strong suspicion was
warranted but unfounded in this case.

### Batch N (1) 2-SHA roll-up "chore: bump versions / release patch versions" (line ~311)

Repository: `ruvnet/RuVector`. Searching the 2026-05-{21..23} window for
the roll-up's two SHAs.

Candidates found:

```
ff50f5055 2026-05-22 chore(release): bump patch versions for TS bug-fix releases
           Files: npm/packages/{node,postgres-cli,ruvbot}/package.json (3 files, +3/-3)
c5c7e7f26 2026-05-18 chore(release): @ruvector/router 0.1.30 → 0.1.31
           Files: 6 × router-*/package.json
be91ddf0f 2026-05-18 chore: revert router 0.1.31 bump from this PR
           Files: 6 × router-*/package.json (same set, reverse direction)
```

`c5c7e7f26` and `be91ddf0f` are dated 2026-05-18, OUTSIDE the
"2026-05-22..05-23" window the ledger asserts for this 2-SHA roll-up.

**Most likely identification:**
- The "2 SHAs" claim covers `ff50f5055` (the `bump patch versions` SHA,
  in window) PLUS one other version-related SHA the ledger compressed
  without recording.
- Sister-row at line ~313 says "1 SHA chore: revert router 0.1.31 bump"
  matches `be91ddf0f` (2026-05-18).
- The pair `c5c7e7f26` (bump) + `be91ddf0f` (revert) was likely intended
  but the dates were mis-recorded as 5-22..23 instead of 5-18.

**Diff inspection:**

`ff50f5055`: 3 files touched, all `package.json`, +3/-3.
PURE-VERSION-BUMP. Bumps `@ruvector/node 0.1.23→0.1.24`,
`@ruvector/postgres-cli 0.2.7→0.2.9`, `ruvbot 0.3.1→0.3.2`. Body claims
the TS bug fixes are in earlier SHAs.

`c5c7e7f26`: 6 files touched, all `package.json`. Bumps
`@ruvector/router{,-darwin-arm64,-darwin-x64,-linux-arm64-gnu,-linux-x64-gnu,-win32-x64-msvc} 0.1.30→0.1.31`. PURE-VERSION-BUMP.

`be91ddf0f`: 6 files touched, same set as `c5c7e7f26`, reverse direction
(0.1.31→0.1.30). PURE-VERSION-BUMP (revert).

**Sub-verdict:** All 3 candidate SHAs PURE-VERSION-BUMP. Disposition
correct (skip-mechanical). Ledger date assertion "2026-05-22..05-23"
for the 2-SHA roll-up is inconsistent with the in-window
`ff50f5055`+1-other pairing — minor accuracy issue, not a substance
issue.

### Batch N (2) 1-SHA "chore: revert router 0.1.31 bump from this PR" (line ~313)

Identified as `be91ddf0f` (2026-05-18, RuVector). Already inspected
above. PURE-VERSION-BUMP (revert). Disposition correct.

---

## Recommended actions

### 1. Fix Batch J row-placement for `0c2b0c02f`

The ledger groups `0c2b0c02f` with the 18-SHA version-bump roll-up, but
its diff contains no `package.json` changes — only
`verification.md.json` (a witness regen). The very next row at line ~124
is the witness-manifest roll-up:

```
| `fdc00cce3` `f514495c8` `3c6d126b7` `9d43d8fdb` `3c0430b8b` `0666796a0` `f8ab5a325` `5b71c7ac1` |
2026-05-{03..16} | chore(verify)/feat(verification): witness manifest regenerations |
skip-by-policy | — | 0186 | Batch J — fork-local witness manifest …
```

`0c2b0c02f` belongs in that 8-SHA witness roll-up, making it a 9-SHA
roll-up. Skip-disposition unchanged either way.

**Action:** move `0c2b0c02f` out of the version-bump row (reducing it to
17 SHAs) and into the witness-manifest row (expanding to 9 SHAs).

### 2. Expand Batch J row for `cffa55744`

`cffa55744` bundles the `#1932 README plugin links` substantive
enhancement (107 line insertions across `ruflo/README.md` and
`v3/@claude-flow/cli/README.md`) into a release commit. The current
ledger row's "release-noop version-chain commits" disposition reason is
factually incorrect for this SHA.

**Action:** split `cffa55744` into its own row with disposition
`skip-by-policy` and cite ADR-0143 (sparkling brand kept). Confirm that
the plugin-link enhancement is not desired in fork READMEs (it adds
clickable links to upstream `plugins/ruflo-*/README.md` paths inside the
upstream tree, which under ADR-0143's brand-keep policy is editorial,
not branding). If desired in fork, port the diff and reclassify.

### 3. Expand Batch J row for `91657b9fc`

`91657b9fc` bundles 77 lines of new CI guards (9 new entries in
`scripts/audit-fix-invariants.mjs`) into a release commit. These guards
reference upstream fixes (#1989, #1987, #1948, #1937, #1921, #1910,
#1880, #1872, #1990); only 2 of 9 (#1989 at line 114, #1948 at line 115)
have corresponding individual ledger rows. The other 7 PRs are not
tracked in the ledger.

**Action:** split `91657b9fc` into its own row with disposition
`superseded-by-local` or `skip-by-policy` and cite a reason: the fork
does not ship `scripts/audit-fix-invariants.mjs` and the 7 untracked PRs
are not in the fork; the invariants would assert on substring/regex
patterns in files whose underlying fixes the fork does not carry. If any
of those 7 PRs SHOULD be in the fork, that's a separate gap to track.

### 4. Fix Batch N (1) date assertion

The 2-SHA roll-up at line ~311 asserts "2026-05-22..05-23" but the
likely SHA pair (`c5c7e7f26`+`be91ddf0f`) is from 2026-05-18, with only
`ff50f5055` in the asserted window. Either:

(a) Identify which 2 SHAs the roll-up actually counts (could be
`ff50f5055` plus one other in-window release SHA I missed), and verify
both are pure version bumps.

(b) Correct the date range to "2026-05-18..05-23" and confirm the pair
identity.

**Action:** lower priority than 2 & 3; date-range cosmetic.

---

## Method note

- All SHAs inspected with `git -C /Users/henrik/source/ruvnet/{ruflo|RuVector} show --stat <sha>`.
- For mixed-substance SHAs (`cffa55744`, `91657b9fc`, `0c2b0c02f`), full
  diff body inspected to characterize the substantive payload.
- Per memory `feedback-upstream-means-upstream`: sourced from `ruvnet/*`
  not `forks/`. Per memory `feedback-no-fallbacks`: each claim grounded
  in `git show --stat` evidence.
- Per memory `feedback-corpus-evidence-before-feature-work`: this audit
  IS the corpus walk that validates whether ledger roll-ups are
  evidence-grounded.
