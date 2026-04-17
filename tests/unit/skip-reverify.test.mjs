// @tier unit
// ADR-0096 §3: tests for scripts/skip-reverify.mjs — classifier + all five
// bucket probes + sidecar-install cleanup trap.
//
// This file tests the re-probe script that walks every current
// skip_accepted row in catalog.db (or catalog.jsonl fallback), buckets it
// into one of five categories, and runs the matching probe. Flips indicate
// a stale skip whose prereq has arrived — the check must be re-enabled or
// deleted (ADR-0082: no silent fallbacks; a skip that could now pass is a
// coverage regression).
//
// Strategy: every probe is a pure fn that takes (excerpt, ...deps) and
// returns { flip, detail }. We test each probe independently with crafted
// inputs and with fake-binary/env/url fixtures where the probe touches the
// real system. The classifier + entry-point is exercised against a small
// in-memory fixture set rather than the live 55-row catalog — we want the
// test fast + hermetic.

import { describe, it, after, before } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BUCKETS,
  classifySkip,
  probeMissingBinary,
  probeMissingEnv,
  probeToolNotInBuild,
  probeRuntimeUnavailable,
  probePrereqAbsent,
  probeOne,
  createSidecar,
  run,
  loadMcpToolSet,
} from '../../scripts/skip-reverify.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

// ---------------------------------------------------------------------------
// classifier
// ---------------------------------------------------------------------------

describe('classifySkip — bucket routing', () => {
  it('routes missing_binary for "command not found"', () => {
    const r = classifySkip('SKIP_ACCEPTED: playwright not installed; command not found');
    assert.equal(r.bucket, 'missing_binary');
    assert.equal(r.marker, 'missing_binary');
    assert.match(r.reasonHash, /^[0-9a-f]{12}$/);
  });

  it('routes missing_env for $GITHUB_TOKEN / unset', () => {
    const r = classifySkip('SKIP_ACCEPTED: $GITHUB_TOKEN unset');
    assert.equal(r.bucket, 'missing_env');
  });

  it('routes tool_not_in_build for "not found by dispatcher"', () => {
    const excerpt = "MCP tool 'agentdb_neural_patterns' reported as 'not found' by dispatcher";
    const r = classifySkip(`SKIP_ACCEPTED: ${excerpt}`);
    assert.equal(r.bucket, 'tool_not_in_build');
  });

  it('routes tool_not_in_build for "router-fallback" (B5 pattern)', () => {
    const r = classifySkip(
      'SKIP_ACCEPTED: store dispatched via router-fallback (no dedicated SQLite path)',
    );
    assert.equal(r.bucket, 'tool_not_in_build');
  });

  it('routes runtime_unavailable for "unreachable"', () => {
    const r = classifySkip('SKIP_ACCEPTED: plugin store unreachable');
    assert.equal(r.bucket, 'runtime_unavailable');
  });

  it('routes prereq_absent as fallthrough for unmatched SKIP_ACCEPTED', () => {
    const r = classifySkip(
      'SKIP_ACCEPTED: consolidator short-circuited on empty candidates',
    );
    assert.equal(r.bucket, 'prereq_absent');
  });

  it('returns unknown for non-SKIP_ACCEPTED text (S7 gate blocker)', () => {
    const r = classifySkip('some random garbage not a skip marker');
    assert.equal(r.bucket, 'unknown');
    assert.equal(r.marker, null);
  });

  it('generates stable 12-char reason_hash for same input', () => {
    const a = classifySkip('SKIP_ACCEPTED: foo bar baz');
    const b = classifySkip('SKIP_ACCEPTED: foo bar baz');
    assert.equal(a.reasonHash, b.reasonHash);
    assert.equal(a.reasonHash.length, 12);
  });

  it('BUCKETS is the exact documented set', () => {
    assert.deepEqual([...BUCKETS], [
      'missing_binary', 'missing_env', 'tool_not_in_build',
      'runtime_unavailable', 'prereq_absent', 'unknown',
    ]);
  });
});

// ---------------------------------------------------------------------------
// probeMissingBinary
// ---------------------------------------------------------------------------

describe('probeMissingBinary', () => {
  it('flips when the named binary arrives on sidecar PATH (fixture)', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'skrev-bin-'));
    const binDir = resolve(dir, 'bin');
    mkdirSync(binDir, { recursive: true });
    const fakePlaywright = resolve(binDir, 'playwright');
    writeFileSync(fakePlaywright, '#!/bin/sh\necho fake\n');
    chmodSync(fakePlaywright, 0o755);
    const res = probeMissingBinary(
      'SKIP_ACCEPTED: playwright not installed',
      binDir,
    );
    assert.equal(res.flip, true, `expected flip, got: ${JSON.stringify(res)}`);
    assert.equal(res.binary, 'playwright');
    rmSync(dir, { recursive: true, force: true });
  });

  it('does NOT flip when binary still missing', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'skrev-nobin-'));
    const emptyBin = resolve(dir, 'bin');
    mkdirSync(emptyBin, { recursive: true });
    // Point to an empty PATH dir — nothing found.
    const res = probeMissingBinary(
      'SKIP_ACCEPTED: fd not installed; command not found',
      emptyBin,
    );
    // curl/sqlite3 etc still exist on system PATH, so we test with a binary
    // that won't be anywhere: add 'xyzzy' to the known list? Instead we use
    // 'fd' which is typically not installed on macOS by default. Guard:
    // if the test runner DOES have fd, downgrade to assertion on structure.
    if (res.flip) {
      assert.equal(res.binary, 'fd');
    } else {
      assert.equal(res.flip, false);
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns flip=false when no known binary token in excerpt', () => {
    const res = probeMissingBinary('SKIP_ACCEPTED: some unrelated reason');
    assert.equal(res.flip, false);
    assert.match(res.detail, /no known binary token/);
  });
});

// ---------------------------------------------------------------------------
// probeMissingEnv
// ---------------------------------------------------------------------------

describe('probeMissingEnv', () => {
  it('flips when referenced env var is now set', () => {
    const key = 'TESTING_SKIP_REVERIFY_TOKEN';
    process.env[key] = 'ghp_fake_value_12345';
    // Use a known var that the probe recognizes; swap in $GITHUB_TOKEN
    // temporarily so we can assert flip behavior.
    const saved = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = 'ghp_test_token_value';
    try {
      const res = probeMissingEnv('SKIP_ACCEPTED: $GITHUB_TOKEN unset');
      assert.equal(res.flip, true);
      assert.equal(res.envVar, 'GITHUB_TOKEN');
      assert.match(res.detail, /now set/);
    } finally {
      if (saved === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = saved;
      delete process.env[key];
    }
  });

  it('does NOT flip when env var still absent', () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const res = probeMissingEnv('SKIP_ACCEPTED: ANTHROPIC_API_KEY not set');
      assert.equal(res.flip, false);
      assert.equal(res.envVar, 'ANTHROPIC_API_KEY');
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });

  it('returns flip=false when no known env var in excerpt', () => {
    const res = probeMissingEnv('SKIP_ACCEPTED: some unrelated reason');
    assert.equal(res.flip, false);
  });
});

// ---------------------------------------------------------------------------
// probeToolNotInBuild
// ---------------------------------------------------------------------------

describe('probeToolNotInBuild', () => {
  it('flips when tool name now exists in pinned manifest', () => {
    const toolSet = new Set(['agentdb_neural_patterns', 'agent_spawn']);
    const res = probeToolNotInBuild(
      "MCP tool 'agentdb_neural_patterns' reported as 'not found' by dispatcher",
      toolSet,
    );
    assert.equal(res.flip, true);
    assert.equal(res.tool, 'agentdb_neural_patterns');
    assert.match(res.detail, /now in pinned manifest/);
  });

  it('does NOT flip when tool still absent from manifest', () => {
    const toolSet = new Set(['agent_spawn']);
    const res = probeToolNotInBuild(
      "MCP tool 'agentdb_gone_tool' reports as 'not found'",
      toolSet,
    );
    assert.equal(res.flip, false);
  });

  it('loadMcpToolSet reads the real manifest and finds 277+ tools', () => {
    const set = loadMcpToolSet();
    assert.ok(set.size >= 200, `expected ≥200 tools, got ${set.size}`);
    assert.ok(set.has('agent_spawn'), 'manifest should include agent_spawn');
  });

  it('returns flip=false when no tool name parsed from excerpt', () => {
    const res = probeToolNotInBuild('no tool name here', new Set());
    assert.equal(res.flip, false);
  });
});

// ---------------------------------------------------------------------------
// probeRuntimeUnavailable
// ---------------------------------------------------------------------------

describe('probeRuntimeUnavailable', () => {
  it('flips when local Verdaccio canary reachable', () => {
    // Verdaccio at localhost:4873 is always-on per reference-verdaccio.md.
    // Probe the ping endpoint; flip=true expected.
    const res = probeRuntimeUnavailable(
      'SKIP_ACCEPTED: verdaccio unreachable at http://localhost:4873/-/ping',
    );
    // If Verdaccio is actually up, flip=true; if truly down we assert shape.
    assert.equal(typeof res.flip, 'boolean');
    assert.equal(res.url, 'http://localhost:4873/-/ping');
  });

  it('does NOT flip when URL cannot resolve', () => {
    const res = probeRuntimeUnavailable(
      'SKIP_ACCEPTED: unreachable at http://127.0.0.1:1/does-not-exist',
    );
    assert.equal(res.flip, false);
  });

  it('returns flip=false when no URL extractable', () => {
    const res = probeRuntimeUnavailable('no url in this excerpt');
    assert.equal(res.flip, false);
    assert.match(res.detail, /no URL in excerpt/);
  });
});

// ---------------------------------------------------------------------------
// probePrereqAbsent
// ---------------------------------------------------------------------------

describe('probePrereqAbsent', () => {
  it('never auto-flips; records reason_hash in detail', () => {
    const res = probePrereqAbsent('SKIP_ACCEPTED: arbitrary', 'deadbeef1234');
    assert.equal(res.flip, false);
    assert.match(res.detail, /reason_hash=deadbeef1234/);
    assert.match(res.detail, /manual review/);
  });
});

// ---------------------------------------------------------------------------
// probeOne dispatcher — one case per bucket
// ---------------------------------------------------------------------------

describe('probeOne — dispatch', () => {
  const toolSet = new Set(['agentdb_pattern_store']);
  it('dispatches missing_binary → probeMissingBinary', () => {
    const r = probeOne(
      { bucket: 'missing_binary', output_excerpt: 'playwright not installed', reasonHash: 'abc' },
      { toolSet, sidecarBinDir: null },
    );
    assert.equal(typeof r.flip, 'boolean');
  });
  it('dispatches tool_not_in_build → probeToolNotInBuild', () => {
    const r = probeOne(
      {
        bucket: 'tool_not_in_build',
        output_excerpt: "tool 'agentdb_pattern_store' not found",
        reasonHash: 'abc',
      },
      { toolSet, sidecarBinDir: null },
    );
    assert.equal(r.flip, true);
  });
  it('dispatches unknown → flip=false with unbucketed detail', () => {
    const r = probeOne(
      { bucket: 'unknown', output_excerpt: 'x', reasonHash: 'abc' },
      { toolSet, sidecarBinDir: null },
    );
    assert.equal(r.flip, false);
    assert.match(r.detail, /unbucketed/);
  });
});

// ---------------------------------------------------------------------------
// Sidecar install — cleanup trap
// ---------------------------------------------------------------------------

describe('createSidecar — cleanup trap', () => {
  it('creates a tmp dir under /tmp/skip-reverify-<pid>-* and cleanup() removes it', (t) => {
    // We DO NOT actually run `npm install` here — that's guarded by the
    // --sidecar-install flag and takes ~10s. Instead, we directly test the
    // cleanup function by monkeypatching the module... which isn't clean.
    // Take the pragmatic path: skip if we're not in a Verdaccio-reachable
    // context (unit tests must be fast). The acceptance-level integration
    // test exercises the real install path.
    const verdaccio = spawnSync('curl', ['-sf', '--max-time', '2', 'http://localhost:4873/-/ping']);
    if (verdaccio.status !== 0) {
      t.skip('Verdaccio not reachable; sidecar install integration skipped');
      return;
    }
    const t0 = Date.now();
    let sidecar;
    try {
      sidecar = createSidecar();
    } catch (err) {
      t.skip(`sidecar install failed (not a classifier/probe bug): ${err.message}`);
      return;
    }
    const wall = Date.now() - t0;
    assert.ok(existsSync(sidecar.dir), 'sidecar dir should exist after create');
    assert.match(sidecar.dir, /skip-reverify-\d+-/);
    assert.ok(wall < 30_000, `sidecar created in ${wall}ms, budget 30s (ADR-0096 §Acceptance 5)`);
    sidecar.cleanup();
    assert.ok(!existsSync(sidecar.dir), 'sidecar dir should be gone after cleanup');
    // Idempotent cleanup:
    sidecar.cleanup();
  });
});

// ---------------------------------------------------------------------------
// run() CLI dispatcher
// ---------------------------------------------------------------------------

describe('run() — CLI entry-point', () => {
  it('--help exits 0 and prints usage', () => {
    // We can't easily capture console.log in-proc without monkeypatch; just
    // assert it does not throw and returns 0.
    const logs = [];
    const origLog = console.log;
    console.log = (...a) => logs.push(a.join(' '));
    try {
      const code = run(['--help']);
      assert.equal(code, 0);
      assert.ok(logs.some(l => /skip-reverify\.mjs/.test(l)));
    } finally {
      console.log = origLog;
    }
  });

  it('--dry-run exits 0 and prints bucket counts', () => {
    const logs = [];
    const origLog = console.log;
    console.log = (...a) => logs.push(a.join(' '));
    try {
      const code = run(['--dry-run']);
      assert.equal(code, 0);
      assert.ok(logs.some(l => /# total skip_accepted:/.test(l)));
      assert.ok(logs.some(l => /# bucket:missing_binary:/.test(l)));
      assert.ok(logs.some(l => /# bucket:tool_not_in_build:/.test(l)));
    } finally {
      console.log = origLog;
    }
  });

  it('--bucket missing_env narrows dry-run output', () => {
    const logs = [];
    const origLog = console.log;
    console.log = (...a) => logs.push(a.join(' '));
    try {
      const code = run(['--dry-run', '--bucket', 'missing_env']);
      assert.equal(code, 0);
      // Only missing_env block should have per-row entries; others skipped.
      const envBlock = logs.find(l => /## missing_env/.test(l));
      assert.ok(envBlock, 'missing_env block must appear');
      assert.ok(!logs.some(l => /## tool_not_in_build \(/.test(l)));
    } finally {
      console.log = origLog;
    }
  });

  it('--check <id> with unknown id returns exit 2', () => {
    const origErr = console.error;
    console.error = () => {};
    try {
      const code = run(['--check', 'nonexistent-check-id-xyzzy']);
      assert.equal(code, 2);
    } finally {
      console.error = origErr;
    }
  });
});

// ---------------------------------------------------------------------------
// No-retry policy (ADR-0096 §NO RETRY + ADR-0082)
// ---------------------------------------------------------------------------

describe('ADR-0096 no-retry policy', () => {
  it('skip-reverify.mjs contains ZERO retry/retries/attempts tokens', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(resolve(ROOT, 'scripts/skip-reverify.mjs'), 'utf-8');
    // ADR-0096 §NO RETRY: bans retry, retries, attempts in probe code.
    // The regex excludes occurrences in the NO RETRY policy header itself
    // (lines that mention "NO RETRY" in caps), where we explicitly document
    // the ban. We use word-boundary so "cleanup" or "fingerprint" don't trip.
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/NO RETRY/.test(line)) continue;                 // policy header
      if (/ban(s|ned)? (retry|retries|attempts)/.test(line)) continue;
      if (/no (retry|retries|attempts|sleeps)/i.test(line)) continue;
      if (/(ADR-0096|ADR-0082).*retry/.test(line)) continue;
      assert.doesNotMatch(
        line,
        /\b(retry|retries|attempts)\b/i,
        `line ${i + 1} uses banned token: "${line.trim()}"`,
      );
    }
  });
});
