# Integration tests

This tier sits between unit and acceptance:

| Tier | Scope | Runtime | Command |
|---|---|---|---|
| **Unit** | Single module, mocked deps | `tests/unit/` | `npm run test:unit` |
| **Integration** | Multiple modules together, real deps, no published packages | `tests/integration/` | `npm run test:integration` |
| **Acceptance** | End-to-end against published Verdaccio packages | bash scripts in `lib/acceptance-*-checks.sh` | `npm run release` → cascades through |

## When to add an integration test

Use this tier when:

- The behaviour spans 2+ modules and the unit-level mock would lie (e.g. memory router + agentdb handler dispatch path).
- The dependency is a real fork package via path/file: resolution, NOT an `@sparkleideas/*` Verdaccio publish.
- The test runs in <5s — anything heavier belongs in acceptance.

## Conventions

- File suffix `.test.mjs`.
- Use `node:test` (no vitest in this tier — keeps the runner stable across forks).
- Each test cleans up its own tmp dirs.
- No external services (no IPFS, no Pinata, no Anthropic) — those go in acceptance with `HEAVY_SKIP`.

## Status (2026-05-18)

This tier was scaffolded as part of the "test coverage A-grade" push. It
starts with one placeholder test (`scaffold.test.mjs`) that validates
the runner picks up files from this directory. Real cross-module tests
will be added as they're identified.
