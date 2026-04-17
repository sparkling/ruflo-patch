# Plan 11 — Skip Hygiene + Final Push to `verified_coverage ≥ 80%`

**Inputs**: ADR-0096 (SKIP_ROT), grep of `SKIP_ACCEPTED` across `lib/acceptance-*-checks.sh` (264 branch occurrences ≈ 55 distinct skip_accepted checks).

## 1. Triage (A/B/C/D)

Distribution from file-by-file grep:

| File | Skips | Root cause | Bucket |
|------|-----:|-----------|--------|
| `browser-checks` | 21 | Playwright binary absent | **A** |
| `github-integration` | 10 | `GITHUB_TOKEN` unset | **A** |
| `transfer-checks` | 9 | Network / plugin store unreachable | **C** |
| `file-output-checks` | 15* | Artifacts created lazily (not by bare `init --full`) | **B** |
| `error-paths` | 8* | CLI tolerates chmod 000 (no fail path) | **B** |
| `workflow-checks` | 19* | MCP workflow tools not wired | **D** |
| Others (hivemind, autopilot, claims, agent-lifecycle, etc.) | balance | Mix of env-gated / MCP-not-built / upstream-removed | mixed |

(*File branch count > distinct net skip count — branches dedupe/overlap.)

Netting to ~55 distinct checks:
- **A — Fixable (infra)**: ~35 (21 Playwright + 10 gh-token + 4 env-var-gated)
- **B — Check-fixable**: ~12 (file-output lazy-init + error-paths assertion drift)
- **C — Legitimately skipped**: ~6 (transfer network, ruvllm optional, upstream-removed MCP)
- **D — Should-be-failing**: ~2 (workflow MCP is a real gap; possibly more surfaced)

## 2. Sprint phasing — multi-sprint, NOT one

Order by risk × yield:

**11.1 Bucket B (3d)** — rewrite `file-output` to assert after `memory store` (not bare `init`); rewrite `error-paths` to assert tolerance (`doctor exit=0 AND config intact`), not skip. No product change. +12 pass.

**11.2 Bucket C (1d)** — extend ADR-0096 `skip_streaks` with `expected_skip BOOLEAN`. Add 6 ledger entries state=`optional_external`. ROT clock disabled; quarterly review.

**11.3 Bucket A (5d)** — Playwright install + `GITHUB_TOKEN` CI secret + 4 env-var fixes. +35 pass.

**11.4 Bucket D (variable)** — investigate workflow MCP gap; fix in fork + `-patch.N+1`.

Plan: 9 dev-days + D overhead.

## 3. Swarm per bucket

| Bucket | Agents |
|-------|-------|
| B | 2 coder + 1 reviewer (loud-fail audit, ADR-0082) |
| C | 1 docs + 1 reviewer |
| A | 1 CI/infra + 1 coder + 1 reviewer |
| D | 2 investigators + 1 reviewer |

Hierarchical topology, specialized strategy. B+C parallel; A starts post-B to avoid harness merge churn.

## 4. Playwright recommendation: (a) + (d) split

Install Playwright in a **nightly** acceptance tier (`scripts/test-acceptance-browser.sh`, 24h cadence), NOT the default `test:acceptance`. Default stays fast (avoids ~400MB / 90s cold-install on dev loop). Nightly tier still writes `acceptance-results.json`, still feeds ADR-0096 catalog, still subject to `SKIP_ROT`. Reject Puppeteer (invasive product rewrite) and vendored Chrome (repo bloat).

## 5. Staying above 80% under SKIP_ROT pressure

Current: 396 / 452 = **87.6%**. Buffer = 34 above the line.

If ROT flips all 55 skips to fail on day 31: pass=396, fail=56, skip=0 → still 396/452 = **87.6%** (ROT converts skip→fail, doesn't move the pass numerator). Pass-rate drops; verified_coverage survives.

**Real risk**: ADR-0096 criterion 4 (`--verify` fails preflight on drift). 56 sudden fails tear CI down.

Mitigation sequencing:
1. Ship 11.1 (+12 pass) BEFORE the 30-day clock triggers on those IDs.
2. Ship 11.2 — 6 checks get `expected_skip: true`, excluded from ROT accounting.
3. Ship 11.3 within 25 days (+35 pass).
4. Final projection: pass = 443, skip = 6 (expected), fail = ~2 (real bugs D). verified = **98.2%**.

## 6. Out-of-scope probe for skip-reverify.mjs

ADR-0096 §Acceptance 3 requires fresh install, not shared state. Propose two-phase probe:

```
For each skip_streaks row where streak_days >= 7:
  1. mktemp -d /tmp/reverify-$(uuid)/
  2. cd there; npm init -y; npm install @sparkleideas/cli@<current-patch-N>
  3. Clear env (unset GITHUB_TOKEN, PLAYWRIGHT_BROWSERS_PATH, ANTHROPIC_API_KEY)
  4. Phase (i) BASELINE: source lib/acceptance-<group>-checks.sh; run only the target check. Expected: SKIP_ACCEPTED. If pass → skip is spurious, promote to regressed.
  5. Phase (ii) FIXABLE-PROBE: re-inject all prereqs (Playwright install, token, network). Re-run check. Expected: pass. If skip → prereq injection failed or Bucket C (document in ledger).
  6. Never reuse /tmp/ruflo-accept-* dirs. Never inherit CLAUDE_FLOW_HOME.
  7. Divergence (i)=skip, (ii)=pass → Bucket A candidate; auto-file ledger entry.
```

Two-phase discriminates genuine-optional (C) from infra-gated (A) without human triage.
