# ADR-0227: Recalibrate the adaptive similarity threshold for mpnet (0.3 → 0.15)

- **Status**: Accepted
- **Date**: 2026-05-22
- **Supersedes**: ADR-0167 (the "keep the 0.3 search floor" stance only — its metric-not-persisted amendment stands); ADR-0004 (lower-to-0.1, long-obsolete)
- **Relates**: ADR-0069 (mpnet unified model), ADR-0073 (RVF cosine-direct scoring), FB-004 (`getAdaptiveThreshold`)

## Context

`memory_search` ranks by cosine similarity and drops results below a floor. That floor has churned across **fork** ADRs (there is **no upstream search-threshold ADR** — `0.3` is just an undocumented upstream code default):

- ADR-0004 lowered the hardcoded default `0.3 → 0.1` for hash embeddings. Long obsolete: its targets (`memory-bridge.js`, `memory-initializer.js`) were deleted in the v3 restructure, and its change was reverted.
- FB-004 introduced `getAdaptiveThreshold` (**fork-only** — upstream has no adaptive mechanism): `0.05` for hash-fallback, **`0.3` for ONNX**, on the documented assumption *"ONNX embeddings produce meaningful similarity 0.3–0.95."*
- ADR-0167 re-converged the hardcoded fallback to `0.3` (upstream's code value) and said callers wanting recall should pass `threshold:0`.

**The "ONNX 0.3–0.95" assumption is empirically wrong for the model the fork actually runs (mpnet, ADR-0069).** Measured cosine via `embeddings_compare` (2026-05-22):

| Class | Examples | Range |
|---|---|---|
| RELATED | 0.285, 0.280, 0.380, 0.522, 0.624 | ~0.25–0.65 |
| UNRELATED | −0.008, 0.042 | ~0 |

The separating gap is ~0.05–0.25. A `0.3` floor sits **above the bottom of the related band**, so it silently drops genuine matches in 0.25–0.30 (e.g. `"authentication"` ↔ `"jwt authentication tokens…"` = 0.285). This isn't hypothetical: the swarm agents (`architect.md`) and the `rvf-orphan-numid` acceptance check search **without** an explicit threshold, so they get `0.3` and miss that band.

## Decision

1. **`getAdaptiveThreshold` ONNX floor: `0.3 → 0.15`** (`@claude-flow/memory/src/embedding-adapter.ts`). `0.15` sits in the measured gap (admits related ≥0.28, rejects unrelated ≤0.04). The **hardcoded** fallback stays `0.3` (we still mirror upstream's code default); only the fork's adaptive layer changes. Hash-fallback stays `0.05`.
2. **Route MCP `memory_search` through `getAdaptiveThreshold`** (`mcp-tools/memory-tools.ts`): pass `input.threshold` (possibly `undefined`) through instead of hardcoding `?? 0.3`. The hardcode defeated the adaptive layer for the MCP path (only CLI/router benefited). Explicit `threshold:0` and positive values remain honored end-to-end.

## Consequences

- **Recall**: `memory_search` (CLI + MCP) now admits the 0.25–0.30 related band that `0.3` dropped — the systemic recall complaint behind this whole investigation.
- `rvf-orphan-numid` passes **at the default** threshold (0.285 ≥ 0.15); re-added to the acceptance tally with no per-check `--threshold 0` workaround.
- **Precision**: negligible loss — unrelated content scores ~0, far below 0.15.
- **No upstream divergence on the hardcoded default** (stays 0.3); the adaptive layer is fork-only, so this is squarely within the fork's purview.
- Supersedes ADR-0167's threshold stance; ADR-0004 marked Superseded.

## Verification

- Unit source guard: `tests/unit/adr0227-adaptive-threshold.test.mjs` (ONNX floor is 0.15, MCP routes through the adaptive function).
- Acceptance: `rvf-cosine-reopen` (PASS) and `rvf-orphan-numid` (now PASS at the default floor).
