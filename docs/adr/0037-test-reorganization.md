# ADR-0037: Test Suite Reorganization

## Status

Accepted (supersedes ADR-0036)

## Date

2026-03-15

## Deciders

sparkling team

## Methodology

SPARC + MADR

## Context

test-verify.sh conflates 3 concerns: publish, test, promote.
test-acceptance.sh duplicates the test logic.
Acceptance tests run against bare npm install, not initialized projects.
Layer numbering and T-numbering add indirection without value.

### Decision Drivers

1. Publishing is CI/CD infrastructure, not testing
2. Acceptance tests should run against properly initialized projects
3. Two scripts with overlapping logic = maintenance burden
4. Layer numbering (L0-L4) and T-numbers are opaque

## Decision: Specification (SPARC-S)

- Extract publish/promote into dedicated `scripts/publish-verdaccio.sh`
- Keep `test-acceptance.sh` as the single acceptance test script
- Add unified harness: install -> init --full -> memory init
- Drop layer numbering, T-numbering, RQ naming
- Split T32 into 5 separate checks

## Pseudocode (SPARC-P)

Pipeline flow:

```
sync-and-build.sh
  -> run_tests_ci()              # preflight + unit
  -> run_publish_verdaccio()     # calls publish-verdaccio.sh (publish + promote)
  -> run_acceptance()            # calls test-acceptance.sh
```

publish-verdaccio.sh:

```
verdaccio health check -> cache clear -> publish packages
-> publish wrapper -> npx cache clear -> promote to @latest
```

test-acceptance.sh:

```
harness: install -> init --full -> memory init
tests: smoke -> structure -> functional -> controller -> e2e
```

## Architecture (SPARC-A)

| File | Action |
|------|--------|
| `docs/adr/0037-test-reorganization.md` | Create (this ADR) |
| `scripts/publish-verdaccio.sh` | Create (extract from test-verify.sh phases 1-5, 9) |
| `scripts/test-acceptance.sh` | Rewrite (add harness, split T32, rename IDs, remove publish/promote) |
| `lib/acceptance-checks.sh` | Edit (remove 3 functions, strip init calls, strip T-comments) |
| `scripts/sync-and-build.sh` | Edit (split run_verify -> run_publish_verdaccio + run_acceptance, scrub layer names) |
| `package.json` | Edit (remove test:verify) |
| `scripts/test-verify.sh` | Delete |
| `tests/*.test.mjs` (15 files) | Rename (drop numeric prefix) |
| `tests/CLAUDE.md` | Rewrite |

## Refinement (SPARC-R)

- Publish gated on unit tests passing (run_tests_ci before publish)
- Promote runs immediately after publish (local Verdaccio, no external consumers)
- Acceptance tests validate the promoted @latest packages
- Harness failure = abort (infrastructure error, not test failure)
- Atomic commit for phase 2 to avoid pipeline breakage

## Completion (SPARC-C)

Verification:
1. `npm run test:unit` -- unit tests pass with renamed files
2. `bash scripts/publish-verdaccio.sh --build-dir /tmp/ruflo-build` -- publishes cleanly
3. `npm run test:acceptance` -- full acceptance suite passes against Verdaccio
4. `grep -rn 'L0\|L1\|L2\|L3\|L4\|test:verify\|test:rq\|RQ_PORT\|rq_pass' scripts/ tests/ package.json` -- no stale references
5. `grep -rn '"T[0-9]' scripts/ lib/` -- no T-numbered IDs remain
6. Full pipeline: `npm run deploy` -- end-to-end passes

## Consequences

### Positive

- Publish and test are independent, composable steps
- All acceptance tests run against a properly initialized project
- Single test script to maintain
- Descriptive names throughout

### Negative

- Harness failure blocks all tests (intentional)
- sync-and-build.sh run_verify() split into run_publish_verdaccio() + run_acceptance()
