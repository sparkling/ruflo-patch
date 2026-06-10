---
status: proposed
date: 2026-06-02
tags: [agentdb, vector-backend, reliability, observability, no-fallbacks]
supersedes: []
depends-on: [ADR-0095]
implements: []
---

# Make the RVF vector-backend factory fail loud on init-failure (no silent backend degradation)

## Context and Problem Statement

The no-silent-fallback / fail-loud-fast rule (ADR-0082) was applied to the AgentDB **SQLite engine** fallback in `forks/agentdb/src/core/AgentDB.ts:initializeDatabase()` — native `better-sqlite3` failing to load no longer silently degrades to the sql.js WASM engine; it throws an actionable error unless WASM is explicitly opted into (`AGENTDB_ALLOW_SQLJS_FALLBACK` / `forceWasm`). That silent SQLite swap was the root reason the ADR-0285 P3/P4/P6 divergences were invisible on better-sqlite3 CI yet live on a WASM daemon (agentdb commit `bf90267`).

A **second** silent fallback of the same class remains in the **vector-backend factory**, `forks/agentdb/src/backends/factory.ts`. In `auto` mode the factory degrades through a chain — RuVector → RVF (N-API/WASM) → HNSWLib → sql.js-RVF — both when a preferred backend is **unavailable** AND when an installed backend **fails to initialize** (the `catch` at lines ~268–300). Every degradation emits only an ordinary `console.log`. A long-running daemon can therefore run on a non-preferred vector backend — with different recall quality, index construction, and ANN behavior — without any operator-visible signal. This is the same invisibility class the no-fallbacks rule exists to prevent.

The vector chain is, however, **more nuanced** than the SQLite swap: RuVector / RVF / HNSWLib / sql.js-RVF are genuinely different implementations (not two implementations of one engine), and `auto` mode legitimately means "use the best backend available." So a blanket fail-loud is not obviously correct, and rushing the behavioral change risks breaking `auto`'s best-available contract. The SQLite-side test failures are also being prioritized first.

## Decision Drivers

* The no-silent-fallback / fail-loud-fast rule (ADR-0082): a degraded path must not be invisible.
* Observability now, cheaply, with zero behavioral risk — we must at minimum *know* when a fallback is happening.
* Avoid a premature behavioral change: distinguishing legitimate *availability detection* ("backend not installed → use next") from a *silent init-failure degradation* ("installed but failed → silently use a lesser engine") needs care so `auto` still works.
* Sequencing: the SQLite-side regression-suite failures are being fixed first.

## Considered Options

* **A — Fail loud immediately** — mirror the SQLite fix: throw on a vector-backend init failure unless an explicit opt-in is set. One pass, fully rule-compliant.
* **B — Interim loud logging now; defer fail-loud behavior** — upgrade every non-preferred / degradation notice to a prominent `console.warn` (so fallbacks are observable today), and track the full fail-loud-with-opt-in change as deferred work in this ADR.
* **C — Leave as-is** — keep the silent `console.log` fallbacks.

## Decision Outcome

Chosen option: **"B — Interim loud logging now; defer fail-loud behavior"**, because it eliminates the dangerous property (invisibility) immediately and at zero behavioral risk, while giving the genuinely-nuanced fail-loud redesign the deliberation it needs instead of a rushed throw that could break `auto`.

**Now (this ADR's interim deliverable):** every path in `backends/factory.ts` that selects a non-preferred backend or degrades after an init failure logs a LOUD `console.warn` carrying a `⚠ VECTOR-BACKEND FALLBACK` marker and a pointer to ADR-0286 — so any run that is not on the top-priority backend, or that silently survived an init failure, is visible in logs.

**Deferred (tracked by this ADR — come back and fix):** the full fail-loud-fast treatment — (1) split *availability detection* (legitimate) from *silent init-failure degradation* (the violation); (2) make the latter throw by DEFAULT with an explicit opt-in env mirroring `AGENTDB_ALLOW_SQLJS_FALLBACK` / `forceWasm`; (3) pin it with a regression test mirroring `tests/regression/agentdb-no-silent-sqljs-fallback.test.ts`.

### Consequences

* Good, because vector-backend fallbacks become observable immediately — an operator can see "not on RuVector" / "RuVector init failed, degraded to X" in the logs, closing the invisibility gap that hid P3/P4/P6 on the SQLite side.
* Good, because the loud-logging interim carries zero behavioral risk (logging only — no throw, no engine change), so it cannot regress `auto`'s best-available contract.
* Bad, because the silent-degradation *behavior* persists until the deferred fix lands — a daemon can still run on a degraded vector backend, now merely logged loudly rather than refused.
* Neutral, because the loud warnings will be emitted in genuinely build-tool-less environments that legitimately fall back to sql.js-RVF; that is acceptable (and arguably desirable) signal until the explicit opt-in exists.

### Confirmation

* Interim: `grep -n "VECTOR-BACKEND FALLBACK" forks/agentdb/src/backends/factory.ts` covers every non-preferred / init-failure-degradation branch (none left as a bare `console.log`).
* Deferred: a regression test (mirroring `tests/regression/agentdb-no-silent-sqljs-fallback.test.ts`) asserting the factory throws on a simulated init failure unless the opt-in env is set — added when the deferred fail-loud work is done, at which point this ADR flips to `accepted`/implemented.

## More Information

* Governing rule: ADR-0082 (no-silent-fallback / fail-loud-fast; "ADR-0082 no-silent-pass" is the in-code marker).
* Target: `forks/agentdb/src/backends/factory.ts` — `auto`-mode chain (RuVector → RVF → HNSWLib → sql.js-RVF), the init-failure `catch` at lines ~268–300, and the explicit `type='rvf'` sql.js-RVF selection.

Related decisions (surfaced by `adr-patterns` semantic search):

* **ADR-0095** — *Strict fail-loud on missing native binding* (the governing precedent this ADR extends to the vector-backend factory; recorded as `depends-on`).
* **ADR-0234** — *Extend ADR-0095 fallback removal to sibling loaders (CT-A)*: the same "carry the fail-loud policy to every loader, not just RVF" pattern; that amendment landed surgically on `rvf-backend.ts` only — the vector-backend factory is a still-uncovered sibling, which is exactly this ADR's scope.
* **ADR-0285** — *repair the causal/recall surfaces*: the P3/P4/P6 bug class that the silent **SQLite-engine** fallback hid; its fail-loud follow-up in `forks/agentdb/src/core/AgentDB.ts` (`resolveBetterSqlite3LoadFailure`, commit `bf90267`) is the direct sibling of the deferred work here.
* **ADR-0091** — *sql.js Memory Fallback Removed* — prior fallback-removal precedent.
* **ADR-0166** / **ADR-0056** — AgentDB persistence axis-separation and the RVF-primary/SQLite-fallback MCP backend; context for how the vector vs SQLite substrates relate.

## Amendments

### Amendment (2026-06-10): interim deliverable SHIPPED — the Context's "silent console.log" is now historical

Adversarial re-verification against the shipped runtime: the interim
loud-logging deliverable landed as agentdb commit `602ee04` ("feat(factory):
loud-log every vector-backend fallback (ADR-0286 interim)") and SHIPS in
`@sparkleideas/agentdb@…patch.444` (verified in BOTH the live daemon's npx
cache and the newest Verdaccio tarball): `warnVectorBackendFallback` helper
(`factory.ts:224-228`) with 8 call sites covering every degradation branch —
explicit-rvf→sql.js, RuVector-init-fail→RVF, RVF-after-fail, →HNSWLib,
→sql.js, and all three not-installed selections; the no-backend case throws;
`⚠ VECTOR-BACKEND FALLBACK` appears ×9 in the shipped `factory.js`. The only
remaining `console.log`s (:253, :279) are preferred-path notices, satisfying
the interim Confirmation grep. The Context's present-tense "every degradation
emits only an ordinary `console.log`" was accurate when written (pre-fix tree
at `602ee04^`: 13 `console.log`, 0 warns) and is now historical.

Verified still open (per this ADR's own flip rule, status stays `proposed`):
the DEFERRED fail-loud work — default-throw on init-failure degradation,
`AGENTDB_ALLOW_*`-style opt-in env, and a regression test mirroring
`agentdb-no-silent-sqljs-fallback.test.ts` — none of which exists in the
shipped factory. The init-failure degradation behavior itself persists by
design (Option B: "logged loudly rather than refused"; now ~:286-313 in
source). Related-context note: the ADR-0163-era recovery swallow persists in
`memory/dist/rvf-backend.js:~2742-2752` (silent fallthrough, warn only under
`verbose`) — a different file/package than this ADR's factory target,
defanged for the t3-2 metric by ADR-0284's direct `listMetadataIds` durable
probe.
