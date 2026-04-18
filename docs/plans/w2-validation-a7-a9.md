# W2-V3 Validator — A7, A8, A9 (READ-ONLY)

**Date**: 2026-04-17
**Scope**: three post-fix artifacts on `main` / fork `ruflo` `main`
**Mode**: READ-ONLY (no edits, no commits)

## Signoff Table

| # | Artifact | Subject | Verdict |
|---|----------|---------|---------|
| A7 | (no commit — verified existing `8eec462`) | workflow pause/resume isolation + `workflowId` capture | **PASS** |
| A8 | fork `e14105f67` | `coordination_node` `status`/`info` action | **PARTIAL** — wiring-only against an empty-by-default store; see F1 |
| A9 | `ea07f67` | github-integration — `GITHUB_TOKEN` gate removed, `_stub:true` load-bearing | **PASS** |

---

## A7 — `lib/acceptance-workflow-checks.sh` (verified existing Sprint 1.4 fix)

**Core question**: Does the workflow pause/resume coverage actually rely on a real, committed fix, and do the pause/resume checks exercise the real state machine end-to-end?

**Finding**: Yes. Fix is `8eec462` (Sprint 1.4) and is live on `main` with no regressions.

Read-only evidence:

- `_extract_workflow_id` (lib/acceptance-workflow-checks.sh:39–51) uses a Node heredoc over stdin to parse `_MCP_BODY` (not fragile grep/sed) and accepts three shape variants: `j.workflowId`, `j.workflow_id`, `j.workflow.workflowId`. Defensive for upstream shape drift.
- `_workflow_pause_body` (lines 196–244) is a real 3-step sequence: `workflow_create` → `workflow_execute` (required precondition "running") → `workflow_pause`. Each step gates on `_CHECK_PASSED` with three-way bucket (ADR-0090 Tier A2) preserved, early `skip_accepted` on tool-not-in-build, and specific failure diagnostics per step.
- `_workflow_resume_body` (lines 255–305) is a real 4-step sequence: create → execute → pause → resume — the full state-machine contract.
- Isolation via `_with_iso_cleanup` (lines 247, 308) is actually load-bearing. File header 23–32 documents WHY: `saveWorkflowStore` is naive `writeFileSync` with no locking, so concurrent sibling checks were last-writer-wins clobbering in-flight state (`resume` saw "Workflow not running" because sibling's pause write was overwritten). Isolation is not cosmetic — it defends a real concurrency bug class.
- `workflowId` capture-and-reuse (not the user-supplied `name`) matches upstream store semantics; the check would correctly report "Workflow not found" if upstream ever flipped the key.

**A7 is a true end-to-end pause/resume test.** Not wiring-only (contrast A5/A6 from W2-V2). The `workflow_execute` step actually transitions state before `workflow_pause` runs, so the pause is exercising the real state machine, not a wiring stub.

**Verdict**: PASS.

---

## A8 — `forks/ruflo` `e14105f67` — `coordination_node` `status`/`info` action

**Core question**: Is the new `status` action doing REAL work (returning actual node state from a populated registry), or is it a stub?

**Finding**: It does **real work against whatever state actually exists in `.claude-flow/coordination/store.json`** — but the acceptance check exercises the empty-store code path, not a populated-store one. Read in full, the answer is: "real-for-what-it-does, wiring-only-for-what-the-check-proves." PARTIAL.

Read-only evidence from `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/coordination-tools.ts`:

**The handler IS real** (not a stub):
- Lines 375–417 read the persisted store via `loadCoordStore()` (lines 94–124), which parses `.claude-flow/coordination/store.json` if present. Writes (`add`/`remove`/`heartbeat`) come from sibling actions lines 438/462/477 via `saveCoordStore`. The store is a real file-backed registry that SURVIVES across `mcp exec` invocations.
- The `nodeId`-targeted branch (lines 384–400) does a real lookup; returns `{success:false, error:"Node not found", nodeId}` on miss (genuine failure shape, not laundered success), or a genuine `{success:true, status, node:{id,status,load,lastHeartbeat}, ready}` on hit. Correct contract.
- The no-`nodeId` aggregate branch (lines 402–416) computes `activeCount` from `Object.values(store.nodes).filter(n => n.status === 'active')`, returns real counters (`online`, `total`, `active`) and a materialized `nodes[]` mapping.

**But the check doesn't drive a populated store**: `check_adr0094_p3_coordination_node` (lib/acceptance-coordination-checks.sh:59–77) invokes `{"action":"status"}` with NO prior `add` action. On a fresh `E2E_DIR`, `loadCoordStore()` hits the `existsSync(path)` false branch (lines 97) and returns the default store with `nodes: {}`. The status handler then computes `activeCount=0, nodes.length=0` and hits the ternary `activeCount > 0 || nodes.length === 0 ? 'healthy' : 'degraded'` on line 405 → returns `healthy` because `nodes.length === 0` is `true`. Empty store → `healthy`. That is technically correct ("zero nodes with zero unhealthy = healthy vacuously") but not a property-based test of the registry.

The acceptance regex (line 63: `node|nodes|ready|online|healthy|status|id`) matches the empty-store body (`{"success":true,"status":"healthy","ready":true,"online":0,"total":0,"active":0,"nodes":[]}`) trivially — every one of those tokens is a structural field emitted even when the store is empty.

**Why PARTIAL, not FAIL**: the fork fix is correct for what it set out to do (wire up the missing `status`/`info` action — the handler IS sensible code with a real persistence path). The REMAINING gap is check-side: no `add`-then-`status` round-trip proves that a populated registry is actually read correctly. This is analogous to A5/A6 from W2-V2 — real handler, wiring-level acceptance assertion. Unlike A5/A6, though, the store here IS file-backed so a populated round-trip is architecturally possible within a single acceptance run (terminal/github stores prove the pattern).

**Verdict**: PARTIAL. See F1 for follow-up.

---

## A9 — `lib/acceptance-github-integration-checks.sh` (ea07f67)

**Core question**: Does the ORIGINAL INTENT of these checks require real GitHub API integration (in which case local-stub verification is weaker than original intent), or is local-stub behavior the product's actual contract?

**Finding**: Local-stub IS the product's actual contract. This is explicit and intentional upstream.

Read-only evidence from `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/github-tools.ts`:

- Zero references to `GITHUB_TOKEN`, `octokit`, `fetch`, or `api.github.com` in the 363-line file. `grep -n GITHUB_TOKEN github-tools.ts` returns no matches. The fix commit's stated premise ("none of the 5 handlers read `GITHUB_TOKEN`") is empirically verified.
- The stub contract is first-class, not accidental. Four call-sites explicitly return `{success:false, _stub:true, message:"...local-only stubs..."}` — lines 107, 175, 322, 350 — with consistent English ("GitHub tools are local-only stubs. For real GitHub operations, use the gh CLI or GitHub MCP server directly."). This is documented, deliberate, user-facing behavior.
- `github_issue_track` (default `action:"list"`) and `github_pr_manage` (default `action:"list"`) return real `{success:true, issues/pullRequests:[...], total, open}` from a JSON store (lines 141–149 and sibling issue-list handler). These are genuine local persistence; other actions on the same tools are documented stubs. So the fix correctly distinguishes the two classes (real-local-list vs. stub-with-marker) and binds each check to the correct response shape.
- The PASS regex for the three documented stubs (`metrics`, `repo_analyze`, `workflow`) pins on `"_stub":\s*true` — a load-bearing marker. If upstream ever upgrades to real API calls, the new response will NOT contain `_stub:true`, the regex will not match, and the check will **FAIL LOUDLY**, forcing re-evaluation. That is textbook ADR-0082 discipline.
- The prior `if [[ -z "$GITHUB_TOKEN" ]] && skip_accepted` gate was a silent-pass by construction: in local cascades where `GITHUB_TOKEN` is unset (the common case), all 5 checks turned green unconditionally, masking both stub-contract regressions (upstream flips to real API without updating skip logic) and real-handler regressions (e.g. if `loadGitHubStore` started throwing, the skip gate would hide it). Removing it is correct and ADR-0082-compliant. The prior 401/403/bad-credentials auth-error branch was never reachable — these tools never produce those shapes — so removing it also removes a future silent-fail mask.

Cross-reference to contemporary log entry (`docs/adr/ADR-0094-log.md:9–33`) — the fix rationale is documented append-only with the specific regex-per-tool table, aligned with the file comments.

**Verdict**: PASS. Local-stub IS the contract; the check correctly verifies it; the `_stub:true` marker is load-bearing and will fail loudly under any upgrade.

---

## Top Flags

### F1 — A8 remains wiring-only on the check side (MEDIUM, follow-up)

The fork handler IS real, but `check_adr0094_p3_coordination_node` drives only the empty-store code path, and the regex (`node|nodes|ready|online|healthy|status|id`) matches the empty-store body's structural field names trivially. To upgrade to a real round-trip, the check should:

1. Invoke `coordination_node` with `{"action":"add","nodeId":"adr0094-test-node"}` under `--rw` + `_with_iso_cleanup` (store.json is file-backed so iso is advisable).
2. Then invoke `{"action":"status"}` and assert `total >= 1` AND `nodes` array contains an entry with `"id":"adr0094-test-node"` — narrow, not a structural-field-name match.
3. Optionally `{"action":"status","nodeId":"adr0094-test-node"}` and assert the single-node branch (`{"node":{"id":"adr0094-test-node",...}}`) returns.

Without this upgrade, a future regression that silently returns the default empty store regardless of actual node contents would still PASS. Mirrors the A4 terminal pattern from W2-V2 which correctly drives `terminal_create` → `terminal_close`. The coordination store is file-backed so no architectural obstacle exists (unlike A5/A6's in-memory Maps).

Also: ADR-0094-log `3405f65` entry needs amendment — the `p3-co-node` narrow skip ledger comment (lib/acceptance-coordination-checks.sh:46–57) is now stale; the handler IS wired and the `skip_accepted` downgrade branch (lines 68–76) is now effectively dead code except as defensive regression guard. Either drop the dead branch or comment it as "reserved regression guard — fails back to skip if fork regresses" and unlink from the open follow-up item.

### F2 — A8 vacuous-empty-store `healthy` ternary is semantically loose (LOW, correctness)

Line 405 of `coordination-tools.ts`: `status: activeCount > 0 || nodes.length === 0 ? 'healthy' : 'degraded'`. The empty-store branch returns `healthy` which is debatable — zero-nodes-ever and zero-active-nodes-after-all-failed are indistinguishable. Not blocking because the check doesn't currently depend on the `healthy`/`degraded` distinction, but if F1's upgrade lands the round-trip check should prefer narrow structural assertions (`total`, `nodes[]` contents) over the status string. Recommend the fork amend the ternary to `nodes.length === 0 ? 'empty' : (activeCount > 0 ? 'healthy' : 'degraded')` so the three states (empty / healthy / degraded) are distinguishable — minor but makes observability honest.

### F3 — A9 regex for `github_issue_track` / `github_pr_manage` is slightly broader than it needs to be (LOW, cosmetic)

The pattern `'"issues"|"total"|"open"'` matches ANY of the three field names — so a response missing `issues[]` and returning only `{total:0, open:0}` still passes. That's fine for the current JSON-store shape, but a stricter AND-style assertion (body must contain BOTH `"issues"` AND `"total"`) would fail sooner if upstream ever drops the `issues` array while keeping the counters. Not blocking — the current pattern is appropriate for regex-based harness, and the `_stub:true` gating on the three stub tools provides the strong contract enforcement. Optional micro-tightening, not a required fix.

### F4 — A9 scoreboard claim needs to acknowledge the split-contract (LOW, bookkeeping)

Two of the five github checks (`issue_track`, `pr_manage`) verify real local-store behavior; three (`metrics`, `repo_analyze`, `workflow`) verify documented-stub markers. The ADR-0094-log entry correctly lists this but the checks file header 17–21 does not distinguish — both classes are presented as equivalent "local-only stubs." Recommend one-line clarification in the file header: "Two tools (`github_issue_track`, `github_pr_manage` default `action:list`) have real local-store handlers; three (`github_metrics`, `github_repo_analyze`, `github_workflow`) are documented stubs with `_stub:true` markers." Coverage-honest.

---

## Summary

- **A7**: PASS. Workflow pause/resume is a genuine end-to-end state-machine exercise (create → execute → pause[→ resume]) with real isolation defending a real concurrency bug. Existing Sprint 1.4 fix `8eec462` is live, correct, documented.
- **A8**: PARTIAL. Fork `e14105f67` is a real handler against a file-backed registry (not a stub), but the acceptance check exercises only the empty-default-store code path. Upgrade to `add` → `status` round-trip is straightforward and should land before A8 is signed off as full coverage. See F1.
- **A9**: PASS. Local-stub IS the product's actual contract (zero GITHUB_TOKEN reads in 363 lines of source; four explicit `_stub:true` return shapes with user-facing "local-only stubs" message); the `_stub:true` marker is load-bearing; removing the GITHUB_TOKEN gate eliminates an ADR-0082 silent-pass.

**Recommendation**: allow A7 and A9 to merge as-is. For A8, open a follow-up tracker (ADR-0094-log append-only entry + sub-task) to upgrade `check_adr0094_p3_coordination_node` to a populated-store round-trip. The fork handler is not the blocker — the check is.
