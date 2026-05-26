---
status: accepted
completed: true
date: 2026-05-19
implemented-date: 2026-05-22
tags: [init, hooks, template, manifests, swarm-reviewed]
supersedes: []
depends-on: [0201]
implements: []
---

# Implement (or trim) init-emitted hook handlers for advertised events

> **Decision reversed after a 6-expert swarm review (2026-05-20).** The original draft chose **Option D — delegate the generated `.claude/helpers/hook-handler.mjs` handlers to `mcp__ruflo__hooks_*` MCP tools.** The review found Option D **infeasible and a strict regression**: (1) the generated handler is a standalone spawned `node` subprocess with **no in-process MCP path** — "delegate to MCP" is only realizable as a per-hook `ruflo mcp start` cold-spawn (hundreds of ms–>1s on the highest-frequency events); (2) its premise is false — of the 6 unhandled events, **1 has a real MCP tool, 2 are stubs, 3 don't exist**; (3) it routes hooks through the Archivist/RVF-lock path, hitting the daemon's lifelong lock (F-13-001) on every Bash/Edit, whereas **the current local handler is the only daemon-safe hook consumer precisely because it bypasses that lock**; (4) it depends on four still-unbuilt sibling ADRs (0202/0204/0210/0218) while declaring `depends-on:[0201]` only; (5) upstream is decisively local-impl and fixes this defect class in the MCP-tool layer, never by init-delegation. The decision changes to **implement-the-high-value-events locally + trim the fork-introduced over-reach + fix the two real bugs locally; defer any MCP delegation**. See [Swarm review evidence](#swarm-review-evidence-2026-05-20).
>
> **Second-pass validation (2026-05-20):** C′ confirmed — the daemon-safe lock-free property is verified (the generated handler requires only `router/session/memory/intelligence.cjs`, never `memory-router`/`ensureRvfWired`/the flock; corroborated by the real `hooks_post-command` MCP tool routing through `memory-router:936` — proof Option D would have hit F-13-001), the 16-fork/12-upstream/6-unhandled/4-SG-012 inventory is exact, and the build-time subset test is decidable (like 0208's lint). Two adjustments folded in: **(1)** the `hooks_notify` 0210↔0211 relationship is **de-circularized** — pinned as a two-layer split (0211 owns the init `notify` event; 0210 owns the MCP tool), symmetric with 0210's correction #2 (step 3 + the `notify` bullet above + the cross-ADR note). **(2)** step 6's outcome-field evidence is corrected: the field must be read from the local handler's PostToolUse(Task) **stdin payload** (`tool_response`), not inferred from the MCP tool's `params.success` input schema — the fail-loud-if-absent guard stands. Preserved open follow-up: the blanket `try/catch→exit(0)` (`helpers-generator.ts:598`) still swallows *runtime* hook errors, so the build-time subset test is the sole drift guard; removing the `exit(0)` swallow is the second half of truth-in-advertising and remains out of scope. Footnote: a *dangling* `ruflo hooks teammate-idle` CLI subcommand (`commands/hooks.ts:4948`) calls a non-existent MCP tool — a separate pre-existing defect, unrelated to trimming the init wiring.

## Context and Problem Statement

`ruflo init` writes a `.claude/settings.json` whose `hooks` block wires **16** subcommands to the locally-generated `.claude/helpers/hook-handler.mjs`, which implements **11**. Six events fall through to a generic no-op:

```js
// helpers-generator.ts:590-592 (paraphrased)
} else if (command) { console.log('[OK] Hook: ' + command); }
```

The six unmatched: `pre-edit`, `post-command`, `notify`, `user-prompt`, `teammate-idle`, `post-tool-failure`. Each fires on every relevant Claude Code lifecycle event in a fresh init'd project and does nothing (F-02-008). Separately, the `post-task` handler hardcodes `intelligence.feedback(true)` regardless of outcome (F-02-009, `helpers-generator.ts:543-549`) — latent today because the init-emitted `intelligence.cjs` stub's `feedback()` is a no-op, but a poison signal the moment it becomes load-bearing.

The original ADR proposed delegating the missing handlers to MCP tools (Option D). The swarm review establishes that this is the wrong instrument and re-frames both the architecture and the inventory.

### Re-frame 1 — the local handler is daemon-safe *by design*; that property is the point

The current generated handler is **pure in-process Node**, `require()`-ing only local helper modules (`router.js`, `session.js`, `memory.js`, `intelligence.cjs`). Critically, it **never acquires the RVF flock**: it reads `memory.rvf` as a passive byte-level `fs.readFileSync` (with WAL-replay tolerance for torn reads) and writes plain JSON sidecars (`pending-insights.jsonl`, `ranked-context.json`). It never goes through `memory-router` / `getProcessArchivist` / `ensureRvfWired`. **This is why it is the only hook consumer in the system that works under daemon mode** — the daemon holds `.rvf.lock` for its lifetime (F-13-001), and the local handler simply doesn't contend for it.

The original ADR read the local handler as "a parallel implementation duplicating MCP logic, to consolidate away." That is backwards. The local handler touches a *different layer* (local helper modules + file sidecars), not the MCP tool registry, so there is nothing to "consolidate." Its lock-free design is a feature to **preserve**, not a duplication to remove.

### Re-frame 2 — the gap is mostly fork-introduced over-reach, not a feature to build

Upstream `ruvnet/ruflo` wires **12** subcommands; the fork wires **16**. Commit `0cd9c4a39` (SG-012, "Complete hooks", 2026-03-14) added `post-command`, `user-prompt`, `teammate-idle`, `post-tool-failure` to `settings-generator.ts` **without adding handlers** — leaning on the upstream `[OK] Hook:` fallthrough as a silent landing zone. So:

* **4 of the 6** unhandled events (`post-command`, `user-prompt`, `teammate-idle`, `post-tool-failure`) are **fork-introduced** — but `post-command` is a *rename* of upstream's real `post-bash` wire (so really 3 net-new no-backends + 1 rename), which is why it is **kept and implemented** below while the other three are trimmed/disposed. `user-prompt`/`teammate-idle`/`post-tool-failure` have **no working backend** (no `hooks_*` MCP tool, no handler). Trimming them restores fork↔upstream parity and reverts the over-reach.
* **2 of the 6** (`pre-edit`, `notify`) are **upstream-inherited** wire-without-handler gaps (`15664e072`, rUv).
* Both the `[OK] Hook:` fallthrough and the `feedback(true)` bug are **upstream-inherited** (born `4b42218b4`, rUv, 2026-02-09), unfixed upstream — so the fork's fixes re-converge with a latent upstream bug.

### Re-frame 3 — Option D is infeasible, false-premised, blocked, and merge-taxing

* **No in-process MCP path.** The handler is a spawned subprocess; the ruflo MCP server is stdio owned by Claude Code's client (not a broker a third process can dial); `callMCPTool` is in-process to whatever loaded the registry. So delegation = per-hook `ruflo mcp start` cold-spawn (full CLI boot + 200+ tool registry + handshake) — hundreds of ms–>1s on `post-command` (every Bash) / `pre-edit` (every Edit). The template was built to avoid exactly this.
* **Premise false.** Targets: `post-command` = real; `pre-edit` = stub (`fileExists:true` hardcoded); `notify` = stub (`delivered:true`, no persistence); `user-prompt`/`teammate-idle`/`post-tool-failure` = absent. Delegating to a stub/absent target does nothing, more expensively.
* **Regression under default daemon-up (the *lifelong-lock* form is now historical).** When this ADR was drafted, routing through `memory-router → ensureRvfWired` would hit the daemon's **lifelong** `.rvf.lock` (F-13-001) on the highest-frequency events — `LockHeld` failures / 5s stalls. **ADR-0202 (implemented 2026-05-21) replaced the lifetime hold with per-op acquire/release + retry-on-`LockHeld`, so that specific regression no longer exists.** Option D still loses, but now on *cost* — the per-op lock contention on every Bash/Edit plus the per-hook cold-spawn below — not on a lifelong lock. The daemon auto-starts from the SessionStart hook, so daemon-up is the default.
* **Blocked on unbuilt siblings.** Option D depends on 0202 (F-13-001 fix, *accepted but unimplemented*), 0204 (archivist-init, *proposed*), 0210 (`hooks_notify` MCP-tool stub), 0218 (dispatch producer), 0207 (no socket channel). The ADR declared `depends-on:[0201]` only. (Note the 0210↔0211 `notify` relationship is **not** a circular defer but a two-layer split — see step 3 and the cross-ADR note below — so it would not have blocked Option D either; it is listed here only as a target whose backend Option D would have delegated to.)
* **Merge tax.** The fork's `generateHookHandler` is currently structurally identical to upstream (differs only in fail-loud cosmetics + stdin-shape). Option D would rewrite ~280 lines local→MCP-proxy → full-file conflicts on every upstream sync of a surface upstream actively maintains.
* **The intended loud failure is eaten anyway.** The handler wraps every branch in `try/catch → process.exit(0)`; removing only the fallthrough doesn't surface drift at runtime. The real drift guard is a build-time test.

## Decision Drivers

* **Preserve the daemon-safe property** — the local, lock-free handler needs no RVF lock at all; an MCP/Archivist path contends for the daemon's per-op lock (post-ADR-0202) and pays a per-hook cold-spawn, both avoided by keeping the handler local. (Pre-0202 the cost was worse — a lifetime-lock `LockHeld`; that specific regression is now fixed, but the local path remains strictly cheaper.)
* **Re-converge with upstream** — upstream is local-impl and fixes hook persistence in the MCP-*tool* layer, not by init-delegation; trimming the fork over-reach restores parity and keeps the merge tax near zero.
* **Truth-in-advertising** — every wired hook must produce observable effect or be removed; the `[OK] Hook:` fallthrough is a stub-success.
* **Honest signals** — `post-task` must record the real outcome, not hardcoded `true`.
* **No dependency on unbuilt substrate** — the chosen fix must work today, independent of 0202/0204/0210.
* **Build-time over runtime drift detection** — a settings⊆handlers subset test catches the F-02-008 drift class at build, where the signal isn't eaten by the handler's `exit(0)`.
* **Minimal, local, fast** — telemetry hooks (`post-command`, `pre-edit`) fire on every command/edit; a ~10-line local handler beats a process+protocol boundary.

## Considered Options

* **Option A — Implement all 6 events as local handlers.** Some (`user-prompt`/`teammate-idle`/`post-tool-failure`) have no clear semantics or value; implementing them is speculative.
* **Option B — Trim settings to only handled events.** Smallest diff; concedes the inherited `pre-edit` gap that has real value.
* **Option C — Implement the high-value events locally; trim the rest.** Implement `post-command` + `pre-edit`; trim the no-backend events.
* **Option D — Delegate all 6 to MCP tools.** Original choice. Infeasible, false-premised, regressive, blocked, merge-taxing (above). Rejected.
* **Option C′ (chosen) — Implement `post-command` + `pre-edit` locally (lock-free, helper-module idiom); handle `notify` minimally-local or trim; trim the 3 fork-introduced no-backend events; remove the fallthrough + add a build-time subset test; fix `feedback(true)→feedback(success)` locally. Defer MCP delegation.**

## Decision Outcome

**Chosen: Option C′.** Per-event disposition, all preserving the local, lock-free, upstream-shaped handler:

1. **`post-command` (fork-added, high-value): implement locally.** Append a command-telemetry record to a local JSON sidecar in the existing `intelligence.cjs`/`memory.js` idiom (the same lock-free path `post-edit` uses → `pending-insights.jsonl`, folded into RVF later by the daemon's `consolidate` cycle). **Do not** route through `memory-router`/the flock.
2. **`pre-edit` (inherited gap): implement locally.** A cheap local filesystem existence/size check in the handler — not the stub `hooks_pre-edit` MCP tool (which hardcodes `fileExists:true`).
3. **`notify` (inherited; stub MCP tool, no local backend): minimal-local or trim.** Preferred: a minimal local handler that appends the notification to a session sidecar (keeps the upstream-wired event honest). Acceptable: trim from settings (small upstream divergence — upstream's `notify` also no-ops). **Do not** delegate to the `delivered:true` stub. **This step depends on nothing and blocks on nothing — ships now.** Ownership is a clean two-layer split, **not** a circular defer: **0211 owns the init-handler `notify` event** (`settings-generator.ts:573` → `helpers-generator.ts:590-591`); **0210 owns the MCP tool** `hooks_notify` (`hooks-tools.ts:2178/2200`, disposition: delete-or-`_note`-pending). The two are distinct sites at distinct layers (a Claude-Code lifecycle hook firing a spawned `node` subprocess vs. an in-process MCP tool reached via `callMCPTool`). Neither blocks the other. Real cross-agent delivery (which would require transport infra neither layer has) stays deferred to future work, **not** to 0210 — 0210 itself has no delivery backend to defer to.
4. **`teammate-idle`, `user-prompt`: trim** (with specific rationale, not just "over-reach"). **`teammate-idle`** — upstream's own comment (`settings-generator.ts:581-583`, kept verbatim in the fork) records that the real `TeammateIdle` key is **rejected by Claude Code's validator**; SG-012 wired `teammate-idle` under `SubagentStop` instead (a misnamed no-op that displaced the slot upstream uses for the handled `post-task`). **`user-prompt`** — duplicates the already-wired-and-handled `route` on the same `UserPromptSubmit` event, so a second handler would be a no-op on a slot already doing real work. **`post-tool-failure`: disposition OPEN — resolve empirically.** It is wired under `PostToolUseFailure`. The council split: the Claude Agent SDK *types* define `PostToolUseFailure` with an explicit `error: string` as the canonical tool-failure event (which would make it the clean source for Step 6's outcome → **implement** locally), while the upstream analyst found the key is a peer of validator-rejected keys that may never fire from `settings.json` (→ **trim**). **Before disposition, in a fresh init'd sandbox force a tool failure and assert whether the wired `post-tool-failure` handler is invoked:** if it fires → implement locally (it is the failure-telemetry event Step 6 needs); if rejected/never-fires → trim and derive Step 6's outcome from `PostToolUse`'s `tool_response`. Document in template comments why the trimmed events are intentionally unbound.
5. **Remove the `[OK] Hook:` fallthrough** (`helpers-generator.ts:590-592`) **and fix the blanket `exit(0)` swallow** (`:598`, `main().catch(()=>{}).finally(()=>process.exit(0))`). The council folded the `exit(0)` fix **in** (the draft scoped it out): leaving it is the same [[feedback-no-fallbacks]] violation this ADR condemns — a hook that is wired *and* handled but throws at runtime would still silently `exit(0)`, which the build-time subset test cannot catch. Surface true handler failures (outer catch logs + non-zero exit), keeping `exit(0)` only for genuinely best-effort branches. The build-time subset test remains the **drift** guard; this closes the **runtime-failure** half — fixing it here rather than deferring, since removing the fallthrough while leaving the swallow is incoherent.
6. **Fix `feedback(true)` → `feedback(success)` locally** in the `post-task` handler (`helpers-generator.ts:546`). The `intelligence.cjs` stub already accepts `feedback(success)` (the full helper uses it: `success ? +0.05 : -0.02` confidence delta, `intelligence.cjs:677-683` — so the hardcoded `true` actively boosts confidence on *failed* tasks once the full helper is load-bearing). **Precondition (2nd-pass evidence correction):** the outcome field must be read from the **local handler's stdin payload**, NOT inferred from the MCP tool's input schema. `post-task` fires on **PostToolUse matcher:`Task`** (`settings-generator.ts:389`), whose stdin carries `tool_input`/`tool_response` — there is **no guaranteed top-level `success` boolean** (the earlier citation of `hooks_post-task` reading `params.success` is the MCP *tool input schema*, a different surface — what an MCP caller passes, not what Claude Code sends the spawned handler). The implementer MUST confirm the actual PostToolUse(Task) stdin shape and derive the outcome (likely from `tool_response`'s error/status); **fail-loud if no outcome can be derived, rather than defaulting to `true`.** Fully local, no MCP dependency. **Outcome source (couples to step 4):** a genuinely *failed* Task may route to `PostToolUseFailure` rather than `post-task`/`PostToolUse` — so if step 4's empirical test shows `post-tool-failure` fires, use its explicit `error` field as the authoritative failure signal; otherwise derive from `PostToolUse`'s `tool_response` (typed `unknown`, no in-tree precedent). Verify the failing-task signal actually reaches this handler before relying on Confirmation #5.
7. **Defer MCP delegation explicitly — in practice, permanently.** Option D's blockers *other than* F-13-001 (no in-process MCP path → per-hook cold-spawn; false premise — `pre-edit`/`notify` stubs + 3 events absent; full-file merge tax vs an upstream-near-identical handler) are orthogonal to locking and **survive ADR-0202's now-shipped fix**. So even with 0202 implemented and green, Option D remains strictly worse — "defer" is effectively "do not adopt." Frontmatter `depends-on` stays `[0201]` because the chosen fix needs none of the substrate Option D depended on (0202/0204/0210).

### Confirmation

Acceptance check (`adr0211` group, fresh `ruflo init` sandbox per [[feedback-inspect-installed-not-dev-nodemodules]]):

1. **Build-time subset test (primary drift guard):** a unit test asserts the subcommand list emitted by `settings-generator.ts:generateHooksConfig` is a strict subset of the handler keys in `helpers-generator.ts:generateHookHandler`. Fails the build on any wire-without-handler drift — at build time, where the signal isn't eaten by the handler's `exit(0)`. This is the load-bearing F-02-008 guard.
2. **`post-command` local effect:** fire the event; assert a command-telemetry record appears in the local sidecar — and assert it does **not** acquire `.rvf.lock` (daemon-safe: run with the daemon up and confirm no `LockHeld`).
3. **`pre-edit` local effect:** fire on a missing file; assert the handler's real FS check reflects non-existence (not the stub's hardcoded `fileExists:true`).
4. **Trim verification:** assert `settings.json` from a fresh init does **not** wire `user-prompt`/`teammate-idle`/`post-tool-failure` (and `notify` per the chosen sub-option); assert no `[OK] Hook:` fallthrough remains in the generated handler.
5. **`feedback(success)`:** drive a deliberately failing task, fire `post-task`, assert the recorded feedback carries `success:false` (not hardcoded `true`); assert fail-loud if the payload lacks an outcome field.
6. **Daemon-safety regression guard:** with the daemon running, fire `post-command`/`post-edit`/`post-task` repeatedly; assert zero `LockHeld`/30s-stall — proving the fix preserves the current path's daemon-safe property (the property Option D would have destroyed).
7. **Parity note:** `diff` the fork's `generateHookHandler` against upstream stays minimal (local-impl shape preserved); the ledger records the trims + the two local implementations.

### Consequences

* Good, because every wired hook produces observable effect or is removed — F-02-008 drift class closed, with the build-time subset test preventing recurrence.
* Good, because the `feedback(true)` poison-signal is fixed locally before it becomes load-bearing.
* Good, because the daemon-safe, lock-free property of the local handler is **preserved** — the fix works under default daemon-up mode, where Option D would have regressed every high-frequency hook to `LockHeld`.
* Good, because trimming the SG-012 over-reach re-converges with upstream and keeps the init-handler merge tax near zero (no local→MCP-proxy rewrite).
* Good, because it depends on nothing unbuilt — ships today, unlike Option D (blocked on 0202/0204/0210).
* Bad, because `notify`'s real cross-agent delivery stays unimplemented (minimal-local-log or trim is honest interim; real delivery deferred).
* Bad, because the true *runtime* loud-failure on drift still requires removing the handler's blanket `exit(0)` swallow — deferred; the build-time test is the interim guard.
* Neutral, because users on the existing `[OK] Hook:` no-op surface see `post-command`/`pre-edit` start doing real (local) work and the 3 phantom events disappear from settings on re-init.

## Pros and Cons of the Options

### Option C′ — implement-local high-value + trim over-reach (chosen)
* Good, because preserves the daemon-safe lock-free property, re-converges with upstream, ships without the broken substrate, and fixes both real bugs.
* Good, because trims revert a fork over-reach rather than build speculative handlers.
* Bad, because `notify` real delivery and the runtime-loud-failure-on-drift remain deferred.

### Option D — delegate to MCP (original)
* Good, because in theory consolidates logic at the MCP layer.
* Bad, because there is no in-process MCP path (per-hook cold-spawn), the premise is false for half the events, it regresses every high-frequency hook to `LockHeld` under default daemon-up, it depends on four unbuilt sibling ADRs, and it forks the init-handler architecture from upstream (full-file merge tax). Infeasible *and* harmful.

### Options A / B / C
* A — implements speculative no-value events. B — trims the valuable `pre-edit` too. C — the right shape; C′ refines it with the explicit `notify` sub-decision, the daemon-safety guard, and the build-time subset test as the real drift guard.

## Swarm review evidence (2026-05-20)

Six-expert review; verified against fork HEAD and upstream `ruvnet/ruflo`.

* **Init Architect** — handler is in-process Node, no MCP client; Option D ⇒ per-hook `ruflo mcp start` cold-spawn (hundreds of ms–>1s); targets are 1 real / 2 stub / 3 absent; `feedback` fix separable. Split.
* **Runtime-Path** — **decisive:** the current handler is the only daemon-safe consumer because it bypasses the Archivist/RVF-lock (passive byte read + JSON sidecars, no flock); Option D hits F-13-001 on every Bash/Edit under default daemon-up = strict regression; acceptance criteria unsatisfiable (notify/pre-edit stubs); intended loud-failure eaten by `try/catch+exit(0)`.
* **Code Archaeologist** — both bugs born upstream (`4b42218b4`); wire-without-handler drift (handler never had MCP); two-path conflation (init handler local vs `ruflo hooks`→`callMCPTool` in-process); undeclared deps on 0202/0204/0210/0218/0207; 0203 precedent is server-side, doesn't transfer.
* **Upstream Analyst** — 4 of 6 events fork-introduced (SG-012 `0cd9c4a39`); 2 inherited; upstream decisively local-impl; upstream fixes the defect class in the MCP-tool layer (#1058→PR#1539/ADR-073), not by init-delegation; full-file merge tax.
* **Devil's Advocate** — Option D blocked on 0202/0204/0210; strictly worse than the current no-op; ~~circular dep with 0210's `notify`~~ (corrected in the 2026-05-20 second pass: the 0210↔0211 `notify` relationship is a two-layer split, not a circular dep — see step 3 and the cross-ADR note); upstream byte-identical local-impl; split into the two cheap fixes + implement-local-2 + trim.
* **Queen** — synthesis: reject D; preserve the daemon-safe local handler; implement `post-command`+`pre-edit` locally; trim the 3 fork over-reach (+`notify` minimal-local/trim); fix `feedback` locally; build-time subset test; defer MCP delegation. Option C′.

### Second council re-validation (2026-05-22)

A fresh 6-expert council re-verified ADR-0211 against fork HEAD + upstream. **Option C′ re-affirmed** — the lock-free daemon-safe property is real (the generated handler `require()`s only local helpers, never `memory-router`/the flock), the build-time subset test is mechanically decidable (precedent: `init-commands-map-completeness.test.mjs`), the 16/12/11/6 inventory is exact, both bugs are upstream-inherited (`4b42218b4`, unfixed upstream), and the handler is ~95% byte-identical to upstream (so Option D's local→MCP rewrite would conflict every sync). Corrections folded in:

* **Headline argument re-grounded:** the "Option D hits the daemon's *lifelong* `.rvf.lock` → `LockHeld` on every hook" reasoning is **now historical** — ADR-0202 shipped 2026-05-21 (per-op acquire/release + retry), so the lifetime-lock regression no longer exists. D still loses, but on **cold-spawn cost + false premise + merge tax + architecture divergence** (all orthogonal to 0202 and verified) — so "defer MCP delegation" is effectively "do not adopt," not a condition awaiting 0202.
* **`exit(0)` swallow folded into scope** (`helpers-generator.ts:598`): leaving it silently `exit(0)`s a wired-and-handled hook that throws at runtime — the no-fallbacks violation the ADR condemns. The build-time test only catches *drift*; fix the swallow here to catch *runtime failure*.
* **Trim refined with specific rationale:** `teammate-idle` trim (validator-rejected key, misnamed under `SubagentStop`), `user-prompt` trim (duplicates the already-handled `route` on `UserPromptSubmit`). **`post-tool-failure` left OPEN pending an empirical test** — the SDK types define `PostToolUseFailure` (→ implement, and it is the clean source for Step 6's failure outcome) but it may be a validator-rejected `settings.json` key (→ trim). This is the one genuine expert split (feasibility/devil's-advocate vs upstream); resolve by firing a real failure in a sandbox.
* **`post-command` is a rename of upstream's `post-bash`** (3 net-new + 1 rename), which is why it's kept-and-implemented while the 3 net-new no-backends are trimmed/disposed — the disposition asymmetry is principled.
* **Cosmetic:** `depends-on`→`[0201]`; the `intelligence.cjs:677-683` `+0.05/-0.02` delta is in the *runtime* full helper, not the init-emitted stub (which is a no-op accepting `feedback(success)`); `stats` is a CLI-only handler key never wired to an event (the subset test still holds).

## More Information

* ADR-0201 findings F-02-008 (init handler gaps), F-02-009 (`feedback(true)`); F-02-010 (cli-core schema drift); F-01-002 (parallel `@claude-flow/hooks` package).
* **Cross-ADR (the dependencies Option D had, that C′ avoids):** ADR-0202 (F-13-001 daemon RVF lock + open F-13-002/F-13-009 — accepted, unimplemented), ADR-0204 (MCP server archivist-init / schema validation), ADR-0210 (the `hooks_notify` **MCP tool** stub at `hooks-tools.ts:2178/2200`), ADR-0218 (dispatch-queue producer), ADR-0207 (no socket channel). ADR-0203 governs the *server-side* `@claude-flow/hooks` package — a different layer.
* **`notify` two-layer split (de-circularized, both ADRs agree):** **0211 owns the init-handler `notify` event** (`settings-generator.ts:573` → `helpers-generator.ts:590-591`) — handle minimally-local or trim, now. **0210 owns the MCP tool** `hooks_notify` (`hooks-tools.ts:2200`) — delete or `_note`-pending. Distinct sites, distinct layers; neither blocks the other. ADR-0210's 2026-05-20 second-pass already pins this same split (its correction #2 / decision step 4); this ADR's earlier "0210 circularly defers `notify` here" framing was stale and is corrected above.
* **Lineage:** `4b42218b4` (rUv — `feedback(true)` + fallthrough born), `15664e072` (rUv — `pre-edit`+`notify` wiring), `0cd9c4a39` (fork SG-012 — 4 phantom wirings).
* **Upstream:** local-impl handler `ruvnet/ruflo/v3/@claude-flow/cli/src/init/helpers-generator.ts` + shipped `.claude/helpers/hook-handler.cjs` (zero `mcp__`/`child_process`); upstream settings wires 12 (`settings-generator.ts`); issue #1058 (MCP-tool-side fix, PR #1539/ADR-073).
* **Key sites:** `forks/ruflo/v3/@claude-flow/cli/src/init/helpers-generator.ts` (handlers 369-601; fallthrough 590-592; feedback 543-549; stub 806), `settings-generator.ts:323-585` (16-event wiring; direct `node` invoke 244-249), `mcp-tools/hooks-tools.ts` (`hooks_post-command` real ~915; `hooks_pre-edit` stub ~783; `hooks_notify` stub 2178/2200), `.claude/helpers/{hook-handler.mjs,intelligence.cjs}` (lock-free file-based path), `memory/memory-router.ts` (the flock path C′ avoids).
* **Memory:** [[feedback-no-fallbacks]], [[feedback-corpus-evidence-before-feature-work]], [[feedback-upstream-means-upstream]], [[feedback-remediation-adr-preflight]] (all four checks fired here), [[feedback-inspect-installed-not-dev-nodemodules]], [[feedback-no-squelch-tests]].

## Amendment — 2026-05-23 (Move A audit, implemented)

Status flipped: **proposed → implemented**. Option C′ shipped in `forks/ruflo` HEAD.

**Verified sites:**

- `src/init/executor.ts:268` — emits `hook-handler.mjs` via `generateHookHandler()`.
- `src/init/settings-generator.ts:351,387,571` — wires only `pre-edit`, `post-command`, `notify` (handled).
- `src/init/settings-generator.ts:415-421,546-551,553-562` — trim markers for `user-prompt`, `teammate-idle`, `post-tool-failure` with ADR-0211 step-4 rationale comments.
- `src/init/helpers-generator.ts:551-578` — `post-task` reads `tool_response` from stdin and calls `intelligence.feedback(outcome)` (no more hardcoded `true`); fails loud if outcome can't be derived.
- `src/init/helpers-generator.ts:580-595` — `post-command` handler (lock-free, helper-module idiom).
- `src/init/helpers-generator.ts:597-617` — `pre-edit` handler (real `fs.existsSync`/`statSync`).
- `src/init/helpers-generator.ts:619-630` — `notify` minimal-local handler.
- `src/init/helpers-generator.ts:671-680` — `[OK] Hook:` fallthrough removed; reaching the else-if exits non-zero with `[FAIL]`.
- `src/init/helpers-generator.ts:690-695` — blanket `exit(0)` swallow removed (`main().catch(err => log + exitCode=1).finally(exit(exitCode))`).

**Test:** `__tests__/init/adr0211-hook-handler-event-completion.test.ts` — 8/8 pass (subset, post-command, pre-edit, trim, no-fallthrough, no-exit(0)-swallow, feedback(success), daemon-safe/no-flock).

**Deferred (carried forward, explicitly out of scope):**

- `notify` real cross-agent delivery — requires transport infra neither layer has.
- `post-tool-failure` empirical sandbox test — current disposition is default-trim.
- `ruflo hooks teammate-idle` CLI subcommand dangling at `commands/hooks.ts:4948` (pre-existing defect, separate scope).

No INTEGRATION-LEDGER row (fork-only change; upstream still carries the inherited bugs via `4b42218b4`).
