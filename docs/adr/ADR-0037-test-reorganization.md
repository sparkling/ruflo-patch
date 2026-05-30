---
status: accepted
date: 2026-03-15
tags: [testing, pipeline, publish]
supersedes: []
depends-on: []
implements: []
---

# Test Suite Reorganization

## Context and Problem Statement

test-verify.sh conflates 3 concerns: publish, test, promote.
test-acceptance.sh duplicates the test logic.
Acceptance tests run against bare npm install, not initialized projects.
Layer numbering and T-numbering add indirection without value.

## Decision Drivers

1. Publishing is CI/CD infrastructure, not testing
2. Acceptance tests should run against properly initialized projects
3. Two scripts with overlapping logic = maintenance burden
4. Layer numbering (L0-L4) and T-numbers are opaque

## Considered Options

* **Extract publish/promote, unify acceptance into a single harnessed script, and drop opaque numbering (chosen)**.

(No alternatives were recorded.)

## Decision Outcome

Chosen option: "Extract publish/promote, unify acceptance into a single harnessed script, and drop opaque numbering", because it separates CI/CD infrastructure (publish/promote) from testing, runs acceptance against properly initialized projects, and removes the maintenance burden of two overlapping scripts and opaque layer/T numbering.

### Specification (SPARC-S)

- Extract publish/promote into dedicated `scripts/publish-verdaccio.sh`
- Keep `test-acceptance.sh` as the single acceptance test script
- Add unified harness: install -> init --full -> memory init
- Drop layer numbering, T-numbering, RQ naming
- Split T32 into 5 separate checks

### Pseudocode (SPARC-P)

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

### Architecture (SPARC-A)

| File | Action |
|------|--------|
| `docs/adr/ADR-0037-test-reorganization.md` | Create (this ADR) |
| `scripts/publish-verdaccio.sh` | Create (extract from test-verify.sh phases 1-5, 9) |
| `scripts/test-acceptance.sh` | Rewrite (add harness, split T32, rename IDs, remove publish/promote) |
| `lib/acceptance-checks.sh` | Edit (remove 3 functions, strip init calls, strip T-comments) |
| `scripts/sync-and-build.sh` | Edit (split run_verify -> run_publish_verdaccio + run_acceptance, scrub layer names) |
| `package.json` | Edit (remove test:verify) |
| `scripts/test-verify.sh` | Delete |
| `tests/*.test.mjs` (15 files) | Rename (drop numeric prefix) |
| `tests/CLAUDE.md` | Rewrite |

### Refinement (SPARC-R)

- Publish gated on unit tests passing (run_tests_ci before publish)
- Promote runs immediately after publish (local Verdaccio, no external consumers)
- Acceptance tests validate the promoted @latest packages
- Harness failure = abort (infrastructure error, not test failure)
- Atomic commit for phase 2 to avoid pipeline breakage

### Consequences

#### Completion (SPARC-C)

* Good, because publish and test are independent, composable steps
* Good, because all acceptance tests run against a properly initialized project
* Good, because single test script to maintain
* Good, because descriptive names throughout
* Bad, because harness failure blocks all tests (intentional)
* Bad, because sync-and-build.sh run_verify() split into run_publish_verdaccio() + run_acceptance()

### Confirmation

Verification:
1. `npm run test:unit` -- unit tests pass with renamed files
2. `bash scripts/publish-verdaccio.sh --build-dir /tmp/ruflo-build` -- publishes cleanly
3. `npm run test:acceptance` -- full acceptance suite passes against Verdaccio
4. `grep -rn 'L0\|L1\|L2\|L3\|L4\|test:verify\|test:rq\|RQ_PORT\|rq_pass' scripts/ tests/ package.json` -- no stale references
5. `grep -rn '"T[0-9]' scripts/ lib/` -- no T-numbered IDs remain
6. Full pipeline: `npm run deploy` -- end-to-end passes

## More Information

This ADR supersedes ADR-0036 (the prior test-reorganization record, no longer present in the corpus).

This record used the SPARC + MADR methodology, with section headings (Specification / Pseudocode / Architecture / Refinement / Completion) remapped to the canonical MADR sections during the ADR-0271 migration, preserving all content. The deciders were the sparkling team. Original status: "Accepted (supersedes ADR-0036)".
