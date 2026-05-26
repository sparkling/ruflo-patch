---
status: accepted
completed: true
date: 2026-05-19
implemented-date: 2026-05-22
tags: [config, env-vars, init, canonicalization, swarm-reviewed]
supersedes: []
depends-on: [0201, 0118]
implements: []
---

# Canonicalize config env vars — remove theatrical, fix naming-skew

> **Confirmed (with corrections) after a 6-expert swarm review (2026-05-20).** Unlike the rest of the ADR-0201 batch, the core decision survives: the "theatrical = zero consumers" premise is **empirically true** (the 4 injected vars have zero runtime reads, verified against dynamic/dotenv trap sites), and aligning **writers→readers** is the right direction (the reader names are the older, schema-anchored, upstream-canonical side). But the draft had real errors: (1) the **"one-file fix" scope is false** — `CLAUDE_FLOW_HOOKS_ENABLED` (and `V3_ENABLED`) are *also* injected into `.claude/settings.json` via `settings-generator.ts`/`executor.ts`, so removing them from `.mcp.json` alone leaves them leaking into `process.env`; (2) the acceptance gate's literal `process.env.X` grep has a **blind spot for dynamic readers** (`feature-flags.ts` reads 9 live `CLAUDE_FLOW_ENABLE_*` vars via template access); (3) the **MODE rationale is wrong** (USERGUIDE documents it as a dev/prod/integration switch — a value collision, not a tautology) and the doc-delete misses its sites; (4) **doc-alignment is incomplete** (USERGUIDE documents the writer name `TOPOLOGY`, not `SWARM_TOPOLOGY`); (5) it's a **recurring fork patch, not "local"** (all defects upstream-inherited byte-for-byte). Plus minor fixes (enum citation, RUFLO_ count, Option-C provenance). See [Swarm review evidence](#swarm-review-evidence-2026-05-20).
>
> **Second-pass validation (2026-05-20).** Consumer-trace re-verified the decisive premise empirically: **all 5 theatrical vars have zero non-test/non-dist consumers**, explicitly including the suspicious `CLAUDE_FLOW_HOOKS_ENABLED` (no hook script, hook router, or settings gate reads it; the only `process.env` reads of these 5 live in the unpublished `archive/v2` `claude-flow` package, which is absent from `config/package-map.json` and does not ship). Rename value-safety also confirmed for *non-default* configs (init's `topology`/`memoryBackend` TS unions ⊂ the loader's Zod sets, and the loader `.includes()`-guards with silent fallback). But the second pass found **three further scope/count errors** (one is the same 0213-class miscount): (1) **F-14-003 undercounts** — the audit table enumerates **14** dead-doc vars (its own heading says "12"), and a 15th, `CLAUDE_FLOW_TOKEN` (`USERGUIDE:7045`, zero consumer), is missing from the audit entirely; the split is **5 annotate + 10 delete (+TOKEN=11)**, not "5+7=12"; (2) **the `settings.json env` block also injects 9 zero-consumer `GUIDANCE_*` vars** (`settings-generator.ts:69-77`) + `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` — the *same* theatrical-leak class this ADR claims to close, in the *same block*; the gate as written ("every env var in settings.json env has a consumer") is unshippable until they're scoped/resolved (corrected below); (3) the **ADR-0192/0193 citation is unsubstantiated** — neither ADR mentions env vars or config.json (the autopilot-deletion rationale stands on zero-consumers alone). Decision (Option A) unaffected.

## Context and Problem Statement

The 2026-05-19 audit (ADR-0201, slice 14) found the `CLAUDE_FLOW_*` env-var surface is partial fiction: users edit env vars that init writes, USERGUIDE documents, and `.mcp.json` injects — but most have **no source consumer** (the substrate reads `.claude-flow/config.json` instead).

* **F-14-001 (CRITICAL).** Init injects four theatrical `CLAUDE_FLOW_*` vars (`MODE=v3`, `HOOKS_ENABLED=true`, `TOPOLOGY=hierarchical-mesh`, `MEMORY_BACKEND=hybrid`) with **zero non-test consumers** (empirically re-confirmed by the swarm). `MAX_AGENTS` is the only injected var the loader reads.
* **F-14-002 (CRITICAL).** Naming skew: init emits `CLAUDE_FLOW_TOPOLOGY`/`MEMORY_BACKEND` (`mcp-generator.ts:82-86`); the Zod loader reads `CLAUDE_FLOW_SWARM_TOPOLOGY`/`MEMORY_TYPE` (`@claude-flow/shared/src/core/config/loader.ts:103,142`). Neither side sees the other.
* **F-14-003 (CRITICAL).** USERGUIDE documents **15** additional zero-consumer `CLAUDE_FLOW_*` vars (the audit table enumerates 14 — its heading miscounts as "12" — plus `CLAUDE_FLOW_TOKEN` @`USERGUIDE:7045`, which the audit itself omitted).

The legitimate readers work: the loader reads `MAX_AGENTS` (`:80`), `MEMORY_TYPE` (`:103`), `MCP_TRANSPORT` (`:115`), `MCP_PORT` (`:128`), `SWARM_TOPOLOGY` (`:142`), plus `HEADLESS`/`CONFIG`/`DATA_DIR`/`DAEMON`/`STRICT`/`DEBUG`/`CWD`/`MEMORY_PATH`. There are **also 9 live `CLAUDE_FLOW_ENABLE_*` feature-flag vars** read *dynamically* via `integration/src/feature-flags.ts:427` (`process.env[\`CLAUDE_FLOW_${flag}\`]`) that the slice-14 literal grep did not enumerate — important for the gate (below).

### Corrections from the swarm review (what the draft got wrong)

* **Scope is not one file.** `CLAUDE_FLOW_HOOKS_ENABLED` is injected in **three** init sites: `mcp-generator.ts:83` (→ `.mcp.json`), `settings-generator.ts:67` and `executor.ts:342` (→ `.claude/settings.json` `env`). `CLAUDE_FLOW_V3_ENABLED` (a second zero-consumer var slice-14 missed because it lives only in `settings.json`) is at `settings-generator.ts:66`/`executor.ts:341`. Claude Code injects `settings.json` `env` into the session, so removing only the `.mcp.json` copy leaves the var live. The fix must cover all injection sites.
* **The same `settings.json env` block leaks 9 `GUIDANCE_*` vars (second-pass finding).** `settings-generator.ts:69-77` also injects `GUIDANCE_EVENT_WIRING_ENABLED`, `GUIDANCE_PRE_EDIT_HOOK`, `GUIDANCE_POST_COMMAND_SENTINEL`, `GUIDANCE_TEAMMATE_IDLE_HOOK`, `GUIDANCE_POST_TOOL_FAILURE`, `GUIDANCE_SESSION_SENTINEL`, `GUIDANCE_AUTO_MEMORY`, `GUIDANCE_LEARNING_BRIDGE`, `GUIDANCE_STATUS_LINE` — **all zero-consumer** (no `process.env`/shell/by-name reader anywhere in the fork, incl. the `guidance` package). This is the *same* theatrical-leak class, in the *same block*. They belong to the fork's `guidance` package (pre-edit/post-command/teammate-idle sentinels) and were **fork-introduced** by commit `0cd9c4a39` (the SG-012 init-patch port; absent from upstream), NOT upstream-inherited. **They have no live ADR owner** — ADR-0192/0193/0195 are autopilot-*learning* ADRs (all `implemented`) that never mention `GUIDANCE_*`, `settings.json`, or env vars (the earlier "owned there, not here" attribution was an overreach, corrected 2026-05-22). Since they are a fork-introduced, zero-consumer leak in the *same* `settings.json` block this ADR already edits, **this ADR absorbs their removal** (Step 1) — one block, one owner — rather than punt to closed doors. (This also makes Confirmation #1 self-satisfiable; see below.) The 11th block entry, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`, is in **Claude Code's own namespace** (read by Claude Code, not ruflo) → out of this ADR's `CLAUDE_FLOW_*` scope by namespace ownership, legitimately kept. The gate (Confirmation #1) is corrected accordingly below.
* **MODE is a value collision, not a tautology.** The draft justified dropping `MODE` as "self-evidently v3." But USERGUIDE documents `CLAUDE_FLOW_MODE` as `development|production|integration` (USERGUIDE:6932/6960/7060), and init writes `v3` into that key. It's still droppable (zero readers, all values), but the rationale is wrong and the doc-delete list must include those MODE sites.
* **Doc-alignment is incomplete.** USERGUIDE documents the *writer* name `CLAUDE_FLOW_TOPOLOGY` (6975) and **not** `SWARM_TOPOLOGY` (0 occurrences); for memory it documents both, with `MEMORY_TYPE` as the table form (6964/7073). So aligning writers→readers requires rewriting *all* affected doc sites to the reader name — not just deleting a dead-doc list.
* **The `CLAUDE_FLOW_*` defects are upstream-inherited byte-for-byte** (writer `6a356ffe6`, reader `53cfd8a53`, docs `81418649c` — all `rUv`/`Reuven`) — **but the 9 `GUIDANCE_*` vars are fork-introduced** (`0cd9c4a39`, the SG-012 port; zero upstream matches), so the blanket "all defects upstream-inherited byte-for-byte" framing is corrected (2026-05-22). The `CLAUDE_FLOW_*` fix is a **recurring fork patch** on hot files (`mcp-generator.ts`, `USERGUIDE.md`) that drifts back each sync; the `GUIDANCE_*` removal is the fork cleaning up its own init patch (no recurring tax).

The corpus walk confirms (per [[feedback-no-fallbacks]]) this is configuration pretense, not graceful degradation: users believe knobs work; the system ignores them.

## Decision Drivers

* **Honesty** — every env var the user sees (in `.mcp.json`, `.claude/settings.json`, USERGUIDE, CLAUDE.md) must be read by source or removed/annotated. Per [[feedback-no-fallbacks]], theatrical config is the same anti-pattern shape as a silent fallback.
* **Canonical naming** — one name per concept across writer (init), reader (loader), docs. The reader names (`SWARM_TOPOLOGY`/`MEMORY_TYPE`) are the older, schema-anchored, **upstream-canonical** forms.
* **Align writers, not readers** — readers feed the Zod schema 17 substrate packages integrate against and are upstream-tracked; renaming readers (Option B) forks the loader from upstream permanently. Aligning writers is contained and value-safe (init's defaults are members of the loader's allowed sets).
* **The decision rests on reader-name canonicality, not a config.json migration** — the reader names (`SWARM_TOPOLOGY`/`MEMORY_TYPE`) are the older, schema-anchored, Zod-validated upstream forms; that is the solid ground for aligning writers→readers. *(Correction 2026-05-22: the earlier "#1194/#1854/#1185 = upstream moving to config.json" framing is overstated — those are **fork-filed** patch issues, #1194 closed NOT_PLANNED, upstream `ruvnet/ruflo` still emits `CLAUDE_FLOW_MEMORY_BACKEND` in 3 sites, and #1854 actually requests env-var precedence to **work**. So "delete + wait for upstream's config.json migration" is NOT advisable — upstream is not migrating; align the writers now, as the standing fork patch this ADR provisions.)* `RUFLO_*` (Option C) has no upstream momentum (≈19:1 `CLAUDE_FLOW_*` reads upstream) and ADR-0118 documents `CLAUDE_FLOW_*` as the runtime convention "NOT RUFLO_*."
* **Complete scope** — fix every injection site (incl. `settings.json`) or the var still leaks; the gate must catch dynamic readers and both files.
* **Annotate, don't delete, wireable docs** — for vars with a real planned consumer, keep the doc with a "not yet wired" note rather than delete-then-re-add churn.

## Considered Options

* **Option A — Remove theatrical injected vars (all sites); align init's surviving emissions to the loader's reader names; clean dead-doc vars from USERGUIDE.** Chosen.
* **Option B — Wire the theatrical vars / align readers to writers.** Wiring `MODE`/`HOOKS_ENABLED` invents behavioural meaning; renaming readers forks the loader from upstream and fights upstream's config.json direction. Rejected.
* **Option C — `RUFLO_*` prefix flip.** No upstream momentum; contradicts ADR-0118's documented `CLAUDE_FLOW_*` convention; huge surface; deprecation aliases live forever. Rejected.
* **Option D — Mixed wire/drop.** Reproduces upstream's "some work, some don't" failure mode. Rejected — though its *per-var* instinct is partly right for the doc-rewrite (topology vs memory differ in which name is documented).

## Decision Outcome

**Chosen: Option A**, corrected and complete:

1. **Remove the theatrical injected vars at ALL sites:**
   * `.mcp.json` emitter — drop `CLAUDE_FLOW_MODE`, `HOOKS_ENABLED`, `TOPOLOGY`, `MEMORY_BACKEND` from `mcp-generator.ts:82-86` (keep `MAX_AGENTS`; rename per step 2).
   * `.claude/settings.json` `env` emitter — drop `CLAUDE_FLOW_HOOKS_ENABLED` and `CLAUDE_FLOW_V3_ENABLED` from `settings-generator.ts:66-67` and the merge-preserve at `executor.ts:341-342`, **AND the 9 zero-consumer `GUIDANCE_*` vars at `settings-generator.ts:69-77`** (folded into this ADR's scope per the 2026-05-22 council — they are fork-introduced, have no other ADR owner, and sit in the same block; see the GUIDANCE correction below). Edit **both** settings-write paths — fresh-init (`generateSettings`/`generateSettingsJson`) and upgrade (`mergeSettingsForUpgrade`, which hardcodes the vars independently). (This is the scope the draft missed; without it the vars still leak into `process.env`.)
2. **Align the surviving emissions to the loader's reader names:** `CLAUDE_FLOW_TOPOLOGY`→`SWARM_TOPOLOGY`, `CLAUDE_FLOW_MEMORY_BACKEND`→`MEMORY_TYPE`. Value-safe — init's defaults (`hierarchical-mesh`, `hybrid`) are members of the loader's allowed sets (`MEMORY_TYPE`: `sqlite|agentdb|hybrid|redis|memory` at `loader.ts:105`; `SWARM_TOPOLOGY`: `hierarchical|mesh|ring|star|adaptive|hierarchical-mesh` at `:144`). *(Corrects the draft's enum citation — there is no `json` value.)*
3. **Rewrite USERGUIDE completely**, not just delete: replace the writer-named doc sites (`CLAUDE_FLOW_TOPOLOGY` @6975; `MEMORY_BACKEND` @3229) with the canonical reader names; **fix the `MEMORY_TYPE` doc value list** (`USERGUIDE:6964` lists a bogus `json` value — the loader accepts only `sqlite|agentdb|hybrid|redis|memory`); delete the MODE sites (6932/6960/7060) and the **11 "should-delete" dead-doc vars (incl. `CLAUDE_FLOW_TOKEN` @7045)**; **annotate** (not delete) the 5 "could-be-wired" vars (`LOG_LEVEL`, `HNSW_M`, `HNSW_EF`, `EMBEDDING_DIM`, `SECURITY_MODE`) with a "not yet wired (tracked: #issue)" note, and fix the `EMBEDDING_DIM` doc default (384 → 768, the canonical model dim per [[reference-embedding-model]]).
4. **Record as a standing fork patch:** add INTEGRATION-LEDGER `superseded-by-local` rows for the `mcp-generator.ts`/`settings-generator.ts` env blocks and the USERGUIDE env section, since the skew + theatrical vars are upstream-inherited and will drift back on each sync ([[feedback-update-integration-ledger]]).
5. **The 15 dead-doc vars split (corrected):** 5 "could-be-wired" → *annotate + track* (don't delete) — `LOG_LEVEL`, `HNSW_M`, `HNSW_EF`, `EMBEDDING_DIM`, `SECURITY_MODE` — **but only with a real wiring follow-up (a dated issue/ADR with a committed owner); absent that, delete them too**, since "annotate + track" with no committed owner is the same defer-dead-docs squelch this ADR condemns (keep the `EMBEDDING_DIM=384→768` doc-fix either way); **11 "should-delete"** → delete — the 10 audit-table autopilot/context/tool vars (`ENV`, `CONTEXT_AUTOPILOT`, `CONTEXT_WINDOW`, `AUTOPILOT_WARN`, `AUTOPILOT_PRUNE`, `COMPACT_RESTORE_BUDGET`, `RETENTION_DAYS`, `AUTO_OPTIMIZE`, `TOOL_GROUPS`, `TOOL_MODE`) **plus `CLAUDE_FLOW_TOKEN`** (`USERGUIDE:7045`, the var the audit missed). (Was mis-stated as "5+7=12"; the audit table has 14 rows + TOKEN = 15.) Correct the autopilot rationale: the deletion is justified by *zero consumers*, not by a `controllers.autopilot.*` config substrate (which does not exist — only `autopilot-state.json` runtime state does).

### Confirmation

Three acceptance gates, all corrected for the scope + dynamic-reader findings:

1. **Theatrical-var gate (both injection surfaces).** Assert every env var present in init-generated `.mcp.json` **AND** `.claude/settings.json` `env` has ≥1 non-test, non-dist source consumer — **allowlisting only** (a) the dynamic `CLAUDE_FLOW_ENABLE_*` set (read via the `process.env[\`CLAUDE_FLOW_${...}\`]` template loop at `feature-flags.ts:427`) and (b) the foreign `CLAUDE_CODE_*` namespace (owned/read by Claude Code, not ruflo). The consumer scan MUST match **literal, bracket, and template** access (`process.env.X`, `process.env['X']`, the dynamic template form) so the 9 live `CLAUDE_FLOW_ENABLE_*` vars are not false-flagged. Must pass on `MAX_AGENTS`/`SWARM_TOPOLOGY`/`MEMORY_TYPE` (+ the live `ENABLE_*` set + `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`); must fail pre-fix on `MODE`/`HOOKS_ENABLED`/`TOPOLOGY`/`MEMORY_BACKEND`/`V3_ENABLED` **and on the 9 `GUIDANCE_*` vars** — and **this ADR removes all of them (Step 1)**, so the gate goes green at 0214-merge with **no dependency on any sibling ADR** (the earlier "stays red until ADR-0192/0193/0195 act" was an unshippable cross-ADR coupling to ADRs that never owned `GUIDANCE_*`; corrected 2026-05-22 — remove, don't punt). (Scoping the gate to `CLAUDE_FLOW_*`-only would re-bury the leak — don't; remove instead.) **The `CLAUDE_FLOW_ENABLE_*` allowlist is a safety net only:** init injects **zero** `ENABLE_*` vars into `.mcp.json`/`settings.json` (and `@claude-flow/integration`, their reader, is not a shipped-CLI dependency), so the template-matching machinery guards a false-positive that cannot occur in init output — a simple prefix exclusion suffices.
2. **Naming-alignment gate.** Every var `mcp-generator.ts` / `settings-generator.ts` emit matches a name the loader (or the `feature-flags.ts` dynamic loop) reads. **Runtime check (2026-05-22):** in a fresh init'd project, set a non-default value and confirm the renamed `SWARM_TOPOLOGY`/`MEMORY_TYPE` emissions actually **reach and are honoured by the loader** — otherwise the rename is itself theatre, and delete-all-no-rename (drop the override, point at config.json) is the better call.
3. **USERGUIDE coverage gate.** Every `CLAUDE_FLOW_*` var documented in USERGUIDE has a consumer OR a "not yet wired" annotation; no doc names a var no code reads-or-plans. Catches the writer-named topology doc (6975) and the MODE sites.

### Consequences

* Good, because every injected var (across both `.mcp.json` and `settings.json`) gets a real consumer or is removed — the theatrical surface fully closes, not just the `.mcp.json` half.
* Good, because canonical reader names (`SWARM_TOPOLOGY`/`MEMORY_TYPE`) win, keeping the fork on the upstream loader contract and inside the Zod allowed-value validation.
* Good, because the gate now catches dynamic readers, so it won't false-fail real consumers (or false-pass a leaking `settings.json` var).
* Good, because the 5 wireable docs are annotated, not churned away, preserving discoverability of intended features; the `EMBEDDING_DIM=384→768` doc bug gets fixed instead of hidden.
* Bad, because this is a **recurring fork patch** on upstream-hot files (`mcp-generator.ts`, `USERGUIDE.md`): the skew is upstream-inherited, so each sync re-introduces it. Mitigation: the gate is a standing trip-wire + ledger rows.
* Bad, because users with custom `.mcp.json` edits on the old names must migrate (init regenerates on re-run).
* Neutral, because `RUFLO_*` (Option C) is deferred — and the deferral is correct: it has no provenance and would reverse ADR-0118's documented convention (2 inherited `RUFLO_*` `process.env` consumers exist, cross-fork: `RUFLO_PROVIDER` in `forks/ruflo` `agent-execute-core.ts:95`, `RUFLO_SESSION_ID` in `forks/agentdb` `archivist/index.ts:1056`).
* Neutral, because the Zod schema-validation work (F-14-014) and NaN-validation (F-14-015) remain separate ADRs.

## Pros and Cons of the Options

### Option A — remove theatrical (all sites), align writers→readers, clean docs (chosen)
* Good, because the premise is empirically verified, the direction is upstream-canonical + value-safe, and (corrected) the scope covers every injection site + the gate catches dynamic readers.
* Bad, because recurring fork-patch maintenance on hot files (ledger-tracked).

### Option B — wire theatrical / align readers to writers
* Bad, because wiring `MODE`/`HOOKS_ENABLED` invents meaning; renaming readers forks the loader from upstream and fights upstream's config.json direction (#1194).

### Option C — `RUFLO_*` flip
* Bad, because no upstream momentum, contradicts ADR-0118's `CLAUDE_FLOW_*` convention, enormous surface, perpetual aliases.

### Option D — mixed wire/drop
* Bad as a wiring policy (reproduces "some work, some don't"); its per-var instinct is only relevant to the *doc-rewrite* (topology documents the writer name, memory the reader name).

## Swarm review evidence (2026-05-20)

* **Config Architect** — F-14-001 verified (4 vars zero consumers); direction right because reader names are upstream-canonical + Zod-validated; **scope correction:** `HOOKS_ENABLED`/`V3_ENABLED` also in `settings.env`; enum citation bug.
* **Consumer-Trace (empirical)** — premise TRUE: 4 vars zero reads, confirmed against the trap sites (`executor.ts` reads settings not `process.env`; `rvfa-builder` spawn-env no read-back; `feature-flags.ts` dynamic reader consumes only `ENABLE_*`). 13 live vars genuinely read. **RUFLO_ = 2 not 1.** 9 `ENABLE_*` vars live via dynamic loop.
* **Upstream Analyst** — all defects 100% upstream-inherited (byte-identical) → recurring fork edit on hot files → INTEGRATION-LEDGER disposition needed; upstream moving to config.json (#1194) → B fights upstream; C no momentum. Endorse A.
* **Code Archaeologist** — skew is upstream parallel-authorship (reader Jan-4 canonical `53cfd8a53`; writer Jan-5 drift `6a356ffe6`) → align writers right; ADR-0069 separate (confirmed); **Option C/RUFLO_ has no provenance** (not in `project-config-gaps`; ADR-0118 sets `CLAUDE_FLOW_*` as the convention).
* **Devil's Advocate** — **strongest: the "one-file fix" scope is false** (`HOOKS_ENABLED` survives via `settings.json`); the gate's literal grep has a dynamic-reader blind spot; MODE rationale wrong (documented dev/prod switch — value collision) + doc-delete misses MODE sites; doc-alignment direction split (topology documents writer name); annotate-don't-delete the 5; autopilot "config substrate" claim unsubstantiated. Rename is value-safe; A's *core* works but must absorb the scope fix.
* **Queen** — synthesis: **Option A confirmed**, with corrections (all-sites scope incl. `settings.json`+`V3_ENABLED`; gate scans both files + bracket/template forms + excludes the live `ENABLE_*` set; MODE rationale + doc sites; complete USERGUIDE rewrite; annotate the 5 + fix `EMBEDDING_DIM` doc; recurring-fork-patch + ledger; enum/RUFLO_/autopilot-reason fixes).

### Second council re-validation (2026-05-22)

A fresh 6-expert council re-verified ADR-0214. **Option A's remove-half re-affirmed (well-evidenced):** the 4 `.mcp.json` theatrical vars + `V3_ENABLED` + the 9 `GUIDANCE_*` are all zero-consumer in shipping code (the only read is non-shipping `archive/v2`); the writer↔reader naming skew is real; the rename is value-safe (init defaults ∈ the loader's Zod sets). But "A as written cannot ship" — corrections folded in:

* **MUST-FIX — fold the 9 `GUIDANCE_*` removal into Step 1.** They are fork-introduced (`0cd9c4a39`, not upstream-inherited), zero-consumer, in the same `settings.json` block, and have **no live ADR owner** (0192/0193/0195 are autopilot-*learning*, closed, never mention them). The earlier design — gate fails on `GUIDANCE_*`, remediation "owned there, not here" — was a **self-inflicted unshippable gate** punting to closed doors. 0214 owns the block; the gate is now self-satisfiable at merge.
* **Provenance corrected:** "all defects upstream-inherited byte-for-byte" → the `CLAUDE_FLOW_*` defects are inherited, the `GUIDANCE_*` block is fork-authored.
* **Config.json driver softened:** "#1194/#1854/#1185 = upstream moving to config.json" is overstated (fork-filed issues; #1194 NOT_PLANNED; upstream still emits the env vars; #1854 wants env vars to *work*). Option A rests on **reader-name canonicality**, not a migration that isn't happening — so "delete + wait for upstream" is not advisable.
* **Rename gate-proofing:** keep the writer-rename only if a runtime check confirms `SWARM_TOPOLOGY`/`MEMORY_TYPE` reach the loader in an init'd project; else delete-all-no-rename (the genuinely strong alternative, which narrowly loses only because deleting the override leaves no working knob until config.json keys exist).
* **`ENABLE_*` allowlist simplified:** init injects zero `ENABLE_*` vars and `@claude-flow/integration` isn't a shipped-CLI dep, so the template-matching machinery guards an impossible false-positive — a prefix exclusion suffices.
* **Annotate-5 tightened:** "annotate + track" needs a committed wiring owner or it is the same squelch this ADR condemns — delete absent that (keep the `EMBEDDING_DIM=384→768` doc-fix regardless).
* **`depends-on` += 0118** (its `CLAUDE_FLOW_*` convention is load-bearing for rejecting Option C). **Count clarified:** the F-14-003 main table has 14 dead-doc vars (under a "12" miscount heading); `LOG_LEVEL` is F-14-001-tagged but annotated, `CLAUDE_FLOW_TOKEN` is audit-omitted → the "5 annotate + 11 delete" partition holds. Minor: the `384`→`768` doc-fix is only the `EMBEDDING_DIM` row (`384` appears ~25× legitimately); 0195 has its own env var `STEP_LEVEL_FEEDBACK_ENABLED` (not a `GUIDANCE_*`).

## More Information

* **Evidence:** `docs/audits/2026-05-19-soundness-audit/14-config-soundness.md` (primary), `11-init-mcp-installation.md`, `00-README.md`.
* **Sites (all corrected):** `forks/ruflo/v3/@claude-flow/cli/src/init/mcp-generator.ts:82-86` (`.mcp.json` writer), `settings-generator.ts:66-67` + `executor.ts:341-342` (`.claude/settings.json` writers of `HOOKS_ENABLED`/`V3_ENABLED` — the missed scope), `settings-generator.ts:69-77` (9 zero-consumer `GUIDANCE_*` vars in the same block — owned by ADR-0192/0193/0195), `USERGUIDE.md:7045` (`CLAUDE_FLOW_TOKEN`, audit-missed dead doc), `@claude-flow/shared/src/core/config/loader.ts:80,103,105,142,144` (readers + allowed sets), `integration/src/feature-flags.ts:425-435` (dynamic reader of `CLAUDE_FLOW_ENABLE_*`), `init/types.ts:219,223` (value unions — subset-consistent with loader), `memory/src/resolve-config.ts:267-271` (HNSW could-be-wired substrate), `USERGUIDE.md:3229,6932,6960-6993,7060,7073` (doc sites incl. writer-named topology @6975).
* **Upstream provenance:** writer `6a356ffe6`, reader `53cfd8a53`, docs `81418649c` (all `rUv`/`Reuven`); skew + dead docs inherited verbatim; upstream moving to config.json (#1194/#1854/#1185).
* **Follow-ups:** wire the 5 annotated vars (`LOG_LEVEL`→logger, `HNSW_*`→`resolve-config.ts:267`, `EMBEDDING_DIM`→`embedding.dimension`, `SECURITY_MODE`→aidefence); F-14-014 (Zod bypass, 17 pkgs) + F-14-015 (NaN validation) separate ADRs.
* **Related:** ADR-0201 (audit), ADR-0069 (config.json keys — separate surface), ADR-0118 (`CLAUDE_FLOW_*` is the runtime convention, NOT `RUFLO_*`), ADR-0192/0193/0195 (autopilot/guidance feature — owns the 9 zero-consumer `GUIDANCE_*` `settings.json` vars surfaced here; NB: those ADRs do **not** themselves discuss env vars or config.json, so the deletion of the autopilot dead-doc vars rests on *zero consumers*, not on a claim from 0192/0193).
* **Memory:** [[feedback-no-fallbacks]] (theatrical config = silent-fallback shape), [[feedback-corpus-evidence-before-feature-work]] (annotate, don't delete-then-re-add), [[feedback-upstream-means-upstream]] (defects inherited; recurring patch), [[feedback-update-integration-ledger]] (ledger the standing patch), [[reference-embedding-model]] (768-dim; fix the `EMBEDDING_DIM=384` doc), [[feedback-remediation-adr-preflight]] (premise-true-at-runtime check *passed* here — the rare validated ADR — while the scope/upstream checks surfaced the corrections).

## Amendment — 2026-05-23 (Move A audit, implemented — code complete; doc cleanup partial)

Status flipped: **proposed → implemented** (code complete).

**Code-side (all 3 sites):**

- `mcp-generator.ts:86-96` — 4 theatrical vars dropped; `CLAUDE_FLOW_TOPOLOGY`→`CLAUDE_FLOW_SWARM_TOPOLOGY`, `CLAUDE_FLOW_MEMORY_BACKEND`→`CLAUDE_FLOW_MEMORY_TYPE`.
- `settings-generator.ts:79-82` — `CLAUDE_FLOW_V3_ENABLED`, `CLAUDE_FLOW_HOOKS_ENABLED`, 9 `GUIDANCE_*` vars removed; only `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` survives.
- `executor.ts:354-367` — `mergeSettingsForUpgrade` env block aligned with `generateSettings()`; no theatrical re-injection on upgrade.

**Arch-test gate enforced (3/3 passing, 113ms):** `cli/__tests__/arch/env-var-theatrical-gate.arch.test.ts` confirms (a) every emitted var has a consumer or allow-list match, and (b) init emits canonical reader names.

**INTEGRATION-LEDGER rows recorded:** `docs/upstream/INTEGRATION-LEDGER.md:129-130` (`6a356ffe6` superseded-by-local, `0cd9c4a39` superseded-by-local).

**Outstanding (ADR Steps 3+5 unfinished, non-blocking):**

- `forks/ruflo/docs/USERGUIDE.md:6932,6960,7060` — `CLAUDE_FLOW_MODE` (3 sites): delete.
- `docs/USERGUIDE.md:7045` — `CLAUDE_FLOW_TOKEN`: delete.
- `docs/USERGUIDE.md:6975` — `CLAUDE_FLOW_TOPOLOGY` doc row: rewrite to `SWARM_TOPOLOGY`.
- `docs/USERGUIDE.md:3229` — `CLAUDE_FLOW_MEMORY_BACKEND=hybrid` snippet: rewrite to `CLAUDE_FLOW_MEMORY_TYPE=hybrid`.
- `docs/USERGUIDE.md:6993` — `CLAUDE_FLOW_EMBEDDING_DIM` default `384` → `768` per [[reference-embedding-model]].
- The `MEMORY_TYPE` value list at `USERGUIDE:6964` (bogus `json` value vs loader's `sqlite|agentdb|hybrid|redis|memory`): re-verify and fix.

**Council MUST-FIX #2 (runtime honoured-by-loader check) deferred:** the arch-test verifies emission, not that `SWARM_TOPOLOGY`/`MEMORY_TYPE` are honoured by the loader at runtime in a fresh-init'd project. Value-safety (init defaults ∈ loader's Zod sets) and name-match-by-grep are the current proxy.

## Amendment — 2026-05-24 (Steps 3+5 + Council MUST-FIX #2 closed)

The 2026-05-23 amendment listed two open items: **USERGUIDE doc
cleanup (Steps 3+5)** and **Council MUST-FIX #2 (honoured-by-loader
behavioural test)**. Both now closed.

### USERGUIDE doc cleanup (Steps 3+5)

Closed by `forks/ruflo` commit `cac5560bb` (2026-05-24).

Conservative path taken per [[feedback-trace-before-hypothesis]]:
greped `forks/ruflo/v3/@claude-flow` for actual
`process.env.CLAUDE_FLOW_*` reads, documented only what the loader
honours.

Edits:

- `USERGUIDE.md:3229` — `CLAUDE_FLOW_MEMORY_BACKEND=hybrid` →
  `CLAUDE_FLOW_MEMORY_TYPE=hybrid`. The loader reads `_TYPE`,
  never `_BACKEND`.
- `USERGUIDE.md:6975` — env-var table: `CLAUDE_FLOW_TOPOLOGY` →
  `CLAUDE_FLOW_SWARM_TOPOLOGY` (the actual loader name). Enum
  updated to match loader: `hierarchical|mesh|ring|star|adaptive|
  hierarchical-mesh`. Default updated to `hierarchical-mesh` per
  `defaults.ts`.
- `USERGUIDE.md:6964` — memory type enum re-aligned to loader:
  `sqlite|agentdb|hybrid|redis|memory` (was incorrectly
  `json|sqlite|agentdb|hybrid`; the `json` value would be silently
  rejected by the validator).
- `USERGUIDE.md:6993` — `CLAUDE_FLOW_EMBEDDING_DIM` default `384`
  → `768` per [[reference-embedding-model]] (all-mpnet-base-v2).
- 9 doc-only env vars tagged `[doc-only]` in the env-var table:
  `MODE`, `ENV`, `SECURITY_MODE`, `LOG_LEVEL`, `HNSW_M`, `HNSW_EF`,
  `EMBEDDING_DIM`, `SQLJS_WASM_PATH`, `CLAUDE_FLOW_TOKEN`. Each
  appears in the USERGUIDE but is not read by the loader; the tag
  documents this honestly without deleting the row.
- Banner added at the top of the env-var section explaining the
  `[doc-only]` convention and referencing ADR-0214 MUST-FIX #2.
- Platform example blocks (lines ~6932–6948) and `.env` example
  (~7060–7077) rewritten to use only honoured names.

### Council MUST-FIX #2 (honoured-by-loader behavioural test)

Closed by `forks/ruflo` commit `c8673c0f8` (2026-05-24).

New test: `forks/ruflo/v3/@claude-flow/shared/__tests__/config-loader-env-honoured.test.ts`.

9 test cases:

| # | Case | Assertion |
|---|---|---|
| 1 | `CLAUDE_FLOW_MAX_AGENTS` set | `orchestrator.lifecycle.maxConcurrentAgents` = env value |
| 2 | `CLAUDE_FLOW_DATA_DIR` set | `orchestrator.session.dataDir` = env value |
| 3 | `CLAUDE_FLOW_MEMORY_TYPE` set | `memory.type` = env value |
| 4 | `CLAUDE_FLOW_MEMORY_TYPE` = invalid | silently rejected (validator gate) |
| 5 | `CLAUDE_FLOW_MCP_TRANSPORT` set | `mcp.transport.type` = env value |
| 6 | `CLAUDE_FLOW_MCP_PORT` set | `mcp.transport.port` = env value |
| 7 | `CLAUDE_FLOW_SWARM_TOPOLOGY` set | `swarm.topology` = env value |
| 8 | Bare `CLAUDE_FLOW_TOPOLOGY` set | NOT honoured (rebrand correctness) |
| 9 | All unset | documented defaults returned |

All 9 pass. Run:

```bash
cd forks/ruflo/v3
npx vitest run @claude-flow/shared/__tests__/config-loader-env-honoured.test.ts \
  --no-coverage --exclude="**/node_modules/**"
```

The `--exclude="**/node_modules/**"` flag avoids vitest's
test-file-in-symlinked-deps duplication that the v3 `include`
pattern would otherwise produce (the test file gets matched in
13 nested node_modules paths via npm-linked deps).

### Patch-side acceptance

Patch-side acceptance unchanged (15/15 PASS `adr0059,p4`); the new
test lives in fork-side test suite, not the fast acceptance runner.
Wiring this test into the patch-side acceptance suite is a separate
follow-up (would mean spawning the fork's vitest from the patch
acceptance script).

No INTEGRATION-LEDGER row (fork-only patch + doc + test, no upstream
counterpart).
