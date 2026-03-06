#!/usr/bin/env node
/**
 * Acceptance tests for the codemod output.
 * Validates that all package.json files in the build directory have been
 * properly transformed: no @claude-flow/* references remain, and no
 * prerelease version ranges exist for @sparkleideas/* internal deps.
 *
 * Usage:
 *   node scripts/test-codemod-acceptance.mjs /path/to/build-dir
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';

const SKIP_DIRS = new Set(['.git', 'node_modules']);

async function* walkPackageJsons(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkPackageJsons(full);
    } else if (entry.name === 'package.json') {
      yield full;
    }
  }
}

const DEP_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'];

async function runTests(buildDir) {
  const errors = [];
  let checked = 0;

  for await (const pkgPath of walkPackageJsons(buildDir)) {
    let json;
    try {
      json = JSON.parse(await readFile(pkgPath, 'utf8'));
    } catch {
      continue; // skip malformed
    }
    checked++;

    // Check: no @claude-flow/* in name
    if (json.name && json.name.startsWith('@claude-flow/')) {
      errors.push(`${pkgPath}: name still uses @claude-flow/ scope: ${json.name}`);
    }

    // Check: no @claude-flow/* keys in dependency fields
    for (const field of DEP_FIELDS) {
      if (!json[field] || typeof json[field] !== 'object') continue;
      for (const [key, value] of Object.entries(json[field])) {
        if (key.startsWith('@claude-flow/')) {
          errors.push(`${pkgPath}: ${field} has @claude-flow/ key: ${key}`);
        }
        // Check: no prerelease ranges for @sparkleideas/* internal deps
        if (key.startsWith('@sparkleideas/') && typeof value === 'string') {
          const isPrerelease = /\d+\.\d+\.\d+-/.test(value);
          const isDistTag = /^[a-z]+$/i.test(value.trim());
          if (isPrerelease || isDistTag) {
            errors.push(
              `${pkgPath}: ${field}["${key}"] has prerelease/dist-tag range: "${value}" (should be "*")`
            );
          }
        }
      }
    }
  }

  console.log(`Checked ${checked} package.json files`);

  if (errors.length > 0) {
    console.error(`\nFAILED: ${errors.length} issue(s) found:\n`);
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  console.log('All acceptance tests passed');
}

const buildDir = process.argv[2];
if (!buildDir) {
  console.error('Usage: node scripts/test-codemod-acceptance.mjs <build-dir>');
  process.exit(1);
}

runTests(buildDir).catch((err) => {
  console.error('Acceptance test error:', err.message);
  process.exit(1);
});
