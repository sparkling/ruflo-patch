---
status: accepted
date: 2026-06-11
tags: [cli, parser, flag-validation, fix, upstream-shared, batch-u-followup]
supersedes: []
depends-on: [ADR-0316]
implements: []
---

# Parser drops the space-form boolean literal `--flag false`

## Context and Problem Statement

The fork's `CommandParser` (`v3/@claude-flow/cli/src/parser.ts`) set a registered
boolean flag to `true` **unconditionally** when it appeared, never inspecting a
following `true`/`false` token. So a default-true boolean could not be disabled
via the space form: `route … --explore false` (and `-e false`) left `explore`
`true`. `--explore=false` (the `=` form) and `--no-explore` (the ADR-0316
negation form) both worked; only the **space form** was broken.

This is upstream's "Bug C" from `a73a2cbe3` (#2229). It surfaced as a Batch-U
([[ADR-0313]]) FLAG: the disposition deferred it pending a trace of whether the
fork's ADR-0316-reworked parser already handled it. The trace (2026-06-11)
confirmed the gap is **real and orthogonal to [[ADR-0316]]** — ADR-0316 only
touched `validateFlags` (the `--no-*` known-flag registration), not the
value-coercion branches where this bug lives.

## Decision

Hand-port upstream `a73a2cbe3`'s parser fix, adapted to the fork. In both the
long-flag and short-flag boolean branches, consume an explicit boolean literal
before the unconditional-`true` fallback:

```ts
if (booleanFlags.has(normalizedKey)) {
  if (nextIndex < args.length && this.isBooleanLiteral(args[nextIndex])) {
    flags[normalizedKey] = args[nextIndex].toLowerCase() === 'true';
    nextIndex++;
  } else {
    flags[normalizedKey] = true;
  }
}
```

plus a private `isBooleanLiteral(arg)` helper. `--explore=false` and
`--no-explore` are untouched (different branches), so ADR-0316 is unaffected.

## Consequences

- Good: `--explore false` / `-e false` now disable a default-true boolean,
  matching the `=` and `--no-` forms and upstream behavior.
- Good: orthogonal to ADR-0316 — no regression to `--no-*` validation.
- Neutral: only affects **registered** boolean options (the bug never manifested
  for unknown flags, which already took the value path).

## Confirmation

Regression test in `__tests__/parser.test.ts` asserts all forms: `--explore
false` → false, `--explore true` → true, `-e false` → false, `--explore=false`
→ false (regression), `--no-explore` → false (regression). Rides the cli vitest
suite (pipeline test-ci). `tsc --noEmit` clean. Shipped: forks/ruflo `17a5932f7`.

## More Information

Batch-U row in `docs/upstream/INTEGRATION-LEDGER.md`; upstream `a73a2cbe3` Bug C.
