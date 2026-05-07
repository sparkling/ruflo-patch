// @tier unit
// ADR-0154 Phase 6c: migration tool acceptance test.
//
// Validates scripts/migrate-meta-to-segments.mjs exit codes + behavior
// across the four states a project can be in:
//
//   1. Empty project (no .rvf, no .meta)        — exit 0, "nothing to migrate"
//   2. Already migrated (native .rvf, no .meta) — exit 0, "already migrated"
//   3. Only .meta (legacy)                       — exits 3 (refuses without explicit choice)
//   4. Both populated (the HM divergence case)   — exit 1 without flag, exit 0 with --prefer-rvf

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const TOOL = new URL('../../scripts/migrate-meta-to-segments.mjs', import.meta.url).pathname;

function freshProject() {
  const dir = mkdtempSync(join(tmpdir(), 'adr0154-mig-'));
  mkdirSync(join(dir, '.swarm'), { recursive: true });
  return dir;
}

function runTool(projectRoot, ...extraArgs) {
  return spawnSync('node', [TOOL, projectRoot, ...extraArgs], {
    encoding: 'utf-8',
    timeout: 30_000,
  });
}

// Build a minimal legacy RVF\0 .meta file with one entry.
function writeLegacyMeta(metaPath, entries) {
  const magic = Buffer.from([0x52, 0x56, 0x46, 0x00]); // RVF\0
  const header = {
    magic: 'RVF\0',
    version: 1,
    dimensions: 3,
    metric: 'cosine',
    quantization: 'none',
    entryCount: entries.length,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const headerBuf = Buffer.from(JSON.stringify(header), 'utf-8');
  const headerLen = Buffer.alloc(4);
  headerLen.writeUInt32LE(headerBuf.length, 0);
  const entryBufs = [];
  for (const e of entries) {
    const serialized = { ...e, embedding: e.embedding ? Array.from(e.embedding) : undefined };
    const buf = Buffer.from(JSON.stringify(serialized), 'utf-8');
    const len = Buffer.alloc(4);
    len.writeUInt32LE(buf.length, 0);
    entryBufs.push(len, buf);
  }
  writeFileSync(metaPath, Buffer.concat([magic, headerLen, headerBuf, ...entryBufs]));
}

// Build a stub native SFVR .rvf (just the magic, enough for inspectRvfNative to recognize it).
function writeStubNativeRvf(rvfPath) {
  // SFVR + 4 zero bytes is enough for the magic-detection step in the tool.
  writeFileSync(rvfPath, Buffer.from([0x53, 0x46, 0x56, 0x52, 0, 0, 0, 0]));
}

describe('ADR-0154 Phase 6c: migration tool exit codes', () => {
  it('exits 0 with "nothing to migrate" on empty project', () => {
    const dir = freshProject();
    try {
      const r = runTool(dir);
      assert.equal(r.status, 0);
      assert.match(r.stdout, /nothing to migrate/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits 0 with "already migrated" when only native .rvf exists', () => {
    const dir = freshProject();
    try {
      writeStubNativeRvf(join(dir, '.swarm', 'memory.rvf'));
      const r = runTool(dir);
      assert.equal(r.status, 0, `expected exit 0, got ${r.status}.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
      assert.match(r.stdout, /already migrated/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses (exit 1) when both .rvf-native and .meta exist without --prefer-X flag', () => {
    const dir = freshProject();
    try {
      writeStubNativeRvf(join(dir, '.swarm', 'memory.rvf'));
      writeLegacyMeta(join(dir, '.swarm', 'memory.rvf.meta'), [
        { id: 'a', key: 'k1', namespace: 'ns', content: 'hello', embedding: new Float32Array([0.1, 0.2, 0.3]) },
      ]);
      const r = runTool(dir);
      assert.equal(r.status, 1, `expected exit 1 (divergence refusal), got ${r.status}`);
      assert.match(r.stderr, /divergence/);
      assert.match(r.stderr, /--prefer-rvf/);
      assert.match(r.stderr, /--prefer-meta/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('migrates with --prefer-rvf: archives .meta as .meta.migrated-<ts>', () => {
    const dir = freshProject();
    try {
      const rvfPath = join(dir, '.swarm', 'memory.rvf');
      const metaPath = join(dir, '.swarm', 'memory.rvf.meta');
      writeStubNativeRvf(rvfPath);
      writeLegacyMeta(metaPath, [
        { id: 'a', key: 'k1', namespace: 'ns', content: 'hello', embedding: new Float32Array([0.1, 0.2, 0.3]) },
      ]);
      const r = runTool(dir, '--prefer-rvf');
      assert.equal(r.status, 0, `expected exit 0, got ${r.status}.\nstderr: ${r.stderr}`);
      assert.ok(!existsSync(metaPath), '.meta should be moved aside');
      assert.ok(existsSync(rvfPath), '.rvf should remain');
      // Archive should exist with timestamp suffix
      const archives = readdirSync(join(dir, '.swarm'))
        .filter((n) => n.startsWith('memory.rvf.meta.migrated-'));
      assert.equal(archives.length, 1, 'exactly one archive should exist');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--dry-run does not modify any files', () => {
    const dir = freshProject();
    try {
      const rvfPath = join(dir, '.swarm', 'memory.rvf');
      const metaPath = join(dir, '.swarm', 'memory.rvf.meta');
      writeStubNativeRvf(rvfPath);
      writeLegacyMeta(metaPath, [
        { id: 'a', key: 'k1', namespace: 'ns', content: 'hello', embedding: new Float32Array([0.1, 0.2, 0.3]) },
      ]);
      const r = runTool(dir, '--prefer-rvf', '--dry-run');
      assert.equal(r.status, 0, `expected exit 0, got ${r.status}`);
      assert.match(r.stdout, /dry-run/);
      assert.ok(existsSync(metaPath), '.meta must NOT be moved on dry-run');
      assert.ok(existsSync(rvfPath), '.rvf must remain');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits 2 on missing project root', () => {
    const r = runTool('/var/folders/this/does/not/exist');
    assert.equal(r.status, 2);
    assert.match(r.stderr, /not an init'd project/);
  });

  it('exits 2 when both --prefer-rvf and --prefer-meta are passed', () => {
    const dir = freshProject();
    try {
      const r = runTool(dir, '--prefer-rvf', '--prefer-meta');
      assert.equal(r.status, 2);
      assert.match(r.stderr, /mutually exclusive/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
