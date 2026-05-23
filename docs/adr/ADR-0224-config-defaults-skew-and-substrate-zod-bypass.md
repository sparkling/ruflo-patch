---
status: proposed
date: 2026-05-20
tags: [config, schema-validation, fail-loud, no-fallbacks, zod, audit-followup]
supersedes: []
depends-on: [0201]
implements: []
---

# Config default skew + substrate Zod-bypass — single canonical accessor

> **Reviewed directly (2026-05-22).** Drafted from the ADR-0201 audit's slice
> 14 (config soundness) — two findings not covered by ADR-0214: one CRITICAL
> default-skew (F-14-009), one HIGH ~17-package Zod bypass (F-14-014). Both
> verified against live source; Option A confirmed. See *Direct review* for
> one implementation nuance (the `adr-0100-allow` markers the arch-test must
> reconcile).

## Context and Problem Statement

ADR-0214 covers the `CLAUDE_FLOW_*` env-var naming-skew and the dead-doc
env-var cluster (F-14-001/002/003/014/015 per the per-doc audit; the
9 GUIDANCE_* zero-consumer vars are owned by 0192/0193/0195 per
[[project-adr0201-remediation-impl-order]]). But two CRITICAL/HIGH-class
config findings escape that scope — both inside config.json itself
rather than the env-var surface:

- **F-14-009 [CRITICAL]** —
  `forks/ruflo/v3/@claude-flow/cli/src/init/config-template.ts:86`
  (`embedding.provider: "onnx"`) vs `:173`
  (`memory.embeddings.provider: "transformers.js"`). Same template, two
  writers, two different defaults for the same logical concept.
  `config-chain/src/index.ts:176` normalises `"transformers"` /
  `"transformers.js"` → `"onnx"` at runtime, so resolution converges —
  but the on-disk config.json shows TWO DIFFERENT VALUES. `ruflo config
  get embedding.provider` returns one string;
  `ruflo config get memory.embeddings.provider` returns another. The
  audit ranks this CRITICAL because configuration coherence is a primary
  user-facing invariant.
- **F-14-014 [WARNING per per-doc / HIGH per README H17]** —
  `forks/ruflo/v3/@claude-flow/shared/src/core/config/` defines a Zod
  schema; `cli/src/index.ts:553` invokes it. But **17 substrate packages**
  bypass the Zod path entirely with hand-rolled `JSON.parse(readFileSync(config.json))`:

  ```
  memory/src/memory-graph.ts:65
  memory/src/persistent-sona.ts:47
  memory/src/application/queries/search-memory.query.ts:22
  memory/src/migration.ts:35
  memory/src/learning-bridge.ts:94
  memory/src/domain/services/memory-domain-service.ts:240
  plugins/src/integrations/ruvector/self-learning.ts:42
  plugins/src/workers/index.ts:44
  integration/src/types.ts:448
  integration/src/sona-adapter.ts:67,700
  aidefence/src/domain/services/threat-learning-service.ts:179
  cli/src/memory/memory-router.ts:430,465
  cli/src/ruvector/q-learning-router.ts:23
  cli/src/ruvector/lora-adapter.ts:30
  cli/src/services/ruvector-training.ts:316
  cli/src/services/worker-queue.ts:159
  hooks/src/swarm/index.ts:182
  neural/src/moe-router.ts:27
  neural/src/algorithms/sarsa.ts:20
  neural/src/algorithms/q-learning.ts:21
  embeddings/src/rvf-embedding-service.ts:57
  ```

  A malformed config.json (string where number expected, invalid enum)
  passes through silently; the substrate reader returns `undefined` and
  falls through to its hardcoded fallback. Schema-as-defence is installed
  but unused at the substrate. Direct [[feedback-no-fallbacks]] pattern at
  the configuration layer: invalid input never raises.

The two findings share a root cause: **the codebase has a config schema
but no enforced single-accessor discipline**, so writers and readers can
both produce/consume inconsistent shapes without surfacing the
inconsistency.

Related but lower-priority findings (out of this ADR's primary scope —
flagged for dialectic to decide whether to fold in):

- F-14-008 (dual-write `memory.embeddings.*` mirrors `embedding.*` /
  `index.hnsw.*` — drift risk) — sibling to F-14-009.
- F-14-007 (`memory.sqlite.journalMode` string → `embeddings.json.walMode`
  boolean type-mismatch) — related single-write-surface drift.
- F-14-006 (`memory.sqlite.cacheSize/busyTimeoutMs/synchronous` advertised
  as wired but zero consumers) — F-14-005 cluster, dead-key class.
- F-14-005 (8 config keys with no consumer — dead-key cluster) — could
  be its own ADR.
- F-14-010 (default-init users get NO `controllers/rateLimiter/workers/daemon`
  block; full-only) — config-template completeness, distinct shape.
- F-14-011 (only 1 of 5 rateLimiter presets consumed) — same dead-key
  class as F-14-005.

The audit's recommendation #3 (line 568-574) explicitly proposes: "The 17
hand-rolled JSON.parse(readFileSync(config.json)) consumers should funnel
through a single accessor that validates against the config-template.ts
shape and throws on type errors. Pattern can match config-chain/src/index.ts's
validateBoot. This addresses the feedback-no-fallbacks pattern at the
config layer."

## Decision Drivers

- [[feedback-no-fallbacks]] — silent fallback on malformed config is the
  same shape as silent fallback on a corrupt DB (F-06-005, owned by
  ADR-0221). Schema validation that's installed-but-not-invoked is
  documentation theatre.
- Schema-as-defence requires enforcement — a schema 17 packages bypass is
  not a defence.
- Coherence is a user-facing invariant — `ruflo config get` returning
  contradictory values for the "same" key violates the user's
  reasonable-expectation model.
- README severity: F-14-009 is CRITICAL; F-14-014 = README H17 HIGH.
- Bounded scope: this ADR addresses (F-14-009 + F-14-014) with a single
  enforcement mechanism (single-accessor + arch-test guard). Other F-14
  findings have different shapes (dead keys, dual-write mirrors,
  full-vs-minimal template) and should not be conflated.

## Considered Options

- **Option A — Single canonical accessor + arch-test guard + provider
  default unification (chosen).** Three coordinated changes:
  1. **Provider default unification** (F-14-009 fix): change
     `config-template.ts:173` from `"transformers.js"` to `"onnx"` so
     both writers emit the same value. The runtime normaliser at
     `config-chain/src/index.ts:176` is preserved as a safety net for
     existing on-disk configs.
  2. **Single canonical accessor** (F-14-014 fix): introduce
     `getValidatedConfig(): Promise<Config>` in
     `@claude-flow/shared/src/core/config/` that wraps the existing
     Zod-validated `loadConfigFile` path, caches the result, and exposes
     typed getters. Refactor the 17 substrate packages to consume the
     accessor instead of `JSON.parse(readFileSync(config.json))`.
  3. **Arch-test guard**: a new arch-test in
     `forks/ruflo/v3/@claude-flow/cli/__tests__/arch/` that forbids
     `JSON.parse` of `.claude-flow/config.json` literally (regex match on
     `JSON\.parse.*config\.json`) anywhere outside the validated
     accessor's defining file. Future drift fails CI.
- **Option B — Only fix F-14-009 (default unification); leave the Zod
  bypass.** Rejected: the bypass is the structural root cause; the
  default-skew is one symptom. Fixing only the symptom leaves the
  pattern open for new occurrences.
- **Option C — Only fix F-14-014 (single accessor); leave the default
  skew.** Rejected: even if all 17 packages migrate to the accessor, the
  on-disk config.json still shows two different provider values. The
  user's `ruflo config get` problem persists.
- **Option D — Schema-validation as opt-in middleware (the
  Zod-as-decorator pattern).** Rejected: the bypass IS opt-in (`JSON.parse`
  is the opt-out). Making it explicit opt-in via a middleware does not
  improve the situation.

## Decision Outcome

**Chosen: Option A — single accessor + arch-test + provider default
unification.**

The three changes are independent in implementation but coherent in
intent: they collectively close the "config schema exists but isn't
enforced" gap.

### Concrete change shape

1. **Provider default unification** (1 line):

   ```ts
   // config-template.ts:173 — change "transformers.js" to "onnx"
   provider: 'onnx',  // was 'transformers.js'
   ```

   The runtime normaliser at `config-chain/src/index.ts:176` already
   handles existing on-disk `"transformers.js"` values; nothing else
   changes at runtime. The fix is to stop emitting the divergent default
   into new config.json files.

2. **Single canonical accessor** in `@claude-flow/shared/src/core/config/`:

   ```ts
   // shared/src/core/config/accessor.ts (NEW)
   import { loadConfigFile, configSchema } from './loader.js';
   import type { Config } from './schema.js';

   let _cached: Config | null = null;

   export async function getValidatedConfig(): Promise<Config> {
     if (_cached) return _cached;
     const raw = await loadConfigFile();
     _cached = configSchema.parse(raw);  // Zod throws on invalid
     return _cached;
   }

   export function resetConfigCache(): void {
     _cached = null;  // for tests
   }
   ```

   Refactor the 17 substrate packages to consume `getValidatedConfig()`
   instead of `JSON.parse(readFileSync('.claude-flow/config.json'))`.

3. **Arch-test guard**:

   ```ts
   // cli/__tests__/arch/config-no-raw-parse.arch.test.ts (NEW)
   import { glob } from 'glob';
   import { readFileSync } from 'fs';

   it('no raw JSON.parse of config.json outside the validated accessor', async () => {
     const offenders: string[] = [];
     const files = await glob('forks/ruflo/v3/@claude-flow/**/src/**/*.ts', {
       ignore: ['**/shared/src/core/config/**', '**/__tests__/**', '**/dist/**'],
     });
     for (const f of files) {
       const src = readFileSync(f, 'utf8');
       if (/JSON\.parse\s*\([^)]*config\.json/.test(src)) {
         offenders.push(f);
       }
     }
     expect(offenders).toEqual([]);
   });
   ```

   New code that re-introduces a raw parse fails CI; the only allowed
   site is the accessor's own definition. **Implementation nuance (verified
   2026-05-22):** several existing bypass sites carry `// adr-0100-allow`
   markers (e.g. `memory/src/memory-graph.ts:65`, tracked under ADR-0118) —
   the refactor must migrate those to the accessor AND remove the
   now-obsolete markers, and the arch-test must NOT honour an
   `adr-0100-allow` escape for a `config.json` raw-parse (else the bypass
   persists behind an annotation).

### Consequences

- Good, because the user-facing coherence invariant holds —
  `ruflo config get embedding.provider` and
  `ruflo config get memory.embeddings.provider` return the same value.
- Good, because malformed config.json (string-where-number, invalid enum)
  fails loud at the first access, not silently five layers down.
- Good, because the arch-test guards against regression — future substrate
  packages cannot re-introduce the bypass.
- Good, because the accessor is small and idiomatic — wraps the existing
  Zod path, adds caching, exposes typed getters.
- Bad, because 17 packages need refactoring — the changes are mechanical
  (one import + one call) but spread across the tree.
- Bad, because the accessor is async (Zod parsing is fine, but some
  current call-sites are sync `readFileSync` paths; migrating them to
  async or maintaining a sync variant is a small ergonomic cost).
  Mitigation: provide both `getValidatedConfig()` (async) and
  `getValidatedConfigSync()` (sync, eager-cache after first async warm)
  if needed.
- Neutral, because existing on-disk config.json files with the divergent
  `"transformers.js"` value continue to work via the runtime normaliser
  — no migration required.

### Confirmation

1. **Unit test (F-14-009):** generate a fresh config.json via
   `getMinimalConfigTemplate()` + `getFullConfigTemplate()`; assert
   `embedding.provider === memory.embeddings.provider === "onnx"`.
2. **Unit test (F-14-014 — accessor positive):** seed a valid
   config.json; call `getValidatedConfig()`; assert returns the parsed
   Config object.
3. **Unit test (F-14-014 — accessor negative):** seed an invalid
   config.json (string where number expected); call
   `getValidatedConfig()`; assert it throws with a Zod error message.
4. **Arch-test:** new test under
   `forks/ruflo/v3/@claude-flow/cli/__tests__/arch/config-no-raw-parse.arch.test.ts`
   passes; introducing a `JSON.parse('.claude-flow/config.json')` in any
   substrate package fails CI.
5. **Acceptance check:** fresh `ruflo init` sandbox; run
   `ruflo config get embedding.provider` and
   `ruflo config get memory.embeddings.provider`; assert both return
   `"onnx"`.
6. **`npm run release`** acceptance — all existing config-related groups
   pass; the 17-package refactor must NOT regress functionality
   (caching means runtime cost is equivalent or better).

## Pros and Cons of the Options

### Option A — single accessor + arch-test + default unification

- Good, because closes the root-cause pattern, not just the symptom.
- Good, because the arch-test prevents regression — the audit-finding
  "17 packages bypass Zod" cannot grow to "18 packages."
- Bad, because 17-package refactor (mechanical but spreading).

### Option B — only F-14-009

- Bad, because leaves the structural Zod-bypass pattern open.

### Option C — only F-14-014

- Bad, because leaves the user-facing coherence violation
  (provider-default skew).

### Option D — Zod-as-decorator middleware

- Bad, because the bypass IS the opt-out; making it middleware doesn't
  improve enforcement.

## Direct review (2026-05-22)

Reviewed directly (not via swarm) against the live fork source. **Verdict:
Option A confirmed; one implementation nuance.**

- **F-14-009 verified** — `config-template.ts:85` emits `provider: 'onnx'`
  while `:173` emits `provider: 'transformers.js'` for the same logical
  concept; `config-chain/src/index.ts:176` normalises at runtime, so the skew
  is `config get`-visible only. (The ADR cites `:86` for the onnx line; actual
  is `:85` — drift of 1.)
- **F-14-014 verified** — the
  `JSON.parse(readFileSync(join(…, 'config.json')))` bypass is real and
  widespread; the four sampled sites (`memory/src/memory-graph.ts:65`,
  `neural/src/algorithms/sarsa.ts:20`, `embeddings/src/rvf-embedding-service.ts:57`,
  `cli/src/ruvector/q-learning-router.ts:23`) match exactly, each a
  `try { … } catch { return <hardcoded fallback>; }` shape — the no-fallbacks
  pattern at the config layer. The Zod loader/schema exist in
  `shared/src/core/config/` (`loader.ts`/`schema.ts`), so the accessor
  wrapping them is feasible.
- **Implementation nuance (folded in):** some bypass sites carry
  `// adr-0100-allow` markers — the refactor must migrate them and drop the
  markers, and the arch-test must not grant an `adr-0100-allow` escape for a
  `config.json` raw-parse.

Option A (single accessor + arch-test + default unification) closes the root
cause (no enforced single-accessor discipline), not just the symptom; Options
B/C (half-fixes) and D (opt-in middleware) are correctly rejected. The scope
boundary (the F-14-005/006/007/008/010/011 cluster left to their own ADRs) is
appropriate.

## More Information

- **Audit source:** `docs/audits/2026-05-19-soundness-audit/14-config-soundness.md`
  findings F-14-009 (CRITICAL) + F-14-014 (HIGH per README H17 / WARNING
  per per-doc); README `00-README.md` HIGH H17; audit recommendation #3
  (line 568-574).
- **Memory references:** [[feedback-no-fallbacks]],
  [[project-config-gaps]] (the per-doc audit notes recommend updating
  this memory with the new dead-key + naming-skew + Zod-bypass findings),
  [[project-adr0201-remediation-impl-order]].
- **Related ADRs:** ADR-0201 (parent audit), ADR-0214 (env-var
  canonicalization — sibling, different surface), ADR-0069 (the original
  config-keys dead-key wiring program — context for the F-14-005 cluster
  flagged out of scope here), ADR-0209 (no-fallbacks arch-test —
  precedent for the arch-test guard).
- **Adjacent findings out of this ADR's primary scope (flagged for
  dialectic to decide whether to fold or split):** F-14-005, F-14-006,
  F-14-007, F-14-008, F-14-010, F-14-011, F-14-012, F-14-013,
  F-14-015, F-14-016, F-14-017, F-14-018. The dialectic may pull
  F-14-008 (dual-write mirror) into this ADR's scope since it shares the
  default-skew root cause; the rest are different shapes (dead-key
  cleanup, full-vs-minimal template, env-var bounds, type-mismatch)
  and likely belong in their own ADRs or are accepted as documented
  limitations.
