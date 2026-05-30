---
status: accepted
date: 2026-05-30
tags: [agentdb, typescript, build, ci, tech-debt]
supersedes: []
depends-on: []
implements: []
---

# Typecheck hygiene for the agentdb fork — gate shipped `src/`, not dev-only code

## Context and Problem Statement

While shipping the `hierarchical-query` fix (ADR-0176 amendment, 2026-05-30) the `agentdb` fork's `npm run build:ts` (`tsc`) was found to report **104 type errors** yet still produce working output. `tsconfig.json` leaves `noEmitOnError` unset (default **false**), so `tsc` emits `dist/` regardless of type errors and exits non-zero only as a signal. The release pipeline does not gate on that exit code, so the build "works" and the errors are, in effect, ignored warnings. This was verified: deleting `dist/src/controllers/HierarchicalMemory.js` and re-running `tsc` (exit 2) re-emitted the file with the fix intact.

The problem is not a broken build — it is that **nothing reads the type-check signal**, so real defects in shipped code hide inside a wall of dev-only noise. The 104 errors break down as:

| Location | Count | Shipped? | Nature |
|---|---|---|---|
| `tests/` | 39 | no | stale `GraphEdges` shape in benchmark helpers |
| `benchmarks/` | 33 | no | `'../dist/...'` import resolution, loose result typings |
| `examples/` | 26 | no | missing Deno / Cloudflare-Worker ambient libs (`Deno`, `KVNamespace`, `DurableObjectNamespace`), `../src/observability` |
| `src/` | **6** | **yes** | real shipped-code type errors (below) |

The six shipped-code (`src/`) errors:

- `src/mcp/agentdb-mcp-server.ts:2266` — `Property 'toFixed' does not exist on type 'Promise<number>'`. **A genuine latent bug** — a missing `await`; `.toFixed()` on a Promise produces garbage. The noise hid it.
- `src/core/AgentDB.ts:256` and `:319` — `Duplicate identifier 'database'`.
- `src/controllers/SyncCoordinator.ts:962` — `Expected 1-2 arguments, but got 0`.
- `src/controllers/HierarchicalMemory.ts:380` — `manualSearch(…, tiers, …)` passes `string[]` where `MemoryTier[]` is expected.
- `src/examples/quic-sync-example.ts:121` — `MutationContext<false>` mismatch (a dev example that lives under `src/`).

The dev-only errors are low-value to fix (Deno/CF examples need special `lib`/ambient configs; benchmark helpers are throwaway), but the shipped-code errors include at least one real bug. The question: how do we make the type signal meaningful for shipped code without churning throwaway dev code into compliance?

## Decision Drivers

* Shipped code (`src/` → `dist/src`) must be type-clean and stay that way — that is what runs in production.
* The signal must be **gated** (CI / release reads `tsc` exit), or it will keep being ignored.
* Avoid low-value churn on Deno/Cloudflare/benchmark dev code that needs bespoke ambient typings.
* Catch real latent bugs (the `toFixed`/`await` defect would have been caught by a gate on `src/`).

## Considered Options

* **Two-tier: gate shipped `src/`, advisory-typecheck dev dirs (chosen)** — a `tsconfig.build.json` scoped to `src/` (excluding `src/examples/**`) that CI runs as `tsc --noEmit` and **gates on exit 0**; the 6 shipped errors are fixed; `benchmarks/`/`examples/`/`tests/` keep a separate, non-gating advisory typecheck so they aren't abandoned but don't block.
* **Clean all 104 + gate the full `tsc`** — fix every error across `src`, `tests`, `benchmarks`, `examples` and gate the existing all-inclusive `tsc`.
* **Accept as-is (status quo)** — keep `noEmitOnError` false, no gate; treat all 104 as permanent non-fatal noise.

## Decision Outcome

Chosen option: **"Two-tier: gate shipped `src/`, advisory-typecheck dev dirs"**, because the value is concentrated in shipped code (6 of 104 errors, including a real `await` bug) and a `src/`-scoped gate makes the type signal meaningful there immediately, while sparing the project from low-value churn on Deno/Cloudflare/benchmark code that fails only for want of bespoke ambient `lib` configuration. "Clean all + gate full" is rejected as disproportionate — ~94 of the errors are in throwaway dev code and several (Deno/Worker globals) are environmental, not defects. "Accept as-is" is rejected because it already let a real shipped bug (`agentdb-mcp-server.ts:2266`) hide.

### Consequences

* Good, because shipped `src/` becomes type-clean and a CI gate keeps it clean — the `toFixed`/`await` class of bug can no longer hide.
* Good, because it is low-effort: 6 real fixes + one scoped tsconfig + one CI step, no churn on dev-only code.
* Good, because the dev-dir advisory typecheck still surfaces drift (e.g. the stale `GraphEdges` helper) without blocking releases.
* Bad, because `benchmarks/`/`examples/`/`tests/` retain known type errors (advisory, not gated) — a deliberate, documented gap.
* Neutral, because the main build (`tsc` over everything, emit-despite-errors) can stay as-is for `dist/` emission; only the **gate** is scoped. `noEmitOnError` is intentionally left false so a future dev-code error never blocks a `dist` emit.

### Confirmation

* `tsc --noEmit -p tsconfig.build.json` exits **0** (the 6 `src/` errors fixed; `src/examples/**` excluded or fixed).
* A CI/release step runs that command and fails the build on non-zero exit (a new acceptance check, mirroring the ADR-0176 tool-name gate).
* The `agentdb-mcp-server.ts:2266` fix is confirmed by the value being `await`ed before `.toFixed()`.

## More Information

- Surfaced by the ADR-0176 `hierarchical-query` fix work (2026-05-30); see that ADR's amendment for the build-emit verification (`tsc` emits `dist/` despite exit 2 because `noEmitOnError` is false).
- Affected shipped sites: `src/mcp/agentdb-mcp-server.ts:2266`, `src/core/AgentDB.ts:256,319`, `src/controllers/SyncCoordinator.ts:962`, `src/controllers/HierarchicalMemory.ts:380`, `src/examples/quic-sync-example.ts:121`.
- **Precedent: ADR-0260** ("prime-radiant TS error disposition") solved the same class of problem in the `ruflo` fork — root `tsc` emitted ~388 errors that were configuration artifacts mis-attributed across dev dirs, resolved by replacing the root `tsconfig.json` with a **solution-style config** (`files: []` + project references to the real shipped workspaces) so `npm run build` exits 0 without touching source. The `src/`-scoped `tsconfig.build.json` chosen here is the same philosophy (gate only real shipped code); ADR-0260's solution-style/project-references mechanism is a viable implementation form for the gate.
- This ADR records the decision only; implementation (the 6 fixes + scoped tsconfig + CI gate) is separate work in `forks/agentdb`.
