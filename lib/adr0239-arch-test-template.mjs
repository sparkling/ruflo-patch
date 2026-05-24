/**
 * ADR-0239 arch-test template.
 *
 * Generates a vitest arch-test asserting that one or more forbidden
 * paths (files or directories) do not exist inside a fork's source
 * tree. Used uniformly across clusters 1, 2, 3, 5(a), 7-subset, 4(c)
 * per the [[ADR-0222]] amendment shape ("file/dir must not exist").
 *
 * The generated test is self-contained — it uses only `node:fs`,
 * `node:path`, and `vitest`. It does NOT import this template at
 * runtime; this module is purely a code generator invoked when
 * authoring a new cluster's arch-test.
 *
 * Usage:
 *   import { renderArchTest } from '../../ruflo-patch/lib/adr0239-arch-test-template.mjs';
 *   const src = renderArchTest({
 *     adr: '0239',
 *     cluster: 1,
 *     description: 'v3/@claude-flow/testing whole package deleted',
 *     forbiddenPaths: [
 *       'v3/@claude-flow/testing',
 *     ],
 *     // Resolution root, relative to the test file. Tests live in
 *     // v3/@claude-flow/cli/__tests__/arch/, fork root is 4 up.
 *     rootRelative: '../../../../',
 *   });
 *   writeFileSync(testPath, src);
 *
 * The runtime asserts: for each forbiddenPaths[i], existsSync(joined) === false.
 *
 * @typedef {Object} ArchTestSpec
 * @property {string} adr        - ADR number (no `ADR-` prefix), e.g. '0239'
 * @property {number} cluster    - Cluster number, e.g. 1
 * @property {string} description - One-line describe-block subject
 * @property {string[]} forbiddenPaths - Repo-root-relative paths that must NOT exist
 * @property {string} rootRelative - Path from the test file to the fork root (e.g. '../../../../')
 */

/**
 * Render a vitest arch-test file enforcing path absence.
 *
 * @param {ArchTestSpec} spec
 * @returns {string} The rendered TypeScript test source
 */
export function renderArchTest(spec) {
  if (!spec || typeof spec !== 'object') {
    throw new Error('renderArchTest: spec is required');
  }
  const { adr, cluster, description, forbiddenPaths, rootRelative } = spec;
  if (!adr) throw new Error('renderArchTest: spec.adr is required');
  if (!Number.isInteger(cluster)) throw new Error('renderArchTest: spec.cluster must be an integer');
  if (!description) throw new Error('renderArchTest: spec.description is required');
  if (!Array.isArray(forbiddenPaths) || forbiddenPaths.length === 0) {
    throw new Error('renderArchTest: spec.forbiddenPaths must be a non-empty array');
  }
  if (!rootRelative) throw new Error('renderArchTest: spec.rootRelative is required');

  // Render the forbidden-path assertions one per `it()` so a single re-add
  // doesn't mask other re-adds (per ADR-0222 precedent shape).
  const assertions = forbiddenPaths
    .map(
      (p) => `  it(${JSON.stringify(`${JSON.stringify(p).replace(/"/g, '')} must not exist`)}, () => {
    const target = resolve(FORK_ROOT, ${JSON.stringify(p)});
    expect(
      existsSync(target),
      \`\${target} should have been deleted (ADR-${adr} cluster ${cluster})\`,
    ).toBe(false);
  });`,
    )
    .join('\n\n');

  return `/**
 * Arch-test for ADR-${adr} cluster ${cluster}.
 *
 * ${description}
 *
 * Trip-wire: re-adding any of the forbidden paths below sends the
 * matching it() RED. Generated from
 * ruflo-patch/lib/adr0239-arch-test-template.mjs — edit there to
 * change the template shape uniformly across clusters.
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FORK_ROOT = resolve(__dirname, ${JSON.stringify(rootRelative)});

describe('ADR-${adr} cluster ${cluster}: ${description.replace(/'/g, "\\'")}', () => {
${assertions}
});
`;
}
