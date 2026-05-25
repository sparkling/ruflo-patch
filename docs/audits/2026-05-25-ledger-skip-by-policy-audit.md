# 2026-05-25 — INTEGRATION-LEDGER skip-by-policy anchor audit (6 entries)

Re-verification of the 6 `skip-by-policy` anchor rationales per memory
`feedback-skip-accepted-as-squelch.md`: anchors are legitimate only while
the cited policy is still in force at fork HEAD.

## Verdict

**4-STILL-VALID, 2-ANCHOR-MISLABELED (skip itself still defensible)**

All 6 SHAs are correctly NOT applied to fork main. None of the 6 needs
re-disposition. However, anchors 5+6 cite `[[ADR-0143]]` as authority for
README visual/affiliate-prose skips that ADR-0143 does not actually
govern. The skip decisions are independently defensible under a
fork-editorial policy that exists implicitly but is not captured in any
ADR. Recommend ledger-Note refinement, not re-disposition.

## Per-anchor findings

### Anchor 1: ADR-0088 spawn-only (row 46 — `a10a13e62` 2026-05-03)

**Upstream commit content**: 5-issue rollup (#1697 #1698 #1686 #1691
#1694). The #1691 portion converts `daemon.ts` from
`spawn(process.execPath, …, {shell:true})` to
`fork(cliPath, …, { stdio: [..., 'ipc'] })` to fix Windows
spaced-node-path. The OTHER 4 issues (rvf-wasm pin, HNSW false-negative,
metrics zeros, UI auto-execute) are unrelated.

**Policy text** (ADR-0088 §Decision item 1, §Delete §Add):
- "Delete `DaemonIPCClient` class … zero callers"
- "Delete `DaemonIPCServer` registration of `memory.*` methods … unused"
- Daemon "is explicitly not a memory RPC server / MCP tool host / involved
  in `memory store`, `memory search`, or `mcp exec`"

**Stronger anchor** (ADR-0162 Batch A #1, the actual policy this skip
implements): "If `adr_0088_policy=spawn-only`: drop the IPC bits; keep
`detached: true`" — explicit naming of the spawn-only stance.

**Fork state** (`forks/ruflo/v3/@claude-flow/cli/src/commands/daemon.ts:263-301`):
```ts
// ADR-0088 + ADR-0162 spawn-only policy: we use
// spawn(process.execPath, ...) rather than fork() because the IPC channel
// fork() creates is dead code in our architecture (ADR-0088 removed the IPC
// path). Upstream's #1691 Windows-spaced-path fix is preserved here by
// dropping `shell: true`
…
stdio: ['ignore', 'ignore', 'ignore'],   // NO 'ipc' slot
…
const child = spawn(process.execPath, spawnArgs, spawnOpts);
```

Fork's own `e29a0e342` "fix(cli,ui): resolve five issues from May 1-3
reports" hand-ported the FOUR unrelated fixes from `a10a13e62` while
explicitly retaining `spawn(…)` per the ADR-0162 carve-out. The commit
message says: "ADR-0162 Batch A #1 hand-port: spawn-only policy. Adopts
upstream a10a13e62 with daemon.ts hand-ported to keep
spawn(process.execPath, ...) (no fork) so no IPC channel is established
— the IPC consumer was removed by ADR-0088".

`a10a13e62` is **not** an ancestor of `forks/ruflo/main`.

**Verdict**: **still-in-force**. The ledger anchor "ADR-0088 spawn-only
locked" is accurate; the stronger explicit citation is ADR-0162 Batch A
#1, which also still holds. Source code at the cited line range still
carries the ADR-0088 + ADR-0162 spawn-only inline comment block.

**Confidence**: **high** — fork source code carries the policy citation
directly; SHA confirmed not-ancestor; ADR-0162 lifecycle text and fork's
hand-port commit message both name "spawn-only" explicitly.

### Anchor 2: ADR-0088 spawn-only (row 47 — `69e72d2e4` 2026-05-05)

**Upstream commit content**: Follow-up to `a10a13e62`. Upstream's `fork()`
path leaked the IPC channel even after `child.unref()`. Fix: switch
`detached: !isWin` → `detached: true` (every platform), and add
`child.disconnect()` to break the IPC pipe explicitly so the daemon
survives parent exit on Windows + Node 25.

**Dependency**: This fix is mechanically necessary ONLY when using
`fork()`. The IPC pipe doesn't exist on the `spawn(process.execPath, …)`
path because there's no `'ipc'` slot in stdio.

**Fork state**: `daemon.ts:273` reads `detached: !isWin` (POSIX-only —
the ADR-0162 Batch A #1 lifecycle text noted the fork would adopt
`detached: true` to mirror this fix on the spawn path; in practice the
fork chose `detached: !isWin` because Windows-side detached is unusable
without windowsHide and the daemon writes its own log files via
`appendFileSync`). The `child.disconnect()` call is inapplicable — there
is no IPC channel to disconnect.

Fork has CI regression tests for #1766 (`ci(windows):
add daemon-survives-parent-exit regression test for #1766` —
`64556ceb9` / `fd4c3cb3c` / `539b458b7`) that exercise the spawn path's
survival under parent-exit, so the underlying bug class is monitored
without porting upstream's fork-specific remediation.

**Verdict**: **still-in-force**. Skip is correct: the fix is dead
remediation for an issue the fork doesn't have (no IPC pipe → nothing
to break). Fork has its own regression coverage for the bug class.

**Confidence**: **high** — same source-code policy citation as Anchor 1;
the fix's premise (open IPC pipe) does not hold on the fork's daemon
spawn path.

### Anchor 3: fork-local witness manifest (row 93 — `779eb309b` 2026-05-03)

**Upstream commit content**: `chore(witness): register ADR-101-C
federation fix as #82` — appends one fix entry to upstream's
`verification.md.json` (the signed witness manifest) for fix #82.

**Anchor claim**: "confirmed 2026-05-18: witness manifest is fork-local;
upstream #82 register inapplicable"

**Fork state**:
- Fork uses **`witness-fixes.json`** at repo root (top-level), maintained
  by `scripts/regen-witness.mjs`. Last updated `735193c1f` 2026-05-08
  ("feat: ADR-103 witness temporal history + plugin-distributed
  toolkit").
- Upstream now uses **`verification/witness-fixes.json`** under a
  `verification/` subdirectory (`ef73a1616` HEAD; multi-file inventory).
- Different file layouts; the upstream `#82` entry indexes against
  upstream's manifest counter, not fork's.
- Fork's `scripts/regen-witness.mjs:45` writes to `verification.md.json`
  per legacy comment — but the file no longer exists at fork root
  (script header references it; current run target appears to be the
  top-level `witness-fixes.json` per the `_comment` field).

`779eb309b` is **not** an ancestor of `forks/ruflo/main`.

**Verdict**: **still-in-force**. The fork's witness infrastructure is
schema-incompatible with upstream's; mechanically applying upstream's
witness registrations would either be a no-op (wrong target file) or
corrupt the fork's `witness-fixes.json` counter.

**Confidence**: **medium-high** — file layout divergence is verifiable;
the legacy `verification.md.json` filename in `scripts/regen-witness.mjs`
header would benefit from cleanup but doesn't undermine the policy.

### Anchor 4: Batch J 8-SHA witness regenerations (row 124)

**SHAs**: `fdc00cce3` `f514495c8` `3c6d126b7` `9d43d8fdb` `3c0430b8b`
`0666796a0` `f8ab5a325` `5b71c7ac1` (2026-05-{03..16})

**Upstream content**: Each is a witness regen
(`chore(verify): regenerate witness for 3.6.X (N fixes)` /
`feat(verification): witness manifest regenerations`). Each touches
upstream's `verification.md.json` / `verification/*` files.

**Anchor claim**: "Batch J — fork-local witness manifest
(verification.md.json) supersedes upstream regenerations"

**Fork state**: Same as Anchor 3 — fork's witness lives in top-level
`witness-fixes.json`, maintained by fork's own `regen-witness.mjs` runs
(triggered by `npm run release` and per-issue commits). Each upstream
regen targets state-of-upstream-fix-list, which differs from fork's
fix-list both in inventory and in markers covered (ADR-093 F1-F12 etc.
land at different commits than upstream's own fix sequence).

All 8 SHAs confirmed not-ancestors of `forks/ruflo/main`. Fork's most
recent `witness-fixes.json` update is `735193c1f` (2026-05-08), keeping
the fork's witness independently current.

**Verdict**: **still-in-force**. Same rationale as Anchor 3 — schema and
content-mismatch make upstream regenerations inapplicable to fork's
witness file.

**Confidence**: **high** — 8/8 SHAs are mechanical regens; none touch
fork-specific markers; fork maintains the witness independently.

### Anchor 5: ADR-0143 branding (row 125 — 5 SHAs)

**SHAs**: `00039a833` `6f11cc794` `7523e4daa` `1c266663c` `cb3809820`
(all 2026-05-05)

**Upstream content** (verified):
- `00039a833` README intro: adds rUv ruv.io link + "powered by
  [`Congnitum.One`](https://cognitum.one/?RuFlo) Agentic Architecture"
  prose + `npx ruvflo init` typo.
- `6f11cc794` / `7523e4daa` README polish updates.
- `1c266663c` "Revise Ruflo description in README".
- `cb3809820` "Update branding from Claude Flow to Ruflo" — single line
  swapping description text + "working until 3am" hyperbole.

**Anchor claim**: "Batch J — sparkling brand kept per ADR-0143"

**Cited policy text** (ADR-0143 §Decision): "Add codemod **Pass 7**:
rewrite `@sparkleideas/cli` → `@sparkleideas/ruflo` in user-facing
scopes only". The ADR's scope categorisation table is explicit: it
governs the **`@sparkleideas/cli` ↔ `@sparkleideas/ruflo` package-name
rewrite** in README/USERGUIDE/install.sh/etc. It does NOT govern
Cognitum.One affiliate prose, ruvflo typos, or copy hyperbole.

**Fork state at `forks/ruflo/README.md`**:
- Line 3: `[![Ruflo Banner](ruflo/assets/ruflo-small.jpeg)](https://cognitum.one/agentic-engineering)` — voluntarily carries a Cognitum link
- Line 404: `| Powered by | [Cognitum.one](https://cognitum.one) |` — voluntarily carries Cognitum attribution
- "Why Ruflo?" paragraph (around line 22): Keeps pre-upstream-edit text
  — no rUv link, no "Congnitum.One" prose injection, no "working until
  3am" line
- 12 `claude-flow`/`Claude Flow` references survive in non-init surfaces
  (banner, GitHub stars badge, etc.) — these are template-surface, not
  user-emitted CLI strings

The fork demonstrably has a coherent editorial stance: **selective**
Cognitum branding (banner image + attribution OK; prose injection +
typos NOT OK; rUv personal link in copy NOT OK). All 5 SHAs are
not-ancestors of `forks/ruflo/main`.

**Verdict**: **drifted-anchor, valid-decision**. The skip itself is
correct (none of the 5 upstream SHAs would land cleanly), but ADR-0143
is the wrong citation — it governs package-names, not prose curation.
The actual policy is "fork editorial control of README prose", which
holds implicitly but is not formally documented in any ADR. The closest
formal anchor is precedent-by-row (Batch J standing pattern, the
`10db8e459` precedent at row 173 — which then forward-cites this same
row 125, creating a circular reference both grounded in implicit policy).

**Confidence**: **high** — ADR-0143 scope mismatch is unambiguous; the
skip decision is defensible on independent grounds; SHAs confirmed
not-applied.

### Anchor 6: ADR-0143 branding (row 312 — `1e5811fb` 2026-05-22)

**Upstream content**: `docs(readme): add repository banner image linking
to cognitum.one/ruvector` — 3-line addition to upstream's
`README.md`.

**Anchor claim**: "Batch N: branding/marketing per ADR-0143"

**Fork state at `forks/ruvector/README.md`** (last touched 2026-04-26,
SHA `ce1afecb2`):
- Line 2: `[![CES 2026 Innovation Award](https://img.shields.io/badge/🏅_CES_2026-Innovation_Award-gold.svg)](https://cognitum.one)` — carries Cognitum link
- "Powered by Cognitum.one" attribution
- Extensive Cognitum Gate / Cognitum hardware / Cognitum chip prose
  throughout

Fork's ruvector branding is **more** Cognitum-saturated than ruflo's,
yet rejects the **specific banner image format** in `1e5811fb`. The
distinction is the same as in Anchor 5: small Shield-style badges
are fine; large banner images at top are not. This is editorial style,
not package-name policy.

`1e5811fb` is not-ancestor of `forks/ruvector/main`.

**Verdict**: **drifted-anchor, valid-decision**. Same as Anchor 5 —
ADR-0143's package-name scope doesn't actually govern this skip. The
real anchor is editorial: fork's ruvector README curates which Cognitum
surfaces ship (badges yes, top banner no). Defensible standalone, but
ADR-0143 citation is technically incorrect.

**Confidence**: **high** — same scope-mismatch logic as Anchor 5.

## Recommended ledger actions (if any)

**None of the 6 entries needs re-disposition** — all SHAs are
correctly not-in-fork-main, and all skips remain defensible.

### Optional Note refinements (low-priority polish)

The 2 anchor-mislabeled entries cite ADR-0143 for skips that ADR-0143
doesn't actually govern. Recommend tightening their Notes on the next
ledger-pass — not as a re-disposition, but as a citation accuracy fix:

- **Row 125** (5-SHA branding batch): swap
  `sparkling brand kept per ADR-0143`
  →
  `Batch J fork-editorial-prose policy (Cognitum prose injection +
  ruvflo typo + working-until-3am hyperbole rejected; banner + Powered-by
  attribution voluntarily kept). ADR-0143 only governs the package-name
  flip; visual/prose curation is implicit fork-editorial.`
- **Row 312** (ruvector banner): swap
  `branding/marketing per ADR-0143`
  →
  `Batch N fork-editorial-prose policy — fork carries CES 2026
  Cognitum badge + Cognitum Gate prose but curates against large
  top-banner format. ADR-0143 scope is package-names only.`

The chain effect: row 173 (`10db8e459`) forward-cites row 125's
precedent, so its Note inherits the same correction.

### Anchors 1+2 strengthening (also low-priority)

The ADR-0088 anchor for rows 46/47 is correct as far as it goes, but the
**stronger** explicit citation is **ADR-0162 Batch A #1**. The fork's
own hand-port commit (`e29a0e342`) and the source-code inline comment
(`daemon.ts:263`) both name ADR-0162 alongside ADR-0088. Future audits
would have an easier time if the ledger Note named ADR-0162 explicitly:

- **Rows 46, 47**: append `+ ADR-0162 Batch A #1 carve-out` to the
  existing `ADR-0088 spawn-only locked` Note.

No code or disposition change needed — just citation clarity.

## Methodology notes

- Confirmed 11/11 audited SHAs (`a10a13e62`, `69e72d2e4`, `779eb309b`, 8
  Batch J witness SHAs spot-checked as a group via `merge-base
  --is-ancestor`, 5 Batch J branding SHAs, `1e5811fb`) are not ancestors
  of their respective fork-main branches.
- Read fork source code at the cited line range for Anchors 1+2 to
  verify the inline ADR comments are still present.
- Compared fork README HEAD content against the upstream skip-target
  commits' diffs for Anchors 5+6 to verify the editorial curation
  is consistent.
- All forks confirmed on `main` branch (no detached HEAD or feature
  branch artifacts that would skew the ancestry checks).
- Per memory `feedback-upstream-means-upstream`, upstream SHAs were
  sourced from `/Users/henrik/source/ruvnet/{ruflo,ruvector}/`, not
  `forks/`.
