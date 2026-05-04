// @tier unit
// ADR-0142 Guard G2 — wrapper bin must not contain a silent dev-tree fallback.
//
// Upstream's ruflo/bin/ruflo.js falls back to `resolve(__dirname,
// '../../v3/@claude-flow/cli')` when node_modules walk-up fails. That path
// only exists in a monorepo dev tree — in a published wrapper install, the
// fallback would silently target a non-existent directory, producing
// confusing "module not found" errors instead of a loud "wrapper installed
// incorrectly" message.
//
// Per memory `feedback-no-fallbacks.md`: silent fallbacks are the project's
// stated anti-pattern. The published wrapper must fail loud when cli isn't
// resolvable.
//
// This test gates against:
//   - Verbatim copy of upstream's ruflo.js (which would inherit the fallback)
//   - Future "improvements" that add a similar dev-tree default
//
// Until commit 4 (Phase 2), the wrapper is the npx-redirect form which has
// no findCliPath function at all — the no-fallback assertion still passes
// trivially (the dev-tree string isn't there). The loud-exit assertion is
// gated on findCliPath presence so it only fires post-pivot.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const WRAPPER_PATH = resolve(ROOT, 'bin', 'ruflo.mjs');

const wrapperSrc = readFileSync(WRAPPER_PATH, 'utf8');

describe('ADR-0142 G2: wrapper bin/ruflo.mjs has no silent dev-tree fallback', () => {
  it('does NOT contain v3/@claude-flow/cli (upstream dev-tree fallback)', () => {
    assert.ok(
      !wrapperSrc.includes('v3/@claude-flow/cli'),
      'wrapper must not reference upstream dev-tree path v3/@claude-flow/cli',
    );
  });

  it('does NOT contain v3/@sparkleideas/cli (forked dev-tree path)', () => {
    assert.ok(
      !wrapperSrc.includes('v3/@sparkleideas/cli'),
      'wrapper must not reference forked dev-tree path v3/@sparkleideas/cli',
    );
  });

  it('does NOT contain ../../v3/ (loose dev-tree pattern)', () => {
    assert.ok(
      !wrapperSrc.includes('../../v3/'),
      'wrapper must not contain ../../v3/ — sibling-of-monorepo-root path is dev-only',
    );
  });

  it('does NOT contain ../../../v3/ (deeper sibling pattern)', () => {
    assert.ok(
      !wrapperSrc.includes('../../../v3/'),
      'wrapper must not contain ../../../v3/ either',
    );
  });
});

describe('ADR-0142 G2: wrapper fails loud when cli is unreachable (post-pivot)', () => {
  // This block is gated on the wrapper being on the upstream-pattern
  // (post commit 4). Detection: presence of findCliPath function name.
  // Before commit 4, the npx-redirect wrapper has no such function and
  // the assertion is skipped with an explanatory message.
  const isUpstreamPattern = wrapperSrc.includes('findCliPath');

  it('contains process.exit(1) in the cli-not-found branch', { skip: isUpstreamPattern ? false : 'wrapper not yet on upstream pattern (Phase 1 transitional)' }, () => {
    assert.ok(
      wrapperSrc.includes('process.exit(1)'),
      'post-pivot wrapper must call process.exit(1) when cli cannot be resolved (no silent fallback)',
    );
  });

  it('prints a reinstall hint when cli is not found', { skip: isUpstreamPattern ? false : 'wrapper not yet on upstream pattern (Phase 1 transitional)' }, () => {
    assert.ok(
      /reinstall|npm install/i.test(wrapperSrc),
      'post-pivot wrapper must print a reinstall hint to stderr when cli not found',
    );
  });
});
