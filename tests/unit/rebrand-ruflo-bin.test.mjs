/**
 * ADR-0006 follow-up (2026-04-21): CLI bin map rebrand to `ruflo`.
 *
 * Asserts the fork-source package.json at
 *   forks/ruflo/v3/@claude-flow/cli/package.json
 * exposes `ruflo`, `ruflo-mcp`, `claude-flow`, `claude-flow-mcp` and does NOT
 * expose the bare `cli` bin entry (removed — it collided with other packages
 * on shared dev machines).
 *
 * This test reads the pre-codemod fork source. The codemod bin-preservation
 * contract is covered separately in `codemod-bin-preservation.test.mjs`
 * (post-codemod assertion: bin keys stay literal, never get scoped).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FORK_PKG = join(
  __dirname,
  '../../../forks/ruflo/v3/@claude-flow/cli/package.json'
);

describe('ADR-0006 follow-up: CLI bin map — ruflo rebrand', () => {
  const pkg = JSON.parse(readFileSync(FORK_PKG, 'utf8'));

  it('bin map exists', () => {
    expect(pkg.bin).toBeTypeOf('object');
  });

  it('exposes `ruflo` pointing at ./bin/cli.js', () => {
    expect(pkg.bin.ruflo).toBe('./bin/cli.js');
  });

  it('exposes `ruflo-mcp` pointing at ./bin/mcp-server.js', () => {
    expect(pkg.bin['ruflo-mcp']).toBe('./bin/mcp-server.js');
  });

  it('keeps `claude-flow` as backwards-compat alias for ./bin/cli.js', () => {
    expect(pkg.bin['claude-flow']).toBe('./bin/cli.js');
  });

  it('keeps `claude-flow-mcp` as backwards-compat alias', () => {
    expect(pkg.bin['claude-flow-mcp']).toBe('./bin/mcp-server.js');
  });

  it('does NOT expose the bare `cli` entry (removed — collision risk)', () => {
    expect(pkg.bin).not.toHaveProperty('cli');
  });

  it('name stays @claude-flow/cli in fork source (codemod rewrites at publish)', () => {
    expect(pkg.name).toBe('@claude-flow/cli');
  });
});
