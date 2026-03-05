# ADR-0013: Codemod Implementation

## Status

Accepted

## Context

### Specification (SPARC-S)

ADR-0005 establishes that the build-step rename transforms ~4,136 files per build. The codemod is the most complex and critical piece of the pipeline. It must handle:

- **package.json fields**: `name`, `dependencies`, `peerDependencies`, `optionalDependencies`, `bin`, `exports`
- **JS/TS/MJS/CJS source files**: `import`/`require` statements
- **Config files**: `tsconfig.json` paths, jest config, `.npmrc`
- **Asymmetric mappings**: scoped `@claude-flow/X` becomes `@sparkleideas/X`, but unscoped packages require different rules:
  - `claude-flow` becomes `@sparkleideas/claude-flow`
  - `ruflo` becomes `ruflo`
  - `agentdb` becomes `@sparkleideas/agentdb`
  - `agentic-flow` becomes `@sparkleideas/agentic-flow`
  - `ruv-swarm` becomes `@sparkleideas/ruv-swarm`
- **Must NOT rename**: `@ruvector/*`, `ruvector`, third-party dependencies
- **Must NOT corrupt**: `@sparkleideas` (contains the substring `claude-flow` -- ordering matters)

The review report (C4) identified that no ADR specifies the codemod tool choice, edge case handling, file extension list, or transformation rules. This ADR fills that gap.

### Pseudocode (SPARC-P)

```
FUNCTION transform(tempDir):
  files = glob(tempDir, ALLOWED_EXTENSIONS)
  files = files.filter(NOT in SKIP_DIRS)

  FOR each file in files:
    IF file ends with "package.json":
      transformPackageJson(file)
    ELSE:
      transformSourceFile(file)

FUNCTION transformPackageJson(file):
  json = JSON.parse(read(file))
  json.name = applyNameMapping(json.name)
  FOR field in [dependencies, peerDependencies, optionalDependencies]:
    FOR key in json[field]:
      newKey = applyNameMapping(key)
      IF newKey != key:
        json[field][newKey] = json[field][key]
        DELETE json[field][key]
  FOR field in [bin, exports]:
    // rename keys that reference package names
    transformBinAndExports(json, field)
  write(file, JSON.stringify(json, null, 2))

FUNCTION transformSourceFile(file):
  content = read(file)
  // Phase 1: Replace scoped packages FIRST
  content = content.replace(
    /@claude-flow\/(?!patch)/g,     // negative lookahead: skip @claude-flow/patch
    "@sparkleideas/"
  )
  // Phase 2: Replace unscoped packages with word-boundary matching
  content = replaceUnscoped(content, UNSCOPED_MAPPINGS)
  write(file, content)

FUNCTION applyNameMapping(name):
  IF name starts with "@claude-flow/": return name.replace("@claude-flow/", "@sparkleideas/")
  IF name == "claude-flow": return "@sparkleideas/claude-flow"
  IF name == "ruflo": return "ruflo"
  IF name == "agentdb": return "@sparkleideas/agentdb"
  IF name == "agentic-flow": return "@sparkleideas/agentic-flow"
  IF name == "ruv-swarm": return "@sparkleideas/ruv-swarm"
  return name  // unchanged (third-party, @ruvector/*, etc.)
```

## Decision

### Architecture (SPARC-A)

Use a custom Node.js transform script. Not `sed` -- too fragile for asymmetric mappings and JSON manipulation. Not `jscodeshift` -- overkill for what is mostly string replacement in non-AST contexts like `package.json` and import path literals.

The transform runs in two phases:

**Phase 1: package.json transform** (JSON-aware)

Parses each `package.json` as JSON. Modifies only these fields:

| Field | Transformation |
|-------|---------------|
| `name` | Apply name mapping |
| `dependencies` | Rename matching keys |
| `peerDependencies` | Rename matching keys |
| `optionalDependencies` | Rename matching keys |
| `bin` | Rename keys that match package names |
| `exports` | Rename condition keys that match package names |

Does NOT modify: `version`, `description`, `repository`, `homepage`, `bugs`, `scripts` (script bodies may contain package names in URLs or comments -- transforming these is unnecessary and risks corruption).

**Phase 2: Source file transform** (regex-based)

Processes files with extensions: `.js`, `.ts`, `.mjs`, `.cjs`, `.json` (non-package.json), `.d.ts`, `.d.mts`.

**Ordering rule**: Replace `@claude-flow/` BEFORE replacing bare `claude-flow`. This prevents double-replacement. The scoped replacement uses a negative lookahead `(?!patch)` to skip strings that already contain `@sparkleideas/`.

For unscoped packages, use word-boundary matching with negative lookbehind to avoid partial matches:

```javascript
// Replace "claude-flow" but NOT "@claude-flow" or "@sparkleideas/claude-flow"
// The scoped form is already handled by Phase 1
/(?<![@/\w-])claude-flow(?![\w-]*-patch)/g -> "@sparkleideas/claude-flow"

// Replace "agentdb" but NOT "agentdb-onnx" or similar
/(?<![@/\w-])agentdb(?![\w-])/g -> "@sparkleideas/agentdb"

// Replace "agentic-flow" but NOT already scoped
/(?<![@/\w-])agentic-flow(?![\w-])/g -> "@sparkleideas/agentic-flow"

// Replace "ruv-swarm" but NOT already scoped
/(?<![@/\w-])ruv-swarm(?![\w-])/g -> "@sparkleideas/ruv-swarm"

// Replace "ruflo" but NOT "ruflo"
/(?<![@/\w-])ruflo(?![\w-])/g -> "ruflo"
```

**What NOT to transform:**

| Exclusion | Reason |
|-----------|--------|
| `.git/` directories | Git internals must never be modified |
| `node_modules/` | Third-party code, not ours |
| URLs (`https://...`) | GitHub URLs, documentation links |
| LICENSE files | Legal text must be preserved verbatim |
| Binary files (`.node`, `.wasm`, images) | Not text |
| `pnpm-lock.yaml` | Delete and regenerate instead |
| `pnpm-workspace.yaml` | Transform separately (YAML-aware) |

The script uses an allowlist of file extensions rather than a denylist. Only files matching the allowed extensions are processed.

### Considered Alternatives

1. **`sed` with multiple passes** -- Rejected. `sed` cannot handle JSON structure-aware transformations (renaming a dependency key without renaming the same string in a `"description"` field). Asymmetric mappings with word-boundary constraints are fragile in `sed` regex syntax. Multi-pass `sed` invocations risk double-replacement across passes.

2. **`jscodeshift` (AST-based)** -- Rejected. Only handles JavaScript/TypeScript ASTs. Cannot transform `package.json` (not valid JS), `tsconfig.json`, or `.npmrc`. Adding a second tool for JSON files negates the benefit. The import paths we need to transform are string literals -- regex handles these correctly without full AST parsing.

3. **`codemod` (Facebook/Meta tool)** -- Rejected. Heavier dependency, designed for large-scale JS refactors. Our transformations are simpler (string replacement in import paths) and span more file types (JSON, config files) than codemod handles natively.

## Consequences

### Refinement (SPARC-R)

**Positive:**

- JSON-aware phase prevents corruption of `package.json` structure (preserves formatting, handles nested fields correctly)
- Regex ordering (scoped before unscoped) eliminates the double-replacement class of bugs entirely
- Negative lookahead on `@sparkleideas` means re-running the codemod is idempotent
- Allowlist of file extensions prevents accidental transformation of binary files or git objects
- Node.js implementation requires no additional toolchain -- matches the build pipeline language

**Negative:**

- The regex patterns must be maintained as upstream adds new package names or changes naming conventions
- Regex-based source transformation is not AST-aware -- it will transform strings inside comments and template literals. This is intentional: transforming comments is harmless, and template literals containing package names should be transformed to match the new scope
- If upstream introduces a package whose name is a substring of an existing package (e.g., `agent` vs `agentdb`), the word-boundary patterns must be reviewed

**Trade-offs and edge cases:**

- **Template literals**: `\`@claude-flow/${name}\`` will have the `@claude-flow/` prefix transformed to `@sparkleideas/`. The variable portion is untouched. This is correct for static prefixes but does not help when the entire package name is computed at runtime (see review issue C2 -- dynamic imports are a separate concern).
- **Comments**: Package names in comments will be transformed. This is harmless and actually helpful -- comments referencing `@claude-flow/memory` will correctly show `@sparkleideas/memory` in the published package.
- **Test fixtures**: Test files that assert on package names must be transformed, or the assertions will fail. The codemod processes `.test.ts`, `.spec.ts`, and files in `__tests__/` directories. Test fixtures containing expected output strings are transformed alongside the code under test, keeping them in sync.
- **`pnpm-workspace.yaml`**: This file lists workspace package globs. It must be transformed if package directory names change, but in practice directory names do not change (only the `name` field inside `package.json` changes). The file is left as-is unless directory names are part of the mapping.
- **`pnpm-lock.yaml`**: Delete this file after the codemod runs. Run `pnpm install` to regenerate it with the new package names. Transforming a lockfile in-place is fragile and unnecessary.
- **`.npmrc`**: May contain `@claude-flow:registry=...` lines. Transform the scope prefix in registry configuration lines. Use a targeted regex that matches only the scope prefix in registry directives.

### Completion (SPARC-C)

- [ ] Codemod script implemented in Node.js at `scripts/codemod.js`
- [ ] package.json transform handles all 6 fields (name, deps, peer, optional, bin, exports)
- [ ] Source file transform handles all allowed extensions (.js, .ts, .mjs, .cjs, .json, .d.ts, .d.mts)
- [ ] Scoped replacement runs before unscoped replacement (ordering verified by test)
- [ ] Negative lookahead prevents corruption of already-transformed `@sparkleideas/` strings
- [ ] Word-boundary matching prevents partial matches on unscoped package names
- [ ] `@ruvector/*` and `ruvector` references are NOT transformed (verified by test)
- [ ] URLs, LICENSE files, `.git/`, and `node_modules/` are excluded
- [ ] `pnpm-lock.yaml` is deleted (not transformed)
- [ ] Codemod is idempotent -- running twice produces the same output as running once
- [ ] Integration test: codemod runs against a snapshot of upstream HEAD and the result builds successfully
