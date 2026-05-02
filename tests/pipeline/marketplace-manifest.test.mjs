// @tier pipeline
// ADR-0113 Phase C (Fix 4) — marketplace identity (Option B).
//
// Locks the contract that forks/ruflo/.claude-plugin/marketplace.json
// has the sparkling identity AND that the codemod has been applied to
// content (no @claude-flow/ refs left in the manifest or its
// surrounding plugin docs).
//
// References:
//   - ADR-0113 §Implementation plan step 31
//   - reference-fork-workflow (sparkling = our distribution remote)
//
// This test reads the fork directly because the marketplace is served
// from the fork's HEAD when users `/plugin marketplace add sparkling/ruflo`
// — there's no patch-repo intermediate. The test is gated on the fork
// dir existing (skips on CI without forks checked out).

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

// Fork dir from upstream-branches.json (single source of truth).
const upstream = JSON.parse(
  readFileSync(resolve(ROOT, 'config', 'upstream-branches.json'), 'utf8'),
);
const FORK_RUFLO = upstream.ruflo.dir;

const MANIFEST = join(FORK_RUFLO, '.claude-plugin', 'marketplace.json');
const PLUGINS_DIR = join(FORK_RUFLO, 'plugins');
const CLAUDE_PLUGIN_DIR = join(FORK_RUFLO, '.claude-plugin');

const skip = !existsSync(MANIFEST)
  ? `marketplace.json not found at ${MANIFEST}`
  : false;

describe('ADR-0113 Phase C — marketplace.json identity', { skip }, () => {
  it('owner.name is "sparkling" (Option B identity per ADR-0111)', () => {
    const m = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    assert.equal(
      m.owner?.name,
      'sparkling',
      'owner.name must be "sparkling" — distribution identity per ADR-0113 Phase C step 30',
    );
    assert.match(
      m.owner?.url ?? '',
      /github\.com\/sparkling/,
      'owner.url should point at github.com/sparkling org',
    );
  });

  it('marketplace name is "ruflo" (Claude Code marketplace identifier, not repo identity)', () => {
    const m = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    assert.equal(
      m.name,
      'ruflo',
      'manifest `name` is the slash-command marketplace identifier — keep as "ruflo"',
    );
  });

  it('plugin source paths are relative ./plugins/<name> (no scope substitution)', () => {
    // The codemod rewrites @claude-flow/* in scoped imports/refs but
    // doesn't touch relative path strings. Sanity-check the source
    // entries point at sibling directories.
    const m = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    assert.ok(Array.isArray(m.plugins), 'plugins must be an array');
    assert.ok(m.plugins.length >= 10, 'expect ≥ 10 plugin entries');
    for (const p of m.plugins) {
      assert.match(
        p.source,
        /^\.\/plugins\//,
        `plugin ${p.name} source should start with ./plugins/, got: ${p.source}`,
      );
    }
  });

  it('manifest itself contains no @claude-flow/ references (codemod applied)', () => {
    const raw = readFileSync(MANIFEST, 'utf8');
    assert.ok(
      !raw.includes('@claude-flow/'),
      'marketplace.json contains @claude-flow/ — Phase C codemod application missing',
    );
  });
});

describe('ADR-0113 Phase C — fork plugin/.claude-plugin .md files codemod-applied', { skip }, () => {
  // Walk the .md files and assert no @claude-flow/ refs remain. This
  // test runs every pipeline pass and locks the contract that future
  // upstream merges that re-introduce @claude-flow/ refs in plugin
  // docs MUST be re-codemodded before commit.

  function* walkMd(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === '.git' || e.name === 'node_modules' || e.name === 'dist') continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        yield* walkMd(full);
      } else if (e.isFile() && e.name.endsWith('.md')) {
        yield full;
      }
    }
  }

  it('zero @claude-flow/ refs remain in forks/ruflo/plugins/**/*.md', () => {
    const offending = [];
    for (const path of walkMd(PLUGINS_DIR)) {
      const content = readFileSync(path, 'utf8');
      if (content.includes('@claude-flow/')) {
        offending.push(path.replace(FORK_RUFLO + '/', ''));
      }
    }
    assert.equal(
      offending.length,
      0,
      `${offending.length} .md file(s) still contain @claude-flow/:\n  ${offending.join('\n  ')}\n\n` +
      `Resolution: run \`node scripts/apply-codemod-to-fork-md.mjs\` in ruflo-patch.`,
    );
  });

  it('zero @claude-flow/ refs remain in forks/ruflo/.claude-plugin/**/*.md', () => {
    const offending = [];
    for (const path of walkMd(CLAUDE_PLUGIN_DIR)) {
      const content = readFileSync(path, 'utf8');
      if (content.includes('@claude-flow/')) {
        offending.push(path.replace(FORK_RUFLO + '/', ''));
      }
    }
    assert.equal(
      offending.length,
      0,
      `${offending.length} .md file(s) still contain @claude-flow/:\n  ${offending.join('\n  ')}`,
    );
  });

  it('zero mcp__claude-flow__ refs remain in forks/ruflo/plugins/**/*.md', () => {
    const offending = [];
    for (const path of walkMd(PLUGINS_DIR)) {
      const content = readFileSync(path, 'utf8');
      if (content.includes('mcp__claude-flow__')) {
        offending.push(path.replace(FORK_RUFLO + '/', ''));
      }
    }
    assert.equal(
      offending.length,
      0,
      `${offending.length} .md file(s) still contain mcp__claude-flow__:\n  ${offending.join('\n  ')}`,
    );
  });
});
