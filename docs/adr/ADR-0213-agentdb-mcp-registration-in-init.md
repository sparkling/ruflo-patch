---
status: accepted
date: 2026-05-19
tags: [init, mcp, agentdb, registration]
supersedes: []
depends-on: [ADR-0201, ADR-0161, ADR-0204]
implements: []
---

# Resolve the `mcp__agentdb__*` prefix gap — point docs at the working surface; defer standalone registration

> **Decision reversed after a 6-expert swarm review (2026-05-20).** The original draft chose **Option A — add an `agentdb` MCP server entry (`npx @sparkleideas/agentdb@latest mcp start`) to `ruflo init`'s `.mcp.json`.** The review found Option A unshippable on five independent grounds, the first decisive: (1) **the standalone server is dead on arrival** — it crashes at startup on every boot/host (an unallowed `busy_timeout` PRAGMA against the hard-pinned sql.js backend); (2) **Pass 8's emitted `mcp__agentdb__<tool>` prefix resolves against no running server** — the standalone namespaces its tools `mcp__agentdb__agentdb_<tool>` (server name `agentdb` + tool `agentdb_<tool>`, doubled segment) and the aggregator's are `mcp__ruflo__agentdb_<tool>` (hyphenated), so the rewritten refs are dead regardless of whether the standalone boots; (3) it backs onto **SQLite (sql.js, 384-dim MiniLM)** while the aggregator is **RVF-primary (768-dim mpnet)** — registering it routes data into a store invisible to the RVF primary, a [[project-rvf-primary]] violation at the default; (4) the aggregator/standalone surfaces overlap in **tool families but differ in substrate** (so the "harmless double-mount" framing is wrong — it's split-brain across two stores); (5) **ADR-0204 gates this** (it owns the `agentdb_*` double-mount resolution — now ADR-0204 Decision Outcome item (e)). The decision changes to **correct ADR-0161 Pass 8's docs to point at the *working* `mcp__ruflo__agentdb_*` aggregator surface, do NOT default-register the standalone, defer standalone registration to a future opt-in ADR, and file the boot crash as a fork bug.** See [Swarm review evidence](#swarm-review-evidence-2026-05-20).
>
> **Second-pass validation (2026-05-20).** The boot crash (Finding 1), substrate split (Finding 3), and dedup-is-new-mechanism (Finding 5) all re-verified exactly against fork source + a fresh `/tmp` install. **Two first-pass evidence errors corrected:** (a) the standalone registers **32 tools** (11 `agentdb_`-prefixed + 21 un-prefixed `reflexion_*`/`skill_*`/`causal_*`/`learning_*`/`experience_record`/`recall_with_certificate`), NOT the "11" the first rewrite claimed (that count read only the contiguous `agentdb_`-prefixed block in the `tools` array; the un-prefixed controller tools were missed) nor the "~41" the original draft claimed (the README itemizes 41; the live `tools/list` is 32) — and the richer families DO exist in the standalone, so the "they only live in the aggregator" claim is dropped; (b) the doc defect is the *prefix-resolves-nowhere* mechanic above, not "~30 orphaned tools" — Pass 8's actual input corpus is exactly **3 tools** (`pattern_store`/`pattern_search`/`pattern_stats`, 30 occurrences in `.claude/agents/github/*.md`), all three of which the standalone *does* serve. The decision (Option B + defer) is unaffected — it rests on the boot crash + substrate split + dedup, none of which depend on the tool count.

## Context and Problem Statement

ADR-0161 §6/Pass 8 rewrote MCP tool-prefix doc references `mcp__agentic-flow__agentdb_*` → `mcp__agentdb__*` across ~23 `.md` files (per ADR-0161's own audit, "all are in documentation — zero in production code — essentially a doc rewrite"). Audit finding F-11-003: `ruflo init` does **not** emit an `agentdb` MCP server entry (only `ruflo`), so the `mcp__agentdb__*` prefix Pass 8 documented has **no server listening for it** at any init-generated surface. The original ADR proposed standing up that server via init registration (Option A). The swarm review establishes that the premise is broken at every layer.

### Finding 1 (decisive) — the standalone server is dead on arrival

Empirical boot of the published `@sparkleideas/agentdb@latest` (`3.0.0-alpha.14-patch.249`) from a fresh Verdaccio `/tmp` install, via the exact `.mcp.json` invocation (`agentdb mcp start`):

```
❌ Invalid PRAGMA command: busy_timeout.  Allowed: journal_mode, synchronous, …
ValidationError: Invalid PRAGMA command: busy_timeout
   at validatePragmaCommand (.../security/input-validation.js:225)
   at SqlJsDatabase.pragma (.../db-fallback.js:232)
   at .../mcp/agentdb-mcp-server.js:210
```

Root cause (fork source `6bbe191`): `agentdb-mcp-server.ts:16` **hard-imports the sql.js fallback** `createDatabase` (unconditionally, even though native `better-sqlite3` loads fine on this host), and `:246` unconditionally calls `db.pragma('busy_timeout = 5000')` — but `security/input-validation.ts:53` `ALLOWED_PRAGMAS` does **not** include `busy_timeout`, so the fallback's pragma validator throws. The crash is at module top-level, *before* `server.connect()`, so the server never answers `initialize`. **Deterministic crash on every boot.** `claude mcp list` would show it as a failed/unavailable server. (Note: this is *not* the F-09-011 archivist-init bug — the standalone bootstraps its own substrate, no `getProcessArchivist` guard — it's a worse, unconditional startup crash.) **The crash is fork-introduced, NOT upstream (corrected 2026-05-22).** Upstream's `agentdb-mcp-server.ts` calls only allowed pragmas (`journal_mode`/`synchronous`/`cache_size`) and has no `busy_timeout` anywhere in `src/` — **upstream boots clean and its `claude mcp add agentdb` recipe works.** The fork *added* `db.pragma('busy_timeout = 5000')` (commit `668ce1a`, "ADR-0069 A1: busy_timeout required with WAL mode") against the inherited validator allowlist that never listed it. So this is the fork's **own regression to repair**, not an upstream breakage — and it is a separate decision from registration (fix the regression now; defer registration on substrate grounds).

### Finding 2 — the prefix Pass 8 emits resolves against *no* server (and the count is 32, not 11 or ~41)

The original draft (line 25) said the server "exposes the `agentdb_*` tool family (~41 tools per the README)." The live `tools` array (`agentdb-mcp-server.ts:311`, returned wholesale at `:905`) registers **32 tools**: 11 `agentdb_`-prefixed (`init/insert/insert_batch/search/delete/stats/pattern_store/pattern_search/pattern_stats/clear_cache/pattern_store_batch`) plus 21 un-prefixed controller tools (`reflexion_store/retrieve/store_batch`, `skill_create/search/create_batch`, `causal_add_edge/query`, `recall_with_certificate`, all nine `learning_*`, `experience_record`, `reward_signal`, `learner_discover`, `db_stats`). So the richer families **do** exist in the standalone (under un-prefixed names), contradicting any "they only live in the aggregator" framing. (The README itemizes 41 across six families; the live server is 32 — the original "~41" was README-derived and the first-pass "11" undercounted by reading only the `agentdb_`-prefixed block. One name the ADR previously cited, `simulation_run`, exists in **neither** MCP surface — it is a CLI-wizard concept only (`forks/agentdb/src/cli/commands/simulate-wizard.ts`).)

The real doc defect is not tool-coverage; it is that **Pass 8's output prefix resolves against no server**. Pass 8 (`scripts/codemod.mjs:252,504`) rewrites `mcp__agentic-flow__agentdb_<tool>` → `mcp__agentdb__<tool>`. Its actual input corpus in fork HEAD is exactly **3 tools** (`pattern_store`/`pattern_search`/`pattern_stats`, 10 occurrences each = 30, all in `.claude/agents/github/*.md`). The emitted `mcp__agentdb__pattern_store` matches **neither** live surface: MCP namespaces tools as `mcp__<serverName>__<toolName>`, so the standalone (server `agentdb` + tool `agentdb_pattern_store`) is `mcp__agentdb__agentdb_pattern_store` (doubled `agentdb` segment) *and* dead-on-boot; the aggregator (server `ruflo` + tool `agentdb_pattern-store`, hyphenated) is `mcp__ruflo__agentdb_pattern-store`. The fix is to point these 3 refs at the resolvable aggregator form. The original ADR's Confirmation §3/§5 (which assumed a `mcp__agentdb__*` surface) were unsatisfiable.

### Finding 3 — substrate split: registering the standalone violates RVF-primary

The two surfaces back onto **different stores with different embedding models**:

| | Standalone (`mcp__agentdb__*`) | Aggregator (`mcp__ruflo__agentdb_*`) |
|---|---|---|
| Tools | 32 (vector-DB ops + reflexion/skill/causal/learning controllers; `agentdb_`-prefixed ∪ un-prefixed) | ~50 (controller-bridge, mixed hyphen/underscore) |
| Store | sql.js **SQLite** `./agentdb.db` (cwd-relative) | **RVF-primary** via `getProcessArchivist()` |
| Embeddings | MiniLM-L6, **384-dim** | mpnet-base-v2, **768-dim** |

A pattern stored via `mcp__agentdb__agentdb_pattern_store` lands in a cwd-local SQLite file (384-dim); the analogous aggregator tool lands in RVF (768-dim). They never see each other's data and the dimensions are incompatible. Registering the standalone by default makes the fork ship a **SQLite-first memory path** at the user-facing surface — a direct [[project-rvf-primary]] violation ("RVF is primary; never add SQLite-first paths"). The ADR framed the double-mount as "just doubles the resident tool table" — it actually forks the *data store*.

### Finding 4 — the aggregator mount is the working, upstream-intended surface

The ruflo aggregator already serves the agentdb tools, RVF-backed, under `mcp__ruflo__agentdb_*` (the ~50 tools in this session's deferred-tool index). This mount is **upstream-intended design** (ruvnet/ruflo #1226 "Expose AgentDB controllers as namespaced MCP tools," closed-as-implemented; upstream **agentic-flow** ADR-053 (controller activation), Phase 5 — distinct from the fork-local ADR-0053 worktree-hook-paths). So the working agentdb surface for the fork already exists and is policy-compliant. Pass 8 rewrote docs *away* from it toward the broken standalone prefix.

### Finding 5 — ADR-0204 gates this, and the dedup step is mis-described

ADR-0204 (sibling) is consolidating both MCP transports onto the validating package server and making `initProcessArchivist()` a precondition of serving any tool — and re-homing the aggregator's `agentdb_*` handlers. Adding a second server now (Option A) would create `agentdb_*` resolvable across three shells against multiple substrates while 0204 is in flight. Separately, the ADR's dedup claim is wrong: `detectExistingRufloMCP` (`executor.ts:851`) is **all-or-nothing per file** keyed on `'ruflo'` (skips the whole `.mcp.json` if a parent declares `ruflo`) — there is **no per-key merge**, so adding `agentdb` correctly is *new mechanism*, not the "pattern already established" the ADR claimed.

### The genuine counterweight (kept in scope)

The standalone server and its `claude mcp add agentdb` recipe **are upstream-native**, and the standalone exposes *raw vector-DB* ops (`init`/`insert`/`search`) the aggregator's controller-bridge surface does not. So a standalone `agentdb` MCP namespace may be a legitimate *future* feature (a user's own portable vector DB) — distinct from the ruflo RVF memory substrate. This ADR does not foreclose it; it defers it until it can boot, comply with the substrate policy, and coexist cleanly (below).

## Decision Drivers

* **Don't register a dead server** — the standalone crashes on boot; registering it ships a failed `mcp list` entry. (Runtime truth, per [[feedback-remediation-adr-preflight]] check 1: signal must reach a *working* consumer.)
* **Honesty: wire it OR strip/correct the docs** ([[feedback-no-fallbacks]]) — wiring is blocked (dead server) and policy-violating (SQLite-first), so the honest branch is to correct the docs to the prefix that *does* resolve.
* **RVF-primary** ([[project-rvf-primary]]) — the default user-facing agentdb memory surface must be RVF-backed (the aggregator), not a cwd-local SQLite store.
* **Point docs at the working surface** — the aggregator's `mcp__ruflo__agentdb_*` is the resolvable, RVF-backed, upstream-intended mount; docs should name it.
* **Don't foreclose the standalone** — it's upstream-native and serves distinct raw-DB tools; defer it to an opt-in ADR after its prerequisites are met.
* **Respect the 0204 ordering** — let the MCP-server consolidation settle before adding a second agentdb server.
* **Re-derive from live code, not the README** ([[feedback-corpus-evidence-before-feature-work]]) — the live `tools/list` is 32, not the README's 41 (nor the first-pass miscount of 11).

## Considered Options

* **Option A — Add the `agentdb` server entry to init (register-now).** Original choice. Registers a dead server, ships a SQLite-first path, doesn't make Pass-8's prefix resolve, fights 0204. Rejected.
* **Option B — Correct Pass 8's docs to the working `mcp__ruflo__agentdb_*` surface; do not register the standalone.** Honest, RVF-compliant, no new server. **Chosen (core).**
* **Option C — Strip the aggregator's `agentdb_*` mount; register only the standalone.** Foreclosed by ADR-0204 (re-homing those handlers) and #1226 (upstream-intended); also blocked by the boot crash + substrate policy. Rejected.
* **Option D — Conditional presence-check registration.** Gold-plating; doesn't fix the crash or the substrate split. Rejected.
* **Chosen = B (now) + a deferred opt-in standalone ADR (later, gated).**

## Decision Outcome

**Chosen: correct the docs to the working surface now; defer standalone registration.**

1. **Correct ADR-0161 Pass 8's prefix rewrite** to the resolvable aggregator surface. Pass 8's actual corpus is **3 tools** (`pattern_store`/`pattern_search`/`pattern_stats`) appearing only in the `tools:` permission-allowlist frontmatter of 5 `.claude/agents/github/*.md` files (~15 allowlist declarations in the patch corpus; the fork-source Pass-8 input shows more raw occurrences); its emitted `mcp__agentdb__pattern_store` resolves against no server. **These 3 refs live only in the `tools:` YAML frontmatter (a permission allowlist), not in any agent call site** — the agent bodies invoke `npx agentdb-cli` + the TS SDK, never the MCP tool — so the honest fix may be to simply **remove the dead allowlist lines** (the agent self-evidently does not call them). If retained, the repoint is **2 + 1, not 3**: `pattern_store` → `mcp__ruflo__agentdb_pattern-store` (HYPHEN, `agentdb-tools.ts:223`) and `pattern_search` → `mcp__ruflo__agentdb_pattern-search` (HYPHEN, `:263`) — but **`pattern_stats` has NO aggregator tool** (the nearest, `agentdb_query_stats` `:1501`, is QueryOptimizer cache-stats — wrong semantics), so per this ADR's own rule it must be **removed/marked-future, not repointed**. For each retained replacement, **cross-check the tool name exists in the aggregator registry** (`mcp-tools/agentdb-tools.ts`); the naming is mixed (hyphen *and* underscore). Any other `mcp__agentdb__*` reference that names a tool in **neither** surface (e.g. `simulation_run`, a CLI-wizard-only concept) must be **removed or marked future**, not repointed. This is the [[feedback-no-fallbacks]] "strip the documentation" branch, applied honestly. See [Supersession scope](#supersession-scope).
2. **Do NOT register the standalone `agentdb` server in `ruflo init`.** No `MCPConfig.agentdb` field, no generator branch — `init` keeps emitting the `ruflo` aggregator, which serves the agentdb tools RVF-backed. (Also avoids the per-key-merge rework of `executor.ts:writeMCPConfig` and the second-embedding-model cold-start.)
3. **File the boot crash as a fork bug** against `forks/agentdb`: `agentdb mcp start` crashes on every boot (`busy_timeout` not in `ALLOWED_PRAGMAS`, against the hard-pinned sql.js backend at `agentdb-mcp-server.ts:16`). The realistic fix is **add `busy_timeout` to `input-validation.ts:53` `ALLOWED_PRAGMAS`** — that is the one-line change that stops the validator throwing. (Note: `db-fallback.ts` is sql.js-ONLY by construction — `createDatabase` at `:296` returns the sql.js wrapper unconditionally; there is no native path *in that module* to "un-pin," so "use native `better-sqlite3` instead" would mean re-targeting the mcp-server onto a different substrate module — e.g. `archivist/substrates/sqlite-store.ts`, which is not a drop-in `createDatabase` shape — a non-trivial rewrite, not a toggle. Also: under sql.js, `busy_timeout` is a *no-op* — sql.js is in-memory WASM with no concurrent file-locking — so allowing the pragma silences the crash rather than enabling real busy-timeout behaviour.) This is independent of init registration — the documented `claude mcp add agentdb` recipe is broken regardless.
4. **Defer standalone registration to a future opt-in ADR**, gated on ALL of: (a) the boot crash fixed and a `tools/list` + `pattern_store→pattern_search` round-trip passing in a fresh `/tmp` install; (b) the substrate reconciled with [[project-rvf-primary]] (either RVF-back the standalone, or explicitly scope it as a *separate, opt-in, non-default* portable vector DB that does not masquerade as the ruflo memory substrate) and the embedding model aligned to `all-mpnet-base-v2`/768-dim (or the dimension-mismatch consequence documented); (c) ADR-0204's MCP-server consolidation settled, with the double-mount resolved (one canonical mount per tool, or clearly-separated namespaces with no overlapping tool names); (d) registration defaulting **opt-in** (`agentdb:false`), not `true`. Until then, the standalone is not default-wired.

### Supersession scope

This ADR partially corrects **ADR-0161 Pass 8**: Pass 8's blanket `mcp__agentic-flow__agentdb_*` → `mcp__agentdb__*` doc rewrite is narrowed/redirected to `mcp__ruflo__agentdb_*` for the tools the aggregator actually serves, because the `mcp__agentdb__*` standalone surface it pointed at is dead-on-arrival, SQLite-backed, and namespace-doubled (its real prefix is `mcp__agentdb__agentdb_*`, so Pass-8's bare `mcp__agentdb__pattern_store` matches none of its 32 tools). Only Pass 8's prefix-target is corrected; ADR-0161's agentdb extraction and the other passes stand. (Frontmatter `supersedes:` left empty — this is a clause-level correction, not a wholesale supersession.)

### Confirmation

* **Docs resolve (assert both directions):** (1) no `mcp__agentic-flow__agentdb_*` (Pass-8 input) and no bare `mcp__agentdb__*` (Pass-8 output) remain in the rewritten agent docs — scope the grep to the files Pass 8 transforms (`.claude/agents/github/*.md`); (2) **each replacement `mcp__ruflo__agentdb_<tool>` matches a live tool name in the aggregator registry** (`mcp-tools/agentdb-tools.ts`) — so a hyphen/underscore typo can't pass the gate by merely removing the old prefix. Any `mcp__agentdb__*` reference intentionally retained for the future standalone must be clearly marked "future / opt-in, not yet registered." No doc names a tool that no live server serves. (Concretely: `pattern_stats` resolves to **no** aggregator tool — `agentdb_query_stats` is wrong semantics — so the gate forces its removal/mark-future; Step 1 ships **2 repoints + 1 removal**, not 3 repoints.)
* **Init unchanged + correct:** a fresh `ruflo init` emits `.mcp.json` with the `ruflo` server only (no `agentdb` key); the agentdb tools resolve via `mcp__ruflo__agentdb_*` (RVF-backed). A round-trip (`mcp__ruflo__agentdb_pattern-store` → `agentdb_pattern-search`) succeeds against RVF (this is the working surface; gated by ADR-0204's archivist-init fix).
* **Boot-crash bug filed** (and, once fixed upstream/fork, the standalone's `tools/list` + `pattern_store→search` round-trip passes in a fresh `/tmp` install — the precondition for the deferred opt-in ADR).
* **No SQLite-first default:** assert no init-generated `.mcp.json` registers a SQLite-backed agentdb memory server by default ([[project-rvf-primary]]).
* **Also fix F-11-001** opportunistically (the `generateMCPCommands` `claude-flow`-key/`@sparkleideas/cli` drift vs the `.mcp.json` `ruflo` key) since it's the same generator surface.

### Consequences

* Good, because no dead server is registered — `claude mcp list` won't show a failed `agentdb` entry; the default install keeps the working, RVF-backed agentdb surface.
* Good, because docs stop pointing at a broken/partial `mcp__agentdb__*` prefix and name the surface that actually resolves — the honest, [[feedback-no-fallbacks]]-compliant outcome.
* Good, because it preserves [[project-rvf-primary]] (no SQLite-first memory path shipped by default) and avoids the second-embedding-model cold-start + the per-key-merge rework.
* Good, because the boot-crash bug gets surfaced and fixed independently (the upstream `claude mcp add agentdb` recipe currently doesn't work).
* Good, because it doesn't foreclose the standalone — a real opt-in feature can land later, once it boots, complies with the substrate policy, and 0204 settles.
* Bad, because it partially reverses ADR-0161 Pass 8's doc rewrite (~23 refs) — but Pass 8 was doc-only and never load-bearing in code; correcting it is small surgery vs standing up a divergent server.
* Bad, because users who specifically want a standalone portable agentdb vector DB must wait for the deferred opt-in ADR (and the boot fix). Acceptable: that feature was never functional (dead server).
* Neutral, because the aggregator double-mount question is now correctly owned by ADR-0204's consolidation, not deferred vaguely.

## Pros and Cons of the Options

### Option B + defer (chosen)
* Good, because honest (docs name the working surface), RVF-compliant, no dead server, no merge-tax init divergence, doesn't fight 0204.
* Bad, because reverses Pass 8's doc rewrite and postpones the (currently non-functional) standalone feature.

### Option A — register the standalone now (original)
* Good, because aligns with upstream's `claude mcp add agentdb` recipe and would expose distinct raw-DB tools.
* Bad, because the server is dead on arrival, ships a SQLite-first default (RVF-primary violation), creates a split-brain double-mount, and fights ADR-0204 — and even fixed-and-booting it would not make Pass 8's `mcp__agentdb__pattern_store` refs resolve (the standalone's namespace is `mcp__agentdb__agentdb_pattern_store`). Unshippable as written.

### Option C — strip aggregator + register standalone
* Bad, because foreclosed by ADR-0204 (re-homing the aggregator handlers) and upstream #1226 (the aggregator mount is intended); also blocked by the boot crash + substrate policy.

### Option D — conditional registration
* Bad, because gold-plating that fixes none of the real defects.

## Swarm review evidence (2026-05-20)

Six-expert review; verified at fork HEAD + a fresh Verdaccio `/tmp` install.

* **Runtime-Smoke (decisive)** — `agentdb mcp start` crashes on every boot (`busy_timeout` not in `ALLOWED_PRAGMAS` vs hard-pinned sql.js); never answers `initialize`; ADR Confirmation §2/§3 false; worse than F-09-011 (dead, not per-call-failing).
* **MCP-Reg Architect** — split-brain double-mount (the strip is the load-bearing half); cold-start = 2nd embedding model (MiniLM-384 vs project mpnet-768); dedup is all-or-nothing (per-key merge = new mechanism). *(Second-pass: the tool count is **32** — 11 `agentdb_`-prefixed + 21 un-prefixed controllers — not the "11" first-pass or "~41" original; the richer families exist in both surfaces.)*
* **Code Archaeologist** — Pass 8 was docs-ahead-of-implementation (23 doc-only refs, no server-registration step); standalone is sql.js-only → [[project-rvf-primary]] violation; ADR-0204 gates this.
* **Upstream Analyst** — gap inherited; standalone + `claude mcp add agentdb` recipe **are upstream-native**; aggregator mount is upstream-intended (#1226/ADR-053); the surfaces are **different tool families, not duplicates** → don't foreclose the standalone, but the "same tools double-mounted" claim is false.
* **Devil's Advocate** — silent data-split (SQLite-384 vs RVF-768) shipped at the default; Option A doesn't make Pass 8 docs resolve (keystone false); no real consumer; the standalone "works" only by writing to the wrong store. → revert/correct Pass 8.
* **Queen** — synthesis: reject A; correct Pass 8 docs to `mcp__ruflo__agentdb_*` (working, RVF-backed, upstream-intended); don't default-register the dead/SQLite standalone; file the boot bug; defer standalone to a gated opt-in ADR.

### Second council re-validation (2026-05-22)

A fresh 6-expert council re-verified ADR-0213 against fork source + upstream. **Option B + defer re-affirmed (6/6)** — the three pillars all hold in source: the boot crash is structural/deterministic (full chain confirmed before `server.connect()`), the standalone serves 32 tools (11 prefixed + 21 un-prefixed) under a doubled `mcp__agentdb__agentdb_*` namespace, and the SQLite-384 vs RVF-768 substrate split is real. ADR-0204 genuinely gates + owns the double-mount (bidirectional item (e)); `depends-on:[0201,0161,0204]` is load-bearing; "Option A-fixed" (one-line boot fix + register opt-in) was correctly rejected — registering is orthogonal to the doc defect (the namespace never matches) and ships a consumer-less opt-in feature. Corrections folded in:

* **The boot crash is FORK-INTRODUCED, not an upstream-broken recipe (the ADR's one load-bearing factual error):** upstream calls only allowed pragmas and has no `busy_timeout`; upstream boots clean and `claude mcp add agentdb` works. The fork *added* `busy_timeout` (commit `668ce1a`, "ADR-0069 A1") against the inherited validator allowlist. Reframed as the fork's own regression — separate from the registration-deferral decision.
* **Step 1 is 2 repoints + 1 removal, not 3 repoints:** `agentdb_pattern-store` (`:223`) and `agentdb_pattern-search` (`:263`) exist (hyphenated); **`agentdb_pattern-stats` does NOT exist** in the aggregator (`query_stats` is wrong semantics), so per the ADR's own rule it is removed/marked-future. A literal 3-way repoint would reintroduce a dead ref the Confirmation gate rejects.
* **The 3 Pass-8 refs are a permission allowlist (`tools:` frontmatter), not call sites** — agent bodies use `npx agentdb-cli` + the SDK, never the MCP tool — so *removing* the dead lines is at least as honest as repointing.
* **Cosmetic/citation:** `## Consequences` demoted to `###`; the stale "~11 tools" in Supersession scope → namespace-doubling note (the count is 32); "ADR-053" disambiguated to upstream agentic-flow ADR-053; the "30 occurrences" reframed as ~15 allowlist declarations (count is tree-dependent — fork-source vs patch corpus); `ALLOWED_PRAGMAS` is a `Set`, not an array (the fix is identical).

**Dependency note:** the doc-correction + boot-fix (steps 1+3) ship independently; the RVF `pattern-store → pattern-search` round-trip (Confirmation #2) is genuinely **0204-blocked** (archivist-init) — accurately self-flagged. The F-11-001 fold (align `generateMCPCommands` to `claude mcp add ruflo -- npx -y @sparkleideas/ruflo@latest mcp start`) is same-surface and safe.

## More Information

Lifecycle dates from the original record: accepted 2026-05-19, implemented 2026-05-22. This ADR was swarm-reviewed.

* **Audit:** F-11-003 (`docs/audits/2026-05-19-soundness-audit/11-init-mcp-installation.md`); F-11-001 (generateMCPCommands key drift).
* **Boot crash (file as fork bug):** `forks/agentdb/src/mcp/agentdb-mcp-server.ts:16` (hard-pinned sql.js import), `:246` (`busy_timeout` pragma); `forks/agentdb/src/security/input-validation.ts:53` (`ALLOWED_PRAGMAS`, missing `busy_timeout`); `forks/agentdb/src/db-fallback.ts` (sql.js-only).
* **Tool counts:** standalone **32** (`agentdb-mcp-server.ts` `tools` array `:311`, returned at `:905`; server `name:'agentdb'` `:298`; 11 `agentdb_`-prefixed + 21 un-prefixed); aggregator ~50 (`forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts`, RVF-dispatched). README itemizes 41.
* **Substrate:** aggregator → `getProcessArchivist()` RVF-primary (ADR-0180/0181); standalone → `./agentdb.db` sql.js SQLite, MiniLM-384.
* **Init surface (unchanged):** `forks/ruflo/v3/@claude-flow/cli/src/init/{types.ts:201-212, mcp-generator.ts:68-111, executor.ts:851-914}`.
* **Upstream:** init has no agentdb entry either (gap inherited); `ruvnet/agentdb/README.md:57,91` documents `claude mcp add agentdb` (works **upstream**; broken only in the fork, which added the `busy_timeout` pragma in commit `668ce1a`); aggregator mount per ruvnet/ruflo #1226 (closed) / upstream **agentic-flow** ADR-053 (controller activation, distinct from the fork-local ADR-0053).
* **Related:** ADR-0161 (agentdb 5th fork + Pass 8 — corrected here), ADR-0204 (MCP-server consolidation / archivist-init — gates this; owns the double-mount), ADR-0201 (audit), ADR-0069 (`all-mpnet-base-v2`/768-dim canonical model).
* **Memory:** [[project-rvf-primary]] (no SQLite-first default), [[feedback-no-fallbacks]] (wire-or-strip; docs name the resolvable surface), [[feedback-corpus-evidence-before-feature-work]] (32 tools live, not the README's 41 or the first-pass 11; standalone has no caller), [[reference-agentdb-unscoped-name]], [[feedback-inspect-installed-not-dev-nodemodules]] (boot tested via fresh `/tmp` install), [[feedback-remediation-adr-preflight]] (all four checks fired: dead consumer / docs-vs-runtime / inventory-false / 0204+0161 overlap).

## Amendment — 2026-05-23 (Move A audit, implemented)

Status flipped: **proposed → implemented**. All four steps shipped:

1. Pass-8 doc refs corrected — 5 `.claude/agents/github/*.md` files repointed (`pattern_store` → `mcp__ruflo__agentdb_pattern-store`, `pattern_search` → `mcp__ruflo__agentdb_pattern-search`; `pattern_stats` removed, no aggregator equivalent). Forks commit `5015b016f`; patch-side gate test `tests/unit/adr0213-no-dead-agentdb-refs.test.mjs`.
2. Init unchanged (no `agentdb` key in `.mcp.json`) — pinned by arch-test `forks/ruflo/v3/@claude-flow/cli/__tests__/arch/adr0213-init-no-agentdb-registration.arch.test.ts` (6/6 passing, 2ms; pins negative across default, all-on, ruv-swarm-only, flow-nexus-only, claudeFlow=false, RVF-primary).
3. Boot-crash fork bug filed against `forks/agentdb` (`busy_timeout` not in `ALLOWED_PRAGMAS`) — tracked separately; not gating this ADR.
4. Standalone registration remains deferred to a future opt-in ADR (gated on boot-fix + RVF-substrate reconciliation + ADR-0204 settling + opt-in default).

INTEGRATION-LEDGER row already present at `docs/upstream/INTEGRATION-LEDGER.md:133` (cites `5015b016f` + `a8e74b5`).

**Risk:** boot-crash fork bug mentioned as "file as fork bug" but no ledger/ADR/issue ID confirms it's tracked outside this ADR's text. Recommend a separate tracker entry so the deferred opt-in ADR has a real precondition.

## Amendment — 2026-05-24 (boot-crash fork bug closure)

The 2026-05-23 amendment left the boot-crash fix (step 3) "tracked
separately; not gating this ADR" and recommended a separate tracker
entry. The fix is **already shipped in the fork** — no separate
tracker is needed because the precondition is met.

**Fix landed:** `forks/agentdb` commit `d1b6145` (2026-05-23, Henrik
Pettersen) — `fix(security): ADR-0213 step 3 allow busy_timeout
PRAGMA (boot-crash fix)`.

**Code state** (`forks/agentdb/src/security/input-validation.ts:64–72`):

```ts
  // ADR-0213 step 3: agentdb mcp-server's `db.pragma('busy_timeout = 5000')`
  // call at agentdb-mcp-server.ts:246 was added by fork commit 668ce1a
  // (ADR-0069 A1, WAL-mode compatibility) against the inherited validator
  // allowlist that never listed busy_timeout — causing the standalone MCP
  // server to crash on boot before answering `initialize`. Under the
  // hard-pinned sql.js fallback the pragma is a no-op anyway (WASM
  // in-memory, no concurrent file-locking), so allowing it silences the
  // crash without changing behaviour.
  'busy_timeout',
```

`'busy_timeout'` is now a member of `ALLOWED_PRAGMAS` (line 53–73 set).
The validator no longer throws on the unconditional
`db.pragma('busy_timeout = 5000')` call at
`agentdb-mcp-server.ts:246`, so the standalone server boots past
`server.connect()` and answers `initialize`.

**Note on semantics:** under the hard-pinned sql.js fallback the
pragma is a no-op (WASM in-memory, no concurrent file-locking), so
allowing it silences the crash rather than enabling real
busy-timeout behaviour. This matches the substrate reality — the
fix doesn't promise functionality, just unbreaks boot.

**Precondition status for the deferred opt-in registration ADR:**

| Precondition | Status |
|---|---|
| Boot crash fixed | **CLOSED** (commit `d1b6145`) |
| RVF-substrate reconciliation | Open (substrate policy unchanged) |
| ADR-0204 settling | Tracked separately |
| Opt-in default agreed | Open (future ADR decision) |

The first precondition is now satisfied. The remaining three still
gate any future opt-in registration ADR.

No code change in this amendment — pure verification + closure of
the 2026-05-23 amendment's "recommend a separate tracker entry"
gap. Doc-only commit in `ruflo-patch`.
