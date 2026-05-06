// @tier unit
// ADR-0147 Refinement 5 (2026-05-06): plugin version auto-bump on source change.
//
// Background: `claude plugin update <name>@<marketplace>` only re-pulls when
// the plugin's `version` field changed between releases. Before R5, our
// publish pipeline bumped npm package versions but left plugin.json manifests
// at their original `0.1.0`. Result: source edits to skills/agents/commands
// shipped to the marketplace, but `claude plugin update` reported
// "already at the latest version" and clients kept stale content.
//
// R5 fix: extend `scripts/fork-version.mjs` to detect plugin source changes
// (via git diff `<oldSha>..HEAD` over `plugins/<name>/` — excluding plugin.json
// itself) and bump the manifest's semver patch. The CLI entry point calls this
// after the npm package bump phase when `--changed-shas` is provided.
//
// This test pins the contract so the fix can't silently regress.

import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import {
  findPluginManifests,
  bumpPluginPatch,
  detectChangedPlugins,
  bumpChangedPlugins,
} from '../../scripts/fork-version.mjs';

describe('ADR-0147 R5: bumpPluginPatch — semver patch increment', () => {
  it('0.1.0 → 0.1.1', () => assert.equal(bumpPluginPatch('0.1.0'), '0.1.1'));
  it('1.2.3 → 1.2.4', () => assert.equal(bumpPluginPatch('1.2.3'), '1.2.4'));
  it('0.0.0 → 0.0.1', () => assert.equal(bumpPluginPatch('0.0.0'), '0.0.1'));
  it('preserves prerelease suffix', () => assert.equal(bumpPluginPatch('0.1.0-beta.1'), '0.1.1-beta.1'));
  it('returns null for malformed input', () => {
    assert.equal(bumpPluginPatch('not-a-version'), null);
    assert.equal(bumpPluginPatch('1.2'), null);
    assert.equal(bumpPluginPatch(''), null);
  });
});

describe('ADR-0147 R5: findPluginManifests — discover plugins/<name>/.claude-plugin/plugin.json', () => {
  let tmpRoot;

  before(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'r5-find-'));
    // Two plugins
    mkdirSync(join(tmpRoot, 'plugins', 'plugin-a', '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(tmpRoot, 'plugins', 'plugin-a', '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'plugin-a', version: '0.1.0' }, null, 2),
    );
    mkdirSync(join(tmpRoot, 'plugins', 'plugin-b', '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(tmpRoot, 'plugins', 'plugin-b', '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'plugin-b', version: '2.0.0' }, null, 2),
    );
    // Malformed (no version) — should be skipped
    mkdirSync(join(tmpRoot, 'plugins', 'plugin-c', '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(tmpRoot, 'plugins', 'plugin-c', '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'plugin-c' }, null, 2), // no version
    );
    // Non-plugin directory under plugins/ — should be skipped (no manifest)
    mkdirSync(join(tmpRoot, 'plugins', 'README'), { recursive: true });
  });

  after(() => { try { rmSync(tmpRoot, { recursive: true, force: true }); } catch {} });

  it('returns all valid plugin manifests', () => {
    const manifests = findPluginManifests(tmpRoot);
    assert.equal(manifests.length, 2, 'should find 2 valid manifests, skipping malformed');
    const names = manifests.map(m => m.name).sort();
    assert.deepEqual(names, ['plugin-a', 'plugin-b']);
  });

  it('captures manifest path, plugin dir, name, version', () => {
    const manifests = findPluginManifests(tmpRoot);
    const a = manifests.find(m => m.name === 'plugin-a');
    assert.ok(a.manifestPath.endsWith('plugins/plugin-a/.claude-plugin/plugin.json'));
    assert.ok(a.pluginDir.endsWith('plugins/plugin-a'));
    assert.equal(a.version, '0.1.0');
  });

  it('returns empty array when plugins/ does not exist', () => {
    const empty = findPluginManifests(mkdtempSync(join(tmpdir(), 'r5-empty-')));
    assert.deepEqual(empty, []);
  });
});

describe('ADR-0147 R5: detectChangedPlugins — git diff over plugin source files', () => {
  let tmpRoot;
  let oldSha;

  before(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'r5-diff-'));
    execSync('git init -q', { cwd: tmpRoot });
    execSync('git config user.email test@test.local', { cwd: tmpRoot });
    execSync('git config user.name Test', { cwd: tmpRoot });
    // Initial commit: 2 plugins
    mkdirSync(join(tmpRoot, 'plugins', 'plugin-a', '.claude-plugin'), { recursive: true });
    mkdirSync(join(tmpRoot, 'plugins', 'plugin-a', 'skills'), { recursive: true });
    writeFileSync(
      join(tmpRoot, 'plugins', 'plugin-a', '.claude-plugin', 'plugin.json'),
      '{"name":"plugin-a","version":"0.1.0"}\n',
    );
    writeFileSync(join(tmpRoot, 'plugins', 'plugin-a', 'skills', 'SKILL.md'), 'orig-a\n');
    mkdirSync(join(tmpRoot, 'plugins', 'plugin-b', '.claude-plugin'), { recursive: true });
    mkdirSync(join(tmpRoot, 'plugins', 'plugin-b', 'commands'), { recursive: true });
    writeFileSync(
      join(tmpRoot, 'plugins', 'plugin-b', '.claude-plugin', 'plugin.json'),
      '{"name":"plugin-b","version":"0.1.0"}\n',
    );
    writeFileSync(join(tmpRoot, 'plugins', 'plugin-b', 'commands', 'cmd.md'), 'orig-b\n');
    execSync('git add . && git commit -q -m initial', { cwd: tmpRoot });
    oldSha = execSync('git rev-parse HEAD', { cwd: tmpRoot }).toString().trim();

    // Mutate plugin-a's SKILL.md → should trigger plugin-a as changed
    writeFileSync(join(tmpRoot, 'plugins', 'plugin-a', 'skills', 'SKILL.md'), 'updated-a\n');
    execSync('git add . && git commit -q -m "update SKILL.md"', { cwd: tmpRoot });
  });

  after(() => { try { rmSync(tmpRoot, { recursive: true, force: true }); } catch {} });

  it('detects plugin-a as changed (SKILL.md modified), plugin-b unchanged', async () => {
    const manifests = findPluginManifests(tmpRoot);
    const changed = await detectChangedPlugins(manifests, new Map([[tmpRoot, oldSha]]));
    assert.equal(changed.size, 1, `expected exactly 1 changed plugin, got ${changed.size}`);
    const onlyPath = [...changed][0];
    assert.ok(onlyPath.endsWith('plugins/plugin-a/.claude-plugin/plugin.json'),
      `expected plugin-a manifest path, got ${onlyPath}`);
  });

  it('returns empty set when no changes', async () => {
    const manifests = findPluginManifests(tmpRoot);
    const headSha = execSync('git rev-parse HEAD', { cwd: tmpRoot }).toString().trim();
    const changed = await detectChangedPlugins(manifests, new Map([[tmpRoot, headSha]]));
    assert.equal(changed.size, 0);
  });

  it('treats empty oldSha as first-run → all plugins changed', async () => {
    const manifests = findPluginManifests(tmpRoot);
    const changed = await detectChangedPlugins(manifests, new Map([[tmpRoot, '']]));
    assert.equal(changed.size, 2, 'first run should treat all manifests as changed');
  });

  it('plugin.json edits alone do NOT count as "source changed"', async () => {
    // Avoids double-bumping when only the version field was updated.
    const manifests = findPluginManifests(tmpRoot);
    // Edit plugin-b's plugin.json only (no source file change)
    writeFileSync(
      join(tmpRoot, 'plugins', 'plugin-b', '.claude-plugin', 'plugin.json'),
      '{"name":"plugin-b","version":"0.1.0","keywords":["x"]}\n',
    );
    execSync('git add . && git commit -q -m "manifest-only edit"', { cwd: tmpRoot });
    // Diff that ONLY contains the manifest-only commit
    const oneBackSha = execSync('git rev-parse HEAD~1', { cwd: tmpRoot }).toString().trim();
    const changed = await detectChangedPlugins(manifests, new Map([[tmpRoot, oneBackSha]]));
    assert.equal(changed.size, 0,
      'edit to plugin.json alone (no source files) must NOT trigger a re-bump');
  });
});

describe('ADR-0147 R5: bumpChangedPlugins — end-to-end orchestration', () => {
  function setupRepoWithChange() {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'r5-bump-'));
    execSync('git init -q', { cwd: tmpRoot });
    execSync('git config user.email test@test.local', { cwd: tmpRoot });
    execSync('git config user.name Test', { cwd: tmpRoot });
    mkdirSync(join(tmpRoot, 'plugins', 'plugin-a', '.claude-plugin'), { recursive: true });
    mkdirSync(join(tmpRoot, 'plugins', 'plugin-a', 'skills'), { recursive: true });
    writeFileSync(
      join(tmpRoot, 'plugins', 'plugin-a', '.claude-plugin', 'plugin.json'),
      '{\n  "name": "plugin-a",\n  "version": "0.1.0",\n  "description": "test"\n}\n',
    );
    writeFileSync(join(tmpRoot, 'plugins', 'plugin-a', 'skills', 'SKILL.md'), 'orig\n');
    execSync('git add . && git commit -q -m initial', { cwd: tmpRoot });
    const oldSha = execSync('git rev-parse HEAD', { cwd: tmpRoot }).toString().trim();
    writeFileSync(join(tmpRoot, 'plugins', 'plugin-a', 'skills', 'SKILL.md'), 'updated\n');
    execSync('git add . && git commit -q -m updated', { cwd: tmpRoot });
    return { tmpRoot, oldSha };
  }

  it('bumps the manifest version on disk when source files changed', async () => {
    const { tmpRoot, oldSha } = setupRepoWithChange();
    try {
      const bumps = await bumpChangedPlugins([tmpRoot], new Map([[tmpRoot, oldSha]]));
      assert.equal(bumps.length, 1);
      assert.equal(bumps[0].name, 'plugin-a');
      assert.equal(bumps[0].from, '0.1.0');
      assert.equal(bumps[0].to, '0.1.1');

      // Verify on-disk file mutated
      const raw = readFileSync(join(tmpRoot, 'plugins', 'plugin-a', '.claude-plugin', 'plugin.json'), 'utf8');
      const m = JSON.parse(raw);
      assert.equal(m.version, '0.1.1');
      // Other fields preserved
      assert.equal(m.name, 'plugin-a');
      assert.equal(m.description, 'test');
    } finally {
      try { rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
    }
  });

  it('dry-run does NOT mutate files', async () => {
    const { tmpRoot, oldSha } = setupRepoWithChange();
    try {
      const bumps = await bumpChangedPlugins([tmpRoot], new Map([[tmpRoot, oldSha]]), { dryRun: true });
      assert.equal(bumps.length, 1, 'dry-run must still report intended bumps');
      const m = JSON.parse(readFileSync(join(tmpRoot, 'plugins', 'plugin-a', '.claude-plugin', 'plugin.json'), 'utf8'));
      assert.equal(m.version, '0.1.0', 'dry-run must NOT mutate the file');
    } finally {
      try { rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
    }
  });

  it('returns empty array when no plugin source files changed', async () => {
    const { tmpRoot } = setupRepoWithChange();
    try {
      const headSha = execSync('git rev-parse HEAD', { cwd: tmpRoot }).toString().trim();
      const bumps = await bumpChangedPlugins([tmpRoot], new Map([[tmpRoot, headSha]]));
      assert.deepEqual(bumps, []);
    } finally {
      try { rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
    }
  });
});
