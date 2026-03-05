# ADR Review Report: 3-Perspective Analysis

**Date**: 2026-03-05
**Reviewers**: 3 specialist agents (End User, Maintainer, Technical Soundness)
**Scope**: ADRs 0005-0012

---

## What the ADRs Get Right

All three reviewers agree the core architecture is sound:
- Build-step rename (never commit to fork) eliminates merge conflicts
- Prerelease gating balances automation with safety
- Ruvector exclusion is well-justified
- systemd timer is appropriate for the use case

---

## Critical Issues (would cause failures)

| # | Issue | Found By | Affected ADRs |
|---|-------|----------|---------------|
| **C1** | **First npm publish bootstrap**: `npm publish --tag prerelease` on first-ever publish does NOT set `latest` tag. `npx ruflo-patch` would 404 until manually fixed. | Technical | 0010, 0012 |
| **C2** | **Dynamic imports**: Code constructing `@claude-flow/` + variable at runtime won't be caught by the codemod. Results in `MODULE_NOT_FOUND` crashes. No ADR defines how to find or handle these. | Technical, End User | 0005, 0007 |
| **C3** | **Topological publish order**: 23 packages across 5 dependency levels must publish bottom-up. No ADR specifies the order or handles partial failures. | Technical, Maintainer | 0005 |
| **C4** | **Codemod not specified**: The "key asset" has no implementation ADR -- no tool choice, no edge case handling, no file extension list. Asymmetric mappings (unscoped `claude-flow` -> `@claude-flow-patch/claude-flow`) need word-boundary matching to avoid corrupting `@claude-flow-patch`. | Maintainer, Technical | 0005, 0006 |
| **C5** | **Secret management**: Zero mention of where npm/GitHub tokens are stored, how they're provided to the build, or how they're rotated. | Maintainer | 0009, 0010 |

---

## Significant Issues (incorrect behavior or gaps)

| # | Issue | Found By | Affected ADRs |
|---|-------|----------|---------------|
| **S1** | **Strategy doc contradicts ADR-0006**: Doc says `ruflo -> @claude-flow-patch/ruflo`, ADR says `ruflo -> ruflo-patch` (unscoped). ADR should be authoritative. | Technical, End User | 0006 |
| **S2** | **Version numbering across repos**: ADR-0012 says `{upstream_version}-patch.{N}` but upstream repos have different versions (ruflo 3.5.2, agentdb 3.0.0-alpha, agentic-flow 2.0.7). Using ruflo's version for all packages is misleading. | Maintainer, Technical | 0012 |
| **S3** | **Inherited RED semver conflicts**: `@ruvector/ruvllm ^0.2.3` vs `2.5.1` will cause npm resolution failures. No ADR addresses whether to patch the ranges or accept the breakage. | Technical | 0008 |
| **S4** | **No migration guide for existing users**: Users with existing projects have MCP configs, CLAUDE.md files, shell scripts, and AgentDB data referencing `@claude-flow/cli`. No document covers migration. | End User | 0007 |
| **S5** | **No rollback procedure**: If a promoted `@latest` is broken, no ADR documents `npm dist-tag add ruflo-patch@<old> latest` as a procedure. | Maintainer | 0010 |
| **S6** | **Ruvector API compatibility gap**: Upstream HEAD (933 commits ahead) may call ruvector APIs added after the last ruvector npm publish. Rebuilt packages could fail at runtime. | End User, Technical | 0008 |

---

## Operational Gaps

| # | Issue | Found By |
|---|-------|----------|
| **O1** | No disaster recovery procedure (bus factor = 1, server loss = total rebuild) | Maintainer |
| **O2** | No external monitoring for silent timer failures | Maintainer |
| **O3** | systemd unit missing `After=network-online.target`, `TimeoutStartSec`, `MemoryMax` | Maintainer |
| **O4** | Temp directory cleanup not specified (disk fills over weeks) | Maintainer |
| **O5** | No testing strategy specified (which tests? upstream? ours? flaky test handling?) | Maintainer |
| **O6** | Lock file for concurrent run prevention not specified | Maintainer |
| **O7** | npm rate limits when publishing ~26 packages in rapid succession | Maintainer |

---

## Missing ADRs Identified

| Missing ADR | Why |
|-------------|-----|
| **Codemod implementation** | Tool choice, transformation rules, file extensions, edge cases, testing |
| **Topological publish order** | Dependency tree ordering, partial failure handling, cross-repo sequencing |
| **First-publish bootstrap** | Setting `latest` tag, initial npm scope setup |
| **Dynamic import handling** | Audit strategy, runtime resolution approach |
| **Inherited semver conflict resolution** | Patch the ranges or accept breakage |
| **Initial setup runbook** | One-time setup: forks, npm scope, systemd, secrets, state files |
| **Rollback procedure** | How to revert a bad `@latest` |

---

## Contradictions Between Documents

| Document A | Document B | Contradiction |
|-----------|-----------|---------------|
| Strategy doc section 6 | ADR-0006 | `ruflo` mapping: `@claude-flow-patch/ruflo` vs `ruflo-patch` (unscoped) |
| ADR-0007 | Patches MC-001/FB-001/FB-002 | ADR says "no changes beyond scope rename" but patches ARE changes |
| ADR-0009 edge cases | ADR-0009 unit file | Recommends `TimeoutStartSec=3600` but unit file doesn't include it |
| Strategy doc section 10 | ADR-0008 | Effort estimate: "~2 weeks" vs "~1 week" |

---

## End User Trust Concerns

- No provenance attestation or code signing (npm `--provenance`)
- No published test results or coverage reports
- Bus factor of 1 -- sole maintainer, sole server
- `@latest` freshness depends on one person's availability
- No issue triage guidance (report bugs to upstream or to us?)
- No reverse migration path if upstream eventually publishes

---

## Resolution Actions

- Create 7 new ADRs (0013-0019) for missing decisions
- Update ADRs 0007, 0009, 0010, 0012 to fix contradictions and gaps
- Fix strategy doc contradiction with ADR-0006
