---
status: accepted
date: 2026-06-17
tags: [ruvector, embeddings, offline, infrastructure, verdaccio]
supersedes: []
depends-on: [ADR-0190]
implements: []
---

# RuVector offline model bundling and Verdaccio body-limit increase

## Context and Problem Statement

A prompt run on the `hm` workstation — which sits behind a Zscaler corporate proxy that 403s the HuggingFace model CDN (`cas-bridge.xethub.hf.co`) — failed to load `@sparkleideas/ruvector` as an offline embedding fallback. Investigation found the published wrapper was broken in three independent ways, and that even a correctly-built package could not embed without network:

1. The last publish was a manual `/tmp/mcp-hotfix` `npm pack` that skipped `tsc`, so the tarball shipped `src/` with **no `dist/`** while `main` pointed at `dist/index.js` → `MODULE_NOT_FOUND`. The pre-publish `verify-dist.js` gate (which exists to catch exactly this) never ran.
2. The same hotfix froze a stale dependency pin (`@sparkleideas/ruvector-sona@0.1.6-patch.215`) that was never published → `npm install` `ETARGET`. Even the then-current `latest` (`.939`) was a dist-less 666 KB tarball.
3. The Node embedding path always downloaded the MiniLM model from HuggingFace at runtime: `loader.js`'s disk cache is browser-`Cache API`-only, `loadFromFiles` was never wired, and there was no offline env override — so even a loadable package failed behind the proxy.
4. Latent runtime bug: the build copied only `src/core/onnx/pkg/` into `dist/`, leaving `dist/core/onnx/loader.js` missing — the online path threw at runtime regardless of `dist/index.js`.

The question: how do we make `@sparkleideas/ruvector` embed reliably offline, and ship the fix through the fork's own Verdaccio pipeline rather than a hand-packed hotfix?

## Decision Drivers

* Must embed fully offline behind a proxy that blocks the HF model CDN.
* The bundled WASM embedding engine (`ruvector_onnx_embeddings_wasm`) only runs the **fp32** ONNX graph — it rejects the quantized variant (`/Unsqueeze AddDims`) and fp16 too.
* Must ship via the standard `npm run release` pipeline — no more manual `/tmp` packs.
* The publish must fail loudly when the artefact is incomplete (`verify-dist`).

## Considered Options

* **Bundle the fp32 model into the package** — ship the 90 MB MiniLM `model.onnx` + tokenizer inside `@sparkleideas/ruvector`, add an offline-first load path, and raise Verdaccio's body limit to admit the larger tarball.
* **Pre-seed the model per consumer host** — keep the package small; wire an offline local-path env var and copy weights to each machine.
* **Allowlist the HF CDN through Zscaler (IT)** — zero code, but out of our control and not durable.

## Decision Outcome

Chosen option: **bundle the fp32 model**, because it makes the package work offline out-of-the-box everywhere with no per-host provisioning, and ships entirely through the fork's own infrastructure. The quantized/fp16 variants are not viable (the WASM engine rejects them), so the bundle is necessarily the 90 MB fp32 model.

Implementation (`forks/ruvector/npm/packages/ruvector`):

- Bundled `all-MiniLM-L6-v2/{model.onnx (fp32), tokenizer.json}` under `src/core/onnx/pkg/models/<modelId>/` (committed to git; `dist/` ships via the `files` whitelist; the existing 7.4 MB WASM blob is the precedent for plain-git binaries — no LFS).
- `onnx-embedder.ts initOnnxEmbedder`: offline-first model resolution — **bundled → `RUVECTOR_MODEL_DIR` → HuggingFace download fallback**.
- Build script now copies the full `src/core/onnx/.` tree so `loader.js` (online fallback) and the bundled model both reach `dist/`.
- Raised the shared Verdaccio `max_body_size` 100 → 200 MB. npm publishes the tarball base64-encoded inside a JSON PUT (~33% inflation: an 86 MB tarball → ~115 MB body), so the 100 MB limit `E413`'d the publish. Reloaded Verdaccio via `launchctl kickstart -k gui/$(id -u)/com.verdaccio`, preserving the load-bearing `0.0.0.0:4873` wildcard bind.

Shipped as `@sparkleideas/ruvector@0.1.2-patch.941` (now `latest`) via `npm run release`.

### Consequences

* Good, because `@sparkleideas/ruvector` now embeds offline out-of-the-box — verified by a fresh install with `fetch` disabled (384-dim; related/unrelated cosine 0.379/0.004).
* Good, because the fix flows through the standard pipeline and `verify-dist` (13/13) now guards against future dist-less publishes.
* Bad, because the package tarball is ~86 MB and the git history carries a 90 MB blob (one-time, frozen model — not iterated).
* Bad, because every `npm install` of the wrapper pulls 86 MB (over Tailscale for remote consumers).
* Neutral, because the WASM engine's fp32-only constraint forced the larger model; quantized would be ~23 MB but does not run.
* Neutral, because the Verdaccio `max_body_size` 200 MB bump is a standing change on the registry host — now headroom for any large bundled package.

### Confirmation

* `verify-dist.js` passes (13/13 dist paths referenced by `bin/cli.js`) in the publish pipeline.
* Acceptance: fresh `npm install @sparkleideas/ruvector@latest` in a clean dir → `require()` loads (deps resolve, no `ETARGET`) and `initOnnxEmbedder()` + `embed()` produce a 384-dim vector with `globalThis.fetch` overridden to throw (zero network).

## More Information

- Distinct from two other embedding paths surfaced in the same investigation: (a) the **AgentDB/xenova** offline path, made durable via the `AGENTDB_MODEL_PATH` stable cache (a separate system); (b) consumers that depend on **upstream bare `ruvector`** (a separate `0.2.x` line proxied through Verdaccio — the fork publishes the rescoped `@sparkleideas/ruvector` `0.1.2-patch` line, NOT bare `ruvector`, so this bundle does not reach bare-ruvector consumers).
- **ADR-0190** ("codify the cross-repo TypeScript package build contract") addressed the *same bug class* — `@sparkleideas/ruvector-ruvllm` was published with `main: dist/cjs/index.js` but a `dist`-less tarball → `MODULE_NOT_FOUND`. Defect #1 here is a recurrence of that exact failure; the `verify-dist` confirmation in this ADR is the enforcement of ADR-0190's dist-completeness contract (hence `depends-on: [ADR-0190]`).
- Related ruvector fork-patch ADRs: ADR-0294 (rabitq mirror publish), ADR-0298 (`ruvector@0.2.25` call reshape), ADR-0308 (ruvllm MicroLoRA). Scope-rename convention: ADR-0006.
- The Verdaccio wildcard-bind and `max_body_size` infra notes live in the project `CLAUDE.md` (Infrastructure: Verdaccio Registry).
