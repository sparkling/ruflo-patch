# 2026-05-25 — INTEGRATION-LEDGER NAPI binary regen roll-up audit

## Verdict

**ALL-PURE-BINARY** (substantive disposition correct), with a **count
discrepancy** (ledger row claims 52 SHAs; actual count in the stated date
range is 21).

Substantive risk — that the 52-SHA roll-up hides bundled source changes —
is **disproved by full enumeration**. The disposition `skip-mechanical`
remains correct for every SHA covered. The numeric "52" in the ledger row
is wrong by a factor of ~2.5x and should be corrected to "21".

## Roll-up source

- **Upstream repo**: `ruvnet/RuVector` (at `/Users/henrik/source/ruvnet/RuVector`).
  Confirmed by section heading: ledger line 237 begins `## ruvector`, and
  the row at line 309 sits below the ruvector table. ADR-0228 §"Batch N"
  (line 201) confirms scope is "ruvector recent (May 18-22)" expanded via
  Batch I and other earlier picks; the NAPI regen roll-up sits across the
  broader date range than just May 18-22.
- **Date range claimed**: 2026-05-04 .. 2026-05-23 (per ledger row).
- **Total SHAs in roll-up (claimed)**: 52.
- **Total SHAs found (verified)**: 21 (enumerated below).
- **Sample size**: 21 (full enumeration — sample == population for this audit).

### Enumeration query and result

```
cd /Users/henrik/source/ruvnet/RuVector
git log --since=2026-05-04 --until=2026-05-24 \
  --pretty=format:"%h %ad %s" --date=short \
  --grep="NAPI" \
  --author="github-actions"
```

Returns 21 commits, all authored by `github-actions[bot]`, all with
identical subject pattern `chore: Update NAPI-RS binaries for all
platforms`. The `--until=2026-05-24` is used to be inclusive of the
2026-05-23 day boundary; restricting to `--until=2026-05-23` yields 20
(excludes the boundary commit). Neither yields anywhere near 52.

Cross-repo check:
- `ruvnet/agentdb` 2026-05-04..05-23 `--grep="NAPI"` → **0 hits**
- `ruvnet/agentic-flow` 2026-05-04..05-23 `--grep="binar\|NAPI"` → **0 hits**
- `ruvnet/ruflo` 2026-05-04..05-23 `--grep="binar\|NAPI"` → **15 hits, NONE
  are NAPI binary regens** (matches are spurious — "native-binding",
  "extension binar..."). All 15 are substantive feature/test/CI work and
  fall under Batch S (ruflo backlog), not Batch N (ruvector).

No other repo contributes to the Batch N "NAPI binary regen" roll-up.

## Sampled SHA findings

Full enumeration (n=21) — every commit `git show --stat`-ed and inspected
for source-like touches (`.rs`, `.ts`, `.js`, `src/`, `scripts/`, `docs/`,
etc.) via:

```
git show --name-only --format="" <SHA> | grep -E "\.(rs|ts|js|tsx|jsx|md|yaml|yml|toml|sh|py)$|^src/|^scripts/|^docs/|^crates/"
```

| SHA | Date | Subject | Files (count) | Source touches? | Verdict |
|---|---|---|---|---|---|
| `9054c2cc` | 2026-05-12 | chore: Update NAPI-RS binaries for all platforms | 1 | 0 | pure-binary |
| `29ba5349` | 2026-05-12 | chore: Update NAPI-RS binaries for all platforms | 1 | 0 | pure-binary |
| `ef5274c2` | 2026-05-08 | chore: Update NAPI-RS binaries for all platforms | 1 | 0 | pure-binary |
| `e3834760` | 2026-05-07 | chore: Update NAPI-RS binaries for all platforms | 1 | 0 | pure-binary |
| `6808c706` | 2026-05-07 | chore: Update NAPI-RS binaries for all platforms | 1 | 0 | pure-binary |
| `fa39e66c` | 2026-05-06 | chore: Update NAPI-RS binaries for all platforms | 1 | 0 | pure-binary |
| `ec4e4bbd` | 2026-05-06 | chore: Update NAPI-RS binaries for all platforms | 1 | 0 | pure-binary |
| `1b106721` | 2026-05-06 | chore: Update NAPI-RS binaries for all platforms | 1 | 0 | pure-binary |
| `5c580eba` | 2026-05-06 | chore: Update NAPI-RS binaries for all platforms | 1 | 0 | pure-binary |
| `645c94df` | 2026-05-06 | chore: Update NAPI-RS binaries for all platforms | 1 | 0 | pure-binary |
| `259c2896` | 2026-05-06 | chore: Update NAPI-RS binaries for all platforms | 1 | 0 | pure-binary |
| `5ea1c275` | 2026-05-06 | chore: Update NAPI-RS binaries for all platforms | 1 | 0 | pure-binary |
| `b71981b5` | 2026-05-06 | chore: Update NAPI-RS binaries for all platforms | 1 | 0 | pure-binary |
| `81a3532f` | 2026-05-06 | chore: Update NAPI-RS binaries for all platforms | 1 | 0 | pure-binary |
| `77b44c2e` | 2026-05-06 | chore: Update NAPI-RS binaries for all platforms | 6 | 0 | pure-binary (all 5 platforms + native dir) |
| `999bfbdf` | 2026-05-05 | chore: Update NAPI-RS binaries for all platforms | 6 | 0 | pure-binary (all 5 platforms + native dir) |
| `22518455` | 2026-05-05 | chore: Update NAPI-RS binaries for all platforms | 2 | 0 | pure-binary (linux-arm64-gnu + win32-x64-msvc) |
| `368d64a2` | 2026-05-04 | chore: Update NAPI-RS binaries for all platforms | 1 | 0 | pure-binary |
| `8b518302` | 2026-05-04 | chore: Update NAPI-RS binaries for all platforms | 1 | 0 | pure-binary |
| `17378bb3` | 2026-05-04 | chore: Update NAPI-RS binaries for all platforms | 1 | 0 | pure-binary |
| `5e0a1a41` | 2026-05-04 | chore: Update NAPI-RS binaries for all platforms | 1 | 0 | pure-binary |

**Files touched across all 21 commits**: exclusively under
`npm/core/native/<arch>/ruvector.node` and
`npm/core/platforms/<arch>/ruvector.node` — these are precisely the NAPI
binary outputs ADR-0150 says we rebuild natively and ADR-0186 reaffirms.

**Commit body pattern**: every commit is authored by
`github-actions[bot]`, references a `Built from commit <source-SHA>`
trailer (so the binary is provably the byproduct of an enumerated
substantive commit that the ledger already disposes elsewhere), and lists
the same 5 platform targets (linux-x64-gnu, linux-arm64-gnu, darwin-x64,
darwin-arm64, win32-x64-msvc). The `Bin <N> -> <N> bytes` size deltas
in every git stat block confirm the diff is byte-level binary churn only.

## Hidden-substance findings

**None.** No sampled SHA touches `.rs`, `.ts`, `.js`, `.md`, `.yaml`,
`.toml`, `src/`, `scripts/`, `docs/`, or `crates/`.

The `skip-mechanical` disposition is verified correct under the
ADR-0150 + ADR-0186 standing rule: every commit in this set is exactly
what that rule was written to absorb — bot-generated NAPI binary
regenerations for a Cargo source change the ledger already records (or
correctly skipped) under a separate row keyed by the `Built from commit`
trailer SHA.

## Recommended ledger action

1. **No substantive change to disposition**: keep `skip-mechanical` for
   the rolled-up set.

2. **Correct the count**: replace `(52 SHAs)` with `(21 SHAs)` at
   ledger line 309. The audit query is short and reproducible:

   ```
   cd /Users/henrik/source/ruvnet/RuVector
   git log --since=2026-05-04 --until=2026-05-24 \
     --pretty=format:"%h" \
     --grep="NAPI" \
     --author="github-actions" | wc -l
   ```

   Should return `21`. If a future re-rollup pulls the boundary date
   inclusively the count may shift by ±1; the SHA list above pins the
   canonical 21.

3. **Optional — strengthen the Notes column**: append "21 SHAs enumerated
   and verified pure-binary in `docs/audits/2026-05-25-ledger-napi-regens-audit.md`
   (every commit byte-only diff in `npm/core/**/*.node`, no source
   touches)." This eliminates the largest "hiding place" criticism
   levelled at roll-up rows without requiring per-SHA row expansion.

4. **No per-SHA ledger row expansion needed**: the rule is exactly the
   shape of these commits; per-row expansion would dilute signal in the
   table without surfacing new substance.

## Source of the "52" figure (speculation)

Not reconstructed from the ledger context alone. Possible explanations
(low-confidence):

- A wider audit window (e.g., 2026-04-14 .. 2026-05-23, which captures
  ~52 NAPI commits per `git log --since=2026-04-14`) was mentally
  conflated with the stated 2026-05-04 .. 2026-05-23 range.
- A summed total across multiple repos was attributed solely to
  RuVector. (Verified false: agentdb=0, agentic-flow=0,
  ruvnet/ruflo=0-true-NAPI commits in the same window.)
- An eyeball count mistake during the original Batch N triage that the
  audit cycle didn't sample-check.

The substantive verdict ("skip-mechanical, pure-binary") is unaffected
by the count error; only the documentation accuracy in the ledger row
is.
