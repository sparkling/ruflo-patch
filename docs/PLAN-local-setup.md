# Plan: Make ruflo-patch Build & Install on This Server

## Current State
- Local Verdaccio (localhost:4873): running via launchctl `com.verdaccio`, stale cache
- ~/.npmrc: points to hz server (100.119.242.104) — needs changing to localhost
- No fork repos cloned locally
- Fork paths in config hardcoded to `/home/claude/src/forks/`

## Phase 1: Configure Local Verdaccio (Self-Contained)

Update `~/.config/verdaccio/config.yaml` for self-contained local use:

1. Keep npmjs uplink (for public deps like typescript, zod, etc.)
2. Add `@sparkleideas/*` package rules: `publish: $all` (no auth needed for pipeline)
3. Clear stale @sparkleideas cache from local storage
4. Restart Verdaccio
5. Update `~/.npmrc` to point to `http://localhost:4873`

## Phase 2: Clone Fork Repos & Update Paths

1. Create fork directory: `/Users/henrik/source/forks/`
2. Clone 3 upstream repos:
   - `ruvnet/ruflo` → `/Users/henrik/source/forks/ruflo` (branch: main)
   - `ruvnet/agentic-flow` → `/Users/henrik/source/forks/agentic-flow` (branch: feature/agentic-flow-v2)
   - `ruvnet/ruv-FANN` → `/Users/henrik/source/forks/ruv-FANN` (branch: main)
3. Update `config/upstream-branches.json` to use local paths

## Phase 3: Build Pipeline

1. `npm run preflight` — validate environment
2. `npm run build` — full build (copy-source → codemod → tsc → wasm)
3. `npm run test:unit` — unit tests
4. `npm run publish:verdaccio` — publish all 42 packages to local Verdaccio
5. `npm run test:acceptance` — acceptance tests against local registry

## Phase 4: Verify Install

1. `npm install -g @sparkleideas/cli --registry http://localhost:4873`
2. `npx @sparkleideas/cli@latest --version`

## Notes
- Fully self-contained: no dependency on hz server
- Local Verdaccio proxies to npmjs.org for public packages only
- Build artifacts go to /tmp/ruflo-build/
