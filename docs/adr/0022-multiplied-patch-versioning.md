# ADR-0022: Multiplied Patch Versioning

- **Status**: Proposed
- **Date**: 2026-03-07
- **Deciders**: ruflo-patch maintainers
- **Methodology**: SPARC + MADR
- **Supersedes**: None (alternative to ADR-0012)

## SPARC Framework

### Specification

**Problem**: The current bump-last-segment scheme (ADR-0012) produces versions that are only 1 ahead of upstream (e.g., upstream `3.0.2` → ours `3.0.3`). If upstream publishes `3.0.3`, our next publish must be `3.0.4` — we're perpetually racing upstream for version numbers. While different npm scopes prevent actual collisions, the versions are confusingly similar and the version gap between "upstream content" and "our patch level" is invisible.

An alternative approach encodes the patch iteration into the patch number via multiplication, making the fork relationship self-documenting and providing a large namespace that upstream will never collide with.

**Trigger**: Observation that `@sparkleideas/aidefence@3.0.3` looks identical to a hypothetical `@claude-flow/aidefence@3.0.3`, creating human confusion about which version contains which patches. The version number alone doesn't signal "this is a fork."

**Success Criteria**:
1. Version numbers are valid semver that resolve against caret/tilde ranges
2. The version clearly signals "fork of upstream X.Y.Z at patch level N"
3. Upstream can never collide with our version space (even ignoring scope)
4. `npm install @sparkleideas/foo@^3.0.2` resolves correctly
5. Unlimited patch iterations without version exhaustion

### Pseudocode

```
CONST MULTIPLIER = 1000

FUNCTION multiplied_version(upstream_version, patch_iteration):
  # For stable versions (e.g., 3.0.2):
  #   base_patch = upstream_patch * MULTIPLIER = 2000
  #   our_patch  = base_patch + patch_iteration = 2001
  #   result     = 3.0.2001

  # For prerelease versions (e.g., 3.0.0-alpha.6):
  #   base_pre   = upstream_prerelease_num * MULTIPLIER = 6000
  #   our_pre    = base_pre + patch_iteration = 6001
  #   result     = 3.0.0-alpha.6001

  IF upstream_version has prerelease:
    parts = parse_prerelease(upstream_version)  # e.g., ["alpha", "6"]
    last_num = parts[-1]  # 6
    new_num = last_num * MULTIPLIER + patch_iteration  # 6001
    RETURN replace_prerelease_num(upstream_version, new_num)
  ELSE:
    patch = upstream_version.patch  # 2
    new_patch = patch * MULTIPLIER + patch_iteration  # 2001
    RETURN "{major}.{minor}.{new_patch}"

FUNCTION next_multiplied_version(upstream_version, last_published):
  IF last_published exists:
    current_iteration = extract_iteration(last_published, MULTIPLIER)
    RETURN multiplied_version(upstream_version, current_iteration + 1)
  ELSE:
    RETURN multiplied_version(upstream_version, 1)

# Extracting upstream from our version:
FUNCTION extract_upstream(our_version, MULTIPLIER):
  # 3.0.2001 -> patch 2001 / 1000 = 2 -> upstream 3.0.2
  # 3.0.0-alpha.6001 -> 6001 / 1000 = 6 -> upstream 3.0.0-alpha.6
  original = floor(last_numeric / MULTIPLIER)
  RETURN reconstruct(our_version, original)
```

### Architecture

```
Upstream version space          Our version space (x1000 multiplier)
─────────────────────          ─────────────────────────────────────
3.0.0                          3.0.0     (never used)
3.0.1                          3.0.1000  (never used — we start at +1)
3.0.2  ◄── upstream is here    3.0.2000  (never used — base only)
3.0.3  ◄── upstream might go   3.0.2001  ◄── our patch 1 of 3.0.2
       here next               3.0.2002  ◄── our patch 2 of 3.0.2
                               3.0.2003  ◄── our patch 3 of 3.0.2
                               ...
                               3.0.2999  ◄── 999 patches before collision risk
                               3.0.3000  ◄── base for upstream 3.0.3 (if they bump)
                               3.0.3001  ◄── our patch 1 of 3.0.3

Prerelease:
3.0.0-alpha.6  ◄── upstream    3.0.0-alpha.6000  (base)
3.0.0-alpha.7  ◄── next        3.0.0-alpha.6001  ◄── our patch 1
                               3.0.0-alpha.6002  ◄── our patch 2
                               3.0.0-alpha.7000  ◄── base for alpha.7
```

**Key property**: Upstream versions occupy positions `N*1000` (0, 1000, 2000, ...). Our patches occupy `N*1000 + 1` through `N*1000 + 999`. The two spaces never overlap as long as upstream increments by 1 (which is semver convention).

**Caret range resolution**:
- `^3.0.2` matches `>=3.0.2 <4.0.0` → `3.0.2001` matches ✓
- `^3.0.0-alpha.6` matches `>=3.0.0-alpha.6 <3.0.1` → `3.0.0-alpha.6001` matches ✓ (same `[major, minor, patch]` tuple)
- `~3.0.2` matches `>=3.0.2 <3.1.0` → `3.0.2001` matches ✓

### Refinement

#### Version Comparison Matrix

| Scheme | Example (upstream 3.0.2, patch 1) | Caret `^3.0.2` | Self-documenting | Collision-free | Unlimited patches |
|--------|-----------------------------------|-----------------|------------------|----------------|-------------------|
| **Bump-last (ADR-0012)** | `3.0.3` | ✓ | ✗ (looks like upstream 3.0.3) | ✓ (different scope) | ✓ |
| **Prerelease suffix** | `3.0.2-patch.1` | ✗ (broken) | ✓ | ✓ | ✓ |
| **Multiplied patch (this ADR)** | `3.0.2001` | ✓ | ✓ (2001 = 2×1000+1) | ✓ (999 slots) | ~999 per upstream |
| **Different name** | `3.0.3` (as `@yourorg/pkg`) | ✓ | ✗ | ✓ (different name) | ✓ |
| **Git dependency** | N/A (git ref) | N/A | ✓ | ✓ | ✓ |

#### Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| 999 patch limit per upstream version | Very Low | Medium | Monitor iteration count; 999 patches per upstream version is ample |
| Confusing version numbers to new contributors | Medium | Low | Document convention in README and CLAUDE.md |
| Upstream jumps by >1 (e.g., 3.0.2 → 3.0.5) | Low | None | Our space 2001-2999 never overlaps 5000-5999 |
| Migration from ADR-0012 versions | Certain | Medium | One-time version jump; all ADR-0012 versions (3.0.3, etc.) are < 3.0.2001 so transition is clean |
| Tools/scripts that parse patch number | Low | Low | Update `publish.mjs` and test helpers |

#### Prerelease Nuance

npm prerelease caret range matching has a special rule: `^3.0.0-alpha.6` only matches prereleases with the **same `[major, minor, patch]` tuple** — i.e., `3.0.0-alpha.*`. Since `3.0.0-alpha.6001` shares the tuple `[3, 0, 0]`, it matches correctly. This is the same behavior that makes ADR-0012's `3.0.0-alpha.7` work — our multiplied version `3.0.0-alpha.6001` works identically.

#### Readability Convention

To make versions human-readable, document this mapping:

```
Version 3.0.2001 = upstream 3.0.2, patch iteration 1
                    └─ 2001 ÷ 1000 = 2 remainder 1
                       └─ upstream patch: 2
                       └─ our iteration: 1

Version 3.0.0-alpha.6003 = upstream 3.0.0-alpha.6, patch iteration 3
                            └─ 6003 ÷ 1000 = 6 remainder 3
```

### Completion

#### Decision Drivers

1. **ADR-0012 works today** — bump-last-segment resolves correctly and is simple
2. **Multiplied patch is self-documenting** — version alone tells you upstream base + patch level
3. **Migration cost is non-zero** — all 24 packages need a version jump, tests need updating
4. **Human readability** — `3.0.2001` is unusual and requires explanation; `3.0.3` is conventional
5. **999-patch limit** — theoretical ceiling, but practically unreachable (we've done ~3 publishes total)

#### Considered Options

##### Option A: Adopt Multiplied Patch Versioning

Replace ADR-0012's bump-last-segment with multiplied patch (×1000):

1. Update `publish.mjs` to use `multiplied_version()` instead of `bumpLastSegment()`
2. First publish: `3.0.2001` (upstream 3.0.2, patch 1) — cleanly > `3.0.3` (last ADR-0012 publish)
3. Update `config/published-versions.json` format to track upstream base separately
4. Document the `÷1000` convention in README and CLAUDE.md

**Pros:**
- Version number is self-documenting (upstream base + patch level visible)
- Large namespace (999 patches per upstream version) eliminates any collision concern
- Upstream version is recoverable from our version via integer division
- Clearly signals "this is a fork" — no human would mistake `3.0.2001` for an upstream version

**Cons:**
- Unusual version numbers require explanation
- Migration from ADR-0012 requires one-time version jump
- 999 patch ceiling (theoretical, not practical)
- More complex version computation logic

##### Option B: Stay with ADR-0012 (Bump-Last-Segment)

Keep the current scheme. Accept that versions look close to upstream but rely on the different npm scope to disambiguate.

**Pros:**
- Already implemented and working
- Conventional-looking version numbers
- Zero migration cost
- Simpler computation

**Cons:**
- Version doesn't self-document the upstream base
- `3.0.3` looks like it could be upstream's next release
- No visual signal that this is a fork

##### Option C: Multiplied Patch with Smaller Multiplier (×100)

Same as Option A but with multiplier 100: upstream `3.0.2` → `3.0.201`, `3.0.202`, etc.

**Pros:**
- Shorter version numbers than ×1000
- Still self-documenting (201 = upstream 2, patch 1)

**Cons:**
- Only 99 patches per upstream version (still ample in practice)
- Less visually distinct from upstream (201 vs 2001)
- Same migration cost as Option A

## Decision

**Chosen option: Option B — Stay with ADR-0012**

### Rationale

1. **ADR-0012 is working** — all 24 packages publish and resolve correctly. The primary failure mode (prerelease `-patch.N` breaking caret ranges) has been fixed. There is no active bug to solve.

2. **Scope separation is sufficient** — `@sparkleideas/aidefence@3.0.3` and `@claude-flow/aidefence@3.0.3` are unambiguously different packages. npm scope is the correct disambiguation mechanism, not version number encoding.

3. **Conventional versions are easier** — contributors, users, and automated tools all understand `3.0.3`. Nobody needs to learn `÷1000` arithmetic.

4. **Migration cost for zero functional gain** — changing 24 package versions, updating tests, and rewriting `publish.mjs` produces no new capability. The only benefit is aesthetic (self-documenting versions), which doesn't justify the risk and effort.

5. **Per-package tracking already provides traceability** — `config/published-versions.json` and `sparkleideas` metadata in published `package.json` files already document the upstream→fork mapping. The version number doesn't need to encode it redundantly.

### When to Reconsider

| Trigger | Action |
|---------|--------|
| Upstream scope collision (e.g., `@claude-flow` deprecated, upstream moves to `@sparkleideas`) | Implement Option A immediately — scope no longer disambiguates |
| Users consistently confused about which version maps to which upstream | Evaluate Option A or improve documentation |
| Patch iteration exceeds 10 per upstream version | Not a trigger for Option A, but indicates high churn — review process |

## Consequences

**Good:**
- No migration cost
- No new complexity
- ADR-0012 continues to serve well

**Bad:**
- Version numbers don't self-document the fork relationship (mitigated by metadata and docs)

**Neutral:**
- This ADR documents the multiplied-patch approach for future reference if conditions change

---

## References

- [ADR-0012: Version Numbering Scheme](0012-version-numbering-scheme.md) — current active scheme
- [npm semver documentation](https://docs.npmjs.com/cli/v10/using-npm/semver)
- [Semantic Versioning 2.0.0](https://semver.org/)
- Multiplied patch pattern: used by organizations maintaining large-scale forks (e.g., Android AOSP version codes)
