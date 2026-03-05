#!/usr/bin/env node
// scripts/publish.mjs — Publish all packages in topological order.
// Implements ADR-0014 (topological order), ADR-0015 (first-publish bootstrap),
// ADR-0010 (prerelease gate), ADR-0012 (version numbering).
//
// Usage:
//   node scripts/publish.mjs --build-dir ./dist --version 3.5.2-patch.1
//   node scripts/publish.mjs --build-dir ./dist --version 3.5.2-patch.1 --dry-run
//
// Exported API:
//   import { publishAll } from './publish.mjs';
//   const result = await publishAll('./dist', { version: '3.5.2-patch.1', dryRun: false });

import { execFile as execFileCb } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { promisify } from 'node:util';
import { parseArgs } from 'node:util';

const execFile = promisify(execFileCb);

// ── Topological levels (ADR-0014) ──

export const LEVELS = [
  // Level 1: depends only on external @ruvector/* (public npm)
  [
    '@claude-flow-patch/agentdb',
    '@claude-flow-patch/agentic-flow',
    '@claude-flow-patch/ruv-swarm',
  ],
  // Level 2: depends on Level 1
  [
    '@claude-flow-patch/shared',
    '@claude-flow-patch/memory',
    '@claude-flow-patch/embeddings',
    '@claude-flow-patch/codex',
    '@claude-flow-patch/aidefence',
  ],
  // Level 3: depends on Level 2
  [
    '@claude-flow-patch/neural',
    '@claude-flow-patch/hooks',
    '@claude-flow-patch/browser',
    '@claude-flow-patch/plugins',
    '@claude-flow-patch/providers',
    '@claude-flow-patch/claims',
  ],
  // Level 4: depends on Level 3
  [
    '@claude-flow-patch/guidance',
    '@claude-flow-patch/mcp',
    '@claude-flow-patch/integration',
    '@claude-flow-patch/deployment',
    '@claude-flow-patch/swarm',
    '@claude-flow-patch/security',
    '@claude-flow-patch/performance',
    '@claude-flow-patch/testing',
  ],
  // Level 5: root packages
  [
    '@claude-flow-patch/cli',
    '@claude-flow-patch/claude-flow',
    'ruflo-patch',
  ],
];

export const RATE_LIMIT_MS = 2000;

// ── Package directory resolution ──

/**
 * Recursively walk buildDir to find all package.json files and build
 * a map of package name -> directory path.
 */
function buildPackageMap(buildDir) {
  const map = new Map();

  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry === 'node_modules') continue;
      const fullPath = resolve(dir, entry);

      let st;
      try {
        st = statSync(fullPath);
      } catch {
        continue;
      }

      if (st.isDirectory()) {
        walk(fullPath);
      } else if (entry === 'package.json') {
        try {
          const pkg = JSON.parse(readFileSync(fullPath, 'utf-8'));
          if (pkg.name) {
            map.set(pkg.name, dir);
          }
        } catch {
          // Skip malformed package.json files
        }
      }
    }
  }

  walk(resolve(buildDir));
  return map;
}

// ── First-publish detection (ADR-0015) ──

/**
 * Check if a package has ever been published to npm.
 * Returns 'prerelease' for existing packages, null for first-publish.
 * Distinguishes E404 (not found) from network/other errors.
 */
async function getPublishTag(packageName) {
  try {
    await execFile('npm', ['view', packageName, 'version'], {
      timeout: 30_000,
    });
    // Package exists -- use prerelease gate (ADR-0010)
    return 'prerelease';
  } catch (err) {
    const stderr = err.stderr || '';
    const isNotFound =
      stderr.includes('E404') ||
      stderr.includes('is not in this registry') ||
      stderr.includes('Not Found') ||
      err.code === 1;

    if (isNotFound) {
      // Package never published -- first publish sets @latest automatically
      return null;
    }

    // Network error or other npm failure -- propagate
    throw new Error(
      `npm view failed for ${packageName} (not an E404): ${stderr || err.message}`
    );
  }
}

// ── Version stamping ──

/**
 * Update the version field in a package.json file.
 */
function stampVersion(pkgDir, version) {
  const pkgPath = join(pkgDir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  pkg.version = version;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  return pkg;
}

// ── GitHub issue creation ──

async function createFailureIssue(packageName, levelNumber, errorOutput) {
  const title = `Publish failed: ${packageName} at level ${levelNumber}`;
  const body = [
    `## Publish Failure`,
    '',
    `**Package:** \`${packageName}\``,
    `**Level:** ${levelNumber}`,
    `**Timestamp:** ${new Date().toISOString()}`,
    '',
    `### npm error output`,
    '',
    '```',
    errorOutput.slice(0, 4000), // Truncate to avoid GitHub body limits
    '```',
    '',
    `Packages at levels ${levelNumber + 1}-5 were NOT published.`,
  ].join('\n');

  try {
    await execFile('gh', [
      'issue', 'create',
      '--title', title,
      '--body', body,
      '--label', 'publish-failure',
    ], { timeout: 30_000 });
  } catch (err) {
    // Log but do not throw -- the publish failure is the primary error
    console.error(`Warning: could not create GitHub issue: ${err.message}`);
  }
}

// ── Core publish logic ──

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Publish all packages in topological order.
 *
 * @param {string} buildDir - Root directory containing built package directories
 * @param {object} options
 * @param {string} options.version - Version to stamp on all packages
 * @param {boolean} [options.dryRun=false] - Log actions without publishing
 * @returns {{ published: Array<{name: string, level: number, tag: string|null, version: string}>, failed: null | { package: string, level: number, error: string } }}
 */
export async function publishAll(buildDir, { version, dryRun = false } = {}) {
  if (!buildDir) throw new Error('buildDir is required');
  if (!version) throw new Error('version is required');

  const resolvedBuildDir = resolve(buildDir);
  console.log(`Resolving packages in: ${resolvedBuildDir}`);
  console.log(`Version: ${version}`);
  console.log(`Dry run: ${dryRun}`);
  console.log('');

  const packageMap = buildPackageMap(resolvedBuildDir);
  console.log(`Found ${packageMap.size} packages in build directory`);

  const published = [];

  for (const [levelIndex, packages] of LEVELS.entries()) {
    const levelNumber = levelIndex + 1;
    console.log(`\n--- Level ${levelNumber} ---`);

    for (const pkgName of packages) {
      const pkgDir = packageMap.get(pkgName);
      if (!pkgDir) {
        const errorMsg = `Package directory not found for ${pkgName} in ${resolvedBuildDir}`;
        console.error(errorMsg);

        if (!dryRun) {
          await createFailureIssue(pkgName, levelNumber, errorMsg);
        }

        return {
          published,
          failed: { package: pkgName, level: levelNumber, error: errorMsg },
        };
      }

      // Read the package's own package.json to determine version
      // For cross-repo packages, use upstream version from their own package.json
      // plus patch iteration (ADR-0012)
      const pkgJsonPath = join(pkgDir, 'package.json');
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
      const upstreamVersion = pkgJson.version;
      const effectiveVersion = deriveVersion(pkgName, upstreamVersion, version);

      // Stamp version
      console.log(`  ${pkgName} @ ${effectiveVersion}`);
      if (!dryRun) {
        stampVersion(pkgDir, effectiveVersion);
      }

      // Determine publish tag (first-publish bootstrap)
      let tag;
      try {
        tag = await getPublishTag(pkgName);
      } catch (err) {
        const errorMsg = `Failed to check npm registry for ${pkgName}: ${err.message}`;
        console.error(`  ERROR: ${errorMsg}`);

        if (!dryRun) {
          await createFailureIssue(pkgName, levelNumber, errorMsg);
        }

        return {
          published,
          failed: { package: pkgName, level: levelNumber, error: errorMsg },
        };
      }

      const tagLabel = tag ?? 'latest (first publish)';
      console.log(`    tag: ${tagLabel}`);

      if (dryRun) {
        console.log(`    [dry-run] would run: npm publish${tag ? ` --tag ${tag}` : ''}`);
        published.push({
          name: pkgName,
          level: levelNumber,
          tag: tag ?? 'latest',
          version: effectiveVersion,
        });
      } else {
        // Build npm publish args
        const publishArgs = ['publish', '--access', 'public'];
        if (tag) {
          publishArgs.push('--tag', tag);
        }

        try {
          const { stdout, stderr } = await execFile('npm', publishArgs, {
            cwd: pkgDir,
            timeout: 120_000,
          });

          if (stdout) console.log(`    ${stdout.trim()}`);

          published.push({
            name: pkgName,
            level: levelNumber,
            tag: tag ?? 'latest',
            version: effectiveVersion,
          });
        } catch (err) {
          const errorOutput = [
            `Exit code: ${err.code}`,
            `stdout: ${err.stdout || '(empty)'}`,
            `stderr: ${err.stderr || '(empty)'}`,
          ].join('\n');

          console.error(`  FAILED: ${pkgName}`);
          console.error(`    ${errorOutput}`);

          await createFailureIssue(pkgName, levelNumber, errorOutput);

          return {
            published,
            failed: { package: pkgName, level: levelNumber, error: errorOutput },
          };
        }
      }

      // Rate limit buffer (skip after last package)
      const isLast =
        levelIndex === LEVELS.length - 1 &&
        pkgName === packages[packages.length - 1];

      if (!isLast) {
        if (!dryRun) {
          await sleep(RATE_LIMIT_MS);
        }
      }
    }
  }

  console.log(`\nPublished ${published.length} packages successfully.`);
  return { published, failed: null };
}

// ── Version derivation (ADR-0012) ──

/**
 * Determine the effective version for a package.
 *
 * The top-level `version` argument is used directly for packages from the
 * primary upstream repo (ruflo). For packages from other upstream repos
 * (agentdb from agentic-flow, ruv-swarm from ruv-FANN), we derive a version
 * from their own upstream version + the patch iteration extracted from the
 * provided version string.
 *
 * @param {string} pkgName - The npm package name
 * @param {string} upstreamVersion - The version currently in the package's package.json
 * @param {string} primaryVersion - The version passed via CLI (e.g., "3.5.2-patch.1")
 */
function deriveVersion(pkgName, upstreamVersion, primaryVersion) {
  // Packages that track their own upstream version (not the primary ruflo repo)
  const crossRepoPackages = new Set([
    '@claude-flow-patch/agentdb',
    '@claude-flow-patch/agentic-flow',
    '@claude-flow-patch/ruv-swarm',
  ]);

  if (!crossRepoPackages.has(pkgName)) {
    // Primary repo packages use the provided version directly
    return primaryVersion;
  }

  // Extract patch iteration from primaryVersion (e.g., "3.5.2-patch.3" -> "3")
  const patchMatch = primaryVersion.match(/-patch\.(\d+)$/);
  if (!patchMatch) {
    // No -patch.N suffix -- use primaryVersion as-is (fallback)
    return primaryVersion;
  }

  const patchIteration = patchMatch[1];

  // Strip any existing -patch.N suffix from the upstream version
  const baseUpstream = upstreamVersion.replace(/-patch\.\d+$/, '');

  return `${baseUpstream}-patch.${patchIteration}`;
}

// ── CLI entry point ──

async function main() {
  const { values } = parseArgs({
    options: {
      'build-dir': { type: 'string' },
      version: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
    strict: true,
  });

  const buildDir = values['build-dir'];
  const version = values.version;
  const dryRun = values['dry-run'];

  if (!buildDir || !version) {
    console.error('Usage: node scripts/publish.mjs --build-dir <dir> --version <ver> [--dry-run]');
    process.exit(1);
  }

  const result = await publishAll(buildDir, { version, dryRun });

  // Output JSON summary to stdout
  console.log('\n--- Summary ---');
  console.log(JSON.stringify(result, null, 2));

  if (result.failed) {
    process.exit(1);
  }
}

// Run CLI if this is the main module
const isMainModule =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));

if (isMainModule) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
