# ADR-0102: Unified Embedding & Index Config — Cross-Context Schema

- **Status**: Proposed 2026-04-26 — pending implementation; supersedes nothing, extends ADR-0068
- **Date**: 2026-04-26
- **Scope**: One canonical config file driving embedding model, dimension, distance metric, HNSW (m / efConstruction / efSearch), and quantization across both the ruflo orchestration layer (Node/TS) and the ruvector storage+index layer (Rust). All consumer sites read from a single loader; no hardcoded literals in business code.
- **Related**: ADR-0052 (Config-driven Embedding Framework), ADR-0066 (Controller Configuration Unification), ADR-0068 (Controller Configuration Implementation — extended by this ADR), ADR-0069 (384→768 safety gate), ADR-0082 (no read-side-effects), ADR-0094 (acceptance coverage living tracker)
- **Memory**: `reference-embedding-model`, `feedback-no-fallbacks`, `feedback-test-in-init-projects`, `project-rvf-primary`

## Context

The ruvector fork has 10 hardcoded `embedding_dim: 384` literals (in `crates/ruvllm/src/claude_flow/*` and `crates/ruvector-crv/src/types.rs`) plus split-brain HNSW parameters relative to ruflo:

| Setting | ruflo (`resolve-config.ts`) | ruvector (`rvf-runtime`) |
|---|---|---|
| dim default | 768 (mpnet) | 768 in 4 crates, 384 hardcoded in 10 sites |
| HNSW M | derived `floor(sqrt(dim)/1.2)` ≈ 23 | 16 |
| HNSW efConstruction | 100 | 200 |
| HNSW efSearch | 50 | 100 |
| Source of truth | `.claude-flow/embeddings.json` (4-layer chain) | `ruvector.toml` — but no `init` materializes it |
| 384 safety gate | `resolve-config.ts:304` (rewrites to 768) | none — 10 sites silently produce 384 |

ADR-0052/0066/0068/0069 set the architectural rule: **embedding/index parameters must come from the config chain, never from per-call-site literal defaults.** The 10 stragglers don't just have the wrong default — they bypass the config chain entirely. Worse: ruflo's safety gate actively rewrites 384→768, so the ruvector sites silently produce values that the orchestration layer is designed to reject.

Recasting the user's framing — *"imagine this as a public project, with many different users and setups"* — the existing setup fails: a Rust developer running `cargo add ruvector-core` cannot set `model = "bge-large-en-v1.5"` without recompiling, a Node user can configure ruflo but not the ruvector sub-component, and existing deployments cannot tell from the config file what their indexes will actually do. ADR-0101 (fork READMEs) cannot honestly document the install story until this is fixed.

### Hive composition

A 7-worker hive plus a queen synthesizer voiced positions on the approach and six open questions:

- **ruflo config-chain expert** — knows `resolve-config.ts`, the 4-layer chain, the 384 gate, executor.ts writeback semantics
- **ruvector Rust workspace expert** — knows the Cargo workspace, crate layering, no_std/wasm constraints
- **DDD bounded-context expert** — config ownership, anti-corruption layers, shared kernel discipline
- **Public API / DX expert** — external user lens, zero-config requirement, discoverability
- **Migration / backwards-compat expert** — schema evolution, reversibility, deployment risk
- **Operations / SRE expert** — observability, error modes, debug commands
- **Devil's advocate** — challenged every premise, including whether a file should exist

The full position briefs from each expert are archived in the discussion thread that produced this ADR.

## Decision

### Approach (Queen's verdict: GO MODIFIED)

Adopt a unified config schema, owned by ruvector, consumed by ruflo. The devil's advocate's "just bump the default" is rejected because Rust and Node consumers must agree byte-for-byte at runtime — a TS-only export cannot bind Rust callers. Existing on-disk indexes are NOT a migration concern: index headers are self-describing (dim, M baked in at creation), so the loader uses header values for existing indexes and config values only for new index creation. Coexistence is automatic.

### Q1 — File location

**Strict-precedence single-directory lookup, walk-up opt-in.**

The loader checks, in order:

1. `.claude-flow/embeddings.json` at the detected project root (existing ruflo installed base wins)
2. `.ruvector/config.json` at the detected project root (standalone ruvector deployments)
3. Compiled defaults

No silent walk-up to ancestor directories. Set `RUVECTOR_CONFIG_WALK=1` to enable walk-up for monorepo users.

**Rationale**: 5 of 7 experts wanted full walk-up; the operations expert is right that "which ancestor won?" is operationally opaque and creates mystery defaults. Single-directory precedence preserves cross-fork interop without inventing a fourth config-discovery system.

### Q2 — Standalone file name

**`.ruvector/config.json`** as the canonical standalone file. JSON only.

`ruvector.toml` is accepted as a **read-only adapter format** (the loader parses it if present, never writes it) for users following Cargo conventions, but `.ruvector/config.json` is what `ruvector init` materializes.

**Rationale**: JSON unifies parsers across Rust and Node — one parser, one schema, no drift surface. The dotted directory mirrors `.claude-flow/`, signaling parallel context ownership and leaving room for sibling files (`.ruvector/cache/`, `.ruvector/snapshots/`) without future migrations.

### Q3 — Migration (most contentious)

**In-memory derive only at read time. No writeback as a side effect of reading.** Writeback is performed exclusively via explicit user action: `ruflo embeddings sync` or `ruvector config migrate`. Schema includes `schemaVersion: 1` from day one.

**Rationale**: The "fill + writeback with stderr notice" position (held by ruflo and DX experts) loses on three concrete grounds raised by the migration, ops, and Rust workspace experts:

1. **Race conditions** — concurrent processes hitting the same project fight over the file
2. **Git status pollution** — silent rewrites at read time make `git status` lie to users
3. **ADR-0082 violation** — read paths with side effects are exactly what that ADR prohibits

The DDD expert's compromise (writeback only by `ruflo init`) is structurally correct but insufficient; an explicit `migrate` command is the same idea with a clearer user contract.

**Conditions**:
- Stderr WARN on every defaulted key with source attribution: `dim=768 [from-model-default, file-missing]`
- `ruvector config show` ships in the same release as the loader
- Existing `executor.ts` writeback for the legacy 2-key file is preserved via a compatibility shim, but new keys are NOT written by it

### Q4 — Patch IDs

**`RV-CONFIG-N` series**, with a CI gate that fails the patch repo build if any `RV-CONFIG-N` patch is referenced but not present in the materialized fork tree.

**Rationale**: 6 of 7 experts agreed. The devil's advocate's "bureaucracy unless CI uses it" objection is converted into a precondition (the CI gate) rather than overridden.

### Q5 — PR shape

**Staged, four PRs:**

1. **PR1**: Loader + JSON Schema + structured load logging + `ruvector config show` + grep-gate CI check + fixture audit. **No behavior change at any consumer.**
2. **PR2**: New `ruvector-config` crate (Rust) + Node loader. Wire `rvf-adapters/claude-flow` (Node ACL) and one Rust call site behind `cfg(feature = "config-v2")`.
3. **PR3**: Migrate the 10 `ruvllm/claude_flow/*` and `ruvector-crv` sites onto the loader. Delete literals. Move the 384→768 safety gate INTO the loader. Remove the feature gate. Atomically update test fixtures.
4. **PR4**: Ship `ruflo embeddings sync` + `ruvector config migrate`. Update `init` templates. Mark ADR-0068 as extended-by ADR-0102.

**Rationale**: Atomic single-PR (devil's advocate) conflates a default change with a config-system change, with no escape valve when on-disk indexes break. Two-PR (some experts) lacks the feature-gate seam. The four-PR cut keeps each PR independently revertible and shipping value.

### Q6 — ADR

**This ADR (ADR-0102), new.** ADR-0068 is marked "extended by ADR-0102" in its status header. A sibling ADR (`ruvector/docs/adr/ADR-0001-embedding-config-schema.md`) is created in the ruvector fork itself documenting the schema authority.

**Rationale**: Cross-context schema ownership is a different decision than ADR-0068 (which only specified ruflo's resolution chain). Extending 0068 conflates "what model do we use" with "where does config live and who owns the schema." Two concerns, two ADRs.

### Loader location (elevated decision beyond Q1-Q6)

**New `ruvector-config` crate**, sibling to `ruvector-core`, not inside it.

`ruvector-core` is the no_deps base. Adding `std::fs`, `serde_json`, and walk-up logic there pollutes 40+ downstream crates — including `ruvector-wasm`, `ruvector-attention-wasm`, `ruvector-graph-wasm` — which target `no_std`/wasm. Loader I/O must live in a separate crate that wasm targets do not depend on.

`ruvector-core` exports the typed `Config` struct (the value object). `ruvector-config` adds:
- Walk-up search and precedence resolution
- JSON parsing (canonical) + TOML adapter (read-only)
- Schema validation (fail loudly per `feedback-no-fallbacks`)
- Defaults derivation (`m = floor(sqrt(dim)/1.2)`, clamped [8, 48])
- Env var overrides
- Logger interface

The DDD expert's ownership concern is satisfied: both crates live in the storage bounded context.

### Existing on-disk indexes (non-issue, documented for clarity)

**Index parameters are self-describing in the header; config governs only new index creation.** A 384-dim index opens with dim=384 read from its header; a config file declaring dim=768 only affects indexes the user creates *after* the upgrade. Old and new indexes coexist in the same process without conflict.

This was initially flagged as a migration blocker — HNSW `m` is build-time, vector dim cannot be transformed across embedding models. On reflection: the loader doesn't need to migrate or refuse anything. The header always wins for an existing index. Config is consulted at index *creation*, not at *open*. There is no silent corruption path because creation and open use different code paths.

For users who actively want to switch embedding models, see Appendix A.

### Observability (mandatory in PR1)

Per ops expert, structured load-time logging is non-negotiable:

```
config.loaded path=/x/.claude-flow/embeddings.json keys_from_file=2 keys_defaulted=5 \
  model=Xenova/all-mpnet-base-v2 dim=768 hnsw.m=23 hnsw.efC=100 hnsw.efS=50
```

Every defaulted key logs source attribution: `[from-file]`, `[from-model-default]`, `[from-env-RUVECTOR_DIM]`. Conflicting files (both `.claude-flow/embeddings.json` and `.ruvector/config.json` present) → WARN naming both, no silent merge.

### Env overrides (mandatory in PR1)

- `RUVECTOR_DIM` — affects new index creation; ignored when opening an existing index (header wins)
- `RUVECTOR_MODEL` — affects which model is loaded for embedding new content
- `RUVECTOR_HNSW_M` — affects new index creation; ignored when opening an existing index (build-time invariant baked in header)
- `RUVECTOR_HNSW_EFC` — affects new index creation; ignored on open
- `RUVECTOR_HNSW_EFS` — query-time, always honored
- `RUVECTOR_CONFIG_WALK=1` — enables walk-up search

Every override logs at INFO with source `[env]`. When an env override is ignored because an existing index already has the value baked in its header, log at INFO with reason `[ignored, header-pinned]`.

## Hidden risks accepted / addressed

| Risk (raised by) | Mitigation |
|---|---|
| 384-dim indexes break silently on upgrade (devil's advocate) | Non-issue: index headers are self-describing; loader reads header, not config, for existing indexes |
| HNSW M is build-time — silent change corrupts index (migration expert) | Same: M is in the index header; config M applies only to new indexes |
| ruvllm not feature-gated → 10 sites ship to standalone today (Rust workspace expert) | PR2 feature gate covers transition; PR3 removes literals atomically |
| Fixture lock-in to 384 (devil's advocate) | PR1 audits acceptance fixtures; PR3 updates atomically with default change |
| Walk-up opacity (ops expert) | Walk-up disabled by default; opt-in via env var |
| Two-ecosystem coupling via shared file (devil's advocate) | Schema owned by ruvector, imported by ruflo, never redefined; coupling is one-directional |
| Schema drift between Rust and Node loaders (devil's advocate) | JSON Schema is the contract; both loaders validated against it in CI |
| `git status` pollution from writeback (migration expert) | No writeback as read side effect; explicit migrate command only |

## Conditions before implementation

1. JSON Schema drafted and reviewed in `ruvector-config` before PR1 lands
2. Acceptance test: run loader against fixture project with no config file; verify compiled defaults match schema
3. Acceptance test: open an existing 384-dim fixture index with the new loader; verify it opens cleanly using the header-encoded dim, regardless of what the config file says
4. `ruvector config show` command designed and signed off before PR1
5. Patch repo CI gate for `RV-CONFIG-N` drift wired before the first `RV-CONFIG-N` patch is filed
6. Sibling ADR-0001 created in `ruvector/docs/adr/` referencing the same schema artifact
7. Memory entry `reference-embedding-config-schema` added pointing at ADR-0102 + the JSON Schema file path

## Consequences

**Pros**

- Single source of truth for embedding/index parameters across both ecosystems
- 384 safety gate moves from ruflo-only to a shared loader rule
- All 10 hardcoded literals removed; future model changes are one-line config edits
- Existing 384-dim deployments keep working unchanged (index header drives behavior, not config)
- HNSW build-time vs query-time invariants respected: header for existing indexes, config for new indexes
- New `ruvector-config` crate keeps `ruvector-core` clean for wasm/no_std consumers
- ADR-0101 fork README work can finally describe a coherent install + configure story

**Cons**

- Two loaders (Rust + Node) require schema-version discipline to avoid drift
- New `ruvector-config` crate adds a workspace member
- Users who actively want to switch embedding models must rebuild indexes themselves (Appendix A); we do not auto-rebuild because we cannot guarantee correctness without knowing where their source text lives
- Four-PR rollout takes longer than a single default-bump
- One-directional coupling: ruflo schema changes block on ruvector schema authority

**Out of scope (explicit deferrals)**

- Schema v2 migration paths (the `schemaVersion` field reservation is in scope; v2 itself is not)
- Quantization config defaults (in schema but values deferred to a later ADR)
- Distance metric per-index override (single global metric in v1)
- Cypher / graph DB config keys (this ADR covers vector DB and HNSW only)

## Acceptance criteria

- [ ] `ruvector-config` crate exists, JSON Schema published, walk-up opt-in works
- [ ] `ruvector config show` outputs resolved config + per-key source
- [ ] `ruflo embeddings sync` writes the extended schema to `.claude-flow/embeddings.json`
- [ ] Zero hardcoded `384`, `768`, `m: 23`, `efConstruction: 100` in non-loader files (CI grep gate)
- [ ] Existing 384-dim test fixture index opens cleanly with the new loader (header dim wins over config dim)
- [ ] Both Rust and Node loaders pass identical fixture-config conformance tests
- [ ] ADR-0068 marked "extended by ADR-0102"
- [ ] Sibling ADR-0001 in `ruvector/docs/adr/` documents schema authority

## Status transitions

- **Proposed** (2026-04-26, current) — hive synthesis complete; awaiting implementation
- **In Progress** — when PR1 lands
- **Implemented** — when PR4 lands and all acceptance criteria are green
- **Extended** — if a future ADR adds keys (quantization, distance per-index) using the same schemaVersion field

## Bottom line

Unified config with a single canonical JSON file, single-directory precedence (no walk-up by default), explicit `migrate` commands instead of read-time writeback, and a four-PR rollout. Existing 384-dim indexes are not a migration concern — their headers carry the truth, and config only governs new indexes. The 384→768 default is right; the 10 hardcoded sites are wrong; the answer is not to fix the literals but to make the config chain the only path that produces those values.

## Appendix A — Switching embedding models

Vector data cannot be transformed mathematically from one embedding model to another (e.g., 384-dim MiniLM → 768-dim mpnet). The vectors are different functions of the source text. A user who wants to switch models must rebuild their index from source.

Three realistic paths:

1. **Re-embed from stored source** — if the original text was kept in the vector entry's metadata at ingest time, write a script that reads each entry, re-runs the new model on the metadata text, writes a new entry to a new index, swaps when verified.
2. **Re-ingest from external source** — if the original text is still in the upstream system (files, database, API), re-run ingest against a new index using the new model.
3. **Stay on the old model** — explicitly set `model = "Xenova/all-MiniLM-L6-v2"` and `dim = 384` in the config file. The 384→768 safety gate fires only on ambiguous configurations (dim set without a matching model); explicit MiniLM+384 is a valid config and passes through with an INFO log.

This is documentation, not tooling. We do not ship an automated migration command because we cannot guarantee correctness without knowing where the user's source text lives.
